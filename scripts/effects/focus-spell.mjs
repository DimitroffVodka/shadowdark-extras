import { MODULE_ID, FOCUS_SPELL_FLAG, DURATION_SPELL_FLAG, _endingFocusSpells } from "./focus-constants.mjs";
import { linkEffectToDurationSpell, getSceneMeasuredTemplates } from "./duration-spell.mjs";
import { renderFocusEndedChat, buildFocusSpellsHtml } from "./focus-ui.mjs";

export async function startFocusSpell(actor, spell, perTurnConfig = null) {
	// Cache spell data so focus checks still roll if the item is deleted (e.g. scrolls)
	const spellData = {
		tier: spell.system?.tier ?? 1,
		ability: spell.system?.spellcasting?.ability ?? actor.system?.spellcastingAbility ?? actor.system?.ability ?? "INT",
		dc: spell.system?.dc ?? (spell.system?.tier ? (10 + spell.system.tier) : 11),
		type: spell.type,
		description: spell.system?.description ?? "",
		// Cache the spell's class UUIDs - important for focus rolls to use correct ability
		class: spell.system?.class || [],
		// Cache the spell name for scrolls (stored as spellName in scroll system data)
		spellName: spell.system?.spellName || spell.name,
	};

	const focusData = {
		spellId: spell.id,
		spellName: spell.name,
		spellImg: spell.img,
		casterId: actor.id,
		casterName: actor.name,
		startTime: game.time.worldTime,
		startRound: game.combat?.round ?? null,
		spellData: spellData, // Cache spell data for focus rolls
		targetEffects: [],
		// Per-turn damage/healing config
		perTurnDamage: perTurnConfig?.perTurnDamage || null,
		perTurnTrigger: perTurnConfig?.perTurnTrigger || "start",
		damageType: perTurnConfig?.damageType || "",
		reapplyEffects: perTurnConfig?.reapplyEffects || false,
		effects: perTurnConfig?.effects || [],
	};

	// Get current active focus spells
	const currentFocus = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];

	// Check if we're already focusing on this spell (shouldn't happen, but be safe)
	const existingIndex = currentFocus.findIndex(f => f.spellId === spell.id);
	if (existingIndex >= 0) {
		// Update existing entry
		currentFocus[existingIndex] = focusData;
	}
	else {
		// Add new entry
		currentFocus.push(focusData);
	}

	await actor.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, currentFocus);

	// Add Concentration effect to the actor
	const concentrationIcon = "icons/magic/time/hourglass-tilted-glowing-gold.webp";
	const concentrationName = game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.concentration_name", { spellName: spell.name });
	const concentrationDesc = game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.concentration_description", { spellName: spell.name });

	const effectData = {
		name: concentrationName,
		type: "Effect",
		img: concentrationIcon,
		system: {
			description: concentrationDesc,
			duration: {
				type: "focus",
				value: 0,
				unit: "",
			},
		},
		effects: [{
			name: concentrationName,
			// v13 renamed ActiveEffect#icon to #img; `icon` is inert in v14, so
			// the concentration effect rendered without its icon.
			img: concentrationIcon,
			origin: spell.uuid,
			transfer: true,
			statuses: ["concentration"],
			disabled: false,
		}],
		flags: {
			[MODULE_ID]: {
				isConcentration: true,
				spellId: spell.id,
			},
		},
	};

	try {
		const created = await actor.createEmbeddedDocuments("Item", [effectData]);
		if (created.length > 0) {
			const effectId = created[0].id;
			// Update the focus entry with the effect ID
			const updatedFocus = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
			const entryIndex = updatedFocus.findIndex(f => f.spellId === spell.id);
			if (entryIndex >= 0) {
				updatedFocus[entryIndex].concentrationEffectId = effectId;
				await actor.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, updatedFocus);
			}
		}
	}
	catch(err) {
		console.error("shadowdark-extras | Failed to create concentration effect:", err);
	}

	// Notify user
	ui.notifications.info(game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.started", { spellName: spell.name }));

	// Refresh the actor sheet if open
	actor.sheet?.render(false);
}

// Storage key for duration spell data in actor flags

export async function startFocusSpellIfNeeded(casterActorId, spellId, spellName,
	perTurnConfig = null) {
	const caster = game.actors.get(casterActorId);
	if (!caster) {
		console.warn(`shadowdark-extras | Cannot start focus tracking: caster ${casterActorId} not found`);
		return false;
	}

	// Check if already tracking this spell
	const activeFocus = caster.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
	if (activeFocus.some(f => f.spellId === spellId)) {
		console.log(`shadowdark-extras | Focus already being tracked for ${spellName}`);
		return true;
	}

	// Get the spell item
	const spell = caster.items.get(spellId);
	if (!spell) {
		console.warn(`shadowdark-extras | Cannot start focus tracking: spell ${spellId} not found on actor`);
		return false;
	}

	// Check if this is a focus-type spell
	const isFocusSpell = spell.system?.duration?.type === "focus";
	if (!isFocusSpell) {
		console.log(`shadowdark-extras | Spell ${spellName} is not a focus spell, skipping focus tracking`);
		return false;
	}

	// Start tracking with per-turn config
	console.log(`shadowdark-extras | Starting focus tracking for ${spellName} (triggered by effect application)`);
	await startFocusSpell(caster, spell, perTurnConfig);
	return true;
}

