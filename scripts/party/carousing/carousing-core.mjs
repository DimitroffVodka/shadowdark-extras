// Carousing core domain — extracted from
// scripts/party/carousing/CarousingSD.mjs (Phase 5.1 split).
// Constants, module state, linked-data cache, mode/tier/outcome getters,
// expanded tables CRUD, journal lookup + sync journal, custom tables,
// dropbox/session state, participant/tier/confirmation setters, results.

export const MODULE_ID = "shadowdark-extras";
const CAROUSING_JOURNAL_NAME = "__sdx_carousing_sync__";
const CAROUSING_TABLES_JOURNAL_NAME = "__sdx_carousing_tables__";

// Track active tab per player sheet (by actor ID) for persistence
const carousingActiveTabTracker = new Map();

// Cached journal references
let _carousingJournal = null;
let _carousingTablesJournal = null;

// Live data resolved from linked Foundry RollTables (tableId -> partial data).
// Refreshed by refreshLinkedCarousingTables(); overlaid onto stored records by
// the sync getters so linked tables always reflect the current RollTables.
const _linkedDataCache = new Map();

/**
 * Re-resolve every linked carousing table for the active mode from its source
 * RollTables. Async (compendium loads); call before rendering the overlay or
 * executing rolls. Sync getters then serve the refreshed data.
 */
export async function refreshLinkedCarousingTables() {
	const { resolveLinkedData } = await import("./CarousingFoundryImport.mjs");
	const mode = getCarousingMode();
	const records = mode === "expanded" ? getExpandedCarousingTables() : getCustomCarousingTables();
	for (const rec of records) {
		if (!rec?.links || !Object.values(rec.links).some(Boolean)) continue;
		try {
			_linkedDataCache.set(rec.id, await resolveLinkedData(rec.links, mode));
		}
		catch(err) {
			console.warn(`${MODULE_ID} | Failed to refresh linked carousing table "${rec.name}"`, err);
		}
	}
}

/**
 * Overlay live linked data (if any) onto a stored carousing table record.
 */
function applyLinkedData(record) {
	const cached = record?.id ? _linkedDataCache.get(record.id) : null;
	if (!cached) return record;
	const merged = { ...record };
	for (const key of ["tiers", "outcomes", "benefits", "mishaps"]) {
		if (cached[key]) merged[key] = cached[key];
	}
	return merged;
}

// ============================================
// CAROUSING DATA TABLES
// Original mode uses ONLY custom tables created by GM
// ============================================

/**
 * Original Carousing - No default tables (GM must create custom tables)
 * These empty arrays are kept for backwards compatibility
 */
const CAROUSING_TIERS = [];
const CAROUSING_OUTCOMES = [];

// ============================================
// EXPANDED CAROUSING DATA TABLES
// Empty templates - GM must configure via Settings
// ============================================

/**
 * Expanded Carousing Tiers - Empty template (10 tiers)
 * GM configures via Settings > Edit Expanded Tables
 */
const EXPANDED_CAROUSING_TIERS = [
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
	{ cost: 0, bonus: 0, description: "" },
];

/**
 * Expanded Outcome Table (d8 + tier bonus) - Empty template (25 rows)
 * GM configures via Settings > Edit Expanded Tables
 */
