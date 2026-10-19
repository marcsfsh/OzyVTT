# Architecture

How OzyVTT is put together, and the rules that keep it safe. For a generated index of the state
shape, the command catalog and the HTTP paths, see [app-map.md](app-map.md). Durable decisions and
their reasoning are in [adr/](adr/).

## Shape

One Node process on the GM's machine serves everything on the LAN. The server is the only
authority: clients render what they are sent and send commands, and every game decision (dice,
snapping, turn order, visibility, rules checks) happens on the server. Each recipient gets a
projection computed for their role. Nothing is sent as full state and filtered on the client.

```
Player browser ─┐                                  ┌─▶ game store ─────────┐
                ├─ Socket.IO (game) ─┐             ├─▶ codex store         │
GM browser ─────┤                    ├─▶ validate ─┼─▶ homebrew store      │
                └─ HTTP /api/v1 ─────┘   authorize ├─▶ viewer presentation ├─ data/vtt.sqlite
                                                   ├─▶ sound board         │
                                                   └─▶ combat log ─────────┘
Table viewer ◀── SSE + cookie, player-safe presentation projection only (and what the sound board plays)
```

The stores are independent. Each has its own revision counter and its own change notification,
and a change to one never bumps another. They are constructed together in
`apps/server/src/server.ts`.

## Workspaces

