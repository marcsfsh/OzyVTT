import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// Effects and hit points over the command pipeline: a GM-added Concentration effect's caster, and knocking out.

const HERO = "10000000-0000-4000-8000-000000000001";
const GOBLIN = "10000000-0000-4000-8000-000000000002";
const ALLY = "10000000-0000-4000-8000-000000000003";

/** The hero's sheet: a bow and a club, for the knock-out rule. */
const ARCHER = {
  schemaId: "vtt.actor-character",
  schemaVersion: 1,
  source: { name: "Test", version: "1" },
  name: "Hero",
  size: "medium",
  abilityScores: { str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  armorClass: 13,
  hitPoints: { maximum: 30 },
  speedFeet: 30,
  token: { disposition: "friendly" },
  actions: [
    {
      id: "longbow",
      name: "Longbow",
      activation: "action",
      description: "A ranged weapon attack.",
      attack: { bonus: 4, rangeFeet: 600, rangeNormalFeet: 150 },
      damage: [{ formula: "1d8", type: "piercing" }]
    },
    {
      id: "club",
      name: "Club",
      activation: "action",
      description: "A melee weapon attack.",
      attack: { bonus: 3, reachFeet: 5 },
      damage: [{ formula: "1d4", type: "bludgeoning" }]
    }
  ],
  extensions: {}
};

function initialState() {
  return GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "archer", definition: ARCHER }],
    actors: [
      {
        id: HERO,
        name: "Hero",
        kind: "player-character",
        hp: { current: 30, maximum: 30 },
        speedFeet: 30,
        definitionId: "archer"
      },
      { id: GOBLIN, name: "Goblin", kind: "monster", hp: { current: 10, maximum: 10 }, speedFeet: 30 },
      { id: ALLY, name: "Ally", kind: "player-character", hp: { current: 20, maximum: 20 }, speedFeet: 30 }
    ]
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A server with a battlemap, a fight (goblin first, then the hero, then the ally), and a player who owns the hero. */
async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-condition-authority-"));
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
  const gm = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const imported = await server.mapAssets.import(png(900, 600), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Arena", "battlemap");
  const player = server.auth.issuePlayerSession();
  const post = async (path: string, token: string, body: unknown = {}) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  expect((await post(GAME_PATHS.claims, player, { actorId: HERO })).status).toBe(200);
  expect(
    (
      await post(GAME_PATHS.encounterStart, gm, {
        mapAssetId: imported.metadata.id,
        entries: [
          { actorId: GOBLIN, score: 20 },
          { actorId: HERO, score: 15 },
          { actorId: ALLY, score: 10 }
        ]
      })
    ).status
  ).toBe(200);
  const actor = (id: string) => server.store.snapshot.actors.find((candidate) => candidate.id === id)!;
  const conditions = (id: string) => actor(id).conditions.map((condition) => condition.id);
  const setCondition = (token: string, actorId: string, conditionId: string, active: boolean) =>
    post(GAME_PATHS.actorConditions.replace("{actorId}", actorId), token, { conditionId, active });
  return { server, gm, player, post, actor, conditions, setCondition };
}

describe("effects the GM adds", () => {
  it("a GM-added Concentration effect is sustained by its named caster, not its bearer", async () => {
    const { gm, post, server } = await boot();
    const bless = await post(GAME_PATHS.effects.replace("{actorId}", ALLY), gm, {
      name: "Bless",
      concentration: true,
      sourceActorId: HERO
    });
    const blessId = bless.body.data.effectId as string;
    await post(GAME_PATHS.actorDamage.replace("{actorId}", ALLY), gm, { amount: 6 });
    expect(server.store.snapshot.combat.pendingSaves).toEqual([]);
    await post(GAME_PATHS.actorDamage.replace("{actorId}", HERO), gm, { amount: 6 });
    expect(server.store.snapshot.combat.pendingSaves).toMatchObject([
      { targetActorId: HERO, ability: "con", dc: 10, endsEffects: [{ actorId: ALLY, effectId: blessId }] }
    ]);
  });
});

describe("knocking out", () => {
  it("only a melee attack knocks a creature out, leaving it at 1 HP and Unconscious", async () => {
    const { gm, post, actor } = await boot();
    const knockOut = (sourceActionId: string) =>
      post(GAME_PATHS.actorDamage.replace("{actorId}", GOBLIN), gm, {
        amount: 30,
        nonlethal: true,
        sourceActorId: HERO,
        sourceActionId
      });
    const ranged = await knockOut("longbow");
    expect(ranged.status).toBe(409);
    expect(JSON.stringify(ranged.body)).toContain("Only a melee attack can knock a creature out");
    expect(actor(GOBLIN).hp.current).toBe(10);
    expect((await knockOut("club")).status).toBe(200);
    expect(actor(GOBLIN).hp.current).toBe(1);
    expect(actor(GOBLIN).conditions.map((condition) => condition.id)).toEqual(["prone", "unconscious"]);
  });
});
