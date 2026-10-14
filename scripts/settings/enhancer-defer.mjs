/**
 * Where Shadowdark Enhancer has the same table feature, the Enhancer wins and this module
 * stands down. Hard-coded on purpose: no setting and no version check, so nothing has to be
 * switched off by hand. With the Enhancer absent both answers are false and nothing changes.
 */

/** The Enhancer module is installed and active. */
export function enhancerActive() {
	return globalThis.game?.modules?.get?.("shadowdark-enhancer")?.active === true;
}

/**
 * The Enhancer's fog has disclosed `offset` ({i, j}) to the viewing user: kind "location" is the party
 * having been there or the GM revealing it. Anything it cannot answer is no, so art stays hidden.
 */
export function enhancerDisclosed(scene, offset, kind = "location") {
	try {
		return globalThis.game?.shadowdarkEnhancer?.hexMaps?.fog?.disclosed?.(scene, offset, kind) === true;
	}
	catch{
		return false;
	}
}

/**
 * Plain ground under a scene's keyed hexes, from the Enhancer (hexMaps.fillKeyedGround,
 * API 1.31.0). A bake draws keyed art as sprites that a fog can hide, so a hex whose only
 * Tile is that art would bake as a hole marking where a location is. The ground is made on
 * the scene itself and `remove` takes it away again.
 *
 * `remove` acts only when this call made some: the Enhancer's own Bake map lays the ground
 * first and then calls the bake, so the fill here finds it done, makes nothing, and leaves
 * the clean-up to whoever laid it. Nothing here throws. With no Enhancer, no keyed art, or
 * an Enhancer that predates the call, nothing is laid.
 * @param {Scene} scene
 * @param {number} keyed  how many keyed Tiles the scene has; none, nothing to put ground under
 * @returns {Promise<{created:number, unfilled:object[], error:Error|null,
 *   remove:()=>Promise<Error|null>}>}
 */
export async function layKeyedGround(scene, keyed) {
	const hexMaps = globalThis.game?.shadowdarkEnhancer?.hexMaps;
	const ready = keyed > 0 && (typeof hexMaps?.fillKeyedGround === "function")
		&& (typeof hexMaps?.removeKeyedGround === "function");
	if (!ready) return { created: 0, unfilled: [], error: null, remove: async () => null };
	const before = scene.tiles.size;
	let report = null;
	let error = null;
	try {
		report = await hexMaps.fillKeyedGround(scene);
	}
	catch(err) {
		error = err;
	}
	// A fill that failed may have laid some batches first, so the scene is asked, not the report.
	const created = error ? (scene.tiles.size - before) : (report?.created ?? 0);
	const remove = async () => {
		if (!created) return null;
		try {
			await hexMaps.removeKeyedGround(scene);
			return null;
		}
		catch(err) {
			return err;
		}
	};
	return { created, unfilled: report?.unfilled ?? [], error, remove };
}

/** The Enhancer runs `feature` ("hex.fog", "hex.tooltip") on this scene. Asked per event, never cached. */
export function enhancerOwns(feature, scene = globalThis.canvas?.scene) {
	try {
		return globalThis.game?.shadowdarkEnhancer?.owns?.(feature, scene) === true;
	}
	catch{
		return false;
	}
}
