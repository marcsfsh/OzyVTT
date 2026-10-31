# H The table screen: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the TV's live screen as the turn ladder, its pairing and waiting
screens on the horizon line, the GM's table screen page as screens that open as remotes, and the preview as a picture
in picture. It adds no rules, commands, routes on the server or data. File paths and line numbers were read at
`f5e166f`; the theme (T) and the frame (A) land on the same branch first or alongside, so confirm every anchor before
editing. Paths are under `apps/client/src/` unless they start with `apps/`, `packages/`, `e2e/` or `docs/`.

This is area H in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, H0 to H6, each
  about one commit.
- The reference is `table-screen.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything
  else is inline). It opens on the approved choices. Use the Page switch (The TV in a fight, A map with no fight,
  Pairing a TV, Paused, Waiting for a map, The screens, A screen open, In the menu, The preview). In the GM's frames, a
  screen's card opens it and the crumb or Back returns. The other ladders in the first switch are the ones the owner
  turned down; build only Ladder, refined. On a phone the page has its own bar and a Close up, Whole and Turned laptop
  view. `history/` holds rounds 1 and 2 as they were shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its map, portraits and
  screens are stand-ins. Build with the existing components, hooks and primitives. Section 8 lists where the plan
  departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top, and `writing.test.ts` checks it; `play-vocabulary.test.ts` scans `viewer/` (145).

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The TV in a fight is the turn ladder, refined: the order down the left with the acting row grown into a card, NEXT in
   cyan, a GM turn for a hidden creature, the latest roll at the ladder's foot, and the map beside it with nothing over
   it. On a phone held upright it stacks. The owner chose the ladder in round 1 and the refined ladder over a rolling
   ladder and a glass ladder over the map in round 2.
2. Pairing, connecting, paused and waiting for a map are the horizon line.
3. The GM's page is Table screen: what is on the screen as a bar, the screens as cards with live pictures, and a card to
   pair another. A screen opens as a remote with a large live picture to press for focus, ping and measure.
4. The menu keeps the frame's Table screen row; Preview it here docks a picture in picture at the bottom right.
5. Eleven rules for the table screen (`SPEC.md` section 3), starting with the TV showing only what it already gets and
   one name, Table screen.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin (one surveyed for this plan was 26 commits behind), so pull before reading any anchor.
- H builds on T and A. T1 to T3 (the Base line, `Group`, the Titled section bar and the phone header) and A1 (the menu
  with the Table screen row, `useTableScreen` and `TableScreenRows`) must be on the branch before H4. H2 and H3 need
  only T1. If one is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. The server decides and projections are the boundary. The TV reads
  `GET /api/v1/viewer/presentation` and the stream `GET /api/v1/viewer/events`, both answered by
  `coordinator.project()` (`apps/server/src/viewer-coordinator.ts` 95 to 100: the stored presentation, the sound
  board's output and the latest public roll). Both routes accept the GM's session too (`apps/server/src/viewer-http.ts`
  63 to 68, 212 to 236; the GM's stream is `connectGm` and does not count as a screen). No server code, shared domain,
  schema, command or HTTP route changes, and no new field reaches the TV. If a step seems to need a server change, stop
  and tell the user.
- `scenes/ScenePreview.tsx` (6, 68) reuses `MapStage` from `viewer/ViewerApp.tsx`; keep that export and its props
  (`scenes-tab.test.tsx:229` needs `.sc-preview-screen .viewer-stage`).
- `docs/DESIGN.md`: the page never scrolls; every GM control keeps a 44 px hit area; a preview is the real thing.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the TV and the GM's pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The TV page and its states

- `apps/client/viewer.html`: `<title>Table Viewer</title>` (7), the theme script (8 to 41), `#viewer-root` (44),
  `src/viewer-main.tsx` (45; it imports `viewer/viewer-page.css` and renders `ViewerApp`, 7 to 20). The server sends
  `GET /viewer` to `/viewer.html` (`apps/server/src/server.ts` 998, 1005).
