/**
 * Compatibility facade for the combat settings public surface.
 * The damage-card pipeline lives in damage-card-pipeline.mjs so this module
 * remains a small registration/export seam.
 */

export { injectDamageCard } from "./damage-card-pipeline.mjs";
export { trackSummonedTokensForExpiry, spawnSummonedCreatures } from "./damage-card.mjs";
export { setupCombatSocket, getSocket } from "../shared/combat-socket.mjs";
export {
	CombatSettingsApp,
	DEFAULT_COMBAT_SETTINGS,
	registerCombatSettings,
	setupScrollingCombatText,
	setupSummonExpiryHook,
	untargetDeadTokens,
	untargetAllTokens,
	setupUntargetHook,
} from "./combat-settings-app.mjs";
