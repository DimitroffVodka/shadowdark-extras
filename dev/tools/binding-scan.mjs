import { maskSource } from "./import-scan.mjs";

/**
 * Unresolved free-identifier scanner.
 *
 * THE GAP THIS FILLS. Phase 3 extractions lift code out of the composition root
 * into a new module. If the lifted code calls a helper that stayed behind, or
 * reads a constant like MODULE_ID that was never imported, nothing catches it:
 *
 *   - the import resolver only checks that import PATHS resolve, not that the
 *     names used inside a file are bound;
 *   - `node --check` is syntax only, and a free identifier is valid syntax;
 *   - the registration and export snapshots compare names, not scopes;
 *   - the tests do not execute Foundry-dependent hook callbacks.
 *
 * So the failure surfaces only when a user triggers the hook and the callback
 * throws ReferenceError. Both of the first three Phase 3 extractions shipped
 * exactly that defect, and review caught it rather than any gate.
 *
 * WHAT THIS CHECKS. For each module, three shapes must be declared locally,
 * imported, or a known global:
 *
 *   1. any identifier CALLED as a bare function;
 *   2. any SCREAMING_SNAKE_CASE reference — module constants like MODULE_ID are
 *      read, never called, so the call pass cannot see them;
 *   3. any `_name` READ — module-scope mutable state, the shape the Phase 5.3
 *      seam extractions leave dangling.
 *
 * Shape-scoped rather than universal, on purpose. Resolving EVERY reference
 * without a scope-accurate parser drowns in false positives; the two naming
 * conventions above are what module-scope bindings actually look like in this
 * codebase, which is where the extraction failure mode lives.
 *
 * Each pass was added because something shipped past the previous set. The call
 * pass came from three Phase 3 extractions that called helpers left behind. The
 * constant pass came from two that used MODULE_ID without importing it. The
 * `_name` pass came from the Phase 5.3 HexPainterSD.mjs split: `_poiRedoStack`
 * moved to a leaf, `getHexPainterData` stayed behind still reading
 * `_poiRedoStack.length`, and the import block named only `_poiUndoStack`. A
 * property read is not a call and is not SCREAMING_SNAKE, so all eight gates in
 * verify.sh — including this one — passed over a file that would have thrown
 * ReferenceError the moment the tray opened.
 */

/** Globals available in a Foundry browser module, plus JS built-ins. */
const KNOWN_GLOBALS = new Set([
  // JS
  "Array", "BigInt", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Math", "Number",
  "Object", "Promise", "Proxy", "Reflect", "RegExp", "Set", "String", "Symbol", "WeakMap", "WeakSet",
  "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "eval", "isNaN", "isFinite",
  "parseFloat", "parseInt", "structuredClone", "queueMicrotask", "require", "import",
  // Legacy but genuinely present in every browser.
  //
  // `unescape` was surfaced by the lookbehind fix below. Its real site is
  // `DungeonGenerator.mjs:752`, inside a template-literal interpolation:
  // `${btoa(unescape(encodeURIComponent(svgString)))}`. The mechanism is the
  // same one the fix is about — `btoa`'s match consumed the `(` that
  // `unescape(` needed — but it is NOT the `if (` shape, and an earlier version
  // of this comment said it was. That description was written from the
  // mechanism instead of from the site, which is the same mistake in kind as
  // the bug being fixed.
  //
  // `escape` is DEFENSIVE: no call to it exists anywhere in this tree today. It
  // is listed because it is `unescape`'s counterpart and would otherwise be the
  // next surprise.
  "escape", "unescape",
  // DOM / browser
  "Blob", "CustomEvent", "Event", "File", "FileReader", "FormData", "Headers", "Image", "MutationObserver",
  "Option",
  "Node", "Request", "Response", "URL", "URLSearchParams", "XMLHttpRequest", "alert", "atob", "btoa",
  "clearInterval", "clearTimeout", "confirm", "document", "fetch", "getComputedStyle", "localStorage",
  "navigator", "prompt", "requestAnimationFrame", "setInterval", "setTimeout", "window", "console", "$", "jQuery",
  // Foundry / system
  "Actor", "ActiveEffect", "Application", "ChatMessage", "CONFIG", "Combat", "Combatant", "Dialog",
  "Die", "Folder", "FormApplication", "Handlebars", "Hooks", "Item", "JournalEntry", "JournalEntryPage",
  "Macro", "MeasuredTemplate", "Playlist", "Roll", "RollTable", "Scene", "Setting", "TextEditor", "Token",
  "TokenDocument", "User", "canvas", "foundry", "game", "ui", "libWrapper", "socketlib", "PIXI", "Sequence",
  "Sequencer", "TokenMagic", "renderTemplate", "loadTemplates", "fromUuid", "fromUuidSync", "getTexture",
  "duplicate", "mergeObject", "setProperty", "getProperty", "hasProperty", "expandObject", "flattenObject",
  "randomID", "isEmpty", "deepClone", "FilePicker", "FontConfig", "Color", "quench",
  "ImagePopout", "Portal", "saveDataToFile", "readTextFromFile", "SearchFilter", "DragDrop", "ContextMenu",
  "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Float32Array", "Float64Array", "DataView",
  "ArrayBuffer", "TextDecoder", "TextEncoder", "SubmitEvent", "DOMParser", "AbortController",
  "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "CSS", "performance", "crypto",
  // Foundry's global constants namespace. Its omission was an oversight, not a
  // judgement: `CONST` matches the SCREAMING_SNAKE reference scan below, so
  // every module reading `CONST.DOCUMENT_OWNERSHIP_LEVELS` or
  // `CONST.KEYBINDING_PRECEDENCE` landed in the baseline as an accepted unbound
  // identifier — 17 of them, 16 shipping in production. Verified live in world
  // `0100` (Foundry 14.365): `typeof CONST === "object"` and `CONST ===
  // foundry.CONST`. Listing it removes exactly those 17 baseline entries and
  // introduces no new ones, so the baseline is left alone: orphaned entries are
  // inert here (the gate diffs current-against-baseline, never the reverse),
  // and re-baselining would discard the accepted set this gate exists to hold.
  "CONST",
]);

