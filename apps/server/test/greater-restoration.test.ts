import { describe, expect, it } from "vitest";
import { actionChoicesOf } from "@vtt/domain";
import { InventoryItemSchema } from "@vtt/schemas";
import { makeEffect } from "../src/effects.js";
import { setInventoryItem } from "../src/inventory.js";
import { ALLY, catalog, FOE, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, answer, cast, castAction, caster, effectNames, resolveAs } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Greater Restoration: "You touch a creature and magically remove one of the following effects from it: 1
// Exhaustion level; The Charmed or Petrified condition; A curse, including the target's Attunement to a cursed magic
// item; Any reduction to one of the target's ability scores; Any reduction to the target's Hit Point maximum." Its
// material component is "diamond dust worth 100+ GP, which the spell consumes". Wish's Instant Health ends "all effects
// on them described in the Greater Restoration spell".

const withDust = (table: ReturnType<typeof caster>) =>
  actorOf(table.state, HERO).inventory.push({
    id: "diamond-dust",
    name: "Diamond dust (100 GP)",
    quantity: 1,
    equipped: false,
    attuned: false
  });

/** The ally, two Exhaustion levels deep, with 12 drained from its Hit Point maximum and 3 from its Strength. */
function worn(table: ReturnType<typeof caster>) {
  const ally = actorOf(table.state, ALLY);
  ally.conditions = [...ally.conditions, { id: "exhaustion", level: 2 }];
  ally.hp = { ...ally.hp, maximum: ally.hp.maximum - 12, current: Math.min(ally.hp.current, ally.hp.maximum - 12) };
  ally.effects = [
    ...ally.effects,
    makeEffect({
      id: "wight-drain",
      name: "Hit Point maximum reduced",
      tags: ["drained"],
      duration: { type: "manual" },
      hitPointMaximumLoss: 12
    }),
    makeEffect({
      id: "shadow-drain",
      name: "Strength drained",
      tags: ["ability-drain"],
      duration: { type: "manual" },
      abilityReduction: { ability: "str", amount: 3 }
    })
  ];
  return ally;
}

const exhaustion = (table: ReturnType<typeof caster>) =>
  actorOf(table.state, ALLY).conditions.find((condition) => condition.id === "exhaustion")?.level ?? 0;

describe("Greater Restoration", () => {
  it("asks which harm it ends", () => {
    expect(actionChoicesOf(castAction("greater-restoration"))?.options?.map((option) => option.id)).toEqual([
      "exhaustion",
      "charmed",
      "petrified",
      "curse",
      "ability-score",
      "hit-point-maximum",
      "other"
    ]);
  });

  it("gives back a drained Hit Point maximum and leaves the Exhaustion, using up the diamond dust", () => {
    const table = caster();
    withDust(table);
    const ally = worn(table);
    const maximum = ally.hp.maximum;
    cast(table, "greater-restoration", { targetIds: [ALLY], optionId: "hit-point-maximum" });
    expect(actorOf(table.state, ALLY).hp.maximum).toBe(maximum + 12);
    expect(effectNames(table.state, ALLY)).toEqual(["Strength drained"]);
    expect(exhaustion(table)).toBe(2);
    expect(actorOf(table.state, HERO).inventory.some((row) => row.id === "diamond-dust")).toBe(false);
  });

  it("takes off one Exhaustion level, or ends a lowered ability score", () => {
    const table = caster();
    worn(table);
    withDust(table);
    cast(table, "greater-restoration", { targetIds: [ALLY], optionId: "exhaustion" });
    expect(exhaustion(table)).toBe(1);
    heroTurnAgain(table.state);
    withDust(table);
    cast(table, "greater-restoration", { targetIds: [ALLY], optionId: "ability-score", ability: "str" });
    expect(effectNames(table.state, ALLY)).toEqual(["Hit Point maximum reduced"]);
  });

  it("ends the Petrified condition, or one curse", () => {
    const table = caster();
    actorOf(table.state, ALLY).conditions.push({ id: "petrified" });
    withDust(table);
    cast(table, "greater-restoration", { targetIds: [ALLY], optionId: "petrified" });
    expect(actorOf(table.state, ALLY).conditions).toEqual([]);
    heroTurnAgain(table.state);
    cast(table, "hex", { ability: "wis" });
    expect(effectNames(table.state, FOE)).toEqual(["Hex (Wisdom)"]);
    heroTurnAgain(table.state);
    withDust(table);
    cast(table, "greater-restoration", { targetIds: [FOE], optionId: "curse" });
    expect(effectNames(table.state, FOE)).toEqual([]);
  });

  it("breaks the Attunement to a cursed item as its curse", () => {
    const table = caster();
    setInventoryItem(
      table.state,
      ALLY,
      InventoryItemSchema.parse({
        id: "berserker-axe",
        name: "Berserker Axe",
        quantity: 1,
        equipped: true,
        attuned: true
      }),
      () => undefined,
      { catalog, role: "gm" }
    );
    withDust(table);
    const restored = cast(table, "greater-restoration", { targetIds: [ALLY], optionId: "curse" });
    expect(actorOf(table.state, ALLY).inventory[0]).toMatchObject({ id: "berserker-axe", attuned: false });
    expect(restored.tableNarration?.map((line) => line.text)).toContain(
      "Bran is no longer attuned to Berserker Axe. Its curse stays on the item, which can now be removed (Greater Restoration)."
    );
  });

  it("is refused before anything is spent on a creature without the harm picked", () => {
    const table = caster();
    withDust(table);
    expect(() => cast(table, "greater-restoration", { targetIds: [ALLY], optionId: "charmed" })).toThrow(
      "Bran isn't Charmed, so Greater Restoration would do nothing."
    );
    expect(actorOf(table.state, HERO).inventory.some((row) => row.id === "diamond-dust")).toBe(true);
  });
});

