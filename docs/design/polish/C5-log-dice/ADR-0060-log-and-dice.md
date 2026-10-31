# ADR-0060: Log and dice: one line each, a roll as its card, the composer led by who hears it, the dice as a sheet, and calls from the waiting list

## Status

Accepted

## Context and decision drivers

C5 of the polish pass (`docs/design/polish/C5-log-dice/`), inside the table's frame (ADR-0050) and after C3 (ADR-0058,
ADR-0059). Running the branch at `f5e166f` with a fight on the old road showed:

- The log was one flat list, rolls as boxed cards and everything else as plain lines, with no mark on what players
  cannot see and a jump to the foot on every new line.
- The composer was a row of boxed dice, then Who hears it, the field and Send, then the roll's visibility and Dice
  options.
- Dice options was a dialog with the GM's Call for a roll as a second mode; the call's open answers lived there too.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/C5-log-dice/history/`, each built only from settled parts.

## Considered options

- The log: One list (today's), By turn, One line each, Latest roll on top, With filters.
- One roll: Card (today's), Row, As the TV shows it, Dice first, Total first.
- The composer: Today's composer, Field first, Say or Roll, The tray in place, Dice on demand.
- The dice options: The dialog (today's), A sheet over the panel, Two panes, In place, Recent rolls first.
- Calling for a roll: In the dice options (today's), In the encounter's menu, From the waiting list, From the Party tab,
  Beside the composer.

## Decision

1. The log is one line per entry; pressing a roll's line opens its card in place.
2. A roll reads as today's card, drawn to the theme, with its tags.
3. The composer leads with who hears it as a Base line control, then the field and Send, with the quick dice under it.
4. The dice options are a sheet over the panel.
5. The GM calls for a roll from the waiting list's head; the open call waits there as a card on players.
6. Eight rules, listed in `docs/design/polish/C5-log-dice/SPEC.md` section 3, starting with GM-only lines and whispers
   marked in the GM's log.

## Consequences and tradeoffs

- A roll's dice and formula take a press to see in the log; the total, who and what, and the tags show at once.
- The dice sheet no longer holds calls; the GM finds them beside what waits, which the bell already draws the eye to.
- The log holds still while scrolled up, so a reader can finish a line; the count of new lines brings them back.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; on a phone the log is the Switch's Log view, and the sheet and the call's form
  open in place.
- No data, command, projection or route changes. Who sees a line or a roll stays the server's; the GM ONLY tag marks only
  what the GM's own view already carries.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/C5-log-dice/log-and-dice.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
