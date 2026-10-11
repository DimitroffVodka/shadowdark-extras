/**
 * Where Shadowdark Enhancer has the same table feature, the Enhancer wins and this module
 * stands down. Hard-coded on purpose: no setting and no version check, so nothing has to be
 * switched off by hand. With the Enhancer absent both answers are false and nothing changes.
 */

/** The Enhancer module is installed and active. */
export function enhancerActive() {
	return globalThis.game?.modules?.get?.("shadowdark-enhancer")?.active === true;
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
