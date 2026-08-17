// Tray bindings for the placeable-note list.
//
// Split out of pin-list-bindings.mjs, which owned these handlers only by
// accident of history: a note is a flag on a Token, Actor, Tile, Wall, light or
// sound, and has nothing to do with journal pins.
//
// Every command routes by the exact source the row was built from — the
// `sourceUuid` and `sourceType` the scene index recorded — rather than by a
// canvas-layer id and a Font Awesome class. Two rows can share a display name
// and even an id; only the UUID says which document owns the note.

import { isNoteSharedWithPlayers, isSupportedNoteSource } from "../journal/placeable-note-index.mjs";
import { PlaceableNotesSD } from "../journal/PlaceableNotesSD.mjs";
import { renderTray } from "./TraySD.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * The row commands that manage a note rather than merely look at one. Rendering
 * these controls for a GM alone is presentation; this set is the authorization,
 * and it is consulted before anything about the row is resolved.
 */
const MANAGEMENT_ACTIONS = new Set(["edit", "rename", "toggle-visibility", "delete"]);

/**
 * The document a row was built from, or null if the row no longer describes a
 * document this command may act on.
 *
 * The rendered type is part of the identity, not a hint: a UUID that resolves
 * to a different document type than the row was built from is a substitution,
 * and is refused rather than acted on.
 *
 * Which types can carry a note at all is the index's rule, asked rather than
 * restated — a row naming a Drawing did not come from the index, so it is not a
 * note row and nothing here will treat it as one.
 */
function resolveSource(sourceUuid, sourceType) {
	if (!sourceUuid || !sourceType) return null;

	const source = fromUuidSync(sourceUuid);
	if (!source || source.documentName !== sourceType) return null;
	if (!isSupportedNoteSource(source)) return null;

	return source;
}

/**
 * Whether a source is still part of the scene the tray is showing.
 *
 * Resolving a UUID says the document exists somewhere in the world, which is
 * not the question: the tray is a scene tool, and a row rendered before the
 * scene changed still names a perfectly resolvable document belonging to a
 * scene nobody is looking at. Acting on it would edit that other scene.
 *
 * An Actor belongs to the world rather than to a scene, so it is in scope only
 * while a Token on this scene represents exactly it. A world Actor that still
 * resolves is not enough.
 */
function isOnActiveScene(source) {
	if (!canvas.scene) return false;

	if (source.documentName === "Actor") return representingTokens(source.uuid).length > 0;

	return !!source.parent && source.parent.id === canvas.scene.id;
}

/** The canvas layer that draws each supported source type. */
const PAN_LAYERS = {
	Token: "tokens",
	Tile: "tiles",
	Wall: "walls",
	AmbientLight: "lighting",
	AmbientSound: "sounds",
};

/** The Tokens on the active Scene that represent exactly this Actor. */
function representingTokens(actorUuid) {
	return (canvas.scene?.tokens?.contents ?? []).filter(token => token.actor?.uuid === actorUuid);
}

/**
 * Where to centre the view for a row, read from the drawn placeable rather than
 * from anything captured while the row was rendered. Token movement is
 * deliberately excluded from tray rerenders, so a stored coordinate is stale as
 * soon as the token moves; the placeable is where it is now.
 *
 * An Actor is not drawn, so its anchor is a Token representing it: the one the
 * GM has selected if any, otherwise a stable choice so repeated clicks agree.
 */
function panAnchorFor(source) {
	if (source.documentName === "Actor") {
		const tokens = [...representingTokens(source.uuid)]
			.sort((a, b) => a.id.localeCompare(b.id));
		const chosen = tokens.find(token => canvas.tokens?.get(token.id)?.controlled) ?? tokens[0];
		return canvas.tokens?.get(chosen?.id)?.center ?? null;
	}

	return canvas[PAN_LAYERS[source.documentName]]?.get(source.id)?.center ?? null;
}

/** Centre the view on a row's source, if it is still drawn. */
function panToSource(source) {
	const anchor = panAnchorFor(source);
	if (!anchor) return;

	canvas.animatePan({ x: anchor.x, y: anchor.y, scale: 1.5, duration: 500 });
}

/**
 * The exact source a rendered row names. Only ever the two data attributes: a
 * row carries its identity, and every check re-derives the document from it.
 */
function rowIdentity(row) {
	return { sourceUuid: row?.dataset.noteUuid, sourceType: row?.dataset.noteType };
}

