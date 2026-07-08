/**
 * Break-on-damage effect expiry  —  DRAFT (new, untracked)
 * ---------------------------------------------------------------------------
 * Reusable primitive: mark an applied effect so it is automatically removed the
 * next time its bearer takes HP damage. Covers "injury wakes it" spells
 * (First Gate / Sleep / Hypnotize / Charm) and "ends if they notice harm"
 * spells (Peace) without per-spell hooks.
 *
 * The registration lives ON the effect document as a flag
 * (`flags.shadowdark-extras.breakOnDamage`), so it survives reloads and is
 * garbage-collected automatically when the effect is deleted — there is no
 * separate registry to leak or reconcile.
 *
 * Reuses existing SDX infrastructure:
 *   - getSocket()            (CombatSettingsSD.mjs) — shared socketlib socket
 *   - "removeTargetEffect"   GM handler (CombatSettingsSD.mjs) — deletes an
 *                            Item OR ActiveEffect by id, cross-owner, as GM.
 *   - "markBreakOnDamage"    GM handler (CombatSettingsSD.mjs) — stamps/clears
 *                            the break marker cross-owner (next to removeTargetEffect).
 *
 * WIRING (two one-liners in shadowdark-extras.mjs):
 *   1. import { initBreakOnDamage, breakEffectOnDamage } from "./BreakOnDamageSD.mjs";
 *      …then call `initBreakOnDamage();` right after `initFocusSpellTracker();`
 *      (~line 9495 — same ready-phase, shared socket already exists).
 *   2. Add to the `module.api = { … }` block (~line 19926, next to getCreatureType):
 *          breakEffectOnDamage: audited("breakEffectOnDamage", breakEffectOnDamage),
 *          clearBreakOnDamage:  audited("clearBreakOnDamage",  clearBreakOnDamage),
 *      (NOT gmOnly — a player's own effects must be able to break too.)
 */

import { getSocket } from "./CombatSettingsSD.mjs";

const MODULE_ID = "shadowdark-extras";
const BREAK_FLAG = "breakOnDamage";      // flag key on the effect doc
const OPT_KEY    = "brokeByDamage";      // stashed on the update `options` bag

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Resolve an Actor from an Actor instance, a UUID, or a bare id. */
function resolveActor(ref) {
	if (!ref) return null;
	if (ref instanceof Actor) return ref;
	if (typeof ref === "string") {
		if (ref.includes(".")) {
			const doc = fromUuidSync(ref);
			return doc instanceof Actor ? doc : (doc?.actor ?? null);
		}
		return game.actors.get(ref) ?? null;
	}
	return null;
}

/** Find an applied effect (Effect Item first, then ActiveEffect) by id. */
function findEffectDoc(actor, effectId) {
	return actor?.items?.get(effectId) ?? actor?.effects?.get(effectId) ?? null;
}

/** Token id for unlinked-token actors, so removeTargetEffect can find them. */
function tokenIdOf(actor) {
	return actor?.isToken ? actor.token?.id ?? null : null;
}

/* ── public API ──────────────────────────────────────────────────────────── */

/**
 * Mark an already-applied effect to be removed on the bearer's next HP loss.
 * @param {Actor|string} actorRef  Actor instance, UUID, or id (the bearer).
 * @param {string} effectId        Id of the applied Effect Item or ActiveEffect.
 * @param {object} [opts]
 * @param {string} [opts.reason="damaged"]  Shown in the break notification.
 * @returns {Promise<boolean>} true if the marker was written.
 */
export async function breakEffectOnDamage(actorRef, effectId, { reason = "damaged" } = {}) {
	const actor = resolveActor(actorRef);
	const doc = findEffectDoc(actor, effectId);
	if (!doc) {
		console.warn(`${MODULE_ID} | breakEffectOnDamage: effect ${effectId} not found on actor`);
		return false;
	}

	// Owner (usually the GM, or a player on their own actor) writes directly;
	// otherwise relay the flag write through the GM.
	if (doc.isOwner) {
		await doc.setFlag(MODULE_ID, BREAK_FLAG, { reason });
		return true;
	}
	const socket = getSocket();
	if (!socket) {
		console.warn(`${MODULE_ID} | breakEffectOnDamage: no socket; cannot mark cross-owner effect`);
		return false;
	}
	return await socket.executeAsGM("markBreakOnDamage", {
		targetActorId: actor.id,
		targetTokenId: tokenIdOf(actor),
		effectItemId: effectId,
		reason,
	});
}

/** Remove the break-on-damage marker (e.g. if the effect is made permanent). */
export async function clearBreakOnDamage(actorRef, effectId) {
	const actor = resolveActor(actorRef);
	const doc = findEffectDoc(actor, effectId);
	if (!doc) return false;
	if (doc.isOwner) { await doc.unsetFlag(MODULE_ID, BREAK_FLAG); return true; }
	const socket = getSocket();
	return socket ? await socket.executeAsGM("markBreakOnDamage", {
		targetActorId: actor.id, targetTokenId: tokenIdOf(actor), effectItemId: effectId, reason: null,
	}) : false;
}

/* ── engine ──────────────────────────────────────────────────────────────── */

/** All applied effects on an actor carrying an active break-on-damage marker. */
function markedEffects(actor) {
	const hit = (d) => !!d.getFlag(MODULE_ID, BREAK_FLAG);
	return [
		...(actor.items?.filter(hit) ?? []),
		...(actor.effects?.filter(hit) ?? []),
	];
}

/** preUpdate: detect an HP *decrease* and stash a marker on the shared options. */
function onPreUpdateActor(actor, changes, options, _userId) {
	const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
	if (newHp === undefined) return;
	const oldHp = foundry.utils.getProperty(actor, "system.attributes.hp.value");
	if (!(Number(newHp) < Number(oldHp))) return;                 // heal / no-op → ignore
	if (!markedEffects(actor).length) return;                     // nothing to break
	foundry.utils.setProperty(options, `${MODULE_ID}.${OPT_KEY}`, true);
}

/** update: after the HP change commits, remove the marked effects (once). */
async function onUpdateActor(actor, _changes, options, userId) {
	if (!foundry.utils.getProperty(options, `${MODULE_ID}.${OPT_KEY}`)) return;
	if (userId !== game.user.id) return;      // only the user who caused the hit acts → single run

	const socket = getSocket();
	for (const doc of markedEffects(actor)) {
		const reason = doc.getFlag(MODULE_ID, BREAK_FLAG)?.reason || "damaged";
		const payload = { targetActorId: actor.id, targetTokenId: tokenIdOf(actor), effectItemId: doc.id };

		if (game.user.isGM) {
			await doc.delete();
		} else if (socket) {
			await socket.executeAsGM("removeTargetEffect", payload);   // reuse existing GM handler
		} else {
			continue;
		}

		ChatMessage.create({
			content: `<em>${doc.name}</em> on <strong>${actor.name}</strong> ended (${reason}).`,
			speaker: { alias: "Shadowdark Extras" },
		});
	}
}

/**
 * Register the break-on-damage hooks. Call once, in the ready phase, right after
 * initFocusSpellTracker(). The cross-owner "markBreakOnDamage" GM handler is
 * registered centrally in CombatSettingsSD.mjs alongside "removeTargetEffect".
 */
export function initBreakOnDamage() {
	console.log(`${MODULE_ID} | Initializing break-on-damage`);

	Hooks.on("preUpdateActor", onPreUpdateActor);
	Hooks.on("updateActor", onUpdateActor);
}
