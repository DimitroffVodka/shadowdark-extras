/**
 * Player-to-player item and coin transfers.
 *
 * The root's PLAYER-TO-PLAYER TRANSFERS section, moved verbatim: the sheet
 * context-menu entries, the two transfer dialogs, and the GM-relay transfer
 * calls that actually move the items and coins.
 *
 * inventory/ next to TradeWindowSD.mjs, which already provides the
 * nativeTransferItems/nativeTransferCoins relay this section drives.
 *
 * Unblocked by moving the SD identification wrappers into shared/sd4Compat.mjs
 * first: this section reads isUnidentified and getUnidentifiedName to decide
 * what name a transferred item shows, and while those lived in the root it
 * could not leave.
 *
 * All five names are exported because the root still calls each of them —
 * four from the sheet context-menu wiring and patchPlayerSheetForTransfers
 * from the ready hook.
 *
 * Zero registrations, so the registration snapshot is untouched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isUnidentified, getUnidentifiedName } from "../shared/sd4Compat.mjs";
import { nativeTransferItems, nativeTransferCoins } from "./TradeWindowSD.mjs";
import { getSocket } from "../combat/CombatSettingsSD.mjs";

// ============================================
// PLAYER-TO-PLAYER TRANSFERS (context menu + native GM-relay transfer)
// ============================================

/**
 * Transfer an item to another player's character. Moves the item natively
 * when the user owns the target, otherwise relays through a GM. No Item Piles.
 */
export async function transferItemToPlayer(sourceActor, item, targetActorId) {
	if (!sourceActor || !item) return;

	const targetActor = game.actors.get(targetActorId);
	if (!targetActor) {
		ui.notifications.error(
			game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_no_target")
		);
		return;
	}

	// Get the display name - mask if unidentified and user is not GM
	const itemName = (isUnidentified(item) && !game.user.isGM)
		? getUnidentifiedName(item)
		: item.name;

	const payload = [{ _id: item.id, quantity: item.system?.quantity || 1 }];

	try {
		// If we own the target we can move the item directly; otherwise relay
		// the whole transfer through a GM (who owns every actor). No Item Piles.
		if (game.user.isGM || targetActor.isOwner) {
			await nativeTransferItems(sourceActor, targetActor, payload);
		}
		else {
			const socket = getSocket();
			if (!socket) {
				ui.notifications.error(
					game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_failed")
				);
				console.error(`${MODULE_ID} | transferItemToPlayer: socket unavailable`);
				return;
			}
			if (!game.users.some(u => u.isGM && u.active)) {
				ui.notifications.error(
					game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_no_gm")
				);
				return;
			}
			const ok = await socket.executeAsGM("transferItemsAsGM", {
				sourceActorId: sourceActor.id,
				targetActorId: targetActor.id,
				items: payload,
			});
			if (!ok) {
				ui.notifications.error(
					game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_failed")
				);
				return;
			}
		}

		ui.notifications.info(
			game.i18n.format("SHADOWDARK_EXTRAS.notifications.item_transferred", {
				item: itemName,
				target: targetActor.name,
			})
		);
	}
	catch(error) {
		console.error(`${MODULE_ID} | Error during transfer:`, error);
		ui.notifications.error(
			game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_failed")
		);
	}
}

/**
 * Transfer coins to another player's character. Party storage uses module
 * flags; player targets move natively (or via GM relay). No Item Piles.
 */
