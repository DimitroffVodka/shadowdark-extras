// Interior-wall painting for the dungeon tools — lifted out of
// DungeonPainterSD.mjs (Phase 5.3 sweep 6 split).
//
// Imports nothing from the painter by design: read-only ESM bindings forbid
// cross-module assignment, so a moved function may only reference what already
// lives in a leaf. Everything referenced here comes from the dungeon leaf
// modules. MODULE_ID, WALL_THICKNESS and GRID_SIZE are duplicated here exactly
// as dungeon-level-context.mjs duplicates MODULE_ID.

import {
	_selectedIntWallTile,
	_selectedIntDoorTile,
	_wallShadows,
	_noFoundryWalls,
} from "./dungeon-tool-state.mjs";
import {
	_selectionRect,
	createSelectionRect,
} from "./dungeon-selection-overlay.mjs";
import {
	getSceneLevelContext,
	getDocumentLevelId,
	applySceneLevelData,
} from "./dungeon-level-context.mjs";
import { _doorTiles } from "./dungeon-tile-catalog.mjs";

const MODULE_ID = "shadowdark-extras";
const WALL_THICKNESS = 20;
const GRID_SIZE = 100;

/**
 * Draw a line preview for interior wall drag
 */
export function updateIntWallLine(start, end) {
	if (!_selectionRect) createSelectionRect();
	if (!_selectionRect || _selectionRect.destroyed) return;

	_selectionRect.clear();
	_selectionRect.lineStyle(3, 0xFFA500, 0.9);
	_selectionRect.moveTo(start.x, start.y);
	_selectionRect.lineTo(end.x, end.y);
	_selectionRect.beginFill(0xFFA500, 1);
	_selectionRect.drawCircle(start.x, start.y, 5);
	_selectionRect.drawCircle(end.x, end.y, 5);
	_selectionRect.endFill();
}

/**
 * Handle interior wall drag — creates a rotated Drawing + optional Foundry wall
 */
export async function handleIntWallDrag(startPos, endPos) {
	if (!game.user.isGM) return; // GM only for now

	if (!_selectedIntWallTile) {
		ui.notifications.warn("Select an interior wall tile first.");
		return;
	}

	const scene = canvas.scene;
	if (!scene) return;

	const x1 = startPos.x;
	const y1 = startPos.y;
	const x2 = endPos.x;
	const y2 = endPos.y;

	const dx = x2 - x1;
	const dy = y2 - y1;
	const length = Math.sqrt(dx * dx + dy * dy);
	if (length < 5) return;

	const angle = Math.atan2(dy, dx) * (180 / Math.PI);
	const cx = (x1 + x2) / 2;
	const cy = (y1 + y2) / 2;

	const levelContext = getSceneLevelContext(scene);
	const elevation = levelContext.elevation;
	const wallHeightTop = levelContext.rangeTop;

	// Rectangle x,y is top-left before rotation (rotation around center)
	const drawX = cx - length / 2;
	const drawY = cy - WALL_THICKNESS / 2;

	const drawingData = applySceneLevelData({
		author: game.user.id,
		x: drawX,
		y: drawY,
		rotation: angle,
		shape: { type: "r", width: length, height: WALL_THICKNESS },
		strokeWidth: 0,
		strokeAlpha: 0,
		fillType: 2,
		fillColor: "#ffffff",
		fillAlpha: 1.0,
		texture: _selectedIntWallTile,
		elevation,
		flags: {
			[MODULE_ID]: { dungeonWall: true, dungeonIntWall: true },
			levels: { rangeTop: wallHeightTop },
		},
	}, "Drawing", levelContext);

	const created = await scene.createEmbeddedDocuments("Drawing", [drawingData]);

	if (created?.length > 0) {
		// Update elevation post-creation to bypass Levels hooks
		await scene.updateEmbeddedDocuments("Drawing", [{
			"_id": created[0].id,
			elevation,
			"flags.levels.rangeTop": wallHeightTop,
		}]);

		// Apply wall shadows if enabled
		if (_wallShadows && window.TokenMagic) {
			const shadowParams = [{
				filterType: "shadow", filterId: "dropshadow2",
				rotation: 0, distance: 0, color: 0x000000, alpha: 1,
				shadowOnly: false, blur: 5, quality: 5, padding: 20,
			}];
			try {
				await TokenMagic.addUpdateFilters(created[0], shadowParams);
			}
			catch(_) {}
		}
	}

	// Create a single Foundry wall along the drag line if enabled
	if (!_noFoundryWalls) {
		const wallData = applySceneLevelData({
			c: [x1, y1, x2, y2],
			flags: {
				[MODULE_ID]: { dungeonGenWall: true, dungeonIntWall: true },
			},
		}, "Wall", levelContext);
		await scene.createEmbeddedDocuments("Wall", [wallData]);
	}
}

