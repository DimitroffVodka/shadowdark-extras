// Level-context adapter for the dungeon tools — the seam over Foundry's
// scene/levels elevation model. Extracted verbatim from
// scripts/dungeon/DungeonPainterSD.mjs (Phase 5.3 sweep 6 split): reads which
// level the canvas is on (native v14 scene.levels, or the third-party Levels
// and wall-height modules) and tags created documents (tiles, walls, drawings)
// with that level context.
//
// Imports nothing by design: MODULE_ID and LEVEL_HEIGHT are duplicated here so
// DungeonPainterSD.mjs can import this module without a circular dependency.

const MODULE_ID = "shadowdark-extras";
const LEVEL_HEIGHT = 10;

export function makeTopLeftTileTexture(src) {
	return { src, anchorX: 0, anchorY: 0 };
}

/**
 * Return a level context object for the given scene, preferring the native
 * Foundry v14 levels collection over the third-party Levels module.
 * @param {Scene}  [scene]          Defaults to canvas.scene
 * @param {string} [preferredLevelId]  Pin to a specific level by ID
 */
export function getSceneLevelContext(scene = canvas.scene, preferredLevelId = null) {
	const sceneLevel = preferredLevelId
		? scene?.levels?.get(preferredLevelId)
		: (canvas?.scene?.id === scene?.id ? canvas?.level : null);
	const rawBottom = sceneLevel?.elevation?.bottom;
	const bottom    = Number(rawBottom ?? 0);
	const rawTop    = sceneLevel?.elevation?.top;
	const top       = Number(rawTop ?? (bottom + LEVEL_HEIGHT - 1));
	return {
		levelId:   sceneLevel?.id ?? null,
		elevation: Number.isFinite(bottom) ? bottom : 0,
		rangeTop:  Number.isFinite(top) ? top : (Number.isFinite(bottom) ? bottom + LEVEL_HEIGHT - 1 : LEVEL_HEIGHT - 1),
	};
}

export function getSceneLevelContextForElevation(scene, elevation) {
	const z = Number(elevation);
	const level = scene?.levels?.find?.(l => {
		const bottom = Number(l.elevation?.bottom ?? 0);
		const top = Number(l.elevation?.top ?? bottom + LEVEL_HEIGHT - 1);
		return Number.isFinite(z) && Number.isFinite(bottom) && Number.isFinite(top) && z >= bottom && z <= top;
	});
	return getSceneLevelContext(scene, level?.id ?? null);
}

export function getDocumentLevelId(doc) {
	if (!doc?.levels) return null;
	const levels = typeof doc.levels[Symbol.iterator] === "function"
		? [...doc.levels]
		: Array.isArray(doc.levels) ? doc.levels : [];
	return levels.find(id => id && id !== "defaultLevel0000") ?? levels.find(id => !!id) ?? null;
}

export function resolveLevelContext(scene = canvas.scene, preferredLevelId = null) {
	if (preferredLevelId) return getSceneLevelContext(scene, preferredLevelId);
	return getSceneLevelContext(scene);
}

export function documentMatchesLevel(doc, levelContext) {
	const targetLevelId = levelContext?.levelId ?? null;
	const docLevelId = getDocumentLevelId(doc);
	if (!targetLevelId) return !docLevelId;
	if (docLevelId) return docLevelId === targetLevelId;
	return targetLevelId === "defaultLevel0000";
}

/**
 * Apply level context (elevation, rangeTop, levelId) to a document data object.
 * Mutates and returns the object.
 */
