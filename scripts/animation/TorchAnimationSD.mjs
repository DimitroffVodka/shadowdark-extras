/**
 * Torch Animation for Shadowdark Extras
 * Adds visual torch/flame animations when light sources are activated
 * Uses Sequencer module for animations and JB2A for animation files
 */

import { AnimationFxSD } from "./AnimationFxSD.mjs";

const MODULE_ID = "shadowdark-extras";

// Serialize overlapping sequencerEffectManagerReady restores — Hooks dispatch
// is not awaited, so rapid scene changes would interleave as
// A.end → B.end → A.play → B.play. Newer restores await the previous one
// rather than racing and cleaning up afterwards (which would delete the winner).
let _torchRestoreChain = Promise.resolve();

/**
 * Check if torch animations are enabled in settings
 */
function isEnabled() {
	try {
		return game.settings.get(MODULE_ID, "enableTorchAnimations") !== false;
	}
	catch(e) {
		return true; // Default to enabled if setting not registered yet
	}
}

/**
 * Check if required modules are active
 */
function checkDependencies() {
	const hasSequencer = game.modules.get("sequencer")?.active;
	const hasJB2A = game.modules.get("jb2a_patreon")?.active || game.modules.get("JB2A_DnD5e")?.active;

	return {
		hasSequencer,
		hasJB2A,
		ready: hasSequencer && hasJB2A,
	};
}

/**
 * Get the effect name for a torch animation (classification key only).
 * Token identity comes solely from Sequencer's `object`/`source` (see #105).
 * @param {string} itemId - The light source item ID
 * @returns {string} - Classification key (module + kind + item id)
 */
function getEffectName(itemId) {
	return `${MODULE_ID}-torch-${itemId}`;
}

/**
 * Legacy effect name for transition compatibility.
 * Existing persisted effects use `${MODULE_ID}-torch-${tokenId}-${itemId}`.
 * New code must terminate both new and legacy names, each with `object`.
 * @param {Token|{id:string}} token - The token
 * @param {string} itemId - The light source item ID
 * @returns {string}
 */
function getLegacyEffectName(token, itemId) {
	return `${MODULE_ID}-torch-${token.id}-${itemId}`;
}

/**
 * Get animation settings based on light source type
 * @param {Item} item - The light source item
 * @returns {object} - Animation configuration
 */
function getAnimationConfig(item) {
	const lightTemplate = item.system?.light?.template?.toLowerCase() || "";
	const itemName = item.name?.toLowerCase() || "";

	// Default torch animation - use local torch.webp
	let config = {
		type: "torch",
		torchFile: "modules/shadowdark-extras/assets/torch.webp",
		flameFile: "jb2a.flames.01.orange",
		impactFile: "jb2a.impact.002.orange",
		scale: 1.2,
		torchOffsetX: 0.35,
		torchOffsetY: 0.1,
		flameOffsetX: 0.5,
		flameOffsetY: -0.05,
		flameScale: 1.0,
		flameRotation: 45,
		isSpell: false,
	};

	// Customize based on light source type
	if (itemName.includes("light spell") || itemName.includes("light (")) {
		// Light Spell - magical bluish glow above token
		config.type = "spell";
		config.isSpell = true;
		config.torchFile = null; // No physical prop for spells
		config.flameFile = "jb2a.energy_strands.complete.blue.01";
		config.impactFile = "jb2a.impact.004.blue";
		config.scale = 0.8;
		config.flameScale = 0.6;
		config.flameOffsetX = 0;
		config.flameOffsetY = -0.5; // Above the token
		config.tint = "#4488ff";
	}
	else if (itemName.includes("oil") || itemName.includes("flask")) {
		// Oil Flask - use lamp.webp
		config.type = "oil";
		config.torchFile = "modules/shadowdark-extras/assets/lamp.webp";
		config.scale = 1.0;
		config.torchOffsetX = 0.35;
		config.torchOffsetY = 0.1;
		config.flameScale = 0.35;
		config.flameOffsetX = 0.34;
		config.flameOffsetY = 0.19;
		config.flameRotation = 0;
	}
	else if (lightTemplate.includes("lantern") || itemName.includes("lantern")) {
		// Lantern - use lamp.webp
		config.type = "lantern";
		config.torchFile = "modules/shadowdark-extras/assets/lamp.webp";
		config.scale = 1.0;
		config.torchOffsetX = 0.35;
		config.torchOffsetY = 0.1;
		config.flameScale = 0.35;
		config.flameOffsetX = 0.45;
		config.flameOffsetY = -0.08;
	}
	else if (lightTemplate.includes("candle") || itemName.includes("candle")) {
		// Candle - use candle.webp
		config.type = "candle";
		config.torchFile = "modules/shadowdark-extras/assets/candle.webp";
		config.flameFile = "jb2a.flames.04.loop.orange";
		config.scale = 0.8;
		config.flameScale = 0.35;
		config.torchOffsetX = 0.35;
		config.torchOffsetY = 0.15;
		config.flameOffsetX = 0.50;
		config.flameOffsetY = -0.07;
	}

	// Flame file is user-overridable via the Animation FX manager (Ambient &
	// Events). Geometry/scale above stays per-type; only the animation swaps.
	// Falls back to the hardcoded default when no override is set.
	try {
		const ambient = AnimationFxSD.getAmbient?.() ?? {};
		if (config.type === "spell") config.flameFile = ambient.lightSpellGlow?.file || config.flameFile;
		else if (config.type === "candle") config.flameFile = ambient.candleFlame?.file || config.flameFile;
		else config.flameFile = ambient.torchFlame?.file || config.flameFile; // torch / lantern / oil
	}
	catch(e) { /* keep hardcoded default */ }

	return config;
}

