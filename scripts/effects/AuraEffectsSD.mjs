/**
 * Aura Effects System for Shadowdark Extras
 * Token-attached effects that follow the bearer with damage, saves, and conditions
 *
 * Features:
 * - Attach aura to caster or target
 * - Triggers: onEnter, onLeave, turnStart, turnEnd
 * - Apply damage with saves
 * - Apply/remove Active Effects
 * - Animation with customizable tint
 * - Respects autoApplyDamage setting
 */

import { MODULE_ID } from "./aura-constants.mjs";
import {
	createAuraOnActor,
	deleteAuraRegion,
	removeExistingAurasForSource,
} from "./aura-regions.mjs";
import { getSocket } from "../combat/CombatSettingsSD.mjs";
import {
	getActiveAuras,
	getTokensInAura,
	isTokenInAura,
	checkAuraVisibility,
	checkDisposition,
	isPositionInAuraAtPosition,
	isCanvasAvailable,
} from "./aura-geometry.mjs";
import {
	_auraInsideState,
	_auraMembership,
	_recentAuraTriggers,
	getAuraInsideStateKey,
	hasAuraAppliedToToken,
} from "./aura-state.mjs";
import { removeTokenMagicFilter } from "./aura-tokenmagic.mjs";
import {
	applyAuraEffect,
	rollAuraSave,
	applyAuraDamage,
	applyAuraConditions,
	removeAuraEffectsFromToken,
	removeAuraEffectsFromAll,
	createAuraEffectMessage,
} from "./aura-application.mjs";

// Track which tokens have been affected by which auras this turn
const _auraAffectedThisTurn = new Map();

// Track previous token positions for enter/leave detection
const _previousPositions = new Map();

// Avoid repeated cleanup jobs/log spam for orphaned aura effects.
const _staleAuraCleanupQueued = new Set();

// Prevent duplicate aura creation when Foundry re-renders the same cast message.


/**
 * Initialize the aura effects system
 * Call this from the main module during 'ready' hook
 */
