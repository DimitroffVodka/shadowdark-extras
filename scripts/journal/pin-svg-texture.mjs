const intrinsicTextureCache = new Map();

/**
 * Add explicit intrinsic dimensions to viewBox-only SVG markup.
 *
 * Browsers default an SVG without width/height to 300×150. Foundry's SVG
 * texture pipeline can then place that 300×150 render at the top of a square
 * 300×300 canvas. Explicit dimensions make the texture honor its viewBox.
 *
 * @param {string} markup SVG source text.
 * @returns {string} Markup with missing intrinsic dimensions supplied.
 */
export function normalizeSvgIntrinsicSize(markup) {
	const openTag = markup.match(/<svg\b[^>]*>/i)?.[0];
	if (!openTag) return markup;

	const hasWidth = /\bwidth\s*=/i.test(openTag);
	const hasHeight = /\bheight\s*=/i.test(openTag);
	if (hasWidth && hasHeight) return markup;

	const viewBox = openTag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
	const values = viewBox?.trim().split(/[\s,]+/).map(Number);
	if (!values || values.length !== 4 || !values.every(Number.isFinite)) return markup;

	const [, , viewWidth, viewHeight] = values;
	if (viewWidth <= 0 || viewHeight <= 0) return markup;

	const dimensions = [
		hasWidth ? "" : ` width="${viewWidth}"`,
		hasHeight ? "" : ` height="${viewHeight}"`,
	].join("");
	const normalizedTag = openTag.replace(/>$/, `${dimensions}>`);
	return markup.replace(openTag, normalizedTag);
}

/**
 * Load an SVG after normalizing its intrinsic dimensions.
 *
 * @param {string} path Data path to the SVG.
 * @param {(url: string) => Promise<object>} textureLoader Foundry texture loader.
 * @returns {Promise<object>} Loaded PIXI texture.
 */
export async function loadIntrinsicSvgTexture(path, textureLoader) {
	if (!intrinsicTextureCache.has(path)) {
		const pending = (async () => {
			const response = await fetch(path);
			if (!response.ok) throw new Error(`Failed to load icon SVG: ${path}`);

			const source = normalizeSvgIntrinsicSize(await response.text());
			const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
			return textureLoader(dataUrl);
		})().catch(error => {
			intrinsicTextureCache.delete(path);
			throw error;
		});
		intrinsicTextureCache.set(path, pending);
	}
	return intrinsicTextureCache.get(path);
}
