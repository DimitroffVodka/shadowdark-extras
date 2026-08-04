/**
 * Carousing System for Shadowdark Extras
 * Implements the full Shadowdark carousing mechanics with synchronized player dropboxes,
 * cost tiers, player confirmations, and roll outcomes.
 */


// ============================================
// PLAYER DATA HELPERS
// ============================================

/**
 * Calculate Renown bonus based on tiered system:
 * 3 or less = 0
 * 4-7 = +1
 * 8-11 = +2
 * 12 or higher = +3
 * @param {number} renown
 * @returns {number}
 */
import { MODULE_ID, getCarousingMode, getActiveCarousingTiers, getExpandedOutcome, getExpandedBenefit, getExpandedMishap, getDefaultExpandedData, getExpandedCarousingTables, saveExpandedCarousingTables, getExpandedCarousingData, saveExpandedCarousingData, refreshLinkedCarousingTables, initCarousing, getCarousingJournal, getCarousingTablesJournal, ensureCarousingJournal, ensureCarousingTablesJournal, getCustomCarousingTables, saveCustomCarousingTables, getCarousingTableById, getCarousingGmActors, getCarousingDrops, saveCarousingDrops, getCarousingSession, saveCarousingSession, setCarousingDrop, setCarousingTier, setCarousingTable, setPlayerConfirmation, setPlayerModifier, addGmParticipant, removeGmParticipant, resetCarousingSession, addCarousingResult, removeCarousingResult, pruneOfflineCarousingData } from "./carousing-core.mjs";

export function getRenownBonus(renown) {
	if (renown >= 12) return 3;
	if (renown >= 8) return 2;
	if (renown >= 4) return 1;
	return 0;
}

/**
 * Get online players and GM-added actors with their carousing data
 */
export function getCarousingParticipants() {
	const drops = getCarousingDrops();
	const gmActors = getCarousingGmActors();
	const session = getCarousingSession();

	// Get the correct table based on mode
	const mode = getCarousingMode();
	const activeTable = mode === "expanded"
		? getExpandedCarousingData()
		: getCarousingTableById(session.selectedTableId);

	const selectedTier = session.selectedTier !== null ? activeTable.tiers[session.selectedTier] : null;
	const totalTierCost = selectedTier?.cost || 0;

	// Calculate how many participants have characters dropped
	const participantCount = Object.values(drops).length + gmActors.length;
	const splitCost = Math.ceil(totalTierCost / Math.max(1, participantCount));

	// 1. Get Online User participants
	const userParticipants = game.users.filter(user => {
		if (!user.active) return false;
		if (user.role === CONST.USER_ROLES.GAMEMASTER) return false;
		if (user.role === CONST.USER_ROLES.ASSISTANT) return false;
		return true;
	}).map(user => {
		const participantId = user.id; // Keep original ID for user drops to avoid breaking everything
		const droppedActorId = drops[user.id];
		const droppedActor = droppedActorId ? game.actors.get(droppedActorId) : null;
		const actorGp = droppedActor ? getActorTotalGp(droppedActor) : 0;
		const wealth = droppedActor ? getActorWealthDisplay(droppedActor) : null;
		const canAfford = actorGp >= splitCost;
		const isConfirmed = session.confirmations[user.id] === true;
		const result = session.results?.[user.id];
		const renown = getActorRenown(droppedActor);
		const renownBonus = getRenownBonus(renown);
		const totalBonus = selectedTier ? (selectedTier.bonus + renownBonus) : renownBonus;

		return {
			id: user.id,
			participantId: user.id,
			name: user.name,
			character: user.character,
			characterName: user.character?.name || game.i18n.localize("SHADOWDARK_EXTRAS.carousing.no_character"),
			color: user.color,
			droppedActor: droppedActor,
			droppedActorId: droppedActorId,
			droppedActorName: droppedActor?.name || null,
			droppedActorImg: droppedActor?.img || null,
			hasDrop: !!droppedActor,
			isCurrentUser: user.id === game.user.id,
			actorGp: actorGp,
			// Coins carried vs. total wealth including gear, shown as "41 / 162 GP"
			actorTotalWealthGp: wealth ? Math.floor(wealth.totalCp / CP_PER_GP) : 0,
			actorCoinsLabel: wealth?.coinsLabel || "0 gp",
			actorTotalWealthLabel: wealth?.totalLabel || "0 gp",
			hasGearValue: !!wealth?.gearCp,
			canAfford: canAfford,
			isConfirmed: isConfirmed,
			result: result,
			renown: renown,
			totalBonus: totalBonus,
			isGmManaged: false,
		};
	});

	// 2. Get GM-added Actor participants.
	//
	// A rolled result keeps its participant alive even if the actor is no
	// longer in the GM list. Without this, anything that drops an actor from
	// that list strands its outcome: the result stays in the session but has
	// no card, so it can never be applied or reviewed. Explicitly removing a
	// participant still deletes its result outright, so nothing lingers.
	const resultActorIds = Object.keys(session.results || {})
		.filter(k => k.startsWith("actor-"))
		.map(k => k.slice(6));
	const gmActorIds = [...new Set([...gmActors, ...resultActorIds])];

	const gmParticipants = gmActorIds.map(actorId => {
		const droppedActor = game.actors.get(actorId);
		if (!droppedActor) return null;

		const participantId = `actor-${actorId}`;
		const actorGp = getActorTotalGp(droppedActor);
		const wealth = getActorWealthDisplay(droppedActor);
		const canAfford = actorGp >= splitCost;
		const isConfirmed = session.confirmations[participantId] === true;
		const result = session.results?.[participantId];
		const renown = getActorRenown(droppedActor);
		const renownBonus = getRenownBonus(renown);
		const totalBonus = selectedTier ? (selectedTier.bonus + renownBonus) : renownBonus;

		return {
			id: participantId,
			participantId: participantId,
			name: "GM Managed",
			character: droppedActor,
			characterName: droppedActor.name,
			color: "#666",
			droppedActor: droppedActor,
			droppedActorId: actorId,
			droppedActorName: droppedActor.name,
			droppedActorImg: droppedActor.img,
			hasDrop: true,
			isCurrentUser: game.user.isGM,
			actorGp: actorGp,
			// Coins carried vs. total wealth including gear, shown as "41 / 162 GP"
			actorTotalWealthGp: wealth ? Math.floor(wealth.totalCp / CP_PER_GP) : 0,
			actorCoinsLabel: wealth?.coinsLabel || "0 gp",
			actorTotalWealthLabel: wealth?.totalLabel || "0 gp",
			hasGearValue: !!wealth?.gearCp,
			canAfford: canAfford,
			isConfirmed: isConfirmed,
			result: result,
			renown: renown,
			totalBonus: totalBonus,
			isGmManaged: true,
		};
	}).filter(p => p !== null);

	return [...userParticipants, ...gmParticipants];
}

/**
 * Get online players with their carousing data
 * @deprecated Use getCarousingParticipants instead
 */
function getOnlinePlayers() {
	return getCarousingParticipants().filter(p => !p.isGmManaged);
}


/**
 * Get actor's total GP (coins.gp + sp/10 + cp/100), rounded down to whole gp.
 * Display and affordability only — anything doing arithmetic on wealth should
 * use the copper helpers below, which do not discard change.
 */
function getActorTotalGp(actor) {
	return Math.floor(getActorCoinsCp(actor) / CP_PER_GP);
}

// Coin maths is done in copper, the smallest unit, so a percentage and its
// deduction keep their change instead of being rounded to whole gp at every
// step. 1 gp = 10 sp = 100 cp.
const CP_PER_GP = 100;
const CP_PER_SP = 10;

/** An actor's carried coin, in copper. */
function getActorCoinsCp(actor) {
	const coins = actor?.system?.coins || {};
	return (Number(coins.gp) || 0) * CP_PER_GP
        + (Number(coins.sp) || 0) * CP_PER_SP
        + (Number(coins.cp) || 0);
}

