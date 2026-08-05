// Drawing geometry for the canvas drawing tool — extracted from
// scripts/canvas/SDXDrawingTool.mjs (Phase 5.3.5 split).
//
// Stroke styles, box/ellipse primitives, stamp shapes, the hex-cluster outline
// and CSS colour parsing. Everything here computes and draws through the
// PIXI.Graphics it is handed; none of it touches tool state, which is what
// makes it assertable as a command sequence.
//
// getHexClusterOutline reads canvas.grid for hex metrics. It also has a known
// defect: for the "medium" and "large" tiers the edge stitcher dead-ends and
// it returns null, so those stamps draw no cluster outline. Frozen by test,
// not fixed here — see dev/tests/canvas-drawing-geometry.test.mjs.

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

	// Collect all edges from all hexes
	// Use a map to track edges - shared edges (internal) will be added twice and removed
	const allEdges = [];

	// Round coordinates to avoid floating point issues (snap to 0.5 precision)
	const snap = v => Math.round(v * 2) / 2;
	const pointKey = p => `${snap(p.x)},${snap(p.y)}`;

	for (const axial of hexAxialCoords) {
		const pixelPos = axialToPixel(axial.q, axial.r);
		const verts = getHexVertices(centerX + pixelPos.x, centerY + pixelPos.y);

		for (let i = 0; i < 6; i++) {
			const p1 = { x: snap(verts[i].x), y: snap(verts[i].y) };
			const p2 = { x: snap(verts[(i + 1) % 6].x), y: snap(verts[(i + 1) % 6].y) };
			allEdges.push({ p1, p2, key: `${pointKey(p1)}|${pointKey(p2)}` });
		}
	}

	// Remove shared edges (edges that appear in both directions)
	const edgeCounts = new Map();
	for (const edge of allEdges) {
		const revKey = `${pointKey(edge.p2)}|${pointKey(edge.p1)}`;
		if (edgeCounts.has(revKey)) {
			edgeCounts.set(revKey, edgeCounts.get(revKey) + 1);
		}
		else if (edgeCounts.has(edge.key)) {
			edgeCounts.set(edge.key, edgeCounts.get(edge.key) + 1);
		}
		else {
			edgeCounts.set(edge.key, 1);
		}
	}

	// Keep only edges that appear once (outer edges)
	const outerEdges = allEdges.filter(edge => {
		const revKey = `${pointKey(edge.p2)}|${pointKey(edge.p1)}`;
		const count = edgeCounts.get(edge.key) || edgeCounts.get(revKey) || 0;
		return count === 1;
	});

	if (outerEdges.length === 0) return null;

	// Stitch edges into a continuous path
	const path = [];
	const used = new Set();

	// Start with first edge
	let current = outerEdges[0];
	used.add(current.key);
	path.push(current.p1.x, current.p1.y);

	let cursor = current.p2;
	const startPoint = current.p1;

	let iterations = 0;
	const maxIterations = outerEdges.length + 10;

	while (iterations < maxIterations) {
		path.push(cursor.x, cursor.y);

		// Check if we've closed the loop
		const distToStart = Math.abs(cursor.x - startPoint.x) + Math.abs(
			cursor.y - startPoint.y
		);
		if (distToStart < 2) {
			break;
		}

		// Find next edge that starts at cursor
		let found = false;
		const cursorKey = pointKey(cursor);

		for (const edge of outerEdges) {
			if (used.has(edge.key)) continue;

			// Check if this edge starts at cursor
			if (pointKey(edge.p1) === cursorKey) {
				used.add(edge.key);
				cursor = edge.p2;
				found = true;
				break;
			}
		}

		if (!found) break;
		iterations++;
	}

	return path.length > 6 ? path : null;
}
