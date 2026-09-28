/**
 * Baked hex maps — the GM bake (hex-baked-scene.mjs draws the result).
 *
 * The GM picks "Bake map for play" on a scene in the Scenes sidebar. Its
 * ground (every visible picture Tile except keyed art) is drawn on the GPU one
 * 1024 px piece at a time, for every level of the pyramid, each Tile placed
 * the way Foundry places its mesh (placeables/tile.mjs _refreshSize). Web
 * Workers encode the pieces to KTX2 with Foundry's own libktx, using the
 * settings Foundry's dev gave for Bastion of Blasphemies: RGBA UNORM, linear
 * transfer, premultiplied alpha, ETC1S quality 180. The pieces are saved in
 * the world folder, and a new "(baked)" copy of the scene draws them, with its
 * keyed art as sprites, its hex records copied, and none of the Tiles it
 * replaced. The source scene is only read, so the painted map stays editable:
 * bake it again after changes.
 *
 * Unlike Tile Flatten's hex background (one WebP of at most 8192 px, in
 * place), the pyramid keeps full resolution and loads only what is on screen.
 */

import { getHexRecordMap } from "./hex-water-terrain.mjs";
import { mergeHexRecords } from "./HexTooltipSD.mjs";
import { KEYED_FLAG, PYRAMID_FLAG } from "./hex-baked-scene.mjs";
import {
	bakeable, fitScale, isKeyedTile, keyedEntries, mipChain, padPiece, pieceSize, pyramidLevels,
} from "./hex-bake-core.mjs";

const MODULE_ID = "shadowdark-extras";
const TILE = 1024;
/** ETC1S quality as the dev gave it. Effort 1, not his 3: 5× slower in a browser, for 0.3 dB. */
const QLEVEL = 180;
const CLEVEL = 1;

let baking = false;

/** A picture players see that isn't keyed art: what the pyramid replaces. */
const isGround = tile => !tile.hidden && !!tile.texture.src && !isKeyedTile(tile)
	&& !foundry.helpers.media.VideoHelper.hasVideoExtension(tile.texture.src);

/**
 * Bake `source` into a new scene. GM only.
 * @param {Scene} source
 * @returns {Promise<Scene|undefined>} the baked copy
 */
export async function bakeScene(source) {
	const say = (key, data) => game.i18n.format(key, { name: source.name, ...data });
	if (baking) {
		ui.notifications.warn(say("SDX.hexBake.busy"));
		return;
	}
	if (!bakeable(source)) {
		ui.notifications.warn(say("SDX.hexBake.unsupported"));
		return;
	}
	const renderer = canvas.app?.renderer;
	if (!renderer) {
		ui.notifications.error(say("SDX.hexBake.noCanvas"));
		return;
	}
	const ground = source.tiles.filter(isGround)
		.sort((a, b) => (a.elevation - b.elevation) || (a.sort - b.sort));
	if (!ground.length) {
		ui.notifications.warn(say("SDX.hexBake.nothing"));
		return;
	}
	const keyed = source.tiles.filter(t => !t.hidden && isKeyedTile(t));

	baking = true;
	const started = performance.now();
	const id = foundry.utils.randomID();
	const base = `worlds/${game.world.id}/baked-maps/${id}`;
	const rect = source.getDimensions().sceneRect;
	const meta = {
		tile: TILE,
		sceneRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		levels: pyramidLevels(rect.width, rect.height, TILE),
	};
	const pieces = meta.levels.flatMap((L, level) => Array.from({ length: L.cols * L.rows },
		(_, k) => ({ level, col: k % L.cols, row: Math.floor(k / L.cols) })));
	const progress = done => say("SDX.hexBake.progress", { done, total: pieces.length });
	const note = ui.notifications.info(progress(0), { progress: true });
	const srcs = [...new Set(ground.map(t => t.texture.src))];
	const stage = new PIXI.Container();
	const target = PIXI.RenderTexture.create({ width: TILE, height: TILE, resolution: 1 });
	const workers = [];
	try {
		// A scene change mid-bake must not expire the art from Foundry's cache.
		for (const src of srcs) foundry.canvas.TextureLoader.pinSource(src);
		const drawn = await groundSprites(ground, stage);
		await makeFolders(base, meta.levels.length);
		await startWorkers(workers);

		// Each worker takes the next piece until none are left, or another worker failed.
		const run = { next: 0, done: 0, stop: false };
		const results = await Promise.allSettled(workers.map(async worker => {
			try {
				while (!run.stop && (run.next < pieces.length)) {
					const p = pieces[run.next++];
					const pixels = renderPiece(renderer, stage, drawn, target, meta, p);
					const levels = mipChain(pixels, TILE);
					const options = { clevel: CLEVEL, qlevel: QLEVEL };
					const transfer = levels.map(l => l.buffer);
					const bytes = await worker.executeFunction("encodeBakePiece", [levels, options], transfer);
					await save(`${base}/${p.level}`, `${p.col}_${p.row}.ktx2`, bytes);
					run.done++;
					note.update({ pct: run.done / pieces.length, message: progress(run.done) });
				}
			}
			catch(err) {
				run.stop = true;
				throw err;
			}
		}));
		const failed = results.find(r => r.status === "rejected");
		if (failed) throw failed.reason;

		const name = say("SDX.hexBake.sceneName");
		const replaced = [...ground, ...keyed];
		const copy = await createCopy(source, id, name, replaced, keyed, { base, meta });
		// Hex records (names, terrain, notes, exploration) are kept per scene id: a copy has none.
		const records = getHexRecordMap(source.id);
		if (records.size) await mergeHexRecords(copy.id, Object.fromEntries(records));
		const seconds = Math.round((performance.now() - started) / 1000);
		const done = { copy: copy.name, pieces: pieces.length, seconds };
		ui.notifications.info(say("SDX.hexBake.done", done));
		return copy;
	}
	catch(err) {
		console.error(`${MODULE_ID} | baking ${source.name} failed`, err);
		ui.notifications.error(say("SDX.hexBake.failed", { error: err.message, path: base }));
	}
	finally {
		if (ui.notifications.has(note)) ui.notifications.remove(note);
		for (const worker of workers) worker.terminate();
		stage.destroy({ children: true });
		target.destroy(true);
		for (const src of srcs) foundry.canvas.TextureLoader.unpinSource(src);
		baking = false;
	}
}

