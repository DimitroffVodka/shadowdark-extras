// Undo for the dungeon tools.
//
// Every dungeon action is destructive and, until now, none of them could be
// taken back: a reskin that came out wrong, a floor painted over the wrong room,
// an erase that took more than intended. The only recovery was Clear SDX
// Dungeon, which throws away everything rather than the last mistake — so the
// cost of trying something was the cost of redoing all of it.
//
// The stack lives in memory and is lost on reload, deliberately. Persisting it
// would mean writing whole document payloads into a scene flag, and a Clear on a
// reskinned map is 800+ documents. Undo is for "that was wrong, put it back",
// which happens seconds after the action, not days later.

const MODULE_ID = "shadowdark-extras";
// One deep would cover most mistakes; a few lets you back out of a short run of
// them. Deeper is not free — each entry pins the full data of deleted documents.
const MAX_DEPTH = 10;

const _stack = [];

/**
 * Record an action so it can be reversed.
 *
 * @param {string} label - shown to the user, e.g. "Reskin"
 * @param {object} change
 * @param {Array<{type: string, ids: string[]}>} [change.created] - to delete
 * @param {Array<{type: string, data: object[]}>} [change.deleted] - to restore
 */
export function recordDungeonAction(label, { created = [], deleted = [] } = {}) {
	const hasWork = created.some(c => c.ids.length > 0) || deleted.some(d => d.data.length > 0);
	if (!hasWork) return;

	_stack.push({ label, created, deleted });
	while (_stack.length > MAX_DEPTH) _stack.shift();
}

/** What undoing next would reverse, or null. */
export function pendingUndoLabel() {
	return _stack.length > 0 ? _stack[_stack.length - 1].label : null;
}

/** Forget the history — used when it can no longer apply, e.g. a scene change. */
export function clearDungeonHistory() {
	_stack.length = 0;
}

/**
 * Reverse the most recent recorded action.
 *
 * @param {Scene} scene
 * @returns {Promise<string|null>} the label undone, or null
 */
export async function undoLastDungeonAction(scene) {
	if (!game.user.isGM) {
		ui.notifications.warn("SDX | Undo is GM-only.");
		return null;
	}
	if (!scene) return null;

	const entry = _stack.pop();
	if (!entry) {
		ui.notifications.info("SDX | Nothing to undo.");
		return null;
	}

	// Deletions first: restoring documents that a later step would delete again
	// is wasted work, and creations are the commoner case.
	for (const { type, ids } of entry.created) {
		// Ids may already be gone if the user deleted them by hand in between.
		const collection = scene.getEmbeddedCollection(type);
		const alive = ids.filter(id => collection.get(id));
		if (alive.length > 0) await scene.deleteEmbeddedDocuments(type, alive);
	}

	for (const { type, data } of entry.deleted) {
		if (data.length === 0) continue;
		// keepId so a second undo, or anything else holding these ids, still
		// resolves them. Foundry refuses the id if it is somehow taken, and the
		// document is created with a fresh one rather than lost.
		await scene.createEmbeddedDocuments(type, data, { keepId: true });
	}

	ui.notifications.info(`SDX | Undid: ${entry.label}.`);
	return entry.label;
}

/** The scene-flag namespace, exported so callers do not re-declare it. */
export const UNDO_MODULE_ID = MODULE_ID;
