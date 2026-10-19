import { describe, expect, it } from "vitest";
import { checkPlan } from "../src/ability-checks.js";
import { endEffect } from "../src/effects.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { saveRollSources } from "../src/saving-throws.js";
import { answerSaveOf, catalog, druid, FOE, goliathFighter, HERO, table, turnOf } from "./shape-shifters.js";

// Size changes on the map (SRD 5.2.1): Enlarge/Reduce's one size larger or smaller, the Goliath's Large Form "if you're
// in a big enough space", and the Potions of Growth and Diminution. The creature's size moves every rule that reads it,
// and its token takes the new footprint, spreading right and down from its own space; ending the effect gives both
// back.

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal, got none");
};

const tokenOf = (fight: ReturnType<typeof table>, actorId: string) =>
  fight.state.combat.tokens.find((token) => token.actorId === actorId)!;
const derivationOf = (fight: ReturnType<typeof table>, actorId: string) =>
  deriveEquipment(fight.actor(actorId), fight.definitionOf(actorId), catalog);
const concentration = (fight: ReturnType<typeof table>) =>
  fight.actor(HERO).effects.find((effect) => effect.tags.includes("concentrating"))!;

describe("Enlarge/Reduce", () => {
  it("enlarges a willing creature with no save: Large on the map, Advantage on Strength saves", () => {
    const fight = table(druid(3), { [FOE]: "ogre" });
    const before = { ...tokenOf(fight, HERO).position! };
    fight.resolve(HERO, "spell-enlargereduce", { targetIds: [HERO], option: "enlarge" });
    expect(fight.state.combat.pendingSaves).toHaveLength(0);
    const hero = fight.actor(HERO);
    expect(hero.size).toBe("large");
    expect(hero.sizeCells).toBe(2);
    // The token grows right and down from the cell it stood in.
    expect(tokenOf(fight, HERO)).toMatchObject({ sizeCells: 2, position: { x: before.x + 25, y: before.y + 25 } });
    const sources = saveRollSources(hero, "str", derivationOf(fight, HERO));
    expect(sources.advantage.length).toBeGreaterThan(0);
    // It ends with the caster's Concentration, and the size comes back.
    endEffect(fight.state, HERO, concentration(fight).id);
    expect(fight.actor(HERO).size).toBe("medium");
    expect(tokenOf(fight, HERO)).toMatchObject({ sizeCells: 1, position: before });
  });

  it("adds 1d4 to an enlarged creature's weapon hits", () => {
    const fight = table(druid(3), { [FOE]: "ogre" });
    fight.resolve(HERO, "spell-enlargereduce", { targetIds: [HERO], option: "enlarge" });
    turnOf(fight, FOE);
    turnOf(fight, HERO);
    const swing = effectiveActions(fight.definitionOf(HERO), fight.actor(HERO), catalog).find(
      (action) => action.id.startsWith("item-") && action.attack?.reachFeet !== undefined
    )!;
    const hit = fight.resolve(HERO, swing.id, { targetIds: [FOE] }, [18]);
    // The weapon's own die, then Enlarged's 1d4 of the weapon's type.
    expect(hit.damage.map((part) => part.formula)).toEqual([swing.damage[0]!.formula, "1d4"]);
    expect(hit.warnings).toContain("Enlarged: +4 slashing.");
  });

  it("reduces an unwilling ogre that fails its save, with Disadvantage on its Strength checks", () => {
    const fight = table(druid(3), { [FOE]: "ogre" });
    fight.resolve(HERO, "spell-enlargereduce", { targetIds: [FOE], option: "reduce" });
    expect(fight.state.combat.pendingSaves.map((save) => save.ability)).toEqual(["con"]);
    answerSaveOf(fight, FOE, 1);
    const ogre = fight.actor(FOE);
    expect(ogre.size).toBe("medium");
    expect(tokenOf(fight, FOE).sizeCells).toBe(1);
    const plan = checkPlan(ogre, fight.definitionOf(FOE), derivationOf(fight, FOE), {
      ability: "str",
      skill: "athletics"
    });
    expect(plan.rollMode.mode).toBe("disadvantage");
    endEffect(fight.state, HERO, concentration(fight).id);
    expect(fight.actor(FOE).size).toBe("large");
    expect(tokenOf(fight, FOE).sizeCells).toBe(2);
  });

  it("refuses an option the spell doesn't have", () => {
    const fight = table(druid(3), { [FOE]: "ogre" });
    expect(refusal(() => fight.resolve(HERO, "spell-enlargereduce", { targetIds: [HERO], option: "shrink" }))).toMatch(
      /offers Enlarge or Reduce/
    );
  });
});

