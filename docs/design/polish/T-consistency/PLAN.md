# T. Consistency: building the shared parts

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan builds the shared parts once in the kit and makes every surface already on the
branch use them: the side list, a title row's crumb, a menu's head, a phone sheet's head with its handle (the first
sweep), then one Cup in view, the phone header, a list's toolbar, fields, and states and kinds (the second sweep), then
buttons and hit areas, rows and the controls in them, and steps, overlays, type, colour, dates, empty states and copy
(the third sweep), then one eyebrow, one notice, title sizes and the last hit areas (the fourth sweep), then Dawn's
coloured words, one tag, one close, one stepper, tabs, fields and lamps (the fifth sweep). It adds no rules engine work,
commands, routes, projections or data. File paths and line numbers were read at `f5e166f`; other pieces land on the same
branch first or alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start
with `packages/`, `apps/server/`, `e2e/` or `docs/`.

`SPEC.md` beside this file is what was decided; rules 13 to 21 of `../T-theme/SPEC.md`, with the second sweep's
amendments to rules 2, 9, 12, 13 and 14, the third sweep's to 2.2, 2.5 and rules 2, 7, 8, 9, 10 and 11, and the fourth
sweep's to 2.2, 2.4, 2.5 and rules 8, 9, 19 and 20, and the fifth sweep's to 2.2, 2.4, 2.5 and rules 4, 9 and 19, are
the rules. This plan is how to build them.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in fourteen phases, O0 to O13,
  each about one commit.
- The reference is `consistency.html` in this folder: every side list, title row, menu, phone sheet, dialog, section
  bar, phone header, tab row, toolbar, field and tag as the approved mockups draw them, a cyan number on each one a fix
  changed. Each area's own approved mockup shows its parts in place. `history/1-sweep.html` to `history/5-sweep.html`
  are the sweeps as they were shown; `history/3-before-after.html` sets each of the third sweep's fixes before and
  after, and `history/4-sweep.html` and `history/5-sweep.html` each of the fourth's and the fifth's.
- Order: run O0 to O12 after the theme's T1 to T3 and A's dialogs and menus (A6), and before or alongside the areas.
  Each phase builds its part in the kit, then converts every surface that is already on the branch. A surface that is
  not built yet is left to its own piece: its spec now draws it this way and its plan uses the kit's part. List the
  surfaces you converted and the ones you left in each phase's commit body.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

`SPEC.md` section 2 has the detail. In short:

1. One side list: an eyebrow with no count, rows of icon or face, name and count, the chosen lit; trees by indent.
2. A crumb sits before the title on its line, with the back chevron.
3. A menu about one thing opens with its name in display capitals and its line; a menu of choices keeps its eyebrow.
4. A phone sheet opens with the handle, then its title and the close over a hairline.
5. The Atlas: MAPS without a count; a map's row has the map icon and its pin count; what the map is goes in its line.
6. People in a side list carry their face at 20 px; a row that filters (All, a status, a view) has no icon.
7. One Cup in view: the section bar's New steps down to a Base line button when the page shows its own; the bar keeps
   its search; the Cup is words only.
8. A phone header names the section on a section's page, and Back with where it goes on a record.
9. A list has no title row; its toolbar counts in plain words and sorts with the sort icon and its word.
10. A choice field's caret sits at its right end; a find field has its icon and a muted placeholder.
11. A state is a boxed tag, a kind its icon and word, readiness a lamp and words; who sees something is never magenta.
12. Settings' groups are Cradles, with no box inside them.
13. On a phone every control's face is 44 px; on a laptop a Base line button or icon button is 36 px with `.tap-target`.
14. Danger is `--danger-text` on the Base line; the ghost is only Cancel or Back beside a Cup; the Cup is words only.
15. An icon button in content sits on its Base line; a row's More is its dots.
16. Menu rows 48 px (52 in a phone sheet), table rows 48 px, phone rows at least 44 px; one switch; ticks for several.
17. One Steps rail; every phone sheet carries the horizon; heads inside a page are eyebrows.
18. A harmful condition is red; dates read "Oct 30, 7:40 PM"; empty states offer their button; characters by name.
19. One GM ONLY tag, on what only the GM sees where players also look; Settings' column 880 px; reading 680 px.
20. One eyebrow everywhere; a dialog's and a phone sheet's title 20 px; a title row 24 px, 20 px on a phone.
21. One notice: a frame with a 3 px edge in its meaning's colour, no fill; a card never carries the horizon; a state's
    colour follows its meaning.