- `viewer/ViewerApp.tsx`: `Presentation` mirrors the projection (31 to 109), `ConnectionState` (111), `connect()` (478
  to 514: the presentation, then an `EventSource`; a 401 sends it to pairing). The states:
  - Unpaired (520): `viewer/ScreenPairing.tsx`, `main.viewer-pairing` (80), eyebrow "TABLE SCREEN" (82), h1 "Pair this
    screen" `#pair-title` (83), "On the GM's device, open Shared screen and enter this code." (86), the code
    `strong.viewer-screen-code` with its aria-label "Pairing code 4 8 2 …" (87 to 92; `spacedCode` 14), the note (93 to
    95), "Getting a code…" (98), `.viewer-feedback` (100 to 104), the busy and unreachable messages (61, 68), polling
    (9, 11).
  - Connecting or reconnecting with no data (521 to 528): `main.viewer-waiting`, eyebrow "Table screen", h1
    "Reconnecting…" or "Connecting…", a `p role=alert`.
  - Paused (531 to 539): eyebrow "Connected", h1 "Presentation paused", "The GM will begin when the table is ready.", and
    the sound button.
  - Enabled with no map: inside `MapStage` (262 to 269), `section.viewer-waiting` with "Connected", "Waiting for a map"
    and "The GM controls what appears here.", drawn inside `viewer-shell`, so the strip and the column still show.
  - Live (540 to 565): `ScreenTop`, `MapStage`, `ScreenColumn`, Fullscreen, the connection pill, the sound.
- CSS `viewer/viewer.css`: the idle states 9 to 84, the shell grid 85 to 94 (the column `clamp(17rem, 28.125vw,
  540px)`, rows `auto 1fr`), the stage 95 to 150 with the corner brackets as `.viewer-stage::after` (111 to 144),
  tokens 179 to 241, measurement and pings 242 to 284, the waiting state in the shell 285 to 288, the fading controls
  289 to 329, `@media (max-aspect-ratio: 4/3)` 340 to 345, the sound button 442 to 483.

### 3.2 The live screen's parts

- `viewer/ScreenParts.tsx`: `screenTiles()` (27 to 37), a character's first name only (58 to 60), `ScreenTop` (66 to
  114: `Wordmark variant="cabinet"` 71, `VcrCounter` 72, `ol.screen-tiles` "Turn order, round N" 74, the GM turn tile
  75 to 79, each tile's label "{name}, initiative N[, acting|, next]" 87, the NEXT tag 97 to 101), `ActingNow` (117 to
  162: idle "No encounter running" with the map's alt text or "The table" 119 to 125; the GM turn 126 to 132; "Round N"
  with "Waiting for the first turn" 136 to 142; acting, region "Acting now: {name}" with "Next: {name}" 155 to 159),
  `diceWords` (165 to 169), `LatestRoll` (174 to 209: "No roll to show yet." 182 to 184; region "Latest roll: {who},
  {what}, {total}" 192 with the NAT tag), `ScreenColumn` (214 to 252: aside "The turn and the latest roll" 235, the
  resize separator "Drag to resize the column" 237 to 244).
- The column's width is dragged and kept in localStorage `vtt.viewer-initiative-width` (`ViewerApp.tsx` 455 to 462) as
  `--viewer-column-width`. Follow GM view is kept in `vtt.viewer-follow-gm` (126).
- `packages/ui/src/primitives/VcrCounter.tsx`: PLAY or STOP, its label "Round N" or "No encounter running" (26).
- CSS `viewer/screen-parts.css`: the strip 3 to 101, the column 103 to 148, the cards 149 to 223, and the
  `max-aspect-ratio: 4/3` layout 225 to 250 (the column under the map, cards side by side at `max-height: 32vh`, the
  strip wrapping). There is no orientation query: a phone held upright and a 4:3 screen get the same layout.
- The data (`apps/server/src/viewer-presentation.ts`): `ViewerInitiative{visible, round, hiddenTurn, entries}` (75 to
  80) with entries `{actorId, name, initiative, active, health band, conditions}` (23 to 35); tokens (82 to 99);
  `ViewerPresentationProjection` (144 to 154). `hiddenTurn` is set in `viewer-encounter.ts:30`. The roll card is
  `ViewerRollCard{who, what, total, dice, modifier, at}` (`viewer-roll.ts` 10 to 21).

