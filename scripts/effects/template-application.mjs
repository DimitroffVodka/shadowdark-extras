// Template application leaf — extracted from
// scripts/effects/TemplateEffectsSD.mjs (Phase 5.3 lane-C split).
// Effect application: enter/leave processing, saves, damage, macros,
// interactive + result chat cards. Uses template-geometry for DC shape
// lookups via evaluateDCFormula's caster data only.
// Leaf: local MODULE_ID const; imports template-conditions.

const MODULE_ID = "shadowdark-extras";
import { applyTemplateConditions } from "./template-conditions.mjs";

export async function applyTemplateEffect(templateDoc, token, trigger) {
	const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
	if (!config) return;

	const actor = token.actor;
	if (!actor) return;

	// Check if caster's token - exclude if configured
	if (config.excludeCaster && token.document?.id === config.casterTokenId) {
		console.log("shadowdark-extras | Excluding caster from template effect");
		return;
	}

	// Get auto-apply setting
	let autoApplyDamage = true;
	try {
		const settings = game.settings.get(MODULE_ID, "combatSettings") || {};
		autoApplyDamage = settings.damageCard?.autoApplyDamage ?? true;
	}
	catch(e) {
		// Settings may not exist
	}

	// If auto-apply is OFF, create interactive card
	if (!autoApplyDamage) {
		await createInteractiveTemplateCard(templateDoc, token, trigger, config);

		// Interactive mode with no save: apply effects (conditions) immediately
		// Otherwise they are never applied because the card doesn't check for them currently
		// ONLY valid for 'enter' trigger (don't re-apply on leave)
		if (config.effects?.length > 0 && !config.save?.enabled && trigger === "enter") {
			console.log(`shadowdark-extras | Interactive mode + No save (Enter): Auto-applying effects for ${config.spellName}`);
			await applyTemplateConditions(templateDoc, token, config.effects);
		}

		// Still run item macro even in interactive mode
		console.log(`shadowdark-extras | Macro check (interactive): runItemMacro=${config.runItemMacro}, spellId=${config.spellId}`);
		if (config.runItemMacro && config.spellId) {
			await runTemplateItemMacro(templateDoc, token, trigger, config);
		}
		return;
	}

	// Auto-apply mode: roll saves and apply damage automatically
	let damageApplied = 0;
	let savedSuccessfully = false;
	let saveResult = null;
	let halfDamage = false;

	// Handle save if configured
	// Check for either static DC or formula
	if (config.save?.enabled && (config.save?.dc || config.save?.dcFormula)) {
		// Roll save for the token - pass casterData for formula evaluation
		const saveConfig = {
			...config.save,
			casterData: config.casterData,
		};
		saveResult = await rollTemplateSave(actor, saveConfig);
		savedSuccessfully = saveResult.success;

		if (savedSuccessfully && !config.save.halfOnSuccess) {
			// Full save negates - skip damage and effects
			await createTemplateEffectMessage(templateDoc, token, trigger, {
				saved: true,
				saveResult: saveResult,
			});
			return;
		}

		// Mark if half damage will be applied
		if (savedSuccessfully && config.save.halfOnSuccess) {
			halfDamage = true;
		}
	}

	// Apply damage if configured
	if (config.damage?.formula) {
		const damageResult = await applyTemplateDamage(
			templateDoc, token, config, savedSuccessfully
		);
		damageApplied = damageResult.damage;
	}

	// Apply effects if configured — never on 'leave' (removeTemplateEffects handles that)
	if (config.effects?.length > 0 && !savedSuccessfully && trigger !== "leave") {
		await applyTemplateConditions(templateDoc, token, config.effects);
	}

	// Run item macro if configured
	console.log(`shadowdark-extras | Macro check: runItemMacro=${config.runItemMacro}, spellId=${config.spellId}`);
	if (config.runItemMacro && config.spellId) {
		await runTemplateItemMacro(templateDoc, token, trigger, config);
	}

	// Create chat message
	await createTemplateEffectMessage(templateDoc, token, trigger, {
		damage: damageApplied,
		saved: savedSuccessfully,
		saveResult: saveResult,
		halfDamage: halfDamage,
		damageType: config.damage?.type,
	});
}

/**
 * Create an interactive template effect card with buttons
 * Used when autoApplyDamage is OFF
 */
