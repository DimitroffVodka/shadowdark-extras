/**
 * Baked hex maps — the pure parts (hex-bake.mjs bakes, hex-baked-scene.mjs draws).
 *
 * A baked map's ground is an image pyramid: the map cut into square pieces at
 * full size (level 0) and at every halving below it, down to a level that is
 * one piece. The GM bakes it inside Foundry; its `meta` is
 * { tile, sceneRect: {x, y, width, height}, levels: [{width, height, cols, rows}] }.
 * Its keyed locations stay sprites, so each shows only when its hex does.
 */

/** Keyed art (a hex's curated art, Specials or settlement tile, or its icon) carries hexNum. */
export const isKeyedTile = tile => tile.flags?.["shadowdark-extras"]?.hexNum !== undefined;

/**
 * Whether a scene can be baked: a hex map with Tiles, on one level. The bake is
 * one ground image drawn on every level, so a Tile kept to one level would show
 * on all of them.
 * @param {{grid?:{isHexagonal?:boolean}, levels?:{size:number}, tiles?:{size:number}}} scene
 */
export const bakeable = scene => !!scene?.grid?.isHexagonal && ((scene.levels?.size ?? 1) <= 1)
	&& (scene.tiles?.size > 0);

/**
 * The levels of a pyramid over a `width` × `height` picture: full size, then
 * halved (rounding up) until a level fits in one piece.
 * @returns {Array<{width:number, height:number, cols:number, rows:number}>}
 */
export function pyramidLevels(width, height, tile) {
	const levels = [];
	for (;;) {
		const cols = Math.ceil(width / tile);
		const rows = Math.ceil(height / tile);
		levels.push({ width, height, cols, rows });
		if ((cols === 1) && (rows === 1)) return levels;
		width = Math.ceil(width / 2);
		height = Math.ceil(height / 2);
	}
}

/**
 * The level whose pixels match the screen best: level 0 at 1 screen px per
 * scene px or more, one level coarser for each halving below that.
 * @param {number} screenPerScene  screen pixels per scene pixel (zoom × resolution)
 * @param {number} levels          how many levels the pyramid has
 * @returns {number}
 */
export function pyramidLevel(screenPerScene, levels) {
	const level = Math.floor(Math.log2(1 / screenPerScene));
	return Math.min(Math.max(level, 0), levels - 1);
}

/**
 * One piece's picture, in its level's pixels: `tile` square, cut short on the
 * last column and row.
 * @returns {{width:number, height:number}}
 */
export function pieceSize(meta, level, col, row) {
	const { tile } = meta;
	const L = meta.levels[level];
	return {
		width: Math.min(tile, L.width - (col * tile)),
		height: Math.min(tile, L.height - (row * tile)),
	};
}

/**
 * Where one piece sits, in scene pixels.
 * @returns {{x:number, y:number, width:number, height:number}}
 */
export function pieceFrame(meta, level, col, row) {
	const { tile, sceneRect: r } = meta;
	const L = meta.levels[level];
	const sx = r.width / L.width;
	const sy = r.height / L.height;
	const size = pieceSize(meta, level, col, row);
	return {
		x: r.x + (col * tile * sx), y: r.y + (row * tile * sy),
		width: size.width * sx, height: size.height * sy,
	};
}

/**
 * The pieces of `level` that overlap `view` (scene pixels), `margin` whole
 * pieces beyond it, nearest the view's centre first.
 * @returns {Array<{level:number, col:number, row:number, key:string}>}
 */
export function piecesInView(meta, level, view, margin = 1) {
	const { tile, sceneRect: r } = meta;
	const L = meta.levels[level];
	const pw = (tile * r.width) / L.width;
	const ph = (tile * r.height) / L.height;
	const c0 = Math.max(0, Math.floor((view.x - r.x) / pw) - margin);
	const c1 = Math.min(L.cols - 1, Math.floor((view.x + view.width - r.x) / pw) + margin);
	const r0 = Math.max(0, Math.floor((view.y - r.y) / ph) - margin);
	const r1 = Math.min(L.rows - 1, Math.floor((view.y + view.height - r.y) / ph) + margin);
	const cx = view.x + (view.width / 2);
	const cy = view.y + (view.height / 2);
	const out = [];
	for (let col = c0; col <= c1; col++) {
		for (let row = r0; row <= r1; row++) out.push({ level, col, row, key: `${level}/${col}_${row}` });
	}
	const dist = p => Math.hypot(r.x + ((p.col + 0.5) * pw) - cx, r.y + ((p.row + 0.5) * ph) - cy);
	return out.sort((a, b) => dist(a) - dist(b));
}

/**
 * The KTX2 transcode target for this GPU: desktop formats first, ASTC after.
 * Foundry's own KTX2 loader tries ASTC first, but Mesa (Linux, the Steam Deck)
 * reports ASTC on GPUs without it and decodes it in software: a 1024 px piece
 * took 47–63 ms to upload on the Deck, against 3–5 ms as BC7.
 * @param {object} extensions  renderer.context.extensions: the GPU's compressed formats
 * @returns {string|undefined} a libktx TranscodeTarget name; undefined leaves the choice to Foundry
 */
export function transcodeTarget(extensions) {
	if (extensions.bptc) return "BC7_RGBA";
	if (extensions.s3tc) return "BC1_OR_3";
	if (extensions.astc) return "ASTC_4x4_RGBA";
	if (extensions.etc) return "ETC2_RGBA";
	return undefined;
}

/**
 * The scale a Tile's picture draws at: PrimarySpriteMesh#resize for its `fit`
 * (fill stretches to the Tile's size), times the Tile's own scaleX and scaleY,
 * which mirror when negative.
 * @returns {{x:number, y:number}}
 */
