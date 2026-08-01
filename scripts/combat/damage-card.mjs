// Damage-card pipeline — extracted from combat/CombatSettingsSD.mjs (Phase 5.1 split).
// Builders, listeners, defense helpers, summon-expiry quartet, formula
// utilities, and the effect-selection dialog of injectDamageCard.

import { decrementDamageBonusUsage } from "./WeaponBonusConfig.mjs";
import { startDurationSpell } from "../effects/FocusSpellTrackerSD.mjs";
import { readSdRollOutcome, readSdDamageRoll } from "../shared/sd4Compat.mjs";
import { getSocket } from "../shared/combat-socket.mjs";
import { getEffectiveCreatureType } from "../npc/CreatureTypesApp.mjs";

const MODULE_ID = "shadowdark-extras";


function normalizeConfiguredEffectUuids(rawEffects) {
	if (!rawEffects) return [];

	let effects = rawEffects;
	if (typeof effects === "string") {
		try {
			effects = JSON.parse(effects);
		}
		catch (err) {
			console.warn("shadowdark-extras | Failed to parse configured effects JSON:", err, rawEffects);
			return [];
		}
	}

	if (!Array.isArray(effects)) return [];

	return effects
		.map(effect => typeof effect === "string" ? { uuid: effect } : {
			uuid: effect?.uuid,
			name: effect?.name,
			img: effect?.img,
			duration: effect?.duration || {},
		})
		.filter(effect => effect.uuid);
}


/**
 * Evaluate a formula that may contain expressions like (1 + floor(@level / 2))d6
 * Returns the simplified dice formula, e.g. "2d6" for level 3
 * @param {string} formula - The formula string to evaluate
 * @param {object} rollData - The roll data object with variables like @level
 * @returns {string} - The evaluated formula with expressions resolved
 */
function evaluateFormulaExpressions(formula, rollData) {
	if (!formula) return formula;

	let evaluated = formula;

	// First, replace any @variable references with their values
	evaluated = evaluated.replace(/@(\w+(?:\.\w+)*)/g, (match, path) => {
		const parts = path.split(".");
		let value = rollData;
		for (const part of parts) {
			if (value && typeof value === "object" && part in value) {
				value = value[part];
			}
			else {
				return match; // Keep original if not found
			}
		}
		return typeof value === "number" ? value : match;
	});

	// Now evaluate any parenthetical expressions containing math before 'd'
	// Pattern: (expression)d followed by a number
	evaluated = evaluated.replace(/\(([^)]+)\)\s*d\s*(\d+)/gi, (match, expr, dieSize) => {
		try {
			// Roll.safeEval's sandbox exposes bare math fns (floor/ceil/round/min/max)
			// via MATH_PROXY; do NOT rewrite to Math.* — that breaks safeEval.
			const numDice = Math.max(1, Math.floor(Roll.safeEval(expr))); // At least 1 die
			return `${numDice}d${dieSize}`;
		}
		catch (e) {
			console.warn("shadowdark-extras | Could not evaluate expression:", expr, e);
			return match;
		}
	});

	// Clean up any remaining standalone floor/ceil expressions not attached to dice
	evaluated = evaluated.replace(/(\d+)\s*\+\s*floor\s*\(\s*([^)]+)\s*\)/gi, (match, base, expr) => {
		try {
			// Pass bare floor() through — Roll.safeEval handles it natively.
			const result = parseInt(base) + Math.floor(Roll.safeEval(expr));
			return result.toString();
		}
		catch (e) {
			return match;
		}
	});

	// Clean up whitespace around 'd'
	evaluated = evaluated.replace(/\s+d\s+/gi, "d");

	return evaluated;
}


/**
 * Double the dice in a formula for critical hits
 * E.g., "2d6+3" becomes "4d6+3", "1d8+1d4" becomes "2d8+2d4"
 * Also handles "(1)d6" format
 * @param {string} formula - The dice formula
 * @returns {string} - The formula with doubled dice
 */
function doubleDiceInFormula(formula) {
	if (!formula) return formula;

	// Match dice patterns like Xd6, 2d8, (1)d6, etc.
	// Handle optional parentheses around the number of dice
	const doubled = formula.replace(/\(?(\d+)\)?\s*d\s*(\d+)/gi, (match, numDice, dieSize) => {
		const doubledNum = parseInt(numDice) * 2;
		return `${doubledNum}d${dieSize}`;
	});

	return doubled;
}


/**
 * Parse a tiered formula string and return the appropriate formula for the given level
 * Format: "1-3:1d6, 4-6:2d8, 7-9:3d10, 10+:4d12"
 * @param {string} tieredFormula - The tiered formula string
 * @param {number} level - The level to check against
 * @returns {string|null} - The formula for the matching tier, or null if no match
 */
function parseTieredFormula(tieredFormula, level) {
	if (!tieredFormula || tieredFormula.trim() === "") return null;

	// Split by comma to get each tier
	const tiers = tieredFormula.split(",").map(t => t.trim());

	for (const tier of tiers) {
		// Parse each tier - format: "X-Y:formula" or "X+:formula"
		const colonIndex = tier.indexOf(":");
		if (colonIndex === -1) continue;

		const rangeStr = tier.substring(0, colonIndex).trim();
		const formula = tier.substring(colonIndex + 1).trim();

		// Check for "X+" format (level X and above)
		if (rangeStr.endsWith("+")) {
			const minLevel = parseInt(rangeStr.slice(0, -1));
			if (!isNaN(minLevel) && level >= minLevel) {
				return formula;
			}
		}
		// Check for "X-Y" format (level X to Y)
		else if (rangeStr.includes("-")) {
			const [minStr, maxStr] = rangeStr.split("-");
			const minLevel = parseInt(minStr);
			const maxLevel = parseInt(maxStr);
			if (!isNaN(minLevel) && !isNaN(maxLevel) && level >= minLevel && level <= maxLevel) {
				return formula;
			}
		}
		// Check for single level "X"
		else {
			const exactLevel = parseInt(rangeStr);
			if (!isNaN(exactLevel) && level === exactLevel) {
				return formula;
			}
		}
	}

	return null;
}


/**
 * Safely evaluate a requirement formula with roll data
 * Supports comparison operators: <, >, <=, >=, ==, !=
 * @param {string} formula - The requirement formula (e.g., "@target.level < 3")
 * @param {object} rollData - The roll data with variable values
 * @returns {boolean} - Whether the requirement is met
 */
