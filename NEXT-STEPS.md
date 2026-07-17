# Next steps — Cycle 4 remaining work (PR D, E, F)

> Standalone plan for the remaining Cycle-4 work, kept in the repo so it's easy to find.
> Cycle 4 so far (all merged to `main`): **#28** batch A (labels, cone/line snap, Delete key,
> tray-drop, eye glyph, grid-wizard zoom/redo/crosshairs, viewer reset + pop-out, dice/layout,
> "GM Setup"→"VTT Setup"); **#29** batch B (free-direction cone/line, measurement above tokens,
> live token grid-snap, grid-wizard solid + bolder lines); **#30** PR C (per-drawing colors,
> GM/player layer toggle, encounter-map pings with sender name).

## Working method (keep doing this)
Every PR must be `npm run check` + `npm test` + `npm run build` green **and** pass a live Playwright
smoke (seed a map + calibration + encounter via the API, drive the map inside the full-viewport
"Enlarge map" overlay so drags land on-screen) before it goes up. Branch: `claude/adr-backfill-wv0nbq`,
restarted from latest `main` after each merge. Never put the raw model id in commits/PRs.

---

## PR D — configurable dock position + Encounter/Initiative declutter + gridless saveable grid

### D-1. Configurable dock position (Initiative panel: sidebar / left / right / top / bottom)
Today the dock is a boolean (`dockInitiative` in `apps/client/src/main.tsx`) rendered as an absolute
**right** overlay inside `.encounter-map-stage` (`apps/client/src/scene/EncounterMap.tsx`, the
`rightDock` prop + `.encounter-map-dock` / `.encounter-map-zoom.docked-left` /
`.encounter-map-stage.has-right-dock` classes).

- Replace the boolean with a `DockPosition = "sidebar" | "left" | "right" | "top" | "bottom"` state
  (lifted to `main.tsx`, persisted in `localStorage`).
- Generalize the `rightDock` prop to `dock?: { node, position }`; render the overlay on the chosen
  edge — left/right = full-height side column, top/bottom = full-width strip (capped height,
  `overflow: auto`). Move the zoom cluster to a corner that avoids the dock.
- Extend `resetView`'s dock-offset math (currently offsets X for a right dock) to offset for
  top/bottom/left too, and update `beginGesture`'s `.encounter-map-dock` guard.
- Turn `DockToggle` (in `apps/client/src/encounter/EncounterPanel.tsx`) into a small 5-way position
  picker. **Use fixed rem/% sizes per position** — the user's key ask is that it stop auto-adjusting
  when the window is resized.
- Files: `main.tsx`, `scene/EncounterMap.tsx`, `scene/encounter-map.css`, `encounter/EncounterPanel.tsx`,
  `encounter/encounter-panel.css`.

### D-2. Encounter/Initiative panel declutter
The GM branch of `EncounterPanel.tsx` is dense (per-row score `<input>` + `Save` on every initiative
row, plus setup list + status + turn controls). Collapse per-row chrome into inline-edit (click a
score to edit; Enter/blur saves) so idle rows are just name + score + active marker; group the turn
controls compactly. Keep all functionality (`initiative:set/next/previous`, start/end). A
"with-your-eyes-on-it" pass — verify via Playwright that nothing regresses.
Files: `encounter/EncounterPanel.tsx`, `encounter/encounter-panel.css`.

### D-3. Gridless maps: saveable, toggleable grid (with grid color)
Map assets already store `calibration` (square grid) and `scale` separately
(`apps/server/src/map-catalog.ts`). `MapManager.tsx` gates the 3×3 grid **wizard** behind
`battlemapMode === "square"`; the encounter map only *snaps* to calibration — it does not draw a grid
overlay today.

1. Let `MapManager` offer the same 3×3 wizard for gridless maps and save it to the existing
   `calibration` field (reuse `startAreaWizard`/`completeWizard`; the `/calibration/wizards` route is
   generic). A gridless map may then carry both a `calibration` (optional overlay) and a `scale`.
2. Add `gridOverlay: { visible: boolean; color: string }` to `CombatStateSchema`
   (`packages/domain/src/index.ts`, default `{ visible: false, color: "#8fb2ff" }`) + a GM-only
   `combat:set-grid { visible?, color? }` socket command wired like the other combat commands in
   `apps/server/src/server.ts`. Project it into `PlayerCombatView` and the Channel-B viewer scene.
3. Render the overlay in `EncounterMap.tsx` and `viewer/ViewerApp.tsx` when visible + calibration
   exists — add a `gridOverlayLines(calibration, width, height)` helper in `scene/mapImage.tsx` and
   reuse the existing `GridOverlay` component (stroke = `gridOverlay.color`). Add a GM toolbar grid
   toggle + color picker (reuse the PR-C color-swatch pattern).

### PR D verification
`check` + `test` + `build`; server tests for `combat:set-grid` projection + the gridless calibration
path. Live Playwright: dock the panel to each edge and confirm it stays fixed on resize + the zoom
cluster relocates + `Reset view` centers the map in the visible area; inline-edit an initiative score
+ advance turns; calibrate a grid on a gridless map, toggle it on (lines appear on the GM map + a
paired `/viewer.html`), change grid color.

---

## PR E — change map / staging (multi-scene)

**Intent:** the GM prepares multiple maps (character tokens + shapes) privately before/while playing,
then switches which scene is live for players + viewer during the game — non-destructively. Locked-in
UX: **Map Setup tab = the private staging surface**; the **Encounter tab gets a "Change scene" button**
(next to "Preview what players see") to promote a staged map to live.

