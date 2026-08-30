/**
 * Weapon bonus configuration and damage calculation facade.
 * Sheet UI/listener code lives in weapon-bonus-ui.mjs; calculation exports
 * remain here for compatibility with combat and item-macro callers.
 */

import { getEffectiveCreatureType } from "../npc/CreatureTypesApp.mjs";
import { applyExplodingAll, shouldExplodeOwnRoll } from "./weapon-momentum.mjs";

const MODULE_ID = "shadowdark-extras";

export {
	getDefaultWeaponBonusConfig,
	injectWeaponBonusTab,
	injectWeaponAnimationButton,
} from "./weapon-bonus-ui.mjs";

/**
 * Evaluate requirements against attacker and target
 * @param {Object[]} requirements - Array of requirement objects
 * @param {Actor} attacker - The attacking actor
 * @param {Actor} target - The target actor
 * @returns {boolean} - Whether all requirements are met
 */
export function evaluateRequirements(requirements, attacker, target) {
	if (!requirements || requirements.length === 0) return true;

	for (const req of requirements) {
		if (!evaluateSingleRequirement(req, attacker, target)) {
			return false;
		}
	}

	return true;
}

/**
 * Resolve an actor's ancestry to a comparable name.
 *
 * SD 4.x declares `PlayerSD.ancestry` as a `DocumentUUIDField`, so the stored
 * value is a UUID *string* — `system.ancestry.name` was always `undefined`, and
 * the old `system.details.ancestry` fallback does not exist in 4.x at all, so
 * every `targetAncestry` requirement compared against "" and never matched.
 * `NpcSD` has no ancestry field whatsoever; "" is the right answer there.
 *
 * Kept synchronous (`fromUuidSync`) because `evaluateRequirements` is called
 * from sync loops in the roll-dialog hook. For a compendium UUID that returns
 * the pack index entry rather than the Document, which still carries `name`.
 *
 * @param {Actor|null} actor
 * @returns {string} the ancestry name, or "" when the actor has none
 */
function resolveAncestryName(actor) {
	const ancestry = actor?.system?.ancestry;
	if (!ancestry) return "";

	// Pre-4.x data (and hand-authored fixtures) stored an object or a bare name.
	if (typeof ancestry !== "string") return ancestry.name || "";
	if (!ancestry.includes(".")) return ancestry;

	if (typeof fromUuidSync !== "function") return "";
	try {
		return fromUuidSync(ancestry)?.name || "";
	}
	catch(e) {
		return "";
	}
}

/**
 * Evaluate a single requirement
 */
function evaluateSingleRequirement(req, attacker, target) {
	const { type, operator, value } = req;
	if (!value && type !== "targetCondition" && type !== "attackerCondition") return true; // Empty value = no requirement

	let testValue = "";

	switch (type) {
		case "targetName":
			testValue = target?.name || "";
			break;

		case "targetCondition":
			// Check if target has any effect/condition containing the value
			const targetEffects = target?.effects?.contents || [];
			const targetItems = target?.items?.filter(i => i.type === "Effect" || i.system?.category === "effect") || [];
			const allTargetEffects = [
				...targetEffects.map(e => e.name),
				...targetItems.map(i => i.name),
			];
			return evaluateArrayContains(allTargetEffects, operator, value);

		case "attackerCondition":
			const attackerEffects = attacker?.effects?.contents || [];
			const attackerItems = attacker?.items?.filter(i => i.type === "Effect" || i.system?.category === "effect") || [];
			const allAttackerEffects = [
				...attackerEffects.map(e => e.name),
				...attackerItems.map(i => i.name),
			];
			return evaluateArrayContains(allAttackerEffects, operator, value);

		case "targetHpPercent":
			const targetHp = target?.system?.attributes?.hp;
			if (!targetHp) return false;
			const targetPercent = (targetHp.value / targetHp.max) * 100;
			return evaluateNumeric(targetPercent, operator, parseFloat(value));

		case "attackerHpPercent":
			const attackerHp = attacker?.system?.attributes?.hp;
			if (!attackerHp) return false;
			const attackerPercent = (attackerHp.value / attackerHp.max) * 100;
			return evaluateNumeric(attackerPercent, operator, parseFloat(value));

		case "targetAncestry":
			testValue = resolveAncestryName(target);
			break;

		case "targetAlignment":
			testValue = target?.system?.alignment || "";
			break;

		case "targetSubtype":
			testValue = getEffectiveCreatureType(target) || "";
			break;

		default:
			return true;
	}

	return evaluateString(testValue, operator, value);
}

