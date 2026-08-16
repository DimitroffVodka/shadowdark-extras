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
const { JournalPinRenderer } = await import("../../scripts/journal/JournalPinsSD.mjs");

const ROOT = ".sdx-pin-style-editor";
const FORM = `${ROOT} form`;

/**
 * An editor whose DOM is a fresh selector-keyed tree.
 *
 * `fields` seeds form inputs by name; anything not named still resolves to a
 * node, but with an empty value, which is how the defaults get exercised.
 */
function makeEditor({ fields = {}, absent = [], lists = {}, seedAll = false, coalesceFormControls = false, pinId = null } = {}) {
	const editorDom = makeSelectorDom({ absent, lists, seedAll, coalesceFormControls });
	globalThis.document = editorDom.document;
	const app = Object.create(PinStyleEditorApp.prototype);
	app.element = editorDom.node(ROOT);
	app.pinId = pinId;
	const previewPin = editorDom.node(`${ROOT} .preview-pin`);
	const mediaBody = editorDom.node(`${ROOT} .preview-pin .preview-media-body`);
	const mediaTint = editorDom.node(`${ROOT} .preview-pin .preview-media-body .preview-media-tint`);
	const mediaRing = editorDom.node(`${ROOT} .preview-pin .preview-media-ring`);
	mediaBody.parentElement = previewPin;
	mediaTint.parentElement = mediaBody;
	mediaRing.parentElement = previewPin;
	// The production query starts at .preview-pin and asks for the descendant
	// class; alias that lookup to the explicitly modeled nested template node.
	editorDom.nodes.set(`${ROOT} .preview-pin .preview-media-tint`, mediaTint);
	editorDom.nodes.set(`${ROOT} .preview-pin .preview-media-ring`, mediaRing);
	for (const [name, value] of Object.entries(fields)) {
		const node = editorDom.node(`${FORM} [name="${name}"]`);
		node.tagName = name === "labelText" ? "TEXTAREA" : "INPUT";
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
	`${FORM} [name="customIconPath"] :: change`,
	`${FORM} [name="customIconPath"] :: input`,
	`${FORM} [name="customIconPreset"] :: change`,
	`${FORM} [name="hoverAnimation"] :: change`,
	`${FORM} [name="iconShapePath"] :: change`,
	`${FORM} [name="iconShapePath"] :: input`,
	`${FORM} [name="iconShapePreset"] :: change`,
	`${FORM} [name="journalId"] :: change`,
	`${FORM} [name="labelBackground"] :: change`,
	`${FORM} [name="shape"] :: change`,
	`${FORM} [name="tmfxPreset"] :: change`,
	`${FORM} [name="tmfxPreset"] :: input`,
	`${FORM} [name="tmfxPreset"] :: keyup`,
	`${FORM} input, select[0] :: change`,
	`${FORM} input[type="color"][0] :: input`,
	`${FORM} input[type="range"][0] :: input`,
	`${FORM} textarea[0] :: input`,
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

test("shape changes keep media opacity and shape-specific controls synchronized", () => {
	const { app, dom: bound } = makeEditor({ fields: { shape: "circle" }, seedAll: true });
	app._updatePreview = async () => {};
	app._onRender({}, {});
	const shape = bound.node(`${FORM} [name="shape"]`);
	const standard = bound.node(`${FORM} .standard-style-options[0]`);
	const mediaOpacity = bound.node(`${FORM} .image-opacity-option`);
	const imageOptions = bound.node(`${FORM} .image-shape-options`);
	const iconOptions = bound.node(`${FORM} .icon-shape-options`);

	shape.value = "icon";
	shape.dispatch("change");
	assert.equal(standard.style.display, "none");
	assert.equal(mediaOpacity.style.display, "block");
	assert.equal(imageOptions.style.display, "none");
	assert.equal(iconOptions.style.display, "block");

	shape.value = "circle";
	shape.dispatch("change");
	assert.equal(standard.style.display, "block");
	assert.equal(mediaOpacity.style.display, "none");
	assert.equal(imageOptions.style.display, "none");
	assert.equal(iconOptions.style.display, "none");
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
	const { app, dom: d } = makeEditor({ fields, coalesceFormControls: true });
	const pin = d.node(`${ROOT} .preview-pin`);
	const media = d.node(`${ROOT} .preview-pin .preview-media-body`);
	const tint = d.node(`${ROOT} .preview-pin .preview-media-body .preview-media-tint`);
	const ring = d.node(`${ROOT} .preview-pin .preview-media-ring`);
	const content = d.node(`${ROOT} .preview-pin .preview-content`);
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="shape"]`).dispatch("change"));
	return { pin, media, tint, ring, content, dom: d };
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
	const { app, dom: d } = makeEditor({ fields, coalesceFormControls: true });
	if (opacity !== undefined) d.node(`${FORM} ${panel} [name="opacity"]`).value = opacity;
	const pin = d.node(`${ROOT} .preview-pin`);
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="shape"]`).dispatch("change"));
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
	const { pin, media } = await preview({ shape: "image", imagePath: "worlds/test/pin.webp" });

	assert.equal(pin.style.backgroundColor, "transparent");
	assert.equal(pin.style.border, "none");
	assert.equal(media.style.backgroundColor, "transparent");
	assert.equal(media.style.border, "none");
	assert.equal(media.style.backgroundImage, 'url("worlds/test/pin.webp")');
	assert.equal(media.style.backgroundSize, "contain");
});

