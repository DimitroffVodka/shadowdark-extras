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
	applications: {
		api: {
			ApplicationV2: class ApplicationV2 {},
			HandlebarsApplicationMixin: (cls) => cls,
		},
	},
	documents: { RegionDocument: { implementation: class RegionDocument {} } },
	canvas: { geometry: { Ray: class Ray {} } },
	utils: { deepClone: v => JSON.parse(JSON.stringify(v)) },
};
globalThis.CONFIG = { Canvas: {} };
globalThis.Hooks = { on: () => {}, off: () => {}, callAll: () => {}, call: () => {} };

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

// ---------------------------------------------------------------------------
// Aura region identity, movement, cleanup (aura-regions.mjs + aura-geometry.mjs)
// ---------------------------------------------------------------------------

const auraRegions = await import("../../scripts/effects/aura-regions.mjs");

test("aura regions: deleteAuraRegion removes the regionId region and any aura-flagged region", async () => {
	makeCanvas();
	const deleted = [];
	globalThis.canvas.scene.regions = [
		{ id: "region-by-id", flags: {} },
		{ id: "region-by-flag", flags: { "shadowdark-extras": { auraRegion: true, auraEffectId: "effect-1" } } },
		{ id: "unrelated", flags: {} },
	];
	globalThis.canvas.scene.deleteEmbeddedDocuments = async (type, ids) => deleted.push(...ids);

	const effect = {
		id: "effect-1",
		flags: { "shadowdark-extras": { aura: { regionId: "region-by-id" } } },
	};
	await auraRegions.deleteAuraRegion(effect);
	assert.deepEqual(deleted.sort(), ["region-by-flag", "region-by-id"].sort());
});

test("aura regions: deleteAuraRegion is a no-op when no scene is active", async () => {
	globalThis.canvas = undefined;
	await auraRegions.deleteAuraRegion({ id: "e", flags: { "shadowdark-extras": { aura: {} } } });
	makeCanvas(); // restore
});

test("aura regions: removeExistingAurasForSource returns early for non-GM clients", async () => {
	makeCanvas();
	globalThis.game = { user: { isGM: false } };
	let deleteCalled = false;
	const actor = {
		id: "actor-1",
		effects: [{ id: "e1", flags: { "shadowdark-extras": { aura: { enabled: true, spellId: "spell-1" } } } }],
		deleteEmbeddedDocuments: async () => { deleteCalled = true; },
	};
	await auraRegions.removeExistingAurasForSource(actor, { id: "spell-1", uuid: "Item.spell-1" });
	assert.equal(deleteCalled, false);
});

test("aura movement: getTokensInAura reflects a token moving in and out of radius", () => {
	const { placeables } = makeCanvas({ gridSize: 100, gridDistance: 5 });
	const source = makeToken("src", 100, 100);
	const mover = makeToken("mover", 150, 100); // 50px away -> inside 10ft (200px)
	placeables.push(source, mover);

	const inside = auraGeometry.getTokensInAura(source, 10, "all", false);
	assert.deepEqual(inside.map(t => t.id), ["mover"]);

	// Move the token 400px away -> outside 10ft (200px)
	mover.center = { x: 500, y: 100 };
	const outside = auraGeometry.getTokensInAura(source, 10, "all", false);
	assert.deepEqual(outside.map(t => t.id), []);

	// Move it back inside
	mover.center = { x: 200, y: 100 };
	const reentered = auraGeometry.getTokensInAura(source, 10, "all", false);
	assert.deepEqual(reentered.map(t => t.id), ["mover"]);
});

// ---------------------------------------------------------------------------
// Template region create/update/delete (template-geometry.mjs + template-conditions.mjs)
// ---------------------------------------------------------------------------

const templateConditions = await import("../../scripts/effects/template-conditions.mjs");

test("template region containment: getTemplatesContainingPoint uses region testPoint and level filter", () => {
	const regionA = {
		id: "region-a",
		levels: new Set(["L1"]),
		testPoint: ({ x, y }) => x <= 200 && y <= 200,
	};
	const regionB = {
		id: "region-b",
		levels: new Set(["L2"]),
		testPoint: () => true,
	};
	const scene = { regions: [regionA, regionB] };

	const fromL1 = templateGeometry.getTemplatesContainingPoint(100, 100, scene, "L1", 0);
	assert.deepEqual(fromL1.map(r => r.id), ["region-a"]);

	const fromL2 = templateGeometry.getTemplatesContainingPoint(100, 100, scene, "L2", 0);
	assert.deepEqual(fromL2.map(r => r.id), ["region-b"]);

	const outside = templateGeometry.getTemplatesContainingPoint(500, 500, scene, "L1", 0);
	assert.deepEqual(outside.map(r => r.id), []);
});

test("template region containment: getTemplatesContainingToken respects elevation via region testPoint", () => {
	makeCanvas();
	const token = {
		id: "t",
		center: { x: 100, y: 100 },
		document: { level: "L1", elevation: 3 },
	};
	globalThis.canvas.scene.regions = [
		{
			id: "region-ground",
			levels: new Set(["L1"]),
			testPoint: ({ elevation }) => elevation === 0,
		},
		{
			id: "region-elev3",
			levels: new Set(["L1"]),
			testPoint: ({ elevation }) => elevation === 3,
		},
	];
	const found = templateGeometry.getTemplatesContainingToken(token);
	assert.deepEqual(found.map(r => r.id), ["region-elev3"]);
});