/**
 * Evaluate string comparison
 * Supports comma-separated values for OR logic (e.g., "orc, goblin, skeleton")
 */
function evaluateString(testValue, operator, value) {
	const test = (testValue || "").toLowerCase();

	// Split by comma and trim whitespace for OR logic
	const values = (value || "").split(",").map(v => v.trim().toLowerCase()).filter(v => v);

	// If no values, treat as empty/match all
	if (values.length === 0) return true;

	switch (operator) {
		case "contains":
			// Match if test contains ANY of the comma-separated values
			return values.some(val => test.includes(val));
		case "equals":
			// Match if test equals ANY of the comma-separated values
			return values.some(val => test === val);
		case "startsWith":
			// Match if test starts with ANY of the comma-separated values
			return values.some(val => test.startsWith(val));
		case "endsWith":
			// Match if test ends with ANY of the comma-separated values
			return values.some(val => test.endsWith(val));
		case "notContains":
			// Match if test does NOT contain ANY of the comma-separated values
			return !values.some(val => test.includes(val));
		case "notEquals":
			// Match if test does NOT equal ANY of the comma-separated values
			return !values.some(val => test === val);
		default:
			return true;
	}
}

/**
 * Evaluate array contains (for conditions)
 * Supports comma-separated values for OR logic (e.g., "Frightened, Paralyzed")
 */
function evaluateArrayContains(array, operator, value) {
	// Split by comma and trim whitespace for OR logic
	const values = (value || "").split(",").map(v => v.trim().toLowerCase()).filter(v => v);

	// If no values, treat as empty/no requirement
	if (values.length === 0) return true;

	// Check if any array item contains any of the comma-separated values
	const hasMatch = array.some(item => {
		const itemLower = (item || "").toLowerCase();
		return values.some(val => itemLower.includes(val));
	});

	switch (operator) {
		case "contains":
		case "equals":
			return hasMatch;
		case "notContains":
		case "notEquals":
			return !hasMatch;
		default:
			return hasMatch;
	}
}

/**
 * Evaluate numeric comparison
 */
function evaluateNumeric(testValue, operator, value) {
	switch (operator) {
		case "lessThan":
			return testValue < value;
		case "lessThanOrEqual":
			return testValue <= value;
		case "greaterThan":
			return testValue > value;
		case "greaterThanOrEqual":
			return testValue >= value;
		case "equals":
			return Math.abs(testValue - value) < 0.01;
		default:
			return true;
	}
}

/**
 * Get the to-hit bonus for a weapon
 * @param {Item} weapon - The weapon item
 * @param {Actor} attacker - The attacking actor
 * @param {Actor} target - The target actor (optional)
 * @returns {Object} - { hitBonus, hitBonusParts }
 */
