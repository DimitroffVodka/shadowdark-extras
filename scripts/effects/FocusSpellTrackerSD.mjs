/**
 * Focus Spell Tracker for Shadowdark Extras
 *
 * This module tracks active focus spells and the effects they have applied to targets.
 * When a focus spell fails or is intentionally dropped, all associated effects are removed.
 *
 * Features:
 * - Tracks which spells are currently being focused on by each actor
 * - Links effects applied to targets back to the source spell and caster
 * - Shows active focus spells on the player sheet's spells tab
 * - Automatically removes effects when focus is lost (failed roll or manual end)
 * - Provides UI to manually end focus on a spell
 */

import { getSocket } from "../combat/CombatSettingsSD.mjs";
import { resolveCardContext } from "../shared/sd4Compat.mjs";
import { MODULE_ID, FOCUS_SPELL_FLAG, DURATION_SPELL_FLAG, _processedFocusRollMessages } from "./focus-constants.mjs";
import {
	startDurationSpell,
	getActiveDurationSpells,
	registerSpellModification,
	endDurationSpell,
	handleDurationSpellCombatUpdate,
	linkEffectToDurationSpell,
	addTargetToDurationSpell,
	removeTargetFromDurationSpell,
	buildDurationSpellsHtml,
	onDurationDamageApplyClick,
} from "./duration-spell.mjs";
import {
	handleEffectCreated,
	handleEffectDeleted,
	handleTokenDeleted,
	handleCombatUpdate,
	endFocusSpell,
	startFocusSpell,
	startFocusSpellIfNeeded,
	rollFocusSpellWithTargets,
	applyFocusSpellPerTurnToTargets,
	buildFocusSpellsHtml,
	onFocusReminderClick,
	getActiveFocusSpells,
	isFocusingOnSpell,
	linkEffectToFocusSpell,
	linkTargetToFocusSpell,
	unlinkEffectFromFocusSpell,
} from "./focus-spell.mjs";


/**
 * Data structure for an active focus spell:
 * {
 *   spellId: string,           // The ID of the spell item on the caster
 *   spellName: string,         // Display name of the spell
 *   spellImg: string,          // Image of the spell
 *   casterId: string,          // Actor ID of the caster
 *   casterName: string,        // Display name of the caster
 *   startTime: number,         // World time when focus started
 *   startRound: number|null,   // Combat round when focus started (if in combat)
 *   spellData: {  // Cached spell data for rolls (in case item is deleted, e.g. scrolls)
 *     tier: number,            // Spell tier
 *     ability: string,         // Spellcasting ability (e.g. 'INT', 'WIS', 'CHA')
 *     dc: number,              // Spell DC
 *     type: string             // Original item type ('Spell', 'Scroll', etc.)
 *   },
 *   targetEffects: [{          // Array of effects applied to targets
 *     targetActorId: string,   // Actor ID of the target
 *     targetTokenId: string,   // Token ID of the target (may vary by scene)
 *     effectItemId: string,    // Effect Item ID on the target actor
 *     targetName: string       // Display name of the target
 *   }]
 * }
 */

/**
 * Initialize the Focus Spell Tracker
 */
