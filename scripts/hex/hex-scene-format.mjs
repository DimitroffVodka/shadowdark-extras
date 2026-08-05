// The requested hex-map dimensions and the scene reformat that applies them —
// the one place that decides how many pixels an N×M columnar-hex scene needs.
// Extracted verbatim from scripts/hex/HexPainterSD.mjs (Phase 5.3 sweep 6
// split).
//
// Imports nothing from the painter by design: the painter imports these names
// back under the same identifiers, and a leaf module is what keeps the
// extraction provable (read-only ESM bindings forbid cross-module assignment).
// MODULE_ID and HEX_TILE_H are duplicated rather than imported for the same
// reason — the painter still reads both.

const MODULE_ID = "shadowdark-extras";
const HEX_TILE_H = 256;

// State
export let _mapColumns = 15;
export let _mapRows = 15;

export function setMapDimension(axis, value) {
	const clamped = Math.max(5, Math.min(200, parseInt(value) || 15));
	if (axis === "columns") _mapColumns = clamped;
	if (axis === "rows") _mapRows = clamped;
}

export function getMapDimensions() {
	return { columns: _mapColumns, rows: _mapRows };
}

export async function formatActiveScene() {
	const scene = canvas.scene;
	if (!scene) {
		ui.notifications.error("SDX | No active scene to format.");
		return;
	}

	// Size the scene to EXACTLY _mapColumns × _mapRows hex cells, with edge hexes
	// rendered whole rather than sliced flat by the rectangular scene boundary.
	// Verified against HexagonalGrid#calculateDimensions (HEXODDQ, N = 5..200,
	// cap raised from 50 — formula is N-independent, live-verified at 65×77):
	//   • columns (flat-top hexes point left/right): width = floor((N + 1/3)·p),
	//     where the column pitch p = 0.75·hexWidth and hexWidth = S·(2/√3). This is
	//     the MAX width Foundry still counts as N columns — it lands on the last
	//     column's right vertices, so the right edge shows whole hexes. (Sizing to
	//     the pitch boundary N·p instead clips the last column to ~75% — flat-cut.)
	//   • rows (flat-top hexes are flat top/bottom): height = N·S − S/2, the MAX
	//     height Foundry counts as N rows.
	// The old formula added a fit-padding hex AND a 768px SCENE_BUFFER, gridded into
	// ~3-4 unpredictable phantom cells per side (a 5×5 request → 9×9).
	// NOTE: top/bottom edges still show half-hexes on alternating columns — that is
	// Foundry's fixed columnar-hex origin, not removable via scene sizing.
	const hexWidth = HEX_TILE_H * (2 / Math.sqrt(3));
	const pxW = Math.floor((_mapColumns + (1 / 3)) * 0.75 * hexWidth);
	const pxH = (_mapRows * HEX_TILE_H) - (HEX_TILE_H / 2);

	const sceneData = {
		width: pxW,
		height: pxH,
		padding: 0,
		backgroundColor: "#3C3836",
		"grid.type": CONST.GRID_TYPES.HEXODDQ,
		"grid.size": HEX_TILE_H,
		"grid.distance": 6,
		"grid.units": "mi",
		"background.src": null,
	};

	try {
		ui.notifications.info(`SDX | Formatting scene to ${_mapColumns}×${_mapRows} hexes…`);
		await scene.update(sceneData);

		let tries = 0;
		while (tries < 40) {
			const rect = canvas.dimensions.sceneRect || canvas.dimensions;
			if (Math.abs((rect.width || 0) - pxW) < 2) break;
			await new Promise(r => setTimeout(r, 120));
			tries++;
		}

		await scene.setFlag(MODULE_ID, "hexScene", true);
		ui.notifications.info("SDX | Scene formatted for hex painting.");
	}
	catch (err) {
		console.error(`${MODULE_ID} | Scene format failed:`, err);
		ui.notifications.error("SDX | Could not format the scene.");
	}
}
