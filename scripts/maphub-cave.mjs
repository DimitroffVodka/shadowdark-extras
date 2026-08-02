// Cave/dungeon cluster — extracted from
// scripts/MaphubViewerApp.mjs (Phase 5.1 split).
// Prototype mixin: merged into MaphubViewerApp.prototype via Object.assign.
// Instance state (this._x) travels with the instance — no module state.

import { MODULE_ID, FilePicker } from "./maphub-constants.mjs";

export const caveMixin = {
	/**
	 * Resolve the live Cave generator model instance from the iframe.
	 * Cave.js is patched to expose its Haxe class map as window.__maphubClasses;
	 * cave.model.Model keeps the current model on its static `.inst`.
	 * @returns {object|null}
	 */
	_getCaveModel() {
		const cw = this._iframe?.contentWindow;
		let model = cw?.__maphubClasses?.["cave.model.Model"]?.inst ?? null;
		model ??= cw?.maphubCaveAppInstance?.model ?? null;
		return model;
	},

	/**
	 * The OpenFL stage of a bundled (maphub-fork) generator, reachable through
	 * the exposed class registry. Used to read live render transforms.
	 * @returns {object|null}
	 */
	_getMaphubStage() {
		try {
			const cw = this._iframe?.contentWindow;
			return cw?.__maphubClasses?.["lime.app.Application"]?.current?.__window?.stage ?? null;
		}
		catch (_) {
			return null;
		}
	},

	/**
	 * Find the display object that draws the generator's geometry and return its
	 * live render transform (geometry-local → canvas pixels). The geometry sprite
	 * is the one whose own local bounds match the geometry's bounding box at a
	 * single uniform scale (so model/grid coordinates map straight to canvas
	 * pixels through `__getRenderTransform()` — the same idea proven for the
	 * dungeon, but read from the OpenFL tree instead of a patched controller).
	 *
	 * @param {{w:number,h:number}} geomBounds Geometry bbox expressed in the SAME
	 *   units the target sprite draws in (i.e. the sprite is expected to draw the
	 *   geometry roughly 1:1 in its own local space). For Cave that's `model.rect`.
	 * @returns {{ toPixel: (x:number,y:number)=>{x:number,y:number}, scale:number }|null}
	 */
	_getMaphubGeometryTransform(geomBounds) {
		try {
			const stage = this._getMaphubStage();
			const gw = Number(geomBounds?.w) || 0;
			const gh = Number(geomBounds?.h) || 0;
			if (!stage || gw <= 0 || gh <= 0) return null;

			let best = null;
			const visit = (obj, depth) => {
				if (!obj || depth > 14) return;
				for (const child of (obj.__children || [])) {
					try {
						const r = child.getBounds(child); // local-space bounds
						if (r && r.width > 0 && r.height > 0) {
							const rx = r.width / gw; const ry = r.height / gh;
							// The geometry sprite draws in the geometry's own units, so
							// its local bounds match geomBounds on BOTH axes at ~1:1.
							// Reward axis agreement (rx≈ry) AND unit match (~1) so we
							// don't latch onto unrelated uniformly-scaled sprites.
							const uniform = Math.abs(rx - ry);
							const unit = Math.abs((rx + ry) / 2 - 1);
							const score = uniform + unit;
							if (!best || score < best.score) best = { child, score };
						}
					}
					catch (_) { /* some nodes refuse getBounds */ }
					visit(child, depth + 1);
				}
			};
			visit(stage, 0);
			// Allow up to ~25% bound inflation (stroke/hatching drawn past the outline).
			if (!best || best.score > 0.3) return null;

			const M = best.child.__getRenderTransform();
			if (!M || !Number.isFinite(M.a)) return null;
			const toPixel = (x, y) => ({
				x: Math.round(M.a * x + M.c * y + M.tx),
				y: Math.round(M.b * x + M.d * y + M.ty),
			});
			return { toPixel, scale: Math.hypot(M.a, M.b) };
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Failed to read maphub geometry transform`, err);
			return null;
		}
	},

	/**
	 * Build Foundry Wall documents that trace the cave outline polygons.
	 *
	 * The Cave generator stores its geometry in model coordinates:
	 *   - `model.simple` : array of closed polygons (outer boundary + interior
	 *                      stone "island" boundaries) in model coordinates.
	 *   - `model.rect`   : bounds of the main outline (model coordinates).
	 *
	 * The map sprite draws those polygons directly in model coordinates, so we
	 * read its live render transform and map every vertex straight to the pixels
	 * of the captured on-screen image — exact alignment regardless of the
	 * generator's fit-scale.
	 * @returns {object[]} Wall document data.
	 */
	_getCaveWalls() {
		const model = this._getCaveModel();
		const polys = model?.simple ?? model?.curves;
		const rect = model?.rect;
		if (!Array.isArray(polys) || !polys.length || !rect) {
			ui.notifications.warn("Cave geometry was not available; imported image without walls.");
			return [];
		}

		const rectW = Number(rect.width) || ((rect.get_right?.() ?? 0) - (rect.get_left?.() ?? 0));
		const rectH = Number(rect.height) || ((rect.get_bottom?.() ?? 0) - (rect.get_top?.() ?? 0));
		const transform = this._getMaphubGeometryTransform({ w: rectW, h: rectH });
		if (!transform) {
			ui.notifications.warn("Cave render transform was not available; imported image without walls.");
			return [];
		}
		const toPixel = (p) => transform.toPixel(p.x, p.y);

		const walls = [];
		for (const poly of polys) {
			if (!Array.isArray(poly) || poly.length < 3) continue;
			let pts = poly
				.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
				.map(toPixel);
			// Drop consecutive duplicate pixels.
			pts = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
			// Collapse near-collinear runs (straight hex edges) into single walls.
			pts = this._simplifyClosedLoop(pts, 1.5);
			if (pts.length < 2) continue;
			for (let i = 0; i < pts.length; i++) {
				const a = pts[i];
				const c = pts[(i + 1) % pts.length];
				if (a.x === c.x && a.y === c.y) continue;
				walls.push({ c: [a.x, a.y, c.x, c.y] });
			}
		}
		return walls;
	},

	/**
	 * Remove vertices of a closed polygon that lie (within `eps` px) on the line
	 * between their neighbours, so long straight runs become a single wall.
	 * @param {{x:number,y:number}[]} pts Closed-loop points (no repeated first/last).
	 * @param {number} eps Perpendicular tolerance in pixels.
	 * @returns {{x:number,y:number}[]}
	 */
	_simplifyClosedLoop(pts, eps) {
		let arr = pts.slice();
		let changed = true;
		while (changed && arr.length > 3) {
			changed = false;
			const n = arr.length;
			const keep = new Array(n).fill(true);
			for (let i = 0; i < n; i++) {
				const prev = arr[(i - 1 + n) % n];
				const next = arr[(i + 1) % n];
				if (this._pointSegDistance(arr[i], prev, next) <= eps) keep[i] = false;
			}
			// Never drop two adjacent vertices in the same pass.
			for (let i = 0; i < n; i++) {
				if (!keep[i] && !keep[(i + 1) % n]) keep[(i + 1) % n] = true;
			}
			const out = arr.filter((_, i) => keep[i]);
			if (out.length !== arr.length && out.length >= 3) {
				arr = out;
				changed = true;
			}
		}
		return arr;
	},

	/** Perpendicular distance from point `p` to the segment `a`-`b`. */
	_pointSegDistance(p, a, b) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len2 = dx * dx + dy * dy;
		if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
		let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
		t = Math.max(0, Math.min(1, t));
		const projX = a.x + t * dx;
		const projY = a.y + t * dy;
		return Math.hypot(p.x - projX, p.y - projY);
	},

	_getImportGridSize() {
		return this._mapType === "dwellings" ? 260 : 50;
	},

	/**
	 * Clamp a generator's rendered cell size (px) to a usable Foundry grid.size.
	 * Generators render cells at whatever pixel size their own grid setting yields,
	 * which can be tiny (Cave "Square grid > Size", Dungeon "Small tiles"). Using
	 * that raw value as grid.size gives microscopic tokens; clamping (and letting
	 * the caller rescale the image by gridPx/cellPx) keeps one generator cell ==
	 * one Foundry square at a sensible size. Matches the Dwelling grid clamp range.
	 */
	_normalizeGridPx(cellPx) {
		const px = Math.round(Number(cellPx) || 0);
		return Math.max(64, Math.min(160, px || 64));
	},

	/**
	 * Watabou's OpenFL generators draw their right-click menu inside the canvas.
	 * If Import Scene is clicked while that menu is still open, it gets baked
	 * into the captured scene background. Send Escape and a harmless click into
	 * the iframe before capture so the canvas redraws without the menu.
	 */
	async _dismissGeneratorContextMenu() {
		try {
			const doc = this._iframe?.contentDocument;
			const cw = this._iframe?.contentWindow;
			const canvas = doc?.querySelector("canvas");
			if (!doc || !cw || !canvas) return;
			const escape = new cw.KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true });
			doc.dispatchEvent(escape);
			canvas.dispatchEvent(escape);

			const rect = canvas.getBoundingClientRect();
			const eventInit = { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4, button: 0, buttons: 1 };
			canvas.dispatchEvent(new cw.MouseEvent("mousedown", eventInit));
			canvas.dispatchEvent(new cw.MouseEvent("mouseup", { ...eventInit, buttons: 0 }));
			canvas.dispatchEvent(new cw.MouseEvent("click", { ...eventInit, buttons: 0 }));
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Failed to dismiss generator context menu`, err);
		}
	},

	/**
	 * Trigger the One Page Dungeon generator's native JSON export (key 'J')
	 * so that _lastSavedDungeonJson is populated from the CURRENT dungeon
	 * state — guaranteeing walls always match the same map that gets captured.
	 */
	async _exportCurrentDungeonJson() {
		try {
			const cw = this._iframe?.contentWindow;
			const doc = this._iframe?.contentDocument;
			if (!cw || !doc) return false;

			this._lastSavedDungeonJson = null;
			this._lastSavedDungeonJsonAt = 0;

			const keyEvent = new cw.KeyboardEvent("keydown", {
				key: "j", code: "KeyJ", keyCode: 74, which: 74,
				bubbles: true, cancelable: true,
			});
			doc.body?.dispatchEvent(keyEvent);
			doc.dispatchEvent(keyEvent);

			// Poll for saveAs hook to deliver the JSON (up to 5 s)
			for (let i = 0; i < 50; i++) {
				await new Promise(r => setTimeout(r, 100));
				if (this._lastSavedDungeonJson) return true;
			}
			return false;
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Failed to export dungeon JSON`, err);
			return false;
		}
	},

	/**
	 * The bundled One Page Dungeon generator (Dungeon.js) is patched to expose
	 * its live view controller on the iframe window as `__sdxDungeonView`.
	 * It carries the map sprite, dungeon data, and toggle methods.
	 * @returns {object|null}
	 */
	_getDungeonController() {
		try {
			return this._iframe?.contentWindow?.__sdxDungeonView ?? null;
		}
		catch (_) {
			return null;
		}
	},

	/**
	 * Internal local-units-per-grid-cell the generator draws the dungeon at.
	 * The map sprite's floor layer bounds equal (gridBounds × 30) exactly, so 30
	 * is the constant. We still verify it against the live floor layer when the
	 * geometry is available, and fall back to the constant otherwise.
	 */
	_DUNGEON_CELL: 30,

	_resolveDungeonCell(view) {
		try {
			const map = view?.map;
			const rects = view?.dungeon?.rects || this._lastSavedDungeonJson?.rects;
			const kids = map?.__children;
			if (!map || !Array.isArray(rects) || !rects.length || !Array.isArray(kids)) return this._DUNGEON_CELL;
			let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
			for (const r of rects) {
				minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w);
				minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.h);
			}
			const gW = maxX - minX; const gH = maxY - minY;
			if (gW <= 0 || gH <= 0) return this._DUNGEON_CELL;
			// The floor layer's local bounds tightly equal the grid bbox × cell.
			// Pick the child whose x/y cell-sizes agree and are an integer.
			let best = null;
			for (const c of kids) {
				let b; try {
					b = c.getBounds(map);
				}
				catch (_) {
					continue;
				}
				const cx = b.width / gW; const cy = b.height / gH;
				if (!(cx > 0) || !(cy > 0)) continue;
				const avg = (cx + cy) / 2;
				const disagree = Math.abs(cx - cy);
				const nonInt = Math.abs(avg - Math.round(avg));
				if (disagree <= 0.05 && nonInt <= 0.05) {
					if (!best || (disagree + nonInt) < best.score) best = { cell: Math.round(avg), score: disagree + nonInt };
				}
			}
			return best?.cell || this._DUNGEON_CELL;
		}
		catch (_) {
			return this._DUNGEON_CELL;
		}
	},

	/**
	 * If the generator auto-rotated the dungeon, toggle rotation off so it
	 * renders axis-aligned. Called after the capture window is maximized and
	 * before the canvas is captured, so the captured image is axis-aligned.
	 */
	async _forceDungeonAxisAligned() {
		try {
			const view = this._getDungeonController();
			if (!view?.map) return;
			const rot = view.map.__rotation ?? view.map.get_rotation?.() ?? 0;
			if (Math.abs(rot) < 0.001) return;
			if (typeof view.toggleRotation === "function") {
				view.toggleRotation();
				await new Promise(r => setTimeout(r, 1200));
				const after = view.map.__rotation ?? 0;
				// If it toggled the wrong way, flip back to reach 0.
				if (Math.abs(after) > 0.001 && typeof view.toggleRotation === "function") {
					view.toggleRotation();
					await new Promise(r => setTimeout(r, 1200));
				}
			}
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Failed to force dungeon axis-aligned`, err);
		}
	},

	/**
	 * Build the exact grid→canvas-pixel mapping for the current dungeon render.
	 * Reads the generator's own render transform (`map.__getRenderTransform()`),
	 * which composes scale + translation + any rotation, so walls land exactly
	 * where the map is drawn in the captured image. Returns null if the live
	 * generator controller is not reachable.
	 *
	 * MUST be called at capture resolution (after the window is maximized and
	 * the canvas has settled) so the transform matches the captured PNG.
	 * @returns {{ toPixel: (gx:number, gy:number) => {x:number,y:number}, cellPx: number }|null}
	 */
	_getDungeonTransform() {
		try {
			const view = this._getDungeonController();
			const map = view?.map;
			if (!map || typeof map.__getRenderTransform !== "function") return null;
			const M = map.__getRenderTransform();
			if (!M || !Number.isFinite(M.a)) return null;
			const cell = this._resolveDungeonCell(view);
			const toPixel = (gx, gy) => {
				const lx = gx * cell; const ly = gy * cell;
				return {
					x: Math.round(M.a * lx + M.c * ly + M.tx),
					y: Math.round(M.b * lx + M.d * ly + M.ty),
				};
			};
			const cellPx = cell * Math.hypot(M.a, M.b);
			return { toPixel, cellPx };
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Failed to read dungeon render transform`, err);
			return null;
		}
	},

	/**
	 * Render mapping for a Cave import: the generator draws a square grid via
	 * cave.mapping.SquareGrid (static `.size` = model units per cell) in the same
	 * model space as the outline polygons. Returns the live geometry transform,
	 * the on-screen cell size, and the canvas px of grid-line 0 (the model rect's
	 * top-left), or null if the grid layer isn't available.
	 * @returns {{ toPixel:(x:number,y:number)=>{x:number,y:number}, cellPx:number, origin:{x:number,y:number} }|null}
	 */
	_getCaveAlignSource() {
		try {
			const cw = this._iframe?.contentWindow;
			const SquareGrid = cw?.__maphubClasses?.["cave.mapping.SquareGrid"];
			const model = this._getCaveModel();
			const rect = model?.rect;
			const cellUnits = Number(SquareGrid?.size);
			if (!SquareGrid?.inst || !(cellUnits > 0) || !rect) return null;

			const rectW = Number(rect.width) || ((rect.get_right?.() ?? 0) - (rect.get_left?.() ?? 0));
			const rectH = Number(rect.height) || ((rect.get_bottom?.() ?? 0) - (rect.get_top?.() ?? 0));
			const transform = this._getMaphubGeometryTransform({ w: rectW, h: rectH });
			if (!transform) return null;

			const left = (rect.get_left?.() ?? rect.x ?? 0);
			const top = (rect.get_top?.() ?? rect.y ?? 0);
			return {
				toPixel: transform.toPixel,
				cellPx: cellUnits * transform.scale,
				origin: transform.toPixel(left, top),
			};
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Failed to read cave align source`, err);
			return null;
		}
	},

	/**
	 * Produce a grid-aligned copy of the captured map: scale the source by `scale`
	 * (so one cell becomes an exact integer of pixels) and shift it up-left by
	 * (shiftX, shiftY) (so the generator's cell-zero edge lands on (0,0)). The
	 * walls/notes are run through the matching scale+shift, so Foundry's default
	 * grid then coincides with the map's cells with no offset fields.
	 * @returns {Promise<{ path:string, width:number, height:number }>}
	 */
	async _renderAlignedImage(imgPath, scale, shiftX, shiftY) {
		try {
			const img = await new Promise((res, rej) => {
				const im = new Image();
				im.crossOrigin = "anonymous";
				im.onload = () => res(im);
				im.onerror = rej;
				im.src = "/" + imgPath;
			});
			const w = Math.max(1, Math.round(img.naturalWidth * scale));
			const h = Math.max(1, Math.round(img.naturalHeight * scale));
			const canvas = document.createElement("canvas");
			canvas.width = w; canvas.height = h;
			const ctx = canvas.getContext("2d");
			// Fill with the map's background colour so the sub-cell crop doesn't
			// leave a transparent strip on the far edges.
			try {
				const probe = document.createElement("canvas"); probe.width = probe.height = 1;
				const pctx = probe.getContext("2d"); pctx.drawImage(img, 0, 0, 1, 1);
				const d = pctx.getImageData(0, 0, 1, 1).data;
				ctx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`;
				ctx.fillRect(0, 0, w, h);
			}
			catch (_) { /* keep transparent */ }
			ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, -shiftX, -shiftY, w, h);
			const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
			const FP = foundry.applications.apps.FilePicker?.implementation ?? FilePicker;
			await FP.createDirectory("data", "maps").catch(() => { });
			await FP.createDirectory("data", "maps/maphub").catch(() => { });
			const file = new File([blob], `aligned_${this._mapType}_${Date.now()}.png`, { type: "image/png" });
			const resp = await FP.upload("data", "maps/maphub", file, {});
			return { path: resp?.path || imgPath, width: w, height: h };
		}
		catch (err) {
			console.warn(`${MODULE_ID} | Failed to render aligned image`, err);
			return { path: imgPath, width: null, height: null };
		}
	},

	async _createImageScene({ name, img, grid, width = null, height = null }) {
		let w = width; let h = height;
		if (!(w > 0) || !(h > 0)) {
			const loader = new foundry.canvas.TextureLoader();
			const texture = await loader.loadTexture(img);
			w = texture.width; h = texture.height;
		}
		const sceneData = {
			name,
			grid: { size: grid },
			width: w,
			height: h,
			padding: 0,
			shiftX: 0,
			shiftY: 0,
			fogExploration: true,
			tokenVision: true,
		};

		const foundryMajor = Number(game.version?.split?.(".")?.[0] ?? 0);
		if (foundryMajor >= 14) {
			sceneData.levels = [{ name: "Level", background: { src: img } }];
		}
		else {
			sceneData.background = { src: img };
		}

		const scene = await Scene.create(sceneData);
		await scene.activate();
		return scene;
	},

	/**
	 * Force the application window to a massive size (2000x2000 minimum)
	 * to ensure the internal map canvas redraws at high resolution.
	 * @returns {Promise<{ position: object, style: object }>} The previous window state.
	 */
	async _maximizeForCapture() {
		ui.notifications.info("Preparing map for high-res capture...");

		const oldState = {
			position: foundry.utils.deepClone(this.position),
			style: this.element ? {
				minHeight: this.element.style.minHeight,
				minWidth: this.element.style.minWidth,
				maxWidth: this.element.style.maxWidth,
				maxHeight: this.element.style.maxHeight,
				left: this.element.style.left,
				top: this.element.style.top,
				zIndex: this.element.style.zIndex,
			} : null,
		};

		try {
			if (typeof this.setPosition === "function") {
				this.setPosition({ left: 0, top: 0 });
			}
			if (this.element) {
				this.element.style.minHeight = "2000px";
				this.element.style.minWidth = "2000px";
				this.element.style.maxWidth = "none";
				this.element.style.maxHeight = "none";
				this.element.style.left = "0px";
				this.element.style.top = "0px";
				this.element.style.zIndex = "9999";
			}
		}
		catch (e) {
			console.warn("Failed to maximize dialog window:", e);
		}
		// Give the iframe/canvas time to resize and redraw completely
		await new Promise(r => setTimeout(r, 1500));
		return oldState;
	},

	/**
	 * Restore the application window to its previous state.
	 * @param {{ position: object, style: object }} state The state to restore.
	 */
	_restoreAfterCapture(state) {
		if (!state) return;
		if (state.position) {
			this.setPosition(state.position);
		}
		if (this.element && state.style) {
			Object.assign(this.element.style, state.style);
		}
	},

	/** Set the map image as the current scene's background. */
	async _setAsBackground() {
		if (!game.user.isGM) return;
		if (!canvas?.scene) {
			ui.notifications.warn("No active scene to set background for!");
			return;
		}

		const isDwellings = this._mapType === "dwellings";
		const oldState = await this._maximizeForCapture();

		const imgPath = await this._captureAndUploadMap();
		if (!imgPath) {
			if (isDwellings) this._restoreAfterCapture(oldState);
			return;
		}

		try {
			// Create a temporary image to determine dimensions before applying
			const img = new Image();
			img.onload = async () => {
				const sceneUpdateData = {
					width: img.width,
					height: img.height,
					padding: 0,
					grid: { size: isDwellings ? 260 : 50 },
				};

				// Foundry V14 stores scene imagery on the embedded Level, not the
				// legacy top-level scene background. Update the active level when
				// available so "Set as Background" does not create a blank scene.
				const foundryMajor = Number(game.version?.split?.(".")?.[0] ?? 0);
				const levelId = canvas.level?.id ?? canvas.scene.levels?.contents?.[0]?.id;
				if (foundryMajor >= 14 && levelId) {
					sceneUpdateData[`levels.${levelId}.background.src`] = imgPath;
				}
				else {
					sceneUpdateData.background = { src: imgPath };
				}

				await canvas.scene.update(sceneUpdateData);
				ui.notifications.info(`Scene background updated to ${img.width}x${img.height}!`);

				if (isDwellings) {
					this._restoreAfterCapture(oldState);
				}
				else {
					this.close(); // Close the dialog
				}
			};
			img.onerror = () => {
				// Fallback if we can't load the image dimensions for some reason
				canvas.scene.update({ background: { src: imgPath } });
				ui.notifications.info("Scene background updated (kept previous dimensions).");

				if (isDwellings) {
					this._restoreAfterCapture(oldState);
				}
				else {
					this.close(); // Close the dialog
				}
			};
			img.src = imgPath;
		}
		catch (e) {
			console.error(`${MODULE_ID} | Failed to set scene background`, e);
			ui.notifications.error("Failed to set scene background.");
			if (isDwellings) this._restoreAfterCapture(oldState);
		}
	},

	/** Export the map as a Tile on the active scene. */
	async _addAsTile() {
		if (!game.user.isGM) return;
		if (!canvas?.scene) {
			ui.notifications.warn("No active scene to add tile to!");
			return;
		}

		const isDwellings = this._mapType === "dwellings";
		const oldState = await this._maximizeForCapture();

		const imgPath = await this._captureAndUploadMap();
		if (!imgPath) {
			if (isDwellings) this._restoreAfterCapture(oldState);
			return;
		}

		try {
			// Create a temporary image to determine dimensions before applying
			const img = new Image();
			img.onload = async () => {
				const tileData = {
					texture: { src: imgPath },
					width: img.width,
					height: img.height,
					x: canvas.stage.pivot.x - (img.width / 2),
					y: canvas.stage.pivot.y - (img.height / 2),
				};

				await canvas.scene.createEmbeddedDocuments("Tile", [tileData]);
				ui.notifications.info(`Map added as a ${img.width}x${img.height} tile!`);

				if (isDwellings) {
					this._restoreAfterCapture(oldState);
				}
				else {
					this.close(); // Close the dialog
				}
			};
			img.onerror = () => {
				ui.notifications.error("Failed to load map image dimensions for Tile.");
				if (isDwellings) this._restoreAfterCapture(oldState);
			};
			img.src = imgPath;
		}
		catch (e) {
			console.error(`${MODULE_ID} | Failed to add map as tile`, e);
			ui.notifications.error("Failed to add map as tile.");
			if (isDwellings) this._restoreAfterCapture(oldState);
		}
	},

	/** Human-readable label for the map type. */
	_getMapLabel() {
		const labels = {
			realm: "Realm Map",
			mfcg: "City Map",
			village: "Village Map",
			cave: "Cave Map",
			dungeon: "Dungeon Map",
			dwellings: "Dwelling Map",
			viewer: "3D City View",
		};
		return labels[this._mapType] || "Settlement Map";
	},

	/**
	 * Clean up the cave/dungeon view before the class close() calls super.close().
	 * DOM element BEFORE _onClose fires.  We must rescue the iframe out of
	 * Foundry's element tree first, then let super.close() safely tear down
	 * the now-empty application window.
	 *
	 * The rescued iframe lives in a hidden off-screen div where the mfcg.js
	 * OpenFL rAF loop can finish its current frame harmlessly.  After a short
	 * delay we navigate to about:blank to unload the JS context, then remove
	 * the hidden div.
	 */
	_cleanupCaveView() {
		// Restore dungeon rotation if we turned it off for import
		if (this._saveRotationWasOn) {
			try {
				const rotKey = [...Object.keys(window.localStorage)].find(k =>
					k.includes("com.watabou.dungeon")
				);
				if (rotKey) {
					const val = window.localStorage.getItem(rotKey) || "";
					window.localStorage.setItem(rotKey, val.replace("autoRotationf", "autoRotationt"));
				}
			}
			catch (err) {
				console.warn(`${MODULE_ID} | Failed to restore dungeon rotation`, err);
			}
		}
		window.removeEventListener("message", this._onMessage);
		if (this._blobUrl) {
			URL.revokeObjectURL(this._blobUrl);
			this._blobUrl = null;
		}

		const iframe = this.element?.querySelector("iframe");
		if (iframe) {
			// Park the iframe off-screen before Foundry nukes the app element
			const graveyard = document.createElement("div");
			graveyard.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;";
			document.body.appendChild(graveyard);
			graveyard.appendChild(iframe);

			// Kill JS context after the rAF loop settles, then clean up
			setTimeout(() => {
				try {
					iframe.src = "about:blank";
				}
				catch (_) { }
				setTimeout(() => graveyard.remove(), 500);
			}, 100);
		}
	},

	/** Build the iframe src. */
	async _buildSrc() {
		const ext = this._queryString ? `${this._externalBase}?${this._queryString}` : this._externalBase;
		// Importing a scene requires reading the generator's canvas/geometry,
		// which the browser only allows when the generator is served from
		// Foundry's own origin. An external (cross-origin) Watabou page can't be
		// captured at all, so every import-capable generator we bundle is served
		// locally regardless of the "use local Maphub" setting. (The setting only
		// still applies to non-bundled / view-only types.)
		// Generators whose bundled local build renders + imports correctly are
		// forced local (same-origin) so the canvas/geometry is capturable — the
		// external Watabou pages can't be embedded in this sandboxed cross-origin
		// iframe (City renders blank, Village spins the CPU). Dwelling is handled
		// via its own raw bundle path below.
		const LOCAL_ONLY_TYPES = new Set(["dungeon", "realm", "cave", "mfcg", "village", "dwellings"]);
		const localOnly = LOCAL_ONLY_TYPES.has(this._mapType);
		const useLocal = localOnly || game.settings.get(MODULE_ID, "settlement.useLocalMaphub");
		if (!useLocal) {
			console.log(`${MODULE_ID} | MaphubViewerApp: using external URL ${ext}`);
			return ext;
		}

		// Use the direct server URL for local maphub files when Foundry serves it
		// as HTML. Some Foundry installs serve static .html module files as
		// text/plain; in that case, wrap the same file in a same-origin Blob with
		// a <base> tag so scripts/assets still resolve and the parent window can
		// inspect/capture the generator.
		const BASE = `modules/${MODULE_ID}/scripts/maphub`;
		// City/Village/Dwelling use the RAW Watabou builds (to/<type>-raw/) — the
		// bundled voluminor/maphub fork builds never draw to the canvas.
		const RAW_BUNDLE_DIRS = { dwellings: "dwellings-raw", mfcg: "mfcg-raw", village: "village-raw" };
		const bundleDir = RAW_BUNDLE_DIRS[this._mapType] ?? this._mapType;
		const localBase = `${window.location.origin}${foundry.utils.getRoute(`/${BASE}/to/${bundleDir}/index.html`)}`;
		let routeDir = foundry.utils.getRoute(`/${BASE}/to/${bundleDir}`);
		if (!routeDir.endsWith("/")) routeDir += "/";
		const localBaseDir = `${window.location.origin}${routeDir}`;
		const localParams = this._queryString ? `cb=${Date.now()}&${this._queryString}` : `cb=${Date.now()}`;
		const localUrl = `${localBase}?${localParams}`;

		// Quick HEAD probe to confirm the file exists locally.
		try {
			const r = await fetch(localUrl, { method: "HEAD" });
			if (r.ok) {
				const contentType = r.headers.get("content-type") ?? "";
				if (contentType.includes("text/html")) {
					console.log(`${MODULE_ID} | MaphubViewerApp: using local URL ${localUrl}`);
					return localUrl;
				}

				const res = await fetch(localUrl);
				let html = await res.text();
				if (!/^\s*<!doctype html/i.test(html) && !/^\s*<html/i.test(html)) {
					console.warn(`${MODULE_ID} | MaphubViewerApp: local file was not HTML, using external: ${ext}`);
					return ext;
				}

				html = html
					.replace(/<head([^>]*)>/i, `<head$1><base href="${localBaseDir}">`)
					.replace(/(\.\.\/\.\.\/js\/[^"]+\.js)(")/g, `$1?cb=${Date.now()}$2`);
				this._blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
				console.log(`${MODULE_ID} | MaphubViewerApp: using local Blob URL for ${localUrl}`);
				return this._blobUrl;
			}
		}
		catch (_) { /* network error → fall through */ }

		if (localOnly) {
			const label = this._getMapLabel();
			console.error(`${MODULE_ID} | MaphubViewerApp: bundled ${label} generator files are missing; refusing external fallback because the external page can't be captured for import.`);
			ui.notifications?.error(`Bundled ${label} generator files are missing; cannot import internally.`);
			return null;
		}

		// Local files not present — fall back to external URL.
		console.warn(`${MODULE_ID} | MaphubViewerApp: local files missing, using external: ${ext}`);
		return ext;
	}

};
