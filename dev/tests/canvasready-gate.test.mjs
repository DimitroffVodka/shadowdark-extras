// canvasReady gate ordering regression — #110 (+ review follow-ups)
// Drives real production via await import("../../scripts/animation/*.mjs")
// Defect: gate at t=0 before sleep; fix: bounded poll before gate, both
// weapon and torch now on sequencerEffectManagerReady so dedup sees persisted.
// Tests cover: poll-before-gate, election, legacy dedup, weapon persisted,
// overlapping readiness, timeout observable.

import assert from "node:assert/strict";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";

// ---- shared world stand-ins ----
const hooksWeapon = {};
const hooksTorch = {};
let weaponSpritesConfig = {};

function installBaseWorld() {
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
	globalThis.canvas = {
		tokens: { placeables: [], get: id => globalThis.canvas.tokens.placeables.find(t => t.id === id) ?? null },
		scene: { id: "sceneA" },
		grid: { size: 100 },
		app: { ticker: { add: ()=>{}, remove: ()=>{} } },
	};
	globalThis.ui = { notifications: { warn: ()=>{}, error: ()=>{} } };
	globalThis.PIXI = { filters: {} };
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(o){ this.opts=o; } };
}

// Weapon mocks
const endEffectsCallsWeapon = [];
class MockEffectW { constructor(seq){ this._seq = seq; } name(v){ this._seq._name=v; return this; } file(){return this;} atLocation(t){ if(t?.id) this._seq._token=t; return this; } attachTo(t){ if(t?.id) this._seq._token=t; return this; } scaleToObject(){return this;} scaleIn(){return this;} scaleOut(){return this;} spriteOffset(){return this;} spriteRotation(){return this;} spriteScale(){return this;} filter(){return this;} persist(){return this;} zIndex(){return this;} loopProperty(){return this;} }
class MockSequenceW { constructor(){ this._name=null; this._token=null; } effect(){ const e=new MockEffectW(this); this._effect=e; return e; } async play(){ if(this._name && this._token){ const token=this._token; const source=token.document?.uuid ?? `Scene.${globalThis.game.user.viewedScene ?? globalThis.canvas.scene.id}.Token.${token.id}`; const sprite={filters:[]}; const eff={ data:{ name:this._name, source, _id:`play-${token.id}-${this._name}`, sceneId: globalThis.canvas.scene.id }, sprite, spriteContainer: sprite }; globalThis.Sequencer.EffectManager.effects.push(eff); }}}

// Torch mocks (multi-layer)
const endEffectsCallsTorch = [];
const orderedTorch = [];
class MockEffectT { constructor(def){ this._def=def; } name(v){ this._def._name=v; return this; } file(){return this;} atLocation(t){ if(t&&t.id) this._def._token=t; return this; } attachTo(t){ if(t&&t.id) this._def._token=t; return this; } scaleToObject(){return this;} scaleIn(){return this;} scaleOut(){return this;} spriteOffset(){return this;} spriteRotation(){return this;} spriteScale(){return this;} filter(){return this;} persist(){return this;} zIndex(){return this;} loopProperty(){return this;} animateProperty(){return this;} delay(){return this;} aboveLighting(){return this;} opacity(){return this;} }
class MockSequenceT { constructor(){ this._defs=[]; } effect(){ const def={_name:null,_token:null}; this._defs.push(def); return new MockEffectT(def); } sound(){ return { file:()=>this, volume:()=>this }; } async play(){ orderedTorch.push("play"); for(const def of this._defs){ if(def._name && def._token){ const token=def._token; const source=token.document?.uuid ?? `Scene.${globalThis.game?.user?.viewedScene ?? globalThis.canvas.scene.id}.Token.${token.id}`; const sprite={filters:[]}; const idx=globalThis.Sequencer.EffectManager.effects.length; const eff={ data:{ name:def._name, source, _id:`play-${token.id}-${def._name}-${idx}` }, sprite, spriteContainer: sprite }; globalThis.Sequencer.EffectManager.effects.push(eff); }} return; }}

