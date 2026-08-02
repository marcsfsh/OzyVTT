---
paths:
  - "apps/server/src/auth.ts"
  - "apps/server/src/authorization.ts"
  - "apps/server/src/character-claims.ts"
  - "apps/server/src/integration-credentials.ts"
  - "apps/server/src/login-rate-limit.ts"
  - "apps/server/src/game-operations.ts"
  - "apps/server/src/game-commands.ts"
  - "apps/server/src/codex-http.ts"
  - "packages/api-contract/**"
---

# Roles & authorization (hard invariant — CLAUDE.md rule 4)

A player may act **only** on their claimed character; the GM may act on anything.

- GM-only commands stay gated per command — never rely on the UI hiding a control.
- Role derives from the **signed token**, never from network position or client-supplied
  identity. Never trust client input for authorization.

Full context: `docs/ai-context/auth-roles.md`.
