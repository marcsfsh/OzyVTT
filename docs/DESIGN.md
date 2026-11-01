# Design

The rules a UI change has to follow. Token values live in `packages/ui/src/styles/design-tokens.css`, the primitives
are exported from `packages/ui/src/index.ts` and the default avatars are in `packages/ui/src/avatars/`.
[ADR-0037](adr/0037-arcade-cabinet-redesign.md) records why the app looks this way, and
[ADR-0046](adr/0046-horizon-light-and-the-cup-primary.md) why the primary, plain titles and the light changed since. The static mockups in
`docs/design/mockups/` show every view below in both themes (`<view>-dusk.html` and `<view>-dawn.html`), with real
default avatars in portraits and tokens. The pictures and game values are sample fixtures, not seeded campaign data.
`docs/design/IMPLEMENTATION.md` records the branch audit, feature dependencies and implementation contracts. Read its
phase section before implementing that phase. Runtime behavior, audience boundaries, accessibility and phase gates
come from these documents and the existing code; the mockups supply visual values within those constraints. Mockup
CSS is reference material, not production code. A missing state uses the same primitives and existing behavior.

## Product principles

- Combat first. The table surface serves running an encounter; anything else earns its place.
- Rank before you place. For each screen, write down what the person needs there, in order. The order decides size
  and position: on the table the map comes first, whose turn it is second and any decision someone owes third.
  Anything past the first five goes behind one click, in a menu, a tab or the next page.
- Familiar first. A player who knows another VTT or D&D Beyond should recognise the layout before reading a word: the
  map in the middle, the turn order and tools on the left, one tabbed sidebar on the right, and a character header
  with hit points and AC. Break a convention only with a reason in an ADR.
- The obvious action is the correct one. Each view has one primary action, and its label names its result.
- Everything needed, nothing more. Each new setting is a small tax on every future decision. Settings that shape an
  encounter belong to the encounter in Prep, not to the table.
- Role clarity is part of the UX. A player should never wonder whether something is for them, and the GM should
  always be able to tell what players and the table screen can see.

## Arrival

The arrival screens (ADR-0052) share today's sunset, with one horizon the scene stands on.

- The title: the logo in clear sky above a smaller sun (300px at 1280px, 240px on a phone), never on the sun; Join as a
  player (the Cup) and Enter as GM (a raised plate with the GM violet on its leading edge) stand on the grid below the
  horizon, and the theme switch keeps the bottom right.
- Signing in is in place: the scene eases up (the horizon to 56%, 48% on a phone) and the GM's card stands where the
  buttons were, with Enter table as the Cup, Back, and Forgot the password at the right. First run is the same card.
- Picking a character is a lineup: with no map live the party stands on the sunset's horizon as tall cards (no logo
  over the sun), one chosen and raised, claimed ones dimmed with their tag, and Play as in a glass foot. With a map live
  the same cards sit in the table's panel, two to a row.
- The GM's empty table is the lobby: where players join (the code, the address, Copy) and the party with who plays each
  character, filling in as they claim, then Prepare an encounter. The join address has that one look everywhere.

## Look

An arcade cabinet at dusk and at dawn. There are two themes and nothing else:

- Dusk, the dark one: tinted glass panels over a blue-hour sky with a rose afterglow, white and grey ink, full neon.
- Dawn, the light one: soft lilac-grey paper, plum-grey ink, gentler edges and slightly muted accents. No pure white,
  no harsh black.

Neon appears only where it means something, and each 80s element has one job.

| Element                                  | Its job                                        | Where it appears                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sun frame (`--grad-sun`, 3px, with glow) | Now: who is acting                             | The acting row in the turn order, the acting creature's portrait in the sidebar or turn card, and the "is acting" line on a phone                                                                                                                                                                     |
| Sunset scene                             | Arrival                                        | The title and join screens only. Dusk paints it at night; Dawn paints it as daybreak.                                                                                                                                                                                                                 |
| Horizon line (`--grad-horizon`, 2px)     | The top of the app, and of what opens above it | The bottom edge of every top bar, laptop and phone, and the top edge of a dialog, menu, drawer or toast, which lights from the control that opened it and casts a faint light down into the surface (`--ink-cast`). The primary's lines and the chosen tab's ink are the same horizon (`--hz-paint`). |
| Chrome lettering (`.chrome`)             | Who is acting                                  | The wordmark, the acting creature's name and YOUR TURN. Nowhere else. Dawn prints it as solid ink with the same pink and cyan split.                                                                                                                                                                  |
| Cabinet lamp                             | Available, or on                               | Action, Bonus, Reaction and Move on the turn panel; the table screen status; a live encounter (the live chip and the phone's Play or Table tab, amber on a player's turn)                                                                                                                             |
| Life bar                                 | Hit points                                     | Every hit point readout                                                                                                                                                                                                                                                                               |
| VCR counter                              | The round                                      | PLAY and RND 03 during an encounter, STOP and RND -- between encounters, at the start of the turn order and beside YOUR TURN                                                                                                                                                                          |
| The Cup (`--hz-paint` in a plate)        | Press this                                     | The one primary action in a view                                                                                                                                                                                                                                                                      |
| Neon grid (`--grid-neon`)                | Map squares                                    | The grid drawn over a map image                                                                                                                                                                                                                                                                       |
| Reticle                                  | The target                                     | The creature an attack or spell is aimed at                                                                                                                                                                                                                                                           |

- Nothing pulses or loops. One-shot cues (a crit flash, a bar filling) are fine.
- No scanlines or other CRT texture over text or surfaces (ADR-0045). A surface is plain glass in Dusk and plain
  paper in Dawn; the light that moves across them on a change is all the cabinet's shimmer.
- Glow belongs to four things: the sun frame, a lit lamp, the selected item and the primary's lines. Resting surfaces
  never glow. Dawn keeps only the sun frame's glow.
- Every surface is square. `--radius-pill` is for tokens, presence dots and swatches.
- A panel is a flat plate with a 1px edge. There is no chrome lip and no rim.
- Legibility wins every conflict with mood. Reduced transparency turns Dusk's glass solid and drops the glows.

## Colour and themes

Never hard-code a colour in a component; add a token first and use `var(--...)`. Both themes share one token set and
one set of meanings; only values change.

The themes are `data-theme="dusk"` and `data-theme="dawn"`, named Dusk and Dawn wherever a person reads them. Dusk's
values live in `:root`, so it is what renders before anything is chosen. With nothing stored, the app follows
`prefers-color-scheme`: light gives Dawn, anything else Dusk. A device that saved one of the retired themes keeps its
side of the choice: a stored `dark` becomes `dusk` and a stored `light` becomes `dawn`, rewritten on first read.
An existing `dusk` or `dawn` stays as saved. A missing or invalid value follows the system preference at startup;
if that cannot be read, use Dusk. Storage read and write failures never prevent the selected theme from rendering.
The three HTML no-flash scripts and `getStoredTheme` must use this same decision table. An explicit saved choice wins;
no live system-change subscription is required in this redesign.

Dusk:

