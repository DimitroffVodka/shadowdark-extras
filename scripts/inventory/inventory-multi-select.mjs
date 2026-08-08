/**
 * The root's INVENTORY ENHANCEMENTS (delete button, multi-select) section,
 * moved verbatim.
 *
 * Inventory row multi-select, the delete button, and the context-menu patch
 * that lets a multi-selection be deleted in one action — including the
 * recursive delete that takes a container's contents with it.
 *
 * One export, `enhanceInventoryWithDeleteAndMultiSelect`, called from the
 * actor-sheet dispatch. `patchContextMenuForMultiDelete` and
 * `deleteItemWithContents` stay private: both are reached only from within
 * this section.
 *
 * `_selectedItems` is the selection state and moves off the root with the
 * code that owns it — one fewer module-scope declaration in the composition
 * root.
 *
 * Registration-free and self-contained: apart from MODULE_ID it used nothing
 * defined or imported outside itself. Zero registrations, so the registration
 * snapshot is untouched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// ============================================
// INVENTORY ENHANCEMENTS (delete button, multi-select)
// ============================================

// Track selected items per actor sheet
const _selectedItems = new WeakMap();

function getSelectedItems(app) {
	return _selectedItems.get(app) || new Set();
}

function setSelectedItems(app, items) {
	_selectedItems.set(app, items);
}

function clearSelectedItems(app) {
	_selectedItems.set(app, new Set());
}

/**
 * Add delete buttons and multi-select functionality to actor sheet inventory
 */
export function enhanceInventoryWithDeleteAndMultiSelect(app, html) {
	// Check if multi-select is enabled
	if (!game.settings.get(MODULE_ID, "enableMultiselect")) return;

	const actor = app?.actor;
	if (!actor?.isOwner) return;

	// Initialize selected items set for this app
	if (!_selectedItems.has(app)) {
		clearSelectedItems(app);
	}

	// Add CSS for selection and delete button
	if (!document.getElementById("sdx-inventory-enhance-styles")) {
		const style = document.createElement("style");
		style.id = "sdx-inventory-enhance-styles";
		style.textContent = `
			.sdx-item-selected {
				background-color: rgba(100, 149, 237, 0.3) !important;
				outline: 1px solid cornflowerblue;
			}
			.sdx-item-buttons {
				display: inline-flex;
				align-items: center;
				gap: 3px;
				margin-left: 6px;
				position: absolute;
				right: 27px;
				top: 50%;
				transform: translateY(-50%);
			}
			.item[data-item-id] {
				position: relative;
				cursor: pointer;
			}
			.sdx-item-btn {
				cursor: pointer;
				opacity: 0.5;
				font-size: 13px;
				line-height: 1;
			}
			.sdx-item-btn:hover {
				opacity: 1;
			}
			.sdx-edit-btn:hover {
				color: #000;
			}
		`;
		document.head.appendChild(style);
	}

	// Find all item rows in the inventory
	const itemRows = html.find(".item[data-item-id]");

	itemRows.each((_, el) => {
		const $row = $(el);
		const itemId = $row.data("itemId");
		if (!itemId) return;

		const item = actor.items.get(itemId);
		const isContainer = item?.type === "Basic" && Boolean(item.getFlag?.(MODULE_ID, "isContainer"));

		// Add edit button for containers if not already present
		if (isContainer && !$row.find(".sdx-item-buttons").length) {
			const $btnContainer = $('<span class="sdx-item-buttons"></span>');
			const editBtn = $(`<a class="sdx-item-btn sdx-edit-btn" data-item-id="${itemId}" title="${game.i18n.localize("SHADOWDARK_EXTRAS.inventory.edit_container")}"><i class="fas fa-box-open"></i></a>`);
			$btnContainer.append(editBtn);
			$row.append($btnContainer);
		}

		// Update selection visual state
		const selected = getSelectedItems(app);
		if (selected.has(itemId)) {
			$row.addClass("sdx-item-selected");
		}
		else {
			$row.removeClass("sdx-item-selected");
		}
	});

	// Handle click for multi-select (Shift+Click to add to selection, Click to single select)
	html.find(".item[data-item-id]").off("click.sdxSelect").on("click.sdxSelect", ev => {
		// Don't handle if clicking on a link, button, input, or the item name (which opens the sheet)
		const target = ev.target;
		if ($(target).closest("a:not(.sdx-edit-btn), button, input, .item-name, .item-image").length) {
			return;
		}

		ev.preventDefault();
		ev.stopPropagation();

		const $row = $(ev.currentTarget);
		const itemId = $row.data("itemId");
		if (!itemId) return;

		const selected = getSelectedItems(app);

		if (ev.shiftKey) {
			// Toggle selection with Shift
			if (selected.has(itemId)) {
				selected.delete(itemId);
				$row.removeClass("sdx-item-selected");
			}
			else {
				selected.add(itemId);
				$row.addClass("sdx-item-selected");
			}
		}
		else if (ev.ctrlKey || ev.metaKey) {
			// Toggle selection with Ctrl/Cmd
			if (selected.has(itemId)) {
				selected.delete(itemId);
				$row.removeClass("sdx-item-selected");
			}
			else {
				selected.add(itemId);
				$row.addClass("sdx-item-selected");
			}
		}
		else {
			// Single click without modifier: clear selection and select just this one
			html.find(".item[data-item-id]").removeClass("sdx-item-selected");
			selected.clear();
			selected.add(itemId);
			$row.addClass("sdx-item-selected");
		}

		setSelectedItems(app, selected);
	});

	// Handle edit button click (for containers)
	html.find(".sdx-edit-btn").off("click.sdxEdit").on("click.sdxEdit", async ev => {
		ev.preventDefault();
		ev.stopPropagation();

		const itemId = $(ev.currentTarget).data("itemId");
		const item = actor.items.get(itemId);
		if (!item) return;

		item.sheet.render(true);
	});

	// Patch the context menu to add "Delete Selected" option
	patchContextMenuForMultiDelete(app, html);
}

