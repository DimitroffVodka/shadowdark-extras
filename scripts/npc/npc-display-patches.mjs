/**
 * Shadowdark 4.x NPC display-builder patches.
 *
 * Wraps two methods on the NPC data model — `buildNpcAttackDisplays` and
 * `buildNpcSpecialDisplays` — to add SDX item images and to fix an enrichment
 * bug in the attack count. Lifted verbatim out of the composition root, where
 * it was 137 lines of inline implementation inside a `ready` hook.
 *
 * WHY IT LEFT THE ROOT WHEN THE SHEET DISPATCHERS DID NOT. Step 39 keeps
 * "ordered registration calls" in the root, and the `renderPlayerSheetSD`
 * dispatcher qualifies — it is 21 imported calls behind a type guard, and no
 * feature could own six other features' render order. This block is the
 * opposite shape: measured at ZERO dispatch calls against 87 lines of code, it
 * is prototype surgery that happens to be spelled as a hook.
 *
 * THE BODY IS NOT REINDENTED. The callback is a named function rather than the
 * arrow it used to be, so its 135 lines keep the single-tab indentation they
 * had inside `Hooks.once("ready", () => {…})`. Wrapping them in a
 * register-function instead would have shifted every one of them by a tab and
 * turned a verifiable carry into a 135-line diff.
 *
 * The registration installs when `registerNpcDisplayPatches()` is CALLED, and
 * the root calls it where the `Hooks.once` used to sit, so hook order is
 * unchanged.
 */

