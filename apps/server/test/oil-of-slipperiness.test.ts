import { describe, expect, it } from "vitest";
import { effectiveActions } from "../src/effective-actions.js";
import { catalog, HERO } from "./spell-casters.js";
import { actorOf, caster, resolveAs, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Oil of Slipperiness: "the oil can be poured on the ground as a Magic action, where it covers a 10-foot
// square, duplicating the effect of the Grease spell in that area for 8 hours."

describe("Oil of Slipperiness poured", () => {
  it("casts Grease from the vial, which lasts 8 hours and uses the vial up", () => {
    const table = caster();
    const hero = actorOf(table.state, HERO);
    hero.inventory.push({
      id: "oil-of-slipperiness",
      name: "Oil of Slipperiness",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    const pour = effectiveActions(wizard, hero, catalog).find(
      (action) => action.spellId === "grease" && action.id.startsWith("item-oil-of-slipperiness")
    )!;
    expect(pour.castLastsMinutes).toBe(480);
    resolveAs(table, pour, { targetIds: [], areaPlaced: true });
    const grease = hero.effects.find((effect) => effect.spell?.id === "grease");
    expect(grease?.duration).toEqual({ type: "minutes", remaining: 480 });
    expect(hero.inventory.some((row) => row.id === "oil-of-slipperiness")).toBe(false);
  });
});
