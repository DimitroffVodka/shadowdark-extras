/**
 * Pure helpers for the Party camping/rest workflow.
 */

export const REST_DURATION_SECONDS = 8 * 60 * 60;
export const CAMPFIRE_TORCH_COST = 3;
export const TORCH_NAME_PATTERN = /^torch(?:es)?$/i;

/**
 * Consume a requested quantity from ordered inventory stacks.
 * @param {{ownerId:string,itemId:string,quantity:number}[]} stacks
 * @param {number} requested
 * @returns {{complete:boolean, consumed:number, remaining:number, entries:Object[]}}
 */
export function planStackConsumption(stacks = [], requested = 0) {
	let remaining = Math.max(0, Number.parseInt(requested, 10) || 0);
	const entries = [];

	for (const stack of stacks) {
		if (remaining <= 0) break;
		const available = Math.max(0, Number.parseInt(stack?.quantity, 10) || 0);
		if (!available) continue;

		const amount = Math.min(available, remaining);
		entries.push({
			ownerId: String(stack.ownerId ?? ""),
			itemId: String(stack.itemId ?? ""),
			amount,
			before: available,
			after: available - amount,
		});
		remaining -= amount;
	}

	return {
		complete: remaining === 0,
		consumed: Math.max(0, (Number.parseInt(requested, 10) || 0) - remaining),
		remaining,
		entries,
	};
}

/**
 * Determine whether a camper receives normal rest recovery.
 * A ration is always required. Bed Down bypasses an interruption check.
 * @param {Object} data
 * @returns {boolean}
 */
export function qualifiesForRest({
	hasRation = false,
	interrupted = false,
	bedDownSucceeded = false,
	interruptionCheckSucceeded = false,
} = {}) {
	if (!hasRation) return false;
	if (!interrupted) return true;
	return bedDownSucceeded || interruptionCheckSucceeded;
}

/**
 * Cook grants ordinary HP, capped at two points above maximum. Repeating Cook
 * does not stack the same bonus, while unrelated HP already above that cap is
 * preserved.
 * @param {number} currentHp
 * @param {number} maxHp
 * @param {number} amount
 * @returns {number}
 */
export function calculateCookBonusHp(currentHp, maxHp, amount = 2) {
	const current = Math.max(0, Number(currentHp) || 0);
	const maximum = Math.max(0, Number(maxHp) || 0);
	const bonus = Math.max(0, Number(amount) || 0);
	if (current >= maximum + bonus) return current;
	return Math.min(maximum + bonus, current + bonus);
}

/**
 * Grinder Mode HP roll (core rulebook p.111): `count` class hit dice, each with
 * advantage for a Stout character. `die` is the class's `system.hitPoints`,
 * such as "d8"; null when there is no die to roll.
 * @param {string} die
 * @param {number} count 1-4, the Grinder hit dice setting
 * @param {boolean} advantage
 * @returns {?string}
 */
export function grinderHpFormula(die, count = 1, advantage = false) {
	const faces = /d(\d+)/i.exec(String(die ?? ""))?.[1];
	if (!faces) return null;
	const n = Math.min(4, Math.max(1, Number.parseInt(count, 10) || 1));
	return advantage
		? Array.from({ length: n }, () => `2d${faces}kh`).join(" + ")
		: `${n}d${faces}`;
}

/**
 * Grinder HP: current plus the roll, capped at maximum. HP already above
 * maximum is kept, as Cook does.
 * @param {number} currentHp
 * @param {number} maxHp
 * @param {number} rolled
 * @returns {number}
 */
export function calculateGrinderHp(currentHp, maxHp, rolled) {
	const current = Math.max(0, Number(currentHp) || 0);
	const maximum = Math.max(0, Number(maxHp) || 0);
	return Math.max(current, Math.min(maximum, current + Math.max(0, Number(rolled) || 0)));
}

/**
 * The lost spells a Grinder rest regains. With no more lost than the 1d4 roll
 * there is nothing to choose; otherwise the ticked ones from the pick dialog's
 * form data, at most `count`, in list order.
 * @param {{id:string}[]} lost
 * @param {number} count the 1d4 roll
 * @param {?Object<string, boolean>} picked
 * @returns {{id:string}[]}
 */
export function pickRegainedSpells(lost = [], count = 0, picked = null) {
	if (lost.length <= count) return lost;
	return lost.filter(spell => picked?.[spell.id]).slice(0, count);
}

/**
 * Heal stat damage through Shadowdark Enhancer's API when it is installed
 * (shadowdark-extras#149): all of it on a normal rest, 1 point per damaged
 * ability on a Grinder rest. Without Enhancer there is nothing tracked, so
 * nothing to do. Reached through `globalThis` so node:test can import this file.
 * @param {Actor} actor
 * @param {boolean} grinder
 */
export async function healStatDamage(actor, grinder = false) {
	const statDamage = globalThis.game?.shadowdarkEnhancer?.statDamage;
	if (typeof statDamage?.heal !== "function") return;
	try {
		await (grinder ? statDamage.heal(actor, { perAbility: 1 }) : statDamage.heal(actor));
	}
	catch(error) {
		console.warn("shadowdark-extras | Shadowdark Enhancer could not heal stat damage", error);
	}
}

/**
 * Pick the configured ability for one task/member selection.
 * @param {Object} task
 * @param {number|string} selectedIndex
 * @returns {string}
 */
export function getCampingAbility(task = {}, selectedIndex = 0) {
	const abilities = Array.isArray(task.abilities) ? task.abilities : [];
	const index = Number.parseInt(selectedIndex, 10);
	return abilities[index] ?? abilities[0] ?? "none";
}
