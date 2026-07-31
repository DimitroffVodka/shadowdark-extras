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
			after: available - amount
		});
		remaining -= amount;
	}

	return {
		complete: remaining === 0,
		consumed: Math.max(0, (Number.parseInt(requested, 10) || 0) - remaining),
		remaining,
		entries
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
	interruptionCheckSucceeded = false
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
