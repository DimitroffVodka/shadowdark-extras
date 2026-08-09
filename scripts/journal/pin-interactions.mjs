// Journal pin pointer interactions — extracted from the JournalPinGraphics
// class in scripts/journal/pin-rendering.mjs (Phase 5.3.5 split).
//
// Hover, drag, release, journal opening and the context menu. Each function
// takes the pin as its first argument instead of reading `this`, so the policy
// lives here while pin-rendering.mjs keeps only the build/draw lifecycle.
//
// Listener registration deliberately uses the pin's own bound methods
// (pin._onPointerEnter, ...) rather than these functions: PIXI's off() matches
// on the (event, handler, context) triple, so attach and detach must name the
// same references. Routing through the methods also keeps them overridable.

import { JournalPinTooltip } from "./pin-tooltip.mjs";
import { JournalPinManager } from "./pin-manager.mjs";
import { renderPinContextMenu } from "./pin-context-menu.mjs";
import { getPinStyle } from "./pin-style.mjs";

/** Subscribe the standing pointer listeners. globalpointermove is not one of
 *  them — it is added only for the duration of a drag. */
export function attachPinListeners(pin) {
	pin.on("pointerenter", pin._onPointerEnter, pin);
	pin.on("pointerleave", pin._onPointerLeave, pin);
	pin.on("pointerdown", pin._onPointerDown, pin);
	pin.on("pointerup", pin._onPointerUp, pin);
	pin.on("pointerupoutside", pin._onPointerUp, pin);
}

/** Release everything, including the drag-only globalpointermove, which may
 *  still be attached if teardown happens mid-drag. */
export function detachPinListeners(pin) {
	pin.off("pointerenter", pin._onPointerEnter, pin);
	pin.off("pointerleave", pin._onPointerLeave, pin);
	pin.off("pointerdown", pin._onPointerDown, pin);
	pin.off("pointerup", pin._onPointerUp, pin);
	pin.off("pointerupoutside", pin._onPointerUp, pin);
	pin.off("globalpointermove", pin._onPointerMove, pin);
}

export function onPointerEnter(pin, event) {
	// Merge global highlight defaults for style reads (per-pin blanks inherit highlight tint/ring)
	const _gs = getPinStyle();
	const _ps = pin.pinData.style || {};
	const style = { ..._gs, ..._ps };
	// Per-pin blank highlight values must inherit global — flip blanks back
	if (!_ps.hoverImageTint) style.hoverImageTint = _gs.hoverImageTint;
	if (!_ps.hoverRingColor) style.hoverRingColor = _gs.hoverRingColor;
	if (_ps.hoverRingWidth == null || String(_ps.hoverRingWidth) === "" || (style.hoverAnimation === "highlight" && Number(_ps.hoverRingWidth) === 0)) style.hoverRingWidth = _gs.hoverRingWidth;
	// Also keep pinData flags at top-level level
	const hideTooltip = pin.pinData.hideTooltip || style.hideTooltip || false;

	if (!hideTooltip) {
		JournalPinTooltip.show(pin.pinData, event);
	}
	if (pin._labelContainer && style.labelShowOnHover) {
		pin._labelContainer.visible = true;
	}

	// Highlight hover — tint + border (image pins only, when hoverAnimation is "highlight")
	// Other hover modes (scale/pulse/shake/brightness/hue) don't tint. Default is "highlight".
	try {
		const isHighlight = style.hoverAnimation === "highlight";
		if (!isHighlight) throw Object.assign(new Error("__skip_highlight__"), {__sdxSkipHighlight:true});
		const spr = pin._imageSprite;
		if (spr && spr._sdxHoverTint) {
			if (window.gsap) gsap.killTweensOf(spr);
			if (window.gsap) gsap.to(spr, { pixi: { tint: Number(spr._sdxHoverTint) }, duration: 0.18, ease: "power2.out" });
			else spr.tint = Number(spr._sdxHoverTint);
		}
		// Border lives on the sprite in raw mode; in cached mode the
		// container is replaced by a texture, so we apply a color-matrix
		// tint to the whole pin instead and keep a PIXI.Graphics border
		// as a separate child of the pin (not the cached container).
			const bw = (() => {
			const v = Number(style.hoverRingWidth);
			if (Number.isFinite(v) && v > 0) return v;
			// Highlight pins with 0/blank inherit the global highlight width
			if (style.hoverAnimation === "highlight") return Number(_gs.hoverRingWidth) || 6;
			return 0;
		})();
		if (bw > 0) {
			if (spr?._sdxHoverBorder) {
				spr._sdxHoverBorder.visible = true;
			}
			else if (pin._cachedTexture) {
				// Cached path: no live Graphics border — add one now on the pin
				if (!pin._sdxHoverBorderCached) {
					try {
						const effCol = (style.hoverRingColor && style.hoverRingColor !== "") ? style.hoverRingColor : "#ff7a00";
						const c = foundry.utils.Color.from(effCol);
						if (c.valid) {
							const g = new PIXI.Graphics();
							g.lineStyle(bw, Number(c), 1);
							const b = pin.getLocalBounds();
							const r = Math.max(6, Math.min(14, Math.round(b.width * 0.18)));
							g.drawRoundedRect(-b.width/2, -b.height/2, b.width, b.height, r);
							g.endFill();
							g._sdxHover = true;
							pin._sdxHoverBorderCached = g;
							pin.addChildAt(g, 0);
						}
					} catch(e) {}
				}
				if (pin._sdxHoverBorderCached) pin._sdxHoverBorderCached.visible = true;
			}
		}
	} catch(e) { if (e?.__sdxSkipHighlight) {/* not highlight — no tint/border */} }

	// Hover Animation
	let animType = style.hoverAnimation;
	if (animType === true) animType = "scale";
	if (!animType) animType = "none";

	if (animType !== "none" && window.gsap) {
		gsap.killTweensOf(pin);
		gsap.killTweensOf(pin.scale);

		if (animType === "scale") {
			gsap.to(pin.scale, { x: 1.2, y: 1.2, duration: 0.3, ease: "back.out(1.7)" });
		}
		else if (animType === "pulse") {
			gsap.to(
				pin.scale,
				{ x: 1.15, y: 1.15, duration: 0.5, yoyo: true, repeat: -1, ease: "sine.inOut" }
			);
		}
		else if (animType === "shake") {
			gsap.to(pin, {
				rotation: 0.2, duration: 0.05, yoyo: true, repeat: 5, ease: "power1.inOut", onComplete: () => {
					gsap.to(pin, { rotation: 0, duration: 0.1 });
				},
			});
			gsap.to(pin.scale, { x: 1.1, y: 1.1, duration: 0.2 });
		}
		else if (animType === "brightness") {
			gsap.to(
				pin,
				{
					pixi: { brightness: 1.5 }, duration: 0.4, yoyo: true, repeat: -1,
					ease: "sine.inOut",
				}
			);
		}
		else if (animType === "hue") {
			gsap.to(
				pin,
				{ pixi: { hue: 180 }, duration: 2, repeat: -1, yoyo: true, ease: "linear" }
			);
		}
	}
}

