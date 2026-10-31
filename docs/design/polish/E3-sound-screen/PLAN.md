# E3 Sound and the screen: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the sound board as kinds at the side under one Playing bar with a
scrubber, puts library sounds on the board with kind chips, moves each encounter's sound onto its own page, and keeps
See as the table screen as today's swap, drawn to the theme. It adds one command, `sound.seek`, so the scrubber can move
the playing track; nothing else changes in data, routes or projections. File paths and line numbers were read at
`f5e166f`; the theme (T), the frame (A), Prep's frame (E) and the Table screen page (H) land on the same branch first or
alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `apps/`,
`packages/`, `e2e/` or `docs/`.

This is E3.2 in `../CATALOG.md`, with what H left for later (H rule 11). `SPEC.md` beside this file is what was decided;
this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, W0 to W6, each
  about one commit.
- The reference is `sound-and-the-screen.html` in this folder. Open it in a browser (fonts load from Google Fonts;
  everything else is inline). It opens on the approved choices. Use the Page switch (The board, What is playing, Putting
  a sound on, An encounter's sound, See as the screen). The GM is on both sizes. The other options are the ones the
  owner turned down; build only the chosen ones. `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its sounds and encounters
  are stand-ins. Build with the existing components, hooks and primitives, and with the settled ones (H's Table screen
  page, E's workbench, E2's folders at the side, T's Base line controls and sliders). Section 8 lists where the plan
  departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The sound board puts Playlist, Ambience, Effects and the library at the side, the chosen one at the right.
2. One Playing bar under the title row, simplified and consistent, with a scrubber.
3. A library sound goes on the board with its kind chips.
4. Each encounter's sound sits on its own page, under Light and sound.
5. See as the table screen keeps today's swap, opened from More.
6. Seven rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, the kit's menu and A's dialogs (A6), E's frame (E1 to E3: Prep's Titled bar, the workbench)
  and H's Table screen page (H4, H5: the title row with Display and Sound, the On the screen bar). E2's folders column
  (K1) is the model for the side list; if it is on the branch, share its component. If a piece this needs is missing,
  stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays: `GET /api/v1/game/sound`, `POST /api/v1/game/sound/arrange`, `.../play`,
  `.../pause`, `.../next-track`, `.../stop`, `POST /api/v1/game/encounters/{encounterId}/sound`,
  `GET POST /api/v1/sound-assets`, `DELETE PATCH /api/v1/sound-assets/{id}`, `GET /api/v1/sound-assets/{id}/content`,
  `POST /api/v1/viewer/sound-status`, and the scene preview's `encounter:preview` read.
- The one server change is phase W3's `sound.seek`: one command and its route, built the way `sound.next-track` is.
  Invariant 1 applies: the server decides the position; the client sends where the GM let go. If any other step seems to
  need a server, schema, command, route or projection change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done (and `npm run map` after W3), and look at the pages as section 6 says (the `verify` skill has the
  steps).

## 3. What is on the branch now

### 3.1 The sound board

- `sound/SoundBoard.tsx` (145 lines): `Transport` (20 to 87: `ScreenSoundStatus`, Music and Ambience as a list, Pause or
  Resume or Play music as the primary, Next track, Stop all, `LevelSlider` "Master volume"), `SoundBoard` (93 on: the
  heading "Shared display" and "Sound" with `SharedScreenSwitch`, then two columns: Music, Ambience and Effects; the
  library and `SceneSounds`). Mounted at `shell/GmShell.tsx:185` (lazy at 32); the route is `SOUND_BOARD_PATH`
  (`router.ts:157`), and Prep's Sound page points at it (`router.ts:221`).
- `sound/SoundSections.tsx` (187 lines): `MusicSection` (16: Shuffle, the rows with play, length, level, move and take
  off), `AmbienceSection` (91: a switch per layer), `EffectsSection` (138: a pad per effect).
- `sound/SoundLibraryPanel.tsx` (193 lines): `START_LEVEL` (14), upload (36 to 51), `add` (53 to 62: `sound:arrange`
  with the new slot), rename, `remove` with its confirm (75 to 90), and each row's three buttons (around 150 to 190).
- `sound/SceneSounds.tsx` (103 lines): `SceneSounds` (the board's Encounter sound section) and `SceneSoundRow` (the
  saved sound, Save or Replace, Starts when live, Play, Clear), also used at `scenes/SceneQuestions.tsx:178`.
- `sound/ScreenSoundStatus.tsx` (48 lines): each screen's state (Sound on, Waiting for a tap on the screen, Preview no
  sound, Checking sound) and "Can't play {names}".
- `sound/LevelSlider.tsx` (22 lines), `sound/NowPlaying.tsx` (99 lines, the table strip's chip, moved by C 2.1),
  `sound/sound-data.ts` (162 lines: `useSoundBoard`, `useSoundLibrary`, `useSoundCommand`, `playOrPause`,
  `formatDuration`), `sound/sound-board.css`.
- Tests: `sound/sound-board.test.tsx` (125 lines).

### 3.2 The server's sound

- `packages/domain/src/sound.ts`: `SoundPlaybackSchema` (30: `playId`, `startedAt`), `SoundCurrentTrackSchema` (37: with
  `assetId`, `volume`, `durationMs`), `SoundBoardSchema` (57: `pausedAt`, `music.current`, the layers, effects,
  presets).
- `packages/domain/src/commands.ts`: `SoundPlaySchema` (2678) and its neighbours; `packages/domain/src/socket.ts` (the
  `sound:*` events); `packages/api-contract/src/index.ts`: `GAME_PATHS.soundNextTrack` (404) and the `GAME_COMMANDS`
  rows (865 to 870).
- `apps/server/src/sound-board.ts` (443 lines): `trackBoundary` (47), `nextSoundEvent` (53), `resume` (59), `startTrack`
  (90), `nextTrack` (197), `setPaused` (254), `projectViewerSound` (381), `viewerSoundAt` (412: each item's `positionMs`
  from `startedAt`). `apps/server/src/commands/sound.ts` (162 lines: one entry per command, from `sound.arrange` at 47
  to `sound.set-encounter-preset` at 139), `apps/server/src/sound-service.ts` (191 lines: the timer that moves the
  playlist on).
- Tests: `apps/server/test/sound-board.test.ts`, `apps/server/test/sound-http.test.ts`.

### 3.3 An encounter and See as

- `scenes/SceneDocument.tsx` (313 lines): `seeAs` (72), the title row's See as Select (91 to 130), the phone's menu
  entries See as the table screen and See as {name} (138 to 152), `ScenePreview` (193). `scenes/ScenePreview.tsx` (94
  lines: the screen's stage, or the player's map).
- `scenes/SceneQuestions.tsx` (333 lines): the sound question (170 to 185: the hint, `SceneSoundRow`, Open the sound
  board).
- `settings/PlayersSection.tsx:171`: Preview the table screen.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                 | New or changed                                                             | Built from                                      |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| The side list        | Changed: the two columns become kinds at the side                          | E2's folders column, `SoundBoard`               |
| The Playing bar      | Changed: one row with the lamp, scrubber, three icon buttons, Master       | `Transport`, `ScreenSoundStatus`, `LevelSlider` |
| Seeking              | New: `sound.seek`                                                          | `sound.next-track`'s pattern                    |
| Kind chips           | Changed: the library's three buttons become chips that put on and take off | `SoundLibraryPanel`                             |
| An encounter's sound | Moved: off the board, onto the workbench's Light and sound                 | `SceneSoundRow`, `SceneQuestions`               |
| See as               | Changed: opened from More, the swap drawn to the theme                     | `SceneDocument`, `ScenePreview`                 |

How the parts fit, so the phases agree:

- The chosen part is in the address (`/viewer-controls/sound?part=playlist`, `ambience`, `effects`, `library`,
  `unused`), so a reload keeps it; Playlist is the default.
- The scrubber's position is worked out in the client from `music.current.startedAt`, `durationMs` and `pausedAt` (the
  same sum as `viewerSoundAt`), and redrawn about four times a second while playing. Dragging shows the new time under
  the thumb; letting go sends `sound.seek { positionMs }` once. The keyboard moves it 5 seconds an arrow.
- `sound.seek { commandId, positionMs }`: GM-grade, scope `encounter:write`, route `POST /api/v1/game/sound/seek`. With
  a current track, it clamps the position to the track's length and sets the track's start so it reads that position now
  (or at `pausedAt` while paused), with a new `playId` so every table screen starts it again there; the service re-arms
  the timer that moves the playlist on. With no current track it is refused with "Nothing is playing." Words in
  `commands/sound.ts`' style.
- Kind chips: an unlit chip adds the sound with `START_LEVEL` through `sound:arrange`, as `add` does now; a lit chip
  takes it off, as the sections' Take off does. One write each.
- The room's lamp reads `view.screens` the way `ScreenSoundStatus` does; the "muted" preview never counts.

## 5. Phases

### W0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `E3-sound-screen/`, and leave
   the other pieces' folders as the zip has them.
2. Add `E3-sound-screen/ADR-0065-sound-and-the-screen.md` as `docs/adr/0065-sound-and-the-screen.md`, Accepted, and its
   row to `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### W1: the board as kinds at the side

1. The Sound half of the Table screen page under H's title row; "Shared display" goes. The side list (ON THE BOARD:
   Playlist, Ambience, Effects; LIBRARY: All sounds, Not on the board) with counts, the chosen part in the address, and
   the chosen part at the right: `MusicSection`, `AmbienceSection`, `EffectsSection` and the library, drawn to the
   theme.
