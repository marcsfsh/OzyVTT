# OzyVTT

A private, LAN-hosted D&D 5e **virtual tabletop _and_ worldbuilding platform** for one trusted GM and a small home group. It has two first-class pillars:

- **A combat-first table.** Players join directly from a phone or laptop on the same network, claim a character, and share one responsive combat experience — battlemaps and grid calibration, initiative and turns, server-authoritative token movement, an interactive character sheet, and a player-safe second screen for the TV at the table.
- **A worldbuilding Codex.** A typed-entity wiki (characters, locations, factions, items, …), an interactive atlas, a campaign journal on a fantasy calendar, and a relationship graph — every surface two-layer (player-facing + GM-secret) and viewer-safe.

No accounts, no invitations, no cloud service: trust comes from being on the same LAN, not from authentication.

## Current foundation

- TypeScript monorepo — a React/Vite browser client (`@vtt/web`) and an authoritative Express + Socket.IO server (`@vtt/server`) — plus workspace packages (`domain`, `rules-5e`, `schemas`, `api-contract`, `ui`, `content-srd-5.2.1`, `test-fixtures`).
- LAN-safe by design: no accounts or cloud. First-run GM password bootstrap is loopback-only; only a bcrypt hash and a token secret are persisted (`data/auth.json`, separate from game state).
- Server-owned `GameState` with separated GM/player projections, a character-claim model, real-time events with idempotency receipts, and revision-conflict handling. Embedded SQLite (WAL, versioned migrations, periodic snapshots).
- Authenticated map library with guided printed-grid (3×3 drag) / gridless setup and regional/world scales; scene-centric prep (a **Scenes** hub of prepared encounters).
- Server-authoritative encounters: initiative, turns/rounds, token placement/movement with server snapping, annotations, pings, and manual fog of war; a combat rules engine (typed damage with resistances, conditions, saves and death saves, reactions, legendary/recharge abilities, rests) with strict / assisted / freeform modes.
- Interactive **character sheets** (Phase 1): identity, proficiencies, spells and slots, inventory and currency, and player-driven combat rolls on a player's own turn.
- Paired **table viewer** (second screen): pairing codes, "Present <map>", a player-safe projection over SSE. The viewer bundle never receives full `GameState`.
- **Worldbuilding Codex** (below), persisted in a dedicated store off the `GameState` broadcast.
- A tokenized retrowave design system — the app and design language are named **OzyVTT** — with a dev-only `/styleguide` reference.

## The worldbuilding Codex

The Codex is a World-Anvil / Kanka / LegendKeeper-class worldbuilding tool bounded to a single home group. It lives on a GM **Codex** tab (**World · Pages · Atlas · Journal · Graph**) and a read-only **player Codex** (World · Lore · Atlas · Journal · Graph). Everything is **two-layer** — a player-facing layer and a GM-secret layer that never reaches players — and secret by default.

- **Typed-entity wiki.** Freeform two-layer markdown pages organized in a notebook of folders, with `[[wiki-links]]`, backlinks, tags, full-text search, revisions, and autosave. A page can carry an **entity type** (character, location, faction, item, species, religion, event, or plain note) with structured fields and **typed relationships** to other entities ("rules" ↔ "ruled by").
- **Interactive atlas.** A nested world → region → local map tree of uploaded map images with polymorphic **markers** (link a page, a sub-map, a prepared scene, or an actor) placed in image space on a pan/zoom/pinch surface. A marker linked to a scene can go live at the table straight from the pin.
- **Journal + fantasy calendar.** A campaign timeline of two-layer entries dated on a GM-defined calendar (custom months, weekday names, eras), grouped by in-world year. A fought encounter automatically posts a pinned "battle fought here" entry to its location.
- **Relationship graph.** The world drawn as a web of type-colored, iconed entity nodes and directed, labeled relationship edges — pan, zoom, and click a node to open it.
- **Command palette** (⌘/Ctrl-K), markdown import, and JSON export.

Viewer safety is a hard invariant here: GM-secret bodies and fields, unrevealed pages/markers, and scene/actor links are stripped from every player-facing read (see `docs/ai-context/viewer-mode.md`).

## Run locally

Prerequisite: Node.js 24 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

For development, open `http://localhost:5173`. Vite also prints a `Network` address such as `http://192.168.1.50:5173`; that is the address other devices use while `npm run dev` is running. Port 3001 is the development API and redirects browser requests to the correct port when the production client has not been built.

To run the single LAN service as a player would use it, build and launch it with `npm run start`, then open `http://localhost:3001` on the host. Players on the same LAN join through the printed `http://HOST-IP:3001` address. If Windows asks about firewall access, allow Node.js on **Private networks** only.

`data/` is intentionally local and ignored by Git; back it up separately once it contains real campaign data.

| Command | What it does |
| --- | --- |
| `npm install` | Install workspace deps. |
| `npm run dev` | Client on `:5173` + authoritative server (dev API `:3001`). |
| `npm run check` | Per-workspace typecheck (`tsc --noEmit`). |
| `npm run test` | Per-workspace tests. |
| `npm run build` | Build all workspaces. |
| `npm run start` | Build, then run the single LAN service on `:3001`. |

## Try the table

