import { describe, expect, it } from "vitest";
import { builtinActionFor } from "../src/builtin-actions.js";
import { effectiveActions } from "../src/effective-actions.js";
import { formViolations } from "../src/transform/rules.js";
import { spaceSharingFor } from "../src/space-sharing.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { saveRollSources } from "../src/saving-throws.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { catalog, druid, FOE, goliathFighter, HERO, resolverOf, table, turnOf } from "./shape-shifters.js";

// Forms that change only what a creature can do and how it moves (SRD 5.2.1): Gaseous Form's misty cloud, the Potion
// of Gaseous Form that gives it for an hour, and Wind Walk's cloud.

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal, got none");
};

const speedsOf = (fight: ReturnType<typeof table>, actorId: string) =>
  (fight.definitionOf(actorId)?.extensions?.["open5e.srd-2024"] as { speeds?: Record<string, unknown> } | undefined)
    ?.speeds;

const damage = (fight: ReturnType<typeof table>, actorId: string, amount: number, type = "slashing") =>
  applyDamageDetailed(
    fight.state,
    actorId,
    { amount, parts: [{ amount, type }], sourceActorId: FOE, sourceName: "Ogre" },
    { role: "gm" },
    { resolveDefinition: resolverOf(fight.state), catalog, newId: () => crypto.randomUUID() }
  );

const formOf = (fight: ReturnType<typeof table>, actorId: string) =>
  fight.actor(actorId).effects.find((effect) => effect.form);

describe("Gaseous Form", () => {
  it("a cloud giant's cast: a Fly Speed of 10 that hovers, Resistance, no Prone, and no attacks", () => {
    const fight = table(goliathFighter(1), { [FOE]: "cloud-giant" });
    turnOf(fight, FOE);
    fight.resolve(FOE, "spellcasting-gaseous-form", { targetIds: [FOE] });
    const form = formOf(fight, FOE)!;
    expect(form.form?.printedId).toBe("misty-cloud");
    expect(form.conditionImmunities).toEqual(["prone"]);
    expect(speedsOf(fight, FOE)).toMatchObject({ walk: 0, fly: 10, hover: true });
    expect(fight.actor(FOE).speedFeet).toBe(0);
    expect(refusal(() => fight.resolve(FOE, "thunderous-mace", { targetIds: [HERO] }))).toMatch(
      /can't attack in Misty cloud form/
    );
    const before = fight.actor(FOE).hp.current;
    damage(fight, FOE, 20);
    expect(fight.actor(FOE).hp.current).toBe(before - 10);
    const derivation = deriveEquipment(fight.actor(FOE), fight.definitionOf(FOE), catalog);
    expect(saveRollSources(fight.actor(FOE), "dex", derivation).advantage.length).toBeGreaterThan(0);
    // "The target can enter and occupy the space of another creature."
    expect(spaceSharingFor(fight.state, FOE, resolverOf(fight.state), () => false).passesCreatures).toBe(true);
    expect(spaceSharingFor(fight.state, HERO, resolverOf(fight.state), () => false).passesCreatures).toBeUndefined();
  });
});

describe("Potion of Gaseous Form", () => {
  const drink = (fight: ReturnType<typeof table>) => {
    fight.actor(HERO).inventory.push({
      id: "potion-of-gaseous-form",
      name: "Potion of Gaseous Form",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    const action = effectiveActions(fight.definitionOf(HERO), fight.actor(HERO), catalog).find(
      (entry) => entry.id.startsWith("item-potion-of-gaseous-form") && entry.name.startsWith("Drink")
    )!;
    return fight.resolve(HERO, action.id, {});
  };

  it("gives the misty cloud for an hour, with no Concentration, ended as a Bonus Action", () => {
    const fight = table(goliathFighter(1), { [FOE]: "ogre" });
    const speed = fight.actor(HERO).speedFeet;
    drink(fight);
    const form = formOf(fight, HERO)!;
    expect(form.duration).toEqual({ type: "minutes", remaining: 60 });
    expect(form.concentration).toBe(false);
    const leave = effectiveActions(fight.definitionOf(HERO), fight.actor(HERO), catalog).find(
      (entry) => entry.id === "leave-form"
    )!;
    expect(leave.activation).toBe("bonus-action");
    turnOf(fight, HERO);
    fight.nextTurn();
    turnOf(fight, HERO);
    fight.resolve(HERO, leave, {});
    expect(formOf(fight, HERO)).toBeUndefined();
    expect(fight.actor(HERO).speedFeet).toBe(speed);
  });

  it("ends when the drinker drops to 0 Hit Points", () => {
    const fight = table(goliathFighter(1), { [FOE]: "ogre" });
    drink(fight);
    damage(fight, HERO, fight.actor(HERO).hp.current * 2 + 4);
    expect(formOf(fight, HERO)).toBeUndefined();
  });
});

describe("Wind Walk", () => {
  it("a cloud that flies 300 feet, can only Dash or revert, and is Stunned for a minute as it reverts", () => {
    // A cast of a minute completes at once outside a fight.
    const fight = table(
      druid(11, [{ level: 1, kind: "spell", id: "wind-walk" }]),
      { [FOE]: "ogre" },
      { combat: false }
    );
    fight.resolve(HERO, "spell-wind-walk", { targetIds: [HERO] });
    expect(formOf(fight, HERO)?.form?.printedId).toBe("cloud");
    expect(speedsOf(fight, HERO)).toMatchObject({ walk: 0, fly: 300, hover: true });
    // What the form forbids, as the economy checks it on a turn.
    const rulesFor = (actionId: string) =>
      formViolations(
        fight.actor(HERO),
        effectiveActions(fight.definitionOf(HERO), fight.actor(HERO), catalog).find((entry) => entry.id === actionId) ??
          builtinActionFor(fight.definitionOf(HERO), actionId)!,
        fight.definitionOf(HERO),
        undefined
      ).map((violation) => violation.rule);
    expect(rulesFor("spell-entangle")).toEqual(["form.no-actions"]);
    expect(rulesFor("dash")).toEqual([]);
    expect(rulesFor("leave-form")).toEqual([]);
    fight.resolve(HERO, "leave-form", {});
    expect(formOf(fight, HERO)).toBeUndefined();
    const reverting = fight.actor(HERO).effects.find((effect) => effect.name === "Reverting to its normal form")!;
    expect(reverting.duration).toEqual({ type: "rounds", remaining: 10 });
    expect(fight.actor(HERO).conditions.map((condition) => condition.id)).toContain("stunned");
  });
});