function evaluateRequirement(formula, rollData) {
	if (!formula || formula.trim() === "") return true;

	try {
		// Replace @variable references with their values from rollData
		let evalFormula = formula;

		// Build a regex to find all @variable patterns (including nested like @target.level)
		const variableRegex = /@([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g;

		evalFormula = evalFormula.replace(variableRegex, (match, path) => {
			// Navigate the path in rollData (e.g., "target.level" -> rollData.target.level)
			const value = path.split(".").reduce((obj, key) => obj?.[key], rollData);
			if (value === undefined) return 0;
			// Quote string values to prevent ReferenceErrors
			if (typeof value === "string") return JSON.stringify(value);
			return value;
		});

		// Convert single = to == for comparison (users often write "= value" instead of "== value")
		// Must be careful not to affect ==, !=, <=, >=
		evalFormula = evalFormula.replace(/([^=!<>])=([^=])/g, "$1==$2");

		// Auto-quote bareword string literals on the right side of comparisons
		// This handles cases like "@target.subtype == undead" -> "..." == "undead"
		// Match: comparison operator followed by a bareword (not a number, not already quoted)
		evalFormula = evalFormula.replace(/(==|!=|<=?|>=?)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*$/g, (match, op, word) => {
			// Don't quote if it's a boolean or looks like a number
			if (word === "true" || word === "false" || !isNaN(Number(word))) {
				return match;
			}
			return `${op} "${word}"`;
		});

		// Also handle barewords after operators in the middle of expressions
		evalFormula = evalFormula.replace(/(==|!=|<=?|>=?)\s*([a-zA-Z_][a-zA-Z0-9_]*)(\s+(?:&&|\|\|))/g, (match, op, word, rest) => {
			if (word === "true" || word === "false" || !isNaN(Number(word))) {
				return match;
			}
			return `${op} "${word}"${rest}`;
		});

		// Requirement expressions support strings and boolean logic, which Roll.safeEval does not.
		const func = new Function("return (" + evalFormula + ")");
		const result = func();

		// Return true if result is truthy or > 0
		return !!result;
	}
	catch (err) {
		console.warn(`shadowdark-extras | Failed to evaluate requirement: ${formula}`, err);
		return true; // Fail-open: if we can't evaluate, allow the action
	}
}


/**
 * Build target sub-object for roll data with all relevant stats
 * @param {Actor} targetActor - The target actor
 * @returns {object} - The target roll data object
 */
function buildTargetRollData(targetActor) {
	if (!targetActor) return {};

	const targetActorData = targetActor.getRollData() || {};
	const target = {};

	// Flatten target level
	if (targetActorData.level && typeof targetActorData.level === "object" && targetActorData.level.value !== undefined) {
		target.level = targetActorData.level.value;
	}
	else {
		target.level = targetActorData.level || 0;
	}

	// Add target ability modifiers
	if (targetActorData.abilities) {
		["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
			if (targetActorData.abilities[ability]?.mod !== undefined) {
				target[ability] = targetActorData.abilities[ability].mod;
			}
			if (targetActorData.abilities[ability]?.value !== undefined) {
				target[ability + "Base"] = targetActorData.abilities[ability].value;
			}
		});
	}

	// Add target stats
	if (targetActorData.attributes?.ac?.value !== undefined) target.ac = targetActorData.attributes.ac.value;
	if (targetActorData.attributes?.hp?.value !== undefined) target.hp = targetActorData.attributes.hp.value;

	// Add Ancestry and Subtype
	target.ancestry = targetActor.system?.ancestry?.name || targetActor.system?.details?.ancestry || "";
	target.subtype = getEffectiveCreatureType(targetActor) || "";
	target.creatureType = target.subtype; // Alias for convenience

	return target;
}


// Track summoned tokens with expiry info for auto-deletion
// Map<sceneId, Array<{tokenIds: string[], expiryRound: number, spellName: string}>>
const _summonedTokensExpiry = new Map();

/**
 * Get summoned token expiry data from scene flags (persistent) or in-memory Map
 */
function getSummonedTokensExpiry(sceneId) {
	// Try in-memory first
	if (_summonedTokensExpiry.has(sceneId)) {
		return _summonedTokensExpiry.get(sceneId);
	}
	// Try scene flags as fallback (persistent)
	const scene = game.scenes.get(sceneId);
	const flagData = scene?.flags?.[MODULE_ID]?.summonedTokensExpiry;
	if (flagData && Array.isArray(flagData)) {
		_summonedTokensExpiry.set(sceneId, flagData);
		return flagData;
	}
	return null;
}

/**
 * Save summoned token expiry data to both in-memory and scene flags
 */
async function saveSummonedTokensExpiry(sceneId, expiryList) {
	if (expiryList && expiryList.length > 0) {
		_summonedTokensExpiry.set(sceneId, expiryList);
		const scene = game.scenes.get(sceneId);
		if (scene && game.user.isGM) {
			await scene.setFlag(MODULE_ID, "summonedTokensExpiry", expiryList);
		}
	}
	else {
		_summonedTokensExpiry.delete(sceneId);
		const scene = game.scenes.get(sceneId);
		if (scene && game.user.isGM) {
			await scene.unsetFlag(MODULE_ID, "summonedTokensExpiry");
		}
	}
}

/**
 * Add summoned tokens to expiry tracking (exported)
 */
export async function trackSummonedTokensForExpiry(sceneId, tokenIds, expiryRound, spellName) {
	const existingList = getSummonedTokensExpiry(sceneId) || [];
	existingList.push({ tokenIds, expiryRound, spellName });
	await saveSummonedTokensExpiry(sceneId, existingList);
}



/**
 * Show a dialog allowing the user to select which effects to apply
 * @param {Array} effectOptions - Array of {uuid, name, img, data} objects
 * @returns {Promise<Array>} - Array of selected effect data objects, or null if cancelled
 */
async function showEffectSelectionDialog(effectOptions) {
	return new Promise((resolve) => {
		// Build checkboxes HTML
		let checkboxesHtml = "";
		for (let i = 0; i < effectOptions.length; i++) {
			const opt = effectOptions[i];
			checkboxesHtml += `
				<div class="sdx-effect-option" style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
					<input type="checkbox" id="effect-${i}" name="effect-${i}" value="${i}" checked style="width: 16px; height: 16px;">
					<img src="${opt.img}" alt="${opt.name}" style="width: 24px; height: 24px; border-radius: 4px;">
					<label for="effect-${i}" style="cursor: pointer;">${opt.name}</label>
				</div>
			`;
		}

		const dialogContent = `
			<form>
				<p style="margin-bottom: 12px;">Select which effects to apply:</p>
				<div class="sdx-effect-options" style="display: flex; flex-direction: column; gap: 4px;">
					${checkboxesHtml}
				</div>
			</form>
		`;

		new foundry.applications.api.DialogV2({
			window: { title: "Select Effects" },
			content: dialogContent,
			buttons: [
				{
					action: "apply",
					icon: "fas fa-check",
					label: "Apply Selected",
					default: true,
					callback: (event, button, dialog) => {
						const selectedEffects = [];
						for (let i = 0; i < effectOptions.length; i++) {
							const checkbox = dialog.element.querySelector(`input[name="effect-${i}"]`);
							if (checkbox?.checked) {
								selectedEffects.push(effectOptions[i].data);
							}
						}
						resolve(selectedEffects);
					},
				},
				{
					action: "cancel",
					icon: "fas fa-times",
					label: "Cancel",
					callback: () => resolve(null),
				},
			],
			close: () => resolve(null),
		}).render({ force: true });
	});
}


/**
 * Build roll breakdown information from message
 * Returns an object with formula, total, diceHtml, and bonusHtml
 */
async function buildRollBreakdown(message, weaponBonusDamage = null, isCritical = false, baseDamageType = "standard") {
	// Try to get the damage roll (SD 4.x typed Roll OR v3 flag fallback)
	const damageRollData = readSdDamageRoll(message).roll;

	// Also check standard message rolls — prefer the main-typed Roll over rolls[0] for v4 safety
	const messageRoll = readSdRollOutcome(message).mainRoll ?? message.rolls?.[0];

	// Also check for synced spell roll in flags
	const syncedSpellResults = message.getFlag(MODULE_ID, "spellDamageResults");
	let spellRollFromFlag = null;
	const sRollData = syncedSpellResults?.rollJSON || syncedSpellResults?.rollData;
	if (sRollData) {
		try {
			spellRollFromFlag = (typeof sRollData === "string") ? Roll.fromJSON(sRollData) : Roll.fromData(sRollData);
		}
		catch (e) {
			console.error("shadowdark-extras | Error parsing roll from flag:", e);
		}
	}

	// Also check for stored spell roll
	const spellRoll = window._lastSpellRoll;

	// Also check for synced NPC Base Damage
	const syncedNpcBaseResults = message.getFlag(MODULE_ID, "npcBaseDamage");
	let npcBaseRoll = null;
	if (syncedNpcBaseResults?.json) {
		try {
			npcBaseRoll = (typeof syncedNpcBaseResults.json === "string")
				? Roll.fromJSON(syncedNpcBaseResults.json)
				: Roll.fromData(syncedNpcBaseResults.json);
		}
		catch (e) {
			console.error("shadowdark-extras | Error parsing NPC base roll:", e);
		}
	}

	// Use whichever roll we can find (prioritize synced flags, then Shadowdark rolls, then window global).
	// IMPORTANT: do NOT fall back to messageRoll here. messageRoll is the SD "main" roll
	// (the attack / spellcast d20) — it belongs to the SD card above. Rendering it as
	// the SDX damage card's breakdown produces a misleading duplicate for non-damage
	// effect spells like Sleep / Web (the dialog ends up showing "22 = 8 + 14" labelled
	// as a damage breakdown when it's actually the cast roll). If we can't find a real
	// damage roll, return null so the breakdown section is omitted entirely.
	const roll = spellRollFromFlag || damageRollData || spellRoll || npcBaseRoll;

	if (!roll) {
		// Previously fell back to window._lastSpellRollBreakdown here. That global
		// gets set for damage rolls but can also leak the cast roll for effects-only
		// spells (Sleep, Web), producing a stale "1d20 + 14" formula bar inside the
		// SDX card. Per-target damage uses window._perTargetDamage which is read
		// elsewhere, so dropping this fallback is safe — return null instead so the
		// breakdown section is omitted entirely for effect-only spells.
		return null;
	}

	// Clear the stored spell roll after using it
	if (spellRoll && roll === spellRoll) {
		window._lastSpellRoll = null;
	}

	// Extract dice information
	let diceResults = []; // Array of individual dice results
	let totalDiceSum = 0;

	// Handle Foundry Roll object
	// Check roll.dice first (if it has items), otherwise check roll.terms for Die objects
	let dice = [];
	if (roll.dice && roll.dice.length > 0) {
		dice = roll.dice;
	}
	else if (roll.terms) {
		// Filter terms to find dice (objects with faces property)
		dice = roll.terms.filter(t => t.faces !== undefined);
	}

	if (dice.length > 0) {
		for (const die of dice) {
			const faces = die.faces;
			const results = die.results || [];

			for (const r of results) {
				const val = r.result;
				const isCrit = val === faces;
				const isFumble = val === 1;
				const cssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");
				diceResults.push({
					value: val,
					cssClass: cssClass,
					faces: faces,
				});
				totalDiceSum += val;
			}
		}
	}

	// Extract numeric modifiers/bonuses
	const bonuses = [];

	// Check for numeric terms in the roll
	const terms = roll.terms || [];
	let operator = "+";

	for (let i = 0; i < terms.length; i++) {
		const term = terms[i];

		// Track operators
		if (term.operator) {
			operator = term.operator;
			continue;
		}

		// Get numeric values that aren't dice
		if (term.number !== undefined && !term.faces) {
			const value = term.number;
			if (value !== 0) {
				bonuses.push({
					label: "Modifier",
					value: operator === "-" ? -value : value,
				});
			}
		}
	}

	// Add weapon bonus if applicable - use stored roll results instead of re-rolling
	const weaponBonusDiceResults = [];
	if (weaponBonusDamage && weaponBonusDamage.requirementsMet) {

		// Use the stored roll results from calculateWeaponBonusDamage
		if (weaponBonusDamage.bonusRollResults && weaponBonusDamage.bonusRollResults.length > 0) {
			for (const result of weaponBonusDamage.bonusRollResults) {
				if (result.faces > 0) {
					// This is a die result
					const cssClass = result.isMax ? "sdx-die-max" : (result.isMin ? "sdx-die-min" : "");
					weaponBonusDiceResults.push({
						value: result.value,
						cssClass,
						faces: result.faces,
						isBonus: true,
						label: result.label,
					});
				}
				else {
					// This is a static bonus
					bonuses.push({
						label: result.label || "Bonus",
						value: result.value,
					});
				}
			}
		}
		else if (weaponBonusDamage.totalBonus !== 0 && !weaponBonusDamage.bonusFormula.includes("d")) {
			// Fallback for static bonuses without roll results
			bonuses.push({
				label: "Weapon Bonus",
				value: weaponBonusDamage.totalBonus,
			});
		}

		// Handle critical roll results
		if (weaponBonusDamage.criticalRollResults && weaponBonusDamage.criticalRollResults.length > 0) {
			for (const result of weaponBonusDamage.criticalRollResults) {
				if (result.faces > 0) {
					const cssClass = result.isMax ? "sdx-die-max" : (result.isMin ? "sdx-die-min" : "");
					weaponBonusDiceResults.push({
						value: result.value,
						cssClass,
						faces: result.faces,
						isCritBonus: true,
						label: result.label,
					});
				}
				else {
					bonuses.push({
						label: result.label || "Critical Bonus",
						value: result.value,
					});
				}
			}
		}
		else if (weaponBonusDamage.criticalBonus !== 0) {
			// Fallback for critical bonus without roll results
			bonuses.push({
				label: `Crit(${weaponBonusDamage.criticalFormula})`,
				value: weaponBonusDamage.criticalBonus,
			});
		}
	}

	// Build the breakdown string: "Total = d1 + d2 + ... + bonus"
	let breakdownParts = [];

	// Add dice results with data attributes for individual rerolling
	let dieIndex = 0;
	for (const die of diceResults) {
		breakdownParts.push({
			html: `<span class="sdx-die sdx-die-clickable ${die.cssClass}" data-die-index="${dieIndex}" data-faces="${die.faces}" title="Click to reroll this d${die.faces}">${die.value}</span>`,
			value: die.value,
			faces: die.faces,
		});
		dieIndex++;
	}

	// Add weapon bonus dice (styled differently, also clickable)
	for (const die of weaponBonusDiceResults) {
		const extraClass = die.isCritBonus ? "sdx-crit-bonus" : "sdx-weapon-bonus";
		const labelTitle = die.label ? `${die.label} - ` : "";
		breakdownParts.push({
			html: `<span class="sdx-die sdx-die-clickable ${die.cssClass} ${extraClass}" data-die-index="${dieIndex}" data-faces="${die.faces}" title="${labelTitle}Click to reroll this d${die.faces}">${die.value}</span>`,
			value: die.value,
			faces: die.faces,
		});
		dieIndex++;
	}

	// Add static bonuses (just the number, sign handled by join logic)
	for (const bonus of bonuses) {
		const absValue = Math.abs(bonus.value);
		breakdownParts.push({
			html: `<span class="sdx-bonus-val" title="${bonus.label || ""}">${absValue}</span>`,
			value: bonus.value,
		});
	}

	// Calculate actual total from parts (sum all dice and bonuses)
	let actualTotal = 0;
	for (const part of breakdownParts) {
		actualTotal += part.value;
	}

	// Build the breakdown HTML: "Total = d1 + d2 + bonus"
	let breakdownHtml = "";
	if (breakdownParts.length > 0) {
		const partsHtml = breakdownParts.map((part, index) => {
			if (index === 0) return part.html;
			// For subsequent parts, show + or - based on the value
			if (part.value < 0) return `<span class="sdx-plus"> - </span> ${part.html} `;
			return `<span class="sdx-plus"> + </span> ${part.html} `;
		}).join("");

		breakdownHtml = `
							<div class="sdx-roll-breakdown-line">
				<span class="sdx-roll-total">${actualTotal}</span>
				<span class="sdx-equals"> = </span>
				${partsHtml}
			</div>
							`;
	}

	// Build full display formula
	let fullFormula = roll.formula || "";
	if (weaponBonusDamage && weaponBonusDamage.requirementsMet) {
		if (weaponBonusDamage.bonusFormula) {
			fullFormula += ` + ${weaponBonusDamage.bonusFormula}`;
		}
		// Add extra critical dice formula (e.g., "1d6" for Extra Critical Hit Dice)
		if (weaponBonusDamage.criticalExtraDiceFormula && isCritical) {
			fullFormula += ` + ${weaponBonusDamage.criticalExtraDiceFormula}`;
		}
		// Add extra critical damage formula (e.g., "1d4" for Extra Critical Hit Damage)
		if (weaponBonusDamage.criticalFormula && isCritical) {
			fullFormula += ` + ${weaponBonusDamage.criticalFormula}`;
		}
	}

	// Build components list for expandable tooltip
	const components = [];

	// Base damage component
	const isHealing = baseDamageType?.toLowerCase() === "healing";
	const baseLabel = isHealing
		? (game.i18n.localize("SHADOWDARK_EXTRAS.chat.base_healing") || "Base Healing")
		: (game.i18n.localize("SHADOWDARK_EXTRAS.chat.base_damage") || "Base Damage");

	components.push({
		formula: roll.formula || "",
		total: roll.total || 0,
		label: baseLabel,
		type: baseDamageType,
		dice: diceResults.map(d => d.value),
	});

	// Bonus components
	if (weaponBonusDamage?.damageComponents) {
		for (const comp of weaponBonusDamage.damageComponents) {
			components.push({
				formula: comp.formula,
				total: comp.amount,
				label: comp.label,
				type: comp.type,
			});
		}
	}

	return {
		formula: fullFormula,
		total: actualTotal,
		breakdownHtml,
		components,
	};
}

/**
 * Build the damage card HTML
 */
function getTargetDefenseConfig(spellDamageConfig, item) {
	const config = spellDamageConfig?.targetDefense;
	if (!config?.enabled) return null;
	if (!["NPC Feature", "NPC Spell"].includes(item?.type)) return null;

	return {
		enabled: true,
		ability: String(config.ability || "dex").toLowerCase(),
		dc: String(config.dc || "12"),
		successAction: config.successAction || "avoid",
	};
}

function getAbilityModifier(actor, ability) {
	const key = String(ability || "").toLowerCase();
	const rollData = actor?.getRollData?.() ?? {};
	return Number(
		actor?.system?.abilities?.[key]?.mod ??
		rollData?.abilities?.[key]?.mod ??
		rollData?.[key] ??
		0
	) || 0;
}

function getAbilityLabel(ability) {
	const key = String(ability || "").toLowerCase();
	return CONFIG.SHADOWDARK?.ABILITIES_LONG?.[key] || key.toUpperCase();
}

function getTargetDefenseResults(message) {
	return message?.getFlag?.(MODULE_ID, "targetDefenseResults") || {};
}

function getTargetDefenseStatusHtml(result, defenseConfig) {
	if (!result) {
		return "<span class=\"sdx-target-defense-status pending\">Pending</span>";
	}

	const passed = !!result.success;
	const label = passed
		? (defenseConfig.successAction === "half" ? "Half Damage" : "Avoided")
		: "Failed";
	const color = passed ? "#8f8" : "#f88";
	return `<span class="sdx-target-defense-status ${passed ? "success" : "failure"}" style="color: ${color};">${label}: ${result.total}</span>`;
}

function canUserResolveTargetDefense(token) {
	return game.user.isGM || !!token?.actor?.isOwner;
}

function getUnresolvedDefenseTargets($card) {
	return $card.find(".sdx-target-item").filter(function() {
		const $target = $(this);
		const isEnabled = $target.data("enabled") !== false && $target.attr("data-enabled") !== "false";
		if (!isEnabled) return false;

		const $defense = $target.find(".sdx-target-defense");
		return $defense.length > 0 && $defense.attr("data-defense-resolved") !== "true";
	});
}

async function saveTargetDefenseResult(messageId, tokenId, result) {
	if (getSocket() && !game.user.isGM) {
		return getSocket().executeAsGM("setTargetDefenseResult", { messageId, tokenId, result });
	}

	const message = game.messages.get(messageId);
	if (!message) return false;
	const current = foundry.utils.deepClone(message.getFlag(MODULE_ID, "targetDefenseResults") || {});
	current[tokenId] = result;
	await message.setFlag(MODULE_ID, "targetDefenseResults", current);
	return true;
}

async function rollTargetDefenseCheck({ messageId, tokenId, ability, dcFormula, casterActorId }) {
	const token = canvas.tokens.get(tokenId);
	if (!token?.actor) {
		ui.notifications.warn("Target token not found.");
		return;
	}

	if (!canUserResolveTargetDefense(token)) {
		ui.notifications.warn(`Only the GM or ${token.name}'s owner can roll this defense.`);
		return;
	}

	const casterActor = casterActorId ? game.actors.get(casterActorId) : null;
	const rollData = casterActor?.getRollData?.() || {};
	rollData.target = buildTargetRollData(token.actor);

	let dc = 12;
	try {
		const evaluatedFormula = evaluateFormulaExpressions(String(dcFormula || "12"), rollData);
		const dcRoll = new Roll(evaluatedFormula, rollData);
		await dcRoll.evaluate();
		dc = Number(dcRoll.total) || 12;
	}
	catch (err) {
		dc = Number.parseInt(dcFormula, 10) || 12;
	}

	const key = String(ability || "dex").toLowerCase();
	const abilityMod = getAbilityModifier(token.actor, key);
	const defenseRoll = new Roll(`1d20 + ${abilityMod}`);
	await defenseRoll.evaluate();

	if (game.dice3d) {
		await game.dice3d.showForRoll(defenseRoll, game.user, true);
	}

	const result = {
		tokenId,
		actorId: token.actor.id,
		targetName: token.name,
		ability: key,
		dc,
		total: defenseRoll.total,
		formula: defenseRoll.formula,
		success: defenseRoll.total >= dc,
		userId: game.user.id,
		rollJSON: defenseRoll.toJSON(),
	};

	await saveTargetDefenseResult(messageId, tokenId, result);

	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ token }),
		rolls: [defenseRoll],
		content: `<p><strong>${token.name}</strong> rolls ${getAbilityLabel(key)} defense vs DC ${dc}: <strong>${defenseRoll.total}</strong> - ${result.success ? "Success" : "Failure"}</p>`,
	});
}

