# Combat-First VTT Integration API - API reference (v1)

<!-- GENERATED FILE - do not edit by hand. -->
<!-- Rendered from packages/api-contract (the same document served at /api/v1/openapi.json). -->
<!-- Regenerate: npm run docs:generate -w @vtt/api-contract -->

Versioned, recipient-safe integration contract for a self-hosted VTT. Game writes accept an optional `commandId` (UUID) executed exactly once - supply your own and resend it to retry safely, and the server replays the stored outcome with `duplicate: true`; codex and homebrew writes carry no `commandId` and rely on `expectedRev` plus their own conflict rules instead. Stale-revision writes are rejected with 409 + `error.currentRevision` (`expectedRevision` targets the global game revision; `expectedRev` targets one record's revision). Role denials are 403, a missing credential is 401, and the existence of a secret record always reads as 404.

- **Base path:** `/api/v1` on the LAN host (default port 3001).
- **Machine-readable contract:** `GET /api/v1/openapi.json` serves the OpenAPI 3.1 document this reference is generated from, byte-identical to `@vtt/api-contract`.
- **Realtime sibling:** the built-in clients drive the same commands over Socket.IO (protocol version 1); command `type` strings below are shared between both transports.
- **Webhooks / server push:** not part of v1 core yet - poll with ETags (below).

## Authentication

Every request authenticates with `Authorization: Bearer <token>` (the viewer's cookie is the one exception). Four principal kinds exist, and **which surfaces each one reaches** is the part worth reading twice:

| Principal | Token | Reaches | Authority |
| --- | --- | --- | --- |
| **GM session** | `POST /api/gm/login` (GM password; same-origin only) | Everything. | Full, including credential management. |
| **Player session** | issued when a player joins the table, or `POST /api/v1/sessions/player` | Live game, the public reference catalogs, codex **reads**. Never homebrew, never credential management, never a codex write. | The table's player limits: player-safe projections, own claimed character only. |
| **Integration credential** | `vtt_int_…`, minted by the GM (below) | Live game, encounter archives, and the codex - scope by scope. Never credential management, never homebrew, never `POST /codex/preview-session`. | GM authority, filtered by the credential's scopes. Rotatable, revocable, audited. |
| **Paired viewer** | HttpOnly cookie exchanged from a pairing code | The second-screen viewer surface and the map-asset bytes it needs. | Read-only, player-safe presentation. It is not a game credential and never becomes one. |

### Scopes

| Scope | Grants |
| --- | --- |
| `system:read` | Capability discovery and the command catalog. |
| `game:read` | Game-state snapshots (GM-full or player-safe) and reference content. |
| `actor:read` | Reserved - no endpoint requires it yet. |
| `actor:write` | Roster changes, hit points, conditions, sheet imports, claims management, and token cosmetics. |
| `scene:read` | Reserved - no endpoint requires it yet. |
| `scene:write` | Preparing, editing, activating, and removing staged scenes. |
| `combat:read` | The combat log and encounter archives. |
| `combat:write` | Encounter lifecycle, initiative/timeline, turns, tokens, actions, saves, annotations. |
| `roll:create` | Dice rolls into the shared history. |
| `codex:read` | Every codex read at GM grade: pages (both layers), the atlas, the journal and chronicle, sessions, quests, standing, the calendar (both clocks), folders, revision history, settings, the reveal audit, export, and page images. |
| `codex:write` | Every codex write: pages, atlas, pins, journal, sessions, quests, standing, calendar and publish, settings, revision trim, and page-image upload. Does NOT imply `codex:read` - mint both for a read-write tool. |
| `events:read` | Reserved for the future event stream. |
| `webhooks:manage` | Reserved for future webhooks. |
| `admin` | Every scope, including destructive operations (archive deletion). Grant sparingly. |

## Conventions

- **Envelopes.** Success: `{ "ok": true, "apiVersion": "1", "data": … }`. Failure: `{ "ok": false, "apiVersion": "1", "error": { "code", "message", "requestId", "details"?, "currentRevision"?, "retryAfterSeconds"? } }`.
- **Request IDs.** Send `X-Request-Id` (UUID v4) to correlate; every `/api/v1` router echoes it on the response header and in error bodies, minting one when you don't. A value that isn't a UUID v4 is replaced rather than echoed.
- **Idempotency, per surface.** *Game* writes accept `commandId` (UUID), executed exactly once; a retry replays the stored outcome with `duplicate: true`, and an omitted id is minted server-side and echoed. *Codex* and *homebrew* writes carry no `commandId`: their bodies are `additionalProperties: false`, so sending one is a `400`. Retry those with `expectedRev` instead - it is what makes a repeat safe by refusing the second write rather than replaying the first.
- **Optimistic concurrency, two vocabularies.** `expectedRevision` (game) targets the **global** GameState revision. `expectedRev` (codex pages/sessions/quests, homebrew rows) targets **one record's** revision. Both reject a stale write with `409` and `error.currentRevision`. Codex maps, pins, journal entries, calendar, settings and standing are deliberately last-write-wins - a single-GM surface does not need a conflict token on every row, and spreading one costs more than it prevents.
- **Error statuses.** `400 validation_failed` - malformed request; a schema failure carries every problem in `details.issues` as `{ path, message }`, not just the first. `401 unauthenticated` - **no credential, or an `Authorization` header that isn't parseable**, and nothing else. `403 forbidden` - you presented something and were refused: a role denial, or a token that is invalid, revoked, or missing the required scope. `404 not_found` - absent **or secret**: the existence of a record you may not see is never distinguishable from its absence. `409 conflict` - a domain refusal or a stale revision (`details.needsConfirm` on a timeline navigation: resend with `confirmRewrite`/`confirmDiscard`). `413` - oversized body (global limit 512kb; the homebrew pack import raises its own).
- **One stated exception to the 404 rule.** Binary asset-content routes (`/map-assets/{id}/content`, `/codex-assets/{id}/content`) answer `403` **before** any existence check. Media URLs are guessable and get embedded in pages, so answering 404-vs-403 there would turn the route into an existence oracle for ids you were never given.
- **Polling.** `GET /game` and **every codex `GET`** send a weak ETag derived from the relevant revision; send `If-None-Match` for a free `304`. Presence and timed-annotation expiry don't bump the game revision - re-fetch when you need those fresh. A conditional request is checked *after* authorization and existence, so a `304` never leaks that a record you can't see is unchanged.
- **Change observation.** Socket.IO emits a `codex:changed` / `homebrew:changed` ping whenever that surface moves. Treat a ping as "re-read", not as data - it exists so integrations don't have to poll tightly, and the payload is not part of this contract.
- **Bounds are a design decision, not an omission.** This is a single-group LAN product. Codex list reads are **unpaginated** and will stay that way inside v1; suite search returns at most 50 hits; homebrew lists use keyset cursors (`cursor` is opaque). Do not build a consumer that waits for codex pagination to appear.
- **CORS.** Wide open on `/api/v1` (bearer-only surface), so browser-based overlays can call it directly. The legacy same-origin endpoints (`/api/gm/login` etc.) deliberately have no CORS.

## Command catalog

Every command is reachable two ways with identical semantics: its **typed route** (below) or the **generic tunnel** `POST /game/commands` with `{ "type", "payload", "commandId"?, "expectedRevision"? }`. `GET /game/commands` serves this catalog with live summaries. Scopes bind to the command, not the transport:

| Command type | Required scope |
| --- | --- |
| `encounter.start` | `combat:write` |
| `encounter.end` | `combat:write` |
| `encounter.add-combatant` | `combat:write` |
| `initiative.set` | `combat:write` |
| `initiative.next` | `combat:write` |
| `initiative.previous` | `combat:write` |
| `initiative.roll-self` | `combat:write` |
| `initiative.roll-remaining` | `combat:write` |
| `turn.end` | `combat:write` |
| `turn.use` | `combat:write` |
| `turn.use-reaction` | `combat:write` |
| `turn.use-legendary` | `combat:write` |
| `token.move` | `combat:write` |
| `actor.add-from-definition` | `actor:write` |
| `actor.import-definition` | `actor:write` |
| `character.submit-import` | `actor:write` |
| `character.resolve-import` | `actor:write` |
| `actor.remove` | `actor:write` |
| `actor.apply-damage` | `actor:write` |
| `actor.heal` | `actor:write` |
| `actor.set-temp-hp` | `actor:write` |
| `actor.set-hp` | `actor:write` |
| `actor.set-condition` | `actor:write` |
| `dice.roll` | `roll:create` |
| `action.resolve` | `combat:write` |
| `save.answer` | `combat:write` |
| `save.dismiss` | `combat:write` |
| `reaction.answer` | `combat:write` |
| `reaction.dismiss` | `combat:write` |
| `damage.resolve` | `combat:write` |
| `effect.add` | `combat:write` |
| `effect.end` | `combat:write` |
| `death-save.roll` | `combat:write` |
| `encounter.set-rules-mode` | `combat:write` |
| `encounter.set-roll-mode` | `combat:write` |
| `encounter.set-player-damage-mode` | `combat:write` |
| `encounter.set-player-initiative-mode` | `combat:write` |
| `encounter.set-health-display` | `combat:write` |
| `encounter.set-environment` | `combat:write` |
| `actor.rest` | `actor:write` |
| `actor.spend-hit-dice` | `actor:write` |
| `character.set-slot` | `actor:write` |
| `character.set-prepared` | `actor:write` |
| `character.set-inventory` | `actor:write` |
| `character.set-currency` | `actor:write` |
| `character.set-identity` | `actor:write` |
| `character.set-proficiencies` | `actor:write` |
| `character.create` | `actor:write` |
| `builder.set-policy` | `actor:write` |
| `annotation.add` | `combat:write` |
| `annotation.ping` | `combat:write` |
| `annotation.move` | `combat:write` |
| `annotation.remove` | `combat:write` |
| `annotation.set-color` | `combat:write` |
| `annotation.set-visibility` | `combat:write` |
| `annotation.set-movable` | `combat:write` |
| `annotation.clear` | `combat:write` |
| `character.claim` | `actor:write` |
| `character.release` | `actor:write` |
| `character.force-release` | `actor:write` |
| `actor.set-token-image` | `actor:write` |
| `actor.set-size` | `actor:write` |
| `actor.set-health-display` | `actor:write` |
| `actor.set-visibility` | `actor:write` |
| `actor.set-archived` | `actor:write` |
| `actor.set-speed` | `actor:write` |
| `scene.create` | `scene:write` |
| `scene.rename` | `scene:write` |
| `scene.remove` | `scene:write` |
| `scene.activate` | `scene:write` |
| `scene.set-combatants` | `scene:write` |
| `scene.duplicate` | `scene:write` |
| `scene.reorder` | `scene:write` |
| `fog.set-enabled` | `scene:write` |
| `fog.paint` | `scene:write` |
| `fog.reset` | `scene:write` |

## Encounter archive document (`archiveSchemaVersion` 3)

`GET /encounters/{id}` returns `data.document`, the permanent Time Machine record of one ended fight, stored verbatim at `encounter.end` in the same transaction that closes the encounter:

- `startedAt` / `endedAt` (ISO 8601) and `turnCount`.
- `turns[]` - `{ index, kind: "turn"|"return", label, revision, at, state }`: one **full GameState** per turn boundary.
- `log[]` - the fight's timestamped combat-log slice (`{ id, at, kind, text, gmOnly, revision }`), GM-only lines included.
- `journal[]` - **every accepted command while the fight was live**, `encounter.start` through `encounter.end` inclusive: `{ seq, commandId, type, actorId, principal, payload, revision, at }`. `principal` is `gm:<sessionId>`, `player:<sessionId>`, or `integration:<credentialId>`.
- `finalState` - the last live GameState, captured just before ending cleared the fight.
- `rolls[]` - every dice roll seen across the fight (survives the live state's rolling 200-roll cap).
- `definitions[]` - `{ id, source: "imported"|"bundled", definition }`: the full stat blocks the fight used, making the document self-contained.
- `attribution` - the CC BY 4.0 line when bundled SRD content is included, else `null`.

`turns`, `log`, and `journal` join on `revision` - align "what the state was" with "what was commanded" and "what was narrated". Archives are GM-grade only (full state, hidden combatants included) and never reach player sessions.

## Quick start

```bash
# 1. GM signs in (same-origin) and mints a scoped credential - the token is shown exactly once.
GM=$(curl -s -X POST http://host:3001/api/gm/login -H 'content-type: application/json' \
  -d '{"password":"…"}' | jq -r .token)
TOKEN=$(curl -s -X POST http://host:3001/api/v1/gm/integration-credentials \
  -H "Authorization: Bearer $GM" -H 'content-type: application/json' \
  -d '{"name":"my bot","scopes":["system:read","game:read","combat:read","combat:write","actor:write","roll:create"]}' | jq -r .data.token)

# 2. Discover, read, act.
curl -s http://host:3001/api/v1/system/capabilities -H "Authorization: Bearer $TOKEN"
curl -s http://host:3001/api/v1/game -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://host:3001/api/v1/game/rolls -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"formula":"2d20kh1+7","purpose":"attack","visibility":"public"}'

# 3. Same command via the generic tunnel.
curl -s -X POST http://host:3001/api/v1/game/commands -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"actor.apply-damage","payload":{"actorId":"<uuid>","amount":5}}'
```

## System & discovery

Liveness, version negotiation, capability discovery, and the machine-readable contract itself.

### `GET /api/v1/system/health`

**Auth:** Public - no credentials required.

**Responses:** `200` Server is live - envelope of `SystemHealth`

### `GET /api/v1/system/version`

**Auth:** Public - no credentials required.

**Responses:** `200` Public protocol versions - envelope of `SystemVersion`

### `GET /api/v1/system/capabilities`

**Auth:** Integration credential with `system:read`

**Responses:** `200` Authorized server capabilities - envelope of `SystemCapabilities` · errors `401` `403`

### `GET /api/v1/openapi.json`

**Auth:** Public - no credentials required.

**Responses:** `200` This exact OpenAPI 3.1 document, served from the running instance - object (free-form)

## Integration credentials (GM-managed)

Minting, rotating, revoking, and auditing the scoped bearer tokens integrations authenticate with. GM sessions only - an integration token can never manage credentials.

### `GET /api/v1/gm/integration-credentials`

**Auth:** GM session

**Responses:** `200` Safe metadata for every credential; never includes a secret - envelope of `IntegrationCredentialList` · errors `401`

### `POST /api/v1/gm/integration-credentials`

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `scopes` | `system:read` \| `game:read` \| `actor:read` \| `actor:write` \| `scene:read` \| `scene:write` \| `combat:read` \| `combat:write` \| `roll:create` \| `codex:read` \| `codex:write` \| `events:read` \| `webhooks:manage` \| `admin`[] | yes |  |
| `gameId` | string \| null | no |  |
| `expiresAt` | string \| null | no |  |

**Responses:** `201` Credential created; the token is shown exactly once - envelope of `IntegrationCredentialIssued` · errors `400` `401`

### `POST /api/v1/gm/integration-credentials/{id}/rotate`

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `expiresAt` | string \| null | no | Omit to keep the current expiration; null clears it. |

**Responses:** `200` Credential rotated; the new token is shown exactly once - envelope of `IntegrationCredentialIssued` · errors `401` `404` `409`

### `POST /api/v1/gm/integration-credentials/{id}/revoke`

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Credential revoked; access denied immediately - envelope of `IntegrationCredentialMetadata` · errors `401` `404`

### `GET /api/v1/gm/integration-credentials/{id}/audit`

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Safe audit history: no secrets, only usage/lifecycle metadata - envelope of `IntegrationCredentialAudit` · errors `401` `404`

## Player sessions

Session issuance for headless or custom player clients - the HTTP mirror of the socket's open, LAN-trust join.

### `POST /api/v1/sessions/player`

Issues a player session token - the HTTP mirror of the socket's open join, for headless or custom player clients. LAN-trust by design: no credentials required, but the host must have completed GM setup. The token then authenticates player-limited calls across this API.

**Auth:** Public - no credentials required.

**Responses:** `201` Player session issued - envelope of `PlayerSessionIssuedData` · errors `409`

## Live game

The authoritative game state and every game command - combat, initiative and time-travel, turns, tokens, hit points, conditions, roster, dice, actions, saves, annotations, character claims, and staged scenes. Reads are projected per principal; writes dispatch through the exact same validation/authorization/execution path as the built-in table UI.

### `GET /api/v1/game`

The authoritative game state, projected for the caller: GM sessions and integration credentials get the full GM view (hidden combatants, notes, turn-history metadata) unless `view=player` asks for the player-safe projection; player session tokens always get the player-safe view. Sends a weak ETag derived from the revision - poll with If-None-Match for cheap 304s (presence and timed-annotation expiry do not bump the revision, so re-fetch when you need those fresh).

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Parameters:** `view` (query, optional) - `gm` \| `player`

**Responses:** `200` The projected game state, with `revision` for optimistic concurrency and polling - envelope of `GameSnapshotData` · `304` Unchanged since the revision in If-None-Match · errors `401` `403`

### `GET /api/v1/game/log`

The persistent combat log, oldest first. GM sessions and integration credentials receive GM-only lines; player sessions only public ones.

**Auth:** Integration credential with `combat:read` · GM session · Player session (own-character limits apply)

**Parameters:** `limit` (query, optional) - integer (1–1000)

**Responses:** `200` Chronological log entries - envelope of `GameLogData` · errors `400` `401` `403`

### `GET /api/v1/game/commands`

The full catalog of command types accepted by the tunnel, each with the credential scope it requires.

**Auth:** Integration credential with `system:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Supported command types - envelope of `GameCommandCatalogData` · errors `401` `403`

### `POST /api/v1/game/commands`

Generic command tunnel: submits any cataloged command type with its Socket.IO payload shape, dispatched through the exact same validation/authorization/execution path as the built-in UI. The required credential scope depends on the type (see the GET catalog). Omit `commandId` to have one minted; resend the same `commandId` to retry idempotently.

**Auth:** Integration credential (required scope depends on the command type - see the catalog) · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | A cataloged command type, e.g. encounter.start or actor.apply-damage |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `payload` | object (free-form) | no | The command's Socket.IO payload shape, minus commandId/expectedRevision (carried at the envelope level) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `404` `409`

### `POST /api/v1/game/encounter/start`

Starts an encounter on a calibrated battlemap with initial combatants (GM-grade only). Missing initiative scores are rolled server-side.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `mapAssetId` | string (uuid) | yes |  |
| `rulesMode` | `strict` \| `assisted` \| `freeform` | no | Rules-engine enforcement for this fight; omitted keeps the table's current mode |
| `playersRollInitiative` | boolean | no | When true, claimed player-characters (without an explicit score) roll their own initiative; a provisional auto-roll parks them until they do |
| `entries` | object[] | yes |  |
| `entries[].actorId` | string (uuid) | yes |  |
| `entries[].score` | integer (-1000–1000) | no | Omit to roll initiative server-side |
| `entries[].surprised` | boolean | no | 2024 surprise: the server rolls this combatant's initiative with disadvantage |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/end`

Ends the encounter (GM-grade only). The whole fight auto-archives permanently (see /encounters) in the same transaction.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/combatants`

Adds a rostered actor to the running encounter (GM-grade only); rolls initiative when no score is given.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `actorId` | string (uuid) | yes |  |
| `score` | integer (-1000–1000) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/initiative/set`

Sets a combatant's initiative score (GM-grade only).

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `actorId` | string (uuid) | yes |  |
| `score` | integer (-1000–1000) | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/initiative/roll-self`

Rolls initiative for a character (server rolls the d20 unless a manual `natural` is supplied; `rollMode` gives advantage/disadvantage), adds its initiative modifier, sets its score, and clears its pending flag. GM-grade for anyone; a player session only for their own claimed character. When the encounter runs in `wait` mode, the last pending roll begins turns.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `actorId` | string (uuid) | yes |  |
| `natural` | integer (1–20) | no | a hand-rolled physical d20 (1-20); omit to have the server roll |
| `rollMode` | `advantage` \| `disadvantage` \| `normal` | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/initiative/roll-remaining`

Rolls initiative for every combatant still pending a player roll (GM-grade only), beginning a `wait`-mode fight.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/initiative/next`

Advances the turn (GM-grade only). While the table is rewound this steps forward through recorded history; a 409 with `needsConfirm: "rewrite-history"` asks for `confirmRewrite: true` to truncate the undone future.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `confirmRewrite` | boolean | no | Confirm rewriting history from the reviewed turn (truncates the undone future) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/initiative/previous`

Rewinds the whole table to the previous turn boundary (GM-grade only). A 409 with `needsConfirm: "discard-changes"` asks for `confirmDiscard: true` to drop changes made while rewound.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `confirmDiscard` | boolean | no | Confirm discarding changes made while rewound (re-restores the viewed turn in place) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/turn/end`

Ends the current turn and advances. The GM (or an integration) may end anyone's turn; a player session only their own claimed character's.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/turn/use`

Marks the current turn's action or bonus action used/unused. A free manual toggle (never blocks); structured action resolution validates against this state per the encounter's rules mode, and un-marking the action slot also clears any open compound-action instance.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `slot` | `action` \| `bonus-action` | yes |  |
| `used` | boolean | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/turn/reaction`

Marks a combatant's reaction used/unused; reactions refresh at the start of their own turn.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `actorId` | string (uuid) | yes |  |
| `used` | boolean | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/turn/legendary`

Sets a legendary creature's spent legendary actions this round (GM-grade only; 0 clears). Structured legendary action resolves spend the pool automatically; it refills at the creature's own turn start.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `actorId` | string (uuid) | yes |  |
| `spent` | integer (0–10) | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/tokens/{actorId}/move`

Moves a combatant's token; the server snaps to the calibrated grid. `position: null` returns the token to the tray. Player sessions may move only their claimed character. `sceneId` targets a prepared (GM-private) scene instead of the live table.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `position` | ImagePoint \| null | yes | Image-space coordinates (server snaps to the grid); null returns the token to the tray |
| `sceneId` | string (uuid) | no | Target a prepared GM-private scene instead of the live encounter |
| `override` | object | no | GM-grade bypass of a movement-budget rejection; audited in the combat log |
| `override.reason` | string | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors`

Instantiates a bundled SRD monster onto the roster (GM-grade only). The response's `actorId` equals the commandId.

**Auth:** Integration credential with `actor:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `definitionId` | string (pattern) | yes |  |
| `visibility` | `public` \| `gm-only` | no | Default: `"public"`. |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `DELETE /api/v1/game/actors/{actorId}`

Removes an actor from the roster (GM-grade only); rejected for claimed characters and, while rewound, for combatants in the fight.

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/damage`

Applies damage (temporary hit points absorb first). Optional typed `parts` run the defense pipeline - immunity, then resistance (half, rounded down), then vulnerability (double) - from the target's definition and active effects, with the per-part breakdown returned in `applied`; the bare `amount` is the manual path (no defense math). Dropping a player character to 0 starts the dying state (Unconscious + Prone + death saves; `critical: true` while dying adds two failures). Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `amount` | integer (1–1000) | yes | Untyped total - used when `parts` is absent; kept for compatibility either way |
| `parts` | object[] | no | Typed components; the server applies the target's defenses and returns the breakdown |
| `parts[].amount` | integer (0–1000) | yes |  |
| `parts[].type` | string | yes |  |
| `sourceActorId` | string (uuid) | no |  |
| `sourceActionId` | string (pattern) | no |  |
| `sourceName` | string | no |  |
| `critical` | boolean | no | Adds two death-save failures instead of one when the target is already dying |
| `nonlethal` | boolean | no | Knocking out a creature (SRD): a drop to 0 leaves the target Unconscious and stable instead of dying/defeated |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/heal`

Heals hit points up to the maximum. Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `amount` | integer (1–1000) | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/temp-hp`

Sets temporary hit points (replaces, 5e-style). Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `amount` | integer (0–1000) | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/hp`

Sets current hit points directly (GM-grade only).

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `current` | integer (0–10000) | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/conditions`

Applies or clears a bundled SRD condition (exhaustion carries a level). Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `conditionId` | string (pattern) | yes |  |
| `active` | boolean | yes |  |
| `level` | integer (1–6) | no | Exhaustion level |
| `override` | object | no | GM-grade bypass of the stand-up movement cost rejection; audited |
| `override.reason` | string | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/definitions/import`

Imports a canonical ActorDefinition JSON as a claimable actor with a full sheet (GM-grade only). The response's `actorId` equals the commandId.

**Auth:** Integration credential with `actor:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `definition` | object (free-form) | yes | A canonical ActorDefinition JSON (schema version discoverable via /system/version) |
| `visibility` | `public` \| `gm-only` | no | Default: `"public"`. |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/character-imports`

Submits a character sheet into the GM's approval queue instead of importing it directly - the player path (a GM importing their own sheet uses the definitions import). Any joined session may submit; nothing reaches the roster until the GM resolves it. The queued entry's `importId` is this call's commandId, so keep it to resolve or re-send the submission idempotently.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no | Also becomes the queued submission's importId; resend it to retry the submission idempotently |
| `expectedRevision` | integer (≥ 0) | no |  |
| `definition` | object (free-form) | yes | A canonical ActorDefinition JSON, at most 256 KiB serialized (schema version discoverable via /system/version) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/character-imports/{importId}/resolve`

Approves (`approve: true`) or rejects a queued character submission (GM-grade only). Either decision removes it from the queue; approving instantiates the claimable actor, whose id equals THIS call's commandId (returned as `actorId`).

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `importId` (path) - string

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no | Also becomes the approved actor's id |
| `expectedRevision` | integer (≥ 0) | no |  |
| `approve` | boolean | yes | true instantiates the submitted sheet as a claimable actor; false discards it. Either way the submission leaves the queue |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/rolls`

Rolls dice into the shared, auditable roll history; the response carries `rollId`. Player sessions cannot roll gm-only, and rolling for an actor requires owning it.

**Auth:** Integration credential with `roll:create` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `formula` | string | yes | e.g. 2d6+3, 4d6kh3, 2d20kl1 |
| `purpose` | `attack` \| `save` \| `check` \| `damage` \| `manual` | yes |  |
| `visibility` | `public` \| `gm-only` \| `blind` \| `self-only` | yes |  |
| `label` | string | no | What was rolled, specifically (e.g. "Athletics check", "DEX save", a weapon/spell name); shown in the roll log alongside the coarse purpose |
| `actorId` | string (uuid) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actions/resolve`

Runs a stat-block action: attack vs target AC with 2024 crit doubling, or save-DC surfacing with proposed damage. GM-grade for any combatant; a player session only for their own claimed character (area templates, cover, and rules overrides stay GM-only). A player's hit is handed to the GM as a damage proposal, or applied directly when the table's player-damage-mode is `direct`. Targets are explicit ids or an area template (never both); rolls are recorded in the shared history and the response carries the `resolution`.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `actorId` | string (uuid) | yes |  |
| `actionId` | string (pattern) | yes |  |
| `targetIds` | string (uuid)[] | no |  |
| `template` | object | no | Area targeting: the server snaps the template and finds who is under it. Provide targetIds or template, never both. |
| `template.shape` | `circle` \| `cone` \| `line` \| `square` | yes |  |
| `template.origin` | ImagePoint | yes |  |
| `template.target` | ImagePoint | yes |  |
| `conditionId` | string (pattern) | no |  |
| `rollMode` | `advantage` \| `disadvantage` \| `normal` | no | Explicit GM choice; wins over the engine's advantage/disadvantage aggregation |
| `override` | object | no | Bypasses a rules-mode rejection; audited in the combat log and journal |
| `override.reason` | string | yes |  |
| `effectId` | string | no | For the escape-grapple builtin: which escapable effect to break (defaults to the first with an escape DC) |
| `note` | string | no | Free-text annotation (the Ready builtin's trigger), shown in the granted effect's name |
| `cover` | `half` \| `three-quarters` \| `total` | no | GM-adjudicated cover for the target: +2/+5 to AC and Dex saves; total blocks targeting (overridable) |
| `commit` | boolean | no | false previews a single-target attack's d20 only (no damage/riders/prompts/economy) so the answerer can re-roll adv/disadv or confirm; confirm with commit=true and the shown attackNatural. Non-attack actions ignore it. Default: `true`. |
| `attackNatural` | integer (1–20) | no | Apply this exact d20 face for the attack instead of rolling - confirming a preview, or a hand-rolled die |
| `attackTotal` | integer (-50–100) | no | Hand-entered final attack total ("final total" manual mode) - used verbatim vs AC; pair with critical for a nat 20 |
| `critical` | boolean | no | Declares a natural 20 (critical hit) for the hand-entered-total path, where the natural die can't be inferred |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/saves/{saveId}/answer`

Answers a pending saving throw by server roll or manual total; on commit the outcome auto-applies damage/conditions. Player sessions may answer only their claimed character's saves. The response carries the `outcome`.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `saveId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `method` | `roll` \| `manual` | yes |  |
| `total` | integer (-20–60) | no | Required for method=manual |
| `rollMode` | `advantage` \| `disadvantage` \| `normal` | no | For method=roll: the answerer's explicit advantage/disadvantage choice; wins over the engine's aggregated sources (2d20kh1 / 2d20kl1) |
| `commit` | boolean | no | false previews the outcome without applying damage/conditions Default: `true`. |
| `legendaryResistance` | boolean | no | GM only, commit only: spend a Legendary Resistance use to turn a failed save into a success (a natural success spends nothing) Default: `false`. |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/saves/{saveId}/dismiss`

Dismisses a pending saving throw without resolving it (GM-grade, or the owing player).

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `saveId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/reactions/{reactionId}/answer`

Answers a pending reaction prompt (Uncanny Dodge). The triggering attack's damage was parked on the prompt, so both answers apply it here: `use: true` spends the reaction and halves each typed part first; `use: false` applies it in full. Player sessions may answer only their claimed character's prompts. The response carries the `outcome`.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `reactionId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `use` | boolean | yes | true spends the reaction and applies half the parked damage; false applies it in full |
| `actionId` | string (pattern) | no | Opportunity attacks: which melee action to swing with (defaults to the reactor's first melee, else Unarmed Strike) |
| `commit` | boolean | no | Opportunity attacks: false previews the swing (roll only, reaction unspent, nothing applied) so the answerer can re-roll adv/disadv or confirm; confirm with commit=true and the shown attackNatural Default: `true`. |
| `rollMode` | `advantage` \| `disadvantage` \| `normal` | no | Opportunity attacks: the answerer's advantage/disadvantage choice for the swing's d20 |
| `attackNatural` | integer (1–20) | no | Opportunity attacks: apply this exact d20 for the swing instead of rolling - confirming a preview, or a hand-rolled die |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/reactions/{reactionId}/dismiss`

Dismisses a pending reaction prompt WITHOUT applying its parked damage (GM-grade only) - for when the damage was already applied manually.

**Auth:** Integration credential with `combat:write` · GM session

**Parameters:** `reactionId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/damage/resolve`

Applies or dismisses a parked player-hit damage proposal (proposal mode; GM-grade only). `apply: true` reduces the target's HP through the typed-defense pipeline (an optional `amount` overrides the total as a bare number, no defense math); `apply: false` discards it. Either way the proposal clears.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `proposalId` | string (uuid) | yes |  |
| `apply` | boolean | yes | true applies the parked damage; false dismisses it |
| `amount` | integer (0–1000) | no | optional override total (bare number, no defense math) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `GET /api/v1/game/actors/{actorId}/available-actions`

Server-computed action availability for one combatant: per stat-block action, whether strict mode would allow resolving it right now, every violated rule (machine-readable rule ids + messages), and the remaining limited uses / open compound-action rolls. Runs the exact evaluation `action.resolve` enforces, so this report can never drift from enforcement. GM-grade any combatant; a player session only their claimed character. Target-specific rules (e.g. grapple targeting) need a target and are not pre-checked here.

**Auth:** Integration credential with `combat:read` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Responses:** `200` Per-action availability with explanations - envelope of `ActorAvailableActionsData` · errors `401` `403` `404`

### `POST /api/v1/game/actors/{actorId}/effects`

Adds a rules-engine effect to a combatant (GM-grade only): a named, tagged state with an optional duration and typed modifiers (damage bonus, damage resistance, advantage). Structured actions create richer effects via their own declarations; this is the house-rule/manual path. The response's `effectId` equals the commandId.

**Auth:** Integration credential with `combat:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `name` | string | yes |  |
| `tags` | string (pattern)[] | no |  |
| `duration` | object | no | rounds \| until-source-next-turn \| encounter \| manual (default manual) |
| `duration.type` | `rounds` \| `until-source-next-turn` \| `encounter` \| `manual` | yes |  |
| `duration.rounds` | integer (1–100) | no |  |
| `modifiers` | object (free-form)[] | no |  |
| `concentration` | boolean | no | the bearer concentrates to sustain this effect: one at a time, damage prompts a CON save, incapacitation breaks it |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/effects/{effectId}/end`

Ends an effect: linked conditions clear (a released grapple removes Grappled/Restrained) and its on-end grants fire (a Frenzied Rage ending adds Exhaustion). GM-grade anyone; a player session only their claimed character.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid) · `effectId` (path) - string

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/death-save`

Rolls a death saving throw for a dying character (at 0 HP): natural 20 regains 1 HP, natural 1 counts two failures, 10+ succeeds (three stabilize), otherwise a failure (three kill). Default applies in one step; pass `commit: false` to preview the projected pips first (honoring `rollMode` adv/disadv), then confirm with `commit: true` and the shown `naturalRoll`. The roll is recorded in the shared history and the response carries `deathSave`. GM-grade anyone; a player session only their claimed character.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `commit` | boolean | no | false previews the projected pips without changing them; confirm with commit=true and the shown naturalRoll Default: `true`. |
| `rollMode` | `advantage` \| `disadvantage` \| `normal` | no | Roll two d20s keeping the higher/lower (2d20kh1 / 2d20kl1); the kept face is the natural roll |
| `naturalRoll` | integer (1–20) | no | Apply this exact d20 value with no fresh roll - confirming a preview, or an off-screen physical die |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/rules-mode`

Sets the rules-engine enforcement mode (GM-grade only): `strict` rejects invalid structured actions with an overridable `error.details.blocked`, `assisted` allows them with logged warnings, `freeform` skips validation. Also settable at encounter start.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `mode` | `strict` \| `assisted` \| `freeform` | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/roll-mode`

Sets the table's roll preference (GM-grade only): `auto` rolls each encounter roll for you (with a typed override and adv/disadv after a d20), `manual` waits for a typed physical-dice result (with a Roll button to auto-roll instead).

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `mode` | `auto` \| `manual` | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/player-damage-mode`

Sets how a player's own confirmed hit reaches an enemy's HP (GM-grade only): `proposal` parks a GM-confirmed damage proposal (the default), `direct` applies the typed damage immediately server-side.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `mode` | `proposal` \| `direct` | yes | proposal parks a GM-confirmed damage proposal for a player's hit; direct applies the typed damage immediately server-side |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/player-initiative-mode`

Sets how player-rolled initiative behaves (GM-grade only): `immediate` begins turns at once on a provisional order that re-sorts as players roll in, `wait` holds turn advancement until every player has rolled (or the GM rolls the rest).

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `mode` | `immediate` \| `wait` | yes | immediate begins turns at once on a provisional order; wait holds turns until every player has rolled |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/health-display`

Sets the table-wide default for how token health shows on the map (GM-grade only): `band` a coarse status badge, `bar` a thin HP bar, or `ring` a green-to-red ring; `audience` `gm` keeps a bar/ring on the GM map only, `all` shows it to players and the shared screen. Exact hit points never leave the GM - non-owners see only a coarse band-fraction. A single token can override this via the actor health-display command.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `style` | `band` \| `bar` \| `ring` \| `aura` | yes |  |
| `audience` | `gm` \| `all` | yes | gm keeps a bar/ring on the GM map only; all shows it to players and the shared screen (coarse band-fraction for non-owners) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/encounter/environment`

Toggles the underwater environment on the live encounter (GM-grade only; SRD Underwater Combat): melee attacks take Disadvantage unless they deal piercing damage, ranged attacks automatically miss beyond normal range, and every combatant resists fire damage.

**Auth:** Integration credential with `combat:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `underwater` | boolean | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/rest`

Applies a rest to a rostered actor outside combat; a player session may rest only their claimed character, the GM anyone. Long: remaining effects end (their on-end grants fire first), hit points restore to maximum, temporary HP clears, the dying state resets, limited-use pools refresh, all spent Hit Point Dice restore, spell slots and prepared spells reset to the sheet defaults, and Exhaustion drops one level. Short: per-short-rest and recharge pools re-arm; healing is the separate spend-hit-dice call.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `kind` | `long` \| `short` | yes | short re-arms per-short-rest and recharge pools (heal by spending Hit Point Dice separately); long is the full reset |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/spend-hit-dice`

Spends Hit Point Dice to heal (SRD Short Rest: each die heals its roll + Con modifier, minimum 1). Rejected while the actor is in an active encounter. Player sessions may target only their claimed character; the dice land in the shared roll history.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `count` | integer (1–40) | yes | How many Hit Point Dice to spend; each heals its roll + Con modifier (minimum 1) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/spell-slot`

Sets a character's remaining spell slots for one level (clamped to the sheet maximum) - spend or restore a slot during play. Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `level` | integer (1–9) | yes |  |
| `remaining` | integer (0–9) | yes | New remaining slots for this level; clamped to the sheet's maximum |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/prepared-spell`

Prepares or un-prepares one of a character's known spells (cantrips and always-prepared spells can't be toggled). Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `spellId` | string | yes |  |
| `prepared` | boolean | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/inventory`

Adds, updates, or removes (quantity 0) one of a character's inventory items and toggles equipped/attuned. Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `item` | object | yes |  |
| `item.id` | string (pattern) | yes |  |
| `item.name` | string | yes |  |
| `item.quantity` | integer (0–9999) | no | 0 removes the item |
| `item.equipped` | boolean | no |  |
| `item.attuned` | boolean | no |  |
| `item.weightEach` | number (≥ 0) | no |  |
| `item.description` | string | no |  |
| `item.category` | string (pattern) | no |  |
| `item.weapon` | object | no | Weapon stats (from the SRD catalog); equipping surfaces a rollable attack on the sheet |
| `item.armor` | object | no | Armor/shield stats (from the SRD catalog); equipping derives Armor Class |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/currency`

Sets a character's coin purse (cp/sp/ep/gp/pp). Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `currency` | object | yes |  |
| `currency.cp` | integer (0–1000000) | no |  |
| `currency.sp` | integer (0–1000000) | no |  |
| `currency.ep` | integer (0–1000000) | no |  |
| `currency.gp` | integer (0–1000000) | no |  |
| `currency.pp` | integer (0–1000000) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/identity`

Sets a character's identity (class/level/race/background/feats) on its editable imported sheet - a light hand-edit, not a guided builder. Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `character` | object | yes |  |
| `character.classes` | object[] | no |  |
| `character.race` | object | no |  |
| `character.background` | object | no |  |
| `character.feats` | object[] | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/characters`

Creates a character from CHOICES rather than a finished sheet (GM-grade only in this phase): identity ids (species/background/class/subclass), base ability scores plus the background's +2/+1 or +1/+1/+1 allocation, per-level hit-point entries (or the fixed average), and the choice-provenance ledger as the literal build input. The server validates every id against the content catalogs, resolves every catalog-driven choice through the same resolver the wizard uses, interprets the content features' structured riders into sheet actions, assembles the canonical ActorDefinition, and lands it through the import path - the new claimable actor's id equals this call's commandId and its editable sheet is keyed import-<actorId>.

**Auth:** Integration credential with `actor:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no | Also becomes the created actor's id (and keys its editable sheet as import-<actorId>); resend it to retry idempotently |
| `expectedRevision` | integer (≥ 0) | no |  |
| `name` | string | yes |  |
| `speciesId` | string (pattern) | yes | A species id from the content catalog |
| `backgroundId` | string (pattern) | yes |  |
| `classId` | string (pattern) | yes |  |
| `level` | integer (1–20) | yes |  |
| `subclassId` | string (pattern) | no | Required once level reaches the class's subclass level |
| `abilityMethod` | `standard-array` \| `point-buy` \| `roll` \| `custom` | yes | Must be one of the methods the builder policy allows; base scores are validated against the method (array multiset, point-buy budget, formula bounds) |
| `baseScores` | object | yes | The six scores BEFORE the background allocation and any species/feat bonuses |
| `baseScores.str` | integer (1–30) | yes |  |
| `baseScores.dex` | integer (1–30) | yes |  |
| `baseScores.con` | integer (1–30) | yes |  |
| `baseScores.int` | integer (1–30) | yes |  |
| `baseScores.wis` | integer (1–30) | yes |  |
| `baseScores.cha` | integer (1–30) | yes |  |
| `backgroundBonusAllocation` | object[] | yes | The background's ability increases, matching one of its printed spreads (+2/+1 or +1/+1/+1) over its listed abilities; empty when the background grants none |
| `backgroundBonusAllocation[].ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `backgroundBonusAllocation[].amount` | integer (1–3) | yes |  |
| `hp` | object | yes |  |
| `hp.mode` | `average` \| `entries` | yes | average = the SRD fixed value every level; entries = one rolled result per level after the first, applied as max(roll, average) - the builder's friendly default |
| `hp.entries` | integer (1–12)[] | no | Required for mode entries: exactly level-1 rolls, each within [1, hit die] |
| `choices` | object[] | yes | The choice-provenance ledger AS the build input: every pick the wizard collected (skills, subclass, spells, cantrips, feats/ASI with their splits, equipment options, lineage, languages, tools). Catalog-driven picks are validated through the same fromCatalog resolver the wizard used; the ledger is stored verbatim on the sheet for level-up and respec |
| `choices[].level` | integer (1–20) | yes |  |
| `choices[].classId` | string (pattern) | no |  |
| `choices[].kind` | string (pattern) | yes |  |
| `choices[].id` | string (pattern) | yes |  |
| `choices[].payload` | object (free-form) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/builder/policy`

Sets the character-builder table policy (GM-grade only; task-packet decision 10): which ability-score generation methods the wizard offers players (standard-array, point-buy, roll, custom - all four by default) and the GM's custom roll formula. A supplied formula is validated through the server's own dice grammar and bounds (a formula that can roll outside 1-30 is rejected); allowing "custom" is only actionable while a formula is set. The stored policy is projected to every player verbatim.

**Auth:** Integration credential with `actor:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `allowedAbilityMethods` | `standard-array` \| `point-buy` \| `roll` \| `custom`[] | yes | Which ability-score methods the wizard offers players (task-packet decision 10); duplicates rejected |
| `customFormula` | string \| null | no | The GM's custom roll formula (e.g. 3d6, 2d6+6), validated through the server dice grammar and 1-30 bounds; null clears it. Omitting the field keeps the stored formula |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/proficiencies`

Sets a character's save and skill proficiency selections on its editable imported sheet. Player sessions may target only their claimed character.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `proficiencies` | object | yes |  |
| `proficiencies.saves` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | no |  |
| `proficiencies.skills` | object[] | no |  |
| `proficiencies.saveOverrides` | object (free-form) | no |  |
| `proficiencies.skillOverrides` | object (free-form) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/annotations`

Draws a measurement or area shape on the encounter map; the server snaps geometry to the grid. The response's `annotationId` equals the commandId.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `kind` | `measurement` \| `shape` | yes |  |
| `shape` | `circle` \| `cone` \| `line` \| `square` | no |  |
| `geometry` | AnnotationGeometryInput | yes |  |
| `visibility` | `public` \| `gm-only` \| `owner-only` \| `owner-gm` \| `gm-actor` | no |  |
| `visibleToActorId` | string \| null | no |  |
| `movableByOthers` | boolean | no |  |
| `color` | string (pattern) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/annotations/ping`

Pings a point on the encounter map (ephemeral, labeled with the sender).

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `point` | ImagePoint | yes |  |
| `color` | string (pattern) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/annotations/clear`

Clears drawn shapes: your own, all player shapes (GM-grade), or everything (GM-grade).

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `scope` | `mine` \| `players` \| `all` | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `DELETE /api/v1/game/annotations/{id}`

Removes one annotation (owners, the GM, and GM-grade integrations).

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/annotations/{id}/move`

Moves/resizes an annotation; the server re-snaps geometry.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `geometry` | AnnotationGeometryInput | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/annotations/{id}/color`

Changes an annotation's color.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `color` | string (pattern) | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/annotations/{id}/visibility`

Changes who can see an annotation (public, gm-only, owner-only, owner-gm, gm-actor).

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `visibility` | `public` \| `gm-only` \| `owner-only` \| `owner-gm` \| `gm-actor` | yes |  |
| `visibleToActorId` | string \| null | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/annotations/{id}/movable`

Allows or disallows other players moving a shape.

**Auth:** Integration credential with `combat:write` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `movableByOthers` | boolean | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/claims`

Claims an unclaimed player character for the calling session. Player sessions only - GM sessions and integration credentials are refused (an integration wanting a seat at the table should hold a player session from POST /sessions/player).

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `actorId` | string (uuid) | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/claims/release`

Releases every character claimed by the calling player session.

**Auth:** Integration credential with `actor:write` · GM session · Player session (own-character limits apply)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/claims/{actorId}/force-release`

Force-releases a claimed character (GM-grade only) - the recovery path for a lost player device.

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/token-image`

Sets or clears (null) a combatant's token image from the uploaded token library (GM-grade only).

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `tokenAssetId` | string \| null | yes | A token-library asset id, or null to clear the image |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/size`

Sets a combatant's creature size; large+ tokens size to their grid footprint and re-snap (GM-grade only).

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `size` | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan` | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/visibility`

Moves a combatant between the shared layer (public) and the GM-only layer (GM-grade only).

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `visibility` | `public` \| `gm-only` | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/archived`

Archives or restores a character (GM-grade only). Archived characters are hidden from players and excluded from the encounter builder; a character in the running encounter must be removed first.

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `archived` | boolean | yes | true archives (hides from players + encounter builder); false restores |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/health-display`

Overrides how one combatant's token health shows on the map (GM-grade only), or clears the override (`display: null`) so the token follows the table-wide default. Same style/audience choices as the table-wide health-display command.

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `display` | object \| null | yes | The per-token override, or null to clear it and follow the table default |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/actors/{actorId}/speed`

Sets a combatant's walking speed in feet (GM-grade only); null clears it to unknown, which skips the movement rules for that combatant. Speed seeds from the imported definition automatically.

**Auth:** Integration credential with `actor:write` · GM session

**Parameters:** `actorId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `speedFeet` | integer \| null | yes | Walking speed in feet; null clears to unknown (movement rules skip) |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/scenes`

Prepares a staged scene on a battlemap, privately, without touching the live table (GM-grade only). The response's `sceneId` equals the commandId.

**Auth:** Integration credential with `scene:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `name` | string | yes |  |
| `mapAssetId` | string (uuid) | yes |  |
| `combatantIds` | string (uuid)[] | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `DELETE /api/v1/game/scenes/{sceneId}`

Removes a prepared scene (GM-grade only); the active scene cannot be removed.

**Auth:** Integration credential with `scene:write` · GM session

**Parameters:** `sceneId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/scenes/{sceneId}/rename`

Renames a prepared scene (GM-grade only).

**Auth:** Integration credential with `scene:write` · GM session

**Parameters:** `sceneId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `name` | string | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/scenes/{sceneId}/activate`

Switches the live table to a prepared scene, parking the current one non-destructively (GM-grade only). Rejected while the timeline is rewound; the turn-snapshot timeline restarts for the newly live scene.

**Auth:** Integration credential with `scene:write` · GM session

**Parameters:** `sceneId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/scenes/{sceneId}/combatants`

Replaces a prepared scene's combatant list (GM-grade only).

**Auth:** Integration credential with `scene:write` · GM session

**Parameters:** `sceneId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `combatantIds` | string (uuid)[] | yes |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/scenes/{sceneId}/duplicate`

Duplicates a prepared scene as a new staged copy carrying the same map and staged combatants/tokens (GM-grade only). Duplicating the live scene snapshots its current combat into the copy; the copy is always parked, next to the original. The response's `sceneId` equals the commandId.

**Auth:** Integration credential with `scene:write` · GM session

**Parameters:** `sceneId` (path) - string (uuid)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/scenes/reorder`

Reorders the prepared-scene list to the given permutation of every scene id (GM-grade only). Does not change which scene is live.

**Auth:** Integration credential with `scene:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `order` | string (uuid)[] | yes | Every prepared scene's id, in the new order |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/fog/enabled`

Turns manual fog of war on/off (GM-grade only). Enabled fog with no reveal strokes hides the whole map from players and the shared screen; `sceneId` targets a prepared scene's private prep instead of the live table.

**Auth:** Integration credential with `scene:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `enabled` | boolean | yes |  |
| `sceneId` | string (uuid) | no | Target a prepared (parked) scene's private prep instead of the live table |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/fog/paint`

Paints one reveal/hide fog rect (GM-grade only). The server snaps to whole grid cells on calibrated unrotated maps and clamps to the map bounds; a stroke covering the whole map replaces all prior strokes. `sceneId` targets a prepared scene.

**Auth:** Integration credential with `scene:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `op` | `reveal` \| `hide` | yes |  |
| `rect` | object | yes | Image-pixel rect; snapped to whole grid cells on calibrated unrotated maps and clamped to the map |
| `rect.x` | number | yes |  |
| `rect.y` | number | yes |  |
| `rect.width` | number | yes |  |
| `rect.height` | number | yes |  |
| `sceneId` | string (uuid) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

### `POST /api/v1/game/fog/reset`

Clears every fog stroke - with fog enabled the whole map is hidden again (GM-grade only). `sceneId` targets a prepared scene.

**Auth:** Integration credential with `scene:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | no |  |
| `expectedRevision` | integer (≥ 0) | no |  |
| `sceneId` | string (uuid) | no |  |

**Responses:** `200` Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed - envelope of `GameMutationAccepted` · errors `400` `401` `403` `409`

## Reference content

The bundled SRD 5.2.1 content (CC BY 4.0): bestiary, runnable action summaries, the condition/spell/equipment reference, and the character-builder catalogs (classes, subclasses, species, backgrounds, feats, name pools). The bestiary is GM-grade; every rules catalog is public reference a player session may read, and each carries the `attribution` line the displaying surface must show.

### `GET /api/v1/content/monsters`

Browse the bundled SRD bestiary (GM-grade only). Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session

**Responses:** `200` Monster summaries + attribution - envelope of `ContentMonstersData` · errors `401` `403`

### `GET /api/v1/content/monsters/{definitionId}`

One full stat block (GM-grade only). Imported definitions shadow bundled ids, matching the live server's resolution.

**Auth:** Integration credential with `game:read` · GM session

**Parameters:** `definitionId` (path) - string (pattern)

**Responses:** `200` The full ActorDefinition - envelope of `ContentMonsterSheetData` · errors `401` `403` `404`

### `GET /api/v1/content/monsters/{definitionId}/actions`

A stat block's actions flattened for running them (GM-grade only): attack bonus, reach/range, save DC, damage formulas, parsed area.

**Auth:** Integration credential with `game:read` · GM session

**Parameters:** `definitionId` (path) - string (pattern)

**Responses:** `200` Runnable action summaries - envelope of `ContentMonsterActionsData` · errors `401` `403` `404`

### `GET /api/v1/content/conditions`

The bundled SRD condition reference (public information - any GM, player, or integration session). Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Condition reference entries - envelope of `ContentConditionsData` · errors `401` `403`

### `GET /api/v1/content/skills`

The skill catalog: reference text plus the ability each check uses, as data - the source the builder and sheet read instead of a hardcoded client list, so a homebrew skill is one catalog row. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentSkillsData` · errors `401` `403`

### `GET /api/v1/content/spells`

The bundled SRD spell list with the fields a sheet needs to cast from: level, school, casting time, range, components, duration, concentration/ritual flags, description, the spell-list tags (`classes`) the builder filters on, and the upcast (`castingOptions`) rows keyed by slot level. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentSpellsData` · errors `401` `403`

### `GET /api/v1/content/equipment`

The bundled SRD equipment catalog - gear, weapons, and armor folded into one browse-and-add list, with the weapon/armor blocks populated for those categories. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentEquipmentData` · errors `401` `403`

### `GET /api/v1/content/classes`

The character-builder class catalog: hit die, primary abilities, saving-throw and skill proficiency choices, the spellcasting ability where the class has one, and the class features as data. `source` distinguishes bundled SRD records from GM homebrew merged into the same catalog. Includes the CC BY 4.0 attribution line the builder must display.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentClassesData` · errors `401` `403`

### `GET /api/v1/content/subclasses`

The character-builder subclass catalog, each keyed to its parent `classId` and the level it unlocks at, with its features as data. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentSubclassesData` · errors `401` `403`

### `GET /api/v1/content/species`

The character-builder species catalog: creature size, walking speed, and the species traits as data. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentSpeciesData` · errors `401` `403`

### `GET /api/v1/content/backgrounds`

The character-builder background catalog: granted skill/tool proficiencies, languages, starting-equipment prose, and the background feat where one applies. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentBackgroundsData` · errors `401` `403`

### `GET /api/v1/content/feats`

The character-builder feat catalog, with each feat's category and human-readable prerequisite. The server, not the client, is the authority on whether a prerequisite is met. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentFeatsData` · errors `401` `403`

### `GET /api/v1/content/names`

Per-species name pools for the builder's random generator. Pool `kind` is an open slug and pool order comes from the data, so new pools are additive. Includes the CC BY 4.0 attribution line.

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Catalog entries - envelope of `ContentNamesData` · errors `401` `403`

## Homebrew authoring (GM-only)

The GM's homebrew library: one polymorphic authoring collection for every content type, its draft/published + player-visibility state machine, soft delete, usage lookups, and pack export/import. Every operation here is GM-only - there is no player read on this surface at all. Players reach homebrew exclusively through the merged reference-content catalogs above, and only records that are published, visible to players, and not deleted.

### `GET /api/v1/homebrew/content`

The GM's homebrew library as flat summaries - the authored body stays out of the list, so a few-hundred-record library is a small payload. Filters compose; "all types" is simply `type` omitted. Soft-deleted rows are hidden from this listing too unless `includeDeleted` is set. Paging is keyset, not offset (the GM publishing mid-scroll must not skip or duplicate a row): `cursor` is OPAQUE - never construct or parse one - and `nextCursor: null` means this was the last page. `total` counts every row matching the filter, ignoring `limit`/`cursor`.

**Auth:** GM session

**Parameters:** `type` (query, optional) - `class` \| `subclass` \| `species` \| `background` \| `feat` \| `spell` \| `equipment` \| `monster` \| `spell-list` · `state` (query, optional) - `draft` \| `published` · `visibleToPlayers` (query, optional) - boolean · `q` (query, optional) - string · `includeDeleted` (query, optional) - boolean · `limit` (query, optional) - integer (1–200) · `cursor` (query, optional) - string

**Responses:** `200` Success - envelope of `HomebrewContentListData` · errors `400` `401` `403`

### `POST /api/v1/homebrew/content`

Creates a homebrew record. It always lands as `state: "draft"`, `visibleToPlayers: false`: a draft is allowed to be invalid, and nothing reaches a player until it is BOTH published and made visible.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `record` | HomebrewRecord | yes |  |

**Responses:** `201` Success - envelope of `HomebrewContentData` · errors `400` `401` `403` `409`

### `GET /api/v1/homebrew/content/{id}`

One record with its row state and its full validity report (`validity.issues`), so an editor can show what still blocks publishing without a round-trip per field.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Responses:** `200` Success - envelope of `HomebrewContentData` · errors `401` `403` `404`

### `PATCH /api/v1/homebrew/content/{id}`

Replaces the authored `record` and leaves `state`, `visibleToPlayers`, and `deletedAt` alone - genuinely correct PATCH semantics on the ROW, even though the `record` value it carries is complete. A partial merge into a polymorphic body under `additionalProperties: false` is unspecifiable, so the body is always the whole record.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `record` | HomebrewRecord | yes |  |
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on. |

**Responses:** `200` Success - envelope of `HomebrewContentData` · errors `400` `401` `403` `404` `409`

### `DELETE /api/v1/homebrew/content/{id}`

Soft-deletes a record (sets `deletedAt`); idempotent, so deleting an unknown or already-deleted id is still a 200. A soft-deleted record leaves the merged catalogs immediately and is restorable via `/restore`.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Responses:** `200` Success - envelope of `HomebrewDeletedData` · errors `401` `403`

### `POST /api/v1/homebrew/content/{id}/restore`

Clears `deletedAt`. Soft delete is a one-way state transition rather than an ordinary field, so this is its explicit inverse - never a PATCH of `deletedAt: null`.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Responses:** `200` Success - envelope of `HomebrewContentData` · errors `401` `403` `404`

### `POST /api/v1/homebrew/content/{id}/duplicate`

Deep-copies a record under a freshly minted homebrew id. `{id}` may be an SRD id (`wizard`), which is what makes a 20-row class table tractable to author: the server reads the full bundled record and mints a namespaced homebrew copy. The copy lands as a draft, invisible to players.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no | Name for the copy; omitted derives one server-side. |

**Responses:** `201` Success - envelope of `HomebrewContentData` · errors `400` `401` `403` `404`

### `POST /api/v1/homebrew/content/{id}/publish`

Moves a record to `state: "published"`, which requires it to be valid. Publishing does NOT show it to players - that is `/visibility`, deliberately a separate endpoint. A publish REQUEST that is itself malformed is a 400; a well-formed request against a draft the stored state refuses is a 409.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on. |

**Responses:** `200` Success - envelope of `HomebrewContentData` · errors `400` `401` `403` `404` `409`

### `POST /api/v1/homebrew/content/{id}/unpublish`

Returns a record to `state: "draft"`. It leaves the merged catalogs at once and may be invalid again while the GM reworks it.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Request body** (JSON, optional):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on. |

**Responses:** `200` Success - envelope of `HomebrewContentData` · errors `400` `401` `403` `404`

### `POST /api/v1/homebrew/content/{id}/visibility`

Sets whether players may see a published record. `state` and `visibleToPlayers` are orthogonal, but the COMBINATION draft + visible is meaningless: asking for it on a draft is a loud 409, never a silent no-op, which is what keeps `visibleToPlayers` from becoming a lie.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `visibleToPlayers` | boolean | yes |  |
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on. |

**Responses:** `200` Success - envelope of `HomebrewContentData` · errors `400` `401` `403` `404` `409`

### `GET /api/v1/homebrew/content/{id}/usages`

Which characters took this record, computed on demand from the character choice ledger (no persisted reverse index at this data volume). `safeToDelete` is always true and says so calmly: a built character carries a flattened, self-contained ActorDefinition, so deleting a homebrew record never breaks one.

**Auth:** GM session

**Parameters:** `id` (path) - string (pattern)

**Responses:** `200` Success - envelope of `HomebrewUsagesData` · errors `401` `403` `404`

### `GET /api/v1/homebrew/packs/export`

Exports published, non-deleted records as a shareable pack. Optional `type` and repeatable `id` narrow it to one class rather than the whole table. The pack carries authored bodies ONLY - no `state`, `visibleToPlayers`, `deletedAt`, or `rev` - so an importing table can never inherit this one's visibility policy.

**Auth:** GM session

**Parameters:** `type` (query, optional) - `class` \| `subclass` \| `species` \| `background` \| `feat` \| `spell` \| `equipment` \| `monster` \| `spell-list` · `id` (query, optional) - string (pattern)[]

**Responses:** `200` Success - envelope of `HomebrewPackExportData` · errors `400` `401` `403`

### `POST /api/v1/homebrew/packs/import`

Imports a pack. Everything lands as `state: "draft"`, `visibleToPlayers: false`, which makes importing an invalid pack harmless. Ids that collide with an SRD id are ALWAYS re-minted; ids colliding with existing homebrew follow `onIdCollision`. `dryRun` runs the whole collision + cross-reference-rewrite + re-validate pass and returns the identical report without writing - use it to see the plan before the only destructive path in the feature runs. This route mounts its own body parser above the server's 512kb default (about 4mb); a larger pack is a 413.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pack` | HomebrewPack | yes |  |
| `onIdCollision` | `remint` \| `overwrite` | no | How to resolve a collision with an EXISTING HOMEBREW id; an SRD collision is always re-minted regardless. Default: `"remint"`. |
| `dryRun` | boolean | no | Run the whole collision + rewrite + re-validate pass and return the identical report without writing. Default: `false`. |

**Responses:** `200` Success - envelope of `HomebrewPackImportData` · errors `400` `401` `403` `409` `413`

## Encounter archives (Time Machine)

Permanent, machine-readable records of ended encounters - see the archive document section above for the full v3 shape. GM-grade principals only.

### `GET /api/v1/encounters`

Permanent records of ended encounters, newest first (GM sessions and integration credentials only - never player sessions).

**Auth:** Integration credential with `combat:read` · GM session

**Responses:** `200` Archive summaries - envelope of `EncounterArchiveListData` · errors `401` `403`

### `GET /api/v1/encounters/{id}`

One archive's full machine-readable document (archiveSchemaVersion 3): per-turn full states, combat log, complete per-command journal, final state, the post-encounter aftermath state, all dice rolls, and the stat blocks used. GM-grade data - hidden combatants included; never reaches player sessions.

**Auth:** Integration credential with `combat:read` · GM session

**Parameters:** `id` (path) - integer (≥ 1)

**Responses:** `200` The stored document, verbatim - envelope of `EncounterArchiveDocumentData` · errors `400` `401` `403` `404`

### `DELETE /api/v1/encounters/{id}`

Permanently deletes one archived encounter (GM session or an admin-scoped credential).

**Auth:** Integration credential with `admin` · GM session

**Parameters:** `id` (path) - integer (≥ 1)

**Responses:** `200` Deleted - envelope of `EncounterArchiveDeletedData` · errors `400` `401` `403` `404`

## Map assets & calibration

Uploading battlemap/regional/world images, reading their bytes, and the server-held grid-calibration wizard.

### `GET /api/v1/map-assets`

**Auth:** GM session

**Responses:** `200` Safe metadata for every stored map asset - envelope of `MapAssetListData` · errors `401`

### `POST /api/v1/map-assets`

Uploads raw image bytes as the request body. `filename`, `name`, and `kind` (battlemap/regional/world) are query parameters, not a JSON body. Content-addressed: uploading identical bytes again returns the existing asset with `duplicate: true` instead of creating a copy.

**Auth:** GM session

**Parameters:** `filename` (query, optional) - string · `name` (query, optional) - string · `kind` (query, optional) - `battlemap` \| `regional` \| `world`

**Request body:** raw `image/*` bytes.

**Responses:** `200` Identical bytes already stored; the existing asset is returned - envelope of `MapAssetUploadData` · `201` New map asset stored - envelope of `MapAssetUploadData` · errors `400` `401` `413`

### `GET /api/v1/map-assets/{id}`

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Safe metadata for one map asset - envelope of `MapAssetData` · errors `401` `404`

### `PATCH /api/v1/map-assets/{id}`

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no |  |
| `kind` | `battlemap` \| `regional` \| `world` | no |  |

**Responses:** `200` Updated map catalog entry - envelope of `MapAssetData` · errors `400` `401`

### `GET /api/v1/map-assets/{id}/content`

Renderer-safe original image bytes. Authorized for the GM, a player in the active encounter on this map, or a paired viewer session (cookie) - any one is sufficient. Supports ETag/If-None-Match (304), byte-range requests (206/416), and is always sent with `Cache-Control: private, no-store` since access can be revoked at any time.

**Auth:** GM session · Paired viewer session (cookie)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Full image bytes · `206` Partial content for a byte-range request · `304` Not modified · errors `403` `404` `416`

### `PUT /api/v1/map-assets/{id}/scale`

Gridless real-world scale, derived from two image points and a known distance.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `start` | ImagePoint | yes |  |
| `end` | ImagePoint | yes |  |
| `knownDistance` | number | yes |  |
| `unit` | string | yes |  |

**Responses:** `200` Updated map catalog entry with the new scale - envelope of `MapAssetData` · errors `400` `401`

### `POST /api/v1/map-assets/{id}/calibration/wizards`

Starts a server-held, TTL-bounded calibration wizard session from either a fixed 3x3 area drag or a known-axis segment measurement, and returns its ID plus a viewport-clipped grid overlay preview.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `201` Wizard session started - envelope of `MapCalibrationWizardData` · errors `400` `401` `404`

### `POST /api/v1/map-assets/{id}/calibration/wizards/{wizardId}/actions`

Applies one adjust/undo/redo/verify action to an in-progress wizard session, owned by the same GM bearer token that started it.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid) · `wizardId` (path) - string (uuid)

**Responses:** `200` Updated wizard state and overlay - envelope of `MapCalibrationWizardData` · errors `400` `401` `404`

### `POST /api/v1/map-assets/{id}/calibration/wizards/{wizardId}/complete`

Saves the wizard's current calibration to the map catalog and discards the wizard session. Verification is optional reassurance, not a requirement.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid) · `wizardId` (path) - string (uuid)

**Responses:** `200` Saved calibration - envelope of `MapAssetData` · errors `400` `401` `404`

## Table viewer (second screen)

Pairing a shared display and driving its player-safe presentation. The viewer never authenticates with game credentials - pairing codes and an HttpOnly cookie only.

### `POST /api/v1/viewer/pairings`

Issues a short-lived, one-time pairing code for a second-screen display to exchange for a session.

**Auth:** GM session

**Responses:** `201` Pairing code issued · errors `401`

### `POST /api/v1/viewer/pairings/exchange`

Exchanges a pairing code for an HttpOnly, SameSite=Strict `vtt_viewer_session` cookie. No request auth: the code itself is the credential.

**Auth:** Public - no credentials required.

**Responses:** `201` Paired; session cookie set · errors `400`

### `GET /api/v1/viewer/access`

**Auth:** GM session

**Responses:** `200` Every paired viewer plus which are currently connected · errors `401`

### `DELETE /api/v1/viewer/access/{id}`

Revokes one paired display and immediately disconnects its live event stream.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Revoked · errors `401`

### `GET /api/v1/viewer/presentation`

**Auth:** GM session · Paired viewer session (cookie)

**Responses:** `200` Current player-safe presentation state (map, camera, measurement, pings, initiative, encounter) · errors `401`

### `POST /api/v1/viewer/presentation/commands`

GM-only optimistic-concurrency command (present/pause map, set camera, ping, set/clear measurement). `expectedRevision` mismatches return 409.

**Auth:** GM session

**Responses:** `200` Command applied · errors `400` `401` `409`

### `GET /api/v1/viewer/events`

Server-Sent Events stream of presentation updates for a paired viewer session; not a normal JSON response.

**Auth:** Paired viewer session (cookie)

**Responses:** `200` text/event-stream of `presentation` events · errors `401`

## Codex (pages, atlas, journal & calendar)

The GM-authored worldbuilding surface: typed wiki **pages** (with folders, tags, backlinks, relationships and revision history), the nested map atlas and its **pins** (`marker` on the wire), the campaign **journal**, and the fantasy **calendar** - plus page media. Reads accept a GM session, a player session, or an integration credential scoped `codex:read`; writes accept a GM session or `codex:write`. A credential acts at GM grade (it is the GM's own automation); a player session receives the revealed-only projection - GM bodies, GM fields, and unrevealed pages/maps/pins/entries are stripped server-side, and the two shapes are published separately as `X` / `XPlayer` joined by `XProjected`. Every codex GET sends a weak `ETag`; send `If-None-Match` for a free `304`.

### `GET /api/v1/codex/pages`

Every page's summary (a player sees only revealed pages). Optional `folder` (empty string = top level) and `tag` filters.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `folder` (query, optional) - string · `tag` (query, optional) - string

**Responses:** `200` Success - envelope of `CodexPageListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `POST /api/v1/codex/pages`

Creates a page.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes |  |
| `entityType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` | no |  |
| `fields` | object (free-form) | no |  |
| `gmFields` | object (free-form) | no |  |
| `folder` | string \| null | no |  |
| `tags` | string[] | no |  |
| `playerBody` | string | no |  |
| `gmBody` | string | no |  |
| `revealedToPlayers` | boolean | no |  |
| `bannerAssetId` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no | CT-11: the in-world date that places an `event` page on the chronicle. Omit for undated. |

**Responses:** `201` Success - envelope of `CodexPageData` · errors `400` `401` `403`

### `GET /api/v1/codex/search`

Suite-wide full-text search across pages, journal entries, maps and markers, role-scoped. `q` is the query. Deliberately ONE search route rather than one per record type: `hits` is a single ranked list discriminated by `kind`.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `q` (query, optional) - string

**Responses:** `200` Success - envelope of `CodexSearchData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `GET /api/v1/codex/pages/{id}`

One page with its backlinks and typed relationships, projected for the caller.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexPageDocumentData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403` `404`

### `PATCH /api/v1/codex/pages/{id}`

Edits a page. `expectedRev` rejects a stale write with 409.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | no |  |
| `entityType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` | no |  |
| `fields` | object (free-form) | no |  |
| `gmFields` | object (free-form) | no |  |
| `folder` | string \| null | no |  |
| `tags` | string[] | no |  |
| `playerBody` | string | no |  |
| `gmBody` | string | no |  |
| `bannerAssetId` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no | CT-11: the in-world date. Omitted leaves the stored date alone; `null` clears it. |
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 if the page moved on. |

**Responses:** `200` Success - envelope of `CodexPageData` · errors `400` `401` `403` `404` `409`

### `DELETE /api/v1/codex/pages/{id}`

Deletes a page; idempotent.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401` `403`

### `POST /api/v1/codex/pages/{id}/reveal`

Shows/hides a page to players.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexPageData` · errors `400` `401` `403` `404`

### `POST /api/v1/codex/pages/{id}/relationships`

Adds a typed relationship edge from this page to another. Counts as an edit of BOTH pages, so both move in "recently updated" - but neither page's `rev` changes, so an open editor is not forced into a conflict.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `toPageId` | string (uuid) | yes |  |
| `type` | string | yes |  |

**Responses:** `201` Success - envelope of `CodexRelationshipData` · errors `400` `401` `403` `404`

### `GET /api/v1/codex/pages/{id}/markers`

The reverse of `/codex/maps/{id}/markers`: every atlas marker that links THIS page, so an open page can point back at the map. Role-scoped by exactly the forward route's predicate - a player must be able to see the page itself (an unrevealed page 404s), and then receives only revealed pins whose MAP is also revealed, with each pin's links filtered to the revealed subset and scene/actor ids stripped.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexMarkerListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403` `404`

### `GET /api/v1/codex/pages/{id}/revisions`

Autosaved revision history for a page.

**Auth:** Integration credential with `codex:read` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexRevisionListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403` `404`

### `POST /api/v1/codex/pages/{id}/revisions/{revisionId}/restore`

Restores a page to a prior revision.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid) · `revisionId` (path) - integer (≥ 1)

**Responses:** `200` Success - envelope of `CodexPageData` · errors `400` `401` `403` `404`

### `POST /api/v1/codex/preview-session`

Mints a short-lived PLAYER session token so the GM can preview the player Codex truthfully. Deliberately a real player principal rather than a role flag on the GM's session - every read then walks the same authorization and projection path a genuine player gets, so the preview can never show what a player could not see.

**Auth:** GM session

**Responses:** `201` Success - envelope of `CodexPreviewSessionData` · errors `401` `403`

### `GET /api/v1/codex/folders`

Every explicitly-created folder path; lets an empty folder persist.

**Auth:** Integration credential with `codex:read` · GM session

**Responses:** `200` Success - envelope of `CodexFolderListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `POST /api/v1/codex/folders`

Creates (or keeps) an empty folder.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes |  |

**Responses:** `201` Success - envelope of `CodexFolderCreatedData` · errors `400` `401` `403`

### `POST /api/v1/codex/folders/move`

Renames/moves a folder subtree, re-pathing every page under it. Returns how many pages moved.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes |  |
| `to` | string | yes | Empty string moves the folder to the top level. |

**Responses:** `200` Success - envelope of `CodexFolderMovedData` · errors `400` `401` `403`

### `POST /api/v1/codex/folders/delete`

Deletes a folder and its subfolders; every page under it drops to the top level - never deleted.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes |  |

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `400` `401` `403`

### `GET /api/v1/codex/relationships`

Every relationship edge for the graph, role-scoped (a player sees only edges whose BOTH endpoints are revealed).

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexRelationshipEdgeListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `DELETE /api/v1/codex/relationships/{id}`

Removes one relationship edge; idempotent. Like adding one, it counts as an edit of both endpoint pages for "recently updated" without changing either page's `rev`.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401` `403`

### `GET /api/v1/codex/links`

Every `[[wiki link]]` edge between two pages - the Graph's second edge kind, beside the typed relationships. Role-scoped by both rules the existing feeds enforce: a player sees an edge only when BOTH endpoints are revealed pages (never a dangling edge to a page they cannot see) AND only when it was written in a page's PLAYER-facing body, never its GM body. Links to a title no page carries, and a page's link to itself, carry no edge.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexLinkEdgeListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `GET /api/v1/codex/maps`

The atlas map tree, role-scoped (a player sees only revealed maps; a revealed map keeps its parent link only when that parent is itself revealed).

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexMapListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `POST /api/v1/codex/maps`

Turns an uploaded map asset into an atlas map node.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `assetId` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `kind` | `battlemap` \| `regional` \| `world` | yes |  |
| `parentMapId` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |

**Responses:** `201` Success - envelope of `CodexMapData` · errors `400` `401` `403` `404`

### `PATCH /api/v1/codex/maps/{id}`

Renames/retypes a map.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `name` | string | no |  |
| `kind` | `battlemap` \| `regional` \| `world` | no |  |

**Responses:** `200` Success - envelope of `CodexMapData` · errors `400` `401` `403` `404`

### `DELETE /api/v1/codex/maps/{id}`

Deletes a map and its markers; idempotent.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401` `403`

### `POST /api/v1/codex/maps/{id}/parent`

Re-parents a map in the atlas tree (null = a root map).

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `parentMapId` | string \| null | yes |  |

**Responses:** `200` Success - envelope of `CodexMapData` · errors `400` `401` `403` `404`

### `POST /api/v1/codex/maps/{id}/reveal`

Shows/hides a map to players.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexMapData` · errors `400` `401` `403` `404`

### `GET /api/v1/codex/maps/{id}/markers`

Markers on a map, role-scoped (a player only for a revealed map, and each pin's links filtered to the revealed subset).

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexMarkerListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403` `404`

### `POST /api/v1/codex/maps/{id}/markers`

Drops a marker on a map.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `x` | number (0–1000000) | yes |  |
| `y` | number (0–1000000) | yes |  |
| `iconId` | string (pattern) | yes |  |
| `iconColor` | string (pattern) | yes |  |
| `label` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `pageIds` | string (uuid)[] | no |  |
| `subMapId` | string \| null | no |  |
| `sceneIds` | string (uuid)[] | no |  |
| `actorId` | string \| null | no |  |

**Responses:** `201` Success - envelope of `CodexMarkerData` · errors `400` `401` `403` `404`

### `PATCH /api/v1/codex/markers/{id}`

Edits a marker's icon/label/links.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `x` | number (0–1000000) | no |  |
| `y` | number (0–1000000) | no |  |
| `iconId` | string (pattern) | no |  |
| `iconColor` | string (pattern) | no |  |
| `label` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `pageIds` | string (uuid)[] | no |  |
| `subMapId` | string \| null | no |  |
| `sceneIds` | string (uuid)[] | no |  |
| `actorId` | string \| null | no |  |

**Responses:** `200` Success - envelope of `CodexMarkerData` · errors `400` `401` `403` `404`

### `DELETE /api/v1/codex/markers/{id}`

Deletes a marker; idempotent.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401` `403`

### `POST /api/v1/codex/markers/{id}/move`

Repositions a marker in normalized map coordinates.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x` | number (0–1000000) | yes |  |
| `y` | number (0–1000000) | yes |  |

**Responses:** `200` Success - envelope of `CodexMarkerData` · errors `400` `401` `403` `404`

### `POST /api/v1/codex/markers/{id}/reveal`

Shows/hides a marker to players.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexMarkerData` · errors `400` `401` `403` `404`

### `PUT /api/v1/codex/markers/{id}/party`

CT-7: marks this pin as where the party is, or clears the flag from it. **Exactly one marker in the whole atlas** carries it, so setting a new one clears the old in a single step - the party is in exactly one place, and one-pin-per-map would leave "which pin is real?" unanswerable. `isParty: false` clears the flag from THIS marker only and never disturbs a different party pin. The flag is the pin's ONLY party-specific surface: it is moved, relabelled, linked, revealed and deleted through the ordinary marker routes, because the party marker is an ordinary marker with a flag rather than a marker type of its own. It is player-facing - the party pin is for the players - but it grants no visibility: a hidden party pin, or one on a hidden map, stays hidden exactly like any other pin.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `isParty` | boolean | yes | `true` makes this the party's pin and clears the flag from whichever pin held it before, anywhere in the atlas. `false` clears it from THIS pin only and never disturbs a different party pin. |

**Responses:** `200` Success - envelope of `CodexMarkerData` · errors `400` `401` `403` `404`

### `GET /api/v1/codex/timeline`

The ONE chronicle: every journal entry and every dated `event` page, interleaved in one in-world chronological order and returned in one row shape (`kind` discriminates - `entry`, `combat`, `event`). The client's "by session" lens is a regrouping of these same records, never a second fetch. Role-scoped: a player receives only revealed entries and revealed event pages, with GM-only text (`gmText`, an event's GM body), the replay linkage and the raw sort key stripped - the projection delegates to the journal and page player projections rather than restating them, so this read can never be weaker than either.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexChronicleListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `GET /api/v1/codex/journal`

The campaign timeline, or a location's mini-timeline via `markerId`/`pageId`, role-scoped (a player only for a revealed marker/page, and only revealed entries).

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `markerId` (query, optional) - string (uuid) · `pageId` (query, optional) - string (uuid)

**Responses:** `200` Success - envelope of `CodexJournalListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403` `404`

### `POST /api/v1/codex/journal`

Adds a journal/timeline entry.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `playerText` | string | no |  |
| `gmText` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `attachMarkerId` | string \| null | no |  |
| `attachPageId` | string \| null | no |  |
| `sessionNumber` | integer \| null | no |  |
| `realDate` | string \| null | no |  |
| `inWorldLabel` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no |  |

**Responses:** `201` Success - envelope of `CodexJournalEntryData` · errors `400` `401` `403`

### `POST /api/v1/codex/journal/deadline`

CT-5: adds a DEADLINE - a thing that will happen at an in-world date, which the campaign clock can reach. Its own text is the "what" and its own `inWorldDate` is the "when", so a deadline stores no extra payload at all; `fired` is DERIVED from that date against the clock on every read and never stored, which is why rewinding the clock correctly un-fires one. `inWorldDate` is REQUIRED and may not be null - an undated deadline can never fire, so it is a note, not a deadline. Created HIDDEN like any other entry and published by the ordinary `POST /codex/journal/{id}/reveal`: there is no kind-specific reveal and no kind-based visibility rule anywhere.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `playerText` | string | no | The deadline itself, in the party's words - a deadline IS its text, which is why it stores no separate 'what'. |
| `gmText` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `attachMarkerId` | string \| null | no |  |
| `attachPageId` | string \| null | no |  |
| `sessionNumber` | integer \| null | no |  |
| `realDate` | string \| null | no |  |
| `inWorldLabel` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate | yes | WHEN it happens - the date the campaign clock has to reach for this to fire. Required, and never null. |

**Responses:** `201` Success - envelope of `CodexJournalEntryData` · errors `400` `401` `403`

### `POST /api/v1/codex/journal/downtime`

CT-10: records DOWNTIME - who spent how many days doing what between adventures. Creating it NEVER moves the campaign clock; it answers with `proposedDate`, the date the clock WOULD move to, so the GM's confirm affordance can state what it will do before it does it. `POST /codex/journal/{id}/apply-downtime` is the only thing that moves the clock. Dated at the GM's current campaign date when no `inWorldDate` is given, the same rule an auto-logged battle follows, so the record lands where it happened.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `playerText` | string | no |  |
| `gmText` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `attachMarkerId` | string \| null | no |  |
| `attachPageId` | string \| null | no |  |
| `sessionNumber` | integer \| null | no |  |
| `realDate` | string \| null | no |  |
| `inWorldLabel` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no |  |
| `downtime` | CodexDowntimeInput | yes |  |

**Responses:** `201` Success - envelope of `CodexDowntimeCreatedData` · errors `400` `401` `403`

### `POST /api/v1/codex/journal/milestone`

CT-8: records a MILESTONE - the party reached a level, and why. `level` is the level REACHED, not a step, so a deleted record cannot silently change what level the party is on (a delta would make the current level a sum over the whole timeline). There is no XP: progression here is milestone-based by design and the record carries no arithmetic. Created HIDDEN like any other entry and published by the ordinary `POST /codex/journal/{id}/reveal` - there is no kind-specific reveal. Dated at the GM's current campaign date when no `inWorldDate` is given, the rule an auto-logged battle and a downtime record already follow.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `playerText` | string | no |  |
| `gmText` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `attachMarkerId` | string \| null | no |  |
| `attachPageId` | string \| null | no |  |
| `sessionNumber` | integer \| null | no |  |
| `realDate` | string \| null | no |  |
| `inWorldLabel` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no |  |
| `milestone` | CodexMilestoneInput | yes |  |

**Responses:** `201` Success - envelope of `CodexJournalEntryData` · errors `400` `401` `403`

### `PATCH /api/v1/codex/journal/{id}`

Edits a journal entry.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | no |  |
| `playerText` | string | no |  |
| `gmText` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `attachMarkerId` | string \| null | no |  |
| `attachPageId` | string \| null | no |  |
| `sessionNumber` | integer \| null | no |  |
| `realDate` | string \| null | no |  |
| `inWorldLabel` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no |  |

**Responses:** `200` Success - envelope of `CodexJournalEntryData` · errors `400` `401` `403` `404`

### `DELETE /api/v1/codex/journal/{id}`

Deletes a journal entry; idempotent.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401` `403`

### `POST /api/v1/codex/journal/{id}/reveal`

Shows/hides a journal entry to players. Works on EVERY journal kind, deadlines and downtime included - there is deliberately no kind-specific reveal route, because a second gate is a second thing to keep in step with the first.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexJournalEntryData` · errors `400` `401` `403` `404`

### `POST /api/v1/codex/journal/{id}/apply-downtime`

Confirms a downtime record's time cost and ADVANCES the campaign clock by its `days`. The GM's explicit yes - the owner asked to be asked rather than have the clock move itself. Entry and calendar move together in one transaction and are returned together, so a client cannot render a moved clock beside an unapplied record. Applying an already-applied downtime, or any entry that is not downtime, is refused and moves nothing. Advancing the clock does NOT publish it: players keep seeing the published date until `POST /codex/calendar/publish`.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDowntimeAppliedData` · errors `400` `401` `403` `404` `409`

### `GET /api/v1/codex/sessions`

Every play session - the GM's prep-and-recap record of one evening at the table. Numbered sessions first in number order, then the unnumbered ones oldest-first (the same tier-separator idiom the chronicle uses for undated records). Role-scoped: a GM receives the whole record for every session plus `activeSessionId`; a player receives only REVEALED sessions, reduced to the recap layer (`id`, `sessionNumber`, `realDate`, `recap`), and `activeSessionId` is always null for a player because it can name a session they cannot see.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexSessionListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `POST /api/v1/codex/sessions`

Creates a session. Every field is optional - an empty POST opens a blank `planned` session to prep into. A `sessionNumber` another session already carries is refused with 400: the journal's by-session lens resolves a number to at most one session, so numbers are unique.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sessionNumber` | integer \| null | no | Must not already be in use by another session. |
| `realDate` | string \| null | no |  |
| `attendees` | string[] | no |  |
| `prepBody` | string | no |  |
| `recapBody` | string | no |  |
| `status` | `planned` \| `played` | no |  |
| `revealedToPlayers` | boolean | no |  |

**Responses:** `201` Success - envelope of `CodexSessionData` · errors `400` `401` `403`

### `GET /api/v1/codex/sessions/{id}`

One session, projected for the caller. An unrevealed session is **404** to a player - the same 404 an absent session gets, and never 403, because a 403 would confirm the record exists and its very existence ("session 14 is being prepped") is GM information.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexSessionProjectedData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403` `404`

### `PATCH /api/v1/codex/sessions/{id}`

Edits a session; an omitted field is left alone. `expectedRev` rejects a stale write with 409. A `sessionNumber` another session already carries is a 400, not a 409 - it is a bad value, not a lost race.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sessionNumber` | integer \| null | no | Must not already be in use by another session; `null` clears it. |
| `realDate` | string \| null | no |  |
| `attendees` | string[] | no |  |
| `prepBody` | string | no |  |
| `recapBody` | string | no |  |
| `status` | `planned` \| `played` | no |  |
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 if the session moved on. |

**Responses:** `200` Success - envelope of `CodexSessionData` · errors `400` `401` `403` `404` `409`

### `DELETE /api/v1/codex/sessions/{id}`

Deletes a session; idempotent. If it was the active session the pointer is cleared in the same transaction, so `activeSessionId` can never name a record that is gone. Journal entries that carry its `sessionNumber` are NOT deleted or renumbered - the number on an entry is a label, not a foreign key.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401` `403`

### `POST /api/v1/codex/sessions/{id}/reveal`

Publishes/retracts a session's recap to players. Revealing is not an edit: it moves neither `rev` nor `updatedAt`, so an open console is not forced into a conflict and a reveal sweep cannot light the players' recap badge for text nobody changed.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexSessionData` · errors `400` `401` `403` `404`

### `POST /api/v1/codex/sessions/{id}/activate`

Marks this session the ACTIVE one - the single session new journal entries (including the ones combat writes automatically at `encounter.end`) are stamped with when the caller supplies no `sessionNumber` of its own. Exactly one session is active at a time: the pointer lives on the codex metadata row, not as a flag on each session, so "two active sessions" is unrepresentable. Answers with the POINTER alone, never the session: activating is a statement about the TABLE, not an edit of the record, and it moves neither `rev` nor `updatedAt` - returning the row would imply otherwise.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexSessionActiveData` · errors `400` `401` `403` `404`

### `GET /api/v1/codex/quests`

Every quest - what the party is chasing, and whether it is still open. Role-scoped: a GM receives the whole record for every quest; a player receives only REVEALED quests, reduced to the player layer (`id`, `title`, `status`, `body`, `objectives`, `entityIds`). `status` IS player-facing here, unlike a session's: "what is still open" is the point of the feature, and a revealed quest whose state the player cannot see is useless. `entityIds` is filtered to the revealed subset, exactly as a marker's `pageIds` is.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexQuestListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `POST /api/v1/codex/quests`

Creates a quest. Only `title` is required - everything else opens empty, so the GM can name a lead the moment it appears at the table and fill it in later.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes |  |
| `status` | `active` \| `completed` \| `failed` | no |  |
| `playerBody` | string | no |  |
| `gmBody` | string | no |  |
| `objectives` | CodexQuestObjective[] | no |  |
| `entityIds` | string (uuid)[] | no |  |
| `revealedToPlayers` | boolean | no |  |

**Responses:** `201` Success - envelope of `CodexQuestData` · errors `400` `401` `403`

### `GET /api/v1/codex/quests/{id}`

One quest, projected for the caller. An unrevealed quest is **404** to a player - the same 404 an absent quest gets, and never 403, because a 403 would confirm the record exists and its very existence ("there is a quest about the duke") is GM information.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexQuestProjectedData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403` `404`

### `PATCH /api/v1/codex/quests/{id}`

Edits a quest; an omitted field is left alone. `expectedRev` rejects a stale write with 409. `objectives` is REPLACED wholesale and stored in exactly the order given - order is content here, not incidental, so the array is never sorted, deduped, or re-keyed by position.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | no |  |
| `status` | `active` \| `completed` \| `failed` | no |  |
| `playerBody` | string | no |  |
| `gmBody` | string | no |  |
| `objectives` | CodexQuestObjective[] | no |  |
| `entityIds` | string (uuid)[] | no |  |
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 if the quest moved on. |

**Responses:** `200` Success - envelope of `CodexQuestData` · errors `400` `401` `403` `404` `409`

### `DELETE /api/v1/codex/quests/{id}`

Deletes a quest; idempotent. The pages named by `entityIds` are untouched - the link is a reference, not ownership.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401` `403`

### `POST /api/v1/codex/quests/{id}/reveal`

Shows/hides a quest to players. Revealing is not an edit: it moves neither `rev` nor `updatedAt`, so an open console is not forced into a conflict and a reveal sweep cannot make an untouched quest look freshly changed.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexQuestData` · errors `400` `401` `403` `404`

### `GET /api/v1/codex/standing`

CT-6: where the party stands with each faction, ROLE-SCOPED. A GM receives every standing; a player receives only those that are BOTH revealed themselves AND whose faction page is itself revealed, reduced to `factionPageId` and `value`. The second gate is not belt-and-braces: a standing row carries no title of its own (the faction's live page is the one name, so a rename cannot go stale), so a reader NAMES it by resolving `factionPageId` - and a standing published for a secret faction would hand the party a page id they cannot open beside a bar they cannot label. `value` is SIGNED, -100 (hostile) to +100 (allied), because a faction can be actively against the party and an unsigned favour scale cannot say so; a reader shows the word beside the bar, never the bar alone.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexStandingListData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `PUT /api/v1/codex/standing/{factionPageId}`

Sets where the party stands with one faction, and appends the `standing` chronicle record for the change - in ONE transaction, so the table (where things stand) and the timeline (what happened) can never disagree. Creates the standing on first use: `faction_page_id` is unique, so there is exactly one row per faction and nothing to create separately. `value` is the RESULTING value and is clamped to -100..100; the chronicle record carries the DELTA, because the record says what happened while the table says where things stand. 404 when no page with that id exists. **400** when the page exists but is not a `faction`: standing is tracked against factions, and the store enforces the entity type that the spec asks for as a foreign key (SQLite cannot express it - a CHECK may not subquery). The GM Codex only offers faction pages, so this is reachable mainly by a direct API caller, or by a page whose type was changed to something else after it had a standing row.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `factionPageId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `value` | integer (-100–100) | yes | The new standing, SIGNED. Rejected outside -100..100 here (the client's control cannot produce a 150, so one is a malformed caller) and clamped to the same range by the store, which is the router-rejects / store-enforces arrangement every bounded field in this surface uses. |
| `reason` | string | no | Why it moved, in one line - it lands on the `standing` chronicle record. Optional and may be empty: adjusting a standing mid-session should not be blocked on typing a sentence, and the change is recorded either way. Defaults to an empty string. |

**Responses:** `200` Success - envelope of `CodexStandingData` · errors `400` `401` `403` `404`

### `POST /api/v1/codex/standing/{factionPageId}/reveal`

Shows/hides a faction's standing to players. The ordinary reveal shape every codex record uses; revealing a standing does NOT reveal the faction page, and a player sees the standing only once both are revealed.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `factionPageId` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexStandingData` · errors `400` `401` `403` `404`

### `GET /api/v1/codex/reveal-audit`

CT-9: one GM view of everything the party can currently see, across every reveal surface in the Codex - pages, maps, markers, journal (all six kinds), sessions, quests and standing. GM-only, and READ-ONLY: it is an AGGREGATION of the existing player projections, not a second opinion about visibility, so it lists exactly what the corresponding player-facing endpoints would return - a marker flagged revealed on a HIDDEN map is absent here, because the party cannot see it either. Every section is always present, empty ones included with `revealed: 0`, so "nothing is revealed here" cannot be mistaken for "this did not load". Each row carries the id its own kind's EXISTING reveal route takes, which is how un-revealing works from this surface: there is deliberately no unreveal route and no bulk operation. Table-side exposure (tokens, fog, the shared viewer) is deliberately out of scope - that system has its own visibility rules, and folding it in would make this the second place that decides what a player can see.

**Auth:** Integration credential with `codex:read` · GM session

**Responses:** `200` Success - envelope of `CodexRevealAuditData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `GET /api/v1/codex/calendar`

The world's calendar (months, weekdays, era, current date), ROLE-PROJECTED. The campaign has two clocks: the GM's, which they run ahead while prepping, and the PUBLISHED one the party sees. A GM receives their own clock as `currentDate` plus `publishedDate` so they can tell whether the table is behind them; a player receives `currentDate` sourced ONLY from the published date, and never `publishedDate` (for a player the two are the same value) and never the GM's clock by any path. Months, weekdays and era are the world's own and are player-facing on both.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexCalendarProjectedData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `PUT /api/v1/codex/calendar`

Replaces the world calendar and reflows every dated record's sort instant and label from the raw dates. Moves the GM's clock only: advancing NEVER publishes, so the party's `currentDate` does not move until `POST /codex/calendar/publish`. `publishedDate` is deliberately not settable here - this body replaces the whole calendar, and a player-facing value inside a wholesale replacement is one careless PUT from being cleared.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `yearName` | string | yes |  |
| `months` | CodexCalendarMonth[] | yes |  |
| `weekdays` | string[] | yes |  |
| `currentDate` | CodexInWorldDate \| null | no |  |

**Responses:** `200` Success - envelope of `CodexCalendarData` · errors `400` `401` `403`

### `POST /api/v1/codex/calendar/publish`

Publishes the GM's clock: the party's `currentDate` becomes the GM's. Takes no body - "publish" means exactly "the table now sees where I am", and an arbitrary settable published date would be a third clock to keep in step. This is the ONLY thing that moves the players' date; neither editing the calendar nor applying downtime does it. Publishing while the GM has no current date clears the published one. The 400 is not reachable through any input today - the handler routes every failure through the shared codex error mapper, and documenting only the statuses currently reachable would make the document wrong the moment that changes.

**Auth:** Integration credential with `codex:write` · GM session

**Responses:** `200` Success - envelope of `CodexCalendarData` · errors `400` `401` `403`

### `GET /api/v1/codex/settings`

Every codex-WIDE setting, plus what the kept revision history COSTS (`versionCount` / `versionBytes`, both server-computed and read-only). GM-only on the read as well as the write, unlike the calendar: nothing here is player-facing - these values describe how the GM's own authoring history is kept, they gate no content, and they put nothing on a player's screen. An out-of-range or unrepresentable stored value reads back as the default rather than propagating, so this route always answers with a usable setting.

**Auth:** Integration credential with `codex:read` · GM session

**Responses:** `200` Success - envelope of `CodexSettingsData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `PUT /api/v1/codex/settings`

Replaces the codex-wide settings and answers with the full READ shape (usage figures included), never with what was sent - so a caller whose `windowMinutes` was clamped or truncated sees the real value rather than believing its own number took, and needs no second request to refresh the screen. The body carries the two SETTABLE fields only: `versionCount` / `versionBytes` are facts about a table the caller cannot see, so sending either is a **400** rather than a silently ignored key, and no path stores them. `windowMinutes` outside 0..10080 is likewise a **400** (the GM's control cannot produce one, so a caller that does is malformed, which is the router-rejects / store-clamps arrangement every bounded field in this surface uses); a fractional value INSIDE the range is truncated rather than rejected, because that is a slider artefact and not a mistake about what was meant. Changing these settings never deletes a revision: switching history off stops new checkpoints being written and nothing else, and the existing history stays listable and restorable.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revisionHistory` | CodexRevisionHistoryInput | yes |  |
| `autosave` | CodexAutosaveSettings | yes |  |

**Responses:** `200` Success - envelope of `CodexSettingsData` · errors `400` `401` `403`

### `DELETE /api/v1/codex/page-revisions`

Deletes every page revision authored more than `olderThanDays` ago, and answers with how many rows really went. The ONE destructive route in the Codex surface, and deliberately unforgiving: `olderThanDays` must be a whole number from 0 to 36500, and a negative or fractional value is a **400** rather than a clamp - the exact opposite of `windowMinutes`, because that is a slider the GM drags while this destroys data, and a malformed destructive request must not be interpreted generously. **`0` deletes EVERY revision**, which is arithmetic rather than a magic value: nothing is younger than zero days old. "Old" is measured against `authoredAt` - when the checkpointed content was authored - which is the same clock the write-side throttle uses, so age means one thing in this store. It works regardless of the `enabled` setting, because a GM who switched history off is exactly the GM reclaiming the space. It touches the revision table and NOTHING else: no page, no body and no `rev` moves, because a page as it stands now is not a version of itself.

**Auth:** Integration credential with `codex:write` · GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `olderThanDays` | integer (0–36500) | yes | Delete every revision authored more than this many days ago. **`0` deletes them all** - arithmetic, not a magic value, since nothing is younger than zero days old. A negative or fractional value is a 400 rather than a clamp, because this destroys data. The 36500 ceiling (100 years) is a guard, not a policy: a larger value pushes the cutoff date out of the representable range, which would turn a silly request into a 500. |

**Responses:** `200` Success - envelope of `CodexRevisionsDeletedData` · errors `400` `401` `403`

### `GET /api/v1/codex/export`

A full codex backup bundle. Carries whatever revision rows exist, verbatim - the 2026-07-30 revision throttle bounds the WRITES, never this export, and nothing prunes the table, so a backup never lies about how much history it holds. **There is no restore route yet**: the bundle is a complete record, but reloading one currently means hand-editing the SQLite file. `POST /codex/import` is planned and this description will name it the day it exists - it deliberately does not promise it today.

**Auth:** Integration credential with `codex:read` · GM session

**Responses:** `200` Success - envelope of `CodexExportData` · `304` Not modified - the weak `ETag` you sent as `If-None-Match` is still current. · errors `401` `403`

### `POST /api/v1/codex-assets`

Uploads a page image (banner or inline) as raw bytes in the request body; `filename` is a query parameter. Content-addressed: identical bytes return the existing asset with 200 instead of 201.

**Auth:** Integration credential with `codex:write` · GM session

**Parameters:** `filename` (query, optional) - string

**Request body:** raw `image/*` bytes.

**Responses:** `200` Identical bytes already stored; the existing asset is returned - envelope of `CodexAssetUploadData` · `201` New image stored - envelope of `CodexAssetUploadData` · errors `400` `401`

### `GET /api/v1/codex-assets/{id}/content`

Original image bytes for a page banner/inline image. GM always; a player only when the asset is used by a revealed page. Supports ETag/If-None-Match (304); sent with `Cache-Control: private, no-store`.

**Auth:** Integration credential with `codex:read` · GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Full image bytes · `304` Not modified · errors `403` `404`

## Shared shapes

### `ActorAvailableActionsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `rulesMode` | `strict` \| `assisted` \| `freeform` | yes |  |
| `derived` | object | yes | DISPLAY ONLY, and the sheet's single source for every number beside a roll button. Derived from the actor's LIVE loadout with the same functions the resolver uses, so a chip cannot disagree with the roll it starts - a circlet's granted expertise and an amulet's save bonus are already inside these numbers. Present on every response; a client should still tolerate its absence so it can talk to an older server. It rides this REQUEST rather than the broadcast game-state projection on purpose: this endpoint already authorizes its caller for one named actor, so the block is never even computed for an actor the caller may not see. |
| `derived.proficiencyBonus` | integer | yes |  |
| `derived.armorClass` | integer | yes | Live AC, already reconciled against worn armour and item riders |
| `derived.initiative` | integer | yes | Live initiative bonus including item riders |
| `derived.abilities` | object[] | yes |  |
| `derived.skills` | object[] | yes |  |
| `actions` | object[] | yes |  |
| `actions[].id` | string | yes |  |
| `actions[].name` | string | yes |  |
| `actions[].activation` | `action` \| `bonus-action` \| `reaction` \| `other` | yes |  |
| `actions[].available` | boolean | yes | Whether strict mode would allow resolving this action right now |
| `actions[].violations` | object[] | yes |  |
| `actions[].usesRemaining` | integer \| null | yes | Limited-use spending left; null when the action has no use limit |
| `actions[].componentsRemaining` | integer \| null | yes | Rolls left in the open compound-action instance; null when no instance applies |
| `actions[].builtin` | boolean | no | True for the SRD generic actions (Dodge, Dash, Help, Unarmed Strike, ...) every combatant can take |
| `actions[].description` | string | yes | DISPLAY ONLY. Every field from here down is read off the actor's EFFECTIVE action list, so it already carries the standing riders of what is equipped and attuned - which is what lets a client render an item-derived action (an amulet's cast, a +1 sword's swing) that is absent from the stat block entirely. None of it is what gets rolled: resolution takes `id` and recomputes through the same function, so a preview cannot disagree with the roll. |
| `actions[].attackBonus` | integer \| null | yes | To-hit including item riders; null when the action has no attack roll |
| `actions[].reachFeet` | integer \| null | yes |  |
| `actions[].rangeFeet` | integer \| null | yes |  |
| `actions[].rangeNormalFeet` | integer \| null | yes | Normal range band; shots beyond it up to rangeFeet roll at disadvantage |
| `actions[].attackCount` | integer \| null | yes |  |
| `actions[].saveAbility` | string \| null | yes |  |
| `actions[].saveDc` | integer \| null | yes | Save DC including item riders |
| `actions[].damage` | object[] | yes |  |
| `actions[].usesLimit` | integer \| null | yes | Total limited uses including any item that raised the pool; null when unlimited |
| `actions[].usesPer` | `turn` \| `encounter` \| `long-rest` \| `short-rest` \| `recharge` \| `null` | yes |  |
| `actions[].usesPool` | string \| null | yes | Shared pool key; actions naming one pool spend one counter |
| `actions[].requiresEffectTag` | string \| null | yes |  |
| `actions[].multiattack` | object[] \| null | yes |  |
| `actions[].reaction` | object \| null | yes |  |

### `AnnotationGeometryInput`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `origin` | ImagePoint | yes |  |
| `target` | ImagePoint | yes |  |

### `CodexAsset`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `width` | integer (≥ 1) | yes |  |
| `height` | integer (≥ 1) | yes |  |
| `mediaType` | string | yes |  |

### `CodexAssetUploadData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `asset` | CodexAsset | yes |  |

### `CodexAutosaveSettings`

Whether the Codex's editors save your work as you type, and how often. The server stores a PREFERENCE and nothing else - there is no server-side draft, so the behaviour (and the explicit Save plus unsaved-changes warning when it is off) is the editor's. Storing it here is what makes the setting follow the GM from a phone to a laptop.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | yes | Default `true`. `false` does not slow autosave down, it stops it: the editors then require an explicit Save and warn about unsaved changes. |
| `intervalSeconds` | integer (1–600) | yes | How long the editors wait after you stop typing before saving. SECONDS, and the unit is the same everywhere - wire, column, and store - so nothing converts at a boundary. Default `1`, which is what the shipping editors already did (an 800 ms debounce) expressed on this scale, so an upgraded codex saves exactly as often as it used to. `0` is not in range: a zero-second autosave is a save per keystroke, which is not a cadence anyone means - a GM who wants none says `enabled: false`. The 600 ceiling is ten minutes, past which the setting stops meaning "save while I work". |

### `CodexBacklink`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sourcePageId` | string (uuid) | yes |  |
| `sourceTitle` | string | yes |  |
| `section` | string \| null | yes |  |

### `CodexCalendar`

The world's calendar as the **GM** receives it. The campaign has two clocks (M11/O-1): the GM's, which they run ahead while prepping, and the PUBLISHED one the party sees. The player's calendar is the separate `CodexCalendarPlayer`, where `currentDate` is sourced from the published date and `publishedDate` is not declared at all; the two are joined by `CodexCalendarProjected`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `yearName` | string | yes |  |
| `months` | CodexCalendarMonth[] | yes |  |
| `weekdays` | string[] | yes |  |
| `currentDate` | CodexInWorldDate \| null | yes | The GM's own clock - where the campaign is now. Null until a date is set. Never reaches a player by any path. |
| `publishedDate` | CodexInWorldDate \| null | yes | What the party currently sees as 'now'. Equal to `currentDate` until the GM runs ahead while prepping, and moved only by `POST /codex/calendar/publish`. Not declared on `CodexCalendarPlayer`, where `currentDate` already IS this value. |

### `CodexCalendarData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `calendar` | CodexCalendar | yes |  |

### `CodexCalendarMonth`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `days` | integer (1–400) | yes |  |

### `CodexCalendarPlayer`

The world calendar as a PLAYER receives it. `currentDate` keeps its name and its meaning ("where the campaign is now, as far as this reader is concerned") and only its SOURCE changes: it is read from the published date, and the GM's clock is not reachable from this payload at all. `publishedDate` is deliberately not echoed - for a player `currentDate` already IS it, so a second key could only duplicate it or lie.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `yearName` | string | yes |  |
| `months` | CodexCalendarMonth[] | yes |  |
| `weekdays` | string[] | yes |  |
| `currentDate` | CodexInWorldDate \| null | yes | The PUBLISHED date. Null until the GM publishes one. |

### `CodexCalendarProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexCalendar`; a player session receives `CodexCalendarPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexCalendar`
- `CodexCalendarPlayer`

### `CodexCalendarProjectedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `calendar` | CodexCalendarProjected | yes |  |

### `CodexChronicleListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `records` | CodexChronicleRecordProjected[] | yes |  |

### `CodexChronicleRecord`

One row on the ONE chronicle (CT-11/CT-12) as the **GM** receives it, in the single row shape every timeline record uses. `kind` says what it is and therefore what opening it means: `entry`/`combat`/`deadline`/`downtime` carry a journal-entry id, `event` carries a PAGE id. Every key is present on every kind (null where it does not apply), so no reader branches on key presence. The player's row is the separate `CodexChronicleRecordPlayer`; the two are joined by `CodexChronicleRecordProjected`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `entry` \| `combat` \| `event` \| `deadline` \| `downtime` \| `milestone` \| `standing` | yes | What the row IS, read by icon AND word - never by colour alone. A discriminator for DISPLAY only: it never decides visibility, which is `revealedToPlayers` and nothing else. |
| `id` | string (uuid) | yes | The record's own id - a journal entry's for `entry`/`combat`, a page's for `event`. |
| `title` | string \| null | yes | An event page's title; null for a journal entry, which has no name. |
| `text` | string | yes | The player-facing layer: a journal entry's full text, or a bounded excerpt of an event page's player body. |
| `gmText` | string \| null | yes | GM-only: an entry's GM note, or an excerpt of an event page's GM body. Not declared at all on `CodexChronicleRecordPlayer`. |
| `revealedToPlayers` | boolean | yes | GM-only field; not declared on `CodexChronicleRecordPlayer` (a player only ever receives revealed records). |
| `sessionNumber` | integer \| null | yes |  |
| `realDate` | string \| null | yes |  |
| `inWorldLabel` | string \| null | yes | The in-world date as text - what the row is grouped under in the by-date lens. |
| `calendarInstant` | number \| null | yes | GM-only sort key; not declared on `CodexChronicleRecordPlayer`. |
| `inWorldDate` | CodexInWorldDate \| null | yes | GM-only raw date; not declared on `CodexChronicleRecordPlayer`. |
| `tags` | string[] | yes |  |
| `attachPageId` | string \| null | yes | GM-only; not declared on `CodexChronicleRecordPlayer`. |
| `attachMarkerId` | string \| null | yes | GM-only; not declared on `CodexChronicleRecordPlayer`. |
| `sourceEncounterId` | integer \| null | yes | GM-only replay linkage (K2); not declared on `CodexChronicleRecordPlayer`. |
| `fired` | boolean | yes | CT-5: has the campaign clock reached this deadline's own date? DERIVED on every read from `inWorldDate` against the clock, never stored - so rewinding the clock correctly un-fires a deadline. `false` for every kind that is not a dated deadline. Measured against WHOSE clock is a viewer-safety decision: the GM's row uses the GM's clock, a player's row uses the PUBLISHED date, so this boolean can never tell the party that a date they have not been shown has already gone by. |
| `payload` | CodexDowntimePayload \| CodexMilestonePayload \| CodexStandingPayload \| null | yes | The kind's structured facts, discriminated by `kind`; null for the kinds that carry none. Allow-listed per kind, never a spread of the stored blob: the GM receives the full downtime payload including `applied` (CT-10), a milestone's `{ level, reason }` (CT-8), and a standing change's `delta`/`reason` (CT-6). |
| `proposedDate` | CodexInWorldDate \| null | yes | GM-only (not declared on `CodexChronicleRecordPlayer`): for an unapplied downtime, the date `apply-downtime` would move the clock to. Null once applied, and for every other kind. A clock move the GM has not confirmed - and may never confirm - is prep. |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes | GM-only; not declared on `CodexChronicleRecordPlayer`. |

### `CodexChronicleRecordPlayer`

One chronicle row as a PLAYER receives it. Absent by construction: `gmText`, `revealedToPlayers`, `calendarInstant`, `inWorldDate`, `attachPageId`, `attachMarkerId`, `sourceEncounterId`, `proposedDate` and `updatedAt`. `fired` is measured against the PUBLISHED date, never the GM's clock, so it can never tell the party that a date they have not been shown has gone by.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `entry` \| `combat` \| `event` \| `deadline` \| `downtime` \| `milestone` \| `standing` | yes |  |
| `id` | string (uuid) | yes |  |
| `title` | string \| null | yes |  |
| `text` | string | yes |  |
| `sessionNumber` | integer \| null | yes |  |
| `realDate` | string \| null | yes |  |
| `inWorldLabel` | string \| null | yes |  |
| `tags` | string[] | yes |  |
| `fired` | boolean | yes | Derived against the PUBLISHED date. |
| `payload` | CodexDowntimePlayerPayload \| CodexMilestonePayload \| CodexStandingPlayerPayload \| null | yes | The player half of the kind's structured facts: downtime without `applied` (CT-10), a milestone's `{ level, reason }` unchanged (CT-8), a standing change with `factionPageId` nulled unless that faction page is revealed (CT-6). |
| `createdAt` | string (date-time) | yes |  |

### `CodexChronicleRecordProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexChronicleRecord`; a player session receives `CodexChronicleRecordPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexChronicleRecord`
- `CodexChronicleRecordPlayer`

### `CodexDeletedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `deleted` | const `true` | yes |  |

### `CodexDowntimeAppliedData`

The confirmed downtime and the moved calendar, together - they changed in one transaction and are returned in one payload so a reader cannot hold one without the other. The calendar is the GM projection; the party's published date has NOT moved.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `entry` | CodexJournalEntry | yes |  |
| `calendar` | CodexCalendar | yes |  |

### `CodexDowntimeCreatedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `entry` | CodexJournalEntry | yes |  |
| `proposedDate` | CodexInWorldDate \| null | yes | Where the campaign clock WOULD land if the GM confirms. Null when there is no current date to advance from. Nothing has moved yet. |

### `CodexDowntimeInput`

The downtime facts themselves. `applied` is deliberately not an input: confirming the clock move is a separate, explicit act (O-3), and accepting it here would let one POST both record the week off and move the campaign clock.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `who` | string | yes | Who spent the time. May be empty: downtime is often party-wide with nobody in particular to name. |
| `activity` | string | yes | What they did. May be empty, for the same reason as `who` - the record's prose carries it when the fields do not. |
| `days` | integer (0–3650) | yes | The time cost in in-world days. Ten years is already well past the point where a GM would set a date instead of counting days. |

### `CodexDowntimePayload`

CT-10: what a downtime record stores beyond its prose - who spent how many days doing what, and whether the GM has confirmed the clock move it proposes. The GM's shape. Deliberately NOT here: an `outcome`, which is prose, and this record already has two prose layers with the reveal split between them (`playerText`/`gmText`) - a third prose channel inside a JSON blob would sit outside that split.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `who` | string | yes | Who spent the time. Free text - a character, the whole party, an NPC. |
| `activity` | string | yes | What they did with it. |
| `days` | integer (≥ 0) | yes | The time cost in in-world days - what the clock moves by when the GM confirms. |
| `applied` | boolean | yes | GM workflow state: has the clock move been confirmed? NEVER present in a player projection - it is a fact about the GM's prep, not about the party's week off. |

### `CodexDowntimePlayerPayload`

A revealed downtime record as a PLAYER sees it: the three campaign facts, and `applied` allow-listed away (D11-E).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `who` | string | yes |  |
| `activity` | string | yes |  |
| `days` | integer (≥ 0) | yes |  |

### `CodexExportData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `codex` | object (free-form) | yes | Opaque backup bundle. **Not yet restorable through this API** - there is no import route, and the "round-trips via the codex import surface" this field used to claim was aspirational. |
| `exportedAt` | string (date-time) | yes |  |

### `CodexFolderCreatedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes |  |

### `CodexFolderListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `folders` | string[] | yes |  |

### `CodexFolderMovedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `moved` | integer (≥ 0) | yes |  |

### `CodexInWorldDate`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `year` | integer | yes |  |
| `month` | integer (0–23) | yes |  |
| `day` | integer (1–400) | yes |  |

### `CodexJournalEntry`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | yes |  |
| `id` | string (uuid) | yes |  |
| `playerText` | string | yes |  |
| `gmText` | string \| null | yes | GM-only note; stripped from a player projection. |
| `revealedToPlayers` | boolean | yes |  |
| `attachMarkerId` | string \| null | yes |  |
| `attachPageId` | string \| null | yes |  |
| `kind` | `note` \| `combat` \| `deadline` \| `downtime` \| `milestone` \| `standing` | yes | What the row IS. `deadline` (CT-5) and `downtime` (CT-10) are M11; `milestone` (CT-8) and `standing` (CT-6) are M12, and the database has permitted all six since M11's migration so neither needed a table rebuild. Visibility NEVER depends on this: every kind is gated by `revealedToPlayers` alone. |
| `sourceEncounterId` | integer \| null | yes |  |
| `sessionNumber` | integer \| null | yes |  |
| `realDate` | string \| null | yes |  |
| `inWorldLabel` | string \| null | yes |  |
| `calendarInstant` | number \| null | yes | Sortable absolute day index derived from the calendar. |
| `inWorldDate` | CodexInWorldDate \| null | yes |  |
| `sortKey` | number | yes |  |
| `payload` | CodexDowntimePayload \| CodexMilestonePayload \| CodexStandingPayload \| null | yes | Kind-specific structured data, discriminated by `kind`: the downtime payload, the milestone payload, the standing payload, and null for the other three kinds. GM-only - the player journal projection carries no payload at all (a revealed record's facts are read on the chronicle). A DEADLINE deliberately has none: its text is the "what" and its `inWorldDate` is the "when". |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `CodexJournalEntryData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `entry` | CodexJournalEntry | yes |  |

### `CodexJournalEntryPlayer`

A journal entry as a PLAYER receives it - the mini-timeline row on a page or a pin. The player text (renamed `text`), and no `gmText`, `revealedToPlayers`, attachments, `sourceEncounterId`, `payload`, `sortKey`, dating internals or `updatedAt`. A downtime's facts and a deadline's fired state are read on the CHRONICLE, which carries them; a player-facing field the player Codex does not read is a field with no reason to travel.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `text` | string | yes | The entry's `playerText`. |
| `kind` | `note` \| `combat` \| `deadline` \| `downtime` \| `milestone` \| `standing` | yes | Visibility NEVER depends on this: every kind is gated by `revealedToPlayers` alone. |
| `sessionNumber` | integer \| null | yes | Nulled when a session record carries this number and has not been revealed - a session's very existence is GM information. |
| `realDate` | string \| null | yes |  |
| `inWorldLabel` | string \| null | yes |  |
| `tags` | string[] | yes |  |
| `createdAt` | string (date-time) | yes |  |

### `CodexJournalEntryProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexJournalEntry`; a player session receives `CodexJournalEntryPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexJournalEntry`
- `CodexJournalEntryPlayer`

### `CodexJournalListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `entries` | CodexJournalEntryProjected[] | yes |  |

### `CodexLinkEdge`

One `[[wiki link]]` edge between two pages. Deliberately narrower than a typed relationship: a wiki link has no id, no type and no authored timestamp - it is simply a mention in a body - so the pair of page ids IS the edge, and one edge is emitted per ordered pair however many times the link is written. Which BODY the link came from is store-side bookkeeping used to decide player visibility and is never carried here.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `fromPageId` | string (uuid) | yes | The page whose body carries the link. |
| `toPageId` | string (uuid) | yes | The linked page. Always a page that exists - a link to an unknown title has no node and is omitted. |

### `CodexLinkEdgeListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `links` | CodexLinkEdge[] | yes |  |

### `CodexMap`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | yes |  |
| `id` | string (uuid) | yes |  |
| `assetId` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `kind` | `battlemap` \| `regional` \| `world` | yes |  |
| `parentMapId` | string \| null | yes | Parent map in the atlas tree; for a player, nulled when the parent is not itself revealed. |
| `revealedToPlayers` | boolean | yes |  |
| `sortKey` | number | yes |  |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `CodexMapData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `map` | CodexMap | yes |  |

### `CodexMapListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `maps` | CodexMapProjected[] | yes |  |

### `CodexMapPlayer`

An atlas map as a PLAYER receives it. `parentMapId` survives only when the parent is itself revealed - otherwise a revealed child would leak the id of a still-secret ancestor.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `assetId` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `kind` | `battlemap` \| `regional` \| `world` | yes |  |
| `parentMapId` | string \| null | yes | Nulled when the parent map is not itself revealed. |
| `tags` | string[] | yes |  |

### `CodexMapProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexMap`; a player session receives `CodexMapPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexMap`
- `CodexMapPlayer`

### `CodexMarker`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags` | string[] | yes |  |
| `id` | string (uuid) | yes |  |
| `mapId` | string (uuid) | yes |  |
| `x` | number | yes |  |
| `y` | number | yes |  |
| `iconId` | string | yes |  |
| `iconColor` | string (pattern) | yes |  |
| `label` | string \| null | yes |  |
| `revealedToPlayers` | boolean | yes |  |
| `pageIds` | string (uuid)[] | yes | Linked pages; for a player, filtered to the revealed subset. |
| `subMapId` | string \| null | yes | Drill-down sub-map; nulled for a player when that map is not revealed. |
| `sceneIds` | string (uuid)[] | yes | Linked prepared scenes; GM-only, stripped from a player projection. |
| `actorId` | string \| null | yes |  |
| `isParty` | boolean | yes | CT-7: is this the party's pin? At most one marker in the whole atlas carries it. PLAYER-FACING - the party pin is for the players, and it is the ONE key M12 adds to the player marker projection - but it grants no visibility of its own: a hidden party pin, or one on a hidden map, is exactly as hidden as any other pin, because `isParty` is not part of any reveal predicate anywhere. |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `CodexMarkerData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `marker` | CodexMarker | yes |  |

### `CodexMarkerListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `markers` | CodexMarkerProjected[] | yes |  |

### `CodexMarkerPlayer`

A pin as a PLAYER receives it: no `sceneIds`, no `actorId`, no `revealedToPlayers`, no timestamps, and page/sub-map links only when those targets are themselves revealed. `isParty` IS here - the party pin is for the players - but it grants no visibility: a hidden party pin, or one on a hidden map, is exactly as hidden as any other.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `mapId` | string (uuid) | yes |  |
| `x` | number | yes |  |
| `y` | number | yes |  |
| `iconId` | string | yes |  |
| `iconColor` | string (pattern) | yes |  |
| `label` | string \| null | yes |  |
| `pageIds` | string (uuid)[] | yes | Filtered to the revealed subset. |
| `subMapId` | string \| null | yes | Nulled when that map is not revealed. |
| `tags` | string[] | yes |  |
| `isParty` | boolean | yes |  |

### `CodexMarkerProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexMarker`; a player session receives `CodexMarkerPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexMarker`
- `CodexMarkerPlayer`

### `CodexMilestoneInput`

CT-8: the milestone facts themselves. Exactly two - the spec says "milestone / level history … no XP arithmetic", so there is no XP total, no threshold and no next level.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `level` | integer (1–20) | yes | The level the party REACHED. 1-20, the repo's existing character-level bound. |
| `reason` | string | no | Why, in one line. Optional and may be empty: "we hit 5" with the why in the record's own prose is a legitimate body, and a minimum here would reject a state the composer can reach. Defaults to an empty string. |

### `CodexMilestonePayload`

CT-8: what a MILESTONE record carries beyond its prose - the level the party reached, and why. Identical for both audiences: a party knows its own level, and a revealed milestone with its two facts removed would be a dated row that says nothing. There is no GM-only half here at all; a milestone needing one writes it in the record's `gmText`, like every other journal row. No XP: progression is milestone-based by design and this record carries no arithmetic.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `level` | integer (1–20) | yes | The level REACHED, not a step. A delta would make the party's current level a sum over the whole timeline that a single deleted record silently changes. |
| `reason` | string | yes | Why, in one line ("cleared the crypt"). May be empty - the record's own prose carries it when this does not. |

### `CodexPage`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `title` | string | yes |  |
| `entityType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` | yes |  |
| `fields` | object (free-form) | yes |  |
| `gmFields` | object (free-form) | yes | GM-only fields; never present in a player projection. |
| `folder` | string \| null | yes |  |
| `tags` | string[] | yes |  |
| `revealedToPlayers` | boolean | yes |  |
| `bannerAssetId` | string \| null | yes |  |
| `playerBody` | string | yes | Player-facing markdown body. |
| `gmBody` | string | yes | GM-only markdown body; stripped from a player projection. |
| `inWorldLabel` | string \| null | yes | Display form of the in-world date, derived from the calendar. |
| `calendarInstant` | number \| null | yes | Sortable absolute day index derived from the calendar. |
| `inWorldDate` | CodexInWorldDate \| null | yes | The raw in-world date; the source of truth the other two are derived from. |
| `rev` | integer (≥ 0) | yes |  |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `CodexPageData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | CodexPage | yes |  |

### `CodexPageDocumentData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | CodexPageProjected | yes |  |
| `backlinks` | CodexBacklink[] | yes |  |
| `relationships` | CodexRelationship[] | yes |  |

### `CodexPageListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pages` | CodexPageSummaryProjected[] | yes |  |

### `CodexPagePlayer`

A page as a PLAYER receives it: the player body (renamed `body` - the layer prefix only means something when there are two layers), the player-facing `fields`, and no `gmBody`, `gmFields`, `rev`, `revealedToPlayers` or `createdAt`. An unrevealed page is never projected at all - it 404s.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `title` | string | yes |  |
| `entityType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` | yes |  |
| `fields` | object (free-form) | yes | The player-facing typed entity fields. `gmFields` has no player form. |
| `folder` | string \| null | yes |  |
| `tags` | string[] | yes |  |
| `body` | string | yes | The page's `playerBody`. |
| `bannerAssetId` | string \| null | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `CodexPageProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexPage`; a player session receives `CodexPagePlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexPage`
- `CodexPagePlayer`

### `CodexPageRevision`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer (≥ 1) | yes |  |
| `pageId` | string (uuid) | yes |  |
| `rev` | integer (≥ 0) | yes |  |
| `title` | string | yes |  |
| `playerBody` | string | yes |  |
| `gmBody` | string | yes |  |
| `bannerAssetId` | string \| null | yes |  |
| `tags` | string[] | yes |  |
| `authoredAt` | string (date-time) | yes |  |
| `authorTag` | string | yes |  |

### `CodexPageSummary`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `title` | string | yes |  |
| `entityType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` | yes |  |
| `fields` | object (free-form) | yes | Player-facing typed entity fields (free-form key/value). |
| `folder` | string \| null | yes |  |
| `tags` | string[] | yes |  |
| `revealedToPlayers` | boolean | yes |  |
| `bannerAssetId` | string \| null | yes |  |
| `inWorldLabel` | string \| null | yes | Display form of the in-world date, derived from the calendar. |
| `calendarInstant` | number \| null | yes | Sortable absolute day index derived from the calendar. |
| `inWorldDate` | CodexInWorldDate \| null | yes | The raw in-world date; the source of truth the other two are derived from. |
| `rev` | integer (≥ 0) | yes |  |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `CodexPageSummaryPlayer`

A page summary as a PLAYER receives it. A strict subset of the GM summary: no `fields`, no dating trio, no `rev`, no `revealedToPlayers`, no `createdAt`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `title` | string | yes |  |
| `entityType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` | yes |  |
| `folder` | string \| null | yes |  |
| `tags` | string[] | yes |  |
| `bannerAssetId` | string \| null | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `CodexPageSummaryProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexPageSummary`; a player session receives `CodexPageSummaryPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexPageSummary`
- `CodexPageSummaryPlayer`

### `CodexPreviewSessionData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | yes |  |

### `CodexQuest`

One quest: a thread the party is pulling on, and whether it is still open. Two layers in one record, like a page's `playerBody`/`gmBody` - `playerBody` is what the table may read and `gmBody` is the GM's own half (who is really behind it, what happens if they fail). A player projection of a REVEALED quest is exactly `id`, `title`, `status`, `body` (the player body, renamed the way a page's `playerBody` becomes `body`), `objectives`, and `entityIds`; everything else here is GM-only. `status` is the one field that is player-facing here but GM-only on a session: "what is still open" is the whole point of the feature, and a revealed quest whose state the player cannot see is useless. Objectives are the Codex's first ORDERED mutable list - the array is stored and returned exactly as given, never sorted, deduped, or keyed by position across a write.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `title` | string | yes | The quest's name - the line that appears on the dashboard's open-quests card. |
| `status` | `active` \| `completed` \| `failed` | yes | Player-facing (unlike a session's `status`). Queryable server-side: the dashboard counts the `active` ones. |
| `playerBody` | string | yes | The player-facing description (markdown). Reaches a revealed quest's player projection as `body`. |
| `gmBody` | string | yes | GM-only notes (markdown). NEVER present in a player projection, revealed or not - revealing a quest publishes its player body, never its GM body. It is also kept out of the player search index, because a HIT on a GM-only phrase leaks the phrase even when the body itself is never returned. |
| `objectives` | CodexQuestObjective[] | yes | The ordered checklist. Player-facing in full - order is content, not incidental. |
| `entityIds` | string (uuid)[] | yes | Codex pages this quest involves (the NPC who gave it, the location it points at). Player-facing, but filtered to the revealed subset - the same rule a marker's `pageIds` follows, so a quest can never name a page the player cannot open. |
| `revealedToPlayers` | boolean | yes | GM-only field; absent from a player projection (a player only ever receives revealed quests). |
| `rev` | integer (≥ 0) | yes | GM-only optimistic-concurrency counter; absent from a player projection. Pass it back as `expectedRev` to reject a stale edit. |
| `createdAt` | string (date-time) | yes | GM-only; absent from a player projection. |
| `updatedAt` | string (date-time) | yes | GM-only; absent from a player projection. Moves on an edit, but NOT on a reveal - a reveal is not an edit. |

### `CodexQuestData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `quest` | CodexQuest | yes |  |

### `CodexQuestListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `quests` | CodexQuestProjected[] | yes |  |

### `CodexQuestObjective`

One tickable step of a quest. Deliberately exactly two keys - a shape richer than `{ text, done }` (assignees, due dates, sub-objectives) is unapproved scope. The text is PLAYER-FACING: it lives beside `playerBody`, never beside `gmBody`, so a GM-only detail belongs in the quest's GM body and never in an objective.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `text` | string | yes | What the party has to do, in one line. Deliberately NOT `minLength: 1`: the checklist's real flow is add-a-row-then-type-into-it and the editor autosaves the whole draft, so a minimum would reject the first save after "Add item" — and dropping the blank row server-side would renumber the list under the GM's cursor. A blank objective is a legitimate transient state, not a malformed one. The server accepts it; this says so rather than publishing a rule it does not enforce. |
| `done` | boolean | yes |  |

### `CodexQuestPlayer`

A quest as a PLAYER receives it. `status` is KEPT - this is the one place a quest differs from a session, because "what is still open" is the entire point of the feature. `gmBody` and `rev` never travel, and `entityIds` is filtered to the revealed subset so a quest can never name a page the player cannot open.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `title` | string | yes |  |
| `status` | `active` \| `completed` \| `failed` | yes |  |
| `body` | string | yes | The quest's `playerBody`. |
| `objectives` | CodexQuestObjective[] | yes |  |
| `entityIds` | string (uuid)[] | yes | Filtered to the revealed subset. |

### `CodexQuestProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexQuest`; a player session receives `CodexQuestPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexQuest`
- `CodexQuestPlayer`

### `CodexQuestProjectedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `quest` | CodexQuestProjected | yes |  |

### `CodexRelationship`

A relationship seen from one page: the OTHER endpoint resolved plus which way the edge points.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `type` | string | yes |  |
| `direction` | `out` \| `in` | yes |  |
| `otherPageId` | string (uuid) | yes |  |
| `otherTitle` | string | yes |  |
| `otherType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` | yes |  |
| `otherRevealed` | boolean | yes |  |

### `CodexRelationshipData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `relationship` | CodexRelationshipEdge | yes |  |

### `CodexRelationshipEdge`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `fromPageId` | string (uuid) | yes |  |
| `toPageId` | string (uuid) | yes |  |
| `type` | string | yes |  |
| `createdAt` | string (date-time) | yes |  |

### `CodexRelationshipEdgeListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `relationships` | CodexRelationshipEdge[] | yes |  |

### `CodexRevealAudit`

CT-9: everything the party can currently see across every reveal surface in the Codex. A READ-ONLY AGGREGATION of the existing player projections - it restates no visibility rule and writes nothing, which is why it agrees with the player-facing endpoints exactly rather than approximately.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sections` | CodexRevealAuditSection[] | yes | All seven surfaces, in a fixed order, always all present. |
| `revealed` | integer (≥ 0) | yes | Total records the party can see, across every surface. |
| `total` | integer (≥ 0) | yes | Total records that exist, across every surface. |

### `CodexRevealAuditData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `audit` | CodexRevealAudit | yes |  |

### `CodexRevealAuditRow`

One record the party can currently see.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `page` \| `map` \| `marker` \| `journal` \| `session` \| `quest` \| `standing` | yes | Which reveal surface this row belongs to - and therefore which existing reveal route un-reveals it. |
| `id` | string (uuid) | yes | The record's OWN id, which is exactly the id that kind's existing reveal route takes. For a `standing` row this is the FACTION PAGE id, because `POST /codex/standing/{factionPageId}/reveal` is addressed that way. |
| `title` | string | yes | One line naming the record, taken from the record's own PLAYER projection - a page title, a map name, a marker label, a bounded excerpt of a journal entry's player text, "Session 4", a quest title, a faction name. Empty string when the record has no name (an unlabelled pin). |
| `journalKind` | `note` \| `combat` \| `deadline` \| `downtime` \| `milestone` \| `standing` \| null | yes | WHICH kind of journal record this is - the same six-value vocabulary `CodexJournalEntry.kind` uses. Set on every `kind: "journal"` row and `null` on all six other kinds, present either way so no consumer branches on key presence. Render it as a badge beside `title`, never by parsing `title`: the title is the record's own prose whenever it has any, and only names the kind when the record is silent. |

### `CodexRevealAuditSection`

One reveal surface's report. ALWAYS present, empty ones included with `revealed: 0` and `rows: []` - "nothing is revealed here" and "this did not load" must not look the same.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `page` \| `map` \| `marker` \| `journal` \| `session` \| `quest` \| `standing` | yes |  |
| `revealed` | integer (≥ 0) | yes | How many records of this kind the party can CURRENTLY SEE - which is not always the same as how many carry a reveal flag. A marker flagged revealed on a hidden map is not counted, because the player-facing marker read does not return it either. |
| `total` | integer (≥ 0) | yes | How many exist at all, so "3 of 40" reads as deliberate rather than as an empty screen. |
| `rows` | CodexRevealAuditRow[] | yes |  |

### `CodexRevisionHistoryInput`

The two SETTABLE revision-history knobs, and the difference between them is load-bearing: `enabled: false` writes NO new revisions at all, while `windowMinutes: 0` writes one for EVERY save. `0` is therefore not "off" - it is the behaviour every codex had before this setting existed - and the two are separate fields so nothing has to guess which a zero meant. Neither setting ever DELETES a revision: switching history off stops new checkpoints and nothing else, and the existing history stays listable and restorable, because disabling a feature must not destroy the GM's only undo. Deleting is a separate, explicit act (`DELETE /codex/page-revisions`).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | yes | Whether a page save may write a new revision at all. Default `true` - every existing codex upgrades with history on, exactly as it was. |
| `windowMinutes` | integer (0–10080) | yes | Coalescing window. A save whose page already has a checkpoint younger than this writes no new one, so at most this much authoring can be lost. Measured against WHEN THE CHECKPOINTED CONTENT WAS AUTHORED, not when its row was written, which is what makes the guarantee hold across an idle gap as well as during continuous work. `0` keeps every save; the 10080 ceiling is one week of minutes, past which the window stops coalescing a work session and starts meaning "keep almost nothing" - which `enabled: false` already says more honestly. The owner's default is 90. |

### `CodexRevisionHistorySettings`

How much page version history the codex keeps, and what keeping it costs. The two knobs are exactly `CodexRevisionHistoryInput`'s; the two usage figures are server-computed and READ-ONLY, and they are a superset here rather than a second object because a settings screen wants the cost beside the control that changes it.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | yes | Whether a page save may write a new revision at all. |
| `windowMinutes` | integer (0–10080) | yes | Coalescing window in minutes; `0` keeps every save. See `CodexRevisionHistoryInput.windowMinutes`. |
| `versionCount` | integer (≥ 0) | yes | How many revision rows exist, across the WHOLE codex rather than one page - the same set `DELETE /codex/page-revisions` operates on. Read-only: it is a fact about the table, so it is never accepted on a write. |
| `versionBytes` | integer (≥ 0) | yes | Roughly how much TEXT that history holds: the summed length of the content columns a revision duplicates from its page (both bodies, both field maps, the title and the tags). Deliberately APPROXIMATE and deliberately not disk usage or the export's serialized size - it exists to be compared against itself before and after a trim, and a figure precise enough to invite comparison against the sqlite file's size would be a figure that disagrees with it. Render it as "about 8.0 MB of text". Read-only, like `versionCount`. |

### `CodexRevisionListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revisions` | CodexPageRevision[] | yes |  |

### `CodexRevisionsDeletedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `deleted` | integer (≥ 0) | yes | How many revision rows were actually removed - the database's own count, not what was requested. |

### `CodexSearchData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `hits` | CodexSearchHit[] | yes | The one ranked result list, all record kinds. |

### `CodexSearchHit`

One row of the single suite-wide result list. Uniform across record types - every key is present on every kind, null where it does not apply, so a consumer never branches on key presence. Deliberately narrow: enough to render a row and open the record, and nothing more. A player's hit list is gated by exactly the reveal predicate that kind's LIST endpoint applies (a marker additionally requires ITS MAP to be revealed), and a journal `title` is excerpted from the player text alone.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `page` \| `journal` \| `map` \| `marker` \| `quest` | yes | Which record matched; decides where the client navigates. |
| `id` | string (uuid) | yes |  |
| `title` | string | yes | Page title, map name, marker label, or quest title; for a journal entry, a bounded one-line excerpt of its text (empty string when the record has no name). |
| `tags` | string[] | yes | Always present, so no consumer branches on key presence: empty for a kind that carries no tags at all (a quest). |
| `entityType` | `note` \| `character` \| `location` \| `faction` \| `item` \| `species` \| `religion` \| `event` \| null | yes | The page's entity type; null for every other kind. |
| `mapId` | string \| null | yes | The map a marker sits on; null for every other kind. Never names an unrevealed map, because a player only ever receives a marker hit when that map is revealed. |

### `CodexSession`

One play session: the GM's prep for an evening at the table, and the recap of it afterwards. Two layers in one record, like a page's `playerBody`/`gmBody` - `recapBody` is the player-facing half and `prepBody` is the GM's. A player projection is deliberately narrow: a revealed session reduces to EXACTLY `id`, `sessionNumber`, `realDate`, and `recap` (the recap body, renamed the way a page's `playerBody` becomes `body` and a journal entry's `playerText` becomes `text`). Everything else here is GM-only. `sessionNumber` is the join to the journal: entries carry the same number, which is what the journal's by-session lens groups on - so it is unique across sessions, and a number already in use is refused rather than silently making a group ambiguous.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `sessionNumber` | integer \| null | yes | "Session 12" - the number journal entries are stamped with. Unique across sessions; null until the GM assigns one. |
| `realDate` | string \| null | yes | The real-world date the group played, as the GM typed it. Free text, not a calendar instant - a session sits on the real calendar, never the world's, which is why sessions are their own route and not rows on `/codex/timeline`. |
| `attendees` | string[] | yes | Who was at the table. GM-only; absent from a player projection. |
| `prepBody` | string | yes | GM-only prep notes for the session (markdown). NEVER present in a player projection, revealed or not - revealing a session publishes its recap, never its prep. |
| `recapBody` | string | yes | The player-facing recap (markdown). Reaches a revealed session's player projection as `recap`. |
| `revealedToPlayers` | boolean | yes | GM-only field; absent from a player projection (a player only ever receives revealed sessions). |
| `status` | `planned` \| `played` | yes | GM-only; absent from a player projection. |
| `rev` | integer (≥ 0) | yes | GM-only optimistic-concurrency counter; absent from a player projection. Pass it back as `expectedRev` to reject a stale edit. |
| `createdAt` | string (date-time) | yes | GM-only; absent from a player projection. |
| `updatedAt` | string (date-time) | yes | GM-only; absent from a player projection. Moves on an edit, but NOT on a reveal or an activate - neither is an edit. |

### `CodexSessionActiveData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `activeSessionId` | string \| null | yes |  |

### `CodexSessionData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session` | CodexSession | yes |  |

### `CodexSessionListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sessions` | CodexSessionProjected[] | yes |  |
| `activeSessionId` | string \| null | yes | The session new journal entries are stamped from. GM-only: always `null` for a player, because the active session is frequently the unrevealed one being prepped and naming it would leak that it exists. |

### `CodexSessionPlayer`

A session as a PLAYER receives it - the tightest projection in the Codex, and every omission is a decision. `prepBody` is the GM's plan for the evening and has no player form; `attendees` is real-world personal data; `status` is the GM's own scheduling state; `rev` is the editor's conflict token. `recapBody` arrives renamed `recap`, because with only one layer left the prefix means nothing.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `sessionNumber` | integer \| null | yes |  |
| `realDate` | string \| null | yes |  |
| `recap` | string | yes | The session's `recapBody`. |

### `CodexSessionProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexSession`; a player session receives `CodexSessionPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexSession`
- `CodexSessionPlayer`

### `CodexSessionProjectedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `session` | CodexSessionProjected | yes |  |

### `CodexSettings`

Every codex-WIDE setting as a READER sees it, nested by area, including the read-only usage figures. The nesting by area is what gives a later codex-wide setting a home without inventing fields for it today: `codex_meta` is the codex's singleton settings row, and this is that row as a caller sees it.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revisionHistory` | CodexRevisionHistorySettings | yes |  |
| `autosave` | CodexAutosaveSettings | yes |  |

### `CodexSettingsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `settings` | CodexSettings | yes |  |

### `CodexStanding`

CT-6: where the party stands with ONE faction, GM view. Four facts, and what is absent is the point: no HISTORY (every change writes a `kind='standing'` chronicle record instead, so the timeline is the one history in this codex rather than a second one), no `rev` (a standing is a number set in one action - there is no draft to go stale), and no cached faction TITLE (the live page is the one name, so a rename cannot leave a stale copy behind). A player projection of a revealed standing is exactly `factionPageId` and `value`, and only when the faction page is revealed too.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `factionPageId` | string (uuid) | yes | The faction page. UNIQUE across standings - one row per faction - which is why every standing route is addressed by this id rather than by `id`. |
| `value` | integer (-100–100) | yes | SIGNED: -100 hostile, 0 neutral, +100 allied. Signed because a faction can be actively against the party, which an unsigned favour scale cannot say. The WORD a reader shows beside the bar is a presentation of this number and is deliberately not stored. |
| `revealedToPlayers` | boolean | yes | GM-only field; absent from a player projection (a player only ever receives revealed standings). |
| `createdAt` | string (date-time) | yes | GM-only; absent from a player projection. |
| `updatedAt` | string (date-time) | yes | GM-only; absent from a player projection. "When did this move" is a question the chronicle answers, with the reason attached. |

### `CodexStandingData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `standing` | CodexStanding | yes |  |

### `CodexStandingListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `standing` | CodexStandingProjected[] | yes |  |

### `CodexStandingPayload`

CT-6: what a STANDING record carries - which faction, how much it MOVED, and why. The GM's shape. `delta` and not the resulting value, deliberately: the `codex_standing` table says where things stand and this says what happened, so a deleted record cannot leave a history that no longer adds up to the table.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `factionPageId` | string (uuid) | yes | The faction page this record is about. A plain id with no foreign key behind it: deleting a faction page removes its standing ROW but must leave its history standing, so a reader resolves this defensively - a missing page is a name it cannot show, not an error. |
| `delta` | integer | yes | How far the standing moved, signed. `-15` reads "fell fifteen". |
| `reason` | string | yes | Why, in one line. May be empty. |

### `CodexStandingPlayer`

A standing as a PLAYER receives it: two keys. The row's own `id` is noise (a player never addresses a standing, and `factionPageId` is unique), and "when did this last move" is a question the chronicle answers with the reason attached. A standing reaches a player only when the standing AND its faction page are both revealed.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `factionPageId` | string (uuid) | yes |  |
| `value` | integer (-100–100) | yes | Signed -100..100. It travels unchanged: a revealed standing whose number the player cannot see would say nothing. |

### `CodexStandingPlayerPayload`

A revealed standing record as a PLAYER sees it. `delta` and `reason` travel WHOLE: the delta is the entire point of a record the GM chose to publish ("the Harpers fell fifteen"), and a published record with its number stripped would say that something changed with someone. `factionPageId` is the one field that is conditional - it is nulled unless that page is itself revealed, the same filter a quest's `entityIds` and a map's `parentMapId` pass, so a published record can never advertise a faction the party has never met. A record whose faction page is NOT revealed is not projected to a player at all - it is hidden whole, exactly as the standing TABLE row is: a standing record carries no prose of its own (the store writes an empty player text), so a row with the id stripped would still tell the party that an unnamed faction moved and why.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `factionPageId` | string \| null | yes | The faction page, or NULL when that page is not revealed to players. |
| `delta` | integer | yes |  |
| `reason` | string | yes |  |

### `CodexStandingProjected`

Role-projected. A GM session or a `codex:read` credential receives `CodexStanding`; a player session receives `CodexStandingPlayer`, the revealed-only projection. Exactly one branch matches any response body.

One of the following:

- `CodexStanding`
- `CodexStandingPlayer`

### `ContentBackgroundsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `backgrounds` | object[] | yes |  |
| `backgrounds[].id` | string (pattern) | yes |  |
| `backgrounds[].name` | string | yes |  |
| `backgrounds[].source` | `srd` \| `homebrew` | yes |  |
| `backgrounds[].summary` | string \| null | yes |  |
| `backgrounds[].description` | string \| null | yes |  |
| `backgrounds[].abilityOptions` | object \| null | yes | SRD 5.2.1 ability increases: which abilities, and the legal distributions (+2/+1 or +1/+1/+1) as data |
| `backgrounds[].originFeatId` | string \| null | yes | The origin feat this background grants, keyed into the feat catalog |
| `backgrounds[].skillProficiencies` | string (pattern)[] | yes |  |
| `backgrounds[].skillChoices` | object \| null | yes | "Choose N skills" where the background offers one; null otherwise (fixed grants stay in skillProficiencies) |
| `backgrounds[].toolProficiencies` | string (pattern)[] | yes |  |
| `backgrounds[].toolChoices` | object \| null | yes | "Choose N tools" where the background offers one; null otherwise |
| `backgrounds[].languages` | string (pattern)[] | yes |  |
| `backgrounds[].languageChoices` | object \| null | yes | "Choose N languages" where the background offers one; null otherwise |
| `backgrounds[].startingEquipmentOptions` | object[] | yes | Starting-equipment bundles with their items and the "or take N gp" alternative; the chosen option's id is recorded in the character's choice ledger |
| `backgrounds[].features` | ContentFeature[] | yes |  |
| `attribution` | string | yes |  |

### `ContentClassesData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `classes` | object[] | yes |  |
| `classes[].id` | string (pattern) | yes |  |
| `classes[].name` | string | yes |  |
| `classes[].source` | `srd` \| `homebrew` | yes |  |
| `classes[].summary` | string \| null | yes |  |
| `classes[].description` | string \| null | yes |  |
| `classes[].hitDie` | `d4` \| `d6` \| `d8` \| `d10` \| `d12` | yes | The multiclass hit-dice pool keys on this |
| `classes[].statPriority` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes | All six abilities, best first - the random generator's core input, as data rather than a hardcoded table |
| `classes[].primaryAbilities` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes |  |
| `classes[].savingThrows` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes |  |
| `classes[].skillChoiceCount` | integer (0–10) | yes | How many entries of skillChoices the character picks at level 1 |
| `classes[].skillChoices` | string (pattern)[] | yes |  |
| `classes[].armorProficiencies` | string (pattern)[] | yes | Granted armor training, as open slugs (light, medium, heavy, shields) |
| `classes[].weaponProficiencies` | string (pattern)[] | yes | Granted weapon training - a group (simple, martial) or a single weapon id |
| `classes[].toolProficiencies` | string (pattern)[] | yes |  |
| `classes[].toolChoices` | object \| null | yes | "Choose N tools" where the class offers one; null otherwise |
| `classes[].multiclassProficiencies` | object \| null | yes | Proficiencies gained when this class is taken as a MULTICLASS (narrower than the level-1 set); null when the record declares none |
| `classes[].multiclassPrerequisites` | object \| null | yes | Ability minimums for multiclassing INTO this class; mode "any" covers "STR 13 or DEX 13". null = always allowed. Display data - the server re-validates |
| `classes[].subclassLevel` | integer (1–20) | yes |  |
| `classes[].subclassLabel` | string \| null | yes | What this class calls its subclass ("Martial Archetype") |
| `classes[].asiLevels` | integer (1–20)[] | yes | Levels granting an Ability Score Improvement, or a feat instead |
| `classes[].spellcastingAbility` | string \| null | yes | Ability slug for this class's spellcasting; null for a non-caster. Per class, so Paladin CHA + Wizard INT is expressible |
| `classes[].spellcastingProgression` | `full` \| `half` \| `third` \| `pact` \| `null` | yes | How this class's levels count toward the shared multiclass caster level |
| `classes[].spellcasting` | object \| null | yes | The full spellcasting header (ability, known/prepared, ritual, focus, progression, spell-list id); null for a non-caster. The flat spellcastingAbility/spellcastingProgression mirror it for existing readers |
| `classes[].levelTable` | object[] | yes | The class's full 20-row printed progression: slot columns, cantrips/spells known, the prepared-spell formula, and the named resources that grow with level (Second Wind 2 to 4, Rage 3, Sneak Attack 3d6) |
| `classes[].startingEquipmentOptions` | object[] | yes | Starting-equipment bundles with their items and the "or take N gp" alternative; the chosen option's id is recorded in the character's choice ledger |
| `classes[].features` | ContentFeature[] | yes |  |
| `attribution` | string | yes |  |

### `ContentConditionsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `conditions` | object[] | yes |  |
| `conditions[].id` | string | yes |  |
| `conditions[].name` | string | yes |  |
| `conditions[].description` | string | yes |  |
| `attribution` | string | yes | The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content |

### `ContentEquipmentData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `equipment` | object[] | yes |  |
| `equipment[].id` | string | yes |  |
| `equipment[].name` | string | yes |  |
| `equipment[].category` | string | yes | Open slug: weapon, armor, shield, ammunition, adventuring-gear, tool, equipment-pack, consumable, focus, wondrous, or any homebrew kind. Not a closed set - derive groupings from the data. |
| `equipment[].costGp` | number \| null | yes |  |
| `equipment[].weightLb` | number \| null | yes |  |
| `equipment[].description` | string \| null | yes |  |
| `equipment[].weapon` | object \| null | yes | Populated for weapons only |
| `equipment[].armor` | object \| null | yes | Populated for armor and shields only |
| `attribution` | string | yes |  |

### `ContentFeatsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `feats` | object[] | yes |  |
| `feats[].id` | string (pattern) | yes |  |
| `feats[].name` | string | yes |  |
| `feats[].source` | `srd` \| `homebrew` | yes |  |
| `feats[].summary` | string \| null | yes |  |
| `feats[].description` | string \| null | yes |  |
| `feats[].category` | string (pattern) | yes | Open slug (origin / general / fighting-style / epic-boon) |
| `feats[].repeatable` | boolean | yes |  |
| `feats[].prerequisiteLevel` | integer \| null | yes |  |
| `feats[].prerequisiteAbilities` | object[] | yes |  |
| `feats[].prerequisiteRequires` | string (pattern)[] | yes | Proficiency or feature slugs the character must already have |
| `feats[].prerequisiteText` | string \| null | yes | Anything not modeled above, printed for the player. The SERVER decides whether a prerequisite is met - never the client |
| `feats[].feature` | ContentFeature | yes | A feat IS a feature plus catalog metadata - hence one record, not a list |
| `attribution` | string | yes |  |

### `ContentFeature`

The browse-and-pick projection of a bundle FeatureRecord. Prose is the display source of truth; a feature's structured riders (granted actions, effects, modifiers, limited uses) stay server-side - the server applies them when it builds the character, so the wizard never becomes a second rules engine.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `name` | string | yes |  |
| `level` | integer \| null | yes | The class/subclass level the feature lands at; null when it is not level-gated (species traits, feats) |
| `description` | string | yes |  |
| `tags` | string (pattern)[] | yes | Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity) |
| `choice` | ContentFeatureChoice \| null | yes | The pick this feature asks the player to make - each one writes a row in the character's choice-provenance ledger. null when the feature grants without asking. |
| `grantedAtLevels` | integer (1–20)[] | yes | Every level at which the owning class's table grants this feature - the authoritative repeat count. A feature granted at 4, 8, 12 and 16 asks its choice FOUR times and the server's capacity is choose x grants, so a client that ignores this offers too few picks and the build is rejected at creation. Empty when no class level table grants the feature (species traits, feats, subclass features). |

### `ContentFeatureChoice`

One pick a feature asks for. Options arrive either as plain ids in `from`, as an open catalog slug in `fromCatalog`, or as inline `options` carrying their own name and any second-order pick.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string (pattern) | yes |  |
| `choose` | integer (1–10) | yes |  |
| `from` | string (pattern)[] | yes | Explicit option ids; empty when fromCatalog names an open list instead |
| `fromCatalog` | string \| null | yes | An open catalog slug resolved at pick time (skills, feats, wizard-spells) |
| `maxSpellLevel` | integer \| null | yes | Ceiling on a spell pick's level (Evocation Savant: 2; Magic Initiate: 0, i.e. cantrips only). null when the pick has no ceiling — a picker that ignores it offers spells the server then rejects |
| `options` | ContentFeatureOption[] | yes | Inline options with their authored names and any nested pick; empty when the options are plain ids or come from a catalog |

### `ContentFeatureOption`

One inline option of a feature's pick. Carries its authored name (an id alone would force the client to titleize) and any SECOND-ORDER pick it owes - Cleric Divine Order's Thaumaturge grants an extra cantrip, so choosing it opens another choice. Riders stay server-side.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `name` | string | yes |  |
| `description` | string | yes |  |
| `choice` | ContentFeatureChoice \| null | yes | A nested pick this option owes. Bounded at one level: a nested choice never carries its own options. |

### `ContentMonsterActionsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `actions` | object (free-form)[] | yes |  |

### `ContentMonsterSheetData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `definition` | object (free-form) | yes | The full canonical ActorDefinition |

### `ContentMonstersData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `monsters` | object[] | yes |  |
| `monsters[].id` | string | yes |  |
| `monsters[].name` | string | yes |  |
| `monsters[].challengeRating` | number | yes |  |
| `monsters[].type` | string | yes |  |
| `monsters[].size` | string | yes |  |
| `monsters[].armorClass` | integer | yes |  |
| `monsters[].hitPoints` | integer | yes |  |
| `attribution` | string | yes |  |

### `ContentNamesData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `names` | object[] | yes |  |
| `names[].speciesId` | string (pattern) | yes |  |
| `names[].source` | `srd` \| `homebrew` | yes |  |
| `names[].pools` | object[] | yes | Ordered by the data, never by a hardcoded client list |
| `attribution` | string | yes |  |

### `ContentSkillsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `skills` | object[] | yes |  |
| `skills[].id` | string | yes |  |
| `skills[].name` | string | yes |  |
| `skills[].description` | string | yes |  |
| `skills[].ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` \| `null` | yes | The ability this skill's check uses; null only for a record that has not declared one yet |
| `attribution` | string | yes | The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content |

### `ContentSpeciesData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `species` | object[] | yes |  |
| `species[].id` | string (pattern) | yes |  |
| `species[].name` | string | yes |  |
| `species[].source` | `srd` \| `homebrew` | yes |  |
| `species[].summary` | string \| null | yes |  |
| `species[].description` | string \| null | yes |  |
| `species[].sizes` | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan`[] | yes | A list because several 2024 species let the player pick Small or Medium |
| `species[].speedFeet` | integer (0–120) | yes |  |
| `species[].darkvisionFeet` | integer \| null | yes |  |
| `species[].creatureType` | string (pattern) | yes |  |
| `species[].abilityBonuses` | object[] | yes | Fixed ability increases, as data. Empty for every SRD 5.2.1 species (increases live on the background); a 2014-style or homebrew record populates it and the builder applies whatever is declared |
| `species[].abilityBonusChoice` | object \| null | yes | "Choose N abilities to raise by M" (the 2014 variant-human pattern); null when the species has none |
| `species[].languages` | string (pattern)[] | yes |  |
| `species[].languageChoices` | object \| null | yes | "Choose N languages" where the species offers one; null otherwise |
| `species[].lineages` | object[] | yes | Lineages/subraces; each one's traits are also folded into features |
| `species[].features` | ContentFeature[] | yes | Species traits plus every lineage's traits. NOTE: SRD 5.2.1 puts ability increases on the BACKGROUND, not the species |
| `attribution` | string | yes |  |

### `ContentSpellsData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spells` | object[] | yes |  |
| `spells[].id` | string | yes |  |
| `spells[].name` | string | yes |  |
| `spells[].level` | integer (0–9) | yes | 0 is a cantrip |
| `spells[].school` | string | yes |  |
| `spells[].castingTime` | string | yes |  |
| `spells[].rangeText` | string \| null | yes |  |
| `spells[].componentsText` | string | yes | "V, S, M (a pinch of soot)", or "None" |
| `spells[].duration` | string | yes |  |
| `spells[].concentration` | boolean | yes |  |
| `spells[].ritual` | boolean | yes |  |
| `spells[].description` | string | yes |  |
| `spells[].higherLevel` | string \| null | yes |  |
| `spells[].classes` | string[] | yes | Spell-list ids this spell belongs to ("wizard", a homebrew list slug) - the builder filters a class's spell step on these, paired with the class record's spellcasting.spellListId |
| `spells[].damageRoll` | string \| null | yes | Base damage/healing roll ("8d6"), or null when the spell rolls nothing |
| `spells[].damageTypes` | string[] | yes |  |
| `spells[].castingOptions` | object[] | yes | Per-slot-level upcast scaling; the sheet applies the row matching the chosen cast level |
| `attribution` | string | yes | The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content |

### `ContentSubclassesData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `subclasses` | object[] | yes |  |
| `subclasses[].id` | string (pattern) | yes |  |
| `subclasses[].name` | string | yes |  |
| `subclasses[].source` | `srd` \| `homebrew` | yes |  |
| `subclasses[].classId` | string (pattern) | yes |  |
| `subclasses[].summary` | string \| null | yes |  |
| `subclasses[].description` | string \| null | yes |  |
| `subclasses[].subclassLevel` | integer \| null | yes | The class level this subclass is taken at; null inherits the parent class's subclassLevel |
| `subclasses[].spellcastingAbility` | string \| null | yes | Set by third-caster subclasses (Eldritch Knight, Arcane Trickster) |
| `subclasses[].spellcastingProgression` | `full` \| `half` \| `third` \| `pact` \| `null` | yes |  |
| `subclasses[].spellcasting` | object \| null | yes | A third-caster subclass's full spellcasting header, same shape as a class's; null otherwise |
| `subclasses[].features` | ContentFeature[] | yes |  |
| `attribution` | string | yes |  |

### `CredentialAuditEvent`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer (≥ 1) | yes |  |
| `type` | `created` \| `used` \| `verification_failed` \| `rotated` \| `revoked` | yes |  |
| `occurredAt` | string (date-time) | yes |  |
| `detail` | object (free-form) | yes |  |

### `EncounterArchiveDeletedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer (≥ 1) | yes |  |
| `deleted` | const `true` | yes |  |

### `EncounterArchiveDocumentData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer (≥ 1) | yes |  |
| `document` | object (free-form) | yes | archiveSchemaVersion 3 (additive over 1 and 2): { archiveSchemaVersion, startedAt, endedAt, turnCount, turns[{index,kind,label,revision,at,state}], log[], journal[{seq,commandId,type,actorId,principal,payload,revision,at}], finalState, postEncounterState, rolls[], definitions[{id,source,definition}], attribution } |

### `EncounterArchiveListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `encounters` | EncounterArchiveSummary[] | yes |  |

### `EncounterArchiveSummary`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer (≥ 1) | yes |  |
| `archivedAt` | string (date-time) | yes |  |
| `startedAt` | string \| null | yes |  |
| `endedAt` | string (date-time) | yes |  |
| `turnCount` | integer (≥ 0) | yes |  |

### `GameCommandCatalogData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commands` | GameCommandDescriptor[] | yes |  |

### `GameCommandDescriptor`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes |  |
| `scope` | `system:read` \| `game:read` \| `actor:read` \| `actor:write` \| `scene:read` \| `scene:write` \| `combat:read` \| `combat:write` \| `roll:create` \| `codex:read` \| `codex:write` \| `events:read` \| `webhooks:manage` \| `admin` | yes |  |
| `summary` | string | yes |  |

### `GameLogData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `entries` | GameLogEntry[] | yes |  |

### `GameLogEntry`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer (≥ 1) | yes |  |
| `at` | string (date-time) | yes |  |
| `kind` | string | yes | damage, heal, save, action, condition, reaction, turn, encounter, scene, history, roll - additive over time |
| `text` | string | yes |  |
| `gmOnly` | boolean | yes |  |
| `revision` | integer (≥ 0) | yes |  |

### `GameMutationAccepted`

Commands append extras: rollId/hiddenFromRoller (dice), actorId (adds/imports), annotationId, resolution (action.resolve), outcome (save.answer), type (tunnel).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `commandId` | string (uuid) | yes |  |
| `revision` | integer (≥ 0) | yes |  |
| `duplicate` | boolean | yes | True when this commandId was already processed; the stored outcome's revision is returned and nothing re-executed. |

### `GameSnapshotData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `view` | `gm` \| `player` | yes |  |
| `revision` | integer (≥ 0) | yes |  |
| `game` | object (free-form) | yes | GmView (full state + presence + turnHistory) or PlayerView (visibility-filtered actors with banded monster HP, filtered rolls/annotations/saves) - exactly what the same principal receives over Socket.IO. |

### `HomebrewActionOnHit`

On-hit riders: conditions applied to the target as ONE source-linked effect (a crocodile's Bite applies Grappled + Restrained with escape DC 15).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `conditions` | object[] | yes |  |
| `conditions[].id` | string (pattern) | yes |  |
| `conditions[].level` | integer (1–6) | no |  |
| `escapeDc` | integer (1–40) | no |  |
| `maxTargetSize` | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan` | no | The rider only applies to targets of at most this size |

### `HomebrewActionUses`

Limited uses for an ACTION. Unlike a feature's, this vocabulary includes "recharge" - a start-of-turn d6 at or above `recharge` (and any rest) restores it. `recharge` must be present when `per` is "recharge" and absent otherwise; the server enforces the biconditional.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer (1–20) | yes |  |
| `per` | `turn` \| `encounter` \| `long-rest` \| `short-rest` \| `recharge` | yes |  |
| `pool` | string (pattern) | no | Shares one counter across actions carrying the same pool id (Sneak Attack once per turn regardless of weapon) |
| `recharge` | integer (2–6) | no | The d6 threshold, e.g. 5 for "Recharge 5-6" |

### `HomebrewBackgroundRecord`

A background. In SRD 5.2.1 this is where ability increases and the origin feat live, so it is the record a homebrew origin is authored on.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `summary` | string | no | Short blurb for the wizard's pick card |
| `description` | string | no | Long prose. Always the display source of truth; the structured riders only add mechanics on top |
| `attribution` | string | no | Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead |
| `type` | const `"background"` | yes |  |
| `abilityOptions` | object | no | SRD 5.2.1 ability increases: which abilities, and the legal distributions as data (+2/+1 or +1/+1/+1) so a homebrew background can print its own |
| `abilityOptions.from` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes |  |
| `abilityOptions.spreads` | integer (1–3)[][] | no | Default: `[[2,1],[1,1,1]]`. |
| `originFeatId` | string (pattern) | no | The origin feat this background grants, keyed into the feat catalog - one of the seven derived-id fields a pack import rewrites |
| `skillProficiencies` | string (pattern)[] | no |  |
| `skillChoices` | HomebrewChoiceList | no |  |
| `toolProficiencies` | string (pattern)[] | no |  |
| `toolChoices` | HomebrewChoiceList | no |  |
| `languages` | string (pattern)[] | no |  |
| `languageChoices` | HomebrewChoiceList | no |  |
| `startingEquipment` | HomebrewStartingEquipmentOption[] | no |  |
| `features` | HomebrewFeature[] | no |  |

### `HomebrewChoiceList`

A "choose N from this list" proficiency grant (class skills, background tools).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `choose` | integer (0–10) | yes |  |
| `from` | string (pattern)[] | no |  |

### `HomebrewClassLevelRow`

ONE row of a class's 20-level table. `features` lists the ids granted at that level, resolved against the owning record's own `features[]`. The optional columns carry whatever the printed table carries - omit a column this class does not have rather than sending zeroes.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `level` | integer (1–20) | yes |  |
| `proficiencyBonus` | integer (2–6) | yes |  |
| `features` | string (pattern)[] | no |  |
| `spellSlots` | integer (0–4)[] | no | Nine counts, index 0 = 1st-level slots. Omitted on a non-caster row |
| `pactSlots` | object | no | Warlock Pact Magic: one uniform slot level with its own count |
| `pactSlots.level` | integer (1–9) | yes |  |
| `pactSlots.slots` | integer (0–4) | yes |  |
| `cantripsKnown` | integer (0–10) | no |  |
| `spellsKnown` | integer (0–40) | no |  |
| `preparedFormula` | string | no | The prepared-spell rule as data ("<ability> modifier + <class> level") so a homebrew class prints its own wording |
| `preparedCount` | integer (0–60) | no |  |
| `classResources` | object[] | no | Named per-level resources (Rage 3, Ki 5, Sneak Attack 3d6, Second Wind 3) |
| `classResources[].id` | string (pattern) | yes |  |
| `classResources[].name` | string | yes |  |
| `classResources[].amount` | integer (0–999) \| string | yes | A count, or a dice string |

### `HomebrewClassRecord`

A character class. The heaviest of the nine: a full 20-row printed table plus every feature it can grant. Duplicating an SRD class (`POST /content/{id}/duplicate` with `wizard`) is what makes that tractable to author.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `summary` | string | no | Short blurb for the wizard's pick card |
| `description` | string | no | Long prose. Always the display source of truth; the structured riders only add mechanics on top |
| `attribution` | string | no | Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead |
| `type` | const `"class"` | yes |  |
| `hitDie` | `d4` \| `d6` \| `d8` \| `d10` \| `d12` | yes | The multiclass hit-dice pool keys on this |
| `statPriority` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes | All six abilities, best first - the random generator's core input as DATA, so a homebrew class supplies its own without touching @vtt/rules-5e |
| `primaryAbilities` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes |  |
| `savingThrows` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes |  |
| `skillChoices` | HomebrewChoiceList | yes |  |
| `armorProficiencies` | string (pattern)[] | no |  |
| `weaponProficiencies` | string (pattern)[] | no |  |
| `toolProficiencies` | string (pattern)[] | no |  |
| `toolChoices` | HomebrewChoiceList | no |  |
| `startingEquipment` | HomebrewStartingEquipmentOption[] | no |  |
| `multiclassProficiencies` | object | no | Proficiencies gained when the class is taken as a MULTICLASS - narrower than the level-1 set |
| `multiclassProficiencies.armor` | string (pattern)[] | no |  |
| `multiclassProficiencies.weapons` | string (pattern)[] | no |  |
| `multiclassProficiencies.tools` | string (pattern)[] | no |  |
| `multiclassProficiencies.skills` | HomebrewChoiceList | no |  |
| `multiclassPrerequisites` | HomebrewMulticlassPrerequisite | no |  |
| `subclassLevel` | integer (1–20) | yes |  |
| `subclassLabel` | string | no | What this class calls its subclass ("Martial Archetype") |
| `asiLevels` | integer (1–20)[] | no |  |
| `spellcasting` | HomebrewSpellcasting | no |  |
| `levelTable` | HomebrewClassLevelRow[] | yes | Exactly 20 rows, row N at level N. Each row's `features` must resolve against this record's own `features[]` - the server refuses the record otherwise, which is why re-minting an id on import never rewrites intra-record ids |
| `features` | HomebrewFeature[] | no |  |

### `HomebrewContentData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `record` | HomebrewRecordDocument | yes |  |

### `HomebrewContentListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `records` | HomebrewRecordSummary[] | yes |  |
| `nextCursor` | string \| null | yes | Opaque keyset cursor - never construct or parse one. null means this was the last page |
| `total` | integer (≥ 0) | yes | Rows matching the filter, ignoring limit/cursor |

### `HomebrewDeletedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `deleted` | const `true` | yes |  |
| `deletedAt` | string (date-time) | yes |  |

### `HomebrewEffectAttackAdvantage`

The bearer's attack rolls have advantage, on its own turn only.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"attack-advantage"` | yes |  |

### `HomebrewEffectAttackDisadvantage`

The bearer's attack rolls have disadvantage, always-on.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"attack-disadvantage"` | yes |  |

### `HomebrewEffectDamageBonus`

Flat damage added to the bearer's hits.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"damage-bonus"` | yes |  |
| `amount` | integer (-20–20) | yes |  |
| `appliesTo` | `melee` \| `all` | no | Default: `"all"`. |

### `HomebrewEffectDamageResistance`

Resistance to the listed damage types.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"damage-resistance"` | yes |  |
| `damageTypes` | string[] | yes |  |

### `HomebrewEffectDurationEncounter`

Until the encounter ends.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"encounter"` | yes |  |

### `HomebrewEffectDurationManual`

Until the GM clears it.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"manual"` | yes |  |

### `HomebrewEffectDurationRounds`

A fixed number of rounds.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"rounds"` | yes |  |
| `rounds` | integer (1–100) | yes |  |

### `HomebrewEffectDurationUntilSourceNextTurn`

Until the granting creature's next turn begins.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"until-source-next-turn"` | yes |  |

### `HomebrewEffectGrant`

An effect a feature or action grants, in the SAME vocabulary the live rules engine already resolves on an actor - reused rather than re-invented, so a homebrew Rage behaves exactly like the bundled one.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no |  |
| `tags` | string (pattern)[] | yes |  |
| `duration` | HomebrewEffectDurationRounds \| HomebrewEffectDurationUntilSourceNextTurn \| HomebrewEffectDurationEncounter \| HomebrewEffectDurationManual | yes | How long the effect lasts. |
| `modifiers` | HomebrewEffectModifier[] | no |  |
| `onEnd` | HomebrewEffectOnEnd[] | no |  |
| `endsWithTag` | string (pattern) | no | The granted effect ends when the actor loses every other effect with this tag (Frenzy's marker ends with the Rage) |
| `target` | `self` \| `target` | no | Who receives it: the acting creature, or the action's single chosen target (Help) Default: `"self"`. |
| `voidWhileIncapacitated` | boolean | no | Benefits lapse while the bearer is incapacitated (Dodge) Default: `false`. |
| `concentration` | boolean | no | Default: `false`. |

### `HomebrewEffectIncomingAttackAdvantage`

Attack rolls against the bearer have advantage.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"incoming-attack-advantage"` | yes |  |

### `HomebrewEffectIncomingAttackDisadvantage`

Attack rolls against the bearer have disadvantage (Dodge).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"incoming-attack-disadvantage"` | yes |  |

### `HomebrewEffectModifier`

What an active EFFECT contributes to the rules engine. Still a DIFFERENT and smaller vocabulary than HomebrewFeatureModifier (which is what a feature or an item contributes); the two are deliberately not merged. They do SHARE their last three branches - `attack-bonus`, `extra-damage` and `roll-mode` are one component each, referenced by both unions, because a bonus that meant one thing on an item and another on an effect is exactly the drift a second copy produces. `attack-advantage` is evaluated only on the bearer's own turn (Reckless Attack semantics); the six legacy advantage/disadvantage branches stay as they are, with `roll-mode` as the general form that also covers checks, initiative, death saves and concentration.

One of the following, discriminated by `type`:

- `HomebrewEffectDamageBonus`
- `HomebrewEffectDamageResistance`
- `HomebrewEffectAttackAdvantage`
- `HomebrewEffectIncomingAttackAdvantage`
- `HomebrewEffectAttackDisadvantage`
- `HomebrewEffectIncomingAttackDisadvantage`
- `HomebrewEffectSaveAdvantage`
- `HomebrewEffectSaveDisadvantage`
- `HomebrewRiderAttackBonus`
- `HomebrewRiderExtraDamage`
- `HomebrewRiderRollMode`

### `HomebrewEffectOnEnd`

What happens when the effect ends - Frenzy leaves one level of Exhaustion behind.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"condition"` | yes |  |
| `conditionId` | string (pattern) | yes |  |
| `level` | integer (1–6) | no |  |

### `HomebrewEffectSaveAdvantage`

The bearer's saving throws have advantage; omit `ability` for all saves (Dodge grants Dex only).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"save-advantage"` | yes |  |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | no |  |

### `HomebrewEffectSaveDisadvantage`

The bearer's saving throws have disadvantage; omit `ability` for all saves.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"save-disadvantage"` | yes |  |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | no |  |

### `HomebrewEquipmentArmor`

Body armor carries its full base AC (11-18); a shield carries its +2 bonus.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `acBase` | integer (2–25) | yes |  |
| `addDexModifier` | boolean | yes |  |
| `dexModifierCap` | integer \| null | yes |  |
| `stealthDisadvantage` | boolean | yes |  |
| `strengthRequired` | integer \| null | yes |  |

### `HomebrewEquipmentRecord`

Any item: weapon, armor, shield, gear, tool, pack, focus, consumable, magic item, or a homebrew kind nobody has invented yet. NO `summary` and NO `attribution`: `EquipmentReferenceSchema` is the ONE `.strict()` content schema, so an undeclared key THROWS rather than being dropped - documenting either here would publish a field that makes the request fail. `slot` is now the mechanical hook (`category` stays the open display slug), so a homebrew `category: "relic"` with `slot: "armor"` does derive AC. Every rider below lives on the CATALOG record and never on the carried inventory row: an owner is handed their whole inventory verbatim in their projection, so a rider mirrored onto that row would reach the player the instant they picked the item up - which is what makes hiding a cursed item's mechanics structural rather than a deletion someone has to remember.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"equipment"` | yes |  |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `category` | string (pattern) | yes | Open slug, never a closed enum - "relic", "vehicle", "trinket" need no schema change. Display and grouping; `slot` is what the engine switches on |
| `costGp` | number \| null | yes |  |
| `weightLb` | number \| null | yes |  |
| `description` | string \| null | yes |  |
| `weapon` | HomebrewEquipmentWeapon \| null | no | Populated for weapons only |
| `armor` | HomebrewEquipmentArmor \| null | no | Populated for armor and shields only |
| `slot` | `weapon` \| `shield` \| `armor` \| `head` \| `neck` \| `shoulders` \| `hands` \| `ring` \| `belt` \| `feet` \| `held` \| `wondrous` \| `consumable` \| `ammunition` \| `none` | no | WHERE it is worn or held - the mechanical hook, and the one closed enum here. Absent = fall back to `category` for the three the engine already knows (weapon, armor, shield) |
| `rarity` | string (pattern) | no | Display and filtering only ("uncommon", "legendary"). An OPEN slug: rarity is identity, not a mechanical hook |
| `isMagic` | boolean | no | Default: `false`. |
| `attunement` | HomebrewItemAttunement | no | Attunement requirement and its advisory class/species restriction |
| `cursed` | boolean | no | A cursed item cannot be voluntarily removed once attuned, and its magic half is withheld from the player until attunement. It MUST require attunement - a curse you can drop by taking the hat off is not a curse, and requiring attunement gives the hiding rule one well-defined boundary: hidden until attuned, fully visible after, because by then the player has learned it and hiding further would only make their own sheet lie to them Default: `false`. |
| `casts` | HomebrewItemSpellCast[] | no | Spells the item can cast (Amulet of Message, Wand of Fireballs) Default: `[]`. |
| `grantsFeatIds` | string (pattern)[] | no | Feats the item grants while active. Depth 1, no transitive expansion, and the grant edge is one-directional - nothing ever grants an item back - so a cycle cannot be drawn rather than merely being checked for Default: `[]`. |
| `tags` | string (pattern)[] | no | Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity) |
| `actions` | HomebrewFeatureAction[] | no | Rollable actions this adds to the sheet (Second Wind, Channel Divinity, Breath Weapon) |
| `effects` | HomebrewEffectGrant[] | no | Effects it can grant, in the same vocabulary the live rules engine already resolves (Rage, Bardic Inspiration) |
| `uses` | HomebrewFeatureUses | no | Limited uses recovered on a rest |
| `grants` | HomebrewFeatureGrants | no | Flat proficiency/language/spell grants |
| `modifiers` | HomebrewFeatureModifier[] | no | Typed numeric riders |

### `HomebrewEquipmentWeapon`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `category` | `simple` \| `martial` | yes |  |
| `damageDice` | string | yes |  |
| `damageType` | string | yes |  |
| `rangeFeet` | integer \| null | yes |  |
| `longRangeFeet` | integer \| null | yes | Attacks past `rangeFeet` up to this roll at disadvantage |

### `HomebrewFeatRecord`

A feat: catalog metadata plus ONE HomebrewFeature carrying all the mechanics. Nothing about a feat is special-cased - it is literally the same feature record a class or species uses, which is why the smallest of the nine still exercises the whole rider vocabulary.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `summary` | string | no | Short blurb for the wizard's pick card |
| `description` | string | no | Long prose. Always the display source of truth; the structured riders only add mechanics on top |
| `attribution` | string | no | Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead |
| `type` | const `"feat"` | yes |  |
| `category` | string (pattern) | no | Open slug: origin, general, fighting-style, epic-boon, or anything homebrew adds. Feeds the `<category>-feats` catalog slug a feature choice can point at Default: `"general"`. |
| `prerequisite` | object | no | The SERVER decides whether a prerequisite is met - never the client |
| `prerequisite.level` | integer (1–20) | no |  |
| `prerequisite.abilityScores` | object[] | no |  |
| `prerequisite.requires` | string (pattern)[] | no | Proficiency or feature slugs the character must already have |
| `prerequisite.text` | string | no | Anything not modeled above, printed for the player to judge (ADR-0008 prose fallback) |
| `repeatable` | boolean | no | Default: `false`. |
| `feature` | HomebrewFeature | yes |  |

### `HomebrewFeature`

THE shared feature record: a class feature, a subclass feature, a species trait, a background feature, and a feat's mechanics are all this one shape. `description` is always the display source of truth, and every rider is optional - a prose-only feature is perfectly valid and is how most text starts life. This is the AUTHORING counterpart of `ContentFeature`, which publishes the same feature with its riders stripped.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `name` | string | yes |  |
| `level` | integer (1–20) | no | Class/subclass level this feature is gained at. Omitted for always-on records (species traits, feats) |
| `description` | string | yes |  |
| `choice` | HomebrewFeatureChoice | no | A pick this feature asks the player to make; every one writes a row in the character's choice-provenance ledger, which is what makes level-up and respec possible |
| `tags` | string (pattern)[] | no | Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity) |
| `actions` | HomebrewFeatureAction[] | no | Rollable actions this adds to the sheet (Second Wind, Channel Divinity, Breath Weapon) |
| `effects` | HomebrewEffectGrant[] | no | Effects it can grant, in the same vocabulary the live rules engine already resolves (Rage, Bardic Inspiration) |
| `uses` | HomebrewFeatureUses | no | Limited uses recovered on a rest |
| `grants` | HomebrewFeatureGrants | no | Flat proficiency/language/spell grants |
| `modifiers` | HomebrewFeatureModifier[] | no | Typed numeric riders |
| `replacesFeatureId` | string (pattern) | no | This feature REPLACES an earlier one of the same id lineage (Indomitable at 9/13/17) |

### `HomebrewFeatureAction`

A rollable action a feature adds to the sheet (Second Wind, Channel Divinity, Breath Weapon). Identical to HomebrewStatblockAction except for `attack`/`save`: a class feature cannot know the character's ability scores, so it names the ability and the builder DERIVES the number, where a stat block prints it.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `name` | string | yes |  |
| `activation` | `action` \| `bonus-action` \| `reaction` \| `other` | yes |  |
| `description` | string | yes | Always the display source of truth; every rider below only adds mechanics on top |
| `damage` | object[] | no |  |
| `damage[].formula` | string (pattern) | yes | One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008) |
| `damage[].type` | string | yes |  |
| `multiattack` | object[] | no | Compound action: resolving a component consumes the shared action slot once and tracks the rest |
| `multiattack[].actionId` | string (pattern) | yes |  |
| `multiattack[].count` | integer (1–4) | yes |  |
| `onHit` | HomebrewActionOnHit[] | no | Conditions applied to the target as one source-linked effect |
| `targetRules` | `not-grappled-by-source`[] | no | Targeting restrictions the engine enforces |
| `grants` | HomebrewEffectGrant | no | Resolving this action grants an effect to the actor itself (Rage, Reckless Attack) |
| `requiresEffectTag` | string (pattern) | no | The action requires an active self effect carrying this tag (Frenzy requires "raging") |
| `uses` | HomebrewActionUses | no | Limited uses; unlike a feature's, an action's may recharge on a d6 |
| `reaction` | object | no | A declared reaction the engine can offer as a pending prompt (Uncanny Dodge). Only meaningful on activation "reaction" |
| `reaction.trigger` | const `"hit-by-attack"` | yes |  |
| `reaction.response` | const `"half-damage"` | yes |  |
| `legendary` | object | no | SRD Legendary Action: taken on OTHER creatures' turns, spending `cost` from the per-round pool. Pairs with activation "other" |
| `legendary.cost` | integer (1–5) | yes |  |
| `attack` | HomebrewFeatureAttack | no |  |
| `save` | HomebrewFeatureSave | no |  |
| `damageByLevel` | object[] | no | Damage that grows with level, replacing `damage` at the highest matching level (Sneak Attack, Divine Smite) |
| `damageByLevel[].level` | integer (1–20) | yes |  |
| `damageByLevel[].formula` | string (pattern) | yes | One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008) |
| `damageByLevel[].type` | string | yes |  |

### `HomebrewFeatureAttack`

An attack a FEATURE grants. Same vocabulary as a stat block's attack except the to-hit bonus is DERIVED: the feature names the ability (or "spellcasting") and the builder resolves the number.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` \| `spellcasting` | yes |  |
| `proficient` | boolean | no | Default: `true`. |
| `reachFeet` | integer (≥ 1) | no |  |
| `rangeFeet` | integer (≥ 1) | no |  |
| `rangeNormalFeet` | integer (≥ 1) | no |  |
| `count` | integer (1–10) | no |  |
| `criticalBonusDice` | integer (1–4) | no |  |

### `HomebrewFeatureChoice`

A pick a feature asks for, in three increasing richnesses: `fromCatalog` (an open catalog slug resolved at pick time), `from` (explicit ids whose mechanics live elsewhere or nowhere), or `options` (the ids WITH their mechanics inline, for options that exist only here - Divine Order's two sacred roles, Giant Ancestry's six boons). `options` and `from` are mutually exclusive: after parsing, `from` always holds the canonical id list, derived from `options` when they were authored.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string (pattern) | yes | Open slug the wizard renders generically: fighting-style, skill, expertise, subclass, asi, feat, spell, cantrip, language, tool, or anything homebrew invents |
| `choose` | integer (1–10) | no | Default: `1`. |
| `from` | string (pattern)[] | no | Explicit option ids. Must name at least one - an empty list is an authoring mistake, not "no options offered". Omit the field entirely when `fromCatalog` or `options` supplies the list |
| `fromCatalog` | string (pattern) | no | An open catalog slug resolved at pick time (skills, feats, wizard-spells) |
| `maxSpellLevel` | integer (0–9) | no | Ceiling on a spell pick's level (Magic Initiate: 0, cantrips only) |
| `repeatable` | boolean | no | The same option may be picked more than once (Expertise across levels) Default: `false`. |
| `options` | HomebrewFeatureOption[] | no | Options carrying their own mechanics. Mutually exclusive with `from` |

### `HomebrewFeatureGrants`

Flat things a feature simply hands the character. All open slugs, so a homebrew language, tool, or armor group needs no schema change.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `skills` | string (pattern)[] | no |  |
| `expertise` | string (pattern)[] | no |  |
| `tools` | string (pattern)[] | no |  |
| `languages` | string (pattern)[] | no |  |
| `armor` | string (pattern)[] | no |  |
| `weapons` | string (pattern)[] | no |  |
| `saves` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | no |  |
| `damageResistances` | string (pattern)[] | no |  |
| `damageImmunities` | string (pattern)[] | no |  |
| `conditionImmunities` | string (pattern)[] | no |  |
| `spells` | object[] | no | Spells the feature always has ready (domain spells, racial spells). `alwaysPrepared` spells do not count against a prepared list. `id` is one of the seven derived-id fields a pack import rewrites |
| `spells[].id` | string (pattern) | yes |  |
| `spells[].level` | integer (0–9) | no |  |
| `spells[].alwaysPrepared` | boolean | no | Default: `true`. |
| `spells[].ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | no |  |

### `HomebrewFeatureModifier`

THE authored rider vocabulary, and the same one a magic ITEM carries - a feat is a HomebrewFeature, a chosen option carries the identical rider block, and HomebrewEquipmentRecord spreads that block too, so "a feat carries the same buffs and debuffs an item does" is true by construction rather than by convention. Bounded and grown additively; anything not modeled stays prose (ADR-0008). Every amount is a SIGNED integer, so a curse is this vocabulary with a negative number rather than a second one, and every branch carries the `when`/`scope` gate. Two branches are refused on an ITEM carrier (`hit-points-per-level` and `ability-score`) because both bake into the sheet and cannot be un-granted when the item comes off; both stay available on a feat. HomebrewEffectModifier remains the separate, smaller vocabulary a live EFFECT contributes - the two share exactly three branches and are otherwise not merged.

One of the following, discriminated by `type`:

- `HomebrewModifierAbilityScore`
- `HomebrewModifierHitPointsPerLevel`
- `HomebrewModifierSpeed`
- `HomebrewModifierArmorClass`
- `HomebrewModifierInitiative`
- `HomebrewModifierExtraAttack`
- `HomebrewModifierUnarmoredDefense`
- `HomebrewModifierDarkvision`
- `HomebrewRiderAttackBonus`
- `HomebrewRiderExtraDamage`
- `HomebrewRiderRollMode`
- `HomebrewModifierSaveBonus`
- `HomebrewModifierCheckBonus`
- `HomebrewModifierSpellSaveDc`
- `HomebrewModifierSpellAttackBonus`
- `HomebrewModifierSpellSlot`
- `HomebrewModifierResourceBonus`
- `HomebrewModifierCriticalRange`
- `HomebrewModifierCriticalBonusDice`
- `HomebrewModifierDamageReduction`
- `HomebrewModifierSense`

### `HomebrewFeatureOption`

ONE pickable option that carries its OWN mechanics - structurally a HomebrewFeature minus `level`/`replacesFeatureId`, with identical rider fields and identical meanings. That is the point: a chosen option is interpreted by the very same code path that interprets a class feature, so "Divine Order: Protector" carries its Martial-weapon and Heavy-armor training itself instead of being a bare id string nothing downstream can read.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `name` | string | yes |  |
| `description` | string | yes |  |
| `choice` | HomebrewFeatureOptionChoice | no | A SECOND-ORDER pick this option owes once chosen (Thaumaturge's extra Cleric cantrip) |
| `tags` | string (pattern)[] | no | Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity) |
| `actions` | HomebrewFeatureAction[] | no | Rollable actions this adds to the sheet (Second Wind, Channel Divinity, Breath Weapon) |
| `effects` | HomebrewEffectGrant[] | no | Effects it can grant, in the same vocabulary the live rules engine already resolves (Rage, Bardic Inspiration) |
| `uses` | HomebrewFeatureUses | no | Limited uses recovered on a rest |
| `grants` | HomebrewFeatureGrants | no | Flat proficiency/language/spell grants |
| `modifiers` | HomebrewFeatureModifier[] | no | Typed numeric riders |

### `HomebrewFeatureOptionChoice`

THE TERMINAL of the feature/choice/option cycle. Identical to HomebrewFeatureChoice except that it HAS NO `options` KEY AT ALL, so the recursion is bounded by the schema rather than by a promise in prose: an option's own pick may name ids or a catalog slug, and can never open a third level.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string (pattern) | yes | Open slug the wizard renders generically: fighting-style, skill, expertise, subclass, asi, feat, spell, cantrip, language, tool, or anything homebrew invents |
| `choose` | integer (1–10) | no | Default: `1`. |
| `from` | string (pattern)[] | no | Explicit option ids. Must name at least one - an empty list is an authoring mistake, not "no options offered". Omit the field entirely when `fromCatalog` or `options` supplies the list |
| `fromCatalog` | string (pattern) | no | An open catalog slug resolved at pick time (skills, feats, wizard-spells) |
| `maxSpellLevel` | integer (0–9) | no | Ceiling on a spell pick's level (Magic Initiate: 0, cantrips only) |
| `repeatable` | boolean | no | The same option may be picked more than once (Expertise across levels) Default: `false`. |

### `HomebrewFeatureSave`

A save a feature forces. `ability` is what the TARGET rolls; `dc` is how the number is derived.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `dc` | const `"spellcasting"` \| integer (1–40) \| HomebrewFeatureSaveDc | yes | Three forms, all of them data rather than a formula language (ADR-0008): the character's own spell save DC, a printed constant, or the SRD's "DC 8 plus your <ability> modifier and Proficiency Bonus" wording as three bounded fields. |

### `HomebrewFeatureSaveDc`

A DERIVED save DC: `base` plus the CASTER's ability modifier, plus proficiency bonus. Every SRD 5.2.1 printing uses base 8 with proficiency, which is why both default.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `base` | integer (1–30) | no | The printed constant the modifiers are added to Default: `8`. |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes | Whose modifier is added - the CASTER's ability, not the one the target rolls |
| `proficiencyBonus` | boolean | no | Default: `true`. |

### `HomebrewFeatureUses`

Uses a feature gets back on a rest, as DATA rather than a formula language. Either `limit` or `scaling` must be present. The `per` vocabulary is deliberately NARROWER than an action's: there is no "recharge", because a recharge roll belongs to a stat block, not a character feature.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer (1–20) | no | A flat count |
| `scaling` | HomebrewUsesByProficiency \| HomebrewUsesByAbility \| HomebrewUsesByLevel | no | The three ways 5e actually scales a feature's uses. |
| `per` | `turn` \| `encounter` \| `short-rest` \| `long-rest` | yes |  |
| `pool` | string (pattern) | no | Shares ONE counter across every feature carrying the same pool id |

### `HomebrewItemAttunement`

Attunement. `restrictedTo` matches class ids or a species id and is ADVISORY - shown on the sheet ("Requires attunement by a cleric"), never a block: it is an open slug set, blocking on a fuzzy match would be wrong, and a GM handing a player a restricted item on purpose is a normal table event rather than an error to refuse.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `required` | boolean | no | Default: `false`. |
| `restrictedTo` | string (pattern)[] | no | Class or species ids the item is meant for. Advisory only Default: `[]`. |

### `HomebrewItemSpellCast`

A spell an item can cast. Needs no new machinery: an item cast is one more synthesised action whose limited uses collapse into the same live uses namespace a feature's do, and rests already re-arm it. "Once per day" is `uses: {"limit": 1, "per": "long-rest"}` - there is deliberately no "day" in the `per` vocabulary, because this app already treats a long rest as the day.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spellId` | string (pattern) | yes |  |
| `atLevel` | integer (0–9) | no | Cast at this slot level; absent = the spell's own level |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | no | Which ability powers it; absent = the wielder's own spellcasting ability |
| `saveDc` | integer (1–40) | no | A flat printed DC ("save DC 15"), overriding any derivation |
| `uses` | HomebrewFeatureUses | no | Charges. Share one pool across several casts with `uses.pool` |
| `consumesSpellSlot` | boolean | no | Whether casting it also spends one of the bearer's own spell slots Default: `false`. |

### `HomebrewModifierAbilityScore`

Raise (or lower) one ability score, optionally past the usual cap. REFUSED on an item: an ability score cascades into AC, saves, skills, spell DC, hit points and initiative, and every one of those reads the baked `abilityScores`, so layering one score means layering the whole sheet.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"ability-score"` | yes |  |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `amount` | integer (-5–5) | yes |  |
| `maximum` | integer (1–30) | no |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierArmorClass`

A flat AC rider. `whileArmored` is the ONE bounded condition the SRD's printed bonuses need (the Defense fighting style reads "While you're wearing Light, Medium, or Heavy armor"); it is a boolean, not a condition language, and defaults to the unconditional bonus every earlier record meant. `when: [{"type": "while-armored"}]` now says the same thing in the general vocabulary - the boolean STAYS because shipped bundles author it, and a collector normalises it into that trigger.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"armor-class"` | yes |  |
| `amount` | integer (-5–5) | yes |  |
| `whileArmored` | boolean | no | Default: `false`. |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierCheckBonus`

A flat bonus to ability and skill checks. Gloves of Thievery (+5 Sleight of Hand) is this plus a `skill-is` filter.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"check-bonus"` | yes |  |
| `amount` | integer (-10–10) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierCriticalBonusDice`

Extra UNTYPED weapon dice on a critical hit (Savage Attacks). A typed crit-only 1d6 fire is `extra-damage` gated with `on-critical-hit` instead.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"critical-bonus-dice"` | yes |  |
| `count` | integer (1–4) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierCriticalRange`

Score a critical hit on this natural roll or higher (19 for a keen weapon).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"critical-range"` | yes |  |
| `threshold` | integer (15–20) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierDamageReduction`

Flat reduction of incoming damage. Resistance itself stays `grants.damageResistances`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"damage-reduction"` | yes |  |
| `amount` | integer (1–30) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierDarkvision`

Grant or extend darkvision.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"darkvision"` | yes |  |
| `feet` | integer (0–240) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierExtraAttack`

Additional attacks on the Attack action.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"extra-attack"` | yes |  |
| `count` | integer (1–3) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierHitPointsPerLevel`

Extra hit points at every level (Tough, Dwarven Toughness). REFUSED on an item: it changes `hp.maximum`, which live `hp.current` is tracked against, so unequipping could strand current above maximum - there is no correct silent answer.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"hit-points-per-level"` | yes |  |
| `amount` | integer (-5–5) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierInitiative`

Change the initiative bonus.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"initiative"` | yes |  |
| `amount` | integer (-5–10) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierResourceBonus`

One more use of a limited resource. `poolId` is the LIVE uses key (a `uses.pool` or an action id) - the namespace that is actually spent and re-armed - deliberately NOT the class level table's display-only `classResources`, where a rider would parse, store, project, and change nothing.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"resource-bonus"` | yes |  |
| `poolId` | string (pattern) | yes |  |
| `amount` | integer (-20–20) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierSaveBonus`

A flat bonus to saving throws. Narrow it with `when: [{"type": "ability-is", "abilities": ["dex"]}]` (a Cloak of Protection is the unnarrowed form).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"save-bonus"` | yes |  |
| `amount` | integer (-10–10) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierSense`

The missing sibling of `darkvision`: any named sense in feet. Display-level, like `darkvision`, until a senses model exists.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"sense"` | yes |  |
| `sense` | string (pattern) | yes |  |
| `feet` | integer (0–240) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierSpeed`

Change walking speed in feet.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"speed"` | yes |  |
| `amount` | integer (-30–60) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierSpellAttackBonus`

Change the bearer's spell attack bonus. A Wand of the War Mage is exactly this and nothing else.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"spell-attack-bonus"` | yes |  |
| `amount` | integer (-5–5) | yes |  |
| `classId` | string (pattern) | no |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierSpellSaveDc`

Change the bearer's spell save DC. `classId` targets one caster on a multiclass sheet; absent = every caster the bearer has.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"spell-save-dc"` | yes |  |
| `amount` | integer (-5–5) | yes |  |
| `classId` | string (pattern) | no |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierSpellSlot`

An extra spell slot of one level, layered over the single-sourced slot maxima so the seed, the long rest and the spend-clamp cannot disagree.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"spell-slot"` | yes |  |
| `level` | integer (1–9) | yes |  |
| `amount` | integer (-4–4) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewModifierUnarmoredDefense`

AC = 10 + DEX + this ability while wearing no armor (Barbarian, Monk, and any homebrew that wants it).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"unarmored-defense"` | yes |  |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `allowShield` | boolean | no | Default: `false`. |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewMonsterRecord`

A creature stat block: a canonical ActorDefinition, authored flat. The ONE branch with no content-catalog Zod schema behind it - a monster is an `ActorDefinition` (`@vtt/schemas`), the same shape `actor.import-definition` and the bundled bestiary already use, so this mirrors that instead of inventing a parallel record. Note `source` here is bundle PROVENANCE (`{name, version, externalId}`), deliberately NOT the srd/homebrew discriminator the other eight carry: that name was already taken, and a sibling key meaning the same thing twice is worse than deriving homebrew-ness from the row (which is what the merge does). The row's id becomes `source.externalId`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"monster"` | yes |  |
| `id` | string (pattern) | yes | The row's id. NOT part of ActorDefinitionSchema - the server stamps it into the stored body so the merged bestiary can resolve the record back to its row |
| `name` | string | yes |  |
| `schemaId` | `vtt.actor-character` \| `vtt.actor-monster` | yes |  |
| `schemaVersion` | const `1` | yes | ADR-0007 integer schema version; discoverable at /system/version |
| `source` | object | yes | Bundle provenance, not the content discriminator |
| `source.name` | string | yes |  |
| `source.version` | string | yes |  |
| `source.externalId` | string | no |  |
| `summary` | string | no |  |
| `size` | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan` | yes |  |
| `abilityScores` | object | yes |  |
| `abilityScores.str` | integer (1–30) | yes |  |
| `abilityScores.dex` | integer (1–30) | yes |  |
| `abilityScores.con` | integer (1–30) | yes |  |
| `abilityScores.int` | integer (1–30) | yes |  |
| `abilityScores.wis` | integer (1–30) | yes |  |
| `abilityScores.cha` | integer (1–30) | yes |  |
| `proficiencyBonus` | integer (0–12) | yes |  |
| `armorClass` | integer (1–40) | yes |  |
| `hitPoints` | object | yes |  |
| `hitPoints.maximum` | integer (≥ 1) | yes |  |
| `hitPoints.formula` | string (pattern) | no | One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008) |
| `initiativeBonus` | integer (-20–30) | no | Default: `0`. |
| `speedFeet` | integer (≥ 0) | yes |  |
| `actions` | HomebrewStatblockAction[] | no |  |
| `token` | object | no | The battlemap PIECE - disposition and grid footprint. Nothing to do with credentials |
| `token.disposition` | `friendly` \| `hostile` \| `neutral` | no | Default: `"neutral"`. |
| `token.footprint` | object | no | Default: `{"width":1,"height":1}`. |
| `extensions` | object (free-form) | no | Free-form passthrough an importer may carry; the engine reads nothing from it Default: `{}`. |
| `damageResistances` | string[] | no |  |
| `damageImmunities` | string[] | no |  |
| `damageVulnerabilities` | string[] | no |  |
| `conditionImmunities` | string (pattern)[] | no | Reference-level for now: displayed, not yet enforced on actor.set-condition |
| `legendary` | object | no | SRD 2024 legendary resources: actions spent on other creatures' turns, and Legendary Resistance uses that re-arm on a long rest |
| `legendary.actionsPerRound` | integer (1–5) | no |  |
| `legendary.resistancesPerDay` | integer (1–6) | no |  |
| `character` | object (free-form) | no | The CHARACTER half of an ActorDefinition (class/level/species/background/feats and the choice-provenance ledger). A monster leaves it absent; it is documented as an open object here for the same reason `ActorImportRequest.definition` is - a homebrew author never writes it, the character builder does |
| `proficiencies` | object (free-form) | no | Save/skill proficiency selections; the character half, see `character` |
| `spellcasting` | object (free-form) | no | A spellcasting creature's ability, slot maxima, and known/prepared list; the character half, see `character` |
| `startingInventory` | object (free-form)[] | no | Immutable starting loadout; the character half, see `character` |
| `startingCurrency` | object (free-form) | no | Immutable starting coins; the character half, see `character` |

### `HomebrewMulticlassPrerequisite`

Ability minimums for taking this class as a multiclass; `mode: "any"` covers "STR 13 or DEX 13". Display data - the server re-validates.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `mode` | `all` \| `any` | no | Default: `"all"`. |
| `minimums` | object[] | yes |  |
| `minimums[].ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `minimums[].minimum` | integer (1–20) | yes |  |

### `HomebrewPack`

The GM-to-GM interchange format (ADR-0007 schemaId + integer schemaVersion). One FLAT record array rather than a by-type object: the body already carries `type`, so a by-type map would duplicate the discriminator for nothing. No checksum field by design.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schemaId` | const `"vtt.homebrew-pack"` | yes |  |
| `schemaVersion` | const `1` | yes |  |
| `name` | string | yes |  |
| `attribution` | string \| null | yes |  |
| `exportedAt` | string (date-time) | yes |  |
| `records` | HomebrewRecord[] | yes | Authored bodies only - no state, visibility, deletion, or revision |

### `HomebrewPackExportData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pack` | HomebrewPack | yes |  |

### `HomebrewPackImportData`

The import plan or its result - byte-for-byte the same report either way, which is what makes `dryRun` trustworthy.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `imported` | object[] | yes |  |
| `imported[].id` | string (pattern) | yes |  |
| `imported[].type` | `class` \| `subclass` \| `species` \| `background` \| `feat` \| `spell` \| `equipment` \| `monster` \| `spell-list` | yes |  |
| `imported[].name` | string | yes |  |
| `imported[].originalId` | string (pattern) | yes |  |
| `reminted` | object[] | yes |  |
| `reminted[].originalId` | string (pattern) | yes |  |
| `reminted[].id` | string (pattern) | yes |  |
| `reminted[].reason` | `srd-collision` \| `homebrew-collision` | yes | An SRD collision is ALWAYS re-minted; a homebrew collision follows onIdCollision |
| `overwritten` | object[] | yes |  |
| `overwritten[].id` | string (pattern) | yes |  |
| `overwritten[].type` | `class` \| `subclass` \| `species` \| `background` \| `feat` \| `spell` \| `equipment` \| `monster` \| `spell-list` | yes |  |
| `overwritten[].name` | string | yes |  |
| `rejected` | object[] | yes |  |
| `rejected[].originalId` | string (pattern) | yes |  |
| `rejected[].issues` | HomebrewValidationIssue[] | yes |  |
| `dryRun` | boolean | yes |  |

### `HomebrewRecord`

The AUTHORED CONTENT ONLY - never row state. `state`, `visibleToPlayers`, and `deletedAt` live on HomebrewRecordDocument and never here, which is what stops an imported pack from inheriting the exporting table's visibility policy. One branch per `HomebrewContentType`, discriminated by the body's own `type`. Every branch mirrors the Zod schema the server actually parses the body with, so `required` here is exactly that schema's non-optional keys: a field with a server-side default is OPTIONAL on the wire, and an optional field is ABSENT rather than null (an authoring body is an input, and a Zod `.optional()` rejects an explicit null).

One of the following, discriminated by `type`:

- `HomebrewClassRecord`
- `HomebrewSubclassRecord`
- `HomebrewSpeciesRecord`
- `HomebrewBackgroundRecord`
- `HomebrewFeatRecord`
- `HomebrewSpellRecord`
- `HomebrewEquipmentRecord`
- `HomebrewMonsterRecord`
- `HomebrewSpellListRecord`

### `HomebrewRecordDocument`

One stored row: the authored body plus the three orthogonal row-state fields. `state` is set only by /publish and /unpublish, `visibleToPlayers` only by /visibility, `deletedAt` only by DELETE and /restore. A player sees a record only when it is published AND visible AND not deleted - and even then only through the merged CONTENT_PATHS catalogs, never through this component.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `type` | `class` \| `subclass` \| `species` \| `background` \| `feat` \| `spell` \| `equipment` \| `monster` \| `spell-list` | yes |  |
| `state` | `draft` \| `published` | yes |  |
| `visibleToPlayers` | boolean | yes | Publishing does not reveal: this is the separate, deliberate second step |
| `deletedAt` | string \| null | yes | Soft delete; a deleted row leaves every merged catalog at once and is restorable |
| `rev` | integer (≥ 0) | yes |  |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |
| `validity` | HomebrewValidity | yes |  |
| `record` | HomebrewRecord | yes |  |

### `HomebrewRecordSummary`

The flat, deliberately NON-polymorphic list row: a name and a badge. Carries `valid` alone - the issue list costs a GET - so listing a 300-record library never ships a 20-row level table.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `type` | `class` \| `subclass` \| `species` \| `background` \| `feat` \| `spell` \| `equipment` \| `monster` \| `spell-list` | yes |  |
| `name` | string | yes |  |
| `source` | const `"homebrew"` | yes | Always "homebrew" on this surface; the field exists so a summary and a merged-catalog row read the same |
| `state` | `draft` \| `published` | yes |  |
| `visibleToPlayers` | boolean | yes |  |
| `deletedAt` | string \| null | yes |  |
| `rev` | integer (≥ 0) | yes |  |
| `updatedAt` | string (date-time) | yes |  |
| `valid` | boolean | yes |  |
| `usageCount` | integer (≥ 0) | yes | How many characters took this record; 0 is the common case |

### `HomebrewRiderAttackBonus`

A flat bonus to the bearer's attack rolls. THE missing channel: the resolver's to-hit was the action's printed bonus plus exhaustion and nothing else could reach it.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"attack-bonus"` | yes |  |
| `amount` | integer (-10–10) | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewRiderExtraDamage`

Extra TYPED damage as dice. Neither older channel can serve it: the effect-side `damage-bonus` is a flat integer, and an attack's `criticalBonusDice` is a bare count applied to the first damage part, so it cannot carry a damage type. `doubleOnCritical` defaults false because 5e does not double dice added after the attack.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"extra-damage"` | yes |  |
| `formula` | string (pattern) | yes | One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008) |
| `damageType` | string | yes |  |
| `doubleOnCritical` | boolean | no | Default: `false`. |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewRiderRollMode`

Advantage or disadvantage on a NAMED roll: one branch with a `mode` field rather than two per roll kind. It feeds the same aggregation that already implements 5e cancellation (any advantage plus any disadvantage is normal) and labels each source on the roll card, so a curse is `mode: "disadvantage"` and needs no separate machinery.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"roll-mode"` | yes |  |
| `roll` | `attack` \| `incoming-attack` \| `save` \| `check` \| `initiative` \| `death-save` \| `concentration` | yes |  |
| `mode` | `advantage` \| `disadvantage` | yes |  |
| `when` | HomebrewRiderTrigger[] | no | AND-list of at most four triggers gating this rider, with at most ONE moment. Empty = always. A filter with no moment is rejected: it has nothing to narrow Default: `[]`. |
| `scope` | `bearer` \| `this-item` | no | What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer" |

### `HomebrewRiderTrigger`

WHEN a rider applies. Thirty named triggers in four KINDS, and the kind decides the evaluation layer so a GM never picks one: a `static-gate` is resolvable from the sheet alone and bakes into a standing number; a `dynamic-gate` reads live actor state and becomes a labelled note re-checked per roll; a `moment` fires at the named roll or event; a `filter` narrows whatever moment it accompanies. This is DATA, not an expression language - every member is a closed object with bounded parameters, and there is no OR, no NOT, no nesting and no arithmetic (ADR-0008). The eleven parameterless MOMENTS share one component (HomebrewTriggerMoment) carrying an eleven-value `type` enum, so the twenty branches below cover all thirty names.

One of the following, discriminated by `type`:

- `HomebrewTriggerAttuned`
- `HomebrewTriggerWhileArmored`
- `HomebrewTriggerWhileUnarmored`
- `HomebrewTriggerWhileShield`
- `HomebrewTriggerWhileCharacterIs`
- `HomebrewTriggerWhileProficientWith`
- `HomebrewTriggerWhileEffectTag`
- `HomebrewTriggerWhileHpAtOrBelow`
- `HomebrewTriggerWhileCondition`
- `HomebrewTriggerMoment`
- `HomebrewTriggerAttackKindIs`
- `HomebrewTriggerWeaponPropertyIs`
- `HomebrewTriggerDamageTypeIs`
- `HomebrewTriggerAbilityIs`
- `HomebrewTriggerSkillIs`
- `HomebrewTriggerSpellSchoolIs`
- `HomebrewTriggerSpellLevelIs`
- `HomebrewTriggerVersusCreatureType`
- `HomebrewTriggerVersusSize`
- `HomebrewTriggerVersusCondition`

### `HomebrewSpeciesRecord`

A playable species. NOTE the deliberate absence of required ability bonuses: SRD 5.2.1 puts ability increases on the BACKGROUND. `abilityBonuses` exists anyway as optional data so a 2014-style or homebrew species can still carry them, and the builder applies whatever a record declares instead of assuming an edition.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `summary` | string | no | Short blurb for the wizard's pick card |
| `description` | string | no | Long prose. Always the display source of truth; the structured riders only add mechanics on top |
| `attribution` | string | no | Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead |
| `type` | const `"species"` | yes |  |
| `sizes` | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan`[] | no | A list because several 2024 species let the player pick Small or Medium Default: `["medium"]`. |
| `speedFeet` | integer (0–120) | yes |  |
| `darkvisionFeet` | integer \| null | no | Default: `null`. |
| `creatureType` | string (pattern) | no | Default: `"humanoid"`. |
| `abilityBonuses` | object[] | no |  |
| `abilityBonuses[].ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `abilityBonuses[].amount` | integer (-2–3) | yes |  |
| `abilityBonusChoice` | object | no | "Choose N abilities to raise by M" - the 2014 variant-human pattern |
| `abilityBonusChoice.choose` | integer (1–6) | yes |  |
| `abilityBonusChoice.amount` | integer (1–3) | yes |  |
| `abilityBonusChoice.from` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | no | Default: `["str","dex","con","int","wis","cha"]`. |
| `languages` | string (pattern)[] | no |  |
| `languageChoices` | HomebrewChoiceList | no |  |
| `traits` | HomebrewFeature[] | no |  |
| `lineages` | object[] | no | Lineages / subraces, each adding its own traits on top |
| `lineages[].id` | string (pattern) | yes |  |
| `lineages[].name` | string | yes |  |
| `lineages[].description` | string | no |  |
| `lineages[].traits` | HomebrewFeature[] | no |  |

### `HomebrewSpellListRecord`

A spell list as a membership OVERLAY, never an edit to the generated spell bundle: `basedOn` expands existing lists, `add` layers ids on top, and `remove` always wins. That is what keeps "the Wizard list plus my three spells" ONE row instead of 221. A list resolving to ZERO spells is a hard character-creation rejection downstream, so publish-time validation refuses an empty one.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `summary` | string | no | Short blurb for the wizard's pick card |
| `description` | string | no | Long prose. Always the display source of truth; the structured riders only add mechanics on top |
| `attribution` | string | no | Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead |
| `type` | const `"spell-list"` | yes |  |
| `basedOn` | string (pattern)[] | no | Start from these existing list ids - SRD (`wizard`) or another overlay. Empty starts blank |
| `add` | string (pattern)[] | no | Spell ids added on top of the `basedOn` expansion. SRD spell ids are perfectly legal here |
| `remove` | string (pattern)[] | no | Spell ids removed last, after everything else |

### `HomebrewSpellRecord`

A spell. NO `summary`: `SpellReferenceSchema` never declared one, and the schema is a plain (non-strict) object, so a `summary` sent here would be silently dropped rather than rejected. `classes` carries the spell-list ids this spell belongs to - it is how a homebrew spell joins a list, paired with the class record's `spellcasting.spellListId`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"spell"` | yes |  |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `attribution` | string | no | Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead |
| `level` | integer (0–9) | yes | 0 is a cantrip |
| `school` | string | yes |  |
| `castingTime` | string | yes |  |
| `reactionCondition` | string \| null | yes | What triggers the reaction, for a spell cast as one; null otherwise |
| `range` | object | yes |  |
| `range.distance` | number \| null | yes |  |
| `range.unit` | string \| null | yes |  |
| `range.text` | string \| null | yes |  |
| `components` | object | yes |  |
| `components.verbal` | boolean | yes |  |
| `components.somatic` | boolean | yes |  |
| `components.material` | boolean | yes |  |
| `components.materialText` | string \| null | yes |  |
| `components.materialConsumed` | boolean | yes |  |
| `duration` | string | yes |  |
| `concentration` | boolean | yes |  |
| `ritual` | boolean | yes |  |
| `attackRoll` | boolean | yes |  |
| `damage` | object | yes |  |
| `damage.roll` | string \| null | yes | Base damage/healing roll ("8d6"), or null when the spell rolls nothing |
| `damage.types` | string[] | yes |  |
| `save` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` \| null | yes | Which save the target rolls; null when the spell forces none |
| `target` | object | yes |  |
| `target.type` | string \| null | yes |  |
| `target.count` | integer \| null | yes |  |
| `shape` | HomebrewSpellShape \| null | yes | The area of effect; null for a single-target spell |
| `classes` | string (pattern)[] | yes | Spell-list ids this spell belongs to ("wizard", a homebrew list slug). A HomebrewSpellListRecord can also pull a spell in without touching this |
| `description` | string | yes |  |
| `higherLevel` | string \| null | yes |  |
| `castingOptions` | object[] | yes | Per-slot-level upcast scaling; the sheet applies the row matching the chosen cast level |
| `castingOptions[].type` | string | yes |  |
| `castingOptions[].damageRoll` | string \| null | yes |  |
| `castingOptions[].targetCount` | integer \| null | yes |  |
| `castingOptions[].description` | string \| null | yes |  |

### `HomebrewSpellShape`

A spell's area of effect.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes |  |
| `size` | number \| null | yes |  |
| `unit` | string \| null | yes |  |

### `HomebrewSpellcasting`

Spellcasting a class - or a third-caster subclass - grants.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `prepares` | `known` \| `prepared` | yes | known = a fixed spells-known list; prepared = re-chosen on a long rest |
| `ritual` | boolean | no | Default: `false`. |
| `focus` | string \| null | no | Spellcasting focus slug (arcane-focus, holy-symbol, druidic-focus); null = none Default: `null`. |
| `multiclassProgression` | `full` \| `half` \| `third` \| `pact` | no | How this class's levels count toward the shared multiclass caster level Default: `"full"`. |
| `spellListId` | string (pattern) | no | The spell list this class draws from - an open slug, so a HomebrewSpellListRecord works. One of the seven derived-id fields a pack import rewrites (it also implies the `<listId>-spells` catalog slug) |

### `HomebrewStartingEquipmentOption`

A named starting-equipment bundle ("A: chain mail and a martial weapon", "C: 155 gp"). The chosen option's id is what lands in the character's choice ledger, so the items must be RESOLVABLE - a label alone can be displayed but never turned into inventory.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `label` | string | yes |  |
| `items` | object[] | no |  |
| `items[].id` | string (pattern) | yes |  |
| `items[].name` | string | yes |  |
| `items[].quantity` | integer (1–99) | no | Default: `1`. |
| `goldPieces` | integer (0–1000) | no | Default: `0`. |

### `HomebrewStatblockAction`

A stat block's action, in the exact `ActionSchema` vocabulary the live rules engine already resolves. Every mechanics field is optional: absent means "prose only", and the engine falls back to reference behavior.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `name` | string | yes |  |
| `activation` | `action` \| `bonus-action` \| `reaction` \| `other` | yes |  |
| `description` | string | yes | Always the display source of truth; every rider below only adds mechanics on top |
| `damage` | object[] | no |  |
| `damage[].formula` | string (pattern) | yes | One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008) |
| `damage[].type` | string | yes |  |
| `multiattack` | object[] | no | Compound action: resolving a component consumes the shared action slot once and tracks the rest |
| `multiattack[].actionId` | string (pattern) | yes |  |
| `multiattack[].count` | integer (1–4) | yes |  |
| `onHit` | HomebrewActionOnHit[] | no | Conditions applied to the target as one source-linked effect |
| `targetRules` | `not-grappled-by-source`[] | no | Targeting restrictions the engine enforces |
| `grants` | HomebrewEffectGrant | no | Resolving this action grants an effect to the actor itself (Rage, Reckless Attack) |
| `requiresEffectTag` | string (pattern) | no | The action requires an active self effect carrying this tag (Frenzy requires "raging") |
| `uses` | HomebrewActionUses | no | Limited uses; unlike a feature's, an action's may recharge on a d6 |
| `reaction` | object | no | A declared reaction the engine can offer as a pending prompt (Uncanny Dodge). Only meaningful on activation "reaction" |
| `reaction.trigger` | const `"hit-by-attack"` | yes |  |
| `reaction.response` | const `"half-damage"` | yes |  |
| `legendary` | object | no | SRD Legendary Action: taken on OTHER creatures' turns, spending `cost` from the per-round pool. Pairs with activation "other" |
| `legendary.cost` | integer (1–5) | yes |  |
| `attack` | object | no | A printed to-hit bonus - the stat block knows its own numbers |
| `attack.bonus` | integer | yes |  |
| `attack.reachFeet` | integer (≥ 1) | no |  |
| `attack.rangeFeet` | integer (≥ 1) | no |  |
| `attack.rangeNormalFeet` | integer (≥ 1) | no | Normal range for a two-range weapon ("80/320" -> 80); attacks beyond it up to rangeFeet roll at disadvantage |
| `attack.count` | integer (1–10) | no |  |
| `attack.criticalBonusDice` | integer (1–4) | no |  |
| `save` | object | no | A printed save DC |
| `save.ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `save.dc` | integer (1–40) | yes |  |

### `HomebrewSubclassRecord`

A subclass. Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own `spellcasting` and overlay extra table rows on the parent class's.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes | The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write - a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas |
| `name` | string | yes |  |
| `source` | `srd` \| `homebrew` | no | Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same Default: `"srd"`. |
| `summary` | string | no | Short blurb for the wizard's pick card |
| `description` | string | no | Long prose. Always the display source of truth; the structured riders only add mechanics on top |
| `attribution` | string | no | Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead |
| `type` | const `"subclass"` | yes |  |
| `classId` | string (pattern) | yes | The class this subclass belongs to. Re-minting a class id on pack import rewrites this - it is one of the seven derived-id fields |
| `subclassLevel` | integer (1–20) | no | The class level this subclass is taken at; omitted inherits the parent class's |
| `spellcasting` | HomebrewSpellcasting | no |  |
| `levelTable` | HomebrewClassLevelRow[] | no |  |
| `features` | HomebrewFeature[] | no |  |

### `HomebrewTriggerAbilityIs`

FILTER. Narrows a save or check moment to these abilities - what turns a bare `save-bonus` into "+1 to Dexterity saves".

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"ability-is"` | yes |  |
| `abilities` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha`[] | yes |  |

### `HomebrewTriggerAttackKindIs`

FILTER. Narrows a moment to these attack kinds. `reaction` and `opportunity` require the resolver to ANNOUNCE the trigger; until it does, they never match.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"attack-kind-is"` | yes |  |
| `kinds` | `melee` \| `ranged` \| `spell` \| `unarmed` \| `thrown` \| `reaction` \| `opportunity`[] | yes |  |

### `HomebrewTriggerAttuned`

STATIC GATE. The bearer is attuned. Redundant (and harmless) when the item's own `attunement.required` is already true.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"attuned"` | yes |  |

### `HomebrewTriggerDamageTypeIs`

FILTER. Narrows to these damage types.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"damage-type-is"` | yes |  |
| `damageTypes` | string[] | yes |  |

### `HomebrewTriggerMoment`

MOMENT. The named roll or event the rider fires at. All eleven moments are parameterless, so they are ONE component with an eleven-value `type` enum rather than eleven byte-identical components documenting nothing eleven times - the union's discriminator still maps each name individually. A `when` list may carry at most one moment: a rider fires at one moment, not two.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | `on-attack-roll` \| `on-hit` \| `on-critical-hit` \| `on-critical-miss` \| `on-damage-roll` \| `on-saving-throw` \| `on-ability-check` \| `on-initiative-roll` \| `on-death-save` \| `on-taking-damage` \| `on-spell-cast` | yes |  |

### `HomebrewTriggerSkillIs`

FILTER. Narrows a check moment to these skills (Gloves of Thievery: sleight-of-hand).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"skill-is"` | yes |  |
| `skills` | string (pattern)[] | yes |  |

### `HomebrewTriggerSpellLevelIs`

FILTER. Narrows a spell moment to these slot levels (0 is a cantrip).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"spell-level-is"` | yes |  |
| `levels` | integer (0–9)[] | yes |  |

### `HomebrewTriggerSpellSchoolIs`

FILTER. Narrows a spell moment to these schools.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"spell-school-is"` | yes |  |
| `schools` | string (pattern)[] | yes |  |

### `HomebrewTriggerVersusCondition`

FILTER. Narrows to targets currently under any of these conditions.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"versus-condition"` | yes |  |
| `conditionIds` | string (pattern)[] | yes |  |

### `HomebrewTriggerVersusCreatureType`

FILTER. Narrows to targets of these creature types. Authorable but INERT until an actor definition carries a creature type - it parses and stores, and starts matching the day that field lands.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"versus-creature-type"` | yes |  |
| `creatureTypes` | string (pattern)[] | yes |  |

### `HomebrewTriggerVersusSize`

FILTER. Narrows to targets of these sizes.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"versus-size"` | yes |  |
| `sizes` | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan`[] | yes |  |

### `HomebrewTriggerWeaponPropertyIs`

FILTER. Narrows to weapons carrying any of these property slugs (finesse, heavy, two-handed).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"weapon-property-is"` | yes |  |
| `properties` | string (pattern)[] | yes |  |

### `HomebrewTriggerWhileArmored`

STATIC GATE. The bearer is wearing armor. Omitting `weights` is exactly what `armor-class.whileArmored: true` has always meant.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-armored"` | yes |  |
| `weights` | `light` \| `medium` \| `heavy`[] | no |  |

### `HomebrewTriggerWhileCharacterIs`

STATIC GATE. The bearer is one of these classes or species. TWO lists in ONE trigger so "Paladin or Cleric" is a single entry rather than an OR; at least one id must be named.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-character-is"` | yes |  |
| `classIds` | string (pattern)[] | no | Default: `[]`. |
| `speciesIds` | string (pattern)[] | no | Default: `[]`. |

### `HomebrewTriggerWhileCondition`

DYNAMIC GATE. The bearer has (or, with `present: false`, lacks) any of these conditions.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-condition"` | yes |  |
| `conditionIds` | string (pattern)[] | yes |  |
| `present` | boolean | no | Default: `true`. |

### `HomebrewTriggerWhileEffectTag`

DYNAMIC GATE. The bearer has an active effect carrying any of these tags - the single-tag `requiresEffectTag` precedent, widened to a list.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-effect-tag"` | yes |  |
| `tags` | string (pattern)[] | yes |  |

### `HomebrewTriggerWhileHpAtOrBelow`

DYNAMIC GATE. The bearer is at or below this percentage of maximum hit points (a bloodied threshold).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-hp-at-or-below"` | yes |  |
| `percent` | integer (1–99) | yes |  |

### `HomebrewTriggerWhileProficientWith`

STATIC GATE. The bearer is proficient with any of the named weapons, armor, tools, or skills.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-proficient-with"` | yes |  |
| `kind` | `weapon` \| `armor` \| `tool` \| `skill` | yes |  |
| `ids` | string (pattern)[] | yes |  |

### `HomebrewTriggerWhileShield`

STATIC GATE. The bearer is wielding a shield - or, with `wielding: false`, is NOT, which is how the Dueling-style "only while not holding a shield" is said without a NOT operator.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-shield"` | yes |  |
| `wielding` | boolean | no | Default: `true`. |

### `HomebrewTriggerWhileUnarmored`

STATIC GATE. The bearer is wearing no armor; `allowShield` decides whether a shield still counts as unarmored (Barbarian yes, Monk no).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"while-unarmored"` | yes |  |
| `allowShield` | boolean | no | Default: `false`. |

### `HomebrewUsage`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `actorId` | string (uuid) | yes |  |
| `actorName` | string | yes |  |
| `kind` | string (pattern) | yes | How the record is used - open slug (character-choice, class, species, ...), never a closed enum |
| `detail` | string \| null | yes |  |

### `HomebrewUsagesData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (pattern) | yes |  |
| `usages` | HomebrewUsage[] | yes |  |
| `safeToDelete` | boolean | yes | Always true: a built character carries a flattened, self-contained ActorDefinition, so deleting a homebrew record never breaks an existing character. The usage list is context, not a blocker |

### `HomebrewUsesByAbility`

Uses equal to an ability modifier, floored at `minimum`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"ability-modifier"` | yes |  |
| `ability` | `str` \| `dex` \| `con` \| `int` \| `wis` \| `cha` | yes |  |
| `minimum` | integer (0–5) | no | Default: `1`. |

### `HomebrewUsesByLevel`

A printed per-level column.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"by-level"` | yes |  |
| `table` | object[] | yes |  |
| `table[].level` | integer (1–20) | yes |  |
| `table[].limit` | integer (0–99) | yes |  |

### `HomebrewUsesByProficiency`

Uses equal to the character's proficiency bonus.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | const `"proficiency-bonus"` | yes |  |

### `HomebrewValidationIssue`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string \| integer[] | yes | Field path into the authored record, e.g. ["levelTable", 3, "spellSlots"] - the offending field, machine-addressable, so a form editor can point at it instead of parsing prose |
| `message` | string | yes |  |
| `recordId` | string \| null | yes | Which record in a pack the issue belongs to; null for a single-record publish. Present-but-null, so a consumer never branches on key presence |

### `HomebrewValidity`

Whether a record may be published, and why not. Carried on every single-record read so the GM's library can say "3 drafts can't publish yet" without a round-trip per record.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `valid` | boolean | yes |  |
| `issues` | HomebrewValidationIssue[] | yes |  |

### `ImagePoint`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x` | number | yes |  |
| `y` | number | yes |  |

### `IntegrationCredentialAudit`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `events` | CredentialAuditEvent[] | yes |  |

### `IntegrationCredentialIssued`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `credential` | IntegrationCredentialMetadata | yes |  |
| `token` | string | yes | Shown exactly once; the server stores only a salted hash and cannot redisplay it. |

### `IntegrationCredentialList`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `credentials` | IntegrationCredentialMetadata[] | yes |  |

### `IntegrationCredentialMetadata`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `scopes` | `system:read` \| `game:read` \| `actor:read` \| `actor:write` \| `scene:read` \| `scene:write` \| `combat:read` \| `combat:write` \| `roll:create` \| `codex:read` \| `codex:write` \| `events:read` \| `webhooks:manage` \| `admin`[] | yes |  |
| `gameId` | string \| null | yes |  |
| `createdAt` | string (date-time) | yes |  |
| `expiresAt` | string \| null | yes |  |
| `lastUsedAt` | string \| null | yes |  |
| `revokedAt` | string \| null | yes |  |

### `MapAssetData`

GET responses use `asset` (full asset metadata); PATCH/scale/calibration-complete responses use `map` (catalog entry only).

One of the following:

- object
- object

### `MapAssetListData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `assets` | MapAssetMetadata[] | yes |  |

### `MapAssetMetadata`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `kind` | `battlemap` \| `regional` \| `world` | yes |  |
| `originalName` | string | yes |  |
| `format` | string | yes |  |
| `mediaType` | string | yes |  |
| `width` | integer (≥ 1) | yes |  |
| `height` | integer (≥ 1) | yes |  |
| `byteLength` | integer (≥ 1) | yes |  |
| `importedAt` | string (date-time) | yes |  |
| `calibration` | object \| null | yes |  |
| `scale` | object \| null | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `MapAssetUploadData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `asset` | MapAssetMetadata | yes |  |
| `duplicate` | boolean | yes |  |

### `MapCalibrationWizardData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `wizardId` | string (uuid) | yes |  |
| `state` | object (free-form) | yes |  |
| `overlay` | object (free-form)[] | yes |  |
| `overlayWarning` | string \| null | yes |  |

### `MapCatalogEntry`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `assetId` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `kind` | `battlemap` \| `regional` \| `world` | yes |  |
| `calibration` | object \| null | yes |  |
| `scale` | object \| null | yes |  |
| `createdAt` | string (date-time) | yes |  |
| `updatedAt` | string (date-time) | yes |  |

### `PlayerSessionIssuedData`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string | yes | Bearer token for player-limited calls; long-lived, not individually revocable (LAN trust). |
| `sessionId` | string (uuid) | yes |  |

### `SystemCapabilities`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `api` | object | yes |  |
| `api.version` | const `"1"` | yes |  |
| `api.namespace` | const `"/api/v1"` | yes |  |
| `realtime` | object | yes |  |
| `realtime.protocolVersion` | const `"1"` | yes |  |
| `realtime.transport` | const `"socket.io"` | yes |  |
| `supportedScopes` | `system:read` \| `game:read` \| `actor:read` \| `actor:write` \| `scene:read` \| `scene:write` \| `combat:read` \| `combat:write` \| `roll:create` \| `codex:read` \| `codex:write` \| `events:read` \| `webhooks:manage` \| `admin`[] | yes |  |
| `features` | object | yes |  |
| `features.webhooks` | boolean | yes |  |
| `features.viewer` | boolean | yes |  |
| `features.battlemapGridCalibration` | boolean | yes |  |
| `features.gameApi` | boolean | yes |  |
| `features.commandTunnel` | boolean | yes |  |
| `features.encounterArchives` | boolean | yes |  |
| `features.rulesEngine` | boolean | yes |  |

### `SystemHealth`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | const `"ok"` | yes |  |
| `serverTime` | string (date-time) | yes |  |

### `SystemVersion`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `applicationVersion` | string | yes |  |
| `apiVersion` | const `"1"` | yes |  |
| `realtimeProtocolVersion` | const `"1"` | yes |  |
| `schemaVersions` | object | yes |  |
| `schemaVersions.actorDefinition` | integer (≥ 1) | yes |  |

---

*Generated from `@vtt/api-contract` (API v1). The served `/api/v1/openapi.json` is always the authoritative machine contract.*
