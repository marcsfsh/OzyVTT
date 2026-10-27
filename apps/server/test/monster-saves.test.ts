import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { addEffect, DEATH_WARD_TAG, makeEffect } from "../src/effects.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave } from "../src/saving-throws.js";
import { currentSpeedFeet } from "../src/speed.js";
import { RulesBlockedError } from "../src/game-store.js";

// What a stat block's save does, read from the shipped monsters: a second failure that turns Incapacitated to
// Unconscious or Paralyzed and Restrained to Petrified, a breath that slows or weakens, an Exhaustion level, a kill,
// immunity after a success, and a charm repeated when the target takes damage.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000601",
  hero: "10000000-0000-4000-8000-000000000602",
  ally: "10000000-0000-4000-8000-000000000603",
  map: "20000000-0000-5000-8000-000000000601",
  gm: "30000000-0000-4000-8000-00000000060a"
};
const GM = { role: "gm" } as const;

const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 120 },
  actions: [
    {
      id: "jab",
      name: "Jab",
      activation: "bonus-action",
      description: "A jab.",
      attack: { bonus: 4, reachFeet: 5 },
      damage: [{ formula: "1d4", type: "bludgeoning" }]
    },
    {
      id: "swing",
      name: "Swing",
      activation: "action",
      description: "A swing.",
      attack: { bonus: 4, reachFeet: 5 },
      damage: [{ formula: "1d8", type: "slashing" }]
    }
  ],
  extensions: {}
} as unknown as ActorDefinition;

/** The monster `slug` on its turn, then the hero, then the hero's ally. */
function table(slug: string, heroHp = 120) {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: IDS.monster,
        name: definition.name,
        kind: "monster",
        hp: { current: 300, maximum: 300 },
        armorClass: 15,
        speedFeet: 30,
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: heroHp, maximum: 120 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: "hero-def"
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "player-character",
        hp: { current: 50, maximum: 50 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: "hero-def"
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { state, definition };
}
type Table = ReturnType<typeof table>;

let command = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";
/** The hero's sheet is the test's own; the monster's is the bundle's, and a test may add another. */
const extraDefinitions = new Map<string, ActorDefinition>([["hero-def", heroDefinition]]);
const resolveDefinition = (built: Table) => (id: string) =>
  extraDefinitions.get(id) ?? built.state.definitions.find((entry) => entry.id === id)?.definition;
const hero = (built: Table) => built.state.actors.find((actor) => actor.id === IDS.hero)!;
const monster = (built: Table) => built.state.actors.find((actor) => actor.id === IDS.monster)!;
const conditions = (built: Table) => hero(built).conditions.map((condition) => condition.id);

/** The monster uses `actionId` on the hero (or `targetId`). */
function use(built: Table, actionId: string, faces: number[] = [15], targetId = IDS.hero) {
  const action = built.definition.actions.find((entry) => entry.id === actionId);
  if (!action) throw new Error(`${built.definition.name} has no ${actionId}`);
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: IDS.monster, targetIds: [targetId], commandId: nextId() },
    {
      random: () => faces.shift() ?? 3,
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      definition: built.definition,
      resolveDefinition: resolveDefinition(built)
    }
  );
}
/** The hero's open save, answered with a typed total. */
function answer(built: Table, total: number, faces: number[] = []) {
  const pending = built.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.hero);
  if (!pending) throw new Error("The hero owes no save.");
  return answerSave(built.state, nextId(), pending.id, "manual", total, true, GM, {
    random: () => faces.shift() ?? 3,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition: resolveDefinition(built)
  });
}
/** A new turn for the monster: its action and Bonus Action back. */
const freshTurn = (built: Table) => {
  built.state.combat = {
    ...built.state.combat,
    turnActorId: IDS.monster,
    turn: {
      actionUsed: false,
      bonusActionUsed: false,
      actionInstance: null,
      bonusActionInstance: null,
      turnUses: {},
      movementUsedFeet: 0
    }
  };
};
const pending = (built: Table) => built.state.combat.pendingSaves.filter((save) => save.targetActorId === IDS.hero);
/** Plays on through the end of the hero's next turn. */
function pastHeroTurn(built: Table) {
  const deps = { resolveDefinition: resolveDefinition(built), rollDie: () => 3, newId: nextId, now: NOW };
  for (let guard = 0; guard < 4 && built.state.combat.turnActorId !== IDS.hero; guard += 1)
    nextInitiativeTurn(built.state, [], deps);
  nextInitiativeTurn(built.state, [], deps);
}
const hurt = (built: Table, amount: number, sourceActorId?: string) =>
  applyDamageDetailed(
    built.state,
    IDS.hero,
    { amount, parts: [{ amount, type: "fire" }], ...(sourceActorId ? { sourceActorId } : {}) },
    GM,
    { resolveDefinition: resolveDefinition(built), newId: nextId, now: NOW, rollDie: () => 3 }
  );

