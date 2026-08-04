// Pin ring stroke geometry — extracted from the JournalPinGraphics class in
// scripts/journal/pin-rendering.mjs (Phase 5.3.5 split).
//
// Pure geometry: everything here draws through the PIXI.Graphics it is handed
// and keeps no state of its own. Leaf module: no imports.

/**
 * Stroke a pin ring as a dashed or dotted outline.
 *
 * Solid rings are drawn by the caller in one call; the patterned styles need
 * the outline walked segment by segment, which is what this does. Dotted rings
 * place filled circles of half the ring width along the path; dashed rings
 * stroke arcs (curves) and line segments (edges).
 *
 * @param {object} graphics          Target PIXI.Graphics; mutated in place.
 * @param {string} shape             "circle", "square", "diamond", "hexagon", or "hexagonFlat".
 * @param {number} radius            Outline radius in pixels.
 * @param {number} width             Ring width in pixels.
 * @param {number} color             Ring color as a PIXI numeric color.
 * @param {number} opacity           Ring alpha, 0-1.
 * @param {string} style             "dotted" for dots; anything else dashes.
 * @param {number} [cornerRadius=4]  Corner radius for "square"; 0 gives sharp corners.
 */
export function drawStyledStroke(graphics, shape, radius, width, color, opacity, style, cornerRadius = 4) {
	graphics.lineStyle(width, color, opacity);

	const isDotted = style === "dotted";
	const dashLen = isDotted ? width : width * 3;
	const gapLen = isDotted ? width * 2 : width * 2;

	if (shape === "circle") {
		const circumference = 2 * Math.PI * radius;
		const numSegments = Math.floor(circumference / (dashLen + gapLen));
		const actualSegmentLen = circumference / numSegments;
		const dashAngle = (dashLen / circumference) * 2 * Math.PI;
		const stepAngle = (actualSegmentLen / circumference) * 2 * Math.PI;

		for (let i = 0; i < numSegments; i++) {
			const startAngle = i * stepAngle;
			if (isDotted) {
				// Draw a small dot
				const x = Math.cos(startAngle) * radius;
				const y = Math.sin(startAngle) * radius;
				graphics.lineStyle(0);
				graphics.beginFill(color, opacity);
				graphics.drawCircle(x, y, width / 2);
				graphics.endFill();
			}
			else {
				// Draw a dash arc
				graphics.arc(0, 0, radius, startAngle, startAngle + dashAngle);
				graphics.moveTo(Math.cos(startAngle + stepAngle) * radius, Math.sin(startAngle + stepAngle) * radius);
			}
		}
	}
	else if (shape === "square" && cornerRadius > 0) {
		// Rounded square - draw edges with corner arcs
		const cr = Math.min(cornerRadius, radius); // Clamp corner radius
		const innerRadius = radius - cr;

		// Build path segments: straight edges + corner arcs
		// Corners are at: top-right, bottom-right, bottom-left, top-left
		const segments = [];

		// Top edge (left to right)
		segments.push({ type: "line", x1: -innerRadius, y1: -radius, x2: innerRadius, y2: -radius });
		// Top-right corner arc
		segments.push({ type: "arc", cx: innerRadius, cy: -innerRadius, r: cr, startAngle: -Math.PI / 2, endAngle: 0 });
		// Right edge (top to bottom)
		segments.push({ type: "line", x1: radius, y1: -innerRadius, x2: radius, y2: innerRadius });
		// Bottom-right corner arc
		segments.push({ type: "arc", cx: innerRadius, cy: innerRadius, r: cr, startAngle: 0, endAngle: Math.PI / 2 });
		// Bottom edge (right to left)
		segments.push({ type: "line", x1: innerRadius, y1: radius, x2: -innerRadius, y2: radius });
		// Bottom-left corner arc
		segments.push({ type: "arc", cx: -innerRadius, cy: innerRadius, r: cr, startAngle: Math.PI / 2, endAngle: Math.PI });
		// Left edge (bottom to top)
		segments.push({ type: "line", x1: -radius, y1: innerRadius, x2: -radius, y2: -innerRadius });
		// Top-left corner arc
		segments.push({ type: "arc", cx: -innerRadius, cy: -innerRadius, r: cr, startAngle: Math.PI, endAngle: 3 * Math.PI / 2 });

		// Draw dashed/dotted pattern along the path
		for (const seg of segments) {
			if (seg.type === "line") {
				const dx = seg.x2 - seg.x1;
				const dy = seg.y2 - seg.y1;
				const len = Math.sqrt((dx * dx) + (dy * dy));
				const nx = dx / len;
				const ny = dy / len;

				let dist = 0;
				while (dist < len) {
					const segLen = Math.min(dashLen, len - dist);
					const sx = seg.x1 + (nx * dist);
					const sy = seg.y1 + (ny * dist);

					if (isDotted) {
						graphics.lineStyle(0);
						graphics.beginFill(color, opacity);
						graphics.drawCircle(sx, sy, width / 2);
						graphics.endFill();
					}
					else {
						graphics.lineStyle(width, color, opacity);
						graphics.moveTo(sx, sy);
						graphics.lineTo(sx + (nx * segLen), sy + (ny * segLen));
					}
					dist += dashLen + gapLen;
				}
			}
			else if (seg.type === "arc") {
				const arcLen = seg.r * Math.abs(seg.endAngle - seg.startAngle);
				const numDashes = Math.max(1, Math.floor(arcLen / (dashLen + gapLen)));
				const angleStep = (seg.endAngle - seg.startAngle) / numDashes;
				const dashAngle = (dashLen / arcLen) * (seg.endAngle - seg.startAngle);

				for (let i = 0; i < numDashes; i++) {
					const startAngle = seg.startAngle + (i * angleStep);
					if (isDotted) {
						const x = seg.cx + (Math.cos(startAngle) * seg.r);
						const y = seg.cy + (Math.sin(startAngle) * seg.r);
						graphics.lineStyle(0);
						graphics.beginFill(color, opacity);
						graphics.drawCircle(x, y, width / 2);
						graphics.endFill();
					}
					else {
						graphics.lineStyle(width, color, opacity);
						graphics.arc(seg.cx, seg.cy, seg.r, startAngle, Math.min(startAngle + dashAngle, seg.endAngle));
						if (i < numDashes - 1) {
							const nextAngle = seg.startAngle + ((i + 1) * angleStep);
							graphics.moveTo(seg.cx + (Math.cos(nextAngle) * seg.r), seg.cy + (Math.sin(nextAngle) * seg.r));
						}
					}
				}
			}
		}
	}
	else {
		// Polygon shapes (non-rounded square, diamond, hexagon)
		// For simplicity, we'll draw straight lines with patterns
		const points = [];
		if (shape === "square") {
			points.push({ x: -radius, y: -radius }, { x: radius, y: -radius }, { x: radius, y: radius }, { x: -radius, y: radius }, { x: -radius, y: -radius });
		}
		else if (shape === "diamond") {
			points.push({ x: 0, y: -radius }, { x: radius, y: 0 }, { x: 0, y: radius }, { x: -radius, y: 0 }, { x: 0, y: -radius });
		}
		else if (shape === "hexagon" || shape === "hexagonFlat") {
			const hexOffset = shape === "hexagonFlat" ? 0 : -Math.PI / 2;
			for (let i = 0; i <= 6; i++) {
				const angle = ((Math.PI / 3) * i) + hexOffset;
				points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
			}
		}

		for (let i = 0; i < points.length - 1; i++) {
			const p1 = points[i];
			const p2 = points[i + 1];
			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const len = Math.sqrt((dx * dx) + (dy * dy));
			const nx = dx / len;
			const ny = dy / len;

			let dist = 0;
			while (dist < len) {
				const segLen = Math.min(dashLen, len - dist);
				const sx = p1.x + (nx * dist);
				const sy = p1.y + (ny * dist);

				if (isDotted) {
					graphics.lineStyle(0);
					graphics.beginFill(color, opacity);
					graphics.drawCircle(sx, sy, width / 2);
					graphics.endFill();
				}
				else {
					graphics.lineStyle(width, color, opacity);
					graphics.moveTo(sx, sy);
					graphics.lineTo(sx + (nx * segLen), sy + (ny * segLen));
				}
				dist += dashLen + gapLen;
			}
		}
	}
}
