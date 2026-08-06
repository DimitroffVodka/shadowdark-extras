// v13+ FilePicker namespaced under foundry.applications.apps.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

/**
 * Weapon Animation for Shadowdark Extras
 * Displays weapon images on tokens when weapons are equipped
 * Uses Sequencer module for animations
 */

import { AnimationFxSD } from "./AnimationFxSD.mjs";
import { isItemPilesActor } from "../inventory/ItemPilesCompatSD.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Check if weapon animations are enabled in settings
 */
function isEnabled() {
	try {
		return game.settings.get(MODULE_ID, "enableWeaponAnimations") !== false;
	}
	catch (e) {
		return true; // Default to enabled if setting not registered yet
	}
}

/**
 * Resolve the weapon animation config per documented 3-step order:
 *   1. configOverride — live preview from the config dialog
 *   2. per-item flag   — what the Weapon Animation dialog saved
 *   3. master list     — pattern-matched default from the Animation FX list
 * An explicit `enabled: false` on the per-item flag (or configOverride) is
 * terminal — it short-circuits the master list. No flag (undefined) still
 * falls through to the master list. Shared predicate for all three entry
 * points so they agree on what animates.
 * @param {Item} item
 * @param {object|null} configOverride
 * @returns {object|null}
 */
export function getResolvedWeaponAnimation(item, configOverride = null) {
	let animConfig = configOverride ?? item.getFlag(MODULE_ID, "weaponAnimation");
	if (animConfig?.enabled === false) return null; // explicit disable is terminal
	if (!animConfig?.enabled || !animConfig?.imagePath) {
		animConfig = AnimationFxSD.resolveWeaponSprite(item);
	}
	if (!animConfig?.enabled || !animConfig?.imagePath) return null;
	return animConfig;
}

/**
 * Whether this item resolves to any weapon animation (per-item or master list).
 * Single shared predicate used by updateItem / canvasReady / createToken.
 * @param {Item} item
 * @returns {boolean}
 */
export function hasWeaponAnimation(item) {
	return !!getResolvedWeaponAnimation(item);
}

/**
 * Check if required modules are active
 */
function checkDependencies() {
	const hasSequencer = game.modules.get("sequencer")?.active;

	return {
		hasSequencer,
		ready: hasSequencer,
	};
}

/**
 * Get the effect name for a weapon animation (classification key only).
 * Token identity comes solely from Sequencer's `object`/`source` (see #105).
 * @param {string} itemId - The weapon item ID
 * @returns {string} - Classification key (module + kind + item id)
 */
export function getEffectName(itemId) {
	return `${MODULE_ID}-weapon-${itemId}`;
}

/**
 * Legacy effect name for transition compatibility.
 * Existing persisted effects use `${MODULE_ID}-weapon-${tokenId}-${itemId}`.
 * New code must terminate both new and legacy names, each with `object`.
 * @param {Token|{id:string}} token
 * @param {string} itemId
 * @returns {string}
 */
export function getLegacyEffectName(token, itemId) {
	return `${MODULE_ID}-weapon-${token.id}-${itemId}`;
}

/**
 * Recursively scan the Weapons folder for all image files
 * @returns {Promise<Array>} Array of {path, name, category} objects
 */
export async function scanItemImages() {
	const basePaths = [
		{ path: `modules/${MODULE_ID}/assets/Weapons`, category: "Weapons" },
		{ path: "fa-nexus-assets/!Core_Settlements/Combat/Weapons", category: "Weapons" },
		{ path: "fa-nexus-assets/!Core_Settlements/Combat/Weapons/Shields", category: "Shields" },
	];
	const imageMap = new Map(); // Use Map to de-duplicate by filename

	for (const config of basePaths) {
		const basePath = config.path;
		const defaultCategory = config.category;

		try {
			// Check if directory exists first
			const browseResult = await FilePicker.browse("data", basePath).catch(err => {
				console.log(`${MODULE_ID} | Path ${basePath} not found or not accessible.`);
				return null;
			});

			if (!browseResult) continue;

			const images = [];

			// Process subdirectories recursively
			for (const dir of browseResult.dirs) {
				await scanDirectory(dir, images, basePath);
			}

			// Process any images in the root folder
			for (const file of browseResult.files) {
				if (file.endsWith(".webp") || file.endsWith(".png") || file.endsWith(".jpg")) {
					images.push({
						path: file,
						name: getImageName(file),
						category: defaultCategory,
					});
				}
			}

			// Add to map, avoiding duplicates by name
			for (const img of images) {
				if (!imageMap.has(img.name)) {
					imageMap.set(img.name, img);
				}
			}

		}
		catch (error) {
			console.warn(`${MODULE_ID} | Error scanning ${basePath}:`, error);
		}
	}

	return Array.from(imageMap.values());
}

