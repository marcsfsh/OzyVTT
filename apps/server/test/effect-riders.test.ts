import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorAction, type ActorDefinition, type Modifier } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { builtinAction } from "../src/builtin-actions.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";

// A live effect's modifiers are read by the same evaluator as an item's or a feature's, gates included:
// Rage's Strength advantage reaches the checks and saves the server rolls, an effect's attack bonus and
// extra damage reach the attack, and every gate is honoured. Runs the real builder on the real bundles.

const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;

/** A Halfling Barbarian 1: Str 17 (+3), Dex 14 (+2), and Rage but not yet Danger Sense. */
const BARBARIAN = {
  name: "Ozar",
  speciesId: "halfling",
  backgroundId: "soldier",
  classId: "barbarian",
  level: 1,
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "barbarian", kind: "skill", id: "perception" },
    { level: 1, classId: "barbarian", kind: "skill", id: "survival" },
    { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "greataxe" },
    { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "handaxe" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "barbarian-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
} as CharacterCreateRequestInput;

/** A plain humanoid target, or a dragon: `versus-creature-type` reads the stat block's type. */
const foeDefinition = (type: string): ActorDefinition =>
  ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: `foe-${type}` },
    name: "Foe",
    size: "medium",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 10,
    hitPoints: { maximum: 200 },
    speedFeet: 30,
    extensions: { "open5e.srd-2024": { type, challengeRating: 1 } }
  });

type Table = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor; foeDefinition: ActorDefinition }>;

function table(definition: ActorDefinition, foeType = "humanoid"): Table {
  const foe = foeDefinition(foeType);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        definitionId: foe.source.externalId,
        hp: { current: 200, maximum: 200 },
        armorClass: 10
      }
    ]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  startEncounter(
    state,
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
  return { definition, state, hero: state.actors.find((actor) => actor.id === IDS.hero)!, foeDefinition: foe };
}

const barbarian = () => table(buildCharacterDefinition(BARBARIAN, view, BuilderPolicySchema.parse({})));

function deps(built: Table, faces: number[]): ResolveDependencies {
  let index = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-10-15T00:00:00.000Z",
    definition: built.definition,
    resolveDefinition: (id) =>
      id === built.foeDefinition.source.externalId
        ? built.foeDefinition
        : built.state.definitions.find((entry) => entry.id === id)?.definition,
    catalog
  };
}

let command = 0;
const nextCommand = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;

/** Resolves one action off the hero's live sheet (or a builtin) as the `action.resolve` handler does, each on a
 *  fresh turn so the action economy never refuses the next one. */
function use(built: Table, action: ActorAction, faces: number[], targetIds: string[] = [], builtin = false) {
  const { turn } = built.state.combat;
  built.state.combat = {
    ...built.state.combat,
    turn: { ...turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: IDS.hero, targetIds, commandId: nextCommand(), ...(builtin ? { builtin: true } : {}) },
    deps(built, faces)
  );
}
const sheetAction = (built: Table, id: string) =>
  effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === id)!;
const enterRage = (built: Table) => use(built, sheetAction(built, "rage"), []);

/** Puts a hand-built effect on the hero, as the GM's `effect.add` does. */
function withEffect(built: Table, modifiers: readonly Modifier[], extra: Record<string, unknown> = {}) {
  addEffect(
    built.state,
    IDS.hero,
    makeEffect({
      id: `effect-${nextCommand()}`,
      name: "Battle Blessing",
      duration: { type: "manual" },
      modifiers: [...modifiers],
      ...extra
    })
  );
}

/** An ordinary saving throw the hero owes, parked as an action's save is. */
function owe(built: Table, ability: "str" | "dex" | "con") {
  createPendingSaves(built.state, {
    sourceActorId: IDS.foe,
    sourceName: "Foe",
    actionName: `Shove ${ability}`,
    ability,
    dc: 30,
    targetIds: [IDS.hero],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    newSaveId: () => "60000000-0000-4000-8000-000000000001",
    createdAt: 0
  });
}

/** A concentration check, raised the real way: damage to a creature sustaining a concentration effect. */
function oweConcentration(built: Table) {
  addEffect(
    built.state,
    IDS.hero,
    makeEffect({
      id: "held-spell",
      name: "Bless",
      duration: { type: "manual" },
      sourceActorId: IDS.hero,
      concentration: true
    })
  );
  applyDamageDetailed(
    built.state,
    IDS.hero,
    { amount: 4 },
    { role: "gm" },
    {
      resolveDefinition: () => built.definition,
      newId: () => "60000000-0000-4000-8000-000000000002",
      now: () => "2026-10-15T00:00:00.000Z",
      catalog
    }
  );
}

