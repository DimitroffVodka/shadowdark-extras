/**
 * GM display patch for unidentified items.
 *
 * When system.identification.identified === false:
 *   item.name                    = unidentified name ("Unidentified Armor")
 *   system.identification.name   = real/identified name ("Chainmail +1")
 *
 * GMs see:  Unidentified Armor (Chainmail +1)
 * Players see the plain unidentified name as usual.
 */

export function initUnidentifiedGMDisplay() {
    Hooks.on("renderActorSheet", _patchActorSheet);
    Hooks.on("renderItemDirectory", _patchItemDirectory);
    Hooks.on("renderCompendiumDirectory", _patchCompendiumDirectory);
    Hooks.on("renderCompendium", _patchCompendiumDirectory); // v12 compat alias
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _isSystemUnidentified(item) {
    return item?.system?.identification?.identified === false;
}

function _gmName(unidentifiedName, realName) {
    return realName?.trim()
        ? `${unidentifiedName} (${realName})`
        : unidentifiedName;
}

/** Normalise the html argument to a plain HTMLElement regardless of Foundry version. */
function _root(html) {
    if (html instanceof HTMLElement) return html;
    if (html?.[0] instanceof HTMLElement) return html[0]; // jQuery
    return html;
}

/**
 * Replace only the text content of an element, preserving any child icon nodes
 * (e.g. <i class="fas …">) that live alongside the text.
 */
function _setNameText(el, text) {
    const textNode = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
    if (textNode) {
        textNode.textContent = text;
    } else {
        el.textContent = text;
    }
}

// ─── Actor sheet ─────────────────────────────────────────────────────

function _patchActorSheet(app, html) {
    if (!game.user.isGM) return;
    const actor = app.actor ?? app.document;
    if (!actor?.items) return;

    _root(html).querySelectorAll("[data-item-id]").forEach(el => {
        const item = actor.items.get(el.dataset.itemId);
        if (!item || !_isSystemUnidentified(item)) return;

        // Shadowdark inventory rows: name sits in an <h4> inside .item-name,
        // or directly in .item-name.  Try the most specific selector first.
        const nameEl =
            el.querySelector(".item-name h4") ??
            el.querySelector("h4.item-name") ??
            el.querySelector(".item-name") ??
            el.querySelector("h4");
        if (!nameEl) return;

        _setNameText(nameEl, _gmName(item.name, item.system.identification.name));
    });
}

// ─── Item sidebar directory ───────────────────────────────────────────

function _patchItemDirectory(app, html) {
    if (!game.user.isGM) return;

    // v14 renamed the sidebar directory attrs/classes: data-document-id →
    // data-entry-id, .document-name → .entry-name. Match both so the patch
    // works on v12/v13 and v14.
    _root(html).querySelectorAll(".directory-item[data-entry-id], .directory-item[data-document-id]").forEach(el => {
        const id = el.dataset.entryId ?? el.dataset.documentId;
        const item = game.items.get(id);
        if (!item || !_isSystemUnidentified(item)) return;

        const nameEl = el.querySelector(".entry-name") ?? el.querySelector(".document-name");
        if (!nameEl) return;

        _setNameText(nameEl, _gmName(item.name, item.system.identification.name));
    });
}

// ─── Compendium browser ───────────────────────────────────────────────

async function _patchCompendiumDirectory(app, html) {
    if (!game.user.isGM) return;

    const pack = app.collection ?? app.compendium;
    if (!pack || pack.documentName !== "Item") return;

    const root = _root(html);

    // The default compendium index does NOT include system.identification, so the
    // real name is unavailable from it. Request those fields explicitly — v14's
    // getIndex({ fields }) merges them into pack.index — otherwise the identified
    // name can never be shown for compendium entries.
    let index = pack.index;
    try {
        index = await pack.getIndex({
            fields: ["system.identification.identified", "system.identification.name"]
        });
    } catch (_e) { /* fall back to whatever is already indexed */ }

    root.querySelectorAll(".directory-item[data-entry-id], .directory-item[data-document-id]").forEach(el => {
        const docId = el.dataset.entryId ?? el.dataset.documentId;
        if (!docId) return;

        const entry = index?.get(docId) ?? pack.index?.get(docId);
        if (entry?.system?.identification?.identified !== false) return;

        const nameEl = el.querySelector(".entry-name") ?? el.querySelector(".document-name");
        if (!nameEl) return;

        _setNameText(nameEl, _gmName(entry.name, entry.system.identification.name));
    });
}
