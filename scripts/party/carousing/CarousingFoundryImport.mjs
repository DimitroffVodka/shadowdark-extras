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
			callback: (event, button, dialog) => dialog.element.querySelector("#sdx-foundry-table-select")?.value,
		},
		rejectClose: false,
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
			},
		},
		rejectClose: false,
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
	const skipped = [];
	const load = async uuid => {
		if (!uuid) return null;
		try {
			return await fromUuid(uuid);
		}
		catch{
			return null;
		}
	};

	// A linked RollTable in the wrong shape parses to rows that are entirely
	// empty — an Expanded outcome link pointing at an Original-format table,
	// for instance, yields 0 mishaps / 0 benefits / 0 xp for every row.
	// Overlaying that would silently wipe the values the GM configured, so a
	// section is only overlaid when the parse produced something usable.
	const overlay = (key, rows, isUsable, tableName) => {
		if (!rows?.length) return;
		if (rows.some(isUsable)) out[key] = rows;
		else skipped.push(tableName);
	};

	const eventTbl = await load(links.event);
	if (eventTbl) {
		overlay("tiers", tableResultsToEventTiers(eventTbl),
			t => t.cost || t.bonus || t.description, eventTbl.name);
	}

	const outcomeTbl = await load(links.outcome);
	if (outcomeTbl) {
		overlay("outcomes",
			mode === "expanded"
				? tableResultsToExpandedOutcomes(outcomeTbl)
				: tableResultsToOriginalOutcomes(outcomeTbl),
			mode === "expanded"
				? o => o.mishaps || o.benefits || o.modifier || o.xp
				: o => o.description || o.benefit,
			outcomeTbl.name);
	}

	if (mode === "expanded") {
		const benefitTbl = await load(links.benefit);
		if (benefitTbl) {
			overlay("benefits", tableResultsToDescriptionRows(benefitTbl), b => b.description, benefitTbl.name);
		}
		const mishapTbl = await load(links.mishap);
		if (mishapTbl) {
			overlay("mishaps", tableResultsToDescriptionRows(mishapTbl), m => m.description, mishapTbl.name);
		}
	}

	if (skipped.length && game.user?.isGM) {
		ui.notifications?.warn(game.i18n.format("SHADOWDARK_EXTRAS.carousing.link_format_mismatch", {
			tables: [...new Set(skipped)].join(", "),
		}));
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
		mishap: "SHADOWDARK_EXTRAS.carousing.tab_mishap",
	};
	const parts = [];
	for (const [key, uuid] of Object.entries(links)) {
		if (!uuid || !labels[key]) continue;
		let name = null;
		try {
			name = fromUuidSync(uuid)?.name ?? null;
		}
		catch{ /* pack not loaded */ }
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
		}
		else {
			for (let n = low; n <= high; n++) {
				rows.push({ roll: String(n), description });
			}
		}
	}
	return rows;
}

/**
 * Split a table entry on "|" column separators. RollTables authored outside
 * SDX overwhelmingly use a pipe to break one result into its columns — e.g.
 * "30 gp | A worthy night of drinking and festivity | +0" — instead of the
 * "Cost 30 gp, Event ..., Bonus +0" labels the companion builder emits.
 *
 * Leading/trailing blanks (a stray edge pipe) are dropped, but interior
 * blanks are kept so column positions stay stable for positional parsers.
 * @param {string} text
 * @returns {string[]|null} the trimmed columns, or null if the text has no pipe
 */
export function splitPipeFields(text) {
	const raw = String(text ?? "");
	if (!raw.includes("|")) return null;

	const fields = raw.split("|").map(f => f.replace(/\s+/g, " ").trim());
	while (fields.length && fields[0] === "") fields.shift();
	while (fields.length && fields[fields.length - 1] === "") fields.pop();
	return fields.length ? fields : null;
}

/** A bare roll-index column ("1", "07", "20+") rather than real content. */
const ROLL_COLUMN = /^\d{1,3}\+?$/;

/** A cost column ("30 gp", "1,200 gp"). */
const COST_COLUMN = /^[\d,]+\s*gp$/i;

/** A bonus column ("+0", "-1", "3"). */
const BONUS_COLUMN = /^[+-]?\d+$/;

