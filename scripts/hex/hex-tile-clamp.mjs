/**
 * Keeping SDX-painted hex tiles on their grid cells at the scene edge.
 *
 * Extracted from the composition root in Phase 3. Core clamps a tile's
 * position into the scene rectangle, which shifts the whole first column and
 * top row off their cells; this re-applies the unclamped `_source` position
 * for SDX-painted tiles only, so the visible hex stays aligned and just the
 * transparent overhang is clipped.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Allow SDX-painted hex tiles to keep their true (possibly negative) x/y when
 * they overhang the scene's left or top edge.
 *
 * Hex art tiles are intentionally larger than the grid cell — the visible hex
 * sits centered inside a transparent canvas — so a tile centered on an edge hex
 * is anchored at a slightly negative x/y. Foundry v14's
 * `TileDocument#prepareDerivedData` clamps x/y into [0, sceneWidth/Height]
 * (`this.x = Math.clamp(this.x, 0, d.width)`), which shoves the whole tile
 * inward and shifts the entire first column / top row off their grid cells.
 *
 * We re-apply the unclamped position (preserved in `_source`) for our painted
 * tiles after core prep runs, so the visible hex stays aligned to its grid cell
 * and only the transparent overhang is clipped at the scene boundary. Scoped to
 * SDX-painted tiles only; all other tiles keep core clamping behavior.
 */
export function patchHexTilePositionClamp() {
	const restoreSourcePosition = function() {
		const flags = this._source?.flags?.[MODULE_ID];
		if (!flags?.painted || !this.parent) return;
		const sx = this._source.x;
		const sy = this._source.y;
		if (this.x === sx && this.y === sy) return;  // not clamped — nothing to do
		this.x = sx;
		this.y = sy;
		// Rebuild the derived shape so bounds/occlusion match the true position.
		const ShapeCls = this.shape?.constructor;
		if (ShapeCls) {
			this.shape = new ShapeCls({
				x: sx,
				y: sy,
				width: this.width,
				height: this.height,
				anchorX: this.texture?.anchorX ?? 0,
				anchorY: this.texture?.anchorY ?? 0,
			});
		}
	};

	const wrapperPath = "CONFIG.Tile.documentClass.prototype.prepareDerivedData";
	if (globalThis.libWrapper?.register) {
		libWrapper.register(MODULE_ID, wrapperPath, function(wrapped, ...args) {
			wrapped(...args);
			restoreSourcePosition.call(this);
		}, "WRAPPER");
	} else {
		// Fallback: direct prototype wrap (idempotent).
		const proto = CONFIG.Tile.documentClass.prototype;
		if (!proto.__sdxClampPatched) {
			const orig = proto.prepareDerivedData;
			proto.prepareDerivedData = function(...args) {
				orig.apply(this, args);
				restoreSourcePosition.call(this);
			};
			proto.__sdxClampPatched = true;
		}
	}
}
