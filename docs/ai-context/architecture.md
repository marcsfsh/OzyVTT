# Architecture

**Read this when:** you need the system shape, where a responsibility lives, or which
package owns a contract. For deep dives use the subsystem files (`realtime.md`,
`auth-roles.md`, `map-grid.md`, `viewer-mode.md`, `codex.md`).

## Shape

Authoritative client-server. The **server is the sole authority**: clients render and send
commands, and make no privileged game decision. Every outbound update is a projection
computed for the recipient's role — never filtered state.

`GameState` is **not** the whole of authoritative state. The server runs several independent
authoritative stores, each owning its own revision counter and its own change notification:
the game (`apps/server/src/game-store.ts`), the worldbuilding Codex
(`apps/server/src/codex-store.ts`), the homebrew library
(`apps/server/src/homebrew-store.ts`), and the viewer presentation
(`apps/server/src/viewer-presentation-store.ts`). They are constructed together in
`apps/server/src/server.ts`; read that constructor for the current set. A change to one does
not bump another's revision, and a client refetches the projection it cares about rather than
receiving content on the ping — see `realtime.md`.

```
Player browser ─┐                        ┌─▶ game / codex / homebrew stores (SQLite)
                ├─ Socket.IO + REST ─▶ authz ─▶ per-role projection
GM browser ─────┘                        └─▶ on-disk asset roots
Table viewer ◀── SSE, player-safe presentation projection (separate bundle) ───────┘
```

## Where responsibility lives

- **Contracts live once.** The realtime wire contract is `packages/domain` (`GameState`,
  `ClientToServerEvents`, `ServerToClientEvents`, the projection view types). The HTTP
  contract is `packages/api-contract` (`GAME_COMMAND_SCOPES`, `openApiDocument`,
  `REALTIME_PROTOCOL_VERSION`). Change a contract there, never in a transport.
- **Handlers live once.** `apps/server/src/game-operations.ts` holds the shared handlers
  (validation schemas in `game-commands.ts`). The socket adapters in `server.ts` and the HTTP
  routes in `game-http.ts` are thin — add capability to the operations layer, never to one
  transport.
- **Subsystems own their own router and store.** The Codex (`codex-http.ts`,
  `codex-store.ts`, `codex-projections.ts`) and the homebrew library
  (`homebrew-http.ts`, `homebrew-store.ts`) each mount their own Express router and do not
  route through the game command pipeline. See `codex.md`.
- **The client is a routed multi-view SPA** with more than one bundle: the app, the standalone
  table viewer, a standalone character sheet, and a dev styleguide. The entry list is
  `apps/client/vite.config.ts` `build.rollupOptions.input`; the route table is
  `apps/client/src/router.ts`. No authoritative logic lives in any of them.
- **The workspace roster** is `package.json` `workspaces` (`apps/*`, `packages/*`). It is not
  restated here; `docs/app-map.md` is the generated orientation index.

## Command → event → projection

A command is a named event with a UUID `commandId` and optional `expectedRevision`.
Server flow: zod-validate → authorize by role (re-checked per command from the signed
token) → `store.execute` commits **receipt + domain event + new projection** in one SQLite
transaction and bumps `revision` → broadcast a separately-computed GM vs player projection
to every socket. Idempotent by `commandId`; stale `expectedRevision` is rejected, not
overwritten. Details in `realtime.md`.

## Persistence

Embedded SQLite with WAL and versioned migrations. Each accepted game command writes its
idempotency receipt, ordered event and state projection in one transaction; snapshots bound
replay. Not everything lives in the game database: integration credentials have their own
SQLite file, GM/player auth lives in `data/auth.json` (mode `0600`) and **not** in any
database, and map/token/codex binaries live in on-disk asset roots. `apps/server/src/index.ts`
is where all of those paths are chosen — read it before assuming where something is stored.

## Auth and transports

Four principal kinds reach this server, and which surfaces each one reaches is not obvious.
The authoritative table is in the generated, freshness-tested `docs/api-reference.md`
("Authentication") — read it there rather than trusting a copy. Two wire formats coexist over
the same handlers: Socket.IO carries bare domain payloads, the public HTTP API v1 carries
versioned envelopes. Role is re-verified per command from the signed token.

Governing ADRs: `0001` (authoritative LAN server), `0004` (stack), `0005` (realtime),
`0006` (SQLite), `0011` (identity/claims), `0016` (public API). See `docs/adr/`.
