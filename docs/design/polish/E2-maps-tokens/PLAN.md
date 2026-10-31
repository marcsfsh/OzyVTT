# E2 Maps and tokens: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds Prep's Maps page as folders at the side with the maps as shelf cards,
opens a map beside its folder's list, files maps from a map's menu and from Choose, groups the Tokens page into Party,
Monsters and the GM's own groups, and makes the token picker a dialog of folders, the library and a preview. It adds one
stored value, the GM's token groups, with four commands; nothing else changes in data, routes or projections. File paths
and line numbers were read at `f5e166f`; the theme (T), the frame (A) and Prep's frame (E) land on the same branch first
or alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `apps/`,
`packages/`, `e2e/` or `docs/`.

This is E2 (with E3.1 and C6.8) in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to
build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, K0 to K6, each
  about one commit.
- The reference is `maps-and-tokens.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything
  else is inline). It opens on the approved choices. Use the Page switch (The map list, A map's page, Folders, The
  tokens page, The token picker); Folders has two chosen states (In its menu, Choose several). The GM is on both sizes.
  The other options are the ones the owner turned down; build only the chosen ones. `history/` holds the round.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its maps and creatures are
  stand-ins. Build with the existing components, hooks and primitives, and with the settled ones (E's shelf card,
  toolbar and record title row, A's menu and dialog, T's Base line). Section 8 lists where the plan departs from the
  mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The map list is folders at the side with the maps as shelf cards.
2. A map opens beside its folder's list, inside the same layout.
3. A map's menu files it in a folder; Choose files several at once.
4. The Tokens page groups creatures into Party, Monsters and any group the GM makes (a new stored value).
5. The token picker is a dialog of folders, the library and a preview, wherever it opens.
6. Eight rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, the kit's menu and A's dialogs (A6) and E's frame (E1: Prep's Titled bar, the shelf card and
  toolbar, the record title row). If one is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays: `GET POST /api/v1/map-assets`, `GET PATCH /api/v1/map-assets/{id}`,
  `POST /api/v1/map-assets/folders/rename`, the calibration routes, `GET POST /api/v1/token-assets`,
  `DELETE PATCH /api/v1/token-assets/{id}`, `POST /api/v1/token-assets/folders/rename` and `.../folders/visibility`, and
  `actor.set-token-image`. There is no route to delete a map, so nothing here deletes one.
- The one server change is phase K4's token groups: one GM-only state field and four commands, built the way
  `stagingDefaults` and `table.set-staging-defaults` are. Invariant 2 applies: the field reaches the GM view only;
  `projectPlayerView` and every table-screen projection must not carry it, and a test proves it. If any other step seems
  to need a server, schema, command, route or projection change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done (and `npm run map` after K4's commands), and look at the pages as section 6 says (the `verify`
  skill has the steps).

## 3. What is on the branch now

### 3.1 Maps

- Routes: `/encounters/maps` (`router.ts` 182, 219), a map `pathForMap` (`scenes/routes.ts:73`), steps for the grid.
- `maps/MapList.tsx` (174 lines): `rowMenu` (38 to 65: Set the grid or Set the grid again, New encounter on this map,
  Rename, Move to a new folder, Move to {folder}, Take out of its folder), the phone rows (`sc-row`, 112) and the table
  (`sc-maps-table`, 126: Name, Type, Grid, Size, Folder, Used in, Modified, Actions).
- `maps/MapListToolbar.tsx` (128 lines): Filters (Folder, Grid, Used in), Type, Modified, Sort.
- `maps/mapActions.tsx` (55 lines): `useMapActions` (10: rename, type, folder, new folder; one write each, read back),
  `folderNamesOf` (51). A folder exists while a map is in it.
- `maps/MapDocument.tsx` (301 lines): `MapDocument` (97 on): the title, View, the map, and the panel "About {name}"
  (182) with Grid (184), Type and folder (201), Where it is used (238), File and history (265); Set the grid as its
  primary.
- `maps/map-catalog.ts`: `uploadMap` (125), the catalogue hook.
- Tests: `maps/maps-tab.test.tsx` (52 to 140: the list's columns, Type, the flyout's filters, opening a map, the
  document's sections, the atlas name, one write for the type, New encounter on a battle map), `router.test.ts`.

### 3.2 Tokens and the picker

- `tokens/TokensPage.tsx` (112 lines): "Prep's Tokens page: every creature at the table with the picture it shows" (16
  to 19), `TokensPage` (20 on: the region, the list "Tokens" at 44, each row's Set token image…, the library at 100).
  Route `/prep/tokens` (`router.ts` 149, 220).
- `tokens/TokenLibrary.tsx` (306 lines): the role rules (8 to 13), the `hidden` flag (25), `TokenLibrary` (73 on):
  assign (around 140), upload into a folder (147 to 165), offer or hold back (169 to 175), the Modal (184), "Find a
  token" with search and the folder Select (204 to 215), Upload into folder (229), Previously used (241), the library
  and Upload an image. Opened from `TokensPage.tsx:100`, `scene/TokenContextMenu.tsx:59`, `table/TokenTab.tsx:36`,
  `sheet/CharacterSheet.tsx:834`, `settings/PlayersSection.tsx:178`.
- `tokens/tokenImages.tsx`, CSS `tokens/tokens.css`, `tokens/tokens-page.css`.

### 3.3 Where token groups would live

- `packages/domain/src/state.ts`: the top-level `GameStateSchema` fields with their defaults (around 2455 to 2480;
  `stagingDefaults: StagingDefaultsSchema.prefault({})` is "GM-set, GM-read").
- `packages/domain/src/commands.ts` (each command's schema), `packages/domain/src/socket.ts` (`ClientToServerEvents`),
  `packages/api-contract/src/index.ts` (`GAME_COMMANDS`: `"table.set-staging-defaults"` at 751 is the model),
  `apps/server/src/commands/table-settings.ts` (97 to 104: the staging-defaults entry with its words).
- `apps/server/src/projections.ts`: `projectPlayerView` (978 on) builds the player's view field by field;
  `projectGmView` (1190 on) spreads the state. The table screen's projections are in `viewer-*.ts`.
- `docs/app-map.md` is regenerated by `npm run map`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                    | New or changed                                       | Built from                          |
| ----------------------- | ---------------------------------------------------- | ----------------------------------- |
| The folders column      | New: folders with counts, the chosen one, New folder | `folderNamesOf`, `useMapActions`    |
| Map cards               | Changed: the table becomes E's shelf cards           | E's shelf card, `MapList`           |
| A map beside the list   | Changed: `MapDocument` inside the folders layout     | `MapDocument`, the list             |
| Choose                  | New: boxes, the bar, Move to                         | `useMapActions().setFolder` per map |
| Token groups            | New: a GM-only field and four commands               | `stagingDefaults`' pattern          |
| The grouped Tokens page | Changed: rows in groups, New group, a row's menu     | `TokensPage`                        |
| The picker              | Changed: folders, library, preview                   | `TokenLibrary`                      |

How the parts fit, so the phases agree:

- The folders column is one component used by the list and by an open map; the chosen folder is in the address
  (`?folder=Act%201`, `?folder=none`), so a map's page and Back keep it.
- Choose keeps the chosen map ids in the page's state; Move to calls `setFolder` for each chosen map in turn, then reads
  the library once. Moving to a new folder asks its name first.
- Token groups: `tokenGroups: { groups: Array<{ id, name }>, members: Record<actorId, groupId> }`, default empty, max 50
  groups and 40-character names. Commands (names to confirm against the app map's style): `token-group.create { name }`,
  `token-group.rename { groupId, name }`, `token-group.delete { groupId }` (its members return to Party or Monsters) and
  `actor.set-token-group { actorId, groupId | null }`; GM-grade only, scope as `table.set-staging-defaults`. Removing an
  actor drops it from `members`.
- The picker: `TokenLibrary`'s Modal body becomes three columns (the folders from the listing, the library, the
  preview); assign stays one call; Use for {name} assigns the chosen image and closes.

## 5. Phases

### K0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `E2-maps-tokens/`, and leave the
   other pieces' folders as the zip has them.
2. Add `E2-maps-tokens/ADR-0063-maps-and-tokens.md` as `docs/adr/0063-maps-and-tokens.md`, Accepted, and its row to
   `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### K1: the map list in folders

