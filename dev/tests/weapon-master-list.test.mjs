// Weapon master-list fallback reachability — #107 + #108
// Drives real production code via await import("../../scripts/animation/WeaponAnimationSD.mjs")
// See dev/tests/weapon-drop-shadow.test.mjs for MockSequence pattern that registers
// the effect rather than the test seeding it. Every assertion exercises the
// shared predicate hasWeaponAnimation / getResolvedWeaponAnimation so the three
// entry points (updateItem, canvasReady, createToken) agree.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

// ---- world stand-ins ----
const hooks = {};
let weaponSpritesConfig = {};

function installWorld() {
	globalThis.foundry = {
		applications: { apps: {} },
		utils: {
			hasProperty: (obj, path) => {
				const parts = path.split(".");
				let cur = obj;
				for (const p of parts) { if (cur == null || !(p in cur)) return false; cur = cur[p]; }
				return true;
			},
			deepClone: obj => JSON.parse(JSON.stringify(obj)),
			mergeObject: (a,b) => Object.assign(JSON.parse(JSON.stringify(a)), b),
			getRoute: p => p,
			randomID: () => Math.random().toString(36).slice(2,10),
		},
	};
	globalThis.game = {
		modules: { get: id => ({ active: id === "sequencer" }) },
		settings: {
			get: (mod, key) => {
				if (mod !== MODULE_ID) return true;
				if (key === "animationFxConfig") {
					return { weaponSprites: weaponSpritesConfig, spells:{}, weapons:{}, npcActions:{} };
				}
				if (key === "animationFxCategory_weaponSprites") return true;
				if (key === "enableWeaponAnimations") return true;
				if (key === "animationFxEnabled") return true;
				return true;
			},
		},
		user: { id: "testUser", viewedScene: "sceneA", isGM: true },
		users: { activeGM: { id: "testUser" } },
		system: { id: "shadowdark" },
	};
	globalThis.canvas = {
		tokens: { placeables: [], get: id => globalThis.canvas.tokens.placeables.find(t => t.id === id) ?? null },
		scene: { id: "sceneA" },
		grid: { size: 100 },
		app: { ticker: { add: ()=>{}, remove: ()=>{} } },
	};
	globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; }, once: () => {} };
	globalThis.ui = { notifications: { warn: ()=>{}, error: ()=>{} } };
}

installWorld();

const endEffectsCalls = [];

class MockEffect {
	constructor(seq) { this._seq = seq; }
	name(v) { this._seq._name = v; return this; }
	file() { return this; }
	atLocation(t) { if (t?.id) this._seq._token = t; return this; }
	attachTo(t) { if (t?.id) this._seq._token = t; return this; }
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
}

class MockSequence {
	constructor() { this._name = null; this._token = null; }
	effect() { const e = new MockEffect(this); this._effect = e; return e; }
	async play() {
		if (this._name && this._token) {
			const token = this._token;
			const source = token.document?.uuid ?? `Scene.${globalThis.game.user.viewedScene ?? globalThis.canvas.scene.id}.Token.${token.id}`;
			const sprite = { filters: [] };
			const eff = { data: { name: this._name, source, _id: `play-${token.id}-${this._name}`, sceneId: globalThis.canvas.scene.id }, sprite, spriteContainer: sprite };
			globalThis.Sequencer.EffectManager.effects.push(eff);
		}
	}
}

globalThis.Sequence = MockSequence;
globalThis.Sequencer = {
	EffectManager: {
		endEffects: async filter => { endEffectsCalls.push(filter); },
		getEffects: () => [],
		effects: [],
	},
};
globalThis.PIXI = { filters: {} };
globalThis.PIXI.filters.DropShadowFilter = class { constructor(o){ this.opts=o; } };

const { playWeaponAnimation, hasWeaponAnimation, getResolvedWeaponAnimation, getEffectName, initWeaponAnimations } = await import("../../scripts/animation/WeaponAnimationSD.mjs");

function reset() {
	endEffectsCalls.length = 0;
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequencer.EffectManager.endEffects = async f => endEffectsCalls.push(f);
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	weaponSpritesConfig = {};
	installWorld();
	// re-install sequencer mocks after installWorld (it may reset canvas but not sequencer)
	globalThis.Sequencer.EffectManager.endEffects = async f => endEffectsCalls.push(f);
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequence = MockSequence;
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(o){ this.opts=o; } };
}

function makeToken(id, actor) {
	const t = {
		id,
		name: `Token-${id}`,
		document: { width: 100, texture: { scaleX:1, scaleY:1 }, uuid: `Scene.sceneA.Token.${id}`, actorLink: true },
		actor,
		x:0, y:0, w:100, h:100,
	};
	// getTokensForActor filters on document.actorLink — ensure truthy
	t.document.actorLink = true;
	return t;
}
function makeItem(id, name, equipped=true, flag=null) {
	return {
		id,
		name,
		type: "Weapon",
		system: { equipped },
		getFlag: (mod, key) => (mod===MODULE_ID && key==="weaponAnimation") ? flag : null,
		parent: null,
		actor: null,
	};
}
function makeActor(id, items) {
	const actor = {
		id,
		items,
		isToken: false,
		getFlag: () => null,
	};
	for (const it of items) { it.parent = actor; it.actor = actor; }
	actor.getActiveTokens = () => [];
	return actor;
}

