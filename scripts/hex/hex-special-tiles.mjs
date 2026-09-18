// Specials are landmarks, not random biome filler. Reuse the painter's asset
// scan; the full returned path identifies an exact tile, including variants.
import { getColoredTiles, getColoredTileTags, loadColoredTileAssets } from "./hex-colored-tiles.mjs";

const LANDMARK_TAGS = [
	"anvil", "camp", "castle", "cave", "cemetary", "crater", "crystal", "druidic",
	"dungeon", "farm", "gate", "grave", "keep", "lighthouse", "manor", "mausoleum",
	"mine", "monastery", "monolith", "mushroom", "oasis", "orchard", "pond", "pyramid",
	"ruin", "scarecrow", "skull", "statue", "temple", "tentacle", "tower", "town",
	"village", "volcano", "well",
];

/** GM-only catalogue. Tags describe filenames, not visually verified contents. */
export async function getSpecialTiles() {
	if (!game.user?.isGM) throw new Error("SDX | getSpecialTiles: requires GM permission");
	if (!getColoredTiles().length) await loadColoredTileAssets();
	const specials = getColoredTiles().filter(tile => tile.biome === "specials");
	return Array.from(new Map(specials.map(tile => {
		const text = tile.label.toLowerCase();
		return [tile.path, {
			id: tile.path, path: tile.path, label: tile.label,
			tags: [...new Set([
				...getColoredTileTags(tile), ...LANDMARK_TAGS.filter(tag => text.includes(tag)),
			])].sort(),
		}];
	})).values()).sort((a, b) => a.id.localeCompare(b.id));
}
