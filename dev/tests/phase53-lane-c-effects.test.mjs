import assert from "node:assert/strict";
import test from "node:test";
import { execSync } from "node:child_process";

// Phase 5.3 lane-C tests: the effects split (AuraEffectsSD / TemplateEffectsSD
// / duration-spell / focus-spell -> slim mains + geometry/state/tokenmagic/
// application/ui leaves).
//
// Scope: lane-scoped. These tests drive the real split leaves with minimal
// Foundry stubs and assert (a) aura geometry math, (b) template region/level
// containment, (c) duration/focus lifecycle registry behavior, and
// (d) TokenMagic ABSENCE — the split must preserve the optional-module guard
// and must NOT statically import TokenMagic from the effects path.

// ---------------------------------------------------------------------------
// Global stubs shared by the geometry leaves
// ---------------------------------------------------------------------------

function makeCanvas({ gridSize = 100, gridDistance = 5, visibility = null } = {}) {
	const placeables = [];
	const tokens = {
		placeables,
		get: id => placeables.find(t => t.id === id) || null,
	};
	const scene = {
		grid: { distance: gridDistance },
		tokens,
		regions: new Map(),
		templates: [],
	};
	globalThis.canvas = {
		ready: true,
		grid: { size: gridSize },
		scene,
		tokens,
		visibility,
		effects: { visibility },
		edges: null,
		walls: null,
	};
	return { canvas: globalThis.canvas, placeables };
}

function makeToken(id, x, y, { disposition = 1, actor = null, level = null } = {}) {
	const token = {
		id,
		center: { x, y },
		document: { disposition, level },
		actor: actor || { id: `actor-${id}`, effects: [] },
		getCenterPoint() {
			return this.center;
		},
	};
	return token;
}

function makeAuraEffect({ enabled = true, spellId = "spell-1", origin = null, radius } = {}) {
	return {
		id: "effect-1",
		origin: origin || `Item.${spellId}`,
		flags: {
			"shadowdark-extras": {
				aura: { enabled, spellId, radius: radius ?? 10 },
			},
		},
	};
}

globalThis.window = globalThis;
globalThis.foundry = {
	documents: { RegionDocument: { implementation: class RegionDocument {} } },
	canvas: { geometry: { Ray: class Ray {} } },
	utils: { deepClone: v => JSON.parse(JSON.stringify(v)) },
};
globalThis.CONFIG = { Canvas: {} };

// ---------------------------------------------------------------------------
// Aura geometry (aura-geometry.mjs)
// ---------------------------------------------------------------------------

const auraGeometry = await import("../../scripts/effects/aura-geometry.mjs");

test("aura geometry: isTokenInAura honors radius in feet across grid units", () => {
	makeCanvas({ gridSize: 100, gridDistance: 5 });
	const source = makeToken("src", 100, 100);

	// 10ft radius = 200px; 5ft radius = 100px
	const near = makeToken("near", 300, 100);   // 200px away
	const far = makeToken("far", 400, 100);     // 300px away

	assert.equal(auraGeometry.isTokenInAura(source, near, 10), true);
	assert.equal(auraGeometry.isTokenInAura(source, far, 10), false);
	assert.equal(auraGeometry.isTokenInAura(source, near, 5), false);
});

test("aura geometry: isTokenInAura returns false when centers are missing", () => {
	makeCanvas();
	const source = { id: "s", center: null };
	const target = { id: "t", center: { x: 0, y: 0 } };
	assert.equal(auraGeometry.isTokenInAura(source, target, 10), false);
});

test("aura geometry: isPositionInAuraAtPosition uses gridDistance from canvas", () => {
	makeCanvas({ gridSize: 100, gridDistance: 10 }); // 10ft grid -> 10ft radius = 100px
	const center = { x: 0, y: 0 };
	assert.equal(auraGeometry.isPositionInAuraAtPosition(center, { x: 100, y: 0 }, 10), true);
	assert.equal(auraGeometry.isPositionInAuraAtPosition(center, { x: 101, y: 0 }, 10), false);
});