export async function transferCoinsToPlayer(sourceActor, coins, targetActorId) {
	if (!sourceActor || !coins) return;

	const targetActor = game.actors.get(targetActorId);
	if (!targetActor) {
		ui.notifications.error(
			game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_no_target")
		);
		return;
	}

	// Validate source has enough coins
	const sourceCoins = sourceActor.system?.coins || {};
	if ((coins.gp || 0) > (sourceCoins.gp || 0)
		|| (coins.sp || 0) > (sourceCoins.sp || 0)
		|| (coins.cp || 0) > (sourceCoins.cp || 0)) {
		ui.notifications.error(
			game.i18n.localize("SHADOWDARK_EXTRAS.notifications.not_enough_coins_transfer")
		);
		return;
	}

	try {
		// Check if target is a party actor (coins stored as module flags, not system.coins)
		const isPartyTarget = targetActor.type === "NPC" && targetActor.getFlag(MODULE_ID, "isParty");

		if (isPartyTarget) {
			// Party actors store coins as module flags — manually subtract from source and add to party
			const sourceGp = Math.max(0, (parseInt(sourceCoins.gp) || 0) - (coins.gp || 0));
			const sourceSp = Math.max(0, (parseInt(sourceCoins.sp) || 0) - (coins.sp || 0));
			const sourceCp = Math.max(0, (parseInt(sourceCoins.cp) || 0) - (coins.cp || 0));

			await sourceActor.update({
				"system.coins.gp": sourceGp,
				"system.coins.sp": sourceSp,
				"system.coins.cp": sourceCp,
			});

			// Add coins to party treasury flags
			const partyGp = (parseInt(targetActor.getFlag(MODULE_ID, "coins.gp")) || 0) + (coins.gp || 0);
			const partySp = (parseInt(targetActor.getFlag(MODULE_ID, "coins.sp")) || 0) + (coins.sp || 0);
			const partyCp = (parseInt(targetActor.getFlag(MODULE_ID, "coins.cp")) || 0) + (coins.cp || 0);

			await targetActor.setFlag(MODULE_ID, "coins.gp", partyGp);
			await targetActor.setFlag(MODULE_ID, "coins.sp", partySp);
			await targetActor.setFlag(MODULE_ID, "coins.cp", partyCp);
		}
		else {
			// Regular player-to-player coin transfer. Move directly if we own
			// the target, otherwise relay through a GM. No Item Piles.
			const coinPayload = {
				gp: coins.gp || 0,
				sp: coins.sp || 0,
				cp: coins.cp || 0,
			};

			if (game.user.isGM || targetActor.isOwner) {
				await nativeTransferCoins(sourceActor, targetActor, coinPayload);
			}
			else {
				const socket = getSocket();
				if (!socket) {
					ui.notifications.error(
						game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_failed")
					);
					console.error(`${MODULE_ID} | transferCoinsToPlayer: socket unavailable`);
					return;
				}
				if (!game.users.some(u => u.isGM && u.active)) {
					ui.notifications.error(
						game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_no_gm")
					);
					return;
				}
				const ok = await socket.executeAsGM("transferCoinsAsGM", {
					sourceActorId: sourceActor.id,
					targetActorId: targetActor.id,
					coins: coinPayload,
				});
				if (!ok) {
					ui.notifications.error(
						game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_failed")
					);
					return;
				}
			}
		}

		// Build a human-readable coins string
		const coinParts = [];
		if (coins.gp > 0) coinParts.push(`${coins.gp} GP`);
		if (coins.sp > 0) coinParts.push(`${coins.sp} SP`);
		if (coins.cp > 0) coinParts.push(`${coins.cp} CP`);
		const coinsStr = coinParts.join(", ");

		ui.notifications.info(
			game.i18n.format("SHADOWDARK_EXTRAS.notifications.coins_transferred", {
				coins: coinsStr,
				target: targetActor.name,
			})
		);
	}
	catch(error) {
		console.error(`${MODULE_ID} | Error during coin transfer:`, error);
		ui.notifications.error(
			game.i18n.localize("SHADOWDARK_EXTRAS.notifications.transfer_failed")
		);
	}
}

/**
 * Show dialog to select target player and coin amounts for transfer
 * Similar to showTransferDialog but for coins instead of items
 */
