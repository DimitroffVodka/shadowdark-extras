/**
 * Party camping and full-rest procedure.
 *
 * The planner is GM-driven so all inventory and recovery mutations happen on
 * one authoritative client. Players can still roll their own task checks in
 * the shared SDX overlay.
 */

import { getTravelActivities } from "./TravelActivitiesSettingsSD.mjs";
import { buildTravelTaskRollData } from "../tray/SDXRollerData.mjs";
import { SDXRollerApp } from "../tray/SDXRollerApp.mjs";
import {
	CAMPFIRE_TORCH_COST,
	REST_DURATION_SECONDS,
	TORCH_NAME_PATTERN,
	planStackConsumption,
	qualifiesForRest,
	calculateCookBonusHp
} from "./CampingRestData.mjs";

const MODULE_ID = "shadowdark-extras";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const RATION_PATTERN = /^rations?$/i;
const TORCH_PATTERN = TORCH_NAME_PATTERN;
const CAMPFIRE_FLAG = "campingCampfire";

function memberKey(actor) {
	return actor.uuid?.startsWith("Compendium.") ? actor.uuid : actor.id;
}

function itemQuantity(actor, pattern) {
	return actor.items
		.filter(item => pattern.test(item.name))
		.reduce((sum, item) => sum + Math.max(0, Number(item.system?.quantity ?? 0)), 0);
}

function getItemStacks(actors, pattern, { inactiveLightsOnly = false } = {}) {
	const stacks = [];
	for (const actor of actors) {
		for (const item of actor.items) {
			if (!pattern.test(item.name)) continue;
			if (inactiveLightsOnly && item.system?.light?.active) continue;
			const quantity = Math.max(0, Number(item.system?.quantity ?? 0));
			if (!quantity) continue;
			stacks.push({
				ownerId: actor.id,
				ownerName: actor.name,
				itemId: item.id,
				itemName: item.name,
				quantity
			});
		}
	}
	return stacks;
}

function mergeConsumptionEntries(entries = []) {
	const merged = new Map();
	for (const entry of entries) {
		const key = `${entry.ownerId}:${entry.itemId}`;
		const existing = merged.get(key);
		if (existing) {
			existing.amount += entry.amount;
			existing.after -= entry.amount;
		} else {
			merged.set(key, { ...entry });
		}
	}
	return [...merged.values()];
}

async function applyConsumption(entries, actorMap) {
	const grouped = new Map();
	for (const entry of mergeConsumptionEntries(entries)) {
		if (!grouped.has(entry.ownerId)) grouped.set(entry.ownerId, []);
		grouped.get(entry.ownerId).push(entry);
	}

	for (const [ownerId, ownerEntries] of grouped) {
		const actor = actorMap.get(ownerId) ?? game.actors.get(ownerId);
		if (!actor) continue;

		const updates = [];
		const deletes = [];
		for (const entry of ownerEntries) {
			const item = actor.items.get(entry.itemId);
			if (!item) continue;
			const nextQuantity = Math.max(0, Number(item.system?.quantity ?? 0) - entry.amount);
			if (nextQuantity === 0) deletes.push(item.id);
			else updates.push({ _id: item.id, "system.quantity": nextQuantity });
		}
		if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
		if (deletes.length) await actor.deleteEmbeddedDocuments("Item", deletes);
	}
}

