/**
 * Carousing Log normalization tests.
 * Run: node dev/tests/carousing-log.test.mjs
 */

globalThis.CONST = {
    TABLE_RESULT_TYPES: { TEXT: "text", DOCUMENT: "document" },
    USER_ROLES: {},
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 }
};

const { buildExpandedCarousingNote, normalizeCarousingLogResults } = await import("../../scripts/CarousingSD.mjs");

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

const names = id => ({ "actor-a": "Aran", "actor-b": "Willow" }[id] || "?");

eq("original results are normalized", normalizeCarousingLogResults({
    results: {
        "actor-a": {
            roll: 7,
            description: "You made a noble friend",
            benefit: "Gain 4 XP",
            applied: { summary: "+4 XP", actorName: "Aran" }
        }
    }
}, names), [{
    name: "Aran",
    roll: 7,
    outcome: "You made a noble friend",
    benefits: ["Gain 4 XP"],
    mishaps: [],
    applied: "+4 XP",
    appliedState: "applied"
}]);

eq("expanded results include benefits and mishaps", normalizeCarousingLogResults({
    results: {
        "actor-b": {
            outcomeRoll: 3,
            xp: 3,
            benefits: [{ description: "A bard praises you; +1 renown", renownDelta: 1 }],
            mishaps: [{ description: "You lose your boots", renownDelta: 0 }]
        }
    }
}, names), [{
    name: "Willow",
    roll: 3,
    outcome: "3 XP",
    benefits: ["A bard praises you; +1 renown"],
    mishaps: ["You lose your boots"],
    applied: "",
    appliedState: "automatic"
}]);

eq("narrative-only applied results remain applied", normalizeCarousingLogResults({
    results: {
        "actor-a": {
            roll: 2,
            description: "A noble owes you a favor",
            benefit: "",
            applied: { summary: "", actorName: "Aran" }
        }
    }
}, names), [{
    name: "Aran",
    roll: 2,
    outcome: "A noble owes you a favor",
    benefits: [],
    mishaps: [],
    applied: "",
    appliedState: "applied"
}]);

eq("missing result collections are safe", normalizeCarousingLogResults({ results: {} }, names), []);

eq("expanded notes preserve all narrative outcomes", buildExpandedCarousingNote({
    xp: 3,
    benefits: [{ description: "A bard praises you; +1 renown", renownDelta: 1 }],
    mishaps: [{ description: "You lose your boots", renownDelta: 0 }]
}), {
    description: "Benefits: A bard praises you; +1 renown — Mishaps: You lose your boots",
    summary: "+3 XP, +1 renown"
});

eq("expanded notes still record uneventful XP", buildExpandedCarousingNote({
    xp: 1,
    benefits: [],
    mishaps: []
}), {
    description: "No visible benefits or mishaps",
    summary: "+1 XP"
});

eq("expanded notes omit outcomes hidden from players", buildExpandedCarousingNote({
    xp: 3,
    benefits: [{ description: "A bard praises you; +1 renown", renownDelta: 1 }],
    mishaps: [{ description: "You lose your boots", renownDelta: 0 }]
}, {
    showBenefits: true,
    showMishaps: false,
    labels: {
        benefits: "Benefits",
        mishaps: "Mishaps",
        noVisibleOutcomes: "No visible outcomes"
    }
}), {
    description: "Benefits: A bard praises you; +1 renown",
    summary: "+3 XP, +1 renown"
});

eq("expanded notes disclose no hidden descriptions", buildExpandedCarousingNote({
    xp: 2,
    benefits: [{ description: "Secret benefit", renownDelta: 0 }],
    mishaps: [{ description: "Secret mishap", renownDelta: 0 }]
}, {
    showBenefits: false,
    showMishaps: false,
    labels: { noVisibleOutcomes: "No visible outcomes" }
}), {
    description: "No visible outcomes",
    summary: "+2 XP"
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