export function initAuraEffects() {

	// Aura geometry is canvas-derived from end to end: token placeables and
	// their centers, grid size, wall/edge collision for line of sight, and the
	// visibility API. A client running with the canvas disabled (the core
	// "noCanvas" setting — e.g. an always-on headless relay GM) has none of
	// them, and these handlers gate on isGM rather than the ACTIVE GM, so such
	// a client runs them and throws on every token move, wall edit and scene
	// change. Any other connected GM still processes auras normally, so
	// standing down here loses no behaviour and avoids duplicate processing.
	if (game.settings.get("core", "noCanvas")) {
		console.log(`${MODULE_ID} | Aura effects inactive on this client: running without a canvas.`);
		return;
	}

	// Track token positions before movement
	Hooks.on("preUpdateToken", (tokenDoc, changes, options, userId) => {
		if (!isCanvasAvailable()) return;
		if (changes.x !== undefined || changes.y !== undefined) {
			// Get the token placeable to access its current center
			const token = canvas.tokens.get(tokenDoc.id);
			const center = token ? token.center : {
				x: tokenDoc.x + ((tokenDoc.width * canvas.grid.size) / 2),
				y: tokenDoc.y + ((tokenDoc.height * canvas.grid.size) / 2),
			};


			_previousPositions.set(tokenDoc.id, {
				x: tokenDoc.x,
				y: tokenDoc.y,
				center: center,
			});
		}
	});

	// Process token movement for enter/leave triggers
	Hooks.on("updateToken", async (tokenDoc, changes, options, userId) => {
		if (changes.x === undefined && changes.y === undefined) return;
		if (!game.user.isGM) return;
		if (!isCanvasAvailable()) return;

		// Process token moving through existing auras
		await processAuraMovement(tokenDoc, changes);

		// Process other tokens if this token is an aura bearer
		await processAuraSourceMovement(tokenDoc, changes);

		// Remove the previous position after all processing is done
		_previousPositions.delete(tokenDoc.id);
	});

	// Clear per-turn tracking when combat advances
	Hooks.on("updateCombat", async (combat, changes, options, userId) => {
		if (changes.turn !== undefined || changes.round !== undefined) {
			_auraAffectedThisTurn.clear();
			_recentAuraTriggers.clear();
		}

		if (!game.user.isGM) return;
		if (changes.turn === undefined && changes.round === undefined) return;
		if (!isCanvasAvailable()) return;

		// Process turn-based aura effects
		await processAuraTurnEffects(combat, changes);
	});

	// Handle interactive aura card buttons
	Hooks.on("renderChatMessageHTML", (message, html, context) => {
		const card = html.querySelector(".sdx-aura-effect-card");
		if (!card) return;

		// Apply Damage button
		card.querySelector(".sdx-aura-apply-damage")?.addEventListener("click", async ev => {
			ev.preventDefault();

			const targetId = card.dataset.targetTokenId;
			const formula = card.dataset.damageFormula;

			const targetToken = canvas.tokens.get(targetId);
			if (!targetToken) return ui.notifications.warn("shadowdark-extras | Target token not found on canvas");

			const config = {
				damage: { formula: formula },
				save: { halfOnSuccess: card.dataset.halfDamage === "true" },
			};

			// If not GM, execute via socket to avoid permission issues
			if (!game.user.isGM) {
				const socket = getSocket();
				if (socket) {
					socket.executeAsGM("applyAuraDamageViaGM", {
						targetTokenId: targetId,
						config: config,
						savedSuccessfully: false,
					});
				}
			}
			else {
				// Apply full damage when clicking this button (GM)
				let auraActor = game.actors.get(card.dataset.auraActorId);
				if (!auraActor) auraActor = canvas.tokens.get(card.dataset.auraActorId)?.actor;

				await applyAuraDamage(targetToken, config, false);
			}

			// Create reporting message
			const sourceId = card.dataset.sourceTokenId;
			const sourceToken = canvas.tokens.get(sourceId);
			const auraName = card.querySelector("strong")?.innerText || "Aura";

			await createAuraEffectMessage(sourceToken || targetToken, targetToken, "manual", {
				damage: config.damage.formula, // formula for now (no roll result over socket)
				auraName: auraName,
				manualAction: "Damage Applied",
			});
		});

		// Roll Save button
		card.querySelector(".sdx-aura-roll-save")?.addEventListener("click", async ev => {
			ev.preventDefault();

			const targetId = card.dataset.targetTokenId;
			const dc = card.dataset.saveDc;
			const ability = card.dataset.saveAbility;

			const targetToken = canvas.tokens.get(targetId);
			if (!targetToken?.actor) return ui.notifications.warn("shadowdark-extras | Target actor not found");

			const config = {
				save: {
					enabled: true,
					dc: dc,
					ability: ability,
				},
			};

			const saveResult = await rollAuraSave(targetToken.actor, config.save);

			const sourceId = card.dataset.sourceTokenId;
			const sourceToken = canvas.tokens.get(sourceId);
			const auraName = card.querySelector("strong")?.innerText || "Aura";

			await createAuraEffectMessage(sourceToken || targetToken, targetToken, "manual", {
				saveResult: saveResult,
				saved: saveResult.success,
				auraName: auraName,
			});
		});

		// Apply Effects button
		card.querySelector(".sdx-aura-apply-effects")?.addEventListener("click", async ev => {
			ev.preventDefault();

			const targetId = card.dataset.targetTokenId;
			const auraEffectId = card.dataset.auraEffectId;
			const auraActorId = card.dataset.auraActorId;
			const effectUuids = (card.dataset.effectUuids || "").split(",").filter(u => u);

			const targetToken = canvas.tokens.get(targetId);
			if (!targetToken) return ui.notifications.warn("shadowdark-extras | Target token not found");

			// If not GM, execute via socket to avoid permission issues
			if (!game.user.isGM) {
				const socket = getSocket();
				if (socket) {
					socket.executeAsGM("applyAuraConditionsViaGM", {
						auraEffectId: auraEffectId,
						auraEffectActorId: auraActorId,
						targetTokenId: targetId,
						effectUuids: effectUuids,
					});
				}
			}
			else {
				// GM: apply locally
				let auraActor = game.actors.get(auraActorId);
				if (!auraActor) auraActor = canvas.tokens.get(auraActorId)?.actor;

				const auraEffect = auraActor?.effects.get(auraEffectId);
				if (auraEffect) {
					await applyAuraConditions(auraEffect, targetToken, effectUuids);
				}
				else {
					console.error("shadowdark-extras | Apply Effects: Aura effect not found", { auraActorId, auraEffectId });
				}
			}

			// Create reporting message
			const sourceId = cardElement.data("source-token-id");
			const sourceToken = canvas.tokens.get(sourceId);
			const auraName = cardElement.find("strong").text();

			await createAuraEffectMessage(sourceToken || targetToken, targetToken, "manual", {
				auraName: auraName,
				manualAction: "Condition Applied",
			});
		});
	});

	// Re-evaluate auras when walls change (LOS updates)
	Hooks.on("createWall", wall => {
		if (game.user.isGM) {
			refreshSceneAuras();
		}
	});
	Hooks.on("updateWall", (wall, changes) => {
		if (game.user.isGM && (changes.c !== undefined || changes.ds !== undefined
			|| changes.sense !== undefined)) {
			refreshSceneAuras();
		}
	});
	Hooks.on("deleteWall", wall => {
		if (game.user.isGM) {
			refreshSceneAuras();
		}
	});

	// Also re-evaluate on scene updates that might affect vision/lighting
	Hooks.on("updateScene", (scene, changes) => {
		const hasFogExploration = (changes.fog && ("exploration" in changes.fog)) || ("fogExploration" in changes);
		if (game.user.isGM && (changes.grid !== undefined || changes.padding !== undefined
			|| hasFogExploration)) {
			refreshSceneAuras();
		}
	});

	// Clean up aura Region and applied effects when the source effect is deleted.
	Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
		if (!game.user.isGM) return;

		const auraConfig = effect.flags?.[MODULE_ID]?.aura;
		if (!auraConfig?.enabled) return;

		const staleKey = `${effect.parent?.id || "actor"}:${effect.id}`;
		if (_staleAuraCleanupQueued.has(staleKey)) {
			_staleAuraCleanupQueued.delete(staleKey);
			return;
		}

		await deleteAuraRegion(effect);

		// Remove aura effects from all tokens
		await removeAuraEffectsFromAll(effect);
	});

}

