/**
 * Torch Sprite dialog — per-item prop image and prop/flame geometry for light
 * sources. Saved to the `torchSprite` flag, which getAnimationConfig merges
 * over the name/template preset. An in-dialog preview (same box as the
 * Equipped Sprite dialog) follows the sliders; while the light is lit the
 * actor's tokens preview too, and closing without saving replays the saved config.
 */

import { getAnimationConfig, playTorchAnimation } from "./TorchAnimationSD.mjs";

const MODULE_ID = "shadowdark-extras";
const PREVIEW_DEBOUNCE_MS = 150;
// Preview token square is 120px (.weapon-preview-token); offsets are in token widths.
const PREVIEW_TOKEN_PX = 120;
const L = key => game.i18n.localize(`SHADOWDARK_EXTRAS.torchSprite.${key}`);

// [field, min, max, step]
const SLIDERS = [
	["scale", 0.1, 3, 0.05],
	["torchOffsetX", -1, 1, 0.01],
	["torchOffsetY", -1, 1, 0.01],
	["flameScale", 0.1, 3, 0.05],
	["flameOffsetX", -1, 1, 0.01],
	["flameOffsetY", -1, 1, 0.01],
	["flameRotation", -180, 180, 1],
];

// The inner slider tracks a drag before the <range-picker> value does.
const sliderValue = el => Number(el.querySelector("input[type=range]")?.value ?? el.value);

function readForm(form) {
	const config = {};
	for (const [name] of SLIDERS) config[name] = sliderValue(form.elements[name]);
	// Empty image keeps whatever the preset (or an earlier save) chose.
	if (form.elements.torchFile.value) config.torchFile = form.elements.torchFile.value;
	return config;
}

// The flame is drawn on the prop, but both are stored as token-relative offsets,
// so prop edits must carry the flame along. The anchor is where the flame sits on
// the prop, in prop-scale units; it only changes when the flame itself is edited,
// so repeated prop drags don't accumulate slider rounding.
const PROP_FIELDS = ["scale", "torchOffsetX", "torchOffsetY"];
const FLAME_FIELDS = ["flameOffsetX", "flameOffsetY", "flameScale"];

export function flameAnchor(c) {
	return {
		x: (c.flameOffsetX - c.torchOffsetX) / c.scale,
		y: (c.flameOffsetY - c.torchOffsetY) / c.scale,
		size: c.flameScale / c.scale,
	};
}

export function carryFlame(c, anchor) {
	return {
		flameOffsetX: c.torchOffsetX + (anchor.x * c.scale),
		flameOffsetY: c.torchOffsetY + (anchor.y * c.scale),
		flameScale: anchor.size * c.scale,
	};
}

// A range-picker clamps to its bounds, so a carried flame past a slider's end
// would land somewhere else on the prop. Stop the prop edit where the flame
// reaches its limit instead. Each carried value is linear in the edited field;
// the result is snapped inward to the prop slider's step, because the picker
// rounds whatever it is given.
export function fitProp(c, anchor, field) {
	const [, min, max, step] = SLIDERS.find(([name]) => name === field);
	const at = v => carryFlame({ ...c, [field]: v }, anchor);
	const f0 = at(0);
	const f1 = at(1);
	let lo = min;
	let hi = max;
	for (const [name, fmin, fmax] of SLIDERS) {
		if (!FLAME_FIELDS.includes(name)) continue;
		const k = f1[name] - f0[name];
		if (!k) continue;
		const a = (fmin - f0[name]) / k;
		const b = (fmax - f0[name]) / k;
		lo = Math.max(lo, Math.min(a, b));
		hi = Math.min(hi, Math.max(a, b));
	}
	if (c[field] > hi) return min + (Math.floor(((hi - min) / step) + 1e-9) * step);
	if (c[field] < lo) return min + (Math.ceil(((lo - min) / step) - 1e-9) * step);
	return c[field];
}

/** Sequencer database path (e.g. "jb2a.flames.01.orange") → playable file, or null. */
function resolveEffectFile(path) {
	if (!path || path.includes("/")) return path || null;
	const entry = globalThis.Sequencer?.Database?.getEntry(path, { softFail: true });
	const file = [].concat(entry || [])[0]?.getFile?.();
	return typeof file === "string" ? file : null;
}

function updatePreview(form, fallbackImage) {
	const c = readForm(form);
	const prop = form.querySelector(".sdx-torch-preview-prop");
	const flame = form.querySelector(".sdx-torch-preview-flame");
	const src = c.torchFile || fallbackImage;
	prop.hidden = !src;
	if (src && prop.getAttribute("src") !== src) prop.src = src;
	// Prop art is drawn pre-tilted; the canvas sprite settles unrotated (the
	// presets' flameRotation 45 lines up with the art's own tilt).
	prop.style.transform = `translate(${c.torchOffsetX * PREVIEW_TOKEN_PX}px, ${c.torchOffsetY * PREVIEW_TOKEN_PX}px) `
		+ `scale(${c.scale})`;
	if (flame) {
		flame.style.transform = `translate(${c.flameOffsetX * PREVIEW_TOKEN_PX}px, ${c.flameOffsetY * PREVIEW_TOKEN_PX}px) `
			+ `rotate(${c.flameRotation}deg) scale(${c.flameScale})`;
	}
}

