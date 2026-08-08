# App map (generated - do not edit by hand)

Regenerate with `npm run map`. A freshness test (`apps/server/test/app-map.test.ts`) fails
if this drifts from the code, so it is always current. This is an orientation aid: it maps the
machine-derivable surfaces of the app (state shape, command catalog, HTTP paths) plus a curated
file index. For narrative context read `CLAUDE.md`, `docs/ai-ledger/current-state.md`, and
`docs/ai-context/`; the `vtt-orientation` skill routes you here first.

- API version `1` · realtime protocol `1`
- 11 GameState fields · 87 commands · 192 HTTP paths

## GameState shape

Top-level fields of the authoritative `GameState` (`packages/domain` `GameStateSchema`), the
single JSON blob the server persists and projects per role.

- `actors`
- `builderPolicy`
- `combat`
- `definitions`
- `partyVisibility`
- `pendingImports`
- `revision`
- `rolls`
- `rulesPolicy`
- `schemaVersion`
- `stagingDefaults`

## Commands

The mutation surface shared by both transports (Socket.IO + HTTP `/api/v1`); each requires the
listed integration scope (`GAME_COMMAND_SCOPES` in `packages/api-contract`). Adding one walks the
pipeline: domain `ClientToServerEvents` -> `game-commands.ts` schema -> this map + an OpenAPI
operation -> `game-operations.ts` handler + registry -> `server.ts` socket line -> `game-http.ts`
route -> projection decision.

Namespaces: `action`, `actor`, `annotation`, `builder`, `character`, `damage`, `death-save`, `dice`, `effect`, `encounter`, `fog`, `initiative`, `reaction`, `replay`, `rules`, `save`, `scene`, `table`, `token`, `turn`.

| Command | Scope |
| --- | --- |
| `action.resolve` | `combat:write` |
| `action.use` | `combat:write` |
| `actor.add-from-definition` | `actor:write` |
| `actor.apply-damage` | `actor:write` |
| `actor.heal` | `actor:write` |
| `actor.import-definition` | `actor:write` |
| `actor.rechoose` | `actor:write` |
| `actor.remove` | `actor:write` |
| `actor.rest` | `actor:write` |
| `actor.set-archived` | `actor:write` |
| `actor.set-condition` | `actor:write` |
| `actor.set-health-display` | `actor:write` |
| `actor.set-hp` | `actor:write` |
| `actor.set-sheet-preview` | `actor:write` |
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
| `builder.roll-abilities` | `actor:write` |
| `builder.set-policy` | `actor:write` |
| `character.claim` | `actor:write` |
| `character.create` | `actor:write` |
| `character.force-release` | `actor:write` |
| `character.rebuild` | `actor:write` |
| `character.release` | `actor:write` |
| `character.resolve-import` | `actor:write` |
| `character.set-currency` | `actor:write` |
| `character.set-identity` | `actor:write` |
| `character.set-inventory` | `actor:write` |
| `character.set-prepared` | `actor:write` |
| `character.set-proficiencies` | `actor:write` |
| `character.set-slot` | `actor:write` |
| `character.submit-import` | `actor:write` |
| `damage.resolve` | `combat:write` |
| `death-save.roll` | `combat:write` |
| `dice.roll` | `roll:create` |
| `effect.add` | `combat:write` |
| `effect.end` | `combat:write` |
| `encounter.add-combatant` | `combat:write` |
| `encounter.end` | `combat:write` |
| `encounter.set-environment` | `combat:write` |
| `encounter.set-health-display` | `combat:write` |
| `encounter.set-player-damage-mode` | `combat:write` |
| `encounter.set-player-initiative-mode` | `combat:write` |
| `encounter.set-rules-mode` | `combat:write` |
| `encounter.start` | `combat:write` |
| `fog.paint` | `scene:write` |
| `fog.reset` | `scene:write` |
| `fog.set-enabled` | `scene:write` |
| `initiative.next` | `combat:write` |
| `initiative.previous` | `combat:write` |
| `initiative.roll-remaining` | `combat:write` |
| `initiative.roll-self` | `combat:write` |
| `initiative.set` | `combat:write` |
| `reaction.answer` | `combat:write` |
| `reaction.dismiss` | `combat:write` |
| `replay.launch` | `combat:write` |
| `rules.answer` | `combat:write` |
| `rules.ask` | `combat:write` |
| `rules.set-policy` | `combat:write` |
| `save.answer` | `combat:write` |
| `save.dismiss` | `combat:write` |
| `save.roll` | `combat:write` |
| `scene.activate` | `scene:write` |
| `scene.create` | `scene:write` |
| `scene.duplicate` | `scene:write` |
| `scene.remove` | `scene:write` |
| `scene.rename` | `scene:write` |
| `scene.reorder` | `scene:write` |
| `scene.set-combatants` | `scene:write` |
| `table.set-party-visibility` | `combat:write` |
| `table.set-staging-defaults` | `combat:write` |
| `token.move` | `combat:write` |
| `turn.end` | `combat:write` |
| `turn.use` | `combat:write` |
| `turn.use-legendary` | `combat:write` |
| `turn.use-reaction` | `combat:write` |

