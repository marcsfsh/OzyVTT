import { describe, expect, it } from "vitest";
import { isDead } from "@vtt/domain";
import { CANT_SPEAK_TAG, endEffect } from "../src/effects.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import {
  answerSaveOf,
  catalog,
  druid,
  FOE,
  goliathFighter,
  HERO,
  resolverOf,
  table,
  turnOf
} from "./shape-shifters.js";

// The stat blocks that shape-shift (SRD 5.2.1): each one's printed forms, the actions printed for some forms only, a
// vampire's mist and bat and its Misty Escape, a lycanthrope's curse, and a dragon's Shapechange.

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

/** Dynamic vision on, with the scene in daylight. */
function inDaylight(fight: ReturnType<typeof table>) {
  Object.assign(fight.state.combat.vision, {
    enabled: true,
    ambient: "bright",
    sunlight: true,
    measure: { width: 1000, height: 1000, pixelsPerFoot: 10 }
  });
}

/** The next turn of `actorId`, so its Bonus Action is fresh. */
function nextTurnOf(fight: ReturnType<typeof table>, actorId: string) {
  fight.nextTurn();
  turnOf(fight, actorId);
}

const damage = (fight: ReturnType<typeof table>, actorId: string, amount: number, type = "slashing") =>
  applyDamageDetailed(
    fight.state,
    actorId,
    { amount, parts: [{ amount, type }], sourceActorId: HERO, sourceName: "Brakka" },
    { role: "gm" },
    { resolveDefinition: resolverOf(fight.state), catalog, newId: () => crypto.randomUUID() }
  );

describe("a werewolf's Shape-Shift", () => {
  it("offers its true form, its hybrid and its wolf, and takes the hybrid's Large size on the map", () => {
    const fight = table(goliathFighter(1), { [FOE]: "werewolf" });
    turnOf(fight, FOE);
    expect(fight.available(FOE, "shape-shift").forms?.options.map((option) => option.id)).toEqual([
      "true",
      "hybrid",
      "wolf"
    ]);
    fight.resolve(FOE, "shape-shift", { form: "hybrid" });
    expect(fight.actor(FOE).size).toBe("large");
    expect(tokenOf(fight, FOE).sizeCells).toBe(2);
    nextTurnOf(fight, FOE);
    fight.resolve(FOE, "shape-shift", { form: "true" });
    expect(fight.actor(FOE).size).toBe("medium");
    expect(tokenOf(fight, FOE).sizeCells).toBe(1);
    expect(fight.actor(FOE).effects.some((effect) => effect.form)).toBe(false);
  });

  it("bites only as a wolf or hybrid, and shoots its Longbow only in its true or hybrid form", () => {
    const fight = table(goliathFighter(1), { [FOE]: "werewolf" });
    turnOf(fight, FOE);
    expect(refusal(() => fight.resolve(FOE, "bite", { targetIds: [HERO] }))).toBe(
      "Bite works only in the wolf or hybrid form."
    );
    fight.resolve(FOE, "shape-shift", { form: "wolf" });
    expect(fight.actor(FOE).size).toBe("medium");
    expect(refusal(() => fight.resolve(FOE, "longbow", { targetIds: [HERO] }))).toBe(
      "Longbow works only in the true or hybrid form."
    );
    expect(fight.available(FOE, "bite").available).toBe(true);
  });

  it("curses a Humanoid that fails the Bite's save, and the cursed creature becomes a werewolf at 0 HP", () => {
    const fight = table(goliathFighter(1), { [FOE]: "werewolf" });
    turnOf(fight, FOE);
    fight.resolve(FOE, "shape-shift", { form: "wolf" });
    nextTurnOf(fight, FOE);
    fight.resolve(FOE, "bite", { targetIds: [HERO] }, [18, 4, 4]);
    expect(fight.state.combat.pendingSaves.map((save) => [save.ability, save.dc])).toEqual([["con", 12]]);
    answerSaveOf(fight, HERO, 3);
    const hero = fight.actor(HERO);
    expect(hero.effects.some((effect) => effect.tags.includes("lycanthropy-werewolf"))).toBe(true);
    damage(fight, HERO, hero.hp.current + hero.hp.temporary);
    const turned = fight.actor(HERO);
    expect(turned.hp.current).toBe(10);
    expect(isDead(turned)).toBe(false);
    expect(turned.conditions.some((condition) => condition.id === "unconscious")).toBe(false);
    expect(fight.actor(HERO).effects.find((effect) => effect.form)?.form?.statBlockId).toBe("werewolf");
    expect(fight.actor(HERO).size).toBe("medium");
  });

  it("opens no curse on a creature that isn't a Humanoid", () => {
    const fight = table(null, { [FOE]: "werewolf", [HERO]: "ogre" });
    turnOf(fight, FOE);
    fight.resolve(FOE, "shape-shift", { form: "hybrid" });
    nextTurnOf(fight, FOE);
    fight.resolve(FOE, "bite", { targetIds: [HERO] }, [18, 4, 4]);
    expect(fight.state.combat.pendingSaves).toHaveLength(0);
  });
});

