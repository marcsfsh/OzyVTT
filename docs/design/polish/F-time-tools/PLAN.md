# F Time and tools: building them

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan makes prep templates one page with the templates and the kinds of section in
the settled side list, adds Plan session to the story's Sessions tab, makes the calendar its own page, opens a timeline
record in the story's side column, and moves the Codex's backup and saving tools into Settings. It adds no rules,
commands, routes, projections or data. File paths and line numbers were read at `f5e166f`; the theme (T), the frame (A),
the Codex's frame (F), the story (S) and Settings (I) land on the same branch first or alongside, so confirm every
anchor before editing. Paths are under `apps/client/src/` unless they start with `packages/`, `apps/server/`, `e2e/` or
`docs/`.

This is F4.4, F4.6 and F6.1 to F6.4 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how
to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in eight phases, Z0 to Z7, each
  about one commit.
- The reference is `time-and-tools.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything
  else is inline). It opens on the approved choices. Use the Page switch (Templates, Editing one, A session from one,
  The calendar, A record, The tools). A session from one and The tools have a sixth button, the owner's mix. The other
  options are the ones the owner turned down; build only the chosen ones. `history/1-round-1.html` is the round as it
  was shown, with the replays check the owner confirmed.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code and its campaign is invented.
  Build with the existing components, hooks and primitives, and with the settled ones (the side list E2 and G built, F's
  side column, Settings' frame and rows, A's dialog). Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Prep templates: one page, the templates and the kinds of section in the side list, the template in the middle,
   today's panel at the right.
2. Editing: drag or press a kind to add a section; rows reorder as today.
3. A session: today's panel, and Plan session on the Sessions tab.
4. The calendar: its own page with its parts in the side list.
5. A timeline record: in the story's side column.
6. The tools: in Settings, a Codex group with each tool its own row.
7. Eight rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, A's dialogs (A6) and the kit's menu, the Codex's frame (F1 to F4, with the bar's More), F's
  finding and pages (N3, the side column's swap), the story (S1 to S5) and Settings (I1 to I3). The side list is the one
  E2 (K1) and G's pages (X1) build; if it is not yet a shared component, make it one here. If a piece this needs is
  missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays: `GET POST /api/v1/codex/prep-templates`,
  `DELETE PATCH /api/v1/codex/prep-templates/{id}`, `.../default`, `.../duplicate`, `GET POST /api/v1/codex/sessions`,
  `POST /api/v1/codex/sessions/{id}/apply-template`, `GET PUT /api/v1/codex/calendar`, `.../check`, `.../publish`,
  `.../unpublish`, `PATCH /api/v1/codex/journal/{id}`, `.../reveal`, `GET /api/v1/codex/export`,
  `POST /api/v1/codex/import`, `GET PUT /api/v1/codex/settings` and `DELETE /api/v1/codex/page-revisions`. If any step
  seems to need a server, schema, command, route or projection change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

- `codex/templates/TemplatesView.tsx` (469 lines): `TemplatesView` (40), the cards (130, with Rename, Duplicate, Set as
  default, Delete), `NewSessionFromTemplate` (299), `MadeFromTemplate` (404, Re-apply). A phone reads only.
- `codex/templates/TemplateEditor.tsx` (248 lines): the editor (94), Default for new sessions, Duplicate, Save, Add a
  section's menu of kinds, the section rows (150 to 215) with the handle and Alt and an arrow key.
- `codex/prep/sections.ts`: `SECTION_TYPES` (4), each kind's label and what it holds.
- `codex/story/Sessions.tsx`: `SessionRows` (125), `StoryBar` (286). `codex/story/SessionPage.tsx`: Re-apply a template
  (254).
- `codex/CalendarEditor.tsx` (395 lines): `CalendarEditor` (132, the dialog), `CampaignDateEditor` (340, Your date).
  `codex/shared/DateBar.tsx` (186 lines): Edit calendar (139).
- `codex/story/sections.tsx` (1004 lines): `RecordDialog` (180), `useRecordCard` (196), `GmPhoneStory` (300).
- `codex/BackupView.tsx` (247 lines): `BackupView` (14). `codex/CodexSettings.tsx` (298 lines): `CodexSettingsView`
  (19).
- `settings/SettingsPage.tsx`: `SettingsPage` (60), the side list from I.
- `compendium/player/CodexCompendium.tsx` (163 lines): a player's Compendium in the Codex.
- Tests: `codex/templates/*.test.tsx`, `codex/shared/pieces.test.tsx` (the date bar), `codex/story/*.test.tsx`,
  `settings/*.test.tsx`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                   | New or changed                                                         | Built from                                  |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| The templates page     | Changed: cards become the side list; three columns                     | `TemplatesView`, the side list              |
| Add a section by kind  | Changed: the menu becomes the side list's ADD A SECTION, drag or press | `TemplateEditor`, `SECTION_TYPES`           |
| Plan session           | New: a card on the Sessions tab                                        | `NewSessionFromTemplate`                    |
| The calendar page      | Changed: the dialog becomes a page with its parts at the side          | `CalendarEditor`, the side list             |
| A record in the column | Changed: the dialog becomes the side column's swap                     | `useRecordCard`, F2's swap                  |
| The tools in Settings  | Changed: two pages become a Codex group of rows in Settings            | `BackupView`, `CodexSettingsView`, I's rows |

How the parts fit, so the phases agree:

- The templates page keeps its address, `/codex/templates/{templateId}`. Its side list reads the template library; the
  kinds' counts are the chosen template's sections by type.
- Dragging a kind uses the same reorder the rows use; a drop inserts a section of that kind at the place, a press adds
  it at the end. Both go through the template's existing save.
- The calendar page is `/codex/calendar?part=months|eras|weekdays|suffix|dates`; Edit calendar and More open it. It
  saves through today's `PUT /codex/calendar`, after today's check (`POST .../check`) shows the warning when dates move.
- A record in the side column is `?record={id}` on the story's address, so Back and the browser's Back close it.
- Settings' Codex group is `/settings/codex/{backup|restore|notes|autosave|history}`; the Codex bar's More opens
  `/settings/codex/backup`. `/codex/backup` and `/codex/settings` redirect there.

## 5. Phases

### Z0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `F-time-tools/`, and leave the
   other pieces' folders as the zip has them.
2. Add `F-time-tools/ADR-0070-time-and-tools.md` as `docs/adr/0070-time-and-tools.md`, Accepted, and its row to
   `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### Z1: the templates page

1. Three columns: the side list (TEMPLATES with counts, New template at its foot), the chosen template (title, Default
   for new sessions, Duplicate, More, its line and sections), today's panel at the right.
2. A phone: the templates as chips, the template's sections, Add a section and New session from it; a phone can edit.
3. Tests: choosing a template, New template, Set as default from More, the starting template read only, a phone's chips.

### Z2: adding a section by its kind

1. ADD A SECTION in the side list: the seven kinds with this template's counts; drag one among the rows (the drop place)
   or press it to add at the end; the foot says what the lit kind holds.
2. A phone: Add a section opens a sheet of the kinds.
3. Tests: a drop inserts at the place, a press adds at the end, the counts follow, keyboard adding by Enter on a kind.

### Z3: Plan session on the Sessions tab

1. PLAN SESSION {n} beside the sessions: Made from as chips (the default chosen), Copies these sections, Played on,
   Create session {n}; it calls today's create with the template.
2. Tests: the default template is chosen, another chip changes what it copies, Create makes and opens the session.

### Z4: the calendar page

1. `/codex/calendar` with the side list (CALENDAR, DATES) and the chosen part's rows; Edit calendar and More open it; it
   saves as you go after today's check, with the warning when dates move.
2. Your date stays today's small dialog (rule 3.4).
3. A phone: the parts as chips.
4. Tests: each part edits and saves, the warning names the moved records, Edit calendar opens the page.

### Z5: a timeline record in the side column

1. Pressing a record on the timeline swaps the story's side column to the record with Back, More, its date, text, links
   and tags, Edit, Hide from players and Delete; `RecordDialog` goes.
2. A phone: the record as the tab's page.
3. Tests: the record opens and closes with Back, Edit opens the composer, Hide from players reveals as today.

### Z6: the tools in Settings

1. Settings' side list gains the CODEX group with the five tools as rows; each tool's page is Settings' rows built from
   `BackupView` and `CodexSettingsView`; Restore keeps its confirm; More opens Settings at Backup; the old addresses
   redirect.
2. A phone: Settings' list shows the group.
3. Tests: each tool's rows write as today, search finds them, the redirects, Restore's confirm.

### Z7: docs and cleanup

1. `docs/DESIGN.md`: the templates page, the calendar page, the record in the side column, the Codex group in Settings.
   `docs/ARCHITECTURE.md`: the addresses in section 4.
2. `docs/adr/README.md`: 0070 Accepted and built. `docs/design/polish/CATALOG.md`: F4.4, F4.6 and F6.1 to F6.4 move to
   Built.
3. Remove what nothing uses: the template cards, the Add a section menu, `RecordDialog`, the calendar dialog, the GM
   menu's Backup and Settings pages.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With the starting template, two templates of your own (one used by a session), a calendar with an era and four dated
  records, look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: the templates page, dragging and pressing a kind, Plan session, the calendar page and its
    warning, a record in the side column, and each Codex tool in Settings.
  - 390 by 844 with touch: the same, with chips, sheets and pages; every control at least 44 px; no sideways scroll.
- As a player: no templates or prep anywhere; the Compendium in the Codex as G's panes, read only.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- Nothing in the Codex. The API reference, Players' At the table actions and a credential's History are I's next round.

## 8. Departures from the mockup, on purpose

- The mockup's campaign, templates and sessions are invented; the app reads its own.
- The mockup draws Settings' list scrolled to the Codex group so the chosen tool shows; the list scrolls as today's.
- The mockup does not draw Restore's confirm, a player's Compendium in the Codex or Your date's dialog; the rules place
  them.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `time-and-tools.html`.

- `p6-body7.js`: the approved pages. `sideList()` (the settled side list), `tplPageA()` (the templates page, with
  `tplRail()`, `tplMain()` and `tplPanel()`), `sessTabA()` (Plan session), `calPageA()` (the calendar page),
  `toolsPageA()` and `toolsListPhoneA()` (the Codex group in Settings).
- `p6-body6.js`: the round's options and their parts (`secRows()`, `recPage()`'s `side` branch is the chosen record).
- `p4n-ft.css`: the round's parts (`.t-sec`, `.t-kind`, `.t-tl`, `.t-line`); `p4j-set.css`: Settings' frame, side list
  and rows; `p4h-f2.css`: the side list (`.u-rail`, `.u-ri`).
- `p6-dec6.js`: the decisions, the Carried in list and the rules. The other body files are F's frame and earlier rounds.
- `audit-f.js`: the "Today" screenshots.