export async function createInteractiveTemplateCard(templateDoc, token, trigger, config) {
	const spellName = config?.spellName || "Template";
	const actor = token.actor;

	const triggerText = {
		creation: "was caught in",
		enter: "entered",
		leave: "left",
		turnStart: "started turn in",
		turnEnd: "ended turn in",
	}[trigger] || trigger;

	const abilityNames = {
		str: "Strength", dex: "Dexterity", con: "Constitution",
		int: "Intelligence", wis: "Wisdom", cha: "Charisma",
	};

	// Roll damage formula to show what damage would be
	let damageRoll = null;
	let damageTotal = 0;
	if (config.damage?.formula) {
		const rollData = {
			level: actor?.system?.level?.value || 1,
			...actor?.getRollData?.() || {},
		};
		damageRoll = await new Roll(config.damage.formula, rollData).evaluate();

		// Show 3D dice animation if Dice So Nice is available
		if (game.dice3d) {
			await game.dice3d.showForRoll(damageRoll, game.user, true);
		}

		damageTotal = damageRoll.total;
	}


	let content = `
        <div class="sdx-template-effect-card" style="background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 10px; color: #e0e0e0;">
            <div style="border-bottom: 1px solid #333; padding-bottom: 6px; margin-bottom: 8px;">
                <strong style="font-size: 14px;">${spellName}</strong>
            </div>
            <p style="margin: 0 0 8px 0; font-size: 12px;">
                <strong>${token.name}</strong> ${triggerText} the area
            </p>
    `;

	// Show save info if save is configured
	if (config.save?.enabled && (config.save?.dc || config.save?.dcFormula)) {
		// Evaluate DC
		let dc = config.save.dc || 10;
		if (config.save.dcFormula) {
			dc = await evaluateDCFormula(config.save.dcFormula, config.casterData);
		}

		const abilityName = abilityNames[config.save.ability] || config.save.ability;
		const btnBaseStyle = "flex: 1; color: #f2f2f2; border: 1px solid #777; padding: 6px 4px; cursor: pointer; border-radius: 3px; font-size: 11px;";
		content += `
            <style>
                .sdx-template-effect-card .sdx-template-roll-save-btn:hover,
                .sdx-template-effect-card .sdx-template-apply-damage-btn:hover,
                .sdx-template-effect-card .sdx-template-apply-half-damage-btn:hover { background: #2a2a2a !important; }
            </style>
            <div style="background: #252525; border: 1px solid #333; border-radius: 3px; padding: 8px; margin-bottom: 8px;">
                <p style="margin: 0 0 6px 0; font-size: 11px; color: #aaa;">
                    <i class="fas fa-shield-alt" style="margin-right: 4px;"></i>${abilityName} Save DC ${dc}
                </p>
                <div style="display: flex; gap: 4px;">
                    <button type="button" class="sdx-template-roll-save-btn sdx-save-btn-adv"
                        data-token-id="${token.document?.id || token.id}"
                        data-actor-id="${actor?.id}"
                        data-ability="${config.save.ability}"
                        data-dc="${dc}"
                        data-half-on-success="${config.save.halfOnSuccess}"
                        data-roll-mode="advantage"
                        style="${btnBaseStyle} background: #111;">
                        <i class="fas fa-angle-double-up"></i> Adv
                    </button>
                    <button type="button" class="sdx-template-roll-save-btn sdx-save-btn-normal"
                        data-token-id="${token.document?.id || token.id}"
                        data-actor-id="${actor?.id}"
                        data-ability="${config.save.ability}"
                        data-dc="${dc}"
                        data-half-on-success="${config.save.halfOnSuccess}"
                        data-roll-mode="normal"
                        style="${btnBaseStyle} background: #111;">
                        <i class="fas fa-dice-d20"></i> Roll
                    </button>
                    <button type="button" class="sdx-template-roll-save-btn sdx-save-btn-dis"
                        data-token-id="${token.document?.id || token.id}"
                        data-actor-id="${actor?.id}"
                        data-ability="${config.save.ability}"
                        data-dc="${dc}"
                        data-half-on-success="${config.save.halfOnSuccess}"
                        data-roll-mode="disadvantage"
                        style="${btnBaseStyle} background: #111;">
                        <i class="fas fa-angle-double-down"></i> Dis
                    </button>
                </div>
            </div>
        `;
	}

	// Show damage info with apply button
	if (damageRoll) {
		const typeText = config.damage?.type ? ` ${config.damage.type}` : "";
		content += `
            <div style="background: #252525; border: 1px solid #333; border-radius: 3px; padding: 8px;">
                <p style="margin: 0 0 4px 0; font-size: 13px;">
                    <i class="fas fa-heart-broken" style="color: #ddd; margin-right: 4px;"></i>
                    <strong>${damageTotal}</strong>${typeText}
                </p>
                <p style="margin: 0 0 8px 0; font-size: 10px; color: #888;">${config.damage.formula} = ${damageRoll.result}</p>
                <button type="button" class="sdx-template-apply-damage-btn"
                    data-token-id="${token.document?.id || token.id}"
                    data-actor-id="${actor?.id}"
                    data-damage="${damageTotal}"
                    data-damage-type="${config.damage?.type || "damage"}"
                    data-actor-name="${actor?.name || token.name}"
                    style="width: 100%; background: #111; color: #f2f2f2; border: 1px solid #777; padding: 6px; cursor: pointer; border-radius: 3px; margin-bottom: 4px;">
                    <i class="fas fa-heart-broken"></i> Apply ${damageTotal} Damage
                </button>
                <button type="button" class="sdx-template-apply-half-damage-btn"
                    data-token-id="${token.document?.id || token.id}"
                    data-actor-id="${actor?.id}"
                    data-damage="${Math.floor(damageTotal / 2)}"
                    data-damage-type="${config.damage?.type || "damage"}"
                    data-actor-name="${actor?.name || token.name}"
                    style="width: 100%; background: #111; color: #f2f2f2; border: 1px solid #777; padding: 6px; cursor: pointer; border-radius: 3px;">
                    <i class="fas fa-shield-alt"></i> Apply ${Math.floor(damageTotal / 2)} (Half)
                </button>
            </div>
        `;
	}

	content += "</div>";

	// Create message with flags for button handlers
	await ChatMessage.create({
		content,
		speaker: ChatMessage.getSpeaker({ actor }),
		flags: {
			[MODULE_ID]: {
				isTemplateEffectCard: true,
				templateId: templateDoc.id,
				tokenId: token.document?.id || token.id,
				actorId: actor?.id,
				config: config,
				damageTotal: damageTotal,
				trigger: trigger,
			},
		},
	});
}

