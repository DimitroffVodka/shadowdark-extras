import { maskSource } from "./import-scan.mjs";
import { buildLineIndex, lineAt, literalArgument, literalIndex } from "./call-scan.mjs";

/**
 * Static scanner for document flag access — `setFlag`, `unsetFlag`, `getFlag`.
 *
 * Flags are the module's OTHER persistence channel. Where a setting is stored
 * once per world, a flag is stored on a specific document — a scene, a journal,
 * an actor — and there are far more of them. Renaming one behaves exactly like
 * renaming a settings key: nothing errors, the read just returns undefined and
 * the data every GM already has becomes unreachable.
 *
 * The settings-key snapshot has covered its channel since Phase 5.2. This is
 * the same guarantee for the flag channel, which had none.
 *
 * READS ARE SCANNED, NOT JUST WRITES, and that is load-bearing. Some flags are
 * never written through `setFlag` at all — `hexGenJournal` is written only in
 * the `flags: { [MODULE_ID]: { … } }` payload of a `JournalEntry.create` call,
 * which no static scan of method calls can see. Its `getFlag` sites are what
 * put it in the snapshot.
 */

/**
 * @param {string} source
 * @returns {Array<{api: string, scope: string|null, key: string|null,
 *   dynamicScope: boolean, dynamic: boolean, line: number}>}
 */
export function scanFlags(source) {
  const { masked, maskedChars, literals } = maskSource(source);
  const literalsByStart = literalIndex(literals);
  const lineStarts = buildLineIndex(source);
  const found = [];

  // Any receiver: the document varies (scene, journal, actor, token, item) and
  // is rarely a resolvable name at the call site. The flag APIs are distinctive
  // enough on their own that a bare method-name match does not collide.
  for (const match of masked.matchAll(/\.\s*(setFlag|unsetFlag|getFlag)\s*\(/g)) {
    const openParen = match.index + match[0].length - 1;
    const scope = literalArgument(maskedChars, literalsByStart, openParen, 0);
    const key = literalArgument(maskedChars, literalsByStart, openParen, 1);

    found.push({
      api: match[1],
      // Usually the local `MODULE_ID` constant, which is not statically
      // resolvable — a dynamic scope is therefore treated as "ours".
      scope: scope.dynamic ? null : scope.name,
      key: key.dynamic ? null : key.name,
      dynamicScope: scope.dynamic,
      dynamic: key.dynamic,
      line: lineAt(lineStarts, openParen),
    });
  }

  return found.sort((a, b) => a.line - b.line);
}
