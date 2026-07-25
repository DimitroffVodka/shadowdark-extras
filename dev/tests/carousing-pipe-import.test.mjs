/**
 * Parser tests for pipe-delimited carousing RollTable imports.
 * Run: node dev/tests/carousing-pipe-import.test.mjs
 *
 * The fixtures are the real results from the user's world compendium tables
 * "Carousing Event" (21TfYfPBpmAQ5Jw9) and "Carousing Outcome" (ze4YNKybtL17Lshb).
 */

// The parsers touch only CONST.TABLE_RESULT_TYPES from the Foundry globals.
globalThis.CONST = { TABLE_RESULT_TYPES: { TEXT: "text", DOCUMENT: "document" } };

const {
    tableResultsToEventTiers,
    tableResultsToOriginalOutcomes,
    tableResultsToExpandedOutcomes,
    tableResultsToDescriptionRows,
    splitPipeFields,
    parsePipeTierLine,
    parsePipeOutcomeLine,
    parsePipeExpandedOutcomeLine,
    parsePipeDescriptionLine
} = await import("../../scripts/CarousingFoundryImport.mjs");

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

/** Build a stand-in RollTable whose results carry `name` text, like the real ones. */
function fakeTable(names) {
    return {
        results: names.map((name, i) => ({
            type: "text", name, description: "", range: [i + 1, i + 1]
        }))
    };
}

// ---------------------------------------------------------------------------
// splitPipeFields
// ---------------------------------------------------------------------------
eq("no pipe -> null", splitPipeFields("30 gp A night out +0"), null);
eq("basic split", splitPipeFields("a | b | c"), ["a", "b", "c"]);
eq("edge pipes trimmed", splitPipeFields("| a | b |"), ["a", "b"]);
eq("interior blank kept", splitPipeFields("a |  | c"), ["a", "", "c"]);
eq("whitespace collapsed", splitPipeFields("a  b |   c\nd"), ["a b", "c d"]);
eq("all blank -> null", splitPipeFields("|  |"), null);

// ---------------------------------------------------------------------------
// Carousing Event (real fixture) -> tiers
// ---------------------------------------------------------------------------
const EVENT_TABLE = fakeTable([
    "30 gp | A worthy night of drinking and festivity | +0",
    "100 gp | A full day and night of revelry, gambling, and recounting your exploits | +1",
    "300 gp | Two days of crawling dozens of taverns to sing, buy rounds, and celebrate | +2",
    "600 gp | A three-day voyage into the finest food, drink, and gambling you can find | +3",
    "900 gp | A hazy, weeklong bender that runs multiple well-known taverns dry | +4",
    "1,200 gp | A spirited fete lasting ten days that attracts hordes of revelers and takes over an entire town or a city district | +5",
    "1,800 gp | Two legendary weeks of drinking and debauchery widespread enough to take over a whole city. It attracts countless celebrants, including famous nobles and bards; the streets run red with wine | +6"
]);

const tiers = tableResultsToEventTiers(EVENT_TABLE);
eq("event: costs", tiers.map(t => t.cost), [30, 100, 300, 600, 900, 1200, 1800]);
eq("event: bonuses", tiers.map(t => t.bonus), [0, 1, 2, 3, 4, 5, 6]);
eq("event: row 1 description", tiers[0].description, "A worthy night of drinking and festivity");
eq("event: no leftover pipes", tiers.some(t => t.description.includes("|")), false);
eq("event: no cost/bonus text left in description",
    tiers.some(t => /gp$/.test(t.description) || /^\d/.test(t.description)), false);

// ---------------------------------------------------------------------------
// Carousing Outcome (real fixture) -> Original outcomes
// ---------------------------------------------------------------------------
const OUTCOME_TABLE = fakeTable([
    "You wake up blearily in your bed | Gain 2 XP",
    "You're locked in the stocks for 1d4 days and fined 20% of your total wealth for setting a building on fire | Gain 2 XP",
    "You wake up in a gutter with 15% of your total wealth spent | Gain 3 XP",
    "You hazily remember donating 10% of your total wealth to a glib priest | Gain 3 XP and a priest ally",
    "You're fined 10% of your total wealth for starting a full-tavern brawl | Gain 3 XP and be barred from a tavern",
    "The Thieves' Guild bilked you for 5% of your total wealth | Gain 4 XP",
    "You led an entire tavern in a wildly insulting song about a disliked noble | Gain 4 XP and a famous bard ally",
    "You survived a blindfolded knife- throwing demonstration unscathed | Gain 4 XP and a luck token",
    "By talent (50%) or trickery (50%), you beat a rival crawler in a test of skill | Gain 5 XP and an NPC ally or enemy",
    "An angry wizard cast a deadly spell at you, but you reflected it off your cup | Gain 5 XP and a luck token",
    "You performed a humiliating prank on a despised and corrupt merchant | Gain 5 XP and an ally in the City Watch",
    "You defeated a noble in a highly wagered drinking contest | Gain 5 XP and a debt owed by the noble"
]);

