# App map (generated - do not edit by hand)

Regenerate with `npm run map`. A freshness test (`apps/server/test/app-map.test.ts`) fails
if this drifts from the code, so it is always current. This is an orientation aid: it maps the
machine-derivable surfaces of the app (state shape, command catalog, HTTP paths) plus a curated
file index. For narrative context read `CLAUDE.md`, `docs/ai-ledger/current-state.md`, and
`docs/ai-context/`; the `vtt-orientation` skill routes you here first.

- API version `1` · realtime protocol `1`
- 6 GameState fields · 60 commands · 93 HTTP paths

## GameState shape

Top-level fields of the authoritative `GameState` (`packages/domain` `GameStateSchema`), the
single JSON blob the server persists and projects per role.

- `actors`
- `combat`
- `definitions`
- `revision`
- `rolls`
- `schemaVersion`

## Commands

The mutation surface shared by both transports (Socket.IO + HTTP `/api/v1`); each requires the
listed integration scope (`GAME_COMMAND_SCOPES` in `packages/api-contract`). Adding one walks the
pipeline: domain `ClientToServerEvents` -> `game-commands.ts` schema -> this map + an OpenAPI
operation -> `game-operations.ts` handler + registry -> `server.ts` socket line -> `game-http.ts`
route -> projection decision.

Namespaces: `action`, `actor`, `annotation`, `character`, `death-save`, `dice`, `effect`, `encounter`, `fog`, `initiative`, `reaction`, `save`, `scene`, `token`, `turn`.

| Command | Scope |
| --- | --- |
| `action.resolve` | `combat:write` |
| `actor.add-from-definition` | `actor:write` |
| `actor.apply-damage` | `actor:write` |
| `actor.heal` | `actor:write` |
| `actor.import-definition` | `actor:write` |
| `actor.remove` | `actor:write` |
| `actor.rest` | `actor:write` |
| `actor.set-condition` | `actor:write` |
| `actor.set-health-display` | `actor:write` |
| `actor.set-hp` | `actor:write` |
| `actor.set-size` | `actor:write` |
| `actor.set-speed` | `actor:write` |
| `actor.set-temp-hp` | `actor:write` |
| `actor.set-token-image` | `actor:write` |
| `actor.set-visibility` | `actor:write` |
| `actor.spend-hit-dice` | `actor:write` |
| `annotation.add` | `combat:write` |
| `annotation.clear` | `combat:write` |
| `annotation.move` | `combat:write` |
| `annotation.ping` | `combat:write` |
| `annotation.remove` | `combat:write` |
| `annotation.set-color` | `combat:write` |
| `annotation.set-movable` | `combat:write` |
| `annotation.set-visibility` | `combat:write` |
| `character.claim` | `actor:write` |
| `character.force-release` | `actor:write` |
| `character.release` | `actor:write` |
| `death-save.roll` | `combat:write` |
| `dice.roll` | `roll:create` |
| `effect.add` | `combat:write` |
| `effect.end` | `combat:write` |
| `encounter.add-combatant` | `combat:write` |
| `encounter.end` | `combat:write` |
| `encounter.set-environment` | `combat:write` |
| `encounter.set-health-display` | `combat:write` |
| `encounter.set-roll-mode` | `combat:write` |
| `encounter.set-rules-mode` | `combat:write` |
| `encounter.start` | `combat:write` |
| `fog.paint` | `scene:write` |
| `fog.reset` | `scene:write` |
| `fog.set-enabled` | `scene:write` |
| `initiative.next` | `combat:write` |
| `initiative.previous` | `combat:write` |
| `initiative.set` | `combat:write` |
| `reaction.answer` | `combat:write` |
| `reaction.dismiss` | `combat:write` |
| `save.answer` | `combat:write` |
| `save.dismiss` | `combat:write` |
| `scene.activate` | `scene:write` |
| `scene.create` | `scene:write` |
| `scene.duplicate` | `scene:write` |
| `scene.remove` | `scene:write` |
| `scene.rename` | `scene:write` |
| `scene.reorder` | `scene:write` |
| `scene.set-combatants` | `scene:write` |
| `token.move` | `combat:write` |
| `turn.end` | `combat:write` |
| `turn.use` | `combat:write` |
| `turn.use-legendary` | `combat:write` |
| `turn.use-reaction` | `combat:write` |

## HTTP surface

Every path in the served OpenAPI document (`GET /api/v1/openapi.json`, byte-identical to
`@vtt/api-contract`).

