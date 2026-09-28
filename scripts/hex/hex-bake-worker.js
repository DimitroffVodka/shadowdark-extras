/**
 * Baked hex maps — the KTX2 encoder for hex-bake.mjs.
 *
 * Runs in Foundry's worker harness (foundry.helpers.AsyncWorker), loaded after
 * Foundry's own libktx (public/scripts/ktx2/libktx.js), so nothing is shipped
 * for it. The harness calls these globals and expects [result, transfer].
 */
/* global createKtxModule */

let ktx;

globalThis.initializeBakeEncoder = async function(wasmUrl) {
	ktx = await createKtxModule({ locateFile: path => (path === "libktx.wasm" ? wasmUrl : path) });
	return [];
};

/**
 * One square piece and its mip levels, premultiplied RGBA8, to a KTX2 file:
 * ETC1S with a linear transfer function, the settings Foundry's dev gave for
 * Bastion of Blasphemies.
 */
globalThis.encodeBakePiece = function(levels, { clevel, qlevel }) {
	const size = Math.sqrt(levels[0].length / 4);
	const ok = (code, step) => {
		if ((code?.value ?? code) !== 0) throw new Error(`KTX2 ${step} failed with code ${code?.value ?? code}`);
	};
	const info = new ktx.textureCreateInfo();
	Object.assign(info, {
		vkFormat: ktx.VkFormat.R8G8B8A8_UNORM, baseWidth: size, baseHeight: size, baseDepth: 1,
		numDimensions: 2, numLevels: levels.length, numLayers: 1, numFaces: 1, isArray: false,
		generateMipmaps: false,
	});
	const texture = new ktx.texture(info, ktx.TextureCreateStorageEnum.ALLOC_STORAGE);
	const params = new ktx.basisParams();
	try {
		levels.forEach((pixels, level) => ok(texture.setImageFromMemory(level, 0, 0, pixels), "image"));
		texture.oetf = ktx.khr_df_transfer.LINEAR;
		// No threads in the page's WASM (not cross-origin isolated): the bake runs several workers.
		Object.assign(params, {
			uastc: false, compressionLevel: clevel, qualityLevel: qlevel, threadCount: 1, noSSE: true,
		});
		ok(texture.compressBasis(params), "encode");
		const bytes = new Uint8Array(texture.writeToMemory());
		return [bytes, [bytes.buffer]];
	}
	finally {
		texture.delete();
		params.delete();
		info.delete();
	}
};
