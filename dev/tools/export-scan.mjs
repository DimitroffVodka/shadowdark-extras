import { maskSource } from "./import-scan.mjs";

/**
 * Static export-name parser for the API-export snapshot gate.
 *
 * Scope note: this reports the names a module exports, not their signatures.
 * The reorganization plan is explicit that a green snapshot proves name
 * stability only — a changed parameter or return shape breaks consumers while
 * this stays green — so the gate is necessary but never sufficient.
 */

const IDENTIFIER_START = /[A-Za-z_$]/;

/** Read a `{ a, b as c }` clause and return the names it exposes. */
function parseExportList(masked, openBrace) {
  const close = masked.indexOf("}", openBrace);
  if (close === -1) return [];

  return masked
    .slice(openBrace + 1, close)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const renamed = part.split(/\s+as\s+/);
      return (renamed.length > 1 ? renamed[1] : renamed[0]).trim();
    })
    .filter((name) => name && IDENTIFIER_START.test(name[0]));
}

/**
 * Read the declarator names of `export const a = 1, b = 2;`. Stops at the
 * statement end so an initialiser containing a comma cannot leak a false name.
 */
function parseDeclarators(masked, start) {
  let depth = 0;
  let end = start;
  while (end < masked.length) {
    const char = masked[end];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === ";" && depth === 0) break;
    else if (char === "\n" && depth === 0) {
      // A declaration continues only while an initialiser is open; a bare
      // newline at depth 0 after a complete declarator ends the statement.
      const rest = masked.slice(start, end).trim();
      if (rest.length > 0 && !rest.endsWith(",") && !rest.endsWith("=")) break;
    }
    end += 1;
  }

  const names = [];
  let depthInSlice = 0;
  let current = "";
  for (const char of masked.slice(start, end)) {
    if ("([{".includes(char)) depthInSlice += 1;
    else if (")]}".includes(char)) depthInSlice -= 1;
    if (char === "," && depthInSlice === 0) {
      names.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  names.push(current);

  return names
    .map((part) => part.trim().split(/[=\s]/)[0].trim())
    .filter((name) => name && IDENTIFIER_START.test(name[0]));
}

/**
 * @param {string} source
 * @returns {{names: string[], starExports: string[]}}
 */
export function scanExports(source) {
  const { masked, literals } = maskSource(source);
  const literalsByStart = new Map(literals.map((literal) => [literal.start, literal]));
  const names = new Set();
  const starExports = [];

  for (const match of masked.matchAll(/(?:^|[^\w$.])export\s+/g)) {
    const start = match.index + match[0].length;
    const rest = masked.slice(start, start + 200);

    const fn = rest.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/);
    if (fn) { names.add(fn[1]); continue; }

    const cls = rest.match(/^class\s+([A-Za-z_$][\w$]*)/);
    if (cls) { names.add(cls[1]); continue; }

    const variable = rest.match(/^(?:const|let|var)\s+/);
    if (variable) {
      for (const name of parseDeclarators(masked, start + variable[0].length)) names.add(name);
      continue;
    }

    if (/^default\b/.test(rest)) { names.add("default"); continue; }

    if (rest.startsWith("{")) {
      for (const name of parseExportList(masked, start)) names.add(name);
      continue;
    }

    const starAs = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (starAs) { names.add(starAs[1]); continue; }

    if (rest.startsWith("*")) {
      // `export * from "./x"` — the forwarded names cannot be enumerated here.
      const fromQuote = masked.indexOf("from", start);
      const literal = [...literalsByStart.values()].find((entry) => entry.start > fromQuote);
      starExports.push(literal ? literal.raw : "<unknown>");
    }
  }

  return { names: [...names].sort(), starExports };
}
