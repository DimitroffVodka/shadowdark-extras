/**
 * TileFlattenSD — Flatten multiple selected tiles into a single tile or scene background.
 * Adds a "Flatten" button to the Tile HUD when 2+ tiles are controlled.
 * Adds an "Unflatten" button to the Tile HUD for tiles created by this module.
 *
 * Capabilities:
 * - Flatten: Renders 2+ tiles to a WebP image.
 * - Unflatten: Restores original tiles from data stored in the flattened tile's flags.
 */

const MODULE_ID = "shadowdark-extras";
const FLATTEN_ACTION = "sdx-flatten-tiles";
const UNFLATTEN_ACTION = "sdx-unflatten-tiles";
const UPLOAD_DIR = "flattened-tiles";
const HEX_BACKGROUND_MAX_SIZE = 8192;

// ─── Utility helpers ─────────────────────────────────────────────────────────

/** Wait one animation frame. Races requestAnimationFrame against a short timer
 *  so the bake never hangs when the tab is backgrounded (rAF is paused while
 *  document.hidden, which would otherwise stall the render mid-flatten). */
function nextFrame() {
	return new Promise(resolve => {
		let done = false;
		const finish = () => {
			if (!done) {
				done = true; resolve();
			}
		};
		try {
			requestAnimationFrame(finish);
		}
		catch(_) { /* fall through to timer */ }
		setTimeout(finish, 50);
	});
}

/** Get controlled tile documents from the tiles layer */
function getControlledTiles() {
	const layer = canvas?.tiles;
	if (!layer) return [];
	const controlled = Array.isArray(layer.controlled) ? layer.controlled : [];
	const docs = [];
	const seen = new Set();
	for (const placeable of controlled) {
		const doc = placeable?.document;
		const id = doc?.id;
		if (!doc || !id || seen.has(id)) continue;
		docs.push(doc);
		seen.add(id);
	}
	return docs;
}

// ─── Bounds ──────────────────────────────────────────────────────────────────

function computeBounds(tiles) {
	if (!tiles?.length) return null;
	let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;

	for (const doc of tiles) {
		const x = Number(doc.x) || 0;
		const y = Number(doc.y) || 0;
		// Tiles carry width/height directly; Drawings carry them under shape.
		const w = Number(doc.shape?.width ?? doc.width) || 0;
		const h = Number(doc.shape?.height ?? doc.height) || 0;
		const rot = Number(doc.rotation) || 0;

		if (rot !== 0) {
			const rad = rot * (Math.PI / 180);
			const cos = Math.cos(rad);
			const sin = Math.sin(rad);
			const cx = x + (w / 2);
			const cy = y + (h / 2);
			const corners = [
				{ x, y },
				{ x: x + w, y },
				{ x: x + w, y: y + h },
				{ x, y: y + h },
			];
			for (const c of corners) {
				const dx = c.x - cx;
				const dy = c.y - cy;
				const rx = cx + (dx * cos) - (dy * sin);
				const ry = cy + (dx * sin) + (dy * cos);
				minX = Math.min(minX, rx);
				minY = Math.min(minY, ry);
				maxX = Math.max(maxX, rx);
				maxY = Math.max(maxY, ry);
			}
		}
		else {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x + w);
			maxY = Math.max(maxY, y + h);
		}
	}

	if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function getMaxTextureSize(renderer) {
	const gl = renderer?.gl || renderer?.context?.gl;
	return gl?.getParameter?.(gl.MAX_TEXTURE_SIZE) ?? HEX_BACKGROUND_MAX_SIZE;
}

// ─── Visibility isolation ────────────────────────────────────────────────────

