# OzyVTT

A private, LAN-hosted D&D 5e virtual tabletop and worldbuilding tool for one GM and a small home
group. Players join from a phone or laptop on the same network and claim a character. There are
no accounts and no cloud service.

It has two parts:

- **The table.** Upload a battlemap, calibrate its grid, stage scenes, and run initiative with
  server-enforced 5e rules: attacks, typed damage, saves, conditions, reactions, spell slots,
  rests and death saves. The [SRD coverage manifest](docs/srd-coverage.md) says, for every SRD
  5.2.1 record, what the server applies and what it leaves to the table. Players use a tabbed
  character sheet, with a turn card on a phone, and roll on their own turn. Fog and dynamic
  vision (walls, doors, lights, Darkvision) are worked out on the server, so each player's
  device receives only what their character can see. A second screen (a TV or tablet) shows a
  player-safe view of the map and turn order, and plays the music, ambience and sound effects
  the GM uploads and runs from a sound board.
- **The Codex.** A wiki of typed pages (characters, locations, factions, items and more), an
  atlas of nested maps, a chronicle on a custom calendar, sessions with prep templates, quests,
  downtime and relationships. A page or quest holds the text players read and hidden blocks the
  GM can show to everyone or to one character later, and players only ever receive what the GM
  has revealed to them.

Characters can be built in a guided builder, imported from a D&D Beyond PDF, or authored as
homebrew. SRD 5.2.1 monsters, spells, equipment and magic items are included. The Compendium lists
the SRD and the table's homebrew together, one table per kind. The GM makes homebrew of every kind,
from a class to a monster, in steps beside a preview drawn as the table shows it, and shares each
record with everyone or with chosen characters. Players read what they have been shown in the Codex.

## Running it

Node.js 24 or newer.

```bash
npm install
npm run dev
```

The server reads `PORT`, `DATA_DIR` and `JOIN_URL` from the environment or from a `.env` file in
the repo root; `.env.example` lists them.

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

