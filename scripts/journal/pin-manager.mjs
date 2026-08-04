// Pin data manager, placer, visibility + drop handling — extracted from
// scripts/journal/JournalPinsSD.mjs (Phase 5.1 split).

import { MODULE_ID, FLAG_KEY, FOLDER_FLAG_KEY, PIN_SCHEMA_VERSION, normalizeImageTint } from "./pin-style.mjs";

export class JournalPinManager {
	static FLAG_KEY = FLAG_KEY;

	static _getScene(sceneId) {
		if (sceneId) {
			const scene = game.scenes?.get(sceneId);
			if (!scene) throw new Error(`Scene not found: ${sceneId}`);
			return scene;
		}
		if (!canvas?.scene) {
			throw new Error("No active scene");
		}
		return canvas.scene;
	}

	static _getScenePins(scene) {
		const raw = scene.getFlag(MODULE_ID, this.FLAG_KEY);
		if (!Array.isArray(raw)) return [];
		return raw.filter(p => p && typeof p === "object" && p.id);
	}

	static async create(pinData, options = {}) {
		const scene = this._getScene(options.sceneId);

		if (!game.user?.isGM) {
			throw new Error("Only GMs can create journal pins");
		}

		const id = pinData.id || foundry.utils.randomID();

		// Pin data should be minimal to allow global style overrides
		const pin = {
			id,
			x: pinData.x ?? 0,
			y: pinData.y ?? 0,
			journalId: pinData.journalId,
			pageId: pinData.pageId ?? null,
			label: pinData.label ?? "Journal Pin",
			nameSource: pinData.nameSource ?? "auto", // "auto" | "journal" | "tooltip" | "label"
			folderId: pinData.folderId ?? null,       // pin-folder grouping (tray Pins tab)
			sort: pinData.sort ?? 0,                   // order within its folder
			size: pinData.size,
			style: pinData.style || {},
			gmOnly: pinData.gmOnly ?? false,
			requiresVision: pinData.requiresVision ?? false,
			aboveFog: pinData.aboveFog ?? false,
			tooltipTitle: pinData.tooltipTitle,
			tooltipContent: pinData.tooltipContent,
			hideTooltip: pinData.hideTooltip ?? false,
			flags: pinData.flags || {},
			version: PIN_SCHEMA_VERSION,
		};

		if (!pin.journalId) {
			// Allow unlinked pins
			pin.journalId = null;
		}

		const pins = this._getScenePins(scene);

		if (pins.some(p => p.id === pin.id)) {
			throw new Error(`Pin with id ${pin.id} already exists`);
		}

		const next = [...pins, foundry.utils.deepClone(pin)];
		await scene.setFlag(MODULE_ID, this.FLAG_KEY, next);

		if (scene.id === canvas?.scene?.id) {
			// Dynamic import breaks the Manager<->Renderer cycle (Phase 5.1 split)
			const { JournalPinRenderer } = await import("./pin-rendering.mjs");
			JournalPinRenderer.addPin(pin);
		}

		return foundry.utils.deepClone(pin);
	}

