/**
 * SDX Drawing Tool
 * Whiteboard drawing system for Shadowdark Extras.
 * Allows players and GMs to draw temporary markings on the canvas.
 */

import {
	cssToPixiColor,
	drawBoxWithStyle,
	drawEllipseWithStyle,
	drawLineWithStyle,
	drawSymbolShape,
	getHexClusterOutline,
} from "./drawing-geometry.mjs";

const MODULE_ID = "shadowdark-extras";
const SOCKET_NAME = "module.shadowdark-extras";

import { COLORS, STAMP_SIZES } from "./drawing-constants.mjs";
import { DrawingShapes } from "./drawing-shapes.mjs";
import { DrawingSync } from "./drawing-sync.mjs";
import { DrawingEntries } from "./drawing-entries.mjs";

// ─── Drawing Tool Class ─────────────────────────────────────────
class SDXDrawingTool {
	constructor() {
		this.active = false;
		this._keyDown = false;
		// Toggle-driven (click-to-draw) state. Mirrors _keyDown but is driven
		// by the toolbar's draw-toggle button instead of the hotkey.
		this._toggleActive = false;
		this._mouseButtonDown = false;
		this._pixiContainer = null; // PIXI container for all drawings
		this._pixiDrawings = [];
		this._previewGraphics = null;
		this._previewSymbol = null;
		this._lastDrawing = null;
		this._permanentDrawings = [];
		this._lastPermanentDrawing = null;
		this._cleanupInterval = null;
		this._initialized = false;
		this._highlightGraphics = null;
		this._highlightPulse = null;

		// Drawing state
		this.state = {
			drawingMode: "sketch", // sketch | line | box | ellipse | stamp
			stampStyle: "plus",    // plus | x | dot | arrow | arrow-up | arrow-down | arrow-left | square
			symbolSize: "medium",  // small | medium | large
			lineStyle: "solid",    // solid | dotted | dashed
			brushSettings: { size: 6, color: COLORS.black },
			opacity: 1.0,
			permanentMode: false,
			timedEraseEnabled: false,
			isDrawing: false,
			drawingPoints: [],
			drawingStartPoint: null,
			boxStartPoint: null,
			ellipseStartPoint: null,
			lineStartPoint: null,
			lastMousePosition: null,
		};
	}

	// ── Initialise ──────────────────────────────────────────────
	async initialize() {
		if (this._initialized) return;

		// Load persisted toolbar state
		this._loadSavedState();

		// Create a PIXI container on the interface layer (highest canvas layer)
		this._createCanvasLayer();

		// Load permanent drawings for the current scene (canvasReady may have already fired)
		this._loadPermanentDrawings();

		// Socket listener for cross-client sync
		this._registerSocketHandlers();

		// Scene change cleanup
		Hooks.on("canvasReady", () => {
			this._createCanvasLayer();
			this._pixiDrawings = [];
			this._lastDrawing = null;
			this._loadPermanentDrawings();
		});

		Hooks.on("canvasTearDown", () => this.cleanup());

		this._initialized = true;
	}

	// ── Load saved toolbar state from settings ──────────────────
	_loadSavedState() {
		try {
			const s = (key, fallback) => {
				try {
					return game.settings.get(MODULE_ID, key);
				}
				catch{
					return fallback;
				}
			};
			const dm = s("drawing.toolbar.drawingMode", "sketch");
			if (["sketch", "line", "box", "ellipse", "stamp"].includes(dm)) this.state.drawingMode = dm;
			const ss = s("drawing.toolbar.stampStyle", "plus");
			if (["plus", "x", "dot", "arrow", "arrow-up", "arrow-down", "arrow-left", "square", "hex-outline"].includes(ss)) this.state.stampStyle = ss;
			const sz = s("drawing.toolbar.symbolSize", "medium");
			if (["small", "medium", "large"].includes(sz)) this.state.symbolSize = sz;
			const lw = s("drawing.toolbar.lineWidth", 6);
			if (typeof lw === "number" && lw > 0) this.state.brushSettings.size = lw;
			const ls = s("drawing.toolbar.lineStyle", "solid");
			if (["solid", "dotted", "dashed"].includes(ls)) this.state.lineStyle = ls;
			const cl = s("drawing.toolbar.color", "");
			if (cl) this.state.brushSettings.color = cl;
			else this.state.brushSettings.color = this._getPlayerColor();
			const te = s("drawing.toolbar.timedEraseEnabled", false);
			if (typeof te === "boolean") this.state.timedEraseEnabled = te;
			const op = s("drawing.toolbar.opacity", 1.0);
			if (typeof op === "number" && op >= 0.1 && op <= 1.0) this.state.opacity = op;
		}
		catch(e) {
			console.warn("SDX Drawing | Failed to load saved state:", e);
		}
	}

