import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed, halvedDamageParts } from "../src/hit-points.js";
import { settlePlayerHit } from "../src/player-damage.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";

// How rolled damage becomes hit points lost: the card's total, halving, and damage at 0 HP (SRD "Damage and
// Healing").

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  ally: "10000000-0000-4000-8000-000000000003",
  gm: "30000000-0000-4000-8000-00000000000a",
  player: "30000000-0000-4000-8000-00000000000b",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;

let commandCounter = 0;
const cmd = () => `50000000-0000-4000-8000-${String(++commandCounter).padStart(12, "0")}`;

function queuedDeps(faces: number[], extra: Partial<ResolveDependencies> = {}): ResolveDependencies {
  let rollIndex = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-${String(++rollIndex + commandCounter * 100).padStart(12, "0")}`,
    gmSessionId: IDS.gm,
    now: () => "2026-07-18T00:00:00.000Z",
    ...extra
  };
}

function fight(heroHp = { current: 20, maximum: 20, temporary: 0 }): GameState {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: heroHp,
        armorClass: 15,
        ownerSessionId: IDS.player
      },
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        armorClass: 10
      }
    ]
  });
  startEncounter(
    game,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return game;
}

describe("the damage total the card shows is the damage that lands", () => {
  it("a negative part deals 0 of its type and never eats another type's damage", () => {
    const game = fight();
    const action = {
      id: "cursed-blade",
      name: "Cursed Blade",
      activation: "action" as const,
      description: "Melee Attack Roll.",
      attack: { bonus: 5, reachFeet: 5 },
      damage: [
        { formula: "1d4 - 3", type: "piercing" },
        { formula: "1d6", type: "radiant" }
      ]
    };
    // d20 15 hits; the d4 rolls 1 (1 - 3 = -2) and the d6 rolls 5.
    const resolution = resolveDefinitionAction(
      game,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd() },
      queuedDeps([15, 1, 5])
    );
    expect(resolution.damageTotal).toBe(5);
    const applied = settlePlayerHit(game, resolution, "Hero", IDS.hero, "direct", {
      resolveDefinition: () => undefined,
      newId: () => cmd(),
      now: () => 0
    });
    expect(applied?.outcome.application.totalApplied).toBe(5);
    expect(game.actors[1].hp.current).toBe(35);
  });
});

describe("half damage is half the total, rounded down once", () => {
  it("a successful save against two damage types loses no extra point to rounding", () => {
    const game = fight();
    createPendingSaves(game, {
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Ice Storm",
      ability: "dex",
      dc: 10,
      targetIds: [IDS.hero],
      proposedDamage: 16,
      proposedDamageParts: [
        { amount: 7, type: "bludgeoning" },
        { amount: 9, type: "cold" }
      ],
      halfOnSuccess: true,
      conditionIds: [],
      newSaveId: () => "60000000-0000-4000-8000-000000000001",
      createdAt: 0
    });
    const { outcome } = answerSave(game, cmd(), "60000000-0000-4000-8000-000000000001", "manual", 18, true, GM, {
      random: () => 1,
      newRollId: () => cmd(),
      sessionId: IDS.gm,
      role: "gm",
      now: () => "2026-07-18T00:00:00.000Z",
      resolveDefinition: () => undefined
    });
    // floor(16 / 2) = 8, not floor(7 / 2) + floor(9 / 2) = 7.
    expect(outcome.appliedDamage).toBe(8);
    expect(game.actors[0].hp.current).toBe(12);
  });

  it("Uncanny Dodge's half is taken off the whole hit too", () => {
    const halved = halvedDamageParts([
      { amount: 5, type: "slashing" },
      { amount: 5, type: "fire" }
    ]);
    expect(halved.reduce((sum, part) => sum + part.amount, 0)).toBe(5);
  });
});

describe("damage at 0 hit points", () => {
  it("costs a death-save failure even when Temporary Hit Points soak all of it", () => {
    const game = fight({ current: 0, maximum: 20, temporary: 10 });
    game.actors[0].deathSaves = { successes: 0, failures: 0, stable: false };
    const outcome = applyDamageDetailed(game, IDS.hero, { amount: 5 }, GM);
    expect(game.actors[0].hp.temporary).toBe(5);
    expect(outcome.application.deathSaveFailuresAdded).toBe(1);
    expect(game.actors[0].deathSaves).toMatchObject({ failures: 1 });
  });

  it("only the damage that gets past Temporary Hit Points can kill outright", () => {
    const game = fight({ current: 0, maximum: 20, temporary: 10 });
    game.actors[0].deathSaves = { successes: 0, failures: 0, stable: false };
    const outcome = applyDamageDetailed(game, IDS.hero, { amount: 25 }, GM);
    expect(outcome.application.instantDeath).toBe(false);
    expect(outcome.application.deathSaveFailuresAdded).toBe(1);
  });
});
