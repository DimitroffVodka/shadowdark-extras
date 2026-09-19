// Shape drawing lifecycle — extracted from scripts/canvas/SDXDrawingTool.mjs
// (Phase 5.3 split). Prototype mixin: the start/update/finish triple for each
// of sketch, line, box and ellipse, the stamp preview, and the four builders
// that turn a finished gesture into a PIXI display object.
// Merged via Object.assign(SDXDrawingTool.prototype, DrawingShapes).

import { STAMP_SIZES } from "./drawing-constants.mjs";
import {
	buildMapPathNetwork, mapPathCellKey, mapPathEdgeKey,
} from "./drawing-geometry.mjs";

export const DrawingShapes = {
	_captureMapPathSelection() {
		return {
			tiles: {
				road: this.state.mapPathTiles.road.map(tile => ({ ...tile })),
				river: this.state.mapPathTiles.river.map(tile => ({ ...tile })),
			},
			blockedEdges: {
				road: [...this.state.mapPathBlockedEdges.road],
				river: [...this.state.mapPathBlockedEdges.river],
			},
		};
	},

	_restoreMapPathSelection(selection) {
		this._cancelMapPath();
		this.state.mapPathTiles = {
			road: selection.tiles.road.map(tile => ({ ...tile })),
			river: selection.tiles.river.map(tile => ({ ...tile })),
		};
		this.state.mapPathBlockedEdges = {
			road: [...selection.blockedEdges.road],
			river: [...selection.blockedEdges.river],
		};
		if (!this.state.mapPathTiles.road.length && !this.state.mapPathTiles.river.length) return;
		this._previewGraphics = new PIXI.Container();
		this._previewGraphics.alpha = this.state.opacity;
		this.canvasLayer.addChild(this._previewGraphics);
		this._drawMapPathPreview();
	},

	_startSketch(e) {
		const wc = this._getWorldCoords(e);
		if (!wc || !this.canvasLayer) return;
		this.state.isDrawing = true;
		this.state.drawingStartPoint = wc;
		this.state.drawingPoints = [[0, 0]];
		this._previewGraphics = new PIXI.Graphics();
		this._previewGraphics.alpha = this.state.opacity;
		this.canvasLayer.addChild(this._previewGraphics);
	},

	_updateSketch(e) {
		if (!this.state.isDrawing || !this._previewGraphics || !this.canvasLayer) return;
		const wc = this._getWorldCoords(e);
		if (!wc) return;
		const sp = this.state.drawingStartPoint;
		this.state.drawingPoints.push([wc.x - sp.x, wc.y - sp.y]);
		// Redraw
		this._previewGraphics.clear();
		const color = this._cssToPixi(this.state.brushSettings.color);
		const pts = this.state.drawingPoints;
		this._drawLineWithStyle(
			this._previewGraphics, pts, sp.x, sp.y, this.state.brushSettings.size, color, 1.0,
			this.state.lineStyle
		);
	},

	_finishSketch(e) {
		if (!this.state.isDrawing) return;
		if (this.state.drawingPoints.length < 2) {
			this._cancelDrawing(); return;
		}
		this._removePreview();
		const sp = this.state.drawingStartPoint;
		const pts = [...this.state.drawingPoints];
		this._createPixiDrawing(
			sp.x, sp.y, pts, this.state.brushSettings.size, this.state.brushSettings.color,
			this.state.lineStyle, "sketch"
		);
		this._resetDrawingState();
	},

	_startLine(e) {
		const wc = this._getWorldCoords(e);
		if (!wc || !this.canvasLayer) return;
		this.state.isDrawing = true;
		this.state.lineStartPoint = wc;
		this._previewGraphics = new PIXI.Graphics();
		this._previewGraphics.alpha = this.state.opacity;
		this.canvasLayer.addChild(this._previewGraphics);
	},

	_updateLinePreview(e) {
		if (!this.state.isDrawing || !this._previewGraphics || !this.state.lineStartPoint) return;
		const wc = this._getWorldCoords(e);
		if (!wc) return;
		this.state.lastMousePosition = wc;
		const s = this.state.lineStartPoint;
		const pts = [[0, 0], [wc.x - s.x, wc.y - s.y]];
		const color = this._cssToPixi(this.state.brushSettings.color);
		const sw = this.state.brushSettings.size;
		this._previewGraphics.clear();
		this._drawLineWithStyle(
			this._previewGraphics, pts, s.x, s.y, sw, color, 1.0, this.state.lineStyle
		);
	},

	_finishLine(e) {
		if (!this.state.isDrawing || !this.state.lineStartPoint) return;
		let wc = this.state.lastMousePosition;
		if (!wc && e) wc = this._getWorldCoords(e);
		if (!wc) {
			this._cancelDrawing(); return;
		}
		this._removePreview();
		const s = this.state.lineStartPoint;
		const pts = [[0, 0], [wc.x - s.x, wc.y - s.y]];
		this._createPixiDrawing(
			s.x, s.y, pts, this.state.brushSettings.size, this.state.brushSettings.color,
			this.state.lineStyle, "line"
		);
		this._resetDrawingState();
	},

	_selectMapPathPoint(e, addOnly = false, removeOnly = false) {
		if (!this.canvasLayer) return false;
		if (!canvas.grid?.isHexagonal) {
			ui.notifications.warn("Roads and rivers require a hex grid.");
			return false;
		}
		const wc = this._getWorldCoords(e);
		const kinds = this.state.mapPathKind === "both"
			? ["road", "river"] : [this.state.mapPathKind];
		const shift = e.shiftKey ?? e.data?.originalEvent?.shiftKey ?? false;
		if (shift && !removeOnly) {
			this._mapPathDragCell = null;
			const selection = this._captureMapPathSelection();
			const changed = this._toggleMapPathEdgeAt(wc, kinds);
			if (changed) this._mapPathUndo.push({ type: "selection", selection });
			return changed;
		}
		const cell = wc && canvas.grid.getOffset(wc);
		if (!cell) return false;
		const next = { i: cell.i, j: cell.j };
		let cells = [next];
		if (addOnly && this._mapPathDragCell
			&& mapPathCellKey(this._mapPathDragCell) !== mapPathCellKey(next)
			&& typeof canvas.grid.getDirectPath === "function") {
			cells = canvas.grid.getDirectPath([this._mapPathDragCell, next]) || cells;
		}
		this._mapPathDragCell = removeOnly ? null : next;
		const selection = addOnly ? null : this._captureMapPathSelection();
		const has = (kind, tile) => this.state.mapPathTiles[kind]
			.some(selected => selected.i === tile.i && selected.j === tile.j);
		let changed = false;
		if (addOnly) {
			for (const kind of kinds) {
				for (const tile of cells) {
					if (has(kind, tile)) continue;
					this.state.mapPathTiles[kind].push({ i: tile.i, j: tile.j });
					changed = true;
				}
			}
		}
		else {
			const remove = removeOnly || kinds.every(kind => has(kind, next));
			for (const kind of kinds) {
				if (remove && has(kind, next)) {
					this.state.mapPathTiles[kind] = this.state.mapPathTiles[kind]
						.filter(tile => tile.i !== next.i || tile.j !== next.j);
					const removedKey = mapPathCellKey(next);
					this.state.mapPathBlockedEdges[kind] = this.state.mapPathBlockedEdges[kind]
						.filter(edge => !edge.split("|").includes(removedKey));
					changed = true;
				}
				else if (!removeOnly && !has(kind, next)) {
					this.state.mapPathTiles[kind].push(next);
					changed = true;
				}
			}
		}
		if (!changed) return false;
		if (selection) this._mapPathUndo.push({ type: "selection", selection });
		if (!this._previewGraphics) {
			this._previewGraphics = new PIXI.Container();
			this._previewGraphics.alpha = this.state.opacity;
			this.canvasLayer.addChild(this._previewGraphics);
		}
		this._drawMapPathPreview();
		return true;
	},

	_toggleMapPathEdgeAt(point, kinds) {
		if (!point) return false;
		let changed = false;
		for (const kind of kinds) {
			const tiles = this.state.mapPathTiles[kind];
			const selected = new Set(tiles.map(mapPathCellKey));
			const seen = new Set();
			let nearest = null;
			for (const tile of tiles) {
				const start = canvas.grid.getCenterPoint(tile);
				for (const neighbor of canvas.grid.getAdjacentOffsets(tile)) {
					if (!selected.has(mapPathCellKey(neighbor))) continue;
					const edge = mapPathEdgeKey(tile, neighbor);
					if (seen.has(edge)) continue;
					seen.add(edge);
					const end = canvas.grid.getCenterPoint(neighbor);
					const dx = end.x - start.x;
					const dy = end.y - start.y;
					const lengthSquared = (dx * dx) + (dy * dy);
					const numerator = ((point.x - start.x) * dx) + ((point.y - start.y) * dy);
					const t = lengthSquared
						? Math.max(0, Math.min(1, numerator / lengthSquared)) : 0;
					const x = start.x + (dx * t);
					const y = start.y + (dy * t);
					const distanceSquared = ((point.x - x) ** 2) + ((point.y - y) ** 2);
					if (!nearest || distanceSquared < nearest.distanceSquared) {
						nearest = { edge, distanceSquared };
					}
				}
			}
			const tolerance = Math.max(this.state.brushSettings.size, canvas.grid.size * 0.12);
			if (!nearest || nearest.distanceSquared > tolerance ** 2) continue;
			const blocked = this.state.mapPathBlockedEdges[kind];
			const index = blocked.indexOf(nearest.edge);
			if (index >= 0) blocked.splice(index, 1);
			else blocked.push(nearest.edge);
			changed = true;
		}
		if (changed) this._drawMapPathPreview();
		return changed;
	},

	_getMapPathNetworks() {
		return {
			road: buildMapPathNetwork(
				this.state.mapPathTiles.road, canvas.grid, this.state.mapPathBlockedEdges.road
			),
			river: buildMapPathNetwork(
				this.state.mapPathTiles.river, canvas.grid, this.state.mapPathBlockedEdges.river
			),
		};
	},

	_drawMapPathPreview() {
		if (!this._previewGraphics) return;
		const preview = this._previewGraphics;
		preview.removeChildren().forEach(child => child.destroy({ children: true }));
		const networkPaths = this._getMapPathNetworks();
		if (networkPaths.road.length || networkPaths.river.length) {
			preview.addChild(this._createMapNetworkDisplay({
				networkPaths, strokeWidth: this.state.brushSettings.size,
				roadColor: this.state.mapPathRoadColor, riverColor: this.state.mapPathRiverColor,
				texturePath: this.state.mapPathTexture,
			}));
		}
		const blocked = new PIXI.Graphics();
		for (const kind of ["road", "river"]) {
			for (const edge of this.state.mapPathBlockedEdges[kind]) {
				const [start, end] = edge.split("|").map(cellKey => {
					const [i, j] = cellKey.split(":").map(Number);
					return canvas.grid.getCenterPoint({ i, j });
				});
				this._drawLineWithStyle(
					blocked, [[0, 0], [end.x - start.x, end.y - start.y]],
					start.x, start.y, 3, 0xD94848, 0.9, "dashed"
				);
			}
		}
		preview.addChild(blocked);
		const markers = new PIXI.Graphics();
		for (const [kind, radius] of [["road", 0.14], ["river", 0.09]]) {
			markers.lineStyle(3, this._cssToPixi(kind === "road"
				? this.state.mapPathRoadColor : this.state.mapPathRiverColor), 1);
			for (const tile of this.state.mapPathTiles[kind]) {
				const center = canvas.grid.getCenterPoint(tile);
				markers.drawCircle(center.x, center.y, canvas.grid.size * radius);
			}
		}
		preview.addChild(markers);
	},

	async createMapPath() {
		const networkPaths = this._getMapPathNetworks();
		if (!networkPaths.road.length && !networkPaths.river.length) {
			ui.notifications.warn("Designate at least two adjacent Road or River tiles.");
			return false;
		}
		const selection = this._captureMapPathSelection();
		const id = await this._createMapNetworkDrawing(networkPaths);
		if (!id) return false;
		this._mapPathUndo.push({ type: "create", id, selection });
		this._cancelMapPath();
		return true;
	},

	_cancelMapPath() {
		this._removePreview();
		this._mapPathDragCell = null;
		this.state.mapPathTiles = { road: [], river: [] };
		this.state.mapPathBlockedEdges = { road: [], river: [] };
	},

	_startBox(e) {
		const wc = this._getWorldCoords(e);
		if (!wc || !this.canvasLayer) return;
		this.state.isDrawing = true;
		this.state.boxStartPoint = wc;
		this._previewGraphics = new PIXI.Graphics();
		this._previewGraphics.alpha = this.state.opacity;
		this.canvasLayer.addChild(this._previewGraphics);
	},

	_updateBoxPreview(e) {
		if (!this.state.isDrawing || !this._previewGraphics || !this.state.boxStartPoint) return;
		const wc = this._getWorldCoords(e);
		if (!wc) return;
		this.state.lastMousePosition = wc;
		const s = this.state.boxStartPoint;
		const w = wc.x - s.x; const h = wc.y - s.y;
		const color = this._cssToPixi(this.state.brushSettings.color);
		const sw = this.state.brushSettings.size;
		this._previewGraphics.clear();
		this._previewGraphics.lineStyle(sw, color, 1.0);
		this._drawBoxWithStyle(this._previewGraphics, s.x, s.y, w, h, this.state.lineStyle);
	},

	_finishBox(e) {
		if (!this.state.isDrawing || !this.state.boxStartPoint) return;
		let wc = this.state.lastMousePosition;
		if (!wc && e) wc = this._getWorldCoords(e);
		if (!wc) {
			this._cancelDrawing(); return;
		}
		this._removePreview();
		const s = this.state.boxStartPoint;
		const w = wc.x - s.x; const h = wc.y - s.y;
		this._createBoxDrawing(s.x, s.y, w, h);
		this._resetDrawingState();
	},

	_startEllipse(e) {
		const wc = this._getWorldCoords(e);
		if (!wc || !this.canvasLayer) return;
		this.state.isDrawing = true;
		this.state.ellipseStartPoint = wc;
		this._previewGraphics = new PIXI.Graphics();
		this._previewGraphics.alpha = this.state.opacity;
		this.canvasLayer.addChild(this._previewGraphics);
	},

	_updateEllipsePreview(e) {
		if (!this.state.isDrawing || !this._previewGraphics
			|| !this.state.ellipseStartPoint) return;
		const wc = this._getWorldCoords(e);
		if (!wc) return;
		this.state.lastMousePosition = wc;
		const s = this.state.ellipseStartPoint;
		const w = wc.x - s.x; const h = wc.y - s.y;
		const color = this._cssToPixi(this.state.brushSettings.color);
		const sw = this.state.brushSettings.size;
		this._previewGraphics.clear();
		this._previewGraphics.lineStyle(sw, color, 1.0);
		this._drawEllipseWithStyle(this._previewGraphics, s.x, s.y, w, h, this.state.lineStyle);
	},

	_finishEllipse(e) {
		if (!this.state.isDrawing || !this.state.ellipseStartPoint) return;
		let wc = this.state.lastMousePosition;
		if (!wc && e) wc = this._getWorldCoords(e);
		if (!wc) {
			this._cancelDrawing(); return;
		}
		this._removePreview();
		const s = this.state.ellipseStartPoint;
		const w = wc.x - s.x; const h = wc.y - s.y;
		this._createEllipseDrawing(s.x, s.y, w, h);
		this._resetDrawingState();
	},

	_stampSymbol(symbolType, e) {
		if (!this.canvasLayer) return;
		const wc = this._getWorldCoords(e);
		if (!wc) return;
		this._removePreviewSymbol();
		this._createSymbolAt(symbolType, wc.x, wc.y);
	},

	_updatePreviewSymbol(e) {
		if (this.state.drawingMode !== "stamp" || !this.canvasLayer) return;
		const wc = this._getWorldCoords(e);
		if (!wc) return;
		this._removePreviewSymbol();
		const g = new PIXI.Graphics();
		const sqSize = STAMP_SIZES[this.state.symbolSize] || STAMP_SIZES.medium;
		const sw = (this.state.stampStyle === "hex-outline") ? this.state.brushSettings.size : sqSize * 0.30;
		const color = this._cssToPixi(this.state.brushSettings.color);
		const half = sqSize / 2;
		const pad = sqSize * 0.1;
		this._drawSymbolShape(
			g, this.state.stampStyle, wc.x, wc.y, half, pad, sw, color, 0.5, 0x000000, 0, 0
		);
		g.alpha = this.state.opacity;
		this.canvasLayer.addChild(g);
		this._previewSymbol = g;
	},

	_removePreviewSymbol() {
		if (this._previewSymbol?.parent) {
			this._previewSymbol.parent.removeChild(this._previewSymbol);
			this._previewSymbol.destroy();
			this._previewSymbol = null;
		}
	},

	_createPixiDrawing(startX, startY, points, strokeWidth, strokeColor, lineStyle, type) {
		if (!this.canvasLayer) return;
		const color = this._cssToPixi(strokeColor);
		const texturePath = type === "road" ? this.state.mapPathTexture : null;
		const g = this._createLineDisplay(
			points, startX, startY, strokeWidth, color, 1.0, lineStyle, texturePath
		);
		g.alpha = this.state.opacity;
		this.canvasLayer.addChild(g);
		const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const data = {
			id, graphics: g, createdAt: Date.now(), expiresAt: this._getExpiration(),
			userId: game.user.id, userName: game.user.name, startX, startY, points, strokeWidth,
			strokeColor, lineStyle, texturePath, type, opacity: this.state.opacity,
		};
		this._finalizeDrawing(
			data,
			{
				drawingId: id, userId: game.user.id, userName: game.user.name, startX, startY,
				points, strokeWidth, strokeColor, lineStyle, texturePath, type,
				opacity: this.state.opacity,
				createdAt: data.createdAt, expiresAt: data.expiresAt,
			}
		);
	},

	async _createMapNetworkDrawing(networkPaths) {
		if (!this.canvasLayer) return;
		const id = `map-network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const payload = {
			drawingId: id, userId: game.user.id, userName: game.user.name,
			type: "mapNetwork", networkPaths, strokeWidth: this.state.brushSettings.size,
			roadColor: this.state.mapPathRoadColor, riverColor: this.state.mapPathRiverColor,
			texturePath: this.state.mapPathTexture, roadStyle: this.state.mapPathRoadStyle,
			opacity: this.state.opacity, createdAt: Date.now(), expiresAt: this._getExpiration(),
		};
		const graphics = this._createMapNetworkDisplay(payload);
		graphics.alpha = this.state.opacity;
		this.canvasLayer.addChild(graphics);
		await this._finalizeDrawing({ ...payload, id, graphics }, payload);
		return id;
	},

	_createBoxDrawing(startX, startY, w, h) {
		if (!this.canvasLayer) return;
		const g = new PIXI.Graphics();
		const color = this._cssToPixi(this.state.brushSettings.color);
		const sw = this.state.brushSettings.size;
		const ls = this.state.lineStyle;
		g.lineStyle(sw, color, 1.0);
		this._drawBoxWithStyle(g, startX, startY, w, h, ls);
		g.alpha = this.state.opacity;
		this.canvasLayer.addChild(g);
		const id = `box-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const data = {
			id, graphics: g, createdAt: Date.now(), expiresAt: this._getExpiration(),
			userId: game.user.id, userName: game.user.name, startX, startY, width: w, height: h,
			strokeWidth: sw, strokeColor: this.state.brushSettings.color, lineStyle: ls,
			type: "box", opacity: this.state.opacity,
		};
		this._finalizeDrawing(
			data,
			{
				drawingId: id, userId: game.user.id, userName: game.user.name, startX, startY,
				width: w, height: h, strokeWidth: sw, strokeColor: this.state.brushSettings.color,
				lineStyle: ls, type: "box", opacity: this.state.opacity, createdAt: data.createdAt,
				expiresAt: data.expiresAt,
			}
		);
	},

	_createEllipseDrawing(startX, startY, w, h) {
		if (!this.canvasLayer) return;
		const g = new PIXI.Graphics();
		const color = this._cssToPixi(this.state.brushSettings.color);
		const sw = this.state.brushSettings.size;
		const ls = this.state.lineStyle;
		g.lineStyle(sw, color, 1.0);
		this._drawEllipseWithStyle(g, startX, startY, w, h, ls);
		g.alpha = this.state.opacity;
		this.canvasLayer.addChild(g);
		const id = `ellipse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const data = {
			id, graphics: g, createdAt: Date.now(), expiresAt: this._getExpiration(),
			userId: game.user.id, userName: game.user.name, startX, startY, width: w, height: h,
			strokeWidth: sw, strokeColor: this.state.brushSettings.color, lineStyle: ls,
			type: "ellipse", opacity: this.state.opacity,
		};
		this._finalizeDrawing(
			data,
			{
				drawingId: id, userId: game.user.id, userName: game.user.name, startX, startY,
				width: w, height: h, strokeWidth: sw, strokeColor: this.state.brushSettings.color,
				lineStyle: ls, type: "ellipse", opacity: this.state.opacity,
				createdAt: data.createdAt, expiresAt: data.expiresAt,
			}
		);
	},

	_createSymbolAt(symbolType, x, y) {
		if (!this.canvasLayer) return;
		const g = new PIXI.Graphics();
		const sqSize = STAMP_SIZES[this.state.symbolSize] || STAMP_SIZES.medium;
		const sw = (symbolType === "hex-outline") ? this.state.brushSettings.size : sqSize * 0.30;
		const color = this._cssToPixi(this.state.brushSettings.color);
		const half = sqSize / 2;
		const pad = sqSize * 0.1;
		this._drawSymbolShape(g, symbolType, x, y, half, pad, sw, color, 1.0, 0x000000, 0, 0);
		g.alpha = this.state.opacity;
		this.canvasLayer.addChild(g);
		const id = `symbol-${symbolType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const data = {
			id, graphics: g, createdAt: Date.now(), expiresAt: this._getExpiration(),
			userId: game.user.id, userName: game.user.name, symbolType, x, y, strokeWidth: sw,
			strokeColor: this.state.brushSettings.color, symbolSize: this.state.symbolSize,
			opacity: this.state.opacity,
		};
		this._finalizeDrawing(
			data,
			{
				drawingId: id, userId: game.user.id, userName: game.user.name, symbolType, x, y,
				strokeWidth: sw, strokeColor: this.state.brushSettings.color,
				symbolSize: this.state.symbolSize, opacity: this.state.opacity,
				createdAt: data.createdAt, expiresAt: data.expiresAt,
			}
		);
	},
};
