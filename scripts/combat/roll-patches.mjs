import { MODULE_ID } from "../shared/module-id.mjs";
import AmmunitionSelector from "../inventory/AmmunitionSelector.mjs";
import {
	calculateWeaponBonusDamage,
	evaluateRequirements,
	getPromptableDamageBonuses,
	getPromptableHitBonuses,
} from "./WeaponBonusConfig.mjs";

/**
 * The attack-roll and roll-config prototype patches.
 *
 * Extracted from the composition root in Phase 3, verbatim. Two entry points,
 * both installed once from the root's ready hook and in that order:
 *
 *   - `setupRollAttackPatches` wraps `rollAttack` to apply SDX weapon bonuses,
 *     ammunition selection and range checks. `getEdgeToEdgeDistance` is its
 *     private helper — center-to-center distance is wrong once tokens differ
 *     in size, which is the whole reason it exists.
 *   - `setupRollConfigPatches` registers the roll-dialog hook that applies
 *     SDX talent advantage and bonus prompts to the roll config.
 *
 * `setupRollConfigPatches` is the reason this module registers anything. It
 * runs *inside* the root's ready hook, so ready has already fired by the time
 * its body executes; it registers `renderRollDialogSD` for the dialog itself.
 * The registration's position in the firing order is set by where the root
 * calls this function, which has not changed.
 */

/**
 * Calculate the edge-to-edge distance between two tokens.
 * Unlike center-to-center, this properly handles different token sizes.
 * @param {Token} token1 - First token
 * @param {Token} token2 - Second token
 * @returns {number} Distance in grid units (feet)
 */
function getEdgeToEdgeDistance(token1, token2) {
	const gridSize = canvas.grid.size;

	// Get token bounds in pixels
	const t1 = {
		left: token1.x,
		right: token1.x + (token1.document.width * gridSize),
		top: token1.y,
		bottom: token1.y + (token1.document.height * gridSize),
	};
	const t2 = {
		left: token2.x,
		right: token2.x + (token2.document.width * gridSize),
		top: token2.y,
		bottom: token2.y + (token2.document.height * gridSize),
	};

	// Find the nearest point on t1's edge to t2
	const t1CenterX = (t1.left + t1.right) / 2;
	const t1CenterY = (t1.top + t1.bottom) / 2;
	const t2CenterX = (t2.left + t2.right) / 2;
	const t2CenterY = (t2.top + t2.bottom) / 2;

	const p1x = Math.max(t1.left, Math.min(t2CenterX, t1.right));
	const p1y = Math.max(t1.top, Math.min(t2CenterY, t1.bottom));
	const p2x = Math.max(t2.left, Math.min(t1CenterX, t2.right));
	const p2y = Math.max(t2.top, Math.min(t1CenterY, t2.bottom));

	// Check if tokens are overlapping/adjacent
	const overlapsX = !(t2.left > t1.right || t1.left > t2.right);
	const overlapsY = !(t2.top > t1.bottom || t1.top > t2.bottom);

	if (overlapsX && overlapsY) return 0;

	// Use Foundry's measurePath for proper grid-based distance
	const path = canvas.grid.measurePath([{ x: p1x, y: p1y }, { x: p2x, y: p2y }]);
	return path.distance;
}

/**
 * Setup consolidated patches for ActorSD.prototype.rollAttack (and data models)
 * Covers: Target required, Range check, and Ammunition selection.
 */
