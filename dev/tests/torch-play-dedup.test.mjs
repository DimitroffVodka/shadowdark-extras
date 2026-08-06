// Torch play-time dedup identity regression (see #109, mirrors #105 weapon cover in 111045a9)
//
// After #105 effect names are classification keys only (`shadowdark-extras-torch-<itemId>`).
// Unlinked tokens sharing a base actor share one name by design — safe only because
// `object`/`source` disambiguates. Two token-scoped queries at :173-174 must carry identity:
//   :173  playTorchAnimation dedup `endEffects({name: effectName, object: token})`
//   :174  playTorchAnimation dedup `endEffects({name: effectName + "_impact", object: token})`
// Both fire on every light toggle, every canvasReady restore, and every createToken.
// This suite drives the real `playTorchAnimation` and asserts both lines carry object
// and that the effect the module names and creates is the one it later finds.
// Torch has two deliberate `.effect()` layers sharing one `.name()` (config.torchFile
// and config.flameFile) — the mock must not treat the second as a duplicate.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

// ---- world stand-ins (mirrors weapon-drop-shadow.test.mjs) ----
const endEffectsCalls = [];
const orderedEvents = [];

function installBaseWorld() {
	globalThis.game = {
		modules: {
			get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" || id === "jb2a_patreon" }),
		},
		settings: {
			get: (mid, key) => {
				if (key === "enableTorchAnimations") return true;
				if (key === "animationFxAmbient") return {};
				if (key === "animationFxConfig") return { weaponSprites: {} };
				if (key && key.startsWith("animationFxCategory_")) return true;
				return true;
			},
		},
		user: { id: "testUser", viewedScene: "sceneA" },
		users: { activeGM: { id: "testUser" }, find: () => ({ id: "testUser" }) },
		scenes: { get: () => null },
	};
	globalThis.Sequencer = {
		EffectManager: {
			endEffects: async filter => { endEffectsCalls.push(filter); orderedEvents.push("end"); },
			getEffects: () => [],
			effects: [],
		},
		Database: {
			entryExists: () => false,
			getEntry: () => null,
		},
	};
	globalThis.canvas = {
		tokens: { placeables: [], get: () => null },
		scene: { id: "sceneA" },
		grid: { size: 100 },
		app: { ticker: { add: () => {}, remove: () => {} } },
	};
	globalThis.foundry = {
		applications: { apps: {} },
		abstract: { Document: class {} },
		canvas: { placeables: { PlaceableObject: class {} } },
		utils: {
			hasProperty: (obj, path) => {
				const parts = path.split(".");
				let cur = obj;
				for (const p of parts) {
					if (cur == null || !(p in cur)) return false;
					cur = cur[p];
				}
				return true;
			},
			mergeObject: (a, b) => Object.assign(a ?? {}, b ?? {}),
			deepClone: o => JSON.parse(JSON.stringify(o ?? {})),
			getRoute: p => p,
			randomID: () => "rand1234",
		},
	};
	globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };
	globalThis.ui = { notifications: { warn: () => {}, error: () => {} } };
}

installBaseWorld();

// Mock Sequence — supports multiple .effect() layers (torch has 2 sharing one name + 1 _impact)
// Each .effect() creates a new def; play() registers one CanvasEffect-shaped fixture per def.
class MockEffect {
	constructor(def) {
		this._def = def;
	}
	name(v) { this._def._name = v; return this; }
	file() { return this; }
	atLocation(t) { if (t && t.id) this._def._token = t; return this; }
	attachTo(t) { if (t && t.id) this._def._token = t; return this; }
	scaleToObject() { return this; }
	scaleIn() { return this; }
	scaleOut() { return this; }
	spriteOffset() { return this; }
	spriteRotation() { return this; }
	spriteScale() { return this; }
	filter() { return this; }
	persist() { return this; }
	zIndex() { return this; }
	loopProperty() { return this; }
	animateProperty() { return this; }
	delay() { return this; }
	aboveLighting() { return this; }
	opacity() { return this; }
}

