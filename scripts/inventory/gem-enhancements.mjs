/**
 * The root's GEM ENHANCEMENTS (Quantity Support) section, moved verbatim.
 *
 * Gem quantity handling in three places, which is why three names are
 * exported: `enhanceGemSheet` from the item-sheet dispatch, `enhanceGemInventory`
 * from the actor-sheet dispatch, and `enhanceGemBag` from the Gem Bag render
 * hook further down the root.
 *
 * inventory/ rather than character-sheet/: the gem bag and gem quantity are an
 * inventory concern, and this folder already owns containers and item slots.
 *
 * Registration-free, and it depends on nothing outside itself. Zero
 * registrations, so the registration snapshot is untouched.
 */

// ============================================
// GEM ENHANCEMENTS (Quantity Support)
// ============================================

/**
 * Inject a quantity field into the Gem item sheet details tab
 */
export function enhanceGemSheet(app, html) {
	const item = app.item || app.document;
	if (!item || item.type !== "Gem") return;

	const $detailsTab = html.find(".tab-details");
	if (!$detailsTab.length) return;

	// Check if quantity field already exists
	if ($detailsTab.find('[name="system.quantity"]').length) return;

	const qty = item.system.quantity ?? 1;

	// Insert quantity box after the cost box
	const $costBox = $detailsTab.find(".SD-box").first();
	if (!$costBox.length) return;

	const qtyHtml = `
		<div class="SD-box sdx-gem-quantity-box">
			<div class="header light">
				<label>quantity</label>
				<span></span>
			</div>
			<div class="content">
				<div class="SD-grid left">
					<input type="number" name="system.quantity" value="${qty}" min="1" placeholder="1" class="sdx-gem-qty-input" />
					<h3>qty</h3>
				</div>
			</div>
		</div>
	`;

	$costBox.after(qtyHtml);
}

/**
 * Enhance the Gem Bag dialog to show quantity column and fix total value/sell
 */
export function enhanceGemBag(app, html) {
	// Detect GemBagSD app by title
	if (!app.title || !app.title.startsWith("Gem Bag:")) return;

	const $html = $(html);
	const actor = app.actor;
	if (!actor) return;

	// Add qty column header
	const $header = $html.find(".SD-list .header").first();
	if (!$header.length) return;
	const $headerValue = $header.find(".flex-60-px");
	if ($headerValue.length && !$header.find(".sdx-gem-qty-col").length) {
		$headerValue.before('<div class="sdx-gem-qty-col">qty</div>');
	}

	// Add qty values to each gem row
	$html.find(".SD-list .item").each(function() {
		const $row = $(this);
		const itemId = $row.data("item-id");
		const item = actor.items.get(itemId);
		if (!item) return;

		const qty = item.system.quantity ?? 1;
		const $valueCol = $row.find(".flex-60-px");
		if ($valueCol.length && !$row.find(".sdx-gem-qty-col").length) {
			$valueCol.before(`<div class="sdx-gem-qty-col">${qty}</div>`);
		}
	});

	// Recalculate total value accounting for quantity
	const gems = actor.items.filter(i => i.type === "Gem");
	let totalGp = 0; let totalSp = 0; let totalCp = 0;
	for (const gem of gems) {
		const qty = gem.system.quantity ?? 1;
		totalGp += gem.system.cost.gp * qty;
		totalSp += gem.system.cost.sp * qty;
		totalCp += gem.system.cost.cp * qty;
	}
	// Convert to single gp value for display (same logic as displayCost helper)
	const totalCostGp = totalGp + (totalSp / 10) + (totalCp / 100);

	// Update the total value display
	const $totalRow = $html.find(".SD-list").last().find(".header");
	const $totalValueCol = $totalRow.find(".flex-60-px");
	if ($totalValueCol.length) {
		$totalValueCol.text(`${totalCostGp} gp`);
	}

	// Add empty qty column to total row to keep alignment
	if ($totalValueCol.length && !$totalRow.find(".sdx-gem-qty-col").length) {
		$totalValueCol.before('<div class="sdx-gem-qty-col"></div>');
	}

	// Override sell-gem to account for quantity
	$html.find("[data-action='sell-gem']").off("click").on("click", async event => {
		event.preventDefault();
		const itemId = $(event.currentTarget).data("item-id");
		const item = actor.getEmbeddedDocument("Item", itemId);
		if (!item) return;

		const confirmHtml = await foundry.applications.handlebars.renderTemplate(
			"systems/shadowdark/templates/dialog/sell-item.hbs",
			{ name: item.name }
		);

		new foundry.applications.api.DialogV2({
			window: { title: game.i18n.localize("SHADOWDARK.dialog.item.confirm_sale") },
			content: confirmHtml,
			buttons: [
				{
					action: "yes",
					icon: "fa fa-check",
					label: game.i18n.localize("SHADOWDARK.dialog.general.yes"),
					default: true,
					callback: async () => {
						const qty = item.system.quantity ?? 1;
						const coins = foundry.utils.deepClone(actor.system.coins);
						coins.gp += item.system.cost.gp * qty;
						coins.sp += item.system.cost.sp * qty;
						coins.cp += item.system.cost.cp * qty;

						await actor.deleteEmbeddedDocuments("Item", [itemId]);
						await Actor.updateDocuments([{
							"_id": actor._id,
							"system.coins": coins,
						}]);

						const remaining = actor.items.filter(i => i.type === "Gem");
						if (remaining.length === 0) {
							app.close();
						}
					},
				},
				{
					action: "cancel",
					icon: "fa fa-times",
					label: game.i18n.localize("SHADOWDARK.dialog.general.cancel"),
				},
			],
		}).render({ force: true });
	});

	// Override sell-all-gems to account for quantity
	$html.find("[data-action='sell-all-gems']").off("click").on("click", async event => {
		event.preventDefault();

		const confirmHtml = await foundry.applications.handlebars.renderTemplate(
			"systems/shadowdark/templates/dialog/sell-all-items.hbs",
			{ name: "Gems" }
		);

		new foundry.applications.api.DialogV2({
			window: { title: game.i18n.localize("SHADOWDARK.dialog.item.confirm_sale") },
			content: confirmHtml,
			buttons: [
				{
					action: "yes",
					icon: "fa fa-check",
					label: game.i18n.localize("SHADOWDARK.dialog.general.yes"),
					default: true,
					callback: async () => {
						const allGems = actor.items.filter(i => i.type === "Gem");
						const coins = foundry.utils.deepClone(actor.system.coins);
						const deleteIds = [];

						for (const gem of allGems) {
							const qty = gem.system.quantity ?? 1;
							coins.gp += gem.system.cost.gp * qty;
							coins.sp += gem.system.cost.sp * qty;
							coins.cp += gem.system.cost.cp * qty;
							deleteIds.push(gem._id);
						}

						await actor.deleteEmbeddedDocuments("Item", deleteIds);
						await Actor.updateDocuments([{
							"_id": actor._id,
							"system.coins": coins,
						}]);

						app.close();
					},
				},
				{
					action: "cancel",
					icon: "fa fa-times",
					label: game.i18n.localize("SHADOWDARK.dialog.general.cancel"),
				},
			],
		}).render({ force: true });
	});
}

