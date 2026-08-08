// v13+ FilePicker namespaced under foundry.applications.apps.
import { MODULE_ID, FilePicker } from "./maphub-constants.mjs";

/**
 * MaphubViewerApp.mjs
 * ApplicationV2 window that displays a settlement map in an iframe.
 * The iframe is created entirely via DOM (not via HTML string / innerHTML) so
 * that sandbox="allow-same-origin" is never stripped by FoundryVTT's journal
 * HTML sanitizer.
 *
 * For local maphub: serves index.html directly from the module's static path.
 * express.static does NOT add X-Frame-Options, so the iframe loads fine.
 * Using a server URL (not a blob:) also keeps relative asset paths inside
 * Village.js (Assets/village_default.json, etc.) resolving correctly.
 *
 * For external fallback: uses the watabou.github.io URL directly.
 */

import { OnePageParserSD } from "./maphub/OnePageParserSD.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class MaphubViewerApp extends ApplicationV2 {

	/** @param {{ type: string, queryString: string, externalBase: string }} options */
	constructor({ type, queryString = "", externalBase = "" } = {}) {
		super({});
		this._mapType = type;
		this._queryString = queryString;
		this._externalBase = externalBase;
		this._lastSavedDungeonJson = null;
		this._lastSavedDungeonJsonAt = 0;
		this._saveRotationWasOn = false;

		this._onMessage = this._onMessage.bind(this);
	}

	static DEFAULT_OPTIONS = {
		id: "sdx-maphub-viewer",
		classes: ["sdx-maphub-viewer"],
		tag: "div",
		window: {
			frame: true,
			positioned: true,
			title: "Settlement Map",
			resizable: true,
		},
		position: {
			width: 900,
			height: 660,
			top: 60,
		},
		actions: {
			exportToChat: MaphubViewerApp.#onExportToChat,
			showToPlayers: MaphubViewerApp.#onShowToPlayers,
			saveMapState: MaphubViewerApp.#onSaveMapState,
			importScene: MaphubViewerApp.#onImportScene,
			setAsBackground: MaphubViewerApp.#onSetAsBackground,
			addAsTile: MaphubViewerApp.#onAddAsTile,
		},
	};

	// ── Render pipeline ───────────────────────────────────────────────────────

	/**
	 * Return a simple container div — the iframe is injected in _onRender
	 * so we can use async and are guaranteed the element is in the DOM.
	 */
	async _renderHTML(_context, _options) {
		const container = document.createElement("div");
		container.className = "sdx-maphub-container";
		container.style.cssText = "width:100%;height:100%;overflow:hidden;position:relative;";
		return container;
	}

	/**
	 * result = return value of _renderHTML (our container div)
	 * content = the application's .window-content element
	 */
	_replaceHTML(result, content, _options) {
		content.replaceChildren(result);
	}

	/**
	 * After the container div is in the DOM, build the src and inject the
	 * iframe entirely via DOM — iframe.sandbox is a DOMTokenList, so values
	 * set here are NEVER passed through FoundryVTT's HTML sanitizer.
	 */
	async _onRender(_context, _options) {
		window.addEventListener("message", this._onMessage);

		this._injectImportButton();

		const container = this.element.querySelector(".sdx-maphub-container");
		if (!container) return;

		const src = await this._buildSrc();
		if (!src) {
			container.textContent = "Failed to load settlement map.";
			return;
		}

		let loadedJsonText = null;

		// Clear Maphub buffers from Foundry's localStorage to prevent
		// ghost maps from loading via Watabou's auto-restore behavior.
		const watabouKeys = [
			"_toy_town_buf_",
			"{{LOCALSTORAGE_TOWN_BUF}}",
			"town_buf",
			"village_buf",
			"cave_buf",
			"dwellings_buf",
		];
		watabouKeys.forEach(k => window.localStorage.removeItem(k));

		// Preload saved map state (if it exists) into localStorage
		try {
			const mapId = this._getMapIdFromQuery();
			const saveStr = `data/maps/maphub/maphub_${mapId}.json`;
			const reqUrl = window.location.origin + foundry.utils.getRoute(`/${saveStr.replace("data/", "")}`);
			const headRes = this._mapType === "dungeon" ? null : await fetch(reqUrl, { method: "HEAD" });
			if (headRes?.ok) {
				const res = await fetch(reqUrl);
				loadedJsonText = await res.text();
				window.localStorage.setItem("_toy_town_buf_", `j${loadedJsonText}`);
				ui.notifications.info("Loaded Maphub saved state!");
			}
		}
		catch(err) {
			// No saved file exists, ignore
		}

		const iframe = document.createElement("iframe");
		iframe.style.cssText = "width:100%;height:100%;border:none;display:block;";
		iframe.title = "Settlement Map";
		// DOMTokenList — bypasses all string-based sanitization
		iframe.sandbox.add("allow-scripts");
		iframe.sandbox.add("allow-same-origin");
		iframe.sandbox.add("allow-forms");
		iframe.sandbox.add("allow-popups");
		iframe.sandbox.add("allow-downloads");

		if (loadedJsonText) {
			iframe.onload = () => {
				console.log("SDX | Iframe finished loading, dispatching maphub_load_json!");
				iframe.contentWindow?.postMessage({
					type: "maphub_load_json",
					json: loadedJsonText,
				}, "*");
			};
		}

		if (this._mapType === "dungeon") {
			iframe.addEventListener("load", () => {
				setTimeout(() => {
					try {
						const doc = iframe.contentDocument;
						const cw = iframe.contentWindow;
						this._installIframeSaveHook(iframe);
						if (!doc?.querySelector("canvas") && doc?.getElementById("openfl-content") && cw?.lime?.$scripts?.Dungeon) {
							cw.lime.embed("Dungeon", "openfl-content", 0, 0, { parameters: {} });
							this._installIframeSaveHook(iframe);
						}
					}
					catch(err) {
						console.warn(`${MODULE_ID} | Failed to ensure dungeon generator canvas`, err);
					}
				}, 250);
				setTimeout(() => this._installIframeSaveHook(iframe), 1000);
				setTimeout(() => this._installIframeSaveHook(iframe), 2500);
			}, { once: true });
		}

		iframe.src = src;

		container.replaceChildren(iframe);
		this._iframe = iframe;
	}

	// ── Header controls ───────────────────────────────────────────────────────

	/** Add header controls. */
	_getHeaderControls() {
		const controls = super._getHeaderControls?.() ?? [];

		// Add "Set as Background"
		controls.unshift({
			icon: "fa-solid fa-image",
			label: "Set as BG",
			action: "setAsBackground",
		});

		// Add "Import Scene"
		controls.unshift({
			icon: "fa-solid fa-map",
			label: "Import Scene",
			action: "importScene",
		});

		// Add "Add as Tile"
		controls.unshift({
			icon: "fa-solid fa-cubes",
			label: "Add as Tile",
			action: "addAsTile",
		});

		// Add "Show to Players"
		controls.unshift({
			icon: "fa-solid fa-eye",
			label: "Show to Players",
			action: "showToPlayers",
		});

		// Add "Export to Chat"
		controls.unshift({
			icon: "fa-solid fa-comment-dots", // changed icon so it does not conflict
			label: "Export to Chat",
			action: "exportToChat",
		});

		// Add "Save Map State"
		controls.unshift({
			icon: "fa-solid fa-floppy-disk",
			label: "Save Map State",
			action: "saveMapState",
		});

		return controls;
	}

	/**
	 * Inject an always-visible "Import Scene" button directly into the window
	 * header bar (next to the ⋯ controls menu). The other actions live in the
	 * collapsed ⋯ dropdown; importing is the primary action, so it gets a
	 * prominent labelled button so users don't have to hunt for it.
	 */
	_injectImportButton() {
		try {
			if (!game.user.isGM) return;
			const header = this.element?.querySelector(".window-header");
			if (!header || header.querySelector(".sdx-import-scene-btn")) return;

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "header-control sdx-import-scene-btn";
			btn.innerHTML = "<i class=\"fa-solid fa-map\"></i><span>Import Scene</span>";
			btn.setAttribute("aria-label", "Import Scene");
			btn.dataset.tooltip = "Create a Foundry scene from this map";
			btn.style.cssText = [
				"display:inline-flex", "align-items:center", "gap:4px",
				"width:auto", "padding:0 8px", "margin-right:4px",
				"font-size:var(--font-size-12,12px)", "white-space:nowrap",
				"border:1px solid var(--color-border-light-tertiary,#7a7971)",
				"border-radius:4px", "flex:0 0 auto",
			].join(";");
			btn.addEventListener("click", ev => {
				ev.preventDefault();
				ev.stopPropagation();
				this._importScene();
			});

			// Place it just before the controls (⋯) menu toggle / close button.
			const anchor = header.querySelector('[data-action="toggleControls"]')
				?? header.querySelector('button.header-control[data-action="close"]')
				?? header.querySelector('[data-action="close"]');
			if (anchor) header.insertBefore(btn, anchor);
			else header.appendChild(btn);
		}
		catch(err) {
			console.warn(`${MODULE_ID} | Failed to inject Import Scene header button`, err);
		}
	}

	/** Action handler for Export to Chat header button. */
	static async #onExportToChat() {
		await this._exportToChat();
	}

	/** Action handler for Show to Players header button. */
	static async #onShowToPlayers() {
		await this._showToPlayers();
	}

	/** Action handler for Set as BG header button. */
	static async #onSetAsBackground() {
		await this._setAsBackground();
	}

	/** Action handler for Import Scene header button. */
	static async #onImportScene() {
		await this._importScene();
	}

	/** Action handler for Add as Tile header button. */
	static async #onAddAsTile() {
		await this._addAsTile();
	}

	/** Action handler for Save Map State header button. */
	static async #onSaveMapState() {
		ui.notifications.info("To save the map state, Right-Click the map, go to Export as -> JSON. The state will silently save to the server instead of downloading.", { permanent: true });
	}

	_getMapIdFromQuery() {
		try {
			const params = new URLSearchParams(this._queryString);
			const seed = params.get("seed") || "noseed";
			const name = params.get("name") || "noname";
			return `${this._mapType}_${seed}_${name}`.replace(/[^a-zA-Z0-9_\-]/g, "");
		}
		catch(e) {
			return `unknown_${Date.now()}`;
		}
	}

	_installIframeSaveHook(iframe) {
		try {
			const cw = iframe?.contentWindow;
			if (!cw || typeof cw.saveAs !== "function" || cw.saveAs.__sdxFoundrySaveAs) return false;

			const originalSaveAs = cw.saveAs;
			const app = this;
			const foundrySaveAs = function(blob, filename, ...rest) {
				if (filename) {
					if (filename.endsWith(".json") || filename.endsWith(".pb")) {
						void app._onMessage({ data: { type: "maphub_save_json", blob, filename } });
						return;
					}
					if (filename.endsWith(".png")) {
						void app._onMessage({ data: { type: "maphub_save_image", blob, filename, format: "png" } });
						return;
					}
					if (filename.endsWith(".svg")) {
						void app._onMessage({ data: { type: "maphub_save_image", blob, filename, format: "svg" } });
						return;
					}
				}
				return originalSaveAs.call(this, blob, filename, ...rest);
			};
			foundrySaveAs.__sdxFoundrySaveAs = true;
			cw.saveAs = foundrySaveAs;
			return true;
		}
		catch(err) {
			console.warn(`${MODULE_ID} | Failed to install Maphub save hook`, err);
			return false;
		}
	}

	async _onMessage(event) {
		if (event.data && event.data.type === "maphub_save_json") {
			const { blob, filename } = event.data;

			const mapId = this._getMapIdFromQuery();
			const saveFilename = `maphub_${mapId}.json`;
			const uploadPath = "maps/maphub";

			try {
				await FilePicker.createDirectory("data", "maps").catch(() => { });
				await FilePicker.createDirectory("data", uploadPath).catch(() => { });

				const jsonText = typeof blob?.text === "function" ? await blob.text() : String(blob ?? "");
				if (this._mapType === "dungeon" && filename.endsWith(".json")) {
					this._lastSavedDungeonJson = JSON.parse(jsonText);
					this._lastSavedDungeonJsonAt = Date.now();
				}
				const file = new File([jsonText], saveFilename, { type: "application/json" });
				const response = await FilePicker.upload("data", uploadPath, file, {});
				if (response?.path) {
					ui.notifications.info(`Map state saved to ${saveFilename}!`);
				}
				else {
					ui.notifications.error("Failed to upload map state.");
				}
			}
			catch(e) {
				console.error(`${MODULE_ID} | Failed to save map state`, e);
				ui.notifications.error("Failed to upload map state.");
			}
		}
		else if (event.data && event.data.type === "maphub_save_image") {
			const { blob, filename, format } = event.data;

			const mapId = this._getMapIdFromQuery();
			const timestamp = Date.now();
			const saveFilename = `maphub_${mapId}_${timestamp}.${format}`;
			const uploadPath = "maps/maphub";

			try {
				await FilePicker.createDirectory("data", "maps").catch(() => { });
				await FilePicker.createDirectory("data", uploadPath).catch(() => { });

				let fileBlob = blob;
				if (typeof blob === "string") {
					fileBlob = new Blob([blob], { type: format === "svg" ? "image/svg+xml" : "image/png" });
				}

				const file = new File([fileBlob], saveFilename, { type: format === "svg" ? "image/svg+xml" : "image/png" });
				const response = await FilePicker.upload("data", uploadPath, file, {});
				if (response?.path) {
					if (this._pendingCaptureResolve) {
						this._pendingCaptureResolve(response.path);
						this._pendingCaptureResolve = null;
					}
					else {
						ui.notifications.info(`Image saved to ${saveFilename}!`);
					}
				}
				else {
					if (this._pendingCaptureResolve) {
						this._pendingCaptureResolve(null);
						this._pendingCaptureResolve = null;
					}
					ui.notifications.error("Failed to upload map image.");
				}
			}
			catch(e) {
				console.error(`${MODULE_ID} | Failed to save map image`, e);
				if (this._pendingCaptureResolve) {
					this._pendingCaptureResolve(null);
					this._pendingCaptureResolve = null;
				}
				ui.notifications.error("Failed to upload map image.");
			}
		}
	}

	// ── Export and Share ──────────────────────────────────────────────────────

	/**
	 * Common helper to capture the canvas, convert to PNG, and upload.
	 * Returns the uploaded file path, or null on failure.
	 */
	async _captureAndUploadMap() {
		const iframe = this._iframe;
		if (!iframe) {
			ui.notifications.warn("Map not loaded yet.");
			return null;
		}

		const cw = iframe.contentWindow;

		let exportFn = null;
		if (cw?.maphubVillageAppInstance?.view?.exportPNG) {
			exportFn = () => cw.maphubVillageAppInstance.view.exportPNG();
		}
		else if (cw?.maphubCaveAppInstance?.exportPNG) {
			exportFn = () => cw.maphubCaveAppInstance.exportPNG();
		}
		else if (cw?.maphubDwellingsAppInstance?.exportAsPNG) {
			// Note: Dwellings might not have a working exportAsPNG natively, but we hook it if it does
			exportFn = () => cw.maphubDwellingsAppInstance.exportAsPNG();
		}
		else if (cw?.maphubAppInstance?.asPNG) { // MFCG
			exportFn = () => cw.maphubAppInstance.asPNG();
		}

		if (exportFn) {
			ui.notifications.info("Generating high-resolution map...");
			return new Promise(resolve => {
				this._pendingCaptureResolve = resolve;
				try {
					exportFn();
				}
				catch(e) {
					console.error("Failed to run high-res export", e);
					this._pendingCaptureResolve = null;
					resolve(null);
				}
				// 15 second timeout to prevent hanging if the generator fails silently
				setTimeout(() => {
					if (this._pendingCaptureResolve === resolve) {
						ui.notifications.error("High-res export timed out.");
						this._pendingCaptureResolve = null;
						resolve(null);
					}
				}, 15000);
			});
		}

		let canvas;
		try {
			canvas = iframe.contentDocument?.querySelector("canvas");
		}
		catch(e) {
			ui.notifications.error("Cannot access map canvas (cross-origin).");
			return null;
		}
		if (!canvas) {
			ui.notifications.warn("No canvas found in the map viewer.");
			return null;
		}

		ui.notifications.info("Capturing map...");

		try {
			const blob = await new Promise((resolve, reject) => {
				canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
			});

			const timestamp = Date.now();
			const genType = this._mapType || "map";
			const filename = `${genType}_${timestamp}.png`;
			const uploadPath = "maps/maphub";

			// Foundry's createDirectory isn't recursive, so we create parent first
			await FilePicker.createDirectory("data", "maps").catch(() => { });
			await FilePicker.createDirectory("data", uploadPath).catch(() => { });

			const file = new File([blob], filename, { type: "image/png" });
			const response = await FilePicker.upload("data", uploadPath, file, {});
			if (!response?.path) {
				ui.notifications.error("Failed to upload map image.");
				return null;
			}
			return response.path;
		}
		catch(e) {
			console.error(`${MODULE_ID} | Map capture failed:`, e);
			ui.notifications.error(`Capture failed: ${e.message}`);
			return null;
		}
	}

	/** Export to chat. */
	async _exportToChat() {
		const imgPath = await this._captureAndUploadMap();
		if (!imgPath) return;

		try {
			await ChatMessage.create({
				content: `<div style="text-align:center;">
					<p><strong>🗺️ ${this._getMapLabel()}</strong></p>
					<img src="${imgPath}" style="max-width:100%;border-radius:6px;border:1px solid #555;" />
				</div>`,
				speaker: ChatMessage.getSpeaker(),
			});
			ui.notifications.info("Map exported to chat!");
		}
		catch(e) {
			ui.notifications.error("Failed to create chat message.");
		}
	}

	/** Show image to players using ImagePopout. */
	async _showToPlayers() {
		const imgPath = await this._captureAndUploadMap();
		if (!imgPath) return;

		try {
			const ip = new ImagePopout(imgPath, { title: this._getMapLabel() });
			ip.render(true);
			ip.shareImage();
			ui.notifications.info("Map shared with players!");
		}
		catch(e) {
			ui.notifications.error("Failed to share image.");
		}
	}

	/** Capture the current Maphub generator output and create a new Foundry scene. */
	async _importScene() {
		if (!game.user.isGM) return;

		const isDwellings = this._mapType === "dwellings";
		const isCave = this._mapType === "cave";
		const isDungeon = this._mapType === "dungeon";
		// For One Page Dungeon, automatically export the current JSON so the
		// wall data always matches the map image. Pressing 'J' triggers
		// Bb.exportJSON inside the generator which flows through our saveAs
		// hook → _lastSavedDungeonJson.
		if (isDungeon) {
			const exported = await this._exportCurrentDungeonJson();
			if (!exported) {
				ui.notifications.warn("Could not export dungeon JSON. Make sure the One Page Dungeon generator is fully loaded before Import Scene.");
				return;
			}
		}
		// Dwelling: build a v14 multi-level scene (one elevation Level per floor,
		// per-floor walls, changeLevel stair regions). Falls through to the generic
		// image import only if the live generator controller isn't reachable.
		if (isDwellings) {
			const handled = await this._importDwellingScene();
			if (handled) return;
		}
		await this._dismissGeneratorContextMenu();
		const oldState = await this._maximizeForCapture();
		// Force the dungeon to render axis-aligned before capture so the walls
		// AND Foundry's grid line up. Auto-rotation otherwise tilts the map by
		// an arbitrary angle to fit the page.
		if (isDungeon) await this._forceDungeonAxisAligned();
		const imgPath = await this._captureAndUploadMap();
		if (!imgPath) {
			if (isDwellings) this._restoreAfterCapture(oldState);
			return;
		}

		try {
			const sceneName = `${this._getMapLabel()} ${new Date().toLocaleString()}`;
			let grid = this._getImportGridSize();

			let walls = [];
			let notes = [];
			let dungeonTransform = null;
			let importImg = imgPath;          // background to use (may be rescaled)
			let importW = null; let importH = null;

			// Exact grid alignment for Dungeon + Cave.
			//
			// Foundry's scene grid is anchored at canvas (0,0) and its lines fall
			// at integer multiples of grid.size (an integer). The generator draws
			// cells at a NON-integer pixel size, so rounding grid.size leaves the
			// grid drifting a fraction of a cell — the "slightly off" the user saw.
			//
			// Fix: rescale the captured image by f = round(cellPx)/cellPx so one
			// cell becomes EXACTLY gridPx pixels (no drift), then crop it by the
			// sub-cell phase so the generator's cell-zero edge lands on (0,0). The
			// walls/notes go through the same scale+crop. Result: Foundry's default
			// grid coincides with the map's cells with no offset fields at all.
			//
			// `align` carries the per-generator render mapping; `mapPx` applies the
			// scale+crop to any captured-canvas pixel.
			let mapPx = (x, y) => ({ x: Math.round(x), y: Math.round(y) });
			let align = null;
			if (isDungeon) {
				dungeonTransform = this._getDungeonTransform();
				if (!dungeonTransform) {
					throw new Error("One Page Dungeon render transform was not available. Reopen the generator (bundled local files) and try again.");
				}
				// The render transform (toPixel/cellPx) is in CSS/stage px, but the captured
				// PNG is the canvas BACKING store (× devicePixelRatio). Scale to backing px so
				// the walls match the image instead of coming out 1/dpr too small and offset.
				// (Same HiDPI correction Cartomancer applies; SDX only had it on the
				// dwelling floor-warp path before.)
				const srcCanvas = this._iframe?.contentDocument?.querySelector("canvas");
				const dpr = (srcCanvas && srcCanvas.clientWidth > 0)
					? (srcCanvas.width / srcCanvas.clientWidth)
					: (this._iframe?.contentWindow?.devicePixelRatio || 1);
				const Tcss = dungeonTransform.toPixel;
				const toBacking = (gx, gy) => {
					const p = Tcss(gx, gy);
					return { x: p.x * dpr, y: p.y * dpr };
				};
				// Cell-zero edge sits at canvas toPixel(0,0) == (M.tx, M.ty).
				align = {
					toPixel: toBacking,
					cellPx: dungeonTransform.cellPx * dpr,
					origin: toBacking(0, 0),
				};
			}
			else if (isCave) {
				const ca = this._getCaveAlignSource();
				if (ca) {
					// Same HiDPI correction as the dungeon: the cave render transform is in
					// CSS/stage px, but the captured PNG is the backing store (× dpr).
					const cc = this._iframe?.contentDocument?.querySelector("canvas");
					const caveDpr = (cc && cc.clientWidth > 0)
						? (cc.width / cc.clientWidth)
						: (this._iframe?.contentWindow?.devicePixelRatio || 1);
					align = {
						toPixel: ca.toPixel,
						cellPx: ca.cellPx * caveDpr,
						origin: { x: ca.origin.x * caveDpr, y: ca.origin.y * caveDpr },
					};
					this._caveWallDpr = caveDpr;
				}
			}

			if (align && align.cellPx > 0) {
				// Normalize to a usable Foundry grid size. The generator's raw rendered
				// cell px can be tiny (a small "Grid > Size" in Cave, "Small tiles" in
				// Dungeon) — using it directly gave microscopic tokens and forced the
				// user to retune Grid Size + Scene Scale. The image is rescaled by
				// f = gridPx/cellPx below, so one generator cell still maps to exactly
				// one Foundry square — just at a sensible on-screen size.
				const gridPx = this._normalizeGridPx(align.cellPx);
				const f = gridPx / align.cellPx;
				const phase = v => (((Math.round(v) % gridPx) + gridPx) % gridPx);
				const shiftX = phase(align.origin.x * f);
				const shiftY = phase(align.origin.y * f);
				const aligned = await this._renderAlignedImage(imgPath, f, shiftX, shiftY);
				importImg = aligned.path; importW = aligned.width; importH = aligned.height;
				grid = gridPx;
				mapPx = (x, y) => ({ x: Math.round(x * f - shiftX), y: Math.round(y * f - shiftY) });
			}

			let scene = await this._createImageScene({ name: sceneName, img: importImg, grid, width: importW, height: importH });

			if (isDungeon) {
				try {
					const parsed = OnePageParserSD.parseDungeonData(this._lastSavedDungeonJson, 1, { gridSpace: true });
					// Use the dpr-scaled transform (backing px) so walls/notes match the captured image.
					const T = align?.toPixel ?? dungeonTransform.toPixel;
					walls = (parsed.walls || []).map(w => {
						const t0 = T(w.c[0], w.c[1]); const a = mapPx(t0.x, t0.y);
						const t1 = T(w.c[2], w.c[3]); const b = mapPx(t1.x, t1.y);
						return { ...w, c: [a.x, a.y, b.x, b.y] };
					});
					notes = (parsed.notes || []).map(n => {
						const p = T(n.x, n.y);
						const m = mapPx(p.x, p.y);
						return { ...n, x: m.x, y: m.y };
					});
				}
				catch(e) {
					console.warn("Could not parse current Dungeon JSON for import", e);
				}
			}
			else if (isDwellings) {
				walls = this._getDwellingsWalls({ width: scene.width, height: scene.height, grid });
			}
			else if (isCave) {
				// _getCaveWalls returns CSS px; scale to backing (× dpr) to match the image, then mapPx.
				const cwDpr = this._caveWallDpr || 1;
				walls = this._getCaveWalls().map(w => {
					const a = mapPx(w.c[0] * cwDpr, w.c[1] * cwDpr);
					const b = mapPx(w.c[2] * cwDpr, w.c[3] * cwDpr);
					return { ...w, c: [a.x, a.y, b.x, b.y] };
				});
			}

			if (walls.length) {
				await scene.createEmbeddedDocuments("Wall", walls);
			}
			if (notes.length) {
				await scene.createEmbeddedDocuments("Note", notes);
			}

			const wallNote = walls.length ? ` with ${walls.length} walls/doors` : "";
			const notesNote = notes.length ? ` and ${notes.length} notes` : "";
			ui.notifications.info(`Imported ${scene?.name ?? "map"} as a Foundry scene${wallNote}${notesNote}.`);
			this.close();
		}
		catch(e) {
			console.error(`${MODULE_ID} | Failed to import Maphub scene`, e);
			ui.notifications.error(`Failed to import scene: ${e.message}`);
			if (isDwellings) this._restoreAfterCapture(oldState);
		}
	}

	/** Live raw-Dwellings view controller (Dwellings.js is patched to expose it). */
	_getDwellView() {
		try {
			return this._iframe?.contentWindow?.__sdxDwellView ?? null;
		}
		catch(_) {
			return null;
		}
	}

	/**
	 * Show/hide the dwelling generator's UI layer (the corner menu, floor
	 * indicators, and name label) — a `coogee.ui.View` sibling of the map on the
	 * OpenFL stage. Hidden during capture so only the building is baked into the
	 * scene image. Uses the OpenFL setter (a plain `.visible=` is ignored by the
	 * renderer). Returns the layer, or null if not found.
	 */
	_setDwellUiVisible(view, visible) {
		try {
			const stage = view?.parent;
			const layer = (stage?.__children || []).find(k => /coogee\.ui\.View/.test(k?.__class__?.__name__ || k?.constructor?.name || ""));
			if (!layer) return null;
			if (typeof layer.set_visible === "function") layer.set_visible(visible);
			layer.__visible = visible;
			try {
				layer.visible = visible;
			}
			catch(_) { }
			return layer;
		}
		catch(_) {
			return null;
		}
	}

	/** Snapshot the generator's live canvas to an offscreen canvas (or null). */
	_grabCanvas() {
		try {
			const canvas = this._iframe?.contentDocument?.querySelector("canvas");
			if (!canvas) return null;
			const off = document.createElement("canvas");
			off.width = canvas.width; off.height = canvas.height;
			off.getContext("2d").drawImage(canvas, 0, 0);
			return off;
		}
		catch(_) {
			return null;
		}
	}

	/** Upload an offscreen canvas as a PNG under maps/maphub; returns its path. */
	async _uploadCanvas(off, filename) {
		try {
			const blob = await new Promise(r => off.toBlob(r, "image/png"));
			const FP = foundry.applications.apps.FilePicker?.implementation ?? FilePicker;
			await FP.createDirectory("data", "maps").catch(() => { });
			await FP.createDirectory("data", "maps/maphub").catch(() => { });
			const resp = await FP.upload("data", "maps/maphub", new File([blob], filename, { type: "image/png" }), {});
			return resp?.path || null;
		}
		catch(e) {
			console.warn(`${MODULE_ID} | dwelling upload failed`, e); return null;
		}
	}

	/**
	 * Detect the building's pixel bounding box in a captured floor image — the
	 * non-background (non-parchment) extent. Background is sampled from the
	 * top-left pixel (always parchment once the UI layer is hidden). Returns
	 * { x0, y0, x1, y1, w, h, bg } or null if nothing stands out.
	 */
	_detectBuildingBBox(off, threshold = 35) {
		try {
			const ctx = off.getContext("2d");
			const d = ctx.getImageData(0, 0, off.width, off.height).data;
			const bg = [d[0], d[1], d[2]];
			let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
			for (let y = 0; y < off.height; y += 2) for (let x = 0; x < off.width; x += 2) {
				const i = (y * off.width + x) * 4;
				if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > threshold) {
					if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
				}
			}
			if (!Number.isFinite(x0)) return null;
			return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, bg };
		}
		catch(_) {
			return null;
		}
	}

	/**
	 * Warp a captured floor canvas into the shared building grid so building-cell
	 * (j,i) lands at nodeToScene(j,i) — the same place the walls go. The captured
	 * transform `M` maps node→capture px (canvasPx = M.node), so the node region
	 * [mj..Mj]x[mi..Mi] is the source sub-rect to map onto the whole scene. `M` was
	 * read in the same frame as `off`, so they agree even mid-animation. Returns the
	 * uploaded scene-sized image path (used as the Level background).
	 */
	async _warpFloorImage(off, M, mj, mi, Mj, Mi, sceneW, sceneH, dpr = 1) {
		try {
			const out = document.createElement("canvas");
			out.width = sceneW; out.height = sceneH;
			const ctx = out.getContext("2d");
			// Parchment fill (top-left of the capture is parchment once the UI is hidden),
			// so any source area outside the captured canvas reads as parchment.
			try {
				const d = off.getContext("2d").getImageData(0, 0, 1, 1).data;
				ctx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`;
				ctx.fillRect(0, 0, sceneW, sceneH);
			}
			catch(_) { }
			// M maps node -> stage(CSS) px, but `off` is the canvas BACKING store (HiDPI:
			// backing = CSS * devicePixelRatio). Read the node region in BACKING px by
			// scaling M by dpr — otherwise the source rect is undersized and the floor
			// image lands shifted/clipped and out of register with the (grid-space) walls.
			const srcX = (M.a * mj + M.tx) * dpr; const srcY = (M.d * mi + M.ty) * dpr;
			const srcW = (Mj - mj) * M.a * dpr; const srcH = (Mi - mi) * M.d * dpr;
			ctx.drawImage(off, srcX, srcY, srcW, srcH, 0, 0, sceneW, sceneH);
			return await this._uploadCanvas(out, `dwellfloor_${Date.now()}.png`);
		}
		catch(e) {
			console.warn(`${MODULE_ID} | dwelling warp failed`, e); return null;
		}
	}

	/**
	 * Import a dwelling as a single v14 multi-level scene: one elevation Level per
	 * floor, each floor's map as a Level-scoped Tile, per-floor walls, and a
	 * changeLevel Region at every staircase bridging the two floors it connects.
	 * Returns true when handled (so _importScene skips the generic image path),
	 * false only when the controller isn't reachable (→ generic image fallback).
	 */
	async _importDwellingScene() {
		const view = this._getDwellView();
		const floors = view?.house?.floors;
		if (!view || !Array.isArray(floors) || !floors.length || typeof view.setFloor !== "function") return false;

		try {
			const LH = 10; // ft per level
			const ordinal = k => {
				const v = k % 100; const sfx = (v >= 11 && v <= 13) ? "th" : (["th", "st", "nd", "rd"][k % 10] || "th"); return `${k}${sfx}`;
			};
			// Levels to import, bottom -> top: basement (if any), ground, then upper floors.
			const units = [];
			if (view.house.basement) units.push({ floor: view.house.basement, setIdx: -1, name: "Basement", isGround: false });
			floors.forEach((f, i) => units.push({ floor: f, setIdx: i, name: i === 0 ? "Ground Floor" : `${ordinal(i)} Floor`, isGround: i === 0 }));
			const baseIdx = view.house.basement ? 1 : 0; // index of the ground floor within units
			units.forEach((u, k) => {
				u.bottom = (k - baseIdx) * LH; u.top = u.bottom + LH;
			});
			ui.notifications.info(`Importing dwelling — ${units.length} level${units.length === 1 ? "" : "s"}…`);

			// 1. Capture each level + its render transform FROM THE SAME FRAME. setFloor
			// animates the fit and the WebGL buffer can go blank once it settles, so retry
			// (re-triggering each time) until a non-blank frame; reading transform + pixels
			// back-to-back (no await between) keeps them on the same frame so the warp lines
			// the image up with the walls regardless of the animation state.
			for (const u of units) {
				let M = null; let off = null;
				for (let attempt = 0; attempt < 14 && !off; attempt++) {
					view.setFloor(u.setIdx);
					this._setDwellUiVisible(view, false);
					// Nudge OpenFL/Lime to repaint — the WebGL buffer can stay blank
					// mid-fit or when the window isn't focused, which otherwise drops the
					// whole dwelling to the flat generic fallback.
					if (attempt > 0) {
						try {
							this._iframe?.contentWindow?.dispatchEvent(new Event("resize"));
						}
						catch(_) { }
					}
					await new Promise(r => setTimeout(r, attempt === 0 ? 900 : 350));
					const m = view.map.__getRenderTransform();
					const cap = this._grabCanvas();
					if (!m || !Number.isFinite(m.a) || !m.a || !cap) continue;
					const b = this._detectBuildingBBox(cap);
					if (b && b.w > 20 && b.h > 20) {
						M = { a: m.a, b: m.b, c: m.c, d: m.d, tx: m.tx, ty: m.ty }; off = cap;
					}
				}
				if (!off) return false;
				u.M = M; u.off = off;
			}

			// 2. Shared building grid from every level's geometry (contour + rooms), node
			// coords (x = node.j, y = node.i), plus a fixed roof/outer-wall margin. Shared
			// by ALL levels so they stack.
			let cmi = Infinity; let cmj = Infinity; let cMi = -Infinity; let cMj = -Infinity;
			const accNode = edges => {
				for (const e of (edges || [])) for (const nd of [e?.a, e?.b]) {
					if (!nd) continue; cmi = Math.min(cmi, nd.i); cMi = Math.max(cMi, nd.i); cmj = Math.min(cmj, nd.j); cMj = Math.max(cMj, nd.j);
				}
			};
			for (const u of units) {
				accNode(u.floor.contour); for (const rm of (u.floor.rooms || [])) accNode(rm.contour);
			}
			if (!Number.isFinite(cmi)) return false;
			const ROOF = 2;
			const mi = Math.floor(cmi - ROOF); const mj = Math.floor(cmj - ROOF); const Mi = Math.ceil(cMi + ROOF); const Mj = Math.ceil(cMj + ROOF);
			const cellsW = Math.max(1, Mj - mj); const cellsH = Math.max(1, Mi - mi);
			const gridPx = Math.max(60, Math.min(160, Math.round(units[baseIdx].M.a * 1.8)));
			const sceneW = Math.round(cellsW * gridPx);
			const sceneH = Math.round(cellsH * gridPx);
			const nodeToScene = (j, i) => ({ x: Math.round((j - mj) * gridPx), y: Math.round((i - mi) * gridPx) });

			// 2b. Warp each level's capture into the shared grid (cell (j,i) -> nodeToScene).
			// The captures are the canvas BACKING store (HiDPI), so pass the
			// backing/CSS ratio so the warp samples the right region.
			const srcCanvas = this._iframe?.contentDocument?.querySelector("canvas");
			const dpr = (srcCanvas && srcCanvas.clientWidth > 0) ? (srcCanvas.width / srcCanvas.clientWidth) : (this._iframe?.contentWindow?.devicePixelRatio || 1);
			for (const u of units) {
				u.bg = await this._warpFloorImage(u.off, u.M, mj, mi, Mj, Mi, sceneW, sceneH, dpr);
				if (!u.bg) return false;
			}

			// 3. Scene with a named elevation Level per unit, each its OWN background image
			// (fit:"fill" — Foundry fills/centres it in the scene rect). One scene, many levels.
			const sceneName = `${this._getMapLabel()} ${new Date().toLocaleString()}`;
			const levelBg = src => ({ src, color: "#000000", tint: "#ffffff", alphaThreshold: 0 });
			const fillTex = { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: "fill", scaleX: 1, scaleY: 1, rotation: 0 };
			const sceneData = {
				name: sceneName, width: sceneW, height: sceneH,
				grid: { size: gridPx }, padding: 0, backgroundColor: "#000000",
				fogExploration: true, tokenVision: true,
				background: { src: units[baseIdx].bg },
				levels: units.map(u => ({ name: u.name, elevation: { bottom: u.bottom, top: u.top }, background: levelBg(u.bg), textures: fillTex })),
			};
			const scene = await Scene.create(sceneData);
			await scene.activate();
			units.forEach((u, k) => {
				u.level = scene.levels.find(l => (l.elevation?.bottom ?? null) === u.bottom) ?? scene.levels.contents[k];
			});

			// 4. Per-level walls (with doors). Entrance door only on the ground floor.
			let wallTotal = 0;
			for (const u of units) {
				const walls = this._buildDwellWalls(u.floor, nodeToScene, { id: u.level.id, bottom: u.bottom, top: u.top, isGround: u.isGround });
				if (walls.length) {
					await scene.createEmbeddedDocuments("Wall", walls); wallTotal += walls.length;
				}
			}

			// 5. Stairs as changeLevel Regions, using the generator's OWN connectivity:
			// each stair knows its cell and the floor it connects to (s.to.plan). A cell
			// with both up- and down-stairs yields two regions (one per pair). Dedupe by
			// cell + the level pair it bridges.
			const floorToUnit = new Map(units.map(u => [u.floor, u]));
			const regionByKey = new Map();
			const addStairRegion = (cell, uA, uB) => {
				if (!cell || typeof cell.i !== "number" || !uA || !uB || uA === uB) return;
				const lo = uA.bottom <= uB.bottom ? uA : uB; const hi = uA.bottom <= uB.bottom ? uB : uA;
				const key = `${cell.i},${cell.j}|${lo.bottom}|${hi.bottom}`;
				if (regionByKey.has(key)) return;
				const cc = nodeToScene(cell.j + 0.5, cell.i + 0.5);
				regionByKey.set(key, {
					name: `Stairs: ${lo.name} ↔ ${hi.name}`,
					color: "#28c9cc",
					shapes: [{ type: "rectangle", x: cc.x - gridPx / 2, y: cc.y - gridPx / 2, width: gridPx, height: gridPx, hole: false }],
					elevation: { bottom: lo.bottom, top: hi.top, topInclusive: false },
					levels: [lo.level.id, hi.level.id],
					visibility: 1, locked: false,
					behaviors: [{ name: "Change Level", type: "changeLevel", system: { movementActions: [] } }],
				});
			};
				// Regular stairs: each stair's cell bridges its floor and s.to.plan's floor.
			for (const u of units) for (const s of (u.floor.stairs || [])) {
				const other = s?.to?.plan ? floorToUnit.get(s.to.plan) : null;
				if (other) addStairRegion(s.cell, u, other);
			}
			// Spiral tower: one shared shaft connecting every above-ground floor at a single
			// cell. A MIDDLE floor can go both up AND down from it, which the default
			// changeLevel region can't express cleanly (stacked regions = duelling
			// prompts). Use ONE region spanning all the spiral's levels with a custom
			// up/down chooser (executeScript) instead.
			try {
				const spObj = (view.house.floors || []).map(f => f?.spiral).find(Boolean);
				const sp = spObj?.landing;
				const fu = units.filter(u => u.setIdx >= 0).sort((a, b) => a.bottom - b.bottom);
				if (sp && typeof sp.i === "number" && fu.length >= 2) {
					const conn = fu.map(u => ({ name: u.name, bottom: u.bottom, id: u.level.id }));
					// Place the region ON the spiral shaft — the tower cell diagonally
					// opposite the landing across the corner — so a token must stand on the
					// stairs to use them.
					let cell = sp;
					try {
						const C = [spObj.entrance.a, spObj.entrance.b].find(n1 => [spObj.exit.a, spObj.exit.b].some(n2 => n2 && n1 && n2.i === n1.i && n2.j === n1.j));
						if (C) cell = { i: 2 * C.i - 1 - sp.i, j: 2 * C.j - 1 - sp.j };
					}
					catch(_) { }
					const cc = nodeToScene(cell.j + 0.5, cell.i + 0.5);
					regionByKey.set(`spiral|${sp.i},${sp.j}`, {
						name: "Spiral Staircase",
						color: "#28c9cc",
						shapes: [{ type: "rectangle", x: cc.x - gridPx / 2, y: cc.y - gridPx / 2, width: gridPx, height: gridPx, hole: false }],
						elevation: { bottom: fu[0].bottom, top: fu[fu.length - 1].top, topInclusive: false },
						levels: fu.map(u => u.level.id),
						visibility: 1, locked: false,
						flags: { [MODULE_ID]: { spiral: conn } },
						behaviors: [{ name: "Spiral Up/Down", type: "executeScript", system: { events: ["tokenMoveIn"], source: this._spiralRegionScript() } }],
					});
				}
			}
			catch(_) { }
			const regions = [...regionByKey.values()];
			if (regions.length) await scene.createEmbeddedDocuments("Region", regions);

			ui.notifications.info(`Imported ${scene.name} — ${units.length} levels, ${wallTotal} walls, ${regions.length} stairs.`);
			this.close();
			return true;
		}
		catch(err) {
			console.error(`${MODULE_ID} | Multi-level dwelling import failed`, err);
			ui.notifications.error(`Multi-level dwelling import failed: ${err.message}`);
			return true; // handled (don't fall through to a second import)
		}
		finally {
			// Restore the generator's UI so it stays usable if the window is open.
			this._setDwellUiVisible(view, true);
		}
	}

	/**
	 * Source for the spiral-staircase region behavior (executeScript, tokenMoveIn).
	 * On entry it reads the connected level elevations from the region flags, finds
	 * which are above/below the token, and prompts Up / Down / Stay — so a middle
	 * floor (both directions from one shaft) gets a clean choice instead of duelling
	 * default changeLevel prompts. executeScript scope: (scene, region, behavior, event).
	 */
	_spiralRegionScript() {
		return [
			"if (!event?.user?.isSelf) return;",
			"const t = event?.data?.token; if (!t) return;",
			'const conn = region?.flags?.["shadowdark-extras"]?.spiral;',
			"if (!Array.isArray(conn) || conn.length < 2) return;",
			"const origin = t.level;",
			"const here = conn.find(c => c.id === origin) ?? conn.slice().sort((a,b)=>Math.abs(a.bottom-(t.elevation??0))-Math.abs(b.bottom-(t.elevation??0)))[0];",
			"const cur = here?.bottom ?? (t.elevation ?? 0);",
			"const up = conn.filter(c => c.bottom > cur + 0.5).sort((a,b)=>a.bottom-b.bottom)[0];",
			"const down = conn.filter(c => c.bottom < cur - 0.5).sort((a,b)=>b.bottom-a.bottom)[0];",
			"if (!up && !down) return;",
			"const D = foundry.applications.api.DialogV2;",
			"const btns = [];",
			'if (up) btns.push({ action:"up", label:"Up to " + up.name, default: !down });',
			'if (down) btns.push({ action:"down", label:"Down to " + down.name, default: !up });',
			'btns.push({ action:"stay", label:"Stay" });',
			'let pick = "stay";',
			'try { pick = await D.wait({ window:{ title:"Spiral Staircase" }, content:"<p>Take the spiral staircase?</p>", buttons: btns, modal: true }); } catch (e) { pick = "stay"; }',
			'const dest = pick === "up" ? up : (pick === "down" ? down : null);',
			"if (!dest || dest.id === origin) return;",
			"await t.update({ level: dest.id, elevation: dest.bottom });",
			"try { if (t.parent?.isView && canvas.level?.id === origin) await t.parent.view({ level: dest.id, controlledTokens: [t.id] }); } catch (e) {}",
		].join("\n");
	}

	/** Build wall docs for one dwelling floor (outer contour + room contours), scoped to a Level. */
	_buildDwellWalls(floor, nodeToScene, levelCtx) {
		// Node-edge key, endpoint-order independent — lets us match door edges (from
		// room.doors) against the contour/room-outline edges we turn into walls.
		const ek = (a, b) => {
			const p = [[a.i, a.j], [b.i, b.j]].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
			return `${p[0][0]},${p[0][1]}|${p[1][0]},${p[1][1]}`;
		};
		// Door edges by type. REGULAR = a real door; DOORWAY/NULL = an open passage.
		const doorType = new Map();
		for (const rm of (floor.rooms || [])) {
			let list = [];
			try {
				const it = rm.doors?.iterator?.(); if (it) {
					while (it.hasNext()) list.push(it.next());
				}
				else if (Array.isArray(rm.doors)) list = rm.doors;
			}
			catch(_) { }
			for (const d of list) {
				const e = d?.edge1; if (!e?.a || !e?.b) continue;
				const t = (d.type?.name || d.type?._hx_name || "").toUpperCase();
				doorType.set(ek(e.a, e.b), t || "NULL");
			}
		}
		// Building entrance: a door in the outer wall at the landing cell, on the
		// door's facing side (cell (i,j) edge in the dir's (di,dj) direction). Only the
		// ground floor has the real front door.
		try {
			const L = levelCtx.isGround ? floor.entrance?.landing : null;
			if (L && typeof L.i === "number") {
				// The entrance edge is whichever of the landing cell's four edges lies on
				// the outer contour (robust — no reliance on the door's direction enum).
				const contourKeys = new Set();
				for (const e of (floor.contour || [])) if (e?.a && e?.b) contourKeys.add(ek(e.a, e.b));
				const cand = [
					[{ i: L.i, j: L.j }, { i: L.i, j: L.j + 1 }],
					[{ i: L.i + 1, j: L.j }, { i: L.i + 1, j: L.j + 1 }],
					[{ i: L.i, j: L.j }, { i: L.i + 1, j: L.j }],
					[{ i: L.i, j: L.j + 1 }, { i: L.i + 1, j: L.j + 1 }],
				];
				for (const [a, b] of cand) {
					const k = ek(a, b); if (contourKeys.has(k)) {
						doorType.set(k, "REGULAR"); break;
					}
				}
			}
		}
		catch(_) { }

		// Spiral tower: enclose the round tower (the cells just outside the building
		// around the spiral's corner) and OPEN the contour edges between it and the
		// landing, so the shaft is a walled alcove you can step into. The corner node
		// is shared by the spiral's entrance + exit edges; tower cells are the cells
		// around it that aren't part of the floor.
		const skip = new Set();    // contour edges to leave OPEN (building <-> tower)
		const towerWallEdges = [];  // extra walls enclosing the tower's outer side
		try {
			const sp = floor.spiral;
			if (sp?.entrance && sp?.exit && Array.isArray(floor.area)) {
				const C = [sp.entrance.a, sp.entrance.b].find(n1 => [sp.exit.a, sp.exit.b].some(n2 => n2 && n1 && n2.i === n1.i && n2.j === n1.j));
				if (C) {
					const around = [[C.i - 1, C.j - 1], [C.i - 1, C.j], [C.i, C.j - 1], [C.i, C.j]];
					const areaSet = new Set(floor.area.map(c => `${c.i},${c.j}`));
					const tower = around.filter(([i, j]) => !areaSet.has(`${i},${j}`));
					const towerSet = new Set(tower.map(([i, j]) => `${i},${j}`));
					for (const [ti, tj] of tower) {
						const sides = [
							[{ i: ti, j: tj }, { i: ti, j: tj + 1 }, ti - 1, tj],         // N
							[{ i: ti + 1, j: tj }, { i: ti + 1, j: tj + 1 }, ti + 1, tj], // S
							[{ i: ti, j: tj }, { i: ti + 1, j: tj }, ti, tj - 1],         // W
							[{ i: ti, j: tj + 1 }, { i: ti + 1, j: tj + 1 }, ti, tj + 1], // E
						];
						for (const [a, b, ni, nj] of sides) {
							if (areaSet.has(`${ni},${nj}`)) skip.add(ek(a, b));               // open building <-> tower
							else if (!towerSet.has(`${ni},${nj}`)) towerWallEdges.push([a, b]); // tower outer wall
						}
					}
				}
			}
		}
		catch(_) { }

		const walls = [];
		const used = new Set();
		const add = (a, b) => {
			if (!a || !b) return;
			const nk = ek(a, b);
			if (used.has(nk)) return;
			used.add(nk);
			if (skip.has(nk)) return; // open connection (e.g. building <-> spiral tower)
			const dt = doorType.get(nk);
			if (dt === "DOORWAY" || dt === "NULL") return; // open passage — leave a gap
			const A = nodeToScene(a.j, a.i); const B = nodeToScene(b.j, b.i);
			if (A.x === B.x && A.y === B.y) return;
			const w = { c: [A.x, A.y, B.x, B.y], levels: [levelCtx.id], flags: { "wall-height": { bottom: levelCtx.bottom, top: levelCtx.top } } };
			if (dt === "REGULAR") {
				w.door = 1; w.ds = 0;
			} // closed, openable door
			walls.push(w);
		};
		for (const e of (floor.contour || [])) add(e?.a, e?.b);
		for (const rm of (floor.rooms || [])) for (const e of (rm.contour || [])) add(e?.a, e?.b);
		for (const [a, b] of towerWallEdges) add(a, b); // enclose the spiral tower
		return walls;
	}


	_getDwellingsFloor() {
		const cw = this._iframe?.contentWindow;
		let house = cw?.__maphubClasses?.["dwellings.model.House"]?.inst;
		house ??= cw?.maphubDwellingScene?.house;
		return house?.floors?.[0] ?? null;
	}

	_getDwellingsWalls({ width, height, grid }) {
		const floor = this._getDwellingsFloor();
		if (!floor?.grid || !Array.isArray(floor.contour)) {
			ui.notifications.warn("Dwellings geometry was not available; imported image without walls.");
			return [];
		}

		const widthPx = Number(width) || 0;
		const heightPx = Number(height) || 0;
		const gridSize = Number(grid) || this._getImportGridSize();
		const offsetX = Math.max(0, (widthPx - (floor.grid.w * gridSize)) / 2);
		const offsetY = Math.max(0, (heightPx - (floor.grid.h * gridSize)) / 2);
		const doorType = CONST.WALL_DOOR_TYPES?.DOOR ?? 1;
		const doorClosed = CONST.WALL_DOOR_STATES?.CLOSED ?? 1;
		const walls = [];
		const used = new Set();

		const point = node => ({
			x: Math.round(offsetX + (node.j * gridSize)),
			y: Math.round(offsetY + (node.i * gridSize)),
		});
		const key = edge => {
			const a = point(edge.a);
			const b = point(edge.b);
			return [[a.x, a.y], [b.x, b.y]]
				.sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1])
				.map(p => p.join(","))
				.join("|");
		};
		const wallData = (edge, isDoor = false) => {
			const a = point(edge.a);
			const b = point(edge.b);
			const data = { c: [a.x, a.y, b.x, b.y] };
			if (isDoor) {
				data.door = doorType;
				data.ds = doorClosed;
			}
			return data;
		};
		const add = (edge, isDoor = false) => {
			if (!edge?.a || !edge?.b) return;
			const k = key(edge);
			if (used.has(k)) return;
			used.add(k);
			walls.push(wallData(edge, isDoor));
		};

		const doors = [];
		if (floor.entrance?.door) doors.push(floor.entrance.door);
		if (typeof floor.getDoors === "function") {
			for (const door of floor.getDoors()) {
				doors.push(door.edge1 ?? door.edge2);
			}
		}
		const doorKeys = new Set(doors.filter(Boolean).map(key));
		const outerKeys = new Set(floor.contour.map(key));

		for (const door of doors) add(door, true);
		for (const edge of floor.contour) {
			if (!doorKeys.has(key(edge))) add(edge);
		}
		for (const room of floor.rooms ?? []) {
			for (const edge of room.contour ?? []) {
				const k = key(edge);
				if (outerKeys.has(k) || doorKeys.has(k)) continue;
				add(edge);
			}
		}

		return walls;
	}

	/**
	 * Close the viewer — clean up the cave/dungeon view, then let
	 * ApplicationV2 tear down. (Phase 5.1 split: super.close must live
	 * in the class body — mixin object methods can't resolve super.)
	 */
	async close(options) {
		this._cleanupCaveView();
		return super.close(options);
	}

}

import { caveMixin } from "./maphub-cave.mjs";
// Merge the cave/dungeon cluster into the prototype (Phase 5.1 split).
Object.assign(MaphubViewerApp.prototype, caveMixin);
