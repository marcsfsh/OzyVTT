# Combat-First VTT Integration API - API reference (v1)

<!-- GENERATED FILE - do not edit by hand. -->
<!-- Rendered from packages/api-contract (the same document served at /api/v1/openapi.json). -->
<!-- Regenerate: npm run docs:generate -w @vtt/api-contract -->

Versioned, recipient-safe integration contract for a self-hosted VTT. Every write accepts an optional `commandId` (UUID): supply your own and resend it to retry safely - the server executes a commandId exactly once and replays the stored outcome with `duplicate: true`. Omitting it mints one server-side (echoed in the response), which is convenient but gives a lost response no safe retry. `expectedRevision` rejects stale writes with 409 + `error.currentRevision`.

- **Base path:** `/api/v1` on the LAN host (default port 3001).
- **Machine-readable contract:** `GET /api/v1/openapi.json` serves the OpenAPI 3.1 document this reference is generated from, byte-identical to `@vtt/api-contract`.
- **Realtime sibling:** the built-in clients drive the same commands over Socket.IO (protocol version 1); command `type` strings below are shared between both transports.
- **Webhooks / server push:** not part of v1 core yet - poll with ETags (below).

## Authentication

Every request authenticates with `Authorization: Bearer <token>` (the viewer's cookie is the one exception). Three principal kinds exist:

| Principal | Token | Authority |
| --- | --- | --- |
| **GM session** | from `POST /api/gm/login` (GM password; same-origin only) | Everything, including credential management. |
| **Player session** | issued when a player joins the table | Exactly the table's player limits: player-safe projections, own claimed character only. |
| **Integration credential** | `vtt_int_…`, minted by the GM (below) | GM authority, filtered by the credential's scopes. Rotatable, revocable, audited. |

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
| `events:read` | Reserved for the future event stream. |
| `webhooks:manage` | Reserved for future webhooks. |
| `admin` | Every scope, including destructive operations (archive deletion). Grant sparingly. |

## Conventions

- **Envelopes.** Success: `{ "ok": true, "apiVersion": "1", "data": … }`. Failure: `{ "ok": false, "apiVersion": "1", "error": { "code", "message", "requestId", "details"?, "currentRevision"?, "retryAfterSeconds"? } }`.
- **Request IDs.** Send `X-Request-Id` (UUID) to correlate; the server echoes it (minting one otherwise) on the response header and in error bodies.
- **Idempotency.** Every write accepts `commandId` (UUID). The server executes each commandId exactly once; retries replay the stored outcome with `duplicate: true`. Omitted ids are minted server-side and echoed - supply your own whenever you might need to retry.
- **Optimistic concurrency.** Pass `expectedRevision` to reject writes against a state you haven't seen; a stale value returns `409` with `error.currentRevision`.
- **Error statuses.** `400 validation_failed` (malformed request, `details.issues`), `401 unauthenticated` (no token), `403 forbidden` (invalid/revoked/underscoped token, or a role denial), `404 not_found`, `409 conflict` for everything the game itself refuses - rule rejections, stale revisions, and timeline confirmations (`details.needsConfirm`: resend with `confirmRewrite`/`confirmDiscard`), `413` oversized body (limit 512kb).
- **Polling.** `GET /game` sends a weak ETag derived from the revision; send `If-None-Match` to get free `304`s. Presence and timed-annotation expiry don't bump the revision - re-fetch when you need those fresh.
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

## Encounter archive document (`archiveSchemaVersion` 2)

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
| `scopes` | `system:read` \| `game:read` \| `actor:read` \| `actor:write` \| `scene:read` \| `scene:write` \| `combat:read` \| `combat:write` \| `roll:create` \| `events:read` \| `webhooks:manage` \| `admin`[] | yes |  |
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

Each row also carries display values - `description`, `attackBonus`, `reachFeet`, `rangeFeet`, `rangeNormalFeet`, `attackCount`, `saveAbility`, `saveDc`, `damage[]`, `usesLimit`, `usesPer`, `usesPool`, `requiresEffectTag`, `multiattack`, `reaction`. They are read off the actor's *effective* action list, so they already include the standing riders of whatever is equipped and attuned, and they are the only way a client can render an action an equipped item derived (a wand's charge, an amulet's cast, a magic weapon's swing) - those are absent from the stat block entirely. They are display values: resolution still takes only the `id` and recomputes through the same function, so a preview built from these cannot disagree with the roll.

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

Permanent, machine-readable records of ended encounters - see the archive document section above for the full v2 shape. GM-grade principals only.

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

## Codex (worldbuilding wiki, atlas, journal & calendar)

The GM-authored worldbuilding surface: typed wiki pages (with folders, tags, backlinks, relationships and revision history), the nested map atlas and its markers, the campaign journal/timeline, and the fantasy calendar - plus page media. Reads accept a GM or a player session; a player receives the revealed-only projection (GM bodies, GM fields, and unrevealed pages/maps/markers/entries are stripped server-side). Every write is GM-only.

### `GET /api/v1/codex/pages`

Every page's summary (a player sees only revealed pages). Optional `folder` (empty string = top level) and `tag` filters.

