// Western Reaches visibility. Grid operations are supplied by Foundry (all hex orientations).
const keyOf = ({ i, j }) => `${i}-${j}`;
const recordKey = ({ i, j }) => `${i}_${j}`;
const terrainKey = value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Optional provider boundary: no rules, live weather, party, or scene terrain means legacy fog. */
export function readHexVisibility(game, token, records) {
	const api = game.shadowdarkEnhancer;
	if (!game.modules.get("shadowdark-enhancer")?.active
		|| token.actor?.type !== "NPC" || token.actor?.getFlag("shadowdark-extras", "isParty") !== true
		|| typeof api?.rules?.visibility !== "function" || typeof api?.time?.isNight !== "function"
		|| typeof api?.overland?.state !== "function"
		|| !Object.values(records ?? {}).some(record => record?.terrain)) return null;
	try {
		const rules = api.rules.visibility();
		if (!["darkness", "stormy", "excellent", "slight", "high"].every(k => Number.isFinite(rules?.[k]))) return null;
		const { weather } = api.overland.state();
		if (!["fair", "stormy", "excellent"].includes(weather?.kind)
			|| !Number.isFinite(weather.until) || weather.until <= game.time.worldTime) return null;
		return {
			rules, weather: weather.kind, isNight: region => api.time.isNight(undefined, { region }),
		};
	}
	catch{
		return null;
	}
}

/** Actual travelled waypoints, not _source (which already holds the destination in updateToken). */
export function hexMovementPath(token, options, grid) {
	const move = options?._movement?.[token.id];
	const positions = move?.origin
		? [move.origin, ...(move.passed?.waypoints ?? []), token] : [token];
	const points = positions.map(p => ({
		x: p.x + ((p.width ?? token.width) * grid.sizeX / 2),
		y: p.y + ((p.height ?? token.height) * grid.sizeY / 2),
	}));
	return grid.getDirectPath(points);
}

export function hexNearRadius(rules, terrain, night, weather) {
	const elevation = rules.elevation?.[terrainKey(terrain)];
	return Math.max(0, Math.floor(1 + (night ? rules.darkness : 0)
		+ (weather === "stormy" ? rules.stormy : weather === "excellent" ? rules.excellent : 0)
		+ (elevation === "slight" || elevation === "high" ? rules[elevation] : 0)));
}

/** Build once per movement, not once per candidate or path cell. Features never obstruct. */
export function mountainCells(records) {
	return Object.entries(records ?? {}).flatMap(([key, record]) => {
		if (terrainKey(record?.terrain) !== "mountain") return [];
		const [i, j] = key.split("_").map(Number);
		return Number.isInteger(i) && Number.isInteger(j) ? [{ i, j }] : [];
	});
}

/** Endpoints never obstruct: the first mountain is visible, even from another mountain. */
export function hasHexSight(grid, origin, target, mountains) {
	const line = grid.getDirectPath([origin, target]);
	return !line.slice(1, -1).some(cell => mountains.has(keyOf(cell)));
}

/** null means this origin lacks usable terrain/time data; its caller keeps the old radius path. */
export function visibleHexes(grid, origin, records, conditions, mountains) {
	const record = records?.[recordKey(origin)];
	if (!record?.terrain) return null;
	let night;
	try {
		night = conditions.isNight(record.zone || record.region);
	}
	catch{
		return null;
	}
	if (typeof night !== "boolean") return null;
	const radius = hexNearRadius(conditions.rules, record.terrain, night, conditions.weather);
	const blockers = new Set(mountains.map(keyOf));
	const near = new Set([keyOf(origin)]);
	const visited = new Set(near);
	let frontier = [origin];
	for (let depth = 0; depth < radius && frontier.length; depth++) {
		const next = [];
		for (const cell of frontier) for (const neighbor of grid.getAdjacentOffsets(cell)) {
			const key = keyOf(neighbor);
			if (visited.has(key)) continue;
			visited.add(key);
			next.push(neighbor);
			if (hasHexSight(grid, origin, neighbor, blockers)) near.add(key);
		}
		frontier = next;
	}
	const distant = new Set();
	if (!night && conditions.weather !== "stormy") for (const mountain of mountains) {
		const key = keyOf(mountain);
		if (!near.has(key) && hasHexSight(grid, origin, mountain, blockers)) distant.add(key);
	}
	return { near, distant, radius };
}

/** Additive discovery: never demote known hexes or retroactively hide legacy/explored records. */
export function hexDiscoveryPatch(near, distant, revealed, discovery, records) {
	const patch = {};
	for (const key of distant) {
		const record = records?.[key.replace(/^(-?\d+)-(-?\d+)$/, "$1_$2")];
		if (near.has(key) || discovery[key] || revealed[key]
			|| ["explored", "mapped"].includes(record?.exploration)) continue;
		patch[key] = "terrain";
	}
	for (const key of near) if (discovery[key] !== "near") patch[key] = "near";
	return patch;
}

/** Presentation only: the shared hex journal is still readable by players as before. */
export function playerHexRecord(record, discovery, isGM) {
	if (isGM) return record;
	if (discovery === "terrain") return { terrain: record?.terrain ?? "", showToPlayers: true, terrainOnly: true };
	if (discovery === "near") return { ...record, showToPlayers: true };
	return record;
}
