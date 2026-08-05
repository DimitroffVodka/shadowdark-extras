// Shape drawing lifecycle — extracted from scripts/canvas/SDXDrawingTool.mjs
// (Phase 5.3 split). Prototype mixin: the start/update/finish triple for each
// of sketch, line, box and ellipse, the stamp preview, and the four builders
// that turn a finished gesture into a PIXI display object.
// Merged via Object.assign(SDXDrawingTool.prototype, DrawingShapes).

import { STAMP_SIZES } from "./drawing-constants.mjs";

export const DrawingShapes = {
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
		// Shadow
		this._previewGraphics.lineStyle(this.state.brushSettings.size, 0x000000, 0.3);
		if (pts.length > 0) {
			this._previewGraphics.moveTo(sp.x + pts[0][0] + 2, sp.y + pts[0][1] + 2);
			for (let i = 1; i < pts.length; i++) {
				this._previewGraphics.lineTo(sp.x + pts[i][0] + 2, sp.y + pts[i][1] + 2);
			}
		}
		// Main
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
		this._previewGraphics.lineStyle(sw, 0x000000, 0.3);
		this._drawLineWithStyle(
			this._previewGraphics, pts, s.x + 2, s.y + 2, sw, 0x000000, 0.3, "solid"
		);
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
		this._previewGraphics.lineStyle(sw, 0x000000, 0.3);
		this._drawBoxWithStyle(this._previewGraphics, s.x + 2, s.y + 2, w, h, "solid");
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
		this._previewGraphics.lineStyle(sw, 0x000000, 0.3);
		this._drawEllipseWithStyle(this._previewGraphics, s.x + 2, s.y + 2, w, h, "solid");
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
			g, this.state.stampStyle, wc.x, wc.y, half, pad, sw, color, 0.5, 0x000000, 0.15, 2
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
		const g = new PIXI.Graphics();
		const color = this._cssToPixi(strokeColor);
		// Shadow
		g.lineStyle(strokeWidth, 0x000000, 0.3);
		if (points.length > 0) {
			g.moveTo(startX + points[0][0] + 2, startY + points[0][1] + 2);
			for (let i = 1; i < points.length; i++) {
				g.lineTo(startX + points[i][0] + 2, startY + points[i][1] + 2);
			}
		}
		// Main
		this._drawLineWithStyle(g, points, startX, startY, strokeWidth, color, 1.0, lineStyle);
		g.alpha = this.state.opacity;
		this.canvasLayer.addChild(g);
		const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const data = {
			id, graphics: g, createdAt: Date.now(), expiresAt: this._getExpiration(),
			userId: game.user.id, userName: game.user.name, startX, startY, points, strokeWidth,
			strokeColor, lineStyle, type, opacity: this.state.opacity,
		};
		this._finalizeDrawing(
			data,
			{
				drawingId: id, userId: game.user.id, userName: game.user.name, startX, startY,
				points, strokeWidth, strokeColor, lineStyle, type, opacity: this.state.opacity,
				createdAt: data.createdAt, expiresAt: data.expiresAt,
			}
		);
	},

	_createBoxDrawing(startX, startY, w, h) {
		if (!this.canvasLayer) return;
		const g = new PIXI.Graphics();
		const color = this._cssToPixi(this.state.brushSettings.color);
		const sw = this.state.brushSettings.size;
		const ls = this.state.lineStyle;
		g.lineStyle(sw, 0x000000, 0.3);
		this._drawBoxWithStyle(g, startX + 2, startY + 2, w, h, "solid");
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
		g.lineStyle(sw, 0x000000, 0.3);
		this._drawEllipseWithStyle(g, startX + 2, startY + 2, w, h, "solid");
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
		this._drawSymbolShape(g, symbolType, x, y, half, pad, sw, color, 1.0, 0x000000, 0.3, 2);
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