const outcomes = tableResultsToOriginalOutcomes(OUTCOME_TABLE);
eq("outcome: rolls come from ranges",
    outcomes.map(o => o.roll), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
eq("outcome: row 1 description", outcomes[0].description, "You wake up blearily in your bed");
eq("outcome: row 1 benefit", outcomes[0].benefit, "Gain 2 XP");
eq("outcome: row 4 benefit", outcomes[3].benefit, "Gain 3 XP and a priest ally");
eq("outcome: every benefit populated", outcomes.every(o => o.benefit.startsWith("Gain")), true);
eq("outcome: no leftover pipes",
    outcomes.some(o => o.description.includes("|") || o.benefit.includes("|")), false);

// ---------------------------------------------------------------------------
// Regression: the pre-existing labeled formats must still parse
// ---------------------------------------------------------------------------
const LABELED_EVENT = fakeTable(["Cost 300 gp, Event Two days of tavern crawling, Bonus +2"]);
eq("labeled event still works", tableResultsToEventTiers(LABELED_EVENT)[0],
    { cost: 300, bonus: 2, description: "Two days of tavern crawling" });

const LABELED_OUTCOME = fakeTable(["Outcome You wake up in a gutter, Benefit Gain 3 XP"]);
eq("labeled outcome still works", tableResultsToOriginalOutcomes(LABELED_OUTCOME)[0],
    { roll: "1", description: "You wake up in a gutter", benefit: "Gain 3 XP" });

const PLAIN_OUTCOME = fakeTable(["You wake up somewhere odd"]);
eq("plain outcome still works", tableResultsToOriginalOutcomes(PLAIN_OUTCOME)[0],
    { roll: "1", description: "You wake up somewhere odd", benefit: "" });

const LABELED_EXPANDED = fakeTable(["Mishap 2, Benefit -, d100 Modifier -20, XP 2"]);
eq("labeled expanded still works", tableResultsToExpandedOutcomes(LABELED_EXPANDED)[0],
    { roll: 1, mishaps: 2, benefits: 0, modifier: -20, xp: 2 });

// ---------------------------------------------------------------------------
// Optional leading roll column
// ---------------------------------------------------------------------------
eq("event with roll column",
    tableResultsToEventTiers(fakeTable(["1 | 30 gp | A worthy night | +0"]))[0],
    { cost: 30, bonus: 0, description: "A worthy night" });

eq("outcome with roll column",
    tableResultsToOriginalOutcomes(fakeTable(["7 | You sang a song | Gain 4 XP"]))[0],
    { roll: "7", description: "You sang a song", benefit: "Gain 4 XP" });

eq("expanded with roll column",
    tableResultsToExpandedOutcomes(fakeTable(["25+ | - | 3 | +25 | 10"]))[0],
    { roll: 25, mishaps: 0, benefits: 3, modifier: 25, xp: 10 });

eq("expanded without roll column uses range",
    tableResultsToExpandedOutcomes(fakeTable(["2 | - | -20 | 2"]))[0],
    { roll: 1, mishaps: 2, benefits: 0, modifier: -20, xp: 2 });

eq("description rows with roll column",
    tableResultsToDescriptionRows(fakeTable(["01 | You learned a random rumor"]))[0],
    { roll: 1, description: "You learned a random rumor" });

eq("description rows without pipe keep range roll",
    tableResultsToDescriptionRows(fakeTable(["You learned a random rumor"]))[0],
    { roll: 1, description: "You learned a random rumor" });

// ---------------------------------------------------------------------------
// Degenerate / partial columns must never eat the description
// ---------------------------------------------------------------------------
eq("tier: description only", parsePipeTierLine("| A worthy night |"),
    { cost: 0, bonus: 0, description: "A worthy night" });
eq("tier: cost + description", parsePipeTierLine("30 gp | A worthy night"),
    { cost: 30, bonus: 0, description: "A worthy night" });
eq("tier: description + bonus", parsePipeTierLine("A worthy night | +2"),
    { cost: 0, bonus: 2, description: "A worthy night" });
eq("tier: numeric-looking description survives", parsePipeTierLine("30 gp | 100 | +1"),
    { cost: 30, bonus: 1, description: "100" });
eq("tier: no pipe -> null", parsePipeTierLine("30 gp A worthy night +0"), null);

// ---------------------------------------------------------------------------
// Pasted-text line parsers (roll falls back to position)
// ---------------------------------------------------------------------------
eq("paste outcome: leading roll claimed at 2 columns",
    parsePipeOutcomeLine("3 | You wake up in a gutter", 99),
    { roll: "3", description: "You wake up in a gutter", benefit: "" });
eq("paste outcome: no roll column -> fallback",
    parsePipeOutcomeLine("You wake up in a gutter | Gain 3 XP", 5),
    { roll: "5", description: "You wake up in a gutter", benefit: "Gain 3 XP" });
eq("paste outcome: full three columns",
    parsePipeOutcomeLine("3 | You wake up in a gutter | Gain 3 XP", 99),
    { roll: "3", description: "You wake up in a gutter", benefit: "Gain 3 XP" });
eq("paste expanded: four columns -> fallback roll",
    parsePipeExpandedOutcomeLine("2 | - | -20 | 2", 4),
    { roll: 4, mishaps: 2, benefits: 0, modifier: -20, xp: 2 });
eq("paste description: piped, no roll column -> fallback",
    parsePipeDescriptionLine("| You learned a random rumor", 7),
    { roll: 7, description: "You learned a random rumor" });
eq("paste description: roll column claimed",
    parsePipeDescriptionLine("01 | You learned a random rumor", 7),
    { roll: 1, description: "You learned a random rumor" });
eq("paste description: no pipe -> null",
    parsePipeDescriptionLine("01 You learned a random rumor", 7), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
