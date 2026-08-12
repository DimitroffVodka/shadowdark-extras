// Pure damage-card builders — extracted from scripts/combat/damage-card.mjs
// (Phase 5.1 split). Formula utilities, roll-breakdown builder, defense
// config helpers, damage-card HTML builder and multipliers builder.
// DOM-free (no canvas/ui/jQuery) — the remaining browser-global reads
// (window._lastSpellRoll etc., foundry.utils.escapeHTML) are candidates for
// parameter injection toward full node-testability in the 5.3 pass.

import { readSdDamageRoll } from "../shared/sd4Compat.mjs";
import { getEffectiveCreatureType } from "../npc/CreatureTypesApp.mjs";

const MODULE_ID = "shadowdark-extras";

function normalizeConfiguredEffectUuids(rawEffects) {
	if (!rawEffects) return [];

	let effects = rawEffects;
	if (typeof effects === "string") {
		try {
			effects = JSON.parse(effects);
		}
		catch(err) {
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
		catch(e) {
			console.warn("shadowdark-extras | Could not evaluate expression:", expr, e);
			return match;
		}
	});

	// Clean up any remaining standalone floor/ceil expressions not attached to dice
	evaluated = evaluated.replace(
		/(\d+)\s*\+\s*floor\s*\(\s*([^)]+)\s*\)/gi,
		(match, base, expr) => {
			try {
				// Pass bare floor() through — Roll.safeEval handles it natively.
				const result = parseInt(base) + Math.floor(Roll.safeEval(expr));
				return result.toString();
			}
			catch(e) {
				return match;
			}
		}
	);

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
		evalFormula = evalFormula.replace(
			/(==|!=|<=?|>=?)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*$/g,
			(match, op, word) => {
				// Don't quote if it's a boolean or looks like a number
				if (word === "true" || word === "false" || !isNaN(Number(word))) {
					return match;
				}
				return `${op} "${word}"`;
			}
		);

		// Also handle barewords after operators in the middle of expressions
		evalFormula = evalFormula.replace(
			/(==|!=|<=?|>=?)\s*([a-zA-Z_][a-zA-Z0-9_]*)(\s+(?:&&|\|\|))/g,
			(match, op, word, rest) => {
				if (word === "true" || word === "false" || !isNaN(Number(word))) {
					return match;
				}
				return `${op} "${word}"${rest}`;
			}
		);

		// Requirement expressions support strings and boolean logic, which Roll.safeEval does not.
		// eslint-disable-next-line no-new-func -- scoped evaluator for requirement formulas
		const func = new Function(`return (${evalFormula})`);
		const result = func();

		// Return true if result is truthy or > 0
		return !!result;
	}
	catch(err) {
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
				target[`${ability}Base`] = targetActorData.abilities[ability].value;
			}
		});
	}

	// Add target stats
	if (targetActorData.attributes?.ac?.value !== undefined) {
		target.ac = targetActorData.attributes.ac.value;
	}
	if (targetActorData.attributes?.hp?.value !== undefined) {
		target.hp = targetActorData.attributes.hp.value;
	}

	// Add Ancestry and Subtype
	target.ancestry = targetActor.system?.ancestry?.name || targetActor.system?.details?.ancestry || "";
	target.subtype = getEffectiveCreatureType(targetActor) || "";
	target.creatureType = target.subtype; // Alias for convenience

	return target;
}


/**
 * Build roll breakdown information from message
 * Returns an object with formula, total, diceHtml, and bonusHtml
 */