**Auth:** GM session · Player session (own-character limits apply)

**Parameters:** `folder` (query, optional) - string · `tag` (query, optional) - string

**Responses:** `200` Success - envelope of `CodexPageListData` · errors `401`

### `POST /api/v1/codex/pages`

Creates a page.

**Auth:** GM session

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

**Responses:** `201` Success - envelope of `CodexPageData` · errors `400` `401`

### `GET /api/v1/codex/search`

Full-text page search, role-scoped. `q` is the query.

**Auth:** GM session · Player session (own-character limits apply)

**Parameters:** `q` (query, optional) - string

**Responses:** `200` Success - envelope of `CodexSearchData` · errors `401`

### `GET /api/v1/codex/pages/{id}`

One page with its backlinks and typed relationships, projected for the caller.

**Auth:** GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexPageDocumentData` · errors `401` `404`

### `PATCH /api/v1/codex/pages/{id}`

Edits a page. `expectedRev` rejects a stale write with 409.

**Auth:** GM session

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
| `expectedRev` | integer (≥ 0) | no | Optimistic concurrency: reject with 409 if the page moved on. |

**Responses:** `200` Success - envelope of `CodexPageData` · errors `400` `401` `404` `409`

### `DELETE /api/v1/codex/pages/{id}`

Deletes a page; idempotent.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401`

### `POST /api/v1/codex/pages/{id}/reveal`

Shows/hides a page to players.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexPageData` · errors `400` `401` `404`

### `POST /api/v1/codex/pages/{id}/relationships`

Adds a typed relationship edge from this page to another.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `toPageId` | string (uuid) | yes |  |
| `type` | string | yes |  |

**Responses:** `201` Success - envelope of `CodexRelationshipData` · errors `400` `401` `404`

### `GET /api/v1/codex/pages/{id}/revisions`

Autosaved revision history for a page.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexRevisionListData` · errors `401` `404`

### `POST /api/v1/codex/pages/{id}/revisions/{revisionId}/restore`

Restores a page to a prior revision.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid) · `revisionId` (path) - integer (≥ 1)

**Responses:** `200` Success - envelope of `CodexPageData` · errors `400` `401` `404`

### `GET /api/v1/codex/folders`

Every explicitly-created folder path; lets an empty folder persist.

**Auth:** GM session

**Responses:** `200` Success - envelope of `CodexFolderListData` · errors `401`

### `POST /api/v1/codex/folders`

Creates (or keeps) an empty folder.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes |  |

**Responses:** `201` Success - envelope of `CodexFolderCreatedData` · errors `400` `401`

### `POST /api/v1/codex/folders/move`

Renames/moves a folder subtree, re-pathing every page under it. Returns how many pages moved.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | string | yes |  |
| `to` | string | yes | Empty string moves the folder to the top level. |

**Responses:** `200` Success - envelope of `CodexFolderMovedData` · errors `400` `401`

### `POST /api/v1/codex/folders/delete`

Deletes a folder and its subfolders; every page under it drops to the top level - never deleted.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes |  |

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `400` `401`

### `GET /api/v1/codex/relationships`

Every relationship edge for the graph, role-scoped (a player sees only edges whose BOTH endpoints are revealed).

**Auth:** GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexRelationshipEdgeListData` · errors `401`

### `DELETE /api/v1/codex/relationships/{id}`

Removes one relationship edge; idempotent.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401`

### `GET /api/v1/codex/maps`

The atlas map tree, role-scoped (a player sees only revealed maps; a revealed map keeps its parent link only when that parent is itself revealed).

**Auth:** GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexMapListData` · errors `401`

### `POST /api/v1/codex/maps`

Turns an uploaded map asset into an atlas map node.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `assetId` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `kind` | `battlemap` \| `regional` \| `world` | yes |  |
| `parentMapId` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |

**Responses:** `201` Success - envelope of `CodexMapData` · errors `400` `401` `404`

### `PATCH /api/v1/codex/maps/{id}`

Renames/retypes a map.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no |  |
| `kind` | `battlemap` \| `regional` \| `world` | no |  |

**Responses:** `200` Success - envelope of `CodexMapData` · errors `400` `401` `404`

### `DELETE /api/v1/codex/maps/{id}`

Deletes a map and its markers; idempotent.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401`

### `POST /api/v1/codex/maps/{id}/parent`

Re-parents a map in the atlas tree (null = a root map).

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `parentMapId` | string \| null | yes |  |

**Responses:** `200` Success - envelope of `CodexMapData` · errors `400` `401` `404`

### `POST /api/v1/codex/maps/{id}/reveal`

Shows/hides a map to players.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexMapData` · errors `400` `401` `404`

### `GET /api/v1/codex/maps/{id}/markers`

Markers on a map, role-scoped (a player only for a revealed map, and each pin's links filtered to the revealed subset).

**Auth:** GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexMarkerListData` · errors `401` `404`

### `POST /api/v1/codex/maps/{id}/markers`

Drops a marker on a map.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
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

**Responses:** `201` Success - envelope of `CodexMarkerData` · errors `400` `401` `404`

### `PATCH /api/v1/codex/markers/{id}`

