/**
 * Party Sheet for Shadowdark RPG
 * A group/party management sheet similar to D&D 5e's Group actor
 */

import { getTravelActivities } from "./TravelActivitiesSettingsSD.mjs";
import { getTravelSpeeds } from "./TravelSpeedsSettingsSD.mjs";
import {
	isPartyTravelMutationAuthorized,
	planPartyTravelMutation,
	planWeatherPredictionMutation,
} from "./PartyTravelMutationsSD.mjs";
import { PartyTravel } from "./partytravel.mjs";
import { PartyXp } from "./partyxp.mjs";
import { PartyInventory } from "./partyinventory.mjs";
import { PartyRoster } from "./party-roster.mjs";
import { PartyDropTransfer } from "./party-drop-transfer.mjs";
import { PartyTokenPlacement } from "./party-token-placement.mjs";

const MODULE_ID = "shadowdark-extras";

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
			dragDrop: [
				{ dragSelector: ".item-list .item, .member, .sdx-task-member", dropSelector: null },
			],
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
			max: Number.isFinite(maxSlots) ? maxSlots : (Number.isFinite(maxSlotsDefault)
				? maxSlotsDefault
				: 10),
		};
		context.inventorySlots.over = context.inventorySlots.used > context.inventorySlots.max;

		// Get party description (use namespaced TextEditor when available)
		const enrichHTML = foundry?.applications?.ux?.TextEditor?.implementation?.enrichHTML
			?? TextEditor.enrichHTML;
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
				.map(memberId => membersData.find(
					m => m.memberKey === memberId || m.id === memberId
				))
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
		html.find("[data-action='change-travel-speed']").change(
			this._onChangeTravelSpeed.bind(this)
		);

		// XP controls
		html.find("[data-action='xp-increment']").click(this._onXpIncrement.bind(this));
		html.find("[data-action='xp-decrement']").click(this._onXpDecrement.bind(this));

		// NPC spawn count controls
		html.find("[data-action='npc-count-increment']").click(
			this._onNpcCountIncrement.bind(this)
		);
		html.find("[data-action='npc-count-decrement']").click(
			this._onNpcCountDecrement.bind(this)
		);
		html.find("[data-action='npc-count-change']").change(this._onNpcCountChange.bind(this));

		// Inventory interactions
		html.find("[data-action='create-item']").click(this._onCreateItem.bind(this));
		html.find("[data-action='configure-party-slots']").click(
			this._onConfigurePartySlots.bind(this)
		);
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
		html.find("[data-action='remove-travel-member']").click(
			this._onRemoveTravelMember.bind(this)
		);
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
		const current = Number.isFinite(currentRaw)
			? currentRaw
			: (Number.isFinite(defaultRaw) ? defaultRaw : 10);

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

		ui.notifications.info(
			game.i18n.format("SHADOWDARK_EXTRAS.party.member_removed", { name: memberName })
		);
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
// Roster preparation, drag/drop transfer and token placement extracted in the
// Phase 5.3 split. Prototype methods, so `this` is the sheet as it always was.
Object.assign(PartySheetSD.prototype, PartyRoster);
Object.assign(PartySheetSD.prototype, PartyDropTransfer);
Object.assign(PartySheetSD.prototype, PartyTokenPlacement);

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
// Token light synchronisation extracted to party-token-light.mjs (Phase 5.3
// split). Re-exported so existing import sites keep resolving here.
export { getBrightestPartyLight, syncPartyTokenLight } from "./party-token-light.mjs";

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
