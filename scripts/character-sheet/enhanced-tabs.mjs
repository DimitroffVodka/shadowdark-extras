import { showTransferDialog, transferItemToPlayer } from "../inventory/player-transfers.mjs";

/**
 * The four small character-sheet tab enhancers: details, abilities, talents,
 * effects.
 *
 * Extracted from the composition root in Phase 3. Grouped into one module
 * rather than four because they are 12, 10, 12 and 9 lines — their larger
 * siblings `enhanced-inventory-tab.mjs` and `enhanced-spells-tab.mjs` earn
 * their own files at 300 and 1,100 lines; these would not. The original
 * banners are carried verbatim so each is still findable by its old name.
 *
 * `addInlineTalentControls` is the one piece of real weight here (72 lines)
 * and is private — only `enhanceTalentsTab` calls it. The four exported names
 * are called by the actor-sheet dispatcher still in the root.
 */

// ============================================
// ENHANCED DETAILS TAB
// ============================================

/**
 * Enhance the Details tab with improved styling and organization
 */
export function enhanceDetailsTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $detailsTab = html.find('.tab[data-tab="tab-details"]');
	if (!$detailsTab.length) return;

	// Add enhanced class to the details tab
	$detailsTab.addClass('sdx-enhanced-details');

	// Hide the level box (it's already in the enhanced header)
	$detailsTab.find('.SD-box').first().hide();
}

// ============================================
// ENHANCED ABILITIES TAB
// ============================================

/**
 * Enhance the Abilities tab with improved styling and organization
 */
export function enhanceAbilitiesTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $abilitiesTab = html.find('.tab[data-tab="tab-abilities"]');
	if (!$abilitiesTab.length) return;

	// Add enhanced class to the abilities tab
	$abilitiesTab.addClass('sdx-enhanced-abilities');

}


// ============================================
// ENHANCED TALENTS TAB
// ============================================

/**
 * Add inline control buttons to talent items
 */
function addInlineTalentControls($talentsTab, actor) {
	const $items = $talentsTab.find('.item');

	$items.each(function () {
		const $item = $(this);

		// Skip if already has controls
		if ($item.find('.sdx-talent-controls').length) return;

		const itemId = $item.data('item-id');

		if (!itemId) return;

		// Create control buttons
		const $controls = $(`
			<div class="sdx-talent-controls">
				<button type="button" class="sdx-talent-edit" data-tooltip="Edit" title="Edit">
					<i class="fas fa-edit"></i>
				</button>
				<button type="button" class="sdx-talent-transfer" data-tooltip="Transfer to Player" title="Transfer to Player">
					<i class="fas fa-share"></i>
				</button>
				<button type="button" class="sdx-talent-delete" data-tooltip="Delete" title="Delete">
					<i class="fas fa-trash"></i>
				</button>
			</div>
		`);

		// Add controls to the item
		$item.append($controls);

		// Edit button
		$controls.find('.sdx-talent-edit').on('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item) item.sheet.render(true);
		});

		// Transfer button
		$controls.find('.sdx-talent-transfer').on('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item && game.user.isGM) {
				const targetActorId = await showTransferDialog(actor, item);
				if (targetActorId) {
					await transferItemToPlayer(actor, item, targetActorId);
				}
			}
		});

		// Delete button
		$controls.find('.sdx-talent-delete').on('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const item = actor.items.get(itemId);
			if (item) {
				const confirm = await foundry.applications.api.DialogV2.confirm({
					window: { title: "Delete Talent" },
					content: `<p>Are you sure you want to delete <strong>${item.name}</strong>?</p>`,
					modal: true
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
 * Enhance the Talents tab with improved styling and organization
 */
export function enhanceTalentsTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $talentsTab = html.find('.tab[data-tab="tab-talents"]');
	if (!$talentsTab.length) return;

	// Add enhanced class to the talents tab
	$talentsTab.addClass('sdx-enhanced-talents');

	// Add inline control buttons to talent items
	addInlineTalentControls($talentsTab, actor);
}


// ============================================
// ENHANCED EFFECTS TAB
// ============================================

/**
 * Enhance the Effects tab with improved styling and organization
 */
export function enhanceEffectsTab(app, html, actor) {
	if (actor.type !== "Player") return;

	const $effectsTab = html.find('.tab[data-tab="tab-effects"]');
	if (!$effectsTab.length) return;

	// Add enhanced class to the effects tab
	$effectsTab.addClass('sdx-enhanced-effects');
}