// Install world before import so module sees globals
installBaseWorld();
globalThis.game = {
	modules: { get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" || id === "jb2a_patreon" }) },
	settings: {
		get: (mod, key) => {
			if (mod !== MODULE_ID) return true;
			if (key === "animationFxConfig") return { weaponSprites: weaponSpritesConfig, spells:{}, weapons:{}, npcActions:{} };
			if (key === "animationFxCategory_weaponSprites") return true;
			if (key === "enableWeaponAnimations") return true;
			if (key === "animationFxEnabled") return true;
			if (key === "enableTorchAnimations") return true;
			if (key === "animationFxAmbient") return {};
			return true;
		},
	},
	user: { id: "testUser", viewedScene: "sceneA", isGM: true },
	users: { activeGM: { id: "testUser" } },
	system: { id: "shadowdark" },
};
globalThis.Hooks = { on: (name, fn) => { hooksWeapon[name]=fn; hooksTorch[name]=fn; }, once: ()=>{}, callAll: ()=>{}};
globalThis.Sequencer = { EffectManager: { endEffects: async f=>{ endEffectsCallsWeapon.push(f); }, getEffects: ()=>[], effects: [] }, Database: { entryExists: ()=>false, getEntry: ()=>null } };
globalThis.Sequence = MockSequenceW;

const weaponMod = await import("../../scripts/animation/WeaponAnimationSD.mjs");
const torchMod = await import("../../scripts/animation/TorchAnimationSD.mjs");

function resetWeapon() {
	endEffectsCallsWeapon.length = 0;
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequencer.EffectManager.endEffects = async f => endEffectsCallsWeapon.push(f);
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	weaponSpritesConfig = {};
	installBaseWorld();
	globalThis.game = {
		modules: { get: id => ({ active: id === "sequencer" }) },
		settings: {
			get: (mod, key) => {
				if (mod !== MODULE_ID) return true;
				if (key === "animationFxConfig") return { weaponSprites: weaponSpritesConfig, spells:{}, weapons:{}, npcActions:{} };
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
	globalThis.canvas.tokens.placeables = [];
	globalThis.canvas.scene = { id: "sceneA" };
	globalThis.Sequencer.EffectManager.endEffects = async f => endEffectsCallsWeapon.push(f);
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequence = MockSequenceW;
	globalThis.PIXI.filters.DropShadowFilter = class { constructor(o){ this.opts=o; } };
	globalThis.Hooks = { on: (name, fn) => { hooksWeapon[name]=fn; }, once: ()=>{}, callAll: ()=>{} };
}

function resetTorch() {
	endEffectsCallsTorch.length = 0;
	orderedTorch.length = 0;
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequencer.EffectManager.endEffects = async f => { endEffectsCallsTorch.push(f); orderedTorch.push("end"); };
	globalThis.Sequencer.EffectManager.getEffects = () => [];
	installBaseWorld();
	globalThis.game = {
		modules: { get: id => ({ active: id === "sequencer" || id === "JB2A_DnD5e" || id === "jb2a_patreon" }) },
		settings: {
			get: (mid, key) => {
				if (key === "enableTorchAnimations") return true;
				if (key === "animationFxAmbient") return {};
				if (key === "animationFxConfig") return { weaponSprites: {} };
				if (key && key.startsWith("animationFxCategory_")) return true;
				return true;
			},
		},
		user: { id: "testUser", viewedScene: "sceneA", isGM: true },
		users: { activeGM: { id: "testUser" }, find: ()=>({id:"testUser"}) },
		scenes: { get: ()=>null },
	};
	globalThis.Sequencer.EffectManager.endEffects = async f => { endEffectsCallsTorch.push(f); orderedTorch.push("end"); };
	globalThis.Sequencer.EffectManager.effects = [];
	globalThis.Sequencer.Database = { entryExists: ()=>false, getEntry: ()=>null };
	globalThis.Sequence = MockSequenceT;
	globalThis.Hooks = { on: (name, fn) => { hooksTorch[name]=fn; }, once: ()=>{}, callAll: ()=>{} };
}

function makeTokenW(id, actor){ const t={ id, name:`Token-${id}`, document:{ width:100, texture:{scaleX:1,scaleY:1}, uuid:`Scene.sceneA.Token.${id}`, actorLink:true }, actor, x:0,y:0,w:100,h:100 }; t.document.actorLink=true; return t; }
function makeItemW(id, name, equipped=true, flag=null){ return { id, name, type:"Weapon", system:{equipped}, getFlag:(mod,key)=>(mod===MODULE_ID&&key==="weaponAnimation")?flag:null, parent:null, actor:null }; }
function makeActorW(id, items){ const actor={ id, items, isToken:false, getFlag:()=>null }; for(const it of items){ it.parent=actor; it.actor=actor; } actor.getActiveTokens=()=>[]; return actor; }
function seedDaggerPreset(){ weaponSpritesConfig = { dagger: { patterns: "dagger", imagePath: "modules/shadowdark-extras/assets/Weapons/dagger.webp", enabled: true, scale:1, offsetX:0.35, offsetY:0.1 } }; }

function makeTokenT(id, uuid){ return { id, name:`Token-${id}`, document:{ width:100, texture:{scaleX:1,scaleY:1}, ...(uuid!==undefined?(uuid?{uuid}:{}):{uuid:`Scene.sceneA.Token.${id}`}) }, actor:{ id:`actor-${id}` } }; }
function makeItemT(id, name="Torch"){ return { id, name, type:"Light", system:{ light:{ template:"torch", active:true } }, getFlag:()=>null, parent:null }; }

// ---- tests ----

test("weapon restore waits for activeGM before election — gate before wait would produce 0 (now on sequencerEffectManagerReady)", async () => {
	resetWeapon();
	seedDaggerPreset();
	weaponMod.initWeaponAnimations();
	const handler = hooksWeapon.sequencerEffectManagerReady;
	assert.ok(handler, "weapon sequencerEffectManagerReady hook must be registered (moved from canvasReady, see #110)");

	// The module registers two sequencer handlers (sweep + restore); our capture keeps the last (restore)
	// To get restore specifically, re-capture with array or simply use the last. Here hooksWeapon holds restore.
	// Verify it's restore by checking it creates effects: sweep would not.
	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actor = makeActorW("actor1", [dagger]);
	const token = makeTokenW("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCallsWeapon.length = 0;

	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: null, find: ()=>({id:"testUser"}) };
	setTimeout(() => { globalThis.game.users.activeGM = { id: "testUser" }; }, 50);

	await handler();

	const effs = globalThis.Sequencer.EffectManager.effects;
	assert.equal(effs.length, 1, `weapon restore must have waited for activeGM and played dagger (got ${effs.length}, calls ${endEffectsCallsWeapon.length})`);
	assert.equal(effs[0].data.name, weaponMod.getEffectName(dagger.id));
});

test("weapon election still authoritative — non-GM must not restore even after activeGM appears", async () => {
	resetWeapon();
	seedDaggerPreset();
	weaponMod.initWeaponAnimations();
	const handler = hooksWeapon.sequencerEffectManagerReady;
	assert.ok(handler);

	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actor = makeActorW("actor1", [dagger]);
	const token = makeTokenW("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCallsWeapon.length = 0;

	globalThis.game.user = { id: "player1", viewedScene: "sceneA", isGM: false };
	globalThis.game.users = { activeGM: null, find: ()=>({id:"gm1"}) };
	setTimeout(() => { globalThis.game.users.activeGM = { id: "gm1" }; }, 50);

	await handler();

	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "non-GM must not restore even though activeGM appeared");
	assert.equal(endEffectsCallsWeapon.length, 0, "non-GM must not have called endEffects/play");
});

test("torch restore waits for activeGM before election — sequencer variant", async () => {
	resetTorch();
	globalThis.Sequence = MockSequenceT;
	globalThis.Hooks = { on: (name, fn)=>{ hooksTorch[name]=fn; }, once: ()=>{}, callAll: ()=>{} };
	torchMod.initTorchAnimations();
	const handler = hooksTorch.sequencerEffectManagerReady;
	assert.ok(handler, "torch sequencerEffectManagerReady hook must be registered");

	const token = makeTokenT("tokA");
	const item = makeItemT("itemT", "Torch");
	const actor = { id: "actor-tokA", items: [item], getActiveLightSources: async () => [item] };
	token.actor = actor;
	globalThis.canvas.tokens.placeables = [token];
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCallsTorch.length = 0;
	orderedTorch.length = 0;

	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: null, find: ()=>({id:"testUser"}) };
	setTimeout(() => { globalThis.game.users.activeGM = { id: "testUser" }; }, 50);

	await handler();

	assert.ok(endEffectsCallsTorch.length >= 4, `torch dedup must have run after waiting (got ${endEffectsCallsTorch.length}, should be 4 with legacy+new)`);
	const baseName = torchMod.getEffectName(item.id);
	const played = globalThis.Sequencer.EffectManager.effects.filter(e=> e.data.source==="Scene.sceneA.Token.tokA");
	assert.ok(played.length >= 2, `torch restore must have played after activeGM appeared (got ${played.length})`);
	assert.ok(played.some(e=> e.data.name===baseName), "base effect name must be present");
});

test("torch double-restore: module dedup prevents duplicate when Sequencer already restored (legacy-named)", async () => {
	resetTorch();
	globalThis.Sequence = MockSequenceT;
	globalThis.Hooks = { on: (name, fn)=>{ hooksTorch[name]=fn; }, once: ()=>{}, callAll: ()=>{} };
	torchMod.initTorchAnimations();
	const handler = hooksTorch.sequencerEffectManagerReady;
	assert.ok(handler, "torch restore must be on sequencerEffectManagerReady");

	const token = makeTokenT("tokA");
	const item = makeItemT("itemT", "Torch");
	const actor = { id: "actor-tokA", items: [item], getActiveLightSources: async () => [item] };
	token.actor = actor;
	globalThis.canvas.tokens.placeables = [token];

	// Seed LEGACY-named effects as found live in world 0100 (22 records, legacy)
	const baseName = torchMod.getEffectName(item.id);
	const legacyName = torchMod.getLegacyEffectName(token, item.id);
	const impactName = `${baseName}_impact`;
	const legacyImpact = `${legacyName}_impact`;
	const seqEffects = [
		{ data: { name: legacyName, source: "Scene.sceneA.Token.tokA", _id: "seq-legacy-base" }, sprite:{filters:[]}, spriteContainer:{filters:[]} },
		{ data: { name: legacyImpact, source: "Scene.sceneA.Token.tokA", _id: "seq-legacy-impact" }, sprite:{filters:[]}, spriteContainer:{filters:[]} },
	];
	globalThis.Sequencer.EffectManager.effects = [...seqEffects];
	endEffectsCallsTorch.length = 0;
	orderedTorch.length = 0;

	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: { id: "testUser" }, find: ()=>({id:"testUser"}) };

	const realEnd = async (filter) => {
		endEffectsCallsTorch.push(filter);
		orderedTorch.push("end");
		if (filter.object && filter.name) {
			globalThis.Sequencer.EffectManager.effects = globalThis.Sequencer.EffectManager.effects.filter(e =>
				!(e.data.name===filter.name && e.data.source===`Scene.sceneA.Token.${filter.object.id}`)
			);
		}
	};
	globalThis.Sequencer.EffectManager.endEffects = realEnd;

	await handler();

	// Must have terminated both legacy names (and new, but legacy is the critical one)
	assert.ok(endEffectsCallsTorch.some(c=> c.name===legacyName && c.object===token), "dedup must terminate legacy base");
	assert.ok(endEffectsCallsTorch.some(c=> c.name===legacyImpact && c.object===token), "dedup must terminate legacy _impact");
	// Net one set: after dedup+play, should have new-format flames (3 layers) only, no legacy remains
	const after = globalThis.Sequencer.EffectManager.effects.filter(e=> e.data.source==="Scene.sceneA.Token.tokA");
	assert.ok(!after.some(e=> e.data.name===legacyName), "legacy base must be gone");
	assert.ok(after.filter(e=> e.data.name===baseName).length >= 1, "new base must exist");
	assert.ok(after.some(e=> e.data.name===impactName), "new _impact must exist");
	const firstPlay = orderedTorch.indexOf("play");
	assert.ok(firstPlay > 1, `dedup before play (events ${orderedTorch.join(",")})`);
});

test("weapon double-restore: no duplicate when 10 persisted weapon records exist (now on sequencer)", async () => {
	resetWeapon();
	seedDaggerPreset();
	globalThis.Hooks = { on: (name, fn)=>{ hooksWeapon[name]=fn; }, once: ()=>{}, callAll: ()=>{} };
	weaponMod.initWeaponAnimations();
	const handler = hooksWeapon.sequencerEffectManagerReady;
	assert.ok(handler);

	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actor = makeActorW("actor1", [dagger]);
	const token = makeTokenW("tokA", actor);
	globalThis.canvas.tokens.placeables = [token];

	// Seed 10 weapon records as found live (mix of new and legacy, like world 0100)
	// For this token, seed one legacy weapon effect as Sequencer would have restored
	const baseName = weaponMod.getEffectName(dagger.id);
	const legacyName = weaponMod.getLegacyEffectName(token, dagger.id);
	const seqEff = { data: { name: legacyName, source: "Scene.sceneA.Token.tokA", _id: "seq-legacy-weapon" }, sprite:{filters:[]}, spriteContainer:{filters:[]} };
	globalThis.Sequencer.EffectManager.effects = [seqEff];
	endEffectsCallsWeapon.length = 0;

	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: { id: "testUser" } };

	const realEnd = async (filter) => {
		endEffectsCallsWeapon.push(filter);
		if (filter.object && filter.name) {
			globalThis.Sequencer.EffectManager.effects = globalThis.Sequencer.EffectManager.effects.filter(e =>
				!(e.data.name===filter.name && e.data.source===`Scene.sceneA.Token.${filter.object.id}`)
			);
		}
	};
	globalThis.Sequencer.EffectManager.endEffects = realEnd;

	await handler();

	assert.ok(endEffectsCallsWeapon.some(c=> c.name===legacyName && c.object===token), "weapon dedup must terminate legacy name");
	assert.ok(endEffectsCallsWeapon.some(c=> c.name===baseName && c.object===token), "weapon dedup must terminate new name");
	const after = globalThis.Sequencer.EffectManager.effects.filter(e=> e.data.source==="Scene.sceneA.Token.tokA");
	assert.equal(after.length, 1, `weapon net one after dedup+replay (got ${after.length})`);
	assert.equal(after[0].data.name, baseName, "remaining must be new-format");
});

test("playWeaponAnimation dedup terminates legacy name directly", async () => {
	resetWeapon();
	seedDaggerPreset();
	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actor = makeActorW("actor1", [dagger]);
	const token = makeTokenW("tokA", actor);
	globalThis.canvas.tokens.placeables = [token];

	const legacyName = weaponMod.getLegacyEffectName(token, dagger.id);
	const seqEff = { data: { name: legacyName, source: "Scene.sceneA.Token.tokA", _id: "legacy-weapon" }, sprite:{filters:[]}, spriteContainer:{filters:[]} };
	globalThis.Sequencer.EffectManager.effects = [seqEff];
	endEffectsCallsWeapon.length = 0;
	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: { id: "testUser" } };
	globalThis.Sequence = MockSequenceW;
	const realEnd = async (filter) => {
		endEffectsCallsWeapon.push(filter);
		if (filter.object && filter.name) {
			globalThis.Sequencer.EffectManager.effects = globalThis.Sequencer.EffectManager.effects.filter(e =>
				!(e.data.name===filter.name && e.data.source===`Scene.sceneA.Token.${filter.object.id}`)
			);
		}
	};
	globalThis.Sequencer.EffectManager.endEffects = realEnd;

	await weaponMod.playWeaponAnimation(token, dagger);

	assert.ok(endEffectsCallsWeapon.some(c=> c.name===legacyName && c.object===token), "play must end legacy name");
	const after = globalThis.Sequencer.EffectManager.effects.filter(e=> e.data.source==="Scene.sceneA.Token.tokA");
	assert.equal(after.length, 1);
});

