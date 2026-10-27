import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { InventoryItem } from "@vtt/schemas";
import { setInventoryItem } from "../src/inventory.js";
import { answerSave } from "../src/saving-throws.js";
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
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 Attunement: "a creature must spend a Short Rest focused on only that item", "a creature can't attune to
// more than one copy of an item", and an item that "requires attunement by" a class, a species or a spellcaster is
// attuned only by one. Ending attunement on purpose takes "another Short Rest focused on the item".

const asPlayer = (table: Table, actorId: string, item: InventoryItem) =>
  setInventoryItem(table.state, actorId, item, table.resolve, { catalog, role: "player" });
const resting = (table: Table, actorId: string) => {
  table.state.rest = { ...table.state.rest, shortRest: { actorIds: [actorId], done: [] } };
};

describe("attuning takes a Short Rest", () => {
  it("refuses a player who attunes outside one, and lets them during one", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    asPlayer(table, IDS.fighter, catalogRow("cloak-of-protection"));
    expect(() =>
      asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { attuned: true }))
    ).toThrow("Attuning to Cloak of Protection takes a Short Rest focused on it. Start a Short Rest, then attune.");
    resting(table, IDS.fighter);
    asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { attuned: true }));
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "cloak-of-protection")?.attuned).toBe(true);
  });

  it("asks for a Short Rest to end it, and lets the GM attune or end it at any time", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    setInventoryItem(table.state, IDS.fighter, catalogRow("cloak-of-protection", { attuned: true }), table.resolve, {
      catalog,
      role: "gm"
    });
    expect(() =>
      asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { attuned: false }))
    ).toThrow(/Ending attunement to Cloak of Protection takes a Short Rest/);
    // Taking it off or putting it in the pack needs no rest: it stays attuned.
    asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { equipped: false }));
    setInventoryItem(
      table.state,
      IDS.fighter,
      edit(table, IDS.fighter, "cloak-of-protection", { attuned: false }),
      table.resolve,
      { catalog, role: "gm" }
    );
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "cloak-of-protection")?.attuned).toBe(false);
  });

  it("counts the step a finished rest opens as part of it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    table.actor(IDS.fighter).restStep = { after: "short-rest" };
    asPlayer(table, IDS.fighter, catalogRow("cloak-of-protection", { attuned: true }));
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "cloak-of-protection")?.attuned).toBe(true);
  });
});

describe("an item's attunement prerequisites", () => {
  it("keeps a Holy Avenger from a Fighter, and a wand from a creature that casts no spells", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    resting(table, IDS.fighter);
    expect(() =>
      asPlayer(table, IDS.fighter, catalogRow("holy-avenger", { baseId: "longsword", attuned: true }))
    ).toThrow("Holy Avenger requires attunement by a Paladin.");
    expect(() => asPlayer(table, IDS.fighter, catalogRow("wand-of-web", { attuned: true }))).toThrow(
      "Wand of Web requires attunement by a Spellcaster."
    );
    resting(table, IDS.wizard);
    asPlayer(table, IDS.wizard, catalogRow("wand-of-web", { attuned: true }));
    expect(table.actor(IDS.wizard).inventory.find((row) => row.id === "wand-of-web")?.attuned).toBe(true);
  });

  it("lets a creature attuned to a Belt of Dwarvenkind attune to a Dwarven Thrower", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    resting(table, IDS.fighter);
    const thrower = catalogRow("dwarven-thrower", { baseId: "warhammer", attuned: true });
    expect(() => asPlayer(table, IDS.fighter, thrower)).toThrow(
      "Dwarven Thrower requires attunement by a Dwarf or a creature attuned to a Belt of Dwarvenkind."
    );
    asPlayer(table, IDS.fighter, catalogRow("belt-of-dwarvenkind", { attuned: true }));
    asPlayer(table, IDS.fighter, thrower);
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "dwarven-thrower")?.attuned).toBe(true);
  });

  it("lets the GM attune anyone to anything", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    setInventoryItem(
      table.state,
      IDS.fighter,
      catalogRow("holy-avenger", { baseId: "longsword", attuned: true }),
      table.resolve,
      { catalog, role: "gm" }
    );
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "holy-avenger")?.attuned).toBe(true);
  });
});

