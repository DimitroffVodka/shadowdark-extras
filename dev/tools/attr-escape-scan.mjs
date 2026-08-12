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
 * WHAT IT MATCHES. Any `${...}` inside a double-quoted value of one of
 * ATTRIBUTES, found by scanning with brace depth rather than by regex. Depth
 * tracking is what lets it see `${doc.img || "fallback.svg"}` and nested
 * template literals, which a `[^}]*` pattern truncates at the first `}`.
 *
 * WHAT IT DELIBERATELY SKIPS.
 *
 *   1. Expressions that mention escapeHTML/escapeHtml, or an `escaped*`
 *      identifier. The repo's convention is to escape at assignment
 *      (`const escapedName = foundry.utils.escapeHTML(actor.name)`) and
 *      interpolate the local, so matching the call alone would flag every
 *      correctly-fixed site. This trusts a NAME: `const escapedFoo = doc.name`
 *      defeats it. That is the same trade every scanner in this directory
 *      makes, and it is worth stating rather than pretending otherwise.
 *   2. Expressions built only from `game.i18n.localize` / `game.i18n.format`
 *      and string literals. Those are module-owned text from our own lang
 *      files, not user data.
 *
 * Everything else is reported and lands in the baseline. That is deliberate:
 * excluding more shapes by heuristic is how a scanner acquires false NEGATIVES,
 * and a false negative here ships an XSS past a green gate. A noisy baseline is
 * reviewable; a blind spot is not.
 *
 * KNOWN LIMITS. Brace depth is counted without a JS parser, so an unbalanced
 * brace inside a string literal (`${x || "}"}`) mis-measures the expression's
 * end. Single-quoted attribute values are not scanned — this tree writes HTML
 * attributes with double quotes, and adding a second delimiter without evidence
 * of use would widen the surface for no gain. Both are visible as a wrong or
 * missing entry in the baseline diff rather than as silence.
 */

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
 * NOT covered, and worth stating rather than leaving implied: `style` (this tree
 * builds it from module constants, and a CSS-injection gate is a different
 * analysis) and arbitrary `data-*` beyond data-tooltip (overwhelmingly document
 * ids). Both are residual surface. If user data starts reaching either, this
 * list is where to extend.
 */
const ATTRIBUTES = ["src", "alt", "title", "data-tooltip", "value", "href", "placeholder"];

const ATTRIBUTE_START = new RegExp(`\\b(${ATTRIBUTES.join("|")})="`, "g");

/**
 * Escaping is recognised three ways, because this tree spells it three ways:
 * `foundry.utils.escapeHTML(...)`, a local helper (`esc(...)`, `escapeAttr(...)`,
 * `escapeAttribute(...)` — several files define their own), and the
 * `const escapedName = …` convention that feeds a bare local into the markup.
 *
 * Missing the local-helper spelling made the first baseline report ~16 already-
 * escaped sites as findings. False positives are the cheaper failure here, but
 * they are not free: a gate that cries wolf gets its baseline regenerated
 * unread, which is how the real findings get lost.
 */
const ESCAPED = /\besc[A-Za-z]*\s*\(|\bescaped[A-Z_]/;

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
function readAttributeValue(source, start) {
  const expressions = [];
  let index = start;
  let depth = 0;
  let expressionStart = -1;

  while (index < source.length) {
    const char = source[index];

    if (depth === 0 && char === '"') break;
    // A newline at depth 0 means the quote was never closed on this line: this
    // is not an attribute we can reason about, so give up rather than run on.
    if (depth === 0 && char === "\n") return null;

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
  ATTRIBUTE_START.lastIndex = 0;

  let match;
  while ((match = ATTRIBUTE_START.exec(source)) !== null) {
    const attr = match[1];
    const parsed = readAttributeValue(source, match.index + match[0].length);
    if (!parsed) continue;

    for (const expression of parsed.expressions) {
      if (ESCAPED.test(expression)) continue;
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