test("playTorchAnimation dedup terminates legacy names directly", async () => {
	resetTorch();
	globalThis.Sequence = MockSequenceT;
	const token = makeTokenT("tokA");
	const item = makeItemT("itemT", "Torch");
	const legacyName = torchMod.getLegacyEffectName(token, item.id);
	const legacyImpact = `${legacyName}_impact`;
	const seqEffects = [
		{ data: { name: legacyName, source: "Scene.sceneA.Token.tokA", _id: "legacy-base" }, sprite:{filters:[]}, spriteContainer:{filters:[]} },
		{ data: { name: legacyImpact, source: "Scene.sceneA.Token.tokA", _id: "legacy-impact" }, sprite:{filters:[]}, spriteContainer:{filters:[]} },
	];
	globalThis.Sequencer.EffectManager.effects = [...seqEffects];
	endEffectsCallsTorch.length = 0;
	orderedTorch.length = 0;
	globalThis.game.user = { id: "testUser", viewedScene: "sceneA" };
	globalThis.game.users = { activeGM: { id: "testUser" } };
	const realEnd = async (filter) => {
		endEffectsCallsTorch.push(filter);
		orderedTorch.push("end");
		if (filter.object && filter.name) {
			globalThis.Sequencer.EffectManager.effects = globalThis.Sequencer.EffectManager.effects.filter(e =>
				!(e.data.name===filter.name && e.data.source===`Scene.sceneA.Token.${filter.object.id}`)
			);
		}
	};
	globalThis.Sequencer.EffectManager.endEffects = realEnd;
	globalThis.Sequence = MockSequenceT;

	await torchMod.playTorchAnimation(token, item);

	assert.ok(endEffectsCallsTorch.some(c=> c.name===legacyName && c.object===token), "play must end legacy base");
	assert.ok(endEffectsCallsTorch.some(c=> c.name===legacyImpact && c.object===token), "play must end legacy _impact");
});

