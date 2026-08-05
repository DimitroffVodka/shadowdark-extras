// Carousing renown — extracted from CarousingSD.mjs (Phase 5.3 split). The
// tiered bonus, the delta parser and its conditional-grant lookahead, and the
// write path that delegates to Shadowdark Enhancer when a GM has it installed.
// CarousingSD re-exports the public names, so its surface is unchanged.

import { MODULE_ID } from "./carousing-core.mjs";

export function getRenownBonus(renown) {
	if (renown >= 12) return 3;
	if (renown >= 8) return 2;
	if (renown >= 4) return 1;
	return 0;
}

// Special table rows that redirect to the other d100 table
// (CS6/Western Reaches: Benefit 01 and Mishap 100)
export const REROLL_AS_MISHAP = /re-?roll\s+this\s+benefit\s+as\s+a\s+mishap/i;

export const REROLL_AS_BENEFIT = /re-?roll\s+this\s+mishap\s+as\s+a\s+benefit/i;

// "+N renown" / "-N renown" in a result description. The lookahead skips
// conditional grants like "-1 renown if anyone sees it", which stay manual.
export const RENOWN_DELTA = /([+-]\d+)\s+renown(?!\s+if)/i;

/**
 * Extract the renown adjustment from a benefit/mishap description, if any.
 * @returns {number} the delta, or 0 when none applies
 */
export function parseRenownDelta(description) {
	const m = String(description || "").match(RENOWN_DELTA);
	return m ? (parseInt(m[1]) || 0) : 0;
}

/** Read the Shadowdark system's native renown value. */
export function getActorRenown(actor) {
	const value = Number(actor?.system?.renown);
	return Number.isFinite(value) ? value : 0;
}

/**
 * Apply a change to Shadowdark's native renown field. The system intentionally
 * permits negative renown, so do not impose the retired SDX min/max rules.
 *
 * When Shadowdark Enhancer is installed it owns the renown ledger, so hand the
 * change to its `award` API instead of writing the field ourselves: SDE commits
 * the value and its history row in one transaction and carries `reason` through
 * to the Session Recap, which a bare field write cannot do (SDE's watcher would
 * only see an anonymous "changed outside the module").
 *
 * Two constraints shape the guard:
 *  - SDE rejects player-side awards outright (its recap is a world setting only
 *    a GM may write), so only delegate from a GM client. Player-reachable paths
 *    keep the direct write and fall back to SDE's external-change watcher.
 *  - Any refusal still has to apply the renown. SDE reports `ok: false` without
 *    committing anything, so falling through to the direct write is safe and
 *    keeps a player from silently losing renown when SDE is unavailable.
 *
 * @param {Actor} actor
 * @param {number} delta signed change
 * @param {string} [reason] human-readable cause, recorded in SDE's renown log
 * @returns {Promise<number>} the delta actually applied
 */
export async function applyRenownDelta(actor, delta, reason = "") {
	if (!actor || !delta) return 0;

	// Reached through `globalThis` so the delta logic stays importable under
	// node:test, where no `game` binding exists at all.
	const g = globalThis.game;
	const sde = g?.user?.isGM && g.modules.get("shadowdark-enhancer")?.active
		? g.shadowdarkEnhancer?.renown
		: null;
	if (typeof sde?.award === "function") {
		try {
			// chat: false — SDX's own carousing card already reports the change.
			const result = await sde.award({
				actor,
				delta,
				reason: String(reason || ""),
				source: "carousing",
				chat: false,
			});
			// Trust SDE's number rather than the requested one: the session
			// stores it and replays it negated when a result is removed, so a
			// clamped award must not leave SDX holding a delta SDE never wrote.
			if (result?.ok) return Number(result.delta) || 0;
			console.warn(
				`${MODULE_ID} | renown: Shadowdark Enhancer declined the award, writing the field directly`,
				result?.error
			);
		}
		catch(err) {
			console.warn(
				`${MODULE_ID} | renown: Shadowdark Enhancer award failed, writing the field directly`,
				err
			);
		}
	}

	const current = getActorRenown(actor);
	const next = current + delta;
	await actor.update({ "system.renown": next });
	return delta;
}

/**
 * Move values from SDX's retired actor flag into native Shadowdark renown.
 * A nonzero native value always wins; this avoids overwriting system-owned data.
 * Legacy flags are removed after reconciliation so there is one source of truth.
 * @returns {Promise<number>} number of native values populated from legacy data
 */
export async function migrateLegacyRenown(actors = []) {
	let migrated = 0;
	for (const actor of actors) {
		if (actor?.type !== "Player") continue;
		const legacy = Number(actor.getFlag?.(MODULE_ID, "renown"));
		if (!Number.isFinite(legacy)) continue;

		if (getActorRenown(actor) === 0 && legacy !== 0) {
			await actor.update({ "system.renown": legacy });
			migrated++;
		}
		await actor.unsetFlag(MODULE_ID, "renown");
	}
	return migrated;
}
