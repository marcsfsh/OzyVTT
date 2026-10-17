---
paths:
  - "apps/server/src/projections.ts"
  - "apps/server/src/viewer-*.ts"
  - "apps/server/src/replay-projection.ts"
  - "apps/server/src/codex-projections.ts"
  - "apps/server/src/codex/visibility.ts"
  - "apps/server/src/codex-http.ts"
  - "apps/client/src/viewer/**"
---

# Projection safety

These files decide what players and the public table screen receive. A field may reach a player
or the viewer only if everything it carries is already public to them, and it carries no exact
quantity and no identity, position or existence of a hidden thing. When in doubt, omit it.

- Build player-facing shapes from an explicit allow-list. Never spread a GM-side object and
  delete keys from it.
- Fog and dynamic vision are part of the boundary (ADR-0023). A creature no player character
  perceives, or one wholly under fog, is left out of players' and the viewer's payloads exactly
  like a GM-only one.
- In the Codex a player gets the player half of a revealed record and nothing else. A revealed
  child must not leak an unrevealed parent or target. A hidden record is a 404, never a 403.

See the "Projections" section of `docs/ARCHITECTURE.md`.