/**
 * Fix gem count and slot calculation in the player inventory tab
 * Base system uses gems.length; we need sum of system.quantity
 */
export function enhanceGemInventory(app, html, actor) {
	if (actor.type !== "Player") return;

	const gems = actor.items.filter(i => i.type === "Gem");

	// Calculate total gem count by summing quantities
	let totalGems = 0;
	for (const gem of gems) {
		totalGems += gem.system.quantity ?? 1;
	}

	// Update the gem count display in the gems box
	const $gemBox = html.find('.tab-inventory [data-action="open-gem-bag"]').closest(".SD-box");
	if ($gemBox.length) {
		$gemBox.find(".larger").text(totalGems);
	}

	// Recalculate gem slots: every 10 gems = 1 slot
	const gemSlots = totalGems > 0 ? Math.ceil(totalGems / (CONFIG.SHADOWDARK?.DEFAULTS?.GEMS_PER_SLOT || 10)) : 0;

	// Update the slots breakdown and total
	// The slots box is the first SD-box in the inventory sidebar
	const $slotsBox = html.find(".tab-inventory .SD-box").first();
	const $slotGrid = $slotsBox.find(".SD-grid.left.small");
	if ($slotGrid.length) {
		// The grid children are only the <div> elements (text nodes from {{localize}} are not elements)
		// Order: [0]=gear, [1]=treasure, [2]=coins, [3]=gems
		const $numDivs = $slotGrid.children("div");
		const gearVal = parseInt($numDivs.eq(0).text()) || 0;
		const treasureVal = parseInt($numDivs.eq(1).text()) || 0;
		const coinsVal = parseInt($numDivs.eq(2).text()) || 0;

		// Update gems slot value
		$numDivs.eq(3).text(gemSlots);

		// Recalculate and update total
		const newTotal = gearVal + treasureVal + coinsVal + gemSlots;
		const $valueGrid = $slotsBox.find(".value-grid.larger");
		const $totalDiv = $valueGrid.children("div").first();
		const maxSlots = parseInt($valueGrid.children("div").eq(2).text()) || 0;

		$totalDiv.text(newTotal);
		if (newTotal > maxSlots) {
			$totalDiv.css("color", "red");
		}
		else {
			$totalDiv.css("color", "");
		}
	}
}
