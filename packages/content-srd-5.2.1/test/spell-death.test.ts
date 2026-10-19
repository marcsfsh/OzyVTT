import { describe, expect, it } from "vitest";
import { loadSpells } from "../src/index.js";
import { SPELL_DEATH_IDS } from "../scripts/spell-death.js";

// SRD 5.2.1: the revival spells name the creature they can bring back and how it returns, and Gentle Repose keeps a
// corpse for them. The bundle carries both as data on the cast model.

const spells = loadSpells();
const effectOf = (id: string) => spells.find((record) => record.id === id)!.effect;

describe("the death and revival rows of the spell bundle", () => {
  it("names only real spells", () => {
    const ids = new Set(spells.map((record) => record.id));
    expect(SPELL_DEATH_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("reads each revival's limit and what it gives back", () => {
    expect(effectOf("revivify")?.revives).toEqual({ hitPoints: "one", withinMinutes: 1 });
    expect(effectOf("raise-dead")?.revives).toMatchObject({
      hitPoints: "one",
      withinMinutes: 14_400,
      notUndead: true,
      endsPoison: true
    });
    expect(effectOf("resurrection")?.revives).toMatchObject({
      hitPoints: "all",
      withinMinutes: 100 * 525_600,
      taxesCasterAfterMinutes: 525_600
    });
    expect(effectOf("true-resurrection")?.revives).toMatchObject({ newBody: true, endsCurses: true });
    expect(effectOf("reincarnate")?.revives).toMatchObject({ rollsSpecies: true });
  });

  it("reads the spells that kill outright, and the one whose dead rise", () => {
    expect(effectOf("disintegrate")?.drain).toEqual({ killsAtZero: { cause: "Disintegrate", bodyGone: true } });
    expect(effectOf("power-word-kill")).toMatchObject({
      killsAtHitPoints: 100,
      damage: [{ formula: "12d12", type: "psychic" }]
    });
    expect(effectOf("finger-of-death")?.drain).toEqual({
      slainRise: { monsterId: "zombie", creatureTypes: ["humanoid"] }
    });
    const divineWord = spells.find((record) => record.id === "divine-word")!.save;
    expect(divineWord?.failureByHitPoints?.map((band) => band.atOrBelow)).toEqual([20, 30, 40, 50]);
    expect(divineWord?.failureBanishes).toEqual(["celestial", "elemental", "fey", "fiend"]);
  });

  it("gives Gentle Repose one corpse and the effect that keeps it", () => {
    expect(effectOf("gentle-repose")).toMatchObject({
      reposes: true,
      targets: { count: 1 },
      grant: { name: "Gentle Repose", tags: ["gentle-repose"], target: "target" }
    });
  });
});
