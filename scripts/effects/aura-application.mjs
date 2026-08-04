// Aura application leaf — extracted from
// scripts/effects/AuraEffectsSD.mjs (Phase 5.3 lane-C split).
// Effect application: enter/leave processing, saves, damage, conditions,
// removal/cleanup, item macros and chat cards. Reaches the tracker bridge
// via a dynamic import (syncAuraTrackerTarget) exactly as the original.

import { MODULE_ID } from "./aura-constants.mjs";
import { getSocket } from "../combat/CombatSettingsSD.mjs";
import { isCanvasAvailable } from "./aura-geometry.mjs";
import {
	_auraInsideState,
	_auraMembership,
	getAuraInsideStateKey,
	clearAuraMembershipForToken,
	shouldSuppressDuplicateAuraTrigger,
} from "./aura-state.mjs";
import {
	applyTokenMagicFilter,
	removeTokenMagicFilter,
	removeAllSdxAuraTokenMagicFilters,
	shouldKeepAnySdxAuraTokenMagicFilter,
	getCurrentAuraTokenFilters,
} from "./aura-tokenmagic.mjs";

export async function syncAuraTrackerTarget(config, targetToken, mode) {
	const casterActorId = config?.casterActorId;
	const trackerType = config?.trackerType;
	const trackerInstanceId = config?.trackerInstanceId;
	if (!(casterActorId && trackerType && trackerInstanceId && targetToken?.actor)) return;

	try {
		const tracker = await import("./FocusSpellTrackerSD.mjs");
		if (trackerType === "focus") {
			if (mode === "enter") {
				await tracker.linkTargetToFocusSpell(
					casterActorId, trackerInstanceId, targetToken.actor.id, targetToken.id
				);
			}
			else if (mode === "leave") {
				await tracker.unlinkTargetFromFocusSpell(
					casterActorId, trackerInstanceId, targetToken.id, targetToken.actor.id
				);
			}
		}
		else if (trackerType === "duration") {
			if (mode === "enter") {
				await tracker.linkTargetToDurationSpell(
					casterActorId, trackerInstanceId, targetToken.actor.id, targetToken.id
				);
			}
			else if (mode === "leave") {
				await tracker.unlinkTargetFromDurationSpell(
					casterActorId, trackerInstanceId, targetToken.id, targetToken.actor.id
				);
			}
		}
	}
	catch(err) {
		console.warn("shadowdark-extras | Failed to sync aura target with spell tracker:", err);
	}
}

/**
 * Check if a specific component (damage, effects, macro) should trigger
 * @param {Object} componentTriggers - Component-specific triggers
 * @param {Object} standardTriggers - Standard aura triggers
 * @param {string} eventType - 'enter', 'sourceTurnStart', 'sourceTurnEnd',
 *   'targetTurnStart', 'targetTurnEnd'
 * @returns {boolean}
 */
