/**
 * Filtering the spell-book dialog by source compendium.
 *
 * Extracted from the composition root in Phase 3, both halves together: the
 * injector builds the dropdown and `filterSpellsByCompendium` is what its
 * change handler calls. Only the injector is exported — the filter is reached
 * through it and has no other caller.
 */

/**
 * Inject a compendium filter dropdown into the SpellBookSD dialog
 * Allows users to filter spells by compendium
 */
export function injectSpellbookCompendiumFilter(app, html) {
	const header = html.find(".SD-header");
	if (!header.length) return;

	// Get all compendiums that contain spells
	const spellPacks = [];
	for (const pack of game.packs) {
		if (pack.metadata.type !== "Item") continue;
		// Check if pack has any spells in its index
		const hasSpells = pack.index.some(i => i.type === "Spell");
		if (hasSpells) {
			spellPacks.push({
				id: pack.collection,
				name: pack.metadata.label
			});
		}
	}

	// Sort packs alphabetically
	spellPacks.sort((a, b) => a.name.localeCompare(b.name));

	// Build the dropdown options
	const allLabel = game.i18n.localize("SHADOWDARK_EXTRAS.spellbook.compendiumFilter.all");
	let optionsHtml = `<option value="">${allLabel}</option>`;
	for (const pack of spellPacks) {
		optionsHtml += `<option value="${pack.id}">${pack.name}</option>`;
	}

	// Create the filter dropdown
	const filterLabel = game.i18n.localize("SHADOWDARK_EXTRAS.spellbook.compendiumFilter.label");
	const filterHtml = `
		<div class="sdx-spellbook-filter">
			<label>${filterLabel}</label>
			<select class="sdx-spellbook-compendium-select">
				${optionsHtml}
			</select>
		</div>
	`;

	// Insert before navigation tabs
	const nav = html.find(".SD-nav");
	if (nav.length) {
		nav.before(filterHtml);
	} else {
		// Fallback: insert after header
		header.after(filterHtml);
	}

	// Add event listener
	const select = html.find(".sdx-spellbook-compendium-select");
	select.on("change", (event) => {
		const selectedCompendium = event.currentTarget.value;
		filterSpellsByCompendium(html, selectedCompendium);
	});
}

/**
 * Filter the spell list by hiding/showing items based on their compendium
 * @param {jQuery} html - The dialog HTML
 * @param {string} compendiumId - The compendium ID to filter by, or empty for all
 */
function filterSpellsByCompendium(html, compendiumId) {
	const spellItems = html.find(".SD-list .item[data-uuid]");

	spellItems.each((index, element) => {
		const $item = $(element);
		const uuid = $item.data("uuid");

		if (!compendiumId) {
			// Show all
			$item.show();
		} else {
			// Check if the UUID starts with the compendium ID
			// UUID format: Compendium.module.pack.itemId
			if (uuid && uuid.startsWith(`Compendium.${compendiumId}`)) {
				$item.show();
			} else {
				$item.hide();
			}
		}
	});

	// Update the count display if needed (future enhancement)
}