/**
 * Play torch animation on a token
 * @param {Token} token - The token to animate
 * @param {Item} item - The light source item
 */
async function playTorchAnimation(token, item) {
	if (!isEnabled()) return;

	const deps = checkDependencies();
	if (!deps.ready) {
		if (!deps.hasSequencer) {
			console.warn(`${MODULE_ID} | Sequencer module is required for torch animations`);
		}
		if (!deps.hasJB2A) {
			console.warn(`${MODULE_ID} | JB2A module is required for torch animations`);
		}
		return;
	}

	const effectName = getEffectName(item.id);
	const legacyName = getLegacyEffectName(token, item.id);
	const config = getAnimationConfig(item);
	const hasPatreon = game.modules.get("jb2a_patreon")?.active;

	// End any existing animation for this light source (both base and _impact).
	// Token-scoped — must carry `object` (source identity) after #105.
	// Must terminate both new and legacy names (see stopTorchAnimation); anchored
	// globs do not match the other scheme, and world 0100 holds 22 legacy torch
	// records.
	await Sequencer.EffectManager.endEffects({ name: effectName, object: token });
	await Sequencer.EffectManager.endEffects({ name: legacyName, object: token });
	await Sequencer.EffectManager.endEffects({ name: `${effectName}_impact`, object: token });
	await Sequencer.EffectManager.endEffects({ name: `${legacyName}_impact`, object: token });

	// Get token dimensions
	const tokenWidth = token.document.width;
	const tokenScale = {
		x: token.document.texture?.scaleX ?? 1,
		y: token.document.texture?.scaleY ?? 1,
	};

	console.log(`${MODULE_ID} | Playing torch animation for ${token.name}'s ${item.name}`, config);

	// Build the animation sequence
	const seq = new Sequence();

	// Handle spell light differently - magical glow above token
	if (config.isSpell) {
		// Initial magical burst
		if (hasPatreon && config.impactFile) {
			seq.effect()
				.name(`${effectName}_impact`)
				.file(config.impactFile)
				.atLocation(token)
				.attachTo(token, { bindRotation: false, bindVisibility: true })
				.scaleToObject(1.2, { considerTokenScale: true })
				.spriteOffset({
					x: 0,
					y: -0.4 * tokenWidth,
				}, { gridUnits: true })
				.aboveLighting(false)
				.zIndex(1);
		}

		// Magical orb/glow effect above the token
		seq.effect()
			.name(effectName)
			.file("jb2a.markers.light.complete.blue")
			.atLocation(token)
			.attachTo(token, { bindRotation: false, bindVisibility: true })
			.scaleToObject(0.5, { considerTokenScale: true })
			.scaleIn(0, 500, { ease: "easeOutElastic" })
			.scaleOut(0, 250, { ease: "easeOutCubic" })
			.spriteOffset({
				x: 0,
				y: -0.5 * tokenWidth,
			}, { gridUnits: true })
			.loopProperty("sprite", "scale.y", { from: 0.95, to: 1.05, duration: 2000, ease: "easeInOutSine", pingPong: true })
			.persist()
			.aboveLighting(false)
			.zIndex(2);

		// Add subtle particle effect around the light
		seq.effect()
			.delay(300)
			.name(effectName)
			.file("jb2a.particles.outward.greenyellow.01.02")
			.atLocation(token)
			.attachTo(token, { bindRotation: false, bindVisibility: true })
			.scaleToObject(0.4, { considerTokenScale: true })
			.spriteOffset({
				x: 0,
				y: -0.5 * tokenWidth,
			}, { gridUnits: true })
			.persist()
			.opacity(0.7)
			.aboveLighting(false)
			.zIndex(3);

		await seq.play();
		return;
	}

	// Initial impact/ignition effect for physical light sources (only for patreon)
	if (hasPatreon && config.impactFile) {
		seq.effect()
			.name(`${effectName}_impact`)
			.file(config.impactFile)
			.atLocation(token)
			.attachTo(token, { bindRotation: true, local: true, bindVisibility: true })
			.scaleToObject(0.9, { considerTokenScale: true })
			.spriteOffset({
				x: config.flameOffsetX * tokenWidth,
				y: config.flameOffsetY * tokenWidth,
			}, { gridUnits: true })
			.spriteRotation(45)
			.spriteScale({ x: 1.0 / tokenScale.x, y: 1.0 / tokenScale.y })
			.aboveLighting(false)
			.zIndex(1);
	}

	// Main torch/lantern/candle image effect - persistent
	if (config.torchFile) {
		seq.effect()
			.name(effectName)
			.file(config.torchFile)
			.atLocation(token)
			.attachTo(token, { bindRotation: true, local: true, bindVisibility: true })
			.scaleToObject(config.scale, { considerTokenScale: true })
			.scaleIn(0, 500, { ease: "easeOutElastic" })
			.scaleOut(0, 250, { ease: "easeOutCubic" })
			.spriteOffset({
				x: config.torchOffsetX * tokenWidth,
				y: config.torchOffsetY * tokenWidth,
			}, { gridUnits: true })
			.spriteScale({ x: 1.0 / tokenScale.x, y: 1.0 / tokenScale.y })
			// Gentle swaying animation
			.animateProperty("sprite", "rotation", { from: 60, to: -60, duration: 300, ease: "easeInOutBack" })
			.animateProperty("sprite", "rotation", { from: 0, to: 30, duration: 250, delay: 200, ease: "easeOutBack" })
			.loopProperty("sprite", "rotation", { from: 2, to: -2, duration: 1500, ease: "easeOutQuad", pingPong: true })
			.persist()
			.aboveLighting(false)
			.zIndex(2);
	}

	// Flame effect on the torch - persistent
	seq.effect()
		.delay(250)
		.name(effectName)
		.file(config.flameFile)
		.atLocation(token)
		.attachTo(token, { bindRotation: true, local: true, bindVisibility: false })
		.scaleToObject(config.flameScale, { considerTokenScale: true })
		.spriteOffset({
			x: config.flameOffsetX * tokenWidth,
			y: config.flameOffsetY * tokenWidth,
		}, { gridUnits: true })
		.spriteScale({ x: 1.0 / tokenScale.x, y: 1.0 / tokenScale.y })
		.loopProperty("sprite", "rotation", { from: config.flameRotation + 2, to: config.flameRotation - 2, duration: 1500, ease: "easeOutQuad", pingPong: true })
		.persist()
		.aboveLighting(false)
		.zIndex(3);

	await seq.play();
}