function isolateVisibility(docs, bounds, mapPathIds = []) {
	const selectedIds = new Set(docs.map(d => d.id).filter(Boolean));
	const selectedPathIds = new Set(mapPathIds);
	const hidden = [];

	const hide = obj => {
		if (!obj || obj.visible === false) return;
		hidden.push({ obj, visible: obj.visible });
		obj.visible = false;
	};

	const drawingsLayer = canvas?.drawings ?? null;
	const drawingTool = game?.shadowdarkExtras?.drawingTool;
	const pathLayer = drawingTool?.canvasLayer ?? null;
	const selectedPathGraphics = new Set((drawingTool?._permanentDrawings ?? [])
		.filter(drawing => selectedPathIds.has(drawing.id))
		.map(drawing => drawing.graphics));
	if (selectedPathGraphics.size !== selectedPathIds.size) {
		throw new Error("Could not find every Road/River overlay to bake");
	}

	for (const p of (canvas?.tiles?.placeables ?? [])) {
		const doc = p?.document;
		if (!doc || selectedIds.has(doc.id)) continue;
		hide(p);
	}

	for (const p of (canvas?.background?.placeables ?? [])) {
		const doc = p?.document;
		if (!doc || selectedIds.has(doc.id)) continue;
		hide(p);
	}

	const primary = canvas?.primary;
	if (primary?.children) {
		for (const child of primary.children) {
			if (!child) continue;
			const childDoc = child?.document || child?.tile?.document;
			if (childDoc && selectedIds.has(childDoc.id)) continue;
			const parentPlaceable = child?.object;
			if (parentPlaceable?.document && selectedIds.has(parentPlaceable.document.id)) continue;
			hide(child);
		}
	}

	hide(primary?.background);
	hide(primary?.background?.mesh);
	hide(primary?.background?.sprite);
	hide(primary?.foreground);
	hide(primary?.foreground?.mesh);
	hide(primary?.foreground?.sprite);

	// Wall visuals are Drawings, which live under the InterfaceCanvasGroup
	// (canvas.interface) on the DrawingsLayer (canvas.drawings). We must NOT
	// blanket-hide canvas.interface — PIXI would then skip the drawings layer
	// regardless of its own visibility. Instead, hide every interface child
	// EXCEPT the drawings layer, then hide only the non-selected drawings.
	const iface = canvas?.interface;
	if (iface?.children) {
		for (const child of iface.children) {
			if (!child || child === drawingsLayer || child === pathLayer) continue;
			hide(child);
		}
	}
	for (const p of (drawingsLayer?.placeables ?? [])) {
		const doc = p?.document;
		if (!doc || selectedIds.has(doc.id)) continue;
		hide(p);
	}
	for (const child of (pathLayer?.children ?? [])) {
		if (!selectedPathGraphics.has(child)) hide(child);
	}

	const hiddenFrames = [];
	for (const doc of docs) {
		const p = doc?.object;
		if (p?.frame) {
			hiddenFrames.push({ frame: p.frame, visible: p.frame.visible });
			p.frame.visible = false;
		}
		if (p?.controlIcon) {
			hiddenFrames.push({ frame: p.controlIcon, visible: p.controlIcon.visible });
			p.controlIcon.visible = false;
		}
	}

	const grid = canvas?.grid;
	const gridVis = grid?.visible ?? null;
	if (grid) grid.visible = false;

	const iGrid = canvas?.interface?.grid;
	const iGridVis = iGrid?.visible ?? null;
	if (iGrid) iGrid.visible = false;

	const effects = canvas?.effects;
	const effectsVis = effects?.visible ?? null;
	if (effects) effects.visible = false;

	// Keep the drawings layer itself visible (its non-selected children are
	// already hidden above) so selected wall drawings render into the bake.
	if (drawingsLayer && drawingsLayer.visible === false) {
		hidden.push({ obj: drawingsLayer, visible: drawingsLayer.visible });
		drawingsLayer.visible = true;
	}
	if (selectedPathGraphics.size && pathLayer?.visible === false) {
		hidden.push({ obj: pathLayer, visible: pathLayer.visible });
		pathLayer.visible = true;
	}

	for (const doc of docs) {
		const p = doc?.object;
		if (p) {
			p.visible = true;
			if (p.renderable !== undefined) p.renderable = true;
			const visual = p.sprite || p.mesh;
			if (visual) {
				visual.visible = true;
				if (visual.renderable !== undefined) visual.renderable = true;
			}
		}
	}

	return () => {
		for (const { obj, visible } of hidden) {
			try {
				obj.visible = visible;
			}
			catch(_) { }
		}
		for (const { frame, visible } of hiddenFrames) {
			try {
				frame.visible = visible;
			}
			catch(_) { }
		}
		if (gridVis !== null && grid) grid.visible = gridVis;
		if (iGridVis !== null && iGrid) iGrid.visible = iGridVis;
		if (effectsVis !== null && effects) effects.visible = effectsVis;
	};
}

// ─── Primary canvas patches ─────────────────────────────────────────────────

function patchPrimaryForTransparent(primary) {
	if (!primary) return null;

	const sprite = primary.sprite ?? null;
	const prevDisplayed = !!primary.displayed;
	const prevSpriteVis = sprite?.visible;
	const prevSpriteRend = sprite?.renderable;
	const prevClearColor = Array.isArray(primary.clearColor) ? primary.clearColor.slice() : null;

	primary.displayed = true;
	if (sprite) {
		sprite.visible = false;
		if (typeof sprite.renderable === "boolean") sprite.renderable = false;
	}
	if (primary.clearColor) {
		try {
			primary.clearColor = [0, 0, 0, 0];
		}
		catch(_) { }
	}
	try {
		primary.renderDirty = true;
	}
	catch(_) { }

	let restoreRender = null;
	if (typeof primary._render === "function") {
		const origRender = primary._render;
		primary._render = function(localRenderer) {
			const r = localRenderer || canvas?.app?.renderer;
			const fb = r?.framebuffer;
			let restoreClear = null;
			if (fb && typeof fb.clear === "function") {
				const origClear = fb.clear;
				fb.clear = function(rr, g, b, a, mask) {
					return origClear.call(this, 0, 0, 0, 0, mask);
				};
				restoreClear = () => {
					fb.clear = origClear;
				};
			}
			try {
				return origRender.call(this, r);
			}
			finally {
				if (restoreClear) try {
					restoreClear();
				}
				catch(_) { }
			}
		};
		try {
			primary.renderDirty = true;
		}
		catch(_) { }
		restoreRender = () => {
			primary._render = origRender;
			try {
				primary.renderDirty = true;
			}
			catch(_) { }
		};
	}

	return () => {
		try {
			primary.displayed = prevDisplayed;
		}
		catch(_) { }
		if (sprite) {
			try {
				sprite.visible = prevSpriteVis;
			}
			catch(_) { }
			if (prevSpriteRend !== undefined) try {
				sprite.renderable = prevSpriteRend;
			}
			catch(_) { }
		}
		if (prevClearColor) try {
			primary.clearColor = prevClearColor;
		}
		catch(_) { }
		try {
			primary.renderDirty = true;
		}
		catch(_) { }
		if (restoreRender) try {
			restoreRender();
		}
		catch(_) { }
	};
}

