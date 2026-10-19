import { describe, expect, it } from "vitest";
import type { ActorAction } from "@vtt/schemas";
import { createPendingSaves, answerSave, anySaveRollSources } from "../src/saving-throws.js";
import { applyDamageDetailed, previewDamage } from "../src/hit-points.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { endEffectsAtLongRest } from "../src/effects.js";
import { startOfTurn } from "../src/turn-boundaries.js";
import type { EffectNarration } from "../src/effects.js";
import {
  actionOf,
  actorOf,
  BRAN,
  catalog,
  checkWith,
  giveEffect,
  IMP,
  resolve,
  resolveDefinitionOf,
  table,
  WREN,
  wrenSheet,
  ZOMBIE,
  type Table
} from "./effect-vocabulary-kit.js";

// The rider shapes SRD 5.2.1 effects and features need, each read where its roll or event happens: dice and an
// ability modifier on checks, d20 and total floors, damage dice and die floors, immunity and ignored Resistance,
// rolled once-a-turn reductions, Advantage denied, healing riders, and the filters on the other creature's kind, the
// effect's source, marks, wounds and distance.

/** A ranged attack of Wren's own, for riders that read the distance. */
const SHORTBOW: ActorAction = {
  id: "shortbow",
  name: "Shortbow",
  activation: "action",
  description: "Shortbow.",
  attack: { bonus: 5, rangeFeet: 320, rangeNormalFeet: 80 },
  damage: [{ formula: "1d6", type: "piercing" }]
};

/** A DC 30 save Wren owes the Zombie, answered with `face`. */
function save(built: Table, ability: "str" | "dex" | "wis", face: number, sourceActorId = ZOMBIE) {
  createPendingSaves(built.state, {
    sourceActorId,
    sourceName: "Foe",
    actionName: "Test",
    ability,
    dc: 30,
    targetIds: [WREN],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    newSaveId: () => crypto.randomUUID(),
    createdAt: 0
  });
  const pending = built.state.combat.pendingSaves.find((entry) => entry.targetActorId === WREN)!;
  return answerSave(
    built.state,
    crypto.randomUUID(),
    pending.id,
    "roll",
    undefined,
    true,
    { role: "gm" },
    {
      random: () => face,
      newRollId: () => crypto.randomUUID(),
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-19T00:00:00.000Z",
      resolveDefinition: resolveDefinitionOf(built),
      catalog
    }
  );
}

describe("check riders", () => {
  it("adds a die to checks with one skill (Guidance's 1d4)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "check-bonus",
        amount: 0,
        dice: "1d4",
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["arcana"] }]
      }
    ]);
    const arcana = checkWith(built, { ability: "int", skill: "arcana" }, [10], [3]);
    expect(arcana.plan.diceTerms).toBe(" + 1d4");
    // Int +0 and proficiency +3, then the d4's 3.
    expect(arcana.roll.total).toBe(10 + 3 + 3);
    expect(checkWith(built, { ability: "str", skill: "athletics" }, [10]).plan.diceTerms).toBe("");
  });

  it("adds an ability modifier to a check, counted as at least its minimum (Thaumaturge's Wisdom)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "check-bonus",
        amount: 0,
        abilityModifier: "wis",
        minimum: 1,
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["arcana", "religion"] }]
      }
    ]);
    // Wisdom 16 is +3, on top of Int +0 and proficiency +3.
    expect(checkWith(built, { ability: "int", skill: "arcana" }, [10]).plan.modifier).toBe(6);
    const dull = table(wrenSheet({ abilityScores: { str: 18, dex: 12, con: 14, int: 10, wis: 8, cha: 8 } }));
    giveEffect(dull, WREN, [
      {
        type: "check-bonus",
        amount: 0,
        abilityModifier: "wis",
        minimum: 1,
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["arcana"] }]
      }
    ]);
    // Wisdom 8 is -1, which counts as the minimum of +1.
    expect(checkWith(dull, { ability: "int", skill: "arcana" }, [10]).plan.modifier).toBe(4);
  });

  it("raises a low d20 on a Charisma check to 15 (Glibness)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "d20-minimum",
        roll: "check",
        minimum: 15,
        when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["cha"] }]
      }
    ]);
    const low = checkWith(built, { ability: "cha" }, [4]);
    // Charisma 8 is -1: the 4 counts as 15.
    expect(low.roll).toMatchObject({ natural: 4, total: 14, raisedBy: "Test effect" });
    expect(checkWith(built, { ability: "cha" }, [18]).roll).toMatchObject({ total: 17, raisedBy: null });
    expect(checkWith(built, { ability: "str" }, [4]).roll.total).toBe(8);
  });

  it("raises a Strength check's total to the Strength score, and a Strength save's (Indomitable Might)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "total-minimum",
        roll: "check",
        abilityScore: "str",
        when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str"] }]
      },
      {
        type: "total-minimum",
        roll: "save",
        abilityScore: "str",
        when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["str"] }]
      }
    ]);
    expect(checkWith(built, { ability: "str", skill: "athletics" }, [2]).roll).toMatchObject({ total: 18 });
    // A save of 1 + 4 + 3 = 8 counts as 18; a Dexterity save is untouched.
    expect(save(built, "str", 1).outcome.total).toBe(18);
    expect(save(built, "dex", 1).outcome.total).toBe(2);
  });
});

