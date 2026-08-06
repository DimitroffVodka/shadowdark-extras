// canvasReady gate ordering regression — #110
// Drives real production via await import("../../scripts/animation/*.mjs")
// The defect was Hooks.on("canvasReady", async () => {
//   if (!isWeaponCanvasRestoreAllowed()) return; // gate at t=0
//   await sleep(500); // wait AFTER gate
//   ...restore...
// });
// Both predicates read game.users.activeGM which is not populated at t=0.
// Measured live: 0 weapon effects while isWeaponCanvasRestoreAllowed()->true
// and hasWeaponAnimation(Dagger)->true when probed afterwards.
// Fix: bounded poll for activeGM BEFORE the gate (2000ms / 100ms).

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
	// re-capture hooks for weapon
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

test("canvasReady waits for activeGM before election — gate before wait would produce 0 effects (weapon)", async () => {
	resetWeapon();
	seedDaggerPreset();
	weaponMod.initWeaponAnimations();
	const handler = hooksWeapon.canvasReady;
	assert.ok(handler, "canvasReady hook must be registered");

	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actor = makeActorW("actor1", [dagger]);
	const token = makeTokenW("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCallsWeapon.length = 0;

	// activeGM not populated at t=0 — the bug. Becomes populated 50ms later.
	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: null, find: ()=>({id:"testUser"}) };

	// Become GM shortly after canvasReady fires
	setTimeout(() => { globalThis.game.users.activeGM = { id: "testUser" }; }, 50);

	await handler();

	// With the fix (poll before gate), handler waits and then restores.
	// With the bug (gate before wait), it would have returned at t=0 with 0 effects.
	const effs = globalThis.Sequencer.EffectManager.effects;
	assert.equal(effs.length, 1, `weapon restore must have waited for activeGM and played dagger (got ${effs.length}, calls ${endEffectsCallsWeapon.length})`);
	assert.equal(effs[0].data.name, weaponMod.getEffectName(dagger.id));
});

test("canvasReady election still authoritative — non-GM must not restore even after activeGM appears (weapon)", async () => {
	resetWeapon();
	seedDaggerPreset();
	weaponMod.initWeaponAnimations();
	const handler = hooksWeapon.canvasReady;
	assert.ok(handler);

	const dagger = makeItemW("itemD", "Dagger", true, null);
	const actor = makeActorW("actor1", [dagger]);
	const token = makeTokenW("tok1", actor);
	globalThis.canvas.tokens.placeables = [token];
	globalThis.Sequencer.EffectManager.effects = [];
	endEffectsCallsWeapon.length = 0;

	// Player client, activeGM is gm1 (different user). Poll will see activeGM truthy but gate fails.
	globalThis.game.user = { id: "player1", viewedScene: "sceneA", isGM: false };
	globalThis.game.users = { activeGM: null, find: ()=>({id:"gm1"}) };
	setTimeout(() => { globalThis.game.users.activeGM = { id: "gm1" }; }, 50);

	await handler();

	assert.equal(globalThis.Sequencer.EffectManager.effects.length, 0, "non-GM must not restore even though activeGM appeared");
	assert.equal(endEffectsCallsWeapon.length, 0, "non-GM must not have called endEffects/play");
});

test("canvasReady waits for activeGM before election — torch variant", async () => {
	resetTorch();
	globalThis.Sequence = MockSequenceT;
	// Capture torch hooks — torch restore now on sequencerEffectManagerReady (see #110 double-restore)
	globalThis.Hooks = { on: (name, fn)=>{ hooksTorch[name]=fn; }, once: ()=>{}, callAll: ()=>{} };
	torchMod.initTorchAnimations();
	const handler = hooksTorch.sequencerEffectManagerReady;
	// Torch has two sequencerEffectManagerReady handlers (sweep + restore); the
	// restore is the one that plays effects. Find it by probing: the sweep does
	// not create effects for a token with light, the restore does.
	assert.ok(handler, "torch sequencerEffectManagerReady hook must be registered");

	const token = makeTokenT("tokA");
	const item = makeItemT("itemT", "Torch");
	// Actor with getActiveLightSources returning our item
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

	// Torch should have played (dedup 2 + play 3 layers = 5 entries in our mock? Check)
	// With patreon active, play creates 3 effects (impact + 2 base). Dedup does 2 endEffects.
	assert.ok(endEffectsCallsTorch.length >= 2, `torch dedup must have run after waiting (got ${endEffectsCallsTorch.length})`);
	const baseName = torchMod.getEffectName(item.id);
	const played = globalThis.Sequencer.EffectManager.effects.filter(e=> e.data.source==="Scene.sceneA.Token.tokA");
	assert.ok(played.length >= 2, `torch restore must have played after activeGM appeared (got ${played.length}, names ${played.map(e=>e.data.name)})`);
	assert.ok(played.some(e=> e.data.name===baseName), "base effect name must be present");
});

