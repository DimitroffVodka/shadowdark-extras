import path from "node:path";

/**
 * Import scanner for the feature-reorganization structural track.
 *
 * The track renames script file paths and nothing else, so the whole risk model
 * is "did every relative import survive the move". A line-by-line grep is not
 * good enough: it reports imports written inside comments and strings, misses
 * dynamic imports split across lines, and — worst of all — silently
 * under-reports once it mistakes a quote inside a regex literal for the start of
 * a string.
 *
 * So this masks the source first. Comments and regex literals become spaces;
 * string and template contents become spaces but keep their delimiters. Line
 * numbers survive because masking is length-preserving. Then, rather than
 * pattern-matching import statements, we walk the recorded string literals and
 * look *backwards* for what introduced each one. That inversion is what makes
 * the multiline and backtick forms fall out for free.
 *
 * No parser dependency: the module ships with one devDependency and the
 * structural track is not the place to add another.
 */

const IDENTIFIER = /[A-Za-z0-9_$]/;

/** Keywords after which a `/` begins a regex literal rather than a division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

/** Statement heads that make `)` in `if (x) /re/` a regex position. */
const REGEX_PRECEDING_HEADS = new Set(["if", "for", "while", "with"]);

/**
 * All backward scanning works on the masked *character array*, never on a
 * joined string. Joining is O(n) and the lookback runs once per `/` and once
 * per literal, so joining here made a 21k-line module quadratic.
 */
function readIdentifierBackwards(chars, end) {
  let start = end;
  while (start >= 0 && IDENTIFIER.test(chars[start])) start -= 1;
  return { word: chars.slice(start + 1, end + 1).join(""), before: start };
}

function skipSpaceBackwards(chars, from) {
  let index = from;
  while (index >= 0 && /\s/.test(chars[index])) index -= 1;
  return index;
}

/**
 * Decide whether the `/` at `index` opens a regex literal. Ambiguity between
 * regex and division is only resolvable with a full parser, so this uses the
 * standard previous-significant-token heuristic and errs toward regex only when
 * the preceding token cannot end an expression.
 */
function isRegexStart(masked, index) {
  const prev = skipSpaceBackwards(masked, index - 1);
  if (prev < 0) return true;

  const char = masked[prev];
  if (char === ")") {
    // `if (cond) /re/.test(x)` is a regex; `(a + b) / 2` is division.
    let depth = 0;
    let scan = prev;
    while (scan >= 0) {
      if (masked[scan] === ")") depth += 1;
      else if (masked[scan] === "(") {
        depth -= 1;
        if (depth === 0) break;
      }
      scan -= 1;
    }
    const head = readIdentifierBackwards(masked, skipSpaceBackwards(masked, scan - 1));
    return REGEX_PRECEDING_HEADS.has(head.word);
  }
  if (char === "]") return false;
  if (IDENTIFIER.test(char)) {
    const { word } = readIdentifierBackwards(masked, prev);
    return REGEX_PRECEDING_KEYWORDS.has(word);
  }
  // Operators, `(`, `,`, `{`, `;`, `=`, `:` etc. all mean expression position.
  return true;
}

/**
 * Replace comments and regex literals with spaces, and string/template contents
 * with spaces while keeping their delimiters. Returns the masked text plus the
 * literals found, each with the offsets needed to attribute it to an import.
 *
 * Template substitutions are treated as code, so an import nested inside `${}`
 * is still seen and a nested quote does not desynchronise the mask.
 */
export function maskSource(source) {
  const masked = source.split("");
  const literals = [];
  const blank = (from, to) => {
    for (let i = from; i < to && i < masked.length; i += 1) {
      if (masked[i] !== "\n") masked[i] = " ";
    }
  };

  // Stack entries: {type: "template", start, computed} for substitution nesting.
  const templateStack = [];
  let braceDepth = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      let end = source.indexOf("\n", index);
      if (end === -1) end = source.length;
      blank(index, end);
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      let end = source.indexOf("*/", index + 2);
      end = end === -1 ? source.length : end + 2;
      blank(index, end);
      index = end;
      continue;
    }

    if (char === "/" && isRegexStart(masked, index)) {
      let scan = index + 1;
      let inClass = false;
      let closed = false;
      while (scan < source.length) {
        const c = source[scan];
        if (c === "\\") { scan += 2; continue; }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) { closed = true; scan += 1; break; }
        scan += 1;
      }
      if (closed) {
        blank(index, scan);
        index = scan;
        continue;
      }
      // Unterminated on this line — treat the `/` as an operator.
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const start = index;
      let scan = index + 1;
      while (scan < source.length) {
        if (source[scan] === "\\") { scan += 2; continue; }
        if (source[scan] === char || source[scan] === "\n") break;
        scan += 1;
      }
      const raw = source.slice(start + 1, scan);
      blank(start + 1, scan);
      literals.push({ start, contentStart: start + 1, raw, computed: false });
      index = scan + 1;
      continue;
    }

    if (char === "`") {
      templateStack.push({ start: index, computed: false, braceDepth });
      index += 1;
      // Scan the template body, handing control back to the code path on `${`.
      while (index < source.length) {
        const c = source[index];
        if (c === "\\") { blank(index, index + 2); index += 2; continue; }
        if (c === "`") break;
        if (c === "$" && source[index + 1] === "{") {
          templateStack[templateStack.length - 1].computed = true;
          break;
        }
        if (c !== "\n") masked[index] = " ";
        index += 1;
      }
      if (source[index] === "`") {
        const frame = templateStack.pop();
        literals.push({
          start: frame.start,
          contentStart: frame.start + 1,
          raw: source.slice(frame.start + 1, index),
          computed: frame.computed,
        });
        index += 1;
      }
      continue;
    }

    if (char === "{") braceDepth += 1;
    if (char === "}") {
      braceDepth -= 1;
      const frame = templateStack[templateStack.length - 1];
      if (frame && braceDepth === frame.braceDepth) {
        // Closing a `${…}` substitution: resume masking the template body.
        index += 1;
        while (index < source.length) {
          const c = source[index];
          if (c === "\\") { blank(index, index + 2); index += 2; continue; }
          if (c === "`") break;
          if (c === "$" && source[index + 1] === "{") break;
          if (c !== "\n") masked[index] = " ";
          index += 1;
        }
        if (source[index] === "`") {
          const closed = templateStack.pop();
          literals.push({
            start: closed.start,
            contentStart: closed.start + 1,
            raw: source.slice(closed.start + 1, index),
            computed: true,
          });
          index += 1;
        }
        continue;
      }
    }

    index += 1;
  }

  return { masked: masked.join(""), maskedChars: masked, literals };
}

