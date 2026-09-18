/** Pure Hexer v6 → published-number builder adapter. No Foundry globals/writes.
 * Source schema/geometry: hexermap.com's registry and geometry bundles.
 * Path x/y are in units of circumradius (hexSize), already normalized.
 */
const BIOMES = new Map(Object.entries({
	"forest": "forest", "dense-forest": "forest", "jungle": "forest", "dense-jungle": "forest",
	"grassland": "plains", "plains": "plains", "hill": "hills", "hills": "hills",
	"mountain": "mountains", "mountains": "mountains", "marsh": "swamp", "bog": "swamp", "swamp": "swamp",
	"sea": "water", "lake": "water", "coast": "water", "ocean": "water", "water": "water",
	"desert": "desert", "tundra": "plains", "snow": "plains",
}));
const LAYERS = ["surface", "level_1", "level_2", "level_3"];
const POIS = new Map(Object.entries({
	"village": ["settlement", "House"], "town": ["settlement", "House"], "city": ["settlement", "House"],
	"ruins": ["ruins", "Ruins"], "dungeon-entrance": ["dungeon", "Cave"], "cave": ["cave", "Cave"],
	"tower": ["landmark", "Tower"], "castle": ["fort", "Tower"], "camp": ["settlement", "Tent"],
}));
const PATHS = new Map(Object.entries({ primary: "road", secondary: "road", road: "road", trail: "road", water: "river", river: "river" }));
const numOf = (q, r) => ((q + 1) * 100) + r + 1;
const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const htmlText = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
	.replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
function check(condition, message) {
	if (!condition) throw new Error(`Hexer: ${message}`);
}
function text(value, field, fallback = "") {
	check(value === undefined || typeof value === "string", `${field} must be text`);
	return value ?? fallback;
}
function list(value, field) {
	check(value === undefined || Array.isArray(value), `${field} must be an array`);
	return value ?? [];
}
function neighbors(q, r, pointy) {
	if (!pointy) return neighbors(r, q, true).map(cell => ({ q: cell.r, r: cell.q }));
	const left = q - (r % 2 ? 0 : 1);
	return [{ q: q - 1, r }, { q: q + 1, r }, ...[r - 1, r + 1]
		.flatMap(row => [{ q: left, r: row }, { q: left + 1, r: row }])];
}
function centerOf(q, r, pointy) {
	return pointy ? { x: Math.sqrt(3) * (q + ((r % 2) / 2)), y: 1.5 * r }
		: { x: 1.5 * q, y: Math.sqrt(3) * (r + ((q % 2) / 2)) };
}

// Clip a segment against a convex hex. Sampling can miss short corner crossings.
function crossing(a, b, center, corners) {
	let lo = 0; let hi = 1;
	for (let edge = 0; edge < 6; edge++) {
		const v = corners[edge]; const w = corners[(edge + 1) % 6];
		const ex = w.x - v.x; const ey = w.y - v.y;
		const c = (ex * (a.y - center.y - v.y)) - (ey * (a.x - center.x - v.x));
		const d = (ex * (b.y - a.y)) - (ey * (b.x - a.x));
		if (Math.abs(d) < 1e-12) {
			if (c < -1e-10) return null;
		}
		else if (d > 0) lo = Math.max(lo, -c / d);
		else hi = Math.min(hi, -c / d);
		if (lo > hi + 1e-10) return null;
	}
	return hi - lo > 1e-10 ? { lo, hi } : null; // A vertex-only touch is not a crossing.
}

