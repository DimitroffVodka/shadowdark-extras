/**
 * Animation FX — Master List configuration app.
 *
 * Edits the world setting `animationFxConfig` (the master pattern list) and the
 * per-category enable toggles. Presets match items by name; a per-item override
 * on the item's Activity tab takes precedence at resolve time.
 */

import { AnimationFxSD, DEFAULT_ANIMATION_FX_CONFIG } from "./AnimationFxSD.mjs";

const MODULE_ID = "shadowdark-extras";

const CATEGORY_META = [
	{ key: "spells", label: "Spells / Scrolls / Wands", icon: "fa-wand-magic-sparkles" },
	{ key: "weapons", label: "Weapons", icon: "fa-gavel" },
	{ key: "npcActions", label: "NPC Attacks", icon: "fa-dragon" }
];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Merge one row's form values onto an existing preset, preserving fields the
 * form doesn't expose (opacity, sound, offsetX, the `miss` block, persist...).
 *
 * @param {object} base existing preset (may be {})
 * @param {string} key  preset key ("_default" has no editable pattern)
 * @param {object} vals raw form values for this row
 */
function mergePresetFromForm(base, key, vals) {
	return {
		...base,
		label: vals.label ?? base.label ?? "",
		patterns: key === "_default" ? "" : (vals.patterns ?? base.patterns ?? ""),
		type: vals.type ?? base.type ?? "projectile",
		target: vals.target ?? base.target ?? "target",
		hit: {
			...(base.hit || {}),
			file: (vals.file ?? base.hit?.file ?? "").trim(),
			scale: Number(vals.scale) || base.hit?.scale || 1,
			duration: parseInt(vals.duration, 10) || base.hit?.duration || 1500
		}
	};
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
	 * Turn a preset's `file` into a browser-playable URL for the inline <video>
	 * thumbnail. Raw `modules/...` paths are direct URLs; Sequencer Database keys
	 * (e.g. `jb2a.magic_missile`) must be resolved to a concrete file. Sequencer's
	 * entry shape varies by version, so unwrap defensively and fall back to "".
	 *
	 * @param {string} file
	 * @returns {string} URL, or "" when not previewable
	 */
	static resolveVideoSrc(file) {
		if (!file || typeof file !== "string") return "";

		// Raw file path (has a slash) — serve it directly.
		if (file.includes("/")) return foundry.utils.getRoute(file);

		const db = globalThis.Sequencer?.Database;
		if (!db) return "";
		try {
			if (typeof db.entryExists === "function" && !db.entryExists(file)) return "";

			const unwrap = (v, depth = 0) => {
				if (!v || depth > 4) return "";
				if (typeof v === "string") return v;
				if (Array.isArray(v)) return unwrap(v[0], depth + 1);
				if (typeof v.getAllFiles === "function") return unwrap(v.getAllFiles(), depth + 1);
				if (typeof v.file === "string") return v.file;
				if (v.file) return unwrap(v.file, depth + 1);
				if (v._file) return unwrap(v._file, depth + 1);
				// Nested ranged/variant maps: take the first value.
				if (typeof v === "object") {
					const first = Object.values(v)[0];
					if (first !== v) return unwrap(first, depth + 1);
				}
				return "";
			};

			let resolved = unwrap(db.getEntry?.(file));
			if (!resolved && typeof db.getAllFileEntries === "function") {
				resolved = unwrap(db.getAllFileEntries(file));
			}
			return resolved ? foundry.utils.getRoute(resolved) : "";
		} catch (e) {
			return "";
		}
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
					scale: hit.scale ?? 1,
					duration: hit.duration ?? 1500
				};
			});
			// _default first for readability
			presets.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
			return { key: cat.key, label: cat.label, icon: cat.icon, enabled, presets };
		});
		return { categories };
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
				working[cat.key][key] = mergePresetFromForm(base, key, vals);
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
				working[cat][key] = {
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
				if (!preset?.hit?.file) {
					ui.notifications.warn("This preset has no animation file.");
					return;
				}
				const source = canvas.tokens.controlled[0];
				if (!source) {
					ui.notifications.warn("Select a token first.");
					return;
				}
				const outcome = ev.shiftKey ? "miss" : "hit";

				// projectile/cone need a distinct target, or stretchTo / the cone
				// angle get zero-distance math. Fall back to a synthetic point east.
				let targets;
				if (preset.type === "projectile" || preset.type === "cone") {
					const controlled = canvas.tokens.controlled;
					const userTarget = game.user.targets.first();
					if (controlled.length >= 2) targets = [controlled[1]];
					else if (userTarget && userTarget !== source) targets = [userTarget];
					else targets = [{
						x: source.x + (source.w ?? 0) + 400,
						y: source.y,
						w: 1,
						h: source.h ?? 1,
						id: "_preview_offset"
					}];
				} else {
					targets = [source];
				}

				try {
					await AnimationFxSD._play(preset, source, targets, outcome);
				} catch (e) {
					console.warn(`${MODULE_ID} | preview failed:`, e);
					ui.notifications.error("Preview failed — see console.");
				}
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
				this._working = null; // re-read the merged config
				ui.notifications.info(
					`Presets seeded — weapons: ${w.added} added / ${w.skipped} existing; ` +
					`spells: ${s.added} added / ${s.skipped} existing.`
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
					working[cat.key][key] = mergePresetFromForm(base, key, vals);
				}
			}

			// Category enable toggle
			const enabled = !!expanded.enabled?.[cat.key];
			await game.settings.set(MODULE_ID, `animationFxCategory_${cat.key}`, enabled);
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