### 3.3 The screen's own controls and sound

- The wake (`ViewerApp.tsx` 463 to 476): pointer and key input set `is-awake` for 4000 ms; `viewer.css` 305 to 309 fades
  Fullscreen (551 to 559), the zoom group "This screen's zoom" (427 to 442: Zoom in, Zoom out, Fit the map, Follow GM
  view) and the Live pill (560 to 562). Reconnecting does not fade.
- `viewer/TableSound.tsx`: "Tap to turn on sound" (75 to 84, `viewer-sound-unlock` with `.waiting`), silent with
  `?preview` (11), reported through `POST /api/v1/viewer/sound-status`.

### 3.4 The GM's page

- `/viewer-controls` (`GM_TAB_PATHS.viewer`, `shell/router.ts:146`), the sound board at `/viewer-controls/sound` (157),
  mounted in `shell/GmShell.tsx` 183 to 207 (lazy at 31 to 32). Reached from the lamp's "Table screen settings"
  (`table/TvControl.tsx:112`) and search's "Table screen" (`shell/AppBar.tsx:248`).
- `viewer/ViewerControls.tsx`: `SOUND_WORDS` (29 to 34: "Sound on", "Sound waits for a tap on the screen", "Preview, no
  sound", "Checking sound"); `refresh()` every 5 s (92 to 115: the presentation, `GET /api/v1/viewer/access` with
  `{viewers, connections}`, and `GET /api/v1/host/gm/viewer-urls`); commands (133 to 139); the screen count (147, 209
  to 211); the head (202 to 213: h2 "Shared screen", the line, `SharedScreenSwitch`); the tools (216 to 351: the
  no-map notice 221 to 226, h3 "Focus, ping and measure" 230, the group "Presentation tool" with Focus view, Ping
  point, Measure line 237 to 247, the clickable map `.viewer-tool-preview` 250 to 279, the X, Y, Zoom and "Displayed
  distance" fields 280 to 330, Send focus, Send ping or Show measurement 337, Clear measurement 345, the toasts 182);
  the access column (354 to 471: "Open on the table screen" 356, the address `Select` "Second-screen network address"
  359 or `code` 370, Copy address and "Viewer address copied." 372 to 374, `PairScreenForm` 376, Pause presentation or
  Present {map} or Present a map 377 to 394, This map is on the screen or Show {map} instead 410 to 414, Preview the
  screen 416 to 420, Open a screen here 421 to 423, h3 "Paired screens" 427 with Revoked, "Connected · {sound}" or "Not
  connected" 434 to 438, Revoke with the confirm "Revoke {name}?" 449 to 463).
- `viewer/PairScreenForm.tsx`: h3 "Pair a table screen" (54), its line (55), "Code on the screen" (57), "Screen name"
  defaulting to "Table screen" (24, 67), Pair screen (70 to 72), the toast "{name} is paired. It shows the table in a
  moment." (36).
- `viewer/SharedScreenSwitch.tsx` (9 to 15): the group "Shared screen controls" with Display and Sound.
- CSS `viewer/viewer-controls.css` (332 lines): two columns at 1280 px and wider (268 to 297), narrow at 560 px (298 to
  332).

### 3.5 The lamp and the preview

- `table/TvControl.tsx`: the label "Table screen, {status}" (69), the trigger (70 to 81), the items (83 to 112: Pause the
  table screen, Show the live encounter, Preview the table screen here or Hide the preview, Table screen settings).
  A1 moves its state and actions into `useTableScreen` and `TableScreenRows` inside the menu.
- `viewer/preview-open.ts` (`setViewerPreviewOpen` 8, `useViewerPreviewOpen` 14); the panel mounts in `GmShell.tsx:244`
  and opens from the page (194), the lamp, and Settings' "Preview the table screen" (`settings/PlayersSection.tsx` 171
  to 173).
- `viewer/ViewerPreviewPanel.tsx`: a 1920 by 1080 screen scaled (10 to 12), placed at the top right up to 480 px (25 to
  33), the session `POST /api/v1/viewer/preview-session` (51), drag and resize (74 to 97), Pop out
  `window.open('/viewer.html?preview', …)` (98 to 102), the dialog "Table screen preview" (108), its title bar "Table
  screen", "What the screen shows", Pop out, "Close the preview" (114 to 128), its errors (131, 133), the iframe "Live
  preview of the table screen" (138). CSS `viewer/viewer-preview.css`.

### 3.6 Tests that pin it

- `viewer/screen-pairing.test.tsx`: "482 913" and the request order (28 to 52); the form (54 to 85: Pair screen
  disabled, "Code on the screen", the body with `name: "Table screen"`, the toast "Table screen is paired. It shows the
  table in a moment.").
- `viewer/screen-parts.test.tsx`: the tiles' flags (39 to 52); img "Round 3", list "Turn order, round 3", items "Goblin
  Boss, initiative 17, acting" and "Borin Stoneguard, initiative 14, next", text "Lyra", region "Acting now: Goblin
  Boss", "Next: Borin Stoneguard" (54 to 69); `.screen-tile img` sources (71 to 79); region "GM turn" (81 to 94);
  "No encounter running" with "Goblin warren" and "No roll to show yet." (96 to 107); "Latest roll: Lyra, Fire Bolt,
  19", "d20 12 +7" and `diceWords` (109 to 125).
- `drag-surfaces.test.tsx` 150 to 156 (`.viewer-stage`, `.screen-column-resize`, `.viewer-preview-titlebar`,
  `.viewer-preview-resize`); `shell/app-bar.test.tsx` (77, 84 to 91, 105 to 114); `shell/shared-screen-map.test.tsx`
  31 to 39; `shell/router.test.ts` (44 to 56, 280, 618 to 633); `design-conventions.test.ts` (raw number inputs in
  ViewerControls 116 to 118, colour literals 201 to 202, `setMessage` counts 239 to 240, `32vh` 294);
  `play-vocabulary.test.ts` (145, and 162 pins `encounter/GmEncounterPanel.tsx:296` word for word);
  `shell/theme-startup.test.ts:67` and `lib/zoom-guard.test.tsx:184` read `viewer.html`.
- Server tests stay as they are: `apps/server/test/viewer-*.test.ts`.
- e2e: `journeys.spec.ts` 146 to 158 (heading "Pair this screen", `.viewer-screen-code`, `openGmSection("Table
  screen")`, "Code on the screen", "Screen name", Pair screen, the toast with "Living room TV", "1 screen connected"),
  654 to 701 (heading "Presentation paused", heading "Shared screen" at level 2 at 690, "Den TV", the button
  `/^Present /`, the map by its alt text, Pause presentation, `expectPageFits` on the viewer), 705 to 767 (Sound,
  "Tap to turn on sound" 740, "Smoke TV · Sound on" 748); `e2e/smoke.ts` 246 to 270 (`openGmSection`).

### 3.7 Words to change (rule 3.2)

- `viewer/ViewerControls.tsx:204` "Shared screen"; `viewer/SharedScreenSwitch.tsx:9` "Shared screen controls";
  `viewer/ScreenPairing.tsx:86` "open Shared screen"; `sound/SoundBoard.tsx:117` "Shared display"; `viewer.html:7`
  "Table Viewer"; `viewer/ViewerApp.tsx` 280, 291 "Shared battlemap"; `ViewerControls.tsx` 359 "Second-screen network
  address" and 372 "Viewer address copied.".
- In other copy: `scene/TokenContextMenu.tsx` 337 to 338, `encounter/GmEncounterPanel.tsx:296` (pinned by
  `play-vocabulary.test.ts:162`), `scenes/sceneActions.tsx:32`.
- Comments only: `SharedScreenSwitch.tsx:4`, `SoundBoard.tsx:88`, `sound-board.css:1`, `router.ts` 156, 326,
  `GmShell.tsx` 95, 124, 183, `viewer.css` 1, 485, `viewer-page.css:8`, `viewer-controls.css` 1 to 2,
  `ViewerPreviewPanel.tsx:36`.
- The API's tag "Table viewer" (`packages/api-contract/src/routes/viewer.ts`, `routes/tags.ts:41`,
  `integrations/openapi-model.ts:162`) is the API's own name and stays (section 7).

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The ladder | New, replaces the strip and the column | `ScreenTop`, `ActingNow`, `LatestRoll`, `screenTiles`, `VcrCounter` |
| The live screen's grid | Changed: the ladder at the left, the map in the rest | `viewer.css` shell grid, `ScreenColumn`'s resize |
| The horizon screens | Changed: pairing, connecting, paused, waiting for a map | `ScreenPairing`, `ViewerApp` states |
| `ScreenPicture` | New: the live screen drawn small in the GM's pages | `MapStage`, the ladder, the GM's event stream |
| The screens page | Redrawn | `ViewerControls`, `PairScreenForm`, `useTableScreen` |
| A screen as a remote | New page | `ViewerControls`' tools and commands |
| Picture in picture | Changed: docked | `ViewerPreviewPanel`, `preview-open` |

How the parts fit, so the phases agree:

- The live screen is one grid: the ladder in the first column (`--viewer-column-width`, default `clamp(17rem, 31.25vw,
  600px)`, the drag handle and its stored width kept), the map in the second. The ladder is a `section` with the head
  (wordmark and `VcrCounter`), the rows as today's `ol` "Turn order, round N" with one `li` per entry, and the foot
  (`LatestRoll`). The rows keep today's labels: "{name}, initiative N, acting" and ", next"; the acting row is also the
  region "Acting now: {name}" (or "GM turn"), so screen readers and tests find the same things.
- A phone held upright (`orientation: portrait`) stacks: the head, the rows, the roll as one row, the map in the rest. A
  4:3 screen in landscape keeps the ladder at the left at its narrower width. Replace the `max-aspect-ratio: 4/3` rules
  with these two.
- A long order: the rows scroll inside the ladder, and the shell keeps the acting row and the next in view when the turn
  changes (`scrollIntoView({ block: "nearest" })` on the acting row, with reduced motion respected). Names never shrink
  below the row's size; the acting name shrinks one step (28 to 22 px at 1280) before a word would break, and wraps
  between words.
- `ScreenPicture({ width })` draws the live screen at 1280 by 720 scaled to `width`, inert (no fading controls, no
  sound, no resize handle, `aria-hidden` with a text alternative "What the table screen shows: {map}"). It takes the
  presentation from one GM subscription to `/api/v1/viewer/events` (the GM's session is accepted, and the GM's stream
  does not count as a screen), opened by the page and shared by every picture on it. The remote's picture is the same
  component, made pressable.
- The remote is a page at `/viewer-controls/screens/<viewerId>`. Add it to `router.ts` (`isKnownPath`, the GM paths)
  beside `/viewer-controls/sound`; an unknown or revoked id returns to `/viewer-controls`. Presses on the picture map to
  the map's coordinates through the picture's scale and `MapStage`'s view, then send today's commands.
- The picture in picture is `ViewerPreviewPanel` docked: today's preview session and iframe, 420 px wide at the bottom
  right (20 px in), a corner the GM can drag it to (bottom right, bottom left, top right, top left), kept in
  localStorage with the open state. It is not drawn on `/viewer-controls` and its screen pages.

## 5. Phases

### H0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `H-table-screen/`, and leave the
   other pieces' folders as the zip has them.
2. Add `H-table-screen/ADR-0056-table-screen.md` as `docs/adr/0056-table-screen.md`, Accepted, and its row to
   `docs/adr/README.md`. Note on the rows of the ADRs that set the table screen's frame (the table viewer, its pairing
   and the lamp) that 0056 changes it. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### H1: one name

