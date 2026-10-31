# ADR-0050: The table's frame: two docks, a ladder of turns, cost tabs and a switch on phones

## Status

Accepted

## Context and decision drivers

Area C of the polish pass (`docs/design/polish/C-table/`) is the table, where the encounter is run and played. It is
the largest area, so it is designed as one frame first and its groups after. Running the branch at `f5e166f` through a
fight on the Old road showed:

- A strip across the top of the map held the round, the turn order as portrait tiles, the encounter picker, an
  Encounter menu and a Me button. The tools ran down the map's left edge, the staging tray pushed the map down, and a
  392 px panel sat at the right.
- The turn order had no hit points or conditions, so the GM looked elsewhere to see who was hurt.
- A turn showed YOUR TURN in Bungee, four boxed economy plates and every option as a boxed row with its own Cast
  button on a laptop, or favourite tiles on a phone; the acting name in the GM's card was in Bungee too.
- A phone stacked the strip, the turn order, the tools, the tray, the map and the panel in one long column, so the map
  scrolled away to reach End turn.

The owner chose from one round of mockups with four options for each question, kept in
`docs/design/polish/C-table/history/`.

## Considered options

- Laptop workbench: Bench (today, tidied), Float (the map full screen with glass over it), Two docks (the order and
  tools in a left dock, the panel at the right), Stage (the map over a deck of order, turn and log).
- Turn order: Tiles, Faces, Ladder (rows with hit points and conditions), Ticker (one line of names).
- The turn: Card (one list grouped by cost), Cost tabs (the economy as tabs), Favourites (large tiles), Hotbar
  (numbered slots over the map).
- Phone table: Stack, Map and sheet, Switch (one view at a time), Split.

## Decision

1. The laptop table is Two docks: a 232 px left dock with the turn order and the tools, the map with nothing over it
   but its own things, and a 380 px panel at the right. The strip over the map goes.
2. The turn order is a Ladder: a row for each combatant with its face, name, initiative, hit points by role and
   conditions; the acting row carries the ink.
3. A turn is taken through Cost tabs: Action, Bonus Action, Reaction and Move as tabs, the chosen one listing its
   options as rows, one design for the player and the GM.
4. A phone's table is a Switch: Map, Turn, Log and Party one at a time under the header, the turn order on top and End
   turn pinned.
5. Eight rules for the table, listed in `docs/design/polish/C-table/SPEC.md` section 3.

## Consequences and tradeoffs

- The map loses the strip's 64 px of height and gains nothing over it; the left dock takes 232 px of width the rail
  and strip used to share.
- The GM reads who is hurt and what afflicts them in the order without opening a row.
- Cost tabs show the shortest lists, and an option is one more tap away than on today's phone card. Favourites stay,
  listed first in their tab with a star; the large favourite tiles go.
- A phone shows the map and the turn one at a time; End turn is in reach from both.
- The encounter picker, Me, the Encounter menu, Now Playing and Join leave the strip for the top bar, the map and the
  panel.
- The turn order leaves the top of the map, which `docs/DESIGN.md` named as part of "familiar first" and ADR-0025 (the
  docked workbench) set; this record changes both. The panel stays docked at the right.
- Cost tabs are the turn's one view switch under the panel's tabs, so they are drawn as a segmented control (the Base
  line), and the horizon ink stays the panel's.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; option rows are at least 48 px.
- No data, command or projection changes. A player still sees a foe's health band (Healthy, Bloodied, Down), never its
  hit points.

## Migration / reversibility

- Client and docs only. A remembered panel tab keeps working; reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/C-table/table.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, before and during a
  fight, plus the full checks and the smoke suite.
