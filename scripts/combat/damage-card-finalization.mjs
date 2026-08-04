import { readSdRollOutcome } from "../shared/sd4Compat.mjs";
import { attachDamageCardListeners, buildRollBreakdown } from "./damage-card.mjs";
import { _autoAppliedMessages } from "./combat-settings-app.mjs";
import { linkTargetToFocusSpell, startDurationSpell } from "../effects/FocusSpellTrackerSD.mjs";

const MODULE_ID = "shadowdark-extras";
const _durationStartedMessages = new Set();

export async function finalizeDamageCard({
	html, message, item, settings, hideDamageCardFromPlayer,
	isSpellWithDamage, isSpellWithEffects, hasWeaponBonuses, weaponBonusDamage,
	isCritical, baseDamageType, totalDamage, damageType, spellDamageConfig,
	targets, actor, auraCreatedThisCall, casterTokenId, placedTemplateId,
	allEffects, challengeFailed, effectsChallengeFailed,
}) {
	// Integrate the SD roll card with SDX theming when the SDX damage card is shown
	if (!hideDamageCardFromPlayer) {
		const $sdCard = html.find(".shadowdark.chat-card, .chat-card").first();
		if ($sdCard.length) {
			// Move the weapon icon/name row above the "Attack Roll" heading so it reads
			// as the card's own header rather than a separate floating section below.
			const $itemWrapper = $sdCard.find(".item-wrapper");
			const $firstHeading = $sdCard.find("h3.sub-heading").first();
			if ($itemWrapper.length && $firstHeading.length) {
				$firstHeading.before($itemWrapper.detach());
			}
			// Hide the Targets sub-section — the SDX card already lists targets.
			const $targetWrapper = $sdCard.find(".target-wrapper");
			$targetWrapper.prev("h3.sub-heading").hide();
			$targetWrapper.hide();
			// Mark the card so CSS can apply the integrated theme.
			$sdCard.addClass("sdx-integrated");
		}
	}

	// Attach event listeners (only if damage card was injected)
	if (!hideDamageCardFromPlayer) {
		attachDamageCardListeners(html, message.id);
	}
	else if (isSpellWithDamage || isSpellWithEffects || hasWeaponBonuses || allEffects.length > 0) {
		// If damage card is hidden, show a minimal summary for both spells AND
		// weapons (if they have bonuses)

		// Hide native damage rolls to avoid redundancy when showing our summary
		// This applies to Shadowdark's native weapon damage displays.
		// SD 4.x doesn't render `.chat-card` so these selectors silently no-op,
		// but we guard explicitly for clarity (per SD4-COMPAT-SWEEP-PLAN Phase 3.4).
		html.find(".card-damage-roll-single, .card-damage-rolls").hide();
		const $sdLegacyCard = html.find(".chat-card");
		if ($sdLegacyCard.length) {
			$sdLegacyCard.find('h3:contains("Damage Roll")').hide();
			$sdLegacyCard.find('h4:contains("Damage Roll")').hide();
		}

		// Build formula and results using buildRollBreakdown for consistency
		const rollSummary = await buildRollBreakdown(
			message, weaponBonusDamage, isCritical, baseDamageType
		);

		let formula = rollSummary?.formula || "";
		let results = rollSummary?.total || totalDamage;

		// Fallback for spell rolls
		if (!formula) {
			const roll = window._lastSpellRoll;
			if (roll) {
				formula = roll.formula;
			}
			else if (window._lastSpellRollBreakdown) {
				formula = window._lastSpellRollBreakdown.split(" = ")[0];
			}
		}

		// Build breakdown tooltip HTML if components exist
		let breakdownTooltipHtml = "";
		if (rollSummary?.components && rollSummary.components.length > 0) {
			const componentLines = rollSummary.components.map(c => {
				const displayType = (c.type && c.type !== "standard") ? c.type.charAt(0).toUpperCase() + c.type.slice(1).toLowerCase() : "";
				const typeLabel = displayType ? ` ${displayType}` : "";
				const labelText = c.label ? `[${c.label}] ` : "";
				const diceResults = (c.dice && c.dice.length > 0) ? ` [${c.dice.join(",")}] ` : " ";
				return `<div style="display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid rgba(0,0,0,0.05); padding: 2px 0;">
					<span style="font-size: 11px; white-space: nowrap;">${labelText}${c.formula}${diceResults}</span>
					<span style="font-weight: bold; font-size: 11px;">${c.total}${typeLabel}</span>
				</div>`;
			}).join("");

			breakdownTooltipHtml = `
				<div class="sdx-damage-tooltip" style="display: none; margin-top: 8px; padding: 4px 8px; background: rgba(0,0,0,0.03); border-radius: 4px; border: 1px solid rgba(0,0,0,0.05); text-align: left;">
					${componentLines}
				</div>
			`;
		}

		const minimalHtml = `
			<div class="sdx-minimal-damage-summary" style="margin-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); padding-top: 8px;">
				<div class="dice-roll sdx-expandable-roll" data-action="toggleDamageBreakdown" style="cursor: pointer; text-align: center;">
					<div class="dice-formula" style="font-size: 11px;">${formula}</div>
					<div class="dice-result">
						<div class="dice-total" style="background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 4px 12px; font-weight: bold; font-size: 16px; display: inline-block;">
							Total: ${results}
						</div>
						${breakdownTooltipHtml}
					</div>
				</div>
			</div>
		`;

		const $chatCard = html.find(".chat-card");
		if ($chatCard.length) {
			$chatCard.append(minimalHtml);
		}
		else {
			html.find(".message-content").append(minimalHtml);
		}
	}

	// Mark message as fully processed now that damage card is injected

	// Check if this is a Focus Check (spell focus maintenance roll)
	// Focus Checks should roll damage but NOT auto-apply effects (effects are already applied)
	const focusCheckText = game.i18n.localize("SHADOWDARK.chat.spell_focus_check");
	const isFocusCheck = message.flavor?.includes(focusCheckText)
		|| message.flavor?.includes("Focus Check");

	if (isFocusCheck) {
		// No-op: focus checks roll damage but skip effect auto-application
	}

	// Auto-apply damage and/or conditions based on separate settings
	// Only auto-apply if there's an attack roll that hit
	// IMPORTANT: Only the message author should auto-apply to prevent duplicates
	const messageAuthorId = message.author?.id ?? message.user?.id;
	const shouldAutoApplyDamage = settings.damageCard.autoApplyDamage;
	// Default to true for backwards compatibility if setting doesn't exist yet
	const shouldAutoApplyConditions = settings.damageCard.autoApplyConditions !== false;

	// For self-targeting spells, allow auto-apply even without external targets
	const effectsApplyToTargetAuto = spellDamageConfig?.effectsApplyToTarget === true;
	const hasSelfTargetAuto = !effectsApplyToTargetAuto && actor;
	const hasValidTargets = targets.length > 0 || hasSelfTargetAuto;


	const canApplyDamage = shouldAutoApplyDamage && !challengeFailed;
	const canApplyConditions = shouldAutoApplyConditions && !effectsChallengeFailed;

	if ((canApplyDamage || canApplyConditions)
		&& hasValidTargets
		&& messageAuthorId === game.user.id) {
		// Check if this was an attack that hit
		const autoApplyOutcome = readSdRollOutcome(message);
		const mainRoll = autoApplyOutcome.mainRoll;


		// Check for already applied flag (persistently) or in-memory (for immediate re-renders)
		const alreadyApplied = message.getFlag(MODULE_ID, "autoApplied") || _autoAppliedMessages.has(message.id);


		// Only auto-apply if:
		// 1. There's no main roll at all (pure damage roll with no attack), OR
		// 2. The main roll exists AND success is explicitly true (and not masked from this client)
		// AND 3. No aura was just created/processed to avoid double-application
		// AND 4. Has not already been applied
		const shouldAutoApply = !autoApplyOutcome.isMasked
			&& (!mainRoll || autoApplyOutcome.isSuccess)
			&& !auraCreatedThisCall
			&& !alreadyApplied;

		if (shouldAutoApply) {
			// Mark as applied immediately to prevent race conditions
			_autoAppliedMessages.add(message.id);
			// Persist the flag (async, but in-memory set handles the gap)
			message.setFlag(MODULE_ID, "autoApplied", true);
			// Wait a tiny bit for the card to fully render, then auto-click the apply button(s)
			setTimeout(() => {
				// Auto-apply damage if enabled
				if (canApplyDamage) {
					const $applyDamageBtn = html.find(".sdx-apply-damage-btn");
					if ($applyDamageBtn.length) {
						$applyDamageBtn.click();
					}
				}

				// Auto-apply conditions if enabled - BUT NOT for Focus Checks
				// Effects are already applied on the initial cast
				// ALSO NOT for NPC Features or NPC Spells (manual application only requested)
				if (canApplyConditions && !isFocusCheck && item?.type !== "NPC Feature" && item?.type !== "NPC Spell") {
					const $applyConditionBtn = html.find(".sdx-apply-condition-btn");
					if ($applyConditionBtn.length) {
						setTimeout(() => {
							$applyConditionBtn.click();
						}, 200); // Slight delay after damage
					}
				}
				else if (isFocusCheck) {
					// No-op: focus check effects were already applied on the initial cast
				}
			}, 100);
		}
		else {
			// No-op: not auto-applying (masked roll, miss, aura, or already applied)
		}
	}
	else if ((shouldAutoApplyDamage || shouldAutoApplyConditions)
		&& messageAuthorId !== game.user.id) {
		// No-op: only the message author auto-applies damage/conditions
	}

	// Add event listener for minimal summary toggle
	html.find('[data-action="toggleDamageBreakdown"]').on("click", event => {
		event.preventDefault();
		const $target = $(event.currentTarget);
		const $tooltip = $target.find(".sdx-damage-tooltip");
		$target.toggleClass("expanded");
		$tooltip.slideToggle(150);
	});

	// Start duration spell tracking if enabled
	// Only start if this is a spell with trackDuration enabled and cast was successful
	// AND we haven't already started it (e.g. for an aura)
	// AND it's NOT a focus spell (focus spells use focus tracker, not duration tracker)
	const isFocusSpell = item?.system?.duration?.type === "focus";
	if (item && ["Spell", "Scroll", "Wand", "NPC Spell"].includes(item.type)
		&& spellDamageConfig?.trackDuration
		&& !isFocusCheck
		&& !isFocusSpell
		&& messageAuthorId === game.user.id
		&& !message.getFlag(MODULE_ID, "durationTrackerStarted")) {

		const durationOutcome = readSdRollOutcome(message);
		const mainRoll = durationOutcome.mainRoll;
		// "No roll" (auto-success) OR roll succeeded. Skip on masked rolls.
		const castSuccessful = !durationOutcome.isMasked
			&& (!mainRoll || durationOutcome.isSuccess);

		if (castSuccessful) {
			// Create a unique key for this message's duration tracking
			const durationKey = `${message.id}-duration`;

			// Skip if already processed (in-memory check is synchronous and reliable)
			if (_durationStartedMessages.has(durationKey)) {
				return; // Already started tracking for this message
			}

			// Mark as processing immediately (before async operations)
			_durationStartedMessages.add(durationKey);

			try {
				// Get target token IDs for tracking
				let targetTokenIds = targets.map(t => t.id);

				// For "Self" range spells, if no targets are selected, use the caster's token
				// Range can be either a string directly (e.g., "self") or an object
				// with a value property
				const durationRawRange = item.system?.range;
				const durationSpellRange = (typeof durationRawRange === "string" ? durationRawRange : durationRawRange?.value || "").toLowerCase();
				if (targetTokenIds.length === 0 && durationSpellRange === "self") {
					const casterTokenId = message.speaker?.token;
					if (casterTokenId) {
						targetTokenIds = [casterTokenId];
					}
					else {
						// Fallback: find first token for this actor on the current scene
						const casterToken = canvas.tokens?.placeables.find(
							t => t.actor?.id === actor.id
						);
						if (casterToken) {
							targetTokenIds = [casterToken.id];
						}
					}
				}

				// Prepare spell config for duration tracking
				const durationConfig = {
					perTurnTrigger: spellDamageConfig.perTurnTrigger || "start",
					perTurnDamage: spellDamageConfig.perTurnDamage || "",
					reapplyEffects: spellDamageConfig.reapplyEffects || false,
					damageType: spellDamageConfig.damageType || "",
					effects: spellDamageConfig.effects || [],
					templateId: placedTemplateId || null,
				};

				// Clear the temp variable
				placedTemplateId = null;

				await startDurationSpell(actor, item, targetTokenIds, durationConfig);

				// Also mark message with flag for persistence (backup check)
				await message.setFlag(MODULE_ID, "durationTrackerStarted", true);
			}
			catch(durationError) {
				console.warn("shadowdark-extras | Failed to start duration spell tracking:", durationError);
			}
		}
	}

	// Link targets to focus spells if no effects are being applied
	// This ensures focus spells with only damage/healing (like Regenerate)
	// show targets in the tracker
	if (isFocusSpell && targets.length > 0 && allEffects.length === 0 && !isFocusCheck) {
		const spellId = item.id;
		const casterActor = actor;

		// Link each target to the focus spell
		for (const target of targets) {
			const targetActor = target.actor;
			const targetTokenId = target.id;

			if (targetActor) {
				await linkTargetToFocusSpell(
					casterActor.id, spellId, targetActor.id, targetTokenId
				);
			}
		}
	}

}