/** Value of an actor's gear in copper. Items with no cost recorded count as 0. */
function getActorGearValueCp(actor) {
	let total = 0;
	for (const item of actor?.items ?? []) {
		const cost = item.system?.cost;
		if (!cost) continue;
		const qty = Number(item.system?.quantity ?? 1) || 1;
		total += ((Number(cost.gp) || 0) * CP_PER_GP
            + (Number(cost.sp) || 0) * CP_PER_SP
            + (Number(cost.cp) || 0)) * qty;
	}
	return total;
}

/** Split a copper total into {gp, sp, cp}. */
function cpToCoins(totalCp) {
	return {
		gp: Math.floor(totalCp / CP_PER_GP),
		sp: Math.floor((totalCp % CP_PER_GP) / CP_PER_SP),
		cp: totalCp % CP_PER_SP,
	};
}

/**
 * Human-readable coin string ("2 gp 5 sp"), omitting empty denominations.
 * @param {number} totalCp
 */
export function formatCoins(totalCp) {
	const n = Math.max(0, Math.round(Number(totalCp) || 0));
	if (!n) return "0 gp";
	const { gp, sp, cp } = cpToCoins(n);
	const parts = [];
	if (gp) parts.push(`${gp} gp`);
	if (sp) parts.push(`${sp} sp`);
	if (cp) parts.push(`${cp} cp`);
	return parts.join(" ");
}

/**
 * Create or increase the actor's zero-slot Carousing Debt note.
 * The amount is stored in copper for exact accumulation across denominations.
 */
export async function recordCarousingDebt(actor, amountCp, sourceText = "") {
	const addedCp = Math.max(0, Math.round(Number(amountCp) || 0));
	if (!actor || !addedCp) return 0;

	const existing = actor.items?.find?.(item => item.getFlag?.(MODULE_ID, "carousingDebt")?.amountCp !== undefined);
	const previous = existing?.getFlag?.(MODULE_ID, "carousingDebt") || {};
	const totalCp = Math.max(0, Math.round(Number(previous.amountCp) || 0)) + addedCp;
	const esc = foundry.utils.escapeHTML ?? (value => String(value));
	const entries = [
		...(Array.isArray(previous.entries) ? previous.entries : []),
		{ amountCp: addedCp, source: String(sourceText || ""), at: Date.now() },
	];
	const history = entries.map(entry => {
		const source = entry.source ? ` — ${esc(entry.source)}` : "";
		return `<li>${esc(formatCoins(entry.amountCp))}${source}</li>`;
	}).join("");
	const debt = { amountCp: totalCp, entries };
	const data = {
		name: `Carousing Debt — ${formatCoins(totalCp)}`,
		img: "icons/sundries/documents/document-sealed-brown-red.webp",
		system: {
			cost: { cp: 0, gp: 0, sp: 0 },
			description: `<p><strong>Outstanding carousing debt:</strong> ${esc(formatCoins(totalCp))}.</p><ul>${history}</ul><p>This note uses 0 gear slots. Delete it when the debt is paid.</p>`,
			equipped: false,
			quantity: 1,
			slots: { free_carry: 0, per_slot: 1, slots_used: 0 },
			stashed: false,
			treasure: false,
		},
		flags: { [MODULE_ID]: { carousingDebt: debt } },
	};

	if (existing) {
		await existing.update(data);
	}
	else {
		await actor.createEmbeddedDocuments("Item", [{ ...data, type: "Basic" }]);
	}
	return totalCp;
}

/**
 * Deduct an amount in copper, making change across denominations.
 *
 * Spends the smallest coins first and only breaks a larger one when the
 * remainder cannot be covered, so the actor's coin *count* stays as close to
 * unchanged as possible — in Shadowdark 100 coins is a gear slot regardless of
 * denomination, so silently normalising a purse would alter encumbrance.
 *
 * @returns {Promise<number>} copper actually deducted (clamped to the purse)
 */
async function deductCoinsCp(actor, cpAmount) {
	const src = actor?.system?.coins || {};
	let gp = Number(src.gp) || 0;
	let sp = Number(src.sp) || 0;
	let cp = Number(src.cp) || 0;

	const purse = gp * CP_PER_GP + sp * CP_PER_SP + cp;
	const total = Math.min(Math.max(0, Math.round(Number(cpAmount) || 0)), purse);
	if (!total) return 0;

	let owed = total;
	while (owed > 0 && (gp > 0 || sp > 0 || cp > 0)) {
		if (cp >= owed) {
			cp -= owed; owed = 0; break;
		}
		if (cp > 0) {
			owed -= cp; cp = 0;
		}

		if (sp > 0) {
			const use = Math.min(sp, Math.ceil(owed / CP_PER_SP));
			sp -= use;
			const value = use * CP_PER_SP;
			if (value >= owed) {
				cp += value - owed; owed = 0;
			}
			else {
				owed -= value;
			}
		}
		else if (gp > 0) {
			const use = Math.min(gp, Math.ceil(owed / CP_PER_GP));
			gp -= use;
			const value = use * CP_PER_GP;
			if (value >= owed) {
				const change = value - owed;
				sp += Math.floor(change / CP_PER_SP);
				cp += change % CP_PER_SP;
				owed = 0;
			}
			else {
				owed -= value;
			}
		}
	}

	await actor.update({ "system.coins": { gp, sp, cp } });
	return total - owed;
}

/**
 * Get participants who have dropped actors
 */
function getParticipants() {
	return getCarousingParticipants().filter(p => p.hasDrop);
}

// ============================================
// DICE SO NICE APPEARANCE CUSTOMIZATION
// ============================================

/**
 * Dice So Nice colorset configurations for carousing rolls
 */
const DSN_CAROUSING_APPEARANCE = {
	outcome: { colorset: "black" },      // Black dice for d8 outcome roll
	benefit: { colorset: "acid" },       // Green dice for d100 benefit rolls
	mishap: { colorset: "fire" },         // Red dice for d100 mishap rolls
};

/**
 * Show a roll with Dice So Nice using custom appearance
 * Sets the appearance on the dice options before calling showForRoll
 * @param {Roll} roll - The evaluated Roll object
 * @param {string} type - 'outcome', 'benefit', or 'mishap'
 */
async function showDSNRoll(roll, type = "outcome") {
	if (!game.dice3d) return;

	const appearances = {
		outcome: { colorset: "black" },           // Black dice for d8 outcome
		benefit: { colorset: "acid" },            // Green dice for benefits
		mishap: { colorset: "fire" },              // Red dice for mishaps
	};

	const appearance = appearances[type] || {};
	console.log(`${MODULE_ID} | showDSNRoll: type=${type}, setting dice appearance`, appearance);

	// Set appearance directly on each die in the roll
	for (const die of roll.dice) {
		die.options.appearance = appearance;
	}
	await game.dice3d.showForRoll(roll, game.user, true);
}

/**
 * Broadcast a roll announcement to all clients
 * Shows a prominent message like "ROLLING FOR ELBIN!"
 * @param {string} characterName - The character name being rolled for
 */
function broadcastRollAnnouncement(characterName) {
	const message = `🎲 Rolling for ${characterName}!`;
	console.log(`${MODULE_ID} | broadcastRollAnnouncement: ${message}`);

	// Broadcast to all other clients
	game.socket.emit(`module.${MODULE_ID}`, {
		type: "carousing-roll-announce",
		message: message,
	});

	// Also show locally for the GM
	_showRollAnnouncement(message);
}

/**
 * Show a roll announcement locally (prominent centered message)
 * @param {string} message - The announcement message
 */
function _showRollAnnouncement(message) {
	// Remove any existing announcement
	const existing = document.querySelector(".sdx-roll-announcement");
	if (existing) existing.remove();

	const announcement = document.createElement("div");
	announcement.className = "sdx-roll-announcement";
	announcement.innerHTML = `<span>${message}</span>`;
	document.body.appendChild(announcement);

	// Auto-remove after 2 seconds
	setTimeout(() => {
		announcement.classList.add("sdx-fade-out");
		setTimeout(() => announcement.remove(), 500);
	}, 2000);
}

// ============================================
// EXPANDED CAROUSING ROLL LOGIC
// ============================================

