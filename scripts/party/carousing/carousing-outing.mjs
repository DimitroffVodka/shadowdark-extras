// One paid outing can have replacement rolls, but only one clock attempt.
import { saveCarousingSession } from "./carousing-core.mjs";
import { writeCarousingLogPage } from "./carousing-log.mjs";
import { applyExpandedCarousingNotes } from "./carousing-notes.mjs";
import { applyRenownDelta, getActorRenown } from "./carousing-renown.mjs";
import { carousingDays, passCarousingTime } from "./carousing-rules.mjs";

function actorState(actor) {
	return {
		xp: actor.system?.level?.xp ?? 0,
		renown: getActorRenown(actor),
		notes: actor.system?.notes ?? "",
	};
}

/** Only the automatic writes made by Expanded carousing, not whole actors. */
export function captureCarousingActors(participants) {
	return Object.fromEntries(participants.map(p => [p.participantId, {
		actorId: p.droppedActor.id, ...actorState(p.droppedActor),
	}]));
}

/** Refuse to overwrite later sheet edits, applied Original outcomes or changed attendance. */
export function canRedoCarousing(session, participants, mode) {
	const outing = session?.outing;
	if (session?.phase !== "complete" || !session.logId || !outing || outing.mode !== mode) return false;
	if (Object.values(session.results ?? {}).some(r => r.applied)) return false;
	const current = captureCarousingActors(participants);
	const ids = Object.keys(current);
	if (!ids.length || ids.length !== Object.keys(outing.after ?? {}).length) return false;
	return ids.every(id => outing.before?.[id]
		&& JSON.stringify(current[id]) === JSON.stringify(outing.after[id])
		&& current[id].actorId === outing.before[id].actorId);
}

/** Reverse only this outing's automatic XP/renown/notes, after the preflight above. */
export async function restoreCarousingActors(session, participants) {
	if (!globalThis.game?.user?.isGM) return false;
	if (!canRedoCarousing(session, participants, session.outing?.mode)) return false;
	for (const p of participants) {
		const before = session.outing.before[p.participantId];
		const actor = p.droppedActor;
		const renownDelta = before.renown - getActorRenown(actor);
		if (renownDelta) {
			await applyRenownDelta(actor, renownDelta,
				game.i18n.localize("SHADOWDARK_EXTRAS.carousing.redo_reason"));
		}
		if (actor.system.level.xp !== before.xp || (actor.system.notes ?? "") !== before.notes) {
			await actor.update({ "system.level.xp": before.xp, "system.notes": before.notes });
		}
	}
	return true;
}

/** Persist results before time passes; a clock rejection must not suppress the result card. */
export async function finishCarousingOuting(session, tier, holiday, participants, redo) {
	if (!redo) {
		session.logId = foundry.utils.randomID();
		session.logMeta = {
			date: new Date().toLocaleString(), tierDescription: tier.description || "",
			tierCost: tier.cost || 0, costPerPerson: Math.ceil(tier.cost / participants.length),
			holiday: holiday?.name || "",
			time: { days: carousingDays(tier, holiday), status: "unconfirmed", doused: 0 },
		};
	}
	else session.logMeta.redos = (session.logMeta.redos || 0) + 1;
	if (session.outing.mode === "expanded") await applyExpandedCarousingNotes(session);
	session.outing.after = captureCarousingActors(participants);
	if (!redo) session.phase = "rolling";
	// This receipt survives re-entry and Redo. Reset starts over, never rewinds time.
	await saveCarousingSession(session, { replaceResults: true });
	await writeCarousingLogPage(session);
	if (redo) return;
	const receipt = session.logMeta.time;
	try {
		const result = await passCarousingTime(tier, holiday);
		if (result?.ok === true || (typeof result === "number" && Number.isFinite(result))) {
			receipt.status = "advanced";
			receipt.worldTime = result?.worldTime ?? result;
		}
		receipt.doused = Array.isArray(result?.doused) ? result.doused.length : 0;
	}
	catch(error) {
		console.warn("shadowdark-extras | carousing clock move could not be confirmed", error);
	}
	if (receipt.status !== "advanced") {
		ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.time_unconfirmed"));
	}
	session.phase = "complete";
	await saveCarousingSession(session);
	await writeCarousingLogPage(session);
}