export function getWeaponHitBonuses(weapon, attacker, target) {
	const flags = weapon.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.enabled) {
		return { hitBonus: "", hitBonusParts: [] };
	}

	// Process hit bonuses array
	const hitBonuses = flags.hitBonuses || [];
	const applicableBonuses = [];
	let exclusiveMatch = null;

	// Process each hit bonus entry
	for (const bonus of hitBonuses) {
		if (!bonus.formula) continue;

		// Skip prompt bonuses - they are handled separately via the roll dialog
		if (bonus.prompt) continue;

		// Check this bonus's requirements
		if (evaluateRequirements(bonus.requirements || [], attacker, target)) {
			if (bonus.exclusive) {
				exclusiveMatch = {
					formula: bonus.formula,
					label: bonus.label || "",
				};
				break; // Stop processing, use only this exclusive bonus
			}
			applicableBonuses.push({
				formula: bonus.formula,
				label: bonus.label || "",
			});
		}
	}

	// If an exclusive bonus matched, use only that
	if (exclusiveMatch) {
		return {
			hitBonus: exclusiveMatch.formula,
			hitBonusParts: [exclusiveMatch],
		};
	}

	// Combine all applicable bonus formulas
	const combinedFormula = applicableBonuses.map(b => b.formula).filter(f => f).join(" + ");

	return {
		hitBonus: combinedFormula,
		hitBonusParts: applicableBonuses,
	};
}

/**
 * Get the bonus damage formula for a weapon
 * @param {Item} weapon - The weapon item
 * @param {Actor} attacker - The attacking actor
 * @param {Actor} target - The target actor (optional)
 * @param {boolean} isCritical - Whether this is a critical hit
 * @returns {Object} - { damageBonus, criticalDice, criticalDamage }
 */
export function getWeaponBonuses(weapon, attacker, target, isCritical = false) {
	const flags = weapon.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.enabled) {
		return { damageBonus: "", damageBonusParts: [], criticalDice: 0, criticalDamage: "" };
	}

	// Process damage bonuses array
	const damageBonuses = flags.damageBonuses || [];
	const applicableBonuses = [];
	let exclusiveMatch = null;

	// Handle legacy single damageBonus with legacy requirements
	if (damageBonuses.length === 0 && flags.damageBonus) {
		if (evaluateRequirements(flags.requirements, attacker, target)) {
			applicableBonuses.push({ formula: flags.damageBonus, label: "" });
		}
	}
	else {
		// Process each damage bonus entry
		for (const bonus of damageBonuses) {
			if (!bonus.formula) continue;

			// Skip prompt bonuses - they are handled separately via the roll dialog
			if (bonus.prompt) continue;

			// Check this bonus's requirements
			if (evaluateRequirements(bonus.requirements || [], attacker, target)) {
				if (bonus.exclusive) {
					exclusiveMatch = {
						formula: bonus.formula,
						label: bonus.label || "",
					};
					break; // Stop processing, use only this exclusive bonus
				}
				applicableBonuses.push({
					formula: bonus.formula,
					label: bonus.label || "",
				});
			}
		}
	}

	// If an exclusive bonus matched, use only that
	if (exclusiveMatch) {
		return {
			damageBonus: exclusiveMatch.formula,
			damageBonusParts: [exclusiveMatch],
			criticalDice: evaluateRequirements(
				flags.criticalDiceRequirements || [],
				attacker,
				target
			)
				? (parseInt(flags.criticalExtraDice) || 0) : 0,
			criticalDamage: evaluateRequirements(
				flags.criticalDamageRequirements || [],
				attacker,
				target
			)
				? (flags.criticalExtraDamage || "") : "",
		};
	}

	// Combine all applicable bonus formulas
	const combinedFormula = applicableBonuses.map(b => b.formula).filter(f => f).join(" + ");

	return {
		damageBonus: combinedFormula,
		damageBonusParts: applicableBonuses,
		criticalDice: evaluateRequirements(
			flags.criticalDiceRequirements || [],
			attacker,
			target
		)
			? (parseInt(flags.criticalExtraDice) || 0) : 0,
		criticalDamage: evaluateRequirements(
			flags.criticalDamageRequirements || [],
			attacker,
			target
		)
			? (flags.criticalExtraDamage || "") : "",
	};
}

/**
 * Get promptable to-hit bonuses for a weapon (bonuses that appear in roll dialog)
 * @param {Item} weapon - The weapon item
 * @param {Actor} attacker - The attacking actor
 * @param {Actor} target - The target actor (optional)
 * @returns {Object[]} - Array of { formula, label, index } for promptable bonuses
 */