// Special table rows that redirect to the other d100 table
// (CS6/Western Reaches: Benefit 01 and Mishap 100)
const REROLL_AS_MISHAP = /re-?roll\s+this\s+benefit\s+as\s+a\s+mishap/i;
const REROLL_AS_BENEFIT = /re-?roll\s+this\s+mishap\s+as\s+a\s+benefit/i;

// "+N renown" / "-N renown" in a result description. The lookahead skips
// conditional grants like "-1 renown if anyone sees it", which stay manual.
const RENOWN_DELTA = /([+-]\d+)\s+renown(?!\s+if)/i;

/**
 * Extract the renown adjustment from a benefit/mishap description, if any.
 * @returns {number} the delta, or 0 when none applies
 */
export function parseRenownDelta(description) {
	const m = String(description || "").match(RENOWN_DELTA);
	return m ? (parseInt(m[1]) || 0) : 0;
}

/** Read the Shadowdark system's native renown value. */
export function getActorRenown(actor) {
	const value = Number(actor?.system?.renown);
	return Number.isFinite(value) ? value : 0;
}

/**
 * Apply a change to Shadowdark's native renown field. The system intentionally
 * permits negative renown, so do not impose the retired SDX min/max rules.
 *
 * When Shadowdark Enhancer is installed it owns the renown ledger, so hand the
 * change to its `award` API instead of writing the field ourselves: SDE commits
 * the value and its history row in one transaction and carries `reason` through
 * to the Session Recap, which a bare field write cannot do (SDE's watcher would
 * only see an anonymous "changed outside the module").
 *
 * Two constraints shape the guard:
 *  - SDE rejects player-side awards outright (its recap is a world setting only
 *    a GM may write), so only delegate from a GM client. Player-reachable paths
 *    keep the direct write and fall back to SDE's external-change watcher.
 *  - Any refusal still has to apply the renown. SDE reports `ok: false` without
 *    committing anything, so falling through to the direct write is safe and
 *    keeps a player from silently losing renown when SDE is unavailable.
 *
 * @param {Actor} actor
 * @param {number} delta signed change
 * @param {string} [reason] human-readable cause, recorded in SDE's renown log
 * @returns {Promise<number>} the delta actually applied
 */
export async function applyRenownDelta(actor, delta, reason = "") {
	if (!actor || !delta) return 0;

	// Reached through `globalThis` so the delta logic stays importable under
	// node:test, where no `game` binding exists at all.
	const g = globalThis.game;
	const sde = g?.user?.isGM && g.modules.get("shadowdark-enhancer")?.active
		? g.shadowdarkEnhancer?.renown
		: null;
	if (typeof sde?.award === "function") {
		try {
			// chat: false — SDX's own carousing card already reports the change.
			const result = await sde.award({
				actor,
				delta,
				reason: String(reason || ""),
				source: "carousing",
				chat: false,
			});
			// Trust SDE's number rather than the requested one: the session
			// stores it and replays it negated when a result is removed, so a
			// clamped award must not leave SDX holding a delta SDE never wrote.
			if (result?.ok) return Number(result.delta) || 0;
			console.warn(
				`${MODULE_ID} | renown: Shadowdark Enhancer declined the award, writing the field directly`,
				result?.error
			);
		}
		catch (err) {
			console.warn(
				`${MODULE_ID} | renown: Shadowdark Enhancer award failed, writing the field directly`,
				err
			);
		}
	}

	const current = getActorRenown(actor);
	const next = current + delta;
	await actor.update({ "system.renown": next });
	return delta;
}

/**
 * Move values from SDX's retired actor flag into native Shadowdark renown.
 * A nonzero native value always wins; this avoids overwriting system-owned data.
 * Legacy flags are removed after reconciliation so there is one source of truth.
 * @returns {Promise<number>} number of native values populated from legacy data
 */
export async function migrateLegacyRenown(actors = []) {
	let migrated = 0;
	for (const actor of actors) {
		if (actor?.type !== "Player") continue;
		const legacy = Number(actor.getFlag?.(MODULE_ID, "renown"));
		if (!Number.isFinite(legacy)) continue;

		if (getActorRenown(actor) === 0 && legacy !== 0) {
			await actor.update({ "system.renown": legacy });
			migrated++;
		}
		await actor.unsetFlag(MODULE_ID, "renown");
	}
	return migrated;
}

/**
 * Resolve the actor behind a carousing participant id
 * (a user id with a dropped actor, or "actor-<id>" for GM-managed ones).
 */
export function getParticipantActor(participantId) {
	const actorId = participantId?.startsWith("actor-")
		? participantId.slice(6)
		: getCarousingDrops()[participantId];
	return actorId ? game.actors.get(actorId) : null;
}

/**
 * Roll a d100 Benefit/Mishap result, automatically honoring the "re-roll this
 * benefit as a mishap" / "re-roll this mishap as a benefit" rows by rolling
 * again on the other table. Bounded to avoid ping-pong loops.
 * @param {"benefit"|"mishap"} type - the table to roll on first
 * @param {number} outcomeModifier - the outcome row's d100 modifier
 * @param {object} playerMods - per-player custom modifiers ({benefits, mishaps})
 * @returns {Promise<{type: string, diceRoll: number, modifier: number, finalRoll: number, description: string}>}
 */
export async function rollExpandedD100(type, outcomeModifier, playerMods = {}) {
	let result = null;
	for (let hop = 0; hop < 4; hop++) {
		const extra = playerMods[type === "benefit" ? "benefits" : "mishaps"];
		const roll = await new Roll(`1d100${extra ? ` + ${extra}` : ""}`).evaluate();
		await showDSNRoll(roll, type);

		const diceRoll = roll.total;
		const finalRoll = Math.max(1, Math.min(100, diceRoll + outcomeModifier));
		const entry = type === "benefit" ? getExpandedBenefit(finalRoll) : getExpandedMishap(finalRoll);
		result = { type, diceRoll, modifier: outcomeModifier, finalRoll, description: entry.description };

		const redirect = type === "benefit"
			? REROLL_AS_MISHAP.test(entry.description)
			: REROLL_AS_BENEFIT.test(entry.description);
		if (!redirect || hop === 3) return result;
		type = type === "benefit" ? "mishap" : "benefit";
	}
	return result;
}

/**
 * Execute expanded carousing rolls for all participants
 * Uses d8 for outcome table, then d100 for benefits/mishaps
 */