export function initFocusSpellTracker() {
	console.log("shadowdark-extras | Initializing Focus Spell Tracker");

	// Hook into chat message rendering to track focus spells
	// (We use renderChatMessageHTML because we need to parse the HTML for actor/item IDs)
	Hooks.on("renderChatMessageHTML", handleChatMessageRender);

	// Hook into effect creation to link effects to focus spells
	Hooks.on("createItem", handleEffectCreated);

	// Hook into effect deletion to clean up tracking
	Hooks.on("deleteItem", handleEffectDeleted);

	// Hook into token deletion to clean up focus tracking
	Hooks.on("deleteToken", handleTokenDeleted);

	// Hook into actor sheet rendering to add focus spell display
	Hooks.on("renderPlayerSheetSD", injectFocusSpellsUI);

	// Disable right-click context menu on spell items (runs separately from focus UI)
	Hooks.on("renderPlayerSheetSD", disableSpellContextMenu);

	// Hook into combat updates to remind about focus spells at turn start
	Hooks.on("updateCombat", handleCombatUpdate);

	// Hook into combat updates to process duration spells (per-turn damage, expiry)
	Hooks.on("updateCombat", handleDurationSpellCombatUpdate);

	// Delegated click handler for focus roll ("Roll to maintain focus") buttons in chat.
	// Delegation (vs. binding per-message inside renderChatMessageHTML) is required: a
	// per-message addEventListener binding does NOT attach for messages already present at
	// the initial chat-log render (page reload, or a reminder scrolled in from history),
	// leaving those buttons dead. A single document-level listener is immune to that timing.
	document.addEventListener("click", onFocusReminderClick);

	// Register a single delegated click handler for duration damage apply buttons.
	// Per-message addEventListener bindings (via the render hook) do NOT attach for
	// chat messages already present at the initial chat-log render (e.g. after a page
	// reload or when a message scrolls in from history), so delegation is required.
	document.addEventListener("click", onDurationDamageApplyClick);

	// Hook into chat message rendering to track wand uses
	Hooks.on("renderChatMessageHTML", handleWandUsesTracking);

	// Hook into player sheet rendering to display wand uses next to wand names
	Hooks.on("renderPlayerSheetSD", injectWandUsesDisplay);

	console.log("shadowdark-extras | Focus Spell Tracker initialized (using shared socket)");
}

/**
 * Helper function to get the shared socket from CombatSettingsSD
 * @returns {object|null} The socketlib socket instance
 */
export function getFocusSpellSocket() {
	return getSocket();
}

/**
 * Handle chat message rendering to detect spell casts
 * Extracts actor/item IDs from the chat card HTML data attributes
 */
