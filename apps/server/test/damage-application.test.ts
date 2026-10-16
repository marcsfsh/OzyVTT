import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActionSchema, ActorDefinitionSchema, InventoryItemSchema } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { applyDamageDetailed, halvedDamageParts } from "../src/hit-points.js";
import { weaponAction } from "../src/item-actions.js";
import { settlePlayerDamage, settlePlayerHit } from "../src/player-damage.js";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { answerSave, createPendingSaves, hasEvasion } from "../src/saving-throws.js";

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

describe("fixed damage that doesn't use a roll", () => {
  it("adds no ability modifier to a Blowgun's 1, and a crit leaves it at 1", () => {
    const definition = ActorDefinitionSchema.parse({
      schemaId: "vtt.actor-character",
      schemaVersion: 1,
      source: { name: "test", version: "1" },
      name: "Pip",
      size: "small",
      armorClass: 14,
      proficiencyBonus: 2,
      speedFeet: 25,
      abilityScores: { str: 8, dex: 18, con: 12, int: 10, wis: 10, cha: 10 },
      hitPoints: { maximum: 10 },
      token: { disposition: "friendly" }
    });
    const blowgun = InventoryItemSchema.parse({
      id: "blowgun",
      name: "Blowgun",
      equipped: true,
      weapon: {
        category: "martial",
        damageDice: "1",
        damageType: "piercing",
        rangeFeet: 25,
        longRangeFeet: 100,
        properties: ["ammunition", "loading"]
      }
    });
    const action = weaponAction(blowgun, definition)!;
    expect(action.damage).toEqual([{ formula: "1", type: "piercing" }]);
    expect(ActionSchema.safeParse(action).success).toBe(true);

    const game = fight();
    const crit = resolveDefinitionAction(
      game,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd() },
      queuedDeps([20])
    );
    expect(crit.attack?.outcome).toBe("crit");
    expect(crit.damageTotal).toBe(1);
  });
});

describe("damage from an action with no attack roll and no save", () => {
  const missile = {
    id: "magic-missile",
    name: "Magic Missile",
    activation: "action" as const,
    description: "Three darts.",
    damage: [{ formula: "3d4 + 3", type: "force" }]
  };

  it("owes every target its damage, so the GM's card can apply it", () => {
    const game = fight();
    const cast = resolveDefinitionAction(
      game,
      missile,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd() },
      queuedDeps([2, 3, 4])
    );
    expect(cast.damageTargets).toEqual([
      { targetId: IDS.foe, targetName: "Foe", parts: [{ amount: 12, type: "force" }], total: 12 }
    ]);
  });

  it("is proposed to the GM, or applied in direct mode, like a player's hit", () => {
    const game = fight();
    const cast = resolveDefinitionAction(
      game,
      missile,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd() },
      queuedDeps([2, 3, 4], { initiatorRole: "player", initiatorSessionId: IDS.player })
    );
    const damageDeps = { resolveDefinition: () => undefined, newId: () => crypto.randomUUID(), now: () => 0 };
    expect(settlePlayerDamage(game, cast, "Hero", IDS.hero, "proposal", damageDeps)).toEqual([]);
    expect(game.combat.pendingDamage).toEqual([
      expect.objectContaining({
        targetActorId: IDS.foe,
        proposedTotal: 12,
        proposedDamageParts: [{ amount: 12, type: "force" }]
      })
    ]);
    const direct = fight();
    const again = resolveDefinitionAction(
      direct,
      missile,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd() },
      queuedDeps([2, 3, 4])
    );
    settlePlayerDamage(direct, again, "Hero", IDS.hero, "direct", damageDeps);
    expect(direct.actors[1].hp.current).toBe(28);
  });
});