export function setupRollAttackPatches() {
	const patchModel = (model) => {
		if (!model?.prototype?.rollAttack) return false;
		if (model.prototype.__sdxRollAttackPatched) return true;
		const originalRollAttack = model.prototype.rollAttack;

		model.prototype.rollAttack = async function(itemId, options = {}) {
			const actor = this.parent || this; // Handle both ActorSD and Data Model

			// SD 4.x rollAttack(weaponUuid) resolves its weapon via fromUuid(), so a
			// bare embedded-item id (passed by the SDX token HUD) yields null →
			// "Invalid weaponId or type". Accept either a bare id or a full uuid here,
			// and forward the uuid so the underlying system call always resolves.
			let item = actor.items.get(itemId);
			if (!item && typeof itemId === "string") {
				try {
					item = await fromUuid(itemId);
				}
				catch (_e) {
					item = null;
				}
			}
			const weaponUuid = item?.uuid ?? itemId;

			// The two underlying rollAttack implementations resolve their argument
			// DIFFERENTLY: PlayerSD.rollAttack(weaponUuid) uses fromUuid() and needs a
			// UUID, but NpcSD.rollAttack(attackId) uses this.parent.items.get() and needs
			// a BARE embedded id. Forwarding a UUID to an NPC makes items.get() return
			// undefined → "invalid attack ID" → the card never posts (silently breaking
			// every NPC attack, special attack, and downstream summon/effect handling).
			// Forward whichever identifier the target model expects.
			const forwardId = (actor?.type === "NPC") ? (item?.id ?? itemId) : weaponUuid;

			if (options._sdxChecked) return originalRollAttack.call(this, forwardId, options);
			options._sdxChecked = true;

			const itemName = item?.name || "weapon";

			try {
				const combatSettings = game.settings.get(MODULE_ID, "combatSettings");
				const requireTarget = combatSettings?.requireTargetForAttack || "none";
				const checkRange = combatSettings?.checkWeaponRange || "none";
				const hasTargets = game.user.targets && game.user.targets.size > 0;

				// --- TARGET REQUIREMENT ---
				if (requireTarget !== "none" && !hasTargets) {
					if (requireTarget === "block") {
						ui.notifications.warn(game.i18n.format("SHADOWDARK_EXTRAS.combat.require_target.blocked", { itemName }));
						return null;
					}
					else if (requireTarget === "warn") {
						ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.combat.require_target.warning", { itemName }));
					}
				}

				// --- RANGE CHECK ---
				if (checkRange !== "none" && hasTargets && item) {
					const attackerToken = actor.getActiveTokens()[0] || canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id);
					if (attackerToken) {
						const targets = Array.from(game.user.targets);
						const weaponType = item.system?.type || "melee";
						const isThrown = await item.isThrownWeapon?.() || false;

						let maxRange;
						let rangeLabel;
						if (weaponType === "melee" && !isThrown) {
							maxRange = 0;
							rangeLabel = "Close (Adjacent)";
						}
						else if (isThrown) {
							maxRange = 25;
							rangeLabel = "Near (30 ft)";
						}
						else {
							maxRange = Infinity;
							rangeLabel = "Far";
						}

						for (const targetToken of targets) {
							const distance = getEdgeToEdgeDistance(attackerToken, targetToken);
							const displayDistance = distance + 5;
							if (distance > maxRange) {
								if (checkRange === "block") {
									ui.notifications.warn(game.i18n.format("SHADOWDARK_EXTRAS.combat.range_check.blocked", { itemName, range: rangeLabel, distance: displayDistance.toFixed(0) }));
									return null;
								}
								else if (checkRange === "warn") {
									ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.combat.range_check.warning", { itemName, range: rangeLabel, distance: displayDistance.toFixed(0) }));
								}
							}
						}
					}
				}

				// --- AMMUNITION SELECTION ---
				if (item && item.type === "Weapon" && item.system.type === "ranged" && item.usesAmmunition) {
					if (options?._sdxAmmoSelected) return originalRollAttack.call(this, forwardId, options);
					const ammoItem = await AmmunitionSelector.select(actor, item);

					if (ammoItem) {
						options._sdxAmmoSelected = true;
						// The 4.x attack flow selects and consumes ammunition via the
						// roll dialog (`config.attack.selectedAmmunition`) and never
						// calls `item.rollItem`, so the old monkeypatches (rollItem /
						// availableAmmunition) were dead. The SDX ammo bonuses now
						// ride the roll config: applyAmmoBonuses runs in the
						// rollFromConfig patch, which sees the final selection
						// (issue #53).
						return await originalRollAttack.call(this, forwardId, options);
					}
					else {
						return ui.notifications.warn(game.i18n.localize("SHADOWDARK.item.errors.no_available_ammunition"));
					}
				}
			}
			catch (err) {
				// Continue normally on error
			}

			return originalRollAttack.call(this, forwardId, options);
		};

		model.prototype.__sdxRollAttackPatched = true;
		return true;
	};

	patchModel(globalThis.shadowdark?.documents?.ActorSD);
	patchModel(CONFIG.Actor.dataModels?.Player);
	patchModel(CONFIG.Actor.dataModels?.NPC);

	// Patch ammunitionItems to return all ammunition prioritized by key
	const ActorSD = globalThis.shadowdark?.documents?.ActorSD;
	if (ActorSD && !ActorSD.prototype.__sdxAmmunitionItemsPatched) {
		const originalAmmunitionItems = ActorSD.prototype.ammunitionItems;
		ActorSD.prototype.ammunitionItems = function(key) {
			const allAmmo = this.items.filter(i => i.system.isAmmunition && i.system.quantity > 0);
			if (key) {
				allAmmo.sort((a, b) => {
					const aMatch = a.name.slugify() === key;
					const bMatch = b.name.slugify() === key;
					if (aMatch && !bMatch) return -1;
					if (!aMatch && bMatch) return 1;
					return a.name.localeCompare(b.name);
				});
			}
			return allAmmo;
		};
		ActorSD.prototype.__sdxAmmunitionItemsPatched = true;
	}
}

