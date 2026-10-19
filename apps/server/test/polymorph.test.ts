import { describe, expect, it } from "vitest";
import { applyDamageDetailed } from "../src/hit-points.js";
import { endEffect } from "../src/effects.js";
import { formEffectOf } from "../src/transform/forms.js";
import { setKnownForms } from "../src/transform/known-forms.js";
import { castOf } from "./spell-casters.js";
import { answerSaveOf, catalog, druid, FOE, HERO, resolverOf, table, turnOf } from "./shape-shifters.js";

// The spells that shape-shift a creature (SRD 5.2.1): Polymorph, True Polymorph's Creature into Creature, Shapechange
// and Animal Shapes, with Moonbeam's revert of a shape-shifted creature and the Shape-Shifting rule's defaults.

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal, got none");
};

/** Shapechange's material: "a jade circlet worth 1,500+ GP". */
const JADE_CIRCLET = { id: "jade-circlet", name: "Jade circlet", quantity: 1, equipped: false, attuned: false };

const damageDeps = (fight: ReturnType<typeof table>) => ({ resolveDefinition: resolverOf(fight.state), catalog });
const concentrating = (fight: ReturnType<typeof table>) =>
  fight.actor(HERO).effects.some((effect) => effect.tags.includes("concentrating"));

describe("Polymorph", () => {
  it("turns an ogre that fails its save into a Brown Bear with the bear's Hit Points as Temporary Hit Points", () => {
    const fight = table(druid(7), { [FOE]: "ogre" });
    const hp = { ...fight.actor(FOE).hp };
    fight.resolve(HERO, "spell-polymorph", { targetIds: [FOE], form: "brown-bear" });
    answerSaveOf(fight, FOE, 1);
    const ogre = fight.actor(FOE);
    const sheet = fight.definitionOf(FOE)!;
    expect(formEffectOf(ogre)?.form?.statBlockId).toBe("brown-bear");
    // "Its game statistics are replaced by the stat block of the chosen Beast": the bear's AC, attacks and scores.
    expect(ogre.armorClass).toBe(11);
    expect(sheet.actions.map((action) => action.id).sort()).toEqual(["bite", "claw", "multiattack"]);
    expect(sheet.abilityScores.int).toBe(2);
    // "Retains ... its creature type, Hit Points": the ogre's 68, and 22 Temporary Hit Points from the bear.
    expect(ogre.hp).toEqual({ ...hp, temporary: 22 });
    expect((sheet.extensions["open5e.srd-2024"] as { type: string }).type).toBe("giant");
    // It can't speak, so a spell with a Verbal component is closed to it.
    expect(ogre.effects.some((effect) => effect.tags.includes("cant-speak"))).toBe(true);
  });

  it("refuses a Beast whose Challenge Rating is higher than the target's, and a form that isn't a Beast", () => {
    const fight = table(druid(7), { [FOE]: "ogre" });
    expect(refusal(() => fight.resolve(HERO, "spell-polymorph", { targetIds: [FOE], form: "giant-scorpion" }))).toMatch(
      /Giant Scorpion has a Challenge Rating over 2/
    );
    expect(refusal(() => fight.resolve(HERO, "spell-polymorph", { targetIds: [FOE], form: "goblin-warrior" }))).toMatch(
      /isn't a Beast/
    );
  });

  it("changes nothing on a successful save", () => {
    const fight = table(druid(7), { [FOE]: "ogre" });
    fight.resolve(HERO, "spell-polymorph", { targetIds: [FOE], form: "brown-bear" });
    answerSaveOf(fight, FOE, 30);
    expect(formEffectOf(fight.actor(FOE))).toBeUndefined();
    expect(fight.actor(FOE).definitionId).toBe("ogre");
  });

  it("ends once the target has no Temporary Hit Points left, and the caster's Concentration with it", () => {
    const fight = table(druid(7), { [FOE]: "ogre" });
    fight.resolve(HERO, "spell-polymorph", { targetIds: [FOE], form: "brown-bear" });
    answerSaveOf(fight, FOE, 1);
    expect(concentrating(fight)).toBe(true);
    applyDamageDetailed(fight.state, FOE, { amount: 25 }, { role: "gm" }, damageDeps(fight));
    const ogre = fight.actor(FOE);
    // The overflow reaches its own Hit Points, and it is an ogre again.
    expect(ogre.hp.current).toBe(65);
    expect(formEffectOf(ogre)).toBeUndefined();
    expect(ogre.definitionId).toBe("ogre");
    expect(ogre.armorClass).toBe(11);
    expect(concentrating(fight)).toBe(false);
  });

  it("ends with the caster's Concentration, and the Temporary Hit Points left vanish", () => {
    const fight = table(druid(7), { [FOE]: "ogre" });
    fight.resolve(HERO, "spell-polymorph", { targetIds: [FOE], form: "brown-bear" });
    answerSaveOf(fight, FOE, 1);
    const held = fight.actor(HERO).effects.find((effect) => effect.tags.includes("concentrating"))!;
    endEffect(fight.state, HERO, held.id);
    expect(formEffectOf(fight.actor(FOE))).toBeUndefined();
    expect(fight.actor(FOE).hp.temporary).toBe(0);
  });
});

