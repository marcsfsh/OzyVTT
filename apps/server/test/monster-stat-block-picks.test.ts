import { describe, expect, it } from "vitest";
import { checkPlan } from "../src/ability-checks.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { CommandRejectedError } from "../src/game-store.js";
import { setStatBlockPick } from "../src/statblock-picks.js";
import { actor, IDS, table, use } from "./monster-table.js";

// What a stat block leaves to the GM for each creature (SRD 5.2.1): a half-dragon's Draconic Origin damage type, which
// its Claw and Dragon's Breath deal, and a commoner's Training skill, rolled with proficiency and Advantage.

const monsterOf = (built: ReturnType<typeof table>) => actor(built, IDS.monster);

describe("a half-dragon's Draconic Origin", () => {
  it("is one type for the creature: its Claw adds 2d6 of it and its breath deals it every time", () => {
    const built = table("half-dragon");
    setStatBlockPick(monsterOf(built), built.definition, "draconic-origin", "cold");
    const claw = use(built, "claw", [IDS.hero], [15, 2, 3, 3]);
    expect(claw.damageTargets?.[0]?.parts ?? claw.damage).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "slashing" }), expect.objectContaining({ type: "cold" })])
    );
    built.state.combat = {
      ...built.state.combat,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    use(built, "dragon-s-breath", [IDS.hero], [4, 4, 4, 4, 4, 4, 4, 4]);
    expect(built.state.combat.pendingSaves).toMatchObject([
      { proposedDamage: 32, proposedDamageParts: [{ type: "cold", amount: 32 }] }
    ]);
  });

  it("must be chosen before an action that deals its type", () => {
    const built = table("half-dragon");
    expect(() => use(built, "claw", [IDS.hero], [15])).toThrow(
      "Choose Half-Dragon's Draconic Origin in its row tools first: Claw deals the damage type it names."
    );
  });

  it("takes only a type the trait lists", () => {
    const built = table("half-dragon");
    expect(() => setStatBlockPick(monsterOf(built), built.definition, "draconic-origin", "thunder")).toThrow(
      CommandRejectedError
    );
    expect(() => setStatBlockPick(monsterOf(built), built.definition, "training", "athletics")).toThrow(
      /leaves no such choice/
    );
    setStatBlockPick(monsterOf(built), built.definition, "draconic-origin", "acid");
    setStatBlockPick(monsterOf(built), built.definition, "draconic-origin", null);
    expect(monsterOf(built).statBlockPicks).toBeUndefined();
  });
});

describe("a commoner's Training", () => {
  it("rolls the chosen skill with proficiency and Advantage, and other skills as before", () => {
    const built = table("commoner");
    const commoner = monsterOf(built);
    const plan = (skill: string) =>
      checkPlan(commoner, built.definition, deriveEquipment(commoner, built.definition, undefined), {
        ability: "str",
        skill
      });
    const before = plan("athletics");
    expect(before.rollMode.mode).toBe("normal");
    setStatBlockPick(commoner, built.definition, "training", "athletics");
    const trained = plan("athletics");
    expect(trained.proficient).toBe(true);
    expect(trained.modifier).toBe(before.modifier + built.definition.proficiencyBonus);
    expect(trained.rollMode.mode).toBe("advantage");
    expect(plan("intimidation").rollMode.mode).toBe("normal");
  });
});