/**
 * Force a re-evaluation of all auras in the scene
 * Useful when walls are added/modified or large-scale changes occur
 */
export async function refreshSceneAuras() {
	if (!game.user.isGM) return;
	if (!isCanvasAvailable()) return;
	const auras = getActiveAuras();
	if (auras.length === 0) return;

	for (const { effect, token: sourceToken, config } of auras) {
		for (const targetToken of canvas.tokens.placeables) {
			// Skip source unless includeSelf
			if (targetToken.id === sourceToken.id && !config.includeSelf) continue;
			if (!targetToken.actor) continue;

			// Check disposition
			if (!checkDisposition(sourceToken, targetToken, config.disposition)) continue;

			// Calculate current state
			let isInside = isTokenInAura(sourceToken, targetToken, config.radius);
			if (isInside && config.checkVisibility) {
				isInside = checkAuraVisibility(sourceToken, targetToken);
			}

			// Check existing membership to see "previous" state. A successful save may
			// leave no Effect item, but the token is still already inside this aura.
			const insideStateKey = getAuraInsideStateKey(sourceToken, targetToken, config, effect);
			const hasEffect = hasAuraAppliedToToken(effect, targetToken, insideStateKey);

			if (!hasEffect && isInside && shouldAnyComponentTrigger(config, "enter")) {
				await applyAuraEffect(sourceToken, targetToken, "enter", config, effect);
			}
			else if (hasEffect && !isInside && config.triggers?.onLeave) {
				await removeAuraEffectsFromToken(effect, targetToken);
			}
			else if (!isInside) {
				// Outside aura: remove TokenMagic filter even without onLeave trigger
				if (config.tokenFilters?.enabled) {
					await removeTokenMagicFilter(targetToken, effect.id);
				}
			}
		}
	}
}


