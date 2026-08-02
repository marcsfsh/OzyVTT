---
paths:
  - "apps/server/src/projections.ts"
  - "apps/server/src/viewer-*.ts"
  - "apps/server/src/codex-projections.ts"
  - "apps/server/src/codex-http.ts"
  - "apps/client/src/viewer/**"
  - "apps/client/src/viewer-main.tsx"
  - "apps/client/src/codex/PlayerCodex.tsx"
---

# Viewer safety (hard invariant — CLAUDE.md rule 3)

The public table viewer must **never** expose anything GM-only: hidden actors/tokens,
private rolls, GM controls, or management metadata. It is a one-way, player-safe projection.

- Re-check **every new field** you add to a viewer projection, the viewer sanitizer, or a
  viewer payload — when in doubt, omit it.
- Fog is presentation, not a security boundary: hidden geometry/identities stay stripped by
  their own projection filters regardless of fog (ADR-0022).
- The Codex has a **second, larger** projection boundary: `codex-projections.ts`. A player
  receives the player half of a **revealed** record and nothing else, and reveal is a *graph* —
  a revealed child must not leak an unrevealed parent's or target's identity. A hidden record
  is a **404, never a 403**, and an ETag is computed after every authorization and existence
  gate so a `304` cannot confirm that a secret exists. Full context: `docs/ai-context/codex.md`.

Full context: `docs/ai-context/viewer-mode.md`.
