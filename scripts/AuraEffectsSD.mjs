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

import { getSocket } from "./CombatSettingsSD.mjs";

const MODULE_ID = "shadowdark-extras";

// Track which tokens have been affected by which auras this turn
const _auraAffectedThisTurn = new Map();

// Track previous token positions for enter/leave detection
const _previousPositions = new Map();

// Suppress duplicate aura trigger bursts from repeated movement/update hooks.
const _recentAuraTriggers = new Map();
const AURA_TRIGGER_DEDUPE_MS = 1000;

// Track tokens currently inside each logical aura to avoid repeated enter triggers.
const _auraInsideState = new Set();

// Track aura membership even when a save prevents configured effects from being applied.
const _auraMembership = new Set();

// Avoid repeated cleanup jobs/log spam for orphaned aura effects.
const _staleAuraCleanupQueued = new Set();

// Prevent duplicate aura creation when Foundry re-renders the same cast message.
const _auraCreationInFlight = new Set();

/**
 * Apply TokenMagic filter to a token when entering an aura
 * @param {Token} token - The token to apply filter to
 * @param {string} presetName - The TokenMagic preset name
 * @param {string} auraEffectId - The aura effect ID for tracking
 */
async function applyTokenMagicFilter(token, presetName, auraEffectId) {

    if (!presetName) {
        return;
    }
    if (!game.modules.get('tokenmagic')?.active) {
        return;
    }

    try {
        const preset = getTokenMagicMainPresetParams(presetName);
        if (!(Array.isArray(preset) && preset.length)) {
            console.warn(`shadowdark-extras | TokenMagic preset '${presetName}' not found`);
            return;
        }

        // Create a unique filter ID for this aura so we can remove it later
        const filterId = `sdx-aura-${auraEffectId}`;
        await removeAllSdxAuraTokenMagicFilters(token);

        // Clone the preset and add our custom filter ID
        const params = preset.map((p, index) => {
            const originalFilterId = p.filterId || p.filterType || index;
            return {
                ...p,
                filterId: `${filterId}-${originalFilterId}`
            };
        });

        await TokenMagic.addUpdateFilters(token, params);
    } catch (e) {
        console.error("shadowdark-extras | Error applying TokenMagic filter:", e);
    }
}

function getTokenMagicMainPresetParams(presetName) {
    const name = String(presetName || '');
    if (!name) return null;

    try {
        const presets = game.settings.get('tokenmagic', 'presets') || [];
        const match = Array.isArray(presets)
            ? presets.find(p => p?.name === name && p?.library === 'tmfx-main')
            : null;
        if (Array.isArray(match?.params)) return foundry.utils.deepClone(match.params);
    } catch (e) {
        // Fall through to the public list fallback.
    }

    try {
        const presets = TokenMagic.getPresets?.('tmfx-main') || [];
        const match = Array.isArray(presets) ? presets.find(p => p?.name === name) : null;
        if (Array.isArray(match?.params)) return foundry.utils.deepClone(match.params);
    } catch (e) {
        // No usable TokenMagic preset source.
    }

    return null;
}

function getTokenMagicFilterIds(token) {
    const flags = token.document?.getFlag?.('tokenmagic', 'filters') || [];
    if (!Array.isArray(flags)) return [];

    return flags
        .flatMap(flag => [
            flag?.tmFilters?.tmFilterId,
            flag?.tmFilterId,
            flag?.filterId,
            flag?.id
        ])
        .filter(id => typeof id === 'string');
}

async function removeAllSdxAuraTokenMagicFilters(token) {
    if (!game.modules.get('tokenmagic')?.active) return;

    const filterIds = getTokenMagicFilterIds(token)
        .filter(id => id.startsWith('sdx-aura-'));

    for (const id of filterIds) {
        await TokenMagic.deleteFilters(token, id);
    }
}

/**
 * Remove TokenMagic filter from a token when leaving an aura
 * @param {Token} token - The token to remove filter from
 * @param {string} auraEffectId - The aura effect ID for tracking
 */
async function removeTokenMagicFilter(token, auraEffectId) {

    if (!game.modules.get('tokenmagic')?.active) {
        return;
    }

    try {
        const filterId = `sdx-aura-${auraEffectId}`;

        const filterIds = getTokenMagicFilterIds(token)
            .filter(id => id.startsWith(filterId));

        for (const id of filterIds) {
            await TokenMagic.deleteFilters(token, id);
        }
    } catch (e) {
        console.error("shadowdark-extras | Error removing TokenMagic filter:", e);
    }
}

function shouldKeepAnySdxAuraTokenMagicFilter(token, removedAuraEffect) {
    try {
        for (const { effect, token: sourceToken, config } of getActiveAuras()) {
            if (!effect || effect.id === removedAuraEffect?.id) continue;
            if (!config?.tokenFilters?.enabled) continue;
            if (sourceToken.id === token.id && !config.includeSelf) continue;
            if (!checkDisposition(sourceToken, token, config.disposition)) continue;
            if (config.checkVisibility && !checkAuraVisibility(sourceToken, token)) continue;
            if (isTokenInAura(sourceToken, token, config.radius || 30)) return true;
        }
    } catch (err) {
        console.warn("shadowdark-extras | Could not check remaining aura filters:", err);
    }
    return false;
}

async function syncAuraTrackerTarget(config, targetToken, mode) {
    const casterActorId = config?.casterActorId;
    const trackerType = config?.trackerType;
    const trackerInstanceId = config?.trackerInstanceId;
    if (!(casterActorId && trackerType && trackerInstanceId && targetToken?.actor)) return;

    try {
        const tracker = await import("./FocusSpellTrackerSD.mjs");
        if (trackerType === "focus") {
            if (mode === "enter") {
                await tracker.linkTargetToFocusSpell(casterActorId, trackerInstanceId, targetToken.actor.id, targetToken.id);
            } else if (mode === "leave") {
                await tracker.unlinkTargetFromFocusSpell(casterActorId, trackerInstanceId, targetToken.id, targetToken.actor.id);
            }
        } else if (trackerType === "duration") {
            if (mode === "enter") {
                await tracker.linkTargetToDurationSpell(casterActorId, trackerInstanceId, targetToken.actor.id, targetToken.id);
            } else if (mode === "leave") {
                await tracker.unlinkTargetFromDurationSpell(casterActorId, trackerInstanceId, targetToken.id, targetToken.actor.id);
            }
        }
    } catch (err) {
        console.warn("shadowdark-extras | Failed to sync aura target with spell tracker:", err);
    }
}

/**
 * Whether this client has an initialised canvas with a token layer.
 * Guards the transient case a normal client also hits — canvas not ready yet,
 * or no active scene — which the `noCanvas` check below cannot cover.
 */
