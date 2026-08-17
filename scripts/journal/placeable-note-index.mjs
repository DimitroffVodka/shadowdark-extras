/**
 * Scene-scoped index model for SDX placeable notes.
 *
 * This is an internal leaf: it imports nothing from the journal cluster so the
 * index and the note-control hooks can share one definition of what a note
 * source is. It is not a public API — no global, module API member, setting, or
 * manifest entry may expose it.
 */

const MODULE_ID = "shadowdark-extras";

/**
 * The document types that can carry an SDX note, and the only types the index
 * will ever group. Drawing and Region are deliberately absent: they are
 * separate product work, not an oversight.
 */
const SUPPORTED_NOTE_SOURCE_TYPES = ["Token", "Actor", "Tile", "Wall", "AmbientLight", "AmbientSound"];

/**
 * The groups the tray shows, in the order it shows them. Fixed rather than
 * discovered, so browsing a scene's notes is predictable; empty groups are
 * dropped rather than rendered as empty folders.
 */
const GROUP_ORDER = ["tokens", "actors", "tiles", "walls", "lights", "sounds"];

/**
 * Whether a document can carry an SDX note.
 *
 * @param {{documentName?: string}} document A Foundry document, or anything
 *   document-shaped. Anything without a supported `documentName` — including
 *   `null` — is not a note source.
 * @returns {boolean}
 */
export function isSupportedNoteSource(document) {
	return SUPPORTED_NOTE_SOURCE_TYPES.includes(document?.documentName);
}

/**
 * The documents that are exactly this type. A scene's collection is trusted to
 * be a collection, not to hold only what it is named for — a module, macro, or
 * import can put anything in one. The shared predicate keeps the supported set
 * in one place, and the exact type is what decides which group a document may
 * appear in: `Token` is a supported type, but a Token is never a Tile.
 */
function ofExactType(documents, documentName) {
	return documents.filter(document =>
		isSupportedNoteSource(document) && document.documentName === documentName);
}

/** The given documents, keeping the first occurrence of each exact UUID. */
function distinctByUuid(documents) {
	const byUuid = new Map();
	for (const document of documents) {
		if (!byUuid.has(document.uuid)) byUuid.set(document.uuid, document);
	}
	return [...byUuid.values()];
}

/**
 * Names Foundry gives a document by default, which say nothing about *which*
 * one it is. A row showing one of these is a row worth labelling descriptively.
 */
const GENERIC_NAMES = {
	Wall: ["Wall"],
	AmbientLight: ["Light", "Ambient Light"],
	AmbientSound: ["Sound", "Ambient Sound"],
};

/** Whether a document's own name would tell a reader which one it is. */
function hasUsefulName(document) {
	return !!document.name && !GENERIC_NAMES[document.documentName]?.includes(document.name);
}

/**
 * A descriptive label for a document whose own name says nothing. Walls are
 * labelled by their midpoint, read from the document's own `c` coordinates so
 * the index never depends on a placeable being drawn.
 */
function describe(document) {
	if (document.documentName === "Wall") {
		const [x0, y0, x1, y1] = document.c ?? [];
		return `Wall (${Math.round((x0 + x1) / 2)}, ${Math.round((y0 + y1) / 2)})`;
	}

	if (document.documentName === "AmbientLight") {
		return `Light - ${document.config?.dim || 0}/${document.config?.bright || 0}`;
	}

	if (document.documentName === "AmbientSound") {
		return `Sound - ${document.path?.split("/").pop() || "Unknown"}`;
	}

	return "Unnamed";
}

/**
 * What to call the document that owns a note: what the GM renamed it to, else
 * its own name, else something descriptive enough to tell it from its
 * neighbours.
 */
function displayNameOf(document) {
	const customName = document.flags?.[MODULE_ID]?.customName;
	if (customName) return customName;

	return hasUsefulName(document) ? document.name : describe(document);
}

/** Order rows the way a person reads a numbered list: Room 2 before Room 10. */
function byNaturalName(a, b) {
	return a.displayName.localeCompare(b.displayName, undefined, { numeric: true });
}

/**
 * Whether a note has been deliberately shared with players. The flag lives on
 * the document that owns the note, so this asks the same document the note
 * itself came from.
 */
function isSharedWithPlayers(document) {
	return document.flags?.[MODULE_ID]?.noteVisible === true;
}

/** The Tokens on this scene that represent exactly this Actor. */
function representingTokens(actor, tokens) {
	return tokens.filter(token => token.actor?.uuid === actor.uuid);
}

/**
 * Whether a note has been shared with players. An Actor note predating
 * Actor-level sharing was shared through the Token representing it, so that
 * decision still counts.
 *
 * Exported because the tray's visibility toggle must flip exactly the state the
 * row was rendered from: a second reading of the legacy rule in the command
 * path could disagree with this one, and the row would then toggle to where it
 * already was.
 *
 * @param {object} source The document that owns the note.
 * @param {object[]} tokens The Token documents on the source's own Scene.
 * @returns {boolean}
 */
export function isNoteSharedWithPlayers(source, tokens) {
	if (source.documentName !== "Actor") return isSharedWithPlayers(source);

	// An explicit decision on the Actor is the answer, either way. The legacy
	// Token share is only consulted when the Actor has never said.
	const explicit = source.flags?.[MODULE_ID]?.noteVisible;
	if (typeof explicit === "boolean") return explicit;

	// Only a Token with no note of its own can have been sharing the Actor's:
	// if it has one, that share was about the Token's note.
	return representingTokens(source, tokens)
		.some(token => isSharedWithPlayers(token) && !hasNote(token));
}