/**
 * Handle effect item creation - link to active focus spell if applicable
 */
export async function handleEffectCreated(item, options, userId) {
	if (item.type !== "Effect") return;
	if (!item.actor) return;

	// Skip concentration effects - these are on the caster, not targets
	// Without this check, the caster would be added to targetEffects and receive per-turn damage
	const isConcentration = item.getFlag("shadowdark-extras", "isConcentration");
	if (isConcentration) return;

	// Check if this effect was created via the damage card's "Apply Condition" button
	// We need to link it to the caster's active focus spell

	// Get the origin information from the effect if available
	const origin = item.effects?.contents?.[0]?.origin;
	if (!origin) return;

	// Try to find the source actor and spell
	const originDoc = await fromUuid(origin);
	if (!originDoc) return;

	let sourceActor; let sourceSpell;

	if (originDoc instanceof Item) {
		sourceSpell = originDoc;
		sourceActor = originDoc.actor;
	}
	else if (originDoc instanceof Actor) {
		sourceActor = originDoc;
	}

	if (!sourceActor || !sourceSpell) return;

	// Check if the source spell is a focus spell being tracked
	const activeFocus = sourceActor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
	const focusEntry = activeFocus.find(f => f.spellId === sourceSpell.id);

	const targetToken = item.actor.getActiveTokens()?.[0];

	if (focusEntry) {
		await linkEffectToFocusSpell(
			sourceActor, sourceSpell.id, item.actor, targetToken?.id, item.id
		);
		return;
	}

	// Check if it's a duration spell being tracked
	await linkEffectToDurationSpell(
		sourceActor, sourceSpell.id, item.actor, targetToken?.id, item.id
	);
}

/**
 * Handle effect deletion - clean up tracking if needed
 */
export async function handleEffectDeleted(item, options, userId) {
	if (item.type !== "Effect") return;

	// Find and clean up any focus/duration spell tracking that referenced this effect
	for (const actor of game.actors) {
		const activeFocus = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG);
		if (activeFocus && activeFocus.length > 0) {
			let updated = false;
			for (const focusEntry of activeFocus) {
				const effectIndex = focusEntry.targetEffects.findIndex(
					te => te.effectItemId === item.id && te.targetActorId === item.actor?.id
				);

				if (effectIndex >= 0) {
					focusEntry.targetEffects.splice(effectIndex, 1);
					updated = true;
				}
			}

			if (updated) {
				await actor.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, activeFocus);
			}
		}

		// Check Duration Spells
		const activeDuration = actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG);
		if (activeDuration && activeDuration.length > 0) {
			let updated = false;
			for (const durationEntry of activeDuration) {
				if (!durationEntry.targetEffects) continue;

				const effectIndex = durationEntry.targetEffects.findIndex(
					te => te.effectItemId === item.id && te.targetActorId === item.actor?.id
				);

				if (effectIndex >= 0) {
					durationEntry.targetEffects.splice(effectIndex, 1);
					updated = true;
				}
			}

			if (updated) {
				await actor.setFlag(MODULE_ID, DURATION_SPELL_FLAG, activeDuration);
			}
		}
	}
}

/**
 * Handle token deletion - clean up any focus/duration tracking that targeted this token
 */
export async function handleTokenDeleted(tokenDoc, options, userId) {
	const deletedTokenId = tokenDoc.id;

	// Search all actors for focus/duration spells targeting this token
	for (const actor of game.actors) {
		const activeFocus = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG);
		if (activeFocus && activeFocus.length > 0) {
			let updated = false;
			for (const focusEntry of activeFocus) {
				// Remove any target effects that reference the deleted token
				const originalLength = focusEntry.targetEffects.length;
				focusEntry.targetEffects = focusEntry.targetEffects.filter(
					te => te.targetTokenId !== deletedTokenId
				);

				if (focusEntry.targetEffects.length !== originalLength) {
					updated = true;
					console.log(`shadowdark-extras | Removed target effects for deleted token ${deletedTokenId} from focus spell ${focusEntry.spellName}`);
				}
			}

			if (updated) {
				await actor.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, activeFocus);
			}
		}

		// Check Duration Spells
		const activeDuration = actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG);
		if (activeDuration && activeDuration.length > 0) {
			let updated = false;
			for (const durationEntry of activeDuration) {
				// Clean up targetEffects
				if (durationEntry.targetEffects) {
					const originalLength = durationEntry.targetEffects.length;
					durationEntry.targetEffects = durationEntry.targetEffects.filter(
						te => te.targetTokenId !== deletedTokenId
					);
					if (durationEntry.targetEffects.length !== originalLength) updated = true;
				}

				// Clean up targets
				if (durationEntry.targets) {
					const originalLength = durationEntry.targets.length;
					durationEntry.targets = durationEntry.targets.filter(
						t => t.tokenId !== deletedTokenId
					);
					if (durationEntry.targets.length !== originalLength) updated = true;
				}
			}

			if (updated) {
				await actor.setFlag(MODULE_ID, DURATION_SPELL_FLAG, activeDuration);
				console.log(`shadowdark-extras | Removed targets for deleted token ${deletedTokenId} from duration spells`);
			}
		}
	}
}

