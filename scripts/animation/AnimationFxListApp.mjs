/**
 * Animation FX — Master List configuration app.
 *
 * Edits the world setting `animationFxConfig` (the master pattern list) and the
 * per-category enable toggles. Presets match items by name; a per-item override
 * on the item's Activity tab takes precedence at resolve time.
 */

import { AnimationFxSD, DEFAULT_ANIMATION_FX_CONFIG } from "./AnimationFxSD.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * `sprite: true` categories are persistent equipped-weapon images (handled by
 * WeaponAnimationSD), not transient attack FX. They use a different row schema:
 * imagePath / offsetX / offsetY / rotation / animationType, and an <img>
 * thumbnail instead of a <video>.
 */
const CATEGORY_META = [
	{ key: "spells", label: "Spells / Scrolls / Wands", icon: "fa-wand-magic-sparkles" },
	{ key: "weapons", label: "Weapons (attack FX)", icon: "fa-gavel" },
	{ key: "npcActions", label: "NPC Attacks", icon: "fa-dragon" },
	{ key: "weaponSprites", label: "Equipped Weapon Sprites", icon: "fa-hand-fist", sprite: true }
];

const ANIMATION_TYPES = ["none", "wobble", "bobbing", "floating", "rotating"];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Merge one row's form values onto an existing preset, preserving fields the
 * form doesn't expose (opacity, sound, offsetX, the `miss` block, persist...).
 *
 * @param {object} base existing preset (may be {})
 * @param {string} key  preset key ("_default" has no editable pattern)
 * @param {object} vals raw form values for this row
 */
function mergePresetFromForm(base, key, vals, isSprite = false) {
	// Equipped-weapon sprites have a completely different shape than attack FX.
	// Merging them with the FX schema would silently destroy imagePath/offsets.
	if (isSprite) {
		return {
			...base,
			label: vals.label ?? base.label ?? "",
			patterns: key === "_default" ? "" : (vals.patterns ?? base.patterns ?? ""),
			enabled: base.enabled !== false,
			imagePath: (vals.imagePath ?? base.imagePath ?? "").trim(),
			offsetX: Number(vals.offsetX ?? base.offsetX ?? 0.35),
			offsetY: Number(vals.offsetY ?? base.offsetY ?? 0.1),
			rotation: Number(vals.rotation ?? base.rotation ?? 0),
			scale: Number(vals.scale) || base.scale || 1,
			animationType: vals.animationType ?? base.animationType ?? "wobble"
		};
	}
	return {
		...base,
		label: vals.label ?? base.label ?? "",
		patterns: key === "_default" ? "" : (vals.patterns ?? base.patterns ?? ""),
		type: vals.type ?? base.type ?? "projectile",
		target: vals.target ?? base.target ?? "target",
		hit: {
			...(base.hit || {}),
			file: (vals.file ?? base.hit?.file ?? "").trim(),
			// Empty sound field clears it; otherwise trim. Falls back to the
			// existing value only when the field wasn't in the form at all.
			sound: vals.sound !== undefined ? (vals.sound.trim() || undefined) : base.hit?.sound,
			scale: Number(vals.scale) || base.hit?.scale || 1,
			duration: parseInt(vals.duration, 10) || base.hit?.duration || 1500
		}
	};
}

/** Is this category one of the sprite (persistent image) categories? */
function isSpriteCategory(key) {
	return !!CATEGORY_META.find(c => c.key === key)?.sprite;
}