test("aura geometry: checkDisposition filters ally/enemy/all", () => {
	const source = makeToken("src", 0, 0, { disposition: 1 });
	const ally = makeToken("ally", 1, 1, { disposition: 1 });
	const enemy = makeToken("enemy", 2, 2, { disposition: -1 });

	assert.equal(auraGeometry.checkDisposition(source, ally, "all"), true);
	assert.equal(auraGeometry.checkDisposition(source, enemy, "all"), true);
	assert.equal(auraGeometry.checkDisposition(source, ally, "ally"), true);
	assert.equal(auraGeometry.checkDisposition(source, enemy, "ally"), false);
	assert.equal(auraGeometry.checkDisposition(source, enemy, "enemy"), true);
	assert.equal(auraGeometry.checkDisposition(source, ally, "enemy"), false);
});

test("aura geometry: getActiveAuras returns enabled aura configs once per aura key", () => {
	const { placeables } = makeCanvas();
	const actor = {
		id: "actor-1",
		effects: [makeAuraEffect(), makeAuraEffect({ spellId: "spell-2" }), makeAuraEffect({ enabled: false })],
	};
	placeables.push(makeToken("t1", 0, 0, { actor }));
	placeables.push(makeToken("t2", 0, 0, { actor })); // same actor, different token -> unique keys

	const auras = auraGeometry.getActiveAuras();
	// keys are `${token.id}:${spellId||origin||effect.id}` -> t1:spell-1, t1:spell-2, t2:spell-1, t2:spell-2
	assert.equal(auras.length, 4);
	assert.deepEqual(new Set(auras.map(a => a.config.spellId)), new Set(["spell-1", "spell-2"]));
});

test("aura geometry: getTokensInAura returns tokens within radius and respects includeSelf", () => {
	const { placeables } = makeCanvas({ gridSize: 100, gridDistance: 5 });
	const source = makeToken("src", 100, 100);
	const inside = makeToken("inside", 200, 100);
	const outside = makeToken("outside", 500, 100);
	placeables.push(source, inside, outside);

	const withSelf = auraGeometry.getTokensInAura(source, 10, "all", true);
	assert.deepEqual(withSelf.map(t => t.id), ["src", "inside"]);

	const withoutSelf = auraGeometry.getTokensInAura(source, 10, "all", false);
	assert.deepEqual(withoutSelf.map(t => t.id), ["inside"]);
});

test("aura geometry: isCanvasAvailable false when canvas is not ready", () => {
	globalThis.canvas = undefined;
	assert.equal(auraGeometry.isCanvasAvailable(), false);
	makeCanvas(); // restore for later tests
});

// ---------------------------------------------------------------------------
// Aura state (aura-state.mjs)
// ---------------------------------------------------------------------------

const auraState = await import("../../scripts/effects/aura-state.mjs");

test("aura state: getAuraInsideStateKey is deterministic per source/target/config", () => {
	const k1 = auraState.getAuraInsideStateKey({ id: "src" }, { id: "tgt" }, { spellId: "spell-1" }, null);
	const k2 = auraState.getAuraInsideStateKey({ id: "src" }, { id: "tgt" }, { spellId: "spell-1" }, null);
	const k3 = auraState.getAuraInsideStateKey({ id: "src" }, { id: "tgt" }, { spellId: "spell-2" }, null);
	assert.equal(k1, k2);
	assert.notEqual(k1, k3);
});

test("aura state: shouldSuppressDuplicateAuraTrigger dedupes by aura/token/trigger", () => {
	const auraEffect = { id: "effect-9" };
	const target = { id: "token-9" };
	// first call records the trigger and returns false
	assert.equal(auraState.shouldSuppressDuplicateAuraTrigger(auraEffect, target, "enter"), false);
	// immediate repeat within the dedupe window returns true
	assert.equal(auraState.shouldSuppressDuplicateAuraTrigger(auraEffect, target, "enter"), true);
	// a different trigger type is not suppressed
	assert.equal(auraState.shouldSuppressDuplicateAuraTrigger(auraEffect, target, "leave"), false);
});

// ---------------------------------------------------------------------------
// Aura tokenmagic leaf: guards and TM absence
// ---------------------------------------------------------------------------

test("aura tokenmagic: applyTokenMagicFilter no-ops when TokenMagic module is inactive", async () => {
	globalThis.game = { modules: { get: () => ({ active: false }) } };
	const result = await (await import("../../scripts/effects/aura-tokenmagic.mjs")).applyTokenMagicFilter(
		{ id: "t" }, "preset", "effect-1"
	);
	assert.equal(result, undefined);
});