/**
 * Delete an item and its contained items if it's a container
 */
async function deleteItemWithContents(actor, item) {
	const isContainer = item.type === "Basic" && Boolean(item.getFlag?.(MODULE_ID, "isContainer"));

	if (isContainer) {
		// Delete contained items first
		const containedItems = actor.items.filter(i => i.getFlag(MODULE_ID, "containerId") === item.id);
		for (const contained of containedItems) {
			await contained.delete({ sdxInternal: true });
		}
	}

	await item.delete({ sdxInternal: true });
}

/**
 * Patch the context menu to include a "Delete Selected" option when multiple items are selected
 */
function patchContextMenuForMultiDelete(app, html) {
	const actor = app?.actor;
	if (!actor) return;

	// We need to intercept the context menu creation
	// Shadowdark uses foundry.applications.ux.ContextMenu.implementation
	// We'll add our own context menu handler for selected items

	html.find(".item[data-item-id]").off("contextmenu.sdxMulti").on("contextmenu.sdxMulti", async ev => {
		const selected = getSelectedItems(app);

		// If multiple items selected and right-clicking on a selected item, show multi-delete menu
		if (selected.size > 1) {
			const $row = $(ev.currentTarget);
			const itemId = $row.data("itemId");

			if (selected.has(itemId)) {
				ev.preventDefault();
				ev.stopPropagation();

				// Build context menu options
				const menuItems = [
					{
						name: game.i18n.format("SHADOWDARK_EXTRAS.inventory.delete_selected", { count: selected.size }),
						icon: '<i class="fas fa-trash"></i>',
						callback: async () => {
							const confirmed = await foundry.applications.api.DialogV2.confirm({
								window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.inventory.delete_confirm_title") },
								content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.inventory.delete_confirm_multiple", { count: selected.size })}</p>`,
								modal: true,
							});

							if (confirmed) {
								const itemIds = Array.from(selected);
								for (const id of itemIds) {
									const item = actor.items.get(id);
									if (item) {
										await deleteItemWithContents(actor, item);
									}
								}
								clearSelectedItems(app);
								app.render();
							}
						},
					},
					{
						name: game.i18n.localize("SHADOWDARK_EXTRAS.inventory.clear_selection"),
						icon: '<i class="fas fa-times"></i>',
						callback: () => {
							clearSelectedItems(app);
							html.find(".item[data-item-id]").removeClass("sdx-item-selected");
						},
					},
				];

				// Create and show context menu
				const menu = new foundry.applications.ux.ContextMenu.implementation(
					html.get(0),
					".item[data-item-id]",
					menuItems,
					{ jQuery: false, eventName: "sdx-contextmenu" }
				);

				// Position and render the menu manually
				menu.render(ev.currentTarget, { event: ev.originalEvent });
			}
		}
	});
}
