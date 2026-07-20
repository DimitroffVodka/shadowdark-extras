const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "shadowdark-extras";

/**
 * Compendiums the Medkit reconciles an actor's owned items against. Other
 * modules (e.g. shadowdark-enhancer) register their own spell packs via the
 * module API's registerMedkitPack so their enhanced copies show as updates too.
 * The default SDX item pack is always present.
 */
const DEFAULT_MEDKIT_PACK = "shadowdark-extras.pack-sdxitems";
const _medkitPacks = new Set([DEFAULT_MEDKIT_PACK]);

/** Add a compendium (by collection id) for the Medkit to scan. Idempotent. */
export function registerMedkitPack(packId) {
    if (typeof packId !== "string" || !packId) return false;
    _medkitPacks.add(packId);
    return true;
}

/** Remove a previously-registered pack. The default SDX pack can't be removed. */
export function unregisterMedkitPack(packId) {
    if (packId === DEFAULT_MEDKIT_PACK) return false;
    return _medkitPacks.delete(packId);
}

/** Current Medkit source packs, in registration order (default SDX pack first). */
export function getMedkitPacks() {
    return [..._medkitPacks];
}

/**
 * Human-friendly "Source:" label for a Medkit pack. Module/system packs report their
 * package title (so SDX's own pack still reads "Shadowdark Extras"); world compendiums
 * fall back to the pack's own label.
 */
function packSourceLabel(pack) {
    const m = pack.metadata ?? {};
    if (m.packageType === "module") return game.modules.get(m.packageName)?.title ?? m.label;
    if (m.packageType === "system") return game.system?.title ?? m.label;
    return m.label ?? pack.collection;
}

/* -------------------------------------------- */
/*  Comparison Logic (shared)                   */
/* -------------------------------------------- */

/**
 * True if an actor-owned item meaningfully differs from its compendium source,
 * ignoring per-actor tracking fields (quantity, equipped, lost, uses, effect
 * enabled-state, sourceId flags) and schema-default noise.
 */
export function isItemDifferent(actorItem, compendiumItem) {
    const cleanActor = _cleanData(actorItem.toObject());
    const cleanComp = _cleanData(compendiumItem.toObject());

    if (foundry.utils.equals(cleanActor, cleanComp)) return false;

    const diff = foundry.utils.diffObject(cleanActor, cleanComp);
    if (foundry.utils.isEmpty(diff)) return false;

    console.log(`Medkit Diff [${actorItem.name}]:`, diff);
    return true;
}

function _cleanData(data) {
    // Remove standard foundry junk
    delete data._id;
    delete data.folder;
    delete data.sort;
    delete data.ownership;
    delete data._stats;

    // Remove dynamic tracking fields
    if (data.system) {
        delete data.system.quantity;
        delete data.system.equipped;
        delete data.system.stashed;
        delete data.system.lost; // Spell lost status
        delete data.system.uses; // Item uses
    }

    // Clean Active Effects
    if (data.effects) {
        data.effects.forEach(e => {
            delete e._id;
            delete e.origin; // Origin usually points to actor uuid or item uuid
            delete e.duration?.startTime;
            delete e._stats;
            // Ignore enabled/disabled state to avoid noise if the user toggled an effect.
            delete e.disabled;
        });
    }

    // Remove tracking flags
    if (data.flags) {
        if (data.flags.core) delete data.flags.core.sourceId;
        if (data.flags["shadowdark-extras"]) delete data.flags["shadowdark-extras"].sourceId;

        // Clean empty flag containers
        if (foundry.utils.isEmpty(data.flags.core)) delete data.flags.core;
        if (foundry.utils.isEmpty(data.flags["shadowdark-extras"])) delete data.flags["shadowdark-extras"];
        if (foundry.utils.isEmpty(data.flags)) delete data.flags;
    }

    // Schema-default normalization: treat undefined / null / "" / [] / {}
    // as equivalent to "absent" so items packed under an older system
    // version don't show "Update Available" forever just because a new
    // schema field (e.g. system.formula added in SD 4.x) defaults to ""
    // on the actor copy but is missing from the compendium source.
    _stripEmpty(data);

    return data;
}

