#!/usr/bin/env node
/**
 * Mirror `docs/wiki/` into the GitHub wiki.
 *
 * `docs/wiki/` is the source and the wiki is a copy. Nothing synced the two,
 * so the wiki drifted: on 2026-09-28 twelve pages were behind, Developer-API
 * by some 380 lines.
 *
 * Unlike the Enhancer's script (its tools/sync-wiki.mjs), nothing is rewritten.
 * These pages are already written for the wiki (`Home.md`, `_Sidebar.md`,
 * links without `.md`), and their images are absolute
 * `raw.githubusercontent.com/wiki/...` URLs served from the wiki's own
 * `images/` folder, so `images/` is mirrored too. Hidden entries (`.review/`)
 * are notes, not pages, and stay out.
 *
 * Usage:
 *   node dev/tools/sync-wiki.mjs [--check] [--wiki <path>]
 *
 *   --check   write nothing; exit 1 if the wiki is out of date
 *   --wiki    path to a checkout of `shadowdark-extras.wiki.git`
 *             (default: ../shadowdark-extras.wiki, beside the repo)
 *
 * Committing and pushing is left to the caller: this script owns the copy,
 * not the decision to publish.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const hidden = (rel) => rel.split(path.sep).some((part) => part.startsWith("."));

/** What the wiki holds: the top-level pages and every file under images/, relative to `dir`, sorted. */
function wikiFiles(dir) {
	const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !hidden(f));
	const images = path.join(dir, "images");
	if (existsSync(images)) {
		for (const f of readdirSync(images, { recursive: true })) {
			const rel = path.join("images", f);
			if (!hidden(rel) && statSync(path.join(dir, rel)).isFile()) files.push(rel);
		}
	}
	return files.sort();
}

/**
 * Make `wiki` a copy of `src`'s pages and images. The wiki's `.git` and
 * anything hidden are never touched.
 * @param {{src:string, wiki:string, check?:boolean}} options  check: report only, write nothing
 * @returns {{added:string[], changed:string[], removed:string[]}}  paths relative to the wiki
 */
export function syncWiki({ src, wiki, check = false }) {
	const want = wikiFiles(src);
	const have = wikiFiles(wiki);
	const added = [];
	const changed = [];
	for (const rel of want) {
		const next = readFileSync(path.join(src, rel));
		if (!have.includes(rel)) added.push(rel);
		else if (next.equals(readFileSync(path.join(wiki, rel)))) continue;
		else changed.push(rel);
		if (!check) {
			mkdirSync(path.dirname(path.join(wiki, rel)), { recursive: true });
			writeFileSync(path.join(wiki, rel), next);
		}
	}
	// A page or image deleted from docs/wiki must not linger on the wiki.
	const removed = have.filter((rel) => !want.includes(rel));
	if (!check) for (const rel of removed) rmSync(path.join(wiki, rel));
	return { added, changed, removed };
}

// Run as a command, also through a symlinked path (Foundry's modules folder links to the repo).
if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
	const args = process.argv.slice(2);
	const check = args.includes("--check");
	const root = path.resolve(import.meta.dirname, "..", "..");
	const at = args.indexOf("--wiki");
	const wiki = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : path.join(root, "..", "shadowdark-extras.wiki"));
	if (!existsSync(wiki)) {
		console.error(`✗ no wiki checkout at ${wiki}`);
		console.error(`  git clone https://github.com/DimitroffVodka/shadowdark-extras.wiki.git ${wiki}`);
		process.exit(2);
	}
	const { added, changed, removed } = syncWiki({ src: path.join(root, "docs", "wiki"), wiki, check });
	const report = (label, list) => { if (list.length) console.log(`  ${label}: ${list.join(", ")}`); };
	console.log(`docs/wiki → ${wiki}`);
	report("new", added);
	report("updated", changed);
	report("removed", removed);
	const total = added.length + changed.length + removed.length;
	if (!total) {
		console.log("✓ wiki is up to date.");
	} else if (check) {
		console.error(`\n✗ wiki is ${total} file(s) out of date. Run \`npm run wiki:sync\` and push.`);
		process.exit(1);
	} else {
		console.log(`\n✓ wrote ${total} file(s). Commit and push from ${wiki}.`);
	}
}
