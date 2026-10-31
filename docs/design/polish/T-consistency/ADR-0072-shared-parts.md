# ADR-0072: The shared parts: one side list, the crumb on the title's line, a menu that names its thing, and one way a phone sheet opens

## Status

Accepted

## Context and decision drivers

The polish pass designed each area in its own round, inside the theme (ADR-0048) and the frame (ADR-0049). By the end of
I's second round (ADR-0071) 23 approved mockups drew the same parts in more than one way. A sweep captured every side
list, title row, menu, phone sheet and dialog from the approved mockups and laid them side by side
(`docs/design/polish/T-consistency/history/1-sweep.html`). It found seven differences:

- Settings and F's time and tools still drew Settings' side list with tall two-line rows.
- The Downtime tab's characters had no faces where every other side list's rows have an icon.
- Four title rows put their crumb on its own line above the title; the others put it before the title on its line.
- Four menus about one thing opened with a small eyebrow or with nothing; the map's menus open with the thing's name.
- Phone sheets opened three ways: a handle and no close, a title and close with no handle, or neither.
- The Atlas's side list put a count in its eyebrow.
- The Atlas tree's rows had no icon and showed a word where other lists show a number.

The owner asked for all seven to be fixed.

## Considered options

- Leave each area as approved, and let each build session match what it finds.
- Fix the seven in the approved mockups and specs, and write the four that recur as theme rules.

## Decision

1. All seven are fixed in the approved mockups and their specs (C3's running round, C5, D, E2, E3's replays, F's time
   and tools, F3, G, G's pages, H, I and I's leftovers).
2. Four become rules in the theme spec (rules 13 to 16): one side list; a crumb sits on the title's line; a menu about
   one thing names it; a phone sheet opens one way.
3. The shared parts are built once in the kit (`packages/ui`) and used everywhere: a side list, a title row's crumb, a
   menu's head and a sheet's head with its handle. `docs/design/polish/T-consistency/PLAN.md` is the work.

## Consequences and tradeoffs

- Every side list, title row, menu and phone sheet reads one way, so a new surface has one way to draw each.
- A menu about one thing grows by its head. The encounter's options' first group is renamed How it runs, since the head
  now names the encounter.
- A party member's sheet loses its Close at the foot for the close at its head.
- The Atlas tree no longer says what each map is on its row; the map's line says it.

## Mobile, security, and visibility impact

- On a phone every sheet has the handle, the title and a 44 px close; side lists keep 48 px rows.
- No data, command, projection or route changes.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- `docs/design/polish/T-consistency/consistency.html`: every shared part as the approved mockups now draw it.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
