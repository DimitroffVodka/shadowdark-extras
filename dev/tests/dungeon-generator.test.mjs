// Characterization tests for scripts/dungeon/DungeonGenerator.mjs, the hex-crawl
// dungeon content generator. Sweep 6, written before anything moves.
//
// This module had no coverage of any kind — neither did anything else under
// scripts/dungeon or scripts/hex, 18,619 lines across 25 files whose only test
// contact was transitive, through TrayApp.
//
// Two notes on making it deterministic.
//
// It is NOT seeded. Every choice is a raw Math.random() call; there is no seed
// parameter to pass. (The plan's "seeded dungeon generation" refers to
// DungeonGeneratorSD.mjs, a different module with getGeneratorSeed.) So the
// tests install a small counter-based PRNG over Math.random for the duration,
// which makes runs reproducible without changing the source.
//
// And the data is real: loadDungeonData() fetches the shipped
// scripts/data/dungeon-data.json, so `fetch` is pointed at the file on disk
// rather than at a synthetic fixture. The tables under test are the ones that
// ship.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Serve the module's own data files off disk, exactly as shipped.
globalThis.fetch = async url => {
	const relative = String(url).replace(/^modules\/shadowdark-extras\//, "");
	const file = path.join(REPO_ROOT, relative);
	try {
		const body = readFileSync(file, "utf8");
		return { ok: true, status: 200, statusText: "OK", json: async () => JSON.parse(body) };
	}
	catch {
		return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
	}
};
globalThis.ui = { notifications: { error() {} } };
globalThis.game = { packs: { get: () => null } };
globalThis.foundry = { applications: { apps: {} }, utils: { randomID: () => "test-id" } };

/**
 * Replace Math.random with a deterministic sequence for one call.
 *
 * Not a seed the generator understands — it has none — just a way to make an
 * unseeded generator reproducible from the outside.
 *
 * MUST await `run()` rather than return it. Most of what is under test here is
 * async, and a plain `return run()` restores Math.random the moment the promise
 * is created — before the generator has drawn a single number. The first
 * version of this helper did exactly that, and the tests still mostly passed,
 * because an unstubbed generator produces perfectly plausible output.
 */
async function withDeterministicRandom(seed, run) {
	const original = Math.random;
	let state = seed >>> 0;
	Math.random = () => {
		// xorshift32: cheap, and the exact sequence does not matter, only that
		// it repeats.
		state ^= state << 13; state >>>= 0;
		state ^= state >> 17;
		state ^= state << 5; state >>>= 0;
		return state / 0x100000000;
	};
	try {
		return await run();
	}
	finally {
		Math.random = original;
	}
}

const gen = await import("../../scripts/dungeon/DungeonGenerator.mjs");

// --- size table -------------------------------------------------------------

test("the three dungeon sizes carry non-overlapping, ascending room ranges", () => {
	const sizes = gen.getDungeonSizes();

	assert.deepEqual(sizes.map(s => s.key), ["small", "medium", "large"]);
	assert.deepEqual(sizes.map(s => s.range), [[4, 6], [7, 10], [11, 15]]);

	for (let i = 1; i < sizes.length; i++) {
		assert.ok(sizes[i].range[0] > sizes[i - 1].range[1],
			`${sizes[i].key} starts above where ${sizes[i - 1].key} ends`);
	}
});

test("every size advertises its room range in its label", () => {
	for (const size of gen.getDungeonSizes()) {
		assert.match(size.label, new RegExp(`${size.range[0]}-${size.range[1]}`));
	}
});

// --- the shipped data tables ------------------------------------------------

test("the three dungeon types ship with labels", async () => {
	const types = await gen.getDungeonTypes();

	assert.deepEqual(types.map(t => t.key).sort(), ["dungeon", "temple", "tomb"]);
	for (const type of types) assert.ok(type.label?.length, `${type.key} has a label`);
});

test("a name is generated from the shipped tables", async () => {
	const data = await (await import("../../scripts/dungeon/DungeonGenerator.mjs")).loadDungeonData();

	const name = await withDeterministicRandom(1, () => gen.generateDungeonName(data));

	assert.equal(typeof name, "string");
	assert.ok(name.length > 0);
	assert.ok(!name.includes("["), `no unresolved template tokens left in "${name}"`);
	assert.ok(!name.includes("undefined"), `no undefined stringified into "${name}"`);
});

test("the same random sequence produces the same name", async () => {
	const data = await gen.loadDungeonData();

	const first = await withDeterministicRandom(42, () => gen.generateDungeonName(data));
	const second = await withDeterministicRandom(42, () => gen.generateDungeonName(data));

	assert.equal(first, second);
});

// --- room generation --------------------------------------------------------

/** The connection shape generateDungeonRooms expects, built by hand. */
function linearConnections(roomCount) {
	const connections = [];
	for (let i = 1; i <= roomCount; i++) connections[i] = [];
	for (let i = 1; i < roomCount; i++) {
		connections[i].push({ toRoom: i + 1, direction: "North" });
		connections[i + 1].push({ toRoom: i, direction: "South" });
	}
	return connections;
}

test("an unknown dungeon type yields no rooms rather than throwing", async () => {
	const result = await gen.generateDungeonRooms({
		typeKey: "not-a-type", sizeKey: "small", roomCount: 4, connections: linearConnections(4),
	});

	assert.deepEqual(result.rooms, []);
	assert.equal(result.dungeonName, "not-a-type");
	assert.match(result.overviewHtml, /Unknown dungeon type/);
});

test("one page is produced per room, numbered from one", async () => {
	const result = await withDeterministicRandom(7, () => gen.generateDungeonRooms({
		typeKey: "tomb", sizeKey: "small", roomCount: 5, connections: linearConnections(5),
	}));

	assert.equal(result.rooms.length, 5);
	assert.deepEqual(result.rooms.map(r => r.num), [1, 2, 3, 4, 5]);
	for (const room of result.rooms) {
		assert.ok(room.label?.length, `room ${room.num} has a label`);
		assert.ok(room.html?.length, `room ${room.num} has content`);
	}
});

test("no room leaks an unresolved template token or an undefined", async () => {
	const result = await withDeterministicRandom(11, () => gen.generateDungeonRooms({
		typeKey: "temple", sizeKey: "medium", roomCount: 8, connections: linearConnections(8),
	}));

	for (const room of result.rooms) {
		assert.ok(!room.html.includes("undefined"), `room ${room.num} stringified an undefined`);
		assert.ok(!/\[[^\]]*\|[^\]]*\]/.test(room.html),
			`room ${room.num} left an unresolved [a|b] token`);
	}
	assert.ok(!result.overviewHtml.includes("undefined"));
});

