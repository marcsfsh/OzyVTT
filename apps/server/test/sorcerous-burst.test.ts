import { describe, expect, it } from "vitest";
import type { ActorAction } from "@vtt/schemas";
import { spellCastMechanics } from "../src/item-actions.js";
import { view } from "./spell-casters.js";
import { cast, caster, resolveAs } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Sorcerous Burst: "If you roll an 8 on a d8 for this spell, you can roll another d8, and add it to the
// damage. When you cast this cantrip, the maximum number of these d8s you can add to the spell's damage equals your
// spellcasting ability modifier."

describe("Sorcerous Burst's exploding d8s", () => {
  it("adds a d8 for each 8 rolled, the added dice exploding too, up to the spellcasting modifier", () => {
    const table = caster();
    // d20 15, then the d8s: 8, an added 8, an added 3. The modifier is +3.
    const burst = cast(table, "sorcerous-burst", { damageType: "fire" }, [15, 8, 8, 3]);
    expect(burst.damage.reduce((sum, part) => sum + part.total, 0)).toBe(19);
    expect(burst.damage.every((part) => part.type === "fire")).toBe(true);
  });

  it("stops at the modifier: with +1, one added d8", () => {
    const table = caster();
    const spell = view.spellRecord("sorcerous-burst")!;
    const action = {
      id: "spell-sorcerous-burst",
      name: spell.name,
      activation: "action",
      description: spell.description,
      ...spellCastMechanics(spell, { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 1 }),
      spellId: spell.id
    } as ActorAction;
    const burst = resolveAs(table, action, {}, [15, 8, 8, 3]);
    expect(burst.damage.reduce((sum, part) => sum + part.total, 0)).toBe(16);
  });
});
