/**
 * NPC sheet inventory and creature type.
 *
 * Three root regions, moved verbatim and joined here because they are one
 * feature that the root had split across ~3,300 lines: the two state consts,
 * the NPC INVENTORY FUNCTIONS section, and the NPC CREATURE TYPE DROPDOWN
 * section.
 *
 * Bundling them is what makes this cheap. Taken separately, the consts and
 * the inventory helpers would each have had to export their names for the
 * dropdown section to reach them. Together, only the two the root's sheet
 * dispatch actually calls are exported — `injectNpcCreatureType` and
 * `injectNpcInventoryTab` — and the other six names stay private.
 *
 * `npcActiveTabTracker` comes with them. It is the module-scope Map that PR
 * #17's review correctly flagged as still-mutable state in the composition
 * root: a registration never referenced it directly, so it never appeared in
 * the inventory's shared-mutable-state table, but it was mutated all the
 * same. It belongs with the NPC sheet code that reads and writes it.
 *
 * Zero registrations, so the registration snapshot is untouched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { getCreatureTypes, getEffectiveCreatureType } from "./CreatureTypesApp.mjs";
import { calculateSlotsCostForItemData } from "../inventory/containers.mjs";
import { isPartyActor } from "../party/PartySheetSD.mjs";

// Item types that count as physical inventory for NPCs
const NPC_INVENTORY_TYPES = [
	"Armor",
	"Basic",
	"Gem",
	"Potion",
	"Scroll",
	"Wand",
	"Weapon",
];

// Track active tab per NPC sheet (by actor ID)
const npcActiveTabTracker = new Map();

// ============================================
// NPC INVENTORY FUNCTIONS
// ============================================

/**
 * Prepare NPC inventory data for rendering
 */
function prepareNpcInventory(actor) {
	const inventory = [];
	const treasure = [];
	let slotsUsed = 0;

	for (const item of actor.items) {
		if (!NPC_INVENTORY_TYPES.includes(item.type)) continue;
		if (!item.system.isPhysical) continue;

		const itemData = item.toObject();
		itemData.uuid = item.uuid;
		const itemSlots = calculateSlotsCostForItemData(itemData);
		if (Number.isFinite(itemSlots)) {
			slotsUsed += Math.max(0, itemSlots);
		}

		// Check if item should show quantity
		itemData.showQuantity = item.system.isAmmunition ||
			(item.system.slots?.per_slot > 1) ||
			item.system.quantity > 1;

		// Sort treasure items separately
		if (item.system.treasure) {
			treasure.push(itemData);
		} else {
			inventory.push(itemData);
		}
	}

	// Sort alphabetically
	inventory.sort((a, b) => a.name.localeCompare(b.name));
	treasure.sort((a, b) => a.name.localeCompare(b.name));

	return { inventory, treasure, slotsUsed };
}

/**
 * Get NPC coins from system data or module flags
 */
function getNpcCoins(actor) {
	return {
		gp: actor.system?.coins?.gp ?? actor.getFlag(MODULE_ID, "coins.gp") ?? 0,
		sp: actor.system?.coins?.sp ?? actor.getFlag(MODULE_ID, "coins.sp") ?? 0,
		cp: actor.system?.coins?.cp ?? actor.getFlag(MODULE_ID, "coins.cp") ?? 0,
	};
}

function calculateNpcCoinSlots(coins) {
	const gp = Number(coins?.gp ?? 0) || 0;
	const sp = Number(coins?.sp ?? 0) || 0;
	const cp = Number(coins?.cp ?? 0) || 0;
	const totalGpValue = gp + sp / 10 + cp / 100;
	return Math.max(0, Math.floor(totalGpValue / 100));
}

// ============================================
// NPC CREATURE TYPE DROPDOWN
// ============================================

// Note: Creature types are now managed dynamically via getCreatureTypes() from CreatureTypesApp.mjs

/**
 * Inject the creature type dropdown into NPC sheets
 * @param {Application} app - The NPC sheet application
 * @param {jQuery|HTMLElement} html - The rendered HTML
 * @param {Actor} actor - The NPC actor
 */
