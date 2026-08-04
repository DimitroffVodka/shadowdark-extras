import { MODULE_ID } from "../shared/module-id.mjs";
import { readSdRollOutcome, resolveCardContext } from "../shared/sd4Compat.mjs";
import { AnimationFxSD } from "../animation/AnimationFxSD.mjs";
import { getWeaponItemMacroConfig } from "../combat/WeaponBonusConfig.mjs";
import { getSpellItemMacroConfig, executeSpellItemMacro } from "./spell-item-macros.mjs";
import { executeWeaponItemMacro } from "./weapon-item-macros.mjs";

/**
 * Chat-card dispatch: read a rendered card, decide what it was, fire the right
 * item-macro path.
 *
 * Extracted from the composition root in Phase 3 as one unit. The three handlers
 * are separate concerns but share two pieces of machinery that only make sense
 * together, so splitting them would have left the state behind in the root:
 *
 * - `sdxClaimMessageOnce` plus a Set per concern. `renderChatMessageHTML` fires
 *   many times for one message, and Foundry may re-instantiate the document,
 *   which drops any expando used as a guard.
 * - `SDX_MACRO_EPOCH` / `sdxIsHistoricalMessage`. The Sets live for one page
 *   load, and Foundry re-renders the whole chat backlog on every reload, so
 *   without an age gate every historical card re-fires on load. That bug shipped
 *   once (9bb1f86, the crossbow sound replaying on reload) and the guard is the
 *   fix; all three handlers check it, and the FX handler checks it *before*
 *   claiming so a backlog cannot fill and prematurely trim its Set.
 *
 * All three registration call sites stay in their original relative position:
 * the root calls registerChatDispatch() where the first hook sat, and the
 * shapechanger revert-button handler that precedes them is left in place, so it
 * still registers first.
 *
 * The FX handler is not an item-macro concern — it belongs with `animation/`.
 * It rides along because it uses the claim helper and the epoch guard above. If
 * those are ever promoted to a shared chat-claim module, this handler should
 * follow them out.
 */

/**
 * Once-per-message dedupe, keyed by message id.
 *
 * `renderChatMessageHTML` fires many times for the same message (measured 6x
 * per weapon attack), and Foundry may re-instantiate the ChatMessage document
 * — which drops any expando flag set on it and lets the handler run again.
 * Callers pass their own Set so each concern claims a message independently.
 *
 * @param {Set<string>} seen - caller-owned set of claimed message ids
 * @param {string} messageId
 * @returns {boolean} true if this call claimed the message (first time)
 */
function sdxClaimMessageOnce(seen, messageId) {
	if (!messageId) return false;
	if (seen.has(messageId)) return false;
	seen.add(messageId);
	if (seen.size > 500) {
		// Bound growth; older messages are no longer rendering.
		const keep = [...seen].slice(-250);
		seen.clear();
		for (const id of keep) seen.add(id);
	}
	return true;
}

const _sdxSpellMacroProcessedMessages = new Set();
const _sdxItemMacroProcessedMessages = new Set();

/**
 * Chat history re-renders on every page load, and the dedupe Sets above only live for the
 * lifetime of that page. Without an age gate, every historical cast/attack card in the
 * rendered backlog re-fires its Item Macro on reload — re-applying spell effects, damage,
 * etc. Only act on messages created after this client loaded.
 */
const SDX_MACRO_EPOCH = Date.now();
const sdxIsHistoricalMessage = (message) => (message?.timestamp ?? 0) < SDX_MACRO_EPOCH;

/** Message ids already animated, so repeated re-renders never replay the FX. */
const _sdxFxProcessedMessages = new Set();

/**
 * Register the three chat-card dispatch hooks. The composition root calls this
 * at the source position the first of them occupied.
 */
