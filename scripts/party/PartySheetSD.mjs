/**
 * Party Sheet for Shadowdark RPG
 * A group/party management sheet similar to D&D 5e's Group actor
 */

import { getHpWaveColor, isHpWavesEnabled } from "../character-sheet/HpWavesSettingsSD.mjs";
import { getTravelActivities } from "./TravelActivitiesSettingsSD.mjs";
import { getTravelSpeeds } from "./TravelSpeedsSettingsSD.mjs";
import { getCustomLightSources } from "../canvas/light-templates.mjs";
import {
	isPartyTravelMutationAuthorized,
	planPartyTravelMutation,
	planWeatherPredictionMutation,
} from "./PartyTravelMutationsSD.mjs";
import { PartyTravel } from "./partytravel.mjs";
import { PartyXp } from "./partyxp.mjs";
import { PartyInventory } from "./partyinventory.mjs";

const MODULE_ID = "shadowdark-extras";

// Unidentified-item helpers moved to party-unidentified.mjs (Phase 5.1 split).
import { isItemUnidentified, getMaskedItemName } from "./party-unidentified.mjs";

/**
 * Get the configured camping/travel tasks
 * @returns {Array} Array of task objects with key, name, abilities, campfire, and bannerImage
 */
export function getCampingTasks() {
	return getTravelActivities();
}

async function getPartyMemberActor(memberKey) {
	if (!memberKey) return null;
	const worldActor = game.actors.get(memberKey);
	if (worldActor) return worldActor;
	if (!memberKey.includes(".")) return null;
	try {
		return await fromUuid(memberKey);
	}
	catch{
		return null;
	}
}

/**
 * Party Actor Sheet
 * Extends the base ActorSheet to provide party management functionality
 */
export default class PartySheetSD extends (foundry.appv1?.sheets?.ActorSheet || ActorSheet) {

	/**
	 * Apply one validated Party travel mutation on the authoritative client.
	 * The socket handler calls this with the sending user, never the active GM,
	 * so ownership is checked against the player who made the request.
	 *
	 * @param {Actor} partyActor
	 * @param {Object} request
	 * @param {User} requestingUser
	 * @returns {Promise<Object>}
	 */
	static async applyPartyTravelMutation(
		partyActor,
		request,
		requestingUser = game.user
	) {
		if (
			!partyActor
			|| partyActor.type !== "NPC"
			|| partyActor.getFlag(MODULE_ID, "isParty") !== true
		) {
			throw new Error("Invalid Party actor");
		}
		if (!requestingUser) throw new Error("Unknown requesting user");

		const storedMemberKeys = partyActor.getFlag(MODULE_ID, "members");
		const memberKeys = Array.isArray(storedMemberKeys)
			? storedMemberKeys
			: [];
		const userOwnsMember = async memberKey => {
			const member = await getPartyMemberActor(memberKey);
			return Boolean(
				member?.testUserPermission?.(requestingUser, "OWNER")
			);
		};
		const ownedMemberKeys = [];
		if (!requestingUser.isGM) {
			const candidates = request.operation === "weatherPrediction"
				? memberKeys
				: [request.memberId];
			for (const memberKey of candidates) {
				if (await userOwnsMember(memberKey)) {
					ownedMemberKeys.push(memberKey);
				}
			}
		}
		const authorized = isPartyTravelMutationAuthorized({
			isGM: requestingUser.isGM,
			memberKeys,
			ownedMemberKeys,
			operation: request.operation,
			memberId: request.memberId,
		});

		if (request.operation === "weatherPrediction") {
			if (!authorized) throw new Error("Not authorized to use Party weather");

			const prediction = partyActor.getFlag(
				MODULE_ID,
				"campingWeatherReroll"
			);
			const planned = planWeatherPredictionMutation(
				prediction,
				request.action
			);
			const key = `flags.${MODULE_ID}.campingWeatherReroll`;
			await partyActor.update({
				[key]: planned.value
					?? new foundry.data.operators.ForcedDeletion(),
			});
			return { ok: true, uses: planned.uses };
		}

		const memberId = request.memberId;
		if (!memberKeys.includes(memberId)) {
			throw new Error("Actor is not a member of this Party");
		}
		if (!authorized) {
			throw new Error("Not authorized to change that Party member");
		}

		const assignments = partyActor.getFlag(
			MODULE_ID,
			"travelAssignments"
		) ?? {};
		const selections = partyActor.getFlag(
			MODULE_ID,
			"travelSelections"
		) ?? {};
		const planned = planPartyTravelMutation(
			{ assignments, selections },
			request,
			getCampingTasks()
		);
		const base = `flags.${MODULE_ID}`;
		const updates = {
			[`${base}.travelAssignments`]: planned.assignments,
		};

		// World actor IDs are safe dot paths and can update atomically. A
		// compendium UUID contains dots, so replace that selections object
		// instead of letting Foundry interpret the UUID as nested properties.
		if (memberId.includes(".")) {
			await partyActor.update({
				...updates,
				[`${base}.travelSelections`]:
					new foundry.data.operators.ForcedDeletion(),
			});
			await partyActor.setFlag(
				MODULE_ID,
				"travelSelections",
				planned.selections
			);
			return { ok: true };
		}

		if (request.operation === "selectTask") {
			for (const key of Object.keys(selections)) {
				updates[`${base}.travelSelections.${key}.${memberId}`] =
					new foundry.data.operators.ForcedDeletion();
			}
			if (request.taskKey) {
				updates[
					`${base}.travelSelections.${request.taskKey}.${memberId}`
				] = 0;
			}
		}
		else {
			updates[
				`${base}.travelSelections.${request.taskKey}.${memberId}`
			] = planned.selections[request.taskKey][memberId];
		}

		await partyActor.update(updates);
		return { ok: true };
	}