/** One sprite per ground Tile, placed as the Tile places its mesh, with its scene bounds. */
async function groundSprites(ground, stage) {
	const srcs = [...new Set(ground.map(t => t.texture.src))];
	const load = async src => [src, await foundry.canvas.loadTexture(src)];
	const textures = new Map(await Promise.all(srcs.map(load)));
	const drawn = [];
	for (const tile of ground) {
		const texture = textures.get(tile.texture.src);
		if (!texture) continue;
		const { x, y, width, height, anchorX, anchorY, rotation } = tile.shape;
		const { fit, scaleX, scaleY, tint } = tile.texture;
		const sprite = stage.addChild(new PIXI.Sprite(texture));
		const scale = fitScale(fit, width, height, texture.width, texture.height, scaleX, scaleY);
		sprite.scale.set(scale.x, scale.y);
		sprite.anchor.set(anchorX, anchorY);
		sprite.position.set(x, y);
		sprite.angle = rotation;
		sprite.alpha = tile.alpha;
		sprite.tint = tint;
		const b = sprite.getBounds();
		drawn.push({ sprite, left: b.left, top: b.top, right: b.right, bottom: b.bottom });
	}
	return drawn;
}

/** One piece: the sprites under it drawn at its level's scale, read back premultiplied, padded. */
function renderPiece(renderer, stage, drawn, target, meta, p) {
	const { sceneRect: r } = meta;
	const L = meta.levels[p.level];
	const sx = L.width / r.width;
	const sy = L.height / r.height;
	const x0 = r.x + ((p.col * TILE) / sx);
	const y0 = r.y + ((p.row * TILE) / sy);
	const x1 = x0 + (TILE / sx);
	const y1 = y0 + (TILE / sy);
	for (const d of drawn) {
		d.sprite.renderable = (d.right > x0) && (d.left < x1) && (d.bottom > y0) && (d.top < y1);
	}
	const tx = -(r.x * sx) - (p.col * TILE);
	const ty = -(r.y * sy) - (p.row * TILE);
	const transform = new PIXI.Matrix(sx, 0, 0, sy, tx, ty);
	const options = { renderTexture: target, clear: true, transform, skipUpdateTransform: true };
	renderer.render(stage, options);
	// Not renderer.extract.pixels: it un-premultiplies, and the encoder wants premultiplied pixels.
	const gl = renderer.gl;
	const pixels = new Uint8Array(TILE * TILE * 4);
	renderer.renderTexture.bind(target);
	gl.readPixels(0, 0, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	renderer.renderTexture.bind(null);
	const { width, height } = pieceSize(meta, p.level, p.col, p.row);
	return padPiece(pixels, TILE, width, height);
}

async function makeFolders(base, levels) {
	const FP = foundry.applications.apps.FilePicker.implementation;
	// The shared parent may be there from an earlier bake; this bake's own folders are new.
	await FP.createDirectory("data", base.slice(0, base.lastIndexOf("/"))).catch(() => {});
	await FP.createDirectory("data", base);
	for (let level = 0; level < levels; level++) await FP.createDirectory("data", `${base}/${level}`);
}

/** One encoder per spare core, up to 8: the page's WASM has no threads of its own. */
async function startWorkers(workers) {
	const count = Math.clamp((navigator.hardwareConcurrency || 4) - 1, 1, 8);
	const wasmPath = foundry.utils.getRoute("scripts/ktx2/libktx.wasm");
	const wasm = new URL(wasmPath, window.location.href).href;
	// AsyncWorker routes script paths itself, so give it this file's path from the route root.
	const root = foundry.utils.getRoute("/");
	const encoder = new URL("./hex-bake-worker.js", import.meta.url).pathname.slice(root.length);
	const scripts = ["scripts/ktx2/libktx.js", encoder];
	for (let i = 0; i < count; i++) {
		workers.push(new foundry.helpers.AsyncWorker(`${MODULE_ID}.bake.${i}`, { scripts }));
	}
	await Promise.all(workers.map(async worker => {
		await worker.ready;
		await worker.executeFunction("initializeBakeEncoder", [wasm]);
	}));
}

async function save(dir, name, bytes) {
	const file = new File([bytes], name, { type: "image/ktx2" });
	const FP = foundry.applications.apps.FilePicker.implementation;
	const res = await FP.upload("data", dir, file, {}, { notify: false });
	if (!res?.path) throw new Error(`could not save ${dir}/${name}`);
}

/** The source without the Tiles the bake replaced, plus the pyramid and keyed art as sprites. */
async function createCopy(source, id, name, replaced, keyed, pyramid) {
	const data = source.toObject();
	const gone = new Set(replaced.map(t => t.id));
	data._id = id;
	data.name = name;
	data.active = false;
	data.tiles = data.tiles.filter(t => !gone.has(t._id));
	const offsetOf = point => source.grid.getOffset(point);
	data.flags[MODULE_ID] = {
		...data.flags[MODULE_ID],
		[KEYED_FLAG]: keyedEntries(keyed.map(t => t.toObject()), offsetOf),
		[PYRAMID_FLAG]: pyramid,
	};
	return Scene.implementation.create(data, { keepId: true });
}