// Seed weaponSprites with a dagger preset (mirrors world 0100: dagger valid, bastard sword has no pattern)
function seedDaggerPreset() {
	weaponSpritesConfig = {
		dagger: { patterns: "dagger", imagePath: "modules/shadowdark-extras/assets/Weapons/dagger.webp", enabled: true, scale:1, offsetX:0.35, offsetY:0.1 },
	};
}

test("hasWeaponAnimation resolves via master list when per-item flag absent", async () => {
	reset();
	seedDaggerPreset();
	const dagger = makeItem("itemD", "Dagger", true, null);
	const sword = makeItem("itemS", "Bastard Sword", true, null);
	assert.equal(hasWeaponAnimation(dagger), true, "dagger with no flag but matching preset must resolve");
	assert.equal(getResolvedWeaponAnimation(dagger)?.imagePath, "modules/shadowdark-extras/assets/Weapons/dagger.webp");
	assert.equal(hasWeaponAnimation(sword), false, "bastard sword with no pattern and no flag must not resolve");
	assert.equal(getResolvedWeaponAnimation(sword), null);
});

test("weapon matching master-list animates on equip with no per-item flag; non-matching does nothing", async () => {
	reset();
	seedDaggerPreset();
	initWeaponAnimations();
	const dagger = makeItem("itemD", "Dagger", true, null);
	const sword = makeItem("itemS", "Bastard Sword", true, null);
	const actor = makeActor("actor1", [dagger, sword]);
	const token = makeToken("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCalls.length = 0;

	const handler = hooks.updateItem;
	assert.ok(handler, "updateItem hook must be registered");

	// Equip Dagger (already equipped:true but handler receives changes.system.equipped)
	await handler(dagger, { system: { equipped: true } }, {}, "testUser");
	// Should have played one effect for dagger, none for sword
	const effs = globalThis.Sequencer.EffectManager.effects;
	assert.equal(effs.length, 1, "dagger should have produced one effect via master list");
	assert.equal(effs[0].data.name, getEffectName(dagger.id));
	assert.ok(endEffectsCalls.some(c=> c.object===token && c.name===getEffectName(dagger.id)), "dedup endEffects must have been called with object: token");

	// Equip sword (non-matching) should not play
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCalls.length = 0;
	await handler(sword, { system: { equipped: true } }, {}, "testUser");
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "bastard sword must not produce effect");
});

test("unequip still stops unconditionally even when config from master list", async () => {
	reset();
	seedDaggerPreset();
	initWeaponAnimations();
	const dagger = makeItem("itemD", "Dagger", true, null);
	const actor = makeActor("actor1", [dagger]);
	const token = makeToken("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	// seed a live effect as if dagger was playing
	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: getEffectName(dagger.id), source: token.document.uuid, _id:"live1" }, sprite:{filters:[]}, spriteContainer:{filters:[]} }
	];
	endEffectsCalls.length = 0;
	const handler = hooks.updateItem;
	// Unequip — should stop even though dagger has master-list config
	await handler(dagger, { system: { equipped: false } }, {}, "testUser");
	assert.ok(endEffectsCalls.length >= 1, "unequip must call endEffects unconditionally");
	assert.ok(endEffectsCalls.some(c=> c.object===token && c.name===getEffectName(dagger.id)), "stop must carry object: token");
	// Also verify origin gate does NOT apply to stop: other userId still stops
	endEffectsCalls.length = 0;
	await handler(dagger, { system: { equipped: false } }, {}, "otherUser");
	assert.ok(endEffectsCalls.length >= 1, "stop must be unconditional regardless of userId");
});

