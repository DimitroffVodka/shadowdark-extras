// Damage-card action layer — extracted from combat/damage-card.mjs (Phase 5.3 split).
// Summon-expiry quartet, effect-selection dialog, target-defense interaction,
// and the summon / item-giver / coating-poison side effects. The DOM listener
// attachment for the rendered card stays in damage-card.mjs.

import { startDurationSpell } from "../effects/FocusSpellTrackerSD.mjs";
import { getSocket } from "../shared/combat-socket.mjs";
import {
	buildMultipliersHtml,
	buildTargetRollData,
	evaluateFormulaExpressions,
	getAbilityLabel,
	getAbilityModifier,
	parseTieredFormula,
} from "./damage-card-builders.mjs";

const MODULE_ID = "shadowdark-extras";

// Track summoned tokens with expiry info for auto-deletion
// Map<sceneId, Array<{tokenIds: string[], expiryRound: number, spellName: string}>>
const _summonedTokensExpiry = new Map();

/**
 * Get summoned token expiry data from scene flags (persistent) or in-memory Map
 */
function getSummonedTokensExpiry(sceneId) {
	// Try in-memory first
	if (_summonedTokensExpiry.has(sceneId)) {
		return _summonedTokensExpiry.get(sceneId);
	}
	// Try scene flags as fallback (persistent)
	const scene = game.scenes.get(sceneId);
	const flagData = scene?.flags?.[MODULE_ID]?.summonedTokensExpiry;
	if (flagData && Array.isArray(flagData)) {
		_summonedTokensExpiry.set(sceneId, flagData);
		return flagData;
	}
	return null;
}

/**
 * Save summoned token expiry data to both in-memory and scene flags
 */
async function saveSummonedTokensExpiry(sceneId, expiryList) {
	if (expiryList && expiryList.length > 0) {
		_summonedTokensExpiry.set(sceneId, expiryList);
		const scene = game.scenes.get(sceneId);
		if (scene && game.user.isGM) {
			await scene.setFlag(MODULE_ID, "summonedTokensExpiry", expiryList);
		}
	}
	else {
		_summonedTokensExpiry.delete(sceneId);
		const scene = game.scenes.get(sceneId);
		if (scene && game.user.isGM) {
			await scene.unsetFlag(MODULE_ID, "summonedTokensExpiry");
		}
	}
}

/**
 * Add summoned tokens to expiry tracking (exported)
 */
async function trackSummonedTokensForExpiry(sceneId, tokenIds, expiryRound, spellName) {
	const existingList = getSummonedTokensExpiry(sceneId) || [];
	existingList.push({ tokenIds, expiryRound, spellName });
	await saveSummonedTokensExpiry(sceneId, existingList);
}


/**
 * Show a dialog allowing the user to select which effects to apply
 * @param {Array} effectOptions - Array of {uuid, name, img, data} objects
 * @returns {Promise<Array>} - Array of selected effect data objects, or null if cancelled
 */
async function showEffectSelectionDialog(effectOptions) {
	return new Promise(resolve => {
		// Build checkboxes HTML
		let checkboxesHtml = "";
		for (let i = 0; i < effectOptions.length; i++) {
			const opt = effectOptions[i];
			const escapedImg = foundry.utils.escapeHTML(opt.img || "icons/svg/mystery-man.svg");
			const escapedName = foundry.utils.escapeHTML(opt.name || "Unknown Effect");
			checkboxesHtml += `
				<div class="sdx-effect-option" style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
					<input type="checkbox" id="effect-${i}" name="effect-${i}" value="${i}" checked style="width: 16px; height: 16px;">
					<img src="${escapedImg}" alt="${escapedName}" style="width: 24px; height: 24px; border-radius: 4px;">
					<label for="effect-${i}" style="cursor: pointer;">${escapedName}</label>
				</div>
			`;
		}

		const dialogContent = `
			<form>
				<p style="margin-bottom: 12px;">Select which effects to apply:</p>
				<div class="sdx-effect-options" style="display: flex; flex-direction: column; gap: 4px;">
					${checkboxesHtml}
				</div>
			</form>
		`;

		new foundry.applications.api.DialogV2({
			window: { title: "Select Effects" },
			content: dialogContent,
			buttons: [
				{
					action: "apply",
					icon: "fas fa-check",
					label: "Apply Selected",
					default: true,
					callback: (event, button, dialog) => {
						const selectedEffects = [];
						for (let i = 0; i < effectOptions.length; i++) {
							const checkbox = dialog.element.querySelector(`input[name="effect-${i}"]`);
							if (checkbox?.checked) {
								selectedEffects.push(effectOptions[i].data);
							}
						}
						resolve(selectedEffects);
					},
				},
				{
					action: "cancel",
					icon: "fas fa-times",
					label: "Cancel",
					callback: () => resolve(null),
				},
			],
			close: () => resolve(null),
		}).render({ force: true });
	});
}