test("overlapping sequencer ready events serialize — newest wins (weapon)", async () => {
	resetWeapon();
	seedDaggerPreset();
	// Capture restore handler with generation guard
	const captured = [];
	globalThis.Hooks = { on: (name, fn) => { if(name==="sequencerEffectManagerReady") captured.push(fn); }, once: ()=>{}, callAll: ()=>{} };
	weaponMod.initWeaponAnimations();
	// Find restore handler: it creates effects, sweep does not. Identify by length? We know restore is second pushed
	const restore = captured[captured.length-1];
	assert.ok(restore, "restore handler captured");

	// Setup two different worlds for overlapping calls: first call will see tokA, second will see tokB
	// If both run to completion, we'd have 2 effects. With generation supersede, first should abort.
	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actorA = makeActorW("actorA", [dagger]);
	const tokenA = makeTokenW("tokA", actorA);
	const actorB = makeActorW("actorB", [dagger]);
	const tokenB = makeTokenW("tokB", actorB);

	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: { id: "testUser" } };

	// Make Sequencer slow: endEffects and play with delay
	const originalEnd = globalThis.Sequencer.EffectManager.endEffects;
	const slowEnd = async (f) => { await new Promise(r=>setTimeout(r, 40)); endEffectsCallsWeapon.push(f); };
	globalThis.Sequencer.EffectManager.endEffects = slowEnd;
	// Make play slow via Sequence mock delay
	const SlowSeq = class {
		constructor(){ this._name=null; this._token=null; }
		effect(){ const self=this; return { name(v){ self._name=v; return this; }, file(){return this;}, atLocation(t){ if(t?.id) self._token=t; return this;}, attachTo(t){ if(t?.id) self._token=t; return this;}, scaleToObject(){return this;}, scaleIn(){return this;}, scaleOut(){return this;}, spriteOffset(){return this;}, spriteRotation(){return this;}, spriteScale(){return this;}, filter(){return this;}, persist(){return this;}, zIndex(){return this;}, loopProperty(){return this;} };
		}
		async play(){ await new Promise(r=>setTimeout(r, 40)); if(this._name && this._token){ const token=this._token; const source=token.document?.uuid ?? `Scene.sceneA.Token.${token.id}`; const eff={ data:{ name:this._name, source, _id:`play-${token.id}-${this._name}-${Date.now()}` }, sprite:{filters:[]}, spriteContainer:{filters:[]} }; globalThis.Sequencer.EffectManager.effects.push(eff); }}
	};
	globalThis.Sequence = SlowSeq;

	// First restore sees tokA
	globalThis.canvas.tokens.placeables = [tokenA];
	globalThis.Sequencer.EffectManager.effects = [];
	const p1 = restore();
	// Before p1 finishes its first await (poll is instant since activeGM ready, but then endEffects 40ms), start second restore that sees tokB
	await new Promise(r=>setTimeout(r, 10));
	globalThis.canvas.tokens.placeables = [tokenB];
	const p2 = restore();

	await Promise.all([p1, p2]);

	// With generation guard, p1 should have aborted after its first await, not played for tokA
	// Final effects should be only tokB, not both
	const effs = globalThis.Sequencer.EffectManager.effects;
	const hasA = effs.some(e=> e.data.source==="Scene.sceneA.Token.tokA");
	const hasB = effs.some(e=> e.data.source==="Scene.sceneA.Token.tokB");
	assert.equal(hasA, false, "overlapping: first (stale) restore must be superseded, no tokA effect");
	assert.equal(hasB, true, "overlapping: newest restore must win, tokB effect present");
	assert.equal(effs.length, 1, `exactly one effect from newest generation (got ${effs.length})`);
});

