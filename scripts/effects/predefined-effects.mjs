import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Extra predefined Active Effects, merged into the Shadowdark system's own list.
 *
 * Extracted from the composition root in Phase 3. Everything happens in one
 * `init` hook, because `CONFIG.SHADOWDARK.PREDEFINED_EFFECTS` has to be extended
 * before any sheet reads it. The hook is a no-op when the system has not
 * populated that config, so load order with Shadowdark itself is not assumed.
 *
 * Three groups are added:
 *
 * - **Hand-written entries** — per-ability advantage and disadvantage, melee and
 *   ranged advantage, damage dice overrides, and the SDX flag effects
 *   (`macroExecute`, `silenced`, `invisibility`, `glassbones`, `freyasOmen`).
 * - **Generated entries** — resistance, immunity, vulnerability and absorption
 *   for each of the 14 SDX damage types, plus the two non-magical weapon
 *   variants. These are built in a loop, so the damage-type table is the single
 *   place to add a type.
 * - **Two system patches** for `spellDisadvantage`, which SD 4.x has no path
 *   for. `handlePredefinedEffect` gains a branch that opens the spell picker,
 *   and `modifyEffectChangesWithInput` detects the renamed 4.x change key
 *   (`system.roll.spell.advantage.REPLACEME` with a negative value) and routes
 *   it there. Both wrap and delegate to the original.
 *
 * The `silenced` entry here is only the effect *definition*. The behaviour that
 * blocks casting is `setupSilencedCastingBlocker()`, still in the composition
 * root and reachable only through the large HOOKS block.
 */

/**
 * Register the predefined-effect extensions. The composition root calls this at
 * the source position the `init` hook occupied.
 */
