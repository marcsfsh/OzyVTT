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
- `apps/server/src/viewer-encounter.ts` — `projectViewerEncounterScene`: turns `GameState`
  combat into player-safe tokens.
- `apps/server/src/viewer-access.ts` — pairing codes, viewer/preview token sessions, rate limit.
- `apps/server/src/viewer-http.ts` — routes: pairings, exchange, access, presentation,
  commands, SSE.
- `apps/server/src/viewer-presentation-store.ts` — SQLite singleton state, revision CAS.

## Core model

GM `POST /api/v1/viewer/pairings` mints a 12-hex code (`XXXX-XXXX-XXXX`, 5-min TTL, ≤10
outstanding, held in memory as hashes). The viewer `exchange` (code + name) mints a persistent
`vtt_viewer_` token stored hashed in SQLite, set as an HttpOnly/SameSite=Strict cookie.
**"Present <map>"** sends a GM-only `viewer.presentation.begin` (assetId, altText, camera);
`viewer.map.set` / `camera.set` / `ping` / `measurement.set` follow. Commands are idempotent
by `id` with optimistic `expectedRevision`. The viewer bundle only ever fetches the projection
(`/api/v1/viewer/presentation`, `/api/v1/viewer/events`) — **never full `GameState`.**

Every viewer route is under `/api/v1`. Path constants live in `packages/api-contract`
`VIEWER_PATHS`; the reference is `docs/api-reference.md`. `/viewer.html` is a page, not an API
route, and carries no prefix.

<!-- THE SEVEN SENTENCES BELOW ARE PINNED. A documentation freshness test
     (`apps/server/test/docs-viewer-safety.test.ts`) compares each one against the title of the
     test that proves it, in BOTH directions. Change the wording here and the check fails; change
     it in the test title and it fails too. That is the point: the invariant cannot drift on one
     side only. Re-flowing IS safe — both sides are whitespace-normalised before comparing, so
     line breaks do not matter and only the words do. -->

<!-- Verify after any edit with the loop in `docs/ai-context/testing.md`. -->

## Invariants — VIEWER SAFETY (most important)

The shared screen is a **public display in a room that may contain non-players**. Everything
below follows from that. Each bullet is worded to match the test that proves it, on purpose:
change one and you must change the other, and a check enforces it.

- **Nothing leaks while paused.** `projectViewerPresentation` returns an empty projection that
  hides all presentation content while disabled.
- **Only the GM may mutate.** `applyViewerCommand` rejects non-GM control by throwing
  `ViewerAuthorizationError` — it is the first statement in the function.
- **Only public actors become tokens**, and a token requires a position. The projection
  omits a gm-only combatant from both the player and the viewer lists.
- **Annotations are filtered, not trusted.** The server
  projects only public, non-expired annotations onto the shared screen.
- **Health is a band, never a number.** A richer bar/ring ships only when the GM aimed it at
  everyone, and the viewer derives the fill from the band, so exact HP never reaches others.
- **Initiative appears only while combat is active**, and `hiddenTurn` suppresses the active
  entry when the current actor is not public.
- **The projection type carries no management metadata**, and the viewer bundle ships no GM
  controls — only zoom, reset and follow.
- **A live scene shows its map and its prepared fog before the fight starts**,
  keeping the map/fog but no tokens — no combatant data reaches the public screen
  until combat is active. The fog mask reaches players and the viewer verbatim: it
  *is* the render input.

- **A recorded fight is projected for a player, never filtered.** `projectPlayerReplay`
  (`apps/server/src/replay-projection.ts`) builds a new document from an allow-list over the
  archive's per-turn states, so it hides a combatant until the turn it was revealed, and never
  carries a session id, the journal, the raw states, the notes, or the stat blocks. A `gmOnly`
  filter alone would not be enough: a self-only roll is stored `gm_only = 0` because it IS visible
  — to its roller — and the replay reader is any player, so it drops every roll that is not public.

**The rule for a new field, and the only rule you need:** a field may reach the viewer
projection *only if everything it carries is already public, and it carries no exact quantity
and no identity, position or existence of a non-public thing*. Concretely, that is why the
viewer receives a health **band** and never exact HP; why a token's display style ships only
when the GM aimed it at everyone; and why a hidden effect's source becomes "A hidden threat"
rather than a name. The enumeration of fields that currently pass this test is
`ViewerEncounterScene` and `ViewerPresentationProjection` in
`apps/server/src/viewer-presentation.ts` — **read the types, not a list here.** Adding a field
is a viewer-safety change; when in doubt, omit it.

**Fog is presentation, not a security boundary** (ADR-0022). Hidden identities and geometry
stay stripped by their own filters regardless of what fog covers. Never rely on fog to hide
something that should not have been projected in the first place.

## Gotchas

- Camera: the GM camera is only the default; each display's local pan/zoom overrides and
  never propagates back; resets to "Follow GM view" when `activeMap.assetId` changes.
- Tokens, annotations **and fog** render only when `encounter.mapAssetId === activeMap.assetId`
  — a non-encounter map shows the image and nothing else.
- Pairing codes are single-use, in-memory only (lost on restart); revoke immediately
  disconnects the display.
- Reconnect: EventSource `onerror` → "reconnecting", re-checks presentation, drops to pairing
  on 401; each broadcast re-verifies tokens and evicts revoked/expired.
- `synchronizeEncounter` dedupes via JSON compare; on failure the GM gets `system:error` but
  state is still saved.
- The Codex has its **own** projection boundary with its own rules —
  `apps/server/src/codex-projections.ts`. See `docs/ai-context/codex.md`.

## Relevant ADRs

No ADR names the viewer directly. Governing: `0005` (authoritative command/event,
projections, reconnect snapshots), `0011` (public vs GM-only actor visibility), `0012`
(public vs self-only presentation), `0016` (shared projections + `integration` role), `0014`
(responsive second-screen rendering), `0022` (manual fog of war — presentation, not security).
