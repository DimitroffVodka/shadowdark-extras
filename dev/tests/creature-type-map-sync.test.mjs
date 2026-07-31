import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleRoot = new URL("../../", import.meta.url);

/**
 * `dev/regen-creature-type-map.mjs` builds the keys of the generated
 * `CREATURE_TYPE_MAP`, and `scripts/npc/CreatureTypesApp.mjs` looks names up in
 * it at runtime. Both normalise a monster name first, and each has its own copy
 * of that normalisation, coupled only by a "must match" comment.
 *
 * If the runtime copy changes and the generator's does not, the next
 * regeneration produces keys the runtime can no longer resolve — every affected
 * creature silently loses its type. Nothing else in the repo would notice: the
 * generated file is still valid, both modules still parse, and every structural
 * gate stays green.
 *
 * Neither side can be imported here to compare behaviour directly: the
 * generator runs its work on import, and CreatureTypesApp throws
 * `foundry is not defined` outside a browser. So this compares the two
 * implementations at source level, the same way item-piles-compat.test.mjs
 * inspects WeaponAnimationSD.
 *
 * The real fix is to extract the normaliser into a Foundry-free module both can
 * import. That is a runtime change and belongs to the NPC modernization review,
 * not to a move-only commit — so until then, this test is the coupling.
 */

/** Pull the transformation chain out of `String(<param> ?? "")....trim()`. */
function normalisationChain(source, label) {
  const match = source.match(/String\(\s*\w+\s*\?\?\s*""\)((?:\s*\.\s*\w+\([^)]*\))+)/);
  assert.ok(match, `could not find a String(x ?? "") normalisation chain in ${label}`);
  // Parameter names and formatting are free to differ; the operations are not.
  return match[1].replace(/\s+/g, "");
}

test("the generator and the runtime normalise monster names identically", () => {
  const generator = readFileSync(new URL("dev/regen-creature-type-map.mjs", moduleRoot), "utf8");
  const runtime = readFileSync(new URL("scripts/npc/CreatureTypesApp.mjs", moduleRoot), "utf8");

  const generatorChain = normalisationChain(generator, "dev/regen-creature-type-map.mjs");
  const runtimeChain = normalisationChain(runtime, "scripts/npc/CreatureTypesApp.mjs");

  assert.equal(
    generatorChain,
    runtimeChain,
    "monster-name normalisation has diverged. The generator would emit keys the runtime cannot look up, " +
      "silently dropping creature types. Update both copies, or extract a shared normaliser.",
  );
});

/**
 * The generator writes into the shipped tree through a constructed path that no
 * gate can follow. Phase 2 step 24 moved its output from the repo-root `data/`
 * directory into `scripts/npc/`; if that line ever drifts back, regeneration
 * recreates the old layout and the real file goes stale with every gate green.
 */
test("the generator writes to the moved creature-type map, not the old location", () => {
  const generator = readFileSync(new URL("dev/regen-creature-type-map.mjs", moduleRoot), "utf8");

  const out = generator.match(/const OUT = path\.join\(([^;]*)\);/);
  assert.ok(out, "could not find the generator's OUT path");

  const segments = out[1].match(/"[^"]*"/g) ?? [];
  assert.deepEqual(
    segments,
    ['".."', '"scripts"', '"npc"', '"creature-type-map.mjs"'],
    "the generator's output path no longer points at scripts/npc/creature-type-map.mjs",
  );
});