/** Whether a document actually carries an SDX note worth indexing. */
function hasNote(document) {
	return !!document?.flags?.[MODULE_ID]?.notes;
}

/** The note stored on a document. */
function noteOf(document) {
	return document.flags[MODULE_ID].notes;
}

/**
 * Foundry's own text enrichment. Removing unrevealed secret sections is
 * Foundry's job, not this model's, so the boundary is called rather than
 * reimplemented — and injected in tests rather than faked globally.
 */
function enrichThroughFoundry(html, options) {
	return foundry.applications.ux.TextEditor.implementation.enrichHTML(html, options);
}

/**
 * Text made safe to place in a field that is rendered as HTML. Stripping tags
 * is not enough on its own: markup too malformed to look like a tag survives
 * that pass, so whatever is left is escaped rather than trusted.
 */
function escapeHtml(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * What a viewer is shown for a note whose enrichment failed.
 *
 * Removing unrevealed secret sections is Foundry's job, done while enriching.
 * If that never happened there is no trustworthy way to tell a note's public
 * text from its secret one: deciding requires the HTML parser's own semantics —
 * decoded character references in attribute values, quoted `>` inside a start
 * tag, exact attribute names — and matching the raw source instead is what
 * disclosed secrets twice here. Rather than keep a second HTML parser for an
 * exceptional path, a player is shown nothing at all. A blank note is a
 * cosmetic failure; the alternative is a confidentiality one.
 *
 * The GM has no secret to be kept from, so they still get readable text.
 */
function fallbackTextFor(rawNote, isGM) {
	return isGM ? toSafeText(rawNote) : "";
}

/** Markup reduced to text that is safe to render as HTML. */
function toSafeText(html) {
	return escapeHtml(html.replace(/<[^>]*>/g, "").trim());
}

/**
 * One note's enriched content, or a safe stand-in if enrichment fails. One
 * unparseable note must not cost a GM the rest of the scene's notes.
 */
async function enrichOrFallBack(source, isGM, enrichHTML, logger) {
	try {
		return await enrichHTML(noteOf(source), { async: true, secrets: isGM });
	}
	catch(error) {
		// The UUID says which note to go and look at; the error says what went
		// wrong. The note's own text is deliberately absent — a GM secret in a
		// shared console is the same disclosure by another route.
		logger.warn(`SDX Note Index | Could not enrich the note on ${source.uuid}`, error);
		return fallbackTextFor(noteOf(source), isGM);
	}
}

/**
 * Build the note index for one scene.
 *
 * This is the one canonical call shape. The viewer is a required, explicit
 * boolean: an index built for the wrong viewer either leaks a hidden note or
 * hides a shared one, so a caller that forgets it is refused rather than
 * quietly treated as a player.
 *
 * @param {Scene|null} scene The scene to index.
 * @param {object} options
 * @param {boolean} options.isGM Required. Who the index is being built for.
 * @param {Function} [options.enrichHTML] The text-enrichment boundary, for
 *   tests that need to observe it. Defaults to Foundry's own TextEditor.
 * @param {{warn: Function}} [options.logger] Where enrichment failures are
 *   reported. Defaults to the console.
 * @returns {Promise<object[]>} Transient groups; never persisted.
 */
export async function buildPlaceableNoteIndex(scene, options) {
	if (typeof options?.isGM !== "boolean") {
		// `globalThis.` is not decoration: the repo's binding gate reads a bare
		// `TypeError` as an unbound identifier, and rooting it here keeps the
		// bad-argument contract without widening that gate.
		throw new globalThis.TypeError(
			"buildPlaceableNoteIndex requires an explicit boolean options.isGM"
		);
	}

	// A scene can vanish between a tray render and this call, which is not an
	// error: there is simply nothing to index.
	const tokens = ofExactType(scene?.tokens?.contents ?? [], "Token");
	const sources = {
		tokens,
		// A scene has no Actor collection. An Actor is in the index only because
		// a Token on this scene represents it — and an Actor placed twice is
		// still one Actor with one note, so identity is the Actor's UUID rather
		// than the Token that reached it.
		actors: ofExactType(distinctByUuid(tokens.map(token => token.actor).filter(Boolean)), "Actor"),
		tiles: ofExactType(scene?.tiles?.contents ?? [], "Tile"),
		walls: ofExactType(scene?.walls?.contents ?? [], "Wall"),
		lights: ofExactType(scene?.lights?.contents ?? [], "AmbientLight"),
		sounds: ofExactType(scene?.sounds?.contents ?? [], "AmbientSound"),
	};

	const enrichHTML = options.enrichHTML ?? enrichThroughFoundry;
	const logger = options.logger ?? console;
	const groups = [];

	for (const id of GROUP_ORDER) {
		// Filtering happens before enrichment, so a note this viewer may not see
		// is never handed to the enricher at all.
		const included = sources[id]
			.filter(hasNote)
			.filter(source => options.isGM || isNoteSharedWithPlayers(source, tokens));
		if (included.length === 0) continue;

		const rows = await Promise.all(included.map(async source => ({
			sourceUuid: source.uuid,
			// Carried, not inferred: a command routing by this must not have to
			// work the type out from a group id or an icon.
			sourceType: source.documentName,
			displayName: displayNameOf(source),
			// The resolved policy, not the raw flag: a GM sees every row, and
			// this is what tells them which ones a player can see.
			isVisible: isNoteSharedWithPlayers(source, tokens),
			enrichedContent: await enrichOrFallBack(source, options.isGM, enrichHTML, logger),
		})));
		rows.sort(byNaturalName);

		// Counted from the rows this viewer was given, so a count can never
		// disclose a note the viewer was not shown.
		groups.push({ id, rows, count: rows.length });
	}

	return groups;
}