/**
 * Recursively scan a directory for images
 * @param {string} dirPath - Directory path to scan
 * @param {Array} images - Array to collect images into
 * @param {string} basePath - The base path for category calculation
 */
async function scanDirectory(dirPath, images, basePath) {
	try {
		const result = await FilePicker.browse("data", dirPath);
		const category = getCategory(dirPath, basePath);

		// Process subdirectories
		for (const subDir of result.dirs) {
			await scanDirectory(subDir, images, basePath);
		}

		// Process image files
		for (const file of result.files) {
			if (file.endsWith(".webp") || file.endsWith(".png") || file.endsWith(".jpg")) {
				images.push({
					path: file,
					name: getImageName(file),
					category: category,
				});
			}
		}
	}
	catch (error) {
		console.warn(`${MODULE_ID} | Error scanning directory ${dirPath}:`, error);
	}
}

/**
 * Extract category from path (e.g., "Swords/Longswords" from full path)
 * @param {string} dirPath - The current directory path
 * @param {string} basePath - The base path to calculate relative category from
 */
function getCategory(dirPath, basePath) {
	const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
	if (dirPath.startsWith(prefix)) {
		return dirPath.substring(prefix.length);
	}
	// Fallback to last folder name if it's the root path or something else
	if (dirPath === basePath) return "Weapons";
	return dirPath.split("/").pop();
}

/**
 * Extract image name from path (without extension)
 */
function getImageName(filePath) {
	const fileName = filePath.split("/").pop();
	return fileName.replace(/\.(webp|png|jpg)$/i, "");
}

/**
 * Play weapon animation on a token
 * @param {Token} token - The token to animate
 * @param {Item} item - The weapon item
 * @param {Object|null} configOverride - Optional config object for live preview (skips DB read)
 */
