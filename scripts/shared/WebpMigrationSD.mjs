/**
 * One-time migration for the PNG/JPG -> WebP asset conversion.
 *
 * Existing worlds persist absolute asset paths inside their own database:
 * scene tiles, token textures, note icons, journal page images, actor/item
 * art, module settings, and arbitrary module flags all store strings like
 * `modules/shadowdark-extras/assets/Hexes/Autumn/autumnbog.png`. Converting
 * the shipped files to .webp deletes those targets, so every stored path
 * would 404 and the artwork would silently vanish from the user's world.
 *
 * This migration rewrites those stored paths in place. It is deliberately
 * conservative:
 *
 *   - It only touches strings containing `modules/shadowdark-extras/`.
 *   - It rewrites a path ONLY after confirming (via HEAD) that the .webp
 *     replacement actually exists. Assets we intentionally kept as PNG/JPG
 *     (tileable backgrounds, already-lossy portraits) therefore stay put.
 *   - If neither the old nor the new file resolves, the path is left alone
 *     and reported - that is a pre-existing broken reference, not ours to
 *     guess at.
 *   - It never deletes anything and never touches non-module paths.
 *
 * Runs GM-only, once per world, gated on the `webpMigrationDone` setting.
 */

import { MODULE_ID } from "./module-id.mjs";

const PREFIX = `modules/${MODULE_ID}/`;
const RASTER = /\.(png|jpe?g)$/i;

/** Cache of "does this URL exist" answers so each path is probed at most once. */
const _existsCache = new Map();

/**
 * Build a fetchable URL from a stored path.
 *
 * Stored paths are inconsistently encoded: Foundry's FilePicker writes
 * percent-encoded names for assets containing spaces, parentheses or
 * ampersands (`Hex%20-%20Plains%20(damp)%201.png`), while hand-written or
 * code-generated paths are usually raw. Running encodeURI over an already
 * encoded path double-escapes it (`%20` -> `%2520`) and the probe 404s, which
 * would make the migration silently skip exactly those files. Decode first,
 * then encode once, so both forms converge on the same URL.
 */
export function toUrl(relPath) {
	// Strip any leading slash BEFORE splitting. `"/" + "/modules/...".split("/")`
	// would rejoin to `//modules/...`, which a browser reads as a
	// protocol-relative URL with `modules` as the HOST - the probe then resolves
	// off-origin, 404s, and the migration silently skips the file. Stored paths
	// do come through with a leading slash (e.g. SheetEditorConfig builds
	// `/${basePath}/Transparent center/...`).
	//
	// Per-segment decode/encode. encodeURI/decodeURI are NOT usable here:
	// they deliberately pass reserved characters through, so an encoded
	// ampersand (`B%26W-Camp-Feu01.png`, the naming convention across the ~359
	// Dysonstyle symbols) survives decodeURI intact and then has its own '%'
	// escaped by encodeURI, yielding `B%2526W-...` and a guaranteed 404.
	// encodeURIComponent/decodeURIComponent handle reserved characters, so we
	// split on '/' to keep the separators intact.
	return "/" + relPath.replace(/^\/+/, "").split("/").map((segment) => {
		let decoded = segment;
		try { decoded = decodeURIComponent(segment); } catch (e) { /* malformed escape */ }
		return encodeURIComponent(decoded);
	}).join("/");
}

/**
 * Normalize a stored path and confirm this module actually owns it.
 *
 * Ownership must be a PREFIX test, not a substring test: a foreign path that
 * merely contains our prefix - a backup or upload such as
 * `worlds/mine/uploads/modules/shadowdark-extras/old.png` - is not ours, and
 * rewriting it would point a working reference at a file that does not exist.
 *
 * Returns the leading-slash-stripped path, or null when the value is not a
 * module-owned path. Pure - exported for unit tests.
 */
