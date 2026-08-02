import { MODULE_ID, DURATION_SPELL_FLAG, SPELL_MODIFICATIONS_FLAG } from "./focus-constants.mjs";
import { getSocket } from "../shared/combat-socket.mjs";

// Duration-spell tracking domain — extracted from
// scripts/effects/FocusSpellTrackerSD.mjs (Phase 5.1 split).


/**
 * Start tracking a duration spell (non-focus spells with turn/round duration)
 * @param {Actor} caster - The caster actor
 * @param {Item} spell - The spell item
 * @param {Array} targetTokenIds - Array of target token IDs
 * @param {Object} spellConfig - Configuration from spellDamage flags
 */
export async function startDurationSpell(caster, spell, targetTokenIds = [], spellConfig = {}) {
	// Get spell duration from the spell item
	// Handle case where value might be a string like "5" or a number
	const rawDurationValue = spell.system?.duration?.value;
	const durationValue = typeof rawDurationValue === "string" ? parseInt(rawDurationValue, 10) || 1 : (rawDurationValue || 1);
	const durationType = spell.system?.duration?.type || "rounds";

	console.log(`shadowdark-extras | Duration spell: ${spell.name}, value: ${durationValue}, type: ${durationType}`);

	// Calculate expiry round
	const currentRound = game.combat?.round ?? 0;
	let expiryRound = currentRound;

	if (durationType === "rounds") {
		expiryRound = currentRound + durationValue;
	}
	else if (durationType === "turns") {
		expiryRound = currentRound + Math.ceil(durationValue / 10); // Approximate
	}

	console.log(`shadowdark-extras | Duration spell tracking: current round ${currentRound}, expiry round ${expiryRound}`);

	// Build target info
	const targets = targetTokenIds.map(tokenId => {
		const token = canvas.tokens?.get(tokenId);
		return {
			tokenId: tokenId,
			actorId: token?.actor?.id || null,
			name: token?.name || "Unknown",
		};
	});

	// Generate a unique instance ID for this spell cast
	const instanceId = `${spell.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

	const durationData = {
		instanceId: instanceId, // Unique ID for this specific cast
		spellId: spell.id,
		spellName: spell.name,
		spellImg: spell.img,
		casterId: caster.id,
		casterName: caster.name,
		templateId: spellConfig.templateId || null, // Link to the specific template
		summonedTokenIds: spellConfig.summonedTokenIds || [], // Track summoned tokens for cleanup
		startRound: currentRound,
		expiryRound: expiryRound,
		durationValue: durationValue,
		durationType: durationType,
		targets: targets,
		targetEffects: [], // Track effects applied to targets for cleanup
		perTurnTrigger: spellConfig.perTurnTrigger || "start",
		perTurnDamage: spellConfig.perTurnDamage || "",
		reapplyEffects: spellConfig.reapplyEffects || false,
		damageType: spellConfig.damageType || "",
		effects: spellConfig.effects || [],
		lastProcessedRound: currentRound, // Don't process on cast round
		processedTargetsThisRound: {}, // Track which targets have been processed this round
	};

	// Get current active duration spells
	const currentDuration = caster.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];

	// Always add as a new instance (no longer check for existing same spell)
	currentDuration.push(durationData);

	await caster.setFlag(MODULE_ID, DURATION_SPELL_FLAG, currentDuration);

	ui.notifications.info(`${spell.name} is being tracked (${durationValue} ${durationType})`);

	// Refresh the actor sheet if open
	caster.sheet?.render(false);

	console.log(`shadowdark-extras | Started duration tracking for ${spell.name}`, durationData);
	console.log(`shadowdark-extras | Duration spell templateId: ${durationData.templateId || "NOT SET"}`);
	return durationData;
}

/**
 * Get all active duration spells for an actor
 */
export function getActiveDurationSpells(actor) {
	return actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
}


/**
 * Register a spell modification on an item
 * This stores the original state of the item so it can be reverted when the spell ends.
 *
 * @param {Actor} caster - The caster who applied the modification
 * @param {Item} spell - The spell item that applied the modification
 * @param {Item} targetItem - The item being modified (weapon, armor, etc.)
 * @param {Object} changes - The changes being applied (keys are paths like "system.magicItem")
 * @param {Object} options - Display options for when the spell ends
 * @param {string} options.icon - FontAwesome icon class (e.g., "fas fa-hand-sparkles")
 * @param {string} options.endMessage - Message template with {weapon} and {actor} placeholders
 * @returns {Object} - The modification entry created
 */
export async function registerSpellModification(caster, spell, targetItem, changes, options = {}) {
	if (!caster || !spell || !targetItem) {
		console.warn("shadowdark-extras | registerSpellModification called with missing parameters");
		return null;
	}

	// Get current modifications on the item
	const currentMods = targetItem.getFlag(MODULE_ID, SPELL_MODIFICATIONS_FLAG) || [];

	// Capture original state for the paths being changed
	const originalState = {};
	const modifiedPaths = Object.keys(changes);

	for (const path of modifiedPaths) {
		// Deep get the current value at this path and deep clone to avoid reference mutation
		const value = foundry.utils.getProperty(targetItem, path) ?? null;
		originalState[path] = value !== null && typeof value === "object"
			? foundry.utils.deepClone(value)
			: value;
	}

	// Generate unique instance ID that matches duration tracking
	const instanceId = `${spell.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

	// Create the modification entry
	const modEntry = {
		instanceId: instanceId,
		spellId: spell.id,
		casterId: caster.id,
		casterName: caster.name,
		spellName: spell.name,
		spellImg: spell.img,
		originalState: originalState,
		modifiedPaths: modifiedPaths,
		icon: options.icon || "fas fa-magic",
		endMessage: options.endMessage || "The spell effect fades from {weapon} on {actor}.",
		createdAt: Date.now(),
	};

	// Add to item's modifications list
	currentMods.push(modEntry);
	await targetItem.setFlag(MODULE_ID, SPELL_MODIFICATIONS_FLAG, currentMods);

	console.log(`shadowdark-extras | Registered spell modification for ${spell.name} on ${targetItem.name}`, modEntry);
	console.log("shadowdark-extras | Captured original state:", originalState);

	return modEntry;
}

/**
 * Revert all spell modifications when a spell ends
 * Automatically called by endDurationSpell/endFocusSpell
 *
 * @param {string} spellId - The spell ID
 * @param {string} casterId - The caster actor ID
 */
async function revertSpellModifications(spellId, casterId) {
	console.warn(`shadowdark-extras | [REVERT] Reverting spell modifications for spell ${spellId} by caster ${casterId}`);

	const caster = game.actors.get(casterId);
	const revertedItems = [];
	const processedActorIds = new Set();

	// Helper function to process an actor's items
	async function processActorItems(actor) {
		if (!actor || processedActorIds.has(actor.id)) return;
		processedActorIds.add(actor.id);

		const items = actor.items.filter(item => {
			const mods = item.getFlag(MODULE_ID, SPELL_MODIFICATIONS_FLAG);
			return mods && mods.some(m => m.spellId === spellId && m.casterId === casterId);
		});

		for (const item of items) {
			const mods = item.getFlag(MODULE_ID, SPELL_MODIFICATIONS_FLAG) || [];
			const matchingMods = mods.filter(m => m.spellId === spellId && m.casterId === casterId);

			if (matchingMods.length === 0) continue;

			// Build the update object to restore original state
			const updates = {};
			let modEntry = null;

			for (const mod of matchingMods) {
				modEntry = mod; // Keep reference for chat message

				// Restore each path to its original value
				for (const path of mod.modifiedPaths) {
					// Use getProperty to handle Foundry expanding dot-notation keys into nested objects
					const originalValue = foundry.utils.getProperty(mod.originalState, path)
						?? mod.originalState[path]; // fallback to flat key access
					// Use null instead of undefined for proper deletion, or use the original value
					updates[path] = originalValue === undefined ? null : originalValue;
				}
			}

			// Apply the reversion
			try {
				console.log(`shadowdark-extras | Applying reversion to ${item.name} on ${actor.name}:`, updates);

				// Check if we have permission to update the item
				if (item.isOwner || game.user.isGM) {
					await item.update(updates);
				}
				else {
					// Route through GM socket
					const socket = getSocket();
					if (socket) {
						await socket.executeAsGM("revertItemModificationAsGM", {
							itemUuid: item.uuid,
							updates: updates,
						});
					}
					else {
						console.warn(`shadowdark-extras | Cannot revert ${item.name}: No GM connected or socket unavailable.`);
						continue;
					}
				}
				console.log(`shadowdark-extras | Reverted ${item.name} on ${actor.name}`, updates);

				// Calculate remaining mods for cleanup
				const remainingMods = mods.filter(m => !(m.spellId === spellId && m.casterId === casterId));

				// Remove the modification entries from the item
				// This also needs permission check
				if (item.isOwner || game.user.isGM) {
					if (remainingMods.length > 0) {
						await item.setFlag(MODULE_ID, SPELL_MODIFICATIONS_FLAG, remainingMods);
					}
					else {
						await item.unsetFlag(MODULE_ID, SPELL_MODIFICATIONS_FLAG);
					}
				}
				else {
					const socket = getSocket();
					if (socket) {
						await socket.executeAsGM("updateItemFlagsAsGM", {
							itemUuid: item.uuid,
							flagPath: SPELL_MODIFICATIONS_FLAG,
							flagValue: remainingMods.length > 0 ? remainingMods : null,
						});
					}
				}

				revertedItems.push({ item, actor, modEntry });
			}
			catch (err) {
				console.error(`shadowdark-extras | Failed to revert ${item.name}:`, err);
			}
		}
	}

	// Search all actors in the actors directory
	for (const actor of game.actors.contents) {
		await processActorItems(actor);
	}

	// Also search token actors on the current scene (for unlinked tokens)
	if (canvas.tokens?.placeables) {
		for (const token of canvas.tokens.placeables) {
			if (token.actor && !token.document.actorLink) {
				// This is an unlinked token - process its actor
				await processActorItems(token.actor);
			}
		}
	}

	// Post chat messages for reverted items
	for (const { item, actor, modEntry } of revertedItems) {
		const message = modEntry.endMessage
			.replace("{weapon}", item.name)
			.replace("{actor}", actor.name);

		await ChatMessage.create({
			content: `<div class="shadowdark chat-card">
				<h3><i class="${modEntry.icon}"></i> ${modEntry.spellName} Ended</h3>
				<p>${message}</p>
			</div>`,
			speaker: ChatMessage.getSpeaker({ actor: caster }),
		});
	}

	if (revertedItems.length > 0) {
		console.log(`shadowdark-extras | Reverted ${revertedItems.length} item(s) modified by spell ${spellId}`);
	}

	return revertedItems;
}

/**
 * End a duration spell and remove all associated effects from targets
 * @param {string} casterId - The caster actor ID
 * @param {string} instanceId - The unique instance ID of the spell (or spellId for backwards compatibility)
 * @param {string} reason - The reason for ending ("expired" or "manual")
 */
export async function endDurationSpell(casterId, instanceId, reason = "expired") {
	console.warn(`shadowdark-extras | [ENTRY] endDurationSpell called with casterId=${casterId}, instanceId=${instanceId}, reason=${reason}`);

	const caster = game.actors.get(casterId);
	if (!caster) return;

	const activeDuration = caster.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
	// Find by instanceId first, fallback to spellId for backwards compatibility
	let spellIndex = activeDuration.findIndex(d => d.instanceId === instanceId);
	if (spellIndex < 0) {
		spellIndex = activeDuration.findIndex(d => d.spellId === instanceId);
	}

	if (spellIndex < 0) return;

	const durationEntry = activeDuration[spellIndex];
	console.log("shadowdark-extras | [DEBUG] Found duration entry:", durationEntry);

	// Remove all effects applied to targets
	if (durationEntry.targetEffects && durationEntry.targetEffects.length > 0) {
		console.log(`shadowdark-extras | Removing ${durationEntry.targetEffects.length} effects from duration spell ${durationEntry.spellName}`);

		// Create a copy of the array to iterate, as the original might be mutated by handleEffectDeleted hooks
		// This fixes the "N-1" bug where one target might be skipped if the array shrinks during iteration
		const effectsToRemove = [...durationEntry.targetEffects];

		for (const targetEffect of effectsToRemove) {
			try {
				// Use socketlib to remove the effect as GM
				const socket = getSocket();
				if (socket) {
					await socket.executeAsGM("removeTargetEffect", {
						targetActorId: targetEffect.targetActorId,
						targetTokenId: targetEffect.targetTokenId,
						effectItemId: targetEffect.effectItemId,
					});
					console.log("shadowdark-extras | Removed effect via socket");
				}
				else {
					// Fallback for GM or if socket not available
					let targetActor = null;

					// Try token first (for unlinked tokens)
					if (targetEffect.targetTokenId) {
						const token = canvas.tokens?.get(targetEffect.targetTokenId);
						if (token?.actor) {
							targetActor = token.actor;
						}
					}

					// Fall back to actor ID
					if (!targetActor && targetEffect.targetActorId) {
						targetActor = game.actors.get(targetEffect.targetActorId);
					}

					if (!targetActor) {
						console.warn("shadowdark-extras | Could not find target actor for effect removal");
						continue;
					}

					// Find and remove the effect
					const effectItem = targetActor.items.get(targetEffect.effectItemId);
					if (effectItem) {
						await effectItem.delete();
						console.log(`shadowdark-extras | Removed effect ${effectItem.name} from ${targetActor.name}`);
					}
				}
			}
			catch (err) {
				console.warn("shadowdark-extras | Failed to remove effect:", err);
			}
		}
	}

	// Revert any item modifications made by this spell (generic system)
	console.log(`shadowdark-extras | [DEBUG] About to call revertSpellModifications with spellId=${durationEntry.spellId}, casterId=${casterId}`);
	await revertSpellModifications(durationEntry.spellId, casterId);

	// Legacy support: Clean up old Holy Weapon or Cleansing Weapon bonuses (pre-generic system)
	// This can be removed in a future version after macros are updated
	console.log(`shadowdark-extras | [DEBUG] Checking legacy weapon cleanup for spellId=${durationEntry.spellId}, casterId=${casterId}`);
	for (const actor of game.actors.contents) {
		const weapons = actor.items.filter(item => item.type === "Weapon");
		for (const weapon of weapons) {
			const holyWeaponSpellId = weapon.getFlag("shadowdark-extras", "holyWeaponSpellId");
			const holyWeaponCasterId = weapon.getFlag("shadowdark-extras", "holyWeaponCasterId");
			const cleansingWeaponSpellId = weapon.getFlag("shadowdark-extras", "cleansingWeaponSpellId");
			const cleansingWeaponCasterId = weapon.getFlag("shadowdark-extras", "cleansingWeaponCasterId");

			// Debug log to see what flags are set on weapons
			if (holyWeaponSpellId || cleansingWeaponSpellId) {
				console.log(`shadowdark-extras | [DEBUG] Weapon ${weapon.name} on ${actor.name} has flags:`, {
					holyWeaponSpellId, holyWeaponCasterId, cleansingWeaponSpellId, cleansingWeaponCasterId,
					targetSpellId: durationEntry.spellId, targetCasterId: casterId,
				});
			}

			// Check if this weapon was blessed by the ending spell (old flag system)
			if ((holyWeaponSpellId === durationEntry.spellId && holyWeaponCasterId === casterId) ||
				(cleansingWeaponSpellId === durationEntry.spellId && cleansingWeaponCasterId === casterId)) {

				const isCleansing = !!cleansingWeaponSpellId;
				console.log(`shadowdark-extras | [Legacy] Removing ${isCleansing ? "Cleansing" : "Holy"} Weapon bonuses from ${weapon.name} on ${actor.name}`);

				// Remove the weapon bonuses and magical status
				const updates = {
					"system.magicItem": false,
					["flags.shadowdark-extras.weaponBonus"]: null,
				};

				if (isCleansing) {
					updates["flags.shadowdark-extras.cleansingWeaponSpellId"] = null;
					updates["flags.shadowdark-extras.cleansingWeaponCasterId"] = null;
				}
				else {
					updates["flags.shadowdark-extras.holyWeaponSpellId"] = null;
					updates["flags.shadowdark-extras.holyWeaponCasterId"] = null;
				}

				await weapon.update(updates);

				// Post to chat
				const title = isCleansing ? "Cleansing Weapon Ended" : "Holy Weapon Ended";
				const icon = isCleansing ? "fas fa-fire" : "fas fa-hand-sparkles";
				const messageText = isCleansing
					? `The purifying flames fade from <strong>${actor.name}'s ${weapon.name}</strong>.`
					: `The holy blessing fades from <strong>${actor.name}'s ${weapon.name}</strong>.`;

				await ChatMessage.create({
					content: `<div class="shadowdark chat-card">
						<h3><i class="${icon}"></i> ${title}</h3>
						<p>${messageText}</p>
					</div>`,
					speaker: ChatMessage.getSpeaker({ actor: caster }),
				});
			}
		}
	}

	// Delete associated templates from the scene
	// Use the stored templateId for precise 1:1 matching, fall back to name matching for old data
	try {
		const scene = canvas.scene;
		if (scene) {
			const templatesToDelete = [];

			// If we have a specific templateId, use it for precise deletion
			if (durationEntry.templateId) {
				const template = getSceneMeasuredTemplates(scene).get(durationEntry.templateId);
				if (template) {
					templatesToDelete.push(durationEntry.templateId);
					console.log(`shadowdark-extras | Found specific template to delete: ${durationEntry.templateId}`);
				}
			}
			else {
				// Fallback: match by spell name and caster (for duration spells without templateId)
				const templates = getSceneMeasuredTemplates(scene);
				for (const template of templates) {
					const templateFlags = template.flags?.["shadowdark-extras"]?.templateEffects;
					if (!templateFlags?.enabled) continue;

					const matchesSpell = templateFlags.spellName === durationEntry.spellName;
					const matchesCaster = templateFlags.casterActorId === casterId ||
						templateFlags.casterId === casterId;

					if (matchesSpell && matchesCaster) {
						templatesToDelete.push(template.id);
						console.log(`shadowdark-extras | Found template to delete for ${durationEntry.spellName} (fallback matching)`);
					}
				}
			}

			if (templatesToDelete.length > 0) {
				await scene.deleteEmbeddedDocuments("Region", templatesToDelete);
				console.log(`shadowdark-extras | Deleted ${templatesToDelete.length} template(s) for ended spell ${durationEntry.spellName}`);
			}
		}
	}
	catch (err) {
		console.warn("shadowdark-extras | Failed to delete templates for ended spell:", err);
	}

	// Delete summoned tokens if this spell had any
	if (durationEntry.summonedTokenIds && durationEntry.summonedTokenIds.length > 0) {
		try {
			const scene = canvas.scene;
			if (scene && game.user.isGM) {
				const tokensToDelete = durationEntry.summonedTokenIds.filter(tokenId => {
					return scene.tokens.get(tokenId) !== undefined;
				});

				if (tokensToDelete.length > 0) {
					await scene.deleteEmbeddedDocuments("Token", tokensToDelete);
					console.log(`shadowdark-extras | Deleted ${tokensToDelete.length} summoned token(s) for ended spell ${durationEntry.spellName}`);
				}

				// Also remove from expiry tracking
				const expiryList = scene.getFlag(MODULE_ID, "summonedTokensExpiry") || [];
				const updatedExpiryList = expiryList.filter(entry => {
					// Remove entries that match this spell's tokens
					const hasMatchingToken = entry.tokenIds?.some(tokenId =>
						durationEntry.summonedTokenIds.includes(tokenId)
					);
					return !hasMatchingToken;
				});

				if (updatedExpiryList.length !== expiryList.length) {
					await scene.setFlag(MODULE_ID, "summonedTokensExpiry", updatedExpiryList);
					console.log("shadowdark-extras | Removed summoned tokens from expiry tracking");
				}
			}
		}
		catch (err) {
			console.warn("shadowdark-extras | Failed to delete summoned tokens for ended spell:", err);
		}
	}

	// Remove from tracking
	activeDuration.splice(spellIndex, 1);
	await caster.setFlag(MODULE_ID, DURATION_SPELL_FLAG, activeDuration);

	// Post to chat
	const chatContent = `
		<div class="shadowdark chat-card focus-ended">
			<header class="card-header flexrow">
				<img class="focus-ended-icon" src="${durationEntry.spellImg}" alt="${durationEntry.spellName}"/>
				<div class="focus-ended-header-text">
					<h3>${game.i18n.localize("SHADOWDARK_EXTRAS.duration_tracker.spell_ended_title")}</h3>
					<p class="spell-name">${durationEntry.spellName}</p>
				</div>
			</header>
			<div class="card-content">
				<p class="reason-text">${reason === "expired" ? game.i18n.localize("SHADOWDARK_EXTRAS.duration_tracker.reason_expired") : game.i18n.localize("SHADOWDARK_EXTRAS.duration_tracker.reason_manual")}</p>
				${durationEntry.targetEffects?.length > 0 ? `<p style="font-size: 11px; color: #999;">${game.i18n.format("SHADOWDARK_EXTRAS.duration_tracker.effects_removed", { count: durationEntry.targetEffects.length })}</p>` : ""}
			</div>
		</div>
	`;

	await ChatMessage.create({
		content: chatContent,
		speaker: ChatMessage.getSpeaker({ actor: caster }),
	});

	ui.notifications.info(`${durationEntry.spellName} has ${reason === "expired" ? "expired" : "ended"}`);
	caster.sheet?.render(false);

	// Fire hook for spells that need custom end behavior (e.g. Shapechanger auto-revert)
	// Placed at the end so all duration tracking cleanup is complete before handlers run
	Hooks.callAll("sdx.durationSpellEnded", caster, durationEntry, reason);
}

/**
 * Start focus spell tracking if the spell is a focus spell and not already tracked.
 * Called from effect application to ensure focus is tracked before linking effects.
 *
 * @param {string} casterActorId - The caster actor ID
 * @param {string} spellId - The spell item ID
 * @param {string} spellName - The spell name (for lookup)
 * @returns {boolean} - True if focus is now being tracked for this spell
 */

export async function onDurationDamageApplyClick(event) {
	const btn = event.target.closest(".sdx-duration-apply-btn");
	if (!btn) return;

	event.preventDefault();
	event.stopPropagation();

	// Disable immediately to prevent double-clicks
	if (btn.disabled || btn.classList.contains("sdx-duration-applied")) {
		return; // Already applied
	}
	btn.disabled = true;
	const originalHtml = btn.innerHTML;
	btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';

	const tokenId = btn.dataset.tokenId;
	const damage = parseInt(btn.dataset.damage);
	const actorName = btn.dataset.actorName;

	if (!tokenId || isNaN(damage)) {
		console.warn("shadowdark-extras | Duration apply button missing tokenId or damage");
		btn.disabled = false;
		btn.innerHTML = originalHtml;
		return;
	}

	try {
		// Only GM can apply damage via socket or directly
		if (!game.user.isGM) {
			// Use socket to ask GM to apply
			const socket = getSocket();
			if (socket) {
				// Use the registered applyTokenDamage handler (CombatSettingsSD).
				// Note: the previous call site used "applyDamage" which was never registered.
				socket.executeAsGM("applyTokenDamage", { tokenId, damage, actorName });
			}
			else {
				ui.notifications.warn("Cannot apply damage - no GM connected.");
				btn.disabled = false;
				btn.innerHTML = originalHtml;
				return;
			}
		}
		else {
			// GM applies directly
			const token = canvas.tokens?.get(tokenId);
			if (!token?.actor) {
				ui.notifications.error("Could not find the target token.");
				btn.disabled = false;
				btn.innerHTML = originalHtml;
				return;
			}

			const currentHp = token.actor.system.attributes.hp.value;
			const newHp = Math.max(0, currentHp - damage);
			await token.actor.update({ "system.attributes.hp.value": newHp });
		}

		// Update the button to show it was applied
		btn.innerHTML = '<i class="fas fa-check"></i> Applied';
		btn.classList.add("sdx-duration-applied");

		// Update the message flags (resolve the message from the enclosing chat card)
		const messageId = btn.closest("[data-message-id]")?.dataset.messageId;
		const message = messageId ? game.messages.get(messageId) : null;
		if (message) await message.setFlag(MODULE_ID, "applied", true);

		ui.notifications.info(`Applied ${damage} damage to ${actorName}`);
	}
	catch (err) {
		console.error("shadowdark-extras | Failed to apply duration damage:", err);
		btn.disabled = false;
		btn.innerHTML = originalHtml;
	}
}

// Track which combat state we've already processed for duration spells
let _lastDurationProcessKey = null;

/**
 * Handle combat update - process duration spell per-turn damage and expiry
 */
export async function handleDurationSpellCombatUpdate(combat, changed, options, userId) {
	// Only process on turn changes (when someone's turn starts)
	if (!("turn" in changed) && !("round" in changed)) return;

	// Only GM should process duration spells to avoid duplicates
	if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;

	// Create a unique key for this combat state
	const processKey = `${combat.id}-${combat.round}-${combat.turn}`;
	if (_lastDurationProcessKey === processKey) return;
	_lastDurationProcessKey = processKey;

	const currentRound = combat.round;
	const combatant = combat.combatant;
	if (!combatant?.actor) return;

	const currentActor = combatant.actor;
	const currentTokenId = combatant.token?.id;

	console.log(`shadowdark-extras | Processing duration spells for round ${currentRound}, turn of ${currentActor.name} (token: ${currentTokenId})`);

	// Process all actors with duration spells
	for (const actor of game.actors) {
		const activeDuration = actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
		if (activeDuration.length === 0) continue;

		console.log(`shadowdark-extras | [DEBUG] Actor ${actor.name} has ${activeDuration.length} duration spell(s):`,
			activeDuration.map(d => ({ name: d.spellName, expiryRound: d.expiryRound, currentRound })));

		let needsUpdate = false;
		const expiredSpellIds = [];

		for (const durationSpell of activeDuration) {
			// Use instanceId if available, fallback to spellId
			const spellInstanceId = durationSpell.instanceId || durationSpell.spellId;

			console.log(`shadowdark-extras | [DEBUG] Checking spell ${durationSpell.spellName}: currentRound=${currentRound}, expiryRound=${durationSpell.expiryRound}, shouldExpire=${currentRound >= durationSpell.expiryRound}`);

			// Check for expiry - use >= so spell expires ON the expiry round, not after
			if (currentRound >= durationSpell.expiryRound) {
				console.log(`shadowdark-extras | Duration spell ${durationSpell.spellName} has expired`);
				expiredSpellIds.push(spellInstanceId);
				continue;
			}

			// Check for per-turn damage
			if (durationSpell.perTurnDamage) {
				// Initialize processedTargets tracking if not exists
				if (!durationSpell.processedTargetsThisRound) {
					durationSpell.processedTargetsThisRound = {};
				}

				// Reset processed targets at the start of a new round
				if (durationSpell.lastProcessedRound < currentRound) {
					durationSpell.processedTargetsThisRound = {};
					durationSpell.lastProcessedRound = currentRound;
					needsUpdate = true;
				}

				// Find the target entry for the current combatant
				const targetEntry = durationSpell.targets.find(t =>
					t.tokenId === currentTokenId || t.actorId === currentActor.id
				);

				if (targetEntry) {
					// Check if we already processed this target this round
					const targetKey = targetEntry.tokenId || targetEntry.actorId;
					if (!durationSpell.processedTargetsThisRound[targetKey]) {
						console.log(`shadowdark-extras | Applying per-turn damage for ${durationSpell.spellName} to ${currentActor.name}`);

						// Apply per-turn damage to this target
						await applyDurationSpellPerTurnDamage(durationSpell, currentActor, currentTokenId);

						// Mark this target as processed this round
						durationSpell.processedTargetsThisRound[targetKey] = true;
						needsUpdate = true;
					}
					else {
						console.log(`shadowdark-extras | Target ${currentActor.name} already processed this round for ${durationSpell.spellName}`);
					}
				}
			}
		}

		// End expired spells using instanceId
		for (const spellInstanceId of expiredSpellIds) {
			await endDurationSpell(actor.id, spellInstanceId, "expired");
		}

		// Update the flag if needed (filter by instanceId or spellId)
		if (needsUpdate) {
			const updatedDuration = activeDuration.filter(d => {
				const id = d.instanceId || d.spellId;
				return !expiredSpellIds.includes(id);
			});
			await actor.setFlag(MODULE_ID, DURATION_SPELL_FLAG, updatedDuration);
		}
	}
}

/**
 * Apply per-turn damage from a duration spell to a target
 * Respects the autoApplyDamage combat setting
 */
async function applyDurationSpellPerTurnDamage(durationSpell, targetActor, targetTokenId) {
	const MODULE_ID = "shadowdark-extras";
	const formula = durationSpell.perTurnDamage;
	if (!formula) return;

	try {
		// Roll the damage
		const roll = new Roll(formula);
		await roll.evaluate();

		// Show 3D dice animation if Dice So Nice is available
		if (game.dice3d) {
			await game.dice3d.showForRoll(roll, game.user, true);
		}


		const damage = roll.total;
		const damageType = durationSpell.damageType || "damage";

		// Get the token
		const token = canvas.tokens?.get(targetTokenId);
		if (!token?.actor) {
			console.warn(`shadowdark-extras | Could not find token ${targetTokenId} for per-turn damage`);
			return;
		}

		// Check if auto-apply is enabled
		const settings = game.settings.get(MODULE_ID, "combatSettings") || {};
		const autoApplyDamage = settings.damageCard?.autoApplyDamage ?? true;

		// Create the chat message content with compact styling
		const applyButtonHtml = !autoApplyDamage ? `
			<button type="button" class="sdx-duration-apply-btn"
				data-token-id="${targetTokenId}"
				data-damage="${damage}"
				data-actor-name="${targetActor.name}">
				<i class="fas fa-heart-broken"></i> Apply Damage
			</button>
		` : "";

		const content = `
			<div class="sdx-duration-damage-card">
				<div class="sdx-duration-damage-header">
					<i class="fa-solid fa-hourglass-half"></i>
					<span class="sdx-duration-damage-title">${durationSpell.spellName}</span>
				</div>
				<div class="sdx-duration-damage-content">
					<span class="sdx-duration-damage-target">
						<strong>${token.name}</strong> takes <strong class="sdx-damage-value">${damage}</strong> ${damageType} damage!
					</span>
					<span class="sdx-duration-damage-roll">${formula} = ${roll.result}</span>
				</div>
				${applyButtonHtml}
			</div>
		`;

		// Create the chat message
		const chatMessage = await ChatMessage.create({
			content: content,
			speaker: ChatMessage.getSpeaker({ actor: game.actors.get(durationSpell.casterId) }),
			flags: {
				[MODULE_ID]: {
					isDurationDamage: true,
					tokenId: targetTokenId,
					damage: damage,
					damageType: damageType,
					applied: autoApplyDamage,
				},
			},
		});

		// Apply damage if auto-apply is enabled
		if (autoApplyDamage) {
			const currentHp = token.actor.system.attributes.hp.value;
			const newHp = Math.max(0, currentHp - damage);
			await token.actor.update({ "system.attributes.hp.value": newHp });
			console.log(`shadowdark-extras | Auto-applied ${damage} ${damageType} damage to ${targetActor.name} from ${durationSpell.spellName}`);
		}
		else {
			console.log(`shadowdark-extras | Per-turn damage rolled for ${targetActor.name}: ${damage} ${damageType} (awaiting manual apply)`);
		}
	}
	catch (err) {
		console.error("shadowdark-extras | Failed to apply per-turn damage:", err);
	}
}

/**
 * Link an effect to an active duration spell
 * Call this when applying effects via the damage card for duration spells
 *
 * @param {string|Actor} casterActorOrId - The caster actor or their ID
 * @param {string} spellId - The spell item ID
 * @param {string|Actor} targetActorOrId - The target actor or their ID
 * @param {string} targetTokenId - The target token ID
 * @param {string} effectItemId - The effect item ID on the target
 */
/**
 * Link an applied effect to a duration spell for cleanup tracking
 * @param {string|Actor} casterActorOrId - The caster actor or ID
 * @param {string} instanceId - The unique instance ID of the spell (or spellId for backwards compatibility)
 * @param {string|Actor} targetActorOrId - The target actor or ID
 * @param {string} targetTokenId - The target token ID
 * @param {string} effectItemId - The effect item ID
 */
export async function linkEffectToDurationSpell(casterActorOrId, instanceId, targetActorOrId, targetTokenId, effectItemId) {
	const caster = typeof casterActorOrId === "string" ? game.actors.get(casterActorOrId) : casterActorOrId;
	if (!caster) {
		console.warn("shadowdark-extras | Cannot link effect: caster not found");
		return false;
	}

	const targetActor = typeof targetActorOrId === "string" ? game.actors.get(targetActorOrId) : targetActorOrId;

	const activeDuration = caster.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
	// Find by instanceId first, fallback to spellId for backwards compatibility
	// Use findLast for spellId fallback to get the MOST RECENT instance (newest cast)
	let durationEntry = activeDuration.find(d => d.instanceId === instanceId);
	if (!durationEntry) {
		// Find the most recent duration spell with this spellId
		durationEntry = activeDuration.findLast(d => d.spellId === instanceId);
	}

	if (!durationEntry) {
		console.log(`shadowdark-extras | Cannot link effect: spell ${instanceId} is not being tracked as duration spell`);
		return false;
	}

	// Check if this effect is already linked
	if (durationEntry.targetEffects.some(te => te.effectItemId === effectItemId)) {
		console.log(`shadowdark-extras | Effect ${effectItemId} already linked to duration spell ${durationEntry.spellName}`);
		return true;
	}

	// Resolve target name (prefer token name)
	let targetName = targetActor?.name || "Unknown";
	if (targetTokenId) {
		const token = canvas.tokens?.get(targetTokenId);
		if (token) targetName = token.name;
	}
	else if (targetActor?.token) {
		targetName = targetActor.token.name;
	}

	// Add the effect to tracking
	durationEntry.targetEffects.push({
		targetActorId: targetActor?.id || null,
		targetTokenId: targetTokenId,
		effectItemId: effectItemId,
		targetName: targetName,
	});

	// Also add to main targets array if not already present (for UI display)
	// We allow the caster to be a target for Duration spells (e.g. self-buffs like Mage Armor)
	if (targetActor || targetTokenId) {
		const targetAlreadyInList = durationEntry.targets.some(t =>
			(t.actorId && t.actorId === targetActor?.id) ||
			(t.tokenId && t.tokenId === targetTokenId)
		);
		if (!targetAlreadyInList) {
			durationEntry.targets.push({
				tokenId: targetTokenId || null,
				actorId: targetActor?.id || null,
				name: targetName,
			});
			console.log(`shadowdark-extras | Added target to duration spell targets: ${targetActor?.name || targetTokenId}`);
		}
	}

	await caster.setFlag(MODULE_ID, DURATION_SPELL_FLAG, activeDuration);

	console.log(`shadowdark-extras | Linked effect ${effectItemId} to duration spell ${durationEntry.spellName}`);
	return true;
}

/**
 * Add a new target to an existing duration spell
 * Used when a creature enters an area of effect
 *
 * @param {string} casterId - The caster actor ID
 * @param {string} instanceId - The unique instance ID of the spell (or spellId for backwards compatibility)
 * @param {string} tokenId - The token ID to add
 */
export async function addTargetToDurationSpell(casterId, instanceId, tokenId) {
	const caster = game.actors.get(casterId);
	if (!caster) {
		console.warn(`shadowdark-extras | Cannot add target: caster ${casterId} not found`);
		return false;
	}

	const token = canvas.tokens?.get(tokenId);
	if (!token) {
		console.warn(`shadowdark-extras | Cannot add target: token ${tokenId} not found`);
		return false;
	}

	const activeDuration = caster.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
	// Find by instanceId first, fallback to spellId for backwards compatibility
	let durationEntry = activeDuration.find(d => d.instanceId === instanceId);
	if (!durationEntry) {
		durationEntry = activeDuration.find(d => d.spellId === instanceId);
	}

	if (!durationEntry) {
		console.warn(`shadowdark-extras | Cannot add target: spell ${instanceId} not being tracked`);
		return false;
	}

	// Check if already a target
	if (durationEntry.targets.some(t => t.tokenId === tokenId)) {
		ui.notifications.warn(`${token.name} is already a target of ${durationEntry.spellName}`);
		return false;
	}

	// Add the target
	durationEntry.targets.push({
		tokenId: tokenId,
		actorId: token.actor?.id || null,
		name: token.name || "Unknown",
	});

	await caster.setFlag(MODULE_ID, DURATION_SPELL_FLAG, activeDuration);

	// Apply effects if the spell has any
	if (durationEntry.effects && durationEntry.effects.length > 0) {
		let effects = durationEntry.effects;
		if (typeof effects === "string") {
			try {
				effects = JSON.parse(effects);
			}
			catch (e) {
				effects = [];
			}
		}

		// Use instanceId for linking effects
		const spellInstanceId = durationEntry.instanceId || durationEntry.spellId;

		for (const effectData of effects) {
			const effectUuid = typeof effectData === "string" ? effectData : effectData.uuid;
			try {
				let createdEffectId = null;

				// Use socket for GM operation to handle permission issues
				const socket = getSocket();
				if (socket) {
					const result = await socket.executeAsGM("applyEffectToTarget", {
						targetActorId: token.actor?.id,
						targetTokenId: tokenId,
						effectUuid: effectUuid,
						casterId: casterId,
						spellId: spellInstanceId,
					});
					if (result.success) {
						createdEffectId = result.effectId;
					}
				}
				else {
					// Fallback for GM or if socket not available
					const effectDoc = await fromUuid(effectUuid);
					if (!effectDoc) continue;

					const effectItemData = effectDoc.toObject();
					const createdItems = await token.actor.createEmbeddedDocuments("Item", [effectItemData]);

					if (createdItems.length > 0) {
						createdEffectId = createdItems[0].id;
					}
				}

				if (createdEffectId) {
					// Link the effect to the duration spell using instanceId
					await linkEffectToDurationSpell(casterId, spellInstanceId, token.actor.id, tokenId, createdEffectId);
					console.log(`shadowdark-extras | Applied effect to new target ${token.name}`);
				}
			}
			catch (err) {
				console.warn("shadowdark-extras | Failed to apply effect to new target:", err);
			}
		}
	}

	ui.notifications.info(`Added ${token.name} to ${durationEntry.spellName}`);
	caster.sheet?.render(false);

	// Post to chat
	const content = `
		<div class="shadowdark chat-card sdx-duration-damage">
			<header class="card-header flexrow">
				<img src="${durationEntry.spellImg}" alt="${durationEntry.spellName}"/>
				<h3>${durationEntry.spellName} - Target Added</h3>
			</header>
			<div class="card-content">
				<p><strong>${token.name}</strong> has entered the area of effect.</p>
			</div>
		</div>
	`;

	await ChatMessage.create({
		content: content,
		speaker: ChatMessage.getSpeaker({ actor: caster }),
	});

	console.log(`shadowdark-extras | Added ${token.name} to duration spell ${durationEntry.spellName}`);
	return true;
}

/**
 * Remove a target from an existing duration spell
 * Used when a creature leaves an area of effect
 *
 * @param {string} casterId - The caster actor ID
 * @param {string} instanceId - The unique instance ID of the spell (or spellId for backwards compatibility)
 * @param {string} tokenId - The token ID to remove
 */
export async function removeTargetFromDurationSpell(casterId, instanceId, tokenId) {
	const caster = game.actors.get(casterId);
	if (!caster) {
		console.warn(`shadowdark-extras | Cannot remove target: caster ${casterId} not found`);
		return false;
	}

	const activeDuration = caster.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
	// Find by instanceId first, fallback to spellId for backwards compatibility
	let durationEntry = activeDuration.find(d => d.instanceId === instanceId);
	if (!durationEntry) {
		durationEntry = activeDuration.find(d => d.spellId === instanceId);
	}

	if (!durationEntry) {
		console.warn(`shadowdark-extras | Cannot remove target: spell ${instanceId} not being tracked`);
		return false;
	}

	// Find and remove the target
	const targetIndex = durationEntry.targets.findIndex(t => t.tokenId === tokenId);
	if (targetIndex < 0) {
		console.warn(`shadowdark-extras | Target ${tokenId} not found in spell targets`);
		return false;
	}

	const removedTarget = durationEntry.targets[targetIndex];
	durationEntry.targets.splice(targetIndex, 1);

	// Remove any effects applied to this target
	const effectsToRemove = durationEntry.targetEffects?.filter(te => te.targetTokenId === tokenId) || [];

	for (const targetEffect of effectsToRemove) {
		try {
			// Use socketlib to remove the effect as GM
			const socket = getSocket();
			if (socket) {
				await socket.executeAsGM("removeTargetEffect", {
					targetActorId: targetEffect.targetActorId,
					targetTokenId: targetEffect.targetTokenId,
					effectItemId: targetEffect.effectItemId,
				});
				console.log(`shadowdark-extras | Removed effect via socket from ${removedTarget.name}`);
			}
			else {
				// Fallback for GM or if socket not available
				let targetActor = null;
				const token = canvas.tokens?.get(tokenId);
				if (token?.actor) {
					targetActor = token.actor;
				}
				else if (targetEffect.targetActorId) {
					targetActor = game.actors.get(targetEffect.targetActorId);
				}

				if (targetActor) {
					// Check for Item first
					let effectDoc = targetActor.items.get(targetEffect.effectItemId);

					// If not an Item, check for ActiveEffect (e.g. Auras)
					if (!effectDoc) {
						effectDoc = targetActor.effects.get(targetEffect.effectItemId);
					}

					if (effectDoc) {
						await effectDoc.delete();
						console.log(`shadowdark-extras | Removed effect ${effectDoc.name || targetEffect.effectItemId} from ${removedTarget.name}`);
					}
				}
			}
		}
		catch (err) {
			console.warn("shadowdark-extras | Failed to remove effect from target:", err);
		}
	}

	// Remove the effect references from tracking
	durationEntry.targetEffects = durationEntry.targetEffects?.filter(te => te.targetTokenId !== tokenId) || [];

	await caster.setFlag(MODULE_ID, DURATION_SPELL_FLAG, activeDuration);

	ui.notifications.info(`Removed ${removedTarget.name} from ${durationEntry.spellName}`);
	caster.sheet?.render(false);

	// Post to chat
	const content = `
		<div class="shadowdark chat-card sdx-duration-damage">
			<header class="card-header flexrow">
				<img src="${durationEntry.spellImg}" alt="${durationEntry.spellName}"/>
				<h3>${durationEntry.spellName} - Target Removed</h3>
			</header>
			<div class="card-content">
				<p><strong>${removedTarget.name}</strong> has left the area of effect.</p>
				${effectsToRemove.length > 0 ? "<p>Effects removed.</p>" : ""}
			</div>
		</div>
	`;

	await ChatMessage.create({
		content: content,
		speaker: ChatMessage.getSpeaker({ actor: caster }),
	});

	console.log(`shadowdark-extras | Removed ${removedTarget.name} from duration spell ${durationEntry.spellName}`);
	return true;
}

/**
 * End a focus spell and remove all associated effects
 * @param {string} casterId - The actor ID of the caster
 * @param {string} spellId - The spell item ID
 * @param {string} reason - Why the focus ended ("focus_failed", "manual", "spell_lost")
 */
/**
 * Warning-free "templates on a scene" collection for v14. MeasuredTemplate was
 * merged into Region: the auto-created Region carries the SAME id and flags as the
 * template, and scene.regions is warning-free — whereas both Scene#templates and
 * getEmbeddedCollection("MeasuredTemplate") route through the deprecated getter.
 * Falls back to the legacy collection on pre-v14 clients.
 */
export function getSceneMeasuredTemplates(scene) {
	return scene?.regions ?? scene?.templates ?? [];
}


export function buildDurationSpellsHtml(actor, activeDuration) {
	const currentRound = game.combat?.round ?? 0;
	let spellsHtml = "";

	for (const duration of activeDuration) {
		const remainingRounds = Math.max(0, duration.expiryRound - currentRound);
		const targetCount = duration.targets?.length || 0;
		// Use instanceId if available, fallback to spellId
		const spellInstanceId = duration.instanceId || duration.spellId;

		// Build target list HTML with individual remove buttons
		let targetsListHtml = "";
		if (duration.targets && duration.targets.length > 0) {
			for (const target of duration.targets) {
				// Check if this target has effects applied
				const hasEffects = duration.targetEffects?.some(te =>
					te.targetTokenId === target.tokenId || te.targetActorId === target.actorId
				);

				targetsListHtml += `
					<div class="sdx-duration-target" data-token-id="${target.tokenId}" data-actor-id="${target.actorId || ""}">
						<span class="sdx-target-name">
							<i class="fas fa-user"></i> ${target.name}
							${hasEffects ? '<i class="fas fa-magic" title="Has effects applied" style="color: #9b59b6; margin-left: 4px;"></i>' : ""}
						</span>
						<a class="sdx-remove-target" data-action="remove-duration-target"
						   data-instance-id="${spellInstanceId}"
						   data-token-id="${target.tokenId}"
						   data-tooltip="Remove from spell (left area)">
							<i class="fas fa-times" style="color: #ff6666;"></i>
						</a>
					</div>
				`;
			}
		}
		else {
			targetsListHtml = '<div class="sdx-no-targets">No targets</div>';
		}

		spellsHtml += `
			<li class="item sdx-duration-spell" data-instance-id="${spellInstanceId}" data-spell-id="${duration.spellId}">
				<div class="sdx-duration-spell-header">
					<div class="item-image" style="background-image: url(${duration.spellImg})">
						<i class="fas fa-clock"></i>
					</div>
					<div class="sdx-focus-info">
						<span class="sdx-duration-spell-name">${duration.spellName}</span>
					</div>
					<span class="sdx-duration-time" title="Remaining duration">
						${remainingRounds} rnd${remainingRounds !== 1 ? "s" : ""}
					</span>
					<span class="sdx-focus-targets">
						<i class="fas fa-bullseye"></i> ${targetCount}
					</span>
					<div class="actions">
						<a data-action="toggle-duration-targets" data-instance-id="${spellInstanceId}"
						   data-tooltip="Show/hide targets">
							<i class="fas fa-chevron-down"></i>
						</a>
						<a data-action="add-duration-target" data-instance-id="${spellInstanceId}"
						   data-tooltip="Add selected token to spell (entered area)">
							<i class="fas fa-plus" style="color: #2ecc71;"></i>
						</a>
						<a data-action="end-duration" data-instance-id="${spellInstanceId}"
						   data-tooltip="End this spell">
							<i class="fa-solid fa-xmark" style="color: #ff6666;"></i>
						</a>
					</div>
				</div>
				<div class="sdx-duration-targets-list" data-instance-id="${spellInstanceId}" style="display: none;">
					${targetsListHtml}
				</div>
			</li>
		`;
	}

	return `
		<div class="SD-box sdx-duration-spells-section">
			<div class="header">
				<label>
					<i class="fas fa-clock"></i>
					Active Duration Spells
				</label>
			</div>
			<div class="content">
				<ol class="SD-list sdx-duration-spells-list">
					${spellsHtml}
				</ol>
			</div>
		</div>
		<br>
	`;
}

/**
 * Disable right-click context menu on spell items
 */
