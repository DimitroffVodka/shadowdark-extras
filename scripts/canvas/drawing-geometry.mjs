// Drawing geometry for the canvas drawing tool — extracted from
// scripts/canvas/SDXDrawingTool.mjs (Phase 5.3.5 split).
//
// Stroke styles, box/ellipse primitives, stamp shapes, the hex-cluster outline
// and CSS colour parsing. Everything here computes and draws through the
// PIXI.Graphics it is handed; none of it touches tool state, which is what
// makes it assertable as a command sequence.
//
// getHexClusterOutline reads canvas.grid for hex metrics, and returns null for
// any cluster it cannot walk into a closed ring — the callers treat that as
// "draw no outline". See dev/tests/canvas-drawing-geometry.test.mjs.

export function cssToPixiColor(css) {
	if (typeof css === "number") return css;
	if (typeof css === "string") {
		if (css.startsWith("#")) return parseInt(css.slice(1), 16);
		const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (m) return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
	}
	return 0x000000;
}

export function drawLineWithStyle(g, pts, sx, sy, sw, color, alpha, style) {
	if (!pts || pts.length === 0) return;
	g.lineStyle(sw, color, alpha);
	if (style === "solid") {
		g.moveTo(sx + pts[0][0], sy + pts[0][1]);
		for (let i = 1; i < pts.length; i++) g.lineTo(sx + pts[i][0], sy + pts[i][1]);
	}
	else if (style === "dotted") {
		const dotR = sw * 0.4; const dotSp = sw * 4;
		let total = 0; const segs = [];
		for (let i = 0; i < pts.length - 1; i++) {
			const dx = pts[i + 1][0] - pts[i][0]; const dy = pts[i + 1][1] - pts[i][1];
			const d = Math.sqrt((dx * dx) + (dy * dy));
			if (d > 0) {
				segs.push({ x1: sx + pts[i][0], y1: sy + pts[i][1], dx, dy, dist: d });
				total += d;
			}
		}
		let cur = 0;
		while (cur < total) {
			let sl = 0;
			for (const seg of segs) {
				if (cur >= sl && cur < sl + seg.dist) {
					const t = (cur - sl) / seg.dist;
					g.beginFill(color, alpha);
					g.drawCircle(seg.x1 + (seg.dx * t), seg.y1 + (seg.dy * t), dotR);
					g.endFill();
					break;
				}
				sl += seg.dist;
			}
			cur += dotSp;
		}
	}
	else if (style === "dashed") {
		const dashL = sw * 6; const gapL = sw * 2;
		let total = 0; const segs = [];
		for (let i = 0; i < pts.length - 1; i++) {
			const dx = pts[i + 1][0] - pts[i][0]; const dy = pts[i + 1][1] - pts[i][1];
			const d = Math.sqrt((dx * dx) + (dy * dy));
			if (d > 0) {
				segs.push({
					x1: sx + pts[i][0], y1: sy + pts[i][1], x2: sx + pts[i + 1][0],
					y2: sy + pts[i + 1][1], dx, dy, dist: d,
				});
				total += d;
			}
		}
		let cur = 0; let drawing = true;
		while (cur < total) {
			const segL = drawing ? dashL : gapL;
			const next = Math.min(cur + segL, total);
			if (drawing) {
				let sl = 0; let startPt = null; let endPt = null;
				for (const seg of segs) {
					if (!startPt && cur >= sl && cur < sl + seg.dist) {
						const t = (cur - sl) / seg.dist; startPt = {
							x: seg.x1 + (seg.dx * t), y: seg.y1 + (seg.dy * t),
						};
					}
					if (!endPt && next >= sl && next <= sl + seg.dist) {
						const t = (next - sl) / seg.dist; endPt = {
							x: seg.x1 + (seg.dx * t), y: seg.y1 + (seg.dy * t),
						};
					}
					if (startPt && endPt) break;
					sl += seg.dist;
				}
				if (startPt && endPt) {
					g.moveTo(startPt.x, startPt.y); g.lineTo(endPt.x, endPt.y);
				}
			}
			cur = next;
			drawing = !drawing;
		}
	}
}


export function drawBoxWithStyle(g, x, y, w, h, style, brush) {
	if (style === "solid") {
		g.drawRect(x, y, w, h);
	}
	else {
		const sw = brush.size;
		const color = cssToPixiColor(brush.color);
		drawLineWithStyle(g, [[0, 0], [w, 0]], x, y, sw, color, 1.0, style);
		drawLineWithStyle(g, [[0, 0], [0, h]], x + w, y, sw, color, 1.0, style);
		drawLineWithStyle(g, [[0, 0], [-w, 0]], x + w, y + h, sw, color, 1.0, style);
		drawLineWithStyle(g, [[0, 0], [0, -h]], x, y + h, sw, color, 1.0, style);
	}
}