/**
 * Process token movement for aura enter/leave triggers
 * @param {TokenDocument} tokenDoc - The token that moved
 * @param {Object} changes - The changes from updateToken hook containing new x/y values
 */
async function processAuraMovement(tokenDoc, changes = {}) {
	const token = canvas.tokens.get(tokenDoc.id);
	if (!token) return;


	const previousPos = _previousPositions.get(tokenDoc.id);

	// Calculate the NEW center position from changes (which has the NEW values)
	// In Foundry v13, tokenDoc.x/y still has OLD values in updateToken hook
	const newX = changes.x ?? tokenDoc.x;
	const newY = changes.y ?? tokenDoc.y;
	const newCenter = {
		x: newX + ((tokenDoc.width * canvas.grid.size) / 2),
		y: newY + ((tokenDoc.height * canvas.grid.size) / 2),
	};


	const auras = getActiveAuras();

	for (const { effect, token: sourceToken, config } of auras) {
		// Skip if source is the moving token (can't enter/leave own aura)
		if (sourceToken.id === token.id) {
			continue;
		}

		// Check disposition
		if (!checkDisposition(sourceToken, token, config.disposition)) continue;

		// Calculate if inside (including visibility)
		let isInside = isPositionInAuraAtPosition(sourceToken.center, newCenter, config.radius);
		if (isInside && config.checkVisibility) {
			isInside = checkAuraVisibility(sourceToken, token, null, newCenter);
		}

		const insideStateKey = getAuraInsideStateKey(sourceToken, token, config, effect);

		// Check if token currently has the effect/membership from this aura
		const hasEffect = hasAuraAppliedToToken(effect, token, insideStateKey);

		let wasInside = hasEffect;
		if (previousPos?.center) {
			wasInside = isPositionInAuraAtPosition(
				sourceToken.center, previousPos.center, config.radius
			);
			if (wasInside && config.checkVisibility) {
				wasInside = checkAuraVisibility(sourceToken, token, null, previousPos.center);
			}
		}

		if (!wasInside && isInside && shouldAnyComponentTrigger(config, "enter")) {
			await applyAuraEffect(sourceToken, token, "enter", config, effect);
		}
		else if (!isInside && (wasInside || hasEffect)) {
			_auraInsideState.delete(insideStateKey);
			_auraMembership.delete(insideStateKey);
			// Token LEFT the aura. Leaving is cleanup-only; do not roll saves or
			// apply configured effects again.
			if (config.triggers?.onLeave) {
				await removeAuraEffectsFromToken(effect, token);
			}
			// Always remove TokenMagic filters when leaving
			if (config.tokenFilters?.enabled) {
				await removeTokenMagicFilter(token, effect.id);
			}
		}
		else if (!isInside && !hasEffect && config.tokenFilters?.enabled) {
			// Token is outside aura and never had effect - just clean up filters if any
			await removeTokenMagicFilter(token, effect.id);
		}
	}
}

/**
 * Process when an aura SOURCE token moves (the token carrying the aura)
 * This handles enter/leave for all tokens when the aura bearer moves
 * @param {TokenDocument} sourceTokenDoc - The source token that moved
 * @param {Object} changes - The movement changes
 */
