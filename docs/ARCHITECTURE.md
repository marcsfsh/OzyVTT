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
GM browser ─────┤                    ├─▶ validate ─┼─▶ homebrew store      ├─ data/vtt.sqlite
                └─ HTTP /api/v1 ─────┘   authorize ├─▶ viewer presentation │
                                                   └─▶ combat log ─────────┘
Table viewer ◀── SSE + cookie, player-safe presentation projection only
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
never to one transport.

## Realtime

Socket.IO over the same origin as HTTP. Server-to-client events come in two kinds:

- **Projected channels** carry content and are computed per recipient: `state:updated`,
  `table:event` and `log:entry`. `log:entry` is computed per socket because a self-only roll
  belongs to exactly one player; `projectFeedRow` in `combat-log.ts` makes that decision.
- **Ping channels** carry only a revision: `codex:changed` and `homebrew:changed`. Naming what
  changed would tell players which part of the world the GM is editing, so clients refetch
  their own projected view instead.

On connect the server sends a full projected snapshot. The client keeps its token in
`localStorage` and passes it in `socket.auth`, so reconnects resume without a new join. Presence
holds a dropped session as "reconnecting" for about 8 seconds before "offline".

## Identity and roles

- **GM.** The first GM password can only be set from loopback (`POST /api/v1/host/setup`). It is
  stored as a bcrypt hash in `data/auth.json` with a random token secret. GM tokens are
  HMAC-signed, expire after 12 hours, and can be revoked singly or all at once. The host routes
  (`host-http.ts`) are the one part of `/api/v1` without open CORS, so a web page can't relay password
  guesses.
- **Player.** No password. Joining issues a signed 30-day token. A player claims one
  player-character at a time; the claim sets that character's `ownerSessionId`. A player may
  act only on the character they own: move it, roll for it, level it, set its token image.
- **Integration credential.** A GM-minted, scoped bearer token for the HTTP API (ADR-0016).
- **Table viewer.** A pairing code exchanged for an HttpOnly cookie. It can only read the
  presentation projection.

Role comes from the signed token, never from network position. Archived characters cannot be
claimed, staged or added to a fight.

## Projections: the security boundary

Every byte that reaches a player or the shared screen goes through a projection built for that
audience. There are four:

- **Game** (`apps/server/src/projections.ts`): `projectPlayerView` and `projectGmView`. Players
  get only `public` actors, a health band instead of exact HP, and owner-only sheet resources
  for their own character. A hidden effect's source becomes "A hidden threat". Private rolls,
  owner identity, GM notes and hidden turns are removed.
- **Table viewer** (`viewer-presentation.ts`, `viewer-encounter.ts`): the public screen in a
  room that may hold non-players. Only public actors with a position become tokens; annotations
  are public and unexpired; initiative appears only during combat; nothing is shown while
  paused. The fields that may cross are the `ViewerEncounterScene` and
  `ViewerPresentationProjection` types.
- **Codex** (`codex-projections.ts`): a player gets the player half of a revealed record and
  nothing else. Reveal is a graph: a child never leaks an unrevealed parent or target, and
  `codex/visibility.ts` resolves a record's neighbours for the projection. Some fields (staged
  scene ids on markers and sessions) are GM-only even when revealed. A hidden record is a 404,
  never a 403, and ETags are computed after every gate.
- **Replay** (`replay-projection.ts`): a shared fight archive is rebuilt per turn from an
  allow-list. It carries no session ids, notes, stat blocks, or rolls that were not public.

Sight is part of the boundary (ADR-0023). `vision/audience.ts` decides, per audience, which
creatures it may know of. A player sees through their own placed characters; the table viewer, a
spectator and a replay see through the whole party. A creature that isn't a player character is
hidden from an audience, exactly like a `gm-only` one, when none of its characters perceive it
(dynamic vision on), or when its whole space lies under the scene's manual fog (fog on). The same
goes for one staged that way in a prepared scene. Every projection, the feed and toast gate, and a
player's target check read that one answer (`AudienceSight`). Another player's character out of
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
(`turn-boundaries.ts`).

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
it over (`character.give-item`). A long rest gives back the item's printed dice (`charges.regain`), not
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

What a save does is data on the action's save block, not read from its description: `successDamage`
(half or none) and the `failureCondition` a failed save imposes. They are written where the content
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
- Characters are built server-side (`character-build.ts`) from content and the choices made in
  the guided builder. What a build may pick is one survey (`character-offers.ts`): a create
  validates against it, the random generator answers it, and the builder is served it for each
  draft (`builder-offers.ts`), so the client holds no copy of the build rules. A multiclass build
  names the class each level went to (`classLevels`, kept in the choice ledger so a rebuild keeps the
  order); each class's features read that class's own level, and the server checks the SRD
  multiclass prerequisites with the scores of the moment each class is taken. An unfinished build
  is parked on the server (`character-drafts.ts`), one per player session and one for the GM, beside
  the game state rather than in it, and read back only by its owner. A D&D Beyond PDF can be
  imported as an actor definition.

## Codex

The worldbuilding Codex has its own store (`codex-store.ts`, a facade over one module per
aggregate in `apps/server/src/codex/`), router (`codex-http.ts`) and projection module, and does
not go through the game command pipeline. Every record has a player half, a GM half and a
reveal flag. Its HTTP shapes are defined once in `packages/domain/src/codex-wire.ts`: a record's GM
shape is the stored row, its player shape is a separate allow-list type, and the projections and
the client's reads are typed against both. The GM can preview the player view through
`POST /api/v1/codex/preview-session`, which mints a real player session. The player calendar and
the GM calendar are separate clocks; a date reaches players only when it is published.

## Public HTTP API

`/api/v1` exposes the game commands, the Codex, homebrew and the viewer over versioned
envelopes, using the same handlers, authorization and projections as the UI. The OpenAPI
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
GM auth is `data/auth.json`; map, token and Codex images are files under `data/`. Paths are
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

Surfaces not needed for first paint load on first use (`components/lazySurface.tsx`): the Codex,
homebrew, settings and the API reference, the character builder and level flow, replays, the map
library and the shared-screen controls. pdf.js loads with the first imported PDF. The build targets
current phone and laptop browsers (Chrome and Edge 111, Firefox 121, Safari 16.4; `build.target` in
`apps/client/vite.config.ts`), the floor the stylesheets' `:has()` and `dvh` already set.