export function onPointerLeave(pin, event) {
	JournalPinTooltip.hide();
	if (pin._labelContainer && pin.pinData.style?.labelShowOnHover) {
		pin._labelContainer.visible = false;
	}

	// Highlight tint + border reset (uses same merged style so reset matches enter)
	try {
		const spr = pin._imageSprite;
		if (spr && spr._sdxBaseTint != null) {
			if (window.gsap) gsap.killTweensOf(spr);
			if (window.gsap) gsap.to(spr, { pixi: { tint: spr._sdxBaseTint }, duration: 0.18, ease: "power2.out" });
			else spr.tint = spr._sdxBaseTint;
		}
		if (spr?._sdxHoverBorder) spr._sdxHoverBorder.visible = false;
		if (pin._sdxHoverBorderCached) pin._sdxHoverBorderCached.visible = false;
	} catch(e) { if (e?.__sdxSkipHighlight) {/* not highlight — no tint/border */} }

	// Hover Animation Reset
	if (window.gsap) {
		gsap.killTweensOf(pin);
		gsap.killTweensOf(pin.scale);

		// Smooth reset
		gsap.to(pin.scale, { x: 1.0, y: 1.0, duration: 0.3, ease: "power2.out" });
		gsap.to(
			pin,
			{ rotation: 0, pixi: { brightness: 1, hue: 0 }, duration: 0.3, ease: "power2.out" }
		);
	}
	else {
		pin.scale.set(1.0);
		pin.rotation = 0;
	}
}

export function onPointerDown(pin, event) {
	const originalEvent = event.data?.originalEvent || event.nativeEvent || event;
	const button = originalEvent.button ?? 0;

	// Restriction: Only GMs can drag or right-click pins
	const isGm = game.user?.isGM;

	if (button === 0) {
		// Prevent Foundry from starting a selection marquee
		event.stopPropagation();

		if (isGm) {
			pin._isDragging = true;
			pin._hasDragged = false;

			// Kill hover animations immediately when starting a drag.
			// This prevents GSAP from holding stale sprite references
			// during the subsequent update() → _build() on pointer up.
			if (window.gsap) {
				gsap.killTweensOf(pin);
				gsap.killTweensOf(pin.scale);
				pin.scale.set(1.0);
				pin.rotation = 0;
			}

			const local = pin.parent.toLocal(event.global);
			pin._dragOffset.x = pin.position.x - local.x;
			pin._dragOffset.y = pin.position.y - local.y;
			pin._dragStartPos.x = pin.position.x;
			pin._dragStartPos.y = pin.position.y;
			pin.on("globalpointermove", pin._onPointerMove, pin);
		}
		JournalPinTooltip.hide();
	}
	else if (button === 2) {
		event.stopPropagation();
		if (isGm) {
			pin._showContextMenu(event);
		}
	}
}

