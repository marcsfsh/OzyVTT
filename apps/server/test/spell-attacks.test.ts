import { describe, expect, it } from "vitest";
import { EffectInstanceSchema } from "@vtt/schemas";
import { build, FOE, fight, wizardInput, WIZARD_SPELLS } from "./spell-casters.js";

// A spell attack is a melee or a ranged attack (SRD 5.2.1 Spells, "Range"): a ranged one reaches out to the spell's
// range and has Disadvantage with an enemy within 5 feet; a melee one (Touch) reaches 5 feet.

const wizard = build(wizardInput(WIZARD_SPELLS));

describe("a ranged spell attack", () => {
  it("reaches out to the spell's range on a mapped table, not a 5-foot reach", () => {
    expect(wizard.actions.find((action) => action.id === "spell-fire-bolt")!.attack).toMatchObject({
      rangeFeet: 120
    });
    const { resolve } = fight(wizard, { distance: 30 });
    expect(resolve("spell-fire-bolt", {}, [15, 5]).attack?.outcome).toBe("hit");
  });

  it("is refused beyond its range", () => {
    const { resolve } = fight(wizard, { distance: 125 });
    expect(() => resolve("spell-fire-bolt", {}, [15, 5])).toThrowError(/beyond the 120 ft maximum range/);
  });

  it("has Disadvantage with an enemy within 5 feet, and counts as ranged for riders", () => {
    const { resolve } = fight(wizard, { distance: 5 });
    const resolution = resolve("spell-fire-bolt", {}, [15, 5, 5]);
    expect(resolution.rollMode?.mode).toBe("disadvantage");
    expect(resolution.rollMode?.disadvantage.join(" ")).toMatch(/Enemy within 5 feet/);
  });
});

describe("a melee spell attack", () => {
  it("reaches 5 feet, and has no close-combat Disadvantage", () => {
    const near = fight(wizard, { distance: 5 });
    expect(near.resolve("spell-shocking-grasp", {}, [15, 5]).rollMode).toBeUndefined();
    const far = fight(wizard, { distance: 30 });
    expect(() => far.resolve("spell-shocking-grasp", {}, [15, 5])).toThrowError(/beyond Ansel's 5 ft reach/);
  });

  it("counts as melee for riders, but not as a melee weapon (Radiant Strikes)", () => {
    const { resolve, hero } = fight(wizard, { distance: 5 });
    const bonusFor = (kind: "melee" | "melee-weapon", amount: number) =>
      EffectInstanceSchema.parse({
        id: `bonus-${kind}`,
        name: `Bonus to ${kind}`,
        duration: { type: "manual" },
        modifiers: [
          {
            type: "attack-bonus",
            amount,
            when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: [kind] }]
          }
        ]
      });
    hero.effects = [bonusFor("melee", 1), bonusFor("melee-weapon", 4)];
    // d20 10 + 7 (spell attack) + 1 (melee): the melee-weapon bonus doesn't apply.
    expect(resolve("spell-shocking-grasp", { targetIds: [FOE] }, [10, 5]).attack?.total).toBe(18);
  });
});

describe("a spell action from an older sheet, with no range on its attack", () => {
  it("takes the spell's range when it resolves", () => {
    const legacy = {
      ...wizard,
      actions: wizard.actions.map((action) =>
        action.id === "spell-fire-bolt" ? { ...action, attack: { bonus: action.attack!.bonus } } : action
      )
    };
    const { resolve } = fight(legacy, { distance: 30 });
    expect(resolve("spell-fire-bolt", {}, [15, 5]).attack?.outcome).toBe("hit");
  });
});