function canUserResolveTargetDefense(token) {
	return game.user.isGM || !!token?.actor?.isOwner;
}

function getUnresolvedDefenseTargets($card) {
	return $card.find(".sdx-target-item").filter(function() {
		const $target = $(this);
		const isEnabled = $target.data("enabled") !== false && $target.attr("data-enabled") !== "false";
		if (!isEnabled) return false;

		const $defense = $target.find(".sdx-target-defense");
		return $defense.length > 0 && $defense.attr("data-defense-resolved") !== "true";
	});
}

async function saveTargetDefenseResult(messageId, tokenId, result) {
	if (getSocket() && !game.user.isGM) {
		return getSocket().executeAsGM("setTargetDefenseResult", { messageId, tokenId, result });
	}

	const message = game.messages.get(messageId);
	if (!message) return false;
	const current = foundry.utils.deepClone(message.getFlag(MODULE_ID, "targetDefenseResults") || {});
	current[tokenId] = result;
	await message.setFlag(MODULE_ID, "targetDefenseResults", current);
	return true;
}

async function rollTargetDefenseCheck({ messageId, tokenId, ability, dcFormula, casterActorId }) {
	const token = canvas.tokens.get(tokenId);
	if (!token?.actor) {
		ui.notifications.warn("Target token not found.");
		return;
	}

	if (!canUserResolveTargetDefense(token)) {
		ui.notifications.warn(`Only the GM or ${token.name}'s owner can roll this defense.`);
		return;
	}

	const casterActor = casterActorId ? game.actors.get(casterActorId) : null;
	const rollData = casterActor?.getRollData?.() || {};
	rollData.target = buildTargetRollData(token.actor);

	let dc = 12;
	try {
		const evaluatedFormula = evaluateFormulaExpressions(String(dcFormula || "12"), rollData);
		const dcRoll = new Roll(evaluatedFormula, rollData);
		await dcRoll.evaluate();
		dc = Number(dcRoll.total) || 12;
	}
	catch(err) {
		dc = Number.parseInt(dcFormula, 10) || 12;
	}

	const key = String(ability || "dex").toLowerCase();
	const abilityMod = getAbilityModifier(token.actor, key);
	const defenseRoll = new Roll(`1d20 + ${abilityMod}`);
	await defenseRoll.evaluate();

	if (game.dice3d) {
		await game.dice3d.showForRoll(defenseRoll, game.user, true);
	}

	const result = {
		tokenId,
		actorId: token.actor.id,
		targetName: token.name,
		ability: key,
		dc,
		total: defenseRoll.total,
		formula: defenseRoll.formula,
		success: defenseRoll.total >= dc,
		userId: game.user.id,
		rollJSON: defenseRoll.toJSON(),
	};

	await saveTargetDefenseResult(messageId, tokenId, result);

	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ token }),
		rolls: [defenseRoll],
		content: `<p><strong>${token.name}</strong> rolls ${getAbilityLabel(key)} defense vs DC ${dc}: <strong>${defenseRoll.total}</strong> - ${result.success ? "Success" : "Failure"}</p>`,
	});
}

/**
 * Helper function to rebuild targets list based on active tab
 */
