// Characterization tests for PinStyleEditorApp, captured BEFORE it is split.
//
// The editor is 1,392 lines and its weight sits in four long methods:
// _onRender wires the form, _getFormData reads it back, _updatePreview turns
// that into CSS on a preview element, and a TMFX cluster manages TokenMagic
// presets and filters.
//
// _getFormData is the one worth freezing hardest. It is a fifty-field table of
// selectors, coercions and defaults, and every default is load-bearing: a pin
// whose form has no matching input still has to come out with a usable style.
// The selector-keyed DOM makes that cheap to assert — a field is present when
// the test gives it a value and absent otherwise.

import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";
import { installCanvasGlobals } from "./helpers/pixi-harness.mjs";
import { installAppGlobals, makeSelectorDom } from "./helpers/dom-harness.mjs";

const dom = makeSelectorDom();
installCanvasGlobals();
installAppGlobals({ dom });
globalThis.game.settings = { get: () => undefined, set: async () => {}, register() {} };
globalThis.game.modules = { get: () => undefined };
globalThis.game.journal = { get: () => null };

const { PinStyleEditorApp } = await import("../../scripts/journal/PinStyleEditorSD.mjs");

const ROOT = ".sdx-pin-style-editor";
const FORM = `${ROOT} form`;

/**
 * An editor whose DOM is a fresh selector-keyed tree.
 *
 * `fields` seeds form inputs by name; anything not named still resolves to a
 * node, but with an empty value, which is how the defaults get exercised.
 */
function makeEditor({ fields = {}, absent = [], lists = {}, seedAll = false, pinId = null } = {}) {
	const editorDom = makeSelectorDom({ absent, lists, seedAll });
	globalThis.document = editorDom.document;
	const app = Object.create(PinStyleEditorApp.prototype);
	app.element = editorDom.node(ROOT);
	app.pinId = pinId;
	for (const [name, value] of Object.entries(fields)) {
		const node = editorDom.node(`${FORM} [name="${name}"]`);
		if (typeof value === "boolean") node.checked = value;
		else node.value = value;
	}
	return { app, dom: editorDom };
}

// --- the binding manifest ---------------------------------------------------

const BINDINGS = [
	`${FORM} .file-picker-btn[0] :: click`,
	`${FORM} [data-action="apply-tmfx"] :: click`,
	`${FORM} [data-action="browse-icon-shape"] :: click`,
	`${FORM} [data-action="browse-icons"] :: click`,
	`${FORM} [data-action="clear-icon-shape"] :: click`,
	`${FORM} [data-action="clear-tmfx"] :: click`,
	`${FORM} [data-action="delete-tmfx-preset"] :: click`,
	`${FORM} [data-action="edit-tmfx"][0] :: click`,
	`${FORM} [data-action="remove-tmfx"][0] :: click`,
	`${FORM} [data-action="reset"] :: click`,
	`${FORM} [data-action="save"] :: click`,
	`${FORM} [data-action="save-tmfx-preset"] :: click`,
	`${FORM} [name="contentType"] :: change`,
	`${FORM} [name="customIconPreset"] :: change`,
	`${FORM} [name="hoverAnimation"] :: change`,
	`${FORM} [name="iconShapePath"] :: change`,
	`${FORM} [name="iconShapePath"] :: input`,
	`${FORM} [name="iconShapePreset"] :: change`,
	`${FORM} [name="journalId"] :: change`,
	`${FORM} [name="labelBackground"] :: change`,
	`${FORM} [name="shape"] :: change`,
	`${FORM} [name="tmfxPreset"] :: change`,
	`${FORM} input, select[0] :: change`,
	`${FORM} input[type="color"][0] :: input`,
	`${FORM} input[type="range"][0] :: input`,
];

test("a render binds exactly this set of selectors and events", () => {
	const { app, dom: bound } = makeEditor({ seedAll: true });
	app._updatePreview = async () => {};

	app._onRender({}, {});

	assert.deepEqual(bound.manifest(), BINDINGS);
});

