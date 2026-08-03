/**
 * Template Effects System for Shadowdark Extras
 * Handles damage and effects for tokens inside spell templates
 *
 * Triggers:
 * - onEnter: When a token moves into a template
 * - onTurnStart: At the start of a token's turn while inside
 * - onTurnEnd: At the end of a token's turn while inside
 * - onLeave: When a token leaves a template (removes effects)
 */

const MODULE_ID = "shadowdark-extras";

// Track previous token positions for movement detection
const _previousTokenPositions = new Map();

// Track which tokens have been affected this combat turn (to prevent duplicates)
const _affectedThisTurn = new Map();

// Track templates whose creation trigger has already run.
const _creationEffectsProcessed = new Set();

import { getTokensInTemplate, getTemplatesContainingToken, getTemplatesContainingPoint } from "./template-geometry.mjs";
import { rollTemplateSave, applyTemplateEffect } from "./template-application.mjs";
import { removeTemplateEffects } from "./template-conditions.mjs";

export function initTemplateEffects() {
	console.log("shadowdark-extras | Initializing Template Effects System");

	// Hook for token movement detection
	Hooks.on("preUpdateToken", (tokenDoc, changes, options, userId) => {
		// Store previous position + level before any update that could affect template containment
		if (changes.x !== undefined || changes.y !== undefined
            || changes.elevation !== undefined || changes.level !== undefined) {
			const gridSize = tokenDoc.parent?.grid?.size || canvas.grid.size || 100;
			const center = {
				x: tokenDoc.x + ((tokenDoc.width * gridSize) / 2),
				y: tokenDoc.y + ((tokenDoc.height * gridSize) / 2),
			};


			_previousTokenPositions.set(tokenDoc.id, {
				x: center.x,
				y: center.y,
				elevation: tokenDoc.elevation ?? 0,
				level: tokenDoc.level ?? null,
			});
		}
	});

	Hooks.on("updateToken", async (tokenDoc, changes, options, userId) => {
		// Process position, elevation, OR level changes — all affect template containment
		if (changes.x === undefined && changes.y === undefined
            && changes.elevation === undefined && changes.level === undefined) return;

		// Only run on GM client to prevent duplicate processing
		if (!game.user.isGM) return;

		await processTokenMovement(tokenDoc, changes);
	});

	// Hook for template creation - store initial contained tokens AND trigger onCreation
	Hooks.on("createMeasuredTemplate", async (templateDoc, options, userId) => {
		if (!game.user.isGM) return;

		// Wait for the template placeable and its shape to be ready (retry up to 1s)
		let attempts = 0;
		while (!templateDoc.object?.shape && attempts < 10) {
			await new Promise(r => {
				setTimeout(r, 100);
			});
			attempts++;
		}
		const tokens = getTokensInTemplate(templateDoc);

		if (tokens.length > 0) {
			await templateDoc.setFlag(MODULE_ID, "containedTokens", tokens.map(t => t.id));
		}

		await processTemplateCreationEffects(templateDoc, tokens);
	});

	// Hook for template/region deletion - clean up effects
	const _onDeleteTemplate = async doc => {
		if (!game.user.isGM) return;
		const config = doc.flags?.[MODULE_ID]?.templateEffects;
		if (!config?.enabled) return;
		if (config.triggers?.onLeave) {
			const containedTokenIds = doc.flags?.[MODULE_ID]?.containedTokens || [];
			for (const tokenId of containedTokenIds) {
				const token = canvas.tokens?.get(tokenId);
				if (token) await removeTemplateEffects(doc, token);
			}
		}
	};
	Hooks.on("deleteMeasuredTemplate", doc => _onDeleteTemplate(doc));

	// Clear per-turn tracking and process turn-based effects when combat advances
	Hooks.on("updateCombat", async (combat, changes, options, userId) => {
		// Clear tracking on any turn change
		if (changes.turn !== undefined || changes.round !== undefined) {
			_affectedThisTurn.clear();
		}

		// Only process turn changes, and only on GM client
		if (!game.user.isGM) return;
		if (changes.turn === undefined && changes.round === undefined) return;

		// Check for expired templates and delete them FIRST (only on round changes)
		// Delete expired templates first so no token gets an extra hit
		if (changes.round !== undefined) {
			const currentRound = combat.round;
			const templatesToDelete = [];
			const expiringMessages = [];

			// Check all templates on the scene for expiry
			// Use < so template lasts THROUGH expiry (deleted at next round start)
			// v14-safe: iterate Regions (warning-free; the merged Region carries the
			// same id + flags as the template). Avoids the deprecated Scene#templates getter.
			for (const template of (canvas.scene.regions ?? canvas.scene.templates)) {
				const expiry = template.flags?.[MODULE_ID]?.templateExpiry;
				if (expiry && expiry.expiryRound < currentRound) {
					templatesToDelete.push(template.id);
					expiringMessages.push(`<b>${expiry.spellName}</b> template has expired!`);
					console.log(`shadowdark-extras | Template ${expiry.spellName} expired at round ${currentRound} (was set to expire after round ${expiry.expiryRound})`);
				}
			}

			// Delete expired templates
			if (templatesToDelete.length > 0) {
				try {
					// Delete via the Region collection (warning-free; same ids). Both the
					// MeasuredTemplate and Region delete paths fire deleteRegion in v14.
					await canvas.scene.deleteEmbeddedDocuments("Region", templatesToDelete);
					console.log(`shadowdark-extras | Deleted ${templatesToDelete.length} expired template(s)`);
				}
				catch(err) {
					console.error("shadowdark-extras | Error deleting expired templates:", err);
				}

				// Send chat message about expired templates
				if (expiringMessages.length > 0) {
					const content = `
                        <div class="sdx-template-expiry">
                            <h4 style="margin: 0 0 6px 0; border-bottom: 1px solid #666; padding-bottom: 4px;">
                                <i class="fas fa-crosshairs"></i> Template Expiry
                            </h4>
                            <ul style="margin: 0; padding-left: 16px; list-style-type: none;">
                                ${expiringMessages.map(m => `<li style="margin: 2px 0;">${m}</li>`).join("")}
                            </ul>
                        </div>
                    `;
					ChatMessage.create({
						content: content,
						whisper: [game.user.id], // Whisper to GM only
					});
				}
			}
		}

		// Process turn end for previous combatant
		if (combat.previous?.combatantId) {
			const prevCombatant = combat.combatants.get(combat.previous.combatantId);
			if (prevCombatant?.token) {
				await processTemplateTurnEffects(prevCombatant.token, "turnEnd");
			}
		}

		// Process turn start for current combatant
		if (combat.current?.combatantId) {
			const currentCombatant = combat.combatants.get(combat.current.combatantId);
			if (currentCombatant?.token) {
				await processTemplateTurnEffects(currentCombatant.token, "turnStart");
			}
		}
	});

	// Hook for chat message buttons (Roll Save, Apply Damage)
	Hooks.on("renderChatMessageHTML", (message, html, context) => {
		// Handle Roll Save buttons
		const saveBtns = html.querySelectorAll(".sdx-template-roll-save-btn");
		saveBtns.forEach(btn => {
			btn.addEventListener("click", async event => {
				event.preventDefault();
				if (btn.disabled) return;

				// Disable all save buttons immediately
				saveBtns.forEach(b => b.disabled = true);

				const tokenId = btn.dataset.tokenId;
				const actorId = btn.dataset.actorId;
				const ability = btn.dataset.ability;
				const dc = parseInt(btn.dataset.dc);
				const halfOnSuccess = btn.dataset.halfOnSuccess === "true";
				const rollMode = btn.dataset.rollMode || "normal";

				// Get the actor
				let actor = null;
				const token = canvas.tokens?.get(tokenId);
				if (token?.actor) {
					actor = token.actor;
				}
				else if (actorId) {
					actor = game.actors.get(actorId);
				}

				if (!actor) {
					ui.notifications.error("Could not find actor");
					saveBtns.forEach(b => b.disabled = false);
					return;
				}

				// Roll the save with the selected mode
				const saveResult = await rollTemplateSave(actor, { ability, dc, rollMode });

				// Update to show result - replace the button container
				const saveText = saveResult.success ? "✓ SAVED" : "✗ FAILED";
				const rollModeText = rollMode === "advantage" ? " (Adv)" : rollMode === "disadvantage" ? " (Dis)" : "";
				const dieResult = saveResult.dieResults || saveResult.roll?.dice?.[0]?.results?.[0]?.result || "?";
				const modifier = saveResult.modifier ?? 0;
				const modifierStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;

				// Replace the parent container of the buttons
				const parent = btn.parentElement;
				if (parent) {
					const resultDiv = document.createElement("div");
					resultDiv.style.cssText = "padding: 4px; text-align: center; background: #1a1a1a; border-radius: 3px;";
					resultDiv.innerHTML = `
                        <p style="margin: 2px 0; font-size: 12px;">
                            Roll${rollModeText}: <strong>${dieResult}</strong> ${modifierStr} = <strong>${saveResult.total}</strong> vs DC ${dc}
                        </p>
                        <p style="margin: 2px 0; font-size: 13px;"><strong>${saveText}</strong></p>
                    `;
					parent.replaceWith(resultDiv);
				}

				// If save succeeded with halfOnSuccess, update the damage buttons
				if (saveResult.success && halfOnSuccess) {
					const fullBtn = html.querySelector(".sdx-template-apply-damage-btn");
					if (fullBtn) fullBtn.style.display = "none";
					const halfBtn = html.querySelector(".sdx-template-apply-half-damage-btn");
					if (halfBtn) halfBtn.style.background = "#3a5a3a";
				}
				else if (!saveResult.success) {
					// Failed save - hide half damage button
					const halfBtn = html.querySelector(".sdx-template-apply-half-damage-btn");
					if (halfBtn) halfBtn.style.display = "none";
				}
			});
		});

		// Handle Apply Damage buttons
		const damageBtns = html.querySelectorAll(".sdx-template-apply-damage-btn, .sdx-template-apply-half-damage-btn");
		damageBtns.forEach(btn => {
			btn.addEventListener("click", async event => {
				event.preventDefault();

				// Disable button immediately
				if (btn.disabled || btn.classList.contains("sdx-applied")) return;
				btn.disabled = true;
				const originalHtml = btn.innerHTML;
				btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';

				const tokenId = btn.dataset.tokenId;
				const actorId = btn.dataset.actorId;
				const damage = parseInt(btn.dataset.damage);
				const damageType = btn.dataset.damageType;
				const actorName = btn.dataset.actorName;

				if (isNaN(damage)) {
					btn.disabled = false;
					btn.innerHTML = originalHtml;
					return;
				}

				try {
					// Get the token and apply damage
					const token = canvas.tokens?.get(tokenId);
					let actor = token?.actor;
					if (!actor && actorId) {
						actor = game.actors.get(actorId);
					}

					if (!actor) {
						ui.notifications.error("Could not find target");
						btn.disabled = false;
						btn.innerHTML = originalHtml;
						return;
					}

					const currentHp = actor.system?.attributes?.hp?.value ?? 0;
					const newHp = Math.max(0, currentHp - damage);
					await actor.update({ "system.attributes.hp.value": newHp });

					// Update button to show applied
					btn.classList.add("sdx-applied");
					btn.innerHTML = `<i class="fas fa-check"></i> Applied ${damage}`;

					// Hide other damage buttons
					damageBtns.forEach(b => {
						if (b !== btn) b.style.display = "none";
					});

					ui.notifications.info(`Applied ${damage} ${damageType} damage to ${actorName}`);
				}
				catch(err) {
					console.error("shadowdark-extras | Error applying template damage:", err);
					btn.disabled = false;
					btn.innerHTML = originalHtml;
				}
			});
		});
	});

	console.log("shadowdark-extras | Template Effects System initialized");
}

