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
 * `AuraEffectsSD` and `TemplateEffectsSD` import both names FROM HERE, by
 * dynamic import at the point of use. They used to reach them by dynamically
 * importing the composition root, which re-exported them purely to serve that
 * one call — the last feature-to-root edge in the graph, and the reason the
 * root could only be described as a "static-import leaf". Repointing those two
 * sites let the re-export go, so the root now exports NOTHING and nothing
 * imports it by any mechanism.
 *
 * Keep it that way: if something here is needed elsewhere, import it from this
 * module. Re-exporting through the root recreates the inversion.
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

/**
 * Register the GM-side handler for item macros routed off a player client.
 *
 * `sdxExecuteItemMacro` is the other end of the `runAsGm` branch in
 * `executeItemMacro` above. They belong in one file: the serialise/rehydrate
 * contract between them is subtle — the sender always sets `token`, null
 * included, precisely so this side does not fall back to a canvas lookup on
 * whatever scene the GM happens to be viewing — and that rule is only
 * enforceable if both halves are read together.
 *
 * The socket is passed in rather than fetched, so the root's single socket hook
 * stays the one place registration order is decided.
 *
 * @param {object} socket - The module's socketlib socket.
 */
export function registerItemMacroSocket(socket) {
	socket.register("sdxExecuteItemMacro", async function(itemUuid, contextData) {
		const sender = game.users.get(this.socketdata?.userId);
		if (!sender) return null;

		const item = await fromUuid(itemUuid);
		if (!item) return null;

		if (!sender.isGM && !item.testUserPermission(sender, "OWNER")) {
			console.warn(`${MODULE_ID} | Unauthorized item macro execution attempt from user ${sender.name}`);
			return null;
		}

		// Rehydrate context if it was serialized. `token` is always defined —
		// null included — so executeItemMacro does not fall back to a lookup on
		// whatever scene this GM is viewing. The sending client is authoritative
		// about whether a caster token existed.
		const context = { ...contextData };
		if (contextData.actorUuid) context.actor = await fromUuid(contextData.actorUuid);
		context.token = contextData.tokenUuid
			? ((await fromUuid(contextData.tokenUuid))?.object || null)
			: null;
		if (contextData.tokenUuid && !context.token) {
			console.warn(`${MODULE_ID} | Caster token ${contextData.tokenUuid} is not on the scene this GM is viewing; macro runs without a caster token`);
		}

		return executeItemMacro(item, context);
	});
}

/**
 * One-time migration of legacy `flags.itemacro.macro` data onto SDX's own
 * `macroCommand` / `macroName` / `macroRunAsGM` flags.
 *
 * Extracted from the composition root in Phase 3 (step 39). It lives here
 * because this module is what READS `macroCommand`; the migration that writes
 * it belongs beside its consumer, not in the bootstrap.
 *
 * KNOWN LIMITATION, already recorded as KNOWN-ISSUES item 1: this is gated on
 * the `itemacroMigrationDone` world setting and runs once, so items imported
 * after it has run are never migrated. Moving the code does not change that,
 * and fixing it is a behaviour change that belongs with the issue, not here.
 *
 * The body is the root's verbatim, at its original indentation.
 */
export async function migrateLegacyItemMacros() {
	// Run one-time itemacro data migration if not already done
	if (!game.settings.get(MODULE_ID, "itemacroMigrationDone")) {
		console.log(`${MODULE_ID} | Starting itemacro data migration...`);

		const migrateItem = async (item) => {
			const legacy = item.flags?.itemacro?.macro?.command;
			if (legacy && !item.getFlag(MODULE_ID, "macroCommand")) {
				await item.setFlag(MODULE_ID, "macroCommand", legacy);
				await item.setFlag(MODULE_ID, "macroName", item.flags?.itemacro?.macro?.name || item.name);
				await item.setFlag(MODULE_ID, "macroRunAsGM", item.flags?.itemacro?.macro?.runAsGM || false);
			}
		};

		// Migrate world items
		for (const item of game.items) await migrateItem(item);

		// Migrate actor items
		for (const actor of game.actors) {
			for (const item of actor.items) await migrateItem(item);
		}

		await game.settings.set(MODULE_ID, "itemacroMigrationDone", true);
		console.log(`${MODULE_ID} | itemacro data migration complete.`);
	}
}
