import { describe, expect, it } from "vitest";
import { passTime, spendHitDice } from "../src/rests.js";
import { setSurvivalTracking } from "../src/survival.js";
import {
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

// Healing on the game clock and Hit Point Dice at their best (SRD 5.2.1): a Ring of Regeneration's "1d6 Hit Points every
// 10 minutes if you have at least 1 Hit Point", an Ioun Stone of Regeneration's "15 Hit Points at the end of each hour",
// a Rod of Security's demiplane ("For each hour spent in the demiplane, a visitor regains Hit Points as if it had spent
// 1 Hit Point Die", for "200 days divided by the number of creatures present"), a Potion of Vitality's "you regain the
// maximum number of Hit Points for any Hit Point Die you spend", and an Ioun Stone of Sustenance's food and water.

const GM = { role: "gm" } as const;
const pass = (table: Table, hours: number, minutes: number, faces: number[] = []) =>
  passTime(table.state, hours, minutes, {
    random: () => faces.shift() ?? 4,
    resolveDefinition: table.resolve,
    catalog
  });

function hurt(table: Table, actorId: string, current: number): void {
  table.actor(actorId).hp = { ...table.actor(actorId).hp, current };
}

describe("a Ring of Regeneration", () => {
  it("heals 1d6 every 10 minutes the clock passes while its wearer has at least 1 Hit Point", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("ring-of-regeneration", { attuned: true }), "gm");
    hurt(table, IDS.wizard, 5);
    pass(table, 0, 30, [3, 4, 2]);
    expect(table.actor(IDS.wizard).hp.current).toBe(5 + 3 + 4 + 2);
  });

  it("heals nothing at 0 Hit Points", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("ring-of-regeneration", { attuned: true }), "gm");
    hurt(table, IDS.wizard, 0);
    pass(table, 1, 0);
    expect(table.actor(IDS.wizard).hp.current).toBe(0);
  });
});

describe("an Ioun Stone of Regeneration", () => {
  it("heals 15 at the end of each hour, and nothing before it ends", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("ioun-stone", { attuned: true, variantId: "regeneration" }), "gm");
    hurt(table, IDS.fighter, 10);
    pass(table, 0, 59);
    expect(table.actor(IDS.fighter).hp.current).toBe(10);
    pass(table, 0, 1);
    expect(table.actor(IDS.fighter).hp.current).toBe(25);
  });
});

describe("an Ioun Stone of Sustenance", () => {
  it("keeps its wearer from hunger and thirst as days end", () => {
    const starve = (stone: boolean) => {
      const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
      if (stone) write(table, IDS.wizard, catalogRow("ioun-stone", { attuned: true, variantId: "sustenance" }), "gm");
      table.actor(IDS.wizard).inventory = table
        .actor(IDS.wizard)
        .inventory.filter((row) => !/ration|waterskin/.test(row.id));
      setSurvivalTracking(table.state, true, GM);
      pass(table, 24 * 6, 0, Array(100).fill(1));
      return table.actor(IDS.wizard).conditions.some((condition) => condition.id === "exhaustion");
    };
    expect(starve(false)).toBe(true);
    expect(starve(true)).toBe(false);
  });
});

describe("a Rod of Security", () => {
  it("heals each visitor a Hit Point Die's worth each hour, for 200 days shared among them", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.fighter, catalogRow("rod-of-security"), "gm");
    resolveAt(table, IDS.fighter, "item-rod-of-security-demiplane", [], { targetIds: [IDS.wizard] });
    const visit = table.actor(IDS.wizard).effects.find((effect) => effect.tags.includes("rod-of-security"));
    expect(visit?.duration).toEqual({ type: "minutes", remaining: 100 * 24 * 60 });
    hurt(table, IDS.wizard, 3);
    pass(table, 1, 0, [5]);
    // A wizard's d6 at 5, with Constitution 14 (+2).
    expect(table.actor(IDS.wizard).hp.current).toBe(3 + 5 + 2);
    pass(table, 100 * 24, 0);
    expect(table.actor(IDS.wizard).effects.some((effect) => effect.tags.includes("rod-of-security"))).toBe(false);
  });
});

describe("a Potion of Vitality", () => {
  it("makes each Hit Point Die spent restore its maximum for 24 hours", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("potion-of-vitality", { equipped: false }), "gm");
    resolveAt(table, IDS.fighter, "item-potion-of-vitality-drink", [], { targetIds: [IDS.fighter] });
    hurt(table, IDS.fighter, 10);
    // A Fighter's d10 rolled as 1, counted as 10, with Constitution 15 (+2).
    const spent = spendHitDice(table.state, IDS.fighter, [1], GM, table.resolve, 1, catalog);
    expect(spent.healed).toBe(12);
    pass(table, 25, 0);
    hurt(table, IDS.fighter, 10);
    expect(spendHitDice(table.state, IDS.fighter, [1], GM, table.resolve, 1, catalog).healed).toBe(3);
  });
});
