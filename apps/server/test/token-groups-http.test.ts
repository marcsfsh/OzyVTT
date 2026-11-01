import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// The GM's token groups (ADR-0063) over the integration HTTP adapter, with real authorization, persistence and
// projection: make, rename, file, delete (its creatures return), GM-only, the limits, and no player or table screen
// projection ever carrying them.

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";

/** A real, schema-valid character sheet so the sheet-editing door under test has something to edit. */
const HERO_DEFINITION = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));

function initialState() {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO_ID,
        name: "Public Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: `import-${HERO_ID}`
      },
      {
        id: SECOND_ID,
        name: "Second Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 18, maximum: 18 },
        definitionId: `import-${SECOND_ID}`
      }
    ],
    definitions: [{ id: `import-${HERO_ID}`, definition: HERO_DEFINITION }]
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-token-groups-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: initialState()
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  const imported = await server.mapAssets.import(png(900, 600), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Arena", "battlemap");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { base, server, gmToken, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
const snapshot = async (base: string, token: string, view?: "player") =>
  (await (await fetch(base + GAME_PATHS.snapshot + (view ? "?view=player" : ""), { headers: bearer(token) })).json())
    .data.game;

describe("token groups", () => {
  it("makes, renames, files and deletes a group, and its creatures return when it goes", async () => {
    const { base, gmToken } = await boot();
    expect(
      (await post(base, GAME_PATHS.tokenGroupCreate, gmToken, { commandId: randomUUID(), name: "Goblins" })).status
    ).toBe(200);
    let game = await snapshot(base, gmToken);
    const group = game.tokenGroups.groups[0];
    expect(group.name).toBe("Goblins");
    expect(
      (
        await post(base, GAME_PATHS.tokenGroupRename, gmToken, {
          commandId: randomUUID(),
          groupId: group.id,
          name: "Cave goblins"
        })
      ).status
    ).toBe(200);
    expect(
      (
        await post(base, GAME_PATHS.actorTokenGroup.replace("{actorId}", HERO_ID), gmToken, {
          commandId: randomUUID(),
          actorId: HERO_ID,
          groupId: group.id
        })
      ).status
    ).toBe(200);
    game = await snapshot(base, gmToken);
    expect(game.tokenGroups.groups[0].name).toBe("Cave goblins");
    expect(game.tokenGroups.members[HERO_ID]).toBe(group.id);
    expect(
      (await post(base, GAME_PATHS.tokenGroupDelete, gmToken, { commandId: randomUUID(), groupId: group.id })).status
    ).toBe(200);
    game = await snapshot(base, gmToken);
    expect(game.tokenGroups).toEqual({ groups: [], members: {} });
  });

  it("is the GM's alone: a player is refused, and neither a player's view nor the table screen's carries it", async () => {
    const { base, gmToken, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    expect(
      (await post(base, GAME_PATHS.tokenGroupCreate, playerToken, { commandId: randomUUID(), name: "Mine" })).status
    ).toBe(403);
    await post(base, GAME_PATHS.tokenGroupCreate, gmToken, { commandId: randomUUID(), name: "Goblins" });
    expect((await snapshot(base, gmToken)).tokenGroups.groups).toHaveLength(1);
    expect((await snapshot(base, playerToken, "player")).tokenGroups).toBeUndefined();
    expect(JSON.stringify(await snapshot(base, playerToken, "player"))).not.toContain("Goblins");
  });

  it("refuses a name past 40 letters and a group that is gone", async () => {
    const { base, gmToken } = await boot();
    expect(
      (await post(base, GAME_PATHS.tokenGroupCreate, gmToken, { commandId: randomUUID(), name: "x".repeat(41) })).status
    ).toBe(400);
    expect(
      (await post(base, GAME_PATHS.tokenGroupDelete, gmToken, { commandId: randomUUID(), groupId: randomUUID() }))
        .status
    ).not.toBe(200);
  });

  it("loads a saved game without the field as no groups", () => {
    const old = GameStateSchema.parse({ schemaVersion: 1, actors: [] });
    expect(old.tokenGroups).toEqual({ groups: [], members: {} });
  });
});
