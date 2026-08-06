// POI preview and placement transform for the hex painter — the leaf that the
// rest of the HexPainterSD.mjs split can import without a cycle.
// Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing from the painter by design: the painter and its callers
// import these names back under the same identifiers, and a leaf module is
// what keeps the extraction provable (read-only ESM bindings forbid
// cross-module assignment).
//
// _getAvailablePoiTiles is why this seam took four attempts. It reads seven
// names that all had to leave the painter first — _activeTileTab, _chosenTiles
// and _symbolTiles into hex-tile-selection.mjs, _decorMode,
// _importedDecorTiles, _ddPackDecorTiles and getRegisteredDecorTiles into
// hex-decor.mjs — and every preview function funnels through it. Until the last
// one landed, moving any of this meant importing from the painter.

import { getDoorTiles } from "../dungeon/DungeonPainterSD.mjs";
import { _activeTileTab, _chosenTiles, _symbolTiles } from "./hex-tile-selection.mjs";
import {
	_decorMode,
	_importedDecorTiles,
	_ddPackDecorTiles,
	getRegisteredDecorTiles,
} from "./hex-decor.mjs";

const MODULE_ID = "shadowdark-extras";

// POI (Symbol) tile state
export let _poiScale = 0.5;             // Scale factor for POI tiles (0.1 - 2.0)

export let _poiRotation = 0;            // Rotation in degrees (0, 90, 180, 270)

export let _poiMirror = false;          // Horizontal mirror

export let _previewSprite = null;       // PIXI sprite for preview

export let _previewContainer = null;    // Container for preview sprite

export let _previewEnabled = false;     // Whether preview is active

export let _currentPreviewIndex = 0;    // Index for cycling through selected tiles

/**
 * Get current POI scale
 */
export function getPoiScale() {
	return _poiScale;
}

/**
 * Set POI scale and persist to settings
 */
export function setPoiScale(scale) {
	_poiScale = Math.max(0.1, Math.min(2.0, scale));
	try {
		game.settings.set(MODULE_ID, "hexPainter.poiScale", _poiScale);
	}
	catch (e) {
		// Settings might not be registered yet
	}
	// Update preview if active
	if (_previewSprite && _previewEnabled) {
		_updatePreviewTransform();
	}
}

/**
 * Load POI scale from settings
 */
export function loadPoiScale() {
	try {
		const saved = game.settings.get(MODULE_ID, "hexPainter.poiScale");
		if (saved !== undefined) {
			_poiScale = saved;
		}
	}
	catch (e) {
		// Settings not registered yet, use default
		_poiScale = 0.5;
	}
}

/**
 * Adjust POI scale by a delta amount
 */
export function adjustPoiScale(delta) {
	const newScale = Math.max(0.1, Math.min(2.0, _poiScale + delta));
	if (newScale !== _poiScale) {
		setPoiScale(newScale);
	}
}

/**
 * Get current POI rotation
 */
export function getPoiRotation() {
	return _poiRotation;
}

/**
 * Rotate POI left (counter-clockwise 90 degrees)
 */
export function rotatePoiLeft() {
	_poiRotation = (_poiRotation - 90 + 360) % 360;
	_updatePreviewTransform();
}

/**
 * Rotate POI right (clockwise 90 degrees)
 */
export function rotatePoiRight() {
	_poiRotation = (_poiRotation + 90) % 360;
	_updatePreviewTransform();
}

/**
 * Get current POI mirror state
 */
export function getPoiMirror() {
	return _poiMirror;
}

/**
 * Toggle POI horizontal mirror
 */
export function togglePoiMirror() {
	_poiMirror = !_poiMirror;
	_updatePreviewTransform();
}

/**
 * Reset POI transform (rotation and mirror)
 */
export function resetPoiTransform() {
	_poiRotation = 0;
	_poiMirror = false;
	_updatePreviewTransform();
}

/**
 * Update preview sprite transform (rotation, mirror, scale)
 */
export function _updatePreviewTransform() {
	if (_previewSprite) {
		_previewSprite.rotation = (_poiRotation * Math.PI) / 180;
		_previewSprite.scale.set(
			_poiMirror ? -_poiScale : _poiScale,
			_poiScale
		);
	}
}

/**
 * Create preview sprite for POI painting
 */
