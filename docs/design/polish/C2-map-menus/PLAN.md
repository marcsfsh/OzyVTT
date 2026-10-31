# C2 The map's menus: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan opens everything on the map as A's menu at the thing (a token, the empty map,
a door, a drawing), keeps how a creature moves at the top of the token's menu, and turns each tool's options into A's
menu from the tool. It adds no rules, commands, routes or data. File paths and line numbers were read at `f5e166f`; the
theme (T), the frame (A), the table's frame (C), C3, C4 and C6 land on the same branch first or alongside, so confirm
every anchor before editing. Paths are under `apps/client/src/` unless they start with `apps/`, `packages/`, `e2e/` or
`docs/`.

This is C2 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, M0 to M6,
  each about one commit.
- The reference is `map-menus.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else
  is inline). It opens on the approved choices. Use the Page switch (A token's menu, Moving, A door, A tool's options,
  A drawing). The GM is on the laptop and Borin's player on the phone, and on the laptop for Moving. The other options in
  the decision switches are the ones the owner turned down; build only the chosen ones. `history/` holds the round.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its fight is a stand-in.
  Build with the existing components, hooks and primitives, and with the settled ones (A's menu, T's Base line and
  segmented rows, C3's row tools). Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. A token, a door, the empty map and a drawing open as A's menu at the thing; on a phone, from the foot.
2. The token's menu: how it moves, height, the token, the creature; hit points point to its row.
3. How it moves stays at the top of the token's menu.
4. A door's ways are A's menu's rows.
5. Each tool's options are A's menu from the tool; the tool stays on after its menu closes.
6. A drawing is A's menu at the drawing.
7. Six rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3 (Base line, segmented rows), A's menu (A2 and A3), C1 to C5 (two docks with the tools in the
  dock, the phone's Switch and tools row) and C3's second round (R2, a creature's tools under its row, and the Token
  tab). If one is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every command stays, as `docs/app-map.md` names them: `token.move` with its mode,
  `token.set-altitude`, `door.set-open`, `door.use`, `door.set-state`, `annotation.set-color`,
  `annotation.set-visibility`, `annotation.set-movable`, `annotation.remove`, `light.add`, `light.remove`,
  `vision.add-area`, `vision.set-ambient`, `vision.set-enabled`, `fog.*`, `terrain.*`, `trap.*`, `wall.*`,
  `environment.set`, and whatever `TokenControls` sends today for size, health display, image, visibility and the tray.
  No server, shared domain, schema, projection or route changes. If a step seems to need one, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the menus as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 Where the map's menus open

- `scene/EncounterMap.tsx` (1121 lines): the state for each menu (`contextMenu` 183, `spotMenu` 185, `doorMenu` 187),
  the handlers that open them (`onContextMenu` 449, `onMapMenu` 469, `onDoorMenu` 470 and 894), the drawing's editor
  as the rail's `inspector` (663 to 675), the rail (677 on), and the menus mounted in the stage (`MapSpotMenu` 999 to
  1006, `DoorMenu` 1008 to 1031, `TokenContextMenu` 1032 to 1110, with `MoveModeChoice` for the mover).
- `scene/menuPlacement.ts`: `useMenuPlacement` (11 on) puts a menu by the pointer, moves it up until it fits, and
  scrolls it in the viewport's column when nothing fits. `packages/ui/src/primitives/Menu.tsx` (165 lines) uses it for
  A's trigger menus.
- CSS: `scene/token-menu.css` 1 to 135 (`.token-context-menu`, shared by the door and spot menus), `scene/map-rail.css`
  1 to 310 (the rail, the options column `.map-options` 66 to 100).

### 3.2 A token's menu

- `scene/TokenContextMenu.tsx` (366 lines): `TokenContextMenu` (22 to 112: the menu, its head and close, `role="menu"`,
  "Actions for {name}"), `HeldBy` and `HeldByRows` (114 to 178), `TokenControls` (180 to 366: Damage and Heal, damage
  type, Size, Health, Conditions, Open stat block or sheet, Set token image, Hide from players or Show to players, Use
  reaction or Reaction spent · Restore, Return to tray). `TokenControls` is shared with the GM's Token tab
  (`table/TokenTab.tsx`, C3).
- `scene/MoveModeChoice.tsx`: `MOVE_MODE_NAMES` (5), `MOVE_MODE_KEYS` (17), `MoveModeChoice` (34 on): the ways with the
  feet left, Prone as a crawl, the granted move named under it.
- `scene/MapSpotMenu.tsx` 14 to 58: "Place here", its choices, "Everyone is on the map. Drag a token to move it.".

### 3.3 A door

- `scene/DoorMenu.tsx` (269 lines): `doorSummary` (37), `DoorMenu` (69 to 170: the title Door, the summary, the ways,
  who does it, the attack line, Edit lock and strength), `DoorEditor` (172 to 269: Lock DC, Force DC, Hit points left).
- `scene/VisionLayer.tsx` 190 to 215: the door's handle (`.vision-door-handle`, `role="button"`, Enter opens the menu).

### 3.4 Each tool's options

- `scene/MapRail.tsx` (217 lines): the direct tools (63 to 67), `groupOf` (70 to 78), the groups per role (89 to 103),
  `openGroup` and Escape (91, 110 to 118), `groupBody` (120 to 132), the buttons (138 to 186) and the options column
  (187 to 214: `.map-options`, its head with the title and Close {group}, the group's name as its `aria-label`).
- `scene/MapToolGroups.tsx` (754 lines): `DrawGroup` 41, `FogGroup` 166, `TerrainGroup` 229, `TrapsGroup` 292,
  `FoundTrapsGroup` 406, `WeatherGroup` 443, `WallsGroup` 511, `LightGroup` 554, `ViewGroup` 719.

### 3.5 A drawing

- `scene/ShapeEditor.tsx` 18 to 131: the head (size and shape, its position), Color, Who sees this, Character, Others
  can move this, Remove; read-only for a drawing someone else owns.

### 3.6 Tests that pin it

- `scene/doors.test.tsx`, `scene/map-placement.test.tsx`, `scene/hazards.test.tsx`, `scene/see-as.test.tsx`,
  `scene/vision-areas.test.tsx`, `codex/page/index.test.tsx` (the map on a Codex page), and any test that finds
  "Actions for", "Place here", the group names or "Selected shape" (grep them).
- e2e: `journeys.spec.ts` 541 to 545 (the rail's Light and its group "Light"), 590, 627 (the rail).

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The map's menu | New: one anchored menu for every thing on the map | A's menu, `useMenuPlacement` |
| The token's menu | Changed: how it moves first; hit points point to the row | `TokenContextMenu`, `TokenControls`, `MoveModeChoice` |
| Place here | Changed: the map's menu | `MapSpotMenu` |
| The door's menu | Changed: the map's menu | `DoorMenu`, `DoorEditor` |
| A tool's menu | Moved: the options column becomes a menu from the tool | `MapRail`, the groups |
| The drawing's menu | Moved: from the options column to a menu at the drawing | `ShapeEditor` |

How the parts fit, so the phases agree:

- The map's menu: one component (`scene/MapMenu.tsx`) takes the thing's box, a title, an optional state line and its
  body, draws A's menu, and places it beside the box with `useMenuPlacement` extended to avoid the box and stay inside
  the map. On a phone it renders from the foot of the Switch's view. Every map menu uses it; each keeps its
  `role="menu"` or group and its accessible name ("Actions for {name}", "Place here", "Door", "Selected shape").
- The token's menu: `TokenContextMenu` renders How it moves (`MoveModeChoice`), Height, The token and The creature as
  in `SPEC.md` 2.2. `TokenControls` splits: the token's part (Size, Health, image, Hide, Return to tray) stays shared
  with the Token tab; Damage and Heal, damage type and Conditions stay in C3's row and leave the menu; "Hit points and
  conditions" opens the creature's row.
- A tool's menu: `MapRail` keeps `openGroup`; the column becomes the map's menu anchored to the group's button, with
  the group's name as its group label ("Light"). Choosing on the map closes the menu and keeps the tool; the button's
  title names the choice.
- The drawing's menu: `EncounterMap` renders `ShapeEditor` in the map's menu at the chosen drawing's box instead of the
  rail's `inspector`.

## 5. Phases

### M0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `C2-map-menus/`, and leave the
   other pieces' folders as the zip has them.
2. Add `C2-map-menus/ADR-0062-map-menus.md` as `docs/adr/0062-map-menus.md`, Accepted, and its row to
   `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### M1: the map's menu

