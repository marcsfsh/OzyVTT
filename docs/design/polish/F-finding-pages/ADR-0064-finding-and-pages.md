# ADR-0064: Finding and pages: results as panes, kinds at the side, and a page's tag, reveal and versions in its side column

## Status

Accepted

## Context and decision drivers

F's second round of the polish pass (`docs/design/polish/F-finding-pages/`), inside the Codex's frame (ADR-0054) and A's
search dialog (ADR-0049's frame decisions). Running the branch at `f5e166f` with twelve Codex pages showed:

- The search page was a table under Type, Visibility and Modified menus.
- The pages index was a narrow column: a name field, the tags as chips, the kinds as rows with counts, the GM's folders,
  and every page.
- A tag was a page of its own with its pages and pins.
- Revealing a block was a dialog: who sees it, what they will read, and the stamp's line.
- Version history was a dialog of versions with Restore.
- The Codex had its own Ctrl K palette and its own page picker.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/F-finding-pages/history/`, each built only from settled parts. The owner also
asked for compact history rows.

## Considered options

- All the results: Today's table, Rows with their line, By kind, Results and the page, Only the dialog.
- The pages index: Today's index, Cards by kind, Kinds at the side, One table, A to Z.
- A tag: Today's page, A filter on the index, A record, A menu at the tag, In the side column.
- Revealing: Today's dialog, A menu at Reveal, In place, Beside the preview, In the side column.
- Version history: Today's dialog, In the side column, Side by side, A line of versions, A's menu.

## Decision

1. All the results are panes: kinds and who sees them, the results, and the chosen page.
2. The pages index puts the kinds, the GM's folders and the tags at the side.
3. On a page, a tag, a reveal and the versions each take the side column in turn; the versions are one compact line
   each.
4. Ctrl K's palette and the page picker are A's search dialog in the Codex.
5. Seven rules, listed in `docs/design/polish/F-finding-pages/SPEC.md` section 3.

## Consequences and tradeoffs

- The page stays readable while a tag, a reveal or a version is open beside it; only one of them can be open at once.
- `/codex/tags/:tag` becomes the index filtered to the tag, so a tag's own page goes.
- One search dialog serves the whole app; the Codex's palette and picker are removed.

## Mobile, security, and visibility impact

- On a phone the side column's parts become tabs on the page; lists run one column; every control keeps 44 px.
- No data, command, projection or route changes. Players' search and index list only what they can open, as today.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/F-finding-pages/finding-and-pages.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
