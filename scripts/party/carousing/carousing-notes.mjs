// Carousing actor notes — extracted from CarousingSD.mjs (Phase 5.3 split).
// Building the note text for a result and appending it to the actor it belongs
// to. getParticipantActor travels with them: it is the lookup that decides who
// a note is addressed to, and the notes are its only remaining caller here.

import { MODULE_ID, getCarousingDrops } from "./carousing-core.mjs";

/**
 * Resolve the actor behind a carousing participant id
 * (a user id with a dropped actor, or "actor-<id>" for GM-managed ones).
 */
export function getParticipantActor(participantId) {
	const actorId = participantId?.startsWith("actor-")
		? participantId.slice(6)
		: getCarousingDrops()[participantId];
	return actorId ? game.actors.get(actorId) : null;
}

/**
 * Append a carousing entry to an actor's Notes, preserving whatever is there.
 * This is how narrative rewards (allies, debts, reputations) reach the sheet —
 * verbatim, for the GM and player to interpret.
 */
export async function appendCarousingNote(actor, description, benefit, appliedSummary, entryId = "") {
	const esc = foundry.utils.escapeHTML ?? Handlebars.Utils.escapeExpression;
	const heading = game.i18n.localize("SHADOWDARK_EXTRAS.carousing.note_heading");
	const date = new Date().toLocaleDateString();

	const parts = [description, benefit].filter(Boolean).map(t => esc(t)).join(" — ");
	const applied = appliedSummary ? ` <em>(${esc(appliedSummary)})</em>` : "";
	const existing = actor.system?.notes || "";
	const marker = entryId ? ` data-sdx-carousing-id="${esc(entryId)}"` : "";
	if (marker && existing.includes(marker.trim())) return false;
	const entry = `<p${marker}><strong>${esc(heading)}</strong> — ${esc(date)}: ${parts}${applied}</p>`;
	await actor.update({ "system.notes": existing ? `${existing}\n${entry}` : entry });
	return true;
}

/** Build the human-readable sheet note for an Expanded-mode result. */
export function buildExpandedCarousingNote(result, {
	showBenefits = true,
	showMishaps = true,
	labels = {},
} = {}) {
	const benefits = showBenefits
		? (result?.benefits || []).map(entry => entry?.description || "").filter(Boolean)
		: [];
	const mishaps = showMishaps
		? (result?.mishaps || []).map(entry => entry?.description || "").filter(Boolean)
		: [];
	const sections = [];
	if (benefits.length) {
		sections.push(`${labels.benefits || "Benefits"}: ${benefits.join("; ")}`);
	}
	if (mishaps.length) {
		sections.push(`${labels.mishaps || "Mishaps"}: ${mishaps.join("; ")}`);
	}

	const summary = [labels.xp || `+${result?.xp ?? 0} XP`];
	const renown = [...(result?.benefits || []), ...(result?.mishaps || [])]
		.reduce((total, entry) => total + (Number(entry?.renownDelta) || 0), 0);
	if (renown) {
		summary.push(
			labels.renown
            || `${renown > 0 ? "+" : ""}${renown} renown`
		);
	}

	return {
		description: sections.join(" — ")
            || labels.noVisibleOutcomes
            || "No visible benefits or mishaps",
		summary: summary.join(", "),
	};
}

/**
 * Append missing Expanded-mode results to participant sheets exactly once.
 * Sheet Notes are player-visible, so hidden descriptions must stay out of them
 * just as they stay out of the player-facing portion of the chat card.
 */
export async function applyExpandedCarousingNotes(session) {
	const showBenefits = game.settings.get(
		MODULE_ID,
		"carousingShowBenefitsToPlayers"
	) ?? true;
	const showMishaps = game.settings.get(
		MODULE_ID,
		"carousingShowMishapsToPlayers"
	) ?? true;
	const labels = {
		benefits: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.benefits"),
		mishaps: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.mishaps"),
		noVisibleOutcomes: game.i18n.localize(
			"SHADOWDARK_EXTRAS.carousing.note_no_visible_outcomes"
		),
	};
	let changed = false;
	for (const [participantId, result] of Object.entries(session?.results || {})) {
		const expanded = Array.isArray(result.benefits) || Array.isArray(result.mishaps);
		if (!expanded || result.noteApplied) continue;
		const actor = getParticipantActor(participantId);
		if (!actor) continue;

		const renown = [...(result?.benefits || []), ...(result?.mishaps || [])]
			.reduce(
				(total, entry) => total + (Number(entry?.renownDelta) || 0),
				0
			);
		const note = buildExpandedCarousingNote(result, {
			showBenefits,
			showMishaps,
			labels: {
				...labels,
				xp: game.i18n.format(
					"SHADOWDARK_EXTRAS.carousing.effect_xp",
					{ amount: result?.xp ?? 0 }
				),
				renown: game.i18n.format(
					"SHADOWDARK_EXTRAS.carousing.effect_renown",
					{ delta: renown > 0 ? `+${renown}` : String(renown) }
				),
			},
		});
		await appendCarousingNote(
			actor, note.description, "", note.summary, `${session.logId}:${participantId}`
		);
		result.noteApplied = { at: Date.now(), actorName: actor.name };
		changed = true;
	}
	return changed;
}
