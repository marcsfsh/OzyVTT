# ADR-016: Public integration API

## Status

Accepted — 2026-07-31 (proposed 2026-07-15).

The v1 surface shipped, its conventions are enforced by contract tests, and the compatibility clause this
ADR always promised is written down below. What remained "proposed" was never the architecture — it was
the missing normative statement.

## Context and decision drivers

The VTT is intended to be open-source and self-hostable. Operators should be able to connect bots, campaign tools, stream overlays, hardware, importers, and alternate clients without scraping the UI, importing private packages, editing SQLite, or forking core. The API must preserve the product's server authority, idempotency, revision handling, and strict recipient-specific visibility.

## Considered options

- UI/internal endpoints only: smallest immediate surface, but integrations become brittle and unsafe.
- Direct database/package access: easy locally, but couples consumers to storage and bypasses authorization/domain invariants.
- In-process plugin runtime: powerful, but adds arbitrary-code and lifecycle/supply-chain complexity before the core product is stable.
- GraphQL as the primary API: flexible querying, but authorization/cost/versioning complexity is disproportionate to the current resource/command model.
- Versioned REST plus documented realtime commands/events: aligns with the existing HTTP, Socket.IO, schemas, commands, revisions, and projections.

## Decision

Use `/api/v1` REST resources for durable queries/requests and a versioned Socket.IO/WebSocket protocol for commands/events. Both are adapters over the same application/domain handlers used by the built-in UI. Publish OpenAPI 3.1 plus machine-readable realtime schemas, capability discovery, stable error/command/event envelopes, scoped revocable integration credentials, idempotency/revision semantics, and a compatibility/deprecation policy.

Defer signed webhooks until realtime subscriptions are proven and a concrete server-to-server need remains. Prefer external integrations over an in-process plugin runtime.

## v1 conventions (normative)

This is the statement the ADR promised. It binds every `/api/v1` surface; `docs/api-reference.md` restates
it for readers and `packages/api-contract/test/reference.test.ts` pins the load-bearing phrases in both, so
the two cannot drift.

1. **Envelopes.** Success is `{ ok: true, apiVersion: "1", data }`. Failure is
   `{ ok: false, apiVersion, error: { code, message, requestId, details?, currentRevision?, retryAfterSeconds? } }`.
   There is no third shape.
2. **Request correlation.** Every `/api/v1` router echoes a caller-supplied UUID-v4 `X-Request-Id` on the
   response header and in the error body, minting one when the caller sends none. A value that is not a
   UUID v4 is replaced rather than echoed.
3. **Idempotency is per surface, and the API does not pretend otherwise.** *Game* writes accept a
   `commandId` (UUID) and execute it exactly once; a retry replays the stored outcome with
   `duplicate: true`. D19: codex JSON-body writes accept an optional `commandId` (UUID); resend the same id to retry safely and the stored outcome is replayed verbatim — same status, same bytes — with an `x-idempotent-replay` header so a caller can tell a replay from a fresh execution. The receipt is written after the write commits, so a crash between the two re-executes ONE identical retry rather than reporting success for a write that never landed; only a 2xx is recorded, so a retry after an error re-executes. Body-less codex POSTs and every codex DELETE carry none — they are naturally idempotent already. *Homebrew* writes still carry none and rely on `expectedRev`.
   The API-wide "every write accepts `commandId`" claim that shipped in `info.description` was false for
   two of the three surfaces when it was written; it is now true of two of them and says so.
4. **Concurrency, two vocabularies.** `expectedRevision` (game) targets the global GameState revision.
   `expectedRev` (codex pages/sessions/quests, homebrew rows) targets one record's revision. Both reject a
   stale write with 409 and `error.currentRevision`. Codex maps, pins, journal entries, calendar, settings
   and standing are last-write-wins by owner decision; do not spread `expectedRev` without cause.
5. **Status codes.** 400 malformed — a schema failure carries every problem in `details.issues` as
   `{ path, message }`, never only the first. 401 — no credential, or an `Authorization` header that is not
   parseable, and nothing else. 403 — the caller presented something and was refused: a role denial, or a
   token that is **invalid, revoked, or missing the required scope**. 404 — absent *or secret*: the
   existence of a record the caller may not see is **never distinguishable** from its absence. 409 — a
   domain refusal or a stale revision. 413 — oversized body. One stated exception: binary asset-content
   routes answer 403 before any existence check, because a media URL must not become an existence oracle.
6. **Change observation.** Socket.IO emits a content-light `codex:changed` / `homebrew:changed` ping when
   that surface moves; integrations may listen instead of polling, and must treat a ping as "re-read"
   rather than as data. Polling uses weak ETags: `GET /game` and **every codex `GET`** send one, and the
   conditional check runs after authorization and existence so a 304 can never confirm a hidden record.
7. **Bounds are a design decision.** This is a single-group LAN product. Codex list reads are
   **unpaginated** and stay that way inside v1; suite search returns at most 50 hits; homebrew lists use
   opaque keyset cursors. A consumer must not assume codex pagination will appear in v1.
8. **Compatibility.** v1 is stable by intent for external consumers, but this instance ships client and
   server from one repo in lockstep and there are no known external consumers. Breaking changes that buy
   coherence are therefore permitted inside v1 while the product is pre-1.0, each recorded in
   `docs/ai-ledger/decision-log.md`. A public or multi-tenant posture would require a major version. This
   supersedes the ADR's earlier silence on what "compatibility/deprecation policy" meant.

## Consequences and tradeoffs

Public DTOs/contracts must be intentionally designed and contract-tested rather than exposing internal state. Feature work carries additional documentation/compatibility/security obligations. In exchange, integrations remain decoupled from storage/UI and core can be refactored behind stable boundaries.

## Mobile, security, and visibility impact

No integration receives authority merely because it can reach the host. Credentials have least-privilege scopes, resource/game bounds, expiry/rotation/revocation/audit metadata, and rate limits. Every response/event is projected for the principal; secret fields must be absent. Internet exposure remains an operator-managed TLS/VPN/reverse-proxy concern.

## Migration / reversibility

Start with a deliberately small experimental Phase 1 surface, then declare the first stable v1 contract only after the external-integration spike and compatibility policy pass. Internal endpoints remain unsupported and clearly separated. A new major version is required for breaking public semantics.

## Validation evidence required for acceptance

An external process using only published docs must create/use a scoped credential, discover capabilities, read a safe snapshot, submit and safely retry an idempotent command, receive the projected event, handle a stale revision, reconnect/resume or snapshot, and lose access immediately after revocation. Negative tests must prove hidden data is absent.
