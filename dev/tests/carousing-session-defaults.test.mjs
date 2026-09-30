import assert from "node:assert/strict";
import test from "node:test";

globalThis.CONST = { TABLE_RESULT_TYPES: {}, USER_ROLES: {}, DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 } };
const { getCarousingSession } = await import("../../scripts/party/carousing/carousing-core.mjs");

/** The carousing journal, whose session flag is whatever was stored. It is one object because the core module caches it. */
let storedSession;
const journal = { id: "j", name: "Carousing", getFlag: () => storedSession };
function withStoredSession(t, stored) {
	const saved = globalThis.game;
	storedSession = stored;
	globalThis.game = { journal: { get: () => journal, find: () => journal } };
	t.after(() => { globalThis.game = saved; });
}

test("a session stored with keys missing still has every key the overlay reads", t => {
	// What one player-modifier write leaves before a full session was ever saved.
	withStoredSession(t, { modifiers: { user1: { outcome: "2" } } });
	const session = getCarousingSession();
	assert.deepEqual(session.confirmations, {});
	assert.deepEqual(session.results, {});
	assert.deepEqual([session.phase, session.selectedTableId, session.selectedTier], ["setup", "default", null]);
	assert.deepEqual(session.modifiers, { user1: { outcome: "2" } });
});

test("a stored session keeps the values it has, including a chosen tier of 0", t => {
	withStoredSession(t, {
		selectedTableId: "t", selectedTier: 0, confirmations: { u: true }, phase: "rolled", results: { u: { roll: 4 } },
	});
	const session = getCarousingSession();
	assert.deepEqual([session.selectedTableId, session.selectedTier, session.phase], ["t", 0, "rolled"]);
	assert.deepEqual([session.confirmations, session.results], [{ u: true }, { u: { roll: 4 } }]);
	assert.deepEqual(session.modifiers, {});
});
