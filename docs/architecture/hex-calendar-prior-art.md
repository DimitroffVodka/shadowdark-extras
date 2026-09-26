# Hex travel calendar — prior art review

Research pass before building anything. Question: what does a hex-exploration
clock (time of day, date, day/night, moon phase) need, and how much of it
already exists?

Researched 2026-09-21. Foundry V14 API facts come from the `foundry-api`
mirror, built 2026-08-07 — authoritative for V14 as of that date.

## Short answer

Foundry V14 core already *is* the calendar. `game.time.calendar` is a real
`CalendarData` data model, and `game.time.earthCalendar` is a built-in
Gregorian calendar — which is exactly the "base it on the earth calendar"
starting point. Core gives date, time of day, weekday, month, season and leap
years. It does **not** give moons and it does not tint the scene.

So the gap SDX would actually fill is narrow: **advance world time from hex
travel, and read it back out in the tray.** Everything below that is core;
everything above it (scrubber UI, darkness automation) is covered by a
module that is already verified on 14.

## What core V14 gives for free

`foundry.helpers.GameTime` (`game.time`):

| Member | What it is |
|---|---|
| `worldTime` | world time in seconds (already used across SDX) |
| `components` | current time decomposed — see below |
| `calendar` | in-world `CalendarData` |
| `earthCalendar` | Gregorian `CalendarData` for IRL timekeeping |
| `advance(delta, options)` | delta in seconds **or** components |
| `set(time, options)` | absolute set, seconds or components |
| `initializeCalendar()` | re-init after `CONFIG.time` changes |

`TimeComponents`: `year, month, dayOfMonth, dayOfWeek, day, hour, minute,
second, season, leapYear`.

`foundry.data.CalendarData` methods: `add`, `difference`, `format`,
`timeToComponents`, `componentsToTime`, `componentsToUnit`, `isLeapYear`,
`countLeapYears`, `formatAgo`, `formatDuration`, `formatTimestamp`.
Schema fields: `years`, `months`, `days`, `seasons`.

`CONFIG.time` takes `worldCalendarConfig`, `worldCalendarClass`,
`earthCalendarConfig`, `earthCalendarClass` and `formatters` — so a custom
calendar (a Shadowdark one, later) is a config object, not a module.

**Zero occurrences of "moon" in the V14 `CalendarData` docs.** Core has
seasons, not lunar cycles.

## Module survey

Version and freshness read off foundryvtt.com package pages on 2026-09-21.

