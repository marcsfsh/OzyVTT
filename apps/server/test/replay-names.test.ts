import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENCOUNTER_ARCHIVE_PATHS,
  EncounterArchiveListResponseSchema,
  EncounterArchiveNameResponseSchema,
  GAME_PATHS
} from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";

// A replay is called by its scene and date until the GM names it. The scene's name stays the GM's: a player's view of
// the table never names scenes, so a shared replay reaches them by the GM's name, or by its date alone.

const HERO = "10000000-0000-4000-8000-0000000000f1";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function foughtOnce() {
  const booted = await bootServer(
    GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: HERO, name: "Lyra", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }
      ]
    })
  );
  cleanups.push(booted.close);
  const { post, gmToken, server } = booted;
  const imported = await server.mapAssets.import(png(900, 600), "cave.png");
  server.mapCatalog.register(imported.metadata.id, "Cave map", "battlemap");
  const scene = await post(GAME_PATHS.commands, gmToken, {
    type: "scene.create",
    payload: { name: "Goblin cave", mapAssetId: imported.metadata.id, combatantIds: [HERO], activate: true }
  });
  expect(scene.status).toBe(200);
  await post(GAME_PATHS.encounterStart, gmToken, {
    commandId: randomUUID(),
    mapAssetId: imported.metadata.id,
    entries: [{ actorId: HERO, score: 12 }]
  });
  await post(GAME_PATHS.initiativeNext, gmToken, { commandId: randomUUID() });
  await post(GAME_PATHS.encounterEnd, gmToken, { commandId: randomUUID() });
  return booted;
}

const list = async (base: string, token: string) =>
  EncounterArchiveListResponseSchema.parse(
    await (
      await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: { authorization: `Bearer ${token}` } })
    ).json()
  ).data.encounters;

describe("a replay's name", () => {
  it("starts as its scene's, and the GM may name it and take the name back", async () => {
    const { base, gmToken, post } = await foughtOnce();
    const [archive] = await list(base, gmToken);
    expect(archive).toMatchObject({ name: null, sceneName: "Goblin cave" });

    const path = ENCOUNTER_ARCHIVE_PATHS.name.replace("{id}", String(archive.id));
    const renamed = await post(path, gmToken, { name: "  Ambush at the bridge  " });
    expect(renamed.status).toBe(200);
    expect(EncounterArchiveNameResponseSchema.parse(await renamed.json()).data).toEqual({
      id: archive.id,
      name: "Ambush at the bridge"
    });
    expect((await list(base, gmToken))[0]).toMatchObject({ name: "Ambush at the bridge", sceneName: "Goblin cave" });

    expect((await post(path, gmToken, { name: "x".repeat(81) })).status).toBe(400);
    expect((await post(ENCOUNTER_ARCHIVE_PATHS.name.replace("{id}", "999"), gmToken, { name: "Gone" })).status).toBe(
      404
    );
    expect((await post(path, gmToken, { name: "" })).status).toBe(200);
    expect((await list(base, gmToken))[0].name).toBeNull();
  });

  it("reaches a player on a shared replay without the scene's name, and only the GM may set it", async () => {
    const { base, gmToken, post, server } = await foughtOnce();
    const player = server.auth.issuePlayerSession();
    const [archive] = await list(base, gmToken);
    const path = ENCOUNTER_ARCHIVE_PATHS.name.replace("{id}", String(archive.id));
    expect((await post(path, player, { name: "Mine now" })).status).toBe(403);
    await post(path, gmToken, { name: "The cave fight" });
    await post(ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", String(archive.id)), gmToken, {
      playerVisible: true
    });

    const [shared] = await list(base, player);
    expect(shared.name).toBe("The cave fight");
    expect("sceneName" in shared).toBe(false);
    const raw = await (
      await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: { authorization: `Bearer ${player}` } })
    ).text();
    expect(raw).not.toContain("Goblin cave");
  });
});