async function buildDamageCardHtml(actor, targets, totalDamage, damageType, allEffects, spellDamageConfig, settings, message, weaponBonusDamage = null, isCritical = false, spellItem = null, casterTokenId = "", baseDamageType = "standard", isMagicalWeapon = false, challengeResults = null, effectsChallengeResults = null) {


	const cardSettings = settings.damageCard;
	const isHealing = damageType?.toLowerCase() === "healing";
	const targetDefenseConfig = getTargetDefenseConfig(spellDamageConfig, spellItem);
	const targetDefenseResults = getTargetDefenseResults(message);

	// Build roll breakdown HTML
	let rollBreakdownHtml = "";
	const rollBreakdown = await buildRollBreakdown(message, weaponBonusDamage, isCritical, baseDamageType);
	if (rollBreakdown) {
		// Store formula for reroll - escape quotes for data attribute
		const rerollFormula = (rollBreakdown.formula || "").replace(/"/g, "&quot;");

		// Store weapon bonus info for reroll
		let weaponBonusData = "";
		if (weaponBonusDamage && weaponBonusDamage.requirementsMet) {
			const bonusInfo = {
				bonusFormula: weaponBonusDamage.bonusFormula || "",
				totalBonus: weaponBonusDamage.totalBonus || 0,
				criticalFormula: weaponBonusDamage.criticalFormula || "",
				criticalBonus: weaponBonusDamage.criticalBonus || 0,
				damageComponents: weaponBonusDamage.damageComponents || [],
			};
			weaponBonusData = JSON.stringify(bonusInfo).replace(/"/g, "&quot;");
		}

		rollBreakdownHtml = `
						<div class="sdx-roll-breakdown">
								<div class="sdx-roll-formula-row">
									<div class="sdx-roll-formula">${rollBreakdown.formula}</div>
									<button type="button" class="sdx-reroll-btn" data-formula="${rerollFormula}" data-weapon-bonus="${weaponBonusData}" title="Reroll damage (e.g., for Luck token)">
										<i class="fas fa-dice"></i>
									</button>
								</div>
				${rollBreakdown.breakdownHtml || ""}
			</div>
							`;
	}

	// Challenge Result
	let challengeHtml = "";
	if (challengeResults) {
		const statusClass = challengeResults.success ? "success" : "failure";
		const statusText = challengeResults.success ? "SUCCESS" : "FAILURE";

		challengeHtml = `
        <div class="sdx-challenge-result" style="margin-bottom: 8px; border: 1px solid #333; border-radius: 4px; overflow: hidden;">
            <div class="sdx-challenge-header" style="background: rgba(0,0,0,0.5); padding: 4px 8px; font-size: 12px; font-weight: bold; border-bottom: 1px solid #333; display: flex; justify-content: space-between;">
                <span>Challenge Check</span>
                <span>DC ${challengeResults.dc}</span>
            </div>
            <div class="sdx-challenge-body" style="padding: 8px; display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2);">
                <div class="sdx-challenge-value" style="font-size: 18px; font-weight: bold;">
                    ${challengeResults.total}
                    <span style="font-size: 12px; font-weight: normal; opacity: 0.7;">(${challengeResults.formula})</span>
                </div>
                <div class="sdx-challenge-status ${statusClass}" style="padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; ${challengeResults.success ? "background: #2d5a2d; color: #8f8;" : "background: #5a2d2d; color: #f88;"}">
                    ${statusText}
                </div>
            </div>
        </div>
        `;
	}

	// Effects Challenge Result
	let effectsChallengeHtml = "";
	if (effectsChallengeResults) {
		const statusClass = effectsChallengeResults.success ? "success" : "failure";
		const statusText = effectsChallengeResults.success ? "SUCCESS" : "FAILURE";

		effectsChallengeHtml = `
        <div class="sdx-challenge-result" style="margin-bottom: 8px; border: 1px solid #333; border-radius: 4px; overflow: hidden;">
            <div class="sdx-challenge-header" style="background: rgba(0,0,0,0.5); padding: 4px 8px; font-size: 12px; font-weight: bold; border-bottom: 1px solid #333; display: flex; justify-content: space-between;">
                <span>Effects Challenge</span>
                <span>DC ${effectsChallengeResults.dc}</span>
            </div>
            <div class="sdx-challenge-body" style="padding: 8px; display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2);">
                <div class="sdx-challenge-value" style="font-size: 18px; font-weight: bold;">
                    ${effectsChallengeResults.total}
                    <span style="font-size: 12px; font-weight: normal; opacity: 0.7;">(${effectsChallengeResults.formula})</span>
                </div>
                <div class="sdx-challenge-status ${statusClass}" style="padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; ${effectsChallengeResults.success ? "background: #2d5a2d; color: #8f8;" : "background: #5a2d2d; color: #f88;"}">
                    ${statusText}
                </div>
            </div>
        </div>
        `;
	}

	const allChallengeHtml = challengeHtml + effectsChallengeHtml;


	// Build targets HTML
	let targetsHtml = "";
	if (cardSettings.showTargets && targets.length > 0) {
		targetsHtml = '<div class="sdx-damage-targets">';

		for (const target of targets) {
			try {
				const targetActor = target.actor;
				if (!targetActor) {
					console.warn("shadowdark-extras | Target has no actor:", target);
					continue;
				}


				const hp = targetActor.system?.attributes?.hp;
				const currentHp = hp?.value ?? 0;
				const maxHp = hp?.max ?? 0;


				const damageSign = isHealing ? "+" : "-";

				// Check if this target has per-target damage
				const perTargetDamage = window._perTargetDamage?.[target.id];
				const targetSpecificDamage = perTargetDamage ? perTargetDamage.damage : totalDamage;

				// Get roll breakdown for tooltip
				let rollBreakdown = window._lastSpellRollBreakdown || "";
				if (perTargetDamage && perTargetDamage.roll) {
					// Build breakdown for this specific target
					const diceBreakdown = perTargetDamage.roll.dice.map(d => {
						const results = d.results.map(r => r.result).join(", ");
						return `${d.number}${d.faces === "f" ? "dF" : "d" + d.faces}: [${results}]`;
					}).join(" + ");
					rollBreakdown = perTargetDamage.formula + " = " + (diceBreakdown || targetSpecificDamage);
				}
				const tooltipAttr = rollBreakdown ? `data-tooltip="${rollBreakdown}" title="${rollBreakdown}"` : "";

				// Only show damage preview if there's actual damage/healing
				let damagePreviewHtml = "";
				if (targetSpecificDamage > 0) {
					damagePreviewHtml = `<div class="sdx-damage-preview">${damageSign}<span class="sdx-damage-value" data-base-damage="${targetSpecificDamage}" ${tooltipAttr}>${targetSpecificDamage}</span></div>`;
				}

				let targetDefenseHtml = "";
				if (targetDefenseConfig) {
					const result = targetDefenseResults[target.id];
					const abilityLabel = getAbilityLabel(targetDefenseConfig.ability);
					const dcText = foundry.utils.escapeHTML(String(targetDefenseConfig.dc));
					const statusHtml = getTargetDefenseStatusHtml(result, targetDefenseConfig);
					const resolvedAttr = result ? 'data-defense-resolved="true"' : 'data-defense-resolved="false"';
					const successAttr = result?.success ? 'data-defense-success="true"' : 'data-defense-success="false"';
					targetDefenseHtml = `
						<div class="sdx-target-defense" ${resolvedAttr} ${successAttr} data-defense-action="${targetDefenseConfig.successAction}">
							<div class="sdx-target-defense-info">
								<i class="fas fa-shield-halved"></i>
								<span>${abilityLabel} Check vs DC ${dcText}</span>
								${statusHtml}
							</div>
							${result ? "" : `<button type="button" class="sdx-target-defense-roll" data-token-id="${target.id}" data-ability="${targetDefenseConfig.ability}" data-dc="${dcText}" data-success-action="${targetDefenseConfig.successAction}">Roll ${abilityLabel}</button>`}
						</div>
					`;
				}

				// Add enable/disable checkbox if auto-apply is disabled
				const enableCheckbox = !cardSettings.autoApplyDamage ? `
							<input type="checkbox" class="sdx-target-enable-checkbox" data-token-id="${target.id}" checked title="Enable/disable this target" />
								` : "";

				const escapedTargetName = foundry.utils.escapeHTML(targetActor.name);
				const escapedTargetImg = foundry.utils.escapeHTML(targetActor.img ?? "");
				targetsHtml += `
								<div class="sdx-target-item" data-token-id="${target.id}" data-actor-id="${targetActor.id}" data-enabled="true">
									${enableCheckbox}
						<div class="sdx-target-header">
							<img src="${escapedTargetImg}" alt="${escapedTargetName}" class="sdx-target-img" />
							<div class="sdx-target-name">${escapedTargetName}</div>
							${damagePreviewHtml}
						</div>
						${targetDefenseHtml}
						${cardSettings.showMultipliers && totalDamage > 0 ? buildMultipliersHtml(cardSettings.damageMultipliers, target.id) : ""}
					</div>
							`;
			}
			catch (error) {
				console.error("shadowdark-extras | Error processing target:", error, target);
			}
		}

		targetsHtml += "</div>";
	}


	// Build apply buttons
	let applyButtonHtml = "";

	// Damage/healing button
	if (cardSettings.showApplyButton && targets.length > 0 && totalDamage > 0) {
		const buttonText = isHealing ? "APPLY HEALING" : "APPLY DAMAGE";
		const buttonIcon = isHealing ? "fa-heart-pulse" : "fa-hand-sparkles";

		// v14/SD4.x: Reflect already-applied state in DOM so re-renders don't reset the
		// button. Same pattern as the condition button — prevents double-apply when the
		// user clicks after the auto-apply ran on first render.
		const damageApplied = !!message?.getFlag?.(MODULE_ID, "damageApplied");
		const damageBtnText = damageApplied
			? "<i class=\"fas fa-check\"></i> APPLIED"
			: `<i class="fas ${buttonIcon}"></i> ${buttonText}`;
		const damageBtnDisabled = damageApplied ? "disabled" : "";
		const damageBtnAppliedAttr = damageApplied ? 'data-already-applied="true"' : "";

		applyButtonHtml = `
							<div class="sdx-damage-actions">
								<button type="button" class="sdx-apply-damage-btn" data-damage-type="${damageType}" ${damageBtnAppliedAttr} ${damageBtnDisabled}>
									${damageBtnText}
								</button>
						`;
	}

	// Condition button (separate from damage - can appear even for effect-only spells/weapons)
	// For self-targeting effects, show button even without targets (caster is the target)
	const effectsApplyToTarget = spellDamageConfig?.effectsApplyToTarget === true;
	const hasSelfTarget = !effectsApplyToTarget && actor;
	if (allEffects && allEffects.length > 0 && (targets.length > 0 || hasSelfTarget)) {
		const effectsJson = JSON.stringify(allEffects);
		const effectsRequirement = spellDamageConfig?.effectsRequirement || "";

		// Include spell info for focus spell tracking
		const spellInfo = spellItem && ["Spell", "Scroll", "Wand", "NPC Spell"].includes(spellItem.type) ? {
			spellId: spellItem.id,
			spellName: spellItem.name,
			casterActorId: actor?.id,
		} : null;
		const spellInfoJson = spellInfo ? JSON.stringify(spellInfo).replace(/"/g, "&quot;") : "";

		// Start actions div if not already started
		if (!applyButtonHtml) {
			applyButtonHtml = '<div class="sdx-damage-actions">';
		}

		// v14/SD4.x: Reflect already-applied state in DOM so re-renders don't reset the button.
		// Prevents the double-apply bug where the auto-click ran on first render, then a manual
		// click after a re-render fires the handler again on a "fresh" button.
		const conditionsApplied = !!message?.getFlag?.(MODULE_ID, "conditionsApplied");
		const conditionBtnText = conditionsApplied
			? '<i class="fas fa-check"></i> APPLIED'
			: '<i class="fas fa-wand-sparkles"></i> APPLY CONDITION';
		const conditionBtnDisabled = conditionsApplied ? "disabled" : "";
		const conditionBtnAppliedAttr = conditionsApplied ? 'data-already-applied="true"' : "";

		applyButtonHtml += `
						<button type="button" class="sdx-apply-condition-btn"
					data-effects='${effectsJson}'
					data-apply-to-target="${effectsApplyToTarget}"
					data-effects-requirement="${effectsRequirement.replace(/"/g, "&quot;")}"
					data-spell-info="${spellInfoJson}"
					data-effect-selection-mode="${spellDamageConfig?.effectSelectionMode || "all"}"
					${conditionBtnAppliedAttr} ${conditionBtnDisabled}>
						${conditionBtnText}
			</button>
						`;
	}

	// Close actions div if any buttons were added
	if (applyButtonHtml) {
		applyButtonHtml += "</div>";
	}


	// Determine card header based on content
	let headerText; let headerIcon;
	if (totalDamage > 0) {
		headerText = isHealing ? "APPLY HEALING" : "APPLY DAMAGE";
		headerIcon = isHealing ? "fa-heart-pulse" : "fa-heart";
	}
	else if (allEffects && allEffects.length > 0) {
		headerText = "APPLY EFFECTS";
		headerIcon = "fa-wand-sparkles";
	}
	else {
		headerText = "SPELL EFFECTS";
		headerIcon = "fa-magic";
	}

	const finalHtml = `
						<div class="sdx-damage-card" data-message-id="${message.id}" data-item-id="${spellItem?.id || ""}" data-caster-actor-id="${actor?.id || ""}" data-caster-token-id="${casterTokenId}" data-base-damage="${totalDamage}" data-damage-type="${damageType}" data-base-damage-type="${baseDamageType}" data-is-magical-weapon="${isMagicalWeapon}">
							<div class="sdx-damage-card-header">
								<i class="fas ${headerIcon}"></i> ${headerText} <i class="fas fa-chevron-down"></i>
							</div>
			${rollBreakdownHtml}
			<div class="sdx-damage-card-tabs">
				<div class="sdx-tab active">
					<i class="fas fa-bullseye"></i> TARGETED
				</div>
				<div class="sdx-tab">
					<i class="fas fa-mouse-pointer"></i> SELECTED
				</div>
			</div>
			<div class="sdx-damage-card-content">
				${targetsHtml}
				${applyButtonHtml}
			</div>
		</div >
						`;


	return {
		html: finalHtml,
		challengeHtml: allChallengeHtml,
	};
}

/**
 * Build multipliers HTML for a target
 */
function buildMultipliersHtml(multipliers, tokenId) {

	let html = '<div class="sdx-multipliers" data-token-id="' + tokenId + '">';

	// Convert multipliers to array if it's an object
	const multipliersArray = Array.isArray(multipliers) ? multipliers : Object.values(multipliers);


	for (const mult of multipliersArray) {
		if (!mult.enabled) continue;

		// Parse the value to handle both string and number
		const multValue = typeof mult.value === "string" ? parseFloat(mult.value) : mult.value;
		const isDefault = multValue === 1;
		const activeClass = isDefault ? "active" : "";

		html += `
						<button type="button"
					class="sdx-multiplier-btn ${activeClass}"
					data-multiplier="${multValue}"
					data-token-id="${tokenId}">
						${mult.label}
			</button>
						`;
	}

	html += "</div>";


	return html;
}

/**
 * Helper function to rebuild targets list based on active tab
 */
function rebuildTargetsList($card, messageId, baseDamage) {
	const $activeTab = $card.find(".sdx-tab.active");
	const activeTabIndex = $card.find(".sdx-tab").index($activeTab);
	const settings = game.settings.get("shadowdark-extras", "combatSettings");
	const cardSettings = settings.damageCard;

	let targets = [];
	let tabName = "";

	// Get the message to access stored targets
	const message = game.messages.get(messageId);
	const storedTargetIds = message?.flags?.["shadowdark-extras"]?.targetIds;

	// First tab (index 0) is TARGETED, second tab (index 1) is SELECTED
	if (activeTabIndex === 0) {
		// Use stored targets from message if available
		if (storedTargetIds && storedTargetIds.length > 0) {
			targets = storedTargetIds
				.map(id => canvas.tokens.get(id))
				.filter(t => t); // Filter out any tokens that no longer exist
		}
		else {
			// Fallback to current user's targets
			targets = Array.from(game.user.targets);
		}
		tabName = "TARGETED";
	}
	else if (activeTabIndex === 1) {
		targets = canvas.tokens.controlled.filter(t => t.actor);
		tabName = "SELECTED";
	}


	// Get damage type from card
	const damageType = $card.data("damage-type") || "damage";
	const isHealing = damageType === "healing";
	const damageSign = isHealing ? "+" : "-";

	// Build new targets HTML
	let targetsHtml = "";
	for (const target of targets) {
		const actor = target.actor;
		if (!actor) continue;

		const tokenId = target.id;
		const actorId = actor.id;
		const name = foundry.utils.escapeHTML(actor.name);
		const img = foundry.utils.escapeHTML(actor.img || "icons/svg/mystery-man.svg");

		// Add enable/disable checkbox if auto-apply is disabled
		const enableCheckbox = !cardSettings.autoApplyDamage ? `
						<input type="checkbox" class="sdx-target-enable-checkbox" data-token-id="${tokenId}" checked title="Enable/disable this target" />
							` : "";

		targetsHtml += `
							<div class="sdx-target-item" data-token-id="${tokenId}" data-actor-id="${actorId}" data-enabled="true">
								${enableCheckbox}
					<div class="sdx-target-header">
						<img src="${img}" alt="${name}" class="sdx-target-img" />
						<div class="sdx-target-name">${name}</div>
						<div class="sdx-damage-preview">${damageSign}<span class="sdx-damage-value" data-base-damage="${baseDamage}">${baseDamage}</span></div>
					</div>
				${buildMultipliersHtml(cardSettings.damageMultipliers, tokenId)}
			</div>
						`;
	}

	if (targetsHtml === "") {
		targetsHtml = '<div class="sdx-no-targets">No ' + tabName.toLowerCase() + " tokens</div>";
	}

	// Preserve existing Apply Condition button data before rebuilding
	const $existingConditionBtn = $card.find(".sdx-apply-condition-btn");
	let conditionButtonHtml = "";
	if ($existingConditionBtn.length > 0) {
		// Recreate the condition button with same attributes
		const effectsData = $existingConditionBtn.attr("data-effects") || "";
		const applyToTarget = $existingConditionBtn.attr("data-apply-to-target") || "true";
		const effectsRequirement = $existingConditionBtn.attr("data-effects-requirement") || "";
		const spellInfoData = $existingConditionBtn.attr("data-spell-info") || "";
		const effectSelectionMode = $existingConditionBtn.attr("data-effect-selection-mode") || "all";
		// v14/SD4.x: Preserve applied state across tab rebuilds so the "APPLIED" indicator
		// and double-click guard survive when the user switches Targeted/Selected tabs.
		const alreadyApplied = $existingConditionBtn.attr("data-already-applied") === "true";
		const condBtnText = alreadyApplied
			? '<i class="fas fa-check"></i> APPLIED'
			: '<i class="fas fa-wand-sparkles"></i> APPLY EFFECTS';
		const condBtnDisabled = alreadyApplied ? "disabled" : "";
		const condBtnAppliedAttr = alreadyApplied ? 'data-already-applied="true"' : "";

		conditionButtonHtml = `
			<button type="button" class="sdx-apply-condition-btn"
				data-effects='${effectsData}'
				data-apply-to-target="${applyToTarget}"
				data-effects-requirement="${effectsRequirement}"
				data-spell-info="${spellInfoData}"
				data-effect-selection-mode="${effectSelectionMode}"
				${condBtnAppliedAttr} ${condBtnDisabled}>
				${condBtnText}
			</button>`;
	}

	// Build apply button with appropriate text for damage type
	const baseDamageValue = parseInt($card.data("base-damage")) || baseDamage;
	const buttonText = isHealing ? "APPLY HEALING" : "APPLY DAMAGE";
	const buttonIcon = isHealing ? "fa-heart-pulse" : "fa-hand-sparkles";
	// Only show damage button if there's actual damage to apply
	const applyDamageButtonHtml = cardSettings.showApplyButton && baseDamageValue > 0 ?
		`<button type="button" class="sdx-apply-damage-btn" data-damage-type="${damageType}"><i class="fas ${buttonIcon}"></i> ${buttonText}</button>` : "";

	// Combine buttons in a wrapper if any exist
	let buttonsHtml = "";
	if (applyDamageButtonHtml || conditionButtonHtml) {
		buttonsHtml = '<div class="sdx-damage-actions">' + applyDamageButtonHtml + conditionButtonHtml + "</div>";
	}

	// Replace the content
	$card.find(".sdx-damage-card-content").html(targetsHtml + buttonsHtml);

	// Re-attach listeners for new elements
	attachMultiplierListeners($card);
	attachTargetEnableListeners($card);
}

/**
 * Attach multiplier button listeners
 */
function attachMultiplierListeners($card) {
	$card.find(".sdx-multiplier-btn").off("click").on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);
		const tokenId = $btn.data("token-id");
		const multiplier = parseFloat($btn.data("multiplier"));

		// Update active state
		$btn.siblings().removeClass("active");
		$btn.addClass("active");

		// Update damage preview
		const $targetItem = $card.find(`.sdx-target-item[data-token-id="${tokenId}"]`);
		const $damageValue = $targetItem.find(".sdx-damage-value");
		const baseDamage = parseInt($damageValue.data("base-damage"));

		let newDamage;
		if (multiplier === 0 && $btn.text().trim() === "×") {
			newDamage = 0;
		}
		else if (multiplier === -1) {
			newDamage = -baseDamage;
		}
		else {
			newDamage = Math.floor(baseDamage * multiplier);
		}

		$damageValue.text(Math.abs(newDamage));

		// Get the original damage type to determine proper +/- display
		const originalDamageType = $card.data("original-damage-type") || $card.data("damage-type");
		const isOriginallyHealing = (originalDamageType || "").toLowerCase() === "healing";

		// Determine the correct +/- sign based on:
		// - For healing spells: positive newDamage = + (healing), negative = - (damage)
		// - For damage spells: positive newDamage = - (damage), negative = + (healing)
		const $preview = $targetItem.find(".sdx-damage-preview");
		let previewSign;

		if (newDamage === 0) {
			previewSign = "";
		}
		else if (isOriginallyHealing) {
			// Healing spell: positive = +, negative = -
			previewSign = newDamage > 0 ? "+" : "-";
		}
		else {
			// Damage spell: positive = -, negative = +
			previewSign = newDamage > 0 ? "-" : "+";
		}

		$preview.html(previewSign + '<span class="sdx-damage-value" data-base-damage="' + baseDamage + '">' + Math.abs(newDamage) + "</span>");

		$targetItem.data("calculated-damage", newDamage);
		// Update card damage type and button text based on whether damage is healing or damaging
		// This handles cases where multipliers flip the damage sign
		const $applyBtn = $card.find(".sdx-apply-damage-btn");

		// Store original damage type on first load (use the originalDamageType variable)
		if (!$card.data("original-damage-type")) {
			$card.data("original-damage-type", originalDamageType);
		}

		// Determine effective type based on multiplier (isOriginallyHealing already defined above)
		// For healing spells: positive multiplier = healing, negative = damage
		// For damage spells: positive multiplier = damage, negative = healing
		let effectiveDamageType;
		let finalCalculatedDamage;

		if (isOriginallyHealing) {
			if (newDamage >= 0) {
				// Positive on healing spell = healing
				effectiveDamageType = "Healing";
				finalCalculatedDamage = newDamage;
			}
			else {
				// Negative on healing spell = damage (flip the sign for damage application)
				effectiveDamageType = "damage";
				finalCalculatedDamage = Math.abs(newDamage);
			}
		}
		else {
			if (newDamage >= 0) {
				// Positive on damage spell = damage
				effectiveDamageType = "damage";
				finalCalculatedDamage = newDamage;
			}
			else {
				// Negative on damage spell = healing (flip the sign for healing application)
				effectiveDamageType = "Healing";
				finalCalculatedDamage = Math.abs(newDamage);
			}
		}

		// Store the final calculated damage (always positive, type determines heal vs damage)
		$targetItem.data("calculated-damage", finalCalculatedDamage);

		// Update card damage type
		$card.data("damage-type", effectiveDamageType);

		// Update button text and icon
		const isHealing = effectiveDamageType.toLowerCase() === "healing";
		const buttonText = isHealing ? "APPLY HEALING" : "APPLY DAMAGE";
		const buttonIcon = isHealing ? "fa-heart-pulse" : "fa-hand-sparkles";
		$applyBtn.html(`<i class="fas ${buttonIcon}"></i> ${buttonText}`);
	});
}