async function handleChatMessageRender(message, html, context) {
	// Only process if current user is the author to avoid duplicate processing
	if (message.author?.id !== game.user.id) return;

	// Check if this is a Shadowdark roll message (uses rollConfig in v4)
	const sdFlags = message.flags?.shadowdark;
	const rollConfig = sdFlags?.rollConfig;
	if (!rollConfig) return;

	const cardCtx = resolveCardContext(message, html);
	const actorId = cardCtx?.actorId;
	const itemUuid = cardCtx?.itemUuid || cardCtx?.itemId;

	if (!actorId) return;

	const actor = game.actors.get(actorId);
	let item = itemUuid
		? (itemUuid.includes(".") ? await fromUuid(itemUuid) : actor?.items.get(itemUuid))
		: null;

	// Compendium/item-card UUIDs can resolve to a source item instead of the
	// actor-owned copy. Store the local item id so later actor.items lookups work.
	if (item && actor && !actor.items.has(item.id)) {
		const localCopy = actor.items.find(i => i.name === item.name && i.type === item.type);
		if (localCopy) {
			console.log(`shadowdark-extras | Resolved ${item.id} to actor-local spell ${localCopy.id} (${localCopy.name})`);
			item = localCopy;
		}
	}

	if (!actor || !item) return;

	// Check if this is a spell type
	if (!["Spell", "Scroll", "Wand", "NPC Spell"].includes(item.type)) return;

	// Check if this is a focus-type spell
	const isFocusSpell = item.system?.duration?.type === "focus";
	if (!isFocusSpell) return;

	const spellId = item.id;
	const casterId = actor.id;

	// Get success/critical from the actual roll instances in v4
	const mainRoll = message.rolls.find(r => r.options?.type === "main");
	if (!mainRoll) return;

	const success = mainRoll.success === true;
	const critical = mainRoll.criticalSuccess ? "success" : (mainRoll.criticalFailure ? "failure" : null);

	// Check if this is a focus roll (maintenance) or initial cast
	// Focus rolls have "Focus Check" in the flavor
	const focusCheckText = game.i18n.localize("SHADOWDARK.chat.spell_focus_check");
	const activeFocusSpells = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];

	// Find focus entry by ID first, then by name (for temporary spell items from scrolls)
	let focusEntry = activeFocusSpells.find(f => f.spellId === spellId);
	let isAlreadyFocusing = !!focusEntry;

	// If not found by ID, try to find by name (for temp spells created from cached scroll data)
	if (!focusEntry && item.name) {
		focusEntry = activeFocusSpells.find(f => f.spellName === item.name);
		if (focusEntry) {
			isAlreadyFocusing = true;
			console.log(`shadowdark-extras | Found focus entry by name: ${item.name}`);
		}
	}

	// SD 4.0.6 flavors focus maintenance rolls as plain "Casting Spell", so the
	// reliable signal is the system's native focus flag on the roll config (set
	// when casting with { cast: { focus: true } }). Keep the legacy flavor check
	// as a fallback for older system versions.
	const isFocusRoll = rollConfig?.cast?.focus === true
		|| message.flavor?.includes(focusCheckText)
		|| message.flavor?.includes("Focus Check");

	console.log(`shadowdark-extras | Focus spell detected: ${item.name}`, {
		isFocusRoll,
		isAlreadyFocusing,
		success,
		critical,
		spellId,
		casterId,
		flavor: message.flavor,
		focusEntrySpellId: focusEntry?.spellId,
	});

	if (isFocusRoll) {
		// Process each focus-roll message only once. renderChatMessageHTML can fire
		// repeatedly for the same message (dice animation, flag writes); without this
		// the spell would end — or per-turn damage apply — multiple times per roll.
		if (_processedFocusRollMessages.has(message.id)) return;
		_processedFocusRollMessages.add(message.id);
		// This is a focus maintenance roll
		if (!success || critical === "failure") {
			// Focus failed - end the spell and remove effects
			console.log(`shadowdark-extras | Focus failed for ${item.name}, ending focus and removing effects`);

			// Use the focus entry's spellId (which is the original tracked ID, not temp spell ID)
			const trackedSpellId = focusEntry?.spellId || spellId;

			// On critical failure, also mark the spell as lost (like Shadowdark does)
			// Only update if the item is a permanent spell (not a temp spell)
			if (critical === "failure") {
				console.log("shadowdark-extras | Critical failure on focus check - marking spell as lost");
				// Only update the item if it's not a temporary spell
				const permanentItem = actor.items.get(trackedSpellId);
				if (permanentItem) {
					await permanentItem.update({ "system.lost": true });
				}
				await endFocusSpell(casterId, trackedSpellId, "spell_lost");
			}
			else {
				await endFocusSpell(casterId, trackedSpellId, "focus_failed");
			}
		}
		else {
			console.log(`shadowdark-extras | Focus maintained for ${item.name}`);
			// Don't re-apply effects - they're already applied.
			// Focus check succeeded → NOW apply this turn's per-turn damage. Gate to
			// the active GM so damage is applied (and its chat card posted) exactly
			// once across all connected clients rendering this roll.
			const isSoleApplier = game.user.isGM && game.users.activeGM?.id === game.user.id;
			if (isSoleApplier && focusEntry?.perTurnDamage) {
				await applyFocusSpellPerTurnToTargets(focusEntry);
			}
		}
	}
	else if (!isAlreadyFocusing) {
		// This is the initial cast (only start tracking if not already focusing)
		if (success && critical !== "failure") {
			// Spell cast successfully - start tracking focus
			console.log(`shadowdark-extras | Starting focus tracking for ${item.name}`);
			await startFocusSpell(actor, item);
		}
	}
}

/**
 * Inject focus spells UI into the player sheet's spells tab
 */