export async function showCoinTransferDialog(sourceActor) {
	// Get all player characters that are not the source actor and have an owner
	const allPlayers = game.actors.filter(a => {
		if (a.id === sourceActor.id) return false;
		// Include Player type actors and Party type actors (NPC type with party flag)
		const isParty = a.type === "NPC" && a.getFlag(MODULE_ID, "isParty");
		if (a.type !== "Player" && !isParty) return false;
		// For players, check if the actor has any owner who can receive the coins
		if (!isParty) {
			return game.users.some(u => a.testUserPermission(u, "OWNER"));
		}
		return true; // Party actors are always available
	});

	if (allPlayers.length === 0) {
		ui.notifications.warn(
			game.i18n.localize("SHADOWDARK_EXTRAS.notifications.no_players_available")
		);
		return;
	}

	// Get source actor's coins for validation
	const sourceCoins = {
		gp: sourceActor.system?.coins?.gp ?? 0,
		sp: sourceActor.system?.coins?.sp ?? 0,
		cp: sourceActor.system?.coins?.cp ?? 0,
	};

	// Categorize actors and build searchable data
	const partyActors = allPlayers.filter(a => a.type === "NPC" && a.getFlag(MODULE_ID, "isParty"));
	const connectedAssigned = allPlayers.filter(a => {
		if (a.type !== "Player") return false;
		return game.users.some(u => u.active && u.character?.id === a.id);
	});
	const otherPlayers = allPlayers.filter(a => {
		if (a.type !== "Player") return false;
		return !game.users.some(u => u.active && u.character?.id === a.id);
	});

	// Build options HTML
	let optionsHtml = "";

	if (partyActors.length > 0) {
		optionsHtml += "<optgroup label=\"📦 Party Storage\" data-group=\"party\">";
		for (const p of partyActors) {
			optionsHtml += `<option value="${p.id}" data-search="${foundry.utils.escapeHTML(p.name.toLowerCase())}">🎒 ${p.name}</option>`;
		}
		optionsHtml += "</optgroup>";
	}

	if (connectedAssigned.length > 0) {
		optionsHtml += "<optgroup label=\"🟢 Connected Players\" data-group=\"connected\">";
		for (const p of connectedAssigned) {
			const user = game.users.find(u => u.active && u.character?.id === p.id);
			const userName = user ? user.name : "";
			const displayUserName = userName ? ` (${userName})` : "";
			const searchText = `${p.name} ${userName}`.toLowerCase();
			optionsHtml += `<option value="${p.id}" data-search="${foundry.utils.escapeHTML(searchText)}">🟢 ${p.name}${displayUserName}</option>`;
		}
		optionsHtml += "</optgroup>";
	}

	if (otherPlayers.length > 0) {
		optionsHtml += "<optgroup label=\"⚪ Other Characters\" data-group=\"other\">";
		for (const p of otherPlayers) {
			const owners = game.users.filter(u => p.testUserPermission(u, "OWNER"));
			const ownerNames = owners.map(u => u.name).join(" ");
			const searchText = `${p.name} ${ownerNames}`.toLowerCase();
			optionsHtml += `<option value="${p.id}" data-search="${foundry.utils.escapeHTML(searchText)}">⚪ ${p.name}</option>`;
		}
		optionsHtml += "</optgroup>";
	}

	const content = `
		<form>
			<div class="form-group" style="margin-bottom: 8px;">
				<label style="display: flex; align-items: center; gap: 8px;">
					<input type="checkbox" id="sdx-filter-connected" checked />
					${game.i18n.localize("SHADOWDARK_EXTRAS.dialog.filter_connected")}
				</label>
			</div>
			<div class="form-group" style="margin-bottom: 8px;">
				<label>Search:</label>
				<input type="text" id="sdx-transfer-search" placeholder="Type to filter by name..."
				       style="width: 100%;" autocomplete="off" />
			</div>
			<div class="form-group">
				<label>${game.i18n.localize("SHADOWDARK_EXTRAS.dialog.select_recipient")}</label>
				<select name="targetActorId" id="sdx-transfer-target" style="width: 100%; min-height: 150px;" size="8">
					${optionsHtml}
				</select>
			</div>
			<hr style="margin: 12px 0;" />
			<div class="form-group">
				<label>${game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer_coins_amount")}</label>
				<div style="display: flex; gap: 12px; margin-top: 4px;">
					<div style="flex: 1; text-align: center;">
						<input type="number" name="gp" id="sdx-coin-gp" value="0" min="0" max="${sourceCoins.gp}"
						       style="width: 100%; text-align: center;" />
						<label style="font-size: 0.85em; color: #c9a227;">GP (${sourceCoins.gp})</label>
					</div>
					<div style="flex: 1; text-align: center;">
						<input type="number" name="sp" id="sdx-coin-sp" value="0" min="0" max="${sourceCoins.sp}"
						       style="width: 100%; text-align: center;" />
						<label style="font-size: 0.85em; color: #aaa;">SP (${sourceCoins.sp})</label>
					</div>
					<div style="flex: 1; text-align: center;">
						<input type="number" name="cp" id="sdx-coin-cp" value="0" min="0" max="${sourceCoins.cp}"
						       style="width: 100%; text-align: center;" />
						<label style="font-size: 0.85em; color: #b87333;">CP (${sourceCoins.cp})</label>
					</div>
				</div>
			</div>
			<p style="font-size: 0.9em; opacity: 0.8; margin-top: 12px;">
				${game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer_coins_warning")}
			</p>
		</form>
	`;

	return new Promise(resolve => {
		const dialog = new foundry.applications.api.DialogV2({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer_coins_title") },
			content,
			buttons: [
				{
					action: "transfer",
					icon: "fas fa-coins",
					label: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer"),
					default: true,
					callback: (event, button, dlg) => {
						const root = dlg.element;
						const targetActorId = root.querySelector('[name="targetActorId"]')?.value;
						const gp = parseInt(root.querySelector("#sdx-coin-gp")?.value) || 0;
						const sp = parseInt(root.querySelector("#sdx-coin-sp")?.value) || 0;
						const cp = parseInt(root.querySelector("#sdx-coin-cp")?.value) || 0;

						if (gp <= 0 && sp <= 0 && cp <= 0) {
							ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.dialog.no_coins_selected"));
							resolve(null);
							return;
						}

						resolve({ targetActorId, coins: { gp, sp, cp } });
					},
				},
				{
					action: "cancel",
					icon: "fas fa-times",
					label: game.i18n.localize("Cancel"),
					callback: () => resolve(null),
				},
			],
			close: () => resolve(null),
		});
		dialog.render({ force: true }).then(() => {
			const root = dialog.element;
			const select = root.querySelector("#sdx-transfer-target");
			const filterCheckbox = root.querySelector("#sdx-filter-connected");
			const searchInput = root.querySelector("#sdx-transfer-search");

			const updateFilter = () => {
				const showOnlyConnected = !!filterCheckbox?.checked;
				const searchText = (searchInput?.value || "").toLowerCase().trim();

				root.querySelectorAll("#sdx-transfer-target optgroup").forEach(group => {
					const groupType = group.dataset.group;
					if (groupType === "other" && showOnlyConnected) {
						group.hidden = true;
						return;
					}
					let visibleCount = 0;
					group.querySelectorAll("option").forEach(option => {
						const optionSearch = option.dataset.search || "";
						const visible = searchText === "" || optionSearch.includes(searchText);
						option.hidden = !visible;
						if (visible) visibleCount++;
					});
					group.hidden = visibleCount === 0;
				});

				const selected = select?.options[select.selectedIndex];
				if (selected && (selected.hidden || selected.parentElement?.hidden)) {
					const firstVisible = Array.from(select.options).find(o => !o.hidden && !o.parentElement?.hidden);
					if (firstVisible) firstVisible.selected = true;
				}
			};

			updateFilter();
			filterCheckbox?.addEventListener("change", updateFilter);
			searchInput?.addEventListener("input", updateFilter);

			root.querySelectorAll("#sdx-coin-gp, #sdx-coin-sp, #sdx-coin-cp").forEach(input => {
				input.addEventListener("change", () => {
					const max = parseInt(input.max) || 0;
					let val = parseInt(input.value) || 0;
					if (val < 0) val = 0;
					if (val > max) val = max;
					input.value = val;
				});
			});

			setTimeout(() => searchInput?.focus(), 100);
		});
	});
}