	/** @inheritdoc */
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["shadowdark", "sheet", "party", "shadowdark-extras-party"],
			width: 750,
			height: 650,
			resizable: true,
			tabs: [
				{
					navSelector: ".SD-nav",
					contentSelector: ".SD-content-body",
					initial: "tab-members",
				},
			],
			dragDrop: [{ dragSelector: ".item-list .item, .member, .sdx-task-member", dropSelector: null }],
		});
	}

	/** @inheritdoc */
	get template() {
		return `modules/${MODULE_ID}/templates/party.hbs`;
	}

	/** @inheritdoc */
	get title() {
		return this.actor.name;
	}

	/**
	 * Get an actor from a member key (ID or UUID)
	 * @param {string} memberKey - Actor ID or UUID
	 * @returns {Promise<Actor|null>}
	 */
	async _getActorFromKey(memberKey) {
		if (!memberKey) return null;
		// Try as world actor ID first
		let actor = game.actors.get(memberKey);
		if (actor) return actor;
		// Try as UUID (compendium or other)
		if (memberKey.includes(".")) {
			try {
				actor = await fromUuid(memberKey);
			}
			catch{
				// Ignore errors
			}
		}
		return actor || null;
	}

	/**
	 * Get the members of this party (synchronous, world actors only)
	 * For compendium support, use getMembers() instead
	 * @returns {Actor[]} Array of member actors
	 */
	get members() {
		const memberIds = this.actor.getFlag(MODULE_ID, "members") ?? [];
		return memberIds
			.map(id => {
				// Try as world actor ID first
				const worldActor = game.actors.get(id);
				if (worldActor) return worldActor;
				// For UUIDs stored as IDs, try fromUuidSync (available in V11+)
				if (typeof fromUuidSync === "function" && id.includes(".")) {
					try {
						return fromUuidSync(id);
					}
					catch{
						return null;
					}
				}
				return null;
			})
			.filter(actor => actor && (actor.type === "Player" || actor.type === "NPC"));
	}

	/**
	 * Get the members of this party (async, supports compendium actors)
	 * @returns {Promise<Actor[]>} Array of member actors
	 */
	async getMembers() {
		const memberIds = this.actor.getFlag(MODULE_ID, "members") ?? [];
		const members = [];
		for (const id of memberIds) {
			let actor = null;
			// Try as world actor ID first
			actor = game.actors.get(id);
			if (!actor && id.includes(".")) {
				// Try as UUID (compendium or other)
				try {
					actor = await fromUuid(id);
				}
				catch{
					// Ignore errors
				}
			}
			if (actor && (actor.type === "Player" || actor.type === "NPC")) {
				members.push(actor);
			}
		}
		return members;
	}

	get memberIds() {
		return this.actor.getFlag(MODULE_ID, "members") ?? [];
	}

	/** @inheritdoc */
	async getData(options) {
		const context = await super.getData(options);

		context.config = CONFIG.SHADOWDARK;
		context.cssClass = this.actor.isOwner ? "editable" : "locked";
		context.editable = this.isEditable;
		context.owner = this.actor.isOwner;
		context.isGM = game.user.isGM;

		// Get party members data
		const memberData = await this._prepareMembers();
		context.members = memberData.all;
		context.players = memberData.players;
		context.npcs = memberData.npcs;
		context.memberCount = context.members.length;

		// Get party stats (aggregated)
		context.partyStats = this._calculatePartyStats(context.members);

		// Get shared inventory
		context.inventory = this._prepareInventory();
		context.coins = this._getPartyCoins();
		context.coinSlots = this._calculateCoinSlots();

		// Inventory slot usage (same calculation as Shadowdark player sheet)
		const maxSlotsDefault = Number(CONFIG?.SHADOWDARK?.DEFAULTS?.GEAR_SLOTS);
		const maxSlots = Number(this.actor.getFlag(MODULE_ID, "partyMaxSlots"));
		context.inventorySlots = {
			used: this._calculateInventorySlotsUsed(),
			max: Number.isFinite(maxSlots) ? maxSlots : (Number.isFinite(maxSlotsDefault) ? maxSlotsDefault : 10),
		};
		context.inventorySlots.over = context.inventorySlots.used > context.inventorySlots.max;

		// Get party description (use namespaced TextEditor when available)
		const enrichHTML = foundry?.applications?.ux?.TextEditor?.implementation?.enrichHTML ?? TextEditor.enrichHTML;
		context.descriptionHTML = await enrichHTML(
			this.actor.getFlag(MODULE_ID, "description") ?? "",
			{
				secrets: this.actor.isOwner,
				async: true,
				relativeTo: this.actor,
			}
		);

		// Prepare camping tasks for Travel tab

		context.campingTasks = await this._prepareCampingTasks(context.members);
		context.campingMembers = this._prepareCampingMemberSelectors(context.members);

		// Prepare travel speeds for Travel tab
		const selectedSpeed = this.actor.getFlag(MODULE_ID, "travelSpeed") ?? "normal";
		context.travelSpeeds = getTravelSpeeds().map(speed => ({
			...speed,
			selected: speed.key === selectedSpeed,
		}));

		return context;
	}

	/**
	 * Prepare member data for display
	 * @returns {Promise<Object[]>}
	 */
	async _prepareMembers() {
		const members = await this.getMembers();
		const memberData = [];
		const players = [];
		const npcs = [];

		for (const member of members) {
			if (!member) continue;
			const isNPC = member.type === "NPC";
			const slotsUsed = isNPC ? 0 : this._calculateActorInventorySlotsUsed(member);
			// Use the actor's system.slots which correctly calculates max slots
			// based on STR, talents (like Hauler), and effects
			const slotsMax = isNPC ? 0 : (member.system?.slots ?? 10);
			const slotsFree = Math.max(0, slotsMax - slotsUsed);

			// Use UUID for compendium actors, ID for world actors (consistent with storage)
			const isCompendiumActor = member.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? member.uuid : member.id;

			const data = {
				id: member.id,
				uuid: member.uuid,
				memberKey, // The key used for storage (ID or UUID)
				name: member.name,
				img: member.img,
				isNPC,
				isCompendiumActor,
				spawnFormula: isNPC ? this._getNpcSpawnFormula(memberKey) : null,
				hp: {
					value: member.system?.attributes?.hp?.value ?? 0,
					max: member.system?.attributes?.hp?.max ?? 0,
				},
				ac: member.system?.attributes?.ac?.value ?? 0,
				level: isNPC ? null : (member.system?.level?.value ?? 1),
				xp: {
					current: member.system?.level?.xp ?? 0,
					next: (member.system?.level?.value ?? 1) * 10,  // Shadowdark: 10 XP per level
				},
				className: await this._getMemberClassName(member),
				ancestryName: await this._getMemberAncestryName(member),
				isOwner: member.isOwner,
				// Calculate HP percentage for visual bar
				hpPercent: Math.round(((member.system?.attributes?.hp?.value ?? 0) / (member.system?.attributes?.hp?.max ?? 1)) * 100) || 0,
				// Wave translate: HP% - 15 = translateY% (100% HP = 85% hidden, 0% HP = visible)
				hpWaveTranslate: Math.max(0, Math.round(((member.system?.attributes?.hp?.value ?? 0) / (member.system?.attributes?.hp?.max ?? 1)) * 100) - 15) || 0,
				// HP wave color based on ancestry (resolved name)
				hpWaveColor: getHpWaveColor(member, await this._getMemberAncestryName(member)),
				// HP waves enabled
				hpWavesEnabled: isHpWavesEnabled(),
				// HP wave CSS class
				hpWaveClass: (() => {
					const hpVal = member.system?.attributes?.hp?.value ?? 0;
					const hpMax = member.system?.attributes?.hp?.max ?? 1;
					const pct = Math.round((hpVal / hpMax) * 100) || 0;
					if (pct >= 100) return "hp-full";
					if (pct <= 0) return "hp-dead";
					return "";
				})(),
				// Active effects
				effects: member.effects.filter(e => !e.disabled).map(e => ({
					id: e.id,
					name: e.name,
					img: e.img || "icons/svg/aura.svg",
				})),
				slots: {
					used: slotsUsed,
					max: slotsMax,
					free: slotsFree,
				},
				// Ability modifiers
				abilities: {
					str: member.system.abilities?.str?.mod ?? this._calculateMod(member.system.abilities?.str?.value ?? 10),
					dex: member.system.abilities?.dex?.mod ?? this._calculateMod(member.system.abilities?.dex?.value ?? 10),
					con: member.system.abilities?.con?.mod ?? this._calculateMod(member.system.abilities?.con?.value ?? 10),
					int: member.system.abilities?.int?.mod ?? this._calculateMod(member.system.abilities?.int?.value ?? 10),
					wis: member.system.abilities?.wis?.mod ?? this._calculateMod(member.system.abilities?.wis?.value ?? 10),
					cha: member.system.abilities?.cha?.mod ?? this._calculateMod(member.system.abilities?.cha?.value ?? 10),
				},
			};

			memberData.push(data);
			if (isNPC) npcs.push(data);
			else players.push(data);
		}

		return { all: memberData, players, npcs };
	}

	/**
	 * Calculate ability modifier from score
	 * @param {number} score
	 * @returns {number}
	 */
	_calculateMod(score) {
		if (score >= 1 && score <= 3) return -4;
		if (score >= 4 && score <= 5) return -3;
		if (score >= 6 && score <= 7) return -2;
		if (score >= 8 && score <= 9) return -1;
		if (score >= 10 && score <= 11) return 0;
		if (score >= 12 && score <= 13) return 1;
		if (score >= 14 && score <= 15) return 2;
		if (score >= 16 && score <= 17) return 3;
		if (score >= 18) return 4;
		return 0;
	}

	/**
	 * Get member's class name
	 * @param {Actor} member
	 * @returns {Promise<string>}
	 */
	async _getMemberClassName(member) {
		if (!member.system.class) return "";
		const classItem = await fromUuid(member.system.class);
		return classItem?.name ?? "";
	}

	/**
	 * Get the ancestry name for a party member
	 * @param {Actor} member
	 * @returns {Promise<string>}
	 */
	async _getMemberAncestryName(member) {
		if (!member.system.ancestry) return "";
		const ancestryItem = await fromUuid(member.system.ancestry);
		return ancestryItem?.name ?? "";
	}

	/**
	 * Calculate aggregated party statistics
	 * @param {Object[]} members
	 * @returns {Object}
	 */
	_calculatePartyStats(members) {
		if (members.length === 0) {
			return {
				totalHp: 0,
				maxHp: 0,
				avgAc: 0,
				avgLevel: 0,
			};
		}

		const totalHp = members.reduce((sum, m) => sum + m.hp.value, 0);
		const maxHp = members.reduce((sum, m) => sum + m.hp.max, 0);
		const avgAc = Math.round(members.reduce((sum, m) => sum + m.ac, 0) / members.length);
		const levelMembers = members.filter(m => !m.isNPC && Number.isFinite(Number(m.level)));
		const avgLevel = levelMembers.length
			? Math.round(levelMembers.reduce((sum, m) => sum + Number(m.level), 0) / levelMembers.length)
			: 0;

		return { totalHp, maxHp, avgAc, avgLevel };
	}

	/**
	 * Prepare camping tasks data for the Travel tab
	 * @param {Object[]} membersData - Prepared members data
	 * @returns {Promise<Object[]>}
	 */
	async _prepareCampingTasks(membersData) {
		const assignments = this.actor.getFlag(MODULE_ID, "travelAssignments") ?? {};
		const dcs = this.actor.getFlag(MODULE_ID, "travelDCs") ?? {};
		const selections = this.actor.getFlag(MODULE_ID, "travelSelections") ?? {};
		const campingTasks = getCampingTasks();

		return campingTasks.map(task => {
			const dc = dcs[task.key] ?? 12;
			const assignedMemberIds = assignments[task.key] ?? [];
			const assignedMembers = assignedMemberIds
				.map(memberId => membersData.find(m => m.memberKey === memberId || m.id === memberId))
				.filter(m => m !== undefined);

			// Filter out empty strings from abilities
			const abilities = (task.abilities || []).filter(ab => ab && ab.trim());
			return {
				key: task.key,
				name: task.name,
				abilities: abilities,
				abilitiesText: abilities.join(" / "),
				campfire: task.campfire,
				description: task.description || "",
				bannerImage: task.bannerImage || "",
				dc,
				assignedMembers: assignedMembers.map(m => {
					const selectionIdx = selections[task.key]?.[m.memberKey] ?? 0;
					const selectedAbility = abilities[selectionIdx] || abilities[0] || "";
					return {
						...m,
						isOwner: this._canUserMoveMember(m),
						selectedAbility: selectedAbility.toUpperCase(),
						selectionIdx,
					};
				}),
			};
		});
	}

	/**
	 * Prepare one task and ability selector for each player. These selectors
	 * update the same assignment flags as drag-and-drop.
	 * @param {Object[]} membersData
	 * @returns {Object[]}
	 */
	_prepareCampingMemberSelectors(membersData) {
		const assignments = this.actor.getFlag(MODULE_ID, "travelAssignments") ?? {};
		const selections = this.actor.getFlag(MODULE_ID, "travelSelections") ?? {};
		const tasks = getCampingTasks();

		return membersData
			.filter(member => !member.isNPC)
			.map(member => {
				const task = tasks.find(entry =>
					(assignments[entry.key] ?? []).includes(member.memberKey)
				);
				const selectedIndex = Number(
					selections[task?.key]?.[member.memberKey] ?? 0
				);

				return {
					...member,
					canChoose: this._canUserMoveMember(member),
					taskKey: task?.key ?? "",
					taskOptions: tasks.map(entry => ({
						key: entry.key,
						name: entry.name,
						selected: entry.key === task?.key,
					})),
					abilityOptions: (task?.abilities ?? []).map((ability, index) => ({
						index,
						name: ability,
						selected: index === selectedIndex,
					})),
				};
			});
	}

	/**
	 * Check if current user can move a member in travel assignments
	 * @param {Object} memberData - Member data object
	 * @returns {boolean}
	 */
	_canUserMoveMember(memberData) {
		if (game.user.isGM) return true;
		if (!memberData) return false;
		// Check if user owns the actor
		const actor = game.actors.get(memberData.id);
		return actor?.isOwner ?? false;
	}

	_onDragStart(event) {
		const target = event.currentTarget;

		// Check if this is a member being dragged (for dropping on canvas to create token)
		if (target.classList.contains("member") || target.closest(".member") || target.classList.contains("sdx-task-member") || target.closest(".sdx-task-member")) {
			const memberEl = target.closest(".member") || target.closest(".sdx-task-member");
			const uuid = memberEl?.dataset?.uuid;

			if (uuid) {
				// Set drag data as Actor type so Foundry creates a token on canvas drop
				const dragData = {
					type: "Actor",
					uuid: uuid,
				};
				event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
				return;
			}
		}

		// Fall back to default behavior for items
		return super._onDragStart(event);
	}

	/** @inheritdoc */
	async _onDrop(event) {
		const getDragEventData = foundry?.applications?.ux?.TextEditor?.implementation?.getDragEventData ?? TextEditor.getDragEventData;
		const data = getDragEventData(event);

		// Handle drop on travel task
		const travelTarget = event.target.closest(".sdx-camping-task");
		if (travelTarget && data?.type === "Actor") {
			event.preventDefault(); // Stop propagation
			const taskKey = travelTarget.dataset.taskKey;

			if (!taskKey) return;

			// Get the actor
			const dropped = data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
			if (!dropped) return;

			// Check if actor is in party
			// Use UUID for compendium actors, ID for world actors to match storage
			const isCompendiumActor = dropped.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? dropped.uuid : dropped.id;

			if (!this.memberIds.includes(memberKey)) {
				ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.warn_not_member"));
				return;
			}

			// Check ownership
			if (!dropped.isOwner && !game.user.isGM) {
				ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.warn_not_owner"));
				return;
			}

			// Assign to task
			await this._assignMemberToTask(taskKey, memberKey);
			return;
		}

		if (data?.type === "Actor") {
			if (!this.actor.isOwner) return;
			const dropped = data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
			if (!dropped) return;
			if (dropped.type !== "Player" && dropped.type !== "NPC") return;
			if (dropped.id === this.actor.id) return;

			// Use UUID for compendium actors, ID for world actors
			// Compendium UUIDs contain "Compendium." prefix
			const isCompendiumActor = dropped.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? dropped.uuid : dropped.id;

			// Check if already a member - handle reordering
			if (this.memberIds.includes(memberKey)) {
				const targetMemberEl = event.target.closest(".member");
				if (targetMemberEl) {
					const targetKey = targetMemberEl.dataset.memberId;
					if (targetKey && targetKey !== memberKey) {
						await this._reorderMember(memberKey, targetKey);
					}
				}
				return;
			}

			// Enforce sorting on add (Players first)
			// We need to fetch all members to sort them
			const currentMembers = await this.getMembers();
			const newMember = dropped;
			const allMembers = [...currentMembers, newMember];

			allMembers.sort((a, b) => {
				if (a.type === "Player" && b.type === "NPC") return -1;
				if (a.type === "NPC" && b.type === "Player") return 1;
				return 0;
			});

			const nextIds = allMembers.map(m => m.uuid?.startsWith("Compendium.") ? m.uuid : m.id);

			await this.actor.setFlag(MODULE_ID, "members", nextIds);
			if (dropped.type === "NPC") {
				const counts = this._getNpcSpawnCounts();
				// Use the same key for NPC spawn counts
				if (counts[memberKey] === undefined) await this._setNpcSpawnFormula(memberKey, "1");
			}
			return;
		}

		return super._onDrop(event);
	}

	/**
	 * Reorder a member in the list
	 * @param {string} sourceKey
	 * @param {string} targetKey
	 */
	async _reorderMember(sourceKey, targetKey) {
		const members = await this.getMembers();
		const sourceIndex = members.findIndex(m => (m.uuid === sourceKey || m.id === sourceKey));
		if (sourceIndex === -1) return;

		const sourceMember = members[sourceIndex];

		// Remove source
		members.splice(sourceIndex, 1);

		// Find target index in the array without source
		// We need to check uuid or id
		const targetIndex = members.findIndex(m => (m.uuid === targetKey || m.id === targetKey));

		if (targetIndex !== -1) {
			members.splice(targetIndex, 0, sourceMember);
		}
		else {
			members.push(sourceMember);
		}

		// Enforce Player -> NPC sorting
		members.sort((a, b) => {
			if (a.type === "Player" && b.type === "NPC") return -1;
			if (a.type === "NPC" && b.type === "Player") return 1;
			return 0;
		});

		const nextIds = members.map(m => m.uuid?.startsWith("Compendium.") ? m.uuid : m.id);
		await this.actor.setFlag(MODULE_ID, "members", nextIds);
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Member interactions
		html.find("[data-action='open-member']").click(this._onOpenMember.bind(this));
		html.find("[data-action='remove-member']").click(this._onRemoveMember.bind(this));
		html.find("[data-action='place-members']").click(this._onPlaceMembers.bind(this));
		html.find("[data-action='reward-xp']").click(this._onRewardXp.bind(this));
		html.find("[data-action='reward-coins']").click(this._onRewardCoins.bind(this));
		html.find("[data-action='sync-lights']").click(this._onSyncLights.bind(this));
		html.find("[data-action='roll-weather']").click(this._onRollWeather.bind(this));
		html.find("[data-action='configure-weather']").click(this._onConfigureWeather.bind(this));
		html.find("[data-action='change-travel-speed']").change(this._onChangeTravelSpeed.bind(this));

		// XP controls
		html.find("[data-action='xp-increment']").click(this._onXpIncrement.bind(this));
		html.find("[data-action='xp-decrement']").click(this._onXpDecrement.bind(this));

		// NPC spawn count controls
		html.find("[data-action='npc-count-increment']").click(this._onNpcCountIncrement.bind(this));
		html.find("[data-action='npc-count-decrement']").click(this._onNpcCountDecrement.bind(this));
		html.find("[data-action='npc-count-change']").change(this._onNpcCountChange.bind(this));

		// Inventory interactions
		html.find("[data-action='create-item']").click(this._onCreateItem.bind(this));
		html.find("[data-action='configure-party-slots']").click(this._onConfigurePartySlots.bind(this));
		html.find("[data-action='item-increment']").click(this._onItemIncrement.bind(this));
		html.find("[data-action='item-decrement']").click(this._onItemDecrement.bind(this));
		html.find("[data-action='toggle-light']").click(this._onToggleLightSource.bind(this));
		html.find(".item-image").click(this._onItemChat.bind(this));
		html.find(".item-name[data-action='show-details']").click(
			event => shadowdark.utils.toggleItemDetails(event.currentTarget)
		);

		// Item context menu
		this._itemContextMenu(html.get(0));

		// Coin inputs
		html.find(".coin-value").change(this._onCoinChange.bind(this));
		html.find("[data-action='add-coins']").click(this._onAddCoins.bind(this));
		html.find("[data-action='divide-coins']").click(this._onDivideCoins.bind(this));

		// Description editing
		html.find("[data-action='edit-description']").click(this._onEditDescription.bind(this));

		// Travel Tab interactions
		html.find("[data-action='reset-travel']").click(this._onResetTravel.bind(this));
		html.find("[data-action='remove-travel-member']").click(this._onRemoveTravelMember.bind(this));
		html.find("[data-action='select-travel-task']").change(
			this._onSelectTravelTask.bind(this)
		);
		html.find("[data-action='select-travel-ability']").change(
			this._onSelectTravelAbility.bind(this)
		);
		html.find("[data-action='begin-camping-rest']").click(
			this._onBeginCampingRest.bind(this)
		);

		// Travel Rolling

		html.find(".sdx-task-dc").change(this._onChangeTravelDC.bind(this));
		html.find(".sdx-task-header").click(this._onRollTravelTask.bind(this));
		html.find(".sdx-task-member").contextmenu(this._onToggleTravelAbility.bind(this));
	}

	async _onConfigurePartySlots(event) {
		event.preventDefault();
		if (!this.actor.isOwner) return;

		const currentRaw = Number(this.actor.getFlag(MODULE_ID, "partyMaxSlots"));
		const defaultRaw = Number(CONFIG?.SHADOWDARK?.DEFAULTS?.GEAR_SLOTS);
		const current = Number.isFinite(currentRaw) ? currentRaw : (Number.isFinite(defaultRaw) ? defaultRaw : 10);

		const title = game.i18n.localize("SHADOWDARK_EXTRAS.party.slots.configure_title");
		const content = `
			<form class="shadowdark-extras-party-slots">
				<div class="form-group">
					<label>${game.i18n.localize("SHADOWDARK_EXTRAS.party.slots.max_label")}</label>
					<input type="number" name="maxSlots" value="${current}" min="0" step="1" />
				</div>
			</form>
		`;

		const result = await new Promise(resolve => {
			new foundry.applications.api.DialogV2({
				window: { title },
				content,
				buttons: [
					{
						action: "save",
						label: game.i18n.localize("SHADOWDARK_EXTRAS.party.save"),
						default: true,
						callback: (event, button) => {
							const value = Number(button.form.elements.maxSlots.value);
							resolve(value);
						},
					},
					{
						action: "cancel",
						label: game.i18n.localize("SHADOWDARK_EXTRAS.party.cancel"),
						callback: () => resolve(null),
					},
				],
				close: () => resolve(null),
			}).render({ force: true });
		});

		if (result === null) return;
		const next = Math.max(0, Math.floor(Number(result) || 0));
		await this.actor.setFlag(MODULE_ID, "partyMaxSlots", next);
		this.render();
	}

	/**
	 * Create item context menu
	 * @param {HTMLElement} html
	 */
	_itemContextMenu(html) {
		new foundry.applications.ux.ContextMenu.implementation(
			html,
			".inventory-main .item",
			this._getItemContextOptions(),
			{ jQuery: false }
		);
	}

	/**
	 * Get context menu options for items
	 * @returns {Object[]}
	 */
	_getItemContextOptions() {
		return [
			{
				name: game.i18n.localize("SHADOWDARK.sheet.general.item_edit.title"),
				icon: '<i class="fas fa-edit"></i>',
				condition: () => this.actor.isOwner,
				callback: element => {
					const itemId = element.dataset.itemId;
					const item = this.actor.items.get(itemId);
					return item?.sheet.render(true);
				},
			},
			{
				name: game.i18n.localize("SHADOWDARK.sheet.general.item_delete.title"),
				icon: '<i class="fas fa-trash"></i>',
				condition: () => this.actor.isOwner,
				callback: element => {
					const itemId = element.dataset.itemId;
					this.actor.deleteEmbeddedDocuments("Item", [itemId]);
				},
			},
			{
				name: game.i18n.localize("SHADOWDARK_EXTRAS.party.transfer_to_member"),
				icon: '<i class="fas fa-share"></i>',
				condition: () => this.actor.isOwner && this.members.length > 0,
				callback: element => this._onTransferItem(element),
			},
		];
	}

	/**
	 * Handle dropping an actor onto the party sheet
	 * @inheritdoc
	 */
	async _onDropActor(event, data) {
		if (!this.actor.isOwner) return false;

		const actor = await fromUuid(data.uuid);
		if (!actor) return false;

		// Only allow Player and NPC type actors
		if (actor.type !== "Player" && actor.type !== "NPC") {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.only_players"));
			return false;
		}

		// Use UUID for compendium actors, ID for world actors
		const isCompendiumActor = actor.uuid?.startsWith("Compendium.");
		const memberKey = isCompendiumActor ? actor.uuid : actor.id;

		// Check if actor is already a member
		const memberIds = this.memberIds;
		if (memberIds.includes(memberKey)) {
			ui.notifications.info(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.already_member"));
			return false;
		}

		// Add member
		memberIds.push(memberKey);
		await this.actor.setFlag(MODULE_ID, "members", memberIds);

		// Set NPC spawn formula if NPC
		if (actor.type === "NPC") {
			const counts = this._getNpcSpawnCounts();
			if (counts[memberKey] === undefined) await this._setNpcSpawnFormula(memberKey, "1");
		}

		ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.party.member_added", { name: actor.name }));
		return true;
	}

	/**
	 * Handle dropping an item onto the party sheet
	 * @inheritdoc
	 */
	async _onDropItem(event, data) {
		if (!this.actor.isOwner) return false;

		const item = await fromUuid(data.uuid);
		if (!item) return false;

		// Check if item is being dropped on a member (for transfer)
		const memberElement = event.target.closest(".member[data-uuid]");
		if (memberElement) {
			const memberUuid = memberElement.dataset.uuid;
			const member = await fromUuid(memberUuid);
			if (member && member.isOwner) {
				const move = item.parent === this.actor;
				await this._transferItemToActor(item, member, { move });

				// Mask item name if unidentified and user is not GM
				const displayName = (isItemUnidentified(item) && !game.user.isGM)
					? getMaskedItemName(item)
					: item.name;

				ui.notifications.info(
					game.i18n.format("SHADOWDARK_EXTRAS.party.item_transferred", {
						item: displayName,
						member: member.name,
					})
				);
				return true;
			}
		}

		// Standard item drop to party inventory
		return super._onDropItem(event, data);
	}

	_isContainerItem(item) {
		return item?.type === "Basic" && Boolean(item.getFlag?.(MODULE_ID, "isContainer"));
	}

	_getContainedItems(containerItem) {
		const actor = containerItem?.parent;
		if (!actor) return [];
		return actor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === containerItem.id);
	}

	_calculateSlotsFromItemData(itemData) {
		const system = itemData?.system ?? {};
		const qty = Math.max(0, Number(system.quantity ?? 1) || 0);
		const perSlot = Math.max(1, Number(system.slots?.per_slot ?? 1) || 1);
		const slotsUsed = Math.max(0, Number(system.slots?.slots_used ?? 1) || 0);
		return Math.ceil(qty / perSlot) * slotsUsed;
	}

	async _transferItemToActor(item, targetActor, { move }) {
		if (!item || !targetActor) return;
		const targetIsItemPiles = Boolean(targetActor.getFlag?.("item-piles", "data")?.enabled);

		// Non-container: default behavior
		if (!this._isContainerItem(item) || !item.parent) {
			const itemData = item.toObject();
			await targetActor.createEmbeddedDocuments("Item", [itemData]);
			if (move) await item.delete();
			return;
		}

		// Container transfer/copy
		const contained = this._getContainedItems(item);
		const containerData = item.toObject();
		// Clear the packed items to prevent the createItem hook from unpacking them
		// (we will manually create the contained items from the source actor's embedded items)
		if (containerData.flags?.[MODULE_ID]) {
			containerData.flags[MODULE_ID].containerPackedItems = [];
			// Also clear the unpacked flags
			delete containerData.flags[MODULE_ID].containerUnpacked;
			delete containerData.flags[MODULE_ID].containerUnpackedOnActor;
		}
		const [createdContainer] = await targetActor.createEmbeddedDocuments("Item", [containerData]);
		if (!createdContainer) {
			if (move) return;
			return;
		}

		const childData = contained.map(child => {
			const data = child.toObject();
			data.flags = data.flags ?? {};
			data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
			data.flags[MODULE_ID].containerId = createdContainer.id;
			// Keep hidden while contained
			data.system = data.system ?? {};
			data.system.isPhysical = false;
			// Ensure we can restore if removed later
			if (data.flags[MODULE_ID].containerOrigIsPhysical === undefined) data.flags[MODULE_ID].containerOrigIsPhysical = true;
			// Let Foundry assign fresh IDs
			delete data._id;
			return data;
		});

		// If the target is an Item Piles actor, do not create embedded contained items.
		// Keep contents packed on the container item only.
		if (!targetIsItemPiles && childData.length) {
			await targetActor.createEmbeddedDocuments("Item", childData, { sdxInternal: true });
		}

		// For Item Piles targets, restore the packed items since we cleared them
		if (targetIsItemPiles && contained.length) {
			// Rebuild packed data from source contained items
			const packedData = contained.map(child => {
				const data = child.toObject();
				delete data._id;
				data.flags = data.flags ?? {};
				data.flags[MODULE_ID] = data.flags[MODULE_ID] ?? {};
				data.flags[MODULE_ID].containerId = null;
				data.system = data.system ?? {};
				data.system.isPhysical = false;
				return data;
			});
			await createdContainer.setFlag(MODULE_ID, "containerPackedItems", packedData);
		}

		// Update container slot cost to reflect contents
		const baseSlotsUsed = Number(createdContainer.system?.slots?.slots_used ?? 1) || 1;
		const containedSlots = childData.reduce((sum, d) => sum + this._calculateSlotsFromItemData(d), 0);
		await createdContainer.update({
			"system.slots.slots_used": Math.max(baseSlotsUsed, containedSlots),
		}, { sdxInternal: true });

		if (move) {
			// Delete children first so deleteItem hook doesn't try to "release" them
			for (const child of contained) {
				await child.delete({ sdxInternal: true });
			}
			await item.delete({ sdxInternal: true });
		}
	}

	/**
	 * Open a member's character sheet
	 * @param {Event} event
	 */
	async _onOpenMember(event) {
		event.preventDefault();
		const uuid = event.currentTarget.closest("[data-uuid]")?.dataset.uuid;
		if (!uuid) return;

		const actor = await fromUuid(uuid);
		actor?.sheet.render(true);
	}

	/**
	 * Remove a member from the party
	 * @param {Event} event
	 */
	async _onRemoveMember(event) {
		event.preventDefault();
		event.stopPropagation();

		if (!this.actor.isOwner) return;

		const memberElement = event.currentTarget.closest("[data-uuid]");
		const memberKey = memberElement?.dataset.memberId;
		if (!memberKey) return;

		// Get the actor - try world actor first, then UUID
		let member = game.actors.get(memberKey);
		if (!member && memberKey.includes(".")) {
			try {
				member = await fromUuid(memberKey);
			}
			catch{
				// Ignore
			}
		}
		const memberName = member?.name ?? "Unknown";

		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.remove_member") },
			content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.party.confirm_remove", { name: memberName })}</p>`,
			modal: true,
		});
		if (!confirmed) return;

		const memberIds = this.memberIds.filter(id => id !== memberKey);
		await this.actor.setFlag(MODULE_ID, "members", memberIds);

		if (member?.type === "NPC") {
			const counts = { ...this._getNpcSpawnCounts() };
			if (counts[memberKey] !== undefined) {
				delete counts[memberKey];
				await this.actor.setFlag(MODULE_ID, "npcSpawnCounts", counts);
			}
		}

		ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.party.member_removed", { name: memberName }));
	}

	async _onPlaceMembers(event) {
		event.preventDefault();

		if (!canvas.scene) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_scene"));
			return;
		}

		const allMembers = await this.getMembers();
		if (allMembers.length === 0) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_members"));
			return;
		}

		// Check what types of members we have
		const hasPlayers = allMembers.some(m => m.type === "Player");
		const hasNpcs = allMembers.some(m => m.type === "NPC");

		// If we have both types, show a selection dialog
		let filter = "all";
		if (hasPlayers && hasNpcs) {
			filter = await new Promise(resolve => {
				new foundry.applications.api.DialogV2({
					window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_tokens_title") },
					content: `<p>${game.i18n.localize("SHADOWDARK_EXTRAS.party.place_tokens_prompt")}</p>`,
					buttons: [
						{
							action: "all",
							icon: "fas fa-users",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_all"),
							default: true,
							callback: () => resolve("all"),
						},
						{
							action: "players",
							icon: "fas fa-user",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_players"),
							callback: () => resolve("players"),
						},
						{
							action: "npcs",
							icon: "fas fa-dragon",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.party.place_npcs"),
							callback: () => resolve("npcs"),
						},
					],
					close: () => resolve(null),
				}).render({ force: true });
			});

			if (!filter) return; // User closed the dialog
		}

		// Filter members based on selection
		const members = filter === "players" ? allMembers.filter(m => m.type === "Player")
			: filter === "npcs" ? allMembers.filter(m => m.type === "NPC")
				: allMembers;

		// Build list of members to place
		// PCs: place once. NPCs: roll configured formula and place that many.
		const membersToPlace = [];
		for (const member of members) {
			// Use UUID for compendium actors, ID for world actors
			const isCompendiumActor = member.uuid?.startsWith("Compendium.");
			const memberKey = isCompendiumActor ? member.uuid : member.id;

			if (member.type === "Player") {
				membersToPlace.push(member);
				continue;
			}
			if (member.type === "NPC") {
				const desired = await this._rollNpcSpawnDesiredCount(memberKey);
				for (let i = 0; i < desired; i++) membersToPlace.push(member);
			}
		}

		if (membersToPlace.length === 0) {
			ui.notifications.info(game.i18n.localize("SHADOWDARK_EXTRAS.party.all_members_present"));
			return;
		}

		// Minimize the sheet to allow canvas interaction
		this.minimize();

		let placedCount = 0;

		// Place each token one by one
		for (const member of membersToPlace) {
			const placed = await this._placeTokenWithPreview(member);
			if (placed) {
				placedCount++;
			}
			else {
				// User cancelled, stop placing
				break;
			}
		}

		// Restore the sheet
		this.maximize();

		if (placedCount > 0) {
			ui.notifications.info(
				game.i18n.format("SHADOWDARK_EXTRAS.party.members_placed", { count: placedCount })
			);
		}
	}

	/**
	 * Place a single token with crosshair preview
	 * @param {Actor} member - The actor to place
	 * @returns {Promise<boolean>} - Whether the token was placed
	 */
	async _placeTokenWithPreview(member) {
		// For compendium actors, we need to import them to the world first
		let actorToPlace = member;
		const isCompendiumActor = member.uuid?.startsWith("Compendium.");

		if (isCompendiumActor) {
			// Check if already imported by looking for an actor with same name and compendium source
			let existingActor = game.actors.find(a =>
				a.name === member.name
				&& a.flags?.core?.sourceId === member.uuid
			);

			if (!existingActor) {
				// Import the actor from compendium
				try {
					const imported = await Actor.implementation.create(member.toObject());
					if (imported) {
						// Record the compendium source on the imported actor without using the deprecated core.sourceId flag
						try {
							await imported.update({ "_stats.compendiumSource": member.uuid });
						}
						catch{
							// Fallback to writing the legacy flag if update fails for any reason
							await imported.setFlag("core", "sourceId", member.uuid);
						}
						existingActor = imported;
						ui.notifications.info(
							game.i18n.format("SHADOWDARK_EXTRAS.party.actor_imported", { name: member.name })
						);
					}
				}
				catch(e) {
					console.error(`${MODULE_ID} | Failed to import compendium actor`, e);
					ui.notifications.error(
						game.i18n.format("SHADOWDARK_EXTRAS.party.import_failed", { name: member.name })
					);
					return false;
				}
			}

			if (!existingActor) {
				ui.notifications.error(
					game.i18n.format("SHADOWDARK_EXTRAS.party.import_failed", { name: member.name })
				);
				return false;
			}

			actorToPlace = existingActor;
		}

		// Get the token document for this actor
		const tokenDocument = await actorToPlace.getTokenDocument();
		const tokenData = tokenDocument.toObject();

		// Create a preview token sprite for the cursor
		const texture = await loadTexture(tokenData.texture.src);
		const preview = new PIXI.Sprite(texture);
		const gridSize = canvas.grid.size;
		const tokenSize = tokenData.width * gridSize;

		preview.anchor.set(0.5);
		preview.width = tokenSize;
		preview.height = tokenSize;
		preview.alpha = 0.7;
		preview.visible = false;

		canvas.stage.addChild(preview);

		return new Promise(resolve => {
			// Show placement instructions
			ui.notifications.info(
				game.i18n.format("SHADOWDARK_EXTRAS.party.place_member_instruction", { name: member.name })
			);

			const onMouseMove = event => {
				const pos = event.data.getLocalPosition(canvas.stage);
				// Snap to grid
				const snapped = canvas.grid.getSnappedPoint({ x: pos.x, y: pos.y }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER });
				preview.position.set(snapped.x + tokenSize / 2, snapped.y + tokenSize / 2);
				preview.visible = true;
			};

			const onClick = async event => {
				// Left click to place
				const pos = event.data.getLocalPosition(canvas.stage);
				const snapped = canvas.grid.getSnappedPoint({ x: pos.x, y: pos.y }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER });

				// Cleanup
				canvas.stage.off("mousemove", onMouseMove);
				canvas.stage.off("mousedown", onClick);
				canvas.stage.off("rightdown", onRightClick);
				canvas.stage.removeChild(preview);
				preview.destroy();

				// Create the token
				tokenData.x = snapped.x;
				tokenData.y = snapped.y;
				await canvas.scene.createEmbeddedDocuments("Token", [tokenData]);

				resolve(true);
			};

			const onRightClick = event => {
				// Right click to cancel
				canvas.stage.off("mousemove", onMouseMove);
				canvas.stage.off("mousedown", onClick);
				canvas.stage.off("rightdown", onRightClick);
				canvas.stage.removeChild(preview);
				preview.destroy();

				resolve(false);
			};

			const onKeyDown = event => {
				if (event.key === "Escape") {
					canvas.stage.off("mousemove", onMouseMove);
					canvas.stage.off("mousedown", onClick);
					canvas.stage.off("rightdown", onRightClick);
					canvas.stage.removeChild(preview);
					preview.destroy();
					document.removeEventListener("keydown", onKeyDown);
					resolve(false);
				}
			};

			canvas.stage.on("mousemove", onMouseMove);
			canvas.stage.on("mousedown", onClick);
			canvas.stage.on("rightdown", onRightClick);
			document.addEventListener("keydown", onKeyDown);
		});
	}

	/**
	 * Edit party description
	 * @param {Event} event
	 */
	async _onEditDescription(event) {
		event.preventDefault();

		const currentDescription = this.actor.getFlag(MODULE_ID, "description") ?? "";

		new foundry.applications.api.DialogV2({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.edit_description") },
			content: `
				<form>
					<div class="form-group stacked">
						<label>${game.i18n.localize("SHADOWDARK_EXTRAS.party.description")}</label>
						<textarea name="description" rows="10" style="width: 100%; min-height: 200px;">${currentDescription}</textarea>
					</div>
				</form>
			`,
			buttons: [
				{
					action: "save",
					icon: "fas fa-save",
					label: game.i18n.localize("SHADOWDARK_EXTRAS.party.save"),
					default: true,
					callback: async (event, button) => {
						const description = button.form.elements.description.value;
						await this.actor.setFlag(MODULE_ID, "description", description);
					},
				},
				{
					action: "cancel",
					icon: "fas fa-times",
					label: game.i18n.localize("SHADOWDARK_EXTRAS.party.cancel"),
				},
			],
		}).render({ force: true });
	}

	async _onChangeTravelSpeed(event) {
		event.preventDefault();
		const speedKey = event.currentTarget.value;
		await this.actor.setFlag(MODULE_ID, "travelSpeed", speedKey);
	}
}