// Track which combat turn we've already sent a reminder for
let _lastFocusReminderKey = null;

/**
 * Handle combat update - remind player about active focus spells at turn start
 */
export async function handleCombatUpdate(combat, changed, options, userId) {
	// Only trigger on turn or round changes
	if (!("turn" in changed) && !("round" in changed)) return;

	// Create a unique key for this combat turn
	const reminderKey = `${combat.id}-${combat.round}-${combat.turn}`;

	// Skip if we've already sent a reminder for this exact turn
	if (_lastFocusReminderKey === reminderKey) return;
	_lastFocusReminderKey = reminderKey;

	// Get the current combatant (whose turn is now starting)
	const combatant = combat.combatant;
	if (!combatant?.actor) return;

	const actor = combatant.actor;
	const activeFocus = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];

	if (activeFocus.length === 0) return;

	// Auto-Roll Focus on Turn: if enabled, roll each active focus check
	// automatically instead of posting a manual reminder. The roll flows through
	// handleChatMessageRender exactly as a manual click would — success applies
	// the per-turn effect, failure ends the spell. Fire from ONE client (the
	// caster's active owner, else the active GM) so each check rolls once.
	let autoRollFocus = false;
	try {
		autoRollFocus = game.settings.get(MODULE_ID, "autoRollFocusOnTurn");
	}
	catch{
		autoRollFocus = false;
	}
	if (autoRollFocus) {
		const activeOwner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
		const shouldRoll = activeOwner
			? game.user.id === activeOwner.id
			: (game.user.isGM && game.users.activeGM?.id === game.user.id);
		if (shouldRoll) {
			// skipPrompt fast-forwards the roll dialog so the check is fully automatic.
			for (const f of activeFocus) await rollFocusSpellWithTargets(actor, f.spellId,
				{ skipPrompt: true });
		}
		return; // auto-roll replaces the manual reminder card
	}

	// Only ONE client should create the message to avoid duplicates
	// Prefer the player owner, fallback to the active GM
	const playerOwner = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
	const shouldCreate = playerOwner
		? game.user.id === playerOwner.id
		: (game.user.isGM && game.users.activeGM?.id === game.user.id);
	if (!shouldCreate) return;

	// Build a minimal reminder message with clickable focus roll buttons
	const spellList = activeFocus.map(f => {
		const targets = f.targetEffects.map(te => te.targetName).join(", ")
			|| game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.no_targets");
		return `<div class="sdx-focus-reminder-spell">
			<a class="sdx-focus-roll-btn" data-actor-id="${actor.id}" data-spell-id="${f.spellId}" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.roll_focus")}">
				<i class="fa-solid fa-brain"></i>
			</a>
			<strong>${f.spellName}</strong> → ${targets}
		</div>`;
	}).join("");

	const content = `
		<div class="sdx-focus-reminder" data-actor-id="${actor.id}">
			<div class="sdx-focus-reminder-header">
				<i class="fa-solid fa-brain"></i> ${game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.focus_reminder")}
			</div>
			<div class="sdx-focus-reminder-list">${spellList}</div>
		</div>
	`;

	await ChatMessage.create({
		content: content,
		speaker: ChatMessage.getSpeaker({ actor }),
		whisper: game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id),
	});

	// NOTE: Per-turn damage is intentionally NOT applied here. A focus spell deals
	// its recurring damage only AFTER the caster succeeds on that turn's focus
	// check — see the focus-success branch in handleChatMessageRender, which calls
	// applyFocusSpellPerTurnToTargets(). Applying at turn start would deal damage
	// even when the focus check is failed or never rolled.
}

/**
 * Roll and apply a focus spell's per-turn damage/healing to every target it is
 * tracking. Callers must gate this to a single applier (the active GM) so that
 * multiplayer clients don't double-apply. No-op when the spell has no per-turn
 * formula configured.
 */