/**
 * Process template effects for combat turn changes
 * Call this from the updateCombat hook in CombatSettingsSD.mjs
 * @param {TokenDocument} tokenDoc - The token whose turn it is
 * @param {string} trigger - 'turnStart' or 'turnEnd'
 */
export async function processTemplateTurnEffects(tokenDoc, trigger) {
	if (!tokenDoc || !game.user.isGM) return;

	const token = tokenDoc.object || canvas.tokens?.get(tokenDoc.id);
	if (!token) return;

	const templates = getTemplatesContainingToken(token);

	for (const templateDoc of templates) {
		const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
		if (!config?.enabled) continue;

		// Check if this trigger is enabled
		const triggerKey = trigger === "turnStart" ? "onTurnStart" : "onTurnEnd";
		if (!config.triggers?.[triggerKey]) continue;

		// Check per-turn duplicate prevention
		const turnKey = `${templateDoc.id}-${tokenDoc.id}-${trigger}`;
		if (_affectedThisTurn.has(turnKey)) continue;
		_affectedThisTurn.set(turnKey, true);

		console.log(`shadowdark-extras | Template ${trigger} trigger for ${token.name} in ${config.spellName || "template"}`);

		await applyTemplateEffect(templateDoc, token, trigger);
	}
}

/**
 * Process token movement for enter/leave detection
 * @param {TokenDocument} tokenDoc - The token that moved
 * @param {Object} changes - The changes from the update (for accurate new coordinates)
 */
