import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { settlePlayerDamage } from "../src/player-damage.js";
import { projectPlayerView } from "../src/projections.js";
import { applyRest } from "../src/rests.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { bootServer } from "./boot-server.js";
import { testCatalog } from "./catalog-records.js";
import { png } from "./image-fixtures.js";
import { build, catalog as builtCatalog, fight, FOE, HERO, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 damage that drains as it lands: a Life Drain lowers the target's Hit Point maximum by the damage taken
// until a Long Rest, a vampire regains what its Bite drains, Vampiric Touch heals its caster half the Necrotic damage,
// and Harm lowers the maximum on a failed save, never below 1.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  session: "30000000-0000-4000-8000-000000000001",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const NOW = () => "2026-10-17T00:00:00.000Z";

const plain = {
  name: "Anyone",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  hitPoints: { maximum: 30 },
  armorClass: 12,
  extensions: {},
  actions: []
} as unknown as ActorDefinition;
const monster = (slug: string) => loadMonsterDefinitions().find((entry) => entry.source.externalId === slug)!;
const resolveDefinition = (id: string) => (id === "plain" ? plain : monster(id));
const catalog = testCatalog({ spells: loadSpells() as unknown as object[] });

let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

/** The hero (a character at 30 of 30) against a monster of `slug`, with the monster's turn. */
function game(slug: string): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 30, maximum: 30 },
        ownerSessionId: IDS.session,
        definitionId: "plain",
        armorClass: 12
      },
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        hp: { current: 40, maximum: 90 },
        definitionId: slug,
        armorClass: 14
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.foe, score: 20 },
        { actorId: IDS.hero, score: 10 }
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}
const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const resolveDeps = (faces: number[], slug: string): ResolveDependencies => ({
  random: () => faces.shift() ?? 4,
  newRollId: nextId,
  gmSessionId: IDS.gm,
  now: NOW,
  definition: resolveDefinition(slug),
  resolveDefinition,
  catalog
});
const saveDeps: SaveAnswerDependencies = {
  random: () => 10,
  newRollId: nextId,
  sessionId: IDS.gm,
  role: "gm",
  now: NOW,
  resolveDefinition,
  catalog
};
/** The foe uses its action on the hero, who answers the save it owes (if any) with `total`. */
function strike(state: GameState, slug: string, actionId: string, faces: number[], total?: number) {
  const action = monster(slug).actions.find((entry) => entry.id === actionId)!;
  // A fresh turn for the foe each time, so its action economy never stands in the way.
  state.combat = {
    ...state.combat,
    turnActorId: IDS.foe,
    turn: { ...state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
  const resolution = resolveDefinitionAction(
    state,
    action,
    { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
    resolveDeps(faces, slug)
  );
  if (total !== undefined) {
    const pending = state.combat.pendingSaves.find((save) => save.targetActorId === IDS.hero)!;
    answerSave(state, nextId(), pending.id, "manual", total, true, GM, saveDeps);
  }
  return { action, resolution };
}

describe("a wight's Life Drain", () => {
  it("lowers the Hit Point maximum by the damage taken on a failed save, until a Long Rest", () => {
    const state = game("wight");
    // Failure: 6 (1d8 + 2) Necrotic damage.
    strike(state, "wight", "life-drain", [4], 1);
    const hero = actor(state, IDS.hero);
    expect(hero.hp).toMatchObject({ current: 24, maximum: 24 });
    expect(hero.effects).toEqual([
      expect.objectContaining({ name: "Hit Point maximum reduced", tags: ["drained"], hitPointMaximumLoss: 6 })
    ]);
    // A second drain adds to the same effect.
    strike(state, "wight", "life-drain", [4], 1);
    expect(actor(state, IDS.hero).hp.maximum).toBe(18);
    expect(actor(state, IDS.hero).effects).toEqual([expect.objectContaining({ hitPointMaximumLoss: 12 })]);
    state.combat = { ...state.combat, active: false };
    applyRest(state, IDS.hero, "long", resolveDefinition, catalog);
    expect(actor(state, IDS.hero).hp).toMatchObject({ current: 30, maximum: 30 });
    expect(actor(state, IDS.hero).effects).toEqual([]);
  });

  it("drains nothing when the save succeeds and deals no damage", () => {
    const state = game("wight");
    strike(state, "wight", "life-drain", [4], 30);
    expect(actor(state, IDS.hero).hp).toMatchObject({ current: 30, maximum: 30 });
  });

  it("kills a creature whose maximum it drains to 0", () => {
    const state = game("wight");
    actor(state, IDS.hero).hp = { current: 5, maximum: 5, temporary: 0 };
    strike(state, "wight", "life-drain", [4], 1);
    expect(actor(state, IDS.hero).hp).toMatchObject({ current: 0, maximum: 0 });
    expect(actor(state, IDS.hero).deathSaves).toMatchObject({ failures: 3 });
  });

  it("keeps the drained amount from players' view of the effect", () => {
    const state = game("wight");
    strike(state, "wight", "life-drain", [4], 1);
    const view = projectPlayerView(state, IDS.session, () => null);
    const effect = view.actors.find((entry) => entry.id === IDS.hero)!.effects[0]!;
    expect(effect.name).toBe("Hit Point maximum reduced");
    expect(effect).not.toHaveProperty("hitPointMaximumLoss");
  });
});

describe("a vampire's Bite", () => {
  it("drains the Necrotic damage alone, and the vampire regains that much", () => {
    const state = game("vampire");
    // Failure: 6 (1d6 + 3) Piercing plus 13 (3d8) Necrotic; the dice roll 3 and 4, 4, 4.
    strike(state, "vampire", "bite-bat-or-vampire-form-only", [3, 4, 4, 4], 1);
    const hero = actor(state, IDS.hero);
    expect(hero.hp.maximum).toBe(30 - 12);
    expect(actor(state, IDS.foe).hp.current).toBe(40 + 12);
  });
});

describe("Vampiric Touch", () => {
  it("heals its caster half the Necrotic damage the touch dealt", () => {
    const wizard = build(wizardInput(["vampiric-touch"]));
    const { resolve, state, action } = fight(wizard);
    actor(state, HERO).hp.current = 10;
    const resolution = resolve("spell-vampiric-touch", {}, [15, 4, 4, 3]);
    expect(resolution.attack?.outcome).toBe("hit");
    settlePlayerDamage(
      state,
      resolution,
      "Ansel",
      HERO,
      "direct",
      { resolveDefinition: () => undefined, newId: nextId, now: () => 0, catalog: builtCatalog },
      action("spell-vampiric-touch").drain
    );
    expect(actor(state, FOE).hp.current).toBe(200 - 11);
    expect(actor(state, HERO).hp.current).toBe(10 + 5);
  });
});

describe("Harm", () => {
  const harm = loadSpells().find((spell) => spell.id === "harm")!;
  const action = {
    id: "harm",
    name: "Harm",
    activation: "action" as const,
    description: harm.description,
    ...spellCastMechanics(harm, { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 0 })
  };
  const cast = (state: GameState, total: number) => {
    state.combat = {
      ...state.combat,
      turnActorId: IDS.foe,
      turn: { ...state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
    };
    resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
      resolveDeps([], "plain")
    );
    const pending = state.combat.pendingSaves.find((save) => save.targetActorId === IDS.hero)!;
    answerSave(state, nextId(), pending.id, "manual", total, true, GM, saveDeps);
  };

  it("lowers the maximum by the Necrotic damage on a failed save, never below 1", () => {
    const state = game("plain");
    actor(state, IDS.hero).hp = { current: 100, maximum: 100, temporary: 0 };
    // 14d6 at 4 each: 56.
    cast(state, 1);
    expect(actor(state, IDS.hero).hp).toMatchObject({ current: 44, maximum: 44 });
    cast(state, 1);
    expect(actor(state, IDS.hero).hp.maximum).toBe(1);
  });

  it("deals half the damage on a success and leaves the maximum alone", () => {
    const state = game("plain");
    actor(state, IDS.hero).hp = { current: 100, maximum: 100, temporary: 0 };
    cast(state, 30);
    expect(actor(state, IDS.hero).hp).toMatchObject({ current: 72, maximum: 100 });
  });
});

describe("the GM's apply", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("drains as the named action says, and a player's own apply never does", async () => {
    const wraith = monster("wraith");
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.hero,
          name: "Hero",
          kind: "player-character",
          visibility: "public",
          hp: { current: 30, maximum: 30 },
          armorClass: 12
        },
        {
          id: IDS.foe,
          name: "Wraith",
          kind: "monster",
          visibility: "public",
          hp: { current: 67, maximum: 67 },
          armorClass: 13,
          definitionId: "wraith-def"
        }
      ],
      definitions: [{ id: "wraith-def", definition: { ...wraith, id: "wraith-def" } }]
    });
    const booted = await bootServer(state);
    cleanups.push(booted.close);
    const { server, gmToken, post } = booted;
    const arena = await server.mapAssets.import(png(900, 600), "arena.png");
    server.mapCatalog.register(arena.metadata.id, "Arena", "battlemap");
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: IDS.hero })).status).toBe(200);
    const damage = (token: string, amount: number) =>
      post(GAME_PATHS.actorDamage.replace("{actorId}", IDS.hero), token, {
        commandId: randomUUID(),
        amount,
        parts: [{ amount, type: "necrotic" }],
        sourceActorId: IDS.foe,
        sourceActionId: "life-drain",
        sourceName: "Wraith's Life Drain"
      });
    const played = await damage(player, 4);
    expect(played.status, await played.clone().text()).toBe(200);
    expect(server.store.snapshot.actors.find((entry) => entry.id === IDS.hero)!.hp).toMatchObject({
      current: 26,
      maximum: 30
    });
    expect((await damage(gmToken, 7)).status).toBe(200);
    expect(server.store.snapshot.actors.find((entry) => entry.id === IDS.hero)!.hp).toMatchObject({
      current: 19,
      maximum: 23
    });
  });
});
