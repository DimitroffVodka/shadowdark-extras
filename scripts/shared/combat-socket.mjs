/**
 * Combat socket registration and the module's socketlib message handlers.
 * Handler names and payloads are compatibility surfaces for combat workflows.
 */

import { endFocusSpell } from "../effects/FocusSpellTrackerSD.mjs";
import { showScrollingText } from "./scrolling-text.mjs";
import { FEATURE_IDS, isFeatureEnabled, anyFeatureEnabled } from "../settings/feature-gates.mjs";

const MODULE_ID = "shadowdark-extras";
let socketlibSocket = null;

export function setupCombatSocket() {
	if (socketlibSocket) {
		// Duplicate-registration guard: registerModule is idempotent, but a
		// second .register("...") pass would throw socketlib "already
		// registered" errors. Once initialized, keep the existing socket.
		return socketlibSocket;
	}

	if (!globalThis.socketlib) {
		console.error("shadowdark-extras | socketlib not found, combat socket cannot be initialized");
		return;
	}

	socketlibSocket = globalThis.socketlib.registerModule(MODULE_ID);

	if (!socketlibSocket) {
		console.error("shadowdark-extras | Failed to register socket module. Make sure 'socket: true' is set in module.json");
		return;
	}
	if (isFeatureEnabled(FEATURE_IDS.DAMAGE_CARDS)) socketlibSocket.register("setTargetDefenseResult", async ({ messageId, tokenId, result }) => {
		const message = game.messages.get(messageId);
		if (!message || !tokenId) return false;

		const current = foundry.utils.deepClone(message.getFlag(MODULE_ID, "targetDefenseResults") || {});
		current[tokenId] = result;
		await message.setFlag(MODULE_ID, "targetDefenseResults", current);
		return true;
	});

	// Register socket handler for applying damage/healing
	if (isFeatureEnabled(FEATURE_IDS.DAMAGE_CARDS)) socketlibSocket.register("applyTokenDamage", async data => {
		const token = canvas.tokens.get(data.tokenId);
		if (!token || !token.actor) {
			console.warn("shadowdark-extras | Token not found:", data.tokenId);
			return false;
		}

		try {
			const currentHp = token.actor.system?.attributes?.hp?.value ?? 0;
			const maxHp = token.actor.system?.attributes?.hp?.max ?? 0;

			// Check for Glassbones effect (double damage)
			const hasGlassbones = token.actor.getFlag("shadowdark-extras", "glassbones");

			let finalDamage = 0;
			// Allow explicit isHealing flag, otherwise infer from negative damage
			const isHealing = data.isHealing || data.damage < 0;
			const isDamage = !isHealing && data.damage > 0;

			// If damageComponents is provided, process each component separately
			// Check if we should use the new component-based damage or legacy damage
			if (((data.damageComponents && data.damageComponents.length > 0)
				|| (data.baseDamage && data.baseDamage > 0)) && isDamage) {

				// 1. Process damage components
				if (data.damageComponents && data.damageComponents.length > 0) {
					for (const component of data.damageComponents) {
						let componentDamage = component.amount || 0;
						const componentType = (component.type || "standard").toLowerCase();
						let isAbsorbed = false;

						// Skip standard damage type (no resistance/immunity/vulnerability applies)
						if (componentType !== "standard" && componentType !== "damage") {
							// Check for absorption FIRST (value -1 = damage becomes healing)
							const absorptionValue = token.actor.getFlag("shadowdark-extras", `absorption.${componentType}`);
							if (absorptionValue === -1 || absorptionValue === true) {
								componentDamage = -componentDamage; // Convert to healing
								isAbsorbed = true;
							}
							else if (absorptionValue === 1) {
								componentDamage = componentDamage * 2; // Double damage
								isAbsorbed = true;
							}

							// Check for immunity (0 damage for this component) - skip if absorbed
							const isImmune = !isAbsorbed && token.actor.getFlag("shadowdark-extras", `immunity.${componentType}`);
							if (isImmune) {
								componentDamage = 0;
							}
							else if (!isAbsorbed) {
								// Check for resistance/vulnerability
								const isResistant = token.actor.getFlag("shadowdark-extras", `resistance.${componentType}`);
								const isVulnerable = token.actor.getFlag("shadowdark-extras", `vulnerability.${componentType}`);

								if (isResistant) {
									componentDamage = Math.floor(componentDamage / 2);
								}
								else if (isVulnerable) {
									componentDamage = componentDamage * 2;
								}
							}
						}

						// Check for physical resistance/immunity/vulnerability
						// Only check if not already absorbed
						if (!isAbsorbed && ["bludgeoning", "slashing", "piercing"].includes(componentType)) {
							const isPhysicalImmune = token.actor.getFlag("shadowdark-extras", "immunity.physical");
							if (isPhysicalImmune) {
								componentDamage = 0;
							}
							else if (componentDamage > 0) {
								const isPhysicalResistant = token.actor.getFlag("shadowdark-extras", "resistance.physical");
								const isPhysicalVulnerable = token.actor.getFlag("shadowdark-extras", "vulnerability.physical");

								if (isPhysicalResistant) {
									componentDamage = Math.floor(componentDamage / 2);
								}
								else if (isPhysicalVulnerable) {
									componentDamage = componentDamage * 2;
								}
							}

							// Check for non-magical weapon resistance/immunity
							if (componentDamage > 0 && !data.isMagicalWeapon) {
								const isNonMagicImmune = token.actor.getFlag("shadowdark-extras", "immunity.nonmagic");
								if (isNonMagicImmune) {
									componentDamage = 0;
								}
								else {
									const isNonMagicResistant = token.actor.getFlag("shadowdark-extras", "resistance.nonmagic");
									if (isNonMagicResistant) {
										componentDamage = Math.floor(componentDamage / 2);
									}
								}
							}
						}

						finalDamage += componentDamage;
					}
				}

				// 2. Process base damage
				if (data.baseDamage && data.baseDamage > 0) {
					let baseDamage = data.baseDamage;
					const baseType = (data.baseDamageType || "standard").toLowerCase();
					let isAbsorbed = false;

					// Apply resistance/immunity/vulnerability to base damage if not standard
					if (baseType !== "standard" && baseType !== "damage") {
						// Check for absorption FIRST
						const absorptionValue = token.actor.getFlag("shadowdark-extras", `absorption.${baseType}`);
						if (absorptionValue === -1 || absorptionValue === true) {
							baseDamage = -baseDamage; // Convert to healing
							isAbsorbed = true;
						}
						else if (absorptionValue === 1) {
							baseDamage = baseDamage * 2; // Double damage
							isAbsorbed = true;
						}

						// Check for immunity - skip if absorbed
						const isImmune = !isAbsorbed && token.actor.getFlag("shadowdark-extras", `immunity.${baseType}`);
						if (isImmune) {
							baseDamage = 0;
						}
						else if (!isAbsorbed) {
							const isResistant = token.actor.getFlag("shadowdark-extras", `resistance.${baseType}`);
							const isVulnerable = token.actor.getFlag("shadowdark-extras", `vulnerability.${baseType}`);

							if (isResistant) {
								baseDamage = Math.floor(baseDamage / 2);
							}
							else if (isVulnerable) {
								baseDamage = baseDamage * 2;
							}
						}

						// Check for physical resistance/immunity/vulnerability
						if (!isAbsorbed && ["bludgeoning", "slashing", "piercing"].includes(baseType)) {
							const isPhysicalImmune = token.actor.getFlag("shadowdark-extras", "immunity.physical");
							if (isPhysicalImmune) {
								baseDamage = 0;
							}
							else if (baseDamage > 0) {
								const isPhysicalResistant = token.actor.getFlag("shadowdark-extras", "resistance.physical");
								const isPhysicalVulnerable = token.actor.getFlag("shadowdark-extras", "vulnerability.physical");

								if (isPhysicalResistant) {
									baseDamage = Math.floor(baseDamage / 2);
								}
								else if (isPhysicalVulnerable) {
									baseDamage = baseDamage * 2;
								}
							}

							// Check for non-magical weapon resistance/immunity
							if (baseDamage > 0 && !data.isMagicalWeapon) {
								const isNonMagicImmune = token.actor.getFlag("shadowdark-extras", "immunity.nonmagic");
								if (isNonMagicImmune) {
									baseDamage = 0;
								}
								else {
									const isNonMagicResistant = token.actor.getFlag("shadowdark-extras", "resistance.nonmagic");
									if (isNonMagicResistant) {
										baseDamage = Math.floor(baseDamage / 2);
									}
								}
							}
						}
					}

					finalDamage += baseDamage;
				}

				// 3. Final global modifiers (like Glassbones)
				if (hasGlassbones && finalDamage > 0) {
					finalDamage = finalDamage * 2;
				}

			}
			else {
				// Legacy behavior: single damage value with single type
				finalDamage = data.damage;
				const effectiveDamageType = (data.baseDamageType || data.damageType || "standard").toLowerCase();

				if (isDamage && effectiveDamageType && effectiveDamageType !== "standard" && effectiveDamageType !== "damage") {
					// Check for absorption FIRST
					const absorptionValue = token.actor.getFlag("shadowdark-extras", `absorption.${effectiveDamageType}`);
					let isAbsorbed = false;
					if (absorptionValue === -1 || absorptionValue === true) {
						finalDamage = -finalDamage; // Convert to healing
						isAbsorbed = true;
					}
					else if (absorptionValue === 1) {
						finalDamage = finalDamage * 2; // Double damage
						isAbsorbed = true;
					}

					// Check for immunity - skip if absorbed
					const isImmune = !isAbsorbed && token.actor.getFlag("shadowdark-extras", `immunity.${effectiveDamageType}`);
					if (isImmune) {
						finalDamage = 0;
					}
					else if (!isAbsorbed) {
						// Check for resistance/vulnerability
						const isResistant = token.actor.getFlag("shadowdark-extras", `resistance.${effectiveDamageType}`);
						const isVulnerable = token.actor.getFlag("shadowdark-extras", `vulnerability.${effectiveDamageType}`);

						if (isResistant) {
							finalDamage = Math.floor(finalDamage / 2);
						}
						else if (isVulnerable) {
							finalDamage = finalDamage * 2;
						}
					}

					// Check for non-magical weapon resistance/immunity
					if (!isAbsorbed && finalDamage > 0 && ["bludgeoning", "slashing", "piercing"].includes(effectiveDamageType) && !data.isMagicalWeapon) {
						const isNonMagicImmune = token.actor.getFlag("shadowdark-extras", "immunity.nonmagic");
						if (isNonMagicImmune) {
							finalDamage = 0;
						}
						else {
							const isNonMagicResistant = token.actor.getFlag("shadowdark-extras", "resistance.nonmagic");
							if (isNonMagicResistant) {
								finalDamage = Math.floor(finalDamage / 2);
							}
						}
					}
				}

				// Glassbones (double damage) - applies after resistance/immunity
				if (hasGlassbones && finalDamage > 0) {
					finalDamage = finalDamage * 2;
				}
			}

			// Negative damage means healing
			// For healing: add the absolute value, for damage: subtract
			// Use the calculated isHealing flag or check final damage
			const isFinalHealing = isHealing || finalDamage < 0;
			const hpChange = isFinalHealing ? Math.abs(finalDamage) : -finalDamage;

			const newHp = Math.max(0, Math.min(maxHp, currentHp + hpChange));


			await token.actor.update({
				"system.attributes.hp.value": newHp,
			});

			// Scrolling combat text is now handled by the updateActor/updateToken hooks
			// so we don't need to call it here anymore

			return true;
		}
		catch(error) {
			console.error("shadowdark-extras | Error in socket damage handler:", error);
			return false;
		}
	});

	// Register socket handler for showing scrolling text on all clients
	if (isFeatureEnabled(FEATURE_IDS.SCROLLING_COMBAT_TEXT)) socketlibSocket.register("showScrollingText", data => {
		const token = canvas.tokens?.get(data.tokenId);
		if (!token) return;

		showScrollingText(token, data.amount, data.isHealing);
	});

	// Register socket handler for applying conditions/effects.
	// Use anyFeatureEnabled rather than .some(isFeatureEnabled): some() passes the
	// array index as the second argument, which isFeatureEnabled reads as the
	// disabled-id list, so every id would test as enabled.
	// DAMAGE_CARDS is an owner too: damage-card.mjs is the only caller of this
	// handler, and the .some() defect above masked its absence from the list.
	if (anyFeatureEnabled(
		FEATURE_IDS.SPELL_ACTIVITY, FEATURE_IDS.PREDEFINED_EFFECTS, FEATURE_IDS.DAMAGE_CARDS
	)) socketlibSocket.register("applyTokenCondition", async data => {
		const token = canvas.tokens.get(data.tokenId);
		if (!token || !token.actor) {
			console.warn("shadowdark-extras | Token not found for condition:", data.tokenId);
			return false;
		}

		try {

			// Get the effect document from UUID
			const effectDoc = await fromUuid(data.effectUuid);
			if (!effectDoc) {
				console.warn("shadowdark-extras | Effect not found:", data.effectUuid);
				return false;
			}

			// Check if this is a non-cumulative effect and target already has it
			// Default to cumulative=true for backward compatibility
			const isCumulative = data.cumulative !== false;
			if (!isCumulative) {
				// Check if target already has an effect with the same source UUID or same name
				const existingEffects = token.actor.items.filter(item => {
					if (item.type !== "Effect") return false;
					// Check by compendium source
					const sourceId = item._stats?.compendiumSource || item.flags?.core?.sourceId;
					if (sourceId === data.effectUuid) return true;
					// Also check by name as fallback
					if (item.name === effectDoc.name) return true;
					return false;
				});

				if (existingEffects.length > 0) {
					// Remove existing effects before applying new one (to reset duration)
					const effectIds = existingEffects.map(e => e.id);
					await token.actor.deleteEmbeddedDocuments("Item", effectIds);
				}
			}

			// Check if the target already has an effect from the same spell and remove it
			// This prevents duplicate effects when casting the same spell on the same target
			if (data.spellInfo?.spellId) {
				const existingEffects = token.actor.items.filter(item => {
					if (item.type !== "Effect") return false;
					// Check if this effect came from the same spell (by matching the
					// compendium source)
					const sourceId = item._stats?.compendiumSource || item.flags?.core?.sourceId;
					return sourceId === data.effectUuid;
				});

				if (existingEffects.length > 0) {
					const effectIds = existingEffects.map(e => e.id);
					await token.actor.deleteEmbeddedDocuments("Item", effectIds);

					// Also clean up the focus spell tracking for the removed effects
					try {
						const { unlinkEffectFromFocusSpell } = await import("../effects/FocusSpellTrackerSD.mjs");
						for (const effectId of effectIds) {
							await unlinkEffectFromFocusSpell(
								data.spellInfo.casterActorId,
								data.spellInfo.spellId,
								effectId
							);
						}
					}
					catch(err) {
						// Focus tracking cleanup is optional
					}
				}
			}

			// Create the Effect Item on the actor
			// This is the correct approach - the Effect Item has transfer: true on its
			// embedded ActiveEffects, which Foundry automatically applies to the actor.
			// This ensures the effect shows up properly
			// in the Effects and Conditions section with correct source attribution.
			const effectData = effectDoc.toObject();

			// Apply duration overrides to embedded effects if provided
			if (data.duration && Object.keys(data.duration).length > 0 && effectData.effects) {
				effectData.effects = effectData.effects.map(effect => {
					// SD 4.x / Foundry v14: effect.duration may expose getter-only fields
					// (e.g. `rounds`), so Object.assign onto it throws. Spread into a fresh
					// plain object instead — reads via getter are fine, writes go to a new obj.
					effect.duration = { ...(effect.duration ?? {}), ...data.duration };
					return effect;
				});
			}

			// Also apply duration to the item's system.duration if it exists
			if (data.duration && effectData.system?.duration) {
				if (data.duration.rounds) {
					effectData.system.duration.value = String(data.duration.rounds);
					effectData.system.duration.type = "rounds";
				}
			}

			const createdItems = await token.actor.createEmbeddedDocuments("Item", [effectData]);

			// Link to focus spell or duration spell if applicable
			if (data.spellInfo && createdItems.length > 0) {
				const createdEffect = createdItems[0];
				try {
					// Import spell tracking functions
					const { linkEffectToFocusSpell, startFocusSpellIfNeeded, linkEffectToDurationSpell, getActiveDurationSpells } = await import("../effects/FocusSpellTrackerSD.mjs");

					// Check if this is a duration spell (non-focus)
					const caster = game.actors.get(data.spellInfo.casterActorId);
					const activeDuration = caster ? getActiveDurationSpells(caster) : [];
					const isDurationSpell = activeDuration.some(
						d => d.spellId === data.spellInfo.spellId
					);

					if (isDurationSpell) {
						// Link to duration spell
						await linkEffectToDurationSpell(
							data.spellInfo.casterActorId,
							data.spellInfo.spellId,
							token.actor.id,
							data.tokenId,
							createdEffect.id
						);
					}
					else {
						// Try focus spell
						// Ensure focus tracking is started (in case it hasn't been started yet)
						await startFocusSpellIfNeeded(
							data.spellInfo.casterActorId,
							data.spellInfo.spellId,
							data.spellInfo.spellName
						);

						// Now link the effect
						await linkEffectToFocusSpell(
							data.spellInfo.casterActorId,
							data.spellInfo.spellId,
							token.actor.id,
							data.tokenId,
							createdEffect.id
						);
					}
				}
				catch(linkError) {
					// Spell tracking might not be enabled, that's okay
				}
			}

			return true;
		}
		catch(error) {
			console.error("shadowdark-extras | Error in socket condition handler:", error);
			return false;
		}
	});

	// Register socket handlers for focus/duration spell operations
	if (isFeatureEnabled(FEATURE_IDS.FOCUS_TRACKER)) socketlibSocket.register("removeTargetEffect", async ({ targetActorId, targetTokenId, effectItemId }) => {
		let targetActor = null;

		// Try to get the actor from the token first (for unlinked tokens)
		if (targetTokenId) {
			const token = canvas.tokens?.get(targetTokenId);
			if (token?.actor) {
				targetActor = token.actor;
			}
		}

		// Fall back to game.actors
		if (!targetActor) {
			targetActor = game.actors.get(targetActorId);
		}

		if (!targetActor) {
			console.warn("shadowdark-extras | removeTargetEffect: target actor not found");
			return false;
		}

		// Check for Item first
		let effectDoc = targetActor.items.get(effectItemId);

		// If not an Item, check for ActiveEffect (e.g. Auras)
		if (!effectDoc) {
			effectDoc = targetActor.effects.get(effectItemId);
		}

		if (!effectDoc) {
			console.warn("shadowdark-extras | removeTargetEffect: effect item/document not found");
			return false;
		}

		await effectDoc.delete();
		return true;
	});

	// Stamp/clear the break-on-damage marker so non-owners (e.g. a player targeting
	// an NPC) can register an effect for auto-removal on the bearer's next HP loss.
	// Flag key ("breakOnDamage") is shared with BreakOnDamageSD.mjs. reason === null clears.
	if (isFeatureEnabled(FEATURE_IDS.BREAK_ON_DAMAGE)) socketlibSocket.register("markBreakOnDamage", async ({ targetActorId, targetTokenId, effectItemId, reason }) => {
		let targetActor = null;

		// Try to get the actor from the token first (for unlinked tokens)
		if (targetTokenId) {
			const token = canvas.tokens?.get(targetTokenId);
			if (token?.actor) {
				targetActor = token.actor;
			}
		}

		// Fall back to game.actors
		if (!targetActor) {
			targetActor = game.actors.get(targetActorId);
		}

		if (!targetActor) {
			console.warn("shadowdark-extras | markBreakOnDamage: target actor not found");
			return false;
		}

		// Check for Item first, then ActiveEffect (e.g. Auras)
		let effectDoc = targetActor.items.get(effectItemId)
			?? targetActor.effects.get(effectItemId);

		if (!effectDoc) {
			console.warn("shadowdark-extras | markBreakOnDamage: effect item/document not found");
			return false;
		}

		if (reason === null) {
			await effectDoc.unsetFlag(MODULE_ID, "breakOnDamage");
		}
		else {
			await effectDoc.setFlag(MODULE_ID, "breakOnDamage", { reason });
		}
		return true;
	});

	if (isFeatureEnabled(FEATURE_IDS.TEMPLATE_EFFECTS)) socketlibSocket.register("applyEffectToTarget", async ({ targetActorId, targetTokenId, effectUuid, casterId, spellId, templateId }) => {
		let targetActor = null;

		// Try to get the actor from the token first (for unlinked tokens)
		if (targetTokenId) {
			const token = canvas.tokens?.get(targetTokenId);
			if (token?.actor) {
				targetActor = token.actor;
			}
		}

		// Fall back to game.actors
		if (!targetActor) {
			targetActor = game.actors.get(targetActorId);
		}

		if (!targetActor) {
			console.warn("shadowdark-extras | applyEffectToTarget: target actor not found");
			return { success: false, effectId: null };
		}

		try {
			const effectDoc = await fromUuid(effectUuid);
			if (!effectDoc) {
				console.warn("shadowdark-extras | applyEffectToTarget: effect not found:", effectUuid);
				return { success: false, effectId: null };
			}

			const effectItemData = effectDoc.toObject();

			// Apply template origin if provided
			if (templateId) {
				effectItemData.flags = effectItemData.flags || {};
				effectItemData.flags[MODULE_ID] = effectItemData.flags[MODULE_ID] || {};
				effectItemData.flags[MODULE_ID].templateOrigin = templateId;
			}

			const createdItems = await targetActor.createEmbeddedDocuments("Item", [effectItemData]);

			if (createdItems.length > 0) {
				const createdEffectId = createdItems[0].id;
				return { success: true, effectId: createdEffectId };
			}

			return { success: false, effectId: null };
		}
		catch(err) {
			console.error("shadowdark-extras | applyEffectToTarget error:", err);
			return { success: false, effectId: null };
		}
	});

	// Register socket handler to end a focus spell
	if (isFeatureEnabled(FEATURE_IDS.FOCUS_TRACKER)) socketlibSocket.register("endFocusSpell", async ({ casterId, spellId, reason }) => {
		await endFocusSpell(casterId, spellId, reason);
		return true;
	});

	// --- Aura Socket Handlers ---

	if (isFeatureEnabled(FEATURE_IDS.AURAS)) socketlibSocket.register("applyAuraEffectViaGM", async ({ sourceTokenId, targetTokenId, trigger, config, auraEffectId, auraEffectActorId }) => {
		const sourceToken = canvas.tokens.get(sourceTokenId);
		const targetToken = canvas.tokens.get(targetTokenId);
		const auraActor = game.actors.get(auraEffectActorId);
		const auraEffect = auraActor?.effects.get(auraEffectId);

		if (!sourceToken || !targetToken || !auraEffect) {
			console.error("shadowdark-extras | applyAuraEffectViaGM: Missing data", { sourceToken, targetToken, auraEffect });
			return;
		}

		const { applyAuraEffect } = await import("../effects/AuraEffectsSD.mjs");
		return applyAuraEffect(sourceToken, targetToken, trigger, config, auraEffect);
	});

	if (isFeatureEnabled(FEATURE_IDS.AURAS)) socketlibSocket.register("removeAuraEffectViaGM", async ({ auraEffectId, auraEffectActorId, targetTokenId }) => {
		const auraActor = game.actors.get(auraEffectActorId);
		const auraEffect = auraActor?.effects.get(auraEffectId);
		const targetToken = canvas.tokens.get(targetTokenId);

		if (!auraEffect || !targetToken) {
			console.error("shadowdark-extras | removeAuraEffectViaGM: Missing data", { auraEffect, targetToken });
			return;
		}

		const { removeAuraEffectsFromToken } = await import("../effects/AuraEffectsSD.mjs");
		return removeAuraEffectsFromToken(auraEffect, targetToken);
	});

	if (isFeatureEnabled(FEATURE_IDS.AURAS)) socketlibSocket.register("applyAuraConditionsViaGM", async ({ auraEffectId, auraEffectActorId, targetTokenId, effectUuids }) => {
		const targetToken = canvas.tokens.get(targetTokenId);
		let auraActor = game.actors.get(auraEffectActorId);

		// Fallback for unlinked/synthetic actors
		if (!auraActor) {
			auraActor = canvas.tokens.get(auraEffectActorId)?.actor;
		}

		const auraEffect = auraActor?.effects.get(auraEffectId);

		if (!targetToken || !auraEffect) {
			console.error("shadowdark-extras | applyAuraConditionsViaGM: Missing data", {
				targetToken: targetToken?.name,
				auraActor: auraActor?.name,
				auraEffect: auraEffect?.name,
				auraEffectId,
				auraEffectActorId,
			});
			return;
		}

		const { applyAuraConditions } = await import("../effects/AuraEffectsSD.mjs");
		return applyAuraConditions(auraEffect, targetToken, effectUuids);
	});

	if (isFeatureEnabled(FEATURE_IDS.AURAS)) socketlibSocket.register("applyAuraDamageViaGM", async ({ targetTokenId, config, savedSuccessfully }) => {
		const targetToken = canvas.tokens.get(targetTokenId);
		if (!targetToken) {
			console.error("shadowdark-extras | applyAuraDamageViaGM: Target token not found", targetTokenId);
			return;
		}

		const { applyAuraDamage } = await import("../effects/AuraEffectsSD.mjs");
		return applyAuraDamage(targetToken, config, savedSuccessfully);
	});

	if (isFeatureEnabled(FEATURE_IDS.AURAS)) socketlibSocket.register("removeAuraEffectsFromAllViaGM", async ({ auraEffectId, auraEffectActorId }) => {
		const auraActor = game.actors.get(auraEffectActorId);
		const auraEffect = auraActor?.effects.get(auraEffectId);

		if (!auraEffect) {
			console.error("shadowdark-extras | removeAuraEffectsFromAllViaGM: Aura effect not found", auraEffectId);
			return;
		}

		const { removeAuraEffectsFromAll } = await import("../effects/AuraEffectsSD.mjs");
		return removeAuraEffectsFromAll(auraEffect);
	});

	// --- Trade Socket Handlers ---
	// These are for player-to-player trade requests using socketlib prompts

	// Handler: Show trade request prompt to target player
	if (isFeatureEnabled(FEATURE_IDS.TRADING)) socketlibSocket.register("showTradeRequestPrompt", async ({ initiatorActorId, targetActorId, initiatorUserId, tradeId }) => {
		const initiatorActor = game.actors.get(initiatorActorId);
		const targetActor = game.actors.get(targetActorId);

		if (!initiatorActor || !targetActor) {
			console.warn(`${MODULE_ID} | Trade request: actors not found`);
			return { accepted: false };
		}

		// Check if this user owns the target actor
		if (!targetActor.isOwner) {
			return { accepted: false };
		}

		// Show confirmation dialog to the target player
		const accepted = await foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.trade.request_title") },
			content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.trade.request_prompt", { player: initiatorActor.name })}</p>`,
			modal: true,
			rejectClose: false,
		});

		return { accepted };
	});

	// Handler: Open trade window on this client
	if (isFeatureEnabled(FEATURE_IDS.TRADING)) socketlibSocket.register("openTradeWindow", async ({ tradeId, localActorId, remoteActorId, isInitiator }) => {
		const localActor = game.actors.get(localActorId);
		const remoteActor = game.actors.get(remoteActorId);

		if (!localActor || !remoteActor) {
			console.warn(`${MODULE_ID} | openTradeWindow: actors not found`);
			return;
		}

		// Check if this user owns the local actor
		if (!localActor.isOwner) {
			return; // Not for this user
		}

		// Dynamically import TradeWindowSD to avoid circular imports
		const { default: TradeWindowSD } = await import("../inventory/TradeWindowSD.mjs");

		// Create and render the trade window
		const tradeWindow = new TradeWindowSD({
			tradeId: tradeId,
			localActor: localActor,
			remoteActor: remoteActor,
			isInitiator: isInitiator,
		});
		tradeWindow.render(true);
	});

	// Handler: Notify initiator that trade was declined
	if (isFeatureEnabled(FEATURE_IDS.TRADING)) socketlibSocket.register("notifyTradeDeclined", async ({ targetActorName }) => {
		ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.trade.declined_by", { player: targetActorName }));
	});

	// --- Spell Dialog Socket Handlers ---
	// These allow the GM to route dialog display back to the originating player
	// when executing macros with runAsGm enabled

	// Handler: Show Holy Weapon dialog on player's client
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("showHolyWeaponDialogForUser", async ({ casterActorId, casterItemId, targetActorId, targetTokenId, isCritical }) => {
		const casterActor = game.actors.get(casterActorId);
		const casterItem = casterActor?.items.get(casterItemId);
		const targetActor = game.actors.get(targetActorId);
		const targetToken = targetTokenId ? canvas.tokens?.get(targetTokenId) : null;

		if (!casterActor || !casterItem || !targetActor) {
			console.warn(`${MODULE_ID} | showHolyWeaponDialogForUser: Missing data`);
			return;
		}

		const sdxModule = game.modules.get(MODULE_ID);
		if (sdxModule?.api?.showHolyWeaponDialog) {
			await sdxModule.api.showHolyWeaponDialog(
				casterActor, casterItem, targetActor, targetToken, null, isCritical
			);
		}
	});

	// Handler: Show Identify dialog on player's client
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("showIdentifyDialogForUser", async ({ targetActorId, unidentifiedItemIds, identifySpellId, casterActorId }) => {
		const casterActor = game.actors.get(casterActorId);
		const targetActor = game.actors.get(targetActorId);
		const identifySpell = casterActor?.items.get(identifySpellId);
		const unidentifiedItems = unidentifiedItemIds?.map(id => targetActor?.items.get(id))
			.filter(Boolean) || [];

		if (!targetActor || unidentifiedItems.length === 0 || !identifySpell) {
			console.warn(`${MODULE_ID} | showIdentifyDialogForUser: Missing data`);
			return;
		}

		const sdxModule = game.modules.get(MODULE_ID);
		if (sdxModule?.api?.showIdentifyDialog) {
			await sdxModule.api.showIdentifyDialog(targetActor, unidentifiedItems, identifySpell);
		}
	});

	// Handler: Show Cleansing Weapon dialog on player's client
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("showCleansingWeaponDialogForUser", async ({ casterActorId, casterItemId, targetActorId, targetTokenId, isCritical }) => {
		const casterActor = game.actors.get(casterActorId);
		const casterItem = casterActor?.items.get(casterItemId);
		const targetActor = game.actors.get(targetActorId);
		const targetToken = targetTokenId ? canvas.tokens?.get(targetTokenId) : null;

		if (!casterActor || !casterItem || !targetActor) {
			console.warn(`${MODULE_ID} | showCleansingWeaponDialogForUser: Missing data`);
			return;
		}

		const sdxModule = game.modules.get(MODULE_ID);
		if (sdxModule?.api?.showCleansingWeaponDialog) {
			await sdxModule.api.showCleansingWeaponDialog(
				casterActor, casterItem, targetActor, targetToken, null, isCritical
			);
		}
	});

	// Handler: Apply Wrath to all weapons on player's client
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("showWrathWeaponDialogForUser", async ({ casterActorId, casterItemId, targetActorId, targetTokenId, isCritical }) => {
		const casterActor = game.actors.get(casterActorId);
		const casterItem = casterActor?.items.get(casterItemId);

		if (!casterActor || !casterItem) {
			console.warn(`${MODULE_ID} | showWrathWeaponDialogForUser: Missing data`);
			return;
		}

		const sdxModule = game.modules.get(MODULE_ID);
		if (sdxModule?.api?.applyWrathToAllWeapons) {
			await sdxModule.api.applyWrathToAllWeapons(casterActor, casterItem, null, isCritical);
		}
	});

	// Handler: Show Shapechanger dialog on player's client
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("showShapechangerDialogForUser", async ({ casterActorId, casterItemId, isCritical, options, targetActorId, targetTokenId }) => {
		const casterActor = game.actors.get(casterActorId);
		const casterItem = casterActor?.items.get(casterItemId);

		if (!casterActor || !casterItem) {
			console.warn(`${MODULE_ID} | showShapechangerDialogForUser: Missing data`);
			return;
		}

		// If a target token was specified (Polymorph), set the player's target to that token
		if (targetTokenId) {
			const targetToken = canvas.tokens?.get(targetTokenId);
			if (targetToken) {
				targetToken.setTarget(true, { releaseOthers: true });
			}
		}

		const sdxModule = game.modules.get(MODULE_ID);
		if (sdxModule?.api?.showShapechangerDialog) {
			await sdxModule.api.showShapechangerDialog(
				casterActor, casterItem, null, isCritical, options || {}
			);
		}
	});

	// Handler: Revert Shapechanger as GM (when player doesn't have ownership)
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("revertShapechangerAsGM", async actorUuid => {
		const actor = await fromUuid(actorUuid);
		if (!actor) {
			console.warn(`${MODULE_ID} | revertShapechangerAsGM: Actor not found: ${actorUuid}`);
			return;
		}

		const sdxModule = game.modules.get(MODULE_ID);
		if (sdxModule?.api?.revertShapechanger) {
			await sdxModule.api.revertShapechanger(actor);
		}
	});

	// Handler: Apply Shapechanger as GM (when player doesn't have ownership)
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("applyShapechangerAsGM", async (actorUuid, itemUuid, npcUuid, isCritical, opts, targetActorUuid, targetTokenUuid) => {
		const casterActor = await fromUuid(actorUuid);
		const casterItem = await fromUuid(itemUuid);
		const npcDoc = await fromUuid(npcUuid);

		// Resolve target actor/token for Polymorph
		let targetActor = targetActorUuid ? await fromUuid(targetActorUuid) : null;
		let targetToken = null;
		if (targetTokenUuid) {
			const tokenDoc = await fromUuid(targetTokenUuid);
			// .object gets the Token placeable from TokenDocument
			targetToken = tokenDoc?.object || null;
		}

		if (casterActor && casterItem && npcDoc) {
			const sdxModule = game.modules.get(MODULE_ID);
			if (sdxModule?.api?.applyShapechanger) {
				await sdxModule.api.applyShapechanger(
					casterActor,
					casterItem,
					npcDoc,
					isCritical,
					opts || {},
					targetActor,
					targetToken
				);
			}
		}
	});

	// --- Spell Modification Reversion Socket Handlers ---
	// These handle reverting spell modifications when the player doesn't own the target item

	// Handler: Revert item modifications (when spell ends)
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("revertItemModificationAsGM", async ({ itemUuid, updates }) => {
		const item = await fromUuid(itemUuid);
		if (!item) {
			console.warn(`${MODULE_ID} | revertItemModificationAsGM: Item not found: ${itemUuid}`);
			return false;
		}

		try {
			await item.update(updates);
			return true;
		}
		catch(err) {
			console.error(`${MODULE_ID} | GM failed to revert item ${item.name}:`, err);
			return false;
		}
	});

	// Handler: Update item flags (for cleaning up modification tracking)
	if (isFeatureEnabled(FEATURE_IDS.ITEM_MACROS)) socketlibSocket.register("updateItemFlagsAsGM", async ({ itemUuid, flagPath, flagValue }) => {
		const item = await fromUuid(itemUuid);
		if (!item) {
			console.warn(`${MODULE_ID} | updateItemFlagsAsGM: Item not found: ${itemUuid}`);
			return false;
		}

		try {
			if (flagValue === null) {
				await item.unsetFlag(MODULE_ID, flagPath);
			}
			else {
				await item.setFlag(MODULE_ID, flagPath, flagValue);
			}
			return true;
		}
		catch(err) {
			console.error(`${MODULE_ID} | GM failed to update item flags for ${item.name}:`, err);
			return false;
		}
	});

	// Cross-owner item transfer ("Transfer to Player"). Runs on the GM so a
	// player can hand an item to a PC they don't own. Replaces the Item Piles
	// dependency — see nativeTransferItems in TradeWindowSD.mjs.
	if (isFeatureEnabled(FEATURE_IDS.PLAYER_TRANSFERS)) socketlibSocket.register("transferItemsAsGM", async ({ sourceActorId, targetActorId, items }) => {
		const sourceActor = game.actors.get(sourceActorId);
		const targetActor = game.actors.get(targetActorId);
		if (!sourceActor || !targetActor) {
			console.warn(`${MODULE_ID} | transferItemsAsGM: actor(s) not found`, { sourceActorId, targetActorId });
			return false;
		}
		try {
			const { nativeTransferItems } = await import("../inventory/TradeWindowSD.mjs");
			await nativeTransferItems(sourceActor, targetActor, items);
			return true;
		}
		catch(err) {
			console.error(`${MODULE_ID} | transferItemsAsGM failed:`, err);
			return false;
		}
	});

	// Cross-owner coin transfer ("Transfer to Player"). Runs on the GM.
	// Replaces the Item Piles dependency — see nativeTransferCoins in TradeWindowSD.mjs.
	if (isFeatureEnabled(FEATURE_IDS.PLAYER_TRANSFERS)) socketlibSocket.register("transferCoinsAsGM", async ({ sourceActorId, targetActorId, coins }) => {
		const sourceActor = game.actors.get(sourceActorId);
		const targetActor = game.actors.get(targetActorId);
		if (!sourceActor || !targetActor) {
			console.warn(`${MODULE_ID} | transferCoinsAsGM: actor(s) not found`, { sourceActorId, targetActorId });
			return false;
		}
		try {
			const { nativeTransferCoins } = await import("../inventory/TradeWindowSD.mjs");
			await nativeTransferCoins(sourceActor, targetActor, coins);
			return true;
		}
		catch(err) {
			console.error(`${MODULE_ID} | transferCoinsAsGM failed:`, err);
			return false;
		}
	});

	// Summoned tokens join the encounter on their summoner's initiative. The
	// caster is usually a player and combatant creation is GM-only, so the client
	// that spawned the tokens hands the write over here.
	//
	// Reachable from addSummonsToCombat inside spawnSummonedCreatures, which the
	// damage-card pipeline and the NPC-feature item-macro path both call — the
	// gate must cover every flag those callers ship under, not just DAMAGE_CARDS
	// (same rationale as grantSummonOwnership).
	//
	// Appended rather than grouped with the other damage-card handlers on
	// purpose: registration order is observable, and inserting mid-list would
	// renumber every registration after it for no behavioural gain.
	if (anyFeatureEnabled(
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.ANIMATION_FX
	)) socketlibSocket.register("addSummonsToCombatViaGM", async ({ combatId, casterActorId, tokenIds }) => {
		const combat = game.combats.get(combatId);
		if (!combat) {
			console.warn(`${MODULE_ID} | addSummonsToCombatViaGM: combat not found`, combatId);
			return;
		}

		const { buildSummonCombatantData } = await import("../combat/damage-card-actions.mjs");
		const combatants = buildSummonCombatantData(combat, casterActorId, tokenIds);
		if (combatants.length === 0) return;

		return combat.createEmbeddedDocuments("Combatant", combatants);
	});

	// Grant ownership of a world actor to a user so portal-lib's token creation
	// can succeed — portal-lib calls worldActor.update() internally and players
	// lack OWNER permission on compendium-imported creatures.
	//
	// Reachable from spawnSummonedCreatures (damage-card-actions.mjs), which the
	// damage-card pipeline and the NPC-feature item-macro path both call, so the
	// gate must cover every flag those callers ship under — not just DAMAGE_CARDS.
	if (anyFeatureEnabled(
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.ANIMATION_FX
	)) socketlibSocket.register("grantSummonOwnership", async ({ actorIds, userId }) => {
		// Returns the ids ownership was newly granted to. A spawn cancelled at
		// the placement UI (portal.spawn() resolving empty) calls
		// revokeSummonOwnership with exactly this list, so actors the user
		// already owned are not stripped of a pre-existing grant.
		const newlyGranted = [];
		for (const actorId of actorIds) {
			const actor = game.actors.get(actorId);
			if (!actor) continue;
			if (actor.ownership[userId] == null) newlyGranted.push(actorId);
			try {
				await actor.update({
					ownership: {
						...actor.ownership,
						[userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
					},
				});
			}
			catch(err) {
				console.warn(`${MODULE_ID} | grantSummonOwnership failed for actor ${actorId}:`, err.message);
			}
		}
		return newlyGranted;
	});

	// Roll initiative for a combatant via the GM — players lack permission to
	// call combat.rollInitiative() because it internally does a combatant update.
	// Only caller is the enhanced-header initiative click, so ENHANCED_HEADER
	// alone must be enough to put the handler on the socket.
	if (anyFeatureEnabled(
		FEATURE_IDS.DAMAGE_CARDS, FEATURE_IDS.ENHANCED_HEADER
	)) socketlibSocket.register("rollInitiativeAsGM", async ({ combatId, combatantId, options }) => {
		const combat = game.combats.get(combatId);
		if (!combat) {
			console.warn(`${MODULE_ID} | rollInitiativeAsGM: combat not found`, combatId);
			return;
		}
		try {
			await combat.rollInitiative(combatantId, options);
		}
		catch(err) {
			console.warn(`${MODULE_ID} | rollInitiativeAsGM failed:`, err.message);
		}
	});

	// Undo grantSummonOwnership when a spawn is cancelled: portal.spawn()
	// resolving empty (placement UI dismissed) leaves the pre-granted OWNER on
	// shared world actors permanently. Deleting the key restores the actor's
	// prior ownership rather than setting NONE, which would also strip the GM's
	// implicit ownership. Gated identically to the grant handler.
	if (anyFeatureEnabled(
		FEATURE_IDS.DAMAGE_CARDS,
		FEATURE_IDS.WEAPON_BONUSES,
		FEATURE_IDS.ITEM_MACROS,
		FEATURE_IDS.ANIMATION_FX
	)) socketlibSocket.register("revokeSummonOwnership", async ({ actorIds, userId }) => {
		for (const actorId of actorIds) {
			const actor = game.actors.get(actorId);
			if (!actor) continue;
			try {
				const ownership = { ...actor.ownership };
				delete ownership[userId];
				await actor.update({ ownership });
			}
			catch(err) {
				console.warn(`${MODULE_ID} | revokeSummonOwnership failed for actor ${actorId}:`, err.message);
			}
		}
	});

	return socketlibSocket;
}

/**
 * Get the socketlib socket instance for use in other modules
 * @returns {object|null} The socketlib socket instance
 */
export function getSocket() {
	return socketlibSocket;
}
