/**
 * Conditions quick toggles.
 *
 * The whole CONDITIONS QUICK TOGGLES section moved verbatim out of the
 * composition root, together with the three ActiveEffect hooks that existed
 * only to drive it. Those hooks live 5,000 lines away from the section in the
 * root; they are the same feature.
 *
 * Only three names are exported, because only three are used outside:
 * `injectConditionsToggles` from the Player and NPC sheet render hooks, and
 * `getConditionsData`/`showConditionsModal` from the module API.
 *
 * The three ActiveEffect hooks (createActiveEffect / deleteActiveEffect /
 * updateActiveEffect) and their private toggle-refresh helper were REMOVED
 * in Phase 5.2.5 (issue #56): they looked for `.sdx-condition-toggle`
 * inside the actor sheet, but the toggles have always lived in the modal
 * appended to BODY, so the hooks were a permanent silent no-op. The modal
 * self-updates on toggle click (`refreshModalConditionOrder`) and closes on
 * its own (close button, backdrop, ESC) — the sheet has nothing to refresh.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// ============================================
// CONDITIONS QUICK TOGGLES
// ============================================

/**
 * Add inline control buttons to effect/condition items
 */
function addInlineEffectControls($effectsTab, actor) {
	const $items = $effectsTab.find(".item.effect");

	$items.each(function() {
		const $item = $(this);

		// Skip if already has controls
		if ($item.find(".sdx-effect-controls").length) return;

		const itemId = $item.data("item-id");
		const itemUuid = $item.data("uuid");

		if (!itemId) return;

		// Create control buttons
		const $controls = $(`
			<div class="sdx-effect-controls">
				<button type="button" class="sdx-effect-edit" data-tooltip="Edit" title="Edit">
					<i class="fas fa-edit"></i>
				</button>
				<button type="button" class="sdx-effect-delete" data-tooltip="Delete" title="Delete">
					<i class="fas fa-trash"></i>
				</button>
			</div>
		`);

		// Add controls to the item
		$item.append($controls);

		// Disable right-click context menu
		$item.on("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			return false;
		});

		// Edit button
		$controls.find(".sdx-effect-edit").on("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item) item.sheet.render(true);
		});

		// Delete button
		$controls.find(".sdx-effect-delete").on("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item) {
				const confirm = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Effect" },
					content: `<p>Are you sure you want to delete <strong>${item.name}</strong>?</p>`,
					modal: true,
				});

				if (confirm) {
					await item.delete();
					ui.notifications.info(`Deleted ${item.name}`);
				}
			}
		});
	});
}


/**
 * Get all conditions data for the modal
 */
export async function getConditionsData() {
	let conditions = [];

	// Try shadowdark-extras first
	const sdxItemsPack = game.packs.get("shadowdark-extras.pack-sdxitems");
	if (sdxItemsPack) {
		const sdxDocs = await sdxItemsPack.getDocuments();
		const sdxConditions = sdxDocs.filter(doc =>
			doc.type === "Effect" &&
			(doc.name.startsWith("Condition:") || doc.name.startsWith("Absorption:"))
		);
		conditions.push(...sdxConditions);
	}

	// Then add shadowdark conditions (but don't duplicate)
	const conditionsPack = game.packs.get("shadowdark.conditions");
	if (conditionsPack) {
		const shadowdarkConditions = await conditionsPack.getDocuments();
		// Only add conditions that aren't already in our list (by name)
		const existingNames = new Set(conditions.map(c => c.name));
		const uniqueShadowdarkConditions = shadowdarkConditions.filter(c => !existingNames.has(c.name));
		conditions.push(...uniqueShadowdarkConditions);
	}

	if (!conditions || conditions.length === 0) {
		console.warn(`${MODULE_ID} | No conditions found in either compendium`);
		return {};
	}

	// Group conditions by base name (store minimal data, not document references)
	const groupedConditions = groupConditionsByBaseName(conditions);

	// Convert grouped conditions to plain data objects to avoid holding document references
	const conditionDataMap = {};
	for (const [baseName, conditionGroup] of Object.entries(groupedConditions)) {
		conditionDataMap[baseName] = conditionGroup.map(cond => ({
			uuid: cond.uuid,
			name: cond.name,
			img: cond.img,
			description: cond.system?.description?.value || cond.system?.description || "",
		}));
	}

	return conditionDataMap;
}

/**
 * Inject conditions quick toggles into the Effects tab
 */
