import { describe, expect, it } from "vitest";
import { loadEquipment } from "@vtt/content-srd-5.2.1";
import { toolUses } from "../src/ability-checks.js";
import { setCondition } from "../src/actor-conditions.js";
import { deriveActorSheet } from "../src/actor-derived.js";
import { carryingOf } from "../src/carrying.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { RulesBlockedError } from "../src/game-store.js";
import { currentSpeedFeet } from "../src/speed.js";
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
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 Adventuring Gear, Armor and Unconscious: a pack is what it holds, bindings hold until a check escapes
// them, a focus staff is a Quarterstaff, armor goes on and comes off on the clock, and an Unconscious creature drops
// what it holds.

const row = (table: Table, actorId: string, id: string) =>
  table.actor(actorId).inventory.find((entry) => entry.id === id);

describe("equipment packs", () => {
  it("unpacks a starting Dungeoneer's Pack into the things it holds", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    expect(row(table, IDS.fighter, "dungeoneers-pack")).toBeUndefined();
    expect(row(table, IDS.fighter, "torch")?.quantity).toBe(10);
    expect(row(table, IDS.fighter, "rations")?.quantity).toBe(10);
    expect(row(table, IDS.fighter, "crowbar")?.quantity).toBe(1);
  });

  it("adds an Explorer's Pack's things to the stacks already carried", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("explorers-pack", { equipped: false }));
    expect(row(table, IDS.fighter, "explorers-pack")).toBeUndefined();
    expect(row(table, IDS.fighter, "torch")?.quantity).toBe(20);
    expect(row(table, IDS.fighter, "bedroll")).toMatchObject({ quantity: 1, equipped: false });
  });
});

describe("bindings", () => {
  it("binds a Grappled foe with a Chain until a DC 18 Dexterity (Acrobatics) check escapes it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("chain"));
    fight(table, IDS.fighter);
    expect(() => resolveAt(table, IDS.fighter, "item-chain-bind", [], { targetIds: [IDS.foe] })).toThrow(/Grappled/);
    setCondition(table.state, IDS.foe, "grappled", true, undefined, { role: "gm" });
    resolveAt(table, IDS.fighter, "item-chain-bind", [], { targetIds: [IDS.foe] });
    const foe = table.actor(IDS.foe);
    expect(foe.conditions.map((condition) => condition.id)).toContain("restrained");
    expect(foe.effects.find((effect) => effect.name === "Bound by a Chain")?.endAction).toMatchObject({
      kind: "check",
      ability: "dex",
      skill: "acrobatics",
      dc: 18
    });
  });

  it("gives a creature in Manacles Disadvantage on its attack rolls", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("manacles"));
    fight(table, IDS.fighter);
    setCondition(table.state, IDS.foe, "restrained", true, undefined, { role: "gm" });
    resolveAt(table, IDS.fighter, "item-manacles-bind", [], { targetIds: [IDS.foe] });
    const bound = table.actor(IDS.foe).effects.find((effect) => effect.name === "Bound by Manacles")!;
    expect(bound.modifiers).toEqual([
      { type: "roll-mode", roll: "attack", mode: "disadvantage", when: [{ type: "on-attack-roll" }] }
    ]);
    expect(bound.endAction).toMatchObject({ skill: "sleight-of-hand", dc: 20 });
  });
});

describe("a focus staff", () => {
  it("swings as a Quarterstaff", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("arcane-focus-staff"));
    expect(actionOf(table, IDS.wizard, "item-arcane-focus-staff").damage).toEqual([
      { formula: "1d6", type: "bludgeoning" }
    ]);
  });
});

describe("armor in a fight", () => {
  it("refuses to doff body armor in a fight, since it takes minutes", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "chain-mail", { equipped: false }))).toThrow(
      "Doffing Chain Mail takes 5 minutes, so it can't be done in a fight."
    );
    write(table, IDS.fighter, edit(table, IDS.fighter, "chain-mail", { equipped: false }), "gm");
    expect(row(table, IDS.fighter, "chain-mail")?.equipped).toBe(false);
  });

  it("takes the Utilize action to don a Shield on its holder's turn", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("shield", { equipped: false }));
    write(table, IDS.fighter, edit(table, IDS.fighter, "greatsword", { equipped: false }));
    fight(table, IDS.fighter);
    write(table, IDS.fighter, edit(table, IDS.fighter, "shield", { equipped: true }));
    expect(table.state.combat.turn.actionUsed).toBe(true);
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "shield", { equipped: false }))).toThrow(
      RulesBlockedError
    );
  });
});

