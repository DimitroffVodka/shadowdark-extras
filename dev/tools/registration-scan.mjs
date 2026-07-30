import { maskSource } from "./import-scan.mjs";

/**
 * Static call-site inventory of the registrations whose ORDER is a
 * compatibility contract: Foundry hooks, libWrapper wrappers, and socketlib
 * handlers.
 *
 * This reuses the import scanner's masking so a `Hooks.on` written in a comment
 * or quoted in a help string never reaches the snapshot.
 *
 * Deliberately NOT included: `game.settings.register`. Settings keys are a
 * rename invariant checked elsewhere, they outnumber every other registration
 * in the tree, and their order is not observable the way hook order is.
 */

const IDENTIFIER = /[A-Za-z0-9_$]/;

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

/**
 * Collect the offsets at which each top-level argument of a call begins.
 * Operates on masked text, so nested parens inside strings cannot unbalance it.
 */
function argumentOffsets(chars, openParen) {
  const offsets = [];
  let depth = 0;
  let expectArgument = true;

  for (let i = openParen; i < chars.length; i += 1) {
    const char = chars[i];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      if (depth === 1) expectArgument = true;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1 && char === ",") {
      expectArgument = true;
      continue;
    }
    if (depth >= 1 && expectArgument && !/\s/.test(char)) {
      if (depth === 1) offsets.push(i);
      expectArgument = false;
    }
  }

  return offsets;
}

/**
 * Read the nth argument as a string literal, or report it as dynamic.
 */
function literalArgument(chars, literalsByStart, openParen, position) {
  const offsets = argumentOffsets(chars, openParen);
  const offset = offsets[position];
  if (offset === undefined) return { name: null, dynamic: true };
  const literal = literalsByStart.get(offset);
  if (!literal || literal.computed) return { name: null, dynamic: true };
  return { name: literal.raw, dynamic: false };
}

/**
 * @param {string} source
 * @returns {Array<{api: string, name: string|null, line: number, dynamic: boolean}>}
 */
export function scanRegistrations(source) {
  const { masked, maskedChars, literals } = maskSource(source);
  const literalsByStart = new Map(literals.map((literal) => [literal.start, literal]));
  const lineStarts = buildLineIndex(source);
  const found = [];

  const record = (api, openParen, position) => {
    const { name, dynamic } = literalArgument(maskedChars, literalsByStart, openParen, position);
    found.push({ api, name, dynamic, line: lineAt(lineStarts, openParen) });
  };

  for (const match of masked.matchAll(/\bHooks\s*\.\s*(on|once|off)\s*\(/g)) {
    record(`Hooks.${match[1]}`, match.index + match[0].length - 1, 0);
  }

  for (const match of masked.matchAll(/\blibWrapper\s*\.\s*register\s*\(/g)) {
    // (moduleId, target, fn, type) — the target is the identity that matters.
    record("libWrapper.register", match.index + match[0].length - 1, 1);
  }

  /**
   * Socket receivers are derived, not assumed: each `x = …registerModule(…)`
   * names a socket instance, and there are three distinct ones in the tree.
   */
  const socketReceivers = new Set();
  for (const match of masked.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*?\bregisterModule\s*\(/g)) {
    socketReceivers.add(match[1]);
  }
  for (const match of masked.matchAll(/\bregisterModule\s*\(/g)) {
    record("socketlib.registerModule", match.index + match[0].length - 1, 0);
  }

  for (const match of masked.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\.\s*register\s*\(/g)) {
    const receiver = match[1];
    if (receiver === "libWrapper") continue;
    if (!socketReceivers.has(receiver) && !/socket/i.test(receiver)) continue;
    record("socket.register", match.index + match[0].length - 1, 0);
  }

  return found.sort((a, b) => a.line - b.line);
}
