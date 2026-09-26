# Carousing

[← Wiki home](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Home)

Carousing is a shared downtime workflow with two rule modes, editable data,
player-ready result cards, copper-precise costs, and a persistent GM log.

---

> **Carousing button or overlay missing?** It's [**Feature Manager → SDX Tray Tools → Carousing**](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Feature-Manager#sdx-tray-tools).

## Open it

The beer icon on the SDX Tray. It appears whenever **Enable Carousing** is on.

The GM assembles and runs the session. Players review and confirm the characters
they own, according to whichever workflow is active.

![The shared Carousing overlay with participant cards, tier controls, and the GM-managed roster](https://raw.githubusercontent.com/wiki/DimitroffVodka/shadowdark-extras/images/carousing-overlay.webp)

## Choose a mode

**Configure Settings → Shadowdark Extras → Carousing Mode**

| Mode | Model |
|---|---|
| **Original** | Tier/cost and a direct outcome/benefit table |
| **Expanded** | Spending tier, d8-style outcome, d100 benefit/mishap tables, modifiers, XP |

Switching modes changes both the overlay and which editor **Manage Carousing
Tables** opens.

## Typical session

1. Open the Carousing overlay.
2. Add or select the participating characters.
3. Review carried coins and, where it matters, total valued wealth.
4. Choose the available tier or drop and confirm participants.
5. Roll the session.
6. Review each result.
7. In Original mode, hit the GM-only **Apply** button for mechanical outcomes.
8. Open the Carousing Log when you want the persistent record.
9. Reset once the session is done.

The overlay tells you whether the percentage-loss base is **coins only** or
**coins + gear**.

## Money math

Every calculation happens in copper, whatever the display says.

The conversion is `1 gp = 10 sp = 100 cp`, so 5% of 41 gp comes out at 2 gp 5 cp
where a floored calculation would have said 2 gp. Deduction spends the
denominations you actually carry without silently re-minting the whole purse.
That precision matters, because Shadowdark encumbrance counts coin quantity.

### Wealth base

**Carousing Wealth Base** controls percentage losses:

| Choice | Percentage is based on | Payment comes from |
|---|---|---|
| **Coins only** | GP + SP + CP carried | Coins |
| **Coins + gear** | Coins plus recorded gear value | Coins first |

Gear with no recorded value contributes zero. When a gear-based loss exceeds the
character's coins, SDX creates or increases a zero-slot **Carousing Debt** item
carrying the exact unpaid amount and its history.

## Settlements, holidays and the two-week rule

**Settlement.** The GM controls have a **Settlement** choice: village, town,
city, city-state or none. It starts as the settlement on the party token's hex
(the scene you are viewing, else the active scene), and you can change it;
**From the party's hex** goes back to the map. Tiers that cost more than the
settlement's limit are disabled, and the limit is shown beside the choice. The limits come from Shadowdark
Enhancer's rules data when it has them (its Rules data import reads them from
your own GM Guide), and otherwise from the four **Configure Settings → Shadowdark
Extras → Carousing Limit** fields. Those start empty, and an empty limit means no
limit, so type in the values from your book to use them.

**Holidays.** With Shadowdark Enhancer, a holiday that falls today
in the party's settlement shows on the overlay, and its rules apply when you
roll: the event-roll bonus in both modes, and, in Expanded mode, the benefit
bonus, benefit advantage and extra benefit or mishap roll. Its 1-in-N chances
are rolled for each character. Each card gets the holiday's garb questions;
tick the ones that are true for that character. A required garb left unticked
keeps that character out, so the holiday doesn't apply to them. Enhancer only
knows the holidays once you import them (Importer Hub → Tools → Chapter to
journal → *Cursed Scroll 6: the City of Masks holidays*); until then the
overlay says so.

**Downtime.** Carousing won't open or roll while a Shadowdark Enhancer downtime
session is open.

**Once every two weeks.** When you roll, SDX checks the Carousing Log. If a
character caroused less than 14 real days ago, it names them and asks whether to
go ahead. Sessions logged before this check existed aren't counted.

## Applying Original-mode outcomes

Original results can carry XP, Luck, a percentage wealth loss, a Renown change,
and narrative consequences.

The result card's GM-only **Apply** button shows an exact preview and asks for
confirmation before it commits anything. Application is idempotent, so a second
click grants nothing twice, and the card picks up an **Applied** badge.

Narrative rewards like allies, enemies, debts, or bans have no safe universal
Shadowdark field to live in. SDX appends the full outcome to the character's
Notes rather than guessing at mechanics.

Expanded mode applies its numeric XP through its own roll path and leaves the
Original Apply button out of it. Its player-visible benefit and mishap text also
gets appended to Notes once, together with the applied XP and Renown summary.

## Carousing Log

The GM-only log is a Journal holding one stable page per session. Each entry
records the participant and their roll, the outcome, benefits and mishaps, the
exact mechanical result applied, and the Expanded XP/Renown summary where that
applies.

Pages are located by flags, so renaming the Journal won't orphan the log.
Reopening and backfilling are idempotent and shouldn't duplicate the
character-note entry.

## Editing tables

Open **Manage Carousing Tables**. The editor follows whichever mode is active.

Imports accept labeled prose and pipe-separated columns:

```text
30 gp | A worthy night of drinking and festivity | +0
```

What the columns mean depends on the section. An event tier reads roll, cost,
description, bonus. Original outcomes are shorter, just roll, description, and
benefit. Expanded outcomes are the wide ones, running roll, mishaps, benefits,
d100 modifier, and XP, while a benefit/mishap row needs nothing beyond a roll
and a description.

The RollTable result range can supply the roll column, so you can leave it out.
Review the imported editor data before saving either way.

Link only a structurally compatible RollTable. Two tables both containing prose
does not make an Original outcome table into an Expanded one.

## Visibility

The GM can show or hide benefit and mishap descriptions from players
independently. Those controls cover both the player-facing chat and the
automatic Expanded-mode entry written to character Notes, so a hidden outcome
stays hidden on the sheet too. The GM-only Carousing Log keeps the complete
result. Costs and required player decisions stay visible whenever the workflow
needs them.

---

## When it misbehaves

Most of the strange behavior here traces back to an old build. A Reset that
clears nothing and a removed participant reappearing were both fixed in current
releases, which use Foundry's deletion operator correctly and persist key
deletion explicitly, clearing session and drop flags while the GM-managed roster
survives. Same story for an Expanded roll where every row comes back 0 XP:
current editors warn about a mismatched linked table and keep your configured
values, instead of overlaying an all-zero parse. Update before digging any
deeper. The one deliberate exception is a participant still holding an unapplied
result, who stays reachable until you handle it.

Two more look like bugs and are working as intended. An Original-mode outcome
that moved coins without touching XP or Luck is waiting on the GM-only
**Apply** button and its confirmation preview. A percentage cost that disagrees
with your whole-GP arithmetic is copper-precise, which is the entire point of
the money math above.

---

**Related:** [Character Sheets](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Character-Sheets) ·
[Settings Reference](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Settings-Reference) ·
[Compendium Packs](https://github.com/DimitroffVodka/shadowdark-extras/wiki/Compendium-Packs)