/**
 * Show dialog to select target player for transfer
 * Enhanced with filtering for connected/assigned characters and Party actors
 */

export async function showTransferDialog(sourceActor, item) {
	// Get all player characters that are not the source actor and have an owner
	const allPlayers = game.actors.filter(a => {
		if (a.id === sourceActor.id) return false;
		// Include Player type actors and Party type actors (NPC type with party flag)
		const isParty = a.type === "NPC" && a.getFlag(MODULE_ID, "isParty");
		if (a.type !== "Player" && !isParty) return false;
		// For players, check if the actor has any owner who can receive the item
		if (!isParty) {
			return game.users.some(u => a.testUserPermission(u, "OWNER"));
		}
		return true; // Party actors are always available
	});

	if (allPlayers.length === 0) {
		ui.notifications.warn(
			game.i18n.localize("SHADOWDARK_EXTRAS.notifications.no_players_available")
		);
		return;
	}

	// Categorize actors and build searchable data
	const partyActors = allPlayers.filter(a => a.type === "NPC" && a.getFlag(MODULE_ID, "isParty"));
	const connectedAssigned = allPlayers.filter(a => {
		if (a.type !== "Player") return false;
		// Check if any connected user has this as their assigned character
		return game.users.some(u => u.active && u.character?.id === a.id);
	});
	const otherPlayers = allPlayers.filter(a => {
		if (a.type !== "Player") return false;
		// Not connected/assigned
		return !game.users.some(u => u.active && u.character?.id === a.id);
	});

	// Build options HTML with optgroups and data attributes for searching
	let optionsHtml = "";

	// Party actors first
	if (partyActors.length > 0) {
		optionsHtml += "<optgroup label=\"📦 Party Storage\" data-group=\"party\">";
		for (const p of partyActors) {
			optionsHtml += `<option value="${p.id}" data-search="${foundry.utils.escapeHTML(p.name.toLowerCase())}">🎒 ${p.name}</option>`;
		}
		optionsHtml += "</optgroup>";
	}

	// Connected & Assigned characters
	if (connectedAssigned.length > 0) {
		optionsHtml += "<optgroup label=\"🟢 Connected Players\" data-group=\"connected\">";
		for (const p of connectedAssigned) {
			const user = game.users.find(u => u.active && u.character?.id === p.id);
			const userName = user ? user.name : "";
			const displayUserName = userName ? ` (${userName})` : "";
			const searchText = `${p.name} ${userName}`.toLowerCase();
			optionsHtml += `<option value="${p.id}" data-search="${foundry.utils.escapeHTML(searchText)}">🟢 ${p.name}${displayUserName}</option>`;
		}
		optionsHtml += "</optgroup>";
	}

	// Other player characters
	if (otherPlayers.length > 0) {
		optionsHtml += "<optgroup label=\"⚪ Other Characters\" data-group=\"other\">";
		for (const p of otherPlayers) {
			// Find any owner for search purposes
			const owners = game.users.filter(u => p.testUserPermission(u, "OWNER"));
			const ownerNames = owners.map(u => u.name).join(" ");
			const searchText = `${p.name} ${ownerNames}`.toLowerCase();
			optionsHtml += `<option value="${p.id}" data-search="${foundry.utils.escapeHTML(searchText)}">⚪ ${p.name}</option>`;
		}
		optionsHtml += "</optgroup>";
	}

	const content = `
		<form>
			<div class="form-group" style="margin-bottom: 8px;">
				<label style="display: flex; align-items: center; gap: 8px;">
					<input type="checkbox" id="sdx-filter-connected" checked />
					Show only connected players
				</label>
			</div>
			<div class="form-group" style="margin-bottom: 8px;">
				<label>Search:</label>
				<input type="text" id="sdx-transfer-search" placeholder="Type to filter by name..."
				       style="width: 100%;" autocomplete="off" />
			</div>
			<div class="form-group">
				<label>${game.i18n.localize("SHADOWDARK_EXTRAS.dialog.select_recipient")}</label>
				<select name="targetActorId" id="sdx-transfer-target" style="width: 100%; min-height: 200px;" size="10">
					${optionsHtml}
				</select>
			</div>
			<p>${game.i18n.format("SHADOWDARK_EXTRAS.dialog.transfer_item_warning", { item: item.name })}</p>
		</form>
	`;

	return new Promise(resolve => {
		const dialog = new foundry.applications.api.DialogV2({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer_item_title") },
			content,
			buttons: [
				{
					action: "transfer",
					icon: "fas fa-exchange-alt",
					label: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer"),
					default: true,
					callback: (event, button, dlg) => {
						const targetActorId = dlg.element.querySelector('[name="targetActorId"]')?.value;
						resolve(targetActorId);
					},
				},
				{
					action: "cancel",
					icon: "fas fa-times",
					label: game.i18n.localize("Cancel"),
					callback: () => resolve(null),
				},
			],
			close: () => resolve(null),
		});
		dialog.render({ force: true }).then(() => {
			const root = dialog.element;
			const select = root.querySelector("#sdx-transfer-target");
			const filterCheckbox = root.querySelector("#sdx-filter-connected");
			const searchInput = root.querySelector("#sdx-transfer-search");

			const updateFilter = () => {
				const showOnlyConnected = !!filterCheckbox?.checked;
				const searchText = (searchInput?.value || "").toLowerCase().trim();

				root.querySelectorAll("#sdx-transfer-target optgroup").forEach(group => {
					const groupType = group.dataset.group;
					if (groupType === "other" && showOnlyConnected) {
						group.hidden = true;
						return;
					}
					let visibleCount = 0;
					group.querySelectorAll("option").forEach(option => {
						const optionSearch = option.dataset.search || "";
						const visible = searchText === "" || optionSearch.includes(searchText);
						option.hidden = !visible;
						if (visible) visibleCount++;
					});
					group.hidden = visibleCount === 0;
				});

				const selected = select?.options[select.selectedIndex];
				if (selected && (selected.hidden || selected.parentElement?.hidden)) {
					const firstVisible = Array.from(select.options).find(o => !o.hidden && !o.parentElement?.hidden);
					if (firstVisible) firstVisible.selected = true;
				}
			};

			updateFilter();
			filterCheckbox?.addEventListener("change", updateFilter);
			searchInput?.addEventListener("input", updateFilter);

			setTimeout(() => searchInput?.focus(), 100);
		});
	});
}