describe("effects that name their cure", () => {
  it("Befuddlement ends by Greater Restoration's own pick, or by Heal", () => {
    const table = caster();
    cast(table, "befuddlement", { targetIds: [FOE] });
    answer(table.state, FOE, 2);
    expect(effectNames(table.state, FOE)).toEqual(["Befuddlement"]);
    heroTurnAgain(table.state);
    withDust(table);
    cast(table, "greater-restoration", { targetIds: [FOE], optionId: "other" });
    expect(effectNames(table.state, FOE)).toEqual([]);
    heroTurnAgain(table.state);
    cast(table, "befuddlement", { targetIds: [FOE] });
    answer(table.state, FOE, 2);
    heroTurnAgain(table.state);
    cast(table, "heal", { targetIds: [FOE] });
    expect(effectNames(table.state, FOE)).toEqual([]);
  });

  it("Contact Other Plane's Incapacitated until a Long Rest ends by Greater Restoration", () => {
    // Its 1 minute casting time runs across turns in a fight, so it is cast outside one.
    const table = caster({ combat: false });
    cast(table, "contact-other-plane", { targetIds: [] }, [3, 3, 3, 3, 3, 3]);
    answer(table.state, HERO, 1);
    expect(actorOf(table.state, HERO).conditions.map((condition) => condition.id)).toEqual(["incapacitated"]);
    // Bran casts it from a slot of his own, with his own diamond dust.
    const bran = actorOf(table.state, ALLY);
    bran.spellSlots = [{ level: 5, remaining: 1 }];
    bran.inventory.push({
      id: "diamond-dust",
      name: "Diamond dust (100 GP)",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    resolveAs(table, castAction("greater-restoration"), { targetIds: [HERO], optionId: "other" }, [], ALLY);
    expect(actorOf(table.state, HERO).conditions).toEqual([]);
  });
});

describe("Wish's Instant Health", () => {
  it("ends everything Greater Restoration ends on the creatures it picks", () => {
    const table = caster();
    worn(table);
    const maximum = actorOf(table.state, ALLY).hp.maximum;
    cast(table, "wish", { targetIds: [ALLY], optionId: "instant-health" }, [1, 1, 90]);
    const ally = actorOf(table.state, ALLY);
    expect(exhaustion(table)).toBe(0);
    expect(ally.hp.maximum).toBe(maximum + 12);
    expect(ally.hp.current).toBe(ally.hp.maximum);
    expect(effectNames(table.state, ALLY)).toEqual([]);
  });
});
