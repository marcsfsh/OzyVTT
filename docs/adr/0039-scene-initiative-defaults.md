# ADR-0039: Scene initiative defaults

## Status

Proposed. Needs the owner's sign-off before any server code.

## Context and decision drivers

ADR-0037 draws Fight settings on a Prep scene: whether players roll their own initiative and whether identical
monsters share one roll. Both exist today only as options of one fight: `encounter:start` takes
`playersRollInitiative` and `groupMonsters` (`EncounterStartSchema` in `packages/domain/src/commands.ts`), and the
table's Start the fight sends them from its switches. A GM who always lets the party roll sets the switch before
every fight. Surprise is a choice per creature at the start and stays there.

Drivers: persist only these two choices; GM-only, as every scene already is; a stated precedence so an explicit
choice at the start always wins; defined behavior for every scene lifecycle step; no change to existing campaigns
until the GM sets a default.

## Considered options

1. Table-wide defaults in the rules settings. Rejected: the choice is about the fight a scene holds (a boss fight
   the GM rolls for, a skirmish the party rolls), and the drawing places it on the scene.
2. Defaults on the scene record, read by `encounter:start` when it omits a field. Chosen.
3. Store the whole Start the fight form on the scene, surprise included. Rejected: surprise depends on how the
   party arrives, which is known only when the fight starts.

## Decision

These are the choices to confirm.

- **Field.** `Scene.initiativeDefaults?: { playersRollInitiative?: boolean; groupMonsters?: boolean }`, optional,
  strict, and GM-only like the rest of the scene. Nothing else is stored.
- **Writing it.** A new command `scene:set-initiative-defaults` (`scene.set-initiative-defaults`) with
  `{ commandId, sceneId, initiativeDefaults, expectedRevision? }`, defined the shared way (domain schema, typed socket
  event, `GAME_COMMANDS`, a `defineCommand` handler, an HTTP route in the registry) with the `scene:write` scope.
  It is allowed on the live scene too, since it changes no running fight. `scene:create` accepts the same optional
  object.
- **Precedence in `encounter:start`.** For each of the two fields: a value in the request wins; an omitted field
  takes the live scene's default; with neither, today's behavior (false). A client that wants today's behavior on a
  scene with a default sends the field explicitly. The table's Start the fight shows the switches already set from
  the live scene's defaults and sends what they show.
- **Lifecycle.** The defaults live on the scene record, apart from its combat snapshot, so: duplicate copies them;
  activate and park keep them; rename and reorder leave them; delete removes them with the scene; a launched replay
  carries none and its start ignores them, since a replay reruns a recorded fight.
- **Storage.** The game state is JSON validated on load (`GameStateSchema` in `game-store.ts`), and an absent
  optional field parses as no default. No SQL migration is needed, and no shipped migration is edited.
- **Prep.** After the server lands, the scene's Fight tab gets the two switches under Fight settings, and the table's
  Start the fight reads them as its starting values.

## Consequences and tradeoffs

- A GM sets the habit once per scene; one fight can still differ by flipping a switch at the start.
- An integration that relied on omission meaning false sees the scene's default instead, once a GM sets one. Every
  existing scene has none, so nothing changes until then.

## Mobile, security, and visibility impact

- Scenes never reach players or the table screen; a test pins that the new field stays out of both projections.
- The switches are two 44px rows on the Fight tab at 390px.

## Migration / reversibility

Additive and optional. Removing the feature leaves an unread field that the schema can drop with a new numbered
migration.

## Validation evidence

To be added with the code: both transports for the new command, the precedence table (request, default, neither)
for each field, duplicate, activate, park and replay behavior, a stored campaign without the field loading
unchanged, and the projection tests.
