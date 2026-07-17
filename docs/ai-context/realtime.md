# Realtime / socket protocol

**Read this when:** adding or changing a socket command/event, touching state broadcast,
reconnection, or idempotency/revision handling.

## Key files

- `packages/domain/src/index.ts` — **single source of truth for the wire contract:**
  `ClientToServerEvents`, `ServerToClientEvents`, `GameState`, projection view types.
  Imported by both client and server, so the transport is swappable.
- `apps/server/src/server.ts` — Socket.IO server, `io.on("connection")`, and every command
  handler (older ADRs cite `index.ts`; that's now only the listen bootstrap).
- `apps/server/src/game-store.ts` — transactional command execution, idempotency, revision
  conflict.
- `apps/server/src/projections.ts` — recipient-specific projections.
- `apps/server/src/presence.ts` — connection presence + reconnect grace.
- `apps/client/src/socket.ts` — typed `io({ autoConnect: false })` singleton (the whole
  client transport). `apps/client/src/main.tsx` — connect/join/reconnect wiring.
- `packages/api-contract/src/index.ts` — `REALTIME_PROTOCOL_VERSION="1"`,
  `CommandEnvelope`/`EventEnvelope` — the **public HTTP API** adapter, a *different* wire
  shape from the Socket.IO events.

## Core model

Socket.IO 4 over the same origin as HTTP. A command is a named event carrying a UUID
`commandId` and optional `expectedRevision`, with an ack callback returning
`{ ok, revision, duplicate, ... }` or `{ ok:false, message }`. Flow: client emits →
server **zod-validates → authorizes by role → `store.execute`** commits receipt + domain
event + new projection in one SQLite transaction and bumps `revision` → broadcast
`state:updated` to every socket with a **separately computed** GM vs player projection.

Reconnection: the connection handler immediately emits a full projected **snapshot**;
Socket.IO's built-in reconnect plus a token persisted in `localStorage` (carried in
`socket.auth`) means the first post-reconnect `state:updated` is always a full authorized
snapshot, never a diff. `PresenceRegistry` holds a dropped session "reconnecting" for ~8s
before "offline".

## Invariants

- **Server is the sole authority** for `GameState`; there is no client-computed
  authoritative path.
- **Role is re-verified per command** from the handshake token (`roleFor`,
  `auth.verify`/`verifyPlayer`), never cached at connect — a revoked GM is downgraded or
  disconnected on the next broadcast.
- **All payloads pass strict zod schemas**; no client trust.
- **The contract lives once in `packages/domain`** — change it there, and keep client and
  server in lockstep.
- **Idempotency:** `commandId` is a primary key in `command_receipts`; a duplicate returns
  the prior result with `duplicate:true` and does **not** re-apply or re-broadcast. Stale
  `expectedRevision` → `RevisionConflictError`, rejected not overwritten.

## Gotchas

- Two envelope styles coexist: Socket.IO uses bare domain payloads; the public HTTP API v1
  uses versioned envelopes.
- `commandId` doubles as the annotation `id` in `annotation:add`.
- The client does **not** re-emit `session:join` on reconnect — it relies on `socket.auth`
  persisting the token; `presence.connect` only runs on the explicit initial join.
- `state:updated` is a `PlayerView | GmView` union — clients must handle both.
- Snapshots every 50 revisions; `rolls` capped at 200. Ephemeral annotations need
  `scheduleAnnotationExpiry` to re-broadcast on expiry.
- Commands serialize through a `commandQueue` promise chain.

## Relevant ADRs

`0005` (realtime protocol — primary), `0001` (authoritative LAN server), `0006` (SQLite
transactional receipts/idempotency), `0016` (public API as a second adapter over the same
handlers).
