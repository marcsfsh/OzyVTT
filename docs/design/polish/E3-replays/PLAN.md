# E3 Replays: building them

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the replays list as a table with the chosen replay beside it, puts
the whole fight beside the map while watching, turns the transport into a line of rounds with Launch at its end, and
gives a player's shared replays cards under the sheet. It adds no rules, commands, routes, projections or data. File
paths and line numbers were read at `f5e166f`; the theme (T), the frame (A), Prep's frame (E), E2's lists (K) and the
sound round (W) land on the same branch first or alongside, so confirm every anchor before editing. Paths are under
`apps/client/src/` unless they start with `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is E3.3 to E3.5 and C4.6 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to
build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, Y0 to Y6, each
  about one commit.
- The reference is `replays.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is
  inline). It opens on the approved choices. Use the Page switch (The list, Watching, A player watching, The GM's
  actions, A player's replays). The list's chosen option is the sixth button, A table, the replay beside it, which puts
  two of the round's options together. The other options are the ones the owner turned down; build only the chosen ones.
  `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its map is a stand-in and
  its fight is invented. Build with the existing components, hooks and primitives, and with the settled ones (E's shelf
  cards, E2's thing beside its list, E3's scrubber, T's glass, A's menu and dialog). Section 8 lists where the plan
  departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The list: a table at the left, the chosen replay beside it with its map, who fought, Players see it and Watch.
2. Watching: the transport and the map at the left with the order on glass, the whole fight at the right.
3. Moving: a line of rounds with a tick a turn and marks for damage, healing and a creature going down.
4. The GM's actions: Launch from turn {n} at the end of the line; the rest in More; the date to the right of the name.
5. A player's replays: cards under the sheet.
6. Six rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, A's dialogs (A6) and the kit's menu, Prep's frame (E1), E2's lists (K1, K2) and the sound
  round's Playing bar (W2). If a piece this needs is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays: `GET /api/v1/replays`, `DELETE GET /api/v1/replays/{id}`,
  `POST /api/v1/replays/{id}/launch`, `POST /api/v1/replays/{id}/name` and `POST /api/v1/replays/{id}/visibility`, and
  the `replay.launch` command. If any step seems to need a server, schema, command, route or projection change, stop and
  tell the user.
- A player's replay is `PlayerReplayDocument`, built by `apps/server/src/replay-projection.ts`. Draw a player's list,
  cards and viewer only from it and from the player's list; never from the GM's archive.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

- `replay/ReplayList.tsx` (222 lines): `ReplayList` (16), `setShared` (34), `download` (51), `remove` (63, "Delete this
  replay?"), the head (86), the rows (104 to 139) with `RevealSwitch`, Watch and More (128 to 135), `RenameReplay`
  (162).
- `replay/ReplayViewer.tsx` (376 lines): `ROUTED_REFUSALS` (29), `useReplayName` (33), `GmViewer` (41) with `launch`
  ("Launch from this moment?"), the header with Launch from here and Download JSON, `Transport`, `Stage` and
  `ReplaySide`; `PlayerViewer` (234); `ReplayViewer` (357).
- `replay/ReplayStage.tsx` (281 lines): `when` (11), `useArchiveDocument` (18), `usePlayback` (41, 2.5 seconds a turn),
  `Stage` (69), `Transport` (153), `ReplayFrame` (212, the arrow keys), `ReplayNotice` (240), `ReplaySide` (254, Turn
  order and This turn).
- `replay/replays.ts` (161 lines): `ArchiveSummary`, `ArchiveDocument`, `PlayerReplayDocument`, `readArchive` (67),
  `replayTitle` (74), `replayMeta` (79), `durationOf` (86), `exportDocument` (95), `stepsOf` (105), `useReplays` (131).
- `replay/ReplayShelf.tsx` (26 lines): `ReplayShelf` (8), mounted in `shell/TableView.tsx` (221) under the sheet when no
  encounter runs.
- `replay/replay.css` (334 lines): `.replay-transport` (73), `.replay-layout` (95), `.replay-row` (254).
- Mounts: `shell/GmShell.tsx` (213, the GM's list), `shell/PlayerShell.tsx` (70), `shell/LayerView.tsx` (78, the
  viewer).
- Tests: `replay/replay-list.test.tsx`, `replay/replay-viewer.test.tsx`; `writing.test.ts` (99) and
  `play-vocabulary.test.ts` (156) pin "Delete this replay?".

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                 | New or changed                                                      | Built from                     |
| -------------------- | ------------------------------------------------------------------- | ------------------------------ |
| The list's table     | Changed: rows become a table with Fought, Turns, Length and the eye | `ReplayList`, the kit's table  |
| The replay beside it | New: map at the first turn, who fought, Players see it, Watch       | `Stage`, `readArchive`, E2 2.2 |
| The head row         | Changed: the name with the date to its right, More                  | `GmViewer`, `PlayerViewer`     |
| The whole fight      | New: every turn as a row, the current lit, press to go              | `stepsOf`, the log             |
| The order on glass   | Changed: `ReplaySide`'s order becomes chips on the map              | `Stage`, T's glass             |
| The line of rounds   | Changed: `Transport` becomes the line with ticks and marks          | `Transport`, E3's scrubber     |
| Launch at the line   | Changed: Launch from turn {n} at the transport's end                | `GmViewer.launch`              |
| A player's cards     | Changed: `ReplayShelf` as E's shelf cards                           | `ReplayShelf`, E 2.1           |

How the parts fit, so the phases agree:

- The list keeps the chosen replay in the address: `/replays?replay={id}`; with none, the newest. Choosing a row reads
  that replay's document (`readArchive`) for its first turn's map and who fought; a player's read is the projection.
- A turn's row in the whole fight is built from the turn's log lines: who acted from the turn's label, and the lines
  that are neither `turn` nor `encounter`, joined. A GM-only line (`gmOnly`) is violet with the GM tag.
- The marks under the line come from each turn's log lines by kind: `damage` amber, `heal` cyan; red where a creature's
  hit points reach 0 in that turn's state (a player's: the `down` band).
- One position drives everything: `usePlayback`'s index moves the map, the order chips, the lit row and the knob.

## 5. Phases

### Y0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `E3-replays/`, and leave the
   other pieces' folders as the zip has them.
2. Add `E3-replays/ADR-0069-replays.md` as `docs/adr/0069-replays.md`, Accepted, and its row to `docs/adr/README.md`.
   Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### Y1: the list as a table with the replay beside it

1. The table (Replay with the encounter under a GM name, Fought, Turns, Length, the eye), newest first, sortable by a
   column head; the chosen row lit; the replay beside it (name and More, the line, the map at the first turn, who
   fought, Players see it, Watch).
2. A player's list: the same without the eye, the replay as the party saw it.
3. A phone: the table; a row opens the replay's page.
4. Tests: `replay-list.test.tsx` (choosing a row shows its replay, Players see it writes the visibility, a player's
   table has no eye and its replay no hidden creature, the empty lines stay).

### Y2: watching with the whole fight beside the map

1. The head row: the name with the date to its right, More. The map at the left with the order as chips on glass; the
   whole fight at the right, the current turn lit, pressing a turn going to it.
2. A phone: the head, the transport, the map, the turns as rows.
3. Tests: `replay-viewer.test.tsx` (the rows follow the position, pressing a turn moves to it, a player gets no GM row
   and sees monsters as bands).

### Y3: the line of rounds

1. `Transport` becomes the icon buttons, the line (rounds, ticks, the watched part, the knob, the marks) and the count;
   pressing or dragging on the line seeks; the arrow keys and Play keep today's behaviour.
2. Tests: seeking from the line, the marks for damage, healing and a creature at 0, the count's words.

### Y4: the GM's actions

1. Launch from turn {n} as the Cup at the transport's end, with today's confirm and refusals; More in the head row with
   Players see it, Rename, Download JSON and Delete replay; Rename's dialog as A's dialog with today's words.
2. The replay beside the list gets the same More.
3. A phone: More's menu from the foot.
4. Tests: Launch names the turn and confirms, More's items call today's routes, Delete keeps its confirm.

### Y5: a player's cards under the sheet

1. `ReplayShelf` as REPLAYS · {N} and E's shelf cards two to a row (the map's picture, the name, the turns, Watch); past
   four, All replays · {N}.
2. Tests: no cards while an encounter runs or when nothing is shared, a card opens its replay, the name never shows the
   encounter's own name.

### Y6: docs and cleanup

1. `docs/DESIGN.md`: the replays list and the viewer. `docs/ARCHITECTURE.md`: the list's address.
2. `docs/adr/README.md`: 0069 Accepted and built. `docs/design/polish/CATALOG.md`: E3.3 to E3.5 and C4.6 move to Built.
3. Remove what nothing uses: `ReplaySide`'s tabs, the old rows' styles, the range input's styles.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a fight of three rounds and a hidden creature, kept and shared, one replay named by the GM and two not shared,
  look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: the list and a chosen replay; watching, stepping, playing and seeking on the line;
    Launch's confirm; More's items and Rename; a player's list, viewer and cards.
  - 390 by 844 with touch: the same, with the table, the replay's page, the stacked viewer and menus from the foot;
    every control at least 44 px; no sideways scroll.
- As a player: no hidden creature, no GM line, monsters as bands, and no encounter's own name anywhere.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- Nothing in replays. The table's own log and dice (C5) are unchanged.

## 8. Departures from the mockup, on purpose

- The mockup's map is a stand-in and its fight invented; the app draws each replay's own map and turns.
- The mockup draws the order chips with short names (Boss, Archer); the app uses the names the table's order uses.
- The mockup does not draw an empty list, a player's list, or a fight with more than four shared replays.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `replays.html`.

- `p6-body3.js`: the replays. `mixList()` and `rPane()` (the approved list), `viewHead()` (the date to the right),
  `viewBody()` and `viewPhoneBody()` (the `log` branches are the chosen viewer), `transport()` (the `line` branch) and
  `tl()` (the line and its marks), `actionsPage()` (the `foot` branch), `plReplays()` (the `cards` branch).
- `p4m-replay.css`: the rows, the order, the whole fight (`.r-step`, `.r-rnd`), the line (`.r-tl`), the transport.
- `p6-dec3.js`: the decisions, the Carried in list and the rules. `p6-body.js` and `p6-body2.js` are the screen's and
  the sound board's parts the round reuses.
- `audit-r.js`: the "Today" screenshots and the map picture.