/**
 * Register the GM-side handler for player-initiated Party travel writes.
 *
 * Extracted from the composition root in Phase 3. It lives here because this
 * file already owns both other sides of the exchange: `applyPartyTravelMutation`
 * is the authority it calls, and `_requestPartyTravelMutation` is the sender
 * that reaches it via `executeAsGM("sdxMutatePartyTravel", …)`.
 *
 * The socket is passed in rather than fetched. The root registers all socket
 * handlers from one hook, synchronously with `ready`, so that none of them can
 * be delayed by unrelated work — taking the socket as an argument keeps that
 * the single place the ordering is decided.
 *
 * @param {object} socket - The module's socketlib socket.
 */
// Travel/camping + XP/NPC/reward + inventory/light handlers extracted to
// partytravel.mjs / partyxp.mjs / partyinventory.mjs (Phase 5.1 split) —
// merged as prototype mixins.
Object.assign(PartySheetSD.prototype, PartyTravel);
Object.assign(PartySheetSD.prototype, PartyXp);
Object.assign(PartySheetSD.prototype, PartyInventory);

export function registerPartyTravelSocket(socket) {
	// Player-facing Party task selectors write to a GM-owned Party actor.
	// Route those writes through the active GM while preserving ownership
	// checks against the user who actually sent the request.
	socket.register(
		"sdxMutatePartyTravel",
		async function(partyUuid, request) {
			const sender = game.users.get(this.socketdata?.userId);
			if (!sender) return {
				ok: false,
				error: game.i18n.localize(
					"SHADOWDARK_EXTRAS.party.travel.update_rejected"
				),
			};

			try {
				const partyActor = await fromUuid(partyUuid);
				return await PartySheetSD.applyPartyTravelMutation(
					partyActor,
					request,
					sender
				);
			}
			catch(error) {
				console.warn(
					`${MODULE_ID} | Rejected Party travel mutation from ${sender.name}:`,
					error
				);
				return {
					ok: false,
					error: game.i18n.localize(
						"SHADOWDARK_EXTRAS.party.travel.update_rejected"
					),
				};
			}
		}
	);
}

