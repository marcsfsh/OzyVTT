import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { actionAvailability } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
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

// Potions and flasks (SRD 5.2.1 Adventuring Gear): each use takes one from the stack, and they work from the pack.

const row = (table: Table, id: string) => table.actor(IDS.fighter).inventory.find((entry) => entry.id === id);
/** A fresh turn's action and Bonus Action, so a second use is not refused by the economy under test. */
const newTurn = (table: Table) => {
  table.state.combat.turn = {
    ...table.state.combat.turn,
    actionUsed: false,
    bonusActionUsed: false,
    actionInstance: null,
    bonusActionInstance: null
  };
};

describe("what a player's turn is told about an item's action", () => {
  it("says whom a tap picks: a potion's drinker, a flask's one target, nobody for what acts on its user", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    for (const id of ["potion-of-healing", "acid", "antitoxin"])
      write(table, IDS.wizard, catalogRow(id, { equipped: false }));
    write(table, IDS.wizard, catalogRow("spell-scroll", { equipped: false, spellId: "detect-magic" }));
    const ids = ["item-potion-of-healing-drink", "item-acid-throw", "item-antitoxin-drink", "item-spell-scroll-read"];
    const rows = actionAvailability(
      table.state,
      table.actor(IDS.wizard),
      ids.map((id) => actionOf(table, IDS.wizard, id)),
      table.definition(IDS.wizard),
      false,
      undefined,
      catalog
    );
    expect(rows.map((entry) => [entry.id, entry.targeting, entry.healing])).toEqual([
      ["item-potion-of-healing-drink", "single", { formula: "2d4 + 2" }],
      // "Throw the vial at a creature or object you can see within 20 feet": one target.
      ["item-acid-throw", "single", null],
      ["item-antitoxin-drink", "none", null],
      ["item-spell-scroll-read", "none", null]
    ]);
    // A builtin says what the stat block's list says: Help and a Grapple pick one creature, Dodge nobody.
    const builtins = actionAvailability(
      table.state,
      table.actor(IDS.wizard),
      ["help", "unarmed-grapple", "dodge"].map((id) => builtinAction(id)!),
      table.definition(IDS.wizard),
      true,
      undefined,
      catalog
    );
    expect(builtins.map((entry) => entry.targeting)).toEqual(["single", "single", "none"]);
  });
});

describe("a Potion of Healing", () => {
  it("is drunk from the pack as a Bonus Action, heals 2d4 + 2, and the last one leaves the pack", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("potion-of-healing", { quantity: 2, equipped: false }));
    const fighter = table.actor(IDS.fighter);
    fighter.hp = { ...fighter.hp, current: 10 };
    expect(actionOf(table, IDS.fighter, "item-potion-of-healing-drink")).toMatchObject({
      activation: "bonus-action",
      healing: { formula: "2d4 + 2" }
    });

    fight(table, IDS.fighter);
    const drunk = resolveAt(table, IDS.fighter, "item-potion-of-healing-drink", [3, 4], { targetIds: [IDS.fighter] });
    expect(drunk.healing?.total).toBe(9);
    expect(table.actor(IDS.fighter).hp.current).toBe(19);
    expect(row(table, "potion-of-healing")?.quantity).toBe(1);

    newTurn(table);
    resolveAt(table, IDS.fighter, "item-potion-of-healing-drink", [1, 1], { targetIds: [IDS.fighter] });
    expect(row(table, "potion-of-healing")).toBeUndefined();
    expect(() => actionOf(table, IDS.fighter, "item-potion-of-healing-drink")).toThrow();
  });

  it("comes in the stronger strengths of the magic item table, each healing its own dice", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("potion-of-healing-superior", { equipped: false }));
    expect(actionOf(table, IDS.fighter, "item-potion-of-healing-superior-drink")).toMatchObject({
      activation: "bonus-action",
      healing: { formula: "8d4 + 8" }
    });
    const wizard = table.actor(IDS.wizard);
    wizard.hp = { ...wizard.hp, current: 1 };
    table.state.combat.initiative = [];
    fight(table, IDS.fighter);
    table.state.combat.initiative.push({ ...table.state.combat.initiative[1], actorId: IDS.wizard, score: 5 });
    // Administered to the wizard, within 5 feet: 8d4 + 8, all ones.
    const given = resolveAt(table, IDS.fighter, "item-potion-of-healing-superior-drink", [1, 1, 1, 1, 1, 1, 1, 1], {
      targetIds: [IDS.wizard]
    });
    expect(given.healing).toMatchObject({ total: 16, targets: [{ targetId: IDS.wizard, regained: 16 }] });
    expect(table.actor(IDS.wizard).hp.current).toBe(17);
    expect(row(table, "potion-of-healing-superior")).toBeUndefined();
    expect(table.state.combat.turn.bonusActionUsed).toBe(true);
  });
});

