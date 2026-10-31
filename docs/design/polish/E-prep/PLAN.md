# E Prep's frame: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update U6: ADR-0046 and the handoff"). This plan rebuilds Prep's front page, an encounter's page, making an encounter and the map's grid steps. It adds no rules, commands or data. File paths and line numbers were read at `f5e166f`; the theme (T), the frame (A) and the table (C) land on the same branch first or alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is area E's frame in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in six phases, E0 to E5, each about one commit.
- The reference is `prep.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is inline). It opens on the approved choices. Use the Page switch (Prep's front page, An encounter, New encounter, Setting a grid). The other options in the four decision switches are the ones the owner turned down; build only the chosen ones. On a phone the page has its own bar and a Close up, Whole and Turned laptop view. `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its six encounters and maps are stand-ins. Build with the existing components, hooks and primitives. Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md` applies on top, and `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Prep opens on a Shelf: encounter cards led by their maps, with a toolbar of the count, the states and the order.
2. An encounter's page is the Workbench: the table's own frame (the tools dock, the map with its tray chip, a 380 px panel with Make live in its foot).
3. Making an encounter is a Draft page: New encounter opens the encounter's page at once with what is left to make it ready, starting with picking a map.
4. Setting a map's grid keeps its Steps, drawn to the theme.
5. Nine rules for Prep (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- E builds on T, A and C. T1 to T3 (the Base line, `Group`, the Titled section bar and `PrepBarSlot` as its right end) and A1 to A3 must be on the branch before E1. C1 to C3 (the workbench grid, the Ladder and the tools dock with `MapRail layout="grid"`, the map's controls and the tray chip) must be on the branch before E2, because the encounter's page reuses them. If one is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every change keeps going through today's commands: `encounter:create`, `encounter:activate`, `encounter:rename`, `encounter:duplicate`, `encounter:remove`, `encounter:reorder`, `encounter:set-combatants`, `encounter:set-initiative-defaults`, `encounter:set-player-dice`, the vision and fog commands, and the map's calibration routes. No server code, shared domain, schema, command or HTTP route changes. An encounter needs a battle map (`apps/server/src/commands/scenes.ts` 39 to 64), so the draft's record is made when its map is picked. If a step seems to need more, stop and tell the user.
- `design-conventions.test.ts`: tokens (d), the breakpoint ladder (f), `.scroll-y` (h), the display face in capitals (i), one Eyebrow (c), toasts (e).
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area; Prep's layout (418 to 420) and "lists are tables" (413 to 414) change in E5.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before calling a phase done, and look at the pages at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The shell and the front page

- `scenes/ScenesShell.tsx`: `LIST_TABS` (20 to 23, Maps and Encounters), `ListHead` (29 to 49: `.sc-front-head`, `.sc-front-new` with New map and New encounter, then Tabs "Maps and encounters" `.sc-front-tabs`), `FindBox` (55 to 93, "Find an encounter or a map", Ctrl K), `ScenesShell` (100 to 210: the view switch 158 to 187; `PrepBarSlot` 193 to 205 with the FindBox and, on a record, "+ New map" or "+ New encounter").
- `scenes/routes.ts`: `SCENE_STEPS` 18, `MAP_STEPS` 20, `scenesViewOf` 36 to 53 (`/encounters`, `/encounters/list`, `/encounters/new`, `?step=`, the maps' paths), `SCENES_PATHS` 61 to 67, `pathForScene` 69, `pathForMap(id, step, back)` 73 to 79. `router.ts`: `PREP_PAGES` 216 to 223, `prepPageFor` 226 to 244.
- `shell/AppBar.tsx`: `PrepBarSlot` 381 to 384 (a portal), `PrepFrame` 390 to 416 (Tabs "Prep pages", `.section-bar-end`). `shell/GmShell.tsx` 156 to 157, 179 to 181.
- `scenes/scenes.css`: `.sc-thumb` 154 to 173, `.sc-state` 176 to 206, the front head 218 to 239, lists 242 to 420, phone 421 to 427.

### 3.2 The encounter list

- `scenes/SceneList.tsx`: facts 63, filter and sort 64 to 74, `inOrder` 75, drag 77 to 122 (broken: the rows carry `data-scene-id` at 88 to 91 and the code reads `dataset.encounterId`), `rowMenu` 124 to 163 (Make live, Edit its steps, Rename, Duplicate, Move earlier, Move later, Delete encounter), the empty state 211 to 217, phone rows 220 to 242, the table 244 to 289 (Name, State, Progress, Map, Tokens, Light, Codex, Modified).
- `scenes/sceneFacts.ts`: `SceneState` (9: live, prepared, parked, replay), `SceneProgress` (21), `factsOf` 72 to 98, `tokensLine` 105 to 110, `lightLine` 123 to 129, `gridLine` 131 to 138, `needsOf` 148 to 173 ("{map} has no grid yet, so tokens won't snap to squares.", "N tokens wait in the tray, off the map."), `modifiedAt` 176 to 181, `whenLabel` 184 to 193, `Readiness` 199 and `readinessOf` 210 to 216 (live, ready, draft, needs-map, loading-map, map-unavailable). Nothing here is stored.
- `scenes/SceneListToolbar.tsx` 22 to 67 and the flyout "Filter encounters" 70 to 156; `scenes/listTools.tsx` (`TickDropdown` 20 to 70, `SortButton` 126 to 168); `scenes/scene-lists.ts` (states 10, filters 12 to 38, sorts 40 to 62, "Your order", URL 127 to 171).
- `scenes/sceneActions.tsx` `useSceneActions` 10 to 92: `makeLive` 27 to 40 ("Make encounter live?" when a fight runs), `rename` 41 to 47, `duplicate` 48 to 52, `remove` 54 to 66, `reorder` 68 to 69, `move` 70 to 77.
- `scenes/pieces.tsx`: `MapThumb` 9 to 19, `StateChip` 22 to 29, `SceneListFlyout` 45 to 82.
- Cards: `packages/ui/src/styles/patterns.css` `.nh-gallery` 94 to 101, `.nh-card` 106 to 150, `.nh-card-thumb` 152 to 172 (16 by 10), `.nh-card-status` 174, `.nh-card-tools` 182, body 192 to 212, actions 213 to 228, `.nh-card--new` 232 to 263. `.nh-card-open` is named at 92 and 103 and defined nowhere.

### 3.3 An encounter's page

- `scenes/SceneDocument.tsx`: `Section` 36 to 61, the remembered tab "vtt.scene-tab" (80), the header `.sc-scene-head` 93 to 171 (back, title, rename, `StateChip`, See as, Edit map, the More menu), the map 173 to 194 (`EncounterMap` with `moveSceneId`, which brings `MapRail` and `MapTokenTray` "Staging tray"; or `ScenePreview`), the preview banner 195 to 207, the Setup tab `sceneTab` 209 to 256 (State with the needs and Go to it, Map, Walls and light, Sound, In the Codex, History), the foot 259 to 271 (Make live, or Go to the table), the layout 273 to 312 (`.table-bench.gm.sc-scene-bench`, `SceneListColumn`, `TablePanel` with Combat, Setup and Tokens · N).
- `scenes/SceneEncounterTab.tsx`: `readyChecks` 19 to 50, `FightSettings` 56 to 97, `EncounterDice` 101 to 135, `SceneEncounterTab` 138 to 172 (Who they face, the ready list `ul.sc-ready`).
- `scenes/SceneQuestions.tsx`: `SceneTokens` 26 to 90 (`StagingTray`), `SceneLight` 96 to 163, `SceneSound` 166 to 188, `SceneMapFacts` 194 to 217 (Set the grid, Open the map).
- `scenes/SceneListColumn.tsx` 22 to 56. CSS `scenes/scene-page.css` (header 5 to 67, meta 69 to 208, the list column 439 to 532, Make live 538 to 548), `scenes/scene-encounter.css` (`.sc-ready` 22 to 57).

### 3.4 Making an encounter

- `scenes/SceneEditor.tsx`: `STEP_LABEL` 29 to 35, `NewSceneMap` 65 to 103 (Encounter name, `MapPicker`, Set the grid to `pathForMap(id, "grid", "/encounters/new")`), `SceneName` 106 to 132, `Review` 135 to 175, `SceneEditor` 183 to 430 (`?map=` 197 to 213, "Opening the encounter…" 218 to 222, `create` 235 to 255 sending `encounter:create { name: name || picked.name, mapAssetId, combatantIds }` and going to `?step=tokens`, the primary 296 to 314, the secondary 315 to 324 with Done for now, the head 369 to 396, steps locked while new 401).
- `scenes/EditorFrame.tsx` 18 to 136 (rail, the phone strip, the map peek); CSS `scene-page.css` 209 to 436. `scenes/StagingTray.tsx` ("In this encounter", "N staged · M on the map", "Place X on the map").
- A bug that goes with the steps: Set the grid from a new encounter returns to `/encounters/new` without `?map=`, so the pick and the name are lost (`journeys.spec.ts` 585 to 586 picks again).
- `maps/MapPicker.tsx`: `MapTile` 25 to 56 (Grid set, Gridless, No grid yet), Upload a map 154 to 166, `input.map-picker-file` 167 to 178, "Map uploaded." 120, the no-grid note 195 to 207. CSS `maps/map-picker.css`.

### 3.5 The map's grid steps

- `maps/MapEditor.tsx`: labels 29 to 34 (Upload, Grid, Check the alignment, Name and use), `UploadStep` 44 to 127, `UseStep` 130 to 163, `MapEditorHead` 179 to 206 ("Add a map"), `MapStepsEditor` 245 to 355 (check 258 to 260, finished 262 to 265, "Mark the grid first, then check it here." 284 to 287, the Use foot 300 to 318).
- `maps/useCalibration.tsx`: the wizard routes (start 196 to 210, actions 214 to 218, complete 228 to 234, scale 235 to 241), the buttons by step 283 to 411 (Continue; Measure this area with Change type and Start over; Use these points; Looks right and Redo drag; Confirm grid and Fine-tune again; Save map scale), the canvas `.map-canvas-col > .map-preview > svg` 418 to 485.
- `maps/CalibrationSteps.tsx`: `stepInstruction` 21 to 55, `ModeStep` 70 to 106 (Printed square grid, Gridless battle map), `MarkStep` 109 to 141 (Crosshair look), `TuneGridStep` 144 to 246, `DistanceStep` 249 to 286, `VerifyStep` 289 to 346, `ScaleReviewStep` 353 to 397. CSS `maps/calibration.css`.
- The grid is stored by the map routes (`apps/server/src/map-http.ts` 211 to 296), never by a socket command.

### 3.6 Tests that pin it

- `scenes/scenes-tab.test.tsx`: the front page (68: tablist "Maps and encounters", New map, New encounter), sorts (92), facts (118: "Prepared", "4 tokens · 1 in the tray", "Vision on · dim · 1 wall · 1 door", "Session 6"), the flyout (129), states (151: "State: all 4"), sort labels (161), the encounter's page (187: region "Ready to go", nav "Encounters" with "Draft", tabs "Setup" and "Tokens · 4", Make live), See as (211, 235), the steps (258 to 325: "Continue" disabled, `encounter:create`, "Opening the encounter…", the upload, "Next: Tokens" to "Review", "In this encounter", "Done for now"), placing (332, 387), the phone (357, 373: the step strip).
- `scenes/scene-lists.test.ts` (facts, filters, sorts, readiness), `scenes/fight-settings.test.tsx`, `maps/maps-tab.test.tsx` (the table 52 to 97, the map page 101 to 141, the steps 145 to 230 with "Printed square grid", "Gridless battle map", "Mark the grid first", the phone strip ["Upload", "Grid", "Check", "Use"]).
- `e2e/journeys.spec.ts`: `onPreview` 37 to 42, `makeLiveFromSteps` 45 to 56, `liveSceneOnNewMap` 59 to 72 ("New encounter", "Upload a map", "Map uploaded.", "Continue", "Tokens and monsters"), the first evening's grid 160 to 199 ("has no grid yet", "Set the grid", heading "Grid", "Measure this area", "Looks right", "Confirm grid", "Back to the encounter"), the grid again 569 to 588. `e2e/smoke.ts`: `openGmSection` 246 to 271, `stageFight` 277 to 301 (region "In this encounter").

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| `scenes/SceneShelf.tsx` | New, replacing the table on a laptop and the rows on a phone | `.nh-gallery`, `.nh-card`, `MapThumb`, `factsOf`, `readinessOf`, `rowMenu` |
| The shelf's toolbar | Changed: the count, the state chips, Your order, New map | `SceneListToolbar`, `TickDropdown` as chips |
| `scenes/stateTag.ts` | New: the one state tag (rule 3.3) | `factsOf`, `readinessOf` |
| The encounter's page | Changed: the title row, the dock, the panel's three tabs | `SceneDocument`, C's `TableDock` and `TablePanel`, today's tab contents |
| The new encounter's page | New: the checklist and the map picker | `NewSceneMap`, `MapPicker`, `create` |
| The grid steps | Restyled | `MapEditor`, `CalibrationSteps`, `EditorFrame`'s rail |

## 5. Phases

### E0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `E-prep/`, and leave the other pieces' folders as the zip has them.
2. Add `E-prep/ADR-0053-prep-frame.md` as `docs/adr/0053-prep-frame.md`, Accepted, and its row to `docs/adr/README.md`. Note on ADR-0035's row that its editor steps are changed by 0053. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### E1: the shelf

1. `ScenesShell`: drop `ListHead`'s two buttons and the Maps and Encounters tabs (rule 3.6); Encounters and Maps are Prep's pages in the bar (`PREP_PAGES`). The bar's right end (`PrepBarSlot`): the FindBox, then New encounter as the Cup on the lists and as a Base line control on a record (rule 3.1).
2. `scenes/stateTag.ts`: `stateTagOf(facts, readiness)` returns Live, Encounter parked, Replay, Ended (progress completed), Prepared (readiness ready) or Draft, with today's `STATE_LABEL` words where they exist. `StateChip` draws it as a VT323 tag; only Live is lit, Draft has a dashed edge.
3. The toolbar: the count at the left ("6 encounters", or "2 of 6 encounters" when filtered); at the right the states as Base line chips (All, Draft, Prepared, Ended, plus Live and Parked when there is one), the sort (Your order as today, the other sorts in its menu), Filters (today's flyout) and New map as a Base line control.
4. `scenes/SceneShelf.tsx`: `.nh-gallery` of `.nh-card`s (cards from 270 px): `MapThumb` at 16 by 10 with the state tag over its top left; the name; the map's name; who is in it (the party's faces from the initiative and the monsters as chips, from `factsOf`); the ready line (rule 3.2, from `needsOf`: "Ready to go" or the first need in amber). The card is a link to `pathForScene`; its More menu (today's `rowMenu`, with Edit its steps gone) sits at the top right, shown on hover and focus and always on touch. Add `.nh-card-open` or drop its mention in `patterns.css`.
5. Your order: the cards drag to reorder with `encounter:reorder`; fix the drag target (`dataset.sceneId`, or read the attribute the cards carry). Move earlier and Move later stay in the menu for keyboard and touch.
6. A phone (under 760 px): two cards to a row (picture, name, ready line); the toolbar is the count with Filter and Sort icons; New encounter is the header's plus.
7. The empty state: T rule 3's empty state with today's words and New encounter.
8. Tests: `scenes-tab.test.tsx` 68 (no tablist; Encounters and Maps in "Prep pages"; New encounter in the bar), 118 (the card's facts), 151 (the state chips), a new `scene-shelf.test.tsx` (the tag for each state, the ready line, the menu, drag reorder sends `encounter:reorder` with the new order); `scene-lists.test.ts` for `stateTagOf`.

### E2: the encounter's page on the workbench

1. `SceneDocument`'s header becomes the record's title row (T 2.2): Encounters as a crumb, the name with its state tag and rename in place, one line (the map, who is in it, when it changed, and the Codex pages that stage it from `useSceneLinks`), and Duplicate, Edit the map and More (Rename, See as, History, Delete encounter) as Base line controls.
2. The layout is C's workbench: `TableDock` with the tools (no Ladder before a fight; the round head reads the encounter's state), the map with C's map controls and Tray chip (today's `MapTokenTray` behind the chip), and `TablePanel` at 380 px. Drop `SceneListColumn` from the page; the bar's FindBox and the shelf find encounters.
3. The panel's tabs: Who is in it · N (today's `SceneTokens` and `StagingTray`, then Who they face), Rules (`FightSettings` and `EncounterDice`), Light and sound (`SceneMapFacts`'s grid line with Set the grid, `SceneLight`, `SceneSound`). Keep the remembered tab key, mapping old ids (encounter to rules, scene to light, tokens to who).
4. The foot: the ready lines (today's `readyChecks` and `needsOf`, each with Go to it) over Make live as the Cup, or Go to the table while it is live (C's foot slot).
5. See as keeps `ScenePreview` and its banner; it opens from the More menu.
6. A phone: the title row, a segmented control of Map, Who, Rules and Light (C's Switch), the chosen view, Make live pinned above the tabs.
7. Tests: `scenes-tab.test.tsx` 187 (region "Ready to go", the tabs "Who is in it · 4", "Rules", "Light and sound", Make live), 211 and 235 (See as from the menu); `fight-settings.test.tsx`; `stageFight` in `smoke.ts` (region "In this encounter" stays inside Who is in it).

### E3: the new encounter's page

1. `/encounters/new` renders the encounter's page in its new state: the title row "Untitled encounter" with a Draft tag and no actions; in the map's place the checklist (T rule 4's Steps, vertical: Pick a map, Add who is in it, Place the tokens, Make it live, the first current) beside Pick a map (`MapPicker` with today's tiles, four to a row, and Upload a map).
2. Picking a map calls today's `create` (`encounter:create` with the name typed or the map's name, the map and the active party), shows "Opening the encounter…" while it arrives, then replaces the address with the encounter's page on its Who is in it tab. `?map=` still preselects and creates at once.
3. A map with no grid: the tile's Set the grid goes to `pathForMap(id, "grid", back)` with `back` set to the new encounter's address and `?map=`, so the pick survives (this fixes the bug in 3.4).
4. Retire the steps: `SceneEditor`'s Tokens, Light, Sound and Review steps, `EditorFrame` for encounters and `SceneListFlyout`'s use there. `?step=` on an encounter opens its page on the matching tab (map to the page, tokens to Who, light and sound to Light and sound, review to the page); keep `scenesViewOf` reading them so old links work.
5. A phone: one column, the checklist then the maps two to a row.
6. Tests: `scenes-tab.test.tsx` 258 to 325 rewritten (the checklist; picking a map sends `encounter:create` and lands on the page; "Opening the encounter…"; the upload; `?step=tokens` opens Who is in it); `journeys.spec.ts` `liveSceneOnNewMap` (New encounter, Upload a map, "Map uploaded.", then the page's Make live) and `makeLiveFromSteps` (Make live from the page's foot), and 585 to 586 no longer pick the map twice.

### E4: the grid steps drawn to the theme

1. `MapEditor` and `MapStepsEditor`: the record's title row (Maps as a crumb, the map's name, its type and size, Cancel), the Steps rail (T rule 4, 240 px, each done step's answer under it), the step's form (380 px), the map at the right, and the foot with Back as a ghost and Next naming the next step as the Cup ("Next: Check the alignment").
2. `ModeStep`: Printed squares and No grid printed as a segmented control on Base lines (`ChoiceGrid` goes here); `MarkStep`'s instruction in a Cradle with the result as a ready line ("Marked: 70 px squares, 5 feet each"); the marked block on the canvas as a 2 px dashed cyan edge on a 12% cyan fill and the grid in cyan.
3. The other steps (`TuneGridStep`, `DistanceStep`, `VerifyStep`, `ScaleReviewStep`) take the same parts: groups as Cradles, choices on Base lines, numbers in VT323.
4. A phone: "Step 2 of 4 · Grid" over the map, the form under it, Back and Next pinned (today's strip goes).
5. Tests: `maps-tab.test.tsx` 145 to 230 (the names stay; the phone's strip becomes the step line), the first evening's grid in `journeys.spec.ts` 160 to 199 and 569 to 588 (button names stay; `onPreview` still finds `.map-preview svg`).

### E5: docs and cleanup

1. `docs/DESIGN.md`: Prep's section bar and front page (186 to 188) for the shelf; "lists are tables" (413 to 414) gains the shelf as the second list pattern; Prep's layout (418 to 420) for the workbench and the draft page; fix the stale pointer to `IMPLEMENTATION.md` (419) to `docs/design/IMPLEMENTATION.md`.
2. `docs/ARCHITECTURE.md`: prepared encounters (278 to 287: the page, the draft, the steps gone), Prep pages (1129 to 1147: the tabs and the shelf).
3. `docs/adr/README.md`: 0053 Accepted and built.
4. Remove what nothing uses: the encounter table and rows' CSS, `.sc-front-*`, `SceneListColumn` and its CSS, the encounter `EditorFrame` CSS, `SceneListFlyout` if unused.
5. `docs/design/polish/CATALOG.md`: E's frame moves to Built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With three maps (one with no grid) and five encounters (one live, one parked or ended, one draft with tokens in the tray), look as the GM in Dusk and Dawn at:
  - 1280 by 800 with a mouse: the shelf (the tags, the ready lines, the menu, drag to reorder, the state chips and sorts), an encounter's page (the dock, the tray chip, each tab, Go to it, Make live with and without a fight running, See as), a new encounter (pick a map with a grid, pick one without and set its grid, upload one), and the grid steps through to Confirm grid.
  - 390 by 844 with touch: the same, with two cards to a row, the encounter's Switch, the checklist page, the grid steps; every control at least 44 px; no sideways scroll.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable: filters, every sort, rename, duplicate, delete, move, preview as the screen and the party, the gridless scale path, the Check the alignment step.

## 7. Left as they are, for later rounds

- The map list and a map's page beyond its grid (E2.1, E2.2), the tokens page (E3.1), the sound board (E3.2), replays (E3.3 to E3.5). They keep working and take the shelf's toolbar where it fits.
- The map's walls, light and fog tools (C2).
- Every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's six encounters and maps are stand-ins; the app shows the GM's own.
- The mockup draws Draft, Prepared and Ended chips only; the app adds Live and Parked chips when such an encounter exists, and keeps Replay as a tag.
- The mockup's new encounter shows the draft as if it already exists ("Made just now"); the app makes the record when the map is picked, and says nothing about when it was made until then.
- The mockup's encounter page shows Who is in it with simple rows; the app keeps today's staging tray controls (Place, the eye, remove) inside that tab.
- The mockup does not draw the filters flyout, See as, the gridless path, Check the alignment or the phone's other views; section 5 places them.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `prep.html`.

- `p4f-prep.css`: the toolbar and Base line controls (`.e-tool`, `.e-btn`), the state tags and ready lines (`.e-st`, `.e-ready`, `.e-lamp`), the cards (`.e-cards`, `.e-card`, `.e-thumb`), the record's title row (`.e-rec`), the panel (`.e-panel`, `.e-tabs`, `.e-foot`), the tools (`.e-tools`), the map (`.e-map`, `.e-trayc`, `.e-mctl`), the steps (`.e-steps`, `.e-step`), the marked block (`.e-sel`), the phone (`.e-ph`, `.e-pfoot`, `.e-seg`).
- `p6-head.js`: the data (`ENC`, `MAPS`, `PARTY`) and the parts (`st()`, `ready()`, `who()`, `thumb()`, `recHead()`, `mapView()`, `tools()`, `whoRows()`, `rulesRows()`).
- `p6-body.js`: `front()` (the `shelf` branch), `enc()` (the `bench` branch), `makeNew()` (the `draft` branch), `grid()` (the `wizard` branch).
- `p6-dec.js`: the decisions and the rules. `p2b-mobile.css` and `p6-tail.js`: the mockup page's own phone bar and laptop view; mockup code only.
- `audit-e.js`: the stand-in maps and the "Today" screenshots.
