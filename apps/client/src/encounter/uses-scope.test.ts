import { describe, expect, it } from "vitest";
import type { ContentActionSummary } from "@vtt/domain";
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
});
