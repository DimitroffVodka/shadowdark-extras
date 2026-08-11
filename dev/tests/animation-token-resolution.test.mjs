// getTokensForActor — which tokens an actor-scoped animation applies to.
// scripts/animation/token-resolution.mjs
//
// Issue #122 (the selection half of #105). The function existed as three
// byte-identical private copies in TorchAnimationSD, WeaponAnimationSD and
// LevelUpAnimationSD, none of them exported and none of them tested. The only
// test that referenced the name at all — weapon-master-list.test.mjs:133 — set
// actorLink = true specifically to steer AROUND the unlinked branch.
//
// So the three multi-unlinked cases returned 1, 0 and 1 by accident rather than
// by decision. #122 decided those ARE the intended answers, and this file is
// the pin. The behaviour is link-aware: an unlinked token owns its actor data,
// so it neither drags its siblings along nor follows the base actor.
//
// The rejected alternative (3, 3, 2 — every sibling sharing the actorId) is
// asserted against explicitly below, so a future change back to it fails loudly
// rather than silently reviving the #105 stacking topology.

import assert from "node:assert/strict";
import test from "node:test";

const { getTokensForActor } = await import("../../scripts/animation/token-resolution.mjs");

// --- scene fixtures ---------------------------------------------------------

/**
 * @param {string} id - Token id
 * @param {string} actorId - The actor this token draws from
 * @param {boolean} actorLink - Whether the token is linked to the base actor
 */
function makeToken(id, actorId, actorLink) {
	return { id, document: { id, actorId, actorLink }, actor: { id: actorId } };
}

/**
 * @param {string} id - Actor id
 * @param {boolean} isToken - True for a synthetic (unlinked-token) actor
 * @param {string|null} tokenId - The token a synthetic actor belongs to
 */
function makeActor(id, isToken, tokenId = null) {
	return { id, isToken, token: tokenId ? { id: tokenId } : null };
}

/** Install a scene holding `placeables`. Pass null for "no scene". */
function useScene(placeables, { scene = { id: "sceneA" } } = {}) {
	globalThis.canvas = {
		scene,
		tokens: {
			placeables,
			get: id => placeables.find(t => t.id === id) ?? null,
		},
	};
}

const SHARED = "TxKpfy58G7xu3hQr";

/** The #105 topology: several unlinked tokens stamped from one base actor. */
function threeUnlinkedSiblings() {
	const tokens = [
		makeToken("TokA1111111111", SHARED, false),
		makeToken("TokB2222222222", SHARED, false),
		makeToken("TokC3333333333", SHARED, false),
	];
	useScene(tokens);
	return tokens;
}

// --- no scene ---------------------------------------------------------------

test("with no scene nothing is resolved", () => {
	useScene([], { scene: null });

	assert.deepEqual(getTokensForActor(makeActor("anything", false)), []);
	assert.deepEqual(getTokensForActor(makeActor("anything", true, "TokA1111111111")), []);
});

// --- the three cases #122 decided -------------------------------------------

test("unlinked siblings: a synthetic actor resolves to its own token only", () => {
	threeUnlinkedSiblings();

	const result = getTokensForActor(makeActor(SHARED, true, "TokB2222222222"));

	assert.equal(result.length, 1, "not 3 — siblings do not follow each other");
	assert.equal(result[0].id, "TokB2222222222", "and it is the queried token, not a sibling");
});

test("unlinked siblings: the base actor resolves to none of them", () => {
	threeUnlinkedSiblings();

	const result = getTokensForActor(makeActor(SHARED, false));

	assert.deepEqual(result, [], "not 3 — unlinked tokens carry their own actor data");
});

test("mixed scene: the base actor resolves to the linked token only", () => {
	const linked = makeToken("LinkedTok1", "MixedActorId12345", true);
	const unlinked = makeToken("UnlinkedTok1", "MixedActorId12345", false);
	useScene([linked, unlinked]);

	const result = getTokensForActor(makeActor("MixedActorId12345", false));

	assert.equal(result.length, 1, "not 2 — the unlinked token is excluded");
	assert.equal(result[0].id, "LinkedTok1");
});

// --- the cases that were never in doubt -------------------------------------

test("a single unlinked token resolves to itself", () => {
	const tok = makeToken("Solo1111111111", "SoloActorId12345", false);
	useScene([tok]);

	const result = getTokensForActor(makeActor("SoloActorId12345", true, "Solo1111111111"));

	assert.deepEqual(result.map(t => t.id), ["Solo1111111111"]);
});

test("linked tokens all resolve from the base actor", () => {
	useScene([
		makeToken("Link1", "LinkedActorId123", true),
		makeToken("Link2", "LinkedActorId123", true),
		makeToken("Other", "SomeOtherActorId", true),
	]);

	const result = getTokensForActor(makeActor("LinkedActorId123", false));

	assert.deepEqual(result.map(t => t.id), ["Link1", "Link2"], "and only that actor's tokens");
});

test("a synthetic actor whose token left the scene resolves to nothing", () => {
	useScene([makeToken("StillHere11111", SHARED, false)]);

	const result = getTokensForActor(makeActor(SHARED, true, "AlreadyGone1111"));

	assert.deepEqual(result, [], "a stale token id must not fall through to the linked branch");
});

// --- the rejected alternative -----------------------------------------------

test("the link-agnostic answer (3, 3, 2) is explicitly NOT the behaviour", () => {
	// phase53/issue105-token-resolution asserted these. Reviving them would
	// restore the topology behind the #105 incident: one unlinked token's
	// change animating its ten siblings, whose actors did not change.
	threeUnlinkedSiblings();
	assert.notEqual(getTokensForActor(makeActor(SHARED, true, "TokB2222222222")).length, 3);
	assert.notEqual(getTokensForActor(makeActor(SHARED, false)).length, 3);

	useScene([
		makeToken("LinkedTok1", "MixedActorId12345", true),
		makeToken("UnlinkedTok1", "MixedActorId12345", false),
	]);
	assert.notEqual(getTokensForActor(makeActor("MixedActorId12345", false)).length, 2);
});

// --- the copies really are gone ---------------------------------------------

test("all three animation modules import the one shared implementation", async () => {
	const { readFile } = await import("node:fs/promises");

	for (const name of ["TorchAnimationSD", "WeaponAnimationSD", "LevelUpAnimationSD"]) {
		const src = await readFile(new URL(`../../scripts/animation/${name}.mjs`, import.meta.url), "utf8");
		assert.match(
			src,
			/import \{ getTokensForActor \} from "\.\/token-resolution\.mjs";/,
			`${name} must import the shared implementation`
		);
		assert.doesNotMatch(
			src,
			/function getTokensForActor\s*\(/,
			`${name} must not carry a private copy`
		);
	}
});
