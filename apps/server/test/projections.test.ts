import { describe, expect, it } from "vitest";
import { GameStateSchema, type RollRecord, type RollVisibility } from "@vtt/domain";
import { projectGmView, projectPlayerView } from "../src/projections.js";

const playerA = "b539ef5e-16e6-46ce-bf33-3ed4b02997c1";
const playerB = "65cc7d6b-1150-41c4-aa9f-390439313f53";
const noPresence = () => null;
function roll(visibility: RollVisibility, index: number): RollRecord {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, commandId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, initiatorSessionId: playerA, initiatorRole: "player", actorId: null, purpose: "manual", visibility, formula: "1d20", normalizedFormula: "1d20", dice: [{ group: 0, sides: 20, face: 12, kept: true, sign: 1 }], modifiers: [], total: 12, createdAt: "2026-07-15T12:00:00.000Z" };
}

describe("recipient-specific roll projections", () => {
  const state = GameStateSchema.parse({ schemaVersion: 1, rolls: [roll("public", 1), roll("self-only", 2), roll("blind", 3), roll("gm-only", 4)] });
  it("shows a player public and their own self-only rolls, without private session IDs", () => {
    const view = projectPlayerView(state, playerA, noPresence);
    expect(view.rolls.map(({ visibility }) => visibility)).toEqual(["public", "self-only"]);
    expect(view.rolls.every((entry) => !("initiatorSessionId" in entry))).toBe(true);
  });
  it("does not show another player self-only, blind, or GM-only rolls", () => { expect(projectPlayerView(state, playerB, noPresence).rolls.map(({ visibility }) => visibility)).toEqual(["public"]); });
  it("shows the GM every roll", () => { expect(projectGmView(state, noPresence).rolls).toHaveLength(4); });
});

describe("player-safe character claim projections", () => {
  const actors = [
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16b", name: "Available", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null, notes: "GM only" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16c", name: "Mine", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerA, notes: "GM only" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16d", name: "Claimed", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerB, notes: "GM only" }
  ];
  const state = GameStateSchema.parse({ schemaVersion: 1, actors });

  it("reports safe claim states without owner IDs or notes", () => {
    const projected = projectPlayerView(state, playerA, noPresence);
    expect(projected.actors.map(({ claimStatus }) => claimStatus)).toEqual(["available", "mine", "claimed"]);
    expect(projected.actors.every((actor) => !("ownerSessionId" in actor) && !("notes" in actor))).toBe(true);
  });

  it("never sends a session ID, token, socket ID, or address for any actor, presence included", () => {
    const projected = projectPlayerView(state, playerA, noPresence);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain(playerA);
    expect(serialized).not.toContain(playerB);
  });
});

describe("presence projection", () => {
  const actors = [
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16b", name: "Unclaimed", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null, notes: "" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16c", name: "Online owner", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerA, notes: "" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16d", name: "Reconnecting owner", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerB, notes: "" }
  ];
  const state = GameStateSchema.parse({ schemaVersion: 1, actors });
  const presenceFor = (sessionId: string) => (sessionId === playerA ? ("online" as const) : sessionId === playerB ? ("reconnecting" as const) : null);

  it("attaches presence per owner in the player view without exposing the owning session ID", () => {
    const projected = projectPlayerView(state, "someone-else", presenceFor);
    expect(projected.actors.map((actor) => actor.presence)).toEqual([null, "online", "reconnecting"]);
    expect(JSON.stringify(projected)).not.toContain(playerA);
    expect(JSON.stringify(projected)).not.toContain(playerB);
  });

  it("attaches presence per owner in the GM view alongside the owning session ID it already carries", () => {
    const projected = projectGmView(state, presenceFor);
    expect(projected.actors.map((actor) => actor.presence)).toEqual([null, "online", "reconnecting"]);
  });

  it("reports null presence for an unclaimed actor even if the lookup would otherwise resolve", () => {
    const alwaysOnline = () => "online" as const;
    const projected = projectPlayerView(state, undefined, alwaysOnline);
    expect(projected.actors[0].presence).toBeNull();
  });
});