function _stripEmpty(obj) {
    if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === undefined || v === null || v === "") { delete obj[k]; continue; }
        if (Array.isArray(v) && v.length === 0) { delete obj[k]; continue; }
        if (typeof v === "object" && !Array.isArray(v)) {
            _stripEmpty(v);
            if (Object.keys(v).length === 0) delete obj[k];
        }
    }
}

/* -------------------------------------------- */
/*  Scan / Update Logic (shared)                */
/* -------------------------------------------- */

/**
 * Combined index across every registered pack. Index entries carry a
 * fully-qualified .uuid (so fetches use fromUuid) plus a resolved _packLabel.
 * Returns null if no registered pack resolves to a live compendium.
 */
export async function buildMedkitIndex() {
    const packs = getMedkitPacks().map(id => game.packs.get(id)).filter(Boolean);
    if (!packs.length) return null;

    const index = [];
    for (const pack of packs) {
        const _packLabel = packSourceLabel(pack);
        for (const entry of await pack.getIndex()) index.push({ ...entry, _packLabel });
    }
    return index;
}

/**
 * Scan one actor's Spell items against a prebuilt Medkit index.
 * Returns { updatesAvailable, upToDate } — arrays of descriptor objects that
 * carry the live item id and resolved compendium uuid, so callers can both
 * render the state and perform the update without re-scanning.
 */
export async function scanActorItems(actor, index) {
    // Actor's class is used to disambiguate multi-class spell matches.
    const actorClassUuid = actor.system?.class;

    const updatesAvailable = [];
    const upToDate = [];

    for (const item of actor.items) {
        // Restrict to Spells only per user request
        if (item.type !== "Spell") continue;

        // Find all matches by name and type (whitespace-trimmed, case-insensitive)
        const allMatches = index.filter(i =>
            i.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
            i.type === item.type
        );

        if (allMatches.length === 0) continue;

        let match = null;

        // For spells, try to find a class-specific match
        if (item.type === "Spell" && actorClassUuid && allMatches.length > 1) {
            for (const indexMatch of allMatches) {
                const compendiumItem = await fromUuid(indexMatch.uuid);
                if (compendiumItem?.system?.class?.includes(actorClassUuid)) {
                    match = indexMatch;
                    break;
                }
            }
        }

        // If no class-specific match found, use the first match
        if (!match) match = allMatches[0];

        const sourceId = item.getFlag("shadowdark-extras", "sourceId") || item.getFlag("core", "sourceId");
        const compendiumUuid = match.uuid;

        // Check if already linked to this compendium item
        const isLinked = sourceId === compendiumUuid || (sourceId && sourceId.endsWith(match._id));

        let isDiff = false;
        if (isLinked) {
            // Linked: only an update if the data actually drifted.
            const compendiumItem = await fromUuid(match.uuid);
            if (compendiumItem) isDiff = isItemDifferent(item, compendiumItem);
        }

        // It is an update if it's NOT linked, OR if it IS linked but has different data
        const isUpdate = !isLinked || isDiff;

        const itemData = {
            name: item.name,
            img: item.img,
            id: item.id,
            compendiumUuid: compendiumUuid,
            currentSource: sourceId || "Unknown/Vanilla",
            sourceLabel: match._packLabel ?? "Unknown",
            statusLabel: isDiff ? "New Version" : (isLinked ? "Up to Date" : "Update Available")
        };

        if (isUpdate) updatesAvailable.push(itemData);
        else upToDate.push(itemData);
    }

    updatesAvailable.sort((a, b) => a.name.localeCompare(b.name));
    upToDate.sort((a, b) => a.name.localeCompare(b.name));

    return { updatesAvailable, upToDate };
}

/**
 * Overwrite one owned item with its compendium source, preserving the item's
 * own id/folder/sort/ownership and stamping the sourceId link flags.
 */
