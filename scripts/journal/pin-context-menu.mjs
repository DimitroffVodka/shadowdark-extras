// Journal pin context menu — extracted from the JournalPinGraphics class in
// scripts/journal/pin-rendering.mjs (Phase 5.3.5 split).
//
// Pure DOM construction: the builder never read `this`, so it moves out as a
// free function. Leaf module: no imports.

/**
 * Build and mount the pin context menu, replacing any menu already open.
 *
 * The dismissal listeners are registered on a short delay so that the same
 * gesture which opened the menu does not immediately close it.
 *
 * @param {Array<{icon: string, name: string, callback: Function}>} menuItems
 *   Rows to render, in order. `icon` is treated as markup.
 * @param {number} x  Viewport x position in pixels.
 * @param {number} y  Viewport y position in pixels.
 */
export function renderPinContextMenu(menuItems, x, y) {
	const existing = document.getElementById("sdx-journal-pin-context-menu");
	if (existing) existing.remove();

	const menu = document.createElement("div");
	menu.id = "sdx-journal-pin-context-menu";
	menu.className = "sdx-journal-pin-context-menu";
	menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10000;`;

	menuItems.forEach(item => {
		const menuItem = document.createElement("div");
		menuItem.className = "sdx-journal-pin-menu-item";
		menuItem.innerHTML = `${item.icon} ${item.name}`;
		menuItem.addEventListener("click", () => {
			item.callback();
			menu.remove();
		});
		menu.appendChild(menuItem);
	});

	document.body.appendChild(menu);

	const closeMenu = (e) => {
		if (!menu.contains(e.target)) {
			menu.remove();
			document.removeEventListener("click", closeMenu);
			document.removeEventListener("keydown", closeOnEscape);
		}
	};
	const closeOnEscape = (e) => {
		if (e.key === "Escape") {
			menu.remove();
			document.removeEventListener("click", closeMenu);
			document.removeEventListener("keydown", closeOnEscape);
		}
	};

	setTimeout(() => {
		document.addEventListener("click", closeMenu);
		document.addEventListener("keydown", closeOnEscape);
	}, 10);
}