## HTTP surface

Every path in the served OpenAPI document (`GET /api/v1/openapi.json`, byte-identical to
`@vtt/api-contract`).

- `POST /api/v1/codex-assets`
- `GET /api/v1/codex-assets/{id}/content`
- `GET PUT /api/v1/codex/calendar`
- `POST /api/v1/codex/calendar/publish`
- `GET /api/v1/codex/connections`
- `DELETE PATCH /api/v1/codex/connections/{id}`
- `GET /api/v1/codex/export`
- `GET POST /api/v1/codex/folders`
- `POST /api/v1/codex/folders/delete`
- `POST /api/v1/codex/folders/move`
- `POST /api/v1/codex/import`
- `GET POST /api/v1/codex/journal`
- `DELETE PATCH /api/v1/codex/journal/{id}`
- `POST /api/v1/codex/journal/{id}/apply-downtime`
- `POST /api/v1/codex/journal/{id}/reveal`
- `POST /api/v1/codex/journal/deadline`
- `POST /api/v1/codex/journal/downtime`
- `POST /api/v1/codex/journal/milestone`
- `GET POST /api/v1/codex/maps`
- `DELETE PATCH /api/v1/codex/maps/{id}`
- `GET POST /api/v1/codex/maps/{id}/markers`
- `POST /api/v1/codex/maps/{id}/parent`
- `POST /api/v1/codex/maps/{id}/reveal`
- `DELETE GET PATCH /api/v1/codex/markers/{id}`
- `POST /api/v1/codex/markers/{id}/move`
- `PUT /api/v1/codex/markers/{id}/party`
- `POST /api/v1/codex/markers/{id}/reveal`
- `DELETE /api/v1/codex/page-revisions`
- `GET POST /api/v1/codex/pages`
- `DELETE GET PATCH /api/v1/codex/pages/{id}`
- `POST /api/v1/codex/pages/{id}/connections`
- `GET /api/v1/codex/pages/{id}/markers`
- `POST /api/v1/codex/pages/{id}/reveal`
- `GET /api/v1/codex/pages/{id}/revisions`
- `POST /api/v1/codex/pages/{id}/revisions/{revisionId}/restore`
- `GET /api/v1/codex/party`
- `POST /api/v1/codex/preview-session`
- `GET POST /api/v1/codex/quests`
- `DELETE GET PATCH /api/v1/codex/quests/{id}`
- `POST /api/v1/codex/quests/{id}/reveal`
- `GET /api/v1/codex/reveal-audit`
- `GET /api/v1/codex/search`
- `GET POST /api/v1/codex/sessions`
- `DELETE GET PATCH /api/v1/codex/sessions/{id}`
- `POST /api/v1/codex/sessions/{id}/activate`
- `POST /api/v1/codex/sessions/{id}/reveal`
- `GET PUT /api/v1/codex/settings`
- `GET /api/v1/codex/standing`
- `PUT /api/v1/codex/standing/{factionPageId}`
- `POST /api/v1/codex/standing/{factionPageId}/reveal`
- `GET /api/v1/codex/timeline`
- `GET /api/v1/content/backgrounds`
- `GET /api/v1/content/classes`
- `GET /api/v1/content/conditions`
- `GET /api/v1/content/equipment`
- `GET /api/v1/content/feats`
- `GET /api/v1/content/languages`
- `GET /api/v1/content/monsters`
- `GET /api/v1/content/monsters/{definitionId}`
- `GET /api/v1/content/monsters/{definitionId}/actions`
- `GET /api/v1/content/names`
- `GET /api/v1/content/skills`
- `GET /api/v1/content/species`
- `GET /api/v1/content/spells`
- `GET /api/v1/content/subclasses`
- `GET /api/v1/encounters`
- `DELETE GET /api/v1/encounters/{id}`
- `POST /api/v1/encounters/{id}/launch`
- `POST /api/v1/encounters/{id}/visibility`
- `GET /api/v1/game`
- `POST /api/v1/game/actions/resolve`
- `POST /api/v1/game/actions/use`
- `POST /api/v1/game/actors`
- `DELETE /api/v1/game/actors/{actorId}`
- `POST /api/v1/game/actors/{actorId}/archived`
- `GET /api/v1/game/actors/{actorId}/available-actions`
- `POST /api/v1/game/actors/{actorId}/conditions`
- `POST /api/v1/game/actors/{actorId}/currency`
- `POST /api/v1/game/actors/{actorId}/damage`
- `POST /api/v1/game/actors/{actorId}/death-save`
- `POST /api/v1/game/actors/{actorId}/effects`
- `POST /api/v1/game/actors/{actorId}/effects/{effectId}/end`
- `POST /api/v1/game/actors/{actorId}/heal`
- `POST /api/v1/game/actors/{actorId}/health-display`
- `POST /api/v1/game/actors/{actorId}/hp`
- `POST /api/v1/game/actors/{actorId}/identity`
- `POST /api/v1/game/actors/{actorId}/inventory`
- `POST /api/v1/game/actors/{actorId}/prepared-spell`
- `POST /api/v1/game/actors/{actorId}/proficiencies`
- `POST /api/v1/game/actors/{actorId}/rebuild`
- `POST /api/v1/game/actors/{actorId}/rechoose`
- `POST /api/v1/game/actors/{actorId}/rest`
- `POST /api/v1/game/actors/{actorId}/sheet-preview`
- `POST /api/v1/game/actors/{actorId}/size`
- `POST /api/v1/game/actors/{actorId}/speed`
- `POST /api/v1/game/actors/{actorId}/spell-slot`
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
- `POST /api/v1/game/builder/ability-rolls`
- `POST /api/v1/game/builder/policy`
- `POST /api/v1/game/character-imports`
- `POST /api/v1/game/character-imports/{importId}/resolve`
- `POST /api/v1/game/characters`
- `POST /api/v1/game/claims`
- `POST /api/v1/game/claims/{actorId}/force-release`
- `POST /api/v1/game/claims/release`
- `GET POST /api/v1/game/commands`
- `POST /api/v1/game/damage/resolve`
- `POST /api/v1/game/definitions/import`
- `POST /api/v1/game/encounter/combatants`
- `POST /api/v1/game/encounter/end`
- `POST /api/v1/game/encounter/environment`
- `POST /api/v1/game/encounter/health-display`
- `POST /api/v1/game/encounter/player-damage-mode`
- `POST /api/v1/game/encounter/player-initiative-mode`
- `POST /api/v1/game/encounter/rules-mode`
- `POST /api/v1/game/encounter/start`
- `POST /api/v1/game/fog/enabled`
- `POST /api/v1/game/fog/paint`
- `POST /api/v1/game/fog/reset`
- `POST /api/v1/game/initiative/next`
- `POST /api/v1/game/initiative/previous`
- `POST /api/v1/game/initiative/roll-remaining`
- `POST /api/v1/game/initiative/roll-self`
- `POST /api/v1/game/initiative/set`
- `GET /api/v1/game/log`
- `POST /api/v1/game/reactions/{reactionId}/answer`
- `POST /api/v1/game/reactions/{reactionId}/dismiss`
- `POST /api/v1/game/rolls`
- `POST /api/v1/game/rules/answer`
- `POST /api/v1/game/rules/ask`
- `POST /api/v1/game/rules/policy`
- `POST /api/v1/game/saves/{saveId}/answer`
- `POST /api/v1/game/saves/{saveId}/dismiss`
- `POST /api/v1/game/saves/roll`
- `POST /api/v1/game/scenes`
- `DELETE /api/v1/game/scenes/{sceneId}`
- `POST /api/v1/game/scenes/{sceneId}/activate`
- `POST /api/v1/game/scenes/{sceneId}/combatants`
- `POST /api/v1/game/scenes/{sceneId}/duplicate`
- `POST /api/v1/game/scenes/{sceneId}/rename`
- `POST /api/v1/game/scenes/reorder`
- `POST /api/v1/game/table/party-visibility`
- `POST /api/v1/game/table/staging-defaults`
- `POST /api/v1/game/tokens/{actorId}/move`
- `POST /api/v1/game/turn/end`
- `POST /api/v1/game/turn/legendary`
- `POST /api/v1/game/turn/reaction`
- `POST /api/v1/game/turn/use`
- `GET POST /api/v1/gm/integration-credentials`
- `GET /api/v1/gm/integration-credentials/{id}/audit`
- `POST /api/v1/gm/integration-credentials/{id}/revoke`
- `POST /api/v1/gm/integration-credentials/{id}/rotate`
- `GET POST /api/v1/homebrew/content`
- `DELETE GET PATCH /api/v1/homebrew/content/{id}`
- `POST /api/v1/homebrew/content/{id}/duplicate`
- `POST /api/v1/homebrew/content/{id}/publish`
- `POST /api/v1/homebrew/content/{id}/restore`
- `POST /api/v1/homebrew/content/{id}/unpublish`
- `GET /api/v1/homebrew/content/{id}/usages`
- `POST /api/v1/homebrew/content/{id}/visibility`
- `GET /api/v1/homebrew/packs/export`
- `POST /api/v1/homebrew/packs/import`
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
