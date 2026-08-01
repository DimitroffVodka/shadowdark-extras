// DungeonBiomesSD.mjs
//
// Biome theming for the procedural dungeon generator: each room is assigned a
// biome (crypt, library, temple, …) that sets its floor texture and scatters
// themed props. Floors + props use shipped assets out of the box; if the user
// has imported a Dungeondraft decor pack with a matching category, those props
// are mixed in too (best-effort, never required).

const MODULE_ID = "shadowdark-extras";
const GRID_SIZE = 100;

const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

const FLOOR = (f) => `modules/${MODULE_ID}/assets/Dungeon/floor_tiles/${f}`;
const CLUT = (f) => `modules/${MODULE_ID}/assets/Dungeon/clutter/${f}`;

/**
 * Biome definitions. floor = shipped floor tile; props = shipped clutter
 * (filenames carry -WxH); ddpack = decor-library category name to also pull
 * from if present; weight = relative frequency when assigning.
 */
export const BIOME_DEFS = {
	hall:       { label: "Hall",       floor: FLOOR("DQ_Floor_Stone_01.webp"),         props: [CLUT("pillar-50x50.webp"), CLUT("statue-100x100.webp")],                              ddpack: "hall",       weight: 2 },
	crypt:      { label: "Crypt",      floor: FLOOR("DQ_Floor_Stone_05_black.webp"),   props: [CLUT("skull-26x30.webp"), CLUT("statue2-100x100.webp"), CLUT("rubble-100x100.webp")], ddpack: "crypt",      weight: 1 },
	library:    { label: "Library",    floor: FLOOR("DQ_Floor_Stone_04_yellow.webp"),  props: [CLUT("paper-50x50.webp"), CLUT("pillar-50x50.webp")],                                 ddpack: "library",    weight: 1 },
	temple:     { label: "Temple",     floor: FLOOR("DQ_Floor_Stone_02_blue.webp"),    props: [CLUT("statue-100x100.webp"), CLUT("fountain-100x100.webp"), CLUT("pillar-50x50.webp")], ddpack: "temple",     weight: 1 },
	laboratory: { label: "Laboratory", floor: FLOOR("DQ_Floor_Stone_03.webp"),         props: [CLUT("glass-50x50.webp"), CLUT("paper-50x50.webp")],                                  ddpack: "laboratory", weight: 1 },
	barracks:   { label: "Barracks",   floor: FLOOR("DQ_Floor_Cobble_01A.webp"),       props: [CLUT("rubble2-100x100.webp")],                                                       ddpack: "barracks",   weight: 1 },
	prison:     { label: "Prison",     floor: FLOOR("DQ_Floor_Stone_02_black.webp"),   props: [CLUT("skull-26x30.webp"), CLUT("rubble-100x100.webp")],                               ddpack: "prison",     weight: 1 },
	storage:    { label: "Storage",    floor: FLOOR("DQ_Floor_Cobble_02A_light.webp"), props: [CLUT("rubble2-100x100.webp"), CLUT("glass-50x50.webp")],                              ddpack: "storage",    weight: 1 },
	ruins:      { label: "Ruins",      floor: FLOOR("DQ_Floor_Stone_04_red.webp"),     props: [CLUT("rubble-100x100.webp"), CLUT("rubble2-100x100.webp"), CLUT("pillar-50x50.webp")], ddpack: "ruins",      weight: 2 },
};

// ── Custom biome persistence (Ticket 5, slice 1) ───────────────────────────
// Users can add or override biomes via a world setting; the generator merges
// them over the built-in BIOME_DEFS. An editor UI lands in a later slice — for
// now these are driven through module.api (getBiomeDefinitions / setCustomBiome
// / removeCustomBiome / resetCustomBiomes).

Hooks.once("init", () => {
	try {
		game.settings.register(MODULE_ID, "customBiomes", {
			name: "Custom Dungeon Biomes",
			hint: "User-defined biome overrides/additions for the dungeon generator.",
			scope: "world",
			config: false,
			type: Object,
			default: {},
		});
		game.settings.register(MODULE_ID, "disabledBiomes", {
			name: "Disabled Dungeon Biomes",
			hint: "Biome keys excluded from random room assignment.",
			scope: "world",
			config: false,
			type: Array,
			default: [],
		});
	} catch (_) { /* already registered */ }
});

/** Read the persisted custom-biome map (always a plain object). */
export function getCustomBiomes() {
	try {
		const c = game.settings.get(MODULE_ID, "customBiomes");
		return (c && typeof c === "object") ? c : {};
	} catch (_) { return {}; }
}

