import { MODULE_ID, DURATION_SPELL_FLAG, SPELL_MODIFICATIONS_FLAG } from "./focus-constants.mjs";
import { matchesDurationEffect, updateDurationSpells } from "./duration-state.mjs";
import { getSocket } from "../shared/combat-socket.mjs";
import { buildDurationSpellsHtml, onDurationDamageApplyClick } from "./duration-ui.mjs";
import {
	applyEffectItemTiming, buildActiveEffectTiming, buildDurationExpiry,
	getDurationSpellActiveEffect, getDurationSpellCastTiming, getDurationToken, isDurationExpired,
} from "../shared/duration-basis.mjs";

// All clients share the active GM's registry queue; a browser-local lock cannot
// serialize an owner's new cast against another client's core expiry hook.
function relayDurationOperation(caster, operation, data) {
	const gm = game.users?.activeGM;
	if (game.user?.isGM && (!gm || gm.id === game.user.id)) return null;
	const socket = getSocket();
	if (!gm || !socket) throw new Error("Duration tracking requires an active GM and socketlib");
	return socket.executeAsUser("durationSpellOperation", gm.id, {
		casterUuid: caster.uuid, operation, ...data,
	});
}

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

	// Work out when this ends, against whichever clock is actually running.
	//
	// This used to read `game.combat?.round ?? 0` and always store a round, so a
	// spell cast outside combat got an expiry round equal to just its duration —
	// a number with no relation to when it was cast, which then fired partway
	// through whatever encounter started next. It also disagreed with the
	// summon-expiry path, which reads an unstarted encounter's round 0 as 1.
	// Both now share one rule.
	const roundsToLast = durationType === "turns"
		? Math.ceil(durationValue / 10)   // Approximate
		: durationValue;
	const expiry = buildDurationExpiry(roundsToLast, {
		combat: game.combat, worldTime: game.time?.worldTime ?? 0,
	});
	// Per-turn damage is inherently a combat loop, so its bookkeeping stays on
	// rounds even when the duration itself is held in world time.
	const currentRound = game.combat?.round ?? 0;

	console.log(`shadowdark-extras | Duration spell tracking: ${spell.name}`, expiry);

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
		sceneId: canvas.scene?.id ?? null,
		templateId: spellConfig.templateId || null, // Link to the specific template
		summonedTokenIds: spellConfig.summonedTokenIds || [], // Track summoned tokens for cleanup
		startRound: currentRound,
		// Late arrivals retain this cast's clock even if combat starts meanwhile.
		effectTiming: buildActiveEffectTiming({ value: durationValue, units: durationType }, {
			combat: game.combat, worldTime: game.time?.worldTime ?? 0,
		}),
		...expiry,
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

	// Build the snapshot on the casting client so a GM viewing another encounter
	// cannot replace the cast's original clock or target names.
	const remote = relayDurationOperation(caster, "append", { entry: durationData });
	if (remote) await remote;
	else await updateDurationSpells(caster, entries => {
		entries.push(durationData);
	});

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
					// getProperty handles Foundry's dot-notation nested keys
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
				const remainingMods = mods.filter(
					m => !(m.spellId === spellId && m.casterId === casterId)
				);

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
			catch(err) {
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
 * @param {string} instanceId - Unique instance ID (or spellId for backwards compatibility)
 * @param {string} reason - The reason for ending ("expired" or "manual")
 */
export async function endDurationSpell(casterId, instanceId, reason = "expired", sceneId = canvas.scene?.id) {
	console.warn(`shadowdark-extras | [ENTRY] endDurationSpell called with casterId=${casterId}, instanceId=${instanceId}, reason=${reason}`);

	const caster = game.actors.get(casterId);
	if (!caster) return;
	const remote = relayDurationOperation(caster, "end", { instanceId, reason, sceneId });
	if (remote) return remote;

	// Claim this cast before deleting documents. Delete hooks and other casts may
	// write the same registry while cleanup awaits server round trips.
	const durationEntry = await updateDurationSpells(caster, entries => {
		const entry = entries.find(d => d.instanceId === instanceId)
			?? entries.findLast(d => d.spellId === instanceId);
		if (!entry) return false;
		entries.splice(entries.indexOf(entry), 1);
		return entry;
	});
	if (!durationEntry) return;
	sceneId = durationEntry.sceneId || sceneId;
	const scene = sceneId ? game.scenes?.get(sceneId) : canvas.scene;
	console.log("shadowdark-extras | [DEBUG] Found duration entry:", durationEntry);

	// Remove all effects applied to targets
	if (durationEntry.targetEffects && durationEntry.targetEffects.length > 0) {
		console.log(`shadowdark-extras | Removing ${durationEntry.targetEffects.length} effects from duration spell ${durationEntry.spellName}`);

		// Iterate over a copy; the original may be mutated by handleEffectDeleted hooks
		// Fixes the "N-1" bug when the array shrinks during iteration
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
						sceneId,
					});
					console.log("shadowdark-extras | Removed effect via socket");
				}
				else {
					// Fallback for GM or if socket not available
					let targetActor = null;

					// Try token first (for unlinked tokens)
					if (targetEffect.targetTokenId) {
						const token = getDurationToken(targetEffect.targetTokenId, sceneId);
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
			catch(err) {
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
					holyWeaponSpellId, holyWeaponCasterId,
					cleansingWeaponSpellId, cleansingWeaponCasterId,
					targetSpellId: durationEntry.spellId, targetCasterId: casterId,
				});
			}

			// Check if this weapon was blessed by the ending spell (old flag system)
			if ((holyWeaponSpellId === durationEntry.spellId && holyWeaponCasterId === casterId)
				|| (cleansingWeaponSpellId === durationEntry.spellId
					&& cleansingWeaponCasterId === casterId)) {

				const isCleansing = !!cleansingWeaponSpellId;
				console.log(`shadowdark-extras | [Legacy] Removing ${isCleansing ? "Cleansing" : "Holy"} Weapon bonuses from ${weapon.name} on ${actor.name}`);

				// Remove the weapon bonuses and magical status
				const updates = {
					"system.magicItem": false,
					"flags.shadowdark-extras.weaponBonus": null,
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
					const matchesCaster = templateFlags.casterActorId === casterId
						|| templateFlags.casterId === casterId;

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
	catch(err) {
		console.warn("shadowdark-extras | Failed to delete templates for ended spell:", err);
	}

	// Delete summoned tokens if this spell had any
	if (durationEntry.summonedTokenIds && durationEntry.summonedTokenIds.length > 0) {
		try {
			if (scene && game.user.isGM) {
				const tokensToDelete = durationEntry.summonedTokenIds.filter(tokenId => {
					return scene.tokens.get(tokenId) !== undefined;
				});

				if (tokensToDelete.length > 0) {
					await scene.deleteEmbeddedDocuments("Token", tokensToDelete);
					console.log(`shadowdark-extras | Deleted ${tokensToDelete.length} summoned token(s) for ended spell ${durationEntry.spellName}`);
				}

				// Also remove from expiry tracking
				const { getSummonedTokensExpiry, saveSummonedTokensExpiry } = await import("../combat/damage-card-actions.mjs");
				const expiryList = getSummonedTokensExpiry(scene.id) || [];
				const updatedExpiryList = expiryList.filter(entry => {
					// Remove entries that match this spell's tokens
					const hasMatchingToken = entry.tokenIds?.some(tokenId =>
						durationEntry.summonedTokenIds.includes(tokenId)
					);
					return !hasMatchingToken;
				});

				if (updatedExpiryList.length !== expiryList.length) {
					await saveSummonedTokensExpiry(scene.id, updatedExpiryList);
					console.log("shadowdark-extras | Removed summoned tokens from expiry tracking");
				}
			}
		}
		catch(err) {
			console.warn("shadowdark-extras | Failed to delete summoned tokens for ended spell:", err);
		}
	}


	// Post to chat. spellImg/spellName come from a player-owned, player-renameable
	// spell item and render on every connected client, so escape both.
	const escapedSpellImg = foundry.utils.escapeHTML(durationEntry.spellImg ?? "");
	const escapedSpellName = foundry.utils.escapeHTML(durationEntry.spellName ?? "");
	const chatContent = `
		<div class="shadowdark chat-card focus-ended">
			<header class="card-header flexrow">
				<img class="focus-ended-icon" src="${escapedSpellImg}" alt="${escapedSpellName}"/>
				<div class="focus-ended-header-text">
					<h3>${game.i18n.localize("SHADOWDARK_EXTRAS.duration_tracker.spell_ended_title")}</h3>
					<p class="spell-name">${escapedSpellName}</p>
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


// Track which combat state we've already processed for duration spells
let _lastDurationProcessKey = null;
const _expiringEffectItems = new WeakSet();

function getCoreDurationEffect(durationEntry) {
	const effect = getDurationSpellActiveEffect(durationEntry);
	return effect?.parent?.type === "Effect" ? effect : null;
}

function usesCoreEffectExpiry(durationEntry) {
	return !!getCoreDurationEffect(durationEntry);
}

function isCoreEffectExpiringNow(durationEntry, combat) {
	const effect = getCoreDurationEffect(durationEntry);
	if (!effect) return false;
	const duration = effect.updateDuration?.({ combat }) ?? effect.duration;
	return duration?.expired === true || (duration?.remaining <= 0
		&& effect.isExpiryEvent?.("turnStart", { combat }) === true);
}

/** Expire one linked item; shared cast cleanup waits for its last linked item. */
export async function handleDurationEffectUpdate(effect, changes) {
	if (changes?.duration?.expired !== true) return false;
	if (!game.user?.isGM) return false;
	if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return false;

	const effectItem = effect?.parent;
	const targetActor = effect?.actor || effectItem?.actor;
	if (effectItem?.type !== "Effect" || !targetActor?.id) return false;
	// One item may contain several independently timed Active Effects.
	if (Array.from(effectItem.effects ?? []).some(sibling => sibling !== effect
		&& Number.isFinite(sibling.duration?.remaining) && !sibling.duration.expired)) return false;

	if (_expiringEffectItems.has(effectItem)) return false;
	const linked = Array.from(game.actors ?? []).flatMap(caster =>
		getActiveDurationSpells(caster)
			.filter(entry => entry.targetEffects?.some(link =>
				matchesDurationEffect(link, effectItem)))
			.map(entry => ({ caster, instanceId: entry.instanceId || entry.spellId })));
	if (!linked.length) return false;

	_expiringEffectItems.add(effectItem);
	try {
		// This handler owns the unlink; deleteItem hooks must not race it on other clients.
		await effectItem.delete({ sdxDurationExpiry: true });
		for (const { caster, instanceId } of linked) {
			await updateDurationSpells(caster, entries => {
				const entry = entries.find(d => (d.instanceId || d.spellId) === instanceId);
				if (!entry) return false;
				entry.targetEffects = (entry.targetEffects ?? []).filter(link =>
					!matchesDurationEffect(link, effectItem));
				// A target with another running item must retain its damage/UI entry.
				entry.targets = (entry.targets ?? []).filter(target =>
					(targetActor.isToken ? target.tokenId !== targetActor.token?.id
						: target.actorId !== targetActor.id)
					|| entry.targetEffects.some(link => target.tokenId
						? link.targetTokenId === target.tokenId
						: link.targetActorId === target.actorId));
			});
			const entry = getActiveDurationSpells(caster).find(d =>
				(d.instanceId || d.spellId) === instanceId);
			if (entry && !entry.targetEffects?.length) {
				await endDurationSpell(caster.id, instanceId, "expired");
			}
		}
		return true;
	}
	finally {
		_expiringEffectItems.delete(effectItem);
	}
}

/**
 * End duration spells whose world-time expiry has arrived.
 *
 * The combat handler below only runs on turn changes, so a spell held in world
 * time — anything cast outside an encounter — was never checked at all. This is
 * deliberately only the expiry half: per-turn damage and effect reapplication
 * are turn-driven and have no meaning without an encounter.
 */
export async function handleDurationSpellWorldTimeUpdate() {
	if (!game.user.isGM) return;
	if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return;

	const worldTime = game.time?.worldTime ?? null;
	if (!Number.isFinite(worldTime)) return;

	for (const actor of game.actors) {
		const activeDuration = actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
		if (activeDuration.length === 0) continue;

		// Round is deliberately absent here: a round-based entry must not be ended
		// by world time passing, only by its own encounter advancing.
		// Linked effects use Foundry's Active Effect clock. The legacy clock is a
		// fallback only for duration spells that have no Active Effect to observe.
		const expired = activeDuration.filter(d =>
			!usesCoreEffectExpiry(d) && isDurationExpired(d, { worldTime })
		);
		if (expired.length === 0) continue;

		for (const durationSpell of expired) {
			console.log(`shadowdark-extras | Duration spell ${durationSpell.spellName} has expired (world time)`);
			await endDurationSpell(actor.id, durationSpell.instanceId || durationSpell.spellId, "expired");
		}
	}
}

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
		const activeDuration = foundry.utils.deepClone(getActiveDurationSpells(actor));
		if (activeDuration.length === 0) continue;

		console.log(`shadowdark-extras | [DEBUG] Actor ${actor.name} has ${activeDuration.length} duration spell(s):`,
			activeDuration.map(
				d => ({ name: d.spellName, expiryRound: d.expiryRound, currentRound })
			));

		let needsUpdate = false;
		const expiredSpellIds = [];

		for (const durationSpell of activeDuration) {
			// Use instanceId if available, fallback to spellId
			const spellInstanceId = durationSpell.instanceId || durationSpell.spellId;

			// One predicate for both clocks: a round entry ignores world time and a
			// world-time entry ignores rounds, so neither ends the other early.
			const due = !usesCoreEffectExpiry(durationSpell) && isDurationExpired(durationSpell, {
				round: currentRound, worldTime: game.time?.worldTime ?? null,
			});

			if (due) {
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
					// Core expiry and this hook overlap. Check this target's clock, not
					// a still-running effect on another target of the same cast.
					if (isCoreEffectExpiringNow({
						sceneId: durationSpell.sceneId,
						targetEffects: durationSpell.targetEffects?.filter(link =>
							link.targetTokenId ? link.targetTokenId === currentTokenId
								: link.targetActorId === currentActor.id),
					}, combat)) continue;

					// Check if we already processed this target this round
					const targetKey = targetEntry.tokenId || targetEntry.actorId;
					if (!durationSpell.processedTargetsThisRound[targetKey]) {
						console.log(`shadowdark-extras | Applying per-turn damage for ${durationSpell.spellName} to ${currentActor.name}`);

						// Apply per-turn damage to this target
						await applyDurationSpellPerTurnDamage(
							durationSpell, currentActor, currentTokenId
						);

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

		// Merge only damage bookkeeping into live entries; cleanup may have removed
		// casts or targets while a roll or HP update was awaiting the server.
		if (needsUpdate) {
			await updateDurationSpells(actor, entries => {
				for (const entry of entries) {
					const processed = activeDuration.find(d =>
						(d.instanceId || d.spellId) === (entry.instanceId || entry.spellId));
					if (!processed?.perTurnDamage) continue;
					if (processed.lastProcessedRound < entry.lastProcessedRound) continue;
					const sameRound = processed.lastProcessedRound === entry.lastProcessedRound;
					entry.processedTargetsThisRound = {
						...(sameRound ? entry.processedTargetsThisRound : {}),
						...processed.processedTargetsThisRound,
					};
					entry.lastProcessedRound = processed.lastProcessedRound;
				}
			});
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
				data-actor-name="${foundry.utils.escapeHTML(targetActor.name)}">
				<i class="fas fa-heart-broken"></i> Apply Damage
			</button>
		` : "";

		const content = `
			<div class="sdx-duration-damage-card">
				<div class="sdx-duration-damage-header">
					<i class="fa-solid fa-hourglass-half"></i>
					<span class="sdx-duration-damage-title">${foundry.utils.escapeHTML(durationSpell.spellName ?? "")}</span>
				</div>
				<div class="sdx-duration-damage-content">
					<span class="sdx-duration-damage-target">
						<strong>${foundry.utils.escapeHTML(token.name)}</strong> takes <strong class="sdx-damage-value">${damage}</strong> ${foundry.utils.escapeHTML(damageType ?? "")} damage!
					</span>
					<span class="sdx-duration-damage-roll">${foundry.utils.escapeHTML(formula ?? "")} = ${roll.result}</span>
				</div>
				${applyButtonHtml}
			</div>
		`;

		// Create the chat message
		await ChatMessage.create({
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
	catch(err) {
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
 * @param {string} instanceId - Unique instance ID (or spellId for backwards compatibility)
 * @param {string|Actor} targetActorOrId - The target actor or ID
 * @param {string} targetTokenId - The target token ID
 * @param {string} effectItemId - The effect item ID
 */
export async function linkEffectToDurationSpell(casterActorOrId, instanceId, targetActorOrId,
	targetTokenId, effectItemId, sceneId = canvas.scene?.id) {
	const caster = typeof casterActorOrId === "string" ? game.actors.get(casterActorOrId) : casterActorOrId;
	if (!caster) {
		console.warn("shadowdark-extras | Cannot link effect: caster not found");
		return false;
	}

	const targetActor = typeof targetActorOrId === "string" ? game.actors.get(targetActorOrId) : targetActorOrId;
	const remote = relayDurationOperation(caster, "link", {
		instanceId, targetActorId: targetActor?.id, targetTokenId, effectItemId, sceneId,
	});
	if (remote) return remote;
	return updateDurationSpells(caster, entries => {
		// Legacy spell IDs identify the newest cast; instance IDs stay exact.
		const entry = entries.find(d => d.instanceId === instanceId)
			?? entries.findLast(d => d.spellId === instanceId);
		if (!entry) return false;
		if (entry.targetEffects.some(link => link.effectItemId === effectItemId
			&& link.targetActorId === targetActor?.id
			&& link.targetTokenId === targetTokenId)) return true;
		const name = getDurationToken(targetTokenId, entry.sceneId || sceneId)?.name
			?? targetActor?.token?.name ?? targetActor?.name ?? "Unknown";
		entry.targetEffects.push({
			targetActorId: targetActor?.id || null, targetTokenId, effectItemId, targetName: name,
		});
		if ((targetActor || targetTokenId) && !entry.targets.some(t => targetTokenId
			? t.tokenId === targetTokenId : t.actorId === targetActor?.id)) {
			entry.targets.push({
				tokenId: targetTokenId || null, actorId: targetActor?.id || null, name,
			});
		}
		return true;
	});
}

/**
 * Add a new target to an existing duration spell
 * Used when a creature enters an area of effect
 *
 * @param {string} casterId - The caster actor ID
 * @param {string} instanceId - Unique instance ID (or spellId for backwards compatibility)
 * @param {string} tokenId - The token ID to add
 */
export async function addTargetToDurationSpell(casterId, instanceId, tokenId,
	sceneId = canvas.scene?.id) {
	const caster = game.actors.get(casterId);
	if (!caster) {
		console.warn(`shadowdark-extras | Cannot add target: caster ${casterId} not found`);
		return false;
	}
	const remote = relayDurationOperation(caster, "addTarget", { instanceId, tokenId, sceneId });
	if (remote) return remote;

	const activeDuration = caster.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
	// Find by instanceId first, fallback to spellId for backwards compatibility
	let durationEntry = activeDuration.find(d => d.instanceId === instanceId);
	if (!durationEntry) {
		durationEntry = activeDuration.findLast(d => d.spellId === instanceId);
	}

	if (!durationEntry) {
		console.warn(`shadowdark-extras | Cannot add target: spell ${instanceId} not being tracked`);
		return false;
	}
	sceneId = durationEntry.sceneId || sceneId;
	const token = getDurationToken(tokenId, sceneId);
	if (!token) {
		console.warn(`shadowdark-extras | Cannot add target: token ${tokenId} not found`);
		return false;
	}

	// Check if already a target
	if (durationEntry.targets.some(t => t.tokenId === tokenId)) {
		ui.notifications.warn(`${token.name} is already a target of ${durationEntry.spellName}`);
		return false;
	}

	const added = await updateDurationSpells(caster, entries => {
		const entry = entries.find(d =>
			(d.instanceId || d.spellId) === (durationEntry.instanceId || durationEntry.spellId));
		if (!entry || entry.targets.some(t => t.tokenId === tokenId)) return false;
		entry.sceneId ??= sceneId;
		entry.targets.push({ tokenId, actorId: token.actor?.id || null, name: token.name || "Unknown" });
		return true;
	});
	if (!added) return false;

	// Apply effects if the spell has any
	if (durationEntry.effects && durationEntry.effects.length > 0) {
		let effects = durationEntry.effects;
		if (typeof effects === "string") {
			try {
				effects = JSON.parse(effects);
			}
			catch(e) {
				effects = [];
			}
		}

		// Use instanceId for linking effects
		const spellInstanceId = durationEntry.instanceId || durationEntry.spellId;

		for (const effectData of effects) {
			const effectUuid = typeof effectData === "string" ? effectData : effectData.uuid;
			const durationOverride = typeof effectData === "object" ? effectData.duration ?? {} : {};
			try {
				let createdEffectId = null;

				// Use socket for GM operation to handle permission issues
				const socket = getSocket();
				if (socket) {
					const result = await socket.executeAsGM("applyEffectToTarget", {
						targetActorId: token.actor?.id,
						targetTokenId: tokenId,
						effectUuid: effectUuid,
						duration: durationOverride,
						casterId: casterId,
						spellId: spellInstanceId,
						sceneId,
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
					applyEffectItemTiming(effectItemData, durationOverride, {
						combat: game.combat,
						worldTime: game.time?.worldTime ?? 0,
						castTiming: getDurationSpellCastTiming(durationEntry),
					});
					const createdItems = await token.actor.createEmbeddedDocuments("Item", [effectItemData]);

					if (createdItems.length > 0) {
						createdEffectId = createdItems[0].id;
					}
				}

				if (createdEffectId) {
					// Link the effect to the duration spell using instanceId
					await linkEffectToDurationSpell(
						casterId, spellInstanceId, token.actor, tokenId,
						createdEffectId, sceneId);
					console.log(`shadowdark-extras | Applied effect to new target ${token.name}`);
				}
			}
			catch(err) {
				console.warn("shadowdark-extras | Failed to apply effect to new target:", err);
			}
		}
	}

	ui.notifications.info(`Added ${token.name} to ${durationEntry.spellName}`);
	caster.sheet?.render(false);

	// Post to chat. Spell and token names are player-editable, so escape them.
	const escapedSpellImg = foundry.utils.escapeHTML(durationEntry.spellImg ?? "");
	const escapedSpellName = foundry.utils.escapeHTML(durationEntry.spellName ?? "");
	const escapedTokenName = foundry.utils.escapeHTML(token.name ?? "");
	const content = `
		<div class="shadowdark chat-card sdx-duration-damage">
			<header class="card-header flexrow">
				<img src="${escapedSpellImg}" alt="${escapedSpellName}"/>
				<h3>${escapedSpellName} - Target Added</h3>
			</header>
			<div class="card-content">
				<p><strong>${escapedTokenName}</strong> has entered the area of effect.</p>
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
 * @param {string} instanceId - Unique instance ID (or spellId for backwards compatibility)
 * @param {string} tokenId - The token ID to remove
 */
export async function removeTargetFromDurationSpell(casterId, instanceId, tokenId,
	sceneId = canvas.scene?.id) {
	const caster = game.actors.get(casterId);
	if (!caster) {
		console.warn(`shadowdark-extras | Cannot remove target: caster ${casterId} not found`);
		return false;
	}
	const remote = relayDurationOperation(caster, "removeTarget", { instanceId, tokenId, sceneId });
	if (remote) return remote;

	const activeDuration = caster.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];
	// Find by instanceId first, fallback to spellId for backwards compatibility
	let durationEntry = activeDuration.find(d => d.instanceId === instanceId);
	if (!durationEntry) {
		durationEntry = activeDuration.findLast(d => d.spellId === instanceId);
	}

	if (!durationEntry) {
		console.warn(`shadowdark-extras | Cannot remove target: spell ${instanceId} not being tracked`);
		return false;
	}
	sceneId = durationEntry.sceneId || sceneId;

	// Find and remove the target
	const targetIndex = durationEntry.targets.findIndex(t => t.tokenId === tokenId);
	if (targetIndex < 0) {
		console.warn(`shadowdark-extras | Target ${tokenId} not found in spell targets`);
		return false;
	}

	const removedTarget = durationEntry.targets[targetIndex];

	// Remove any effects applied to this target
	const effectsToRemove = durationEntry.targetEffects?.filter(
		te => te.targetTokenId === tokenId
	) || [];

	for (const targetEffect of effectsToRemove) {
		try {
			// Use socketlib to remove the effect as GM
			const socket = getSocket();
			if (socket) {
				await socket.executeAsGM("removeTargetEffect", {
					targetActorId: targetEffect.targetActorId,
					targetTokenId: targetEffect.targetTokenId,
					effectItemId: targetEffect.effectItemId,
					sceneId,
				});
				console.log(`shadowdark-extras | Removed effect via socket from ${removedTarget.name}`);
			}
			else {
				// Fallback for GM or if socket not available
				let targetActor = null;
				const token = getDurationToken(tokenId, sceneId);
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
		catch(err) {
			console.warn("shadowdark-extras | Failed to remove effect from target:", err);
		}
	}

	await updateDurationSpells(caster, entries => {
		const entry = entries.find(d =>
			(d.instanceId || d.spellId) === (durationEntry.instanceId || durationEntry.spellId));
		if (!entry) return false;
		entry.targets = entry.targets.filter(t => t.tokenId !== tokenId);
		entry.targetEffects = (entry.targetEffects ?? []).filter(link =>
			link.targetTokenId !== tokenId);
	});

	ui.notifications.info(`Removed ${removedTarget.name} from ${durationEntry.spellName}`);
	caster.sheet?.render(false);

	// Post to chat. Spell and token names are player-editable, so escape them.
	const escapedSpellImg = foundry.utils.escapeHTML(durationEntry.spellImg ?? "");
	const escapedSpellName = foundry.utils.escapeHTML(durationEntry.spellName ?? "");
	const escapedTargetName = foundry.utils.escapeHTML(removedTarget.name ?? "");
	const content = `
		<div class="shadowdark chat-card sdx-duration-damage">
			<header class="card-header flexrow">
				<img src="${escapedSpellImg}" alt="${escapedSpellName}"/>
				<h3>${escapedSpellName} - Target Removed</h3>
			</header>
			<div class="card-content">
				<p><strong>${escapedTargetName}</strong> has left the area of effect.</p>
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


/**
 * Disable right-click context menu on spell items
 */

// Public surface preserved (Phase 5.3 lane-C split re-exports).
export { buildDurationSpellsHtml, onDurationDamageApplyClick };