Edits a marker's icon/label/links.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
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

**Responses:** `200` Success - envelope of `CodexMarkerData` · errors `400` `401` `404`

### `DELETE /api/v1/codex/markers/{id}`

Deletes a marker; idempotent.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401`

### `POST /api/v1/codex/markers/{id}/move`

Repositions a marker in normalized map coordinates.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x` | number (0–1000000) | yes |  |
| `y` | number (0–1000000) | yes |  |

**Responses:** `200` Success - envelope of `CodexMarkerData` · errors `400` `401` `404`

### `POST /api/v1/codex/markers/{id}/reveal`

Shows/hides a marker to players.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexMarkerData` · errors `400` `401` `404`

### `GET /api/v1/codex/journal`

The campaign timeline, or a location's mini-timeline via `markerId`/`pageId`, role-scoped (a player only for a revealed marker/page, and only revealed entries).

**Auth:** GM session · Player session (own-character limits apply)

**Parameters:** `markerId` (query, optional) - string (uuid) · `pageId` (query, optional) - string (uuid)

**Responses:** `200` Success - envelope of `CodexJournalListData` · errors `401` `404`

### `POST /api/v1/codex/journal`

Adds a journal/timeline entry.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `playerText` | string | no |  |
| `gmText` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `attachMarkerId` | string \| null | no |  |
| `attachPageId` | string \| null | no |  |
| `sessionNumber` | integer \| null | no |  |
| `realDate` | string \| null | no |  |
| `inWorldLabel` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no |  |

**Responses:** `201` Success - envelope of `CodexJournalEntryData` · errors `400` `401`

### `PATCH /api/v1/codex/journal/{id}`

Edits a journal entry.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `playerText` | string | no |  |
| `gmText` | string \| null | no |  |
| `revealedToPlayers` | boolean | no |  |
| `attachMarkerId` | string \| null | no |  |
| `attachPageId` | string \| null | no |  |
| `sessionNumber` | integer \| null | no |  |
| `realDate` | string \| null | no |  |
| `inWorldLabel` | string \| null | no |  |
| `inWorldDate` | CodexInWorldDate \| null | no |  |

**Responses:** `200` Success - envelope of `CodexJournalEntryData` · errors `400` `401` `404`

### `DELETE /api/v1/codex/journal/{id}`

Deletes a journal entry; idempotent.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Success - envelope of `CodexDeletedData` · errors `401`

### `POST /api/v1/codex/journal/{id}/reveal`

Shows/hides a journal entry to players.

**Auth:** GM session

**Parameters:** `id` (path) - string (uuid)

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `revealed` | boolean | yes |  |

**Responses:** `200` Success - envelope of `CodexJournalEntryData` · errors `400` `401` `404`

### `GET /api/v1/codex/calendar`

The world's calendar (months, weekdays, era, current date).

**Auth:** GM session · Player session (own-character limits apply)

**Responses:** `200` Success - envelope of `CodexCalendarData` · errors `401`

### `PUT /api/v1/codex/calendar`

Replaces the world calendar.

**Auth:** GM session

**Request body** (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `yearName` | string | yes |  |
| `months` | CodexCalendarMonth[] | yes |  |
| `weekdays` | string[] | yes |  |
| `currentDate` | CodexInWorldDate \| null | no |  |

**Responses:** `200` Success - envelope of `CodexCalendarData` · errors `400` `401`

### `GET /api/v1/codex/export`

A full codex backup bundle for round-trip.

**Auth:** GM session

**Responses:** `200` Success - envelope of `CodexExportData` · errors `401`

### `POST /api/v1/codex-assets`

Uploads a page image (banner or inline) as raw bytes in the request body; `filename` is a query parameter. Content-addressed: identical bytes return the existing asset with 200 instead of 201.

**Auth:** GM session

**Parameters:** `filename` (query, optional) - string

**Request body:** raw `image/*` bytes.

**Responses:** `200` Identical bytes already stored; the existing asset is returned - envelope of `CodexAssetUploadData` · `201` New image stored - envelope of `CodexAssetUploadData` · errors `400` `401`

### `GET /api/v1/codex-assets/{id}/content`

Original image bytes for a page banner/inline image. GM always; a player only when the asset is used by a revealed page. Supports ETag/If-None-Match (304); sent with `Cache-Control: private, no-store`.

**Auth:** GM session · Player session (own-character limits apply)

**Parameters:** `id` (path) - string (uuid)

**Responses:** `200` Full image bytes · `304` Not modified · errors `403` `404`

## Shared shapes

### `AnnotationGeometryInput`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `origin` | ImagePoint | yes |  |
| `target` | ImagePoint | yes |  |

### `CodexCalendarMonth`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `days` | integer (1–400) | yes |  |

### `CodexInWorldDate`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `year` | integer | yes |  |
| `month` | integer (0–23) | yes |  |
| `day` | integer (1–400) | yes |  |

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

### `ImagePoint`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x` | number | yes |  |
| `y` | number | yes |  |

---

*Generated from `@vtt/api-contract` (API v1). The served `/api/v1/openapi.json` is always the authoritative machine contract.*
