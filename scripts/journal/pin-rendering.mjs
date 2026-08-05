// Canvas pin graphics + renderer — extracted from
// scripts/journal/JournalPinsSD.mjs (Phase 5.1 split).
//
// Phase 5.3.5 moved the pointer interactions to pin-interactions.mjs and the
// hover tooltip to pin-tooltip.mjs. JournalPinTooltip is re-exported here so
// the original import surface still resolves.

import { MODULE_ID, getPinStyle, normalizeImageTint } from "./pin-style.mjs";
import { JournalPinManager, checkPinVisibility } from "./pin-manager.mjs";
import { drawStyledStroke } from "./pin-draw.mjs";
import {
	attachPinListeners,
	detachPinListeners,
	onPointerDown,
	onPointerEnter,
	onPointerLeave,
	onPointerMove,
	onPointerUp,
	openPinJournal,
	showPinContextMenu,
} from "./pin-interactions.mjs";

export { JournalPinTooltip } from "./pin-tooltip.mjs";

// ================================================================
// PIN GRAPHICS - PIXI rendering
// ================================================================

export class JournalPinGraphics extends PIXI.Container {
	constructor(pinData) {
		super();
		this.pinData = foundry.utils.deepClone(pinData);
		this._circle = null;
		this._label = null;
		this._icon = null;
		this._isDragging = false;
		this._hasDragged = false;
		this._dragOffset = { x: 0, y: 0 };
		this._dragStartPos = { x: 0, y: 0 };

		// Set initial position synchronously to prevent race conditions
		this.position.set(this.pinData.x, this.pinData.y);

		this._labelOffset = { x: 0, y: 0 };
		this._labelContainer = null;
		this._buildId = 0;
		this._cachedTexture = null;
		this.cullable = true;

		// Do NOT call _init() here, we defer it until we are indexed in the renderer
	}

	async init() {
		await this._build();
		if (this.destroyed) return;
		this._setupEventListeners();
		return this;
	}

	/**
     * Get the page number (0-indexed position in the journal's pages)
     */
	_getPageNumber() {
		const journal = game.journal.get(this.pinData.journalId);
		if (!journal) {
			return null;
		}

		// Get sorted pages (same order as shown in the journal)
		const sortedPages = journal.pages.contents.sort((a, b) => a.sort - b.sort);

		if (this.pinData.pageId) {
			// Find the index of the specific page
			const pageIndex = sortedPages.findIndex(p => p.id === this.pinData.pageId);
			return pageIndex >= 0 ? pageIndex : 0;
		}
		else {
			// Default to first page (index 0)
			return 0;
		}
	}

	// ===========================================
	// FOUNDRY / TOKENMAGIC INTERFACE MOCK
	// ===========================================

	// We MUST use a getter for document that returns a proxy/wrapper
	// to avoid property collisions with PIXI (especially 'parent' and 'name')
	get document() {
		return {
			id: this.pinData.id,
			documentName: "JournalPin",
			name: this.pinData.label || "Journal Pin",
			parent: canvas.scene,
			getFlag: (s, k) => this.getFlag(s, k),
			setFlag: (s, k, v) => this.setFlag(s, k, v),
			unsetFlag: (s, k) => this.unsetFlag(s, k),
			_TMFXsetFlag: f => this._TMFXsetFlag(f),
			_TMFXunsetFlag: () => this._TMFXunsetFlag(),
			_TMFXsetAnimeFlag: f => this._TMFXsetAnimeFlag(f),
			_TMFXunsetAnimeFlag: () => this._TMFXunsetAnimeFlag(),
			_TMFXgetPlaceableType: () => this._TMFXgetPlaceableType(),
			_TMFXgetMaxFilterRank: () => this._TMFXgetMaxFilterRank(),
			get object() {
				return this;
			},
		};
	}

	get id() {
		return this.pinData.id;
	}

	// Mock getFlag for TokenMagic
	getFlag(scope, key) {
		const flags = this.pinData.flags || {};
		if (scope && key) return foundry.utils.getProperty(flags, `${scope}.${key}`);
		if (scope) return flags[scope];
		return flags;
	}

	async setFlag(scope, key, value) {
		const updateData = {};
		updateData[`flags.${scope}.${key}`] = value;
		return await JournalPinManager.update(this.pinData.id, updateData);
	}

	async unsetFlag(scope, key) {
		const updateData = {};
		// v14+: use ForcedDeletion sentinel instead of legacy "-=" deletion key syntax.
		updateData[`flags.${scope}.${key}`] = new foundry.data.operators.ForcedDeletion();
		return await JournalPinManager.update(this.pinData.id, updateData);
	}

	// Mock CanvasDocument / PlaceableObject methods for TMFX
	async _TMFXsetFlag(flag) {
		return await this.setFlag("tokenmagic", "filters", flag);
	}

	async _TMFXunsetFlag() {
		return await this.unsetFlag("tokenmagic", "filters");
	}

	async _TMFXsetAnimeFlag(flag) {
		return await this.setFlag("tokenmagic", "animeInfo", flag);
	}

	async _TMFXunsetAnimeFlag() {
		return await this.unsetFlag("tokenmagic", "animeInfo");
	}

