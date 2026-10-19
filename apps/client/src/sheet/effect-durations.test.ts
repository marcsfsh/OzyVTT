import { describe, expect, it } from "vitest";
import { effectDurationLabel } from "../encounter/EffectChips";
import { shortDuration } from "./sheet-model";

// Spells longer than 10 minutes count down on the game clock in minutes; a few last until a rest.
describe("an effect's time left", () => {
  it("reads minutes of game time in words on the chip and short on the sheet", () => {
    expect(effectDurationLabel({ duration: { type: "minutes", remaining: 450 } })).toBe("7 hours 30 minutes left");
    expect(shortDuration({ duration: { type: "minutes", remaining: 450 } })).toBe("7 h");
    expect(shortDuration({ duration: { type: "minutes", remaining: 45 } })).toBe("45 min");
    expect(shortDuration({ duration: { type: "minutes", remaining: 2880 } })).toBe("2 days");
  });

  it("names the rest that ends an effect", () => {
    expect(effectDurationLabel({ duration: { type: "until-rest", rest: "long" } })).toBe("until its next Long Rest");
    expect(shortDuration({ duration: { type: "until-rest", rest: "long" } })).toBe("until a Long Rest");
    expect(shortDuration({ duration: { type: "until-rest", rest: "short" } })).toBe("until a rest");
  });
});