/**
 * Update the rendered dialog's tooltip element (`p.tooltips` inside the main
 * roll-input). The dialog renders before the hook runs, so a config change
 * alone would stay invisible on screen.
 */
function syncTooltip(html, tooltips) {
	if (!tooltips) return;
	const input = html.querySelector("input[name=\"mainRoll.formula\"]");
	const rollDiv = input?.closest(".roll-input");
	if (!rollDiv) return;
	let tooltipEl = rollDiv.querySelector("p.tooltips");
	if (!tooltipEl) {
		tooltipEl = document.createElement("p");
		tooltipEl.className = "tooltips";
		rollDiv.appendChild(tooltipEl);
	}
	tooltipEl.textContent = tooltips;
}

/**
 * Apply SDX talent advantage/disadvantage to a roll config for a Player
 * actor. Mirrors the retired generator wrapper's behaviour exactly: Player
 * only; spell via the "spellcasting" flag, ability/check via the stat name,
 * attack via the weapon type or its slug; when both flags match or neither
 * matches, `config.mainRoll.advantage` is left untouched (talents cancel).
 * Returns `{ tooltip, weapon }` — the tooltip text to display (or "") and the
 * resolved weapon (attack configs only, reused by the dialog's bonus work).
 */
async function applyTalentAdvantage(config, rollActor) {
	if (rollActor.type !== "Player") return { tooltip: "", weapon: null };

	const bonuses = rollActor.system.bonuses || {};
	const advFlags = bonuses.advantage || [];
	const disFlags = bonuses.disadvantage || [];

	let hasAdv = false;
	let hasDis = false;
	let weapon = null;

	if (config.type === "spell" && advFlags.includes("spellcasting")) hasAdv = true;
	if ((config.type === "ability" || config.type === "check") && config.check?.stat) {
		if (advFlags.includes(config.check.stat)) hasAdv = true;
		if (disFlags.includes(config.check.stat)) hasDis = true;
	}
	if (config.type === "attack") {
		const weaponType = config.attack?.type; // melee/ranged
		if (weaponType) {
			if (advFlags.includes(weaponType)) hasAdv = true;
			if (disFlags.includes(weaponType)) hasDis = true;
		}
		// Item specific
		if (config.itemUuid) {
			weapon = await fromUuid(config.itemUuid);
			if (weapon) {
				const slug = weapon.name.slugify();
				if (advFlags.includes(slug)) hasAdv = true;
				if (disFlags.includes(slug)) hasDis = true;
			}
		}
	}

	if (hasAdv && !hasDis) {
		config.mainRoll.advantage = 1;
		return { tooltip: "SDX Talent Advantage", weapon };
	}
	if (hasDis && !hasAdv) {
		config.mainRoll.advantage = -1;
		return { tooltip: "SDX Talent Disadvantage", weapon };
	}
	return { tooltip: "", weapon };
}