	static async update(pinId, patch, options = {}) {
		const scene = this._getScene(options.sceneId);
		const pins = this._getScenePins(scene);
		const idx = pins.findIndex(p => p.id === pinId);

		if (idx === -1) throw new Error(`Pin not found: ${pinId}`);
		if (!game.user?.isGM) throw new Error("Only GMs can update journal pins");

		const existing = pins[idx];
		const updated = foundry.utils.deepClone(existing);

		if (patch.x !== undefined) updated.x = patch.x;
		if (patch.y !== undefined) updated.y = patch.y;
		if (patch.label !== undefined) updated.label = patch.label;
		if (patch.nameSource !== undefined) updated.nameSource = patch.nameSource;
		if (patch.folderId !== undefined) updated.folderId = patch.folderId;
		if (patch.sort !== undefined) updated.sort = patch.sort;
		if (patch.size !== undefined) updated.size = patch.size;
		if (patch.pageId !== undefined) updated.pageId = patch.pageId;
		if (patch.journalId !== undefined) updated.journalId = patch.journalId;
		if (patch.style) updated.style = { ...updated.style, ...patch.style };
		if (patch.gmOnly !== undefined) updated.gmOnly = patch.gmOnly;
		if (patch.requiresVision !== undefined) updated.requiresVision = patch.requiresVision;
		if (patch.aboveFog !== undefined) updated.aboveFog = patch.aboveFog;
		if (patch.tooltipTitle !== undefined) updated.tooltipTitle = patch.tooltipTitle;
		if (patch.tooltipContent !== undefined) updated.tooltipContent = patch.tooltipContent;
		if (patch.hideTooltip !== undefined) updated.hideTooltip = patch.hideTooltip;

		// Use expandObject to handle flattened keys like "flags.scope.key"
		const expandedPatch = foundry.utils.expandObject(patch);
		if (expandedPatch.flags) {
			updated.flags = foundry.utils.mergeObject(updated.flags || {}, expandedPatch.flags);
		}
		if (expandedPatch.style) {
			updated.style = foundry.utils.mergeObject(updated.style || {}, expandedPatch.style);
		}

		const next = [...pins];
		next[idx] = updated;
		await scene.setFlag(MODULE_ID, this.FLAG_KEY, next);

		if (scene.id === canvas?.scene?.id) {
			// Dynamic import breaks the Manager<->Renderer cycle (Phase 5.1 split)
			const { JournalPinRenderer } = await import("./pin-rendering.mjs");
			JournalPinRenderer.updatePin(updated);
		}

		return foundry.utils.deepClone(updated);
	}

	static async delete(pinId, options = {}) {
		const scene = this._getScene(options.sceneId);
		const pins = this._getScenePins(scene);
		const idx = pins.findIndex(p => p.id === pinId);

		if (idx === -1) throw new Error(`Pin not found: ${pinId}`);
		if (!game.user?.isGM) throw new Error("Only GMs can delete journal pins");

		const next = pins.filter(p => p.id !== pinId);
		await scene.setFlag(MODULE_ID, this.FLAG_KEY, next);

		if (scene.id === canvas?.scene?.id) {
			// Dynamic import breaks the Manager<->Renderer cycle (Phase 5.1 split)
			const { JournalPinRenderer } = await import("./pin-rendering.mjs");
			JournalPinRenderer.removePin(pinId);
		}
	}

	static get(pinId, options = {}) {
		const scene = this._getScene(options.sceneId);
		const pins = this._getScenePins(scene);
		const pin = pins.find(p => p.id === pinId);
		return pin ? foundry.utils.deepClone(pin) : null;
	}

	/**
     * Resolve the display name for a pin based on its nameSource preference.
     * Candidate sources:
     *   - journal: linked page name, else journal name
     *   - tooltip: the pin's Tooltip Title
     *   - label:   the pin's canvas Label text (style.labelText)
     * "auto" (default) prefers an explicitly-set label, then journal, tooltip, label.
     * A non-"auto" source is tried first, then the others as fallbacks so a pin
     * never renders blank.
     * @param {Object} pin
     * @returns {string}
     */
	static getDisplayName(pin) {
		if (!pin) return "Unnamed Pin";

		// Journal / page name
		let journalName = "";
		if (pin.journalId) {
			const journal = game.journal.get(pin.journalId);
			if (journal) {
				const page = pin.pageId ? journal.pages.get(pin.pageId) : null;
				journalName = page?.name || journal.name || "";
			}
		}

		const tooltip = (pin.tooltipTitle || "").trim();
		const label = (pin.style?.labelText || "").trim();

		// A label the user set explicitly (not a placeholder default)
		const explicit = (pin.label && pin.label !== "New Pin" && pin.label !== "Journal Pin")
			? pin.label.trim() : "";

		switch (pin.nameSource || "auto") {
			case "journal": return journalName || explicit || tooltip || label || "Unnamed Pin";
			case "tooltip": return tooltip || explicit || journalName || label || "Unnamed Pin";
			case "label":   return label || explicit || journalName || tooltip || "Unnamed Pin";
			default:        return explicit || journalName || tooltip || label || "Unnamed Pin";
		}
	}

