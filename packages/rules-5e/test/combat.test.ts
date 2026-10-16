import { describe, expect, it } from "vitest";
import {
  adjustDamageParts,
  aggregateRollMode,
  damageWhileDying,
  droppedToZero,
  halveDamageParts,
  reduceDamageParts,
  resolveDeathSave
} from "../src/combat.js";

describe("adjustDamageParts", () => {
  const defenses = {
    resistances: ["bludgeoning", "piercing", "slashing"],
    immunities: ["poison"],
    vulnerabilities: ["fire"]
  };

  it("halves resisted damage rounding down (17 bludgeoning → 8)", () => {
    expect(adjustDamageParts([{ amount: 17, type: "bludgeoning" }], defenses)).toEqual([
      { type: "bludgeoning", amount: 17, adjusted: 8, adjustment: "resistance" }
    ]);
  });

  it("zeroes immune damage and doubles vulnerable damage", () => {
    const parts = adjustDamageParts(
      [
        { amount: 10, type: "poison" },
        { amount: 6, type: "fire" }
      ],
      defenses
    );
    expect(parts[0]).toMatchObject({ adjusted: 0, adjustment: "immunity" });
    expect(parts[1]).toMatchObject({ adjusted: 12, adjustment: "vulnerability" });
  });

  it("leaves unmatched types alone and matches case-insensitively", () => {
    const parts = adjustDamageParts(
      [
        { amount: 9, type: "Radiant" },
        { amount: 9, type: "Slashing" }
      ],
      defenses
    );
    expect(parts[0]).toMatchObject({ adjusted: 9, adjustment: null });
    expect(parts[1]).toMatchObject({ adjusted: 4, adjustment: "resistance" });
  });

  it("resistance and vulnerability on the same type both apply, halving first (SRD Order of Application)", () => {
    const parts = adjustDamageParts([{ amount: 15, type: "fire" }], {
      resistances: ["fire"],
      immunities: [],
      vulnerabilities: ["fire"]
    });
    // Halved and rounded down to 7, then doubled to 14: not cancelled back to 15.
    expect(parts[0]).toMatchObject({ adjusted: 14, adjustment: "resistance-and-vulnerability" });
  });

  it("resistance to all damage still meets a vulnerability", () => {
    const parts = adjustDamageParts([{ amount: 23, type: "fire" }], {
      resistances: [],
      immunities: [],
      vulnerabilities: ["fire"],
      resistAll: true
    });
    expect(parts[0]).toMatchObject({ adjusted: 22, adjustment: "resistance-and-vulnerability" });
  });
});

describe("reduceDamageParts", () => {
  it("takes a flat reduction off before the defences: the SRD's 28 fire example comes to 22", () => {
    const { parts, reduced } = reduceDamageParts([{ amount: 28, type: "fire" }], [{ amount: 5, types: null }]);
    expect(reduced).toBe(5);
    const adjusted = adjustDamageParts(parts, {
      resistances: [],
      immunities: [],
      vulnerabilities: ["fire"],
      resistAll: true
    });
    expect(adjusted[0].adjusted).toBe(22);
  });

  it("takes each reduction once per hit, largest covered part first, never below 0", () => {
    const { parts, reduced } = reduceDamageParts(
      [
        { amount: 2, type: "slashing" },
        { amount: 6, type: "fire" },
        { amount: 4, type: "piercing" }
      ],
      [{ amount: 5, types: ["slashing", "piercing"] }]
    );
    expect(parts).toEqual([
      { amount: 1, type: "slashing" },
      { amount: 6, type: "fire" },
      { amount: 0, type: "piercing" }
    ]);
    expect(reduced).toBe(5);
    expect(reduceDamageParts([{ amount: 3, type: "fire" }], [{ amount: 10, types: null }]).reduced).toBe(3);
  });
});

describe("halveDamageParts", () => {
  it("halves the total once, so two types lose no extra point to rounding", () => {
    // Ice Storm on a success: 7 bludgeoning and 9 cold is 16, half is 8 (not 3 + 4).
    const halved = halveDamageParts([
      { amount: 7, type: "bludgeoning" },
      { amount: 9, type: "cold" }
    ]);
    expect(halved.reduce((sum, part) => sum + part.amount, 0)).toBe(8);
    expect(halved.map((part) => part.type).sort()).toEqual(["bludgeoning", "cold"]);
  });

  it("drops parts that halve to nothing", () => {
    expect(halveDamageParts([{ amount: 1, type: "fire" }])).toEqual([]);
  });
});

