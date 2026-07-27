/**
 * Pure Party travel mutation planners.
 *
 * The Party sheet and its GM socket handler share these so player-initiated
 * changes are validated and produce the same flag state as GM changes.
 */

function cloneAssignments(assignments = {}) {
	return Object.fromEntries(
		Object.entries(assignments).map(([key, members]) => [
			key,
			Array.isArray(members) ? [...members] : []
		])
	);
}

function cloneSelections(selections = {}) {
	return Object.fromEntries(
		Object.entries(selections).map(([key, values]) => [
			key,
			values && typeof values === "object" ? { ...values } : {}
		])
	);
}

/**
 * Decide whether a sender may request a Party travel mutation.
 *
 * @param {Object} context
 * @returns {boolean}
 */
export function isPartyTravelMutationAuthorized({
	isGM = false,
	memberKeys = [],
	ownedMemberKeys = [],
	operation,
	memberId = ""
}) {
	if (isGM) return true;
	const partyMembers = new Set(memberKeys);
	const ownedMembers = new Set(ownedMemberKeys);
	if (operation === "weatherPrediction") {
		return [...ownedMembers].some(key => partyMembers.has(key));
	}
	return partyMembers.has(memberId) && ownedMembers.has(memberId);
}

/**
 * Plan a task or ability selection without touching a Foundry document.
 *
 * @param {Object} state
 * @param {Object} request
 * @param {Object[]} tasks
 * @returns {{assignments: Object, selections: Object}}
 */
export function planPartyTravelMutation(
	{ assignments = {}, selections = {} },
	{ operation, memberId, taskKey = "", abilityIndex = 0 },
	tasks = []
) {
	if (!memberId) throw new Error("Missing party member");

	const taskMap = new Map(tasks.map(task => [task.key, task]));
	const nextAssignments = cloneAssignments(assignments);
	const nextSelections = cloneSelections(selections);

	if (operation === "selectTask") {
		for (const [key, members] of Object.entries(nextAssignments)) {
			nextAssignments[key] = members.filter(id => id !== memberId);
		}
		for (const values of Object.values(nextSelections)) {
			delete values[memberId];
		}

		if (taskKey) {
			if (!taskMap.has(taskKey)) throw new Error("Unknown travel task");
			nextAssignments[taskKey] ??= [];
			if (!nextAssignments[taskKey].includes(memberId)) {
				nextAssignments[taskKey].push(memberId);
			}
			nextSelections[taskKey] ??= {};
			nextSelections[taskKey][memberId] = 0;
		}
	} else if (operation === "selectAbility") {
		const task = taskMap.get(taskKey);
		if (!task) throw new Error("Unknown travel task");
		if (!(nextAssignments[taskKey] ?? []).includes(memberId)) {
			throw new Error("Party member is not assigned to that task");
		}

		const abilities = (task.abilities ?? []).filter(
			ability => String(ability ?? "").trim()
		);
		const index = Number(abilityIndex);
		if (!Number.isInteger(index) || index < 0 || index >= abilities.length) {
			throw new Error("Invalid travel ability");
		}
		nextSelections[taskKey] ??= {};
		nextSelections[taskKey][memberId] = index;
	} else {
		throw new Error("Unknown Party travel operation");
	}

	return {
		assignments: nextAssignments,
		selections: nextSelections
	};
}

/**
 * Plan consumption or clearing of a banked Predict result.
 *
 * @param {Object|boolean|null} prediction
 * @param {"consume"|"clear"} action
 * @returns {{uses: number, value: Object|null}}
 */
export function planWeatherPredictionMutation(prediction, action) {
	const current = prediction && typeof prediction === "object"
		? { ...prediction }
		: {};
	const uses = Math.max(0, Number(current.uses ?? (prediction ? 1 : 0)));

	if (action === "clear") return { uses: 0, value: null };
	if (action !== "consume") throw new Error("Unknown weather prediction operation");
	if (!uses) throw new Error("No weather prediction rerolls remain");

	const remaining = uses - 1;
	return {
		uses: remaining,
		value: remaining ? { ...current, uses: remaining } : null
	};
}