/**
 * Apply damage from a template to a token
 */
export async function applyTemplateDamage(templateDoc, token, config, savedSuccessfully) {
	const actor = token.actor;
	if (!actor) return { damage: 0 };

	let formula = config.damage.formula;

	// Build roll data
	const rollData = {
		level: actor.system?.level?.value || 1,
		...actor.getRollData?.() || {},
	};

	// Roll the damage
	const roll = await new Roll(formula, rollData).evaluate();

	// Show 3D dice animation if Dice So Nice is available
	if (game.dice3d) {
		await game.dice3d.showForRoll(roll, game.user, true);
	}

	let damage = roll.total;


	// Half damage on successful save
	if (savedSuccessfully && config.save?.halfOnSuccess) {
		damage = Math.floor(damage / 2);
	}

	// Apply damage to token
	const currentHP = actor.system?.attributes?.hp?.value ?? 0;
	const newHP = Math.max(0, currentHP - damage);
	await actor.update({ "system.attributes.hp.value": newHP });

	console.log(`shadowdark-extras | Applied ${damage} damage to ${token.name} from template`);

	return { damage, roll };
}

/**
 * Roll a save for a token against template effect
 * Supports advantage/disadvantage via rollMode
 */
export async function rollTemplateSave(actor, saveConfig) {
	const ability = saveConfig.ability || "dex";
	// Evaluate DC if formula is present
	let dc = saveConfig.dc || 10;
	if (saveConfig.dcFormula) {
		dc = await evaluateDCFormula(saveConfig.dcFormula, saveConfig.casterData);
	}

	// Fallback if evaluation failed or resulted in 0/NaN
	if (!dc || isNaN(dc)) dc = 10;

	const rollMode = saveConfig.rollMode || "normal";

	// Get ability modifier - handle both PCs and NPCs
	// NPCs in Shadowdark store the modifier directly in .mod
	// PCs store the ability score in .value, and the system calculates .mod
	let modifier = 0;
	const abilityData = actor.system?.abilities?.[ability];

	if (abilityData?.mod !== undefined) {
		// Use the stored modifier (works for NPCs and PCs with calculated mod)
		modifier = abilityData.mod;
	}
	else if (abilityData?.value !== undefined) {
		// Fallback: calculate from ability score value
		modifier = Math.floor((abilityData.value - 10) / 2);
	}

	// Determine roll formula based on mode
	let formula;
	let dieResults;
	if (rollMode === "advantage") {
		formula = `2d20kh + ${modifier}`;
	}
	else if (rollMode === "disadvantage") {
		formula = `2d20kl + ${modifier}`;
	}
	else {
		formula = `1d20 + ${modifier}`;
	}

	// Roll the save
	const roll = await new Roll(formula).evaluate();

	// Show 3D dice animation if Dice So Nice is available
	if (game.dice3d) {
		await game.dice3d.showForRoll(roll, game.user, true);
	}

	const success = roll.total >= dc;


	// Get die results for display
	if (rollMode === "advantage" || rollMode === "disadvantage") {
		const results = roll.dice[0]?.results?.map(r => r.result) || [];
		const kept = rollMode === "advantage" ? Math.max(...results) : Math.min(...results);
		dieResults = `${results.join(", ")} → ${kept}`;
	}
	else {
		dieResults = roll.dice[0]?.results?.[0]?.result?.toString() || "?";
	}

	console.log(`shadowdark-extras | Save roll (${rollMode}): ${roll.total} vs DC ${dc} - ${success ? "SUCCESS" : "FAILURE"}`);

	return {
		success,
		roll,
		total: roll.total,
		dc,
		ability,
		modifier,
		rollMode,
		dieResults,
	};
}

