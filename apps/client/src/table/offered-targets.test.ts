import { describe, expect, it } from "vitest";
import type { ContentActionSummary } from "@vtt/domain";
import { pickableTargets, reachOf, type TargetRow } from "./targetRows";

// A picker reads an action's own target range when it makes no attack (Lay on Hands' touch, a flask's 20 feet), so a
// creature beyond it is listed with why. The server still decides.

const touch = {
  id: "lay-on-hands",
  name: "Lay On Hands",
  attackBonus: null,
  reachFeet: null,
  rangeFeet: null,
  saveAbility: null,
  damage: [],
  targetRangeFeet: 5
} as unknown as ContentActionSummary;
const row = (id: string, feet: number): TargetRow => ({
  id,
  label: id,
  initials: id.slice(0, 2),
  kind: "monster",
  feet
});

describe("an action's own target range", () => {
  it("is the reach a touch action's picker measures against", () => {
    expect(reachOf(touch)).toBe(5);
    const [near, far] = pickableTargets([row("near", 5), row("far", 30)], touch);
    expect(near!.unavailable).toBeUndefined();
    expect(far!.unavailable).toBe("Out of range: 30 ft away, the reach is 5 ft.");
  });
});