function rebuildTargetsList($card, messageId, baseDamage) {
	const $activeTab = $card.find(".sdx-tab.active");
	const activeTabIndex = $card.find(".sdx-tab").index($activeTab);
	const settings = game.settings.get("shadowdark-extras", "combatSettings");
	const cardSettings = settings.damageCard;

	let targets = [];
	let tabName = "";

	// Get the message to access stored targets
	const message = game.messages.get(messageId);
	const storedTargetIds = message?.flags?.["shadowdark-extras"]?.targetIds;

	// First tab (index 0) is TARGETED, second tab (index 1) is SELECTED
	if (activeTabIndex === 0) {
		// Use stored targets from message if available
		if (storedTargetIds && storedTargetIds.length > 0) {
			targets = storedTargetIds
				.map(id => canvas.tokens.get(id))
				.filter(t => t); // Filter out any tokens that no longer exist
		}
		else {
			// Fallback to current user's targets
			targets = Array.from(game.user.targets);
		}
		tabName = "TARGETED";
	}
	else if (activeTabIndex === 1) {
		targets = canvas.tokens.controlled.filter(t => t.actor);
		tabName = "SELECTED";
	}


	// Get damage type from card
	const damageType = $card.data("damage-type") || "damage";
	const isHealing = damageType === "healing";
	const damageSign = isHealing ? "+" : "-";

	// Build new targets HTML
	let targetsHtml = "";
	for (const target of targets) {
		const actor = target.actor;
		if (!actor) continue;

		const tokenId = target.id;
		const actorId = actor.id;
		const name = foundry.utils.escapeHTML(actor.name);
		const img = foundry.utils.escapeHTML(actor.img || "icons/svg/mystery-man.svg");

		// Add enable/disable checkbox if auto-apply is disabled
		const enableCheckbox = !cardSettings.autoApplyDamage ? `
						<input type="checkbox" class="sdx-target-enable-checkbox" data-token-id="${tokenId}" checked title="Enable/disable this target" />
							` : "";

		targetsHtml += `
							<div class="sdx-target-item" data-token-id="${tokenId}" data-actor-id="${actorId}" data-enabled="true">
								${enableCheckbox}
					<div class="sdx-target-header">
						<img src="${img}" alt="${name}" class="sdx-target-img" />
						<div class="sdx-target-name">${name}</div>
						<div class="sdx-damage-preview">${damageSign}<span class="sdx-damage-value" data-base-damage="${baseDamage}">${baseDamage}</span></div>
					</div>
				${buildMultipliersHtml(cardSettings.damageMultipliers, tokenId)}
			</div>
						`;
	}

	if (targetsHtml === "") {
		targetsHtml = `<div class="sdx-no-targets">No ${tabName.toLowerCase()} tokens</div>`;
	}

	// Preserve existing Apply Condition button data before rebuilding
	const $existingConditionBtn = $card.find(".sdx-apply-condition-btn");
	let conditionButtonHtml = "";
	if ($existingConditionBtn.length > 0) {
		// Recreate the condition button with same attributes
		const effectsData = $existingConditionBtn.attr("data-effects") || "";
		const applyToTarget = $existingConditionBtn.attr("data-apply-to-target") || "true";
		const effectsRequirement = $existingConditionBtn.attr("data-effects-requirement") || "";
		const spellInfoData = $existingConditionBtn.attr("data-spell-info") || "";
		const effectSelectionMode = $existingConditionBtn.attr("data-effect-selection-mode") || "all";
		// v14/SD4.x: Preserve applied state across tab rebuilds so the "APPLIED" indicator
		// and double-click guard survive when the user switches Targeted/Selected tabs.
		const alreadyApplied = $existingConditionBtn.attr("data-already-applied") === "true";
		const condBtnText = alreadyApplied
			? '<i class="fas fa-check"></i> APPLIED'
			: '<i class="fas fa-wand-sparkles"></i> APPLY EFFECTS';
		const condBtnDisabled = alreadyApplied ? "disabled" : "";
		const condBtnAppliedAttr = alreadyApplied ? 'data-already-applied="true"' : "";

		conditionButtonHtml = `
			<button type="button" class="sdx-apply-condition-btn"
				data-effects='${effectsData}'
				data-apply-to-target="${applyToTarget}"
				data-effects-requirement="${foundry.utils.escapeHTML(effectsRequirement)}"
				data-spell-info="${spellInfoData}"
				data-effect-selection-mode="${effectSelectionMode}"
				${condBtnAppliedAttr} ${condBtnDisabled}>
				${condBtnText}
			</button>`;
	}

	// Build apply button with appropriate text for damage type
	const baseDamageValue = parseInt($card.data("base-damage")) || baseDamage;
	const buttonText = isHealing ? "APPLY HEALING" : "APPLY DAMAGE";
	const buttonIcon = isHealing ? "fa-heart-pulse" : "fa-hand-sparkles";
	// Only show damage button if there's actual damage to apply
	const applyDamageButtonHtml = cardSettings.showApplyButton && baseDamageValue > 0
		? `<button type="button" class="sdx-apply-damage-btn" data-damage-type="${damageType}"><i class="fas ${buttonIcon}"></i> ${buttonText}</button>` : "";

	// Combine buttons in a wrapper if any exist
	let buttonsHtml = "";
	if (applyDamageButtonHtml || conditionButtonHtml) {
		buttonsHtml = `<div class="sdx-damage-actions">${applyDamageButtonHtml}${conditionButtonHtml}</div>`;
	}

	// Replace the content
	$card.find(".sdx-damage-card-content").html(targetsHtml + buttonsHtml);

	// Re-attach listeners for new elements
	attachMultiplierListeners($card);
	attachTargetEnableListeners($card);
}