async function processAuraSourceMovement(sourceTokenDoc, changes = {}) {
	const sourceToken = canvas.tokens.get(sourceTokenDoc.id);
	if (!sourceToken?.actor) return;

	// Check if this token has an active aura
	const auras = getActiveAuras().filter(a => a.token.id === sourceToken.id);
	if (auras.length === 0) return;

	const previousPos = _previousPositions.get(sourceTokenDoc.id);

	// Calculate old and new source center positions
	const oldSourceCenter = previousPos?.center;
	const newX = changes.x ?? sourceTokenDoc.x;
	const newY = changes.y ?? sourceTokenDoc.y;
	const newSourceCenter = {
		x: newX + ((sourceTokenDoc.width * canvas.grid.size) / 2),
		y: newY + ((sourceTokenDoc.height * canvas.grid.size) / 2),
	};

	for (const { effect, config } of auras) {
		// Check all tokens on the scene
		for (const otherToken of canvas.tokens.placeables) {
			// Skip the source token itself (unless includeSelf)
			if (otherToken.id === sourceToken.id && !config.includeSelf) continue;
			if (!otherToken.actor) continue;

			// Check disposition
			const dispOk = checkDisposition(sourceToken, otherToken, config.disposition);
			if (!dispOk) continue;

			const otherCenter = otherToken.center;

			// Calculate if now inside (relative to new source position)
			let isInside = isPositionInAuraAtPosition(newSourceCenter, otherCenter, config.radius);

			if (isInside && config.checkVisibility) {
				isInside = checkAuraVisibility(
					sourceToken, otherToken, newSourceCenter, otherCenter
				);
			}

			const insideStateKey = getAuraInsideStateKey(sourceToken, otherToken, config, effect);

			// Check if token currently has the effect/membership from this aura
			const hasEffect = hasAuraAppliedToToken(effect, otherToken, insideStateKey);

			let wasInside = hasEffect;
			if (oldSourceCenter) {
				wasInside = isPositionInAuraAtPosition(oldSourceCenter, otherCenter, config.radius);
				if (wasInside && config.checkVisibility) {
					wasInside = checkAuraVisibility(
						sourceToken, otherToken, oldSourceCenter, otherCenter
					);
				}
			}

			if (!wasInside && isInside && shouldAnyComponentTrigger(config, "enter")) {
				await applyAuraEffect(sourceToken, otherToken, "enter", config, effect);
			}
			else if ((wasInside || hasEffect) && !isInside) {
				_auraInsideState.delete(insideStateKey);
				_auraMembership.delete(insideStateKey);
				if (config.triggers?.onLeave) {
					await removeAuraEffectsFromToken(effect, otherToken);
				}
				if (config.tokenFilters?.enabled) {
					await removeTokenMagicFilter(otherToken, effect.id);
				}
			}
			else if (!isInside) {
				// Outside aura: remove TokenMagic filter even without onLeave trigger
				if (config.tokenFilters?.enabled) {
					await removeTokenMagicFilter(otherToken, effect.id);
				}
			}
		}
	}
}


/**
 * Process turn-based aura effects
 * @param {Combat} combat - The combat instance
 * @param {Object} changes - The changes object from updateCombat
 */