	_TMFXgetPlaceableType() {
		return "JournalPin";
	}

	_TMFXgetSprite() {
		return this;
	}

	_TMFXcheckSprite() {
		return true;
	}

	_TMFXgetMaxFilterRank() {
		const filters = this.filters || [];
		if (filters.length === 0) return 10000;
		return Math.max(...filters.map(f => f.rank || 0)) + 1;
	}

	async TMFXaddFilters(paramsArray, replace = false) {
		if (window.TokenMagic) await window.TokenMagic.addFilters(this, paramsArray, replace);
	}

	async TMFXupdateFilters(paramsArray) {
		if (window.TokenMagic) await window.TokenMagic.updateFiltersByPlaceable(this, paramsArray);
	}

	async TMFXdeleteFilters(filterId = null) {
		if (window.TokenMagic) await window.TokenMagic.deleteFilters(this, filterId);
	}

	// Mimic PlaceableObjectProto._TMFXsetRawFilters
	_TMFXsetRawFilters(filters) {
		if (!this.filters) this.filters = [];
		// Simple append for now as TMFX usually manages the array
		if (filters === null) {
			this.filters = null;
		}
		else if (Array.isArray(filters)) this.filters = filters;
		else this.filters.push(filters);
	}

	animatePing(type = "ping") {
		if (!window.gsap) {
			if (canvas.ping) canvas.ping({ x: this.pinData.x, y: this.pinData.y });
			return;
		}

		const style = { ...getPinStyle(), ...(this.pinData.style || {}) };
		const pingAnim = (type === "bring")
			? (style.bringAnimation || "ripple")
			: (style.pingAnimation || "ripple");

		if (pingAnim === "none") return;

		// Logic to reset scale after animation
		const hoverAnim = style.hoverAnimation;
		const isHoverScale = this.isHovered && (hoverAnim === true || hoverAnim === "scale");
		const restingScale = isHoverScale ? 1.2 : 1.0;

		gsap.killTweensOf(this);
		gsap.killTweensOf(this.scale);

		if (pingAnim === "ripple") {
			const color = style.ringColor || "#ffffff";
			let colorNum = 0xFFFFFF;
			try {
				if (typeof color === "string" && color.startsWith("#")) colorNum = parseInt(color.slice(1), 16);
				else if (typeof color === "number") colorNum = color;
			}
			catch(e) { }

			const ripple = new PIXI.Graphics();
			ripple.lineStyle(6, colorNum, 0.8);
			ripple.drawCircle(0, 0, 40);
			ripple.endFill();
			ripple.alpha = 0;
			ripple.scale.set(0.5);

			this.addChild(ripple);

			const tl = gsap.timeline({ onComplete: () => ripple.destroy() });
			tl.to(ripple, { alpha: 0.8, duration: 0.1 })
				.to(ripple, { alpha: 0, duration: 1.2 }, "<")
				.to(ripple.scale, { x: 4, y: 4, duration: 1.3, ease: "power2.out" }, "<");

			gsap.fromTo(this.scale,
				{ x: 1.6, y: 1.6 },
				{ x: restingScale, y: restingScale, duration: 1.0, ease: "elastic.out(1, 0.5)" }
			);

		}
		else if (pingAnim === "flash") {
			gsap.fromTo(
				this, { pixi: { brightness: 3 } },
				{ pixi: { brightness: 1 }, duration: 1.0, ease: "power2.out" }
			);
			gsap.fromTo(this.scale,
				{ x: 1.5, y: 1.5 },
				{ x: restingScale, y: restingScale, duration: 1.0, ease: "elastic.out(1, 0.5)" }
			);

		}
		else if (pingAnim === "shake") {
			const originalX = this.pinData.x;
			gsap.to(this, {
				x: "+=5", yoyo: true, repeat: 9, duration: 0.05, onComplete: () => {
					this.x = originalX;
				},
			});
			gsap.to(this.scale, {
				x: 1.3, y: 1.3, duration: 0.1, yoyo: true, repeat: 3, onComplete: () => {
					gsap.to(this.scale, { x: restingScale, y: restingScale, duration: 0.2 });
				},
			});
		}
	}