export async function playWeaponAnimation(token, item, configOverride = null) {
	if (!isEnabled()) return;

	const deps = checkDependencies();
	if (!deps.ready) {
		if (!deps.hasSequencer) {
			console.warn(`${MODULE_ID} | Sequencer module is required for weapon animations`);
		}
		return;
	}

	// Item Piles actors are inventories, not creatures wielding their contents.
	// A configured weapon may keep its animation flag while stored, but it must
	// never render as an attached/equipped sprite on the pile token.
	if (isItemPilesActor(item?.parent ?? token?.actor)) {
		await stopWeaponAnimation(token, item.id);
		return;
	}

	// Unsaved form previews are allowed for unequipped character weapons.
	// Saved/restored effects, however, only belong on actually equipped items.
	if (!configOverride && item?.system?.equipped !== true) {
		await stopWeaponAnimation(token, item.id);
		return;
	}

	const animConfig = getResolvedWeaponAnimation(item, configOverride);
	if (!animConfig) return; // No animation configured and no master-list match

	const effectName = getEffectName(item.id);

	// End any existing animation for this weapon — token-scoped via object (see #105)
	await Sequencer.EffectManager.endEffects({ name: effectName, object: token });

	// Get token dimensions
	const tokenWidth = token.document.width;
	const tokenScale = {
		x: token.document.texture?.scaleX ?? 1,
		y: token.document.texture?.scaleY ?? 1,
	};

	console.log(`${MODULE_ID} | Playing weapon animation for ${token.name}'s ${item.name}`, animConfig);

	// Build the animation sequence
	const seq = new Sequence();

	// Weapon image effect - persistent
	const effect = seq.effect()
		.name(effectName)
		.file(animConfig.imagePath)
		.atLocation(token)
		.attachTo(token, { bindRotation: true, local: true, bindVisibility: true })
		.scaleToObject(animConfig.scale ?? 1.0, { considerTokenScale: true })
		.scaleIn(0, 300, { ease: "easeOutBack" })
		.scaleOut(0, 200, { ease: "easeOutCubic" })
		.spriteOffset({
			x: (animConfig.offsetX ?? 0.35) * tokenWidth,
			y: (animConfig.offsetY ?? 0.1) * tokenWidth,
		}, { gridUnits: true })
		.spriteRotation(animConfig.rotation ?? 0)
		.spriteScale({
			x: (1.0 / tokenScale.x) * (animConfig.flipX ? -1 : 1),
			y: (1.0 / tokenScale.y) * (animConfig.flipY ? -1 : 1),
		});

	console.log(`${MODULE_ID} | Playing weapon animation:`, animConfig);

	// Apply ColorMatrix filter if configured
	if (animConfig.filters?.colorMatrix) {
		const cm = animConfig.filters.colorMatrix;
		effect.filter("ColorMatrix", {
			hue: cm.hue ?? 0,
			brightness: cm.brightness ?? 1,
			contrast: cm.contrast ?? 1,
			saturate: cm.saturate ?? 0,
		});
	}

	// Apply Glow filter if enabled
	if (animConfig.filters?.glow?.enabled) {
		const glow = animConfig.filters.glow;
		const color = glow.color || "#ffffff";

		console.log(`${MODULE_ID} | Applying Glow filter:`, {
			color: color,
			distance: glow.distance,
			outerStrength: glow.outerStrength,
			innerStrength: glow.innerStrength,
			quality: glow.quality,
			knockout: glow.knockout,
		});

		effect.filter("Glow", {
			distance: glow.distance ?? 10,
			outerStrength: glow.outerStrength ?? 4,
			innerStrength: glow.innerStrength ?? 0,
			color: color,
			quality: glow.quality ?? 0.1,
			knockout: glow.knockout ?? false,
		});
	}

	effect.persist()
		.zIndex(5);

	// Apply selected animation type
	const animType = animConfig.animationType ?? (animConfig.wobble !== false ? "wobble" : "none");

	switch (animType) {
		case "wobble":
			effect
				.loopProperty("sprite", "angle", {
					from: -3,
					to: 3,
					duration: 1200,
					ease: "easeInOutSine",
					pingPong: true,
				});
			break;

		case "bobbing":
			effect.loopProperty("sprite", "position.y", {
				from: 0,
				to: -0.05 * tokenWidth,
				duration: 1000,
				ease: "easeInOutSine",
				pingPong: true,
				gridUnits: true,
			});
			break;

		case "floating":
			effect.loopProperty("sprite", "position.x", {
				from: -0.05 * tokenWidth,
				to: 0.05 * tokenWidth,
				duration: 1500,
				ease: "easeInOutSine",
				pingPong: true,
				gridUnits: true,
			});
			break;

		case "rotating":
			effect.loopProperty("sprite", "angle", {
				from: 0,
				to: 360,
				duration: 3000,
				ease: "linear",
			});
			break;
	}

	await seq.play();

	// Apply additional PIXI filters that Sequencer doesn't support natively
	if (animConfig.filters?.dropShadow?.enabled) {
		// Wait briefly for the effect to be fully initialized
		await new Promise(resolve => setTimeout(resolve, 100));

		const effectName = getEffectName(item.id);
		// Token-scoped lookup must carry source identity — after #105 names collide
		// across tokens sharing an item, so a name-only filter would match siblings.
		// Filter by both name and source (token document UUID).
		const tokenUuid = token.document?.uuid ?? `Scene.${game.user?.viewedScene ?? canvas?.scene?.id ?? ""}.Token.${token.id}`;
		const effects = Sequencer.EffectManager.effects.filter(e => e.data?.name === effectName && e.data?.source === tokenUuid);

		for (const seqEffect of effects) {
			try {
				// Access the sprite container
				const sprite = seqEffect.sprite || seqEffect.spriteContainer;
				if (!sprite) {
					console.warn(`${MODULE_ID} | Could not find sprite for effect ${effectName}`);
					continue;
				}

				const ds = animConfig.filters.dropShadow;

				// Check if DropShadowFilter is available (from TokenMagic or PIXI)
				const DropShadowFilter = PIXI.filters?.DropShadowFilter;
				if (!DropShadowFilter) {
					console.warn(`${MODULE_ID} | DropShadowFilter not available - TokenMagic FX may not be installed`);
					continue;
				}

				// Convert hex color string to number
				let colorValue = 0x000000;
				if (ds.color) {
					const colorStr = ds.color.replace("#", "");
					colorValue = parseInt(colorStr, 16);
				}

				const dropShadow = new DropShadowFilter({
					color: colorValue,
					alpha: ds.alpha ?? 0.5,
					blur: ds.blur ?? 2,
					distance: ds.distance ?? 5,
					rotation: ds.rotation ?? 45,
				});

				sprite.filters = [...(sprite.filters || []), dropShadow];
				console.log(`${MODULE_ID} | Applied DropShadow filter to ${effectName}:`, ds);
			}
			catch (e) {
				console.error(`${MODULE_ID} | Error applying DropShadow filter:`, e);
			}
		}
	}
}