export function injectNpcCreatureType(app, html, actor) {
	//console.log(`${MODULE_ID} | injectNpcCreatureType called for ${actor.name}`);

	// Check if feature is enabled
	try {
		const enabled = game.settings.get(MODULE_ID, "enableNpcCreatureType");
		//console.log(`${MODULE_ID} | enableNpcCreatureType setting: ${enabled}`);
		if (!enabled) return;
	} catch (e) {
		console.warn(`${MODULE_ID} | Setting enableNpcCreatureType not registered or failed`, e);
		return;
	}

	// GM can edit; players see the value read-only
	const isGM = game.user?.isGM === true;

	// Handle both plain DOM element and jQuery object (for V13 compatibility)
	const $html = html instanceof HTMLElement ? $(html) : html;
	const currentType = getEffectiveCreatureType(actor);

	//console.log(`${MODULE_ID} | Current creature type: "${currentType}"`);

	// Build the options HTML using dynamic creature types
	const creatureTypes = [...getCreatureTypes()];
	// Ensure the effective value is always selectable, even if not in the configured list
	if (currentType && !creatureTypes.includes(currentType)) creatureTypes.push(currentType);
	const optionsHtml = creatureTypes.map(type => {
		const selected = type === currentType ? "selected" : "";
		const label = type || game.i18n.localize("SHADOWDARK_EXTRAS.npc.creature_type.none");
		return `<option value="${type}" ${selected}>${label}</option>`;
	}).join("");

	// Create the creature type box HTML
	const creatureTypeHtml = `
		<div class="SD-box sdx-creature-type-box">
			<div class="header">
				<label>${game.i18n.localize("SHADOWDARK_EXTRAS.npc.creature_type.label")}</label>
			</div>
			<div class="content">
				<select class="sdx-creature-type-select" name="flags.${MODULE_ID}.creatureType" ${isGM ? "" : "disabled"}>
					${optionsHtml}
				</select>
			</div>
		</div>
	`;

	// Find the attacks box (first SD-box in grid-1-columns on the right side)
	const $gridRight = $html.find(".grid-1-columns");
	//console.log(`${MODULE_ID} | Found ${$gridRight.length} elements with .grid-1-columns`);

	const $attacksBox = $gridRight.find(".SD-box").first();
	//console.log(`${MODULE_ID} | Found ${$attacksBox.length} potential attack boxes`);

	if ($attacksBox.length) {
		// Insert before the attacks box
		$attacksBox.before(creatureTypeHtml);
		//console.log(`${MODULE_ID} | Injected creature type box`);

		// Attach change handler (GM only; players see it read-only)
		if (isGM) $html.find(".sdx-creature-type-select").on("change", async function(e) {
			const newType = $(this).val();
			//console.log(`${MODULE_ID} | Changing creature type to: ${newType}`);
			await actor.setFlag(MODULE_ID, "creatureType", newType);
			ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.npc.creature_type.updated", {
				name: actor.name,
				type: newType || game.i18n.localize("SHADOWDARK_EXTRAS.npc.creature_type.none"),
			}));
		});
	} else {
		console.warn(`${MODULE_ID} | Could not find attacks box to insert creature type box`);
		// Fallback: try to find any SD-box in the main content
		const $anyBox = $html.find(".SD-box").first();
		if ($anyBox.length) {
			$anyBox.before(creatureTypeHtml);
			//console.log(`${MODULE_ID} | Injected creature type box using fallback`);
		}
	}
}

/**
 * Inject the inventory tab into NPC sheets
 */
