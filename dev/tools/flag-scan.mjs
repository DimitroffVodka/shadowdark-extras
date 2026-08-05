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
 *
 * KEYS ARE FULL DOTTED PATHS, not first segments. A flag value is frequently an
 * object, and its sub-keys are stored on the document exactly as its top-level
 * key is — `flags.<id>.aura.regionId` is one addressable path, and renaming
 * `regionId` orphans data just as thoroughly as renaming `aura` would. Both
 * literal channels record the deepest path each site touches. See issue #95.
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

/** Foundry's legacy deletion form writes `-=key` to remove `key`. */
function baseName(name) {
  return name.startsWith("-=") ? name.slice(2) : name;
}

/**
 * The literal name of a member-access segment, or null when computed at runtime.
 */
function staticSegmentName(member) {
  if (member.computed) {
    return member.property.type === "Literal" ? String(member.property.value) : null;
  }
  return member.property.type === "Identifier" ? member.property.name : null;
}

/** Is this node the `<anything>.flags[OURS]` root of a flag chain? */
function isScopeAccess(node) {
  return node?.type === "MemberExpression" && node.computed
    && isOurScope(node.property)
    && node.object?.type === "MemberExpression"
    && !node.object.computed
    && node.object.property?.name === "flags";
}

/**
 * Peel a member chain back to its `.flags[OURS]` root.
 *
 * Returns the segments above that root, outermost last, with a null for every
 * segment computed at runtime — or null when this is not a flag chain at all.
 * `members` is every node walked through, so the caller can suppress the inner
 * prefixes: `doc.flags[OURS].aura.regionId` is one path, not also `aura`.
 */
function flagChain(node) {
  const segments = [];
  const members = [];
  let current = node;

  while (current?.type === "MemberExpression") {
    if (isScopeAccess(current)) return segments.length > 0 ? { segments, members } : null;
    segments.unshift(staticSegmentName(current));
    members.push(current);
    current = current.object;
  }

  return null;
}

/**
 * Walk a namespace payload object, recording the deepest path of each branch.
 *
 * Returns whether anything concrete was found, which decides what an object
 * whose contents cannot be enumerated — `{}`, `{ ...rest }`, `{ [k]: v }` —
 * contributes: the parent is still a real write, so it is recorded in its own
 * right rather than disappearing along with the child that could not be read.
 */
function collectPayloadPaths(object, prefix, found) {
  let concrete = false;

  for (const entry of object.properties) {
    if (entry.type !== "Property") continue;
    const name = staticKeyName(entry);

    if (name === null) {
      found.push({ api: "payload", key: null, dynamic: true, line: entry.loc.start.line });
      continue;
    }

    const path = [...prefix, baseName(name)];
    if (entry.value.type === "ObjectExpression" && collectPayloadPaths(entry.value, path, found)) {
      concrete = true;
      continue;
    }

    found.push({
      api: "payload",
      key: path.join("."),
      dynamic: false,
      line: entry.loc.start.line,
    });
    concrete = true;
  }

  return concrete;
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
  catch (err) {
    // FAILS OPEN ON PURPOSE, BUT LOUDLY — and the caller decides.
    //
    // The first version swallowed this and returned []. That is a silent
    // green: a first-party file using syntax newer than the pinned ecmaVersion
    // (Node accepts `using` declarations that acorn 2023 does not) would
    // contribute no keys at all, and the snapshot would stay happy while a
    // whole file's worth of flags went unscanned.
    //
    // Returning the error rather than throwing keeps vendored trees survivable
    // while making the omission visible to `collectFlagKeys`, which blocks on
    // it for first-party paths.
    return { parseError: err.message ?? String(err) };
  }

  const found = [];

  // Chains are read from the outside in, so the traversal reaches the longest
  // form of each one first; its prefixes are then skipped rather than recorded
  // as separate shallower keys. Callees are marked for the same reason: the
  // `forEach` in `flags[OURS].tiles.forEach(…)` is a method on the flag's value,
  // not a path stored under it.
  const consumed = new Set();
  const callees = new Set();

  visit(ast, (node) => {
    if (node.type === "CallExpression" || node.type === "NewExpression") callees.add(node.callee);

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

        collectPayloadPaths(scope.value, [], found);
      }
    }

    // Channel 3 — `doc.flags[MODULE_ID].key`, usually with optional links.
    // These are reads; nothing persists through a property access.
    if (node.type === "MemberExpression" && !consumed.has(node)) {
      const chain = flagChain(node);
      if (!chain) return;

      for (const member of chain.members) consumed.add(member);

      // A computed segment is a hole in the path. The prefix above it is still
      // a key we know, so the path truncates there rather than being guessed
      // at; a hole in the FIRST segment leaves no key at all, which is the
      // dynamic site the snapshot records as its own blind spot.
      const hole = chain.segments.indexOf(null);
      if (hole === 0) {
        found.push({ api: "property", key: null, dynamic: true, line: node.loc.start.line });
        return;
      }

      let path = hole === -1 ? chain.segments : chain.segments.slice(0, hole);
      if (hole === -1 && callees.has(node) && path.length > 1) path = path.slice(0, -1);

      found.push({
        api: "property",
        key: path.map(baseName).join("."),
        dynamic: false,
        line: node.loc.start.line,
      });
    }
  });

  return found.sort((a, b) => a.line - b.line);
}