test("an image shape with no path shows a dashed placeholder instead", async () => {
	const { pin, media } = await preview({ shape: "image" });

	assert.equal(pin.style.backgroundColor, "transparent");
	assert.equal(pin.style.border, "none");
	assert.equal(media.style.backgroundImage, "none");
	assert.equal(media.style.border, "1px dashed #666");
});

test("changing the rendered shape control clears media preview state", async () => {
	const { app, dom: d } = makeEditor({
		fields: { shape: "image", imagePath: "worlds/test/pin.webp" },
		seedAll: true,
		coalesceFormControls: true,
	});
	app._onRender({}, {});
	await Promise.resolve();

	const pin = d.node(`${ROOT} .preview-pin`);
	const media = d.node(`${ROOT} .preview-pin .preview-media-body`);
	const tint = d.node(`${ROOT} .preview-pin .preview-media-body .preview-media-tint`);
	const ring = d.node(`${ROOT} .preview-pin .preview-media-ring`);
	assert.equal(media.style.backgroundImage, 'url("worlds/test/pin.webp")');
	assert.equal(pin.listeners.get("mouseenter")?.length, 1);
	assert.equal(pin.listeners.get("mouseleave")?.length, 1);
	let rebuilds = 0;
	const updatePreview = app._updatePreview;
	app._updatePreview = async function countShapeRebuild() {
		rebuilds += 1;
		return updatePreview.call(this);
	};

	const shape = d.node(`${FORM} [name="shape"]`);
	shape.value = "circle";
	assert.equal(shape.listeners.get("change")?.length, 2,
		"the coalesced rendered shape owns generic preview and visibility listeners");
	await Promise.all(shape.dispatch("change"));
	assert.equal(rebuilds, 1, "one rendered shape event rebuilds the preview once");

	assert.equal(media.style.backgroundImage, "none");
	assert.equal(media.style.backgroundSize, "initial");
	assert.equal(media.style.backgroundRepeat, "initial");
	assert.equal(media.style.backgroundPosition, "initial");
	assert.equal(tint.style.display, "none");
	assert.equal(tint.style.backgroundColor, "transparent");
	assert.equal(tint.style.backgroundImage, "none");
	assert.equal(tint.style.backgroundSize, "initial");
	assert.equal(tint.style.backgroundPosition, "initial");
	assert.equal(tint.style.backgroundRepeat, "initial");
	assert.equal(tint.style.maskImage, "none");
	assert.equal(tint.style.webkitMaskImage, "none");
	assert.equal(ring.style.display, "none");
	assert.equal(ring.style.outline, "none");
	assert.equal(ring.style.outlineOffset, "0px");
	assert.equal(ring.style.borderRadius, "0");
	assert.equal(media.style.borderRadius, "0");
	assert.equal(media.style.opacity, "1");
	assert.equal(media.style.overflow, "visible");
	assert.equal(pin.style.opacity, "1");
	assert.equal(pin.style.backgroundImage, "none");
	assert.equal(pin.style.backgroundSize, "initial");
	assert.equal(pin.style.backgroundPosition, "initial");
	assert.equal(pin.style.backgroundRepeat, "initial");
	assert.equal(pin._sdxHoverHandlers, null);
	assert.equal(pin.listeners.get("mouseenter")?.length, 0);
	assert.equal(pin.listeners.get("mouseleave")?.length, 0);
});

