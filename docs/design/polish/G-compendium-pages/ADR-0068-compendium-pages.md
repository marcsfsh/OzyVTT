# ADR-0068: The Compendium's pages: sources and kinds at the side, history as compact rows, merging in A's dialog, and sharing in the side column

## Status

Accepted

## Context and decision drivers

G's second round of the polish pass (`docs/design/polish/G-compendium-pages/`), inside the Compendium's frame
(ADR-0055). Running the branch at `f5e166f` with one homebrew copy of the Goblin Boss showed:

- Sources was a table (records, published, shared, credit, in pickers) under Import a pack and Export a selection.
- Sharing listed the published records with Tick records to set them together, and the chosen record's row at the right.
- A homebrew record's History tab was a table of versions, then Based on and Compare with the SRD.
- When two devices saved the same record, a panel replaced the record with each field's two values.
- A record's Sharing tab held Hidden, Everyone and Characters, a box for each character, and the line on stat blocks.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/G-compendium-pages/history/`, each built only from settled parts. The same
round showed the Atlas as mixed (ADR-0067) for the owner to confirm.

## Considered options

- Sources: Today's table, A card per source, Sources at the side, By kind, A dashboard.
- Sharing: Today's list and row, Records by character, Kinds at the side, Characters at the side, Records and the
  record.
- A record's history: Today's tab, Compact rows as the Codex's, A line of versions, What each changed, Side by side.
- When two devices changed it: Today's panel, Mine and theirs as cards, At each field, A's dialog, In the side column.
- A record's sharing: Today's tab, Who as chips, In the side column, A's menu at Share, One row a player.

## Decision

1. Sources sit at the side, the chosen one at the right with In pickers, its kinds and what needs you.
2. Sharing puts the kinds at the side, each record's Who sees it as a Base line control.
3. A record's history is the Codex's compact rows in a side column, a version read under a cyan band.
4. When two devices changed a record, A's dialog asks which value to keep for each field.
5. A record's sharing opens in the side column, as revealing does in the Codex.
6. Eight rules, listed in `docs/design/polish/G-compendium-pages/SPEC.md` section 3, which also settle search's dialog,
   the catalog picker and the other kinds' editors.

## Consequences and tradeoffs

- The Compendium's lists and the Codex's share one shape (a side list, rows, a side column), so the GM learns it once.
- Each source's kinds are counted on the client from the homebrew rows it already reads.
- A conflict now interrupts with a dialog in place of a panel; closing it leaves the conflict open on the record.

## Mobile, security, and visibility impact

- On a phone the side lists become chips, the side columns become the tab's body, and the dialog rises from the foot.
- No data, command, projection or route changes. Players see only what they see today; a monster's stat block never
  reaches them.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/G-compendium-pages/compendium-pages.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
