import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Dragging the shadowdark-crawl-helper lights-out carousel.
 *
 * Extracted from the composition root in Phase 3. Compatibility code for a
 * third-party module, kept in canvas/ because it is DOM drag handling on a
 * canvas-adjacent HUD element, and because shared/ takes a helper at its
 * second consumer — this has one.
 *
 * CARRIES A REGISTRATION. The Hooks.once inside `initCarouselDrag` installs
 * when the function is CALLED, not when this module is evaluated, so its
 * order relative to every other registration is decided by the root's call
 * site. Do not make this a module-eval side effect.
 *
 * NOT A RELEASE GATE — owner decision, 2026-07-31. This was a Phase 4
 * release-readiness row to be cleared by enabling `shadowdark-crawl-helper` and
 * dragging the carousel. That instruction is withdrawn: the maintainer's world
 * runs Shadowdark Enhancer, which ships its own crawl and a "Warn when
 * shadowdark-crawl-helper is enabled" setting, so enabling it purely to satisfy
 * a gate would create the conflict Enhancer warns about.
 *
 * This file and `combat/crawl-helper-death-timer.mjs` are the only SDX code
 * that touches crawl-helper. Both are kept as BEST-EFFORT THIRD-PARTY SUPPORT
 * the maintainer cannot verify, and neither blocks a release. Nothing here
 * registers a setting or joins `module.api`, and the saved position is a
 * `localStorage` key rather than world data, so a world without crawl-helper
 * carries no state from this file. The risk is acknowledged rather than hidden:
 * unexercised integration code is how KNOWN-ISSUES 14 happened. Revisit in the
 * Phase 5.2 dead-code pass.
 */

// ============================================
// LIGHTS-OUT CAROUSEL DRAG FUNCTIONALITY
// ============================================

/**
 * Make the lights-out-carousel from shadowdark-crawl-helper draggable
 * Uses a dedicated drag handle icon
 */
export function initCarouselDrag() {
	const STORAGE_KEY = "sdx-carousel-position";
	let isDragging = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let carouselStartX = 0;
	let carouselStartY = 0;
	let hasMoved = false;

	// Create and inject the drag handle button
	function injectDragHandle(carousel) {
		// Check if already injected
		if (carousel.querySelector(".sdx-carousel-drag-btn")) return;

		// Find the first side-buttons container (top one with roll-all button)
		const sideButtons = carousel.querySelector(".side-buttons");
		if (!sideButtons) return;

		// Find the roll-all button to insert before it
		const rollAllBtn = sideButtons.querySelector("#rollAllInit");
		if (!rollAllBtn) return;

		// Create drag handle button
		const dragBtn = document.createElement("button");
		dragBtn.className = "ui-control icon fas fa-grip-vertical sdx-carousel-drag-btn";
		dragBtn.dataset.tooltip = "Drag to move carousel";
		dragBtn.type = "button";

		// Insert before roll-all button
		rollAllBtn.parentNode.insertBefore(dragBtn, rollAllBtn);

		// Attach drag handler
		dragBtn.addEventListener("mousedown", e => {
			if (e.button !== 0) return;

			isDragging = true;
			hasMoved = false;
			dragStartX = e.clientX;
			dragStartY = e.clientY;

			const currentCarousel = document.querySelector("#actorCarousel.lights-out-carousel");
			if (currentCarousel) {
				const rect = currentCarousel.getBoundingClientRect();
				carouselStartX = rect.left;
				carouselStartY = rect.top;
			}

			dragBtn.classList.add("sdx-carousel-dragging");
			document.body.style.userSelect = "none";
			e.preventDefault();
		});
	}

	// Setup drag on the carousel
	function setupCarouselDrag(carousel) {
		if (!carousel) return;

		// Don't restore position if actively dragging
		if (!isDragging) {
			// Always restore saved position (carousel may have been re-positioned by the app)
			const savedPos = localStorage.getItem(STORAGE_KEY);
			if (savedPos) {
				try {
					const { left, top } = JSON.parse(savedPos);
					// Only apply if position differs (avoid unnecessary style changes)
					const currentLeft = parseInt(carousel.style.left) || 0;
					const currentTop = parseInt(carousel.style.top) || 0;
					if (Math.abs(currentLeft - left) > 5 || Math.abs(currentTop - top) > 5) {
						carousel.style.left = `${left}px`;
						carousel.style.top = `${top}px`;
					}
				}
				catch(e) {
					console.warn("shadowdark-extras | Failed to restore carousel position:", e);
				}
			}
		}

		// Inject drag handle if not present
		injectDragHandle(carousel);
	}

	// Global mouse move handler
	document.addEventListener("mousemove", e => {
		if (!isDragging) return;

		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;

		// Only start moving after a small threshold to allow clicks
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
			hasMoved = true;

			const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
			if (carousel) {
				const newLeft = carouselStartX + dx;
				const newTop = carouselStartY + dy;
				carousel.style.left = `${newLeft}px`;
				carousel.style.top = `${newTop}px`;
			}
		}
	});

	// Global mouse up handler
	document.addEventListener("mouseup", () => {
		if (!isDragging) return;

		isDragging = false;
		document.body.style.userSelect = "";

		// Remove dragging class from all portraits
		document.querySelectorAll(".sdx-carousel-dragging").forEach(el => {
			el.classList.remove("sdx-carousel-dragging");
		});

		// Save position if moved
		if (hasMoved) {
			const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
			if (carousel) {
				const rect = carousel.getBoundingClientRect();
				localStorage.setItem(STORAGE_KEY, JSON.stringify({
					left: rect.left,
					top: rect.top,
				}));
			}
		}
	});

	// Watch for carousel to appear using MutationObserver
	const observer = new MutationObserver(mutations => {
		// Check for carousel and setup any new portraits
		const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
		if (carousel) {
			setupCarouselDrag(carousel);
		}
	});

	// Observe the scene-controls area where the carousel is inserted
	Hooks.once("ready", () => {
		// Check if shadowdark-crawl-helper is enabled
		if (!game.modules.get("shadowdark-crawl-helper")?.active) return;

		// Start observing
		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		// Also try to setup on any existing carousel
		const carousel = document.querySelector("#actorCarousel.lights-out-carousel");
		if (carousel) {
			setupCarouselDrag(carousel);
		}

		console.log(`${MODULE_ID} | Carousel drag functionality initialized`);
	});
}
