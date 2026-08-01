/**
 * Combat Settings for Shadowdark Extras
 * Adds enhanced damage card features similar to midi-qol
 */

import { getWeaponEffectsToApply, calculateWeaponBonusDamage } from "./WeaponBonusConfig.mjs";
import { startDurationSpell, linkEffectToDurationSpell, linkEffectToFocusSpell, linkTargetToFocusSpell, startFocusSpellIfNeeded } from "../effects/FocusSpellTrackerSD.mjs";
import { buildTemplateEffectsFlag, processTemplateCreationEffects } from "../effects/TemplateEffectsSD.mjs";
import { createAuraOnActor } from "../effects/AuraEffectsSD.mjs";
import { readSdRollOutcome, readSdDamageRoll, resolveCardContext } from "../shared/sd4Compat.mjs";
import { getSocket } from "../shared/combat-socket.mjs";
import { showScrollingText } from "../shared/scrolling-text.mjs";
import {
	buildRollBreakdown,
	buildDamageCardHtml,
	attachDamageCardListeners,
	spawnSummonedCreatures,
	giveItemsToCaster,
	applyCoatingPoison,
	getSummonedTokensExpiry,
	saveSummonedTokensExpiry,
	normalizeConfiguredEffectUuids,
	evaluateFormulaExpressions,
	doubleDiceInFormula,
	parseTieredFormula,
	evaluateRequirement,
	buildTargetRollData,
} from "./damage-card.mjs";
export { trackSummonedTokensForExpiry, spawnSummonedCreatures } from "./damage-card.mjs";
export { setupCombatSocket, getSocket } from "../shared/combat-socket.mjs";

const MODULE_ID = "shadowdark-extras";

// In-memory tracker for messages that have already started duration tracking
// Prevents duplicate calls on message re-render (e.g., critical success)
const _durationStartedMessages = new Set();

// Track messages currently calculating damage to prevent race conditions (double rolls)
window._sdx_calculatingMessages = window._sdx_calculatingMessages || new Set();
window._sdx_localDamageResults = window._sdx_localDamageResults || {};
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Combat Settings Configuration Application (ApplicationV2)
 */
export class CombatSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "shadowdark-combat-settings",
		classes: ["shadowdark-extras", "combat-settings"],
		tag: "form",
		window: {
			title: "Automatic Combat Settings",
			resizable: true,
		},
		position: {
			width: 600,
			height: "auto",
		},
		form: {
			handler: CombatSettingsApp.formHandler,
			submitOnChange: false,
			closeOnSubmit: true,
		},
		actions: {
			reset: CombatSettingsApp._onReset,
		},
	};

	static PARTS = {
		form: {
			template: "modules/shadowdark-extras/templates/combat-settings.hbs",
			scrollable: [""],
		},
	};

	async _prepareContext(options) {
		return {
			settings: game.settings.get(MODULE_ID, "combatSettings"),
		};
	}

	_onRender(context, options) {
		// Wire the "showDamageCard" subsetting opacity/pointer toggle. Lives here
		// instead of an inline <script> in the HBS so it re-binds on every render.
		const root = this.element;
		if (!root) return;
		const parent = root.querySelector("#showDamageCard");
		const sub = root.querySelector('[data-parent="showDamageCard"]');
		if (!parent || !sub) return;
		const sync = () => {
			sub.style.opacity = parent.checked ? "1" : "0.5";
			sub.style.pointerEvents = parent.checked ? "auto" : "none";
		};
		parent.addEventListener("change", sync);
		sync();
	}

	static async _onReset(event, target) {
		event?.preventDefault?.();
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Reset Combat Settings" },
			content: "<p>Reset all combat settings to their defaults?</p>",
			modal: true,
			yes: { default: false },
		});
		if (!confirmed) return;
		await game.settings.set(MODULE_ID, "combatSettings", foundry.utils.deepClone(DEFAULT_COMBAT_SETTINGS));
		ui.notifications.info("Combat settings reset to defaults");
		// Re-render to reflect the new values in the form
		this.render({ force: true });
	}

	static async formHandler(event, form, formData) {
		const settings = foundry.utils.expandObject(formData.object);
		await game.settings.set(MODULE_ID, "combatSettings", settings);
		ui.notifications.info("Combat settings saved successfully");
	}
}

/**
 * Default combat settings configuration
 */
export const DEFAULT_COMBAT_SETTINGS = {
	showDamageCard: true, // Default to enabled for testing
	showForPlayers: true, // Show damage card for players
	scrollingCombatText: true, // Show floating damage/healing numbers on tokens
	hideItemDescription: false, // Hide item description in chat cards (weapon/spell details)
	requireTargetForAttack: "none", // 'none' = no check, 'warn' = warn but proceed, 'block' = prevent attack
	checkWeaponRange: "none", // 'none' = no check, 'warn' = warn but proceed, 'block' = prevent attack if out of range
	untargetAtEndOfTurn: "dead", // 'none' = no untargeting, 'dead' = untarget dead tokens, 'all' = untarget all
	hideDamageCardOnFailedAttack: false, // Don't show damage card when weapon attack fails
	damageCard: {
		showTargets: true,
		showMultipliers: true,
		showApplyButton: true,
		autoApplyDamage: true,
		autoApplyConditions: true,
		damageMultipliers: [
			{ value: 0, label: "×", enabled: true },
			{ value: -1, label: "-1", enabled: false },
			{ value: 0, label: "0", enabled: true },
			{ value: 0.25, label: "¼", enabled: true },
			{ value: 0.5, label: "½", enabled: true },
			{ value: 1, label: "1", enabled: true },
			{ value: 2, label: "2", enabled: true },
		],
		gmOnlyApplyDamage: false,
	},
};

