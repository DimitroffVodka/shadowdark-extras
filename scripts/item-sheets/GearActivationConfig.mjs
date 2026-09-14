import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";

/**
 * Activation block for Basic ("gear") items.
 *
 * This is the one Activity-tab block with no counterpart on the Spell, Potion,
 * Scroll or Wand sheets, and the reason it exists: every one of those types
 * already has a use action supplied by the system — a potion is drunk, a scroll
 * read, a wand waved — and each of those actions posts the chat card the whole
 * damage/effects pipeline hangs off. A Basic item has no use action at all, so
 * without this it can carry a fully configured Activity tab that nothing can
 * ever fire.
 *
 * Ticking `enabled` here is what gives the item a use control in the inventory.
 * The consumer is `items/gear-activation.mjs`.
 *
 * `maxUses` of 0 means unlimited; `uses` is the live remaining count and is
 * deliberately an editable field rather than a recharge button — the field is
 * the recharge. Camping rest refills it (see `party/CampingRestSD.mjs`).
 */
export function generateGearActivationConfigHTML(MODULE_ID, flags) {
	if (!isFeatureEnabled(FEATURE_IDS.SPELL_CONFIGS)) return "";

	const maxUses = Number(flags.maxUses ?? 0);
	const uses = Number(flags.uses ?? maxUses);

	return `
		<div class="SD-box sdx-gear-activation-box grid-colspan-3">
			<div class="header light">
				<label class="sdx-section-checkbox">
					<input type="checkbox" name="flags.${MODULE_ID}.gearActivation.enabled"
					       ${flags.enabled ? "checked" : ""}
					       class="sdx-gear-activation-toggle" />
					<span>Usable Item</span>
				</label>
				<span></span>
			</div>
			<div class="content sdx-gear-activation-content">
				<div class="SD-grid">
					<p class="notes grid-colspan-3">
						Adds a use control to this item's inventory row. Using it posts a chat
						card, which is what applies the damage, effects and macros configured
						below. No check is rolled.
					</p>
					<div class="sdx-profile-field">
						<label>Max Uses</label>
						<input type="number" min="0" step="1"
						       name="flags.${MODULE_ID}.gearActivation.maxUses"
						       value="${maxUses}"
						       title="0 = unlimited" />
					</div>
					<div class="sdx-profile-field">
						<label>Remaining</label>
						<input type="number" min="0" step="1"
						       name="flags.${MODULE_ID}.gearActivation.uses"
						       value="${uses}"
						       title="Refilled to Max Uses by a camping rest" />
					</div>
				</div>
			</div>
		</div>
	`;
}