export function normalizeModulePath(value) {
	if (typeof value !== "string") return null;
	const normalized = value.replace(/^\/+/, "");
	return normalized.startsWith(PREFIX) ? normalized : null;
}

/**
 * Swap a raster extension for .webp, preserving any `?cachebust` suffix, the
 * original encoding, and any leading slash. Pure - exported for unit tests.
 * Returns null when the value is not a module-owned raster path.
 */
export function planWebpSwap(value) {
	if (!normalizeModulePath(value)) return null;
	// Split the ORIGINAL value so the rewritten string keeps the caller's form
	// (leading slash included) - the document should change extension only.
	const [bare, query] = value.split("?");
	if (!RASTER.test(bare)) return null;
	const candidate = bare.replace(RASTER, ".webp");
	return { candidate, rewritten: query !== undefined ? `${candidate}?${query}` : candidate };
}

async function urlExists(relPath) {
	const url = toUrl(relPath);
	if (_existsCache.has(url)) return _existsCache.get(url);
	let ok = false;
	try {
		const res = await fetch(url, { method: "HEAD" });
		ok = res.ok;
	} catch (e) {
		ok = false;
	}
	_existsCache.set(url, ok);
	return ok;
}

/**
 * Decide the replacement for a single stored path.
 * Returns the new path, or null to leave it untouched.
 */
async function resolveReplacement(value) {
	const plan = planWebpSwap(value);
	if (!plan) return null;
	if (!(await urlExists(plan.candidate))) return null;   // kept as PNG/JPG, or absent
	return plan.rewritten;
}

/**
 * Walk a plain data object, rewriting any module raster paths.
 * Returns a new object plus a count, or null when nothing changed.
 */
async function rewriteTree(node, depth = 0) {
	if (depth > 16 || node === null || node === undefined) return { value: node, changed: 0 };

	if (typeof node === "string") {
		const next = await resolveReplacement(node);
		return next ? { value: next, changed: 1 } : { value: node, changed: 0 };
	}

	if (Array.isArray(node)) {
		let changed = 0;
		const out = [];
		for (const entry of node) {
			const r = await rewriteTree(entry, depth + 1);
			changed += r.changed;
			out.push(r.value);
		}
		return { value: changed ? out : node, changed };
	}

	if (typeof node === "object") {
		// Never walk class instances - only plain source data.
		if (Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) {
			return { value: node, changed: 0 };
		}
		let changed = 0;
		const out = {};
		for (const [k, v] of Object.entries(node)) {
			const r = await rewriteTree(v, depth + 1);
			changed += r.changed;
			out[k] = r.value;
		}
		return { value: changed ? out : node, changed };
	}

	return { value: node, changed: 0 };
}

/**
 * Scan documents and build the update payload for those needing a rewrite.
 * Shared by the world-collection and compendium-pack passes, which differ only
 * in where the documents come from and how the update is applied.
 */
async function collectUpdates(docs) {
	const updates = [];
	let refs = 0;
	const touched = [];
	for (const doc of docs) {
		let source;
		try { source = doc.toObject(); } catch (e) { continue; }
		const r = await rewriteTree(source);
		if (r.changed > 0) {
			updates.push({ ...r.value, _id: doc.id });
			refs += r.changed;
			touched.push({ name: doc.name ?? doc.id, paths: r.changed });
		}
	}
	return { updates, refs, touched };
}

/** Migrate one world document collection in bulk. */
async function migrateCollection(label, collection, stats, dryRun) {
	if (!collection?.size) return;

	const { updates, refs, touched } = await collectUpdates(collection);
	if (!updates.length) return;

	stats.refs += refs;
	stats.docs += updates.length;
	for (const t of touched) {
		if (stats.samples.length >= 20) break;
		stats.samples.push({ type: label, name: t.name, paths: t.paths });
	}
	stats.byType[label] = updates.length;

	if (dryRun) return;
	try {
		await collection.documentClass.updateDocuments(updates, { diff: false, recursive: false });
	} catch (e) {
		console.error(`${MODULE_ID} | webp migration failed for ${label}:`, e);
		stats.errors.push(`${label}: ${e.message}`);
	}
}

