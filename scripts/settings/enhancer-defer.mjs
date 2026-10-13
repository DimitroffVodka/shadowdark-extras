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

/** The Enhancer runs `feature` ("hex.fog", "hex.tooltip") on this scene. Asked per event, never cached. */
export function enhancerOwns(feature, scene = globalThis.canvas?.scene) {
	try {
		return globalThis.game?.shadowdarkEnhancer?.owns?.(feature, scene) === true;
	}
	catch{
		return false;
	}
}