/**
 * Register combat settings
 */
export function registerCombatSettings() {
	// Register the combat settings data (not shown in config)
	game.settings.register(MODULE_ID, "combatSettings", {
		name: "Combat Settings Configuration",
		scope: "world",
		config: false,
		type: Object,
		default: foundry.utils.deepClone(DEFAULT_COMBAT_SETTINGS),
	});

	// Register a menu button to open the Combat Settings app
	game.settings.registerMenu(MODULE_ID, "combatSettingsMenu", {
		name: "Combat Settings",
		label: "Configure Combat Settings",
		hint: "Configure enhanced combat features like auto apply damage, damage cards and target management",
		icon: "fas fa-crossed-swords",
		type: CombatSettingsApp,
		restricted: true,
	});

	// Setup hook for summoned token expiry
	setupSummonExpiryHook();

	// Setup hook for un-targeting tokens at end of turn
	setupUntargetHook();
}

// Track HP values before updates for scrolling text
const _preUpdateHp = new Map();

/**
 * Setup scrolling combat text hooks
 * This catches HP changes from any source (not just our damage cards)
 */
export function setupScrollingCombatText() {
	// Store HP before update
	Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
		// Only process if HP is being changed
		const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
		if (newHp === undefined) return;

		// Store the current HP for comparison after update
		// Use a unique key: for synthetic actors use token id, for real actors use actor id
		const key = actor.isToken ? `token-${actor.token?.id}` : `actor-${actor.id}`;
		const currentHp = actor.system?.attributes?.hp?.value;

		if (currentHp !== undefined) {
			_preUpdateHp.set(key, {
				oldHp: currentHp,
				maxHp: actor.system?.attributes?.hp?.max ?? currentHp,
				isToken: actor.isToken,
				tokenId: actor.token?.id,
				actorId: actor.id,
			});
		}
	});

	// Show scrolling text after update
	Hooks.on("updateActor", (actor, changes, options, userId) => {
		// Check if scrolling combat text is enabled
		let settings;
		try {
			settings = game.settings.get(MODULE_ID, "combatSettings");
		}
		catch (e) {
			return; // Settings not registered yet
		}

		if (settings.scrollingCombatText === false) return;

		// Only process if HP was changed
		const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
		if (newHp === undefined) return;

		// Get the stored pre-update HP using the same key logic
		const key = actor.isToken ? `token-${actor.token?.id}` : `actor-${actor.id}`;
		const preData = _preUpdateHp.get(key);
		if (!preData) return;
		_preUpdateHp.delete(key);

		const hpChange = preData.oldHp - newHp;
		if (hpChange === 0) return;

		const isHealing = hpChange < 0;

		// Find the appropriate token(s) to show scrolling text on
		let tokens = [];

		if (actor.isToken) {
			// Synthetic actor (unlinked token) - get the specific token
			const token = canvas.tokens?.get(actor.token?.id);
			if (token) tokens.push(token);
		}
		else {
			// Real actor - find all LINKED tokens for this actor
			tokens = canvas.tokens?.placeables?.filter(t =>
				t.actor?.id === actor.id && t.document.actorLink
			) || [];
		}

		for (const token of tokens) {
			// Use socket to broadcast to all clients if available
			if (getSocket()) {
				getSocket().executeForEveryone("showScrollingText", {
					tokenId: token.id,
					amount: Math.abs(hpChange),
					isHealing: isHealing,
				});
			}
			else {
				// Fallback to local-only
				showScrollingText(token, Math.abs(hpChange), isHealing);
			}
		}
	});

	// Auto-mark actors as defeated/dead when HP drops to 0.
	// SD 4.x's ActorSD._onUpdate no longer calls _setDefeated() — only animates the HP delta.
	// The _setDefeated() prototype method still exists and is correct (marks combatant.defeated
	// + applies "dead" status overlay for NPCs / "prone"+"unconscious" for Players),
	// it just isn't being invoked anymore. This hook restores the pre-v4 behavior.
	Hooks.on("updateActor", async (actor, changes, options, userId) => {
		// GM-only to avoid duplicate combatant updates from each client
		if (!game.user.isGM) return;
		if (userId !== game.user.id) return;

		const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
		if (newHp === undefined) return;
		if (newHp > 0) return;

		// Only fire when HP actually transitioned to 0 from a positive value
		const key = actor.isToken ? `token-${actor.token?.id}` : `actor-${actor.id}`;
		// _preUpdateHp may have been cleared by the scrolling-text hook above; fall back to current
		// (post-update) HP if we don't have a record (e.g., direct sheet edit). Skip in that case.
		// To be safe, just call _setDefeated unconditionally on HP === 0 — it's idempotent
		// (toggleStatusEffect with active:true is a no-op if already applied).

		if (typeof actor._setDefeated === "function") {
			try {
				await actor._setDefeated();
			}
			catch (err) {
				console.error(`${MODULE_ID} | _setDefeated failed for ${actor.name}:`, err);
			}
		}
	});

}

// Track which messages have already spawned creatures (in-memory cache)
const _spawnedMessages = new Set();
const _itemGiveMessages = new Set();
const _coatingPoisonMessages = new Set();


/**
 * Setup hook to delete expired summoned tokens when combat advances
 */
