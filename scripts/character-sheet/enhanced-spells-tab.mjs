/**
 * The root's ENHANCED SPELLS TAB section, moved verbatim.
 *
 * Enhances the Spells tab on the Player sheet, including the generated
 * cast/focus/wand/scroll macro commands. One export, `enhanceSpellsTab`,
 * called from the actor-sheet dispatch.
 *
 * Worth knowing: the four generated macro bodies in here are template
 * literals containing lines like `const actor = game.actors.get(...)` at
 * column 0. A naive scan of the root reads those as module-scope
 * declarations named `actor` and `item`, and they show up as phantom
 * dependencies of every OTHER section. Moving this section removes that
 * noise from the root entirely.
 *
 * Registration-free, and apart from MODULE_ID it depended on nothing outside
 * itself. Zero registrations, so the registration snapshot is untouched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// ============================================
// ENHANCED SPELLS TAB
// ============================================

/**
 * Fix context menu positioning for enhanced tabs
 * The context menu needs to be positioned relative to the viewport when in fixed positioned tabs
 */
/**
 * Enhance the Spells tab with improved styling and organization
 */
export function enhanceSpellsTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $spellsTab = html.find('.tab[data-tab="tab-spells"]');
	if (!$spellsTab.length) return;

	// Add enhanced class to the spells tab
	$spellsTab.addClass("sdx-enhanced-spells");

	// Find the "Spells From Items" banner to detect which items should NOT have action buttons
	const $spellsFromItemsBanner = $spellsTab.find(".SD-banner").filter(function() {
		return $(this).text().trim().includes("Spells From Items");
	});

	// Get all elements after the "Spells From Items" banner (these should not have action buttons)
	const itemsFromWandsScrolls = new Set();
	if ($spellsFromItemsBanner.length > 0) {
		$spellsFromItemsBanner.nextAll().find(".item[data-item-id]").each(function() {
			itemsFromWandsScrolls.add($(this).data("item-id"));
		});
	}

	// Add action buttons to spell items
	$spellsTab.find(".item[data-item-id]").each((i, item) => {
		const $item = $(item);
		const itemId = $item.data("item-id");

		// Skip if buttons already added
		if ($item.find(".sdx-spell-actions").length) return;

		// Skip if this item is from a wand/scroll (comes after "Spells From Items" banner)
		if (itemsFromWandsScrolls.has(itemId)) {
			return;
		}

		// Find the item-name element
		const $itemName = $item.find(".item-name");
		if (!$itemName.length) return;

		// Create action buttons container
		const $actions = $(`
			<div class="sdx-spell-actions">
				<a class="sdx-spell-btn sdx-edit-spell" data-tooltip="Edit" title="Edit">
					<i class="fas fa-edit"></i>
				</a>
				<a class="sdx-spell-btn sdx-create-macro" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.macro.create_tooltip")}" title="${game.i18n.localize("SHADOWDARK_EXTRAS.macro.create_tooltip")}">
					<i class="fas fa-scroll"></i>
				</a>
				<a class="sdx-spell-btn sdx-transfer-spell" data-tooltip="Transfer to Player" title="Transfer to Player">
					<i class="fas fa-share"></i>
				</a>
				<a class="sdx-spell-btn sdx-delete-spell" data-tooltip="Delete" title="Delete">
					<i class="fas fa-trash"></i>
				</a>
			</div>
		`);

		// Insert actions after the item-name
		$itemName.after($actions);

		// Edit button handler
		$actions.find(".sdx-edit-spell").on("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item) item.sheet.render(true);
		});

		// Create Macro button handler
		$actions.find(".sdx-create-macro").on("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (!item) return;
			await createItemMacro(actor, item);
		});

		// Transfer button handler
		$actions.find(".sdx-transfer-spell").on("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item && game.user.isGM) {
				// Show player selection dialog
				const players = game.users.filter(u => !u.isGM && u.active);
				if (players.length === 0) {
					ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.notifications.no_active_players"));
					return;
				}

				const playerOptions = players.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
				const content = `
					<form>
						<div class="form-group">
							<label>${game.i18n.localize("SHADOWDARK_EXTRAS.dialog.select_player")}</label>
							<select name="playerId">${playerOptions}</select>
						</div>
					</form>
				`;

				new foundry.applications.api.DialogV2({
					window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer_spell_title") },
					content,
					buttons: [
						{
							action: "transfer",
							icon: "fas fa-share",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.transfer"),
							default: true,
							callback: async (event, button) => {
								const playerId = button.form.elements.playerId.value;
								const player = game.users.get(playerId);
								const targetActor = player?.character;

								if (!targetActor) {
									ui.notifications.error(game.i18n.localize("SHADOWDARK_EXTRAS.notifications.no_character_assigned"));
									return;
								}

								const itemData = item.toObject();
								await targetActor.createEmbeddedDocuments("Item", [itemData]);
								await item.delete();
								ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.notifications.item_transferred", {
									item: item.name,
									target: targetActor.name,
								}));
							},
						},
						{
							action: "cancel",
							icon: "fas fa-times",
							label: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.cancel"),
						},
					],
				}).render({ force: true });
			}
		});

		// Delete button handler
		$actions.find(".sdx-delete-spell").on("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (!item) return;

			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.inventory.delete_spell_title") },
				content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.inventory.delete_spell_text", { name: item.name })}</p>`,
				modal: true,
			});

			if (confirmed) {
				await item.delete();
			}
		});
	});
}