describe("Unconscious", () => {
  it("drops the weapons in hand and keeps the armor on", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    expect(row(table, IDS.fighter, "greatsword")?.equipped).toBe(true);
    setCondition(table.state, IDS.fighter, "unconscious", true, undefined, { role: "gm" });
    expect(row(table, IDS.fighter, "greatsword")?.equipped).toBe(false);
    expect(row(table, IDS.fighter, "chain-mail")?.equipped).toBe(true);
  });

  it("takes the Armor Class a dropped staff gave", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    const before = table.actor(IDS.fighter).armorClass!;
    write(table, IDS.fighter, catalogRow("staff-of-power", { attuned: true }), "gm");
    expect(table.actor(IDS.fighter).armorClass).toBe(before + 2);
    setCondition(
      table.state,
      IDS.fighter,
      "unconscious",
      true,
      undefined,
      { role: "gm" },
      {
        catalog,
        resolveDefinition: table.resolve
      }
    );
    expect(table.actor(IDS.fighter).armorClass).toBe(before);
  });
});

describe("a cast with nothing to roll", () => {
  it("casts a Hat of Disguise's Disguise Self at will", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("hat-of-disguise", { attuned: true }));
    const cast = actionOf(table, IDS.fighter, "item-hat-of-disguise-cast-disguise-self");
    expect(cast.uses).toBeUndefined();
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, cast.id, [], { targetIds: [] });
    expect(table.state.combat.turn.actionUsed).toBe(true);
  });
});

describe("tools", () => {
  it("reads each tool's Utilize uses with their printed DCs", () => {
    const tools = loadEquipment().filter((record) => record.category === "tool");
    expect(tools.filter((record) => toolUses(record.description).length === 0).map((record) => record.id)).toEqual([]);
    expect(toolUses(tools.find((record) => record.id === "thieves-tools")!.description)).toEqual([
      { label: "Pick a lock", dc: 15 },
      { label: "Disarm a trap", dc: 15 }
    ]);
  });

  it("offers a proficient tool's uses on the sheet", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    const derivation = deriveEquipment(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog);
    const sheet = deriveActorSheet(table.actor(IDS.fighter), table.definition(IDS.fighter), derivation, [], catalog);
    expect(sheet.tools.find((tool) => tool.id === "gaming-set-dice")?.uses).toEqual([
      { label: "Discern whether someone is cheating", dc: 10 },
      { label: "Win the game", dc: 20 }
    ]);
  });
});

describe("carrying capacity", () => {
  const speedOf = (table: Table) =>
    currentSpeedFeet(
      table.actor(IDS.fighter),
      deriveEquipment(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog)
    );
  const anvil = { id: "anvil", name: "Anvil", quantity: 1, equipped: false, attuned: false, weightEach: 300 };

  it("weighs rows and coins against Strength times 15, and holds Speed to 5 feet beyond it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    const carrying = deriveEquipment(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog).carrying!;
    expect(carrying.capacity).toBe(19 * 15);
    expect(carrying.pounds).toBeGreaterThan(55);
    expect(speedOf(table)).toBe(30);
    write(table, IDS.fighter, anvil);
    expect(speedOf(table)).toBe(5);
  });

  it("counts a creature with Powerful Build as one size larger", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    const build = [{ modifier: { type: "carrying-capacity-larger" }, label: "Powerful Build" }];
    expect(carryingOf(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog, build)?.capacity).toBe(19 * 30);
  });

  it("keeps the Speed of a creature in Boots of Striding and Springing under any load", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("boots-of-striding-and-springing", { attuned: true }));
    write(table, IDS.fighter, anvil);
    expect(speedOf(table)).toBe(30);
  });
});