22. Steppers, toolbars, add links and a chip's × meet the phone's 44 px too; Base line buttons stand 6 px apart.
23. Amber, magenta and violet words take text shades that pass in Dawn; lamps, edges and fills keep the colour.
24. One tag (VT323 16 px in 22 px), one close (18 px in 40 px, 44 px on a phone), one stepper (40 px, 44 px on a phone),
    one step mark (24 px), one kind card, one lamp (8 px); a tab 44 px; a form field 40 px; Saved is a lamp and its
    word.
25. A title that opens a record or a pane is 22 px, 20 px on a phone; a bar you act in is a Cradle.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3 and A6. If one is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. If any step seems to need a server, schema, command, route or projection change, stop and
  tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area; phones are first-class.
- A part in the kit takes words and slots from its caller; it never decides who sees what. Keep each surface's own
  visibility checks where they are.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

- The kit: `packages/ui/src/primitives/Menu.tsx` (134 lines: `Menu` on `<details>`, `MenuItem`; no head), `Modal.tsx`
  (118 lines: `title`, `footer`, `size`, `align` with `bottom` for a phone's drawer; `Modal.css` 149 on: the full-screen
  sheet at 760 px and under), `Drawer.tsx` (57 lines: `title` and its close; `Drawer.css` 107 on: full width at 760 px
  and under). No side list, crumb or sheet handle in the kit.
- Menus about one thing today: `scene/TokenContextMenu.tsx` (its head and close), `scene/DoorMenu.tsx` (the title Door),
  `encounter/FightMenu.tsx`, `sheet/SheetMenu.tsx`, `codex/shell/GmMenus.tsx`. C2's plan adds `scene/MapMenu.tsx`, which
  takes the thing's title and line; E2, F3 and C3's running round add the menus in 1.3.
- Side lists today: none share a component. E2's plan (K1) adds the folders column, F's finding and pages (N2) the
  index's side list, and later pieces point at those; I's leftovers (U1) redraws Settings' list.
- Title rows: each record's area designs its own (T 2.2, `T-theme/PLAN.md` T4).

## 4. The design

