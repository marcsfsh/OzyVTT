import { describe, expect, it } from "vitest";
import { actionChoicesOf } from "@vtt/domain";
import { applyDamageDetailed } from "../src/hit-points.js";
import { checkWishUse } from "../src/resolution/wish.js";
import { ALLY, FOE, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, cast, castAction, caster, effectNames } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Wish: "The basic use of this spell is to duplicate any other spell of level 8 or lower ... Alternatively,
// you can create one of the following effects of your choice ... Resistance. You allow up to ten creatures that you
// can see to have Resistance to one damage type you choose. This Resistance is permanent ... Wish's Stress. Using the
// spell to produce any effect other than duplicating another spell weakens you. After enduring that stress, each time
// you cast a spell until you finish a Long Rest, you take 1d10 Necrotic damage per level of that spell. This damage
// can't be reduced or prevented in any way. In addition, your Strength score becomes 3 for 2d4 days ... there is a 33
// percent chance that you are unable to cast Wish ever again if you suffer this stress."

const resolveDefinition = () => undefined;

describe("Wish", () => {
  it("asks which use, and a damage type for Resistance", () => {
    const choices = actionChoicesOf(castAction("wish"));
    expect(choices?.options?.map((option) => option.id)).toEqual([
      "duplicate",
      "object-creation",
      "instant-health",
      "resistance",
      "spell-immunity",
      "sudden-learning",
      "roll-redo",
      "reshape-reality"
    ]);
    expect(castAction("wish").damageTypes).toHaveLength(13);
  });

  it("duplicating a spell leaves no stress", () => {
    const table = caster();
    cast(table, "wish", { targetIds: [], optionId: "duplicate" });
    expect(effectNames(table.state, HERO)).toEqual([]);
  });

  it("gives lasting Resistance, then stresses its caster: later spells hurt it, and a 33 can end its Wishes", () => {
    const table = caster();
    // 2d4 days (3 + 2), then the d100: 20.
    cast(table, "wish", { targetIds: [ALLY], optionId: "resistance", damageType: "fire" }, [3, 2, 20]);
    expect(effectNames(table.state, ALLY)).toEqual(["Wish: Resistance (Fire)"]);
    const ally = applyDamageDetailed(
      table.state,
      ALLY,
      { amount: 10, parts: [{ amount: 10, type: "fire" }] },
      { role: "gm" },
      { resolveDefinition }
    );
    expect(ally.application.totalApplied).toBe(5);
    expect(effectNames(table.state, HERO)).toEqual([
      "Wish's stress",
      "Wish's stress: Strength 3 for 5 days",
      "Can never cast Wish again"
    ]);
    // A cantrip costs nothing; a level 3 Fireball deals 3d10 to its caster, untouched by any Resistance.
    heroTurnAgain(table.state);
    const before = actorOf(table.state, HERO).hp.current;
    cast(table, "fire-bolt", { targetIds: [FOE] }, [15, 5]);
    expect(actorOf(table.state, HERO).hp.current).toBe(before);
    heroTurnAgain(table.state);
    cast(table, "fireball", { targetIds: [FOE] }, [4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 4]);
    expect(actorOf(table.state, HERO).hp.current).toBe(before - 9);
    // It can never cast Wish again.
    heroTurnAgain(table.state);
    expect(() => cast(table, "wish", { targetIds: [], optionId: "duplicate" })).toThrow("can never cast Wish again");
  });

  it("keeps Resistance and Spell Immunity to ten creatures, and asks Resistance's type", () => {
    const table = caster();
    expect(() => cast(table, "wish", { targetIds: [ALLY], optionId: "resistance" })).toThrow(
      "Pick the damage type Wish's Resistance is to."
    );
    const many = Array.from(
      { length: 11 },
      (_, index) => `10000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`
    );
    // Checked before the encounter's own target rules.
    expect(() =>
      checkWishUse(
        castAction("wish"),
        { actorId: HERO, targetIds: many, optionId: "spell-immunity", commandId: "c" },
        {
          name: "Ansel"
        }
      )
    ).toThrow("Wish's Spell Immunity reaches up to ten creatures Ansel can see.");
  });

  it("restores the caster and the creatures it picks to full with Instant Health", () => {
    const table = caster();
    actorOf(table.state, ALLY).hp = { ...actorOf(table.state, ALLY).hp, current: 20 };
    actorOf(table.state, HERO).hp = { ...actorOf(table.state, HERO).hp, current: 5 };
    cast(table, "wish", { targetIds: [ALLY], optionId: "instant-health" }, [1, 1, 90]);
    expect(actorOf(table.state, ALLY).hp.current).toBe(actorOf(table.state, ALLY).hp.maximum);
    expect(actorOf(table.state, HERO).hp.current).toBe(actorOf(table.state, HERO).hp.maximum);
    expect(effectNames(table.state, HERO)).not.toContain("Can never cast Wish again");
  });
});
