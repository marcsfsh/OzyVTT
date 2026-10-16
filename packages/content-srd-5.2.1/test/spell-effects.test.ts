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
      targets: { count: 1 },
      healing: { formula: "2d8", addsModifier: true }
    });
    expect(effectOf("heal")!.healing).toEqual({ formula: "70", addsModifier: false });
    expect(effectOf("regenerate")!.healing).toEqual({ formula: "4d8 + 15", addsModifier: false });
  });

  it("deals the whole cast's damage, and none the text only threatens", () => {
    // Magic Missile's damage is per dart, each one assigned to its own target.
    expect(effectOf("magic-missile")!.damage).toEqual([{ formula: "1d4 + 1", type: "force" }]);
    expect(effectOf("magic-missile")!.darts).toBe(3);
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
    // A Self spell's touch; a summoned weapon strikes 5 feet past where it appears.
    expect(effectOf("vampiric-touch")!.attackRange).toEqual({ kind: "melee", feet: 5 });
    expect(effectOf("spiritual-weapon")!.attackRange).toEqual({ kind: "melee", feet: 65 });
    // Produce Flame's cast makes no attack; its hurl on a later turn reaches 60 feet.
    expect(effectOf("produce-flame")!.attacks).toBe(0);
    expect(effectOf("produce-flame")!.laterActions?.[0]?.attackRange).toEqual({ kind: "ranged", feet: 60 });
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

  it("deals the damage of a spell that harms as it appears (2024 wording)", () => {
    const appearing: Record<string, string> = {
      "black-tentacles": "3d6 bludgeoning",
      "blade-barrier": "6d10 force",
      cloudkill: "5d8 poison",
      "incendiary-cloud": "10d8 fire",
      "insect-plague": "4d10 piercing",
      "storm-of-vengeance": "2d6 thunder",
      tsunami: "6d10 bludgeoning",
      "wall-of-fire": "5d8 fire",
      "wall-of-ice": "10d6 cold",
      "wall-of-thorns": "7d8 piercing",
      "wind-wall": "4d8 bludgeoning",
      "heat-metal": "2d8 fire"
    };
    for (const [id, damage] of Object.entries(appearing))
      expect(
        effectOf(id)!
          .damage.map((part) => `${part.formula} ${part.type}`)
          .join(", "),
        id
      ).toBe(damage);
    // The summoned thing's attack on appearing adds the caster's modifier.
    for (const id of ["spiritual-weapon", "arcane-sword", "conjure-fey"]) {
      expect(effectOf(id)!.attacks, id).toBe(1);
      expect(effectOf(id)!.damage[0]!.addsModifier, id).toBe(true);
    }
  });

  it("makes no save on the cast where the SRD's save comes later, and models the later one", () => {
    for (const id of ["spirit-guardians", "haste", "web", "stinking-cloud", "sanctuary", "power-word-stun"])
      expect(effectOf(id)!.noCastSave, id).toBe(true);
    expect(effectOf("spirit-guardians")!.laterActions).toEqual([
      expect.objectContaining({
        activation: "other",
        save: { ability: "wis", successDamage: "half", failureConditions: [] },
        damage: [{ formula: "3d8", type: "radiant" }]
      })
    ]);
    expect(effectOf("fireball")!.noCastSave).toBeUndefined();
  });

  it("says how many creatures a cast targets, and how many more a higher slot adds", () => {
    expect(effectOf("bless")!.targets).toEqual({ count: 3, perSlot: 1 });
    expect(effectOf("mass-cure-wounds")!.targets).toEqual({ count: 6 });
    expect(effectOf("fireball")!.targets).toBeUndefined();
  });

  it("lets the caster pick the damage type where the spell does", () => {
    expect(effectOf("chromatic-orb")!.damageTypes).toEqual(["acid", "cold", "fire", "lightning", "poison", "thunder"]);
    expect(effectOf("sorcerous-burst")!.damage).toEqual([{ formula: "1d8", type: "acid" }]);
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
