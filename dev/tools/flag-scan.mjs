import * as acorn from "acorn";

import { maskSource } from "./import-scan.mjs";
import { buildLineIndex, lineAt, literalArgument, literalIndex, argumentOffsets } from "./call-scan.mjs";

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
 * FOUR CHANNELS, because Foundry offers four and this module uses all of them.
 * `scanFlags` covers the method calls by masking and matching text;
 * `scanFlagLiterals` covers the other three with a real parse:
 *
 *   setFlag / getFlag / unsetFlag        method calls      scanFlags
 *   flags: { [MODULE_ID]: { k: v } }     create/update     scanFlagLiterals
 *   doc.flags?.[MODULE_ID]?.k            direct property   scanFlagLiterals
 *   `flags.${MODULE_ID}.k`               dotted path       scanFlagLiterals
 *
 * The first version of this gate covered only the method channel and reported
 * itself as repo-wide. It was not: 72 keys were invisible to it, 20 of them in
 * the very files the sweep-6 split was about to touch. See issue #91.
 *
 * KEYS ARE FULL DOTTED PATHS, not first segments. A flag value is frequently an
 * object, and its sub-keys are stored on the document exactly as its top-level
 * key is — `flags.<id>.aura.regionId` is one addressable path, and renaming
 * `regionId` orphans data just as thoroughly as renaming `aura` would. Every
 * channel below records the deepest path each site touches. See issue #95.
 *
 * ENTRIES SAY WHETHER THEY PERSIST rather than leaving the caller to infer it
 * from the channel. Three of the four channels are wholly one or the other, but
 * a dotted path is a write or a read depending only on where it sits, so the
 * channel name stopped being a usable proxy.
 */

/**
 * Module-level string constants, for resolving a dynamic scope argument.
 *
 * `actor.getFlag(MODULE_ID, key)` has no literal in the scope position, so a
 * text scanner has to decide what `MODULE_ID` means. Almost every call site in
 * this module declares `const MODULE_ID = "shadowdark-extras"` at module top;
 * resolving that turns the site from a "treated as ours by assumption" into a
 * literal "ours". A scope that resolves to some OTHER module's id is then
 * classified foreign instead of ours (issue #95 finding 3).
 *
 * Only top-level `const` string declarations are resolved. Anything else — an
 * import, a parameter, a non-string value — stays unresolved and the caller
 * records the identifier name rather than guessing at its meaning.
 */
function moduleStringConstants(source) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2023, sourceType: "module" });
  }
  catch {
    return new Map();
  }

  const constants = new Map();
  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration" || node.kind !== "const") continue;
    for (const declarator of node.declarations) {
      if (declarator.id.type !== "Identifier" || !declarator.init) continue;
      const init = declarator.init;
      let value = null;
      if (init.type === "Literal" && typeof init.value === "string") value = init.value;
      else if (init.type === "TemplateLiteral" && init.expressions.length === 0) {
        const cooked = init.quasis[0]?.value.cooked;
        if (typeof cooked === "string") value = cooked;
      }
      if (value !== null) constants.set(declarator.id.name, value);
    }
  }
  return constants;
}

/** The text of one call argument, as written, for reporting an unresolved scope. */
function argumentText(maskedChars, openParen, position) {
  const offsets = argumentOffsets(maskedChars, openParen);
  const offset = offsets[position];
  if (offset === undefined) return null;

  let depth = 0;
  let end = offset;
  while (end < maskedChars.length) {
    const char = maskedChars[end];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) break;
      depth -= 1;
    }
    else if (char === "," && depth === 0) break;
    end += 1;
  }
  return maskedChars.slice(offset, end).join("").trim() || null;
}

/**
 * @param {string} source
 * @returns {Array<{api: string, scope: string|null, key: string|null,
 *   dynamicScope: boolean, dynamic: boolean, unresolvedScope: string|null,
 *   line: number}>}
 */
