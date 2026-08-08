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
	select.on("change", event => {
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
 * Shadowdark 4.x keeps `openSpellBook` on the Player data model, while the
 * sheet calls `actor.system.openSpellBook()`. Stable global symbols make both
 * prototype patches safe across repeated init calls and cache-busted imports.
 */
const PLAYER_PATCH = Symbol.for("shadowdark-extras.alignment-spellbook.player");
const SPELLBOOK_PATCH = Symbol.for("shadowdark-extras.alignment-spellbook.get-data");

export function initAlignmentSpellFiltering() {
	const playerPrototype = globalThis.CONFIG?.Actor?.dataModels?.Player?.prototype;
	const spellbookPrototype = globalThis.shadowdark?.apps?.SpellBookSD?.prototype;
	const missing = [];
	if (typeof playerPrototype?.openSpellBook !== "function") {
		missing.push("CONFIG.Actor.dataModels.Player.prototype.openSpellBook");
	}
	if (typeof spellbookPrototype?.getData !== "function") {
		missing.push("shadowdark.apps.SpellBookSD.prototype.getData");
	}
	if (typeof globalThis.shadowdark?.utils?.resolveSpellClasses !== "function") {
		missing.push("shadowdark.utils.resolveSpellClasses");
	}
	if (typeof globalThis.Hooks?.on !== "function") {
		missing.push("Hooks.on");
	}
	if (missing.length > 0) {
		console.warn(`${MODULE_ID} | Alignment spell filtering unavailable; missing ${missing.join(", ")}`);
		return;
	}

	const existingPlayerPatch = playerPrototype[PLAYER_PATCH];
	const existingSpellbookPatch = spellbookPrototype[SPELLBOOK_PATCH];
	if (existingPlayerPatch && existingSpellbookPatch) return;
	if (existingPlayerPatch || existingSpellbookPatch) {
		console.warn(`${MODULE_ID} | Alignment spell filtering has an incomplete prior patch; refusing to mutate`);
		return;
	}

	const spellbookState = {
		alignments: new WeakMap(),
		originalGetData: spellbookPrototype.getData,
	};
	const originalGetData = spellbookState.originalGetData;
	spellbookPrototype.getData = async function(...args) {
		const data = await originalGetData.apply(this, args);
		if (!data?.spellList || typeof data.spellList !== "object") return data;

		const spellList = { ...data.spellList };
		for (const [tier, entries] of Object.entries(data.spellList)) {
			if (!Array.isArray(entries)) continue;

			const visibleEntries = [];
			for (const entry of entries) {
				const fullSpell = await fromUuid(entry?.uuid);
				const spell = fullSpell ?? entry;
				const spellAlignment = spell?.flags?.[MODULE_ID]?.alignment;
				if (!spellAlignment || spellAlignment === this.alignment) {
					visibleEntries.push(entry);
				}
			}
			spellList[tier] = visibleEntries;
		}

		return { ...data, spellList };
	};
	Object.defineProperty(spellbookPrototype, SPELLBOOK_PATCH, {
		configurable: false,
		enumerable: false,
		value: spellbookState,
		writable: false,
	});

	globalThis.Hooks.on("renderSpellBookSD", app => {
		if (spellbookState.alignments.has(app)) {
			app.alignment = spellbookState.alignments.get(app);
		}
	});

	const playerState = { originalOpenSpellBook: playerPrototype.openSpellBook };
	playerPrototype.openSpellBook = async function() {
		const castingClasses = await globalThis.shadowdark.utils.resolveSpellClasses(
			this.spellcasting.classes
		);

		const openChosenSpellbook = classUuid => {
			const app = new globalThis.shadowdark.apps.SpellBookSD(
				classUuid,
				this.parent.id
			);
			const actorAlignment = this.alignment ?? this.parent?.system?.alignment ?? "";
			app.alignment = actorAlignment;
			spellbookState.alignments.set(app, actorAlignment);
			app.render(true);
		};

		if (castingClasses.length <= 0) {
			return ui.notifications.error(
				game.i18n.localize("SHADOWDARK.item.errors.no_spellcasting_classes"),
				{ permanent: false }
			);
		}
		else if (castingClasses.length === 1) {
			return openChosenSpellbook(castingClasses[0].uuid);
		}
		else {
			return foundry.applications.handlebars.renderTemplate(
				"systems/shadowdark/templates/dialog/choose-spellbook.hbs",
				{classes: castingClasses}
			).then(html => {
				const dialog = new Dialog({
					title: game.i18n.localize("SHADOWDARK.dialog.spellbook.open_which_class.title"),
					content: html,
					buttons: {},
					render: html => {
						html.find("[data-action='open-class-spellbook']").click(
							event => {
								event.preventDefault();
								openChosenSpellbook(event.currentTarget.dataset.uuid);
								dialog.close();
							}
						);
					},
				}).render(true);
			});
		}
	};
	Object.defineProperty(playerPrototype, PLAYER_PATCH, {
		configurable: false,
		enumerable: false,
		value: playerState,
		writable: false,
	});
}