function injectFocusSpellsUI(sheet, html, data) {
	const actor = sheet.actor;
	if (!actor) return;

	const activeFocus = actor.getFlag(MODULE_ID, FOCUS_SPELL_FLAG) || [];
	const activeDuration = actor.getFlag(MODULE_ID, DURATION_SPELL_FLAG) || [];

	// Find the spells tab
	const spellsTab = html.find(".tab-spells");
	if (spellsTab.length === 0) return;

	// Build and inject duration spells section (if any)
	if (activeDuration.length > 0) {
		const durationHtml = buildDurationSpellsHtml(actor, activeDuration);
		spellsTab.prepend(durationHtml);

		// Attach end duration event listener
		spellsTab.find("[data-action='end-duration']").on("click", async event => {
			event.preventDefault();
			const instanceId = event.currentTarget.dataset.instanceId;
			await endDurationSpell(actor.id, instanceId, "manual");
		});

		// Toggle targets list visibility
		spellsTab.find("[data-action='toggle-duration-targets']").on("click", event => {
			event.preventDefault();
			const instanceId = event.currentTarget.dataset.instanceId;
			const targetsList = spellsTab.find(`.sdx-duration-targets-list[data-instance-id="${instanceId}"]`);
			const icon = $(event.currentTarget).find("i");

			if (targetsList.is(":visible")) {
				targetsList.slideUp(200);
				icon.removeClass("fa-chevron-up").addClass("fa-chevron-down");
			}
			else {
				targetsList.slideDown(200);
				icon.removeClass("fa-chevron-down").addClass("fa-chevron-up");
			}
		});

		// Add target to duration spell
		spellsTab.find("[data-action='add-duration-target']").on("click", async event => {
			event.preventDefault();
			const instanceId = event.currentTarget.dataset.instanceId;

			// Get currently targeted tokens
			const targets = Array.from(game.user.targets || []);
			if (targets.length === 0) {
				ui.notifications.warn("Please target one or more tokens to add to the spell area.");
				return;
			}

			// Find by instanceId first, fallback to spellId
			let durationEntry = activeDuration.find(d => d.instanceId === instanceId);
			if (!durationEntry) {
				durationEntry = activeDuration.find(d => d.spellId === instanceId);
			}
			if (!durationEntry) return;

			// Confirm adding targets
			const targetNames = targets.map(t => t.name).join(", ");
			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: "Add Targets to Spell" },
				content: `<p>Add <strong>${targetNames}</strong> to <strong>${durationEntry.spellName}</strong>?</p>
				          <p>They will receive the spell's effects and start taking per-turn damage.</p>`,
				modal: true,
				yes: { default: true },
			});

			if (confirmed) {
				for (const token of targets) {
					await addTargetToDurationSpell(actor.id, instanceId, token.id);
				}
			}
		});

		// Remove individual target from duration spell
		spellsTab.find("[data-action='remove-duration-target']").on("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const instanceId = event.currentTarget.dataset.instanceId;
			const tokenId = event.currentTarget.dataset.tokenId;

			// Find by instanceId first, fallback to spellId
			let durationEntry = activeDuration.find(d => d.instanceId === instanceId);
			if (!durationEntry) {
				durationEntry = activeDuration.find(d => d.spellId === instanceId);
			}
			const target = durationEntry?.targets?.find(t => t.tokenId === tokenId);

			if (!target) return;

			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: "Remove Target from Spell" },
				content: `<p>Remove <strong>${target.name}</strong> from <strong>${durationEntry.spellName}</strong>?</p>
				          <p>Any effects applied by this spell will be removed from them.</p>`,
				modal: true,
				yes: { default: true },
			});

			if (confirmed) {
				await removeTargetFromDurationSpell(actor.id, instanceId, tokenId);
			}
		});

		// Pan to target token (click handler)
		spellsTab.find(".sdx-duration-target").each((i, targetEl) => {
			const $target = $(targetEl);
			const tokenId = $target.data("token-id");

			// Inject pan button if it doesn't exist
			if (tokenId && !$target.find(".sdx-pan-to-target").length) {
				const $nameSpan = $target.find(".sdx-target-name");
				const $panButton = $(`
					<a class="sdx-pan-to-target" data-token-id="${tokenId}"
					   data-tooltip="Pan camera to this token"
					   style="margin: 0 4px; cursor: pointer;">
						<i class="fas fa-location-crosshairs" style="color: #3498db;"></i>
					</a>
				`);
				$panButton.insertAfter($nameSpan);
			}
		});

		// Click handler for pan button
		spellsTab.find(".sdx-pan-to-target").on("click", event => {
			event.preventDefault();
			event.stopPropagation();
			const tokenId = event.currentTarget.dataset.tokenId;
			const token = canvas.tokens?.get(tokenId);

			if (token) {
				canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
			}
			else {
				ui.notifications.warn("Token not found on this scene.");
			}
		});

		// Hover handler for visual highlighting
		spellsTab.find(".sdx-duration-target").on("mouseenter", event => {
			const $target = $(event.currentTarget);
			const tokenId = $target.data("token-id");
			const token = canvas.tokens?.get(tokenId);

			if (token) {
				// Create a visual ping effect
				canvas.ping(token.center, {
					style: CONFIG.Canvas.pings.types.PULSE,
					color: "#3498db",
					duration: 1500,
				});
			}
		});
	}

	// Build and inject focus spells section (if any)
	if (activeFocus.length > 0) {
		const focusHtml = buildFocusSpellsHtml(actor, activeFocus);
		spellsTab.prepend(focusHtml);

		// Attach event listeners
		spellsTab.find("[data-action='end-focus']").on("click", async event => {
			event.preventDefault();
			const spellId = event.currentTarget.dataset.spellId;

			const focusEntry = activeFocus.find(f => f.spellId === spellId);
			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.focus_tracker.end_focus_title") },
				content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.focus_tracker.end_focus_confirm", {
					spellName: focusEntry?.spellName ?? "Unknown",
					targetCount: focusEntry?.targetEffects?.length ?? 0,
				})}</p>`,
				modal: true,
			});

			if (confirmed) {
				await endFocusSpell(actor.id, spellId, "manual");
			}
		});

		// Focus roll button
		spellsTab.find("[data-action='focus-roll']").on("click", async event => {
			event.preventDefault();
			const spellId = event.currentTarget.dataset.spellId;
			await rollFocusSpellWithTargets(actor, spellId);
		});

		// Disable brain icons for currently focused spells
		const focusedSpellIds = activeFocus.map(f => f.spellId);
		for (const spellId of focusedSpellIds) {
			const spellItem = spellsTab.find(`li.item[data-item-id="${spellId}"]`);
			if (spellItem.length) {
				const focusAction = spellItem.find("[data-action='focus-spell']");
				if (focusAction.length) {
					focusAction.addClass("sdx-disabled");
					focusAction.prop("disabled", true);
					focusAction.off("click").on("click", e => e.preventDefault());
				}
			}
		}
	}
}

/**
 * Build HTML for the active duration spells section
 */
function disableSpellContextMenu(sheet, html, data) {
	const spellsTab = html.find(".tab-spells");
	if (spellsTab.length === 0) return;

	// Disable Foundry's context menu by overriding the context menu entries for spell items
	spellsTab.find("li.item").each((i, el) => {
		$(el).on("contextmenu", e => {
			e.preventDefault();
			e.stopImmediatePropagation();
			return false;
		});
	});
}

/**
 * Build HTML for the active focus spells section
 */
async function handleWandUsesTracking(message, html, data) {
	// Only process if current user is the author to avoid duplicate processing
	if (message.author?.id !== game.user.id) return;

	// Check if wand uses tracking is enabled
	try {
		if (!game.settings.get(MODULE_ID, "enableWandUses")) return;
	}
	catch{
		return;
	}

	// Check if this is a Shadowdark roll message
	const sdFlags = message.flags?.shadowdark;
	if (!sdFlags?.isRoll) return;

	const cardCtx = resolveCardContext(message, html);
	if (!cardCtx?.actorId || !cardCtx?.itemId) return;

	const actor = game.actors.get(cardCtx.actorId);
	const item = actor?.items.get(cardCtx.itemId);

	if (!actor || !item) return;

	// Only process Wand items
	if (item.type !== "Wand") return;

	// Check if this wand has uses tracking enabled
	const wandUsesFlags = item.flags?.[MODULE_ID]?.wandUses;
	if (!wandUsesFlags?.enabled) return;

	const currentUses = wandUsesFlags.current ?? 0;

	// Check if this is a focus check (not initial cast) - don't consume uses for focus checks
	const focusCheckText = game.i18n.localize("SHADOWDARK.chat.spell_focus_check");
	const isFocusCheck = message.flavor?.includes(focusCheckText) || message.flavor?.includes("Focus Check");
	if (isFocusCheck) {
		console.log(`shadowdark-extras | Wand focus check detected, not consuming uses for ${item.name}`);
		return;
	}

	// Decrement uses (on any cast, success or failure)
	if (currentUses > 0) {
		const newUses = currentUses - 1;
		await item.update({
			[`flags.${MODULE_ID}.wandUses.current`]: newUses,
		});

		console.log(`shadowdark-extras | Wand ${item.name} uses: ${currentUses} -> ${newUses}`);

		// Notify if wand is depleted
		if (newUses === 0) {
			ui.notifications.warn(game.i18n.format("SHADOWDARK_EXTRAS.wand.depleted", { name: item.name }));
		}
	}
}

/**
 * Inject wand uses display into player sheet spell list
 * Shows current/max uses next to wand names in the "SPELLS FROM ITEMS" section
 */
function injectWandUsesDisplay(app, html, data) {
	// Check if wand uses tracking is enabled
	try {
		if (!game.settings.get(MODULE_ID, "enableWandUses")) return;
	}
	catch{
		return;
	}

	const actor = app.actor;
	if (!actor) return;

	// Handle v13 native HTML elements
	const $html = html instanceof HTMLElement ? $(html) : html;

	// Find all item entries in the spell tab (wands are in SD-list with li.item elements)
	const $spellTab = $html.find('.tab-spells, section[data-tab="tab-spells"]');
	if (!$spellTab.length) return;

	// Find wand items - they have data-item-id attribute
	$spellTab.find("li.item[data-item-id]").each((i, el) => {
		const $item = $(el);
		const itemId = $item.data("item-id");
		if (!itemId) return;

		const item = actor.items.get(itemId);
		if (!item || item.type !== "Wand") return;

		// Check if uses tracking is enabled for this wand
		const wandUsesFlags = item.flags?.[MODULE_ID]?.wandUses;
		if (!wandUsesFlags?.enabled) return;

		const currentUses = wandUsesFlags.current ?? 0;
		const maxUses = wandUsesFlags.max ?? 0;

		// Find the item name element (it's an anchor with class "item-name")
		const $nameElement = $item.find("a.item-name");
		if (!$nameElement.length) return;

		// Remove any existing uses display
		$nameElement.find(".sdx-wand-uses-display").remove();

		// Create uses display element and append inside the name element
		const usesDisplay = $(`<span class="sdx-wand-uses-display" style="margin-left: 6px; color: rgba(255, 255, 255, 0.9) !important; font-family: 'Montserrat Medium', Montserrat, sans-serif; font-weight: 500;">${currentUses}/${maxUses}</span>`);
		$nameElement.append(usesDisplay);
	});
}

// Full public surface preserved (Phase 5.1 split re-exports).
export {
	startDurationSpell,
	getActiveDurationSpells,
	registerSpellModification,
	endDurationSpell,
	linkEffectToDurationSpell,
	addTargetToDurationSpell,
	removeTargetFromDurationSpell,
};
export {
	startFocusSpellIfNeeded,
	endFocusSpell,
	getActiveFocusSpells,
	isFocusingOnSpell,
	linkEffectToFocusSpell,
	linkTargetToFocusSpell,
	unlinkEffectFromFocusSpell,
};
