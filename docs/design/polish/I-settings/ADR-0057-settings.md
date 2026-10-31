# ADR-0057: Settings: a side list of sections, rows with their control at the right, and the encounter rules by moment

## Status

Accepted

## Context and decision drivers

Area I of the polish pass (`docs/design/polish/I-settings/`) is setting the table up once and changing it rarely.
Running the branch at `f5e166f` as the GM with three characters claimed showed:

- Settings was a boxed strip of six sections with icons (Players, Encounters, Characters, Device, Access, API), Search
  settings with Ctrl K, and the section's own button beside it. On a phone the strip ran sideways under a Settings
  header and cut off its last sections.
- Each section was a heading with a GM ONLY tag, then one box of rows with a violet edge: the name, a line and the
  control at the right, or wide controls under the line.
- Encounters was the longest section: eight rows, the rules assistant with three lines of help and a box of six
  switches, and two rows with a line under their control.
- Access was three rows of buttons, then the credentials' table; its New credential dialog listed fourteen scopes as
  switches.
- Nothing said what a section held without opening it.
- ADR-0036 set Settings up as sections in a bar and turned down a table of contents as "the left rail the owner turned
  down"; `docs/DESIGN.md`'s page patterns say sections go in a bar.

The owner chose from one round of mockups with six options for each question, kept in
`docs/design/polish/I-settings/history/`.

## Considered options

- The frame: Titled bar (today's), Side list, One page, Home of cards, Search first, By who it touches.
- One setting: Row with the control at the right (today's), Two columns, Says what it does, Cards, Sentences, Changed
  from the default.
- The encounter rules: One list (today's), Presets, By moment, Rules and dice, The assistant first, A turn told.
- Access and credentials: Rows (today's), Credential cards, Danger at the foot, Scopes as a grid, Start from a use, Two
  columns.

## Decision

1. Settings is a side list: the sections at the left, each with a line of what it holds now, and the search at the top
   of the list. The section shows at the right. On a phone the list is the first page and a section opens with Back.
   This reverses ADR-0036's choice of a section bar for Settings, with the owner's agreement: the list earns its width
   by saying what each section holds. Other pages keep their section bars.
2. A setting stays a row: its name and line at the left and its control at the right, drawn to the theme.
3. The encounter rules keep their eight rows, grouped by when they matter: when a token is staged, when dice are
   rolled, on a player's turn, and when a hit lands.
4. Access keeps its rows and the credentials' table, drawn to the theme; New credential keeps its dialog.
5. Nine rules for settings, listed in `docs/design/polish/I-settings/SPEC.md` section 3, starting with keeping every
   setting and its words.

## Consequences and tradeoffs

- The list's lines are worked out in the client from the state the GM already has; a section whose summary needs data
  the page does not hold (the API's count) uses a fixed line.
- The side list takes 290 px of a laptop's width; the section's column keeps its width up to 820 px, so rows read as
  they do today.
- On a phone, Settings gains one step (the list) before a section, and loses the sideways strip that hid its last
  sections.
- Grouping Encounters by moment changes the rows' order; their names, lines and controls stay, so the encounter's own
  options still match them.
- The GM ONLY tag leaves the GM's section headings, which a player never sees.
- ADR-0036's address scheme stays (`/settings/<section>`, `/settings/api/<operation>`); only a phone's `/settings`
  changes, to the list of sections instead of the first section.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; on a phone the controls go under their lines and long option sets become lists.
- No data, command, projection or route changes. A player's Settings stays Device alone, and the GM's sections are
  never mounted for a player.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/I-settings/settings.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
