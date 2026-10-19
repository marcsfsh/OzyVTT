import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { legendaryInLair, legendaryResistancesPerDay } from "../src/lair.js";
import { createServer } from "../src/server.js";

// SRD 5.2.1 prints a legendary creature's counts in its lair: "Legendary Action Uses: 3 (4 in Lair)" and "Legendary
// Resistance (3/Day, or 4/Day in Lair)". The GM says where it fights, and the pool and its resistances follow.

const library = new ContentLibrary();
const catalog = equipmentCatalogOf(library.forAudience("gm"));
const monster = (slug: string) => library.monsterForInstance(slug)!;
const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  dragon: "10000000-0000-4000-8000-000000000002",
  tarrasque: "10000000-0000-4000-8000-000000000003",
  map: "20000000-0000-5000-8000-000000000001",
  gm: "30000000-0000-4000-8000-00000000000a"
} as const;
const hero = {
  schemaId: "vtt.actor-character",
  name: "Hero",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  hitPoints: { maximum: 200 },
  armorClass: 10,
  extensions: {},
  token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
  actions: []
} as unknown as ActorDefinition;
const resolveDefinition = (id: string) => (id === "hero" ? hero : monster(id));

function fight(inLair: boolean): GameState {
  const dragon = monster("adult-red-dragon");
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 200, maximum: 200 },
        definitionId: "hero"
      },
      {
        id: IDS.dragon,
        name: dragon.name,
        kind: "monster",
        hp: { current: 256, maximum: 256 },
        definitionId: "adult-red-dragon",
        armorClass: 19,
        legendary: legendaryInLair(dragon, inLair)
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.dragon, score: 10 }
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
/** The hero's turn has just ended: the window a legendary action is taken in. */
const window = (state: GameState) => {
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, afterActorId: IDS.hero, legendaryTakenBy: [] }
  };
};
const pounce = (state: GameState) =>
  resolveDefinitionAction(
    state,
    monster("adult-red-dragon").actions.find((action) => action.id === "pounce")!,
    { actorId: IDS.dragon, targetIds: [IDS.hero], commandId: nextId() },
    {
      random: (sides) => Math.min(sides, 10),
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: () => "2026-10-19T00:00:00.000Z",
      definition: monster("adult-red-dragon"),
      resolveDefinition,
      catalog
    }
  );

describe("a legendary creature in its lair", () => {
  it("takes the lair's counts, and its stat block's own counts out of it", () => {
    const dragon = monster("adult-red-dragon");
    expect(legendaryInLair(dragon, true)).toMatchObject({ actionsPerRound: 4, resistancesPerDay: 4, inLair: true });
    expect(legendaryInLair(dragon, false)).toMatchObject({ actionsPerRound: 3, resistancesPerDay: 3 });
    expect(legendaryInLair(dragon, false)).not.toHaveProperty("inLair");
    expect(legendaryInLair(monster("tarrasque"), true)).toBeNull();
  });

  it("takes a fourth legendary action in a round in its lair, and three out of it", () => {
    const inLair = fight(true);
    for (let use = 0; use < 4; use++) {
      window(inLair);
      pounce(inLair);
    }
    expect(inLair.combat.legendaryUsed[IDS.dragon]).toBe(4);
    const outside = fight(false);
    for (let use = 0; use < 3; use++) {
      window(outside);
      pounce(outside);
    }
    window(outside);
    expect(() => pounce(outside)).toThrowError(/0 of 3 legendary actions left/);
  });

  it("has a Legendary Resistance more a day in its lair", () => {
    const dragon = monster("adult-red-dragon");
    const state = fight(true);
    expect(legendaryResistancesPerDay(state.actors[1]!, dragon)).toBe(4);
    expect(legendaryResistancesPerDay(fight(false).actors[1]!, dragon)).toBe(3);
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-lair-"));
  const dragon = monster("adult-red-dragon");
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.dragon,
          name: "Adult Red Dragon",
          kind: "monster",
          hp: { current: 256, maximum: 256 },
          definitionId: "adult-red-dragon",
          legendary: dragon.legendary
        },
        {
          id: IDS.tarrasque,
          name: "Tarrasque",
          kind: "monster",
          hp: { current: 697, maximum: 697 },
          definitionId: "tarrasque",
          legendary: monster("tarrasque").legendary
        }
      ]
    })
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken };
}

const setLair = (base: string, token: string, actorId: string, inLair: boolean) =>
  fetch(base + GAME_PATHS.actorLair.replace("{actorId}", actorId), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ commandId: randomUUID(), actorId, inLair })
  });

describe("the GM's lair switch", () => {
  it("puts the lair's counts on the creature, and takes them off again", async () => {
    const { base, server, gmToken } = await boot();
    const response = await setLair(base, gmToken, IDS.dragon, true);
    expect(response.status, await response.clone().text()).toBe(200);
    const dragon = () => server.store.snapshot.actors.find((actor) => actor.id === IDS.dragon)!;
    expect(dragon().legendary).toMatchObject({ actionsPerRound: 4, resistancesPerDay: 4, inLair: true });
    await setLair(base, gmToken, IDS.dragon, false);
    expect(dragon().legendary).toMatchObject({ actionsPerRound: 3, resistancesPerDay: 3 });
    expect(dragon().legendary).not.toHaveProperty("inLair");
  });

  it("refuses a creature whose stat block prints no lair", async () => {
    const { base, gmToken } = await boot();
    const response = await setLair(base, gmToken, IDS.tarrasque, true);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Tarrasque's stat block prints no lair.");
  });
});
