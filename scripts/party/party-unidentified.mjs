// Unidentified-item helpers — extracted from scripts/party/PartySheetSD.mjs
// (Phase 5.1 split). Leaf module shared by PartySheetSD and the party mixins.
//
// Phase 5.2.9 (issue #50): the divergence class is ended — these names are
// name-mapped re-exports of the canonical helpers in shared/sd4Compat.mjs
// (which see: SD 4.x native identification when the schema is present, else
// the legacy SDX flags, else the i18n label). Keeping local names means the
// two consumer files below needed no changes; every party call site crosses
// the same single implementation as the rest of the module.

export {
	isUnidentified as isItemUnidentified,
	getUnidentifiedName as getMaskedItemName,
} from "../shared/sd4Compat.mjs";