| Package                      | What it holds                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/server`                | Express + Socket.IO service: stores, command handlers, projections, HTTP routers.                              |
| `apps/client`                | React/Vite UI. Entries: `index.html` (the app), `viewer.html` (table viewer), `sheet.html` (standalone sheet). |
| `packages/domain`            | The wire contract: `GameState`, socket event maps, projection view types, the Codex's HTTP shapes.             |
| `packages/schemas`           | Zod schemas for actors, effects and the modifier vocabulary, shared by server and content.                     |
| `packages/api-contract`      | The public HTTP API: path constants, command scopes, wire schemas, the route registry and the OpenAPI builder. |
| `packages/rules-5e`          | Pure 5e rules helpers: dice grammar, ability scores, progression tables, rider evaluation.                     |
| `packages/content-srd-5.2.1` | SRD 5.2.1 content bundles and the scripts that generate them from vendored sources.                            |
| `packages/dndbeyond-pdf`     | Turns a D&D Beyond character-sheet PDF into an actor definition (runs in the browser).                         |
| `packages/ui`                | Design tokens, fonts and the `nh-` UI primitives.                                                              |
| `packages/test-fixtures`     | Actor fixtures shared by tests.                                                                                |

Packages are consumed as TypeScript source; only the client and server have build steps.

## The command pipeline

A command is a named socket event (or an HTTP call to `/api/v1/game/...`) carrying a UUID
`commandId` and an optional `expectedRevision`. Each command is one entry in the command table
(`apps/server/src/commands/`, listed in `index.ts`): its type, Zod schema, GM-only refusal, run
function, and the operation id and description its HTTP route is documented with. Its scope and typed HTTP route come from `GAME_COMMANDS` in `packages/api-contract`, and its
socket event is its type with the first `.` as `:`. The socket handlers and the HTTP routes are
registered by looping over the table, and both run the same pipeline (`commands/pipeline.ts`):

1. Refuse a GM-only command from a player, then validate the payload with its strict Zod schema
   (`packages/domain/src/commands.ts`, from which the client's socket payload types are inferred). Role comes
   from the signed token, per command; it is never cached at connect.
2. Run the command. Whether a player may act on a given actor is decided in one place,
   `canInitiateForActor` in `authorization.ts`, against live state.
3. `store.execute` commits the idempotency receipt and the new state in one SQLite
   transaction and bumps the revision. A repeated `commandId` returns the earlier result
   with `duplicate: true` and changes nothing. A stale `expectedRevision` is rejected.
4. Broadcast `state:updated` with a projection computed separately for each socket's role.
5. Reply through `projectReply`, which strips GM-only narration from a player's reply.

A failure answers through one mapping (`commands/failures.ts`) on both transports: a validation
failure is 400, a denial 403, a missing read subject 404, a rules or state refusal 409, and anything
unexpected is logged and answered with a generic 500. Every refusal also carries a stable code (the
socket reply's `code`, `error.details.reason` over HTTP; a rules block's code is its rule id), so a
client branches on the code and only shows the message. The reads both transports serve (content
catalogs, the character builder's offers, action availability, the combat log) are a second table in
`commands/reads.ts`.

Commands run one at a time through a promise queue. Add new capability to the command table,
never to one transport. After each command that commits, the pipeline withdraws any reaction prompt
whose creature can no longer react (dropped to 0 HP or Incapacitated) by answering it for the table,
so a held attack finishes without the reaction.

## Realtime

Socket.IO over the same origin as HTTP. Server-to-client events come in two kinds:

- **Projected channels** carry content and are computed per recipient: `state:updated`,
  `table:event` and `log:entry`. `log:entry` is computed per socket because a self-only roll
  belongs to exactly one player; `projectFeedRow` in `combat-log.ts` makes that decision.
- **Ping channels** carry only a revision: `codex:changed` and `homebrew:changed`. Naming what
  changed would tell players which part of the world the GM is editing, so clients refetch
  their own projected view instead. The GM's devices get `codex:changed` with the Codex store's
  revision on every write. A player's device gets it only when something it can read changed,
  with a count of its own audience's changes alone: after each write the server hashes every read
  of each audience a connected player holds (`playerCodexFingerprint` in `codex/player-reads.ts`;
  an audience is the set of party characters the session has claimed), so a GM-only write sends
  players nothing and a block shown to Lyra pings only Lyra's player. A claim or a release
  changes a socket's audience, and pings it. `homebrew:changed` follows the same rule: the GM's
  devices get the homebrew store's revision on every write, and a player's device is pinged only
  when the homebrew its reader receives changed (`HomebrewStore.fingerprintFor`), with a number that
  grows for that device alone and says nothing of anyone else's changes.
- **GM-only channels** go to GM sockets alone: `sound:changed` carries the sound board and the table
  screens' sound state. A player's socket is never sent it.

On connect the server sends a full projected snapshot. The client passes its token in `socket.auth`,
so reconnects resume without a new join. A player's token is kept in `localStorage`; the GM's in the
tab's `sessionStorage` (a reload resumes), in `localStorage` only when the GM ticks "Keep me signed in
on this computer", and a new tab asks the open ones over a `BroadcastChannel` (`lib/gm-token.ts`).
A socket whose session is revoked or runs out gets `session:ended` and is dropped, and a join with a
dead token is refused (ADR-0027). Presence holds a dropped session as "reconnecting" for about 8
seconds before "offline".

## Identity and roles

- **GM.** The first GM password can only be set from loopback (`POST /api/v1/host/setup`). It is
  stored as a bcrypt hash in `data/auth.json` with a random token secret. GM tokens are
  HMAC-signed, expire after 12 hours, and can be revoked singly or all at once. Changing the
  password (Settings) ends every GM session issued before it. The host routes
  (`host-http.ts`) are the one part of `/api/v1` without open CORS, so a web page can't relay password
  guesses.
- **Player.** No password. Joining issues a signed 30-day token. A player claims one
  player-character at a time; the claim sets that character's `ownerSessionId`. A player may
  act only on the character they own: move it, roll for it, level it, set its token image. The
  GM can force-release a claim (asked twice for a character in the running fight); the player is
  told on their own devices (`claim:released`).
- **Integration credential.** A GM-minted, scoped bearer token for the HTTP API (ADR-0016).
- **Table viewer.** The screen shows a six-digit code and the GM types it; the screen's own secret,
  in a cookie, then collects an HttpOnly viewer cookie (ADR-0028). It can only read the presentation
  projection.

Role comes from the signed token, never from network position. Archived characters cannot be
claimed, staged or added to a fight.

Every HTTP route and the socket handshake read the caller through one helper (`request-auth.ts`,
ADR-0027): 401 for no credential or one that is malformed, expired or revoked, and 403 only for a
valid credential without the role or scope. `credential-walk.test.ts` walks every mounted route with
four credentials and pins the answers.

## Projections: the security boundary

Every byte that reaches a player or the shared screen goes through a projection built for that
audience. There are five:

- **Game** (`apps/server/src/projections.ts`): `projectPlayerView` and `projectGmView`. Players
  get only `public` actors, a health band with no exact HP, and owner-only sheet resources
  for their own character. A hidden effect's source becomes "A hidden threat". Private rolls,
  owner identity, GM notes and hidden turns are removed. A live scene's map reaches players before
  its fight, with the public tokens the GM has placed; the turn order and the tray wait for the
  fight. A player's reply to an area they aimed names only the creatures they may see. A player's
  reaction prompt names the attack total it answers only when the attack's own roll is in that
  player's dice log. An unclaimed character carries its species and class line for the claim
  picker, since any player could claim it and read its sheet. The options a player pins to the
  sheet's turn card and how often each option resolved (`favouriteOptionIds`, `optionUseCounts`)
  reach the owner and the GM only, whatever the party tier. A creature a player's character commands
  (`Actor.control`) reaches that player with its stat block, exact Hit Points and the orders it takes
  (`commanded`, `orders`); who summoned it and what keeps it stay the GM's. That player acts for it, and
  sees through it when it lends its sight (`playerViewerIds`).
  A creature's `attitude`, which the GM sets for Influence, never reaches a player; a character's food and water
  for the day (`nourishment`) goes wherever its sheet resources go.
- **Table viewer** (`viewer-presentation.ts`, `viewer-encounter.ts`): the public screen in a
  room that may hold non-players. It follows the live scene, before and during its fight, unless
  the GM paused it. Only public actors with a position become tokens; annotations
  are public and unexpired; initiative appears only during combat; nothing is shown while
  paused. The fields that may cross are the `ViewerEncounterScene` and
  `ViewerPresentationProjection` types, plus `sound` (`ViewerSoundProjection`, added by
  `viewer-coordinator.ts` when the feed is sent): only what is playing, by file id, level and
  position, never a name, the playlist or the library. The screen may fetch a sound file only
  while it is in that projection.
- **Codex** (`codex-projections.ts`): a player gets the parts of a revealed record that reach
  them and nothing else. Each read is for one reader: the party characters the session has
  claimed, or the ones the GM's preview names. A page or quest holds player text and hidden
  blocks; each block, page field and quest objective has an audience (Hidden, Everyone, or some
  party characters). The server assembles the body a reader gets from the player text and the
  blocks that reach them, so a block they may not see leaves no trace, and its `[[links]]` stay on
  the GM layer until it reaches them. A `[[link]]` to a page the reader cannot open reads as plain
  text in every piece of record text a player receives (bodies, recaps, entries and their details,
  titles, labels, fields, objectives, search hits and lines, home rows), since the link alone would
  say the page exists; every player context carries the openable pages for it. A block reaches a
  reader only once a write has stamped it for their audience, so an unstamped block fails closed.
  Reveal is a graph: a child never leaks an unrevealed parent or target, and `codex/visibility.ts`
  resolves a record's neighbours for the projection. Some fields are GM-only even when revealed:
  staged scene ids on markers and sessions, and a page's folder path, which is the GM's private
  filing (a player's `folder` filter on the page list is ignored). A page's `updatedAt` moves on
  every save, so it stays with the GM too; players get `playerUpdatedAt`, which moves only when
  something that reader can read changes. A record's `createdAt` would tell players when the GM
  prepared it, so the player shapes leave it out and carry or are ordered by `firstShownAt`: the
  moment players could first read the record, set by that write (`codex/first-shown.ts` runs in
  every Codex write) and never moved after, through a hide or a re-reveal. A block's reveal and a
  connection's learned date are stamped the same way, with the active session and the players'
  published date. The order and length of a player's lists come from what the player can read
  too: a player's search is built from that player's own reads, so a hit matches, quotes and ranks
  only on text that reaches that reader (a block shown to Lyra is found by Lyra's player alone),
  its modified date is the reader's `playerUpdatedAt` or the record's `firstShownAt`, and it is
  capped after the gates (the GM's keeps relevance ranking from the index, since the GM reads
  every row anyway). A player's home lists what is new since their last visit from the same
  records and dates. Prep templates, session prep, the live board and the GM's home aggregates
  have no player read at all. A player's journal places an entry by the session number the player
  receives and then by `firstShownAt`, pins, maps, quests, standing and unnumbered sessions come in
  first-shown order, a page's mentions keep a fixed order, a hidden page never takes a revealed
  page's title for `[[links]]`, and a GM-layer connection never folds away a player-layer mention.
  A hidden record is a 404, never a 403, and ETags are computed after every gate. A GM's ETag
  carries the store revision; a player's hashes the body they receive, so a GM-only write, or a
  reveal to another character, leaves it as it was. The GM's preview is a signed player session
  that reads as everyone or as one party character and only reads: game commands and uploads
  refuse it.
- **Homebrew** (`content-library.ts`, `homebrew-store.ts`, `homebrew-player.ts`): every content read is
  built for one audience (`ContentLibrary.forAudience`). A player session is a reader: the party
  characters it has claimed, or the ones a Codex preview names. A reader receives a homebrew record
  only when it is published, not archived, in a pack that is on, and shared with everyone or with one
  of the reader's characters (`audienceReceives`); a draft is always Hidden. Everything a player gets
  of homebrew (the builder's catalogs and offers, the gear picker, the spell catalog, the Compendium,
  next level, spell swaps) is derived from that reader's slice, so a record shown to Lyra leaves no
  trace in Mirena's reads: no row, no count, no list id in a spell's `classes`, no ping. The GM's
  catalog is every published record in a pack that is on. Play-time resolution of what a character or
  a monster already has reads a third audience, `play`, which ignores the pack switch, so a pack
  switched off takes its records out of every catalog and picker while a character keeps its items
  and spells. The GM's See as reads one reader's catalog through GM-only routes. Players never get a
  pack name, an audience or a reveal date.
- **Replay** (`replay-projection.ts`): a shared fight archive is rebuilt per turn from an
  allow-list. It carries no session ids, notes, stat blocks, or rolls that were not public. A player's
  list of shared replays carries the GM's name for one, never the name of the scene it was fought on.

Sight is part of the boundary (ADR-0023). `vision/audience.ts` decides, per audience, which
creatures it may know of. A player sees through their own placed characters; the table viewer, a
spectator and a replay see through the whole party. A creature that isn't a player character is
hidden from an audience, exactly like a `gm-only` one, when none of its characters perceive it
(dynamic vision on), or when its whole space lies under the scene's manual fog (fog on). The same
goes for one staged that way in a prepared scene, and, with the fog on, for one in the fight but not
yet on the map. Every projection, the feed and toast gate, and a player's target check read that one
answer (`AudienceSight`). Rules, narration and refusals ask it through `hiddenFrom`, the shared hidden
check: GM-only, or hidden by sight or the fog, for the table or for one player. A line that would
name a hidden creature names "A hidden threat", a rule it would bend for a visible creature doesn't
apply, and a public roll it makes is recorded GM-only. Another player's character out of
sight keeps its actor but loses its token. An audience's own characters are always sent, and so
is a creature with any part of its space revealed. A player's vision block also marks the creatures
one of their own characters senses without seeing (Divine Sense, `vision/detect.ts`): where each
stands and its creature type, never its identity, and never to the table or another player.

The rule for a new field: it may reach a player or the viewer only if everything it carries is
already public to them, and it carries no exact quantity and no identity, position or existence
of a hidden thing. When in doubt, leave it out.

## Maps, tokens and the grid

- A printed square grid is calibrated by dragging across a 3x3 block of cells. The server
  derives the cell size and origin and keeps rotation at 0 (`grid-calibration.ts`). Gridless,
  regional and world maps use a two-point distance scale.
- All geometry is in image-pixel space. The client converts pointer positions with
  `imagePointFromClient` (`scene/mapImage.tsx`), which uses `getScreenCTM`.
- The server sizes tokens and snaps moves (`token-placement.ts`): odd footprints land on a cell
  centre, even footprints on an intersection, gridless maps only clamp. Client snapping is a
  preview that mirrors the server.
- Drawings, measurements and pings live in `annotations.ts`. Fog is an ordered list of
  reveal/hide rectangles per scene (`fog.ts`). Scenes park and resume a fight (`scenes.ts`).
- A prepared scene is edited through the same commands as the live table, each with the scene's
  `sceneId`. Each scene carries when it was made, last changed and last live (`createdAt`,
  `updatedAt`, `liveAt`), GM-only like the rest of `combat.scenes`; the server stamps a change
  after each mutation (`stampSceneChanges`). `scene:preview` (GM only, `scene-preview.ts`)
  answers what the table screen or one party character would get if a scene went live now: it
  makes the scene live in a copy of the state and runs the real projections over it, and nothing
  is committed (ADR-0035).
- Dynamic vision (ADR-0023) is per scene and off by default: walls, doors and windows as
  image-pixel segments, placed and carried lights, an ambient light level (sunlight or not), and
  painted areas of Bright Light, Dim Light, Darkness, light or heavy obscurement and magical
  Darkness (`vision/edit.ts`, `vision/areas.ts`). The server builds each viewer's visibility
  polygon against the walls, cuts it to the creature's senses, the light at each point and the
  areas (`vision/geometry.ts`, `vision/sight.ts`), and caches polygons by walls, origin and
  radius. Senses come from stat blocks, species, features, feats, active items and live effects,
  and light from items lit on their row, effects and a stat block's own glow (`vision/senses.ts`,
  `item-light.ts`, which burns a light down on the game clock). A cast or an action places its
  light, fog or magical Darkness and dispels what it overlaps; each ends with the Concentration,
  effect or rounds that keep it (`vision/cast-sight.ts`). After every command the server adds what
  the party sees to the scene's explored memory (`rememberExplored`). Players and the table screen
  get only polygons and rectangles to paint: what is in sight, the bright part of it, and what
  has been seen. While vision is on, walls, closed doors and windows also bar movement.
- The rules read sight through `vision/rules.ts` (`sightRules`), which answers with the map while
  vision is on and with the conditions and Blindsight, Truesight and See Invisibility by distance
  while it is off: an attack's unseen Advantage and Disadvantage and Invisible, Cover from walls
  and creatures between (`cover.ts`), an area that leaves out what its origin can't reach
  (`area-targeting.ts`), Hide's hiding place, Search finding a hidden creature, Frightened's line
  of sight and its refused approach (`movement-rules.ts`), Dodge and other riders that name who
  sees whom (`sees-other`, `seen-by-other`, `other-lacks-sense`), Blinded and Heavily Obscured
  checks, a save that needs its source seen (a gaze, a pattern), and the traits and features that
  ask for sunlight, Bright Light, or Dim Light and Darkness.
- Difficult terrain is a GM-painted set of cell-snapped rectangles per scene (`terrain.ts`).
  A move is charged along the cheapest grid path, where terrain costs double, other creatures'
  spaces cost double or bar the way, and crawling, climbing or swimming without the speed, or
  dragging a grappled creature, add a foot per foot (`movementPath` and `spacePassage` in
  `@vtt/rules-5e`). How a token travels (walking, a special speed, jumping, teleporting, moved by force)
  rides on `token.move`, each speed with its own budget (`speed.ts`), and opportunity attacks are
  read along the whole path (`movement-rules.ts`). A move that provokes waits at the last point of its
  way still in reach (`combat.heldMove`) until its prompts are answered, and a move that enters an area whose
  save, failed, stops its mover (Caltrops, Web, Ball Bearings) waits where it entered until the save is answered
  (`zone-stops.ts`); the settle step then finishes it along the rest of its way, where the areas act on it in turn,
  or leaves a mover that was dropped, knocked Prone or left with a Speed of 0 where it stood and gives back the
  rest of its movement (`held-moves.ts`). The map's drag preview runs the same function,
  and a mirror test checks the two agree. The `actor:movement` reply tells the preview whether the
  mover shares spaces (Air Form, a swarm) and which swarms its viewer can see (`space-sharing.ts`),
  so it charges those spaces as the server does. Players and the table screen get only the terrain the
  fog reveals, and with vision on only what the party has seen. A spell's area changes the ground while it
  lasts (`zone-ground.ts`): Web, Entangle or Ice Storm's hail make its cells Difficult Terrain, Plant Growth
  and Wall of Thorns cost 4 feet for every foot, Conjure Minor Elementals' only for the caster's enemies,
  Gust of Wind's Line 2 feet for every foot a creature moves closer to its caster (`costlyStep`), and
  a creature whose trait frees it from that kind of ground (Web Walker, Ice Walk) pays nothing extra. The
  server charges it on the ground (a mover off the ground passes over it as over painted terrain), and the
  `actor:movement` reply gives the preview the cells it changes for the mover, of the areas the asker can see
  (`areaGround`, `zone-preview.ts`); the area itself is on the map. A cast's template grows with a higher slot as
  the availability row says (`areaPerSlot`), so the drawn template is the size the server places.
- Height (`altitude.ts`, `@vtt/rules-5e` `altitude.ts`): a token's `altitudeFeet` is how far its lowest
  point is above the ground, and `airborne` says what holds it up in the air (flying, or a
  levitation); a creature on a ledge or a wall it climbs is up without being airborne. A space is as
  tall as it is wide. Height counts by the grid's own diagonal rule, the one the floor uses (every
  diagonal step is one square): on a grid the distance between two creatures is the larger of the
  squares across and the squares up, and on a gridless map it is straight through the air
  (`creatureDistance`), so reach, range, auras, grapples and opportunity attacks read it. A move pays
  for the height it gains or loses the same way, a mover off the ground passes over painted terrain
  and over creatures wholly below it, and only flying, climbing, jumping, teleporting or a forced
  move changes height (`movement.altitude`). An area reaches only as high as its shape does
  (`withinAreaHeight`), and so does a spell's lasting area as creatures meet it: a Sphere its radius above and below,
  a Cube its side, a Cylinder its printed height, an Emanation its distance in every direction (`insideTest` in
  `spell-zones.ts`). An area that acts only on the ground (Earthquake's) spares a creature in the air. The GM sets any creature's height free of movement (`token.set-altitude`).
  Height is as public as position, so it travels with the token in every projection.
- Falling (`falling.ts`): after every command the pipeline lands whoever can no longer stay in the
  air (`settleFalls`, its own commit): a flier that is Prone, Incapacitated or at a Fly Speed of 0
  without hover, or left with nothing to fly with, falls; a levitation that ended, or a flight that
  ends safely (`descends-safely`), lowers it gently. The GM starts any other fall with `actor.fall`.
  A fall in a fight first offers the reactions that answer it (a `falls` prompt: Feather Fall from a
  creature that sees the faller in range, the faller's own Slow Fall) and waits on them in
  `combat.pendingFalls`; then the server rolls 1d6 per 10 feet to 20d6 through the damage rules and
  leaves the creature Prone unless it took no damage.
- Granted moves (`granted-moves.ts`, `resolution/movement-grants.ts`): a move or teleport an action
  or feature gives beside the turn's own ("moves up to half its Speed", Tactical Shift, Misty Step)
  is an effect on the creature that belongs to the turn it was granted in and lapses with it. The
  movement rules charge a move to its grant when it fits, on the creature's turn or off it, and it
  provokes unless the grant says otherwise; a granted teleport is checked for range, an unoccupied
  space and sight, and needs no GM go-ahead. An action whose move comes first (Pounce) can be taken
  `moveFirst`: its cost is spent and the move granted, and the action picked again pays nothing more.
  Monster moves, teleports and leaps are read from the action's prose where it enters the system
  (`action-prose.ts`). Other moves off the creature's turn are the GM's repositioning and spend
  nothing.
- Jumping (`jumping.ts`): the `jump` way of moving goes straight over what lies between, up to the
  Strength score across and 3 + the Strength modifier up, half from a standing start (no 10 feet
  moved this turn), a foot of movement for each foot. Riders change the numbers (`movement`
  modifiers: Dexterity for Second-Story Work, Step of the Wind's doubling, the once-a-turn leap of
  the Jump spell and Boots of Striding and Springing); a landing in Difficult Terrain rolls a DC 10
  Dexterity (Acrobatics) check or leaves the jumper Prone.
- Moves the rules make or forbid: a Frightened creature can't move closer to the creature its fear comes
  from (`movement.toward-fear`); an effect tagged `flees-with-reaction` (Dissonant Whispers) is turned by
  the pipeline's settle step into the creature's Reaction and a granted move of its Speed that must end
  farther from the source (`compelledMoves`); a levitation (`levitating`) lifts its creature 20 feet,
  which then moves only as if climbing; and a creature that ends its turn in another's space, unless
  Tiny or larger, falls Prone (`occupied-space.ts`).
- Off the plane (`off-plane.ts`): an effect tagged `off-plane` (Banishment, Etherealness, Maze,
  Imprisonment, Blink's Ethereal turns, Hurl Through Hell) takes its creature off the map in the settle step, keeping its
  place in the initiative and the space it left in `combat.offPlane` (GM-only); it can't target or be
  targeted across the plane, and when the effect ends it returns to that space or the nearest
  unoccupied one. Blink's d6 is rolled by the server as the caster's turn ends.
- Mounts (`mounts.ts`, `actor.mount`): a rider carries an effect tagged `riding` whose source is its
  mount. Mounting a creature within 5 feet and at least one size larger, or dismounting, costs half the
  rider's Speed; the rider shares the mount's space and height, the mount's moves carry it, and it moves
  only by its mount until it dismounts. A mount that teleports or is moved by force leaves its rider
  behind. A Lance is held in one hand while riding.
- Time Stop (`time-stop.ts`): the cast rolls 1d4 + 1 and `combat.timeStop` hands the caster that many
  turns in a row; a resolve of its that reaches another creature, or a move more than 1,000 feet from
  where it cast the spell, ends it.
- Squeezing and passing walls: a footprint that fits a gap only as a creature one size smaller squeezes
  through it as through Difficult Terrain (`footprintStepPassage`), and Incorporeal Movement passes walls
  and creatures the same way.
- Legendary actions are taken right after another creature's turn (`legendary.after-a-turn`): a turn
  change records the creature whose turn ended (`turn.afterActorId`), and the window stays open, one
  action a legendary creature, until the creature whose turn it is does something.

## Rules engine

The server owns 5e combat rules (ADR-0020): action resolution, typed damage with resistances,
effects and conditions, saves, reactions and opportunity attacks, concentration, spell slots,
rests, death saves, weapon masteries and movement budgets. Entry points are
`action-resolution.ts` and its neighbours in `apps/server/src`. Resolving an action runs a fixed
sequence of steps over one shared context, one module per step in `apps/server/src/resolution/`
(validation, attack roll, damage, masteries, on-hit effects, grants, concentration, pending saves
and reactions, the action economy, release); builtin actions such as Hide and the unarmed Grapple
add their special cases through the handler table in `resolution/builtins.ts`. Every condition
write goes through `applyCondition` in `effects.ts`, which honours innate and item-granted
immunities and runs what gaining a condition sets off (an Incapacitated creature drops its
Concentration and its grapples). In a fight, effects count down at turn start and turn end; the
start of a turn deals any ongoing damage, and the end opens any repeat saves
(`turn-boundaries.ts`). Two or more things that change Hit Points at the same moment (ongoing damage,
Temporary Hit Points or Hit Points regained, a trait that burns or regenerates) wait in `combat.turnSteps`
for the creature's controller to order them, the player's own or the GM's (`simultaneous-effects.ts`,
the `turn.order` command): a turn's start holds that player's actions and moves until the answer, and a
turn's end keeps the turn until it. What a stat block's traits do, read from their text when the bundle is built
(`ActorDefinition.traitMechanics`), runs at those boundaries and as damage lands: Regeneration, auras,
Undead Fortitude, a Death Burst (`trait-turns.ts`, `statblock-traits.ts`). A stat block's spells
(`castsSpells`) become cast actions as the catalog loads (`monster-spells.ts`). A spell that leaves an area acting later (Moonbeam, Spirit Guardians, a
wall of fire) opens a zone on the template the cast placed, or around its caster, which the server
runs as tokens move, as the area moves and at each turn's end and start (`spell-zones.ts`); what
such a spell lets its caster do on later turns is offered while it lasts, at the level it was cast
(`lasting-spells.ts`). A zone lasts while its caster's Concentration does, or the effect a spell with none
leaves on its caster, so it opens outside a fight too (where it acts on the creatures the GM moves into
it), counts down on the game clock, outlasts a fight and is carried into the next one on the same map.
A zone may act only on the creature types it names (Forbiddance), tell the GM who came in (Alarm), end
its spell the first time it acts and burst over its area (Glyph of Warding, drawn for the GM and its
caster alone), or raise a barrier at its edge (`zone-barriers.ts`): a step across it closes the path
for the creatures it holds back (Antilife Shell, Magic Circle), a melee attack without a Reach weapon
can't reach through Antilife Shell, and no creature teleports into Forbiddance. What an area gives the
creatures in it (Holy Aura's Advantage on saves, Pass without Trace's +10 to Stealth, Silence's Deafened
and Thunder immunity, Aura of Life's Hit Point maximum that can't drop) is an effect each one holds while
it stands inside (`zone-auras.ts`): the pipeline settles who holds it
after every command, as its own write when anything changed. A later action that moves a spell's area
(Moonbeam's Magic action, Flaming Sphere's ram) takes a template like a cast: the area moves there if that
is within the spell's reach of where it stood, its save falls on the creatures the area moves onto, and no
new shape is drawn (`zone-moves.ts`). An area that blasts from its caster (Gust of Wind's Line) is turned
instead: its new template must start at the caster. A cloud that drifts (Cloudkill) moves straight away from its
caster as the caster's turn starts. A cast's template grows with its slot where the spell says so (Fog Cloud), an
item's cast may place its own area (Cloak of Arachnida's doubled Web), and an Emanation that stays where
its caster stood (Globe of Invulnerability) keeps lower spells cast from outside off the creatures in it.
A use that places several areas (Fire Storm's ten Cubes, Meteor Swarm's four Spheres: `ActionArea.count`) takes them as
`templates`, each checked for its range, a point of its own and, where the area says so, touching another; a creature
under more than one is caught once (`multi-templates.ts`).
A creature pushed or pulled by force meets the areas on its straight way as any mover does (`pushed-through.ts`).
A move an action grants that enters creatures' spaces (Engulf, Trampling Charge) asks each creature it enters for the
action's save once, and a fire elemental's Fire Form burns a creature the first time on a turn it enters its space
(`path-meetings.ts`).
An item's action with a `zone` (spread Caltrops, a set Hunting Trap) rolls nothing as it is used: it opens
a zone that carries the action's own save and damage (`SpellZone.rule`), which stays until the GM ends it
or it goes off once.

Durations run on two clocks. In a fight they count rounds. Outside one, the game clock
(`rest.clockHours` and `rest.clockMinutes`) is the time: the GM passes time (`time.pass`), the party's Long
Rest moves it 8 hours and finishing the party's Short Rest moves it an hour, and `passGameTime`
(`game-time.ts`) counts every creature's effects down by it, 10 rounds to the minute. A fight's rounds
don't move the clock. When a fight ends, what has a minute (10 rounds) or less left ends with it, and
anything longer carries on in game time; a parked fight's combatants and a replay's copies wait outside
the clock. A spell of 10 minutes or less is kept in rounds and a longer one in minutes, at the duration
printed for the slot it was cast with (`spellDurationAt`), so Major Image from a level 4 slot lasts until
dispelled with no Concentration. An effect can also last until its bearer's next Short or Long Rest
(`until-rest`), which that rest ends. A creature's own Long Rest (the GM approving a request) ends what
would run out in its 8 hours and leaves longer effects for the GM to pass those hours, so they count
once. The clock also runs a Stable creature's 1d4 hours to 1 Hit Point and a knocked-out creature's hour.
While the GM tracks food and water (`rest.survival`), each midnight it crosses ends a day for every
character, which eats and drinks what it carries and meets the hunger and thirst rules (`survival.ts`).
A creature out of air counts its held breath down on the clock as it does at its turns' ends (`breath.ts`).

Death is a record on the creature (`Actor.death`, `death.ts`). After every command the server stamps when a
creature died: the fight's round while its fight runs, then the game clock. A rule that kills also says what killed
it and what is left of the body (Disintegrate's dust, a Vorpal Sword's lost head). A revival spell's conditions are
data on the spell (`effect.revives`: its time limit, no Undead, a new body, the Hit Points it gives back). They are
checked before anything is spent and applied as the cast resolves (`resolution/revival.ts`). Time under Gentle
Repose doesn't count against the limit, and Raise Dead's ordeal is a penalty to D20 Tests that eases with each Long
Rest. What kills outright is data too: damage that kills at 0 (`drain.killsAtZero`), a corpse that rises
(`drain.slainRise`, `risen.ts`, raised by `raiseCreature` in `summons.ts`), a hit that kills (`onHit.kills`, `resolution/kill.ts`), a cast that kills by Hit
Points (`killsAtHitPoints`) and a save whose failure acts by the target's Hit Points (`failureByHitPoints`,
`fatal-saves.ts`). All of them die through `killOutright` in `hit-points.ts`: a character makes no death saves, and
Death Ward turns aside a death that deals no damage. Stat block traits that cheat death (Misty Escape, the
Restoration traits, Multiple Heads, Loathsome Limbs) run from `death-traits.ts` as damage lands and as turns end.

A creature an action brings onto the map is data on the action (`summons`: its stat blocks, how many at each slot
level, where it appears, when it acts, how it is commanded and what ends it), run by `summons.ts` for spells, items
and stat blocks alike. Each comes from a bundled stat block or one a spell prints (`summons.v1.json`), scaled to the
cast's level and its caster's numbers where the stat block says how (`summonScaling`, `summon-stat-blocks.ts`) and
stored on the table. The creature records who brought it and what keeps it (`Actor.summon`), and who commands it and
on which side (`Actor.control`); `sideOf` reads the command first. It joins the turn order right after its user
(`InitiativeEntry.follows`) or on its own roll. A failed save whose effect carries the `commanded` tag (Dominate
Person, Planar Binding, an aboleth's Dominate Mind) puts its target under command the same way, and a creature a rule
raises (`raiseCreature`) is made the same way too. After every command the pipeline settles them: a creature whose
time, Concentration or Hit Points ran out, whose user died or that strayed too far leaves the roster, and a command
whose effect ended lapses. A commander's orders (a Bonus Action command, a dismissal, a familiar's eyes and pocket
dimension) are `summon.*` commands in `summon-orders.ts`; an uncommanded creature that dodges does so as its turn
starts (`summon-turns.ts`). A spell's force that strikes for its caster (Spiritual Weapon, Arcane Sword, Arcane Hand)
is a summoned token its attacks reach from, moved before each later one (`summon-strikes.ts`).

Each effect a spell leaves records the spell and the level it was cast at (`spell`), so a spell can be
ended as a whole: Dispel Magic and Remove Curse resolve in `resolution/dispel.ts`, which ends the
spell's effects, its area or its caster's Concentration (`spell-endings.ts`). A Concentration spell that
only affects creatures ends once no living creature keeps any of it and no save against it is still owed
(`endIdleConcentration` in `effects.ts`). A spell area's step can also come at its caster's turn start
(Faithful Hound's bite) or when the spell ends (Delayed Blast Fireball's bead): the command that ends
such a spell leaves its area bursting, and the pipeline runs the burst right after it commits.

Bonuses, advantage, extra damage and defences are modifiers in one vocabulary (`ModifierSchema` in
`packages/schemas`), shared by features, feats, chosen options, magic items and live effects, and
read by one evaluator (`collectRiders` in `packages/rules-5e`). `deriveEquipment`
(`equipment-derivation.ts`) gathers every carrier an actor has (its active items and the feats
they grant, its own feats and features, its live effects) with one context of bearer facts, and
each roll collects the standing modifiers plus those gated on its moment (`on-attack-roll`,
`on-saving-throw`, ...), so a modifier's `when` gate means the same thing on every carrier. A
carrier refuses what it cannot give back: an item refuses hit points and ability scores, an effect
everything the sheet stores (AC, initiative, slots). Senses on any carrier are read live by dynamic
vision. Riders name damage types and
conditions from the SRD's closed sets, and the homebrew publish gate (`homebrew-validate.ts`)
refuses a rider gated on a moment its reader never collects.

A grant or a failed save can offer options (Fire Shield's warm or chill, Bestow Curse's curse), one for
each target where the text says so. The resolve carries the pick (`optionId`, `targetOptions`), which is
checked before anything rolls and kept on the effect with what it adds (`resolution/grant-extras.ts`). A
grant can also bind to one carried weapon (`itemId`): its `this-item` riders reach that row's rolls and
its `weapon` changes how the row swings, until the row leaves the pack (`bound-weapons.ts`). A live effect
can offer its bearer actions: a Bonus Action Dash or Disengage, an action that ends it with a save or a
check, and another creature's spell action at the numbers it was cast with (`builtinActionsFor` in
`builtin-actions.ts`, `granted-actions.ts`).

What rides a hit is data on its action (`ridesHit`): the hits it rides, once a turn or on its user's own
turn, the dice it gives up, its cost, the save it opens and the effects picked with it (Sneak Attack's
Cunning Strikes, Brutal Strike, Stunning Strike, a staff's charges). The attack's preview offers it and
the confirm checks and spends it with the hit (`resolution/hit-options.ts`); it is never tapped alone.
What a stat block's or a magic weapon's hit leaves by itself (`onHit`: conditions, tags and modifiers on
one effect, a pull, a save at a printed DC, only on a rolled 20 or against some creature types) lands in
`resolution/on-hit.ts`. Who an action that isn't a spell may target (`targets`: how many, how far,
creature types, size, sight, grappled by its user, a condition, in its space, enemies or allies) is
checked as a spell's targets are, in `resolution/action-targets.ts`.

A magic item's charges are an `actionUses` pool keyed by the carried row (`itemPool` in
`item-actions.ts`), so two copies count separately and the count moves with the row when the GM hands
it over (`character.give-item`). A cast spends its printed cost (`useCost`), and one whose extra charges raise its
level (`chargesRaiseLevel`, a Wand of Fireballs) is one action for each cost. A pool that never comes back
(`per: "never"`, a Necklace of Fireballs' beads) starts at a count rolled when the row is added (`charges.starting`).
A Long Rest gives back the item's printed dice (`charges.regain`), not every charge; when the GM keeps a dawn hour
(`time.set-dawn`) the clock's dawn gives them back instead (`clock-pools.ts`). Spending the last charge rolls the
SRD's d20, and the record says what a 1 does (destroyed, or a plain item it becomes) and what a 20 gives back
(`resolution/charges.ts`, which also rolls a Thief's Use Magic Device d6). A pool spent for a time (`per: "time"`,
Wings of Flying) waits `afterHours` of game time from its first use (`readyAt` on the actor) and comes back as
`passGameTime` passes it. Ammunition is
counted on its row too (`ammunition.ts`): a shot from an Ammunition weapon needs a piece of the kind it fires
and spends one, and half of the pieces fired come back when the encounter ends. Magic ammunition is bound to a
kind when it is added, like a magic weapon to its base, so +1 bolts fit only a crossbow, and its bonus rides only
the shot that draws it. A shot outside a fight spends a piece too, and `character.recover-ammunition` picks up
half of them. A potion, a flask or a Spell Scroll whose record is `consumedOnUse` acts from the pack and leaves
the stack one smaller each time (`consumables.ts`). A Spell Scroll's row bears the one spell picked when it was
added (`spellId`). Reading it casts that spell like an item's cast, at the spell's own level with the scroll
table's save DC and attack bonus and no slot, for a reader whose class spell lists have it; a spell above the
levels the reader can cast takes a spellcasting ability check (DC 10 + its level) first, and a failure loses the
scroll with nothing cast (`scrolls.ts`). A thrown flask takes one attack of the Attack action (`replacesAttack`).
Alchemist's Fire sets its target burning and Oil covers it (`save.failureHazard`, `hazards.ts`): a burning
creature takes 1d4 Fire at the start of each of its turns until it uses the Put Out the Fire action, which leaves
it Prone, and Fire damage on an oiled creature within the minute deals 5 more. Antitoxin and a coat of Basic
Poison are effects the item grants its user; a coat's damage lasts a set number of hits (`damageUses`), in a fight
or out of one.

Every spell a sheet or stat block knows is a cast action (`character-build.ts`, `monster-spells.ts`), so even
one with nothing to roll (Light) spends its casting time and slot, holds its Concentration, places its area and is
told to the table as cast (`cast-narration.ts`). Before anything is spent the economy checks the cast's components
(`resolution/components.ts`: speech outside Silence, a free hand, a pouch, a focus the class names or a priced
material the content build lists on the spell) and its targets (`resolution/spell-targets.ts`: the count the spell
names, its creature type, sight with dynamic vision on, range, and for creatures of the caster's choice in an area,
the area). A cast with components waits while a creature that sees it may answer with Counterspell
(`resolution/counter.ts`, `counter-answers.ts`), and a reaction spell's prompt lets its caster pick the slot. A Spell
Scroll's cast is seen (a wand's needs no components and isn't), a spell readied with the Ready action is seen as it is
cast and not when it is let go, and a long casting as it begins. A
creature's own spell of a minute or more takes the action on each of its turns in a fight and resolves on the last
(`resolution/long-casting.ts`). A Cleric's Divine Intervention casts any Cleric spell of level 5 or lower (Wish with
Greater Divine Intervention) as an action of its own, minted in the effective list (`divine-intervention.ts`) and
picked under the feature's row on the sheet: cast at once, with no slot and no Material components. Outside a fight a creature's own cast resolves through the same path with no turn to
spend, and a long one moves the game clock by its whole hours; an item's cast there stays on the loose route.

A player only spends spell slots (`character.set-slot` refuses a raise from a player); everything that gives a
resource back is its own checked command. `conversions.ts` is one table of the features that turn one resource
into another or recover one (Font of Magic both ways, Arcane and Natural Recovery, Magical Cunning, restoring a
use with a slot or points, Pearl of Power), each with its timing, its check and its pick, offered by
`actor:available-actions` and taken with `actor.convert`. Hit Point Dice are spent only during a Short Rest, a
player's own or the party's (`rests.ts`). A finished rest opens a step on the actor (`restStep`) where its
recoveries and re-choices are made until its player taps Done; a re-choice the build reads (a Weapon Mastery pick,
a Wizard's cantrip, a Hunter's option) is written to the ledger and the sheet rebuilt (`ledger-rechoice.ts`), a
pick of several one held answer at a time. When Initiative is rolled, `initiative-hooks.ts` opens a window for the
features that act then (Persistent Rage, Uncanny Metabolism) and gives back what others restore (Perfect Focus,
Superior Inspiration, Archdruid).

A cast can carry Metamagic options and Sculpt Spells' picks (`ResolveInput.shaping`, `resolution/metamagic.ts`).
The economy checks each pick against the options the caster knows, the spell and the Sorcery Points left, and spends
the points with the cast. A pick changes what later steps read: the spell's range and duration (Distant, Extended),
the action's casting time and damage type (Quickened, Transmuted), the cast's level (Twinned), its components
(Subtle), its saves (Careful, Heightened, Sculpt Spells) and its damage dice (Empowered). Seeking Spell is a roll
answer on a missed spell attack. The shaping stays on the cast's open action instance for its later rays, on a
readied spell for its release and on a spell area for the saves it calls for later. `actor:available-actions` offers
each known option with its cost and why it can't be used now, and the sheet's cast detail sends the picks.

A creature that shape-shifts takes a form as an effect (`EffectInstance.form`, `apps/server/src/transform/`). The
action's `shapeShift` says where forms come from (its user's known forms for Wild Shape, the bestiary under limits for
Polymorph and Shapechange, or the stat block's printed forms for a werewolf), what the creature keeps of its own
statistics and how the form ends. Taking one stores a composed definition as `form-<actorId>`
(`transform/compose.ts`): a stat block's statistics with what is kept of the creature's own, or the creature's own with
a printed form's size and speeds. The actor's `definitionId` points at it while the form lasts, so every rule that reads
a definition reads the form, and the true one, Speed and Armor Class wait on the effect for its end
(`transform/assume.ts`). Ending the effect, by its duration, Concentration, the leave action the form adds, death,
running out of Temporary Hit Points or the Incapacitated condition (`transform/rules.ts`), gives them back. A form can
forbid spells, actions or attacks, and an action printed for some forms only is refused in the others; those are
economy rules (`form.*`). A sheet in a form can't be rebuilt or edited until it ends. A creature's size changes the same
way: a form's size, or an effect's `sizeChange` (Enlarge/Reduce, Large Form, the size potions), over the size it had
before (`ownSize`), and its token takes the new footprint from its top-left cell (`transform/forms.ts`). A player sees
only a form's name on an effect, never its stat block or terms (`projections.ts`).

What a save does is data on the action's save block: `successDamage` (half or none) and the
`failureCondition` a failed save imposes. Nothing parses the description for it. They are written where the content
is made (the SRD build, the builder, homebrew) and copied onto the pending save prompt.

The sheet's turn list reads `actor:available-actions`, which is owner-or-GM only: each option's availability with
one short sentence for why it can't be used now (`availability-reasons.ts`), a flag on what belongs off a turn list
(a rider such as Savage Attacker, a rest feature such as Arcane Recovery, a spell area's step the server runs), and the
mastery property a mastered weapon swing carries (`weapon-masteries.ts`). The server keeps each character's turn-card
pins (`character.set-favourites`) and counts each option that resolves for it (`option-uses.ts`), a bounded map.

Every ability check, from a sheet chip, a builtin action or the GM's call for a roll, comes from one plan
(`checkPlan` in `ability-checks.ts`), so the number a sheet shows is the roll the server makes. Gear that helps a
check only in a situation (a Book's topic, prying with a Crowbar) carries a rider gated on `situation-is`: the
derived sheet lists each situation (`check-situations.ts`), the sheet offers it as a toggle, and only a `check.roll`
that names it gets the rider, its words added to the roll's name for the GM to judge. A die a
player sees before it counts (a previewed attack, save or death save) is held on the server
(`held-rolls.ts`, ADR-0012): a second look shows the same die, and a reroll needs Heroic Inspiration or an
answer. An initiative die is held as it is thrown, so Heroic Inspiration may reroll it before the character's first
turn (`initiative-reroll.ts`). A damage roll may be looked at before it counts too (`damageLook`): the damage steps
throw through a tape that holds the dice in order, Empowered Spell or Heroic Inspiration rerolls the dice the roller
picks, and the confirm reads the held dice back, so it deals what was looked at (`resolution/held-damage.ts`). The
extras a hit carries roll at the confirm. An answer is data on an action, a grant or an effect (`RollAnswerSchema`): what a roll may take after it
is seen and before it counts (Bardic Inspiration's die, Indomitable's reroll, Stroke of Luck's 20).
`roll-answers.ts` offers the roller's own answers on the preview and applies the one picked to the held roll;
another creature's answer (Cutting Words, Countercharm, Improve Fate) is a `roll-answer` reaction prompt, asked one
creature at a time in turn order while the attack, save, check or damage waits at its roll. A hit's damage waits in
the same way (`damage-window.ts`): another creature's answer to the damage roll, then the target's own reaction
(Uncanny Dodge, Deflect Attacks, Stone's Endurance), and a failed save's damage waits for a reaction to taking damage.
An attack can wait before its roll too, while a creature that may change its target answers (`attack-targeted`,
`resolution/redirect.ts`): Redirect Attack hands it to an ally, the two swapping places, and an Arrow-Catching Shield's
wielder takes it on itself. A guardian's ward (Shield Guardian's Protection) is an `attack-would-hit` prompt to the
guardian for the creature that commands it, whose AC it raises.
Players type die faces, never totals, and only while the table allows typed dice. On the client every roll prompt
shares one set of controls (`RollControls.tsx`, with its answer buttons), and the GM's calls for a roll
(`GameState.rollCalls`) reach each player as a card that follows them across the app (`RollCallPrompt.tsx`).

How strictly rules are enforced is table policy (`GameState.rulesPolicy`): enforce, advise or
off, with per-family exceptions (`rules-families.ts`). A player blocked by a rule can ask the GM
(`rules.ask`); the GM allows or denies and the parked command replays with an override of that
rule's family only, so a block of another family is asked about separately. An override that
names no family is the GM's own ruling on the whole command.

## Content and homebrew

- SRD 5.2.1 content ships as JSON bundles in `packages/content-srd-5.2.1/bundles`, rebuilt from
  the package's `sources/` by `npm run content`. Class and magic-item mechanics are authored
  separately and merged at build time.
- The GM authors homebrew in the app. It is stored in its own store (`homebrew-store.ts`),
  validated against the same schemas, and served through `homebrew-http.ts`. A record is named before
  it is made (its id is minted from the name and never changes), and a duplicate keeps what it was
  based on (the SRD or homebrew record, its name and when it was copied) for Compare.
- Who sees a record is its audience: Hidden, Everyone, or chosen party characters, with a stamp each
  time it reached an audience. A draft is always Hidden, and unpublishing hides. The GM sets it per
  record or for many records in one write. Every record belongs to a pack: this table's own, or an
  imported pack with its name, credit and an on or off switch. Import is decided per record (as new,
  replacing the GM's own draft, skipped, or as a renamed copy) from a dry run that reports each
  record's kind, clash and problems in names; a published record is never replaced. Export takes a
  chosen set under a pack name.
- Every write leaves a history row (`homebrew_record_revisions`) with the device, the event and the
  fields it changed. History is read and restored over HTTP (a restored version becomes changes not
  live), and a stale save's 409 carries the fields the stored copy changed since, with both values.
- The publish gate (`homebrew-validate.ts`) returns sentences a GM reads: `homebrew-issues.ts` turns
  the schemas' findings into plain words that name the field and its owner, and every reference names
  a record. The gate reads the table with every pack on and warns when a record needs one from a pack
  that is off. The GM's Compendium reads (`homebrew-library.ts`) put the SRD's rows beside the
  homebrew of a kind with the kind's own columns, count by source and kind, and search the homebrew's
  text. Players read the same kinds, without monsters, through `content:compendium`.
- The GM's tab is the Compendium (`apps/client/src/compendium/`, ADR-0033): one table per kind with the
  SRD and the homebrew together, and each record at its own address with Card, Edit, Sharing and History.
  A record is made and edited in steps (`homebrew/wizard/`, ADR-0026): a wizard is data over the editor's
  own fields in plainer words, and a few composers keep derived values in step, such as a monster's
  Proficiency Bonus, XP and Hit Points or a spell's upcast rows. `wizard/steps.ts` gives every field no
  step asks a home step. `useHomebrewRecord` owns the draft, autosave, Publish and a conflict's merge for
  every tab, and the review step places the publish checklist on the step that answers each item. The
  checklist's sentences come from `homebrew-issues.ts` in the content package, the same words the gate
  sends. The monster wizard compares its numbers with the SRD stat blocks of its CR, read from the bundle
  by `content:monster-benchmarks`.
- A preview is the page: `CompendiumCard` draws a draft with the sheet's spell and item cards, the
  builder's detail and the bestiary's stat block (`encounter/StatBlock.tsx`), fed by
  `homebrew/summaries.ts`, which a mirror test holds equal to the server's catalog summaries. See as reads
  the server's own read for Everyone or one character (`see-as/content`). Players read the Compendium in
  the Codex (`compendium/player/`) over `GET /content/compendium` with their own token.
- Characters are built server-side (`character-build.ts`) from content and the choices made in
  the guided builder. What a build may pick is one survey (`character-offers.ts`): a create
  validates against it, the random generator answers it, and the builder is served it for each
  draft (`builder-offers.ts`), so the client holds no copy of the build rules. A multiclass build
  names the class each level went to (`classLevels`, kept in the choice ledger so a rebuild keeps the
  order); each class's features read that class's own level, and the server checks the SRD
  multiclass prerequisites with the scores of the moment each class is taken. An unfinished build
  is parked on the server (`character-drafts.ts`), one per player session and one for the GM, in its own
  table beside the game state, and read back only by its owner. A D&D Beyond PDF can be
  imported as an actor definition. What a character's next level brings is read from the same
  survey at the next level (`next-level.ts`, `character:next-level`), for whoever may level it.
  The builder's own rolls carry the purpose `builder`, so a sheet's latest roll leaves them out.
- A fresh table starts with a sample party (`sample-party.ts`): three level 7 characters made by the
  same builder from a fixed seed, so they level like any built character. Each is marked `sample`
  (GM-only), and one command (`actor.remove-samples`) removes every sample the roster rules let go and
  names any a player holds or a fight uses.

## Sound

Music and ambient sound play on the table screen only (ADR-0024); players' devices and the GM's never
play it. The GM's library is content-addressed files under `data/sound-assets/` with names in its own
table (`audio-assets.ts`, `sound-catalog.ts`, GM-only routes in `sound-http.ts`); an upload is sniffed
from its bytes and walked far enough to read its length and refuse a truncated, video or non-sound
file. The board (`sound-board.ts`, persisted by `sound-store.ts`, run by `sound-service.ts`) is apart
from the game state so it never bumps the game revision: a playlist the server moves on by itself with
a crossfade, looping ambient layers, one-shot effects, levels, pause, and a sound per scene that starts
when the scene goes live. The `sound.*` commands sit in the game command table but write that store.
The table screen's engine (`viewer/sound-engine.ts`) streams each file through a Web Audio gain, joins
at the position the feed gives, shows "Tap to turn on sound" until its browser allows sound, and
reports which of the two it is in for the GM's board.

## Codex

The worldbuilding Codex has its own store (`codex-store.ts`, a facade over one module per
aggregate in `apps/server/src/codex/`), router (`codex-http.ts`) and projection module, and does
not go through the game command pipeline. Every record has a reveal flag and text players read.
A page or quest keeps what only some readers see as hidden blocks (`codex/blocks.ts`): markdown
anchored between paragraphs of the player text, each with its own audience and the stamps of when
it reached each one, stored as a JSON list on the record. A page's fields each have an audience
too (a per-page list of Hidden keys), and so does each quest objective. The other records keep a
GM half beside the player half (a session's prep sections, an entry's GM text). Its HTTP shapes
are defined once in `packages/domain/src/codex-wire.ts` (session prep's in `codex-prep-wire.ts`
beside it): a record's GM shape is the stored row, its player shape is a separate allow-list
type, and the projections and the client's reads are typed against both. Every read a player can
make is built in one place, `PlayerCodexReads` in `codex/player-reads.ts`, for one reader (the
characters the session has claimed), which the router serves and the players' ping hashes. The GM
can preview the player view through `POST /api/v1/codex/preview-session`, which mints a real
player session that reads as everyone or as one party character. The player calendar and the GM
calendar are separate dates; a date reaches players only when it is published. Codex migration 4
(`codex/hidden-blocks-migration.ts`) turned the old single GM body into Hidden blocks, one per
`##` heading after the player text, and migration 5 turned a session's free-text prep into one
Text section; a version 1 backup restores through the same conversions.

