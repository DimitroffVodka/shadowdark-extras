// Party tab card interactions: single click selects the token, double-click
// centers the canvas on it (works for tokens the user doesn't own), and the
// feather icon opens the actor sheet. Merged via
// Object.assign(TrayApp.prototype, PartyBindings).

import { openTokenSheet, selectToken, centerOnToken } from "./TraySD.mjs";
import { createPartyFromSelectedTokens } from "../party/party-from-selection.mjs";

export const PartyBindings = {
	/**
	 * Bind party card interactions after render
	 */
	_bindPartyEvents(elem) {
		const createButton = elem.querySelector('[data-action="create-party-token"]');
		createButton?.addEventListener("click", async e => {
			e.preventDefault();
			e.stopPropagation();
			if (this._partyCreationPending) return;

			createButton.disabled = true;
			createButton.setAttribute?.("aria-busy", "true");
			const pending = Promise.resolve().then(() => createPartyFromSelectedTokens());
			this._partyCreationPending = pending;

			try {
				await pending;
			}
			finally {
				if (this._partyCreationPending === pending) this._partyCreationPending = null;
				createButton.disabled = false;
				createButton.removeAttribute?.("aria-busy");
			}
		});

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
