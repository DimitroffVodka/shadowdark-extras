// Damage-card target resolution — extracted from combat/damage-card-pipeline.mjs
// (Phase 5.3 split). Template targeting mode (place a MeasuredTemplate and
// derive targets from it) plus the stored/fallback target paths. Returns the
// resolved target tokens and any template placed this pass.
//
// Public names are re-exported by damage-card-pipeline.mjs; behavior is
// unchanged from the inline block.

import { buildTemplateEffectsFlag, processTemplateCreationEffects } from "../effects/TemplateEffectsSD.mjs";
import { readSdRollOutcome } from "../shared/sd4Compat.mjs";
import { _templatePlacedMessages } from "./combat-settings-app.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Resolve the token targets for a damage card message.
 *
 * Template targeting mode places a MeasuredTemplate and derives targets from
 * its tokens; otherwise stored message targets or the current user's targets
 * are used. Runs only for the caster (authority matches the inline block).
 *
 * @param {object} params
 * @param {object} params.item - The item (weapon/spell) behind the card.
 * @param {object} params.message - The chat message.
 * @param {object} params.casterActor - The actor casting/attacking.
 * @param {object} params.speaker - The message speaker data.
 * @param {string} params.itemType - The item type string.
 * @param {string} params.messageKey - Dedup key for template placement.
 * @param {string[]} [params.storedTargetIds] - Stored target token ids.
 * @returns {Promise<{targets: Array, placedTemplateId: string|null, cancelled: boolean}>}
 */
