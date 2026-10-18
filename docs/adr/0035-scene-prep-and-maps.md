# ADR-0035: Scene preparation and battle maps

## Status

Accepted. Amends ADR-0025 in one place: a prepared scene is no longer staged on the table. It is edited on its own
page on the Scenes tab, and the table always shows the live scene.

## Context and decision drivers

Scenes and maps grew as a gallery, a New scene dialog, a staging mode on the table and a map library whose upload
row, rail and calibration pane shared one screen. A walkthrough of both as the GM, on a laptop and on a phone,
found the costs:

- the table meant two things, the live game and a private staging copy of another scene, and `/scenes/<id>` showed
  the gallery;
- nothing said what needed the GM: a scene on a map with no grid showed it only on its card's map line;
- the GM could not check what the players or the table screen would get of a scene before making it live;
- scenes had no dates, so nothing could sort or filter by them;
- on a phone the calibration steps sat under the map, and the canvas shrank as the steps grew;
- placing on a map needed a drag from the tray;
- the folder typed at upload was dropped by the server.

The drivers were docs/DESIGN.md's page patterns (front pages start with what needs you, lists are tables, a record
is one document, making something is steps beside a real preview, phones get the same features), the server
deciding everything, and the projections staying the security boundary.

## Considered options

1. **Keep staging on the table and restyle the gallery and the library.** Least change, but the table keeps its
   two meanings and the map library keeps its crowded screen.
2. **Scenes and maps as pages of their own, each record one document built from the table's own parts.** One set
   of map tools, and the address says which scene or map is open.
3. **A separate prep editor with its own map component.** Freedom to design, but a second map with its own tools
   and bugs, and a preview that is not what the table draws.

## Decision

Option 2. The Scenes tab (`scenes/ScenesShell.tsx`) has three sections in a bar (a tab bar at the bottom of a
phone, with New): Overview, Scenes and Maps, a find box (Ctrl K) and the view's one primary.

- **Overview** (`ScenesOverview.tsx`) starts with Needs you: the live scene with the way to its table, then each
  scene's open needs (`needsOf` in `sceneFacts.ts`: a map with no grid, nobody in it, tokens still in the tray,
  vision on with no walls, archived characters still staged) and maps with no grid, each with the action that
  answers it. Recent changes and Start something follow.
- **Scenes and Maps are tables** (`SceneList.tsx`, `maps/MapList.tsx`): a State or Type dropdown where tabs would
  go, Filters as a flyout, a Modified range and Sort over several columns, all held in the address so a filtered
  list is a link. The scenes table keeps the GM's own order as its default sort, with drag and the menu's Move
  earlier and later to change it. A phone gets rows with two facts each. The dropdowns, flyout, chips and Sort
  dialog are shared with the Codex (since moved to `packages/ui/src/records/`); the Sort dialog, which was Search's
  own, now takes its columns as props.
- **A scene is one document** at `/scenes/<id>` (`SceneDocument.tsx`), built as the table's docked workbench: the
  header bar, the map drawn by `EncounterMap` with its tool rail, editing that parked scene through the same
  commands with their `sceneId`, the tray, and a panel of what the GM asks about the scene (state and what it
  still needs, map and grid, walls and light, sound, the Codex sessions and pins that name it, history) with Make
  live as its one primary. The scene list folds into a flyout.
- **See as** switches that map in place to what the table screen or one party character's player would receive if
  the scene went live now. `scene:preview` (GM only, `scene-preview.ts`) runs the real projections
  (`projectViewerEncounter`, `projectPlayerView`) over a copy of the state with the scene made live. Nothing is
  committed, and the client draws the answer with the screen's `MapStage` or with `EncounterMap` as the player's
  device draws it.
- **Making or editing a scene is steps** (`SceneEditor.tsx`, `EditorFrame.tsx`): Map, Tokens and monsters, Walls
  and light, Sound, and Review and make live, down the left with the questions beside them and the map pinned on
  the right. Choosing the map makes the scene, privately, so every later step edits the real scene, and each step
  has its own address (`?step=`).
- **A map is one document** at `/scenes/maps/<id>` (`maps/MapDocument.tsx`): the map as the table draws it, read
  only with its grid shown, and a panel with its grid, type and folder, where it is used and its file and history.
  **Adding a map or setting its grid is steps** (`maps/MapEditor.tsx`): Upload, Grid, Check the alignment, and
  Name and use. The calibration keeps its logic in `useCalibration`, which returns its parts for the steps to
  place. `?back=` brings the GM back to the table or the scene that asked; an old library link redirects to the
  map's Grid step.
- **Placing on a map** is a button and then a press on the map (Place on a token's row, a light's Place), or a
  right-click or long press on an empty spot for a menu of what can go there. Both work on the table too.
- **The table's header** names the live scene with a menu that makes another scene live (asked first while a
  fight is on, since that fight is parked) or opens the Scenes tab.
- **Phones** get the same features: the workbench stacks as on the table, the steps are a strip under the head,
  and the map waits in a bar over the bottom tabs that opens it full screen. See as moves into the scene's menu.

On the server, scenes carry `createdAt`, `updatedAt` and `liveAt`, stamped by `stampSceneChanges` after each
mutation; the map upload keeps its folder; and `GET /api/v1/codex/scene-links` (GM only) names the Codex sessions
and pins that point at each scene.

## Consequences and tradeoffs

- The table has one meaning. A GM who staged a scene on the table now opens it on the Scenes tab; the header's
  menu and the table's empty state lead there.
- The scene page and the table share `EncounterMap`, the rail and the tray, so a fix to one is a fix to both, and
  the page's map is exactly the table's.
- Making the scene at the first step means an abandoned new scene stays in the list as a prepared scene. That is
  the same as before, when Prepare scene made it, and the list's Delete removes it.
- The tables' filters live in the address, so they survive a reload but not a visit to another section.

## Mobile, security, and visibility impact

- Phones: the same features at 390px with touch: the tab bar, the stacked workbench, the step strip with the map
  bar, rows in place of tables, a long press on the map for its spot menu.
- Security: every new read is GM only. `scene:preview` is a GM-only read in the command table; its
  answer is built by the projections the real feeds use, so it can show nothing those audiences would not get.
  The scene stamps are on `combat.scenes`, which never reaches a player or the table screen. The scene links read
  only the GM's Codex records.
- Visibility: nothing new reaches players or the table screen.

## Migration / reversibility

Scenes saved before the stamps have none: their Modified reads None and sorts oldest until their next change stamps
`updatedAt`. The old map
library address (`/scenes/maps?map=<id>&from=table`) redirects to the map's Grid step. The change is client-side
apart from the stamps, the read and the upload fix, so reverting the client brings back the old views over the
same data.

## Validation evidence

- Server tests: `map-http.test.ts` (the folder at upload), `scenes.test.ts` (the stamps), `scene-preview.test.ts`
  (what each audience would get, and refusals), `codex-scene-links.test.ts`.
- Client tests: `scenes/scenes-tab.test.tsx` (overview, the scenes table with its filters and sort, the scene page
  with See as, every step of making a scene, phones), `maps/maps-tab.test.tsx` (the maps table, a map's page, each
  step of adding a map), `scenes/scene-lists.test.ts`, `table/table-header-scenes.test.tsx`,
  `scene/map-placement.test.tsx`, `packages/ui/src/records/sort-dialog.test.tsx`.
- The smoke journeys make scenes through the steps, set a grid from a scene's Map step and make it live, on a
  phone and a laptop.
