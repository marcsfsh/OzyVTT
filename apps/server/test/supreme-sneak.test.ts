import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { addEffect, makeEffect } from "../src/effects.js";
import { markStealthAttack, stealthAttackAtTurnEnd } from "../src/supreme-sneak.js";
import { DIVIDER, HERO, visionGame, wall } from "./vision-fixtures.js";

// SRD Supreme Sneak (Thief 9), Stealth Attack: the attack "doesn't end that condition on you if you end the turn
// behind Three-Quarters Cover or Total Cover". The hero hides, makes a Stealth Attack, and its turn ends.

const hiddenAfterStealthAttack = (state: GameState) => {
  addEffect(state, HERO, makeEffect({ id: "hiding", name: "Hidden", tags: ["hidden"], duration: { type: "manual" } }));
  markStealthAttack(state, HERO);
  stealthAttackAtTurnEnd(state, HERO, () => undefined);
  return state.actors.find((actor) => actor.id === HERO)!.effects.some((effect) => effect.id === "hiding");
};

describe("Supreme Sneak's Stealth Attack at the end of the turn", () => {
  it("keeps the Rogue hidden behind Total Cover from the only enemy", () => {
    expect(hiddenAfterStealthAttack(visionGame({ walls: [DIVIDER()] }))).toBe(true);
  });

  it("keeps it hidden behind Three-Quarters Cover", () => {
    const corner = [wall({ x: 110, y: 200 }, { x: 110, y: 290 }), wall({ x: 75, y: 285 }, { x: 75, y: 310 })];
    expect(hiddenAfterStealthAttack(visionGame({ walls: corner }))).toBe(true);
  });

  it("reveals it in the open", () => {
    expect(hiddenAfterStealthAttack(visionGame())).toBe(false);
  });

  it("leaves it to the GM with the scene's vision off", () => {
    expect(hiddenAfterStealthAttack(visionGame({ enabled: false }))).toBe(true);
  });

  it("reads nothing on a turn without a Stealth Attack", () => {
    const state = visionGame();
    addEffect(
      state,
      HERO,
      makeEffect({ id: "hiding", name: "Hidden", tags: ["hidden"], duration: { type: "manual" } })
    );
    stealthAttackAtTurnEnd(state, HERO, () => undefined);
    expect(state.actors.find((actor) => actor.id === HERO)!.effects.some((effect) => effect.id === "hiding")).toBe(
      true
    );
  });
});
