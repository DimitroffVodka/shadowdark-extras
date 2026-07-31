/**
 * Compatibility patches against PlayerSheetSD.
 *
 * Extracted from the composition root in Phase 3. `_onUseAbility` calls
 * `this.getSkipPrompt()` and `this.getAdvantage()`, which do not exist on the
 * sheet — every other Shadowdark sheet reaches for
 * `this.actor.buildOptionsForSkipPrompt(event)` instead.
 *
 * Named for the shape rather than the single patch: this is the file a second
 * PlayerSheetSD compatibility fix should join, not a new one-off module.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Patch PlayerSheetSD._onUseAbility to fix missing getSkipPrompt/getAdvantage methods
 * The system calls this.getSkipPrompt() and this.getAdvantage() which don't exist on the sheet.
 * Other sheets correctly use this.actor.buildOptionsForSkipPrompt(event) instead.
 */
export function patchPlayerSheetUseAbility() {
	const PlayerSheetSD = CONFIG.Actor.sheetClasses.Player?.["shadowdark.PlayerSheetSD"]?.cls;
	if (!PlayerSheetSD) {
		console.warn(`${MODULE_ID} | Could not find PlayerSheetSD class to patch _onUseAbility`);
		return;
	}

	// Only patch if getSkipPrompt is missing (i.e. the bug exists in this system version)
	if (typeof PlayerSheetSD.prototype.getSkipPrompt === "function") return;

	PlayerSheetSD.prototype._onUseAbility = async function (event) {
		event.preventDefault();
		// SD 4.x: abilities live on the data model and are resolved by UUID.
		// The system's own handler reads dataset.itemUuid and calls
		// actor.system.useAbility(uuid). Mirror that, with a bare-id fallback
		// for older templates that only expose data-item-id.
		const ds = event.currentTarget.dataset;
		let abilityUuid = ds.itemUuid;
		if (!abilityUuid && ds.itemId) {
			abilityUuid = this.actor.items.get(ds.itemId)?.uuid;
		}
		if (!abilityUuid) return;
		const options = this.actor.buildOptionsForSkipPrompt?.(event) ?? { skipPrompt: event.shiftKey };
		this.actor.system.useAbility(abilityUuid, options);
	};

	console.log(`${MODULE_ID} | Patched PlayerSheetSD._onUseAbility (getSkipPrompt fix)`);
}