describe("Large Form (Goliath)", () => {
  it("makes the Goliath Large for 10 minutes, then Medium again", () => {
    const fight = table(goliathFighter(5), { [FOE]: "ogre" });
    fight.resolve(HERO, "large-form", {});
    const hero = fight.actor(HERO);
    expect(hero.size).toBe("large");
    expect(tokenOf(fight, HERO).sizeCells).toBe(2);
    const effect = hero.effects.find((entry) => entry.tags.includes("large-form"))!;
    expect(effect.duration).toEqual({ type: "rounds", remaining: 100 });
    endEffect(fight.state, HERO, effect.id);
    expect(fight.actor(HERO).size).toBe("medium");
    expect(tokenOf(fight, HERO).sizeCells).toBe(1);
  });

  it("is refused where there is no room", () => {
    const fight = table(goliathFighter(5), { [FOE]: "goblin-warrior" });
    const hero = tokenOf(fight, HERO);
    tokenOf(fight, FOE).position = { x: hero.position!.x + 50, y: hero.position!.y };
    expect(refusal(() => fight.resolve(HERO, "large-form", {}))).toMatch(
      /isn't in a big enough space to become Large: Goblin Warrior is in the way/
    );
    expect(fight.actor(HERO).size).toBe("medium");
  });
});

describe("Potions of Growth and Diminution", () => {
  const drink = (fight: ReturnType<typeof table>, itemId: string) => {
    const action = effectiveActions(fight.definitionOf(HERO), fight.actor(HERO), catalog).find(
      (entry) => entry.id.startsWith(`item-${itemId}`) && entry.name.startsWith("Drink")
    )!;
    return fight.resolve(HERO, action.id, {});
  };

  it("Growth: one size larger for 10 minutes, with Advantage on Strength saves", () => {
    const fight = table(goliathFighter(1), { [FOE]: "ogre" });
    fight.actor(HERO).inventory.push({
      id: "potion-of-growth",
      name: "Potion of Growth",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    drink(fight, "potion-of-growth");
    const hero = fight.actor(HERO);
    expect(hero.size).toBe("large");
    expect(hero.effects.find((effect) => effect.name === "Potion of Growth")?.duration).toEqual({
      type: "rounds",
      remaining: 100
    });
    expect(saveRollSources(hero, "str", derivationOf(fight, HERO)).advantage.length).toBeGreaterThan(0);
  });

  it("Diminution: one size smaller for 1d4 hours, rolled as it is drunk", () => {
    const fight = table(goliathFighter(1), { [FOE]: "ogre" });
    fight.actor(HERO).inventory.push({
      id: "potion-of-diminution",
      name: "Potion of Diminution",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    drink(fight, "potion-of-diminution");
    const hero = fight.actor(HERO);
    expect(hero.size).toBe("small");
    expect(tokenOf(fight, HERO).sizeCells).toBe(1);
    // The table's dice give 10s, and a d4 tops out at 4.
    const duration = hero.effects.find((effect) => effect.name === "Potion of Diminution")?.duration;
    expect(duration?.type).toBe("minutes");
    expect((duration as { remaining: number }).remaining % 60).toBe(0);
  });
});
