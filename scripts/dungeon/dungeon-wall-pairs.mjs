// One SDX wall is two documents on two layers: a Drawing carrying the art and a
// Wall carrying the collision. Nothing recorded that they belonged together, so
// removing one wall meant finding and deleting both by hand, on both layers —
// and SDX itself had to re-derive the relationship geometrically, matching wall
// endpoints against drawing endpoints within a 30px tolerance.
//
// This module records the relationship instead. Both documents are stamped with
// the same random pair id at creation, and deleting either one takes its partner
// with it, through whatever path the deletion came from: the Delete key on
// either layer, the context menu, a select-all, or the API.
//
// Only AUTHORED walls are paired — interior walls and reskinned walls. The
// painter's own room walls are derived from the floor cell set and regenerated
// wholesale on every paint, so they have no stable identity to pair and deleting
// one by hand is already a no-op that the next rebuild undoes.

const MODULE_ID = "shadowdark-extras";

// Depth rather than a boolean so nested suppressed operations compose. This
// guards SDX's OWN bulk paths (clearSceneAtLevel), which already delete both
// sides deliberately and would otherwise race the cascade into deleting ids
// that the bulk path is still holding.
//
// The recursive case needs no guard and deliberately has none: deleting a
// Drawing cascades to its Wall, whose own hook then looks for Drawings with that
// pair id and finds none, because the Drawing is already out of the collection
// by the time the hook fires.
let _suppressDepth = 0;

/**
 * A fresh pair id. Stamp the same one on both halves of a wall.
 */
export function newWallPairId() {
	return foundry.utils.randomID();
}

/**
 * Run an SDX-managed bulk delete without the cascade firing.
 * @param {Function} fn - may be async; suppression lasts until it settles
 */
export async function withoutPairCascade(fn) {
	_suppressDepth += 1;
	try {
		return await fn();
	}
	finally {
		_suppressDepth -= 1;
	}
}

// Literal key, not a const: the flag-snapshot analyser reads flag accesses
// statically, and a computed [PAIR_KEY] would land in its unenumerable blind
// spot instead of being tracked like every other flag in the module.
function pairIdOf(doc) {
	return doc?.flags?.[MODULE_ID]?.wallPairId ?? null;
}

/**
 * The Wall that belongs to an interior-wall Drawing.
 *
 * Prefers the recorded pair id and falls back to the endpoint comparison this
 * replaced. The fallback is not dead code: documents created before pairing
 * existed carry no pair id, and worlds hold plenty of them.
 *
 * @param {Scene} scene
 * @param {DrawingDocument} drawing
 * @param {{x: number, y: number}[]} [endpoints] - the drawing's wall-axis ends,
 *        required only for the legacy path
 * @returns {WallDocument|null}
 */
export function findPairedWall(scene, drawing, endpoints = null) {
	const pairId = pairIdOf(drawing);
	if (pairId) {
		const paired = scene.walls.find(w => pairIdOf(w) === pairId && !(w.door > 0));
		if (paired) return paired;
	}

	if (!endpoints) return null;
	const [p1, p2] = endpoints;
	const tolerance = 30;
	const near = (ax, ay, bx, by) => Math.abs(ax - bx) < tolerance && Math.abs(ay - by) < tolerance;
	return scene.walls.find(w => {
		if (!w.flags?.[MODULE_ID]?.dungeonIntWall) return false;
		if (w.door && w.door > 0) return false;
		const [wx1, wy1, wx2, wy2] = w.c;
		return (near(wx1, wy1, p1.x, p1.y) && near(wx2, wy2, p2.x, p2.y))
            || (near(wx1, wy1, p2.x, p2.y) && near(wx2, wy2, p1.x, p1.y));
	}) ?? null;
}

/**
 * Delete the partner of a document that was just deleted.
 * @param {ClientDocument} doc
 * @param {"Wall"|"Drawing"} partnerType
 */
function cascade(doc, partnerType) {
	if (_suppressDepth > 0) return;
	if (!game.user?.isGM) return;

	const pairId = pairIdOf(doc);
	if (!pairId) return;

	const scene = doc.parent;
	if (!scene) return;

	const collection = partnerType === "Wall" ? scene.walls : scene.drawings;
	const ids = collection.filter(d => pairIdOf(d) === pairId).map(d => d.id);
	if (ids.length === 0) return;

	// Not awaited: hook callbacks are synchronous. Suppression stays raised for
	// the duration of the delete, which is what keeps a bulk clear from racing
	// it, and lowers when the promise settles.
	withoutPairCascade(() => scene.deleteEmbeddedDocuments(partnerType, ids))
		.catch(err => console.warn(`${MODULE_ID} | Paired ${partnerType} delete failed:`, err));
}

/**
 * Register the two-way cascade. Called once from the composition root.
 */
export function registerWallPairCascade() {
	Hooks.on("deleteDrawing", drawing => cascade(drawing, "Wall"));
	Hooks.on("deleteWall", wall => cascade(wall, "Drawing"));
}
