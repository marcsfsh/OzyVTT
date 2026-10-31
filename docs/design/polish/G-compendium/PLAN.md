# G The Compendium's frame: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the Compendium's bar, its home, browsing a kind, a record (now opened
as a tab beside the results) and the edit studio. It adds no rules, commands, routes on the server or data. File paths
and line numbers were read at `f5e166f`; the theme (T) and the frame (A) land on the same branch first or alongside, so
confirm every anchor before editing. Paths are under `apps/client/src/compendium/` unless they start with
`apps/client/src/` (written `src/`), `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is area G's frame in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, G0 to G6, each
  about one commit.
- The reference is `compendium.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else
  is inline). It opens on the approved choices. Use the Page switch (Home, Browsing, An SRD monster, Your copy, Ticking
  a filter, Editing). Inside the frames, the open records' tabs, a record's Card, Sharing and History switch, Filters on
  a phone and Edit work. The other options in the three decision switches are the ones the owner turned down; build
  only the chosen ones. On a phone the page has its own bar and a Close up, Whole and Turned laptop view. `history/`
  holds rounds 1 to 3 as they were shown; round 3 asked browsing and records again, as one question.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its homebrew is a stand-in.
  Build with the existing components, hooks and primitives. Section 8 lists where the plan departs from the mockup on
  purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top, and `src/writing.test.ts` checks it. The Compendium has its own word list (`vocabulary.test.ts`):
  never "public", "secret", or "shown, hidden or visible to players".

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Home is Shelves: the nine kinds as cards, Needs you across the top, the sources at the foot.
2. Browsing is a filter panel with a count beside every choice and the active filters as chips over the table.
3. Browsing and records are three panes: the filter panel, the results and the record side by side, all live, with
   the open records as tabs over the record only and a record's Card, Sharing and History as a switch in its head.
   Each pane folds to an edge read across; going back to the full table keeps the open records. Edit opens the studio
   over the panes. The owner chose Open tabs in round 2, asked for it to be joined with the filter panel, and chose
   Three panes from six joins in round 3.
4. Making homebrew stays the studio, with each step's answer in its rail and what differs from the SRD marked in the
   preview.
5. Eleven rules for the Compendium (`SPEC.md` section 3), starting with the Titled bar.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin (one surveyed for this plan was 26 commits behind, before the horizon update that added
  `StripInk`, `useRecordLight` and `data-record-key` here), so pull before reading any anchor.
- G builds on T and A. T1 to T3 (the Base line, `Group`, the Titled section bar) and A1 to A3 (the menu, the phone frame
  without a top bar) must be on the branch before G1. If they are not, stop at the phase that needs them and tell the
  user.
- CLAUDE.md applies in full. The server decides and projections are the boundary: the GM's reads are
  `GET /homebrew/table?kind` (whole kind, unpaged, with an ETag; `apps/server/src/homebrew-http.ts` 559 to 571) and
  `GET /homebrew/overview` (573 to 611); players read `GET /content/compendium` through `compendiumOf` on
  `library.forAudience` (`apps/server/src/homebrew-player.ts:10`). No server code, shared domain, schema, command or
  HTTP route changes. Who sees a record, the rule that a draft cannot be shared, and the player's reader stay as they
  are. If a step seems to need a server change, stop and tell the user.
- The player's Compendium reader (`player/CodexCompendium.tsx`) shares `CompendiumTable` (with `gm={false}`),
  `CompendiumCard`, `kinds.tsx`, `routes.ts`, `tableModel.ts` and `compendium.css` with the GM's side. Every change to
  those is gated on `gm` or kept out of them, and `player/codex-compendium.test.tsx` passes unchanged.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area; a preview is the real thing.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the
  steps).

## 3. What is on the branch now

### 3.1 The frame and the routes

