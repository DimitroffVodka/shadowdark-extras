/**
 * The ammunition bonus UI on an item sheet.
 *
 * Extracted from the composition root in Phase 3. Owned by inventory, which
 * already owns `AmmunitionSelector`.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { ensureMutableItemCompendiumIndexes } from "../shared/CompendiumIndexSD.mjs";

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

/**
 * Two `ready`-time patches that make ranged weapons consume ammunition.
 *
 * Extracted from the composition root in Phase 3 (step 39). They join the
 * sheet UI above per handoff rule 3 — same feature, and the UI is meaningless
 * without the `usesAmmunition` predicate these install.
 *
 * WHY `ready` AND NOT `init`. Both reach through the system's `shadowdark`
 * global, which does not exist until the system has initialised. That is the
 * root's original reasoning, carried with the code.
 *
 * The body is verbatim; the callback is named rather than an arrow so its
 * single-tab indentation is preserved.
 */
function patchAmmunitionConsumption() {
	Object.defineProperty(shadowdark.documents.ItemSD.prototype, "usesAmmunition", {
		get: function() {
			return (game.settings.get("shadowdark", "autoConsumeAmmunition")
				&& this.isOwned
				&& this.actor.type === "Player"
				&& this.type === "Weapon"
				&& this.system.type === "ranged"
			);
		},
		configurable: true,
	});


	const prepareGearSheetCompendiumIndexes = () => {
		ensureMutableItemCompendiumIndexes(game.packs, foundry.utils.deepClone);
	};

	// Shadowdark's armor and weapon sheet helpers request full Item system data
	// from every pack. Normalize any frozen v14 index entries first.
	const originalGetArmorSheetData = shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForArmorItem;
	shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForArmorItem = async function(context) {
		prepareGearSheetCompendiumIndexes();
		return originalGetArmorSheetData.call(this, context);
	};

	// Enhance weapon sheet to include actor's inventory ammunition in the dropdown
	const originalGetWeaponSheetData = shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForWeaponItem;
	shadowdark.sheets.ItemSheetSD.prototype.getSheetDataForWeaponItem = async function(context) {
		prepareGearSheetCompendiumIndexes();
		await originalGetWeaponSheetData.call(this, context);

		const actor = context.item.actor;
		if (actor) {
			const actorAmmo = actor.items.filter(i => i.system.isAmmunition && i.system.quantity > 0);
			for (const ammo of actorAmmo) {
				const slug = ammo.name.slugify();
				if (!context.ammunition[slug]) {
					context.ammunition[slug] = ammo.name;
				}
			}
		}
	};
}

export function registerAmmunitionPatches() {
	Hooks.once("ready", patchAmmunitionConsumption);
}
