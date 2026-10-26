import { describe, expect, it } from "vitest";
import { loadPoisons } from "@vtt/content-srd-5.2.1";
import { catalog, catalogRow, fight, fighterInput, IDS, resolveAt, tableOf, write } from "./equipment-table.js";

// The Gameplay Toolbox's sample poisons (SRD 5.2.1), as consumables: an injury poison coats a weapon and opens its
// save on the next wound, an inhaled one fills a 5-foot Cube, an ingested one is fed to a creature.

const savesOn = (table: ReturnType<typeof tableOf>, actorId: string) =>
  table.state.combat.pendingSaves.filter((save) => save.targetActorId === actorId);

describe("the toolbox's poisons", () => {
  it("are fourteen items of the poison category, priced as the SRD prints them", () => {
    const poisons = loadPoisons();
    expect(poisons).toHaveLength(14);
    expect(poisons.every((poison) => poison.category === "poison")).toBe(true);
    expect(catalog.equipmentRecord("purple-worm-poison")).toMatchObject({
      costGp: 2000,
      poison: { kind: "injury", save: { ability: "con", dc: 21, successDamage: "half" } }
    });
    expect(catalog.equipmentRecord("serpent-venom")?.poison?.damage).toEqual([{ formula: "3d6", type: "poison" }]);
  });

  it("coats a weapon with Serpent Venom: the next Slashing hit spends it and opens a DC 11 Constitution save", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("serpent-venom", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-serpent-venom-coat-weapon", [], { targetIds: [], itemId: "greatsword" });
    expect(table.actor(IDS.fighter).effects).toMatchObject([{ itemId: "greatsword" }]);
    expect(table.actor(IDS.fighter).inventory.some((row) => row.id === "serpent-venom")).toBe(false);
    resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3, 4, 4, 4]);
    expect(table.actor(IDS.fighter).effects).toEqual([]);
    expect(savesOn(table, IDS.foe)[0]).toMatchObject({
      ability: "con",
      dc: 11,
      halfOnSuccess: true,
      proposedDamage: 12,
      actionName: "Serpent Venom"
    });
  });

  it("carries Spider's Sting's worse failure, by 5 or more, to the save it opens", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("spiders-sting", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-spiders-sting-coat-weapon", [], { targetIds: [], itemId: "greatsword" });
    resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3]);
    expect(savesOn(table, IDS.foe)[0]).toMatchObject({
      dc: 13,
      conditionIds: ["poisoned"],
      failureByMargin: { by: 5, whileFailed: { conditions: ["unconscious"] } }
    });
  });

  it("fills a 5-foot Cube with Malice: a DC 15 Constitution save against Poisoned and Blinded", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("malice", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-malice-release", [], { targetIds: [IDS.foe] }, 5);
    expect(savesOn(table, IDS.foe)[0]).toMatchObject({ dc: 15, conditionIds: ["poisoned", "blinded"] });
  });

  it("leaves Midnight Tears latent until midnight, when it asks its DC 17 save", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("midnight-tears", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-midnight-tears-feed", [], { targetIds: [IDS.foe] }, 5);
    expect(table.actor(IDS.foe).effects).toMatchObject([
      {
        name: "Midnight Tears",
        tags: ["latent-poison", "midnight-tears"],
        atRest: { at: "midnight", save: { ability: "con", dc: 17 } }
      }
    ]);
  });
});
