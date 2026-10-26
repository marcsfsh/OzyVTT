import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { makeEffect } from "../src/effects.js";
import { confusedTurn, gibberingTurn } from "../src/random-outcomes.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { actorOf, answer, cast, caster, resolveAs, wizard } from "./spell-lifetimes-kit.js";
import { FOE, FOE2, HERO, heroTurnAgain } from "./spell-casters.js";

// Tables the server rolls on (SRD 5.2.1): Prismatic Spray's ray per creature, Confusion's d10 each turn, Gibbering's
// d8 and Chromatic Orb's leap.

const twelve = (face: number) => Array.from({ length: 12 }, () => face);
/** The costly materials (tokens, oils, a diamond) are the components rules' business, waived here. */
const waived = { override: { families: ["components" as const], reason: "In the pack." } };

describe("Prismatic Spray", () => {
  it("rolls a ray for each creature: a colour's damage, and two rays on an 8", () => {
    const fight = caster();
    // 12d6 of 3s, then the Goblin's d8 shows 1 (Red) and the Orc's 8, then 2 (Orange) and 8 again, rerolled to 5 (Blue).
    cast(fight, "prismatic-spray", { targetIds: [FOE, FOE2] }, [...twelve(3), 1, 8, 2, 8, 5]);
    expect(
      fight.state.combat.pendingSaves.map((save) => [save.targetActorId, save.actionName, save.proposedDamageParts])
    ).toEqual([
      [FOE, "Prismatic Spray (Red ray)", [{ amount: 36, type: "fire" }]],
      [FOE2, "Prismatic Spray (Orange ray)", [{ amount: 36, type: "acid" }]],
      [FOE2, "Prismatic Spray (Blue ray)", [{ amount: 36, type: "cold" }]]
    ]);
  });

  it("restrains on the Indigo ray, with a Constitution save each turn until three successes or three failures", () => {
    const fight = caster();
    cast(fight, "prismatic-spray", { targetIds: [FOE] }, [...twelve(3), 6]);
    answer(fight.state, FOE, 2);
    expect(actorOf(fight.state, FOE).effects).toMatchObject([
      {
        linkedConditionIds: ["restrained"],
        repeatSave: { ability: "con", tally: { needed: 3 }, next: { linkedConditionIds: ["petrified"] } }
      }
    ]);
  });

  // The save at the start of the caster's next turn is pinned in spell-later-actions.test.ts.
  it("blinds on the Violet ray until a Wisdom save at the start of the caster's next turn", () => {
    const fight = caster();
    cast(fight, "prismatic-spray", { targetIds: [FOE] }, [...twelve(3), 7]);
    answer(fight.state, FOE, 2);
    expect(actorOf(fight.state, FOE).effects).toMatchObject([
      { linkedConditionIds: ["blinded"], repeatSave: { ability: "wis", timing: "source-turn-start", once: true } }
    ]);
  });
});

