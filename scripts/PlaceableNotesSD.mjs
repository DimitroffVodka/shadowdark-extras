import SheetLockConfig from "./SheetLockConfig.mjs";

const MODULE_ID = "shadowdark-extras";

/**
 * Enhanced notes for any placeable object
 */
export default class PlaceableNotesSD extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    constructor(object, options = {}) {
        super(options);
        this.object = object;
    }

    static DEFAULT_OPTIONS = {
        id: "sdx-placeable-notes",
        tag: "form",
        classes: ["sdx-notes-app"],
        window: {
            title: "SHADOWDARK_EXTRAS.placeable_notes.title",
            resizable: true,
            controls: []
        },
        position: {
            width: 500,
            height: 450,
        },
        actions: {
            save: PlaceableNotesSD._onSave,
            cancel: (app) => app.close()
        }
    };

    static PARTS = {
        main: {
            template: `modules/${MODULE_ID}/templates/placeable-notes.hbs`,
        }
    };

    async _prepareContext(options) {
        return {
            notes: this.object.getFlag(MODULE_ID, "notes") || "",
            isGM: game.user.isGM,
            objectName: this.object.name || this.object.id
        };
    }

    static async _onSave(event, target) {
        // The editor field is named with the full flag path
        // (`flags.shadowdark-extras.notes`), so read it from the expanded form
        // data rather than a top-level `notes` key (which is always undefined).
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const expanded = foundry.utils.expandObject(formData);
        const content = foundry.utils.getProperty(expanded, `flags.${MODULE_ID}.notes`) ?? "";
        await this.object.setFlag(MODULE_ID, "notes", content);
        ui.notifications.info("SHADOWDARK_EXTRAS.placeable_notes.saved", { localize: true });
        this.close();
    }

    // ============================================
    // HEADER BUTTON HOOKS
    // ============================================

    /**
     * Add the notes control to supported document sheet headers.
     *
     * Foundry v14 made the placeable config sheets ApplicationV2, which no
     * longer fire the legacy `get<App>ConfigHeaderButtons` hooks. Header
     * actions are now contributed via `getHeaderControls<ClassName>` and read
     * from the returned controls array (rendered in the window's ⋮ menu).
     * `getHeaderControlsDocumentSheetV2` is the shared-ancestor hook that fires
     * for every document sheet (Tile/Wall/Light/Sound/Token/Actor), so a single
     * registration covers all supported types. A control's `onClick` callback is
     * honored by ApplicationV2 (`_renderHeaderControl` / `_headerControlContextEntries`).
     */
    static addHeaderControl(app, controls) {
        if (!game.user.isGM) return;

        const object = app.document || app.object || app.token;
        if (!object) return;

        const supportedTypes = ["AmbientLight", "AmbientSound", "Token", "Wall", "Tile", "Actor"];
        if (!object.documentName || !supportedTypes.includes(object.documentName)) return;

        const hasNotes = !!object.getFlag(MODULE_ID, "notes");

        controls.unshift({
            label: "SDX Notes",
            action: "open-sdx-notes",
            icon: hasNotes ? "fas fa-sticky-note" : "far fa-sticky-note",
            onClick: () => {
                new PlaceableNotesSD(object).render(true);
            }
        });
    }

    /**
     * Add the notes button to V1 Actor sheets.
     *
     * Shadowdark's actor sheets still extend the V1 `ActorSheet` framework, so
     * the ApplicationV2 `getHeaderControls*` hooks never fire for them. The
     * legacy `getActorSheetHeaderButtons` hook still fires for V1 sheets and
     * expects the V1 button shape (`class`/`onclick`).
     */
    static addActorHeaderButton(app, buttons) {
        if (!game.user.isGM) return;

        const object = app.document || app.actor || app.object;
        if (!object || object.documentName !== "Actor") return;

        const hasNotes = !!object.getFlag(MODULE_ID, "notes");

        buttons.unshift({
            label: "SDX Notes",
            class: "open-sdx-notes",
            icon: hasNotes ? "fas fa-sticky-note" : "far fa-sticky-note",
            onclick: () => {
                new PlaceableNotesSD(object).render(true);
            }
        });
    }
}

export { PlaceableNotesSD };

export function initPlaceableNotes() {
    if (!game.settings.get(MODULE_ID, "enablePlaceableNotes")) return;

    // Foundry v14 ApplicationV2 header-controls hook. Fires for every document
    // sheet via the shared DocumentSheetV2 ancestor, covering the placeable config
    // sheets (Tile/Wall/AmbientLight/AmbientSound/Token). The control's icon/state
    // is recomputed on each render, so no separate post-render refresh is needed.
    Hooks.on("getHeaderControlsDocumentSheetV2", PlaceableNotesSD.addHeaderControl);

    // Shadowdark actor sheets are still V1 Applications, so the V2 hook never fires
    // for them — use the legacy header-buttons hook for Actor sheets.
    Hooks.on("getActorSheetHeaderButtons", PlaceableNotesSD.addActorHeaderButton);
}