async function getGearSource(name) {
	const pack = game.packs.get("shadowdark.gear");
	if (!pack) return null;
	const index = await pack.getIndex({ fields: ["name", "type"] });
	const entry = [...index].find(item => item.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
	if (!entry) return null;
	return pack.getDocument(entry._id);
}

async function addGear(actor, name, quantity, { ammunition = false } = {}) {
	const amount = Math.max(1, Number.parseInt(quantity, 10) || 1);
	const existing = actor.items.find(item =>
		item.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0
		&& item.system?.isPhysical
	);
	if (existing) {
		await existing.update({ "system.quantity": Number(existing.system.quantity ?? 0) + amount });
		return existing;
	}

	const source = await getGearSource(name);
	if (source) {
		const data = source.toObject();
		delete data._id;
		data.system.quantity = amount;
		data.system.equipped = false;
		if (data.system.light) data.system.light.active = false;
		const [created] = await actor.createEmbeddedDocuments("Item", [data]);
		return created;
	}

	const [created] = await actor.createEmbeddedDocuments("Item", [{
		name,
		type: "Basic",
		img: ammunition
			? "icons/weapons/ammunition/arrows-bodkin-yellow-red.webp"
			: "icons/sundries/lights/torch-black.webp",
		system: {
			description: "",
			quantity: amount,
			isAmmunition: ammunition,
			slots: {
				free_carry: 0,
				per_slot: ammunition ? 20 : 1,
				slots_used: 1
			}
		}
	}]);
	return created;
}

async function refreshRestResources(actor) {
	const updates = [];
	let spells = 0;
	let abilities = 0;
	let wands = 0;

	for (const item of actor.items) {
		if (item.type === "Spell" && item.system?.lost) {
			updates.push({ _id: item.id, "system.lost": false });
			spells++;
			continue;
		}

		if (item.type === "Class Ability") {
			const update = { _id: item.id };
			let changed = false;
			if (item.system?.lost) {
				update["system.lost"] = false;
				changed = true;
			}
			if (
				item.system?.limitedUses
				&& Number(item.system?.uses?.available ?? 0) < Number(item.system?.uses?.max ?? 0)
			) {
				update["system.uses.available"] = Number(item.system.uses.max);
				changed = true;
			}
			if (changed) {
				updates.push(update);
				abilities++;
			}
			continue;
		}

		if (item.type === "Wand" && Array.isArray(item.system?.spells)) {
			if (!item.system.spells.some(spell => spell.lost)) continue;
			updates.push({
				_id: item.id,
				"system.spells": item.system.spells.map(spell => ({
					...foundry.utils.deepClone(spell),
					lost: false
				}))
			});
			wands++;
		}
	}

	if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
	return { spells, abilities, wands };
}

async function grantLuck(actor) {
	const pulpMode = Boolean(game.settings.get("shadowdark", "usePulpMode"));
	if (pulpMode) {
		const before = Number(actor.system?.luck?.remaining ?? 0);
		await actor.update({ "system.luck.remaining": Math.max(1, before) });
		return before < 1;
	}

	const before = Boolean(actor.system?.luck?.available);
	await actor.update({ "system.luck.available": true });
	return !before;
}

async function grantCampingHp(actor, amount = 2) {
	const currentHp = Number(actor.system?.attributes?.hp?.value ?? 0);
	const maxHp = Number(actor.system?.attributes?.hp?.max ?? currentHp);
	const nextHp = calculateCookBonusHp(currentHp, maxHp, amount);
	if (nextHp !== currentHp) {
		await actor.update({ "system.attributes.hp.value": nextHp });
	}
	return nextHp;
}

async function createCampfire(partyActor) {
	const stale = partyActor.items.filter(item => item.getFlag(MODULE_ID, CAMPFIRE_FLAG));
	if (stale.length) {
		await partyActor.deleteEmbeddedDocuments("Item", stale.map(item => item.id));
	}

	const created = await partyActor.createEmbeddedDocuments("Item", [{
		name: "Campfire",
		type: "Basic",
		img: "icons/environment/wilderness/camp-improvised.webp",
		flags: {
			[MODULE_ID]: {
				[CAMPFIRE_FLAG]: true
			}
		},
		system: {
			description: "<p>Burns for 8 hours and sheds light to a near distance.</p>",
			quantity: 1,
			slots: {
				free_carry: 1,
				per_slot: 1,
				slots_used: 0
			},
			light: {
				active: true,
				hasBeenUsed: true,
				isSource: true,
				longevityMins: 480,
				remainingSecs: REST_DURATION_SECONDS,
				template: "torch"
			}
		}
	}], {
		sdxInternal: true,
		sdxBypassLock: true
	});
	const campfire = created?.[0];
	if (!campfire) {
		throw new Error(
			game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.campfire_create_failed")
		);
	}

	await partyActor.toggleLight(true, campfire.id);
	return campfire;
}

async function removeCampfire(partyActor, campfire) {
	if (!campfire) return;
	try {
		await partyActor.turnLightOff();
		if (partyActor.items.has(campfire.id)) {
			await partyActor.deleteEmbeddedDocuments("Item", [campfire.id]);
		}
	} catch (error) {
		console.warn(`${MODULE_ID} | Could not clean up camping campfire`, error);
	}
}

function getAssignedTaskKey(actor, assignments) {
	const key = memberKey(actor);
	for (const [taskKey, assigned] of Object.entries(assignments)) {
		if (Array.isArray(assigned) && assigned.includes(key)) return taskKey;
	}
	return "";
}

export class CampingRestApp extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(partyActor, members, { onCampfireChange = null } = {}) {
		super({});
		this.partyActor = partyActor;
		this.members = members.filter(actor => actor?.type === "Player" && !actor.pack);
		this.onCampfireChange = onCampfireChange;
		this._running = false;
	}

	static DEFAULT_OPTIONS = {
		id: "sdx-camping-rest",
		classes: ["shadowdark", "shadowdark-extras", "sdx-camping-rest-app"],
		tag: "form",
		window: {
			title: "SHADOWDARK_EXTRAS.camping_rest.title",
			resizable: true
		},
		position: {
			width: 820,
			height: 720
		},
		actions: {
			begin: CampingRestApp._onBegin,
			cancel: CampingRestApp._onCancel
		}
	};

	static PARTS = {
		form: {
			template: `modules/${MODULE_ID}/templates/camping-rest.hbs`,
			scrollable: [".sdx-rest-members"]
		}
	};

	static show(partyActor, members, options = {}) {
		const app = new CampingRestApp(partyActor, members, options);
		app.render({ force: true });
		return app;
	}

	async _prepareContext() {
		const tasks = getTravelActivities();
		const assignments = this.partyActor.getFlag(MODULE_ID, "travelAssignments") ?? {};
		const selections = this.partyActor.getFlag(MODULE_ID, "travelSelections") ?? {};
		const allTargets = this.members.map(actor => ({
			id: actor.id,
			name: actor.name
		}));

		const members = this.members.map(actor => {
			const taskKey = getAssignedTaskKey(actor, assignments);
			const task = tasks.find(entry => entry.key === taskKey);
			const selectedAbility = Number(selections[taskKey]?.[memberKey(actor)] ?? 0);
			const brokenItems = actor.items
				.filter(item => item.system?.isPhysical && item.system?.broken)
				.map(item => ({ id: item.id, name: item.name }));

			return {
				id: actor.id,
				uuid: actor.uuid,
				name: actor.name,
				img: actor.img,
				hp: Number(actor.system?.attributes?.hp?.value ?? 0),
				hpMax: Number(actor.system?.attributes?.hp?.max ?? 0),
				rations: itemQuantity(actor, RATION_PATTERN),
				taskKey,
				taskOptions: tasks.map(entry => ({
					key: entry.key,
					name: entry.name,
					abilitiesCsv: (entry.abilities ?? []).join("|"),
					selected: entry.key === taskKey
				})),
				abilityOptions: (task?.abilities ?? []).map((ability, index) => ({
					index,
					ability,
					selected: index === selectedAbility
				})),
				isCraft: taskKey === "craft",
				isEntertain: taskKey === "entertain",
				isKeepWatch: taskKey === "keepWatch",
				isHunt: taskKey === "hunt",
				brokenItems,
				targets: allTargets.filter(target => target.id !== actor.id)
			};
		});

		const resourceActors = [this.partyActor, ...this.members];
		return {
			members,
			totalRations: itemQuantity(this.partyActor, RATION_PATTERN)
				+ this.members.reduce((sum, actor) => sum + itemQuantity(actor, RATION_PATTERN), 0),
			totalTorches: getItemStacks(resourceActors, TORCH_PATTERN, { inactiveLightsOnly: true })
				.reduce((sum, stack) => sum + stack.quantity, 0),
			canLightWithTorches: getItemStacks(
				resourceActors,
				TORCH_PATTERN,
				{ inactiveLightsOnly: true }
			).reduce((sum, stack) => sum + stack.quantity, 0) >= CAMPFIRE_TORCH_COST
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		for (const select of this.element.querySelectorAll(".sdx-rest-task-select")) {
			select.addEventListener("change", event => this._updateTaskRow(event.currentTarget));
		}
		for (const checkbox of this.element.querySelectorAll(".sdx-rest-participating")) {
			checkbox.addEventListener("change", event => {
				event.currentTarget.closest(".sdx-rest-member")
					?.classList.toggle("sdx-rest-member-disabled", !event.currentTarget.checked);
			});
		}
	}

	_updateTaskRow(select) {
		const row = select.closest(".sdx-rest-member");
		if (!row) return;
		const taskKey = select.value;
		const abilities = String(select.selectedOptions[0]?.dataset.abilities ?? "")
			.split("|")
			.filter(Boolean);
		const abilitySelect = row.querySelector(".sdx-rest-ability-select");
		if (abilitySelect) {
			abilitySelect.replaceChildren(...abilities.map((ability, index) => {
				const option = document.createElement("option");
				option.value = String(index);
				option.textContent = ability;
				return option;
			}));
			abilitySelect.disabled = abilities.length < 2;
		}

		for (const contextual of row.querySelectorAll("[data-for-task]")) {
			contextual.classList.toggle("sdx-hidden", contextual.dataset.forTask !== taskKey);
		}
	}

	static _onCancel() {
		this.close();
	}

	static async _onBegin() {
		if (this._running) return;
		const plan = this._collectPlan();
		if (!plan) return;
		await this._confirmAndRun(plan);
	}

	_collectPlan() {
		const rows = [...this.element.querySelectorAll(".sdx-rest-member")];
		const campers = rows
			.map(row => {
				const actor = game.actors.get(row.dataset.actorId);
				if (!actor) return null;
				return {
					actor,
					participating: row.querySelector(".sdx-rest-participating")?.checked ?? false,
					taskKey: row.querySelector(".sdx-rest-task-select")?.value ?? "",
					abilityIndex: Number(row.querySelector(".sdx-rest-ability-select")?.value ?? 0),
					craftChoice: row.querySelector(".sdx-rest-craft-choice")?.value ?? "torch",
					repairItemId: row.querySelector(".sdx-rest-repair-item")?.value ?? "",
					entertainTargetId: row.querySelector(".sdx-rest-entertain-target")?.value ?? "",
					watchHalf: row.querySelector(".sdx-rest-watch-half")?.value ?? "first",
					pushed: row.querySelector(".sdx-rest-pushed")?.checked ?? false
				};
			})
			.filter(camper => camper?.participating);

		if (!campers.length) {
			ui.notifications.warn(
				game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.no_participants")
			);
			return null;
		}

		const campfireMode = this.element.querySelector('input[name="campfireMode"]:checked')?.value ?? "none";
		if (campfireMode === "firewood" && !campers.some(camper => camper.taskKey === "firewood")) {
			ui.notifications.warn(
				game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.firewood_requires_worker")
			);
			return null;
		}

		const resourceActors = [this.partyActor, ...campers.map(camper => camper.actor)];
		const torchPlan = planStackConsumption(
			getItemStacks(resourceActors, TORCH_PATTERN, { inactiveLightsOnly: true }),
			CAMPFIRE_TORCH_COST
		);
		if (campfireMode === "torches" && !torchPlan.complete) {
			ui.notifications.error(
				game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.not_enough_torches", {
					available: torchPlan.consumed,
					required: CAMPFIRE_TORCH_COST
				})
			);
			return null;
		}

		return {
			campers,
			campfireMode,
			torchPlan,
			interrupted: this.element.querySelector('input[name="interrupted"]')?.checked ?? false,
			advanceTime: this.element.querySelector('input[name="advanceTime"]')?.checked ?? false
		};
	}

	async _confirmAndRun(plan) {
		const content = `
			<p>${game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.confirm_content", {
				count: plan.campers.length
			})}</p>
			<ul>
				<li>${game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.confirm_rations", {
					count: plan.campers.length
				})}</li>
				<li>${game.i18n.localize(`SHADOWDARK_EXTRAS.camping_rest.campfire_${plan.campfireMode}`)}</li>
			</ul>
		`;
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.confirm_title") },
			content,
			modal: true
		});
		if (!confirmed) return;

		this._running = true;
		await this.close();
		try {
			await this._runProcedure(plan);
		} finally {
			this._running = false;
		}
	}

	async _saveSelections(plan, tasks) {
		const assignments = foundry.utils.deepClone(
			this.partyActor.getFlag(MODULE_ID, "travelAssignments") ?? {}
		);
		const selections = foundry.utils.deepClone(
			this.partyActor.getFlag(MODULE_ID, "travelSelections") ?? {}
		);
		for (const camper of plan.campers) {
			const key = memberKey(camper.actor);
			for (const task of tasks) {
				assignments[task.key] = (assignments[task.key] ?? [])
					.filter(id => id !== key);
			}
			if (!camper.taskKey) continue;
			assignments[camper.taskKey] ??= [];
			assignments[camper.taskKey].push(key);
			selections[camper.taskKey] ??= {};
			selections[camper.taskKey][key] = camper.abilityIndex;
		}
		await this.partyActor.setFlag(MODULE_ID, "travelAssignments", assignments);
		await this.partyActor.setFlag(MODULE_ID, "travelSelections", selections);
	}

	async _rollTaskGroup(task, campers, campfireEstablished) {
		const actors = campers.map(camper => camper.actor);
		const selections = Object.fromEntries(
			campers.map(camper => [memberKey(camper.actor), camper.abilityIndex])
		);
		const dcs = this.partyActor.getFlag(MODULE_ID, "travelDCs") ?? {};
		const dc = Number(dcs[task.key] ?? 12);
		const rollData = buildTravelTaskRollData(task, actors, selections, dc);
		if (task.campfire && !campfireEstablished) {
			rollData.actorRollModes = Object.fromEntries(
				actors.map(actor => [actor.uuid, "disadvantage"])
			);
		}
		const result = await SDXRollerApp.dispatchGroupRoll(rollData);
		return { dc, result };
	}

	async _rollInterruptionChecks(campers) {
		const task = {
			key: "interruptedRest",
			name: game.i18n.localize(
				"SHADOWDARK_EXTRAS.camping_rest.interruption_check"
			),
			abilities: ["CON"],
			campfire: false,
			description: game.i18n.localize(
				"SHADOWDARK_EXTRAS.camping_rest.interruption_check_description"
			),
			bannerImage: "modules/shadowdark-extras/assets/travel/batten_down.webp"
		};
		const actors = campers.map(camper => camper.actor);
		const selections = Object.fromEntries(campers.map(camper => [memberKey(camper.actor), 0]));
		const rollData = buildTravelTaskRollData(task, actors, selections, 12);
		return SDXRollerApp.dispatchGroupRoll(rollData);
	}

	_buildRationPlan(campers) {
		const actors = [this.partyActor, ...campers.map(camper => camper.actor)];
		const stacks = getItemStacks(actors, RATION_PATTERN).map(stack => ({ ...stack }));
		const rationByActor = new Map();
		const entries = [];

		for (const camper of campers) {
			const ordered = [
				...stacks.filter(stack => stack.ownerId === camper.actor.id),
				...stacks.filter(stack => stack.ownerId === this.partyActor.id),
				...stacks.filter(stack =>
					stack.ownerId !== camper.actor.id
					&& stack.ownerId !== this.partyActor.id
				)
			].filter(stack => stack.quantity > 0);
			const consumption = planStackConsumption(ordered, 1);
			rationByActor.set(camper.actor.id, consumption.complete);
			for (const entry of consumption.entries) {
				entries.push(entry);
				const stack = stacks.find(candidate =>
					candidate.ownerId === entry.ownerId
					&& candidate.itemId === entry.itemId
				);
				if (stack) stack.quantity -= entry.amount;
			}
		}

		return {
			rationByActor,
			entries: mergeConsumptionEntries(entries)
		};
	}

	async _runProcedure(plan) {
		const tasks = getTravelActivities();
		await this._saveSelections(plan, tasks);
		const taskResults = new Map();
		let campfire = null;
		let campfireEstablished = false;
		let canceled = false;

		try {
			if (plan.campfireMode === "torches") {
				campfire = await createCampfire(this.partyActor);
				campfireEstablished = true;
				await this.onCampfireChange?.();
			}

			const taskGroups = tasks
				.map(task => ({
					task,
					campers: plan.campers.filter(camper =>
						camper.taskKey === task.key
						&& !(task.key === "hunt" && camper.pushed)
					)
				}))
				.filter(group => group.campers.length);
			taskGroups.sort((a, b) =>
				a.task.key === "firewood" ? -1 : b.task.key === "firewood" ? 1 : 0
			);

			for (const group of taskGroups) {
				const { dc, result } = await this._rollTaskGroup(
					group.task,
					group.campers,
					campfireEstablished
				);
				if (result?.canceled) {
					canceled = true;
					break;
				}

				for (const camper of group.campers) {
					const value = Number(result?.results?.[camper.actor.uuid]);
					taskResults.set(camper.actor.id, {
						task: group.task,
						value,
						success: Number.isFinite(value) && value >= dc
					});
				}

				if (
					!campfireEstablished
					&& group.task.key === "firewood"
					&& group.campers.some(camper => taskResults.get(camper.actor.id)?.success)
				) {
					campfire = await createCampfire(this.partyActor);
					campfireEstablished = true;
					await this.onCampfireChange?.();
				}
			}

			if (canceled) {
				ui.notifications.warn(
					game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.canceled")
				);
				return;
			}

			const interruptionResults = new Map();
			if (plan.interrupted) {
				const checks = plan.campers.filter(camper => {
					const taskResult = taskResults.get(camper.actor.id);
					return !(taskResult?.task?.key === "battenDown" && taskResult.success);
				});
				if (checks.length) {
					const result = await this._rollInterruptionChecks(checks);
					if (result?.canceled) {
						ui.notifications.warn(
							game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.canceled")
						);
						return;
					}
					for (const camper of checks) {
						interruptionResults.set(
							camper.actor.id,
							Number(result?.results?.[camper.actor.uuid]) >= 12
						);
					}
				}
			}

			const actorMap = new Map([
				[this.partyActor.id, this.partyActor],
				...plan.campers.map(camper => [camper.actor.id, camper.actor])
			]);
			if (plan.campfireMode === "torches") {
				await applyConsumption(plan.torchPlan.entries, actorMap);
			}

			const summary = [];
			const taskBenefitsByActor = new Map();
			for (const camper of plan.campers) {
				const taskResult = taskResults.get(camper.actor.id);
				if (!taskResult?.success || taskResult.task.key !== "hunt") continue;
				taskBenefitsByActor.set(
					camper.actor.id,
					await this._applyTaskBenefit(camper, taskResult, plan)
				);
			}

			// A successful Hunt happens before the normal rest procedure, so
			// rations found by the hunters are available to hungry campers.
			const finalRationPlan = this._buildRationPlan(plan.campers);
			await applyConsumption(finalRationPlan.entries, actorMap);

			// Advance to the end of the rest before granting the final recovery
			// and Cook HP benefit.
			if (plan.advanceTime) {
				await game.time.advance(REST_DURATION_SECONDS);
			}

			const successfulCook = [...taskResults.values()]
				.some(result => result.task.key === "cook" && result.success);

			for (const camper of plan.campers) {
				const actor = camper.actor;
				const taskResult = taskResults.get(actor.id);
				const hasRation = finalRationPlan.rationByActor.get(actor.id) ?? false;
				const bedDownSucceeded = taskResult?.task?.key === "battenDown"
					&& taskResult.success;
				const rested = qualifiesForRest({
					hasRation,
					interrupted: plan.interrupted,
					bedDownSucceeded,
					interruptionCheckSucceeded: interruptionResults.get(actor.id) ?? false
				});
				const hpBefore = Number(actor.system?.attributes?.hp?.value ?? 0);
				let resourceSummary = { spells: 0, abilities: 0, wands: 0 };
				const benefits = [];

				if (rested) {
					const hpMax = Number(actor.system?.attributes?.hp?.max ?? hpBefore);
					await actor.update({ "system.attributes.hp.value": hpMax });
					resourceSummary = await refreshRestResources(actor);
					benefits.push(game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.benefit_full_rest"));
					if (actor.statuses?.has("unconscious")) {
						await actor.toggleStatusEffect("unconscious", { active: false });
					}
				}

				if (taskResult?.success) {
					const taskBenefits = taskBenefitsByActor.get(actor.id)
						?? await this._applyTaskBenefit(camper, taskResult, plan);
					benefits.push(...taskBenefits);
				} else if (camper.taskKey === "hunt" && camper.pushed) {
					benefits.push(
						game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.hunt_blocked")
					);
				}

				if (successfulCook && hasRation) {
					await grantCampingHp(actor, 2);
					benefits.push(
						game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.benefit_cook")
					);
				}

				summary.push({
					name: actor.name,
					img: actor.img,
					taskName: taskResult?.task?.name ?? (
						camper.taskKey === "hunt" && camper.pushed ? "Hunt" : "—"
					),
					taskValue: Number.isFinite(taskResult?.value) ? taskResult.value : null,
					taskSuccess: taskResult?.success ?? false,
					hasTaskResult: Boolean(taskResult),
					hasRation,
					rested,
					hpBefore,
					hpAfter: Number(actor.system?.attributes?.hp?.value ?? hpBefore),
					resourceSummary,
					benefits
				});
			}

			await this._postSummary({
				summary,
				campfireEstablished,
				campfireMode: plan.campfireMode,
				interrupted: plan.interrupted,
				advancedTime: plan.advanceTime,
				torchesConsumed: plan.campfireMode === "torches"
					? CAMPFIRE_TORCH_COST
					: 0
			});
			ui.notifications.info(
				game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.complete")
			);
		} catch (error) {
			console.error(`${MODULE_ID} | Camping rest procedure failed`, error);
			ui.notifications.error(
				game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.failed", {
					message: error.message
				})
			);
		} finally {
			await removeCampfire(this.partyActor, campfire);
			await this.onCampfireChange?.();
			this.partyActor.sheet?.render(false);
		}
	}

	async _applyTaskBenefit(camper, taskResult, plan) {
		const actor = camper.actor;
		const benefits = [];
		switch (taskResult.task.key) {
			case "craft": {
				if (camper.craftChoice === "repair") {
					const item = actor.items.get(camper.repairItemId)
						?? actor.items.find(candidate =>
							candidate.system?.isPhysical && candidate.system?.broken
						);
					if (item) {
						await item.update({ "system.broken": false });
						benefits.push(
							game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.benefit_repair", {
								item: item.name
							})
						);
					}
					break;
				}

				const rewardNames = {
					torch: "Torch",
					arrows: "Arrows",
					bolts: "Bolts",
					slingStones: "Sling Stones"
				};
				const rewardName = rewardNames[camper.craftChoice] ?? "Torch";
				let amount = 1;
				if (camper.craftChoice !== "torch") {
					const roll = await new Roll("2d4").evaluate();
					await roll.toMessage({
						speaker: ChatMessage.getSpeaker({ actor }),
						flavor: `${actor.name} — Crafted ${rewardName}`
					});
					amount = roll.total;
				}
				await addGear(actor, rewardName, amount, {
					ammunition: camper.craftChoice !== "torch"
				});
				benefits.push(
					game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.benefit_craft", {
						amount,
						item: rewardName
					})
				);
				break;
			}
			case "entertain": {
				const target = game.actors.get(camper.entertainTargetId)
					?? plan.campers.find(entry => entry.actor.id !== actor.id)?.actor;
				if (target) {
					const granted = await grantLuck(target);
					benefits.push(
						game.i18n.format(
							granted
								? "SHADOWDARK_EXTRAS.camping_rest.benefit_entertain"
								: "SHADOWDARK_EXTRAS.camping_rest.benefit_entertain_existing",
							{ target: target.name }
						)
					);
				}
				break;
			}
			case "firewood":
				benefits.push(
					game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.benefit_firewood")
				);
				break;
			case "hunt": {
				const roll = await new Roll("1d4").evaluate();
				await roll.toMessage({
					speaker: ChatMessage.getSpeaker({ actor }),
					flavor: `${actor.name} — Rations Found`
				});
				await addGear(actor, "Rations", roll.total);
				benefits.push(
					game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.benefit_hunt", {
						amount: roll.total
					})
				);
				break;
			}
			case "keepWatch":
				benefits.push(
					game.i18n.format("SHADOWDARK_EXTRAS.camping_rest.benefit_watch", {
						half: camper.watchHalf
					})
				);
				break;
			case "predict":
				{
					const current = this.partyActor.getFlag(
						MODULE_ID,
						"campingWeatherReroll"
					) ?? {};
					const actorIds = new Set(current.actorIds ?? []);
					actorIds.add(actor.id);
					await this.partyActor.setFlag(MODULE_ID, "campingWeatherReroll", {
						uses: Math.max(0, Number(current.uses ?? 0)) + 1,
						actorIds: [...actorIds],
						actorId: actor.id,
						createdAt: game.time.worldTime
					});
				}
				benefits.push(
					game.i18n.localize("SHADOWDARK_EXTRAS.camping_rest.benefit_predict")
				);
				break;
		}
		return benefits;
	}

	async _postSummary(data) {
		const content = await foundry.applications.handlebars.renderTemplate(
			`modules/${MODULE_ID}/templates/camping-rest-summary.hbs`,
			data
		);
		await ChatMessage.create({
			content,
			speaker: { alias: "Party Camping" }
		});
	}
}