export async function injectConditionsToggles(app, html, actor) {
	if (actor.type !== "Player" && actor.type !== "NPC") return;

	// Find the active effects section
	const $effectsTab = html.find('.tab[data-tab="tab-effects"]');
	if (!$effectsTab.length) return;

	// Check if we've already injected (avoid duplicates on re-render)
	if ($effectsTab.find(".sdx-conditions-toggles").length) return;

	// Add inline control buttons to existing effects/conditions
	addInlineEffectControls($effectsTab, actor);

	// Fetch all conditions data
	const conditionDataMap = await getConditionsData();

	if (!conditionDataMap || Object.keys(conditionDataMap).length === 0) return;

	// Get currently active condition items on the actor
	const conditionItems = actor.items.filter(item =>
		item.type === "Effect" &&
		(item.name.startsWith("Condition:") || item.name.startsWith("Absorption:"))
	);

	// Get the selected theme
	const theme = game.settings.get(MODULE_ID, "conditionsTheme") || "parchment";

	// Build the button HTML
	let togglesHtml = `<div class="sdx-conditions-toggles sdx-theme-${theme}">`;
	togglesHtml += '<h3 class="sdx-conditions-header">Quick Conditions</h3>';
	togglesHtml += '<button class="sdx-add-condition-btn" type="button">';
	togglesHtml += '<i class="fas fa-plus"></i> Add Condition';
	togglesHtml += "</button>";
	togglesHtml += "</div>";

	// Insert after the active effects section
	const $activeEffects = $effectsTab.find(".active-effects, .effects-list").last();
	if ($activeEffects.length) {
		$activeEffects.after(togglesHtml);
	}
	else {
		// Fallback: append to the tab
		$effectsTab.append(togglesHtml);
	}

	// Attach event handler to the Add Condition button
	const $addConditionBtn = $effectsTab.find(".sdx-add-condition-btn");
	$addConditionBtn.on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();

		if (!actor.isOwner) return;

		showConditionsModal(actor, conditionDataMap, theme);
	});
}

/**
 * Show the conditions modal for selecting/toggling conditions
 */
export function showConditionsModal(actor, conditionDataMap, theme) {
	// Remove any existing modal
	$(".sdx-conditions-modal").remove();

	// Get currently active condition items on the actor
	const conditionItems = actor.items.filter(item =>
		item.type === "Effect" &&
		(item.name.startsWith("Condition:") || item.name.startsWith("Absorption:"))
	);

	// Build the modal HTML
	let modalHtml = `
		<div class="sdx-conditions-modal">
			<div class="sdx-conditions-modal-backdrop"></div>
			<div class="sdx-conditions-modal-content sdx-theme-${theme}">
				<div class="sdx-conditions-modal-header">
					<h2>Select Condition</h2>
					<button class="sdx-conditions-modal-close" type="button">
						<i class="fas fa-times"></i>
					</button>
				</div>
				<div class="sdx-conditions-modal-search">
					<input type="text" class="sdx-conditions-search-input" placeholder="Search conditions..." />
				</div>
				<div class="sdx-conditions-modal-grid-container">
					<div class="sdx-conditions-modal-grid">
	`;

	// Flatten all conditions (no grouping)
	const allConditions = [];
	for (const [baseName, conditionGroup] of Object.entries(conditionDataMap)) {
		for (const condition of conditionGroup) {
			// Check if this specific condition is active
			const isActive = conditionItems.some(item =>
				item.name === condition.name ||
				(item._stats?.compendiumSource === condition.uuid) ||
				(item.flags?.core?.sourceId === condition.uuid)
			);

			allConditions.push({
				condition,
				isActive,
			});
		}
	}

	// Separate active and inactive
	const activeConditions = allConditions.filter(c => c.isActive);
	const inactiveConditions = allConditions.filter(c => !c.isActive);

	// Sort each group alphabetically by name
	const sortByName = (a, b) => a.condition.name.localeCompare(b.condition.name);
	activeConditions.sort(sortByName);
	inactiveConditions.sort(sortByName);

	// Render active conditions first, then inactive
	const sortedConditions = [...activeConditions, ...inactiveConditions];

	for (const { condition, isActive } of sortedConditions) {
		const displayName = condition.name.replace("Condition: ", "");
		const rawDescription = condition.description || "";
		const processedDescription = rawDescription.replace(/"/g, "&quot;").replace(/'/g, "&#39;");

		modalHtml += `
			<div class="sdx-condition-toggle ${isActive ? "active" : ""}"
				 data-condition-uuid="${condition.uuid}"
				 data-condition-name="${condition.name}"
				 data-display-name="${displayName}"
				 data-condition-description="${processedDescription}">
				<img src="${condition.img}" alt="${displayName}" />
				<span class="sdx-condition-name">${displayName}</span>
			</div>
		`;
	}

	modalHtml += `
					</div>
				</div>
			</div>
		</div>
	`;

	// Append modal to body
	const $modal = $(modalHtml);
	$("body").append($modal);

	// Get references to modal elements
	const $modalContent = $modal.find(".sdx-conditions-modal-content");
	const $searchInput = $modal.find(".sdx-conditions-search-input");
	const $grid = $modal.find(".sdx-conditions-modal-grid");
	const $toggles = $grid.find(".sdx-condition-toggle");

	// Focus search input
	setTimeout(() => $searchInput.focus(), 100);

	// Close button handler
	$modal.find(".sdx-conditions-modal-close").on("click", () => {
		$modal.remove();
	});

	// Backdrop click handler
	$modal.find(".sdx-conditions-modal-backdrop").on("click", () => {
		$modal.remove();
	});

	// ESC key handler
	$(document).on("keydown.sdx-conditions-modal", (e) => {
		if (e.key === "Escape") {
			$modal.remove();
			$(document).off("keydown.sdx-conditions-modal");
		}
	});

	// Remove ESC handler when modal is removed
	$modal.on("remove", () => {
		$(document).off("keydown.sdx-conditions-modal");
	});

	// Search/filter handler
	$searchInput.on("input", function() {
		const searchTerm = $(this).val().toLowerCase().trim();

		$grid.find(".sdx-condition-toggle").each(function() {
			const $toggle = $(this);
			const displayName = $toggle.data("display-name") || $toggle.data("condition-name") || "";
			const conditionName = displayName.toString().toLowerCase();

			if (conditionName.includes(searchTerm)) {
				$toggle.show();
			}
			else {
				$toggle.hide();
			}
		});
	});

	// Condition toggle click handler - use event delegation so it works after re-sorting
	$grid.on("click", ".sdx-condition-toggle", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		if (!actor.isOwner) return;

		const $toggle = $(this);
		const conditionUuid = $toggle.data("condition-uuid");
		const conditionName = $toggle.data("condition-name");
		const isActive = $toggle.hasClass("active");

		if (isActive) {
			await removeConditionFromActor(actor, conditionName, conditionUuid);
			$toggle.removeClass("active");
		}
		else {
			await addConditionToActor(actor, conditionUuid);
			$toggle.addClass("active");
		}

		// Re-sort conditions: move to top if now active, or to inactive section if now inactive
		refreshModalConditionOrder($grid, actor);
	});
}

