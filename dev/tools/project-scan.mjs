import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared file-tree helpers for the structural-track gates (import resolver,
 * string-path guard, registration snapshot, API-export snapshot). Keeping the
 * walk in one place means all four gates agree on what "the shipped tree" is.
 */

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Vendored trees. The reorganization plan forbids mechanical changes under the
 * MapHub generator tree, so it is scanned for resolution (a broken vendor import
 * is still a broken page) but excluded from guards that assert SDX authoring
 * conventions.
 */
export const VENDOR_PREFIXES = ["scripts/maphub/", "libs/", "greensock/"];

/** Directories that never contain shipped or gated source. */
const SKIP_DIRS = new Set(["node_modules", ".git", "packs", "backups"]);

export function toRepoPath(absolute) {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

export function isVendor(repoPath) {
  return VENDOR_PREFIXES.some((prefix) => repoPath.startsWith(prefix));
}

/**
 * List JavaScript modules under the given repo-relative roots.
 *
 * @param {string[]} roots repo-relative directories, or absolute paths (which
 *   is how the gates are proved against a fixture tree)
 * @param {{includeVendor?: boolean}} [options]
 * @returns {string[]} absolute paths, sorted for stable snapshot output
 */
export function listJsFiles(roots, { includeVendor = true } = {}) {
  const found = [];

  const walk = (absolute) => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(child);
        continue;
      }
      if (!/\.(mjs|js)$/.test(entry.name)) continue;
      const repoPath = toRepoPath(child);
      if (!includeVendor && isVendor(repoPath)) continue;
      found.push(child);
    }
  };

  for (const root of roots) {
    // resolve, not join: an absolute root must win rather than be appended.
    const absolute = path.resolve(REPO_ROOT, root);
    try {
      if (statSync(absolute).isDirectory()) walk(absolute);
      else found.push(absolute);
    } catch {
      // A configured root that does not exist is not an error: the tools are
      // committed before some of the target directories are created.
    }
  }

  return [...new Set(found)].sort();
}
