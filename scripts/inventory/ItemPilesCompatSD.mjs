/**
 * Shadowdark / Item Piles compatibility.
 *
 * Shadowdark replaces an unidentified physical item's public name with a
 * generic label and stores the real name in system.identification.name.
 * Item Piles therefore needs that hidden field in its similarity comparison or
 * every "Unidentified Potion" is treated as the same item.
 */

const MODULE_ID = "shadowdark-extras";
const ITEM_PILES_ID = "item-piles";
const IDENTIFICATION_SIMILARITY_PATH = "system.identification.name";
const EQUIPPABLE_ITEM_TYPES = new Set(["Weapon", "Armor"]);
const ITEM_PILES_SETTINGS_SETTLE_MS = 750;

export function addIdentificationSimilarity(paths = []) {
	const similarities = Array.isArray(paths) ? [...paths] : [];
	if (!similarities.includes(IDENTIFICATION_SIMILARITY_PATH)) {
		similarities.push(IDENTIFICATION_SIMILARITY_PATH);
	}
	return similarities;
}

export function isItemPilesActor(actor) {
	try {
		return actor?.getFlag?.(ITEM_PILES_ID, "data")?.enabled === true;
	}
	catch {
		return false;
	}
}

export function normalizePileItemCreate(item, data = {}) {
	if (!isItemPilesActor(item?.parent)) return false;
	if (!EQUIPPABLE_ITEM_TYPES.has(item?.type ?? data?.type)) return false;

	const equipped = data?.system?.equipped ?? item?.system?.equipped;
	if (equipped !== true) return false;

	item.updateSource({ "system.equipped": false });
	return true;
}

export function normalizePileItemUpdate(item, changes = {}) {
	if (!isItemPilesActor(item?.parent)) return false;
	if (!EQUIPPABLE_ITEM_TYPES.has(item?.type)) return false;

	const incomingEquipped = changes?.system?.equipped ?? changes?.["system.equipped"];
	if (item?.system?.equipped !== true && incomingEquipped !== true) return false;

	if (Object.hasOwn(changes, "system.equipped")) {
		changes["system.equipped"] = false;
	}
	else {
		changes.system ??= {};
		changes.system.equipped = false;
	}
	return true;
}

export function getPileEquipmentUpdates(actor) {
	if (!isItemPilesActor(actor)) return [];
	return Array.from(actor?.items ?? [])
		.filter(item =>
			EQUIPPABLE_ITEM_TYPES.has(item?.type) &&
			item?.system?.equipped === true
		)
		.map(item => ({
			_id: item.id,
			"system.equipped": false,
		}));
}

export async function normalizeExistingPileEquipment() {
	if (!game.user?.isGM) return 0;
	if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return 0;

	let normalized = 0;
	for (const actor of game.actors ?? []) {
		const updates = getPileEquipmentUpdates(actor);
		if (!updates.length) continue;

		await actor.updateEmbeddedDocuments("Item", updates);
		normalized += updates.length;
	}

	if (normalized > 0) {
		console.log(
			`${MODULE_ID} | Unequipped ${normalized} item(s) stored in Item Piles actors`
		);
	}
	return normalized;
}

export async function ensureIdentificationSimilarity() {
	if (game.system?.id !== "shadowdark") return false;

	const api = game.itempiles?.API;
	if (!api?.setItemSimilarities) return false;

	const current = Array.isArray(api.ITEM_SIMILARITIES)
		? api.ITEM_SIMILARITIES
		: [];
	const updated = addIdentificationSimilarity(current);
	if (updated.length === current.length) return false;

	// This is a world setting. Let the active GM persist it once; Item Piles
	// distributes that setting to every connected client.
	if (!game.user?.isGM) return false;
	if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return false;

	await api.setItemSimilarities(updated);
	console.log(
		`${MODULE_ID} | Added Shadowdark identification data to Item Piles item similarities`
	);
	return true;
}

export function initItemPilesCompatibility() {
	// Foundry cancels a pre-create/pre-update operation when a hook callback
	// returns false. The pure normalizers intentionally return false when no
	// Item Piles correction is needed, so never expose that return value to
	// Foundry's pre-hook dispatcher.
	Hooks.on("preCreateItem", (item, data) => {
		normalizePileItemCreate(item, data);
	});
	Hooks.on("preUpdateItem", (item, changes) => {
		normalizePileItemUpdate(item, changes);
	});

	Hooks.once("item-piles-ready", () => {
		// Shadowdark registers its Item Piles profile on this same hook, and Item
		// Piles reconciles persisted system settings shortly afterward. Apply the
		// additive correction after both have settled so it survives that pass.
		setTimeout(() => {
			Promise.all([
				ensureIdentificationSimilarity(),
				normalizeExistingPileEquipment(),
			]).catch(error => {
				console.warn(
					`${MODULE_ID} | Could not finish Item Piles compatibility setup`,
					error
				);
			});
		}, ITEM_PILES_SETTINGS_SETTLE_MS);
	});
}
