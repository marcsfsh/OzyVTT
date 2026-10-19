import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { makeEffect } from "../src/effects.js";
import { confusedTurn, gibberingTurn } from "../src/random-outcomes.js";
import { actorOf, answer, cast, caster, endFight } from "./spell-lifetimes-kit.js";
import { FOE, FOE2 } from "./spell-casters.js";

// Tables the server rolls on (SRD 5.2.1): Prismatic Spray's ray per creature, Confusion's d10 each turn, Gibbering's
// d8, the cumulative chance Augury gives no answer, Reincarnate's species and Chromatic Orb's leap.

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

  it("blinds on the Violet ray until the start of the caster's next turn", () => {
    const fight = caster();
    cast(fight, "prismatic-spray", { targetIds: [FOE] }, [...twelve(3), 7]);
    const events = answer(fight.state, FOE, 2).events.map((event) => event.text);
    expect(actorOf(fight.state, FOE).effects).toMatchObject([
      { linkedConditionIds: ["blinded"], duration: { type: "until-source-next-turn" } }
    ]);
    expect(events.join(" ")).toMatch(/makes a DC 15 Wisdom save\. On a failure it is sent to another plane/);
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
    // A 1 sends it wandering in the d4's direction.
    const faces = [1, 3];
    expect(confusedTurn(fight.state, FOE, () => faces.shift()!)[0]?.text).toMatch(/move south\.$/);
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
    expect(gibberingTurn(goblin, () => 3)[0]?.text).toBe(
      "Goblin rolls 3 on the d8 for Gibbering: it does nothing this turn."
    );
    expect(goblin.effects[0]).toMatchObject({ name: "Gibbering: does nothing", speedZero: true });
    expect(goblin.effects[0]?.tags).toEqual(expect.arrayContaining(["no-actions", "no-bonus-actions", "no-reactions"]));
  });
});

describe("Augury and Reincarnate", () => {
  it("gives a cumulative 25 percent chance of no answer for each casting of Augury after the first", () => {
    const fight = caster();
    endFight(fight.state);
    const first = cast(fight, "augury", { targetIds: [], ...waived });
    expect(first.tableNarration ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "effect" })])
    );
    const second = cast(fight, "augury", { targetIds: [], ...waived }, [20]);
    expect((second.tableNarration ?? []).map((line) => line.text)).toContain(
      "Augury gives Ansel no answer (d100 20, 25 or lower fails)."
    );
    const third = cast(fight, "augury", { targetIds: [], ...waived }, [70]);
    expect((third.tableNarration ?? []).map((line) => line.text)).toContain("Augury answers Ansel (d100 70, over 50).");
  });

  it("rolls Reincarnate's species, a 1 rolling again", () => {
    const fight = caster();
    endFight(fight.state);
    const done = cast(fight, "reincarnate", { targetIds: [FOE], ...waived }, [1, 4]);
    expect((done.tableNarration ?? []).map((line) => line.text)).toContain(
      "Reincarnate rolls 4: Goblin comes back as an Elf, unless the GM chooses another species."
    );
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