function patchNpcDisplayBuilders() {
	// Shadowdark 4.x: NPC display builders moved from ActorSD.prototype to the
	// NPC data model (CONFIG.Actor.dataModels.NPC.prototype). Inside these
	// methods `this` is the data model, and the parent actor is `this.parent`.
	const NpcModel = CONFIG.Actor.dataModels?.NPC;

	if (!NpcModel?.prototype || !NpcModel.prototype.buildNpcAttackDisplays) {
		console.warn("shadowdark-extras | Could not patch NpcSD.prototype.buildNpcAttackDisplays");
		return;
	}

	const originalBuildNpcAttackDisplays = NpcModel.prototype.buildNpcAttackDisplays;

	NpcModel.prototype.buildNpcAttackDisplays = async function(itemId) {
		const actor = this.parent;
		const item = actor?.items.get(itemId);

		// If getting item fails, fallback to original ensuring failure consistency
		if (!item) return originalBuildNpcAttackDisplays.call(this, itemId);

		const attackOptions = {
			attackType: item.system.attackType,
			attackName: item.name,
			// numAttacks: item.system.attack.num,
			attackBonus: parseInt(item.system.bonuses.attackBonus, 10),
			baseDamage: item.system.damage.value,
			bonusDamage: parseInt(item.system.bonuses.damageBonus, 10),
			itemId,
			special: item.system.damage.special || "", // Default to empty string
			ranges: item.system.ranges.map(s => game.i18n.localize(
				CONFIG.SHADOWDARK.RANGES[s])).join("/"),
		};

		// Coerce to a string first: enrichHTML returns "" for non-string input,
		// and Shadowdark 4.x stores attack.num as a NumberField (e.g. 3). Without
		// this, the attack count silently vanishes from the display. Enriching the
		// string still preserves free-form values like "1d4" attacks.
		attackOptions.numAttacks =
			await foundry.applications.ux.TextEditor.implementation.enrichHTML(
				String(item.system.attack.num ?? ""),
				{
					async: true,
				}
			);

		// --- SDX Extra Damage Logic ---
		const MODULE_ID = "shadowdark-extras";
		const sdxFlags = item.flags?.[MODULE_ID] || {};

		let extraText = "";

		// Base Damage Type
		if (sdxFlags.baseDamageType && sdxFlags.baseDamageType !== "physical") {
			const typeLabel = game.i18n.localize(`SHADOWDARK_EXTRAS.damage_type.${sdxFlags.baseDamageType}`);
			extraText += ` [${typeLabel}]`;
		}

		// Extra Damages
		const extraDamagesFlag = sdxFlags.extraDamages || [];
		const extraDamages = Array.isArray(extraDamagesFlag) ? extraDamagesFlag : Object.values(extraDamagesFlag);

		if (extraDamages.length > 0) {
			const parts = extraDamages
				.filter(d => d.formula)
				.map(d => {
					const label = game.i18n.localize(`SHADOWDARK_EXTRAS.damage_type.${d.damageType}`);
					return `${d.formula} [${label}]`;
				});
			if (parts.length > 0) {
				extraText += ` + ${parts.join(" + ")}`;
			}
		}

		if (extraText) {
			// Append to special
			if (attackOptions.special) {
				attackOptions.special += extraText;
			} else {
				attackOptions.special = extraText;
			}
		}
		// ------------------------------

		const baseHtml = await foundry.applications.handlebars.renderTemplate(
			"systems/shadowdark/templates/_partials/npc-attack.hbs",
			attackOptions
		);

		// Add item image if available and not the default
		const defaultIcon = "icons/svg/sword.svg";
		if (item.img && item.img !== defaultIcon) {
			const escapedName = foundry.utils.escapeHTML(item.name);
			const escapedImg = foundry.utils.escapeHTML(item.img);
			const imgHtml = `<img src="${escapedImg}" alt="${escapedName}" class="sdx-npc-item-img" style="width: 18px; height: 18px; vertical-align: text-bottom; margin-right: 2px; border: none; border-radius: 2px;" />`;
			// Insert image inside the anchor, right after the icon <i> tag
			return baseHtml.replace(/<i class="fas fa-dice-d20"><\/i>/, `<i class="fas fa-dice-d20"></i>${imgHtml}`);
		}

		return baseHtml;
	};

	console.log("shadowdark-extras | Patched NpcSD.prototype.buildNpcAttackDisplays");

	// Also patch buildNpcSpecialDisplays to include item images
	if (NpcModel.prototype.buildNpcSpecialDisplays) {
		const originalBuildNpcSpecialDisplays = NpcModel.prototype.buildNpcSpecialDisplays;

		NpcModel.prototype.buildNpcSpecialDisplays = async function(itemId) {
			const actor = this.parent;
			const item = actor?.items.get(itemId);

			// If getting item fails, fallback to original
			if (!item) return originalBuildNpcSpecialDisplays.call(this, itemId);

			const baseHtml = await originalBuildNpcSpecialDisplays.call(this, itemId);

			// Add item image if available and not the default
			const defaultIcon = "icons/svg/explosion.svg";
			if (item.img && item.img !== defaultIcon) {
				const escapedName = foundry.utils.escapeHTML(item.name);
				const escapedImg = foundry.utils.escapeHTML(item.img);
				const imgHtml = `<img src="${escapedImg}" alt="${escapedName}" class="sdx-npc-item-img" style="width: 18px; height: 18px; vertical-align: text-bottom; margin-right: 2px; border: none; border-radius: 2px;" />`;
				// Insert image inside the anchor, right after the icon <i> tag (could be dice-d20 or comment)
				return baseHtml.replace(/<i class="fas (fa-dice-d20|fa-comment)"><\/i>/, `<i class="fas $1"></i>${imgHtml}`);
			}

			return baseHtml;
		};

		console.log("shadowdark-extras | Patched NpcSD.prototype.buildNpcSpecialDisplays");
	}

	// PLAYER WEAPON IMAGES (buildWeaponDisplay) removed: the underlying
	// ActorSD.prototype.buildWeaponDisplay method no longer exists in
	// Shadowdark 4.x. The guard ensured the patch was a silent no-op on the
	// supported system; deleted to reduce dead code.
}

export function registerNpcDisplayPatches() {
	Hooks.once("ready", patchNpcDisplayBuilders);
}
