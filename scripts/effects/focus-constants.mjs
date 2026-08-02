// Shared constants + state for the focus/duration spell trackers —
// extracted from scripts/effects/FocusSpellTrackerSD.mjs (Phase 5.1 split).
// Leaf module: no imports.

export const MODULE_ID = "shadowdark-extras";

// Storage key for focus spell data in actor flags
export const FOCUS_SPELL_FLAG = "activeFocusSpells";

// Storage key for duration spell data in actor flags
export const DURATION_SPELL_FLAG = "activeDurationSpells";

// Storage key for spell modifications on items
export const SPELL_MODIFICATIONS_FLAG = "spellModifications";

// Re-entrancy guards shared across the tracker modules (ESM identity:
// all modules see the same Set instances).
export const _endingFocusSpells = new Set();
export const _processedFocusRollMessages = new Set();
