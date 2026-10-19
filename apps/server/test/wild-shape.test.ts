import { describe, expect, it } from "vitest";
import { setCondition } from "../src/actor-conditions.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { applyRest } from "../src/rests.js";
import { formEffectOf } from "../src/transform/forms.js";
import { setKnownForms } from "../src/transform/known-forms.js";
import { catalog, druid, FOE, HERO, resolverOf, table } from "./shape-shifters.js";

// SRD 5.2.1 Druid, Wild Shape: "As a Bonus Action, you shape-shift into a Beast form that you have learned for this
// feature. You stay in that form for a number of hours equal to half your Druid level or until you use Wild Shape
// again, have the Incapacitated condition, or die. You can also leave the form early as a Bonus Action." Each clause
// the engine runs is pinned below, with Known Forms, the rules while shape-shifted, Primal Strike and Beast Spells.

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal, got none");
};

/** A Druid of `level` in a fight with an ogre, knowing `forms`. */
function druidTable(level: number, forms: readonly string[]) {
  const fight = table(druid(level), { [FOE]: "ogre" });
  setKnownForms(fight.state, HERO, forms, { resolveDefinition: resolverOf(fight.state), catalog }, true);
  return fight;
}

const deps = (fight: ReturnType<typeof table>) => ({ resolveDefinition: resolverOf(fight.state), catalog });

describe("Known Forms: Beast stat blocks within the Beast Shapes table", () => {
  it("takes four Beasts of CR 1/4 or lower with no Fly Speed at Druid level 2", () => {
    const fight = table(druid(2));
    setKnownForms(fight.state, HERO, ["wolf", "rat", "spider", "riding-horse"], deps(fight), false);
    expect(fight.actor(HERO).knownForms?.ids).toEqual(["wolf", "rat", "spider", "riding-horse"]);
    // A fifth form, a Fly Speed and a Challenge Rating over 1/4 are each refused.
    expect(
      refusal(() =>
        setKnownForms(fight.state, HERO, ["wolf", "rat", "spider", "riding-horse", "boar"], deps(fight), false)
      )
    ).toMatch(/knows 4 forms/);
    const empty = table(druid(2));
    expect(refusal(() => setKnownForms(empty.state, HERO, ["pteranodon"], deps(empty), false))).toMatch(/no Fly Speed/);
    expect(refusal(() => setKnownForms(empty.state, HERO, ["brown-bear"], deps(empty), false))).toMatch(
      /CR 1\/4 or lower/
    );
    // A Giant Eagle is a Celestial in SRD 5.2.1, so it is no Beast form at any level.
    expect(refusal(() => setKnownForms(empty.state, HERO, ["giant-eagle"], deps(empty), false))).toMatch(
      /isn't an eligible form/
    );
  });

  it("lets a Druid 8 know eight forms of CR 1, flying ones among them", () => {
    const fight = table(druid(8));
    setKnownForms(fight.state, HERO, ["pteranodon", "brown-bear", "dire-wolf"], deps(fight), false);
    expect(fight.actor(HERO).knownForms?.ids).toEqual(["pteranodon", "brown-bear", "dire-wolf"]);
  });

  it("replaces one known form after each Long Rest", () => {
    const fight = table(druid(2), {}, { combat: false });
    setKnownForms(fight.state, HERO, ["wolf", "rat"], deps(fight), false);
    // Filling an empty place is free; replacing a known form waits for a Long Rest.
    setKnownForms(fight.state, HERO, ["wolf", "rat", "spider"], deps(fight), false);
    expect(refusal(() => setKnownForms(fight.state, HERO, ["boar", "rat", "spider"], deps(fight), false))).toMatch(
      /only after finishing a Long Rest/
    );
    applyRest(fight.state, HERO, "long", resolverOf(fight.state), catalog);
    expect(fight.actor(HERO).knownForms?.swapOpen).toBe(true);
    expect(refusal(() => setKnownForms(fight.state, HERO, ["boar", "mule", "spider"], deps(fight), false))).toMatch(
      /one at a time/
    );
    setKnownForms(fight.state, HERO, ["boar", "rat", "spider"], deps(fight), false);
    expect(fight.actor(HERO).knownForms).toEqual({ ids: ["boar", "rat", "spider"], swapOpen: false });
  });
});