/**
 * Handle click on an interior wall drawing to cut it and insert a door
 */
export async function handleIntWallClick(clickPos) {
	if (!game.user.isGM) return;
	if (!_selectedIntDoorTile) return;

	const scene = canvas.scene;
	if (!scene) return;

	const gridSize = scene.grid?.size || canvas.grid?.size || GRID_SIZE;
	const clickX = clickPos.x;
	const clickY = clickPos.y;

	// Find the int wall drawing that was clicked (not doors, not already-door drawings)
	let hitDrawing = null;
	let hitT = 0; // projection from drawing center along wall axis (local x)
	const clickTolerance = 25;

	for (const d of scene.drawings) {
		if (!d.flags?.[MODULE_ID]?.dungeonIntWall) continue;
		if (d.flags?.[MODULE_ID]?.dungeonIntDoor) continue; // skip existing door drawings
		if (d.shape?.type !== "r") continue;

		const theta = (d.rotation || 0) * Math.PI / 180;
		const hw = d.shape.width / 2;
		const hh = (d.shape.height ?? WALL_THICKNESS) / 2;
		const cx = d.x + hw;
		const cy = d.y + hh;

		// Transform click into local (unrotated) space around drawing center
		const dx = clickX - cx;
		const dy = clickY - cy;
		const cosT = Math.cos(-theta);
		const sinT = Math.sin(-theta);
		const lx = dx * cosT - dy * sinT;
		const ly = dx * sinT + dy * cosT;

		if (Math.abs(lx) <= hw + clickTolerance && Math.abs(ly) <= hh + clickTolerance) {
			hitDrawing = d;
			hitT = lx; // local x = projection along axis from center
			break;
		}
	}

	if (!hitDrawing) {
		ui.notifications.warn("Click on an interior wall to insert a door.");
		return;
	}

	const theta = (hitDrawing.rotation || 0) * Math.PI / 180;
	const ux = Math.cos(theta);
	const uy = Math.sin(theta);
	const hw = hitDrawing.shape.width / 2;
	const cx = hitDrawing.x + hw;
	const cy = hitDrawing.y + (hitDrawing.shape.height ?? WALL_THICKNESS) / 2;

	const doorHalfWidth = gridSize / 2; // 50px for a 100px grid

	if (hw < doorHalfWidth) {
		ui.notifications.warn("Interior wall is too short to insert a door.");
		return;
	}

	// Clamp projection so door stays fully inside the wall
	const tClamped = Math.max(-hw + doorHalfWidth, Math.min(hw - doorHalfWidth, hitT));

	const leftLen = tClamped - doorHalfWidth + hw;   // wall start → door start
	const rightLen = hw - (tClamped + doorHalfWidth); // door end → wall end

	// Wall axis endpoints
	const p1x = cx - hw * ux;
	const p1y = cy - hw * uy;
	const p2x = cx + hw * ux;
	const p2y = cy + hw * uy;

	// Door gap endpoints
	const dsx = cx + (tClamped - doorHalfWidth) * ux;
	const dsy = cy + (tClamped - doorHalfWidth) * uy;
	const dex = cx + (tClamped + doorHalfWidth) * ux;
	const dey = cy + (tClamped + doorHalfWidth) * uy;

	const levelContext = getSceneLevelContext(scene, getDocumentLevelId(hitDrawing));
	const elevation = hitDrawing.elevation ?? levelContext.elevation;
	const wallHeightTop = levelContext.rangeTop;

	// Choose door texture variant based on wall orientation
	const normalizedAngle = ((hitDrawing.rotation || 0) % 180 + 180) % 180;
	const isHorizontalWall = normalizedAngle < 45 || normalizedAngle > 135;
	let doorTexture = _selectedIntDoorTile;
	if (doorTexture) {
		if (isHorizontalWall && !doorTexture.toLowerCase().includes("horizontal")) {
			const hVariant = doorTexture.replace(/vertical/i, "horizontal");
			if (_doorTiles?.find(t => t.path === hVariant)) doorTexture = hVariant;
		}
		else if (!isHorizontalWall && !doorTexture.toLowerCase().includes("vertical")) {
			const vVariant = doorTexture.replace(/horizontal/i, "vertical");
			if (_doorTiles?.find(t => t.path === vVariant)) doorTexture = vVariant;
		}
	}

	// Delete original int wall drawing
	await scene.deleteEmbeddedDocuments("Drawing", [hitDrawing.id]);

	// Find and delete the matching int wall Foundry wall
	const wTol = 30;
	const matchingWall = scene.walls.find(w => {
		if (!w.flags?.[MODULE_ID]?.dungeonIntWall) return false;
		if (w.door && w.door > 0) return false;
		const [wx1, wy1, wx2, wy2] = w.c;
		return (
			(Math.abs(wx1 - p1x) < wTol && Math.abs(wy1 - p1y) < wTol
             && Math.abs(wx2 - p2x) < wTol && Math.abs(wy2 - p2y) < wTol)
            || (Math.abs(wx1 - p2x) < wTol && Math.abs(wy1 - p2y) < wTol
             && Math.abs(wx2 - p1x) < wTol && Math.abs(wy2 - p1y) < wTol)
		);
	});
	if (matchingWall) {
		await scene.deleteEmbeddedDocuments("Wall", [matchingWall.id]);
	}

	const wallTexture = hitDrawing.texture || _selectedIntWallTile;
	const baseDrawingData = applySceneLevelData({
		author: game.user.id,
		rotation: hitDrawing.rotation || 0,
		strokeWidth: 0,
		strokeAlpha: 0,
		fillType: 2,
		fillColor: "#ffffff",
		fillAlpha: 1.0,
		elevation,
		flags: {
			[MODULE_ID]: { dungeonWall: true, dungeonIntWall: true },
		},
	}, "Drawing", levelContext);

	const drawingsToCreate = [];
	const wallsToCreate = [];

	// Left wall segment
	if (leftLen > 5) {
		const midT_left = (-hw + tClamped - doorHalfWidth) / 2;
		drawingsToCreate.push({
			...baseDrawingData,
			x: cx + midT_left * ux - leftLen / 2,
			y: cy + midT_left * uy - WALL_THICKNESS / 2,
			shape: { type: "r", width: leftLen, height: WALL_THICKNESS },
			texture: wallTexture,
		});
		if (!_noFoundryWalls) {
			wallsToCreate.push(applySceneLevelData({
				c: [p1x, p1y, dsx, dsy],
				flags: {
					[MODULE_ID]: { dungeonGenWall: true, dungeonIntWall: true },
				},
			}, "Wall", levelContext));
		}
	}

	// Right wall segment
	if (rightLen > 5) {
		const midT_right = (tClamped + doorHalfWidth + hw) / 2;
		drawingsToCreate.push({
			...baseDrawingData,
			x: cx + midT_right * ux - rightLen / 2,
			y: cy + midT_right * uy - WALL_THICKNESS / 2,
			shape: { type: "r", width: rightLen, height: WALL_THICKNESS },
			texture: wallTexture,
		});
		if (!_noFoundryWalls) {
			wallsToCreate.push(applySceneLevelData({
				c: [dex, dey, p2x, p2y],
				flags: {
					[MODULE_ID]: { dungeonGenWall: true, dungeonIntWall: true },
				},
			}, "Wall", levelContext));
		}
	}

	// Create all new drawings
	if (drawingsToCreate.length > 0) {
		const created = await scene.createEmbeddedDocuments("Drawing", drawingsToCreate);
		// Post-creation elevation update (Levels may override during creation)
		const updates = created.map(d => ({
			"_id": d.id,
			elevation,
			"flags.levels.rangeTop": wallHeightTop,
			...(levelContext.levelId ? { levels: [levelContext.levelId] } : {}),
		}));
		if (updates.length > 0) {
			await scene.updateEmbeddedDocuments("Drawing", updates);
		}
		// Apply wall shadows if enabled
		if (_wallShadows && window.TokenMagic) {
			const shadowParams = [{ filterType: "shadow", filterId: "dropshadow2", rotation: 0, distance: 0, color: 0x000000, alpha: 1, shadowOnly: false, blur: 5, quality: 5, padding: 20 }];
			for (const doc of created) {
				try {
					await TokenMagic.addUpdateFilters(doc, shadowParams);
				}
				catch(_) {}
			}
		}
	}

	// Create wall segment Foundry walls
	if (wallsToCreate.length > 0) {
		await scene.createEmbeddedDocuments("Wall", wallsToCreate);
	}

	// Create Foundry door wall (always, regardless of _noFoundryWalls — doors need to be functional)
	const doorWallData = applySceneLevelData({
		c: [dsx, dsy, dex, dey],
		door: 1,
		ds: 0,
		light: 20,
		move: 20,
		sound: 20,
		doorSound: "woodBasic",
		flags: {
			[MODULE_ID]: { dungeonIntWall: true, dungeonIntDoor: true },
		},
	}, "Wall", levelContext);
	if (doorTexture) {
		doorWallData.animation = { type: "swing", texture: doorTexture };
	}
	await scene.createEmbeddedDocuments("Wall", [doorWallData]);
}