export async function applyFocusSpellPerTurnToTargets(focusSpell) {
	if (!focusSpell?.perTurnDamage) return;

	for (const targetEffect of focusSpell.targetEffects) {
		// Resolve the target actor from its token (preferred) or actor id.
		let targetActor = null;
		if (targetEffect.targetTokenId) {
			const token = canvas.tokens?.get(targetEffect.targetTokenId);
			targetActor = token?.actor;
		}
		if (!targetActor) {
			targetActor = game.actors.get(targetEffect.targetActorId);
		}

		if (!targetActor) continue;

		await applyFocusSpellPerTurnDamage(focusSpell, targetActor, targetEffect.targetTokenId);
	}
}

/**
 * Apply per-turn damage/healing from a focus spell to a target
 */
async function applyFocusSpellPerTurnDamage(focusSpell, targetActor, targetTokenId) {
	const MODULE_ID = "shadowdark-extras";
	const formula = focusSpell.perTurnDamage;
	if (!formula) return;

	try {
		// Roll the damage/healing
		const roll = new Roll(formula);
		await roll.evaluate();

		// Show 3D dice animation if Dice So Nice is available
		if (game.dice3d) {
			await game.dice3d.showForRoll(roll, game.user, true);
		}


		const damage = roll.total;
		const damageType = focusSpell.damageType || "damage";
		const isHealing = damageType.toLowerCase() === "healing";

		// Get the token
		const token = canvas.tokens?.get(targetTokenId);
		if (!token?.actor) {
			console.warn(`shadowdark-extras | Could not find token ${targetTokenId} for per-turn ${isHealing ? "healing" : "damage"}`);
			return;
		}

		// Check if auto-apply is enabled
		const settings = game.settings.get(MODULE_ID, "combatSettings") || {};
		const autoApplyDamage = settings.damageCard?.autoApplyDamage ?? true;

		// Auto-apply if enabled
		if (autoApplyDamage && game.user.isGM) {
			const currentHP = token.actor.system.attributes.hp.value;
			const maxHP = token.actor.system.attributes.hp.max;
			const newHP = isHealing
				? Math.min(maxHP, currentHP + damage)
				: Math.max(0, currentHP - damage);

			await token.actor.update({ "system.attributes.hp.value": newHP });
		}

		// Create chat message
		const content = `
			<div class="sdx-focus-damage-card">
				<div class="sdx-duration-damage-header">
					<i class="fa-solid fa-brain"></i>
					<span class="sdx-duration-damage-title">${focusSpell.spellName}</span>
				</div>
				<div class="sdx-duration-damage-content">
					<span class="sdx-duration-damage-target">
						<strong>${token.name}</strong> ${isHealing ? "regains" : "takes"} <strong class="sdx-damage-value">${damage}</strong> ${damageType}${isHealing ? "" : " damage"}!
					</span>
					<span class="sdx-duration-damage-roll">${formula} = ${roll.result}</span>
				</div>
			</div>
		`;

		await ChatMessage.create({
			content: content,
			speaker: ChatMessage.getSpeaker({ actor: targetActor }),
		});
	}
	catch(err) {
		console.error("shadowdark-extras | Error applying per-turn damage for focus spell: ", err);
	}
}

/**
 * Handle clicks on focus roll ("Roll to maintain focus") buttons in chat messages.
 *
 * Registered once as a delegated listener on `document` (see initFocusSpellTracker).
 * We intentionally do NOT bind per-message in renderChatMessageHTML: those bindings fail
 * to attach for messages already present at the initial chat-log render (e.g. after a page
 * reload, or when a reminder scrolls in from history), which left the button doing nothing.
 * Delegation is immune to render/replace timing.
 */
export async function onFocusReminderClick(event) {
	const btn = event.target.closest(".sdx-focus-roll-btn");
	if (!btn) return;

	event.preventDefault();
	event.stopPropagation();

	const actorId = btn.dataset.actorId;
	const spellId = btn.dataset.spellId;

	if (!actorId || !spellId) {
		console.warn("shadowdark-extras | Focus roll button missing actorId or spellId");
		return;
	}

	const actor = game.actors.get(actorId);
	if (!actor) {
		ui.notifications.error("Could not find the actor for this focus spell.");
		return;
	}

	// Check if the current user owns this actor
	if (!actor.isOwner) {
		ui.notifications.warn("You do not own this actor.");
		return;
	}

	// Roll the focus check with auto-targeting
	await rollFocusSpellWithTargets(actor, spellId);
}

/**
 * Roll a focus spell check, automatically targeting the tokens affected by the spell.
 * This ensures the damage card system can find the targets even if the player
 * doesn't have them manually targeted.
 *
 * @param {Actor} actor - The actor rolling the focus check
 * @param {string} spellId - The spell ID to roll focus for
 */
