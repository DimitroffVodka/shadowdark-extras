// Carousing UI and messaging — extracted from CarousingSD.mjs (Phase 5.3
// split). Dice So Nice rolls, the broadcast roll announcement and its socket,
// player toasts, sheet refreshes, and the character-sheet button injection.

import { MODULE_ID, getCarousingJournal } from "./carousing-core.mjs";

/**
 * Show a roll with Dice So Nice using custom appearance
 * Sets the appearance on the dice options before calling showForRoll
 * @param {Roll} roll - The evaluated Roll object
 * @param {string} type - 'outcome', 'benefit', or 'mishap'
 */
export async function showDSNRoll(roll, type = "outcome") {
	if (!game.dice3d) return;

	const appearances = {
		outcome: { colorset: "black" },           // Black dice for d8 outcome
		benefit: { colorset: "acid" },            // Green dice for benefits
		mishap: { colorset: "fire" },              // Red dice for mishaps
	};

	const appearance = appearances[type] || {};

	// Set appearance directly on each die in the roll
	for (const die of roll.dice) {
		die.options.appearance = appearance;
	}
	await game.dice3d.showForRoll(roll, game.user, true);
}

/**
 * Broadcast a roll announcement to all clients
 * Shows a prominent message like "ROLLING FOR ELBIN!"
 * @param {string} characterName - The character name being rolled for
 */
export function broadcastRollAnnouncement(characterName) {
	const message = `🎲 Rolling for ${characterName}!`;

	// Broadcast to all other clients
	game.socket.emit(`module.${MODULE_ID}`, {
		type: "carousing-roll-announce",
		message: message,
	});

	// Also show locally for the GM
	_showRollAnnouncement(message);
}

/**
 * Show a roll announcement locally (prominent centered message)
 * @param {string} message - The announcement message
 */
export function _showRollAnnouncement(message) {
	// Remove any existing announcement
	const existing = document.querySelector(".sdx-roll-announcement");
	if (existing) existing.remove();

	const announcement = document.createElement("div");
	announcement.className = "sdx-roll-announcement";
	announcement.innerHTML = `<span>${message}</span>`;
	document.body.appendChild(announcement);

	// Auto-remove after 2 seconds
	setTimeout(() => {
		announcement.classList.add("sdx-fade-out");
		setTimeout(() => announcement.remove(), 500);
	}, 2000);
}

/**
 * Initialize the carousing journal update hook
 */
export function initCarousingSocket() {
	Hooks.on("updateJournalEntry", (journal, changes, options, userId) => {
		const carousingJournal = getCarousingJournal();
		if (!carousingJournal || journal.id !== carousingJournal.id) return;

		const flagChanges = changes?.flags?.[MODULE_ID];
		if (!flagChanges) return;

		// Re-render if drops or session changed. ForcedDeletion sentinel
		// appears as a defined value under the actual key (not a "-=" prefix),
		// so this check catches both normal updates and deletions.
		const hasCarousingChange =
            flagChanges.carousingDrops !== undefined
            || flagChanges.carousingGmActors !== undefined
            || flagChanges.carousingSession !== undefined;

		if (hasCarousingChange) {
			rerenderPlayerSheets();
		}
	});

	// Listen for carousing toast notifications from other clients
	game.socket.on(`module.${MODULE_ID}`, data => {
		// Handle carousing toast messages from other users
		if (data.type === "carousing-toast" && data.senderId !== game.user.id) {
			_showCarousingToast(data.message, data.toastType);
		}

		// Handle roll announcement events during GM rolling
		if (data.type === "carousing-roll-announce") {
			_showRollAnnouncement(data.message);
		}
	});

}

/**
 * Show a carousing toast notification locally
 * @param {string} message - The message to display
 * @param {string} type - "benefit", "mishap", or "remove"
 */
export function _showCarousingToast(message, type) {
	let container = document.querySelector(".sdx-carousing-toast-container-global");
	if (!container) {
		container = document.createElement("div");
		container.className = "sdx-carousing-toast-container-global";
		document.body.appendChild(container);
	}

	const toast = document.createElement("div");
	toast.className = `sdx-carousing-toast sdx-toast-${type}`;
	toast.innerHTML = `
        <i class="fas ${type === "benefit" ? "fa-star" : type === "mishap" ? "fa-skull" : "fa-times"}"></i>
        <span>${message}</span>
    `;

	container.appendChild(toast);

	setTimeout(() => {
		toast.classList.add("sdx-toast-fade-out");
		setTimeout(() => toast.remove(), 500);
	}, 3000);
}

/**
 * Re-render all open player sheets and the carousing overlay
 */
export function rerenderPlayerSheets() {
	// Refresh the full-screen overlay if open
	if (window.sdxCarousingOverlayRefresh) {
		window.sdxCarousingOverlayRefresh();
	}

	// Also refresh any old-style player sheets with carousing tabs
	Object.values(ui.windows).forEach(app => {
		if (app.actor?.type === "Player" && app.element?.find) {
			if (app.element.find(".tab-carousing").length > 0) {
				app.render(false);
			}
		}
	});
}

/**
 * Inject the Carousing button into player character sheets
 * Shows a "tongue" button on the side that opens the full-screen overlay
 */
export async function injectCarousingButton(app, html, actor) {
	try {
		if (!game.settings.get(MODULE_ID, "enableCarousing")) return;
	}
	catch{
		return;
	}

	if (actor.type !== "Player") return;

	// Dedup: Remove existing if present
	// app.element is the window app, find the button inside it
	app.element.find(".sdx-carousing-toggle-btn").remove();

	// Create the button
	const buttonHtml = `
        <div class="sdx-carousing-toggle-btn" data-tooltip="${game.i18n.localize("SHADOWDARK_EXTRAS.carousing.title")}">
            <i class="fas fa-beer"></i>
        </div>
    `;

	// Append to the window app wrapper, after the header
	// We use app.element because 'html' in the hook might be just the form content
	const header = app.element.find(".window-header");

	if (header.length > 0) {
		// Remove any existing buttons first (just in case they are in the new location)
		app.element.children(".sdx-carousing-toggle-btn").remove();

		header.after(buttonHtml);

		// Add listener
		app.element.find(".sdx-carousing-toggle-btn").click(event => {
			event.preventDefault();
			event.stopPropagation();
			if (window.sdxOpenCarousingOverlay) {
				window.sdxOpenCarousingOverlay();
			}
		});
	}
}