/**
 * Stop torch animation on a token
 * @param {Token} token - The token
 * @param {string} itemId - The light source item ID (optional, stops all if not provided)
 */
async function stopTorchAnimation(token, itemId = null) {
	const deps = checkDependencies();
	if (!deps.hasSequencer) return;

	if (itemId) {
		const effectName = getEffectName(itemId);
		const legacyName = getLegacyEffectName(token, itemId);
		// Transition compatibility: terminate both new and legacy names, each with object.
		await Sequencer.EffectManager.endEffects({ name: effectName, object: token });
		await Sequencer.EffectManager.endEffects({ name: legacyName, object: token });
		// Also cover _impact variant for both schemes (transient but safe).
		await Sequencer.EffectManager.endEffects({ name: `${effectName}_impact`, object: token });
		await Sequencer.EffectManager.endEffects({ name: `${legacyName}_impact`, object: token });
		console.log(`${MODULE_ID} | Stopped torch animation: ${effectName} (and legacy ${legacyName})`);
	}
	else {
		// Stop all torch animations for this token — kind wildcard plus object covers both schemes.
		await Sequencer.EffectManager.endEffects({ name: `${MODULE_ID}-torch-*`, object: token });
		console.log(`${MODULE_ID} | Stopped all torch animations for ${token.name}`);
	}
}