describe("a stat block's second failure", () => {
  it("puts a creature that fails a brass dragon's Sleep Breath twice to sleep for 10 minutes, until damage wakes it", () => {
    const built = table("adult-brass-dragon");
    use(built, "sleep-breath");
    answer(built, 5);
    expect(conditions(built)).toEqual(["incapacitated"]);
    pastHeroTurn(built);
    expect(conditions(built)).toEqual(["incapacitated"]);
    answer(built, 5);
    expect(conditions(built)).toEqual(["prone", "unconscious"]);
    expect(hero(built).effects).toMatchObject([{ duration: { type: "rounds", remaining: 100 }, endsOnDamage: true }]);
    hurt(built, 2);
    expect(conditions(built)).toEqual(["prone"]);
  });

  it("frees a creature that passes the second Sleep Breath save", () => {
    const built = table("brass-dragon-wyrmling");
    use(built, "sleep-breath");
    answer(built, 5);
    pastHeroTurn(built);
    answer(built, 20);
    expect(conditions(built)).toEqual([]);
    expect(hero(built).effects).toEqual([]);
  });

  it("paralyzes a creature that fails a silver dragon's Paralyzing Breath twice, with a save each turn for 1 minute", () => {
    const built = table("young-silver-dragon");
    use(built, "paralyzing-breath");
    answer(built, 5);
    pastHeroTurn(built);
    answer(built, 5);
    expect(conditions(built)).toEqual(["paralyzed"]);
    expect(hero(built).effects).toMatchObject([
      { duration: { type: "rounds", remaining: 10 }, repeatSave: { ability: "con", dc: 17 } }
    ]);
    pastHeroTurn(built);
    expect(pending(built)).toHaveLength(1);
    answer(built, 20);
    expect(conditions(built)).toEqual([]);
  });

  it.each([
    ["basilisk", "petrifying-gaze-recharge-4-6"],
    ["medusa", "petrifying-gaze-recharge-5-6"],
    ["gorgon", "petrifying-breath"]
  ])("turns a %s's Restrained to Petrified on a second failure", (slug, actionId) => {
    const built = table(slug);
    use(built, actionId);
    answer(built, 1);
    expect(conditions(built)).toEqual(["restrained"]);
    pastHeroTurn(built);
    answer(built, 1);
    expect(conditions(built)).toEqual(["petrified"]);
    expect(hero(built).effects).toMatchObject([{ duration: { type: "manual" } }]);
    expect(hero(built).effects[0]!.repeatSave).toBeUndefined();
  });

  it("petrifies a cockatrice's bitten target for 24 hours on a second failure, and a success at the repeat frees it", () => {
    const built = table("cockatrice");
    use(built, "petrifying-bite", [18, 3]);
    answer(built, 1);
    pastHeroTurn(built);
    answer(built, 1);
    expect(hero(built).effects).toMatchObject([{ duration: { type: "minutes", remaining: 1440 } }]);
    const again = table("cockatrice");
    use(again, "petrifying-bite", [18, 3]);
    answer(again, 1);
    pastHeroTurn(again);
    answer(again, 20);
    expect(conditions(again)).toEqual([]);
  });
});

