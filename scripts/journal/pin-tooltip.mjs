// Journal pin hover tooltip — extracted from scripts/journal/pin-rendering.mjs
// (Phase 5.3.5 split).
//
// Moved out ahead of the interaction cluster: the pointer handlers show and
// hide this, so leaving it in pin-rendering.mjs would have forced
// pin-interactions.mjs to import back into the module that imports it. A leaf
// module here means no cycle.

import { getPinStyle } from "./pin-style.mjs";

export class JournalPinTooltip {
	static _element = null;

	static show(pinData, event) {
		this.hide();

		const journal = game.journal.get(pinData.journalId);
		let page = null;
		let hasAccess = true;

		if (journal) {
			// Get the page first
			if (pinData.pageId) {
				page = journal.pages.get(pinData.pageId);
			}
			else {
				page = journal.pages.contents[0];
			}

			if (page) {
				// Check if user has at least LIMITED permission on the PAGE
				hasAccess = game.user?.isGM || page.testUserPermission(game.user, "LIMITED");
			}
		}

		// If no access to the journal page AND no custom title/content, nothing to show
		if (!hasAccess && !pinData.tooltipTitle && !pinData.tooltipContent) return;

		// If no journal/page and no custom text, nothing to show
		if (!page && !pinData.tooltipTitle && !pinData.tooltipContent) return;

		// Clear page reference if user has no access (custom text will still show)
		if (!hasAccess) page = null;

		let content = "";
		let title = page?.name || "Unlinked Pin";

		// Use custom tooltip title if provided
		if (pinData.tooltipTitle) {
			title = pinData.tooltipTitle;
		}

		// For content, we need at least OBSERVER permission on the PAGE to see text
		// If no page, we rely on custom content (always visible if pin is visible)
		const canSeeContent = !page || game.user?.isGM || page.testUserPermission(
			game.user, "OBSERVER"
		);

		// Use custom tooltip content if provided, otherwise use page content
		if (pinData.tooltipContent) {
			content = pinData.tooltipContent;
		}
		else if (canSeeContent && page?.text?.content) {
			const temp = document.createElement("div");
			temp.innerHTML = page.text.content;
			content = temp.textContent?.substring(0, 200) || "";
			if (content.length >= 200) content += "...";
		}

		// If no content and title is generic "Unlinked Pin" (and no custom title), maybe don't
		// show?
		// But we might want to just show the title.


		this._element = document.createElement("div");
		this._element.id = "sdx-journal-pin-tooltip";
		this._element.className = "sdx-journal-pin-tooltip";
		// Tooltip text sizes come from the pin's resolved style (global default
		// merged with any per-pin override), applied inline to override the CSS.
		const tStyle = { ...getPinStyle(), ...(pinData.style || {}) };
		const titlePx = tStyle.tooltipTitleFontSize || 17;
		const bodyPx = tStyle.tooltipContentFontSize || 13;
		this._element.innerHTML = `
            <div class="sdx-journal-pin-tooltip-title" style="font-size:${titlePx}px">${title}</div>
            ${content ? `<div class="sdx-journal-pin-tooltip-content" style="font-size:${bodyPx}px">${content}</div>` : ""}
        `;

		// Calculate position BEFORE appending to prevent flash at top-left
		const globalPoint = event.global;
		const canvasRect = canvas.app.view.getBoundingClientRect();
		let tooltipX = canvasRect.left + (globalPoint?.x || 0) + 15;
		let tooltipY = canvasRect.top + (globalPoint?.y || 0) + 15;

		// Set initial position (will be adjusted after we know the size)
		this._element.style.left = `${tooltipX}px`;
		this._element.style.top = `${tooltipY}px`;
		this._element.style.visibility = "hidden"; // Hide until positioned

		document.body.appendChild(this._element);

		// Adjust if overflowing viewport
		const rect = this._element.getBoundingClientRect();
		if (tooltipX + rect.width > window.innerWidth) {
			tooltipX = window.innerWidth - rect.width - 10;
		}
		if (tooltipY + rect.height > window.innerHeight) {
			tooltipY = window.innerHeight - rect.height - 10;
		}

		this._element.style.left = `${tooltipX}px`;
		this._element.style.top = `${tooltipY}px`;
		this._element.style.visibility = "visible"; // Show after positioned
	}

	static hide() {
		if (this._element) {
			this._element.remove();
			this._element = null;
		}
	}
}
