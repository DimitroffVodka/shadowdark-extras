/**
 * Parser tests for carousing outcome effect extraction.
 * Run: node dev/tests/carousing-outcome-effects.test.mjs
 *
 * Fixtures are the real 14 rows of the user's "Carousing Outcome" table
 * (Compendium.world.shadowdark-enhancer--roll-tables.RollTable.ze4YNKybtL17Lshb).
 */

// parseOutcomeEffects is pure, but the module is written against Foundry
// globals; stub the few that exist at import time.
globalThis.CONST = { TABLE_RESULT_TYPES: { TEXT: "text", DOCUMENT: "document" }, USER_ROLES: {}, DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 } };

const { parseOutcomeEffects, hasOutcomeEffects } = await import("../../scripts/CarousingSD.mjs");

let pass = 0;
let fail = 0;

function eq(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        pass++;
    } else {
        fail++;
        console.error(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
    }
}

/** Compact accessor: [xp, luck, wealthPercent] for a row. */
function fx(desc, ben) {
    const e = parseOutcomeEffects(desc, ben);
    return [e.xp, e.luck, e.wealthPercent];
}

// ---------------------------------------------------------------------------
// The real table, row by row
// ---------------------------------------------------------------------------
const ROWS = [
    ["You wake up blearily in your bed", "Gain 2 XP", [2, 0, 0]],
    ["You're locked in the stocks for 1d4 days and fined 20% of your total wealth for setting a building on fire", "Gain 2 XP", [2, 0, 20]],
    ["You wake up in a gutter with 15% of your total wealth spent", "Gain 3 XP", [3, 0, 15]],
    ["You hazily remember donating 10% of your total wealth to a glib priest", "Gain 3 XP and a priest ally", [3, 0, 10]],
    ["You're fined 10% of your total wealth for starting a full-tavern brawl", "Gain 3 XP and be barred from a tavern", [3, 0, 10]],
    ["The Thieves' Guild bilked you for 5% of your total wealth", "Gain 4 XP", [4, 0, 5]],
    ["You led an entire tavern in a wildly insulting song about a disliked noble", "Gain 4 XP and a famous bard ally", [4, 0, 0]],
    ["You survived a blindfolded knife- throwing demonstration unscathed", "Gain 4 XP and a luck token", [4, 1, 0]],
    ["By talent (50%) or trickery (50%), you beat a rival crawler in a test of skill", "Gain 5 XP and an NPC ally or enemy", [5, 0, 0]],
    ["An angry wizard cast a deadly spell at you, but you reflected it off your cup", "Gain 5 XP and a luck token", [5, 1, 0]],
    ["You performed a humiliating prank on a despised and corrupt merchant", "Gain 5 XP and an ally in the City Watch", [5, 0, 0]],
    ["You defeated a noble in a highly wagered drinking contest", "Gain 5 XP and a debt owed by the noble", [5, 0, 0]]
];

for (const [desc, ben, expected] of ROWS) {
    eq(`row: ${desc.slice(0, 40)}…`, fx(desc, ben), expected);
}

// The row that matters most: bare percentages that are NOT wealth must not
// trigger a deduction. "(50%) or trickery (50%)" is a skill contest, not money.
eq("bare percentages are not wealth loss",
    parseOutcomeEffects("By talent (50%) or trickery (50%), you beat a rival crawler", "Gain 5 XP").wealthPercent, 0);

// ---------------------------------------------------------------------------
// Wealth direction
// ---------------------------------------------------------------------------
eq("loss verb -> deduction", parseOutcomeEffects("You are fined 10% of your total wealth", "").wealthPercent, 10);
eq("gain verb -> no deduction", parseOutcomeEffects("You recover 10% of your total wealth", "").wealthPercent, 0);
eq("gain verb (won) -> no deduction", parseOutcomeEffects("You won 25% of your total wealth back", "").wealthPercent, 0);
eq("no verb at all -> treated as loss", parseOutcomeEffects("10% of your total wealth, gone", "").wealthPercent, 10);

// A "Gain N XP" in the Benefit column must never be read as the verb governing
// a percentage in the What Happened column — the columns are scanned separately.
eq("benefit 'Gain' does not cancel a description loss",
    parseOutcomeEffects("You are fined 20% of your total wealth", "Gain 2 XP").wealthPercent, 20);

// ---------------------------------------------------------------------------
// Luck token counting
// ---------------------------------------------------------------------------
eq("'a luck token' -> 1", parseOutcomeEffects("", "Gain 4 XP and a luck token").luck, 1);
eq("'one luck token' -> 1", parseOutcomeEffects("", "Gain one luck token").luck, 1);
eq("'2 luck tokens' -> 2", parseOutcomeEffects("", "Gain 2 luck tokens").luck, 2);
eq("no luck mentioned -> 0", parseOutcomeEffects("", "Gain 4 XP").luck, 0);

// ---------------------------------------------------------------------------
// XP forms
// ---------------------------------------------------------------------------
eq("'Gain 4 XP'", parseOutcomeEffects("", "Gain 4 XP").xp, 4);
eq("'+4 XP'", parseOutcomeEffects("", "+4 XP").xp, 4);
eq("'4XP' no space", parseOutcomeEffects("", "4XP").xp, 4);
eq("lowercase xp", parseOutcomeEffects("", "gain 6 xp").xp, 6);
eq("no xp -> 0", parseOutcomeEffects("You wake up in a ditch", "").xp, 0);
eq("'1d4 days' is not XP", parseOutcomeEffects("locked in the stocks for 1d4 days", "").xp, 0);

// ---------------------------------------------------------------------------
// Renown reuses the existing parser, including its "if" guard
// ---------------------------------------------------------------------------
eq("renown parsed", parseOutcomeEffects("", "+1 renown").renown, 1);
eq("negative renown parsed", parseOutcomeEffects("", "-2 renown").renown, -2);
eq("conditional renown stays manual", parseOutcomeEffects("", "-1 renown if anyone sees it").renown, 0);

// ---------------------------------------------------------------------------
// hasOutcomeEffects
// ---------------------------------------------------------------------------
eq("purely narrative row has no mechanical effects",
    hasOutcomeEffects(parseOutcomeEffects("You made a friend", "A priest ally")), false);
eq("xp row has mechanical effects",
    hasOutcomeEffects(parseOutcomeEffects("You made a friend", "Gain 3 XP and a priest ally")), true);
eq("undefined is safe", hasOutcomeEffects(undefined), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