async function processTokenMovement(tokenDoc, changes) {
	const previousPos = _previousTokenPositions.get(tokenDoc.id);
	_previousTokenPositions.delete(tokenDoc.id);

	if (!previousPos) return;

	const token = tokenDoc.object || canvas.tokens?.get(tokenDoc.id);
	if (!token) return;

	// Get templates at old and new positions

	// Use changes for the new center (tokenDoc may be stale)
	const gridSize = tokenDoc.parent?.grid?.size || canvas.grid.size || 100;

	const newX = changes?.x ?? tokenDoc.x;
	const newY = changes?.y ?? tokenDoc.y;

	const newCenter = {
		x: newX + ((tokenDoc.width * gridSize) / 2),
		y: newY + ((tokenDoc.height * gridSize) / 2),
	};

	// Resolve level IDs and elevations from stored previous state and incoming changes
	const prevLevel     = previousPos.level     ?? null;
	const prevElevation = previousPos.elevation  ?? 0;
	const newLevel = changes?.level !== undefined
		? (changes.level ?? null)
		: (tokenDoc.level ?? null);
	const newElevation = changes?.elevation !== undefined
		? (changes.elevation ?? 0)
		: (tokenDoc.elevation ?? 0);

	const oldTemplates = getTemplatesContainingPoint(previousPos.x, previousPos.y, tokenDoc.parent,
		prevLevel, prevElevation);
	const newTemplates = getTemplatesContainingPoint(newCenter.x,   newCenter.y,   tokenDoc.parent,
		newLevel,  newElevation);


	// Find entered templates
	const enteredTemplates = newTemplates.filter(t => !oldTemplates.some(ot => ot.id === t.id));

	// Find left templates
	const leftTemplates = oldTemplates.filter(t => !newTemplates.some(nt => nt.id === t.id));


	// Process entered templates
	for (const templateDoc of enteredTemplates) {
		const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
		if (!config?.enabled) continue;

		if (config.triggers?.onEnter) {
			console.log(`shadowdark-extras | Token ${token.name} entered template ${config.spellName || "template"}`);
			await applyTemplateEffect(templateDoc, token, "enter");
		}

		// Update contained tokens list
		const contained = templateDoc.flags?.[MODULE_ID]?.containedTokens || [];
		if (!contained.includes(tokenDoc.id)) {
			await templateDoc.setFlag(MODULE_ID, "containedTokens", [...contained, tokenDoc.id]);
		}
	}

	// Process left templates
	for (const templateDoc of leftTemplates) {
		const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
		if (!config?.enabled) continue;

		if (config.triggers?.onLeave) {
			console.log(`shadowdark-extras | Token ${token.name} left template ${config.spellName || "template"}`);
			// Apply effects (damage, etc.) configured for the template
			await applyTemplateEffect(templateDoc, token, "leave");
			// Remove lingering effects (conditions)
			await removeTemplateEffects(templateDoc, token);
		}

		// Update contained tokens list
		const contained = templateDoc.flags?.[MODULE_ID]?.containedTokens || [];
		await templateDoc.setFlag(MODULE_ID, "containedTokens", contained.filter(id => id !== tokenDoc.id));
	}
}

