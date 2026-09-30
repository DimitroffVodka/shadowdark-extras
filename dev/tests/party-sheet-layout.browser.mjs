// Browser-only regression; run in a v14 client with a rendered PartySheetSD.
// Invoke verifyPartySheetLayout(sheet). Node mocks cannot prove CSS geometry.
export async function verifyPartySheetLayout(sheet) {
	const originalPosition = { ...sheet.position };
	const originalTab = sheet.tabGroups.primary;
	const results = [];
	const assert = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	const textFits = (element, container, label) => {
		const bounds = container.getBoundingClientRect();
		for (const node of element.childNodes) {
			if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			for (const rect of range.getClientRects()) {
				if (!rect.width) continue;
				assert(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1
					&& rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
				`${label}: text escapes its control`);
			}
		}
	};
	try {
		await document.fonts.ready;
		for (const width of [680, 750, 1200]) {
			sheet.setPosition({ width });
			const root = sheet.element;
			const title = root.querySelector(".party-title input");
			const titleStyle = getComputedStyle(title);
			const textHeight = title.clientHeight - parseFloat(titleStyle.paddingTop)
				- parseFloat(titleStyle.paddingBottom);
			assert(textHeight >= parseFloat(titleStyle.lineHeight) - 1,
				`${width}: party name is clipped inside the input`);
			const nav = root.querySelector(".SD-nav");
			const body = root.querySelector(".SD-content-body");
			const tabs = [...nav.querySelectorAll(".navigation-tab")];
			assert(nav.scrollHeight <= nav.clientHeight + 1, `${width}: tabs overflow vertically`);
			assert(nav.scrollWidth <= nav.clientWidth + 1, `${width}: tabs overflow horizontally`);
			for (const tab of tabs) {
				textFits(tab, tab, `${width} ${tab.dataset.tab}`);
				const icon = tab.querySelector("i").getBoundingClientRect();
				const bounds = tab.getBoundingClientRect();
				assert(icon.top >= bounds.top && icon.bottom <= bounds.bottom,
					`${width} ${tab.dataset.tab}: icon escapes its tab`);
			}
			for (const tab of tabs) {
				sheet.changeTab(tab.dataset.tab, "primary");
				assert(root.querySelectorAll(".SD-content-body > .tab.active").length === 1,
					`${width}: exactly one tab body must be active`);
				assert(body.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom - 1,
					`${width}: navigation overlaps the content`);
				assert(body.scrollWidth <= body.clientWidth + 1,
					`${width} ${tab.dataset.tab}: content overflows horizontally`);
				const buttons = [...root.querySelectorAll(".tab.active .party-actions button")];
				for (const button of buttons) {
					textFits(button, button, `${width} ${button.dataset.action}`);
					assert(button.scrollHeight <= button.clientHeight + 1,
						`${width} ${button.dataset.action}: label overflows vertically`);
				}
				if (buttons.length > 1) {
					const first = buttons[0].getBoundingClientRect();
					for (const button of buttons) {
						const bounds = button.getBoundingClientRect();
						assert(Math.abs(bounds.top - first.top) <= 1
							&& Math.abs(bounds.height - first.height) <= 1,
						`${width}: action tiles are not aligned`);
					}
				}
				results.push({ width, tab: tab.dataset.tab, buttons: buttons.length });
			}
		}
		return { passed: results.length, results };
	}
	finally {
		sheet.setPosition(originalPosition);
		sheet.changeTab(originalTab, "primary");
	}
}
