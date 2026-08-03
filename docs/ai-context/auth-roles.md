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
player-character's `ownerSessionId`, enforcing: target is a `player-character`, not archived,
not owned by another session, and the claimant owns no other character (must release first).
The archived check is a **server** check, not the projection's: archived characters are hidden
from the player view, and hiding was the only thing that used to stop a client replaying a known
`actorId`. It refuses with the same message a missing character gets — no existence oracle.
Archiving a claimed character releases the claim in the same mutation (`actor.set-archived`), so
nobody is left holding an invisible claim the one-claim rule then counts against them.

**Projection is the boundary.** `projectPlayerView` (`apps/server/src/projections.ts`) does
not filter state — it destructures the sensitive fields away in one place and then re-adds a
narrow set, and the shape of that code is the rule:

- **Stripped and never returned:** GM knowledge about an actor — notes, owner identity,
  monster defences, and GM-only management flags.
- **Re-added only for the owner** (`...(mine ? {…} : {})`): sheet resources — action uses,
  hit dice, spell and pact slots, prepared spells, inventory, currency, and the actor's own
  imported `ActorDefinition`. Another player never sees them; the viewer projects separately.
- **Re-added coarsened for everyone:** exact HP becomes a health band; a hidden effect's
  source becomes "A hidden threat"; a token display style ships only when the GM aimed it at
  the whole table.
- **Filtered out entirely:** actors that are not `visibility === "public"`, and actors that
  are archived. Rolls are filtered by visibility (public/self-only) with
  `initiatorSessionId` stripped, and a hidden turn is masked (`hiddenTurn`).
- **Re-added as a deliberately tiny list:** `archivedCharacters` — id and name only, and only
  for archived characters the GM explicitly shared (`Actor.sheetPreview`) that are also public.
  It is a door, not a second actor projection; everything else about them stays omitted.
- **Table policy the player must see to obey it** is copied FIELD BY FIELD, never spread:
  `builderPolicy` (which ability methods, the custom formula, the level cap, whether the
  builder is open to players) and the combat's `rulesMode` + `ruleExceptions`. The field-by-field
  copy is the review point — a field added to `BuilderPolicySchema` reaches players only when
  someone writes it into that copy on purpose.

**Do not maintain a field list here.** Read the destructure — it is one line and it is the
enumeration. Any new owner-only field on `Actor` must be stripped-then-re-added-when-`mine`;
copy how `actionUses` and `hitDice` are handled.

`projectGmView` is **not** "full state": it filters expired annotations and attaches per-actor
presence, and the socket-facing GM view wraps it again to add turn-history metadata
(`apps/server/src/server.ts`).

**There are two projection boundaries, not one.** `projections.ts` is the game's.
`apps/server/src/codex-projections.ts` is the Codex's, and it is the bigger of the two: every
player-facing Codex read routes through it, and its rules are a *reveal graph* rather than a
flat visibility flag — a map is player-visible only when its parent is, a marker's page links
are filtered to the revealed subset, a quest's entity ids likewise. The module's own header
calls itself "the single audited choke point"; do the stripping there, never in the store or
the router. Full rules in `codex.md`.

## Invariants

- Only **loopback** sets the first GM password.
- **GM-only commands** are gated by `auth.verify` per command. Do not keep a list here: the
  authoritative one is `GAME_COMMAND_SCOPES` in `packages/api-contract`, rendered into the
  generated `docs/app-map.md`.
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
- **Four principal kinds exist**, not two: GM session, player session, integration credential,
  and paired viewer (a cookie, not a bearer token). Which surfaces each one reaches is the
  part worth reading twice, and it is tabled in the generated, freshness-tested
  `docs/api-reference.md` under "Authentication". Read it there; a copy here would rot.
  There are also two *preview* minting paths — the viewer preview and the GM's player-preview
  session for the Codex — both of which mint a genuinely lower-privileged principal on purpose.

## Relevant ADRs

`0002` (loopback GM bootstrap), `0011` (identity & character claims — primary), `0001`
(authoritative LAN, GM authority), `0005` (auth in handshake, GM vs player projections).
