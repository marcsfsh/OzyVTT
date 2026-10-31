# F3 The Atlas: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the Atlas as three columns (the maps as a tree, the map, the pins),
opens a pin as its page in the right column, gives pins a right-click menu, puts the pin editor's parts in tabs, and
makes Add a map use E2's map picker. The story's Downtime tab is built from `F-story-people/PLAN.md` phase S5, which
points at this spec. It adds no rules, commands, routes, projections or data. File paths and line numbers were read at
`f5e166f`; the theme (T), the frame (A), the Codex's frame (F), F's finding and pages (N) and E2's picker land on the
same branch first or alongside, so confirm every anchor before editing. Paths are under `apps/client/src/codex/` unless
they start with `apps/client/src/` (written `src/`), `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is F3.1 to F3.3 in `../CATALOG.md`, with F4.7's contents. `SPEC.md` beside this file is what was decided; this plan
is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, V0 to V6, each
  about one commit.
- The reference is `the-atlas.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else
  is inline). It opens on the approved choices. Use the Page switch (The Atlas, A pin, Editing a pin, Moving between
  maps, The Downtime tab). The Atlas's chosen option is the sixth button, Maps at the side, pins at the right, which
  puts two of the round's options together; A pin shows Thornwick open with the ruined keep's right-click menu. The
  other options are the ones the owner turned down; build only the chosen ones. `history/1-round-1.html` is the round as
  it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its maps are drawn stand-ins
  and its campaign is invented. Build with the existing components, hooks and primitives, and with the settled ones (F's
  frame, E2's folders and picker, A's menu, T's glass and Base line). Section 8 lists where the plan departs from the
  mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The Atlas: the maps as a tree with the layers at the left, the map, the pins at the right.
2. A pin opens as its page in the right column with All pins and two switches (The party's position, Players see it); a
   right-click on a pin opens its menu.
3. Editing a pin: Look, Links, Encounters and Who sees it as tabs in the right column.
4. The tree is how you move between maps; Add a map uses E2's picker.
5. The Downtime tab: the characters and the deadlines at the side, the chosen character's downtime at the right.
6. Seven rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, the kit's menu and A's dialogs (A6), F's frame (F1 to F4), F's finding and pages (N2's side
  list) and E2's picker (K5). If a piece this needs is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays: `GET POST /api/v1/codex/maps`, `DELETE PATCH /api/v1/codex/maps/{id}`,
  `.../markers`, `.../parent`, `.../reveal`, `DELETE GET PATCH /api/v1/codex/markers/{id}`, `.../move`, `.../party`,
  `.../reveal`, `GET /api/v1/codex/pages/{id}/markers`, and `GET POST /api/v1/map-assets`. If any step seems to need a
  server, schema, command, route or projection change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

- `atlas/AtlasView.tsx` (713 lines): `AtlasView` (86 on), the map's own menu `spotMenu` with Add a pin here (375, passed
  at 408).
- `atlas/AtlasMap.tsx` (578 lines): `MapMenuItem` (23), the `menu` prop (79), the map's `onContextMenu` (392 on).
- `atlas/AtlasPanel.tsx` (289 lines): `AtlasCrumbs` (24, "Map path"), `LayerChips` (53), `LayersMenu` (81), `PinFilter`
  (112), `PinTable` (153), `MapsInside` (236, "Maps inside this one", "Other top-level maps").
- `atlas/PinView.tsx` (219 lines): `PinView` (51), the linked pages (105), tags (146), `PinJournal` (180).
- `atlas/PinEditor.tsx` (413 lines): `PinEditor` (32), the section "Edit pin" (159), the party's pin (210), Link an
  encounter (326).
- `atlas/MapDetails.tsx` (217 lines): `MapDetails` (13), `MapPicker` (140). `atlas/PlayerAtlas.tsx` (220 lines),
  `atlas/sections.tsx`, `atlas/atlas.css` (840 lines).
- `routes.ts`: the Atlas section (14, 41, 123, 138).
- Tests: `atlas/atlas-view.test.tsx`, `atlas/atlas-map.test.tsx`, `atlas/pin-editor.test.tsx`,
  `atlas/player-atlas.test.tsx`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part              | New or changed                                                           | Built from                  |
| ----------------- | ------------------------------------------------------------------------ | --------------------------- |
| The three columns | Changed: map and panel become tree, map, pins                            | `AtlasView`, N2's side list |
| The maps' tree    | New: every map nested, with counts                                       | `MapsInside`, `AtlasCrumbs` |
| The pins column   | Changed: `PinFilter` and `PinTable` as rows                              | `AtlasPanel`                |
| A pin's page      | Changed: `PinView` shows the linked page's face, text, facts and journal | `PinView`, F's page parts   |
| The pin's menu    | New: `AtlasMap` offers a menu on a pin                                   | `MapMenuItem`, A's menu     |
| The editor's tabs | Changed: `PinEditor` in four tabs                                        | `PinEditor`                 |
| Add a map         | Changed: E2's picker, then Details' fields                               | E2's picker, `MapDetails`   |

How the parts fit, so the phases agree:

- The address keeps the map and the pin: `/codex/atlas/{mapId}?pin={markerId}` (and `&edit=1` while editing), so Back
  closes a pin and the browser's Back walks out of the editor and the pin.
- The right column has three states: the pins, a pin, the editor; All pins and Back step down one.
- The tree reads the same map list the panel reads today; a map's children are those whose parent is it.
- The pin's menu: `AtlasMap` takes a `pinMenu(marker)` that returns `MapMenuItem`s; a right-click or a long press (500
  ms) on a pin opens it at the pin; Escape and a press elsewhere close it. Delete pin keeps today's confirm.

