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
// Extracted in the Phase 5.3 split. Each import carries both the names this
// module still calls and the ones it used to export, which are re-exported
// from the block at the foot of the file — so the public surface, and every
// import site, is unchanged.
import {
	CP_PER_GP, deductCoins, deductCoinsCp, formatCoins, getActorCoinsCp, getActorTotalGp,
	getActorWealthDisplay, getCarousingWealthBaseCp, getCarousingWealthBaseMode,
	recordCarousingDebt,
} from "./carousing-wealth.mjs";
import {
	REROLL_AS_BENEFIT, REROLL_AS_MISHAP, applyRenownDelta, getActorRenown, getRenownBonus,
	migrateLegacyRenown, parseRenownDelta,
} from "./carousing-renown.mjs";
import {
	appendCarousingNote, applyExpandedCarousingNotes, buildExpandedCarousingNote,
	getParticipantActor,
} from "./carousing-notes.mjs";
import {
	normalizeCarousingLogResults, openCarousingLog, writeCarousingLogPage,
} from "./carousing-log.mjs";
import {
	broadcastRollAnnouncement, initCarousingSocket, injectCarousingButton, rerenderPlayerSheets,
	showDSNRoll,
} from "./carousing-ui.mjs";

import { MODULE_ID, getCarousingMode, getActiveCarousingTiers, getExpandedOutcome, getExpandedBenefit, getExpandedMishap, getDefaultExpandedData, getExpandedCarousingTables, saveExpandedCarousingTables, getExpandedCarousingData, saveExpandedCarousingData, refreshLinkedCarousingTables, initCarousing, getCarousingJournal, getCarousingTablesJournal, ensureCarousingJournal, ensureCarousingTablesJournal, getCustomCarousingTables, saveCustomCarousingTables, getCarousingTableById, getCarousingGmActors, getCarousingDrops, saveCarousingDrops, getCarousingSession, saveCarousingSession, setCarousingDrop, setCarousingTier, setCarousingTable, setPlayerConfirmation, setPlayerModifier, addGmParticipant, removeGmParticipant, resetCarousingSession, addCarousingResult, removeCarousingResult, pruneOfflineCarousingData } from "./carousing-core.mjs";

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

	const selectedTier = session.selectedTier !== null
		? activeTable.tiers[session.selectedTier]
		: null;
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
			// Keep the original user id for drops, to avoid breaking existing data.
			participantId: user.id,
			name: user.name,
			character: user.character,
			characterName: user.character?.name || game.i18n.localize(
				"SHADOWDARK_EXTRAS.carousing.no_character"
			),
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
 * Get participants who have dropped actors
 */
function getParticipants() {
	return getCarousingParticipants().filter(p => p.hasDrop);
}

// ============================================
// DICE SO NICE APPEARANCE CUSTOMIZATION
// ============================================

// ============================================
// EXPANDED CAROUSING ROLL LOGIC
// ============================================

/**
 * Roll a d100 Benefit/Mishap result, automatically honoring the "re-roll this
 * benefit as a mishap" / "re-roll this mishap as a benefit" rows by rolling
 * again on the other table. Bounded to avoid ping-pong loops.
 * @param {"benefit"|"mishap"} type - the table to roll on first
 * @param {number} outcomeModifier - the outcome row's d100 modifier
 * @param {object} playerMods - per-player custom modifiers ({benefits, mishaps})
 * @returns {Promise<{type: string, diceRoll: number, modifier: number, finalRoll: number,
 * description: string}>}
 */