export async function resolveDamageCardTargets({
	item,
	message,
	casterActor,
	speaker,
	itemType,
	messageKey,
	storedTargetIds,
}) {
	let targets = [];
	const casterTokenId = speaker?.token || ""; // The actual token that made the attack/cast

	// Check if item has template targeting mode enabled
	const targetingConfig = item?.flags?.[MODULE_ID]?.targeting;
	let useTemplateTargeting = targetingConfig?.mode === "template"
		&& message.author.id === game.user.id // Only for the caster
		&& !_templatePlacedMessages.has(messageKey) // Use in-memory check
		&& !message.flags?.[MODULE_ID]?.templatePlaced; // AND persistent check

	// For spells that require success rolls, only show template if spell succeeded
	// Note: Potions and Scrolls don't have successful roll requirements (they always succeed when
	// used)
	// Wands DO have spell rolls, so they need the success check
	if (useTemplateTargeting && !["Potion", "Scroll"].includes(itemType)) {
		const templateOutcome = readSdRollOutcome(message);
		if (templateOutcome.isMasked) {
			useTemplateTargeting = false;   // private roll — don't show template prompt
		}
		else if (!templateOutcome.isSuccess) useTemplateTargeting = false;
	}

	let placedTemplateId = null;
	if (useTemplateTargeting) {
		// Mark as placed immediately to prevent re-runs (especially on reload)
		await message.setFlag(MODULE_ID, "templatePlaced", true);
		_templatePlacedMessages.add(messageKey);

		// Get template settings
		const templateSettings = targetingConfig.template || {};
		const templateType = templateSettings.type || "circle";
		const templateSize = templateSettings.size || 30;
		const placement = templateSettings.placement || "choose";
		const fillColor = templateSettings.fillColor || "#4e9a06";
		const deleteMode = templateSettings.deleteMode || "none";
		const deleteDuration = templateSettings.deleteDuration || 3;
		const deleteSeconds = templateSettings.deleteSeconds || 1;
		const excludeCaster = templateSettings.excludeCaster || false;

		// TokenMagic settings
		const tmSettings = templateSettings.tokenMagic || {};
		const tmTexture = tmSettings.texture || "";
		const tmOpacity = tmSettings.opacity ?? 0.5;
		const tmPreset = tmSettings.preset || "NOFX";
		const tmTint = tmSettings.tint || "";
		const tmFilters = Array.isArray(tmSettings.filters)
			? foundry.utils.deepClone(tmSettings.filters)
			: [];
		const fxEngine = tmSettings.engine || "tmfx";
		const indySettings = tmSettings.indy || {};
		const indyFx = {
			shaderId: indySettings.shaderId || "",
			alpha: indySettings.alpha ?? 1,
			speed: indySettings.speed ?? 1,
			scale: indySettings.scale ?? 1,
			layer: indySettings.layer || "inherit",
		};

		// Calculate auto-delete timing (time-based modes only)
		// For round-based deletion, we use flags on the template instead
		let autoDelete = null;
		let expiryRounds = null;
		if (deleteMode === "endOfTurn") {
			// Delete at end of caster's turn - tracked via combat, fallback to 6 seconds
			autoDelete = 6000;
		}
		else if (deleteMode === "duration") {
			// Delete after X combat rounds - tracked via template flags
			// autoDelete stays null, we store expiryRounds instead
			expiryRounds = deleteDuration;
		}
		else if (deleteMode === "seconds") {
			// Delete after X seconds (time-based)
			autoDelete = deleteSeconds * 1000;
		}

		// Force disable auto-delete for Focus spells - they persist until focus is lost
		if (item?.system?.duration?.type === "focus") {
			autoDelete = null;
			expiryRounds = null;
		}

		// Build globalThis.SDX template flags to write at CREATE time.
		// Foundry v14 silently drops post-create setFlag on MeasuredTemplate documents
		// (template→region deprecation hardening), so we must include flags in the
		// templateData passed to createEmbeddedDocuments — see globalThis.SDX.templates.place.
		const templateEffectsConfigForFlag = item?.flags?.[MODULE_ID]?.templateEffects;
		const spellDamageConfigForFlag = item?.flags?.[MODULE_ID]?.spellDamage;
		const sdxTemplateFlags = { [MODULE_ID]: {} };

		// Native v14: Region.levels must be in the creation data — post-create
		// updates are silently dropped.  Read token.document.level directly.
		let casterLevels = null;
		try {
			const casterToken = canvas.tokens?.get(speaker?.token);
			const casterLevelId = casterToken?.document?.level ?? null;
			if (casterLevelId) {
				casterLevels = [casterLevelId];
				console.log(`shadowdark-extras | Caster level id=${casterLevelId} — will pass to Region creation`);
			}
		}
		catch(e) {
			console.warn("shadowdark-extras | Failed to detect caster level:", e);
		}

		if (templateEffectsConfigForFlag?.enabled) {
			const effectsFlag = buildTemplateEffectsFlag({
				enabled: true,
				spellName: item.name,
				casterActorId: casterActor?.id,
				casterTokenId: speaker?.token,
				onCreation: templateEffectsConfigForFlag.triggers?.onCreation || false,
				onEnter: templateEffectsConfigForFlag.triggers?.onEnter || false,
				onTurnStart: templateEffectsConfigForFlag.triggers?.onTurnStart || false,
				onTurnEnd: templateEffectsConfigForFlag.triggers?.onTurnEnd || false,
				onLeave: templateEffectsConfigForFlag.triggers?.onLeave || false,
				damageFormula: templateEffectsConfigForFlag.damage?.formula || "",
				damageType: templateEffectsConfigForFlag.damage?.type || "",
				saveEnabled: templateEffectsConfigForFlag.save?.enabled || false,
				saveDCFormula: templateEffectsConfigForFlag.save?.dc || "12",
				spellcastingCheckTotal: readSdRollOutcome(message).total ?? 0,
				casterLevel: casterActor?.system?.level?.value || 1,
				casterAbilities: {
					str: casterActor?.system?.abilities?.str?.mod || 0,
					dex: casterActor?.system?.abilities?.dex?.mod || 0,
					con: casterActor?.system?.abilities?.con?.mod || 0,
					int: casterActor?.system?.abilities?.int?.mod || 0,
					wis: casterActor?.system?.abilities?.wis?.mod || 0,
					cha: casterActor?.system?.abilities?.cha?.mod || 0,
				},
				saveAbility: templateEffectsConfigForFlag.save?.ability || "dex",
				halfOnSuccess: templateEffectsConfigForFlag.save?.halfOnSuccess || false,
				effects: templateEffectsConfigForFlag.applyConfiguredEffects
					? (spellDamageConfigForFlag?.effects || [])
					: [],
				excludeCaster: excludeCaster,
				runItemMacro: templateEffectsConfigForFlag.runItemMacro || false,
				spellId: item.id,
				initialEnterTriggered: false,
				effectsRequirement: spellDamageConfigForFlag?.effectsRequirement || "",
			});
			if (effectsFlag) sdxTemplateFlags[MODULE_ID].templateEffects = effectsFlag;
		}
		if (expiryRounds && expiryRounds > 0) {
			const currentRound = game.combat?.round || 0;
			// expiryRound is the LAST round the template stays active.
			// updateCombat hook deletes when `expiryRound < currentRound`, i.e.,
			// at the START of the round AFTER expiryRound.
			// For "duration: 1" → template lasts only the cast round, deletes at start of next
			// round.
			sdxTemplateFlags[MODULE_ID].templateExpiry = {
				spellName: item.name,
				createdRound: currentRound,
				expiryRound: currentRound + expiryRounds - 1,
				duration: expiryRounds,
			};
		}

		try {
			// Use globalThis.SDX.templates API if available
			if (typeof globalThis.SDX !== "undefined" && globalThis.SDX.templates) {
				// Determine placement mode
				let result;
				if (placement === "centered") {
					// Auto-center on caster's token
					const casterTokenId = speaker?.token;
					const casterToken = canvas.tokens?.get(casterTokenId);
					if (casterToken) {
						// Place template centered on caster
						result = await globalThis.SDX.templates.placeAndTarget({
							type: templateType,
							size: templateSize,
							fillColor: fillColor,
							autoDelete: autoDelete,
							x: casterToken.center.x,
							y: casterToken.center.y,
							elevation: casterToken.document.elevation ?? 0,
							levels: casterLevels,
							texture: fxEngine === "tmfx" ? (tmTexture || null) : null,
							textureOpacity: tmOpacity,
							tmfxPreset: fxEngine === "tmfx" ? tmPreset : null,
							tmfxTint: fxEngine === "tmfx" ? tmTint : null,
							tmfxFilters: fxEngine === "tmfx" ? tmFilters : [],
							indyFx: fxEngine === "indy" ? indyFx : null,
							excludeCasterTokenId: excludeCaster ? casterTokenId : null,
							templateFlags: sdxTemplateFlags,
						});
					}
				}
				else if (placement === "caster") {
					// Originate from caster - origin locked to caster, user controls direction
					const casterTokenId = speaker?.token;
					const casterToken = canvas.tokens?.get(casterTokenId);
					if (casterToken) {
						result = await globalThis.SDX.templates.placeAndTarget({
							type: templateType,
							size: templateSize,
							fillColor: fillColor,
							autoDelete: autoDelete,
							originFromCaster: {
								x: casterToken.center.x,
								y: casterToken.center.y,
								elevation: casterToken.document.elevation ?? 0,
							},
							levels: casterLevels,
							texture: fxEngine === "tmfx" ? (tmTexture || null) : null,
							textureOpacity: tmOpacity,
							tmfxPreset: fxEngine === "tmfx" ? tmPreset : null,
							tmfxTint: fxEngine === "tmfx" ? tmTint : null,
							tmfxFilters: fxEngine === "tmfx" ? tmFilters : [],
							indyFx: fxEngine === "indy" ? indyFx : null,
							excludeCasterTokenId: excludeCaster ? casterTokenId : null,
							templateFlags: sdxTemplateFlags,
						});
					}
					else {
						// No caster token found, fall back to choose location
						console.warn("shadowdark-extras | Caster token not found for originate from caster, falling back to choose location");
						result = await globalThis.SDX.templates.placeAndTarget({
							type: templateType,
							size: templateSize,
							fillColor: fillColor,
							autoDelete: autoDelete,
							levels: casterLevels,
							texture: fxEngine === "tmfx" ? (tmTexture || null) : null,
							textureOpacity: tmOpacity,
							tmfxPreset: fxEngine === "tmfx" ? tmPreset : null,
							tmfxTint: fxEngine === "tmfx" ? tmTint : null,
							tmfxFilters: fxEngine === "tmfx" ? tmFilters : [],
							indyFx: fxEngine === "indy" ? indyFx : null,
							excludeCasterTokenId: excludeCaster ? speaker?.token : null,
							templateFlags: sdxTemplateFlags,
						});
					}
				}
				else {
					// Choose location — seed elevation and level from caster
					const casterToken = canvas.tokens?.get(speaker?.token);
					result = await globalThis.SDX.templates.placeAndTarget({
						type: templateType,
						size: templateSize,
						fillColor: fillColor,
						autoDelete: autoDelete,
						elevation: casterToken?.document?.elevation ?? 0,
						levels: casterLevels,
						texture: fxEngine === "tmfx" ? (tmTexture || null) : null,
						textureOpacity: tmOpacity,
						tmfxPreset: fxEngine === "tmfx" ? tmPreset : null,
						tmfxTint: fxEngine === "tmfx" ? tmTint : null,
						tmfxFilters: fxEngine === "tmfx" ? tmFilters : [],
						indyFx: fxEngine === "indy" ? indyFx : null,
						excludeCasterTokenId: excludeCaster ? speaker?.token : null,
						templateFlags: sdxTemplateFlags,
					});
				}

				if (result && result.tokens) {
					targets = result.tokens.map(t => canvas.tokens?.get(t.id)).filter(t => t);

					// Filter out caster if excludeCaster is enabled
					if (excludeCaster && speaker?.token) {
						targets = targets.filter(t => t.id !== speaker.token);
					}

					// Template flags (templateEffects + templateExpiry) were already written at
					// create-time
					// via placeAndTarget's templateFlags option — see sdxTemplateFlags build block
					// above
					// (v14 silently drops post-create setFlag on MeasuredTemplate documents).
					const templateEffectsConfig = item?.flags?.[MODULE_ID]?.templateEffects;
					if (result.template && templateEffectsConfig?.enabled) {
						await processTemplateCreationEffects(result.template, targets);

						// Trigger Automated Animations for the template
						// AA often fires too early (on chat message) before template exists.
						// We manually trigger it here on the placed template.
						if (game.modules.get("autoanimations")?.active && window.AutomatedAnimations) {
							const casterForAnim = canvas.tokens.get(casterTokenId);
							console.log("shadowdark-extras | Attempting manual AA trigger", { caster: casterForAnim, template: result.template, item: item });
							if (casterForAnim) {
								try {
									// AA usually expects (source, targets, data)
									// We pass the template as the target
									// NOTE: Some versions of AA use playAnimation(source, targets,
									// data)
									// where targets is an Array.
									await window.AutomatedAnimations.playAnimation(
										casterForAnim,
										[result.template],
										{ item: item }
									);
									console.log("shadowdark-extras | Manual AA trigger fired");
								}
								catch(err) {
									console.error("shadowdark-extras | Manual AA trigger failed:", err);
								}
							}
						}
					}
					// Check for manual AA trigger if template effects were NOT enabled but template
					// exists
					else if (result.template) {
						if (game.modules.get("autoanimations")?.active && window.AutomatedAnimations) {
							const casterForAnim = canvas.tokens.get(casterTokenId);
							console.log("shadowdark-extras | Attempting manual AA trigger (no template effects)", { caster: casterForAnim, template: result.template, item: item });
							if (casterForAnim) {
								try {
									await window.AutomatedAnimations.playAnimation(
										casterForAnim,
										[result.template],
										{ item: item }
									);
									console.log("shadowdark-extras | Manual AA trigger fired");
								}
								catch(err) {
									console.error("shadowdark-extras | Manual AA trigger failed:", err);
								}
							}
						}
					}

					// Note: Aura effects are now applied after target gathering (see below)
					// to work for both template and targeted modes.
					// templateExpiry flag was already written at create-time via placeAndTarget's
					// templateFlags option — see sdxTemplateFlags build block above
					// (v14 silently drops post-create setFlag on MeasuredTemplate documents).

					// Store template ID for duration spell linking
					if (result.template) {
						placedTemplateId = result.template.id;
					}

					// Mark this message as having template placed using in-memory tracking
					// We avoid message.update() because it triggers re-renders that remove our
					// injected damage card
					_templatePlacedMessages.add(messageKey);
				}
				else {
					return { targets, placedTemplateId: null, cancelled: true }; // User cancelled
				}
			}
			else {
				console.warn("shadowdark-extras | SDX.templates not available, falling back to user targets");
				targets = Array.from(game.user.targets || []);
			}
		}
		catch(err) {
			console.error("shadowdark-extras | Error during template placement:", err);
			targets = Array.from(game.user.targets || []);
		}
	}
	else if (storedTargetIds && storedTargetIds.length > 0) {
		// Use the stored targets from when the message was created
		targets = storedTargetIds
			.map(id => canvas.tokens?.get(id))
			.filter(t => t); // Filter out any tokens that no longer exist
	}
	else {
		// Fallback to current user's targets (backward compatibility)
		targets = Array.from(game.user.targets || []);
	}

	return { targets, placedTemplateId, cancelled: false };
}