test("torch double-restore: module dedup prevents duplicate when Sequencer already restored", async () => {
	resetTorch();
	globalThis.Sequence = MockSequenceT;
	globalThis.Hooks = { on: (name, fn)=>{ hooksTorch[name]=fn; }, once: ()=>{}, callAll: ()=>{} };
	torchMod.initTorchAnimations();
	const handler = hooksTorch.sequencerEffectManagerReady;
	assert.ok(handler, "torch restore must be on sequencerEffectManagerReady (see #110)");

	const token = makeTokenT("tokA");
	const item = makeItemT("itemT", "Torch");
	const actor = { id: "actor-tokA", items: [item], getActiveLightSources: async () => [item] };
	token.actor = actor;
	globalThis.canvas.tokens.placeables = [token];

	// Seed effects as if Sequencer already restored persisted flames (2 base layers + 1 impact)
	const baseName = torchMod.getEffectName(item.id);
	const impactName = `${baseName}_impact`;
	const seqEffects = [
		{ data: { name: baseName, source: "Scene.sceneA.Token.tokA", _id: "seq-base-1" }, sprite:{filters:[]}, spriteContainer:{filters:[]} },
		{ data: { name: baseName, source: "Scene.sceneA.Token.tokA", _id: "seq-base-2" }, sprite:{filters:[]}, spriteContainer:{filters:[]} },
		{ data: { name: impactName, source: "Scene.sceneA.Token.tokA", _id: "seq-impact" }, sprite:{filters:[]}, spriteContainer:{filters:[]} },
	];
	globalThis.Sequencer.EffectManager.effects = [...seqEffects];
	endEffectsCallsTorch.length = 0;
	orderedTorch.length = 0;

	globalThis.game.user = { id: "testUser", viewedScene: "sceneA", isGM: true };
	globalThis.game.users = { activeGM: { id: "testUser" }, find: ()=>({id:"testUser"}) };

	// Make Sequencer's endEffects actually remove from manager (like real Sequencer)
	const realEnd = async (filter) => {
		endEffectsCallsTorch.push(filter);
		orderedTorch.push("end");
		// object-scoped removal: filter.object is token, filter.name is string
		if (filter.object && filter.name) {
			globalThis.Sequencer.EffectManager.effects = globalThis.Sequencer.EffectManager.effects.filter(e =>
				!(e.data.name===filter.name && e.data.source===`Scene.sceneA.Token.${filter.object.id}`)
			);
		} else if (filter.object && filter.name?.endsWith("-*")) {
			globalThis.Sequencer.EffectManager.effects = globalThis.Sequencer.EffectManager.effects.filter(e =>
				!(e.data.source===`Scene.sceneA.Token.${filter.object.id}` && e.data.name.startsWith(filter.name.slice(0,-1)))
			);
		}
	};
	globalThis.Sequencer.EffectManager.endEffects = realEnd;

	await handler();

	// Dedup must have removed Sequencer's copies
	assert.ok(endEffectsCallsTorch.some(c=> c.name===baseName && c.object===token), "dedup base must carry object: token");
	assert.ok(endEffectsCallsTorch.some(c=> c.name===impactName && c.object===token), "dedup impact must carry object: token");
	// Net one set of flames: after dedup+play, we should have 3 effects (2 base +1 impact), not 6
	const after = globalThis.Sequencer.EffectManager.effects.filter(e=> e.data.source==="Scene.sceneA.Token.tokA");
	// Count by name: base appears twice, impact once = 3 total
	assert.equal(after.filter(e=> e.data.name===baseName).length, 2, "net one torch: 2 base layers sharing one name (torchFile+flameFile)");
	assert.equal(after.filter(e=> e.data.name===impactName).length, 1, "single _impact layer");
	assert.equal(after.length, 3, `net one flame after dedup+replay, not duplicate (got ${after.length}: ${JSON.stringify(after.map(e=>e.data))})`);
	// Ordering: dedup before play
	const firstPlay = orderedTorch.indexOf("play");
	assert.ok(firstPlay > 1, `both dedup ends must precede play (events ${orderedTorch.join(",")})`);
});

