import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { effectiveActions } from "../src/effective-actions.js";
import { setItemLight } from "../src/item-light.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  serve,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 magic items whose last charge ends them: the d20's 1 that crumbles a wand, turns a Staff of Striking into a
// Quarterstaff or leaves a Staff of Power only its +2, and a pool that leaves the item nonmagical once it is spent (a
// Gem of Brightness, a Ring of Three Wishes), in a fight and on the loose route outside one.

const row = (table: Table, actorId: string, id: string) =>
  table.actor(actorId).inventory.find((item) => item.id === id);
const ids = (table: Table, actorId: string) =>
  effectiveActions(table.definition(actorId), table.actor(actorId), catalog).map((action) => action.id);

describe("the last charge's d20", () => {
  it("leaves a Staff of Striking a nonmagical Quarterstaff on a 1", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("staff-of-striking", { attuned: true }), "gm");
    table.actor(IDS.fighter).actionUses = { "staff-of-striking-charges": 9 };
    fight(table, IDS.fighter);
    // A hit, the Quarterstaff's d6, the charge's d6, then the last charge's d20 at 1.
    const hit = resolveAt(table, IDS.fighter, "item-staff-of-striking", [17, 3, 2, 1], {
      hitOptions: [{ id: "item-staff-of-striking-striking-1" }]
    });
    expect(hit.warnings?.join(" ")).toMatch(/Staff of Striking loses its magic and is a Quarterstaff now/);
    expect(row(table, IDS.fighter, "staff-of-striking")).toMatchObject({
      name: "Quarterstaff",
      recordId: "quarterstaff",
      attuned: false
    });
    expect(table.actor(IDS.fighter).actionUses["staff-of-striking-charges"]).toBeUndefined();
  });

  it("crumbles a Wand of Paralysis and a Wand of Wonder on a 1", () => {
    for (const [id, actionId] of [
      ["wand-of-paralysis", "item-wand-of-paralysis-paralyzing-ray"],
      ["wand-of-wonder", "item-wand-of-wonder-wild-surge"]
    ] as const) {
      const table = tableOf({ [IDS.wizard]: wizardInput() });
      write(table, IDS.wizard, catalogRow(id, { attuned: true }));
      table.actor(IDS.wizard).actionUses = { [`${id}-charges`]: 6 };
      fight(table, IDS.wizard);
      // The Wand of Wonder's charge still rolls its table (62: grass the GM settles).
      const used = resolveAt(table, IDS.wizard, actionId, [1, 62]);
      expect(used.warnings?.join(" "), id).toMatch(/is destroyed/);
      expect(row(table, IDS.wizard, id), id).toBeUndefined();
    }
  });

  it("keeps a Wand of Paralysis on any other face", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("wand-of-paralysis", { attuned: true }));
    table.actor(IDS.wizard).actionUses = { "wand-of-paralysis-charges": 6 };
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-wand-of-paralysis-paralyzing-ray", [2]);
    expect(row(table, IDS.wizard, "wand-of-paralysis")).toBeDefined();
  });

  it("leaves a Staff of Power a +2 Quarterstaff with no spells on a 1", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("staff-of-power", { attuned: true }));
    table.actor(IDS.wizard).actionUses = { "staff-of-power-charges": 19 };
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-staff-of-power-cast-magic-missile", [3, 3, 3, 1], {
      targetIds: [IDS.foe, IDS.foe, IDS.foe]
    });
    expect(row(table, IDS.wizard, "staff-of-power")).toMatchObject({
      name: "Weapon, +2 (Quarterstaff)",
      recordId: "weapon-2",
      baseId: "quarterstaff"
    });
    expect(ids(table, IDS.wizard).filter((id) => id.startsWith("item-staff-of-power-cast-"))).toEqual([]);
    // Dexterity 14 is no better than Strength 10 for a Quarterstaff: Strength's +0, the Proficiency Bonus and the +2.
    expect(actionOf(table, IDS.wizard, "item-staff-of-power").attack?.bonus).toBe(0 + 2 + 2);
  });
});

describe("a pool whose last use ends the item's magic", () => {
  it("leaves a Gem of Brightness a plain jewel after its 50th charge, which no longer lights", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("gem-of-brightness"));
    table.actor(IDS.wizard).actionUses = { "gem-of-brightness-charges": 49 };
    fight(table, IDS.wizard);
    const beam = resolveAt(table, IDS.wizard, "item-gem-of-brightness-beam", []);
    expect(beam.warnings?.join(" ")).toMatch(/Gem of Brightness loses its magic/);
    expect(row(table, IDS.wizard, "gem-of-brightness")).toMatchObject({ dormant: true });
    expect(ids(table, IDS.wizard).filter((id) => id.startsWith("item-gem-of-brightness"))).toEqual([]);
    expect(() =>
      setItemLight(
        table.state,
        { actorId: IDS.wizard, itemId: "gem-of-brightness", lit: true },
        { role: "gm" },
        catalog
      )
    ).toThrow(/has lost its magic/);
  });

  it("leaves a Ring of Three Wishes nonmagical after its third Wish", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("ring-of-three-wishes"));
    table.actor(IDS.wizard).actionUses = { "ring-of-three-wishes-charges": 2 };
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-ring-of-three-wishes-cast-wish", [], { targetIds: [] });
    expect(row(table, IDS.wizard, "ring-of-three-wishes")).toMatchObject({ dormant: true });
  });
});

describe("the last charge on the loose route", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("ends a Gem of Brightness's magic outside an encounter too", async () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("gem-of-brightness"));
    table.actor(IDS.wizard).actionUses = { "gem-of-brightness-charges": 49 };
    const served = await serve(table);
    cleanups.push(served.close);
    const used = await served.post(GAME_PATHS.actionUse, served.gmToken, {
      commandId: randomUUID(),
      actorId: IDS.wizard,
      actionId: "item-gem-of-brightness-beam"
    });
    expect(used.status).toBe(200);
    const wizard = served.server.store.snapshot.actors.find((actor) => actor.id === IDS.wizard)!;
    expect(wizard.inventory.find((item) => item.id === "gem-of-brightness")).toMatchObject({ dormant: true });
    expect((await served.log()).some((text) => text.includes("Gem of Brightness loses its magic."))).toBe(true);
  });
});