export function shouldTriggerComponent(componentTriggers, standardTriggers, eventType) {
	const key = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`;

	// Check if any specific triggers are enabled for this component
	const anySpecific = componentTriggers && Object.values(componentTriggers).some(v => v === true);

	if (anySpecific) {
		return !!componentTriggers[key];
	}

	return !!standardTriggers[key];
}

export function sanitizeClonedAuraEffectData(effectData, auraEffect) {
	if (!effectData || typeof effectData !== "object") return effectData;

	delete effectData._id;
	delete effectData.id;

	effectData.flags = effectData.flags || {};
	effectData.flags[MODULE_ID] = effectData.flags[MODULE_ID] || {};
	effectData.flags[MODULE_ID].auraOrigin = auraEffect.id;

	// Do not keep source/Region origins on cloned Effect items. Foundry v14 may
	// try to resolve deleted Region UUIDs during embedded document creation.
	delete effectData.origin;
	if (effectData._stats) {
		delete effectData._stats.compendiumSource;
		delete effectData._stats.duplicateSource;
	}

	if (Array.isArray(effectData.effects)) {
		effectData.effects = effectData.effects.map(embedded => {
			const cloned = foundry.utils.deepClone(embedded);
			delete cloned._id;
			delete cloned.id;
			delete cloned.origin;
			if (cloned._stats) {
				delete cloned._stats.compendiumSource;
				delete cloned._stats.duplicateSource;
			}
			cloned.flags = cloned.flags || {};
			cloned.flags[MODULE_ID] = cloned.flags[MODULE_ID] || {};
			cloned.flags[MODULE_ID].auraOrigin = auraEffect.id;
			return cloned;
		});
	}

	return effectData;
}

/**
 * Apply aura effect to a token
 * @param {Token} sourceToken - The aura source
 * @param {Token} targetToken - The affected token
 * @param {string} trigger - The trigger type
 * @param {Object} config - The aura configuration
 * @param {ActiveEffect} auraEffect - The source aura effect
 */
export async function applyAuraEffect(sourceToken, targetToken, trigger, config, auraEffect) {
	if (!game.user.isGM) {
		const socket = getSocket();
		if (socket) {
			socket.executeAsGM("applyAuraEffectViaGM", {
				sourceTokenId: sourceToken.id,
				targetTokenId: targetToken.id,
				trigger: trigger,
				config: config,
				auraEffectId: auraEffect.id,
				auraEffectActorId: auraEffect.parent?.id,
			});
			return;
		}
	}

	console.log(`shadowdark-extras | applyAuraEffect: source=${sourceToken.name}, target=${targetToken.name}, trigger=${trigger}`);

	if (shouldSuppressDuplicateAuraTrigger(auraEffect, targetToken, trigger)) {
		console.log(`shadowdark-extras | applyAuraEffect: duplicate ${trigger} suppressed for ${targetToken.name}`);
		return;
	}

	const insideStateKey = getAuraInsideStateKey(sourceToken, targetToken, config, auraEffect);
	if (trigger === "enter") {
		if (_auraInsideState.has(insideStateKey)) {
			console.log(`shadowdark-extras | applyAuraEffect: repeated enter suppressed for ${targetToken.name}`);
			return;
		}
		_auraInsideState.add(insideStateKey);
		_auraMembership.add(insideStateKey);
	}
	else if (trigger === "leave") {
		_auraInsideState.delete(insideStateKey);
		_auraMembership.delete(insideStateKey);
	}

	// Skip if target is source and includeSelf is false
	if (sourceToken.id === targetToken.id && !config.includeSelf) {
		console.log("shadowdark-extras | applyAuraEffect: Self-target skipped (includeSelf=false)");
		return;
	}

	const actor = targetToken.actor;
	if (!actor) {
		console.log("shadowdark-extras | applyAuraEffect: No actor for target, skipping.");
		return;
	}

	if (trigger === "enter") {
		await syncAuraTrackerTarget(config, targetToken, "enter");
	}

	// Apply TokenMagic filter if configured (independent of damage/effects settings)
	const tokenFilters = await getCurrentAuraTokenFilters(sourceToken, config, auraEffect);
	if (trigger === "enter" && tokenFilters?.enabled && tokenFilters?.preset) {
		console.log(`shadowdark-extras | applyAuraEffect: Applying TokenMagic filter: ${tokenFilters.preset}`);
		await applyTokenMagicFilter(targetToken, tokenFilters.preset, auraEffect.id);
	}

	// Get auto-apply settings
	let autoApplyDamage = true;
	let autoApplyConditions = true;
	try {
		const settings = game.settings.get(MODULE_ID, "combatSettings") || {};
		autoApplyDamage = settings.damageCard?.autoApplyDamage ?? true;
		autoApplyConditions = settings.damageCard?.autoApplyConditions ?? true;
	}
	catch(e) {
	}

	const triggerEffects = shouldTriggerComponent(config.effectsTriggers, config.triggers, trigger);
	console.log("shadowdark-extras | applyAuraEffect effects debug", {
		trigger,
		triggerEffects,
		autoApplyConditions,
		applyConfiguredEffects: config.applyConfiguredEffects,
		effects: config.effects,
		effectsTriggers: config.effectsTriggers,
		save: config.save,
	});

	// If auto-apply damage or conditions is OFF (with effects), create an interactive card
	const triggerDamage = shouldTriggerComponent(config.damageTriggers, config.triggers, trigger);
	const needsManualDamage = !autoApplyDamage && triggerDamage;
	const needsManualEffects = !autoApplyConditions && triggerEffects && config.effects?.length > 0;

	console.log(`shadowdark-extras | applyAuraEffect: triggerDamage=${triggerDamage}, autoApplyDamage=${autoApplyDamage}, needsManualEffects=${needsManualEffects}`);

	if (needsManualDamage || needsManualEffects) {
		await createInteractiveAuraCard(sourceToken, targetToken, trigger, config, auraEffect);

		// Still run item macro
		const triggerMacro = shouldTriggerComponent(config.macroTriggers, config.triggers, trigger);
		console.log(`shadowdark-extras | applyAuraEffect: triggerMacro=${triggerMacro}`);
		if (config.runItemMacro && triggerMacro && config.spellId) {
			await runAuraItemMacro(sourceToken, targetToken, trigger, config);
		}
		return;
	}

	// Auto-apply mode
	let damageApplied = 0;
	let savedSuccessfully = false;
	let saveResult = null;

	// Handle save if configured
	if (config.save?.enabled && config.save?.dc) {
		saveResult = await rollAuraSave(actor, config.save);
		savedSuccessfully = saveResult.success;

		if (savedSuccessfully && !config.save.halfOnSuccess) {
			await createAuraEffectMessage(sourceToken, targetToken, trigger, {
				saved: true,
				saveResult: saveResult,
				auraName: auraEffect.name,
			});
			return;
		}
	}

	// Apply damage if configured
	if (triggerDamage && config.damage?.formula) {
		console.log("shadowdark-extras | applyAuraEffect: Rolling damage...");
		damageApplied = await applyAuraDamage(targetToken, config, savedSuccessfully);
	}

	// Apply configured effects after the save is resolved. If a save is enabled,
	// a successful save with no half-on-save damage prevents condition effects.
	if (triggerEffects && config.effects?.length > 0 && !savedSuccessfully && autoApplyConditions) {
		await applyAuraConditions(auraEffect, targetToken, config.effects);
	}

	// Run item macro if configured
	const triggerMacro = shouldTriggerComponent(config.macroTriggers, config.triggers, trigger);
	if (config.runItemMacro && triggerMacro && config.spellId) {
		await runAuraItemMacro(sourceToken, targetToken, trigger, config);
	}

	// Create chat message
	const hasReportableOutcome = !!(
		damageApplied
        || saveResult
        || (triggerEffects && config.effects?.length > 0)
        || (config.runItemMacro && triggerMacro)
	);
	if (hasReportableOutcome) {
		await createAuraEffectMessage(sourceToken, targetToken, trigger, {
			damage: damageApplied,
			saved: savedSuccessfully,
			saveResult: saveResult,
			halfDamage: savedSuccessfully && config.save?.halfOnSuccess,
			damageType: config.damage?.type,
			auraName: auraEffect.name,
		});
	}
}

/**
 * Roll a save against an aura effect
 */
export async function rollAuraSave(actor, saveConfig) {
	const ability = saveConfig.ability || "dex";
	const dc = saveConfig.dc || 12;

	// Get modifier
	const modifier = actor.system?.abilities?.[ability]?.mod || 0;

	// Roll the save
	const roll = await new Roll(`1d20 + ${modifier}`).evaluate();

	// Show 3D dice animation if Dice So Nice is available
	if (game.dice3d) {
		await game.dice3d.showForRoll(roll, game.user, true);
	}

	const total = roll.total;
	const success = total >= dc;


	return {
		roll: roll,
		total: total,
		success: success,
		dc: dc,
		ability: ability,
		modifier: modifier,
	};
}

/**
 * Apply damage from an aura
 */
export async function applyAuraDamage(token, config, savedSuccessfully) {
	const actor = token.actor;
	if (!actor) {
		return 0;
	}

	const roll = await new Roll(config.damage.formula).evaluate();

	// Show 3D dice animation if Dice So Nice is available
	if (game.dice3d) {
		await game.dice3d.showForRoll(roll, game.user, true);
	}

	let damage = roll.total;


	// Half damage if saved
	if (savedSuccessfully && config.save?.halfOnSuccess) {
		damage = Math.floor(damage / 2);
	}

	// Apply to HP
	const currentHp = actor.system?.attributes?.hp?.value ?? 0;
	const newHp = Math.max(0, currentHp - damage);


	try {
		await actor.update({ "system.attributes.hp.value": newHp });
	}
	catch(err) {
		console.error("shadowdark-extras | applyAuraDamage: Error updating HP:", err);
	}

	return damage;
}

/**
 * Apply condition effects from an aura
 */
export async function applyAuraConditions(auraEffect, token, effectUuids) {

	const actor = token.actor;
	if (!actor) return;

	for (const effectEntry of effectUuids) {
		try {
			const effectUuid = typeof effectEntry === "string" ? effectEntry : effectEntry?.uuid;
			if (!effectUuid) continue;

			const effectDoc = await fromUuid(effectUuid);
			if (!effectDoc) {
				console.warn("shadowdark-extras | Aura configured effect could not be resolved:", effectUuid);
				continue;
			}

			if (effectEntry?.name && effectDoc.name !== effectEntry.name) {
				console.warn("shadowdark-extras | Aura configured effect UUID resolved to a different item", {
					configuredName: effectEntry.name,
					resolvedName: effectDoc.name,
					uuid: effectUuid,
				});
			}

			const documentName = effectDoc.documentName || effectDoc.constructor?.documentName || "";
			const isActiveEffect = documentName === "ActiveEffect";

			// Check if already has this effect from this aura (by name + aura origin flag)
			const existingItem = actor.items.find(i =>
				i.type === "Effect"
                && i.name === effectDoc.name
                && i.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
			);
			const existingActiveEffect = actor.effects.find(e =>
				e.name === effectDoc.name
                && e.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
			);

			if (existingItem || existingActiveEffect) {
				continue;
			}

			const effectData = sanitizeClonedAuraEffectData(effectDoc.toObject(), auraEffect);

			if (isActiveEffect) {
				await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
				console.log("shadowdark-extras | Applied aura ActiveEffect", {
					aura: auraEffect.name,
					target: token.name,
					effect: effectDoc.name,
				});
			}
			else {
				// Shadowdark condition/effect rows are Effect Items with embedded transfer effects.
				await actor.createEmbeddedDocuments("Item", [effectData]);
				console.log("shadowdark-extras | Applied aura Effect item", {
					aura: auraEffect.name,
					target: token.name,
					effect: effectDoc.name,
				});
			}
		}
		catch(err) {
			console.error("shadowdark-extras | Error applying aura condition:", err);
		}
	}
}

/**
 * Remove aura effects from a token when leaving
 */
export async function removeAuraEffectsFromToken(auraEffect, token) {
	// If not GM, execute via socket to avoid permission issues
	if (!game.user.isGM) {
		const socket = getSocket();
		if (socket) {
			socket.executeAsGM("removeAuraEffectViaGM", {
				auraEffectId: auraEffect.id,
				auraEffectActorId: auraEffect.parent?.id,
				targetTokenId: token.id,
			});
			return;
		}
	}

	const actor = token.actor;
	if (!actor) return;

	const auraConfig = auraEffect.flags?.[MODULE_ID]?.aura || {};
	await syncAuraTrackerTarget(auraConfig, token, "leave");
	clearAuraMembershipForToken(auraEffect, token);

	// Remove Effect Items that came from this aura
	const itemsToRemove = actor.items.filter(i =>
		i.type === "Effect"
        && i.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
	);

	if (itemsToRemove.length > 0) {
		const ids = itemsToRemove.map(i => i.id);
		await actor.deleteEmbeddedDocuments("Item", ids);
	}

	const activeEffectsToRemove = actor.effects.filter(e =>
		e.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
	);

	if (activeEffectsToRemove.length > 0) {
		const ids = activeEffectsToRemove.map(e => e.id);
		await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
	}

	// Remove TokenMagic filter if any was applied by this aura
	await removeTokenMagicFilter(token, auraEffect.id);
}

/**
 * Remove aura effects from all tokens when aura ends
 */
export async function removeAuraEffectsFromAll(auraEffect) {
	// If not GM, execute via socket to avoid permission issues
	if (!game.user.isGM) {
		const socket = getSocket();
		if (socket) {
			socket.executeAsGM("removeAuraEffectsFromAllViaGM", {
				auraEffectId: auraEffect.id,
				auraEffectActorId: auraEffect.parent?.id,
			});
			return;
		}
	}

	if (!isCanvasAvailable()) return;

	for (const token of canvas.tokens.placeables) {
		if (!token.actor) continue;
		await removeAuraEffectsFromToken(auraEffect, token);
		if (!shouldKeepAnySdxAuraTokenMagicFilter(token, auraEffect)) {
			await removeAllSdxAuraTokenMagicFilters(token);
		}
	}

	const auraConfig = auraEffect.flags?.[MODULE_ID]?.aura || {};
	const logicalAuraId = auraConfig.spellId || auraEffect.origin || auraEffect.id;
	for (const key of [..._auraInsideState]) {
		if (key.includes(`:${logicalAuraId}:`)) _auraInsideState.delete(key);
	}
}

/**
 * Run item macro for aura trigger
 */
export async function runAuraItemMacro(sourceToken, targetToken, trigger, config) {
	try {
		const casterActor = sourceToken.actor;
		if (!casterActor) return;

		const spellItem = casterActor.items.get(config.spellId);
		if (!spellItem) return;

		// Import the native macro executor
		const { executeItemMacro, hasItemMacro } = await import("../item-macros/item-macro-engine.mjs");
		if (!hasItemMacro(spellItem)) return;

		const args = {
			trigger: trigger,
			sourceToken: sourceToken,
			config: config,
			casterActor: casterActor,
			isAura: true,
		};

		return executeItemMacro(spellItem, {
			actor: targetToken.actor,
			token: targetToken,
			args: args,
		});
	}
	catch(err) {
		console.error("shadowdark-extras | Error running aura item macro:", err);
	}
}

/**
 * Create interactive card for aura effect (when autoApply is OFF)
 */
export async function createInteractiveAuraCard(sourceToken, targetToken, trigger, config,
	auraEffect) {
	// Similar to template interactive cards
	const triggerName = {
		enter: "entered",
		turnStart: "started turn in",
		turnEnd: "ended turn in",
	}[trigger] || trigger;

	const content = `
        <div class="shadowdark chat-card sdx-aura-effect-card" style="background: #1a1a1a; border-radius: 6px; padding: 8px; color: #e0e0e0;"
             data-source-token-id="${sourceToken.id}"
             data-target-token-id="${targetToken.id}"
             data-aura-effect-id="${auraEffect.id}"
             data-aura-actor-id="${auraEffect.parent?.id}"
             data-effect-uuids="${(config.effects || []).join(",")}"
             data-damage-formula="${config.damage?.formula || ""}"
             data-save-dc="${config.save?.dc || ""}"
             data-save-ability="${config.save?.ability || ""}"
             data-half-damage="${config.save?.halfOnSuccess || false}">

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid #444; padding-bottom: 6px;">
                <img src="${auraEffect.img || sourceToken.document.texture.src}" style="width: 32px; height: 32px; border-radius: 4px; border: 1px solid #555;">
                <div>
                    <strong style="color: #fff;">${auraEffect.name}</strong>
                    <div style="font-size: 11px; color: #aaa;">${targetToken.name} ${triggerName} aura</div>
                </div>
            </div>

            ${config.damage?.formula ? `
            <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <span><i class="fas fa-dice-d6"></i> ${config.damage.formula} ${config.damage.type || ""}</span>
                <button type="button" class="sdx-aura-apply-damage" style="width: auto; height: 24px; line-height: 24px; font-size: 12px; padding: 0 8px;">
                    Apply Damage
                </button>
            </div>` : ""}

            ${config.save?.enabled ? `
            <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <span><i class="fas fa-shield-alt"></i> DC ${config.save.dc} ${config.save.ability?.toUpperCase()}</span>
                <button type="button" class="sdx-aura-roll-save" style="width: auto; height: 24px; line-height: 24px; font-size: 12px; padding: 0 8px;">
                    Roll Save
                </button>
            </div>` : ""}

            ${config.effects?.length > 0 ? `
            <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <span><i class="fas fa-magic"></i> Apply Conditions</span>
                <button type="button" class="sdx-aura-apply-effects" style="width: auto; height: 24px; line-height: 24px; font-size: 12px; padding: 0 8px;">
                    Apply Effect
                </button>
            </div>` : ""}
        </div>
    `;

	await ChatMessage.create({
		content: content,
		speaker: ChatMessage.getSpeaker({ token: sourceToken.document }),
	});
}

/**
 * Create chat message for aura effect result
 */
export async function createAuraEffectMessage(sourceToken, targetToken, trigger, result) {
	const triggerName = {
		enter: "entered the aura",
		turnStart: "started turn in the aura",
		turnEnd: "ended turn in the aura",
		manual: result.manualAction || "interacted with the aura",
	}[trigger] || trigger;

	let content = `
        <div class="shadowdark chat-card" style="background: #1a1a1a; border-radius: 6px; padding: 8px; color: #e0e0e0;">
            <strong>${result.auraName || "Aura"}</strong>
            <p>${targetToken.name} ${triggerName}</p>
    `;

	if (result.saveResult) {
		const saveClass = result.saved ? "color: #4a4" : "color: #a44";
		content += `<p style="${saveClass}">Save: ${result.saveResult.total} vs DC ${result.saveResult.dc} - ${result.saved ? "SUCCESS" : "FAILED"}</p>`;
	}

	if (result.damage) {
		content += `<p>Damage: ${result.damage} ${result.damageType || ""}</p>`;
	}

	content += "</div>";

	await ChatMessage.create({
		content: content,
		speaker: ChatMessage.getSpeaker({ token: sourceToken.document }),
	});
}
