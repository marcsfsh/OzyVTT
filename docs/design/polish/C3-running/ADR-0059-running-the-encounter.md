# ADR-0059: Running the encounter: one form to start, tools under the row, a menu on the tabs, the Compendium's panes for monsters, and the roll as the button

## Status

Accepted

## Context and decision drivers

The second of C3's two rounds in the polish pass (`docs/design/polish/C3-running/`), inside the table's frame (ADR-0050)
and after C3's first round (ADR-0058). Running the branch at `f5e166f` on the old road showed:

- Starting a fight listed everyone twice: In this encounter as ticks, then the staging box listing the same creatures
  again under the same heading, before Who plays, Initiative, Surprised and the difficulty.
- A creature's tools were in two places that overlapped: a popover from its row in the panel's Turn order and tools,
  and the Token tab.
- The Encounter menu hung from the strip over the map, which the table's frame removes.
- Add monsters was its own dialog of rows, apart from the Compendium where the same monsters are browsed.
- A waiting save or death save carried boxed buttons around a result line.

The owner asked that sub-areas keep to the settled design so the app reads as one, and chose from one round of mockups
kept in `docs/design/polish/C3-running/history/`, with four options for each question (three for the last), each
built only from settled parts.

## Considered options

- Starting: One form (today's, once), Ready lines, In the order, Who is in it.
- A creature's tools: In the Token tab, Under its row, Beside the order, Hit points in place.
- The encounter's options: A menu on the tabs, On the live chip, A sheet over the panel, At the end of Encounter.
- Adding monsters: The dialog (today's), The Compendium's panes, In the panel, The Compendium itself.
- The prompts' controls: Today's controls, The roll is the button, One button with the rest folded.

## Decision

1. Starting an encounter is one form of Cradles: In this encounter once (with the map line and Add monsters), Who plays,
   Initiative, Surprised, the difficulty, and the not ready lines in Prep's words, over Start the encounter.
2. A creature's tools open under its row in the order, which widens while a row is open; the Token tab keeps the token's
   own controls.
3. The encounter's options are a menu from a More button at the end of the panel's tabs, in Settings' words.
4. Adding monsters is a dialog laid out as the Compendium's browse: filters with counts, results, and the one stat block
   with Add to the encounter as its Cup.
5. In a waiting card, a roll is the button (theme rule 5).

## Consequences and tradeoffs

- The left dock is 330 px while a row is open, so the map narrows for that time; the rest of the time the dock is 232 px.
- Damage, healing and conditions move out of the Token tab; a GM who opens a token reaches them by its row, which opens
  with it.
- The monsters' dialog reuses the Compendium's filter panel and stat block, so the two read the same and change
  together.
- The roll row changes how every waiting roll looks; the commands, the typed die and the GM's Adv and Disadv stay.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; a creature's tools and Add monsters open as sheets on a phone, and the menu is a
  sheet from the header.
- No data, command, projection or route changes. Who may answer each prompt and what each control sends are unchanged.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/C3-running/running.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