test("unequip stops even when item resolves to nothing — orphan/legacy guard (#102)", async () => {
	reset();
	seedDaggerPreset(); // dagger preset present, but sword still resolves to nothing
	initWeaponAnimations();
	const sword = makeItem("itemS", "Bastard Sword", true, null);
	assert.equal(hasWeaponAnimation(sword), false, "precondition: bastard sword must resolve to nothing");
	const actor = makeActor("actor1", [sword]);
	const token = makeToken("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	// Live effect from before config was removed / legacy effect — no current config would produce it
	globalThis.Sequencer.EffectManager.effects = [
		{ data: { name: getEffectName(sword.id), source: token.document.uuid, _id: "live-legacy" }, sprite: { filters: [] }, spriteContainer: { filters: [] } },
	];
	endEffectsCalls.length = 0;
	const handler = hooks.updateItem;
	await handler(sword, { system: { equipped: false } }, {}, "testUser");
	assert.ok(endEffectsCalls.length >= 1, "unequip must stop even when item has no config (legacy/orphan)");
	assert.ok(endEffectsCalls.some(c => c.object === token && c.name === getEffectName(sword.id)), "stop must carry object: token even for no-config item");
});

test("canvasReady and createToken restore the same set equip produced (master-list)", async () => {
	reset();
	seedDaggerPreset();
	initWeaponAnimations();
	const dagger = makeItem("itemD", "Dagger", true, null);
	const sword = makeItem("itemS", "Bastard Sword", true, null);
	const actor = makeActor("actor1", [dagger, sword]);
	const token = makeToken("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	actor.items = [dagger, sword];

	// canvasReady path (activeGM gate: testUser is activeGM)
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCalls.length = 0;
	const canvasHandler = hooks.canvasReady;
	assert.ok(canvasHandler, "canvasReady hook must be registered");
	await canvasHandler();
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 1, "canvasReady must restore dagger only");
	assert.equal(globalThis.Sequencer.EffectManager.effects[0].data.name, getEffectName(dagger.id));

	// createToken path (only creator plays)
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCalls.length = 0;
	const createHandler = hooks.createToken;
	assert.ok(createHandler, "createToken hook must be registered");
	const tokenDoc = { id: "tok2", uuid: "Scene.sceneA.Token.tok2" };
	// need token in canvas for handler to resolve
	const token2 = makeToken("tok2", actor);
	globalThis.canvas.tokens.placeables = [token, token2];
	// handler checks userId === game.user.id
	await createHandler(tokenDoc, {}, "testUser");
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 1, "createToken must restore dagger only");
	assert.equal(globalThis.Sequencer.EffectManager.effects[0].data.name, getEffectName(dagger.id));

	// Non-matching sword must not appear in either restore
	const swordEffs = globalThis.Sequencer.EffectManager.effects.filter(e=> e.data.name===getEffectName(sword.id));
	assert.equal(swordEffs.length, 0, "bastard sword must not be restored");
});

test("per-item flag still wins and disabled preset disables", async () => {
	reset();
	// preset disabled should not animate
	weaponSpritesConfig = {
		dagger: { patterns: "dagger", imagePath: "modules/shadowdark-extras/assets/Weapons/dagger.webp", enabled: false },
	};
	const daggerNoFlag = makeItem("itemD", "Dagger", true, null);
	assert.equal(hasWeaponAnimation(daggerNoFlag), false, "disabled preset must not resolve");

	// per-item flag enabled with imagePath must resolve even when preset disabled
	const perItem = { enabled: true, imagePath: "modules/shadowdark-extras/assets/Weapons/custom.webp" };
	const daggerWithFlag = makeItem("itemD2", "Dagger", true, perItem);
	assert.equal(hasWeaponAnimation(daggerWithFlag), true, "per-item enabled must resolve regardless of preset disabled");
	assert.equal(getResolvedWeaponAnimation(daggerWithFlag).imagePath, perItem.imagePath);
});

test("explicit per-item disable short-circuits master list — enabled:false is terminal", async () => {
	reset();
	seedDaggerPreset(); // dagger would resolve via master list
	const disabledFlag = { enabled: false, imagePath: "modules/shadowdark-extras/assets/Weapons/dagger.webp" };
	const daggerDisabled = makeItem("itemD", "Dagger", true, disabledFlag);
	assert.equal(hasWeaponAnimation(daggerDisabled), false, "explicit enabled:false must not fall through to master list");
	assert.equal(getResolvedWeaponAnimation(daggerDisabled), null);
	assert.equal(getResolvedWeaponAnimation(daggerDisabled, { enabled: false, imagePath: "x.webp" }), null, "configOverride enabled:false must also be terminal");

	// Must not animate on equip, canvasReady, or createToken either
	initWeaponAnimations();
	const actor = makeActor("actor1", [daggerDisabled]);
	const token = makeToken("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];

	// equip via updateItem must not play
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCalls.length = 0;
	await hooks.updateItem(daggerDisabled, { system: { equipped: true } }, {}, "testUser");
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "explicitly disabled dagger must not animate on equip");

	// canvasReady must not restore it
	globalThis.Sequencer.EffectManager.effects = [];
	await hooks.canvasReady();
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "explicitly disabled dagger must not be restored on canvasReady");

	// createToken must not restore it
	globalThis.Sequencer.EffectManager.effects = [];
	const tokenDoc = { id: "tok2", uuid: "Scene.sceneA.Token.tok2" };
	const token2 = makeToken("tok2", actor);
	globalThis.canvas.tokens.placeables = [token, token2];
	await hooks.createToken(tokenDoc, {}, "testUser");
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "explicitly disabled dagger must not be restored on createToken");

	// Direct play must also be a no-op (covers dialog live preview)
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCalls.length = 0;
	await playWeaponAnimation(token, daggerDisabled);
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "playWeaponAnimation must not play when flag explicitly disabled");
});