- `GET /api/v1/content/conditions`
- `GET /api/v1/content/monsters`
- `GET /api/v1/content/monsters/{definitionId}`
- `GET /api/v1/content/monsters/{definitionId}/actions`
- `GET /api/v1/encounters`
- `DELETE GET /api/v1/encounters/{id}`
- `GET /api/v1/game`
- `POST /api/v1/game/actions/resolve`
- `POST /api/v1/game/actors`
- `DELETE /api/v1/game/actors/{actorId}`
- `GET /api/v1/game/actors/{actorId}/available-actions`
- `POST /api/v1/game/actors/{actorId}/conditions`
- `POST /api/v1/game/actors/{actorId}/damage`
- `POST /api/v1/game/actors/{actorId}/death-save`
- `POST /api/v1/game/actors/{actorId}/effects`
- `POST /api/v1/game/actors/{actorId}/effects/{effectId}/end`
- `POST /api/v1/game/actors/{actorId}/heal`
- `POST /api/v1/game/actors/{actorId}/health-display`
- `POST /api/v1/game/actors/{actorId}/hp`
- `POST /api/v1/game/actors/{actorId}/rest`
- `POST /api/v1/game/actors/{actorId}/size`
- `POST /api/v1/game/actors/{actorId}/speed`
- `POST /api/v1/game/actors/{actorId}/spend-hit-dice`
- `POST /api/v1/game/actors/{actorId}/temp-hp`
- `POST /api/v1/game/actors/{actorId}/token-image`
- `POST /api/v1/game/actors/{actorId}/visibility`
- `POST /api/v1/game/annotations`
- `DELETE /api/v1/game/annotations/{id}`
- `POST /api/v1/game/annotations/{id}/color`
- `POST /api/v1/game/annotations/{id}/movable`
- `POST /api/v1/game/annotations/{id}/move`
- `POST /api/v1/game/annotations/{id}/visibility`
- `POST /api/v1/game/annotations/clear`
- `POST /api/v1/game/annotations/ping`
- `POST /api/v1/game/claims`
- `POST /api/v1/game/claims/{actorId}/force-release`
- `POST /api/v1/game/claims/release`
- `GET POST /api/v1/game/commands`
- `POST /api/v1/game/definitions/import`
- `POST /api/v1/game/encounter/combatants`
- `POST /api/v1/game/encounter/end`
- `POST /api/v1/game/encounter/environment`
- `POST /api/v1/game/encounter/health-display`
- `POST /api/v1/game/encounter/roll-mode`
- `POST /api/v1/game/encounter/rules-mode`
- `POST /api/v1/game/encounter/start`
- `POST /api/v1/game/fog/enabled`
- `POST /api/v1/game/fog/paint`
- `POST /api/v1/game/fog/reset`
- `POST /api/v1/game/initiative/next`
- `POST /api/v1/game/initiative/previous`
- `POST /api/v1/game/initiative/set`
- `GET /api/v1/game/log`
- `POST /api/v1/game/reactions/{reactionId}/answer`
- `POST /api/v1/game/reactions/{reactionId}/dismiss`
- `POST /api/v1/game/rolls`
- `POST /api/v1/game/saves/{saveId}/answer`
- `POST /api/v1/game/saves/{saveId}/dismiss`
- `POST /api/v1/game/scenes`
- `DELETE /api/v1/game/scenes/{sceneId}`
- `POST /api/v1/game/scenes/{sceneId}/activate`
- `POST /api/v1/game/scenes/{sceneId}/combatants`
- `POST /api/v1/game/scenes/{sceneId}/duplicate`
- `POST /api/v1/game/scenes/{sceneId}/rename`
- `POST /api/v1/game/scenes/reorder`
- `POST /api/v1/game/tokens/{actorId}/move`
- `POST /api/v1/game/turn/end`
- `POST /api/v1/game/turn/legendary`
- `POST /api/v1/game/turn/reaction`
- `POST /api/v1/game/turn/use`
- `GET POST /api/v1/gm/integration-credentials`
- `GET /api/v1/gm/integration-credentials/{id}/audit`
- `POST /api/v1/gm/integration-credentials/{id}/revoke`
- `POST /api/v1/gm/integration-credentials/{id}/rotate`
- `GET POST /api/v1/map-assets`
- `GET PATCH /api/v1/map-assets/{id}`
- `POST /api/v1/map-assets/{id}/calibration/wizards`
- `POST /api/v1/map-assets/{id}/calibration/wizards/{wizardId}/actions`
- `POST /api/v1/map-assets/{id}/calibration/wizards/{wizardId}/complete`
- `GET /api/v1/map-assets/{id}/content`
- `PUT /api/v1/map-assets/{id}/scale`
- `GET /api/v1/openapi.json`
- `POST /api/v1/sessions/player`
- `GET /api/v1/system/capabilities`
- `GET /api/v1/system/health`
- `GET /api/v1/system/version`
- `GET /api/v1/viewer/access`
- `DELETE /api/v1/viewer/access/{id}`
- `GET /api/v1/viewer/events`
- `POST /api/v1/viewer/pairings`
- `POST /api/v1/viewer/pairings/exchange`
- `GET /api/v1/viewer/presentation`
- `POST /api/v1/viewer/presentation/commands`

## Where things live

Curated pointers (verify line numbers before relying on them - code moves):

- **Wire contract (single source):** `packages/domain/src/index.ts` - `GameState`, projections (`PlayerView`/`GmView`), `ClientToServerEvents`/`ServerToClientEvents`.
- **Persisted/importable schemas:** `packages/schemas/src/index.ts` - `Actor`, `ActorDefinition`.
- **Command Zod schemas:** `apps/server/src/game-commands.ts`.
- **Command handlers + registry:** `apps/server/src/game-operations.ts`.
- **Scopes + OpenAPI:** `packages/api-contract/src/index.ts`.
- **Projections (GM/player security boundary):** `apps/server/src/projections.ts`.
- **Public viewer projection:** `apps/server/src/viewer-encounter.ts`, `viewer-presentation.ts`.
- **Persistence (SQLite):** `apps/server/src/game-store.ts`.
- **Rules engine:** `apps/server/src/{action-resolution,saving-throws,hit-points,rests,condition-rules}.ts`.
- **Shared 5e math:** `packages/rules-5e/src/{dice,combat,character}.ts`.
- **SRD content bundles:** `packages/content-srd-5.2.1`.
- **Client entry points:** `apps/client/src/{main,viewer-main,styleguide-main}.tsx`.
- **Design system:** `packages/ui/src/index.ts` (+ the `/styleguide` route).
