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

/**
 * Medkit Application for Shadowdark
 * Scans actor items and compares them with the Shadowdark Extras compendium
 * allowing users to update their items to the enhanced versions.
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
        const packs = getMedkitPacks().map(id => game.packs.get(id)).filter(Boolean);
        if (!packs.length) {
            return { error: `No Medkit compendiums found (${getMedkitPacks().join(", ")}).` };
        }

        // Combined index across every registered pack. Index entries carry a
        // fully-qualified .uuid, so downstream fetches use fromUuid (no per-pack
        // handle needed).
        const index = [];
        for (const pack of packs) {
            const _packLabel = packSourceLabel(pack);
            for (const entry of await pack.getIndex()) index.push({ ...entry, _packLabel });
        }

        // Get actor's class for spell filtering
        const actorClassUuid = this.actor.system?.class;

        const updatesAvailable = [];
        const upToDate = [];

        // Filter actor items that have matches in the compendium
        for (const item of this.actor.items) {
            // Restrict to Spells only per user request
            if (item.type !== "Spell") continue;

            // Find all matches by name and type
            // We strip whitespace and ignore case for broader matching
            const allMatches = index.filter(i =>
                i.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
                i.type === item.type
            );

            if (allMatches.length === 0) continue;

            let match = null;

            // For spells, try to find a class-specific match
            if (item.type === "Spell" && actorClassUuid && allMatches.length > 1) {
                // Need to fetch full documents to check class arrays
                for (const indexMatch of allMatches) {
                    const compendiumItem = await fromUuid(indexMatch.uuid);
                    if (compendiumItem?.system?.class?.includes(actorClassUuid)) {
                        match = indexMatch;
                        break;
                    }
                }
            }

            // If no class-specific match found, use the first match
            if (!match) {
                match = allMatches[0];
            }

            if (match) {
                const sourceId = item.getFlag("shadowdark-extras", "sourceId") || item.getFlag("core", "sourceId");
                const compendiumUuid = match.uuid;

                // Check if already linked to this compendium item
                const isLinked = sourceId === compendiumUuid || (sourceId && sourceId.endsWith(match._id));

                let isDiff = false;

                // If linked, check if data is different
                if (isLinked) {
                    // We must fetch the full document to compare data
                    const compendiumItem = await fromUuid(match.uuid);
                    if (compendiumItem) {
                        isDiff = this._isItemDifferent(item, compendiumItem);
                    }
                }

                // It is an update if it's NOT linked, OR if it IS linked but has different data
                const isUpdate = !isLinked || isDiff;

                console.log(`Medkit Debug: ${item.name} | Linked: ${isLinked} | Diff: ${isDiff}`);

                const itemData = {
                    name: item.name,
                    img: item.img,
                    id: item.id,
                    compendiumUuid: compendiumUuid,
                    currentSource: sourceId || "Unknown/Vanilla",
                    sourceLabel: match._packLabel ?? "Unknown",
                    statusLabel: isDiff ? "New Version" : (isLinked ? "Up to Date" : "Update Available")
                };

                if (isUpdate) {
                    updatesAvailable.push(itemData);
                } else {
                    upToDate.push(itemData);
                }
            }
        }

        // Sort items by name
        updatesAvailable.sort((a, b) => a.name.localeCompare(b.name));
        upToDate.sort((a, b) => a.name.localeCompare(b.name));

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
        await this._updateItem(itemId, compendiumUuid);
    }

    static async onUpdateAll(event, target) {
        await this._updateAll();
    }

    static async formHandler(event, form, formData) {
        // No default submission handling needed
    }


    /* -------------------------------------------- */
    /*  Comparison Logic                            */
    /* -------------------------------------------- */

    _isItemDifferent(actorItem, compendiumItem) {
        // Prepare clean objects
        const cleanActor = this._cleanData(actorItem.toObject());
        const cleanComp = this._cleanData(compendiumItem.toObject());

        const isDiff = !foundry.utils.equals(cleanActor, cleanComp);

        if (isDiff) {
            const diff = foundry.utils.diffObject(cleanActor, cleanComp);
            // Ignore if diff is empty (means equal)
            if (!foundry.utils.isEmpty(diff)) {
                console.log(`Medkit Diff [${actorItem.name}]:`, diff);
                console.log("Clean Actor:", cleanActor);
                console.log("Clean Comp:", cleanComp);
                return true;
            }
            return false;
        }
        return false;
    }

    _cleanData(data) {
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
                delete e.disabled; // Maybe enabled state changes?
                // We typically want to update the effect structure, but maybe not enabled state?
                // If the user disabled an effect, we don't want to flag an update just for that.
                // But if the compendium has it enabled/disabled differently?
                // For now, let's ignore 'disabled' state to avoid noise.
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
        this._stripEmpty(data);

        return data;
    }

    _stripEmpty(obj) {
        if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return;
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v === undefined || v === null || v === "") { delete obj[k]; continue; }
            if (Array.isArray(v) && v.length === 0) { delete obj[k]; continue; }
            if (typeof v === "object" && !Array.isArray(v)) {
                this._stripEmpty(v);
                if (Object.keys(v).length === 0) delete obj[k];
            }
        }
    }

    /* -------------------------------------------- */
    /*  Update Logic                                */

    async _updateItem(itemId, compendiumUuid) {
        await this._performUpdate(itemId, compendiumUuid);
        // Re-render to show updated state (item moves to "Up to Date" list)
        this.render();
    }

    async _performUpdate(itemId, compendiumUuid) {
        const item = this.actor.items.get(itemId);
        const compendiumItem = await fromUuid(compendiumUuid);

        if (!item || !compendiumItem) return;

        // Prepare update data
        const updateData = compendiumItem.toObject();

        // Preserve specific properties that shouldn't change
        delete updateData._id; // Keep original ID
        delete updateData.folder;
        delete updateData.sort;
        delete updateData.ownership;

        // Ensure flags are merged properly, but we want to overwrite mostly
        // We use a custom flag to ensure it persists reliably, as core.sourceId can be finicky
        foundry.utils.setProperty(updateData, "flags.shadowdark-extras.sourceId", compendiumUuid);
        // Also try to set core sourceId for compatibility
        foundry.utils.setProperty(updateData, "flags.core.sourceId", compendiumUuid);

        // Notify user (optional, maybe too spammy for batch? kept for single)
        // For batch, we'll notify once at start/end.
        // But since this is shared, we might suppress notification in batch?
        // Let's just keep it simple.

        await item.update(updateData);
    }

    async _updateAll() {
        // We need to re-scan or just get the data from context. 
        // Since actions don't pass context, we can query DOM or re-calculate.
        // Querying DOM is easier for listed items.
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
            const itemId = btn.dataset.itemId;
            const uuid = btn.dataset.uuid;
            await this._performUpdate(itemId, uuid);
        }

        ui.notifications.info("Batch update complete!");
        this.close();
    }
}
