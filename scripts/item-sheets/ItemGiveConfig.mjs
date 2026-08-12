import { FEATURE_IDS, isFeatureEnabled } from "../settings/feature-gates.mjs";

/**
 * Generate the Give Item configuration HTML for the spell Activity tab
 */
export function generateItemGiveConfigHTML(MODULE_ID, flags, itemsList, itemProfilesArray) {
	if (!isFeatureEnabled(FEATURE_IDS.SPELL_CONFIGS)) return "";
	return `
		<div class="SD-box sdx-item-give-box grid-colspan-3">
			<div class="header light">
				<label class="sdx-section-checkbox">
					<input type="checkbox" name="flags.${MODULE_ID}.itemGive.enabled"
					       ${flags.enabled ? "checked" : ""}
					       class="sdx-item-give-toggle" />
					<span>Give Item to Caster</span>
				</label>
				<span></span>
			</div>
			<div class="content sdx-item-give-content">
				<div class="SD-grid">
					<h3 class="sdx-section-title">Items to Give</h3>
					<div class="sdx-item-give-list">
						${itemsList || ""}
					</div>
					<button type="button" class="sdx-add-item-give-btn" data-action="addItemGiveProfile">
						<i class="fas fa-plus"></i> Add Item to Give
					</button>
					<input type="hidden" name="flags.${MODULE_ID}.itemGive.profiles" class="sdx-item-give-data" value="${foundry.utils.escapeHTML(JSON.stringify(itemProfilesArray))}" />
				</div>
			</div>
		</div>
	`;
}

export function generateItemGiveProfileHTML(profile, index) {
	// Item name and image come from a dropped item a player can rename, and the
	// quantity is GM-typed text. Each lands in an attribute value.
	const escapedImg = foundry.utils.escapeHTML(profile.itemImg || "icons/svg/mystery-man.svg");
	const escapedName = foundry.utils.escapeHTML(profile.itemName || "Item");
	const escapedUuid = foundry.utils.escapeHTML(profile.itemUuid || "");
	const escapedRawName = foundry.utils.escapeHTML(profile.itemName || "");
	const escapedRawImg = foundry.utils.escapeHTML(profile.itemImg || "");
	const escapedQuantity = foundry.utils.escapeHTML(profile.quantity || "1");

	return `
		<div class="sdx-item-give-profile" data-index="${index}">
			<div class="sdx-profile-grid">
				<div class="sdx-item-give-drop">
					${profile.itemUuid ? `
						<div class="sdx-item-give-display" data-uuid="${escapedUuid}">
							<img src="${escapedImg}" alt="${escapedName}" />
							<span>${escapedName}</span>
						</div>
					` : `
						<span><i class="fas fa-hand-holding"></i> Drop item here</span>
					`}
				</div>
				<input type="hidden" class="sdx-item-give-uuid" value="${escapedUuid}" />
				<input type="hidden" class="sdx-item-give-name" value="${escapedRawName}" />
				<input type="hidden" class="sdx-item-give-img" value="${escapedRawImg}" />
				<div class="sdx-profile-field">
					<label>Quantity</label>
					<input type="text" class="sdx-item-give-quantity" value="${escapedQuantity}" placeholder="1 or 1d4" title="Quantity or dice formula to roll" />
				</div>
				<button type="button" class="sdx-remove-item-give-btn" data-index="${index}"
				        data-action="removeItemGiveProfile" title="Remove this item">
					<i class="fas fa-times"></i>
				</button>
			</div>
		</div>
	`;
}
