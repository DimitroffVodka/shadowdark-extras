import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasGlobals, installDom, makeGsapRecorder, StubContainer } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

installCanvasGlobals();
installDom();

StubContainer.prototype.removeChildren = function() {
	this.children.forEach(child => { child.parent = null; });
	this.children = [];
	return [];
};

class TestText extends StubContainer {
	constructor(text) {
		super();
		this.text = text;
		this.width = String(text).length * 16;
		this.height = 20;
		this.anchor = { set() {} };
	}
}

globalThis.PIXI.Text = TestText;
globalThis.PIXI.Circle = class {
	constructor(x, y, radius) { this.x = x; this.y = y; this.radius = radius; }
};
globalThis.PIXI.Rectangle = class {
	constructor(x, y, width, height) {
		this.x = x; this.y = y; this.width = width; this.height = height;
	}
};
for (const method of [
	"beginFill", "lineStyle", "drawCircle", "drawRoundedRect", "drawRect", "moveTo",
	"lineTo", "closePath", "endFill", "clear", "drawPolygon",
]) {
	globalThis.PIXI.Graphics.prototype[method] = function() { return this; };
}

const dom = makeSelectorDom({ coalesceFormControls: true });
const appGlobals = installAppGlobals({ dom });

const defaultsWrites = [];
let storedDefaults = {};
globalThis.game.user = { isGM: true, id: "gm" };
globalThis.game.i18n = { localize: key => key };
globalThis.game.modules = { get: () => undefined };
globalThis.game.journal = { contents: [], get: () => null };
globalThis.game.settings = {
	get(scope, key) {
		if (scope === "shadowdark-extras" && key === "pinStyleDefaults") return storedDefaults;
		if (scope === "core" && key === "fonts") return {};
		return undefined;
	},
	async set(scope, key, value) {
		defaultsWrites.push({ scope, key, value });
		storedDefaults = structuredClone(value);
		return value;
	},
	register() {},
};
globalThis.canvas.scene = null;

const { PinStyleEditorApp } = await import("../../scripts/journal/PinStyleEditorSD.mjs");
const { JournalPinGraphics, JournalPinRenderer, JournalPinTooltip } = await import("../../scripts/journal/pin-rendering.mjs");
const { JournalPinManager, checkPinVisibility } = await import("../../scripts/journal/pin-manager.mjs");
const { getPinJournalSubtitle, openPinTarget } = await import("../../scripts/journal/pin-access.mjs");
const { onPointerEnter } = await import("../../scripts/journal/pin-interactions.mjs");
const { initHexFog } = await import("../../scripts/hex/SDXHexFogSD.mjs");

const ROOT = ".sdx-pin-style-editor";
const FORM = `${ROOT} form`;
Object.getPrototypeOf(dom.node(ROOT)).getBoundingClientRect = () => ({ width: 0, height: 0 });

test("rendered save survives reopen and drives a production pin", async () => {
	const app = new PinStyleEditorApp();
	app.element = dom.node(ROOT);

	for (const [name, value] of Object.entries({
		shape: "circle",
		size: "64",
		contentType: "text",
		customText: "7",
		pingAnimation: "shake",
		bringAnimation: "flash",
		labelText: "Vault",
		labelFontSize: "22",
		labelColor: "#ffcc00",
		labelBackground: "none",
	})) {
		dom.node(`${FORM} [name="${name}"]`).value = value;
	}

	app._onRender({}, {});
	const save = dom.node(`${FORM} [data-action="save"]`);
	await Promise.all(save.dispatch("click"));

	assert.equal(defaultsWrites.length, 1, "the rendered Save action writes one defaults setting");
	assert.equal(defaultsWrites[0].scope, "shadowdark-extras");
	assert.equal(defaultsWrites[0].key, "pinStyleDefaults");
	assert.equal(defaultsWrites[0].value.size, 64);
	assert.equal(defaultsWrites[0].value.labelText, "Vault");
	assert.equal(Object.hasOwn(defaultsWrites[0].value, "hideTooltip"), false,
		"default Save does not persist individual-only tooltip visibility");

	const reopened = new PinStyleEditorApp();
	const context = await reopened._prepareContext({});
	assert.equal(context.style.size, 64, "reopened context keeps the literal saved size");
	assert.equal(context.style.contentType, "text");
	assert.equal(context.style.customText, "7");
	assert.equal(context.style.labelText, "Vault");
	assert.equal(context.style.labelFontSize, 22);
	assert.equal(context.style.pingAnimation, "shake");
	assert.equal(context.style.bringAnimation, "flash");

	const pin = new JournalPinGraphics({ id: "persisted-pin", x: 0, y: 0, style: context.style });
	await pin.init();
	assert.equal(pin.hitArea.radius, 32, "production geometry uses the saved 64px diameter");
	const body = pin.children[0];
	assert.equal(body.children.find(child => child.text === "7")?.text, "7");
	assert.equal(pin._labelContainer.children.find(child => child.text === "Vault")?.text, "Vault");
	const oldGsap = globalThis.window.gsap;
	const oldGlobalGsap = globalThis.gsap;
	const gsap = makeGsapRecorder();
	globalThis.window.gsap = gsap;
	globalThis.gsap = gsap;
	try {
		pin.animatePing();
		assert.ok(gsap.of("to").some(call => call.target === pin && call.vars.x === "+=5"));
		gsap.reset();
		pin.animatePing("bring");
		assert.ok(gsap.of("fromTo").some(call => call.target === pin && call.fromVars?.pixi?.brightness === 3));
	}
	finally {
		globalThis.window.gsap = oldGsap;
		globalThis.gsap = oldGlobalGsap;
	}
});