describe("damage riders", () => {
  it("takes signed dice off each damage roll (Ray of Enfeeblement's 1d8)", () => {
    const built = table();
    giveEffect(built, WREN, [{ type: "damage-bonus", amount: 0, dice: "-1d8", when: [{ type: "on-damage-roll" }] }]);
    // A hit (17 + 7), the Greatsword's 2d6 at 6 and 5 with Strength +4, then the d8's 6 taken off.
    const swing = resolve(built, actionOf(built, "item-greatsword"), {}, [17, 6, 5, 6]);
    expect(swing.damageTotal).toBe(15 - 6);
  });

  it("leaves a reduced hit at 1 damage at the least (Reduce)", () => {
    const built = table();
    giveEffect(built, WREN, [
      { type: "damage-bonus", amount: 0, dice: "-1d4", leavesOne: true, when: [{ type: "on-hit" }] }
    ]);
    const poke = { ...SHORTBOW, id: "poke", damage: [{ formula: "1d4", type: "piercing" }] };
    // The 1d4 shows 2 and the penalty's d4 shows 4: the hit still deals 1.
    expect(resolve(built, poke, {}, [17, 2, 4], WREN, 10).damageTotal).toBe(1);
    // A 4 less a 1 deals 3.
    expect(resolve(built, poke, {}, [17, 4, 1], WREN, 10).damageTotal).toBe(3);
  });

  it("counts a damage die under 3 as 3 on a swing held in two hands (Great Weapon Fighting)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "damage-die-minimum",
        minimum: 3,
        when: [{ type: "on-damage-roll" }, { type: "attack-kind-is", kinds: ["two-handed"] }]
      }
    ]);
    // The 1 and the 2 on the 2d6 count as 3s: 3 + 3 + 4.
    expect(resolve(built, actionOf(built, "item-greatsword"), {}, [17, 1, 2]).damageTotal).toBe(10);
  });

  it("gives Immunity to a damage type from an effect (Mind Blank's Psychic)", () => {
    const built = table();
    giveEffect(built, WREN, [{ type: "damage-immunity", damageTypes: ["psychic"] }]);
    const landed = applyDamageDetailed(
      built.state,
      WREN,
      { amount: 12, parts: [{ amount: 12, type: "psychic" }] },
      { role: "gm" },
      {
        resolveDefinition: resolveDefinitionOf(built),
        catalog
      }
    );
    expect(landed.application.totalApplied).toBe(0);
  });

  it("lets the bearer's Bludgeoning, Piercing and Slashing damage ignore Resistance (Boon of Irresistible Offense)", () => {
    const built = table();
    giveEffect(built, ZOMBIE, [{ type: "damage-resistance", damageTypes: ["slashing"] }]);
    const deps = { resolveDefinition: resolveDefinitionOf(built), catalog };
    const hit = { amount: 10, parts: [{ amount: 10, type: "slashing" }], sourceActorId: WREN };
    expect(previewDamage(built.state, ZOMBIE, hit, deps).totalApplied).toBe(5);
    giveEffect(built, WREN, [{ type: "ignores-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] }]);
    expect(previewDamage(built.state, ZOMBIE, hit, deps).totalApplied).toBe(10);
  });

  it("rolls a reduction's die as the damage lands, once a turn (Resistance)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "damage-reduction",
        amount: 0,
        dice: "1d4",
        oncePerTurn: true,
        when: [{ type: "on-taking-damage" }, { type: "damage-type-is", damageTypes: ["fire"] }]
      }
    ]);
    const deps = { resolveDefinition: resolveDefinitionOf(built), catalog, rollDie: () => 3 };
    const fire = { amount: 10, parts: [{ amount: 10, type: "fire" }] };
    expect(applyDamageDetailed(built.state, WREN, fire, { role: "gm" }, deps).application.totalApplied).toBe(7);
    // The same turn: spent.
    expect(applyDamageDetailed(built.state, WREN, fire, { role: "gm" }, deps).application.totalApplied).toBe(10);
    // Cold isn't the chosen type.
    built.state.combat = { ...built.state.combat, round: built.state.combat.round + 1 };
    const cold = { amount: 10, parts: [{ amount: 10, type: "cold" }] };
    expect(applyDamageDetailed(built.state, WREN, cold, { role: "gm" }, deps).application.totalApplied).toBe(10);
    expect(applyDamageDetailed(built.state, WREN, fire, { role: "gm" }, deps).application.totalApplied).toBe(7);
  });
});

