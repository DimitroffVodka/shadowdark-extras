// Combat Settings application + registration hooks — extracted from
// scripts/combat/CombatSettingsSD.mjs (Phase 5.1 split). App class,
// DEFAULT_COMBAT_SETTINGS, registerCombatSettings, scrolling-text hook,
// summon-expiry hook, and the untarget hooks. The 5 shared message-tracker
// Sets + _preUpdateHp live here; CombatSettingsSD imports them back.

import { getSocket } from "../shared/combat-socket.mjs";
import { showScrollingText } from "../shared/scrolling-text.mjs";
import { getSummonedTokensExpiry, saveSummonedTokensExpiry, partitionExpiredSummons, convertRoundExpiryToWorldTime } from "./damage-card.mjs";

const MODULE_ID = "shadowdark-extras";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
		catch(e) {
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
		// _preUpdateHp may have been cleared by the scrolling-text hook above; fall back to current
		// (post-update) HP if we don't have a record (e.g., direct sheet edit). Skip in that case.
		// To be safe, just call _setDefeated unconditionally on HP === 0 — it's idempotent
		// (toggleStatusEffect with active:true is a no-op if already applied).

		if (typeof actor._setDefeated === "function") {
			try {
				await actor._setDefeated();
			}
			catch(err) {
				console.error(`${MODULE_ID} | _setDefeated failed for ${actor.name}:`, err);
			}
		}
	});

}

// Track which messages have already spawned creatures (in-memory cache)
export const _spawnedMessages = new Set();
export const _itemGiveMessages = new Set();
export const _coatingPoisonMessages = new Set();


/** How much of its duration an entry has left, phrased for the status card. */
function summonTimeRemaining(entry, { round, worldTime }) {
	if (Number.isFinite(entry.expiryRound) && Number.isFinite(round)) {
		const rounds = entry.expiryRound - round;
		return `${rounds} round${rounds !== 1 ? "s" : ""} remaining`;
	}
	if (Number.isFinite(entry.expiryWorldTime) && Number.isFinite(worldTime)) {
		const seconds = Math.max(0, entry.expiryWorldTime - worldTime);
		return `${seconds} second${seconds !== 1 ? "s" : ""} remaining`;
	}
	return "duration unknown";
}

/**
 * Retire whichever summons are due, judged against the clock that just moved.
 *
 * One body for both clocks: rounds while an encounter is running, world time
 * otherwise. Splitting this per hook is how the two would drift apart.
 *
 * @param {{round?: number|null, worldTime?: number|null}} now
 */
async function expireDueSummons(now) {
	if (!game.user.isGM) return;

	const sceneId = canvas.scene?.id;
	if (!sceneId) return;

	const expiryList = getSummonedTokensExpiry(sceneId);
	if (!expiryList || expiryList.length === 0) return;

	const { expired, remaining } = partitionExpiredSummons(expiryList, now);
	if (expired.length === 0 && remaining.length === expiryList.length) {
		// Nothing is due. Only speak up when something actually changed, so a
		// world-time tick does not narrate every unchanged summon.
		if (now.worldTime !== undefined && now.round === undefined) return;
	}

	await saveSummonedTokensExpiry(sceneId, remaining);

	const messages = [
		...expired.map(e => `<b>${e.spellName}</b> has expired!`),
		...remaining.map(e => `<b>${e.spellName}</b>: ${summonTimeRemaining(e, now)}`),
	];
	if (messages.length > 0) {
		ChatMessage.create({
			content: `
				<div class="sdx-summon-status">
					<h4 style="margin: 0 0 6px 0; border-bottom: 1px solid #666; padding-bottom: 4px;">
						<i class="fas fa-dragon"></i> Summon Status
					</h4>
					<ul style="margin: 0; padding-left: 16px; list-style-type: none;">
						${messages.map(m => `<li style="margin: 2px 0;">${m}</li>`).join("")}
					</ul>
				</div>
			`,
			whisper: [game.user.id], // Whisper to GM only
		});
	}

	const tokensToDelete = expired.flatMap(e => e.tokenIds ?? []);
	if (tokensToDelete.length > 0) {
		try {
			// Filter to only tokens that still exist on the scene
			const existingTokenIds = tokensToDelete.filter(id => canvas.tokens.get(id));
			if (existingTokenIds.length > 0) {
				await canvas.scene.deleteEmbeddedDocuments("Token", existingTokenIds);
				ui.notifications.info(`Deleted ${existingTokenIds.length} expired summoned creature(s)`);
			}
		}
		catch(err) {
			console.error("shadowdark-extras | Error deleting expired summons:", err);
		}
	}
}

/**
 * Setup hooks to delete expired summoned tokens.
 *
 * Three triggers, because a duration has to survive the encounter it was cast
 * in: rounds advancing, world time advancing, and the combat going away.
 */
export function setupSummonExpiryHook() {
	// Rounds advancing — the original trigger.
	Hooks.on("updateCombat", async (combat, changed, options, userId) => {
		if (!("round" in changed)) return;
		await expireDueSummons({ round: combat.round });
	});

	// World time advancing, for summons conjured outside an encounter. Without
	// this their duration was never checked at all and they stayed forever.
	Hooks.on("updateWorldTime", async () => {
		await expireDueSummons({ worldTime: game.time?.worldTime ?? 0 });
	});

	// The encounter ending strands anything still counting its rounds: that
	// counter will never advance again. Re-base the rounds still owed onto world
	// time so the duration continues rather than becoming permanent.
	Hooks.on("deleteCombat", async combat => {
		if (!game.user.isGM) return;
		const sceneId = canvas.scene?.id;
		if (!sceneId) return;

		const expiryList = getSummonedTokensExpiry(sceneId);
		if (!expiryList?.some(e => Number.isFinite(e.expiryRound))) return;

		await saveSummonedTokensExpiry(sceneId, convertRoundExpiryToWorldTime(expiryList, {
			round: combat?.round ?? 0,
			worldTime: game.time?.worldTime ?? 0,
		}));
	});
}

/**
 * Un-target dead tokens after a roll
 * Called when untargetAtEndOfTurn is set to "dead"
 */
export function untargetDeadTokens() {
	game.user?.targets.forEach(token => {
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
	game.user?.targets.forEach(token => {
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
		catch(e) {
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
export const _templatePlacedMessages = new Set();
// Track messages that have already auto-applied conditions/damage to prevent duplicates
export const _autoAppliedMessages = new Set();