	_getPlayerColor() {
		let hex = "#000000";
		if (game.user?.color) {
			if (game.user.color.constructor?.name === "Color") {
				const v = Number(game.user.color);
				if (!isNaN(v)) hex = `#${v.toString(16).padStart(6, "0")}`;
			}
			else if (typeof game.user.color === "string") {
				hex = game.user.color;
			}
			else if (typeof game.user.color === "number") {
				hex = `#${game.user.color.toString(16).padStart(6, "0")}`;
			}
		}
		if (!hex.startsWith("#")) hex = "#000000";
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, 1.0)`;
	}

	// ── Canvas Layer ────────────────────────────────────────────
	_createCanvasLayer() {
		if (!canvas?.stage) return;
		// Remove old container if present
		if (this._pixiContainer && this._pixiContainer.parent) {
			this._pixiContainer.parent.removeChild(this._pixiContainer);
			this._pixiContainer.destroy({ children: true });
		}
		this._pixiContainer = new PIXI.Container();
		this._pixiContainer.name = "sdx-drawing-layer";
		this._pixiContainer.sortableChildren = true;
		this._pixiContainer.zIndex = 99999;
		this._pixiContainer.interactive = false;
		this._pixiContainer.interactiveChildren = false;

		// Add to interface group (topmost canvas group) to be above TOM's canvas elements
		const target = canvas.interface ?? canvas.stage;
		target.addChild(this._pixiContainer);
		// Push to end of stacking
		if (target.sortableChildren !== true) {
			target.sortableChildren = true;
		}
	}

	get canvasLayer() {
		return this._pixiContainer;
	}

	// ── Socket ──────────────────────────────────────────────────
	_registerSocketHandlers() {
		game.socket.on(SOCKET_NAME, payload => {
			if (payload.type === "sdx-drawing-created") {
				this._handleRemoteDrawing(payload.data);
			}
			else if (payload.type === "sdx-drawing-deleted") {
				this._handleRemoteDeletion(payload.data);
			}
			else if (payload.type === "sdx-permanent-cleared") {
				this._handleRemotePermanentClear();
			}
			else if (payload.type === "sdx-drawing-visibility") {
				this._handleRemoteVisibilityChange(payload.data);
			}
			else if (payload.type === "sdx-drawing-renamed") {
				this._handleRemoteRename(payload.data);
			}
		});
	}

	_broadcast(type, data) {
		game.socket.emit(SOCKET_NAME, { type, data });
	}

	// ── Keybinding hold mode ────────────────────────────────────
	onHoldKeyDown() {
		if (this._keyDown) return;
		this._keyDown = true;
		this.activate(true);
	}

	onHoldKeyUp() {
		if (!this._keyDown) return;
		this._keyDown = false;
		if (this.state.isDrawing) {
			this._finishCurrentDrawing();
		}
		this.deactivate(true);
		this._removePreviewSymbol();
	}

	// ── Activate / Deactivate ───────────────────────────────────
	activate(keyBased = false) {
		if (!this._canDraw()) return false;
		if (this.active) {
			// Re-enter: keep activation latched if either path is asking for it.
			if (!keyBased) this._toggleActive = true;
			return true;
		}
		this.active = true;
		if (!keyBased) this._toggleActive = true;
		this._attachCanvasHandlers();
		this._updateCursor();
		Hooks.callAll("sdxDrawingActiveChanged", true, keyBased);
		return true;
	}

	deactivate(keyBased = false) {
		if (!this.active) return;
		// Clear only the activation source that initiated this deactivation.
		// If the other source is still active, keep the tool live.
		if (keyBased) this._keyDown = false;
		else this._toggleActive = false;
		if (this._keyDown || this._toggleActive) {
			// Other activation source still holds the tool open.
			Hooks.callAll("sdxDrawingActiveChanged", true, keyBased);
			return;
		}
		this.active = false;
		this._mouseButtonDown = false;
		this._detachCanvasHandlers();
		this._removePreviewSymbol();
		this._updateCursor();
		if (this.state.isDrawing) this._cancelDrawing();
		Hooks.callAll("sdxDrawingActiveChanged", false, keyBased);
	}

	/**
     * True when input should drive drawing. Either:
     *   - hotkey is held (_keyDown), or
     *   - toggle mode is on AND mouse button is currently down.
     * The toggle path requires mouse-button-down so click-drag works
     * intuitively (move-while-not-clicking does NOT draw).
     */
	_isInputActive() {
		return this._keyDown || (this._toggleActive && this._mouseButtonDown);
	}

	cleanup() {
		// Force full teardown — clear both activation sources so deactivate
		// doesn't short-circuit (used on canvas teardown).
		if (this.active) {
			this._keyDown = false;
			this._toggleActive = false;
			this.deactivate(true);
		}
		this._detachCanvasHandlers();
		if (this._cleanupInterval) {
			clearInterval(this._cleanupInterval);
			this._cleanupInterval = null;
		}
	}

	_canDraw() {
		if (game.user.isGM) return true;
		try {
			return game.settings.get(MODULE_ID, "drawing.enablePlayerDrawing");
		}
		catch{
			return true;
		}
	}

	// ── Cursor ──────────────────────────────────────────────────
	_updateCursor() {
		if (!canvas?.app?.view) return;
		canvas.app.view.style.cursor = this.active ? "crosshair" : "";
	}

	// ── Canvas event handlers ───────────────────────────────────
	_attachCanvasHandlers() {
		if (!canvas?.app?.view) return;
		const self = this;

		this._handlePointerDown = e => {
			if (!self.active) return;
			// Track mouse button for toggle-mode click-drag gating.
			if (e.button === 0) self._mouseButtonDown = true;
			if (!self._isInputActive()) return;
			if (self.state.drawingMode === "box" || self.state.drawingMode === "ellipse") {
				e.preventDefault(); e.stopPropagation();
				// In toggle mode, pointerdown is the natural start trigger for box/ellipse.
				if (self._toggleActive && !self._keyDown && !self.state.isDrawing) {
					if (self.state.drawingMode === "box") self._startBox(e);
					else self._startEllipse(e);
				}
				return;
			}
			if (self.state.drawingMode === "stamp" && self._canDraw() && !e.ctrlKey && !e.altKey) {
				e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
				self._stampSymbol(self.state.stampStyle, e);
				return;
			}
			if (["sketch", "line"].includes(self.state.drawingMode)) {
				e.preventDefault(); e.stopPropagation();
				// In toggle mode, pointerdown starts the line/sketch.
				if (self._toggleActive && !self._keyDown && !self.state.isDrawing) {
					if (self.state.drawingMode === "sketch") self._startSketch(e);
					else if (self.state.drawingMode === "line") self._startLine(e);
				}
			}
		};

		this._handlePointerMove = e => {
			if (!self.active) return;
			if (self._isInputActive()) {
				const mode = self.state.drawingMode;
				if (mode === "sketch") {
					if (!self.state.isDrawing) self._startSketch(e); else self._updateSketch(e);
				}
				else if (mode === "line") {
					if (!self.state.isDrawing) self._startLine(e); else self._updateLinePreview(e);
				}
				else if (mode === "box") {
					if (!self.state.isDrawing) self._startBox(e); else self._updateBoxPreview(e);
				}
				else if (mode === "ellipse") {
					if (!self.state.isDrawing) self._startEllipse(e);
					else self._updateEllipsePreview(e);
				}
				else if (mode === "stamp") {
					self._updatePreviewSymbol(e);
				}
			}
			else if (self._toggleActive && self.state.drawingMode === "stamp") {
				// Toggle + stamp: show preview cursor on hover even without mouse button.
				self._updatePreviewSymbol(e);
			}
			else {
				self._removePreviewSymbol();
			}
		};

		this._handlePointerUp = e => {
			if (!self.active) return;
			const wasMouseDown = self._mouseButtonDown;
			if (e.button === 0) self._mouseButtonDown = false;

			const mode = self.state.drawingMode;

			// Toggle-mode click-drag: finish the stroke on mouse release.
			if (self._toggleActive && !self._keyDown && self.state.isDrawing && wasMouseDown) {
				if (mode === "box") self._finishBox(e);
				else if (mode === "ellipse") self._finishEllipse(e);
				else if (mode === "line") self._finishLine(e);
				else self._finishSketch(e);
				return;
			}

			if (mode === "line" || mode === "box" || mode === "ellipse") {
				e.preventDefault(); e.stopPropagation(); return;
			}
			if (self.state.isDrawing && !self._keyDown) {
				self._finishSketch(e);
			}
		};

		canvas.app.view.addEventListener("pointerdown", this._handlePointerDown, true);
		canvas.app.view.addEventListener("pointermove", this._handlePointerMove, true);
		canvas.app.view.addEventListener("pointerup", this._handlePointerUp, true);
	}

	_detachCanvasHandlers() {
		const v = canvas?.app?.view;
		if (!v) return;
		if (this._handlePointerDown) {
			v.removeEventListener("pointerdown", this._handlePointerDown, true);
			this._handlePointerDown = null;
		}
		if (this._handlePointerMove) {
			v.removeEventListener("pointermove", this._handlePointerMove, true);
			this._handlePointerMove = null;
		}
		if (this._handlePointerUp) {
			v.removeEventListener("pointerup", this._handlePointerUp, true);
			this._handlePointerUp = null;
		}
	}

	// ── Finish current drawing (called on key-up) ───────────────
	_finishCurrentDrawing() {
		if (!this.state.isDrawing) return;
		const mode = this.state.drawingMode;
		if (mode === "box") this._finishBox(null);
		else if (mode === "ellipse") this._finishEllipse(null);
		else if (mode === "line") this._finishLine(null);
		else this._finishSketch(null);
	}

	// ── Coordinate helpers ──────────────────────────────────────
	_getWorldCoords(event) {
		if (!canvas?.app) return null;
		const rect = canvas.app.view.getBoundingClientRect();
		const sx = event.clientX - rect.left;
		const sy = event.clientY - rect.top;
		const wp = canvas.app.stage.toLocal(new PIXI.Point(sx, sy));
		if (!isFinite(wp.x) || !isFinite(wp.y)) return null;
		return { x: wp.x, y: wp.y };
	}

	// ── Geometry ────────────────────────────────────────────────
	// Bodies live in drawing-geometry.mjs. Kept as members so the ~50 existing
	// call sites address them unchanged; only box and ellipse gained an
	// argument, because they were the two reading tool state directly.

	_cssToPixi(css) {
		return cssToPixiColor(css);
	}

	_drawLineWithStyle(g, pts, sx, sy, sw, color, alpha, style) {
		drawLineWithStyle(g, pts, sx, sy, sw, color, alpha, style);
	}

	_drawBoxWithStyle(g, x, y, w, h, style) {
		drawBoxWithStyle(g, x, y, w, h, style, this.state.brushSettings);
	}

	_drawEllipseWithStyle(g, x, y, w, h, style) {
		drawEllipseWithStyle(g, x, y, w, h, style, this.state.brushSettings);
	}

	_drawSymbolShape(
		g, type, cx, cy, half, pad, sw, color, alpha, shadowColor, shadowAlpha, shadowOff
	) {
		drawSymbolShape(
			g, type, cx, cy, half, pad, sw, color, alpha, shadowColor, shadowAlpha, shadowOff
		);
	}

	_getHexClusterOutline(tier, centerX, centerY) {
		return getHexClusterOutline(tier, centerX, centerY);
	}

	// ══════════════════════════════════════════════════════════════
	//  SKETCH (freehand)
	// ══════════════════════════════════════════════════════════════
	// ══════════════════════════════════════════════════════════════
	//  LINE (straight segment)
	// ══════════════════════════════════════════════════════════════
	// ══════════════════════════════════════════════════════════════
	//  BOX
	// ══════════════════════════════════════════════════════════════
	// ══════════════════════════════════════════════════════════════
	//  ELLIPSE
	// ══════════════════════════════════════════════════════════════
	// ══════════════════════════════════════════════════════════════
	//  STAMP (symbol)
	// ══════════════════════════════════════════════════════════════
	// ══════════════════════════════════════════════════════════════
	//  CREATION HELPERS
	// ══════════════════════════════════════════════════════════════
	// ══════════════════════════════════════════════════════════════
	//  DRAWING PRIMITIVES
	// ══════════════════════════════════════════════════════════════

	// ══════════════════════════════════════════════════════════════
	//  REMOTE DRAWING HANDLING
	// ══════════════════════════════════════════════════════════════
	// ══════════════════════════════════════════════════════════════
	//  CLEAR / UNDO / CLEANUP
	// ══════════════════════════════════════════════════════════════
	_fadeOutAndRemove(g, duration = 300) {
		if (!g?.parent) return;
		const startAlpha = g.alpha;
		const start = Date.now();
		const animate = () => {
			const elapsed = Date.now() - start;
			const p = Math.min(elapsed / duration, 1);
			g.alpha = startAlpha * (1 - (1 - Math.pow(1 - p, 3)));
			if (p < 1) requestAnimationFrame(animate);
			else {
				if (g.parent) g.parent.removeChild(g); g.destroy();
			}
		};
		requestAnimationFrame(animate);
	}

	clearAllDrawings(broadcast = true) {
		if (!this._pixiDrawings.length) return;
		this._pixiDrawings.forEach(d => {
			if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
		});
		this._pixiDrawings = [];
		this._lastDrawing = null;
		if (broadcast) this._broadcast("sdx-drawing-deleted", { userId: game.user.id, clearAll: true });
	}

	async clearPermanentDrawings(broadcast = true) {
		this._permanentDrawings.forEach(d => {
			if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
		});
		this._permanentDrawings = [];
		this._lastPermanentDrawing = null;
		if (game.user.isGM && canvas.scene) {
			try {
				await canvas.scene.setFlag(MODULE_ID, "permanentDrawings", []);
			}
			catch{ }
		}
		if (broadcast) this._broadcast("sdx-permanent-cleared", { userId: game.user.id });
	}

	async _undoLastPermanent() {
		if (!this._lastPermanentDrawing) {
			ui.notifications.warn("No permanent drawing to undo"); return;
		}
		const d = this._lastPermanentDrawing;
		if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
		this._permanentDrawings = this._permanentDrawings.filter(dd => dd.id !== d.id);
		this._lastPermanentDrawing = this._permanentDrawings.length
			? this._permanentDrawings[this._permanentDrawings.length - 1]
			: null;
		// Update scene flag
		if (game.user.isGM && canvas.scene) {
			try {
				const saved = canvas.scene.getFlag(MODULE_ID, "permanentDrawings") || [];
				const updated = saved.filter(s => s.drawingId !== d.id);
				await canvas.scene.setFlag(MODULE_ID, "permanentDrawings", updated);
			}
			catch{ }
		}
		this._broadcast(
			"sdx-drawing-deleted", { userId: game.user.id, drawingId: d.id, permanent: true }
		);
	}

	clearUserDrawings(userId = game.user.id, broadcast = true) {
		let removed = 0;
		this._pixiDrawings = this._pixiDrawings.filter(d => {
			if (d.userId === userId) {
				if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics); removed++; return false;
			}
			return true;
		});
		if (this._lastDrawing?.userId === userId) this._lastDrawing = null;
		if (removed > 0 && broadcast) this._broadcast("sdx-drawing-deleted", { userId, clearAll: false });
		return removed;
	}

	undoLastDrawing() {
		// If in permanent mode and GM, undo last permanent drawing
		if (this.state.permanentMode && game.user.isGM) {
			this._undoLastPermanent(); return;
		}
		if (!this._lastDrawing) {
			ui.notifications.warn("No drawing to undo"); return;
		}
		if (!game.user.isGM && this._lastDrawing.userId !== game.user.id) {
			ui.notifications.warn("Can only undo your own drawings"); return;
		}
		const d = this._lastDrawing;
		if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
		this._pixiDrawings = this._pixiDrawings.filter(dd => dd.id !== d.id);
		this._lastDrawing = null;
		const userDrawings = this._pixiDrawings.filter(dd => dd.userId === game.user.id);
		if (userDrawings.length) {
			userDrawings.sort((a, b) => b.createdAt - a.createdAt);
			this._lastDrawing = userDrawings[0];
		}
		this._broadcast(
			"sdx-drawing-deleted", { userId: game.user.id, drawingId: d.id, clearAll: false }
		);
	}

	_deleteById(drawingId, broadcast = true) {
		const idx = this._pixiDrawings.findIndex(d => d.id === drawingId);
		if (idx === -1) return;
		const d = this._pixiDrawings[idx];
		if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
		this._pixiDrawings.splice(idx, 1);
		if (this._lastDrawing?.id === drawingId) {
			this._lastDrawing = null;
			const ud = this._pixiDrawings.filter(dd => dd.userId === game.user.id); if (ud.length) {
				ud.sort((a, b) => b.createdAt - a.createdAt); this._lastDrawing = ud[0];
			}
		}
		if (broadcast) this._broadcast("sdx-drawing-deleted", { userId: game.user.id, drawingId, clearAll: false });
	}

	// ── Expiration / Cleanup ────────────────────────────────────
	_getExpiration() {
		if (!this.state.timedEraseEnabled) return null;
		let timeout = 30;
		try {
			timeout = game.settings.get(MODULE_ID, "drawing.timedEraseTimeout");
		}
		catch{ }
		return timeout > 0 ? Date.now() + (timeout * 1000) : null;
	}

	_scheduleCleanup() {
		if (this._cleanupInterval) return;
		const interval = this.state.timedEraseEnabled ? 2000 : 10000;
		this._cleanupInterval = setInterval(() => this._cleanupExpired(), interval);
		if (this.state.timedEraseEnabled) this._cleanupExpired();
	}

	_cleanupExpired() {
		if (!this._pixiDrawings.length) return;
		const now = Date.now();
		const isGM = game.user.isGM;
		this._pixiDrawings = this._pixiDrawings.filter(d => {
			if (d.expiresAt && now > d.expiresAt) {
				if (this.state.timedEraseEnabled && !isGM && d.userId !== game.user.id) return true;
				if (d.graphics?.parent) this._fadeOutAndRemove(d.graphics);
				return false;
			}
			return true;
		});
	}

	// ── Helpers ──────────────────────────────────────────────────
	_removePreview() {
		if (this._previewGraphics?.parent) {
			this._previewGraphics.parent.removeChild(this._previewGraphics);
			this._previewGraphics.destroy();
			this._previewGraphics = null;
		}
	}

	_cancelDrawing() {
		this._removePreview();
		this.state.isDrawing = false;
		this.state.drawingPoints = [];
		this.state.drawingStartPoint = null;
		this.state.boxStartPoint = null;
		this.state.ellipseStartPoint = null;
		this.state.lineStartPoint = null;
		this.state.lastMousePosition = null;
	}

	_resetDrawingState() {
		this.state.isDrawing = false;
		this.state.drawingPoints = [];
		this.state.drawingStartPoint = null;
		this.state.boxStartPoint = null;
		this.state.ellipseStartPoint = null;
		this.state.lineStartPoint = null;
		this.state.lastMousePosition = null;
	}

	// ══════════════════════════════════════════════════════════════
	//  PERMANENT DRAWINGS
	// ══════════════════════════════════════════════════════════════
	// ── Inspector helpers ────────────────────────────────────────
	// ── Public setters (called by toolbar) ──────────────────────
	setDrawingMode(mode) {
		if (["sketch", "line", "box", "ellipse", "stamp"].includes(mode)) {
			this.state.drawingMode = mode; try {
				game.settings.set(MODULE_ID, "drawing.toolbar.drawingMode", mode);
			}
			catch{ }
		}
	}

	setStampStyle(style) {
		const v = [
			"plus", "x", "dot", "arrow", "arrow-up", "arrow-down", "arrow-left", "square",
			"hex-outline",
		];
		if (v.includes(style)) {
			this.state.stampStyle = style; try {
				game.settings.set(MODULE_ID, "drawing.toolbar.stampStyle", style);
			}
			catch{ }
		}
	}

	setSymbolSize(size) {
		if (["small", "medium", "large"].includes(size)) {
			this.state.symbolSize = size; try {
				game.settings.set(MODULE_ID, "drawing.toolbar.symbolSize", size);
			}
			catch{ }
		}
	}

	setLineStyle(style) {
		if (["solid", "dotted", "dashed"].includes(style)) {
			this.state.lineStyle = style; try {
				game.settings.set(MODULE_ID, "drawing.toolbar.lineStyle", style);
			}
			catch{ }
		}
	}

	setBrushSize(size) {
		this.state.brushSettings.size = Math.max(1, Math.min(20, size)); try {
			game.settings.set(
				MODULE_ID, "drawing.toolbar.lineWidth", this.state.brushSettings.size
			);
		}
		catch{ }
	}

	setBrushColor(color) {
		this.state.brushSettings.color = color; try {
			game.settings.set(MODULE_ID, "drawing.toolbar.color", color);
		}
		catch{ }
	}

	setTimedErase(enabled) {
		this.state.timedEraseEnabled = enabled;
		try {
			game.settings.set(MODULE_ID, "drawing.toolbar.timedEraseEnabled", enabled);
		}
		catch{ }
		if (this._cleanupInterval) {
			clearInterval(this._cleanupInterval); this._cleanupInterval = null;
		}
		if (this._pixiDrawings.length) this._scheduleCleanup();
	}

	setPermanentMode(enabled) {
		this.state.permanentMode = !!enabled;
	}

	setOpacity(val) {
		this.state.opacity = Math.max(0.1, Math.min(1.0, Number(val) || 1.0)); try {
			game.settings.set(MODULE_ID, "drawing.toolbar.opacity", this.state.opacity);
		}
		catch{ }
	}

	// ── Hex Outline Helper ──────────────────────────────────────
}

// Shape lifecycle, remote synchronisation and the drawing-entry bookkeeping
// were split out in Phase 5.3. Prototype methods, so `this` is the tool
// exactly as it was inline.
Object.assign(SDXDrawingTool.prototype, DrawingShapes);
Object.assign(SDXDrawingTool.prototype, DrawingSync);
Object.assign(SDXDrawingTool.prototype, DrawingEntries);

// ── Singleton ───────────────────────────────────────────────────
export const sdxDrawingTool = new SDXDrawingTool();
// Re-exported so SDXDrawingToolbar keeps importing the palette from here.
export { COLORS, STAMP_SIZES };