export function getPromptableHitBonuses(weapon, attacker, target) {
	const flags = weapon.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.enabled) {
		return [];
	}

	const hitBonuses = flags.hitBonuses || [];
	const promptableBonuses = [];

	// Process each hit bonus entry
	hitBonuses.forEach((bonus, index) => {
		if (!bonus.formula || !bonus.prompt) return;

		// Check this bonus's requirements
		if (evaluateRequirements(bonus.requirements || [], attacker, target)) {
			promptableBonuses.push({
				formula: bonus.formula,
				label: bonus.label || "",
				index: index,
			});
		}
	});

	return promptableBonuses;
}

/**
 * Get promptable damage bonuses for a weapon (bonuses that appear in roll dialog)
 * @param {Item} weapon - The weapon item
 * @param {Actor} attacker - The attacking actor
 * @param {Actor} target - The target actor (optional)
 * @returns {Object[]} - Array of { formula, label, damageType, index } for promptable bonuses
 */
export function getPromptableDamageBonuses(weapon, attacker, target) {
	const flags = weapon.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.enabled) {
		return [];
	}

	const damageBonuses = flags.damageBonuses || [];
	const promptableBonuses = [];

	// Process each damage bonus entry
	damageBonuses.forEach((bonus, index) => {
		if (!bonus.formula || !bonus.prompt) return;

		// Check this bonus's requirements
		if (evaluateRequirements(bonus.requirements || [], attacker, target)) {
			promptableBonuses.push({
				formula: bonus.formula,
				label: bonus.label || "",
				damageType: bonus.damageType || "",
				index: index,
			});
		}
	});

	return promptableBonuses;
}

/**
 * Get effects to apply from a weapon hit
 * @param {Item} weapon - The weapon item
 * @param {Actor} attacker - The attacking actor
 * @param {Actor} target - The target actor
 * @returns {Object[]} - Array of { uuid, name, img } for effects that should apply
 */
export function getWeaponEffectsToApply(weapon, attacker, target) {

	const flags = weapon.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.enabled || !flags.effects?.length) {
		return [];
	}

	const effectsToApply = [];

	for (const effect of flags.effects) {
		// Check effect-specific requirements
		if (!evaluateRequirements(effect.requirements, attacker, target)) {
			continue;
		}

		// Roll for chance
		const chance = effect.chance ?? 100;
		if (chance < 100) {
			const roll = Math.random() * 100;
			if (roll > chance) {
				console.log(`${MODULE_ID} | Effect ${effect.name} failed chance roll (${roll.toFixed(1)} > ${chance})`);
				continue;
			}
		}

		effectsToApply.push({
			uuid: effect.uuid,
			name: effect.name,
			img: effect.img,
			// Default to true for backward compatibility
			applyToTarget: effect.applyToTarget !== false,
			// Default to true for backward compatibility (stack effects)
			cumulative: effect.cumulative !== false,
		});
	}

	return effectsToApply;
}

/**
 * Evaluate a formula string with actor roll data
 * @param {string} formula - The formula to evaluate (e.g., "@abilities.str.mod" or "2" or "1d4")
 * @param {Actor} actor - The actor to get roll data from
 * @returns {string} - The evaluated formula with values substituted
 */
