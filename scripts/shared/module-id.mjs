/**
 * The module's id, as declared in `module.json`.
 *
 * Ninety-nine files currently declare their own `const MODULE_ID`. They keep
 * them: rewriting all of those is a modernization task, not a structural one,
 * and a ninety-nine-file sweep inside a move-only track would bury the moves it
 * is supposed to make reviewable.
 *
 * This exists for modules the structural track creates or relocates, so new and
 * re-homed code has one obvious place to import the id from rather than adding
 * a hundredth copy.
 *
 * The id is a rename invariant: it is stored in world settings keys, flag
 * namespaces, socket event names, and asset paths. Changing it here would not
 * migrate any of those.
 */
export const MODULE_ID = "shadowdark-extras";