/**
 * Refresh the order of conditions in the modal (active ones at top)
 */
function refreshModalConditionOrder($grid, actor) {
	// Get currently active condition items on the actor
	const conditionItems = actor.items.filter(item =>
		item.type === "Effect" &&
		(item.name.startsWith("Condition:") || item.name.startsWith("Absorption:"))
	);

	// Get all toggles from the grid
	const $toggles = $grid.find(".sdx-condition-toggle");

	// Separate toggles into active and inactive
	const activeToggles = [];
	const inactiveToggles = [];

	$toggles.each(function() {
		const $toggle = $(this);
		const conditionUuid = $toggle.data("condition-uuid");
		const conditionName = $toggle.data("condition-name");

		// Update active class based on current actor state
		const isActive = conditionItems.some(item =>
			item.name === conditionName ||
			(item._stats?.compendiumSource === conditionUuid) ||
			(item.flags?.core?.sourceId === conditionUuid)
		);

		// Update the active class
		if (isActive) {
			$toggle.addClass("active");
			activeToggles.push($toggle);
		}
		else {
			$toggle.removeClass("active");
			inactiveToggles.push($toggle);
		}
	});

	// Sort each group alphabetically by condition name
	const sortByName = (a, b) => {
		const nameA = (a.data("condition-name") || "").toString().toLowerCase();
		const nameB = (b.data("condition-name") || "").toString().toLowerCase();
		return nameA.localeCompare(nameB);
	};

	activeToggles.sort(sortByName);
	inactiveToggles.sort(sortByName);

	// Re-append in order: active first, then inactive
	$grid.empty();
	activeToggles.forEach($toggle => $grid.append($toggle));
	inactiveToggles.forEach($toggle => $grid.append($toggle));
}

/**
 * Show a submenu to select condition variant inside the modal
 */
