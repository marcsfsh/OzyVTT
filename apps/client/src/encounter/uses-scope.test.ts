import { describe, expect, it } from "vitest";
import type { ContentActionSummary } from "@vtt/domain";
import { returnsWords } from "../sheet/Uses";
import { actionSummaryParts, usesScopeLabel } from "./action-summary";

describe("how a limited use comes back, as a sheet says it", () => {
  it("calls a use back at the start of the bearer's next turn once a round", () => {
    const peerlessAim = {
      id: "boon-of-combat-prowess",
      name: "Boon of Combat Prowess",
      attackBonus: null,
      attackCount: null,
      multiattack: null,
      saveAbility: null,
      damage: [],
      usesLimit: 1,
      usesPer: "own-turn"
    } as unknown as ContentActionSummary;
    expect(actionSummaryParts(peerlessAim)).toEqual(["1/round"]);
    expect(usesScopeLabel("short-rest")).toBe("Short Rest");
    expect(usesScopeLabel("turn")).toBe("turn");
  });

  it("names the wait of a use spent for a time, in hours or days", () => {
    const wings = {
      id: "item-wings-of-flying-wings",
      name: "Spread the Wings",
      attackBonus: null,
      attackCount: null,
      multiattack: null,
      saveAbility: null,
      damage: [],
      usesLimit: 1,
      usesPer: "time",
      usesAfterHours: "1d12+1"
    } as unknown as ContentActionSummary;
    expect(actionSummaryParts(wings)).toEqual(["1, back 1d12+1 hours after the first"]);
    expect(returnsWords("time", "168")).toBe("Back 7 days after its first use");
    expect(returnsWords("never")).toBe("Doesn't come back");
  });
});
