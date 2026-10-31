# ADR-0062: The map's menus: A's menu at every thing on the map, how it moves at the top of the token's menu, and each tool's options as a menu from the tool

## Status

Accepted

## Context and decision drivers

C2 of the polish pass (`docs/design/polish/C2-map-menus/`), inside the table's frame (ADR-0050) and after C3 (ADR-0058,
ADR-0059) and C4 and C6 (ADR-0061). Running the branch at `f5e166f` with a fight on the old road showed:

- A token's menu was a tall popover that scrolled: how it moves, height, an amount with Damage and Heal, damage type,
  size, health, conditions, the stat block, the image, hiding, the reaction and the tray. C3 had since put hit points,
  conditions and position under the creature's row.
- A door's menu, Place here on the empty map and a drawing's editor were each their own box; the drawing's editor took
  the tool options' column.
- Each tool's options were a column beside the rail, inside the map's edge, and on a phone a block under the tools row
  that pushed the map down.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/C2-map-menus/history/`, each built only from settled parts.

## Considered options

- A token's menu: A's menu at the token (today's place), Its row in the dock, A card by the token, A sheet over the
  panel, The Token tab.
- How it moves: In the token's menu (today's), In the Move tab, While dragging, A chip on the token, In its row.
- A door: A's menu (today's), Roll rows, By what it does, In the turn, A card by the door.
- A tool's options: Beside the tools (today's), In the dock, A strip over the map, A sheet over the panel, A menu from
  the tool.
- A drawing: Where the options are (today's), A card by the drawing, A Drawing tab, A strip over the map, A's menu at
  the drawing.

## Decision

1. A token, a door, the empty map and a drawing open as A's menu at the thing; on a phone, from the foot of the
   Switch's view.
2. The token's menu keeps how it moves at its top, then height, the token and the creature; hit points and conditions
   point to the creature's row.
3. A door's ways are A's menu's rows.
4. Each tool's options are A's menu from the tool's own button; the tool stays on after the menu closes.
5. A drawing's colour, audience and Remove are A's menu at the drawing.
6. Six rules, listed in `docs/design/polish/C2-map-menus/SPEC.md` section 3, starting with one way to open what is on
   the map.

## Consequences and tradeoffs

- The map keeps its full width while a tool is on; a tool's controls are a press away instead of always shown.
- The token's menu is shorter, with nothing that C3's row already holds.
- Every map menu shares one placement and one look, so the next thing added to the map has a place to go.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; a long press opens what the other button opens; on a phone menus rise from the
  foot with the thing left in view.
- No data, command, projection or route changes. Who may open which menu, and what each row does, stays the server's.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/C2-map-menus/map-menus.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
