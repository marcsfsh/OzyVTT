# VTT

A private, LAN-hosted, combat-first D&D 5e virtual tabletop for one trusted GM and a small home group. Players join directly from a phone or laptop, claim a character, and use the same responsive combat experience.

## Current foundation

- TypeScript workspace with a React browser client and authoritative Express + Socket.IO server.
- LAN-safe-by-design starting point: no accounts, invitations, or cloud service.
- First-run GM password bootstrap is restricted to the host machine; only a salted password hash is persisted.
- Server-owned session and character-claim model, separated GM/player views, and real-time state events.
- Versioned JSON schemas for imported actors and persisted game state.
- Authenticated map library with guided printed-grid/gridless setup and regional/world scales.
- Persisted server-authoritative encounters with Initiative, turns/rounds, active GM/player battlemap, and a paired player-safe table viewer.

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

## Test the current encounter and second-screen milestone

1. Enter GM mode and upload a battlemap under **Maps and grid setup**.
2. Choose **Printed square grid** or **Gridless battlemap**. For a printed grid, press on one grid intersection, drag diagonally across exactly a 3×3 block of squares, and release on the opposite intersection. The overlay appears immediately; preview/adjust it, click a distant V intersection, verify, and save.
3. Under **Table viewer**, open or copy the second-screen address. On a separate browser/display, pair it using a code created by the GM.
4. Keep the intended map selected and click **Present _map name_**. This single action now starts presentation and sends the selected map/camera immediately.
5. Under **Encounter and Initiative**, choose combatants, optionally enter Initiative scores (leave blanks for server rolls), and start the encounter. Their tokens appear automatically in the tray above the map—there is no separate token setup form.
6. Drag tokens from the tray onto the map and drag them again to move them. Printed-grid maps snap to cell centers on the server; gridless maps place freely within the image. Drag a token back to the tray to remove it from the map. A player can move only their claimed character; the GM can move any token. Arrow keys move a focused placed token, and Delete returns it to the tray.
7. Advance turns from the GM controls. The active-turn ring, player map, and paired viewer update automatically. GM-only combatants and their token identity/position are absent from public surfaces, which show only the generic **GM turn** cue.

The current combat canvas supports authoritative token placement/movement and viewer synchronization. Manual fog, targeting, HP/actions, and physical phone/TV acceptance are the next scene/combat milestones.

## Scope boundaries

This repository is intentionally not a character builder, campaign wiki, voice/video service, public SaaS, multi-tenant product, macro language, or 3D tabletop. Those boundaries prevent the core combat loop from becoming a general-purpose VTT project.

The complete roadmap is [BUILD_PLAN.md](BUILD_PLAN.md). Phase 0/1 validation continues while the Phase 2 testing-MVP vertical slice is under active implementation; no phase exit gate has been claimed yet. See [ARCHITECTURE.md](ARCHITECTURE.md), [docs/adr/](docs/adr/), and [docs/product/](docs/product/) for the decisions and proof artifacts that guide implementation.
