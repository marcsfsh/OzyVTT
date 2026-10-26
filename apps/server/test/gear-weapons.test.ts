import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { recoverAmmunition } from "../src/ammunition.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 Torch, Improvised Weapons, the Thrown property, Oil of Sharpness and Ammunition of Slaying: what a carried
// thing does when it is swung, thrown or shot.

const row = (table: Table, id: string) => table.actor(IDS.fighter).inventory.find((entry) => entry.id === id);
const fresh = (table: Table) => {
  table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false, actionInstance: null };
};

describe("a Torch", () => {
  it("attacks as a Simple Melee weapon for 1 Fire damage while it burns", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, edit(table, IDS.fighter, "torch", { equipped: true }));
    expect(() => actionOf(table, IDS.fighter, "item-torch")).toThrow();
    table.actor(IDS.fighter).inventory = table
      .actor(IDS.fighter)
      .inventory.map((entry) => (entry.id === "torch" ? { ...entry, lit: true } : entry));
    const swing = actionOf(table, IDS.fighter, "item-torch");
    // Strength +4 and Proficiency +3 with a Simple weapon; the flame deals 1 Fire, no modifier.
    expect(swing.attack).toMatchObject({ bonus: 7, reachFeet: 5 });
    expect(swing.damage).toEqual([{ formula: "1", type: "fire" }]);
    fight(table, IDS.fighter);
    const hit = resolveAt(table, IDS.fighter, "item-torch", [15]);
    expect(hit.damage.map((part) => [part.type, part.total])).toEqual([["fire", 1]]);
  });
});

describe("improvised weapons", () => {
  it("swing with Strength and no Proficiency Bonus for 1d4 of the picked type", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    const hit = resolveAt(table, IDS.fighter, "improvised-weapon", [15, 3], { damageType: "slashing" });
    expect(hit.attack?.total).toBe(15 + 4);
    expect(hit.damage.map((part) => [part.type, part.total])).toEqual([["slashing", 7]]);
  });

  it("are thrown 20/60 feet", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    const hit = resolveAt(table, IDS.fighter, "improvised-weapon-thrown", [15, 3], {}, 40);
    // Beyond 20 feet: long range, with Disadvantage.
    expect(hit.rollMode?.mode).toBe("disadvantage");
  });

  it("include a Ranged weapon swung in melee and a Melee weapon without Thrown that is thrown", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("longbow"));
    const bow = actionOf(table, IDS.fighter, "item-longbow-improvised");
    expect(bow.attack).toMatchObject({ bonus: 4, reachFeet: 5 });
    expect(bow.damage).toEqual([{ formula: "1d4 + 4", type: "bludgeoning" }]);
    const sword = actionOf(table, IDS.fighter, "item-greatsword-thrown-improvised");
    expect(sword.attack).toMatchObject({ bonus: 4, rangeFeet: 60, rangeNormalFeet: 20 });
    // A weapon made to be thrown is thrown as itself.
    write(table, IDS.fighter, catalogRow("handaxe"));
    expect(() => actionOf(table, IDS.fighter, "item-handaxe-thrown-improvised")).toThrow();
  });
});

describe("a thrown weapon", () => {
  it("leaves the hand: one Handaxe is thrown once, and is picked up after the fight", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("handaxe"));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-handaxe", [15, 3], {}, 15);
    expect(row(table, "handaxe")).toMatchObject({ quantity: 0, thrownAway: 1 });
    expect(() => actionOf(table, IDS.fighter, "item-handaxe")).toThrow();
    recoverAmmunition(table.state, [IDS.fighter], catalog);
    expect(row(table, "handaxe")).toMatchObject({ quantity: 1 });
    expect(row(table, "handaxe")?.thrownAway).toBeUndefined();
  });

  it("stays in hand when swung in melee", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("handaxe"));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-handaxe", [15, 3], {}, 5);
    expect(row(table, "handaxe")).toMatchObject({ quantity: 1 });
  });

  it("thrown as an improvised weapon leaves the hand too", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-greatsword-thrown-improvised", [15, 3], {}, 15);
    expect(row(table, "greatsword")).toMatchObject({ quantity: 0, thrownAway: 1 });
  });
});