export function scanFlags(source) {
  const { masked, maskedChars, literals } = maskSource(source);
  const literalsByStart = literalIndex(literals);
  const lineStarts = buildLineIndex(source);
  const constants = moduleStringConstants(source);
  const found = [];

  // Any receiver: the document varies (scene, journal, actor, token, item) and
  // is rarely a resolvable name at the call site. The flag APIs are distinctive
  // enough on their own that a bare method-name match does not collide.
  for (const match of masked.matchAll(/\.\s*(setFlag|unsetFlag|getFlag)\s*\(/g)) {
    const openParen = match.index + match[0].length - 1;
    const scopeArg = literalArgument(maskedChars, literalsByStart, openParen, 0);
    const key = literalArgument(maskedChars, literalsByStart, openParen, 1);

    let scope = scopeArg;
    let unresolvedScope = null;
    if (scopeArg.dynamic) {
      // A bare identifier is usually the local `MODULE_ID` constant. Resolve it
      // through the module's top-level constants so a foreign scope (a
      // `const OTHER = "tokenmagic"` at a call site) is classified foreign and
      // not silently treated as ours.
      const name = argumentText(maskedChars, openParen, 0);
      const resolved = name !== null ? constants.get(name) : undefined;
      if (resolved !== undefined) {
        scope = { name: resolved, dynamic: false };
      }
      else {
        // Imported, a parameter, or otherwise unknowable — keep the historical
        // "treated as ours" behaviour, but record the name so the snapshot can
        // show what the gate is assuming about.
        unresolvedScope = name;
      }
    }

    found.push({
      api: match[1],
      scope: scope.dynamic ? null : scope.name,
      key: key.dynamic ? null : key.name,
      dynamicScope: scope.dynamic,
      unresolvedScope,
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
 * Strip the wrappers an alias initializer can carry: the `ChainExpression`
 * around any optional chain, and a `|| {}` / `?? {}` fallback around the root
 * access itself. The fallback never carries flag keys, so only the left side
 * matters.
 */
function unwrapAliasInit(node) {
  let current = node;
  for (;;) {
    let next = current;
    while (next?.type === "ChainExpression") next = next.expression;
    while (
      next?.type === "LogicalExpression"
      && (next.operator === "||" || next.operator === "??")
    ) next = next.left;
    if (next === current) return current;
    current = next;
  }
}

/**
 * The flag-key segments an alias initializer fixes, or null when it is not an
 * alias of a `.flags[OURS]` chain at all. A bare root fixes nothing; a
 * `weapon.flags[OURS].weaponBonus` fixes `weaponBonus`. A computed base
 * segment is a hole the alias cannot speak to, so it is not an alias either.
 */
function aliasBase(node) {
  if (isScopeAccess(node)) return [];
  const chain = flagChain(node);
  if (!chain || chain.segments.includes(null)) return null;
  return chain.segments;
}

/**
 * Collect the lexical scopes of a module, each carrying the names its
 * bindings declare — `const` flag aliases included.
 *
 * `const flags = tileDoc.flags?.[MODULE_ID]` makes every later `flags.key` a
 * flag read the chain matcher cannot see, because `flags` is a bare identifier
 * with nothing about `.flags` left in it. Without this pass those keys look
 * write-only to the gate, so removing their reads never moves them out of the
 * "still read" list (issue #95 finding 2).
 *
 * Matching has to be LEXICAL, not positional. A same-named binding in an inner
 * scope shadows the alias (`function f(x) { const flags = x; return flags.foo }`
 * reads nothing of ours), and a block-scoped alias only covers its own block.
 * The returned scope tree is walked from the innermost scope containing a read
 * outward, so the first binding of a name wins exactly as JavaScript resolves
 * it.
 *
 * Conservative by design:
 *   - only `const` declarations whose initializer is a `.flags[OURS]` chain
 *     are aliases; every other binding (params, imports, `let`/`var`, a
 *     destructured name) shadows rather than aliases
 *   - one hop from the root: an alias of an alias, a destructured slice, or a
 *     reassigned binding is not followed, so it is simply not an alias
 */
function collectAliases(ast) {
  const scopes = [];
  let current = null;

  const push = (node, isFunction = false) => {
    current = { parent: current, start: node.start, end: node.end, bindings: new Map(), isFunction };
    scopes.push(current);
  };
  const pop = () => { current = current.parent; };

  const bind = (name, base) => {
    if (typeof name === "string" && current) current.bindings.set(name, { base });
  };
  // `var` is function-scoped: a var declaration anywhere in a function body
  // hoists to (and shadows within) the whole function, not just its block.
  const bindVar = (pattern) => {
    if (!pattern) return;
    let scope = current;
    while (scope && !scope.isFunction) scope = scope.parent;
    if (!scope) return;
    const target = scope;
    const bindAt = (name) => {
      if (typeof name === "string") target.bindings.set(name, { base: null });
    };
    // Same traversal as bindPattern, but writing into the function scope.
    const bindVarPattern = (node) => {
      switch (node.type) {
        case "Identifier":
          bindAt(node.name);
          break;
        case "ObjectPattern":
          for (const property of node.properties) {
            if (property.type === "RestElement") bindVarPattern(property.argument);
            else bindVarPattern(property.value);
          }
          break;
        case "ArrayPattern":
          for (const element of node.elements) bindVarPattern(element);
          break;
        case "AssignmentPattern":
          bindVarPattern(node.left);
          break;
        case "RestElement":
          bindVarPattern(node.argument);
          break;
      }
    };
    bindVarPattern(pattern);
  };
  const bindPattern = (pattern, base) => {
    if (!pattern) return;
    switch (pattern.type) {
      case "Identifier":
        bind(pattern.name, base);
        break;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          if (property.type === "RestElement") bindPattern(property.argument, base);
          else bindPattern(property.value, base);
        }
        break;
      case "ArrayPattern":
        for (const element of pattern.elements) bindPattern(element, base);
        break;
      case "AssignmentPattern":
        bindPattern(pattern.left, base);
        break;
      case "RestElement":
        bindPattern(pattern.argument, base);
        break;
    }
  };

  const walk = (node) => {
    if (!node || typeof node.type !== "string") return;

    switch (node.type) {
      case "Program":
      case "BlockStatement":
        push(node);
        for (const child of node.body) walk(child);
        pop();
        return;
      case "FunctionDeclaration":
        if (node.id) bind(node.id.name, null);
        push(node, true);
        for (const param of node.params) bindPattern(param, null);
        walk(node.body);
        pop();
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        push(node, true);
        if (node.id) bind(node.id.name, null);
        for (const param of node.params) bindPattern(param, null);
        walk(node.body);
        pop();
        return;
      case "ClassDeclaration":
        if (node.id) bind(node.id.name, null);
        push(node);
        walk(node.body);
        pop();
        return;
      case "CatchClause":
        push(node);
        bindPattern(node.param, null);
        walk(node.body);
        pop();
        return;
      case "ImportDeclaration":
        for (const specifier of node.specifiers) {
          if (specifier.local) bind(specifier.local.name, null);
        }
        return;
      case "VariableDeclaration":
        for (const declarator of node.declarations) {
          if (declarator.id.type === "Identifier") {
            if (node.kind === "const") {
              const base = aliasBase(unwrapAliasInit(declarator.init));
              bind(declarator.id.name, base);
            }
            else if (node.kind === "var") bindVar(declarator.id);
            else bind(declarator.id.name, null);
          }
          else if (node.kind === "var") {
            bindVar(declarator.id);
          }
          else {
            bindPattern(declarator.id, null);
          }
          if (declarator.init) walk(declarator.init);
        }
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const head = node.type === "ForStatement" ? node.init : node.left;
        if (head?.type === "VariableDeclaration") {
          push(node);
          walk(head);
          if (node.type === "ForStatement") {
            walk(node.test);
            walk(node.update);
          }
          else walk(node.right);
          walk(node.body);
          pop();
          return;
        }
        if (node.type === "ForStatement") {
          walk(node.init);
          walk(node.test);
          walk(node.update);
        }
        else {
          walk(node.left);
          walk(node.right);
        }
        walk(node.body);
        return;
      }
      default:
        for (const key of Object.keys(node)) {
          if (key === "type" || key === "start" || key === "end") continue;
          const value = node[key];
          if (Array.isArray(value)) {
            for (const child of value) walk(child);
          }
          else if (value && typeof value.type === "string") walk(value);
        }
    }
  };

  walk(ast);
  return scopes;
}

/** The innermost scope whose node range contains `offset`, or null. */
function scopeAt(scopes, offset) {
  let best = null;
  for (const scope of scopes) {
    if (scope.start <= offset && offset < scope.end) {
      if (!best || scope.end - scope.start < best.end - best.start) best = scope;
    }
  }
  return best;
}

/**
 * Resolve a member chain whose base is a lexical binding of the `.flags[OURS]`
 * root. Returns the full flag-key segments (alias base first), the members to
 * suppress as prefixes, or null when the chain is not an aliased flag read.
 *
 * The innermost binding of the base name wins, exactly as JavaScript resolves
 * it: an inner `const flags = x` shadows the alias, and a block-scoped alias
 * is invisible outside its block.
 */
function resolveAliasRead(node, scopes) {
  const segments = [];
  const members = [];
  let current = node;

  while (current?.type === "MemberExpression") {
    if (isScopeAccess(current)) return null;
    segments.unshift(staticSegmentName(current));
    members.push(current);
    current = current.object;
  }
  if (current?.type !== "Identifier") return null;

  const name = current.name;
  let scope = scopeAt(scopes, node.start);
  while (scope) {
    const binding = scope.bindings.get(name);
    if (binding !== undefined) {
      if (binding.base === null) return null;
      return { segments: [...binding.base, ...segments], members };
    }
    scope = scope.parent;
  }
  return null;
}

/**
 * Read a template or string literal as a list of atoms — literal text, and the
 * interpolations between it. Null when the node is not a string at all.
 */
function stringAtoms(node) {
  if (node.type === "Literal") {
    return typeof node.value === "string" ? [{ text: node.value }] : null;
  }
  if (node.type !== "TemplateLiteral") return null;

  const atoms = [];
  for (const [index, quasi] of node.quasis.entries()) {
    // Cooked is null only for an invalid escape in a tagged template, where
    // there is no string value to read.
    if (quasi.value.cooked === null) return null;
    atoms.push({ text: quasi.value.cooked });
    if (index < node.expressions.length) atoms.push({ expression: node.expressions[index] });
  }
  return atoms;
}

/**
 * Split atoms on the dots in their literal text, keeping interpolations whole.
 *
 * Empty text is dropped rather than kept as an atom: a template puts one on
 * either side of every interpolation, and `${MODULE_ID}` has to come out as a
 * segment that is exactly one expression for the scope check to read it.
 */
function splitOnDots(atoms) {
  const segments = [[]];

  for (const atom of atoms) {
    if (atom.expression) {
      segments.at(-1).push(atom);
      continue;
    }
    const [first, ...rest] = atom.text.split(".");
    if (first !== "") segments.at(-1).push({ text: first });
    for (const part of rest) segments.push(part === "" ? [] : [{ text: part }]);
  }

  return segments;
}

/** The literal name of a path segment, or null when it is not fully knowable. */
function segmentName(segment) {
  if (segment.some((atom) => atom.expression)) return null;
  return segment.map((atom) => atom.text).join("") || null;
}

/**
 * Read a string as a dotted flag path — `flags.<scope>.<key>[.<key>…]`.
 *
 * Foundry addresses a flag by path as well as by namespace object, and an
 * update keyed by one persists exactly the same data. Returns null when the
 * string is not one of ours: a different package's scope, a scope that cannot
 * be shown to be ours, or the bare namespace with no key under it.
 */
function flagUpdatePath(node) {
  const atoms = stringAtoms(node);
  if (!atoms) return null;

  const [head, scope, ...rest] = splitOnDots(atoms);
  if (segmentName(head) !== "flags" || !scope || rest.length === 0) return null;

  // A scope of `${MODULE_ID}` or the literal id is ours; `${scope}` could name
  // any package, and the object channels do not assume otherwise either.
  const literalScope = segmentName(scope);
  const isOurs = literalScope === MODULE_ID
    || (scope.length === 1 && scope[0].expression && isOurScope(scope[0].expression));
  if (!isOurs) return null;

  // An interpolation is a hole in the path. Everything above it is still a key
  // we know — `carousingDrops.${userId}` is `carousingDrops`, and emphatically
  // not `carousingDrops.` — but a hole in the FIRST segment leaves no key.
  const names = rest.map(segmentName);
  const hole = names.indexOf(null);
  if (hole === 0) return { key: null, dynamic: true };

  const path = hole === -1 ? names : names.slice(0, hole);
  return { key: path.map(baseName).join("."), dynamic: false };
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
      found.push({
        api: "payload", key: null, dynamic: true, writes: true, line: entry.loc.start.line,
      });
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
      writes: true,
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

  // Channel 4 records a path string wherever it appears, so what marks a write
  // is position: a key position is an update payload, anything else is code
  // reading a path rather than persisting through one.
  const keyPositions = new Set();

  const scopes = collectAliases(ast);

  visit(ast, (node) => {
    if (node.type === "CallExpression" || node.type === "NewExpression") callees.add(node.callee);
    if (node.type === "Property") keyPositions.add(node.key);
    if (
      node.type === "AssignmentExpression"
      && node.left.type === "MemberExpression" && node.left.computed
    ) {
      keyPositions.add(node.left.property);
    }

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
    // These are reads; nothing persists through a property access. The chain
    // matcher covers the direct form; a member chain rooted at a lexical alias
    // of `.flags[OURS]` (issue #95 finding 2) is resolved through `scopes`.
    if (node.type === "MemberExpression" && !consumed.has(node)) {
      const chain = flagChain(node);
      const alias = chain ? null : resolveAliasRead(node, scopes);
      if (!chain && !alias) return;

      const segments = chain ? chain.segments : alias.segments;
      for (const member of (chain ? chain.members : alias.members)) consumed.add(member);

      // A computed segment is a hole in the path. The prefix above it is still
      // a key we know, so the path truncates there rather than being guessed
      // at; a hole in the FIRST segment leaves no key at all, which is the
      // dynamic site the snapshot records as its own blind spot.
      const hole = segments.indexOf(null);
      if (hole === 0) {
        found.push({
          api: "property", key: null, dynamic: true, writes: false, line: node.loc.start.line,
        });
        return;
      }

      let path = hole === -1 ? segments : segments.slice(0, hole);
      if (hole === -1 && callees.has(node) && path.length > 1) path = path.slice(0, -1);

      // `.length` on a flag value is the array's length, not a stored sub-key —
      // the same incidental access as a method call, and as recordable or not
      // as one. No stored `*.length` key exists, so a trailing `length` is
      // dropped the way a trailing callee is.
      if (hole === -1 && path.length > 1 && path.at(-1) === "length") path = path.slice(0, -1);

      found.push({
        api: "property",
        key: path.map(baseName).join("."),
        dynamic: false,
        writes: false,
        line: node.loc.start.line,
      });
    }

    // Channel 4 — `update({ [`flags.${MODULE_ID}.aura.regionId`]: v })` and its
    // siblings: the same path written as a plain string key, assigned into an
    // update object, handed to `getProperty`, or held in a const. This is where
    // the write half of `aura.regionId` lives, and it was invisible to all
    // three channels above. See issue #95.
    if (node.type === "TemplateLiteral" || node.type === "Literal") {
      const path = flagUpdatePath(node);
      if (!path) return;

      found.push({
        api: "updatePath",
        key: path.key,
        dynamic: path.dynamic,
        writes: keyPositions.has(node),
        line: node.loc.start.line,
      });
    }
  });

  return found.sort((a, b) => a.line - b.line);
}