export async function performItemUpdate(item, compendiumUuid) {
    const compendiumItem = await fromUuid(compendiumUuid);
    if (!item || !compendiumItem) return false;

    const updateData = compendiumItem.toObject();

    // Preserve specific properties that shouldn't change
    delete updateData._id; // Keep original ID
    delete updateData.folder;
    delete updateData.sort;
    delete updateData.ownership;

    // Stamp the link flags so a re-scan recognizes this item as sourced.
    // We use a custom flag because core.sourceId can be finicky, and also set
    // core.sourceId for compatibility with other tooling.
    foundry.utils.setProperty(updateData, "flags.shadowdark-extras.sourceId", compendiumUuid);
    foundry.utils.setProperty(updateData, "flags.core.sourceId", compendiumUuid);

    await item.update(updateData);
    return true;
}

/* -------------------------------------------- */
/*  World-scale Scan / Apply                    */
/* -------------------------------------------- */

/**
 * Scan every world actor for available Medkit spell updates.
 * Returns { actors: [{ actorId, actorName, updates }], totalActors, totalItems }
 * where `updates` is the per-actor updatesAvailable list. Read-only.
 */
export async function scanWorldForUpdates() {
    const index = await buildMedkitIndex();
    if (!index) {
        ui.notifications?.warn(`Medkit: no source compendiums found (${getMedkitPacks().join(", ")}).`);
        return { actors: [], totalActors: 0, totalItems: 0 };
    }

    const results = [];
    let totalItems = 0;

    for (const actor of game.actors) {
        const { updatesAvailable } = await scanActorItems(actor, index);
        if (updatesAvailable.length) {
            results.push({ actorId: actor.id, actorName: actor.name, updates: updatesAvailable });
            totalItems += updatesAvailable.length;
        }
    }

    results.sort((a, b) => a.actorName.localeCompare(b.actorName));
    return { actors: results, totalActors: results.length, totalItems };
}

/**
 * Apply available Medkit spell updates across the world.
 * @param {object} [opts]
 * @param {string[]|null} [opts.actorIds] Restrict to these actor ids (null = all).
 * @param {boolean} [opts.notify=true] Show a completion notification.
 * @returns {Promise<{appliedItems:number, appliedActors:number, totalItems:number}>}
 */
export async function applyWorldMedkitUpdates({ actorIds = null, notify = true } = {}) {
    const { actors, totalItems } = await scanWorldForUpdates();
    const targets = actorIds ? actors.filter(a => actorIds.includes(a.actorId)) : actors;

    let appliedItems = 0;
    let appliedActors = 0;

    for (const entry of targets) {
        const actor = game.actors.get(entry.actorId);
        if (!actor) continue;
        let touched = 0;
        for (const upd of entry.updates) {
            const item = actor.items.get(upd.id);
            if (item && await performItemUpdate(item, upd.compendiumUuid)) {
                appliedItems++;
                touched++;
            }
        }
        if (touched) appliedActors++;
    }

    if (notify) {
        ui.notifications?.info(`Medkit: updated ${appliedItems} item(s) across ${appliedActors} actor(s).`);
    }
    return { appliedItems, appliedActors, totalItems };
}

/**
 * GM-facing entry point: scan the world, show a summary dialog listing every
 * actor with pending spell updates, and apply them all on confirm.
 */
export async function medkitScanWorld() {
    if (!game.user?.isGM) {
        ui.notifications?.warn("Medkit world scan is GM-only.");
        return;
    }

    ui.notifications?.info("Medkit: scanning world actors…");
    const { actors, totalActors, totalItems } = await scanWorldForUpdates();

    if (!totalItems) {
        await foundry.applications.api.DialogV2.prompt({
            window: { title: "Medkit — World Scan", icon: "fas fa-kit-medical" },
            content: `<p>All actors are up to date — no spell updates available.</p>`
        });
        return;
    }

    const esc = (s) => Handlebars.escapeExpression(s);
    const rows = actors
        .map(a => `<li><strong>${esc(a.actorName)}</strong> — ${a.updates.length} update${a.updates.length === 1 ? "" : "s"}</li>`)
        .join("");

    const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Medkit — World Scan", icon: "fas fa-kit-medical" },
        content: `<p>Found <strong>${totalItems}</strong> spell update${totalItems === 1 ? "" : "s"} across <strong>${totalActors}</strong> actor${totalActors === 1 ? "" : "s"}:</p>`
            + `<ul style="max-height:320px;overflow:auto;margin:0.5em 0;padding-left:1.25em">${rows}</ul>`
            + `<p>Apply all updates now? This overwrites the affected spell items with their compendium versions.</p>`,
        modal: true
    });

    if (!confirmed) return;

    const res = await applyWorldMedkitUpdates({ notify: false });
    ui.notifications?.info(`Medkit: updated ${res.appliedItems} item(s) across ${res.appliedActors} actor(s).`);
}

