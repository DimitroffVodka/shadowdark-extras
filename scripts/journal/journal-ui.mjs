/**
 * Journal UI enhancements.
 *
 * Two journal-facing behaviours, moved verbatim out of the composition root:
 *
 *   - hiding SDX's internal sync journals from the sidebar directory
 *   - a collapse/expand toggle for the headings list on journal sheets
 *
 * From two source regions, not one: the hooks and `injectHeadingsCollapseButton`
 * came from the HOOKS block, and the constants below came from the root's
 * top-of-file declaration region, where `HIDDEN_JOURNAL_NAMES` sat far from its
 * only consumer.
 *
 * They share a module because both are journal chrome and neither is big
 * enough to own one. A new module rather than an existing `journal/` one
 * (handoff rule 3) because none of those owns this: the hidden-names list spans
 * trade, carousing and hex, and the headings toggle belongs to no feature at
 * all. `registerJournalUIHooks()` performs all three registrations in the
 * root's original order, and the root calls it from the position those
 * registrations used to occupy — so relative hook order is preserved by the
 * call site, per handoff rule 2.
 *
 * The three `*_JOURNAL_NAME` constants stay duplicated by string from their
 * feature modules, coupled only by the `Must match` comments. That is how
 * the root carried them; de-duplicating them is a separate decision.
 */

import { HEX_JOURNAL_NAME } from "../hex/HexTooltipSD.mjs";

const TRADE_JOURNAL_NAME = "__sdx_trade_sync__"; // Must match TradeWindowSD.mjs
const CAROUSING_JOURNAL_NAME = "__sdx_carousing_sync__"; // Must match CarousingSD.mjs
const CAROUSING_TABLES_JOURNAL_NAME = "__sdx_carousing_tables__"; // Must match CarousingSD.mjs

// All internal journals that should be hidden from the sidebar
const HIDDEN_JOURNAL_NAMES = [
	TRADE_JOURNAL_NAME,
	CAROUSING_JOURNAL_NAME,
	CAROUSING_TABLES_JOURNAL_NAME,
	HEX_JOURNAL_NAME,
];

// Inject collapse/expand button for journal page headings sidebar
function injectHeadingsCollapseButton(app, html) {
	const element = html instanceof jQuery ? html[0] : html;

	// Find ALL headings lists (there may be one per page in the sidebar)
	const headingsLists = element.querySelectorAll("ol.headings");
	if (!headingsLists.length) return;

	for (const headingsOl of headingsLists) {
		// Don't inject twice
		if (headingsOl.previousElementSibling?.classList?.contains("sdx-headings-toggle")) continue;

		// Create the toggle button
		const toggleBtn = document.createElement("button");
		toggleBtn.className = "sdx-headings-toggle";
		toggleBtn.type = "button";
		toggleBtn.title = "Toggle headings";
		toggleBtn.innerHTML = "<i class=\"fas fa-chevron-down\" style=\"transition:transform 0.2s;\"></i>";
		Object.assign(toggleBtn.style, {
			background: "none",
			border: "none",
			cursor: "pointer",
			padding: "2px 6px",
			opacity: "0.6",
			fontSize: "0.75em",
			position: "absolute",
			right: "4px",
			top: "2px",
			zIndex: "1",
		});

		// Make the parent position:relative so the button can be positioned
		const parentLi = headingsOl.closest("li.page");
		if (parentLi) {
			parentLi.style.position = "relative";
			parentLi.insertBefore(toggleBtn, headingsOl);
		} else {
			headingsOl.parentElement.insertBefore(toggleBtn, headingsOl);
		}

		// Toggle handler
		toggleBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const isCollapsed = headingsOl.style.display === "none";
			headingsOl.style.display = isCollapsed ? "" : "none";
			toggleBtn.querySelector("i").style.transform = isCollapsed ? "" : "rotate(-90deg)";
		});
	}
}

export function registerJournalUIHooks() {
	// Hide internal trade journal from the sidebar (Foundry v13 compatible)
	Hooks.on("renderJournalDirectory", (app, html, data) => {
		// In v13, html might be an HTMLElement or jQuery - handle both
		const element = html instanceof jQuery ? html[0] : html;

		// Find all journal entries in the directory list
		const entries = element.querySelectorAll("[data-entry-id], [data-document-id], .directory-item");
		entries.forEach(entry => {
			const entryId = entry.dataset?.entryId || entry.dataset?.documentId;
			if (entryId) {
				const journal = game.journal.get(entryId);
				if (journal && HIDDEN_JOURNAL_NAMES.includes(journal.name)) {
					entry.remove();
					return;
				}
			}
			// Also check by name in the entry text as fallback
			const nameEl = entry.querySelector(".entry-name, .document-name");
			const entryName = nameEl?.textContent?.trim();
			if (entryName && HIDDEN_JOURNAL_NAMES.includes(entryName)) {
				entry.remove();
			}
		});
	});
	Hooks.on("renderJournalEntrySheet", injectHeadingsCollapseButton);
	Hooks.on("renderJournalSheet", injectHeadingsCollapseButton);
}