describe("Wild Shape: taking a known form", () => {
  it("gives the Wolf's statistics while the Druid keeps its Hit Points, mind and features", () => {
    const fight = druidTable(2, ["wolf"]);
    const before = { ...fight.actor(HERO).hp };
    const wisdom = fight.definitionOf(HERO)!.abilityScores.wis;
    const result = fight.resolve(HERO, "wild-shape", { form: "wolf" });
    expect(result.activation).toBe("bonus-action");
    const hero = fight.actor(HERO);
    const sheet = fight.definitionOf(HERO)!;
    // "Your game statistics are replaced by the Beast's stat block": AC 12, Speed 40, STR 14, DEX 15, CON 12, its Bite.
    expect(hero.armorClass).toBe(12);
    expect(hero.speedFeet).toBe(40);
    expect(sheet.abilityScores).toMatchObject({ str: 14, dex: 15, con: 12, wis: wisdom });
    expect(sheet.actions.some((action) => action.id === "bite" && action.attack?.bonus === 4)).toBe(true);
    // "You retain your ... Hit Points ... class features", and Temporary Hit Points equal to the Druid level.
    expect(hero.hp).toEqual({ ...before, temporary: 2 });
    expect(sheet.character?.features?.some((feature) => feature.id === "wild-shape")).toBe(true);
    // Hours equal to half the Druid level, and a Bonus Action to leave early.
    expect(formEffectOf(hero)?.duration).toEqual({ type: "minutes", remaining: 60 });
    expect(sheet.actions.find((action) => action.id === "leave-form")?.activation).toBe("bonus-action");
    expect(fight.state.combat.turn.bonusActionUsed).toBe(true);
  });

  it("refuses a form the Druid doesn't know, and asks for known forms first", () => {
    const none = table(druid(2), { [FOE]: "ogre" });
    expect(refusal(() => none.resolve(HERO, "wild-shape", { form: "wolf" }))).toMatch(/knows no forms yet/);
    const fight = druidTable(2, ["wolf"]);
    expect(refusal(() => fight.resolve(HERO, "wild-shape", { form: "rat" }))).toMatch(
      /isn't one of Maelin's known forms/
    );
  });

  it("melds the gear by default, so the Druid's weapons and armor give nothing", () => {
    const fight = druidTable(2, ["wolf"]);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    const ids = fight.available(HERO, "bite").id;
    expect(ids).toBe("bite");
    const swings = fight.state.actors.find((actor) => actor.id === HERO)!;
    expect(formEffectOf(swings)?.form?.gear).toBe("merged");
  });

  it("keeps a condition the Druid had: what was on it carries over", () => {
    const fight = druidTable(2, ["wolf"]);
    setCondition(fight.state, HERO, "frightened", true, undefined, { role: "gm" });
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    expect(fight.actor(HERO).conditions.map((condition) => condition.id)).toContain("frightened");
  });

  it("can't cast spells in the form", () => {
    const fight = druidTable(2, ["wolf"]);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    const flame = fight.available(HERO, "spell-produce-flame");
    expect(flame.available).toBe(false);
    expect(flame.violations.map((violation) => violation.rule)).toContain("form.no-spells");
    expect(flame.reason).toBe("You can't cast spells in this form.");
  });
});

describe("Wild Shape: what ends the form", () => {
  it("ends when the Druid has the Incapacitated condition, giving back its own statistics", () => {
    const fight = druidTable(2, ["wolf"]);
    const armorClass = fight.actor(HERO).armorClass;
    const trueId = fight.actor(HERO).definitionId;
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    setCondition(fight.state, HERO, "stunned", true, undefined, { role: "gm" });
    const hero = fight.actor(HERO);
    expect(formEffectOf(hero)).toBeUndefined();
    expect(hero.definitionId).toBe(trueId);
    expect(hero.armorClass).toBe(armorClass);
    expect(hero.speedFeet).toBe(30);
    expect(fight.state.definitions.some((entry) => entry.id.startsWith("form-"))).toBe(false);
  });

  it("ends early as a Bonus Action", () => {
    const fight = druidTable(2, ["wolf"]);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    fight.nextTurn();
    fight.nextTurn();
    fight.resolve(HERO, "leave-form", {});
    expect(formEffectOf(fight.actor(HERO))).toBeUndefined();
    expect(fight.state.combat.turn.bonusActionUsed).toBe(true);
  });

  it("ends when Wild Shape is used again, for the new form", () => {
    const fight = druidTable(4, ["wolf", "boar"]);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    fight.nextTurn();
    fight.nextTurn();
    fight.resolve(HERO, "wild-shape", { form: "boar" });
    const hero = fight.actor(HERO);
    expect(hero.effects.filter((effect) => effect.form)).toHaveLength(1);
    expect(formEffectOf(hero)?.form?.statBlockId).toBe("boar");
    expect(hero.armorClass).toBe(11);
  });

  it("ends on dropping to 0 Hit Points, which leaves the Druid Unconscious", () => {
    const fight = druidTable(2, ["wolf"]);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    const hero = fight.actor(HERO);
    applyDamageDetailed(fight.state, HERO, { amount: hero.hp.current + 2 }, { role: "gm" }, deps(fight));
    expect(hero.hp.current).toBe(0);
    expect(formEffectOf(fight.actor(HERO))).toBeUndefined();
    expect(fight.actor(HERO).armorClass).not.toBe(12);
  });
});

describe("Elemental Fury's Primal Strike in Wild Shape", () => {
  it("rides a hit with a Beast form's attack", () => {
    const fight = druidTable(7, ["wolf"]);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    fight.nextTurn();
    fight.nextTurn();
    const preview = fight.resolve(HERO, "bite", { targetIds: [FOE], commit: false }, [15]);
    expect((preview.hitOffers ?? []).map((offer) => offer.id)).toContain("primal-strike");
  });
});

describe("Beast Spells", () => {
  it("lets a Druid 18 cast in a Beast form, except a spell with a costly or consumed Material component", () => {
    const fight = druidTable(18, ["wolf"]);
    fight.resolve(HERO, "wild-shape", { form: "wolf" });
    fight.nextTurn();
    fight.nextTurn();
    expect(fight.available(HERO, "spell-moonbeam").violations.map((violation) => violation.rule)).not.toContain(
      "form.no-spells"
    );
    const revivify = fight.available(HERO, "spell-revivify");
    expect(revivify.violations.find((violation) => violation.rule === "form.no-spells")?.message).toMatch(
      /Beast Spells leaves out a spell whose Material component has a cost or is consumed/
    );
  });
});