/**
 * Stop weapon animation on a token
 * @param {Token} token - The token
 * @param {string} itemId - The weapon item ID
 */
export async function stopWeaponAnimation(token, itemId) {
	const deps = checkDependencies();
	if (!deps.hasSequencer) return;

	const effectName = getEffectName(itemId);
	const legacyName = getLegacyEffectName(token, itemId);
	// Transition compatibility: terminate both new and legacy names, each with object
	await Sequencer.EffectManager.endEffects({ name: effectName, object: token });
	await Sequencer.EffectManager.endEffects({ name: legacyName, object: token });
	console.log(`${MODULE_ID} | Stopped weapon animation: ${effectName} (and legacy ${legacyName})`);
}

/**
 * Stop all weapon animations on a token
 * @param {Token} token - The token
 */
export async function stopAllWeaponAnimations(token) {
	const deps = checkDependencies();
	if (!deps.hasSequencer) return;

	await Sequencer.EffectManager.endEffects({ name: `${MODULE_ID}-weapon-*`, object: token });
	console.log(`${MODULE_ID} | Stopped all weapon animations for ${token.name}`);
}

/**
 * Parse the token id out of a LEGACY weapon effect name.
 * Legacy names are `${MODULE_ID}-weapon-${tokenId}-${itemId}`. New names are
 * `${MODULE_ID}-weapon-${itemId}` (no token); for new-format returns the
 * itemId — hasHyphen guard at call-site spares it. Kept for transition
 * compatibility and orphan-sweep fallback.
 * @param {string} rawName
 * @returns {string|null}
 */
export function parseWeaponTokenId(rawName) {
	if (!rawName || typeof rawName !== "string") return null;
	const prefix = `${MODULE_ID}-weapon-`;
	if (!rawName.startsWith(prefix)) return null;
	const remainder = rawName.slice(prefix.length);
	const tokenId = remainder.split("-")[0];
	return tokenId || null;
}

/**
 * End any `shadowdark-extras-weapon-*` effects whose token is no longer on the
 * scene. Runs unconditionally (idempotent) to mirror the torch orphan sweep.
 * Safe to call multiple times — sequencerEffectManagerReady may fire more than
 * once on scene switches.
 *
 * After #105 names are classification-only and token identity is via `source`.
 * Orphan detection uses `effect.data.source` (UUID) rather than parsing tokenId.
 * Termination uses `effects` ids to avoid validating a missing source string
 * (dist:11720-11729) — see torch sweep for full rationale and dist refs.
 */
