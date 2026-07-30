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
/*  Item types the Medkit reconciles            */
/* -------------------------------------------- */

/**
 * Owned item types the Medkit scans. Spells are matched 1:1 against a
 * compendium Spell and overwritten wholesale. Scrolls and Wands have no
 * compendium counterpart — they are physical items that *reference* a spell
 * (`system.spellUuid` / `system.spells[].uuid`) while carrying their own SDX
 * enhancement flags, because the cast pipeline resolves the triggering item
 * (`rollConfig.itemUuid`), not the referenced spell. So for those we sync only
 * the enhancement flag payload from the matching compendium Spell and leave the
 * item's own name, type, system data and charges alone.
 */
const SCANNED_TYPES = new Set(["Spell", "Scroll", "Wand"]);

/**
 * SDX flag keys that carry item *enhancement* data. Anything outside this list
 * (sourceId, wandUses, animationFx overrides, …) is per-item state and is never
 * touched by a Scroll/Wand sync.
 */
const ENHANCEMENT_FLAG_KEYS = [
    "spellDamage",
    "summoning",
    "itemGive",
    "alignment",
    "targeting",
    "templateEffects",
    "auraEffects",
    "itemMacro"
];

/** Strip a leading "Scroll of " / "Spell Scroll " / "Wand of " style prefix. */
function _stripSpellPrefix(name, patterns) {
    for (const re of patterns) {
        const stripped = name.replace(re, "").trim();
        if (stripped && stripped !== name) return stripped;
    }
    return name;
}

/**
 * The spell name a Scroll/Wand should be matched against. Resolves the
 * referenced spell document first (works no matter which pack it lives in) and
 * falls back to parsing the item's own name.
 */
async function _resolveSpellName(item) {
    if (item.type === "Scroll") {
        const uuid = item.system?.spellUuid;
        if (uuid) {
            const spell = await fromUuid(uuid).catch(() => null);
            if (spell?.name) return spell.name;
        }
        return _stripSpellPrefix(item.name, [
            /^spell\s+scroll\s+(of\s+)?/i,
            /^scroll\s+(of\s+)?/i
        ]);
    }

    if (item.type === "Wand") {
        const uuid = (item.system?.spells ?? []).find(s => s?.uuid)?.uuid;
        if (uuid) {
            const spell = await fromUuid(uuid).catch(() => null);
            if (spell?.name) return spell.name;
        }
        return _stripSpellPrefix(item.name, [/^wand\s+(of\s+)?/i]);
    }

    return item.name;
}

/** The SDX enhancement flags carried by a document, as plain data. */
function _enhancementPayload(doc) {
    const flags = doc.toObject().flags?.[MODULE_ID] ?? {};
    const out = {};
    for (const key of ENHANCEMENT_FLAG_KEYS) {
        if (flags[key] !== undefined) out[key] = flags[key];
    }
    return out;
}

/**
 * True if a Scroll/Wand's enhancement flags differ from the compendium Spell
 * they are synced from. Only the enhancement payload is compared — the item's
 * physical data is expected to differ.
 */
export function isEnhancementDifferent(actorItem, compendiumItem) {
    const a = _enhancementPayload(actorItem);
    const b = _enhancementPayload(compendiumItem);
    _stripEmpty(a);
    _stripEmpty(b);

    if (foundry.utils.equals(a, b)) return false;
    if (foundry.utils.isEmpty(foundry.utils.diffObject(a, b))) return false;

    console.log(`Medkit Enhancement Diff [${actorItem.name}]:`, foundry.utils.diffObject(a, b));
    return true;
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
 * Scan one actor's Spell, Scroll and Wand items against a prebuilt Medkit index.
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
        if (!SCANNED_TYPES.has(item.type)) continue;

        // Scrolls and Wands are matched against the Spell they cast, and only
        // their enhancement flags are synced.
        const flagsOnly = item.type !== "Spell";
        const matchName = await _resolveSpellName(item);

        // Find all matches by name and type (whitespace-trimmed, case-insensitive)
        const allMatches = index.filter(i =>
            i.name.trim().toLowerCase() === matchName.trim().toLowerCase() &&
            i.type === "Spell"
        );

        if (allMatches.length === 0) continue;

        let match = null;

        // Where a spell exists for several classes, prefer the caster's own
        if (actorClassUuid && allMatches.length > 1) {
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

        // Scroll/Wand links are tracked separately: their sourceId (if any)
        // points at whatever pack the physical item came from, not at the spell.
        const sourceId = flagsOnly
            ? item.getFlag("shadowdark-extras", "medkitSpellSource")
            : (item.getFlag("shadowdark-extras", "sourceId") || item.getFlag("core", "sourceId"));
        const compendiumUuid = match.uuid;

        // Check if already linked to this compendium item
        const isLinked = sourceId === compendiumUuid || (sourceId && sourceId.endsWith(match._id));

        let isDiff = false;
        if (isLinked) {
            // Linked: only an update if the data actually drifted.
            const compendiumItem = await fromUuid(match.uuid);
            if (compendiumItem) {
                isDiff = flagsOnly
                    ? isEnhancementDifferent(item, compendiumItem)
                    : isItemDifferent(item, compendiumItem);
            }
        }

        // It is an update if it's NOT linked, OR if it IS linked but has different data
        const isUpdate = !isLinked || isDiff;

        const itemData = {
            name: item.name,
            img: item.img,
            id: item.id,
            type: item.type,
            mode: flagsOnly ? "flags" : "full",
            spellName: matchName,
            compendiumUuid: compendiumUuid,
            currentSource: sourceId || "Unknown/Vanilla",
            sourceLabel: match._packLabel ?? "Unknown",
            statusLabel: isDiff
                ? "New Version"
                : (isLinked ? "Up to Date" : (flagsOnly ? `Enhancement Available (${matchName})` : "Update Available"))
        };

        if (isUpdate) updatesAvailable.push(itemData);
        else upToDate.push(itemData);
    }

    updatesAvailable.sort((a, b) => a.name.localeCompare(b.name));
    upToDate.sort((a, b) => a.name.localeCompare(b.name));

    return { updatesAvailable, upToDate };
}