/**
 * Create a macro for a spell, wand, or scroll item
 * For focus spells, asks the user if they want a Cast or Focus macro
 * @param {Actor} actor - The actor that owns the item
 * @param {Item} item - The spell/wand/scroll item
 */
async function createItemMacro(actor, item) {
	const itemType = item.type;
	const isFocusSpell = item.system?.duration?.type === "focus";
	const actorId = actor.id;
	const itemId = item.id;
	const itemName = item.name;
	const itemImg = item.img;

	// Determine the action type based on item type
	let actionType = "cast"; // default for Spell
	if (itemType === "Wand") {
		actionType = "wand";
	}
	else if (itemType === "Scroll") {
		actionType = "scroll";
	}

	// For focus spells, ask if they want Cast or Focus macro
	if (isFocusSpell && itemType === "Spell") {
		const choice = await new Promise(resolve => {
			new foundry.applications.api.DialogV2({
				window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.macro.focus_choice_title") },
				content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.macro.focus_choice_content", { name: itemName })}</p>`,
				buttons: [
					{
						action: "cast",
						icon: "fas fa-magic",
						label: game.i18n.localize("SHADOWDARK_EXTRAS.macro.cast_spell"),
						default: true,
						callback: () => resolve("cast"),
					},
					{
						action: "focus",
						icon: "fas fa-brain",
						label: game.i18n.localize("SHADOWDARK_EXTRAS.macro.focus_roll"),
						callback: () => resolve("focus"),
					},
					{
						action: "cancel",
						icon: "fas fa-times",
						label: game.i18n.localize("SHADOWDARK_EXTRAS.dialog.cancel"),
						callback: () => resolve(null),
					},
				],
				close: () => resolve(null),
			}).render({ force: true });
		});

		if (!choice) return; // User cancelled
		actionType = choice;
	}

	// Build the macro command based on action type
	let command;
	let macroName;

	switch (actionType) {
		case "cast":
			command = `// Cast ${itemName}
const actor = game.actors.get("${actorId}");
if (!actor) {
	ui.notifications.error("Actor not found!");
	return;
}
const item = actor.items.get("${itemId}");
if (!item) {
	ui.notifications.error("Spell not found on actor!");
	return;
}
actor.system.castSpell(item.uuid);`;
			macroName = `${game.i18n.localize("SHADOWDARK_EXTRAS.macro.cast_prefix")} ${itemName}`;
			break;

		case "focus":
			command = `// Focus Roll for ${itemName}
const actor = game.actors.get("${actorId}");
if (!actor) {
	ui.notifications.error("Actor not found!");
	return;
}
const item = actor.items.get("${itemId}");
if (!item) {
	ui.notifications.error("Spell not found on actor!");
	return;
}
actor.system.castSpell(item.uuid, { isFocusRoll: true });`;
			macroName = `${game.i18n.localize("SHADOWDARK_EXTRAS.macro.focus_prefix")} ${itemName}`;
			break;

		case "wand":
			command = `// Use Wand: ${itemName}
const actor = game.actors.get("${actorId}");
if (!actor) {
	ui.notifications.error("Actor not found!");
	return;
}
const item = actor.items.get("${itemId}");
if (!item) {
	ui.notifications.error("Wand not found on actor!");
	return;
}
// SD 4.x: wands cast a spell stored on the item; there is no actor.useWand().
const wandSpell = (item.system.spells || []).find(s => !s.lost) || (item.system.spells || [])[0];
if (!wandSpell) {
	ui.notifications.warn("This wand has no spells to cast.");
	return;
}
actor.system.castSpell(wandSpell.uuid, { itemUuid: item.uuid });`;
			macroName = `${game.i18n.localize("SHADOWDARK_EXTRAS.macro.wand_prefix")} ${itemName}`;
			break;

		case "scroll":
			command = `// Use Scroll: ${itemName}
const actor = game.actors.get("${actorId}");
if (!actor) {
	ui.notifications.error("Actor not found!");
	return;
}
const item = actor.items.get("${itemId}");
if (!item) {
	ui.notifications.error("Scroll not found on actor!");
	return;
}
// SD 4.x: scrolls cast their stored spell; there is no actor.useScroll().
actor.system.castSpell(item.system.spellUuid, { itemUuid: item.uuid });`;
			macroName = `${game.i18n.localize("SHADOWDARK_EXTRAS.macro.scroll_prefix")} ${itemName}`;
			break;

		default:
			return;
	}

	// Create the macro
	const macro = await Macro.create({
		name: macroName,
		type: "script",
		scope: "global",
		img: itemImg,
		command: command,
		flags: {
			"shadowdark-extras": {
				itemMacro: true,
				actorId: actorId,
				itemId: itemId,
				itemType: itemType,
				actionType: actionType,
			},
		},
	});

	ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.macro.created", { name: macroName }));
}
