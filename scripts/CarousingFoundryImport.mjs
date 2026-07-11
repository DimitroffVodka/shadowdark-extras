/**
 * Shared helpers for importing Foundry RollTables into carousing tables.
 * Used by both the Original (CarousingTablesApp) and Expanded
 * (ExpandedCarousingTablesApp) editors.
 */

const MODULE_ID = "shadowdark-extras";

/**
 * Build the `<optgroup>` HTML listing every world + compendium RollTable,
 * keyed by document UUID (so fromUuid() resolves either).
 * @returns {Promise<string>} the options HTML, or "" if no RollTables exist
 */
async function buildTableOptionGroups() {
    const esc = Handlebars.Utils.escapeExpression;
    const groups = [];

    // World tables
    const worldTables = [...(game.tables?.contents ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (worldTables.length) {
        const opts = worldTables
            .map(t => `<option value="${t.uuid}">${esc(t.name)} (${t.results.size})</option>`)
            .join("");
        groups.push(`<optgroup label="${esc(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.world_tables"))}">${opts}</optgroup>`);
    }

    // Compendium tables (index only — loaded on demand)
    const packs = game.packs.filter(p => p.metadata.type === "RollTable");
    for (const pack of packs) {
        const index = await pack.getIndex();
        if (!index.size) continue;
        const entries = [...index].sort((a, b) => a.name.localeCompare(b.name));
        const opts = entries
            .map(e => `<option value="${e.uuid}">${esc(e.name)}</option>`)
            .join("");
        groups.push(`<optgroup label="${esc(pack.metadata.label)}">${opts}</optgroup>`);
    }

    return groups.join("");
}

/**
 * Prompt the GM to choose a Foundry RollTable from the world or any
 * RollTable compendium. Options are keyed by document UUID so both world
 * and compendium tables resolve through fromUuid().
 * @returns {Promise<RollTable|null>} the selected table, or null if cancelled/none
 */
export async function pickFoundryTable() {
    const esc = Handlebars.Utils.escapeExpression;
    const groups = await buildTableOptionGroups();
    if (!groups) {
        ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.no_foundry_tables"));
        return null;
    }

    const content = `
        <div class="form-group">
            <label>${esc(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.select_foundry_table"))}</label>
            <select id="sdx-foundry-table-select" style="width:100%">${groups}</select>
        </div>
    `;

    const uuid = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.from_foundry_table") },
        content,
        ok: {
            label: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.import"),
            callback: (event, button, dialog) => dialog.element.querySelector("#sdx-foundry-table-select")?.value
        },
        rejectClose: false
    });

    if (!uuid) return null;
    const table = await fromUuid(uuid);
    if (!table) {
        ui.notifications.error(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.table_not_found"));
        return null;
    }
    return table;
}

/**
 * Prompt the GM to build a whole carousing table from several Foundry
 * RollTables at once — one dropdown per sub-table, plus a name field.
 * @param {Array<{key: string, label: string}>} fields - the sub-tables to pick
 * @returns {Promise<{name: string, tables: Object<string, RollTable|null>}|null>}
 */
export async function pickMultipleFoundryTables(fields) {
    const esc = Handlebars.Utils.escapeExpression;
    const groups = await buildTableOptionGroups();
    if (!groups) {
        ui.notifications.warn(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.no_foundry_tables"));
        return null;
    }

    const noneLabel = esc(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.none"));
    const selects = fields.map(f => `
        <div class="form-group">
            <label>${esc(f.label)}</label>
            <select name="sdx-ft-${f.key}" style="width:100%">
                <option value="">— ${noneLabel} —</option>
                ${groups}
            </select>
        </div>
    `).join("");

    const content = `
        <div class="form-group">
            <label>${esc(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.table_name"))}</label>
            <input type="text" name="sdx-ft-name" style="width:100%"
                placeholder="${esc(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.table_name_placeholder"))}" />
        </div>
        ${selects}
    `;

    const picked = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.link_foundry_tables") },
        content,
        ok: {
            label: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.import"),
            callback: (event, button, dialog) => {
                const root = dialog.element;
                const out = { name: root.querySelector('[name="sdx-ft-name"]')?.value?.trim() || "", uuids: {} };
                for (const f of fields) out.uuids[f.key] = root.querySelector(`[name="sdx-ft-${f.key}"]`)?.value || "";
                return out;
            }
        },
        rejectClose: false
    });

    if (!picked) return null;

    const tables = {};
    for (const f of fields) {
        tables[f.key] = picked.uuids[f.key] ? (await fromUuid(picked.uuids[f.key])) : null;
    }
    return { name: picked.name, tables, uuids: picked.uuids };
}

/**
 * Resolve a carousing table's stored RollTable links into parsed section
 * data. Only sections whose link resolves are returned, so callers can
 * overlay the result onto the stored record.
 * @param {Object<string,string>} links - { event, outcome, benefit, mishap } UUIDs
 * @param {"original"|"expanded"} mode - controls how the outcome table is parsed
 * @returns {Promise<{tiers?: [], outcomes?: [], benefits?: [], mishaps?: []}>}
 */
export async function resolveLinkedData(links = {}, mode = "original") {
    const out = {};
    const load = async (uuid) => {
        if (!uuid) return null;
        try { return await fromUuid(uuid); } catch { return null; }
    };

    const eventTbl = await load(links.event);
    if (eventTbl) out.tiers = tableResultsToEventTiers(eventTbl);

    const outcomeTbl = await load(links.outcome);
    if (outcomeTbl) {
        out.outcomes = mode === "expanded"
            ? tableResultsToExpandedOutcomes(outcomeTbl)
            : tableResultsToOriginalOutcomes(outcomeTbl);
    }

    if (mode === "expanded") {
        const toDescRows = (tbl) => tableResultsToRows(tbl)
            .map(r => ({ roll: parseInt(r.roll) || 0, description: r.description }));
        const benefitTbl = await load(links.benefit);
        if (benefitTbl) out.benefits = toDescRows(benefitTbl);
        const mishapTbl = await load(links.mishap);
        if (mishapTbl) out.mishaps = toDescRows(mishapTbl);
    }

    return out;
}

/**
 * Human-readable summary of a links object ("Carousing Event: X • ..."),
 * resolving names synchronously (world docs and compendium index entries).
 * @param {Object<string,string>} links
 * @returns {string}
 */
export function describeLinks(links = {}) {
    const labels = {
        event: "SHADOWDARK_EXTRAS.carousing.tab_event",
        outcome: "SHADOWDARK_EXTRAS.carousing.tab_outcome",
        benefit: "SHADOWDARK_EXTRAS.carousing.tab_benefit",
        mishap: "SHADOWDARK_EXTRAS.carousing.tab_mishap"
    };
    const parts = [];
    for (const [key, uuid] of Object.entries(links)) {
        if (!uuid || !labels[key]) continue;
        let name = null;
        try { name = fromUuidSync(uuid)?.name ?? null; } catch { /* pack not loaded */ }
        parts.push(`${game.i18n.localize(labels[key])}: ${name || "?"}`);
    }
    return parts.join(" • ");
}

/**
 * Convert a Foundry RollTable's results into carousing rows.
 * The carousing matchers only understand exact "N" and "N+" rolls, so
 * multi-value ranges are expanded into one row per value.
 * @param {RollTable} table
 * @returns {Array<{roll: string, description: string}>}
 */
export function tableResultsToRows(table) {
    const results = [...table.results].sort(
        (a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0)
    );

    const rows = [];
    for (const r of results) {
        // Document results carry their label in `name`; text results in `description`.
        const raw = r.type === CONST.TABLE_RESULT_TYPES.DOCUMENT
            ? (r.name || r.description)
            : (r.description || r.name);
        const description = String(raw || "")
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim();

        const low = Number.isFinite(r.range?.[0]) ? r.range[0] : rows.length + 1;
        const high = Number.isFinite(r.range?.[1]) ? r.range[1] : low;
        const span = high - low + 1;

        // Expand normal ranges; guard against a pathologically wide single range.
        if (span <= 1 || span > 200) {
            rows.push({ roll: String(low), description });
        } else {
            for (let n = low; n <= high; n++) {
                rows.push({ roll: String(n), description });
            }
        }
    }
    return rows;
}

/**
 * Parse a "-" / signed-integer field value: "-" means 0.
 */
function numField(text, re) {
    const m = text.match(re);
    if (!m) return 0;
    return m[1] === "-" ? 0 : (parseInt(m[1]) || 0);
}

/**
 * Map a RollTable to Carousing Event tiers. Expects each result to be labeled
 * "Cost <n> gp, Event <text>, Bonus <±n>" (the format produced by the
 * companion table-builder). Falls back to putting the whole text in the
 * description for tables that don't follow the convention.
 * @param {RollTable} table
 * @returns {Array<{cost: number, bonus: number, description: string}>}
 */
export function tableResultsToEventTiers(table) {
    return tableResultsToRows(table).map(r => {
        const t = r.description || "";
        const hasLabels = /Cost\s+[\d,]+/i.test(t) && /Bonus\s+[+-]?\d+/i.test(t);
        const cost = parseInt((t.match(/Cost\s+([\d,]+)/i)?.[1] || "0").replace(/,/g, "")) || 0;
        const bonus = parseInt(t.match(/Bonus\s+([+-]?\d+)/i)?.[1] || "0") || 0;
        const description = hasLabels
            ? (t.match(/Event\s+(.*?)\s*,\s*Bonus/i)?.[1] || "").trim()
            : t;
        return { cost, bonus, description };
    });
}

/**
 * Map a RollTable to Expanded Carousing Outcome rows. Expects each result to
 * be labeled "Mishap <n|->, Benefit <n|->, d100 Modifier <±n|->, XP <n>".
 * Missing fields default to 0, so a non-conforming table still seeds rolls.
 * @param {RollTable} table
 * @returns {Array<{roll: number, mishaps: number, benefits: number, modifier: number, xp: number}>}
 */
export function tableResultsToExpandedOutcomes(table) {
    return tableResultsToRows(table).map(r => {
        const t = r.description || "";
        return {
            roll: parseInt(r.roll) || 0,
            mishaps: numField(t, /Mishap\s+([+-]?\d+|-)/i),
            benefits: numField(t, /Benefit\s+([+-]?\d+|-)/i),
            modifier: numField(t, /d100\s*Modifier\s+([+-]?\d+|-)/i),
            xp: numField(t, /XP\s+([+-]?\d+|-)/i)
        };
    });
}

/**
 * Map a RollTable to Original Carousing Outcome rows. Expects each result to
 * be labeled "Outcome <text>, Benefit <text>"; falls back to the whole text
 * as the outcome description (no benefit) for plain roll -> text tables.
 * @param {RollTable} table
 * @returns {Array<{roll: string, description: string, benefit: string}>}
 */
export function tableResultsToOriginalOutcomes(table) {
    return tableResultsToRows(table).map(r => {
        const t = r.description || "";
        const hasLabels = /Outcome\s+/i.test(t) && /,\s*Benefit\s+/i.test(t);
        if (hasLabels) {
            return {
                roll: r.roll,
                description: (t.match(/Outcome\s+(.*?)\s*,\s*Benefit/i)?.[1] || "").trim(),
                benefit: (t.match(/,\s*Benefit\s+(.*)$/i)?.[1] || "").trim()
            };
        }
        return { roll: r.roll, description: t, benefit: "" };
    });
}
