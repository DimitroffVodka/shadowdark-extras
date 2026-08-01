/**
 * Per-actor journal notes: pages, the active-page selector, and the editor app.
 *
 * Extracted from the composition root in Phase 3. Owned by character-sheet
 * rather than journal/ because these are notes ON an actor sheet, stored in a
 * module flag — they are not JournalEntry documents and share nothing with the
 * journal feature. The feature map lists "journal notes" under Character sheets
 * for the same reason.
 *
 * Only `injectJournalNotes` is exported; the actor-sheet dispatcher still in the
 * root calls it. Everything else, including the SdxJournalPageEditor app, is
 * reached through that one entry point and stays module-private.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

// ============================================
// JOURNAL NOTES SYSTEM
// ============================================

/**
 * Default structure for journal pages
 */
const DEFAULT_JOURNAL_PAGE = {
	id: "",
	name: "New Page",
	content: "",
};

/**
 * Generate a unique ID for journal pages
 */
function generateJournalPageId() {
	return foundry.utils.randomID(16);
}

/**
 * Get journal pages for an actor
 */
function getJournalPages(actor) {
	return actor.getFlag(MODULE_ID, "journalPages") ?? [];
}

/**
 * Get the active page ID for an actor (or first page if none set)
 */
function getActiveJournalPageId(actor) {
	const activeId = actor.getFlag(MODULE_ID, "activeJournalPage");
	const pages = getJournalPages(actor);
	if (activeId && pages.find(p => p.id === activeId)) {
		return activeId;
	}
	return pages[0]?.id ?? null;
}

/**
 * Set the active journal page
 */
async function setActiveJournalPage(actor, pageId) {
	await actor.setFlag(MODULE_ID, "activeJournalPage", pageId);
}

/**
 * Add a new journal page
 */
async function addJournalPage(actor, name = null) {
	const pages = getJournalPages(actor);
	const newPage = {
		id: generateJournalPageId(),
		name: name || game.i18n.format("SHADOWDARK_EXTRAS.journal.default_page_name", { num: pages.length + 1 }),
		content: "",
	};
	pages.push(newPage);
	await actor.setFlag(MODULE_ID, "journalPages", pages);
	await setActiveJournalPage(actor, newPage.id);
	return newPage;
}

/**
 * Update a journal page
 */
async function updateJournalPage(actor, pageId, updates) {
	const pages = getJournalPages(actor);
	const pageIndex = pages.findIndex(p => p.id === pageId);
	if (pageIndex === -1) return null;

	pages[pageIndex] = foundry.utils.mergeObject(pages[pageIndex], updates);
	await actor.setFlag(MODULE_ID, "journalPages", pages);
	return pages[pageIndex];
}

/**
 * Delete a journal page
 */
async function deleteJournalPage(actor, pageId) {
	let pages = getJournalPages(actor);
	pages = pages.filter(p => p.id !== pageId);
	await actor.setFlag(MODULE_ID, "journalPages", pages);

	// If we deleted the active page, switch to first page
	const activeId = getActiveJournalPageId(actor);
	if (activeId === pageId || !activeId) {
		await setActiveJournalPage(actor, pages[0]?.id ?? null);
	}
	return pages;
}

/**
 * Inject the Journal Notes system into the player sheet Notes tab
 */
