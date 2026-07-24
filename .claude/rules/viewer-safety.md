---
paths:
  - "apps/server/src/projections.ts"
  - "apps/server/src/viewer-*.ts"
  - "apps/client/src/viewer/**"
  - "apps/client/src/viewer-main.tsx"
---

# Viewer safety (hard invariant — CLAUDE.md rule 3)

The public table viewer must **never** expose anything GM-only: hidden actors/tokens,
private rolls, GM controls, or management metadata. It is a one-way, player-safe projection.

- Re-check **every new field** you add to a viewer projection, the viewer sanitizer, or a
  viewer payload — when in doubt, omit it.
- Fog is presentation, not a security boundary: hidden geometry/identities stay stripped by
  their own projection filters regardless of fog (ADR-0022).

Full context: `docs/ai-context/viewer-mode.md`.