test("the overview carries the type label and a wandering monster table", async () => {
	const result = await withDeterministicRandom(3, () => gen.generateDungeonRooms({
		typeKey: "tomb", sizeKey: "small", roomCount: 4, connections: linearConnections(4),
	}));

	assert.match(result.overviewHtml, /Wandering Monsters/);
	assert.ok(result.typeLabel?.length);
	assert.match(result.overviewHtml, new RegExp(result.typeLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// Only the "dungeon" type carries the peculiar-motivations section; the tomb and
// temple types do not.
test("peculiar motivations appear for dungeons and nowhere else", async () => {
	const dungeon = await withDeterministicRandom(5, () => gen.generateDungeonRooms({
		typeKey: "dungeon", sizeKey: "small", roomCount: 4, connections: linearConnections(4),
	}));
	assert.match(dungeon.overviewHtml, /Peculiar Motivations/);

	for (const typeKey of ["tomb", "temple"]) {
		const other = await withDeterministicRandom(5, () => gen.generateDungeonRooms({
			typeKey, sizeKey: "small", roomCount: 4, connections: linearConnections(4),
		}));
		assert.ok(!other.overviewHtml.includes("Peculiar Motivations"), typeKey);
	}
});

test("the same random sequence reproduces the whole dungeon", async () => {
	const build = () => withDeterministicRandom(99, () => gen.generateDungeonRooms({
		typeKey: "tomb", sizeKey: "small", roomCount: 4, connections: linearConnections(4),
	}));

	const first = await build();
	const second = await build();

	assert.equal(first.dungeonName, second.dungeonName);
	assert.deepEqual(first.rooms.map(r => r.label), second.rooms.map(r => r.label));
	assert.deepEqual(first.rooms.map(r => r.html), second.rooms.map(r => r.html));
});

// --- the full HTML pipeline -------------------------------------------------
//
// generateDungeonHtml is the only path that exercises the private layout
// builders — room connections, BFS placement, collision nudging and the SVG
// map — so the invariants below are asserted through it.

test("an unknown type produces a message rather than a page", async () => {
	const result = await gen.generateDungeonHtml("not-a-type", "small", "14.7", "14_7");

	assert.match(result.html, /Unknown dungeon type/);
	assert.equal(result.dungeonName, "not-a-type");
});

// The map is rendered to SVG, uploaded through FilePicker, and referenced by
// URL. It is never inlined. With no FilePicker available — as here, and as in
// any world where the upload fails — it degrades to a base64 data URI rather
// than losing the map.
test("a generated page names the dungeon and carries a map", async () => {
	const result = await withDeterministicRandom(21, () =>
		gen.generateDungeonHtml("dungeon", "small", "14.7", "14_7"));

	assert.ok(result.dungeonName?.length);
	assert.ok(result.html.includes(result.dungeonName), "the page names the dungeon");
	assert.match(result.html, /<img[^>]+alt="Dungeon Map"/);
	assert.ok(!result.html.includes("<svg"), "the SVG is referenced, not inlined");
});

test("a failed map upload falls back to an inline data URI", async () => {
	const result = await withDeterministicRandom(21, () =>
		gen.generateDungeonHtml("dungeon", "small", "14.7", "14_7"));

	assert.match(result.html, /<img src="data:image\/svg\+xml;base64,/);
});

// The map sits in a secret section so a shared journal page does not give the
// layout away before the party has earned it.
test("the map is wrapped in a secret section", async () => {
	const result = await withDeterministicRandom(21, () =>
		gen.generateDungeonHtml("tomb", "small", "1.1", "1_1"));

	assert.match(result.html, /<section id="secret-[^"]*" class="secret">/);
});

test("room count stays inside the band the chosen size advertises", async () => {
	for (const size of gen.getDungeonSizes()) {
		const result = await withDeterministicRandom(13, () =>
			gen.generateDungeonHtml("tomb", size.key, "1.1", "1_1"));
		// Room headings are the reliable count; each room emits exactly one.
		const headings = (result.html.match(/Room \d+/g) ?? []);
		const distinct = new Set(headings).size;
		assert.ok(distinct >= size.range[0] && distinct <= size.range[1],
			`${size.key}: ${distinct} rooms, expected ${size.range[0]}-${size.range[1]}`);
	}
});

/** Recover the SVG the page references, out of its base64 data URI. */
function decodeMap(html) {
	const encoded = html.match(/<img src="data:image\/svg\+xml;base64,([^"]+)"/)?.[1];
	return encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
}

test("the map plots every room, once each", async () => {
	const result = await withDeterministicRandom(33, () =>
		gen.generateDungeonHtml("temple", "small", "2.2", "2_2"));

	const svg = decodeMap(result.html);
	assert.match(svg, /^<svg[\s\S]*<\/svg>$/, "the payload really is an SVG document");

	// Room headings recur in cross-references ("exit to Room 2"), so the count
	// has to come from the distinct set.
	const rooms = new Set((result.html.match(/Room (\d+)/g) ?? []).map(m => m.split(" ")[1]));
	for (const num of rooms) {
		assert.ok(svg.includes(`>${num}<`), `room ${num} is plotted on the map`);
	}
});

test("the map draws a corridor for every room it plots", async () => {
	const result = await withDeterministicRandom(33, () =>
		gen.generateDungeonHtml("temple", "medium", "2.2", "2_2"));
	const svg = decodeMap(result.html);

	const nodes = (svg.match(/<rect/g) ?? []).length;
	const links = (svg.match(/<line/g) ?? []).length;

	assert.ok(nodes > 0, "rooms are drawn");
	// buildRoomConnections lays a linear spine through every room, so a
	// connected map always has at least one fewer link than it has rooms.
	assert.ok(links >= nodes - 1, `${links} corridors for ${nodes} rooms — the spine is intact`);
});

test("a generated page leaves no unresolved tokens or undefined values", async () => {
	for (const typeKey of ["dungeon", "tomb", "temple"]) {
		const result = await withDeterministicRandom(77, () =>
			gen.generateDungeonHtml(typeKey, "medium", "3.3", "3_3"));

		assert.ok(!result.html.includes("undefined"), `${typeKey} stringified an undefined`);
		assert.ok(!/\[[^\]]*\|[^\]]*\]/.test(result.html), `${typeKey} left an [a|b] token`);
	}
});

// The generator is unseeded, so two calls with different random sequences must
// differ — this is what makes it a generator rather than a fixed table.
test("different random sequences produce different dungeons", async () => {
	const a = await withDeterministicRandom(1, () => gen.generateDungeonHtml("tomb", "small", "1.1", "1_1"));
	const b = await withDeterministicRandom(2, () => gen.generateDungeonHtml("tomb", "small", "1.1", "1_1"));

	assert.notEqual(a.html, b.html);
});