export async function rollExpandedD100(type, outcomeModifier, playerMods = {}) {
	let result = null;
	for (let hop = 0; hop < 4; hop++) {
		const extra = playerMods[type === "benefit" ? "benefits" : "mishaps"];
		const roll = await new Roll(`1d100${extra ? ` + ${extra}` : ""}`).evaluate();
		await showDSNRoll(roll, type);

		const diceRoll = roll.total;
		const finalRoll = Math.max(1, Math.min(100, diceRoll + outcomeModifier));
		const entry = type === "benefit" ? getExpandedBenefit(finalRoll) : getExpandedMishap(
			finalRoll
		);
		result = {
			type, diceRoll, modifier: outcomeModifier, finalRoll, description: entry.description,
		};

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
			r.renownDelta = await applyRenownDelta(
				actor, parseRenownDelta(r.description), r.description
			);
			(r.type === "benefit" ? benefitResults : mishapResults).push(r);
		}
		for (let i = 0; i < outcome.mishaps; i++) {
			const r = await rollExpandedD100("mishap", outcome.modifier, playerMods);
			r.renownDelta = await applyRenownDelta(
				actor, parseRenownDelta(r.description), r.description
			);
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
		const buildRollBreakdown = r => {
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
				// If benefits should be hidden from players, add both visible (GM) and hidden
				// (player) versions
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
				// If mishaps should be hidden from players, add both visible (GM) and hidden
				// (player) versions
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

	const { effects, wealthLossCp, wealthShortfallCp } = previewOutcomeEffects(
		actor, result.description, result.benefit
	);
	const summaryParts = [];

	if (effects.xp) {
		const currentXp = actor.system?.level?.xp || 0;
		await actor.update({ "system.level.xp": currentXp + effects.xp });
		summaryParts.push(
			game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_xp", { amount: effects.xp })
		);
	}

	if (effects.luck) {
		const currentLuck = actor.system?.luck?.remaining ?? 0;
		await actor.update({ "system.luck.remaining": currentLuck + effects.luck });
		summaryParts.push(
			game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_luck", { amount: effects.luck })
		);
	}

	if (wealthLossCp > 0) {
		const taken = await deductCoinsCp(actor, wealthLossCp);
		summaryParts.push(game.i18n.format("SHADOWDARK_EXTRAS.carousing.effect_wealth", {
			percent: effects.wealthPercent, amount: formatCoins(taken),
		}));
	}

	if (wealthShortfallCp > 0) {
		await recordCarousingDebt(
			actor, wealthShortfallCp,
			[result.description, result.benefit].filter(Boolean).join(" — ")
		);
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

// ============================================
// SOCKET AND SYNC
// ============================================

// ============================================
// TAB INJECTION
// ============================================

// Full public surface preserved (Phase 5.1 split re-exports).
export {
	getCarousingMode, getActiveCarousingTiers, getExpandedOutcome, getExpandedBenefit,
	getExpandedMishap, getDefaultExpandedData, getExpandedCarousingTables,
	saveExpandedCarousingTables, getExpandedCarousingData, saveExpandedCarousingData,
	refreshLinkedCarousingTables, initCarousing, getCarousingJournal, getCarousingTablesJournal,
	saveCarousingDrops, saveCarousingSession, ensureCarousingJournal, ensureCarousingTablesJournal,
	getCustomCarousingTables, saveCustomCarousingTables, getCarousingTableById,
	getCarousingGmActors, getCarousingDrops, getCarousingSession, setCarousingDrop,
	setCarousingTier, setCarousingTable, setPlayerConfirmation, setPlayerModifier, addGmParticipant,
	removeGmParticipant, resetCarousingSession, addCarousingResult, removeCarousingResult,
	pruneOfflineCarousingData,
	// Moved out by the Phase 5.3 split; still reached through this module.
	formatCoins, getActorWealthDisplay, getCarousingWealthBaseCp, getCarousingWealthBaseMode,
	recordCarousingDebt,
	applyRenownDelta, getActorRenown, getRenownBonus, migrateLegacyRenown, parseRenownDelta,
	buildExpandedCarousingNote, getParticipantActor,
	normalizeCarousingLogResults, openCarousingLog, writeCarousingLogPage,
	initCarousingSocket, injectCarousingButton, rerenderPlayerSheets,
};

