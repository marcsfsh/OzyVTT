---
paths:
  - "packages/api-contract/**"
  - "apps/server/src/api-v1.ts"
  - "apps/server/src/game-http.ts"
  - "apps/server/src/viewer-http.ts"
  - "apps/server/src/map-http.ts"
  - "apps/server/src/token-http.ts"
---

# Public API contract (hard invariant — ADR-0016)

The public HTTP API v1 must reuse the **same** command/authorization/projection path as the
UI — never a parallel fork — and the served `openApiDocument` must stay **byte-identical** to
`packages/api-contract`.

Full context: `docs/ai-context/architecture.md` and the `@vtt/api-contract` package.