/** Syntax keywords a naive `name(` pattern will pick up. */
const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "instanceof", "await", "async",
  "function", "new", "delete", "void", "yield", "throw", "do", "else", "in", "of", "case", "class",
  "const", "let", "var", "export", "default", "super", "this", "try", "finally", "with", "static", "get", "set",
]);

/** Names bound anywhere in the module: declarations, params, imports, assignments. */
function boundNames(masked) {
  const bound = new Set();
  const add = (n) => n && bound.add(n);

  for (const m of masked.matchAll(/\b(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // Class fields — `static DEFAULT_OPTIONS = {…}` / `static PARTS = {…}`, the
  // ApplicationV2 idiom. Not a const/let/var declaration, so without this the
  // field NAME reads as an unbound call the first time an AppV2 class is
  // extracted into its own module.
  //
  // Deliberately requires `static`, and deliberately does NOT match a bare
  // `name = …`. An earlier version did, and that is a FALSE NEGATIVE generator:
  // any assignment inside a function body would bind the name, so
  // `function f() { missing = 1; return missing(); }` reported nothing. A gate
  // that silently stops reporting is worse than the blind spot it replaced.
  // Instance fields (`field = …` with no `static`) are not matched; none exist
  // in this tree, and the cost of missing one is a false POSITIVE, which is the
  // safe direction. See the regression tests in dev/tests/structural-gates.test.mjs.
  for (const m of masked.matchAll(/^\s*static\s+([A-Za-z_$][\w$]*)\s*=[^=>]/gm)) add(m[1]);
  // destructured bindings, incl. `const { a, b: c } = …` and import clauses.
  // The optional identifier before the brace is the default binding in a mixed
  // clause — `import Default, { named } from …`. Without it the named half is
  // invisible here and every name in it reads as unbound.
  for (const m of masked.matchAll(/(?:const|let|var|import)\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(":").pop().split(/\s+as\s+/).pop().trim().replace(/^\.\.\./, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }
  for (const m of masked.matchAll(/import\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of masked.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // function parameters and arrow parameters, including destructured ones —
  // `fn({ a, b: c })` binds a and c. Without stripping the braces each part
  // still carries one, fails the identifier test, and the name reads as unbound
  // everywhere it is used.
  for (const m of masked.matchAll(/(?:function\s*\*?\s*[A-Za-z_$][\w$]*)?\s*\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(",")) {
      const name = part
        .replace(/[{}[\]]/g, " ")
        .trim()
        .split("=")[0]      // default value
        .split(":").pop()   // `{ a: localName }` binds localName
        .trim()
        .replace(/^\.\.\./, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }
  for (const m of masked.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  for (const m of masked.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  addDestructuredParamNames(masked, add);
  return bound;
}

/**
 * Destructured PARAMETERS whose defaults contain parentheses.
 *
 * The parameter pass above matches `\(([^()]*)\)` — a parameter list with no
 * nested parens. That excludes the dependency-injection shape this codebase
 * uses for testability:
 *
 *   export async function createPartyFromSelectedTokens({
 *     createActor = data => CONFIG.Actor.documentClass.create(data),
 *     placeToken = placeActorTokenWithPreview,
 *   } = {}) {
 *
 * The default value contains `(data)`, so the whole list fails to match and
 * NOTHING in it binds. Both names then read as unbound at their call sites and
 * the gate blocks a PR over correct code — which is what happened on #126.
 *
 * Brace-balanced rather than regex, because the defaults can contain arbitrary
 * nesting. Only the BINDING half of each part is taken (left of `=`, right of
 * `:`), so an unbound helper called inside a default value still reports.
 */
function addDestructuredParamNames(masked, add) {
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] !== "(") continue;
    let open = i + 1;
    while (open < masked.length && /\s/.test(masked[open])) open += 1;
    if (masked[open] !== "{") continue;

    let depth = 0;
    let close = open;
    for (; close < masked.length; close += 1) {
      if (masked[close] === "{") depth += 1;
      else if (masked[close] === "}") { depth -= 1; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    for (const name of destructuredBindingNames(masked.slice(open + 1, close))) add(name);
    i = close;
  }
}

/** Binding names declared by one destructuring body, nested patterns included. */
function destructuredBindingNames(body) {
  const names = [];
  for (const part of splitTopLevel(body)) {
    // Left of the first default `=` — never `=>`, `==`, `<=`, `>=`, `!=`.
    let binding = part;
    for (let i = 0; i < part.length; i += 1) {
      if (part[i] !== "=") continue;
      if (part[i + 1] === "=" || part[i + 1] === ">") break;
      if ("=!<>".includes(part[i - 1])) continue;
      binding = part.slice(0, i);
      break;
    }
    // `{ key: local }` binds local; `{ key: { nested } }` recurses.
    const colon = binding.indexOf(":");
    if (colon !== -1) binding = binding.slice(colon + 1);
    binding = binding.trim().replace(/^\.\.\./, "").trim();

    if (binding.startsWith("{") || binding.startsWith("[")) {
      names.push(...destructuredBindingNames(binding.replace(/^[{[]|[\]}]$/g, "")));
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(binding)) names.push(binding);
  }
  return names;
}

/** Split on commas that sit outside every (), {} and [] pair. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if ("({[".includes(c)) depth += 1;
    else if (")}]".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.filter((p) => p.trim() !== "");
}

/**
 * @returns {Array<{name: string, line: number}>} identifiers used but never bound
 */
export function findUnboundIdentifiers(source) {
  const { masked } = maskSource(source);
  const bound = boundNames(masked);
  const lineStarts = [0];
  for (let i = 0; i < masked.length; i += 1) if (masked[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (o) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= o) lo = m; else hi = m - 1; } return lo + 1; };

  /** Skip a balanced (…), returning the offset just past it. */
  const afterParens = (open) => {
    let d = 0, e = open;
    while (e < masked.length) { const c = masked[e]; if (c === "(") d += 1; else if (c === ")") { d -= 1; if (d === 0) return e + 1; } e += 1; }
    return e;
  };

  const seen = new Map();
  // A bare call: not preceded by `.` (method access), `?.`, or an identifier char.
  //
  // LOOKBEHIND, NOT A CONSUMING GROUP. This used to be `(^|[^\w$.?])`, which ATE
  // the preceding character — so in `if (isPartyActor(actor))` the `if (` match
  // consumed the `(` that `isPartyActor(` needed, and the inner call was never
  // seen. Every call written as the first thing inside `if (`, `while (`,
  // `switch (`, `return (` was invisible, which is a very common shape: the
  // Phase 3 move of `applyNpcPlayerTheme` shipped a ReferenceError past a green
  // gate for exactly this reason, and live testing caught it, not the gate.
  for (const m of masked.matchAll(/(?<![\w$.?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (KEYWORDS.has(name) || KNOWN_GLOBALS.has(name) || bound.has(name)) continue;

    // A DEFINITION — class method, object shorthand, getter — is `name(…) {`.
    // A call is never followed by a block. Without this, every method in every
    // class reads as an unbound call and the signal drowns in ~1200 of them.
    const open = masked.indexOf("(", m.index + name.length - 1);
    let after = afterParens(open);
    while (after < masked.length && /\s/.test(masked[after])) after += 1;
    if (masked[after] === "{") continue;

    if (!seen.has(name)) seen.set(name, lineOf(m.index));
  }

  /**
   * Calls are not the only way an extraction dangles. `MODULE_ID` is READ, never
   * called, so a call-only scan misses it entirely — which is exactly how two
   * extractions shipped `flags.${MODULE_ID}` with no binding for it.
   *
   * Checking every bare reference would drown in false positives (property
   * shorthand, labels, JSX-ish patterns). SCREAMING_SNAKE_CASE is the
   * convention this codebase uses for module-scope constants, and those are the
   * ones extraction leaves behind, so the check is scoped to that shape.
   */
  // Lookbehind here for the same reason as the call scan above: a consuming
  // group loses any reference whose preceding character was already eaten by an
  // adjacent match.
  for (const m of masked.matchAll(/(?<![\w$.?])([A-Z][A-Z0-9_]{2,})\b/g)) {
    const name = m[1];
    if (KEYWORDS.has(name) || KNOWN_GLOBALS.has(name) || bound.has(name) || seen.has(name)) continue;

    // An object-literal KEY — `{ CAROUSING: "party.carousing" }` — declares a
    // property, it does not reference anything. A SCREAMING_SNAKE id map is the
    // natural shape for this codebase's feature catalog, and without this the
    // whole map reads as unbound: FEATURE_IDS alone put 81 false findings into
    // #126 and blocked it.
    //
    // Same narrow test the `_name` pass below uses, and for the same reason —
    // keyed on what PRECEDES the name, because a ternary consequent is also
    // followed by `:`. A shorthand `{ FOO }` and a value `{ k: FOO }` are both
    // real references and both still report.
    const before = masked.slice(0, m.index).replace(/\s+$/, "");
    const afterName = masked.slice(m.index + name.length).replace(/^\s+/, "");
    if (afterName.startsWith(":") && !afterName.startsWith("::")
      && (before.endsWith("{") || before.endsWith(","))) continue;

    seen.set(name, lineOf(m.index));
  }

  /**
   * The other half of the read problem, and the one the SCREAMING_SNAKE pass
   * above does not reach: module-scope MUTABLE state, which this codebase names
   * with a leading underscore.
   *
   * The Phase 5.3 split of HexPainterSD.mjs shipped exactly this. `_poiRedoStack`
   * moved to a new leaf; `getHexPainterData` stayed behind still reading
   * `_poiRedoStack.length`; the import block named only `_poiUndoStack`. It is a
   * property read, never a call, so the call pass could not see it, and it is
   * not SCREAMING_SNAKE, so the constant pass could not either. Every gate in
   * verify.sh passed — including this one — over a file that would throw
   * ReferenceError the moment the tray opened.
   *
   * The seam-extraction work this repo is doing produces that shape constantly:
   * a binding moves out, a reader stays behind. Scoping to the `_name`
   * convention is the same trade the constant pass makes — narrow enough to keep
   * false positives near zero without a scope-accurate parser, wide enough to
   * cover what extraction actually leaves dangling. A bare `_` is excluded: it
   * is the conventional throwaway parameter and a common library alias.
   */
  for (const m of masked.matchAll(/(?<![\w$.?#])(_[A-Za-z_$][\w$]*)\b/g)) {
    const name = m[1];
    if (KEYWORDS.has(name) || KNOWN_GLOBALS.has(name) || bound.has(name) || seen.has(name)) continue;

    // A DEFINITION, not a reference — `_onRender(options) {`. Private class
    // methods are the dominant `_name` shape in this tree after module state,
    // and without this every one of them reads as unbound. Same rule the call
    // pass uses, for the same reason.
    const paren = masked.indexOf("(", m.index + name.length - 1);
    if (paren !== -1 && masked.slice(m.index + name.length, paren).trim() === "") {
      let after = afterParens(paren);
      while (after < masked.length && /\s/.test(masked[after])) after += 1;
      if (masked[after] === "{") continue;
    }

    // An object-literal KEY — `{ _foo: 1 }` — is not a reference to anything.
    //
    // Keyed off what PRECEDES the name, not merely a following `:`. A ternary
    // consequent is also followed by `:` — `_poiMirror ? -_poiScale : _poiScale`
    // is real code in this tree — and skipping on the colon alone would have
    // made a genuine unbound read invisible. False negatives are the failure
    // this gate's history is made of, so the narrower test is the right one.
    const before = masked.slice(0, m.index).replace(/\s+$/, "");
    const afterName = masked.slice(m.index + name.length).replace(/^\s+/, "");
    if (afterName.startsWith(":") && !afterName.startsWith("::")
      && (before.endsWith("{") || before.endsWith(","))) continue;

    // A WRITE TARGET — `_colorOverlay = null` — is not a read, and this pass is
    // a read scan. The occurrence is skipped, NOT the name: a genuine read of
    // the same identifier anywhere else in the module still reports, which is
    // what keeps this from becoming the false-negative generator the class-field
    // rule in boundNames was fixed to avoid.
    //
    // The shape being excluded is the instance class field, `_inspectorEl = null;`
    // at class-body position. It is the dominant `_name` declaration form in this
    // tree — seven of the eight hits the first run of this pass produced were
    // exactly that — and boundNames deliberately does not bind bare assignments,
    // so there is nowhere else to handle it. `+=`, `==` and `===` are all reads
    // and are left alone.
    if (/^=[^=]/.test(afterName)) continue;

    seen.set(name, lineOf(m.index));
  }

  return [...seen].map(([name, line]) => ({ name, line })).sort((a, b) => a.line - b.line);
}
