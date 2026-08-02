// Shared module constants for the Maphub viewer (Phase 5.1 split).
// Leaf: no imports from sibling modules.
const FilePicker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;
const MODULE_ID = "shadowdark-extras";
export { FilePicker, MODULE_ID };