test("everything is bound inside the form, never on the window chrome", () => {
	const { app, dom: bound } = makeEditor({ seedAll: true });
	app._updatePreview = async () => {};

	app._onRender({}, {});

	for (const binding of bound.bindings) {
		assert.ok(binding.selector.startsWith(`${FORM} `),
			`binding on "${binding.selector}" escapes the form`);
	}
});

test("a render with no form in the dialog binds nothing", () => {
	const { app, dom: bound } = makeEditor({ absent: [`${FORM}`], seedAll: true });

	app._onRender({}, {});

	assert.deepEqual(bound.bindings, []);
});

test("an icon body keeps the Content section and selected overlay type available", () => {
	const { app, dom: bound } = makeEditor({
		fields: { shape: "icon", contentType: "customIcon" },
		seedAll: true,
	});
	app._updatePreview = async () => {};

	app._onRender({}, {});

	assert.notEqual(bound.node(`${FORM} .content-section`).style.display, "none");
	assert.equal(bound.node(`${FORM} [name="contentType"]`).value, "customIcon");
});

// A range slider writes its value into the companion readout at render time,
// before any interaction, so a freshly opened dialog is not showing a blank.
test("a range slider seeds its readout on render, not on first drag", () => {
	const { app, dom: bound } = makeEditor({ seedAll: true });
	app._updatePreview = async () => {};
	const slider = bound.node(`${FORM} input[type="range"][0]`);
	slider.name = "size";
	slider.value = "48";
	const readout = bound.node(`${FORM} [data-for="size"]`);

	app._onRender({}, {});

	assert.equal(readout.textContent, "48");
});

// --- reading the form -------------------------------------------------------

test("with no form at all the stored style is returned untouched", () => {
	const { app } = makeEditor({ absent: [`${FORM}`] });

	const data = app._getFormData();

	assert.equal(typeof data, "object");
	assert.ok("size" in data, "the default pin style, not an empty object");
});

test("an empty form yields the full default style", () => {
	const { app } = makeEditor();

	const style = app._getFormData();

	assert.equal(style.size, 32);
	assert.equal(style.shape, "circle");
	assert.equal(style.ringColor, "#ffffff");
	assert.equal(style.fillColor, "#000000");
	assert.equal(style.ringWidth, 3);
	assert.equal(style.ringStyle, "solid");
	assert.equal(style.contentType, "number");
	assert.equal(style.borderRadius, 4);
	assert.equal(style.fontSize, 14);
	assert.equal(style.fontFamily, "Arial");
	assert.equal(style.fontColor, "#ffffff");
	assert.equal(style.fontStroke, "#000000");
	assert.equal(style.fontStrokeThickness, 0);
	assert.equal(style.symbolClass, "fa-solid fa-book-open");
	assert.equal(style.symbolColor, "#ffffff");
	assert.equal(style.iconColor, "#ffffff");
	assert.equal(style.hoverAnimation, "none");
	assert.equal(style.pingAnimation, "ripple");
	assert.equal(style.bringAnimation, "ripple");
});

test("label defaults are distinct from the pin's own font defaults", () => {
	const style = makeEditor().app._getFormData();

	assert.equal(style.labelFontSize, 16, "the pin body defaults to 14");
	assert.equal(style.labelFontFamily, "Arial");
	assert.equal(style.labelColor, "#ffffff");
	assert.equal(style.labelStrokeThickness, 0);
	assert.equal(style.labelBackground, "none");
	assert.equal(style.labelBorderWidth, 0);
	assert.equal(style.labelBorderRadius, 4);
	assert.equal(style.labelBorderSliceTop, 15);
});

test("numbers are read as integers and text as-is", () => {
	const { app } = makeEditor({
		fields: { size: "48", ringWidth: "5", fontFamily: "Almendra", customText: "  spaced  " },
	});

	const style = app._getFormData();

	assert.equal(style.size, 48);
	assert.equal(style.ringWidth, 5);
	assert.equal(style.fontFamily, "Almendra");
	assert.equal(style.customText, "  spaced  ", "text is not trimmed");
});

// Every integer field goes through `parseInt(...) || default`, so a zero the
// user typed is indistinguishable from a blank and falls back.
test("a zero in a size field falls back to the default rather than sticking", () => {
	const { app } = makeEditor({ fields: { size: "0", ringWidth: "0", fontSize: "0" } });

	const style = app._getFormData();

	assert.equal(style.size, 32);
	assert.equal(style.ringWidth, 3);
	assert.equal(style.fontSize, 14);
});