describe("a feature that rides any weapon hit (Divine Strike)", () => {
  const cleric = ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: "test", version: "1" },
    name: "Cleric",
    size: "medium",
    armorClass: 16,
    proficiencyBonus: 3,
    speedFeet: 30,
    abilityScores: { str: 14, dex: 10, con: 12, int: 10, wis: 16, cha: 10 },
    hitPoints: { maximum: 40 },
    token: { disposition: "friendly" },
    actions: [
      {
        id: "mace",
        name: "Mace",
        activation: "action",
        description: "A mace.",
        attack: { bonus: 5, reachFeet: 5 },
        damage: [{ formula: "1d6 + 2", type: "bludgeoning" }]
      },
      {
        id: "divine-strike",
        name: "Divine Strike",
        activation: "other",
        description: "Once on each of your turns.",
        damage: [{ formula: "1d8", type: "radiant" }],
        uses: { limit: 1, per: "turn", pool: "blessed-strikes" }
      }
    ]
  });
  const mace = cleric.actions[0];

  it("offers a choice of Radiant or Necrotic, takes the chosen type, and doubles on a crit", () => {
    const game = fight();
    const preview = resolveDefinitionAction(
      game,
      mace,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(), commit: false },
      queuedDeps([15], { definition: cleric })
    );
    expect(preview.hitOffers).toEqual([
      expect.objectContaining({ id: "divine-strike", damageTypes: ["radiant", "necrotic"], cost: "once per turn" })
    ]);
    const crit = resolveDefinitionAction(
      game,
      mace,
      {
        actorId: IDS.hero,
        targetIds: [IDS.foe],
        commandId: cmd(),
        hitOptions: [{ id: "divine-strike", damageType: "necrotic" }]
      },
      queuedDeps([20, 1, 1, 4, 5], { definition: cleric })
    );
    expect(crit.damage).toContainEqual({ formula: "2d8", type: "necrotic", total: 9, source: "Divine Strike" });
    expect(game.combat.turn.turnUses[`${IDS.hero}:blessed-strikes`]).toBe(1);
  });

  it("spends nothing when the attack misses", () => {
    const game = fight();
    const miss = resolveDefinitionAction(
      game,
      mace,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(), hitOptions: [{ id: "divine-strike" }] },
      queuedDeps([1], { definition: cleric })
    );
    expect(miss.attack?.outcome).toBe("fumble");
    expect(game.combat.turn.turnUses[`${IDS.hero}:blessed-strikes`]).toBeUndefined();
  });
});