/**
 * Stop all torch animations on a token (for when turning all lights off)
 * @param {Token} token - The token
 */
async function stopAllTorchAnimations(token) {
	const deps = checkDependencies();
	if (!deps.hasSequencer) return;

	await Sequencer.EffectManager.endEffects({ name: `${MODULE_ID}-torch-*`, object: token });
	console.log(`${MODULE_ID} | Stopped all torch animations for ${token.name}`);
}

/**
 * Parse the token id out of a LEGACY torch effect name.
 * Legacy names are `${MODULE_ID}-torch-${tokenId}-${itemId}` and may carry an
 * `_impact` suffix. New names are `${MODULE_ID}-torch-${itemId}` (no token).
 * Kept for transition compatibility and orphan-sweep fallback; for new-format
 * (itemId only) returns the itemId — hasHyphen guard at call-site (455-463)
 * spares single-segment names, null only for non-torch.
 *
 * Assumes Foundry `randomID` output (alphanumeric, no hyphens) for token and
 * item ids. Custom or imported document ids are only required by
 * `DocumentIdField` to be a non-null string and could contain hyphens, in
 * which case this split on the first hyphen would truncate the true tokenId.
 * That case is not handled — the sweep would mis-group such effects — because
 * the anchored glob sweep still requires a literal tokenId prefix and there is
 * no reliable delimiter without knowing both ids a priori.
 * @param {string} rawName
 * @returns {string|null}
 */
function parseTorchTokenId(rawName) {
	if (!rawName || typeof rawName !== "string") return null;
	const prefix = `${MODULE_ID}-torch-`;
	if (!rawName.startsWith(prefix)) return null;
	let remainder = rawName.slice(prefix.length);
	if (remainder.endsWith("_impact")) remainder = remainder.slice(0, -"_impact".length);
	// New-format names have no token segment (just itemId) — single token,
	// no hyphen. Legacy has tokenId-itemId (two hyphen segments). Without
	// knowing both ids we cannot reliably distinguish; we return the first
	// hyphen segment, which for new-format is the whole itemId. Caller must
	// decide whether to treat single-segment names as non-orphan.
	// For backwards compat we keep old behaviour: first hyphen segment.
	const tokenId = remainder.split("-")[0];
	return tokenId || null;
}

/**
 * Whether the current client is the elected restorer for canvasReady.
 * GM-authoritative — only the activeGM may restore, not "first active".
 * @returns {boolean}
 */
export function isTorchCanvasRestoreAllowed() {
	const activeGM = globalThis.game?.users?.activeGM;
	return !!activeGM && globalThis.game?.user?.id === activeGM?.id;
}

/**
 * End any `shadowdark-extras-torch-*` effects whose token is no longer on the
 * scene. Runs unconditionally (idempotent) to drain orphans from #102.
 * Safe to call multiple times — sequencerEffectManagerReady may fire more than
 * once on scene switches.
 *
 * After #105 names are classification-only (`${MODULE_ID}-torch-${itemId}`) and
 * token identity is carried by `object`/`source`. Orphan detection therefore
 * uses `effect.data.source` (UUID) rather than parsing tokenId from the name.
 * Legacy names still carry a tokenId prefix; for those the fallback parse is
 * retained, but the termination after detection uses `effects` ids so it does
 * not require validating a missing source string (dist:11720-11729 would throw
 * for a deleted token's UUID string). This matches Sequencer's own
 * `initializePersistentEffects`→`effectsToRemove`→`flagManager.removeFlags`
 * purge (dist:11919-11951) which is flag-level, not name-level.
 */