/** Migrate this module's own settings (they store bare filenames or paths). */
async function migrateSettings(stats, dryRun) {
	for (const [key, setting] of game.settings.settings) {
		if (!key.startsWith(`${MODULE_ID}.`)) continue;
		if (setting.scope !== "world") continue;

		let current;
		try { current = game.settings.get(MODULE_ID, setting.key); } catch (e) { continue; }

		// Bare style filenames ("skulls.png") carry no directory, so probe them
		// against the art directories SheetEditorConfig resolves them against.
		if (typeof current === "string" && RASTER.test(current) && !current.includes("/")) {
			const dirs = [
				`${PREFIX}art/PNG/Default/Border`,
				`${PREFIX}art/PNG/Default/Panel`,
				`${PREFIX}art/PNG/Default/Transparent center`,
				`${PREFIX}art/PNG/Double/Border`,
				`${PREFIX}art/PNG/Double/Panel`,
				`${PREFIX}art/PNG/Double/Transparent center`,
			];
			const target = current.replace(RASTER, ".webp");
			let found = false;
			for (const d of dirs) {
				if (await urlExists(`${d}/${target}`)) { found = true; break; }
			}
			if (found) {
				if (!dryRun) await game.settings.set(MODULE_ID, setting.key, target);
				stats.settings.push(`${setting.key}: ${current} -> ${target}`);
			}
			continue;
		}

		// Full paths and nested objects/arrays of paths.
		const r = await rewriteTree(current);
		if (r.changed > 0) {
			if (!dryRun) await game.settings.set(MODULE_ID, setting.key, r.value);
			stats.settings.push(`${setting.key} (${r.changed} path${r.changed === 1 ? "" : "s"})`);
		}
	}
}

/**
 * Migrate stale paths inside world-owned compendium packs.
 *
 * Locked packs are reported, never force-unlocked - silently flipping a user's
 * lock is too invasive. Unlocked packs are rewritten in place.
 */
async function migrateWorldPacks(stats, dryRun) {
	for (const pack of game.packs) {
		if (pack.metadata.packageType !== "world") continue;

		let docs;
		try { docs = await pack.getDocuments(); } catch (e) {
			stats.errors.push(`${pack.collection}: ${e.message}`);
			continue;
		}

		const { updates, refs: hits } = await collectUpdates(docs);
		if (!hits) continue;
		const plural = hits === 1 ? "" : "s";

		if (pack.locked) {
			stats.packWarnings.push(`${pack.collection} (${hits} path${plural}, LOCKED)`);
			continue;
		}
		if (dryRun) {
			stats.packMigrated.push(`${pack.collection} (${hits}, dry run)`);
			continue;
		}
		try {
			await pack.documentClass.updateDocuments(updates, { pack: pack.collection, diff: false, recursive: false });
			stats.packMigrated.push(`${pack.collection} (${hits} path${plural})`);
			stats.refs += hits;
		} catch (e) {
			console.error(`${MODULE_ID} | webp migration failed for pack ${pack.collection}:`, e);
			stats.errors.push(`${pack.collection}: ${e.message}`);
		}
	}
}

/**
 * Sweep world compendiums for pre-conversion paths, migrating what is unlocked
 * and reporting what is not.
 *
 * Deliberately NOT awaited by the startup migration: it must load every
 * document of every world pack, which stalls world load on content-heavy
 * setups. The ready hook fires it in the background instead.
 *
 * Gated on its OWN setting rather than `webpMigrationDone`. A pack that was
 * locked, or whose update threw, is not migrated - if the sweep shared the
 * document gate it would be marked done and never retried, stranding those
 * packs on dead paths forever. `webpPackSweepDone` is set only once a pass
 * completes with nothing locked and no errors, so unlocking a pack and
 * reloading is enough to finish the job.
 */
