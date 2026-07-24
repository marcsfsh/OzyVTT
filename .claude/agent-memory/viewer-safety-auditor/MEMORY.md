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

## Notes

_(add per-audit findings)_