async function executeExpandedCarousingRolls(session, tier, participants) {
	const results = {};
	const chatContent = [];

	// Cost is shared among all participants
	const participantCount = participants.length;
	const costPerPerson = Math.ceil(tier.cost / participantCount);

	chatContent.push(`
        <div class="sdx-carousing-header">
            <h2><i class="fas fa-beer"></i> Carousing <span class="sdx-carousing-mode-tag">Expanded</span></h2>
            <div class="sdx-carousing-cost"><strong>Total Cost:</strong> ${tier.cost} GP (${costPerPerson} GP each for ${participantCount} participant${participantCount > 1 ? "s" : ""})</div>
        </div>
    `);

	for (const participant of participants) {
		const actor = participant.droppedActor;
		if (!actor) continue;

		// Announce that we are rolling for this player
		broadcastRollAnnouncement(participant.droppedActorName || actor.name);

		// Deduct shared cost from each participant
		await deductCoins(actor, costPerPerson);

		// Get actor's renown bonus for the carousing event roll
		const renown = getActorRenown(actor);
		const renownBonus = getRenownBonus(renown);

		// Get custom GM modifiers for this player
		const playerMods = session.modifiers?.[participant.participantId] || {};
		const outcomeMod = playerMods.outcome ? ` + ${playerMods.outcome}` : "";

		// Roll 1d8 + tier bonus + renown bonus + custom modifier for outcome table
		const outcomeRoll = await new Roll(`1d8 + ${tier.bonus} + ${renownBonus}${outcomeMod}`).evaluate();

		// Show 3D dice animation with black dice for outcome
		await showDSNRoll(outcomeRoll, "outcome");

		const outcomeDice = outcomeRoll.dice[0]?.total || outcomeRoll.total;
		const outcomeTotal = outcomeRoll.total;
		const outcome = getExpandedOutcome(outcomeTotal);

		// Apply XP
		const currentXp = actor.system?.level?.xp || 0;
		await actor.update({ "system.level.xp": currentXp + outcome.xp });

		// Roll for benefits and mishaps. rollExpandedD100 handles the special
		// "re-roll this benefit as a mishap" (and vice-versa) rows, so a roll
		// may land in the opposite list from the one that triggered it.
		const benefitResults = [];
		const mishapResults = [];
		for (let i = 0; i < outcome.benefits; i++) {
			const r = await rollExpandedD100("benefit", outcome.modifier, playerMods);
			r.renownDelta = await applyRenownDelta(actor, parseRenownDelta(r.description), r.description);
			(r.type === "benefit" ? benefitResults : mishapResults).push(r);
		}
		for (let i = 0; i < outcome.mishaps; i++) {
			const r = await rollExpandedD100("mishap", outcome.modifier, playerMods);
			r.renownDelta = await applyRenownDelta(actor, parseRenownDelta(r.description), r.description);
			(r.type === "mishap" ? mishapResults : benefitResults).push(r);
		}

		// Store result
		results[participant.participantId] = {
			outcomeRoll: outcomeTotal,
			diceRoll: outcomeDice,
			bonus: tier.bonus,
			xp: outcome.xp,
			benefits: benefitResults,
			mishaps: mishapResults,
		};

		// Build roll breakdown string for benefits/mishaps (shows modifier)
		const buildRollBreakdown = (r) => {
			// Show: diceRoll + modifier = final
			if (r.modifier === 0) {
				return `<span class="sdx-roll-dice">${r.diceRoll}</span> = <strong>${r.finalRoll}</strong>`;
			}
			const sign = r.modifier >= 0 ? "+" : "";
			return `<span class="sdx-roll-dice">${r.diceRoll}</span> <span class="sdx-roll-mod">${sign}${r.modifier}</span> = <strong>${r.finalRoll}</strong>`;
		};

		// Build outcome roll display (includes renown and custom mods if any)
		let outcomeFormula = `${outcomeDice} + ${tier.bonus}`;
		if (renownBonus !== 0) {
			outcomeFormula += ` <span class="sdx-roll-renown">+ ${renownBonus}</span>`;
		}
		if (playerMods.outcome) {
			outcomeFormula += ` <span class="sdx-roll-custom-mod">+ ${playerMods.outcome}</span>`;
		}
		outcomeFormula += ` = <strong>${outcomeTotal}</strong>`;

		// Build chat content for this player
		// Read visibility settings
		const showBenefitsToPlayers = game.settings.get(MODULE_ID, "carousingShowBenefitsToPlayers") ?? true;
		const showMishapsToPlayers = game.settings.get(MODULE_ID, "carousingShowMishapsToPlayers") ?? true;
		const hiddenText = game.i18n.localize("SHADOWDARK_EXTRAS.carousing.hidden_description");
		const esc = foundry.utils.escapeHTML ?? Handlebars.Utils.escapeExpression;

		let playerContent = `
            <div class="sdx-carousing-player">
                <div class="sdx-player-header">
                    <img src="${esc(actor.img ?? "")}" class="sdx-player-portrait">
                    <div class="sdx-player-info">
                        <strong class="sdx-player-name">${participant.isGmManaged ? participant.droppedActorName : participant.name}</strong>
                        <div class="sdx-outcome-roll">
                            <span class="sdx-roll-label">Outcome:</span>
                            <span class="sdx-roll-formula">${outcomeFormula}</span>
                        </div>
                    </div>
                    <div class="sdx-xp-badge">+${outcome.xp} XP</div>
                </div>`;

		// Add benefits
		if (benefitResults.length > 0) {
			playerContent += `<div class="sdx-results-section sdx-benefits-section">
                <div class="sdx-section-header sdx-benefit-header"><i class="fas fa-star"></i> Benefits (${benefitResults.length})</div>`;
			for (const b of benefitResults) {
				const renownNote = b.renownDelta
					? ` <span class="sdx-renown-applied">(${b.renownDelta > 0 ? "+" : ""}${b.renownDelta} renown applied)</span>` : "";
				// If benefits should be hidden from players, add both visible (GM) and hidden (player) versions
				const descHtml = showBenefitsToPlayers
					? `<div class="sdx-result-desc">${b.description}${renownNote}</div>`
					: `<div class="sdx-result-desc sdx-gm-only">${b.description}${renownNote}</div><div class="sdx-result-desc sdx-player-only">${hiddenText}</div>`;
				playerContent += `
                    <div class="sdx-result-row sdx-benefit-row">
                        <div class="sdx-roll-breakdown">${buildRollBreakdown(b)}</div>
                        ${descHtml}
                    </div>`;
			}
			playerContent += "</div>";
		}

		// Add mishaps
		if (mishapResults.length > 0) {
			playerContent += `<div class="sdx-results-section sdx-mishaps-section">
                <div class="sdx-section-header sdx-mishap-header"><i class="fas fa-skull"></i> Mishaps (${mishapResults.length})</div>`;
			for (const m of mishapResults) {
				const renownNote = m.renownDelta
					? ` <span class="sdx-renown-applied">(${m.renownDelta > 0 ? "+" : ""}${m.renownDelta} renown applied)</span>` : "";
				// If mishaps should be hidden from players, add both visible (GM) and hidden (player) versions
				const descHtml = showMishapsToPlayers
					? `<div class="sdx-result-desc">${m.description}${renownNote}</div>`
					: `<div class="sdx-result-desc sdx-gm-only">${m.description}${renownNote}</div><div class="sdx-result-desc sdx-player-only">${hiddenText}</div>`;
				playerContent += `
                    <div class="sdx-result-row sdx-mishap-row">
                        <div class="sdx-roll-breakdown">${buildRollBreakdown(m)}</div>
                        ${descHtml}
                    </div>`;
			}
			playerContent += "</div>";
		}

		if (benefitResults.length === 0 && mishapResults.length === 0) {
			playerContent += "<div class=\"sdx-no-results\"><em>No benefits or mishaps this time.</em></div>";
		}

		playerContent += "</div>";
		chatContent.push(playerContent);
	}

	// Save results and create a stable journal-page key for this session.
	session.results = results;
	session.phase = "complete";
	session.logId = foundry.utils.randomID();
	session.logMeta = {
		date: new Date().toLocaleString(),
		tierDescription: tier.description || "",
		tierCost: tier.cost || 0,
		costPerPerson,
	};
	await applyExpandedCarousingNotes(session);
	await saveCarousingSession(session, { replaceResults: true });
	await writeCarousingLogPage(session);

	// Send chat message
	await ChatMessage.create({
		content: `<div class="sdx-carousing-chat sdx-expanded-carousing">${chatContent.join("")}</div>`,
		speaker: { alias: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.title") },
	});

	ui.notifications.info(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.rolls_complete"));
}

// ============================================
// ROLL AND OUTCOME LOGIC
// ============================================

/**
 * Get outcome for a roll result from a given outcomes array
 * Handles new format: roll can be "1", "2", "14+" etc.
 */
function getOutcome(rollTotal, outcomes) {
	for (const outcome of outcomes) {
		const rollStr = String(outcome.roll || "");

		// Handle "N+" format (e.g., "14+")
		if (rollStr.endsWith("+")) {
			const minRoll = parseInt(rollStr);
			if (!isNaN(minRoll) && rollTotal >= minRoll) {
				return outcome;
			}
		}
		else {
			// Exact match
			const exactRoll = parseInt(rollStr);
			if (!isNaN(exactRoll) && rollTotal === exactRoll) {
				return outcome;
			}
		}
	}
	// Default to last outcome for unmatched rolls
	return outcomes[outcomes.length - 1];
}

/**
 * Execute carousing rolls for all participants (GM only)
 */
export async function executeCarousingRolls() {
	if (!game.user.isGM) return;

	const journal = getCarousingJournal();
	if (!journal) {
		console.error(`${MODULE_ID} | Carousing journal not found!`);
		return;
	}

	// Pull fresh data from any linked Foundry RollTables before rolling
	await refreshLinkedCarousingTables();

	const session = getCarousingSession();
	const drops = getCarousingDrops();

	// Get the correct table based on mode
	const mode = getCarousingMode();
	const activeTable = mode === "expanded"
		? getExpandedCarousingData()
		: getCarousingTableById(session.selectedTableId);

	if (session.selectedTier === null) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.no_tier_selected"));
		return;
	}

	const tier = activeTable.tiers[session.selectedTier];
	const participants = getParticipants();

	// Check all participants are confirmed
	const unconfirmed = participants.filter(p => !p.isConfirmed);
	if (unconfirmed.length > 0) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.not_all_confirmed"));
		return;
	}

	// Check all participants can afford
	const cantAfford = participants.filter(p => !p.canAfford);
	if (cantAfford.length > 0) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.some_cannot_afford"));
		return;
	}

	if (participants.length === 0) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.no_participants"));
		return;
	}

	// Set phase to rolling
	session.phase = "rolling";
	session.results = {};

	// Branch based on carousing mode
	if (mode === "expanded") {
		await executeExpandedCarousingRolls(session, tier, participants);
		return;
	}

	// === ORIGINAL MODE LOGIC ===
	// Process each participant
	const results = {};
	const chatContent = [];

	// Cost is shared among all participants
	const participantCount = participants.length;
	const costPerPerson = Math.ceil(tier.cost / participantCount);

	chatContent.push(`
        <div class="sdx-carousing-header">
            <h2><i class="fas fa-beer"></i> Carousing <span class="sdx-carousing-mode-tag">Original</span></h2>
            <div class="sdx-carousing-cost"><strong>Total Cost:</strong> ${tier.cost} GP (${costPerPerson} GP each for ${participantCount} participant${participantCount > 1 ? "s" : ""})</div>
        </div>
    `);

	for (const participant of participants) {
		const actor = participant.droppedActor;
		if (!actor) continue;

		// Announce that we are rolling for this player
		broadcastRollAnnouncement(participant.droppedActorName || actor.name);

		// Deduct shared cost from each participant
		await deductCoins(actor, costPerPerson);

		// Get custom GM modifiers for this player
		const playerMods = session.modifiers?.[participant.participantId] || {};
		const outcomeMod = playerMods.outcome ? ` + ${playerMods.outcome}` : "";

		// Roll 1d8 + bonus + custom modifier
		const roll = await new Roll(`1d8 + ${tier.bonus}${outcomeMod}`).evaluate();

		// Show 3D dice animation with black dice for outcome
		await showDSNRoll(roll, "outcome");

		const diceResult = roll.dice[0]?.total || roll.total;
		const rollTotal = roll.total;
		const outcome = getOutcome(rollTotal, activeTable.outcomes);

		// Store result (simplified - no XP or effects applied)
		results[participant.participantId] = {
			roll: rollTotal,
			diceRoll: diceResult,
			bonus: tier.bonus,
			description: outcome?.description || "",
			benefit: outcome?.benefit || "",
		};

		// Read visibility settings (use benefit setting for original mode outcomes)
		const showBenefitsToPlayers = game.settings.get(MODULE_ID, "carousingShowBenefitsToPlayers") ?? true;
		const hiddenText = game.i18n.localize("SHADOWDARK_EXTRAS.carousing.hidden_description");
		const esc = foundry.utils.escapeHTML ?? Handlebars.Utils.escapeExpression;

		// Build description HTML based on visibility setting
		const descHtml = showBenefitsToPlayers
			? `<div class="sdx-outcome-desc">${outcome?.description || ""}</div>`
			: `<div class="sdx-outcome-desc sdx-gm-only">${outcome?.description || ""}</div><div class="sdx-outcome-desc sdx-player-only">${hiddenText}</div>`;

		// Build benefit HTML based on visibility setting
		let benefitHtml = "";
		if (outcome?.benefit) {
			benefitHtml = showBenefitsToPlayers
				? `<div class="sdx-outcome-benefit"><i class="fas fa-star"></i> ${outcome.benefit}</div>`
				: `<div class="sdx-outcome-benefit sdx-gm-only"><i class="fas fa-star"></i> ${outcome.benefit}</div><div class="sdx-outcome-benefit sdx-player-only"><i class="fas fa-star"></i> ${hiddenText}</div>`;
		}

		chatContent.push(`
            <div class="sdx-carousing-player">
                <div class="sdx-player-header">
                    <img src="${esc(actor.img ?? "")}" class="sdx-player-portrait">
                    <div class="sdx-player-info">
                        <strong class="sdx-player-name">${participant.isGmManaged ? participant.droppedActorName : participant.name}</strong>
                        <div class="sdx-outcome-roll">
                            <span class="sdx-roll-label">Roll:</span>
                            <span class="sdx-roll-formula">${diceResult} + ${tier.bonus}${playerMods.outcome ? ` + ${playerMods.outcome}` : ""} = <strong>${rollTotal}</strong></span>
                        </div>
                    </div>
                </div>
                ${descHtml}
                ${benefitHtml}
            </div>
        `);
	}

	// Save results. A fresh logId per roll gives the log journal a stable key
	// to create-or-update against, so re-rolling never duplicates a page.
	session.results = results;
	session.phase = "complete";
	session.logId = foundry.utils.randomID();
	session.logMeta = {
		date: new Date().toLocaleString(),
		tierDescription: tier.description || "",
		tierCost: tier.cost || 0,
		costPerPerson,
	};
	await saveCarousingSession(session, { replaceResults: true });
	await writeCarousingLogPage(session);

	// Send chat message
	await ChatMessage.create({
		content: `<div class="sdx-carousing-chat sdx-original-carousing">${chatContent.join("")}</div>`,
		speaker: { alias: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.title") },
	});

	ui.notifications.info(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.rolls_complete"));
}

/**
 * Deduct coins from actor (prioritize GP, then SP, then CP)
 */
async function deductCoins(actor, gpAmount) {
	await deductCoinsCp(actor, (Number(gpAmount) || 0) * CP_PER_GP);
}

// ============================================
// OUTCOME EFFECT PARSING AND APPLICATION
// ============================================

/** "Gain 4 XP", "4 XP", "+4 XP". */
const XP_GRANT = /([+-]?\d+)\s*XP\b/i;

/** "a luck token", "2 luck tokens". */
const LUCK_TOKEN = /\b(?:(\d+)|an?|one)\s+luck\s+tokens?\b/i;

/** "5% of your total wealth". */
const WEALTH_PERCENT = /(\d+)\s*%\s*of\s+(?:your|their|his|her|the)\s+total\s+wealth/i;

/**
 * Verbs that would make a wealth percentage a gain rather than a loss. Tested
 * only against the text immediately preceding the percentage, and only within
 * the same column, so a "Gain 4 XP" sitting in the Benefit column can never be
 * mistaken for the verb governing a percentage in the What Happened column.
 */
const WEALTH_GAIN = /\b(?:gain|earn|win|won|recover|receive|find|found)\w*\b/i;

/** How far back to look for that verb. */
const WEALTH_VERB_WINDOW = 24;

/**
 * Extract the mechanical effects described by an outcome's text.
 *
 * Narrative rewards — a priest ally, a debt owed by a noble, being barred from
 * a tavern — have no mechanical target in Shadowdark and are deliberately not
 * parsed. The full outcome text is recorded on the character's Notes instead,
 * so nothing the GM authored is lost.
 *
 * @param {string} description - the "What Happened" column
 * @param {string} benefit - the "Benefit" column
 * @returns {{xp: number, luck: number, wealthPercent: number, renown: number}}
 */
export function parseOutcomeEffects(description = "", benefit = "") {
	const desc = String(description || "");
	const ben = String(benefit || "");
	const combined = [desc, ben].filter(Boolean).join(" ");

	const xpMatch = combined.match(XP_GRANT);
	const luckMatch = combined.match(LUCK_TOKEN);

	let wealthPercent = 0;
	for (const field of [desc, ben]) {
		const m = field.match(WEALTH_PERCENT);
		if (!m) continue;
		const before = field.slice(Math.max(0, m.index - WEALTH_VERB_WINDOW), m.index);
		if (WEALTH_GAIN.test(before)) continue;
		wealthPercent = parseInt(m[1]) || 0;
		break;
	}

	return {
		xp: xpMatch ? (parseInt(xpMatch[1]) || 0) : 0,
		luck: luckMatch ? (luckMatch[1] ? (parseInt(luckMatch[1]) || 0) : 1) : 0,
		wealthPercent,
		renown: parseRenownDelta(combined),
	};
}

/** True when an outcome has anything mechanical to write to a sheet. */
export function hasOutcomeEffects(effects) {
	return !!(effects && (effects.xp || effects.luck || effects.wealthPercent || effects.renown));
}

/** The configured wealth base: "coins" or "coinsAndGear". */
export function getCarousingWealthBaseMode() {
	try {
		return game.settings.get(MODULE_ID, "carousingWealthBase") || "coins";
	}
	catch {
		return "coins";
	}
}

/**
 * The copper figure a "% of total wealth" loss is measured against, per the
 * carousingWealthBase setting. The loss itself always comes out of coins —
 * including gear only widens the base so stockpiling equipment cannot dodge
 * the penalty.
 * @returns {number} copper
 */
export function getCarousingWealthBaseCp(actor) {
	const coins = getActorCoinsCp(actor);
	return getCarousingWealthBaseMode() === "coinsAndGear"
		? coins + getActorGearValueCp(actor)
		: coins;
}

/**
 * Coin and total-wealth figures for display on a participant card.
 * @returns {{coinsCp: number, gearCp: number, totalCp: number, coinsLabel: string, totalLabel: string}}
 */
export function getActorWealthDisplay(actor) {
	const coinsCp = getActorCoinsCp(actor);
	const gearCp = getActorGearValueCp(actor);
	return {
		coinsCp,
		gearCp,
		totalCp: coinsCp + gearCp,
		coinsLabel: formatCoins(coinsCp),
		totalLabel: formatCoins(coinsCp + gearCp),
	};
}

/**
 * Describe what applying an outcome would do, without changing anything.
 * Used for the confirm dialog and the log, so the GM sees the exact numbers
 * before committing an irreversible write.
 * @returns {{lines: string[], effects: Object, wealthLossCp: number, wealthShortfallCp: number}}
 */
export function previewOutcomeEffects(actor, description, benefit) {
	const effects = parseOutcomeEffects(description, benefit);
	const lines = [];

	if (effects.xp) lines.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_xp", { amount: effects.xp }));
	if (effects.luck) lines.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_luck", { amount: effects.luck }));

	// Computed and capped in copper so the change is not rounded away, and so
	// a percentage of a gear-inflated base can never drive the purse negative.
	let wealthLossCp = 0;
	let wealthShortfallCp = 0;
	if (effects.wealthPercent && actor) {
		const intended = Math.round(getCarousingWealthBaseCp(actor) * effects.wealthPercent / 100);
		const purse = getActorCoinsCp(actor);
		wealthLossCp = Math.min(intended, purse);
		wealthShortfallCp = intended - wealthLossCp;
		lines.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_wealth", {
			percent: effects.wealthPercent, amount: formatCoins(wealthLossCp),
		}));
		if (wealthShortfallCp > 0) {
			lines.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_wealth_short", {
				amount: formatCoins(wealthLossCp),
			}));
			lines.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_debt", {
				amount: formatCoins(wealthShortfallCp),
			}));
		}
	}

	if (effects.renown) {
		lines.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_renown", {
			delta: effects.renown > 0 ? `+${effects.renown}` : String(effects.renown),
		}));
	}

	lines.push(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.effect_note"));
	return { lines, effects, wealthLossCp, wealthShortfallCp };
}