export async function rollFocusSpellWithTargets(actor, spellId, opts = {}) {
	// When invoked by the auto-roll path, skipPrompt fast-forwards Shadowdark's
	// roll dialog so the focus check rolls with no manual interaction.
	const skipPrompt = opts.skipPrompt === true;
	// Get the active focus spell data
	const activeFocus = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
	const focusEntry = activeFocus.find(f => f.spellId === spellId);

	if (focusEntry && focusEntry.targetEffects && focusEntry.targetEffects.length > 0) {
		// Collect all target token IDs from the focus spell tracking
		const targetTokenIds = focusEntry.targetEffects
			.map(te => te.targetTokenId)
			.filter(id => id); // Filter out null/undefined

		if (targetTokenIds.length > 0) {
			// Get the token documents and programmatically target them
			const tokensToTarget = [];
			for (const tokenId of targetTokenIds) {
				const token = canvas.tokens?.get(tokenId);
				if (token) {
					tokensToTarget.push(token);
				}
			}

			if (tokensToTarget.length > 0) {
				console.log(`shadowdark-extras | Auto-targeting ${tokensToTarget.length} token(s) for focus spell: ${focusEntry.spellName}`);

				// Clear existing targets first, then set new ones
				game.user.targets.forEach(t => t.setTarget(
					false, { user: game.user, releaseOthers: false, groupSelection: false }
				));

				// Set targets programmatically using the Token.setTarget method
				for (const token of tokensToTarget) {
					token.setTarget(
						true, { user: game.user, releaseOthers: false, groupSelection: true }
					);
				}
			}
		}
	}

	// Roll the focus check
	const spell = actor.items.get(spellId);

	if (spell) {
		// Shadowdark v4 expects the full item UUID, not just the local item id.
		const spellUuid = spell.uuid;
		console.log(`shadowdark-extras | Rolling focus check for spell ${spell.name} (${spellUuid}) on actor ${actor.name}`);
		if (actor.system.castSpell) {
			actor.system.castSpell(spellUuid, { cast: { focus: true }, skipPrompt });
		}
		else {
			actor.castSpell(spellUuid, { cast: { focus: true }, skipPrompt });
		}
	}
	else if (focusEntry?.spellData) {
		// Spell item no longer exists (e.g., scroll was consumed) - use cached data
		console.log(`shadowdark-extras | Spell item ${spellId} no longer exists, using cached data for focus roll`);
		await rollFocusCheckFromCachedData(actor, focusEntry, { skipPrompt });
	}
	else {
		ui.notifications.error(game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.item_no_longer_exists"));
	}
}

/**
 * Roll a focus check using cached spell data when the original item no longer exists
 * (e.g., when the spell was cast from a scroll that was consumed)
 *
 * @param {Actor} actor - The actor rolling the focus check
 * @param {Object} focusEntry - The focus spell tracking entry with cached spellData
 */
async function rollFocusCheckFromCachedData(actor, focusEntry, opts = {}) {
	const skipPrompt = opts.skipPrompt === true;
	const spellData = focusEntry.spellData || {};
	const spellName = focusEntry.spellName;
	const spellImg = focusEntry.spellImg;
	const tier = spellData.tier ?? 1;

	// Create a temporary spell item with the cached data
	// This allows us to use the native Shadowdark roll dialog
	// We need to get the actor's class UUIDs for the spell to be castable
	let classUuids = spellData.class || [];

	// If no class UUIDs cached, try to get from actor's current class
	if (!classUuids.length || classUuids.length === 0) {
		try {
			const actorClass = await actor.getClass();
			if (actorClass) {
				classUuids = [actorClass.uuid];
			}
		}
		catch(e) {
			console.warn("shadowdark-extras | Could not get actor class for temp spell", e);
		}
	}

	const tempSpellData = {
		name: spellName,
		type: "Spell",
		img: spellImg,
		system: {
			tier: tier,
			description: spellData.description || "",
			duration: {
				type: "focus",
				value: 1,
			},
			lost: false,
			// Use the class UUIDs so Shadowdark can determine casting ability
			class: classUuids,
		},
	};

	try {
		// Create a temporary embedded spell item on the actor
		const [tempSpell] = await actor.createEmbeddedDocuments("Item", [tempSpellData], { temporary: false });

		if (!tempSpell) {
			throw new Error("Failed to create temporary spell item");
		}

		console.log(`shadowdark-extras | Created temporary spell: ${tempSpell.name} (${tempSpell.id}) for focus roll`);

		// Shadowdark v4 expects the full item UUID, not just the local item id.
		const tempSpellUuid = tempSpell.uuid;
		if (actor.system.castSpell) {
			await actor.system.castSpell(tempSpellUuid, { cast: { focus: true }, skipPrompt });
		}
		else {
			await actor.castSpell(tempSpellUuid, { cast: { focus: true }, skipPrompt });
		}

		// Delete the temporary spell item after a brief delay to allow the roll to complete
		// We need to wait because castSpell is async but we need the roll to process first
		setTimeout(async () => {
			try {
				const itemStillExists = actor.items.get(tempSpell.id);
				if (itemStillExists) {
					await actor.deleteEmbeddedDocuments("Item", [tempSpell.id]);
					console.log(`shadowdark-extras | Deleted temporary spell: ${spellName}`);
				}
			}
			catch(err) {
				console.warn("shadowdark-extras | Could not delete temporary spell:", err);
			}
		}, 2000);

	}
	catch(err) {
		console.error("shadowdark-extras | Error rolling focus from cached data:", err);
		ui.notifications.error(game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.focus_roll_error") || "Error rolling focus check");
	}
}

/**
 * Delegated click handler for duration damage apply buttons in chat messages.
 * Registered once (in initFocusSpellTracker) on document, so it also fires for
 * messages that were already in the DOM at the initial chat-log render.
 */

export async function endFocusSpell(casterId, spellId, reason = "manual") {
	// Synchronous re-entrancy guard: renderChatMessageHTML can fire more than once
	// for the same focus-roll message (dice animation / flag updates), each re-running
	// the fail branch. Without this, endFocusSpell runs concurrently for the same
	// spell — producing duplicate "Lost focus" notifications and double-deletes of the
	// same items (which surface as core "Item does not exist!" toasts).
	const _endKey = `${casterId}:${spellId}`;
	if (_endingFocusSpells.has(_endKey)) return;
	_endingFocusSpells.add(_endKey);
	try {
		const caster = game.actors.get(casterId);
		if (!caster) {
			console.warn(`shadowdark-extras | Cannot end focus spell: caster ${casterId} not found`);
			return;
		}

		const activeFocus = caster.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
		const focusIndex = activeFocus.findIndex(f => f.spellId === spellId);

		if (focusIndex < 0) {
			console.warn(`shadowdark-extras | Cannot end focus spell: spell ${spellId} not being focused`);
			return;
		}

		const focusEntry = activeFocus[focusIndex];

		// Remove all effects applied to targets
		const removalPromises = focusEntry.targetEffects.map(async targetEffect => {
			try {
			// For unlinked tokens, we need to get the actor from the token, not from game.actors
			// The effect is on the synthetic token actor, not the base actor
				let targetActor = null;

				// Try to get the actor from the token first (for unlinked tokens)
				if (targetEffect.targetTokenId) {
					const token = canvas.tokens?.get(targetEffect.targetTokenId);
					if (token?.actor) {
						targetActor = token.actor;
						console.log(`shadowdark-extras | Found target actor from token: ${targetActor.name}`);
					}
				}

				// Fall back to game.actors (for linked tokens or if token not found)
				if (!targetActor) {
					targetActor = game.actors.get(targetEffect.targetActorId);
				}

				if (!targetActor) {
					console.warn(`shadowdark-extras | Target actor ${targetEffect.targetActorId} not found (token: ${targetEffect.targetTokenId})`);
					return;
				}

				// Check for Item first
				let effectDoc = targetActor.items.get(targetEffect.effectItemId);

				// If not an Item, check for ActiveEffect (e.g. Auras)
				if (!effectDoc) {
					effectDoc = targetActor.effects.get(targetEffect.effectItemId);
				}

				if (!effectDoc) {
					console.warn(`shadowdark-extras | Effect item/document ${targetEffect.effectItemId} not found on ${targetActor.name}`);
					return;
				}

				// Delete the effect - use socket if we don't have permission
				// Dynamic import breaks the domain<->bridge cycle (Phase 5.1 split)
				const { getFocusSpellSocket } = await import("./FocusSpellTrackerSD.mjs");
				const socket = getFocusSpellSocket();
				if (game.user.isGM || targetActor.isOwner) {
					await effectDoc.delete();
					console.log(`shadowdark-extras | Removed effect ${effectDoc.name || targetEffect.effectItemId} from ${targetActor.name}`);
				}
				else if (socket) {
					await socket.executeAsGM("removeTargetEffect", {
						targetActorId: targetEffect.targetActorId,
						targetTokenId: targetEffect.targetTokenId,
						effectItemId: targetEffect.effectItemId,
					});
				}
			}
			catch(err) {
			// "does not exist" just means the effect was already removed elsewhere; benign.
				console.warn(`shadowdark-extras | Effect ${targetEffect.effectItemId} already removed or unavailable:`, err?.message ?? err);
			}
		});

		await Promise.all(removalPromises);

		// Remove the Concentration effect from the caster. Wrapped defensively: the
		// item may already be gone (manually deleted, or a concurrent cleanup won the
		// race), leaving a stale local reference whose delete() rejects. Treat
		// "already gone" as success so ending a focus never throws an uncaught error.
		try {
			let concEffect = focusEntry.concentrationEffectId
				? caster.items.get(focusEntry.concentrationEffectId)
				: null;
			// Fallback: search for any concentration effect linked to this spell.
			if (!concEffect) {
				concEffect = caster.items.find(i =>
					i.type === "Effect"
				&& i.flags?.[MODULE_ID]?.isConcentration
				&& i.flags?.[MODULE_ID]?.spellId === spellId
				);
			}
			if (concEffect) {
				await concEffect.delete();
				console.log(`shadowdark-extras | Removed concentration effect ${concEffect.name} from caster`);
			}
		}
		catch(err) {
			console.warn("shadowdark-extras | Concentration effect already removed or unavailable:", err?.message ?? err);
		}

		// Delete any templates associated with this focus spell
		// Templates store casterActorId and spellId in their templateEffects config
		try {
			const scene = canvas.scene;
			if (scene) {
				const templatesToDelete = getSceneMeasuredTemplates(scene).filter(template => {
					const config = template.flags?.[MODULE_ID]?.templateEffects;
					return config?.casterActorId === casterId && config?.spellId === spellId;
				});

				if (templatesToDelete.length > 0) {
					console.log(`shadowdark-extras | Deleting ${templatesToDelete.length} template(s) associated with focus spell ${focusEntry.spellName}`);

					for (const template of templatesToDelete) {
						try {
							await template.delete();
							console.log(`shadowdark-extras | Deleted template ${template.id}`);
						}
						catch(err) {
							console.warn(`shadowdark-extras | Failed to delete template ${template.id}:`, err);
						}
					}
				}
			}
		}
		catch(err) {
			console.warn("shadowdark-extras | Error cleaning up templates:", err);
		}

		// Remove the focus entry from tracking
		activeFocus.splice(focusIndex, 1);
		await caster.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, activeFocus);

		// Show notification
		const reasonKey = `SHADOWDARK_EXTRAS.focus_tracker.ended_${reason}`;
		const message = game.i18n.format(reasonKey, {
			spellName: focusEntry.spellName,
			targetCount: focusEntry.targetEffects.length,
		});
		ui.notifications.info(message);

		// Post to chat
		const chatContent = await renderFocusEndedChat(focusEntry, reason);
		await ChatMessage.create({
			content: chatContent,
			speaker: ChatMessage.getSpeaker({ actor: caster }),
		});

		// Refresh the actor sheet if open
		caster.sheet?.render(false);
	}
	finally {
		_endingFocusSpells.delete(_endKey);
	}
}

/**
 * Render chat message for when focus ends
 */

/**
 * Inject focus spells UI into the player sheet's spells tab
 */


/**
 * Calculate how long focus has been maintained
 */

/**
 * Get all active focus spells for an actor
 */
export function getActiveFocusSpells(actor) {
	return actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
}

/**
 * Check if an actor is currently focusing on a specific spell
 */
export function isFocusingOnSpell(actor, spellId) {
	const activeFocus = getActiveFocusSpells(actor);
	return activeFocus.some(f => f.spellId === spellId);
}

/**
 * Manually link an effect to an active focus spell
 * Call this when applying effects via the damage card
 *
 * @param {string|Actor} casterActorOrId - The caster actor or their ID
 * @param {string} spellId - The spell item ID
 * @param {string|Actor} targetActorOrId - The target actor or their ID
 * @param {string} targetTokenId - The target token ID (required for unlinked tokens)
 * @param {string} effectItemId - The effect item ID on the target
 */
export async function linkEffectToFocusSpell(casterActorOrId, spellId, targetActorOrId,
	targetTokenId, effectItemId) {
	// Resolve caster actor
	const casterActor = typeof casterActorOrId === "string"
		? game.actors.get(casterActorOrId)
		: casterActorOrId;

	if (!casterActor) {
		console.warn("shadowdark-extras | Cannot link effect: caster actor not found");
		return false;
	}

	// Resolve target actor - for unlinked tokens, we need to get from the token
	let targetActor = null;
	let resolvedTokenId = targetTokenId;

	// Try to get the actor from the token first (for unlinked tokens)
	if (targetTokenId) {
		const token = canvas.tokens?.get(targetTokenId);
		if (token?.actor) {
			targetActor = token.actor;
		}
	}

	// Fall back to game.actors or direct actor reference
	if (!targetActor) {
		targetActor = typeof targetActorOrId === "string"
			? game.actors.get(targetActorOrId)
			: targetActorOrId;
	}

	if (!targetActor) {
		console.warn("shadowdark-extras | Cannot link effect: target actor not found");
		return false;
	}

	// If we didn't have a token ID, try to find one
	if (!resolvedTokenId) {
		resolvedTokenId = targetActor.getActiveTokens()?.[0]?.id || null;
	}

	const activeFocus = casterActor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
	const focusEntry = activeFocus.find(f => f.spellId === spellId);

	if (!focusEntry) {
		console.log(`shadowdark-extras | Cannot link effect: spell ${spellId} is not being focused (this is normal for non-focus spells)`);
		return false;
	}

	// Check if this effect is already linked
	const existing = focusEntry.targetEffects.find(
		te => te.effectItemId === effectItemId && te.targetActorId === targetActor.id
	);

	if (existing) {
		return true; // Already linked
	}

	// Resolve target name (prefer token name)
	let targetName = targetActor.name;
	if (resolvedTokenId) {
		const token = canvas.tokens?.get(resolvedTokenId);
		if (token) targetName = token.name;
	}
	else if (targetActor.token) {
		targetName = targetActor.token.name;
	}

	focusEntry.targetEffects.push({
		targetActorId: targetActor.id,
		targetTokenId: resolvedTokenId,
		effectItemId: effectItemId,
		targetName: targetName,
	});

	await casterActor.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, activeFocus);

	console.log(`shadowdark-extras | Linked effect ${effectItemId} to focus spell ${spellId}`);

	// Refresh the actor sheet if open
	casterActor.sheet?.render(false);

	return true;
}