/**
 * Copy the SDX enhancement flags from a compendium Spell onto a Scroll/Wand,
 * leaving everything else (name, type, system data, wand charges, per-item
 * animation overrides) untouched. Each enhancement key is unset before it is
 * written so stale sub-keys can't survive Foundry's deep flag merge.
 */
async function _applyEnhancementFlags(item, compendiumItem, compendiumUuid) {
    const payload = _enhancementPayload(compendiumItem);

    const unset = {};
    for (const key of ENHANCEMENT_FLAG_KEYS) {
        if (item.flags?.[MODULE_ID]?.[key] !== undefined) unset[`flags.${MODULE_ID}.-=${key}`] = null;
    }
    if (!foundry.utils.isEmpty(unset)) await item.update(unset);

    const set = { [`flags.${MODULE_ID}.medkitSpellSource`]: compendiumUuid };
    for (const [key, value] of Object.entries(payload)) set[`flags.${MODULE_ID}.${key}`] = value;
    await item.update(set);

    return true;
}

/**
 * Overwrite one owned item with its compendium source, preserving the item's
 * own id/folder/sort/ownership and stamping the sourceId link flags.
 *
 * @param {Item} item
 * @param {string} compendiumUuid
 * @param {"full"|"flags"} [mode="full"] "flags" syncs only the SDX enhancement
 *   flags (Scroll/Wand); "full" replaces the whole document (Spell).
 */
export async function performItemUpdate(item, compendiumUuid, mode = "full") {
    const compendiumItem = await fromUuid(compendiumUuid);
    if (!item || !compendiumItem) return false;

    if (mode === "flags") return _applyEnhancementFlags(item, compendiumItem, compendiumUuid);

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
 * Scan every world actor for available Medkit item updates.
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
 * Apply available Medkit item updates across the world.
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
            if (item && await performItemUpdate(item, upd.compendiumUuid, upd.mode)) {
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
 * actor with pending item updates, and apply them all on confirm.
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
            content: `<p>All actors are up to date — no item updates available.</p>`
        });
        return;
    }

    const esc = (s) => Handlebars.escapeExpression(s);
    const rows = actors
        .map(a => `<li><strong>${esc(a.actorName)}</strong> — ${a.updates.length} update${a.updates.length === 1 ? "" : "s"}</li>`)
        .join("");

    const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Medkit — World Scan", icon: "fas fa-kit-medical" },
        content: `<p>Found <strong>${totalItems}</strong> item update${totalItems === 1 ? "" : "s"} across <strong>${totalActors}</strong> actor${totalActors === 1 ? "" : "s"}:</p>`
            + `<ul style="max-height:320px;overflow:auto;margin:0.5em 0;padding-left:1.25em">${rows}</ul>`
            + `<p>Apply all updates now? This overwrites the affected spells and re-syncs scroll/wand enhancements from their compendium versions.</p>`,
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
        if (item) await performItemUpdate(item, compendiumUuid, target.dataset.mode);
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
            if (item) await performItemUpdate(item, btn.dataset.uuid, btn.dataset.mode);
        }

        ui.notifications.info("Batch update complete!");
        this.close();
    }

    static async formHandler(event, form, formData) {
        // No default submission handling needed
    }
}