2. A phone: the parts as chips with their counts, the chosen part's rows under them.
3. Tests: `sound-board.test.tsx` updated (each part shows only its rows, the counts, the part in the address, Not on the
   board lists only sounds on no part).

### W2: the Playing bar

1. One row under the title row: PLAYING (or Nothing playing), the room's lamp with its words when something is wrong,
   the track and its layers, the scrubber showing the position (read-only until W3), Pause or Play, Next track, Stop all
   as icon buttons, and Master. The bar replaces `Transport`.
2. A phone: the stacked bar of `SPEC.md` 2.2.
3. Tests: the bar names the track and layers, the scrubber's time follows a fake clock, Pause and Play send
   `sound:pause`, Stop all sends `sound:stop` with `all`, the lamp reads a waiting screen.

### W3: seeking (the one server change)

1. `SoundSeekSchema`, the socket event, `GAME_PATHS.soundSeek` and its `GAME_COMMANDS` row, the command in
   `commands/sound.ts`, a `seekTrack` in `sound-board.ts`, the service's timer re-armed, and `npm run map`.
2. The scrubber drags: the time under the thumb while dragging, one `sound:seek` on release, arrows by 5 seconds.
3. Tests: `sound-board.test.ts` (seek sets the start and a new `playId`, clamps past the end, holds while paused, is
   refused with nothing playing, moves the next-track boundary), `sound-http.test.ts` (the route, GM-only, a player is
   refused), the viewer projection reports the new `positionMs`, and the client sends one command on release.