export function evaluateFormula(formula, actor) {
	if (!formula) return "";

	// Get actor roll data
	const rollData = actor?.getRollData?.() || {};

	// Also add some common shortcuts
	rollData.level = actor?.system?.level?.value || actor?.system?.details?.level || 1;
	rollData.str = actor?.system?.abilities?.str?.mod || 0;
	rollData.dex = actor?.system?.abilities?.dex?.mod || 0;
	rollData.con = actor?.system?.abilities?.con?.mod || 0;
	rollData.int = actor?.system?.abilities?.int?.mod || 0;
	rollData.wis = actor?.system?.abilities?.wis?.mod || 0;
	rollData.cha = actor?.system?.abilities?.cha?.mod || 0;

	// Replace @variable references with their values
	let result = formula;
	const variableRegex = /@([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g;

	result = result.replace(variableRegex, (match, path) => {
		const value = path.split(".").reduce((obj, key) => obj?.[key], rollData);
		return value !== undefined ? String(value) : "0";
	});

	return result;
}

/**
 * Calculate the total weapon bonus damage for a hit
 * @param {Item} weapon - The weapon item
 * @param {Actor} attacker - The attacking actor
 * @param {Actor} target - The target actor (optional)
 * @param {boolean} isCritical - Whether this is a critical hit
 * @returns {Object} - { totalBonus, bonusFormula, criticalExtraDice, criticalBonus,
 * criticalFormula, requirementsMet }
 */
export async function calculateWeaponBonusDamage(weapon, attacker, target, isCritical = false) {
	const flags = weapon?.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.enabled) {
		return {
			totalBonus: 0,
			bonusFormula: "",
			criticalExtraDice: 0,
			criticalBonus: 0,
			criticalFormula: "",
			requirementsMet: true,
		};
	}

	// Per-weapon momentum (issue #134). Every Roll below is built and evaluated
	// here rather than by `shadowdark.dice.roll`, so the world-wide Momentum
	// Mode setting has never reached these dice — only the per-weapon override
	// explodes them, and the system cannot double-apply on top.
	const explodeOwnRolls = shouldExplodeOwnRoll(weapon);
	const withMomentum = formula => (explodeOwnRolls ? applyExplodingAll(formula) : formula);

	// Process damage bonuses array
	const damageBonuses = flags.damageBonuses || [];
	let applicableParts = [];
	let exclusiveMatch = null;

	// Handle legacy single damageBonus with legacy requirements
	if (damageBonuses.length === 0 && flags.damageBonus) {
		if (evaluateRequirements(flags.requirements || [], attacker, target)) {
			const formula = evaluateFormula(flags.damageBonus, attacker);
			if (formula) {
				applicableParts.push({ formula, label: "" });
			}
		}
	}
	else {
		// Process each damage bonus entry
		for (let i = 0; i < damageBonuses.length; i++) {
			const bonus = damageBonuses[i];
			if (!bonus.formula) continue;

			// Skip prompt bonuses - they are handled separately via the roll dialog
			if (bonus.prompt) continue;

			// Skip bonuses with usage === 0 (depleted)
			if (bonus.usage === 0) continue;

			// Check this bonus's requirements
			if (evaluateRequirements(bonus.requirements || [], attacker, target)) {
				const formula = evaluateFormula(bonus.formula, attacker);
				if (formula) {
					const part = {
						formula,
						label: bonus.label || "",
						damageType: bonus.damageType || "",
						bonusIndex: i, // Track index for usage decrement
						hasUsage: bonus.usage !== null
						&& bonus.usage !== undefined
						&& bonus.usage > 0,
					};
					// If this bonus is exclusive and has requirements, use only this bonus
					if (bonus.exclusive && bonus.requirements && bonus.requirements.length > 0) {
						exclusiveMatch = part;
						break; // Stop processing other bonuses
					}
					applicableParts.push(part);
				}
			}
		}
	}


	// If an exclusive bonus matched, use only that
	if (exclusiveMatch) {
		applicableParts = [exclusiveMatch];
	}

	// Check for user-selected prompt bonuses from the roll dialog
	// These are stored in a global map by weapon ID
	if (window._sdxSelectedPromptDamageBonuses && weapon?.id) {
		const selectedPromptBonuses = window._sdxSelectedPromptDamageBonuses.get(weapon.id);
		if (selectedPromptBonuses && selectedPromptBonuses.length > 0) {
			console.log(`${MODULE_ID} | Adding selected prompt damage bonuses:`, selectedPromptBonuses);
			for (const bonus of selectedPromptBonuses) {
				const formula = evaluateFormula(bonus.formula, attacker);
				if (formula) {
					applicableParts.push({
						formula,
						label: "",
						damageType: bonus.damageType || "",
						isPromptBonus: true,
					});

				}
			}
			// Clear the stored bonuses after using them
			window._sdxSelectedPromptDamageBonuses.delete(weapon.id);
		}
	}

	// Roll each damage bonus separately to track damage by type
	const damageComponents = [];
	let totalBonus = 0;
	let bonusRollResults = []; // Store individual dice results for display
	let bonusRolls = []; // NEW: Store actual Roll objects for DSN/Sync


	for (const part of applicableParts) {
		if (!part.formula) continue;

		try {
			const roll = new Roll(withMomentum(part.formula));
			await roll.evaluate();

			// If this is a prompt bonus (added from dialog selection), set black dice appearance
			if (part.isPromptBonus && game.dice3d) {
				roll.options.appearance = {
					colorset: "custom",
					foreground: "#FFFFFF",
					background: "#1a1a1a",
					outline: "#000000",
					edge: "#333333",
					material: "metal",
				};
			}

			bonusRolls.push(roll); // Store the roll
			const amount = roll.total;
			totalBonus += amount;

			damageComponents.push({
				amount: amount,
				type: part.damageType || "standard",
				label: part.label || "",
				formula: part.formula,
			});


			// Extract dice results from the roll for display
			for (const term of roll.terms) {
				if (term.operator) continue; // Skip operators
				if (term.faces !== undefined && term.results) {
					for (const r of term.results) {
						bonusRollResults.push({
							value: r.result,
							faces: term.faces,
							label: part.label || "",
							damageType: part.damageType || "",
							isMax: r.result === term.faces,
							isMin: r.result === 1,
						});
					}
				}
				else if (term.number !== undefined && !term.faces) {
					// Static number
					bonusRollResults.push({
						value: term.number,
						faces: 0, // 0 means static bonus
						label: part.label || "",
						damageType: part.damageType || "",
						isMax: false,
						isMin: false,
					});
				}
			}
		}
		catch(err) {
			console.warn(`${MODULE_ID} | Failed to evaluate damage bonus formula: ${part.formula}`, err);
		}
	}

	// Combine all applicable bonus formulas for display
	const bonusFormula = applicableParts.map(p => p.formula).join(" + ");

	// Handle critical bonuses
	let criticalExtraDice = 0;
	let criticalExtraDiceFormula = ""; // Track the extra dice formula for display
	let criticalBonus = 0;
	let criticalFormula = "";
	let criticalRollResults = [];
	let criticalRolls = []; // NEW: Store actual critical Roll objects

	if (isCritical) {
		if (evaluateRequirements(flags.criticalDiceRequirements || [], attacker, target)) {
			criticalExtraDice = parseInt(flags.criticalExtraDice) || 0;
		}
		if (evaluateRequirements(flags.criticalDamageRequirements || [], attacker, target)) {
			criticalFormula = evaluateFormula(flags.criticalExtraDamage || "", attacker);
		}

		// Roll extra critical dice based on weapon's base damage die
		if (criticalExtraDice > 0 && weapon) {
			// Get the weapon's damage die type
			const damageData = weapon.system?.damage;
			let dieType = null;

			if (damageData) {
				// For player weapons: oneHanded or twoHanded (e.g., "d6")
				if (damageData.oneHanded) {
					dieType = damageData.oneHanded;
				}
				else if (damageData.twoHanded) {
					dieType = damageData.twoHanded;
				}
				// For NPC attacks: value (e.g., "1d6+2") - extract the die
				else if (damageData.value) {
					const dieMatch = damageData.value.match(/d(\d+)/i);
					if (dieMatch) {
						dieType = `d${dieMatch[1]}`;
					}
				}
			}

			if (dieType) {
				// Ensure dieType starts with 'd' (e.g., "d6" not "6")
				if (!dieType.startsWith("d")) {
					dieType = `d${dieType}`;
				}

				const extraDiceFormula = `${criticalExtraDice}${dieType}`;
				criticalExtraDiceFormula = extraDiceFormula; // Store for display
				try {
					const extraDiceRoll = new Roll(withMomentum(extraDiceFormula));
					await extraDiceRoll.evaluate();
					criticalRolls.push(extraDiceRoll);
					criticalBonus += extraDiceRoll.total;

					// Add to damage components
					damageComponents.push({
						amount: extraDiceRoll.total,
						type: "standard",
						label: "Critical Dice",
						formula: extraDiceFormula,
					});

					// Extract dice results
					for (const term of extraDiceRoll.terms) {
						if (term.operator) continue;
						if (term.faces !== undefined && term.results) {
							for (const r of term.results) {
								criticalRollResults.push({
									value: r.result,
									faces: term.faces,
									label: "Critical Dice",
									isMax: r.result === term.faces,
									isMin: r.result === 1,
								});
							}
						}
					}

					console.log(`${MODULE_ID} | Rolled ${criticalExtraDice} extra critical dice (${extraDiceFormula}): ${extraDiceRoll.total}`);
				}
				catch(err) {
					console.warn(`${MODULE_ID} | Failed to roll extra critical dice: ${extraDiceFormula}`, err);
				}
			}
		}

		// Roll extra critical damage formula (separate from extra dice)
		if (criticalFormula) {
			try {
				const critRoll = new Roll(withMomentum(criticalFormula));
				await critRoll.evaluate();
				criticalRolls.push(critRoll); // Store the roll
				criticalBonus += critRoll.total;

				// Critical damage is treated as "standard" type
				damageComponents.push({
					amount: critRoll.total,
					type: "standard",
					label: "Critical",
					formula: criticalFormula,
				});

				// Extract dice results from critical roll
				for (const term of critRoll.terms) {
					if (term.operator) continue;
					if (term.faces !== undefined && term.results) {
						for (const r of term.results) {
							criticalRollResults.push({
								value: r.result,
								faces: term.faces,
								label: "Critical",
								isMax: r.result === term.faces,
								isMin: r.result === 1,
							});
						}
					}
					else if (term.number !== undefined && !term.faces && term.number !== 0) {
						criticalRollResults.push({
							value: term.number,
							faces: 0,
							label: "Critical",
							isMax: false,
							isMin: false,
						});
					}
				}
			}
			catch(err) {
				console.warn(`${MODULE_ID} | Failed to evaluate critical damage formula: ${criticalFormula}`, err);
			}
		}
	}

	// Collect indices of bonuses with usage that were applied (for decrementing)
	const appliedBonusIndicesWithUsage = applicableParts
		.filter(p => p.hasUsage && p.bonusIndex !== undefined)
		.map(p => p.bonusIndex);

	return {
		totalBonus,
		bonusFormula,
		bonusParts: applicableParts,
		bonusRolls, // Actual Roll objects
		bonusRollResults, // Actual dice results from the roll
		damageComponents, // Array of { amount, type, label, formula }
		criticalExtraDice,
		criticalExtraDiceFormula, // Formula for extra critical dice (e.g., "1d6")
		criticalBonus,
		criticalFormula,
		criticalRolls, // Actual Roll objects for critical damage
		criticalRollResults, // Actual dice results from critical roll
		requirementsMet: applicableParts.length > 0 || damageBonuses.length === 0,
		damageTypes: applicableParts.map(p => p.damageType).filter(t => t),
		appliedBonusIndicesWithUsage, // Indices of bonuses that have usage and were applied
	};
}

/**
 * Decrement usage for damage bonuses that were applied
 * @param {Item} weapon - The weapon item
 * @param {number[]} bonusIndices - Array of bonus indices to decrement
 */
export async function decrementDamageBonusUsage(weapon, bonusIndices) {
	if (!weapon || !bonusIndices || bonusIndices.length === 0) return;

	const flags = weapon.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.damageBonuses) return;

	const damageBonuses = [...flags.damageBonuses];
	let updated = false;

	for (const index of bonusIndices) {
		if (
			damageBonuses[index]
			&& damageBonuses[index].usage !== null
			&& damageBonuses[index].usage > 0
		) {
			damageBonuses[index] = {
				...damageBonuses[index],
				usage: damageBonuses[index].usage - 1,
			};
			updated = true;
			console.log(`${MODULE_ID} | Decremented usage for damage bonus "${damageBonuses[index].label || damageBonuses[index].formula}" to ${damageBonuses[index].usage}`);
		}
	}

	if (updated) {
		await weapon.setFlag(MODULE_ID, "weaponBonus.damageBonuses", damageBonuses);
	}
}

