// Unidentified-item helpers — extracted from scripts/party/PartySheetSD.mjs
// (Phase 5.1 split). Leaf module shared by PartySheetSD and the party mixins.

const MODULE_ID = "shadowdark-extras";

/**
 * Returns true when a live item is unidentified.
 * Uses SD 4.x native identification; falls back to the legacy SDX flag
 * only on worlds that predate the native schema.
 * @param {Item} item
 * @returns {boolean}
 */
export function isItemUnidentified(item) {
	if (!item) return false;
	// SD 4.x: identification schema exists on PhysicalItemSD → use it
	if (item.system?.identification !== undefined) {
		return !item.system.isIdentified;
	}
	// Legacy fallback (SD 3.x worlds)
	return Boolean(item.getFlag?.(MODULE_ID, "unidentified"));
}

/**
 * Returns the masked display name for an unidentified live item.
 * In SD 4.x item.name is already the unidentified name; legacy worlds
 * store the mask in a separate flag.
 * @param {Item} item
 * @returns {string}
 */
export function getMaskedItemName(item) {
	// SD 4.x native: item.name is the unidentified name when unidentified
	if (item?.system?.identification !== undefined) {
		return item.name;
	}
	// Legacy fallback
	const customName = item?.getFlag?.(MODULE_ID, "unidentifiedName");
	return (customName && customName.trim())
		? customName.trim()
		: game.i18n.localize("SHADOWDARK_EXTRAS.item.unidentified.label");
}