describe("Confusion", () => {
  it("leaves no Bonus Actions or Reactions and a repeat save, and rolls a d10 at the start of each turn", () => {
    const fight = caster();
    cast(fight, "confusion", { targetIds: [FOE] });
    answer(fight.state, FOE, 2);
    expect(actorOf(fight.state, FOE).effects).toMatchObject([
      { name: "Confusion", tags: ["confused", "no-bonus-actions", "no-reactions"], repeatSave: { ability: "wis" } }
    ]);
    const dazed = confusedTurn(fight.state, FOE, () => 4);
    expect(dazed.map((event) => event.text)).toEqual([
      "Goblin rolls 4 on the d10 for Confusion: it doesn't move or take actions this turn."
    ]);
    expect(actorOf(fight.state, FOE).effects[1]).toMatchObject({
      name: "Confusion: stands dazed",
      tags: ["no-actions"],
      speedZero: true,
      duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false }
    });
    // A 1 sends it wandering in the d4's direction, with all its movement.
    const faces = [1, 3];
    expect(confusedTurn(fight.state, FOE, () => faces.shift()!)[0]?.text).toMatch(/move south\.$/);
    expect(actorOf(fight.state, FOE).effects[1]?.compelled).toEqual({
      way: "heading",
      heading: 180,
      allMovement: true,
      once: true
    });
  });

  it("picks a random creature within reach on a 7 or 8, and refuses any other swing", () => {
    const fight = caster();
    cast(fight, "confusion", { targetIds: [HERO] });
    answer(fight.state, HERO, 2);
    heroTurnAgain(fight.state);
    // The Goblin stands within 5 feet of the wizard, the Orc 30 feet off: the d10 shows 7 and the pick is the first.
    const faces = [7, 1];
    const lashed = confusedTurn(fight.state, HERO, () => faces.shift()!, {
      distanceFeet: (a, b) => (a === HERO && b === FOE ? 5 : 30)
    });
    expect(lashed[0]?.text).toBe(
      "Ansel rolls 7 on the d10 for Confusion: it doesn't move, and its action is one melee attack against Goblin, picked at random within its reach."
    );
    const swing = builtinActionFor(wizard, "unarmed-strike")!;
    expect(() => resolveAs(fight, swing, { targetIds: [FOE2], builtin: true }, [15])).toThrow(
      "Ansel's action this turn is one melee attack against Goblin."
    );
    expect(() => cast(fight, "fire-bolt", { targetIds: [FOE] })).toThrow();
    resolveAs(fight, swing, { targetIds: [FOE], builtin: true }, [15]);
    expect(() => resolveAs(fight, swing, { targetIds: [FOE], builtin: true }, [15])).toThrow();
  });

  it("takes no action on a 7 with no creature within reach", () => {
    const fight = caster();
    cast(fight, "confusion", { targetIds: [HERO] });
    answer(fight.state, HERO, 2);
    const faces = [8];
    expect(
      confusedTurn(fight.state, HERO, () => faces.shift()!, { distanceFeet: () => 30 })[0]?.text
    ).toBe("Ansel rolls 8 on the d10 for Confusion: it doesn't move, and no creature is within its reach, so it takes no action.");
  });
});

describe("Gibbering", () => {
  it("is a d8 table the server rolls for a creature that failed the save", () => {
    const mouther = loadMonsterDefinitions().find((monster) => monster.source.externalId === "gibbering-mouther")!;
    expect(JSON.stringify(mouther)).toContain('"failureTable":"gibbering"');
    const fight = caster();
    const goblin = actorOf(fight.state, FOE);
    goblin.effects = [
      makeEffect({
        id: "g",
        name: "Gibbering",
        tags: ["gibbering"],
        duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false }
      })
    ];
    expect(gibberingTurn(fight.state, goblin, () => 3)[0]?.text).toBe(
      "Goblin rolls 3 on the d8 for Gibbering: it does nothing this turn."
    );
    expect(goblin.effects[0]).toMatchObject({ name: "Gibbering: does nothing", speedZero: true });
    expect(goblin.effects[0]?.tags).toEqual(expect.arrayContaining(["no-actions", "no-bonus-actions", "no-reactions"]));
  });

  it("wanders all its movement in a rolled direction on a 5 or 6, and swings at a rolled creature on a 7 or 8", () => {
    const fight = caster();
    const gibbering = () =>
      makeEffect({
        id: "g",
        name: "Gibbering",
        tags: ["gibbering"],
        duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false }
      });
    const goblin = actorOf(fight.state, FOE);
    goblin.effects = [gibbering()];
    const wander = [5, 3];
    expect(gibberingTurn(fight.state, goblin, () => wander.shift()!)[0]?.text).toMatch(/move east\.$/);
    expect(goblin.effects[0]?.compelled).toMatchObject({ way: "heading", heading: 90, allMovement: true });
    goblin.effects = [gibbering()];
    const swing = [7, 1];
    gibberingTurn(fight.state, goblin, () => swing.shift()!, { distanceFeet: (_a, b) => (b === HERO ? 5 : 40) });
    expect(goblin.effects[0]?.forcedAttack).toEqual({ targetId: HERO });
  });
});

describe("Chromatic Orb", () => {
  it("says the orb leaps when two of its d8s match", () => {
    const fight = caster();
    const hit = cast(fight, "chromatic-orb", { damageType: "fire", ...waived }, [15, 3, 3, 5]);
    expect((hit.tableNarration ?? []).map((line) => line.text).join(" ")).toMatch(/Two of Chromatic Orb's d8s match/);
    const fresh = caster();
    const plain = cast(fresh, "chromatic-orb", { damageType: "fire", ...waived }, [15, 1, 3, 5]);
    expect((plain.tableNarration ?? []).map((line) => line.text).join(" ")).not.toMatch(/leaps/);
  });
});
