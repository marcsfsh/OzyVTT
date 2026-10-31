# ADR-0074: The shared parts, third sweep: buttons and hit areas, rows and their controls, boxes, steps, overlays, type, colour, dates and copy

## Status

Accepted

## Context and decision drivers

ADR-0072 and ADR-0073 brought the side lists, title rows, menus, phone sheets, dialogs, section bars, phone headers,
tabs, toolbars, fields and tags of the 23 approved mockups into line. The owner asked for one last sweep of what neither
covered, checking the theme's rules page by page. It captured every button, row, control in a row, empty state, steps
rail, rolled number, box, GM ONLY tag, colour, display title, width, date and overlay from every page, 4,343 captures
from 127 pages, each measured from its computed style (`docs/design/polish/T-consistency/history/3-sweep.html`). It
found twenty differences:

- Settings drew its groups as full boxes with a fill, the players' table as a box inside one.
- Arrival's Cups carried an arrow.
- On the phones 239 of 301 buttons and Cups were shorter than the 44 px hit area, and nothing grew them.
- Danger was drawn four ways, and two danger actions were grey ghosts.
- The ghost stood in for ordinary secondaries, and Cancel and Back beside a Cup were drawn two ways.
- The roster's names and steps' heads were set in display type.
- The character builder's Steps rail had its own marks and a horizon edge.
- Three phone sheets carried a cyan or amber top edge.
- The phone table's switch sat in a boxed well in four mockups.
- Two switches: the theme's 46 by 26 and a 38 by 22 one without its glow.
- Settings picked several from a list with switches, where the others tick.
- Icon buttons in content without their base line, and a row's More written as a word.
- Menu rows from 40 to 49 px, table rows from 40 to 60 px, phone rows under 44 px.
- Base line buttons at 34, 38 and 40 px.
- A harmful condition amber, a magenta timeline, API methods in cyan and party blue.
- A date and its time written five ways, one in VT323, one lowercase; a phone chip counted with a dot.
- Two empty states gave an instruction with no button.
- "her" and "him" for characters, an ellipsis placeholder, and Save and close for what elsewhere is Done.
- The GM ONLY tag in two sizes, and rule 7 asking for it where no page draws it.
- Settings' column and the Codex's reading measure off rule 11's widths.

The owner asked for all twenty to be fixed, and to see each one before and after first
(`docs/design/polish/T-consistency/history/3-before-after.html`).

## Considered options

- Leave each area as approved.
- Fix the twenty in the approved mockups and specs, and write the recurring ones into the theme spec.

## Decision

1. All twenty are fixed in the approved mockups and their specs (A to I's pieces that draw them). Every mockup draws its
   phone controls at 44 px from one shared stylesheet, `mockup-src/p4t-touch.css`.
2. The theme spec gains rule 20 (dates, times and a chip's count) and amends 2.2 (when a description carries the GM ONLY
   tag), 2.5 (danger, the ghost, hit areas on a phone, icon buttons, switches and ticks), rule 2 (a menu's caret on the
   Cup), rule 7 (where the GM ONLY tag goes and its one size), rule 8 (menu and table rows), rule 9 (a harmful condition
   is red), rule 10 (heads inside a page) and rule 11 (a column beside a side list).
3. The shared parts are built once in the kit and used everywhere, as ADR-0072 set out:
   `docs/design/polish/T-consistency/PLAN.md` adds the third sweep's phases.

## Consequences and tradeoffs

- Phones get taller controls and rows: sheets and menus run longer and scroll sooner, in exchange for every control
  meeting the 44 px floor.
- Menus and tables on a laptop grow to 48 px rows; the longest menus reach the foot of the frame and scroll.
- Danger reads one way, so it is quieter in Settings, where it was boxed in red.
- Settings loses its boxed look and reads like every other area's groups.

## Mobile, security, and visibility impact

- Every control on a phone meets the 44 px hit area, and every phone row 44 px.
- No data, command, projection or route changes. The GM ONLY tag keeps marking what only the GM sees on a surface
  players also see.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- `docs/design/polish/T-consistency/history/3-before-after.html`: each fix before and after, drawn from the approved
  mockups.
- `docs/design/polish/T-consistency/consistency.html`: every shared part as the approved mockups now draw it.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
