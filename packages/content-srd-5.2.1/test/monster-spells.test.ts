import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions, loadSpells } from "../src/index.js";
import { spellIdOfName } from "../scripts/monster-spells.js";

// The spells SRD stat blocks cast, read from their Spellcasting lists and their other casting actions at build time.

const monsters = loadMonsterDefinitions();
const spellIds = new Set(loadSpells().map((spell) => spell.id));
const actionOf = (slug: string, actionId: string) =>
  monsters.find((monster) => monster.source.externalId === slug)?.actions.find((action) => action.id === actionId);

describe("monster spellcasting in the bundle", () => {
  it("reads every Spellcasting list but the pit fiend's Hellfire, and names only spells the SRD holds", () => {
    const lists = monsters.flatMap((monster) =>
      monster.actions.filter((action) => /spellcasting/i.test(action.name) && !action.castsSpells)
    );
    expect(lists.map((action) => action.id)).toEqual(["hellfire-spellcasting"]);
    const named = monsters.flatMap((monster) =>
      monster.actions.flatMap((action) => action.castsSpells?.spells.map((entry) => entry.spellId) ?? [])
    );
    expect(named.length).toBeGreaterThan(300);
    expect(named.filter((spellId) => !spellIds.has(spellId))).toEqual([]);
  });

  it("reads the lists' uses per day, the printed numbers and the level a spell is cast at", () => {
    expect(actionOf("mage", "spellcasting")?.castsSpells).toMatchObject({
      ability: "int",
      saveDc: 14,
      attackBonus: 6,
      spells: expect.arrayContaining([
        { id: "spellcasting-fireball", spellId: "fireball", name: "Fireball", perDay: 2 },
        { id: "spellcasting-detect-magic", spellId: "detect-magic", name: "Detect Magic" }
      ])
    });
    expect(actionOf("adult-red-dragon", "spellcasting")?.castsSpells).toMatchObject({ saveDc: 20, attackBonus: 12 });
    expect(actionOf("ice-devil", "ice-wall")?.castsSpells).toEqual({
      ability: "int",
      saveDc: 17,
      attackBonus: 9,
      // "Requiring no spell components."
      waives: ["verbal", "somatic", "material"],
      self: true,
      spells: [{ id: "ice-wall", spellId: "wall-of-ice", name: "Wall of Ice", atLevel: 8 }]
    });
  });

  it("points a Multiattack's use of Spellcasting at the cast it names, or at any of the list", () => {
    expect(actionOf("adult-black-dragon", "multiattack")?.multiattackReplacements).toEqual([
      { actionIds: ["spellcasting-acid-arrow-level-3"], attacks: 1 }
    ]);
    expect(actionOf("adult-black-dragon", "spellcasting")?.castsSpells?.spells).toContainEqual({
      id: "spellcasting-acid-arrow-level-3",
      spellId: "acid-arrow",
      name: "Acid Arrow",
      atLevel: 3
    });
    expect(actionOf("dryad", "multiattack")?.multiattack).toContainEqual({
      actionId: "spellcasting-charm-monster",
      count: 1
    });
    expect(actionOf("oni", "multiattack")?.multiattackReplacements?.[0]?.actionIds).toEqual([
      "spellcasting-charm-person",
      "spellcasting-darkness",
      "spellcasting-gaseous-form",
      "spellcasting-sleep"
    ]);
  });

  it("leaves reactions as they are, and casts a legendary action's spell at the list's numbers", () => {
    expect(actionOf("mage", "protective-magic")?.castsSpells).toBeUndefined();
    // "The mage casts Counterspell or Shield in response to the spell's trigger": the Counterspell half is a cast of
    // its own, from the same three uses a day.
    expect(actionOf("mage", "protective-magic-counterspell")).toMatchObject({
      activation: "reaction",
      uses: { limit: 3, per: "long-rest", pool: "protective-magic" },
      castsSpells: { saveDc: 14, self: true, spells: [{ spellId: "counterspell" }] }
    });
    expect(actionOf("adult-copper-dragon", "mind-jolt")?.castsSpells).toEqual({
      ability: "cha",
      saveDc: 17,
      attackBonus: 9,
      waives: ["material"],
      self: true,
      spells: [{ id: "mind-jolt", spellId: "mind-spike", name: "Mind Spike", atLevel: 4 }]
    });
  });

  it("slugs a printed spell name as the spell bundle does", () => {
    expect(spellIdOfName("Heroes' Feast")).toBe("heroes-feast");
    expect(spellIdOfName("Detect Evil and Good")).toBe("detect-evil-and-good");
  });
});