1. The folders column, the shelf of map cards with their folder tag, grid line and use, and the toolbar (types,
   Modified, Choose, New map); New folder asks a name and starts Choose with Move to {name}.
2. A phone: folder chips, the toolbar's icons and Choose, cards two to a row.
3. Tests: `maps-tab.test.tsx` updated (the cards carry each map's name, grid and use; a folder shows only its maps; Type
   keeps its address), a folder in the address.

### K2: a map beside the list

1. `/encounters/maps/:id` renders the folders, its folder's list with the map lit, and `MapDocument` in E's record
   frame; File and history moves into More; New encounter steps down from the bar.
2. A phone: the map under its row with Open its page.
3. Tests: `maps-tab.test.tsx` (opening a map keeps the folders and the list; the document's sections hold).

### K3: filing maps

1. A card's menu with the folders section; Choose with the boxes, the bar and Move to.
2. Tests: moving one map from its menu writes once; Choose moves two maps to a folder and reads once; Escape leaves
   Choose.

### K4: token groups (the one server change)

1. The state field, the four commands, their words in `table-settings.ts`' style, the routes `GAME_COMMANDS` derives,
   and `npm run map`.
2. Projections: the GM view carries it; `projectPlayerView` and the table screen's projections do not.
3. Tests: commands (create, rename, delete returns members, move, GM-only, limits), projection tests (a player and the
   table screen never receive `tokenGroups`), a saved game without the field loads with it empty.

### K5: the grouped Tokens page and the picker

1. The Tokens page in groups with New group, a group's More and a row's More; tokens drawn as the map draws them.
2. The picker's three columns everywhere it opens; a player's without the eye or held-back images.
3. Tests: a new `tokens-page.test.tsx` (groups, moving a creature, deleting a group returns it), the picker's
   `actor.set-token-image` payload holds, a player's listing has no hidden entry.

### K6: docs and cleanup

1. `docs/DESIGN.md`: maps in folders, Choose, token groups, the picker.
2. `docs/ARCHITECTURE.md`: the folders in the address, token groups and their projection rule.
3. `docs/adr/README.md`: 0063 Accepted and built. `docs/design/polish/CATALOG.md`: E2, E3.1 and C6.8 move to Built.
4. Remove what nothing uses: the maps table, the flyout's folder filter, the picker's folder Select.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With six maps in two folders and a token library in two folders, look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: the folders and cards; a map opened beside its list; a map's menu moving it; Choose moving
    two; the Tokens page in groups, a new group, a creature moved into it, the group deleted; the picker from the Tokens
    page and from a token's menu on the table.
  - 390 by 844 with touch: the same, with the folder chips, a map under its row, the menu and Choose bar from the foot,
    and the picker from the foot; every control at least 44 px; no sideways scroll.
- As a player: the picker from the sheet shows only offered images and their own uploads; no groups anywhere.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- The grid steps (E 2.4), the map picker and the Atlas (E2.4, with F3), the sound board and replays (E3.2 to E3.5).
- Every route and projection other than K4's.

## 8. Departures from the mockup, on purpose

- The mockup's Choose bar shows only Move to; there is no route to delete maps, and the grid is set one map at a time.
- The mockup does not draw New folder's name dialog, a group's Rename and Delete, File and history in More, or the
  player's picker; sections 2 and 4 place them.
- The mockup's creatures and token art are stand-ins; the app draws each creature's real token.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `maps-and-tokens.html`.

- `p4g-e2.css`: folders (`.x-rail`, `.x-ri`), the folder tag (`.x-fold`), grid lines (`.x-grid`, `.x-lamp`), Choose
  (`.x-check`, `.x-cardcheck`, `.x-selbar`), menus (`.x-menu`, `.x-mh`, `.x-mi`), tokens (`.x-art`, `.x-trow`), the
  picker (`.x-lib`, `.x-li`, `.x-up`, `.x-pv`). `p4f-prep.css` is E's frame and shelf.
- `p6-body3.js`: the approved pages: `mapsPageA()`, `mapPageA()`, `foldersPageA()` (both chosen states),
  `tokensPageA()`. `p6-body2.js`: the round's options, `rail()`, `mcard()`, `mapHead()` and the sections, and
  `pickerPage()` (the `panes` branch is the chosen picker).
- `p6-dec2.js` and `p6-dec3.js`: the decisions, the Carried in list and the rules. The earlier files are E's frame.
- `audit-e.js`: the "Today" screenshots, the maps and the token art.