function isCanvasAvailable() {
    return !!(canvas?.ready && canvas.tokens);
}

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
                x: tokenDoc.x + (tokenDoc.width * canvas.grid.size) / 2,
                y: tokenDoc.y + (tokenDoc.height * canvas.grid.size) / 2
            };


            _previousPositions.set(tokenDoc.id, {
                x: tokenDoc.x,
                y: tokenDoc.y,
                center: center
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
        card.querySelector(".sdx-aura-apply-damage")?.addEventListener("click", async (ev) => {
            ev.preventDefault();

            const targetId = card.dataset.targetTokenId;
            const formula = card.dataset.damageFormula;

            const targetToken = canvas.tokens.get(targetId);
            if (!targetToken) return ui.notifications.warn("shadowdark-extras | Target token not found on canvas");

            const config = {
                damage: { formula: formula },
                save: { halfOnSuccess: card.dataset.halfDamage === "true" }
            };

            // If not GM, execute via socket to avoid permission issues
            if (!game.user.isGM) {
                const socket = getSocket();
                if (socket) {
                    socket.executeAsGM("applyAuraDamageViaGM", {
                        targetTokenId: targetId,
                        config: config,
                        savedSuccessfully: false
                    });
                }
            } else {
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
                damage: config.damage.formula, // formula for now, or we'd need roll result from socket
                auraName: auraName,
                manualAction: "Damage Applied"
            });
        });

        // Roll Save button
        card.querySelector(".sdx-aura-roll-save")?.addEventListener("click", async (ev) => {
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
                    ability: ability
                }
            };

            const saveResult = await rollAuraSave(targetToken.actor, config.save);

            const sourceId = card.dataset.sourceTokenId;
            const sourceToken = canvas.tokens.get(sourceId);
            const auraName = card.querySelector("strong")?.innerText || "Aura";

            await createAuraEffectMessage(sourceToken || targetToken, targetToken, "manual", {
                saveResult: saveResult,
                saved: saveResult.success,
                auraName: auraName
            });
        });

        // Apply Effects button
        card.querySelector(".sdx-aura-apply-effects")?.addEventListener("click", async (ev) => {
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
                        effectUuids: effectUuids
                    });
                }
            } else {
                // GM: apply locally
                let auraActor = game.actors.get(auraActorId);
                if (!auraActor) auraActor = canvas.tokens.get(auraActorId)?.actor;

                const auraEffect = auraActor?.effects.get(auraEffectId);
                if (auraEffect) {
                    await applyAuraConditions(auraEffect, targetToken, effectUuids);
                } else {
                    console.error("shadowdark-extras | Apply Effects: Aura effect not found", { auraActorId, auraEffectId });
                }
            }

            // Create reporting message
            const sourceId = cardElement.data("source-token-id");
            const sourceToken = canvas.tokens.get(sourceId);
            const auraName = cardElement.find("strong").text();

            await createAuraEffectMessage(sourceToken || targetToken, targetToken, "manual", {
                auraName: auraName,
                manualAction: "Condition Applied"
            });
        });
    });

    // Re-evaluate auras when walls change (LOS updates)
    Hooks.on("createWall", (wall) => {
        if (game.user.isGM) {
            refreshSceneAuras();
        }
    });
    Hooks.on("updateWall", (wall, changes) => {
        if (game.user.isGM && (changes.c !== undefined || changes.ds !== undefined || changes.sense !== undefined)) {
            refreshSceneAuras();
        }
    });
    Hooks.on("deleteWall", (wall) => {
        if (game.user.isGM) {
            refreshSceneAuras();
        }
    });

    // Also re-evaluate on scene updates that might affect vision/lighting
    Hooks.on("updateScene", (scene, changes) => {
        const hasFogExploration = (changes.fog && ("exploration" in changes.fog)) || ("fogExploration" in changes);
        if (game.user.isGM && (changes.grid !== undefined || changes.padding !== undefined || hasFogExploration)) {
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

            if (!hasEffect && isInside && shouldAnyComponentTrigger(config, 'enter')) {
                await applyAuraEffect(sourceToken, targetToken, "enter", config, effect);
            } else if (hasEffect && !isInside && config.triggers?.onLeave) {
                await removeAuraEffectsFromToken(effect, targetToken);
            } else if (!isInside) {
                // Token is outside aura - always remove TokenMagic filter even if onLeave trigger isn't configured
                if (config.tokenFilters?.enabled) {
                    await removeTokenMagicFilter(targetToken, effect.id);
                }
            } else {
            }
        }
    }
}

/**
 * Get all active aura effects on the scene
 * @returns {Array} Array of {effect, token, config} objects
 */
export function getActiveAuras() {
    const auras = [];
    const seenAuras = new Set();
    if (!isCanvasAvailable()) return auras;

    for (const token of canvas.tokens.placeables) {
        if (!token.actor) continue;

        // Check all effects on the actor for aura configurations
        const effects = token.actor.effects || [];
        for (const effect of effects) {
            const auraConfig = effect.flags?.[MODULE_ID]?.aura;
            if (auraConfig?.enabled) {
                const auraKey = `${token.id}:${auraConfig.spellId || effect.origin || effect.id}`;
                if (seenAuras.has(auraKey)) continue;
                seenAuras.add(auraKey);
                auras.push({
                    effect: effect,
                    token: token,
                    config: auraConfig
                });
            }
        }
    }

    return auras;
}

/**
 * Get tokens within an aura's radius
 * @param {Token} sourceToken - The token with the aura
 * @param {number} radiusFeet - Radius in feet
 * @param {string} disposition - 'ally', 'enemy', or 'all'
 * @param {boolean} includeSelf - Whether to include the source token
 * @returns {Token[]} Array of tokens within the aura
 */
export function getTokensInAura(sourceToken, radiusFeet, disposition = 'all', includeSelf = false) {
    const tokens = [];
    if (!isCanvasAvailable()) return tokens;
    const gridDistance = canvas.scene.grid.distance || 5; // feet per grid unit
    const radiusPixels = (radiusFeet / gridDistance) * canvas.grid.size;

    const sourceCenter = sourceToken.center;

    for (const token of canvas.tokens.placeables) {
        if (!token.actor) continue;
        if (!includeSelf && token.id === sourceToken.id) continue;

        // Check disposition
        if (disposition !== 'all') {
            const sourceDisp = sourceToken.document.disposition;
            const tokenDisp = token.document.disposition;

            if (disposition === 'ally' && sourceDisp !== tokenDisp) continue;
            if (disposition === 'enemy' && sourceDisp === tokenDisp) continue;
        }

        // Calculate distance from source center to token center
        const tokenCenter = token.center;
        const distance = Math.hypot(tokenCenter.x - sourceCenter.x, tokenCenter.y - sourceCenter.y);

        if (distance <= radiusPixels) {
            tokens.push(token);
        }
    }

    return tokens;
}