1. Enter GM mode. Open the **Scenes** hub (the prep home) and add a scene; upload its battlemap and calibrate the grid under **Manage maps**.
2. Choose **Printed square grid** or **Gridless battlemap**. For a printed grid, press on one grid intersection, drag diagonally across exactly a 3×3 block of squares, and release on the opposite intersection. The overlay appears immediately; preview/adjust it, click a distant intersection, verify, and save.
3. Under **Table viewer**, open or copy the second-screen address. On a separate browser/display, pair it using a code created by the GM.
4. Keep the intended map selected and click **Present _map name_**. This single action starts presentation and sends the selected map/camera immediately.
5. Under **Encounter and Initiative**, choose combatants, optionally enter Initiative scores (leave blanks for server rolls), and start the encounter. Their tokens appear automatically in the tray above the map.
6. Drag tokens from the tray onto the map and drag them again to move them. Printed-grid maps snap to cell centers on the server; gridless maps place freely within the image. A player can move only their claimed character; the GM can move any token. Arrow keys move a focused placed token, and Delete returns it to the tray.
7. Advance turns from the GM controls. The active-turn ring, player map, and paired viewer update automatically. GM-only combatants and their token identity/position are absent from public surfaces, which show only the generic **GM turn** cue.

Players open their **character sheet** to run their own ability/save/skill checks and attacks on their turn; damage stays server-authoritative under a GM-controlled per-table policy.

## Try the Codex

1. As the GM, open the **Codex** tab and go to **Pages**. Create a page, pick an entity type, fill its structured fields, and write a two-layer body — a player-facing section and a GM-only section (violet, "GM only"). Link other entities with `[[wiki-links]]` and typed relationships.
2. Open **Atlas**, upload a world map, and drop a marker. Link the marker to the page you just wrote, nest a region sub-map beneath it, or point it at a prepared scene and **▶ Go live here** to jump to the table.
3. Open **Journal** and set your campaign's calendar, then post a dated entry. The timeline groups by in-world year.
4. Reveal the surfaces players should see. Players tap **Open Codex** to browse the read-only **World · Lore · Atlas · Journal · Graph** — GM-secret bodies, fields, and unrevealed markers never reach them.

## Integrations (public HTTP API v1)

Everything the table can do in combat is also reachable over a versioned REST API at `/api/v1`, so you can build bots, overlays, loggers, and importers without touching the internals. **Full reference: [docs/api-reference.md](docs/api-reference.md)** (generated from the contract; the running server also serves the machine-readable spec at `/api/v1/openapi.json`). Quick start against a running server:

1. **Mint a credential** (GM session token from `POST /api/gm/login`):
   `curl -X POST http://<host>:3001/api/v1/gm/integration-credentials -H "Authorization: Bearer $GM" -H "content-type: application/json" -d '{"name":"my bot","scopes":["system:read","game:read","combat:read","combat:write","actor:write","roll:create"]}'`
   The `vtt_int_…` token is shown exactly once. Credentials are scoped, rotatable, revocable, and audited.
2. **Discover the surface**: `GET /api/v1/openapi.json` (the complete OpenAPI 3.1 contract, served from the running instance), `GET /api/v1/system/capabilities`, and `GET /api/v1/game/commands` (every command type + required scope).
3. **Read the game**: `GET /api/v1/game` returns the full GM projection for GM/integration tokens (add `?view=player` for the player-safe projection overlays should use); poll cheaply with the returned `ETag`/`If-None-Match`. `GET /api/v1/game/log` is the combat log.
4. **Act**: typed routes (`POST /api/v1/game/encounter/start`, `/game/actors/{id}/damage`, `/game/rolls`, `/game/initiative/next`, …) or the generic tunnel `POST /api/v1/game/commands` with `{"type":"actor.apply-damage","payload":{…}}`. Every write goes through the exact same validation/authorization/execution path as the table's own UI, is idempotent by `commandId` (send your own to retry safely), and honors `expectedRevision` (409 with `currentRevision` when stale).
5. **Mine finished fights**: `GET /api/v1/encounters` lists permanent archives; `GET /api/v1/encounters/{id}` returns the full Time Machine document — per-turn full game states, the combat log, a complete per-command journal (who did what, with payloads), the final state, every dice roll, and the stat blocks used.

The Codex has its own REST surface (`/api/v1/codex/*`, documented in the same OpenAPI contract), but it is *session*-authorized — a GM or player session, not an integration credential — because it is a first-party UI surface, not an external integration target. Webhooks/streaming push are deliberately not part of v1 core yet; polling with ETags is the supported pattern today.

## Scope boundaries

The two pillars — a combat-first table and a bounded worldbuilding platform — are the product; everything else stays out so neither one sprawls into a general-purpose VTT. This repository is intentionally **not** yet a guided character *builder* (an interactive play sheet ships now; the guided builder with content/derivation/level-up is a planned roadmap update — see [ADR-0021](docs/adr/0021-player-character-sheet.md)), a voice/video service, a public or multi-tenant SaaS, a macro/scripting language, or a 3D tabletop.

When a request pushes on a boundary, name the boundary and offer the in-scope version of what's actually needed.

## Roadmap and docs

The complete roadmap is [BUILD_PLAN.md](BUILD_PLAN.md). See [docs/ai-context/](docs/ai-context/) for how the app is built (architecture, viewer mode, realtime, auth/roles, mobile UX, design language), [docs/adr/](docs/adr/) for the durable architecture decisions, and [docs/ai-ledger/](docs/ai-ledger/) for the living record of what exists now and what's decided.
