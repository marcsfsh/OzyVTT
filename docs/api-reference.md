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

The bundled SRD 5.2.1 content (CC BY 4.0): bestiary, runnable action summaries, and condition reference.

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

The bundled SRD condition reference (public information - any GM, player, or integration session).

**Auth:** Integration credential with `game:read` · GM session · Player session (own-character limits apply)

**Responses:** `200` Condition reference entries - envelope of `ContentConditionsData` · errors `401` `403`

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

### `CodexInWorldDate`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `year` | integer | yes |  |
| `month` | integer (0–23) | yes |  |
| `day` | integer (1–400) | yes |  |

### `ImagePoint`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x` | number | yes |  |
| `y` | number | yes |  |

---

*Generated from `@vtt/api-contract` (API v1). The served `/api/v1/openapi.json` is always the authoritative machine contract.*