### W4: kind chips in the library

1. Each library row: the name, length and format, the Music, Ambience and Effect chips, and More (Rename, Delete with
   today's confirm).
2. Tests: an unlit chip adds with the start level in one write, a lit chip takes it off, Delete still confirms.

### W5: an encounter's sound on its page, and See as

1. `SceneSounds` leaves the board. The workbench's Light and sound tab holds the encounter's sound after the grid, walls
   and light, as `SPEC.md` 2.4; Save what plays now when nothing is saved.
2. See as moves into the workbench's More; while on, the title row's See as menu switches who and the map swaps under
   the cyan line with Back to your view; Settings' Preview the table screen opens H's picture in picture.
3. Tests: the scene's sound question (save, replace, starts when live, play, clear) on the page; the board shows no
   encounters; See as from More shows the screen's view and Back returns.

### W6: docs and cleanup

1. `docs/DESIGN.md`: the sound board's side list, the Playing bar, kind chips. `docs/ARCHITECTURE.md`: `sound.seek` and
   how the position is worked out.
2. `docs/adr/README.md`: 0065 Accepted and built. `docs/design/polish/CATALOG.md`: E3.2 and H's leftovers move to Built.
3. Remove what nothing uses: `Transport`, the board's two-column layout and `SceneSounds`, the library's three buttons,
   `SharedScreenSwitch` if the page's control replaces it.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a table screen connected (open `/viewer` in a second window and pair it), three tracks, three layers, five
  effects and three encounters, look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: each part at the side; the Playing bar playing, paused and with nothing playing; drag the
    scrubber and hear the table screen jump; a waiting screen's lamp; a chip putting a sound on and taking it off; an
    encounter's sound saved, replaced and played from its page; See as the table screen from More and Back.
  - 390 by 844 with touch: the same, with the chips, the stacked bar and More from the foot; every control at least 44
    px; no sideways scroll.
- As a player: nothing of the board reaches them; `sound.seek` is refused.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- Replays (E3.3 to E3.5) and the table strip's Now Playing chip (C 2.1 moved it into the Encounter tab).
- Every route, projection and stored value other than W3's command.

## 8. Departures from the mockup, on purpose

- The mockup draws the room's lamp only when all is well; section 2.2 of `SPEC.md` gives its words when a screen waits
  for a tap or none is connected.
- The mockup draws the encounter's sound alone in Light and sound; the app keeps the grid, walls and light above it.
- The mockup does not draw Nothing playing, More's Rename and Delete on a library row, or See as opened from More;
  sections 2 and 4 place them.
- The mockup's sounds, levels and encounters are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `sound-and-the-screen.html`.

- `p4j-sound.css`: rows and levels (`.w-row`, `.w-lvl`), pads (`.w-pad`), the side list (`.w-rail`, `.w-ri`), the
  Playing bar (`.w-bar`, `.w-scrub`, `.w-ctl`, `.w-vol`, `.w-room`), menus and dialogs (`.w-menu`, `.w-pick`), the
  preview line (`.w-pvline`). `p4i-tv.css` is H's page and screen; `p4f-prep.css` is E's frame.
- `p6-body2.js`: `board()` (the `rail` branch is the chosen board), `nowBar()` (the `onscreen` branch), `libRow()` (the
  `chips` branch), `soundTab()` and `encPage()` (the encounter's sound), `encLap()` and `encPhone()` (the `today` branch
  of See as); the stand-in sounds and encounters at its head.
- `p6-dec2.js`: the decisions, the Carried in list and the rules. `p6-body.js` and `p6-head.js` are H's mockup parts.
- `audit-s.js`: the "Today" screenshots and the map.