/**
 * Parse a "-" / signed-integer field value: "-" means 0.
 */
function numField(text, re) {
	const m = text.match(re);
	if (!m) return 0;
	return m[1] === "-" ? 0 : (parseInt(m[1]) || 0);
}

/** Parse one numeric column; "-" and blanks mean 0. */
function numColumn(value) {
	const v = String(value ?? "").trim();
	if (!v || v === "-") return 0;
	return parseInt(v) || 0;
}

/**
 * Map pipe columns to an event tier. Understands
 * "[roll |] cost gp | description | bonus", with the cost and bonus columns
 * both optional — a lone description column stays a description.
 * @param {string[]} fields
 * @returns {{cost: number, bonus: number, description: string}}
 */
function pipeFieldsToEventTier(fields) {
	const f = [...fields];

	// Drop a leading roll-index column, but only when a cost column follows it
	// (so a numeric-looking description is never eaten).
	if (f.length > 2 && ROLL_COLUMN.test(f[0]) && COST_COLUMN.test(f[1])) f.shift();

	// Never consume the last remaining column — that is always the description.
	let cost = 0;
	if (f.length > 1 && COST_COLUMN.test(f[0])) cost = parseInt(f.shift().replace(/[^\d]/g, "")) || 0;

	let bonus = 0;
	if (f.length > 1 && BONUS_COLUMN.test(f[f.length - 1])) bonus = parseInt(f.pop()) || 0;

	return { cost, bonus, description: f.join(" ").trim() };
}

/**
 * Map pipe columns to a roll -> description row.
 * @param {string[]} fields
 * @param {number} fallbackRoll - used when the line carries no roll column
 * @returns {{roll: number, description: string}}
 */
function pipeFieldsToDescriptionRow(fields, fallbackRoll) {
	const f = [...fields];
	let roll = fallbackRoll;
	if (f.length > 1 && ROLL_COLUMN.test(f[0])) roll = parseInt(f.shift()) || roll;
	return { roll, description: f.join(" ").trim() };
}

/**
 * Map pipe columns to an Original outcome row.
 * @param {string[]} fields
 * @param {string|number} fallbackRoll - used when no roll column is present
 * @param {number} rollThreshold - column count at or above which the first
 *   column may be claimed as the roll. RollTable imports pass 3 (the result's
 *   range already supplies a roll, so only an explicit extra column wins);
 *   pasted text passes 2, since nothing else supplies one.
 * @returns {{roll: string, description: string, benefit: string}}
 */
function pipeFieldsToOriginalOutcome(fields, fallbackRoll, rollThreshold) {
	const f = [...fields];
	let roll = String(fallbackRoll ?? "");
	if (f.length >= rollThreshold && ROLL_COLUMN.test(f[0])) roll = f.shift();
	return {
		roll,
		description: (f.shift() || "").trim(),
		// Extra columns past the benefit are rare; keep them readable rather
		// than dropping content the GM authored.
		benefit: f.join(", ").trim(),
	};
}

/**
 * Map pipe columns to an Expanded outcome row:
 * "[roll |] mishaps | benefits | d100 modifier | xp".
 * @param {string[]} fields
 * @param {number} fallbackRoll
 * @returns {{roll: number, mishaps: number, benefits: number, modifier: number, xp: number}}
 */
function pipeFieldsToExpandedOutcome(fields, fallbackRoll) {
	const f = [...fields];
	let roll = fallbackRoll;
	if (f.length >= 5 && ROLL_COLUMN.test(f[0])) roll = parseInt(f.shift()) || roll;
	return {
		roll,
		mishaps: numColumn(f[0]),
		benefits: numColumn(f[1]),
		modifier: numColumn(f[2]),
		xp: numColumn(f[3]),
	};
}

/**
 * Parse one pasted line as pipe-delimited tier columns.
 * @param {string} line
 * @returns {{cost: number, bonus: number, description: string}|null} null when
 *   the line has no pipe, so callers fall back to their whitespace parser
 */
export function parsePipeTierLine(line) {
	const fields = splitPipeFields(line);
	return fields ? pipeFieldsToEventTier(fields) : null;
}

/**
 * Parse one pasted line as pipe-delimited Original outcome columns.
 * @param {string} line
 * @param {string|number} fallbackRoll
 * @returns {{roll: string, description: string, benefit: string}|null}
 */
