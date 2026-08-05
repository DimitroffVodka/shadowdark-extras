// Pin style preview rendering — extracted from scripts/journal/PinStyleEditorSD.mjs
// (Phase 5.3 split). Prototype mixin: turning the form state into CSS on the
// preview element — size, shape geometry, fill and ring opacity, and the four
// content types — plus the debounced live update of the real canvas pin.
// Merged via Object.assign(PinStyleEditorApp.prototype, PinStylePreview).

import { JournalPinManager, JournalPinRenderer } from "./JournalPinsSD.mjs";
import { readNumber } from "./pin-style-form.mjs";

export const PinStylePreview = {
	async _updatePreview() {
		const html = this.element;
		if (!html) return;

		const preview = html.querySelector(".pin-preview-canvas");
		if (!preview) return;

		const style = this._getFormData();

		// Real-time canvas preview for individual pins
		if (this.pinId && this._canvasUpdateDebounce) {
			this._canvasUpdateDebounce(style);
		}

		// Update preview display
		const size = parseInt(style.size) || 32;
		const previewPin = html.querySelector(".preview-pin");
		if (previewPin) {
			previewPin.style.width = `${size}px`;
			previewPin.style.height = `${size}px`;
			const baseOpacity = parseFloat(style.opacity) || 1.0;
			const fillOpacity = readNumber(style.fillOpacity, 1.0) * baseOpacity;
			const ringOpacity = readNumber(style.ringOpacity, 1.0) * baseOpacity;

			previewPin.style.backgroundColor = style.fillColor || "#000000";
			previewPin.style.borderColor = style.ringColor || "#ffffff";
			previewPin.style.borderWidth = `${style.ringWidth}px`;
			previewPin.style.borderStyle = style.ringStyle || "solid";

			// Apply opacities to preview via background and border colors
			// Note: This is an approximation for CSS preview
			const parseHex = hex => {
				const r = parseInt(hex.slice(1, 3), 16);
				const g = parseInt(hex.slice(3, 5), 16);
				const b = parseInt(hex.slice(5, 7), 16);
				return `${r}, ${g}, ${b}`;
			};

			previewPin.style.backgroundColor = `rgba(${parseHex(style.fillColor)}, ${fillOpacity})`;
			previewPin.style.borderColor = `rgba(${parseHex(style.ringColor)}, ${ringOpacity})`;


			// Shape
			// Reset clip-path and transform for non-hexagon/diamond shapes
			previewPin.style.clipPath = "none";
			const borderRadius = parseInt(style.borderRadius) || 4;

			switch (style.shape) {
				case "circle":
					previewPin.style.borderRadius = "50%";
					previewPin.style.transform = "rotate(0deg)";
					break;
				case "square":
					previewPin.style.borderRadius = `${borderRadius}px`;
					previewPin.style.transform = "rotate(0deg)";
					break;
				case "diamond":
					previewPin.style.borderRadius = `${borderRadius}px`;
					previewPin.style.transform = "rotate(45deg)";
					break;
				case "hexagon":
					previewPin.style.borderRadius = "0";
					previewPin.style.transform = "rotate(0deg)";
					// Pointy-top hexagon
					previewPin.style.clipPath = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
					break;
				case "hexagonFlat":
					previewPin.style.borderRadius = "0";
					previewPin.style.transform = "rotate(0deg)";
					// Flat-top hexagon
					previewPin.style.clipPath = "polygon(0% 50%, 25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%)";
					break;
				case "image":
					previewPin.style.backgroundColor = "transparent";
					previewPin.style.border = "none";
					previewPin.style.borderRadius = "0";
					previewPin.style.transform = "rotate(0deg)";

					// Add background image to preview
					if (style.imagePath) {
						previewPin.style.backgroundImage = `url("${style.imagePath}")`;
						previewPin.style.backgroundSize = "contain";
						previewPin.style.backgroundPosition = "center";
						previewPin.style.backgroundRepeat = "no-repeat";
					}
					else {
						// Fallback placeholder
						previewPin.style.backgroundImage = "none";
						previewPin.style.border = "1px dashed #666";
					}
					return; // Skip content addition for image shape background
			}

			// Content (number, symbol, custom icon, or text)
			const content = previewPin.querySelector(".preview-content");
			if (content) {
				const type = style.contentType || (style.showIcon ? "symbol" : "number");

				if (type === "symbol" || type === "icon") {
					// FontAwesome icon (now Symbol)
					const symbolClass = style.symbolClass || style.iconClass || "fa-solid fa-book-open";
					content.innerHTML = `<i class="${symbolClass}"></i>`;
					content.style.fontSize = `${size * 0.5}px`;
					content.style.color = style.symbolColor || "#ffffff";
				}
				else if (type === "customIcon") {
					// Custom SVG icon
					if (style.customIconPath) {
						content.innerHTML = `<img src="${foundry.utils.escapeHTML(style.customIconPath)}" style="width: 70%; height: 70%; filter: invert(1);" />`;
					}
					else {
						content.innerHTML = "<i class=\"fa-solid fa-image\"></i>";
						content.style.fontSize = `${size * 0.5}px`;
					}
					content.style.color = style.iconColor || "#ffffff";
					// Note: Inverting SVG preview as a simple way to show on dark background,
					// real PIXI rendering handles the color properly.
				}
				else {
					if (type === "text") {
						content.textContent = style.customText || "";
					}
					else {
						// Calculate actual page number for preview
						let pageNumber = "";
						const journal = game.journal.get(style.journalId);
						if (journal && style.pageId) {
							const sortedPages = journal.pages.contents.sort(
								(a, b) => a.sort - b.sort
							);
							const idx = sortedPages.findIndex(p => p.id === style.pageId);
							pageNumber = idx !== -1 ? String(idx + 1) : "";
						}
						content.textContent = pageNumber || (style.journalId ? "1" : "3");
					}

					// Await font loading if it's a custom font
					if (style.fontFamily && style.fontFamily !== "Arial") {
						try {
							await document.fonts.load(`16px ${style.fontFamily}`);
						}
						catch(e) {
							console.warn(
								`SDX Pin Editor | Failed to load font: ${style.fontFamily}`
							);
						}
					}

					content.style.fontSize = `${style.fontSize}px`;
					content.style.fontFamily = style.fontFamily;
					content.style.fontWeight = style.fontWeight;
					content.style.fontStyle = style.fontItalic ? "italic" : "normal";
					content.style.color = style.fontColor || "#ffffff";

					// Apply stroke (outline)
					if (style.fontStrokeThickness > 0) {
						content.style.webkitTextStroke = `${style.fontStrokeThickness}px ${style.fontStroke || "#000000"}`;
						content.style.paintOrder = "stroke fill";
					}
					else {
						content.style.webkitTextStroke = "unset";
					}
				}
				content.style.transform = style.shape === "diamond" ? "rotate(-45deg)" : "none";
			}

			// Label Preview
			const previewLabel = preview.querySelector(".preview-label");
			if (previewLabel) {
				const labelBg = style.labelBackground;
				previewLabel.style.display = labelBg === "none" ? "none" : "flex";

				// Position preview label relative to pin using CSS transform
				const anchor = style.labelAnchor || "bottom";
				const offsetSq = style.labelOffset ?? 5;
				const pinHalf = (style.size || 40) / 2;

				let tx = 0; let ty = 0;
				let originX = "center"; let originY = "center";

				switch (anchor) {
					case "top":
						ty = -(pinHalf + offsetSq);
						originY = "bottom";
						break;
					case "bottom":
						ty = (pinHalf + offsetSq);
						originY = "top";
						break;
					case "left":
						tx = -(pinHalf + offsetSq);
						originX = "right";
						break;
					case "right":
						tx = (pinHalf + offsetSq);
						originX = "left";
						break;
					case "center":
						tx = 0;
						ty = 0;
						break;
				}

				previewLabel.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
				previewLabel.style.transformOrigin = `${originX} ${originY}`;

				if (labelBg === "solid") {
					previewLabel.style.border = `${style.labelBorderWidth}px solid ${style.labelBorderColor || "#ffffff"}`;
					previewLabel.style.borderRadius = `${style.labelBorderRadius}px`;
					previewLabel.style.backgroundColor = style.labelBackgroundColor || "rgba(0,0,0,0.8)";
					previewLabel.style.opacity = style.labelBackgroundOpacity ?? 1.0;
					previewLabel.style.borderImage = "none";
				}
				else if (labelBg === "image") {
					previewLabel.style.borderRadius = "0";

					if (style.labelBorderImagePath) {
						const sT = style.labelBorderSliceTop || 15;
						const sR = style.labelBorderSliceRight || 15;
						const sB = style.labelBorderSliceBottom || 15;
						const sL = style.labelBorderSliceLeft || 15;

						previewLabel.style.borderStyle = "solid";
						previewLabel.style.borderWidth = "0px"; // Slices will define the visible border via fill
						previewLabel.style.borderImageSource = `url("${style.labelBorderImagePath}")`;
						previewLabel.style.borderImageSlice = `${sT} ${sR} ${sB} ${sL} fill`;
						previewLabel.style.borderImageWidth = "auto";
						previewLabel.style.borderImageOutset = "0px";
						previewLabel.style.borderImageRepeat = "stretch";

						if (style.labelBackgroundOpacity > 0) {
							previewLabel.style.backgroundColor = style.labelBackgroundColor || "#000000";
							previewLabel.style.opacity = style.labelBackgroundOpacity;
						}
						else {
							previewLabel.style.backgroundColor = "transparent";
						}
					}
					else {
						previewLabel.style.border = "1px dashed #666";
						previewLabel.style.backgroundColor = "transparent";
						previewLabel.style.borderImage = "none";
					}
				}
			}
		}
	},

	/**
     * Update the pin on the canvas in real-time
     * @param {Object} style - The temporary style data from the form
     */
	async _updateCanvasPreview(style) {
		if (!this.pinId) return;

		const pinGraphics = JournalPinRenderer.getPin(this.pinId);
		if (pinGraphics) {
			const originalPin = JournalPinManager.get(this.pinId);
			if (!originalPin) return;

			// Merge current form style into original pin data for a temporary update
			const tempData = foundry.utils.mergeObject(
				foundry.utils.deepClone(originalPin),
				{ style },
				{ inplace: false }
			);

			await pinGraphics.update(tempData);
		}
	},
};