/**
 * Get the Item Macro configuration for a weapon
 * @param {Item} weapon - The weapon item
 * @returns {Object} - { enabled, runAsGm, triggers }
 */
export function getWeaponItemMacroConfig(weapon) {
	const flags = weapon?.flags?.[MODULE_ID]?.weaponBonus;
	if (!flags?.itemMacro) {
		return { enabled: false, runAsGm: false, triggers: [] };
	}

	return {
		enabled: flags.itemMacro.enabled || false,
		runAsGm: flags.itemMacro.runAsGm || false,
		triggers: flags.itemMacro.triggers || [],
	};
}

/**
 * Moved here from the composition root in Phase 3. It belongs with
 * `injectWeaponBonusTab` and `injectWeaponAnimationButton` above: the root's
 * `renderItemSheet` dispatch calls all three in the same Weapon branch, and all
 * three read the same `weaponBonus` flag namespace this module owns.
 */
/**
 * Inject a damage type dropdown into the weapon item sheet's Details tab
 */
export function injectWeaponDamageTypeDropdown(app, html, item) {
	// Only for Weapon type items
	if (item.type !== "Weapon") return;

	// Check if already injected
	if (html.find(".sdx-weapon-damage-type-select").length > 0) return;

	// Find the SD-grid content area within the Weapon box
	const $weaponGrid = html.find(".SD-box .content.SD-grid").first();
	if (!$weaponGrid.length) {
		return;
	}

	// Find the Type select to insert after it
	const $typeSelect = $weaponGrid.find('select[name="system.type"]');
	if (!$typeSelect.length) {
		return;
	}

	// Get current damage type from flags
	const currentDamageType = item.getFlag(MODULE_ID, "baseDamageType") || "standard";

	// Build damage type options
	const damageTypes = [
		{ id: "standard", name: "Standard Damage" },
		{ id: "bludgeoning", name: "Bludgeoning" },
		{ id: "slashing", name: "Slashing" },
		{ id: "piercing", name: "Piercing" },
		{ id: "physical", name: "Physical" },
		{ id: "fire", name: "Fire" },
		{ id: "cold", name: "Cold" },
		{ id: "lightning", name: "Lightning" },
		{ id: "acid", name: "Acid" },
		{ id: "poison", name: "Poison" },
		{ id: "necrotic", name: "Necrotic" },
		{ id: "radiant", name: "Radiant" },
		{ id: "psychic", name: "Psychic" },
		{ id: "force", name: "Force" },
	];

	const optionsHtml = damageTypes.map(type =>
		`<option value="${type.id}" ${currentDamageType === type.id ? "selected" : ""}>${type.name}</option>`
	).join("");

	// Create the h3 label and select matching the existing style
	const $damageLabel = $("<h3>Damage Type</h3>");
	const $damageSelect = $(`<select class="sdx-weapon-damage-type-select" name="flags.${MODULE_ID}.baseDamageType">${optionsHtml}</select>`);

	// Insert after the Type select (h3 + select pair)
	$typeSelect.after($damageSelect);
	$damageSelect.before($damageLabel);

	// Handle change event
	$damageSelect.on("change", async function() {
		const newType = $(this).val();
		await item.setFlag(MODULE_ID, "baseDamageType", newType);
	});

}