class MockSequence {
	constructor() { this._defs = []; }
	effect() {
		const def = { _name: null, _token: null };
		this._defs.push(def);
		return new MockEffect(def);
	}
	sound() { return { file: () => this, volume: () => this }; }
	async play() {
		orderedEvents.push("play");
		for (const def of this._defs) {
			if (def._name && def._token) {
				const token = def._token;
				const source = token.document?.uuid ?? `Scene.${globalThis.game?.user?.viewedScene ?? globalThis.canvas?.scene?.id ?? ""}.Token.${token.id}`;
				const sprite = { filters: [] };
				// Use name+token+index to keep _ids unique even for duplicate-named layers
				const idx = globalThis.Sequencer.EffectManager.effects.length;
				const eff = {
					data: { name: def._name, source, _id: `play-${token.id}-${def._name}-${idx}` },
					sprite,
					spriteContainer: sprite,
				};
				globalThis.Sequencer.EffectManager.effects.push(eff);
			}
		}
		return;
	}
}

globalThis.Sequence = MockSequence;

const { playTorchAnimation, getEffectName, initTorchAnimations } = await import("../../scripts/animation/TorchAnimationSD.mjs");

function resetMocks() {
	endEffectsCalls.length = 0;
	orderedEvents.length = 0;
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequencer.EffectManager.endEffects = async filter => { endEffectsCalls.push(filter); orderedEvents.push("end"); };
	globalThis.Sequencer.EffectManager.getEffects = () => [];
}

function makeToken(id, uuid) {
	return {
		id,
		name: `Token-${id}`,
		document: {
			width: 100,
			texture: { scaleX: 1, scaleY: 1 },
			...(uuid !== undefined ? (uuid ? { uuid } : {}) : { uuid: `Scene.sceneA.Token.${id}` }),
		},
		actor: { id: `actor-${id}` },
	};
}

function makeItem(id, name = "Torch") {
	return {
		id,
		name,
		type: "Light",
		system: { light: { template: "torch", active: true } },
		getFlag: () => null,
		parent: null,
	};
}

