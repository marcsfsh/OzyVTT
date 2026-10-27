import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { giveItem } from "../src/inventory.js";
import { applyRest } from "../src/rests.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
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

// A charged magic item's charges (SRD 5.2.1 Magic Items: Charges): they belong to the item, come back by the
// item's own dice at dawn, and the last one spent can cost the item.

const wand = (over: Parameters<typeof catalogRow>[1] = {}) =>
  catalogRow("wand-of-fireballs", { attuned: true, ...over });
const SECOND = { id: "wand-of-fireballs-2", recordId: "wand-of-fireballs" };
const spent = (table: Table, actorId: string, key: string) => table.actor(actorId).actionUses[key] ?? 0;

describe("a charged item counts its own charges", () => {
  it("gives two Wands of Fireballs a pool each, so firing one leaves the other full", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    // One copy of an item can be attuned at a time, so the second wand is the one in use.
    write(table, IDS.wizard, wand({ attuned: false }));
    write(table, IDS.wizard, wand(SECOND));
    expect(actionOf(table, IDS.wizard, "item-wand-of-fireballs-2-cast-fireball").uses?.pool).toBe(
      "wand-of-fireballs-2-charges"
    );
    expect(() => write(table, IDS.wizard, edit(table, IDS.wizard, "wand-of-fireballs", { attuned: true }))).toThrow(
      /more than one copy/
    );

    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-wand-of-fireballs-2-cast-fireball", [3, 3, 3, 3, 3, 3, 3, 3]);
    expect(spent(table, IDS.wizard, "wand-of-fireballs-2-charges")).toBe(1);
    expect(spent(table, IDS.wizard, "wand-of-fireballs-charges")).toBe(0);
  });

  it("forgets a removed wand's spent charges, so a new one starts full", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, wand());
    table.actor(IDS.wizard).actionUses = { "wand-of-fireballs-charges": 7 };
    write(table, IDS.wizard, edit(table, IDS.wizard, "wand-of-fireballs", { quantity: 0 }));
    expect(table.actor(IDS.wizard).actionUses).toEqual({});
  });
});

describe("a Long Rest gives charges back by the item's own dice", () => {
  it("rolls 1d6 + 1 for a Wand of Fireballs and 1d3 for a Wand of Magic Detection, and refills the rest", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, wand());
    write(table, IDS.wizard, catalogRow("wand-of-magic-detection"));
    table.actor(IDS.wizard).actionUses = {
      "wand-of-fireballs-charges": 6,
      "wand-of-magic-detection-charges": 1,
      "arcane-recovery": 1
    };
    const faces = [2, 3]; // 1d6 + 1 = 3 of 6 spent; 1d3 = 3 of 1 spent
    const lines: string[] = [];
    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog, { random: () => faces.shift()!, lines });
    expect(table.actor(IDS.wizard).actionUses).toEqual({ "wand-of-fireballs-charges": 3 });
    expect(lines).toEqual([
      "Wand of Fireballs regains 3 expended charges (1d6 + 1).",
      "Wand of Magic Detection regains 1 expended charge (1d3)."
    ]);
  });
});

describe("handing an item over", () => {
  it("moves the row unequipped and unattuned, with its spent charges, beside the new holder's own copy", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, wand());
    write(table, IDS.fighter, wand({ equipped: false, attuned: false }));
    table.actor(IDS.wizard).actionUses = { "wand-of-fireballs-charges": 3 };
    table.actor(IDS.fighter).actionUses = { "wand-of-fireballs-charges": 1 };

    giveItem(table.state, IDS.wizard, IDS.fighter, "wand-of-fireballs", table.resolve, { catalog, role: "gm" });
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "wand-of-fireballs")).toBe(false);
    expect(table.actor(IDS.wizard).actionUses).toEqual({});
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "wand-of-fireballs-2")).toMatchObject({
      name: "Wand of Fireballs",
      recordId: "wand-of-fireballs",
      equipped: false,
      attuned: false
    });
    expect(table.actor(IDS.fighter).actionUses).toEqual({
      "wand-of-fireballs-charges": 1,
      "wand-of-fireballs-2-charges": 3
    });
  });
});

describe("the charge commands over HTTP", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const boot = async (table: Table) => {
    const served = await serve(table);
    cleanups.push(served.close);
    return served;
  };

  it("rolls the d20 when a loose use spends a wand's last charge, and not for a wand that has none to roll", async () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("wand-of-enemy-detection", { attuned: true }));
    write(table, IDS.wizard, catalogRow("wand-of-secrets"));
    table.actor(IDS.wizard).actionUses = { "wand-of-enemy-detection-charges": 6, "wand-of-secrets-charges": 2 };
    const { server, gmToken, post, log } = await boot(table);
    const use = (actionId: string) =>
      post(GAME_PATHS.actionUse, gmToken, { commandId: randomUUID(), actorId: IDS.wizard, actionId });

    expect((await use("item-wand-of-secrets-find-secrets")).status).toBe(200);
    expect(server.store.snapshot.rolls).toEqual([]);

    expect((await use("item-wand-of-enemy-detection-detect-enemies")).status).toBe(200);
    expect(server.store.snapshot.rolls).toHaveLength(1);
    // Its sense is an effect on its holder, so the use resolves as the action does in a fight and labels the roll so.
    expect(server.store.snapshot.rolls[0]).toMatchObject({
      label: "Detect Enemies",
      formula: "1d20",
      actorId: IDS.wizard
    });
    expect((await log()).some((text) => text.includes("Wand of Enemy Detection's last charge is spent"))).toBe(true);
  });

  it("lets the GM hand a wand over, and refuses a player", async () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, wand());
    const { server, gmToken, post, log } = await boot(table);
    const give = (token: string) =>
      post(GAME_PATHS.characterGiveItem.replace("{actorId}", IDS.wizard), token, {
        toActorId: IDS.fighter,
        itemId: "wand-of-fireballs"
      });

    expect((await give(server.auth.issuePlayerSession())).status).toBe(403);
    expect((await give(gmToken)).status).toBeLessThan(300);
    const holder = server.store.snapshot.actors.find((actor) => actor.id === IDS.fighter)!;
    expect(holder.inventory.some((row) => row.id === "wand-of-fireballs")).toBe(true);
    expect(await log()).toContain("Ilyana hands Wand of Fireballs to Borin.");
  });
});