test("individual Save keeps metadata top-level through manager update and reopen", async () => {
	const flags = {};
	const scene = {
		id: "individual-scene",
		getFlag(scope, key) { return flags[`${scope}.${key}`]; },
		async setFlag(scope, key, value) {
			flags[`${scope}.${key}`] = structuredClone(value);
			return value;
		},
	};
	flags[`shadowdark-extras.${JournalPinManager.FLAG_KEY}`] = [{
		id: "individual-pin", x: 10, y: 20, journalId: null, pageId: null,
		nameSource: "auto", requiresVision: false, aboveFog: false,
		tooltipTitle: "", tooltipContent: "", hideTooltip: false,
		style: { shape: "circle", size: 32, labelText: "Old" },
	}];
	const oldScene = globalThis.canvas.scene;
	const oldScenes = globalThis.game.scenes;
	const oldJournal = globalThis.game.journal;
	const page = {
		id: "page-2", name: "Vault Page", sort: 2,
		testUserPermission: () => true,
	};
	const renderCalls = [];
	const journal = {
		id: "journal-1", name: "Vault Journal",
		pages: { size: 1, contents: [page], get: id => id === page.id ? page : null },
		find: () => null,
		testUserPermission: () => true,
		sheet: { render: (...args) => renderCalls.push(args) },
	};
	globalThis.canvas.scene = scene;
	globalThis.game.scenes = { get: id => id === scene.id ? scene : null };
	globalThis.game.journal = {
		contents: [journal],
		get: id => id === journal.id ? journal : null,
		find: () => null,
	};
	try {
		const app = new PinStyleEditorApp({ pinId: "individual-pin" });
		app.element = dom.node(ROOT);
		await app._prepareContext({});
		const values = {
			journalId: "journal-1", pageId: "page-2", nameSource: "tooltip",
			tooltipTitle: "New title", tooltipContent: "New body",
		};
		for (const [name, value] of Object.entries(values)) dom.node(`${FORM} [name="${name}"]`).value = value;
		dom.node(`${FORM} [name="requiresVision"]`).checked = true;
		dom.node(`${FORM} [name="aboveFog"]`).checked = true;
		dom.node(`${FORM} [name="hideTooltip"]`).checked = false;
		dom.node(`${FORM} [name="labelText"]`).value = "New label";
		app._onRender({}, {});
		await Promise.all(dom.node(`${FORM} [data-action="save"]`).dispatch("click"));

		let saved = flags[`shadowdark-extras.${JournalPinManager.FLAG_KEY}`][0];
		assert.deepEqual({
			journalId: saved.journalId, pageId: saved.pageId, nameSource: saved.nameSource,
			requiresVision: saved.requiresVision, aboveFog: saved.aboveFog,
			tooltipTitle: saved.tooltipTitle, tooltipContent: saved.tooltipContent,
			hideTooltip: saved.hideTooltip,
		}, { ...values, requiresVision: true, aboveFog: true, hideTooltip: false });
		for (const name of Object.keys(values).concat(["requiresVision", "aboveFog", "hideTooltip"])) {
			assert.equal(Object.hasOwn(saved.style, name), false, `${name} stays out of style`);
		}

		const reopened = new PinStyleEditorApp({ pinId: "individual-pin" });
		reopened.element = dom.node(ROOT);
		const context = await reopened._prepareContext({});
		assert.equal(context.journalId, "journal-1");
		assert.equal(context.currentPageId, "page-2");
		assert.equal(context.nameSource, "tooltip");
		assert.equal(context.requiresVision, true);
		assert.equal(context.tooltipTitle, "New title");
		assert.equal(context.tooltipContent, "New body");
		assert.equal(context.hideTooltip, false);
		assert.equal(JournalPinManager.getDisplayName(saved), "New title");
		assert.equal(getPinJournalSubtitle(saved), "Vault Journal • Vault Page");
		assert.equal(openPinTarget(saved), true);
		assert.deepEqual(renderCalls, [[true, { pageId: "page-2" }]]);
		const fogOldUser = globalThis.game.user;
		const oldTokens = globalThis.canvas.tokens;
		globalThis.game.user = { isGM: false };
		globalThis.canvas.tokens = { placeables: [] };
		assert.equal(checkPinVisibility(saved), false, "requiresVision remains an individual visibility policy");
		globalThis.game.user = fogOldUser;
		globalThis.canvas.tokens = oldTokens;

		const visiblePin = new JournalPinGraphics({ id: "individual-pin", x: 0, y: 0, ...saved });
		await visiblePin.init();
		assert.equal(visiblePin._labelContainer.children.find(child => child.text === "New label")?.text, "New label");
		onPointerEnter(visiblePin, { global: { x: 0, y: 0 } });
		assert.match(JournalPinTooltip._element.innerHTML, /New title/);
		assert.match(JournalPinTooltip._element.innerHTML, /New body/);
		JournalPinTooltip.hide();

		const toggle = new PinStyleEditorApp({ pinId: "individual-pin" });
		toggle.element = dom.node(ROOT);
		await toggle._prepareContext({});
		dom.node(`${FORM} [name="hideTooltip"]`).checked = true;
		toggle._onRender({}, {});
		await Promise.all(dom.node(`${FORM} [data-action="save"]`).dispatch("click"));
		saved = flags[`shadowdark-extras.${JournalPinManager.FLAG_KEY}`][0];
		const hiddenReopen = new PinStyleEditorApp({ pinId: "individual-pin" });
		hiddenReopen.element = dom.node(ROOT);
		const hiddenContext = await hiddenReopen._prepareContext({});
		assert.equal(hiddenContext.hideTooltip, true);
		const hiddenPin = new JournalPinGraphics({ id: "individual-pin", x: 0, y: 0, ...saved });
		await hiddenPin.init();
		onPointerEnter(hiddenPin, { global: { x: 0, y: 0 } });
		assert.equal(JournalPinTooltip._element, null, "hideTooltip suppresses the public tooltip action");

		const oldCanvas = globalThis.canvas;
		const fogUserBeforeLifecycle = globalThis.game.user;
		const oldPins = JournalPinRenderer._pins;
		const fogFlags = { hexFogEnabled: true, hexFogRevealed: {} };
		const fogScene = {
			id: "fog-scene",
			tokenVision: false,
			dimensions: { rows: 1, columns: 1, width: 100, height: 100 },
			fog: { colors: { unexplored: { css: "#000000" } } },
			getFlag: (scope, key) => fogFlags[key],
		};
		const fogCanvas = {
			...oldCanvas,
			scene: fogScene,
			grid: {
				isHexagonal: true,
				getShape: () => [],
				getCenterPoint: () => ({ x: 0, y: 0 }),
				getOffset: () => ({ i: 0, j: 0 }),
			},
			interface: { addChildAt() {} },
			masks: { vision: { addChild() {} } },
			stage: { on() {}, off() {} },
			perception: { update() {} },
		};
		const aboveFogPin = {
			pinData: { ...structuredClone(saved), aboveFog: hiddenContext.aboveFog, x: 0, y: 0 },
			visible: true,
			alpha: 1,
		};
		const ordinaryFogPin = {
			pinData: { ...structuredClone(saved), x: 0, y: 0, aboveFog: false },
			visible: true,
			alpha: 1,
		};
		JournalPinRenderer._pins = new Map([["above", aboveFogPin], ["ordinary", ordinaryFogPin]]);
		globalThis.canvas = fogCanvas;
		globalThis.game.scenes = { get: id => id === fogScene.id ? fogScene : null };
		initHexFog();
		const canvasReady = appGlobals.hooks.find(hook => hook.name === "canvasReady")?.fn;
		assert.ok(canvasReady, "public hex-fog lifecycle registers canvasReady");
		globalThis.game.user = { isGM: false };
		canvasReady();
		assert.equal(aboveFogPin.visible, true, "aboveFog pins stay visible in player fog");
		assert.equal(ordinaryFogPin.visible, false, "ordinary pins hide in player fog");
		globalThis.game.user = { isGM: true };
		canvasReady();
		assert.equal(aboveFogPin.visible, true);
		assert.equal(ordinaryFogPin.visible, true, "GM fog policy keeps ordinary pins present");
		assert.equal(ordinaryFogPin.alpha, 0.3, "GM fog policy dims ordinary pins");
		globalThis.canvas = oldCanvas;
		globalThis.game.user = fogUserBeforeLifecycle;
		JournalPinRenderer._pins = oldPins;
	}
	finally {
		globalThis.canvas.scene = oldScene;
		globalThis.game.scenes = oldScenes;
		globalThis.game.journal = oldJournal;
	}
});
