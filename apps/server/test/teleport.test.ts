import { describe, expect, it } from "vitest";
import { actionChoicesOf } from "@vtt/domain";
import { outcomeOf } from "../src/resolution/teleport-outcome.js";
import { ALLY, HERO } from "./spell-casters.js";
import { actorOf, cast, castAction, caster } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Teleport: "Your familiarity with the destination determines whether you arrive there successfully. The GM
// rolls 1d100 and consults the Teleportation Outcome table ... Mishap. ... Each teleporting creature (or the target
// object) takes 3d10 Force damage, and the GM rerolls on the table ... Off Target. You and your group ... appear 2d12
// miles away from the destination in a random direction. Roll 1d8 for the direction."

const told = (result: ReturnType<typeof cast>) => result.tableNarration?.map((line) => line.text).join(" ") ?? "";

describe("Teleport", () => {
  it("asks for the destination's familiarity as it casts", () => {
    const options = actionChoicesOf(castAction("teleport"))?.options?.map((option) => option.name);
    expect(options).toEqual([
      "Permanent circle",
      "Linked object",
      "Very familiar",
      "Seen casually",
      "Viewed once or described",
      "False destination"
    ]);
  });

  it("reads the table's bands", () => {
    expect(outcomeOf("permanent-circle", 1)).toBe("on-target");
    expect(outcomeOf("very-familiar", 5)).toBe("mishap");
    expect(outcomeOf("very-familiar", 13)).toBe("similar-area");
    expect(outcomeOf("viewed-once", 73)).toBe("off-target");
    expect(outcomeOf("viewed-once", 74)).toBe("on-target");
    expect(outcomeOf("false-destination", 51)).toBe("similar-area");
    expect(outcomeOf("false-destination", 100)).toBe("similar-area");
  });

  it("hurts each traveller on a Mishap and rolls again", () => {
    const table = caster();
    const heroBefore = actorOf(table.state, HERO).hp.current;
    const allyBefore = actorOf(table.state, ALLY).hp.current;
    // d100 20 (a mishap when seen casually), 3d10 of 5s, then d100 60: on target.
    const result = cast(table, "teleport", { targetIds: [ALLY], optionId: "seen-casually" }, [20, 5, 5, 5, 60]);
    expect(actorOf(table.state, HERO).hp.current).toBe(heroBefore - 15);
    expect(actorOf(table.state, ALLY).hp.current).toBe(allyBefore - 15);
    expect(told(result)).toMatch(/d100 20: Mishap\. Each traveller takes 15 Force damage/);
    expect(told(result)).toMatch(/d100 60: On Target/);
  });

  it("rolls the miles and the direction when Off Target", () => {
    const table = caster();
    const result = cast(table, "teleport", { targetIds: [ALLY], optionId: "very-familiar" }, [20, 4, 5, 7]);
    expect(told(result)).toMatch(/d100 20: Off Target\. The travellers appear 9 miles north of the destination\./);
  });

  it("refuses a familiarity the table doesn't have", () => {
    const table = caster();
    expect(() => cast(table, "teleport", { targetIds: [ALLY], optionId: "somewhere" })).toThrow(
      "Teleport doesn't offer that choice."
    );
  });
});
