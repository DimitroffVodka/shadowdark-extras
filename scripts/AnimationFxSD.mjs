/**
 * Animation FX for Shadowdark Extras
 *
 * A self-contained Sequencer-driven animation engine, ported and adapted from
 * Vagabond Crawler's `animation-fx.mjs`. This replaces reliance on Automated
 * Animations: SDX fires JB2A files directly via Sequencer at its own cast /
 * attack trigger points, so both *which* animation an item uses and *when* it
 * plays are owned by SDX.
 *
 * Two-tier resolution (hybrid model):
 *   1. Per-item override  — flags.shadowdark-extras.animationFx on the item
 *   2. Master pattern list — world setting `animationFxConfig`, matched by name
 *      2a. best-matching pattern (longest match wins)
 *      2b. category `_default`
 *   3. nothing
 *
 * Dependencies: Sequencer (playback) + a JB2A pack (assets). Presets whose file
 * lives in a module that isn't active are skipped, so a missing pack never
 * throws out of the chat hook.
 */

import { DEFAULT_WEAPON_PRESETS } from "./data/weapon-animation-presets.mjs";
import { DEFAULT_SPELL_PRESETS } from "./data/spell-animation-presets.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Default master list. Categories map to Shadowdark item types via
 * `categoryForItem`. Each category is a map of key -> preset, plus an optional
 * `_default`. Preset schema:
 *   { label, patterns:<regex str>, type:"projectile"|"cone"|"onToken",
 *     target:"self"|"target", persist?, fadeIn?, fadeOut?, opacity?,
 *     hit:<block>, miss?:<block> }
 * Block schema: { file, scale, duration, offsetX?, sound? }
 */
export const DEFAULT_ANIMATION_FX_CONFIG = {
	spells: {
		_default: {
			label: "Generic Spell Bolt",
			patterns: "",
			type: "projectile",
			target: "target",
			hit: {
				file: "jb2a.magic_missile",
				scale: 1,
				duration: 1500
			}
		}
	},
	weapons: {
		_default: {
			label: "Generic Melee",
			patterns: "",
			type: "onToken",
			target: "target",
			hit: {
				file: "jb2a.greatsword.melee.standard.white",
				scale: 1,
				duration: 1000
			}
		}
	},
	npcActions: {}
};

