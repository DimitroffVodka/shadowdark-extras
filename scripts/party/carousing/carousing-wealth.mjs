// Carousing coin and wealth maths — extracted from CarousingSD.mjs (Phase 5.3
// split). All arithmetic is done in copper, the smallest unit, so a percentage
// and its deduction keep their change instead of rounding to whole gp at each
// step. CarousingSD re-exports the public names, so its surface is unchanged.

import { MODULE_ID } from "./carousing-core.mjs";

// Coin maths is done in copper, the smallest unit, so a percentage and its
// deduction keep their change instead of being rounded to whole gp at every
// step. 1 gp = 10 sp = 100 cp.
export const CP_PER_GP = 100;

export const CP_PER_SP = 10;

/**
 * Get actor's total GP (coins.gp + sp/10 + cp/100), rounded down to whole gp.
 * Display and affordability only — anything doing arithmetic on wealth should
 * use the copper helpers below, which do not discard change.
 */
export function getActorTotalGp(actor) {
	return Math.floor(getActorCoinsCp(actor) / CP_PER_GP);
}

/** An actor's carried coin, in copper. */
export function getActorCoinsCp(actor) {
	const coins = actor?.system?.coins || {};
	return ((Number(coins.gp) || 0) * CP_PER_GP)
        + ((Number(coins.sp) || 0) * CP_PER_SP)
        + (Number(coins.cp) || 0);
}

/** Value of an actor's gear in copper. Items with no cost recorded count as 0. */
export function getActorGearValueCp(actor) {
	let total = 0;
	for (const item of actor?.items ?? []) {
		const cost = item.system?.cost;
		if (!cost) continue;
		const qty = Number(item.system?.quantity ?? 1) || 1;
		total += (((Number(cost.gp) || 0) * CP_PER_GP)
            + ((Number(cost.sp) || 0) * CP_PER_SP)
            + (Number(cost.cp) || 0)) * qty;
	}
	return total;
}

/** Split a copper total into {gp, sp, cp}. */
export function cpToCoins(totalCp) {
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

	const existing = actor.items?.find?.(
		item => item.getFlag?.(MODULE_ID, "carousingDebt")?.amountCp !== undefined
	);
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
export async function deductCoinsCp(actor, cpAmount) {
	const src = actor?.system?.coins || {};
	let gp = Number(src.gp) || 0;
	let sp = Number(src.sp) || 0;
	let cp = Number(src.cp) || 0;

	const purse = (gp * CP_PER_GP) + (sp * CP_PER_SP) + cp;
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
 * Deduct coins from actor (prioritize GP, then SP, then CP)
 */
export async function deductCoins(actor, gpAmount) {
	await deductCoinsCp(actor, (Number(gpAmount) || 0) * CP_PER_GP);
}

/** The configured wealth base: "coins" or "coinsAndGear". */
export function getCarousingWealthBaseMode() {
	try {
		return game.settings.get(MODULE_ID, "carousingWealthBase") || "coins";
	}
	catch{
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
 * @returns {{coinsCp: number, gearCp: number, totalCp: number, coinsLabel: string, totalLabel:
 * string}}
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