export async function sweepOrphanWeaponEffects() {
	const deps = checkDependencies();
	if (!deps.hasSequencer) return;
	const placeables = globalThis.canvas?.tokens?.placeables;
	if (!placeables) return;
	const viewedSceneId = globalThis.canvas?.scene?.id ?? globalThis.game?.user?.viewedScene ?? null;
	const presentUuids = new Set(placeables.map(t => t.document?.uuid ?? (viewedSceneId && t.id ? `Scene.${viewedSceneId}.Token.${t.id}` : null) ?? t.document?.id).filter(Boolean));
	const presentIds = new Set(placeables.map(t => t.id ?? t.document?.id).filter(Boolean));
	let effects = [];
	try {
		const maybe = Sequencer.EffectManager.getEffects({ name: `${MODULE_ID}-weapon-*` });
		if (Array.isArray(maybe)) effects = maybe;
		else if (maybe) effects = Array.from(maybe);
	}
	catch (e) {
		try {
			const all = Sequencer.EffectManager.getEffects?.() ?? [];
			const list = Array.isArray(all) ? all : Array.from(all);
			effects = list.filter(entry => {
				const n = entry.data?.name ?? entry.name ?? "";
				return typeof n === "string" && n.startsWith(`${MODULE_ID}-weapon-`);
			});
		}
		catch (inner) {
			console.warn(`${MODULE_ID} | sweepOrphanWeaponEffects: getEffects failed twice`, inner);
			return;
		}
	}
	if (!effects.length) return;
	// Scene-safe: Sequencer.getEffects({name}) returns ALL scenes' effects —
	// _filterEffects never checks sceneId (dist:11694-11703) and shouldPlay
	// keeps creator's off-scene effects (dist:15145). Only sweep effects for
	// the viewed scene; off-scene persistence must be spared.
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
			}
		}
		else {
			const rawName = eff.data?.name ?? eff.name ?? "";
			const tokenId = parseWeaponTokenId(rawName);
			if (!tokenId) continue;
			const prefix = `${MODULE_ID}-weapon-`;
			if (!rawName.startsWith(prefix)) continue;
			let remainder = rawName.slice(prefix.length);
			const hasHyphen = remainder.includes("-");
			if (!hasHyphen) continue;
			if (!presentIds.has(tokenId)) {
				const eid = eff.data?._id ?? eff.id ?? eff.data?.id;
				if (eid) orphanEffectIds.push(eid);
			}
		}
	}
	if (!orphanEffectIds.length) return;
	try {
		await Sequencer.EffectManager.endEffects({ effects: orphanEffectIds });
		console.log(`${MODULE_ID} | Swept ${orphanEffectIds.length} orphan weapon effects`);
	}
	catch (e) {
		/* ignore */
	}
}

/**
 * Whether the current client is the elected restorer for canvasReady.
 * GM-authoritative — only the activeGM may restore, not "first active".
 * @returns {boolean}
 */
