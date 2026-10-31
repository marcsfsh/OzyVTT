# ADR-0051: Characters: the roster as bands, the builder's steps, levelling in a dialog and a party member as a band

## Status

Accepted

## Context and decision drivers

Area D of the polish pass (`docs/design/polish/D-characters/`) is who you play, from making them to looking them up.
The sheet itself was decided in ADR-0047 (the Ledger). Running the branch at `f5e166f` showed:

- The roster opened with a ROSTER title, four buttons in a row, the players' join address, a boxed sample notice, then
  tall cards with a large portrait, a line of small text, a Played at the table switch and up to five buttons each.
- The builder's steps, choices and detail worked, with a filled box for the current step and its own look for the rail.
- Levelling up was a page of level numbers, then the whole builder again with every earlier step ticked and the new
  level's step added.
- A player looking at another character got a small dialog of plain lines.

The owner chose from one round of mockups with four options for each question, kept in
`docs/design/polish/D-characters/history/`.

## Considered options

- Roster: Cards, Table, Bands (the Ledger's band per character), Split (a list and the chosen character).
- Making a character: Steps and detail (today's), Steps and sheet (a live sheet preview), One at a time, On the sheet
  (an empty Ledger to fill).
- Levelling up: Steps (today's), One page, On the sheet, Dialog.
- A party member: Band, Party page, Cards, Strip (faces on your own sheet).

## Decision

1. The roster shows each character as a band like the Ledger's: identity, one plate of AC, hit points, Speed and
   Passive Perception, who plays them, and Open sheet, Level up and a More menu.
2. Making a character keeps the builder's steps, choices and the chosen option's detail, drawn to the theme.
3. Levelling up is a dialog over the sheet with the level's own short steps (hit points, each choice the level brings,
   review), replacing the level page and the builder in level mode.
4. A party member opens as a band in a dialog, showing only what the projection sends.
5. Ten rules for characters, listed in `docs/design/polish/D-characters/SPEC.md` section 3.

## Consequences and tradeoffs

- The roster reads like the sheet, and a GM compares the party's numbers down one column of plates.
- Levelling no longer walks through the builder's earlier steps; a level is two to four steps. Choices a level does
  not bring are not reopened there; changing an earlier answer is the builder's job.
- The roster no longer repeats the join address or the Played at the table switch on every character.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area. Dialogs are sheets from the bottom on a phone.
- No data, command or projection changes. A party member shows only the fields another player already receives.

## Migration / reversibility

- Client and docs only. The level route `/characters/:id/level` opens the sheet with the dialog, so links keep working.
  Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/D-characters/characters.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
