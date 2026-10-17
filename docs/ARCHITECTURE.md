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
| `packages/api-contract`      | The public HTTP API: path constants, command scopes and the wire schemas both sides share.                     |
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
  their own projected view instead.
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
audience. There are four:

- **Game** (`apps/server/src/projections.ts`): `projectPlayerView` and `projectGmView`. Players
  get only `public` actors, a health band with no exact HP, and owner-only sheet resources
  for their own character. A hidden effect's source becomes "A hidden threat". Private rolls,
  owner identity, GM notes and hidden turns are removed. A live scene's map reaches players before
  its fight, with the public tokens the GM has placed; the turn order and the tray wait for the
  fight. A player's reply to an area they aimed names only the creatures they may see. A player's
  reaction prompt names the attack total it answers only when the attack's own roll is in that
  player's dice log. An unclaimed character carries its species and class line for the claim
  picker, since any player could claim it and read its sheet.
- **Table viewer** (`viewer-presentation.ts`, `viewer-encounter.ts`): the public screen in a
  room that may hold non-players. It follows the live scene, before and during its fight, unless
  the GM paused it. Only public actors with a position become tokens; annotations
  are public and unexpired; initiative appears only during combat; nothing is shown while
  paused. The fields that may cross are the `ViewerEncounterScene` and
  `ViewerPresentationProjection` types, plus `sound` (`ViewerSoundProjection`, added by
  `viewer-coordinator.ts` when the feed is sent): only what is playing, by file id, level and
  position, never a name, the playlist or the library. The screen may fetch a sound file only
  while it is in that projection.
- **Codex** (`codex-projections.ts`): a player gets the player half of a revealed record and
  nothing else. Reveal is a graph: a child never leaks an unrevealed parent or target, and
  `codex/visibility.ts` resolves a record's neighbours for the projection. Some fields (staged
  scene ids on markers and sessions) are GM-only even when revealed. A hidden record is a 404,
  never a 403, and ETags are computed after every gate.
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
is a creature with any part of its space revealed.

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
- Dynamic vision (ADR-0023) is per scene and off by default: walls, doors and windows as
  image-pixel segments, placed and carried lights, and an ambient light level
  (`vision/edit.ts`). The server builds each viewer's visibility polygon against the walls, cuts it
  to the creature's senses and the lights (`vision/geometry.ts`, `vision/sight.ts`), and caches
  polygons by walls, origin and radius. Senses come from stat blocks, species and features, and
  light from equipped items (`vision/senses.ts`). After every command the server adds what the
  party sees to the scene's explored memory (`rememberExplored`). Players and the table screen
  get only polygons and rectangles to paint. While vision is on, walls, closed doors and windows
  also bar movement, and sight decides an attack's unseen Advantage and Disadvantage and whether
  Hide is allowed.
- Difficult terrain is a GM-painted set of cell-snapped rectangles per scene (`terrain.ts`).
  A move is charged along the cheapest grid path, where terrain costs double, other creatures'
  spaces cost double or bar the way, and crawling, climbing or swimming without the speed, or
  dragging a grappled creature, add a foot per foot (`movementPath` and `spacePassage` in
  `@vtt/rules-5e`). How a token travels (walking, a special speed, teleporting, moved by force)
  rides on `token.move`, each speed with its own budget (`speed.ts`), and opportunity attacks are
  read along the whole path (`movement-rules.ts`). The map's drag preview runs the same function,
  and a mirror test checks the two agree. Players and the table screen get only the terrain the
  fog reveals, and with vision on only what the party has seen.

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
Concentration and its grapples). Effects end by their duration at turn start and turn end; the
start of a turn deals any ongoing damage, and the end opens any repeat saves
(`turn-boundaries.ts`). What a stat block's traits do, read from their text when the bundle is built
(`ActorDefinition.traitMechanics`), runs at those boundaries and as damage lands: Regeneration, auras,
Undead Fortitude, a Death Burst (`trait-turns.ts`, `statblock-traits.ts`). A stat block's spells
(`castsSpells`) become cast actions as the catalog loads (`monster-spells.ts`). A spell that leaves an area acting later (Moonbeam, Spirit Guardians, a
wall of fire) opens a zone on the template the cast placed, or around its caster, which the server
runs as tokens move, as the area moves and at each turn's end and start (`spell-zones.ts`); what
such a spell lets its caster do on later turns is offered while it lasts, at the level it was cast
(`lasting-spells.ts`).

Bonuses, advantage, extra damage and defences are modifiers in one vocabulary (`ModifierSchema` in
`packages/schemas`), shared by features, feats, chosen options, magic items and live effects, and
read by one evaluator (`collectRiders` in `packages/rules-5e`). `deriveEquipment`
(`equipment-derivation.ts`) gathers every carrier an actor has (its active items and the feats
they grant, its own feats and features, its live effects) with one context of bearer facts, and
each roll collects the standing modifiers plus those gated on its moment (`on-attack-roll`,
`on-saving-throw`, ...), so a modifier's `when` gate means the same thing on every carrier. A
carrier refuses what it cannot give back: an item refuses hit points and ability scores, an effect
everything the sheet stores (AC, initiative, slots, senses). Riders name damage types and
conditions from the SRD's closed sets, and the homebrew publish gate (`homebrew-validate.ts`)
refuses a rider gated on a moment its reader never collects.

A magic item's charges are an `actionUses` pool keyed by the carried row (`itemPool` in
`item-actions.ts`), so two copies count separately and the count moves with the row when the GM hands
it over (`character.give-item`). A Long Rest gives back the item's printed dice (`charges.regain`), not
every charge, and spending the last one rolls the SRD's d20 for the GM (`item-charges.ts`). Ammunition is
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