- The app's ground is `--sky`: `radial-gradient(120% 55% at 78% 108%, rgba(255, 94, 120, 0.32), transparent 62%),
linear-gradient(180deg, #151a2d 0%, #1d1f36 48%, #2a2140 100%)`.
- Bars and panels use the `--glass-*` tokens with `backdrop-filter: blur(16px) saturate(1.15)`; edges are white at low
  alpha.
- Under reduced transparency (the app setting or `prefers-reduced-transparency`), each glass token falls back to its
  corresponding solid value and the blur goes. Add the device setting in phase 1; it does not exist on the audited
  branch. Use `vtt.reduce-transparency` with `on` / `off`, default off, and an app-root attribute. Reduction is active
  when that setting is on OR the media query requests it. Apply it in all three entry points; no backdrop-filter
  support also uses solid surfaces. The setting cannot override an OS request for reduction.

Dawn:

- No coloured glow; the sun frame keeps its warm glow and the primary its pressed edge.
- Chrome lettering is solid ink with a 1px pink and cyan split at 35%.
- The join screen's sunset becomes daybreak: pale lilac to peach to pink over a pink grid, mountains with a teal rim.

In both: pictures keep their own colours (map art, avatars, the sun frame), the map stays as drawn on its dark
surround, a control over the map is a plate in the theme's surface, and lamps stay filled squares.

| Meaning                                                                                                                                               | Token                                    | Dusk solid (glass)                   | Dawn         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------ | ------------ |
| Bars                                                                                                                                                  | `--bg`                                   | `#151728` (`rgba(18, 20, 34, 0.7)`)  | `#ebe7ef`    |
| Wells, inputs                                                                                                                                         | `--void`                                 | `#131524` (`rgba(10, 12, 22, 0.55)`) | `#e3dee8`    |
| Panels and sidebars                                                                                                                                   | `--surface-1`                            | `#1b1e31` (`rgba(26, 29, 46, 0.62)`) | `#f3f0f5`    |
| Controls and cards at rest                                                                                                                            | `--surface-2`                            | `#25283f` (`rgba(44, 48, 72, 0.5)`)  | `#f7f5f9`    |
| Hover                                                                                                                                                 | `--surface-3`                            | `#2b2f49` (`rgba(60, 66, 96, 0.45)`) | `#e8e3ee`    |
| Row dividers                                                                                                                                          | `--line`                                 | `rgba(255, 255, 255, 0.07)`          | `#e0dbe6`    |
| Panel edges                                                                                                                                           | `--line-strong`                          | `rgba(255, 255, 255, 0.12)`          | `#d3ccdc`    |
| Control edges                                                                                                                                         | `--line-raised`                          | `rgba(255, 255, 255, 0.2)`           | `#b9b0c8`    |
| Text                                                                                                                                                  | `--text`, `--heading-ink`                | `#eef0f8`                            | `#2a2537`    |
| Secondary text                                                                                                                                        | `--text-dim`                             | `#c3c7d9`                            | `#4f4862`    |
| Labels and hints                                                                                                                                      | `--text-muted`                           | `#b0b4ca`                            | `#655d77`    |
| Press this: the Action lamp                                                                                                                           | `--magenta`                              | `#ff2f92`                            | `#f0559b`    |
| The primary's label, on its `--surface-2` plate                                                                                                       | `--text`                                 | `#eef0f8`                            | `#2a2537`    |
| The horizon in the primary's lines and plate                                                                                                          | `--hz-paint`                             | `--hz-1` to `--hz-5`, left to right  | the same     |
| How much of the primary's plate veils the horizon, at rest and on hover                                                                               | `--primary-veil`, `--primary-veil-hover` | `66%`, `54%`                         | `80%`, `74%` |
| Horizon light at 0%: cyan                                                                                                                             | `--hz-1`                                 | `#4fe3ff`                            | `#1d6a80`    |
| Horizon light at 30%: violet                                                                                                                          | `--hz-2`                                 | `#9a5cff`                            | `#6a46b0`    |
| Horizon light at 60%: pink                                                                                                                            | `--hz-3`                                 | `#ff2f92`                            | `#b0306e`    |
| Horizon light at 85%: orange                                                                                                                          | `--hz-4`                                 | `#ff8a1f`                            | `#c4610f`    |
| Horizon light at 100%: yellow                                                                                                                         | `--hz-5`                                 | `#ffe14d`                            | `#8a5612`    |
| Pink as words                                                                                                                                         | `--magenta-text`                         | `#ff8cc0`                            | `#a3246b`    |
| Selection, focus, targeting, active effects, Reaction lamp (the chosen tab's ink is the horizon; focus, targeting and the selected segment stay cyan) | `--cyan`, `--state-on`                   | `#4fe3ff`                            | `#2a8fa8`    |
| Cyan as words                                                                                                                                         | `--cyan-hi`                              | `#6fe8ff`                            | `#1d6a80`    |
| Ink on a cyan fill                                                                                                                                    | `--text-on-neon`                         | `#04141c`                            | `#04141c`    |
| The party: token rings, portrait edges, spell slot pips                                                                                               | `--party` (also `--indigo`)              | `#7aa2ff`                            | `#4a72d9`    |
| Party blue as words                                                                                                                                   | `--indigo-text`                          | `#a8c2ff`                            | `#3a5aa8`    |
| Enemies: token rings, portrait edges                                                                                                                  | `--hostile` (also `--danger`)            | `#ff5d50`                            | `#d9493f`    |
| Red as words                                                                                                                                          | `--danger-text`                          | `#ff9d94`                            | `#a8352c`    |
| Hit points left, Bonus lamp                                                                                                                           | `--hp`, `--lamp-bonus`                   | `#ffd54d`                            | `#d9a43a`    |
| Gold as words (the HP label, damage numbers)                                                                                                          | `--hp-text`                              | `#ffd54d`                            | `#7a5718`    |
| Hit points lost                                                                                                                                       | `--hp-lost`                              | `rgba(120, 30, 50, 0.6)`             | `#ecd6dc`    |
| Waiting, caution, a choice still owed                                                                                                                 | `--caution`                              | `#ffb733`                            | `#d08a2a`    |
| Caution as words                                                                                                                                      | `--caution-text`                         | `#ffcb7a`                            | `#875400`    |
| GM-only                                                                                                                                               | `--violet`                               | `#bb90ff`                            | `#8a62d6`    |
| GM-only as words                                                                                                                                      | `--violet-text`                          | `#d9c2ff`                            | `#6a44bf`    |
| Now                                                                                                                                                   | `--grad-sun`                             | `#ffe14d`, `#ff8a1f`, `#ff2f92`      | the same     |
| Map grid                                                                                                                                              | `--grid-neon`                            | `rgba(43, 228, 255, 0.24)`           | the same     |

- Every state carries an icon or a text label as well as a colour. Party blue and enemy red differ in lightness as well
  as hue. Green appears only inside pictures (map art, avatars) and never carries a meaning.
- `--hp` and `--lamp-bonus` share a value and not a meaning, so they stay two tokens.
- Contrast: normal text must clear 4.5:1 on its rendered background, including glass after compositing. The audited
  solid palette clears that threshold: the lowest Dusk pair is `--magenta-text` on `--surface-3`, 6.08:1; Dawn's is
  `--magenta-text` on `--void`, 4.54:1. The primary label clears 5.8:1 and `--text-on-neon` on `--cyan` clears 4.5:1.
  These solid checks do not prove contrast on arbitrary glass, layered tints, map controls or chrome lettering.
- Dawn's `--cyan` on `--void` is 2.84:1, below the 3:1 control-edge threshold. Keep the approved cyan fill and use
  `--focus-ring` and `--state-on-edge` for essential outlines: both alias `--cyan` in Dusk and `--cyan-hi` in Dawn.
  The selected fill gets that contrasting edge. Check the edge against the adjacent surface and label against fill.
- Update `packages/ui/src/theme/themes.test.ts` for Dusk as root and Dawn as the only override. Remove assertions about
  retired Night/Day and the old warm Dawn; keep text, label, edge and hue checks, and add `--hp-text`. Add glass
  compositing checks and browser checks on the actual layers. The existing colour parser drops alpha, so it cannot
  validate translucent tokens without extension. No test threshold is lowered to fit the mockups.

## Type

| Role                 | Token                              | Face                          | Use                                                                                                                                 |
| -------------------- | ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark             | `--font-wordmark`, `--font-script` | Bungee and Mr Dafoe           | OZY in chrome and vtt in neon script. The wordmark only.                                                                            |
| Chrome               | `--font-wordmark`                  | Bungee                        | Chrome lettering only: YOUR TURN, the acting creature's name and the table screen's acting name.                                    |
| Display              | `--font-display`, `--fw-display`   | Chakra Petch 600, in capitals | Record titles (a creature, a character, an encounter, a page), page and dialog titles, and the primary button. One or two per view. |
| UI                   | `--font-label`, `--font-body`      | Bai Jamjuree 500, 600 and 700 | Everything else: labels, body, tabs, buttons and names.                                                                             |
| Numbers and readouts | `--font-numeric`                   | VT323                         | Every game number at 15px or more (HP, AC, initiative, to-hit, DC, XP, dice), the VCR counter, and tags such as NEXT, WAIT and HIT. |
| Code                 | `--font-mono`                      | Space Mono                    | The API reference only.                                                                                                             |

- Fonts are self-hosted with `@fontsource`. Chakra Petch, VT323 and Mr Dafoe come from `@fontsource/chakra-petch`
  (600 only), `@fontsource/vt323` and `@fontsource/mr-dafoe`; Tomorrow is retired once nothing uses it.
- VT323 is monospaced, so a number that changes live keeps its width.
- Labels are sentence case. Uppercase belongs to display titles and VT323 tags, which are always short. A display title
  is written in sentence case and its rule sets the capitals.
- Sizes: titles 22 to 34px; body 14 to 16px; labels 12px semibold in `--text-muted`; numbers 18 to 40px.

## Layout

The shells:

- GM, laptop. A 56px top bar, the same on every page (ADR-0049): the wordmark; Play, Prep, Codex and Compendium; the live
  chip (a lamp, the live encounter's name and its round, which opens the encounter picker); then, on the right, search
  (Ctrl K) and the one menu. The menu's face is the GM mark with the count of players online; it holds the table screen
  and its actions, who is here, the theme (Dusk and Dawn), Settings and Sign out. Each section with pages
  has the Titled section bar under it (`shell/SectionBar.tsx`, ADR-0048): 52px, the section's name in Chakra Petch 600
  capitals at 17px, a divider, the pages as words with the horizon ink, then the section's search and its primary
  (the Cup at 42px) at the right end. No icons on the pages. Settings alone keeps the title row without the pages: its
  sections are a side list (ADR-0057), the search at its top, each section with its icon and a count, and the section
  beside it at 880px with its name, its line and what it holds now in its head. Under the sections the GM's list has
  CODEX (ADR-0070): Backup, Restore, Bring in notes, Autosave and Version history, each its own page of the Codex
  tool's rows. A phone opens Settings on that list, and a section or a tool full screen under Back and its name.
- GM, phone. No top bar. The four sections and More are the bottom tabs (64px, five equal tabs); More opens a sheet
  above them with the menu's rows and Search. Play or Table carries the live lamp while an encounter runs. The header
  row belongs to the page on screen: a section's page
  has a header row with the section's name at 18px and up to two icons, then its pages as one strip of words that
  scrolls sideways with a fade; a record's header is Back and where it goes, with no strip. Play's header row holds
  the VCR counter, the encounter picker, the sound, Join and the Encounter menu; under it the table is the Switch (table
  spec 2.4, ADR-0050): Map, Encounter, Log, Party and Notes as a segmented control, the turn order as cards in one line,
  the chosen view, and the foot with End turn pinned above the bottom tabs in every view.
- Player, laptop. The wordmark; Table, Sheet and Codex; the live chip while an encounter runs (amber on the player's turn);
  search; and the menu, its face the character they play, holding Release, the theme, Settings and Leave the table.
- Player, phone. Bottom tabs Table, Sheet, Codex, Log and More on every screen, the character's plate at the top of Table
  and Log. Table is the Switch: Map, Turn (Me before an encounter), Log and Party, the turn order's cards under it and End turn in
  reach in every view; choosing a target turns to Map, and an owed prompt or the player's turn turns to Turn.

Prep holds Encounters, Party (the roster, as bands; see Characters), Maps, Tokens, Sound and Replays, in that order in its section bar (ADR-0053).
New encounter is the bar's Cup on Prep's lists and steps down to a Base line control on a record. Encounters is a shelf:
its toolbar has Filters, the state chips, the count, Your order and New map, then a card an encounter with its map as
the picture, its one state tag (Live, Encounter parked, Replay, Ended, Prepared or Draft) and whether it is ready.

Maps are a shelf of cards beside their folders (ADR-0063): All maps, each folder with its count, No folder; a card
carries its picture, its grid and type, its use and its folder, and its More files it. Choose puts a box on each card
and a bar at the foot with Move to. Tokens are in the GM's groups: Party, the GM's own groups, then Monsters, each
creature with a More to set its image or move it; the groups are the GM's alone.

Sound (ADR-0065) is the board's parts at the side, ON THE BOARD (Playlist, Ambience, Effects) and LIBRARY (All sounds,
Not on the board) with their counts, beside the chosen part; on a phone they are chips. One Playing bar sits under the
title: what plays, the room's lamp, the track and its layers, a scrubber that seeks on release, Play or Pause, Next
track, Stop all and Master. A library row puts its sound on the board with Music, Ambience and Effect chips, lit where
it already is. An encounter's sound is on the encounter's page.

Replays (ADR-0069) are a table, newest first: the name (the encounter under a name the GM gave it), Fought, Turns,
Length and, for the GM, the eye. The chosen row is lit and its replay sits beside it with More, its line, Players see it
and Watch; a phone's row opens the replay's page. Watching puts the head row (the name, when it was fought, its turns and
length, More) over the transport and the map, with the whole fight beside it, the current turn lit. The transport is
Previous, Play and Next as icon buttons, the line of rounds (a section a round, a tick a turn, the watched part, the knob,
and marks for damage in amber, healing in cyan and a creature at 0 in red) that seeks when pressed or dragged, the count
("Turn 08 of 15") and, for the GM, Launch from turn {n}. More holds Players see it, Rename, Download JSON and Delete
replay. A player's replays are cards under the sheet, two to a row, while no encounter runs.

A page header is for records only (ADR-0048). A list, a settings section or an overview starts with its content and at
most one description line (14px, `--text-dim`, the GM only tag in front of it on a page players can also open). A
record opens with its title row: the title in Chakra Petch 600 capitals at 24px (20px on a phone), its tags, one 13px
line and its actions as secondary controls. Widths: workbenches, lists and tables use the full width; settings and
forms keep an 880px column, centred, or beside their side list; reading text keeps a 680px measure. The table screen's controls open from the
menu. The rules reference opens from search's Rules place and from the Compendium: a drawer on the right of a laptop, a
sheet from the bottom on a phone. Search is one dialog for the whole app (Ctrl K): Codex, Compendium (the GM's), Rules
and Go to, starting at the section you are in.

The table (Play), as Two docks (ADR-0025, ADR-0050):

- The left dock, 232px from 1280px and 72px from 980px: the round on the VCR counter at its head, the turn order as a
  Ladder that fills the dock and scrolls itself, and the map's tools under it as a grid of icon and word (icons alone
  in the 72px dock). A Ladder row is at least 52px: the face, the name, the initiative in VT323 and under the name a 4px
  bar (the GM sees everyone's; a player the party's) or a foe's wound word, then conditions as small tags. The acting
  row is tinted amber with the horizon ink down its left edge, NEXT sits under the next initiative, and hidden
  combatants show a dashed violet face and the crossed eye, to the GM only. In the 72px dock a row shows its face and
  initiative, and a pointer or focus shows it whole.
- The map fills the middle. Nothing floats over it except tokens, marks, the reticle, the Tray chip at its top left and
  its controls (centre, zoom out, zoom in) in glass at its bottom right. The acting token wears an amber ring.
- The panel, 380px, on the right, with tabs Encounter, Log, Party and Notes, and Token while a token is chosen (players
  get Turn, Sheet, Log and Party in an encounter, Me, Log and Party before one). During an encounter Encounter shows
  the acting creature: a 44px face, its name in Chakra Petch capitals with who runs it, the life bar with AC and speed,
  then the cost tabs and the options the chosen tab lists. The foot holds the Cup with Previous beside it as a Base line
  control and who is next under it.
- What waits on the GM is the waiting list (ADR-0058): at the top of Encounter, over the turn, which scrolls under it
  (the list takes up to half the panel, then scrolls itself), or by the GM's choice in its own first tab, the bell its
  label. The switch is in the list's head (Own tab, Over the turn) and in Settings, Device. Each item is a card: a 3px
  amber rim (grey for what waits on a player, listed last), the creature's 22px face, the title, its line and its
  buttons on Base lines with the main one lit on the cyan line. A tab whose entries grew since it was last opened
  carries the count after its word in quiet VT323 (Log); opening it drops the count.
- The log is one entry a line on a hairline (ADR-0060): a roll's tags, who and what, and its total in VT323 at the right;
  a turn's line in small capitals, the current turn in amber; damage red and healing gold. Pressing a roll's line opens
  its card in place (the total, each die in a box, the formula), one at a time. Scrolled up, the log holds still and a
  line at its foot says how many new lines wait. The composer is one row of who hears it (violet while a whisper), the
  field and Send, with the quick dice and More under it; More opens the dice options as a sheet over the Log tab: the
  roller as a Cradle, More dice and Recent rolls as open groups, who sees the next roll at its foot.
- The GM calls for a roll from the waiting list's head: the form opens in place over the list, and an open call waits
  in it as a grey card on players with a row per character, Roll for them and Close.
- The bell is the one signal that something waits on the GM: 16px amber with its count on a small badge, no words. It
  shows on the list's head, the Encounter tab or the list's tab, the acting Ladder row, the live chip, a phone's Play
  tab and the Compendium's home, and renders nothing when nothing waits.

Before an encounter, the same frame changes in three places:

- The dock's head shows the VCR counter at STOP with "No encounter running" and how many of the party and how many
  enemies are on the map under it; the Encounter tab's head holds the join address with a Copy button.
- The map shows every token with its plain ring; nobody wears the sun frame.
- Encounter before a fight is one form (ADR-0059), the same on a phone in the Switch's Encounter view: In this
  encounter as a Cradle (one row per creature with its tick and a More menu to show or hide it or take it off the list,
  New tokens shown to players at its head, the map line and the Add buttons under it), Who plays (each party character
  At the table or On their device, ADR-0042, a claimed one held on its device), Initiative (the two switches, starting
  from the encounter's settings, ADR-0039, and the dice line), Surprised as one chip per creature with the rule, the
  difficulty as an open group, and START THE ENCOUNTER in the foot over an accurate line of who rolls. With players
  rolling, say that the players roll for their claimed characters; do not promise an automatic roll for everyone.
- During a fight a creature's tools open under its row in Turn order and tools: Hit points, Conditions and effects and
  Position as Cradles, then This creature with Take out of the encounter in red, which asks first. The encounter's
  options are a More at the end of the panel's tabs (in the header on a phone). Add monsters is the Compendium's browse:
  filters with counts, the rows, the chosen stat block and its Cup. In a waiting card the roll is a row, and the whole
  row is the button.

The table screen (the shared TV) is for reading across a room. Gameplay has no controls; pairing, fullscreen and
optional local map framing remain available as device utilities.

- The ladder at the left (400px of 1280) and the map in the rest, fitted and never cropped (ADR-0056). The ladder's head
  is the wordmark and the round on the VCR counter with the horizon line under them; then one row a turn in initiative
  order: the initiative in VT323, the portrait and the name in full. The acting row grows into a card (a caution edge
  and wash, Acting now in caution capitals, the name in chrome kept whole), the next row carries NEXT with a cyan edge,
  and a hidden creature's turn is a GM turn row with a dashed violet portrait and no identity. Before the first turn
  no row is lit and the head says "Waiting for the first turn". A long order scrolls with the turn so the acting row and
  the next stay in view; names never shrink to fit.
- The ladder's foot is the latest public roll: who and what, the total in VT323 with a NAT tag, the dice in quiet VT323,
  or "No roll to show yet." Nothing covers the map. With a map and no encounter the ladder names the map under "No
  encounter running". The ladder's edge drags to set its width for that screen.
- Pairing, connecting, Paused and Waiting for a map are horizon screens: the sky, the wordmark and one line.
- Every paired screen shows the same thing. The GM's Table screen page (from the menu) is a bar of what is on the
  screen and a card per screen with its picture; a screen's card opens it as a remote with focus, ping and measure,
  which reach every screen. Preview it here docks the screen as a picture in picture (420px, 250px on a phone above the
  tabs) that stays on every page until closed, drags to another corner, and steps aside on the Table screen page.
- It shows only what the table screen's projection holds: no hidden combatants, no enemy hit points, the players' fog.
- Names 20 to 22px, numbers in VT323 from 28 to 80px.

Unchanged rules:

- The page never scrolls. A surface is a fixed frame (bars, headers, toolbars) plus regions, and each region either
  fits or scrolls itself with the `.scroll-y` class. Wide content gets its own horizontal scroller.
- One primary scroller per pane. The canvas region fills the leftover space with `flex: 1; min-height: 0`.
- Targets: a 1080p-class laptop and a 390x844-class phone in portrait. The width floor is 320px.
- Breakpoints come from one ladder: `max-width` 760 / 650 / 560, and `min-width` 850 / 980 / 1280 where a layout earns
  another column. The table screen reflows on orientation: landscape is the ladder beside the map, upright stacks the ladder over it.
- Spacing uses the 4px `--space-*` ladder.

## Pictures and default avatars

Every creature and character shows a picture: its own image, or one of the twenty default avatars in
`packages/ui/src/avatars/` (Horizon, Moonrise, Palm, D20, Blades, Claws, Orbit, Pyramid, Bolt, Cassette, Shades, Joystick, Gem, Flame, Waves, Pines, Horns, Paw, Vortex and Static). Each is a 64 by 64 SVG that keeps what matters inside the inscribed circle, so it works square as a portrait and round as a token.

Characters built with a class also have twelve class avatars, one per SRD 5.2.1 class, in the same folder as
`class-<class id>.svg` (`class-barbarian.svg` to `class-wizard.svg`).

- A character built with a class shows its main class's avatar: the class with the most levels, and on a tie the one
  taken first. It does so only where the viewer's projection includes that character's classes. When What players see
  of each other hides class, other players get the general pick, so the picture never tells them more than the
  setting allows. A homebrew class has no avatar of its own and falls back to the general pick.
- Every other actor gets a general default, picked by actor id: hash the id and take it modulo the nineteen general
  avatars (every one but Static), using the fixed order and hash in IMPLEMENTATION.md. An actor keeps its picture,
  and the pick reveals nothing a projection does not
  already send. Never pick by monster definition: two goblins sharing a picture would tell players they are the same
  kind of creature when the GM has hidden it.
- Static is reserved for an explicit anonymous-identity state supplied by a projection. The audited projections have
  no such flag: do not infer it from a missing class, definition, artwork, fog or `visibility`. A fully hidden actor
  is absent, so no Static tile is inserted for it. Until an explicit state exists, use the nineteen-avatar fallback.
- The sun frame marks who is acting and wraps whatever picture the creature has. Horizon is a default like the others
  and means nothing on its own.
- When two visible creatures share a picture, their tokens and tiles show initials in a small corner badge. Preserve
  `table/numbering.ts` names as well, so matching initials remain distinguishable. A token's name sits in a dark plate
  under it. Use a dedicated readable ink for that plate in both themes.
- Portrait and token edges: 2px `--party` for the party, `--hostile` for enemies, dashed `--violet` for anything hidden
  from players.

## Components

Build from `@vtt/ui`. A new primitive goes into `packages/ui` with `nh-` prefixed CSS and a test next to it. Sizes come
from the mockups.

- Primary button, the Cup (ADR-0046): 52px tall, or a 42px plate in a 44px box in a section bar. A `--surface-2` plate
  with a 1px `--line-raised` edge holds a horizon: a 3px `--hz-paint` line along its base and 1px lines up both sides
  at full height, with no top, and the horizon's colours tint the lower half of the plate through `--primary-veil`.
  The label is `--text` in Chakra Petch capitals at 16px (14px small). Hover and press lift the plate to `--surface-3`.
  A press sinks it 1px and lights it: the base fills from the press point, and a wash of the horizon rises in the cup
  and settles back. Disabled is a flat `--surface-2` box with a 1px `--line` edge and no lines. The label names the
  result: END TURN, MAKE LIVE, PLAY AS BORIN.
- Secondary controls sit on a Base line (ADR-0048): the label (Bai Jamjuree 600, 13 to 14px) on a 1px `--line-raised`
  line with no edge and no fill, lit 2px `--cyan` on hover. This covers secondary buttons, a record's icon button
  (`IconButton base`), menu triggers, the Dropdown and Filters buttons, chips you choose from and segmented options. An
  open or chosen one keeps the 2px cyan line; a hidden choice is violet on a dashed violet base; a danger action keeps
  `--danger-text` on a danger line; disabled is `--text-muted` on a `--line` base. The ghost, with no line until hover,
  is only for Cancel or Back beside a Cup. On a laptop a Base line button has a 36px face and `.tap-target` grows its
  hit area; with touch the face is 44px. Fields keep their box.
- Link button: cyan text without a box, at least 44px tall.
- Icon button: 44 by 44, always with an `aria-label`.
- Chip: a status chip with a tone (harmful, beneficial, magical, info) is a 1px edge in its tone and says what a thing
  is. A chip you choose from is its words on a Base line, dim until chosen, then `--text` on the 2px cyan line; a
  removable filter chip stands chosen with its x. 36px on a laptop within a 44px hit area; 44px on a phone.
- Tag: VT323 uppercase at 15 to 18px, one or two words. NEXT has a white fill, WAIT an amber fill, HIT a yellow fill and
  MISS a grey fill; TAKEN, READY, SRD and HOMEBREW (yellow outline) mark status; HIDDEN FROM PLAYERS is dashed violet.
- Lamp: a square light. Lit means available or on and glows in its colour; unlit is `--surface-3` with a 1px edge and
  the value `--`. Action is magenta, Bonus yellow and Reaction cyan; Move is a gauge of white squares, one per 5 ft. On
  the table the lamps are the cost tabs: Action, Bonus Action, Reaction and Move as one segmented row, each with its
  11px light, its name and READY, USED or NOT NOW (Move shows the feet left), and Legendary as a fifth for a creature
  with Legendary Actions. The chosen tab lists what costs it; the line under them marks it used or ready.
- Life bar: a segmented bar in a 1px well, lit segments `--hp` and lost ones `--hp-lost`. For exact HP use
  `clamp(ceil(maximum / 2), 1, 22)` segments and a clipped fill proportional to current/maximum. The VT323 number and
  accessible label give exact values, including temporary HP separately. At maximum zero, avoid division by zero.
  A projection that supplies only a health band shows the band label and existing band indicator, never invented
  HP numbers or an exact-looking life bar. Death saves and conditions stay available beside it.
- Switch: square, 46 by 26 visual track inside a hit area at least 46 by 44. Off is a grey knob on the left; on is a cyan knob on the right with a cyan edge and glow.
- Segmented control: its options side by side, 6px apart, each on its own Base line, with no well; the chosen option
  keeps the 2px cyan line. Options are 36px on a laptop within a 44px hit area, and 44px on a phone.
- Group (ADR-0048): a group you act in is the Cradle, `Group` in the kit: no fill and no top, a 2px `--line-raised` base
  and sides that fade before the top, its heading the one eyebrow in the open top, and its base lighting cyan from the
  middle out while the pointer or focus is inside. A group you only read is open (`kind="read"`): its heading and a
  1px `--line-strong` rule above it. Never a box in a box; groups stand 20px apart.
- Steps: one rail everywhere. A mark is a 24px square with its number in VT323 17px: done a cyan check, current a cyan
  outline, a step that needs a choice an amber dashed mark. No magenta.
- Row: a full-width button at least 52px tall with the name on the left, the key number in VT323 on the right and a
  one-line detail under the name in `--text-dim`.
- Table: a sticky 12px header in `--text-muted` and 48px rows. The selected row is tinted cyan with a 2px cyan edge on
  its leading side.
- Pending card: a 1px `--caution` edge on a faint amber tint, a WAIT tag, what happened and what it waits on, and one
  action appropriate to that pending state. Declining a reaction uses `reaction:answer` with `use: false` and lets
  the normal resolution proceed. `reaction:dismiss` drops held results in most cases; label it "Dismiss, settled by
  hand" and explain that consequence. Never wire "Resolve without waiting" to dismiss.
- Reaction prompt: a 2px cyan edge with glow; the title in the display face with a slight RGB split; a three-box readout when
  those values are available (their roll, your AC, the result with the reaction); one line on the cost; the primary
  and one secondary. Shield is one sample state. Preserve all existing reaction kinds and server outcomes. Omit a
  withheld attack roll; do not recover it from a stat block or show a predicted hit/miss as an authoritative result.
- Roll card: the roller's portrait and who did what to whom; the total in VT323 at 40px with the dice beside it in grey
  and the outcome tag at the right; damage under a dashed rule, in yellow, with its type and dice.
- Chat line: the sender's portrait, their name in bold and the message in `--text-dim`, with no card around it, so
  messages read lighter than rolls.
- Message box: pinned at the bottom of the log. A row of quick dice (d4, d6, d8, d10, d12, d20) above one input with a
  dice icon and a send button. Text that parses as a dice formula (2d6+3) rolls; anything else is sent as a message.
  Until table chat exists (ADR-0037, phase 8), the input takes formulas only and its placeholder says "Roll dice, like
  2d6+3".
- Who sees it: a tag in its 22px box. Hidden reads one way everywhere: violet with a dashed edge and the crossed eye.
  Everyone is quiet ink with the eye; chosen characters are cyan. A hidden block is a dashed violet box with its tag
  and Reveal; a revealed block says who it reached and when, with Hide again.
- Focus: every control shows a 2px `--focus-ring` outline with a 2px offset on keyboard focus (`:focus-visible`). It is never
  removed or hidden.
- Toast: bottom right on a laptop (420px wide, 16px in), just above the bottom tabs on a phone (8px in from each side),
  with a horizon line along its top. At least 52px high, its close a 36px square. A `--surface-2` plate with a 1px
  `--line-raised` edge, a VT323 tag for its kind (DONE, or ERROR in `--danger-text`), one line of text, and Undo when the
  action can be undone. It stays 5 seconds, pauses on hover or focus, and is announced politely (`aria-live="polite"`).
  Destructive actions are labelled and confirmed.
- Reconnecting: when the connection drops, show a band under the top bar (the first row on a phone): at least 48px of
  glass with a 3px amber edge, the WAIT tag and "Reconnecting. Wait before making changes." Controls that need the server are disabled with that reason; reading the last snapshot still
  works. Preserve unsent text as a local draft. Existing in-flight commands may time out; do not automatically
  replay them with new command IDs or announce success before an acknowledgement. The bar's own line is grey and
  unlit while it waits. When the connection returns a comet lights that line in the horizon's colours and the bar
  says "Back at the table" for 2 seconds, then goes.
- Roll calls away from the table: an amber band in the same row, each call one band with the ROLL tag, what the GM asks
  for and the roll as its button (the check's name and its bonus in VT323 on a 2px amber base). It stays until rolled.
- Not found: the empty state's one line, "Nothing lives at this address.", and Go to the table, under the frame you came
  from. Something broke: the arrival's sunset with one card, the message in a box with Copy, and Reload. Loading: the
  frame draws at once; after 400ms one `--text-muted` line says what is loading.
- Empty states (`EmptyState`): one line saying what is missing and one secondary button that fixes it, in the space the
  content would fill, with no heading, icon or box. For example, the log says "No rolls yet." above the dice, and an
  encounter without a map says "No map yet." with Pick a map. No illustrations; the sunset belongs to arrival screens.
  The GM's empty table is the lobby rather than an empty state (Arrival above).
- Icons are 20px stroked SVG. Never render an emoji or a text symbol as an icon.

## Motion

Light rail ([ADR-0045](adr/0045-light-rail-motion.md)) is the one motion language for change. The engine is
`packages/ui/src/motion/lightRail.ts` and the parts are drawn by `packages/ui/src/styles/light-rail.css`. The plan,
with every moment and the phase that builds it, and the approved mockup are in `docs/design/light-rail/` (`PLAN.md`,
`mockup/ozyvtt-light-rail.html`). The Horizon update ([ADR-0046](adr/0046-horizon-light-and-the-cup-primary.md)) and
its mockups are in `docs/design/light-rail/horizon/` (`UPDATE-PLAN.md`, `mockups/light-rail-horizon.html` and
`mockups/cup-button.html`). A surface whose moment is not built yet keeps the motion it has.

1. Light travels from the old place to the new one. It drains out of the old place, runs as one comet, bursts and
   fills where it lands. A wash is optional.
2. Light rides lines that are already there: the horizon, a tab strip's edge, the top edge of a surface, a bar or a
   rail of pips. A line is never added for the light alone.
3. Content never waits. It starts fading in within 60 ms and is complete within 300 ms. The light around it ends
   within 500 ms. A sequence that lights several things in order, like a long rest or the start of an encounter, may
   run to 700 ms.
4. One pass per change. Light never loops or pulses. A moment plays again only when the thing happens again.
5. The page itself only fades. Light lives in bars, strips and overlays, so the pane keeps its no-transform rule and
   fixed overlays stay put. A wash in the pane animates opacity alone.
6. Waiting is still. Something waiting on a person shows WAIT on a grey, unlit line (`--unlit`) and doesn't move.
   When it resolves, light runs along that line.
7. Lists that reorder slide. When items change places, each slides from where it was in 240 ms, and light runs along
   the rail between the old place and the new one.
8. Each 80s element keeps its job. Status uses its own lines, and chrome lettering catches light only when it names
   who is acting (YOUR TURN). A condition chip arriving and concentration breaking are the only places for the pink
   and cyan split.
9. Dawn has no glow. The burst is a flash on the line, and the wash is half as strong.
10. Reduced motion skips the light, and content swaps instantly. Reduced transparency drops the wash and the glow.
11. Light with no meaning of its own is the horizon (ADR-0046): a comet takes the horizon's colour where it leaves and
    where it lands, and a burst or pop the colour where it lands (`horizonAt`, the `lr-hz` parts). In Dusk its head is
    white with a glow; in Dawn it is the landing colour, flat. Hit points, damage, healing and targeting keep their own
    gold, red and cyan, because those colours mean something.
12. A chosen tab's ink is a horizon, cyan to yellow along its own length, with a faint cast of the same colours rising
    from it into the tab (`--ink-cast`). It lies on its strip's line and never stacks a second line above it: a strip
    whose line is an edge seats the ink over it (`--nh-ink-shift`), and the top bar's sections show the horizon's own
    colours where the ink lies, brightened, with no second horizon over it. A sunken track keeps it as the chosen tab's
    underline. A cast fades out sideways as well as away from its line, so no cast ends in a hard vertical edge.

Light presents state that has arrived from the server, and only what the viewer's projection already holds. It never
plays on first mount, and `canMove()` holds it while a whole snapshot lands (a connect, a reconnect, a switch of
encounter). On a new turn the sun frame slides to the next row of the Ladder (the next card on a phone) over 200 ms and the turn
order scrolls it into view.
A life bar's lost segments flash white once (two frames) when damage lands, ahead of the light along the bar. A damage
number rises from the token 20 ms after the burst and is gone by 900 ms, the one exception to the 500 ms rule, because
it is a value to read. It shows only where the viewer already holds the creature's exact hit points; elsewhere the
burst plays with no number, and healing never shows one.

| Token             | Value                            | Used for                                  |
| ----------------- | -------------------------------- | ----------------------------------------- |
| `--dur-drain`     | 130 ms                           | The old place letting go                  |
| `--dur-comet`     | 230 ms                           | The trip, whatever the distance           |
| `--dur-fill`      | 140 ms                           | The new place lighting                    |
| `--dur-burst`     | 200 ms                           | The flash on arrival                      |
| `--dur-wash`      | 260 ms                           | Light falling onto what changed           |
| `--dur-content`   | 200 ms                           | The content fade                          |
| `--delay-content` | 60 ms                            | When the content fade starts              |
| `--delay-fill`    | 170 ms                           | When the new place starts to fill         |
| `--delay-burst`   | 210 ms                           | When the burst lands                      |
| `--delay-wash`    | 200 ms                           | When the wash starts                      |
| `--dur-count`     | 300 ms                           | A roll's total counting up                |
| `--ease-travel`   | `cubic-bezier(0.45, 0, 0.25, 1)` | The comet, slow to start and slow to stop |

## Page patterns

The theme spec (`docs/design/polish/T-theme/SPEC.md`, ADR-0048) holds the rules every area follows; each area builds
its pages from these patterns.

| Pattern         | What it is                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Workbench       | The map in the middle, the turn order and tools in a dock on the left, one tabbed panel on the right        |
| Sheet           | A vitals band, columns of what you read and roll, one tabbed region for what you do                         |
| Record document | The record as its readers see it, with a panel beside it answering what the GM asks                         |
| List as a table | Toolbar (filters, sort, count), then a sortable table; rows with two facts on a phone                       |
| Making as steps | Steps on the left, questions in the middle, a live preview on the right                                     |
| Settings rows   | A side list of sections; Cradle groups of rows of 64px, the control at the right, in an 880px column        |
| Arrival         | The sunset with one card or one pair of buttons                                                             |
| Dialog          | A title on the horizon edge, the content, a footer with the primary at the right; a bottom sheet on a phone |

- Sections go in a bar. A section with several pages lists them in its bar with the search or the primary at the
  right end. A phone lists the app's sections as bottom tabs and the page's own views as a segmented strip under its
  header.
- A record reads as one document. The middle of the page shows the record as the people who use it see it: a Codex page
  as players read it, a stat block as the table prints it, an encounter as its map. A panel on the right answers what the GM
  asks about it: who sees it, where it is used, what it links to and its history. On a phone that panel folds into one
  row at the end of the document.
- A preview is the real thing, drawn by the component the real page uses. See it as switches the page in place to what
  Everyone or one chosen character receives, through the server's read for that audience.
- Lists are tables, or a shelf where the picture leads. Filters open from a Filters button and leave removable chips;
  sort names its order on its button. On a phone a table becomes rows with the two facts that matter most, and a shelf
  two cards to a row.
- Making something is a set of steps: steps down the left, each marked done (cyan check), current (cyan outline) or
  needing a choice (amber !); questions in the middle; a live preview on the right. On a phone the steps are a strip of
  chips and the preview is a bar above Next. The level dialog keeps its steps short, as a row along its top.
- An encounter's page is the table's workbench: the record's title row, the tools as the dock, the map with its Tray chip
  and controls, and a panel with Who is in it, Rules (its Encounter settings, ADR-0039) and Light and sound, its foot
  naming what is missing (from `factsOf` and `needsOf`, see `docs/design/IMPLEMENTATION.md`) over Make live. A new
  encounter is a Draft page with its checklist beside Pick a map, made when the map is picked. A map's grid keeps its
  steps.
- Decisions owed wait in one place: the GM's waiting list (over the turn or in its own tab), and for a player one prompt
  at a time on glass at the map's foot (ADR-0061; at the foot of the open Switch view on a phone), its eyebrow naming
  its kind only (Saving throw, Reaction, Death save, Damage, Initiative, Your turn) and the rest counted under it. A
  reaction's answer is its roll row with the decline under it; a death save shows Saves and Fails as lamps over its
  row. Away from the table the leading prompt is the amber band, a call rolling on it and anything else offering Go
  to the table.
- Time is a timeline. History is a list of versions with Compare and Restore.
- A map is present without taking over. Anything placed on a map has two ways in: a button and then a click on the map,
  or a right-click at the spot, which is a long press on a phone.
- A token, a door, the empty map and a drawing open A's menu (ADR-0062): the horizon edge along its top, its title and
  line, small capital heads; beside the thing on a laptop, from the foot of the view on a phone (10px gutters, above
  the bottom tabs, at most 70% of the height); one at a time, and closing it gives the focus back to the thing. The
  GM's token menu holds The token and The creature, its hit points and conditions under the creature's row. A tool's
  options are a menu from the tool, over the map on a phone.

## The character sheet

The sheet is the Ledger (ADR-0047; `docs/design/polish/D1-character-sheet/`).

- A vitals band runs across the top on every frame. On a laptop: the portrait, the name in the display face, the
  identity line and the live states under it; one stats plate (AC, Hit points with its number in VT323 `--hp-text`,
  the life bar and Damage, Heal and Temp on base lines, Initiative, Speed, Proficiency and an Inspiration square); then
  Rest as one menu with the Hit Point Dice under it. The band is one row on a sheet at least 1270px wide and two rows
  on a narrower one. A phone and the Table panel pin a compact band with the same cells in the same order: the name,
  the Level box, Rest and the menu, then AC, Hit points (one button that opens the Hit Points dialog), Initiative and
  Speed. Rest controls are hidden in an encounter.
- Laptop: the abilities as rows like a paper sheet's left edge (the name with its score, the check's modifier and the
  saving throw as two buttons) with the senses and tools under them, then the skills, then one tabbed box: Actions,
  Spells, Gear, Features and Notes, with the GM tab last for the GM. On a sheet at least 1200px wide the first two are
  250px columns that scroll themselves; a narrower one stacks them in one 280px column.
- Phone and Table panel: one row of tabs pinned under the band: Main, Actions, Spells, Gear, Features and Notes. Main
  holds the conditions and effects, a plate of Proficiency, Heroic Inspiration and Hit Point Dice, then the laptop's
  first two columns. The Death Saving Throws and a save owed come first. In a fight the panel drops Actions, which its
  Turn tab runs.
- A number you roll is its own button with no box: the ability row, the Save cell, the skill row. Skill rows are 30px
  on a laptop with a mouse (`--row-h-dense`) and 44px with any coarse pointer.
- Actions and Spells are tables. Each action row stays one button, with Range, Hit / DC and Damage in columns inside it
  and one header row per list; Actions opens with the spell slots left and closes with Limited use. Spells read Name,
  Time, Range, Hit / DC, Effect and the row's button, grouped by level with that level's slot pips in `--party`. A
  phone keeps Name, Hit / DC and the dice or effect, with the time, range and type on the name's line.
- Groups you act in (the stats plates, Abilities, Skills, Tools, the conditions) are Cradle boxes; Senses and the
  defences at the top of Features are open groups.
- In an encounter a player's Turn shows YOUR TURN in chrome with the VCR counter, the cost tabs, the chosen tab's options
  as the Ledger's columns with favourites first, any active effect, and End turn in the foot. Off-turn it shows who is
  acting in the sun frame, Action and Bonus Action NOT NOW with the Reaction tab chosen, any prompt the player owes at
  the top, and a foot that says when their turn comes. A spent reaction,
  incapacitation or server refusal keeps it unlit. Extra actions and movement beyond 30 ft must remain legible.
- An option that can't be used now stays in its list, disabled, with the server's reason at full strength.
- GM-only data and restricted-control groups have a violet `GmOnlyTag`, where players could see the place it sits: a GM
  row in Device carries it, and the GM's own Settings sections, which a player never sees, do not. Individual controls retain their semantic
  colours: the view's primary is the Cup, targeting stays cyan, and danger actions retain their warning treatment.
- The latest-roll line shows only rolls made from this sheet (`sheet-roll-ids.ts`).

## Characters

Prep's Party and the level dialog (ADR-0051; `docs/design/polish/D-characters/`).

- The roster is one band per character, drawn as the sheet's vitals band: the face, the name with its class line and
  tags, one plate of AC, Hit points, Speed and Passive Perception, then who plays (a lamp: cyan on a player's device,
  gold at the table, unlit open to claim), Open sheet, Level up and a More menu that holds Played at the table, Release,
  and Archive or Delete. Archived characters are one closed open group at the end. The join address is not on the
  roster.
- New character is the Cup in Prep's bar; Roll a random character and Import (a D&D Beyond PDF or a JSON file) are Base
  line controls in the roster's toolbar. Samples are one description line with Remove sample characters.
- Levelling is a 620px dialog over the sheet, titled "Level 8 for Borin", opening on the next level up, its steps along
  its top; its More menu holds Level down with what is kept. On a phone it is a sheet from the bottom.
- A party member opens as a 560px dialog drawn as the band, showing only what the GM's party tier sends: the face, the
  class line, conditions as tags, the plate, the abilities (modifier over score) and, with resources, Hit Point Dice
  and spell slots on one line. A player with nothing claimed sees "You aren't playing anyone yet." and Pick a
  character.

## The Codex

- The Titled bar (ADR-0054): Codex, then Home, Pages, Atlas, Story, Quests and Relationships (a player's strip ends with
  Compendium), the search field with Ctrl K, New as the Cup with its menu (page, quest, session) and More, which holds
  Prep templates, Backup, Autosave and history, Calendar and See the Codex as players. A phone runs the same pages as a strip of
  words under its header, with Search and New as icons.
- Home is the dashboard: the date bar as a Cradle (the campaign's date in VT323 cyan, with whether players have it),
  the five kinds as cards in a row, Recently changed as an open group of rows, and at the right (330px) the next
  session with Start session N as the Cup, Where the party is and the Reveal check. A phone stacks the date bar, the
  kinds and the session.
- A page reads as a wiki: the record's title row (the crumb, the title, then its kind, who can open it and what is
  hidden as tags), the text at the left in its 680px measure, and open groups at the right (Facts, Relationships, On
  the Atlas, Mentioned on, Tags, In the journal). A player gets the same page with every hidden part left out and
  nothing that says so. A phone has Overview, Relations and Mentions as words, with the facts in two columns.
- Search is panes (ADR-0064): Kinds with their counts and, for the GM, Who sees it at the left (220px); the field, the
  count, the results' More (the sort and when it changed) and the results as rows in the middle (420px); the chosen
  result at the right with the match lit, its facts and Open the page. The arrows move the choice, Enter opens it, and
  a line from a page's hidden block reads "Hidden block:". A phone has the field, the kinds as chips and rows that open
  under themselves. The search dialog's hits end with See all {N} results.
- The pages index puts KINDS, the GM's FOLDERS · ONLY YOU and TAGS (#name chips with counts) at the left (240px) and
  the chosen group's rows at the right under a toolbar: Find a page by name, the count in plain words ("4 people"),
  Changed or Name, New page. A hidden page's name is violet with its Hidden tag. A phone has the kinds and the tags as
  chips over the rows.
- A page's side column takes one part at a time in place of the facts, each under Back: a tag ("#thornwick · 4
  pages", then what carries it), a reveal ("Reveal {name}" in violet, Who sees it as chips, What they will read, the
  stamp's line and the Cup) and the versions (Versions · {N}, one line a version; choosing one reads it in the main
  column under the cyan notice with Restore this version and Back to now). The text stays where it is. On a phone each
  is a tab after Overview, Relations and Mentions.
- Choosing a page to link (a relationship, a field, a session's prep, a quest) opens the search dialog titled "Link a
  page to {what}", offering only pages.
- Writing is in place: Edit turns the page into its writer, with Preview, Saved and Done as the Cup in the title row,
  the toolbar over one bordered text field, and the fields as a Cradle with Everyone and Hidden for each. Preview saves
  first, then shows the page exactly as players get it under a violet line; See as players on a page is the same view.
  A phone has Write and Preview under its header and Done pinned at the foot.
- Quests put STATUS (All quests, Active, Not started, Done) and, for the GM, WHO SEES IT with counts at the left, and
  the quests as rows with their progress (a 4px line and "1 of 3") under a toolbar with New quest as a Base line
  button; a quest opens alone as its page (ADR-0066).
- Relationships are a ring on glass: the centred page in the middle and up to eight ties around it from the top, each
  line named at its middle, a hidden tie dashed violet, "+N more" past eight; Centre on, the views and the ties (one row
  a neighbour, choosing one lights its line) sit on glass over it. A phone has the ring and the ties as a sheet.
- A faction's standing opens in its page's side column: the word large with the old number and the new, steps of 10
  and 5, the seven words with their ranges, Why it moved and Record change as the Cup. The Factions grid's cells open
  it there.
- Add to the chronicle opens the composer at the head of the line, above the first session: the kinds, Filed under
  (any session or Not in a session, and the in-world date), the text, Hidden note and Link a page as options, and the
  kind's Cup. While composing each session has Add here. An edit keeps its dialog.
- The Atlas is three columns (ADR-0067): MAPS as a tree at the left (each map under the one it sits in, the open one lit
  with its pin count), ON THE MAP with the layers reading On or Off, and Add a map; the map with its crumbs and line on
  glass; PINS at the right with Add a pin and the map's More (Rename, Map details, who sees it, Add a map inside, Delete
  map). A pin opens as its page in that column with Edit pin, More, and The party's position and Players see it as
  switches; a right-click or a long press on a pin opens its own menu headed by its name. Edit pin is four tabs: Look,
  Links, Encounters and Who sees it, with Done as the Cup. Add a map opens the library's picker, then asks the name,
  kind and where it sits. A phone has the maps as chips and the pins as a sheet; a player's Atlas has no Edit and its
  pin menu only opens things.
- The story's tabs are Chronicle, Timeline, Sessions and Downtime, as words with Filters at the right. Downtime puts the
  characters with their days and the deadlines at the left and the chosen character's downtime at the right, with Log
  downtime as the Cup and what waits to be confirmed above the rows. The chronicle is
  one line of sessions (the next amber, played ones cyan) with their entries; the timeline draws its zoom on a line in
  the horizon gradient with a card under each point; Sessions leads with the next session's card, then the played ones
  two to a row, with PLAN SESSION {n} at the right (360px; Made from as chips with the default chosen, Copies these
  sections, Played on, Create session {n} as the Cup), above the list on a phone. A record pressed on the timeline opens
  in the side column (ADR-0070), kept in `?record=`: Back to Timeline and its kind with More at the head, its date in
  VT323 cyan, its session and who sees it as a word, its text, links and tags, then Edit, Hide from players (or Show to
  players) and Delete. A phone opens it as the tab's page with Timeline as Back.
- Prep templates are one page of three columns (ADR-0070): TEMPLATES as the side list (250px; each with its section
  count, the default marked and a More) and ADD A SECTION under it, the seven kinds with how many the template holds
  (a press adds one at the end and says what it holds); the chosen template in the middle; New session from this
  template and Made from this template at the right (340px). A phone has the templates as chips and reads them.
- The calendar is its own page at `/codex/calendar` (ADR-0070), opened by Edit calendar and the bar's More: Story as the
  crumb with CALENDAR and Saved; CALENDAR (Months, Eras, Weekdays, Year suffix) and DATES (Your date, Players' date) at
  the left; the chosen part at the right with its action, one line and its rows (a month's days in VT323). It saves as
  you go; a change that moves dates players can see waits under the rows with the records it moves, Undo the change
  and Save anyway. Your date keeps its small dialog. A phone has the parts as chips.
- Who sees it is Everyone, Hidden or chosen characters. A field has two audiences, Everyone or Hidden, chosen on its
  own row.
- Links in body text are cyan with a thin line under them. The words are Hidden, Revealed, Reveal, Hide again, See as
  players, Preview and Who sees it.

## The Compendium

- The Titled bar: Compendium, then Home, Browse, Sources and Sharing, with the search, Rules as a Base line control and
  New homebrew as the Cup (ADR-0055).
- Home is shelves: what waits on the GM as a strip with an amber edge under the bell, the nine kinds as cards three to a row (two on a phone)
  with their counts, their homebrew and drafts in magenta and a few records with homebrew first, and the sources on one
  line at the foot.
- Browse is a filter panel at the left (270px) and the table: each choice counts what it would show, the kind's range
  is a small chart with a two-handle range, and the active filters are chips over the table. A phone opens the panel
  as a sheet with Show N at its foot.
- A record opens as three panes (the filters, the results, the record) with the open records as tabs over the record
  only; a folded pane is a 44px edge. The record's parts sit at the right of its title line, never a third row of tabs.
- The studio is one step at a time with each step's answer in the rail, Next as the Cup, and for a copy a preview that
  names what differs from its original.
- Sources puts SOURCES at the left (the SRD, This table, each pack, Import a pack) and the chosen source at the right:
  its name, Export a selection and More, its line, In pickers, BY KIND and NEEDS YOU. Sharing puts KINDS and WHO SEES
  IT at the left and the published records as rows, each with Who sees it as a menu; Choose sets several (ADR-0068).
- A record's History and Sharing keep its card and open their part in a side column: VERSIONS as compact rows (a
  chosen one under the cyan notice with Restore this version, Back to now and Compare with now) and SHARE with a box
  for Everyone and each character and a Cup that says what it will do. Two devices' changes open as a dialog; closed,
  an amber line with Choose stays.
- An SRD record carries a quiet SRD 5.2.1 tag; homebrew carries a magenta Homebrew tag, and homebrew counts are magenta
  wherever they show.

## Phones and touch

Phone and laptop have the same features in the same build. A control that only works with a
mouse is a bug.

- Every interactive control has a hit area of at least `--tap-min` (44px). All `@vtt/ui`
  primitives meet it; compose from them before hand-rolling a control. Map tokens and Codex
  graph nodes are the accepted exceptions: their size is data, and the canvas zooms.
- The one exception outside GM data regions (ADR-0047): on a laptop with a mouse, the character
  sheet's skill rows use `--row-h-dense` (30px) so all eighteen fit at 1280 by 800. Any coarse
  pointer restores 44px.
- Draggable or zoomable surfaces use Pointer Events with `setPointerCapture` and set
  `touch-action: none`. On the encounter map a second finger aborts the gesture in progress and
  commits nothing.
- Every element with `touch-action: none` takes its ref from `useDragSurface` (`@vtt/ui`), which
  cancels its touchmove. Without it, a drag that lifts mid-motion starts a browser fling, and the
  browser spends the next tap on stopping it. `drag-surfaces.test.tsx` fails on a surface without it.
- The page itself never zooms on a touch screen. The zoom guard (`apps/client/src/lib/zoom-guard.ts`) stops a
  stray pinch or double tap, and one finger still scrolls every region. An element with `touch-action: none`
  handles its own fingers, so the battle map and the atlas still pinch to zoom. Settings > Device has "Let pinch
  zoom the page" for anyone who needs the page larger, off by default and kept per device.
- On a touch screen every field a person types in or picks from is at least 16px (`--fs-field-touch`), because
  iOS zooms the page into a focused field with smaller text. The floor in `design-tokens.css` sees to it, so a
  field's own rule may stay smaller for a laptop.
- A phone has no top bar: five bottom tabs (the sections and More) on every screen, and a header row that belongs to the
  page. Dialogs, confirms and the rules reference open from the bottom, under the thumb.
- A focused input inside a locked region must stay visible above the on-screen keyboard.
- `prefers-reduced-motion` freezes animations and skips the light; reduced transparency replaces
  blur with a solid surface.

## Writing

Say what the control does or what belongs in the field, and nothing else.

- Plain second person, sentence case. Errors say what happened and how to fix it.
- No scene-setting or roleplay voice in UI copy, including the Codex.
- No em dashes in anything a user reads. Use `·` between label fragments and "None" for an
  absent value.
- No ellipsis placeholders, except where it means "opens a dialog" or "in progress".
- No exclamation marks and no questions outside a confirm dialog.
- No filler such as "simply", "just", "easily", "lets you" or "note that". A hint that carries
  no information is deleted.
- Hints, messages and help text are complete sentences. Labels, chips and status lines may be
  fragments joined with `·`.
- Say what is true without setting it against what isn't: no "X, not Y", "X rather than Y",
  "X instead of Y" or "not only X but also Y".
- No three-part rhetorical series ("fast, simple and safe"). When there are three things to
  say, use two sentences or a list.
- Never tell the reader that something is important or worth noticing. State the fact.
- No clause tacked on with "-ing" at the end of a sentence ("..., turning the hit into a miss").
  Write a second sentence with its own subject and verb.
- Plain words: use, get, start, end, help, show, is, has. Avoid comprehensive, crucial,
  enhance, leverage, robust, seamless, streamline, utilize and vital.
- Refer to a character by name. The app doesn't know a character's pronouns, so copy never says
  "he", "she" or "her": "Roll for Lyra", "Damage waits on Lyra's reaction".
- Straight quotes and apostrophes. No emojis.
- Rules words follow SRD 5.2.1: "level 3 spell slot", "Bonus Action", "saving throw".
- The same rules apply to code comments.

`apps/client/src/writing.test.ts` checks the rules a pattern can find on every string a person reads, in the client,
the UI kit, the server messages and the OpenAPI descriptions. It checks the product's own summaries and descriptions
in the SRD bundles too; the SRD text they quote is left as published. It also fails on an em dash, an en dash or a curly quote
anywhere in the code, comments, tests and docs; code that has to match one writes its escape (`\u2014`). Each exemption
in that file carries its reason. Contrasts, "-ing" clauses and three-part series are left to review.
