# Scene-centric IA redesign — design & implementation plan

> **Status:** ✅ IMPLEMENTED 2026-07-22 — 7 verified slices on `claude/scene-prep-gm-notes-c1gcur`.
> **Ships as:** one PR. **Owner-approved decisions are in §4.** This doc is the design record; the
> shipped code refines a couple of details (reorder is drag **plus** a keyboard menu path). See
> `docs/archive/ai-ledger/session-history.md` (2026-07-22) for the per-slice log.
>
> **Post-PR review refinements (2026-07-23).** After the first look the Encounter-tab scene
> quick-switcher changed from an always-on strip (which overflowed once a table had many scenes)
> to a compact **"Scenes" button that opens the gallery in a picker popup** — same gallery as the
> hub, cards shown as square panels. Each card carries explicit **Prepare** + **Go live** buttons
> (opposite corners) instead of a whole-card click; a command bar sits above the hub gallery. Two
> correctness fixes rode along: the **live card counts combatants from the top-level combat** (the
> active scene's own slot is empty by invariant), and **Go live from the hub lands on the Encounter
> tab** (live-play). See §5.1.
>
> **`SceneSwitcher` is gone (noted 2026-08-01).** `scenes/SceneSwitcher.tsx` and
> `scenes/scene-switcher.css` were **deleted** in the same PR this document plans (`c9f3132`, #44),
> because the refinement above replaced the always-on strip with the picker popup. Section 3
> describes the system *as it was before* that PR, so every `SceneSwitcher` reference there is
> historical. The live scene surfaces are `scenes/SceneGallery.tsx`, `scenes/ScenePanel.tsx`,
> `scenes/SceneBuilder.tsx`, `scenes/scenePreview.ts`, `scenes/scene-gallery.css` and
> `scenes/scene-panel.css`.
>
> **How to use this doc.** This is the single source of truth for the scene-centric
> information-architecture (IA) redesign. It is written to be self-contained: a fresh
> session pointed only at this file should understand *what* we're building, *why*, what
> the *current* system looks like, exactly *what to change*, in *what order*, the *invariants*
> that constrain it, and *how to verify*. Read §5–§8 before writing code; keep §11 (viewer
> safety) open while touching projections or the viewer bridge. Detail on the wider app
> lives in `docs/ai-context/` and `docs/ai-ledger/`.

---

## 1. Release note (the goal, in plain terms — written as if already shipped)

**Your table now revolves around Scenes.** Preparing an encounter used to mean two stops:
upload and calibrate a battlemap over in **Map Setup**, then cross to the **Encounter** tab to
pick who's in it and push it live. We've collapsed that into a single, scene-first workspace —
because a scene *is* the thing you actually run: a map, the creatures on it, and the moment you
reveal it.

- **One place to build a scene, start to finish.** Make a new scene and everything happens
  right there: give it a map (drop in a fresh image or pick one you've used), line up its grid,
  stage the monsters and characters, and arrange their tokens. No tab-hopping. When it's ready,
  **Go Live** puts it in front of your players *and* the shared screen in one click.
- **A gallery of every scene you've prepared.** The new **Scenes** view shows all your prepared
  encounters as cards, each with a map thumbnail and a badge for which one is **LIVE** and which
  you're quietly working on. Prep your whole night in advance — the ambush, the boss room, the
  escape — duplicate a scene to spin up a variant, drag them into the order you'll run them, and
  jump between them at a glance.
- **Prep in private, reveal on your cue.** Opening a scene to work on it is still *yours alone* —
  players and the shared display never see your staging. When you switch the live scene mid-session,
  the fight you were running parks itself and resumes exactly where it left off when you come back.
- **Your map library grew into it.** Maps didn't disappear — they became part of the flow. Instead
  of a separate room you visit to manage files, your uploaded and calibrated maps are simply the art
  you reach for while building a scene. The 3×3 grid-calibration and gridless-scale tools are all
  still here.
- **Nothing changed for your players.** Players and the second-screen viewer see exactly what they
  saw before: the one live scene, and only that. This update is entirely about making *your* prep
  faster and more obvious.

---

## 2. Why: map-first → scene-first

Today the mental model is split across two tabs, and the split *is* the friction:

- **`Map Setup` tab** (`MapManager`) owns the noun "map" — upload, calibrate grid, set scale,
  folder/organize. It fetches `/api/v1/map-assets` and emits a `MapSelection`.
- **`Encounter` tab** owns the noun "scene" — the `SceneSwitcher` strip, the `ScenePanel` prep
  modal, `SceneBuilder` staging, and the live `EncounterMap` + `EncounterPanel`.
- They are stitched together by `mapLibrary` / `selectedMap` state lifted into `main.tsx` and
  threaded into both. A scene *references* a map by `mapAssetId`, but the two live in different
  places, so "upload → browse → prepare → start" crosses a tab boundary.

The redesign flips the primary noun from **map** to **scene**: the scene becomes the thing you
browse, build, and run, and the whole upload → browse → prepare → start path lives in one coherent,
scene-first surface (the way Foundry/AboveVTT structure it). The underlying machinery already exists
(server-owned park-and-resume, private staging, viewer safety); this is an **IA / navigation /
presentation** rethink plus two small new capabilities, **not** a data-model rewrite.

**Provenance.** This is the "scene-centric IA redesign" open item in
`docs/ai-ledger/known-bugs.md` (owner round-1 feedback, 2026-07-19: "the owner wants the whole
upload → browse → prepare → start experience rethought against how other VTTs structure it
(scene-centric). Needs a real design pass, not another patch."), plus the deferred "manage all
scenes" browser modal noted in `docs/ai-ledger/current-state.md`. The OzyVTT visual overhaul
(2026-07-21) deliberately kept the current layout IA — this doc is that deferred flow rethink.
`NEXT-STEPS.md`'s "PR E" describes the *pre-implementation* plan and is largely superseded by what
shipped (the `scenes` data model and the `scene:*` commands exist; the `SceneSwitcher` strip it
named was built and then retired in the same PR — see the banner).

---

## 3. The current system (as-is)

### 3.1 Two distinct "scene" concepts (read this first)

There are **two unrelated things called "scene"** in the codebase, and the redesign's biggest
ripple is the relationship between them:

1. **The GM prepared `Scene`** (domain object) — a parked map + a frozen combat context the GM
   parks-and-resumes between. This is what the Scenes hub manages.
2. **The viewer `ViewerEncounterScene`** (server type in `apps/server/src/viewer-presentation.ts`) —
   "the map currently pushed to the shared TV." Driven by GM `viewer.*` presentation commands from
   the **Viewer** tab, **independent** of `scene:activate`.

**Today, making a GM scene live does NOT drive the viewer/TV.** The GM presents a map to the TV
separately. Bridging these is decision §4.1.

### 3.2 Data model — `packages/domain/src/index.ts`

The central idea: **the top-level `state.combat.*` fields ARE the live copy of the active scene.**
No duplication.

- `sceneCombatShape` (~line 212) — the combat fields shared by live combat and every parked scene:
  `active`, `round`, `turnActorId`, `initiative`, `tokens`, `annotations`, `turn` (economy),
  `rulesMode`, `rollMode`, `healthDisplay`, `underwater`, `reactionsUsed`, `legendaryUsed`, `fog`,
  `pendingSaves`, `pendingReactions`.
- `SceneCombatSchema` (~line 278) — `sceneCombatShape` + `refineCombatContext` validation.
- **`SceneSchema`** (~line 282) — `{ id: uuid, name: string(1..120), mapAssetId: uuid, combat: SceneCombat }`.
  **No `order` field, no `thumbnail` field.** Array position = order.
- `CombatStateSchema` (~line 290) — `sceneCombatShape` + `mapAssetId` + `scenes: SceneSchema[].max(20)`
  + `activeSceneId` + timeline bookkeeping (`historyCursor`, `historyDirty`).
- **Hard invariant** (`superRefine`, ~line 313): the **active** scene's stored `combat` slot must be
  *empty* — its live copy is the top-level combat (single source of truth). Duplicate/reorder must
  not break this.
- Socket event signatures (~lines 513–521): `scene:create`, `scene:rename`, `scene:remove`,
  `scene:activate`, `scene:set-combatants`; fog events carry an optional `sceneId` for staging.

### 3.3 Server authority — `apps/server/src/scenes.ts`

GM-only, pure `GameState` mutators. The core is **park-and-resume** (`activateScene`): parks the
current live combat into its scene slot, resumes the target's frozen combat *verbatim* (round, turn,
positions, annotations, fog), and blanks the target's own slot. HP/conditions/token images live on
`state.actors` (global), so damage carries across scene swaps — the correct 5e reading.

- Functions: `createScene`, `renameScene`, `removeScene`, `setSceneCombatants`, `activateScene`,
  `migrateToScene` (binds a pre-scenes encounter to one implicit scene), and helpers
  `snapshotSceneCombat` / `emptySceneCombat` / `buildSceneCombat`.
- Guards: `MAX_SCENES = 20`; ≤200 combatants/scene; can't remove the live scene; can't switch while
  the timeline is mid-review (`historyCursor !== null`).
- **No `duplicateScene`, `reorderScenes`, or thumbnail functions exist.**

### 3.4 Command → operations → transports

Per `docs/ai-context/architecture.md`: the shared, transport-agnostic handlers live in
`apps/server/src/game-operations.ts` (validation schemas in `game-commands.ts`). The Socket.IO
handlers in `server.ts` and the HTTP routes in `game-http.ts` are **thin adapters** over those
functions. **Add new capabilities to the operations layer, never to a single transport.**

- `game-operations.ts` — `sceneCreate` / `sceneRename` / `sceneRemove` / `sceneActivate` /
  `sceneSetCombatants` (each `requireGmGrade` + parse + `store.execute`). Scene-create verifies the
  map is a `battlemap` via `context.mapCatalog` and pulls token geometry via `tokenGeometryFor`.
- `game-commands.ts` — `SceneNameSchema`, `SceneCreateSchema`, `SceneRenameSchema`, `SceneIdSchema`,
  `SceneSetCombatantsSchema`.
- `server.ts` — socket `scene:*` handlers; `mapCatalog` / `mapAssets` / `tokenGeometryFor` context;
  startup `migrateToScene`.
- `game-http.ts` — REST: `POST /game/scenes`, `DELETE/POST /game/scenes/{sceneId}[/rename|/activate|/combatants]`.
- `game-store.ts` — command execution + `commandId` idempotency; `scene:activate` runs the timeline
  path and wipes turn snapshots.

### 3.5 Projections (viewer safety)

- `apps/server/src/projections.ts` — `projectPlayerCombat` / `projectPlayerView` project **only
  top-level (live) combat**; parked scenes never reach players. `projectGmView` spreads full state
  incl. `scenes`. **Any player-facing IA change here is the security-sensitive part.**
- Viewer path (the *other* scene concept): `viewer-presentation.ts` (`ViewerEncounterScene`,
  `projectViewerPresentation`), `viewer-encounter.ts` (`projectViewerEncounterScene` — includes
  **only `visibility === "public"` actors** + unexpired public annotations), `viewer-coordinator.ts`
  (SSE fan-out, `executeGm`, `synchronizeEncounter`), `viewer-http.ts`, `viewer-access.ts`,
  `viewer-presentation-store.ts`.

### 3.6 Client IA — `apps/client/src/main.tsx`

Tab state is a plain `useState` in the top-level `App`, not a router — one component owns everything.

- `type GmTab = "table" | "maps" | "viewer" | "replay" | "setup"` and `GM_TABS` (~lines 35–42);
  `const [gmTab, setGmTab]` (~line 55); `<Tabs>` render (~lines 253–259); one `gmTab === "…"` block
  per tab (~lines 261–330).
- Tabs & contents: **Encounter** (`table`) → the `table-layout` grid (`SceneSwitcher` strip +
  `EncounterMap` + sidebar of `EncounterPanel`/`SceneBuilder`/`DicePanel`/`CombatLog`); **Map Setup**
  (`maps`) → `<MapManager>`; **Viewer** → `<ViewerControls>`; **Replays** → `<ReplayPanel>`;
  **VTT Setup** (`setup`) → appearance + `<IntegrationsPanel>` + session controls.
- `ScenePanel` (scene-prep) and `ViewerPreviewPanel` are tab-independent overlays gated by
  `scenePrepOpen` / `showViewerPreview`.
- `mapLibrary` + `selectedMap` state (~lines 53–54); the library is fetched **independently of
  `MapManager`** in an effect on the `table`/`maps` tabs (~lines 119–133) so setup never needs a
  Maps-tab visit — i.e. **the map list is fetched in two places**.
- Private staging: `previewScene` derived from `previewSceneId` + state (~line 212); effects
  drop/redirect the preview (~213–220); `makeSceneLive` (~221); staging banner + staging
  `EncounterMap` (~267–269); `scenePrepOpen` Modal wrapping `ScenePanel` (~322–324).

### 3.7 The four scattered scene surfaces (client)

The core UX problem: scene lifecycle is spread across four places that the redesign consolidates.

| Surface | File | Owns |
|---|---|---|
| Prep modal | `scenes/ScenePanel.tsx` | **create only** (name + map picker + combatant checkboxes → `scene:create`) |
| Switch strip | `scenes/SceneSwitcher.tsx` — **deleted in `c9f3132`**; replaced by the picker popup | chips; tap-to-stage, ▶ go-live (`scene:activate`), ✕ remove (`scene:remove`), "+ New scene" |
| Staging sidebar | `scenes/SceneBuilder.tsx` | edit *that scene's* combatants (`scene:set-combatants`), rename (`scene:rename`), add SRD monsters (`MonsterBrowser`) |
| On-map buttons | `scene/EncounterMap.tsx` | staging props `moveSceneId` / `staging={onBackToLive,onMakeLive}` / `onScenePrep` (◀ Live / Make live ⬆ / 🎬 Scenes) |
| Preview store | `scenes/scenePreview.ts` | `usePreviewScene` / `setPreviewScene` — **client-only**, never hits the server |

### 3.8 Map library (client)

- `maps/MapManager.tsx` — upload form, search/kind-filter, folder grouping, selection list, and the
  full calibration workspace (3×3 square-grid drag wizard + gridless scale + crosshair tooling).
  **Defines and exports `MapSelection`.** Fetches via `refresh()` → `GET /api/v1/map-assets`.
- `scene/mapImage.tsx` — shared map primitives used by every map surface: `useAuthorizedMapImage`,
  **`useCachedMapThumbnail`** (session-lifetime one-fetch-per-asset cache powering scene-chip
  thumbnails), `GridOverlay`, `imagePointFromClient` / `clampPoint`, `useMapCalibration`, plus token/
  fog/health glyphs.
- Server: `map-http.ts` (`/api/v1/map-assets` REST), `map-catalog.ts` (SQLite metadata: name, kind,
  folder, calibration, scale), `map-assets.ts` (on-disk blobs, checksum dedupe), `grid-calibration*.ts`
  / `grid-overlay.ts` / `map-measurement.ts` (geometry math).

### 3.9 Encounter-start parallel path

`encounter/EncounterPanel.tsx` consumes `selectedMap` / `mapLibrary` / `onSelectMap` with its **own
inline battlemap picker** and a `liveMapRef`, i.e. a parallel "pick a map to start combat" route the
redesign must reconcile with scene-first go-live so there's one obvious way to go live.

### 3.10 API contract

`packages/api-contract/src/index.ts` — `GAME_PATHS.scenes / sceneById / sceneRename / sceneActivate /
sceneCombatants`, `scene:read` / `scene:write` scopes, request schemas, OpenAPI operations. The served
`openApiDocument` must stay **byte-identical** to the contract; `reference.ts` generates
`docs/api-reference.md` (a freshness test enforces it).

---

## 4. Locked decisions (owner-approved)

1. **Go-live bridges to the TV.** Activating a scene also presents that scene's map to the shared
   second-screen — one action makes the scene live for the GM/player table *and* the TV.
2. **New "Scenes" hub; Map Setup folds in.** Add a scene-centric home (gallery + build + go-live);
   map upload/calibration moves inside the scene flow; the Map Setup top-level tab is retired. The
   Encounter tab becomes live-play.
3. **Duplicate + reorder in scope.** Two new commands (`scene:duplicate`, `scene:reorder`).
   **No persisted server thumbnails** (thumbnails stay client-derived via `useCachedMapThumbnail`).
4. **One large PR** (owner aware of the size). Built in verified internal phases (§9).

---

## 5. Target design (to-be)

### 5.1 Tab structure (`main.tsx`, `GM_TABS`)

| Today | After |
|---|---|
| Encounter · **Map Setup** · Viewer · Replays · VTT Setup | **Scenes** · Encounter · Viewer · Replays · VTT Setup |

- **Scenes (new)** — the hub. Primary view = the scene **gallery**. Map-library housekeeping
  (folders, rename, delete, recalibrate) is reachable from the build flow's map picker and a
  "Manage maps" affordance — `MapManager`'s capability moves here; nothing is lost.
- **Encounter (kept)** — live play: the active scene's map + initiative/turn tracker + dice + log,
  with a compact **"Scenes" button** (labelled with the live scene) that opens the scene gallery in
  a **picker popup** for mid-fight scene changes — Prepare / Go live / New scene without leaving the
  map. (Shipped as this button + popup; the original plan's always-on `SceneSwitcher` strip was
  retired in review because it overflowed with many scenes.) Private staging still renders here
  (unchanged mechanism).
- **Viewer / Replays / VTT Setup** — unchanged.

### 5.2 Scenes gallery (centerpiece)

A responsive grid of scene cards. Each card: map **thumbnail** (`useCachedMapThumbnail` + `Skeleton`
while loading), name, combatant count, and a **`Badge`** for `LIVE` / `staging`. Per-card actions via
a **`Menu`** (⋯): Stage privately · Go live · Rename · **Duplicate** · Remove. A primary "**+ New
scene**" card starts the build flow. **Drag-to-reorder** the cards. The LIVE card carries a magenta
accent + glow (state, not resting decoration — design-language §8: "neon is a state").

### 5.3 Build flow

One cohesive build surface (not four): **name → choose map → calibrate (only if the map isn't
calibrated) → stage combatants**. "Choose map" browses the library *and* offers **upload new** inline,
dropping straight into the existing 3×3 calibration wizard. Token placement stays on the private
staging map (`EncounterMap` staging + `SceneBuilder`), launched from the gallery.

- Default to a **single build panel** with calibration surfaced conditionally. The `Steps` primitive
  is available if the flow reads as too long in review; that's a presentational choice, not a
  data-model one. (Open item §12.)

### 5.4 Go-live → TV bridge

`scene:activate` additionally **presents the new scene's map to the viewer** by driving the existing
`viewer.*` presentation path. Safety is inherited, not rebuilt: the TV still renders through
`projectViewerEncounterScene` (public actors + unexpired public annotations only). The manual
**Present / Pause** in the Viewer tab stays (dramatic-reveal escape hatch; presenting non-scene maps
like regional/world). Private *staging* never presents (it's client-only `previewSceneId`).

### 5.5 Duplicate + reorder

- **Duplicate** — copy a prepared scene to tweak a variant.
- **Reorder** — drag scenes into the order you'll run them (session flow).

---

## 6. Backend changes

### 6.1 New commands (through the shared operations layer — never a transport fork)

| Command | Behavior |
|---|---|
| `scene:duplicate {sceneId}` | Deep-copy → new uuid, name `"<name> (copy)"`, same `mapAssetId`, copied combat (tokens/combatants/positions). **Duplicating the active scene** must snapshot the top-level (live) combat into the copy, because the active scene's own slot is empty by invariant. Respects `MAX_SCENES`. Inserts adjacent to the source in `scenes[]`. |
| `scene:reorder {order: string[]}` | Reorders `state.combat.scenes[]` to the given id permutation; reject unless `order` is exactly the current id set. No schema field needed — array position *is* the order. Leaves `activeSceneId` untouched. |

Both: GM-only, `scene:write` scope, idempotent by `commandId`, honor `expectedRevision`.

### 6.2 Files to touch

- `packages/domain/src/index.ts` — add `scene:duplicate` + `scene:reorder` to `ClientToServerEvents`.
  No `SceneSchema` field change (array order suffices; do **not** add `order`).
- `apps/server/src/scenes.ts` — `duplicateScene`, `reorderScenes` (pure mutators matching existing
  helpers; reuse `snapshotSceneCombat` for the active-scene duplicate case).
- `apps/server/src/game-commands.ts` — `SceneDuplicateSchema`, `SceneReorderSchema`.
- `apps/server/src/game-operations.ts` — `sceneDuplicate`, `sceneReorder`; **wire the
  activate→present bridge** at the `sceneActivate` boundary (see §6.3).
- `apps/server/src/server.ts` (socket) + `game-http.ts` (REST) — thin adapters for both new commands.
- `packages/api-contract/src/index.ts` — new `GAME_PATHS` entries, request schemas, OpenAPI operations
  under `scene:write`; **keep the served doc byte-identical**; regenerate `docs/api-reference.md` via
  `reference.ts`.
- `apps/server/src/projections.ts` — unchanged in shape; re-verify players/viewer get only the active
  scene.

### 6.3 The activate→present bridge (wiring note)

`scene:activate` lives in the game store; viewer presentation lives in a **separate** store
(`viewer-presentation-store.ts`) driven via `viewer-coordinator.ts`. On a successful activate, also
set the presented map to the new scene's `mapAssetId` (the `viewer.presentation.begin` / `viewer.map.set`
path). Implement as **one shared post-activate helper on the viewer coordinator, invoked by both the
socket and HTTP adapters** (so both transports bridge identically), or inside the operation context if
the coordinator is available there — confirm the exact seam when building. Keep `viewer.*` authority and
projection unchanged; the bridge only chooses *which map* is presented, never *what* is projected.

---

## 7. Client UI + style system

### 7.1 Components

- **New:** `scenes/SceneGallery.tsx` (the hub) + a `SceneCard`, a scene **build panel** (evolves
  `ScenePanel` beyond create-only), and reorder logic.
- **Evolve:** `SceneSwitcher` → slim Encounter-tab quick-switcher; `SceneBuilder` staging sidebar
  reused; `scenePreview.ts` unchanged. *(Outcome: the quick-switcher became the "Scenes" button +
  gallery popup instead, and `SceneSwitcher` was deleted rather than evolved.)*
- **Fold in:** `MapManager` rendered inside the Scenes hub / build flow rather than a top-level tab.
- **`main.tsx`:** re-cut `GM_TABS`, the tab-gated blocks, and the `mapLibrary` / `selectedMap`
  orchestration; consolidate the double map-library fetch to one owner.

### 7.2 Style guide (hard requirement — `docs/ai-context/design-language.md`)

- Build only from `@vtt/ui` primitives. **Available and relevant:** `Panel` (+ `PanelHeader`, accent
  hairline), `Badge` (LIVE/staging), `Menu`/`MenuItem` (card actions), `Skeleton` (thumbnail load),
  `Button`/`IconButton`, `Modal`, `SegmentedControl`, `Steps` (optional build wizard), `Chip`,
  `Tooltip`, `Toast`.
- **No `Card` primitive exists.** Add a **`.nh-card` + `.nh-gallery` pattern** to
  `packages/ui/src/styles/patterns.css` (matching the `.nh-table` / `.nh-statlist` / `.nh-empty`
  precedent), with interactive bits being existing primitives placed inside. **It is not done until
  it's demoed in `/styleguide` across all three themes** (dark/dusk/light).
- Tokens only — reference `var(--…)`, never hex. Success = cyan (no green); damage/destructive = rose
  `--danger`; LIVE state = magenta `--glow-magenta`. Every state carries an icon and/or text label,
  never color alone. One bold/glowing element per region at rest.
- Voice/copy (design-language §9): sentence case; actions name their result and keep the name through
  the flow ("Go live", "Duplicate scene"); empty states invite action.

### 7.3 CSS + mobile parity (`docs/ai-context/mobile-ux.md`)

- New `scenes/scene-gallery.css`; rework `scenes/scene-panel.css`, `styles.css` (`.gm-tabs`,
  `.table-layout`); reuse `maps/map-manager.css`. *(`scenes/scene-switcher.css` was on this list;
  it was deleted with its component rather than reworked.)*
- Honor breakpoints: `styles.css` at 980/760/560; `scene-panel.css` at 560; `map-manager.css` at
  850/560. Gallery collapses toward `1fr` at narrow widths.
- **Drag-to-reorder must use Pointer Events and set `touch-action: none`** on the draggable surface
  (native scroll/zoom otherwise fights the gesture — same rule as `.tray-token`, `.map-preview.movable`).
- Honor `prefers-reduced-motion`; animate context changes at the container level, not per list row.

---

## 8. Build sequence (phased inside the one PR)

Each phase ends green (`npm run check` + `npm run test` + `npm run build`) before the next, so the big
diff is assembled from verified steps and is bisectable:

1. **Backend commands** — `scene:duplicate` + `scene:reorder` + `game-commands` schemas + operations +
   both adapters + api-contract + server tests. (Isolated, low-risk, testable alone.)
2. **Viewer bridge** — activate→present helper + viewer-safety tests.
3. **`@vtt/ui`** — `.nh-card` / `.nh-gallery` pattern + `/styleguide` section (three themes).
4. **Scenes hub** — gallery + cards + reorder + menus, reading existing + new commands.
5. **Build flow + map fold-in** — unified build panel; move `MapManager` into the hub; retire the
   Map Setup tab.
6. **Encounter tab** — slim quick-switcher; reconcile `EncounterPanel`'s inline map-picker/start with
   scene-first go-live.
7. **Polish + mobile** — narrow-viewport gallery, touch drag-reorder, motion/reduced-motion, three-theme
   pass.

---

## 9. Verification

- `npm run check` + `npm run test` + `npm run build` green.
- **New server tests:** `scene:duplicate` (incl. duplicating the **active** scene → copy carries the
  live combat; the active-slot-empty invariant holds), `scene:reorder` (permutation validation;
  `activeSceneId` preserved; rejects a non-matching id set), and the **viewer-bridge safety test** (a
  hidden/`gm-only` monster in a now-live scene must **not** appear on the TV projection).
- **api-contract:** extend the byte-identical `openApiDocument` test; regenerate `api-reference.md` and
  keep its freshness test green.
- **Live Playwright smoke (GM + player + `/viewer.html`)** — the project's standard bar (seed a map +
  calibration + encounter via the API; drive the map inside the full-viewport "Enlarge map" overlay):
  build scene A + scene B; go live on A → **A appears on the TV**; stage B privately (player + viewer
  still see A); go live on B → TV switches; duplicate a scene; drag-reorder; switch back to A intact.
  Verify at desktop **and** 390px touch.

---

## 10. Invariants & viewer-safety checklist (gate before "done")

From `docs/ai-context/{viewer-mode,auth-roles,realtime,map-grid,mobile-ux}.md`:

- [ ] Players & viewer see **only the active scene**; parked/staged scenes never project.
- [ ] The TV bridge adds **no new projected field** — it reuses `projectViewerEncounterScene`
      (public actors + unexpired public annotations only). A hidden combatant in the live scene does
      not become a TV token.
- [ ] All new commands are **GM-only** and `scene:write`-scoped; role derives from the signed token.
- [ ] `scene:reorder` / `scene:duplicate` cannot desync `activeSceneId` or violate the empty-active-slot
      invariant.
- [ ] New capabilities go through the **shared operations layer**; both transports call the same path;
      OpenAPI stays byte-identical; idempotency + `expectedRevision` preserved.
- [ ] Server still owns all snapping/geometry (calibration unchanged); client math stays preview-only in
      image-pixel space (`imagePointFromClient`).
- [ ] Every draggable surface sets `touch-action: none`; verified at a narrow viewport with touch.
- [ ] Built from `@vtt/ui` primitives; no hex; new card pattern demoed in `/styleguide` in all three
      themes; AA contrast verified.

---

## 11. Risks, edge cases, open sub-decisions

- **Biggest risk:** untangling the four scattered scene surfaces + the `EncounterPanel` parallel
  start-path without regressing live combat. Mitigated by the phase order (backend → bridge → UI last)
  and the Playwright gate.
- **Edge cases to test explicitly:** duplicating the **active** scene (must snapshot live combat);
  reorder **during a live fight** (must not touch `activeSceneId` or the timeline); go-live while the
  timeline is mid-review (already blocked by `activateScene`); a scene whose map was deleted from the
  library.
- **Open sub-decision — pre-combat player map.** The bridge presents to the **TV** on go-live.
  Recommended default: leave the **player** client's existing map-on-combat-active behavior unchanged
  (avoids a player-projection change mid-PR). Revisit if players should also see the live scene map
  before combat starts. *(Not blocking; default chosen.)*
- **Open sub-decision — build flow shape.** Single build panel (default) vs an explicit `Steps` wizard.
  Decide in UI review; presentational only.

---

## 12. Docs / ledger updates (after implementation)

- `docs/ai-ledger/current-state.md` — describe the new scene-centric IA.
- `docs/ai-ledger/known-bugs.md` — close the "Maps/scenes/encounter IA redesign" item.
- `docs/ai-ledger/decision-log.md` — record the scene↔TV bridge decision and the Map-Setup-tab retirement.
- `docs/archive/ai-ledger/session-history.md` — session entry.
- `docs/api-reference.md` — regenerated from the contract.
- `NEXT-STEPS.md` — retire/refresh the stale "PR E" section.

---

## 13. Out of scope

Persisted server thumbnails; changing when *players* (not the TV) receive the map; a ⌘K command
palette; GM notes / character-builder features; vision/lighting/line-of-sight; any change to the
combat rules engine, dice, or the calibration math.

---

## 14. Consolidated file index (reference)

**Client — scenes & IA:** `apps/client/src/main.tsx` · `scenes/SceneGallery.tsx` ·
`scenes/ScenePanel.tsx` · `scenes/SceneBuilder.tsx` · `scenes/scenePreview.ts` ·
`scenes/scene-gallery.css` · `scenes/scene-panel.css` · `scene/EncounterMap.tsx` ·
`scene/encounter-map.css` · `styles.css` · `encounter/EncounterPanel.tsx` · `encounter/MonsterBrowser.tsx`.
*(This index was written as a plan. `scenes/SceneSwitcher.tsx` and `scenes/scene-switcher.css`
stood here until 2026-08-01; both were deleted in `c9f3132` and are replaced above by the gallery
files that shipped instead.)*

**Client — maps:** `maps/MapManager.tsx` · `maps/map-manager.css` · `scene/mapImage.tsx`.

**Client — viewer:** `viewer/ViewerControls.tsx` · `viewer/ViewerApp.tsx` · `viewer/ViewerPreviewPanel.tsx` ·
`viewer-main.tsx` · `viewer/{viewer,viewer-controls,viewer-page,viewer-preview}.css`.

**UI system:** `packages/ui/src/index.ts` · `packages/ui/src/primitives/*` · `packages/ui/src/styles/patterns.css` ·
`packages/ui/src/styles/design-tokens.css` · the `/styleguide` route.

**Domain:** `packages/domain/src/index.ts` (`SceneSchema`, `CombatStateSchema`, `ClientToServerEvents`).

**Server — scenes/game:** `apps/server/src/scenes.ts` · `game-operations.ts` · `game-commands.ts` ·
`server.ts` · `game-http.ts` · `game-store.ts` · `projections.ts`.

**Server — maps:** `map-http.ts` · `map-catalog.ts` · `map-assets.ts` · `grid-calibration.ts` ·
`grid-calibration-wizard.ts` · `grid-overlay.ts` · `map-measurement.ts`.

**Server — viewer:** `viewer-presentation.ts` · `viewer-encounter.ts` · `viewer-coordinator.ts` ·
`viewer-http.ts` · `viewer-access.ts` · `viewer-presentation-store.ts`.

**API contract:** `packages/api-contract/src/index.ts` · `packages/api-contract/src/reference.ts` ·
`docs/api-reference.md`.

**Tests (server, `apps/server/test/`):** `scenes.test.ts` · `game-http.test.ts` ·
`encounter-projections.test.ts` · `combat-history.test.ts` · `viewer-http.test.ts` ·
`viewer-presentation*.test.ts` · `map-*.test.ts` · `grid-*.test.ts`.

**Context docs:** `docs/ai-context/{architecture,viewer-mode,auth-roles,realtime,map-grid,mobile-ux,design-language,ux-principles}.md`
· `docs/ai-ledger/{current-state,known-bugs,decision-log}.md` · `docs/archive/ai-ledger/session-history.md`.