describe("a stat block's conditional damage", () => {
  const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source.externalId === id)!;
  const monsterFight = (id: string) => {
    const definition = monster(id);
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.foe,
          name: definition.name,
          kind: "monster",
          visibility: "public",
          hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum },
          definitionId: id,
          size: definition.size
        },
        {
          id: IDS.hero,
          name: "Hero",
          kind: "player-character",
          visibility: "public",
          hp: { current: 30, maximum: 30 },
          armorClass: 10,
          size: "medium"
        }
      ],
      definitions: [{ id, definition }]
    });
    startEncounter(
      game,
      {
        mapAssetId: IDS.map,
        entries: [
          { actorId: IDS.foe, score: 20 },
          { actorId: IDS.hero, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const actionOf = (actionId: string) => definition.actions.find((action) => action.id === actionId)!;
    const strike = (actionId: string, faces: number[], extra: Record<string, unknown> = {}) => {
      // Each strike is a fresh action, so the economy never stands between two examples.
      game.combat = { ...game.combat, turn: { ...game.combat.turn, actionUsed: false, actionInstance: null } };
      return resolveDefinitionAction(
        game,
        actionOf(actionId),
        { actorId: IDS.foe, targetIds: [IDS.hero], commandId: cmd(), ...extra },
        queuedDeps(faces, { definition, resolveDefinition: (key) => (key === id ? definition : undefined) })
      );
    };
    return { game, strike };
  };

  it("a Bloodied swarm bites for its smaller dice", () => {
    const { game, strike } = monsterFight("swarm-of-rats");
    expect(strike("bites", [15, 2, 2]).damage).toEqual([{ formula: "2d4", type: "piercing", total: 4 }]);
    game.actors[0].hp.current = Math.floor(game.actors[0].hp.maximum / 2);
    expect(strike("bites", [15, 3]).damage).toEqual([{ formula: "1d4", type: "piercing", total: 3 }]);
  });

  it("a goblin adds its 1d4 only when the attack roll had Advantage", () => {
    const { strike } = monsterFight("goblin-warrior");
    expect(strike("scimitar", [15, 4]).damage).toHaveLength(1);
    expect(strike("scimitar", [15, 12, 4, 3], { rollMode: "advantage" }).damage).toEqual([
      { formula: "1d6 + 2", type: "slashing", total: 6 },
      { formula: "1d4", type: "slashing", total: 3 }
    ]);
  });

  it("offers a charge for the GM to confirm, and a confirmed charge adds its dice and Prone", () => {
    const { game, strike } = monsterFight("boar");
    const preview = strike("gore", [15], { commit: false });
    expect(preview.hitOffers).toEqual([
      expect.objectContaining({ id: "charge", name: "Charge", dice: "1d6 Piercing" })
    ]);
    const charged = strike("gore", [15, 2, 4], { hitOptions: [{ id: "charge" }] });
    expect(charged.damage).toContainEqual({ formula: "1d6", type: "piercing", total: 4, source: "Charge" });
    expect(game.actors[1].conditions.map((condition) => condition.id)).toContain("prone");
  });

  it("reminds the GM of damage the stat block deals on later turns", () => {
    const { strike } = monsterFight("gelatinous-cube");
    const engulf = strike("engulf", [3, 3, 3]);
    expect(engulf.warnings).toContainEqual(expect.stringMatching(/at the start of each of the cube's turns/));
  });
});

describe("Evasion on a stat block", () => {
  it("is read from the Assassin's printed trait, and not from a goblin", () => {
    const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source.externalId === id)!;
    expect(hasEvasion(monster("assassin"))).toBe(true);
    expect(hasEvasion(monster("goblin-warrior"))).toBe(false);
  });
});

describe("cover the GM marked on a creature", () => {
  const mark = (game: GameState, tag: string) =>
    addEffect(
      game,
      IDS.foe,
      makeEffect({ id: `cover-${tag}`, name: "Cover", tags: [tag], duration: { type: "manual" } })
    );
  const bow = {
    id: "bow",
    name: "Bow",
    activation: "action" as const,
    description: "A bow.",
    attack: { bonus: 5, rangeFeet: 80 },
    damage: [{ formula: "1d6", type: "piercing" }]
  };

  it("counts against a player's attack, though the player can't send cover", () => {
    const game = fight();
    mark(game, "cover-three-quarters");
    const shot = resolveDefinitionAction(
      game,
      bow,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd(), cover: null },
      queuedDeps([7, 3], { initiatorRole: "player", initiatorSessionId: IDS.player })
    );
    // 7 + 5 = 12 hits AC 10, but not AC 15 behind three-quarters cover.
    expect(shot.attack).toMatchObject({ targetAc: 15, coverBonus: 5, outcome: "miss" });
  });

  it("adds to the Dexterity save of a save spell, per target", () => {
    const game = fight();
    mark(game, "cover-half");
    resolveDefinitionAction(
      game,
      {
        id: "burning-hands",
        name: "Burning Hands",
        activation: "action",
        description: "A cone of fire.",
        save: { ability: "dex", dc: 13, successDamage: "half", failureConditions: [] },
        damage: [{ formula: "3d6", type: "fire" }]
      },
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd() },
      queuedDeps([2, 2, 2])
    );
    expect(game.combat.pendingSaves).toEqual([expect.objectContaining({ targetActorId: IDS.foe, saveBonus: 2 })]);
  });

  it("refuses a creature behind total cover as a single target", () => {
    const game = fight();
    mark(game, "cover-total");
    expect(() =>
      resolveDefinitionAction(
        game,
        bow,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: cmd() },
        queuedDeps([15])
      )
    ).toThrowError(/Total Cover/);
  });
});