**Model (recommended).** Extend combat state from a single active map to a set of prepared scenes plus
one active pointer, in `packages/domain/src/index.ts`:
- `SceneSchema = { id, name, mapAssetId, tokens: EncounterToken[], annotations: Annotation[] }`.
- `CombatStateSchema` gains `scenes: SceneSchema[]` + `activeSceneId: string | null`; the existing
  `mapAssetId`/`tokens`/`annotations` become **derived from the active scene** — keep emitting the same
  `PlayerCombatView` / viewer shapes so client + Channel-B viewer need minimal change.
- Token + annotation commands gain an optional `sceneId` (GM may target a staged scene; players always
  act on the active scene). New GM commands: `scene:create`, `scene:activate` (the "Change scene"
  action), `scene:remove`, `scene:rename`. **Players/viewer only ever see the active scene**; the GM
  view carries all scenes so the staging surface can render/edit any of them.

**Client.** Map Setup tab: GM opens a stored map in a GM-only staging editor that reuses `EncounterMap`
pointed at a chosen `sceneId`. Encounter tab: a "Change scene" button opens a picker and calls
`scene:activate`.

**Scope warning.** Real data-model refactor across domain, `game-store`/`server.ts`, `projections.ts`,
`viewer-encounter.ts`/`viewer-presentation.ts`, and several client surfaces + migration of existing
persisted combat (old single-map → one implicit scene). Its own branch/PR; build the server model +
one command at a time with tests; keep the projected player/viewer shapes byte-compatible. A first cut
can support create/stage/activate before rename/remove polish.

**Verification.** Server tests for scene create/activate/target-scene commands + projection (players/
viewer see only the active scene; GM sees all). Live Playwright (GM + player + `/viewer.html`): stage
tokens+shapes on map B while A is live (player/viewer still see A), "Change scene" → B, confirm the
switch, switch back to A intact.

---

## PR F — complete Open-API review + update (make the API robustly reflect the app)

**Intent (user's words):** "I want this app to have an Open API that is very robust, and enables
integrations with a wide variety of tools — so it's both a useful, polished, capable app **and** a very
robust tool for any toolkit that is open to integrations." Do a **complete review and update** so the
current state of the app still meets the API standard: everything Cycle 3/4 shipped should be reachable
+ documented through the public API, not just the UI.

**The gap to close.** The Open API is a firm product requirement (RISK-004: API adapters must reuse the
same command / authorization / projection layer as the UI — never a parallel path), and the served
`openApiDocument` must stay **byte-identical** to the contract (`packages/api-contract`). But the app's
capabilities grew almost entirely over **Socket.IO** (`ClientToServerEvents` in
`packages/domain/src/index.ts`: `encounter:*`, `initiative:*`, `token:move`,
`annotation:add/move/remove/set-visibility/set-movable/set-color/ping/clear`, `dice:*`, viewer
commands) — **none of which are in `/api/v1`**. Today the documented REST surface is only bootstrap/
auth, integration credentials, map assets, and viewer presentation
(`apps/server/src/api-v1.ts`, `map-http.ts`, `viewer-http.ts`). An integrator can't read encounter
state or drive combat/annotations through the public API. That is the standard-vs-reality drift.

**Approach.**
1. **Audit** every capability → documented / needs-doc / needs-new-endpoint (gap list first).
2. **Safe game snapshot (read):** versioned, scoped `GET /api/v1/game` (+ `/game/combat`,
   `/game/annotations`, `/game/actors`, `/game/rolls`) returning the **same** recipient-safe DTOs the UI
   uses (`apps/server/src/projections.ts`). Don't invent a second shape.
3. **Authoritative commands (write):** documented POSTs (annotations, encounter start/end, initiative
   next/prev, token move, dice roll, ping, …) that call the **exact same** `store.execute` path as the
   socket handlers (`apps/server/src/server.ts` → `annotations.ts`, `encounter.ts`,
   `token-placement.ts`). Same envelopes, `ApiErrorCodeSchema` vocabulary, command-id idempotency +
   `expectedRevision`.
4. **Scopes + auth:** extend the scope list coherently (`game:read`, `game:write`, `dice:roll`, keep
   `map:*`/`viewer:*`) and enforce via the existing integration-credential authorizer
   (`integration-credentials.ts`); document each route's required scope.
5. **Realtime for integrators:** document a subscribe/resume path (socket contract and/or an SSE mirror,
   aligned with the existing viewer SSE).
6. **Contract discipline:** every addition goes into `packages/api-contract/src/index.ts` (paths +
   schemas + security); keep the byte-identical served-doc contract test green and extend it; add a
   quick-start conformance test that reads a snapshot and issues one authoritative command end-to-end.

**Reuse, don't rebuild:** the command layer (`server.ts` handlers + `game-store.ts` `store.execute`,
`annotations.ts`, `encounter.ts`, `token-placement.ts`), projections (`projections.ts`,
`viewer-encounter.ts`), the contract (`packages/api-contract`), the existing routers, and the
credential authorizer. The Cycle-2 D9/UX-004 work already folded map/viewer routers into the doc and
aligned error envelopes — follow that exact pattern for the new game routes.

**Sequencing:** do PR F **after PR E** (the scene model reshapes game state, so documenting it before E
would immediately drift again). Land as its own PR; read endpoints first, then commands, then realtime/
quick-start, each with contract + parity tests.

**Verification:** full `npm test` incl. the byte-identical `openApiDocument` contract test + new
`api-contract` tests for the added paths/schemas/scopes; server tests proving each new REST command
routes through the **same** `store.execute`/authorization/projection path as its socket twin (parity,
not a fork) and enforces scopes + recipient-safe redaction; a scripted quick-start that authenticates
with a scoped credential, `GET /api/v1/game`, issues one authoritative command (e.g. add an
annotation), and observes the resulting state change.