export async function openTorchSpriteConfig(item) {
	const current = getAnimationConfig(item);
	const isLit = () => item.system?.light?.active === true;
	const tokens = () => item.actor?.getActiveTokens() ?? [];
	let timer;
	let previewChain = Promise.resolve();
	let previewed = false;

	const esc = foundry.utils.escapeHTML;
	const tokenImg = tokens()[0]?.document.texture.src
		?? item.actor?.prototypeToken?.texture?.src
		?? item.actor?.img
		?? "icons/svg/mystery-man.svg";
	const flameFile = resolveEffectFile(current.flameFile);

	const sliders = SLIDERS.map(([name, min, max, step]) => `
		<div class="form-group">
			<label>${L(name)}</label>
			<range-picker name="${name}" value="${current[name]}" min="${min}" max="${max}" step="${step}"></range-picker>
		</div>`).join("");

	const content = `
		<div class="form-group weapon-preview-container">
			<label>${game.i18n.localize("SHADOWDARK_EXTRAS.weaponAnimation.preview")}</label>
			<div class="weapon-preview-box">
				<div class="weapon-preview-token" style="background-image: url('${esc(tokenImg)}');"></div>
				<img class="weapon-preview-img sdx-torch-preview-prop" alt="">
				${flameFile ? `<video class="weapon-preview-img sdx-torch-preview-flame" style="z-index: 3;" src="${esc(flameFile)}" autoplay loop muted playsinline></video>` : ""}
			</div>
		</div>
		<p class="hint">${L("hint")}</p>
		<div class="form-group">
			<label>${L("torchFile")}</label>
			<file-picker name="torchFile" type="image" value="${esc(current.torchFile ?? "")}"></file-picker>
		</div>
		${sliders}`;

	const result = await foundry.applications.api.DialogV2.wait({
		classes: ["sdx-torch-sprite-config"],
		window: {
			title: game.i18n.format("SHADOWDARK_EXTRAS.torchSprite.title", { item: item.name }),
			icon: "fas fa-fire",
			resizable: true,
		},
		position: { width: 480 },
		content,
		buttons: [
			{ action: "save", label: L("save"), icon: "fas fa-save", default: true, callback: (_event, button) => readForm(button.form) },
			{ action: "reset", label: L("reset"), icon: "fas fa-undo" },
			{ action: "cancel", label: L("cancel"), icon: "fas fa-times" },
		],
		render: (_event, dialog) => {
			const form = dialog.element.querySelector("form");
			let anchor = flameAnchor(readForm(form));
			let carrying = false;
			const onEdit = event => {
				// Setting a range-picker's value fires input + change; those are ours.
				if (carrying) return;
				const field = event.target.closest?.("range-picker")?.getAttribute("name");
				if (PROP_FIELDS.includes(field)) {
					carrying = true;
					try {
						const c = readForm(form);
						const fitted = fitProp(c, anchor, field);
						if (fitted !== c[field]) form.elements[field].value = c[field] = fitted;
						const flame = carryFlame(c, anchor);
						for (const [name, value] of Object.entries(flame)) {
							form.elements[name].value = value;
						}
					}
					finally {
						carrying = false;
					}
				}
				else if (FLAME_FIELDS.includes(field)) anchor = flameAnchor(readForm(form));
				updatePreview(form, current.torchFile);
				if (!isLit()) return;
				clearTimeout(timer);
				timer = setTimeout(() => {
					const config = readForm(form);
					previewChain = previewChain.then(async () => {
						previewed = true;
						for (const token of tokens()) await playTorchAnimation(token, item, config);
					}).catch(err => console.warn(`${MODULE_ID} | Torch Sprite preview failed`, err));
				}, PREVIEW_DEBOUNCE_MS);
			};
			form.addEventListener("input", onEdit);
			form.addEventListener("change", onEdit);
			updatePreview(form, current.torchFile);
		},
	});

	clearTimeout(timer);
	await previewChain;
	if (result === "reset") await item.unsetFlag(MODULE_ID, "torchSprite");
	else if (result && typeof result === "object") await item.setFlag(MODULE_ID, "torchSprite", result);
	else if (!previewed) return;

	// Replay from the saved flag: makes a save official, or undoes a cancelled preview.
	if (isLit()) for (const token of tokens()) await playTorchAnimation(token, item);
}