	async _build() {
		if (this.destroyed) return;

		// Track build cycle to prevent overlapping async builds from creating ghost labels
		const buildId = ++this._buildId;

		// CRITICAL: Kill all GSAP animations BEFORE tearing down children/textures.
		// On macOS Chrome, hover animations (scale/pulse/etc.) hold references to
		// sprites whose textures we are about to destroy. If the PIXI render loop
		// fires between destroy and rebuild, it hits a null texture → black screen.
		if (window.gsap) {
			gsap.killTweensOf(this);
			gsap.killTweensOf(this.scale);
		}

		// Cleanup old label container reference if this is a fresh start
		if (this._labelContainer) {
			if (this._labelContainer.parent) {
				this._labelContainer.parent.removeChild(this._labelContainer);
			}
			this._labelContainer.destroy({ children: true });
			this._labelContainer = null;
		}

		// Clear image sprite reference (will be set if shape is "image")
		this._imageSprite = null;

		// SAFE TEARDOWN: Remove children from the display tree FIRST so that
		// PIXI's render loop never encounters a sprite with a destroyed texture.
		this.removeChildren();

		// NOW destroy the old cached texture (no sprite references it anymore)
		if (this._cachedTexture) {
			this._cachedTexture.destroy(true);
			this._cachedTexture = null;
		}

		// We will build the new label in a local variable and only
		// attach it to the class/renderer if this build cycle is still valid at the end.
		let newLabelContainer = null;

		// Don't remove children yet, wait until new content is ready


		// Get global style settings
		const globalStyle = getPinStyle();

		// Merge: global defaults < pin-specific style overrides
		const style = { ...globalStyle, ...(this.pinData.style || {}) };

		// Pin size: normally the style's size slider, but "Fit to hex grid"
		// overrides it with the active scene's grid cell so the pin covers the
		// whole hex (image/hexagon overlays). Math.max picks the larger hex
		// axis (flat-top width vs pointy height); falls back to grid.size for
		// square grids.
		let size = style.size || 32;
		if (style.fitToHexGrid && canvas?.grid) {
			const g = canvas.grid;
			const cell = Math.max(Number(g.sizeX) || 0, Number(g.sizeY) || 0, Number(g.size) || 0);
			if (cell > 0) size = cell;
		}
		const radius = size / 2;

		const fillColor = style.fillColor || "#000000";
		const ringWidth = style.ringWidth || 3;
		const baseOpacity = style.opacity ?? 1.0;
		const fillOpacity = (style.fillOpacity ?? 1.0) * baseOpacity;
		const ringOpacity = (style.ringOpacity ?? 1.0) * baseOpacity;


		// Use red dashed stroke if pin is GM-only (visible indicator for GM)
		let ringColor;
		let ringStyle = style.ringStyle || "solid";
		if (this.pinData.gmOnly && game.user?.isGM) {
			ringColor = "#FF4444"; // Red for GM-only pins
			ringStyle = "dashed";  // Forced dashed for GM-only
		}
		else {
			ringColor = style.ringColor || "#ffffff";
		}

		const fillColorNum = parseInt(fillColor.slice(1), 16);
		const ringColorNum = parseInt(ringColor.slice(1), 16);

		const container = new PIXI.Container();

		const shape = style.shape || "circle";

		// Special handling for Image Shape
		if (shape === "image") {
			try {
				// If shape is image, we skip the standard graphics builder
				// We create a sprite directly container

				const imagePath = style.imagePath;
				if (imagePath) {
					const texture = await (foundry.canvas?.loadTexture || loadTexture)(imagePath);
					if (this._buildId !== buildId || this.destroyed) return;

					if (texture) {
						const sprite = new PIXI.Sprite(texture);
						// Center anchor
						sprite.anchor.set(0.5);

						// Scale to fit size, maintaining aspect ratio usually,
						// but here we might force square fit or contain?
						// Let's use "contain" logic within the size box

						const maxDim = Math.max(texture.width, texture.height);
						const scale = size / maxDim;

						sprite.width = texture.width * scale;
						sprite.height = texture.height * scale;

						// Apply opacity
						sprite.alpha = baseOpacity;

						// Optional multiply tint (e.g. carried over from a map note).
						// normalizeImageTint drops invalid values and the white no-op.
						const imageTint = normalizeImageTint(style.imageTint);
						if (imageTint) sprite.tint = Number(imageTint);

						// Store reference for pixel-perfect hover detection
						this._imageSprite = sprite;

						container.addChild(sprite);
					}
				}
				else {
					// Fallback if no image path: broken image placeholder
					const placeholder = new PIXI.Graphics();
					placeholder.lineStyle(2, 0xFF0000, baseOpacity);
					placeholder.moveTo(-radius, -radius);
					placeholder.lineTo(radius, radius);
					placeholder.moveTo(radius, -radius);
					placeholder.lineTo(-radius, radius);
					placeholder.drawRect(-radius, -radius, size, size);
					container.addChild(placeholder);
				}

				// Content (number/icon/text) still renders on top of the image
				// unless contentType is "none". _circle stays null here; all its
				// uses are confined to the non-image branch below.

			}
			catch(err) {
				console.error("SDX Journal Pins | Error loading pin image:", err);
			}
		}
		else {
			// Standard Shape Drawing
			const circle = new PIXI.Graphics();
			this._circle = circle; // Keep reference if needed

			this._circle.beginFill(fillColorNum, fillOpacity);

			// Use standard lineStyle for solid, or helper for dashed/dotted
			if (ringStyle === "solid") {
				this._circle.lineStyle(ringWidth, ringColorNum, ringOpacity);
			}
			else {
				this._circle.lineStyle(0); // Standard stroke off for segment drawing
			}

			switch (shape) {
				case "circle":
					this._circle.drawCircle(0, 0, radius);
					break;
				case "square":
					const cornerRadius = style.borderRadius ?? 4;
					this._circle.drawRoundedRect(-radius, -radius, size, size, cornerRadius);
					break;
				case "diamond":
					const half = radius;
					this._circle.moveTo(0, -half);
					this._circle.lineTo(half, 0);
					this._circle.lineTo(0, half);
					this._circle.lineTo(-half, 0);
					this._circle.closePath();
					break;
				case "hexagon":
				case "hexagonFlat": {
					// "hexagon" = pointy-top (vertex up); "hexagonFlat" = flat-top
					// (flat edge up). The 30° offset rotates the vertex set.
					const hexRadius = radius;
					const hexOffset = shape === "hexagonFlat" ? 0 : -Math.PI / 2;
					for (let i = 0; i < 6; i++) {
						const angle = ((Math.PI / 3) * i) + hexOffset;
						const hx = Math.cos(angle) * hexRadius;
						const hy = Math.sin(angle) * hexRadius;
						if (i === 0) this._circle.moveTo(hx, hy);
						else this._circle.lineTo(hx, hy);
					}
					this._circle.closePath();
					break;
				}
				default:
					this._circle.drawCircle(0, 0, radius);
			}

			this._circle.endFill();
			container.addChild(this._circle);

			// Draw custom stroke if not solid AND not image
			if (ringStyle !== "solid") {
				const cornerRadius = style.borderRadius ?? 4;
				drawStyledStroke(
					this._circle, shape, radius, ringWidth, ringColorNum, ringOpacity, ringStyle,
					cornerRadius
				);
			}
		}

		// Add content: number, symbol, custom icon, custom text, or none
		const contentType = style.contentType || (style.showIcon ? "symbol" : "number");

		if (contentType === "none") {
			// No content overlay (e.g. pins converted from map notes)
		}
		else if (contentType === "symbol" || contentType === "icon") {
			// FontAwesome icon (renamed to symbol)
			const iconClass = style.symbolClass || style.iconClass || "fa-solid fa-book-open";
			const symbolColor = style.symbolColor || style.fontColor || "#ffffff";
			const symbolColorNum = typeof symbolColor === "string" && symbolColor.startsWith("#")
				? parseInt(symbolColor.slice(1), 16)
				: 0xFFFFFF;

			await this._addIcon(container, iconClass, radius, symbolColorNum);
			if (this._buildId !== buildId || this.destroyed) return;
		}
		else if (contentType === "customIcon") {
			// Custom SVG icon from assets
			const iconPath = style.customIconPath;
			if (iconPath) {
				const iconColor = style.iconColor || "#ffffff";
				const iconColorNum = typeof iconColor === "string" && iconColor.startsWith("#")
					? parseInt(iconColor.slice(1), 16)
					: 0xFFFFFF;
				await this._addSvgIcon(container, iconPath, radius, iconColorNum);
				if (this._buildId !== buildId || this.destroyed) return;
			}
		}
		else {
			// Show text (page number or custom)
			const fontColor = style.fontColor || "#ffffff";
			const fontColorNum = typeof fontColor === "string" && fontColor.startsWith("#")
				? parseInt(fontColor.slice(1), 16)
				: 0xFFFFFF;

			let textValue = "";
			if (contentType === "text") {
				textValue = style.customText || "";
			}
			else {
				const pageNumber = this._getPageNumber();
				textValue = pageNumber !== null ? String(pageNumber) : "";
			}

			if (textValue !== "") {
				const fontSize = style.fontSize || Math.max(10, radius * 0.9);
				const fontFamily = style.fontFamily || "Arial";
				const fontWeight = style.fontWeight || "bold";

				// Await font loading if it's a custom font
				if (fontFamily && fontFamily !== "Arial") {
					try {
						await document.fonts.load(`16px ${fontFamily}`);
						if (this._buildId !== buildId || this.destroyed) return;
					}
					catch(e) {
						console.warn(`SDX Journal Pins | Failed to load font: ${fontFamily}`);
					}
				}

				const label = new PIXI.Text(textValue, {
					fontFamily: fontFamily,
					fontSize: fontSize * 4,
					fontWeight: fontWeight,
					fill: fontColorNum,
					stroke: style.fontStroke || "#000000",
					strokeThickness: (style.fontStrokeThickness ?? 0) * 4,
					fontStyle: style.fontItalic ? "italic" : "normal",
					align: "center",
					resolution: 4,
				});
				label.scale.set(0.25);
				label.anchor.set(0.5, 0.5);
				label.position.set(0, 0);

				// For diamond shape, we need to rotate the text back
				if (shape === "diamond") {
					label.rotation = -Math.PI / 4;
				}

				container.addChild(label);
			}
		}

		// Everything is ready, add the new container
		// (old children were already removed at the start of _build)
		this.removeChildren();
		this.addChild(container);

		// ===================================
		// ADD OPTIONAL HOVER LABEL
		// ===================================
		if (style.labelText) {
			newLabelContainer = new PIXI.Container();

			const labelFontFamily = style.labelFontFamily || "Arial";

			// Await font loading if it's a custom font
			if (labelFontFamily && labelFontFamily !== "Arial") {
				try {
					await document.fonts.load(`16px ${labelFontFamily}`);
					if (this._buildId !== buildId || this.destroyed) return;
				}
				catch(e) {
					console.warn(
						`SDX Journal Pins | Failed to load label font: ${labelFontFamily}`
					);
				}
			}

			// Create text with extra padding for script/italic fonts that bleed outside bounds
			const fontSize = style.labelFontSize || 16;
			const labelText = new PIXI.Text(style.labelText, {
				fontFamily: labelFontFamily,
				fontSize: fontSize * 4,
				fill: style.labelColor || "#ffffff",
				stroke: style.labelStroke || "#000000",
				strokeThickness: (style.labelStrokeThickness ?? 4) * 4,
				fontWeight: style.labelBold ? "bold" : "normal",
				fontStyle: style.labelItalic ? "italic" : "normal",
				align: "center",
				padding: Math.ceil(fontSize * 0.4) * 4, // Extra padding for script/decorative fonts
				resolution: 4,
			});
			labelText.scale.set(0.25);

			// Background
			const padX = 8;
			const padY = 4;
			let bg;
			let bgColorGraphic;

			if (style.labelBackground === "image") {
				try {
					let path;

					// Check for custom image path first
					if (style.labelBorderImagePath && typeof style.labelBorderImagePath === "string" && style.labelBorderImagePath.trim() !== "") {
						path = style.labelBorderImagePath.trim();
					}

					if (!path) return;

					const tex = await loadTexture(path);
					if (tex) {
						const sT = parseInt(style.labelBorderSliceTop) || 15;
						const sR = parseInt(style.labelBorderSliceRight) || 15;
						const sB = parseInt(style.labelBorderSliceBottom) || 15;
						const sL = parseInt(style.labelBorderSliceLeft) || 15;

						// PIXI.NineSlicePlane(texture, leftWidth, topHeight, rightWidth,
						// bottomHeight)
						bg = new PIXI.NineSlicePlane(tex, sL, sT, sR, sB);

						// The background size should cover the text plus padding
						bg.width = labelText.width + (padX * 4);
						bg.height = labelText.height + (padY * 4);

						// Create optional background color behind the image
						const colorVal = style.labelBackgroundColor;
						// Check if opacity is > 0
						if (style.labelBackgroundOpacity > 0) {
							bgColorGraphic = new PIXI.Graphics();
							const bgColor = typeof Color !== "undefined" ? Color.from(colorVal || "#000000") : (colorVal || "#000000");
							bgColorGraphic.beginFill(bgColor, style.labelBackgroundOpacity);

							// Fill slightly smaller than the full border to fit inside
							// For a complex border, a simple rect is often best "behind" it.
							bgColorGraphic.drawRect(0, 0, bg.width, bg.height);
							bgColorGraphic.endFill();
						}
					}
				}
				catch(e) {
					console.error("SDX Journal Pins | Failed to load label background", e);
				}
			}
			else if (style.labelBackground === "solid") {
				bg = new PIXI.Graphics();
				const bgColor = typeof Color !== "undefined" ? Color.from(style.labelBackgroundColor || "#000000") : (style.labelBackgroundColor || "#000000");
				const borderColor = typeof Color !== "undefined" ? Color.from(style.labelBorderColor || "#ffffff") : (style.labelBorderColor || "#ffffff");

				bg.beginFill(bgColor, style.labelBackgroundOpacity ?? 0.8);
				if ((style.labelBorderWidth ?? 0) > 0) {
					bg.lineStyle(style.labelBorderWidth, borderColor, 1);
				}
				bg.drawRoundedRect(
					0, 0, labelText.width + (padX * 2), labelText.height + (padY * 2),
					style.labelBorderRadius || 4
				);
				bg.endFill();
			}

			// Assemble container
			if (bg) {
				const w = bg.width;
				const h = bg.height;
				const pivotX = w / 2;
				const pivotY = h / 2;

				// Add color layer first (behind)
				if (bgColorGraphic) {
					bgColorGraphic.pivot.set(pivotX, pivotY);
					bgColorGraphic.position.set(0, 0);
					newLabelContainer.addChild(bgColorGraphic);
				}

				// Add border/frame
				if (bg instanceof PIXI.Graphics) bg.pivot.set(pivotX, pivotY);
				else bg.pivot.set(pivotX, pivotY);
				bg.position.set(0, 0);
				newLabelContainer.addChild(bg);
			}

			// Center text
			labelText.anchor.set(0.5, 0.5);
			labelText.position.set(0, 0);
			newLabelContainer.addChild(labelText);

			// Position container relative to pin
			const bgW = bg ? bg.width : labelText.width;
			const bgH = bg ? bg.height : labelText.height;
			const pinRadius = radius; // effective radius (honors Fit to hex grid)
			const padding = style.labelOffset ?? 5;

			let posX = 0;
			let posY = 0;

			switch (style.labelAnchor) {
				case "top":
					posY = -pinRadius - (bgH / 2) - padding;
					break;
				case "left":
					posX = -pinRadius - (bgW / 2) - padding;
					break;
				case "right":
					posX = pinRadius + (bgW / 2) + padding;
					break;
				case "center":
					posX = 0;
					posY = 0;
					break;
				case "bottom":
				default:
					posY = pinRadius + (bgH / 2) + padding;
					break;
			}

			newLabelContainer.position.set(posX, posY);

			// Initial Visibility
			newLabelContainer.visible = !style.labelShowOnHover;

			// Winner takes all: Only update instance variables and
			// add to canvas if this build is still the latest one.
			if (this._buildId === buildId && !this.destroyed) {
				// Final cleanup of any concurrent build's label that might have slipped in
				if (this._labelContainer) {
					if (this._labelContainer.parent) {
						this._labelContainer.parent.removeChild(this._labelContainer);
					}
					this._labelContainer.destroy({ children: true });
				}

				this._labelContainer = newLabelContainer;
				this._labelContainer.cullable = true;
				this._labelOffset = { x: posX, y: posY };

				const rendererLabelContainer = JournalPinRenderer.getLabelContainer();
				if (rendererLabelContainer) {
					this._labelContainer.position.set(
						this.position.x + posX, this.position.y + posY
					);
					rendererLabelContainer.addChild(this._labelContainer);
				}
				else {
					this.addChild(this._labelContainer);
				}
			}
			else {
				// This build was superseded, clean up our local container
				newLabelContainer.destroy({ children: true });
			}
		}

		// Hit area based on shape
		if (shape === "circle") {
			this.hitArea = new PIXI.Circle(0, 0, radius);
		}
		else {
			this.hitArea = new PIXI.Rectangle(-radius, -radius, size, size);
		}

		// CRITICAL: Interactivity settings
		this.interactive = true;
		this.eventMode = "static";
		this.cursor = "pointer";
		this.interactiveChildren = false;

		// Pixel-perfect hover detection for image-shaped pins
		if (this._imageSprite && game.settings.get(MODULE_ID, "pixelPerfectPins")) {
			const sprite = this._imageSprite;
			const alphaThreshold = game.settings.get(MODULE_ID, "pixelPerfectPinsAlpha") ?? 100;

			// Store original contains function
			this.hitArea._originalContains = this.hitArea.contains.bind(this.hitArea);
			this.hitArea._sprite = sprite;
			this.hitArea._pinGraphics = this;
			this.hitArea._alphaThreshold = alphaThreshold;

			// Override contains to use pixel-perfect detection
			this.hitArea.contains = function(x, y) {
				// First check if point is within basic bounds
				const inBounds = this._originalContains(x, y);
				if (!inBounds) return false;

				// Then check pixel alpha
				const sprite = this._sprite;
				if (!sprite || !sprite.texture?.baseTexture?.resource?.source) {
					return inBounds;
				}

				try {
					// Get the texture source (canvas or image)
					const source = sprite.texture.baseTexture.resource.source;
					const texture = sprite.texture;

					// Calculate the point in texture coordinates
					// x, y are relative to the pin center (hitArea local coords)
					// sprite is anchored at 0.5, 0.5

					// Convert to sprite local coords
					const spriteX = x + (sprite.width / 2);
					const spriteY = y + (sprite.height / 2);

					// Convert to texture coords
					const scaleX = texture.width / sprite.width;
					const scaleY = texture.height / sprite.height;

					const texX = Math.floor(spriteX * scaleX);
					const texY = Math.floor(spriteY * scaleY);

					// Bounds check
					if (texX < 0 || texX >= texture.width || texY < 0 || texY >= texture.height) {
						return false;
					}

					// Get pixel alpha from canvas
					// We need to render texture to canvas to read pixel data
					if (!this._pixelCanvas) {
						this._pixelCanvas = document.createElement("canvas");
						this._pixelCanvas.width = texture.width;
						this._pixelCanvas.height = texture.height;
						const ctx = this._pixelCanvas.getContext("2d");
						ctx.drawImage(source, 0, 0);
						const imageData = ctx.getImageData(0, 0, texture.width, texture.height);
						this._pixelData = imageData.data;
					}

					// Get alpha value at the pixel (RGBA = 4 bytes per pixel, alpha is 4th byte)
					const pixelIndex = ((texY * texture.width) + texX) * 4;
					const alpha = this._pixelData[pixelIndex + 3];

					return alpha >= this._alphaThreshold;
				}
				catch(err) {
					console.warn("SDX Journal Pins | Pixel-perfect detection failed:", err);
					return inBounds;
				}
			};
		}

		// Add status indicators for GM
		if (game.user?.isGM && this.pinData.requiresVision) {
			await this._addVisionIndicator(container, radius);
		}

		// Performance: Cache pin visual as a single sprite texture
		// Converts PIXI.Graphics draw calls into one batchable Sprite per pin
		// Critical for Chromium/ANGLE on macOS which has high per-draw-call overhead
		if (canvas?.app?.renderer && container.children.length > 0) {
			try {
				// Pre-cache pixel data for pixel-perfect detection before converting
				if (this.hitArea?._sprite && !this.hitArea._pixelCanvas) {
					const ppSprite = this.hitArea._sprite;
					if (ppSprite.texture?.baseTexture?.resource?.source) {
						const source = ppSprite.texture.baseTexture.resource.source;
						const tex = ppSprite.texture;
						const pc = document.createElement("canvas");
						pc.width = tex.width;
						pc.height = tex.height;
						const pctx = pc.getContext("2d");
						pctx.drawImage(source, 0, 0);
						const hitPixels = pctx.getImageData(0, 0, tex.width, tex.height);
						this.hitArea._pixelData = hitPixels.data;
						this.hitArea._pixelCanvas = pc;
					}
				}

				if (this._cachedTexture) {
					this._cachedTexture.destroy(true);
					this._cachedTexture = null;
				}

				const bounds = container.getLocalBounds();
				if (bounds.width > 0 && bounds.height > 0) {
					const texture = canvas.app.renderer.generateTexture(
						container, { resolution: 2 }
					);
					// Guard: only use the cached texture if generation succeeded
					if (texture && texture.valid) {
						const cachedSprite = new PIXI.Sprite(texture);
						cachedSprite.anchor.set(
							-bounds.x / bounds.width, -bounds.y / bounds.height
						);
						this.removeChild(container);
						container.destroy({ children: true });
						this.addChild(cachedSprite);
						this._cachedTexture = texture;
					}
				}
			}
			catch(e) {
				// Keep the raw graphics container if caching fails
			}
		}

		// Apply TMFX filters if present
		if (window.TokenMagic) {
			const filters = this.getFlag("tokenmagic", "filters");
			if (filters) {
				window.TokenMagic._assignFilters(this, filters);
			}
		}
	}