// ============================================
// PARTY TOKEN LIGHT SYNCHRONIZATION
// ============================================

/**
 * Get the brightest light source from all party members
 * @param {Actor} partyActor - The party actor
 * @returns {Promise<Object|null>} Light configuration or null if no lights
 */
export async function getBrightestPartyLight(partyActor) {
	if (!partyActor) return null;

	// Get party members
	const memberIds = partyActor.getFlag(MODULE_ID, "members") ?? [];
	// Include active shared light sources carried directly by the party actor.
	// Camping creates its temporary campfire there so the party token itself
	// emits the light while every member remains free to perform a task.
	const members = [partyActor];

	for (const id of memberIds) {
		let actor = game.actors.get(id);
		if (!actor && id.includes(".")) {
			try {
				actor = await fromUuid(id);
			}
			catch{
				continue;
			}
		}
		if (actor) members.push(actor);
	}

	// Find all active light sources from all members
	let brightestLight = null;
	let maxBright = -1;
	let maxDim = -1;

	for (const member of members) {
		console.log(`${MODULE_ID} | Checking member: ${member.name}`);
		// Check all items for light sources
		for (const item of member.items) {
			// Light sources are Basic or Effect items with light.isSource = true
			const isLightSource = ["Basic", "Effect"].includes(item.type) && item.system?.light?.isSource;
			const isActive = item.system?.light?.active;

			console.log(`${MODULE_ID} | Item: ${item.name}, type: ${item.type}, isLightSource: ${isLightSource}, isActive: ${isActive}`);

			if (isLightSource && isActive) {
				console.log(`${MODULE_ID} | Found active light: ${item.name}`, item.system.light);

				// Load Shadowdark's official light source mappings
				const templateName = item.system.light.template;
				let lightTemplate = null;

				try {
					const lightSources = await foundry.utils.fetchJsonWithTimeout(
						"systems/shadowdark/assets/mappings/map-light-sources.json"
					);
					lightTemplate = lightSources[templateName]?.light;
					console.log(`${MODULE_ID} | Loaded template '${templateName}' from Shadowdark mappings:`, lightTemplate);
				}
				catch(e) {
					console.warn(`${MODULE_ID} | Failed to load light mappings:`, e);
				}

				// If template not found in JSON, use fallback values
				if (!lightTemplate) {
					console.log(`${MODULE_ID} | Template '${templateName}' not in JSON, using fallback`);
					// Fallback values matching Shadowdark's actual light mappings
					const FALLBACK_TEMPLATES = {
						torch: { bright: 5, dim: 30, color: "#d1c846", alpha: 0.2, angle: 360 },
						lantern: { bright: 15, dim: 60, color: "#d1c846", alpha: 0.2, angle: 360 },
						lightSpellNear: { bright: 30, dim: 0, color: null, alpha: 0.2, angle: 360 },
						lightSpellDouble: { bright: 60, dim: 0, color: null, alpha: 0.2, angle: 360 },
					};

					// Merge custom templates
					const customSources = getCustomLightSources();
					for (const [key, source] of Object.entries(customSources)) {
						FALLBACK_TEMPLATES[key] = source.light;
					}

					lightTemplate = FALLBACK_TEMPLATES[templateName];
				}

				console.log(`${MODULE_ID} | Template: ${templateName}`, lightTemplate);

				// Get bright and dim from the template or item
				let bright = lightTemplate?.bright ?? item.system.light.bright ?? 0;
				let dim = lightTemplate?.dim ?? item.system.light.dim ?? 0;

				console.log(`${MODULE_ID} | Light values - bright: ${bright}, dim: ${dim}`);

				// Compare brightness (bright distance is primary, dim is tiebreaker)
				if (bright > maxBright || (bright === maxBright && dim > maxDim)) {
					maxBright = bright;
					maxDim = dim;

					// Build light configuration using template values or item values
					brightestLight = {
						bright: bright,
						dim: dim,
						angle: lightTemplate?.angle ?? item.system.light.angle ?? 360,
						color: lightTemplate?.color ?? item.system.light.color,
						alpha: lightTemplate?.alpha ?? item.system.light.alpha ?? 0.5,
						animation: lightTemplate?.animation ?? item.system.light.animation ?? {},
						darkness: item.system.light.darkness ?? {},
						attenuation: lightTemplate?.attenuation ?? item.system.light.attenuation ?? 0.5,
						luminosity: lightTemplate?.luminosity ?? item.system.light.luminosity ?? 0.5,
						saturation: lightTemplate?.saturation ?? item.system.light.saturation ?? 0,
						contrast: lightTemplate?.contrast ?? item.system.light.contrast ?? 0,
						shadows: lightTemplate?.shadows ?? item.system.light.shadows ?? 0,
						coloration: lightTemplate?.coloration ?? item.system.light.coloration ?? 1,
					};
					console.log(`${MODULE_ID} | New brightest light:`, brightestLight);
				}
			}
		}
	}

	return brightestLight;
}

