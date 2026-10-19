import { describe, expect, it } from "vitest";
import { effectNameOf } from "../src/effect-names.js";

// An effect named after the action that left it carries the action's name alone. The stat block's note on how often the
// action is used stays with the action.

describe("an effect named after its action", () => {
  it("leaves out a recharge, a daily count and a legendary cost", () => {
    expect(effectNameOf("Spores (Recharge 6)")).toBe("Spores");
    expect(effectNameOf("Fire Breath (Recharge 5-6)")).toBe("Fire Breath");
    expect(effectNameOf("Web (Recharge after a Short or Long Rest)")).toBe("Web");
    expect(effectNameOf("Frightful Presence (1/Day)")).toBe("Frightful Presence");
    expect(effectNameOf("Charm (3/Day Each)")).toBe("Charm");
    expect(effectNameOf("Wing Attack (Costs 2 Actions)")).toBe("Wing Attack");
  });

  it("keeps a note that says something else", () => {
    expect(effectNameOf("Shield (Ring of Spell Storing)")).toBe("Shield (Ring of Spell Storing)");
    expect(effectNameOf("Bite (Tiger or Hybrid Form Only)")).toBe("Bite (Tiger or Hybrid Form Only)");
  });
});