export function registerChatDispatch() {
	/**
	 * Hook into spell cast messages to trigger Item Macros
	 */
	Hooks.on("renderChatMessageHTML", async (message, html, context) => {
		// Don't re-fire macros for chat history re-rendered after a reload
		if (sdxIsHistoricalMessage(message)) return;

		// Only process once per message (id-keyed; expandos are lost on re-instantiation)
		if (!sdxClaimMessageOnce(_sdxSpellMacroProcessedMessages, message?.id)) return;

		// Only process for the user who created the message
		if (message.author?.id !== game.user.id) return;

		// Check if this is a spell-type item
		const spellCtx = resolveCardContext(message, html);
		if (!spellCtx?.itemId || !spellCtx?.actorId) return;

		const actor = game.actors.get(spellCtx.actorId);
		if (!actor) return;

		const item = actor.items.get(spellCtx.itemId);
		if (!item) return;

		// Only process spell-type items
		const spellTypes = ["Spell", "Scroll", "Wand", "Potion", "NPC Spell"];
		if (!spellTypes.includes(item.type)) return;

		// Get the macro config
		const macroConfig = getSpellItemMacroConfig(item);
		if (!macroConfig.enabled || macroConfig.triggers.length === 0) return;

		const rollOutcome = readSdRollOutcome(message);

		// Determine success/failure from roll data
		// Potions, Scrolls, Wands don't require a roll - they always succeed
		const noRollNeeded = ["Potion", "Scroll", "Wand"].includes(item.type);
		const hasVisibleRoll = rollOutcome.mainRoll && !rollOutcome.isMasked;
		const isSuccess = noRollNeeded || (hasVisibleRoll && rollOutcome.isSuccess);
		const isFailure = !noRollNeeded && hasVisibleRoll && !rollOutcome.isSuccess;
		const isCritical = hasVisibleRoll && rollOutcome.isCriticalSuccess;
		const isCriticalFail = hasVisibleRoll && rollOutcome.isCriticalFailure;

		// Get stored targets
		const storedTargetIds = message.flags?.[MODULE_ID]?.targetIds || [];
		const targets = canvas?.tokens ? storedTargetIds.map(id => canvas.tokens.get(id)).filter(Boolean) : [];

		const macroContext = {
			isSuccess,
			isFailure,
			isCritical,
			isCriticalFail,
			rollResult: rollOutcome.total,
			rollData: rollOutcome.mainRoll?.roll ?? rollOutcome.mainRoll ?? null,
			targets,
		};

		// Trigger macros based on which triggers are enabled
		const triggersToFire = [];

		// onCast always fires when the spell is used
		if (macroConfig.triggers.includes("onCast")) {
			triggersToFire.push("onCast");
		}

		// Success-based triggers
		if (macroConfig.triggers.includes("onCritical") && isCritical) {
			triggersToFire.push("onCritical");
		}
		else if (macroConfig.triggers.includes("onSuccess") && isSuccess) {
			triggersToFire.push("onSuccess");
		}

		// Failure-based triggers
		if (macroConfig.triggers.includes("onCriticalFail") && isCriticalFail) {
			triggersToFire.push("onCriticalFail");
		}
		else if (macroConfig.triggers.includes("onFailure") && isFailure && !isCriticalFail) {
			triggersToFire.push("onFailure");
		}

		// Execute all applicable triggers
		for (const trigger of triggersToFire) {
			await executeSpellItemMacro(item, actor, trigger, macroContext);
		}
	});

	/**
	 * Hook into spell casts and weapon attacks to fire SDX-native Sequencer FX.
	 * Independent of the Item Macro path (runs even when no macro is configured)
	 * and of Automated Animations. Resolves the animation via AnimationFxSD's
	 * two-tier model (per-item override -> master pattern list).
	 */
	Hooks.on("renderChatMessageHTML", async (message, html, context) => {
		// Chat history re-renders on every page load, and _sdxFxProcessedMessages only
		// lives for the lifetime of that page. Without this age gate every historical
		// attack/cast card in the backlog replays its animation AND its sound on reload.
		// Checked before the dedupe claim so the backlog never fills the Set.
		if (sdxIsHistoricalMessage(message)) return;

		// Dedupe by message id, not an expando (see sdxClaimMessageOnce).
		if (!sdxClaimMessageOnce(_sdxFxProcessedMessages, message?.id)) return;

		// Only the message author drives playback (each client plays for itself).
		if (message.author?.id !== game.user.id) return;

		try {
			if (!game.settings.get(MODULE_ID, "animationFxEnabled")) return;
		}
		catch (e) {
			return;
		}

		const ctx = resolveCardContext(message, html);
		const actorId = ctx?.actorId || message.speaker?.actor;
		if (!actorId) return;
		const actor = game.actors.get(actorId);
		if (!actor) return;

		let item = ctx?.itemId ? actor.items.get(ctx.itemId) : null;
		if (!item) return;

		// Only item types the FX engine understands
		if (!AnimationFxSD.categoryForItem(item)) return;

		// A resolvable animation must exist before we bother computing outcome
		if (!AnimationFxSD.resolvePreset(item)) return;

		// Determine hit/miss. Scrolls/Wands/Potions auto-succeed (no roll).
		const noRollNeeded = ["Potion", "Scroll", "Wand"].includes(item.type);
		const rollOutcome = readSdRollOutcome(message);
		const hasVisibleRoll = rollOutcome.mainRoll && !rollOutcome.isMasked;
		let outcome = "hit";
		if (!noRollNeeded && hasVisibleRoll && !rollOutcome.isSuccess) outcome = "miss";

		// Only require a roll for types that actually roll to hit
		const rollingType = ["Weapon", "Spell", "NPC Spell", "NPC Attack", "NPC Special Attack"].includes(item.type);
		if (rollingType && !hasVisibleRoll) return;

		// Targets: stored SDX target ids, else the user's current targets
		const storedTargetIds = message.flags?.[MODULE_ID]?.targetIds || [];
		let targets = canvas?.tokens
			? storedTargetIds.map(id => canvas.tokens.get(id)).filter(Boolean)
			: [];
		if (targets.length === 0) targets = Array.from(game.user.targets ?? []);

		const tokenId = message.speaker?.token ?? null;

		try {
			await AnimationFxSD.playForItem({ item, actor, targets, outcome, tokenId });
		}
		catch (e) {
			console.warn(`${MODULE_ID} | AnimationFx trigger failed:`, e);
		}
	});

	/**
	 * Hook into weapon attack rolls to trigger Item Macros
	 * Use renderChatMessageHTML for v14 compatibility
	 */
	Hooks.on("renderChatMessageHTML", async (message, html, context) => {
		// Don't re-fire macros for chat history re-rendered after a reload
		if (sdxIsHistoricalMessage(message)) return;

		// Only process once per message (id-keyed; expandos are lost on re-instantiation)
		if (!sdxClaimMessageOnce(_sdxItemMacroProcessedMessages, message?.id)) return;

		// Only process for the user who created the message
		if (message.author?.id !== game.user.id) return;

		// Check for rolls using HTML elements (like CombatSettingsSD does)
		const hasDiceTotal = html.querySelector(".dice-total") !== null;
		const hasD20Roll = html.querySelector(".d20-roll") !== null;

		// Debug logging for troubleshooting

		const cardCtx = resolveCardContext(message, html);

		// Get actor from speaker or SD 4.x roll config
		const actorId = cardCtx?.actorId || message.speaker?.actor;
		if (!actorId) return;

		const actor = game.actors.get(actorId);
		if (!actor) return;

		let item = null;

		if (cardCtx?.itemId) {
			item = actor.items.get(cardCtx.itemId);
		}
		else {
			// Fallback: Try to detect weapon from message content
			const content = message.content || "";
			for (const actorItem of actor.items) {
				if (actorItem.type === "Weapon" && content.includes(actorItem.name)) {
					const config = getWeaponItemMacroConfig(actorItem);
					if (config.enabled && config.triggers.length > 0) {
						item = actorItem;
						break;
					}
				}
			}
		}

		if (!item || item.type !== "Weapon") return;

		// Get the macro config
		const macroConfig = getWeaponItemMacroConfig(item);
		if (!macroConfig.enabled || macroConfig.triggers.length === 0) {
			return;
		}

		// Check if this is an attack roll using flavor
		const flavor = message.flavor?.toLowerCase() || "";
		const isAttackMessage = flavor.includes("attack roll");


		// Skip if this doesn't look like an attack with dice
		if (!isAttackMessage && !hasDiceTotal && !hasD20Roll) {
			return;
		}

		const rollOutcome = readSdRollOutcome(message);


		if (!rollOutcome.mainRoll || rollOutcome.isMasked) {
			return;
		}

		// Determine hit/miss/critical from Shadowdark's roll data
		const isCritical = rollOutcome.isCriticalSuccess;
		const isCriticalMiss = rollOutcome.isCriticalFailure;
		const isHit = rollOutcome.isSuccess && !isCriticalMiss;
		const isMiss = !rollOutcome.isSuccess || isCriticalMiss;


		// Get roll result from the mainRoll data
		const rollResult = rollOutcome.total;

		const macroContext = {
			isHit: isHit && !isCriticalMiss,
			isMiss: isMiss || isCriticalMiss,
			isCritical,
			isCriticalMiss,
			rollResult: rollResult,
			rollData: rollOutcome.mainRoll?.roll ?? rollOutcome.mainRoll,
		};

		// Trigger macros based on which triggers are enabled
		const triggersToFire = [];

		if (macroConfig.triggers.includes("onCritical") && isCritical) {
			triggersToFire.push("onCritical");
		}
		else if (macroConfig.triggers.includes("onHit") && isHit) {
			triggersToFire.push("onHit");
		}

		if (macroConfig.triggers.includes("onCriticalMiss") && isCriticalMiss) {
			triggersToFire.push("onCriticalMiss");
		}
		else if (macroConfig.triggers.includes("onMiss") && isMiss && !isCriticalMiss) {
			triggersToFire.push("onMiss");
		}


		// Execute all applicable triggers
		for (const trigger of triggersToFire) {
			await executeWeaponItemMacro(item, actor, trigger, macroContext);
		}
	});
}
