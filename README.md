# OzyVTT

A private, LAN-hosted D&D 5e virtual tabletop and worldbuilding tool for one GM and a small home group. Players join from a phone or laptop on the same network. No accounts, no cloud.

Two parts:

- **Combat** — battlemaps, grid setup, initiative and turns, token movement, character sheets, and a second screen for the table.
- **Codex** — a wiki of typed pages, an atlas of nested maps, a journal with a custom calendar, and a relationship graph. Pages have a player-facing layer and a GM-only layer.

## Requirements

Node.js 24 or newer.

## Run

```bash
npm install
cp .env.example .env
npm run dev        # client on :5173, dev API on :3001
```

To run the single service players use:

```bash
npm run start      # builds, then serves on :3001
```

Players join at `http://HOST-IP:3001`. `data/` holds the password hash and campaign data; it is git-ignored.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Client plus server in development. |
| `npm run check` | Typecheck each workspace. |
| `npm run test` | Run tests. |
| `npm run build` | Build all workspaces. |
| `npm run start` | Build, then serve on `:3001`. |

## More

- HTTP API — [docs/api-reference.md](docs/api-reference.md)
- Architecture — [docs/ai-context/](docs/ai-context/)
- Decisions — [docs/adr/](docs/adr/)
- Roadmap — [BUILD_PLAN.md](BUILD_PLAN.md)

Not a character builder, voice/video, a public or multi-tenant service, a scripting language, or a 3D tabletop.