// The stroke thicknesses default to 0, so the same idiom is harmless there.
test("a zero stroke thickness is preserved, because zero is its default", () => {
	const { app } = makeEditor({ fields: { fontStrokeThickness: "0" } });

	assert.equal(app._getFormData().fontStrokeThickness, 0);
});

test("checkboxes read as booleans and default to false", () => {
	const { app } = makeEditor({ fields: { fitToHexGrid: true, labelItalic: true } });

	const style = app._getFormData();

	assert.equal(style.fitToHexGrid, true);
	assert.equal(style.labelItalic, true);
	assert.equal(style.fontItalic, false);
	assert.equal(style.labelShowOnHover, false);
});

test("the bold checkbox becomes a CSS font weight, not a boolean", () => {
	assert.equal(makeEditor({ fields: { fontWeight: true } }).app._getFormData().fontWeight, "bold");
	assert.equal(makeEditor().app._getFormData().fontWeight, "normal");
});

// The symbol field was renamed from iconClass; both are read, new name first,
// and iconClass is still emitted so older consumers keep working.
test("the legacy icon field is still read and still written back", () => {
	const legacy = makeEditor({ fields: { iconClass: "fa-solid fa-skull" } }).app._getFormData();
	assert.equal(legacy.symbolClass, "fa-solid fa-skull");
	assert.equal(legacy.iconClass, "fa-solid fa-skull");

	const both = makeEditor({
		fields: { symbolClass: "fa-solid fa-star", iconClass: "fa-solid fa-skull" },
	}).app._getFormData();

	assert.equal(both.symbolClass, "fa-solid fa-star", "the new name wins");
	assert.equal(both.iconClass, "fa-solid fa-star");
});

// The image shape has its own opacity slider in a separate panel, so which of
// the two duplicate [name="opacity"] inputs is authoritative depends on shape.
test("opacity is read from the panel belonging to the selected shape", () => {
	const { app, dom: d } = makeEditor({ fields: { shape: "image" } });
	d.node(`${FORM} .image-opacity-option [name="opacity"]`).value = "0.25";
	d.node(`${FORM} .standard-style-options [name="opacity"]`).value = "0.75";

	assert.equal(app._getFormData().opacity, 0.25);

	const standard = makeEditor({ fields: { shape: "circle" } });
	standard.dom.node(`${FORM} .image-opacity-option [name="opacity"]`).value = "0.25";
	standard.dom.node(`${FORM} .standard-style-options [name="opacity"]`).value = "0.75";

	assert.equal(standard.app._getFormData().opacity, 0.75);
});

// --- the preview ------------------------------------------------------------

/** Render a preview for a style and hand back the element it wrote to. */
async function preview(fields) {
	const { app, dom: d } = makeEditor({ fields });
	const pin = d.node(`${ROOT} .preview-pin`);
	const content = d.node(`${ROOT} .preview-pin .preview-content`);
	await app._updatePreview();
	return { pin, content, dom: d };
}

test("nothing is drawn when the dialog has no preview canvas", async () => {
	const { app, dom: d } = makeEditor({ absent: [".pin-preview-canvas"] });
	const pin = d.node(`${ROOT} .preview-pin`);

	await app._updatePreview();

	assert.deepEqual(pin.style, {}, "the preview element was never touched");
});

test("the preview box takes its size from the form", async () => {
	const { pin } = await preview({ size: "64" });

	assert.equal(pin.style.width, "64px");
	assert.equal(pin.style.height, "64px");
});

/** Preview with the panel-scoped opacity input the shape actually reads. */
async function previewWithOpacity(fields, { panel = ".standard-style-options", opacity } = {}) {
	const { app, dom: d } = makeEditor({ fields });
	if (opacity !== undefined) d.node(`${FORM} ${panel} [name="opacity"]`).value = opacity;
	const pin = d.node(`${ROOT} .preview-pin`);
	await app._updatePreview();
	return { pin, dom: d };
}

