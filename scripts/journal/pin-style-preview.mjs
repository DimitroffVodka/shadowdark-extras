// Pin style preview rendering — extracted from scripts/journal/PinStyleEditorSD.mjs
// (Phase 5.3 split). Prototype mixin: turning the form state into CSS on the
// preview element — size, shape geometry, fill and ring opacity, and the four
// content types — plus the debounced live update of the real canvas pin.
// Merged via Object.assign(PinStyleEditorApp.prototype, PinStylePreview).

import { JournalPinManager, JournalPinRenderer } from "./JournalPinsSD.mjs";
import { readNumber } from "./pin-style-form.mjs";

function colorWithAlpha(color, alpha) {
	const value = String(color || "").trim();
	const match = /^#([0-9a-f]{6})$/i.exec(value);
	if (!match) return value || "transparent";
	const number = Number.parseInt(match[1], 16);
	const r = (number >> 16) & 0xff;
	const g = (number >> 8) & 0xff;
	const b = number & 0xff;
	return alpha >= 1 ? value : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
			const mediaBody = previewPin.querySelector(".preview-media-body");
			const mediaTint = previewPin.querySelector(".preview-media-tint");
			const mediaRing = previewPin.querySelector(".preview-media-ring");
			const mediaTarget = mediaBody || previewPin;
			// Clear media-only presentation before applying the selected shape. Without
			// this reset, changing image/icon -> geometric leaves the old background
			// image (and its hover treatment) painted over the new preview.
			if (previewPin._sdxHoverHandlers) {
				previewPin.removeEventListener("mouseenter", previewPin._sdxHoverHandlers.enter);
				previewPin.removeEventListener("mouseleave", previewPin._sdxHoverHandlers.leave);
				previewPin._sdxHoverHandlers = null;
			}
			previewPin.style.backgroundImage = "none";
			previewPin.style.backgroundSize = "initial";
			previewPin.style.backgroundPosition = "initial";
			previewPin.style.backgroundRepeat = "initial";
			previewPin.style.backgroundBlendMode = "normal";
			previewPin.style.overflow = "visible";
			previewPin.style.outline = "none";
			previewPin.style.borderImage = "none";
			previewPin.style.border = "";
			previewPin.style.borderRadius = "0";
			previewPin.style.transform = "rotate(0deg)";
			previewPin.style.opacity = "1";
			mediaTarget.style.display = "none";
			mediaTarget.style.backgroundImage = "none";
			mediaTarget.style.backgroundSize = "initial";
			mediaTarget.style.backgroundPosition = "initial";
			mediaTarget.style.backgroundRepeat = "initial";
			mediaTarget.style.backgroundBlendMode = "normal";
			mediaTarget.style.backgroundColor = "transparent";
			mediaTarget.style.opacity = "1";
			mediaTarget.style.overflow = "visible";
			mediaTarget.style.outline = "none";
			mediaTarget.style.border = "";
			if (mediaTint) {
				mediaTint.style.display = "none";
				mediaTint.style.backgroundColor = "transparent";
				mediaTint.style.backgroundImage = "none";
				mediaTint.style.backgroundBlendMode = "normal";
				mediaTint.style.backgroundSize = "initial";
				mediaTint.style.backgroundPosition = "initial";
				mediaTint.style.backgroundRepeat = "initial";
				mediaTint.style.maskImage = "none";
				mediaTint.style.webkitMaskImage = "none";
			}
			if (mediaRing) {
				mediaRing.style.display = "none";
				mediaRing.style.outline = "none";
				mediaRing.style.outlineOffset = "0px";
				mediaRing.style.borderRadius = "0";
			}
			previewPin.style.width = `${size}px`;
			previewPin.style.height = `${size}px`;
			mediaTarget.style.width = `${size}px`;
			mediaTarget.style.height = `${size}px`;
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
				case "icon":
					previewPin.style.backgroundColor = "transparent";
					previewPin.style.border = "none";
					previewPin.style.borderColor = "transparent";
					mediaTarget.style.display = "block";
					mediaTarget.style.opacity = String(baseOpacity);
					mediaTarget.style.backgroundColor = "transparent";
					mediaTarget.style.border = "none";
					mediaTarget.style.borderRadius = "0";
					mediaTarget.style.overflow = "hidden";
					if (style.iconShapePath) {
						const iconPath = JSON.stringify(String(style.iconShapePath));
						const iconUrl = `url(${iconPath})`;
						mediaTarget.style.backgroundImage = iconUrl;
						const iconTint = style.iconShapeTint && style.iconShapeTint.toLowerCase() !== "#ffffff"
							? style.iconShapeTint : "";
						const isHighlightI = style.hoverAnimation === "highlight";
						const htI = isHighlightI && style.hoverImageTint && style.hoverImageTint.toLowerCase() !== "#ffffff" ? style.hoverImageTint : "";
						const tintI = color => {
							if (!mediaTint) return;
							const active = Boolean(iconTint || htI);
							// The tint layer is the media source while active. Hiding the
							// untinted copy keeps transparent source pixels transparent.
							mediaTarget.style.backgroundImage = active ? "none" : iconUrl;
							mediaTint.style.display = active ? "block" : "none";
							mediaTint.style.backgroundColor = "transparent";
							mediaTint.style.backgroundImage = active
								? `linear-gradient(${color}, ${color}), ${iconUrl}` : "none";
							mediaTint.style.backgroundBlendMode = active ? "multiply" : "normal";
							mediaTint.style.maskImage = iconUrl;
							mediaTint.style.webkitMaskImage = iconUrl;
							mediaTint.style.maskSize = "112% 112%";
							mediaTint.style.webkitMaskSize = "112% 112%";
							mediaTint.style.backgroundSize = "112% 112%";
							mediaTint.style.webkitMaskPosition = "center";
							mediaTint.style.maskPosition = "center";
							mediaTint.style.backgroundPosition = "center";
							mediaTint.style.maskRepeat = "no-repeat";
							mediaTint.style.webkitMaskRepeat = "no-repeat";
							mediaTint.style.backgroundRepeat = "no-repeat";
						};
						tintI(iconTint || "#ffffff");
						// Full-bleed: 112% to hide the ~25 px SVG padding, clipped to the pin size (like canvas mask)
						mediaTarget.style.backgroundSize = "112% 112%";
						mediaTarget.style.backgroundPosition = "center";
						mediaTarget.style.backgroundRepeat = "no-repeat";
						const hrwI = isHighlightI ? (parseInt(style.hoverRingWidth) || 0) : 0;
						const hrcI = isHighlightI ? (style.hoverRingColor || "#ff7a00") : "";
						if (previewPin._sdxHoverHandlers) {
							previewPin.removeEventListener("mouseenter", previewPin._sdxHoverHandlers.enter);
							previewPin.removeEventListener("mouseleave", previewPin._sdxHoverHandlers.leave);
						}
						const enterI = () => {
							tintI(htI || iconTint || "#ffffff");
							if (hrwI > 0) {
								if (mediaRing) {
									mediaRing.style.display = "block";
									mediaRing.style.outline = `${hrwI}px solid ${hrcI}`;
									mediaRing.style.outlineOffset = "0px";
									mediaRing.style.borderRadius = "10px";
								}
							}
						};
						const leaveI = () => {
							tintI(iconTint || "#ffffff");
							if (mediaRing) {
								mediaRing.style.display = "none";
								mediaRing.style.outline = "none";
								mediaRing.style.borderRadius = "0";
							}
						};
						previewPin.addEventListener("mouseenter", enterI);
						previewPin.addEventListener("mouseleave", leaveI);
						previewPin._sdxHoverHandlers = { enter: enterI, leave: leaveI };
					}
					else {
						mediaTarget.style.backgroundImage = "none";
						mediaTarget.style.border = "1px dashed #666";
					}
					break;
				case "image":
					previewPin.style.backgroundColor = "transparent";
					previewPin.style.border = "none";
					previewPin.style.borderColor = "transparent";
					mediaTarget.style.display = "block";
					mediaTarget.style.opacity = String(baseOpacity);
					mediaTarget.style.overflow = "visible";
					mediaTarget.style.backgroundColor = "transparent";
					mediaTarget.style.border = "none";
					mediaTarget.style.borderRadius = "0";
					previewPin.style.transform = "rotate(0deg)";

					// Add background image to preview
					if (style.imagePath) {
						const imagePath = JSON.stringify(String(style.imagePath));
						const imageUrl = `url(${imagePath})`;
						mediaTarget.style.backgroundImage = imageUrl;
						const imageTint = style.imageTint && style.imageTint.toLowerCase() !== "#ffffff"
							? style.imageTint : "";
						const isHighlight = style.hoverAnimation === "highlight";
						const ht = isHighlight && style.hoverImageTint && style.hoverImageTint.toLowerCase() !== "#ffffff" ? style.hoverImageTint : "";
						const tint = color => {
							if (!mediaTint) return;
							const active = Boolean(imageTint || ht);
							// The tint layer is the media source while active. Hiding the
							// untinted copy keeps transparent source pixels transparent.
							mediaTarget.style.backgroundImage = active ? "none" : imageUrl;
							mediaTint.style.display = active ? "block" : "none";
							mediaTint.style.backgroundColor = "transparent";
							mediaTint.style.backgroundImage = active
								? `linear-gradient(${color}, ${color}), ${imageUrl}` : "none";
							mediaTint.style.backgroundBlendMode = active ? "multiply" : "normal";
							mediaTint.style.maskImage = imageUrl;
							mediaTint.style.webkitMaskImage = imageUrl;
							mediaTint.style.maskSize = "contain";
							mediaTint.style.webkitMaskSize = "contain";
							mediaTint.style.backgroundSize = "contain";
							mediaTint.style.maskPosition = "center";
							mediaTint.style.webkitMaskPosition = "center";
							mediaTint.style.backgroundPosition = "center";
							mediaTint.style.maskRepeat = "no-repeat";
							mediaTint.style.webkitMaskRepeat = "no-repeat";
							mediaTint.style.backgroundRepeat = "no-repeat";
						};
						tint(imageTint || "#ffffff");
						mediaTarget.style.backgroundSize = "contain";
						mediaTarget.style.backgroundPosition = "center";
						mediaTarget.style.backgroundRepeat = "no-repeat";
						// Preview hover tint and ring are separate from the media body.
						const hrw = isHighlight ? (parseInt(style.hoverRingWidth) || 0) : 0;
						const hrc = isHighlight ? (style.hoverRingColor || "#ff7a00") : "";
						if (previewPin._sdxHoverHandlers) {
							previewPin.removeEventListener("mouseenter", previewPin._sdxHoverHandlers.enter);
							previewPin.removeEventListener("mouseleave", previewPin._sdxHoverHandlers.leave);
						}
						const enter = () => {
							tint(ht || imageTint || "#ffffff");
							if (hrw > 0) {
								if (mediaRing) {
									mediaRing.style.display = "block";
									mediaRing.style.outline = `${hrw}px solid ${hrc}`;
									mediaRing.style.outlineOffset = "0px";
									mediaRing.style.borderRadius = "10px";
								}
							}
						};
						const leave = () => {
							tint(imageTint || "#ffffff");
							if (mediaRing) {
								mediaRing.style.display = "none";
								mediaRing.style.outline = "none";
								mediaRing.style.borderRadius = "0";
							}
						};
						previewPin.addEventListener("mouseenter", enter);
						previewPin.addEventListener("mouseleave", leave);
						previewPin._sdxHoverHandlers = { enter, leave };
					}
					else {
						// Fallback placeholder
						mediaTarget.style.backgroundImage = "none";
						mediaTarget.style.border = "1px dashed #666";
					}
				// Image bodies still receive the common content and label overlays below.
			}

			// Content (number, symbol, custom icon, or text)
			const content = previewPin.querySelector(".preview-content");
			if (content) {
				const type = style.contentType || (style.showIcon ? "symbol" : "number");

				if (type === "none") {
					content.innerHTML = "";
					content.textContent = "";
				}
				else if (type === "symbol" || type === "icon") {
					// FontAwesome icon (now Symbol)
					const symbolClass = style.symbolClass || style.iconClass || "fa-solid fa-book-open";
					content.innerHTML = `<i class="${symbolClass}"></i>`;
					content.style.fontSize = `${size * 0.5}px`;
					content.style.color = style.symbolColor || "#ffffff";
				}
				else if (type === "customIcon") {
					// Custom SVG icon
					if (style.customIconPath) {
						const iconPath = JSON.stringify(String(style.customIconPath));
						const iconColor = style.iconColor || "#ffffff";
						content.innerHTML = "<span class=\"preview-custom-icon\"></span>";
						const icon = content.querySelector(".preview-custom-icon");
						if (icon) {
							icon.style.width = "70%";
							icon.style.height = "70%";
							icon.style.backgroundColor = iconColor;
							icon.style.maskImage = `url(${iconPath})`;
							icon.style.webkitMaskImage = `url(${iconPath})`;
							icon.style.maskSize = "contain";
							icon.style.webkitMaskSize = "contain";
							icon.style.maskPosition = "center";
							icon.style.webkitMaskPosition = "center";
							icon.style.maskRepeat = "no-repeat";
							icon.style.webkitMaskRepeat = "no-repeat";
						}
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
				previewLabel.textContent = style.labelText || "";
				previewLabel.style.display = style.labelText ? "flex" : "none";
				if (previewPin._sdxLabelHoverHandlers) {
					previewPin.removeEventListener("mouseenter", previewPin._sdxLabelHoverHandlers.enter);
					previewPin.removeEventListener("mouseleave", previewPin._sdxLabelHoverHandlers.leave);
					previewPin._sdxLabelHoverHandlers = null;
				}
				if (style.labelText && style.labelShowOnHover) {
					const enter = () => {
						previewLabel.style.display = "flex";
					};
					const leave = () => {
						previewLabel.style.display = "none";
					};
					previewLabel.style.display = "none";
					previewPin.addEventListener("mouseenter", enter);
					previewPin.addEventListener("mouseleave", leave);
					previewPin._sdxLabelHoverHandlers = { enter, leave };
				}
				previewLabel.style.fontFamily = style.labelFontFamily || "Arial";
				previewLabel.style.position = "absolute";
				previewLabel.style.fontSize = `${style.labelFontSize || 16}px`;
				previewLabel.style.color = style.labelColor || "#ffffff";
				previewLabel.style.fontWeight = style.labelBold ? "bold" : "normal";
				previewLabel.style.fontStyle = style.labelItalic ? "italic" : "normal";
				const labelStrokeThickness = Number(style.labelStrokeThickness) || 0;
				if (labelStrokeThickness > 0) {
					previewLabel.style.webkitTextStroke = `${labelStrokeThickness}px ${style.labelStroke || "#000000"}`;
					previewLabel.style.paintOrder = "stroke fill";
				}
				else {
					previewLabel.style.webkitTextStroke = "unset";
					previewLabel.style.paintOrder = "normal";
				}

				// Reset frame/background state so switching modes cannot retain a
				// solid border or image-slice settings from the previous selection.
				previewLabel.style.opacity = "1";
				previewLabel.style.backgroundColor = "transparent";
				previewLabel.style.border = "none";
				previewLabel.style.borderRadius = "0";
				previewLabel.style.borderStyle = "none";
				previewLabel.style.borderWidth = "0";
				previewLabel.style.borderImage = "none";
				previewLabel.style.borderImageSource = "none";
				previewLabel.style.borderImageSlice = "";
				previewLabel.style.borderImageWidth = "";
				previewLabel.style.borderImageOutset = "";
				previewLabel.style.borderImageRepeat = "";

				// Position preview label relative to pin using CSS transform
				const anchor = style.labelAnchor || "bottom";
				const offsetSq = style.labelOffset ?? 5;
				const pinHalf = (style.size || 40) / 2;
				previewLabel.style.left = "50%";
				previewLabel.style.top = "50%";

				let transform = "translate(-50%, -50%)";

				switch (anchor) {
					case "top":
						transform = `translate(-50%, calc(-100% - ${pinHalf + offsetSq}px))`;
						break;
					case "bottom":
						transform = `translate(-50%, ${pinHalf + offsetSq}px)`;
						break;
					case "left":
						transform = `translate(calc(-100% - ${pinHalf + offsetSq}px), -50%)`;
						break;
					case "right":
						transform = `translate(${pinHalf + offsetSq}px, -50%)`;
						break;
				}

				previewLabel.style.transform = transform;
				previewLabel.style.transformOrigin = "center center";

				if (labelBg === "solid") {
					previewLabel.style.border = `${style.labelBorderWidth}px solid ${style.labelBorderColor || "#ffffff"}`;
					previewLabel.style.borderRadius = `${style.labelBorderRadius}px`;
					previewLabel.style.backgroundColor = colorWithAlpha(
						style.labelBackgroundColor || "#000000",
						readNumber(style.labelBackgroundOpacity, 1.0)
					);
				}
				else if (labelBg === "image") {
					previewLabel.style.borderRadius = "0";

					const borderImagePath = String(style.labelBorderImagePath || "").trim();
					if (borderImagePath) {
						const sT = style.labelBorderSliceTop || 15;
						const sR = style.labelBorderSliceRight || 15;
						const sB = style.labelBorderSliceBottom || 15;
						const sL = style.labelBorderSliceLeft || 15;

						previewLabel.style.borderStyle = "solid";
						previewLabel.style.borderWidth = "0px"; // Slices will define the visible border via fill
						previewLabel.style.borderImageSource = `url("${borderImagePath}")`;
						previewLabel.style.borderImageSlice = `${sT} ${sR} ${sB} ${sL} fill`;
						previewLabel.style.borderImageWidth = "auto";
						previewLabel.style.borderImageOutset = "0px";
						previewLabel.style.borderImageRepeat = "stretch";
						previewLabel.style.backgroundColor = colorWithAlpha(
							style.labelBackgroundColor || "#000000",
							readNumber(style.labelBackgroundOpacity, 1.0)
						);
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
		if (!pinGraphics) return;
		const originalPin = JournalPinManager.get(this.pinId);
		if (!originalPin) return;
		const effectiveStyle = { ...style };
		if (originalPin.size != null && originalPin.style?.size == null && effectiveStyle.size === 32) {
			effectiveStyle.size = originalPin.size;
		}
		const tempData = foundry.utils.mergeObject(
			foundry.utils.deepClone(originalPin),
			{ style: effectiveStyle },
			{ inplace: false }
		);
		await pinGraphics.update(tempData);
		// Style edits rebuild the PIXI pin (update() clears filters then re-adds only persisted).
		// Re-attach any active TMFX preview so it doesn't blip for a frame.
		try {
			await this._reapplyTMFXPreview?.();
		}
		catch{}
	},
};