async function processAuraTurnEffects(combat, changes) {
	const combatant = combat.combatant;
	console.log(`shadowdark-extras | processAuraTurnEffects: Called for ${combatant?.name}, round=${combat.round}, turn=${combat.turn}, prev=${combat.previous?.combatantId}`);

	const auras = getActiveAuras();
	if (auras.length === 0) return;

	// Check for expired auras and delete them
	// Only GM should do this to avoid race conditions
	if (game.user.isGM) {
		for (const { effect } of auras) {
			const startRound = effect.duration?.startRound;
			const rounds = effect.duration?.rounds;

			if (startRound !== undefined && rounds !== undefined && rounds !== null) {
				const currentRound = combat.round;
				const expiryRound = startRound + rounds;

				if (currentRound >= expiryRound) {
					await effect.delete();
					continue;
				}
			}
		}
	}

	// Process turnEnd for previous combatant FIRST (before checking current token)
	// This ensures we don't skip turnEnd just because the current combatant has no token
	if (combat.previous?.combatantId) {
		const prevCombatant = combat.combatants.get(combat.previous.combatantId);
		const prevToken = prevCombatant?.token ? canvas.tokens.get(prevCombatant.token.id) : null;
		console.log(`shadowdark-extras | handleCombatUpdate: turnEnd for prevToken=${prevToken?.name}`);
		if (prevToken) {
			for (const { effect, token: sourceToken, config } of auras) {
				// Case 1: Source Turn End - prev combatant IS the aura source
				// Check both standard triggers AND component-specific triggers
				const hasSourceTurnEnd = config.triggers?.onSourceTurnEnd
                    || config.damageTriggers?.onSourceTurnEnd
                    || config.effectsTriggers?.onSourceTurnEnd
                    || config.macroTriggers?.onSourceTurnEnd;
				if (sourceToken.id === prevToken.id && hasSourceTurnEnd) {
					console.log("shadowdark-extras | handleCombatUpdate: Source Turn End - checking all tokens in aura");
					for (const targetToken of canvas.tokens.placeables) {
						if (targetToken.id === sourceToken.id && !config.includeSelf) continue;
						if (!targetToken.actor) continue;
						if (!isTokenInAura(sourceToken, targetToken, config.radius)) continue;
						if (!checkDisposition(sourceToken, targetToken, config.disposition)) {
							continue;
						}
						if (config.checkVisibility
							&& !checkAuraVisibility(sourceToken, targetToken)
						) {
							continue;
						}

						console.log(`shadowdark-extras | handleCombatUpdate: Source Turn End applying to ${targetToken.name}`);
						await applyAuraEffect(sourceToken, targetToken, "sourceTurnEnd", config, effect);
					}
				}

				// Case 2: Target Turn End - prev combatant is inside an aura
				// Check both standard triggers AND component-specific triggers
				const hasTargetTurnEnd = config.triggers?.onTargetTurnEnd
                    || config.damageTriggers?.onTargetTurnEnd
                    || config.effectsTriggers?.onTargetTurnEnd
                    || config.macroTriggers?.onTargetTurnEnd;
				if (hasTargetTurnEnd) {
					console.log(`shadowdark-extras | handleCombatUpdate: Checking Target Turn End for ${prevToken.name} in ${effect.name}`);
					if (sourceToken.id === prevToken.id && !config.includeSelf) {
						console.log("shadowdark-extras | handleCombatUpdate: Target Turn End skipped (self)");
						continue;
					}
					const inAura = isTokenInAura(sourceToken, prevToken, config.radius);
					console.log(`shadowdark-extras | handleCombatUpdate: Target Turn End inAura=${inAura}`);
					if (!inAura) continue;
					if (!checkDisposition(sourceToken, prevToken, config.disposition)) continue;
					if (config.checkVisibility && !checkAuraVisibility(sourceToken, prevToken)) {
						continue;
					}

					console.log(`shadowdark-extras | handleCombatUpdate: Target Turn End applying to ${prevToken.name}`);
					await applyAuraEffect(sourceToken, prevToken, "targetTurnEnd", config, effect);
				}
			}
		}
	}

	// Process turnStart for current combatant (only if current combatant has a token)
	if (!combatant?.token) return;
	const currentToken = canvas.tokens.get(combatant.token.id);
	if (!currentToken) return;

	for (const { effect, token: sourceToken, config } of auras) {
		// Case 1: Source Turn Start - current combatant IS the aura source
		// Check both standard triggers AND component-specific triggers
		const hasSourceTurnStart = config.triggers?.onSourceTurnStart
            || config.damageTriggers?.onSourceTurnStart
            || config.effectsTriggers?.onSourceTurnStart
            || config.macroTriggers?.onSourceTurnStart;
		if (sourceToken.id === currentToken.id && hasSourceTurnStart) {
			console.log("shadowdark-extras | handleCombatUpdate: Source Turn Start - checking all tokens in aura");
			for (const targetToken of canvas.tokens.placeables) {
				if (targetToken.id === sourceToken.id && !config.includeSelf) continue;
				if (!targetToken.actor) continue;
				if (!isTokenInAura(sourceToken, targetToken, config.radius)) continue;
				if (!checkDisposition(sourceToken, targetToken, config.disposition)) continue;
				if (config.checkVisibility && !checkAuraVisibility(sourceToken, targetToken)) {
					continue;
				}

				// Prevent duplicate processing
				const key = `${effect.id}-${targetToken.id}-sourceTurnStart`;
				if (_auraAffectedThisTurn.has(key)) continue;
				_auraAffectedThisTurn.set(key, true);

				console.log(`shadowdark-extras | handleCombatUpdate: Source Turn Start applying to ${targetToken.name}`);
				await applyAuraEffect(sourceToken, targetToken, "sourceTurnStart", config, effect);
			}
		}

		// Case 2: Target Turn Start - current combatant is inside an aura
		// Check both standard triggers AND component-specific triggers
		const hasTargetTurnStart = config.triggers?.onTargetTurnStart
            || config.damageTriggers?.onTargetTurnStart
            || config.effectsTriggers?.onTargetTurnStart
            || config.macroTriggers?.onTargetTurnStart;
		if (hasTargetTurnStart) {
			if (sourceToken.id === currentToken.id && !config.includeSelf) continue;
			if (!isTokenInAura(sourceToken, currentToken, config.radius)) continue;
			if (!checkDisposition(sourceToken, currentToken, config.disposition)) continue;
			if (config.checkVisibility && !checkAuraVisibility(sourceToken, currentToken)) continue;

			// Prevent duplicate processing
			const key = `${effect.id}-${currentToken.id}-targetTurnStart`;
			if (_auraAffectedThisTurn.has(key)) continue;
			_auraAffectedThisTurn.set(key, true);

			console.log(`shadowdark-extras | handleCombatUpdate: Target Turn Start applying to ${currentToken.name}`);
			await applyAuraEffect(sourceToken, currentToken, "targetTurnStart", config, effect);
		}
	}
}