/**
 * Check if a token is within an aura
 * @param {Token} sourceToken - The aura source token
 * @param {Token} testToken - The token to test
 * @param {number} radiusFeet - Radius in feet
 * @returns {boolean}
 */
function isTokenInAura(sourceToken, testToken, radiusFeet) {
    // Safety check for missing center properties
    if (!sourceToken?.center || !testToken?.center) {
        return false;
    }

    const gridDistance = canvas.scene.grid.distance || 5;
    const radiusPixels = (radiusFeet / gridDistance) * canvas.grid.size;

    const distance = Math.hypot(
        testToken.center.x - sourceToken.center.x,
        testToken.center.y - sourceToken.center.y
    );

    return distance <= radiusPixels;
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
        x: newX + (tokenDoc.width * canvas.grid.size) / 2,
        y: newY + (tokenDoc.height * canvas.grid.size) / 2
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
            wasInside = isPositionInAuraAtPosition(sourceToken.center, previousPos.center, config.radius);
            if (wasInside && config.checkVisibility) {
                wasInside = checkAuraVisibility(sourceToken, token, null, previousPos.center);
            }
        }

        if (!wasInside && isInside && shouldAnyComponentTrigger(config, 'enter')) {
            await applyAuraEffect(sourceToken, token, 'enter', config, effect);
        } else if (!isInside && (wasInside || hasEffect)) {
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
        } else if (!isInside && !hasEffect && config.tokenFilters?.enabled) {
            // Token is outside aura and never had effect - just clean up filters if any
            await removeTokenMagicFilter(token, effect.id);
        } else {
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
        x: newX + (sourceTokenDoc.width * canvas.grid.size) / 2,
        y: newY + (sourceTokenDoc.height * canvas.grid.size) / 2
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
                isInside = checkAuraVisibility(sourceToken, otherToken, newSourceCenter, otherCenter);
            }

            const insideStateKey = getAuraInsideStateKey(sourceToken, otherToken, config, effect);

            // Check if token currently has the effect/membership from this aura
            const hasEffect = hasAuraAppliedToToken(effect, otherToken, insideStateKey);

            let wasInside = hasEffect;
            if (oldSourceCenter) {
                wasInside = isPositionInAuraAtPosition(oldSourceCenter, otherCenter, config.radius);
                if (wasInside && config.checkVisibility) {
                    wasInside = checkAuraVisibility(sourceToken, otherToken, oldSourceCenter, otherCenter);
                }
            }

            if (!wasInside && isInside && shouldAnyComponentTrigger(config, 'enter')) {
                await applyAuraEffect(sourceToken, otherToken, 'enter', config, effect);
            } else if ((wasInside || hasEffect) && !isInside) {
                _auraInsideState.delete(insideStateKey);
                _auraMembership.delete(insideStateKey);
                if (config.triggers?.onLeave) {
                    await removeAuraEffectsFromToken(effect, otherToken);
                }
                if (config.tokenFilters?.enabled) {
                    await removeTokenMagicFilter(otherToken, effect.id);
                }
            } else if (!isInside) {
                // Token is outside aura - always remove TokenMagic filter even if onLeave trigger isn't configured
                if (config.tokenFilters?.enabled) {
                    await removeTokenMagicFilter(otherToken, effect.id);
                }
            }
        }
    }
}

/**
 * Check if a position is within aura range of a source position (for source movement)
 */
function isPositionInAuraAtPosition(sourceCenter, testCenter, radiusFeet) {
    const gridDistance = canvas.grid.distance || canvas.scene?.grid?.distance || 5;
    const radiusPixels = (radiusFeet / gridDistance) * canvas.grid.size;
    const distance = Math.hypot(testCenter.x - sourceCenter.x, testCenter.y - sourceCenter.y);
    return distance <= radiusPixels;
}

/**
 * Check if the aura source can see the target token
 * @param {Token} sourceToken - The token carrying the aura
 * @param {Token} targetToken - The target token
 * @param {Object} [fromPosition] - Optional position to check from (instead of sourceToken.center)
 * @param {Object} [toPosition] - Optional position to check to (instead of targetToken.center)
 * @returns {boolean} - True if visible or if visibility check should be bypassed
 */
function checkAuraVisibility(sourceToken, targetToken, fromPosition = null, toPosition = null) {
    const startPos = fromPosition || sourceToken.center;
    const endPos = toPosition || (targetToken.getCenterPoint ? targetToken.getCenterPoint() : targetToken.center);

    // 1. Primary Foundry Visibility Check (V11/V12/V13)
    const visibilityApi = canvas.visibility || canvas.effects?.visibility;
    if (visibilityApi?.testVisibility) {
        const isVisible = visibilityApi.testVisibility(endPos, { object: sourceToken });
        if (isVisible) {
            return true;
        }
    }

    // 2. Wall collision fallback (Sight-blocking Ray Casting)
    // We check from center to center as primary
    let isBlocked = false;
    if (window.foundry?.canvas?.geometry?.Ray) {
        // V13 check
        if (CONFIG.Canvas?.polygonBackends?.sight?.testCollision) {
            isBlocked = CONFIG.Canvas.polygonBackends.sight.testCollision(startPos, endPos, { mode: "any", type: "sight" });
        } else if (canvas.edges?.testCollision) {
            isBlocked = canvas.edges.testCollision(startPos, endPos, { mode: "any", type: "sight" });
        }
    } else if (canvas.walls?.checkCollision) {
        // Fallback for V11/V12
        const RayClass = foundry.canvas?.geometry?.Ray || globalThis.Ray;
        const ray = new RayClass(startPos, endPos);
        isBlocked = canvas.walls.checkCollision(ray, { mode: "any", type: "sight" });
    }

    // If center is blocked, try a tiny offset to avoid snapping issues at wall edges
    if (isBlocked) {
        const offset = 2;
        const offsets = [
            { x: offset, y: 0 }, { x: -offset, y: 0 }, { x: 0, y: offset }, { x: 0, y: -offset }
        ];

        for (const off of offsets) {
            const testEnd = { x: endPos.x + off.x, y: endPos.y + off.y };
            let secondaryBlocked = true;
            if (CONFIG.Canvas?.polygonBackends?.sight?.testCollision) {
                secondaryBlocked = CONFIG.Canvas.polygonBackends.sight.testCollision(startPos, testEnd, { mode: "any", type: "sight" });
            } else if (canvas.edges?.testCollision) {
                secondaryBlocked = canvas.edges.testCollision(startPos, testEnd, { mode: "any", type: "sight" });
            } else if (canvas.walls?.checkCollision) {
                const RayClass = foundry.canvas?.geometry?.Ray || globalThis.Ray;
                secondaryBlocked = canvas.walls.checkCollision(new RayClass(startPos, testEnd), { mode: "any", type: "sight" });
            }

            if (!secondaryBlocked) {
                return true;
            }
        }
    }

    return !isBlocked;
}

