// Weapon dropShadow + dedup identity regression (see #105)
//
// After #105 effect names are classification keys only (`shadowdark-extras-weapon-<itemId>`).
// Eleven unlinked tokens sharing a base actor share one name by design.
// Two token-scoped queries must carry identity:
//   :223  playWeaponAnimation dedup `endEffects({name, object: token})` — fires on every play (equip, restore, createToken)
//   :355  dropShadow PIXI lookup `effects.filter(e => e.data?.name === effectName && e.data?.source === tokenUuid)` — derives tokenUuid with document.uuid fallback
// This suite drives the real `playWeaponAnimation` (configOverride bypasses unreachable master list) and asserts all three.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

// ---- shared world stand-ins (mirrors weapon-animation-stop.test.mjs) ----
globalThis.foundry = globalThis.foundry ?? { applications: { apps: {} } };
if (!globalThis.foundry.applications) globalThis.foundry.applications = { apps: {} };

const endEffectsCalls = [];
const originalGame = globalThis.game;
const originalSequencer = globalThis.Sequencer;
const originalCanvas = globalThis.canvas;
const originalPIXI = globalThis.PIXI;
const originalSequence = globalThis.Sequence;

function installBaseWorld() {
	globalThis.game = {
		modules: { get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" }) },
		settings: { get: () => true },
		user: { id: "testUser", viewedScene: "sceneA" },
		users: { activeGM: { id: "testUser" }, find: () => ({ id: "testUser" }) },
		scenes: { get: () => null },
	};
	globalThis.Sequencer = {
		EffectManager: {
			endEffects: async filter => endEffectsCalls.push(filter),
			getEffects: () => [],
			effects: [],
		},
	};
	globalThis.canvas = {
		tokens: { placeables: [], get: () => null },
		scene: { id: "sceneA" },
	};
	globalThis.foundry = {
		applications: { apps: {} },
		abstract: { Document: class {} },
		canvas: { placeables: { PlaceableObject: class {} } },
		utils: { hasProperty: (obj, path) => { const parts = path.split("."); let cur = obj; for (const p of parts) { if (cur == null || !(p in cur)) return false; cur = cur[p]; } return true; }, mergeObject: (a,b) => Object.assign(a,b) },
	};
	globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };
}

installBaseWorld();

// Mock Sequence + PIXI for playWeaponAnimation
class MockEffect {
	constructor() {
		this._chain = this;
	}
	name() { return this; }
	file() { return this; }
	atLocation() { return this; }
	attachTo() { return this; }
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
}

class MockSequence {
	constructor() {}
	effect() { return new MockEffect(); }
	async play() { return; }
}

globalThis.Sequence = MockSequence;
globalThis.PIXI = globalThis.PIXI ?? {};
globalThis.PIXI.filters = globalThis.PIXI.filters ?? {};
let dropShadowInstances = [];
globalThis.PIXI.filters.DropShadowFilter = class {
	constructor(opts) { this.opts = opts; dropShadowInstances.push(this); }
};

const { playWeaponAnimation, getEffectName } = await import("../../scripts/animation/WeaponAnimationSD.mjs");

function resetMocks() {
	endEffectsCalls.length = 0;
	dropShadowInstances.length = 0;
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequencer.EffectManager.endEffects = async filter => endEffectsCalls.push(filter);
	globalThis.Sequencer.EffectManager.getEffects = () => [];
}

function makeToken(id, uuid) {
	return {
		id,
		name: `Token-${id}`,
		document: { width: 100, texture: { scaleX: 1, scaleY: 1 }, ...(uuid ? { uuid } : {}) },
		actor: { id: `actor-${id}` },
	};
}

function makeItem(id) {
	return {
		id,
		name: `Weapon-${id}`,
		type: "Weapon",
		system: { equipped: true },
		getFlag: () => null,
		parent: null,
	};
}