export function isWeaponCanvasRestoreAllowed() {
	const activeGM = globalThis.game?.users?.activeGM;
	return !!activeGM && globalThis.game?.user?.id === activeGM?.id;
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
 * Initialize weapon animation hooks
 */
export function initWeaponAnimations() {
	if (!isEnabled()) {
		console.log(`${MODULE_ID} | Weapon animations disabled in settings`);
		return;
	}

	const deps = checkDependencies();

	if (!deps.hasSequencer) {
		console.log(`${MODULE_ID} | Weapon animations disabled - Sequencer module not found`);
		return;
	}

	console.log(`${MODULE_ID} | Initializing weapon animations`);

	// Hook into item updates to detect equip changes
	Hooks.on("updateItem", async (item, changes, options, userId) => {
		// Only process weapon and armor (shields) items
		if (item.type !== "Weapon" && item.type !== "Armor") return;

		// Check if equipped status was changed
		const equippedChanged = foundry.utils.hasProperty(changes, "system.equipped");
		if (!equippedChanged) return;

		const isEquipped = changes.system.equipped;
		const actor = item.actor;
		if (!actor) return;
		if (isItemPilesActor(actor)) {
			for (const token of getTokensForActor(actor)) {
				await stopWeaponAnimation(token, item.id);
			}
			return;
		}

		// Stop is unconditional on unequip — every client ends its own copy
		// (must survive regardless of config; see #102). Play is origin-gated.
		if (!isEquipped) {
			for (const token of getTokensForActor(actor)) {
				await stopWeaponAnimation(token, item.id);
			}
			return;
		}

		// Equipped: only play if item resolves via per-item flag OR master list
		if (!hasWeaponAnimation(item)) return;
		if (userId !== game.user.id) return;

		for (const token of getTokensForActor(actor)) {
			await playWeaponAnimation(token, item);
		}
	});

	// Orphan sweep: must run AFTER Sequencer has populated its manager.
	// Sequencer populates +125-475 ms after canvasReady (dist:30881-30886 → 11919-11945)
	// and getEffects at t=0 would see an empty set. The correct signal is
	// `sequencerEffectManagerReady` (dist:11953) from initializePersistentEffects.
	// It is scene-safe (see sweep comment for 11694-11703 / 15145).
	Hooks.on("sequencerEffectManagerReady", async () => {
		await sweepOrphanWeaponEffects();
	});

	// Restore animations on scene ready
	Hooks.on("canvasReady", async () => {
		// GM-authoritative election — only the active GM restores animations
		if (!isWeaponCanvasRestoreAllowed()) return;

		// Small delay to ensure everything is loaded
		await new Promise(resolve => setTimeout(resolve, 500));

		// Check all tokens for equipped weapons/shields with animations
		for (const token of canvas.tokens.placeables) {
			const actor = token.actor;
			if (!actor) continue;
			if (isItemPilesActor(actor)) {
				await stopAllWeaponAnimations(token);
				continue;
			}

			// Get all equipped items that resolve to an animation (per-item or master list)
			const equippedItems = actor.items.filter(i =>
				(i.type === "Weapon" || i.type === "Armor") &&
                i.system?.equipped === true &&
                hasWeaponAnimation(i)
			);

			// Play animation for each equipped item
			for (const item of equippedItems) {
				await playWeaponAnimation(token, item);
			}
		}
	});

	// Clean up animations when token is deleted
	Hooks.on("deleteToken", async (tokenDoc, options, userId) => {
		// Stop is unconditional — every client ends its own copy (idempotent)
		const deps = checkDependencies();
		if (!deps.hasSequencer) return;

		// Verified alternative to `source: tokenDoc.uuid` string (dist:11720-11729
		// would throw for deleted token via get_object_from_scene). Passing
		// Document object validates via get_object_identifier (dist:475-480).
		await Sequencer.EffectManager.endEffects({ name: `${MODULE_ID}-weapon-*`, source: tokenDoc });
	});

	// Check for equipped weapons when a new token is created
	Hooks.on("createToken", async (tokenDoc, options, userId) => {
		// Only the user who created the token should add animations
		if (userId !== game.user.id) return;

		// Small delay to ensure token is fully initialized
		await new Promise(resolve => setTimeout(resolve, 100));

		const token = canvas.tokens.get(tokenDoc.id);
		if (!token) return;

		const actor = token.actor;
		if (!actor) return;
		if (isItemPilesActor(actor)) {
			await stopAllWeaponAnimations(token);
			return;
		}

		// Get all equipped items that resolve to an animation (per-item or master list)
		const equippedItems = actor.items.filter(i =>
			(i.type === "Weapon" || i.type === "Armor") &&
            i.system?.equipped === true &&
            hasWeaponAnimation(i)
		);

		// Play animation for each equipped item
		for (const item of equippedItems) {
			await playWeaponAnimation(token, item);
		}
	});

	console.log(`${MODULE_ID} | Weapon animations initialized successfully`);
}