// ─── Crop transparent borders ────────────────────────────────────────────────

function cropTransparentBorders(canvasEl, bounds) {
	const ctx = canvasEl.getContext("2d");
	const w = canvasEl.width;
	const h = canvasEl.height;
	if (!w || !h) return { canvas: canvasEl, bounds };

	const imageData = ctx.getImageData(0, 0, w, h);
	const data = imageData.data;

	let minX = w; let minY = h; let maxX = -1; let maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[(((y * w) + x) * 4) + 3] > 0) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}

	if (maxX < 0 || maxY < 0) return { canvas: canvasEl, bounds };

	const cropW = maxX - minX + 1;
	const cropH = maxY - minY + 1;

	if (minX === 0 && minY === 0 && cropW === w && cropH === h) {
		return { canvas: canvasEl, bounds };
	}

	const cropped = document.createElement("canvas");
	cropped.width = cropW;
	cropped.height = cropH;
	cropped.getContext("2d").drawImage(canvasEl, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

	const newBounds = {
		x: bounds.x + minX,
		y: bounds.y + minY,
		width: cropW,
		height: cropH,
	};

	return { canvas: cropped, bounds: newBounds };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

async function renderTilesToCanvas(tiles, bounds, resolution = 1, mapPathIds = []) {
	if (!canvas?.ready || !canvas.stage || !canvas.app?.renderer) {
		throw new Error("Canvas not available");
	}

	const renderer = canvas.app.renderer;
	const stage = canvas.stage;
	const primary = canvas.primary;

	const pixelWidth = Math.max(1, Math.round(bounds.width * resolution));
	const pixelHeight = Math.max(1, Math.round(bounds.height * resolution));

	const maxSize = getMaxTextureSize(renderer);
	if (pixelWidth > maxSize || pixelHeight > maxSize) {
		throw new Error(
			`Flattened image (${pixelWidth}×${pixelHeight}px) exceeds GPU texture limit (${maxSize}px). `
            + "Try selecting fewer tiles."
		);
	}

	const restore = isolateVisibility(tiles, bounds, mapPathIds);
	const restorePrimary = patchPrimaryForTransparent(primary);

	const origStage = {
		scaleX: stage.scale?.x ?? 1,
		scaleY: stage.scale?.y ?? 1,
		posX: stage.position?.x ?? 0,
		posY: stage.position?.y ?? 0,
		pivotX: stage.pivot?.x ?? 0,
		pivotY: stage.pivot?.y ?? 0,
	};
	const origScreen = renderer.screen
		? { width: renderer.screen.width, height: renderer.screen.height }
		: null;
	const rendBg = renderer.background || null;
	const prevBg = rendBg ? { alpha: rendBg.alpha, color: rendBg.color } : null;
	const hasBgAlpha = typeof renderer.backgroundAlpha === "number";
	const prevBgAlpha = hasBgAlpha ? renderer.backgroundAlpha : null;

	const renderTexture = PIXI.RenderTexture.create({
		width: pixelWidth,
		height: pixelHeight,
		resolution: 1,
		scaleMode: PIXI.SCALE_MODES.LINEAR,
	});
	if (renderTexture?.baseTexture) {
		try {
			renderTexture.baseTexture.clearColor = [0, 0, 0, 0];
		}
		catch(_) { }
	}

	let outputCanvas = null;
	try {
		if (renderer.screen) {
			renderer.screen.width = pixelWidth;
			renderer.screen.height = pixelHeight;
		}

		try {
			stage.pivot?.set?.(0, 0);
		}
		catch(_) { }
		try {
			stage.position?.set?.(-bounds.x * resolution, -bounds.y * resolution);
		}
		catch(_) { }
		try {
			stage.scale?.set?.(resolution, resolution);
		}
		catch(_) { }

		if (rendBg) try {
			rendBg.alpha = 0;
		}
		catch(_) { }
		if (hasBgAlpha) try {
			renderer.backgroundAlpha = 0;
		}
		catch(_) { }

		await nextFrame();
		try {
			stage.updateTransform?.();
		}
		catch(_) { }
		try {
			primary?.updateTransform?.();
		}
		catch(_) { }
		await nextFrame();

		renderer.render(stage, { renderTexture, clear: true, skipUpdateTransform: false });

		outputCanvas = renderer.extract.canvas(renderTexture);
	}
	finally {
		renderTexture.destroy(true);

		try {
			stage.scale?.set?.(origStage.scaleX, origStage.scaleY);
		}
		catch(_) { }
		try {
			stage.position?.set?.(origStage.posX, origStage.posY);
		}
		catch(_) { }
		try {
			stage.pivot?.set?.(origStage.pivotX, origStage.pivotY);
		}
		catch(_) { }
		if (origScreen && renderer.screen) {
			renderer.screen.width = origScreen.width;
			renderer.screen.height = origScreen.height;
		}
		try {
			stage.updateTransform?.();
		}
		catch(_) { }

		if (rendBg && prevBg) {
			try {
				rendBg.alpha = prevBg.alpha; rendBg.color = prevBg.color;
			}
			catch(_) { }
		}
		if (hasBgAlpha && prevBgAlpha !== null) {
			try {
				renderer.backgroundAlpha = prevBgAlpha;
			}
			catch(_) { }
		}

		if (restorePrimary) try {
			restorePrimary();
		}
		catch(_) { }
		restore();
	}

	return { canvas: outputCanvas, bounds };
}

// ─── File saving ─────────────────────────────────────────────────────────────

async function ensureDir(dir) {
	try {
		const FP = foundry.applications.apps.FilePicker.implementation;
		await FP.browse("data", dir);
	}
	catch{
		try {
			const FP = foundry.applications.apps.FilePicker.implementation;
			await FP.createDirectory("data", dir);
		}
		catch(_) { }
	}
}

async function saveAsWebP(canvasEl, quality = 1.0) {
	if (!canvasEl) throw new Error("No canvas to save");

	await ensureDir(UPLOAD_DIR);

	const blob = await new Promise(resolve => {
		if (canvasEl.toBlob) {
			canvasEl.toBlob(resolve, "image/webp", quality);
		}
		else {
			try {
				const dataUrl = canvasEl.toDataURL("image/webp", quality);
				const bin = atob(dataUrl.split(",")[1] || "");
				const arr = new Uint8Array(bin.length);
				for (let i = 0; i < arr.length; i++) arr[i] = bin.charCodeAt(i);
				resolve(new Blob([arr], { type: "image/webp" }));
			}
			catch(e) {
				resolve(null);
			}
		}
	});

	if (!blob) throw new Error("Failed to create WebP blob");

	const timestamp = Date.now();
	const sceneId = canvas?.scene?.id || "unknown";
	const filename = `flatten-${sceneId}-${timestamp}.webp`;
	const file = new File([blob], filename, { type: "image/webp" });

	const FP = foundry.applications.apps.FilePicker.implementation;
	const result = await FP.upload("data", UPLOAD_DIR, file, {}, { notify: false });

	let path = "";
	if (typeof result?.url === "string") path = result.url;
	else if (typeof result?.path === "string") path = result.path;
	else if (typeof result === "string") path = result;
	if (!path) path = `${UPLOAD_DIR}/${filename}`;

	await new Promise(r => {
		setTimeout(r, 200);
	});
	return path;
}

// ─── Tile Actions ────────────────────────────────────────────────────────────

// --- FLATTEN ---

async function createFlattenedTile(bounds, filePath, tiles, mapPaths = []) {
	if (!canvas?.scene) throw new Error("Scene not available");

	let elevation = 0;
	for (const doc of tiles) {
		const e = Number(doc.elevation ?? 0);
		if (e > elevation) elevation = e;
	}

	// Store original tile data for restoration
	const originalData = tiles.map(t => {
		const data = t.toObject(false);
		return { data };
	});
	const flattenFlags = {
		flattenedTile: true,
		originalTileCount: tiles.length,
		flattenedAt: Date.now(),
		originalPosition: { x: bounds.x, y: bounds.y },
		// Store full tile data for unflattening
		tiles: originalData,
		mapPaths,
	};

	const tileData = {
		texture: {
			src: filePath,
			// v14 defaults the texture anchor to (0.5, 0.5), treating (x, y) as the
			// tile centre. bounds.x/y are a top-left origin, so pin the anchor to
			// (0, 0) — otherwise the flattened tile renders half its size up-left of
			// where the originals sat (most visible on hex maps). Matches the hex
			// tile placers (HexPainterSD / HexGeneratorSD / SoloHexMode).
			anchorX: 0,
			anchorY: 0,
		},
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		rotation: 0,
		alpha: 1,
		elevation,
		sort: 2,
		hidden: false,
		locked: false,
		occlusion: { mode: 0, alpha: 0 },
		flags: {
			[MODULE_ID]: flattenFlags,
		},
	};

	const created = await canvas.scene.createEmbeddedDocuments("Tile", [tileData]);
	await new Promise(r => {
		setTimeout(r, 100);
	});
	return created;
}

async function deleteOriginalTiles(tiles) {
	if (!canvas?.scene) return;
	const ids = tiles.map(t => t.id).filter(Boolean);
	if (!ids.length) return;
	await canvas.scene.deleteEmbeddedDocuments("Tile", ids);
}

async function deleteMapPaths(mapPaths) {
	if (!mapPaths.length) return;
	const tool = game?.shadowdarkExtras?.drawingTool;
	if (!tool?.deleteAnyDrawing) throw new Error("Road/River drawing tool is not available");
	for (const path of mapPaths) await tool.deleteAnyDrawing(path.drawingId);
	const deletedIds = new Set(mapPaths.map(path => path.drawingId));
	const remaining = canvas.scene?.getFlag(MODULE_ID, "permanentDrawings") || [];
	if (remaining.some(path => deletedIds.has(path.drawingId))) {
		throw new Error("Could not remove the baked Road/River overlays");
	}
}

async function flattenTilesToBackground(tiles, mapPaths = []) {
	const scene = canvas?.scene;
	const level = canvas?.level ?? scene?.levels?.contents?.[0];
	if (!scene || !level) throw new Error("Scene level not available");
	if (!tiles || tiles.length < 2) throw new Error("Need at least 2 tiles to flatten");

	const bounds = { x: 0, y: 0, width: scene.width, height: scene.height };
	const maxSize = Math.min(
		HEX_BACKGROUND_MAX_SIZE,
		getMaxTextureSize(canvas.app.renderer)
	);
	const resolution = Math.min(1, maxSize / Math.max(bounds.width, bounds.height));
	const pixelWidth = Math.max(1, Math.round(bounds.width * resolution));
	const pixelHeight = Math.max(1, Math.round(bounds.height * resolution));

	ui.notifications.info(
		`Baking ${tiles.length} tiles into a ${pixelWidth}×${pixelHeight} scene background…`
	);
	const pathIds = mapPaths.map(path => path.drawingId).filter(Boolean);
	const result = await renderTilesToCanvas(tiles, bounds, resolution, pathIds);
	if (!result?.canvas) throw new Error("Failed to render tiles");

	const filePath = await saveAsWebP(result.canvas, 0.9);
	try {
		result.canvas.width = 0; result.canvas.height = 0;
	}
	catch(_) { }

	const levelData = level.toObject(false);
	await scene.setFlag(MODULE_ID, "flattenedHexBackground", {
		flattenedAt: Date.now(),
		levelId: level.id,
		background: levelData.background,
		textures: levelData.textures,
		tiles: tiles.map(tile => tile.toObject(false)),
		mapPaths,
	});
	await scene.updateEmbeddedDocuments("Level", [{
		"_id": level.id,
		"background.src": filePath,
		"textures.anchorX": 0.5,
		"textures.anchorY": 0.5,
		"textures.offsetX": 0,
		"textures.offsetY": 0,
		"textures.fit": "fill",
		"textures.scaleX": 1,
		"textures.scaleY": 1,
		"textures.rotation": 0,
	}]);
	await deleteMapPaths(mapPaths);
	await deleteOriginalTiles(tiles);

	ui.notifications.info(
		`Baked ${tiles.length} tiles into one ${pixelWidth}×${pixelHeight} scene background.`
	);
}

async function restoreHexBackground() {
	const scene = canvas?.scene;
	const backup = scene?.getFlag(MODULE_ID, "flattenedHexBackground");
	if (!scene || !backup) throw new Error("No flattened hex background to restore");

	const existingIds = new Set(scene.tiles.contents.map(tile => tile.id));
	const missingTiles = (backup.tiles ?? [])
		.filter(data => !existingIds.has(data._id))
		.map(data => {
			const restored = foundry.utils.deepClone(data);
			delete restored._stats;
			return restored;
		});
	if (missingTiles.length) {
		await scene.createEmbeddedDocuments("Tile", missingTiles, { keepId: true });
	}
	if (backup.mapPaths?.length) {
		const saved = scene.getFlag(MODULE_ID, "permanentDrawings") || [];
		const savedIds = new Set(saved.map(path => path.drawingId));
		const restored = backup.mapPaths.filter(path => !savedIds.has(path.drawingId));
		if (restored.length) {
			await scene.setFlag(MODULE_ID, "permanentDrawings", [...saved, ...restored]);
			const tool = game?.shadowdarkExtras?.drawingTool;
			for (const path of restored) {
				tool?._renderPermanentEntry?.(path);
				tool?._broadcast?.("sdx-drawing-created", path);
			}
		}
	}

	const level = scene.levels.get(backup.levelId) ?? scene.levels.contents[0];
	if (!level) throw new Error("Original scene level not available");
	await scene.updateEmbeddedDocuments("Level", [{
		_id: level.id,
		background: backup.background,
		textures: backup.textures,
	}]);
	await scene.unsetFlag(MODULE_ID, "flattenedHexBackground");
	ui.notifications.info(`Restored ${missingTiles.length} original hex tiles.`);
}

async function flattenTiles(tiles, { asBackground = false, mapPaths = [] } = {}) {
	if (asBackground) {
		try {
			if (canvas.scene?.getFlag(MODULE_ID, "flattenedHexBackground")) {
				await restoreHexBackground();
			}
			else {
				await flattenTilesToBackground(tiles, mapPaths);
			}
		}
		catch(error) {
			console.error(`${MODULE_ID} | Hex background flatten failed:`, error);
			ui.notifications.error(`Failed to flatten hex background: ${error.message}`);
		}
		return;
	}

	if (!tiles || tiles.length < 2) {
		ui.notifications.warn("Select at least 2 tiles to flatten.");
		return;
	}

	try {
		ui.notifications.info("Flattening tiles…");
		const bounds = computeBounds(tiles);
		if (!bounds) throw new Error("Could not compute tile bounds");

		const pathIds = mapPaths.map(path => path.drawingId).filter(Boolean);
		const result = await renderTilesToCanvas(tiles, bounds, 1, pathIds);
		if (!result?.canvas) throw new Error("Failed to render tiles");

		const cropped = cropTransparentBorders(result.canvas, bounds);
		if (cropped.canvas !== result.canvas) {
			try {
				result.canvas.width = 0; result.canvas.height = 0;
			}
			catch(_) { }
		}

		ui.notifications.info("Saving flattened image…");
		const filePath = await saveAsWebP(cropped.canvas, 1.0);

		try {
			cropped.canvas.width = 0; cropped.canvas.height = 0;
		}
		catch(_) { }

		ui.notifications.info("Creating flattened tile…");
		await createFlattenedTile(cropped.bounds, filePath, tiles, mapPaths);
		await deleteMapPaths(mapPaths);
		await deleteOriginalTiles(tiles);

		ui.notifications.info(`Flattened ${tiles.length} tiles successfully!`);

	}
	catch(error) {
		console.error(`${MODULE_ID} | TileFlatten failed:`, error);
		ui.notifications.error(`Failed to flatten tiles: ${error.message}`);
	}
}

// --- UNFLATTEN (DECONSTRUCT) ---

async function unflattenTile(tileDoc) {
	if (!tileDoc) return;

	const flags = tileDoc.flags?.[MODULE_ID];
	if (!flags?.flattenedTile
		|| (!flags?.tiles?.length && !flags?.drawings?.length && !flags?.mapPaths?.length)) {
		ui.notifications.warn("This tile does not contain stored tile data.");
		return;
	}

	try {
		ui.notifications.info("Restoring original tiles…");

		const storedTiles = flags.tiles || [];
		const storedDrawings = flags.drawings || [];
		const storedMapPaths = flags.mapPaths || [];
		const origin = flags.originalPosition || { x: tileDoc.x, y: tileDoc.y };

		// Calculate offset if the flattened tile was moved
		const offsetX = tileDoc.x - origin.x;
		const offsetY = tileDoc.y - origin.y;

		const prepare = entry => {
			if (!entry.data) return null;
			const data = foundry.utils.deepClone(entry.data);
			// Remove ID and stats to create fresh
			delete data._id;
			delete data._stats;
			// Apply offset
			if (typeof data.x === "number") data.x += offsetX;
			if (typeof data.y === "number") data.y += offsetY;
			return data;
		};

		const toCreateTiles = [];
		for (const entry of storedTiles) {
			const data = prepare(entry);
			if (!data) continue;
			// Always restore floor tiles at sort 0 to prevent sort inflation
			if (data.flags?.[MODULE_ID]?.dungeonFloor) data.sort = 0;
			toCreateTiles.push(data);
		}

		const toCreateDrawings = [];
		for (const entry of storedDrawings) {
			const data = prepare(entry);
			if (data) toCreateDrawings.push(data);
		}

		if (!toCreateTiles.length && !toCreateDrawings.length && !storedMapPaths.length) {
			throw new Error("No valid data found to restore.");
		}

		// Create restored documents by type
		if (toCreateTiles.length) await canvas.scene.createEmbeddedDocuments("Tile", toCreateTiles);
		if (toCreateDrawings.length) await canvas.scene.createEmbeddedDocuments("Drawing", toCreateDrawings);
		if (storedMapPaths.length) {
			const saved = canvas.scene.getFlag(MODULE_ID, "permanentDrawings") || [];
			const savedIds = new Set(saved.map(path => path.drawingId));
			const restored = storedMapPaths.filter(path => !savedIds.has(path.drawingId));
			if (restored.length) {
				await canvas.scene.setFlag(MODULE_ID, "permanentDrawings", [...saved, ...restored]);
				const tool = game?.shadowdarkExtras?.drawingTool;
				for (const path of restored) {
					tool?._renderPermanentEntry?.(path);
					tool?._broadcast?.("sdx-drawing-created", path);
				}
			}
		}

		// Delete the flattened tile
		await canvas.scene.deleteEmbeddedDocuments("Tile", [tileDoc.id]);

		ui.notifications.info(`Restored ${toCreateTiles.length} tiles + ${toCreateDrawings.length + storedMapPaths.length} drawings successfully!`);

	}
	catch(error) {
		console.error(`${MODULE_ID} | Unflatten failed:`, error);
		ui.notifications.error(`Failed to unflatten tile: ${error.message}`);
	}
}

// ─── HUD Injection ──────────────────────────────────────────────────────────

function resolveHudElement(hud, payload) {
	if (payload) {
		if (payload instanceof HTMLElement) return payload;
		if (payload.element instanceof HTMLElement) return payload.element;
		if (Array.isArray(payload) && payload[0] instanceof HTMLElement) return payload[0];
		if (payload.jquery && payload[0] instanceof HTMLElement) return payload[0];
	}
	if (hud?.element instanceof HTMLElement) return hud.element;
	if (hud?.element?.[0] instanceof HTMLElement) return hud.element[0];
	return null;
}

function injectHudButtons(hud, html) {
	const root = resolveHudElement(hud, html);
	if (!root) {
		console.warn(`${MODULE_ID} | TileFlatten: Could not resolve HUD element`, { hud, html });
		return;
	}

	const column = root.querySelector(".col.right");
	if (!column) {
		console.warn(`${MODULE_ID} | TileFlatten: No .col.right found in HUD`);
		return;
	}

	// Clear existing buttons
	const existingFlatten = column.querySelector(`[data-action="${FLATTEN_ACTION}"]`);
	if (existingFlatten) existingFlatten.remove();

	const existingUnflatten = column.querySelector(`[data-action="${UNFLATTEN_ACTION}"]`);
	if (existingUnflatten) existingUnflatten.remove();

	// Get relevant tiles
	const tiles = getControlledTiles();
	const selectedCount = tiles.length;

	// Decide what to show
	// 1. If 1 tile selected AND it's a flattened tile -> Show Unflatten
	// 2. If 2+ tiles selected -> Show Flatten

	if (selectedCount === 1) {
		const tile = tiles[0];
		const isFlattened = tile.getFlag(MODULE_ID, "flattenedTile");

		if (isFlattened) {
			// Show Unflatten Button
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "control-icon sdx-flatten-tiles"; // Reuse style
			btn.dataset.action = UNFLATTEN_ACTION;
			const label = "Unflatten (Restore Original Tiles)";
			btn.dataset.tooltip = label;
			btn.setAttribute("aria-label", label);
			btn.title = label;
			btn.innerHTML = '<i class="fas fa-layer-group" style="transform: scale(1, -1);"></i>'; // Inverted icon

			btn.addEventListener("click", ev => {
				ev.preventDefault();
				ev.stopPropagation();
				unflattenTile(tile);
			});

			column.appendChild(btn);
		}
	}
	else if (selectedCount >= 2) {
		// Show Flatten Button
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "control-icon sdx-flatten-tiles";
		btn.dataset.action = FLATTEN_ACTION;
		const label = `Flatten ${selectedCount} selected tiles`;
		btn.dataset.tooltip = label;
		btn.setAttribute("aria-label", label);
		btn.title = label;
		btn.innerHTML = '<i class="fas fa-layer-group"></i>';

		btn.addEventListener("click", ev => {
			ev.preventDefault();
			ev.stopPropagation();

			const current = getControlledTiles();
			if (current.length < 2) {
				ui.notifications.warn("Select at least 2 tiles to flatten.");
				return;
			}

			btn.disabled = true;
			btn.classList.add("disabled");
			flattenTiles(current).finally(() => {
				btn.disabled = false;
				btn.classList.remove("disabled");
			});
		});

		column.appendChild(btn);
	}
}

// ─── Hook ───────────────────────────────────────────────────────────────────

let hooksRegistered = false;

export function registerTileFlattenHooks() {
	if (hooksRegistered) return;
	hooksRegistered = true;
	Hooks.on("renderTileHUD", (hud, html) => {
		try {
			injectHudButtons(hud, html);
		}
		catch(error) {
			console.error(`${MODULE_ID} | TileHUD flatten button error:`, error);
		}
	});
}

// ─── Dungeon Level Flatten/Unflatten ─────────────────────────────────────────

/**
 * Returns floor tiles grouped by elevation, excluding already-flattened tiles.
 * Only tiles with flags.shadowdark-extras.dungeonFloor = true are included.
 * @returns {Object} { [elevation]: TileDocument[] }
 */
export function getDungeonFloorLevels() {
	const scene = canvas?.scene;
	if (!scene) return {};
	const tiles = scene.tiles.contents.filter(t =>
		t.flags?.[MODULE_ID]?.dungeonFloor === true
        && !t.flags?.[MODULE_ID]?.flattenedTile
	);
	const byElevation = {};
	for (const tile of tiles) {
		const elev = tile.elevation ?? 0;
		if (!byElevation[elev]) byElevation[elev] = [];
		byElevation[elev].push(tile);
	}
	return byElevation;
}

/**
 * Returns all dungeon-level flattened tile documents on the current scene.
 * @returns {TileDocument[]}
 */
export function getFlattendDungeonLevels() {
	const scene = canvas?.scene;
	if (!scene) return [];
	return scene.tiles.contents.filter(t =>
		typeof t.flags?.[MODULE_ID]?.dungeonFlattenedLevel === "number"
	);
}

/**
 * Collect the bakeable VISUAL documents at a given elevation, by layer.
 * Floors + decor/clutter (incl. biome props & sconce tiles) are Tiles;
 * wall visuals are Drawings (flag `dungeonWall`). Stairs are intentionally
 * excluded (kept as distinct markers). Already-flattened tiles are excluded.
 * Functional docs (Wall collision, Regions, AmbientLights, Notes) are never
 * included.
 * @returns {{ tiles: TileDocument[], drawings: DrawingDocument[] }}
 */
export function getDungeonVisualDocs(
	elevation, { floors = true, walls = true, decor = true } = {}
) {
	const scene = canvas?.scene;
	if (!scene) return { tiles: [], drawings: [] };
	const atElev = e => Number(e ?? 0) === Number(elevation);

	const tiles = scene.tiles.contents.filter(t => {
		const f = t.flags?.[MODULE_ID];
		if (!f || f.flattenedTile) return false;
		if (!atElev(t.elevation)) return false;
		if (floors && f.dungeonFloor) return true;
		if (decor && f.dungeonClutter) return true; // clutter + biome props + sconce tiles
		return false;
	});

	const drawings = walls
		? scene.drawings.contents.filter(d => {
			const f = d.flags?.[MODULE_ID];
			if (!f || !f.dungeonWall) return false;
			return atElev(d.elevation);
		})
		: [];

	return { tiles, drawings };
}

/**
 * Flatten the dungeon's visual layers at the given elevation into one image tile.
 * Bakes floor + decor Tiles AND wall Drawings (by default); stores originals of
 * both types for a faithful Unflatten; marks result with dungeonFlattenedLevel.
 * Collision Walls, Regions, AmbientLights and Notes are left untouched.
 * @param {number} elevation
 * @param {{floors?:boolean, walls?:boolean, decor?:boolean}} [options]
 */
export async function flattenDungeonLevel(elevation, options = {}) {
	const { floors = true, walls = true, decor = true } = options;
	const { tiles, drawings } = getDungeonVisualDocs(elevation, { floors, walls, decor });
	const docs = [...tiles, ...drawings];
	if (!docs.length) {
		ui.notifications.warn("No dungeon visual documents found at that elevation.");
		return;
	}

	try {
		ui.notifications.info(`Flattening ${tiles.length} tiles + ${drawings.length} wall drawings at elevation ${elevation}…`);
		const bounds = computeBounds(docs);
		if (!bounds) throw new Error("Could not compute bounds");

		const result = await renderTilesToCanvas(docs, bounds);
		if (!result?.canvas) throw new Error("Failed to render");

		const cropped = cropTransparentBorders(result.canvas, bounds);
		if (cropped.canvas !== result.canvas) {
			try {
				result.canvas.width = 0; result.canvas.height = 0;
			}
			catch(_) {}
		}

		ui.notifications.info("Saving flattened image…");
		const filePath = await saveAsWebP(cropped.canvas, 1.0);
		try {
			cropped.canvas.width = 0; cropped.canvas.height = 0;
		}
		catch(_) {}

		const originalTiles = tiles.map(t => ({ data: t.toObject(false) }));
		const originalDrawings = drawings.map(d => ({ data: d.toObject(false) }));

		const tileData = {
			texture: {
				src: filePath,
				// v14 anchors textures at (0.5, 0.5) by default, treating (x, y) as
				// the centre. cropped.bounds.x/y are top-left, so pin anchor to (0, 0)
				// or the baked level renders half its size up-left of the originals.
				anchorX: 0,
				anchorY: 0,
			},
			x: cropped.bounds.x,
			y: cropped.bounds.y,
			width: cropped.bounds.width,
			height: cropped.bounds.height,
			rotation: 0,
			alpha: 1,
			elevation,
			sort: 0,
			hidden: false,
			locked: false,
			occlusion: { mode: 0, alpha: 0 },
			flags: {
				[MODULE_ID]: {
					flattenedTile: true,
					dungeonFloor: true,
					dungeonFlattenedLevel: elevation,
					originalTileCount: tiles.length,
					originalDrawingCount: drawings.length,
					flattenedAt: Date.now(),
					originalPosition: { x: bounds.x, y: bounds.y },
					tiles: originalTiles,
					drawings: originalDrawings,
				},
			},
		};

		await canvas.scene.createEmbeddedDocuments("Tile", [tileData]);
		if (tiles.length) await canvas.scene.deleteEmbeddedDocuments("Tile", tiles.map(t => t.id).filter(Boolean));
		if (drawings.length) await canvas.scene.deleteEmbeddedDocuments("Drawing", drawings.map(d => d.id).filter(Boolean));
		ui.notifications.info(`Flattened elevation ${elevation} (${tiles.length} tiles + ${drawings.length} drawings) successfully!`);
	}
	catch(error) {
		console.error(`${MODULE_ID} | FlattenDungeonLevel failed:`, error);
		ui.notifications.error(`Failed to flatten level: ${error.message}`);
	}
}

// Export for use by other modules (e.g., TrayApp)
export { flattenTiles, unflattenTile };