// SRD Dragon Orb: peering is a DC 15 Charisma save. A failure Charms the user "for as long as you remain attuned to
// it", and "while you are Charmed by the orb, you can't voluntarily end your Attunement to it".
describe("a Dragon Orb", () => {
  const peer = (table: Table, face: number) => {
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-dragon-orb-peer", [], { targetIds: [IDS.fighter] });
    const pending = table.state.combat.pendingSaves.find((entry) => entry.targetActorId === IDS.fighter)!;
    expect(pending).toMatchObject({ ability: "cha", dc: 15 });
    answerSave(
      table.state,
      randomUUID(),
      pending.id,
      "roll",
      undefined,
      true,
      { role: "gm" },
      {
        random: () => face,
        newRollId: () => randomUUID(),
        sessionId: randomUUID(),
        role: "gm",
        now: () => "2026-10-19T00:00:00.000Z",
        resolveDefinition: table.resolve
      }
    );
  };
  const orbOf = (table: Table) => table.actor(IDS.fighter).inventory.find((row) => row.id === "dragon-orb");
  const tagged = (table: Table, tag: string) =>
    table.actor(IDS.fighter).effects.some((effect) => effect.tags.includes(tag));
  const attuned = (table: Table) =>
    setInventoryItem(table.state, IDS.fighter, catalogRow("dragon-orb", { attuned: true }), table.resolve, {
      catalog,
      role: "gm"
    });

  it("keeps a charmed user attuned until the GM ends it, which ends the charm", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    attuned(table);
    peer(table, 2);
    expect(tagged(table, "dragon-orb-charmed")).toBe(true);
    const charmed = () => table.actor(IDS.fighter).conditions.some((condition) => condition.id === "charmed");
    expect(charmed()).toBe(true);
    resting(table, IDS.fighter);
    expect(() => asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "dragon-orb", { attuned: false }))).toThrow(
      "Dragon Orb holds Borin Charmed, so Borin can't end attunement to it."
    );
    // Putting it down doesn't end it either: the charm lasts while the attunement does.
    asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "dragon-orb", { equipped: false }));
    expect(tagged(table, "dragon-orb-charmed")).toBe(true);
    setInventoryItem(
      table.state,
      IDS.fighter,
      edit(table, IDS.fighter, "dragon-orb", { attuned: false }),
      table.resolve,
      {
        catalog,
        role: "gm"
      }
    );
    expect(orbOf(table)?.attuned).toBe(false);
    expect(tagged(table, "dragon-orb-charmed")).toBe(false);
    expect(charmed()).toBe(false);
  });

  it("casts its spells only for a user who controls it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    attuned(table);
    expect(actionOf(table, IDS.fighter, "item-dragon-orb-cast-daylight").requiresEffectTag).toBe("dragon-orb-control");
    expect(actionOf(table, IDS.fighter, "item-dragon-orb-call-dragons").requiresEffectTag).toBe("dragon-orb-control");
    fight(table, IDS.fighter);
    expect(() => resolveAt(table, IDS.fighter, "item-dragon-orb-cast-detect-magic", [], { targetIds: [] })).toThrow(
      "Cast Detect Magic (Dragon Orb) requires an active Dragon Orb Control effect."
    );
  });

  it("gives control to a user who saves, whose attunement ends with a Short Rest as any other", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    attuned(table);
    peer(table, 18);
    expect(tagged(table, "dragon-orb-control")).toBe(true);
    expect(tagged(table, "dragon-orb-charmed")).toBe(false);
    resting(table, IDS.fighter);
    asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "dragon-orb", { attuned: false }));
    expect(tagged(table, "dragon-orb-control")).toBe(false);
  });
});