const EXPANDED_OUTCOME_TABLE = [
	{ roll: 1, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 2, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 3, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 4, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 5, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 6, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 7, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 8, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 9, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 10, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 11, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 12, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 13, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 14, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 15, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 16, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 17, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 18, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 19, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 20, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 21, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 22, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 23, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 24, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
	{ roll: 25, mishaps: 0, benefits: 0, modifier: 0, xp: 0 },
];

/**
 * Expanded Benefits Table (d100) - Empty template
 * GM configures via Settings > Edit Expanded Tables
 */
const EXPANDED_BENEFITS = Array.from({ length: 100 }, (_, i) => ({ roll: i + 1, description: "" }));

/**
 * Expanded Mishaps Table (d100) - Empty template
 * GM configures via Settings > Edit Expanded Tables
 */
const EXPANDED_MISHAPS = Array.from({ length: 100 }, (_, i) => ({ roll: i + 1, description: "" }));
// ============================================
// JOURNAL AND STATE MANAGEMENT
// ============================================
/**
 * Initialize the carousing system
 */

export function initCarousing() {
	console.log(`${MODULE_ID} | Carousing system initialized`);
}

/**
 * Get the current carousing mode setting
 * @returns {"original"|"expanded"}
 */
export function getCarousingMode() {
	try {
		return game.settings.get(MODULE_ID, "carousingMode") || "original";
	}
	catch{
		return "original";
	}
}

/**
 * Get the tiers for the current carousing mode
 * Returns either Original or Expanded tiers based on setting
 */
export function getActiveCarousingTiers() {
	const mode = getCarousingMode();
	return mode === "expanded" ? EXPANDED_CAROUSING_TIERS : CAROUSING_TIERS;
}

/**
 * Get expanded outcome based on d8 roll (uses editable data)
 */
export function getExpandedOutcome(rollTotal) {
	const data = getExpandedCarousingData();
	const outcomes = data.outcomes || EXPANDED_OUTCOME_TABLE;
	const capped = Math.min(rollTotal, 25);
	return outcomes.find(o => o.roll === capped) || outcomes[outcomes.length - 1];
}

/**
 * Get expanded benefit by d100 roll (uses editable data)
 */
export function getExpandedBenefit(rollTotal) {
	const data = getExpandedCarousingData();
	const benefits = data.benefits || EXPANDED_BENEFITS;
	const capped = Math.max(1, Math.min(rollTotal, 100));
	return benefits.find(b => b.roll === capped) || { roll: capped, description: `Benefit result ${capped} (customize via table editor)` };
}

/**
 * Get expanded mishap by d100 roll
 */
export function getExpandedMishap(rollTotal) {
	const capped = Math.max(1, Math.min(rollTotal, 100));
	const data = getExpandedCarousingData();
	const mishaps = data.mishaps || EXPANDED_MISHAPS;
	return mishaps.find(m => m.roll === capped) || { roll: capped, description: `Mishap result ${capped} (customize via table editor)` };
}

// ============================================
// EXPANDED CAROUSING DATA MANAGEMENT
// ============================================

/**
 * Get the default expanded carousing data (hardcoded values)
 */
export function getDefaultExpandedData() {
	return {
		id: "default",
		name: "Shadowdark Expanded (Default)",
		tiers: EXPANDED_CAROUSING_TIERS.map(t => ({ cost: t.cost, bonus: t.bonus })),
		outcomes: EXPANDED_OUTCOME_TABLE.map(o => ({
			roll: o.roll,
			benefits: o.benefits,
			mishaps: o.mishaps,
			modifier: o.modifier,
			xp: o.xp,
		})),
		benefits: EXPANDED_BENEFITS.map(b => ({ roll: b.roll, description: b.description })),
		mishaps: EXPANDED_MISHAPS.map(m => ({ roll: m.roll, description: m.description })),
	};
}

/**
 * Get all expanded carousing tables from journal
 */
export function getExpandedCarousingTables() {
	const journal = getCarousingTablesJournal();
	if (!journal) return [];

	// Check for migration from old settings
	let tables = journal.getFlag(MODULE_ID, "expandedTables") || [];
	if (tables.length === 0) {
		// Try to migrate from settings if journal is empty
		try {
			const settingsData = game.settings.get(MODULE_ID, "expandedCarousingData");
			if (settingsData && settingsData.tiers) {
				// We have legacy settings data, convert to a table
				const migratedTable = {
					...settingsData,
					id: foundry.utils.randomID(),
					name: "Imported Settings",
				};
				// We can't save here easily without async, but we can return it
				// The next save operation will persist it
				tables = [migratedTable];
			}
		}
		catch(e) {
			// No legacy data
		}

		// If still empty, use default
		if (tables.length === 0) {
			tables = [getDefaultExpandedData()];
		}
	}

	return tables;
}

/**
 * Save all expanded carousing tables to journal
 */
export async function saveExpandedCarousingTables(tables) {
	const journal = getCarousingTablesJournal();
	if (!journal) {
		console.error(`${MODULE_ID} | Carousing tables journal not found!`);
		return;
	}
	await journal.setFlag(MODULE_ID, "expandedTables", tables);
}

/**
 * Get active expanded carousing table data
 * Uses session selectedTableId if available, otherwise first table
 */
export function getExpandedCarousingData() {
	const session = getCarousingSession();
	const tables = getExpandedCarousingTables();

	if (session && session.selectedTableId) {
		const table = tables.find(t => t.id === session.selectedTableId);
		if (table) return applyLinkedData(table);
	}

	// Fallback to first table or default
	return applyLinkedData(tables[0]) || getDefaultExpandedData();
}

/**
 * Legacy support: Save single table data (now saves to the first table or updates by ID)
 * This is kept for compatibility if needed, but the App should now use saveExpandedCarousingTables
 */
export async function saveExpandedCarousingData(data) {
	const tables = getExpandedCarousingTables();
	const index = tables.findIndex(t => t.id === data.id);

	if (index >= 0) {
		tables[index] = data;
	}
	else {
		tables.push(data);
	}

	await saveExpandedCarousingTables(tables);
}

/**
 * Get expanded outcome based on d8 roll (uses editable data)
 */
function getExpandedOutcomeFromData(rollTotal) {
	const data = getExpandedCarousingData();
	const outcomes = data.outcomes || EXPANDED_OUTCOME_TABLE;
	const capped = Math.min(rollTotal, 25);
	return outcomes.find(o => o.roll === capped) || outcomes[outcomes.length - 1];
}

/**
 * Get expanded benefit by d100 roll (uses editable data)
 */
function getExpandedBenefitFromData(rollTotal) {
	const data = getExpandedCarousingData();
	const benefits = data.benefits || EXPANDED_BENEFITS;
	const capped = Math.max(1, Math.min(rollTotal, 100));
	return benefits.find(b => b.roll === capped) || { roll: capped, description: `Benefit result ${capped}` };
}

/**
 * Get expanded mishap by d100 roll (uses editable data)
 */
function getExpandedMishapFromData(rollTotal) {
	const data = getExpandedCarousingData();
	const mishaps = data.mishaps || EXPANDED_MISHAPS;
	const capped = Math.max(1, Math.min(rollTotal, 100));
	return mishaps.find(m => m.roll === capped) || { roll: capped, description: `Mishap result ${capped}` };
}


/**
 * Get the carousing journal entry
 */
export function getCarousingJournal() {
	if (_carousingJournal && game.journal.get(_carousingJournal.id)) {
		return _carousingJournal;
	}
	_carousingJournal = game.journal.find(j => j.name === CAROUSING_JOURNAL_NAME);
	return _carousingJournal;
}

/**
 * Ensure the carousing journal exists (called by GM on ready)
 */
export async function ensureCarousingJournal() {
	if (!game.user.isGM) return;

	let journal = game.journal.find(j => j.name === CAROUSING_JOURNAL_NAME);

	if (!journal) {
		console.log(`${MODULE_ID} | Creating carousing sync journal...`);
		journal = await JournalEntry.create({
			name: CAROUSING_JOURNAL_NAME,
			ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
			flags: {
				[MODULE_ID]: {
					isCarousingJournal: true,
				},
			},
		});
		console.log(`${MODULE_ID} | Carousing sync journal created:`, journal.id);
	}
	else if (journal.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
		await journal.update({
			ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
		});
	}

	_carousingJournal = journal;
	return journal;
}

// ============================================
// CUSTOM TABLES JOURNAL MANAGEMENT
// ============================================

/**
 * Get the custom carousing tables journal
 */
export function getCarousingTablesJournal() {
	if (_carousingTablesJournal && game.journal.get(_carousingTablesJournal.id)) {
		return _carousingTablesJournal;
	}
	_carousingTablesJournal = game.journal.find(j => j.name === CAROUSING_TABLES_JOURNAL_NAME);
	return _carousingTablesJournal;
}

/**
 * Ensure the custom tables journal exists (called by GM on ready)
 */
export async function ensureCarousingTablesJournal() {
	if (!game.user.isGM) return;

	let journal = game.journal.find(j => j.name === CAROUSING_TABLES_JOURNAL_NAME);

	if (!journal) {
		console.log(`${MODULE_ID} | Creating carousing tables journal...`);
		journal = await JournalEntry.create({
			name: CAROUSING_TABLES_JOURNAL_NAME,
			ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
			flags: {
				[MODULE_ID]: {
					isCarousingTablesJournal: true,
					customTables: [],
				},
			},
		});
		console.log(`${MODULE_ID} | Carousing tables journal created:`, journal.id);
	}

	_carousingTablesJournal = journal;
	return journal;
}

/**
 * Get all custom carousing tables
 */
export function getCustomCarousingTables() {
	const journal = getCarousingTablesJournal();
	if (!journal) return [];
	return journal.getFlag(MODULE_ID, "customTables") || [];
}

/**
 * Save all custom carousing tables
 */
export async function saveCustomCarousingTables(tables) {
	const journal = getCarousingTablesJournal();
	if (!journal) {
		console.error(`${MODULE_ID} | Custom tables journal not found!`);
		return;
	}
	await journal.setFlag(MODULE_ID, "customTables", tables);
}

/**
 * Get a specific carousing table by ID (or "default" for built-in)
 * Returns { tiers, outcomes, name }
 * Note: Since default tables are now empty, this will return first custom table if available
 */
export function getCarousingTableById(tableId) {
	const customTables = getCustomCarousingTables();

	// If a specific custom table ID is provided, find it
	if (tableId && tableId !== "default") {
		const table = customTables.find(t => t.id === tableId);
		if (table) {
			return applyLinkedData(table);
		}
	}

	// Default table is now empty - auto-select first custom table if available
	if (customTables.length > 0) {
		return applyLinkedData(customTables[0]);
	}

	// Fallback to empty default (will show "no tables" message)
	return {
		id: "default",
		name: game.i18n.localize("SHADOWDARK_EXTRAS.carousing.default_table"),
		tiers: CAROUSING_TIERS,
		outcomes: CAROUSING_OUTCOMES,
	};
}

/**
 * Get carousing gm-added actors
 */
export function getCarousingGmActors() {
	const journal = getCarousingJournal();
	if (!journal) return [];
	return journal.getFlag(MODULE_ID, "carousingGmActors") || [];
}

/**
 * Get carousing drops state
 */
export function getCarousingDrops() {
	const journal = getCarousingJournal();
	if (!journal) return {};
	return journal.getFlag(MODULE_ID, "carousingDrops") || {};
}

/**
 * Save carousing drops state
 */
export async function saveCarousingDrops(state) {
	const journal = getCarousingJournal();
	if (!journal) {
		console.error(`${MODULE_ID} | Carousing journal not found!`);
		return;
	}
	await journal.setFlag(MODULE_ID, "carousingDrops", state);
}

/**
 * Get carousing session state
 */
export function getCarousingSession() {
	const journal = getCarousingJournal();
	const defaultSession = { selectedTableId: "default", selectedTier: null, confirmations: {}, phase: "setup", results: {}, modifiers: {} };
	if (!journal) return defaultSession;
	const session = journal.getFlag(MODULE_ID, "carousingSession") || defaultSession;
	if (!session.modifiers) session.modifiers = {};
	return session;
}

/**
 * Save carousing session state
 */
export async function saveCarousingSession(session, { replaceResults = false } = {}) {
	const journal = getCarousingJournal();
	if (!journal) {
		console.error(`${MODULE_ID} | Carousing journal not found!`);
		return;
	}
	if (replaceResults) {
		await journal.update({
			[`flags.${MODULE_ID}.carousingSession.results`]:
                new foundry.data.operators.ForcedDeletion(),
		});
	}
	await journal.setFlag(MODULE_ID, "carousingSession", session);
}

/**
 * Set actor drop for a user
 */
export async function setCarousingDrop(userId, actorId) {
	const journal = getCarousingJournal();
	if (!journal) return;

	// Flag objects merge on update, so removed keys need Foundry's deletion
	// operator. Mutating a local copy and writing it back leaves the key in the
	// stored data — which is how cleared drops came back on reload and how
	// results were stranded without a participant.
	const base = `flags.${MODULE_ID}.carousingSession`;
	const updates = {
		// Always clear confirmation and results when the actor changes or is removed
		[`${base}.confirmations.${userId}`]: new foundry.data.operators.ForcedDeletion(),
		[`${base}.results.${userId}`]: new foundry.data.operators.ForcedDeletion(),
	};

	if (actorId) {
		updates[`flags.${MODULE_ID}.carousingDrops.${userId}`] = actorId;
	}
	else {
		updates[`flags.${MODULE_ID}.carousingDrops.${userId}`] =
            new foundry.data.operators.ForcedDeletion();
	}

	await journal.update(updates);
}

/**
 * Set tier selection (GM only)
 */
export async function setCarousingTier(tierIndex) {
	if (!game.user.isGM) return;
	const journal = getCarousingJournal();
	if (!journal) return;

	const currentSession = getCarousingSession();
	const session = {
		selectedTableId: currentSession.selectedTableId || "default",
		selectedTier: tierIndex,
		confirmations: {},
		phase: "setup",
		results: {},
	};

	await journal.update({
		[`flags.${MODULE_ID}.carousingSession`]: session,
	});
}

/**
 * Set table selection (GM only)
 */
export async function setCarousingTable(tableId) {
	if (!game.user.isGM) return;
	const journal = getCarousingJournal();
	if (!journal) return;

	// Reset everything when table changes
	const session = {
		selectedTableId: tableId || "default",
		selectedTier: null,
		confirmations: {},
		phase: "setup",
		results: {},
	};

	await journal.update({
		[`flags.${MODULE_ID}.carousingSession`]: session,
		[`flags.${MODULE_ID}.carousingDrops`]: new foundry.data.operators.ForcedDeletion(),
	});

	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { rerenderPlayerSheets } = await import("./CarousingSD.mjs");
	rerenderPlayerSheets();
}

/**
 * Set player confirmation
 */
export async function setPlayerConfirmation(userId, confirmed) {
	const journal = getCarousingJournal();
	if (!journal) return;

	// A plain delete on the session object only ever changed the in-memory copy,
	// so the confirmation reappeared on the next reload.
	const key = `flags.${MODULE_ID}.carousingSession.confirmations`;
	await journal.update(confirmed
		? { [`${key}.${userId}`]: true }
		: { [`${key}.${userId}`]: new foundry.data.operators.ForcedDeletion() });
}

/**
 * Set player roll modifier
 * @param {string} userId - The user ID
 * @param {string} type - 'outcome', 'benefits', or 'mishaps'
 * @param {string} value - The modifier value (static or dice string)
 */
export async function setPlayerModifier(userId, type, value) {
	const journal = getCarousingJournal();
	if (!journal) return;

	// Same merge caveat: clearing a modifier needs a deletion operator, or the
	// old value survives in the stored session.
	const key = `flags.${MODULE_ID}.carousingSession.modifiers.${userId}`;
	await journal.update(!value || value.trim() === ""
		? { [`${key}.${type}`]: new foundry.data.operators.ForcedDeletion() }
		: { [`${key}.${type}`]: value.trim() });
	// Don't re-render everything on every keystroke if called from input,
	// but useful for sync
}

/**
 * Add a GM-managed participant (offline/unassigned actor)
 */
export async function addGmParticipant(actorId) {
	if (!game.user.isGM) return;
	const journal = getCarousingJournal();
	if (!journal) return;

	const gmActors = getCarousingGmActors();
	if (gmActors.includes(actorId)) return;

	gmActors.push(actorId);
	await journal.setFlag(MODULE_ID, "carousingGmActors", gmActors);
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { rerenderPlayerSheets } = await import("./CarousingSD.mjs");
	rerenderPlayerSheets();
}

/**
 * Remove a GM-managed participant
 */
export async function removeGmParticipant(actorId) {
	if (!game.user.isGM) return;
	const journal = getCarousingJournal();
	if (!journal) return;

	let gmActors = getCarousingGmActors();
	gmActors = gmActors.filter(id => id !== actorId);

	// Flag objects MERGE on update, so mutating a local copy and writing it
	// back does not remove keys — the deletion operator is required. Without it
	// the confirmation, result and modifier all survived the removal, which is
	// how results ended up stranded without a participant to render them.
	const participantId = `actor-${actorId}`;
	const base = `flags.${MODULE_ID}.carousingSession`;
	await journal.update({
		[`flags.${MODULE_ID}.carousingGmActors`]: gmActors,
		[`${base}.confirmations.${participantId}`]: new foundry.data.operators.ForcedDeletion(),
		[`${base}.results.${participantId}`]: new foundry.data.operators.ForcedDeletion(),
		[`${base}.modifiers.${participantId}`]: new foundry.data.operators.ForcedDeletion(),
	});
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { rerenderPlayerSheets } = await import("./CarousingSD.mjs");
	rerenderPlayerSheets();
}


/**
 * Reset carousing session (GM only)
 */
export async function resetCarousingSession() {
	if (!game.user.isGM) return;
	const journal = getCarousingJournal();
	if (!journal) {
		ui.notifications.error(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.no_journal"));
		return;
	}

	ui.notifications.info(game.i18n.localize("SHADOWDARK_EXTRAS.carousing.resetting"));

	// Forcefully wipe the flags via ForcedDeletion sentinel (v14+)
	await journal.update({
		[`flags.${MODULE_ID}.carousingSession`]: new foundry.data.operators.ForcedDeletion(),
		[`flags.${MODULE_ID}.carousingDrops`]: new foundry.data.operators.ForcedDeletion(),
	});

	// Manually trigger local re-render immediately so the GM sees it instantly
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { rerenderPlayerSheets } = await import("./CarousingSD.mjs");
	rerenderPlayerSheets();
}

/**
 * Add an extra benefit or mishap result for a user
 * @param {string} userId - The user ID
 * @param {string} type - "benefit" or "mishap"
 * @returns {Object} The new result that was added, or null if failed
 */
export async function addCarousingResult(userId, type) {
	const session = getCarousingSession();
	if (!session.results || !session.results[userId]) {
		console.warn("No results found for user", userId);
		return null;
	}

	// Permission check: players can only modify their own, GM can modify any
	if (!game.user.isGM && game.user.id !== userId) {
		ui.notifications.warn("You can only modify your own results");
		return null;
	}

	if (type !== "benefit" && type !== "mishap") {
		console.warn("Invalid type:", type);
		return null;
	}

	// Roll 1d100, honoring the "re-roll this benefit as a mishap" (and
	// vice-versa) special rows — the result may land in the other list.
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { rollExpandedD100 } = await import("./CarousingSD.mjs");
	const rolled = await rollExpandedD100(type, 0, {});
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { applyRenownDelta } = await import("./CarousingSD.mjs");
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { getParticipantActor } = await import("./CarousingSD.mjs");
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { parseRenownDelta } = await import("./CarousingSD.mjs");
	const newResult = {
		diceRoll: rolled.diceRoll,
		percentMod: 0,
		adjustment: 0,
		finalRoll: rolled.finalRoll,
		description: rolled.description,
		renownDelta: await applyRenownDelta(
			getParticipantActor(userId),
			parseRenownDelta(rolled.description),
			rolled.description
		),
	};
	const arrayKey = rolled.type === "benefit" ? "benefits" : "mishaps";
	if (!session.results[userId][arrayKey]) {
		session.results[userId][arrayKey] = [];
	}
	session.results[userId][arrayKey].push(newResult);

	await saveCarousingSession(session);
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { rerenderPlayerSheets } = await import("./CarousingSD.mjs");
	rerenderPlayerSheets();

	return newResult;
}

/**
 * Remove a benefit or mishap result for a user by index
 * @param {string} userId - The user ID
 * @param {string} type - "benefit" or "mishap"
 * @param {number} index - The index of the result to remove
 * @returns {boolean} Whether the removal was successful
 */
export async function removeCarousingResult(userId, type, index) {
	const session = getCarousingSession();
	if (!session.results || !session.results[userId]) {
		console.warn("No results found for user", userId);
		return false;
	}

	// Permission check: players can only modify their own, GM can modify any
	if (!game.user.isGM && game.user.id !== userId) {
		ui.notifications.warn("You can only modify your own results");
		return false;
	}

	const arrayKey = type === "benefit" ? "benefits" : "mishaps";
	const arr = session.results[userId][arrayKey];

	if (!arr || index < 0 || index >= arr.length) {
		console.warn("Invalid index:", index, "for", arrayKey);
		return false;
	}

	// Remove the item, reverting any renown it auto-applied
	const [removed] = arr.splice(index, 1);
	if (removed?.renownDelta) {
		// Logged as its own reversing entry rather than erasing the original —
		// SDE's renown history is a ledger and does not rewrite past rows.
		// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
		const { applyRenownDelta } = await import("./CarousingSD.mjs");
		// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
		const { getParticipantActor } = await import("./CarousingSD.mjs");
		await applyRenownDelta(
			getParticipantActor(userId),
			-removed.renownDelta,
			game.i18n.localize("SHADOWDARK_EXTRAS.carousing.renown_reason_removed")
		);
	}

	await saveCarousingSession(session);
	// Dynamic import breaks the core<->SD cycle (Phase 5.1 split)
	const { rerenderPlayerSheets } = await import("./CarousingSD.mjs");
	rerenderPlayerSheets();

	return true;
}

/**
 * Prune carousing data for offline players (GM only)
 */
export async function pruneOfflineCarousingData() {
	if (!game.user.isGM) return;

	const journal = getCarousingJournal();
	if (!journal) return;

	const drops = getCarousingDrops();
	const session = getCarousingSession();
	const isOffline = userId => {
		const user = game.users.get(userId);
		return !user || !user.active;
	};

	// Keys are removed with Foundry's deletion operator; writing a mutated copy
	// back would merge and leave every "pruned" entry in place.
	const updates = {};
	const base = `flags.${MODULE_ID}.carousingSession`;

	// Check drops. A rolled result is preserved so a player going offline
	// cannot strand an outcome the GM has not applied yet.
	for (const userId of Object.keys(drops)) {
		if (!isOffline(userId) || session.results?.[userId]) continue;
		updates[`flags.${MODULE_ID}.carousingDrops.${userId}`] =
            new foundry.data.operators.ForcedDeletion();
	}

	// Check confirmations (GM-managed actors are not users, so skip them)
	for (const userId of Object.keys(session.confirmations || {})) {
		if (userId.startsWith("actor-")) continue;
		if (!isOffline(userId) || session.results?.[userId]) continue;
		updates[`${base}.confirmations.${userId}`] =
            new foundry.data.operators.ForcedDeletion();
	}

	if (Object.keys(updates).length) await journal.update(updates);
}