/**
 * Attach multiplier button listeners
 */
function attachMultiplierListeners($card) {
	$card.find(".sdx-multiplier-btn").off("click").on("click", function(e) {
		e.preventDefault();
		e.stopPropagation();

		const $btn = $(this);
		const tokenId = $btn.data("token-id");
		const multiplier = parseFloat($btn.data("multiplier"));

		// Update active state
		$btn.siblings().removeClass("active");
		$btn.addClass("active");

		// Update damage preview
		const $targetItem = $card.find(`.sdx-target-item[data-token-id="${tokenId}"]`);
		const $damageValue = $targetItem.find(".sdx-damage-value");
		const baseDamage = parseInt($damageValue.data("base-damage"));

		let newDamage;
		if (multiplier === 0 && $btn.text().trim() === "×") {
			newDamage = 0;
		}
		else if (multiplier === -1) {
			newDamage = -baseDamage;
		}
		else {
			newDamage = Math.floor(baseDamage * multiplier);
		}

		$damageValue.text(Math.abs(newDamage));

		// Get the original damage type to determine proper +/- display
		const originalDamageType = $card.data("original-damage-type") || $card.data("damage-type");
		const isOriginallyHealing = (originalDamageType || "").toLowerCase() === "healing";

		// Determine the correct +/- sign based on:
		// - For healing spells: positive newDamage = + (healing), negative = - (damage)
		// - For damage spells: positive newDamage = - (damage), negative = + (healing)
		const $preview = $targetItem.find(".sdx-damage-preview");
		let previewSign;

		if (newDamage === 0) {
			previewSign = "";
		}
		else if (isOriginallyHealing) {
			// Healing spell: positive = +, negative = -
			previewSign = newDamage > 0 ? "+" : "-";
		}
		else {
			// Damage spell: positive = -, negative = +
			previewSign = newDamage > 0 ? "-" : "+";
		}

		$preview.html(`${previewSign}<span class="sdx-damage-value" data-base-damage="${baseDamage}">${Math.abs(newDamage)}</span>`);

		$targetItem.data("calculated-damage", newDamage);
		// Update card damage type and button text based on whether damage is healing or damaging
		// This handles cases where multipliers flip the damage sign
		const $applyBtn = $card.find(".sdx-apply-damage-btn");

		// Store original damage type on first load (use the originalDamageType variable)
		if (!$card.data("original-damage-type")) {
			$card.data("original-damage-type", originalDamageType);
		}

		// Determine effective type based on multiplier (isOriginallyHealing already defined above)
		// For healing spells: positive multiplier = healing, negative = damage
		// For damage spells: positive multiplier = damage, negative = healing
		let effectiveDamageType;
		let finalCalculatedDamage;

		if (isOriginallyHealing) {
			if (newDamage >= 0) {
				// Positive on healing spell = healing
				effectiveDamageType = "Healing";
				finalCalculatedDamage = newDamage;
			}
			else {
				// Negative on healing spell = damage (flip the sign for damage application)
				effectiveDamageType = "damage";
				finalCalculatedDamage = Math.abs(newDamage);
			}
		}
		else if (newDamage >= 0) {
			// Positive on damage spell = damage
			effectiveDamageType = "damage";
			finalCalculatedDamage = newDamage;
		}
		else {
			// Negative on damage spell = healing (flip the sign for healing application)
			effectiveDamageType = "Healing";
			finalCalculatedDamage = Math.abs(newDamage);
		}

		// Store the final calculated damage (always positive, type determines heal vs damage)
		$targetItem.data("calculated-damage", finalCalculatedDamage);

		// Update card damage type
		$card.data("damage-type", effectiveDamageType);

		// Update button text and icon
		const isHealing = effectiveDamageType.toLowerCase() === "healing";
		const buttonText = isHealing ? "APPLY HEALING" : "APPLY DAMAGE";
		const buttonIcon = isHealing ? "fa-heart-pulse" : "fa-hand-sparkles";
		$applyBtn.html(`<i class="fas ${buttonIcon}"></i> ${buttonText}`);
	});
}

