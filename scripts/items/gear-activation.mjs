import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Using a Basic ("gear") item.
 *
 * The Activity tab on a Basic item sheet configures damage, effects, summoning,
 * item-give and macros exactly as a Scroll's does — but a Basic item has no use
 * action in the system, and every one of those features is driven off the chat
 * card a use action posts. This module is that missing action: a control on the
 * inventory row, a charge count, and a chat card shaped like the one `usePotion`
 * produces so the existing pipeline recognises it.
 *
 * Deliberately NOT a wrapper around `usePotion`: that method opens a confirm
 * dialog, flips `isIdentified`, and deletes the item. A ring survives being
 * worn.
 *
 * No roll is made. That is the point of the feature — the check-free magic item
 * the system has no type for — and it is why every item-type gate the pipeline
 * uses to mean "this one auto-succeeds" (`Potion`, `Scroll`, …) now also lists
 * `Basic`.
 */

/**
 * Read the activation config off an item.
 * @param {Item} item
 * @returns {{max: number, remaining: number}|null} null when not usable
 */
export function getGearActivation(item) {
	const config = item?.getFlag?.(MODULE_ID, "gearActivation");
	if (!config?.enabled) return null;

	const max = Math.max(0, Number(config.maxUses) || 0);
	// max 0 means unlimited, and an unset `uses` on a freshly configured item
	// means full rather than empty.
	const remaining = max === 0 ? Infinity : Math.max(0, Number(config.uses ?? max));
	return { max, remaining };
}

/**
 * Use a Basic item: spend a charge and post the card the pipeline reads.
 * @param {Actor} actor
 * @param {Item} item
 */
export async function useGearItem(actor, item) {
	const activation = getGearActivation(item);
	if (!activation) return;

	if (activation.remaining <= 0) {
		return ui.notifications.warn(`${item.name} has no uses remaining.`);
	}

	if (activation.max > 0) {
		await item.setFlag(MODULE_ID, "gearActivation.uses", activation.remaining - 1);
	}

	// Mirrors the shape `usePotion` hands to `renderRollMessage`: the pipeline
	// resolves the item from `flags.shadowdark.rollConfig.itemUuid`, so both the
	// uuid and an actor id have to be present or `resolveCardContext` returns
	// nothing and the whole Activity tab silently does nothing.
	const chatData = await shadowdark.chat.renderRollMessage({
		actorId: actor.id,
		actorUuid: actor.uuid,
		itemUuid: item.uuid,
		heading: game.i18n.format("SHADOWDARK.dialog.item.use", { name: item.name }),
	});
	await ChatMessage.create(chatData);
}

/**
 * Add a use control to the inventory row of every usable Basic item.
 * @param {Application} app
 * @param {jQuery} html
 * @param {Actor} actor
 */
export function injectGearUseButtons(app, html, actor) {
	if (!actor) return;

	const $inventoryTab = html.find('.tab[data-tab="tab-inventory"]');
	if (!$inventoryTab.length) return;

	for (const item of actor.items) {
		if (item.type !== "Basic") continue;

		const activation = getGearActivation(item);
		if (!activation) continue;

		const $itemRow = $inventoryTab.find(`[data-item-id="${item.id}"]`).closest(".item");
		if (!$itemRow.length) continue;

		const $actions = $itemRow.find(".actions");
		if (!$actions.length) continue;
		if ($actions.find(".sdx-use-gear-item").length > 0) continue;

		const depleted = activation.remaining <= 0;
		const usesLabel = activation.max > 0
			? `<span class="sdx-gear-uses">${activation.remaining}/${activation.max}</span>`
			: "";

		const $useBtn = $(`
			<a class="sdx-use-gear-item${depleted ? " sdx-gear-depleted" : ""}"
			   data-item-id="${item.id}"
			   data-tooltip="${depleted ? "No uses remaining" : `Use ${foundry.utils.escapeHTML(item.name)}`}">
				${usesLabel}<i class="fas fa-hand-sparkles"></i>
			</a>
		`);

		if (!depleted) {
			$useBtn.on("click", async event => {
				event.preventDefault();
				const used = actor.items.get($(event.currentTarget).data("item-id"));
				if (used) await useGearItem(actor, used);
			});
		}

		$actions.prepend($useBtn);
	}
}