/**
 * Append a carousing entry to an actor's Notes, preserving whatever is there.
 * This is how narrative rewards (allies, debts, reputations) reach the sheet —
 * verbatim, for the GM and player to interpret.
 */
async function appendCarousingNote(actor, description, benefit, appliedSummary, entryId = "") {
	const esc = foundry.utils.escapeHTML ?? Handlebars.Utils.escapeExpression;
	const heading = game.i18n.localize("SHADOWDARK_EXTRAS.carousing.note_heading");
	const date = new Date().toLocaleDateString();

	const parts = [description, benefit].filter(Boolean).map(t => esc(t)).join(" — ");
	const applied = appliedSummary ? ` <em>(${esc(appliedSummary)})</em>` : "";
	const existing = actor.system?.notes || "";
	const marker = entryId ? ` data-sdx-carousing-id="${esc(entryId)}"` : "";
	if (marker && existing.includes(marker.trim())) return false;
	const entry = `<p${marker}><strong>${esc(heading)}</strong> — ${esc(date)}: ${parts}${applied}</p>`;
	await actor.update({ "system.notes": existing ? `${existing}\n${entry}` : entry });
	return true;
}

/** Build the human-readable sheet note for an Expanded-mode result. */
export function buildExpandedCarousingNote(result, {
	showBenefits = true,
	showMishaps = true,
	labels = {},
} = {}) {
	const benefits = showBenefits
		? (result?.benefits || []).map(entry => entry?.description || "").filter(Boolean)
		: [];
	const mishaps = showMishaps
		? (result?.mishaps || []).map(entry => entry?.description || "").filter(Boolean)
		: [];
	const sections = [];
	if (benefits.length) {
		sections.push(`${labels.benefits || "Benefits"}: ${benefits.join("; ")}`);
	}
	if (mishaps.length) {
		sections.push(`${labels.mishaps || "Mishaps"}: ${mishaps.join("; ")}`);
	}

	const summary = [labels.xp || `+${result?.xp ?? 0} XP`];
	const renown = [...(result?.benefits || []), ...(result?.mishaps || [])]
		.reduce((total, entry) => total + (Number(entry?.renownDelta) || 0), 0);
	if (renown) {
		summary.push(
			labels.renown
            || `${renown > 0 ? "+" : ""}${renown} renown`
		);
	}

	return {
		description: sections.join(" — ")
            || labels.noVisibleOutcomes
            || "No visible benefits or mishaps",
		summary: summary.join(", "),
	};
}

