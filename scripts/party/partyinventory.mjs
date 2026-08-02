// Party inventory + light handlers — extracted from scripts/party/PartySheetSD.mjs
// (Phase 5.1 split). Prototype mixin merged via Object.assign.

import { isItemUnidentified, getMaskedItemName } from "./party-unidentified.mjs";

const MODULE_ID = "shadowdark-extras";

export const PartyInventory = {

	/**
	 * Prepare party shared inventory
	 * @returns {Object}
	 */
	_prepareInventory() {
		const inventory = [];
		const treasure = [];
		const freeCarrySeen = {};

		for (const item of this.actor.items) {
			if (!item.system.isPhysical) continue;

			const itemData = item.toObject();
			itemData.uuid = item.uuid;

			// Handle unidentified items - mask name for non-GM users
			const isUnidentified = isItemUnidentified(item);
			itemData.isUnidentified = isUnidentified;
			itemData.displayName = (isUnidentified && !game.user.isGM)
				? getMaskedItemName(item)
				: item.name;

			itemData.showQuantity = item.system.quantity > 1 ||
				item.system.isAmmunition ||
				(item.system.slots?.per_slot > 1);
			itemData.slotsCost = this._calculateItemSlotsCost(item, freeCarrySeen);

			// Light source handling
			itemData.isLightSource = ["Basic", "Effect"].includes(item.type) && item.system.light?.isSource;
			itemData.lightActive = itemData.isLightSource && item.system.light?.active;

			if (item.system.treasure) {
				treasure.push(itemData);
			}
			else {
				inventory.push(itemData);
			}
		}

		inventory.sort((a, b) => a.name.localeCompare(b.name));
		treasure.sort((a, b) => a.name.localeCompare(b.name));

		return { items: inventory, treasure };
	},

	_calculateItemSlotsCost(item, freeCarrySeen) {
		if (!item?.system?.isPhysical) return 0;
		if (item.type === "Gem") return 0;
		if (item.system.stashed) return 0;

		let freeCarry = Number(item.system?.slots?.free_carry) || 0;
		const nameKey = String(item.name || "");
		const alreadySeen = Number(freeCarrySeen?.[nameKey]) || 0;
		freeCarry = Math.max(0, freeCarry - alreadySeen);
		freeCarrySeen[nameKey] = alreadySeen + freeCarry;

		const perSlot = Number(item.system?.slots?.per_slot) || 1;
		const quantity = Number(item.system?.quantity) || 1;
		const slotsUsed = Number(item.system?.slots?.slots_used) || 0;
		let slotsForItem = Math.ceil(quantity / perSlot) * slotsUsed;
		slotsForItem -= freeCarry * slotsUsed;

		if (!Number.isFinite(slotsForItem)) return 0;
		return slotsForItem;
	},

	/**
	 * Get party coins
	 * @returns {Object}
	 */
	_getPartyCoins() {
		return {
			gp: this.actor.getFlag(MODULE_ID, "coins.gp") ?? 0,
			sp: this.actor.getFlag(MODULE_ID, "coins.sp") ?? 0,
			cp: this.actor.getFlag(MODULE_ID, "coins.cp") ?? 0,
		};
	},

	/**
	 * Calculate how many slots the party coins occupy
	 * 1 slot per 100 coins total (regardless of type)
	 * @returns {number}
	 */
	_calculateCoinSlots() {
		const coins = this._getPartyCoins();
		const gp = Math.max(0, parseInt(coins.gp) || 0);
		const sp = Math.max(0, parseInt(coins.sp) || 0);
		const cp = Math.max(0, parseInt(coins.cp) || 0);

		// Total number of coins
		const totalCoins = gp + sp + cp;

		// 1 slot per 100 coins, rounded down
		return Math.floor(totalCoins / 100);
	},

	_calculateActorInventorySlotsUsed(actor) {
		if (!actor) return 0;
		const freeCarrySeen = {};
		let total = 0;
		for (const item of actor.items) {
			total += this._calculateItemSlotsCost(item, freeCarrySeen);
		}
		// Add coin slots for this actor
		total += this._calculateActorCoinSlots(actor);
		return total;
	},

	/**
	 * Calculate how many slots an actor's coins occupy
	 * 1 slot per 100 coins total (regardless of type)
	 * @param {Actor} actor - The actor to calculate coin slots for
	 * @returns {number}
	 */
	_calculateActorCoinSlots(actor) {
		if (!actor?.system?.coins) return 0;
		const coins = actor.system.coins;
		const gp = Math.max(0, parseInt(coins.gp) || 0);
		const sp = Math.max(0, parseInt(coins.sp) || 0);
		const cp = Math.max(0, parseInt(coins.cp) || 0);

		// Total number of coins
		const totalCoins = gp + sp + cp;

		// 1 slot per 100 coins, rounded down
		return Math.floor(totalCoins / 100);
	},

	_calculateInventorySlotsUsed() {
		const freeCarrySeen = {};
		let total = 0;
		for (const item of this.actor.items) {
			total += this._calculateItemSlotsCost(item, freeCarrySeen);
		}
		// Add coin slots
		total += this._calculateCoinSlots();
		return total;
	},

	/** @inheritdoc */

	async _onSyncLights(event) {
		event.preventDefault();
		ui.notifications.info("Syncing party token lights...");
		try {
			// Dynamic import breaks the mixin<->class cycle (Phase 5.1 split):
			// syncPartyTokenLight lives in PartySheetSD, which imports this mixin.
			const { syncPartyTokenLight } = await import("./PartySheetSD.mjs");
			await syncPartyTokenLight(this.actor);
		}
		catch (error) {
			console.error("Shadowdark Extras | Party light sync failed:", error);
			ui.notifications.error("Party light sync failed.");
		}
	},

	async _onDivideCoins(event) {
		event.preventDefault();
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.divide_coins_gm_only"));
			return;
		}

		// Filter to only include Player type actors (exclude NPCs)
		const members = this.members.filter(m => m.type === "Player");
		if (members.length === 0) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.divide_coins_no_members"));
			return;
		}

		const treasury = this._getPartyCoins();
		const gp = Math.max(0, parseInt(treasury.gp) || 0);
		const sp = Math.max(0, parseInt(treasury.sp) || 0);
		const cp = Math.max(0, parseInt(treasury.cp) || 0);

		const n = members.length;
		const each = {
			gp: Math.floor(gp / n),
			sp: Math.floor(sp / n),
			cp: Math.floor(cp / n),
		};
		const remainder = {
			gp: gp - each.gp * n,
			sp: sp - each.sp * n,
			cp: cp - each.cp * n,
		};

		const distributedTotal = each.gp * n + each.sp * n + each.cp * n;
		if (distributedTotal === 0) {
			ui.notifications.info(game.i18n.localize("SHADOWDARK_EXTRAS.party.divide_coins_nothing"));
			return;
		}

		const gpLabel = game.i18n.localize("SHADOWDARK.coins.gp");
		const spLabel = game.i18n.localize("SHADOWDARK.coins.sp");
		const cpLabel = game.i18n.localize("SHADOWDARK.coins.cp");
		const memberLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.divide_coins_member");

		const rows = members
			.map(m => `
				<tr>
					<td class="member">${foundry.utils.escapeHTML(m.name)}</td>
					<td class="num">${each.gp}</td>
					<td class="num">${each.sp}</td>
					<td class="num">${each.cp}</td>
				</tr>
			`)
			.join("");

		const content = `
			<div class="shadowdark-extras-divide-coins">
				<p>${game.i18n.format("SHADOWDARK_EXTRAS.party.divide_coins_prompt", { count: n })}</p>
				<table>
					<thead>
						<tr>
							<th>${memberLabel}</th>
							<th>${gpLabel}</th>
							<th>${spLabel}</th>
							<th>${cpLabel}</th>
						</tr>
					</thead>
					<tbody>
						${rows}
					</tbody>
				</table>
				<p class="remainder">
					${game.i18n.localize("SHADOWDARK_EXTRAS.party.divide_coins_remainder")}: ${remainder.gp} ${gpLabel}, ${remainder.sp} ${spLabel}, ${remainder.cp} ${cpLabel}
				</p>
			</div>
		`;

		const confirmed = await new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.divide_coins_title") },
				content,
				buttons: [
					{
						action: "confirm",
						label: game.i18n.localize("SHADOWDARK_EXTRAS.party.divide_coins_confirm"),
						default: true,
						callback: () => resolve(true),
					},
					{
						action: "cancel",
						label: game.i18n.localize("SHADOWDARK_EXTRAS.party.cancel"),
						callback: () => resolve(false),
					},
				],
				close: () => resolve(false),
			}).render({ force: true });
		});

		if (!confirmed) return;

		// Update treasury first (remainder stays)
		await this.actor.setFlag(MODULE_ID, "coins.gp", remainder.gp);
		await this.actor.setFlag(MODULE_ID, "coins.sp", remainder.sp);
		await this.actor.setFlag(MODULE_ID, "coins.cp", remainder.cp);

		// Update member coins
		const updates = members.map(m => {
			const coins = m.system?.coins ?? {};
			return {
				_id: m.id,
				"system.coins.gp": (Number(coins.gp) || 0) + each.gp,
				"system.coins.sp": (Number(coins.sp) || 0) + each.sp,
				"system.coins.cp": (Number(coins.cp) || 0) + each.cp,
			};
		});
		await Actor.updateDocuments(updates);
		this.render();
	},

	async _onCreateItem(event) {
		event.preventDefault();

		const itemData = {
			name: game.i18n.localize("SHADOWDARK_EXTRAS.party.new_item"),
			type: "Basic",
			img: "icons/svg/item-bag.svg",
		};

		await this.actor.createEmbeddedDocuments("Item", [itemData]);
	},

	/**
	 * Increment item quantity
	 * @param {Event} event
	 */
	async _onItemIncrement(event) {
		event.preventDefault();
		const itemId = event.currentTarget.dataset.itemId;
		const item = this.actor.items.get(itemId);
		if (item) {
			const newQty = (item.system.quantity || 1) + 1;
			await item.update({ "system.quantity": newQty });
		}
	},

	/**
	 * Decrement item quantity
	 * @param {Event} event
	 */
	async _onItemDecrement(event) {
		event.preventDefault();
		const itemId = event.currentTarget.dataset.itemId;
		const item = this.actor.items.get(itemId);
		if (item && item.system.quantity > 1) {
			const newQty = item.system.quantity - 1;
			await item.update({ "system.quantity": newQty });
		}
	},

	/**
	 * Post item to chat
	 * @param {Event} event
	 */
	async _onItemChat(event) {
		event.preventDefault();
		const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
		const item = this.actor.items.get(itemId);
		// SD 4.x removed item.displayCard; use ChatSD.showItemCard. The old
		// optional call swallowed failures silently.
		if (item?.uuid) {
			try {
				await shadowdark.chat.showItemCard(item.uuid);
			}
			catch(err) {
				console.error("shadowdark-extras: showItemCard failed", err);
			}
		}
	},

	/**
	 * Toggle a light source on/off
	 * @param {Event} event
	 */
	async _onToggleLightSource(event) {
		event.preventDefault();

		const itemId = event.currentTarget.dataset.itemId;
		const item = this.actor.items.get(itemId);
		if (!item) return;

		const active = !item.system.light.active;

		if (active) {
			// Turn off any other active light sources first
			const activeLights = this.actor.items.filter(
				i => ["Basic", "Effect"].includes(i.type) && i.system.light?.isSource && i.system.light?.active
			);
			for (const light of activeLights) {
				await this.actor.updateEmbeddedDocuments("Item", [{
					"_id": light.id,
					"system.light.active": false,
				}]);
			}
		}

		// Update the item's light active state
		const dataUpdate = {
			"_id": item.id,
			"system.light.active": active,
		};

		if (!item.system.light.hasBeenUsed) {
			dataUpdate["system.light.hasBeenUsed"] = true;
		}

		await this.actor.updateEmbeddedDocuments("Item", [dataUpdate]);

		// Update the party actor's token light settings
		await this._updatePartyTokenLight(active, item);

		// Notify light source tracker if available
		if (game.shadowdark?.lightSourceTracker) {
			game.shadowdark.lightSourceTracker.toggleLightSource(this.actor, item);
		}
	},

	/**
	 * Update the party actor's token light settings
	 * @param {boolean} active - Whether the light is being turned on
	 * @param {Item} item - The light source item
	 */
	async _updatePartyTokenLight(active, item) {
		let lightData;

		if (active) {
			// Get the light settings from the mapping
			try {
				const lightSources = await foundry.utils.fetchJsonWithTimeout(
					"systems/shadowdark/assets/mappings/map-light-sources.json"
				);
				lightData = lightSources[item.system.light.template]?.light ?? { dim: 0, bright: 0 };
			}
			catch (e) {
				console.warn("Failed to load light source mappings:", e);
				lightData = { dim: 0, bright: 0 };
			}
		}
		else {
			lightData = { dim: 0, bright: 0 };
		}

		// Update the token on canvas if it exists
		const token = this.actor.getActiveTokens()[0];
		if (token) {
			await token.document.update({ light: lightData });
		}

		// Update the prototype token
		await this.actor.update({ "prototypeToken.light": lightData });
	},

	/**
	 * Handle coin value changes
	 * @param {Event} event
	 */

	/**
	 * Transfer item to a party member
	 * @param {HTMLElement} element
	 */
	async _onTransferItem(element) {
		const itemId = element.dataset.itemId;
		const item = this.actor.items.get(itemId);
		if (!item) return;

		// Only world actors can receive items (not compendium actors)
		const members = this.members.filter(m => m.isOwner && !m.uuid?.startsWith("Compendium."));
		if (members.length === 0) {
			ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.party.warn.no_owned_members"));
			return;
		}

		// Create dialog to select member
		const memberOptions = members.map(m =>
			`<option value="${m.id}">${m.name}</option>`
		).join("");

		new foundry.applications.api.DialogV2({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.transfer_to_member") },
			content: `
				<form>
					<div class="form-group">
						<label>${game.i18n.localize("SHADOWDARK_EXTRAS.party.select_member")}</label>
						<select name="member">${memberOptions}</select>
					</div>
				</form>
			`,
			buttons: [
				{
					action: "transfer",
					icon: "fas fa-share",
					label: game.i18n.localize("SHADOWDARK_EXTRAS.party.transfer"),
					default: true,
					callback: async (event, button) => {
						const memberId = button.form.elements.member.value;
						const member = game.actors.get(memberId);
						if (!member) return;

						await this._transferItemToActor(item, member, { move: true });

						const displayName = (isItemUnidentified(item) && !game.user.isGM)
							? getMaskedItemName(item)
							: item.name;

						ui.notifications.info(
							game.i18n.format("SHADOWDARK_EXTRAS.party.item_transferred", {
								item: displayName,
								member: member.name,
							})
						);
					},
				},
				{
					action: "cancel",
					icon: "fas fa-times",
					label: game.i18n.localize("SHADOWDARK_EXTRAS.party.cancel"),
				},
			],
		}).render({ force: true });
	},

	async _onCoinChange(event) {
		const input = event.currentTarget;
		const coinType = input.dataset.coin;
		const value = Math.max(0, parseInt(input.value) || 0);

		await this.actor.setFlag(MODULE_ID, `coins.${coinType}`, value);
	},

	/**
	 * Add coins to party treasury via dialog
	 * @param {Event} event
	 */
	async _onAddCoins(event) {
		event.preventDefault();

		const gpLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_gp");
		const spLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_sp");
		const cpLabel = game.i18n.localize("SHADOWDARK_EXTRAS.party.coin_cp");

		const content = `
			<form class="add-coins-form">
				<p>${game.i18n.localize("SHADOWDARK_EXTRAS.party.add_coins_prompt")}</p>
				<div class="form-group">
					<label>${gpLabel}</label>
					<input type="number" name="gp" value="0" min="0" />
				</div>
				<div class="form-group">
					<label>${spLabel}</label>
					<input type="number" name="sp" value="0" min="0" />
				</div>
				<div class="form-group">
					<label>${cpLabel}</label>
					<input type="number" name="cp" value="0" min="0" autofocus />
				</div>
			</form>
		`;

		const result = await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.party.add_coins_title") },
			content,
			ok: {
				callback: (event, button, dialog) => {
					const form = dialog.element.querySelector("form");
					return {
						gp: parseInt(form.gp.value) || 0,
						sp: parseInt(form.sp.value) || 0,
						cp: parseInt(form.cp.value) || 0,
					};
				},
			},
			rejectClose: false,
		});

		if (!result) return;

		const { gp, sp, cp } = result;
		if (gp === 0 && sp === 0 && cp === 0) return;

		// Get current coins and add the new amounts
		const currentCoins = this._getPartyCoins();
		const newGp = Math.max(0, (parseInt(currentCoins.gp) || 0) + gp);
		const newSp = Math.max(0, (parseInt(currentCoins.sp) || 0) + sp);
		const newCp = Math.max(0, (parseInt(currentCoins.cp) || 0) + cp);

		await this.actor.setFlag(MODULE_ID, "coins.gp", newGp);
		await this.actor.setFlag(MODULE_ID, "coins.sp", newSp);
		await this.actor.setFlag(MODULE_ID, "coins.cp", newCp);

		// Build notification message
		const parts = [];
		if (gp !== 0) parts.push(`${gp} ${gpLabel}`);
		if (sp !== 0) parts.push(`${sp} ${spLabel}`);
		if (cp !== 0) parts.push(`${cp} ${cpLabel}`);

		ui.notifications.info(
			game.i18n.format("SHADOWDARK_EXTRAS.party.coins_added", { coins: parts.join(", ") })
		);
	},
};
