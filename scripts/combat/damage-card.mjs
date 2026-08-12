// Damage-card pipeline — extracted from combat/CombatSettingsSD.mjs (Phase 5.1 split).
// DOM listener layer for the rendered damage card. The action layer (summon
// expiry, target-defense interaction, summon/item-giver/coating side effects)
// lives in damage-card-actions.mjs; pure builders + formula utilities live in
// damage-card-builders.mjs.

import { decrementDamageBonusUsage } from "./WeaponBonusConfig.mjs";
import { getSocket } from "../shared/combat-socket.mjs";
import {
	buildRollBreakdown,
	buildDamageCardHtml,
	normalizeConfiguredEffectUuids,
	evaluateFormulaExpressions,
	doubleDiceInFormula,
	parseTieredFormula,
	evaluateRequirement,
	buildTargetRollData,
} from "./damage-card-builders.mjs";
import {
	getSummonedTokensExpiry,
	saveSummonedTokensExpiry,
	trackSummonedTokensForExpiry,
	spawnSummonedCreatures,
	giveItemsToCaster,
	applyCoatingPoison,
	showEffectSelectionDialog,
	rollTargetDefenseCheck,
	rebuildTargetsList,
	attachMultiplierListeners,
	attachTargetEnableListeners,
	getUnresolvedDefenseTargets,
} from "./damage-card-actions.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Grey out the system's own apply-damage anchors on the message hosting this card.
 *
 * The system fades an anchor by adding `.damage-applied` (opacity 0.4) whenever
 * `flags.shadowdark.damageApplied` is set at render time. Setting that flag is what
 * makes the state stick; this only repaints the anchors already on screen so the fade
 * is immediate rather than waiting on the update round-trip.
 *
 * @param {jQuery} $card - The `.sdx-damage-card` element
 */
function markSystemAnchorsApplied($card) {
	$card
		.closest(".message-content")
		.find('[data-action="apply-damage"]')
		.addClass("damage-applied");
}

/**
 * Attach event listeners to damage card elements
 */
