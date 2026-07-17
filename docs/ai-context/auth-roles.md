# Auth / roles / projections

**Read this when:** touching GM authentication, the character-claim model, role gating on a
command, or what a player is allowed to see/do. Projection is the security boundary.

## Key files

- `apps/server/src/auth.ts` — `AuthService`: bcrypt hashing, HMAC-signed sessions,
  `verify`/`verifyPlayer`, revocation.
- `apps/server/src/server.ts` — bootstrap/login/logout routes, `isLoopback`, `session:join`,
  per-command role gating.
- `apps/server/src/character-claims.ts` — claim/release/force-release rules.
- `apps/server/src/projections.ts` — `projectPlayerView` / `projectGmView` field-stripping.
- `apps/server/src/login-rate-limit.ts` — per-IP GM login throttling.
- `packages/domain/src/index.ts` — `PlayerView`/`GmView`, `claimStatus`, `PresenceStatus`.
- `packages/schemas` — `Actor` with `ownerSessionId`, `notes`, `visibility`.

## Core model

**GM bootstrap** (`POST /api/bootstrap`) is accepted **only from loopback**, requires a
≥12-char password, and stores a bcrypt hash (cost 12) plus a random `tokenSecret` in
`data/auth.json` (mode `0600`); the plaintext is never stored and re-bootstrap throws.
Sessions are self-contained: `base64url(JSON).HMAC-SHA256(tokenSecret)`, verified with
`timingSafeEqual`. GM tokens expire in 12h; **player tokens expire in 30d and are issued on
join with no password.** GM login uses `bcrypt.compare`, rate-limited per IP (429 +
`Retry-After`); revocation supports single-session logout and a `gmSessionsRevokedBefore`
cutoff for revoke-all.

**Player identity** is accountless and per-browser-session. A claim sets exactly one
player-character's `ownerSessionId`, enforcing: target is a `player-character`, not owned by
another session, and the claimant owns no other character (must release first).

**Projection is the boundary.** `projectPlayerView` drops `notes` and `ownerSessionId`,
exposes derived `claimStatus` (available/mine/claimed) + presence, filters actors to
`visibility==="public"`, filters rolls by visibility (public/self-only) while stripping
`initiatorSessionId`, applies annotation visibility, and masks hidden turns (`hiddenTurn`).
`projectGmView` returns full state.

## Invariants

- Only **loopback** sets the first GM password.
- **GM-only commands** (`encounter:*`, `initiative:*`, `character:force-release`, gm-only
  rolls, viewer/map/integration admin) are gated by `auth.verify` per command.
- A player may only roll/move for an actor whose `ownerSessionId` matches theirs.
- Players **cannot**: claim a non-PC or already-claimed actor, own two characters, make
  gm-only rolls, or see other sessions' `ownerSessionId` / `notes` / private rolls / hidden
  actors / hidden turns.
- Role derives from the **signed token, not network position**.

## Gotchas

- Auth lives in a standalone `data/auth.json`, **not** the SQLite game DB. Deleting it or
  clearing browser storage loses GM access/claims with no reset — needs host access.
- **Player tokens are not revocable** — only GM sessions have logout/revoke-all; a 30-day
  player token stays valid.
- `claimStatus:"claimed"` hides owner identity, but `presence` still reveals the owner's
  online/offline state.
- Tokens are **signed, not encrypted** — payload is only `{role, sessionId, issuedAt,
  expiresAt}`; no secrets belong there.
- Integration-API credentials are a **separate auth axis** from GM/player sessions.

## Relevant ADRs

`0002` (loopback GM bootstrap), `0011` (identity & character claims — primary), `0001`
(authoritative LAN, GM authority), `0005` (auth in handshake, GM vs player projections).
