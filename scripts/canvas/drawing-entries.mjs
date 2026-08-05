// Drawing entries and the permanent store — extracted from
// scripts/canvas/SDXDrawingTool.mjs (Phase 5.3 split). Prototype mixin:
// finalising a gesture, persisting and reloading scene-flagged permanent
// drawings, and everything the toolbar list needs — enumerating entries,
// inferring their type, highlighting, renaming, hiding and deleting.
// Merged via Object.assign(SDXDrawingTool.prototype, DrawingEntries).

import { MODULE_ID } from "../shared/module-id.mjs";
import { STAMP_SIZES } from "./drawing-constants.mjs";

export const DrawingEntries = {
	_finalizeDrawing(localData, broadcastPayload) {
		const isPerm = this.state.permanentMode && game.user.isGM;
		if (isPerm) {
			localData.permanent = true;
			this._permanentDrawings.push(localData);
			this._lastPermanentDrawing = localData;
			broadcastPayload.permanent = true;
			this._broadcast("sdx-drawing-created", broadcastPayload);
			this._savePermanentToScene(broadcastPayload);
		}
		else {
			this._pixiDrawings.push(localData);
			this._lastDrawing = localData;
			this._scheduleCleanup();
			this._broadcast("sdx-drawing-created", broadcastPayload);
		}
	},

	async _savePermanentToScene(data) {
		const scene = canvas.scene;
		if (!scene || !game.user.isGM) return;
		try {
			const existing = scene.getFlag(MODULE_ID, "permanentDrawings") || [];
			existing.push(data);
			await scene.setFlag(MODULE_ID, "permanentDrawings", existing);
		}
		catch(e) {
			console.error("SDX Drawing | Failed to save permanent drawing:", e);
		}
	},

	_loadPermanentDrawings() {
		// Destroy old permanent PIXI objects
		this._permanentDrawings.forEach(d => {
			if (d.graphics?.parent) {
				d.graphics.parent.removeChild(d.graphics); d.graphics.destroy();
			}
		});
		this._permanentDrawings = [];
		this._lastPermanentDrawing = null;
		const scene = canvas.scene;
		if (!scene) return;
		const saved = scene.getFlag(MODULE_ID, "permanentDrawings") || [];
		for (const entry of saved) {
			this._renderPermanentEntry(entry);
		}
	},

	_renderPermanentEntry(data) {
		if (!this.canvasLayer || !data?.drawingId) return;
		// Avoid duplicates
		if (this._permanentDrawings.some(d => d.id === data.drawingId)) return;
		try {
			let g;
			if (data.symbolType) {
				g = new PIXI.Graphics();
				const sqSize = STAMP_SIZES[data.symbolSize] || STAMP_SIZES.medium;
				const sw = sqSize * 0.30;
				const color = this._cssToPixi(data.strokeColor);
				const half = sqSize / 2; const pad = sqSize * 0.1;
				this._drawSymbolShape(
					g, data.symbolType, data.x, data.y, half, pad, sw, color, 1.0, 0x000000, 0.3, 2
				);
			}
			else if (data.type === "box") {
				g = new PIXI.Graphics();
				const color = this._cssToPixi(data.strokeColor);
				const sw = data.strokeWidth || 6;
				const ls = data.lineStyle || "solid";
				g.lineStyle(sw, 0x000000, 0.3);
				this._drawBoxWithStyle(
					g, data.startX + 2, data.startY + 2, data.width, data.height, "solid"
				);
				g.lineStyle(sw, color, 1.0);
				this._drawBoxWithStyle(g, data.startX, data.startY, data.width, data.height, ls);
			}
			else if (data.type === "ellipse") {
				g = new PIXI.Graphics();
				const color = this._cssToPixi(data.strokeColor);
				const sw = data.strokeWidth || 6;
				const ls = data.lineStyle || "solid";
				g.lineStyle(sw, 0x000000, 0.3);
				this._drawEllipseWithStyle(
					g, data.startX + 2, data.startY + 2, data.width, data.height, "solid"
				);
				g.lineStyle(sw, color, 1.0);
				this._drawEllipseWithStyle(
					g, data.startX, data.startY, data.width, data.height, ls
				);
			}
			else if (data.startX !== undefined && data.points) {
				g = new PIXI.Graphics();
				const color = this._cssToPixi(data.strokeColor);
				const sw = data.strokeWidth || 6;
				g.lineStyle(sw, 0x000000, 0.3);
				if (data.points.length > 0) {
					g.moveTo(
						data.startX + data.points[0][0] + 2, data.startY + data.points[0][1] + 2
					);
					for (let i = 1; i < data.points.length; i++) {
						g.lineTo(
							data.startX + data.points[i][0] + 2, data.startY + data.points[i][1] + 2
						);
					}
				}
				this._drawLineWithStyle(
					g, data.points, data.startX, data.startY, sw, color, 1.0,
					data.lineStyle || "solid"
				);
			}
			if (g) {
				if (data.opacity !== undefined) g.alpha = data.opacity;
				// Respect hidden state for non-GM users
				if (data.hidden && !game.user.isGM) {
					g.visible = false;
				}
				this.canvasLayer.addChild(g);
				this._permanentDrawings.push({
					id: data.drawingId,
					graphics: g,
					permanent: true,
					createdAt: data.createdAt || Date.now(),
					userId: data.userId,
					userName: data.userName,
					hidden: data.hidden || false,
					name: data.name || null,
				});
				this._lastPermanentDrawing = this._permanentDrawings.at(-1);
			}
		}
		catch(e) {
			console.error("SDX Drawing | Failed to render permanent drawing:", e);
		}
	},

	async toggleDrawingVisibility(id) {
		if (!game.user.isGM) return;
		const entry = this._permanentDrawings.find(d => d.id === id);
		if (!entry) return;
		const newHidden = !entry.hidden;
		entry.hidden = newHidden;
		// Update scene flag
		if (canvas.scene) {
			try {
				const saved = canvas.scene.getFlag(MODULE_ID, "permanentDrawings") || [];
				const idx = saved.findIndex(s => s.drawingId === id);
				if (idx !== -1) {
					saved[idx].hidden = newHidden;
					await canvas.scene.setFlag(MODULE_ID, "permanentDrawings", saved);
				}
			}
			catch{ }
		}
		// Broadcast to other clients
		this._broadcast(
			"sdx-drawing-visibility", { drawingId: id, hidden: newHidden, userId: game.user.id }
		);
	},

	async renameDrawing(id, newName) {
		if (!game.user.isGM) return;
		// Try permanent drawings first
		const permEntry = this._permanentDrawings.find(d => d.id === id);
		if (permEntry) {
			permEntry.name = newName;
			// Update scene flag
			if (canvas.scene) {
				try {
					const saved = canvas.scene.getFlag(MODULE_ID, "permanentDrawings") || [];
					const idx = saved.findIndex(s => s.drawingId === id);
					if (idx !== -1) {
						saved[idx].name = newName;
						await canvas.scene.setFlag(MODULE_ID, "permanentDrawings", saved);
					}
				}
				catch{ }
			}
			this._broadcast(
				"sdx-drawing-renamed", { drawingId: id, name: newName, userId: game.user.id }
			);
			return;
		}
		// Try temporary drawings
		const tempEntry = this._pixiDrawings.find(d => d.id === id);
		if (tempEntry) {
			tempEntry.name = newName;
			this._broadcast(
				"sdx-drawing-renamed", { drawingId: id, name: newName, userId: game.user.id }
			);
		}
	},

	getAllDrawingEntries() {
		const entries = [];
		for (const d of this._pixiDrawings) {
			entries.push({
				id: d.id,
				type: this._inferType(d),
				name: d.name || null,
				userName: d.userName || "Unknown",
				userId: d.userId,
				createdAt: d.createdAt || Date.now(),
				expiresAt: d.expiresAt || null,
				permanent: false,
				opacity: d.graphics?.alpha ?? 1,
			});
		}
		for (const d of this._permanentDrawings) {
			entries.push({
				id: d.id,
				type: this._inferType(d),
				name: d.name || null,
				userName: d.userName || "Unknown",
				userId: d.userId,
				createdAt: d.createdAt || Date.now(),
				expiresAt: null,
				permanent: true,
				opacity: d.graphics?.alpha ?? 1,
				hidden: d.hidden || false,
			});
		}
		entries.sort((a, b) => b.createdAt - a.createdAt);
		return entries;
	},

	_inferType(entry) {
		if (entry.type && entry.type !== "drawing") return entry.type;
		if (entry.symbolType) return "stamp";
		const id = entry.id || "";
		if (id.startsWith("symbol-")) return "stamp";
		if (id.startsWith("box-")) return "box";
		if (id.startsWith("ellipse-")) return "ellipse";
		if (id.startsWith("sketch-")) return "sketch";
		if (id.startsWith("line-")) return "line";
		return "drawing";
	},

	highlightDrawing(id) {
		this.unhighlightDrawing();
		const entry = this._pixiDrawings.find(d => d.id === id) || this._permanentDrawings.find(
			d => d.id === id
		);
		if (!entry?.graphics?.parent) return;

		// Store reference to the highlighted entry
		this._highlightedEntry = entry;
		this._highlightPulse = Date.now();

		// Create a blue glow filter
		// Try to use GlowFilter if available, otherwise use a custom approach
		const glowColor = 0x4dabf7; // Nice blue color
		const glowDistance = 8;
		const glowQuality = 0.3;

		try {
			// Check if GlowFilter is available (pixi-filters)
			if (typeof PIXI.filters?.GlowFilter === "function") {
				const glow = new PIXI.filters.GlowFilter({
					distance: glowDistance,
					outerStrength: 3,
					innerStrength: 1,
					color: glowColor,
					quality: glowQuality,
				});
				entry.graphics.filters = [glow];
				this._highlightFilter = glow;
			}
			else if (typeof PIXI.filters?.OutlineFilter === "function") {
				// Fallback to OutlineFilter
				const outline = new PIXI.filters.OutlineFilter(4, glowColor, 1);
				entry.graphics.filters = [outline];
				this._highlightFilter = outline;
			}
			else {
				// Final fallback: use ColorMatrixFilter for a blue tint effect
				const colorMatrix = new PIXI.ColorMatrixFilter();
				// Shift towards blue and increase brightness
				colorMatrix.matrix = [
					0.6, 0, 0.4, 0, 0.2,
					0, 0.6, 0.4, 0, 0.3,
					0, 0, 1.2, 0, 0.5,
					0, 0, 0, 1, 0,
				];
				entry.graphics.filters = [colorMatrix];
				this._highlightFilter = colorMatrix;
			}
		}
		catch(e) {
			console.warn("SDX Drawing | Could not apply glow filter:", e);
			// Fallback: simple alpha pulse without filter
			this._highlightFilter = null;
		}

		// Store original alpha for animation
		this._highlightOriginalAlpha = entry.graphics.alpha;

		// Animate the glow intensity
		const animate = () => {
			if (!this._highlightedEntry || this._highlightedEntry !== entry) return;
			const t = (Date.now() - this._highlightPulse) / 500;
			const pulse = 0.5 + (0.5 * Math.sin(t * Math.PI));

			if (this._highlightFilter) {
				// Animate filter intensity based on filter type
				if (this._highlightFilter.outerStrength !== undefined) {
					// GlowFilter
					this._highlightFilter.outerStrength = 2 + (pulse * 3);
				}
				else if (this._highlightFilter.thickness !== undefined) {
					// OutlineFilter
					this._highlightFilter.thickness = 3 + (pulse * 3);
				}
				else if (this._highlightFilter.matrix !== undefined) {
					// ColorMatrixFilter - animate the blue channel intensity
					this._highlightFilter.matrix[12] = 0.3 + (pulse * 0.3); // Blue offset
				}
			}

			// Also do a subtle alpha pulse
			entry.graphics.alpha = this._highlightOriginalAlpha * (0.85 + (0.15 * pulse));

			requestAnimationFrame(animate);
		};
		requestAnimationFrame(animate);
	},

	unhighlightDrawing() {
		if (this._highlightedEntry?.graphics) {
			// Remove filters
			this._highlightedEntry.graphics.filters = null;
			// Restore original alpha
			if (this._highlightOriginalAlpha !== undefined) {
				this._highlightedEntry.graphics.alpha = this._highlightOriginalAlpha;
			}
		}
		this._highlightedEntry = null;
		this._highlightFilter = null;
		this._highlightPulse = null;
		this._highlightOriginalAlpha = undefined;

		// Clean up legacy highlight graphics if any
		if (this._highlightGraphics?.parent) {
			this._highlightGraphics.parent.removeChild(this._highlightGraphics);
			this._highlightGraphics.destroy();
		}
		this._highlightGraphics = null;
	},

	async deleteAnyDrawing(id) {
		if (!game.user.isGM) return;
		this.unhighlightDrawing();
		// Try temporary first
		const tempIdx = this._pixiDrawings.findIndex(d => d.id === id);
		if (tempIdx !== -1) {
			const d = this._pixiDrawings[tempIdx];
			if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
			this._pixiDrawings.splice(tempIdx, 1);
			if (this._lastDrawing?.id === id) {
				this._lastDrawing = null;
				const ud = this._pixiDrawings.filter(dd => dd.userId === game.user.id);
				if (ud.length) {
					ud.sort((a, b) => b.createdAt - a.createdAt); this._lastDrawing = ud[0];
				}
			}
			this._broadcast(
				"sdx-drawing-deleted", { userId: game.user.id, drawingId: id, clearAll: false }
			);
			return;
		}
		// Try permanent
		const permIdx = this._permanentDrawings.findIndex(d => d.id === id);
		if (permIdx !== -1) {
			const d = this._permanentDrawings[permIdx];
			if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
			this._permanentDrawings.splice(permIdx, 1);
			if (this._lastPermanentDrawing?.id === id) {
				this._lastPermanentDrawing = this._permanentDrawings.length
					? this._permanentDrawings[this._permanentDrawings.length - 1]
					: null;
			}
			if (canvas.scene) {
				try {
					const saved = canvas.scene.getFlag(MODULE_ID, "permanentDrawings") || [];
					const updated = saved.filter(s => s.drawingId !== id);
					await canvas.scene.setFlag(MODULE_ID, "permanentDrawings", updated);
				}
				catch{ }
			}
			this._broadcast(
				"sdx-drawing-deleted", { userId: game.user.id, drawingId: id, permanent: true }
			);
		}
	},
};
