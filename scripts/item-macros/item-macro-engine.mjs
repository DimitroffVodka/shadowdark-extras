import { MODULE_ID } from "../shared/module-id.mjs";
import { getMacroExecuteSocket } from "./macro-socket.mjs";

/**
 * The native item macro engine: read a macro off an item and run it.
 *
 * Extracted from the composition root in Phase 3. This is the bottom of the
 * item-macro stack — the weapon, spell, NPC-feature and class-ability paths all
 * end up here, as do `AuraEffectsSD` and `TemplateEffectsSD`. It was the reason
 * those callers could not move: reaching it meant importing the composition
 * root, and a feature module importing the root is the cycle Phase 3 exists to
 * remove.
 *
 * The root re-exports both names. They are part of the module's declared public
 * surface (`hasItemMacro`, `executeItemMacro` on the entry module) and are
 * pinned by the API-export snapshot, so the re-export is load-bearing, not
 * courtesy — `AuraEffectsSD` and `TemplateEffectsSD` still reach them with a
 * dynamic `import("../shadowdark-extras.mjs")`.
 */

/**
 * Check if an item has an attached macro (native or legacy itemacro)
 * @param {Item} item - The item to check
 * @returns {boolean}
 */
export function hasItemMacro(item) {
	return !!(item?.getFlag(MODULE_ID, "macroCommand")
		?? item?.flags?.itemacro?.macro?.command);
}

/**
 * Execute an item's macro script
 * @param {Item} item - The item whose macro to execute
 * @param {Object} context - Execution context (actor, token, args, etc)
 * @returns {Promise<any>}
 */
export async function executeItemMacro(item, context = {}) {
	const command = item.getFlag(MODULE_ID, "macroCommand")
		?? item.flags?.itemacro?.macro?.command;
	if (!command) return null;

	const runAsGM = item.getFlag(MODULE_ID, "macroRunAsGM")
		?? item.flags?.itemacro?.macro?.runAsGM;

	if (runAsGM && !game.user.isGM) {
		const macroExecuteSocket = getMacroExecuteSocket();
		if (macroExecuteSocket) {
			// Serialize context documents to UUIDs for socketlib transmission
			const serializedContext = { ...context };
			if (context.actor) {
				serializedContext.actorUuid = context.actor.uuid;
				delete serializedContext.actor;
			}
			// Resolve the caster's token HERE, on the client that is actually on the
			// caster's scene. The GM cannot re-derive it — its canvas shows whatever
			// scene it happens to be viewing — and callers such as
			// executeWeaponItemMacro pass no token of their own, so without this the
			// GM-side execution would receive none at all. The spell and class-ability
			// paths already resolve locally before serialising; this matches them.
			const casterToken = context.token
				?? (context.actor ?? item.parent)?.getActiveTokens?.()?.[0]
				?? null;
			if (casterToken) {
				serializedContext.tokenUuid = casterToken.uuid || casterToken.document?.uuid;
			}
			delete serializedContext.token;

			return macroExecuteSocket.executeAsGM("sdxExecuteItemMacro", item.uuid, serializedContext);
		} else {
			ui.notifications.warn("Run as GM requested but socketlib not available.");
		}
	}

	const actor = context.actor ?? item.parent ?? null;
	// A `runAsGm` socket handler has already resolved the caster's token from its
	// UUID and sets the key explicitly — honour it even when the value is null.
	// `getActiveTokens()` only searches the scene this client is currently
	// viewing, so on the GM's client it would either miss (GM on another scene)
	// or resolve a token belonging to whatever scene the GM happens to be on.
	// Only the originating client, which supplies no token key at all, may use it.
	// Both branches yield a Token *placeable*, matching the socket handlers and the
	// spell/class-ability scopes. This fallback previously returned a TokenDocument,
	// so `token` changed type depending on where the macro ran. Macro authors: reach
	// the document as `token.document` — note `token.width`/`height` are pixels on a
	// placeable but grid squares on the document, and updates are `token.document.update()`.
	const token = Object.hasOwn(context, "token")
		? (context.token || null)
		: (actor?.getActiveTokens()?.[0] ?? null);
	const character = game.user.character ?? null;
	const speaker = ChatMessage.getSpeaker({ actor });

	// Mirror itemacro's available variables
	const AsyncFunction = (async () => { }).constructor;
	const fn = new AsyncFunction("actor", "token", "character", "speaker", "item", "args", "scope", command);

	try {
		return await fn(actor, token, character, speaker, item, context.args ?? [], context);
	} catch (err) {
		ui.notifications.error(`Macro error on ${item.name}: ${err.message}`);
		console.error(`${MODULE_ID} | Item macro error:`, err);
		return null;
	}
}