describe("Oil of Sharpness", () => {
  it("makes a Longsword a +3 Weapon bound to it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("oil-of-sharpness", { equipped: false }));
    write(table, IDS.fighter, catalogRow("longsword", { equipped: false }));
    resolveAt(table, IDS.fighter, "item-oil-of-sharpness-apply", [], { targetIds: [], itemId: "longsword" });
    expect(row(table, "longsword")).toBeUndefined();
    expect(row(table, "weapon-3")).toMatchObject({ baseId: "longsword", quantity: 1 });
    expect(row(table, "oil-of-sharpness")).toBeUndefined();
  });

  it("makes twenty Arrows +3 Ammunition", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("oil-of-sharpness", { equipped: false }));
    write(table, IDS.fighter, catalogRow("arrows-20", { equipped: false, quantity: 2 }));
    resolveAt(table, IDS.fighter, "item-oil-of-sharpness-apply", [], { targetIds: [], itemId: "arrows-20" });
    expect(row(table, "arrows-20")?.quantity).toBe(1);
    expect(row(table, "ammunition-3")).toMatchObject({ baseId: "arrows-20", quantity: 20 });
  });

  it("refuses a Mace, which deals Bludgeoning damage, and a weapon already magical", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("oil-of-sharpness", { equipped: false, quantity: 2 }));
    write(table, IDS.fighter, catalogRow("mace", { equipped: false }));
    expect(() =>
      resolveAt(table, IDS.fighter, "item-oil-of-sharpness-apply", [], { targetIds: [], itemId: "mace" })
    ).toThrow(/Slashing or Piercing/i);
    write(table, IDS.fighter, catalogRow("weapon-1", { equipped: false, baseId: "dagger" }));
    expect(() =>
      resolveAt(table, IDS.fighter, "item-oil-of-sharpness-apply", [], { targetIds: [], itemId: "weapon-1" })
    ).toThrow(/already magical/);
  });

  it("takes a minute, so it can't be applied in a fight", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("oil-of-sharpness", { equipped: false }));
    fight(table, IDS.fighter);
    expect(() =>
      resolveAt(table, IDS.fighter, "item-oil-of-sharpness-apply", [], { targetIds: [], itemId: "greatsword" })
    ).toThrow(/1 minute/);
  });
});

describe("Ammunition of Slaying", () => {
  /** The foe as a dragon or a goblin, by its stat block's type. */
  function foeOfType(table: Table, type: string) {
    const definitionId = `import-${IDS.foe}`;
    table.state.definitions = [
      ...table.state.definitions,
      {
        id: definitionId,
        definition: ActorDefinitionSchema.parse({
          schemaId: "vtt.actor-monster",
          schemaVersion: 1,
          source: { name: "Test", version: "1" },
          name: "Foe",
          size: "medium",
          abilityScores: { str: 14, dex: 12, con: 10, int: 6, wis: 10, cha: 6 },
          proficiencyBonus: 2,
          armorClass: 10,
          hitPoints: { maximum: 60 },
          speedFeet: 30,
          actions: [],
          extensions: { "open5e.srd-2024": { type, challengeRating: 1 } },
          token: { disposition: "hostile", footprint: { width: 1, height: 1 } }
        })
      }
    ];
    table.actor(IDS.foe).definitionId = definitionId;
  }

  function slayer(type: string): Table {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("arrows-20", { quantity: 0 }));
    write(
      table,
      IDS.fighter,
      catalogRow("ammunition-of-slaying", { equipped: true, quantity: 2, baseId: "arrows-20", variantId: "dragon" }),
      "gm"
    );
    foeOfType(table, type);
    fight(table, IDS.fighter);
    return table;
  }

  it("opens a DC 17 Constitution save for 6d10 Force on a dragon a shot that draws it hits", () => {
    const table = slayer("dragon");
    resolveAt(table, IDS.fighter, "item-shortbow", [15, 3, 5, 5, 5, 5, 5, 5], {}, 30);
    const save = table.state.combat.pendingSaves.find((entry) => entry.targetActorId === IDS.foe);
    expect(save).toMatchObject({ ability: "con", dc: 17, halfOnSuccess: true });
    // Its magic spent, the piece comes back as a plain arrow when it is picked up (half of those, rounded down).
    expect(row(table, "ammunition-of-slaying")).toMatchObject({ quantity: 1, ammunitionSpent: 1 });
  });

  it("opens nothing on a goblin, and keeps the piece's magic", () => {
    const table = slayer("humanoid");
    resolveAt(table, IDS.fighter, "item-shortbow", [15, 3], {}, 30);
    expect(table.state.combat.pendingSaves.filter((entry) => entry.targetActorId === IDS.foe)).toEqual([]);
    expect(row(table, "ammunition-of-slaying")).toMatchObject({ quantity: 1, ammunitionFired: 1 });
  });

  it("comes back as plain arrows once its magic is spent", () => {
    const table = slayer("dragon");
    resolveAt(table, IDS.fighter, "item-shortbow", [15, 3, 5, 5, 5, 5, 5, 5], {}, 30);
    fresh(table);
    resolveAt(table, IDS.fighter, "item-shortbow", [15, 3, 5, 5, 5, 5, 5, 5], {}, 30);
    recoverAmmunition(table.state, [IDS.fighter], catalog);
    const arrows = row(table, "arrows-20");
    expect(arrows).toMatchObject({ quantity: 1, ammunitionLeft: 1 });
  });
});