export async function createPreview() {
	// Destroy existing preview first
	destroyPreview();

	if (!canvas.stage) return;

	// Get available symbol tiles
	const availableTiles = _getAvailablePoiTiles();
	if (availableTiles.length === 0) return;

	// Create container for preview
	_previewContainer = new PIXI.Container();
	_previewContainer.name = "sdx-poi-preview";
	_previewContainer.eventMode = "none";
	_previewContainer.interactiveChildren = false;

	// Load texture for the first tile
	const tilePath = availableTiles[_currentPreviewIndex % availableTiles.length];
	try {
		const texture = await foundry.canvas.loadTexture(tilePath);
		if (texture) {
			_previewSprite = new PIXI.Sprite(texture);
			_previewSprite.anchor.set(0.5, 0.5);
			_previewSprite.alpha = 0.6;
			_previewSprite.rotation = (_poiRotation * Math.PI) / 180;
			_previewSprite.scale.set(
				_poiMirror ? -_poiScale : _poiScale,
				_poiScale
			);
			_previewSprite._sdxTexturePath = tilePath;
			_previewContainer.addChild(_previewSprite);
			// Add to interface layer so it renders above tiles but below UI
			const targetLayer = canvas.interface || canvas.stage;
			targetLayer.addChild(_previewContainer);
			_previewEnabled = true;
		}
	}
	catch (e) {
		console.warn(`${MODULE_ID} | Failed to create POI preview:`, e);
	}
}

/**
 * Update preview position and texture
 */
export async function updatePreviewPosition(pos) {
	if (!_previewEnabled || !_previewContainer || !_previewSprite) return;

	// Update position
	_previewContainer.position.set(pos.x, pos.y);

	// Check if we need to update texture (if tiles changed)
	const availableTiles = _getAvailablePoiTiles();
	if (availableTiles.length === 0) {
		destroyPreview();
		return;
	}

	// Update texture if needed
	const currentPath = availableTiles[_currentPreviewIndex % availableTiles.length];
	if (_previewSprite._sdxTexturePath !== currentPath) {
		try {
			const texture = await foundry.canvas.loadTexture(currentPath);
			if (texture) {
				_previewSprite.texture = texture;
				_previewSprite._sdxTexturePath = currentPath;
			}
		}
		catch (e) {
			// Ignore texture load errors
		}
	}
}

/**
 * Destroy preview sprite
 */
export function destroyPreview() {
	if (_previewContainer) {
		if (_previewContainer.parent) {
			_previewContainer.parent.removeChild(_previewContainer);
		}
		_previewContainer.destroy({ children: true });
		_previewContainer = null;
	}
	_previewSprite = null;
	_previewEnabled = false;
}

/**
 * Enable preview
 */
export function enablePreview() {
	if (!_previewEnabled) {
		createPreview();
	}
}

/**
 * Disable preview
 */
export function disablePreview() {
	destroyPreview();
}

/**
 * Check if preview is enabled
 */
export function isPreviewEnabled() {
	return _previewEnabled;
}

/**
 * Advance to the next tile in the cycle
 */
export function advancePreviewIndex() {
	const availableTiles = _getAvailablePoiTiles();
	if (availableTiles.length > 0) {
		_currentPreviewIndex = (_currentPreviewIndex + 1) % availableTiles.length;
	}
}

/**
 * Reset the preview index to the start of the cycle
 */
export function resetPreviewIndex() {
	_currentPreviewIndex = 0;
}

/**
 * Get current preview index
 */
export function getCurrentPreviewIndex() {
	return _currentPreviewIndex;
}

/**
 * Get array of available POI tiles from chosen tiles
 */
export function _getAvailablePoiTiles() {
	if (_activeTileTab !== "symbols" && !_decorMode) return [];

	const doorTiles = getDoorTiles();
	return Array.from(_chosenTiles).filter(path =>
		(_symbolTiles && _symbolTiles.some(t => t.path === path)) ||
        (_decorMode && _importedDecorTiles && _importedDecorTiles.some(t => t.path === path)) ||
        (_decorMode && _ddPackDecorTiles && _ddPackDecorTiles.some(t => t.path === path)) ||
        (_decorMode && getRegisteredDecorTiles().some(t => t.path === path)) ||
        (_decorMode && doorTiles.some(t => t.path === path))
	);
}