export async function injectNpcInventoryTab(app, html, data) {
	const actor = app.actor;

	// Add the inventory tab to navigation (after Abilities)
	const nav = html.find(".SD-nav");
	const abilitiesTab = nav.find('a[data-tab="tab-abilities"]');

	const inventoryTabHtml = `<a class="navigation-tab" data-tab="tab-inventory">${game.i18n.localize("SHADOWDARK_EXTRAS.sheet.npc.tab.inventory")}</a>`;
	abilitiesTab.after(inventoryTabHtml);

	// Prepare inventory data
	const { inventory, treasure, slotsUsed } = prepareNpcInventory(actor);
	const coins = getNpcCoins(actor);
	const coinSlots = calculateNpcCoinSlots(coins);
	const safeItemSlots = Math.max(0, Number.isFinite(slotsUsed) ? slotsUsed : 0);
	const totalSlotsUsed = safeItemSlots + coinSlots;

	// Load and render the template
	const templatePath = `modules/${MODULE_ID}/templates/npc-inventory.hbs`;
	const templateData = {
		npcInventory: inventory,
		npcTreasure: treasure,
		npcCoins: coins,
		npcSlotsUsed: totalSlotsUsed,
		npcItemSlots: safeItemSlots,
		npcCoinSlots: coinSlots,
		owner: actor.isOwner,
	};

	const renderTpl = foundry.applications?.handlebars?.renderTemplate || renderTemplate;
	const inventoryHtml = await renderTpl(templatePath, templateData);

	// Insert after the abilities tab content
	const contentBody = html.find(".SD-content-body");
	const abilitiesSection = contentBody.find('.tab[data-tab="tab-abilities"]');
	abilitiesSection.after(inventoryHtml);

	// Get the newly added inventory tab button
	const inventoryTabBtn = nav.find('.navigation-tab[data-tab="tab-inventory"]');
	const inventoryContent = contentBody.find('.tab[data-tab="tab-inventory"]');

	// Handle inventory tab click manually since it's not part of the system's tab handler
	inventoryTabBtn.click((event) => {
		event.preventDefault();
		event.stopPropagation();

		// Remove active from all tabs and content
		nav.find(".navigation-tab").removeClass("active");
		contentBody.find(".tab").removeClass("active");

		// Activate inventory tab
		inventoryTabBtn.addClass("active");
		inventoryContent.addClass("active");

		// Update the system's tab controller to know we're on a custom tab
		// This prevents it from thinking abilities is still active
		if (app._tabs?.[0]) {
			app._tabs[0].active = "tab-inventory";
		}

		// Track that inventory is active
		npcActiveTabTracker.set(actor.id, "tab-inventory");
	});

	// Track when OTHER tabs are clicked (to clear our inventory tracking)
	nav.find('.navigation-tab:not([data-tab="tab-inventory"])').click(() => {
		npcActiveTabTracker.set(actor.id, null);
	});

	// Restore the inventory tab if it was previously active
	const lastActiveTab = npcActiveTabTracker.get(actor.id);
	if (lastActiveTab === "tab-inventory") {
		// Activate inventory tab
		nav.find(".navigation-tab").removeClass("active");
		inventoryTabBtn.addClass("active");
		contentBody.find(".tab").removeClass("active");
		inventoryContent.addClass("active");

		// Update the system's tab controller
		if (app._tabs?.[0]) {
			app._tabs[0].active = "tab-inventory";
		}
	}

	// Activate inventory tab listeners
	activateNpcInventoryListeners(html, actor);
}

/**
 * Activate event listeners for NPC inventory
 */
function activateNpcInventoryListeners(html, actor) {
	// Create new item
	html.find('[data-action="npc-create-item"]').click(async (event) => {
		event.preventDefault();
		const itemData = {
			name: game.i18n.localize("SHADOWDARK_EXTRAS.sheet.npc.inventory.new_item"),
			type: "Basic",
			img: "icons/svg/item-bag.svg",
		};
		await actor.createEmbeddedDocuments("Item", [itemData]);
	});

	// Increment item quantity
	html.find('[data-action="npc-item-increment"]').click(async (event) => {
		event.preventDefault();
		const itemId = event.currentTarget.dataset.itemId;
		const item = actor.items.get(itemId);
		if (item) {
			const newQty = (item.system.quantity || 1) + 1;
			await item.update({ "system.quantity": newQty });
		}
	});

	// Decrement item quantity
	html.find('[data-action="npc-item-decrement"]').click(async (event) => {
		event.preventDefault();
		const itemId = event.currentTarget.dataset.itemId;
		const item = actor.items.get(itemId);
		if (item && item.system.quantity > 1) {
			const newQty = item.system.quantity - 1;
			await item.update({ "system.quantity": newQty });
		}
	});

	// Make items draggable
	html.find('.npc-item-list .item[draggable="true"]').each((i, li) => {
		li.addEventListener("dragstart", (event) => {
			const uuid = li.dataset.uuid;
			if (!uuid) return;

			const dragData = {
				type: "Item",
				uuid: uuid,
			};

			event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
		});
	});
}