| Part             | New or changed                                                                   | Built from                   |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| `SideList`       | New in the kit: an eyebrow, rows with a leading slot, a count, a chosen row      | K1's folders, N2's side list |
| `Crumb`          | New in the kit: the chevron and a label, a link back, set inline before a title  | T 2.2's title row            |
| `MenuHead`       | New in the kit: a name in display capitals and its line                          | C2's `MapMenu` head          |
| The sheet's head | Changed: `Modal` and `Drawer` on a phone draw the handle above title and close   | `Modal`, `Drawer`            |
| `SectionBar` end | Changed: its New takes `stepDown`; the search always shows                       | T 2.1's Titled bar           |
| `PhoneHeader`    | Changed: a `back` target with its words, or the section's name                   | A 2.2's header row           |
| `ListToolbar`    | New in the kit: find field, count, filters, sort, action                         | Prep's and Maps' toolbars    |
| `ChoiceField`    | Changed: the caret at the right end; `FindField` its icon and muted placeholder  | T4's fields                  |
| `Kind`           | New in the kit: an icon and a word, beside the state `Tag` and the `Lamp`        | F's `KindChip`               |
| Touch faces      | Changed: on the phone shell every control's face is `--tap-min`                  | `design-tokens.css`          |
| `Button`         | Changed: `ghost` only beside a Cup; `destructive` on the grey base line          | T plan 4.2                   |
| `IconButton`     | Changed: `.nh-iconbtn--base` in content, 36 px                                   | T plan 4.2                   |
| `Menu`, tables   | Changed: rows 48 px, 52 px in a phone sheet                                      | A 2.4's menu                 |
| `Switch`, ticks  | Used everywhere: one switch; ticks for picking several                           | `Switch`, `Checklist`        |
| `Steps`          | Changed: Prep's marks and cyan edge                                              | E's rail                     |
| `formatWhen()`   | New in `apps/client/src/lib/`: one way to write a date and its time              | T rule 20                    |
| `Eyebrow`        | Changed: one style for a group's head, a table's column heads and a fact's label | T 2.4                        |
| `Notice`         | New in the kit: a frame with its meaning's 3 px edge, no fill                    | G's Needs you                |
| Titles           | Changed: `Modal` and `Drawer` titles 20 px; `PageHeader` 24 px, 20 px on a phone | T 2.2                        |
| Text shades      | New tokens: `--caution-text`, `--magenta-text`, `--violet-text`, darker in Dawn  | `--danger-text`, T rule 9    |
| `Tag`            | Changed: every tag VT323 16 px in a 22 px box, conditions and sources included   | T rule 7                     |
| `IconButton`     | Changed: a dialog's or sheet's close is plain, 18 px in 40 px, 44 px on a phone  | A's dialog head              |
| `Stepper`        | Changed: 40 px, 44 px on a phone, its number VT323 22 px, the minus sign         | T 2.5                        |
| `Tabs`, fields   | Changed: tabs 44 px with 14 px words; form fields 40 px, 44 px on a phone        | T 2.5                        |
| `Lamp`, marks    | Changed: a lamp 8 px; a step's mark 24 px with VT323 17 px                       | T rule 4, rule 19            |
| `KindCard`       | New in the kit: icon and name, the count in VT323 30 px, its line                | F's Codex home               |

How the parts fit, so the phases agree:

