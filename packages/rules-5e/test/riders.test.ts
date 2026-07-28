import { describe, expect, it } from "vitest";
import { armorClassFromEquipment, armorWeightOf, collectRiders, effectiveSlot, sumRiders, triggerKind, type RiderCarrier, type RiderContext } from "../src/index.js";

const base: Omit<RiderContext, "moment"> = {
  attunedItemIds: ["ring"], armorWeight: "medium", shieldEquipped: false,
  classIds: ["paladin"], speciesId: "human",
  proficientWeapons: ["martial"], proficientArmor: [], proficientTools: [], proficientSkills: ["stealth"],
  effectTags: ["raging"], hitPointFraction: 0.5, bearerConditionIds: []
};
const carrierOf = (modifiers: RiderCarrier["modifiers"], over: Partial<RiderCarrier> = {}): RiderCarrier[] =>
  [{ label: "Test Item", modifiers, sourceItemId: "ring", ...over }];

describe("triggerKind", () => {
  it("classifies all four kinds, and treats an unknown type as a static gate", () => {
    expect(triggerKind("while-armored")).toBe("static-gate");
    expect(triggerKind("while-effect-tag")).toBe("dynamic-gate");
    expect(triggerKind("on-critical-hit")).toBe("moment");
    expect(triggerKind("versus-size")).toBe("filter");
    expect(triggerKind("while-mounted")).toBe("static-gate");
  });
});

