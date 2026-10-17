import { describe, expect, it } from "vitest";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "../src/index.js";
import { traitMechanicsOf } from "../scripts/trait-mechanics.js";

// The traits the engine runs, read from each stat block's printed trait text when the bundle is built.

const monsters = new Map(loadMonsterDefinitions().map((monster) => [monster.source.externalId!, monster]));
const mechanicsOf = (slug: string) => monsters.get(slug)?.traitMechanics ?? [];
const printedTraits = (monster: ActorDefinition) =>
  ((monster.extensions["open5e.srd-2024"] as { traits?: Array<{ name: string }> }).traits ?? []).map(
    (trait) => trait.name
  );

describe("trait mechanics in the monster bundle", () => {
  it("reads every printing of the traits the engine runs", () => {
    const ran = new Map<string, number>();
    const printed = new Map<string, number>();
    for (const monster of monsters.values()) {
      for (const mechanic of monster.traitMechanics ?? []) ran.set(mechanic.name, (ran.get(mechanic.name) ?? 0) + 1);
      for (const name of printedTraits(monster)) printed.set(name, (printed.get(name) ?? 0) + 1);
    }
    for (const name of [
      "Regeneration",
      "Undead Fortitude",
      "Fire Aura",
      "Heat Aura",
      "Fear Aura",
      "Stench",
      "Death Burst",
      "Death Throes",
      "Barbed Hide",
      "Gibbering",
      "Vile Appearance",
      "Berserk",
      "Corrosive Form"
    ])
      expect(ran.get(name) ?? 0, name).toBe(name === "Corrosive Form" ? 1 : printed.get(name));
  });

  it("gives the troll its stopping types and its death that waits for its turn, and the oni its 1 HP", () => {
    expect(mechanicsOf("troll")).toEqual([
      {
        kind: "regeneration",
        name: "Regeneration",
        hitPoints: 15,
        stoppedBy: ["acid", "fire"],
        deathWaitsForTurn: true
      }
    ]);
    expect(mechanicsOf("oni")).toEqual([
      { kind: "regeneration", name: "Regeneration", hitPoints: 10, needsHitPoints: true }
    ]);
  });

  it("reads Undead Fortitude's save, its DC and what skips it", () => {
    expect(mechanicsOf("zombie")).toEqual([
      {
        kind: "undead-fortitude",
        name: "Undead Fortitude",
        ability: "con",
        dcBase: 5,
        exceptDamageTypes: ["radiant"],
        exceptCritical: true
      }
    ]);
  });

  it("reads auras: who they reach, when, and what they do", () => {
    expect(mechanicsOf("azer-sentinel")).toEqual([
      {
        kind: "aura",
        name: "Fire Aura",
        trigger: "bearer-turn-end",
        rangeFeet: 5,
        affects: "chosen",
        notWhileIncapacitated: true,
        damage: [{ formula: "1d10", type: "fire" }]
      }
    ]);
    expect(mechanicsOf("fire-elemental")).toContainEqual(expect.objectContaining({ rangeFeet: 10, hazard: "burning" }));
    expect(mechanicsOf("pit-fiend")).toEqual([
      {
        kind: "aura",
        name: "Fear Aura",
        trigger: "turn-start-inside",
        rangeFeet: 20,
        affects: "enemies",
        notWhileIncapacitated: true,
        save: {
          ability: "wis",
          dc: 21,
          successDamage: "none",
          failureConditions: ["frightened"],
          failureDuration: { type: "until-bearer-next-turn" },
          immuneOnSuccess: true
        }
      }
    ]);
    // The hezrou's Stench grants no immunity on a success, the ghast's does.
    expect(mechanicsOf("hezrou")[0]).toMatchObject({ rangeFeet: 10, save: { dc: 16 } });
    expect(mechanicsOf("hezrou")[0]).not.toHaveProperty("save.immuneOnSuccess");
    expect(mechanicsOf("ghast")[0]).toMatchObject({ save: { immuneOnSuccess: true } });
    // The mouther's failure is a d8 table the GM reads.
    expect(mechanicsOf("gibbering-mouther")[0]).toMatchObject({
      rangeFeet: 20,
      save: { ability: "wis", dc: 10, failureConditions: [] },
      reminder: expect.stringContaining("1-4: The target does nothing.")
    });
    // "Any Beast or Humanoid that starts its turn within 30 feet of the hag and can see the hag's true form": the types
    // are read, and the sight is the GM's.
    expect(mechanicsOf("sea-hag")).toEqual([
      {
        kind: "aura",
        name: "Vile Appearance",
        trigger: "turn-start-inside",
        rangeFeet: 30,
        affects: "all",
        creatureTypes: ["beast", "humanoid"],
        save: {
          ability: "wis",
          dc: 11,
          successDamage: "none",
          failureConditions: ["frightened"],
          failureDuration: { type: "until-bearer-next-turn" },
          immuneOnSuccess: true
        }
      }
    ]);
    expect(mechanicsOf("barbed-devil")).toEqual([
      {
        kind: "aura",
        name: "Barbed Hide",
        trigger: "bearer-turn-start",
        rangeFeet: 5,
        affects: "grapple-partners",
        damage: [{ formula: "1d10", type: "piercing" }]
      }
    ]);
  });

  it("reads Death Burst and the balor's Death Throes", () => {
    expect(mechanicsOf("magmin")).toEqual([
      {
        kind: "death-burst",
        name: "Death Burst",
        rangeFeet: 10,
        save: { ability: "dex", dc: 11, successDamage: "half", failureConditions: [] },
        damage: [{ formula: "2d6", type: "fire" }]
      }
    ]);
    expect(mechanicsOf("balor")).toContainEqual({
      kind: "death-burst",
      name: "Death Throes",
      rangeFeet: 30,
      save: { ability: "dex", dc: 20, successDamage: "half", failureConditions: [] },
      damage: [
        { formula: "9d6", type: "fire" },
        { formula: "9d6", type: "force" }
      ]
    });
  });

  it("leaves a trait whose text it doesn't know as prose", () => {
    expect(traitMechanicsOf([{ name: "Regeneration", description: "The hag heals when the moon is full." }])).toEqual(
      []
    );
    expect(mechanicsOf("goblin-warrior")).toEqual([]);
  });
});
