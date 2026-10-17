# OzyVTT

A private, LAN-hosted D&D 5e virtual tabletop and worldbuilding tool for one GM and a small home
group. Players join from a phone or laptop on the same network and claim a character. There are
no accounts and no cloud service.

It has two parts:

- **The table.** Upload a battlemap, calibrate its grid, stage scenes, and run initiative with
  server-enforced 5e rules: attacks, typed damage, saves, conditions, reactions, spell slots,
  rests and death saves. Players use an interactive character sheet and roll on their own turn.
  Fog and dynamic vision (walls, doors, lights, Darkvision) are worked out on the server, so each
  player's device receives only what their character can see. A second screen (a TV or tablet)
  shows a player-safe view of the map and turn order, and plays the music, ambience and sound
  effects the GM uploads and runs from a sound board.
- **The Codex.** A wiki of typed pages (characters, locations, factions, items and more), an
  atlas of nested maps, a journal on a custom calendar, sessions, quests, downtime and a
  relationship graph. Every record has a player half and a GM-only half, and players only ever
  receive what the GM has revealed.

Characters can be built in a guided builder, imported from a D&D Beyond PDF, or authored as
homebrew. SRD 5.2.1 monsters, spells, equipment and magic items are included.

## Running it

Node.js 24 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. Vite also prints a network address such as
`http://192.168.1.50:5173` for other devices on the LAN.

To run the single service players use:

```bash
npm run start
```

This builds the client and serves everything on port 3001. Players join at
`http://HOST-IP:3001`: once you are signed in as the GM, the Table, the Roster and Settings show
that address with a Copy button and a QR code, drawn on your own device. On Windows, allow Node.js
on private networks only. Never expose the port to the internet; use a VPN for remote players.

## The GM password

Set it the first time you open the app, on the computer that runs OzyVTT (it is refused from any
other device). After that, sign in from any device on the network. A reload or a second tab stays
signed in; tick "Keep me signed in on this computer" to stay signed in after the browser closes,
until the 12-hour sign-in runs out. Change the password under Settings; that signs out every other
GM browser.

If you forget it, reset it on the computer that runs OzyVTT:

1. Stop OzyVTT.
2. Delete `data/auth.json` (or `auth.json` in your `DATA_DIR`).
3. Start OzyVTT again, open it on that computer, and set a new password.

The campaign stays as it was. Every sign-in ends, so players join again and claim their
characters.

`data/` holds the GM password hash and all campaign data. It is git-ignored, so back it up
separately. A `data/` directory from a build before the October 2026 cleanup is refused at startup;
move it aside to start fresh.

## Commands

| Command           | What it does                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`     | Client on `:5173` and the server on `:3001`, both reloading on change.                                                 |
| `npm run check`   | Typecheck every workspace and the smoke suite.                                                                         |
| `npm test`        | Run every workspace's tests.                                                                                           |
| `npm run build`   | Build the client.                                                                                                      |
| `npm run smoke`   | Run the browser smoke tests against the built client (`npm run build` first).                                          |
| `npm run start`   | Build, then serve on `:3001`.                                                                                          |
| `npm run map`     | Regenerate `docs/app-map.md` and the actor JSON Schema after changing state, commands, HTTP paths or the actor schema. |
| `npm run content` | Rebuild the SRD content bundles from their sources, in dependency order.                                               |
| `npm run lint`    | Run ESLint.                                                                                                            |
| `npm run format`  | Format with Prettier.                                                                                                  |

The smoke suite (`e2e/`) starts its own servers on ports 3201 and 3202 (set `SMOKE_PORT` to move
them), each against a fresh temporary data directory, and runs the first-evening journeys at a
390x844 touch phone and a 1280x800 laptop: the first evening (GM setup, the join address, a player
claiming a character, pairing the table screen, uploading a map, setting its grid and making the
scene live), a player claiming a character, a fight on a new scene, presenting a map on the table
screen, and playing music on it. It needs Chromium once: `npx playwright install chromium`.

## Running a fight

1. As GM, open **Scenes**, add a scene, and upload its battlemap.
2. Press **Set the grid** (or open **Manage maps**). For a printed grid, drag diagonally across a
   3x3 block of squares to set the scale. For a gridless map, mark two points and enter the
   distance between them.
3. Under **Shared screen**, open the address it shows on the TV. The TV shows a six-digit code:
   type it under **Pair a table screen**. Select the map and click **Present**.
4. Pick combatants and start the encounter. Blank initiative scores are rolled on the server.
5. Drag tokens onto the map. Players move only their own character; the GM moves anything.
   GM-only combatants never appear on player screens or the table viewer.
6. For sound, open **Shared screen**, then **Sound**: upload files you have the right to play,
   put them in the playlist, the ambience or the effects, and press play. Sound comes from the
   table screen only; tap it once if it asks. A scene can start its own sound when it goes live.

## Using the Codex

1. Open the **Codex** tab, create a page, pick its type and fill in both halves. Link pages
   with `[[wiki-links]]` and typed relationships.
2. Upload maps to the **Atlas** and place markers that link pages, sub-maps or scenes.
3. Set the campaign calendar and post dated journal entries.
4. Reveal what players should see. The GM can preview exactly what a player sees.

## HTTP API

Everything the UI does is also available under `/api/v1`, with the same validation,
authorization and player-safe projections. A running server serves the OpenAPI document at
`/api/v1/openapi.json`, and the app shows a browsable reference under Settings. A GM mints
scoped integration credentials in Settings. Conventions are in
[ADR-0016](docs/adr/0016-public-integration-api.md).

## Layout

A TypeScript monorepo: `apps/client` (React and Vite), `apps/server` (Express and Socket.IO,
the authority for all game state, stored in SQLite) and shared packages under `packages/`.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit and the security rules.
- [docs/DESIGN.md](docs/DESIGN.md): the visual and interaction rules for UI work.
- [docs/app-map.md](docs/app-map.md): a generated index of state, commands and HTTP paths.
- [docs/adr/](docs/adr/): architecture decision records.

Bugs and the roadmap are tracked in GitHub issues.

## Not in scope

Voice or video, public or multi-tenant hosting, a scripting language, and 3D maps.

## Content license

SRD 5.2.1 content is used under CC BY 4.0; see
`packages/content-srd-5.2.1/bundles/attribution.json`.