/**
 * Attach target enable/disable checkbox listeners
 */
function attachTargetEnableListeners($card) {
	$card.find(".sdx-target-enable-checkbox").off("change").on("change", function(e) {
		e.stopPropagation();

		const $checkbox = $(this);
		const tokenId = $checkbox.data("token-id");
		const isEnabled = $checkbox.is(":checked");

		// Update target item's enabled state
		const $targetItem = $card.find(`.sdx-target-item[data-token-id="${tokenId}"]`);
		$targetItem.attr("data-enabled", isEnabled);
		$targetItem.data("enabled", isEnabled);

		// Visual feedback - gray out disabled targets
		if (isEnabled) {
			$targetItem.removeClass("sdx-target-disabled");
		}
		else {
			$targetItem.addClass("sdx-target-disabled");
		}

	});
}

/**
 * Spawn summoned creatures automatically when a spell is cast
 * @param {boolean} isCriticalSuccess - If true, duration will be doubled
 */
/**
 * Ensure a creature actor exists in game.actors before spawning.
 * Compendium actors must be imported so item-piles' preCreateToken hook
 * can resolve document.actor (which returns null for non-world actors).
 * Returns the resolved world UUID, or the original UUID on failure.
 */
async function _resolveActorForSummon(uuid) {
	if (!uuid) return uuid;

	// Already a world actor — nothing to do.
	const sync = fromUuidSync(uuid);
	if (sync instanceof Actor && !sync.pack) return uuid;

	// Try to import from compendium.
	try {
		const parts = uuid.split(".");
		// Expected format: "Compendium.<scope>.<packName>.<docId>"
		if (parts.length < 4) return uuid;

		const packId = `${parts[1]}.${parts[2]}`;
		const docId  = parts[parts.length - 1];
		const pack   = game.packs.get(packId);
		if (!pack) return uuid;

		// Re-use an already-imported copy from this session if present.
		const existing = game.actors.find(a =>
			a.getFlag(MODULE_ID, "_sdxSummonSourceUuid") === uuid
		);
		if (existing) return existing.uuid;

		const imported = await game.actors.importFromCompendium(pack, docId);
		if (!imported) return uuid;

		await imported.setFlag(MODULE_ID, "_sdxSummonSourceUuid", uuid);
		return imported.uuid;
	}
	catch(err) {
		console.warn(`${MODULE_ID} | Could not import summon actor from compendium (${uuid}):`, err);
		return uuid;
	}
}