describe("a vampire's Shape-Shift", () => {
  it("as mist: Medium, flying, no actions, and Resistance to all damage", () => {
    const fight = table(goliathFighter(1), { [FOE]: "vampire" });
    turnOf(fight, FOE);
    fight.resolve(FOE, "shape-shift", { form: "mist" });
    const vampire = fight.actor(FOE);
    expect(vampire.effects.find((effect) => effect.form)?.tags).toContain(CANT_SPEAK_TAG);
    expect(fight.definitionOf(FOE)?.extensions?.["open5e.srd-2024"]).toMatchObject({
      speeds: { walk: 5, fly: 20, hover: true }
    });
    expect(refusal(() => fight.resolve(FOE, "grave-strike", { targetIds: [HERO] }))).toMatch(
      /can't take actions in Mist form/
    );
    const before = vampire.hp.current;
    damage(fight, FOE, 20);
    expect(fight.actor(FOE).hp.current).toBe(before - 10);
  });

  it("as a bat: Tiny and speechless, and it can still Bite", () => {
    const fight = table(goliathFighter(1), { [FOE]: "vampire" });
    turnOf(fight, FOE);
    fight.resolve(FOE, "shape-shift", { form: "bat" });
    expect(fight.actor(FOE).size).toBe("tiny");
    expect(fight.actor(FOE).effects.find((effect) => effect.form)?.tags).toContain(CANT_SPEAK_TAG);
    expect(refusal(() => fight.resolve(FOE, "multiattack", {}))).toMatch(/works only in the true form/);
  });

  it("can't shape-shift in sunlight", () => {
    const fight = table(goliathFighter(1), { [FOE]: "vampire" });
    inDaylight(fight);
    turnOf(fight, FOE);
    expect(refusal(() => fight.resolve(FOE, "shape-shift", { form: "bat" }))).toBe(
      "Vampire can't shape-shift in sunlight."
    );
  });

  it("Misty Escape: at 0 HP it turns to mist and lives on, until the 2 hours end", () => {
    const fight = table(goliathFighter(1), { [FOE]: "vampire" });
    const result = damage(fight, FOE, 500);
    const vampire = fight.actor(FOE);
    expect(vampire.hp.current).toBe(0);
    expect(isDead(vampire)).toBe(false);
    const mist = vampire.effects.find((effect) => effect.form?.printedId === "mist")!;
    expect(mist.duration).toEqual({ type: "minutes", remaining: 120 });
    expect(result.events.map((event) => event.text).join(" ")).toMatch(/turns to mist with no action/);
    turnOf(fight, FOE);
    expect(refusal(() => fight.resolve(FOE, "shape-shift", { form: "true" }))).toMatch(/0 HP/);
    endEffect(fight.state, FOE, mist.id);
    expect(isDead(fight.actor(FOE))).toBe(true);
  });

  it("Misty Escape fails in sunlight, and the vampire is destroyed", () => {
    const fight = table(goliathFighter(1), { [FOE]: "vampire" });
    inDaylight(fight);
    damage(fight, FOE, 500);
    expect(isDead(fight.actor(FOE))).toBe(true);
  });
});

describe("the other printed forms", () => {
  it("an imp's raven flies 60 feet, and a succubus loses its Fly Speed in a Humanoid form", () => {
    const fight = table(druid(1), { [FOE]: "imp", ally: "succubus" });
    turnOf(fight, FOE);
    fight.resolve(FOE, "shape-shift", { form: "raven" });
    expect(fight.definitionOf(FOE)?.extensions?.["open5e.srd-2024"]).toMatchObject({
      speeds: { walk: 20, fly: 60 }
    });
    turnOf(fight, "ally");
    fight.resolve("ally", "shape-shift", { form: "small-humanoid" });
    expect(fight.actor("ally").size).toBe("small");
    const speeds = (fight.definitionOf("ally")?.extensions?.["open5e.srd-2024"] as { speeds: { fly: unknown } }).speeds;
    expect(speeds.fly ?? null).toBeNull();
  });

  it("refuses a form the stat block doesn't print", () => {
    const fight = table(druid(1), { [FOE]: "doppelganger" });
    turnOf(fight, FOE);
    expect(refusal(() => fight.resolve(FOE, "shape-shift", { form: "dragon" }))).toBe(
      "Shape-Shift has no dragon form."
    );
  });
});

describe("a dragon's Shapechange", () => {
  it("casts Shapechange from its Spellcasting into a Beast", () => {
    const fight = table(druid(1), { [FOE]: "adult-gold-dragon" });
    turnOf(fight, FOE);
    fight.resolve(FOE, "spellcasting-shapechange", { form: "brown-bear", gear: "worn" });
    const dragon = fight.actor(FOE);
    const bear = resolverOf(fight.state)("brown-bear")!;
    expect(fight.definitionOf(FOE)?.abilityScores.str).toBe(bear.abilityScores.str);
    expect(fight.actor(FOE).size).toBe(bear.size);
    expect(dragon.effects.find((effect) => effect.form)?.concentration).toBe(true);
  });
});