/**
 * The source a command may act on right now, or null if it may not.
 *
 * This is the whole authorization and scope decision in one place, and it is
 * asked again immediately before every mutation rather than once per command.
 * A dialog button is a later user action: while it was on screen the user can
 * have been demoted, the active Scene can have changed, and an Actor can have
 * lost its last representing Token. A document authorized when the dialog
 * opened is therefore not a permission to write when it closes, and is never
 * carried across that wait.
 *
 * The two refusals are deliberately different. A user who may not manage notes
 * is refused before the UUID is resolved, so nothing is resolved, called or
 * rebuilt on their behalf. A GM whose row has gone stale resolved something
 * real that is simply no longer in scope: no source call is made, and the list
 * is rebuilt because it is out of date.
 *
 * @param {{sourceUuid?: string, sourceType?: string}} identity
 * @param {{isManagement: boolean, tray: object}} command
 * @returns {object|null}
 */
function currentSourceFor(identity, { isManagement, tray }) {
	if (isManagement && !game.user.isGM) return null;

	const source = resolveSource(identity.sourceUuid, identity.sourceType);
	if (!source || !isOnActiveScene(source)) {
		// Nothing is said about what was there: a player must not learn a hidden
		// note exists from a message about it failing.
		tray._refreshPlaceableNotes();
		return null;
	}

	return source;
}

/**
 * Share a note with players, or stop sharing it.
 *
 * The flag is written to the document that owns the note, and the state being
 * flipped is the one the row was rendered from — the index's, including its
 * legacy rule. So the first toggle of an Actor note that is shared only through
 * an old Token flag writes an explicit `false` onto the Actor, which is what
 * every later read then uses. The Token is never written to: its flag was
 * someone else's decision about a different note.
 */
async function toggleNoteVisibility(source) {
	const shared = isNoteSharedWithPlayers(source, canvas.scene?.tokens?.contents ?? []);
	await source.setFlag(MODULE_ID, "noteVisible", !shared);
}

/**
 * Open a source's note for editing. Reached two ways — the row's own control
 * and the right-click shortcut it replaces the footer instruction for — and
 * both arrive here having already passed the same command decision.
 */
function openNoteEditor(source) {
	new PlaceableNotesSD(source).render(true);
}

/**
 * Rename the note on a source, or reset it to the document's own name.
 *
 * `source` supplies the name to prefill, read now, while the row is known good.
 * Neither button writes to it: both re-derive the source from the row's
 * identity when the user actually commits, because by then the answer may have
 * changed.
 */
function renameNote(source, identity, tray) {
	const currentName = source.getFlag(MODULE_ID, "customName") || source.name || "";
	new foundry.applications.api.DialogV2({
		window: { title: "Rename Placeable Note" },
		content: `
            <form>
                <div class="form-group">
                    <label>Name:</label>
                    <input type="text" name="name" value="${foundry.utils.escapeHTML(currentName)}" autofocus>
                </div>
            </form>
        `,
		buttons: [
			{
				action: "save",
				label: "Save",
				icon: "fas fa-check",
				default: true,
				callback: async (event, button) => {
					const newName = button.form.elements.name.value;
					const current = currentSourceFor(identity, { isManagement: true, tray });
					if (!current) return;

					await current.setFlag(MODULE_ID, "customName", newName);
				},
			},
			{
				action: "reset",
				label: "Reset",
				icon: "fas fa-undo",
				callback: async () => {
					const current = currentSourceFor(identity, { isManagement: true, tray });
					if (!current) return;

					await current.unsetFlag(MODULE_ID, "customName");
				},
			},
		],
	}).render({ force: true });
}

/**
 * Delete the note on a source, after asking. Both the note and the sharing
 * decision about it go: leaving `noteVisible` behind would silently share the
 * next note written on the same document.
 *
 * The confirmation is a wait like any other, so what gets deleted is the source
 * the row names when the GM says yes — not the one it named when they were
 * asked.
 */
async function deleteNote(source, identity, tray) {
	const ok = await foundry.applications.api.DialogV2.confirm({
		window: { title: "Delete Note" },
		content: `<p>Are you sure you want to delete the note for <strong>${
			foundry.utils.escapeHTML(source.name ?? "")}</strong>?</p>`,
		modal: true,
	});
	if (!ok) return;

	const current = currentSourceFor(identity, { isManagement: true, tray });
	if (!current) return;

	await current.unsetFlag(MODULE_ID, "notes");
	await current.unsetFlag(MODULE_ID, "noteVisible");
}