/**
 * Attach target enable/disable checkbox listeners
 */
function attachTargetEnableListeners($card) {
	$card.find(".sdx-target-enable-checkbox").off("change").on("change", function(e) {
		e.stopPropagation();

		const $checkbox = $(this);
		const tokenId = $checkbox.data("token-id");
		const isEnabled = $checkbox.is(":checked");

		// Update target item's enabled state
		const $targetItem = $card.find(`.sdx-target-item[data-token-id="${tokenId}"]`);
		$targetItem.attr("data-enabled", isEnabled);
		$targetItem.data("enabled", isEnabled);

		// Visual feedback - gray out disabled targets
		if (isEnabled) {
			$targetItem.removeClass("sdx-target-disabled");
		}
		else {
			$targetItem.addClass("sdx-target-disabled");
		}

	});
}

/**
 * Spawn summoned creatures automatically when a spell is cast
 * @param {boolean} isCriticalSuccess - If true, duration will be doubled
 */
/**
 * Ensure a creature actor exists in game.actors before spawning.
 * Compendium actors must be imported so item-piles' preCreateToken hook
 * can resolve document.actor (which returns null for non-world actors).
 * Returns the resolved world UUID, or the original UUID on failure.
 */
async function _resolveActorForSummon(uuid) {
	if (!uuid) return uuid;

	// Already a world actor — nothing to do.
	const sync = fromUuidSync(uuid);
	if (sync instanceof Actor && !sync.pack) return uuid;

	// Try to import from compendium.
	try {
		const parts = uuid.split(".");
		// Expected format: "Compendium.<scope>.<packName>.<docId>"
		if (parts.length < 4) return uuid;

		const packId = `${parts[1]}.${parts[2]}`;
		const docId  = parts[parts.length - 1];
		const pack   = game.packs.get(packId);
		if (!pack) return uuid;

		// Re-use an already-imported copy from this session if present.
		const existing = game.actors.find(a =>
			a.getFlag(MODULE_ID, "_sdxSummonSourceUuid") === uuid
		);
		if (existing) return existing.uuid;

		const imported = await game.actors.importFromCompendium(pack, docId);
		if (!imported) return uuid;

		await imported.setFlag(MODULE_ID, "_sdxSummonSourceUuid", uuid);
		return imported.uuid;
	}
	catch (err) {
		console.warn(`${MODULE_ID} | Could not import summon actor from compendium (${uuid}):`, err);
		return uuid;
	}
}