describe("a failure with no condition", () => {
  it("slows a creature that fails a copper dragon's Slowing Breath until the end of its next turn", () => {
    const built = table("adult-copper-dragon");
    use(built, "slowing-breath");
    answer(built, 5);
    expect(hero(built).effects).toMatchObject([
      { tags: ["no-reactions", "speed-halved", "action-or-bonus"], duration: { type: "until-bearer-turn-end" } }
    ]);
    expect(currentSpeedFeet(hero(built), deriveEquipment(hero(built), heroDefinition, undefined))).toBe(15);
    // On its next turn it takes an action, and then no Bonus Action.
    nextInitiativeTurn(built.state, [], {
      resolveDefinition: resolveDefinition(built),
      rollDie: () => 3,
      newId: nextId,
      now: NOW
    });
    expect(built.state.combat.turnActorId).toBe(IDS.hero);
    const swing = heroDefinition.actions.find((action) => action.id === "swing")!;
    const jab = heroDefinition.actions.find((action) => action.id === "jab")!;
    const deps = {
      random: () => 10,
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      definition: heroDefinition,
      resolveDefinition: resolveDefinition(built)
    };
    resolveDefinitionAction(
      built.state,
      swing,
      { actorId: IDS.hero, targetIds: [IDS.monster], commandId: nextId() },
      deps
    );
    expect(() =>
      resolveDefinitionAction(
        built.state,
        jab,
        { actorId: IDS.hero, targetIds: [IDS.monster], commandId: nextId() },
        deps
      )
    ).toThrow(RulesBlockedError);
  });

  it("weakens a creature that fails a gold dragon's Weakening Breath, and spares one already weakened", () => {
    const built = table("adult-gold-dragon");
    use(built, "weakening-breath");
    answer(built, 5);
    expect(hero(built).effects).toMatchObject([
      { name: "Weakening Breath", duration: { type: "rounds", remaining: 10 }, repeatSave: { ability: "str", dc: 21 } }
    ]);
    // "Subtracts 3 (1d6) from its damage rolls."
    expect(hero(built).effects[0]!.modifiers).toContainEqual(
      expect.objectContaining({ type: "damage-bonus", dice: "-1d6" })
    );
    const derivation = deriveEquipment(hero(built), heroDefinition, undefined);
    expect(
      derivation.carriers.some((carrier) => carrier.modifiers.some((modifier) => modifier.type === "roll-mode"))
    ).toBe(true);
    freshTurn(built);
    const again = use(built, "weakening-breath");
    expect(pending(built)).toEqual([]);
    expect(again.warnings?.join(" ")).toMatch(/Hero is still under Adult Gold Dragon's Weakening Breath/);
  });

  it("adds an Exhaustion level for a failed save against a sphinx's Weight of Years", () => {
    const built = table("sphinx-of-lore");
    // A legendary action comes right after another creature's turn ends.
    built.state.combat = {
      ...built.state.combat,
      turnActorId: IDS.ally,
      turn: { ...built.state.combat.turn, afterActorId: IDS.hero }
    };
    use(built, "weight-of-years");
    answer(built, 5);
    expect(hero(built).conditions).toEqual([{ id: "exhaustion", level: 1 }]);
  });

  it("lets a half-dragon's breath take the type its Draconic Origin chose", () => {
    const built = table("half-dragon");
    const action = built.definition.actions.find((entry) => entry.id === "dragon-s-breath")!;
    expect(action.damage).toEqual([{ formula: "8d6", type: "acid", pick: "draconic-origin" }]);
    monster(built).statBlockPicks = { "draconic-origin": "cold" };
    resolveDefinitionAction(
      built.state,
      action,
      { actorId: IDS.monster, targetIds: [IDS.hero], commandId: nextId() },
      {
        random: () => 4,
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        definition: built.definition,
        resolveDefinition: resolveDefinition(built)
      }
    );
    expect(pending(built)).toMatchObject([{ proposedDamage: 32, proposedDamageParts: [{ type: "cold", amount: 32 }] }]);
  });

  it("kills a dying creature that fails a will-o'-wisp's Consume Life, and heals the wisp", () => {
    const built = table("will-o-wisp", 0);
    hero(built).deathSaves = { successes: 1, failures: 0, stable: false };
    monster(built).hp = { ...monster(built).hp, current: 200 };
    use(built, "consume-life");
    answer(built, 3, [4, 4, 4]);
    expect(hero(built).deathSaves).toEqual({ successes: 0, failures: 3, stable: false });
    expect(monster(built).hp.current).toBe(212);
    // The death is recorded with what killed it.
    expect(hero(built).death).toMatchObject({ cause: "Consume Life" });
  });

  it("lets Death Ward turn Consume Life aside, since it kills without damage", () => {
    const built = table("will-o-wisp", 0);
    hero(built).deathSaves = { successes: 1, failures: 0, stable: false };
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({ id: "ward", name: "Death Ward", tags: [DEATH_WARD_TAG], duration: { type: "manual" } })
    );
    use(built, "consume-life");
    answer(built, 3, [4, 4, 4]);
    expect(hero(built).deathSaves).toEqual({ successes: 1, failures: 0, stable: false });
    expect(hero(built).death).toBeUndefined();
    expect(hero(built).effects.some((effect) => effect.tags.includes(DEATH_WARD_TAG))).toBe(false);
  });
});

