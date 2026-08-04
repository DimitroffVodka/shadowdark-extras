/**
 * Save scroll positions of tile grids and other UI state
 * @param {TrayApp} app - The tray application instance
 */
export function saveTrayScrollPositions(app) {
	// Can't query inside this.element because it might not be rendered/attached yet in the way we
	// expect if we use standard AppV2 accessors,
	// but for now we look at the DOM since we are doing a re-render
	const elem = document.querySelector(".sdx-tray");
	if (!elem) return;

	// Save scroll position of the main hex tile scroll container
	const hexTileScroll = elem.querySelector(".hex-tile-scroll");
	if (hexTileScroll) {
		app._scrollPositions["hex-tile-scroll"] = hexTileScroll.scrollTop;
	}

	// Save scroll position of the dungeon tile scroll container
	const dungeonTileScroll = elem.querySelector(".dungeon-tile-scroll");
	if (dungeonTileScroll) {
		app._scrollPositions["dungeon-tile-scroll"] = dungeonTileScroll.scrollTop;
	}

	// Save scroll position of the decor tile scroll container
	const decorTileScroll = elem.querySelector(".decor-tile-scroll");
	if (decorTileScroll) {
		app._scrollPositions["decor-tile-scroll"] = decorTileScroll.scrollTop;
	}

	// Also save individual grid scroll positions if needed
	elem.querySelectorAll(".hex-tile-grid").forEach(grid => {
		const key = grid.dataset.tilePanel;
		if (key) {
			app._scrollPositions[key] = grid.scrollTop;
		}
	});

	// Save procedural generator panel expanded state
	const generatorControls = elem.querySelector(".hex-generator-controls");
	if (generatorControls) {
		app._generatorExpanded = !generatorControls.classList.contains("hidden");
	}
}

/**
 * Restore scroll positions of tile grids and other UI state
 * @param {TrayApp} app - The tray application instance
 */
export function restoreTrayScrollPositions(app) {
	const elem = document.querySelector(".sdx-tray");
	if (!elem) return;

	// Restore main hex tile scroll container position
	const hexTileScroll = elem.querySelector(".hex-tile-scroll");
	if (hexTileScroll && app._scrollPositions["hex-tile-scroll"] !== undefined) {
		hexTileScroll.scrollTop = app._scrollPositions["hex-tile-scroll"];
	}

	// Restore dungeon tile scroll container position
	const dungeonTileScroll = elem.querySelector(".dungeon-tile-scroll");
	if (dungeonTileScroll && app._scrollPositions["dungeon-tile-scroll"] !== undefined) {
		dungeonTileScroll.scrollTop = app._scrollPositions["dungeon-tile-scroll"];
	}

	// Restore decor tile scroll container position
	const decorTileScroll = elem.querySelector(".decor-tile-scroll");
	if (decorTileScroll && app._scrollPositions["decor-tile-scroll"] !== undefined) {
		decorTileScroll.scrollTop = app._scrollPositions["decor-tile-scroll"];
	}

	// Restore individual grid scroll positions
	elem.querySelectorAll(".hex-tile-grid").forEach(grid => {
		const key = grid.dataset.tilePanel;
		if (key && app._scrollPositions[key] !== undefined) {
			grid.scrollTop = app._scrollPositions[key];
		}
	});

	// Restore procedural generator panel expanded state
	const generatorControls = elem.querySelector(".hex-generator-controls");
	if (generatorControls && app._generatorExpanded) {
		generatorControls.classList.remove("hidden");
	}
}
