// Carousing session log — extracted from CarousingSD.mjs (Phase 5.3 split).
// The journal that records each session: finding or creating it, normalising a
// session into log rows, writing the page, and opening it.

import { MODULE_ID, getCarousingMode, getCarousingSession, getCarousingTableById, getExpandedCarousingData, saveCarousingSession } from "./carousing-core.mjs";
import { applyExpandedCarousingNotes, getParticipantActor } from "./carousing-notes.mjs";

/**
 * The readable log of carousing sessions. Distinct from the hidden
 * __sdx_carousing_sync__ journal, which only holds transient sync state — this
 * one is a normal journal the GM can browse, created GM-only so outcomes hidden
 * by the show-benefits/mishaps settings are not leaked through the sidebar.
 * Located by flag rather than by name so renaming it does not orphan the log.
 */
export async function getOrCreateCarousingLogJournal() {
	let journal = game.journal.find(j => j.getFlag(MODULE_ID, "isCarousingLog"));
	if (journal) return journal;

	return JournalEntry.create({
		name: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.log_journal_name"),
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
		flags: { [MODULE_ID]: { isCarousingLog: true } },
	});
}

/**
 * Normalize original and expanded result shapes for the shared journal table.
 * Kept pure so both formats remain regression-testable outside Foundry.
 */
export function normalizeCarousingLogResults(session, resolveActorName = () => "?") {
	return Object.entries(session?.results || {}).map(([participantId, result]) => {
		const expanded = Array.isArray(result.benefits) || Array.isArray(result.mishaps);
		const benefits = expanded
			? (result.benefits || []).map(entry => entry?.description || "").filter(Boolean)
			: [result.benefit || ""].filter(Boolean);
		const mishaps = expanded
			? (result.mishaps || []).map(entry => entry?.description || "").filter(Boolean)
			: [];

		return {
			name: result.applied?.actorName || resolveActorName(participantId) || "?",
			roll: expanded ? (result.outcomeRoll ?? "") : (result.roll ?? ""),
			outcome: expanded ? `${result.xp ?? 0} XP` : (result.description || ""),
			benefits,
			mishaps,
			applied: result.applied?.summary || "",
			appliedState: expanded
				? "automatic"
				: result.applied
					? "applied"
					: "pending",
		};
	});
}

/**
 * Create or refresh the log page for a session. Called when rolls complete and
 * again each time results are applied, so the page always reflects current
 * state rather than accumulating duplicates.
 */
export async function writeCarousingLogPage(session) {
	if (!game.user.isGM) return;
	if (!session?.logId || !Object.keys(session.results || {}).length) return;

	const journal = await getOrCreateCarousingLogJournal();
	if (!journal) return;

	const esc = Handlebars.Utils.escapeExpression;
	const meta = session.logMeta || {};

	const rows = normalizeCarousingLogResults(
		session, pid => getParticipantActor(pid)?.name
	).map(entry => {
		let applied;
		if (entry.appliedState === "automatic") {
			applied = esc(
				game.i18n.localize(
					"SHADOWDARK_EXTRAS.carousing.log_automatic"
				)
			);
		}
		else if (entry.applied) {
			applied = esc(entry.applied);
		}
		else if (entry.appliedState === "applied") {
			applied = esc(
				game.i18n.localize("SHADOWDARK_EXTRAS.carousing.log_applied")
			);
		}
		else {
			applied = `<em>${esc(game.i18n.localize(
				"SHADOWDARK_EXTRAS.carousing.log_not_applied"
			))}</em>`;
		}
		const benefits = entry.benefits.map(esc).join("<br>");
		const mishaps = entry.mishaps.map(esc).join("<br>");
		return `<tr>
            <td><strong>${esc(entry.name)}</strong></td>
            <td style="text-align:center">${esc(String(entry.roll))}</td>
            <td>${esc(entry.outcome)}</td>
            <td>${benefits}</td>
            <td>${mishaps}</td>
            <td>${applied}</td>
        </tr>`;
	}).join("");

	const header = meta.tierDescription
		? `<p><em>${esc(meta.tierDescription)}</em><br>${esc(String(meta.tierCost ?? 0))} GP total — ${esc(String(meta.costPerPerson ?? 0))} GP each</p>`
		: "";

	const content = `
        ${header}
        <table>
            <thead><tr><th>Character</th><th>Roll</th><th>Outcome</th><th>Benefits</th><th>Mishaps</th><th>Applied</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;

	const title = game.i18n.format("SHADOWDARK_EXTRAS.carousing.log_session_title", {
		date: meta.date || new Date().toLocaleString(),
	});

	const existing = journal.pages.find(p => p.getFlag(MODULE_ID, "logId") === session.logId);
	if (existing) {
		await existing.update({ "text.content": content });
	}
	else {
		await JournalEntryPage.create({
			name: title,
			type: "text",
			text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
			flags: { [MODULE_ID]: { logId: session.logId } },
		}, { parent: journal });
	}
}

/** Open the carousing log journal, creating it if this world has none yet. */
export async function openCarousingLog() {
	if (!game.user.isGM) return;
	const session = getCarousingSession();
	if (Object.keys(session.results || {}).length) {
		let sessionChanged = false;
		if (!session.logId) {
			session.logId = foundry.utils.randomID();
			sessionChanged = true;
		}
		if (!session.logMeta) {
			const table = getCarousingMode() === "expanded"
				? getExpandedCarousingData()
				: getCarousingTableById(session.selectedTableId);
			const tier = table?.tiers?.[session.selectedTier] || {};
			const participantCount = Object.keys(session.results).length;
			session.logMeta = {
				date: new Date().toLocaleString(),
				tierDescription: tier.description || "",
				tierCost: tier.cost || 0,
				costPerPerson: Math.ceil((tier.cost || 0) / Math.max(1, participantCount)),
			};
			sessionChanged = true;
		}
		const notesChanged = await applyExpandedCarousingNotes(session);
		if (sessionChanged || notesChanged) await saveCarousingSession(session);
		await writeCarousingLogPage(session);
	}
	const journal = await getOrCreateCarousingLogJournal();
	journal?.sheet?.render(true);
}
