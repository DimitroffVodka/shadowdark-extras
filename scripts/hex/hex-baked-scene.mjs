/**
 * Baked hex maps, drawn on every client (hex-bake.mjs bakes them).
 *
 * A baked scene has no map Tiles. Its ground is an image pyramid (the
 * PYRAMID_FLAG): a v14 SceneManager keeps the smallest level under everything,
 * so no area is ever blank, and loads the pieces on screen at the level the
 * zoom needs, as KTX2 transcoded to a format this GPU decodes itself. This is
 * how Ember and Bastion of Blasphemies draw their maps, per the Foundry dev.
 * Pieces that leave the screen are unloaded, so GPU memory follows the view.
 *
 * Its keyed locations are sprites (the KEYED_FLAG), built on every client
 * straight into canvas.primary, which is all a Tile's picture is underneath.
 * Each client shows them by the hex fog, so showing writes nothing.
 *
 * Registered by Tile Flatten (TileFlattenSD registerTileFlattenHooks), whose
 * feature gate covers baked maps too: a bake is its successor for whole maps.
 */

import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";
import { HEX_JOURNAL_NAME } from "./HexTooltipSD.mjs";
import { getHexRecordMap } from "./hex-water-terrain.mjs";
import {
	keyedSpriteView, pieceFrame, pieceSize, piecesInView, pyramidLevel, transcodeTarget,
} from "./hex-bake-core.mjs";

const MODULE_ID = "shadowdark-extras";
/** Scene flag: { base: the pieces' folder under the data root, meta: see hex-bake-core.mjs }. */
export const PYRAMID_FLAG = "bakedPyramid";
/** Scene flag: the keyed sprites by hex offset (keyedEntries in hex-bake-core.mjs). */
export const KEYED_FLAG = "bakedKeyed";
/** Pieces fetched at once. */
const MAX_LOADING = 6;

class PyramidManager extends foundry.canvas.SceneManager {
	#data;

	#container = null;

	/** Pieces on the canvas: key → {p, mesh, texture}. */
	#pieces = new Map();

	/** The pieces the current view wants. */
	#keep = new Set();

	/** The level the current view wants. */
	#level = null;

	/** Pieces still to fetch, and those being fetched. */
	#queue = [];

	#loading = new Set();

	#scheduled = false;

	#gone = false;