/**
 * Apply template effect (damage and/or conditions) to a token
 * Respects the autoApplyDamage combat setting
 * @param {MeasuredTemplateDocument} templateDoc - The template
 * @param {Token} token - The token to affect
 * @param {Token} token - The token to affect
 * @param {string} trigger - The trigger type ('enter', 'turnStart', 'turnEnd')
 */

/**
 * Trigger template effects for tokens caught at placement time.
 * Guarded because Foundry v14 template/region creation can be observed from both
 * the document create hook and the cast flow that already knows affected tokens.
 */
export async function processTemplateCreationEffects(templateDoc, tokensOverride = null) {
	const config = templateDoc.flags?.[MODULE_ID]?.templateEffects;
	if (!config?.enabled || !config.triggers?.onCreation) return;

	const key = templateDoc.uuid || templateDoc.id;
	if (_creationEffectsProcessed.has(key)) return;

	const tokens = Array.isArray(tokensOverride)
		? tokensOverride
		: getTokensInTemplate(templateDoc);
	if (!tokens.length) return;

	_creationEffectsProcessed.add(key);
	console.log(`shadowdark-extras | Triggering onCreation effects for new template ${config.spellName || "template"}`);
	for (const token of tokens) {
		await applyTemplateEffect(templateDoc, token, "creation");
	}
}


/**
 * Apply condition effects from template
 */


// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Decide whether a token (identified by its level ID from token.document.level)
 * is on the same scene level as a template/region document.
 *
 * region.levels is an array of Level._id strings (Foundry stores it as a Set
 * internally but it originates as an array). "defaultLevel0000" is always
 * present and means "no restriction" — filter it out before checking.
 *
 * @param {string|null} tokenLevelId - token.document.level (the Level _id)
 * @param {Document} templateDoc     - the template or region document
 */


/**
 * Build the templateEffects flag-data object (no I/O — pure).
 *
 * Returns the shape that's written to `templateDoc.flags[MODULE_ID].templateEffects`,
 * OR null when the config is disabled. Used by the v14 path where the flag must
 * be written at template creation time (Foundry v14 silently drops post-create
 * setFlag on MeasuredTemplate documents as part of the template→region deprecation).
 *
 * @param {Object} config - The effect configuration from the spell
 * @returns {Object|null}
 */
export function buildTemplateEffectsFlag(config) {
	if (!config?.enabled) return null;
	return {
		enabled: true,
		spellName: config.spellName || "Spell",
		casterActorId: config.casterActorId,
		casterTokenId: config.casterTokenId,
		triggers: {
			onCreation: config.onCreation || false,
			onEnter: config.onEnter || false,
			onTurnStart: config.onTurnStart || false,
			onTurnEnd: config.onTurnEnd || false,
			onLeave: config.onLeave || false,
		},
		damage: {
			formula: config.damageFormula || "",
			type: config.damageType || "",
		},
		save: {
			enabled: config.saveEnabled || false,
			dcFormula: config.saveDCFormula || config.saveDC?.toString() || "10",
			ability: config.saveAbility || "dex",
			halfOnSuccess: config.halfOnSuccess || false,
		},
		casterData: {
			spellcastingCheck: config.spellcastingCheckTotal || 0,
			level: config.casterLevel || 1,
			abilities: config.casterAbilities || {},
		},
		effects: config.effects || [],
		excludeCaster: config.excludeCaster || false,
		runItemMacro: config.runItemMacro || false,
		spellId: config.spellId || null,
		initialEnterTriggered: config.initialEnterTriggered || false,
		effectsRequirement: config.effectsRequirement || "",
	};
}

/**
 * Store template effect configuration on a template (SD 3.x / pre-v14 path).
 * Call this when placing a template from a spell with effects configured.
 *
 * @deprecated v14 silently drops post-create setFlag on MeasuredTemplate documents.
 *   Prefer `buildTemplateEffectsFlag(config)` and include the result in templateData.flags
 *   passed to createEmbeddedDocuments (the v14-safe path).
 *
 * @param {MeasuredTemplateDocument} templateDoc - The template
 * @param {Object} config - The effect configuration from the spell
 */
export async function setupTemplateEffectFlags(templateDoc, config) {
	if (!config?.enabled) return;

	await templateDoc.setFlag(MODULE_ID, "templateEffects", {
		enabled: true,
		spellName: config.spellName || "Spell",
		casterActorId: config.casterActorId,
		casterTokenId: config.casterTokenId,
		triggers: {
			onCreation: config.onCreation || false,
			onEnter: config.onEnter || false,
			onTurnStart: config.onTurnStart || false,
			onTurnEnd: config.onTurnEnd || false,
			onLeave: config.onLeave || false,
		},
		damage: {
			formula: config.damageFormula || "",
			type: config.damageType || "",
		},
		save: {
			enabled: config.saveEnabled || false,
			dcFormula: config.saveDCFormula || config.saveDC?.toString() || "10",  // Store as formula string
			ability: config.saveAbility || "dex",
			halfOnSuccess: config.halfOnSuccess || false,
		},
		// Store caster data for formula evaluation
		casterData: {
			spellcastingCheck: config.spellcastingCheckTotal || 0,
			level: config.casterLevel || 1,
			abilities: config.casterAbilities || {},
		},
		effects: config.effects || [],
		excludeCaster: config.excludeCaster || false,
		runItemMacro: config.runItemMacro || false,
		spellId: config.spellId || null,
		initialEnterTriggered: config.initialEnterTriggered || false,
		effectsRequirement: config.effectsRequirement || "",
	});

	// Store initial contained tokens
	const tokens = getTokensInTemplate(templateDoc);
	if (tokens.length > 0) {
		await templateDoc.setFlag(MODULE_ID, "containedTokens", tokens.map(t => t.id));
	}

	console.log(`shadowdark-extras | Template effect flags set for ${config.spellName}`);
}

// Public surface preserved (Phase 5.3 lane-C split re-exports).
export { getTokensInTemplate, getTemplatesContainingToken };
export { applyTemplateEffect };