	async _addIcon(container, iconClass, radius, color) {
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
		if (this.destroyed) {
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
		this._icon = new PIXI.Sprite(texture);
		this._icon.anchor.set(0.5);
		this._icon.position.set(0, 0);
		container.addChild(this._icon);
	}

	async _addSvgIcon(container, iconPath, radius, color) {
		// Custom SVGs usually need to be a bit bigger to fill the pin
		const size = radius * 1.3;
		try {
			// Fetch SVG text
			const response = await fetch(iconPath);
			let svgText = await response.text();
			if (this.destroyed) return;

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
			if (this.destroyed) return;

			this._icon = new PIXI.Sprite(texture);
			this._icon.width = size;
			this._icon.height = size;
			this._icon.anchor.set(0.5);
			this._icon.position.set(0, 0);

			// Handle rotation for diamond shape
			const globalStyle = getPinStyle();
			const style = { ...globalStyle, ...(this.pinData.style || {}) };
			if (style.shape === "diamond") {
				this._icon.rotation = -Math.PI / 4;
			}

			container.addChild(this._icon);
		}
		catch(err) {
			console.error(`SDX Journal Pins | Failed to load custom SVG: ${iconPath}`, err);
		}
	}

	async _addVisionIndicator(container, radius) {
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
		if (this.destroyed) {
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

	async update(newData) {
		// Optimization: If data hasn't changed, don't rebuild
		// BUT: Always check TMFX flags if we have them, as shaders might need refresh
		const hasTMFX = !!(this.pinData.flags?.tokenmagic || newData.flags?.tokenmagic);

		if (!hasTMFX && foundry.utils.equals(this.pinData, newData)) {
			return;
		}

		this._removeEventListeners();
		this.pinData = foundry.utils.deepClone(newData);

		// Kill any active GSAP animations before rebuild to prevent
		// stale references to sprites/textures that _build() will destroy
		if (window.gsap) {
			gsap.killTweensOf(this);
			gsap.killTweensOf(this.scale);
		}

		// Rebuild the graphics
		await this._build();

		// Update physical position to match data
		this.position.set(this.pinData.x, this.pinData.y);

		// Refresh TMFX filters from flags
		if (window.TokenMagic && !this.destroyed) {
			const filters = this.getFlag("tokenmagic", "filters");

			window.TokenMagic._clearImgFiltersByPlaceable(this);
			if (filters && Array.isArray(filters) && filters.length > 0) {
				window.TokenMagic._assignFilters(this, filters);
			}
			else {
				this.filters = null;
			}
		}

		this._setupEventListeners();
	}

	// Pointer interactions live in pin-interactions.mjs. These stay as methods
	// because PIXI's off() matches on the (event, handler, context) triple, so
	// attach and detach have to name the same references — and because keeping
	// the seam here leaves the handlers overridable.

	_setupEventListeners() {
		attachPinListeners(this);
	}

	_removeEventListeners() {
		detachPinListeners(this);
	}

	_onPointerEnter(event) {
		onPointerEnter(this, event);
	}

	_onPointerLeave(event) {
		onPointerLeave(this, event);
	}

	_onPointerDown(event) {
		onPointerDown(this, event);
	}

	_onPointerMove(event) {
		onPointerMove(this, event);
	}

	async _onPointerUp(event) {
		return await onPointerUp(this, event);
	}

	_openJournal() {
		openPinJournal(this);
	}

	_showContextMenu(event) {
		showPinContextMenu(this, event);
	}

	destroy(options) {
		this._removeEventListeners();
		// Kill GSAP tweens targeting this pin BEFORE tearing down children.
		// Hover/ping animations (incl. the infinite `repeat: -1` pulse) hold
		// references to this PIXI object and its scale vector; without this,
		// destroying a pin mid-animation leaks the tween (and the display
		// object it pins) for the rest of the session.
		if (window.gsap) {
			gsap.killTweensOf(this);
			gsap.killTweensOf(this.scale);
		}
		if (this._labelContainer) {
			this._labelContainer.destroy({ children: true });
			this._labelContainer = null;
		}
		if (this._cachedTexture) {
			this._cachedTexture.destroy(true);
			this._cachedTexture = null;
		}
		super.destroy(options);
	}
}

// ================================================================
// PIN RENDERER
// ================================================================

export class JournalPinRenderer {
	static _container = null;

	static _labelContainer = null;

	static _pins = new Map();

	static initialize(layer) {
		if (this._container) {
			console.log("SDX Journal Pins | Container already initialized");
			return;
		}

		this._container = new PIXI.Container();
		this._container.eventMode = "static";
		this._container.name = "sdx-pins-container";

		layer.addChild(this._container);
		console.log("SDX Journal Pins | Container added to layer");
	}

	/**
     * Initialize on canvas.controls (supports PIXI events)
     */
	static initializeOnInterface() {
		if (this._container) {
			if (this._container.parent) {
				this._container.parent.removeChild(this._container);
			}
			this._container.destroy();
			this._container = null;
		}

		this._container = new PIXI.Container();
		this._container.eventMode = "static";
		this._container.name = "sdx-pins-container";

		// Use canvas.controls which supports PIXI pointer events
		if (canvas?.controls) {
			canvas.controls.addChild(this._container);

			this._labelContainer = new PIXI.Container();
			this._labelContainer.name = "sdx-pins-label-container";
			this._labelContainer.eventMode = "none";
			this._labelContainer.interactiveChildren = false;
			canvas.controls.addChild(this._labelContainer);

			console.log("SDX Journal Pins | Containers added to canvas.controls");
		}
	}

	static getLabelContainer() {
		return this._labelContainer;
	}

	static getContainer() {
		return this._container;
	}

	static loadScenePins(sceneId, pins, { visibilityOnly = false } = {}) {
		if (!this._container) {
			console.warn("SDX Journal Pins | Container not initialized");
			return;
		}

		// If no pins, clear all
		if (!pins || pins.length === 0) {
			this.clear();
			console.log("SDX Journal Pins | Cleared all pins for scene", sceneId);
			return;
		}

		// Filter valid/visible pins
		const incomingPins = pins.filter(pin => checkPinVisibility(pin));
		const incomingIds = new Set(incomingPins.map(p => p.id));

		// 1. Remove pins that are no longer present or visible
		for (const [id] of this._pins.entries()) {
			if (!incomingIds.has(id)) {
				this.removePin(id);
			}
		}

		// 2. Add or Update pins
		for (const pinData of incomingPins) {
			if (visibilityOnly) {
				// Only add pins that are newly visible; skip already-rendered ones
				if (!this._pins.has(pinData.id)) {
					this._addPinGraphics(pinData);
				}
			}
			else {
				this.updatePin(pinData); // updatePin handles adding if missing
			}
		}
	}

	static _addPinGraphics(pinData) {
		if (this._pins.has(pinData.id)) {
			this.updatePin(pinData);
			return;
		}

		if (!this._container) {
			console.warn("SDX Journal Pins | Cannot add pin - container not initialized");
			return;
		}

		// We create the graphics object but defer the build-intensive parts
		// or ensure it's indexed BEFORE any TMFX logic triggers lookups
		const graphics = new JournalPinGraphics(pinData);

		// Critical: Register in map BEFORE adding to container or any logic that might trigger TMFX
		// calculatePadding
		this._pins.set(pinData.id, graphics);

		// Now add to container
		this._container.addChild(graphics);

		// 4. Trigger initialization (async)
		graphics.init().catch(err => {
			console.error(`SDX Journal Pins | Error initializing pin ${pinData.id}:`, err);
		});

		console.log(`SDX Journal Pins | Added pin ${pinData.id} at (${pinData.x}, ${pinData.y})`);
	}

	static addPin(pinData) {
		this._addPinGraphics(pinData);
	}

	static getPin(pinId) {
		return this._pins.get(pinId);
	}

	static updatePin(pinData) {
		const existing = this._pins.get(pinData.id);

		// Handle visibility changes for non-GM users
		if (!game.user?.isGM) {
			if (pinData.gmOnly) {
				// Pin became GM-only, remove it for non-GM
				if (existing) {
					this.removePin(pinData.id);
				}
				return;
			}
			else if (!existing) {
				// Pin became visible, add it for non-GM
				this._addPinGraphics(pinData);
				return;
			}
		}

		if (existing) {
			existing.update(pinData);
		}
		else {
			this._addPinGraphics(pinData);
		}
	}

	static removePin(pinId) {
		const pin = this._pins.get(pinId);
		if (pin) {
			if (pin.parent) pin.parent.removeChild(pin);
			pin.destroy();
			this._pins.delete(pinId);
		}
	}

	static clear() {
		for (const pin of this._pins.values()) {
			if (pin.parent) pin.parent.removeChild(pin);
			pin.destroy();
		}
		this._pins.clear();
	}

	static cleanup() {
		this.clear();
		if (this._container) {
			this._container.destroy();
			this._container = null;
		}
		if (this._labelContainer) {
			this._labelContainer.destroy();
			this._labelContainer = null;
		}
	}
}