Session prep is a list of typed sections (Text, Checklist, Linked pages, Scenes, Clocks, Quests in
play, Encounters; `codex/prep.ts`, shapes in `codex-prep-wire.ts`). A session copies its sections
from a prep template when it is made, from the GM's library of templates or the built-in starting
template, and owns the copy: editing a template never changes a session, and re-applying one keeps
what was written in the sections that still match. The live board (`codex/live.ts`) reads the active
session's prep; its commands tick a clue, set the current scene and log a line as a note filed under
the session. A tick and the current scene change the prep, so they move the session's `rev`, and an
editor holding the old one gets a conflict instead of overwriting the tick. Party position is one
write that moves the party pin to a point on any map, or makes one. Search filters and sorts, and the
GM's home counts, recent changes and reveal check, are built in `codex/find.ts`; a player's search
and home are built in `player-reads.ts` from that player's own reads.

The Scenes tab asks the Codex which records point at each table scene: `GET /api/v1/codex/scene-links` (GM only,
`codex/scene-links.ts`) lists the sessions that stage it or name it in their prep's Encounters, and the pins on the
atlas that name it.

The table has one clock (ADR-0029): the Codex calendar keeps the day and the game state keeps the time
of day (`rest.clockHours`, which the 16-hour rule between Long Rests reads, and `rest.clockMinutes`). A party rest or Pass time that
crosses midnight moves the GM's date by the days crossed (`onTimePassed` in the command context, then
`codexStore.advanceCampaignDate`), and the players' date with it when the two were the same day. Pass time
with a travel pace (SRD Travel Pace) logs how far the party went and what the pace does to its checks.

