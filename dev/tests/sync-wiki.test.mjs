import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { syncWiki } from "../tools/sync-wiki.mjs";

test("the wiki sync mirrors docs/wiki's pages and images, drops what docs dropped, and leaves hidden notes and .git alone", () => {
	const root = mkdtempSync(path.join(tmpdir(), "sdx-wiki-"));
	try {
		const src = path.join(root, "docs");
		const wiki = path.join(root, "wiki");
		const put = (dir, rel, body) => {
			mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
			writeFileSync(path.join(dir, rel), body);
		};
		put(src, "Home.md", "new home");
		put(src, "_Sidebar.md", "sidebar");
		put(src, "images/a.webp", Buffer.from([1, 2, 3]));
		put(src, ".review/notes.md", "not a page");
		put(wiki, "Home.md", "old home");
		put(wiki, "Stale.md", "gone from docs");
		put(wiki, "images/old.webp", Buffer.from([9]));
		put(wiki, ".git/HEAD", "ref: refs/heads/master");

		const drift = { added: ["_Sidebar.md", "images/a.webp"], changed: ["Home.md"], removed: ["Stale.md", "images/old.webp"] };
		assert.deepEqual(syncWiki({ src, wiki, check: true }), drift);
		assert.equal(readFileSync(path.join(wiki, "Home.md"), "utf8"), "old home", "--check writes nothing");

		assert.deepEqual(syncWiki({ src, wiki }), drift);
		assert.deepEqual(syncWiki({ src, wiki, check: true }), { added: [], changed: [], removed: [] });
		assert.equal(readFileSync(path.join(wiki, "Home.md"), "utf8"), "new home");
		assert.deepEqual([...readFileSync(path.join(wiki, "images/a.webp"))], [1, 2, 3]);
		assert.ok(!existsSync(path.join(wiki, "Stale.md")) && !existsSync(path.join(wiki, "images/old.webp")));
		assert.ok(existsSync(path.join(wiki, ".git/HEAD")), "the wiki's .git is untouched");
		assert.ok(!existsSync(path.join(wiki, ".review")), "hidden notes stay out");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