/** Coerce a raw biome definition to a safe shape, layering over an optional base. */
function normalizeBiomeDef(key, raw, base = null) {
	if (!raw || typeof raw !== "object") return null;
	const def = base ? { ...base } : {};
	if (typeof raw.label === "string" && raw.label.trim()) def.label = raw.label.trim();
	else if (!def.label) def.label = key;
	if (typeof raw.floor === "string" && raw.floor.trim()) def.floor = raw.floor.trim();
	if (Array.isArray(raw.props)) def.props = raw.props.filter(p => typeof p === "string" && p);
	else if (!Array.isArray(def.props)) def.props = [];
	const w = Number(raw.weight);
	if (Number.isFinite(w) && w > 0) def.weight = w;
	else if (!Number.isFinite(def.weight)) def.weight = 1;
	if (typeof raw.ddpack === "string") def.ddpack = raw.ddpack;
	// A biome is only usable if it resolves to a floor texture.
	if (!def.floor) return null;
	return def;
}

/** Built-in BIOME_DEFS merged with the user's persisted custom biomes (custom wins). */
export function getBiomeDefs() {
	const merged = { ...BIOME_DEFS };
	const custom = getCustomBiomes();
	for (const [key, raw] of Object.entries(custom)) {
		const def = normalizeBiomeDef(key, raw, BIOME_DEFS[key] || null);
		if (def) merged[key] = def;
	}
	return merged;
}

/** Add or override a biome; persists to the world setting. Returns the stored def. */
export async function setCustomBiome(key, def) {
	if (!key || typeof key !== "string") throw new Error("A biome key (string) is required.");
	const norm = normalizeBiomeDef(key, def, BIOME_DEFS[key] || null);
	if (!norm) throw new Error("Biome definition needs at least a `floor` texture path.");
	const custom = { ...getCustomBiomes(), [key]: norm };
	await game.settings.set(MODULE_ID, "customBiomes", custom);
	return norm;
}

/** Remove a user-defined biome (built-ins can only be overridden, not deleted). */
export async function removeCustomBiome(key) {
	const custom = { ...getCustomBiomes() };
	if (!(key in custom)) return false;
	delete custom[key];
	await game.settings.set(MODULE_ID, "customBiomes", custom);
	return true;
}

/** Clear all user-defined biome overrides/additions. */
export async function resetCustomBiomes() {
	await game.settings.set(MODULE_ID, "customBiomes", {});
}

/** Keys the user has turned OFF (denylist; new biomes are enabled by default). */
export function getDisabledBiomes() {
	try {
		const d = game.settings.get(MODULE_ID, "disabledBiomes");
		return Array.isArray(d) ? d : [];
	} catch (_) { return []; }
}

/** Biome keys eligible for random room assignment = all defs minus the denylist. */
export function getEnabledBiomeKeys() {
	const disabled = new Set(getDisabledBiomes());
	return Object.keys(getBiomeDefs()).filter(k => !disabled.has(k));
}

/** Toggle whether a biome participates in random room assignment. */
export async function setBiomeEnabled(key, enabled) {
	if (!key || typeof key !== "string") throw new Error("A biome key (string) is required.");
	const disabled = new Set(getDisabledBiomes());
	if (enabled) disabled.delete(key);
	else disabled.add(key);
	await game.settings.set(MODULE_ID, "disabledBiomes", [...disabled]);
	return enabled;
}

/**
 * Assign a biome to each room. Returns Map(roomIndex -> biomeKey). The start
 * room is a "hall" (entrance); the rest are weighted-random from `enabled`.
 */
export function assignBiomes(roomData, rng, enabled = null) {
	const defs = getBiomeDefs();
	const keys = (enabled && enabled.length ? enabled : Object.keys(defs)).filter(k => defs[k]);
	const pool = [];
	for (const k of keys) for (let i = 0; i < (defs[k].weight || 1); i++) pool.push(k);
	const map = new Map();
	roomData.forEach((rd, i) => {
		if (rd.isStart && defs.hall) { map.set(i, "hall"); return; }
		map.set(i, pool.length ? pool[Math.floor(rng() * pool.length)] : "hall");
	});
	return map;
}

/**
 * Map each room-interior floor cell to its biome's floor texture.
 * Returns Map("gx,gy" -> texturePath). Corridors / cave cells are absent
 * (caller falls back to the default floor for those).
 */
export function buildCellFloorMap(roomData, biomeMap, floors) {
	const defs = getBiomeDefs();
	const cellFloor = new Map();
	roomData.forEach((rd, i) => {
		const biome = biomeMap.get(i);
		const def = biome && defs[biome];
		if (!def) return;
		const room = rd.room;
		for (let gx = room.left; gx < room.right; gx++) {
			for (let gy = room.top; gy < room.bottom; gy++) {
				const k = `${gx},${gy}`;
				if (floors.has(k)) cellFloor.set(k, def.floor);
			}
		}
	});
	return cellFloor;
}

