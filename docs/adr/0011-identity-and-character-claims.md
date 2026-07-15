# ADR-011: Identity and character claims

## Status

Accepted — 2026-07-15.

## Context and decision drivers

The product serves one trusted GM and a small home group joining directly by LAN IP (ADR-001, ADR-002), with no account system, invitations, or cloud service (README.md, "Current foundation"). The GM needs durable, exclusive administrative authority; players need a low-friction way to sit down at a device, pick their character, and be recognized as that character again after a reload or reconnect — without usernames, emails, or passwords for players.

## Considered options

- Full account system (usernames/passwords or OAuth) for every participant: gives durable cross-device identity, but is disproportionate friction for a home group joining a LAN address for a game night and adds an account database/reset flow the product explicitly avoids.
- Unauthenticated, anonymous access for everyone including the GM: simplest, but leaves no way to protect GM-only actions (force-ending turns, revealing hidden information, managing the roster) from any device on the LAN.
- Same direct-IP landing page for everyone, with a password-authenticated GM role and accountless player character claims bound to a signed browser session token: matches the trusted-LAN, no-accounts goal while still giving the GM exclusive authority and giving each player session a durable, recognizable identity without a password.

## Decision

All participants reach the same server at the same LAN address; there is no separate GM URL or player invitation link. A first-run GM password is bootstrapped only from a loopback request (`isLoopback` check in `apps/server/src/index.ts`) with a minimum length requirement, hashed with bcrypt (cost factor 12, `apps/server/src/auth.ts`) — the plaintext password is never stored. Subsequent GM logins receive a signed, time-limited (12-hour) session token (ADR-002). Players receive a signed player session token (30-day expiry) on join, with no password; that session claims ownership of exactly one player-character actor at a time by setting the actor's `ownerSessionId` (`packages/schemas/src/index.ts`). The server enforces, per claim command: the target actor is a player-character, it is not already claimed by a different session, and the claiming session does not already own a different character — a player must release before claiming another (`apps/server/src/index.ts`, `character:claim`/`character:release`). Both GM and player session tokens are self-contained, HMAC-SHA256-signed, and verified with a timing-safe comparison (`apps/server/src/auth.ts`).

## Consequences and tradeoffs

Identity is per-browser-session, not per-person: a player who joins from a second device gets a second, independent session and must claim separately, and clearing browser storage loses the claim binding (recoverable by claiming again, since characters are not deleted). There is no password reset flow for players because there is no player password; losing a GM password requires host-machine access to reset. This trade is accepted because it matches the product's explicit no-accounts, trusted-LAN, small-home-group scope (README.md, "Scope boundaries").

## Mobile, security, and visibility impact

Bootstrap's loopback restriction prevents any other device on the LAN from racing the host to set the GM password (ADR-002). GM and player projections diverge at the server boundary, not in the UI: player projections omit `ownerSessionId` and GM-only notes for other sessions' characters (`docs/product/phase-1-character-roster.md`), so a claim's session identity is never leaked to other players regardless of device. Session tokens work identically on phone and desktop browsers since they are ordinary signed strings carried in the Socket.IO handshake, not a platform-specific credential.

## Migration / reversibility

The one-character-per-session MVP policy is deliberately narrow; a documented later extension is GM force-release and explicit session invalidation (`docs/product/phase-1-character-roster.md`, "Remaining acceptance work"), which does not require changing the claim/release command shapes. Moving to a real account system later would be a larger migration — it would need to introduce durable cross-device identity distinct from the current per-session token — and is out of scope for the current product boundary.

## Validation evidence

`docs/product/phase-1-character-roster.md` documents the seeded roster, one-claim-per-session enforcement, and player-projection tests that confirm available/current-session/other-session claim states without leaking owner IDs or notes. Automated coverage includes seed idempotency, migration/seed markers, and claim-visibility projection tests (18 passing tests at time of writing). Remaining acceptance work — two simultaneous clients racing the same claim, browser token recovery after a real server restart, and GM force-release/session invalidation — is tracked as open in that document and in BUILD_PLAN.md's near-term queue, and is not yet closed by this ADR.