/**
 * Append missing Expanded-mode results to participant sheets exactly once.
 * Sheet Notes are player-visible, so hidden descriptions must stay out of them
 * just as they stay out of the player-facing portion of the chat card.
 */
async function applyExpandedCarousingNotes(session) {
	const showBenefits = game.settings.get(
		MODULE_ID,
		"carousingShowBenefitsToPlayers"
	) ?? true;
	const showMishaps = game.settings.get(
		MODULE_ID,
		"carousingShowMishapsToPlayers"
	) ?? true;
	const labels = {
		benefits: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.benefits"),
		mishaps: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.mishaps"),
		noVisibleOutcomes: game.i18n.localize(
			"SHADOWDARK_EXTRAS.carousing.note_no_visible_outcomes"
		),
	};
	let changed = false;
	for (const [participantId, result] of Object.entries(session?.results || {})) {
		const expanded = Array.isArray(result.benefits) || Array.isArray(result.mishaps);
		if (!expanded || result.noteApplied) continue;
		const actor = getParticipantActor(participantId);
		if (!actor) continue;

		const renown = [...(result?.benefits || []), ...(result?.mishaps || [])]
			.reduce(
				(total, entry) => total + (Number(entry?.renownDelta) || 0),
				0
			);
		const note = buildExpandedCarousingNote(result, {
			showBenefits,
			showMishaps,
			labels: {
				...labels,
				xp: game.i18n.format(
					"SHADOWDARK_EXTRAS.carousing.effect_xp",
					{ amount: result?.xp ?? 0 }
				),
				renown: game.i18n.format(
					"SHADOWDARK_EXTRAS.carousing.effect_renown",
					{ delta: renown > 0 ? `+${renown}` : String(renown) }
				),
			},
		});
		await appendCarousingNote(actor, note.description, "", note.summary, `${session.logId}:${participantId}`);
		result.noteApplied = { at: Date.now(), actorName: actor.name };
		changed = true;
	}
	return changed;
}