/** Best-effort: image files in an imported decor pack folder matching `category`. */
async function findDDPackProps(category) {
	if (!category) return [];
	const isImg = (f) => /\.(png|webp|jpg|jpeg)$/i.test(f);
	const roots = ["decor/ddpacks", "decor"];
	for (const root of roots) {
		try {
			const top = await FilePicker.browse("data", root);
			for (const dir of (top.dirs || [])) {
				if (dir.split("/").pop().toLowerCase().includes(category.toLowerCase())) {
					const sub = await FilePicker.browse("data", dir);
					const files = (sub.files || []).filter(isImg);
					if (files.length) return files.slice(0, 12);
				}
			}
		} catch (e) { /* path absent — fine */ }
	}
	return [];
}

/** Resolve a biome's prop list to [{src, w, h}] (shipped + any DDPack matches). */
async function resolveBiomeProps(def) {
	const items = [];
	for (const p of def.props) {
		const m = p.match(/-(\d+)x(\d+)\.\w+$/i);
		items.push({ src: p, w: m ? +m[1] : GRID_SIZE, h: m ? +m[2] : GRID_SIZE });
	}
	for (const f of await findDDPackProps(def.ddpack)) {
		items.push({ src: f, w: GRID_SIZE, h: GRID_SIZE });
	}
	return items;
}

/**
 * Scatter biome props inside each non-start room. Returns Tile create-data
 * (same shape/flags as generic clutter so cleanup catches them).
 */
export async function placeBiomeProps(roomData, biomeMap, offset, gridSize, perRoom, rng, occupancy = null) {
	const defs = getBiomeDefs();
	const cache = new Map();
	const tiles = [];
	for (let i = 0; i < roomData.length; i++) {
		const rd = roomData[i];
		if (rd.isStart) continue;
		const biome = biomeMap.get(i);
		const def = biome && defs[biome];
		if (!def) continue;

		if (!cache.has(biome)) cache.set(biome, await resolveBiomeProps(def));
		const items = cache.get(biome);
		if (!items.length) continue;

		const room = rd.room;
		// Use the shared dungeon occupancy map when provided (so props avoid
		// doors, stairs, clutter, and each other); otherwise fall back to a
		// local per-room set so the function stays standalone-safe.
		const localOccupied = occupancy ? null : new Set();
		const canPlace = (gx, gy, cellsW, cellsH) => {
			if (occupancy) return occupancy.canPlaceRect({ gx, gy, cellsW, cellsH }, { padding: 0.15, doorPadding: 0.35 });
			for (let ox = 0; ox < cellsW; ox++)
				for (let oy = 0; oy < cellsH; oy++)
					if (localOccupied.has(`${gx + ox},${gy + oy}`)) return false;
			return true;
		};
		const reserve = (gx, gy, cellsW, cellsH) => {
			if (occupancy) { occupancy.occupyRect({ gx, gy, cellsW, cellsH }, { padding: 0.15, kind: "biome" }); return; }
			for (let ox = 0; ox < cellsW; ox++)
				for (let oy = 0; oy < cellsH; oy++)
					localOccupied.add(`${gx + ox},${gy + oy}`);
		};
		for (let c = 0; c < perRoom; c++) {
			const item = items[Math.floor(rng() * items.length)];
			const cellsW = Math.max(1, Math.ceil(item.w / gridSize));
			const cellsH = Math.max(1, Math.ceil(item.h / gridSize));
			const fitW = room.w - (cellsW - 1);
			const fitH = room.h - (cellsH - 1);
			if (fitW < 1 || fitH < 1) continue;

			let gx; let gy; let overlaps; let tries = 0;
			do {
				gx = room.left + Math.floor(rng() * fitW);
				gy = room.top + Math.floor(rng() * fitH);
				overlaps = !canPlace(gx, gy, cellsW, cellsH);
				tries++;
			} while (overlaps && tries < 20);
			if (overlaps) continue;

			reserve(gx, gy, cellsW, cellsH);

			tiles.push({
				texture: { src: item.src, anchorX: 0, anchorY: 0 },
				x: (gx + offset.x) * gridSize + (cellsW * gridSize - item.w) / 2,
				y: (gy + offset.y) * gridSize + (cellsH * gridSize - item.h) / 2,
				width: item.w,
				height: item.h,
				sort: 10,
				flags: { [MODULE_ID]: { dungeonClutter: true, dungeonBiomeProp: true, biome } },
			});
		}
	}
	return tiles;
}