function showConditionSubmenuInModal($toggle, variants, actor, conditionItems, $grid) {
	// Remove any existing submenu
	$(".sdx-condition-submenu").remove();

	// Get theme for styling
	const theme = game.settings.get(MODULE_ID, "conditionsTheme") || "parchment";

	// Build submenu HTML with theme class
	let submenuHtml = `<div class="sdx-condition-submenu sdx-theme-${theme}">`;

	for (const variant of variants) {
		const isActive = conditionItems.some(item =>
			item.name === variant.name ||
			(item._stats?.compendiumSource === variant.uuid) ||
			(item.flags?.core?.sourceId === variant.uuid)
		);

		// Extract the variant part (e.g., "1", "Cha", etc.)
		const match = variant.name.match(/\(([^)]+)\)\s*$/);
		const variantLabel = match ? match[1] : variant.name.replace("Condition: ", "");

		submenuHtml += `
			<div class="sdx-submenu-item ${isActive ? "active" : ""}"
				 data-condition-uuid="${variant.uuid}"
				 data-condition-name="${variant.name}">
				<span>${variantLabel}</span>
				${isActive ? '<i class="fas fa-check"></i>' : ""}
			</div>
		`;
	}

	submenuHtml += "</div>";

	// Append submenu to body for proper positioning (avoid overflow clipping)
	const $submenu = $(submenuHtml);
	$("body").append($submenu);

	// Get the toggle's position and calculate submenu placement
	const rect = $toggle[0].getBoundingClientRect();
	const submenuHeight = $submenu.outerHeight();
	const spaceBelow = window.innerHeight - rect.bottom;

	// Position the submenu
	$submenu.css({
		"position": "fixed",
		"left": rect.left + "px",
		"width": rect.width + "px",
		"min-width": "120px",
	});

	if (spaceBelow < submenuHeight && rect.top > submenuHeight) {
		// Position above if not enough space below
		$submenu.css("top", (rect.top - submenuHeight) + "px");
	}
	else {
		// Position below
		$submenu.css("top", rect.bottom + "px");
	}

	// Handle submenu item clicks
	$submenu.find(".sdx-submenu-item").on("click", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $item = $(this);
		const conditionUuid = $item.data("condition-uuid");
		const conditionName = $item.data("condition-name");
		const isActive = $item.hasClass("active");

		if (isActive) {
			await removeConditionFromActor(actor, conditionName, conditionUuid);
		}
		else {
			await addConditionToActor(actor, conditionUuid);
		}

		// Close the submenu
		$submenu.remove();

		// Refresh the modal to update active states and resort
		refreshModalConditionOrder($grid, actor);
	});

	// Close submenu when clicking outside
	setTimeout(() => {
		$(document).one("click", () => {
			$submenu.remove();
		});
	}, 10);
}

/**
 * Convert @UUID[...]{text} links to clickable spans
 */
function convertUUIDLinksToClickable(text) {
	// Match @UUID[uuid]{label} or @UUID[uuid]
	return text.replace(/@UUID\[([^\]]+)\](?:\{([^\}]+)\})?/g, (match, uuid, label) => {
		const displayText = label || uuid.split(".").pop();
		return `<span class="sdx-uuid-link" data-uuid="${uuid}">${displayText}</span>`;
	});
}

/**
 * Group conditions by their base name (without variant specifier)
 */
function groupConditionsByBaseName(conditions) {
	const groups = {};

	for (const condition of conditions) {
		const name = condition.name;
		// Extract base name by removing variants like (1), (Cha), etc.
		const baseName = name.replace(/\s*\([^)]+\)\s*$/, "").trim();

		if (!groups[baseName]) {
			groups[baseName] = [];
		}
		groups[baseName].push(condition);
	}

	// Sort groups alphabetically and sort variants within each group
	const sortedGroups = {};
	Object.keys(groups).sort().forEach(key => {
		sortedGroups[key] = groups[key].sort((a, b) => a.name.localeCompare(b.name));
	});

	return sortedGroups;
}

/**
 * Show a submenu to select condition variant
 */
