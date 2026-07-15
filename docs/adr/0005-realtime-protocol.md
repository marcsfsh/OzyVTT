# ADR-005: Realtime protocol

## Status

Accepted — 2026-07-15.

## Context and decision drivers

Combat state (HP, initiative, claims, dice, position) must stay consistent across a GM browser and several player browsers on a trusted LAN, survive brief disconnects, and never let a client apply a privileged mutation locally. ADR-001 and ADR-002 already commit to one authoritative server and a browser client, so the realtime channel must carry authenticated commands in and authorized, recipient-specific state out, with no client-computed authoritative state (see ARCHITECTURE.md's state and security boundary).

## Considered options

- Client-side optimistic authority with periodic reconciliation: lower perceived latency, but risks divergent HP/initiative/claim state between GM and players and reopens the hidden-information leakage the product explicitly rejects.
- Plain REST polling for state: simple, but too slow for turn-by-turn combat feedback (dice, movement, HP) and awkward for server-initiated broadcasts to multiple connected roles at once.
- Server-authoritative WebSocket (Socket.IO) command/event flow with reconnect snapshots: matches the existing HTTP/Socket.IO same-origin transport (ADR-001), supports acknowledged commands, and lets every client resync from one authorized snapshot after a drop.

## Decision

The server is the sole authority for `GameState`. Clients submit named commands over Socket.IO (`session:join`, `character:claim`, `character:release`, `dice:roll`, and later combat commands) carrying a unique command ID and, where conflicts matter, an expected state revision; the server acknowledges each command with an explicit `{ ok, ... }` result or rejection reason. Accepted commands are validated, authorized against the caller's signed session and role, applied transactionally (ADR-006), and broadcast as a recipient-projected `state:updated` event to every connected socket — the GM projection and each player's projection are computed separately (see `apps/server/src/projections.ts`). On connect or reconnect, a client's first `state:updated` payload is a full projected snapshot, so no client needs to replay history to reach a consistent view.

## Consequences and tradeoffs

Every state-changing interaction requires a server round trip; there is no purely client-side authoritative path. This is accepted because trusted-LAN latency is low and because it eliminates an entire class of state-divergence and hidden-information bugs. Retried commands (e.g. after a flaky send) return the already-accepted result rather than re-applying, and a stale expected revision is explicitly rejected rather than silently overwritten (proven in `apps/server/test/game-store.test.ts` and `docs/product/phase-0-command-persistence-spike.md`).

## Mobile, security, and visibility impact

Socket authentication is carried in the handshake token, not inferred from network position; `roleFor`/`auth.verify`/`auth.verifyPlayer` (`apps/server/src/auth.ts`, `apps/server/src/index.ts`) determine GM versus player role per socket on every command, not once at connect. Player payloads never include GM-only fields or other sessions' private identifiers (`apps/server/src/projections.ts`). Phones and laptops that briefly lose and regain LAN/Wi-Fi connectivity reconnect to Socket.IO and receive a fresh authorized snapshot rather than a partial diff, which keeps mobile backgrounding/reconnect behavior correct without special-casing device type.

## Migration / reversibility

Command and event shapes are defined once in `packages/domain` and imported by both `apps/client` and `apps/server`, so the transport (currently Socket.IO 4 over the same origin as HTTP) could be swapped for another WebSocket implementation without changing the command/event contract. The public API (ADR-016) is designed as a second adapter over the same command handlers and projections, not a parallel authority, so adding it does not require renegotiating this protocol.

## Validation evidence

`docs/product/phase-0-command-persistence-spike.md` and `apps/server/test/game-store.test.ts` prove command idempotency (duplicate command ID returns the prior result), stale-revision rejection, and durable receipt/event/projection writes. `apps/server/src/index.ts` implements `session:join`, `character:claim`, `character:release`, and `dice:roll` over Socket.IO today. Presence/reconnect/convergence coverage with multiple simulated clients remains open (BUILD_PLAN.md §1.5 next-actions queue) and is required before the broader realtime contract can be considered fully validated.
