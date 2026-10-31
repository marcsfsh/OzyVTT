# ADR-0071: Settings' leftovers: the API reference as grouped rows, an operation's two sides, buttons at the table, a credential's page, and Settings' side list matched

## Status

Accepted

## Context and decision drivers

I's second round of the polish pass (`docs/design/polish/I-settings-leftovers/`), inside Settings' frame (ADR-0057).
Running the branch at `f5e166f` with a player claiming a character and three integration credentials (one used, refused
once and rotated; one revoked) showed:

- The API reference was one table of 405 operations under Operations and Commands, a find field, Tags, Filters and Sort.
- An operation was one document with its facts in a panel at the right.
- The commands were a second table behind the Operations and Commands switch.
- At the table's rows each had an Actions menu (Force release, Set token image).
- A credential's History was a dialog from its row.
- Settings' side list drew taller rows with a line under each section, unlike the side lists settled elsewhere.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/I-settings-leftovers/history/`. The owner asked that Settings' side list
match the side lists already settled.

## Considered options

- The API reference: Today's table, Tags at the side, An operation beside the list, Grouped as Settings' rows, A card
  per tag.
- An operation's page: Today's document and facts, Tabs, Facts in the side column, Settings' rows, Request and response
  side by side.
- The commands: Today's switch, In the side list, On each operation, Two groups, A column of the table.
- At the table: Today's Actions menu, Two buttons on the row, A's menu at More, Opens under its row, In the side column.
- A credential's history: Today's dialog, In the side column, Under its row, A credential's page, One feed.

## Decision

1. The API reference groups each tag's operations as Settings' rows.
2. An operation puts its request and its response side by side.
3. Each operation's row names its command; the separate commands table goes.
4. At the table's rows carry Token image and Release as buttons.
5. A credential opens as its own page with Rotate, Revoke and its history.
6. Settings' side list is drawn as the settled side list, with the Codex group from ADR-0070. This amends ADR-0057's
   side list (its lines move to each section's head) and ADR-0070's Codex group.
7. Seven rules, listed in `docs/design/polish/I-settings-leftovers/SPEC.md` section 3.

## Consequences and tradeoffs

- Every side list in the app now reads one way.
- The reference reads as Settings does; a long tag scrolls as one group.
- At the table's rows grow by two buttons; the Actions menu goes.

## Mobile, security, and visibility impact

- On a phone the rows stack, an operation's two sides become a control, and the buttons are 44 px icons.
- No data, command, projection or route changes. A secret is still shown once.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/I-settings-leftovers/settings-leftovers.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