test("weapon playWeaponAnimation dedup carries object and dropShadow isolates by name+source (with uuid fallback)", async () => {
	// ------------------------------------------------------------------
	// Sub-test A: dedup at :223 carries object + dropShadow isolates (uuid present)
	// ------------------------------------------------------------------
	resetMocks();
	installBaseWorld();
	globalThis.Sequence = MockSequence;
	dropShadowInstances = [];
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(opts){ this.opts = opts; dropShadowInstances.push(this);} };

	const tokenA = makeToken("tokA", "Scene.sceneA.Token.tokA");
	const tokenB = makeToken("tokB", "Scene.sceneA.Token.tokB");
	const tokenC = makeToken("tokC", "Scene.sceneA.Token.tokC");
	const itemId = "itemX";
	const effectName = getEffectName(itemId);

	// Three effects sharing one name on three sources — only tokA should get shadow
	const spriteA = { filters: [] };
	const spriteB = { filters: [] };
	const spriteC = { filters: [] };
	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokA", _id: "effA" }, sprite: spriteA, spriteContainer: spriteA },
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokB", _id: "effB" }, sprite: spriteB, spriteContainer: spriteB },
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokC", _id: "effC" }, sprite: spriteC, spriteContainer: spriteC },
	];

	const item = makeItem(itemId);
	const configOverride = {
		enabled: true,
		imagePath: "modules/shadowdark-extras/assets/Weapons/test.webp",
		scale: 1,
		offsetX: 0.35,
		offsetY: 0.1,
		filters: { dropShadow: { enabled: true, color: "#000000", alpha: 0.5, blur: 2, distance: 5, rotation: 45 } },
		animationType: "none",
		wobble: false,
	};

	await playWeaponAnimation(tokenA, item, configOverride);

	// (a) dedup must carry object: token
	assert.ok(endEffectsCalls.length >= 1, "dedup endEffects must have been called");
	const dedup = endEffectsCalls[0];
	assert.equal(dedup.name, effectName, "dedup name must be classification key");
	assert.equal(dedup.object, tokenA, "dedup must carry object: token (see #105, :223)");
	assert.ok(!dedup.name.includes(tokenA.id), "dedup name must not encode token id");

	// (b) dropShadow isolates by name+source — only tokA's sprite got filter
	assert.equal(spriteA.filters.length, 1, "tokA's effect should have received DropShadow");
	assert.equal(spriteB.filters.length, 0, "tokB's colliding effect must not receive DropShadow");
	assert.equal(spriteC.filters.length, 0, "tokC's colliding effect must not receive DropShadow");
	assert.ok(dropShadowInstances.length === 1, "exactly one DropShadowFilter instance should be created");

	// ------------------------------------------------------------------
	// Sub-test B: fallback path — token without document.uuid uses viewedScene/canvas.scene.id
	// ------------------------------------------------------------------
	resetMocks();
	installBaseWorld();
	globalThis.game.user.viewedScene = "sceneA";
	globalThis.canvas.scene.id = "sceneA";
	globalThis.Sequence = MockSequence;
	dropShadowInstances = [];
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(opts){ this.opts = opts; dropShadowInstances.push(this);} };
	// keep same effectName
	const spriteFallbackA = { filters: [] };
	const spriteFallbackB = { filters: [] };
	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokFallback", _id: "effFallback" }, sprite: spriteFallbackA, spriteContainer: spriteFallbackA },
		{ data: { name: effectName, source: "Scene.sceneA.Token.other", _id: "effOther" }, sprite: spriteFallbackB, spriteContainer: spriteFallbackB },
	];
	const tokenFallback = makeToken("tokFallback"); // no uuid -> fallback
	delete tokenFallback.document.uuid;
	const item2 = makeItem(itemId);
	await playWeaponAnimation(tokenFallback, item2, configOverride);

	// (c) fallback-derived uuid still isolates
	const dedup2 = endEffectsCalls[0];
	// dedup object still token (not string)
	assert.equal(dedup2.object, tokenFallback, "fallback dedup still carries object: token");
	// dropShadow via fallback should hit only tokFallback
	assert.equal(spriteFallbackA.filters.length, 1, "fallback token's effect should receive DropShadow via derived uuid");
	assert.equal(spriteFallbackB.filters.length, 0, "other token must not receive DropShadow via fallback");
});
