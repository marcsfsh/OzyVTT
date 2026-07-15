# ADR-016: Public integration API

## Status

Proposed — 2026-07-15.

## Context and decision drivers

The VTT is intended to be open-source and self-hostable. Operators should be able to connect bots, campaign tools, stream overlays, hardware, importers, and alternate clients without scraping the UI, importing private packages, editing SQLite, or forking core. The API must preserve the product's server authority, idempotency, revision handling, and strict recipient-specific visibility.

## Considered options

- UI/internal endpoints only: smallest immediate surface, but integrations become brittle and unsafe.
- Direct database/package access: easy locally, but couples consumers to storage and bypasses authorization/domain invariants.
- In-process plugin runtime: powerful, but adds arbitrary-code and lifecycle/supply-chain complexity before the core product is stable.
- GraphQL as the primary API: flexible querying, but authorization/cost/versioning complexity is disproportionate to the current resource/command model.
- Versioned REST plus documented realtime commands/events: aligns with the existing HTTP, Socket.IO, schemas, commands, revisions, and projections.

## Proposed decision

Use `/api/v1` REST resources for durable queries/requests and a versioned Socket.IO/WebSocket protocol for commands/events. Both are adapters over the same application/domain handlers used by the built-in UI. Publish OpenAPI 3.1 plus machine-readable realtime schemas, capability discovery, stable error/command/event envelopes, scoped revocable integration credentials, idempotency/revision semantics, and a compatibility/deprecation policy.

Defer signed webhooks until realtime subscriptions are proven and a concrete server-to-server need remains. Prefer external integrations over an in-process plugin runtime.

## Consequences and tradeoffs

Public DTOs/contracts must be intentionally designed and contract-tested rather than exposing internal state. Feature work carries additional documentation/compatibility/security obligations. In exchange, integrations remain decoupled from storage/UI and core can be refactored behind stable boundaries.

## Mobile, security, and visibility impact

No integration receives authority merely because it can reach the host. Credentials have least-privilege scopes, resource/game bounds, expiry/rotation/revocation/audit metadata, and rate limits. Every response/event is projected for the principal; secret fields must be absent. Internet exposure remains an operator-managed TLS/VPN/reverse-proxy concern.

## Migration / reversibility

Start with a deliberately small experimental Phase 1 surface, then declare the first stable v1 contract only after the external-integration spike and compatibility policy pass. Internal endpoints remain unsupported and clearly separated. A new major version is required for breaking public semantics.

## Validation evidence required for acceptance

An external process using only published docs must create/use a scoped credential, discover capabilities, read a safe snapshot, submit and safely retry an idempotent command, receive the projected event, handle a stale revision, reconnect/resume or snapshot, and lose access immediately after revocation. Negative tests must prove hidden data is absent.