async function buildRollBreakdown(message, weaponBonusDamage = null, isCritical = false, baseDamageType = "standard") {
	// Try to get the damage roll (SD 4.x typed Roll OR v3 flag fallback)
	const damageRollData = readSdDamageRoll(message).roll;

	// Also check for synced spell roll in flags
	const syncedSpellResults = message.getFlag(MODULE_ID, "spellDamageResults");
	let spellRollFromFlag = null;
	const sRollData = syncedSpellResults?.rollJSON || syncedSpellResults?.rollData;
	if (sRollData) {
		try {
			spellRollFromFlag = (typeof sRollData === "string") ? Roll.fromJSON(sRollData) : Roll.fromData(sRollData);
		}
		catch(e) {
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
		catch(e) {
			console.error("shadowdark-extras | Error parsing NPC base roll:", e);
		}
	}

	// Use whichever roll we can find (prioritize synced flags, then Shadowdark
	// rolls, then window global).
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
		if (weaponBonusDamage.criticalRollResults
			&& weaponBonusDamage.criticalRollResults.length > 0) {
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
			html: `<span class="sdx-die sdx-die-clickable ${die.cssClass} ${extraClass}" data-die-index="${dieIndex}" data-faces="${die.faces}" title="${foundry.utils.escapeHTML(labelTitle)}Click to reroll this d${die.faces}">${die.value}</span>`,
			value: die.value,
			faces: die.faces,
		});
		dieIndex++;
	}

	// Add static bonuses (just the number, sign handled by join logic)
	for (const bonus of bonuses) {
		const absValue = Math.abs(bonus.value);
		breakdownParts.push({
			html: `<span class="sdx-bonus-val" title="${foundry.utils.escapeHTML(bonus.label || "")}">${absValue}</span>`,
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
		actor?.system?.abilities?.[key]?.mod
		?? rollData?.abilities?.[key]?.mod
		?? rollData?.[key]
		?? 0
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


async function buildDamageCardHtml(actor, targets, totalDamage, damageType, allEffects, spellDamageConfig, settings, message, weaponBonusDamage = null, isCritical = false, spellItem = null, casterTokenId = "", baseDamageType = "standard", isMagicalWeapon = false, challengeResults = null, effectsChallengeResults = null) {


	const cardSettings = settings.damageCard;
	const isHealing = damageType?.toLowerCase() === "healing";
	const targetDefenseConfig = getTargetDefenseConfig(spellDamageConfig, spellItem);
	const targetDefenseResults = getTargetDefenseResults(message);

	// Build roll breakdown HTML
	let rollBreakdownHtml = "";
	const rollBreakdown = await buildRollBreakdown(
		message, weaponBonusDamage, isCritical, baseDamageType
	);
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
									<button type="button" class="sdx-reroll-btn" data-formula="${foundry.utils.escapeHTML(rerollFormula)}" data-weapon-bonus="${weaponBonusData}" title="Reroll damage (e.g., for Luck token)">
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
						return `${d.number}${d.faces === "f" ? "dF" : `d${d.faces}`}: [${results}]`;
					}).join(" + ");
					rollBreakdown = `${perTargetDamage.formula} = ${diceBreakdown || targetSpecificDamage}`;
				}
				const escapedBreakdown = foundry.utils.escapeHTML(rollBreakdown ?? "");
				const tooltipAttr = rollBreakdown ? `data-tooltip="${escapedBreakdown}" title="${escapedBreakdown}"` : "";

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
			catch(error) {
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
					data-effects-requirement="${foundry.utils.escapeHTML(effectsRequirement)}"
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

	let html = `<div class="sdx-multipliers" data-token-id="${tokenId}">`;

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

// Pure-builders surface: consumed by the DOM/socket layer (damage-card.mjs)
// and re-exported through it for CombatSettingsSD's injectDamageCard.
export {
	normalizeConfiguredEffectUuids,
	evaluateFormulaExpressions,
	doubleDiceInFormula,
	parseTieredFormula,
	evaluateRequirement,
	buildTargetRollData,
	buildRollBreakdown,
	getTargetDefenseConfig,
	getAbilityModifier,
	getAbilityLabel,
	getTargetDefenseResults,
	getTargetDefenseStatusHtml,
	buildDamageCardHtml,
	buildMultipliersHtml,
};