/**
 * Classify a literal by what precedes it. Returns null when the literal is not
 * an import specifier.
 */
function classifyLiteral(masked, literalStart) {
  let index = skipSpaceBackwards(masked, literalStart - 1);
  if (index < 0) return null;

  if (masked[index] === "(") {
    const callee = readIdentifierBackwards(masked, skipSpaceBackwards(masked, index - 1));
    if (callee.word !== "import") return null;
    // Reject `foo.import(...)` and `myimport(...)`.
    const before = masked[callee.before];
    if (before && (IDENTIFIER.test(before) || before === ".")) return null;
    return "dynamic";
  }

  const token = readIdentifierBackwards(masked, index);
  if (token.word === "import") {
    const before = masked[token.before];
    if (before && (IDENTIFIER.test(before) || before === ".")) return null;
    return "side-effect";
  }

  if (token.word !== "from") return null;

  // Walk back over the import/export clause to find which keyword opened it.
  let scan = token.before;
  while (scan >= 0) {
    const char = masked[scan];
    if (char === ";") return null;
    if (IDENTIFIER.test(char)) {
      const word = readIdentifierBackwards(masked, scan);
      if (word.word === "import") return "static";
      if (word.word === "export") return "export-from";
      scan = word.before;
      continue;
    }
    scan -= 1;
  }
  return null;
}

/**
 * Line lookup is precomputed and binary-searched. Counting newlines per literal
 * is O(file × literals), which on the 21k-line composition root is minutes.
 */
function buildLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

export function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * Scan one module's source for import specifiers.
 *
 * @param {string} source
 * @returns {Array<{kind: string, specifier: string|null, raw: string,
 *   line: number, computed: boolean, relative: boolean}>}
 */
export function scanImports(source) {
  const { maskedChars, literals } = maskSource(source);
  const lineStarts = buildLineIndex(source);
  const found = [];

  for (const literal of literals) {
    const kind = classifyLiteral(maskedChars, literal.start);
    if (!kind) continue;
    found.push({
      kind,
      specifier: literal.computed ? null : literal.raw,
      raw: literal.raw,
      line: lineAt(lineStarts, literal.start),
      computed: literal.computed,
      relative: isRelativeSpecifier(literal.raw),
    });
  }

  return found.sort((a, b) => a.line - b.line);
}

/**
 * Resolve a relative specifier against the importing file. Foundry serves
 * scripts as static files and the browser performs no extension search, so the
 * path is resolved exactly as written — never upgraded to an `.mjs` sibling.
 */
export function resolveSpecifier(fromFile, specifier) {
  const bare = specifier.split("?")[0].split("#")[0];
  return path.resolve(path.dirname(fromFile), bare);
}

/**
 * Decide where a resolved relative import lands relative to this module.
 *
 *  - `internal`       — inside the repository. Existence is a blocking gate;
 *                       this is the move risk the structural track is about.
 *  - `sibling-module` — a peer module in Foundry's `modules/` directory, i.e.
 *                       an optional dependency such as TokenMagic. Existence
 *                       depends on the developer's installed modules and must
 *                       never block, but the escape depth is still checked:
 *                       moving the importer deeper reclassifies it as
 *                       `internal` and the existence rule then catches it.
 *  - `escaped`        — above Foundry's modules directory. Always wrong.
 *
 * @param {string} repoRoot absolute path to this module's root
 * @param {string} fromFile absolute path of the importing file
 * @param {string} specifier the relative specifier as written
 */
export function classifyTarget(repoRoot, fromFile, specifier) {
  const resolved = resolveSpecifier(fromFile, specifier);
  const root = path.resolve(repoRoot);
  const modulesDir = path.dirname(root);

  const insideRoot = path.relative(root, resolved);
  if (!insideRoot.startsWith("..") && !path.isAbsolute(insideRoot)) {
    return { scope: "internal", resolved, siblingModule: null };
  }

  const insideModules = path.relative(modulesDir, resolved);
  if (!insideModules.startsWith("..") && !path.isAbsolute(insideModules)) {
    const [siblingModule] = insideModules.split(path.sep);
    return { scope: "sibling-module", resolved, siblingModule };
  }

  return { scope: "escaped", resolved, siblingModule: null };
}
