/** Damage-card injection pipeline extracted from CombatSettingsSD.
 * This module owns the staged render/compute/apply flow; the compatibility
 * facade remains in CombatSettingsSD.mjs.
 */

import { getWeaponEffectsToApply, calculateWeaponBonusDamage } from "./WeaponBonusConfig.mjs";
import { startDurationSpell, linkEffectToDurationSpell, linkEffectToFocusSpell, startFocusSpellIfNeeded } from "../effects/FocusSpellTrackerSD.mjs";
import { createAuraOnActor } from "../effects/AuraEffectsSD.mjs";
import { readSdRollOutcome, readSdDamageRoll, resolveCardContext } from "../shared/sd4Compat.mjs";
import { buildDamageCardHtml, spawnSummonedCreatures, giveItemsToCaster, applyCoatingPoison, normalizeConfiguredEffectUuids, evaluateFormulaExpressions, doubleDiceInFormula, parseTieredFormula, evaluateRequirement, buildTargetRollData } from "./damage-card.mjs";
import { _spawnedMessages, _itemGiveMessages, _coatingPoisonMessages } from "./combat-settings-app.mjs";
import { finalizeDamageCard } from "./damage-card-finalization.mjs";
import { resolveDamageCardTargets } from "./damage-card-targeting.mjs";
import { readSummonProfiles } from "../shared/summon-profiles.mjs";

const MODULE_ID = "shadowdark-extras";

