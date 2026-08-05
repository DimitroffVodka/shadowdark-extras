// Selection-rectangle overlay for the dungeon painter — the PIXI graphics
// overlay that previews the paint/delete rectangle and the interior-wall drag
// line while the GM drags on the canvas. Extracted verbatim from
// scripts/dungeon/DungeonPainterSD.mjs (Phase 5.3 sweep 6 split).
//
// Imports nothing by design: the module reads only globals (PIXI, canvas) and
// its own state, so DungeonPainterSD.mjs can import it without a circular
// dependency. `_selectionRect` is an exported live binding because
// DungeonPainterSD.mjs still reads it directly (updateIntWallLine).

export let _selectionRect = null;

/**
 * Create selection rectangle overlay
 */
export function createSelectionRect() {
	if (_selectionRect) return;

	// Safety check - canvas must be ready
	if (!canvas?.interface) return;

	_selectionRect = new PIXI.Graphics();
	canvas.interface.addChild(_selectionRect);

	// Dimensions label
	const style = new PIXI.TextStyle({
		fontFamily: "Arial",
		fontSize: 18,
		fontWeight: "bold",
		fill: "#ffffff",
		stroke: "#000000",
		strokeThickness: 3,
	});
	const label = new PIXI.Text("", style);
	label.name = "dimensionsLabel";
	label.visible = false;
	_selectionRect.addChild(label);
}

/**
 * Update selection rectangle
 */
export function updateSelectionRect(start, end, isDelete) {
	if (!_selectionRect) createSelectionRect();

	// Safety check - if selection rect couldn't be created or was destroyed
	if (!_selectionRect || _selectionRect.destroyed) return;

	const gridSize = canvas?.grid?.size || canvas.grid.size;

	// Calculate grid range
	const minX = Math.min(start.x, end.x);
	const minY = Math.min(start.y, end.y);
	const maxX = Math.max(start.x, end.x);
	const maxY = Math.max(start.y, end.y);

	const minGx = Math.floor(minX / gridSize);
	const minGy = Math.floor(minY / gridSize);
	const maxGx = Math.floor(maxX / gridSize);
	const maxGy = Math.floor(maxY / gridSize);

	const fillColor = isDelete ? 0xFF4444 : 0x44FF44;
	const strokeColor = isDelete ? 0xCC0000 : 0x00CC00;

	_selectionRect.clear();
	_selectionRect.lineStyle(2, strokeColor, 0.8);
	_selectionRect.beginFill(fillColor, 0.25);

	for (let gx = minGx; gx <= maxGx; gx++) {
		for (let gy = minGy; gy <= maxGy; gy++) {
			_selectionRect.drawRect(gx * gridSize, gy * gridSize, gridSize, gridSize);
		}
	}

	_selectionRect.endFill();

	// Update label
	const label = _selectionRect.getChildByName("dimensionsLabel");
	if (label) {
		const w = maxGx - minGx + 1;
		const h = maxGy - minGy + 1;
		label.text = `${w} x ${h}`;
		label.style.fill = isDelete ? "#ffcccc" : "#ccffcc";

		const zoom = canvas.stage.scale.x;
		const inverseScale = 1 / zoom;
		label.scale.set(inverseScale);

		const offsetX = 20 * inverseScale;
		const offsetY = 20 * inverseScale;
		label.position.set(end.x + offsetX, end.y + offsetY);
		label.visible = true;
	}
}

/**
 * Clear selection rectangle
 */
export function clearSelectionRect() {
	if (_selectionRect && !_selectionRect.destroyed) {
		_selectionRect.clear();
		const label = _selectionRect.getChildByName("dimensionsLabel");
		if (label) label.visible = false;
	}
}

/**
 * Destroy selection rectangle completely
 */
export function destroySelectionRect() {
	if (_selectionRect) {
		if (!_selectionRect.destroyed) {
			if (_selectionRect.parent) {
				_selectionRect.parent.removeChild(_selectionRect);
			}
			_selectionRect.destroy({ children: true });
		}
		_selectionRect = null;
	}
}