export function setupSummonExpiryHook() {
	Hooks.on("updateCombat", async (combat, changed, options, userId) => {

		// Only process on round changes
		if (!("round" in changed)) {
			return;
		}

		// Only run for GM
		if (!game.user.isGM) return;

		const currentRound = combat.round;
		const sceneId = canvas.scene?.id;


		if (!sceneId) return;

		const expiryList = getSummonedTokensExpiry(sceneId);
		if (!expiryList || expiryList.length === 0) {
			return;
		}


		// expiryList already retrieved above
		const tokensToDelete = [];
		const remainingExpiry = [];
		const expiringMessages = [];
		const remainingMessages = [];

		for (const entry of expiryList) {
			const roundsRemaining = entry.expiryRound - currentRound;

			if (currentRound >= entry.expiryRound) {
				tokensToDelete.push(...entry.tokenIds);
				expiringMessages.push(`<b>${entry.spellName}</b> has expired!`);
			}
			else {
				remainingExpiry.push(entry);
				remainingMessages.push(`<b>${entry.spellName}</b>: ${roundsRemaining} round${roundsRemaining !== 1 ? "s" : ""} remaining`);
			}
		}

		// Update the tracking list
		await saveSummonedTokensExpiry(sceneId, remainingExpiry);

		// Post chat message with summon status
		const allMessages = [...expiringMessages, ...remainingMessages];
		if (allMessages.length > 0) {
			const content = `
				<div class="sdx-summon-status">
					<h4 style="margin: 0 0 6px 0; border-bottom: 1px solid #666; padding-bottom: 4px;">
						<i class="fas fa-dragon"></i> Summon Status
					</h4>
					<ul style="margin: 0; padding-left: 16px; list-style-type: none;">
						${allMessages.map(m => `<li style="margin: 2px 0;">${m}</li>`).join("")}
					</ul>
				</div>
			`;
			ChatMessage.create({
				content: content,
				whisper: [game.user.id], // Whisper to GM only
			});
		}

		// Delete expired tokens
		if (tokensToDelete.length > 0) {
			try {
				// Filter to only tokens that still exist on the scene
				const existingTokenIds = tokensToDelete.filter(id => canvas.tokens.get(id));
				if (existingTokenIds.length > 0) {
					await canvas.scene.deleteEmbeddedDocuments("Token", existingTokenIds);
					ui.notifications.info(`Deleted ${existingTokenIds.length} expired summoned creature(s)`);
				}
			}
			catch (err) {
				console.error("shadowdark-extras | Error deleting expired summons:", err);
			}
		}
	});

}

/**
 * Un-target dead tokens after a roll
 * Called when untargetAtEndOfTurn is set to "dead"
 */
export function untargetDeadTokens() {
	game.user?.targets.forEach((token) => {
		const hp = token.actor?.system?.attributes?.hp?.value;
		if (hp !== undefined && hp <= 0) {
			token.setTarget(false, { releaseOthers: false });
		}
	});
}

/**
 * Un-target all tokens for the current user
 * Called when untargetAtEndOfTurn is set to "all"
 */
export function untargetAllTokens() {
	game.user?.targets.forEach((token) => {
		token.setTarget(false, { releaseOthers: false });
	});
}

/**
 * Setup hook for un-targeting tokens at end of turn
 * This runs when the combat turn advances
 */
export function setupUntargetHook() {
	Hooks.on("updateCombat", (combat, changed, options, userId) => {
		// Only process on turn changes
		if (!("turn" in changed)) {
			return;
		}

		// Get the untarget setting
		let settings;
		try {
			settings = game.settings.get(MODULE_ID, "combatSettings");
		}
		catch (e) {
			return; // Settings not registered yet
		}

		const untargetMode = settings.untargetAtEndOfTurn || "none";
		if (untargetMode === "none") return;

		// Delay slightly to let any pending damage/HP updates complete
		setTimeout(() => {
			if (untargetMode === "dead") {
				untargetDeadTokens();
			}
			else if (untargetMode === "all") {
				untargetAllTokens();
			}
		}, 100);
	});
}

// Track messages that have already had template placement to prevent re-triggering
const _templatePlacedMessages = new Set();
// Track messages that have already auto-applied conditions/damage to prevent duplicates
const _autoAppliedMessages = new Set();

/**
 * Inject damage card into chat messages
 */
