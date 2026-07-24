---
paths:
  - "packages/domain/**"
  - "apps/server/src/server.ts"
  - "apps/server/src/game-operations.ts"
  - "apps/server/src/game-commands.ts"
---

# Realtime & server authority (hard invariant — CLAUDE.md rule 2)

The server owns `GameState` and is the sole authority. Never move a game decision
(snapping, visibility, dice, turn order, authorization) to the client.

- The wire contract lives **once** in `packages/domain` and stays in lockstep across client
  and server; version it when it changes.
- Validate **and** authorize every command; preserve idempotency (`commandId`) and
  revision/optimistic-concurrency handling. Client previews mirror, never replace, the
  server result.

Full context: `docs/ai-context/realtime.md`.
