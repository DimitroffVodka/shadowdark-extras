// Journal pin icon builders — extracted from the JournalPinGraphics class in
// scripts/journal/pin-rendering.mjs (Phase 5.3.5 split).
//
// Three ways to put a mark inside a pin: a FontAwesome glyph rasterised
// through a 2D canvas, a fetched SVG recoloured and loaded as a texture, and
// the vision indicator badge. Each assigns onto the pin it is given rather
// than returning, matching what the build path expects.
//
// Only the SVG recolouring is unit-testable; the canvas and texture paths need
// a real browser and are covered by the live Foundry checks.
// addGlyphIcon and addVisionIndicator are near-duplicates — the same
// glyph-to-canvas routine differing in colour, size factor and placement.
// Deliberately left un-merged here: consolidating them is a behaviour change
// that wants its own tests, not a side effect of a move.

import { getPinStyle } from "./pin-style.mjs";

export async function addGlyphIcon(pin, container, iconClass, radius, color) {
	// Create icon using a canvas
	const iconSize = radius * 1.2;
	const canvas = document.createElement("canvas");
	const padding = 4;
	canvas.width = iconSize + (padding * 2);
	canvas.height = iconSize + (padding * 2);
	const ctx = canvas.getContext("2d");

	const tempDiv = document.createElement("div");
	tempDiv.style.position = "absolute";
	tempDiv.style.left = "-9999px";
	tempDiv.style.fontSize = `${iconSize}px`;
	tempDiv.innerHTML = `<i class="${iconClass}"></i>`;
	document.body.appendChild(tempDiv);

	await new Promise(r => {
		setTimeout(r, 50);
	});
	if (pin.destroyed) {
		if (tempDiv.parentNode) document.body.removeChild(tempDiv);
		return;
	}

	const iconElement = tempDiv.querySelector("i");
	if (iconElement) {
		try {
			const beforeStyle = window.getComputedStyle(iconElement, "::before");
			const content = beforeStyle.content;
			const fontFamily = beforeStyle.fontFamily;

			if (content && content !== "none" && content !== '""') {
				const iconChar = content.replace(/['"]/g, "");
				const colorHex = `#${color.toString(16).padStart(6, "0")}`;
				ctx.fillStyle = colorHex;
				ctx.font = `${iconSize}px ${fontFamily}`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(iconChar, canvas.width / 2, canvas.height / 2);
			}
		}
		catch(e) {
			// Fallback
		}
	}

	document.body.removeChild(tempDiv);

	const texture = PIXI.Texture.from(canvas);
	pin._icon = new PIXI.Sprite(texture);
	pin._icon.anchor.set(0.5);
	pin._icon.position.set(0, 0);
	container.addChild(pin._icon);
}

export async function addSvgIcon(pin, container, iconPath, radius, color) {
	// Custom SVGs usually need to be a bit bigger to fill the pin
	const size = radius * 1.3;
	try {
		// Fetch SVG text
		const response = await fetch(iconPath);
		let svgText = await response.text();
		if (pin.destroyed) return;

		// Replace colors in SVG text - simple heuristic to colorize monochrome SVGs
		const colorHex = `#${color.toString(16).padStart(6, "0")}`;

		// Replace existing fill/stroke attributes or add to root if missing
		if (svgText.includes("fill=")) {
			svgText = svgText.replace(/fill="[^"]*"/g, `fill="${colorHex}"`);
		}
		else {
			svgText = svgText.replace("<svg ", `<svg fill="${colorHex}" `);
		}

		if (svgText.includes("stroke=")) {
			svgText = svgText.replace(/stroke="[^"]*"/g, `stroke="${colorHex}"`);
		}

		// Convert to base64 data URI
		const svgBase64 = `data:image/svg+xml;base64,${btoa(svgText)}`;

		// Load as texture using Foundry's standard helper
		const texture = await loadTexture(svgBase64);
		if (pin.destroyed) return;

		pin._icon = new PIXI.Sprite(texture);
		pin._icon.width = size;
		pin._icon.height = size;
		pin._icon.anchor.set(0.5);
		pin._icon.position.set(0, 0);

		// Handle rotation for diamond shape
		const globalStyle = getPinStyle();
		const style = { ...globalStyle, ...(pin.pinData.style || {}) };
		if (style.shape === "diamond") {
			pin._icon.rotation = -Math.PI / 4;
		}

		container.addChild(pin._icon);
	}
	catch(err) {
		console.error(`SDX Journal Pins | Failed to load custom SVG: ${iconPath}`, err);
	}
}

export async function addVisionIndicator(pin, container, radius) {
	const iconClass = "fa-solid fa-eye";
	const iconSize = radius * 0.8;

	const canvas = document.createElement("canvas");
	const padding = 4;
	canvas.width = iconSize + (padding * 2);
	canvas.height = iconSize + (padding * 2);
	const ctx = canvas.getContext("2d");

	const tempDiv = document.createElement("div");
	tempDiv.style.position = "absolute";
	tempDiv.style.left = "-9999px";
	tempDiv.style.fontSize = `${iconSize}px`;
	tempDiv.innerHTML = `<i class="${iconClass}"></i>`;
	document.body.appendChild(tempDiv);

	await new Promise(r => {
		setTimeout(r, 50);
	});
	if (pin.destroyed) {
		if (tempDiv.parentNode) document.body.removeChild(tempDiv);
		return;
	}

	const iconElement = tempDiv.querySelector("i");
	if (iconElement) {
		try {
			const beforeStyle = window.getComputedStyle(iconElement, "::before");
			const content = beforeStyle.content;
			const fontFamily = beforeStyle.fontFamily;

			if (content && content !== "none" && content !== '""') {
				const iconChar = content.replace(/['"]/g, "");

				// Shadow for visibility
				ctx.shadowBlur = 4;
				ctx.shadowColor = "black";

				ctx.fillStyle = "#ffffff";
				ctx.font = `${iconSize}px ${fontFamily}`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(iconChar, canvas.width / 2, canvas.height / 2);
			}
		}
		catch(e) { }
	}

	document.body.removeChild(tempDiv);

	const texture = PIXI.Texture.from(canvas);
	const indicator = new PIXI.Sprite(texture);
	indicator.anchor.set(0.5);

	// Position at top-right
	const angle = -Math.PI / 4;
	const dist = radius * 1.1;
	indicator.position.set(
		Math.cos(angle) * dist,
		Math.sin(angle) * dist
	);

	container.addChild(indicator);
}