What a save does is data on the action's save block: `successDamage` (half or none) and the
`failureCondition` a failed save imposes. Nothing parses the description for it. They are written where the content
is made (the SRD build, the builder, homebrew) and copied onto the pending save prompt.

Every ability check, from a sheet chip, a builtin action or the GM's call for a roll, comes from one plan
(`checkPlan` in `ability-checks.ts`), so the number a sheet shows is the roll the server makes. A die a
player sees before it counts (a previewed attack, save or death save) is held on the server
(`held-rolls.ts`, ADR-0012): a second look shows the same die, and Heroic Inspiration is a player's only
reroll. Players type die faces, never totals, and only while the table allows typed dice. On the client every
roll prompt shares one set of controls (`RollControls.tsx`), and the GM's calls for a roll
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
  validated against the same schemas, and served through `homebrew-http.ts`.
- New homebrew opens in a step-by-step wizard (`apps/client/src/homebrew/wizard/`, ADR-0026). A
  wizard is data over the same draft the full editor edits: its questions are the editor's own
  fields in plainer words, and a few composers keep derived values in step, such as a monster's
  Proficiency Bonus, XP and Hit Points or a spell's upcast rows and healing sentence. `RecordDetail`
  owns the draft, autosave and publish for both views, and the review step places the editor's
  publish checklist on the step that answers each item. The monster wizard compares its numbers with
  the SRD stat blocks of its CR, read from the bundle by `content:monster-benchmarks`.
- Characters are built server-side (`character-build.ts`) from content and the choices made in
  the guided builder. What a build may pick is one survey (`character-offers.ts`): a create
  validates against it, the random generator answers it, and the builder is served it for each
  draft (`builder-offers.ts`), so the client holds no copy of the build rules. A multiclass build
  names the class each level went to (`classLevels`, kept in the choice ledger so a rebuild keeps the
  order); each class's features read that class's own level, and the server checks the SRD
  multiclass prerequisites with the scores of the moment each class is taken. An unfinished build
  is parked on the server (`character-drafts.ts`), one per player session and one for the GM, in its own
  table beside the game state, and read back only by its owner. A D&D Beyond PDF can be
  imported as an actor definition.
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
not go through the game command pipeline. Every record has a player half, a GM half and a
reveal flag. Its HTTP shapes are defined once in `packages/domain/src/codex-wire.ts`: a record's GM
shape is the stored row, its player shape is a separate allow-list type, and the projections and
the client's reads are typed against both. The GM can preview the player view through
`POST /api/v1/codex/preview-session`, which mints a real player session. The player calendar and
the GM calendar are separate dates; a date reaches players only when it is published.

The table has one clock (ADR-0029): the Codex calendar keeps the day and the game state keeps the hour
(`rest.clockHours`, which the 16-hour rule between Long Rests reads). A party rest or Pass time that
crosses midnight moves the GM's date by the days crossed (`onTimePassed` in the command context, then
`codexStore.advanceCampaignDate`), and the players' date with it when the two were the same day.

## Public HTTP API

`/api/v1` exposes the game commands, the Codex, homebrew and the viewer over versioned
envelopes, with the same handlers, authorization and projections as the UI. The OpenAPI
document is assembled in `apps/server/src/openapi/` and served at `/api/v1/openapi.json`. The
components with a Zod schema behind them (the contract's shapes, the homebrew vocabulary and record
bodies, the Codex write bodies and records, the content catalogs, the viewer, map, available-actions and
builder-offer responses, every game command's request body) are generated from it in `components.ts`,
with their prose in `descriptions.ts`; each game command's operation comes from the command table. Each
response's TypeScript type is inferred from its schema (`packages/domain/src/codex-wire.ts`, `content.ts`
and `results.ts`, and the server's viewer and map modules), so a field added to a projection reaches the
document with it. `document.ts` keeps the structure around them: the response envelopes, the
role-projected `oneOf` reads, a few small fixed shapes, and the objects it deliberately leaves opaque. Conventions are in
ADR-0016; every router builds them from `apps/server/src/http-kit.ts` (bearer tokens, request ids,
envelopes), and a caught error reaches the caller only as a known refusal, never as raw text.

## Persistence

All stores share `data/vtt.sqlite` (WAL). Integration credentials have their own SQLite file;
GM auth is `data/auth.json`; map, token and Codex images and the sound library's files are files under `data/`. Paths are
chosen in `apps/server/src/index.ts`. `data/` is git-ignored.

Every store opens its database and runs its migrations through `apps/server/src/database.ts`. Each
store's history starts from one baseline migration recorded in the shared `migrations` table; a file
created before that reset is refused at startup with a message to move `data/` aside. Add a schema
change as a new numbered migration in the owning store.

## Client

A routed single-page app (`apps/client/src/router.ts`); every surface has an address. `main.tsx` only
mounts `shell/App.tsx`, where `useSession` holds the sign-in, the socket and the projected state, and
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

Surfaces not needed for first paint load on first use (`components/lazySurface.tsx`): the Codex,
homebrew, settings and the API reference, the character builder and level flow, replays, the map
library, the shared-screen controls and the sound board. pdf.js loads with the first imported PDF. The build targets
current phone and laptop browsers (Chrome and Edge 111, Firefox 121, Safari 16.4; `build.target` in
`apps/client/vite.config.ts`), the floor the stylesheets' `:has()` and `dvh` already set.
