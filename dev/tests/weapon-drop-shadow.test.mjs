// Gap 1 — dropShadow PIXI lookup must carry source identity (see #105)
//
// After #105 effect names are classification keys only:
//   `shadowdark-extras-weapon-<itemId>` — no token segment.
// Eleven unlinked tokens sharing a base actor therefore share an identical
// name. The dropShadow post-play lookup in WeaponAnimationSD.mjs around :355
// does a direct `Sequencer.EffectManager.effects.filter` on the live PIXI
// manager. Before #105 it was name-only; post-#105 it must be
// `name === effectName && source === tokenUuid`, otherwise it returns other
// tokens' effects and the shadow attaches to the wrong sprite.
//
// This suite pins that invariant in two ways:
//   1. Static: the source file must still contain the `&& ... source === tokenUuid` clause.
//      Deleting the clause makes this test go red (verified fail-before/pass-after).
//   2. Behavioural: with colliding names, a name-only filter returns N hits;
//      name+source returns exactly the calling token's effect. This documents
//      *why* the clause matters, even though the static check is the regression gate.
//
// The tokenUuid is derived with a `document.uuid` fallback:
//   `token.document?.uuid ?? Scene.<viewedScene|sceneId>.Token.<token.id>`
// Both paths are covered.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MODULE_ID = "shadowdark-extras";

// ---------------------------------------------------------------------------
// 1. Static regression gate — fails if the source clause is deleted
// ---------------------------------------------------------------------------

test("weapon dropShadow lookup filters by both name and source (regression gate for #105)", () => {
	const filePath = fileURLToPath(new URL("../../scripts/animation/WeaponAnimationSD.mjs", import.meta.url));
	const src = readFileSync(filePath, "utf8");

	// The load-bearing filter around :355 — must be name plus source.
	// We match the exact pattern so deleting `&& e.data?.source === tokenUuid` fails.
	const hasNameAndSource = src.includes("e.data?.name === effectName && e.data?.source === tokenUuid");
	assert.ok(
		hasNameAndSource,
		"WeaponAnimationSD dropShadow filter must be `e.data?.name === effectName && e.data?.source === tokenUuid` — name-only would collide across tokens (see #105)",
	);

	// Also pin the tokenUuid derivation with fallback, so the fallback path is not silently dropped.
	assert.ok(
		src.includes("token.document?.uuid"),
		"dropShadow must derive tokenUuid with document.uuid fallback",
	);
	// Fallback uses viewedScene or canvas.scene.id
	assert.ok(
		src.includes("game.user?.viewedScene") || src.includes("viewedScene"),
		"dropShadow fallback must consult game.user.viewedScene",
	);
	assert.ok(
		src.includes("canvas?.scene?.id") || src.includes("canvas.scene.id"),
		"dropShadow fallback must consult canvas.scene.id",
	);
});

// ---------------------------------------------------------------------------
// 2. Behavioural: why the clause matters — collision with shared name
// ---------------------------------------------------------------------------

function filterNameOnly(effects, effectName) {
	return effects.filter(e => e.data?.name === effectName);
}
function filterNameAndSource(effects, effectName, tokenUuid) {
	return effects.filter(e => e.data?.name === effectName && e.data?.source === tokenUuid);
}

test("dropShadow: name-only filter collides across tokens sharing actor+item; name+source isolates", () => {
	const itemId = "itemX";
	const effectName = `${MODULE_ID}-weapon-${itemId}`;
	const tokenA = { id: "tokA", document: { uuid: "Scene.sceneA.Token.tokA" } };
	const tokenB = { id: "tokB", document: { uuid: "Scene.sceneA.Token.tokB" } };
	const tokenC = { id: "tokC", document: { uuid: "Scene.sceneA.Token.tokC" } };

	const effects = [
		{ data: { name: effectName, source: tokenA.document.uuid, _id: "effA" }, sprite: {} },
		{ data: { name: effectName, source: tokenB.document.uuid, _id: "effB" }, sprite: {} },
		{ data: { name: effectName, source: tokenC.document.uuid, _id: "effC" }, sprite: {} },
	];

	// Name-only returns all three — would attach shadow to siblings (the bug).
	const nameOnly = filterNameOnly(effects, effectName);
	assert.equal(nameOnly.length, 3, "name-only must collide (3 hits for 3 tokens sharing name)");

	// Name+source returns exactly the caller's effect.
	for (const tok of [tokenA, tokenB, tokenC]) {
		const tokenUuid = tok.document.uuid;
		const hit = filterNameAndSource(effects, effectName, tokenUuid);
		assert.equal(hit.length, 1, `name+source for ${tok.id} must isolate to 1`);
		assert.equal(hit[0].data._id, `eff${tok.id.slice(-1).toUpperCase()}`);
	}
});

// ---------------------------------------------------------------------------
// 3. Fallback path — token without document.uuid
// ---------------------------------------------------------------------------

test("dropShadow tokenUuid fallback: document.uuid missing falls back to Scene.<scene>.Token.<id>", () => {
	const itemId = "itemY";
	const effectName = `${MODULE_ID}-weapon-${itemId}`;

	// Simulate the derivation in WeaponAnimationSD.mjs:354
	function deriveTokenUuid(token) {
		return token.document?.uuid ?? `Scene.${globalThis.game?.user?.viewedScene ?? globalThis.canvas?.scene?.id ?? ""}.Token.${token.id}`;
	}

	// Case A: document.uuid present — used directly
	const tokWithUuid = { id: "tokA", document: { uuid: "Scene.sceneA.Token.tokA" } };
	globalThis.game = { user: { viewedScene: "sceneA" } };
	globalThis.canvas = { scene: { id: "sceneA" } };
	assert.equal(deriveTokenUuid(tokWithUuid), "Scene.sceneA.Token.tokA");

	// Case B: no document.uuid — fallback via viewedScene
	const tokNoUuid = { id: "tokB", document: {} };
	globalThis.game = { user: { viewedScene: "sceneA" } };
	globalThis.canvas = { scene: { id: "sceneA" } };
	assert.equal(deriveTokenUuid(tokNoUuid), "Scene.sceneA.Token.tokB");

	// Case C: no document at all — fallback still works
	const tokBare = { id: "tokC" };
	assert.equal(deriveTokenUuid(tokBare), "Scene.sceneA.Token.tokC");

	// Case D: viewedScene missing — falls back to canvas.scene.id
	const tokNoViewed = { id: "tokD", document: {} };
	globalThis.game = { user: {} };
	globalThis.canvas = { scene: { id: "sceneB" } };
	assert.equal(deriveTokenUuid(tokNoViewed), "Scene.sceneB.Token.tokD");

	// Behavioural: effects stored with fallback UUID are still isolated by source
	const effects = [
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokB", _id: "effB" } },
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokC", _id: "effC" } },
	];
	globalThis.game = { user: { viewedScene: "sceneA" } };
	globalThis.canvas = { scene: { id: "sceneA" } };
	const uuidB = deriveTokenUuid(tokNoUuid);
	const hit = filterNameAndSource(effects, effectName, uuidB);
	assert.equal(hit.length, 1);
	assert.equal(hit[0].data._id, "effB");

	// Cleanup globals set above to avoid polluting other suites
	delete globalThis.game;
	delete globalThis.canvas;
});
