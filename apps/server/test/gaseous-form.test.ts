import { describe, expect, it } from "vitest";
import { setAltitude } from "../src/altitude.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { endEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
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

  it("lets a target become a cloud again with a Magic action, Stunned for the minute it takes, while the spell lasts", () => {
    const fight = table(
      druid(11, [{ level: 1, kind: "spell", id: "wind-walk" }]),
      { [FOE]: "ogre" },
      { combat: false }
    );
    fight.resolve(HERO, "spell-wind-walk", { targetIds: [HERO] });
    const spell = fight.actor(HERO).effects.find((effect) => effect.grantedSpellAction?.spellId === "wind-walk")!;
    expect(spell).toMatchObject({ name: "Wind Walk", duration: { type: "minutes", remaining: 480 } });
    fight.resolve(HERO, "leave-form", {});
    expect(formOf(fight, HERO)).toBeUndefined();
    // A minute later it has reverted.
    const reverting = fight.actor(HERO).effects.find((effect) => effect.name === "Reverting to its normal form")!;
    endEffect(fight.state, HERO, reverting.id);
    const again = effectiveActions(fight.definitionOf(HERO), fight.actor(HERO), catalog).find(
      (entry) => entry.id === "spell-wind-walk-then-cloud-form"
    )!;
    expect(again.activation).toBe("action");
    fight.resolve(HERO, again, {});
    expect(formOf(fight, HERO)?.form?.printedId).toBe("cloud");
    expect(formOf(fight, HERO)?.duration).toEqual(spell.duration);
    const transforming = fight.actor(HERO).effects.find((effect) => effect.name === "Transforming into Cloud")!;
    expect(transforming).toMatchObject({ duration: { type: "rounds", remaining: 10 }, linkedConditionIds: ["stunned"] });
  });

  it("lowers a cloud still aloft when its form ends, landing it safely within 600 feet and dropping it the rest", () => {
    const fight = table(
      druid(11, [{ level: 1, kind: "spell", id: "wind-walk" }]),
      { [FOE]: "ogre" },
      { combat: false }
    );
    fight.resolve(HERO, "spell-wind-walk", { targetIds: [HERO] });
    startEncounter(
      fight.state,
      { mapAssetId: "20000000-0000-5000-8000-000000000001", entries: [{ actorId: HERO, score: 20 }] },
      () => 1,
      { width: 1000, height: 1000, calibration: null }
    );
    const token = () => fight.state.combat.tokens.find((entry) => entry.actorId === HERO)!;
    token().position = { x: 125, y: 125 };
    setAltitude(fight.state, HERO, 120, "fly");
    endEffect(fight.state, HERO, formOf(fight, HERO)!.id);
    // Held up as a gentle descent, which the next settle lands safely.
    expect(token()).toMatchObject({ altitudeFeet: 120, airborne: "levitate" });
    fight.resolve(HERO, "spell-wind-walk-then-cloud-form", {});
    setAltitude(fight.state, HERO, 900, "fly");
    endEffect(fight.state, HERO, formOf(fight, HERO)!.id);
    // A minute of 60 feet a round brings it 600 feet down; it falls the last 300.
    expect(token()).toMatchObject({ altitudeFeet: 300, airborne: "fly" });
  });
});