	// ============================================================
	// PIN FOLDERS (tray Pins tab organization)
	// Scene folders live in the scene flag `pinFolders`; world folders live in
	// the world setting `pinFoldersWorld` and appear on every scene. Pins are
	// always per-scene and reference a folder by id (in either store).
	// ============================================================

	static FOLDER_FLAG_KEY = FOLDER_FLAG_KEY;

	static _getSceneFolders(scene) {
		return scene?.getFlag(MODULE_ID, FOLDER_FLAG_KEY) || [];
	}

	static async _setSceneFolders(scene, arr) {
		await scene.setFlag(MODULE_ID, FOLDER_FLAG_KEY, arr);
	}

	static _getWorldFolders() {
		try {
			return game.settings.get(MODULE_ID, "pinFoldersWorld") || [];
		}
		catch(e) {
			return [];
		}
	}

	static async _setWorldFolders(arr) {
		await game.settings.set(MODULE_ID, "pinFoldersWorld", arr);
	}

	/** Merged folder list (world first, then scene), each tagged with scope. */
	static listFolders(options = {}) {
		const scene = this._getScene(options.sceneId);
		const world = this._getWorldFolders().map(f => ({ ...f, scope: "world" }));
		const sc = this._getSceneFolders(scene).map(f => ({ ...f, scope: "scene" }));
		return foundry.utils.deepClone([...world, ...sc]);
	}

	/** Locate a folder across both stores -> {folder, store} or null. */
	static _locateFolder(folderId, scene) {
		const wf = this._getWorldFolders().find(f => f.id === folderId);
		if (wf) return { folder: wf, store: "world" };
		const sf = this._getSceneFolders(scene).find(f => f.id === folderId);
		if (sf) return { folder: sf, store: "scene" };
		return null;
	}

	/** True if candidateId is folderId itself or a descendant of it (cycle guard). */
	static _isSelfOrDescendant(folders, candidateId, folderId) {
		const byId = Object.fromEntries(folders.map(f => [f.id, f]));
		let cur = candidateId;
		const seen = new Set();
		while (cur) {
			if (cur === folderId) return true;
			if (seen.has(cur)) break; // defensive against pre-existing cycles
			seen.add(cur);
			cur = byId[cur]?.parentId ?? null;
		}
		return false;
	}

	static _nextSort(arr, parentId) {
		const sibs = arr.filter(f => (f.parentId ?? null) === (parentId ?? null));
		return sibs.length ? Math.max(...sibs.map(f => f.sort ?? 0)) + 1 : 0;
	}

	static async createFolder(data = {}, options = {}) {
		if (!game.user?.isGM) throw new Error("Only GMs can create pin folders");
		const scene = this._getScene(options.sceneId);
		const scope = data.scope === "world" ? "world" : "scene";
		const parentId = data.parentId ?? null;

		// A world folder may only nest under another world folder.
		if (scope === "world" && parentId && !this._getWorldFolders().some(f => f.id === parentId)) {
			ui.notifications?.warn("A world folder can only be nested under another world folder.");
			return null;
		}

		const store = scope === "world" ? this._getWorldFolders() : this._getSceneFolders(scene);
		const folder = {
			id: foundry.utils.randomID(),
			name: data.name || "New Folder",
			parentId,
			sort: this._nextSort(store, parentId),
			collapsed: false,
			color: data.color ?? null,
			icon: data.icon ?? null,
			scope,
		};
		if (scope === "world") await this._setWorldFolders([...store, folder]);
		else await this._setSceneFolders(scene, [...store, folder]);
		return foundry.utils.deepClone(folder);
	}