export async function injectJournalNotes(app, html, actor) {
	// Check if journal notes is enabled
	try {
		if (!game.settings.get(MODULE_ID, "enableJournalNotes")) return;
	}
	catch {
		return;
	}

	// Use the app's element directly - more reliable than the html parameter
	const sheetElement = app.element;
	if (!sheetElement || sheetElement.length === 0) {
		//console.log("SDX Journal: Sheet element not found");
		return;
	}

	// Find the notes tab - it's a section with class "tab-notes" and data-tab="tab-notes"
	const notesTab = sheetElement.find('section.tab-notes[data-tab="tab-notes"]');
	if (notesTab.length === 0) {
		//console.log("SDX Journal: Notes tab section not found");
		return;
	}

	// Prevent duplicate injection - check inside the notes tab specifically
	if (notesTab.find(".sdx-journal-notes").length > 0) {
		return;
	}

	const targetTab = notesTab.first();

	// Get journal pages data
	let pages = getJournalPages(actor);

	// If no pages exist yet and there's existing notes content, migrate it
	if (pages.length === 0) {
		const existingNotes = actor.system?.notes || "";
		const firstPage = {
			id: generateJournalPageId(),
			name: game.i18n.localize("SHADOWDARK_EXTRAS.journal.default_first_page"),
			content: existingNotes,
		};
		pages = [firstPage];
		await actor.setFlag(MODULE_ID, "journalPages", pages);
		await setActiveJournalPage(actor, firstPage.id);
	}

	// Get active page
	const activePageId = getActiveJournalPageId(actor);
	const activePage = pages.find(p => p.id === activePageId) || pages[0];

	// Mark pages as active/inactive
	const pagesWithActive = pages.map(p => ({
		...p,
		active: p.id === activePage?.id,
	}));

	// Enrich the active page content
	let activePageContent = "";
	if (activePage) {
		const enrichHTMLImpl = foundry?.applications?.ux?.TextEditor?.implementation?.enrichHTML ?? TextEditor.enrichHTML;
		activePageContent = await enrichHTMLImpl(
			activePage.content || "",
			{
				secrets: actor.isOwner,
				async: true,
				relativeTo: actor,
			}
		);
	}

	// Render the journal template
	const templatePath = `modules/${MODULE_ID}/templates/journal-notes.hbs`;
	const renderTpl = foundry?.applications?.handlebars?.renderTemplate ?? renderTemplate;
	const journalHtml = await renderTpl(templatePath, {
		pages: pagesWithActive,
		activePage: activePage,
		activePageContent: activePageContent,
		editable: app.isEditable,
		actorId: actor.id,
	});

	// Remove any existing journal notes first
	targetTab.find(".sdx-journal-notes").remove();

	// Hide ALL original content in the notes tab (the SD-hideable-section with the editor)
	targetTab.children().each(function() {
		if (!$(this).hasClass("sdx-journal-notes")) {
			$(this).hide();
		}
	});

	// Mark tab as having journal active
	targetTab.addClass("sdx-journal-active");

	// Append the journal inside the target tab only
	targetTab.append(journalHtml);

	// Activate event listeners
	activateJournalListeners(app, html, actor);
}

/**
 * Activate event listeners for the journal notes system
 */
function activateJournalListeners(app, html, actor) {
	// Find the journal section specifically within the notes tab
	const notesTab = app.element.find('section.tab-notes[data-tab="tab-notes"]');
	const journalSection = notesTab.find(".sdx-journal-notes");
	if (journalSection.length === 0) return;

	// Page selection
	journalSection.find(".sdx-journal-page-item").on("click", async (ev) => {
		// Don't trigger if clicking delete button
		if ($(ev.target).closest(".sdx-page-delete").length) return;

		const pageId = $(ev.currentTarget).data("page-id");
		await setActiveJournalPage(actor, pageId);
		app.render(false);
	});

	// Add page button
	journalSection.find('[data-action="add-page"]').on("click", async (ev) => {
		ev.preventDefault();
		await addJournalPage(actor);
		app.render(false);
	});

	// Delete page button
	journalSection.find('[data-action="delete-page"]').on("click", async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		const pageId = $(ev.currentTarget).data("page-id");
		const pages = getJournalPages(actor);
		const page = pages.find(p => p.id === pageId);

		// Confirm deletion
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("SHADOWDARK_EXTRAS.journal.delete_page_title") },
			content: `<p>${game.i18n.format("SHADOWDARK_EXTRAS.journal.delete_page_confirm", { name: page?.name || "Page" })}</p>`,
			modal: true,
		});

		if (confirmed) {
			await deleteJournalPage(actor, pageId);
			app.render(false);
		}
	});

	// Page title editing
	journalSection.find(".sdx-page-title-input").on("change", async (ev) => {
		const pageId = $(ev.currentTarget).data("page-id");
		const newName = $(ev.currentTarget).val().trim() || game.i18n.localize("SHADOWDARK_EXTRAS.journal.untitled");
		await updateJournalPage(actor, pageId, { name: newName });
		app.render(false);
	});

	// Edit page content button
	journalSection.find('[data-action="edit-page"]').on("click", async (ev) => {
		ev.preventDefault();
		const pageId = $(ev.currentTarget).data("page-id");
		await openJournalPageEditor(actor, pageId, app);
	});
}

/**
 * ApplicationV2-based journal page editor.
 *
 * Uses the native `<prose-mirror>` custom element (v14) instead of the legacy
 * `{{editor}}` Handlebars helper + `this.editors` map. The submit handler reads
 * the editor's serialized content from `formData.object.content`.
 */
