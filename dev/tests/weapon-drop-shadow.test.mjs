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

// Mock Sequence + PIXI for playWeaponAnimation — play() registers the effect the module actually created
class MockEffect {
	constructor(seq) { this._seq = seq; }
	name(v) { this._seq._name = v; return this; }
	file() { return this; }
	atLocation(t) { if (t && t.id) this._seq._token = t; return this; }
	attachTo(t) { if (t && t.id) this._seq._token = t; return this; }
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
	constructor() { this._name = null; this._token = null; this._effect = null; }
	effect() { this._effect = new MockEffect(this); return this._effect; }
	async play() {
		if (this._name && this._token) {
			const token = this._token;
			const source = token.document?.uuid ?? `Scene.${globalThis.game?.user?.viewedScene ?? globalThis.canvas?.scene?.id ?? ""}.Token.${token.id}`;
			const sprite = { filters: [] };
			const eff = { data: { name: this._name, source, _id: `play-${token.id}` }, sprite, spriteContainer: sprite };
			globalThis.Sequencer.EffectManager.effects.push(eff);
			this._created = eff;
		}
		return;
	}
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
		document: { width: 100, texture: { scaleX: 1, scaleY: 1 }, ...(uuid !== undefined ? (uuid ? { uuid } : {}) : {}) },
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

test("weapon playWeaponAnimation dedup carries object and dropShadow isolates by name+source (with uuid fallback)", async () => {
	// ------------------------------------------------------------------
	// Sub-test A: dedup at :223 carries object + dropShadow isolates (uuid present)
	// The caller's own effect comes from MockSequence.play() (built from .name/.attachTo),
	// siblings are hand-seeded colliding effects — dropShadow must hit only the caller's.
	// ------------------------------------------------------------------
	resetMocks();
	installBaseWorld();
	globalThis.Sequence = MockSequence;
	dropShadowInstances = [];
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(opts){ this.opts = opts; dropShadowInstances.push(this);} };

	const tokenA = makeToken("tokA", "Scene.sceneA.Token.tokA");
	const itemId = "itemX";
	const effectName = getEffectName(itemId);

	// Seed only sibling effects — caller's own will be created by play()
	const spriteB = { filters: [] };
	const spriteC = { filters: [] };
	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokB", _id: "effB" }, sprite: spriteB, spriteContainer: spriteB },
		{ data: { name: effectName, source: "Scene.sceneA.Token.tokC", _id: "effC" }, sprite: spriteC, spriteContainer: spriteC },
	];

	const item = makeItem(itemId);
	await playWeaponAnimation(tokenA, item, configOverride);

	// (a) dedup must carry object: token
	assert.ok(endEffectsCalls.length >= 1, "dedup endEffects must have been called");
	const dedup = endEffectsCalls[0];
	assert.equal(dedup.name, effectName, "dedup name must be classification key");
	assert.equal(dedup.object, tokenA, "dedup must carry object: token (see #105, :223)");
	assert.ok(!dedup.name.includes(tokenA.id), "dedup name must not encode token id");

	// (b) dropShadow isolates by name+source — only caller's effect (from play) got filter
	const playEff = globalThis.Sequencer.EffectManager.effects.find(e => e.data._id === "play-tokA");
	assert.ok(playEff, "play() should have registered caller's effect");
	assert.equal(playEff.data.name, effectName, "play-registered name must be classification key");
	assert.equal(playEff.data.source, "Scene.sceneA.Token.tokA", "play-registered source must be token uuid");
	assert.equal(playEff.sprite.filters.length, 1, "caller's effect should have received DropShadow");
	assert.equal(spriteB.filters.length, 0, "tokB's colliding effect must not receive DropShadow");
	assert.equal(spriteC.filters.length, 0, "tokC's colliding effect must not receive DropShadow");
	assert.equal(dropShadowInstances.length, 1, "exactly one DropShadowFilter instance should be created");

	// ------------------------------------------------------------------
	// Sub-test B: fallback precedence — viewedScene vs canvas.scene.id
	// viewedScene takes precedence over canvas.scene.id; when absent, falls back to canvas.
	// ------------------------------------------------------------------
	// B1: viewedScene differs from canvas — viewedScene wins
	resetMocks();
	installBaseWorld();
	globalThis.game.user.viewedScene = "sceneV";
	globalThis.canvas.scene.id = "sceneC";
	globalThis.Sequence = MockSequence;
	dropShadowInstances = [];
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(opts){ this.opts = opts; dropShadowInstances.push(this);} };

	const spriteV = { filters: [] };
	const spriteC2 = { filters: [] }; // sibling on canvas scene
	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: effectName, source: "Scene.sceneC.Token.other", _id: "effC2" }, sprite: spriteC2, spriteContainer: spriteC2 },
		// also seed a sibling that would match the non-winning scene to prove precedence
		{ data: { name: effectName, source: "Scene.sceneC.Token.tokFallbackV", _id: "effWrong" }, sprite: { filters: [] }, spriteContainer: { filters: [] } },
	];
	// caller token without uuid — should derive via viewedScene (sceneV)
	const tokenFallbackV = makeToken("tokFallbackV");
	delete tokenFallbackV.document.uuid;
	// need sibling that matches viewedScene-derived source? We'll keep play-created as winner.
	const itemV = makeItem(itemId);
	await playWeaponAnimation(tokenFallbackV, itemV, configOverride);

	const playV = globalThis.Sequencer.EffectManager.effects.find(e => e.data._id === "play-tokFallbackV");
	assert.ok(playV, "play() should register fallback-V effect");
	assert.equal(playV.data.source, "Scene.sceneV.Token.tokFallbackV", "fallback with viewedScene present must use viewedScene (precedence over canvas)");
	assert.equal(playV.sprite.filters.length, 1, "fallback-V caller's effect should receive DropShadow via viewedScene-derived uuid");
	// sibling on canvas scene must not have been hit
	assert.equal(spriteC2.filters.length, 0, "canvas-scene sibling must not receive DropShadow when viewedScene differs");

	// B2: viewedScene absent — falls back to canvas.scene.id
	resetMocks();
	installBaseWorld();
	delete globalThis.game.user.viewedScene;
	globalThis.game.user.viewedScene = undefined;
	globalThis.canvas.scene.id = "sceneC";
	globalThis.Sequence = MockSequence;
	dropShadowInstances = [];
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(opts){ this.opts = opts; dropShadowInstances.push(this);} };

	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: effectName, source: "Scene.sceneV.Token.other2", _id: "effV2" }, sprite: { filters: [] }, spriteContainer: { filters: [] } },
	];
	const tokenFallbackC = makeToken("tokFallbackC");
	delete tokenFallbackC.document.uuid;
	const itemC = makeItem(itemId);
	await playWeaponAnimation(tokenFallbackC, itemC, configOverride);

	const playC = globalThis.Sequencer.EffectManager.effects.find(e => e.data._id === "play-tokFallbackC");
	assert.ok(playC, "play() should register fallback-C effect");
	assert.equal(playC.data.source, "Scene.sceneC.Token.tokFallbackC", "fallback with viewedScene absent must use canvas.scene.id");
	assert.equal(playC.sprite.filters.length, 1, "fallback-C caller's effect should receive DropShadow via canvas-derived uuid");

	// (c) dedup object still token for fallback paths (already asserted via playV/playC sources, but also check dedup)
	// dedup from last call (B2) should still carry object
	const lastDedup = endEffectsCalls[0];
	assert.equal(lastDedup.object, tokenFallbackC, "fallback dedup still carries object: token");
});