describe("attack roll riders", () => {
  it("denies Advantage on attacks against the bearer unless it is Incapacitated (Elusive)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "advantage-denied",
        roll: "incoming-attack",
        when: [{ type: "while-condition", conditionIds: ["incapacitated"], present: false }]
      },
      { type: "roll-mode", roll: "incoming-attack", mode: "advantage" }
    ]);
    const claw = actionOf(built, "slam", ZOMBIE);
    const struck = resolve(built, claw, { targetIds: [WREN] }, [12], ZOMBIE);
    expect(struck.rollMode?.advantage ?? []).toEqual([]);
    expect(struck.warnings?.some((line) => line.includes("no attack roll has Advantage against Wren"))).toBe(true);
  });

  it("gives creatures of the warded types Disadvantage on attacks against the bearer (Protection from Evil and Good)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "roll-mode",
        roll: "incoming-attack",
        mode: "disadvantage",
        when: [{ type: "on-attack-roll" }, { type: "source-creature-type-is", creatureTypes: ["fiend", "undead"] }]
      }
    ]);
    const fromZombie = resolve(built, actionOf(built, "slam", ZOMBIE), { targetIds: [WREN] }, [12, 12], ZOMBIE);
    expect(fromZombie.rollMode?.disadvantage).toContain("Target: Test effect");
  });

  it("wards the bearer from conditions a creature of those types imposes", () => {
    const built = table();
    giveEffect(built, WREN, [], { conditionWards: { conditionIds: ["frightened"], creatureTypes: ["undead"] } });
    giveEffect(built, WREN, [], { sourceActorId: ZOMBIE, linkedConditionIds: ["frightened"] });
    expect(actorOf(built.state, WREN).conditions.map((entry) => entry.id)).not.toContain("frightened");
    giveEffect(built, WREN, [], { sourceActorId: BRAN, linkedConditionIds: ["frightened"] });
    expect(actorOf(built.state, WREN).conditions.map((entry) => entry.id)).toContain("frightened");
  });

  it("gives Disadvantage on the bearer's attacks against the creature that put the effect on it (Bestow Curse)", () => {
    const built = table();
    giveEffect(
      built,
      WREN,
      [
        {
          type: "roll-mode",
          roll: "attack",
          mode: "disadvantage",
          when: [{ type: "on-attack-roll" }, { type: "versus-effect-source" }]
        }
      ],
      { sourceActorId: IMP, name: "Bestow Curse" }
    );
    const atImp = resolve(built, actionOf(built, "item-greatsword"), { targetIds: [IMP] }, [15, 4]);
    expect(atImp.rollMode?.disadvantage).toContain("Bestow Curse");
    const atZombie = resolve(built, actionOf(built, "item-greatsword"), { targetIds: [ZOMBIE] }, [15]);
    expect(atZombie.rollMode?.disadvantage ?? []).toEqual([]);
  });

  it("gives Advantage against a creature the bearer marked (Precise Hunter), and extra damage on a hurt one (Colossus Slayer)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "roll-mode",
        roll: "attack",
        mode: "advantage",
        when: [{ type: "on-attack-roll" }, { type: "versus-marked", tags: ["hunters-mark"] }]
      },
      {
        type: "extra-damage",
        formula: "1d8",
        doubleOnCritical: true,
        when: [{ type: "on-hit" }, { type: "versus-hurt" }]
      }
    ]);
    giveEffect(built, ZOMBIE, [], { sourceActorId: WREN, tags: ["hunters-mark"], name: "Hunter's Mark" });
    const marked = resolve(built, actionOf(built, "item-greatsword"), { targetIds: [ZOMBIE] }, [5, 15, 3, 3]);
    expect(marked.rollMode?.advantage).toContain("Test effect");
    // The Zombie was whole, so no d8.
    expect(marked.damage.length).toBe(1);
    actorOf(built.state, IMP).hp.current = 10;
    const hurt = resolve(built, actionOf(built, "item-greatsword"), { targetIds: [IMP] }, [17, 3, 3, 8]);
    expect(hurt.damage.map((part) => part.total)).toEqual([10, 8]);
  });

  it("adds damage only to a target within reach of the bearer (Conjure Minor Elementals' 15 feet)", () => {
    const built = table();
    giveEffect(built, WREN, [
      {
        type: "extra-damage",
        formula: "2d8",
        damageType: "fire",
        doubleOnCritical: true,
        when: [{ type: "on-hit" }, { type: "versus-within", feet: 15 }]
      }
    ]);
    const near = resolve(built, SHORTBOW, {}, [17, 3, 4, 4], WREN, 10);
    expect(near.damage.map((part) => part.type)).toEqual(["piercing", "fire"]);
    const far = resolve(built, SHORTBOW, {}, [17, 3], WREN, 30);
    expect(far.damage.map((part) => part.type)).toEqual(["piercing"]);
  });
});