/**
 * Sync party token lights with the brightest light from party members
 * @param {Actor} partyActor - The party actor
 */
export async function syncPartyTokenLight(partyActor) {
	console.log(`${MODULE_ID} | syncPartyTokenLight called with:`, partyActor);

	// Check if this is a party by looking for the members flag
	const hasMembers = partyActor?.getFlag(MODULE_ID, "members");
	console.log(`${MODULE_ID} | Has members flag:`, hasMembers);

	if (!partyActor || !hasMembers) {
		console.warn(`${MODULE_ID} | syncPartyTokenLight: Not a party actor (no members flag)`, partyActor);
		return;
	}

	console.log(`${MODULE_ID} | Syncing light for party: ${partyActor.name}`);

	// Get the brightest light from party members
	const brightestLight = await getBrightestPartyLight(partyActor);

	// Find all tokens for this party actor on the current scene
	const partyTokens = canvas?.tokens?.placeables?.filter(t => t.actor?.id === partyActor.id) ?? [];

	if (partyTokens.length === 0) {
		console.log(`${MODULE_ID} | No party tokens found on canvas for ${partyActor.name}`);
		return;
	}

	// Update each party token
	for (const token of partyTokens) {
		const updates = {};

		if (brightestLight) {
			// Enable light with brightest source configuration
			updates["light.dim"] = brightestLight.dim;
			updates["light.bright"] = brightestLight.bright;
			updates["light.angle"] = brightestLight.angle;
			updates["light.color"] = brightestLight.color;
			updates["light.alpha"] = brightestLight.alpha;
			updates["light.animation"] = brightestLight.animation;
			updates["light.darkness"] = brightestLight.darkness;
			updates["light.attenuation"] = brightestLight.attenuation;
			updates["light.luminosity"] = brightestLight.luminosity;
			updates["light.saturation"] = brightestLight.saturation;
			updates["light.contrast"] = brightestLight.contrast;
			updates["light.shadows"] = brightestLight.shadows;
			updates["light.coloration"] = brightestLight.coloration;

			console.log(`${MODULE_ID} | Party token ${token.name} light ON: ${brightestLight.bright}/${brightestLight.dim}`);
		}
		else {
			// No lights active - turn off party token light
			updates["light.dim"] = 0;
			updates["light.bright"] = 0;

			console.log(`${MODULE_ID} | Party token ${token.name} light OFF`);
		}

		await token.document.update(updates);
	}
}