async function sweepOrphanTorchEffects() {
	const deps = checkDependencies();
	if (!deps.hasSequencer) return;
	const placeables = globalThis.canvas?.tokens?.placeables;
	if (!placeables) return;
	const viewedSceneId = globalThis.canvas?.scene?.id ?? globalThis.game?.user?.viewedScene ?? null;
	// Present token identities: both UUID set (primary, matches effect.data.source)
	// and id set (fallback for legacy name-parsed orphans where source missing).
	const presentUuids = new Set(placeables.map(t => t.document?.uuid ?? (viewedSceneId && t.id ? `Scene.${viewedSceneId}.Token.${t.id}` : null) ?? t.document?.id).filter(Boolean));
	const presentIds = new Set(placeables.map(t => t.id ?? t.document?.id).filter(Boolean));
	let effects = [];
	try {
		const maybe = Sequencer.EffectManager.getEffects({ name: `${MODULE_ID}-torch-*` });
		if (Array.isArray(maybe)) effects = maybe;
		else if (maybe) effects = Array.from(maybe);
	}
	catch(e) {
		try {
			const all = Sequencer.EffectManager.getEffects?.() ?? [];
			const list = Array.isArray(all) ? all : Array.from(all);
			effects = list.filter(entry => {
				const n = entry.data?.name ?? entry.name ?? "";
				return typeof n === "string" && n.startsWith(`${MODULE_ID}-torch-`);
			});
		}
		catch(inner) {
			console.warn(`${MODULE_ID} | sweepOrphanTorchEffects: getEffects failed twice`, inner);
			return;
		}
	}
	if (!effects.length) return;
	// Scene-safe: Sequencer.getEffects({name}) returns ALL scenes' effects —
	// _filterEffects never checks sceneId (dist:11694-11703) and shouldPlay
	// keeps creator's off-scene effects in the manager (dist:15145). Only
	// effects whose scene matches the viewed scene are candidates; others
	// are valid off-scene persistence and must be spared.
	let relevantEffects = effects;
	if (viewedSceneId) {
		relevantEffects = effects.filter(eff => {
			const effSceneId = eff.data?.sceneId ?? eff.sceneId ?? null;
			if (!effSceneId) return true;
			return effSceneId === viewedSceneId;
		});
		if (!relevantEffects.length) return;
	}
	const orphanEffectIds = [];
	for (const eff of relevantEffects) {
		const source = eff.data?.source ?? eff.source ?? null;
		const isUuid = typeof source === "string" && source.includes(".") && source.startsWith("Scene");
		if (isUuid) {
			if (!presentUuids.has(source)) {
				const eid = eff.data?._id ?? eff.id ?? eff.data?.id;
				if (eid) orphanEffectIds.push(eid);
				else {
					// Fallback: collect by name parse if id missing (should not happen)
					const rawName = eff.data?.name ?? eff.name ?? "";
					const tokenId = parseTorchTokenId(rawName);
					if (tokenId && !presentIds.has(tokenId)) {
						const fallbackId = eff.id ?? eff.data?.id;
						if (fallbackId) orphanEffectIds.push(fallbackId);
					}
				}
			}
		}
		else {
			// Legacy or missing source — fallback to name parsing
			const rawName = eff.data?.name ?? eff.name ?? "";
			const tokenId = parseTorchTokenId(rawName);
			if (!tokenId) continue;
			// Heuristic: new-format names have no hyphen after prefix (single itemId).
			// Those will parse as itemId, not tokenId; they should not be considered orphan via name.
			// We check if remainder contains a hyphen (tokenId-itemId two parts). If not, skip.
			const prefix = `${MODULE_ID}-torch-`;
			if (!rawName.startsWith(prefix)) continue;
			let remainder = rawName.slice(prefix.length);
			if (remainder.endsWith("_impact")) remainder = remainder.slice(0, -"_impact".length);
			const hasHyphen = remainder.includes("-");
			// For new-format (no hyphen) we cannot decide orphan via name; require source.
			if (!hasHyphen) continue;
			if (!presentIds.has(tokenId)) {
				const eid = eff.data?._id ?? eff.id ?? eff.data?.id;
				if (eid) orphanEffectIds.push(eid);
			}
		}
	}
	if (!orphanEffectIds.length) return;
	// Use `effects` filter (id-based) so we do not need to validate a missing source string
	// (dist:11720-11729 would throw for a deleted token's UUID string). `effects` is
	// validated as string ids only (dist:11779-11788) and filtered via exact id match (dist:11702).
	try {
		await Sequencer.EffectManager.endEffects({ effects: orphanEffectIds });
		console.log(`${MODULE_ID} | Swept ${orphanEffectIds.length} orphan torch effects`);
	}
	catch(e) {
		/* ignore — sweep is best-effort */
	}
}

