import { describe, expect, it } from "vitest";
import { isDead, type MortalCreature } from "./death.js";

const creature = (overrides: Partial<MortalCreature>): MortalCreature => ({
  kind: "player-character",
  hp: { current: 0 },
  deathSaves: null,
  conditions: [],
  ...overrides
});

// SRD 5.2.1 "Dead", "Death Saving Throws", "Exhaustion" and "Monster Death".
describe("who is dead", () => {
  it("a character dies on the third failed death save, not before", () => {
    expect(isDead(creature({ deathSaves: { failures: 2 } }))).toBe(false);
    expect(isDead(creature({ deathSaves: { failures: 3 } }))).toBe(true);
  });

  it("a stable or dying character at 0 hit points is alive", () => {
    expect(isDead(creature({ deathSaves: { failures: 0 } }))).toBe(false);
    expect(isDead(creature({ deathSaves: null, conditions: [{ id: "unconscious" }] }))).toBe(false);
  });

  it("Exhaustion 6 kills anyone, at any hit points", () => {
    expect(isDead(creature({ hp: { current: 12 }, conditions: [{ id: "exhaustion", level: 6 }] }))).toBe(true);
    expect(
      isDead(creature({ kind: "monster", hp: { current: 5 }, conditions: [{ id: "exhaustion", level: 6 }] }))
    ).toBe(true);
    expect(isDead(creature({ hp: { current: 12 }, conditions: [{ id: "exhaustion", level: 5 }] }))).toBe(false);
  });

  it("a monster or NPC dies at 0 hit points, unless it lies Unconscious there", () => {
    expect(isDead(creature({ kind: "monster", hp: { current: 0 } }))).toBe(true);
    expect(isDead(creature({ kind: "npc", hp: { current: 0 } }))).toBe(true);
    expect(isDead(creature({ kind: "monster", hp: { current: 1 } }))).toBe(false);
    expect(isDead(creature({ kind: "npc", hp: { current: 0 }, conditions: [{ id: "unconscious" }] }))).toBe(false);
  });
});
