/**
 * The ammunition bonus UI on an item sheet.
 *
 * Extracted from the composition root in Phase 3. Owned by inventory, which
 * already owns `AmmunitionSelector`.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

export function injectAmmunitionBonuses(app, html) {
	const item = app?.item;
	if (item?.type !== "Basic") return;
	if (!item.system.isAmmunition) return;

	// De-dupe on re-render
	html.find(".sdx-ammunition-bonuses").remove();

	const hitBonus = item.getFlag(MODULE_ID, "ammoHitBonus") || "";
	const damageBonus = item.getFlag(MODULE_ID, "ammoDamageBonus") || "";

	const bonusesHtml = `
		<div class="sdx-ammunition-bonuses">
			<div class="SD-box">
				<div class="header light">
					<label>${game.i18n.localize("SHADOWDARK_EXTRAS.ammunition.bonuses.label")}</label>
				</div>
				<div class="content">
					<div class="SD-grid center">
						<div class="sdx-bonus-field">
							<label class="sdx-field-label">${game.i18n.localize("SHADOWDARK_EXTRAS.ammunition.bonuses.hit")}</label>
							<input type="text" name="flags.${MODULE_ID}.ammoHitBonus" value="${hitBonus}" placeholder="+0">
						</div>
						<div class="sdx-bonus-field">
							<label class="sdx-field-label">${game.i18n.localize("SHADOWDARK_EXTRAS.ammunition.bonuses.damage")}</label>
							<input type="text" name="flags.${MODULE_ID}.ammoDamageBonus" value="${damageBonus}" placeholder="+0">
						</div>
					</div>
				</div>
			</div>
		</div>
	`;

	// Inject at the bottom of the Details tab
	const detailsTab = html.find('.tab[data-tab="tab-details"]');
	if (detailsTab.length) {
		detailsTab.append(bonusesHtml);
	}
}
