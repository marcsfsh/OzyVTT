# ADR-0069: Replays: a table with the replay beside it, the whole fight beside the map, a line of rounds, Launch at the transport, and cards under a player's sheet

## Status

Accepted

## Context and decision drivers

E's fourth round of the polish pass (`docs/design/polish/E3-replays/`), inside Prep's frame (ADR-0053), after the sound
board (ADR-0065). Running the branch at `f5e166f` with a fight of eight turns and eight earlier ones showed:

- The list was rows: the name, a line of turns and length, an eye, Watch and More (Rename, Download JSON, Delete
  replay).
- The viewer put the transport above the map, Turn order and During this turn beside it, and Launch from here with
  Download JSON in its header.
- Renaming was a small dialog from the list's More.
- A player's shared replays were a list under the sheet when no encounter ran.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/E3-replays/history/`, each built only from settled parts. The owner put two
options together for the list (A table, and A replay beside the list), asked to see the mix drawn in the next round, and
asked that a replay's name have when it was fought to its right.

## Considered options

- The list: Today's rows, A card per replay, Who sees it at the side, A table, A replay beside the list.
- Watching: Today's map and side, As the table, The map on glass, The whole fight beside, Map above and the rest under.
- Moving through the turns: Today's buttons and slider, The Playing bar, The order is the ladder, A line of rounds,
  Rounds and turns as chips.
- The GM's actions: Today's buttons, A's menu at More, The title row, In the side column, Launch at the transport.
- A player's replays: Today's shelf, Cards under the sheet, In the Log tab, In the frame's menu, The last fight.

## Decision

1. The list is a table with the chosen replay beside it: its map, who fought, Players see it and Watch.
2. Watching puts every turn of the fight beside the map, the current one lit, the order on glass over the map.
3. Moving through the turns is a line of rounds with a tick a turn and marks for damage, healing and a creature going
   down.
4. Launch from turn {n} sits at the end of that line; Players see it, Rename, Download JSON and Delete replay are in
   More. The name has when it was fought to its right.
5. A player finds the shared replays as cards under the sheet.
6. Six rules, listed in `docs/design/polish/E3-replays/SPEC.md` section 3.

## Consequences and tradeoffs

- The whole fight beside the map replaces today's two panes (Turn order, This turn); the order moves onto the map as
  chips.
- The line's marks are read from each turn's log and states on the client, from what each viewer already receives.
- The list reads the chosen replay's document to draw its map and who fought.

## Mobile, security, and visibility impact

- On a phone the list is the table and a row opens the replay's page; the viewer stacks; menus rise from the foot.
- No data, command, projection or route changes. A player still receives only the player projection, and never the
  encounter's own name.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/E3-replays/replays.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
