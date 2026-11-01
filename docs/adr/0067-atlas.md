# ADR-0067: The Atlas: maps at the side, pins at the right, a pin's page and menu, tabs in the editor, and the Downtime tab's characters at the side

## Status

Accepted

## Context and decision drivers

F's fourth round of the polish pass (`docs/design/polish/F3-atlas/`), inside the Codex's frame (ADR-0054), with the
Downtime tab that ADR-0066 placed on the story. Running the branch at `f5e166f` with a regional map, five pins and a
battle map inside it showed:

- The map at the left under a bar of layers and Set party position, and a panel at the right with the map's name and
  Pins, Maps inside and Details as tabs.
- A pin chosen turned the panel into the pin; Edit pin turned it into a long form.
- Moving between maps used the Maps inside tab and the Sits inside field.
- Pins had no menu of their own; the map had Add a pin here on a right-click.
- Downtime was a card in the Chronicle's side column.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/F3-atlas/history/`, each built only from settled parts. The owner put two
options together (Maps at the side, and Pins, the map and the pin), asked for a right-click menu on pins, and asked to
see the mix drawn in the next round. Seeing it, the owner asked that a pin's page also set the party's position and hide
the pin from players.

## Considered options

- The Atlas: Today's map and panel, The map on glass, Maps at the side, Pins the map and the pin, The map alone.
- A pin: Today's panel, A card at the pin, The page beside the map, A's menu at the pin, A drawer from the foot.
- Editing a pin: Today's panel, At the pin, A's dialog, In the side column, Tabs in the editor.
- Moving between maps: Today's Maps inside tab, Crumbs on glass, A tree at the side, Maps stacked, Zoom into it.
- The Downtime tab: One table, A card per character, Every entry as a row, Characters at the side, On the calendar.

## Decision

1. The Atlas is three columns: the maps as a tree with the layers at the left, the map, and the pins at the right.
2. A pin, chosen in the list or on the map, opens as its page in the right column with All pins, and The party's
   position and Players see it as switches; a right-click on a pin opens its own menu with the same actions.
3. Editing a pin keeps the right column, with Look, Links, Encounters and Who sees it as tabs.
4. The tree is how you move between maps; Add a map uses E2's map picker.
5. The Downtime tab puts the characters and the deadlines at the side, the chosen character's downtime at the right.
6. Seven rules, listed in `docs/design/polish/F3-atlas/SPEC.md` section 3.

## Consequences and tradeoffs

- The map is narrower than today's (670 px of 1280), in exchange for the maps and the pins always in view.
- One right column holds the pins, a pin and the editor in turn, so only one of them shows at once.
- The pin's menu and its page's two switches are new on the client; they call today's routes (the party pin flag and the
  pin's reveal).

## Mobile, security, and visibility impact

- On a phone the maps become chips, the pins and a pin sheets from the foot, the editor full screen.
- No data, command, projection or route changes. Players see only what they see today.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/F3-atlas/the-atlas.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