test("fill colour becomes rgba, with the shape's opacity folded in", async () => {
	const { pin } = await previewWithOpacity(
		{ fillColor: "#102030", fillOpacity: "0.5" }, { opacity: "0.5" });

	assert.equal(pin.style.backgroundColor, "rgba(16, 32, 48, 0.25)", "0.5 fill × 0.5 overall");
});

// Six sites used to read an opacity as `parseFloat(x) ?? default`, which never
// falls back: parseFloat yields NaN for a blank input and ?? only substitutes
// for null and undefined. readNumber replaced them.
test("a blank ring opacity falls back to fully opaque", async () => {
	const { pin } = await previewWithOpacity(
		{ ringColor: "#ffffff" }, { opacity: "0.5" });

	assert.equal(pin.style.borderColor, "rgba(255, 255, 255, 0.5)", "1.0 ring × 0.5 overall");
});

test("the opacity fields default to one when their inputs are absent", () => {
	const style = makeEditor().app._getFormData();

	assert.equal(style.opacity, 1.0);
	assert.equal(style.fillOpacity, 1.0);
	assert.equal(style.ringOpacity, 1.0);
});

test("an unparseable opacity falls back rather than poisoning the saved style", () => {
	const { app, dom: d } = makeEditor({ fields: { fillOpacity: "wide open" } });
	d.node(`${FORM} .standard-style-options [name="opacity"]`).value = "also not a number";

	const style = app._getFormData();

	assert.equal(style.fillOpacity, 1.0);
	assert.equal(style.opacity, 1.0);
});

test("a real zero opacity is kept, not mistaken for a missing value", () => {
	const { app, dom: d } = makeEditor({ fields: { fillOpacity: "0" } });
	d.node(`${FORM} .standard-style-options [name="opacity"]`).value = "0";

	const style = app._getFormData();

	assert.equal(style.fillOpacity, 0, "a fully transparent fill is a legitimate choice");
	assert.equal(style.opacity, 0);
});

test("each shape sets its own radius, rotation and clip path", async () => {
	const circle = await preview({ shape: "circle" });
	assert.equal(circle.pin.style.borderRadius, "50%");
	assert.equal(circle.pin.style.clipPath, "none");

	const square = await preview({ shape: "square", borderRadius: "8" });
	assert.equal(square.pin.style.borderRadius, "8px");
	assert.equal(square.pin.style.transform, "rotate(0deg)");

	const diamond = await preview({ shape: "diamond" });
	assert.equal(diamond.pin.style.transform, "rotate(45deg)", "a diamond is a rotated square");

	const pointy = await preview({ shape: "hexagon" });
	assert.ok(pointy.pin.style.clipPath.startsWith("polygon(50% 0%"), "pointy-top");

	const flat = await preview({ shape: "hexagonFlat" });
	assert.ok(flat.pin.style.clipPath.startsWith("polygon(0% 50%"), "flat-top");
});

test("an image shape drops its own fill and border in favour of the picture", async () => {
	const { pin } = await preview({ shape: "image", imagePath: "worlds/test/pin.webp" });

	assert.equal(pin.style.backgroundColor, "transparent");
	assert.equal(pin.style.border, "none");
	assert.equal(pin.style.backgroundImage, 'url("worlds/test/pin.webp")');
	assert.equal(pin.style.backgroundSize, "contain");
});

test("an image shape with no path shows a dashed placeholder instead", async () => {
	const { pin } = await preview({ shape: "image" });

	assert.equal(pin.style.backgroundImage, "none");
	assert.equal(pin.style.border, "1px dashed #666");
});

test("an icon body renders a second custom icon as its content overlay", async () => {
	const { pin, content } = await preview({
		shape: "icon",
		iconShapePath: "modules/test/outer.svg",
		contentType: "customIcon",
		customIconPath: "modules/test/inner.svg",
	});

	assert.equal(pin.style.backgroundImage, 'url("modules/test/outer.svg")');
	assert.match(content.innerHTML, /modules\/test\/inner\.svg/);
});

test("a symbol renders as a FontAwesome element at half the pin size", async () => {
	const { content } = await preview({
		contentType: "symbol", symbolClass: "fa-solid fa-skull", symbolColor: "#ff0000", size: "40",
	});

	assert.equal(content.innerHTML, '<i class="fa-solid fa-skull"></i>');
	assert.equal(content.style.fontSize, "20px");
	assert.equal(content.style.color, "#ff0000");
});