/**
 * Apply an Original-mode carousing outcome to the participant's character.
 * Idempotent: the session records what was applied, so a second click is a
 * no-op rather than a double grant.
 * @param {string} participantId
 * @returns {Promise<{name: string, summary: string}|null>} null if nothing was applied
 */
export async function applyCarousingOutcome(participantId) {
	if (!game.user.isGM) return null;

	const session = getCarousingSession();
	const result = session.results?.[participantId];
	if (!result || result.applied) return null;

	const actor = getParticipantActor(participantId);
	if (!actor) {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.apply_no_actor"));
		return null;
	}

	const { effects, wealthLossCp, wealthShortfallCp } = previewOutcomeEffects(actor, result.description, result.benefit);
	const summaryParts = [];

	if (effects.xp) {
		const currentXp = actor.system?.level?.xp || 0;
		await actor.update({ "system.level.xp": currentXp + effects.xp });
		summaryParts.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_xp", { amount: effects.xp }));
	}

	if (effects.luck) {
		const currentLuck = actor.system?.luck?.remaining ?? 0;
		await actor.update({ "system.luck.remaining": currentLuck + effects.luck });
		summaryParts.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_luck", { amount: effects.luck }));
	}

	if (wealthLossCp > 0) {
		const taken = await deductCoinsCp(actor, wealthLossCp);
		summaryParts.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_wealth", {
			percent: effects.wealthPercent, amount: formatCoins(taken),
		}));
	}

	if (wealthShortfallCp > 0) {
		await recordCarousingDebt(actor, wealthShortfallCp, [result.description, result.benefit].filter(Boolean).join(" — "));
		summaryParts.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_debt", {
			amount: formatCoins(wealthShortfallCp),
		}));
	}

	if (effects.renown) {
		const applied = await applyRenownDelta(
			actor,
			effects.renown,
			[result.description, result.benefit].filter(Boolean).join(" — ")
		);
		if (applied) {
			summaryParts.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_renown", {
				delta: applied > 0 ? `+${applied}` : String(applied),
			}));
		}
	}

	const summary = summaryParts.join(", ");
	await appendCarousingNote(actor, result.description, result.benefit, summary);

	// Record on the session so the button locks and the log can show it.
	session.results[participantId] = {
		...result,
		applied: { at: Date.now(), summary, actorName: actor.name },
	};
	await saveCarousingSession(session);
	await writeCarousingLogPage(session);

	return { name: actor.name, summary };
}

// ============================================
// CAROUSING LOG JOURNAL
// ============================================

/**
 * The readable log of carousing sessions. Distinct from the hidden
 * __sdx_carousing_sync__ journal, which only holds transient sync state — this
 * one is a normal journal the GM can browse, created GM-only so outcomes hidden
 * by the show-benefits/mishaps settings are not leaked through the sidebar.
 * Located by flag rather than by name so renaming it does not orphan the log.
 */
async function getOrCreateCarousingLogJournal() {
	let journal = game.journal.find(j => j.getFlag(MODULE_ID, "isCarousingLog"));
	if (journal) return journal;

	return JournalEntry.create({
		name: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.log_journal_name"),
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
		flags: { [MODULE_ID]: { isCarousingLog: true } },
	});
}

/**
 * Normalize original and expanded result shapes for the shared journal table.
 * Kept pure so both formats remain regression-testable outside Foundry.
 */
export function normalizeCarousingLogResults(session, resolveActorName = () => "?") {
	return Object.entries(session?.results || {}).map(([participantId, result]) => {
		const expanded = Array.isArray(result.benefits) || Array.isArray(result.mishaps);
		const benefits = expanded
			? (result.benefits || []).map(entry => entry?.description || "").filter(Boolean)
			: [result.benefit || ""].filter(Boolean);
		const mishaps = expanded
			? (result.mishaps || []).map(entry => entry?.description || "").filter(Boolean)
			: [];

		return {
			name: result.applied?.actorName || resolveActorName(participantId) || "?",
			roll: expanded ? (result.outcomeRoll ?? "") : (result.roll ?? ""),
			outcome: expanded ? `${result.xp ?? 0} XP` : (result.description || ""),
			benefits,
			mishaps,
			applied: result.applied?.summary || "",
			appliedState: expanded
				? "automatic"
				: result.applied
					? "applied"
					: "pending",
		};
	});
}

/**
 * Create or refresh the log page for a session. Called when rolls complete and
 * again each time results are applied, so the page always reflects current
 * state rather than accumulating duplicates.
 */