1. `MapMenu` with placement beside the thing, the phone's foot, one at a time, Escape, close and focus return.
2. Tests: a new `map-menu.test.tsx` (placement keeps clear of the thing and inside the map; a phone renders from the
   foot; opening one closes the other; Escape returns the focus).

### M2: the token's menu and Place here

1. `TokenContextMenu` in the map's menu with How it moves first, Height, The token, The creature (section 4);
   `TokenControls` split; Place here in the map's menu.
2. Tests: `map-placement.test.tsx` holds; the token's menu has no Damage or Heal for the GM; "Hit points and
   conditions" opens the row; a player's menu holds only their own character's rows.

### M3: the door

1. `DoorMenu` in the map's menu, its state in the title line, Edit lock and strength in place.
2. Tests: `doors.test.tsx` holds (its names and payloads).

### M4: a tool's options as a menu from the tool

1. The options column becomes the map's menu at the tool's button, on a laptop and on a phone; the tool stays on after
   the menu closes; the button's title names the choice.
2. Tests: `hazards.test.tsx`, `see-as.test.tsx`, `vision-areas.test.tsx` hold; the group keeps its name;
   `journeys.spec.ts` 541 to 545 holds.

### M5: the drawing's menu

1. `ShapeEditor` in the map's menu at the drawing; the rail loses its `inspector`.
2. Tests: a drawing's menu opens at the drawing with its name "Selected shape"; a drawing someone else owns shows only
   its head.