export function onPointerMove(pin, event) {
	if (!pin._isDragging) return;

	event.stopPropagation();
	const local = pin.parent.toLocal(event.global);
	const newX = local.x + pin._dragOffset.x;
	const newY = local.y + pin._dragOffset.y;

	const dx = Math.abs(newX - pin._dragStartPos.x);
	const dy = Math.abs(newY - pin._dragStartPos.y);
	if (dx > 5 || dy > 5) {
		pin._hasDragged = true;
	}

	if (pin._hasDragged) {
		pin.position.x = newX;
		pin.position.y = newY;

		// Update label position if it exists and is separated
		if (pin._labelContainer && pin._labelContainer.parent !== pin) {
			pin._labelContainer.position.set(
				newX + pin._labelOffset.x, newY + pin._labelOffset.y
			);
		}
	}
}

export async function onPointerUp(pin, event) {
	if (pin._isDragging) {
		event.stopPropagation();

		if (pin._hasDragged) {
			// Save position
			try {
				await JournalPinManager.update(pin.pinData.id, {
					x: Math.round(pin.position.x),
					y: Math.round(pin.position.y),
				});
			}
			catch(err) {
				console.error("SDX Journal Pins | Error updating pin position:", err);
				pin.position.set(pin.pinData.x, pin.pinData.y);
			}
		}
		else {
			pin._openJournal();
		}
	}

	pin.off("globalpointermove", pin._onPointerMove, pin);
	pin._isDragging = false;
	pin._hasDragged = false;
}

export function openPinJournal(pin) {
	const journal = game.journal.get(pin.pinData.journalId);
	if (journal) {
		if (pin.pinData.pageId) {
			journal.sheet.render(true, { pageId: pin.pinData.pageId });
		}
		else {
			journal.sheet.render(true);
		}
	}
	else {
		ui.notifications.warn("Journal not found");
	}
}

export function showPinContextMenu(pin, event) {
	const originalEvent = event.data?.originalEvent || event.nativeEvent || event;
	if (originalEvent.preventDefault) originalEvent.preventDefault();

	const globalPoint = event.global;
	const canvasRect = canvas.app.view.getBoundingClientRect();
	const menuX = canvasRect.left + (globalPoint?.x || 0);
	const menuY = canvasRect.top + (globalPoint?.y || 0);

	const menuItems = [
		{
			name: "Open Journal",
			icon: '<i class="fa-solid fa-book-open"></i>',
			callback: () => pin._openJournal(),
		},
		{
			name: "Bring Players Here",
			icon: '<i class="fa-solid fa-location-crosshairs"></i>',
			callback: async () => {
				if (game.user.isGM) {
					// Broadcast to others
					game.socket.emit("module.shadowdark-extras", {
						type: "panToPin",
						x: pin.pinData.x,
						y: pin.pinData.y,
						sceneId: canvas.scene?.id,
						pinId: pin.pinData.id,
					});
					// Pan self
					canvas.animatePan({ x: pin.pinData.x, y: pin.pinData.y });

					if (pin.animatePing) {
						pin.animatePing("bring");
					}
					else if (canvas.ping) {
						canvas.ping({ x: pin.pinData.x, y: pin.pinData.y });
					}
				}
				else {
					ui.notifications.warn("Only the GM can bring players here.");
				}
			},
		},
		{
			name: "Ping Pin",
			icon: '<i class="fa-solid fa-bullseye"></i>',
			callback: async () => {
				// Broadcast ping only, no pan
				if (game.user.isGM) {
					game.socket.emit("module.shadowdark-extras", {
						type: "pingPin",
						sceneId: canvas.scene?.id,
						pinId: pin.pinData.id,
					});
					if (pin.animatePing) pin.animatePing();
				}
				else {
					ui.notifications.warn("Only the GM can ping pins.");
				}
			},
		},
		{
			name: "Edit Style",
			icon: '<i class="fa-solid fa-palette"></i>',
			callback: async () => {
				const { PinStyleEditorApp } = await import("./PinStyleEditorSD.mjs");
				new PinStyleEditorApp({ pinId: pin.pinData.id }).render(true);
			},
		},
		{
			name: "Duplicate Pin",
			icon: '<i class="fa-solid fa-clone"></i>',
			callback: async () => await JournalPinManager.duplicate(pin.pinData.id),
		},
	];

	if (game.user?.isGM) {
		menuItems.push({
			name: "Copy Style",
			icon: '<i class="fa-solid fa-copy"></i>',
			callback: () => JournalPinManager.copyStyle(pin.pinData),
		});

		if (JournalPinManager.hasCopiedStyle()) {
			menuItems.push({
				name: "Paste Style",
				icon: '<i class="fa-solid fa-paste"></i>',
				callback: async () => await JournalPinManager.pasteStyle(pin.pinData.id),
			});
		}

		// Toggle visibility option
		const isGmOnly = pin.pinData.gmOnly ?? false;
		menuItems.push({
			name: isGmOnly ? "Make Visible to All" : "Make GM-Only",
			icon: isGmOnly ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>',
			callback: async () => {
				await JournalPinManager.update(pin.pinData.id, { gmOnly: !isGmOnly });
			},
		});

		menuItems.push({
			name: "Delete Pin",
			icon: '<i class="fa-solid fa-trash"></i>',
			callback: async () => await JournalPinManager.delete(pin.pinData.id),
		});
	}

	renderPinContextMenu(menuItems, menuX, menuY);
}
