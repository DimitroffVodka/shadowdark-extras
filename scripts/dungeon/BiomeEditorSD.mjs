// BiomeEditorSD.mjs
//
// Ticket 5, slice 2: an ApplicationV2 editor for dungeon biomes. Lists the
// built-in biomes alongside any user-defined ones, lets the GM add / edit /
// override / remove them, and persists through the slice-1 CRUD in
// DungeonBiomesSD. Built on top of the `customBiomes` world setting — built-in
// biomes can be overridden (and reverted) but never deleted.

import {
    BIOME_DEFS,
    getBiomeDefs,
    getCustomBiomes,
    setCustomBiome,
    removeCustomBiome,
    resetCustomBiomes,
    getDisabledBiomes,
    setBiomeEnabled,
} from "./DungeonBiomesSD.mjs";

const MODULE_ID = "shadowdark-extras";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FilePickerImpl = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;

/** Read a biome row's input values into a definition object. */
function readRow(row) {
    const q = (sel) => row?.querySelector(sel);
    const props = (q(".biome-props")?.value || "")
        .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return {
        label: q(".biome-label")?.value?.trim() || "",
        floor: q(".biome-floor")?.value?.trim() || "",
        weight: Number(q(".biome-weight")?.value) || 1,
        ddpack: q(".biome-ddpack")?.value?.trim() || "",
        props,
    };
}

/** Open a FilePicker for an image/video and run `onPick(path)`. */
function pickImage(current, onPick) {
    try {
        const fp = new FilePickerImpl({ type: "imagevideo", current: current || "", callback: onPick });
        fp.render(true);
    } catch (e) {
        ui.notifications?.error(`Could not open file picker: ${e.message}`);
    }
}

export class BiomeEditorSD extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "sdx-biome-editor",
        tag: "div",
        classes: ["shadowdark-extras", "sdx-biome-editor-app"],
        window: { title: "Dungeon Biome Editor", icon: "fa-solid fa-mountain-sun", resizable: true },
        position: { width: 560, height: 720 },
        actions: {
            browseFloor: BiomeEditorSD.onBrowseFloor,
            browseProp: BiomeEditorSD.onBrowseProp,
            saveBiome: BiomeEditorSD.onSaveBiome,
            addBiome: BiomeEditorSD.onAddBiome,
            removeBiome: BiomeEditorSD.onRemoveBiome,
            resetAll: BiomeEditorSD.onResetAll,
            toggleEnabled: BiomeEditorSD.onToggleEnabled,
        },
    };

    static PARTS = {
        body: { template: `modules/${MODULE_ID}/templates/sdx-tray/biome-editor.hbs`, scrollable: [".biome-list"] },
    };

    async _prepareContext() {
        const builtin = BIOME_DEFS;
        const custom = getCustomBiomes();
        const merged = getBiomeDefs();
        const disabled = new Set(getDisabledBiomes());
        const biomes = Object.keys(merged).sort().map(key => {
            const d = merged[key] || {};
            const isBuiltin = key in builtin;
            const isCustom = key in custom;
            return {
                key,
                label: d.label ?? key,
                floor: d.floor ?? "",
                weight: d.weight ?? 1,
                ddpack: d.ddpack ?? "",
                props: (d.props || []).join("\n"),
                isBuiltin,
                isCustom,
                enabled: !disabled.has(key),
                status: isBuiltin ? (isCustom ? "overridden" : "built-in") : "custom",
                canRemove: isCustom, // overridden built-ins revert; custom-only delete
            };
        });
        return { biomes, isGM: game.user.isGM };
    }

    static onBrowseFloor(event, target) {
        const row = target.closest(".biome-row");
        const input = row?.querySelector(".biome-floor");
        if (input) pickImage(input.value, (p) => { input.value = p; });
    }

    static onBrowseProp(event, target) {
        const row = target.closest(".biome-row");
        const ta = row?.querySelector(".biome-props");
        if (ta) pickImage("", (p) => { ta.value = (ta.value ? ta.value + "\n" : "") + p; });
    }

    static async onToggleEnabled(event, target) {
        const key = target.closest(".biome-row")?.dataset?.key;
        if (!key) return;
        try {
            await setBiomeEnabled(key, target.checked);
        } catch (e) {
            ui.notifications.error(e.message);
            this.render(); // resync checkbox to persisted state on failure
        }
    }

    static async onSaveBiome(event, target) {
        const row = target.closest(".biome-row");
        const key = row?.dataset?.key;
        if (!key) return;
        try {
            await setCustomBiome(key, readRow(row));
            ui.notifications.info(`Biome "${key}" saved.`);
        } catch (e) {
            ui.notifications.error(e.message);
        }
        this.render();
    }

    static async onAddBiome(event, target) {
        const root = this.element;
        const row = root.querySelector(".new-biome-row");
        const rawKey = root.querySelector(".new-biome-key")?.value || "";
        const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!key) { ui.notifications.warn("Enter a biome key (letters, digits, - or _)."); return; }
        try {
            await setCustomBiome(key, readRow(row));
            ui.notifications.info(`Biome "${key}" added.`);
            this.render();
        } catch (e) {
            ui.notifications.error(e.message);
        }
    }

    static async onRemoveBiome(event, target) {
        const key = target.closest(".biome-row")?.dataset?.key;
        if (!key) return;
        const removed = await removeCustomBiome(key);
        if (removed) ui.notifications.info(`Biome "${key}" reverted/removed.`);
        this.render();
    }

    static async onResetAll() {
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Reset Biomes" },
            content: "<p>Remove <strong>all</strong> custom biome overrides and additions? Built-in biomes return to their defaults.</p>",
        });
        if (!ok) return;
        await resetCustomBiomes();
        ui.notifications.info("Custom biomes reset.");
        this.render();
    }
}

let _instance = null;

/** Open (or focus) the biome editor. GM-only — only the GM can write world settings. */
export function openBiomeEditor() {
    if (!game.user?.isGM) {
        ui.notifications?.warn("Only the GM can edit dungeon biomes.");
        return null;
    }
    if (!_instance || _instance.rendered === false) _instance = new BiomeEditorSD();
    _instance.render(true);
    return _instance;
}

// Wire the tray's "Edit Biomes…" button via event delegation (no TrayApp.mjs
// edit). Delegation handles the dungeon panel being rendered/re-rendered on its
// own render path, so the button works whenever and however it appears.
if (!globalThis.__sdxBiomeEditorDelegated) {
    globalThis.__sdxBiomeEditorDelegated = true;
    document.addEventListener("click", (ev) => {
        const btn = ev.target?.closest?.(".dgen-edit-biomes");
        if (!btn) return;
        ev.preventDefault();
        openBiomeEditor();
    });
}