test("an image preview renders common content and labels from the shared shape event", async () => {
	const { app, dom: d } = makeEditor({
		fields: {
			shape: "image",
			imagePath: "worlds/test/pin.webp",
			contentType: "none",
			labelText: "Gate",
			labelBackground: "solid",
		},
		coalesceFormControls: true,
	});
	const content = d.node(`${ROOT} .preview-pin .preview-content`);
	const label = d.node(`${ROOT} .pin-preview-canvas .preview-label`);
	content.textContent = "3";
	label.textContent = "Label Name";

	app._onRender({}, {});
	const shape = d.node(`${FORM} [name="shape"]`);
	assert.equal(d.bindings.filter(binding => binding.selector === shape.path && binding.event === "change").length, 2,
		"the rendered shape owns generic preview and visibility listeners");
	await Promise.all(shape.dispatch("change"));

	assert.equal(content.textContent, "", "none removes the template-seeded sample content");
	assert.equal(label.style.display, "flex", "image bodies still run common label preview handling");
});

test("image previews keep the renderer's common content overlay semantics", async () => {
	const cases = [
		{
			name: "text",
			fields: { contentType: "text", customText: "Room 7" },
			assertContent: content => assert.equal(content.textContent, "Room 7"),
		},
		{
			name: "symbol",
			fields: { contentType: "symbol", symbolClass: "fa-solid fa-skull" },
			assertContent: content => assert.equal(content.innerHTML, '<i class="fa-solid fa-skull"></i>'),
		},
		{
			name: "custom icon",
			fields: { contentType: "customIcon", customIconPath: "modules/test/gate.svg" },
			assertContent: content => assert.match(content.innerHTML, /preview-custom-icon/),
		},
	];

	for (const testCase of cases) {
		const { app, dom: d } = makeEditor({
			fields: {
				shape: "image",
				imagePath: "worlds/test/pin.webp",
				...testCase.fields,
			},
			coalesceFormControls: true,
		});
		const content = d.node(`${ROOT} .preview-pin .preview-content`);
		app._onRender({}, {});
		const shape = d.node(`${FORM} [name="shape"]`);
		await Promise.all(shape.dispatch("change"));
		testCase.assertContent(content);
	}
});

