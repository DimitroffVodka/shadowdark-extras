/**
 * Keep a hex map's art on the GPU (#178).
 *
 * A hex map draws from hundreds of images (Tiles, or Enhancer's keyed sprites)
 * and at play zoom all but a few dozen are culled. PIXI's texture GC unloads a
 * texture after 3,600 frames unused, 24 s at 150 FPS, so the next zoom-out
 * re-uploaded the whole map in one frame: 242 images and a 400 ms freeze on
 * Western Reaches. Foundry already budgets its scene textures as GPU memory
 * (TextureLoader's per-mode limits), so keep the map's textures resident, and
 * upload any that are not yet through PIXI's prepare queue, 4 per frame.
 */

/** Frames between passes; well inside PIXI's 3,600-frame idle limit. */
const PASS_FRAMES = 60;

let frame = 0;

function keepMapArtResident() {
	if (++frame < PASS_FRAMES || !canvas.ready) return;
	frame = 0;
	const { renderer } = canvas.app;
	const { count } = renderer.textureGC;
	let queued = false;
	for (const object of canvas.primary.children) {
		const texture = object.texture;
		const base = texture?.baseTexture;
		if (!base?.valid) continue;
		base.touched = count;
		if (base._glTextures[renderer.CONTEXT_UID]) continue;
		renderer.prepare.add(texture);
		queued = true;
	}
	if (queued) renderer.prepare.upload();
}

export function initHexArtResidency() {
	Hooks.on("canvasReady", () => {
		canvas.app.ticker.remove(keepMapArtResident);
		if (!canvas.grid?.isHexagonal) return;
		frame = PASS_FRAMES;
		canvas.app.ticker.add(keepMapArtResident);
	});
}