export async function injectDamageCard(message, html, data) {

	// v14: renderChatMessageHTML passes a raw HTMLElement, not jQuery.
	// Re-wrap so the existing jQuery API inside this large function keeps working.
	if (html instanceof HTMLElement) html = $(html);

	// Prevent duplicate injection for the same message
	const messageKey = message.id;
	const isAuthor = message.author.id === game.user.id;

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
	catch (e) {
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
	if (hideDamageCardFromPlayer) {
	}

	// Note: hideDamageCardOnFailedAttack check is done later after item type is known (around line 1610)

	// Check if this is a Shadowdark weapon/attack card with damage OR a spell with damage configured.
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
		if (applyDamageLabel && !damageKeywords.includes(applyDamageLabel)) damageKeywords.push(applyDamageLabel);
	}
	catch (e) {
		// game.i18n might not be fully ready
	}

	const hasDamageKeyword = damageKeywords.some(kw => messageText.includes(kw)) ||
		damageKeywords.some(kw => html.find("h4, h3, h2").text().toLowerCase().includes(kw));


	// Check if this looks like a damage roll
	const isDamageRoll = (hasWeaponCard && hasDamageRoll && hasDamageKeyword) ||
		(damageKeywords.some(kw => flavorText.includes(kw))) ||
		(message.flags?.shadowdark?.rollType === "damage");

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
			// Verify this token matches the actor ID in the card (or the card actor ID is the base ID and token wraps it)
			if (token && token.actor) {
				// If cardData.actorId matches either the token's synthetic ID or its base ID, use the token actor
				if (token.actor.id === cardData.actorId || token.actor.uuid.endsWith(cardData.actorId)) {
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
				const damageBonus = Number(specialAttack.damageBonus ?? item.system?.bonuses?.damageBonus ?? 0) || 0;
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
					catch (err) {
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
					catch (err) {
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
				isSpellWithDamage = true; // Loop into the damage processing block even if damage logic itself is off
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
	if (hasAuraEnabled) {
	}

	// Check for summoning configuration (independent of damage/effects)
	const summoningConfig = item?.flags?.[MODULE_ID]?.summoning;
	const summoningProfiles = Array.isArray(summoningConfig?.profiles)
		? summoningConfig.profiles
		: (summoningConfig?.profiles && typeof summoningConfig.profiles === "object" ? Object.values(summoningConfig.profiles) : []);
	if (summoningConfig?.enabled && summoningProfiles.length > 0) {

		// Only spawn for the user who created the message (the caster)
		if (message.author.id !== game.user.id) {
			// Don't return - still process other damage/effects for observers
		}
		else if (_spawnedMessages.has(message.id)) {
			// Check in-memory cache (synchronous, prevents race condition)
		}
		else {
			// Check if the spell cast was successful (skip this check for potions and scrolls which always succeed)
			// Wands have spell rolls, so they need the success check
			const summonOutcome = readSdRollOutcome(message);
			// NPC Special Attack / NPC Feature are GM-activated abilities: the SD system
			// never stamps a hit/miss `success` flag on their attack roll, so
			// readSdRollOutcome always reports isMasked/!isSuccess for them. Treat them
			// like Potion/Scroll and summon on use. The author-only guard above
			// (message.author.id === game.user.id) still prevents multi-client spawns.
			if (!["Potion", "Scroll", "NPC Special Attack", "NPC Feature"].includes(itemType)) {
				if (summonOutcome.isMasked) return;   // private roll — don't auto-spawn on non-recipient clients
				if (!summonOutcome.isSuccess) return;
			}

			// Mark as spawned immediately (synchronous)
			_spawnedMessages.add(message.id);


			// Parse profiles if it's a string
			let profiles = summoningProfiles;
			if (typeof profiles === "string") {
				try {
					profiles = JSON.parse(profiles);
				}
				catch (err) {
					console.error("shadowdark-extras | Failed to parse profiles:", err);
					return;
				}
			}

			// Check for critical success to double duration
			const isCriticalSuccess = summonOutcome.isCriticalSuccess;
			if (isCriticalSuccess) {
			}

			// Automatically spawn creatures when spell is cast
			await spawnSummonedCreatures(casterActor, item, profiles, summoningConfig, isCriticalSuccess);
		}
	}

	const itemGiveConfig = item?.flags?.[MODULE_ID]?.itemGive;
	// Skip during the load-time chat re-render (game/canvas not yet ready):
	// creating items there throws in the dependent-token render-flag update
	// ("Cannot read properties of undefined (reading 'OBJECTS')") and would also
	// re-grant items from historical cards on every reload (the dedup set is
	// in-memory). Item-give only needs to fire for cards created during live play.
	if (game.ready && itemGiveConfig?.enabled && itemGiveConfig?.profiles && itemGiveConfig.profiles.length > 0) {
		if (message.author.id !== game.user.id) {
		}
		else if (_itemGiveMessages.has(message.id)) {
		}
		else {
			let shouldGive = true;
			// See the summoning gate above: NPC Special Attack / NPC Feature have no
			// system-determined attack success, so they grant on use like Potion/Scroll.
			if (!["Potion", "Scroll", "NPC Special Attack", "NPC Feature"].includes(itemType)) {
				const itemGiveOutcome = readSdRollOutcome(message);
				if (itemGiveOutcome.isMasked) shouldGive = false;   // private roll — skip on non-recipient clients
				else if (!itemGiveOutcome.isSuccess) shouldGive = false;
			}
			if (shouldGive) {
				_itemGiveMessages.add(message.id);
				let profiles = itemGiveConfig.profiles;
				if (typeof profiles === "string") {
					try {
						profiles = JSON.parse(profiles);
					}
					catch (err) {
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
		if (message.author.id !== game.user.id) {
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

	if ((isSpellWithDamage || isSpellWithEffects)) {
	}
	else {
	}

	// Get targeted tokens - use stored targets from message flags if available
	let targets = [];
	const storedTargetIds = message.flags?.["shadowdark-extras"]?.targetIds;

	// Check if item has template targeting mode enabled
	const targetingConfig = item?.flags?.[MODULE_ID]?.targeting;
	let useTemplateTargeting = targetingConfig?.mode === "template" &&
		message.author.id === game.user.id && // Only for the caster
		!_templatePlacedMessages.has(messageKey) && // Use in-memory check
		!message.flags?.[MODULE_ID]?.templatePlaced; // AND persistent check

	// For spells that require success rolls, only show template if spell succeeded
	// Note: Potions and Scrolls don't have successful roll requirements (they always succeed when used)
	// Wands DO have spell rolls, so they need the success check
	if (useTemplateTargeting && !["Potion", "Scroll"].includes(itemType)) {
		const templateOutcome = readSdRollOutcome(message);
		if (templateOutcome.isMasked) useTemplateTargeting = false;   // private roll — don't show template prompt
		else if (!templateOutcome.isSuccess) useTemplateTargeting = false;
	}

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
		const hideOutline = templateSettings.hideOutline || false;
		const excludeCaster = templateSettings.excludeCaster || false;

		// TokenMagic settings
		const tmSettings = templateSettings.tokenMagic || {};
		const tmTexture = tmSettings.texture || "";
		const tmOpacity = tmSettings.opacity ?? 0.5;
		const tmPreset = tmSettings.preset || "NOFX";
		const tmTint = tmSettings.tint || "";
		const tmFilters = Array.isArray(tmSettings.filters) ? foundry.utils.deepClone(tmSettings.filters) : [];
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

		// Build SDX template flags to write at CREATE time.
		// Foundry v14 silently drops post-create setFlag on MeasuredTemplate documents
		// (template→region deprecation hardening), so we must include flags in the
		// templateData passed to createEmbeddedDocuments — see SDX.templates.place.
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
		catch (e) {
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
			// For "duration: 1" → template lasts only the cast round, deletes at start of next round.
			sdxTemplateFlags[MODULE_ID].templateExpiry = {
				spellName: item.name,
				createdRound: currentRound,
				expiryRound: currentRound + expiryRounds - 1,
				duration: expiryRounds,
			};
		}

		try {
			// Use SDX.templates API if available
			if (typeof SDX !== "undefined" && SDX.templates) {
				// Determine placement mode
				let result;
				if (placement === "centered") {
					// Auto-center on caster's token
					const casterTokenId = speaker?.token;
					const casterToken = canvas.tokens?.get(casterTokenId);
					if (casterToken) {
						// Place template centered on caster
						result = await SDX.templates.placeAndTarget({
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
						result = await SDX.templates.placeAndTarget({
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
						result = await SDX.templates.placeAndTarget({
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
					result = await SDX.templates.placeAndTarget({
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

					// Template flags (templateEffects + templateExpiry) were already written at create-time
					// via placeAndTarget's templateFlags option — see sdxTemplateFlags build block above
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
									// NOTE: Some versions of AA use playAnimation(source, targets, data)
									// where targets is an Array.
									await window.AutomatedAnimations.playAnimation(casterForAnim, [result.template], { item: item });
									console.log("shadowdark-extras | Manual AA trigger fired");
								}
								catch (err) {
									console.error("shadowdark-extras | Manual AA trigger failed:", err);
								}
							}
						}
					}
					// Check for manual AA trigger if template effects were NOT enabled but template exists
					else if (result.template) {
						if (game.modules.get("autoanimations")?.active && window.AutomatedAnimations) {
							const casterForAnim = canvas.tokens.get(casterTokenId);
							console.log("shadowdark-extras | Attempting manual AA trigger (no template effects)", { caster: casterForAnim, template: result.template, item: item });
							if (casterForAnim) {
								try {
									await window.AutomatedAnimations.playAnimation(casterForAnim, [result.template], { item: item });
									console.log("shadowdark-extras | Manual AA trigger fired");
								}
								catch (err) {
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
					// We avoid message.update() because it triggers re-renders that remove our injected damage card
					_templatePlacedMessages.add(messageKey);
				}
				else {
					return; // User cancelled
				}
			}
			else {
				console.warn("shadowdark-extras | SDX.templates not available, falling back to user targets");
				targets = Array.from(game.user.targets || []);
			}
		}
		catch (err) {
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
			// If it's the GM casting but this client is a player, we still treat the aura as "handled"
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

					await startFocusSpellIfNeeded(casterActor.id, spellInstanceId, item.name, perTurnConfig);
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

						const instance = await startDurationSpell(casterActor, item, [], trackerConfig);
						if (instance?.instanceId) {
							auraTrackerType = "duration";
							auraTrackerInstanceId = instance.instanceId;
							durationTrackerStartedForAura = true;
							message.setFlag(MODULE_ID, "durationTrackerStarted", true);
						}
					}
					catch (err) {
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
						await linkEffectToFocusSpell(casterActor.id, spellInstanceId, auraActor.id, auraToken?.id || auraActor.token?.id, effect.id);
					}
					else if ((durationConfig?.type === "rounds" || durationConfig?.type === "turns") && spellDamageConfig?.trackDuration) {
						if (durationTrackerStartedForAura && auraTrackerInstanceId) {
							await linkEffectToDurationSpell(casterActor.id, auraTrackerInstanceId, auraActor.id, auraToken?.id || auraActor.token?.id, effect.id);
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
	if ((isSpellWithDamage || (isSpellWithEffects && spellDamageConfig?.effectsChallenge?.enabled)) && spellDamageConfig) {
		// Check if the spell cast was successful (skip this check for potions, scrolls, wands, and NPC Features)
		if (!["Potion", "Scroll", "Wand", "NPC Feature", "NPC Spell"].includes(itemType)) {
			const spellEffectsOutcome = readSdRollOutcome(message);
			if (spellEffectsOutcome.isMasked) return;   // private roll — don't apply effects on non-recipient clients
			if (!spellEffectsOutcome.isSuccess) return;
		}


		damageType = spellDamageConfig.damageType || "damage";


		// Synchronization Check: Only author rolls, others use synced results
		// Use in-memory cache OR flags to prevent double-rolling during re-renders
		let syncedResults = message.getFlag(MODULE_ID, "spellDamageResults") || window._sdx_localDamageResults[message.id];

		console.log(`SDX | injectDamageCard | Message: ${message.id} | Author: ${isAuthor} | Synced: ${!!syncedResults} | Calculating: ${window._sdx_calculatingMessages.has(message.id)}`);

		// If no results yet, check if we are already calculating for this message to prevent double-roll race condition
		if (!syncedResults && isAuthor && window._sdx_calculatingMessages.has(message.id)) {
			console.log("SDX | injectDamageCard | Already calculating for check " + message.id + ", skipping duplicate execution");
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
				catch (e) {
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
						catch (e) {
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
			// AUTHOR: Continue with normal rolling logic (or if we have syncedResults but need to re-run for some reason, though logic above prevents that)
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
				// CRITICAL FIX: Ensure no stale data from previous rolls persists if we are calculating fresh
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
						// NOTE: Critical doubling is handled later by doubleDiceInFormula for all formula types
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
					// Damage NOT enabled, ensure formula is empty so we don't try to roll "undefined" or something
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
						bonusFormula = evaluateFormulaExpressions(bonusFormula, challengeStartRollData);

						let bonusTotal = 0;
						try {
							const bonusRoll = new Roll(bonusFormula, challengeStartRollData);
							await bonusRoll.evaluate();
							bonusTotal = bonusRoll.total;
						}
						catch (e) {
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
						catch (e) {
							dcTotal = parseInt(dcFormula) || 10;
						}

						console.log("SDX | Challenge Details", { bonusFormula, bonusTotal, dcFormula, dcTotal });

						// 3. Roll 1d20 + Bonus
						const challengeFormula = `1d20 + ${bonusTotal}`;
						let challengeRoll;

						if (message.rolls?.length > 0) {
							// Try to find a matching d20 roll to avoid double-roll
							// Look for a d20 term in the roll
							challengeRoll = message.rolls.find(r => r.terms.some(t => t.faces === 20)) ||
								message.rolls.find(r => r.formula === challengeFormula);
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
					catch (err) {
						console.error("shadowdark-extras | Error processing Challenge Mode:", err);
					}
				}

				// Effects Challenge Mode Logic
				let effectsChallengeResults = null;
				console.log("SDX | Inspecting spellDamageConfig for Effects Challenge", spellDamageConfig);
				if (spellDamageConfig?.effectsChallenge?.enabled) {
					console.log("SDX | Effects Challenge Mode Enabled", spellDamageConfig.effectsChallenge);
					try {
						// Inherit from main challenge if properties are missing (since UI is hidden)
						const mainChallengeConfig = spellDamageConfig.challenge || {};
						const rawEffectsConfig = spellDamageConfig.effectsChallenge || {};

						const challengeConfig = {
							// STRICTLY Inherit from main challenge (ignore local values as UI is removed)
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
						bonusFormula = evaluateFormulaExpressions(bonusFormula, challengeStartRollData);

						let bonusTotal = 0;
						try {
							const bonusRoll = new Roll(bonusFormula, challengeStartRollData);
							await bonusRoll.evaluate();
							bonusTotal = bonusRoll.total;
							console.log("SDX | Effects Challenge Bonus Calculated", bonusTotal);
						}
						catch (e) {
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
						catch (e) {
							dcTotal = parseInt(dcFormula) || 10;
						}

						// 3. Roll 1d20 + Bonus
						const challengeFormula = `1d20 + ${bonusTotal}`;
						let challengeRoll;

						if (message.rolls?.length > 0) {
							// Look for a DIFFERENT roll than the damage challenge if possible,
							// but usually it's best to look for a matching formula.
							// Ideally we check if this roll was already "claimed" by damage challenge?
							// For now, strict formula matching or simple search.
							challengeRoll = message.rolls.find(r => r.formula === challengeFormula &&
								(!challengeResults || r !== challengeResults.rollJSON /* simplistic check */));

							// Fallback: just find any matching d20 roll not used?
							// To confirm uniqueness we'd need better tracking.
							// For now, let's assume if formulas are identical, re-using is okay OR we force new roll?
							// Actually, if we re-use the SAME roll object for two different challenges, it might look weird.
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
					catch (err) {
						console.error("shadowdark-extras | Error processing Effects Challenge Mode:", err);
					}
				}


				// Roll the damage formula (or tiered formula)
				if (formula || hasTieredFormula) {
					try {
						// Check if formula contains target variables (tiered formulas always need per-target evaluation)
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
									baseRollData[ability] = baseRollData.abilities[ability].mod; // @cha = modifier
								}
								if (baseRollData.abilities[ability]?.value !== undefined) {
									baseRollData[ability + "Base"] = baseRollData.abilities[ability].value; // @chaBase = base score
								}
							});
						}
						// Ensure other common stats are available
						if (baseRollData.attributes?.ac?.value !== undefined) baseRollData.ac = baseRollData.attributes.ac.value;
						if (baseRollData.attributes?.hp?.value !== undefined) baseRollData.hp = baseRollData.attributes.hp.value;

						// If formula uses target variables OR we have a tiered formula (which needs target level), we need to roll per-target
						if ((hasTargetVariables || hasTieredFormula) && targets.length > 0) {
							const formulaDisplay = hasTieredFormula ? `Tiered: ${tieredFormula}` : formula;

							// Store per-target damage for later use
							window._perTargetDamage = {};
							let totalDamageSum = 0;

							for (const target of targets) {
								const targetActor = target.actor;
								if (!targetActor) continue;

								// Clone base roll data and add target data
								const rollData = foundry.utils.duplicate(baseRollData);
								const targetRollData = targetActor.getRollData() || {};

								// Create target object in rollData
								rollData.target = buildTargetRollData(targetActor);

								// Check for tiered formula and resolve it for this target's level
								let targetFormula = formula;
								if (hasTieredFormula) {
									const tieredResult = parseTieredFormula(tieredFormula, rollData.target.level);
									if (tieredResult) {
										targetFormula = tieredResult;
									}
								}

								// Evaluate any expressions in the formula (e.g., (1 + floor(@level / 2))d6 -> 2d6)
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
									const requirementMet = evaluateRequirement(reqFormula, rollData);

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

							// Use average damage for display (or total, depending on your preference)
							totalDamage = Math.floor(totalDamageSum / targets.length);
							window._lastSpellRollBreakdown = `Per - target(avg: ${totalDamage})`;

						}
						else {
							// No target variables and no tiered formula, roll once for all targets
							const rollData = baseRollData;

							// Check for tiered formula - use caster's level when no targets
							let finalFormula = formula;
							if (hasTieredFormula) {
								const tieredResult = parseTieredFormula(tieredFormula, rollData.level);
								if (tieredResult) {
									finalFormula = tieredResult;
								}
							}

							// Evaluate any expressions in the formula (e.g., (1 + floor(@level / 2))d6 -> 2d6)
							finalFormula = evaluateFormulaExpressions(finalFormula, rollData);

							// Double dice on critical hit
							if (isSpellCritical) {
								const originalFormula = finalFormula;
								finalFormula = doubleDiceInFormula(finalFormula);
							}

							let roll;

							// Try to use an existing roll from message.rolls if its formula matches.
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
							// For non-per-target damage, we evaluate the requirement without target context
							if (spellDamageConfig.damageRequirement && spellDamageConfig.damageRequirement.trim() !== "") {
								// If the requirement has @target variables but we're not rolling per-target,
								// we'll apply the requirement to each target when damage is actually applied
								const requirementFormula = spellDamageConfig.damageRequirement.trim();

								// Only evaluate now if there are no target variables
								if (!requirementFormula.includes("@target.")) {
									const requirementMet = evaluateRequirement(requirementFormula, rollData);

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
									// Store requirement info for per-target evaluation during damage application
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
								return `${d.number}${d.faces === "f" ? "dF" : "d" + d.faces}: [${results}]`;
							}).join(" + ");

							const rollBreakdown = roll.formula + " = " + (diceBreakdown || totalDamage);
							const formulaDisplay = hasTieredFormula ? `Tiered → ${finalFormula} ` : finalFormula;


							// Store roll breakdown for use in damage card
							window._lastSpellRollBreakdown = rollBreakdown;
							// Store the actual Roll object so buildRollBreakdown can extract individual dice
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

						// Allow the re-render from setFlag to handle final injection for consistency
						return;
					}
					catch (error) {
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
			catch (error) {
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
	else {
		// NPC Special Attack Base Damage Handling (Manual Roll since no system roll exists)
		if (itemType === "NPC Special Attack") {
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
				catch (err) {
					console.error("shadowdark-extras | Error rolling NPC Special Attack base damage:", err);
				}
			}
		}
		// SD 4.x stores damage as a typed Roll on message.rolls; v3 stored under flags.shadowdark.rolls.damage.roll.
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
	}


	// Check if spell has effects to apply
	let spellEffects = [];
	if ((isSpellWithDamage || isSpellWithEffects) && spellDamageConfig?.effects) {
		// Handle case where effects might be a string instead of an array
		if (typeof spellDamageConfig.effects === "string") {
			try {
				spellEffects = JSON.parse(spellDamageConfig.effects);
			}
			catch (err) {
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
	if (isCritical && (isSpellWithDamage || isSpellWithEffects) && spellDamageConfig?.criticalEffects) {
		let criticalEffects = [];
		if (typeof spellDamageConfig.criticalEffects === "string") {
			try {
				criticalEffects = JSON.parse(spellDamageConfig.criticalEffects);
			}
			catch (err) {
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
	let originalEffectsForPrompt = null; // Store original effects for 'prompt' mode

	if (spellEffects.length > 1) {

		if (effectSelectionMode === "random") {
			// Randomly select one effect
			const randomIndex = Math.floor(Math.random() * spellEffects.length);
			const selectedEffect = spellEffects[randomIndex];
			spellEffects = [selectedEffect];
		}
		else if (effectSelectionMode === "prompt") {
			// Store original effects for the click handler to use for prompting
			originalEffectsForPrompt = [...spellEffects];
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
				// The breakdown logic will use bonusRollResults/criticalRollResults which are plain objects
			}
			else if (isAuthor) {
				// Author calculates and persists results
				try {
					weaponBonusDamage = await calculateWeaponBonusDamage(item, actor, targetActor, isCritical);

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

					// Detect whether the SDX damage bonus was already baked into the damage
					// roll formula by the renderRollDialogSD hook. Try both the underscore
					// and non-underscore forms in case one gets stripped by DataModel cleaning.
					const bonusInFormula = !!(
						message.rollConfig?.sdxBonusInDamageFormula ||
						message.rollConfig?._sdxDamageBonusInFormula
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
						appliedBonusIndicesWithUsage: weaponBonusDamage.appliedBonusIndicesWithUsage || [],
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
				catch (err) {
					console.warn("shadowdark-extras | Failed to calculate weapon bonus damage:", err);
				}
			}
			else {
				// Not the author and no results yet - wait for sync
				return;
			}

			if (weaponBonusDamage?.requirementsMet && (weaponBonusDamage.totalBonus !== 0 || weaponBonusDamage.criticalBonus !== 0)) {
				// bonusInFormula is stored inside weaponBonusResults (a module flag that
				// survives Foundry DataModel serialisation reliably). When true, the SDX
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
		const extraDamages = Array.isArray(extraDamagesFlag) ? extraDamagesFlag : Object.values(extraDamagesFlag);

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
				catch (err) {
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

	const hasWeaponBonuses = weaponBonusDamage && weaponBonusDamage.requirementsMet && (weaponBonusDamage.totalBonus !== 0 || (isCritical && weaponBonusDamage.criticalBonus !== 0));

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
	const challengeFailed = spellDamageConfig?.challenge?.enabled && challengeResults && !challengeResults.success;

	// Check if EFFECTS challenge failed - if so, DO NOT apply conditions
	let effectsChallengeResults = message.getFlag(MODULE_ID, "spellDamageResults")?.effectsChallengeResults;
	if (!effectsChallengeResults) effectsChallengeResults = window._latestEffectsChallengeResults;

	// IF enabled AND (!results OR !results.success), then it failed.
	// But we must also trust the result if it exists, even if config is wonky on re-render
	const hasChallengeResults = !!effectsChallengeResults;
	const challengeFailedAndPresent = hasChallengeResults && !effectsChallengeResults.success;
	const effectsChallengeFailed = (spellDamageConfig?.effectsChallenge?.enabled && (!effectsChallengeResults || !effectsChallengeResults.success)) || challengeFailedAndPresent;

	// Build the complete damage card HTML
	const { html: cardHtml, challengeHtml } = await buildDamageCardHtml(actor, cardTargets, totalDamage, damageType, allEffects, spellDamageConfig, settings, message, weaponBonusDamage, isCritical, item, casterTokenId, baseDamageType, isMagicalWeapon, challengeResults, effectsChallengeResults);
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
	if (hideDamageCardFromPlayer) {
	}
	else {
		const $chatCard = html.find(".chat-card");

		if ($chatCard.length) {
			$chatCard.after(cardHtml);
		}
		else {
			const $messageContent = html.find(".message-content");
			$messageContent.append(cardHtml);
		}
	}

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
		// If damage card is hidden, show a minimal summary for both spells AND weapons (if they have bonuses)

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

		const isHealing = damageType?.toLowerCase() === "healing";
		const damageLabel = isHealing ? "Healing" : "Damage";

		// Build formula and results using buildRollBreakdown for consistency
		const rollSummary = await buildRollBreakdown(message, weaponBonusDamage, isCritical, baseDamageType);

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
	const isFocusCheck = message.flavor?.includes(focusCheckText) ||
		message.flavor?.includes("Focus Check");

	if (isFocusCheck) {
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

	if ((canApplyDamage || canApplyConditions) && hasValidTargets && messageAuthorId === game.user.id) {
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
				}
			}, 100);
		}
		else {
		}
	}
	else if ((shouldAutoApplyDamage || shouldAutoApplyConditions) && messageAuthorId !== game.user.id) {
	}

	// Add event listener for minimal summary toggle
	html.find('[data-action="toggleDamageBreakdown"]').on("click", (event) => {
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
	if (item && ["Spell", "Scroll", "Wand", "NPC Spell"].includes(item.type) &&
		spellDamageConfig?.trackDuration &&
		!isFocusCheck &&
		!isFocusSpell &&
		messageAuthorId === game.user.id &&
		!message.getFlag(MODULE_ID, "durationTrackerStarted")) {

		const durationOutcome = readSdRollOutcome(message);
		const mainRoll = durationOutcome.mainRoll;
		// "No roll" (auto-success) OR roll succeeded. Skip on masked rolls.
		const castSuccessful = !durationOutcome.isMasked && (!mainRoll || durationOutcome.isSuccess);

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
				// Range can be either a string directly (e.g., "self") or an object with a value property
				const durationRawRange = item.system?.range;
				const durationSpellRange = (typeof durationRawRange === "string" ? durationRawRange : durationRawRange?.value || "").toLowerCase();
				if (targetTokenIds.length === 0 && durationSpellRange === "self") {
					const casterTokenId = message.speaker?.token;
					if (casterTokenId) {
						targetTokenIds = [casterTokenId];
					}
					else {
						// Fallback: find first token for this actor on the current scene
						const casterToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
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
			catch (durationError) {
				console.warn("shadowdark-extras | Failed to start duration spell tracking:", durationError);
			}
		}
	}

	// Link targets to focus spells if no effects are being applied
	// This ensures focus spells with only damage/healing (like Regenerate) show targets in the tracker
	if (isFocusSpell && targets.length > 0 && allEffects.length === 0 && !isFocusCheck) {
		const spellId = item.id;
		const casterActor = actor;

		// Link each target to the focus spell
		for (const target of targets) {
			const targetActor = target.actor;
			const targetTokenId = target.id;

			if (targetActor) {
				await linkTargetToFocusSpell(casterActor.id, spellId, targetActor.id, targetTokenId);
			}
		}
	}
}