| Module | Verified | Last updated | Verdict |
|---|---|---|---|
| [SmallTime](https://github.com/unsoluble/smalltime) | **14** | ~2.5 months | **Alive and the right neighbour.** Time-of-day scrubber, per-scene player visibility, optional link to scene Darkness Level. Its README: date display "uses the core Foundry calendar API". |
| [Phil's Day and Night Cycle](https://foundryvtt.com/packages/phils-day-night-cycle) | **14** | ~2 hours | Actively maintained lighting automation. Covers the day/night tint half. |
| [About Time](https://foundryvtt.com/packages/about-time) | **14** | ~4 months | Event scheduling on world time — "in 3 days, do X". Not a calendar UI. |
| [Simple Calendar **Reborn**](https://github.com/Fireblight-Studios/foundryvtt-simple-calendar) | **14** | ~4.5 months | **The live Simple Calendar.** MIT fork by Arctis Fireblight, module id `foundryvtt-simple-calendar-reborn`, v2.6.1, `compatibility: {minimum: "14", verified: "14"}`. Custom moons with per-phase config, seasons, notes/events, and the original `SimpleCalendar.api` surface. |
| [Seasons & Stars](https://github.com/rayners/fvtt-seasons-and-stars) | 13 | ~9.5 months | Self-described **alpha**, v0.26.0, `compatibility.verified: "13"`. Has moons, calendar packs, a Simple Calendar compat bridge. Not verified on 14 and has not moved in 9 months. |
| [Celestial Calendar](https://foundryvtt.com/packages/celestial-calendar) | 13.348 | ~4.5 months | Moon phases, conjunctions, eclipses, Night Sky journal panel. Takes its dates from Simple Calendar. |
| [Simple Calendar (upstream)](https://github.com/vigoren/foundryvtt-simple-calendar) | 12 | **2y 3m** | Vigoren's original, last release v2.4.18 (May 2024). Superseded by Reborn — don't build against this one. Its 13-only compat bridge is likewise superseded. |
| [Simple Weather](https://foundryvtt.com/packages/simple-weather) | 13.351 | ~7.5 months | Weather generation; needs a calendar underneath. Out of scope for now. |
| TCM Clock, Day Night Cycle, Weather Control | 13 / 11 / 10 | 6 months – 4 years | Stale, ignore. |

So the ecosystem does have one live, v14-verified, moon-capable calendar:
**Simple Calendar Reborn**. It is not installed in this world today.

Its API, the parts that matter here:

```js
SimpleCalendar.api.getAllMoons()        // MoonData[], each with currentPhase
SimpleCalendar.api.getCurrentSeason()
SimpleCalendar.api.currentDateTime()    // and currentDateTimeDisplay()
SimpleCalendar.api.advanceTimeToPreset() // sunrise / midday / sunset / midnight
SimpleCalendar.api.changeDate() / setDate() / secondsToInterval()
```

The catch is its **Game World Time Integration** setting, which decides
whether Reborn or Foundry owns `game.time.worldTime`. Adopting it as a hard
dependency means handing off the clock SDX, the crawl helper and
`CampingRestSD` already write to.

## What is already in this repo and this world

- `scripts/party/CampingRestSD.mjs:748` already calls
  `game.time.advance(REST_DURATION_SECONDS)` behind an `advanceTime`
  checkbox. **The pattern exists; hex travel is the same call with a
  different delta.**
- `scripts/shared/duration-basis.mjs` and the effects stack are built on
  `worldTime` expiry throughout.
- Issue #140 (closed 2026-09-18) moved SDX duration tracking onto *core*
  Active Effect expiry rather than a parallel clock. Same lesson applies
  here: do not run a second clock beside `game.time`.
- `shadowdark-crawl-helper` v1.2.0 (installed, verified 14) also calls
  `game.time.advance` for dungeon crawl rounds — a second writer to the same
  clock. Worth knowing before adding a third.

## The gotcha that decides the design

The **Shadowdark system itself** listens on `updateWorldTime`:

- `LightSourceTracker.onUpdateWorldTime(worldTime, worldDelta)` burns down
  light timers when world time moves (it throttles by an update-interval
  setting, and always updates when time moves backwards).
- The effect panel calls `deleteExpiredEffects()` on the same hook.

So advancing 8 hours of travel does not just change a date readout — it
**consumes every lit torch and expires durations**. That is probably
*correct* for Shadowdark, but it must be a deliberate, visible choice
(confirmation + undo-by-rewind), not a side effect of clicking a hex.

Light sources also tick on a real-time `setInterval` independently, so the
two clocks coexist.

## Recommendation

1. **Use core.** `game.time.advance` / `game.time.components` /
   `game.time.earthCalendar`. No calendar dependency, no data model of our
   own, nothing to migrate later.
2. **Don't build a scrubber or a darkness automation.** SmallTime is
   verified on 14, reads the core calendar, and already links scene
   darkness. Recommend it; don't reimplement it.
3. **Moon phase: formula first, Reborn opportunistically.** On the Earth
   calendar the phase is the synodic month (29.530588853 days) from a known
   new-moon epoch — about ten lines, no dependency, works in this world
   today (Reborn is not installed). Then read through to
   `SimpleCalendar.api.getAllMoons()[0].currentPhase` *when Reborn is
   present*, so a GM who wants custom moons gets them. That is the same
   soft-dependency pattern SDX already uses for
   `game.shadowdarkEnhancer.renown.award`.
4. **Do not hand Reborn the clock.** Its Game World Time Integration setting
   can take ownership of `game.time.worldTime`; SDX, `CampingRestSD` and the
   crawl helper all already write there. Read from Reborn, don't defer to it.
5. **Scope SDX to the part nobody else does:** hex travel spends time.
   Terrain × travel-pace → hours, advance the clock, show date/time/phase in
   the tray, guard the torch consequence.

## Open questions for the build

- Travel cost model: per hex, or per watch? Does terrain modify it?
- Who may advance — GM only, or does solo hex mode advance on token move?
- Does the tray clock replace SmallTime's readout or sit beside it?
- Rewind on undo: do we restore time when a hex move is undone?
- Is Simple Calendar Reborn going to be installed in this world? If yes, the
  moon formula becomes a fallback rather than the primary path.