/**
 * Move-vs-copy behaviour when dropping an item onto an NPC sheet.
 *
 * Moved from the composition root in Phase 3, into the module that already
 * owns NPC sheet inventory rather than a new file of its own.
 */
/**
 * Patch NPC sheet to handle item drops with move vs copy behavior
 */
export function patchNpcSheetForItemDrops(app) {
	// Only patch once per sheet instance
	if (app._sdxDropPatched) return;
	app._sdxDropPatched = true;

	// Store the original _onDrop if it exists
	const originalOnDrop = app._onDrop?.bind(app);

	// Override the _onDrop method to intercept drops on the inventory tab
	app._onDrop = async function(event) {
		// Check if we're on the inventory tab
		const inventoryTab = event.target.closest(".shadowdark-extras-npc-inventory");
		if (!inventoryTab) {
			// Not on inventory tab, use original handler
			if (originalOnDrop) return originalOnDrop(event);
			return;
		}

		// Get the drag data
		let data;
		try {
			data = JSON.parse(event.dataTransfer.getData("text/plain"));
		} catch (err) {
			return;
		}

		if (data.type !== "Item") return;

		// Get the source item
		const sourceItem = await fromUuid(data.uuid);
		if (!sourceItem) return;

		const targetActor = this.actor;
		const sourceActor = sourceItem.parent;

		// Check if we're moving or copying (Ctrl = copy, default = move)
		const isCopy = event.ctrlKey;

		// Don't do anything if dropping on same actor
		if (sourceActor === targetActor && !isCopy) return;

		// Create the item on target actor
		const itemData = sourceItem.toObject();
		delete itemData._id; // Remove the ID so a new one is created

		await targetActor.createEmbeddedDocuments("Item", [itemData]);

		// If moving (not copying), delete from source
		if (!isCopy && sourceActor && sourceActor !== targetActor) {
			await sourceItem.delete();
			ui.notifications.info(
				game.i18n.format("SHADOWDARK_EXTRAS.notifications.item_moved", {
					item: sourceItem.name,
					target: targetActor.name,
				})
			);
		} else if (isCopy) {
			ui.notifications.info(
				game.i18n.format("SHADOWDARK_EXTRAS.notifications.item_copied", {
					item: sourceItem.name,
					target: targetActor.name,
				})
			);
		}
	};
}

/**
 * Applying the player-sheet theme to an NPC sheet.
 *
 * Moved from the composition root in Phase 3. Two callers, both NPC sheet
 * render paths, so it lands beside the rest of the NPC sheet work.
 */
export function applyNpcPlayerTheme(app, html, actor) {
	if (actor?.type !== "NPC") return;
	if (isPartyActor(actor)) return;

	const $html = html instanceof jQuery ? html : $(html);
	const $sheet = $html.closest(".shadowdark.sheet.npc").length
		? $html.closest(".shadowdark.sheet.npc")
		: $html;

	if (!game.settings.get(MODULE_ID, "enableNpcPlayerTheme")) {
		$sheet.removeClass("sdx-npc-player-theme");
		$html.find(".SD-header").first().removeClass("sdx-npc-themed-header");
		$html.find(".SD-content-body").first().removeClass("sdx-npc-themed-content");
		return;
	}

	$sheet.addClass("sdx-npc-player-theme");

	$html.find(".SD-header").first().addClass("sdx-npc-themed-header");
	$html.find(".SD-content-body").first().addClass("sdx-npc-themed-content");
}
