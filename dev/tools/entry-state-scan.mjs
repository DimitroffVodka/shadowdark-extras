import { maskSource } from "./import-scan.mjs";
import { buildLineIndex, lineAt } from "./call-scan.mjs";

/**
 * Module-scope state scanner for the composition root.
 *
 * Phase 3 extracts registration groups out of a 21k-line file. The hazard is
 * not the code volume, it is shared module-scope state: two registration groups
 * that read as independent may both mutate the same Set, and moving one into
 * its own module quietly gives it a second, separate Set. Nothing throws; the
 * feature just stops seeing the other half of its data.
 *
 * MUTABILITY IS JUDGED PER VARIABLE, NOT PER KEYWORD. `const` freezes the
 * binding, not the value — a `const` holding a Set, Map, array or object literal
 * is mutable state and constrains extraction exactly as a `let` does. Treating
 * all 33 consts as immutable would make the inventory worse than useless,
 * because it would look reassuring.
 */

const MUTABLE_SHAPES = new Set(["Set", "Map", "WeakSet", "WeakMap", "Array", "Object"]);

/** Classify an initialiser by its first meaningful token. */
function shapeOf(initialiser) {
  const text = initialiser.trim();
  if (!text) return "uninitialised";
  const constructed = text.match(/^new\s+([A-Za-z_$][\w$]*)/);
  if (constructed) return constructed[1];
  if (text.startsWith("[")) return "Array";
  if (text.startsWith("{")) return "Object";
  if (/^(?:async\s+)?(?:function\b|\()/.test(text) || /^[A-Za-z_$][\w$]*\s*=>/.test(text)) return "function";
  if (/^["'`]/.test(text)) return "string";
  if (/^(?:true|false)\b/.test(text)) return "boolean";
  if (/^-?\d/.test(text)) return "number";
  if (/^null\b/.test(text)) return "null";
  if (/^undefined\b/.test(text)) return "undefined";
  return "expression";
}

/**
 * @param {string} source
 * @returns {Array<{name: string, kind: string, line: number, shape: string,
 *   mutable: boolean, exported: boolean}>}
 */
export function scanTopLevelState(source) {
  const { masked, maskedChars } = maskSource(source);
  const lineStarts = buildLineIndex(source);
  const found = [];

  let depth = 0;
  for (let i = 0; i < maskedChars.length; i += 1) {
    const char = maskedChars[i];
    if (char === "{" || char === "(" || char === "[") { depth += 1; continue; }
    if (char === "}" || char === ")" || char === "]") { depth -= 1; continue; }
    if (depth !== 0) continue;

    const rest = masked.slice(i, i + 12);
    const declaration = rest.match(/^(const|let|var)\s/);
    if (!declaration) continue;
    // Reject a match inside an identifier, e.g. `myconst x`.
    const before = maskedChars[i - 1];
    if (before && /[\w$.]/.test(before)) continue;

    const kind = declaration[1];
    const exported = /\bexport\s+$/.test(masked.slice(Math.max(0, i - 10), i));
    const line = lineAt(lineStarts, i);

    // Read the declarator list to the end of the statement, at depth 0 only.
    let end = i + declaration[0].length;
    let innerDepth = 0;
    while (end < maskedChars.length) {
      const c = maskedChars[end];
      if ("{([".includes(c)) innerDepth += 1;
      else if ("})]".includes(c)) innerDepth -= 1;
      else if (c === ";" && innerDepth === 0) break;
      else if (c === "\n" && innerDepth === 0) {
        const so_far = masked.slice(i + declaration[0].length, end).trim();
        if (so_far && !/[=,+\-*/&|?:([{]$/.test(so_far)) break;
      }
      end += 1;
    }

    // Split declarators on top-level commas, using the REAL source for the
    // initialiser text so masked-out string contents do not confuse the shape.
    const body = source.slice(i + declaration[0].length, end);
    const maskedBody = masked.slice(i + declaration[0].length, end);
    let partDepth = 0;
    let start = 0;
    const parts = [];
    for (let j = 0; j < maskedBody.length; j += 1) {
      const c = maskedBody[j];
      if ("{([".includes(c)) partDepth += 1;
      else if ("})]".includes(c)) partDepth -= 1;
      else if (c === "," && partDepth === 0) { parts.push(body.slice(start, j)); start = j + 1; }
    }
    parts.push(body.slice(start));

    for (const part of parts) {
      const declarator = part.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:=([\s\S]*))?$/);
      if (!declarator) continue;
      const shape = shapeOf(declarator[2] ?? "");
      found.push({
        name: declarator[1],
        kind,
        line,
        shape,
        mutable: kind !== "const" || MUTABLE_SHAPES.has(shape),
        exported,
      });
    }

    i = end;
  }

  return found;
}