/**
 * Handle shift+click on an interior door to remove it and restore the original int wall
 */
export async function handleIntWallDoorRemove(clickPos) {
	if (!game.user.isGM) return;

	const scene = canvas.scene;
	if (!scene) return;

	const clickX = clickPos.x;
	const clickY = clickPos.y;

	// Distance from point to line segment
	const distToSegment = (px, py, x1, y1, x2, y2) => {
		const dx = x2 - x1; const dy = y2 - y1;
		const len2 = dx * dx + dy * dy;
		if (len2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
		const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
		return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
	};

	// Find the closest dungeonIntDoor Foundry door wall to the click
	let hitDoor = null;
	let minDist = 40;
	for (const w of scene.walls) {
		if (!w.flags?.[MODULE_ID]?.dungeonIntDoor) continue;
		if (!w.door || w.door === 0) continue;
		const dist = distToSegment(clickX, clickY, w.c[0], w.c[1], w.c[2], w.c[3]);
		if (dist < minDist) {
			minDist = dist;
			hitDoor = w;
		}
	}

	if (!hitDoor) {
		ui.notifications.warn("Shift+Click on an interior door to remove it.");
		return;
	}

	const [dsx, dsy, dex, dey] = hitDoor.c;
	const endTol = 35;

	// Helper: get both world-space endpoints of a rotated rect drawing
	const getDrawingEndpoints = d => {
		const theta = (d.rotation || 0) * Math.PI / 180;
		const hw = d.shape.width / 2;
		const cx = d.x + hw;
		const cy = d.y + (d.shape.height ?? WALL_THICKNESS) / 2;
		const ux = Math.cos(theta);
		const uy = Math.sin(theta);
		return [
			{ x: cx - hw * ux, y: cy - hw * uy },
			{ x: cx + hw * ux, y: cy + hw * uy },
		];
	};

	const near = (ax, ay, bx, by) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2) < endTol;

	// Find adjacent int wall drawings (not doors) whose endpoint touches the door gap
	let leftDrawing = null; let  leftFarEnd  = null; // segment ending near (dsx, dsy)
	let rightDrawing = null; let rightFarEnd = null; // segment starting near (dex, dey)

	for (const d of scene.drawings) {
		if (!d.flags?.[MODULE_ID]?.dungeonIntWall) continue;
		if (d.flags?.[MODULE_ID]?.dungeonIntDoor) continue;
		if (d.shape?.type !== "r") continue;
		const [ep1, ep2] = getDrawingEndpoints(d);
		if (near(ep1.x, ep1.y, dsx, dsy)) {
			leftDrawing = d; leftFarEnd = ep2;
		}
		else if (near(ep2.x, ep2.y, dsx, dsy)) {
			leftDrawing = d; leftFarEnd = ep1;
		}
		if (near(ep1.x, ep1.y, dex, dey)) {
			rightDrawing = d; rightFarEnd = ep2;
		}
		else if (near(ep2.x, ep2.y, dex, dey)) {
			rightDrawing = d; rightFarEnd = ep1;
		}
	}

	// Find adjacent int wall Foundry walls (non-door) touching the door gap
	let leftWall = null; let  leftWallFar  = null;
	let rightWall = null; let rightWallFar = null;

	for (const w of scene.walls) {
		if (!w.flags?.[MODULE_ID]?.dungeonIntWall) continue;
		if (w.door && w.door > 0) continue;
		const [wx1, wy1, wx2, wy2] = w.c;
		if (near(wx1, wy1, dsx, dsy)) {
			leftWall = w; leftWallFar = { x: wx2, y: wy2 };
		}
		else if (near(wx2, wy2, dsx, dsy)) {
			leftWall = w; leftWallFar = { x: wx1, y: wy1 };
		}
		if (near(wx1, wy1, dex, dey)) {
			rightWall = w; rightWallFar = { x: wx2, y: wy2 };
		}
		else if (near(wx2, wy2, dex, dey)) {
			rightWall = w; rightWallFar = { x: wx1, y: wy1 };
		}
	}

	// Merged wall endpoints (fall back to door endpoints if a segment was missing)
	const mergedStart = leftFarEnd  ?? { x: dsx, y: dsy };
	const mergedEnd   = rightFarEnd ?? { x: dex, y: dey };

	const mdx = mergedEnd.x - mergedStart.x;
	const mdy = mergedEnd.y - mergedStart.y;
	const mergedLength = Math.sqrt(mdx * mdx + mdy * mdy);
	const mergedAngle  = Math.atan2(mdy, mdx) * (180 / Math.PI);
	const mergedCx = (mergedStart.x + mergedEnd.x) / 2;
	const mergedCy = (mergedStart.y + mergedEnd.y) / 2;

	const wallTexture = (leftDrawing || rightDrawing)?.texture || _selectedIntWallTile;
	const levelContext = getSceneLevelContext(scene, getDocumentLevelId(hitDoor));
	const elevation = hitDoor.flags?.["wall-height"]?.bottom ?? levelContext.elevation;
	const wallHeightTop = levelContext.rangeTop;

	// Delete: door wall + adjacent drawings + adjacent wall segments
	const drawingsToDelete = [];
	const wallsToDelete = [hitDoor.id];
	if (leftDrawing)  drawingsToDelete.push(leftDrawing.id);
	if (rightDrawing) drawingsToDelete.push(rightDrawing.id);
	if (leftWall)     wallsToDelete.push(leftWall.id);
	if (rightWall)    wallsToDelete.push(rightWall.id);

	if (drawingsToDelete.length > 0) {
		await scene.deleteEmbeddedDocuments("Drawing", drawingsToDelete);
	}
	await scene.deleteEmbeddedDocuments("Wall", wallsToDelete);

	if (mergedLength < 5) return;

	// Recreate merged int wall drawing
	const drawingData = applySceneLevelData({
		author: game.user.id,
		x: mergedCx - mergedLength / 2,
		y: mergedCy - WALL_THICKNESS / 2,
		rotation: mergedAngle,
		shape: { type: "r", width: mergedLength, height: WALL_THICKNESS },
		strokeWidth: 0,
		strokeAlpha: 0,
		fillType: 2,
		fillColor: "#ffffff",
		fillAlpha: 1.0,
		texture: wallTexture,
		elevation,
		flags: {
			[MODULE_ID]: { dungeonWall: true, dungeonIntWall: true },
		},
	}, "Drawing", levelContext);

	const created = await scene.createEmbeddedDocuments("Drawing", [drawingData]);
	if (created?.length > 0) {
		await scene.updateEmbeddedDocuments("Drawing", [{
			"_id": created[0].id,
			elevation,
			"flags.levels.rangeTop": wallHeightTop,
			...(levelContext.levelId ? { levels: [levelContext.levelId] } : {}),
		}]);
		if (_wallShadows && window.TokenMagic) {
			const shadowParams = [{ filterType: "shadow", filterId: "dropshadow2", rotation: 0, distance: 0, color: 0x000000, alpha: 1, shadowOnly: false, blur: 5, quality: 5, padding: 20 }];
			try {
				await TokenMagic.addUpdateFilters(created[0], shadowParams);
			}
			catch(_) {}
		}
	}

	// Recreate merged int wall Foundry wall
	if (!_noFoundryWalls) {
		await scene.createEmbeddedDocuments("Wall", [applySceneLevelData({
			c: [mergedStart.x, mergedStart.y, mergedEnd.x, mergedEnd.y],
			flags: {
				[MODULE_ID]: { dungeonGenWall: true, dungeonIntWall: true },
			},
		}, "Wall", levelContext)]);
	}
}
