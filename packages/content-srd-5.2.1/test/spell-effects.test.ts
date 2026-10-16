import { describe, expect, it } from "vitest";
import { loadSpells } from "../src/index.js";
import { healingOfText, spellEffectFromColumns } from "../src/spell-effect.js";
import { SPELL_EFFECT_REVIEWED_IDS } from "../scripts/spell-effects.js";

const effectOf = (id: string) => loadSpells().find((spell) => spell.id === id)!.effect;

describe("what one cast of an SRD spell does", () => {
  it("heals, and deals no damage, where the text restores hit points", () => {
    expect(effectOf("cure-wounds")).toEqual({
      attacks: 0,
      damage: [],
      healing: { formula: "2d8", addsModifier: true }
    });
    expect(effectOf("heal")!.healing).toEqual({ formula: "70", addsModifier: false });
    expect(effectOf("regenerate")!.healing).toEqual({ formula: "4d8 + 15", addsModifier: false });
  });

  it("deals the whole cast's damage, and none the text only threatens", () => {
    expect(effectOf("magic-missile")!.damage).toEqual([{ formula: "3d4 + 3", type: "force" }]);
    expect(effectOf("flame-strike")!.damage).toEqual([
      { formula: "5d6", type: "fire" },
      { formula: "5d6", type: "radiant" }
    ]);
    expect(effectOf("fireball")!.damage).toEqual([{ formula: "8d6", type: "fire" }]);
    for (const id of ["web", "hex", "hunters-mark", "spirit-guardians"]) expect(effectOf(id)!.damage, id).toEqual([]);
  });

  it("attacks only where the caster makes the spell attack", () => {
    expect(effectOf("fire-bolt")!.attacks).toBe(1);
    expect(effectOf("scorching-ray")!.attacks).toBe(3);
    expect(effectOf("bless")!.attackRange).toBeUndefined();
    for (const id of ["faerie-fire", "protection-from-evil-and-good", "ray-of-enfeeblement", "bless"])
      expect(effectOf(id)!.attacks, id).toBe(0);
  });

  it("says how far each spell attack reaches: a ranged one to the spell's range, a melee one 5 feet", () => {
    expect(effectOf("fire-bolt")!.attackRange).toEqual({ kind: "ranged", feet: 120 });
    expect(effectOf("scorching-ray")!.attackRange).toEqual({ kind: "ranged", feet: 120 });
    expect(effectOf("shocking-grasp")!.attackRange).toEqual({ kind: "melee", feet: 5 });
    // A Self spell's touch, and a Self spell's hurled flame.
    expect(effectOf("vampiric-touch")!.attackRange).toEqual({ kind: "melee", feet: 5 });
    expect(effectOf("produce-flame")!.attackRange).toEqual({ kind: "ranged", feet: 60 });
  });

  it("declares the reactions the table can offer, and none it can't see the trigger of", () => {
    expect(effectOf("shield")!.reaction).toEqual({
      trigger: "hit-by-attack",
      response: "ac-bonus",
      amount: 5,
      untilNextTurn: true
    });
    expect(effectOf("hellish-rebuke")!.reaction).toEqual({
      trigger: "damaged-by-creature",
      response: "strike-back",
      rangeFeet: 60
    });
    for (const id of ["counterspell", "feather-fall"]) expect(effectOf(id)!.reaction, id).toBeUndefined();
  });

  it("reviews only spells that exist", () => {
    const ids = new Set(loadSpells().map((spell) => spell.id));
    expect(SPELL_EFFECT_REVIEWED_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("a homebrew spell's cast model, from what its author set", () => {
  const cureWounds = loadSpells().find((spell) => spell.id === "cure-wounds")!;
  it("reads a typed roll as damage and the text's restoring as healing", () => {
    const bolt = { ...cureWounds, description: "A bolt.", attackRoll: true, damage: { roll: "2d10", types: ["fire"] } };
    expect(spellEffectFromColumns(bolt)).toEqual({
      attacks: 1,
      // A Touch spell's attack is a melee one.
      attackRange: { kind: "melee", feet: 5 },
      damage: [{ formula: "2d10", type: "fire" }],
      healing: null
    });
    const ranged = {
      ...bolt,
      description: "Make a ranged spell attack.",
      range: { distance: 60, unit: "feet", text: "60 feet" }
    };
    expect(spellEffectFromColumns(ranged).attackRange).toEqual({ kind: "ranged", feet: 60 });
    expect(spellEffectFromColumns(cureWounds).damage).toEqual([]);
    expect(healingOfText("It deals 2d8 Fire damage.")).toBeNull();
  });
});
