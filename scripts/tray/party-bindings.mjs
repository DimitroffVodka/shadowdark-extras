// Party tab card interactions: single click selects the token, double-click
// centers the canvas on it (works for tokens the user doesn't own), and the
// feather icon opens the actor sheet. Merged via
// Object.assign(TrayApp.prototype, PartyBindings).

import { openTokenSheet, selectToken, centerOnToken } from "./TraySD.mjs";

export const PartyBindings = {
	/**
	 * Bind party card interactions after render
	 */
	_bindPartyEvents(elem) {
		for (const card of elem.querySelectorAll(".party-card")) {
			card.addEventListener("click", e => {
				e.preventDefault();
				const tokenId = card.dataset.tokenId;
				if (tokenId) selectToken(tokenId);
			});
			card.addEventListener("dblclick", e => {
				e.preventDefault();
				const tokenId = card.dataset.tokenId;
				if (tokenId) centerOnToken(tokenId);
			});
		}
		for (const icon of elem.querySelectorAll(".party-card .open-sheet")) {
			icon.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				const tokenId = icon.dataset.tokenId;
				if (tokenId) openTokenSheet(tokenId);
			});
		}
	},
};