To host it in Docker instead, see [Hosting with Docker](#hosting-with-docker).

## The GM password

Set it the first time you open the app, on the computer that runs OzyVTT (it is refused from any
other device). After that, sign in from any device on the network. A reload or a second tab stays
signed in; tick "Keep me signed in on this computer" to stay signed in after the browser closes,
until the 12-hour sign-in runs out. Change the password under Settings; that signs out every other
GM browser.

If you forget it, reset it on the computer that runs OzyVTT:

1. Stop OzyVTT.
2. Delete `apps/server/data/auth.json` (or `auth.json` in your `DATA_DIR`).
3. Start OzyVTT again, open it on that computer, and set a new password.

The campaign stays as it was. Every sign-in ends, so players join again and claim their
characters.

`apps/server/data/` holds the GM password hash and all campaign data. Set `DATA_DIR` to keep it
elsewhere; a relative path is read from `apps/server`. It is git-ignored, so back it up separately. A
data directory from a build before the October 2026 cleanup is refused at startup; move it aside to
start fresh.

## Hosting with Docker

The image `ghcr.io/marcsfsh/ozyvtt` holds the server and the built client, so the computer that
hosts needs Docker alone (Docker Desktop on Windows or macOS). `latest` follows `main`; a release
tag such as `v1.2.0` also publishes `1.2.0`.

1. Start it. From a checkout, `docker compose up -d` uses `docker-compose.yml`. Without one:

   ```bash
   docker run -d --name ozyvtt --restart unless-stopped -p 3001:3001 \
     -v ozyvtt-data:/data -e JOIN_URL=http://192.168.1.50:3001 ghcr.io/marcsfsh/ozyvtt:latest
   ```

2. Set the GM password on the computer that runs Docker. A browser there reaches the container
   through Docker's network, which the first-password page refuses, so set it from inside:

   ```bash
   docker exec -it ozyvtt npm run gm-password
   ```

3. Open `http://localhost:3001` and sign in as the GM.

**The data volume.** Everything the campaign holds is in `/data` in the container: the database,
the GM password hash, and every uploaded map, token, Codex image and sound. It lives in the
`ozyvtt-data` volume, which outlasts the container, a restart and an update. To bring a campaign
from `npm run start`, stop OzyVTT and copy its data folder into the volume before the first start:

```bash
docker run --rm -v ozyvtt-data:/data -v "$PWD/apps/server/data:/from" busybox \
  sh -c "cp -a /from/. /data/ && chown -R 1000:1000 /data"
```

Back it up the same way in reverse:
`docker run --rm -v ozyvtt-data:/data -v "$PWD:/backup" busybox tar czf /backup/ozyvtt-data.tgz -C /data .`

**The port.** The server listens on 3001 in the container. To serve another port, change the left
side of the mapping (`-p 8080:3001`, or `"8080:3001"` in `docker-compose.yml`) and use it in
`JOIN_URL`.

**The join address.** In a container the server only sees Docker's network, so it can't find the
address players should open. Set `JOIN_URL` to this computer's address on the home network and the
port (`ipconfig` on Windows shows the address); in a checkout, put `JOIN_URL=...` in the `.env` file
beside `docker-compose.yml`. Separate several addresses with commas. The Table, the Roster and
Settings then show it with its QR code. On Linux, host networking is simpler: use `--network host`
(or `network_mode: host` in the Compose file) with no port mapping and no `JOIN_URL`. The server
then lists the computer's own addresses, and a browser on that computer can set the GM password at
`http://localhost:3001`.

**Updating.** `docker compose pull` and then `docker compose up -d`. Without Compose, pull the
image, remove the container with `docker rm -f ozyvtt` and run it again. The volume keeps the
campaign either way.

**Resetting the GM password.** `docker exec ozyvtt rm /data/auth.json`, then
`docker restart ozyvtt` and `docker exec -it ozyvtt npm run gm-password`.

While the repository is private, so is the image: sign in with `docker login ghcr.io` and a GitHub
token that has `read:packages`, or make the package public in its settings on GitHub. If players
can't connect on Windows, allow Docker Desktop through the firewall on private networks.

## Commands

| Command               | What it does                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`         | Client on `:5173` and the server on `:3001`, both reloading on change.                                                                                    |
| `npm run check`       | Typecheck every workspace and the smoke suite.                                                                                                            |
| `npm test`            | Run every workspace's tests.                                                                                                                              |
| `npm run build`       | Build the client.                                                                                                                                         |
| `npm run smoke`       | Run the browser smoke tests against the built client (`npm run build` first).                                                                             |
| `npm run start`       | Build, then serve on `:3001`.                                                                                                                             |
| `npm run gm-password` | Set the first GM password from the computer that runs OzyVTT, while it is running.                                                                        |
| `npm run map`         | Regenerate `docs/app-map.md`, `docs/srd-coverage.md` and the actor JSON Schema after changing state, commands, HTTP paths, the actor schema or the rules. |
| `npm run content`     | Rebuild the SRD content bundles from their sources, in dependency order.                                                                                  |
| `npm run lint`        | Run ESLint.                                                                                                                                               |
| `npm run format`      | Format with Prettier.                                                                                                                                     |

The smoke suite (`e2e/`) starts its own servers on ports 3201 and 3202 (set `SMOKE_PORT` to move
them), each against a fresh temporary data directory, and runs the first-evening journeys at a
390x844 touch phone and a 1280x800 laptop: the first evening (GM setup, the join address, a player
claiming a character, pairing the table screen, uploading a map, setting its grid and making the
scene live), a player claiming a character, a fight on a new scene, presenting a map on the table
screen, and playing music on it. It needs Chromium once: `npx playwright install chromium`.

## Running a fight

1. As GM, open **Scenes** and press **New scene**. Pick its battle map or upload one, then work
   through the steps: tokens and monsters, walls and light, sound, and **Make live**. The
   Scenes front page lists what still needs you, and **See as** shows a scene the way the table
   screen or one player would get it.
2. A map with no grid says so: press **Set the grid** (or open the map under **Maps**). For a
   printed grid, drag diagonally across a 3x3 block of squares to set the scale. For a gridless
   map, mark two points and enter the distance between them.
3. Under **Shared screen**, open the address it shows on the TV. The TV shows a six-digit code:
   type it under **Pair a table screen**. Select the map and click **Present**.
4. Pick combatants and start the encounter. Blank initiative scores are rolled on the server.
5. Drag tokens onto the map. Players move only their own character; the GM moves anything.
   GM-only combatants never appear on player screens or the table viewer.
6. For sound, open **Shared screen**, then **Sound**: upload files you have the right to play,
   put them in the playlist, the ambience or the effects, and press play. Sound comes from the
   table screen only; tap it once if it asks. A scene can start its own sound when it goes live.

## Using the Codex

1. Open the **Codex** tab and make a page with **New**. Write what players may read, and add a
   **Hidden block** for anything only you should see; each field has its own Who sees it switch.
   Link pages with `[[links]]` and add relationships beside the text.
2. Upload maps to the **Atlas** and place pins that link pages, sub-maps or scenes.
3. Set the calendar in **Story** and add dated entries to the chronicle.
4. Make a session from a prep template, fill in its prep, and run it from the table's
   **Tonight** tab: tick clues, log what happens, and write the recap after play.
5. Reveal a block to everyone or to chosen characters when the table reaches it. **See as
   players** shows the page exactly as everyone, or one character's player, receives it.

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
- [docs/srd-coverage.md](docs/srd-coverage.md): a generated manifest of what the app does with each
  SRD record.
- [docs/adr/](docs/adr/): architecture decision records.

Bugs and the roadmap are tracked in GitHub issues.

## Not in scope

Voice or video, public or multi-tenant hosting, a scripting language, and 3D maps.

## Content license

SRD 5.2.1 content is used under CC BY 4.0; see
`packages/content-srd-5.2.1/bundles/attribution.json`.
