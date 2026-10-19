import { describe, expect, it } from "vitest";
import { setCondition } from "../src/actor-conditions.js";
import { builtinActionsFor } from "../src/builtin-actions.js";
import { makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 Adventuring Gear and Magic Items: a binding lands only after its check, and each effect offers every way
// out its text prints (escaping, bursting, picking the lock, breaking free), with what a failed try costs.

/** A fight between the Fighter and the Wizard (and the foe), with `turn` taking its turn. */
function fightOf(table: Table, turn: string): void {
  startEncounter(
    table.state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.fighter, score: 20 },
        { actorId: IDS.wizard, score: 15 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    table.resolve,
    Date.now(),
    catalog
  );
  onTurn(table, turn);
}

function onTurn(table: Table, actorId: string): void {
  table.state.combat = {
    ...table.state.combat,
    turnActorId: actorId,
    turn: { ...table.state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
}

const named = (table: Table, actorId: string, name: string) =>
  table.actor(actorId).effects.find((effect) => effect.name.startsWith(name));

function twoOfThem(): Table {
  const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
  setCondition(table.state, IDS.wizard, "grappled", true, undefined, { role: "gm" });
  return table;
}

describe("binding with a Chain", () => {
  it("does nothing when the DC 13 Strength (Athletics) check fails, and spends the action", () => {
    const table = twoOfThem();
    write(table, IDS.fighter, catalogRow("chain"));
    fightOf(table, IDS.fighter);
    // Athletics +7 with Remarkable Athlete's Advantage: a pair of 2s totals 9.
    const result = resolveAt(table, IDS.fighter, "item-chain-bind", [2, 2], { targetIds: [IDS.wizard] });
    expect(named(table, IDS.wizard, "Bound by a Chain")).toBeUndefined();
    expect(table.state.combat.turn.actionUsed).toBe(true);
    expect(result.check).toMatchObject({ dc: 13, success: false });
  });

  it("binds on a success and offers the escape and the DC 20 burst, each ending it", () => {
    const table = twoOfThem();
    write(table, IDS.fighter, catalogRow("chain"));
    fightOf(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-chain-bind", [10, 10], { targetIds: [IDS.wizard] });
    const bound = named(table, IDS.wizard, "Bound by a Chain")!;
    expect(table.actor(IDS.wizard).conditions.map((condition) => condition.id)).toContain("restrained");
    const offered = builtinActionsFor(table.definition(IDS.wizard), table.actor(IDS.wizard)).map((action) => action.id);
    expect(offered).toEqual(expect.arrayContaining(["end-effect", "ended-by-burst-the-chain"]));
    expect(bound.endAction).toMatchObject({ skill: "acrobatics", dc: 18 });

    onTurn(table, IDS.wizard);
    // Str 10: +0. A 19 misses DC 20; a 20 bursts it.
    resolveAt(table, IDS.wizard, "ended-by-burst-the-chain", [19], { targetIds: [] });
    expect(named(table, IDS.wizard, "Bound by a Chain")).toBeDefined();
    onTurn(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "ended-by-burst-the-chain", [20], { targetIds: [] });
    expect(named(table, IDS.wizard, "Bound by a Chain")).toBeUndefined();
    expect(table.actor(IDS.wizard).conditions.map((condition) => condition.id)).not.toContain("restrained");
  });
});

describe("binding with Manacles", () => {
  it("rolls the DC 13 Sleight of Hand check, and fixed in place adds Restrained", () => {
    const table = twoOfThem();
    write(table, IDS.fighter, catalogRow("manacles"));
    fightOf(table, IDS.fighter);
    // Dex 13: +1. A 12 totals 13.
    resolveAt(table, IDS.fighter, "item-manacles-bind", [12], { targetIds: [IDS.wizard], optionId: "fixed" });
    const bound = named(table, IDS.wizard, "Bound by Manacles")!;
    expect(bound.name).toBe("Bound by Manacles (Fixed in place)");
    expect(bound.linkedConditionIds).toContain("restrained");
  });

  it("leaves a creature unrestrained when the Manacles aren't fixed", () => {
    const table = twoOfThem();
    setCondition(table.state, IDS.wizard, "grappled", false, undefined, { role: "gm" });
    setCondition(table.state, IDS.wizard, "incapacitated", true, undefined, { role: "gm" });
    write(table, IDS.fighter, catalogRow("manacles"));
    fightOf(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-manacles-bind", [15], { targetIds: [IDS.wizard], optionId: "loose" });
    expect(named(table, IDS.wizard, "Bound by Manacles")!.linkedConditionIds).not.toContain("restrained");
  });

  it("lets a creature with Thieves' Tools pick the lock at DC 15, and the bearer burst them at DC 25", () => {
    const table = twoOfThem();
    write(table, IDS.fighter, catalogRow("manacles"));
    fightOf(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-manacles-bind", [15], { targetIds: [IDS.wizard], optionId: "loose" });
    const offered = builtinActionsFor(table.definition(IDS.wizard), table.actor(IDS.wizard)).map((action) => action.id);
    expect(offered).toContain("ended-by-burst-the-manacles");
    expect(offered).not.toContain("ended-by-pick-the-manacles-lock");

    onTurn(table, IDS.fighter);
    expect(() =>
      resolveAt(table, IDS.fighter, "end-an-effect", [20], {
        targetIds: [IDS.wizard],
        optionId: "pick-the-manacles-lock"
      })
    ).toThrow(/Thieves' Tools/);
    write(table, IDS.fighter, catalogRow("thieves-tools", { equipped: false }));
    onTurn(table, IDS.fighter);
    // Dex +1, not proficient with the tools: 14 totals 15.
    resolveAt(table, IDS.fighter, "end-an-effect", [14], {
      targetIds: [IDS.wizard],
      optionId: "pick-the-manacles-lock"
    });
    expect(named(table, IDS.wizard, "Bound by Manacles")).toBeUndefined();
  });
});

describe("a Rope binding", () => {
  it("offers the DC 20 Strength (Athletics) burst beside the DC 15 escape", () => {
    const table = twoOfThem();
    write(table, IDS.fighter, catalogRow("rope"));
    fightOf(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-rope-bind", [], { targetIds: [IDS.wizard] });
    const offered = builtinActionsFor(table.definition(IDS.wizard), table.actor(IDS.wizard));
    expect(offered.find((action) => action.id === "ended-by-burst-the-rope")?.description).toMatch(
      /DC 20 Strength \(Athletics\)/
    );
    expect(named(table, IDS.wizard, "Bound by a Rope")!.endAction).toMatchObject({ dc: 15, skill: "acrobatics" });
  });

  it("ties a knot as a DC 10 Dexterity (Sleight of Hand) Utilize use", () => {
    expect(catalog.equipmentRecord("rope")?.utilize).toEqual([
      { label: "Tie a knot", ability: "dex", skill: "sleight-of-hand", dc: 10 }
    ]);
  });
});

describe("a Hunting Trap's hold", () => {
  it("deals its catch 1 Piercing on each failed check, and a creature beside it frees it on a success", () => {
    const table = twoOfThem();
    const save = catalog.equipmentRecord("hunting-trap")!.actions[0]!.save!;
    // The hold a failed save leaves (zone-commands.test.ts walks a creature into the trap).
    table
      .actor(IDS.wizard)
      .effects.push(
        makeEffect({ id: "trap", name: "Hunting Trap", duration: { type: "manual" }, speedZero: true, endedBy: save.endedBy! })
      );
    fightOf(table, IDS.fighter);
    const before = table.actor(IDS.wizard).hp.current;
    // Athletics +7 with Advantage: a pair of 2s totals 9.
    resolveAt(table, IDS.fighter, "end-an-effect", [2, 2], { targetIds: [IDS.wizard] }, 5);
    expect(table.actor(IDS.wizard).hp.current).toBe(before - 1);
    expect(named(table, IDS.wizard, "Hunting Trap")).toBeDefined();
    onTurn(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "end-an-effect", [10, 10], { targetIds: [IDS.wizard] }, 5);
    expect(named(table, IDS.wizard, "Hunting Trap")).toBeUndefined();
  });

  it("can't be freed by a creature out of reach", () => {
    const table = twoOfThem();
    const save = catalog.equipmentRecord("hunting-trap")!.actions[0]!.save!;
    table
      .actor(IDS.wizard)
      .effects.push(
        makeEffect({ id: "trap", name: "Hunting Trap", duration: { type: "manual" }, speedZero: true, endedBy: save.endedBy! })
      );
    fightOf(table, IDS.fighter);
    expect(() => resolveAt(table, IDS.fighter, "end-an-effect", [12], { targetIds: [IDS.wizard] }, 15)).toThrow();
  });
});

describe("a Net", () => {
  it("lets a creature within 5 feet of the netted one make the DC 10 Strength (Athletics) check as its action", () => {
    const table = twoOfThem();
    setCondition(table.state, IDS.wizard, "grappled", false, undefined, { role: "gm" });
    write(table, IDS.fighter, catalogRow("net", { equipped: false, quantity: 2 }));
    fightOf(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-net-throw", [], { targetIds: [IDS.wizard] });
    const pending = table.state.combat.pendingSaves.find((entry) => entry.targetActorId === IDS.wizard)!;
    expect(pending.onFailEffect?.endedBy).toMatchObject({ by: "others", check: { dc: 10, skill: "athletics" } });
  });
});

describe("Iron Bands", () => {
  function banded(): Table {
    const table = twoOfThem();
    write(table, IDS.fighter, catalogRow("iron-bands", { equipped: true }));
    fightOf(table, IDS.fighter);
    // Dex +1, Proficiency +3 against AC 10 (the Wizard's own AC is higher than 10 + 2).
    resolveAt(table, IDS.fighter, "item-iron-bands-throw", [18], { targetIds: [IDS.wizard] });
    return table;
  }

  it("Restrains on a hit until its user's Bonus Action command releases the target", () => {
    const table = banded();
    expect(named(table, IDS.wizard, "Iron Bands")?.linkedConditionIds).toContain("restrained");
    resolveAt(table, IDS.fighter, "item-iron-bands-release", [], { targetIds: [] });
    expect(named(table, IDS.wizard, "Iron Bands")).toBeUndefined();
    expect(table.state.combat.turn.bonusActionUsed).toBe(true);
  });

  it("is destroyed by a successful DC 20 Strength (Athletics) check, and a failure fails that creature's later tries", () => {
    const table = banded();
    onTurn(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "ended-by-break-the-iron-bands", [3], { targetIds: [] });
    expect(named(table, IDS.wizard, "Iron Bands")).toBeDefined();
    onTurn(table, IDS.wizard);
    // A natural 20 still fails: the earlier failure locks the Wizard out for 24 hours.
    resolveAt(table, IDS.wizard, "ended-by-break-the-iron-bands", [], { targetIds: [] });
    expect(named(table, IDS.wizard, "Iron Bands")).toBeDefined();
    onTurn(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "end-an-effect", [16, 16], { targetIds: [IDS.wizard] });
    expect(named(table, IDS.wizard, "Iron Bands")).toBeUndefined();
    expect(table.actor(IDS.fighter).inventory.some((row) => row.id === "iron-bands")).toBe(false);
  });
});

describe("a Rope of Entanglement", () => {
  it("lets its user's Bonus Action command release the creature it holds", () => {
    const table = twoOfThem();
    setCondition(table.state, IDS.wizard, "grappled", false, undefined, { role: "gm" });
    write(table, IDS.fighter, catalogRow("rope-of-entanglement", { equipped: true }));
    fightOf(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-rope-of-entanglement-entangle", [], { targetIds: [IDS.wizard] });
    const pending = table.state.combat.pendingSaves.find((entry) => entry.targetActorId === IDS.wizard)!;
    expect(pending.onFailEffect?.heldBy).toMatchObject({ armorClass: 20, regainsEvery: 5 });
    expect(actionOf(table, IDS.fighter, "item-rope-of-entanglement-release")).toMatchObject({
      activation: "bonus-action",
      endsItemEffects: true
    });
  });
});
