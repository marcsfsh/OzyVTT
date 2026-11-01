# ADR-0061: A player in a fight: prompts over the map, a reaction as its roll row, death saves as lamps, and a cast's asks and spell card under its row

## Status

Accepted

## Context and decision drivers

C4 and C6 of the polish pass (`docs/design/polish/C4-C6-player/`), inside the table's frame (ADR-0050) and after C3
(ADR-0058, ADR-0059) and C5 (ADR-0060). Running the branch at `f5e166f` with a fight on the old road showed:

- A prompt was a box above the panel's tabs, capped at half the panel, with how many more waited under it. Its eyebrow
  added "answer now" (or "roll now"), and the slot was the region "Answer now".
- Away from the table only calls for a roll followed the player, stacked at the top of the Sheet and pushing it down;
  a reaction offer reached the Sheet only as a toast.
- A reaction was the box's words, its numbers, then Take the hit and Cast Shield. A death save was red pips, Roll death
  save, then the held result and Confirm.
- A cast opened its slot choice in the sheet's right column, then asked who in a centred dialog; shape-shift, Ready, a
  picked spell, a spell swap and an item's choices were dialogs too. The spell card was a centred dialog.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/C4-C6-player/history/`, each built only from settled parts. The owner also
asked that "answer now" go from the card and everywhere else it appears.

## Considered options

- Where a prompt sits: Over the panel's tabs (today's), Heading the Turn tab, A band over the table, Over the map, Over
  End turn.
- A reaction: Card and buttons (today's), The answer is the row, Two choices side by side, Numbers first, On the
  Reaction tab.
- Dying: Today's card, The roll is the row, Lamps, The turn itself, A red band.
- Choosing for a spell: A dialog (today's), The Turn tab chooses, A sheet over the panel, Under its row, One step at a
  time.
- The spell card: The dialog (today's), The Compendium's record, A sheet over the panel, Under its row, In the panel.

## Decision

1. A prompt sits on glass at the foot of the map; on a phone, at the foot of the Switch's open view; away from the table,
   as A's band, now for every prompt.
2. A prompt's eyebrow names its kind only; "answer now" and "roll now" go, and the slot is the region "Prompts".
3. A reaction's answer is its roll row, with keeping the reaction as a control under it.
4. Dying shows the death saves as the cost tabs' lamps over the death save's roll row.
5. What a cast or a feature asks opens under its row, at the table and on the sheet, and its dialogs go.
6. The spell card opens under its row.
7. Eight rules, listed in `docs/design/polish/C4-C6-player/SPEC.md` section 3, starting with a prompt that stays in view.

## Consequences and tradeoffs

- The panel keeps its full height for the turn while a prompt waits; the card covers part of the map's foot instead,
  and the map pans under it.
- Every prompt follows the player off the table, so the Sheet no longer stacks calls or relies on toasts for reactions.
- Asks and cards open where the player pressed, so the turn's list grows while one is open, and only one opens at a
  time.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; on a phone the card sits at the foot of the Switch's view, and asks and cards
  open under their rows.
- No data, command, projection or route changes. The prompts, their numbers and their words are the player's own view;
  the band uses the same view on every page.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/C4-C6-player/a-player-in-a-fight.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as a player, plus the full checks and the smoke
  suite.