/**
 * Carry the selected ammunition's SDX hit/damage bonuses into the roll
 * config (issue #53). Shadowdark 4.x picks the ammo inside the roll dialog —
 * `config.attack.selectedAmmunition` is only final after submit — and rolls
 * through `rollFromConfig`, so this runs in the rollFromConfig patch, the
 * single seam that sees the final choice for both dialog and skipPrompt
 * rolls. (The old item.rollItem / availableAmmunition monkeypatches were
 * dead: the 4.x attack flow never calls them.)
 *
 * The damage multiplier semantics are carried over from the retired 3.x
 * path: plain numbers scale by the higher of item/actor `damageMultiplier`;
 * dice expressions become `(XdY) * N`.
 */
async function applyAmmoBonuses(config) {
	// Rerolls (ChatMessageSD -> rerollFromMessage -> rollFromConfig) reuse the
	// config stored on the chat message, which already carries the baked
	// bonuses; without this marker every reroll would append them again
	// (compounding). Underscore keys survive the message round trip.
	if (config._sdxAmmoApplied) return;

	const ammo = config.attack?.selectedAmmunition
		? await fromUuid(config.attack.selectedAmmunition)
		: null;
	if (!ammo) return;

	const normalize = raw => {
		let v = String(raw || "").trim();
		if (!v) return "";
		if (v.startsWith("+")) v = v.substring(1).trim();
		if (!v) return "";
		if (v.toLowerCase().startsWith("d")) v = "1" + v;
		return v;
	};
	const hit = normalize(ammo.getFlag(MODULE_ID, "ammoHitBonus"));
	const rawDamage = normalize(ammo.getFlag(MODULE_ID, "ammoDamageBonus"));
	if (!hit && !rawDamage) return;

	config._sdxAmmoApplied = true;

	let damage = "";
	if (rawDamage) {
		const weapon = config.itemUuid ? await fromUuid(config.itemUuid) : null;
		const rollActor = config.actorUuid ? await fromUuid(config.actorUuid) : null;
		const damageMultiplier = Math.max(
			parseInt(weapon?.system?.bonuses?.damageMultiplier || 0, 10),
			parseInt(rollActor?.system?.bonuses?.damageMultiplier || 0, 10),
			1
		);
		if (!rawDamage.toLowerCase().includes("d")) {
			damage = String(parseInt(rawDamage, 10) * damageMultiplier);
		}
		else if (damageMultiplier > 1) {
			damage = `(${rawDamage}) * ${damageMultiplier}`;
		}
		else {
			damage = rawDamage;
		}
	}

	if (hit) {
		const formatted = shadowdark.dice.formatBonus(hit);
		config.mainRoll.bonus   = (config.mainRoll.bonus || "") + formatted;
		config.mainRoll.formula = (config.mainRoll.formula || "") + formatted;
		config.mainRoll.tooltips = (config.mainRoll.tooltips || "") + ", Ammunition";
		// Show the ammo contribution on the chat card's hit-bonus breakdown
		// when one already exists (the dialog hook built it from the
		// promptable/weapon bonuses).
		if (config._sdxHitBonusInfo?.parts) {
			config._sdxHitBonusInfo.parts.push({ label: "Ammunition", formula: hit });
			config._sdxHitBonusInfo.formula = config._sdxHitBonusInfo.parts
				.map(p => p.formula)
				.join(" + ");
			const asNumber = f => Number(String(f).trim().replace(/^\+/, ""));
			config._sdxHitBonusInfo.result = config._sdxHitBonusInfo.parts.every(
				p => Number.isFinite(asNumber(p.formula))
			)
				? config._sdxHitBonusInfo.parts.reduce((n, p) => n + asNumber(p.formula), 0)
				: null;
		}
	}
	if (damage && config.damageRoll?.formula != null) {
		config.damageRoll.formula   += shadowdark.dice.formatBonus(damage);
		config.damageRoll.tooltips  = (config.damageRoll.tooltips || "") + `, Ammunition (${damage})`;
	}
}