describe("aggregateRollMode", () => {
  const src = (label: string) => ({ source: label, label });

  it("any advantage plus any disadvantage cancels to normal", () => {
    const mode = aggregateRollMode(
      [src("Reckless Attack"), src("Target is Restrained")],
      [src("Attacker is Poisoned")]
    );
    expect(mode.mode).toBe("normal");
    expect(mode.advantage).toEqual(["Reckless Attack", "Target is Restrained"]);
    expect(mode.disadvantage).toEqual(["Attacker is Poisoned"]);
  });

  it("pure advantage and pure disadvantage pass through", () => {
    expect(aggregateRollMode([src("a")], []).mode).toBe("advantage");
    expect(aggregateRollMode([], [src("d")]).mode).toBe("disadvantage");
    expect(aggregateRollMode([], []).mode).toBe("normal");
  });
});

describe("resolveDeathSave", () => {
  const fresh = { successes: 0, failures: 0, stable: false };

  it("natural 20 regains 1 HP and resets the state", () => {
    const roll = resolveDeathSave({ successes: 2, failures: 2, stable: false }, 20);
    expect(roll).toMatchObject({ outcome: "critical-success", regainsOneHitPoint: true, dead: false, state: fresh });
  });

  it("natural 1 counts two failures and can kill outright", () => {
    expect(resolveDeathSave(fresh, 1)).toMatchObject({
      outcome: "critical-failure",
      state: { failures: 2 },
      dead: false
    });
    expect(resolveDeathSave({ successes: 0, failures: 2, stable: false }, 1)).toMatchObject({
      state: { failures: 3 },
      dead: true
    });
  });

  it("10+ is a success; three successes stabilize and reset both counters (SRD)", () => {
    expect(resolveDeathSave(fresh, 10)).toMatchObject({ outcome: "success", state: { successes: 1, stable: false } });
    expect(resolveDeathSave({ successes: 2, failures: 1, stable: false }, 15)).toMatchObject({
      state: { successes: 0, failures: 0, stable: true }
    });
  });

  it("below 10 is a failure; the third kills", () => {
    expect(resolveDeathSave(fresh, 9)).toMatchObject({ outcome: "failure", state: { failures: 1 }, dead: false });
    expect(resolveDeathSave({ successes: 0, failures: 2, stable: false }, 2)).toMatchObject({ dead: true });
  });
});

describe("damageWhileDying", () => {
  const dying = { successes: 1, failures: 1, stable: false };

  it("adds one failure normally, two on a critical hit", () => {
    expect(damageWhileDying(dying, 5, false, 52)).toMatchObject({
      failuresAdded: 1,
      state: { failures: 2 },
      dead: false
    });
    expect(damageWhileDying(dying, 5, true, 52)).toMatchObject({
      failuresAdded: 2,
      state: { failures: 3 },
      dead: true
    });
  });

  it("damage at or above the maximum is instant death and breaks stability", () => {
    expect(damageWhileDying({ successes: 0, failures: 0, stable: true }, 52, false, 52)).toMatchObject({
      dead: true,
      state: { failures: 3, stable: false }
    });
  });

  it("damage soaked by Temporary Hit Points still costs a failure but cannot kill outright", () => {
    // 60 damage, all but 5 absorbed: a failure (damage was taken) but not Massive Damage.
    expect(damageWhileDying(dying, 60, false, 52, 5)).toMatchObject({
      failuresAdded: 1,
      state: { failures: 2 },
      dead: false
    });
    expect(damageWhileDying(dying, 8, false, 52, 0)).toMatchObject({ failuresAdded: 1, dead: false });
  });

  it("damage to a stable character resumes dying from zero failures (counters were reset)", () => {
    expect(damageWhileDying({ successes: 0, failures: 0, stable: true }, 5, false, 52)).toMatchObject({
      failuresAdded: 1,
      state: { failures: 1, stable: false },
      dead: false
    });
  });
});

describe("droppedToZero", () => {
  it("starts dying normally when overflow is below the maximum", () => {
    expect(droppedToZero(10, 52)).toEqual({ instantDeath: false, state: { successes: 0, failures: 0, stable: false } });
  });

  it("kills instantly when remaining damage reaches the maximum", () => {
    expect(droppedToZero(52, 52)).toMatchObject({ instantDeath: true });
  });
});
