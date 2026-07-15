import { describe, expect, it } from "vitest";
import { GameStateSchema, type RollRecord, type RollVisibility } from "@vtt/domain";
import { projectGmView, projectPlayerView } from "../src/projections.js";

const playerA = "b539ef5e-16e6-46ce-bf33-3ed4b02997c1";
const playerB = "65cc7d6b-1150-41c4-aa9f-390439313f53";
function roll(visibility: RollVisibility, index: number): RollRecord {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, commandId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, initiatorSessionId: playerA, initiatorRole: "player", actorId: null, purpose: "manual", visibility, formula: "1d20", normalizedFormula: "1d20", dice: [{ group: 0, sides: 20, face: 12, kept: true, sign: 1 }], modifiers: [], total: 12, createdAt: "2026-07-15T12:00:00.000Z" };
}

describe("recipient-specific roll projections", () => {
  const state = GameStateSchema.parse({ schemaVersion: 1, rolls: [roll("public", 1), roll("self-only", 2), roll("blind", 3), roll("gm-only", 4)] });
  it("shows a player public and their own self-only rolls, without private session IDs", () => {
    const view = projectPlayerView(state, playerA);
    expect(view.rolls.map(({ visibility }) => visibility)).toEqual(["public", "self-only"]);
    expect(view.rolls.every((entry) => !("initiatorSessionId" in entry))).toBe(true);
  });
  it("does not show another player self-only, blind, or GM-only rolls", () => { expect(projectPlayerView(state, playerB).rolls.map(({ visibility }) => visibility)).toEqual(["public"]); });
  it("shows the GM every roll", () => { expect(projectGmView(state).rolls).toHaveLength(4); });
});