	static async updateFolder(folderId, patch = {}, options = {}) {
		if (!game.user?.isGM) throw new Error("Only GMs can update pin folders");
		const scene = this._getScene(options.sceneId);
		const located = this._locateFolder(folderId, scene);
		if (!located) throw new Error(`Folder not found: ${folderId}`);

		// Scope change -> move the record between stores.
		if (patch.scope !== undefined && patch.scope !== located.store) {
			await this.setFolderScope(folderId, patch.scope, options);
		}

		const merged = this.listFolders({ sceneId: options.sceneId });
		if (patch.parentId !== undefined) {
			const newParent = patch.parentId ?? null;
			if (newParent && this._isSelfOrDescendant(merged, newParent, folderId)) {
				ui.notifications?.warn("Cannot move a folder into itself or its own subfolder.");
				return null;
			}
			const cur = this._locateFolder(folderId, scene); // may have moved store above
			if (cur?.store === "world" && newParent && merged.find(f => f.id === newParent)?.scope !== "world") {
				ui.notifications?.warn(
					"A world folder can only be nested under another world folder."
				);
				return null;
			}
		}

		const cur = this._locateFolder(folderId, scene);
		const arr = cur.store === "world" ? this._getWorldFolders() : this._getSceneFolders(scene);
		const idx = arr.findIndex(f => f.id === folderId);
		const updated = { ...arr[idx] };
		for (const key of ["name", "parentId", "sort", "collapsed", "color", "icon"]) {
			if (patch[key] !== undefined) updated[key] = patch[key];
		}
		const next = [...arr];
		next[idx] = updated;
		if (cur.store === "world") await this._setWorldFolders(next);
		else await this._setSceneFolders(scene, next);
		return foundry.utils.deepClone(updated);
	}

	/** Move a folder between the scene store and the world store. */
	static async setFolderScope(folderId, scope, options = {}) {
		if (!game.user?.isGM) throw new Error("Only GMs can change folder scope");
		scope = scope === "world" ? "world" : "scene";
		const scene = this._getScene(options.sceneId);
		const located = this._locateFolder(folderId, scene);
		if (!located) throw new Error(`Folder not found: ${folderId}`);
		if (located.store === scope) return foundry.utils.deepClone(located.folder);

		const world = this._getWorldFolders();
		const sc = this._getSceneFolders(scene);
		const moving = { ...located.folder, scope };

		// A world folder cannot keep a non-world parent; detach to top level.
		if (scope === "world" && moving.parentId && !world.some(f => f.id === moving.parentId)) {
			moving.parentId = null;
		}
		const dest = scope === "world" ? world : sc;
		moving.sort = this._nextSort(dest, moving.parentId);

		const newWorld = (located.store === "world" ? world.filter(f => f.id !== folderId) : [
			...world,
		]);
		const newScene = (located.store === "scene" ? sc.filter(f => f.id !== folderId) : [...sc]);
		if (scope === "world") newWorld.push(moving); else newScene.push(moving);

		// Moving to scene scope would orphan any world children (a world folder
		// can't sit under a scene parent across scenes) — detach them to top level.
		if (scope === "scene") {
			for (const wf of newWorld) if (wf.parentId === folderId) wf.parentId = null;
		}

		await this._setWorldFolders(newWorld);
		await this._setSceneFolders(scene, newScene);
		return foundry.utils.deepClone(moving);
	}

	static async setFolderCollapsed(folderId, collapsed, options = {}) {
		return this.updateFolder(folderId, { collapsed: !!collapsed }, options);
	}

	/** Delete a folder: child folders + this scene's pins reparent to the folder's parent / null. */
	static async deleteFolder(folderId, options = {}) {
		if (!game.user?.isGM) throw new Error("Only GMs can delete pin folders");
		const scene = this._getScene(options.sceneId);
		const located = this._locateFolder(folderId, scene);
		if (!located) throw new Error(`Folder not found: ${folderId}`);
		const newParent = located.folder.parentId ?? null;

		const reparent = arr => arr
			.filter(f => f.id !== folderId)
			.map(f => (f.parentId === folderId ? { ...f, parentId: newParent } : f));
		await this._setWorldFolders(reparent(this._getWorldFolders()));
		await this._setSceneFolders(scene, reparent(this._getSceneFolders(scene)));

		// Reparent this scene's pins that were in this folder -> Ungrouped (null)
		const pins = this._getScenePins(scene);
		let changed = false;
		const nextPins = pins.map(p => {
			if ((p.folderId ?? null) === folderId) {
				changed = true; return { ...p, folderId: null };
			}
			return p;
		});
		if (changed) await scene.setFlag(MODULE_ID, FLAG_KEY, nextPins);
	}