test("template region delete: removeTemplateEffects removes only matching template effects", async () => {
	const removed = [];
	const actor = {
		id: "actor-1",
		items: [
			{ id: "fx-1", type: "Effect", origin: "Scene.s.Template.tpl-1", getFlag: () => null },
			{ id: "fx-2", type: "Effect", origin: "Scene.s.Template.other", getFlag: () => null },
			{ id: "item-3", type: "Weapon", origin: "Scene.s.Template.tpl-1", getFlag: () => null },
		],
		deleteEmbeddedDocuments: async (type, ids) => removed.push(...ids),
	};
	const templateDoc = {
		id: "tpl-1",
		uuid: "Scene.s.Template.tpl-1",
		flags: { "shadowdark-extras": { templateEffects: { enabled: true } } },
	};
	globalThis.game = { actors: { get: () => null } };
	const token = { id: "tok-1", actor, name: "Hero" };

	await templateConditions.removeTemplateEffects(templateDoc, token);
	assert.deepEqual(removed, ["fx-1"]);
});

// ---------------------------------------------------------------------------
// Focus/duration lifecycle state transitions (duration-spell.mjs + focus-spell.mjs)
// ---------------------------------------------------------------------------

const durationSpell = await import("../../scripts/effects/duration-spell.mjs");
const focusSpell = await import("../../scripts/effects/focus-spell.mjs");

function makeActorWithFlags(initial = {}) {
	const store = { ...initial };
	return {
		id: "actor-1",
		name: "Wizard",
		effects: [],
		getFlag: (_module, key) => store[key],
		setFlag: async (_module, key, value) => { store[key] = value; },
		deleteEmbeddedDocuments: async () => {},
		createEmbeddedDocuments: async () => [],
		items: { get: () => null, filter: () => [], find: () => null },
	};
}

test("duration lifecycle: startDurationSpell writes a new entry and endDurationSpell removes it", async () => {
	const actor = makeActorWithFlags();
	const spell = {
		id: "spell-1",
		name: "Web",
		img: "web.png",
		system: { duration: { value: 2, type: "rounds" } },
	};
	globalThis.game = {
		combat: { round: 3 },
		time: { worldTime: 100 },
		user: { isGM: true },
		actors: { get: () => actor, contents: [] },
		i18n: { format: (key, data) => `${key}:${data.spellName}`, localize: key => key },
	};
	globalThis.ui = { notifications: { info: () => {} } };
	globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
	makeCanvas();

	const entry = await durationSpell.startDurationSpell(actor, spell, [], {});
	assert.equal(entry.spellId, "spell-1");
	assert.equal(entry.startRound, 3);
	assert.equal(entry.expiryRound, 5); // round 3 + 2 rounds

	const active = durationSpell.getActiveDurationSpells(actor);
	assert.equal(active.length, 1);
	assert.equal(active[0].instanceId, entry.instanceId);

	await durationSpell.endDurationSpell(actor.id, entry.instanceId, "expired");
	assert.equal(durationSpell.getActiveDurationSpells(actor).length, 0);
});

test("duration lifecycle: endDurationSpell with an unknown instance is a safe no-op", async () => {
	const actor = makeActorWithFlags();
	globalThis.game = {
		combat: { round: 1 },
		time: { worldTime: 10 },
		user: { isGM: true },
		actors: { get: () => actor, contents: [] },
		i18n: { format: (key, data) => `${key}:${data.spellName}` },
	};
	globalThis.ui = { notifications: { info: () => {} } };
	await durationSpell.endDurationSpell(actor.id, "no-such-instance", "expired");
	assert.equal(durationSpell.getActiveDurationSpells(actor).length, 0);
});

test("focus lifecycle: startFocusSpell registers the spell and endFocusSpell clears it", async () => {
	const actor = makeActorWithFlags();
	actor.createEmbeddedDocuments = async () => [{ id: "conc-1" }];
	const spell = {
		id: "spell-2",
		name: "Hold Person",
		img: "hold.png",
		type: "spell",
		uuid: "Item.spell-2",
		system: {
			tier: 2,
			spellcasting: { ability: "INT" },
			description: "",
			class: [],
			spellName: "Hold Person",
		},
	};
	globalThis.game = {
		combat: { round: 1 },
		time: { worldTime: 100 },
		user: { isGM: true },
		actors: { get: () => actor },
		i18n: { format: (key, data) => `${key}:${data.spellName}`, localize: key => key },
	};
	globalThis.ui = { notifications: { info: () => {} } };
	globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
	makeCanvas();

	await focusSpell.startFocusSpell(actor, spell, {});
	assert.equal(focusSpell.isFocusingOnSpell(actor, "spell-2"), true);
	assert.equal(focusSpell.getActiveFocusSpells(actor).length, 1);
	assert.equal(focusSpell.getActiveFocusSpells(actor)[0].concentrationEffectId, "conc-1");

	await focusSpell.endFocusSpell(actor.id, "spell-2", "manual");
	assert.equal(focusSpell.isFocusingOnSpell(actor, "spell-2"), false);
	assert.equal(focusSpell.getActiveFocusSpells(actor).length, 0);
});

test("focus lifecycle: endFocusSpell re-entrancy guard releases after completion", async () => {
	const actor = makeActorWithFlags();
	globalThis.game = {
		combat: { round: 1 },
		time: { worldTime: 100 },
		user: { isGM: true },
		actors: { get: () => actor },
		i18n: { format: (key, data) => `${key}:${data.spellName}` },
	};
	globalThis.ui = { notifications: { info: () => {} } };
	globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
	_endingFocusSpells.clear();
	assert.equal(_endingFocusSpells.size, 0);
	await focusSpell.endFocusSpell("actor-1", "spell-ghost", "manual");
	assert.equal(_endingFocusSpells.size, 0);
});
