/**
 * Scanner: template-literal interpolations that land inside an HTML attribute
 * value without being escaped.
 *
 * WHY IT EXISTS. The gate this replaces was a single grep:
 *
 *     src="\$\{[A-Za-z_$][A-Za-z0-9_$]*\.(img|image)\}"
 *
 * It required the interpolation to be exactly `${identifier.img}`. Every one of
 * the ~90 unescaped sites found in #125 fails that shape — they use a local
 * (`${img}`), a fallback (`${doc.img || "icons/svg/mystery-man.svg"}`), or a
 * differently-named property (`${durationEntry.spellImg}`, `${condDef.icon}`).
 * So the scan matched nothing at all and reported the class clean, which is
 * worse than having no gate: it reads as green. A chat card renders on every
 * connected client, so a player who renames a spell to `x" onerror="alert(1)`
 * gets script execution in the GM's session.
 *
 * WHAT IT MATCHES. Any `${...}` inside a quoted value — single or double — of
 * one of ATTRIBUTES or any `data-*`, with optional whitespace around the `=`.
 * Values are read with brace-depth tracking rather than a regex, which is what
 * lets it see `${doc.img || "fallback.svg"}` and nested template literals that a
 * `[^}]*` pattern truncates at the first `}`. A value may span lines.
 *
 * Each of those was a blind spot in the first version, and every one was found
 * by review rather than by the gate: `title = "${…}"` with spaces, a value
 * broken across lines, `data-actor-name="${targetActor.name}"` on a chat card,
 * and three single-quoted attributes. The pattern to notice is that all four
 * were excluded by a rule written as "this tree doesn't do that" — a claim about
 * the codebase, not the language, and one that stops being true silently.
 *
 * WHAT IT DELIBERATELY SKIPS.
 *
 *   1. Expressions already escaped: a call to an escape helper, or a bare local
 *      RESOLVED to a `const x = escapeHTML(…)` declaration in scope. See
 *      isEscaped — the resolution is scope-aware and deliberately not a name
 *      test, because the version that trusted `escaped*` names both accepted
 *      things it should not and reported correct code, and "fixing" the latter
 *      double-escapes.
 *   2. Expressions built only from `game.i18n.localize` / `game.i18n.format`
 *      and string literals. Those are module-owned text from our own lang
 *      files, not user data.
 *
 * Everything else is reported and lands in the baseline. That is deliberate:
 * excluding more shapes by heuristic is how a scanner acquires false NEGATIVES,
 * and a false negative here ships an XSS past a green gate. A noisy baseline is
 * reviewable; a blind spot is not.
 *
 * KNOWN LIMITS, kept short because a long list of them is a sign the design is
 * wrong. Brace depth is counted textually, so an unbalanced brace inside a
 * string literal (`${x || "}"}`) mis-measures where the expression ends; it
 * reports a wrong entry rather than going silent. `style` is not scanned — CSS
 * injection is a different analysis. Escaping is resolved one declaration deep,
 * so `const a = escapeHTML(x); const b = a;` leaves `${b}` reported.
 */

import * as acorn from "acorn";

/**
 * Attributes this tree interpolates user data into.
 *
 * `value` was added after the first pass: #125 counted src/alt/title/
 * data-tooltip, but the hidden inputs that back the summon and item-give
 * profiles store an actor name straight into `value="${profile.creatureName}"`,
 * and a name carrying `">` closes the tag and injects an element. That is 150+
 * sites, so adding it grew the baseline once — a widening is a deliberate,
 * reviewed event, not the drift the "should only ever shrink" note warns about.
 *
 * data-tooltip is no longer listed here because ALL `data-*` are matched by the
 * pattern below — see the note there.
 */
const ATTRIBUTES = ["src", "alt", "title", "value", "href", "placeholder"];

// ANY data-* attribute, not a named few. The first pass listed data-tooltip
// alone; review found `data-actor-name="${targetActor.name}"` on a chat card,
// which is the same breakout and was invisible because the attribute happened
// not to be on the list. Enumerating attribute names is how a gate acquires a
// blind spot shaped like whatever nobody thought of.
//
// Whitespace is allowed around the `=`: `title = "${…}"` is valid HTML and the
// tighter pattern skipped it silently.
const ATTRIBUTE_START = new RegExp(
  `\\b(${ATTRIBUTES.join("|")}|data-[a-z][a-z0-9-]*)\\s*=\\s*(["'])`,
  "g",
);

