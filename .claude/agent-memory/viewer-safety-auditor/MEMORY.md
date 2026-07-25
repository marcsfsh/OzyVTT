# viewer-safety-auditor — memory

The running inventory of GM-only data and known leak vectors for the public viewer / player
projection. Keep this short; put detail in sibling files. Update after every audit.

## GM-only field inventory (must never reach player/viewer projections)

Seed from `docs/ai-context/viewer-mode.md` + `apps/server/src/projections.ts` on first audit.
Known categories: hidden actors/tokens, private/GM rolls, GM notes, hidden-combatant initiative,
management metadata, credentials.

## Known leak vectors / patterns

- **Field-presence guard:** any GM-only `combat.*` field read in the shared table view must be
  guarded on field-presence, not on role/mode — the first post-login state can arrive
  player-projected (no `combat.scenes` etc.), so an unguarded read boundary-crashes the shared view.
- Fog is presentation, not security: hidden geometry/identities stay stripped by their own
  projection filters regardless of fog (ADR-0022).
- **Link-direction asymmetry:** when an entity has a reveal flag AND a structural link to another
  revealable entity, BOTH directions must gate on the target's reveal state. Codex markers correctly
  null `pageId`/`subMapId` when the target is unrevealed; codex maps' `parentMapId` did NOT (a revealed
  child leaked a secret parent's id) — found + fixed 2026-07-24. Re-check any new tree/graph field.

## Codex (worldbuilding) — GM-only inventory

- `gmBody` (page); `gmText`/`attachMarkerId`/`attachPageId`/`sourceEncounterId` (journal);
  `sceneId`/`actorId` (marker); any row with `revealedToPlayers=false`; a revealed row's link to an
  unrevealed target (marker→page/sub-map, map→parent); image bytes of an unrevealed map or a page-asset
  not used by a revealed page's PLAYER body.
- Single choke point: `apps/server/src/codex-projections.ts`. Player reads route through it from
  `codex-http.ts`; unrevealed = **404 not 403** (existence not inferable). Player FTS index
  (`codex_fts_player`) is built from `playerBody` only. HTTP-boundary regression tests:
  `apps/server/test/codex-http.test.ts`.

## Notes

_(add per-audit findings)_
