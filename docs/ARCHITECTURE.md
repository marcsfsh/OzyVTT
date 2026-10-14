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

| Package | What it holds |
| --- | --- |
| `apps/server` | Express + Socket.IO service: stores, command handlers, projections, HTTP routers. |
| `apps/client` | React/Vite UI. Entries: `index.html` (the app), `viewer.html` (table viewer), `sheet.html` (standalone sheet), `styleguide.html`. |
| `packages/domain` | The realtime wire contract: `GameState`, socket event maps, projection view types. |
| `packages/schemas` | Zod schemas for actors, effects and riders shared by server and content. |
| `packages/api-contract` | The public HTTP API: OpenAPI document, path constants, command scopes. |
| `packages/rules-5e` | Pure 5e rules helpers: dice grammar, ability scores, progression tables, rider evaluation. |
| `packages/content-srd-5.2.1` | SRD 5.2.1 content bundles and the scripts that generate them from vendored sources. |
| `packages/dndbeyond-pdf` | Turns a D&D Beyond character-sheet PDF into an actor definition (runs in the browser). |
| `packages/ui` | Design tokens, fonts and the `nh-` UI primitives. |
| `packages/test-fixtures` | Actor fixtures shared by tests. |

Packages are consumed as TypeScript source; only the client and server have build steps.

## The command pipeline

A command is a named socket event (or an HTTP call to `/api/v1/game/...`) carrying a UUID
`commandId` and an optional `expectedRevision`. Both transports call the same handler in
`apps/server/src/game-operations.ts`:

1. Validate the payload with a strict Zod schema (`game-commands.ts`).
2. Authorize from the signed token, per command. Role is never cached at connect.
3. `store.execute` commits the idempotency receipt, the domain event and the new state in one
   SQLite transaction and bumps the revision. A repeated `commandId` returns the earlier result
   with `duplicate: true` and changes nothing. A stale `expectedRevision` is rejected.
4. Broadcast `state:updated` with a projection computed separately for each socket's role.

Commands run one at a time through a promise queue. Add new capability to the operations layer,
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

- **GM.** The first GM password can only be set from loopback (`POST /api/bootstrap`). It is
  stored as a bcrypt hash in `data/auth.json` with a random token secret. GM tokens are
  HMAC-signed, expire after 12 hours, and can be revoked singly or all at once.
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
  nothing else. Reveal is a graph: a child never leaks an unrevealed parent or target. Some
  fields (staged scene ids on markers and sessions) are GM-only even when revealed. A hidden
  record is a 404, never a 403, and ETags are computed after every gate.
- **Replay** (`replay-projection.ts`): a shared fight archive is rebuilt per turn from an
  allow-list. It carries no session ids, notes, stat blocks, or rolls that were not public.

The rule for a new field: it may reach a player or the viewer only if everything it carries is
already public to them, and it carries no exact quantity and no identity, position or existence
of a hidden thing. When in doubt, leave it out. Fog of war is presentation only (ADR-0022);
hidden things are stripped by the projections regardless of what fog covers.

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

## Rules engine

The server owns 5e combat rules (ADR-0020): action resolution, typed damage with resistances,
effects and conditions, saves, reactions and opportunity attacks, concentration, spell slots,
rests, death saves, weapon masteries and movement budgets. Entry points are
`action-resolution.ts` and its neighbours in `apps/server/src`.

How strictly rules are enforced is table policy (`GameState.rulesPolicy`): enforce, advise or
off, with per-family exceptions (`rules-families.ts`). A player blocked by a rule can ask the GM
(`rules.ask`); the GM allows or denies and the parked command replays.

## Content and homebrew

- SRD 5.2.1 content ships as JSON bundles in `packages/content-srd-5.2.1/bundles`, generated
  from vendored sources by the package's `build-*` scripts. Magic-item mechanics are authored
  separately and merged at build time.
- The GM authors homebrew in the app. It is stored in its own store (`homebrew-store.ts`),
  validated against the same schemas, and served through `homebrew-http.ts`.
- Characters are built server-side (`character-build.ts`) from content and the choices made in
  the guided builder. A D&D Beyond PDF can be imported as an actor definition.

## Codex

The worldbuilding Codex has its own store (`codex-store.ts`), router (`codex-http.ts`) and
projection module, and does not go through the game command pipeline. Every record has a
player half, a GM half and a reveal flag. The GM can preview the player view through
`POST /api/v1/codex/preview-session`, which mints a real player session. The player calendar
and the GM calendar are separate clocks; a date reaches players only when it is published.

## Public HTTP API

`/api/v1` exposes the game commands, the Codex, homebrew and the viewer over versioned
envelopes, using the same handlers, authorization and projections as the UI. The OpenAPI
document is `packages/api-contract` and is served at `/api/v1/openapi.json`. Conventions are in
ADR-0016.

## Persistence

All stores share `data/vtt.sqlite` (WAL). Integration credentials have their own SQLite file;
GM auth is `data/auth.json`; map, token and Codex images are files under `data/`. Paths are
chosen in `apps/server/src/index.ts`. `data/` is git-ignored.

## Client

A routed single-page app (`apps/client/src/router.ts`); every surface has an address. The game
arrives over the socket; the Codex and homebrew are fetched over HTTP. The table viewer is a
separate bundle that never loads the game client. Rules checks on the client are hints only;
the server decides.
