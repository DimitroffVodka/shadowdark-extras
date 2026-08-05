// Drawing palette and stamp sizes — extracted from
// scripts/canvas/SDXDrawingTool.mjs (Phase 5.3 split). Both are read by the
// tool, by all three of its mixins and, in the palette's case, by the toolbar,
// so they cannot live in any one of those without the others importing back
// into it. SDXDrawingTool re-exports them, keeping its surface unchanged.

// ─── Color Palette ───────────────────────────────────────────────
export const COLORS = {
	black: "rgba(38, 38, 38, 0.7)",
	red: "rgba(186, 60, 49, 0.7)",
	blue: "rgba(76, 147, 204, 0.7)",
	green: "rgba(3, 105, 41, 0.7)",
	yellow: "rgba(219, 130, 12, 0.7)",
	white: "rgba(220, 220, 220, 0.7)",
	gray: "rgba(128, 128, 128, 0.7)",
	brown: "rgba(139, 90, 43, 0.7)",
	orange: "rgba(230, 126, 34, 0.7)",
	pink: "rgba(210, 100, 140, 0.7)",
	purple: "rgba(142, 68, 173, 0.7)",
	cyan: "rgba(52, 172, 186, 0.7)",
	lime: "rgba(120, 195, 46, 0.7)",
	navy: "rgba(44, 62, 110, 0.7)",
	crimson: "rgba(160, 30, 50, 0.7)",
};

// ─── Stamp sizes (px square) ────────────────────────────────────
export const STAMP_SIZES = { small: 40, medium: 80, large: 140 };