1. Change every word in section 3.7 to Table screen: the page's h2 "Table screen", the switch's group "Table screen
   controls", "On the GM's device, open Table screen settings and type this code.", the sound page's eyebrow "Table
   screen", `<title>Table screen</title>`, the map's label "The map on the table screen", the address `Select` "Table
   screen address" and the toast "Address copied.", and the lower-case "shared screen" in the three files of other copy
   (as "table screen").
2. Comments: the same words.
3. Tests: `play-vocabulary.test.ts:162` (its pinned sentence), `journeys.spec.ts:690` (heading "Table screen"),
   `shared-screen-map.test.tsx`, `theme-startup.test.ts:67` and `zoom-guard.test.tsx:184` if they read the title.

### H2: the ladder

1. A new `viewer/ScreenLadder.tsx` from `ScreenTop`, `ActingNow` and `LatestRoll`: the head (the wordmark at the
   ladder's size and `VcrCounter`, with "Waiting for the first turn" under the round when no entry is active), the
   rows, and the foot. Each row: the initiative in VT323, the portrait (today's `.screen-tile img` source, or the
   dashed GM turn), the name in full, the NEXT tag. The acting row: the caution edge and wash, the larger portrait,
   "Acting now" and the name in chrome; for the GM turn, "GM turn" with its portrait. With no encounter running: the
   head says STOP and RND --, and one row names the map under "No encounter running" (the map's alt text or "The
   table").
2. The foot: today's `LatestRoll` drawn as `SPEC.md` 2.1 says (who and what, the total with the NAT tag, the dice in
   quiet VT323; "No roll to show yet.").
3. `ViewerApp`'s live shell: the ladder and `MapStage` in the grid of section 4, with Fullscreen, the zoom group, the
   pill and the sound as today. The resize separator moves to the ladder's edge with its label, class and stored width.
4. `screen-parts.css` and `viewer.css`: the ladder's values (`SPEC.md` 4), the portrait and 4:3 rules of section 4,
   the long order's scroll. Remove the strip's and the column's rules that nothing uses.
5. Tests: `screen-parts.test.tsx` moves to the ladder (the list and its items' labels stay; "Lyra Emberwise" in full;
   the acting region; the NEXT tag on the next row instead of the "Next:" line; the GM turn; no encounter; the roll and
   `diceWords`), a test that a long order keeps the acting row in view, `drag-surfaces.test.tsx` for the moved handle,
   `design-conventions.test.ts` 294 when `32vh` goes.

### H3: the horizon screens

1. One `viewer/HorizonScreen.tsx` ({eyebrow, heading, children}) used by `ScreenPairing`, the connecting state, the
   paused state and waiting for a map: `--void`, the horizon line at 46%, the eyebrow and heading above it, the rest
   below it (`SPEC.md` 2.2 and 4).
2. Pair this screen: the code (keep `strong.viewer-screen-code` and its aria-label), the line, the note, "Getting a
   code…" and the errors, all below the line.
3. Paused: heading "Paused". Waiting for a map: the whole screen, outside the live grid (move it out of `MapStage`
   262 to 269 into `ViewerApp`'s states, so the ladder does not show with no map). The sound button keeps its place at
   the bottom left on every state.
4. Tests: `screen-pairing.test.tsx` (unchanged words, plus the heading), `journeys.spec.ts` 146 to 158 (heading "Pair
   this screen" holds) and 654 to 701 (heading "Paused"), `design-conventions.test.ts` 239 to 240 if the `setMessage`
   counts move.

### H4: the screens page

1. `ViewerControls` becomes the screens page under T's title row: Table screen, its line, the Display and Sound switch,
   and the screen count.
2. On the screen as one bar: the lamp and ON or Paused (from `useTableScreen`), the map's name and what it is, Pause the
   table screen (or Present {map} while paused), and a Present a map menu with today's actions (Present {map} or Show
   {map} instead, Show the live encounter).
3. The cards, three to a row: each viewer that is not revoked, connected ones first, with `ScreenPicture` (section 4),
   the lamp, the name, `Connected · {SOUND_WORDS}` or "Last seen {date}" (from `lastUsedAt`), and Open; a screen not
   connected shows "Not connected" in place of the picture. The card is a link to its remote page.
4. The last card, Pair another screen: the line, the address `Select` and Copy address, `PairScreenForm`'s fields and
   Pair screen as the Cup, and Open a screen here (today's link). After pairing, the new screen's card appears when it
   connects (today's toast stays).
5. The line under the cards: "Open a screen to point at the map it shows: focus, ping and measure." With no map on the
   screen, today's notice (221 to 226) takes its place.
6. A phone: the switch, On the screen with Pause and Present a map, the connected screens as cards with their pictures,
   the others as rows, and Pair another screen as a row that opens the pairing form in a sheet from the bottom.
7. Tests: a new `viewer/screens-page.test.tsx` (cards for paired screens, none for revoked ones, connected first, the
   sound words, Last seen, the pair card's fields and Pair screen, the bar's actions while live and while paused);
   `shared-screen-map.test.tsx` (the offered map in the Present a map menu); `journeys.spec.ts` 146 to 158 (the labels
   hold; on a phone open "Pair another screen" first) and 654 to 701 (open Present a map, then `/^Present /`);
   `design-conventions.test.ts` 116 to 118 as the fields move.

### H5: a screen as a remote

1. The route in section 4, rendered by a new `viewer/ScreenRemote.tsx`: the crumb "Table screen" back to the page, the
   screen's name, "Connected · {sound} · paired {date}" (`createdAt`), and Revoke this screen (today's confirm; after it
   the page returns to the screens).
2. The tools as a segmented control over the pressable `ScreenPicture` (880 px at 1280, the cyan edge): Ping a point
   sends on press; Focus view sends on press with the zoom stepper beside the control; Measure adds a point per press,
   with Show measurement, Clear measurement and the displayed distance under the picture. The line under the picture
   names what a press does and that every paired screen shows it. Today's X, Y and zoom fields stay under a "Type a
   point" disclosure for the keyboard. Today's toasts stay.
3. The side: On the screen (the bar's actions as a column) and Other screens (each other viewer as a row with Open).
4. A phone: the header with Back and the screen's name, the state, the picture at the width, the tools, the line, On
   the screen and Other screens, with Pause and Present a map pinned at the foot.
5. Tests: a new `viewer/screen-remote.test.tsx` (a press pings at the mapped point through the commands route; Focus
   and Measure; Type a point; Revoke returns to the page; an unknown id returns to the page); `router.test.ts` for the
   new path (44 to 56, 618 to 633).

### H6: the picture in picture, docs and cleanup

1. `ViewerPreviewPanel` docked (section 4): the bar with the lamp, "Table screen" and ON, Pause, Pop out and Close
   (`IconButton`s with today's names), the picture, a corner the GM drags it to, kept with the open state; not drawn on
   the table screen pages. The first docking shows the toast "The preview stays here on every page. Drag it to another
   corner." once per device. Resizing goes; the width is fixed (`SPEC.md` 4).
2. The menu's row (A1's `TableScreenRows`): "Preview it here" or "Hide the preview", "Pause the table screen" or "Show
   the live encounter", "Table screen settings". Settings' "Preview the table screen" opens the same.
3. A phone: 250 px at the bottom right above the tabs, with the lamp, Pause and Close; pressing the picture opens the
   table screen page.
4. `docs/DESIGN.md`: the table screen section (221 to 232, now stale: it says the roll display is not available) as
   `SPEC.md` 2.1 to 2.4; 156 (the acting name in chrome, kept whole); 187 to 188 (the page opens from the menu); 241
   (the screen reflows by orientation).
5. `docs/ARCHITECTURE.md`: the table screen (18 to 21, 33, 178 to 191: the projection is unchanged; the GM's pictures
   read the GM's stream), 1084 to 1086 and 1114 to 1121 (the lamp is a menu row and the preview docks), 973 to 983 (the
   sound button's place).
6. `docs/adr/README.md`: 0056 Accepted and built. `docs/design/polish/CATALOG.md`: H moves to Built.
7. Remove what nothing uses: `ScreenTop`, `ScreenColumn` and the tile CSS if the ladder replaced them, the two-column
   rules of `viewer-controls.css`, the preview's resize handle and its CSS (and its line in `drag-surfaces.test.tsx`).

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a TV window paired, the old road presented, an encounter of five or more with a hidden creature started and a
  roll made, look in Dusk and Dawn at:
  - The TV at 1280 by 720 and 1920 by 1080: the ladder (the acting card with the name whole, NEXT, the GM turn row,
    the roll with its NAT tag), the map with nothing over it, the controls fading after 4 s, Reconnecting staying, the
    drag handle; then a long order (ten entries) as the turn moves down it; no encounter (the map named); before the
    first turn.
  - The TV at 1024 by 768 (4:3) and a phone held upright at 390 by 844: the ladder at the left on 4:3, the stack on the
    phone, every name whole, no sideways scroll.
  - Pairing, Connecting, Paused and Waiting for a map, and Tap to turn on sound on each.
  - The GM at 1280 by 800 with a mouse: the screens page with two paired screens (one connected), pairing a third,
    Present a map's actions, Pause and Present again, opening the connected screen, pinging, focusing and measuring on
    the picture and seeing it on the TV, Type a point, Revoke, the picture in picture on another page, dragging it to
    each corner, Pop out, Close.
  - The GM at 390 by 844 with touch: the screens page, the pairing sheet, a screen's remote with its pinned actions, the
    picture in picture above the tabs; every control at least 44 px; no sideways scroll.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable: pairing and its errors, the preview session, Pop out, Open a screen
  here, Copy address, the sound page, the lamp's actions, revoking, and the scenes' preview (`ScenePreview`).

## 7. Left as they are, for later rounds

- The Sound half of the page (`sound/SoundBoard.tsx`), the scenes' See as: screen (`scenes/ScenePreview.tsx`) and
  Settings' table screen rows (`settings/PlayersSection.tsx`). They take the frame now and their own designs later.
- The API's tag name "Table viewer" and every OpenAPI description.
- Every command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's remote has Present another map and Show the live encounter as buttons; the app keeps the bar's actions
  (Pause, and the Present a map menu with today's actions) in the same column.
- The mockup draws one connected screen and one not connected; the app draws a card for every viewer that is not
  revoked.
- The mockup does not draw Connecting, before the first turn, a long order, 4:3, Type a point, the measurement's
  buttons, the pairing sheet on a phone, or the picture in picture's other corners; sections 4 and 5 place them.
- The mockup's portraits are icons; the app keeps today's portraits from the token art.
- The mockup's map, its tokens and the screens' names are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `table-screen.html`.

- `p4i-tv.css`: the round 1 parts (`.h-tv`, `.h-map`, `.h-tok`, `.h-port`, `.h-vcr`, `.h-hz`, `.h-card`, `.h-glass`,
  `.h-code`, `.h-thumb`, `.h-pip`, `.h-srow`, `.h-dot`) and, under "Round 2", the ladder (`.h-lad`, `.h-lr`, `.h-lr.act`,
  `.h-lr.gm`, `.h-lr.calm`, `.h-lfoot`, the portrait rules), the sound button (`.h-snd`), the screen cards
  (`.h-scard`, `.h-open`), the crumb (`.h-back`) and the remote (`.h-remote`). The other options' parts sit beside
  them. `p4f-prep.css`, `p4g-codex.css` and `p4h-comp.css` hold E's, F's and G's shared parts.
- `p6-head.js`: the data (`TURNS`, `ROUND`, `ROLL`, `TOKS`, `CODE`), the parts (`port()`, `wm()`, `vcr()`, `lamp()`,
  `mapLayer()`) and the frames (`tvFrame()`, `topBar()`, `gmLap()`, `gmPhone()`).
- `p6-body.js`: `fightInner()` and `fight()` with `ladder()`, `lrow()` and `rollFoot()` (the `refined` branch);
  `calm()`; `horizon()` for pairing, paused and waiting; `miniTV()`; `screensPage()`, `screenPage()`; `menuPage()`,
  `pipPage()`.
- `p6-dec.js`: the decisions and the rules. `p2b-mobile.css` and `p6-tail.js`: the mockup page's own phone bar, laptop
  view and the in-frame clicks; mockup code only.
- `audit-h.js`: the "Today" screenshots.