describe("healing and saving throw riders", () => {
  it("gives Advantage on death saves alone (Beacon of Hope)", () => {
    const built = table();
    giveEffect(built, WREN, [{ type: "roll-mode", roll: "death-save", mode: "advantage" }]);
    const derivation = deriveEquipment(actorOf(built.state, WREN), built.definition, catalog);
    expect(anySaveRollSources(derivation).advantage.length).toBe(1);
    expect(save(built, "wis", 10).outcome.rollMode).toBeUndefined();
  });

  it("restores hit points at the start of each of the bearer's turns (Regenerate)", () => {
    const built = table();
    actorOf(built.state, WREN).hp.current = 20;
    giveEffect(built, WREN, [], { hitPointsEachTurn: 1, name: "Regenerate" });
    const events: EffectNarration[] = [];
    startOfTurn(built.state, WREN, events, {
      rollDie: () => 1,
      resolveDefinition: resolveDefinitionOf(built),
      catalog
    });
    expect(actorOf(built.state, WREN).hp.current).toBe(21);
    expect(events.map((event) => event.text)).toContain("Wren regains 1 hit point (Regenerate).");
  });

  it("shrinks a D20 Test penalty by one each Long Rest until it is gone (Raise Dead)", () => {
    const built = table();
    giveEffect(
      built,
      WREN,
      [
        { type: "attack-bonus", amount: -2, when: [{ type: "on-attack-roll" }] },
        { type: "save-bonus", amount: -2, when: [{ type: "on-saving-throw" }] },
        { type: "check-bonus", amount: -2, when: [{ type: "on-ability-check" }] }
      ],
      { shrinksEachLongRest: true, name: "Raise Dead" }
    );
    endEffectsAtLongRest(built.state, WREN);
    const shrunk = actorOf(built.state, WREN).effects.find((effect) => effect.name === "Raise Dead")!;
    expect(shrunk.modifiers.map((modifier) => ("amount" in modifier ? modifier.amount : null))).toEqual([-1, -1, -1]);
    endEffectsAtLongRest(built.state, WREN);
    expect(actorOf(built.state, WREN).effects.some((effect) => effect.name === "Raise Dead")).toBe(false);
  });
});