- `CompendiumShell.tsx`: `SECTIONS` (32 to 37: Browse goes to `/compendium/tables`, Homebrew to `/compendium`, then
  Sources and Sharing; the comment at 31 says the addresses stay as they were), Ctrl K (67 to 77), the one-shot
  `openSearch=1` (79 to 84), `recordKey` and the table flyout's reset (87 to 88), `useRecordLight` on
  `.cp-recordlayout.is-docked` (99 to 102), the body (104 to 148: a record is docked beside a compact `TablesView` when
  `wide && view.tab !== "edit"`, otherwise full width with the table in a `FilterFlyout`; one `RecordView` is mounted,
  `key={recordKey}`), the laptop bar (156 to 189: `h1.cp-bar-title` "Compendium", `nav` "Compendium sections" with
  `nh-tab` buttons and `StripInk`, the `cx-searchbox` "Search the SRD and homebrew" with a `Kbd`, `RulesButton`,
  `Button variant="primary"` "New homebrew"), the phone (191 to 221: `cp-phone-sections`, a `cx-tabbar` with the same
  words and an icon-only "New homebrew"), the dialogs (224 to 225).
- `routes.ts`: `KIND_SLUG` (6 to 16), the addresses (comment 20 to 33), `compendiumViewOf` (52 to 71: overview, tables
  with an optional kind, sources, sharing, and `/<slug>/<id>?tab=card|edit|sharing|history`), `RECORD_KEYS` (90: tab,
  step, as, view, new), `withTableQuery` (93 to 103, keeps the table's query keys when a record opens or closes).
  `src/shell/router.ts`: `/homebrew` redirects to `/compendium` (164), `isKnownPath` uses `compendiumViewOf` (316), the
  last location is kept in localStorage (386 to 397).
- `context.ts`: `PHONE_QUERY` (8, max-width 760), `WIDE_QUERY` (10, min-width 980), `CompendiumContextValue` (125 to
  140), `CompendiumGameContext` (146). `pieces.tsx` `PhoneHead` (87 to 112).
- `src/reference/RulesReference.tsx` `RulesButton` (81 to 91). `NewRecordDialog.tsx` (a Modal "New homebrew" or "Make a
  homebrew copy": Name, Kind, Blank or "A copy of…"; on create it goes to the record with `?tab=edit&new=1`, 104).
  `SearchDialog.tsx` (a Modal "Search the SRD and homebrew"; names from `useTable(null)`, homebrew text from
  `homebrewApi.search`; it navigates with `recordPath`, 69).
- No shared section-bar component: the `cx-bar` pattern is hand-made in `src/codex/shell/CodexFrame.tsx:164`, here and
  `src/settings/SettingsPage.tsx:206` (CSS `src/codex/shell/shell.css` 39 to 91). T's Titled bar replaces them.

### 3.2 Home

- `OverviewView.tsx` reads `useOverview` (`GET /homebrew/overview`, `data.ts:387`) and `usePacks`: Sources (`srd.records`
  and each pack's `counts.records`, `published`, `shared`, with `PackSwitch`), Needs you (the server's `needsYou` with
  reasons changes-not-live, draft, imported, broken; `needWords` 13 to 29 picks the edit or history tab), By kind (`byKind`
  with srd, homebrew, drafts, shared; each `CountCell` links to a filtered table, 204 to 233). The phone (52 to 101) has
  no By kind. The overview carries no sample records.
- `data.ts` `useTable(token, kind | null)` (372 to 384) returns `HomebrewTableRow`s (id, kind, name, source, packId,
  state, archived, inCatalogs, pendingChanges, issueCount, audience, characterIds, basedOn, createdAt, updatedAt,
  usageCount, columns; `packages/api-contract/src/index.ts` 1534 to 1559). Kind null fires nine requests.

### 3.3 Browsing

- `TablesView.tsx` renders `CompendiumTable`; `useNames` (299 to 305) calls `useTable(token, null)`, so any Browse or
  record view already holds every row of every kind; `rowOf` (282 to 296) drops basedOn, usageCount and inCatalogs from
  `CompendiumRow` (`tableModel.ts` 12 to 27). A row opens with `go(withTableQuery(recordPath(kind, id), query))` (346).
- `CompendiumTable.tsx`: the toolbar (147 to 190: the Kind `Dropdown`, Source `TickDropdown`, the kind's first filter as
  a `TickDropdown` when it has two options or more, `FiltersButton` with a count, `SortButton`, `tableSummary`), the
  table's rows with `data-record-key` (228, 280), the GM's columns (262 to 270: State, Who sees it, Problems, Modified),
  `optionsOf` (360 to 364, values from the loaded rows, no counts), `TableFilterFlyout` (391 to 478: Name, Source, the
  kind's filters as `FilterChips`, and for the GM State, Who sees it, Problems, Modified, Clear).
- `kinds.tsx`: `KIND_COLUMNS` (104 to 260; compact shows the first three), `phoneFacts` (266 to 290), the filters per
  kind (305 to 344): spell level and school; monster cr, size and type; equipment rarity and itemKind; class caster;
  subclass class; species size; feat category; background and spell list none. Kind All has no kind filters. CR is a
  list of exact values.
- `tableModel.ts` (84 to 120): the URL keys q, source (a list or "none"), state (published, pending, draft by default),
  who, problems=1, from, to, `f.<key>`, sort=`key:dir,…`; the kind is in the path. Filtering and sorting run in the
  client (`filterRows`, `sortRows`).
- `src/scenes/listTools` holds `TickDropdown`, `SortButton`, `ModifiedDropdown`, `OneChoice`; `FilterFlyout`,
  `FiltersButton` and `Dropdown` are `@vtt/ui`. They are shared with Encounters, Maps and Settings
  (`docs/ARCHITECTURE.md:1170`).

### 3.4 A record

- `record/RecordView.tsx`: `RecordHeader` (94 to 161: the kind's icon or a `ReadinessRing` while editing, the `h2`,
  chips, Steps or All questions as a `SegmentedControl` on edit 518 to 530, the More menu 475 with Discard the changes,
  Unpublish, Make a copy, Archive or Restore, and Close "Close {name}" 220, 431), the line (`useRecordLine` 183 to 190:
  `phoneFacts` of the row and "used by N characters"; `WhoSeesItSwitch` 489 to 500, Hidden, Everyone, Characters), an
  SRD record's badge "SRD 5.2.1" and actions (226 to 251: `AddToScene` "Add to an encounter", primary "Make a homebrew
  copy"), "Your copies" (225: rows of the same kind whose `basedOn.id` is this record and not archived; 270 to 289 with
  Compare, which opens the copy's History), a homebrew record's state chips, "Changed on two devices", `SaveState`
  (514), Publish or Update. The tabs come from `?tab=` with card left out of the address (423); an SRD record shows only
  Card (256).
- `record/useHomebrewRecord.ts` (41 to 292) owns the draft, autosave, publish and merge, and needs `useHomebrewList` for
  the schema (`RecordView.tsx` 318 to 341). It flushes on unmount through `trackClosingSave`, and reopening waits on
  `closingSave(id)` (`src/homebrew/closingSaves.ts`).
- AC, HP and CR for a monster: the row's `columns.armorClass`, `hitPoints`, `challengeRating` (from the saved body,
  `apps/server/src/homebrew-library.ts` 55 to 63); the draft's own are `challengeOf(draft)`
  (`src/homebrew/wizard/monster-build.ts:65`), `draft.armorClass`, `draft.hitPoints.maximum`.
- `record/CardTab.tsx` (the card and "See as" with `?as=`), `SharingTab.tsx`, `HistoryTab.tsx` (`BasedOn` 228 to 296
  fetches the original and runs `compareBodies`, `record/words.ts` 98 on), `Compare.tsx`, `Merge.tsx`,
  `AddToScene.tsx`.

### 3.5 The studio

- `record/Studio.tsx`: `stepStates` (66 to 80), the foot (250 to 270: Back, "Next: {title}", Publish on Review), the
  phone's `cp-stepstrip` (275 to 292), the steps rail as `@vtt/ui` `Steps`, vertical (294 to 303), the preview aside at
  980 px and wider (314 to 319: `CompendiumCard(cardOfBody(draft))`; narrower screens get `cp-peek` and a full-screen
  Modal). `?view=all` is All questions and `?step=` the step (`RecordView.tsx` 408 to 409); `?new=1` turns off
  `seenAll`.
- The steps: `wizardSteps` (`src/homebrew/wizard/steps.ts` 12 to 24) plus Other details and Review. The monster's are
  Identity, Defences, Ability scores, Traits, Actions, Bonus Actions, Reactions, Legendary Actions
  (`src/homebrew/wizard/monster.tsx` 493 to 681); every kind's are in `monster.tsx`, the spell and equipment files and
  `character.tsx` (104 to 548). `WizardStep` (`src/homebrew/wizard/types.ts` 28 to 49) has no summary; `summaries.ts`
  summarises whole records for seven kinds (no monster, no spell list).
- `packages/ui/src/primitives/Steps.tsx`: `StepItem` (8 to 15: label, a plain-text name for the phone, state), `Steps`
  (38 on). It is shared with `WizardShell` and `src/scenes/EditorFrame`.
- CSS `compendium.css`: the bar title 98, the search box at 1280 106, the record layout 450 to 470, the studio 748 to
  990 (steps 763, preview 782, the phone strip 913, the peek 951), phone queries at 760.

### 3.6 Tests that pin it

- `compendium.test.tsx` mounts the shell at `/compendium/tables/spells`, `/compendium/spells/hb-brine-burst-a1b2c3`,
  `/compendium/spells/fireball`, `/sharing` and `/sources`: role table; a row `/Brine Burst/` with "Homebrew" and
  "Lyra Emberwise"; h2 "Brine Burst" and "Fireball"; "See as" with `?as=`; no "Edit" tab on an SRD record; region "Your
  copies"; "Make a homebrew copy" and its dialog ("Make the copy", "Name", `tab=edit`); "New homebrew" and its dialog
  ("Kind", "Name the spell first.", "Make it").
- `studio.test.tsx` reads `.cp-step-foot`, `.cp-studio-body`, `.cp-studio-preview`, `.cp-step-title` and the first child
  text of `.cp-studio-steps .nh-step-label`; buttons `/^Next/`, "Publish", `/^Review/`, `/^Name and level/`,
  `/^Actions/`, `/^Features/`, `/^Origin feat/`; "Still needed here", "Everything the game needs is here".
- `reopen-save.test.tsx` opens `/compendium/feats/hb-lucky-charm?tab=edit`, goes to the table and back, and relies on
  the save flushing on unmount; "Changed on two devices", "Keep both changes". `add-to-scene.test.tsx`, `history.test.ts`,
  `model.test.ts` (routes, the filter round trip, sort, `tableSummary`, `phoneFacts`), `vocabulary.test.ts`,
  `preview-parity.mirror.test.ts` (`cardOfBody` equals the server's `compendiumEntryOf` for each kind),
  `player/codex-compendium.test.tsx` (`/^Kind: Spells/`, menu "Kind").
- Outside the folder: `src/shell/router.test.ts` (128, 278 to 279, 371 to 376), `src/shell/app-bar.test.tsx` (139 to
  147, `/compendium?openSearch=1`), `src/writing.test.ts` (101 to 104, the dialog's "Kind").
- e2e: `e2e/journeys.spec.ts` 978 to 986 opens Compendium, presses `navigation "Compendium sections"` button "Browse",
  opens the first `[data-record-key]` row, expects `.cp-record`, goes Back and expects the row; 1039 to 1043 checks the
  Compendium bar's ink; `e2e/smoke.ts:239` `gmSection`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The Compendium's bar | Changed: T's Titled section bar; Home first | `CompendiumShell`, `SECTIONS`, `RulesButton` |
| The phone header and strip | Changed: A3's header, a strip of words | `CompendiumShell`, `PhoneHead` |
| Home | Redrawn as shelves | `OverviewView`, `useOverview`, `useTable(null)` |
| The filter panel | New, GM only | `TableFilterFlyout`'s parts, `kinds.tsx` filters, `tableModel` |
| The open records and their tabs | New | `CompendiumShell`, `routes.ts`, sessionStorage |
| Three panes and their folds | Changed | the docked layout, `FilterPanel`, compact `TablesView` |
| The record's title row and parts switch | Changed | `RecordHeader`, `useRecordLine`, the tabs |
| The studio | Restyled; steps show answers; Mark what differs | `Studio`, `Steps`, `WizardStep`, `compareBodies` |

How the open records work, so the phases agree:

- The address still names what is shown: `/compendium/tables/<kind>?<query>` is the full-width table and
  `/compendium/<slug>/<id>?<query>&tab=` is a record in the three panes. Opening a record from anywhere (the list, search, Needs you,
  a link in a card, Your copies, Based on, New homebrew) is a navigation as today, and the shell adds its
  `kind:id` to an ordered list of open records when the address shows one it does not hold. Switching tabs is a
  navigation too, so Back and Forward move between tabs and `journeys.spec.ts` 978 to 986 keeps passing.
- The list lives in sessionStorage under one key (wrap reads and writes in try and catch; an empty or blocked store
  starts with no open records). It holds at most eight records; opening a ninth drops the oldest one that is not shown.
  Closing a tab removes it and navigates to the tab beside it, or to the full table with the table's query when it was
  the last. A record that no longer exists (deleted or archived elsewhere) leaves the list when its read fails. The
  list also remembers the last record shown, for the table's "N records open" button.
- One record stays mounted at a time (`key={recordKey}`), so drafts autosave and flush on unmount exactly as today and
  `reopen-save.test.tsx` holds. A tab's name comes from the rows `useNames` already loads.
- Three panes at 1180 px and wider: `FilterPanel` (250 px), the compact `TablesView` (300 px) and the record. From 980
  to 1179 px the filter pane starts folded (its 44 px edge) so the record keeps room for the stat block. From 761 to
  979 px the record takes the width and both panes are folded edges; pressing one opens it over the record, as today's
  "Open the table" flyout does. A fold the GM chooses is remembered with the open records. On a phone the open records
  are a row of chips under the header.
- Changing a filter with a record open changes the list at once and leaves the record alone. If the record is no
  longer in the results, it stays open and the list says so in one line at its top.
- Edit is a button that navigates to `?tab=edit` (every link that opens the studio keeps working). While the address is
  `tab=edit` the studio takes the width under the open records' tabs, the record's tab says Editing, and the panes are
  hidden (today's rule that edit is not docked); Done returns to the Card.

## 5. Phases

### G0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `G-compendium/`, and leave the
   other pieces' folders as the zip has them.
2. Add `G-compendium/ADR-0055-compendium-frame.md` as `docs/adr/0055-compendium-frame.md`, Accepted, and its row to
   `docs/adr/README.md`. Note on the rows of 0033 and 0037 that the Compendium's frame is changed by 0055. Leave any
   missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### G1: the Compendium's bar

1. `CompendiumShell` on a laptop draws T's Titled section bar: Compendium, then the pages as words with the horizon ink
   (`StripInk` stays): Home (`/compendium`), Browse, Sources, Sharing. `SECTIONS` follows, with Home first and its id
   still `overview`; the addresses do not change. The navigation keeps its name "Compendium sections".
2. The right end: the search field (today's `cx-searchbox`, drawn as T's field, "Search the SRD and homebrew" with
   Ctrl K, opening `SearchDialog` as today), `RulesButton` as a Base line control, and New homebrew as the Cup.
3. A phone (760 px and under): A3's page header with the section's or record's title and Search and New homebrew as
   icons; the pages under it as one strip of words (T 2.1). `cp-phone-sections` and each view's `PhoneHead` search icon
   give way to it.
4. Tests: `compendium.test.tsx` (the sections' names), `router.test.ts` stays as it is (no address changes),
   `app-bar.test.tsx` 139 to 147, `journeys.spec.ts` 980 and 1039 to 1043 (the ink is on the new bar).

### G2: home

1. `OverviewView` becomes the shelves. Needs you is the strip (`SPEC.md` 2.1) built from `needsYou` and `needWords`; when
   it is empty it is one quiet line in today's words.
2. The nine kinds as cards three to a row, from `byKind`: the kind's icon in a square (`KindIcon`), its plural, SRD plus
   homebrew in VT323, and the homebrew and drafts line in magenta or "SRD only" or "None yet". Pressing a card goes to
   `tablePath(kind)`. The homebrew and drafts words keep today's links (the `CountCell` filters, 204 to 233).
3. A card's three records come from the rows: the kind's homebrew first, newest first, then SRD records by name. Draw
   the cards with their counts at once and fill the records when `useTable(token, null)` answers (the same cache
   Browse uses, so it is paid once).
4. The sources as one line: SRD 5.2.1 and its count (always in pickers), each pack with its count and `PackSwitch`,
   then Import a pack and Export as links to Sources.
5. The phone: Needs you as a box, the kinds two to a row with their counts and homebrew line, no records.
6. Tests: a new `overview.test.tsx` (or cases in `compendium.test.tsx`): Needs you lists a draft and a problem with
   their words, the cards show counts from `byKind`, a card opens its table, the records list homebrew first.

### G3: the filter panel

1. A new `FilterPanel.tsx` (GM only) built from `TableFilterFlyout`'s parts, fixed at the left of Browse (270 px):
   the head (Filters, how many are on, Clear), Name as a field, Source, then the kind's filters from `kinds.tsx`:
   - a range for monster `cr` and spell `level`: a small chart of how many rows sit at each value and a two-handle
     range with its two ends as fields. It writes `f.cr` (or `f.level`) as every known value between the ends, so the
     address keeps today's list form and `model.test.ts`'s round trip holds; an address with a gap (from an older link)
     shows its span on the range and its values in the chips. Order CR values with the table's own sort (fractions
     first) and write them with `formatChallenge`.
   - the kind's main list open (monster type, spell school, equipment rarity, class caster, subclass class, species
     size, feat category), six shown and "Show all N";
   - the rest folded as rows with their current value (monster size, equipment itemKind, then State, Who sees it,
     Problems, Modified for the GM). Kind All shows Name, Source and the GM's filters.
2. Counts: beside every choice, the number of rows that would show with that choice and every other active filter
   (each facet ignores its own selection). Work them out from the rows in memory with one pass per facet; measure a
   kind of 479 rows and keep the panel under a frame (16 ms) on a laptop.
3. Over the table: Kind as today's `Dropdown`, each active filter as a chip with remove, Clear all, the count ("8 of
   332"), `SortButton`, and while records are open a button "N records open" that returns to the three panes with the
   last record shown; open records carry an Open tag in the table. `CompendiumTable` takes a `panel` prop: with it, the toolbar's Source and first-filter
   `TickDropdown`s and `FiltersButton` give way to the chips. Without it (the player's reader, the flyout) the toolbar
   stays as it is.
4. A phone: Kind, Filters with its count (opens the panel as a sheet from the bottom with "Show N {kind}" at its foot),
   Sort, the chips, the rows.
5. Tests: a new `filter-panel.test.tsx` (counts ignore their own facet; the CR range writes the values between its ends
   and reads an older list; chips remove one filter; Clear; Kind All), `model.test.ts` for the range helpers,
   `player/codex-compendium.test.tsx` unchanged.

### G4: three panes and the open records

1. The open records list (section 4) in `CompendiumShell`: add on navigation, close, the eight-record limit, the last
   record shown, the folds, sessionStorage, and dropping a record whose read fails. Export its helpers from a small
   `openRecords.ts` with its own tests.
2. The three panes (section 4's widths): `FilterPanel` with its head (Filters, how many on, Clear, Fold), the compact
   `TablesView` with its head ("8 monsters", the sort, Fold) and rows of name, size and type, the kind's key value and
   the Homebrew tag (`data-record-key` stays on them), and the record. The arrow keys move through the list and Enter
   opens the lit row. A folded pane is a 44 px edge with its icon and its count read across; pressing it opens the pane.
   Keep `StripInk` and `useRecordLight` working: the light's record selector moves with the new layout.
3. The open records' tabs (40 px) over the record pane only: a `tablist` named "Open records", each tab its kind's icon,
   its name and Close "Close {name}", each a link to its address.
4. Live filters: ticking in `FilterPanel` with a record open updates the list and its count at once and marks the rows
   that joined for a moment; the record does not move or reload. A record outside the results stays open with the
   list's line "{name} is open but not in these results".
5. The record's title row (T 2.2): the name and More; one line with the kind, `phoneFacts`, the source tag (rule 3.2),
   a homebrew record's state and `SaveState`, and the key numbers in VT323 (a monster's AC, HP and CR: the row's columns
   for an SRD record, the draft's own for homebrew so they do not lag the draft); then the actions (SRD: `AddToScene`
   for a monster, Make a homebrew copy as the Cup; homebrew: `WhoSeesItSwitch` drawn as Base line options, Edit,
   Publish or Update as the Cup) with the record's parts as a small switch at the right of the same line.
6. The parts: homebrew Card, Sharing, History; an SRD record Card and "Your copies · N" (today's region moves into its
   own part and keeps its name; `compendiumViewOf` accepts `tab=copies` for an SRD record). They stay `?tab=` values,
   drawn as a switch (`SegmentedControl` or T's tabs at the small size), so there are never three rows of tabs.
7. Edit navigates to `?tab=edit`; the studio takes the width under the open records' tabs and the record's tab says
   Editing; Done returns to the three panes on the Card.
8. A phone: the list with Filters (the sheet), the chips and "N open"; a record full screen with the open records as
   chips under the header and its main action pinned at the foot (Make a homebrew copy; Publish with who sees it and
   Edit beside it).
9. Tests: `compendium.test.tsx` (three records open as tabs, switching, closing to the neighbour and to the full table;
   a record opened from search joins them; the table's "3 records open" brings them back; ticking a filter keeps the
   record and changes the list; a record outside the results says so; "Your copies" is a part; no Edit part on an SRD
   record; Edit goes to `tab=edit`), `reopen-save.test.tsx` holds, `model.test.ts` for `tab=copies`,
   `journeys.spec.ts` 978 to 986 (the row is still there after Back).

### G5: the studio

1. The title row: the kind as the crumb and the name; the line with the state tag, the Homebrew tag and "Based on
   {name}" for a copy; the actions: Steps and All questions (today's `SegmentedControl`), `SaveState` as a cyan lamp
   and Saved, Done as the Cup, More.
2. The steps rail shows each step's answer. Add an optional `detail` to `StepItem` (`packages/ui`), drawn as its own
   line under the label so the label's first child stays its words (`studio.test.tsx` reads it); `WizardShell` and
   `EditorFrame` pass nothing and do not change. Add an optional `summary(draft)` to `WizardStep`: write the monster's
   eight from the draft (`monster-build.ts` helpers: "AC 17 · HP 27 · 30 ft.", the six scores, the actions' names); for
   the other kinds fall back to the first two of the step's own values in words (`step.owns` with `valueWords`), or
   nothing. A step with a problem keeps today's state and gets the amber mark.
3. The preview: "Preview" with, for a copy, a "Mark what differs" switch (on by default). Fetch the original once with
   the code `HistoryTab`'s `BasedOn` uses (lift it into a hook), run `compareBodies`, and mark the card's lines whose
   field differs. Give `CompendiumCard` an optional `changed` set and a map from the monster's fields (name, armorClass,
   hitPoints, speed, each ability, skills, senses, languages, challenge, traits, actions, bonusActions, reactions,
   legendaryActions) to its lines; other kinds hide the switch in this round. `cardOfBody` does not change, so
   `preview-parity.mirror.test.ts` holds.
4. The middle and the foot as today, drawn to the theme: the step's title, its line of what its answers make, the
   questions, Back and "Next: {title}" as the Cup, Publish on Review.
5. A phone: the header Editing, the name and Saved, the step's name with "Step N of M" and the bar of steps, then
   Questions, Card and Steps as a segmented control (Card opens today's peek), and Back and Next pinned.
6. Tests: `studio.test.tsx` (its names and classes stay; new: a step shows its answer, the monster's Defences reads "AC
   17 · HP 27 · 30 ft."), a test that Mark what differs marks HP and CON on a copy and nothing on a blank record,
   `preview-parity.mirror.test.ts` unchanged.

### G6: docs and cleanup

1. `docs/DESIGN.md`: a Compendium section beside the Codex's (the bar, the shelves, the filter panel, records as tabs,
   the studio); line 290 (SRD and HOMEBREW tags: SRD quiet, Homebrew magenta, rule 3.2); 186 to 188 (Rules opens from
   the Compendium's bar).
2. `docs/ARCHITECTURE.md`: the Compendium (922 to 945: its sections now read Home, Browse, Sources and Sharing; the open
   records list and where it lives; the filter panel and its counts in the client), 1170 (the filter parts the panel
   reuses), 1216 (opening a record from a list and going back).
3. `docs/adr/README.md`: 0055 Accepted and built.
4. Remove what nothing uses: the By kind table's CSS, `cp-phone-sections`, the toolbar's GM-only `TickDropdown`s if
   only the player uses them now, the old `cp-recordlayout.is-full` flyout if the 761 to 979 px case no longer needs it.
5. `docs/design/polish/CATALOG.md`: G's frame moves to Built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With the SRD bundle and a few homebrew records like the mockup's (a draft copy of the Goblin Boss, a published monster
  with a problem, a spell shared with everyone, an item shared with one character), look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: the bar (each page lit once, the search field and Ctrl K, Rules, New homebrew), home
    (Needs you, the nine cards and their records, the sources line), Browse for monsters and spells with filters on
    (counts change with each other filter, the CR range, chips, Clear all), opening an SRD monster, its copy and a
    spell as three tabs, switching, closing, Back and Forward, ticking a filter with a record open (the list changes,
    the record stays), a record outside the results, folding each pane and opening it again, the full table and its
    "3 records open" button, Your copies, Add to an encounter, and editing the copy (steps with answers, Mark what
    differs, Done back to the Card).
  - 1100 px and 900 px wide: the filter pane folded, then both panes folded and opening over the record.
  - 390 by 844 with touch: the strip of pages, home, the filter sheet, the chips of open records, a record full screen
    with its pinned action, the studio's Questions, Card and Steps; every control at least 44 px; no sideways scroll.
- As a player in the Codex: the Compendium reader looks and works as before.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable: search, New homebrew and Make a homebrew copy, Sources and Sharing,
  See as, Compare and Merge, Publish and Update, Discard the changes, Unpublish, Archive and Restore, the "Changed on
  two devices" merge, autosave on leaving a record.

## 7. Left as they are, for later rounds

- Sources and export (G4), the Sharing page (G5), Compare and Merge (inside G6), the editors for kinds other than
  monsters beyond the rail's answers (G7), search's dialog (G9) and the catalog picker (G11). They take the bar now and
  their own designs later.
- Every command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The studio's switch keeps today's words, Steps and All questions; the mockup says One page.
- The mockup draws the three panes at 1280 px only; section 4 places the folds from 980 to 1179 px and from 761 to 979
  px, and the line for a record outside the results.
- The mockup's kind cards show records chosen by hand; the plan picks homebrew first, then SRD records by name.
- The mockup's Sources line names one pack (This table); the app lists each pack.
- The mockup does not draw the eight-record limit, the 761 to 979 px layout, Kind All's panel, the other kinds' steps or
  the switch hidden for a blank record; section 5 places them.
- The mockup's homebrew records, counts per facet and the Goblin Boss copy's changes are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `compendium.html`.

- `p4h-comp.css`: the source tag (`.g-src`), problems (`.g-prob`), the audience control (`.g-aud`), tables (`.g-th`,
  `.g-tr`, `.g-tr.new` for rows that joined), the stat block (`.g-sb`, `.g-ab`, `.g-chg`), the filter panel
  (`.g-facet`, `.g-fo`, `.g-fo.just`, `.g-hist`, `.g-range`, `.g-fold`, `.g-fhead`), chips (`.g-chip`), the kind cards
  (`.g-kc2`), pane heads (`.g-paneh`), the open records' tabs (`.g-otabs`), a record's parts switch (`.g-segs`), the
  studio's steps (`.e-step small.v`) and marks (`.g-mark`). The other options' parts sit beside them. `p4f-prep.css` and `p4g-codex.css` hold E's and F's shared parts.
- `p6-head.js`: the data (`KINDS`, `HOMEBREW`, `MONS`, `BOSS`, `COPY`, `CHANGED`), the parts (`src()`, `st()`, `who()`,
  `aud()`, `sb()`), and the frame (`compBar()`, `lap()`, `ph()`).
- `p6-body.js`: `home()` (the `shelves` branch); `WORK`, the round 3 workspace, with `lapWork()` and `phoneWork()` (the
  `panes` branch) and their parts `panel()`, `listCol()`, `rtabs()`, `rhead()`, `secs()`, `browseFull()`; `make()`
  (the `studio` branch, with `otabs()` over it).
- `p6-dec.js`: the decisions and the rules. `p2b-mobile.css` and `p6-tail.js`: the mockup page's own phone bar, laptop
  view and the in-frame clicks; mockup code only.
- `audit-g.js`: the "Today" screenshots.