describe("thrown flasks and the Net", () => {
  it("asks for a Dexterity save at 8 + Dex + Proficiency Bonus, and uses the vial up", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("acid", { quantity: 3, equipped: false }));
    fight(table, IDS.fighter);
    // Dex 13 (+1) and PB 3.
    resolveAt(table, IDS.fighter, "item-acid-throw", [5, 6]);
    expect(table.state.combat.pendingSaves[0]).toMatchObject({
      targetActorId: IDS.foe,
      ability: "dex",
      dc: 12,
      proposedDamage: 11,
      halfOnSuccess: false
    });
    expect(row(table, "acid")?.quantity).toBe(2);
  });

  it("restrains on a failed save", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("net", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-net-throw", []);
    expect(table.state.combat.pendingSaves[0]).toMatchObject({ dc: 12, conditionIds: ["restrained"] });
    expect(row(table, "net")).toBeUndefined();
  });
});

describe("a thrown flask in the Attack action", () => {
  const throwIt = (table: Table, faces: number[]) => resolveAt(table, IDS.fighter, "item-acid-throw", faces);

  it("replaces one attack, so Extra Attack leaves the other for a weapon", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("acid", { quantity: 3, equipped: false }));
    expect(actionOf(table, IDS.fighter, "item-acid-throw")).toMatchObject({
      activation: "action",
      replacesAttack: true
    });
    fight(table, IDS.fighter);
    throwIt(table, [5, 6]);
    expect(table.state.combat.turn.actionInstance).toEqual({ actorId: IDS.fighter, components: { attack: 1 } });
    // The greatsword takes the second attack (a natural 1 rolls no damage).
    expect(resolveAt(table, IDS.fighter, "item-greatsword", [1]).attack?.outcome).toBe("fumble");
    expect(() => throwIt(table, [5, 6])).toThrow(/no attacks remaining/);
  });

  it("can be the second attack, after a weapon swing", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("holy-water", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-greatsword", [1]);
    resolveAt(table, IDS.fighter, "item-holy-water-throw", [3, 3]);
    expect(table.state.combat.pendingSaves[0]).toMatchObject({ ability: "dex", proposedDamage: 6 });
    expect(table.state.combat.turn.actionInstance?.components).toEqual({ attack: 0 });
  });

  it("is the whole action for a creature that makes one attack", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("net", { quantity: 2, equipped: false }), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-net-throw", []);
    expect(table.state.combat.turn.actionUsed).toBe(true);
    expect(() => resolveAt(table, IDS.wizard, "item-net-throw", [])).toThrow(/already used an action/);
  });
});

describe("a potion outside an encounter", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("is used up on the loose route too, with its healing rolled for the sheet", async () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("potion-of-healing", { quantity: 2, equipped: false }));
    const { server, gmToken, post, close } = await serve(table);
    cleanups.push(close);
    const used = await post(GAME_PATHS.actionUse, gmToken, {
      commandId: randomUUID(),
      actorId: IDS.fighter,
      actionId: "item-potion-of-healing-drink"
    });
    expect(used.status).toBe(200);
    expect(server.store.snapshot.rolls.map((roll) => [roll.purpose, roll.formula])).toEqual([["healing", "2d4 + 2"]]);
    const potion = server.store.snapshot.actors
      .find((actor) => actor.id === IDS.fighter)!
      .inventory.find((entry) => entry.id === "potion-of-healing");
    expect(potion?.quantity).toBe(1);
  });
});
