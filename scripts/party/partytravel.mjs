// Party travel/camping handlers — extracted from scripts/party/PartySheetSD.mjs
// (Phase 5.1 split). Prototype mixin merged via Object.assign.

import { CampingRestApp } from "./CampingRestSD.mjs";
import { PartyWeatherSettingsApp, getConfiguredPartyWeatherTable, getPartyWeatherTableUuid } from "./PartyWeatherSettingsSD.mjs";
import { buildTravelTaskRollData } from "../tray/SDXRollerData.mjs";
import { SDXRollerApp } from "../tray/SDXRollerApp.mjs";

const MODULE_ID = "shadowdark-extras";
// Lazy accessor avoids the mixin<->class import cycle (Phase 5.1 split):
// getCampingTasks lives in PartySheetSD, which imports this mixin.
let _campingTasks = null;
let _campingTasksPromise = null;
async function getCampingTasks() {
	if (!_campingTasks) {
		// Dedupe concurrent first calls; ESM caches the module so the
		// dynamic import is cheap even if it fires more than once.
		if (!_campingTasksPromise) {
			_campingTasksPromise = import("./PartySheetSD.mjs")
				.then(mod => {
					_campingTasks = mod.getCampingTasks;
					return _campingTasks;
				})
				.finally(() => {
					_campingTasksPromise = null;
				});
		}
		await _campingTasksPromise;
	}
	return _campingTasks();
}