describe("a save only some creature types make", () => {
  it("makes no save for a creature of a type the text leaves out", () => {
    const built = table("cloaker");
    const moan = built.definition.actions.find((action) => action.id === "moan")!;
    // "If the target is a Humanoid, it is subjected to the following effect", on a stat block's own save.
    built.definition.actions.push({
      ...moan,
      id: "humanoid-moan",
      save: { ...moan.save!, onlyCreatureTypes: ["humanoid"] }
    });
    const wolfish = { ...heroDefinition, extensions: { "open5e.srd-2024": { type: "beast" } } } as ActorDefinition;
    extraDefinitions.set("beast-def", wolfish);
    built.state.actors.find((actor) => actor.id === IDS.ally)!.definitionId = "beast-def";
    const heard = use(built, "humanoid-moan", [15], IDS.ally);
    expect(built.state.combat.pendingSaves).toEqual([]);
    expect(heard.warnings?.join(" ")).toMatch(/Ally isn't a humanoid, so it makes no save/);
  });
});

describe("saves a stat block repeats or ends another way", () => {
  it("makes a creature that saved against a cloaker's Moan immune to it for the encounter", () => {
    const built = table("cloaker");
    use(built, "moan");
    answer(built, 20);
    pastHeroTurn(built);
    for (let guard = 0; guard < 4 && built.state.combat.turnActorId !== IDS.monster; guard += 1)
      nextInitiativeTurn(built.state, [], {
        resolveDefinition: resolveDefinition(built),
        rollDie: () => 3,
        newId: nextId,
        now: NOW
      });
    use(built, "moan");
    expect(pending(built)).toEqual([]);
  });

  it("asks a creature charmed by a harpy's song for the save when another source damages it, and not for the harpy's", () => {
    const built = table("harpy");
    use(built, "luring-song");
    answer(built, 3);
    expect(conditions(built)).toEqual(["charmed", "incapacitated"]);
    hurt(built, 3, IDS.monster);
    expect(pending(built)).toEqual([]);
    hurt(built, 3, IDS.ally);
    expect(pending(built)).toHaveLength(1);
    answer(built, 20);
    expect(conditions(built)).toEqual([]);
  });

  it("repeats an aboleth's Dominate Mind when the target takes damage, and ends it when the aboleth dies", () => {
    const built = table("aboleth");
    use(built, "dominate-mind");
    answer(built, 3);
    expect(conditions(built)).toEqual(["charmed"]);
    pastHeroTurn(built);
    expect(pending(built)).toEqual([]);
    hurt(built, 4, IDS.ally);
    expect(pending(built)).toHaveLength(1);
    answer(built, 3);
    expect(conditions(built)).toEqual(["charmed"]);
    applyDamageDetailed(built.state, IDS.monster, { amount: 400, parts: [{ amount: 400, type: "fire" }] }, GM, {
      resolveDefinition: resolveDefinition(built)
    });
    expect(conditions(built)).toEqual([]);
  });
});
