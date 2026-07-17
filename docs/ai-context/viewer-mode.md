# Viewer / second-screen (table viewer)

**Read this when:** touching the viewer bundle, pairing/presentation, or **anything that
projects state to the public screen.** Viewer safety is a hard invariant — read §Invariants
before changing projections.

## Key files

- `apps/client/viewer.html` + `apps/client/src/viewer-main.tsx` — standalone viewer entry;
  a **separate React bundle**, isolated from the GM/player client.
- `apps/client/src/viewer/ViewerApp.tsx` — viewer SPA: `Pairing`, SSE lifecycle, `MapStage`
  (local pan/zoom), `Initiative`.
- `apps/client/src/viewer/ViewerControls.tsx` — GM panel: create pairing code, Present/Pause,
  switch map, focus/ping/measure, revoke displays.
- `apps/client/src/viewer/ViewerPreviewPanel.tsx` — GM's in-tab iframe of `/viewer.html`.
- `apps/server/src/viewer-presentation.ts` — canonical state, command validation,
  `applyViewerCommand`, **`projectViewerPresentation` (the safe projection)**.
- `apps/server/src/viewer-coordinator.ts` — SSE fan-out; `executeGm`, `synchronizeEncounter`.
- `apps/server/src/viewer-encounter.ts` — projects `GameState` combat into player-safe tokens.
- `apps/server/src/viewer-access.ts` — pairing codes, viewer/preview token sessions, rate limit.
- `apps/server/src/viewer-http.ts` — routes: pairings, exchange, presentation, commands, SSE.
- `apps/server/src/viewer-presentation-store.ts` — SQLite singleton state, revision CAS.

## Core model

GM `POST /viewer/pairings` mints a 12-hex code (`XXXX-XXXX-XXXX`, 5-min TTL, ≤10 outstanding,
held in memory as hashes). The viewer `exchange` (code + name) mints a persistent
`vtt_viewer_` token stored hashed in SQLite, set as an HttpOnly/SameSite=Strict cookie.
**"Present <map>"** sends a GM-only `viewer.presentation.begin` (assetId, altText, camera);
`viewer.map.set` / `camera.set` / `ping` / `measurement.set` follow. Commands are idempotent
by `id` with optimistic `expectedRevision`. The viewer bundle only ever fetches the
projection (`/viewer/presentation`, `/viewer/events`) — **never full `GameState`.**

## Invariants — VIEWER SAFETY (most important)

- `projectViewerPresentation` returns an **empty, disabled** projection whenever
  `enabled=false` — nothing leaks while paused.
- Only `role: "gm"` may mutate state; otherwise `applyViewerCommand` throws
  `ViewerAuthorizationError`.
- `projectViewerEncounterScene` includes **only actors with `visibility === "public"`** —
  GM-only / hidden combatants never become tokens; a token requires a position.
- Annotations: only `visibility === "public"` and unexpired reach the viewer.
- Initiative shows only when `combat.active` and `initiative.visible`; `hiddenTurn`
  suppresses the active entry when the current actor isn't public; ≤1 active entry.
- The projection type omits management metadata (e.g. `acceptedCommandIds`); the viewer
  client ships **no GM controls**.

**Any change that adds a field to the viewer projection must be checked against these
rules.** When in doubt, default to not exposing it.

## Gotchas

- Camera: the GM camera is only the default; each display's local pan/zoom overrides and
  never propagates back; resets to "Follow GM view" when `activeMap.assetId` changes.
- Tokens/annotations render only when `encounter.mapAssetId === activeMap.assetId` — a
  non-encounter map shows the image but no tokens.
- Pairing codes are single-use, in-memory only (lost on restart); revoke immediately
  disconnects the display.
- Reconnect: EventSource `onerror` → "reconnecting", re-checks presentation, drops to pairing
  on 401; each broadcast re-verifies tokens and evicts revoked/expired.
- `synchronizeEncounter` dedupes via JSON compare; on failure the GM gets `system:error` but
  state is still saved.

## Relevant ADRs

No ADR names the viewer directly. Governing: `0005` (authoritative command/event,
projections, reconnect snapshots), `0011` (public vs GM-only actor visibility), `0012`
(public vs self-only presentation), `0016` (shared projections + `integration` role), `0014`
(responsive second-screen rendering).