test("torch playTorchAnimation dedup carries object for both base and _impact and registers expected names", async () => {
	// Single behavioural test covering all three breakable invariants:
	// - dedup at :173 carries object
	// - dedup at :174 (_impact) carries object
	// - play-registered effect names are the classification keys (rename at play time → red)
	// The mock's play() registers the effect the module actually names; siblings are hand-seeded.
	resetMocks();
	installBaseWorld();
	globalThis.Sequence = MockSequence;

	const tokenA = makeToken("tokA");
	const itemId = "itemX";
	const effectName = getEffectName(itemId);
	const impactName = `${effectName}_impact`;

	// Seed only sibling effects on OTHER tokens — same classification keys colliding by design
	const spriteB = { filters: [] };
	const spriteC = { filters: [] };
	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokB", _id: "effB" }, sprite: spriteB, spriteContainer: spriteB },
		{ data: { name: impactName, source: "Scene.sceneA.Token.tokB", _id: "effB-impact" }, sprite: { filters: [] }, spriteContainer: { filters: [] } },
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokC", _id: "effC" }, sprite: spriteC, spriteContainer: spriteC },
		{ data: { name: impactName, source: "Scene.sceneA.Token.tokC", _id: "effC-impact" }, sprite: { filters: [] }, spriteContainer: { filters: [] } },
	];

	const item = makeItem(itemId);
	await playTorchAnimation(tokenA, item);

	// (a) dedup must carry object: token for BOTH lines independently (order-independent)
	assert.ok(endEffectsCalls.length >= 2, `dedup should have called endEffects twice (got ${endEffectsCalls.length}): ${JSON.stringify(endEffectsCalls)}`);
	const dedupBase = endEffectsCalls.find(c => c.name === effectName);
	const dedupImpact = endEffectsCalls.find(c => c.name === impactName);
	assert.ok(dedupBase, `dedup :173 must have been called with ${effectName}`);
	assert.equal(dedupBase.object, tokenA, "dedup :173 must carry object: token (see #105)");
	assert.ok(!dedupBase.name.includes(tokenA.id), "dedup base name must not encode token id");
	assert.ok(dedupImpact, `dedup :174 must have been called with ${impactName}`);
	assert.equal(dedupImpact.object, tokenA, "dedup :174 must carry object: token (see #105 _impact variant)");
	assert.ok(!dedupImpact.name.includes(tokenA.id), "dedup _impact name must not encode token id");
	// dedup must precede play — otherwise the effect is created then immediately terminated
	const firstPlayIdx = orderedEvents.indexOf("play");
	assert.notEqual(firstPlayIdx, -1, "play() must have been called");
	assert.equal(orderedEvents.filter(e => e === "end").length, 2, "exactly two dedup ends expected before play");
	assert.ok(firstPlayIdx > 1, `both dedup ends must precede play (events: ${orderedEvents.join(",")})`);
	assert.ok(orderedEvents.slice(0, firstPlayIdx).every(e => e === "end"), "no play before dedup completes");

	// (b) play-registered effects are the ones the module actually named — rename at play time → red
	// Torch has two deliberate layers sharing one name (torchFile + flameFile) plus one _impact.
	// All three are registered; we assert at least one of each kind exists with correct source.
	const playBaseEffects = globalThis.Sequencer.EffectManager.effects.filter(
		e => e.data.name === effectName && e.data.source === "Scene.sceneA.Token.tokA",
	);
	const playImpactEffects = globalThis.Sequencer.EffectManager.effects.filter(
		e => e.data.name === impactName && e.data.source === "Scene.sceneA.Token.tokA",
	);
	assert.ok(playBaseEffects.length >= 1, `play() should have registered base effect(s) named ${effectName} for tokA (got ${JSON.stringify(globalThis.Sequencer.EffectManager.effects.map(e=>e.data))})`);
	assert.ok(playImpactEffects.length >= 1, `play() should have registered _impact effect named ${impactName} for tokA`);
	// Duplicate layers sharing one name must NOT be treated as a bug — we expect 2 base layers
	assert.equal(playBaseEffects.length, 2, "torch registers two base layers sharing one name (torchFile + flameFile) — not a duplicate");
	assert.equal(playImpactEffects.length, 1, "single _impact layer expected when patreon is active");

	// (c) classification keys must not encode token ids at play time either
	for (const eff of [...playBaseEffects, ...playImpactEffects]) {
		assert.ok(!eff.data.name.includes(tokenA.id), "play-registered name must not encode token id");
	}
});

test("deleteToken hook ends every torch effect for the deleted token (source-verified)", async () => {
	resetMocks();
	installBaseWorld();
	globalThis.Sequence = MockSequence;
	const hooks = {};
	const origHooks = globalThis.Hooks;
	globalThis.Hooks = {
		on: (name, fn) => { hooks[name] = fn; },
		once: () => {},
		callAll: () => {},
	};
	// Re-install world after Hooks swap so init sees the capturing Hooks
	globalThis.game.modules = { get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" || id === "jb2a_patreon" }) };
	globalThis.game.settings = {
		get: (mid, key) => {
			if (key === "enableTorchAnimations") return true;
			if (key === "animationFxAmbient") return {};
			if (key === "animationFxConfig") return { weaponSprites: {} };
			if (key && key.startsWith("animationFxCategory_")) return true;
			return true;
		},
	};
	initTorchAnimations();
	globalThis.Hooks = origHooks;

	const handler = hooks.deleteToken;
	assert.ok(typeof handler === "function", "deleteToken hook registered");

	const tokenDoc = { id: "tokA", uuid: `Scene.sceneA.Token.tokA` };
	await handler(tokenDoc, {}, globalThis.game.user.id);

	assert.equal(endEffectsCalls.length, 1);
	const filter = endEffectsCalls[0];
	assert.equal(filter.name, `${MODULE_ID}-torch-*`);
	// Document avoids uuid-string lookup which throws for deleted token (dist:475-480, 11718-11720); name wildcard keeps kind-scoped
	assert.equal(filter.source, tokenDoc, "delete must carry source: tokenDoc (not name-only, not object)");
});