/**
 * Check if at least one component of the aura should trigger for this event
 * @param {Object} config - Aura configuration
 * @param {string} eventType - 'enter', 'turnStart', or 'turnEnd'
 * @returns {boolean}
 */
export function shouldAnyComponentTrigger(config, eventType) {
	const key = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`;

	// Standard trigger
	if (config.triggers?.[key]) return true;

	// Damage
	if (config.damage?.formula && config.damageTriggers?.[key]) return true;

	// Effects
	if (config.applyConfiguredEffects && config.effects?.length > 0 && config.effectsTriggers
		?.[key]) return true;

	// Macro
	if (config.runItemMacro && config.macroTriggers?.[key]) return true;

	// Token filters are applied on enter and removed independently on leave.
	if (eventType === "enter" && config.tokenFilters?.enabled) return true;

	return false;
}


// Public surface preserved (Phase 5.3 lane-C split re-exports).
export { createAuraOnActor, deleteAuraRegion, removeExistingAurasForSource };
export {
	getActiveAuras,
	getTokensInAura,
	isTokenInAura,
	checkAuraVisibility,
	checkDisposition,
};
export {
	applyAuraEffect,
	rollAuraSave,
	applyAuraDamage,
	applyAuraConditions,
	removeAuraEffectsFromToken,
	removeAuraEffectsFromAll,
};