export const PartyTravel = {

	/**
	 * Execute Party travel writes locally for a GM, or route them to the active
	 * GM for a player who normally cannot update the Party actor itself.
	 */
	async _requestPartyTravelMutation(request) {
		try {
			if (game.user.isGM) {
				// Dynamic import breaks the mixin<->class cycle (Phase 5.1 split)
				const { default: PartySheetSD } = await import("./PartySheetSD.mjs");
				return await PartySheetSD.applyPartyTravelMutation(
					this.actor,
					request,
					game.user
				);
			}

			const socket = game.modules.get(MODULE_ID)?.socket;
			if (socket) {
				const result = await socket.executeAsGM(
					"sdxMutatePartyTravel",
					this.actor.uuid,
					request
				);
				if (!result?.ok) {
					throw new Error(
						result?.error
						|| game.i18n.localize(
							"SHADOWDARK_EXTRAS.party.travel.update_rejected"
						)
					);
				}
				return result;
			}

			if (this.actor.testUserPermission?.(game.user, "OWNER")) {
				// Dynamic import breaks the mixin<->class cycle (Phase 5.1 split)
				const { default: PartySheetSD } = await import("./PartySheetSD.mjs");
				return await PartySheetSD.applyPartyTravelMutation(
					this.actor,
					request,
					game.user
				);
			}
			throw new Error(
				game.i18n.localize(
					"SHADOWDARK_EXTRAS.party.travel.gm_connection_required"
				)
			);
		}
		catch(error) {
			console.error(
				"Shadowdark Extras | Party travel update failed:",
				error
			);
			ui.notifications.error(
				game.i18n.format(
					"SHADOWDARK_EXTRAS.party.travel.update_failed",
					{ message: error?.message || String(error) }
				)
			);
			this.render(false);
			return null;
		}
	},

	/**
	 * Assign a member to a camping task
	 * @param {string} taskKey - The task key
	 * @param {string} memberId - The member ID or key
	 */
	async _assignMemberToTask(taskKey, memberId) {
		await this._requestPartyTravelMutation({
			operation: "selectTask",
			taskKey,
			memberId,
		});
	},

	/**
	 * Remove a member from a camping task
	 * @param {string} memberId - The member ID or key
	 */
	async _removeMemberFromTask(memberId) {
		await this._requestPartyTravelMutation({
			operation: "selectTask",
			taskKey: "",
			memberId,
		});
	},

	/**
	 * Reset all travel assignments
	 */
	async _resetTravelAssignments() {
		await this.actor.unsetFlag(MODULE_ID, "travelAssignments");
	},

	/**
	 * Handle resetting all travel assignments
	 * @param {Event} event
	 */
	async _onResetTravel(event) {
		event.preventDefault();
		if (!this.actor.isOwner) return;

		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.reset_title") },
			content: game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.reset_confirm"),
			modal: true,
		});

		if (confirmed) {
			await this._resetTravelAssignments();
		}
	},

	/**
	 * Handle removing a member from a travel task
	 * @param {Event} event
	 */
	async _onRemoveTravelMember(event) {
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		const taskKey = target.dataset.taskKey;
		const memberId = target.dataset.memberId;

		if (taskKey && memberId) {
			await this._removeMemberFromTask(memberId);
		}
		else {
			console.warn(
				"Shadowdark Extras | Missing taskKey or memberId for removal", taskKey, memberId
			);
		}
	},

	async _onSelectTravelTask(event) {
		const select = event.currentTarget;
		const memberId = select.dataset.memberId;
		const taskKey = select.value;
		await this._requestPartyTravelMutation({
			operation: "selectTask",
			memberId,
			taskKey,
		});
	},

	async _onSelectTravelAbility(event) {
		const select = event.currentTarget;
		const memberId = select.dataset.memberId;
		const taskKey = select.dataset.taskKey;
		const member = this.members.find(actor =>
			actor.id === memberId || actor.uuid === memberId
		);
		if (!member || !taskKey || (!game.user.isGM && !member.isOwner)) return;
		await this._requestPartyTravelMutation({
			operation: "selectAbility",
			memberId,
			taskKey,
			abilityIndex: Number(select.value) || 0,
		});
	},

	async _onBeginCampingRest(event) {
		event.preventDefault();
		if (!game.user.isGM) return;
		const members = await this.getMembers();
		CampingRestApp.show(this.actor, members, {
			onCampfireChange: async () => {
				try {
					// Dynamic import breaks the mixin<->class cycle (Phase 5.1 split)
					const { syncPartyTokenLight } = await import("./PartySheetSD.mjs");
					return syncPartyTokenLight(this.actor);
				}
				catch(error) {
					console.error("Shadowdark Extras | Party light sync failed:", error);
					return null;
				}
			},
		});
	},

	/* -------------------------------------------- */
	/*  Travel Tab Rolling Handlers                 */
	/* -------------------------------------------- */

	async _onToggleTravelAbility(event) {
		event.preventDefault();
		event.stopPropagation();
		console.log("Shadowdark Extras | Toggle Ability: Right Click Detected");
		const target = event.currentTarget;
		const taskKey = target.dataset.taskKey;
		const memberId = target.dataset.memberId;
		console.log("Shadowdark Extras | Toggle Ability Data:", { taskKey, memberId });

		if (!taskKey || !memberId) return;

		const selections = this.actor.getFlag(MODULE_ID, "travelSelections") ?? {};

		const campingTasks = await getCampingTasks();
		const task = campingTasks.find(t => t.key === taskKey);
		if (!task || !task.abilities || task.abilities.length < 2) return;

		const currentIdx = selections[taskKey]?.[memberId] ?? 0;
		const nextIdx = (currentIdx + 1) % task.abilities.length;

		console.log("Shadowdark Extras | New Selection Index:", nextIdx);
		await this._requestPartyTravelMutation({
			operation: "selectAbility",
			memberId,
			taskKey,
			abilityIndex: nextIdx,
		});
	},

	async _onChangeTravelDC(event) {
		event.preventDefault();
		const target = event.currentTarget;
		const taskKey = target.dataset.taskKey;
		const value = parseInt(target.value);

		const dcs = { ...this.actor.getFlag(MODULE_ID, "travelDCs") ?? {} };
		dcs[taskKey] = !isNaN(value) ? value : 12;

		await this.actor.setFlag(MODULE_ID, "travelDCs", dcs);
	},


	async _onRollTravelTask(event) {
		event.preventDefault();
		const target = event.currentTarget;
		const taskKey = target.dataset.taskKey;

		const campingTasks = await getCampingTasks();
		const task = campingTasks.find(t => t.key === taskKey);
		if (!task) return;

		const assignments = this.actor.getFlag(MODULE_ID, "travelAssignments") ?? {};
		const assignedIds = assignments[taskKey] ?? [];
		if (assignedIds.length === 0) {
			ui.notifications.warn(
				game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.no_assigned_members")
			);
			return;
		}

		const dcs = this.actor.getFlag(MODULE_ID, "travelDCs") ?? {};
		const dc = dcs[taskKey] ?? 12;

		const selections = this.actor.getFlag(MODULE_ID, "travelSelections") ?? {};

		const members = await this.getMembers();
		const actorsToRoll = assignedIds
			.map(id => members.find(m => m.id === id || m.uuid === id))
			.filter(m => m);

		if (actorsToRoll.length === 0) {
			ui.notifications.warn(
				game.i18n.localize("SHADOWDARK_EXTRAS.party.travel.no_assigned_members")
			);
			return;
		}

		const rollData = buildTravelTaskRollData(
			task,
			actorsToRoll,
			selections[taskKey] ?? {},
			dc
		);
		console.log("Shadowdark Extras | Dispatching cinematic travel task roll:", rollData);
		SDXRollerApp.dispatchGroupRoll(rollData);
	},

	/**
	 * Handle rolling for weather
	 * @param {Event} event
	 */
	async _onRollWeather(event) {
		event.preventDefault();

		const weatherTableUuid = getPartyWeatherTableUuid();
		if (weatherTableUuid) {
			const table = await getConfiguredPartyWeatherTable();
			if (table) {
				try {
					await table.draw({ displayChat: true });
					await this._maybeUseWeatherPrediction(
						() => table.draw({ displayChat: true })
					);
					return;
				}
				catch(error) {
					console.error(
						"Shadowdark Extras | Error drawing Party weather RollTable:", error
					);
				}
			}

			ui.notifications.warn(
				game.i18n.localize("SHADOWDARK_EXTRAS.party_weather.fallback_warning")
			);
		}

		await this._rollDefaultWeather();
		await this._maybeUseWeatherPrediction(() => this._rollDefaultWeather());
	},

	/**
	 * Offer unused successful Predict results after the weather is known.
	 * Accepting redraws immediately; declining accepts the current weather.
	 * @param {Function} drawWeather
	 */
	async _maybeUseWeatherPrediction(drawWeather) {
		const prediction = this.actor.getFlag(MODULE_ID, "campingWeatherReroll");
		let uses = Math.max(0, Number(prediction?.uses ?? (prediction ? 1 : 0)));
		if (!uses) return;

		while (uses > 0) {
			const useReroll = await foundry.applications.api.DialogV2.confirm({
				window: {
					title: game.i18n.localize(
						"SHADOWDARK_EXTRAS.camping_rest.predict_title"
					),
				},
				content: `<p>${game.i18n.format(
					"SHADOWDARK_EXTRAS.camping_rest.predict_prompt",
					{ count: uses }
				)}</p>`,
				modal: true,
			});

			if (!useReroll) {
				await this._requestPartyTravelMutation({
					operation: "weatherPrediction",
					action: "clear",
				});
				return;
			}

			const result = await this._requestPartyTravelMutation({
				operation: "weatherPrediction",
				action: "consume",
			});
			if (!result) return;
			uses = result.uses;
			await drawWeather();
		}
	},

	/**
	 * Open the GM-only Party weather RollTable selector.
	 * @param {Event} event
	 */
	_onConfigureWeather(event) {
		event.preventDefault();
		if (!game.user.isGM) return;
		new PartyWeatherSettingsApp().render({ force: true });
	},

	/**
	 * Roll the original Shadowdark weather check when no custom RollTable is set.
	 */
	async _rollDefaultWeather() {
		// Play dice sound if available
		if (shadowdark.utils.diceSound) {
			shadowdark.utils.diceSound();
		}

		// Roll 1d6
		const roll = await new Roll("1d6").evaluate({ async: true });

		// Determine outcome
		const isBadWeather = roll.total === 1;

		let content = "";
		let flavor = "Weather Check";

		if (isBadWeather) {
			// Roll duration for bad weather (1d4 days)
			const durationRoll = await new Roll("1d4").evaluate({ async: true });

			content = `
				<div class="shadowdark chat-card item-card" style="border: 1px solid #ff3333; border-radius: 4px; overflow: hidden; box-shadow: 0 0 10px rgba(255, 51, 51, 0.2);">
					<div class="card-header" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; background: rgba(255, 51, 51, 0.1);">
						<div style="display: flex; align-items: center; gap: 10px;">
							<img src="icons/magic/air/fog-gas-smoke-swirling-yellow.webp" title="Bad Weather" style="width: 36px; height: 36px; border: 1px solid #c9aa58; border-radius: 4px;"/>
							<h3 style="margin: 0; color: #ff3333; font-family: 'Montserrat', sans-serif; font-size: 1.2em; text-shadow: 1px 1px 2px #000;">Bad Weather</h3>
						</div>
						<div style="display: block !important; padding: 5px 0;">
							<p style="margin: 4px 0;"><strong>Storms!</strong></p>
							<p style="margin: 4px 0;">Normal terrain is <strong>difficult</strong> for <strong>${durationRoll.total} days</strong> (rolled 1d4).</p>
							<p style="margin: 4px 0; font-size: 0.9em;"><em>If in an extreme climate, terrain is impassible.</em></p>
						</div>
						<div cstyle="display: block !important; font-size: 0.85em; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 5px; color: #aaa;">
							<span>Rolled 1 on 1d6</span>
						</div>
					</div>
				</div>
			`;
		}
		else {
			content = `
				<div class="shadowdark chat-card item-card" style="border: 1px solid #c9aa58; border-radius: 4px; overflow: hidden; box-shadow: 0 0 10px rgba(201, 170, 88, 0.2);">
					<div class="card-header" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; background: rgba(201, 170, 88, 0.05);">
						<div style="display: flex; align-items: center; gap: 10px;">
							<img src="icons/magic/light/explosion-star-large-blue-yellow.webp" title="Good Weather" style="width: 36px; height: 36px; border: 1px solid #c9aa58; border-radius: 4px;"/>
							<h3 style="margin: 0; color: #c9aa58; font-family: 'Montserrat', sans-serif; font-size: 1.2em; text-shadow: 1px 1px 2px #000;">Good Weather</h3>
						</div>
						<div style="display: block !important; padding: 5px 0;">
							<p style="margin: 4px 0; color: #eee;">The weather is clear and favorable for travel.</p>
						</div>
						<div style="display: block !important; font-size: 0.85em; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 5px; color: #aaa;">
							<span>Rolled ${roll.total} on 1d6</span>
						</div>
					</div>
				</div>
			`;
		}

		// Create chat message
		ChatMessage.create({
			user: game.user.id,
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content: content,
			flavor: flavor,
		});
	},
};