/**
 * Link a target to an active focus spell without requiring an effect
 * Use this for spells that only deal damage/healing without transferring conditions
 *
 * @param {string|Actor} casterActorOrId - The caster actor or their ID
 * @param {string} spellId - The spell item ID
 * @param {string|Actor} targetActorOrId - The target actor or their ID
 * @param {string} targetTokenId - The target token ID (required for unlinked tokens)
 */
export async function linkTargetToFocusSpell(casterActorOrId, spellId, targetActorOrId,
	targetTokenId) {
	// Resolve caster actor
	const casterActor = typeof casterActorOrId === "string"
		? game.actors.get(casterActorOrId)
		: casterActorOrId;

	if (!casterActor) {
		console.warn("shadowdark-extras | Cannot link target: caster actor not found");
		return false;
	}

	// Resolve target actor
	let targetActor = null;
	let resolvedTokenId = targetTokenId;

	if (targetTokenId) {
		const token = canvas.tokens?.get(targetTokenId);
		if (token?.actor) {
			targetActor = token.actor;
			resolvedTokenId = targetTokenId;
		}
	}

	if (!targetActor) {
		targetActor = typeof targetActorOrId === "string"
			? game.actors.get(targetActorOrId)
			: targetActorOrId;
	}

	if (!targetActor) {
		console.warn("shadowdark-extras | Cannot link target: target actor not found");
		return false;
	}

	// Find the focus spell entry
	const activeFocus = casterActor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
	const focusEntry = activeFocus.find(f => f.spellId === spellId);

	if (!focusEntry) {
		console.warn(`shadowdark-extras | Cannot link target: focus spell ${spellId} not found in tracking`);
		return false;
	}

	// Check if this target is already linked (by actor/token)
	const existing = focusEntry.targetEffects.find(
		te => (te.targetTokenId && te.targetTokenId === resolvedTokenId)
			|| (te.targetActorId === targetActor.id && !te.targetTokenId)
	);

	if (existing) {
		return true; // Already linked
	}

	// Resolve target name (prefer token name)
	let targetName = targetActor.name;
	if (resolvedTokenId) {
		const token = canvas.tokens?.get(resolvedTokenId);
		if (token) targetName = token.name;
	}
	else if (targetActor.token) {
		targetName = targetActor.token.name;
	}

	// Add target without an effect ID
	focusEntry.targetEffects.push({
		targetActorId: targetActor.id,
		targetTokenId: resolvedTokenId,
		effectItemId: null, // No effect, just tracking the target
		targetName: targetName,
	});

	await casterActor.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, activeFocus);

	console.log(`shadowdark-extras | Linked target ${targetName} to focus spell ${spellId} (no effect)`);

	// Refresh the actor sheet if open
	casterActor.sheet?.render(false);

	return true;
}
/**
 * Unlink an effect from a focus spell's tracking
 * Called when an effect is removed/replaced before a new one is applied
 *
 * @param {string} casterActorId - The caster actor ID
 * @param {string} spellId - The spell item ID
 * @param {string} effectItemId - The effect item ID to unlink
 */
export async function unlinkEffectFromFocusSpell(casterActorId, spellId, effectItemId) {
	const casterActor = game.actors.get(casterActorId);
	if (!casterActor) return false;

	const activeFocus = casterActor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
	const focusEntry = activeFocus.find(f => f.spellId === spellId);

	if (!focusEntry) return false;

	const effectIndex = focusEntry.targetEffects.findIndex(te => te.effectItemId === effectItemId);
	if (effectIndex < 0) return false;

	// Remove the effect from tracking
	focusEntry.targetEffects.splice(effectIndex, 1);
	await casterActor.setFlag(MODULE_ID, FOCUS_SPELL_FLAG, activeFocus);

	console.log(`shadowdark-extras | Unlinked effect ${effectItemId} from focus spell ${spellId}`);
	return true;
}

/**
 * Handle wand uses tracking - decrement uses when a wand is cast
 * This runs on chat message render to detect wand casts
 */

// Public surface preserved (Phase 5.3 lane-C split re-exports).
export { buildFocusSpellsHtml };