export function drawEllipseWithStyle(g, x, y, w, h, style, brush) {
	const cx = x + (w / 2); const cy = y + (h / 2);
	const hw = Math.abs(w) / 2; const hh = Math.abs(h) / 2;
	if (style === "solid") {
		g.drawEllipse(cx, cy, hw, hh);
	}
	else {
		const segs = 48;
		const color = cssToPixiColor(brush.color);
		const sw = brush.size;
		const pts = [];
		for (let i = 0; i <= segs; i++) {
			const t = (Math.PI * 2 * i) / segs;
			pts.push([cx + (hw * Math.cos(t)), cy + (hh * Math.sin(t))]);
		}
		for (let i = 0; i < segs; i++) {
			const [x0, y0] = pts[i]; const [x1, y1] = pts[i + 1];
			drawLineWithStyle(
				g, [[0, 0], [x1 - x0, y1 - y0]], x0, y0, sw, color, 1.0, style
			);
		}
	}
}

export function drawSymbolShape(
	g, type, cx, cy, half, pad, sw, color, alpha, shadowColor, shadowAlpha, shadowOff
) {
	switch (type) {
		case "plus": {
			const arm = half - pad;
			g.lineStyle(sw, shadowColor, shadowAlpha);
			g.moveTo(cx - arm + shadowOff, cy + shadowOff); g.lineTo(
				cx + arm + shadowOff, cy + shadowOff
			);
			g.moveTo(cx + shadowOff, cy - arm + shadowOff); g.lineTo(
				cx + shadowOff, cy + arm + shadowOff
			);
			g.lineStyle(sw, color, alpha);
			g.moveTo(cx - arm, cy); g.lineTo(cx + arm, cy);
			g.moveTo(cx, cy - arm); g.lineTo(cx, cy + arm);
			break;
		}
		case "x": {
			const arm = (half - pad) * 0.707;
			g.lineStyle(sw, shadowColor, shadowAlpha);
			g.moveTo(cx - arm + shadowOff, cy - arm + shadowOff); g.lineTo(
				cx + arm + shadowOff, cy + arm + shadowOff
			);
			g.moveTo(cx + arm + shadowOff, cy - arm + shadowOff); g.lineTo(
				cx - arm + shadowOff, cy + arm + shadowOff
			);
			g.lineStyle(sw, color, alpha);
			g.moveTo(cx - arm, cy - arm); g.lineTo(cx + arm, cy + arm);
			g.moveTo(cx + arm, cy - arm); g.lineTo(cx - arm, cy + arm);
			break;
		}
		case "dot": {
			const r = half - pad;
			g.lineStyle(0);
			g.beginFill(shadowColor, shadowAlpha);
			g.drawCircle(cx + shadowOff, cy + shadowOff, r); g.endFill();
			g.beginFill(color, alpha); g.drawCircle(cx, cy, r); g.endFill();
			break;
		}
		case "arrow": case "arrow-up": case "arrow-down": case "arrow-left": {
			const sf = 0.70; const sh = (half - pad) * sf;
			let base = [
				cx - sh, cy - sh, cx - sh + (2 * sh * 0.25), cy, cx - sh, cy + sh, cx + sh, cy,
			];
			let angle = type === "arrow-up" ? -Math.PI / 2 : type === "arrow-down" ? Math.PI / 2 : type === "arrow-left" ? Math.PI : 0;
			let rot = [];
			for (let i = 0; i < base.length; i += 2) {
				const tx = base[i] - cx; const ty = base[i + 1] - cy;
				rot.push(
					(tx * Math.cos(angle)) - (ty * Math.sin(angle)) + cx,
					(tx * Math.sin(angle)) + (ty * Math.cos(angle)) + cy
				);
			}
			let shadow = rot.map((v, i) => v + shadowOff);
			// Fix: shadow needs alternating offsets
			shadow = [];
			for (let i = 0; i < rot.length; i++) shadow.push(rot[i] + shadowOff);
			g.lineStyle(0);
			g.beginFill(shadowColor, shadowAlpha); g.drawPolygon(shadow); g.endFill();
			g.beginFill(color, alpha); g.drawPolygon(rot); g.endFill();
			break;
		}
		case "square": {
			const sf = 0.85;
			const sh = (half - pad) * sf; const sz = sh * 2; const cr = sz * 0.08;
			g.lineStyle(0);
			g.beginFill(shadowColor, shadowAlpha);
			g.drawRoundedRect(cx - sh + shadowOff, cy - sh + shadowOff, sz, sz, cr);
			g.endFill();
			g.beginFill(color, alpha);
			g.drawRoundedRect(cx - sh, cy - sh, sz, sz, cr); g.endFill();
			break;
		}
		case "hex-outline": {
			// Determine size tier from half (derived from STAMP_SIZES: small=40, medium=80,
			// large=140)
			// half values: 20, 40, 70
			let tier = "small";
			if (half >= 35 && half < 60) tier = "medium";
			else if (half >= 60) tier = "large";

			const points = getHexClusterOutline(tier, cx, cy);
			if (points && points.length > 6) {
				// Draw the outline path
				g.lineStyle(sw, shadowColor, shadowAlpha);
				g.moveTo(points[0] + shadowOff, points[1] + shadowOff);
				for (let i = 2; i < points.length; i += 2) {
					g.lineTo(points[i] + shadowOff, points[i + 1] + shadowOff);
				}
				g.closePath();
				g.lineStyle(sw, color, alpha);
				g.moveTo(points[0], points[1]);
				for (let i = 2; i < points.length; i += 2) {
					g.lineTo(points[i], points[i + 1]);
				}
				g.closePath();
			}
			else {
				// Fallback: Draw single hex using grid size
				const gridSize = canvas?.grid?.size || 100;
				// Detect orientation
				const grid = canvas?.grid;
				let pointyTop = false;
				if (grid?.columns !== undefined) pointyTop = grid.columns;
				else if (grid?.type !== undefined) {
					pointyTop = (grid.type === 2 || grid.type === 3);
				}
				// Detection inverted: pointyTop=true → flat hex, pointyTop=false → pointy hex
				const r = (gridSize / 2) * 1.155; // Scale to match grid
				const angleOffset = pointyTop ? 0 : Math.PI / 6;
				const verts = [];
				for (let i = 0; i < 6; i++) {
					const angle = angleOffset + ((Math.PI / 3) * i);
					verts.push(cx + (r * Math.cos(angle)), cy + (r * Math.sin(angle)));
				}
				g.lineStyle(sw, shadowColor, shadowAlpha);
				g.drawPolygon(verts.map((v, i) => v + shadowOff));
				g.lineStyle(sw, color, alpha);
				g.drawPolygon(verts);
			}
			break;
		}
	}
}