export async function writeCarousingLogPage(session) {
	if (!game.user.isGM) return;
	if (!session?.logId || !Object.keys(session.results || {}).length) return;

	const journal = await getOrCreateCarousingLogJournal();
	if (!journal) return;

	const esc = Handlebars.Utils.escapeExpression;
	const meta = session.logMeta || {};

	const rows = normalizeCarousingLogResults(session, pid => getParticipantActor(pid)?.name).map(entry => {
		let applied;
		if (entry.appliedState === "automatic") {
			applied = esc(
				game.i18n.localize(
					"SHADOWDARK_EXTRAS.carousing.log_automatic"
				)
			);
		}
		else if (entry.applied) {
			applied = esc(entry.applied);
		}
		else if (entry.appliedState === "applied") {
			applied = esc(
				game.i18n.localize("SHADOWDARK_EXTRAS.carousing.log_applied")
			);
		}
		else {
			applied = `<em>${esc(game.i18n.localize(
				"SHADOWDARK_EXTRAS.carousing.log_not_applied"
			))}</em>`;
		}
		const benefits = entry.benefits.map(esc).join("<br>");
		const mishaps = entry.mishaps.map(esc).join("<br>");
		return `<tr>
            <td><strong>${esc(entry.name)}</strong></td>
            <td style="text-align:center">${esc(String(entry.roll))}</td>
            <td>${esc(entry.outcome)}</td>
            <td>${benefits}</td>
            <td>${mishaps}</td>
            <td>${applied}</td>
        </tr>`;
	}).join("");

	const header = meta.tierDescription
		? `<p><em>${esc(meta.tierDescription)}</em><br>${esc(String(meta.tierCost ?? 0))} GP total — ${esc(String(meta.costPerPerson ?? 0))} GP each</p>`
		: "";

	const content = `
        ${header}
        <table>
            <thead><tr><th>Character</th><th>Roll</th><th>Outcome</th><th>Benefits</th><th>Mishaps</th><th>Applied</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;

	const title = game.i18n.format("SHADOWDARK_EXTRAS.carousing.log_session_title", {
		date: meta.date || new Date().toLocaleString(),
	});

	const existing = journal.pages.find(p => p.getFlag(MODULE_ID, "logId") === session.logId);
	if (existing) {
		await existing.update({ "text.content": content });
	}
	else {
		await JournalEntryPage.create({
			name: title,
			type: "text",
			text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
			flags: { [MODULE_ID]: { logId: session.logId } },
		}, { parent: journal });
	}
}

/** Open the carousing log journal, creating it if this world has none yet. */
export async function openCarousingLog() {
	if (!game.user.isGM) return;
	const session = getCarousingSession();
	if (Object.keys(session.results || {}).length) {
		let sessionChanged = false;
		if (!session.logId) {
			session.logId = foundry.utils.randomID();
			sessionChanged = true;
		}
		if (!session.logMeta) {
			const table = getCarousingMode() === "expanded"
				? getExpandedCarousingData()
				: getCarousingTableById(session.selectedTableId);
			const tier = table?.tiers?.[session.selectedTier] || {};
			const participantCount = Object.keys(session.results).length;
			session.logMeta = {
				date: new Date().toLocaleString(),
				tierDescription: tier.description || "",
				tierCost: tier.cost || 0,
				costPerPerson: Math.ceil((tier.cost || 0) / Math.max(1, participantCount)),
			};
			sessionChanged = true;
		}
		const notesChanged = await applyExpandedCarousingNotes(session);
		if (sessionChanged || notesChanged) await saveCarousingSession(session);
		await writeCarousingLogPage(session);
	}
	const journal = await getOrCreateCarousingLogJournal();
	journal?.sheet?.render(true);
}

// ============================================
// SOCKET AND SYNC
// ============================================

/**
 * Initialize the carousing journal update hook
 */
export function initCarousingSocket() {
	Hooks.on("updateJournalEntry", (journal, changes, options, userId) => {
		const carousingJournal = getCarousingJournal();
		if (!carousingJournal || journal.id !== carousingJournal.id) return;

		const flagChanges = changes?.flags?.[MODULE_ID];
		if (!flagChanges) return;

		// Re-render if drops or session changed. ForcedDeletion sentinel
		// appears as a defined value under the actual key (not a "-=" prefix),
		// so this check catches both normal updates and deletions.
		const hasCarousingChange =
            flagChanges.carousingDrops !== undefined ||
            flagChanges.carousingGmActors !== undefined ||
            flagChanges.carousingSession !== undefined;

		if (hasCarousingChange) {
			rerenderPlayerSheets();
		}
	});

	// Listen for carousing toast notifications from other clients
	game.socket.on(`module.${MODULE_ID}`, (data) => {
		// Handle carousing toast messages from other users
		if (data.type === "carousing-toast" && data.senderId !== game.user.id) {
			_showCarousingToast(data.message, data.toastType);
		}

		// Handle roll announcement events during GM rolling
		if (data.type === "carousing-roll-announce") {
			_showRollAnnouncement(data.message);
		}
	});

	console.log(`${MODULE_ID} | Carousing sync initialized (journal-based)`);
}

/**
 * Show a carousing toast notification locally
 * @param {string} message - The message to display
 * @param {string} type - "benefit", "mishap", or "remove"
 */
function _showCarousingToast(message, type) {
	let container = document.querySelector(".sdx-carousing-toast-container-global");
	if (!container) {
		container = document.createElement("div");
		container.className = "sdx-carousing-toast-container-global";
		document.body.appendChild(container);
	}

	const toast = document.createElement("div");
	toast.className = `sdx-carousing-toast sdx-toast-${type}`;
	toast.innerHTML = `
        <i class="fas ${type === "benefit" ? "fa-star" : type === "mishap" ? "fa-skull" : "fa-times"}"></i>
        <span>${message}</span>
    `;

	container.appendChild(toast);

	setTimeout(() => {
		toast.classList.add("sdx-toast-fade-out");
		setTimeout(() => toast.remove(), 500);
	}, 3000);
}

/**
 * Re-render all open player sheets and the carousing overlay
 */
export function rerenderPlayerSheets() {
	// Refresh the full-screen overlay if open
	if (window.sdxCarousingOverlayRefresh) {
		window.sdxCarousingOverlayRefresh();
	}

	// Also refresh any old-style player sheets with carousing tabs
	Object.values(ui.windows).forEach(app => {
		if (app.actor?.type === "Player" && app.element?.find) {
			if (app.element.find(".tab-carousing").length > 0) {
				app.render(false);
			}
		}
	});
}

// ============================================
// TAB INJECTION
// ============================================

/**
 * Inject the Carousing button into player character sheets
 * Shows a "tongue" button on the side that opens the full-screen overlay
 */
export async function injectCarousingButton(app, html, actor) {
	try {
		if (!game.settings.get(MODULE_ID, "enableCarousing")) return;
	}
	catch {
		return;
	}

	if (actor.type !== "Player") return;

	// Dedup: Remove existing if present
	// app.element is the window app, find the button inside it
	app.element.find(".sdx-carousing-toggle-btn").remove();

	// Create the button
	const buttonHtml = `
        <div class="sdx-carousing-toggle-btn" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.carousing.title")}">
            <i class="fas fa-beer"></i>
        </div>
    `;

	// Append to the window app wrapper, after the header
	// We use app.element because 'html' in the hook might be just the form content
	const header = app.element.find(".window-header");

	if (header.length > 0) {
		// Remove any existing buttons first (just in case they are in the new location)
		app.element.children(".sdx-carousing-toggle-btn").remove();

		header.after(buttonHtml);

		// Add listener
		app.element.find(".sdx-carousing-toggle-btn").click((event) => {
			event.preventDefault();
			event.stopPropagation();
			if (window.sdxOpenCarousingOverlay) {
				window.sdxOpenCarousingOverlay();
			}
		});
	}
}

/**
 * Activate event listeners for the carousing tab
 */
function activateCarousingListeners(html, actor, app) {
	const carousingSection = html.find(".tab-carousing");
	if (carousingSection.length === 0) return;

	// GM: Table selection
	carousingSection.find('[data-action="select-table"]').change(async (event) => {
		if (!game.user.isGM) return;
		const tableId = event.target.value || "default";
		await setCarousingTable(tableId);
	});

	// GM: Tier selection
	carousingSection.find('[data-action="select-tier"]').change(async (event) => {
		if (!game.user.isGM) return;
		const val = event.target.value;
		const tierIndex = val === "" ? null : parseInt(val);
		await setCarousingTier(tierIndex);
	});

	// GM: Roll button
	carousingSection.find('[data-action="roll-carousing"]').click(async (event) => {
		event.preventDefault();
		if (!game.user.isGM) return;
		await executeCarousingRolls();
	});

	// GM: Reset button
	carousingSection.find('[data-action="reset-carousing"]').click(async (event) => {
		event.preventDefault();
		if (!game.user.isGM) return;
		await resetCarousingSession();
	});

	// Player: Confirm button
	carousingSection.find('[data-action="confirm-carousing"]').click(async (event) => {
		event.preventDefault();
		const userId = $(event.currentTarget).data("user-id");
		if (userId !== game.user.id) return;
		await setPlayerConfirmation(userId, true);
	});

	// Player: Unconfirm button
	carousingSection.find('[data-action="unconfirm-carousing"]').click(async (event) => {
		event.preventDefault();
		const userId = $(event.currentTarget).data("user-id");
		if (userId !== game.user.id) return;
		await setPlayerConfirmation(userId, false);
	});

	// Drag & drop for dropboxes
	carousingSection.find(".sdx-carousing-dropbox-content").each((i, element) => {
		const $dropbox = $(element);
		const userId = $dropbox.data("user-id");

		if (userId !== game.user.id) return;

		element.addEventListener("dragover", (event) => {
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			$dropbox.addClass("sdx-carousing-dropbox-hover");
		});

		element.addEventListener("dragleave", (event) => {
			$dropbox.removeClass("sdx-carousing-dropbox-hover");
		});

		element.addEventListener("drop", async (event) => {
			event.preventDefault();
			$dropbox.removeClass("sdx-carousing-dropbox-hover");

			let data;
			try {
				data = JSON.parse(event.dataTransfer.getData("text/plain"));
			}
			catch (e) {
				return;
			}

			if (data.type !== "Actor") return;

			const droppedActor = await fromUuid(data.uuid);
			if (!droppedActor) return;

			if (droppedActor.type !== "Player") {
				ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.only_players"));
				return;
			}

			await setCarousingDrop(userId, droppedActor.id);
		});
	});

	// Clear button
	carousingSection.find('[data-action="clear-carousing-drop"]').click(async (event) => {
		event.preventDefault();
		const userId = $(event.currentTarget).data("user-id");
		if (userId !== game.user.id) return;
		await setCarousingDrop(userId, null);
	});
}


// Full public surface preserved (Phase 5.1 split re-exports).
export { getCarousingMode, getActiveCarousingTiers, getExpandedOutcome, getExpandedBenefit, getExpandedMishap, getDefaultExpandedData, getExpandedCarousingTables, saveExpandedCarousingTables, getExpandedCarousingData, saveExpandedCarousingData, refreshLinkedCarousingTables, initCarousing } from "./carousing-core.mjs";
export { getCarousingJournal, getCarousingTablesJournal, saveCarousingDrops, saveCarousingSession };
export { ensureCarousingJournal, ensureCarousingTablesJournal, getCustomCarousingTables, saveCustomCarousingTables, getCarousingTableById, getCarousingGmActors, getCarousingDrops, getCarousingSession, setCarousingDrop, setCarousingTier, setCarousingTable, setPlayerConfirmation, setPlayerModifier, addGmParticipant, removeGmParticipant, resetCarousingSession, addCarousingResult, removeCarousingResult, pruneOfflineCarousingData } from "./carousing-core.mjs";