describe("collectRiders: the two passes", () => {
  it("returns un-gated riders in the standing pass and withholds them from a moment pass", () => {
    const carriers = carrierOf([{ type: "armor-class", amount: 1 }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(1);
    expect(collectRiders(carriers, { ...base, moment: "on-attack-roll", sourceItemId: "ring" })).toHaveLength(0);
  });

  it("withholds a rider naming a moment from the standing pass - the two sets are disjoint", () => {
    const carriers = carrierOf([{ type: "extra-damage", formula: "1d6", damageType: "fire", when: [{ type: "on-critical-hit" }] }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(0);
    expect(collectRiders(carriers, { ...base, moment: "on-critical-hit", sourceItemId: "ring" })).toHaveLength(1);
    expect(collectRiders(carriers, { ...base, moment: "on-hit", sourceItemId: "ring" })).toHaveLength(0);
  });

  it("never lets a filter leak into the standing pass and become 'always'", () => {
    // A filter with no moment is an authoring mistake the publish validator rejects; here it must
    // simply never match, rather than quietly applying at every read.
    const carriers = carrierOf([{ type: "attack-bonus", amount: 2, when: [{ type: "versus-size", sizes: ["large"] }] }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring", targetSize: "large" })).toHaveLength(0);
  });
});

describe("collectRiders: gates fail closed", () => {
  it("requires every trigger in the AND-list to pass", () => {
    const carriers = carrierOf([{ type: "attack-bonus", amount: 1, when: [{ type: "while-armored" }, { type: "while-character-is", classIds: ["paladin"] }] }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(1);
    expect(collectRiders(carriers, { ...base, armorWeight: null, moment: null, sourceItemId: "ring" })).toHaveLength(0);
    expect(collectRiders(carriers, { ...base, classIds: ["wizard"], moment: null, sourceItemId: "ring" })).toHaveLength(0);
  });

  it("refuses a trigger the engine cannot evaluate rather than treating it as satisfied", () => {
    // "while mounted" has no world-state system behind it. Failing OPEN would silently turn an
    // authored narrative gate into an unconditional bonus.
    const carriers = carrierOf([{ type: "armor-class", amount: 5, when: [{ type: "while-mounted" }] }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(0);
  });

  it("fails a gate closed when the context does not carry the fact it reads", () => {
    const carriers = carrierOf([{ type: "armor-class", amount: 1, when: [{ type: "while-hp-at-or-below", percent: 50 }] }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(1); // 0.5 -> 50%
    expect(collectRiders(carriers, { ...base, hitPointFraction: 0.9, moment: null, sourceItemId: "ring" })).toHaveLength(0);
    expect(collectRiders(carriers, { ...base, hitPointFraction: undefined, moment: null, sourceItemId: "ring" })).toHaveLength(0);
  });

  it("armor weights narrow `while-armored`", () => {
    const heavyOnly = carrierOf([{ type: "armor-class", amount: 1, when: [{ type: "while-armored", weights: ["heavy"] }] }]);
    expect(collectRiders(heavyOnly, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(0);
    expect(collectRiders(heavyOnly, { ...base, armorWeight: "heavy", moment: null, sourceItemId: "ring" })).toHaveLength(1);
  });

  it("normalises the legacy `whileArmored` boolean into the same evaluation path", () => {
    const carriers = carrierOf([{ type: "armor-class", amount: 1, whileArmored: true }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(1);
    expect(collectRiders(carriers, { ...base, armorWeight: null, moment: null, sourceItemId: "ring" })).toHaveLength(0);
  });

  it("inverts `while-condition` when `present` is false", () => {
    const carriers = carrierOf([{ type: "armor-class", amount: 1, when: [{ type: "while-condition", conditionIds: ["prone"], present: false }] }]);
    expect(collectRiders(carriers, { ...base, moment: null, sourceItemId: "ring" })).toHaveLength(1);
    expect(collectRiders(carriers, { ...base, bearerConditionIds: ["prone"], moment: null, sourceItemId: "ring" })).toHaveLength(0);
  });
});

describe("collectRiders: scope", () => {
  it("defaults the attack/damage family to this-item on a weapon and to the bearer elsewhere", () => {
    const weapon = carrierOf([{ type: "attack-bonus", amount: 1 }, { type: "armor-class", amount: 1 }], { sourceItemId: "sword", isWeapon: true });
    // Rolling WITH the sword: both apply.
    expect(collectRiders(weapon, { ...base, moment: null, sourceItemId: "sword" }).map((r) => r.modifier.type)).toEqual(["attack-bonus", "armor-class"]);
    // Rolling with something else: the sword's +1 to hit does NOT follow, but its AC still does.
    expect(collectRiders(weapon, { ...base, moment: null, sourceItemId: "axe" }).map((r) => r.modifier.type)).toEqual(["armor-class"]);
  });

  it("resolves an authored this-item scope to bearer on a carrier with no item (a feat)", () => {
    const feat: RiderCarrier[] = [{ label: "Feat", modifiers: [{ type: "attack-bonus", amount: 1, scope: "this-item" }] }];
    expect(collectRiders(feat, { ...base, moment: null, sourceItemId: null })).toHaveLength(1);
  });
});

describe("sumRiders", () => {
  it("sums signed amounts so a curse subtracts", () => {
    const riders = collectRiders(carrierOf([{ type: "attack-bonus", amount: 2 }, { type: "attack-bonus", amount: -3 }]), { ...base, moment: null, sourceItemId: "ring" });
    expect(sumRiders(riders, "attack-bonus")).toBe(-1);
    expect(sumRiders(riders, "armor-class")).toBe(0);
  });
});

describe("armorWeightOf and effectiveSlot", () => {
  it("recovers the SRD armor weight from the two AC fields the item already records", () => {
    expect(armorWeightOf({ addDexModifier: false, dexModifierCap: null })).toBe("heavy");
    expect(armorWeightOf({ addDexModifier: true, dexModifierCap: 2 })).toBe("medium");
    expect(armorWeightOf({ addDexModifier: true, dexModifierCap: null })).toBe("light");
  });

  it("prefers an explicit slot and falls back to the three engine-known categories", () => {
    expect(effectiveSlot({ slot: "armor", category: "relic" })).toBe("armor");
    expect(effectiveSlot({ category: "shield" })).toBe("shield");
    expect(effectiveSlot({ category: "relic" })).toBe("none"); // an open category alone stays inert
  });
});

describe("armorClassFromEquipment with slots", () => {
  const armor = (acBase: number) => ({ acBase, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null });
  it("derives AC from an explicit slot on an otherwise-inert category", () => {
    expect(armorClassFromEquipment(2, [{ equipped: true, category: "relic", slot: "armor", armor: armor(16) }])).toBe(16);
    expect(armorClassFromEquipment(2, [{ equipped: true, category: "relic", armor: armor(16) }])).toBeNull();
  });
  it("counts one shield only", () => {
    const shield = { equipped: true, category: "shield", armor: armor(2) };
    expect(armorClassFromEquipment(3, [shield, shield, shield])).toBe(15); // 10 + 3 + 2, not +6
  });
});
