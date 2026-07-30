import { maskSource } from "./import-scan.mjs";
import { buildLineIndex, lineAt, literalArgument, literalIndex } from "./call-scan.mjs";

/**
 * Static scanner for `game.settings.register` and `game.settings.registerMenu`
 * call sites.
 *
 * Settings keys and settings-menu ids are stored in every GM's world. Renaming
 * one does not error — it silently orphans the stored value and the setting
 * reverts to its default. The reorganization plan lists them among the rename
 * invariants; this is the gate that holds them to it.
 *
 * Separate from the registration snapshot on purpose: that gate is about the
 * ORDER of hook/wrapper/socket registrations, this one is about the IDENTITY of
 * a key. Folding settings into it would bury 140 stable keys in a diff whose
 * signal is sequence.
 */

/**
 * @param {string} source
 * @returns {Array<{api: string, namespace: string|null, key: string|null,
 *   dynamic: boolean, line: number}>}
 */
export function scanSettings(source) {
  const { masked, maskedChars, literals } = maskSource(source);
  const literalsByStart = literalIndex(literals);
  const lineStarts = buildLineIndex(source);
  const found = [];

  // The `game.settings` receiver is required: the tree also has socketlib
  // `.register(` and `libWrapper.register(`, which are unrelated contracts.
  for (const match of masked.matchAll(/\bgame\s*\.\s*settings\s*\.\s*(register|registerMenu)\s*\(/g)) {
    const openParen = match.index + match[0].length - 1;
    const namespace = literalArgument(maskedChars, literalsByStart, openParen, 0);
    const key = literalArgument(maskedChars, literalsByStart, openParen, 1);

    found.push({
      api: match[1],
      // Usually the local `MODULE_ID` constant, which is not statically resolvable.
      namespace: namespace.dynamic ? null : namespace.name,
      key: key.dynamic ? null : key.name,
      dynamic: key.dynamic,
      line: lineAt(lineStarts, openParen),
    });
  }

  return found.sort((a, b) => a.line - b.line);
}
