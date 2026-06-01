// HexDungeonBridgeSD.mjs
//
// Bridges the Hexplorer "Generate Dungeon" flow to a PLAYABLE map scene with
// room-for-room correspondence.
//
// Principle: the scene geometry is authoritative. We run the procedural map
// generator first (real floors/walls/doors), then generate the narrative keyed
// to the rooms that were actually placed, and pin a numbered Note at each room
// centre that links to that room's journal page.
//
// This module only builds the Scene + Journal + Notes and cross-links them.
// Hex-record linkage (features, content registry) stays in HexTooltipSD, which
// already owns that data.

import { generateDungeon } from "./DungeonGeneratorSD.mjs";
import { generateDungeonRooms, getDungeonSizes } from "./DungeonGenerator.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Compass direction from room A's centre toward room B's centre.
 * Returns one of the 8 names understood by DungeonGenerator's doorway text.
 */
function directionBetween(a, b) {
	const dx = b.cx - a.cx;
	const dy = b.cy - a.cy;
	const ns = dy < 0 ? "North" : dy > 0 ? "South" : "";
	const ew = dx > 0 ? "East" : dx < 0 ? "West" : "";
	if (ns && ew) return ns + ew.toLowerCase(); // Northeast / Southwest / ...
	return ns || ew || "North";
}

/**
 * Build a 1-based connections table (the shape DungeonGenerator.generateRoom
 * expects) from the scene generator's real room geometry + adjacency map.
 * @param {Array} placedRooms       - ProcgenRoom[] (have cx/cy)
 * @param {Map<number,Set<number>>} adjacency - 0-based room index graph
 * @returns {Array<Array<{toRoom:number, direction:string}>>}
 */
function buildConnections(placedRooms, adjacency) {
	const n = placedRooms.length;
	const connections = [];
	for (let i = 1; i <= n; i++) connections[i] = [];
	if (!adjacency) return connections;
	for (let i = 0; i < n; i++) {
		const neighbors = adjacency.get(i);
		if (!neighbors) continue;
		for (const j of neighbors) {
			if (j < 0 || j >= n) continue;
			connections[i + 1].push({
				toRoom: j + 1,
				direction: directionBetween(placedRooms[i], placedRooms[j]),
			});
		}
	}
	return connections;
}

/**
 * Generate a playable dungeon map scene for a hex, with a per-room journal and
 * numbered map pins linking each room to its journal page.
 *
 * Must be called by a GM. Generates onto a freshly-created scene (which it
 * `view()`s so the generator, which targets `canvas.scene`, operates on it).
 *
 * @param {object} opts
 * @param {string} opts.hexLabel  - display label, e.g. "14.7"
 * @param {string} opts.hexKey    - internal key "i_j"
 * @param {string} opts.typeKey   - "temple" | "tomb" | "dungeon"
 * @param {string} opts.sizeKey   - "small" | "medium" | "large"
 * @returns {Promise<{ scene: Scene, journal: JournalEntry, dungeonName: string, roomCount: number }>}
 */
export async function buildHexDungeonScene({ hexLabel, hexKey, typeKey, sizeKey }) {
	if (!game.user.isGM) {
		ui.notifications.error("SDX | Only the GM can generate dungeon maps.");
		throw new Error("buildHexDungeonScene requires GM");
	}

	const sizeSpec = getDungeonSizes().find(s => s.key === sizeKey) || getDungeonSizes()[0];
	const [minR, maxR] = sizeSpec.range;
	const requestedRooms = minR + Math.floor(Math.random() * (maxR - minR + 1));
	const seed = `hex-${hexKey}-${typeKey}-${sizeKey}-${foundry.utils.randomID(6)}`;
	const sceneName = `Dungeon — Hex ${hexLabel}`;

	const remember = canvas.scene; // restore the GM's view afterward

	// 1. Create the dungeon scene. The generator resizes it to fit content.
	const created = await Scene.create([{
		name: sceneName,
		width: 2000,
		height: 2000,
		padding: 0.25,
		grid: { type: 1, size: 100 },
		flags: { [MODULE_ID]: { hexDungeon: { hexKey, typeKey, sizeKey, seed } } },
	}]);
	const scene = Array.isArray(created) ? created[0] : created;
	if (!scene) throw new Error("SDX | Dungeon scene creation failed.");

	// 2. View it (GM-only — does not pull players like activate()).
	await scene.view();

	// 3. Generate the playable geometry. Returns the layout + offset we need to
	//    place pins, alongside the usual stair/clutter counts.
	const result = await generateDungeon({
		seed,
		roomCount: requestedRooms,
		density: 0.8,
		branching: 0.5,
		roomSizeBias: 0.5,
		symmetry: true,
		stairs: 0,
		stairsDown: 0,
		clutter: 0,
		useTexture: true,
		wallShadows: false,
		wallColor: "#5C3D3D",
		wallThickness: 20,
	});

	if (!result?.layout?.placedRooms?.length) {
		throw new Error("SDX | Dungeon geometry generation returned no rooms.");
	}

	const { layout, offset, gridSize } = result;
	const placedRooms = layout.placedRooms;
	const roomCount = placedRooms.length;
	const connections = buildConnections(placedRooms, layout.adjacency);

	// 4. Narrative keyed to the rooms actually placed.
	const content = await generateDungeonRooms({ typeKey, sizeKey, roomCount, connections });

	// 5. Journal: Overview page + one page per room.
	const journal = await JournalEntry.create({
		name: content.dungeonName,
		flags: { [MODULE_ID]: { hexDungeon: { hexKey, sceneId: scene.id } } },
	});

	const pageData = [
		{ name: "Overview", type: "text", text: { content: content.overviewHtml }, sort: 0 },
	];
	for (const r of content.rooms) {
		pageData.push({
			name: `Room ${r.num}: ${r.label}`,
			type: "text",
			text: { content: r.html },
			sort: r.num * 100,
		});
	}
	await JournalEntryPage.create(pageData, { parent: journal });

	// 6. Numbered map pins, each linking to its room page.
	const refreshed = game.journal.get(journal.id);
	const half = gridSize / 2;
	const notes = [];
	for (const r of content.rooms) {
		const room = placedRooms[r.num - 1];
		if (!room) continue;
		const page = refreshed.pages.find(p => p.name === `Room ${r.num}: ${r.label}`);
		notes.push({
			x: (room.cx + offset.x) * gridSize + half,
			y: (room.cy + offset.y) * gridSize + half,
			entryId: journal.id,
			pageId: page?.id ?? null,
			text: String(r.num),
			fontSize: 48,
			iconSize: 80,
			texture: { src: "icons/svg/book.svg", tint: "#e8c66a" },
			textAnchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
			flags: { [MODULE_ID]: { hexDungeon: true } },
		});
	}
	if (notes.length) {
		await scene.createEmbeddedDocuments("Note", notes);
	}

	// 7. Restore the GM's previous view (non-fatal if it fails).
	try {
		if (remember && remember.id !== scene.id) await remember.view();
	} catch (_e) { /* ignore */ }

	ui.notifications.info(`SDX | Dungeon map "${content.dungeonName}" generated (${roomCount} rooms).`);
	return { scene, journal, dungeonName: content.dungeonName, roomCount };
}
