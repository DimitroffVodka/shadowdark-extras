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
  if (ESCAPE_CALL.test(expression)) return true;
  const bare = expression.trim();
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

  // One entry per scope: where it spans, and what each name declared in it
  // resolves to.
  const scopes = [{ start: ast.start, end: ast.end, names: new Map() }];
  const SCOPE_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

  const walk = (node, scope) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) walk(child, scope); return; }

    let current = scope;
    if (typeof node.type === "string" && SCOPE_TYPES.has(node.type)) {
      current = { start: node.start, end: node.end, names: new Map() };
      scopes.push(current);
    }

    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      const init = node.init;
      const escaped = init?.type === "CallExpression"
        && ESCAPE_CALL.test(source.slice(init.callee.start, init.callee.end) + "(");
      current.names.set(node.id.name, escaped);
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
    // A value may legally span lines, so a newline is NOT a stop condition — the
    // earlier version bailed on one and silently skipped every multi-line
    // attribute. What does stop it is evidence the quote never closed: a `<`
    // or `>` outside an interpolation means we have run into the next tag.
    if (depth === 0 && (char === "<" || char === ">")) return null;

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

  if (index >= source.length || depth !== 0) return null;
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
      if (isEscaped(expression, match.index, escapedNames)) continue;
      if (isModuleOwnedText(expression)) continue;
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
