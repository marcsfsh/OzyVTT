# ADR-0049: The frame: One menu, More as the fifth tab, a scoped search and news in the corner

## Status

Accepted

## Context and decision drivers

Area A of the polish pass (`docs/design/polish/A-frame/`) covers everything around the pages: the top bar, the phone's
tabs and header, search, the theme switch, and the news that arrives while people play. Running the branch at
`f5e166f` showed:

- The laptop top bar held the sections and a row of utility icons: the table screen lamp, the faces of who is online,
  search, the theme switch and settings. Away from Play nothing said an encounter was running.
- A phone stacked two rows above most pages: the wordmark bar with the same utilities, then the page's header, which
  could carry a second search. Play and the player's table dropped the wordmark bar for their own header, so the frame
  changed from page to page.
- Search was a dialog of doors: choose the Codex, the Compendium or the rules, then type there. Ctrl K opened a
  different search on the Codex, the Compendium, Prep and Settings.
- The theme spec (ADR-0048) had just limited a phone's header row to a title and two icons, which left the utilities
  nowhere to go on a phone.

The owner chose from one round of mockups, kept in `docs/design/polish/A-frame/history/`.

## Considered options

- Laptop top bar: Tidy (today with less in it), Live line (what is happening at the table across the middle of the
  bar), One menu (the fewest things in the bar and one menu behind your face).
- Phone frame: Header icons (search and More on every header), Fifth tab (More as a bottom tab), Face menu (your face
  starts the header and opens the menu).
- Search: Doors (today's launcher), Palette (one field, results from every place at once), Scoped field (one field
  and a choice of one place to look).
- News: Corner (where it is today), From the horizon (everything hangs from the top bar's horizon), Status line (one
  line along the bottom of the screen).

## Decision

1. The laptop top bar is One menu: the wordmark, the sections, a live chip while an encounter runs (the encounter
   picker on the GM's Play page), the search icon and one menu button. The menu holds who is online, the table screen,
   the theme, settings and signing out, or for a player releasing the character and leaving the table.
2. A phone has no top bar. Each page's header row is its first row, and More is the fifth bottom tab: a sheet with
   search and the menu's rows.
3. Search is one dialog with one field and a choice of where to look (Codex, Compendium for the GM, Rules, Go to),
   starting on the section you are in. Each place keeps its section's own search and authorization.
4. News stays in the corner: toasts in the bottom right and above the phone's tabs; reconnecting and roll calls as bands
   under the top bar or header row.
5. Eleven rules for the frame, listed in `docs/design/polish/A-frame/SPEC.md` section 3: among them the live lamp, the
   theme switch leaving the bar, one Ctrl K, and the Dialog pattern for confirmations.

## Consequences and tradeoffs

- A laptop bar with four things after the sections, and a phone with one row of chrome above the page instead of two.
- The table screen's state and who is online move into the menu. The GM's menu button keeps the online count, so a
  player connecting still lights something in the bar; the table screen lamp is one click away.
- Five bottom tabs at 390 px are 78 px each, still well over the 44 px floor.
- The wordmark no longer shows on a phone page; arrival keeps it.
- Sections give up Ctrl K for their own search; their search fields open the shared dialog already looking there.
- Search shows one place at a time, so nothing new crosses a projection: each place's results are what that section
  shows today.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; the More sheet's rows are 52 px.
- No data, command or projection changes. Search calls only the searches each role can already call, with the same
  token, and a player has no Compendium place.

## Migration / reversibility

- Client and docs only. Reversible by reverting the shell commits; nothing stored changes shape.

## Validation evidence

- The approved mockup: `docs/design/polish/A-frame/frame.html`.
- The plan's checks at 390 by 844 and 1280 by 800 in Dusk and Dawn, with reduced motion and reduced transparency, plus
  the full checks and the smoke suite.