/** Answers the save the hero owes through the real save path. */
function answer(built: Table, faces: number[]) {
  const pending = built.state.combat.pendingSaves.at(-1)!;
  const { outcome } = answerSave(
    built.state,
    nextCommand(),
    pending.id,
    "roll",
    undefined,
    false,
    { role: "gm" },
    {
      random: () => {
        const face = faces.shift();
        if (face === undefined) throw new Error("dice queue empty");
        return face;
      },
      newRollId: () => "40000000-0000-4000-8000-0000000000ff",
      sessionId: IDS.gmSession,
      role: "gm",
      now: () => "2026-10-15T00:00:00.000Z",
      resolveDefinition: () => built.definition,
      catalog
    }
  );
  built.state.combat = { ...built.state.combat, pendingSaves: [] };
  return outcome;
}
const save = (built: Table, ability: "str" | "dex" | "con", faces: number[]) => {
  owe(built, ability);
  return answer(built, faces);
};

describe("Rage's effect reaches the rolls the server makes", () => {
  it("gives Advantage on a Strength check (Escape a Grapple on Athletics), not before the Rage", () => {
    const grappled = (built: Table) =>
      addEffect(
        built.state,
        IDS.hero,
        makeEffect({ id: `grip-${nextCommand()}`, name: "Grappled by Foe", duration: { type: "manual" }, escapeDc: 30 })
      );
    const calm = barbarian();
    grappled(calm);
    // Str +3 and Athletics proficiency (+2) beat Dex +2, so Athletics (a Strength check) is the branch that rolls: one
    // die, the 4 stands.
    const before = use(calm, builtinAction("escape-grapple")!, [4, 18], [], true);
    expect(before.check).toMatchObject({ naturalRoll: 4, total: 9 });
    expect(before.rollMode).toBeUndefined();

    const raging = barbarian();
    enterRage(raging);
    grappled(raging);
    const during = use(raging, builtinAction("escape-grapple")!, [4, 18], [], true);
    expect(during.check).toMatchObject({ naturalRoll: 18, total: 23 });
    expect(during.rollMode).toMatchObject({ mode: "advantage", advantage: ["Raging"] });
  });

  it("respects its gate: a Dexterity check (Hide) gets nothing from Rage", () => {
    const raging = barbarian();
    enterRage(raging);
    const hide = use(raging, builtinAction("hide")!, [4, 18], [], true);
    expect(hide.check).toMatchObject({ naturalRoll: 4 });
    expect(hide.rollMode).toBeUndefined();
  });

  it("gives Advantage on a Strength saving throw and on no other", () => {
    const raging = barbarian();
    enterRage(raging);
    expect(save(raging, "str", [3, 16]).rollMode).toEqual({
      mode: "advantage",
      advantage: ["Raging"],
      disadvantage: []
    });
    expect(save(raging, "dex", [3]).rollMode).toBeUndefined();
  });
});

describe("an effect's attack modifiers reach the attack", () => {
  const swing = (built: Table, faces: number[]) => use(built, sheetAction(built, "item-greataxe"), faces, [IDS.foe]);

  it("adds a standing attack bonus to the rolled to-hit and the sheet's number", () => {
    const plain = barbarian();
    const before = sheetAction(plain, "item-greataxe").attack!.bonus;
    withEffect(plain, [{ type: "attack-bonus", amount: 2 }]);
    expect(sheetAction(plain, "item-greataxe").attack!.bonus).toBe(before + 2);
    expect(swing(plain, [10, 6]).attack!.total).toBe(10 + before + 2);
  });

  it("honours a dynamic gate: the bonus applies only while the bearer is bloodied", () => {
    const built = barbarian();
    const base = sheetAction(built, "item-greataxe").attack!.bonus;
    withEffect(built, [{ type: "attack-bonus", amount: 3, when: [{ type: "while-hp-at-or-below", percent: 50 }] }]);
    expect(swing(built, [10, 6]).attack!.total).toBe(10 + base);
    built.hero.hp = { ...built.hero.hp, current: 1 };
    expect(swing(built, [10, 6]).attack!.total).toBe(10 + base + 3);
  });

  it("rolls extra damage on a melee hit and not on a miss, and roll-mode on the attack itself", () => {
    const built = barbarian();
    withEffect(built, [
      {
        type: "extra-damage",
        formula: "1d6",
        damageType: "fire",
        doubleOnCritical: false,
        when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee"] }]
      },
      {
        type: "roll-mode",
        roll: "attack",
        mode: "advantage",
        when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["melee"] }]
      }
    ]);
    // Two d20s (2 then 15, the higher kept), the greataxe's d12, then the effect's d6.
    const hit = swing(built, [2, 15, 7, 5]);
    expect(hit.rollMode).toMatchObject({ mode: "advantage", advantage: ["Battle Blessing"] });
    expect(hit.attack).toMatchObject({ naturalRoll: 15, outcome: "hit" });
    expect(hit.damage).toContainEqual({ formula: "1d6", type: "fire", total: 5 });
    // A natural 1 misses: the extra damage never rolls.
    const miss = swing(built, [1, 1]);
    expect(miss.attack?.outcome).toBe("fumble");
    expect(miss.damage).toEqual([]);
  });

  it("lapses while incapacitated when the effect says so, like Dodge", () => {
    const built = barbarian();
    const base = sheetAction(built, "item-greataxe").attack!.bonus;
    withEffect(built, [{ type: "attack-bonus", amount: 2 }], { voidWhileIncapacitated: true });
    built.hero.conditions = [{ id: "incapacitated" }];
    expect(sheetAction(built, "item-greataxe").attack!.bonus).toBe(base);
  });
});