/** A call to an escape helper: foundry.utils.escapeHTML, esc, escapeAttr, … */
const ESCAPE_CALL = /\besc[A-Za-z]*\s*\(/;

/** Runaway guard for an attribute value that never closes its quote. */
const MAX_VALUE_LENGTH = 4000;

/**
 * Whether an interpolated expression is already escaped.
 *
 * WHY THIS IS NOT A NAME TEST ANY MORE. It used to also accept any identifier
 * matching `escaped[A-Z]`, which trusts a name rather than a fact. Worse, it
 * could not see the OPPOSITE case: this tree overwhelmingly escapes at
 * assignment and interpolates a plain local —
 *
 *   const img = foundry.utils.escapeHTML(actor.img);
 *   …  `<img src="${img}">`                       // correct, but read as raw
 *
 * so every such site was reported, and "fixing" one by wrapping it again
 * double-escapes: a name containing `&` renders as `&amp;amp;`. That happened
 * five times in one pass before review caught it. A scanner whose false
 * positives lead directly to a user-visible bug is not paying for itself.
 *
 * So an identifier is resolved against its DECLARATION, innermost scope first.
 * A `const x = escapeHTML(…)` in scope makes `${x}` escaped; a `const x = raw`
 * shadowing it in an inner scope makes it raw again. Unresolvable identifiers
 * stay reported, which is the safe direction.
 */
function isEscaped(expression, offset, escapedNames) {
  const bare = expression.trim();

  // The WHOLE expression must be the escape call, not merely contain one.
  // `${escapeHTML("") + doc.name}` contains one and is completely unescaped;
  // a substring test accepted it. Parsing is the only honest way to ask
  // "is this expression a call to an escape helper".
  if (ESCAPE_CALL.test(bare)) {
    try {
      const parsed = acorn.parseExpressionAt(bare, 0, { ecmaVersion: 2023 });
      const isWholeCall = parsed.type === "CallExpression"
        && parsed.end === bare.length
        && ESCAPE_CALL.test(`${bare.slice(parsed.callee.start, parsed.callee.end)}(`);
      if (isWholeCall) return true;
    }
    catch {
      // Unparseable on its own (a template fragment, say). Fall through and
      // report, which is the safe direction.
    }
    return false;
  }

  if (!/^[A-Za-z_$][\w$]*$/.test(bare)) return false;
  return escapedNames(offset, bare);
}

/**
 * Resolve, for any offset, whether a name is bound there to an escape call.
 *
 * Scope-aware on purpose. A file-scoped answer would be a FALSE NEGATIVE
 * generator: a name escaped in one function and raw in another would read as
 * escaped everywhere, hiding the raw one. That is the failure this whole gate
 * exists to prevent, so it is not a trade worth making for less code.
 *
 * @returns {(offset: number, name: string) => boolean}
 */
function escapedNameResolver(source) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2023, sourceType: "module" });
  }
  catch {
    // No resolution available. Every bare local then reports, which is noisy
    // but safe — and the gate's own parse failure surfaces elsewhere.
    return () => false;
  }

  // One entry per scope. BLOCKS are scopes too, not just functions: the first
  // version recorded every declaration into the enclosing FUNCTION, so a
  // block-local `const x = escapeHTML(…)` overwrote a raw outer `x` for the
  // whole function and silenced its uses. That is a false negative, which is
  // the direction this gate cannot afford.
  const scopes = [{ start: ast.start, end: ast.end, names: new Map() }];
  const SCOPE_TYPES = new Set([
    "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
    "BlockStatement", "ForStatement", "ForOfStatement", "ForInStatement", "CatchClause",
  ]);

  /** Every binding identifier a parameter pattern introduces — none escaped. */
  const declareParams = (node, scope) => {
    const walkPattern = (pattern) => {
      if (!pattern) return;
      switch (pattern.type) {
        case "Identifier": scope.names.set(pattern.name, false); break;
        case "ObjectPattern":
          for (const property of pattern.properties) {
            walkPattern(property.type === "Property" ? property.value : property);
          }
          break;
        case "ArrayPattern": for (const element of pattern.elements) walkPattern(element); break;
        case "AssignmentPattern": walkPattern(pattern.left); break;
        case "RestElement": walkPattern(pattern.argument); break;
        default: break;
      }
    };
    for (const param of node.params ?? []) walkPattern(param);
  };

  const isEscapeCall = (init) => init?.type === "CallExpression"
    && ESCAPE_CALL.test(`${source.slice(init.callee.start, init.callee.end)}(`);

  const walk = (node, scope) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) walk(child, scope); return; }

    let current = scope;
    if (typeof node.type === "string" && SCOPE_TYPES.has(node.type)) {
      current = { start: node.start, end: node.end, names: new Map() };
      scopes.push(current);
      // A parameter SHADOWS an escaped outer const of the same name, so it has
      // to be recorded as unescaped rather than left absent.
      if (node.params) declareParams(node, current);
    }

    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      current.names.set(node.id.name, isEscapeCall(node.init));
    }

    // ANY later assignment poisons the name for the whole scope:
    // `let x = escapeHTML(a); x = raw;` left x accepted as escaped. This is
    // flow-insensitive on purpose — it can only turn an accept into a report.
    if (node.type === "AssignmentExpression" && node.left?.type === "Identifier") {
      if (!isEscapeCall(node.right)) current.names.set(node.left.name, false);
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      walk(node[key], current);
    }
  };
  walk(ast, scopes[0]);

  return (offset, name) => {
    const containing = scopes
      .filter((scope) => scope.start <= offset && offset < scope.end && scope.names.has(name))
      .sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const innermost = containing[containing.length - 1];
    return innermost ? innermost.names.get(name) : false;
  };
}

