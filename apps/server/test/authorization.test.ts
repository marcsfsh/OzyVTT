import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { canInitiateForActor } from "../src/authorization.js";

const playerA = "b539ef5e-16e6-46ce-bf33-3ed4b02997c1";
const playerB = "65cc7d6b-1150-41c4-aa9f-390439313f53";
const mine = "60a6e172-9ff5-44a3-8a8b-93f836f0d16c";
const monster = "60a6e172-9ff5-44a3-8a8b-93f836f0d200";
const state = GameStateSchema.parse({
  schemaVersion: 1,
  actors: [
    { id: mine, name: "Mine", kind: "player-character", hp: { current: 10, maximum: 10 }, ownerSessionId: playerA },
    { id: monster, name: "Goblin", kind: "monster", hp: { current: 7, maximum: 7 } }
  ]
});

describe("canInitiateForActor", () => {
  it("lets the GM (or an integration) act on anyone", () => {
    expect(canInitiateForActor({ role: "gm" }, state, monster, "attack").ok).toBe(true);
    expect(canInitiateForActor({ role: "gm" }, state, mine, "check").ok).toBe(true);
  });
  it("lets a player act only on their own claimed character", () => {
    expect(canInitiateForActor({ role: "player", sessionId: playerA }, state, mine, "check").ok).toBe(true);
    expect(canInitiateForActor({ role: "player", sessionId: playerB }, state, mine, "check").ok).toBe(false);
    expect(canInitiateForActor({ role: "player", sessionId: playerA }, state, monster, "attack").ok).toBe(false);
  });
  it("rejects an unknown actor", () => {
    expect(canInitiateForActor({ role: "player", sessionId: playerA }, state, "00000000-0000-4000-8000-000000000000", "check").ok).toBe(false);
  });
});