/**
 * Check if a position is within an aura
 */
function isTokenInAuraAtPosition(sourceToken, position, radiusFeet) {
    const gridDistance = canvas.scene.grid.distance || 5;
    const radiusPixels = (radiusFeet / gridDistance) * canvas.grid.size;

    const distance = Math.hypot(
        position.x - sourceToken.center.x,
        position.y - sourceToken.center.y
    );

    return distance <= radiusPixels;
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
                // Case 1: Source Turn End - previous combatant IS the aura source -> apply to all tokens in range
                // Check both standard triggers AND component-specific triggers
                const hasSourceTurnEnd = config.triggers?.onSourceTurnEnd ||
                    config.damageTriggers?.onSourceTurnEnd ||
                    config.effectsTriggers?.onSourceTurnEnd ||
                    config.macroTriggers?.onSourceTurnEnd;
                if (sourceToken.id === prevToken.id && hasSourceTurnEnd) {
                    console.log(`shadowdark-extras | handleCombatUpdate: Source Turn End - checking all tokens in aura`);
                    for (const targetToken of canvas.tokens.placeables) {
                        if (targetToken.id === sourceToken.id && !config.includeSelf) continue;
                        if (!targetToken.actor) continue;
                        if (!isTokenInAura(sourceToken, targetToken, config.radius)) continue;
                        if (!checkDisposition(sourceToken, targetToken, config.disposition)) continue;
                        if (config.checkVisibility && !checkAuraVisibility(sourceToken, targetToken)) continue;

                        console.log(`shadowdark-extras | handleCombatUpdate: Source Turn End applying to ${targetToken.name}`);
                        await applyAuraEffect(sourceToken, targetToken, 'sourceTurnEnd', config, effect);
                    }
                }

                // Case 2: Target Turn End - previous combatant is inside an aura -> apply to that combatant only
                // Check both standard triggers AND component-specific triggers
                const hasTargetTurnEnd = config.triggers?.onTargetTurnEnd ||
                    config.damageTriggers?.onTargetTurnEnd ||
                    config.effectsTriggers?.onTargetTurnEnd ||
                    config.macroTriggers?.onTargetTurnEnd;
                if (hasTargetTurnEnd) {
                    console.log(`shadowdark-extras | handleCombatUpdate: Checking Target Turn End for ${prevToken.name} in ${effect.name}`);
                    if (sourceToken.id === prevToken.id && !config.includeSelf) {
                        console.log(`shadowdark-extras | handleCombatUpdate: Target Turn End skipped (self)`);
                        continue;
                    }
                    const inAura = isTokenInAura(sourceToken, prevToken, config.radius);
                    console.log(`shadowdark-extras | handleCombatUpdate: Target Turn End inAura=${inAura}`);
                    if (!inAura) continue;
                    if (!checkDisposition(sourceToken, prevToken, config.disposition)) continue;
                    if (config.checkVisibility && !checkAuraVisibility(sourceToken, prevToken)) continue;

                    console.log(`shadowdark-extras | handleCombatUpdate: Target Turn End applying to ${prevToken.name}`);
                    await applyAuraEffect(sourceToken, prevToken, 'targetTurnEnd', config, effect);
                }
            }
        }
    }

    // Process turnStart for current combatant (only if current combatant has a token)
    if (!combatant?.token) return;
    const currentToken = canvas.tokens.get(combatant.token.id);
    if (!currentToken) return;

    for (const { effect, token: sourceToken, config } of auras) {
        // Case 1: Source Turn Start - current combatant IS the aura source -> apply to all tokens in range
        // Check both standard triggers AND component-specific triggers
        const hasSourceTurnStart = config.triggers?.onSourceTurnStart ||
            config.damageTriggers?.onSourceTurnStart ||
            config.effectsTriggers?.onSourceTurnStart ||
            config.macroTriggers?.onSourceTurnStart;
        if (sourceToken.id === currentToken.id && hasSourceTurnStart) {
            console.log(`shadowdark-extras | handleCombatUpdate: Source Turn Start - checking all tokens in aura`);
            for (const targetToken of canvas.tokens.placeables) {
                if (targetToken.id === sourceToken.id && !config.includeSelf) continue;
                if (!targetToken.actor) continue;
                if (!isTokenInAura(sourceToken, targetToken, config.radius)) continue;
                if (!checkDisposition(sourceToken, targetToken, config.disposition)) continue;
                if (config.checkVisibility && !checkAuraVisibility(sourceToken, targetToken)) continue;

                // Prevent duplicate processing
                const key = `${effect.id}-${targetToken.id}-sourceTurnStart`;
                if (_auraAffectedThisTurn.has(key)) continue;
                _auraAffectedThisTurn.set(key, true);

                console.log(`shadowdark-extras | handleCombatUpdate: Source Turn Start applying to ${targetToken.name}`);
                await applyAuraEffect(sourceToken, targetToken, 'sourceTurnStart', config, effect);
            }
        }

        // Case 2: Target Turn Start - current combatant is inside an aura -> apply to that combatant only
        // Check both standard triggers AND component-specific triggers
        const hasTargetTurnStart = config.triggers?.onTargetTurnStart ||
            config.damageTriggers?.onTargetTurnStart ||
            config.effectsTriggers?.onTargetTurnStart ||
            config.macroTriggers?.onTargetTurnStart;
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
            await applyAuraEffect(sourceToken, currentToken, 'targetTurnStart', config, effect);
        }
    }
}

/**
 * Check if token matches disposition filter
 */
function checkDisposition(sourceToken, targetToken, disposition) {
    if (disposition === 'all') return true;

    const sourceDisp = sourceToken.document.disposition;
    const targetDisp = targetToken.document.disposition;

    if (disposition === 'ally') return sourceDisp === targetDisp;
    if (disposition === 'enemy') return sourceDisp !== targetDisp;

    return true;
}

/**
 * Check if a specific component (damage, effects, macro) should trigger
 * @param {Object} componentTriggers - Component-specific triggers
 * @param {Object} standardTriggers - Standard aura triggers
 * @param {string} eventType - 'enter', 'sourceTurnStart', 'sourceTurnEnd', 'targetTurnStart', 'targetTurnEnd'
 * @returns {boolean}
 */
