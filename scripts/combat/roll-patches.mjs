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
 *   - `setupRollConfigPatches` wraps each actor's roll-config generators and
 *     adds the bonus prompts to the roll dialog.
 *
 * `setupRollConfigPatches` is the reason this module registers anything. It
 * runs *inside* the root's ready hook, so ready has already fired by the time
 * its body executes; it therefore wraps every existing actor by iteration and
 * registers `createActor` to catch new ones, plus `renderRollDialogSD` for the
 * dialog itself. Those two registrations move with it, but their position in
 * the firing order is set by where the root calls this function, which has not
 * changed.
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
				try { item = await fromUuid(itemId); } catch (_e) { item = null; }
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
					} else if (requireTarget === "warn") {
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
						} else if (isThrown) {
							maxRange = 25;
							rangeLabel = "Near (30 ft)";
						} else {
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
								} else if (checkRange === "warn") {
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
						const originalAvailableAmmunition = item.availableAmmunition;
						item.availableAmmunition = function() { return [ammoItem]; };

						try {
							// Temporarily monkeypatch item.rollItem to inject bonuses.
							// Signature verified compatible with Shadowdark 4.0.x:
							// async rollItem(parts, data, options={}) — see
							// systems/shadowdark/src/documents/ItemSD.mjs:214.
							const originalRollItem = item.rollItem;
							item.rollItem = function(parts, data, options) {
								if (!data._sdxAmmoBonusesApplied) {
									const ammoHitBonus = String(ammoItem.getFlag(MODULE_ID, "ammoHitBonus") || "").trim();
									const ammoDamageBonus = String(ammoItem.getFlag(MODULE_ID, "ammoDamageBonus") || "").trim();
									const damageMultiplier = Math.max(
										parseInt(data.item?.system?.bonuses?.damageMultiplier || 0, 10),
										parseInt(data.actor?.system?.bonuses?.damageMultiplier || 0, 10),
										1
									);

									if (ammoHitBonus) {
										let h = ammoHitBonus;
										if (h.startsWith("+")) h = h.substring(1).trim();
										if (h) {
											if (h.toLowerCase().startsWith("d")) h = "1" + h;
											if (!parts.includes("@ammoHitBonus")) {
												parts.push("@ammoHitBonus");
												data.ammoHitBonus = h;
											}
										}
									}

									if (ammoDamageBonus) {
										let d = ammoDamageBonus;
										if (d.startsWith("+")) d = d.substring(1).trim();
										if (d) {
											if (d.toLowerCase().startsWith("d")) d = "1" + d;
											let bonusValue = d;
											if (!d.toLowerCase().includes("d")) {
												bonusValue = parseInt(d, 10) * damageMultiplier;
											} else if (damageMultiplier > 1) {
												bonusValue = `(${d}) * ${damageMultiplier}`;
											}
											if (!data.damageParts.includes("@ammoDamageBonus")) {
												data.damageParts.push("@ammoDamageBonus");
												data.ammoDamageBonus = bonusValue;
											}
										}
									}
									data._sdxAmmoBonusesApplied = true;
								}
								return originalRollItem.call(this, parts, data, options);
							};

							return await originalRollAttack.call(this, forwardId, options);
						} finally {
							item.availableAmmunition = originalAvailableAmmunition;
							if (typeof originalRollItem === "function") item.rollItem = originalRollItem;
						}
					} else {
						return ui.notifications.warn(game.i18n.localize("SHADOWDARK.item.errors.no_available_ammunition"));
					}
				}
			} catch (err) {
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
 * Setup monkeypatches for rollConfigGenerators and hooks for the Roll Dialog.
 * This is the Shadowdark 4.x way to inject advantage and promptable bonuses.
 */
export function setupRollConfigPatches() {
	const wrapActorGenerators = (actor) => {
		const generators = actor.system?.rollConfigGenerators;
		if (!generators || actor.__sdxRollConfigPatched) return;

		for (const [type, original] of Object.entries(generators)) {
			generators[type] = async function(config) {
				await original.call(this, config);
				if (actor.type !== "Player") return;

				// Save the system-generated roll baseline before SDX adds anything.
				// The renderRollDialogSD hook reads these to reconstruct the formula
				// from scratch on every render, preventing double-application.
				if (config.mainRoll) {
					config._sdxSystemBonus = config.mainRoll.bonus ?? "";
					config._sdxSystemBase = config.mainRoll.base ?? "d20";
					config._sdxSystemTooltips = config.mainRoll.tooltips ?? "";
				}
				if (config.damageRoll) {
					config._sdxSystemDamageFormula = config.damageRoll.formula ?? "";
					config._sdxSystemDamageTooltips = config.damageRoll.tooltips ?? "";
				}

				// --- 1. ADVANTAGE / DISADVANTAGE ---
				const bonuses = actor.system.bonuses || {};
				const advFlags = bonuses.advantage || [];
				const disFlags = bonuses.disadvantage || [];

				let hasAdv = false;
				let hasDis = false;

				if (type === "spell" && advFlags.includes("spellcasting")) hasAdv = true;
				if ((type === "ability" || type === "check") && config.check?.stat) {
					if (advFlags.includes(config.check.stat)) hasAdv = true;
					if (disFlags.includes(config.check.stat)) hasDis = true;
				}
				if (type === "attack") {
					const weaponType = config.attack?.type; // melee/ranged
					if (weaponType) {
						if (advFlags.includes(weaponType)) hasAdv = true;
						if (disFlags.includes(weaponType)) hasDis = true;
					}
					// Item specific
					if (config.itemUuid) {
						const item = await fromUuid(config.itemUuid);
						if (item) {
							const slug = item.name.slugify();
							if (advFlags.includes(slug)) hasAdv = true;
							if (disFlags.includes(slug)) hasDis = true;
						}
					}
				}

				if (hasAdv && !hasDis) {
					config.mainRoll.advantage = 1;
					config.mainRoll.tooltips = (config.mainRoll.tooltips || "").concat(", SDX Talent Advantage");
				} else if (hasDis && !hasAdv) {
					config.mainRoll.advantage = -1;
					config.mainRoll.tooltips = (config.mainRoll.tooltips || "").concat(", SDX Talent Disadvantage");
				}

				// --- 2. PROMPTABLE + AUTO-APPLY BONUSES ---
				if (type === "attack" && config.itemUuid) {
					const weapon = await fromUuid(config.itemUuid);
					const targetToken = game.user.targets.first();
					const targetActor = targetToken?.actor || null;

					if (weapon && actor) {
						const hitBonuses = getPromptableHitBonuses(weapon, actor, targetActor);
						const damageBonuses = getPromptableDamageBonuses(weapon, actor, targetActor);
						config._sdxPromptable = { hitBonuses, damageBonuses };

						// Apply selected hit bonuses (from the prompt dialog)
						const selectedHit = config._sdxSelectedHitBonuses || [];
						selectedHit.forEach(b => {
							const bonus = shadowdark.dice.formatBonus(b.formula);
							config.mainRoll.bonus = (config.mainRoll.bonus || "").concat(bonus);
							config.mainRoll.formula = `${config.mainRoll.base}${config.mainRoll.bonus}`;
							config.mainRoll.tooltips = (config.mainRoll.tooltips || "").concat(`, ${b.label || "Bonus"}`);
						});

						// Apply selected damage bonuses (from the prompt dialog)
						const selectedDamage = config._sdxSelectedDamageBonuses || [];
						selectedDamage.forEach(b => {
							if (!config.damageRoll) return;
							const bonus = shadowdark.dice.formatBonus(b.formula);
							config.damageRoll.formula = (config.damageRoll.formula || "").concat(bonus);
							config.damageRoll.tooltips = (config.damageRoll.tooltips || "").concat(`, ${b.label || "Bonus"}`);
						});

						// --- AUTO-APPLY: bonuses without the Prompt checkbox ---
						// Walk every configured hit/damage bonus on the weapon. Skip
						// the promptable ones (handled above). For each remaining
						// bonus, evaluate its requirements (alignment, target type,
						// caster level, etc.) and apply the bonus in-place if met.
						const wbFlags = weapon.flags?.["shadowdark-extras"]?.weaponBonus;
						if (wbFlags?.enabled) {
							for (const bonus of wbFlags.hitBonuses || []) {
								if (!bonus.formula || bonus.prompt) continue;
								if (!evaluateRequirements(bonus.requirements || [], actor, targetActor)) continue;
								const formatted = shadowdark.dice.formatBonus(bonus.formula);
								config.mainRoll.bonus = (config.mainRoll.bonus || "").concat(formatted);
								config.mainRoll.formula = `${config.mainRoll.base}${config.mainRoll.bonus}`;
								config.mainRoll.tooltips = (config.mainRoll.tooltips || "").concat(`, ${bonus.label || "Weapon Bonus"}`);
							}
							// SDX damage bonuses are handled exclusively by calculateWeaponBonusDamage()
							// in CombatSettingsSD.mjs. Do NOT also bake them into the damage roll
							// formula here — that causes double-counting (formula + separate calc).
						}
					}
				}
			};
		}
		actor.__sdxRollConfigPatched = true;
	};

	// Wrap existing actors. setupRollConfigPatches() itself is called from the
	// composition root's main Hooks.once("ready"), so ready has already fired by
	// the time we get here — registering another Hooks.once("ready") would never
	// trigger. Iterate directly.
	for (const actor of game.actors) wrapActorGenerators(actor);

	// Wrap new actors going forward
	Hooks.on("createActor", (actor) => wrapActorGenerators(actor));

	// --- 3. ROLL DIALOG HOOK ---
	// Async so we can look up the weapon via fromUuid. Runs after rendering and
	// updates the formula inputs directly. Always rebuilds from _sdxSystemBonus
	// (saved by the generator wrapper above) so re-renders never double-apply.
	// Also serves as a fallback if the generator wrapper didn't run.
	Hooks.on("renderRollDialogSD", async (app, html, context) => {
		const config = app.config;
		if (!config || config.type !== "attack" || !config.itemUuid || !config.mainRoll) return;

		// SD 4.x identifies the rolling actor by `config.actorUuid` — set in
		// rollAttack() before the generators run — and never sets `actorId`.
		// Reading `actorId` returned undefined here, so every SDX bonus below was
		// unreachable. `fromUuid` is what the system itself uses (RollDialogSD
		// `_onCheckboxChange`) and it also resolves unlinked token actors, which
		// `game.actors.get()` could not have done anyway.
		const rollActor = await fromUuid(config.actorUuid);
		if (!rollActor) return;

		const weapon = await fromUuid(config.itemUuid);
		if (!weapon) return;

		const targetToken = game.user.targets.first();
		const targetActor = targetToken?.actor || null;

		// Use the system-saved baseline when available (set by the generator wrapper).
		// Fall back to current mainRoll values — those equal the system values when
		// the wrapper didn't run, because nothing else modified them yet.
		const systemBonus    = config._sdxSystemBonus    ?? config.mainRoll.bonus    ?? "";
		const systemBase     = config._sdxSystemBase     ?? config.mainRoll.base     ?? "d20";
		const systemTooltips = config._sdxSystemTooltips ?? config.mainRoll.tooltips ?? "";
		const systemDmgFmt   = config._sdxSystemDamageFormula  ?? config.damageRoll?.formula;
		const systemDmgTips  = config._sdxSystemDamageTooltips ?? config.damageRoll?.tooltips ?? "";

		// Build promptable lists for UI and selected-bonus tracking
		const hitBonuses    = getPromptableHitBonuses(weapon, rollActor, targetActor);
		const damageBonuses = getPromptableDamageBonuses(weapon, rollActor, targetActor);
		config._sdxPromptable = { hitBonuses, damageBonuses };

		// Reconstruct hit formula: system baseline + selected promptable + auto-apply
		let hitBonus    = systemBonus;
		let hitTooltips = systemTooltips;

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
		} else {
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
		if (hitTooltips) {
			const hitRollDiv = hitInput?.closest(".roll-input");
			if (hitRollDiv) {
				let tooltipEl = hitRollDiv.querySelector("p.tooltips");
				if (!tooltipEl) {
					tooltipEl = document.createElement("p");
					tooltipEl.className = "tooltips";
					hitRollDiv.appendChild(tooltipEl);
				}
				tooltipEl.textContent = hitTooltips;
			}
		}

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
}