function rasterize(paths, width, height, pointy, warn) {
	const cells = [];
	for (let q = 0; q < width; q++) {
		for (let r = 0; r < height; r++) {
			cells.push({ q, r, num: numOf(q, r), center: centerOf(q, r, pointy) });
		}
	}
	const corners = Array.from({ length: 6 }, (_, i) => {
		const angle = (((i * 60) + (pointy ? 30 : 0)) * Math.PI) / 180;
		return { x: Math.cos(angle), y: Math.sin(angle) };
	});
	const designated = { road: new Set(), river: new Set() };
	const joins = { road: new Set(), river: new Set() };
	let work = 0;
	for (const path of paths) {
		const kind = PATHS.get(path.type);
		if (!kind) {
			warn(`Path type "${path.type}" is not imported (only roads and water).`);
			continue;
		}
		check(Array.isArray(path.points) && path.points.length > 0, "paths need at least one point");
		check(path.closed === undefined || typeof path.closed === "boolean", "path.closed must be boolean");
		for (const p of path.points) check(object(p) && Number.isFinite(p.x) && Number.isFinite(p.y), "path points need finite normalized x/y");
		const points = path.points.filter((p, i) => !i
			|| p.x !== path.points[i - 1].x || p.y !== path.points[i - 1].y);
		if (path.closed || points.length === 1) points.push(points[0]);
		let outside = false;
		let firstStarts = null; let previousEnds = [];
		const connect = (a, b) => {
			if (neighbors(a.q, a.r, pointy).some(n => n.q === b.q && n.r === b.r)) {
				joins[kind].add(pairKey(a.num, b.num));
			}
		};
		for (let segment = 1; segment < points.length; segment++) {
			// ponytail: bounded segment×cell scan; spatial indexing if larger maps are supported.
			work += cells.length;
			check(work <= 5_000_000, "path data is too complex; simplify paths before importing");
			const a = points[segment - 1]; const b = points[segment];
			const hits = [];
			for (const cell of cells) {
				if (cell.center.x < Math.min(a.x, b.x) - 1
					|| cell.center.x > Math.max(a.x, b.x) + 1
					|| cell.center.y < Math.min(a.y, b.y) - 1 || cell.center.y > Math.max(a.y, b.y) + 1) continue;
				const interval = crossing(a, b, cell.center, corners);
				if (interval) hits.push({ ...cell, ...interval });
			}
			hits.sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.num - b.num);
			const moving = a.x !== b.x || a.y !== b.y;
			const starts = hits.filter(hit => hit.lo <= 1e-8);
			firstStarts ??= starts;
			if (moving) {
				for (const end of previousEnds) for (const start of starts) connect(end, start);
			}
			let covered = 0;
			for (const [index, hit] of hits.entries()) {
				designated[kind].add(hit.num);
				if (hit.lo > covered + 1e-8) outside = true;
				covered = Math.max(covered, hit.hi);
				const previous = hits[index - 1];
				if (moving && previous && hit.lo <= previous.hi + 1e-8) connect(previous, hit);
			}
			previousEnds = hits.filter(hit => hit.hi >= 1 - 1e-8);
			if (covered < 1 - 1e-8) outside = true;
		}
		if (path.closed && points.length > 2) {
			for (const end of previousEnds) for (const start of firstStarts) connect(end, start);
		}
		if (outside) warn(`Path "${path.name || path.type}" has portions outside the map; those portions were clipped.`);
		if (path.points.length === 1) warn(`Path "${path.name || path.type}" has one point; it has no drawable segment.`);
	}
	const networks = { road: [], river: [], blockedEdges: { road: [], river: [] } };
	for (const kind of ["road", "river"]) {
		networks[kind] = [...designated[kind]].sort((a, b) => a - b);
		for (const cell of cells) {
			if (!designated[kind].has(cell.num)) continue;
			for (const n of neighbors(cell.q, cell.r, pointy)) {
				if (n.q < 0 || n.q >= width || n.r < 0 || n.r >= height) continue;
				const num = numOf(n.q, n.r);
				if (cell.num < num && designated[kind].has(num) && !joins[kind].has(pairKey(cell.num, num))) {
					networks.blockedEdges[kind].push([cell.num, num]);
				}
			}
		}
	}
	return networks;
}