/**
 * Setup the roll-dialog hook (Shadowdark 4.x).
 *
 * This is the Shadowdark 4.x way to inject advantage and promptable bonuses.
 *
 * The hook is the single owner of every SDX contribution to a roll config:
 * talent advantage/disadvantage (all roll types), promptable and auto-apply
 * weapon bonuses (attack rolls), and the formula/tooltip reconstruction that
 * prevents double-application across re-renders. It resolves the rolling
 * actor through `config.actorUuid`, so unlinked token actors are covered too.
 *
 * History: this used to wrap each actor's `rollConfigGenerators` entries and
 * snapshot the system baseline fields for the hook to rebuild from. The
 * wrapper died on every `actor.update()` — the generators are a DataModel
 * class field on `actor.system`, while the "patched" marker lived on the
 * Document — so talent advantage silently stopped applying (issue #52). The
 * wrapper, the marker, the `createActor` hook, and the baseline fields were
 * removed; the hook now derives everything from the freshly generated
 * config, which is safe because every re-render path regenerates first
 * (RollDialogSD._onCheckboxChange and the SDX prompt-row click both call the
 * generator).
 */
export function setupRollConfigPatches() {
	// --- ROLL DIALOG HOOK ---
	// Async so we can look up the weapon via fromUuid. Runs after rendering
	// and updates the formula inputs directly. Rebuilds the hit formula from
	// the freshly generated system values so re-renders never double-apply.
	Hooks.on("renderRollDialogSD", async (app, html, context) => {
		const config = app.config;
		if (!config || !config.mainRoll || (!config.actorUuid && !config.actorId)) return;

		// Mark configs that went through the dialog so the rollFromConfig patch
		// below (dialog-less rolls) never double-applies or overrides the
		// radio choices the submit handler wrote back.
		config._sdxDialogRendered = true;

		// Resolve the rolling actor. Attack/ability/spell configs carry
		// `actorUuid` (set in rollAttack() etc. before the generators run);
		// the spell-learning check config carries only `actorId`
		// (PlayerSD._learnSpell). `fromUuid` also resolves unlinked token
		// actors, which `game.actors.get()` could not have done anyway.
		// Resolving first keeps the async window before the user can submit
		// the dialog tiny (world actors resolve in a microtask; token actors
		// in a canvas lookup).
		const rollActor = config.actorUuid
			? await fromUuid(config.actorUuid)
			: game.actors.get(config.actorId);
		if (!rollActor) return;

		// --- 1. TALENT ADVANTAGE / DISADVANTAGE (all roll types, Players only) ---
		// Moved here from the retired generator wrapper (issue #52): the wrapper
		// died on every actor.update(); the hook survives because it resolves the
		// actor per render. Dialog-less rolls (skipPrompt) are covered by the
		// rollFromConfig patch below.
		let { tooltip: advantageTooltip, weapon } = await applyTalentAdvantage(config, rollActor);

		// The dialog rendered its advantage radios from the config BEFORE this
		// hook ran (RollDialogSD._prepareContext builds advantageOptions from
		// config.mainRoll.advantage), and the submit handler writes the checked
		// radio's value back into config.mainRoll.advantage. Re-sync the radios
		// here or submitting silently discards the SDX value. Skipped when the
		// advantage is not a number (no radio should ever be unchecked).
		if (Number.isFinite(config.mainRoll.advantage)) {
			const wanted = String(config.mainRoll.advantage);
			html.querySelectorAll('input[name="advantage"]').forEach(radio => {
				radio.checked = radio.value === wanted;
			});
		}

		// --- 2. ATTACK-ONLY: weapon bonuses and promptable UI ---
		// Non-attack rolls get the advantage tooltip appended straight to the
		// system-generated tooltips (the system dialog renders those); the hook
		// does not touch their formulas.
		if (config.type !== "attack" || !config.itemUuid) {
			if (advantageTooltip) {
				config.mainRoll.tooltips = (config.mainRoll.tooltips || "").concat(`, ${advantageTooltip}`);
				syncTooltip(html, config.mainRoll.tooltips);
			}
			return;
		}

		if (!weapon) weapon = await fromUuid(config.itemUuid);
		if (!weapon) return;

		const targetToken = game.user.targets.first();
		const targetActor = targetToken?.actor || null;

		// The generator has just populated these with the system's own values
		// (every re-render path regenerates first), so the current config IS the
		// baseline. The wrapper that used to snapshot it into `_sdxSystem*` is
		// gone (issue #52); those fields had no other readers.
		const systemBonus    = config.mainRoll.bonus    ?? "";
		const systemBase     = config.mainRoll.base     ?? "d20";
		const systemTooltips = config.mainRoll.tooltips ?? "";
		const systemDmgFmt   = config.damageRoll?.formula;
		const systemDmgTips  = config.damageRoll?.tooltips ?? "";

		// Build promptable lists for UI and selected-bonus tracking
		const hitBonuses    = getPromptableHitBonuses(weapon, rollActor, targetActor);
		const damageBonuses = getPromptableDamageBonuses(weapon, rollActor, targetActor);
		config._sdxPromptable = { hitBonuses, damageBonuses };

		// Reconstruct hit formula: system baseline + advantage + selected promptable + auto-apply.
		// The advantage tooltip is folded in here (not appended before the rebuild)
		// so the reconstruction pass stays the single writer of `tooltips`.
		let hitBonus    = systemBonus;
		let hitTooltips = advantageTooltip
			? `${systemTooltips}${systemTooltips ? ", " : ""}${advantageTooltip}`
			: systemTooltips;

		// Everything SDX itself contributes to the hit roll, recorded as it is
		// applied. This rides to the chat card on the roll config (see the
		// `_sdxHitBonusInfo` assignment below), which is what combat/hit-bonus.mjs
		// reads to draw the breakdown.
		const sdxHitParts = [];

		(config._sdxSelectedHitBonuses || []).forEach(b => {
			hitBonus    += shadowdark.dice.formatBonus(b.formula);
			hitTooltips += `, ${b.label || "Bonus"}`;
			sdxHitParts.push({ label: b.label || "Bonus", formula: String(b.formula) });
		});

		let dmgFormula  = systemDmgFmt;
		let dmgTooltips = systemDmgTips;

		(config._sdxSelectedDamageBonuses || []).forEach(b => {
			if (dmgFormula == null) return;
			dmgFormula  += shadowdark.dice.formatBonus(b.formula);
			dmgTooltips += `, ${b.label || "Bonus"}`;
		});

		const wbFlags = weapon.flags?.["shadowdark-extras"]?.weaponBonus;
		if (wbFlags?.enabled) {
			for (const bonus of wbFlags.hitBonuses || []) {
				if (!bonus.formula || bonus.prompt) continue;
				if (!evaluateRequirements(bonus.requirements || [], rollActor, targetActor)) continue;
				hitBonus    += shadowdark.dice.formatBonus(bonus.formula);
				hitTooltips += `, ${bonus.label || "Weapon Bonus"}`;
				sdxHitParts.push({ label: bonus.label || "Weapon Bonus", formula: String(bonus.formula) });
			}
			// SDX auto-apply damage bonuses: add to dmgFormula (so the player sees the full
			// expected damage in the dialog) AND to dmgTooltips (with the label). The flag
			// _sdxDamageBonusInFormula tells CombatSettingsSD.mjs not to re-add the bonus
			// when it calls calculateWeaponBonusDamage(), preventing double-counting.
			if (dmgFormula != null) {
				for (const bonus of wbFlags.damageBonuses || []) {
					if (!bonus.formula || bonus.prompt) continue;
					if (!evaluateRequirements(bonus.requirements || [], rollActor, targetActor)) continue;
					const formatted = shadowdark.dice.formatBonus(bonus.formula);
					dmgFormula  += formatted;
					const bonusStr = formatted.trim();
					const sep = dmgTooltips ? ", " : "";
					dmgTooltips += `${sep}${bonus.label || "Weapon Bonus"} (${bonusStr})`;
				}
				// Signal that the bonus is now inside the rolled formula so
				// CombatSettingsSD.mjs skips the double-add. Set both the
				// underscore form and a plain-name form in case DataModel
				// cleaning strips one of them during ChatMessage serialisation.
				if (dmgFormula !== systemDmgFmt) {
					config._sdxDamageBonusInFormula = true;
					config.sdxBonusInDamageFormula  = true;
				}
			}
		}

		// Hand the hit-bonus breakdown to the chat card.
		//
		// It travels on the roll config, which Shadowdark stores whole as
		// `flags.shadowdark.rollConfig` (ChatSD.renderRollMessage), so no
		// module-scope stash and no actor/item key matching is needed — the
		// card reads back exactly what this dialog applied, including any
		// promptable bonus the player ticked. Underscore-prefixed keys survive
		// that round trip; verified against a live ChatMessage.
		//
		// `result` is the numeric total, but only when every part is a plain
		// constant. A dice-valued bonus is rolled inside the d20 roll, so its
		// value is not knowable here; null tells the card to show the formula
		// alone rather than invent a number.
		if (sdxHitParts.length) {
			const asNumber = f => Number(String(f).trim().replace(/^\+/, ""));
			const allConstant = sdxHitParts.every(p => Number.isFinite(asNumber(p.formula)));
			config._sdxHitBonusInfo = {
				formula: sdxHitParts.map(p => p.formula).join(" + "),
				result: allConstant ? sdxHitParts.reduce((n, p) => n + asNumber(p.formula), 0) : null,
				parts: sdxHitParts,
			};
		}
		else {
			// The config object is reused across renders, so an unticked
			// promptable bonus has to clear the previous render's entry.
			delete config._sdxHitBonusInfo;
		}

		// Write reconstructed values back to config
		config.mainRoll.bonus    = hitBonus;
		config.mainRoll.formula  = `${systemBase}${hitBonus}`;
		config.mainRoll.tooltips = hitTooltips;

		if (dmgFormula != null && config.damageRoll) {
			config.damageRoll.formula  = dmgFormula;
			config.damageRoll.tooltips = dmgTooltips;
		}

		// Update formula inputs and tooltip text in the already-rendered dialog.
		// The template has already been rendered with stale values; we patch the DOM
		// directly. The tooltip lives in <p class="tooltips"> inside .roll-input.
		const hitInput = html.querySelector("input[name=\"mainRoll.formula\"]");
		if (hitInput && hitInput.value !== config.mainRoll.formula) {
			hitInput.value = config.mainRoll.formula;
		}
		syncTooltip(html, hitTooltips);

		const dmgInput = html.querySelector("input[name=\"damageRoll.formula\"]");
		if (dmgInput && dmgFormula != null && config.damageRoll) {
			dmgInput.value = config.damageRoll.formula;
		}
		if (dmgTooltips && dmgInput) {
			const dmgRollDiv = dmgInput.closest(".roll-input");
			if (dmgRollDiv) {
				let tooltipEl = dmgRollDiv.querySelector("p.tooltips");
				if (!tooltipEl) {
					tooltipEl = document.createElement("p");
					tooltipEl.className = "tooltips";
					dmgRollDiv.appendChild(tooltipEl);
				}
				tooltipEl.textContent = dmgTooltips;
			}
		}

		// Drop any container left by a previous render before injecting a fresh
		// one. Toggling a promptable bonus re-runs the generator and re-renders,
		// but the injected node survives that render, so without this the dialog
		// grows one extra "Optional ... Bonuses" section per click. Unconditional,
		// and before the early return below, so a config that stops offering
		// promptable bonuses does not leave a stale section behind.
		html.querySelectorAll(".sdx-prompt-bonuses").forEach(el => el.remove());

		// Inject promptable bonus UI (optional bonuses the user can toggle)
		if (hitBonuses.length === 0 && damageBonuses.length === 0) return;

		const promptContainer = document.createElement("div");
		promptContainer.className = "sdx-prompt-bonuses";
		promptContainer.innerHTML = "<hr>";

		const createSection = (title, bonuses, selectedKey) => {
			if (bonuses.length === 0) return;
			const section = document.createElement("div");
			section.className = "sdx-prompt-section";
			section.innerHTML = `<label class="sdx-prompt-section-label">${title}</label>`;

			bonuses.forEach((bonus) => {
				const isChecked = config[selectedKey]?.some(b => b.index === bonus.index) ?? false;
				const row = document.createElement("div");
				row.className = `sdx-prompt-bonus-row ${isChecked ? "sdx-bonus-checked" : ""}`;
				row.innerHTML = `
					<i class="fas ${isChecked ? "fa-check-square" : "fa-square"} sdx-toggle-icon"></i>
					<span class="sdx-prompt-bonus-label">+${bonus.label ? `${bonus.formula} (${bonus.label})` : bonus.formula}</span>
				`;

				row.addEventListener("click", async () => {
					config[selectedKey] ??= [];
					const idx = config[selectedKey].findIndex(b => b.index === bonus.index);
					if (idx >= 0) config[selectedKey].splice(idx, 1);
					else config[selectedKey].push(bonus);

					// Re-trigger generator and re-render app
					const hookActor = await fromUuid(config.actorUuid);
					await hookActor?.system.rollConfigGenerators[config.type]?.(config);
					app.render(true);
				});
				section.appendChild(row);
			});
			promptContainer.appendChild(section);
		};

		createSection("Optional To Hit Bonuses", hitBonuses, "_sdxSelectedHitBonuses");
		createSection("Optional Damage Bonuses", damageBonuses, "_sdxSelectedDamageBonuses");

		const footer = html.querySelector("footer");
		if (footer) footer.before(promptContainer);
	});

	// Dialog-less rolls (skipPrompt: shift/alt/ctrl-clicked checks,
	// RequestCheckSD, LevelUpSD) never fire renderRollDialogSD, so the dialog
	// hook above cannot apply talent advantage there — the retired generator
	// wrapper used to. Patch shadowdark.dice.rollFromConfig (the single roll
	// entry point, a stable global — no lifecycle problem) to apply advantage
	// only to configs that never went through the dialog, mirroring the old
	// wrapper's generation-time behaviour. The dialog hook flags its configs
	// (`_sdxDialogRendered`) so the patch never double-applies or overrides a
	// user's radio choice.
	const dice = globalThis.shadowdark?.dice;
	if (dice?.rollFromConfig && !dice.__sdxRollFromConfigPatched) {
		const originalRollFromConfig = dice.rollFromConfig;
		dice.rollFromConfig = async function(config, ...args) {
			if (config) {
				// Dialog-less rolls never fired renderRollDialogSD, so the
				// dialog hook could not apply talent advantage there.
				if (!config._sdxDialogRendered && (config.actorUuid || config.actorId)) {
					const rollActor = config.actorUuid
						? await fromUuid(config.actorUuid)
						: game.actors.get(config.actorId);
					if (rollActor) await applyTalentAdvantage(config, rollActor);
				}
				// Ammunition bonuses (issue #53): the selected ammo is final
				// only after the dialog submits, so this is the single seam
				// that sees it for both dialog and skipPrompt rolls. Applies
				// for dialog configs too (the advantage guard above is about
				// the dialog's radio ownership, not the ammo).
				if (config.type === "attack" && config.attack?.selectedAmmunition) {
					await applyAmmoBonuses(config);
				}
			}
			return originalRollFromConfig.call(this, config, ...args);
		};
		dice.__sdxRollFromConfigPatched = true;
	}
}
