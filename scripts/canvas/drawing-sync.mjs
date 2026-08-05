// Remote drawing synchronisation — extracted from scripts/canvas/SDXDrawingTool.mjs
// (Phase 5.3 split). Prototype mixin: everything that arrives over the socket
// from another client — new drawings routed by payload shape, deletions,
// permanent clears, visibility changes and renames.
// Merged via Object.assign(SDXDrawingTool.prototype, DrawingSync).

import { STAMP_SIZES } from "./drawing-constants.mjs";

export const DrawingSync = {
	_handleRemoteDrawing(data) {
		if (data.userId === game.user.id) return;
		if (!data?.drawingId) return;
		if (!this.canvasLayer) return;
		// Route permanent drawings to the permanent renderer
		if (data.permanent) {
			if (this._permanentDrawings.some(d => d.id === data.drawingId)) return;
			this._renderPermanentEntry(data);
			return;
		}
		if (this._pixiDrawings.some(d => d.id === data.drawingId)) return;
		try {
			if (data.symbolType) this._createRemoteSymbol(data);
			else if (data.type === "box") this._createRemoteBox(data);
			else if (data.type === "ellipse") this._createRemoteEllipse(data);
			else if (data.startX !== undefined && data.points) this._createRemoteLine(data);
		}
		catch(e) {
			console.error("SDX Drawing | Remote drawing error:", e);
		}
	},

	_createRemoteLine(data) {
		const g = new PIXI.Graphics();
		const color = this._cssToPixi(data.strokeColor);
		const sw = data.strokeWidth || 6;
		g.lineStyle(sw, 0x000000, 0.3);
		if (data.points.length > 0) {
			g.moveTo(data.startX + data.points[0][0] + 2, data.startY + data.points[0][1] + 2);
			for (let i = 1; i < data.points.length; i++) {
				g.lineTo(data.startX + data.points[i][0] + 2, data.startY + data.points[i][1] + 2);
			}
		}
		this._drawLineWithStyle(
			g, data.points, data.startX, data.startY, sw, color, 1.0, data.lineStyle || "solid"
		);
		if (data.opacity !== undefined) g.alpha = data.opacity;
		this.canvasLayer.addChild(g);
		this._pixiDrawings.push({
			id: data.drawingId, graphics: g, createdAt: data.createdAt || Date.now(),
			expiresAt: data.expiresAt, userId: data.userId, userName: data.userName,
		});
		this._scheduleCleanup();
	},

	_createRemoteBox(data) {
		const g = new PIXI.Graphics();
		const color = this._cssToPixi(data.strokeColor);
		const sw = data.strokeWidth || 6;
		const ls = data.lineStyle || "solid";
		g.lineStyle(sw, 0x000000, 0.3);
		this._drawBoxWithStyle(
			g, data.startX + 2, data.startY + 2, data.width, data.height, "solid"
		);
		g.lineStyle(sw, color, 1.0);
		this._drawBoxWithStyle(g, data.startX, data.startY, data.width, data.height, ls);
		if (data.opacity !== undefined) g.alpha = data.opacity;
		this.canvasLayer.addChild(g);
		this._pixiDrawings.push({
			id: data.drawingId, graphics: g, createdAt: data.createdAt || Date.now(),
			expiresAt: data.expiresAt, userId: data.userId, userName: data.userName, type: "box",
		});
		this._scheduleCleanup();
	},

	_createRemoteEllipse(data) {
		const g = new PIXI.Graphics();
		const color = this._cssToPixi(data.strokeColor);
		const sw = data.strokeWidth || 6;
		const ls = data.lineStyle || "solid";
		g.lineStyle(sw, 0x000000, 0.3);
		this._drawEllipseWithStyle(
			g, data.startX + 2, data.startY + 2, data.width, data.height, "solid"
		);
		g.lineStyle(sw, color, 1.0);
		this._drawEllipseWithStyle(g, data.startX, data.startY, data.width, data.height, ls);
		if (data.opacity !== undefined) g.alpha = data.opacity;
		this.canvasLayer.addChild(g);
		this._pixiDrawings.push({
			id: data.drawingId, graphics: g, createdAt: data.createdAt || Date.now(),
			expiresAt: data.expiresAt, userId: data.userId, userName: data.userName,
			type: "ellipse",
		});
		this._scheduleCleanup();
	},

	_createRemoteSymbol(data) {
		const g = new PIXI.Graphics();
		const sqSize = STAMP_SIZES[data.symbolSize] || STAMP_SIZES.medium;
		const sw = data.strokeWidth || sqSize * 0.30;
		const color = this._cssToPixi(data.strokeColor);
		const half = sqSize / 2; const pad = sqSize * 0.1;
		this._drawSymbolShape(
			g, data.symbolType, data.x, data.y, half, pad, sw, color, 1.0, 0x000000, 0.3, 2
		);
		if (data.opacity !== undefined) g.alpha = data.opacity;
		this.canvasLayer.addChild(g);
		this._pixiDrawings.push({
			id: data.drawingId, graphics: g, createdAt: data.createdAt || Date.now(),
			expiresAt: data.expiresAt, userId: data.userId, userName: data.userName,
			symbolType: data.symbolType,
		});
		this._scheduleCleanup();
	},

	_handleRemoteDeletion(data) {
		if (data.userId === game.user.id) return;
		// Handle permanent drawing deletion
		if (data.permanent && data.drawingId) {
			const idx = this._permanentDrawings.findIndex(d => d.id === data.drawingId);
			if (idx !== -1) {
				const d = this._permanentDrawings[idx];
				if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
				this._permanentDrawings.splice(idx, 1);
				if (this._lastPermanentDrawing?.id === data.drawingId) {
					this._lastPermanentDrawing = this._permanentDrawings.length
						? this._permanentDrawings[this._permanentDrawings.length - 1]
						: null;
				}
			}
			return;
		}
		if (data.clearAll) {
			if (game.users.get(data.userId)?.isGM) this.clearAllDrawings(false);
		}
		else if (data.drawingId) {
			this._deleteById(data.drawingId, false);
		}
		else {
			this.clearUserDrawings(data.userId, false);
		}
	},

	_handleRemotePermanentClear() {
		this._permanentDrawings.forEach(d => {
			if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
		});
		this._permanentDrawings = [];
		this._lastPermanentDrawing = null;
	},

	_handleRemoteVisibilityChange(data) {
		if (!data?.drawingId) return;
		const entry = this._permanentDrawings.find(d => d.id === data.drawingId);
		if (!entry) return;
		entry.hidden = data.hidden;
		// For non-GM users, show/hide the drawing based on visibility
		if (!game.user.isGM && entry.graphics) {
			entry.graphics.visible = !data.hidden;
		}
	},

	_handleRemoteRename(data) {
		if (!data?.drawingId) return;
		// Check permanent drawings
		const permEntry = this._permanentDrawings.find(d => d.id === data.drawingId);
		if (permEntry) {
			permEntry.name = data.name;
			return;
		}
		// Check temporary drawings
		const tempEntry = this._pixiDrawings.find(d => d.id === data.drawingId);
		if (tempEntry) {
			tempEntry.name = data.name;
		}
	},
};