## 5. Phases

### V0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `F3-atlas/`, and leave the other
   pieces' folders as the zip has them.
2. Add `F3-atlas/ADR-0067-atlas.md` as `docs/adr/0067-atlas.md`, Accepted, and its row to `docs/adr/README.md`. Leave
   any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### V1: the three columns and the tree

1. The tree with counts and the layers under it, the map with its crumbs and zoom on glass, and the pins column with
   Filter pins and the rows; the map and pin in the address.
2. A phone: the maps as chips, the map, the pins as a sheet.
3. Tests: `atlas-view.test.tsx` updated (the tree nests a map under its parent, choosing a map loads its pins, the
   filter narrows the rows, a hidden pin is marked for the GM).

### V2: a pin's page and its menu

1. Choosing a pin in the list or on the map opens its page in the right column with All pins, Edit pin and More. Under
   its line, The party's position and Players see it as switch rows: the first calls today's party pin route (`isParty`
   true or false), the second today's reveal route, the same calls the menu makes.
2. The pin's menu on a right-click or a long press; the map's Add a pin here stays.
3. A phone: the pin as a tall sheet; the menu from the foot.
4. Tests: a pin opens from the list and from the map, All pins returns, the two switches send the party and reveal calls
   and follow the pin's state, the menu offers its six items and Delete pin confirms, a long press opens it on touch.

### V3: editing a pin in tabs

1. `PinEditor` in Look, Links, Encounters and Who sees it, saving as today, Done returning to the pin.
2. Tests: `pin-editor.test.tsx` updated (each tab's fields write as before, the party's pin, Done returns).

### V4: adding a map and the maps' More

1. Add a map opens E2's picker, then the name, kind and where it sits; a map's More holds Rename, Sits inside, Kind,
   Reveal and Delete map.
2. Tests: adding a map from the picker creates it under the chosen parent; Sits inside moves it in the tree.

### V5: the player's Atlas

1. `PlayerAtlas` in the same three columns: the maps they can open, the pins they can see, a pin's page as they read it;
   no Edit, no changing menu items, no hidden layer.
2. Tests: `player-atlas.test.tsx` (no hidden pin or map, no Edit, the menu offers only Open its page).

### V6: docs and cleanup

1. `docs/DESIGN.md`: the Atlas's three columns, the pin's menu. `docs/ARCHITECTURE.md`: the Atlas's address.
2. `docs/adr/README.md`: 0067 Accepted and built. `docs/design/polish/CATALOG.md`: F3.1 to F3.3 move to Built (and F4.7
   when `F-story-people` S5 is built).
3. Remove what nothing uses: the panel's tabs, `MapsInside` as a tab, `LayerChips` if the tree's layers replace it.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a world map, a regional map inside it with five pins (one hidden, one the party's) and a battle map inside a pin,
  look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: the tree and each map; a pin from the list and from the map; the pin's menu; editing in
    each tab; adding a map; an empty map's line.
  - 390 by 844 with touch: the same, with the chips, the sheets, a long press, and the editor full screen; every control
    at least 44 px; no sideways scroll.
- As a player: no hidden pin or map, no Edit, the menu only opens pages.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- The Codex tools (F6) and the calendar editor and record dialog (F story rule 3.6).
- The map's own drawing (pins' sizes, the party's mark) beyond what section 4 of `SPEC.md` says.

## 8. Departures from the mockup, on purpose

- The mockup's maps and their pictures are stand-ins; the app draws each map's own image.
- The mockup does not draw the player's Atlas, the maps' More, Add a map's picker or a pin with no page; sections 2 and
  4 place them.
- The mockup draws the menu open while another pin is open, to show both at once.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `the-atlas.html`.

- `p4l-atlas.css`: the map and pins (`.z-map`, `.z-pin`), pin rows (`.z-row`, `.z-dot`), crumbs and the tree
  (`.z-crumbs`, `.z-tree`), the editor's icons and swatches (`.z-ic`, `.z-sw`), downtime (`.z-wait`, `.z-led`).
- `p6-body5.js`: the approved Atlas (`mixLeft()`, `mixFrame()`, `mixPins()`, `mixPinOpen()`, `mixMenu()`, `mixEdit()`,
  and the phone's `mixPhone()`). `p6-body4.js`: the round's options, the drawn maps (`MAPS`), the pins (`PINS`),
  `look()`, and `downtime2Page()` (the `side` branch is the chosen Downtime tab).
- `p6-dec4.js`: the decisions, the Carried in list and the rules. The earlier files are F's frame and F's other rounds.
- `audit-a.js`: the "Today" screenshots.