/**
 * Settings-menu launcher. registerMenu instantiates and renders this; instead
 * of opening a config window we kick off the world-scan flow and stay closed.
 */
export class MedkitWorldScanMenu extends foundry.applications.api.ApplicationV2 {
    async render() {
        await medkitScanWorld();
        return this;
    }
}

/**
 * Medkit Application for Shadowdark
 * Scans an actor's items and compares them with the registered compendiums,
 * allowing owners to update their items to the enhanced versions.
 */
export function initMedkit() {
    Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
        // Only show for actor owners
        if (!sheet.actor.isOwner) return;

        // Check if medkit icon should be shown
        try {
            if (!game.settings.get(MODULE_ID, "showMedkitIcon")) return;
        } catch {
            // Setting not registered yet, don't show button
            return;
        }

        buttons.unshift({
            label: "Medkit",
            class: "sdx-medkit",
            icon: "fas fa-kit-medical",
            onclick: () => new MedkitApp({ document: sheet.actor }).render(true)
        });
    });
}

export class MedkitApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.actor = options.document;
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "sdx-medkit",
        window: {
            title: "Shadowdark Extras Medkit",
            icon: "fas fa-kit-medical",
            resizable: true,
            controls: [],
            classes: ["shadowdark", "sdx-medkit-window"]
        },
        position: {
            width: 550,
            height: "auto"
        },
        form: {
            handler: MedkitApp.formHandler,
            submitOnChange: false,
            closeOnSubmit: false
        },
        actions: {
            updateItem: MedkitApp.onUpdateItem,
            updateAll: MedkitApp.onUpdateAll
        }
    };

    static PARTS = {
        form: {
            template: "modules/shadowdark-extras/templates/medkit.hbs",
            scrollable: [".sdx-medkit-list"]
        }
    };

    /** @override */
    async _prepareContext(options) {
        const index = await buildMedkitIndex();
        if (!index) {
            return { error: `No Medkit compendiums found (${getMedkitPacks().join(", ")}).` };
        }

        const { updatesAvailable, upToDate } = await scanActorItems(this.actor, index);

        return {
            actor: this.actor,
            updatesAvailable,
            upToDate,
            hasUpdates: updatesAvailable.length > 0,
            hasUpToDate: upToDate.length > 0,
            updateCount: updatesAvailable.length
        };
    }

    /* -------------------------------------------- */
    /*  Action Handlers                             */
    /* -------------------------------------------- */

    static async onUpdateItem(event, target) {
        const itemId = target.dataset.itemId;
        const compendiumUuid = target.dataset.uuid;
        const item = this.actor.items.get(itemId);
        if (item) await performItemUpdate(item, compendiumUuid);
        // Re-render to show updated state (item moves to "Up to Date" list)
        this.render();
    }

    static async onUpdateAll(event, target) {
        const buttons = this.element.querySelectorAll("[data-action='updateItem']");
        if (buttons.length === 0) return;

        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Update All Items?" },
            content: `<p>Are you sure you want to update ${buttons.length} items from the Shadowdark Extras compendium? This will overwrite their data.</p>`,
            modal: true
        });

        if (!confirm) return;

        ui.notifications.info(`Starting batch update of ${buttons.length} items...`);

        for (const btn of buttons) {
            const item = this.actor.items.get(btn.dataset.itemId);
            if (item) await performItemUpdate(item, btn.dataset.uuid);
        }

        ui.notifications.info("Batch update complete!");
        this.close();
    }

    static async formHandler(event, form, formData) {
        // No default submission handling needed
    }
}