test("custom text is set as text, never as markup", async () => {
	const { content } = await preview({ contentType: "text", customText: "<b>x</b>" });

	assert.equal(content.textContent, "<b>x</b>");
	assert.equal(content.innerHTML, "", "textContent, so the tags cannot render");
});

test("a numbered pin with no journal shows the sample number three", async () => {
	const { content } = await preview({ contentType: "number" });

	assert.equal(content.textContent, "3");
});

test("font styling reaches the preview content", async () => {
	const { content } = await preview({
		contentType: "text", customText: "A", fontSize: "22", fontFamily: "Arial",
		fontColor: "#00ff00", fontWeight: true, fontItalic: true, fontStrokeThickness: "2",
		fontStroke: "#123456",
	});

	assert.equal(content.style.fontSize, "22px");
	assert.equal(content.style.color, "#00ff00");
	assert.equal(content.style.fontWeight, "bold");
	assert.equal(content.style.fontStyle, "italic");
	assert.equal(content.style.webkitTextStroke, "2px #123456");
});

// A custom icon path is chosen by the user and interpolated into an
// <img src="…">, so a double quote in it would otherwise close the attribute
// and let what follows parse as markup.
test("a custom icon path is escaped before it reaches the src attribute", async () => {
	const { content } = await preview({
		contentType: "customIcon", customIconPath: 'a.svg" onerror="alert(1)',
	});

	assert.ok(!content.innerHTML.includes('onerror="alert(1)"'),
		"the quote must not break out of the attribute");
	assert.ok(content.innerHTML.includes("&quot;"), "it is escaped, not stripped");
});

test("an ordinary icon path survives escaping unchanged", async () => {
	const { content } = await preview({
		contentType: "customIcon", customIconPath: "modules/shadowdark-extras/assets/icons/inn.svg",
	});

	assert.ok(content.innerHTML.includes('src="modules/shadowdark-extras/assets/icons/inn.svg"'));
});

test("a custom icon with no path falls back to a placeholder glyph", async () => {
	const { content } = await preview({ contentType: "customIcon", size: "40" });

	assert.equal(content.innerHTML, '<i class="fa-solid fa-image"></i>');
	assert.equal(content.style.fontSize, "20px");
});

// --- TokenMagic presets and filters -----------------------------------------

test("no TokenMagic module means no presets, without touching the API", () => {
	globalThis.game.modules = { get: () => undefined };

	assert.deepEqual(makeEditor().app._getTMFXPresets(), []);
});

test("presets from both libraries are merged, titled and sorted", () => {
	globalThis.game.modules = { get: id => (id === "tokenmagic" ? { active: true } : undefined) };
	globalThis.window.TokenMagic = {
		getPresets: library => (library === "tmfx-main"
			? [{ name: "zebra_stripes" }]
			: [{ name: "acid_bath" }]),
	};
	try {
		const presets = makeEditor().app._getTMFXPresets();

		assert.deepEqual(presets.map(p => p.label), ["Acid Bath", "Zebra Stripes"]);
		assert.equal(presets[0].library, "sdx-presets");
		assert.equal(presets[0].removable, true, "our own presets can be deleted");
		assert.equal(presets[1].removable, false, "TokenMagic's built-ins cannot");
	}
	finally {
		delete globalThis.window.TokenMagic;
		globalThis.game.modules = { get: () => undefined };
	}
});

test("a throwing TokenMagic yields no presets rather than breaking the dialog", () => {
	globalThis.game.modules = { get: id => (id === "tokenmagic" ? { active: true } : undefined) };
	globalThis.window.TokenMagic = {
		getPresets: () => {
			throw new Error("boom");
		},
	};
	try {
		assert.deepEqual(makeEditor().app._getTMFXPresets(), []);
	}
	finally {
		delete globalThis.window.TokenMagic;
		globalThis.game.modules = { get: () => undefined };
	}
});

test("a style editor with no pin behind it has no active filters", () => {
	assert.deepEqual(makeEditor().app._getActiveFilters(), []);
});
