/**
 * Native Shadowdark renown regression tests.
 * Run: node dev/tests/carousing-native-renown.test.mjs
 */

globalThis.CONST = {
    TABLE_RESULT_TYPES: { TEXT: "text", DOCUMENT: "document" },
    USER_ROLES: {},
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 }
};

const {
    getActorRenown,
    applyRenownDelta,
    migrateLegacyRenown
} = await import("../../scripts/CarousingSD.mjs");

let pass = 0;
let fail = 0;

function eq(label, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        pass++;
    } else {
        fail++;
        console.error(`FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
    }
}

function actorFixture({ native = 0, legacy } = {}) {
    const calls = [];
    const actor = {
        type: "Player",
        system: { renown: native },
        getFlag: (_module, key) => key === "renown" ? legacy : undefined,
        update: async (changes) => {
            calls.push(["update", changes]);
            if (Object.hasOwn(changes, "system.renown")) actor.system.renown = changes["system.renown"];
        },
        unsetFlag: async (module, key) => calls.push(["unsetFlag", module, key])
    };
    return { actor, calls };
}

eq("reads native system renown", getActorRenown(actorFixture({ native: 4, legacy: 9 }).actor), 4);
eq("invalid native renown defaults to zero", getActorRenown({ system: { renown: "bad" } }), 0);

{
    const { actor, calls } = actorFixture({ native: 0, legacy: 7 });
    eq("negative renown delta is applied", await applyRenownDelta(actor, -1), -1);
    eq("delta writes native field only", calls, [["update", { "system.renown": -1 }]]);
}

{
    const { actor, calls } = actorFixture({ native: 0, legacy: 3 });
    eq("legacy value migrates when native is still zero", await migrateLegacyRenown([actor]), 1);
    eq("migration writes native then removes legacy flag", calls, [
        ["update", { "system.renown": 3 }],
        ["unsetFlag", "shadowdark-extras", "renown"]
    ]);
}

{
    const { actor, calls } = actorFixture({ native: 5, legacy: 2 });
    eq("native nonzero value wins migration conflict", await migrateLegacyRenown([actor]), 0);
    eq("conflicting legacy value is removed without overwriting native", calls, [
        ["unsetFlag", "shadowdark-extras", "renown"]
    ]);
}

{
    const nonPlayer = actorFixture({ native: 0, legacy: 4 });
    nonPlayer.actor.type = "NPC";
    eq("migration ignores non-player actors", await migrateLegacyRenown([nonPlayer.actor]), 0);
    eq("non-player actor is untouched", nonPlayer.calls, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