export function registerPredefinedEffects() {
	Hooks.once("init", () => {
		// Only extend if CONFIG.SHADOWDARK exists (system is loaded)
		if (!CONFIG.SHADOWDARK?.PREDEFINED_EFFECTS) {
			console.warn(`${MODULE_ID} | CONFIG.SHADOWDARK.PREDEFINED_EFFECTS not found, skipping ability advantage effects`);
			return;
		}


		// Define ability advantage effects for each ability score
		const abilityAdvantageEffects = {
			abilityAdvantageStr: {
				defaultValue: 1,
				effectKey: "system.roll.stat.advantage.str",
				img: "icons/skills/melee/hand-grip-staff-yellow-brown.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityAdvantageStr",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityAdvantageDex: {
				defaultValue: 1,
				effectKey: "system.roll.stat.advantage.dex",
				img: "icons/skills/movement/feet-winged-boots-glowing-yellow.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityAdvantageDex",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityAdvantageCon: {
				defaultValue: 1,
				effectKey: "system.roll.stat.advantage.con",
				img: "icons/magic/life/heart-area-circle-red-green.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityAdvantageCon",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityAdvantageInt: {
				defaultValue: 1,
				effectKey: "system.roll.stat.advantage.int",
				img: "icons/commodities/gems/gem-faceted-navette-blue.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityAdvantageInt",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityAdvantageWis: {
				defaultValue: 1,
				effectKey: "system.roll.stat.advantage.wis",
				img: "icons/magic/perception/eye-ringed-glow-angry-large-teal.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityAdvantageWis",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityAdvantageCha: {
				defaultValue: 1,
				effectKey: "system.roll.stat.advantage.cha",
				img: "icons/magic/light/orbs-hand-sparkle-yellow.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityAdvantageCha",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityDisadvantageStr: {
				defaultValue: -1,
				effectKey: "system.roll.stat.advantage.str",
				img: "icons/skills/wounds/bone-broken-hand.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityDisadvantageStr",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityDisadvantageDex: {
				defaultValue: -1,
				effectKey: "system.roll.stat.advantage.dex",
				img: "icons/skills/movement/feet-winged-boots-glowing-yellow.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityDisadvantageDex",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityDisadvantageCon: {
				defaultValue: -1,
				effectKey: "system.roll.stat.advantage.con",
				img: "icons/magic/life/heart-black-red.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityDisadvantageCon",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityDisadvantageInt: {
				defaultValue: -1,
				effectKey: "system.roll.stat.advantage.int",
				img: "icons/commodities/gems/gem-broken-red.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityDisadvantageInt",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityDisadvantageWis: {
				defaultValue: -1,
				effectKey: "system.roll.stat.advantage.wis",
				img: "icons/magic/perception/eye-ringed-glow-angry-small-red.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityDisadvantageWis",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			abilityDisadvantageCha: {
				defaultValue: -1,
				effectKey: "system.roll.stat.advantage.cha",
				img: "icons/magic/light/hand-sparks-smoke-teal.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.abilityDisadvantageCha",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			meleeAdvantage: {
				defaultValue: 1,
				effectKey: "system.roll.melee.advantage.all",
				img: "icons/skills/melee/weapons-crossed-swords-yellow.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.meleeAdvantage",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			rangedAdvantage: {
				defaultValue: 1,
				effectKey: "system.roll.ranged.advantage.all",
				img: "icons/skills/ranged/bow-arrow-shooting-gray.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.rangedAdvantage",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			meleeDamageDice: {
				defaultValue: "d=1d4",
				effectKey: `flags.${MODULE_ID}.meleeDamageDice`,
				img: "icons/skills/melee/blade-tip-chipped-blood-red.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.meleeDamageDice",
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			},
			rangedDamageDice: {
				defaultValue: "d=1d4",
				effectKey: `flags.${MODULE_ID}.rangedDamageDice`,
				img: "icons/skills/ranged/arrow-flying-spiral-blue.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.rangedDamageDice",
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			},
			freyasOmen: {
				defaultValue: true,
				effectKey: `flags.${MODULE_ID}.freyasOmen`,
				img: "icons/magic/light/hand-sparks-smoke-teal.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.freyasOmen",
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			},
			macroExecute: {
				defaultValue: "",
				effectKey: `flags.${MODULE_ID}.macroExecute`,
				img: "icons/sundries/scrolls/scroll-worn-tan-red.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.macroExecute",
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			},
			silenced: {
				defaultValue: true,
				effectKey: `flags.${MODULE_ID}.silenced`,
				img: "icons/magic/death/skull-horned-goat-pentagram-red.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.silenced",
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			},
			glassbones: {
				defaultValue: true,
				effectKey: `flags.${MODULE_ID}.glassbones`,
				img: "icons/skills/wounds/bone-broken-knee-beam.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.glassbones",
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			},
			invisibility: {
				defaultValue: true,
				effectKey: `flags.${MODULE_ID}.invisibility`,
				img: "icons/magic/perception/shadow-stealth-eyes-purple.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.invisibility",
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			},
			spellAdvantageAll: {
				defaultValue: 1,
				effectKey: "system.roll.spell.advantage.all",
				img: "icons/magic/symbols/chevron-elipse-circle-blue.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.spellAdvantageAll",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			spellDisadvantageAll: {
				defaultValue: -1,
				effectKey: "system.roll.spell.advantage.all",
				img: "icons/magic/unholy/hand-light-pink.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.spellDisadvantageAll",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
			spellDisadvantage: {
				defaultValue: -1,
				effectKey: "system.roll.spell.advantage.REPLACEME",
				img: "icons/magic/unholy/hand-light-pink.webp",
				name: "SHADOWDARK.item.effect.predefined_effect.spellDisadvantage",
				mode: "CONST.ACTIVE_EFFECT_MODES.ADD",
			},
		};

		// Define custom damage types with icons for resistance, immunity, vulnerability
		const sdxDamageTypes = [
			{
				id: "bludgeoning",
				name: "Bludgeoning",
				resistanceImg: "icons/skills/melee/shield-block-bash-blue.webp",
				immunityImg: "icons/skills/melee/shield-block-gray-yellow.webp",
				vulnerabilityImg: "icons/skills/melee/strike-hammer-destructive-orange.webp",
				absorptionImg: "icons/magic/life/heart-cross-blue.webp",
			},
			{
				id: "slashing",
				name: "Slashing",
				resistanceImg: "icons/skills/melee/shield-damaged-broken-blue.webp",
				immunityImg: "icons/skills/melee/shield-damaged-broken-gold.webp",
				vulnerabilityImg: "icons/skills/melee/strike-blade-blood-red.webp",
				absorptionImg: "icons/magic/life/heart-cross-green.webp",
			},
			{
				id: "piercing",
				name: "Piercing",
				resistanceImg: "icons/skills/melee/shield-block-bash-yellow.webp",
				immunityImg: "icons/skills/melee/shield-block-gray-orange.webp",
				vulnerabilityImg: "icons/skills/melee/strike-spear-red.webp",
				absorptionImg: "icons/magic/life/heart-cross-red.webp",
			},
			{
				id: "physical",
				name: "Physical",
				resistanceImg: "icons/skills/melee/shield-damaged-broken-brown.webp",
				immunityImg: "icons/skills/melee/shield-damaged-broken-orange.webp",
				vulnerabilityImg: "icons/skills/wounds/blood-drip-droplet-red.webp",
				absorptionImg: "icons/magic/life/heart-cross-purple-orange.webp",
			},
			{
				id: "fire",
				name: "Fire",
				resistanceImg: "icons/magic/fire/barrier-wall-flame-ring-yellow.webp",
				immunityImg: "icons/magic/fire/orb-vortex.webp",
				vulnerabilityImg: "icons/magic/fire/explosion-fireball-medium-orange.webp",
				absorptionImg: "icons/magic/fire/flame-burning-hand-orange.webp",
			},
			{
				id: "cold",
				name: "Cold",
				resistanceImg: "icons/magic/water/barrier-ice-crystal-wall-jagged-blue.webp",
				immunityImg: "icons/magic/water/snowflake-ice-blue-white.webp",
				vulnerabilityImg: "icons/magic/water/ice-crystal-white.webp",
				absorptionImg: "icons/magic/water/heart-ice-cold.webp",
			},
			{
				id: "lightning",
				name: "Lightning",
				resistanceImg: "icons/magic/lightning/bolt-forked-blue.webp",
				immunityImg: "icons/magic/lightning/orb-ball-blue.webp",
				vulnerabilityImg: "icons/magic/lightning/bolt-strike-blue.webp",
				absorptionImg: "icons/magic/lightning/bolt-blue.webp",
			},
			{
				id: "acid",
				name: "Acid",
				resistanceImg: "icons/magic/acid/projectile-faceted-glob.webp",
				immunityImg: "icons/magic/acid/orb-bubble-smoke-drip.webp",
				vulnerabilityImg: "icons/magic/acid/dissolve-arm-flesh.webp",
				absorptionImg: "icons/magic/acid/orb-bubble-green.webp",
			},
			{
				id: "poison",
				name: "Poison",
				resistanceImg: "icons/skills/toxins/poison-bottle-corked-fire-green.webp",
				immunityImg: "icons/consumables/potions/flask-ornate-skull-green.webp",
				vulnerabilityImg: "icons/skills/toxins/symbol-poison-drop-skull-green.webp",
				absorptionImg: "icons/consumables/potions/potion-tube-corked-teal.webp",
			},
			{
				id: "necrotic",
				name: "Necrotic",
				resistanceImg: "icons/magic/death/skull-humanoid-crown-white-blue.webp",
				immunityImg: "icons/magic/death/skull-energy-light-purple.webp",
				vulnerabilityImg: "icons/magic/death/hand-withered-gray.webp",
				absorptionImg: "icons/magic/death/undead-skeleton-rags-green.webp",
			},
			{
				id: "radiant",
				name: "Radiant",
				resistanceImg: "icons/magic/holy/angel-wings-gray.webp",
				immunityImg: "icons/magic/holy/barrier-shield-winged-cross.webp",
				vulnerabilityImg: "icons/magic/light/explosion-star-glow-yellow.webp",
				absorptionImg: "icons/magic/holy/angel-winged-humanoid-yellow.webp",
			},
			{
				id: "psychic",
				name: "Psychic",
				resistanceImg: "icons/magic/control/silhouette-hold-beam-blue.webp",
				immunityImg: "icons/magic/control/fear-fright-monster-grin-red-orange.webp",
				vulnerabilityImg: "icons/commodities/biological/organ-brain-pink-purple.webp",
				absorptionImg: "icons/magic/control/telepathy-psychic-mind.webp",
			},
			{
				id: "force",
				name: "Force",
				resistanceImg: "icons/magic/sonic/explosion-shock-wave-teal.webp",
				immunityImg: "icons/magic/defensive/barrier-shield-dome-blue-purple.webp",
				vulnerabilityImg: "icons/magic/sonic/explosion-impact-shock-wave.webp",
				absorptionImg: "icons/magic/sonic/barrier-shock-wave-blue.webp",
			},
		];

		// Register Resistance, Immunity, and Vulnerability effects for each type
		for (const type of sdxDamageTypes) {
			const capId = type.id.charAt(0).toUpperCase() + type.id.slice(1);

			// Resistance
			abilityAdvantageEffects[`resistance${capId}`] = {
				defaultValue: true,
				effectKey: `flags.${MODULE_ID}.resistance.${type.id}`,
				img: type.resistanceImg || "icons/equipment/shield/buckler-wooden-boss-brass.webp",
				name: `SHADOWDARK_EXTRAS.item.effect.predefined_effect.resistance${capId}`,
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			};

			// Immunity
			abilityAdvantageEffects[`immunity${capId}`] = {
				defaultValue: true,
				effectKey: `flags.${MODULE_ID}.immunity.${type.id}`,
				img: type.immunityImg || "icons/magic/defensive/shield-barrier-blue.webp",
				name: `SHADOWDARK_EXTRAS.item.effect.predefined_effect.immunity${capId}`,
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			};

			// Vulnerability (double damage)
			abilityAdvantageEffects[`vulnerability${capId}`] = {
				defaultValue: true,
				effectKey: `flags.${MODULE_ID}.vulnerability.${type.id}`,
				img: type.vulnerabilityImg || "icons/skills/wounds/injury-pain-body-orange.webp",
				name: `SHADOWDARK_EXTRAS.item.effect.predefined_effect.vulnerability${capId}`,
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			};

			// Absorption (value -1 = heal from damage, value 1 = double damage)
			abilityAdvantageEffects[`absorption${capId}`] = {
				defaultValue: -1,
				effectKey: `flags.${MODULE_ID}.absorption.${type.id}`,
				img: type.absorptionImg || "icons/magic/life/heart-cross-purple-orange.webp",
				name: `SHADOWDARK_EXTRAS.item.effect.predefined_effect.absorption${capId}`,
				mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
			};
		}

		// Resistance and Immunity to Non-Magical Weapon attacks
		abilityAdvantageEffects.resistanceNonMagic = {
			defaultValue: true,
			effectKey: `flags.${MODULE_ID}.resistance.nonmagic`,
			img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp",
			name: "SHADOWDARK_EXTRAS.item.effect.predefined_effect.resistanceNonMagic",
			mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
		};

		abilityAdvantageEffects.immunityNonMagic = {
			defaultValue: true,
			effectKey: `flags.${MODULE_ID}.immunity.nonmagic`,
			img: "icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp",
			name: "SHADOWDARK_EXTRAS.item.effect.predefined_effect.immunityNonMagic",
			mode: "CONST.ACTIVE_EFFECT_MODES.OVERRIDE",
		};

		// Merge ability advantage effects into the system's predefined effects
		Object.assign(CONFIG.SHADOWDARK.PREDEFINED_EFFECTS, abilityAdvantageEffects);


		// ============================================
		// SPELL DISADVANTAGE HANDLER PATCH
		// ============================================
		// SD 4.x removed `CONFIG.SHADOWDARK.EFFECT_ASK_INPUT` — the decision now
		// lives in switch logic inside `shadowdark.effects.handlePredefinedEffect`,
		// keyed by effect name (see src/system/ActiveEffectsSD.mjs). The legacy
		// SD 3.x push has been dropped here as part of the SD 4.x compat sweep.

		// Patch handlePredefinedEffect to support spellDisadvantage (like spellAdvantage)
		const originalHandlePredefinedEffect = shadowdark.effects.handlePredefinedEffect;
		shadowdark.effects.handlePredefinedEffect = async function(key, value, name = null) {
			// Handle spellDisadvantage the same way as spellAdvantage
			if (key === "spellDisadvantage") {
				const type = "spell";
				const options = await shadowdark.utils.getSlugifiedItemList(
					await shadowdark.compendiums.spells()
				);
				const chosen = await this.askEffectInput({ name, type, options });
				return chosen[type] ?? [value];
			}
			// Fall back to original for all other keys
			return originalHandlePredefinedEffect.call(this, key, value, name);
		};

		// Patch modifyEffectChangesWithInput to map disadvantage -> spellDisadvantage.
		// SD 4.x renamed the AE change key from `system.bonuses.disadvantage` to
		// `system.roll.spell.advantage.REPLACEME` (with negative value for disadvantage).
		// Detect that pattern and route to SDX's spell-picker handler.
		const originalModifyEffectChangesWithInput =
			shadowdark.effects.modifyEffectChangesWithInput;
		shadowdark.effects.modifyEffectChangesWithInput = async function(
			item, effect, key = false
		) {
			if (!key && effect.changes?.some(c =>
				c.key === "system.roll.spell.advantage.REPLACEME" && Number(c.value) < 0
			)) {
				key = "spellDisadvantage";
			}
			return originalModifyEffectChangesWithInput.call(this, item, effect, key);
		};

	});
}