test("TM absence: effects path must not statically import the TokenMagic module", () => {
	const files = execSync("ls scripts/effects/*.mjs", { encoding: "utf-8" }).trim().split("\n");
	for (const file of files) {
		const src = execSync(`grep -n "tokenmagic" ${file} || true`, { encoding: "utf-8" });
		// Only references allowed: the optional-module guard (`game.modules.get("tokenmagic")`)
		// and comment mentions. A static `import ... from "tokenmagic"` is forbidden.
		const staticImport = src.split("\n").filter(line =>
			/^.*import\s+.*from\s+["']tokenmagic["']/.test(line)
		);
		assert.deepEqual(staticImport, [], `${file} statically imports TokenMagic`);
	}
});

// ---------------------------------------------------------------------------
// Template geometry (template-geometry.mjs)
// ---------------------------------------------------------------------------

const templateGeometry = await import("../../scripts/effects/template-geometry.mjs");

test("template geometry: _isSameLevel honors Region.levels Sets", () => {
	const region = { levels: new Set(["level-a", "level-b"]) };
	assert.equal(templateGeometry._isSameLevel("level-a", region), true);
	assert.equal(templateGeometry._isSameLevel("level-c", region), false);
});

test("template geometry: _isSameLevel falls back to casterLevelId flag on templates", () => {
	const tmpl = { flags: { "shadowdark-extras": { casterLevelId: "level-7" } } };
	assert.equal(templateGeometry._isSameLevel("level-7", tmpl), true);
	assert.equal(templateGeometry._isSameLevel("level-8", tmpl), false);
});

test("template geometry: _isSameLevel returns true when no level info exists", () => {
	assert.equal(templateGeometry._isSameLevel(null, { levels: new Set(["defaultLevel0000"]) }), true);
});

test("template geometry: ensureTemplateShape accepts region placeables with testPoint", () => {
	assert.equal(templateGeometry.ensureTemplateShape({ testPoint: () => true }), true);
	assert.equal(templateGeometry.ensureTemplateShape(null), false);
});

test("template geometry: getTokensInTemplate returns only tokens inside and on level", () => {
	const tokens = [
		{ level: "L1", object: { id: "in", center: { x: 50, y: 50 } } },
		{ level: "L1", object: { id: "out", center: { x: 500, y: 500 } } },
		{ level: "L2", object: { id: "otherLevel", center: { x: 50, y: 50 } } },
	];
	const templateDoc = {
		id: "tpl-1",
		parent: { tokens, regions: new Map() },
		levels: new Set(["L1"]),
		x: 0,
		y: 0,
		object: {
			shape: {
				contains: (x, y) => x >= 0 && x <= 100 && y >= 0 && y <= 100,
			},
		},
	};
	const inside = templateGeometry.getTokensInTemplate(templateDoc);
	assert.deepEqual(inside.map(t => t.id), ["in"]);
});

// ---------------------------------------------------------------------------
// Duration/focus lifecycle (duration-spell.mjs registry + focus-constants)
// ---------------------------------------------------------------------------

const { MODULE_ID, DURATION_SPELL_FLAG, FOCUS_SPELL_FLAG, _endingFocusSpells } =
	await import("../../scripts/effects/focus-constants.mjs");

const { calculateFocusDuration } = await import("../../scripts/effects/focus-ui.mjs");

test("duration lifecycle: shared lifecycle flags match the module contract", () => {
	assert.equal(MODULE_ID, "shadowdark-extras");
	assert.equal(DURATION_SPELL_FLAG, "activeDurationSpells");
	assert.equal(FOCUS_SPELL_FLAG, "activeFocusSpells");
	assert.ok(_endingFocusSpells instanceof Set);
});

test("focus lifecycle: calculateFocusDuration reports rounds when in combat", () => {
	globalThis.game = {
		combat: { round: 5 },
		time: { worldTime: 1000 },
		i18n: { format: (key, data) => `${key}:${data.count}` },
	};
	assert.equal(
		calculateFocusDuration({ startRound: 3, startTime: 0 }),
		"SHADOWDARK_EXTRAS.focus_tracker.rounds:2"
	);
});

test("focus lifecycle: calculateFocusDuration reports minutes outside combat", () => {
	globalThis.game = {
		combat: null,
		time: { worldTime: 60 }, // 60s = 1 minute
		i18n: { format: (key, data) => `${key}:${data.count}` },
	};
	assert.equal(
		calculateFocusDuration({ startRound: null, startTime: 0 }),
		"SHADOWDARK_EXTRAS.focus_tracker.minutes:1"
	);
});