export const AnimationFxSD = {

	// ── Settings ─────────────────────────────────────────────────────────────

	registerSettings() {
		game.settings.register(MODULE_ID, "animationFxEnabled", {
			name: "SDX.Settings.AnimationFxEnabled.Name",
			hint: "SDX.Settings.AnimationFxEnabled.Hint",
			scope: "world", config: false, type: Boolean, default: true
		});

		game.settings.register(MODULE_ID, "animationFxTriggerOn", {
			name: "SDX.Settings.AnimationFxTriggerOn.Name",
			hint: "SDX.Settings.AnimationFxTriggerOn.Hint",
			scope: "world", config: false, type: String,
			choices: { always: "Always", hit: "On Hit Only" },
			default: "always"
		});

		game.settings.register(MODULE_ID, "animationFxConfig", {
			scope: "world", config: false, type: Object,
			default: foundry.utils.deepClone(DEFAULT_ANIMATION_FX_CONFIG)
		});

		// Per-category enable toggles (world)
		for (const cat of ["spells", "weapons", "npcActions"]) {
			game.settings.register(MODULE_ID, `animationFxCategory_${cat}`, {
				scope: "world", config: false, type: Boolean, default: true
			});
		}

		// Client-side scale + volume
		game.settings.register(MODULE_ID, "animationFxClientScale", {
			scope: "client", config: false, type: Number, default: 1.0
		});
		game.settings.register(MODULE_ID, "animationFxSoundEnabled", {
			scope: "client", config: false, type: Boolean, default: true
		});
		game.settings.register(MODULE_ID, "animationFxVolume", {
			scope: "client", config: false, type: Number, default: 0.8
		});
	},

	getConfig() {
		const stored = game.settings.get(MODULE_ID, "animationFxConfig");
		return (stored && typeof stored === "object")
			? stored
			: foundry.utils.deepClone(DEFAULT_ANIMATION_FX_CONFIG);
	},

	async setConfig(config) {
		await game.settings.set(MODULE_ID, "animationFxConfig", config);
	},

	/**
	 * Merge a bundled preset map into one category of the master list.
	 * Existing keys are preserved unless `overwrite` is true; `_default` and any
	 * user-authored presets are never removed.
	 *
	 * @param {string} category  "weapons" | "spells" | "npcActions"
	 * @param {object} presets   key -> preset
	 * @param {object}  [opts]
	 * @param {boolean} [opts.overwrite=false]
	 * @returns {Promise<{added:number, replaced:number, skipped:number}>}
	 */
	async seedPresets(category, presets, { overwrite = false } = {}) {
		const config = foundry.utils.deepClone(this.getConfig());
		if (!config[category] || typeof config[category] !== "object") config[category] = {};

		let added = 0, replaced = 0, skipped = 0;
		for (const [key, preset] of Object.entries(presets)) {
			if (key in config[category]) {
				if (!overwrite) { skipped++; continue; }
				replaced++;
			} else {
				added++;
			}
			config[category][key] = foundry.utils.deepClone(preset);
		}

		await this.setConfig(config);
		return { added, replaced, skipped };
	},

	/** Seed the bundled JB2A + psfx weapon presets. */
	async seedWeaponPresets(opts = {}) {
		return this.seedPresets("weapons", DEFAULT_WEAPON_PRESETS, opts);
	},

	/** Seed the bundled JB2A spell presets (Sequencer DB keys). */
	async seedSpellPresets(opts = {}) {
		return this.seedPresets("spells", DEFAULT_SPELL_PRESETS, opts);
	},

	_isCategoryEnabled(category) {
		if (!category) return true;
		try {
			return game.settings.get(MODULE_ID, `animationFxCategory_${category}`);
		} catch (e) {
			return true;
		}
	},

	// ── Item → category mapping ──────────────────────────────────────────────

	categoryForItem(item) {
		if (!item) return null;
		const t = item.type;
		if (t === "Weapon") return "weapons";
		if (t === "Spell" || t === "Scroll" || t === "Wand" || t === "NPC Spell") return "spells";
		if (t === "NPC Attack" || t === "NPC Special Attack") return "npcActions";
		return null;
	},

	// ── Pattern matching (autorec with specificity scoring) ──────────────────

	_patternMatchScore(name, patterns) {
		if (!patterns || !name) return 0;
		try {
			const m = new RegExp(patterns, "i").exec(name);
			return m ? m[0].length : 0;
		} catch (e) {
			return 0;
		}
	},

	/** Most specific preset (longest matched substring) from a preset map, ignoring `_default`. */
	_pickBestPattern(name, presetMap) {
		let best = null;
		let bestScore = 0;
		for (const [key, preset] of Object.entries(presetMap ?? {})) {
			if (key === "_default") continue;
			const score = this._patternMatchScore(name, preset?.patterns);
			if (score > bestScore) { best = preset; bestScore = score; }
		}
		return best;
	},

	// ── Two-tier resolution ──────────────────────────────────────────────────

	/**
	 * Resolve the animation preset for an item.
	 * @returns {object|null} preset
	 */
	resolvePreset(item) {
		if (!item) return null;

		// Tier 1: per-item override flag
		const override = item.getFlag?.(MODULE_ID, "animationFx");
		if (override && override.enabled && override.preset?.hit?.file) {
			return override.preset;
		}

		// Tier 2: master list by category
		const category = this.categoryForItem(item);
		if (!category || !this._isCategoryEnabled(category)) return null;

		const config = this.getConfig();
		const presetMap = config[category];
		if (!presetMap) return null;

		const name = item.name ?? "";
		const best = this._pickBestPattern(name, presetMap);
		if (best?.hit?.file) return best;

		// Tier 2b: category default
		if (presetMap._default?.hit?.file) return presetMap._default;

		return null;
	},

	// ── Missing-module guard ─────────────────────────────────────────────────

	/**
	 * If `file` references a module (path `modules/<id>/...` or db `jb2a.` / `<id>.`)
	 * that isn't active, return the missing module id; else null.
	 */
	_fileReferencesMissingModule(file) {
		if (!file || typeof file !== "string") return null;
		if (file.startsWith("modules/")) {
			const id = file.split("/")[1];
			if (id && !game.modules.get(id)?.active) return id;
			return null;
		}
		// Sequencer DB path like "jb2a.magic_missile" — first segment is the db root.
		const root = file.split(".")[0];
		if (!root) return null;
		try {
			const dbRoots = Sequencer?.Database?.getEntry ? this._sequencerDbRoots() : null;
			if (dbRoots && !dbRoots.has(root)) return root;
		} catch (e) { /* ignore */ }
		return null;
	},

	_sequencerDbRoots() {
		try {
			const paths = Sequencer.Database.publicFlattenedEntries ?? [];
			const roots = new Set();
			for (const p of paths) roots.add(String(p).split(".")[0]);
			return roots;
		} catch (e) {
			return null;
		}
	},

	// ── Client scale / volume ────────────────────────────────────────────────

	_getClientScale() {
		try { return game.settings.get(MODULE_ID, "animationFxClientScale") || 1.0; }
		catch (e) { return 1.0; }
	},

	_getMasterVolume() {
		try {
			if (!game.settings.get(MODULE_ID, "animationFxSoundEnabled")) return 0;
			return game.settings.get(MODULE_ID, "animationFxVolume") ?? 0.8;
		} catch (e) { return 0.8; }
	},

	async _playSound(block) {
		if (!block?.sound) return;
		const volume = this._getMasterVolume();
		if (volume <= 0) return;
		if (typeof Sequence === "undefined") return;
		try {
			const seq = new Sequence(MODULE_ID);
			seq.sound().file(block.sound).volume(volume);
			await seq.play();
		} catch (e) { /* silent */ }
	},

	// ── Cone geometry ────────────────────────────────────────────────────────

	_computeConeAngle(sourceToken, targets) {
		if (!targets || targets.length === 0) return 0;
		const sx = sourceToken.x + ((sourceToken.w ?? 0) / 2);
		const sy = sourceToken.y + ((sourceToken.h ?? 0) / 2);
		let sumX = 0, sumY = 0;
		for (const t of targets) {
			sumX += t.x + ((t.w ?? 0) / 2);
			sumY += t.y + ((t.h ?? 0) / 2);
		}
		const cx = sumX / targets.length;
		const cy = sumY / targets.length;
		return Math.atan2(cy - sy, cx - sx) * (180 / Math.PI);
	},

	// ── Source token ─────────────────────────────────────────────────────────

	_getSourceToken(actor, preferredTokenId = null) {
		if (!actor || !canvas?.tokens) return null;
		if (preferredTokenId) {
			const t = canvas.tokens.get(preferredTokenId);
			if (t) return t;
		}
		const active = actor.getActiveTokens?.(true, false) ?? [];
		if (active.length > 0) return active[0];
		return null;
	},

	// ── Playback ─────────────────────────────────────────────────────────────

	/**
	 * Resolve + play the animation for an item cast/attack.
	 * @param {object} p
	 * @param {Item}   p.item
	 * @param {Actor}  p.actor
	 * @param {Token}  [p.sourceToken]
	 * @param {Token[]}[p.targets]
	 * @param {string} [p.outcome] "hit" | "miss"
	 * @param {string} [p.tokenId]
	 */
	async playForItem({ item, actor, sourceToken = null, targets = [], outcome = "hit", tokenId = null }) {
		try {
			if (!game.settings.get(MODULE_ID, "animationFxEnabled")) return;
		} catch (e) { /* setting may not be registered yet */ }

		// Trigger-on filter (world): skip misses when set to hit-only
		try {
			const triggerOn = game.settings.get(MODULE_ID, "animationFxTriggerOn");
			if (outcome === "miss" && triggerOn === "hit") return;
		} catch (e) { /* default: always */ }

		const preset = this.resolvePreset(item);
		if (!preset) return;

		const src = sourceToken || this._getSourceToken(actor, tokenId);
		if (!src) return;

		await this._play(preset, src, targets ?? [], outcome);
	},

	async _play(preset, sourceToken, targets, outcome = "hit") {
		if (!preset) return;
		if (typeof Sequence === "undefined") return;

		const block = preset[outcome] ?? preset.hit;
		if (!block?.file) return;

		const missing = this._fileReferencesMissingModule(block.file);
		if (missing) {
			console.debug(`${MODULE_ID} | AnimationFx: skipping "${preset.label ?? "?"}" — "${missing}" not active (file: ${block.file})`);
			return;
		}
		// For Sequencer DB paths (no slash, dotted id), verify the entry actually
		// exists in the installed pack so a valid-root/invalid-path never throws.
		if (!block.file.includes("/") && block.file.includes(".")) {
			try {
				if (Sequencer?.Database?.entryExists && !Sequencer.Database.entryExists(block.file)) {
					console.debug(`${MODULE_ID} | AnimationFx: skipping "${preset.label ?? "?"}" — DB entry not found: ${block.file}`);
					return;
				}
			} catch (e) { /* fall through and let play() handle it */ }
		}

		const globalScale = this._getClientScale();
		const fadeIn = preset.fadeIn ?? 200;
		const fadeOut = preset.fadeOut ?? 200;
		const opacity = preset.opacity ?? 1.0;

		// Persistent toggle (e.g. a glowing weapon): second call ends it.
		if (preset.persist && sourceToken) {
			const effectName = `${MODULE_ID}-fx-${preset.label}-${sourceToken.id}`;
			try {
				const existing = Sequencer.EffectManager.getEffects({ name: effectName });
				if (existing.length > 0) {
					await Sequencer.EffectManager.endEffects({ name: effectName });
					return;
				}
			} catch (e) { /* ignore */ }
			try {
				const seq = new Sequence(MODULE_ID);
				seq.effect()
					.file(block.file)
					.atLocation(sourceToken)
					.scale((block.scale ?? 1) * globalScale)
					.fadeIn(fadeIn)
					.fadeOut(fadeOut)
					.opacity(opacity)
					.persist()
					.name(effectName);
				await seq.play();
				await this._playSound(block);
			} catch (e) {
				console.warn(`${MODULE_ID} | AnimationFx persistent play failed:`, e);
			}
			return;
		}

		// Non-persistent: iterate targets with a small stagger.
		const needsDistance = preset.type === "projectile" || preset.type === "cone";
		let targetList;
		if (targets && targets.length > 0) {
			targetList = needsDistance
				? targets.filter(t => t && t.id !== sourceToken.id)
				: targets;
		} else {
			targetList = needsDistance ? [] : [sourceToken];
		}
		if (targetList.length === 0) {
			if (needsDistance) {
				console.debug(`${MODULE_ID} | AnimationFx: skipping ${preset.type} for "${preset.label ?? "?"}" — no distinct target`);
			}
			return;
		}

		for (let i = 0; i < targetList.length; i++) {
			const target = targetList[i];
			const delay = i * 150;
			setTimeout(
				() => this._playOne(preset, block, sourceToken, target, targetList, globalScale, fadeIn, fadeOut, opacity),
				delay
			);
		}
		await this._playSound(block);
	},

	async _playOne(preset, block, sourceToken, target, allTargets, globalScale, fadeIn, fadeOut, opacity) {
		try {
			const seq = new Sequence(MODULE_ID);
			const effect = seq.effect().file(block.file);
			const safetyName = `${MODULE_ID}-fx-transient-${foundry.utils.randomID(8)}`;
			let hardDuration;

			if (preset.type === "projectile") {
				hardDuration = block.duration || 1500;
				// Distance-aware Y scale so beams don't bloat at short range.
				const baseScale = (block.scale ?? 1) * globalScale;
				const sx = sourceToken.x + ((sourceToken.w ?? 0) / 2);
				const sy = sourceToken.y + ((sourceToken.h ?? 0) / 2);
				const tx = target.x + ((target.w ?? 0) / 2);
				const ty = target.y + ((target.h ?? 0) / 2);
				const dist = Math.hypot(tx - sx, ty - sy);
				const gridSize = canvas?.grid?.size || 100;
				const gridsAway = Math.max(3, dist / gridSize);
				const scaleY = baseScale / Math.pow(gridsAway, 0.73);
				effect
					.atLocation(sourceToken).stretchTo(target)
					.scale({ y: scaleY })
					.fadeIn(100).fadeOut(100).opacity(opacity)
					.duration(hardDuration)
					.name(safetyName);
			} else if (preset.type === "cone") {
				hardDuration = block.duration ?? 1500;
				const angle = this._computeConeAngle(sourceToken, allTargets);
				effect
					.atLocation(sourceToken)
					.rotate(-angle)
					.scale((block.scale ?? 1) * globalScale)
					.anchor({ x: 0, y: 0.5 })
					.duration(hardDuration)
					.fadeIn(fadeIn).fadeOut(fadeOut).opacity(opacity)
					.name(safetyName);
			} else {
				// onToken
				hardDuration = block.duration ?? 800;
				const anchorToken = preset.target === "self" ? sourceToken : target;
				effect
					.atLocation(anchorToken)
					.scale((block.scale ?? 1) * globalScale)
					.fadeIn(fadeIn).fadeOut(fadeOut).duration(hardDuration).opacity(opacity)
					.name(safetyName);
				if (typeof block.offsetX === "number") effect.spriteOffset({ x: block.offsetX });
			}

			try {
				await seq.play();
				// Safety net: guarantee cleanup even for looped / endless webms.
				const cleanupAfter = hardDuration + fadeOut + 200;
				setTimeout(() => {
					try {
						const existing = Sequencer.EffectManager?.getEffects?.({ name: safetyName }) ?? [];
						if (existing.length > 0) Sequencer.EffectManager.endEffects({ name: safetyName });
					} catch (e) { /* silent */ }
				}, cleanupAfter);
			} catch (e) {
				console.warn(`${MODULE_ID} | AnimationFx play failed:`, e);
			}
		} catch (outer) {
			console.warn(`${MODULE_ID} | AnimationFx setup failed for "${preset?.label ?? "?"}" (${block?.file ?? "?"}):`, outer);
		}
	},

	// ── Persistent helpers (for weapon glows etc.) ───────────────────────────

	async clearAllFx() {
		try {
			const all = Sequencer.EffectManager.getEffects({ name: `${MODULE_ID}-fx-*` }) ?? [];
			if (all.length > 0) await Sequencer.EffectManager.endEffects({ name: `${MODULE_ID}-fx-*` });
		} catch (e) { /* silent */ }
	}
};

export default AnimationFxSD;