/**
 * Find all parties that contain a given actor
 * @param {Actor} actor - The actor to search for
 * @returns {Actor[]} Array of party actors containing this member
 */
export function getPartiesContainingActor(actor) {
	if (!actor) return [];

	const parties = [];
	const actorKey1 = actor.id;
	const actorKey2 = actor.uuid;

	for (const potentialParty of game.actors) {
		// Check if this actor has party members (indicates it's a party)
		const memberIds = potentialParty.getFlag(MODULE_ID, "members");
		if (!memberIds) continue;

		if (memberIds.includes(actorKey1) || memberIds.includes(actorKey2)) {
			parties.push(potentialParty);
		}
	}

	return parties;
}

/**
 * Re-render any open party sheet when one of its members changes.
 *
 * Four hooks moved verbatim out of the composition root. They belong here
 * rather than in a new module because every one of them tests
 * `app instanceof PartySheetSD` — the class this file exports — so the
 * dependency already points this way (handoff rule 3).
 *
 * The four bodies are near-identical by nature: same window scan, same member
 * test, differing only in how the actor is reached. They are carried as they
 * were; de-duplicating them would be a rewrite, not a move.
 *
 * `updateActor`, `updateItem` and `deleteItem` are each registered more than
 * once in the root, so the root calls this from the exact position these four
 * occupied and relative order is preserved by the call site (rule 2).
 */
