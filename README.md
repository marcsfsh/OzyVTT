# VTT

A private, LAN-hosted, combat-first D&D 5e virtual tabletop for one trusted GM and a small home group. Players join directly from a phone or laptop, claim a character, and use the same responsive combat experience.

## Current foundation

- TypeScript workspace with a React browser client and authoritative Express + Socket.IO server.
- LAN-safe-by-design starting point: no accounts, invitations, or cloud service.
- First-run GM password bootstrap is restricted to the host machine; only a salted password hash is persisted.
- Server-owned session and character-claim model, separated GM/player views, and real-time state events.
- Versioned JSON schemas for imported actors and persisted game state.

## Run locally

Prerequisite: Node.js 24 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

For development, open `http://localhost:5173`. To run the single LAN service as a player would use it, build and launch it with `npm run start`, then open `http://localhost:3001` on the host. Players on the same LAN join through `http://HOST-IP:3001`.

`data/` is intentionally local and ignored by Git; back it up separately once it contains real campaign data.

## Scope boundaries

This repository is intentionally not a character builder, campaign wiki, voice/video service, public SaaS, multi-tenant product, macro language, or 3D tabletop. Those boundaries prevent the core combat loop from becoming a general-purpose VTT project.

The complete roadmap is [BUILD_PLAN.md](BUILD_PLAN.md). This repository is currently in Phase 0 technical proof / Phase 1 foundation work; no Phase 1 exit gate has been claimed yet. See [ARCHITECTURE.md](ARCHITECTURE.md), [docs/adr/](docs/adr/), and [docs/product/](docs/product/) for the decisions and proof artifacts that will guide implementation.