	get #top() {
		return this.#data.meta.levels.length - 1;
	}

	#url(p) {
		return `${this.#data.base}/${p.level}/${p.col}_${p.row}.ktx2`;
	}

	async _onInit() {
		this.#data = this.scene.getFlag(MODULE_ID, PYRAMID_FLAG);
	}

	async _onReady() {
		const { PrimaryCanvasContainer } = foundry.canvas.primary;
		this.#container = canvas.primary.addChild(new PrimaryCanvasContainer());
		// Above the scene's own background, below every sprite in the Tiles layer.
		this.#container.sort = 1;
		const top = piecesInView(this.#data.meta, this.#top, this.#data.meta.sceneRect, 0);
		await Promise.all(top.map(async p => this.#place(p, await this.#load(p))));
		this.#update();
	}

	_registerHooks() {
		this.registerHook("canvasPan", () => this.#schedule());
	}

	async _onTearDown() {
		// Runs before the canvas groups tear down, so the meshes go first, then their textures.
		this.#gone = true;
		this.#container?.destroy({ children: true });
		for (const { texture } of this.#pieces.values()) texture.destroy(true);
		this.#pieces.clear();
	}

	/** Not through PIXI.Assets: Foundry's KTX2 loader picks its own transcode target. */
	async #load(p) {
		const target = transcodeTarget(canvas.app.renderer.context.extensions);
		const options = target ? { transcodeTarget: target } : {};
		const resource = await foundry.canvas.KTX2Parser.loadResource(this.#url(p), options);
		// The bake premultiplies its pixels, but a KTX2 made in a browser can't say so.
		const base = new PIXI.BaseTexture(resource, {
			alphaMode: PIXI.ALPHA_MODES.PREMULTIPLIED_ALPHA,
			mipmap: resource.levels > 1 ? PIXI.MIPMAP_MODES.ON_MANUAL : PIXI.MIPMAP_MODES.OFF,
		});
		// The bake pads edge pieces to whole squares; show only the picture.
		const { width, height } = pieceSize(this.#data.meta, p.level, p.col, p.row);
		return new PIXI.Texture(base, new PIXI.Rectangle(0, 0, width, height));
	}

	#place(p, texture) {
		const f = pieceFrame(this.#data.meta, p.level, p.col, p.row);
		const name = `${MODULE_ID}.pyramid.${p.key}`;
		const mesh = new foundry.canvas.primary.PrimarySpriteMesh({ texture, name });
		mesh.position.set(f.x, f.y);
		mesh.width = f.width;
		mesh.height = f.height;
		// Finer levels over coarser ones.
		mesh.sort = -p.level;
		this.#container.addChild(mesh);
		this.#pieces.set(p.key, { p, mesh, texture });
	}

	get #pending() {
		return this.#queue.length || this.#loading.size;
	}

	/**
	 * Drops the pieces the view no longer wants. Pieces of an earlier zoom stay
	 * under the new level until all of it has arrived, so a zoom never falls
	 * back to the blurry smallest level.
	 */
	#sweep() {
		const pending = this.#pending;
		for (const [key, { p, mesh, texture }] of this.#pieces) {
			if ((p.level === this.#top) || this.#keep.has(key)) continue;
			if (pending && (p.level !== this.#level)) continue;
			mesh.destroy();
			texture.destroy(true);
			this.#pieces.delete(key);
		}
	}

	/** Once per frame at most, however often the camera reports a pan. */
	#schedule() {
		if (this.#scheduled) return;
		this.#scheduled = true;
		requestAnimationFrame(() => {
			this.#scheduled = false;
			if (!this.#gone) this.#update();
		});
	}

	#update() {
		const { meta } = this.#data;
		const scale = canvas.stage.scale.x;
		const [sw, sh] = canvas.screenDimensions;
		const view = {
			x: canvas.stage.pivot.x - (sw / scale / 2), y: canvas.stage.pivot.y - (sh / scale / 2),
			width: sw / scale, height: sh / scale,
		};
		this.#level = pyramidLevel(scale * canvas.app.renderer.resolution, meta.levels.length);
		const want = this.#level === this.#top ? [] : piecesInView(meta, this.#level, view, 1);
		this.#keep = new Set(want.map(p => p.key));
		this.#queue = want.filter(p => !this.#pieces.has(p.key) && !this.#loading.has(p.key));
		this.#sweep();
		this.#pump();
	}

	#pump() {
		while ((this.#loading.size < MAX_LOADING) && this.#queue.length) {
			const p = this.#queue.shift();
			this.#loading.add(p.key);
			this.#load(p).then(texture => {
				this.#loading.delete(p.key);
				if (this.#gone || !this.#keep.has(p.key)) texture.destroy(true);
				else this.#place(p, texture);
				this.#pump();
				if (!this.#pending) this.#sweep();
			}, () => {
				this.#loading.delete(p.key);
				this.#pump();
			});
		}
	}
}

// ─── Keyed sprites ───────────────────────────────────────────────────────────

/** This canvas's keyed sprites and the hex each belongs to. */
let drawn = [];
/** Bumped per draw and teardown, so a slow texture load adds nothing to a newer canvas. */
let generation = 0;
/** The images a scene's keyed flag names, once each. */
const sourcesOf = entries => [...new Set(Object.values(entries ?? {}).flat().map(e => e.src))];

/** Hexes a record marks explored or mapped, which the fog shows (SDXHexFogSD _drawFog). */
function exploredKeys(sceneId) {
	const keys = new Set();
	for (const [key, record] of getHexRecordMap(sceneId)) {
		// Records key hexes "i_j", the fog "i-j".
		if ((record.exploration === "explored") || (record.exploration === "mapped")) keys.add(key.replace("_", "-"));
	}
	return keys;
}

function refresh() {
	if (!drawn.length) return;
	const scene = canvas.scene;
	const flags = scene.flags[MODULE_ID] ?? {};
	const fogOn = isFeatureEnabled(FEATURE_IDS.HEX_FOG) && !!flags.hexFogEnabled;
	const explored = fogOn ? exploredKeys(scene.id) : new Set();
	for (const { key, mesh } of drawn) {
		const view = keyedSpriteView({
			isGM: game.user.isGM,
			fogOn,
			shown: (flags.hexFogRevealed?.[key] === true) || explored.has(key),
			discovery: flags.hexFogDiscovery?.[key],
		});
		mesh.visible = view.visible;
		mesh.alpha = view.alpha;
	}
}

async function draw() {
	for (const { mesh } of drawn) if (!mesh.destroyed) mesh.destroy();
	drawn = [];
	const run = ++generation;
	const flag = canvas.scene?.getFlag(MODULE_ID, KEYED_FLAG);
	const entries = Object.entries(flag ?? {});
	if (!entries.length) return;
	// Loaded with the scene's own textures (canvasInit below), so this is a cache read.
	const textures = new Map(await Promise.all(sourcesOf(flag).map(async src => [
		src, await foundry.canvas.loadTexture(src),
	])));
	if (run !== generation) return;
	const { PrimarySpriteMesh } = foundry.canvas.primary;
	const { TILES } = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS;
	for (const [key, list] of entries) {
		for (const e of list) {
			const texture = textures.get(e.src);
			if (!texture) continue;
			const mesh = new PrimarySpriteMesh({ texture, name: `${MODULE_ID}.keyed.${key}` });
			canvas.primary.addChild(mesh);
			mesh.anchor.set(0.5, 0.5);
			mesh.position.set(e.x + (e.width / 2), e.y + (e.height / 2));
			mesh.width = e.width;
			mesh.height = e.height;
			mesh.elevation = e.elevation;
			mesh.sortLayer = TILES;
			mesh.sort = e.sort;
			drawn.push({ key, mesh });
		}
	}
	refresh();
}

// ─── Registration ────────────────────────────────────────────────────────────

/** A Scenes sidebar row's scene. */
const sceneOf = li => game.scenes.get((li instanceof HTMLElement ? li : li?.[0])?.dataset?.entryId);

/**
 * Baked scenes get the pyramid manager and their keyed sprites; the GM gets
 * "Bake map for play" on scenes with Tiles.
 */
export function registerBakedScenes() {
	const manage = scene => {
		const managed = CONFIG.Canvas.managedScenes;
		if (scene.getFlag(MODULE_ID, PYRAMID_FLAG)) managed[scene.id] = PyramidManager;
		else if (managed[scene.id] === PyramidManager) delete managed[scene.id];
	};
	// Tile Flatten loads this file on demand, so the world may be set up already.
	if (game.scenes) game.scenes.forEach(manage);
	else Hooks.once("setup", () => game.scenes.forEach(manage));
	Hooks.on("createScene", manage);
	Hooks.on("updateScene", (scene, changed) => {
		const ours = Object.keys(changed.flags?.[MODULE_ID] ?? {});
		if (ours.some(k => k.includes(PYRAMID_FLAG))) {
			manage(scene);
			if (scene.isView) canvas.draw();
		}
		else if (scene === canvas.scene) {
			if (ours.some(k => k.includes(KEYED_FLAG))) draw();
			else if (ours.length) refresh();
		}
	});
	// Explored and mapped records show hexes too.
	Hooks.on("updateJournalEntry", journal => {
		if (journal.name === HEX_JOURNAL_NAME) refresh();
	});

	// Load the keyed art with the scene's own textures. Otherwise Foundry expires it from
	// its cache on every scene draw and the art pops in seconds after the map.
	Hooks.on("canvasInit", c => {
		const keyed = c.scene?.getFlag(MODULE_ID, KEYED_FLAG);
		c.loadTexturesOptions.additionalSources.push(...sourcesOf(keyed));
	});
	Hooks.on("canvasReady", draw);
	Hooks.on("canvasTearDown", () => {
		drawn = [];
		generation++;
	});

	Hooks.on("getSceneContextOptions", (...args) => {
		args.find(a => Array.isArray(a))?.push({
			label: "SDX.hexBake.menu",
			icon: "<i class=\"fa-solid fa-layer-group\"></i>",
			visible: li => game.user.isGM && !!sceneOf(li)?.tiles.size,
			// Loaded on use: players never need the baker.
			onClick: async (_event, li) => (await import("./hex-bake.mjs")).bakeScene(sceneOf(li)),
		});
	});

	// ...and even drawn: a baked scene already on screen needs drawing again, with its pyramid.
	if (!canvas?.ready) return;
	if (canvas.scene?.getFlag(MODULE_ID, PYRAMID_FLAG)) canvas.draw();
	else draw();
}