export function fitScale(
	fit, width, height, textureWidth, textureHeight, scaleX = 1, scaleY = 1
) {
	const sx = width / textureWidth;
	const sy = height / textureHeight;
	const both = { cover: Math.max(sx, sy), contain: Math.min(sx, sy), width: sx, height: sy }[fit];
	return { x: (both ?? sx) * scaleX, y: (both ?? sy) * scaleY };
}

/**
 * Fills a square piece's padding in place. The picture sits top-left, `width`
 * × `height` of `size` × `size` RGBA pixels; the rest repeats its last column
 * and row, so filtering at the picture's edge never reaches past it.
 * Compressed formats want whole squares, so edge pieces are padded.
 * @returns {Uint8Array} the same pixels
 */
export function padPiece(pixels, size, width, height) {
	const row = size * 4;
	for (let y = 0; y < height; y++) {
		const edge = (y * row) + ((width - 1) * 4);
		for (let x = width; x < size; x++) pixels.copyWithin((y * row) + (x * 4), edge, edge + 4);
	}
	const last = (height - 1) * row;
	for (let y = height; y < size; y++) pixels.copyWithin(y * row, last, last + row);
	return pixels;
}

/**
 * A square RGBA picture and its mip levels down to 1 px, each averaging 2 × 2
 * pixels of the last, as WebGL's generateMipmap does. The averaging runs on
 * the stored values (Foundry draws in gamma space, so an sRGB-aware filter
 * would shift tones) and on premultiplied pixels (so edges don't darken).
 * @returns {Uint8Array[]} level 0 first
 */
export function mipChain(pixels, size) {
	const out = [pixels];
	for (let s = size >> 1, src = pixels; s >= 1; s >>= 1) {
		const dst = new Uint8Array(s * s * 4);
		const stride = s * 8;
		for (let y = 0; y < s; y++) {
			for (let x = 0; x < s; x++) {
				const a = (y * 2 * stride) + (x * 8);
				const b = a + stride;
				const o = ((y * s) + x) * 4;
				for (let c = 0; c < 4; c++) {
					const sum = src[a + c] + src[a + 4 + c] + src[b + c] + src[b + 4 + c];
					dst[o + c] = (sum + 2) >> 2;
				}
			}
		}
		out.push(dst);
		src = dst;
	}
	return out;
}

/**
 * Where a Tile's rectangle centres. A v14 Tile's x and y are its anchor point,
 * which the rectangle turns about, as Foundry's RectangleShapeData places it.
 * @param {{x:number, y:number, width:number, height:number, rotation?:number,
 *   texture?:{anchorX?:number, anchorY?:number}}} tile
 * @returns {{x:number, y:number}}
 */
export function tileCentre({ x, y, width, height, rotation = 0, texture = {} }) {
	const dx = (0.5 - (texture.anchorX ?? 0.5)) * width;
	const dy = (0.5 - (texture.anchorY ?? 0.5)) * height;
	const a = rotation * Math.PI / 180;
	return { x: x + (dx * Math.cos(a)) - (dy * Math.sin(a)), y: y + (dx * Math.sin(a)) + (dy * Math.cos(a)) };
}

/**
 * The keyed sprites of a baked scene, by hex offset "i-j" (the key the fog uses).
 * Each keeps what the Tile's mesh shows: its anchor, turn, fit, scale (and
 * mirror), tint and alpha, so the sprite looks as the Tile did.
 * @param {Array<object>} tiles  keyed tile data, as TileDocument#toObject gives it
 * @param {(point:{x:number, y:number}) => {i:number, j:number}} offsetOf  grid.getOffset
 * @returns {Object<string, Array<{src:string, x:number, y:number, width:number, height:number,
 *   anchorX:number, anchorY:number, rotation:number, fit:string, scaleX:number, scaleY:number,
 *   tint:string, alpha:number, sort:number, elevation:number, num:number}>>}
 */
export function keyedEntries(tiles, offsetOf) {
	const out = {};
	for (const tile of tiles) {
		const { i, j } = offsetOf(tileCentre(tile));
		const t = tile.texture ?? {};
		(out[`${i}-${j}`] ??= []).push({
			src: t.src, x: tile.x, y: tile.y, width: tile.width, height: tile.height,
			anchorX: t.anchorX ?? 0.5, anchorY: t.anchorY ?? 0.5, rotation: tile.rotation ?? 0,
			fit: t.fit ?? "fill", scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1,
			tint: t.tint ?? "#ffffff", alpha: tile.alpha ?? 1,
			sort: tile.sort ?? 0, elevation: tile.elevation ?? 0,
			num: tile.flags["shadowdark-extras"].hexNum,
		});
	}
	return out;
}

/**
 * How one keyed sprite shows on this client. A player sees a hex's points of
 * interest once the fog shows the hex (revealed, or explored or mapped in its
 * record) and it wasn't only seen from afar: discovery "terrain" gives the
 * terrain alone, as playerHexRecord does. The GM sees every sprite, faded
 * where the players can't, the way Foundry shows the GM a hidden tile.
 * @param {{isGM:boolean, fogOn:boolean, shown:boolean, discovery?:string}} state
 * @returns {{visible:boolean, alpha:number}}
 */
export function keyedSpriteView({ isGM, fogOn, shown, discovery }) {
	const seen = !fogOn || (shown && (discovery !== "terrain"));
	if (isGM) return { visible: true, alpha: seen ? 1 : 0.5 };
	return { visible: seen, alpha: 1 };
}