/** Module-owned text: i18n lookups and string literals, nothing else. */
function isModuleOwnedText(expression) {
  const withoutStrings = expression.replace(/"[^"]*"|'[^']*'/g, "");
  const withoutI18n = withoutStrings.replace(/game\.i18n\.(localize|format)\s*\(/g, "");
  return !/[A-Za-z_$][A-Za-z0-9_$]*/.test(withoutI18n);
}

/**
 * Read the attribute value starting at `start` (the character after the opening
 * quote), tracking brace depth so a quote inside an interpolation does not end
 * it. Returns the raw value and every interpolation expression inside it.
 */
function readAttributeValue(source, start, quote) {
  const expressions = [];
  let index = start;
  let depth = 0;
  let expressionStart = -1;

  while (index < source.length) {
    const char = source[index];

    if (depth === 0 && char === quote) break;
    // NOTHING inside the value stops the scan early. A newline is legal, and so
    // are `<` and `>` — `title="level > ${doc.name}"` is valid HTML, and bailing
    // on them silently skipped the whole attribute. The only stop is the RUNAWAY
    // guard below: if no closing quote turns up within a sane distance, the
    // value was never terminated (an unbalanced brace inside a string literal
    // does this) and whatever was collected is reported anyway rather than
    // dropped. Going silent is the one behaviour this scanner must not have.
    if (index - start > MAX_VALUE_LENGTH) {
      return expressions.length > 0 ? { value: "", end: index, expressions, unterminated: true } : null;
    }

    if (char === "$" && source[index + 1] === "{") {
      if (depth === 0) expressionStart = index + 2;
      depth += 1;
      index += 2;
      continue;
    }
    if (depth > 0 && char === "{") depth += 1;
    if (depth > 0 && char === "}") {
      depth -= 1;
      if (depth === 0 && expressionStart >= 0) {
        expressions.push(source.slice(expressionStart, index).trim());
        expressionStart = -1;
      }
    }
    index += 1;
  }

  // Ran off the end, or a brace never balanced: report what was found instead of
  // returning nothing. The entry may be wrong; silence would be worse.
  if (index >= source.length || depth !== 0) {
    return expressions.length > 0 ? { value: "", end: index, expressions, unterminated: true } : null;
  }
  return { value: source.slice(start, index), end: index, expressions };
}

/**
 * Find unescaped attribute interpolations in one file's source.
 * @param {string} source
 * @returns {Array<{attr: string, expr: string, line: number}>}
 */
export function scanUnescapedAttrs(source) {
  const findings = [];
  const escapedNames = escapedNameResolver(source);
  ATTRIBUTE_START.lastIndex = 0;

  let match;
  while ((match = ATTRIBUTE_START.exec(source)) !== null) {
    const attr = match[1];
    const parsed = readAttributeValue(source, match.index + match[0].length, match[2]);
    if (!parsed) continue;

    for (const expression of parsed.expressions) {
      // An expression with an odd number of quotes was mis-measured: the brace
      // depth ran through a `}` inside a string literal, so what was captured is
      // a fragment. Report it before any skip can swallow it — the docblock
      // promises a wrong entry rather than silence, and `${"}" + doc.name}`
      // otherwise looks literal-only and is skipped as module-owned text.
      const misMeasured = (expression.split('"').length - 1) % 2 === 1
        || (expression.split("'").length - 1) % 2 === 1;

      if (!misMeasured) {
        if (isEscaped(expression, match.index, escapedNames)) continue;
        if (isModuleOwnedText(expression)) continue;
      }
      findings.push({
        attr,
        expr: expression.replace(/\s+/g, " "),
        line: source.slice(0, match.index).split("\n").length,
      });
    }
    // Resume after the value so a `"` inside it cannot start a phantom match.
    ATTRIBUTE_START.lastIndex = parsed.end;
  }

  return findings;
}

export { ATTRIBUTES };