export async function sweepWorldCompendiums({ dryRun = false, force = false } = {}) {
	if (!game.user.isGM) return null;
	if (!force && !dryRun && game.settings.get(MODULE_ID, "webpPackSweepDone")) return null;

	const stats = { refs: 0, packWarnings: [], packMigrated: [], errors: [] };
	await migrateWorldPacks(stats, dryRun);

	if (stats.packMigrated.length) {
		console.log(`${MODULE_ID} | migrated world compendiums: ${stats.packMigrated.join(", ")}`);
	}
	if (stats.packWarnings.length) {
		console.warn(
			`${MODULE_ID} | These world compendiums are LOCKED and still reference pre-WebP paths: ` +
            `${stats.packWarnings.join(", ")}. Unlock them and reload - the sweep retries every load ` +
            "until it completes cleanly, or run " +
            `game.modules.get("${MODULE_ID}").api.sweepWorldCompendiums({ force: true }) now.`
		);
		ui.notifications?.warn(
			`Shadowdark Extras: ${stats.packWarnings.length} locked world compendium(s) still use old artwork paths - see console.`
		);
	}

	// Only close the gate on a clean pass, so locked/failed packs get retried.
	if (!dryRun && !stats.packWarnings.length && !stats.errors.length) {
		await game.settings.set(MODULE_ID, "webpPackSweepDone", true);
	}
	return stats;
}

/**
 * Run the migration. Safe to call repeatedly - the setting gate makes it a
 * no-op after the first successful pass.
 */
export async function migrateWebpAssetPaths({ force = false, dryRun = false, auditPacks = false } = {}) {
	if (!game.user.isGM) return null;
	if (!force && !dryRun && game.settings.get(MODULE_ID, "webpMigrationDone")) return null;

	const stats = { dryRun, docs: 0, refs: 0, byType: {}, samples: [], settings: [], packWarnings: [], packMigrated: [], errors: [] };
	const started = performance.now();
	console.log(`${MODULE_ID} | webp asset migration ${dryRun ? "DRY RUN" : "starting"}...`);

	await migrateCollection("Scene", game.scenes, stats, dryRun);
	await migrateCollection("Actor", game.actors, stats, dryRun);
	await migrateCollection("Item", game.items, stats, dryRun);
	await migrateCollection("JournalEntry", game.journal, stats, dryRun);
	await migrateCollection("Macro", game.macros, stats, dryRun);
	await migrateCollection("RollTable", game.tables, stats, dryRun);
	await migrateCollection("Cards", game.cards, stats, dryRun);

	await migrateSettings(stats, dryRun);
	if (auditPacks) {
		const packStats = await sweepWorldCompendiums({ dryRun });
		if (packStats) {
			stats.packWarnings = packStats.packWarnings;
			stats.packMigrated = packStats.packMigrated;
			stats.refs += packStats.refs;
			stats.errors.push(...packStats.errors);
		}
	}

	const ms = Math.round(performance.now() - started);
	console.log(`${MODULE_ID} | webp asset migration ${dryRun ? "dry run" : "complete"} in ${ms}ms`, stats);

	if (dryRun) return stats;

	if (stats.errors.length === 0) {
		await game.settings.set(MODULE_ID, "webpMigrationDone", true);
	} else {
		console.warn(`${MODULE_ID} | migration had errors; will retry on next load.`);
	}

	if (stats.refs > 0 || stats.settings.length > 0) {
		ui.notifications?.info(
			`Shadowdark Extras: updated ${stats.refs} artwork path${stats.refs === 1 ? "" : "s"} ` +
            `across ${stats.docs} document${stats.docs === 1 ? "" : "s"} and ` +
            `${stats.settings.length} setting${stats.settings.length === 1 ? "" : "s"} for the WebP asset update.`
		);
	}
	return stats;
}
