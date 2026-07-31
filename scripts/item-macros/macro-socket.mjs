import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * The module's socketlib socket.
 *
 * Extracted from the composition root in Phase 3. The plan allows the macro
 * execution socket and its handlers to be split once a dedicated socket
 * boundary exists; this is that boundary. The handlers themselves still live in
 * the root and move out one feature at a time, each now able to reach the
 * socket without the root owning a mutable binding for it.
 *
 * Three `ready` hooks in the root register handlers on this socket, and two of
 * them run while the first is still suspended on an await. Ordering is
 * therefore not something callers can rely on, which is why the getter is
 * separate from the initialiser: whoever runs first calls
 * `initMacroExecuteSocket()`, and everyone else reads what it produced.
 *
 * `socketlib.registerModule` is idempotent — it hands back the socket already
 * registered for a module — so the two other call sites in the module
 * (`setupCombatSocket`, `initDungeonSocket`) share this exact instance.
 */
let macroExecuteSocket;

/**
 * Create the socket, if socketlib is active, and expose it on the module entry
 * as `game.modules.get(MODULE_ID).socket`. The bundled macros under
 * `scripts/macros/` reach it that way rather than by import.
 *
 * Safe to call more than once; later calls return the existing socket.
 *
 * @returns {object|undefined} The socket, or undefined when socketlib is inactive.
 */
export function initMacroExecuteSocket() {
	if (macroExecuteSocket) return macroExecuteSocket;
	if (!game.modules.get("socketlib")?.active) return undefined;

	macroExecuteSocket = socketlib.registerModule(MODULE_ID);

	// Expose socket to module
	const module = game.modules.get(MODULE_ID);
	if (module) module.socket = macroExecuteSocket;

	return macroExecuteSocket;
}

/**
 * The socket, or undefined if `initMacroExecuteSocket()` has not run yet or
 * socketlib is inactive. Callers guard on the result rather than assuming it.
 *
 * @returns {object|undefined}
 */
export function getMacroExecuteSocket() {
	return macroExecuteSocket;
}
