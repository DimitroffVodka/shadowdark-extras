import { maskSource } from "./import-scan.mjs";
import { buildLineIndex, lineAt, literalArgument, literalIndex } from "./call-scan.mjs";

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

/**
 * @param {string} source
 * @returns {Array<{api: string, name: string|null, line: number, dynamic: boolean}>}
 */
export function scanRegistrations(source) {
  const { masked, maskedChars, literals } = maskSource(source);
  const literalsByStart = literalIndex(literals);
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