	static async reorderFolders(parentId, orderedIds, options = {}) {
		if (!game.user?.isGM) throw new Error("Only GMs can reorder pin folders");
		const scene = this._getScene(options.sceneId);
		const pid = parentId ?? null;
		const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
		const apply = arr => arr.map(f =>
			(f.parentId ?? null) === pid && orderMap.has(f.id) ? { ...f, sort: orderMap.get(f.id) } : f
		);
		await this._setWorldFolders(apply(this._getWorldFolders()));
		await this._setSceneFolders(scene, apply(this._getSceneFolders(scene)));
	}

	/**
     * Move a pin into a folder (folderId=null for Ungrouped), optionally before
     * another pin in that folder. Re-sequences `sort` for the target group.
     */
	static async movePin(pinId, folderId = null, beforePinId = null, options = {}) {
		if (!game.user?.isGM) throw new Error("Only GMs can move pins");
		const scene = this._getScene(options.sceneId);
		const pins = this._getScenePins(scene);
		const moving = pins.find(p => p.id === pinId);
		if (!moving) throw new Error(`Pin not found: ${pinId}`);
		folderId = folderId ?? null;

		const group = pins
			.filter(p => p.id !== pinId && (p.folderId ?? null) === folderId)
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
		let insertIdx = beforePinId ? group.findIndex(p => p.id === beforePinId) : group.length;
		if (insertIdx < 0) insertIdx = group.length;
		group.splice(insertIdx, 0, moving);

		const sortMap = new Map(group.map((p, i) => [p.id, i]));
		const next = pins.map(p => {
			if (p.id === pinId) return { ...p, folderId, sort: sortMap.get(p.id) };
			if (sortMap.has(p.id)) return { ...p, sort: sortMap.get(p.id) };
			return p;
		});
		await scene.setFlag(MODULE_ID, FLAG_KEY, next);
	}

	/**
     * Convert this scene's Foundry Map Notes into journal pins.
     * Each pin keeps the note's position, journal/page link, text label, and
     * icon. Created in one write for efficiency.
     * @param {object} opts
     * @param {string} [opts.sceneId]
     * @param {string[]} [opts.noteIds]  convert only these notes (default: all)
     * @param {string|null} [opts.folderId]  target folder for the new pins
     * @param {boolean} [opts.deleteOriginals]  remove the converted notes afterward
     * @returns {Promise<{created:number, deleted:number}>}
     */
	static async convertNotesToPins(opts = {}) {
		if (!game.user?.isGM) throw new Error("Only GMs can convert map notes");
		const scene = this._getScene(opts.sceneId);
		let notes = scene?.notes?.contents ?? [];
		if (opts.noteIds?.length) {
			const want = new Set(opts.noteIds);
			notes = notes.filter(n => want.has(n.id));
		}
		if (!notes.length) return { created: 0, deleted: 0 };
		const folderId = opts.folderId ?? null;

		const existing = this._getScenePins(scene);
		const made = notes.map(note => {
			const src = note.texture?.src;
			// Render the note's icon faithfully: a map note is just its image
			// (raster or SVG, in its own colors), so use the "image" shape which
			// loads the texture directly. The "customIcon" path is for monochrome
			// SVG assets the user recolors — it corrupts raster PNGs and force-
			// recolors SVGs to a solid block, which is not what a note looks like.
			const style = {};
			if (src) {
				style.shape = "image";
				style.imagePath = src;
				// A note is just its image — no number/icon content on top.
				style.contentType = "none";
				const tint = normalizeImageTint(note.texture?.tint);
				if (tint) style.imageTint = tint.css;
			}
			return {
				id: foundry.utils.randomID(),
				x: note.x, y: note.y,
				journalId: note.entryId ?? null,   // NoteDocument links via entryId
				pageId: note.pageId ?? null,
				label: note.text || "Journal Pin", // note's own text label, if any
				nameSource: "auto",
				folderId,
				sort: 0,
				size: note.iconSize ?? undefined,  // keep the note's icon size
				style,
				gmOnly: false,
				requiresVision: false,
				aboveFog: false,
				hideTooltip: false,
				flags: {},
				version: PIN_SCHEMA_VERSION,
			};
		});
		await scene.setFlag(MODULE_ID, FLAG_KEY, [...existing, ...made]);

		let deleted = 0;
		if (opts.deleteOriginals) {
			const ids = notes.map(n => n.id);
			await scene.deleteEmbeddedDocuments("Note", ids);
			deleted = ids.length;
		}
		return { created: made.length, deleted };
	}

