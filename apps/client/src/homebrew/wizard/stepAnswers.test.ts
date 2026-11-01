import { describe, expect, it } from "vitest";
import { stepAnswer } from "./stepAnswers";

// The studio's rail (compendium spec 2.4): each step's current answer in one line.

const draft = {
  name: "Goblin Boss",
  size: "small",
  type: "fey",
  armorClass: 17,
  hitPoints: { maximum: 27, formula: "6d6+6" },
  speedFeet: 30,
  abilityScores: { str: 10, dex: 15, con: 12, int: 10, wis: 8, cha: 10 },
  traits: [{ name: "Nimble Escape", description: "" }],
  actions: [
    { name: "Multiattack", activation: "action" },
    { name: "Scimitar", activation: "action" },
    { name: "Redirect Attack", activation: "reaction" }
  ]
};

describe("a monster's step answers", () => {
  it("say Defences as AC, HP and speed, the six scores, and the actions by their timing", () => {
    expect(stepAnswer("monster", "defences", draft)).toBe("AC 17 · HP 27 · 30 ft.");
    expect(stepAnswer("monster", "abilities", draft)).toBe("10 15 12 10 8 10");
    expect(stepAnswer("monster", "identity", draft)).toBe("Small Fey");
    expect(stepAnswer("monster", "traits", draft)).toBe("Nimble Escape");
    expect(stepAnswer("monster", "actions", draft)).toBe("Multiattack, Scimitar");
    expect(stepAnswer("monster", "reactions", draft)).toBe("Redirect Attack");
    expect(stepAnswer("monster", "bonus-actions", draft)).toBeNull();
  });

  it("say nothing for the other kinds this round", () => {
    expect(stepAnswer("spell", "identity", { name: "Fireball" })).toBeNull();
  });
});
