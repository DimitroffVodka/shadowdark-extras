/**
 * Shared helpers for finding call sites and reading their literal arguments
 * out of masked source. Used by the registration snapshot and the settings-key
 * snapshot, which ask the same structural question of different APIs.
 *
 * Everything here operates on the output of `maskSource`, so a call written
 * inside a comment or quoted in a help string is never seen.
 */

export function buildLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

export function lineAt(lineStarts, offset) {
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
 *
 * @param {string[]} chars masked character array
 * @param {number} openParen index of the call's `(`
 */
export function argumentOffsets(chars, openParen) {
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
 * Read the nth argument of a call as a string literal, or report it as dynamic.
 *
 * @returns {{name: string|null, dynamic: boolean}}
 */
export function literalArgument(chars, literalsByStart, openParen, position) {
  const offsets = argumentOffsets(chars, openParen);
  const offset = offsets[position];
  if (offset === undefined) return { name: null, dynamic: true };
  const literal = literalsByStart.get(offset);
  if (!literal || literal.computed) return { name: null, dynamic: true };
  return { name: literal.raw, dynamic: false };
}

export function literalIndex(literals) {
  return new Map(literals.map((literal) => [literal.start, literal]));
}
