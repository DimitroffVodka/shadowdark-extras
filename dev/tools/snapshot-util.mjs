/**
 * Shared serialisation helpers for the snapshot gates.
 *
 * Key order is part of a snapshot's contract: these files are diffed by
 * reviewers and by CI, so an unstable order would produce noise that trains
 * people to regenerate baselines without reading them. Each snapshot tool used
 * to carry its own copy of this, which is exactly how two gates drift apart.
 */

/** Return a shallow copy of `object` with its keys in stable sorted order. */
export function sortKeys(object) {
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
}
