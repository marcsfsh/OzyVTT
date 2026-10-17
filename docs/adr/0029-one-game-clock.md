# ADR-0029: One game clock for rests and the Codex calendar

## Status

Accepted, 2026-10-17.

## Context and decision drivers

The table had two clocks that never met. The game state kept `rest.clockHours`, whole hours since the campaign
began, which the 16-hour rule between Long Rests reads and which a party rest or Pass time moves; the GM's Rest
dialog showed it as "Day 1, 00:00". The Codex calendar kept the GM's date (`calendar_json.currentDate`, a day with
no hour) and the date published to players. A first-time GM saw "Day 3, 14:00" in one place and "Hammer 4, 1491 DR"
in another, and a Long Rest that passed eight hours across midnight left the calendar where it was.

The drivers: one date for the GM wherever it shows; a rest at the table moves the calendar; the 16-hour rule keeps
working in a campaign with no calendar date; and the stores stay independent (ADR-0006 and `docs/ARCHITECTURE.md`:
a change to one never bumps another's revision).

## Considered options

1. **The Codex holds the whole clock.** Add an hour to the Codex date and make the 16-hour rule read the Codex. The
   rule runs inside a game command's transaction over `GameState`, so every rest would read and write a second
   store, and a campaign with no calendar date would have no clock for the rule.
2. **The game holds the whole clock and the Codex date is derived from it.** One stored number, with the Codex date
   computed from an anchor. Every Codex read of "now" (records dated now, deadlines, the calendar view) would need
   the game state, and a game command would change Codex answers without a Codex revision, so cached Codex reads
   and their ETags would go stale.
3. **The game keeps the hour and the Codex keeps the day, joined by one bridge.** Time that passes in a game command
   moves the Codex date by the midnights it crossed.

## Decision

Option 3. The table's one clock reads the Codex calendar's date (the GM's date) and the game clock's hour
(`rest.clockHours % 24`). `rest.clockHours` stays the elapsed-time counter the 16-hour rule reads, and it is never
shown as a day count.

- `rest.party` (a Long Rest), `rest.finish` (a Short Rest that gives its benefits) and `time.pass` note the clock
  before and after their change. When it moved, the command calls the context's `onTimePassed`, and the server
  moves the Codex date by the number of midnights crossed (`codexStore.advanceCampaignDate`), then pings
  `codex:changed`. The bridge is best-effort, like the combat-history bridge: the rest has already committed.
- The players' published date moves with the GM's date only when the two were the same day. The party lived through
  that time at the table; a GM who is running ahead keeps the gap until they publish.
- With no calendar date set, nothing in the Codex moves. The Rest dialog shows the hour and offers Set the date,
  which opens the Codex calendar.
- The GM's Rest dialog reads the calendar over the Codex API, and the Codex calendar shows the game's hour beside
  the GM's date.

Setting the date by hand in the Codex is a correction of the calendar, not time passing: it does not move
`rest.clockHours`.

## Consequences and tradeoffs

- One date for the GM, one hour, and a rest moves both. The day count ("Day 3") is gone from the UI.
- A Long Rest approved for one character from Needs you does not pass time; the dialog says to pass the 8 hours
  from Rest. Passing time for one character alone would move the clock for the whole table.
- Rewinding the game to an earlier turn does not move the Codex date back. Rests can't happen for combatants
  mid-fight, so the case is a GM passing time during a fight and then rewinding past it.
- Moving the Codex date by hand leaves the 16-hour rule where it was; the GM passes time from Rest when the party
  rests through it.

## Mobile, security, and visibility impact

No projection changes. `rest.clockHours` stays out of the player projection, and the GM's date is GM-only as before.
The published date is already a player field; it now also moves when a rest at the table crosses midnight and the
party was on the GM's date. The dialog's date and Set the date work at 390px with touch.

## Migration / reversibility

No data migration: the existing hour and the existing Codex date combine as they stand. Reverting removes the
bridge and the dialog's calendar read; both clocks keep their values.

## Validation evidence

- `apps/server/test/game-clock.test.ts`: midnights crossed by Pass time and a Long Rest move the Codex date, across
  a month's end; the players' date moves only when it matched; a Codex with no date is left alone.
- `apps/client/src/rest/rest.test.tsx`: the dialog shows "Deepwinter 3, 1491 DR · 14:00", and the hour with Set
  the date when there is no date.
- `apps/client/src/codex/calendar-view.test.tsx`: the Codex calendar shows the game hour beside the GM's date.
