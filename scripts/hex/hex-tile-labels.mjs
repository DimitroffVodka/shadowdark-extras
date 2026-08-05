// Display-label helpers shared by every hex tile store — the leaf that the
// rest of the HexPainterSD.mjs split can import without a cycle.
//
// This has a module of its own rather than living in whichever tile store was
// extracted first. _formatLabel is called from the default, custom, colored,
// symbol and decor loaders alike; it landed in hex-decor.mjs only because the
// decor seam was extracted first, which left hex-colored-tiles.mjs importing a
// five-line string helper out of an unrelated feature module.
//
// Imports nothing by design: a leaf module is what keeps the extraction
// provable (read-only ESM bindings forbid cross-module assignment).

export function _formatLabel(key) {
	return key
		.split("-")
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