// Damage-card injection pipeline — the full combat-message rendering stage
// (card HTML, template/aura placement, spell/damage computation, auto-apply,
// duration tracking). Remains a single staged function by design; see the
// demonstrated-exception record in the phase log.
export async function injectDamageCard(message, html, data) {
	window._sdx_calculatingMessages ||= new Set();
	window._sdx_localDamageResults ||= {};

	// v14: renderChatMessageHTML passes a raw HTMLElement, not jQuery.
	// Re-wrap so the existing jQuery API inside this large function keeps working.
	if (html instanceof HTMLElement) html = $(html);

	// Prevent duplicate injection for the same message
	const messageKey = message.id;
	// `message.author` resolves the stored author id against `game.users`, and is
	// null when that id no longer names anyone — a player deleted from the world
	// leaves their chat messages behind. Every render of such a message threw
	// here, and because this function is async the caller's try/catch could not
	// report it (see chat-card-hooks). An unresolvable author is necessarily not
	// the current user, so `false` is the right answer rather than a crash.
	const isAuthor = message.author?.id === game.user.id;

	// Skip if the message is being deleted or closed
	if (html.hasClass("deleting") || data?.canClose) {
		return;
	}

	// Skip if a damage card is already in the DOM for this message
	if (html.find(".sdx-damage-card").length > 0) {
		return;
	}

	// Check if damage card feature is enabled
	let settings;
	try {
		settings = game.settings.get(MODULE_ID, "combatSettings");
	}
	catch(e) {
		return; // Settings not registered yet
	}

	if (!settings.showDamageCard) {
		return;
	}

	// Skip initiative rolls - they should not show damage cards
	const messageFlavor = (message.flavor || "").toLowerCase();
	const rollType = message.flags?.shadowdark?.rollType;
	if (rollType === "initiative" || messageFlavor.includes("initiative")) {
		return;
	}

	// Check if player damage cards are enabled (for non-GMs)
	// Note: We don't return early here - we still process templates, summoning, effects, etc.
	// We just skip the damage card HTML injection at the end
	const hideDamageCardFromPlayer = !game.user.isGM && !settings.showForPlayers;

	// Note: hideDamageCardOnFailedAttack check is done later after item type is known (around line
	// 1610)

	// Check if this is a Shadowdark weapon/attack card with damage OR a spell with damage
	// configured.
	// SD 4.x has no .chat-card class — also recognize via flags.shadowdark.rollConfig presence.
	const hasWeaponCard = html.find(".chat-card, .item-card").length > 0
		|| !!message.flags?.shadowdark?.rollConfig;
	const hasDamageRoll = html.find(".dice-total").length > 0;

	// Also check for damage text or damage formula using localized keywords
	const messageText = html.text().toLowerCase();
	const flavorText = (message.flavor || "").toLowerCase();

	// Support for different languages
	const damageKeywords = ["damage", "dégât", "dégâts", "schaden", "daño", "dano", "урон", "vahinko", "soins", "healing"];
	try {
		const damageLabel = game.i18n.localize("SHADOWDARK.roll.damage").toLowerCase();
		if (damageLabel && !damageKeywords.includes(damageLabel)) {
			damageKeywords.push(damageLabel);
			// For languages like French, "Jet de dégâts" -> add "dégâts" part
			const parts = damageLabel.split(/[\s']+/);
			for (const part of parts) {
				if (part.length > 3) damageKeywords.push(part);
			}
		}
		const applyDamageLabel = game.i18n.localize("SHADOWDARK.chat_card.context.apply_damage").toLowerCase();
		if (applyDamageLabel && !damageKeywords.includes(applyDamageLabel)) {
			damageKeywords.push(applyDamageLabel);
		}
	}
	catch(e) {
		// game.i18n might not be fully ready
	}

	const hasDamageKeyword = damageKeywords.some(kw => messageText.includes(kw))
		|| damageKeywords.some(kw => html.find("h4, h3, h2").text().toLowerCase().includes(kw));


	// Check if this looks like a damage roll
	const isDamageRoll = (hasWeaponCard && hasDamageRoll && hasDamageKeyword)
		|| (damageKeywords.some(kw => flavorText.includes(kw)))
		|| (message.flags?.shadowdark?.rollType === "damage");

	// Check if this is a spell cast with damage/heal configuration or effects
	let isSpellWithDamage = false;
	let isSpellWithEffects = false;
	let spellDamageConfig = null;
	let casterActor = null; // The actor who owns the spell item
	let item = null; // The spell/potion item
	let placedTemplateId = null; // Track locally-placed template ID

	// Get the item from the chat card if it exists (SD 3.x DOM or SD 4.x rollConfig).
	// Helper resolves both legacy `.chat-card` DOM data and v4 `flags.shadowdark.rollConfig`.
	const ctx = resolveCardContext(message, html);
	let cardData = ctx?.itemId ? { actorId: ctx.actorId, itemId: ctx.itemId } : null;
	let itemType = null; // Track the item type

	if (cardData?.actorId && cardData?.itemId) {

		// Priority 1: Try getting from speaker token (for unlinked tokens)
		const speaker = message.speaker;
		if (speaker.token) {
			const token = canvas.tokens?.get(speaker.token);
			// Verify this token matches the actor ID in the card (or the card actor ID is the base
			// ID and token wraps it)
			if (token && token.actor) {
				// If cardData.actorId matches either the token's synthetic ID or its base ID, use
				// the token actor
				if (
					token.actor.id === cardData.actorId
					|| token.actor.uuid.endsWith(cardData.actorId)
				) {
					casterActor = token.actor;
				}
			}
		}

		// Priority 2: Direct actor look up (Sidebar actor)
		if (!casterActor) {
			casterActor = game.actors.get(cardData.actorId);
		}

		// Priority 3: Search canvas tokens for matching actor ID
		if (!casterActor) {
			const token = canvas.tokens?.placeables.find(t => t.actor?.id === cardData.actorId);
			if (token) casterActor = token.actor;
		}

		item = casterActor?.items.get(cardData.itemId);

		// If item not found (consumed), try to get it from message flags
		if (!item && message.flags?.[MODULE_ID]?.itemConfig) {
			const storedConfig = message.flags[MODULE_ID].itemConfig;

			// Create a minimal item-like object with the stored configuration
			item = {
				name: storedConfig.name,
				type: storedConfig.type,
				flags: {
					[MODULE_ID]: {
						summoning: storedConfig.summoning,
						itemGive: storedConfig.itemGive,
						auraEffects: storedConfig.auraEffects,
						spellDamage: storedConfig.spellDamage,
						coatingPoison: storedConfig.coatingPoison,
					},
				},
			};
		}

		// Check if this is a failed weapon attack - if setting is enabled, skip damage card
		// and also hide the base Shadowdark system's damage roll section from the chat card
		if (settings.hideDamageCardOnFailedAttack && item && item.type === "Weapon") {
			// Check the attack success from the shadowdark flags
			// The success flag is at the root level: message.flags.shadowdark.success
			const attackSuccess = message.flags?.shadowdark?.success;
			if (attackSuccess === false) {
				// Hide the base system damage roll section (.card-damage-rolls)
				// This is the default damage roll that Shadowdark renders in the chat card
				html.find(".card-damage-rolls").hide();
				// Weapon attack failed, skip damage card injection
				return;
			}
		}

		// Check if this is a spell or potion type item with damage configuration or effects
		if (item && ["Spell", "Scroll", "Wand", "NPC Spell", "Potion", "NPC Feature", "NPC Special Attack"].includes(item.type)) {
			itemType = item.type; // Store item type for later checks

			spellDamageConfig = item.flags?.["shadowdark-extras"]?.spellDamage;
			if (spellDamageConfig?.enabled) {
				isSpellWithDamage = true;
			}
			// NPC Special Attack always counts as having damage (calculated manually later)
			if (item.type === "NPC Special Attack") {
				const specialAttack = item.getFlag?.(MODULE_ID, "specialAttack") || {};
				const systemDamage = specialAttack.damageFormula || item.system?.damage?.value || "";
				const damageBonus = Number(
					specialAttack.damageBonus ?? item.system?.bonuses?.damageBonus ?? 0
				) || 0;
				const formula = damageBonus
					? `${systemDamage || "0"}${damageBonus > 0 ? "+" : ""}${damageBonus}`
					: systemDamage;
				spellDamageConfig = foundry.utils.mergeObject({
					enabled: !!formula,
					formulaType: "formula",
					formula: formula || "0",
					damageType: item.getFlag?.(MODULE_ID, "baseDamageType") || "physical",
					effects: [],
					criticalEffects: [],
					effectsApplyToTarget: true,
					effectSelectionMode: "all",
				}, spellDamageConfig || {}, { inplace: false });
				if (!item.flags?.[MODULE_ID]?.spellDamage?.enabled) {
					spellDamageConfig.enabled = !!formula;
					spellDamageConfig.formulaType = "formula";
					spellDamageConfig.formula = formula || "0";
					spellDamageConfig.damageType = item.getFlag?.(MODULE_ID, "baseDamageType") || "physical";
				}
				isSpellWithDamage = true;
			}
			// Check for effects even if damage is not enabled
			if (spellDamageConfig?.effects) {
				let effects = [];
				if (typeof spellDamageConfig.effects === "string") {
					try {
						effects = JSON.parse(spellDamageConfig.effects);
					}
					catch(err) {
						effects = [];
					}
				}
				else if (Array.isArray(spellDamageConfig.effects)) {
					effects = spellDamageConfig.effects;
				}
				if (effects.length > 0) {
					isSpellWithEffects = true;
				}
			}
			// Also check for critical effects
			if (spellDamageConfig?.criticalEffects) {
				let critEffects = [];
				if (typeof spellDamageConfig.criticalEffects === "string") {
					try {
						critEffects = JSON.parse(spellDamageConfig.criticalEffects);
					}
					catch(err) {
						critEffects = [];
					}
				}
				else if (Array.isArray(spellDamageConfig.criticalEffects)) {
					critEffects = spellDamageConfig.criticalEffects;
				}
				if (critEffects.length > 0) {
					isSpellWithEffects = true;
				}
			}

			// Check if Challenge Mode is enabled
			if (spellDamageConfig?.challenge?.enabled) {
				isSpellWithDamage = true;
				// Loop into the damage processing block even if damage logic itself is off
			}

			// Check if Effects Challenge Mode is enabled
			if (spellDamageConfig?.effectsChallenge?.enabled) {
				isSpellWithEffects = true; // Ensure we pass the early return check
				// We also need to ensure we enter the main processing loop.
				// Currently most logic is gated by isSpellWithDamage or isSpellWithEffects.
			}
		}
	}

	// Focus maintenance rolls (cast with { cast: { focus: true } } — the sheet's
	// focus button or the Auto-Roll Focus feature) must NOT re-run on-cast
	// enhancements. The spell effect was already applied on the initial cast, and
	// per-turn damage + focus cleanup are handled by the Focus Spell Tracker.
	// Without this, every maintenance roll re-applies the spell effect, stacking
	// duplicate "Spell Effect" items on the target each round.
	if (message.flags?.shadowdark?.rollConfig?.cast?.focus === true) return;

	// Check for aura effects configuration
	const hasAuraEnabled = item?.flags?.[MODULE_ID]?.auraEffects?.enabled || false;

	// Check for summoning configuration (independent of damage/effects)
	const summoningConfig = item?.flags?.[MODULE_ID]?.summoning;
	// Stored as a JSON string by the item sheet; readSummonProfiles is the one
	// place that knows every shape it can arrive in.
	const summoningProfiles = readSummonProfiles(summoningConfig);
	// Skip during the load-time chat re-render (game/canvas not yet ready): a
	// historical summon card rendered lazily (scroll-back) after canvas-ready
	// would re-run the full spawn — re-granting ownership, popping the
	// placement UI, and re-summoning. The dedup set is in-memory, so only the
	// ready guard keeps reloads clean (same reasoning as the item-give block).
	if (
		game.ready
		&& summoningConfig?.enabled
		&& summoningProfiles.length > 0
	) {

		// Only spawn for the user who created the message (the caster)
		if (message.author?.id !== game.user.id) {
			// Don't return - still process other damage/effects for observers
		}
		else if (_spawnedMessages.has(message.id)) {
			// Check in-memory cache (synchronous, prevents race condition)
		}
		else {
			// Check if the spell cast was successful (skip this check for potions and scrolls which
			// always succeed)
			// Wands have spell rolls, so they need the success check
			const summonOutcome = readSdRollOutcome(message);
			// NPC Special Attack / NPC Feature are GM-activated abilities: the SD system
			// never stamps a hit/miss `success` flag on their attack roll, so
			// readSdRollOutcome always reports isMasked/!isSuccess for them. Treat them
			// like Potion/Scroll and summon on use. The author-only guard above
			// (message.author.id === game.user.id) still prevents multi-client spawns.
			if (!["Potion", "Scroll", "NPC Special Attack", "NPC Feature"].includes(itemType)) {
				if (summonOutcome.isMasked) {
					return;   // private roll — don't auto-spawn on non-recipient clients
				}
				if (!summonOutcome.isSuccess) return;
			}

			// Mark as spawned immediately (synchronous)
			_spawnedMessages.add(message.id);


			const profiles = summoningProfiles;

			// Check for critical success to double duration
			const isCriticalSuccess = summonOutcome.isCriticalSuccess;

			// Automatically spawn creatures when spell is cast
			await spawnSummonedCreatures(
				casterActor,
				item,
				profiles,
				summoningConfig,
				isCriticalSuccess
			);
		}
	}

	const itemGiveConfig = item?.flags?.[MODULE_ID]?.itemGive;
	// Skip during the load-time chat re-render (game/canvas not yet ready):
	// creating items there throws in the dependent-token render-flag update
	// ("Cannot read properties of undefined (reading 'OBJECTS')") and would also
	// re-grant items from historical cards on every reload (the dedup set is
	// in-memory). Item-give only needs to fire for cards created during live play.
	if (
		game.ready
		&& itemGiveConfig?.enabled
		&& itemGiveConfig?.profiles
		&& itemGiveConfig.profiles.length > 0
	) {
		if (message.author?.id === game.user.id && !_itemGiveMessages.has(message.id)) {
			let shouldGive = true;
			// See the summoning gate above: NPC Special Attack / NPC Feature have no
			// system-determined attack success, so they grant on use like Potion/Scroll.
			if (!["Potion", "Scroll", "NPC Special Attack", "NPC Feature"].includes(itemType)) {
				const itemGiveOutcome = readSdRollOutcome(message);
				if (itemGiveOutcome.isMasked) {
					shouldGive = false;   // private roll — skip on non-recipient clients
				}
				else if (!itemGiveOutcome.isSuccess) shouldGive = false;
			}
			if (shouldGive) {
				_itemGiveMessages.add(message.id);
				let profiles = itemGiveConfig.profiles;
				if (typeof profiles === "string") {
					try {
						profiles = JSON.parse(profiles);
					}
					catch(err) {
						console.error("shadowdark-extras | Failed to parse item give profiles:", err);
						profiles = [];
					}
				}
				await giveItemsToCaster(casterActor, item, profiles);
			}
		}
	}

	// Process coating poison for potions
	const coatingPoisonConfig = item?.flags?.[MODULE_ID]?.coatingPoison;
	if (coatingPoisonConfig?.enabled && itemType === "Potion") {
		if (message.author?.id !== game.user.id) {
			// Don't process for other users
		}
		else if (_coatingPoisonMessages.has(message.id)) {
			// Already processed
		}
		else {
			_coatingPoisonMessages.add(message.id);

			// Determine target actor - use target if present, otherwise self
			const targetToken = Array.from(game.user.targets)[0];
			const targetActor = targetToken?.actor || casterActor;

			if (targetActor) {
				await applyCoatingPoison(casterActor, targetActor, coatingPoisonConfig, item.name);
			}
		}
	}

	if (!isDamageRoll && !isSpellWithDamage && !isSpellWithEffects && !hasAuraEnabled) {
		return;
	}

	// Get the actor for damage rolls - for spells use the caster, otherwise use speaker
	const speaker = message.speaker;
	let actor = casterActor; // Start with the actor found from chat card data
	let casterTokenId = speaker?.token || ""; // The actual token that made the attack/cast

	if (!actor && speaker?.actor) {
		// Fallback to speaker if not found from card data
		actor = game.actors.get(speaker.actor);
	}

	if (!actor) {
		return;
	}

	// Get targeted tokens - use stored targets from message flags if available
	const storedTargetIds = message.flags?.["shadowdark-extras"]?.targetIds;

	// Resolve the card's targets: template targeting mode (place a
	// MeasuredTemplate and derive targets from it), stored message targets,
	// or the current user's targets as a fallback.
	const targetResolution = await resolveDamageCardTargets({
		item,
		message,
		casterActor,
		speaker,
		itemType,
		messageKey,
		storedTargetIds,
	});
	if (targetResolution.cancelled) {
		return; // User cancelled template placement
	}
	let targets = targetResolution.targets;
	placedTemplateId = targetResolution.placedTemplateId;


	// For "Self" range spells, if no targets are selected, use the caster's token as target
	// Range can be either a string directly (e.g., "self") or an object with a value property
	const rawRange = item?.system?.range;
	const spellRange = (typeof rawRange === "string" ? rawRange : rawRange?.value || "").toLowerCase();
	if (targets.length === 0 && spellRange === "self" && casterActor) {
		const casterTokenId = speaker?.token;
		if (casterTokenId) {
			const casterToken = canvas.tokens?.get(casterTokenId);
			if (casterToken) {
				targets = [casterToken];
			}
		}
		if (targets.length === 0) {
			// Fallback: find first token for this actor on the current scene
			const casterToken = canvas.tokens?.placeables.find(t => t.actor?.id === casterActor.id);
			if (casterToken) {
				targets = [casterToken];
			}
		}
	}

	// Apply Aura Effects if configured (works for both template and targeted modes)
	const auraConfig = item?.flags?.[MODULE_ID]?.auraEffects;
	// Check if this is a focus maintenance roll (not initial cast)
	const auraFocusCheckText = game.i18n.localize("SHADOWDARK.chat.spell_focus_check") || "Focus Check";
	const isFocusRoll = message.flavor?.includes(auraFocusCheckText) || message.flavor?.includes("Focus Check");
	// Check if aura was already created for this message (prevents duplicate on re-render)
	const auraAlreadyCreated = message.getFlag(MODULE_ID, "auraCreated");

	// Check if spell cast was successful (treat no roll as success for scrolls/wands)
	const auraOutcome = readSdRollOutcome(message);
	const auraMainRoll = auraOutcome.mainRoll;
	// "No roll" (scroll/wand auto-success) OR roll succeeded. Skip on masked rolls.
	const spellCastSuccessful = !auraOutcome.isMasked && (!auraMainRoll || auraOutcome.isSuccess);

	let auraCreatedThisCall = false;
	if (auraConfig?.enabled && !isFocusRoll && !auraAlreadyCreated && spellCastSuccessful) {

		// Only process aura creation for the user who created the message OR the first active GM
		// This ensures only one client performs the database operations and initial processing
		const primaryExecutorId = game.users.activeGM?.id || message.author?.id;

		if (primaryExecutorId !== game.user.id) {
			// If it's the GM casting but this client is a player, we still treat the aura as
			// "handled"
			// so this client's damage card (if any) doesn't try to auto-apply redundant effects
			if (game.user.id !== primaryExecutorId) {
				auraCreatedThisCall = true;
			}
		}
		else {
			// Determine which actor to attach the aura to
			let auraActor = null;
			let auraToken = null;
			if (auraConfig.attachTo === "target" && targets.length > 0) {
				auraActor = targets[0].actor;
				auraToken = targets[0];
			}
			else {
				// Default to caster
				auraActor = casterActor;
				auraToken = (casterTokenId ? canvas.tokens?.get(casterTokenId) : null)
					|| canvas.tokens?.placeables.find(t => t.actor?.id === casterActor?.id)
					|| null;
			}

			if (auraActor) {
				const durationConfig = item.system.duration;
				const auraExpiryRounds = durationConfig?.type === "rounds" ? (durationConfig.value || 0) : null;

				const auraEffects = auraConfig.applyConfiguredEffects
					? normalizeConfiguredEffectUuids(spellDamageConfig?.effects)
					: [];
				console.log("shadowdark-extras | Aura configured effects snapshot", {
					item: item.name,
					applyConfiguredEffects: auraConfig.applyConfiguredEffects || false,
					rawEffects: spellDamageConfig?.effects,
					auraEffects,
					effectsTriggers: auraConfig.effectsTriggers || {},
				});

				let auraTrackerType = null;
				let auraTrackerInstanceId = null;
				let durationTrackerStartedForAura = false;

				if (durationConfig?.type === "focus") {
					const spellInstanceId = item.id;
					const perTurnConfig = spellDamageConfig?.trackDuration ? {
						perTurnTrigger: spellDamageConfig.perTurnTrigger || "start",
						perTurnDamage: spellDamageConfig.perTurnDamage || "",
						damageType: spellDamageConfig.damageType || "",
						reapplyEffects: spellDamageConfig.reapplyEffects || false,
						effects: spellDamageConfig.effects || [],
					} : null;

					await startFocusSpellIfNeeded(
						casterActor.id,
						spellInstanceId,
						item.name,
						perTurnConfig
					);
					auraTrackerType = "focus";
					auraTrackerInstanceId = spellInstanceId;
				}
				else if ((durationConfig?.type === "rounds" || durationConfig?.type === "turns") && spellDamageConfig?.trackDuration) {
					try {
						const trackerConfig = {
							perTurnTrigger: spellDamageConfig.perTurnTrigger || "start",
							perTurnDamage: spellDamageConfig.perTurnDamage || "",
							reapplyEffects: spellDamageConfig.reapplyEffects || false,
							damageType: spellDamageConfig.damageType || "",
							effects: spellDamageConfig.effects || [],
							templateId: placedTemplateId || null,
						};

						const instance = await startDurationSpell(
							casterActor,
							item,
							[],
							trackerConfig
						);
						if (instance?.instanceId) {
							auraTrackerType = "duration";
							auraTrackerInstanceId = instance.instanceId;
							durationTrackerStartedForAura = true;
							message.setFlag(MODULE_ID, "durationTrackerStarted", true);
						}
					}
					catch(err) {
						console.warn("shadowdark-extras | Failed to start duration tracking for aura:", err);
					}
				}

				const effect = await createAuraOnActor(auraActor, {
					radius: auraConfig.radius || 30,
					triggers: auraConfig.triggers || {},
					damage: auraConfig.damage || {},
					save: auraConfig.save || {},
					effects: auraEffects,
					nativeRegion: auraConfig.nativeRegion || {},
					visualFx: auraConfig.visualFx || {},
					bearerTokenId: auraToken?.id || null,
					tokenFilters: auraConfig.tokenFilters || {},
					disposition: auraConfig.disposition || "all",
					includeSelf: auraConfig.includeSelf || false,
					checkVisibility: auraConfig.checkVisibility || false,
					applyConfiguredEffects: auraConfig.applyConfiguredEffects || false,
					effectsTriggers: auraConfig.effectsTriggers || {},
					damageTriggers: auraConfig.damageTriggers || {},
					runItemMacro: auraConfig.runItemMacro || false,
					macroTriggers: auraConfig.macroTriggers || {},
					casterActorId: casterActor.id,
					trackerType: auraTrackerType,
					trackerInstanceId: auraTrackerInstanceId,
				}, item, durationConfig, auraExpiryRounds);

				if (effect) {
					auraCreatedThisCall = true;
					// Mark message to prevent duplicate aura creation on re-render
					await message.setFlag(MODULE_ID, "auraCreated", true);

					// If this is a focus spell, link the aura effect to the focus spell tracking
					if (durationConfig?.type === "focus") {
						const spellInstanceId = item.id;
						// Link the newly created aura effect to the focus spell
						// For focus spells, we MUST use linkEffectToFocusSpell (not Duration spell)
						await linkEffectToFocusSpell(
							casterActor.id,
							spellInstanceId,
							auraActor.id,
							auraToken?.id || auraActor.token?.id,
							effect.id
						);
					}
					else if ((durationConfig?.type === "rounds" || durationConfig?.type === "turns") && spellDamageConfig?.trackDuration) {
						if (durationTrackerStartedForAura && auraTrackerInstanceId) {
							await linkEffectToDurationSpell(
								casterActor.id,
								auraTrackerInstanceId,
								auraActor.id,
								auraToken?.id || auraActor.token?.id,
								effect.id
							);
						}
					}
				}
			}
		}
	}
	// Don't show card if no targets
	if (targets.length === 0 && !game.user.isGM) {
		return;
	}

	// Calculate total damage from the roll
	let totalDamage = 0;
	let damageType = "damage"; // "damage" or "healing"

	// For spells with damage configuration, calculate damage from the spell config
	// Also enter this block if Effects Challenge is enabled (calculated inside)
	if (
		(isSpellWithDamage || (isSpellWithEffects && spellDamageConfig?.effectsChallenge?.enabled))
		&& spellDamageConfig
	) {
		// Check if the spell cast was successful (skip this check for potions, scrolls, wands, and
		// NPC Features)
		if (!["Potion", "Scroll", "Wand", "NPC Feature", "NPC Spell"].includes(itemType)) {
			const spellEffectsOutcome = readSdRollOutcome(message);
			if (spellEffectsOutcome.isMasked) {
				return;   // private roll — don't apply effects on non-recipient clients
			}
			if (!spellEffectsOutcome.isSuccess) return;
		}


		damageType = spellDamageConfig.damageType || "damage";


		// Synchronization Check: Only author rolls, others use synced results
		// Use in-memory cache OR flags to prevent double-rolling during re-renders
		let syncedResults = message.getFlag(MODULE_ID, "spellDamageResults") || window._sdx_localDamageResults[message.id];

		console.log(`SDX | injectDamageCard | Message: ${message.id} | Author: ${isAuthor} | Synced: ${!!syncedResults} | Calculating: ${window._sdx_calculatingMessages.has(message.id)}`);

		// If no results yet, check if we are already calculating for this message to prevent
		// double-roll race condition
		if (!syncedResults && isAuthor && window._sdx_calculatingMessages.has(message.id)) {
			console.log(`SDX | injectDamageCard | Already calculating for check ${message.id}, skipping duplicate execution`);
			return;
		}

		if (syncedResults) {
			totalDamage = syncedResults.totalDamage;
			damageType = syncedResults.damageType;
			window._lastSpellRollBreakdown = syncedResults.rollBreakdown;

			const rollData = syncedResults.rollJSON || syncedResults.rollData;
			if (rollData) {
				try {
					window._lastSpellRoll = (typeof rollData === "string") ? Roll.fromJSON(rollData) : Roll.fromData(rollData);
				}
				catch(e) {
					console.error("shadowdark-extras | Error loading synced spell roll:", e);
				}
			}

			if (syncedResults.perTargetDamage) {
				window._perTargetDamage = {};
				for (const [id, d] of Object.entries(syncedResults.perTargetDamage)) {
					const tRollData = d.rollJSON || d.rollData;
					if (tRollData) {
						try {
							window._perTargetDamage[id] = {
								damage: d.damage,
								formula: d.formula,
								roll: (typeof tRollData === "string") ? Roll.fromJSON(tRollData) : Roll.fromData(tRollData),
							};
						}
						catch(e) {
							console.error(`shadowdark-extras | Error loading synced per-target roll for ${id}:`, e);
						}
					}
				}
			}

			if (syncedResults.damageRequirement) {
				window._damageRequirement = syncedResults.damageRequirement;
			}

			// We have everything we need from sync, skip rolling
		}
		else if (!isAuthor && !syncedResults) {
			// Not the author and no results yet - wait for sync
			return;
		}
		else {
			// AUTHOR: Continue with normal rolling logic (or if we have syncedResults but need to
			// re-run for some reason, though logic above prevents that)
			// Clear any cached roll data from previous items
			window._lastSpellRollBreakdown = null;
			window._perTargetDamage = null;
			window._damageRequirement = null;
			window._lastSpellRoll = null;

			// Formula Selection
			let formula = "";
			let tieredFormula = "";
			let hasTieredFormula = false;
			let formulaType = "basic";
			let isSpellCritical = false;

			// Mark as calculating
			if (isAuthor) {
				window._sdx_calculatingMessages.add(message.id);
				// CRITICAL FIX: Ensure no stale data from previous rolls persists if we are
				// calculating fresh
				window._lastSpellRollBreakdown = null;
				window._perTargetDamage = null;
				window._damageRequirement = null;
				window._lastSpellRoll = null;
				window._latestChallengeResults = null;
				window._latestEffectsChallengeResults = null;
			}

			try {
				// Check if the spell was a critical success (for dice doubling)
				// Available both for damage and effects challenge context
				isSpellCritical = readSdRollOutcome(message).isCriticalSuccess;

				// Only process damage formula if damage is explicitly enabled
				if (spellDamageConfig && spellDamageConfig.enabled) {
					formulaType = spellDamageConfig.formulaType || "basic";

					// Build damage formula based on selected formula type
					if (formulaType === "formula") {
						// Use custom formula
						formula = spellDamageConfig.formula || "";
					}
					else if (formulaType === "tiered") {
						// Use tiered formula
						tieredFormula = spellDamageConfig.tieredFormula || "";
						hasTieredFormula = tieredFormula.trim() !== "";
					}
					else {
						// Use basic formula (numDice + dieType + bonus)
						// NOTE: Critical doubling is handled later by doubleDiceInFormula for all
						// formula types
						const numDice = spellDamageConfig.numDice || 1;
						const dieType = spellDamageConfig.dieType || "d6";
						const bonus = spellDamageConfig.bonus || 0;

						formula = `${numDice}${dieType}`;
						if (bonus > 0) {
							formula += `+ ${bonus}`;
						}
						else if (bonus < 0) {
							formula += `${bonus}`;
						}
					}
				}
				else {
					// Damage NOT enabled, ensure formula is empty so we don't try to roll
					// "undefined" or something
					formula = "";
				}


				// Challenge Mode Logic (calculated BEFORE damage so we can merge results)
				let challengeResults = null;
				if (spellDamageConfig?.challenge?.enabled) {
					console.log("SDX | Challenge Mode Enabled", spellDamageConfig.challenge);
					try {
						const challengeConfig = spellDamageConfig.challenge;
						const challengeStartRollData = actor?.getRollData() || {};

						// Add target data if available (use first target for rolling context)
						if (targets.length > 0 && targets[0].actor) {
							challengeStartRollData.target = buildTargetRollData(targets[0].actor);
						}

						// 1. Calculate Bonus
						let bonusFormula = challengeConfig.bonus || "0";
						bonusFormula = evaluateFormulaExpressions(
							bonusFormula,
							challengeStartRollData
						);

						let bonusTotal = 0;
						try {
							const bonusRoll = new Roll(bonusFormula, challengeStartRollData);
							await bonusRoll.evaluate();
							bonusTotal = bonusRoll.total;
						}
						catch(e) {
							console.warn("SDX | Challenge Bonus Eval Fail", e);
						}

						// 2. Calculate DC
						let dcFormula = challengeConfig.dc || "10";
						dcFormula = evaluateFormulaExpressions(dcFormula, challengeStartRollData);

						let dcTotal = 10;
						try {
							const dcRoll = new Roll(dcFormula, challengeStartRollData);
							await dcRoll.evaluate();
							dcTotal = dcRoll.total;
						}
						catch(e) {
							dcTotal = parseInt(dcFormula) || 10;
						}

						console.log("SDX | Challenge Details", { bonusFormula, bonusTotal, dcFormula, dcTotal });

						// 3. Roll 1d20 + Bonus
						const challengeFormula = `1d20 + ${bonusTotal}`;
						let challengeRoll;

						if (message.rolls?.length > 0) {
							// Try to find a matching d20 roll to avoid double-roll
							// Look for a d20 term in the roll
							challengeRoll = message.rolls.find(
								r => r.terms.some(t => t.faces === 20)
							)
								|| message.rolls.find(r => r.formula === challengeFormula);
						}

						if (!challengeRoll) {
							console.log("SDX | Creating New Challenge Roll", challengeFormula);
							challengeRoll = new Roll(challengeFormula);
							await challengeRoll.evaluate();

							if (game.dice3d) {
								await game.dice3d.showForRoll(challengeRoll, game.user, true);
							}
						}
						else {
							console.log("SDX | Using Existing Challenge Roll", challengeRoll);
						}

						challengeResults = {
							total: challengeRoll.total,
							formula: challengeFormula,
							dc: dcTotal,
							success: challengeRoll.total >= dcTotal,
							rollJSON: challengeRoll.toJSON(),
						};


						console.log("SDX | Challenge Results", challengeResults);

					}
					catch(err) {
						console.error("shadowdark-extras | Error processing Challenge Mode:", err);
					}
				}

				// Effects Challenge Mode Logic
				let effectsChallengeResults = null;
				console.log("SDX | Inspecting spellDamageConfig for Effects Challenge", spellDamageConfig);
				if (spellDamageConfig?.effectsChallenge?.enabled) {
					console.log("SDX | Effects Challenge Mode Enabled", spellDamageConfig.effectsChallenge);
					try {
						// Inherit from main challenge if properties are missing (since UI is
						// hidden)
						const mainChallengeConfig = spellDamageConfig.challenge || {};
						const rawEffectsConfig = spellDamageConfig.effectsChallenge || {};

						const challengeConfig = {
							// STRICTLY Inherit from main challenge (ignore local values as UI is
							// removed)
							enabled: rawEffectsConfig.enabled,
							bonus: mainChallengeConfig.bonus || "0",
							dc: mainChallengeConfig.dc || "10",
						};
						const challengeStartRollData = actor?.getRollData() || {};

						if (targets.length > 0 && targets[0].actor) {
							challengeStartRollData.target = buildTargetRollData(targets[0].actor);
						}

						// 1. Calculate Bonus
						let bonusFormula = challengeConfig.bonus || "0";
						bonusFormula = evaluateFormulaExpressions(
							bonusFormula,
							challengeStartRollData
						);

						let bonusTotal = 0;
						try {
							const bonusRoll = new Roll(bonusFormula, challengeStartRollData);
							await bonusRoll.evaluate();
							bonusTotal = bonusRoll.total;
							console.log("SDX | Effects Challenge Bonus Calculated", bonusTotal);
						}
						catch(e) {
							console.warn("SDX | Effects Challenge Bonus Eval Fail", e);
						}

						// 2. Calculate DC
						let dcFormula = challengeConfig.dc || "10";
						dcFormula = evaluateFormulaExpressions(dcFormula, challengeStartRollData);

						let dcTotal = 10;
						try {
							const dcRoll = new Roll(dcFormula, challengeStartRollData);
							await dcRoll.evaluate();
							dcTotal = dcRoll.total;
						}
						catch(e) {
							dcTotal = parseInt(dcFormula) || 10;
						}

						// 3. Roll 1d20 + Bonus
						const challengeFormula = `1d20 + ${bonusTotal}`;
						let challengeRoll;

						if (message.rolls?.length > 0) {
							// Look for a DIFFERENT roll than the damage challenge if possible,
							// but usually it's best to look for a matching formula.
							// Ideally we check if this roll was already "claimed" by damage
							// challenge?
							// For now, strict formula matching or simple search.
							challengeRoll = message.rolls.find(
								r => r.formula === challengeFormula
									&& (
										!challengeResults
										|| r !== challengeResults.rollJSON /* simplistic check */
									)
							);

							// Fallback: just find any matching d20 roll not used?
							// To confirm uniqueness we'd need better tracking.
							// For now, let's assume if formulas are identical, re-using is okay OR
							// we force new roll?
							// Actually, if we re-use the SAME roll object for two different
							// challenges, it might look weird.
							// But if the user rolled once for both checks? Unlikely.
							// Let's just create a new roll if strict match fails.
						}

						if (!challengeRoll) {
							// Check if we already have a challenge roll with this formula
							// Use a slight variation in formula or just rely on position?
							// Let's just create a new one.
							challengeRoll = new Roll(challengeFormula);
							await challengeRoll.evaluate();

							if (game.dice3d) {
								await game.dice3d.showForRoll(challengeRoll, game.user, true);
							}
						}

						effectsChallengeResults = {
							total: challengeRoll.total,
							formula: challengeFormula,
							dc: dcTotal,
							success: challengeRoll.total >= dcTotal,
							rollJSON: challengeRoll.toJSON(),
						};

						window._latestEffectsChallengeResults = effectsChallengeResults;

						console.log("SDX | Effects Challenge Results", effectsChallengeResults);

					}
					catch(err) {
						console.error("shadowdark-extras | Error processing Effects Challenge Mode:", err);
					}
				}


				// Roll the damage formula (or tiered formula)
				if (formula || hasTieredFormula) {
					try {
						// Check if formula contains target variables (tiered formulas always need
						// per-target evaluation)
						const hasTargetVariables = (formula && formula.includes("@target.")) || hasTieredFormula;

						// Create base roll data with caster data
						const baseRollData = actor?.getRollData() || {};
						// Flatten level.value to just level for easier formula usage
						if (baseRollData.level && typeof baseRollData.level === "object" && baseRollData.level.value !== undefined) {
							baseRollData.level = baseRollData.level.value;
						}
						// Ensure ability modifiers are available as @str, @dex, etc.
						if (baseRollData.abilities) {
							["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
								if (baseRollData.abilities[ability]?.mod !== undefined) {
									baseRollData[ability] = baseRollData.abilities[ability].mod;
									// @cha = modifier
								}
								if (baseRollData.abilities[ability]?.value !== undefined) {
									baseRollData[`${ability}Base`] = baseRollData.abilities[ability].value;
									// @chaBase = base score
								}
							});
						}
						// Ensure other common stats are available
						if (baseRollData.attributes?.ac?.value !== undefined) {
							baseRollData.ac = baseRollData.attributes.ac.value;
						}
						if (baseRollData.attributes?.hp?.value !== undefined) {
							baseRollData.hp = baseRollData.attributes.hp.value;
						}

						// If formula uses target variables OR we have a tiered formula (which needs
						// target level), we need to roll per-target
						if ((hasTargetVariables || hasTieredFormula) && targets.length > 0) {

							// Store per-target damage for later use
							window._perTargetDamage = {};
							let totalDamageSum = 0;

							for (const target of targets) {
								const targetActor = target.actor;
								if (!targetActor) continue;

								// Clone base roll data and add target data
								const rollData = foundry.utils.duplicate(baseRollData);

								// Create target object in rollData
								rollData.target = buildTargetRollData(targetActor);

								// Check for tiered formula and resolve it for this target's level
								let targetFormula = formula;
								if (hasTieredFormula) {
									const tieredResult = parseTieredFormula(
										tieredFormula,
										rollData.target.level
									);
									if (tieredResult) {
										targetFormula = tieredResult;
									}
								}

								// Evaluate any expressions in the formula (e.g., (1 + floor(@level
								// / 2))d6 -> 2d6)
								targetFormula = evaluateFormulaExpressions(targetFormula, rollData);

								// Double dice on critical hit
								if (isSpellCritical) {
									targetFormula = doubleDiceInFormula(targetFormula);
								}

								// Roll for this specific target
								const roll = new Roll(targetFormula, rollData);
								await roll.evaluate();

								// Show 3D dice animation if Dice So Nice is available
								if (game.dice3d) {
									await game.dice3d.showForRoll(roll, game.user, true);
								}

								let targetDamage = roll.total;


								// Check damage requirement if it exists
								if (spellDamageConfig.damageRequirement && spellDamageConfig.damageRequirement.trim() !== "") {
									const reqFormula = spellDamageConfig.damageRequirement.trim();
									const requirementMet = evaluateRequirement(
										reqFormula,
										rollData
									);

									if (!requirementMet) {
										const failAction = spellDamageConfig.damageRequirementFailAction || "zero";
										if (failAction === "half") {
											targetDamage = Math.floor(targetDamage / 2);
										}
										else {
											targetDamage = 0;
										}
									}
								}

								totalDamageSum += targetDamage;

								// Store this target's damage
								window._perTargetDamage[target.id] = {
									damage: targetDamage,
									roll: roll,
									formula: roll.formula,
								};

							}

							// Use average damage for display (or total, depending on your
							// preference)
							totalDamage = Math.floor(totalDamageSum / targets.length);
							window._lastSpellRollBreakdown = `Per - target(avg: ${totalDamage})`;

						}
						else {
							// No target variables and no tiered formula, roll once for all targets
							const rollData = baseRollData;

							// Check for tiered formula - use caster's level when no targets
							let finalFormula = formula;
							if (hasTieredFormula) {
								const tieredResult = parseTieredFormula(
									tieredFormula,
									rollData.level
								);
								if (tieredResult) {
									finalFormula = tieredResult;
								}
							}

							// Evaluate any expressions in the formula (e.g., (1 + floor(@level /
							// 2))d6 -> 2d6)
							finalFormula = evaluateFormulaExpressions(finalFormula, rollData);

							// Double dice on critical hit
							if (isSpellCritical) {
								finalFormula = doubleDiceInFormula(finalFormula);
							}

							let roll;

							// Try to use an existing roll from message.rolls if its formula
							// matches.
							// Do NOT fall back to the last roll — that would pick up the spell
							// cast roll (d20) for healing spells like Cure Wounds whose damage
							// formula (e.g. 2d6) doesn't match the cast formula.
							if (message.rolls?.length > 0) {
								const cleanFinal = finalFormula.replace(/\s/g, "");
								roll = message.rolls.find(r => r.formula?.replace(/\s/g, "") === cleanFinal) ?? null;
							}

							if (roll) {
								// Use existing roll
							}
							else {
								roll = new Roll(finalFormula, rollData);
								await roll.evaluate();

								// Show 3D dice animation if Dice So Nice is available
								if (game.dice3d) {
									await game.dice3d.showForRoll(roll, game.user, true);
								}
							}

							totalDamage = roll.total;


							// Check damage requirement if it exists
							// For non-per-target damage, we evaluate the requirement without target
							// context
							if (spellDamageConfig.damageRequirement && spellDamageConfig.damageRequirement.trim() !== "") {
								// If the requirement has @target variables but we're not rolling
								// per-target,
								// we'll apply the requirement to each target when damage is
								// actually applied
								const requirementFormula =
									spellDamageConfig.damageRequirement.trim();

								// Only evaluate now if there are no target variables
								if (!requirementFormula.includes("@target.")) {
									const requirementMet = evaluateRequirement(
										requirementFormula,
										rollData
									);

									if (!requirementMet) {
										const failAction = spellDamageConfig.damageRequirementFailAction || "zero";
										if (failAction === "half") {
											totalDamage = Math.floor(totalDamage / 2);
										}
										else {
											totalDamage = 0;
										}
									}
								}
								else {
									// Store requirement info for per-target evaluation during
									// damage application
									window._damageRequirement = {
										formula: requirementFormula,
										failAction: spellDamageConfig.damageRequirementFailAction || "zero",
										casterData: rollData,
									};
								}
							}

							// Build detailed breakdown of the roll
							const diceBreakdown = roll.dice.map(d => {
								const results = d.results.map(r => r.result).join(", ");
								return `${d.number}${d.faces === "f" ? "dF" : `d${d.faces}`}: [${results}]`;
							}).join(" + ");

							const rollBreakdown = `${roll.formula} = ${diceBreakdown || totalDamage}`;


							// Store roll breakdown for use in damage card
							window._lastSpellRollBreakdown = rollBreakdown;
							// Store the actual Roll object so buildRollBreakdown can extract
							// individual dice
							window._lastSpellRoll = roll;
						}

						// AUTHOR: Save the finalized results to message flags for other clients
						const flagData = {
							totalDamage,
							damageType,
							rollBreakdown: window._lastSpellRollBreakdown,
							rollJSON: window._lastSpellRoll?.toJSON(),
							damageRequirement: window._damageRequirement,
							challengeResults: challengeResults,
							effectsChallengeResults: effectsChallengeResults,
						};

						if (window._perTargetDamage) {
							flagData.perTargetDamage = {};
							for (const [id, d] of Object.entries(window._perTargetDamage)) {
								flagData.perTargetDamage[id] = {
									damage: d.damage,
									formula: d.formula,
									rollJSON: d.roll.toJSON(),
								};
							}
						}

						// Cache locally immediately to prevent re-roll on quick re-render
						window._sdx_localDamageResults = window._sdx_localDamageResults || {};
						window._sdx_localDamageResults[message.id] = flagData;

						console.log("SDX | Setting spellDamageResults flag:", flagData);
						await message.setFlag(MODULE_ID, "spellDamageResults", flagData);

						// Allow the re-render from setFlag to handle final injection for
						// consistency
						return;
					}
					catch(error) {
						console.error("shadowdark-extras | Error rolling spell damage:", error);
						ui.notifications.error(`Invalid spell damage formula: ${formula}`);
						return;
					}
					finally {
						if (isAuthor) {
							window._sdx_calculatingMessages.delete(message.id);
						}
					}
				}
				else if (challengeResults || effectsChallengeResults) {
					// Case: No damage formula, but we have challenge results (either one or both)
					const flagData = {
						totalDamage: 0,
						damageType: "",
						challengeResults: challengeResults,
						effectsChallengeResults: effectsChallengeResults,
					};
					console.log("SDX | Setting spellDamageResults flag (Challenge Only):", flagData);
					await message.setFlag(MODULE_ID, "spellDamageResults", flagData);
					return;
				}
			}
			catch(error) {
				console.error("shadowdark-extras | Error rolling spell damage:", error);
				ui.notifications.error(`Invalid spell damage formula: ${formula}`);
				return;
			}
			finally {
				if (isAuthor) {
					window._sdx_calculatingMessages.delete(message.id);
				}
			}
		}

		// Re-read flags to ensure we have the latest (including challenge)
		const latestFlags = message.getFlag(MODULE_ID, "spellDamageResults");
		if (latestFlags?.challengeResults) {
			// Pass to builder
			window._latestChallengeResults = latestFlags.challengeResults;
		}
		if (latestFlags?.effectsChallengeResults) {
			window._latestEffectsChallengeResults = latestFlags.effectsChallengeResults;
		}
	}
	else if (itemType === "NPC Special Attack") {
		// NPC Special Attack Base Damage Handling (Manual Roll since no system roll exists)
		// Check for synced results first
		const syncedBaseResults = message.getFlag(MODULE_ID, "npcBaseDamage");
		if (syncedBaseResults) {
			totalDamage = syncedBaseResults.total;
		}
		else if (isAuthor && item.system.damage?.value) {
			try {
				let damageFormula = item.system.damage.value;
				const damageBonus = item.system.bonuses?.damageBonus;
				if (damageBonus) {
					damageFormula += ` + ${damageBonus}`;
				}
				const roll = new Roll(damageFormula);
				await roll.evaluate();

				if (game.dice3d) {
					game.dice3d.showForRoll(roll, game.user, true);
				}

				totalDamage = roll.total;

				// Persist result
				await message.setFlag(MODULE_ID, "npcBaseDamage", {
					total: totalDamage,
					json: roll.toJSON(),
				});
				return; // Allow re-render
			}
			catch(err) {
				console.error("shadowdark-extras | Error rolling NPC Special Attack base damage:", err);
			}
		}
	}
	// SD 4.x stores damage as a typed Roll on message.rolls; v3 stored under
	// flags.shadowdark.rolls.damage.roll.
	else {
		const damageRollData = readSdDamageRoll(message);
		if (typeof damageRollData.total === "number") {
			totalDamage = damageRollData.total;
		}
		else {
			// SD 4.x: the damage roll is added to message.rolls asynchronously by
			// rollDamageFromMessage(), which runs after ChatMessage.create() resolves.
			// If the rollConfig has a damage formula but the roll isn't in message.rolls
			// yet, bail out here — the re-render triggered when rollDamageFromMessage
			// calls msg.update({rolls}) will have the damage roll available.
			const hasPendingDamageRoll = !!(message.rollConfig?.damageRoll?.formula)
				&& !message.getRoll?.("damage");
			if (hasPendingDamageRoll) return;

			// Last resort: try to parse from the displayed total in the damage section
			const $damageTotal = html.find(".card-damage-roll-single .dice-total, .card-damage-rolls .dice-total").first();
			if ($damageTotal.length) {
				totalDamage = parseInt($damageTotal.text()) || 0;
			}
		}
	}


	// Check if spell has effects to apply
	let spellEffects = [];
	if ((isSpellWithDamage || isSpellWithEffects) && spellDamageConfig?.effects) {
		// Handle case where effects might be a string instead of an array
		if (typeof spellDamageConfig.effects === "string") {
			try {
				spellEffects = JSON.parse(spellDamageConfig.effects);
			}
			catch(err) {
				console.warn("shadowdark-extras | Could not parse spell effects:", err);
				spellEffects = [];
			}
		}
		else if (Array.isArray(spellDamageConfig.effects)) {
			spellEffects = spellDamageConfig.effects;
		}
	}

	// If this is an aura spell with applyToOriginator=false, skip effects for the originator
	// Effects will be applied via the aura enter/leave triggers instead
	if (hasAuraEnabled && auraConfig && auraConfig.applyToOriginator === false) {
		spellEffects = [];
	}

	// Check if this was a critical hit (for doubling bonus dice)
	const isCritical = readSdRollOutcome(message).isCriticalSuccess;

	// Check if spell has critical effects and this was a critical success
	// If critical effects exist, use them INSTEAD of normal effects
	if (
		isCritical
		&& (isSpellWithDamage || isSpellWithEffects)
		&& spellDamageConfig?.criticalEffects
	) {
		let criticalEffects = [];
		if (typeof spellDamageConfig.criticalEffects === "string") {
			try {
				criticalEffects = JSON.parse(spellDamageConfig.criticalEffects);
			}
			catch(err) {
				console.warn("shadowdark-extras | Could not parse spell critical effects:", err);
				criticalEffects = [];
			}
		}
		else if (Array.isArray(spellDamageConfig.criticalEffects)) {
			criticalEffects = spellDamageConfig.criticalEffects;
		}

		// If critical effects exist, replace normal effects with them
		if (criticalEffects.length > 0) {
			spellEffects = criticalEffects;
		}
	}

	// Get effect selection mode and apply it
	const effectSelectionMode = spellDamageConfig?.effectSelectionMode || "all";

	if (spellEffects.length > 1) {
		if (effectSelectionMode === "random") {
			// Randomly select one effect
			const randomIndex = Math.floor(Math.random() * spellEffects.length);
			const selectedEffect = spellEffects[randomIndex];
			spellEffects = [selectedEffect];
		}
		else if (effectSelectionMode === "prompt") {
			// Prompt mode: the click handler re-reads spellEffects from the
			// configured list, so no original-effects snapshot is needed here.
		}
		// 'all' mode: keep all effects as-is
	}

	// Check if weapon has effects to apply (from weapon bonus config)
	let weaponEffects = [];
	let weaponBonusDamage = null;
	if (item?.type === "Weapon") {
		const weaponBonusFlags = item.flags?.[MODULE_ID]?.weaponBonus;
		if (weaponBonusFlags?.enabled) {
			// Get target for requirement evaluation
			const targetToken = targets[0];
			const targetActor = targetToken?.actor;

			// Get weapon effects to apply
			weaponEffects = getWeaponEffectsToApply(item, actor, targetActor);

			// Check for synced weapon bonus results in flags
			const syncedWeaponResults = message.getFlag(MODULE_ID, "weaponBonusResults");
			if (syncedWeaponResults) {
				weaponBonusDamage = syncedWeaponResults;

				// Reconstruct Roll results if needed (though they are mainly used for display)
				// The breakdown logic will use bonusRollResults/criticalRollResults which are plain
				// objects
			}
			else if (isAuthor) {
				// Author calculates and persists results
				try {
					weaponBonusDamage = await calculateWeaponBonusDamage(
						item,
						actor,
						targetActor,
						isCritical
					);

					// Trigger Dice So Nice for author
					if (game.dice3d) {
						if (weaponBonusDamage.bonusRolls) {
							for (const roll of weaponBonusDamage.bonusRolls) {
								game.dice3d.showForRoll(roll, game.user, true);
							}
						}
						if (weaponBonusDamage.criticalRolls) {
							for (const roll of weaponBonusDamage.criticalRolls) {
								game.dice3d.showForRoll(roll, game.user, true);
							}
						}
					}

					// Detect whether the globalThis.SDX damage bonus was already baked into the
					// damage
					// roll formula by the renderRollDialogSD hook. Try both the underscore
					// and non-underscore forms in case one gets stripped by DataModel cleaning.
					const bonusInFormula = !!(
						message.rollConfig?.sdxBonusInDamageFormula
						|| message.rollConfig?._sdxDamageBonusInFormula
					);

					// Prepare results for flag (must be plain objects/JSON compatible)
					const persistData = {
						totalBonus: weaponBonusDamage.totalBonus,
						bonusFormula: weaponBonusDamage.bonusFormula,
						bonusParts: weaponBonusDamage.bonusParts,
						bonusRollResults: weaponBonusDamage.bonusRollResults,
						damageComponents: weaponBonusDamage.damageComponents,
						criticalExtraDice: weaponBonusDamage.criticalExtraDice,
						criticalExtraDiceFormula: weaponBonusDamage.criticalExtraDiceFormula,
						criticalBonus: weaponBonusDamage.criticalBonus,
						criticalFormula: weaponBonusDamage.criticalFormula,
						criticalRollResults: weaponBonusDamage.criticalRollResults,
						requirementsMet: weaponBonusDamage.requirementsMet,
						damageTypes: weaponBonusDamage.damageTypes,
						// Track usage info for decrementing after damage is applied
						appliedBonusIndicesWithUsage:
							weaponBonusDamage.appliedBonusIndicesWithUsage || [],
						weaponItemId: item?.id,
						actorId: actor?.id,
						// Persisted so the final render can skip the double-add without
						// reading from rollConfig (which may strip underscore props).
						bonusInFormula,
					};

					await message.setFlag(MODULE_ID, "weaponBonusResults", persistData);

					// Allow the re-render from setFlag to handle final injection for consistency
					return;
				}
				catch(err) {
					console.warn("shadowdark-extras | Failed to calculate weapon bonus damage:", err);
				}
			}
			else {
				// Not the author and no results yet - wait for sync
				return;
			}

			if (
				weaponBonusDamage?.requirementsMet
				&& (weaponBonusDamage.totalBonus !== 0 || weaponBonusDamage.criticalBonus !== 0)
			) {
				// bonusInFormula is stored inside weaponBonusResults (a module flag that
				// survives Foundry DataModel serialisation reliably). When true, the globalThis.SDX
				// bonus is already counted in readSdDamageRoll.total, so we must not add
				// it again. Critical-hit extra dice are always separate.
				const bonusAlreadyRolled = !!(weaponBonusDamage.bonusInFormula);
				totalDamage += (bonusAlreadyRolled ? 0 : weaponBonusDamage.totalBonus)
				             + weaponBonusDamage.criticalBonus;

				// If the bonus is already in the formula, strip its roll-result data so
				// buildRollBreakdown() doesn't also render it as an extra breakdown term
				// (that would show the correct total but display one extra +N in the UI).
				if (bonusAlreadyRolled) {
					weaponBonusDamage = {
						...weaponBonusDamage,
						totalBonus: 0,
						bonusFormula: "",
						bonusRollResults: [],
						damageComponents: [],
					};
				}

				// If weapon has specific damage types, override the generic "damage" type
				if (weaponBonusDamage.damageTypes && weaponBonusDamage.damageTypes.length > 0) {
					damageType = weaponBonusDamage.damageTypes[0]; // Take the first type for now
				}
			}
		}
	}
	else if (item?.type === "NPC Attack" || item?.type === "NPC Special Attack") {
		// NPC Attack Extra Damage Handling
		const extraDamagesFlag = item.getFlag(MODULE_ID, "extraDamages") || [];
		const extraDamages = Array.isArray(extraDamagesFlag)
			? extraDamagesFlag
			: Object.values(extraDamagesFlag);

		// Check for synced results first
		const syncedNpcResults = message.getFlag(MODULE_ID, "npcExtraDamage");
		if (syncedNpcResults) {
			weaponBonusDamage = syncedNpcResults;
		}
		else if (isAuthor && extraDamages.length > 0) {
			// Calculate extra damage
			let totalBonus = 0;
			let damageComponents = [];
			let bonusRollResults = []; // To store dice for display/breakdown

			for (const extra of extraDamages) {
				if (!extra.formula) continue;
				try {
					// Use Shadowdark's RollSD if available, or simplified Roll
					// We use standard Roll here since we just want the result
					const roll = new Roll(extra.formula);
					await roll.evaluate();

					// Show 3D dice if enabled
					if (game.dice3d) {
						game.dice3d.showForRoll(roll, game.user, true);
					}

					totalBonus += roll.total;

					const label = game.i18n.localize(`SHADOWDARK_EXTRAS.damage_type.${extra.damageType}`);

					damageComponents.push({
						formula: extra.formula,
						amount: roll.total,
						label: label,
						type: extra.damageType,
					});

					// Store dice results for breakdown
					let diceSum = 0;
					if (roll.dice.length > 0) {
						for (const die of roll.dice) {
							for (const result of die.results) {
								if (!result.active) continue;
								bonusRollResults.push({
									value: result.result,
									faces: die.faces,
									isMax: result.result === die.faces,
									isMin: result.result === 1,
									label: label,
								});
								diceSum += result.result;
							}
						}
					}

					// Add static modifier (difference between total and dice sum)
					const staticMod = roll.total - diceSum;
					if (staticMod !== 0) {
						bonusRollResults.push({
							value: staticMod,
							faces: 0,
							label: label,
						});
					}

				}
				catch(err) {
					console.error("shadowdark-extras | Error rolling NPC extra damage:", err);
				}
			}

			if (damageComponents.length > 0) {
				const persistData = {
					totalBonus,
					damageComponents,
					requirementsMet: true,
					damageTypes: [], // NPC attacks rely on baseDamageType flag for the base
					bonusRollResults,
					criticalBonus: 0,
					criticalFormula: "",
					criticalRollResults: [],
				};

				await message.setFlag(MODULE_ID, "npcExtraDamage", persistData);
				return; // Allow re-render
			}
		}

		if (weaponBonusDamage?.requirementsMet && weaponBonusDamage.totalBonus !== 0) {
			totalDamage += weaponBonusDamage.totalBonus;
		}
	}

	const hasWeaponBonuses = weaponBonusDamage
		&& weaponBonusDamage.requirementsMet
		&& (
			weaponBonusDamage.totalBonus !== 0
			|| (isCritical && weaponBonusDamage.criticalBonus !== 0)
		);

	// Combine spell effects and weapon effects
	const allEffects = [...spellEffects, ...weaponEffects];

	if (totalDamage === 0 && allEffects.length === 0) {
		return; // Nothing to apply
	}

	// Override targets based on effectsApplyToTarget setting
	// Damage/healing always applies to targets, only effects can apply to self
	const cardTargets = targets;


	// Get base damage type (use item flag for weapons, damageType for spells/others)
	// Get base damage type (use item flag for weapons/NPC attacks, damageType for spells/others)
	const baseDamageType = (item?.type === "Weapon" || item?.type === "NPC Attack" || item?.type === "NPC Special Attack")
		? (item.getFlag?.(MODULE_ID, "baseDamageType") || "physical")
		: damageType;

	// Check if this is a magical weapon attack
	const isMagicalWeapon = item?.type === "Weapon" && item?.system?.magicItem === true;

	// Check if challenge failed - if so, DO NOT auto apply
	// ALSO needed for buildDamageCardHtml
	let challengeResults = window._latestChallengeResults || message.getFlag(MODULE_ID, "spellDamageResults")?.challengeResults;
	const challengeFailed = spellDamageConfig?.challenge?.enabled
		&& challengeResults
		&& !challengeResults.success;

	// Check if EFFECTS challenge failed - if so, DO NOT apply conditions
	let effectsChallengeResults = message.getFlag(MODULE_ID, "spellDamageResults")?.effectsChallengeResults;
	if (!effectsChallengeResults) effectsChallengeResults = window._latestEffectsChallengeResults;

	// IF enabled AND (!results OR !results.success), then it failed.
	// But we must also trust the result if it exists, even if config is wonky on re-render
	const hasChallengeResults = !!effectsChallengeResults;
	const challengeFailedAndPresent = hasChallengeResults && !effectsChallengeResults.success;
	const effectsChallengeFailed = (
		spellDamageConfig?.effectsChallenge?.enabled
		&& (!effectsChallengeResults || !effectsChallengeResults.success)
	) || challengeFailedAndPresent;

	// Build the complete damage card HTML
	const { html: cardHtml, challengeHtml } = await buildDamageCardHtml(
		actor,
		cardTargets,
		totalDamage,
		damageType,
		allEffects,
		spellDamageConfig,
		settings,
		message,
		weaponBonusDamage,
		isCritical,
		item,
		casterTokenId,
		baseDamageType,
		isMagicalWeapon,
		challengeResults,
		effectsChallengeResults
	);
	// Insert Challenge HTML at the TOP (before the dice roll)
	if (challengeHtml) {
		const $diceRoll = html.find(".dice-roll, .card-damage-rolls").first();
		if ($diceRoll.length) {
			$diceRoll.before(challengeHtml);
		}
		else {
			html.find(".card-content").prepend(challengeHtml);
		}
	}

	// Cleanup window var
	window._latestChallengeResults = null;
	window._latestEffectsChallengeResults = null;


	// Insert the damage card after the chat card or message content
	// Skip injection if damage card is hidden from this player
	if (!hideDamageCardFromPlayer) {
		const $chatCard = html.find(".chat-card");

		if ($chatCard.length) {
			$chatCard.after(cardHtml);
		}
		else {
			const $messageContent = html.find(".message-content");
			$messageContent.append(cardHtml);
		}
	}

	await finalizeDamageCard({
		html,
		message,
		item,
		settings,
		hideDamageCardFromPlayer,
		isSpellWithDamage,
		isSpellWithEffects,
		hasWeaponBonuses,
		weaponBonusDamage,
		isCritical,
		baseDamageType,
		totalDamage,
		damageType,
		spellDamageConfig,
		targets,
		actor,
		auraCreatedThisCall,
		casterTokenId,
		placedTemplateId,
		allEffects,
		challengeFailed,
		effectsChallengeFailed,
	});
}
