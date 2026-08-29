/**
 * Version-stamped IndexedDB catalogues for the module's SHIPPED assets.
 *
 * The hex painter caches a FilePicker scan of each folder this module ships, so
 * opening it does not re-walk ~200 files on every boot. Those catalogues were
 * stored as a bare array with no stamp and no expiry, which made them
 * permanent: once written they were returned forever and the folder was never
 * scanned again.
 *
 * That turned the PNG -> WebP conversion (1156d58e) into a silent breakage. A
 * browser profile that had opened the painter before the conversion kept a
 * catalogue full of `.png` paths whose files no longer exist, so the hex
 * generator built Tiles from dead paths and Foundry logged
 * `Error: Invalid Asset .../Hex - Mountains, medium (lush).png` for each one.
 * Foundry's own file browser reads the real filesystem and showed `.webp` -
 * that disagreement between the two views is the signature of this bug.
 *
 * WebpMigrationSD does not cover it. That migration rewrites paths stored in
 * the world database (scene tiles, settings, flags); IndexedDB is per-browser
 * rather than per-world, it is never consulted there, and the migration is
 * gated to run once per world so it cannot retroactively help anyone.
 *
 * The stamp is the module's own version, so publishing any release invalidates
 * every shipped-asset catalogue and the next load re-scans. A hand-bumped
 * constant would not have prevented this: the asset conversion was precisely
 * the commit that would have had to remember to bump it. DungeonPainterSD hit
 * the same bug and pinned a literal `DUNGEON_TILE_CACHE_VERSION = 1`, which
 * repaired the PNG damage but left the next asset change to break the same way;
 * it now stamps through here too.
 *
 * A catalogue is whatever its owner stores under one key: the hex painters keep
 * a flat array of tiles, the dungeon painter an object holding four such arrays
 * (floor, wall, door, background). The envelope therefore treats `entries` as
 * opaque and never inspects its shape. What it does still reject is a *bare*
 * payload — a legacy catalogue was written as an unwrapped array, so anything
 * arriving without an envelope around it is stale by construction.
 */

import { cache } from "./SDXCache.mjs";
import { MODULE_ID } from "./module-id.mjs";

/**
 * The stamp written beside a catalogue, or null when it cannot be determined.
 *
 * Returning null deliberately disables the cache rather than falling back to a
 * placeholder: two different module versions sharing one stamp is exactly the
 * failure this module exists to prevent, and re-running a folder scan is cheap
 * next to handing the generator paths that 404.
 *
 * Read through `globalThis` rather than the bare `game` binding, so that a
 * caller running before Foundry has bound the global gets that null instead of
 * a ReferenceError — an unresolvable version is precisely the case this is
 * documented to answer.
 *
 * @returns {string|null}
 */
export function shippedAssetCacheVersion() {
	const version = globalThis.game?.modules?.get?.(MODULE_ID)?.version;
	return typeof version === "string" && version ? version : null;
}

/**
 * Read a catalogue, but only if it was written by the running module version.
 *
 * @param {string} key - IndexedDB metadata key.
 * @returns {Promise<Array|object|null>} The cached catalogue, or null to force a
 *   rescan.
 */
export async function readShippedManifest(key) {
	const version = shippedAssetCacheVersion();
	if (!version) return null;

	const cached = await cache.getMetadata(key);
	// Legacy catalogues were written as a bare array with no stamp. Anything
	// that is not an envelope carrying this exact version is rescanned rather
	// than trusted - including the pre-WebP arrays this module exists to evict.
	if (!cached || Array.isArray(cached) || cached.version !== version) return null;

	// `entries` is opaque: an array for the hex catalogues, an object of four
	// arrays for the dungeon one. Only its absence forces a rescan.
	return cached.entries ?? null;
}

/**
 * Persist a catalogue under the running module version.
 *
 * Writes through the same key the unstamped catalogue used, so a poisoned entry
 * is overwritten in place instead of being orphaned in IndexedDB alongside its
 * replacement.
 *
 * @param {string} key - IndexedDB metadata key.
 * @param {Array|object} entries - Catalogue to store; shape is the caller's.
 */
export async function writeShippedManifest(key, entries) {
	const version = shippedAssetCacheVersion();
	if (!version) return;
	await cache.setMetadata(key, { version, entries });
}