/**
 * Evaluate DC formula using caster data
 * @param {string} formula - The formula string (e.g. "12", "@spellcastingCheck", "8 + @caster.int")
 * @param {Object} casterData - The caster data object
 * @returns {Promise<number>} - The evaluated DC
 */
export async function evaluateDCFormula(formula, casterData) {
	if (!formula) return 10;

	// If it's just a number, return it
	if (!isNaN(formula)) return parseInt(formula);

	console.log(`shadowdark-extras | Evaluating DC formula: "${formula}" with data:`, casterData);

	if (!casterData) return 10;

	// Replace @spellcastingCheck
	let parsed = formula.replace(/@spellcastingCheck/g, casterData.spellcastingCheck || 0);
	parsed = parsed.replace(/@caster\.spellcastingCheck/g, casterData.spellcastingCheck || 0);

	// Replace @caster.level
	parsed = parsed.replace(/@caster\.level/g, casterData.level || 0);

	// Replace ability mods
	const abilities = ["str", "dex", "con", "int", "wis", "cha"];
	for (const ab of abilities) {
		const regex = new RegExp(`@caster\\.${ab}`, "g");
		parsed = parsed.replace(regex, casterData.abilities?.[ab] || 0);
	}

	console.log(`shadowdark-extras | DC formula parsed to: "${parsed}"`);

	try {
		const roll = await new Roll(parsed).evaluate();
		const result = Math.floor(roll.total);
		console.log(`shadowdark-extras | DC evaluation result: ${result}`);
		return result;
	}
	catch(e) {
		console.warn(`shadowdark-extras | Failed to evaluate DC formula "${formula}":`, e);
		return 10;
	}
}

/**
 * Run the spell's item macro when template effect triggers
 * @param {MeasuredTemplateDocument} templateDoc - The template document
 * @param {Token} token - The target token
 * @param {string} trigger - The trigger type
 * @param {Object} config - The template effect config
 */
