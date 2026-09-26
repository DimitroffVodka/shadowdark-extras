// Which hex terrains count as a body of water.
//
// The painter writes `terrain` from the tile's asset folder, so the four water
// folders under assets/Hexes arrive with only their first letter capitalised —
// "Water", "Water-arctic", "Water-lake", "Water-river". Older maps and the
// generators wrote "Ocean". Shadowdark Enhancer's hex hand-off writes a third
// shape through api.hex.upsertHexRecords: its terrainWord() lowercases and
// turns underscores into spaces, so an "arctic_sea" tag lands here as the two
// words "arctic sea". Matching the water noun anywhere as a whole word covers
// all three without a label list to keep in sync — an anchored match silently
// dropped "arctic sea", which is how SettlementGenerator's own hardcoded list
// went stale.
//
// The set deliberately mirrors Enhancer's COASTAL_WATER (scripts/hex-map/
// tag-store.mjs): sea, ocean, lake and river are water a hex can be on the
// shore OF, and "coast" is not — a coast hex is land, and a river reaching one
// should carry on to the sea behind it.
//
// Imports nothing by design: the canvas drawing tool reads this, and a leaf is
// what keeps that edge from dragging HexTooltipSD's generator graph (dungeon
// bridge, maphub viewer, content registry) into the drawing layer.

const MODULE_ID = "shadowdark-extras";
const HEX_JOURNAL_NAME = "__sdx_hex_data__";
const WATER_TERRAIN = /\b(water|ocean|lake|sea|river)\b/i;
// The painter's "Water-arctic" folder and the hand-off's "arctic sea" both
// carry the word whole.
const ARCTIC_TERRAIN = /\barctic\b/i;

/**
 * @param {string} label  a hex record's `terrain` field
 * @returns {boolean} true for ocean, arctic sea, lake and river terrain
 */
export function isWaterTerrain(label) {
	return WATER_TERRAIN.test(String(label ?? ""));
}

/**
 * @param {string} label  a hex record's `terrain` field
 * @returns {boolean} true for arctic water, whose shore is an ice shelf, not sand
 */
export function isArcticTerrain(label) {
	return ARCTIC_TERRAIN.test(String(label ?? ""));
}

/**
 * Every recorded hex on one scene: journal hex key ("i_j") → its stored record.
 * Read-only: the records are the journal's own objects, not copies.
 * @param {string} sceneId
 * @returns {Map<string, object>}
 */
export function getHexRecordMap(sceneId) {
	const records = new Map();
	if (!sceneId) return records;
	const journal = typeof game.journal?.find === "function"
		? game.journal.find(j => j.name === HEX_JOURNAL_NAME) : null;
	const sceneData = typeof journal?.getFlag === "function"
		? journal.getFlag(MODULE_ID, "hexData")?.[sceneId] : null;
	for (const [hexKey, record] of Object.entries(sceneData ?? {})) {
		if (record && typeof record === "object") records.set(hexKey, record);
	}
	return records;
}

/**
 * Every recorded hex on one scene: journal hex key ("i_j") → its terrain label.
 * @param {string} sceneId
 * @returns {Map<string, string>}
 */
export function getHexTerrainMap(sceneId) {
	const terrain = new Map();
	for (const [hexKey, record] of getHexRecordMap(sceneId)) {
		terrain.set(hexKey, String(record.terrain ?? ""));
	}
	return terrain;
}

/**
 * Every water hex on one scene, as journal hex keys ("i_j").
 * @param {string} sceneId
 * @returns {Set<string>}
 */
export function getWaterHexKeys(sceneId) {
	const keys = new Set();
	for (const [hexKey, label] of getHexTerrainMap(sceneId)) {
		if (isWaterTerrain(label)) keys.add(hexKey);
	}
	return keys;
}
