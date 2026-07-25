# OzyVTT

A private, LAN-hosted D&D 5e virtual tabletop and worldbuilding tool for one GM and a small home group. Players join from a phone or laptop on the same network and claim a character. No accounts, no cloud service.

Two parts:

- **Combat** — upload a battlemap, calibrate the grid, run initiative and turns, and move tokens. Players use a character sheet and roll on their own turn. A second screen shows a player-safe view.
- **Codex** — a wiki of typed pages (characters, locations, factions, items, …), an atlas of nested maps, a journal with a custom calendar, and a relationship graph. Each page has a player-facing layer and a GM-only layer; GM-only content is never sent to players.

## Requirements

Node.js 24 or newer.

## Running it

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. Vite also prints a `Network` address such as `http://192.168.1.50:5173` for other devices on the LAN. Port 3001 is the development API.

To run the single service players use:

```bash
npm run start
```

This builds the client and serves everything on `:3001`. Open `http://localhost:3001` on the host; players join at `http://HOST-IP:3001`. On Windows, allow Node.js on private networks only.

`data/` holds the password hash and campaign data. It is git-ignored; back it up separately.

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Client on `:5173` and the server (dev API `:3001`). |
| `npm run check` | Typecheck each workspace. |
| `npm run test` | Run tests. |
| `npm run build` | Build all workspaces. |
| `npm run start` | Build, then serve on `:3001`. |

## Running combat

1. Enter GM mode. Open **Scenes**, add a scene, and upload its battlemap under **Manage maps**.
2. Choose a printed square grid or a gridless map. For a printed grid, drag diagonally across a 3×3 block of squares to set the scale, then confirm and save.
3. Under **Table viewer**, open the second-screen address and pair it with a code from the GM.
4. Select the map and click **Present**. This sends the map to the second screen.
5. Under **Encounter and Initiative**, pick combatants, optionally enter initiative scores (blanks are rolled on the server), and start. Tokens appear in the tray above the map.
6. Drag tokens onto the map and drag them to move. Printed grids snap to cell centers; gridless maps place freely. Players move only their own character; the GM moves any token.
7. Advance turns from the GM controls. The player map and second screen update automatically. GM-only combatants do not appear on player screens.

## Using the Codex

1. As GM, open the **Codex** tab and go to **Pages**. Create a page, pick its type, fill its fields, and write the body. Each page has a player-facing section and a GM-only section. Link pages with `[[wiki-links]]` and typed relationships.
2. Open **Atlas**, upload a map, and place markers. A marker can link a page, a nested sub-map, or a prepared scene.
3. Open **Journal**, set the campaign calendar, and post dated entries. The timeline groups by in-world year.
4. Reveal the pages and markers players should see. Players open the Codex to read them; GM-only content stays hidden.

## HTTP API

The combat commands are also available over a REST API at `/api/v1`. The reference is [docs/api-reference.md](docs/api-reference.md); a running server serves the spec at `/api/v1/openapi.json`.

- Mint a scoped credential with `POST /api/v1/gm/integration-credentials` (requires a GM session token). The token is shown once.
- Read game state with `GET /api/v1/game` (add `?view=player` for the player-safe projection); poll with the returned `ETag`.
- Send commands with typed routes such as `POST /api/v1/game/encounter/start`, or the generic `POST /api/v1/game/commands`. Writes use the same validation and authorization as the UI, are idempotent by `commandId`, and honor `expectedRevision`.
- List and read archived encounters under `GET /api/v1/encounters`.

The Codex has its own routes under `/api/v1/codex/*`, authorized by a GM or player session rather than an integration credential.

## Not in scope

Not a guided character builder (a play sheet exists), voice/video, a public or multi-tenant service, a scripting language, or a 3D tabletop.

## Layout

TypeScript monorepo: `apps/client` (React/Vite) and `apps/server` (Express + Socket.IO, authoritative), with shared packages under `packages/` (`domain`, `rules-5e`, `schemas`, `api-contract`, `ui`, `content-srd-5.2.1`, `test-fixtures`). Game state lives on the server in SQLite. More detail is in [docs/ai-context/](docs/ai-context/), [docs/adr/](docs/adr/), and [BUILD_PLAN.md](BUILD_PLAN.md).
