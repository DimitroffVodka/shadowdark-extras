import * as acorn from "acorn";

import { maskSource } from "./import-scan.mjs";
import { buildLineIndex, lineAt, literalArgument, literalIndex } from "./call-scan.mjs";

const MODULE_ID = "shadowdark-extras";

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
 * READS ARE SCANNED, NOT JUST WRITES, and that is load-bearing. A key can be
 * written through one channel and read through another, so a scan that only
 * watched writes would lose keys entirely.
 *
 * THREE CHANNELS, because Foundry offers three and this module uses all of
 * them. `scanFlags` covers the method calls by masking and matching text;
 * `scanFlagLiterals` covers the other two with a real parse:
 *
 *   setFlag / getFlag / unsetFlag        method calls      scanFlags
 *   flags: { [MODULE_ID]: { k: v } }     create/update     scanFlagLiterals
 *   doc.flags?.[MODULE_ID]?.k            direct property   scanFlagLiterals
 *
 * The first version of this gate covered only the method channel and reported
 * itself as repo-wide. It was not: 72 keys were invisible to it, 20 of them in
 * the very files the sweep-6 split was about to touch. See issue #91.
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

/** Is this object-literal key our module's namespace? */
function isOurScope(key) {
  return (key.type === "Identifier" && key.name === "MODULE_ID")
    || (key.type === "Literal" && key.value === MODULE_ID);
}

/** The literal name of an object key, or null when it is computed at runtime. */
function staticKeyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
}

function visit(node, callback) {
  if (!node || typeof node.type !== "string") return;
  callback(node);

  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") visit(child, callback);
      }
    }
    else if (value && typeof value.type === "string") visit(value, callback);
  }
}

/**
 * Scan the two channels a method-call matcher cannot see.
 *
 * Needs a real parse rather than a masked regex: a flag payload is an object
 * literal nested inside a call argument, and a direct read is a member chain
 * with optional links in arbitrary positions. Both are painful and unreliable
 * to match textually, and getting them wrong is how the first version of this
 * gate came to report 62% coverage as complete.
 *
 * @param {string} source
 * @returns {Array<{api: string, key: string|null, dynamic: boolean, line: number}>}
 */
export function scanFlagLiterals(source) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2023, sourceType: "module", locations: true });
  }
  catch {
    // A file the parser rejects is left to the masked scan rather than failing
    // the whole gate. Vendored trees are the realistic case.
    return [];
  }

  const found = [];

  visit(ast, (node) => {
    // Channel 2 — `flags: { [MODULE_ID]: { key: value } }` in a create/update
    // payload. These are writes: the payload is what gets persisted.
    if (
      node.type === "Property" && !node.computed
      && (node.key.name === "flags" || node.key.value === "flags")
      && node.value.type === "ObjectExpression"
    ) {
      for (const scope of node.value.properties) {
        if (scope.type !== "Property" || !isOurScope(scope.key)) continue;
        if (scope.value.type !== "ObjectExpression") continue;

        for (const entry of scope.value.properties) {
          if (entry.type !== "Property") continue;
          const name = staticKeyName(entry);

          if (name === null) {
            found.push({ api: "payload", key: null, dynamic: true, line: entry.loc.start.line });
            continue;
          }

          // Foundry's legacy deletion form writes `-=key` to remove `key`. It
          // is an operation on that key's identity, so the base name counts.
          found.push({
            api: "payload",
            key: name.startsWith("-=") ? name.slice(2) : name,
            dynamic: false,
            line: entry.loc.start.line,
          });
        }
      }
    }

    // Channel 3 — `doc.flags[MODULE_ID].key`, usually with optional links.
    // These are reads; nothing persists through a property access.
    if (node.type === "MemberExpression") {
      const scopeAccess = node.object;
      if (
        scopeAccess?.type === "MemberExpression" && scopeAccess.computed
        && isOurScope(scopeAccess.property)
        && scopeAccess.object?.type === "MemberExpression"
        && !scopeAccess.object.computed
        && scopeAccess.object.property?.name === "flags"
      ) {
        const name = node.computed
          ? (node.property.type === "Literal" ? String(node.property.value) : null)
          : (node.property.type === "Identifier" ? node.property.name : null);

        found.push({
          api: "property",
          key: name === null ? null : (name.startsWith("-=") ? name.slice(2) : name),
          dynamic: name === null,
          line: node.loc.start.line,
        });
      }
    }
  });

  return found.sort((a, b) => a.line - b.line);
}