export async function runTemplateItemMacro(templateDoc, token, trigger, config) {
	try {
		// Get the caster actor to find the spell
		const casterActor = game.actors.get(config.casterActorId);
		if (!casterActor) {
			console.warn("shadowdark-extras | Cannot run item macro: caster actor not found");
			return;
		}

		// Find the spell item
		const spellItem = casterActor.items.get(config.spellId);
		if (!spellItem) {
			console.warn(`shadowdark-extras | Cannot run item macro: spell ${config.spellId} not found on caster`);
			return;
		}

		// Import the native macro executor
		const { executeItemMacro, hasItemMacro } = await import("../item-macros/item-macro-engine.mjs");
		if (!hasItemMacro(spellItem)) return;

		// Get caster token
		const casterToken = config.casterTokenId ? canvas.tokens.get(config.casterTokenId) : null;

		// Build args object with template-specific data
		const args = {
			trigger: trigger,
			templateDoc: templateDoc,
			config: config,
			casterActor: casterActor,
			casterToken: casterToken,
			saved: false,
			damageApplied: 0,
		};

		console.log(`shadowdark-extras | Running item macro for ${spellItem.name} on ${token.name} (trigger: ${trigger})`);

		return executeItemMacro(spellItem, {
			actor: token.actor,
			token: token,
			args: args,
		});
	}
	catch(err) {
		console.error("shadowdark-extras | Error running item macro:", err);
		ui.notifications.error(`Error running item macro: ${err.message}`);
	}
}

/**
 * Create a chat message for template effect
 */
export async function createTemplateEffectMessage(templateDoc, token, trigger, result) {
	const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
	const spellName = config?.spellName || "Template";

	const triggerText = {
		creation: "was caught in",
		enter: "entered",
		leave: "left",
		turnStart: "started turn in",
		turnEnd: "ended turn in",
	}[trigger] || trigger;

	// Build ability display name
	const abilityNames = {
		str: "Strength", dex: "Dexterity", con: "Constitution",
		int: "Intelligence", wis: "Wisdom", cha: "Charisma",
	};

	let content = `
        <div class="sdx-template-effect-card" style="border: 1px solid #777; border-radius: 4px; padding: 8px; background: #0b0b0b; color: #e8e8e8;">
            <h3 style="color: #f2f2f2; margin: 0 0 6px 0; border-bottom: 1px solid #333; padding-bottom: 4px;">
                <i class="fas fa-magic"></i> ${spellName}
            </h3>
            <p style="margin: 4px 0; color: #d6d6d6;">
                <b>${token.name}</b> ${triggerText} the area
            </p>
    `;

	// Show save roll details if save was made
	if (result.saveResult) {
		const sr = result.saveResult;
		const abilityName = abilityNames[sr.ability] || sr.ability;
		const saveColor = sr.success ? "#f2f2f2" : "#d0d0d0";
		const saveText = sr.success ? "Save Successful!" : "Save Failed!";

		// Get the die result and use the stored modifier
		const dieResult = sr.roll?.dice?.[0]?.results?.[0]?.result || "?";
		const modifier = sr.modifier ?? 0;
		const modifierStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;

		content += `
            <div style="margin: 8px 0; padding: 6px; background: #151515; border: 1px solid #333; border-radius: 4px;">
                <p style="margin: 2px 0; color: #bbb; font-size: 11px;">
                    <i class="fas fa-shield-alt"></i> ${abilityName} Save vs DC ${sr.dc}
                </p>
                <p style="margin: 4px 0; color: #fff; font-size: 14px;">
                    Roll: <span style="color: #fff; font-weight: bold;">${dieResult}</span>
                    <span style="color: #bbb;">${modifierStr}</span>
                    = <span style="font-weight: bold;">${sr.total}</span>
                </p>
                <p style="margin: 4px 0; color: ${saveColor}; font-weight: bold;">${saveText}</p>
            </div>
        `;
	}

	// Show damage info with details
	if (result.damage !== undefined && result.damage > 0) {
		const typeText = result.damageType ? ` ${result.damageType}` : "";
		const halfText = result.halfDamage ? " (half)" : "";

		content += `
            <div style="margin: 8px 0; padding: 6px; background: #151515; border-radius: 4px; border: 1px solid #555;">
                <p style="margin: 2px 0; color: #d6d6d6;">
                    <i class="fas fa-heart-broken"></i> Damage Applied${halfText}
                </p>
                <p style="margin: 4px 0; color: #fff; font-size: 18px; font-weight: bold;">
                    ${result.damage}${typeText}
                </p>
            </div>
        `;
	}
	else if (result.saved && config?.save?.halfOnSuccess === false) {
		// Save fully negated
		content += `
            <p style="margin: 4px 0; color: #f2f2f2;">
                <i class="fas fa-shield-alt"></i> Damage negated by save!
            </p>
        `;
	}

	content += "</div>";

	await ChatMessage.create({
		content,
		speaker: ChatMessage.getSpeaker({ actor: token.actor }),
	});
}