/**
 * Patch PlayerSheetSD to add "Transfer to Player" option to inventory context menu
 */
export function patchPlayerSheetForTransfers() {
	const PlayerSheetSD = CONFIG.Actor.sheetClasses.Player["shadowdark.PlayerSheetSD"]?.cls;
	if (!PlayerSheetSD) {
		console.warn(`${MODULE_ID} | Could not find PlayerSheetSD class to patch for transfers`);
		return;
	}

	// Store the original method
	const originalGetItemContextOptions = PlayerSheetSD.prototype._getItemContextOptions;

	// Replace with enhanced version
	PlayerSheetSD.prototype._getItemContextOptions = function() {
		const options = originalGetItemContextOptions.call(this);

		// Only add transfer option for Player actors
		if (this.actor?.type !== "Player") return options;

		// Add transfer option before delete
		options.splice(options.length - 1, 0, {
			name: game.i18n.localize("SHADOWDARK_EXTRAS.context_menu.transfer_to_player"),
			icon: '<i class="fas fa-share"></i>',
			condition: element => {
				// Only show if user owns the actor and there are other players
				if (!this.actor.isOwner) return false;
				const itemId = element.dataset.itemId;
				const item = this.actor.items.get(itemId);
				// Don't allow transfer of contained items (must be removed from container first)
				if (item?.getFlag(MODULE_ID, "containerId")) return false;
				// Don't allow transfer of containers (too complex to handle contents)
				if (item?.getFlag(MODULE_ID, "isContainer")) return false;
				// Check if there are other player characters or Party actors available
				const otherActors = game.actors.filter(a => {
					if (a.id === this.actor.id) return false;
					// Include Party actors (NPC type with party flag)
					const isParty = a.type === "NPC" && a.getFlag(MODULE_ID, "isParty");
					if (a.type !== "Player" && !isParty) return false;
					// For players, check if any user has owner permission
					if (!isParty) {
						return game.users.some(u => a.testUserPermission(u, "OWNER"));
					}
					return true; // Party actors always available
				});
				return otherActors.length > 0;
			},
			callback: async element => {
				const itemId = element.dataset.itemId;
				const item = this.actor.items.get(itemId);
				if (!item) return;

				const targetActorId = await showTransferDialog(this.actor, item);
				if (targetActorId) {
					await transferItemToPlayer(this.actor, item, targetActorId);
				}
			},
		});

		return options;
	};
}
