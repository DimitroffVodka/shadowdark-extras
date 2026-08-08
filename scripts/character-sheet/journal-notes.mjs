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
	catch{
		return;
	}

	// Use the app's element directly - more reliable than the html parameter
	const sheetElement = app.element;
	if (!sheetElement || sheetElement.length === 0) {
		return;
	}

	// Find the notes tab - it's a section with class "tab-notes" and data-tab="tab-notes"
	const notesTab = sheetElement.find('section.tab-notes[data-tab="tab-notes"]');
	if (notesTab.length === 0) {
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
	journalSection.find(".sdx-journal-page-item").on("click", async ev => {
		// Don't trigger if clicking delete button
		if ($(ev.target).closest(".sdx-page-delete").length) return;

		const pageId = $(ev.currentTarget).data("page-id");
		await setActiveJournalPage(actor, pageId);
		app.render(false);
	});

	// Add page button
	journalSection.find('[data-action="add-page"]').on("click", async ev => {
		ev.preventDefault();
		await addJournalPage(actor);
		app.render(false);
	});

	// Delete page button
	journalSection.find('[data-action="delete-page"]').on("click", async ev => {
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
	journalSection.find(".sdx-page-title-input").on("change", async ev => {
		const pageId = $(ev.currentTarget).data("page-id");
		const newName = $(ev.currentTarget).val().trim() || game.i18n.localize("SHADOWDARK_EXTRAS.journal.untitled");
		await updateJournalPage(actor, pageId, { name: newName });
		app.render(false);
	});

	// Edit page content button
	journalSection.find('[data-action="edit-page"]').on("click", async ev => {
		ev.preventDefault();
		const pageId = $(ev.currentTarget).data("page-id");
		await openJournalPageEditor(actor, pageId, app);
	});
}

/**
 * The live ProseMirror view for each `<prose-mirror>` element, captured through
 * the element's `plugins` event, plus whether the user has focused the editor.
 *
 * Foundry v14's HTMLProseMirrorElement keeps its ProseMirrorEditor in a private
 * `#editor` field with no public accessor (foundry.mjs:96555), so `pmEl.editor`
 * is always undefined and the old quick-insert path never ran. The element does
 * expose the editor's plugin record via a bubbling `plugins` CustomEvent fired
 * in `_configurePlugins` (foundry.mjs:96725): a plugin whose spec provides a
 * `view` accessor is handed the live EditorView the moment the view is created,
 * which is the only public route to it. The event fires on every activation, so
 * the capture re-registers each time the editor is opened.
 */
const proseMirrorViews = new WeakMap();
const watchedProseMirror = new WeakSet();

/**
 * Wire a `<prose-mirror>` element so `_onInsertSnippet` can dispatch into its
 * live ProseMirror view instead of the broken `pmEl.editor`/value paths.
 *
 * @param {HTMLElement} pmEl  The `<prose-mirror>` element in the editor form.
 */
function captureProseMirrorView(pmEl) {
	// Guard first: the listener below must be attached at most once per element.
	// The editor may be re-rendered in place by the ApplicationV2 lifecycle, in
	// which case the element is reused and a second addEventListener would
	// accumulate closures (the sentinel only dedupes the plugin, not listeners).
	if (watchedProseMirror.has(pmEl)) return;
	watchedProseMirror.add(pmEl);

	pmEl.addEventListener("plugins", event => {
		const plugins = event?.detail;
		if (!plugins || typeof plugins !== "object") return;
		if (plugins.sdxJournalViewCapture) return;
		plugins.sdxJournalViewCapture = new foundry.prosemirror.Plugin({
			key: new foundry.prosemirror.PluginKey("sdx-journal-view-capture"),
			view(view) {
				proseMirrorViews.set(pmEl, { view, focused: false });
				return {};
			},
		});
	});

	// Track when the user places a cursor in the editor body (not the toggle
	// button), so inserts land at the cursor instead of appending at the end.
	// Focus is lost to the button on click, so `view.hasFocus()` is unusable here.
	pmEl.addEventListener("focusin", event => {
		if (!event.target.closest(".ProseMirror")) return;
		const entry = proseMirrorViews.get(pmEl);
		if (entry) entry.focused = true;
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
		// Wire the quick-insert buttons to the editor's live ProseMirror view.
		// The view only exists once the editor is activated, and the element is
		// recreated on every render, so the capture is re-attached here.
		const pmEl = this.element.querySelector('prose-mirror[name="content"]');
		if (pmEl) captureProseMirrorView(pmEl);
	}

	static _onInsertSnippet(event, target) {
		event?.preventDefault?.();
		const insertType = target?.dataset?.insert;
		const snippet = SdxJournalPageEditor.SNIPPETS[insertType];
		if (!snippet) return;

		const pmEl = this.element?.querySelector('prose-mirror[name="content"]');
		if (!pmEl) return;

		// The editor is active: dispatch a transaction into the live ProseMirror
		// view so the snippet appears immediately, at the cursor when the user
		// has placed one, otherwise at the end of the document.
		const entry = proseMirrorViews.get(pmEl);
		if (entry?.view && pmEl.classList.contains("active")) {
			try {
				const { view, focused } = entry;
				const tmp = document.createElement("div");
				tmp.innerHTML = snippet;
				const parser = foundry.prosemirror.DOMParser.fromSchema(view.state.schema);
				const doc = parser.parse(tmp);
				const { tr, selection } = view.state;
				const from = focused ? selection.from : tr.doc.content.size;
				view.dispatch(tr.insert(from, doc.content).scrollIntoView());
				view.focus();
				return;
			}
			catch(err) {
				console.warn("SDX Journal: ProseMirror insertion failed:", err);
			}
		}

		// The editor is closed (or still activating): append the snippet to the
		// underlying value and open the editor so it is immediately visible.
		if (pmEl.classList.contains("active")) pmEl.save();
		const next = (pmEl._getValue() ?? "") + snippet;
		pmEl.value = next;
		pmEl.open = true;
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