export function registerPartySheetRerenderHooks() {
	// Re-render party sheets when a member actor is updated
	Hooks.on("updateActor", (actor, changes, options, userId) => {
		// If a Player actor was updated, check if they're in any parties and re-render those sheets
		if (actor.type !== "Player") return;

		// Find all open party sheets that contain this actor as a member
		for (const app of Object.values(ui.windows)) {
			if (app instanceof PartySheetSD) {
				const memberIds = app.memberIds;
				if (memberIds.includes(actor.id)) {
					app.render();
				}
			}
		}
	});

	// Re-render party sheets when items are updated on member actors
	Hooks.on("updateItem", (item, changes, options, userId) => {
		const actor = item.parent;
		if (!actor || actor.type !== "Player") return;

		// Find all open party sheets that contain this actor as a member
		for (const app of Object.values(ui.windows)) {
			if (app instanceof PartySheetSD) {
				const memberIds = app.memberIds;
				if (memberIds.includes(actor.id)) {
					app.render();
				}
			}
		}
	});

	// Re-render party sheets when items are created on member actors
	Hooks.on("createItem", (item, options, userId) => {
		const actor = item.parent;
		if (!actor || actor.type !== "Player") return;

		// Find all open party sheets that contain this actor as a member
		for (const app of Object.values(ui.windows)) {
			if (app instanceof PartySheetSD) {
				const memberIds = app.memberIds;
				if (memberIds.includes(actor.id)) {
					app.render();
				}
			}
		}
	});

	// Re-render party sheets when items are deleted from member actors
	Hooks.on("deleteItem", (item, options, userId) => {
		const actor = item.parent;
		if (!actor || actor.type !== "Player") return;

		// Find all open party sheets that contain this actor as a member
		for (const app of Object.values(ui.windows)) {
			if (app instanceof PartySheetSD) {
				const memberIds = app.memberIds;
				if (memberIds.includes(actor.id)) {
					app.render();
				}
			}
		}
	});
}

/**
 * Party membership predicate and cleanup, moved verbatim out of the
 * composition root.
 *
 * `isPartyActor` was defined in the root with six call sites, five of which
 * stay there and now import it. It belongs here: it is the definition of what
 * a party actor IS, and this file is the party sheet.
 *
 * `deleteActor` is registered once in the root, so this one is safe to move on
 * its own (handoff rule 1); the register call still goes back in its original
 * position rather than relying on that.
 */
/**
 * Check if an actor is a Party actor (flagged NPC)
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isPartyActor(actor) {
	return actor?.type === "NPC" && actor?.getFlag(MODULE_ID, "isParty") === true;
}

export function registerPartyCleanupHooks() {
	// Clean up deleted actors from parties
	Hooks.on("deleteActor", (actor, options, userId) => {
		if (actor.type !== "Player") return;

		// Remove this actor from all parties
		game.actors.filter(a => isPartyActor(a)).forEach(async party => {
			const memberIds = party.getFlag(MODULE_ID, "members") ?? [];
			if (memberIds.includes(actor.id)) {
				const newMemberIds = memberIds.filter(id => id !== actor.id);
				await party.setFlag(MODULE_ID, "members", newMemberIds);
			}
		});
	});
}
