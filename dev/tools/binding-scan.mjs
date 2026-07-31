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
 * WHAT THIS CHECKS. For each module: every identifier that is CALLED as a bare
 * function must be declared locally, imported, or a known global. Deliberately
 * conservative — it inspects calls only, not every reference — because that is
 * where the extraction failure mode lives and it keeps false positives near
 * zero without scope-accurate parsing.
 */

/** Globals available in a Foundry browser module, plus JS built-ins. */
const KNOWN_GLOBALS = new Set([
  // JS
  "Array", "BigInt", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Math", "Number",
  "Object", "Promise", "Proxy", "Reflect", "RegExp", "Set", "String", "Symbol", "WeakMap", "WeakSet",
  "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "eval", "isNaN", "isFinite",
  "parseFloat", "parseInt", "structuredClone", "queueMicrotask", "require", "import",
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
  return bound;
}

/**
 * @returns {Array<{name: string, line: number}>} identifiers called but never bound
 */
export function findUnboundCalls(source) {
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
  for (const m of masked.matchAll(/(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (KEYWORDS.has(name) || KNOWN_GLOBALS.has(name) || bound.has(name)) continue;

    // A DEFINITION — class method, object shorthand, getter — is `name(…) {`.
    // A call is never followed by a block. Without this, every method in every
    // class reads as an unbound call and the signal drowns in ~1200 of them.
    const open = masked.indexOf("(", m.index + m[1].length + name.length - 1);
    let after = afterParens(open);
    while (after < masked.length && /\s/.test(masked[after])) after += 1;
    if (masked[after] === "{") continue;

    if (!seen.has(name)) seen.set(name, lineOf(m.index + m[1].length));
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
  for (const m of masked.matchAll(/(^|[^\w$.?])([A-Z][A-Z0-9_]{2,})\b/g)) {
    const name = m[2];
    if (KEYWORDS.has(name) || KNOWN_GLOBALS.has(name) || bound.has(name) || seen.has(name)) continue;
    seen.set(name, lineOf(m.index + m[1].length));
  }

  return [...seen].map(([name, line]) => ({ name, line })).sort((a, b) => a.line - b.line);
}
