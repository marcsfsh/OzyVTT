# ADR-0041: Encounter is the one word

## Status

Accepted on 2026-10-27. The owner chose the scope: every name the app shows or sends. Internal file and variable
names are a later change (issue #167).

## Context and decision drivers

Three words name one thing. Prep calls a prepared map with its creatures a **scene**, the table calls its combat a
**fight**, and the wire calls the same combat an **encounter** (`encounter:start`). The glossary test
(`play-vocabulary.test.ts`) enforced "fight" on screen and kept "encounter" a wire name. The owner wants
**Encounter** to be the only word, everywhere a person or a tool meets it. The owner keeps no data or scripts that
must survive the change.

Drivers: one word on every screen and in every name the server sends or accepts; nothing breaks for a campaign saved
before the change; the internal rename waits so this change stays reviewable.

## Considered options

1. Screens only. Rejected: the API, the addresses and the OpenAPI document would keep three words.
2. Screens, addresses, commands, API paths and fields, events and saved data keys; internal names later. Chosen.
3. Everything at once, internal names included. Rejected for now: about 4,000 places in about 100 files, and the
   internal "encounter" (the running fight) must first become "combat".

## Decision

- **What an encounter is.** The prepared record (a map, who is in it, its light, sound and settings) is an
  Encounter. Running its combat is starting the encounter; an encounter can be Not started, In progress or Completed.
  An encounter without combat (a tavern, a chase) is still an Encounter.
- **On screen.** "Scene" and "fight" are retired from copy: Prep's Scenes page is Encounters; Start the fight is Start
  the encounter; In this fight, No fight running, Fight settings and the Fight tab say encounter. The glossary test
  flips: "scene" and "fight" become retired words with "encounter" as their replacement, and "encounter" leaves the
  retired list. A finished encounter's record stays a Replay.
- **Addresses.** `/scenes/...` becomes `/encounters/...`; every old address redirects to its new one
  (`redirectForRetiredPath`).
- **Commands and events.** `scene:*` socket events and `scene.*` command types become `encounter:*` and `encounter.*`
  (`encounter:create`, `encounter:activate`, `encounter:set-combatants`, and so on). `encounter:start`, `encounter:end`
  and `encounter:add-combatant` keep their names: they start, end and add to the encounter's combat. The
  `scene:write` scope becomes `encounter:write`.
- **HTTP.** `/api/v1/game/scenes/...` becomes `/api/v1/game/encounters/...`. The archived fights at
  `/api/v1/encounters/...` move to `/api/v1/replays/...`, the name the app already gives them, so the two never
  share a path.
- **Fields.** Every field named for a scene is renamed in requests, replies, events and views: `sceneId` to
  `encounterId`, `combat.scenes` to `combat.encounters`, `activeSceneId` to `activeEncounterId`, `replaySceneId` to
  `replayEncounterId`, a scene's `fightEndedAt` to `endedAt`, and the same in the Codex's links, the sound board's
  encounter sound and the archive's name for its encounter.
- **Saved data.** The game state's JSON keys are renamed by a new numbered migration in the game store. The Codex
  and sound stores' JSON keys are renamed by new migrations in those stores, and stored integration credentials with
  `scene:write` get `encounter:write`. SQL column names stay as they are: they never leave the server, and renaming
  them belongs with the internal names (issue #167).
- **Generated output.** `npm run map` regenerates the app map, the OpenAPI document and the schemas; nothing generated
  is edited by hand.

## Consequences and tradeoffs

- One word everywhere a person or a tool meets it.
- Any script or bookmark using the old API paths or command names stops working; the owner has none. Page addresses
  redirect.
- For a while the code reads one way inside and another outside. Issue #167 tracks closing that gap.

## Mobile, security, and visibility impact

None to what anyone can see: the same projections carry the same facts under new names, and every encounter field
stays GM-only as every scene field was. The projection and credential tests run under the new names.

## Migration / reversibility

Numbered migrations rename the saved keys; a test loads a campaign saved before them and finds everything under the
new names. Reverting would need migrations the other way.

## Validation evidence

To be added with the code: the glossary test under its new rules, the redirect of every old address, both transports
for the renamed commands, the old-campaign migration test, the credential snapshot and the regenerated OpenAPI.