function shouldTriggerComponent(componentTriggers, standardTriggers, eventType) {
    const key = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`;

    // Check if any specific triggers are enabled for this component
    const anySpecific = componentTriggers && Object.values(componentTriggers).some(v => v === true);

    if (anySpecific) {
        return !!componentTriggers[key];
    }

    return !!standardTriggers[key];
}

/**
 * Check if at least one component of the aura should trigger for this event
 * @param {Object} config - Aura configuration
 * @param {string} eventType - 'enter', 'turnStart', or 'turnEnd'
 * @returns {boolean}
 */
function shouldAnyComponentTrigger(config, eventType) {
    const key = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`;

    // Standard trigger
    if (config.triggers?.[key]) return true;

    // Damage
    if (config.damage?.formula && config.damageTriggers?.[key]) return true;

    // Effects
    if (config.applyConfiguredEffects && config.effects?.length > 0 && config.effectsTriggers?.[key]) return true;

    // Macro
    if (config.runItemMacro && config.macroTriggers?.[key]) return true;

    // Token filters are applied on enter and removed independently on leave.
    if (eventType === 'enter' && config.tokenFilters?.enabled) return true;

    return false;
}

function shouldSuppressDuplicateAuraTrigger(auraEffect, targetToken, trigger) {
    const key = `${auraEffect?.id || "aura"}:${targetToken?.id || "token"}:${trigger}`;
    const now = Date.now();
    const last = _recentAuraTriggers.get(key) || 0;
    if (now - last < AURA_TRIGGER_DEDUPE_MS) return true;

    _recentAuraTriggers.set(key, now);

    for (const [storedKey, storedAt] of _recentAuraTriggers.entries()) {
        if (now - storedAt > AURA_TRIGGER_DEDUPE_MS * 5) _recentAuraTriggers.delete(storedKey);
    }

    return false;
}

function getAuraInsideStateKey(sourceToken, targetToken, config, auraEffect) {
    const logicalAuraId = config?.spellId || auraEffect?.origin || auraEffect?.id || "aura";
    return `${sourceToken?.id || "source"}:${logicalAuraId}:${targetToken?.id || "target"}`;
}

function hasAuraAppliedToToken(auraEffect, token, insideStateKey = null) {
    const actor = token?.actor;
    if (!actor) return false;

    if (insideStateKey && _auraMembership.has(insideStateKey)) return true;

    const hasEffectItem = actor.items.some(i =>
        i.type === "Effect" &&
        i.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
    );
    if (hasEffectItem) return true;

    return actor.effects.some(e =>
        e.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
    );
}

function sanitizeClonedAuraEffectData(effectData, auraEffect) {
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

function clearAuraMembershipForToken(auraEffect, token) {
    const auraConfig = auraEffect?.flags?.[MODULE_ID]?.aura || {};
    const logicalAuraId = auraConfig.spellId || auraEffect?.origin || auraEffect?.id || "aura";
    const suffix = `:${logicalAuraId}:${token?.id || "target"}`;

    for (const key of [..._auraInsideState]) {
        if (key.endsWith(suffix)) _auraInsideState.delete(key);
    }

    for (const key of [..._auraMembership]) {
        if (key.endsWith(suffix)) _auraMembership.delete(key);
    }
}

async function getCurrentAuraTokenFilters(sourceToken, config, auraEffect) {
    const snapshot = config?.tokenFilters || auraEffect?.flags?.[MODULE_ID]?.aura?.tokenFilters || {};
    const region = getAuraRegionForEffect(auraEffect);
    const regionFilters = region?.flags?.[MODULE_ID]?.tokenFilters || null;
    const usesNativeRegion = (config?.nativeRegion || auraEffect?.flags?.[MODULE_ID]?.aura?.nativeRegion)?.enabled !== false;
    const selected = regionFilters?.enabled && regionFilters?.preset
        ? regionFilters
        : (usesNativeRegion ? {} : snapshot);

    console.log("shadowdark-extras | aura token filter debug", {
        sourceToken: sourceToken?.name,
        auraEffectId: auraEffect?.id,
        auraEffectName: auraEffect?.name,
        regionId: auraEffect?.flags?.[MODULE_ID]?.aura?.regionId,
        regionName: region?.name,
        regionSdxFlags: region?.flags?.[MODULE_ID],
        usesNativeRegion,
        hasRegion: !!region,
        regionTokenFilters: regionFilters,
        effectTokenFilters: auraEffect?.flags?.[MODULE_ID]?.aura?.tokenFilters,
        runtimeTokenFilters: config?.tokenFilters,
        selectedTokenFilters: selected
    });

    return selected || {};
}

function getAuraRegionForEffect(auraEffect) {
    const scene = canvas?.scene;
    const auraConfig = auraEffect?.flags?.[MODULE_ID]?.aura;
    if (!scene || !auraConfig) return null;

    const regions = [...(scene.regions || [])];
    const regionId = auraConfig.regionId;
    const region = (regionId ? regions.find(r => r.id === regionId) : null)
        || regions.find(r =>
            r.flags?.[MODULE_ID]?.auraRegion &&
            r.flags?.[MODULE_ID]?.auraEffectId === auraEffect.id
        );

    return region || null;
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
                auraEffectActorId: auraEffect.parent?.id
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
    if (trigger === 'enter') {
        if (_auraInsideState.has(insideStateKey)) {
            console.log(`shadowdark-extras | applyAuraEffect: repeated enter suppressed for ${targetToken.name}`);
            return;
        }
        _auraInsideState.add(insideStateKey);
        _auraMembership.add(insideStateKey);
    } else if (trigger === 'leave') {
        _auraInsideState.delete(insideStateKey);
        _auraMembership.delete(insideStateKey);
    }

    // Skip if target is source and includeSelf is false
    if (sourceToken.id === targetToken.id && !config.includeSelf) {
        console.log(`shadowdark-extras | applyAuraEffect: Self-target skipped (includeSelf=false)`);
        return;
    }

    const actor = targetToken.actor;
    if (!actor) {
        console.log(`shadowdark-extras | applyAuraEffect: No actor for target, skipping.`);
        return;
    }

    if (trigger === 'enter') {
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
    } catch (e) {
    }

    const triggerEffects = shouldTriggerComponent(config.effectsTriggers, config.triggers, trigger);
    console.log("shadowdark-extras | applyAuraEffect effects debug", {
        trigger,
        triggerEffects,
        autoApplyConditions,
        applyConfiguredEffects: config.applyConfiguredEffects,
        effects: config.effects,
        effectsTriggers: config.effectsTriggers,
        save: config.save
    });

    // If auto-apply damage is OFF, OR if auto-apply conditions is OFF (and we have effects), create interactive card
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
                auraName: auraEffect.name
            });
            return;
        }
    }

    // Apply damage if configured
    if (triggerDamage && config.damage?.formula) {
        console.log(`shadowdark-extras | applyAuraEffect: Rolling damage...`);
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
        damageApplied ||
        saveResult ||
        (triggerEffects && config.effects?.length > 0) ||
        (config.runItemMacro && triggerMacro)
    );
    if (hasReportableOutcome) {
        await createAuraEffectMessage(sourceToken, targetToken, trigger, {
            damage: damageApplied,
            saved: savedSuccessfully,
            saveResult: saveResult,
            halfDamage: savedSuccessfully && config.save?.halfOnSuccess,
            damageType: config.damage?.type,
            auraName: auraEffect.name
        });
    }
}