	static _styleClipboard = null;

	static copyStyle(pinData) {
		if (!pinData || !pinData.style) return;
		const style = foundry.utils.deepClone(pinData.style);

		// Exclude content-specific fields
		delete style.labelText;
		delete style.customText;
		delete style.tooltipTitle;
		delete style.tooltipContent;
		// Keep hideTooltip as it's a preference, but maybe user wants to copy it?
		// Plan said: "Delete labelText and customText".
		// User said: "dont copy things like journal, page, custom tooltips, label text".

		this._styleClipboard = style;
		ui.notifications.info("Pin style copied to clipboard.");
	}

	static async pasteStyle(targetPinId) {
		if (!this._styleClipboard) {
			ui.notifications.warn("No style in clipboard.");
			return;
		}

		const style = foundry.utils.deepClone(this._styleClipboard);
		await this.update(targetPinId, { style });
		ui.notifications.info("Pin style pasted.");
	}

	static async duplicate(pinId, options = {}) {
		const pin = this.get(pinId, options);
		if (!pin) return;

		const cloneData = foundry.utils.deepClone(pin);
		delete cloneData.id;

		// Offset by 20 pixels
		cloneData.x += 20;
		cloneData.y += 20;

		return await this.create(cloneData, options);
	}

	static hasCopiedStyle() {
		return !!this._styleClipboard;
	}

	static list(options = {}) {
		const scene = this._getScene(options.sceneId);
		return this._getScenePins(scene).map(p => foundry.utils.deepClone(p));
	}
}

/**
 * Helper to place pins via click
 */
export class PinPlacer {
	static active = false;

	static _cursor = "crosshair";

	static activate() {
		if (this.active) return;
		this.active = true;

		// Change cursor
		document.body.style.cursor = this._cursor;

		// Add listeners
		canvas.stage.on("mousedown", this._onClick);
		canvas.stage.on("rightdown", this._onRightClick);

		ui.notifications.info("Click on the canvas to place a pin. Right-click to cancel.");
	}

	static deactivate() {
		if (!this.active) return;
		this.active = false;

		// Restore cursor
		document.body.style.cursor = "";

		// Remove listeners
		canvas.stage.off("mousedown", this._onClick);
		canvas.stage.off("rightdown", this._onRightClick);
	}

	static _onClick = async event => {
		if (!PinPlacer.active) return;

		const pos = event.data.getLocalPosition(canvas.stage);

		// Create the pin
		await JournalPinManager.create({
			x: Math.round(pos.x),
			y: Math.round(pos.y),
			journalId: null,
			label: "New Pin",
		});

		PinPlacer.deactivate();
	};

	static _onRightClick = event => {
		if (!PinPlacer.active) return;
		PinPlacer.deactivate();
		ui.notifications.info("Pin placement cancelled.");
	};
}

// ================================================================
// PIN VISIBILITY CHECKS
// ================================================================

/**
 * Check if a pin is visible to the current user
 * @param {Object} pin - The pin data
 * @returns {boolean} - True if the pin should be visible
 */