class SdxJournalPageEditor extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

	static SNIPPETS = {
		"callout-info": '<div class="sdx-callout sdx-callout-info"><p>Information text here...</p></div>',
		"callout-warning": '<div class="sdx-callout sdx-callout-warning"><p>Warning text here...</p></div>',
		"callout-danger": '<div class="sdx-callout sdx-callout-danger"><p>Danger text here...</p></div>',
		"callout-success": '<div class="sdx-callout sdx-callout-success"><p>Success text here...</p></div>',
		"callout-quest": '<div class="sdx-callout sdx-callout-quest"><p><strong>Quest:</strong> Quest details here...</p></div>',
		"callout-loot": '<div class="sdx-callout sdx-callout-loot"><p><strong>Loot:</strong> Treasure description here...</p></div>',
		"callout-npc": '<div class="sdx-callout sdx-callout-npc"><p>"NPC dialogue or quote here..."</p></div>',
		"divider-swords": '<div class="sdx-divider sdx-divider-swords"></div>',
		"divider-stars": '<div class="sdx-divider sdx-divider-stars"></div>',
		"divider-skulls": '<div class="sdx-divider sdx-divider-skulls"></div>',
		"divider-crowns": '<div class="sdx-divider sdx-divider-crowns"></div>',
		"divider-simple": '<div class="sdx-divider sdx-divider-simple"></div>',
	};

	static DEFAULT_OPTIONS = {
		id: "sdx-journal-page-editor-{id}",
		classes: ["shadowdark", "shadowdark-extras", "sdx-journal-editor-dialog"],
		tag: "form",
		window: {
			title: "SHADOWDARK_EXTRAS.journal.edit_page_title",
			resizable: true,
		},
		position: {
			width: 650,
			height: 500,
		},
		form: {
			handler: SdxJournalPageEditor.formHandler,
			submitOnChange: false,
			closeOnSubmit: true,
		},
		actions: {
			insertSnippet: SdxJournalPageEditor._onInsertSnippet,
		},
	};

	static PARTS = {
		form: {
			template: `modules/${MODULE_ID}/templates/journal-editor.hbs`,
			scrollable: [""],
		},
	};

	constructor({ actor, page, sheetApp, ...options } = {}) {
		super(options);
		this.actorDoc = actor;
		this.page = page;
		this.sheetApp = sheetApp;
	}

	// Resolve i18n title with the page name at render time.
	get title() {
		return game.i18n.format("SHADOWDARK_EXTRAS.journal.edit_page_title", { name: this.page?.name ?? "" });
	}

	async _prepareContext(options) {
		return {
			content: this.page?.content ?? "",
			pageName: this.page?.name ?? "",
		};
	}

	_onRender(context, options) {
		// V2 actions don't bubble out of the prose-mirror toolbar, so the snippet
		// buttons are wired here. Action attribute on the buttons (data-action=
		// "insertSnippet") drops through to `_onInsertSnippet` automatically;
		// this block is only a defensive backup if action dispatch isn't set up
		// on the form root.
	}

	static _onInsertSnippet(event, target) {
		event?.preventDefault?.();
		const insertType = target?.dataset?.insert;
		const snippet = SdxJournalPageEditor.SNIPPETS[insertType];
		if (!snippet) return;

		// `<prose-mirror>` element exposes its ProseMirror view via the `editor`
		// property once initialized.
		const root = this.element;
		const pmEl = root?.querySelector('prose-mirror[name="content"]');
		const view = pmEl?.editor?.view;
		if (view) {
			try {
				const state = view.state;
				const schema = state.schema;
				const PMDOMParser = view.constructor.DOMParser || pmEl.editor.constructor?.DOMParser || globalThis.ProseMirror?.DOMParser;
				if (PMDOMParser) {
					const parser = PMDOMParser.fromSchema(schema);
					const tmp = document.createElement("div");
					tmp.innerHTML = snippet;
					const doc = parser.parse(tmp);
					const tr = state.tr;
					tr.insert(state.doc.content.size, doc.content);
					view.dispatch(tr);
					view.focus();
					return;
				}
			}
			catch (err) {
				console.warn("SDX Journal: ProseMirror insertion failed:", err);
			}
		}

		// Last-resort fallback: append to the element's value attribute.
		if (pmEl) {
			const existing = pmEl.value ?? pmEl.getAttribute("value") ?? "";
			const next = existing + snippet;
			pmEl.value = next;
			pmEl.setAttribute("value", next);
		}
	}

	static async formHandler(event, form, formData) {
		const content = formData.object?.content ?? "";
		await updateJournalPage(this.actorDoc, this.page.id, { content });
		this.sheetApp.render(false);
	}
}

/**
 * Open the V2 journal page editor for a given actor + page id.
 */
async function openJournalPageEditor(actor, pageId, sheetApp) {
	const pages = getJournalPages(actor);
	const page = pages.find(p => p.id === pageId);
	if (!page) return;
	const editor = new SdxJournalPageEditor({ actor, page, sheetApp });
	editor.render({ force: true });
}
