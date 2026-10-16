import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// Who may end a condition or an effect (SRD: each ends by its own rules; a grappler may release, a caster drop its
// Concentration, at any time). A player takes off what they put on and ends what their character is the source of;
// anything imposed on them is a rules block they can ask the GM about. The GM may end anything.

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

describe("taking conditions off", () => {
  it("a player takes off what they put on; one the GM imposed is a block they can ask the GM to lift", async () => {
    const { gm, player, post, conditions, setCondition } = await boot();
    expect((await setCondition(player, HERO, "poisoned", true)).status).toBe(200);
    expect((await setCondition(player, HERO, "poisoned", false)).status).toBe(200);
    expect(conditions(HERO)).toEqual([]);

    expect((await setCondition(gm, HERO, "restrained", true)).status).toBe(200);
    // Re-marking it themselves doesn't make it theirs.
    expect((await setCondition(player, HERO, "restrained", true)).status).toBe(200);
    const refused = await setCondition(player, HERO, "restrained", false);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe("condition.imposed");
    expect(conditions(HERO)).toEqual(["restrained"]);

    const asked = await post(GAME_PATHS.rulesAsk, player, {
      type: "actor.set-condition",
      payload: { commandId: randomUUID(), actorId: HERO, conditionId: "restrained", active: false }
    });
    expect(asked.status).toBe(200);
    expect(asked.body.data.ran).toBe(false);
    const allowed = await post(GAME_PATHS.rulesAnswer, gm, { askId: asked.body.data.askId, allow: true });
    expect(allowed.status).toBe(200);
    expect(conditions(HERO)).toEqual([]);
    // The GM may always take one off.
    await setCondition(gm, HERO, "blinded", true);
    expect((await setCondition(gm, HERO, "blinded", false)).status).toBe(200);
  });

  it("standing from Prone happens on your own turn, for half your Speed", async () => {
    const { gm, player, post, server, conditions, setCondition } = await boot();
    await setCondition(gm, HERO, "prone", true);
    const offTurn = await setCondition(player, HERO, "prone", false);
    expect(offTurn.status).toBe(409);
    expect(offTurn.body.error.details.reason).toBe("movement.stand-up-off-turn");
    expect(conditions(HERO)).toEqual(["prone"]);
    await post(GAME_PATHS.initiativeNext, gm, {});
    expect((await setCondition(player, HERO, "prone", false)).status).toBe(200);
    expect(conditions(HERO)).toEqual([]);
    expect(server.store.snapshot.combat.turn.movementUsedFeet).toBe(15);
  });
});

describe("ending effects", () => {
  it("a player ends what their character is the source of, on anyone, but not what was imposed on them", async () => {
    const { gm, player, post, actor } = await boot();
    const grapple = await post(GAME_PATHS.effects.replace("{actorId}", GOBLIN), gm, {
      name: "Grappled by Hero",
      tags: ["grapple"],
      sourceActorId: HERO
    });
    const grappleId = grapple.body.data.effectId as string;
    expect(
      (await post(GAME_PATHS.effectEnd.replace("{actorId}", GOBLIN).replace("{effectId}", grappleId), player)).status
    ).toBe(200);
    expect(actor(GOBLIN).effects).toEqual([]);

    const curse = await post(GAME_PATHS.effects.replace("{actorId}", HERO), gm, { name: "Cursed" });
    const curseId = curse.body.data.effectId as string;
    const refused = await post(GAME_PATHS.effectEnd.replace("{actorId}", HERO).replace("{effectId}", curseId), player);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe("condition.imposed");
    expect(actor(HERO).effects.map((effect) => effect.name)).toEqual(["Cursed"]);
    // Someone else's creature's effect from someone else is simply not theirs.
    const other = await post(GAME_PATHS.effects.replace("{actorId}", GOBLIN), gm, { name: "Bane" });
    const otherId = other.body.data.effectId as string;
    expect(
      (await post(GAME_PATHS.effectEnd.replace("{actorId}", GOBLIN).replace("{effectId}", otherId), player)).status
    ).toBe(403);
  });

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