export function applySceneLevelData(doc, type, levelContext = getSceneLevelContext()) {
	if (!doc || !levelContext) return doc;
	if (levelContext.levelId) doc.levels = [levelContext.levelId];
	if (type === "Wall") {
		// Walls use absolute Z range — `wall-height.bottom` IS the slab floor.
		doc.flags = foundry.utils.mergeObject(doc.flags ?? {}, {
			"wall-height": { bottom: levelContext.elevation, top: levelContext.rangeTop },
		}, { inplace: false });
	}
	else {
		// MCP on Foundry v14.361 verified level membership controls which native
		// level renders non-wall placeables. Elevation is relative within that
		// level, so default to 0 but preserve explicit caller offsets.
		if (doc.elevation === undefined || doc.elevation === null) doc.elevation = 0;
		doc.flags = foundry.utils.mergeObject(doc.flags ?? {}, {
			levels: { rangeTop: levelContext.rangeTop },
		}, { inplace: false });
	}
	return doc;
}

/**
 * Get current elevation from Levels module if available
 * Checks various Levels module APIs to find the currently selected elevation
 */
export function getCurrentElevation() {
	try {
		// v14 native: scene has a levels collection; canvas.level is the active level
		const sceneLevel = (canvas?.scene && canvas?.level) ? canvas.level : null;
		if (sceneLevel?.elevation) {
			const bottom = Number(sceneLevel.elevation.bottom);
			if (Number.isFinite(bottom)) return bottom;
		}

		// Check if Levels is active
		if (game.modules.get("levels")?.active) {
			// Try CONFIG.Levels.currentElevation (some versions)
			if (typeof CONFIG.Levels?.currentElevation === "number") {
				return CONFIG.Levels.currentElevation;
			}

			// Try CONFIG.Levels.UI.currentRange (Levels 3D Layer Tool)
			if (Array.isArray(CONFIG.Levels?.UI?.currentRange) && CONFIG.Levels.UI.currentRange.length >= 1) {
				return CONFIG.Levels.UI.currentRange[0];
			}

			// Try ui.levels (Levels Layer Tool application)
			if (typeof ui.levels?.currentElevation === "number") {
				return ui.levels.currentElevation;
			}
			if (typeof ui.levels?._currentFloor === "number") {
				return ui.levels._currentFloor;
			}

			// Try scene flags
			const sceneFlags = canvas.scene?.flags?.levels;
			if (typeof sceneFlags?.currentElevation === "number") {
				return sceneFlags.currentElevation;
			}

			// Try game settings for Levels
			try {
				const levelsFloor = game.settings.get("levels", "currentFloor");
				if (typeof levelsFloor === "number") {
					return levelsFloor;
				}
			}
			catch (e) { /* Setting doesn't exist */ }

			// Try accessing Levels Layer Tool's UI element directly
			const levelsToolApp = Object.values(ui.windows).find(w =>
				w.constructor?.name?.includes("Levels") || w.title?.includes("Levels")
			);
			if (levelsToolApp) {
				// Try to find the current floor value from the app
				if (typeof levelsToolApp.currentElevation === "number") {
					return levelsToolApp.currentElevation;
				}
				if (typeof levelsToolApp._currentFloor === "number") {
					return levelsToolApp._currentFloor;
				}
				// Check for elevation in the app's data
				if (typeof levelsToolApp.object?.elevation === "number") {
					return levelsToolApp.object.elevation;
				}
			}
		}

		// Check for Wall Height module compatibility
		if (game.modules.get("wall-height")?.active) {
			if (typeof CONFIG["wall-height"]?.currentElevation === "number") {
				return CONFIG["wall-height"].currentElevation;
			}
		}

		// Try getting elevation from currently controlled/hovered placeable
		const controlledTile = canvas.tiles?.controlled?.[0];
		if (controlledTile?.document?.elevation !== undefined) {
			return controlledTile.document.elevation;
		}

		// Last resort: check if there's a Levels-related flag in the scene's current state
		if (canvas.scene?.flags?.["levels-3d-preview"]?.currentFloor !== undefined) {
			return canvas.scene.flags["levels-3d-preview"].currentFloor;
		}

	}
	catch (e) {
		console.warn(`${MODULE_ID} | Could not get current elevation from Levels:`, e);
	}

	// Default to 0 if we can't determine the current elevation
	return 0;
}