async function spawnSummonedCreatures(
	casterActor, item, profiles, summoningConfig = {}, isCriticalSuccess = false
) {

	try {
		profiles = Array.isArray(profiles)
			? profiles
			: (profiles && typeof profiles === "object" ? Object.values(profiles) : []);

		// Check if Portal library is available
		if (typeof Portal === "undefined") {
			ui.notifications.error("Portal library not found. Please install the 'portal-lib' module.");
			return;
		}

		// Get the caster's token as the origin point
		const casterToken = casterActor?.getActiveTokens()?.[0];
		if (!casterToken) {
			ui.notifications.warn("Could not find caster token on the scene");
			return;
		}

		// Resolve the user who controls the caster actor so we grant ownership
		// to the right player, not just whoever is running this code (usually GM).
		const summonerUser = game.users.find(u => u.character?.id === casterActor.id);
		const ownerUserId  = summonerUser?.id ?? game.user.id;

		// Pre-resolve all creature UUIDs to world actors.
		// item-piles' preCreateToken hook reads document.actor, which is null for
		// compendium actors that haven't been imported. We import them first so
		// game.actors.get(actorId) succeeds inside item-piles' hook.
		const resolvedProfiles = [];
		for (const profile of profiles) {
			const creatureUuid = profile?.creatureUuid || profile?.creature || profile?.uuid || "";
			if (!creatureUuid) {
				console.warn(`${MODULE_ID} | Skipping summon profile with no UUID`, profile);
				continue;
			}
			const worldUuid = await _resolveActorForSummon(creatureUuid);
			resolvedProfiles.push({ ...profile, creatureUuid, worldUuid });
		}

		if (resolvedProfiles.length === 0) {
			ui.notifications.warn("No summon creatures are configured. Drop an actor into the summon row first.");
			return;
		}

		// Create Portal instance and set origin
		const portal = new Portal();
		portal.origin(casterToken);

		// Add each creature profile (using the resolved world UUID)
		for (const profile of resolvedProfiles) {
			// Parse count formula if it's a dice formula
			let count = 1;
			const countFormula = profile.count || "1";
			if (typeof countFormula === "string" && countFormula.includes("d")) {
				try {
					const roll = new Roll(countFormula);
					await roll.evaluate();
					count = roll.total;
					await roll.toMessage({
						flavor: `Summoning ${profile.displayName || profile.creatureName || "creatures"}`,
						speaker: ChatMessage.getSpeaker({ actor: casterActor }),
					});
				}
				catch(err) {
					console.warn(`${MODULE_ID} | Invalid count formula, using 1:`, countFormula, err);
					count = 1;
				}
			}
			else {
				count = parseInt(countFormula) || 1;
			}

			portal.addCreature({
				creature: profile.worldUuid,
				count,
				displayName: profile.displayName || "",
			});
		}

		// Spawn — shows placement UI and creates the tokens on the scene
		const creatures = await portal.spawn();

		// Check if creatures were spawned
		if (creatures && creatures.length > 0) {
			// Grant ownership to the summoner.
			// Always update the world actor's ownership directly — Foundry checks the base
			// actor first for both linked AND unlinked tokens (the delta only overrides when
			// explicitly set). Updating delta.ownership via updateEmbeddedDocuments goes
			// through server-side sanitization that requires a user-context Foundry doesn't
			// provide in token batch-updates, causing a crash.
			const actorIdsUpdated = new Set();
			for (const token of creatures) {
				const worldActor = game.actors.get(token.actorId);
				if (!worldActor || actorIdsUpdated.has(worldActor.id)) continue;
				await worldActor.update({
					ownership: {
						...worldActor.ownership,
						[ownerUserId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
					},
				});
				actorIdsUpdated.add(worldActor.id);
			}

			// Duration tracking — run regardless of summoningConfig flags so that any
			// summoning spell with a duration shows up in the focus tracker and auto-expires.
			const duration     = item?.system?.duration;
			const durationType = duration?.type;
			let   durationValue = parseInt(duration?.value) || 0;
			if (isCriticalSuccess && durationValue > 0) durationValue *= 2;

			const tokenIds  = creatures.map(t => t.id);
			const hasDuration = (durationType === "rounds" || durationType === "turns") && durationValue > 0;

			if (hasDuration) {
				// Always show summoning spells in the focus spell duration tracker.
				// (Replaces the old spellDamageConfig.trackDuration guard — summoning
				// spells should always appear in the tracker when they have a duration.)
				try {
					const spellDamageConfig = item?.flags?.[MODULE_ID]?.spellDamage || {};
					await startDurationSpell(casterActor, item, tokenIds, {
						perTurnTrigger: spellDamageConfig.perTurnTrigger  || "start",
						perTurnDamage: spellDamageConfig.perTurnDamage   || "",
						reapplyEffects: spellDamageConfig.reapplyEffects  || false,
						damageType: spellDamageConfig.damageType      || "",
						effects: spellDamageConfig.effects         || [],
						templateId: null,
						summonedTokenIds: tokenIds,
					});
				}
				catch(err) {
					console.warn(`${MODULE_ID} | Failed to start duration tracking for summoning spell:`, err);
				}

				// Auto-delete tokens when the expiry round is reached in combat.
				// summoningConfig.deleteAtExpiry defaults to true for summoning spells.
				const shouldDelete = summoningConfig.deleteAtExpiry ?? true;
				if (shouldDelete && game.combat) {
					const expiryRound = (game.combat.round || 1) + durationValue;
					await trackSummonedTokensForExpiry(canvas.scene.id, tokenIds, expiryRound, item?.name || "Summoning");
				}
			}

			ui.notifications.info(`Summoned ${creatures.length} creature(s)`);
		}
		else {
			ui.notifications.warn("No creatures were spawned - check that creature UUIDs are valid");
		}
	}
	catch(err) {
		console.error("shadowdark-extras | Error summoning creatures:", err);
		ui.notifications.error(`Failed to summon creatures: ${err.message}`);
	}
}

async function giveItemsToCaster(casterActor, item, profiles) {
	if (!casterActor) {
		console.warn("shadowdark-extras | No caster actor available to receive items");
		return;
	}
	if (!profiles || profiles.length === 0) {
		console.warn("shadowdark-extras | No item profiles provided");
		return;
	}
	const itemsToCreate = [];
	for (const profile of profiles) {
		if (!profile || !profile.itemUuid) continue;
		let quantity = 1;
		const qtyValue = (profile.quantity || "1").toString().trim();
		if (qtyValue.includes("d")) {
			try {
				const roll = new Roll(qtyValue);
				await roll.evaluate();
				quantity = Math.max(1, roll.total || 1);
				await roll.toMessage({
					flavor: `Item giver: ${profile.itemName || item.name || "Item"} `,
					speaker: ChatMessage.getSpeaker({ actor: casterActor }),
				});
			}
			catch(err) {
				console.warn("shadowdark-extras | Invalid item quantity formula, defaulting to 1:", qtyValue, err);
				quantity = 1;
			}
		}
		else if (qtyValue !== "") {
			const parsed = parseInt(qtyValue);
			if (!Number.isNaN(parsed)) {
				quantity = Math.max(1, parsed);
			}
		}
		try {
			const sourceItem = await fromUuid(profile.itemUuid);
			if (!sourceItem || !(sourceItem instanceof Item)) {
				console.warn(`shadowdark - extras | Skipping item give for invalid source: ${profile.itemName} `);
				continue;
			}
			const itemData = foundry.utils.duplicate(sourceItem.toObject());
			delete itemData._id;
			if (!itemData.system) itemData.system = {};
			itemData.system.quantity = quantity;
			itemsToCreate.push(itemData);
		}
		catch(err) {
			console.error("shadowdark-extras | Failed to load item for item giver:", err);
		}
	}
	if (itemsToCreate.length === 0) {
		console.warn("shadowdark-extras | No valid items were available to create");
		return;
	}
	try {
		const createdItems = await casterActor.createEmbeddedDocuments("Item", itemsToCreate);
		const itemSummaries = createdItems.map(createdItem => `${createdItem.name} x${createdItem.system?.quantity || 1} `);
		ui.notifications.info(`Granted ${itemSummaries.join(", ")} to ${casterActor.name} `);
	}
	catch(err) {
		console.error("shadowdark-extras | Failed to add items to caster:", err);
		ui.notifications.error(`Failed to grant items to caster: ${err.message}`);
	}
}

/**
 * Apply coating poison to a weapon from a potion
 * Shows a dialog to select a weapon, then adds poison damage bonus to it
 * @param {Actor} casterActor - The actor who used the potion
 * @param {Actor} targetActor - The actor whose weapon will be coated (may be same as caster)
 * @param {object} config - The coating poison configuration
 * @param {string} potionName - Name of the potion for display purposes
 */
async function applyCoatingPoison(casterActor, targetActor, config, potionName) {
	if (!targetActor) {
		ui.notifications.warn("No target found for coating poison!");
		return;
	}

	// Get all weapons from target actor
	const weapons = targetActor.items.filter(item => item.type === "Weapon");
	if (weapons.length === 0) {
		ui.notifications.warn(`${targetActor.name} has no weapons to coat!`);
		return;
	}

	// Filter out weapons that already have active poison damage bonuses
	// (usage > 0 or no usage = permanent)
	// Allow weapons with depleted poison (usage === 0) to be coated again
	const availableWeapons = weapons.filter(weapon => {
		const currentBonus = weapon.getFlag(MODULE_ID, "weaponBonus");
		const hasActivePoisonBonus = currentBonus?.damageBonuses?.some(b =>
			b.damageType?.toLowerCase() === "poison" && b.usage !== 0
		);
		return !hasActivePoisonBonus;
	});

	if (availableWeapons.length === 0) {
		ui.notifications.warn(`${targetActor.name} has no weapons available for poison coating (all already have poison damage)!`);
		return;
	}

	// Build the damage formula based on config
	let damageFormula = "";
	const casterLevel = casterActor?.system?.level?.value || 1;

	if (config.formulaType === "basic") {
		const numDice = config.numDice || 1;
		const dieType = config.dieType || "d6";
		const bonus = config.bonus || 0;
		damageFormula = `${numDice}${dieType}`;
		if (bonus !== 0) {
			damageFormula += bonus > 0 ? `+${bonus}` : `${bonus}`;
		}
	}
	else if (config.formulaType === "formula") {
		damageFormula = config.formula || "1d6";
		// Replace level placeholder with actual level
		damageFormula = damageFormula.replace(/@level/gi, casterLevel);
	}
	else if (config.formulaType === "tiered") {
		// Parse tiered formula like "1-3:1d4, 4-6:1d6, 7+:1d8"
		const tieredFormula = config.tieredFormula || "1+:1d6";
		damageFormula = parseTieredFormula(tieredFormula, casterLevel) || "1d6";
	}

	// Get usage from config (null/undefined = permanent)
	const poisonUsage = config.usage !== undefined && config.usage !== null && config.usage !== ""
		? parseInt(config.usage, 10)
		: null;
	const usageText = poisonUsage !== null ? `${poisonUsage} uses` : "permanently";

	// Build weapon selection dropdown
	const weaponChoices = availableWeapons.map(w =>
		`<option value="${w.id}">${w.name}</option>`
	).join("");

	new foundry.applications.api.DialogV2({
		window: { title: `${potionName} - Coat Weapon` },
		content: `
			<form>
				<div class="form-group">
					<label>Choose a weapon to coat with poison:</label>
					<select name="weaponId" style="width: 100%; margin-top: 5px;">${weaponChoices}</select>
				</div>
				<p style="margin-top: 10px; font-style: italic; font-size: 0.9em;">
					The weapon will deal +${damageFormula} poison damage (${usageText}).
				</p>
			</form>
		`,
		buttons: [
			{
				action: "coat",
				icon: "fas fa-skull-crossbones",
				label: "Coat Weapon",
				default: true,
				callback: async (event, button) => {
					const weaponId = button.form.elements.weaponId.value;
					const weapon = targetActor.items.get(weaponId);
					if (!weapon) {
						ui.notifications.error("Weapon not found!");
						return;
					}

					// Get existing weapon bonus or create new structure
					const existingBonus = weapon.getFlag(MODULE_ID, "weaponBonus") || {};

					// Create the poison coating bonus
					const poisonCoatingBonus = {
						enabled: true,
						hitBonuses: existingBonus.hitBonuses || [],
						damageBonuses: [
							...(existingBonus.damageBonuses || []),
							{
								formula: damageFormula,
								label: potionName,
								damageType: "poison",
								exclusive: false,
								prompt: false,
								requirements: [],
								usage: poisonUsage,
							},
						],
						damageBonus: existingBonus.damageBonus || "",
						criticalExtraDice: existingBonus.criticalExtraDice || "",
						criticalExtraDamage: existingBonus.criticalExtraDamage || "",
						requirements: existingBonus.requirements || [],
						effects: existingBonus.effects || [],
						itemMacro: existingBonus.itemMacro
						|| { enabled: false, runAsGm: false, triggers: [] },
					};

					// Update the weapon with the poison coating
					await weapon.setFlag(MODULE_ID, "weaponBonus", poisonCoatingBonus);

					ui.notifications.info(`${weapon.name} is now coated with poison (+${damageFormula}, ${usageText})!`);
					ChatMessage.create({
						speaker: ChatMessage.getSpeaker({ actor: casterActor }),
						content: `<div class="shadowdark chat-card">
							<h3><i class="fas fa-skull-crossbones"></i> Poison Coating</h3>
							<p><strong>${casterActor?.name || "Someone"}</strong> coats <strong>${targetActor.name}'s ${weapon.name}</strong> with poison!</p>
							<p><em>The weapon now deals +${damageFormula} poison damage (${usageText}).</em></p>
						</div>`,
					});
				},
			},
			{ action: "cancel", icon: "fas fa-times", label: "Cancel" },
		],
	}).render({ force: true });
}

export {
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
};