export const PlaceableNoteBindings = {
	/**
	 * Rebuild the tray from the scene as it is now.
	 *
	 * Called when a row turns out to describe something this scene no longer
	 * has. The row is a symptom rather than the problem — whatever changed
	 * behind the tray's back may have changed other rows too — so the whole list
	 * is rebuilt rather than the one row patched away.
	 */
	_refreshPlaceableNotes() {
		renderTray();
	},

	/**
	 * The Notes tab: row commands, and expanding a row to read its note.
	 * @param {HTMLElement} elem - The rendered tray root
	 */
	_bindPlaceableNoteEvents(elem) {
		// Folding a group shut. This changes where the user is in the list and
		// nothing about the scene, so it is applied to the rendered list rather
		// than paid for with a rerender that would re-enrich every note.
		elem.querySelectorAll(".note-group-header").forEach(header => {
			header.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();

				const groupId = header.dataset.noteGroup;
				if (!groupId) return;

				const collapsed = !this._collapsedNoteGroups.has(groupId);
				if (collapsed) this._collapsedNoteGroups.add(groupId);
				else this._collapsedNoteGroups.delete(groupId);

				const group = header.closest(".note-group");
				group?.classList.toggle("collapsed", collapsed);
				group?.querySelector(".note-group-rows")?.classList.toggle("hidden", collapsed);
				const caret = header.querySelector(".note-group-caret i");
				caret?.classList.toggle("fa-chevron-right", collapsed);
				caret?.classList.toggle("fa-chevron-down", !collapsed);
			});
		});

		elem.querySelectorAll(".note-control").forEach(button => {
			button.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();

				const action = button.dataset.action;
				const identity = rowIdentity(button.closest(".note-entry"));
				const isManagement = MANAGEMENT_ACTIONS.has(action);
				// Authorization comes before the UUID is resolved, before any
				// permission is inspected, and before a dialog or sheet could
				// name the target: a forged control must disclose nothing it was
				// not already shown.
				const source = currentSourceFor(identity, { isManagement, tray: this });
				if (!source) return;

				if (action === "pan") panToSource(source);
				else if (action === "edit") openNoteEditor(source);
				else if (action === "rename") renameNote(source, identity, this);
				else if (action === "toggle-visibility") await toggleNoteVisibility(source);
				else if (action === "delete") await deleteNote(source, identity, this);
			});
		});

		// Both of a row's own affordances, bound with the row itself in hand.
		// Neither wants "the nearest ancestor that looks like a row" — they want
		// this row, whose identity and content are already right here.
		elem.querySelectorAll(".note-entry").forEach(row => {
			// Expanding a row to read its note is not a command against the
			// source: it opens content this viewer was already given, so it
			// neither resolves a UUID nor asks who is looking.
			row.querySelector(".note-header")?.addEventListener("click", e => {
				// A row control clicked is still that control.
				if (e.target.closest(".note-controls")) return;

				e.preventDefault();
				e.stopPropagation();
				const content = row.querySelector(".note-content");
				if (!content) return;

				const expanded = !content.classList.toggle("hidden");
				const icon = row.querySelector(".note-header .toggle-icon i");
				if (icon) {
					icon.classList.toggle("fa-chevron-right", !expanded);
					icon.classList.toggle("fa-chevron-down", expanded);
				}

				// Remembered by source UUID rather than by position, so the row
				// stays open across the rerenders that reorder the list around
				// it. The row is identified the same way its commands identify
				// it; nothing else in the markup is trusted.
				const { sourceUuid } = rowIdentity(row);
				if (!sourceUuid) return;
				if (expanded) this._expandedNoteRows.add(sourceUuid);
				else this._expandedNoteRows.delete(sourceUuid);
			});

			// Right-click a row to edit its note. GM-only markup is
			// presentation, so the authorization is here, before the row's UUID
			// is resolved.
			row.addEventListener("contextmenu", e => {
				// Checked here as well as inside the resolver, so a player keeps
				// their browser's own context menu instead of having it
				// swallowed by a command they may not run.
				if (!game.user.isGM) return;
				e.preventDefault();
				e.stopPropagation();

				const source = currentSourceFor(rowIdentity(row), {
					isManagement: true,
					tray: this,
				});
				if (!source) return;

				openNoteEditor(source);
			});
		});
	},
};