describe("True Polymorph: Creature into Creature", () => {
  it("lets a willing creature take the form with no save, and an unwilling one save", () => {
    const fight = table(druid(9), { [FOE]: "ogre" });
    const cast = castOf("true-polymorph");
    fight.resolve(HERO, cast, { targetIds: [HERO], form: "brown-bear" });
    expect(formEffectOf(fight.actor(HERO))?.form?.statBlockId).toBe("brown-bear");
    expect(fight.actor(HERO).hp.temporary).toBe(22);
    expect(fight.state.combat.pendingSaves).toHaveLength(0);
    turnOf(fight, HERO);
    fight.state.combat.turn.actionUsed = false;
    fight.resolve(HERO, castOf("true-polymorph"), { targetIds: [FOE], form: "giant-spider" });
    expect(fight.state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([FOE]);
  });

  it("allows any kind of creature up to the target's Challenge Rating", () => {
    const fight = table(druid(9), { [FOE]: "ogre" });
    fight.resolve(HERO, castOf("true-polymorph"), { targetIds: [FOE], form: "goblin-boss" });
    answerSaveOf(fight, FOE, 1);
    expect(formEffectOf(fight.actor(FOE))?.form?.statBlockId).toBe("goblin-boss");
  });
});

describe("Shapechange", () => {
  it("takes a creature of the caster's level or lower, keeping its mind and spellcasting", () => {
    const fight = table(druid(17), { [FOE]: "ogre" });
    fight.actor(HERO).inventory.push(JADE_CIRCLET);
    const wisdom = fight.definitionOf(HERO)!.abilityScores.wis;
    fight.resolve(HERO, "spell-shapechange", { form: "giant-ape", gear: "worn" });
    const hero = fight.actor(HERO);
    const sheet = fight.definitionOf(HERO)!;
    expect(formEffectOf(hero)?.form?.statBlockId).toBe("giant-ape");
    expect(sheet.abilityScores).toMatchObject({ str: 23, wis: wisdom });
    expect(hero.hp.temporary).toBe(168);
    expect(sheet.actions.some((action) => action.id === "spell-moonbeam")).toBe(true);
    expect(fight.available(HERO, "spell-moonbeam").violations.map((violation) => violation.rule)).not.toContain(
      "form.no-spells"
    );
    expect(concentrating(fight)).toBe(true);
  });

  it("refuses an Undead, a Construct, and a creature above the caster's level", () => {
    const fight = table(druid(17), { [FOE]: "ogre" });
    fight.actor(HERO).inventory.push(JADE_CIRCLET);
    expect(refusal(() => fight.resolve(HERO, "spell-shapechange", { form: "vampire" }))).toMatch(
      /Vampire is an Undead/
    );
    expect(refusal(() => fight.resolve(HERO, "spell-shapechange", { form: "ancient-red-dragon" }))).toMatch(
      /Challenge Rating over 17/
    );
  });

  it("shape-shifts again with a Magic action while the spell lasts, with no new Temporary Hit Points", () => {
    const fight = table(druid(17), { [FOE]: "ogre" });
    fight.actor(HERO).inventory.push(JADE_CIRCLET);
    fight.resolve(HERO, "spell-shapechange", { form: "giant-ape" });
    const castId = formEffectOf(fight.actor(HERO))?.castId;
    fight.actor(HERO).hp.temporary = 5;
    turnOf(fight, FOE);
    turnOf(fight, HERO);
    fight.resolve(HERO, "spell-shapechange-then-new-form", { form: "brown-bear" });
    const hero = fight.actor(HERO);
    expect(formEffectOf(hero)?.form?.statBlockId).toBe("brown-bear");
    expect(formEffectOf(hero)?.castId).toBe(castId);
    expect(hero.hp.temporary).toBe(5);
  });
});

describe("Animal Shapes", () => {
  it("turns each target into its own Beast, and a target ends its own form as a Bonus Action", () => {
    const fight = table(druid(15), { [FOE]: "ogre" });
    const wisdom = fight.definitionOf(HERO)!.abilityScores.wis;
    fight.resolve(HERO, "spell-animal-shapes", {
      targetIds: [HERO, FOE],
      targetForms: [
        { targetId: HERO, form: "brown-bear" },
        { targetId: FOE, form: "polar-bear" }
      ]
    });
    expect(formEffectOf(fight.actor(HERO))?.form?.statBlockId).toBe("brown-bear");
    expect(formEffectOf(fight.actor(FOE))?.form?.statBlockId).toBe("polar-bear");
    expect(fight.actor(FOE).hp.temporary).toBe(42);
    expect(fight.definitionOf(HERO)!.abilityScores.wis).toBe(wisdom);
    // "It can't cast spells": the form keeps none of the Druid's spells.
    expect(fight.definitionOf(HERO)!.actions.some((action) => action.spellId !== undefined)).toBe(false);
    turnOf(fight, FOE);
    turnOf(fight, HERO);
    fight.resolve(HERO, "leave-form", {});
    expect(formEffectOf(fight.actor(HERO))).toBeUndefined();
    expect(fight.actor(HERO).hp.temporary).toBe(0);
  });
});

describe("Animal Shapes' limits", () => {
  it("refuses a Huge Beast", () => {
    const fight = table(druid(15), { [FOE]: "ogre" });
    expect(
      refusal(() =>
        fight.resolve(HERO, "spell-animal-shapes", {
          targetIds: [FOE],
          targetForms: [{ targetId: FOE, form: "elephant" }]
        })
      )
    ).toMatch(/Elephant is larger than Large/);
  });
});

describe("Moonbeam on a shape-shifted creature", () => {
  it("returns a Wild Shaped Druid that fails to its true form, and it can't shape-shift again meanwhile", () => {
    const fight = table(druid(4), { [FOE]: "ogre" });
    setKnownForms(fight.state, HERO, ["wolf"], { resolveDefinition: resolverOf(fight.state), catalog }, true);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    turnOf(fight, FOE);
    fight.resolve(FOE, castOf("moonbeam"), { targetIds: [HERO] });
    answerSaveOf(fight, HERO, 1);
    const hero = fight.actor(HERO);
    expect(formEffectOf(hero)).toBeUndefined();
    expect(hero.effects.some((effect) => effect.tags.includes("no-shape-shift"))).toBe(true);
    turnOf(fight, HERO);
    expect(refusal(() => fight.resolve(HERO, "wild-shape", { form: "wolf" }))).toMatch(/can't shape-shift/);
  });
});

describe("Shape-Shifting", () => {
  it("reverts a creature that dies", () => {
    const fight = table(null, { [FOE]: "ogre", [HERO]: "goblin-warrior" });
    turnOf(fight, HERO);
    // The two monsters fight on one side, so the ogre is willing and makes no save.
    fight.resolve(HERO, castOf("true-polymorph"), { targetIds: [FOE], form: "goblin-boss" });
    const ogre = fight.actor(FOE);
    expect(formEffectOf(ogre)?.form?.statBlockId).toBe("goblin-boss");
    ogre.hp.temporary = 0;
    applyDamageDetailed(fight.state, FOE, { amount: 500 }, { role: "gm" }, damageDeps(fight));
    expect(formEffectOf(fight.actor(FOE))).toBeUndefined();
    expect(fight.actor(FOE).definitionId).toBe("ogre");
  });
});