/**
 * Get tokens for an actor on the current scene
 * @param {Actor} actor - The actor
 * @returns {Token[]} - Array of tokens
 */
function getTokensForActor(actor) {
	if (!canvas.scene) return [];

	// For synthetic/unlinked tokens
	if (actor.isToken) {
		const token = canvas.tokens.get(actor.token?.id);
		return token ? [token] : [];
	}

	// For linked tokens, find all tokens on the scene
	return canvas.tokens.placeables.filter(t =>
		t.actor?.id === actor.id && t.document.actorLink
	);
}

/**
 * Initialize torch animation hooks
 * This patches the actor's light methods to add animations
 */
export function initTorchAnimations() {
	if (!isEnabled()) {
		console.log(`${MODULE_ID} | Torch animations disabled in settings`);
		return;
	}

	const deps = checkDependencies();

	if (!deps.hasSequencer) {
		console.log(`${MODULE_ID} | Torch animations disabled - Sequencer module not found`);
		return;
	}

	if (!deps.hasJB2A) {
		console.log(`${MODULE_ID} | Torch animations disabled - JB2A module not found`);
		return;
	}

	console.log(`${MODULE_ID} | Initializing torch animations`);

	// Reset restore chain for test isolation — init is called per test in the harness
	_torchRestoreChain = Promise.resolve();

	// Hook into item updates to detect light source toggling
	Hooks.on("updateItem", async (item, changes, options, userId) => {
		// Only process light items
		if (!item.system?.light) return;

		// Check if light.active was changed
		const activeChanged = foundry.utils.hasProperty(changes, "system.light.active");
		if (!activeChanged) return;

		const isActive = changes.system.light.active;
		const actor = item.actor;
		if (!actor) return;

		// Get all tokens for this actor
		const tokens = getTokensForActor(actor);

		for (const token of tokens) {
			if (isActive) {
				// Play is origin-gated — duplicates are the bug; do not broadcast play
				if (userId !== game.user.id) continue;
				await playTorchAnimation(token, item);
			}
			else {
				// Stop is unconditional — every client ends its own copy (idempotent)
				await stopTorchAnimation(token, item.id);
			}
		}
	});

	// Hook into actor light changes (for turnLightOn/turnLightOff)
	// The actor's turnLightOn method changes the token's light settings
	Hooks.on("updateToken", async (tokenDoc, changes, options, userId) => {
		// Stop is unconditional — every client ends its own copy (idempotent)
		// (no userId gate)

		// Check if light settings were changed
		const lightChanged = foundry.utils.hasProperty(changes, "light");
		if (!lightChanged) return;

		const token = canvas.tokens.get(tokenDoc.id);
		if (!token) return;

		const actor = token.actor;
		if (!actor) return;

		// Check if light was turned off (dim and bright both 0)
		const lightDim = changes.light?.dim ?? tokenDoc.light?.dim ?? 0;
		const lightBright = changes.light?.bright ?? tokenDoc.light?.bright ?? 0;

		if (lightDim === 0 && lightBright === 0) {
			// All lights turned off
			await stopAllTorchAnimations(token);
		}
	});

	// Orphan sweep: must run AFTER Sequencer has populated its manager.
	// Sequencer populates +125-475 ms after canvasReady (dist:30881-30886 → 11919-11945)
	// and getEffects at t=0 would see an empty set. The correct signal is
	// `sequencerEffectManagerReady` (dist:11953) from initializePersistentEffects.
	// It is scene-safe: the manager can hold cross-scene creator effects
	// (shouldPlay permits creatorUserId off-scene, dist:15145; _filterEffects never
	// checks sceneId, dist:11694-11703), so the sweep must not treat "not on
	// this canvas" as orphaned — it filters to the viewed scene first.
	Hooks.on("sequencerEffectManagerReady", async () => {
		await sweepOrphanTorchEffects();
	});

	// Also hook into when an active light source is detected on scene ready
	// Torch restore must run AFTER Sequencer has populated its manager
	// (sequencerEffectManagerReady, dist:11953, +125-475ms after canvasReady)
	// so our dedup (:173-174) sees Sequencer's restored copy before playing
	// a fresh one — net one effect, not duplicate. The signal is Sequencer
	// readiness, not user sync, so the activeGM poll is still required inside.
	// Asymmetry with WeaponAnimationSD (which stays on canvasReady): weapon
	// has zero persisted records today, so no Sequencer double-restore to
	// order against; torch has persisted flames and would otherwise race
	// Sequencer (canvasReady ~0-100ms poll exit vs 125-475ms restore → net 6).
	// sequencerEffectManagerReady fires even when there is nothing to restore
	// (initializePersistentEffects does Promise.all([]) → resolves, dist:11919-11953),
	// so this handler still runs on first load / empty journal. If Sequencer
	// is absent, playTorchAnimation is a no-op via checkDependencies.
	// NOTE: This handler churns the persisted record on every load — Sequencer
	// restores the flame, we dedup it away (endEffects object-scoped), then
	// replay with .persist() which rewrites the sequencerDatabase journal.
	// Net one visible flame, no flicker (end+play in same microtask), but the
	// journal write cycles. Avoiding churn would require skipping replay when
	// the restored effect already matches current config — out of scope for #110.
	Hooks.on("sequencerEffectManagerReady", () => {
		_torchRestoreChain = _torchRestoreChain.then(async () => {
			// Bounded poll for user sync — activeGM not ready at t=0 (see #110)
			const timeoutMs = 2000;
			const intervalMs = 100;
			const start = Date.now();
			while (!globalThis.game?.users?.activeGM && Date.now() - start < timeoutMs) {
				await new Promise(resolve => setTimeout(resolve, intervalMs));
			}
			if (!globalThis.game?.users?.activeGM) {
				console.warn(`${MODULE_ID} | Torch restore skipped — activeGM not found after ${timeoutMs}ms (slow user sync or no GM); will retry on next sequencerEffectManagerReady`);
				return;
			}
			if (!isTorchCanvasRestoreAllowed()) return;

			// Check all tokens for active light sources
			for (const token of canvas.tokens.placeables) {
				const actor = token.actor;
				if (!actor) continue;

				// Get active light sources
				const activeLightSources = await actor.getActiveLightSources?.();
				if (!activeLightSources || activeLightSources.length === 0) continue;

				// Play animation for each active light source
				for (const item of activeLightSources) {
					await playTorchAnimation(token, item);
				}
			}
		}).catch(err => {
			console.warn(`${MODULE_ID} | torch restore failed`, err);
		});
		return _torchRestoreChain;
	});

	// Clean up animations when token is deleted
	Hooks.on("deleteToken", async (tokenDoc, options, userId) => {
		// Stop is unconditional — every client ends its own copy (idempotent)
		const deps = checkDependencies();
		if (!deps.hasSequencer) return;

		// Verified alternative to `source: tokenDoc.uuid` string (dist:11720-11729
		// would throw for a deleted token's UUID via get_object_from_scene →
		// fromUuidSync → missing). Passing the Document object validates via
		// get_object_identifier (dist:475-480, 11718-11720) without lookup.
		// Name wildcard keeps kind-scoped; source disambiguates token.
		// Fallback scene-load purge is Sequencer's initializePersistentEffects
		// → effectsToRemove → flagManager.removeFlags (dist:11919-11951).
		await Sequencer.EffectManager.endEffects({ name: `${MODULE_ID}-torch-*`, source: tokenDoc });
	});

	// Check for active light sources when a new token is created
	Hooks.on("createToken", async (tokenDoc, options, userId) => {
		// Only the user who created the token should add animations
		if (userId !== game.user.id) return;

		// Small delay to ensure token is fully initialized
		await new Promise(resolve => setTimeout(resolve, 200));

		const token = canvas.tokens.get(tokenDoc.id);
		if (!token) return;

		// Check if token has light settings (dim or bright > 0)
		const tokenLight = tokenDoc.light || {};
		const hasLight = (tokenLight.dim > 0) || (tokenLight.bright > 0);
		if (!hasLight) return;

		const actor = token.actor;
		if (!actor) return;

		// Find active light source items from the actor
		const activeLightSources = actor.items.filter(i =>
			i.system?.light?.active === true
		);

		if (activeLightSources.length === 0) return;

		// Play animation for each active light source
		for (const item of activeLightSources) {
			await playTorchAnimation(token, item);
		}
	});

	console.log(`${MODULE_ID} | Torch animations initialized successfully`);
}

// Export functions for external use
export {
	playTorchAnimation,
	stopTorchAnimation,
	stopAllTorchAnimations,
	checkDependencies,
	getEffectName,
	getLegacyEffectName,
	parseTorchTokenId,
	sweepOrphanTorchEffects,
};