test("media preview applies the renderer's base tint and opacity controls", async () => {
	for (const fields of [
		{ shape: "image", imagePath: "worlds/test/pin.webp", imageTint: "#123456" },
		{ shape: "icon", iconShapePath: "modules/test/outer.svg", iconShapeTint: "#654321" },
	]) {
		const { app, dom: d } = makeEditor({ fields, coalesceFormControls: true });
		d.node(`${FORM} .image-opacity-option [name="opacity"]`).value = "0.5";
		app._onRender({}, {});
		const shape = d.node(`${FORM} [name="shape"]`);
		await Promise.all(shape.dispatch("change"));
		const pin = d.node(`${ROOT} .preview-pin`);
		const tint = d.node(`${ROOT} .preview-pin .preview-media-body .preview-media-tint`);

		assert.equal(pin.style.opacity, "1");
		assert.equal(d.node(`${ROOT} .preview-pin .preview-media-body`).style.opacity, "0.5");
		assert.match(tint.style.backgroundImage, /^linear-gradient\(/);
		assert.equal(tint.style.backgroundBlendMode, "multiply");
		assert.equal(tint.style.display, "block");
		assert.match(tint.style.maskImage, /^url\(/);
	}
});

test("media preview hover leave restores the base tint", async () => {
	const { app, dom: d } = makeEditor({
		fields: {
			shape: "image",
			imagePath: "worlds/test/pin.webp",
			imageTint: "#123456",
			hoverAnimation: "highlight",
			hoverImageTint: "#ff0000",
		},
		coalesceFormControls: true,
	});
	app._onRender({}, {});
	const shape = d.node(`${FORM} [name="shape"]`);
	await Promise.all(shape.dispatch("change"));
	const pin = d.node(`${ROOT} .preview-pin`);
	const tint = d.node(`${ROOT} .preview-pin .preview-media-body .preview-media-tint`);
	const media = d.node(`${ROOT} .preview-pin .preview-media-body`);
	const baseRadius = media.style.borderRadius;

	await Promise.all(pin.dispatch("mouseenter"));
	assert.match(tint.style.backgroundImage, /#ff0000/);
	await Promise.all(pin.dispatch("mouseleave"));
	assert.match(tint.style.backgroundImage, /#123456/);
	assert.equal(media.style.borderRadius, baseRadius);
});

test("media hover tint activates with a white or empty base tint", async () => {
	for (const fields of [
		{ shape: "image", imagePath: "worlds/test/pin.webp" },
		{ shape: "icon", iconShapePath: "modules/test/body.svg", iconShapeTint: "#ffffff" },
	]) {
		const { app, dom: d } = makeEditor({
			fields: { ...fields, hoverAnimation: "highlight", hoverImageTint: "#00ff00" },
			coalesceFormControls: true,
		});
		app._onRender({}, {});
		const pin = d.node(`${ROOT} .preview-pin`);
		const tint = d.node(`${ROOT} .preview-pin .preview-media-body .preview-media-tint`);
		await Promise.all(d.node(`${FORM} [name="shape"]`).dispatch("change"));
		assert.equal(tint.style.display, "block");
		assert.match(tint.style.backgroundImage, /#ffffff/);
		await Promise.all(pin.dispatch("mouseenter"));
		assert.match(tint.style.backgroundImage, /#00ff00/);
		await Promise.all(pin.dispatch("mouseleave"));
		assert.match(tint.style.backgroundImage, /#ffffff/);
	}
});

test("media composites have no geometric backing and only show the hover ring", async () => {
	for (const fields of [
		{
			shape: "image", imagePath: "modules/test/transparent.svg", imageTint: "#123456",
			hoverAnimation: "highlight", hoverImageTint: "#ff0000", hoverRingWidth: "4",
		},
		{
			shape: "icon", iconShapePath: "modules/test/transparent.svg", iconShapeTint: "#123456",
			hoverAnimation: "highlight", hoverImageTint: "#ff0000", hoverRingWidth: "4",
		},
	]) {
		const { app, dom: d } = makeEditor({ fields, coalesceFormControls: true });
		const pin = d.node(`${ROOT} .preview-pin`);
		const media = d.node(`${ROOT} .preview-pin .preview-media-body`);
		const ring = d.node(`${ROOT} .preview-pin .preview-media-ring`);
		const content = d.node(`${ROOT} .preview-pin .preview-content`);
		media.parentElement = pin;
		content.parentElement = pin;
		pin.children = [media, content];
		assert.deepEqual(pin.children, [media, content], "test models the rendered template composite");
		app._onRender({}, {});
		await Promise.all(d.node(`${FORM} [name="shape"]`).dispatch("change"));
		assert.equal(pin.style.backgroundColor, "transparent");
		assert.equal(pin.style.border, "none");
		await Promise.all(pin.dispatch("mouseenter"));
		assert.equal(ring.style.outline, "4px solid #ff0000");
		assert.equal(ring.style.borderRadius, "10px");
		await Promise.all(pin.dispatch("mouseleave"));
		assert.equal(ring.style.outline, "none");
		assert.equal(ring.style.borderRadius, "0");
		assert.equal(media.style.borderRadius, "0");
	}
});

test("rendered label controls update text and typography without a background frame", async () => {
	const { app, dom: d } = makeEditor({
		fields: {
			labelText: "Vault",
			labelFontFamily: "Georgia",
			labelFontSize: "22",
			labelColor: "#ffcc00",
			labelStroke: "#110000",
			labelStrokeThickness: "2",
			labelBold: true,
			labelItalic: true,
			labelBackground: "none",
		},
		coalesceFormControls: true,
	});
	const label = d.node(`${ROOT} .pin-preview-canvas .preview-label`);
	label.textContent = "Label Name";
	app._onRender({}, {});

	const labelText = d.node(`${FORM} [name="labelText"]`);
	assert.equal(d.bindings.filter(binding => binding.selector === labelText.path && binding.event === "input").length, 1);
	await Promise.all(labelText.dispatch("input"));

	assert.equal(label.textContent, "Vault");
	assert.equal(label.style.display, "flex", "a label remains visible without a background");
	assert.equal(label.style.fontFamily, "Georgia");
	assert.equal(label.style.fontSize, "22px");
	assert.equal(label.style.color, "#ffcc00");
	assert.equal(label.style.fontWeight, "bold");
	assert.equal(label.style.fontStyle, "italic");
	assert.equal(label.style.webkitTextStroke, "2px #110000");
	assert.equal(label.style.opacity, "1");
	assert.equal(label.style.border, "none");
});

test("label background modes reset stale frames and keep opacity off the text", async () => {
	const { app, dom: d } = makeEditor({
		fields: {
			labelText: "Gate",
			labelBackground: "solid",
			labelBackgroundColor: "#102030",
			labelBackgroundOpacity: "0.4",
			labelImageBackgroundColor: "#102030",
			labelBorderImagePath: "",
			labelBorderColor: "#ffffff",
			labelBorderWidth: "2",
			labelBorderRadius: "6",
		},
		coalesceFormControls: true,
	});
	const label = d.node(`${ROOT} .pin-preview-canvas .preview-label`);
	app._onRender({}, {});

	assert.equal(label.style.backgroundColor, "rgba(16, 32, 48, 0.4)");
	assert.equal(label.style.opacity, "1", "solid background opacity must not fade label text");
	assert.equal(label.style.border, "2px solid #ffffff");

	const background = d.node(`${FORM} [name="labelBackground"]`);
	const imagePath = d.node(`${FORM} [name="labelBorderImagePath"]`);
	const imageOpacity = d.node(`${FORM} [name="labelImageBackgroundOpacity"]`);
	background.value = "image";
	imageOpacity.value = "0.6";
	imagePath.value = "";
	await Promise.all(background.dispatch("change"));

	assert.equal(label.textContent, "Gate");
	assert.equal(label.style.display, "flex");
	assert.equal(label.style.border, "none", "an empty image path has no stale solid frame");
	assert.equal(label.style.borderImageSource, "none");
	assert.equal(label.style.opacity, "1");
	assert.equal(label.style.backgroundColor, "transparent", "empty image paths fall back to text without a frame");

	imagePath.value = "modules/test/frame.png";
	await Promise.all(imagePath.dispatch("change"));
	assert.equal(label.style.borderImageSource, 'url("modules/test/frame.png")');
	assert.equal(label.style.backgroundColor, "rgba(16, 32, 48, 0.6)");

	background.value = "none";
	await Promise.all(background.dispatch("change"));
	assert.equal(label.style.display, "flex");
	assert.equal(label.style.backgroundColor, "transparent");
	assert.equal(label.style.border, "none");
	assert.equal(label.style.borderImageSource, "none");
	assert.equal(label.style.opacity, "1");
});

test("label hover visibility is expressed by the rendered preview control", async () => {
	const { app, dom: d } = makeEditor({
		fields: { labelText: "Whisper", labelShowOnHover: true, labelBackground: "none" },
		coalesceFormControls: true,
	});
	const label = d.node(`${ROOT} .pin-preview-canvas .preview-label`);
	const pin = d.node(`${ROOT} .preview-pin`);
	app._onRender({}, {});

	assert.equal(label.style.display, "none", "hover-only labels start hidden in the preview");
	await Promise.all(pin.dispatch("mouseenter"));
	assert.equal(label.style.display, "flex");
	await Promise.all(pin.dispatch("mouseleave"));
	assert.equal(label.style.display, "none");

	await Promise.all(d.node(`${FORM} [name="labelText"]`).dispatch("input"));
	await Promise.all(d.node(`${FORM} [name="labelText"]`).dispatch("input"));
	assert.equal(pin.listeners.get("mouseenter")?.length, 1);
	assert.equal(pin.listeners.get("mouseleave")?.length, 1);
});

test("label anchors are positioned from the preview canvas, not sibling flex flow", async () => {
	const cases = [
		["center", "translate(-50%, -50%)", 0],
		["top", "translate(-50%, calc(-100% - 25px))", 25],
		["bottom", "translate(-50%, 25px)", 25],
		["left", "translate(calc(-100% - 25px), -50%)", 25],
		["right", "translate(25px, -50%)", 25],
	];
	for (const [anchor, expectedTransform, gap] of cases) {
		const { app, dom: d } = makeEditor({ fields: {
			labelText: "Vault", labelAnchor: anchor, labelOffset: "5", size: "40",
		}, coalesceFormControls: true });
		app._onRender({}, {});
		await Promise.all(d.node(`${FORM} [name="labelAnchor"]`).dispatch("change"));
		const label = d.node(`${ROOT} .pin-preview-canvas .preview-label`);
		// This is the independent edge-origin contract: the browser resolves the
		// percentage component from the label's own dimensions, then adds gap.
		assert.equal(label.style.position, "absolute");
		assert.equal(label.style.left, "50%");
		assert.equal(label.style.top, "50%");
		assert.equal(label.style.transform, expectedTransform, anchor);
		assert.equal(gap, anchor === "center" ? 0 : 25);
	}
});

test("label anchor contract preserves positive and negative edge clearances", async () => {
	for (const [anchor, offset, expectedGap] of [
		["top", 5, 25], ["bottom", 5, 25], ["left", 5, 25], ["right", 5, 25],
		["top", -5, 15], ["bottom", -5, 15], ["left", -5, 15], ["right", -5, 15],
	]) {
		const { app, dom: d } = makeEditor({ fields: {
			labelText: "Vault", labelAnchor: anchor, labelOffset: String(offset), size: "40",
		}, coalesceFormControls: true });
		app._onRender({}, {});
		await Promise.all(d.node(`${FORM} [name="labelOffset"]`).dispatch("input"));
		const transform = d.node(`${ROOT} .pin-preview-canvas .preview-label`).style.transform;
		assert.match(transform, new RegExp(`${expectedGap}px`), `${anchor} offset ${offset}`);
		assert.match(transform, /-100%|25px|15px/);
	}
});

test("icon hover highlight uses hoverImageTint and restores iconShapeTint", async () => {
	const { app, dom: d } = makeEditor({ fields: {
		shape: "icon", iconShapePath: "modules/test/body.svg", iconShapeTint: "#123456",
		hoverAnimation: "highlight", hoverImageTint: "#ff0000",
	}, coalesceFormControls: true });
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="shape"]`).dispatch("change"));
	const pin = d.node(`${ROOT} .preview-pin`);
	const tint = d.node(`${ROOT} .preview-pin .preview-media-body .preview-media-tint`);
	await Promise.all(pin.dispatch("mouseenter"));
	assert.match(tint.style.backgroundImage, /#ff0000/);
	await Promise.all(pin.dispatch("mouseleave"));
	assert.match(tint.style.backgroundImage, /#123456/);
});

test("custom-icon preview masks the asset with iconColor", async () => {
	const { app, dom: d } = makeEditor({
		fields: { contentType: "customIcon", customIconPath: "modules/test/gate.svg", iconColor: "#abcdef" },
		coalesceFormControls: true,
	});
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="customIconPath"]`).dispatch("input"));
	const content = d.node(`${ROOT} .preview-pin .preview-content`);
	const icon = content.querySelector(".preview-custom-icon");
	assert.equal(icon.style.backgroundColor, "#abcdef");
	assert.equal(icon.style.maskImage, 'url("modules/test/gate.svg")');
});

test("label image paths trim whitespace and preserve all four slice values", async () => {
	const { app, dom: d } = makeEditor({ fields: {
		labelText: "Vault", labelBackground: "image", labelBorderImagePath: "  modules/test/frame.png  ",
		labelBorderSliceTop: "11", labelBorderSliceRight: "22", labelBorderSliceBottom: "33", labelBorderSliceLeft: "44",
	}, coalesceFormControls: true });
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="labelBackground"]`).dispatch("change"));
	const label = d.node(`${ROOT} .pin-preview-canvas .preview-label`);
	assert.equal(label.style.borderImageSource, 'url("modules/test/frame.png")');
	assert.equal(label.style.borderImageSlice, "11 22 33 44 fill");
});

test("an icon body renders a second custom icon as its content overlay", async () => {
	const { app, dom: d } = makeEditor({
		fields: {
			shape: "icon",
			iconShapePath: "modules/test/outer.svg",
			contentType: "customIcon",
			customIconPath: "modules/test/inner.svg",
		},
		coalesceFormControls: true,
	});
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="customIconPath"]`).dispatch("input"));
	const media = d.node(`${ROOT} .preview-pin .preview-media-body`);
	const content = d.node(`${ROOT} .preview-pin .preview-content`);

	assert.equal(media.style.backgroundImage, 'url("modules/test/outer.svg")');
	assert.equal(content.querySelector(".preview-custom-icon").style.maskImage,
		'url("modules/test/inner.svg")');
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

// A custom icon path is used in a CSS mask URL, so it must be escaped before
// it reaches the generated preview markup.
test("a custom icon path is serialized as a CSS URL without HTML escaping", async () => {
	const { app, dom: d } = makeEditor({
		fields: { contentType: "customIcon", customIconPath: 'a.svg" onerror="alert(1)' },
		coalesceFormControls: true,
	});
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="customIconPath"]`).dispatch("input"));
	const content = d.node(`${ROOT} .preview-pin .preview-content`);

	const mask = content.querySelector(".preview-custom-icon").style.maskImage;
	assert.ok(!mask.includes("&quot;") && !content.innerHTML.includes("onerror"),
		"CSS URL context must not use HTML escaping or create markup");
	assert.match(mask, /a\.svg\\" onerror=\\"alert\(1\)/);
});

test("an ordinary icon path with spaces and ampersand survives CSS serialization", async () => {
	const { app, dom: d } = makeEditor({
		fields: { contentType: "customIcon", customIconPath: "modules/test/a&b space.svg" },
		coalesceFormControls: true,
	});
	app._onRender({}, {});
	await Promise.all(d.node(`${FORM} [name="customIconPath"]`).dispatch("input"));
	const content = d.node(`${ROOT} .preview-pin .preview-content`);

	assert.equal(content.querySelector(".preview-custom-icon").style.maskImage,
		'url("modules/test/a&b space.svg")');
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

test("clearing an SDX preview never destroys another module's transient filter", () => {
	const previousTokenMagic = globalThis.window.TokenMagic;
	globalThis.window.TokenMagic = {};
	const destroyed = [];
	const foreign = {
		filterId: "foreign", transient: true, destroy: () => destroyed.push("foreign"),
	};
	const own = {
		filterId: "own", transient: true, _sdxPreview: true,
		destroy: () => destroyed.push("own"),
	};
	const graphics = {
		filters: [foreign, own],
		_TMFSetAnimeFlag: () => {},
	};
	JournalPinRenderer._pins.set("preview-pin", graphics);
	try {
		makeEditor({ pinId: "preview-pin" }).app._clearTMFXPreviewFiltersOnly();
		assert.deepEqual(graphics.filters, [foreign]);
		assert.deepEqual(destroyed, ["own"]);
	}
	finally {
		JournalPinRenderer._pins.delete("preview-pin");
		globalThis.window.TokenMagic = previousTokenMagic;
	}
});

test("preview filter construction dedupes by type and id and marks only SDX filters", () => {
	class GlowFilter {
		constructor(params) { Object.assign(this, params); }
	}
	const previousTokenMagic = globalThis.window.TokenMagic;
	globalThis.window.TokenMagic = {
		getPresets: () => [{
			name: "glow",
			params: [
				{ filterType: "glow", filterId: "already-live" },
				{ filterType: "glow", filterId: "preview-only" },
			],
		}],
		filterTypes: { glow: GlowFilter },
	};
	try {
		const { app } = makeEditor({ pinId: "preview-pin" });
		const graphics = {
			id: "preview-pin",
			filters: [{ filterType: "glow", filterId: "already-live", transient: true }],
		};
		const filters = app._buildTMFXPreviewFilters(graphics, "glow", "tmfx-main");
		assert.equal(filters.length, 1);
		assert.equal(filters[0].filterId, "preview-only");
		assert.equal(filters[0]._sdxPreview, true);
		assert.equal(filters[0].transient, true);
	}
	finally {
		globalThis.window.TokenMagic = previousTokenMagic;
	}
});