function attachDamageCardListeners(html, messageId) {
	const $card = html.find(".sdx-damage-card");

	// Header collapse/expand
	$card.find(".sdx-damage-card-header").on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $header = $(this);
		const $chevron = $header.find(".fa-chevron-down, .fa-chevron-up");
		const $content = $card.find(".sdx-damage-card-content");
		const $tabs = $card.find(".sdx-damage-card-tabs");
		const $rollBreakdown = $card.find(".sdx-roll-breakdown");

		// Toggle content visibility
		$content.slideToggle(200);
		$tabs.slideToggle(200);
		$rollBreakdown.slideToggle(200);

		// Toggle chevron direction
		if ($chevron.hasClass("fa-chevron-down")) {
			$chevron.removeClass("fa-chevron-down").addClass("fa-chevron-up");
		}
		else {
			$chevron.removeClass("fa-chevron-up").addClass("fa-chevron-down");
		}
	});

	$card.on("click", ".sdx-target-defense-roll", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);
		if ($btn.data("rolling")) return;

		$btn.data("rolling", true);
		$btn.prop("disabled", true);
		const originalHtml = $btn.html();
		$btn.html('<i class="fas fa-spinner fa-spin"></i> Rolling');

		try {
			await rollTargetDefenseCheck({
				messageId,
				tokenId: String($btn.data("token-id")),
				ability: String($btn.data("ability") || "dex"),
				dcFormula: String($btn.data("dc") || "12"),
				casterActorId: String($card.data("caster-actor-id") || ""),
			});
		}
		catch(err) {
			console.error("shadowdark-extras | Failed to roll target defense:", err);
			ui.notifications.error("Failed to roll target defense");
			$btn.prop("disabled", false);
			$btn.html(originalHtml);
			$btn.data("rolling", false);
		}
	});

	// Tab switching
	$card.find(".sdx-tab").on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $tab = $(this);
		if ($tab.hasClass("active")) return;

		// Update active tab
		$tab.siblings().removeClass("active");
		$tab.addClass("active");

		// Get base damage from card's data attribute
		const baseDamage = parseInt($card.data("base-damage")) || 0;

		// Rebuild targets list
		rebuildTargetsList($card, messageId, baseDamage);
	});

	// Initial multiplier listeners
	attachMultiplierListeners($card);

	// Initial target enable/disable listeners
	attachTargetEnableListeners($card);

	// Individual die click to reroll single die
	$card.on("click", ".sdx-die-clickable", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $die = $(this);
		const dieIndex = parseInt($die.data("die-index"));
		const faces = parseInt($die.data("faces"));

		if (isNaN(dieIndex) || isNaN(faces)) {
			console.warn("shadowdark-extras | Invalid die data for reroll");
			return;
		}


		// Roll a single die
		const roll = new Roll(`1d${faces} `);
		await roll.evaluate();
		const newValue = roll.total;

		// Determine CSS class for the new value
		const isCrit = newValue === faces;
		const isFumble = newValue === 1;
		const newCssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");

		// Update the die's display
		$die.text(newValue);
		$die.removeClass("sdx-die-max sdx-die-min").addClass(newCssClass);

		// Recalculate total by summing all dice and bonuses in the breakdown
		let newTotal = 0;
		const $breakdownLine = $card.find(".sdx-roll-breakdown-line");

		// Sum all dice values
		$breakdownLine.find(".sdx-die").each(function() {
			newTotal += parseInt($(this).text()) || 0;
		});

		// Sum all bonus values (considering the sign from adjacent plus/minus)
		$breakdownLine.find(".sdx-bonus-val").each(function() {
			const $bonus = $(this);
			const bonusValue = parseInt($bonus.text()) || 0;
			// Check if the previous sibling is a minus sign
			const $prev = $bonus.prev(".sdx-plus");
			if ($prev.length && $prev.text().includes("-")) {
				newTotal -= bonusValue;
			}
			else {
				newTotal += bonusValue;
			}
		});

		// Update the total display
		$breakdownLine.find(".sdx-roll-total").text(newTotal);

		// Update card data
		$card.attr("data-base-damage", newTotal);
		$card.data("base-damage", newTotal);

		// Update all target damage displays
		$card.find(".sdx-target-item").each(function() {
			const $targetItem = $(this);
			const $targetDamage = $targetItem.find(".sdx-damage-value");
			const $activeMultiplier = $targetItem.find(".sdx-multiplier-btn.active");
			const multiplier = parseFloat($activeMultiplier.data("multiplier")) || 1;
			const newDamage = Math.floor(newTotal * multiplier);

			$targetDamage.text(newDamage);
			$targetDamage.attr("data-base-damage", newDamage);
		});

		// Show notification
		ui.notifications.info(`Rerolled d${faces}: ${newValue} (new total: ${newTotal})`);
	});

	// Reroll damage button click
	$card.on("click", ".sdx-reroll-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);
		const formula = $btn.data("formula");
		const weaponBonusDataStr = $btn.attr("data-weapon-bonus");

		if (!formula) {
			ui.notifications.warn("No damage formula to reroll");
			return;
		}

		// Disable button temporarily
		$btn.prop("disabled", true);
		$btn.find("i").removeClass("fa-dice").addClass("fa-spinner fa-spin");

		try {
			// Roll the base formula
			const roll = new Roll(formula);
			await roll.evaluate();

			// Parse weapon bonus data if present
			let weaponBonus = null;
			if (weaponBonusDataStr) {
				try {
					weaponBonus = JSON.parse(weaponBonusDataStr);
				}
				catch(e) {
					console.warn("shadowdark-extras | Could not parse weapon bonus data:", e);
				}
			}

			// Roll weapon bonus formulas if they exist
			let newBonusTotal = 0;
			let newCriticalTotal = 0;
			const bonusDiceResults = [];

			if (weaponBonus?.bonusFormula) {
				const bonusRoll = new Roll(weaponBonus.bonusFormula);
				await bonusRoll.evaluate();
				newBonusTotal = bonusRoll.total;

				// Extract dice results from bonus roll
				for (const term of bonusRoll.terms) {
					if (term.faces !== undefined && term.results) {
						for (const r of term.results) {
							const val = r.result;
							const isCrit = val === term.faces;
							const isFumble = val === 1;
							const cssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");
							bonusDiceResults.push({
								value: val, cssClass, faces: term.faces, isBonus: true,
							});
						}
					}
				}
			}

			if (weaponBonus?.criticalFormula) {
				const critRoll = new Roll(weaponBonus.criticalFormula);
				await critRoll.evaluate();
				newCriticalTotal = critRoll.total;

				// Extract dice results from critical roll
				for (const term of critRoll.terms) {
					if (term.faces !== undefined && term.results) {
						for (const r of term.results) {
							const val = r.result;
							const isCrit = val === term.faces;
							const isFumble = val === 1;
							const cssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");
							bonusDiceResults.push({
								value: val, cssClass, faces: term.faces, isCritBonus: true,
							});
						}
					}
				}
			}

			// Build new breakdown HTML
			const dice = roll.terms.filter(t => t.faces !== undefined);
			const diceResults = [];

			for (const die of dice) {
				const faces = die.faces;
				const results = die.results || [];
				for (const r of results) {
					const val = r.result;
					const isCrit = val === faces;
					const isFumble = val === 1;
					const cssClass = isCrit ? "sdx-die-max" : (isFumble ? "sdx-die-min" : "");
					diceResults.push({ value: val, cssClass, faces });
				}
			}

			// Get static bonuses from roll terms (like STR modifier)
			const bonuses = [];
			let operator = "+";
			for (const term of roll.terms) {
				if (term.operator) {
					operator = term.operator;
					continue;
				}
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

			// Calculate total including weapon bonuses
			let totalDamage = roll.total + newBonusTotal + newCriticalTotal;


			// Build breakdown parts
			const breakdownParts = [];

			// Add base dice results with data attributes for individual rerolling
			let dieIndex = 0;
			for (const die of diceResults) {
				breakdownParts.push({
					html: `<span class="sdx-die sdx-die-clickable ${die.cssClass}" data-die-index="${dieIndex}" data-faces="${die.faces}" title="Click to reroll this d${die.faces}">${die.value}</span>`,
					value: die.value,
					faces: die.faces,
				});
				dieIndex++;
			}

			// Add static bonuses (like STR modifier)
			for (const bonus of bonuses) {
				const absValue = Math.abs(bonus.value);
				breakdownParts.push({
					html: `<span class="sdx-bonus-val" title="${foundry.utils.escapeHTML(bonus.label || "")}">${absValue}</span>`,
					value: bonus.value,
				});
			}

			// Add weapon bonus dice results (styled differently, also clickable)
			for (const die of bonusDiceResults) {
				const extraClass = die.isCritBonus ? "sdx-crit-bonus" : "sdx-weapon-bonus";
				breakdownParts.push({
					html: `<span class="sdx-die sdx-die-clickable ${die.cssClass} ${extraClass}" data-die-index="${dieIndex}" data-faces="${die.faces}" title="Click to reroll this d${die.faces}">${die.value}</span>`,
					value: die.value,
					faces: die.faces,
				});
				dieIndex++;
			}

			// Build HTML string
			const partsHtml = breakdownParts.map((part, index) => {
				if (index === 0) return part.html;
				if (part.value < 0) return `<span class="sdx-plus"> - </span> ${part.html} `;
				return `<span class="sdx-plus"> + </span> ${part.html} `;
			}).join("");

			const newBreakdownHtml = `
						<div class="sdx-roll-breakdown-line">
					<span class="sdx-roll-total">${totalDamage}</span>
					<span class="sdx-equals"> = </span>
					${partsHtml}
				</div>
						`;

			// Update the card
			$card.find(".sdx-roll-breakdown-line").replaceWith(newBreakdownHtml);
			$card.attr("data-base-damage", totalDamage);
			$card.data("base-damage", totalDamage);

			// Update all target damage displays
			const $targetItems = $card.find(".sdx-target-item");

			$targetItems.each(function() {
				const $targetItem = $(this);
				const $targetDamage = $targetItem.find(".sdx-damage-value");
				const $activeMultiplier = $targetItem.find(".sdx-multiplier-btn.active");
				const multiplier = parseFloat($activeMultiplier.data("multiplier")) || 1;
				const newDamage = Math.floor(totalDamage * multiplier);


				$targetDamage.text(newDamage);
				$targetDamage.attr("data-base-damage", newDamage);
			});

			// Show notification
			ui.notifications.info(`Rerolled damage: ${totalDamage} `);

		}
		catch(err) {
			console.error("shadowdark-extras | Error rerolling damage:", err);
			ui.notifications.error("Failed to reroll damage");
		}
		finally {
			// Re-enable button
			$btn.prop("disabled", false);
			$btn.find("i").removeClass("fa-spinner fa-spin").addClass("fa-dice");
		}
	});

	// Apply damage button click (use delegation since button may be rebuilt)
	// Apply damage button click (use delegation since button may be rebuilt)
	$card.on("click", ".sdx-apply-damage-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);

		// Check for GM-only restriction
		const settings = game.settings.get(MODULE_ID, "combatSettings");
		if (settings.damageCard?.gmOnlyApplyDamage && !game.user.isGM) {
			ui.notifications.warn("The GM has disabled Apply Damage. Ask him/her why! Worried you might cheat? Probably!");
			return;
		}

		// Prevent duplicate applications
		if ($btn.data("applying")) {
			return;
		}

		// v14/SD4.x: Hard-block double-apply via persisted flag.
		// jQuery handlers fire on disabled buttons through delegation, and re-renders
		// reset the in-memory `applying` state — so the message flag is the source of
		// truth. Once damage was applied (auto OR manual), refuse a second apply.
		const messageDoc = game.messages.get(messageId);
		if (messageDoc?.getFlag?.(MODULE_ID, "damageApplied") || $btn.attr("data-already-applied") === "true") {
			ui.notifications.info("Damage already applied to this card.");
			$btn.prop("disabled", true);
			$btn.html('<i class="fas fa-check"></i> APPLIED');
			return;
		}

		$btn.data("applying", true);
		$btn.prop("disabled", true);


		try {
			const $targets = $card.find(".sdx-target-item");
			const unresolvedDefenses = getUnresolvedDefenseTargets($card);
			if (unresolvedDefenses.length > 0) {
				ui.notifications.warn("Resolve target defense checks before applying damage.");
				$btn.prop("disabled", false);
				$btn.data("applying", false);
				const damageType = $card.data("damage-type") || "damage";
				const buttonText = damageType === "healing" ? "APPLY HEALING" : "APPLY DAMAGE";
				const buttonIcon = damageType === "healing" ? "fa-heart-pulse" : "fa-hand-sparkles";
				$btn.html(`<i class="fas ${buttonIcon}"></i> ${buttonText}`);
				return;
			}

			const damageType = $card.data("damage-type") || "damage";
			const isHealing = damageType?.trim().toLowerCase() === "healing";

			console.log(`shadowdark-extras | Apply Button Clicked | Type: ${damageType} | isHealing: ${isHealing}`);

			let appliedCount = 0;

			for (const targetEl of $targets) {
				const $target = $(targetEl);

				// Skip disabled targets
				const isEnabled = $target.data("enabled") !== false && $target.attr("data-enabled") !== "false";
				if (!isEnabled) {
					continue;
				}

				const tokenId = $target.data("token-id");
				const token = canvas.tokens.get(tokenId);

				let calculatedDamage = $target.data("calculated-damage");

				if (calculatedDamage === undefined || calculatedDamage === null) {
					const $damageValue = $target.find(".sdx-damage-value");
					calculatedDamage = parseInt($damageValue.text()) || 0;

					// If it's healing, make damage negative
					if (isHealing) {
						calculatedDamage = -calculatedDamage;
					}
				}

				const $defense = $target.find(".sdx-target-defense");
				if ($defense.length && $defense.attr("data-defense-success") === "true") {
					const defenseAction = $defense.data("defense-action") || "avoid";
					if (defenseAction === "half") {
						calculatedDamage = Math.floor(calculatedDamage / 2);
					}
					else {
						calculatedDamage = 0;
					}
				}

				// Check if we need to evaluate a per-target damage requirement
				if (window._damageRequirement && token && token.actor) {
					const reqInfo = window._damageRequirement;
					try {
						// Build roll data with target context
						const targetRollData = foundry.utils.duplicate(reqInfo.casterData);

						// Create target object in rollData
						targetRollData.target = buildTargetRollData(token.actor);

						// Evaluate the requirement
						const requirementMet = evaluateRequirement(reqInfo.formula, targetRollData);

						if (!requirementMet) {
							if (reqInfo.failAction === "half") {
								calculatedDamage = Math.floor(calculatedDamage / 2);
							}
							else {
								calculatedDamage = 0;
							}
						}
					}
					catch(err) {
						console.warn(`shadowdark - extras | Failed to evaluate requirement for target ${tokenId}: `, err);
					}
				}


				// Socket handler expects negative values for healing
				// Make damage negative if this is healing
				const finalDamageForSocket = isHealing
					? -Math.abs(calculatedDamage)
					: calculatedDamage;

				if (calculatedDamage === 0) {
					continue;
				}

				// Use socketlib to apply damage via GM
				if (getSocket()) {
					try {
						const damageType = $card.data("damage-type") || "damage";

						// Get damage components from weapon bonus data if available
						let damageComponents = [];
						const $rerollBtn = $card.find(".sdx-reroll-btn");
						if ($rerollBtn.length) {
							const weaponBonusAttr = $rerollBtn.attr("data-weapon-bonus");
							if (weaponBonusAttr) {
								try {
									const weaponBonusData = JSON.parse(weaponBonusAttr.replace(/&quot;/g, '"'));
									damageComponents = weaponBonusData.damageComponents || [];
								}
								catch(e) {
									console.warn("shadowdark-extras | Failed to parse weapon bonus data:", e);
								}
							}
						}

						// Calculate base damage (total minus bonus components)
						const totalBonusDamage = damageComponents.reduce(
							(sum, c) => sum + (c.amount || 0),
							0
						);
						const weaponBaseDamage = Math.max(0, calculatedDamage - totalBonusDamage);

						// Get base damage type from card data (set by weapon flags)
						const baseDamageType = $card.data("base-damage-type") || damageType || "standard";

						// Check if this is a magical weapon attack
						const isMagicalWeapon = $card.data("is-magical-weapon") === true || $card.data("is-magical-weapon") === "true";

						console.log("shadowdark-extras | Executing Socket | Payload:", { tokenId, damage: finalDamageForSocket, isHealing, damageType });

						const success = await getSocket().executeAsGM("applyTokenDamage", {
							tokenId: tokenId,
							damage: finalDamageForSocket,
							isHealing: isHealing,
							damageType: damageType,
							damageComponents: damageComponents,
							baseDamage: weaponBaseDamage,
							baseDamageType: baseDamageType,
							isMagicalWeapon: isMagicalWeapon,
						});


						if (success) {
							appliedCount++;
						}
						else {
							console.warn("shadowdark-extras | Failed to apply damage to token:", tokenId);
						}
					}
					catch(socketError) {
						console.error("shadowdark-extras | Socket error applying damage:", socketError);
					}
				}
				else {
					console.error("shadowdark-extras | socketlib not initialized");
					ui.notifications.error("Socket communication not available");
				}
			}

			if (appliedCount > 0) {
				const appliedText = isHealing ? "Healing" : "Damage";
				ui.notifications.info(`${appliedText} applied to ${appliedCount} target(s)`);
				$btn.html('<i class="fas fa-check"></i> APPLIED');
				$btn.attr("data-already-applied", "true");
				// The system's own `.apply-damage` anchors sit on this same message, and
				// SDX has just applied the damage they would apply. Fade them now so the
				// card reads the same as a manual system apply.
				markSystemAnchorsApplied($card);

				// v14/SD4.x: Persist applied state so re-renders show "APPLIED" and the
				// click handler refuses a second apply attempt. The matching system-scope
				// flag makes the system re-add `.damage-applied` to its own anchors on
				// every later render, and turns a stray click there into the system's
				// reapply confirmation instead of a silent double-apply. Written with
				// setFlag rather than one flattened update() so both writes stay visible
				// to the flag-inventory gate.
				try {
					const persistMsg = game.messages.get(messageId);
					if (persistMsg && !persistMsg.getFlag(MODULE_ID, "damageApplied")) {
						await persistMsg.setFlag(MODULE_ID, "damageApplied", true);
					}
					if (persistMsg && !persistMsg.getFlag("shadowdark", "damageApplied")) {
						await persistMsg.setFlag("shadowdark", "damageApplied", true);
					}
				}
				catch(flagErr) {
					console.warn("shadowdark-extras | Failed to persist damageApplied flag:", flagErr);
				}

				// Decrement weapon bonus usage for bonuses that have limited uses
				try {
					const messageId = $card.data("message-id");
					if (messageId) {
						const message = game.messages.get(messageId);
						const weaponBonusResults = message?.getFlag(MODULE_ID, "weaponBonusResults");
						if (weaponBonusResults?.appliedBonusIndicesWithUsage?.length > 0
							&& weaponBonusResults.weaponItemId && weaponBonusResults.actorId) {
							const ownerActor = game.actors.get(weaponBonusResults.actorId);
							const weaponItem = ownerActor?.items.get(
								weaponBonusResults.weaponItemId
							);
							if (weaponItem) {
								await decrementDamageBonusUsage(
									weaponItem,
									weaponBonusResults.appliedBonusIndicesWithUsage
								);
							}
						}
					}
				}
				catch(decrementError) {
					console.warn("shadowdark-extras | Failed to decrement weapon bonus usage:", decrementError);
				}
			}
			else {
				ui.notifications.warn("No damage to apply");
				$btn.html('<i class="fas fa-exclamation"></i> NO TARGETS');
			}

			setTimeout(() => {
				// On successful apply, leave the button locked at "APPLIED" — re-enabling would
				// invite a double-apply. Only restore the original label when nothing applied
				// (user can fix targets and retry).
				if (appliedCount > 0) {
					$btn.data("applying", false);
					return;
				}
				const damageType = $card.data("damage-type") || "damage";
				const buttonText = damageType === "healing" ? "APPLY HEALING" : "APPLY DAMAGE";
				const buttonIcon = damageType === "healing" ? "fa-heart-pulse" : "fa-hand-sparkles";
				$btn.html(`<i class="fas ${buttonIcon}"></i> ${buttonText}`);
				$btn.prop("disabled", false);
				$btn.data("applying", false);
			}, 2000);

		}
		catch(error) {
			console.error("shadowdark-extras | Error applying damage:", error);
			ui.notifications.error(`Failed to apply damage: ${error.message}`);
			$btn.prop("disabled", false);
			$btn.data("applying", false);
		}
	});

	// Apply condition button click
	$card.on("click", ".sdx-apply-condition-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);

		// Prevent duplicate applications
		if ($btn.data("applying")) {
			return;
		}

		// v14/SD4.x: Hard-block double-apply.
		// jQuery click handlers still fire on disabled <button>s via delegation, and chat
		// message re-renders rebuild the DOM with a fresh `applying` data state — so the
		// in-memory guard above is not enough. The persisted message flag is the source of
		// truth: once conditions were applied (auto OR manual), refuse further applies.
		const messageDoc = game.messages.get(messageId);
		if (messageDoc?.getFlag?.(MODULE_ID, "conditionsApplied") || $btn.attr("data-already-applied") === "true") {
			ui.notifications.info("Conditions already applied to this card.");
			$btn.prop("disabled", true);
			$btn.html('<i class="fas fa-check"></i> APPLIED');
			return;
		}

		$btn.data("applying", true);
		$btn.prop("disabled", true);


		try {
			const unresolvedDefenses = getUnresolvedDefenseTargets($card);
			if (unresolvedDefenses.length > 0) {
				ui.notifications.warn("Resolve target defense checks before applying conditions.");
				$btn.prop("disabled", false);
				$btn.data("applying", false);
				$btn.html('<i class="fas fa-wand-sparkles"></i> APPLY CONDITION');
				return;
			}

			const effectsJson = $btn.data("effects");
			const applyToTarget = $btn.data("apply-to-target");
			const effectsRequirement = $btn.data("effects-requirement") || "";

			// Get spell info for focus spell tracking
			const spellInfoAttr = $btn.attr("data-spell-info");
			let spellInfo = null;
			if (spellInfoAttr) {
				try {
					spellInfo = JSON.parse(spellInfoAttr);
				}
				catch(err) {
					console.warn("shadowdark-extras | Could not parse spell info:", err);
				}
			}

			let effects = [];
			if (typeof effectsJson === "string") {
				effects = JSON.parse(effectsJson);
			}
			else if (Array.isArray(effectsJson)) {
				effects = effectsJson;
			}

			console.log("%c[SDX APPLY CONDITION] Effects to apply:", "color: cyan; font-weight: bold", effects);


			if (effects.length === 0) {
				ui.notifications.warn("No conditions to apply");
				$btn.prop("disabled", false);
				$btn.data("applying", false);
				return;
			}

			// Handle 'prompt' selection mode - show dialog to select effects
			const effectSelectionMode = $btn.data("effect-selection-mode") || "all";
			if (effectSelectionMode === "prompt" && effects.length > 1) {

				// Build effect names for the dialog by resolving UUIDs
				const effectOptions = [];
				for (const effectData of effects) {
					const effectUuid = typeof effectData === "string" ? effectData : effectData.uuid;
					try {
						const effectDoc = await fromUuid(effectUuid);
						effectOptions.push({
							uuid: effectUuid,
							name: effectDoc?.name || "Unknown Effect",
							img: effectDoc?.img || "icons/svg/mystery-man.svg",
							data: effectData,
						});
					}
					catch(err) {
						effectOptions.push({
							uuid: effectUuid,
							name: "Unknown Effect",
							img: "icons/svg/mystery-man.svg",
							data: effectData,
						});
					}
				}

				// Show selection dialog
				const selectedEffects = await showEffectSelectionDialog(effectOptions);

				if (!selectedEffects || selectedEffects.length === 0) {
					$btn.prop("disabled", false);
					$btn.data("applying", false);
					return;
				}

				// Replace effects with user selection
				effects = selectedEffects;
			}

			// Get caster data for requirement evaluation
			const casterActorId = $card.data("caster-actor-id");
			const casterActor = casterActorId ? game.actors.get(casterActorId) : null;
			let casterRollData = {};
			if (casterActor) {
				casterRollData = casterActor.getRollData() || {};
				// Flatten level
				if (casterRollData.level && typeof casterRollData.level === "object" && casterRollData.level.value !== undefined) {
					casterRollData.level = casterRollData.level.value;
				}
				// Add ability modifiers
				if (casterRollData.abilities) {
					["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
						if (casterRollData.abilities[ability]?.mod !== undefined) {
							casterRollData[ability] = casterRollData.abilities[ability].mod;
						}
						if (casterRollData.abilities[ability]?.value !== undefined) {
							casterRollData[`${ability}Base`] = casterRollData.abilities[ability].value;
						}
					});
				}
				// Add stats
				if (casterRollData.attributes?.ac?.value !== undefined) {
					casterRollData.ac = casterRollData.attributes.ac.value;
				}
				if (casterRollData.attributes?.hp?.value !== undefined) {
					casterRollData.hp = casterRollData.attributes.hp.value;
				}
			}

			// Get card targets (enemies shown in the card)
			const $cardTargets = $card.find(".sdx-target-item");
			const cardTargets = $cardTargets.map((i, el) => canvas.tokens.get($(el).data("token-id"))).get().filter(t => t);
			console.log("%c[SDX APPLY CONDITION] Card targets found:", "color: lime; font-weight: bold", cardTargets.map(t => ({ id: t.id, name: t.name })));

			// Get caster token using the stored token ID (the actual token that attacked/cast)
			const casterTokenId = $card.data("caster-token-id");
			let casterToken = null;
			if (casterTokenId) {
				casterToken = canvas.tokens.get(casterTokenId);
			}
			// Fallback to finding by actor ID if token ID not available
			if (!casterToken && casterActor) {
				casterToken = canvas.tokens.placeables.find(t => t.actor?.id === casterActorId);
			}

			let appliedCount = 0;
			let skippedCount = 0;

			// Apply each effect to appropriate tokens based on individual effect settings
			for (const effectData of effects) {
				// Handle both old format (string UUID) and new format
				// (object with uuid, duration, applyToTarget)
				const effectUuid = typeof effectData === "string" ? effectData : effectData.uuid;
				const duration = typeof effectData === "object" && effectData.duration ? effectData.duration : {};
				// Check individual effect's applyToTarget setting, fall back to global setting
				const effectApplyToTarget = typeof effectData === "object" && effectData.applyToTarget !== undefined
					? effectData.applyToTarget
					: applyToTarget;
				// Check individual effect's cumulative setting
				// (default true for backward compatibility)
				const effectCumulative = typeof effectData === "object" && effectData.cumulative !== undefined
					? effectData.cumulative
					: true;

				// Determine which tokens to apply this effect to
				// Tab override: If there are targets shown in the current tab, use those
				// regardless of the effectApplyToTarget setting. This allows users to
				// manually apply self-effects to other tokens via Selected/Targeted tabs.
				let effectTargets = [];
				if (cardTargets.length > 0) {
					// Use targets from the current tab (override)
					effectTargets = cardTargets;
				}
				else if (effectApplyToTarget) {
					// No targets in tab, but configured to apply to target
					// - keep empty (will show warning)
					effectTargets = [];
				}
				else if (casterToken) {
					// No targets in tab and configured for self - apply to caster
					effectTargets = [casterToken];
				}

				if (effectTargets.length === 0) {
					continue;
				}

				// Apply to each target for this effect
				for (const target of effectTargets) {
					const $targetRow = $card.find(`.sdx-target-item[data-token-id="${target.id}"]`);
					const $defense = $targetRow.find(".sdx-target-defense");
					if ($defense.length && $defense.attr("data-defense-success") === "true" && ($defense.data("defense-action") || "avoid") === "avoid") {
						skippedCount++;
						continue;
					}

					// Check effects requirement if it exists (only for target-directed effects)
					let requirementMet = true;
					if (effectApplyToTarget && effectsRequirement && effectsRequirement.trim() !== "") {
						try {
							const targetRollData = foundry.utils.duplicate(casterRollData);

							// Add target data if available
							if (target.actor) {
								targetRollData.target = buildTargetRollData(target.actor);
							}

							// Evaluate the requirement
							requirementMet = evaluateRequirement(
								effectsRequirement,
								targetRollData
							);
							if (!requirementMet) {
								skippedCount++;
								continue; // Skip this target
							}
						}
						catch(err) {
							console.warn(`shadowdark - extras | Failed to evaluate effects requirement for target ${target.id}: `, err);
							// On error, assume requirement is met (fail-open)
						}
					}


					// Use socketlib to apply condition via GM
					console.log("%c[SDX APPLY CONDITION] Applying to target:", "color: orange; font-weight: bold", { targetId: target.id, targetName: target.name, effectUuid });
					if (getSocket()) {
						try {
							const success = await getSocket().executeAsGM("applyTokenCondition", {
								tokenId: target.id,
								effectUuid: effectUuid,
								duration: duration,
								spellInfo: spellInfo,  // Pass spell info for focus tracking
								cumulative: effectCumulative,  // Pass cumulative flag
							});

							if (success === true) {
								appliedCount++;
							}
							else {
								console.warn("shadowdark-extras | Failed to apply condition to token:", target.id);
							}
						}
						catch(socketError) {
							console.error("shadowdark-extras | Socket error applying condition:", socketError);
						}
					}
					else {
						console.error("shadowdark-extras | socketlib not initialized");
						ui.notifications.error("Socket communication not available");
					}
				}
			}


			if (appliedCount > 0) {
				let message = `Applied ${appliedCount} condition(s)`;
				if (skippedCount > 0) {
					message += ` (${skippedCount} skipped - requirement not met)`;
				}
				ui.notifications.info(message);
				$btn.html('<i class="fas fa-check"></i> APPLIED');
				$btn.attr("data-already-applied", "true");
				// v14/SD4.x: Persist applied state so re-renders show "APPLIED" and the
				// click handler refuses a second apply attempt.
				try {
					const messageDoc = game.messages.get(messageId);
					if (messageDoc && !messageDoc.getFlag(MODULE_ID, "conditionsApplied")) {
						await messageDoc.setFlag(MODULE_ID, "conditionsApplied", true);
					}
				}
				catch(flagErr) {
					console.warn("shadowdark-extras | Failed to persist conditionsApplied flag:", flagErr);
				}
			}
			else if (skippedCount > 0) {
				ui.notifications.warn("No conditions applied - requirement not met for any target");
				$btn.html('<i class="fas fa-exclamation"></i> REQ FAILED');
			}
			else {
				ui.notifications.warn("No conditions were applied - no valid targets");
			}
		}
		catch(err) {
			console.error("shadowdark-extras | Error applying conditions:", err);
			ui.notifications.error("Failed to apply conditions");
			$btn.prop("disabled", false);
			$btn.data("applying", false);
		}
	});

	// Summon creatures button click
	$card.on("click", ".sdx-summon-creatures-btn", async function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);

		// Prevent duplicate summonings
		if ($btn.data("summoning")) {
			return;
		}

		$btn.data("summoning", true);
		$btn.prop("disabled", true);


		try {
			const profilesJson = $btn.data("profiles");
			let profiles = [];
			if (typeof profilesJson === "string") {
				profiles = JSON.parse(profilesJson);
			}
			else if (Array.isArray(profilesJson)) {
				profiles = profilesJson;
			}
			else if (profilesJson && typeof profilesJson === "object") {
				profiles = Object.values(profilesJson);
			}


			if (profiles.length === 0) {
				ui.notifications.warn("No summon profiles configured");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Check if Portal library is available
			if (typeof Portal === "undefined") {
				ui.notifications.error("Portal library is required for summoning but not found");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Get the caster token to use as origin
			const casterActorId = $card.data("caster-actor-id");
			const casterActor = casterActorId ? game.actors.get(casterActorId) : null;
			const casterToken = casterActor
				? canvas.tokens.placeables.find(t => t.actor?.id === casterActorId)
				: null;

			if (!casterToken) {
				ui.notifications.warn("Could not find caster token for summoning");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Create Portal instance
			const portal = new Portal();
			portal.origin(casterToken);

			// Add all creature profiles
			let validProfileCount = 0;
			for (const profile of profiles) {
				const creatureUuid = profile?.creatureUuid || profile?.creature || profile?.uuid || "";
				if (!creatureUuid) {
					console.warn("shadowdark-extras | Skipping profile with no creature UUID:", profile);
					continue;
				}
				validProfileCount += 1;

				// Add creature with count and display name
				portal.addCreature({
					creature: creatureUuid,
					count: profile.count || "1",
					displayName: profile.displayName || "",
				});
			}

			if (validProfileCount === 0) {
				ui.notifications.warn("No summon creatures are configured. Drop an actor into the summon row first.");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
				return;
			}

			// Show dialog and spawn
			const spawnedTokens = await portal.dialog({
				spawn: true,
				multipleChoice: true, // Allow selecting which creatures to summon
				title: "Summon Creatures",
			});

			if (spawnedTokens && spawnedTokens.length > 0) {
				ui.notifications.info(`Summoned ${spawnedTokens.length} creature(s)`);
				$btn.html('<i class="fas fa-check"></i> SUMMONED');
			}
			else {
				ui.notifications.info("Summoning cancelled");
				$btn.prop("disabled", false);
				$btn.data("summoning", false);
			}
		}
		catch(err) {
			console.error("shadowdark-extras | Error summoning creatures:", err);
			ui.notifications.error("Failed to summon creatures");
			$btn.prop("disabled", false);
			$btn.data("summoning", false);
		}
	});
}

// Public surface: attachDamageCardListeners stays local; the action layer and
// the pure builders are re-exported so external importers keep working.
export {
	attachDamageCardListeners,
	getSummonedTokensExpiry,
	saveSummonedTokensExpiry,
	trackSummonedTokensForExpiry,
	spawnSummonedCreatures,
	giveItemsToCaster,
	applyCoatingPoison,
	buildRollBreakdown,
	buildDamageCardHtml,
	normalizeConfiguredEffectUuids,
	evaluateFormulaExpressions,
	doubleDiceInFormula,
	parseTieredFormula,
	evaluateRequirement,
	buildTargetRollData,
};
