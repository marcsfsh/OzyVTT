# Architecture

**Read this when:** you need the system shape, where a responsibility lives, or which
package owns a contract. For deep dives use the subsystem files (`realtime.md`,
`auth-roles.md`, `map-grid.md`, `viewer-mode.md`).

## Shape

Authoritative client-server. The **server owns canonical `GameState`**; clients render and
send commands but make no privileged game decisions. Every outbound update is projected
per recipient role before it leaves the server.

```
Player browser ─┐
                ├─ Socket.IO / REST ─▶ Authoritative server ─▶ authz + projection ─▶ SQLite
GM browser ─────┘                                                    │
Table viewer ◀── player-safe projection (separate bundle) ──────────┘
```

## Workspaces (npm monorepo, Node ≥24)

| Package | Responsibility |
| --- | --- |
| `apps/client` (`@vtt/web`) | Responsive React/Vite UI. No authoritative logic. Has GM/player app **and** a separate viewer bundle (`viewer.html` → `viewer-main.tsx`). |
| `apps/server` (`@vtt/server`) | Express + Socket.IO, GM auth, authorization, state ownership, projections, SQLite persistence. Command handlers live in `server.ts` (older ADRs cite `index.ts`, which is now just the listen bootstrap). |
| `packages/domain` | **Single source of truth for the wire contract:** `GameState`, `ClientToServerEvents`, `ServerToClientEvents`, projection view types (`PlayerView`/`GmView`). Imported by both client and server. |
| `packages/schemas` | Versioned `Actor`/content validation schemas. |
| `packages/rules-5e` | Safe, declarative 5e calculation helpers. No imported executable logic. |
| `packages/api-contract` | Versioned `CommandEnvelope`/`EventEnvelope` for the public HTTP integration API (a *second* adapter over the same handlers) + integration credentials. `REALTIME_PROTOCOL_VERSION="1"`. |
| `packages/ui` | Shared UI (typecheck-only). |
| `packages/content-srd-5.2.1` | SRD content. |
| `packages/test-fixtures` | Reserved placeholder (`fixtureMetadata` only; not yet consumed). |

## Command → event → projection

A command is a named event with a UUID `commandId` and optional `expectedRevision`.
Server flow: zod-validate → authorize by role (re-checked per command from the signed
token) → `store.execute` commits **receipt + domain event + new projection** in one SQLite
transaction and bumps `revision` → broadcast a separately-computed GM vs player projection
to every socket. Idempotent by `commandId`; stale `expectedRevision` is rejected, not
overwritten. Details in `realtime.md`.

## Persistence

Embedded SQLite (WAL, versioned migrations). Each accepted command writes its idempotency
receipt, ordered event, and state projection atomically; snapshots every 50 revisions
bound replay. **GM/player auth lives separately in `data/auth.json`, not the game DB.**

## Two auth axes, two transports

- Sessions (GM/player) vs integration-API credentials are **separate** auth systems.
- Socket.IO (bare domain payloads) vs public HTTP API v1 (versioned envelopes) are
  **different wire formats** over the same command handlers.
- Concretely: the shared handlers live in `apps/server/src/game-operations.ts` (validation
  schemas in `game-commands.ts`). The socket handlers in `server.ts` and the HTTP routes in
  `game-http.ts` are both thin adapters over those functions — add new capabilities to the
  operations layer, never to a single transport. HTTP principals: GM session, player session
  (same player limits as the table), or a scoped integration credential (GM authority —
  credentials are GM-minted).

Governing ADRs: `0001` (authoritative LAN server), `0004` (stack), `0005` (realtime),
`0006` (SQLite), `0011` (identity/claims), `0016` (public API). See `docs/adr/`.