## Public HTTP API

`/api/v1` exposes the game commands, the Codex, homebrew and the viewer over versioned
envelopes, with the same handlers, authorization and projections as the UI. Conventions are in
ADR-0016; every router builds them from `apps/server/src/http-kit.ts` (bearer tokens, request ids,
envelopes), and a caught error reaches the caller only as a known refusal, never as raw text.

Every operation is declared once, in the route registry in `packages/api-contract/src/routes/`
(ADR-0034): its method and path, operation id, tag, summary and description, who may call it and with
which scope, its path, query and body schemas, and every answer by status. A game command's route is
generated from its entry in the command table (`gameCommandRoute`), so a command has no separate
declaration. The routers mount from the registry (`mount` in `http-kit.ts`) and parse each request
with the route's own schemas, and `apps/server/src/api-routes.ts` builds the OpenAPI 3.1 document
from the registry alone when the server starts. It is served at `/api/v1/openapi.json`.

Every schema in the document is generated from Zod, and its prose is the Zod schema's `.describe()`.
The response types are inferred from the same schemas (`packages/domain/src/codex-wire.ts`,
`content.ts` and `results.ts`, and the contract's `schemas/`), so a field added to a projection
reaches the document with it. `routes/components.ts` names the components. A response's data must
have a name there, and a body without one is named after its operation. Tests hold the server to the
registry. `api-routes.test.ts` fails when Express mounts a route the registry lacks or the reverse, and
validates real answers against the schema documented for their status. `credential-walk.test.ts`
checks every route's 401 and 403 against the document, and `codex-queries.test.ts` checks the two
Codex query strings the server reads by hand.

To add a route, declare it with `defineRoute` in the registry file for its surface, add it to that
file's route list (`API_ROUTES` gathers them), name its response data in `components.ts`, and mount
it with `mount(router, routes.name, ...)`, parsing the body with `routes.name.body.schema`.

## Persistence

Everything is kept in one data directory: `DATA_DIR`, by default `apps/server/data` (a relative `DATA_DIR` is read from
`apps/server`, and `apps/server/src/index.ts` also reads a `.env` file at the repo root). All stores share `vtt.sqlite`
(WAL) there. Integration credentials have their own SQLite file; GM auth is `auth.json`; map, token and Codex images
and the sound library's files are files under it. The directory is git-ignored. Elsewhere in this document, `data/`
means it. The Docker image sets `DATA_DIR=/data` for a volume, and `JOIN_URL` names the address players open, since a
container's network interfaces are its own (README.md, "Hosting with Docker").

Every store opens its database and runs its migrations through `apps/server/src/database.ts`. Each
store's history starts from one baseline migration recorded in the shared `migrations` table; a file
created before that reset is refused at startup with a message to move `data/` aside. Add a schema
change as a new numbered migration in the owning store.

## Client

A routed single-page app (`apps/client/src/router.ts`); every surface has an address. `main.tsx` installs
the zoom guard (`lib/zoom-guard.ts`, which holds a phone's page at its own size, as the other two entries do)
and mounts `shell/App.tsx`, where `useSession` holds the sign-in, the socket and the projected state, and
the GM and player shells render the surface the address names. The game arrives over the socket; the
Codex and homebrew are fetched over HTTP. Socket request/replies go through `lib/command.ts`
(`command` adds the `commandId`, `read` does not, and a lost reply becomes a refusal) and `/api/v1`
calls through `lib/api.ts`. The table viewer is a separate bundle that never loads the game client.
Rules checks on the client are hints only; the server decides.

The table (`shell/TableView.tsx`) is a docked workbench (ADR-0025): a header bar over the map with the scene and
the status line (`table/TableHeader.tsx`), the map's tool rail beside it (`scene/MapRail.tsx`), and one panel
(`table/TablePanel.tsx`) with Needs you or the player's prompt slot above its tabs and the view's one primary in
its footer. Nothing floats over the map but tokens and marks; notices land in the status line through
`ToastOutlet`. The map and the panel share small module stores: the targeting session (`encounter/targeting.ts`),
the live map's grid and size (`scene/tableGeometry.ts`) and the GM's selected token (`scene/selectedToken.ts`).

Scenes and maps are prepared on the Scenes tab (ADR-0035), in `scenes/` and `maps/`. `scenes/ScenesShell.tsx` draws
the section bar (or a phone's tab bar) and renders the view the address names (`scenes/routes.ts`): the front page,
the scene and map tables, a scene or a map as one document, or the steps that make or edit one
(`scenes/EditorFrame.tsx`). A scene's page and steps are built from the table's parts (`EncounterMap`, `MapRail`,
`TablePanel`, the tray) and edit the parked scene with its `sceneId`, so the table itself always shows the live
scene. Placing on any map is a button and then a press on it (`armPlacement` in `scene/tableGeometry.ts`), or the
spot menu a right-click or long press opens (`scene/MapSpotMenu.tsx`). The grid's calibration keeps its logic in
`maps/useCalibration.tsx`, which returns its parts (note, body, actions, canvas) for the map's steps to place.

The character sheet lives in `sheet/` (ADR-0030). `CharacterSheet.tsx` is one component for every place it sits: a
page (My character, `/characters/<id>`, `sheet.html`), the GM's dialog, or the table panel's Me and Sheet tabs. It
picks a narrow, wide or panel frame from the presentation and the width. Its tabs share one controller
(`useSheetController.tsx`) that sends every change as a command. `useSheetDefinition.ts` reads
`actor:available-actions` into the turn's options (`turn-options.ts`) with each row's reason, passive flag and mastery.
The laptop's list (`ActionList.tsx`) and the phone's turn card (`TurnCard.tsx`) draw the same options, and the table's
Turn tab runs them through `encounter/PlayerActionRunner.tsx`, which also aims a cast started on the sheet. A cast,
an item or a spell to copy opens through `SheetDetail.tsx`: where its list was, in a drawer, or in the laptop's right
column. The sheet notes the ids of the rolls it starts (`sheet-roll-ids.ts`), and its latest-roll line shows only
those.

The Codex client (ADR-0031) lives in `codex/`. `CodexShell.tsx` (the GM) and `PlayerCodex.tsx` (a player, and the
GM's preview, which runs on a local route) both draw `shell/CodexFrame.tsx`, the section bar or the phone's tab bar,
and render the section the address names from `shell/sections.tsx`, each entry a GM view and a player view. Views read
the shell through context (`shell/context.ts`): the role and token, the address, and for the GM the shared feeds,
the party and quick create. A player's views read only `playerCodexApi` and the player shapes of `api-records.ts`,
which holds the record reads and writes (pages and quests with their blocks and audiences, search, home). The views
live in their own folders (`home/`, `search/`, `page/`, `quests/`, `relationships/`) over the pieces in `shared/`. Who
sees it, the filter flyout, the dropdown and the Sort dialog are shared with the Compendium, Scenes, Maps and Settings,
so they live in `@vtt/ui` (`packages/ui/src/records/`).
A page's editor (`page/DocEditor.tsx`) writes the player text and the hidden blocks in one document;
`page/document.ts` places blocks by `codexParagraphs` from `@vtt/domain`, the rule the server assembles bodies by.
The table's Codex tab is `table/CodexTab.tsx`, over the same reads.

Settings (ADR-0036) lives in `settings/`. `sections.ts` declares the sections (Players, Fights, Characters, Device,
Access and API) with their audience and every setting's label and hint; the page, its search and the tests read it.
`SettingsPage.tsx` draws the Codex shell's section bar or phone tab bar around the section the address names
(`/settings/<section>`); a player's page is Device alone, so GM sections never mount for a player. Each section is
its own component and writes through the same commands as before (`table-writes.ts`). The integration credentials
(`integrations/CredentialsTable.tsx`) read and write their GM routes. The API reference
(`integrations/ApiReference.tsx`, an operation at `/settings/api/<operation id>` in `OperationDocument.tsx`) reads the
OpenAPI document the route registry generates, through `integrations/openapi-model.ts` and `api-rows.ts`: the
document's tags, in its order, group the table, and an operation's page shows the document's example body where it
has one.

The themes are Night, Dusk, Dawn and Day (`dark`, `dusk`, `dawn`, `light` on `<html data-theme>`), one token set in
`packages/ui/src/styles/design-tokens.css`. Each HTML entry sets the stored theme before first paint, and `ThemeSwitch`
in every app bar and `ThemeToggle` in Settings share `useTheme`, which hears every change on the page.

Surfaces not needed for first paint load on first use (`components/lazySurface.tsx`): the Codex,
the Compendium, settings and the API reference, the character builder and level flow, replays, the map
library, the shared-screen controls and the sound board. pdf.js loads with the first imported PDF. The build targets
current phone and laptop browsers (Chrome and Edge 111, Firefox 121, Safari 16.4; `build.target` in
`apps/client/vite.config.ts`), the floor the stylesheets' `:has()` and `dvh` already set.