/** Validate the entire export before returning any world-write plan. */
export function convertHexerMap(data, { sceneName } = {}) {
	check(object(data) && data.schemaVersion === 6, "expected a schemaVersion 6 export");
	check(object(data.settings) && object(data.hexes), "settings and hexes are required objects");
	const { width, height, orientation, hexSize, fogEnabled = false } = data.settings;
	check([width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 99), "width/height must be integers from 1 to 99 (SDX numbering limit)");
	check(["pointy", "flat"].includes(orientation), "orientation must be pointy or flat");
	check(Number.isFinite(hexSize) && hexSize > 0, "hexSize must be positive");
	check(typeof fogEnabled === "boolean", "fogEnabled must be boolean");
	const name = text(sceneName, "sceneName", text(data.name, "name", "Hexer map"));
	const warnings = new Set(); const warn = value => warnings.add(value);
	const pointy = orientation === "pointy";
	if (pointy) warn("Pointy-top axes are transposed into flat-top columns (a diagonal reflection, not a pure quarter-turn rotation).");
	const layers = new Map();
	const customs = new Map(list(data.customHexTypes, "customHexTypes").map(type => {
		check(object(type) && typeof type.id === "string" && typeof type.name === "string", "custom terrain needs id/name");
		return [type.id, type.name];
	}));
	const inBounds = cell => object(cell)
		&& Number.isInteger(cell.q) && Number.isInteger(cell.r)
		&& cell.q >= 0 && cell.q < width && cell.r >= 0 && cell.r < height;
	const base = entity => {
		check(object(entity), "map entries must be objects");
		check(entity.scaleLevel === undefined || (Number.isSafeInteger(entity.scaleLevel) && entity.scaleLevel >= 0), "invalid scaleLevel");
		if (!entity.scaleLevel) return true;
		warn("Detail-scale data is not imported; only base-scale cells and entities are supported."); return false;
	};
	const layerOf = layer => {
		check(LAYERS.includes(layer), `unsupported layer: ${layer}`);
		return layer;
	};
	for (const [key, cell] of Object.entries(data.hexes)) {
		const match = /^(0|[1-9]\d*),(0|[1-9]\d*),(surface|level_[123])(?:,(0|[1-9]\d*))?$/.exec(key);
		check(match && object(cell), `invalid hex key: ${key}`);
		check(cell.q === Number(match[1]) && cell.r === Number(match[2]) && cell.layer === match[3], `hex key/coordinates disagree: ${key}`);
		if (!base({ scaleLevel: Number(match[4] ?? 0) }) || !base(cell)) continue;
		check(inBounds(cell), `hex outside the map: ${key}`);
		const layer = layerOf(cell.layer);
		if (!layers.has(layer)) layers.set(layer, { cells: new Map(), records: new Map(), paths: [], revealed: {} });
		const target = layers.get(layer); const num = numOf(cell.q, cell.r);
		check(!target.cells.has(num), `duplicate base hex: ${key}`);
		const hexType = text(cell.hexType, "hexType");
		const biome = BIOMES.get(hexType) ?? "plains";
		const record = { num };
		if (!BIOMES.has(hexType)) {
			record.terrain = customs.get(hexType) ?? hexType;
			warn("Custom/unknown terrain is retained as text with plains artwork; custom colors/icons are not imported.");
		}
		const fog = cell.fogState ?? "hidden";
		check(["visible", "explored", "partial", "hidden"].includes(fog), `unknown fogState: ${fog}`);
		if (["visible", "explored"].includes(fog)) target.revealed[pointy ? `${cell.q}-${cell.r}` : `${cell.r}-${cell.q}`] = true;
		if (["explored", "partial"].includes(fog)) {
			record.notes = [{ id: "hexer-fog", text: `Hexer fog state: ${fog}`, visible: false }];
			warn("Fog is binary in SDX: visible/explored are revealed; hidden/partial stay covered. Original intermediate states are saved in notes.");
		}
		if (cell.edgeData !== undefined) {
			check(object(cell.edgeData), "edgeData must be an object");
			for (const [edge, state] of Object.entries(cell.edgeData)) check(/^[0-5]$/.test(edge) && ["blocked", "passable"].includes(state), "invalid edgeData");
			if (Object.keys(cell.edgeData).length) {
				(record.notes ??= []).push({ id: "hexer-edges", text: `Hexer edges (original orientation): ${JSON.stringify(cell.edgeData)}`, visible: false });
				warn("Per-edge restrictions are preserved in GM notes, not applied to movement or road/river joins.");
			}
		}
		if (list(cell.connections, "connections").length) {
			(record.notes ??= []).push({ id: "hexer-connections", text: `Hexer connections: ${JSON.stringify(cell.connections)}`, visible: false });
			warn("Cell connections are preserved in GM notes; only exported paths create networks.");
		}
		target.cells.set(num, { ...cell, biome }); target.records.set(num, record);
	}
	check(layers.size > 0, "no base-scale hexes to import");
	const targetFor = entity => {
		const layer = layerOf(entity.layer);
		check(layers.has(layer), `entity references a layer with no base cells: ${layer}`);
		return layers.get(layer);
	};
	const recordFor = (target, hex) => {
		check(inBounds(hex), "entity hex is outside the map");
		const record = target.records.get(numOf(hex.q, hex.r));
		check(record, "entity references a missing hex"); return record;
	};
	const cellVisible = (target, num) => !fogEnabled
		|| ["visible", "explored"].includes(target.cells.get(num).fogState);
	for (const region of list(data.regions, "regions")) {
		if (!base(region)) continue;
		const target = targetFor(region); const zone = text(region.name, "region.name");
		for (const hex of list(region.hexes, "region.hexes")) {
			const record = recordFor(target, hex);
			record.zone = record.zone ? `${record.zone} / ${zone}` : zone;
		}
	}
	for (const [index, poi] of list(data.pois, "pois").entries()) {
		if (!base(poi)) continue;
		const target = targetFor(poi); const record = recordFor(target, poi.hex);
		const type = text(poi.type, "poi.type"); const label = text(poi.label, "poi.label", type);
		const [featureType, icon] = POIS.get(type) ?? ["other", "Star"];
		const visible = cellVisible(target, record.num);
		record.name = record.name ? `${record.name} / ${label}` : label;
		record.icon ??= `assets/symbols/Symbols/Icon - ${icon}.webp`;
		(record.features ??= []).push({ id: `hexer-poi-${index}`, type: featureType, name: label, discovered: visible });
		record.showToPlayers ||= visible;
	}
	for (const [index, note] of list(data.notes, "notes").entries()) {
		if (!base(note)) continue;
		const target = targetFor(note); const record = recordFor(target, note.hex);
		check(note.dmOnly === undefined || typeof note.dmOnly === "boolean", "note.dmOnly must be boolean");
		const title = text(note.title, "note.title"); const content = text(note.content, "note.content");
		const visible = cellVisible(target, record.num) && note.dmOnly === false
			&& (!note.discoveryType || note.discoveryType === "visible");
		(record.notes ??= []).push({ id: `hexer-note-${index}`, text: [title, content].filter(Boolean).join("\n"), visible });
		record.showToPlayers ||= visible;
		if (note.discoveryType && note.discoveryType !== "visible") warn("Conditional note discovery is not implemented; these notes start hidden.");
	}
	for (const path of list(data.paths, "paths")) {
		if (!base(path)) continue;
		targetFor(path).paths.push(path);
	}
	if (list(data.tokens, "tokens").length) warn("Tokens are not imported.");
	if (data.pointCrawl !== undefined) {
		check(object(data.pointCrawl), "pointCrawl must be an object");
		if (list(data.pointCrawl.nodes, "pointCrawl.nodes").length || list(data.pointCrawl.edges, "pointCrawl.edges").length) warn("Point-crawl nodes/edges are not imported.");
	}
	const maps = [];
	for (const layer of LAYERS.filter(layer => layers.has(layer))) {
		const target = layers.get(layer); const groups = new Map();
		// Existing tooltips accept rich HTML. File-supplied text must never become markup.
		for (const record of target.records.values()) {
			for (const field of ["name", "zone", "terrain"]) {
				if (record[field] !== undefined) record[field] = htmlText(record[field]);
			}
			for (const note of record.notes ?? []) note.text = htmlText(note.text);
			for (const feature of record.features ?? []) feature.name = htmlText(feature.name);
		}
		for (const [num, cell] of target.cells) {
			if (!groups.has(cell.biome)) groups.set(cell.biome, []);
			groups.get(cell.biome).push(num);
		}
		if (target.cells.size < width * height) warn(`Layer ${layer}: missing cells are filled with plains and start unrevealed.`);
		if (target.paths.length) warn("Paths use straight control-point segments, not Hexer's smoothed styling; nearby unconnected routes stay separate.");
		maps.push({
			layer,
			dataset: {
				name: layer === "surface" ? name : `${name} — ${layer.replace("level_", "Level ")}`,
				grid: { cols: width, rows: height, landscape: pointy, flipX: false, flipY: false },
				terrain: { default: "plains", regions: [...groups].map(([biome, hexes]) => ({ biome, hexes })) },
				hexes: [...target.records.values()].filter(record => Object.keys(record).length > 1),
				networks: rasterize(target.paths, width, height, pointy, warn),
			},
			flags: { hexFogEnabled: fogEnabled, hexFogRevealed: target.revealed },
		});
	}
	return { maps, warnings: [...warnings] };
}