### M6: docs and cleanup

1. `docs/DESIGN.md`: the map's menus and a tool's menu.
2. `docs/ARCHITECTURE.md`: `MapMenu` and where each menu opens.
3. `docs/adr/README.md`: 0062 Accepted and built. `docs/design/polish/CATALOG.md`: C2 moves to Built.
4. Remove what nothing uses: the options column's CSS, the rail's `inspector`, the token menu's own placement CSS.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a fight running on a map with a grid, a locked door and a drawing, look in Dusk and Dawn at:
  - 1280 by 800 with a mouse, as the GM: the Goblin Boss's menu beside it, how it moves, height, Hit points and
    conditions opening its row; Place here on the empty map; the door's menu and its editor; Light's menu from the tool,
    placing a light with the menu closing and the tool staying on; the drawing's menu.
  - 390 by 844 with touch, as a player: a long press on their own token, how they move on their turn, a door's menu,
    Draw's menu under the tool, their own drawing's menu; every control at least 44 px; no sideways scroll.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable, including the keys while a token is held, carried creatures, Forced
  moves, the trap lists, Weather, Walls and View.

## 7. Left as they are, for later rounds

- The staging tray (C 3.4), the prompt over the map (C4), the token image picker (C6.8, with E2).
- Every command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The mockup places each menu by hand; the app places it with `useMenuPlacement`, beside the thing.
- The mockup draws the phone's token and door menus from the foot and Draw's menu under its tool; the app does the same
  for every map menu on a phone, with the tool's menu under its button.
- The mockup does not draw Place here, the door's editor, Fog, Terrain, Traps, Weather, Walls or View; sections 2 and
  4 place them.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `map-menus.html`.

- `p4p-c2.css`: the menu's parts (`.z-menu`, `.z-mtitle`, `.z-msec`, `.z-step`), the door on the map (`.z-door`),
  swatches (`.z-sw`), the path (`.z-path`, `.z-ghost`, `.z-tag`). A's menu is `.q-menu`, `.q-mh` and `.q-mi` in
  `p4m-c3b.css`. The other options' parts sit beside them.
- `p6-body5.js`: `zTokMenuGM()` and `zTokMenuPL()` with `tokenPage()` (the `menu` branch), the menu in `movingPage()`,
  `zDoorMenu()` and `zDoorBody()` with `doorPage()`, `zLightOpts()` and `zDrawOpts()` with `toolsPage2()` (the `menu`
  branch), `zShapeEd()` with `drawingPage()` (the `menu` branch).
- `p6-dec5.js`: the decisions, the Carried in list and the rules. The earlier files are C's frame, C3, C4 and C5,
  ported.
- `audit-c3.js`: the "Today" screenshots and the map.