test("poll timeout is observable — logs warn and does not silently skip (weapon)", async () => {
	resetWeapon();
	seedDaggerPreset();
	weaponMod.initWeaponAnimations();
	const handler = (() => {
		const c = [];
		globalThis.Hooks = { on: (n,fn)=>{ if(n==="sequencerEffectManagerReady") c.push(fn); }, once:()=>{}, callAll:()=>{} };
		weaponMod.initWeaponAnimations();
		return c[c.length-1];
	})();

	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actor = makeActorW("actor1", [dagger]);
	const token = makeTokenW("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	globalThis.Sequencer.EffectManager.effects = [];

	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: null, find: ()=>null };

	const warns = [];
	const origWarn = console.warn;
	console.warn = (...args) => warns.push(args.join(" "));
	// Speed up test by temporarily shortening timeout: monkey-patch Date.now? Instead we just let it poll 2000ms but we can reduce by stubbing setTimeout to be instant? Simpler: we know poll is 100ms×20=2000ms, test will take 2s but okay.
	// To keep test fast, we temporarily override timeout by editing module? We can't easily, so we accept 2s wait.
	// However we can make test faster by directly testing the log path via calling handler and checking warns after.
	// It will take ~2000ms.
	await handler();
	console.warn = origWarn;

	assert.ok(warns.some(m=> m.includes("activeGM not found") && m.includes("2000ms")), `timeout must warn (got ${warns.join("; ")})`);
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "no restore on timeout");
	// Next ready will retry — verify handler still works after timeout
	globalThis.game.users.activeGM = { id: "testUser" };
	await handler();
	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 1, "retry on next ready must succeed after activeGM appears");
});