function showConditionSubmenu($toggle, variants, actor, conditionItems) {
	/**console.log(`${MODULE_ID} | showConditionSubmenu called`, {
		toggle: $toggle[0],
		variants: variants,
		variantsLength: variants?.length,
		actor: actor?.name
	});*/

	// Check if variants is valid
	if (!variants || variants.length === 0) {
		console.error(`${MODULE_ID} | No variants provided to showConditionSubmenu!`);
		return;
	}

	// Remove any existing submenu
	$(".sdx-condition-submenu").remove();

	// Get theme for styling
	const theme = game.settings.get(MODULE_ID, "conditionsTheme") || "parchment";

	// Build submenu HTML with theme class
	let submenuHtml = `<div class="sdx-condition-submenu sdx-theme-${theme}">`;

	for (const variant of variants) {
		const isActive = conditionItems.some(item =>
			item.name === variant.name ||
			(item._stats?.compendiumSource === variant.uuid) ||
			(item.flags?.core?.sourceId === variant.uuid)
		);

		// Extract the variant part (e.g., "1", "Cha", etc.)
		const match = variant.name.match(/\(([^)]+)\)\s*$/);
		const variantLabel = match ? match[1] : variant.name.replace("Condition: ", "");

		submenuHtml += `
			<div class="sdx-submenu-item ${isActive ? "active" : ""}"
				 data-condition-uuid="${variant.uuid}"
				 data-condition-name="${variant.name}">
				<span>${variantLabel}</span>
				${isActive ? '<i class="fas fa-check"></i>' : ""}
			</div>
		`;
	}

	submenuHtml += "</div>";

	// Append submenu to body for proper positioning (avoid overflow clipping)
	const $submenu = $(submenuHtml);
	$("body").append($submenu);

	// Get the toggle's position and calculate submenu placement
	const rect = $toggle[0].getBoundingClientRect();
	const submenuHeight = $submenu.outerHeight();
	const spaceBelow = window.innerHeight - rect.bottom;

	// Position the submenu
	$submenu.css({
		"position": "fixed",
		"left": rect.left + "px",
		"width": rect.width + "px",
		"min-width": "120px",
	});

	if (spaceBelow < submenuHeight && rect.top > submenuHeight) {
		// Position above if not enough space below
		$submenu.css("top", (rect.top - submenuHeight) + "px");
	}
	else {
		// Position below
		$submenu.css("top", rect.bottom + "px");
	}

	// Handle submenu item clicks
	$submenu.find(".sdx-submenu-item").on("click", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $item = $(this);
		const conditionUuid = $item.data("condition-uuid");
		const conditionName = $item.data("condition-name");
		const isActive = $item.hasClass("active");

		if (isActive) {
			await removeConditionFromActor(actor, conditionName, conditionUuid);
		}
		else {
			await addConditionToActor(actor, conditionUuid);
		}

		$submenu.remove();
	});

	// Close submenu when clicking outside
	setTimeout(() => {
		$(document).one("click", () => {
			$submenu.remove();
		});
	}, 10);
}

/**
 * Add a condition to an actor by creating an active effect from the condition item
 */
async function addConditionToActor(actor, conditionUuid) {
	try {
		const condition = await fromUuid(conditionUuid);
		if (!condition) {
			ui.notifications.error(`Condition not found: ${conditionUuid}`);
			return;
		}

		// Check if condition item already exists on actor
		const existingItem = actor.items.find(item => {
			// Check by name
			if (item.name === condition.name) return true;
			// Check by source UUID
			if (item.flags?.core?.sourceId === conditionUuid) return true;
			if (item._stats?.compendiumSource === conditionUuid) return true;
			return false;
		});

		if (existingItem) {
			//console.log(`${MODULE_ID} | Condition ${condition.name} already exists as item`);
			return;
		}

		// Create the condition item on the actor
		const itemData = condition.toObject();
		// Set source tracking
		itemData.flags = itemData.flags || {};
		itemData.flags.core = itemData.flags.core || {};
		itemData.flags.core.sourceId = conditionUuid;
		itemData.flags[MODULE_ID] = itemData.flags[MODULE_ID] || {};
		itemData.flags[MODULE_ID].conditionToggle = true;

		await actor.createEmbeddedDocuments("Item", [itemData]);
		ui.notifications.info(`Applied: ${condition.name}`);
	}
	catch (error) {
		console.error(`${MODULE_ID} | Error adding condition:`, error);
		ui.notifications.error("Failed to apply condition");
	}
}

/**
 * Remove a condition from an actor
 */
async function removeConditionFromActor(actor, conditionName, conditionUuid) {
	try {
		// Find the condition item(s) matching this condition
		const itemsToRemove = actor.items.filter(item =>
			item.name === conditionName ||
			(item.flags?.core?.sourceId === conditionUuid) ||
			(item._stats?.compendiumSource === conditionUuid) ||
			(item.getFlag(MODULE_ID, "conditionToggle") && item.name === conditionName)
		);

		if (itemsToRemove.length > 0) {
			const ids = itemsToRemove.map(item => item.id);
			await actor.deleteEmbeddedDocuments("Item", ids);
			ui.notifications.info(`Removed: ${conditionName}`);
		}
	}
	catch (error) {
		console.error(`${MODULE_ID} | Error removing condition:`, error);
		ui.notifications.error("Failed to remove condition");
	}
}