export async function spawnSummonedCreatures(casterActor, item, profiles, summoningConfig = {}, isCriticalSuccess = false) {

	try {
		profiles = Array.isArray(profiles)
			? profiles
			: (profiles && typeof profiles === "object" ? Object.values(profiles) : []);

		// Check if Portal library is available
		if (typeof Portal === "undefined") {
			ui.notifications.error("Portal library not found. Please install the 'portal-lib' module.");
			return;
		}

		// Get the caster's token as the origin point
		const casterToken = casterActor?.getActiveTokens()?.[0];
		if (!casterToken) {
			ui.notifications.warn("Could not find caster token on the scene");
			return;
		}

		// Resolve the user who controls the caster actor so we grant ownership
		// to the right player, not just whoever is running this code (usually GM).
		const summonerUser = game.users.find(u => u.character?.id === casterActor.id);
		const ownerUserId  = summonerUser?.id ?? game.user.id;

		// Pre-resolve all creature UUIDs to world actors.
		// item-piles' preCreateToken hook reads document.actor, which is null for
		// compendium actors that haven't been imported. We import them first so
		// game.actors.get(actorId) succeeds inside item-piles' hook.
		const resolvedProfiles = [];
		for (const profile of profiles) {
			const creatureUuid = profile?.creatureUuid || profile?.creature || profile?.uuid || "";
			if (!creatureUuid) {
				console.warn(`${MODULE_ID} | Skipping summon profile with no UUID`, profile);
				continue;
			}
			const worldUuid = await _resolveActorForSummon(creatureUuid);
			resolvedProfiles.push({ ...profile, creatureUuid, worldUuid });
		}

		if (resolvedProfiles.length === 0) {
			ui.notifications.warn("No summon creatures are configured. Drop an actor into the summon row first.");
			return;
		}

		// Create Portal instance and set origin
		const portal = new Portal();
		portal.origin(casterToken);

		// Add each creature profile (using the resolved world UUID)
		for (const profile of resolvedProfiles) {
			// Parse count formula if it's a dice formula
			let count = 1;
			const countFormula = profile.count || "1";
			if (typeof countFormula === "string" && countFormula.includes("d")) {
				try {
					const roll = new Roll(countFormula);
					await roll.evaluate();
					count = roll.total;
					await roll.toMessage({
						flavor: `Summoning ${profile.displayName || profile.creatureName || "creatures"}`,
						speaker: ChatMessage.getSpeaker({ actor: casterActor }),
					});
				}
				catch (err) {
					console.warn(`${MODULE_ID} | Invalid count formula, using 1:`, countFormula, err);
					count = 1;
				}
			}
			else {
				count = parseInt(countFormula) || 1;
			}

			portal.addCreature({
				creature: profile.worldUuid,
				count,
				displayName: profile.displayName || "",
			});
		}

		// Spawn — shows placement UI and creates the tokens on the scene
		const creatures = await portal.spawn();

		// Check if creatures were spawned
		if (creatures && creatures.length > 0) {
			// Grant ownership to the summoner.
			// Always update the world actor's ownership directly — Foundry checks the base
			// actor first for both linked AND unlinked tokens (the delta only overrides when
			// explicitly set). Updating delta.ownership via updateEmbeddedDocuments goes
			// through server-side sanitization that requires a user-context Foundry doesn't
			// provide in token batch-updates, causing a crash.
			const actorIdsUpdated = new Set();
			for (const token of creatures) {
				const worldActor = game.actors.get(token.actorId);
				if (!worldActor || actorIdsUpdated.has(worldActor.id)) continue;
				await worldActor.update({
					ownership: {
						...worldActor.ownership,
						[ownerUserId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
					},
				});
				actorIdsUpdated.add(worldActor.id);
			}

			// Duration tracking — run regardless of summoningConfig flags so that any
			// summoning spell with a duration shows up in the focus tracker and auto-expires.
			const duration     = item?.system?.duration;
			const durationType = duration?.type;
			let   durationValue = parseInt(duration?.value) || 0;
			if (isCriticalSuccess && durationValue > 0) durationValue *= 2;

			const tokenIds  = creatures.map(t => t.id);
			const hasDuration = (durationType === "rounds" || durationType === "turns") && durationValue > 0;

			if (hasDuration) {
				// Always show summoning spells in the focus spell duration tracker.
				// (Replaces the old spellDamageConfig.trackDuration guard — summoning
				// spells should always appear in the tracker when they have a duration.)
				try {
					const spellDamageConfig = item?.flags?.[MODULE_ID]?.spellDamage || {};
					await startDurationSpell(casterActor, item, tokenIds, {
						perTurnTrigger:  spellDamageConfig.perTurnTrigger  || "start",
						perTurnDamage:   spellDamageConfig.perTurnDamage   || "",
						reapplyEffects:  spellDamageConfig.reapplyEffects  || false,
						damageType:      spellDamageConfig.damageType      || "",
						effects:         spellDamageConfig.effects         || [],
						templateId:      null,
						summonedTokenIds: tokenIds,
					});
				}
				catch (err) {
					console.warn(`${MODULE_ID} | Failed to start duration tracking for summoning spell:`, err);
				}

				// Auto-delete tokens when the expiry round is reached in combat.
				// summoningConfig.deleteAtExpiry defaults to true for summoning spells.
				const shouldDelete = summoningConfig.deleteAtExpiry ?? true;
				if (shouldDelete && game.combat) {
					const expiryRound = (game.combat.round || 1) + durationValue;
					await trackSummonedTokensForExpiry(canvas.scene.id, tokenIds, expiryRound, item?.name || "Summoning");
				}
			}

			ui.notifications.info(`Summoned ${creatures.length} creature(s)`);
		}
		else {
			ui.notifications.warn("No creatures were spawned - check that creature UUIDs are valid");
		}
	}
	catch (err) {
		console.error("shadowdark-extras | Error summoning creatures:", err);
		ui.notifications.error("Failed to summon creatures: " + err.message);
	}
}

async function giveItemsToCaster(casterActor, item, profiles) {
	if (!casterActor) {
		console.warn("shadowdark-extras | No caster actor available to receive items");
		return;
	}
	if (!profiles || profiles.length === 0) {
		console.warn("shadowdark-extras | No item profiles provided");
		return;
	}
	const itemsToCreate = [];
	for (const profile of profiles) {
		if (!profile || !profile.itemUuid) continue;
		let quantity = 1;
		const qtyValue = (profile.quantity || "1").toString().trim();
		if (qtyValue.includes("d")) {
			try {
				const roll = new Roll(qtyValue);
				await roll.evaluate();
				quantity = Math.max(1, roll.total || 1);
				await roll.toMessage({
					flavor: `Item giver: ${profile.itemName || item.name || "Item"} `,
					speaker: ChatMessage.getSpeaker({ actor: casterActor }),
				});
			}
			catch (err) {
				console.warn("shadowdark-extras | Invalid item quantity formula, defaulting to 1:", qtyValue, err);
				quantity = 1;
			}
		}
		else if (qtyValue !== "") {
			const parsed = parseInt(qtyValue);
			if (!Number.isNaN(parsed)) {
				quantity = Math.max(1, parsed);
			}
		}
		try {
			const sourceItem = await fromUuid(profile.itemUuid);
			if (!sourceItem || !(sourceItem instanceof Item)) {
				console.warn(`shadowdark - extras | Skipping item give for invalid source: ${profile.itemName} `);
				continue;
			}
			const itemData = foundry.utils.duplicate(sourceItem.toObject());
			delete itemData._id;
			if (!itemData.system) itemData.system = {};
			itemData.system.quantity = quantity;
			itemsToCreate.push(itemData);
		}
		catch (err) {
			console.error("shadowdark-extras | Failed to load item for item giver:", err);
		}
	}
	if (itemsToCreate.length === 0) {
		console.warn("shadowdark-extras | No valid items were available to create");
		return;
	}
	try {
		const createdItems = await casterActor.createEmbeddedDocuments("Item", itemsToCreate);
		const itemSummaries = createdItems.map(createdItem => `${createdItem.name} x${createdItem.system?.quantity || 1} `);
		ui.notifications.info(`Granted ${itemSummaries.join(", ")} to ${casterActor.name} `);
	}
	catch (err) {
		console.error("shadowdark-extras | Failed to add items to caster:", err);
		ui.notifications.error("Failed to grant items to caster: " + err.message);
	}
}

/**
 * Apply coating poison to a weapon from a potion
 * Shows a dialog to select a weapon, then adds poison damage bonus to it
 * @param {Actor} casterActor - The actor who used the potion
 * @param {Actor} targetActor - The actor whose weapon will be coated (may be same as caster)
 * @param {object} config - The coating poison configuration
 * @param {string} potionName - Name of the potion for display purposes
 */
async function applyCoatingPoison(casterActor, targetActor, config, potionName) {
	if (!targetActor) {
		ui.notifications.warn("No target found for coating poison!");
		return;
	}

	// Get all weapons from target actor
	const weapons = targetActor.items.filter(item => item.type === "Weapon");
	if (weapons.length === 0) {
		ui.notifications.warn(`${targetActor.name} has no weapons to coat!`);
		return;
	}

	// Filter out weapons that already have active poison damage bonuses (usage > 0 or no usage = permanent)
	// Allow weapons with depleted poison (usage === 0) to be coated again
	const availableWeapons = weapons.filter(weapon => {
		const currentBonus = weapon.getFlag(MODULE_ID, "weaponBonus");
		const hasActivePoisonBonus = currentBonus?.damageBonuses?.some(b =>
			b.damageType?.toLowerCase() === "poison" && b.usage !== 0
		);
		return !hasActivePoisonBonus;
	});

	if (availableWeapons.length === 0) {
		ui.notifications.warn(`${targetActor.name} has no weapons available for poison coating (all already have poison damage)!`);
		return;
	}

	// Build the damage formula based on config
	let damageFormula = "";
	const casterLevel = casterActor?.system?.level?.value || 1;

	if (config.formulaType === "basic") {
		const numDice = config.numDice || 1;
		const dieType = config.dieType || "d6";
		const bonus = config.bonus || 0;
		damageFormula = `${numDice}${dieType}`;
		if (bonus !== 0) {
			damageFormula += bonus > 0 ? `+${bonus}` : `${bonus}`;
		}
	}
	else if (config.formulaType === "formula") {
		damageFormula = config.formula || "1d6";
		// Replace level placeholder with actual level
		damageFormula = damageFormula.replace(/@level/gi, casterLevel);
	}
	else if (config.formulaType === "tiered") {
		// Parse tiered formula like "1-3:1d4, 4-6:1d6, 7+:1d8"
		const tieredFormula = config.tieredFormula || "1+:1d6";
		damageFormula = parseTieredFormula(tieredFormula, casterLevel) || "1d6";
	}

	// Get usage from config (null/undefined = permanent)
	const poisonUsage = config.usage !== undefined && config.usage !== null && config.usage !== ""
		? parseInt(config.usage, 10)
		: null;
	const usageText = poisonUsage !== null ? `${poisonUsage} uses` : "permanently";

	// Build weapon selection dropdown
	const weaponChoices = availableWeapons.map(w =>
		`<option value="${w.id}">${w.name}</option>`
	).join("");

	new foundry.applications.api.DialogV2({
		window: { title: `${potionName} - Coat Weapon` },
		content: `
			<form>
				<div class="form-group">
					<label>Choose a weapon to coat with poison:</label>
					<select name="weaponId" style="width: 100%; margin-top: 5px;">${weaponChoices}</select>
				</div>
				<p style="margin-top: 10px; font-style: italic; font-size: 0.9em;">
					The weapon will deal +${damageFormula} poison damage (${usageText}).
				</p>
			</form>
		`,
		buttons: [
			{
				action: "coat",
				icon: "fas fa-skull-crossbones",
				label: "Coat Weapon",
				default: true,
				callback: async (event, button) => {
					const weaponId = button.form.elements.weaponId.value;
					const weapon = targetActor.items.get(weaponId);
					if (!weapon) {
						ui.notifications.error("Weapon not found!");
						return;
					}

					// Get existing weapon bonus or create new structure
					const existingBonus = weapon.getFlag(MODULE_ID, "weaponBonus") || {};

					// Create the poison coating bonus
					const poisonCoatingBonus = {
						enabled: true,
						hitBonuses: existingBonus.hitBonuses || [],
						damageBonuses: [
							...(existingBonus.damageBonuses || []),
							{
								formula: damageFormula,
								label: potionName,
								damageType: "poison",
								exclusive: false,
								prompt: false,
								requirements: [],
								usage: poisonUsage,
							},
						],
						damageBonus: existingBonus.damageBonus || "",
						criticalExtraDice: existingBonus.criticalExtraDice || "",
						criticalExtraDamage: existingBonus.criticalExtraDamage || "",
						requirements: existingBonus.requirements || [],
						effects: existingBonus.effects || [],
						itemMacro: existingBonus.itemMacro || { enabled: false, runAsGm: false, triggers: [] },
					};

					// Update the weapon with the poison coating
					await weapon.setFlag(MODULE_ID, "weaponBonus", poisonCoatingBonus);

					ui.notifications.info(`${weapon.name} is now coated with poison (+${damageFormula}, ${usageText})!`);
					ChatMessage.create({
						speaker: ChatMessage.getSpeaker({ actor: casterActor }),
						content: `<div class="shadowdark chat-card">
							<h3><i class="fas fa-skull-crossbones"></i> Poison Coating</h3>
							<p><strong>${casterActor?.name || "Someone"}</strong> coats <strong>${targetActor.name}'s ${weapon.name}</strong> with poison!</p>
							<p><em>The weapon now deals +${damageFormula} poison damage (${usageText}).</em></p>
						</div>`,
					});
				},
			},
			{ action: "cancel", icon: "fas fa-times", label: "Cancel" },
		],
	}).render({ force: true });
}

/**
 * Attach event listeners to damage card elements
 */
function attachDamageCardListeners(html, messageId) {
	const $card = html.find(".sdx-damage-card");

	// Header collapse/expand
	$card.find(".sdx-damage-card-header").on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $header = $(this);
		const $chevron = $header.find(".fa-chevron-down, .fa-chevron-up");
		const $content = $card.find(".sdx-damage-card-content");
		const $tabs = $card.find(".sdx-damage-card-tabs");
		const $rollBreakdown = $card.find(".sdx-roll-breakdown");

		// Toggle content visibility
		$content.slideToggle(200);
		$tabs.slideToggle(200);
		$rollBreakdown.slideToggle(200);

		// Toggle chevron direction
		if ($chevron.hasClass("fa-chevron-down")) {
			$chevron.removeClass("fa-chevron-down").addClass("fa-chevron-up");
		}
		else {
			$chevron.removeClass("fa-chevron-up").addClass("fa-chevron-down");
		}
	});

	$card.on("click", ".sdx-target-defense-roll", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);
		if ($btn.data("rolling")) return;

		$btn.data("rolling", true);
		$btn.prop("disabled", true);
		const originalHtml = $btn.html();
		$btn.html('<i class="fas fa-spinner fa-spin"></i> Rolling');

		try {
			await rollTargetDefenseCheck({
				messageId,
				tokenId: String($btn.data("token-id")),
				ability: String($btn.data("ability") || "dex"),
				dcFormula: String($btn.data("dc") || "12"),
				casterActorId: String($card.data("caster-actor-id") || ""),
			});
		}
		catch (err) {
			console.error("shadowdark-extras | Failed to roll target defense:", err);
			ui.notifications.error("Failed to roll target defense");
			$btn.prop("disabled", false);
			$btn.html(originalHtml);
			$btn.data("rolling", false);
		}
	});

	// Tab switching
	$card.find(".sdx-tab").on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $tab = $(this);
		if ($tab.hasClass("active")) return;

		// Update active tab
		$tab.siblings().removeClass("active");
		$tab.addClass("active");

		// Get base damage from card's data attribute
		const baseDamage = parseInt($card.data("base-damage")) || 0;

		// Rebuild targets list
		rebuildTargetsList($card, messageId, baseDamage);
	});

	// Initial multiplier listeners
	attachMultiplierListeners($card);

	// Initial target enable/disable listeners
	attachTargetEnableListeners($card);

	// Individual die click to reroll single die
	$card.on("click", ".sdx-die-clickable", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $die = $(this);
		const dieIndex = parseInt($die.data("die-index"));
		const faces = parseInt($die.data("faces"));

		if (isNaN(dieIndex) || isNaN(faces)) {
			console.warn("shadowdark-extras | Invalid die data for reroll");
			return;
		}


		// Roll a single die
		const roll = new Roll(`1d${faces} `);
		await roll.evaluate();
		const newValue = roll.total;

		// Determine CSS class for the new value
		const isCrit = newValue === faces;
		const isFumble = newValue === 1;
		const newCssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");

		// Update the die's display
		$die.text(newValue);
		$die.removeClass("sdx-die-max sdx-die-min").addClass(newCssClass);

		// Recalculate total by summing all dice and bonuses in the breakdown
		let newTotal = 0;
		const $breakdownLine = $card.find(".sdx-roll-breakdown-line");

		// Sum all dice values
		$breakdownLine.find(".sdx-die").each(function() {
			newTotal += parseInt($(this).text()) || 0;
		});

		// Sum all bonus values (considering the sign from adjacent plus/minus)
		$breakdownLine.find(".sdx-bonus-val").each(function() {
			const $bonus = $(this);
			const bonusValue = parseInt($bonus.text()) || 0;
			// Check if the previous sibling is a minus sign
			const $prev = $bonus.prev(".sdx-plus");
			if ($prev.length && $prev.text().includes("-")) {
				newTotal -= bonusValue;
			}
			else {
				newTotal += bonusValue;
			}
		});

		// Update the total display
		$breakdownLine.find(".sdx-roll-total").text(newTotal);

		// Update card data
		$card.attr("data-base-damage", newTotal);
		$card.data("base-damage", newTotal);

		// Update all target damage displays
		const damageType = $card.data("damage-type");
		const isHealing = damageType?.toLowerCase() === "healing";

		$card.find(".sdx-target-item").each(function() {
			const $targetItem = $(this);
			const $targetDamage = $targetItem.find(".sdx-damage-value");
			const $activeMultiplier = $targetItem.find(".sdx-multiplier-btn.active");
			const multiplier = parseFloat($activeMultiplier.data("multiplier")) || 1;
			const newDamage = Math.floor(newTotal * multiplier);

			$targetDamage.text(newDamage);
			$targetDamage.attr("data-base-damage", newDamage);
		});

		// Show notification
		ui.notifications.info(`Rerolled d${faces}: ${newValue} (new total: ${newTotal})`);
	});

	// Reroll damage button click
	$card.on("click", ".sdx-reroll-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);
		const formula = $btn.data("formula");
		const weaponBonusDataStr = $btn.attr("data-weapon-bonus");

		if (!formula) {
			ui.notifications.warn("No damage formula to reroll");
			return;
		}

		// Disable button temporarily
		$btn.prop("disabled", true);
		$btn.find("i").removeClass("fa-dice").addClass("fa-spinner fa-spin");

		try {
			// Roll the base formula
			const roll = new Roll(formula);
			await roll.evaluate();

			// Parse weapon bonus data if present
			let weaponBonus = null;
			if (weaponBonusDataStr) {
				try {
					weaponBonus = JSON.parse(weaponBonusDataStr);
				}
				catch (e) {
					console.warn("shadowdark-extras | Could not parse weapon bonus data:", e);
				}
			}

			// Roll weapon bonus formulas if they exist
			let newBonusTotal = 0;
			let newCriticalTotal = 0;
			const bonusDiceResults = [];

			if (weaponBonus?.bonusFormula) {
				const bonusRoll = new Roll(weaponBonus.bonusFormula);
				await bonusRoll.evaluate();
				newBonusTotal = bonusRoll.total;

				// Extract dice results from bonus roll
				for (const term of bonusRoll.terms) {
					if (term.faces !== undefined && term.results) {
						for (const r of term.results) {
							const val = r.result;
							const isCrit = val === term.faces;
							const isFumble = val === 1;
							const cssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");
							bonusDiceResults.push({ value: val, cssClass, faces: term.faces, isBonus: true });
						}
					}
				}
			}

			if (weaponBonus?.criticalFormula) {
				const critRoll = new Roll(weaponBonus.criticalFormula);
				await critRoll.evaluate();
				newCriticalTotal = critRoll.total;

				// Extract dice results from critical roll
				for (const term of critRoll.terms) {
					if (term.faces !== undefined && term.results) {
						for (const r of term.results) {
							const val = r.result;
							const isCrit = val === term.faces;
							const isFumble = val === 1;
							const cssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");
							bonusDiceResults.push({ value: val, cssClass, faces: term.faces, isCritBonus: true });
						}
					}
				}
			}

			// Build new breakdown HTML
			const dice = roll.terms.filter(t => t.faces !== undefined);
			const diceResults = [];

			for (const die of dice) {
				const faces = die.faces;
				const results = die.results || [];
				for (const r of results) {
					const val = r.result;
					const isCrit = val === faces;
					const isFumble = val === 1;
					const cssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");
					diceResults.push({ value: val, cssClass, faces });
				}
			}

			// Get static bonuses from roll terms (like STR modifier)
			const bonuses = [];
			let operator = "+";
			for (const term of roll.terms) {
				if (term.operator) {
					operator = term.operator;
					continue;
				}
				if (term.number !== undefined && !term.faces) {
					const value = term.number;
					if (value !== 0) {
						bonuses.push({
							label: "Modifier",
							value: operator === "-" ? -value : value,
						});
					}
				}
			}

			// Calculate total including weapon bonuses
			let totalDamage = roll.total + newBonusTotal + newCriticalTotal;


			// Build breakdown parts
			const breakdownParts = [];

			// Add base dice results with data attributes for individual rerolling
			let dieIndex = 0;
			for (const die of diceResults) {
				breakdownParts.push({
					html: `<span class="sdx-die sdx-die-clickable ${die.cssClass}" data-die-index="${dieIndex}" data-faces="${die.faces}" title="Click to reroll this d${die.faces}">${die.value}</span>`,
					value: die.value,
					faces: die.faces,
				});
				dieIndex++;
			}

			// Add static bonuses (like STR modifier)
			for (const bonus of bonuses) {
				const absValue = Math.abs(bonus.value);
				breakdownParts.push({
					html: `<span class="sdx-bonus-val" title="${bonus.label || ""}">${absValue}</span>`,
					value: bonus.value,
				});
			}

			// Add weapon bonus dice results (styled differently, also clickable)
			for (const die of bonusDiceResults) {
				const extraClass = die.isCritBonus ? "sdx-crit-bonus" : "sdx-weapon-bonus";
				breakdownParts.push({
					html: `<span class="sdx-die sdx-die-clickable ${die.cssClass} ${extraClass}" data-die-index="${dieIndex}" data-faces="${die.faces}" title="Click to reroll this d${die.faces}">${die.value}</span>`,
					value: die.value,
					faces: die.faces,
				});
				dieIndex++;
			}

			// Build HTML string
			const partsHtml = breakdownParts.map((part, index) => {
				if (index === 0) return part.html;
				if (part.value < 0) return `<span class="sdx-plus"> - </span> ${part.html} `;
				return `<span class="sdx-plus"> + </span> ${part.html} `;
			}).join("");

			const newBreakdownHtml = `
						<div class="sdx-roll-breakdown-line">
					<span class="sdx-roll-total">${totalDamage}</span>
					<span class="sdx-equals"> = </span>
					${partsHtml}
				</div>
						`;

			// Update the card
			$card.find(".sdx-roll-breakdown-line").replaceWith(newBreakdownHtml);
			$card.attr("data-base-damage", totalDamage);
			$card.data("base-damage", totalDamage);

			// Update all target damage displays
			const damageType = $card.data("damage-type");
			const isHealing = damageType?.toLowerCase() === "healing";
			const sign = isHealing ? "+" : "-";

			const $targetItems = $card.find(".sdx-target-item");

			$targetItems.each(function() {
				const $targetItem = $(this);
				const $targetDamage = $targetItem.find(".sdx-damage-value");
				const $activeMultiplier = $targetItem.find(".sdx-multiplier-btn.active");
				const multiplier = parseFloat($activeMultiplier.data("multiplier")) || 1;
				const newDamage = Math.floor(totalDamage * multiplier);


				$targetDamage.text(newDamage);
				$targetDamage.attr("data-base-damage", newDamage);
			});

			// Show notification
			ui.notifications.info(`Rerolled damage: ${totalDamage} `);

		}
		catch (err) {
			console.error("shadowdark-extras | Error rerolling damage:", err);
			ui.notifications.error("Failed to reroll damage");
		}
		finally {
			// Re-enable button
			$btn.prop("disabled", false);
			$btn.find("i").removeClass("fa-spinner fa-spin").addClass("fa-dice");
		}
	});

	// Apply damage button click (use delegation since button may be rebuilt)
	// Apply damage button click (use delegation since button may be rebuilt)
	$card.on("click", ".sdx-apply-damage-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);

		// Check for GM-only restriction
		const settings = game.settings.get(MODULE_ID, "combatSettings");
		if (settings.damageCard?.gmOnlyApplyDamage && !game.user.isGM) {
			ui.notifications.warn("The GM has disabled Apply Damage. Ask him/her why! Worried you might cheat? Probably!");
			return;
		}

		// Prevent duplicate applications
		if ($btn.data("applying")) {
			return;
		}

		// v14/SD4.x: Hard-block double-apply via persisted flag.
		// jQuery handlers fire on disabled buttons through delegation, and re-renders
		// reset the in-memory `applying` state — so the message flag is the source of
		// truth. Once damage was applied (auto OR manual), refuse a second apply.
		const messageDoc = game.messages.get(messageId);
		if (messageDoc?.getFlag?.(MODULE_ID, "damageApplied") || $btn.attr("data-already-applied") === "true") {
			ui.notifications.info("Damage already applied to this card.");
			$btn.prop("disabled", true);
			$btn.html('<i class="fas fa-check"></i> APPLIED');
			return;
		}

		$btn.data("applying", true);
		$btn.prop("disabled", true);


		try {
			const $targets = $card.find(".sdx-target-item");
			const unresolvedDefenses = getUnresolvedDefenseTargets($card);
			if (unresolvedDefenses.length > 0) {
				ui.notifications.warn("Resolve target defense checks before applying damage.");
				$btn.prop("disabled", false);
				$btn.data("applying", false);
				const damageType = $card.data("damage-type") || "damage";
				const buttonText = damageType === "healing" ? "APPLY HEALING" : "APPLY DAMAGE";
				const buttonIcon = damageType === "healing" ? "fa-heart-pulse" : "fa-hand-sparkles";
				$btn.html(`<i class="fas ${buttonIcon}"></i> ${buttonText}`);
				return;
			}

			const damageType = $card.data("damage-type") || "damage";
			const isHealing = damageType?.trim().toLowerCase() === "healing";

			console.log(`shadowdark-extras | Apply Button Clicked | Type: ${damageType} | isHealing: ${isHealing}`);

			let appliedCount = 0;

			for (const targetEl of $targets) {
				const $target = $(targetEl);

				// Skip disabled targets
				const isEnabled = $target.data("enabled") !== false && $target.attr("data-enabled") !== "false";
				if (!isEnabled) {
					continue;
				}

				const tokenId = $target.data("token-id");
				const token = canvas.tokens.get(tokenId);

				let calculatedDamage = $target.data("calculated-damage");

				if (calculatedDamage === undefined || calculatedDamage === null) {
					const $damageValue = $target.find(".sdx-damage-value");
					calculatedDamage = parseInt($damageValue.text()) || 0;

					// If it's healing, make damage negative
					if (isHealing) {
						calculatedDamage = -calculatedDamage;
					}
				}

				const $defense = $target.find(".sdx-target-defense");
				if ($defense.length && $defense.attr("data-defense-success") === "true") {
					const defenseAction = $defense.data("defense-action") || "avoid";
					if (defenseAction === "half") {
						calculatedDamage = Math.floor(calculatedDamage / 2);
					}
					else {
						calculatedDamage = 0;
					}
				}

				// Check if we need to evaluate a per-target damage requirement
				if (window._damageRequirement && token && token.actor) {
					const reqInfo = window._damageRequirement;
					try {
						// Build roll data with target context
						const targetRollData = foundry.utils.duplicate(reqInfo.casterData);
						const targetActorData = token.actor.getRollData() || {};

						// Create target object in rollData
						targetRollData.target = buildTargetRollData(token.actor);

						// Evaluate the requirement
						const requirementMet = evaluateRequirement(reqInfo.formula, targetRollData);

						if (!requirementMet) {
							if (reqInfo.failAction === "half") {
								calculatedDamage = Math.floor(calculatedDamage / 2);
							}
							else {
								calculatedDamage = 0;
							}
						}
						else {
						}
					}
					catch (err) {
						console.warn(`shadowdark - extras | Failed to evaluate requirement for target ${tokenId}: `, err);
					}
				}


				// Socket handler expects negative values for healing
				// Make damage negative if this is healing
				const finalDamageForSocket = isHealing ? -Math.abs(calculatedDamage) : calculatedDamage;

				if (calculatedDamage === 0) {
					continue;
				}

				// Use socketlib to apply damage via GM
				if (getSocket()) {
					try {
						const damageType = $card.data("damage-type") || "damage";
						const baseDamage = parseInt($card.data("base-damage")) || 0;

						// Get damage components from weapon bonus data if available
						let damageComponents = [];
						const $rerollBtn = $card.find(".sdx-reroll-btn");
						if ($rerollBtn.length) {
							const weaponBonusAttr = $rerollBtn.attr("data-weapon-bonus");
							if (weaponBonusAttr) {
								try {
									const weaponBonusData = JSON.parse(weaponBonusAttr.replace(/&quot;/g, '"'));
									damageComponents = weaponBonusData.damageComponents || [];
								}
								catch (e) {
									console.warn("shadowdark-extras | Failed to parse weapon bonus data:", e);
								}
							}
						}

						// Calculate base damage (total minus bonus components)
						const totalBonusDamage = damageComponents.reduce((sum, c) => sum + (c.amount || 0), 0);
						const weaponBaseDamage = Math.max(0, calculatedDamage - totalBonusDamage);

						// Get base damage type from card data (set by weapon flags)
						const baseDamageType = $card.data("base-damage-type") || damageType || "standard";

						// Check if this is a magical weapon attack
						const isMagicalWeapon = $card.data("is-magical-weapon") === true || $card.data("is-magical-weapon") === "true";

						console.log("shadowdark-extras | Executing Socket | Payload:", { tokenId, damage: finalDamageForSocket, isHealing, damageType });

						const success = await getSocket().executeAsGM("applyTokenDamage", {
							tokenId: tokenId,
							damage: finalDamageForSocket,
							isHealing: isHealing,
							damageType: damageType,
							damageComponents: damageComponents,
							baseDamage: weaponBaseDamage,
							baseDamageType: baseDamageType,
							isMagicalWeapon: isMagicalWeapon,
						});


						if (success) {
							appliedCount++;
						}
						else {
							console.warn("shadowdark-extras | Failed to apply damage to token:", tokenId);
						}
					}
					catch (socketError) {
						console.error("shadowdark-extras | Socket error applying damage:", socketError);
					}
				}
				else {
					console.error("shadowdark-extras | socketlib not initialized");
					ui.notifications.error("Socket communication not available");
				}
			}

			if (appliedCount > 0) {
				const appliedText = isHealing ? "Healing" : "Damage";
				ui.notifications.info(`${appliedText} applied to ${appliedCount} target(s)`);
				$btn.html('<i class="fas fa-check"></i> APPLIED');
				$btn.attr("data-already-applied", "true");
				// v14/SD4.x: Persist applied state so re-renders show "APPLIED" and the
				// click handler refuses a second apply attempt.
				try {
					const persistMsg = game.messages.get(messageId);
					if (persistMsg && !persistMsg.getFlag(MODULE_ID, "damageApplied")) {
						await persistMsg.setFlag(MODULE_ID, "damageApplied", true);
					}
				}
				catch (flagErr) {
					console.warn("shadowdark-extras | Failed to persist damageApplied flag:", flagErr);
				}

				// Decrement weapon bonus usage for bonuses that have limited uses
				try {
					const messageId = $card.data("message-id");
					if (messageId) {
						const message = game.messages.get(messageId);
						const weaponBonusResults = message?.getFlag(MODULE_ID, "weaponBonusResults");
						if (weaponBonusResults?.appliedBonusIndicesWithUsage?.length > 0 &&
							weaponBonusResults.weaponItemId && weaponBonusResults.actorId) {
							const ownerActor = game.actors.get(weaponBonusResults.actorId);
							const weaponItem = ownerActor?.items.get(weaponBonusResults.weaponItemId);
							if (weaponItem) {
								await decrementDamageBonusUsage(weaponItem, weaponBonusResults.appliedBonusIndicesWithUsage);
							}
						}
					}
				}
				catch (decrementError) {
					console.warn("shadowdark-extras | Failed to decrement weapon bonus usage:", decrementError);
				}
			}
			else {
				ui.notifications.warn("No damage to apply");
				$btn.html('<i class="fas fa-exclamation"></i> NO TARGETS');
			}

			setTimeout(() => {
				// On successful apply, leave the button locked at "APPLIED" — re-enabling would
				// invite a double-apply. Only restore the original label when nothing applied
				// (user can fix targets and retry).
				if (appliedCount > 0) {
					$btn.data("applying", false);
					return;
				}
				const damageType = $card.data("damage-type") || "damage";
				const buttonText = damageType === "healing" ? "APPLY HEALING" : "APPLY DAMAGE";
				const buttonIcon = damageType === "healing" ? "fa-heart-pulse" : "fa-hand-sparkles";
				$btn.html(`<i class="fas ${buttonIcon}"></i> ${buttonText}`);
				$btn.prop("disabled", false);
				$btn.data("applying", false);
			}, 2000);

		}
		catch (error) {
			console.error("shadowdark-extras | Error applying damage:", error);
			ui.notifications.error("Failed to apply damage: " + error.message);
			$btn.prop("disabled", false);
			$btn.data("applying", false);
		}
	});

	// Apply condition button click
	$card.on("click", ".sdx-apply-condition-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);

		// Prevent duplicate applications
		if ($btn.data("applying")) {
			return;
		}

		// v14/SD4.x: Hard-block double-apply.
		// jQuery click handlers still fire on disabled <button>s via delegation, and chat
		// message re-renders rebuild the DOM with a fresh `applying` data state — so the
		// in-memory guard above is not enough. The persisted message flag is the source of
		// truth: once conditions were applied (auto OR manual), refuse further applies.
		const messageDoc = game.messages.get(messageId);
		if (messageDoc?.getFlag?.(MODULE_ID, "conditionsApplied") || $btn.attr("data-already-applied") === "true") {
			ui.notifications.info("Conditions already applied to this card.");
			$btn.prop("disabled", true);
			$btn.html('<i class="fas fa-check"></i> APPLIED');
			return;
		}

		$btn.data("applying", true);
		$btn.prop("disabled", true);


		try {
			const unresolvedDefenses = getUnresolvedDefenseTargets($card);
			if (unresolvedDefenses.length > 0) {
				ui.notifications.warn("Resolve target defense checks before applying conditions.");
				$btn.prop("disabled", false);
				$btn.data("applying", false);
				$btn.html('<i class="fas fa-wand-sparkles"></i> APPLY CONDITION');
				return;
			}

			const effectsJson = $btn.data("effects");
			const applyToTarget = $btn.data("apply-to-target");
			const effectsRequirement = $btn.data("effects-requirement") || "";

			// Get spell info for focus spell tracking
			const spellInfoAttr = $btn.attr("data-spell-info");
			let spellInfo = null;
			if (spellInfoAttr) {
				try {
					spellInfo = JSON.parse(spellInfoAttr);
				}
				catch (err) {
					console.warn("shadowdark-extras | Could not parse spell info:", err);
				}
			}

			let effects = [];
			if (typeof effectsJson === "string") {
				effects = JSON.parse(effectsJson);
			}
			else if (Array.isArray(effectsJson)) {
				effects = effectsJson;
			}

			console.log("%c[SDX APPLY CONDITION] Effects to apply:", "color: cyan; font-weight: bold", effects);


			if (effects.length === 0) {
				ui.notifications.warn("No conditions to apply");
				$btn.prop("disabled", false);
				$btn.data("applying", false);
				return;
			}

			// Handle 'prompt' selection mode - show dialog to select effects
			const effectSelectionMode = $btn.data("effect-selection-mode") || "all";
			if (effectSelectionMode === "prompt" && effects.length > 1) {

				// Build effect names for the dialog by resolving UUIDs
				const effectOptions = [];
				for (const effectData of effects) {
					const effectUuid = typeof effectData === "string" ? effectData : effectData.uuid;
					try {
						const effectDoc = await fromUuid(effectUuid);
						effectOptions.push({
							uuid: effectUuid,
							name: effectDoc?.name || "Unknown Effect",
							img: effectDoc?.img || "icons/svg/mystery-man.svg",
							data: effectData,
						});
					}
					catch (err) {
						effectOptions.push({
							uuid: effectUuid,
							name: "Unknown Effect",
							img: "icons/svg/mystery-man.svg",
							data: effectData,
						});
					}
				}

				// Show selection dialog
				const selectedEffects = await showEffectSelectionDialog(effectOptions);

				if (!selectedEffects || selectedEffects.length === 0) {
					$btn.prop("disabled", false);
					$btn.data("applying", false);
					return;
				}

				// Replace effects with user selection
				effects = selectedEffects;
			}

			// Get caster data for requirement evaluation
			const casterActorId = $card.data("caster-actor-id");
			const casterActor = casterActorId ? game.actors.get(casterActorId) : null;
			let casterRollData = {};
			if (casterActor) {
				casterRollData = casterActor.getRollData() || {};
				// Flatten level
				if (casterRollData.level && typeof casterRollData.level === "object" && casterRollData.level.value !== undefined) {
					casterRollData.level = casterRollData.level.value;
				}
				// Add ability modifiers
				if (casterRollData.abilities) {
					["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
						if (casterRollData.abilities[ability]?.mod !== undefined) {
							casterRollData[ability] = casterRollData.abilities[ability].mod;
						}
						if (casterRollData.abilities[ability]?.value !== undefined) {
							casterRollData[ability + "Base"] = casterRollData.abilities[ability].value;
						}
					});
				}
				// Add stats
				if (casterRollData.attributes?.ac?.value !== undefined) casterRollData.ac = casterRollData.attributes.ac.value;
				if (casterRollData.attributes?.hp?.value !== undefined) casterRollData.hp = casterRollData.attributes.hp.value;
			}

			// Get card targets (enemies shown in the card)
			const $cardTargets = $card.find(".sdx-target-item");
			const cardTargets = $cardTargets.map((i, el) => canvas.tokens.get($(el).data("token-id"))).get().filter(t => t);
			console.log("%c[SDX APPLY CONDITION] Card targets found:", "color: lime; font-weight: bold", cardTargets.map(t => ({ id: t.id, name: t.name })));

			// Get caster token using the stored token ID (the actual token that attacked/cast)
			const casterTokenId = $card.data("caster-token-id");
			let casterToken = null;
			if (casterTokenId) {
				casterToken = canvas.tokens.get(casterTokenId);
			}
			// Fallback to finding by actor ID if token ID not available
			if (!casterToken && casterActor) {
				casterToken = canvas.tokens.placeables.find(t => t.actor?.id === casterActorId);
			}

			let appliedCount = 0;
			let skippedCount = 0;

			// Apply each effect to appropriate tokens based on individual effect settings
			for (const effectData of effects) {
				// Handle both old format (string UUID) and new format (object with uuid, duration, applyToTarget)
				const effectUuid = typeof effectData === "string" ? effectData : effectData.uuid;
				const duration = typeof effectData === "object" && effectData.duration ? effectData.duration : {};
				// Check individual effect's applyToTarget setting, fall back to global setting
				const effectApplyToTarget = typeof effectData === "object" && effectData.applyToTarget !== undefined
					? effectData.applyToTarget
					: applyToTarget;
				// Check individual effect's cumulative setting (default true for backward compatibility)
				const effectCumulative = typeof effectData === "object" && effectData.cumulative !== undefined
					? effectData.cumulative
					: true;

				// Determine which tokens to apply this effect to
				// Tab override: If there are targets shown in the current tab, use those
				// regardless of the effectApplyToTarget setting. This allows users to
				// manually apply self-effects to other tokens via Selected/Targeted tabs.
				let effectTargets = [];
				if (cardTargets.length > 0) {
					// Use targets from the current tab (override)
					effectTargets = cardTargets;
				}
				else if (effectApplyToTarget) {
					// No targets in tab, but configured to apply to target - keep empty (will show warning)
					effectTargets = [];
				}
				else {
					// No targets in tab and configured for self - apply to caster
					if (casterToken) effectTargets = [casterToken];
				}

				if (effectTargets.length === 0) {
					continue;
				}

				// Apply to each target for this effect
				for (const target of effectTargets) {
					const $targetRow = $card.find(`.sdx-target-item[data-token-id="${target.id}"]`);
					const $defense = $targetRow.find(".sdx-target-defense");
					if ($defense.length && $defense.attr("data-defense-success") === "true" && ($defense.data("defense-action") || "avoid") === "avoid") {
						skippedCount++;
						continue;
					}

					// Check effects requirement if it exists (only for target-directed effects)
					let requirementMet = true;
					if (effectApplyToTarget && effectsRequirement && effectsRequirement.trim() !== "") {
						try {
							const targetRollData = foundry.utils.duplicate(casterRollData);

							// Add target data if available
							if (target.actor) {
								targetRollData.target = buildTargetRollData(target.actor);
							}

							// Evaluate the requirement
							requirementMet = evaluateRequirement(effectsRequirement, targetRollData);
							if (!requirementMet) {
								skippedCount++;
								continue; // Skip this target
							}
							else {
							}
						}
						catch (err) {
							console.warn(`shadowdark - extras | Failed to evaluate effects requirement for target ${target.id}: `, err);
							// On error, assume requirement is met (fail-open)
						}
					}


					// Use socketlib to apply condition via GM
					console.log("%c[SDX APPLY CONDITION] Applying to target:", "color: orange; font-weight: bold", { targetId: target.id, targetName: target.name, effectUuid });
					if (getSocket()) {
						try {
							const success = await getSocket().executeAsGM("applyTokenCondition", {
								tokenId: target.id,
								effectUuid: effectUuid,
								duration: duration,
								spellInfo: spellInfo,  // Pass spell info for focus tracking
								cumulative: effectCumulative,  // Pass cumulative flag
							});

							if (success === true) {
								appliedCount++;
							}
							else {
								console.warn("shadowdark-extras | Failed to apply condition to token:", target.id);
							}
						}
						catch (socketError) {
							console.error("shadowdark-extras | Socket error applying condition:", socketError);
						}
					}
					else {
						console.error("shadowdark-extras | socketlib not initialized");
						ui.notifications.error("Socket communication not available");
					}
				}
			}


			if (appliedCount > 0) {
				let message = `Applied ${appliedCount} condition(s)`;
				if (skippedCount > 0) {
					message += ` (${skippedCount} skipped - requirement not met)`;
				}
				ui.notifications.info(message);
				$btn.html('<i class="fas fa-check"></i> APPLIED');
				$btn.attr("data-already-applied", "true");
				// v14/SD4.x: Persist applied state so re-renders show "APPLIED" and the
				// click handler refuses a second apply attempt.
				try {
					const messageDoc = game.messages.get(messageId);
					if (messageDoc && !messageDoc.getFlag(MODULE_ID, "conditionsApplied")) {
						await messageDoc.setFlag(MODULE_ID, "conditionsApplied", true);
					}
				}
				catch (flagErr) {
					console.warn("shadowdark-extras | Failed to persist conditionsApplied flag:", flagErr);
				}
			}
			else if (skippedCount > 0) {
				ui.notifications.warn("No conditions applied - requirement not met for any target");
				$btn.html('<i class="fas fa-exclamation"></i> REQ FAILED');
			}
			else {
				ui.notifications.warn("No conditions were applied - no valid targets");
			}
		}
		catch (err) {
			console.error("shadowdark-extras | Error applying conditions:", err);
			ui.notifications.error("Failed to apply conditions");
			$btn.prop("disabled", false);
			$btn.data("applying", false);
		}
	});

	// Summon creatures button click
	$card.on("click", ".sdx-summon-creatures-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);

		// Prevent duplicate summonings
		if ($btn.data("summoning")) {
			return;
		}

		$btn.data("summoning", true);
		$btn.prop("disabled", true);


		try {
			const profilesJson = $btn.data("profiles");
			let profiles = [];
			if (typeof profilesJson === "string") {
				profiles = JSON.parse(profilesJson);
			}
			else if (Array.isArray(profilesJson)) {
				profiles = profilesJson;
			}
			else if (profilesJson && typeof profilesJson === "object") {
				profiles = Object.values(profilesJson);
			}


			if (profiles.length === 0) {
				ui.notifications.warn("No summon profiles configured");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Check if Portal library is available
			if (typeof Portal === "undefined") {
				ui.notifications.error("Portal library is required for summoning but not found");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Get the caster token to use as origin
			const casterActorId = $card.data("caster-actor-id");
			const casterActor = casterActorId ? game.actors.get(casterActorId) : null;
			const casterToken = casterActor ? canvas.tokens.placeables.find(t => t.actor?.id === casterActorId) : null;

			if (!casterToken) {
				ui.notifications.warn("Could not find caster token for summoning");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Create Portal instance
			const portal = new Portal();
			portal.origin(casterToken);

			// Add all creature profiles
			let validProfileCount = 0;
			for (const profile of profiles) {
				const creatureUuid = profile?.creatureUuid || profile?.creature || profile?.uuid || "";
				if (!creatureUuid) {
					console.warn("shadowdark-extras | Skipping profile with no creature UUID:", profile);
					continue;
				}
				validProfileCount += 1;

				// Add creature with count and display name
				portal.addCreature({
					creature: creatureUuid,
					count: profile.count || "1",
					displayName: profile.displayName || "",
				});
			}

			if (validProfileCount === 0) {
				ui.notifications.warn("No summon creatures are configured. Drop an actor into the summon row first.");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Show dialog and spawn
			const spawnedTokens = await portal.dialog({
				spawn: true,
				multipleChoice: true, // Allow selecting which creatures to summon
				title: "Summon Creatures",
			});

			if (spawnedTokens && spawnedTokens.length > 0) {
				ui.notifications.info(`Summoned ${spawnedTokens.length} creature(s)`);
				$btn.html('<i class="fas fa-check"></i> SUMMONED');
			}
			else {
				ui.notifications.info("Summoning cancelled");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
			}
		}
		catch (err) {
			console.error("shadowdark-extras | Error summoning creatures:", err);
			ui.notifications.error("Failed to summon creatures");
			$btn.prop("disabled", false);
			$btn.data("summoning", false);
		}
	});
}

// Names imported back by CombatSettingsSD (split glue — internal helpers that
// injectDamageCard and the retained sections still call).
export {
	buildRollBreakdown,
	buildDamageCardHtml,
	attachDamageCardListeners,
	giveItemsToCaster,
	applyCoatingPoison,
	getSummonedTokensExpiry,
	saveSummonedTokensExpiry,
	normalizeConfiguredEffectUuids,
	evaluateFormulaExpressions,
	doubleDiceInFormula,
	parseTieredFormula,
	evaluateRequirement,
	buildTargetRollData,
};
