/**
 * V1/V2 header button bridge.
 *
 * Moved verbatim out of the composition root's HOOKS block. The banner
 * comment below is the original explanation and is carried unchanged; it
 * says why the bridge exists better than a rewrite would.
 *
 * Shared kernel rather than a feature module: the five sheets it covers live
 * in three different features (`npc/`, `item-sheets/`, `character-sheet/`),
 * so none of them owns it, and it carries no user-facing workflow of its own
 * — it is Foundry application-API compatibility. `sd4Compat.mjs` is the
 * neighbouring compat module but covers Shadowdark 4.x chat data, a
 * different concern.
 *
 * `registerAppV2HeaderBridge()` is called from the position the registration
 * occupied in the root, so relative hook order is preserved by the call site.
 */

import { MODULE_ID } from "./module-id.mjs";

// ═══════════════════════════════════════════════════════════════════
// V1/V2 Header Button Bridge
// SDX registers AppV2 item sheets (NPC Attack, NPC Feature, etc.).
// Modules like Automated Animations inject header buttons with the
// V1 hook "getItemSheetHeaderButtons" which doesn't fire for V2 apps.
// This bridge fires that hook for our V2 sheets and injects the
// resulting buttons into the window header so they render properly.
// ═══════════════════════════════════════════════════════════════════
const _SDX_V2_ITEM_SHEETS = new Set([
	"NPCAttackSheetSD",
	"NPCFeatureSheetSD",
	"NPCSpecialAttackSheetSD",
	"PotionSheetSD",
	"BackgroundSheetSD",
]);

export function registerAppV2HeaderBridge() {
	Hooks.on("renderApplicationV2", (app, element, options) => {
		try {
			if (!_SDX_V2_ITEM_SHEETS.has(app.constructor.name)) return;
			if (!app.document || app.document.documentName !== "Item") return;

			// Collect V1-style header buttons from other modules
			const v1Buttons = [];
			Hooks.callAll("getItemSheetHeaderButtons", app, v1Buttons);
			if (!v1Buttons.length) return;

			const header = element?.querySelector?.(".window-header")
				?? app.element?.querySelector?.(".window-header");
			if (!header) return;

			for (const btn of v1Buttons) {
				// Skip if already injected (prevents duplicates on re-render)
				if (btn.class && header.querySelector(`.${btn.class}`)) continue;

				const button = document.createElement("button");
				button.type = "button";
				button.className = `header-control ${btn.class || ""}`.trim();
				button.title = btn.label || "";
				button.innerHTML = `<i class="${btn.icon}"></i>`;
				if (btn.onclick) {
					button.addEventListener("click", (e) => {
						e.preventDefault();
						e.stopPropagation();
						btn.onclick(e);
					});
				}

				// Insert before the close button
				const closeBtn = header.querySelector('[data-action="close"]')
					|| header.querySelector(".close");
				if (closeBtn) header.insertBefore(button, closeBtn);
				else header.appendChild(button);
			}
		} catch (err) {
			console.error(`${MODULE_ID} | V1/V2 header button bridge error`, err);
		}
	});
}