describe("the filters that once had no reader", () => {
  /** The hero's own cantrip actions, shaped as the builder mints them. */
  const cantrip = (spellId: string, type: string): ActorAction => ({
    id: `spell-${spellId}`,
    name: spellId,
    activation: "action",
    description: "A cantrip.",
    attack: { bonus: 5, rangeFeet: 120 },
    damage: [{ formula: "1d10", type }],
    spellId
  });

  it("spell-school-is and spell-level-is narrow to the spell the action casts", () => {
    const built = barbarian();
    withEffect(built, [
      {
        type: "extra-damage",
        formula: "1d4",
        damageType: "force",
        doubleOnCritical: false,
        when: [{ type: "on-damage-roll" }, { type: "spell-school-is", schools: ["evocation"] }]
      },
      {
        type: "extra-damage",
        formula: "1d6",
        damageType: "psychic",
        doubleOnCritical: false,
        when: [{ type: "on-damage-roll" }, { type: "spell-level-is", levels: [1] }]
      }
    ]);
    // Fire Bolt is an evocation cantrip: the school rider fires, the level-1 rider does not.
    const bolt = use(built, cantrip("fire-bolt", "fire"), [15, 6, 3], [IDS.foe]);
    expect(bolt.damage.map((part) => part.type)).toEqual(["fire", "force"]);
    // Chill Touch is necromancy: neither fires.
    const touch = use(built, cantrip("chill-touch", "necrotic"), [15, 6], [IDS.foe]);
    expect(touch.damage.map((part) => part.type)).toEqual(["necrotic"]);
  });

  it("attack-kind-is spell matches an attack that casts a spell and not a weapon swing", () => {
    const built = barbarian();
    withEffect(built, [
      {
        type: "roll-mode",
        roll: "attack",
        mode: "advantage",
        when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["spell"] }]
      }
    ]);
    expect(use(built, cantrip("fire-bolt", "fire"), [2, 15, 6], [IDS.foe]).rollMode?.mode).toBe("advantage");
    expect(use(built, sheetAction(built, "item-greataxe"), [15, 6], [IDS.foe]).rollMode).toBeUndefined();
  });

  it("versus-creature-type reads the target's stat block", () => {
    const rider: Modifier = {
      type: "extra-damage",
      formula: "2d6",
      damageType: "radiant",
      doubleOnCritical: false,
      when: [{ type: "on-hit" }, { type: "versus-creature-type", creatureTypes: ["dragon"] }]
    };
    const versusDragon = table(barbarian().definition, "dragon");
    withEffect(versusDragon, [rider]);
    const slain = use(versusDragon, sheetAction(versusDragon, "item-greataxe"), [15, 6, 3, 4], [IDS.foe]);
    expect(slain.damage.map((part) => part.type)).toEqual(["slashing", "radiant"]);

    const versusHumanoid = barbarian();
    withEffect(versusHumanoid, [rider]);
    const plain = use(versusHumanoid, sheetAction(versusHumanoid, "item-greataxe"), [15, 6], [IDS.foe]);
    expect(plain.damage.map((part) => part.type)).toEqual(["slashing"]);
  });

  it("roll-mode concentration reaches a concentration check and no other Constitution save", () => {
    const built = barbarian();
    withEffect(built, [{ type: "roll-mode", roll: "concentration", mode: "advantage" }]);
    oweConcentration(built);
    expect(built.state.combat.pendingSaves.at(-1)?.actionName).toBe("Concentration check");
    expect(answer(built, [3, 16]).rollMode).toMatchObject({ mode: "advantage", advantage: ["Battle Blessing"] });
    expect(save(built, "con", [3]).rollMode).toBeUndefined();
  });
});