export function getHexClusterOutline(tier, centerX, centerY) {
	// Get grid size - this determines hex dimensions
	const gridSize = canvas?.grid?.size || canvas?.dimensions?.size || 100;

	// Check if it's a hex grid and determine orientation
	const grid = canvas?.grid;
	let isPointyTop = false; // Default to flat-top
	if (grid) {
		// V12+: grid.columns means pointy-top (columnar)
		// V11: grid.type 2,3 = columns (pointy), 4,5 = rows (flat)
		if (grid.columns !== undefined) {
			isPointyTop = grid.columns;
		}
		else if (grid.type !== undefined) {
			isPointyTop = (grid.type === 2 || grid.type === 3);
		}
	}

	// Calculate hex radius (distance from center to vertex)
	// Scale factor to match actual grid hex size (2/sqrt(3) ≈ 1.155)
	const sqrt3 = Math.sqrt(3);
	const scaleFactor = 1.155;
	const r = (gridSize / 2) * scaleFactor;

	// Generate vertices for a single hex centered at origin, then offset to (hx, hy)
	const getHexVertices = (hx, hy) => {
		const verts = [];
		for (let i = 0; i < 6; i++) {
			// For flat-top hex (rows): start at 30° so flat edges are at top/bottom
			// For pointy-top hex (columns): start at 0° so vertices are at top/bottom
			// Note: grid.columns detection seems inverted, so we flip the logic
			const angleOffset = isPointyTop ? 0 : Math.PI / 6;
			const angle = angleOffset + ((Math.PI / 3) * i);
			verts.push({
				x: hx + (r * Math.cos(angle)),
				y: hy + (r * Math.sin(angle)),
			});
		}
		return verts;
	};

	// Calculate hex center positions using axial coordinates (q, r)
	// Apply same scale factor to spacing so vertices align properly
	const axialToPixel = (q, ar) => {
		if (isPointyTop) {
			// Actually flat-top: horizontal = 1.5*r, vertical = sqrt(3)*r
			return {
				x: gridSize * 0.75 * scaleFactor * q,
				y: gridSize * (sqrt3 / 2) * scaleFactor * (ar + (q / 2)),
			};
		}
		else {
			// Actually pointy-top: horizontal = sqrt(3)*r, vertical = 1.5*r
			return {
				x: gridSize * (sqrt3 / 2) * scaleFactor * (q + (ar / 2)),
				y: gridSize * 0.75 * scaleFactor * ar,
			};
		}
	};

	// Define which hexes to include based on tier
	// Using axial coordinates (q, r)
	let hexAxialCoords = [{ q: 0, r: 0 }]; // Center hex

	if (tier === "medium" || tier === "large") {
		// Ring 1: 6 neighbors (flower pattern)
		const ring1 = [
			{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
			{ q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
		];
		hexAxialCoords.push(...ring1);
	}

	if (tier === "large") {
		// Ring 2: 12 more hexes
		const ring2 = [
			{ q: 2, r: 0 }, { q: 2, r: -1 }, { q: 2, r: -2 },
			{ q: 1, r: -2 }, { q: 0, r: -2 }, { q: -1, r: -1 },
			{ q: -2, r: 0 }, { q: -2, r: 1 }, { q: -2, r: 2 },
			{ q: -1, r: 2 }, { q: 0, r: 2 }, { q: 1, r: 1 },
		];
		hexAxialCoords.push(...ring2);
	}

	// Corners are quantised to a 0.5px lattice so the same corner reached from
	// two different hexes compares equal. Quantising each raw value on its own
	// is not enough: neighbouring hexes arrive at a shared corner through
	// different arithmetic, so their copies differ by a few ULPs, and when the
	// true coordinate sits exactly on a rounding tie — y = 57.75 on a 100px
	// grid centred at the origin — those ULPs drop the copies into different
	// lattice cells. The corner then reads as two separate points, its two
	// half-edges stop cancelling, and interior edges leak into the boundary
	// set. That is what used to leave medium and large clusters unstitchable.
	//
	// Resolving each raw corner against the corners already seen fixes it at
	// the source: the tolerance sits far below the hex edge length and far
	// above the numeric noise, so every copy of a corner collapses onto one
	// shared object and both the cancelling and the stitching below become
	// identity comparisons rather than string or distance approximations.
	const snap = v => Math.round(v * 2) / 2;
	const cellIndex = v => Math.round(v * 2);
	const CORNER_EPSILON = 1e-6;
	const cornersByCell = new Map();

	const canonicalCorner = (x, y) => {
		const cx = cellIndex(x);
		const cy = cellIndex(y);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const seen = cornersByCell.get(`${cx + dx},${cy + dy}`);
				if (seen
					&& Math.abs(seen.rawX - x) < CORNER_EPSILON
					&& Math.abs(seen.rawY - y) < CORNER_EPSILON) return seen;
			}
		}
		const corner = { x: snap(x), y: snap(y), rawX: x, rawY: y, key: `${cx},${cy}` };
		cornersByCell.set(corner.key, corner);
		return corner;
	};

	// Collect every hex edge; the ones two hexes share cancel, and what is left
	// is the boundary of the union. Edges are keyed on their unordered endpoint
	// pair, so the two hexes meeting along an edge always land on the same key.
	const edgesById = new Map();

	for (const axial of hexAxialCoords) {
		const pixelPos = axialToPixel(axial.q, axial.r);
		const verts = getHexVertices(centerX + pixelPos.x, centerY + pixelPos.y);
		const corners = verts.map(v => canonicalCorner(v.x, v.y));

		for (let i = 0; i < 6; i++) {
			const a = corners[i];
			const b = corners[(i + 1) % 6];
			const id = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
			const seen = edgesById.get(id);
			if (seen) seen.count += 1;
			else edgesById.set(id, { id, a, b, count: 1 });
		}
	}

	const boundaryEdges = [];
	for (const edge of edgesById.values()) {
		if (edge.count === 1) boundaryEdges.push(edge);
	}

	if (boundaryEdges.length === 0) return null;

	// Stitch the boundary into one closed ring. Each step takes whichever
	// unused edge touches the cursor at either end, so a boundary that is not
	// consistently wound still walks; the ring is only returned once it closes
	// back on the corner it started from, since a partial walk would render as
	// a wrong shape rather than as no shape at all.
	const path = [];
	const used = new Set();
	const startCorner = boundaryEdges[0].a;
	let cursor = startCorner;
	let closed = false;

	for (let step = 0; step <= boundaryEdges.length; step++) {
		const from = cursor;
		path.push(from.x, from.y);

		const next = boundaryEdges.find(
			edge => !used.has(edge.id) && (edge.a === from || edge.b === from)
		);
		if (!next) break;

		used.add(next.id);
		cursor = next.a === from ? next.b : next.a;

		if (cursor === startCorner) {
			path.push(startCorner.x, startCorner.y);
			closed = true;
			break;
		}
	}

	return closed && path.length > 6 ? path : null;
}