export function checkPinVisibility(pin) {
	// GM can always see all pins
	if (game.user?.isGM) {
		return true;
	}
	// Check gmOnly flag
	if (pin.gmOnly) {
		return false;
	}
	// If vision is not required, pin is visible
	if (!pin.requiresVision) {
		return true;
	}
	// Check if any owned token can see the pin
	const pinPosition = { x: pin.x, y: pin.y };
	const ownedTokens = canvas.tokens.placeables.filter(t => t.isOwner);
	for (const token of ownedTokens) {
		const canSee = checkTokenCanSeePinPosition(token, pinPosition);
		if (canSee) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a token can see a pin position (adapted from checkAuraVisibility)
 * @param {Token} token - The token checking visibility
 * @param {Object} pinPosition - The pin's {x, y} position
 * @returns {boolean} - True if visible
 */
function checkTokenCanSeePinPosition(token, pinPosition) {
	if (!token?.center) {
		return false;
	}
	const startPos = token.center;
	const endPos = pinPosition;
	const gridSize = canvas.grid.size || 100;
	// Step 1: Check wall collision (line of sight)
	let isBlocked = false;
	if (window.foundry?.canvas?.geometry?.Ray) {
		if (CONFIG.Canvas?.polygonBackends?.sight?.testCollision) {
			isBlocked = CONFIG.Canvas.polygonBackends.sight.testCollision(
				startPos, endPos, { mode: "any", type: "sight" }
			);
		}
		else if (canvas.edges?.testCollision) {
			isBlocked = canvas.edges.testCollision(
				startPos, endPos, { mode: "any", type: "sight" }
			);
		}
	}
	else if (canvas.walls?.checkCollision) {
		const RayClass = foundry.canvas?.geometry?.Ray || globalThis.Ray;
		const ray = new RayClass(startPos, endPos);
		isBlocked = canvas.walls.checkCollision(ray, { mode: "any", type: "sight" });
	}
	if (isBlocked) {
		return false;
	}
	// Step 2: Determine the token's vision/light capabilities
	const distanceToPin = Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y);
	const gridDistance = canvas.scene?.grid?.distance || 5;
	const tokenVisionRange = token.document.sight?.range || 0;
	const tokenLightRange = Math.max(
		token.document.light?.dim || 0, token.document.light?.bright || 0
	);

	// Convert ranges from units (feet) to pixels
	const visionRangePixels = (tokenVisionRange / gridDistance) * gridSize;
	const lightRangePixels = (tokenLightRange / gridDistance) * gridSize;

	// Step 3: Check visibility based on token's capabilities
	const isIlluminated = isPinPositionIlluminated(pinPosition);

	if (tokenLightRange > 0 && distanceToPin <= lightRangePixels) {
		// Token's own light reaches the pin
		return true;
	}

	if (isIlluminated) {
		const effectiveRange = visionRangePixels > 0 ? visionRangePixels : (60 / gridDistance) * gridSize;
		if (distanceToPin <= effectiveRange) {
			return true;
		}
		else {
			return false;
		}
	}

	return false;
}
/**
 * Check if a position is illuminated by any light source
 * @param {Object} position - {x, y} position to check
 * @param {Token} excludeToken - Optional token whose light should be excluded from the check
 */
// FIXED - Properly converts grid units to pixels for light radii
// Replace isPinPositionIlluminated function with this
function isPinPositionIlluminated(position) {
	if (!canvas.lighting) return false;

	const gridSize = canvas.grid.size || 100;
	const gridDistance = canvas.scene?.grid?.distance || 5;

	// Check ambient light sources
	for (const light of canvas.lighting.placeables || []) {
		if (!light.document.hidden && light.document.config?.dim > 0) {
			const lightPos = { x: light.document.x, y: light.document.y };
			const distance = Math.hypot(position.x - lightPos.x, position.y - lightPos.y);
			const radiusPixels = (light.document.config.dim / gridDistance) * gridSize;

			if (distance <= radiusPixels) {
				if (!checkWallCollision(lightPos, position)) return true;
			}
		}
	}

	// Check token light sources
	for (const tokenObj of canvas.tokens.placeables || []) {
		const lightConfig = tokenObj.document.light;
		if (lightConfig && (lightConfig.dim > 0 || lightConfig.bright > 0)) {
			const tokenPos = tokenObj.center;
			const distance = Math.hypot(position.x - tokenPos.x, position.y - tokenPos.y);
			const lightUnits = Math.max(lightConfig.dim || 0, lightConfig.bright || 0);
			const radiusPixels = (lightUnits / gridDistance) * gridSize;

			if (distance <= radiusPixels) {
				if (!checkWallCollision(tokenPos, position)) return true;
			}
		}
	}
	return false;
}
/**
 * Check if there's a wall between two positions
 */
function checkWallCollision(startPos, endPos) {
	let isBlocked = false;
	if (window.foundry?.canvas?.geometry?.Ray) {
		if (CONFIG.Canvas?.polygonBackends?.sight?.testCollision) {
			isBlocked = CONFIG.Canvas.polygonBackends.sight.testCollision(
				startPos, endPos, { mode: "any", type: "sight" }
			);
		}
		else if (canvas.edges?.testCollision) {
			isBlocked = canvas.edges.testCollision(
				startPos, endPos, { mode: "any", type: "sight" }
			);
		}
	}
	else if (canvas.walls?.checkCollision) {
		const RayClass = foundry.canvas?.geometry?.Ray || globalThis.Ray;
		const ray = new RayClass(startPos, endPos);
		isBlocked = canvas.walls.checkCollision(ray, { mode: "any", type: "sight" });
	}
	return isBlocked;
}

// ================================================================
// DROP HANDLER
// ================================================================

export class JournalPinDropHandler {
	static _initialized = false;

	static _skipNoteCreation = false; // Flag to prevent default note creation

	static initialize() {
		if (this._initialized) return;

		// Hook into drop to create our pins
		Hooks.on("dropCanvasData", this._onDropCanvasData.bind(this));

		// Hook into preCreateNote to prevent default note when Ctrl is held
		Hooks.on("preCreateNote", this._onPreCreateNote.bind(this));

		this._initialized = true;
		console.log("SDX Journal Pins | Drop handler initialized");
	}

	/**
     * Prevent default note creation when we're creating an SDX pin
     */
	static _onPreCreateNote(noteDoc, data, options, userId) {
		if (this._skipNoteCreation) {
			console.log("SDX Journal Pins | Preventing default note creation");
			this._skipNoteCreation = false;
			return false; // Prevent creating the default note
		}
		return true;
	}

	/**
     * Handle drop - MUST be synchronous to return false before Foundry shows dialog
     */
	static _onDropCanvasData(canvas, data) {
		if (data.type !== "JournalEntry" && data.type !== "JournalEntryPage") {
			return; // Let Foundry handle non-journal drops
		}

		if (!game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.CONTROL)) {
			return; // No Ctrl held, let Foundry handle it normally
		}

		if (!game.user?.isGM) {
			ui.notifications.warn("Only GMs can create journal pins");
			return false; // Prevent drop but don't create pin
		}

		// Parse data synchronously
		const { x, y } = data;
		let journalId; let pageId; let label;

		if (data.type === "JournalEntry") {
			journalId = data.uuid?.split(".")?.pop() || data.id;
			pageId = null;
			const journal = game.journal.get(journalId);
			label = journal?.name || "Journal Pin";
		}
		else if (data.type === "JournalEntryPage") {
			const parts = data.uuid?.split(".") || [];
			journalId = parts[1];
			pageId = parts[3] || data.id;
			const journal = game.journal.get(journalId);
			const page = journal?.pages.get(pageId);
			label = page?.name || journal?.name || "Journal Pin";
		}

		if (!journalId) {
			console.error("SDX Journal Pins | Could not determine journal ID from drop data", data);
			return false;
		}

		// Create pin asynchronously (don't await - we need to return false NOW)
		JournalPinManager.create({
			x: Math.round(x),
			y: Math.round(y),
			journalId,
			pageId,
			label,
		}).then(() => {
			ui.notifications.info(`Created journal pin: ${label}`);
		}).catch(err => {
			console.error("SDX Journal Pins | Error creating pin:", err);
			ui.notifications.error("Failed to create journal pin");
		});

		// Return false IMMEDIATELY to prevent Foundry from showing the dialog
		console.log("SDX Journal Pins | Returning false to prevent default note dialog");
		return false;
	}
}

// ================================================================