/**
 * Roll a save against an aura effect
 */
export async function rollAuraSave(actor, saveConfig) {
    const ability = saveConfig.ability || 'dex';
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
        modifier: modifier
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
    } catch (err) {
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
                    uuid: effectUuid
                });
            }

            const documentName = effectDoc.documentName || effectDoc.constructor?.documentName || "";
            const isActiveEffect = documentName === "ActiveEffect";

            // Check if already has this effect from this aura (by name + aura origin flag)
            const existingItem = actor.items.find(i =>
                i.type === "Effect" &&
                i.name === effectDoc.name &&
                i.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
            );
            const existingActiveEffect = actor.effects.find(e =>
                e.name === effectDoc.name &&
                e.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
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
                    effect: effectDoc.name
                });
            } else {
                // Shadowdark condition/effect rows are Effect Items with embedded transfer effects.
                await actor.createEmbeddedDocuments("Item", [effectData]);
                console.log("shadowdark-extras | Applied aura Effect item", {
                    aura: auraEffect.name,
                    target: token.name,
                    effect: effectDoc.name
                });
            }
        } catch (err) {
            console.error(`shadowdark-extras | Error applying aura condition:`, err);
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
                targetTokenId: token.id
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
        i.type === "Effect" &&
        i.flags?.[MODULE_ID]?.auraOrigin === auraEffect.id
    );

    if (itemsToRemove.length > 0) {
        const ids = itemsToRemove.map(i => i.id);
        await actor.deleteEmbeddedDocuments("Item", ids);
    } else {
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
                auraEffectActorId: auraEffect.parent?.id
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
async function runAuraItemMacro(sourceToken, targetToken, trigger, config) {
    try {
        const casterActor = sourceToken.actor;
        if (!casterActor) return;

        const spellItem = casterActor.items.get(config.spellId);
        if (!spellItem) return;

        // Import the native macro executor
        const { executeItemMacro, hasItemMacro } = await import("./shadowdark-extras.mjs");
        if (!hasItemMacro(spellItem)) return;

        const args = {
            trigger: trigger,
            sourceToken: sourceToken,
            config: config,
            casterActor: casterActor,
            isAura: true
        };

        return executeItemMacro(spellItem, {
            actor: targetToken.actor,
            token: targetToken,
            args: args
        });
    } catch (err) {
        console.error(`shadowdark-extras | Error running aura item macro:`, err);
    }
}

/**
 * Create interactive card for aura effect (when autoApply is OFF)
 */
async function createInteractiveAuraCard(sourceToken, targetToken, trigger, config, auraEffect) {
    // Similar to template interactive cards
    const triggerName = {
        enter: "entered",
        turnStart: "started turn in",
        turnEnd: "ended turn in"
    }[trigger] || trigger;

    const content = `
        <div class="shadowdark chat-card sdx-aura-effect-card" style="background: #1a1a1a; border-radius: 6px; padding: 8px; color: #e0e0e0;"
             data-source-token-id="${sourceToken.id}"
             data-target-token-id="${targetToken.id}"
             data-aura-effect-id="${auraEffect.id}"
             data-aura-actor-id="${auraEffect.parent?.id}"
             data-effect-uuids="${(config.effects || []).join(',')}"
             data-damage-formula="${config.damage?.formula || ''}"
             data-save-dc="${config.save?.dc || ''}"
             data-save-ability="${config.save?.ability || ''}"
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
                <span><i class="fas fa-dice-d6"></i> ${config.damage.formula} ${config.damage.type || ''}</span>
                <button type="button" class="sdx-aura-apply-damage" style="width: auto; height: 24px; line-height: 24px; font-size: 12px; padding: 0 8px;">
                    Apply Damage
                </button>
            </div>` : ''}

            ${config.save?.enabled ? `
            <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <span><i class="fas fa-shield-alt"></i> DC ${config.save.dc} ${config.save.ability?.toUpperCase()}</span>
                <button type="button" class="sdx-aura-roll-save" style="width: auto; height: 24px; line-height: 24px; font-size: 12px; padding: 0 8px;">
                    Roll Save
                </button>
            </div>` : ''}

            ${config.effects?.length > 0 ? `
            <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <span><i class="fas fa-magic"></i> Apply Conditions</span>
                <button type="button" class="sdx-aura-apply-effects" style="width: auto; height: 24px; line-height: 24px; font-size: 12px; padding: 0 8px;">
                    Apply Effect
                </button>
            </div>` : ''}
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
async function createAuraEffectMessage(sourceToken, targetToken, trigger, result) {
    const triggerName = {
        enter: "entered the aura",
        turnStart: "started turn in the aura",
        turnEnd: "ended turn in the aura",
        manual: result.manualAction || "interacted with the aura"
    }[trigger] || trigger;

    let content = `
        <div class="shadowdark chat-card" style="background: #1a1a1a; border-radius: 6px; padding: 8px; color: #e0e0e0;">
            <strong>${result.auraName || 'Aura'}</strong>
            <p>${targetToken.name} ${triggerName}</p>
    `;

    if (result.saveResult) {
        const saveClass = result.saved ? 'color: #4a4' : 'color: #a44';
        content += `<p style="${saveClass}">Save: ${result.saveResult.total} vs DC ${result.saveResult.dc} - ${result.saved ? 'SUCCESS' : 'FAILED'}</p>`;
    }

    if (result.damage) {
        content += `<p>Damage: ${result.damage} ${result.damageType || ''}</p>`;
    }

    content += '</div>';

    await ChatMessage.create({
        content: content,
        speaker: ChatMessage.getSpeaker({ token: sourceToken.document }),
    });
}

function getAuraBearerToken(actor, bearerTokenId = null) {
    if (!canvas?.tokens) return null;
    if (bearerTokenId) {
        const explicit = canvas.tokens.get(bearerTokenId);
        if (explicit?.actor?.id === actor?.id) return explicit;
    }
    return canvas.tokens.placeables.find(t => t.actor?.id === actor?.id) || null;
}

async function createAuraRegion(token, effect, config, sourceItem) {
    try {
        if (!game.user.isGM) return null;

        const tokenDoc = token?.document;
        if (!tokenDoc?.persisted || !canvas?.scene) return null;

        const RegionDocument = foundry.documents?.RegionDocument?.implementation ?? foundry.documents?.RegionDocument;
        if (typeof RegionDocument?.createTokenEmanation !== "function") return null;

        const nativeRegion = config.nativeRegion || {};
        const color = nativeRegion.color || "#ffffff";
        const radius = Number(config.radius) || 30;
        const auraRegionVisibility = CONST.REGION_VISIBILITY?.LAYER_UNLOCKED ?? 4;

        const region = await RegionDocument.createTokenEmanation(tokenDoc, radius, {
            name: `${sourceItem.name} (Aura)`,
            color,
            visibility: auraRegionVisibility,
            restriction: {
                enabled: true,
                type: "move",
                priority: 0
            },
            hidden: !!tokenDoc.hidden,
            locked: false,
            flags: {
                [MODULE_ID]: {
                    auraRegion: true,
                    auraEffectId: effect.id,
                    auraActorId: effect.parent?.id,
                    sourceItemUuid: sourceItem.uuid,
                    tokenFilters: foundry.utils.deepClone(config.tokenFilters || {})
                }
            }
        }, {
            excludeToken: false,
            gridBased: false
        });

        if (region) {
            await region.update({
                [`flags.${MODULE_ID}.auraRegion`]: true,
                [`flags.${MODULE_ID}.auraEffectId`]: effect.id,
                [`flags.${MODULE_ID}.auraActorId`]: effect.parent?.id,
                [`flags.${MODULE_ID}.sourceItemUuid`]: sourceItem.uuid,
                [`flags.${MODULE_ID}.tokenFilters`]: foundry.utils.deepClone(config.tokenFilters || {}),
                visibility: auraRegionVisibility,
                "restriction.enabled": true,
                "restriction.type": "move",
                "restriction.priority": 0
            });
            await effect.update({ [`flags.${MODULE_ID}.aura.regionId`]: region.id });
            await applyAuraRegionVisualFx(region, config.visualFx);
        }

        return region;
    } catch (err) {
        console.warn("shadowdark-extras | Failed to create attached aura Region:", err);
        return null;
    }
}

function getTokenMagicTintValue(tint) {
    if (!tint) return null;
    if (typeof tint === 'number') return tint;
    const parsed = parseInt(String(tint).replace('#', ''), 16);
    return Number.isFinite(parsed) ? parsed : null;
}

async function applyTokenMagicAuraRegionFx(region, visualFx) {
    const tmfx = visualFx?.tmfx || {};
    const preset = tmfx.preset || 'NOFX';
    if (!(preset && preset !== 'NOFX')) return;
    if (!game.modules.get('tokenmagic')?.active || !globalThis.TokenMagic?.addFilters) return;

    await region.update({
        'flags.tokenmagic.regionData': { opacity: Number(tmfx.opacity ?? 0.5) }
    });

    const tintValue = getTokenMagicTintValue(tmfx.tint);
    const withTint = (request) => tintValue === null ? request : { ...request, color: tintValue };

    let presetParams = null;
    if (typeof globalThis.TokenMagic.getPreset === 'function') {
        const candidates = [
            { name: preset, library: 'tmfx-region' },
            { name: preset, library: 'tmfx-template' },
            { name: preset, library: 'tmfx-main' },
            preset
        ];

        for (const candidate of candidates) {
            presetParams = globalThis.TokenMagic.getPreset(withTint(candidate));
            if (Array.isArray(presetParams) && presetParams.length) break;
        }

        if (!(Array.isArray(presetParams) && presetParams.length)) {
            try {
                const presets = game.settings.get('tokenmagic', 'presets') || [];
                const match = presets.find(p =>
                    String(p?.name || '').toLowerCase() === String(preset).toLowerCase()
                    && ['tmfx-region', 'tmfx-template', 'tmfx-main'].includes(p?.library)
                );
                if (match) presetParams = globalThis.TokenMagic.getPreset(withTint({ name: match.name, library: match.library }));
            } catch (e) {
                // The setting is not guaranteed to exist across TokenMagic versions.
            }
        }
    }

    if (Array.isArray(presetParams) && presetParams.length) {
        await globalThis.TokenMagic.addFilters(region, presetParams, true);
    } else {
        console.warn(`shadowdark-extras | TokenMagic aura preset not found or has no filters: ${preset}`);
    }
}

function applyIndyFxAuraRegion(region, visualFx) {
    const indyFx = visualFx?.indy || {};
    if (!indyFx.shaderId) return;
    if (!game.modules.get('indy-fx')?.active || typeof game.indyFX?.shaderOnRegion !== 'function') return;

    game.indyFX.shaderOnRegion(region.id, {
        shaderId: indyFx.shaderId,
        layer: indyFx.layer || 'inherit',
        alpha: Number(indyFx.alpha ?? 1),
        speed: Number(indyFx.speed ?? 1),
        scale: Number(indyFx.scale ?? 1),
        scaleX: Number(indyFx.scale ?? 1),
        scaleY: Number(indyFx.scale ?? 1),
        displayTimeMs: 0
    });
}

async function applyAuraRegionVisualFx(region, visualFx) {
    try {
        const engine = visualFx?.engine || 'none';
        if (engine === 'tmfx') await applyTokenMagicAuraRegionFx(region, visualFx);
        else if (engine === 'indy') applyIndyFxAuraRegion(region, visualFx);
    } catch (err) {
        console.warn("shadowdark-extras | Failed to apply aura Region visual FX:", err);
    }
}

async function deleteAuraRegion(effect) {
    try {
        const scene = canvas?.scene;
        if (!scene) return;

        const auraConfig = effect.flags?.[MODULE_ID]?.aura;
        const regionId = auraConfig?.regionId;
        const flaggedRegions = [...(scene.regions || [])].filter(r =>
            r.id === regionId
            || (r.flags?.[MODULE_ID]?.auraRegion && r.flags?.[MODULE_ID]?.auraEffectId === effect.id)
        );

        const ids = flaggedRegions.map(r => r.id);
        if (ids.length) await scene.deleteEmbeddedDocuments("Region", ids);
    } catch (err) {
        console.warn("shadowdark-extras | Failed to delete attached aura Region:", err);
    }
}

async function removeExistingAurasForSource(actor, sourceItem) {
    if (!game.user.isGM || !actor || !sourceItem) return;

    const existing = [...(actor.effects || [])].filter(effect => {
        const auraConfig = effect.flags?.[MODULE_ID]?.aura;
        if (!auraConfig?.enabled) return false;
        return auraConfig.spellId === sourceItem.id || effect.origin === sourceItem.uuid;
    });

    for (const effect of existing) {
        await deleteAuraRegion(effect);
        await removeAuraEffectsFromAll(effect);
    }

    const ids = existing.map(effect => effect.id).filter(Boolean);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/**
 * Create aura effect on an actor
 * @param {Actor} actor - The actor to receive the aura
 * @param {Object} auraConfig - The aura configuration
 * @param {Item} sourceItem - The source item (spell)
 * @returns {ActiveEffect} The created effect
 */
export async function createAuraOnActor(actor, auraConfig, sourceItem, duration = null, expiryRounds = null) {
    const creationKey = `${actor?.id || "actor"}:${sourceItem?.uuid || sourceItem?.id || "source"}`;
    if (_auraCreationInFlight.has(creationKey)) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const existing = [...(actor.effects || [])].find(effect => {
            const existingConfig = effect.flags?.[MODULE_ID]?.aura;
            if (!existingConfig?.enabled) return false;
            return existingConfig.spellId === sourceItem.id || existingConfig.sourceItemUuid === sourceItem.uuid || effect.origin === sourceItem.uuid;
        });
        if (existing) return existing;
    }

    _auraCreationInFlight.add(creationKey);

    try {
        // Snapshot combat state BEFORE the awaited document writes below.
        // Writing actor flags/effects makes game.combat transiently return null
        // for a few hundred ms, so reading it afterwards recorded an undefined
        // start round for the aura.
        const inCombat = !!game.combat;
        const combatId = game.combat?.id ?? null;
        const combatRound = game.combat?.round ?? null;
        const combatTurn = game.combat?.turn ?? null;

        await removeExistingAurasForSource(actor, sourceItem);

        // Generate a unique status ID for this aura
        const auraStatusId = `sdx-aura-${sourceItem.id}`;

        const effectData = {
        name: sourceItem.name + " (Aura)",
        img: sourceItem.img,
        origin: sourceItem.uuid,
        // Add statuses to show as icon on token
        statuses: [auraStatusId],
        // v14 ActiveEffect duration is {value, units, expiry, expired}; combat
        // anchoring moved to a sibling `start`. The old {rounds, startRound,
        // startTime} keys only survive via the legacy migration shim.
        duration: { value: expiryRounds, units: "rounds", expiry: "turnStart" },
        start: inCombat
            ? { combat: combatId, round: combatRound, turn: combatTurn, time: game.time.worldTime }
            : { time: game.time.worldTime },
        flags: {
            [MODULE_ID]: {
                aura: {
                    enabled: true,
                    radius: auraConfig.radius || 30,
                    triggers: auraConfig.triggers || {},
                    damage: auraConfig.damage || {},
                    save: auraConfig.save || {},
                    effects: auraConfig.effects || [],
                    tokenFilters: auraConfig.tokenFilters || {},
                    nativeRegion: auraConfig.nativeRegion || {},
                    visualFx: auraConfig.visualFx || {},
                    disposition: auraConfig.disposition || 'all',
                    includeSelf: auraConfig.includeSelf || false,
                    checkVisibility: auraConfig.checkVisibility || false,
                    applyConfiguredEffects: auraConfig.applyConfiguredEffects || false,
                    effectsTriggers: auraConfig.effectsTriggers || {},
                    damageTriggers: auraConfig.damageTriggers || {},
                    runItemMacro: auraConfig.runItemMacro || false,
                    macroTriggers: auraConfig.macroTriggers || {},
                    spellId: sourceItem.id,
                    sourceItemUuid: sourceItem.uuid,
                    casterActorId: auraConfig.casterActorId || sourceItem.actor?.id || null,
                    trackerType: auraConfig.trackerType || null,
                    trackerInstanceId: auraConfig.trackerInstanceId || null
                }
            }
        }
        };

        const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);

        const bearerToken = getAuraBearerToken(actor, auraConfig.bearerTokenId);
        if (bearerToken && auraConfig.nativeRegion?.enabled !== false) {
            await createAuraRegion(bearerToken, effect, auraConfig, sourceItem);
        }

    // Process initial tokens in aura range (apply effects immediately on creation)
    // IMPORTANT: Use canvas.tokens.placeables to get Token objects (with .center), NOT actor.token (TokenDocument)
    const sourceToken = getAuraBearerToken(actor, auraConfig.bearerTokenId);
    if (sourceToken && shouldAnyComponentTrigger(auraConfig, 'enter')) {

        const config = {
            radius: auraConfig.radius || 30,
            triggers: auraConfig.triggers || {},
            damage: auraConfig.damage || {},
            save: auraConfig.save || {},
            effects: auraConfig.effects || [],
            tokenFilters: auraConfig.tokenFilters || {},
            nativeRegion: auraConfig.nativeRegion || {},
            visualFx: auraConfig.visualFx || {},
            disposition: auraConfig.disposition || 'all',
            includeSelf: auraConfig.includeSelf || false,
            checkVisibility: auraConfig.checkVisibility || false,
            applyConfiguredEffects: auraConfig.applyConfiguredEffects || false,
            effectsTriggers: auraConfig.effectsTriggers || {},
            damageTriggers: auraConfig.damageTriggers || {},
            runItemMacro: auraConfig.runItemMacro || false,
            macroTriggers: auraConfig.macroTriggers || {},
            spellId: sourceItem.id,
            sourceItemUuid: sourceItem.uuid,
            casterActorId: auraConfig.casterActorId || sourceItem.actor?.id || null,
            trackerType: auraConfig.trackerType || null,
            trackerInstanceId: auraConfig.trackerInstanceId || null
        };

        // Get all tokens in scene

        for (const otherToken of canvas.tokens.placeables) {
            // 1. Basic Skip Checks
            if (otherToken.id === sourceToken.id && !config.includeSelf) continue;
            if (!otherToken.actor) continue;

            // 2. Range Check
            const isInRange = isTokenInAura(sourceToken, otherToken, config.radius);
            if (!isInRange) continue;

            // 3. Disposition Check
            const dispOk = checkDisposition(sourceToken, otherToken, config.disposition);
            if (!dispOk) {
                continue;
            }

            // 4. Visibility Check
            if (config.checkVisibility) {
                const isVisible = checkAuraVisibility(sourceToken, otherToken);
                if (!isVisible) {
                    continue;
                }
            }

            await applyAuraEffect(sourceToken, otherToken, 'enter', config, effect);
        }
    } else if (!sourceToken) {
    }

        return effect;
    } finally {
        _auraCreationInFlight.delete(creationKey);
    }
}