export function parsePipeOutcomeLine(line, fallbackRoll) {
	const fields = splitPipeFields(line);
	return fields ? pipeFieldsToOriginalOutcome(fields, fallbackRoll, 2) : null;
}

/**
 * Parse one pasted line as pipe-delimited Expanded outcome columns.
 * @param {string} line
 * @param {number} fallbackRoll
 * @returns {{roll: number, mishaps: number, benefits: number, modifier: number, xp: number}|null}
 */
export function parsePipeExpandedOutcomeLine(line, fallbackRoll) {
	const fields = splitPipeFields(line);
	return fields ? pipeFieldsToExpandedOutcome(fields, fallbackRoll) : null;
}

/**
 * Parse one pasted line as pipe-delimited "roll | description" columns.
 * @param {string} line
 * @param {number} fallbackRoll
 * @returns {{roll: number, description: string}|null}
 */
export function parsePipeDescriptionLine(line, fallbackRoll) {
	const fields = splitPipeFields(line);
	return fields ? pipeFieldsToDescriptionRow(fields, fallbackRoll) : null;
}

/**
 * Convert a RollTable to simple roll -> description rows (Benefit / Mishap
 * d100 tables). A leading "roll |" column overrides the range-derived roll,
 * so both "01 | You drank with a gossiper" and a plain description work.
 * @param {RollTable} table
 * @returns {Array<{roll: number, description: string}>}
 */
export function tableResultsToDescriptionRows(table) {
	return tableResultsToRows(table).map(r => {
		const roll = parseInt(r.roll) || 0;
		const description = r.description || "";

		const fields = splitPipeFields(description);
		return fields ? pipeFieldsToDescriptionRow(fields, roll) : { roll, description };
	});
}

/**
 * Map a RollTable to Carousing Event tiers. Understands two layouts:
 * pipe-delimited columns ("30 gp | A worthy night... | +0") and the labeled
 * "Cost <n> gp, Event <text>, Bonus <±n>" text the companion table-builder
 * emits. Falls back to putting the whole text in the description.
 * @param {RollTable} table
 * @returns {Array<{cost: number, bonus: number, description: string}>}
 */
export function tableResultsToEventTiers(table) {
	return tableResultsToRows(table).map(r => {
		const t = r.description || "";

		const fields = splitPipeFields(t);
		if (fields) return pipeFieldsToEventTier(fields);

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

		// Pipe layout: "[roll |] mishaps | benefits | d100 modifier | xp".
		const fields = splitPipeFields(t);
		if (fields) return pipeFieldsToExpandedOutcome(fields, parseInt(r.roll) || 0);

		return {
			roll: parseInt(r.roll) || 0,
			mishaps: numField(t, /Mishap\s+([+-]?\d+|-)/i),
			benefits: numField(t, /Benefit\s+([+-]?\d+|-)/i),
			modifier: numField(t, /d100\s*Modifier\s+([+-]?\d+|-)/i),
			xp: numField(t, /XP\s+([+-]?\d+|-)/i),
		};
	});
}

/**
 * Map a RollTable to Original Carousing Outcome rows. Understands the pipe
 * layout "[roll |] description | benefit" and the labeled
 * "Outcome <text>, Benefit <text>" text; falls back to the whole text as the
 * outcome description (no benefit) for plain roll -> text tables.
 * @param {RollTable} table
 * @returns {Array<{roll: string, description: string, benefit: string}>}
 */
export function tableResultsToOriginalOutcomes(table) {
	return tableResultsToRows(table).map(r => {
		const t = r.description || "";

		const fields = splitPipeFields(t);
		if (fields) return pipeFieldsToOriginalOutcome(fields, r.roll, 3);

		const hasLabels = /Outcome\s+/i.test(t) && /,\s*Benefit\s+/i.test(t);
		if (hasLabels) {
			return {
				roll: r.roll,
				description: (t.match(/Outcome\s+(.*?)\s*,\s*Benefit/i)?.[1] || "").trim(),
				benefit: (t.match(/,\s*Benefit\s+(.*)$/i)?.[1] || "").trim(),
			};
		}
		return { roll: r.roll, description: t, benefit: "" };
	});
}
