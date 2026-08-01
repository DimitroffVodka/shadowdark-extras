/**
 * Filtering the spell-book dialog by source compendium.
 *
 * Extracted from the composition root in Phase 3, both halves together: the
 * injector builds the dropdown and `filterSpellsByCompendium` is what its
 * change handler calls. Only the injector is exported — the filter is reached
 * through it and has no other caller.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

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
				name: pack.metadata.label,
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
	}
	else {
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
		}
		else {
			// Check if the UUID starts with the compendium ID
			// UUID format: Compendium.module.pack.itemId
			if (uuid && uuid.startsWith(`Compendium.${compendiumId}`)) {
				$item.show();
			}
			else {
				$item.hide();
			}
		}
	});

	// Update the count display if needed (future enhancement)
}

/**
 * Filtering the same spell-book dialog by ALIGNMENT.
 *
 * Extracted from the composition root in Phase 3, where it was 145 lines
 * living inside a `ready` hook whose other statements were ordered
 * composition — the block scored 14% dispatch, and this section was all of
 * the remainder.
 *
 * It joins the compendium filter above per handoff rule 3: same dialog, same
 * feature, and a reader looking for "how is the spell book filtered" should
 * find both answers in one file rather than one here and one in the root.
 *
 * WHY A WeakMap AND NOT A SUBCLASS. `shadowdark.apps.SpellBookSD` cannot be
 * replaced — the property is read-only — so the alignment is stashed against
 * the app instance on render and read back inside the patched `getData`. That
 * is the original design, carried verbatim.
 *
 * The `renderSpellBookSD` registration installs when
 * `initAlignmentSpellFiltering()` is CALLED, and the root calls it at the
 * point the section occupied, so hook order is unchanged.
 */
export function initAlignmentSpellFiltering() {
	// ============================================
	// ALIGNMENT-BASED SPELL FILTERING
	// ============================================

	// We can't replace the class due to read-only property, so we'll use a different approach:
	// Store alignment in a WeakMap and use hooks to set it
	const spellbookAlignments = new WeakMap();

	// Hook to capture when SpellBookSD is rendered and store alignment
	Hooks.on("renderSpellBookSD", (app, html, data) => {
		// The alignment should already be stored via our custom openSpellBook
		const alignment = spellbookAlignments.get(app);
		if (alignment) {
			app.alignment = alignment;
		}
	});

	// Patch SpellBookSD.getData() to filter spells by alignment
	const originalGetData = shadowdark.apps.SpellBookSD.prototype.getData;

	shadowdark.apps.SpellBookSD.prototype.getData = async function() {
		const data = await originalGetData.call(this);

		//console.log(`${MODULE_ID} | SpellBook getData called`);
		//console.log(`${MODULE_ID} | Actor alignment:`, this.alignment);
		//console.log(`${MODULE_ID} | Has spellList:`, !!data.spellList);

		// Filter spells by alignment if alignment is set
		if (this.alignment && data.spellList) {
			//console.log(`${MODULE_ID} | Filtering spells by alignment: ${this.alignment}`);

			for (const tier in data.spellList) {
				const originalCount = data.spellList[tier].length;
				//console.log(`${MODULE_ID} | Tier ${tier} - Original spell count:`, originalCount);

				// We need to load full spell documents to get flags
				// Compendium index doesn't include flags
				const spellsWithFlags = await Promise.all(
					data.spellList[tier].map(async (spell) => {
						// Load full document to get flags
						const fullSpell = await fromUuid(spell.uuid);
						return fullSpell || spell; // Fallback to original if load fails
					})
				);

				// Log first spell to see structure
				if (spellsWithFlags.length > 0) {
					const sample = spellsWithFlags[0];
					//console.log(`${MODULE_ID} | Sample spell from tier ${tier} (after loading):`, {
					//	name: sample.name,
					//	uuid: sample.uuid,
					//	hasFlags: !!sample.flags,
					//	flagKeys: sample.flags ? Object.keys(sample.flags) : 'no flags',
					//	sdxFlags: sample.flags?.[MODULE_ID],
					//	alignment: sample.flags?.[MODULE_ID]?.alignment
					//});
				}

				// Filter spells based on alignment
				data.spellList[tier] = spellsWithFlags.filter(spell => {
					const spellAlignment = spell.flags?.[MODULE_ID]?.alignment;
					const shouldShow = !spellAlignment || spellAlignment === this.alignment;

					// Log filtering decisions for spells with alignment
					if (spellAlignment) {
						//console.log(`${MODULE_ID} | Spell "${spell.name}" has alignment "${spellAlignment}", actor is "${this.alignment}" - ${shouldShow ? 'SHOW' : 'HIDE'}`);
					}

					return shouldShow;
				});

				const filteredCount = data.spellList[tier].length;
				//console.log(`${MODULE_ID} | Tier ${tier} - Filtered spell count:`, filteredCount, `(removed ${originalCount - filteredCount})`);
			}
		}
		else {
			//console.log(`${MODULE_ID} | No filtering applied - alignment: "${this.alignment}", has spellList: ${!!data.spellList}`);
		}

		return data;
	};

	// Patch ActorSD.openSpellBook() to pass alignment to SpellBookSD
	const originalOpenSpellBook = CONFIG.Actor.documentClass.prototype.openSpellBook;

	CONFIG.Actor.documentClass.prototype.openSpellBook = async function() {
		const playerSpellcasterClasses = await this.getSpellcasterClasses();
		const actorAlignment = this.system.alignment || "";


		//console.log(`${MODULE_ID} | Opening spellbook for actor: ${this.name}`);
		//console.log(`${MODULE_ID} | Actor alignment: "${actorAlignment}"`);
		//console.log(`${MODULE_ID} | Spellcaster classes:`, playerSpellcasterClasses.map(c => c.name));

		const openChosenSpellbook = classUuid => {
			//console.log(`${MODULE_ID} | Creating SpellBookSD with alignment: "${actorAlignment}"`);
			const app = new shadowdark.apps.SpellBookSD(
				classUuid,
				this.id
			);
			// Store alignment directly on the app instance
			app.alignment = actorAlignment;
			// Also store in WeakMap as backup
			spellbookAlignments.set(app, actorAlignment);
			app.render(true);
		};

		if (playerSpellcasterClasses.length <= 0) {
			return ui.notifications.error(
				game.i18n.localize("SHADOWDARK.item.errors.no_spellcasting_classes"),
				{ permanent: false }
			);
		}
		else if (playerSpellcasterClasses.length === 1) {
			return openChosenSpellbook(playerSpellcasterClasses[0].uuid);
		}
		else {
			return foundry.applications.handlebars.renderTemplate(
				"systems/shadowdark/templates/dialog/choose-spellbook.hbs",
				{ classes: playerSpellcasterClasses }
			).then(html => {
				const dialog = new foundry.applications.api.DialogV2({
					window: { title: game.i18n.localize("SHADOWDARK.dialog.spellbook.open_which_class.title") },
					content: html,
					buttons: [
						{
							action: "cancel",
							icon: "fas fa-times",
							label: game.i18n.localize("Cancel"),
						},
					],
				});
				dialog.render({ force: true }).then(() => {
					dialog.element.querySelectorAll("[data-action='open-class-spellbook']").forEach(el => {
						el.addEventListener("click", event => {
							event.preventDefault();
							openChosenSpellbook(event.currentTarget.dataset.uuid);
							dialog.close();
						});
					});
				});
			});
		}
	};

	//console.log(`${MODULE_ID} | Alignment-based spell filtering initialized`);
}