export class AnimationFxListApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "sdx-animation-fx-list",
		classes: ["shadowdark-extras", "sdx-animfx-list"],
		tag: "form",
		window: { title: "Animation FX — Master List", resizable: true },
		// Bounded height: with 80+ preset rows a height:"auto" window grows past
		// the viewport and the list becomes unreachable. The inner wrapper scrolls.
		position: { width: 960, height: 760 },
		form: {
			handler: AnimationFxListApp.#onSubmit,
			submitOnChange: false,
			closeOnSubmit: false
		}
	};

	static PARTS = {
		form: {
			template: "modules/shadowdark-extras/templates/animation-fx-list.hbs",
			scrollable: [".sdx-animfx-scroll"]
		}
	};

	/** Working copy so add/delete survive across re-renders until saved. */
	_working = null;

	/**
	 * Thumbnail URL for a preset file. The implementation lives on AnimationFxSD
	 * so the per-item Activity panel can reuse it; kept here as a thin alias.
	 *
	 * @param {string} file
	 * @returns {string} URL, or "" when not previewable
	 */
	static resolveVideoSrc(file) {
		return AnimationFxSD.resolveVideoSrc(file);
	}

	_getWorking() {
		if (!this._working) {
			const stored = AnimationFxSD.getConfig();
			this._working = foundry.utils.deepClone(stored || DEFAULT_ANIMATION_FX_CONFIG);
		}
		// Ensure every category object exists
		for (const cat of CATEGORY_META) {
			if (!this._working[cat.key] || typeof this._working[cat.key] !== "object") {
				this._working[cat.key] = {};
			}
		}
		return this._working;
	}

	async _prepareContext(options) {
		const working = this._getWorking();
		const categories = CATEGORY_META.map(cat => {
			let enabled = true;
			try { enabled = game.settings.get(MODULE_ID, `animationFxCategory_${cat.key}`); } catch (e) { /* default */ }

			const map = working[cat.key] || {};
			const presets = Object.entries(map).map(([key, p]) => {
				if (cat.sprite) {
					return {
						key,
						isDefault: key === "_default",
						imgSrc: p.imagePath ? foundry.utils.getRoute(p.imagePath) : "",
						label: p.label ?? "",
						patterns: p.patterns ?? "",
						imagePath: p.imagePath ?? "",
						offsetX: p.offsetX ?? 0.35,
						offsetY: p.offsetY ?? 0.1,
						rotation: p.rotation ?? 0,
						scale: p.scale ?? 1,
						animTypes: ANIMATION_TYPES.map(t => ({
							value: t,
							label: t.charAt(0).toUpperCase() + t.slice(1),
							selected: (p.animationType || "wobble") === t
						}))
					};
				}
				const hit = p.hit || {};
				return {
					key,
					isDefault: key === "_default",
					videoSrc: AnimationFxListApp.resolveVideoSrc(hit.file),
					label: p.label ?? "",
					patterns: p.patterns ?? "",
					typeProjectile: (p.type || "projectile") === "projectile",
					typeOnToken: p.type === "onToken",
					typeCone: p.type === "cone",
					targetTarget: (p.target || "target") === "target",
					targetSelf: p.target === "self",
					file: hit.file ?? "",
					sound: hit.sound ?? "",
					scale: hit.scale ?? 1,
					duration: hit.duration ?? 1500
				};
			});
			// _default first for readability
			presets.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
			return { key: cat.key, label: cat.label, icon: cat.icon, sprite: !!cat.sprite, enabled, presets };
		});
		let soundEnabled = true, volume = 0.8;
		try { soundEnabled = game.settings.get(MODULE_ID, "animationFxSoundEnabled"); } catch (e) { /* default */ }
		try { volume = game.settings.get(MODULE_ID, "animationFxVolume"); } catch (e) { /* default */ }

		// Ambient & Events (Torch, Level-Up) — SDX-native effects, file-only editable.
		const amb = AnimationFxSD.getAmbient();
		const ambient = Object.entries(amb).map(([key, v]) => {
			const isImage = /\.(svg|png|webp|jpe?g|gif)$/i.test(v.file || "");
			return {
				key, label: v.label ?? key, file: v.file ?? "",
				hasScale: key === "levelUp", scale: v.scale ?? 1,
				isImage, imgSrc: isImage ? foundry.utils.getRoute(v.file) : "",
				videoSrc: isImage ? "" : AnimationFxListApp.resolveVideoSrc(v.file)
			};
		});

		return { categories, sound: { enabled: soundEnabled, volume }, ambient };
	}

	/** Read current DOM inputs into the working config (without saving). */
	_syncFromForm() {
		const form = this.element;
		if (!form) return;
		const fd = new foundry.applications.ux.FormDataExtended(form);
		const expanded = foundry.utils.expandObject(fd.object);
		const working = this._getWorking();

		for (const cat of CATEGORY_META) {
			const presetInputs = expanded.preset?.[cat.key];
			// No inputs collected for this category (empty category, or the form
			// wasn't readable) — leave the working config alone rather than
			// replacing it with {} and destroying every preset.
			if (!presetInputs || Object.keys(presetInputs).length === 0) continue;

			for (const [key, vals] of Object.entries(presetInputs)) {
				const base = working[cat.key]?.[key] || {};
				working[cat.key][key] = mergePresetFromForm(base, key, vals, !!cat.sprite);
			}
		}
	}

	_onRender(context, options) {
		const root = this.element;
		if (!root) return;

		root.querySelectorAll(".sdx-animfx-add").forEach(btn => {
			btn.addEventListener("click", (ev) => {
				ev.preventDefault();
				this._syncFromForm();
				const cat = btn.dataset.category;
				const working = this._getWorking();
				const key = `p${foundry.utils.randomID(6)}`;
				working[cat][key] = isSpriteCategory(cat)
					? {
						label: "New Sprite",
						patterns: "",
						enabled: true,
						imagePath: "",
						offsetX: 0.35,
						offsetY: 0.1,
						rotation: 0,
						scale: 1,
						animationType: "wobble"
					}
					: {
						label: "New Preset",
						patterns: "",
						type: "projectile",
						target: "target",
						hit: { file: "", scale: 1, duration: 1500 }
					};
				this.render();
			});
		});

		root.querySelectorAll(".sdx-animfx-delete").forEach(btn => {
			btn.addEventListener("click", (ev) => {
				ev.preventDefault();
				this._syncFromForm();
				const cat = btn.dataset.category;
				const key = btn.dataset.key;
				const working = this._getWorking();
				if (working[cat]) delete working[cat][key];
				this.render();
			});
		});

		// Inline thumbnails: play on hover, rewind on leave (preload="none" keeps
		// 45+ videos cheap until the user actually hovers one).
		root.querySelectorAll("video.sdx-animfx-thumb").forEach(vid => {
			vid.addEventListener("mouseenter", () => { vid.play().catch(() => {}); });
			vid.addEventListener("mouseleave", () => { vid.pause(); vid.currentTime = 0; });
			vid.addEventListener("error", () => {
				// Swap an unloadable video for the "no preview" placeholder.
				const ph = document.createElement("div");
				ph.className = "sdx-animfx-thumb-missing";
				ph.textContent = "no preview";
				vid.replaceWith(ph);
			});
		});

		// Play a preset on the canvas from the selected token.
		root.querySelectorAll(".sdx-animfx-preview").forEach(btn => {
			btn.addEventListener("click", async (ev) => {
				ev.preventDefault();
				this._syncFromForm();
				const preset = this._getWorking()[btn.dataset.category]?.[btn.dataset.key];
				await AnimationFxSD.previewPreset(preset, { outcome: ev.shiftKey ? "miss" : "hit" });
			});
		});

		// Ambient & Events rows save immediately on change (singletons, no Save needed).
		root.querySelectorAll(".sdx-animfx-ambient-input").forEach(inp => {
			inp.addEventListener("change", async () => {
				const amb = AnimationFxSD.getAmbient();
				root.querySelectorAll(".sdx-animfx-ambient-input").forEach(i => {
					const [, key, field] = i.name.split(".");
					if (!amb[key]) amb[key] = {};
					amb[key][field] = field === "scale" ? (Number(i.value) || 1) : i.value.trim();
				});
				await AnimationFxSD.setAmbient(amb);
				ui.notifications.info("Ambient effect saved.");
			});
		});

		const clearBtn = root.querySelector(".sdx-animfx-clear-fx");
		if (clearBtn) {
			clearBtn.addEventListener("click", async (ev) => {
				ev.preventDefault();
				await AnimationFxSD.clearAllFx();
				ui.notifications.info("Cleared lingering SDX effects.");
			});
		}

		const seedBtn = root.querySelector(".sdx-animfx-seed-weapons");
		if (seedBtn) {
			seedBtn.addEventListener("click", async (ev) => {
				ev.preventDefault();
				this._syncFromForm();
				// Persist current edits first so seeding merges into them, not over them.
				await AnimationFxSD.setConfig(this._getWorking());
				const w = await AnimationFxSD.seedWeaponPresets();
				const s = await AnimationFxSD.seedSpellPresets();
				const n = await AnimationFxSD.seedNpcAttackPresets();
				const sp = await AnimationFxSD.seedWeaponSpritePresets();
				this._working = null; // re-read the merged config
				ui.notifications.info(
					`Presets seeded — weapons: ${w.added} added / ${w.skipped} existing; ` +
					`spells: ${s.added} added / ${s.skipped} existing; ` +
					`NPC attacks: ${n.added} added / ${n.skipped} existing; ` +
					`sprites: ${sp.added} added / ${sp.skipped} existing.`
				);
				this.render();
			});
		}

		const dbBtn = root.querySelector(".sdx-animfx-open-db");
		if (dbBtn) {
			dbBtn.addEventListener("click", (ev) => {
				ev.preventDefault();
				try {
					if (globalThis.Sequencer?.DatabaseViewer?.show) globalThis.Sequencer.DatabaseViewer.show();
					else if (globalThis.Sequencer?.Database?.show) globalThis.Sequencer.Database.show();
					else ui.notifications.warn("Sequencer Database viewer is not available.");
				} catch (e) { /* ignore */ }
			});
		}
	}

	static async #onSubmit(event, form, formData) {
		const expanded = foundry.utils.expandObject(formData.object);
		const app = this;
		const working = app._getWorking();

		// Apply form edits onto the working config. Deletions are already reflected
		// in `working` (the delete button mutates it), so we merge rather than
		// rebuild — a category with no inputs must never blank the whole list.
		for (const cat of CATEGORY_META) {
			const presetInputs = expanded.preset?.[cat.key];
			if (presetInputs && Object.keys(presetInputs).length > 0) {
				for (const [key, vals] of Object.entries(presetInputs)) {
					const base = working[cat.key]?.[key] || {};
					working[cat.key][key] = mergePresetFromForm(base, key, vals, !!cat.sprite);
				}
			}

			// Category enable toggle
			const enabled = !!expanded.enabled?.[cat.key];
			await game.settings.set(MODULE_ID, `animationFxCategory_${cat.key}`, enabled);
		}

		// Global (per-client) sound controls from the footer
		if (expanded.sound) {
			await game.settings.set(MODULE_ID, "animationFxSoundEnabled", !!expanded.sound.enabled);
			const vol = Number(expanded.sound.volume);
			if (!Number.isNaN(vol)) await game.settings.set(MODULE_ID, "animationFxVolume", Math.min(1, Math.max(0, vol)));
		}

		await AnimationFxSD.setConfig(working);
		ui.notifications.info("Animation FX master list saved.");
		app.render();
	}
}

/**
 * Register the settings menu that opens the master list app.
 */
export function registerAnimationFxMenu() {
	game.settings.registerMenu(MODULE_ID, "animationFxListMenu", {
		name: "Animation FX — Master List",
		label: "Configure Animations",
		hint: "Assign Sequencer/JB2A animations to spells, weapons, and NPC attacks by name.",
		icon: "fas fa-wand-magic-sparkles",
		type: AnimationFxListApp,
		restricted: true
	});
}
