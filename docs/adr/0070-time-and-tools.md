# ADR-0070: Time and tools: prep templates as one page with the kinds at the side, a calendar page, a record in the side column, and the Codex's tools in Settings

## Status

Accepted

## Context and decision drivers

F's fifth round of the polish pass (`docs/design/polish/F-time-tools/`), inside the Codex's frame (ADR-0054), the
story's tabs (ADR-0066) and Settings' frame (ADR-0057). Running the branch at `f5e166f` with the starting template, a
calendar of twelve months with an era, four dated entries and a player in the Codex showed:

- Prep templates were cards across the top, the chosen one's sections as rows of two fields, and New session from this
  template at the right; a phone could only read them.
- The calendar was one long dialog; your date a small dialog from the date bar.
- A timeline record opened as a dialog.
- Backup and Settings (autosave and history) were two pages from the GM menu.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question (three of them on prep templates), kept in `docs/design/polish/F-time-tools/history/`. The owner put two
options together for a session from a template and for the tools, and asked that every side list match the ones already
settled.

## Considered options

- Templates' library: Today's cards and editor, Templates at the side, A card per template, Beside the sessions,
  Templates, the template, its sessions.
- Editing a template: Today's rows of fields, The prep it makes, A card per section, Rows and the section at the side,
  The kinds at the side.
- A session from a template: Today's panel, A's dialog, One press, From the Sessions tab, Re-apply shows what it adds.
- The calendar: Today's dialog, A's dialog in tabs, A calendar page, The year drawn, Settings rows.
- A timeline record: Today's dialog, In the side column, Opens under its row, A card on glass, Its own page.
- The Codex's tools: Today's two pages, One page with the tools at the side, One page of rows, In Settings, A card per
  tool.

## Decision

1. Prep templates are one page: the templates and the kinds of section in the settled side list, the chosen template's
   sections in the middle, today's New session panel at the right.
2. A section is added by dragging or pressing its kind in the side list.
3. A session is made from today's panel or from Plan session on the story's Sessions tab; Re-apply stays as today.
4. The calendar is its own page with its parts in the settled side list.
5. A timeline record opens in the story's side column.
6. The Codex's tools move into Settings: a Codex group in Settings' side list, each tool its own row.
7. Eight rules, listed in `docs/design/polish/F-time-tools/SPEC.md` section 3, which also settle setting your date and a
   player's Compendium in the Codex.

## Consequences and tradeoffs

- Every side list in the app reads one way (E2's, and Settings' with its line), so the GM learns it once.
- Templates gain phone editing; the template page holds three columns on a laptop.
- The Codex's GM menu loses Backup and Settings; More opens Settings at the Codex group.

## Mobile, security, and visibility impact

- On a phone the side lists become chips, the record opens as a page, the tools sit in Settings' list.
- No data, command, projection or route changes. Prep and templates stay the GM's; players see only what they see today.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/F-time-tools/time-and-tools.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