- `SideList({ groups })`: each group an eyebrow (text only, so it can't carry a count) and rows; a row takes `leading`
  (an icon, or a face at 20 px), `label`, `count` (a number or a short state such as On, drawn in VT323), `depth` for a
  tree, `current`, and `onSelect` or `href`. Rows are buttons or links with `aria-current` on the chosen one. On a phone
  the caller decides between the list as the first page (rows 48 px through the kit's touch density) and chips.
- `Crumb({ to, label })`: a link with the back chevron in the crumb's label type. A title row renders it inside the same
  line as its `h1`, before the title text; a phone's record may stack it.
- `MenuHead({ name, line })`: the first child of a `Menu` or `MapMenu` about one thing. Menus of choices keep an eyebrow
  head.
- The handle is drawn by `Modal` and `Drawer` themselves when they present as a phone sheet (`align="bottom"`, or 760 px
  and under), above the title bar, which already holds the title and close. A sheet whose title is a thing (a creature,
  a party member) passes its head as `title`.
- The section bar's New: the page tells the bar whether it shows its own Cup (`stepDown`); the bar draws New as the Cup
  or as a Base line button with its +. A page with two of its own passes `stepDown` to its title row's Cup as well. A
  dialog's Cup doesn't count.
- `PhoneHeader({ title } | { back: { to, label } }, icons)`: a section's page passes the section's name; a record passes
  where Back goes. A record's page drops the strip and opens with its title and line.
- `ListToolbar({ find, count, filters, sort, action })`: count is a phrase in plain words; sort is
  `{ icon: "sort", label }`; action is a Base line button.

## 5. Phases

### O0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `T-consistency/`, and replace
   `T-theme` and every area folder (the third sweep changed all 23 approved mockups; `D1-character-sheet` is unchanged).
2. Add `T-consistency/ADR-0072-shared-parts.md` as `docs/adr/0072-shared-parts.md`,
   `T-consistency/ADR-0073-shared-parts-second-sweep.md` as `docs/adr/0073-shared-parts-second-sweep.md` and
   `T-consistency/ADR-0074-shared-parts-third-sweep.md` as `docs/adr/0074-shared-parts-third-sweep.md`, Accepted, and
   their rows to `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### O1: one side list

1. `packages/ui/src/primitives/SideList.tsx` and `SideList.css` as section 4 says, exported from the kit. If K1 or N2
   already built a side list on the branch, move it into the kit as this component rather than writing a second one.
2. Convert every side list on the branch to it. For the Atlas: MAPS without a count, the map icon and the pin count on
   each row, what the map is in its line on the map's glass. For the Downtime tab: each character's face at 20 px.
3. Tests: `packages/ui` (rows render label, count and leading slot; the chosen row has `aria-current`; depth indents;
   the eyebrow takes text only) and each converted surface's own test still passes.

### O2: the crumb on the title's line

1. `packages/ui/src/primitives/Crumb.tsx`, exported from the kit.
2. Every title row with a way back renders its crumb inside the title's line: records (an encounter, a map, a Codex
   page, a Compendium record) and pages (Prep templates, the calendar, a screen's remote, an operation, a credential).
3. Tests: one title row per area finds the crumb and the title in the same heading line; the crumb's link goes back.

### O3: a menu that names its thing

1. `MenuHead` in `packages/ui/src/primitives/Menu.tsx`; C2's `scene/MapMenu.tsx` uses it for its head.
2. Every menu about one thing opens with it: a token's, a door's and a drawing's menus (C2), a pin's (F3), a map's in
   Maps and a creature's in Tokens (E2), the encounter's options (C3, its first group renamed How it runs). Menus of
   choices keep their eyebrow.
3. On a phone a menu that opens from the foot keeps the same head.
4. Tests: each converted menu's head shows the name and line; the encounter's options list How it runs.

### O4: one way a phone sheet opens

1. `Modal` and `Drawer`: when presented as a phone sheet, draw the handle (40 by 4 px, `--line-raised`) above the title
   bar; the title bar keeps the title at the left and the close at the right over a hairline.
2. Every phone sheet on the branch goes through them: a creature's tools and the encounter's options (C3), the dice
   options (C5), Level up and a party member (D; the party member's Close at the foot goes), the token picker (E2), a
   replay's actions (E3), adding a section (F), the Compendium's filters (G), two devices (G's pages), New credential
   (I). A sheet that draws its own head today moves it into `title`.
3. Tests: `behaviour.test.tsx` (a bottom Modal and a phone Drawer render the handle and a close named Close); the smoke
   suite's phone journeys open one sheet and find both.

### O5: one Cup in view

1. The section bar's end: the search on every page of a section, New as the Cup or, with `stepDown`, a Base line button
   with its +. The Cup is words only: drop the + from New credential and New homebrew.
2. Every page that shows its own Cup passes `stepDown`: the Codex's home, a page being written, revealing, a faction's
   standing, adding to the chronicle, downtime, editing a pin, the templates; the Compendium's records, its editor and a
   record's sharing; Prep's encounter, sound and replays. Where a page shows two of its own (the Compendium's editor, a
   record's sharing), its title row's Cup steps down too. Quests' New quest becomes a Base line button.
3. Prep's bar on Sound and Replays gets its search and New encounter back.
4. Tests: one test per area that a page with its own Cup draws the bar's New as a Base line button and shows one Cup.

### O6: what a phone header names

1. `PhoneHeader` as section 4 says. A section's page (the Atlas, the story) names the section; a record (a Codex page,
   an entry, a Compendium record, a screen, a replay) shows Back and where it goes, no strip, and its title and line at
   the top of its content; the stacked crumb on a Codex page goes.
2. Tests: a record's phone header names where Back goes and has no strip; the Atlas's names CODEX.

### O7: a list's toolbar, fields, states and kinds

1. `ListToolbar` in the kit; every list's toolbar uses it ("6 maps", "4 people", "2 active quests", "3 maps in Act 1",
   "8 of 332", "5 replays"), sort as its icon and word. Replays loses its title row.
2. `ChoiceField` puts the caret at its right end; `FindField` draws its icon and a muted placeholder (the API
   reference's field gets its icon).
3. `Kind` in the kit; a map's page shows its kind in its line as the map icon and its word.
4. A replay's eye: the dim text colour when players see it, violet and struck through when only you do. A player's menu
   button is the face alone.
5. The story's tabs are four (Downtime included) on every story page, a phone's as tabs; the Codex bar has More after
   New.
6. Tests: the toolbar's count and sort, a choice field's caret, a find field's icon, the replay eye's two colours.

### O8: buttons and hit areas (third sweep)

The third sweep's anchors were read at `beb0637e` ("Play a character at the table"); confirm each before editing.

1. Phones: on the phone shell (the query `AppBar.tsx` uses), `Button`, `IconButton`, `Chip`, `SegmentedControl`'s
   options and the Cup take a 44 px face, the phone header's icons and a sheet's close 44 by 44. One rule beside
   `.tap-target` in `packages/ui/src/styles/design-tokens.css` (729 on) sets the face from `--tap-min`; nothing on a
   phone relies on `.tap-target` alone.
2. Laptop: a Base line button and an icon button have a 36 px face with `.tap-target`. The table's panels' buttons and a
   session's template chips grow from 34 px.
3. The ghost: `Button`'s `ghost` variant is for Cancel and Back beside a Cup. Every Dialog foot and step foot uses it;
   Rotate, History, Token image, Clear, Clear all, Show all, Open the sound board and a screen's Open become
   secondaries.
4. Danger: the `destructive` variant draws `--danger-text` on the grey base line, lit red on hover (T plan 4.2 changes
   to match). Sign out every GM browser, Revoke (the credentials' table, a credential's page), Revoke this screen and
   Release use it. A menu's delete is a `MenuItem` in `--danger-text` with the bin icon (Delete pin, Delete replay,
   Delete page).
5. Icon buttons in content take `.nh-iconbtn--base` (T plan 4.2): a row's More (the dots, Settings' players included),
   sound's rows and player, replays' eye, the Compendium's pane chevrons. Overlay heads and headers keep plain icons.
6. The Cup is words only: arrival's Cups lose their arrow. A Cup that opens a menu (the Codex's New) keeps its caret.
7. Tests: `behaviour.test.tsx` (on the phone shell a `Button`, an `IconButton` and a segment measure at least 44 px; a
   `destructive` button carries `--danger-text`), one test per converted danger action, and the smoke suite's phone
   journeys measure one control in each frame.

### O9: rows and the controls in them

1. Menus: `Menu.css` rows 48 px, 52 px in a phone sheet. Tables: every table's rows 48 px, on a phone too.
2. Phone rows at least 44 px: the Codex's lists, the Compendium's filter options, replay steps, a faction's tiers.
3. Switches: the kit's `Switch` is already the 46 by 26 track with a 44 px hit area (`Switch.css` 34 to 57); every page
   that draws its own (arrival's Keep me signed in, sound's Shuffle, the Codex's See as players, the templates' Default)
   uses it.
4. Ticks for picking several: Settings' scopes, its ability score methods and the rules assistant's checks become ticks
   (the kit's `Checklist`, or a tick in `forms.tsx` if the list needs its own layout). One setting stays a `Switch`.
5. The phone table's switch is the `SegmentedControl` on base lines with no well, as C draws it.
6. Tests: a menu row and a table row measure 48 px; Settings' scopes are checkboxes; the phone switch has no well.

### O10: steps, overlays, type, colour, dates, empty states and copy

1. `Steps.tsx`: done a solid cyan box with a dark tick, the current step a 3 px cyan edge and 2 px cyan outline, a
   choice needed a solid amber box. The character builder and Level up use it.
2. `Modal` and `Drawer` as a phone sheet carry the horizon on their top edge; a creature's tools, the encounter's
   options and the dice options go through them.
3. Type: the roster's names in Bai Jamjuree 600; a step's or a column's head is an eyebrow (a new encounter, the grid,
   the Compendium's editor, the calendar).
4. Colour: a harmful condition is a red tag, as on the table; the timeline's entries take a `--line-raised` edge, cyan
   when chosen; the API reference's GET and POST tags are the dim text colour.
5. Dates: a `formatWhen()` helper in `apps/client/src/lib/` writes "Oct 30, 7:40 PM" and "Today, 8:41 PM", with the year
   only when it isn't this one. Version history, a record's history, replays, the credentials and their history use it;
   today each surface formats its own. A chip's count follows its label after a space ("All maps 6").
6. Empty states: the Atlas's pin list says "No pins on this map yet." with + Add a pin; the Compendium home's empty
   kinds offer + New homebrew.
7. Copy: characters by name in C3's prompts, the GM panel's waiting lines and replays' step text; an empty choice field
   shows None; leaving a making flow with its draft kept is Done.
8. The GM ONLY tag: one size, VT323 16 px in a 22 px box (`Tag.tsx`), the log's included; no Prep or Settings section
   adds one.
9. Widths: Settings' column 880 px beside its side list; the Codex's reading measure 680 px.
10. Tests: `formatWhen()` (today, this year, another year); the rail's three marks; a phone sheet's horizon; the pronoun
    lines name the character (`writing.test.ts` leaves pronouns to review, so these get their own assertions).

### O11: eyebrows, titles, notices and the last hit areas (fourth sweep)

1. `Steps.tsx`: a step's styles reach only the step, so its mark keeps its own 20 px box (Level up showed the slip).
2. One eyebrow: every table's column heads, a fact's label (`dt` in the facts lists), a stat's label, a log's round line
   and a lamp's label use the kit's eyebrow class: 11 px capitals, 0.12em, 600, `--text-muted`. Crumbs keep theirs.
3. Titles: `Modal`'s and `Drawer`'s titles 20 px; `PageHeader`'s title 24 px, 20 px on the phone shell.
4. `Notice` in the kit: a frame of its colour over `--line-strong`, a 3 px edge at its left, no fill, `--text`. The
   reconnecting band, a version you are reading, a record or downtime that waits, and the note on who sees a stat block
   use it; the dashed violet block stays for hidden content.
5. Chips and buttons: the Compendium's filter chips and its open records button on Base lines; Mark used, Own tab, a
   replay's chips and Watch, tag chips and linked chips at 36 px; Base line buttons side by side 6 px apart.
6. Phones: steppers, `SegmentedControl` options in a dialog, the editor's toolbar, an add link and a chip's × meet
   `--tap-min`; the rows of an encounter's sound, a record's sharing options and Settings' scopes and switches are at
   least 44 px. A menu's divider sits inside its 48 px row.
7. Headers: the Atlas's pin editor on a phone uses `PhoneHeader` with Editing and no strip; a faction's page passes
   `back` to Pages.
8. Dates: `formatWhen()` serves a date field's value as well ("Nov 8"); the replays list drops this year's year.
9. A state's colour: `Tag`'s states are the dim text colour, cyan while live or active; SAMPLE is a state.
10. Tests: a step's mark measures 20 px; an eyebrow, a modal title and a page title measure their sizes; `Notice`
    renders its edge in each meaning; on the phone shell a stepper and a chip's × measure 44 px.

### O12: Dawn's coloured words, tags, closes, steppers and the smaller parts (fifth sweep)

1. Text shades: `design-tokens.css` gains `--caution-text`, `--magenta-text` and `--violet-text`, the colours in Dusk
   and `#875400`, `#a3246b` and `#6a44bf` in Dawn. Every rule that colours a word amber, magenta or violet uses the
   shade; lamps, edges and fills keep the colour.
2. `Tag`: one size, VT323 16 px in a 22 px box, for a state, a condition, a source, a folder, CLAIMED, GET and POST. A
   template's parts are `Kind`s; a hashtag is the pages index's chip.
3. Closes: `Modal`'s and `Drawer`'s close is a plain icon, 18 px at a 1.7 stroke, 40 px, 44 px on the phone shell; the
   dice options use it in place of Done. A toast's close is a 36 px square.
4. Steppers: 40 px, 44 px on the phone shell, the number VT323 22 px, minus as U+2212. Tabs 44 px with 14 px words; the
   bar's search 38 px; a form field 40 px, 44 px on the phone shell; a lamp 8 px; a step's mark 24 px with VT323 17 px;
   a content button's icon 15 px at 1.8.
5. `KindCard` in the kit: the Codex home and the Compendium home use it. The frame's turn order draws the table's 38 px
   faces. Inside its record the stat block drops its name.
6. Cradles: the Codex's date bar and the Compendium's Sources line; Recently changed is an open group. The ruling card's
   rim is amber. Saved is a `Lamp` and its word.
7. Titles: a title that opens a record or a pane is 22 px, 20 px on the phone shell. The eyebrow reaches the template's
   field labels, the timeline's heads, the downtime's counters and the call for a roll's status words.
8. The table screen's phone pages stack the phone header and Prep's strip. The Dusk and Dawn switch is 36 px segments.
9. Tests: the three shades pass 4.5:1 on Dawn's grounds; a tag, a close, a stepper, a tab, a field and a lamp measure
   their sizes, on the phone shell too; the template's drag handle measures 44 px on a phone.

### O13: docs and cleanup

1. `docs/DESIGN.md`: rules 13 to 21 in the theme's rules with the amendments to 2, 9, 12, 13 and 14, to 2.2, 2.5, 2, 7,
   8, 9, 10 and 11, to 2.2, 2.4, 2.5, 8, 9, 19 and 20, and to 2.2, 2.4, 2.5, 4, 9 and 19; the side list, the crumb, the
   menu's head, the sheet's head, the section bar's step-down, the phone header, the list toolbar, the fields and `Kind`
   in the kit's section; in Components, the ghost and destructive buttons, the icon button on its base line, the phone's
   44 px faces, menu and table rows, the Steps rail, dates, the eyebrow, `Notice`, title sizes, the text shades, `Tag`,
   closes, steppers, tabs, fields, lamps and `KindCard`. `docs/ARCHITECTURE.md` only if a file moved.
2. `docs/adr/README.md`: 0072 to 0076 Accepted and built. `docs/design/polish/CATALOG.md`: the consistency line moves to
   Built.
3. Remove what nothing uses: each surface's own side list styles, crumb styles, menu heads, sheet handles, toolbars,
   phone headers, switches, danger and ghost styles, date formatting, eyebrow and notice styles, and each surface's own
   tag, close, stepper, tab, field and lamp sizes.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- Look in Dusk and Dawn, against `consistency.html`:
  - 1280 by 800 with a mouse: every converted side list, title row, menu, section bar, toolbar and field side by side
    with another of its kind; one Cup in view on every page.
  - 390 by 844 with touch: every converted sheet (handle, title, close of 44 px), side lists as their first pages or
    chips, every record's header (Back and where it goes), no sideways scroll.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- Dialogs on a laptop already share A's head; nothing changes there.
- Group headers inside a page keep their counts ("Deadlines · 3", "Pins · 5"); rule 13 is about a side list's eyebrow.
- The table panel's tabs in A's and C's frames: the Token tab shows only while a token is chosen (C rule 8), and the
  bell and counts only when something waits or is unread.

## 8. Departures from the mockups, on purpose

- The mockups draw each part inside each area's own CSS; the app builds each once in the kit.
- The mockups' data is invented; the app reads its own.

## 9. Where each idea lives in the mockups

- The side list: `.u-rail`, `.u-ri` in `p4h-f2.css` of any piece that has it; Settings' version as `.i-rail.m` and
  `.i-plist.m` in `I-settings/mockup-src/p4j-set.css`; the Atlas tree in `F3-atlas/mockup-src/p6-body5.js` (`mixLeft()`,
  `MAPLINE`).
- The crumb: `.e-crumb` inside `.e-rec h1` (`p4f-prep.css`, `p4g-codex.css`); Time and tools' `toolLap()` in
  `F-time-tools/mockup-src/p6-body6.js`.
- A menu's head: `.z-mtitle` in `C2-map-menus/mockup-src/p4p-c2.css`; `.u-mt` (F3), `.x-mt` (E2), `.q-mt` (C3's running
  round).
- A sheet's head: `.grab2` with `.k-lhead` (C3, C5); `.d-sheetpop .grab` (D); the handle on `.ap.is-phone .e-dlg::after`
  in `p4f-prep.css` (E2, E3, F, G); `.i-grab` (I).
- One Cup in view: `oneCup()` in each Codex, Compendium, Prep sound and replays, and table screen mockup's `p6-tail.js`
  steps the bar's New down after the page renders; Prep's bar end is `prepEnd()` in those mockups' `p6-head.js`.
- The phone header: `ph()` in the Codex mockups' `p6-head.js` (its `rec` option); `recPhone()` in
  `G-compendium-pages/mockup-src/p6-body2.js`; the screen's remote in `H-table-screen/mockup-src/p6-body.js`.
- A list's toolbar: `tool` and `tb()` in the Codex mockups' `p6-body2.js` and `p6-body3.js`; `listHead()` in
  `E3-replays/mockup-src/p6-body3.js`; `railList()` in `E2-maps-tokens/mockup-src/p6-body3.js`.
- Fields: `choice()` in `E2-maps-tokens/mockup-src/p6-head.js`; `.e-caret` and `.e-field.hint` in `p4f-prep.css`.
- A kind: `.x-kind` in `E2-maps-tokens/mockup-src/p4g-e2.css`. A replay's eye: `.r-eye` in
  `E3-replays/mockup-src/p4m-replay.css`.
- Phones' 44 px faces: `mockup-src/p4t-touch.css` in every approved mockup. Ticks for several: `tick()` in
  `I-settings/mockup-src/p6-head.js`. Settings' Cradle: `.i-grp::before` in `p4j-set.css`. A phone sheet's horizon:
  `.P .k-sheet::before` in `p4l-c3.css`. The switch: `.e-sw` in `p4f-prep.css`, `.sw` in `p4-spec.css`.
- One notice: G's Needs you band (`grp("Needs you · 2", ...)` in `G-compendium/mockup-src/p6-body.js`), `.z-wait` in
  `p4l-atlas.css`, `.g-note` in `p4h-comp.css`, `.u-band` in `p4h-f2.css`, `.band.wait` in `p4b-frame.css`, `.w-armed`
  in `p4n-c5.css`. One eyebrow: `.ahead` in `p4c-table.css`, `.g-th` in `p4h-comp.css`, `.f-facts dt` in
  `p4g-codex.css`, `.d-facts dt` in `p4d-chars.css`. The pin editor on a phone: `mixEdit()` and `pinEditPageM()` in
  `F3-atlas/mockup-src/p6-body5.js`.
- The fifth sweep: the shared values in `mockup-src/p4v-parts.css` in every approved mockup; the text shades in each
  `mockup-src/p1-head.html`'s three token blocks; the table screen's phone page in `pageBehind()` in
  `H-table-screen/mockup-src/p6-body.js`; the frame's turn order in `A-frame/mockup-src/p6-frame.js`.
- `consistency.html` is built from captures of the approved mockups by `mockup-src/capture.js` to `capture5.js`; it is a
  picture of them, not a mockup of its own.
