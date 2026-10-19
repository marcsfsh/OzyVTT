import { describe, expect, it } from "vitest";
import { isDead, type GameState } from "@vtt/domain";
import { keepDeathRecords, roundsDead, stampDeath } from "../src/death.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { passGameTime } from "../src/game-time.js";
import { applyRest } from "../src/rests.js";
import { ALLY, FOE, HERO, view } from "./spell-casters.js";
import { actorOf, cast, caster, effectNames, endFight, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 revival spells. Revivify: "You touch a creature that has died within the last minute. That creature
// revives with 1 Hit Point." Raise Dead: "dead no longer than 10 days and it wasn't Undead when it died ... returns to
// life with 1 Hit Point ... neutralizes any poisons". Resurrection: "dead for no more than a century ... returns to life
// with all its Hit Points ... Casting this spell to revive a creature that has been dead for 365 days or longer taxes
// you." True Resurrection: "dead for no longer than 200 years ... lifts any curses ... can provide a new body if the
// original no longer exists." Gentle Repose: "days spent under the influence of this spell don't count against the time
// limit of spells such as Raise Dead."

const DAY = 24 * 60;

const diamond = (gp: number) => ({
  id: `diamond-${gp}`,
  name: `Diamond (${gp} GP)`,
  quantity: 1,
  equipped: false,
  attuned: false
});

/** Runs `change` as a command and keeps the death records as the server does after every command. */
function command(state: GameState, change: () => void): void {
  const before = structuredClone(state);
  change();
  keepDeathRecords(state, before);
}

/** Drops the ally (an NPC) to 0 Hit Points, where it dies. */
const kill = (state: GameState, actorId: string = ALLY) =>
  command(state, () => {
    const actor = actorOf(state, actorId);
    actor.hp = { ...actor.hp, current: 0 };
  });

/** Passes game time as the GM's time.pass does. */
const pass = (state: GameState, minutes: number) => command(state, () => passGameTime(state, minutes));

describe("the time of death", () => {
  it("is stamped as a creature dies, counts the fight's rounds and moves onto the clock when the fight ends", () => {
    const table = caster();
    table.state.combat.round = 3;
    kill(table.state);
    expect(actorOf(table.state, ALLY).death).toMatchObject({ clockRound: 0, fightRound: 3 });
    table.state.combat.round = 7;
    expect(roundsDead(table.state, actorOf(table.state, ALLY))).toBe(4);
    command(table.state, () => endFight(table.state));
    expect(actorOf(table.state, ALLY).death).toEqual({ clockRound: -4 });
    pass(table.state, 2);
    expect(roundsDead(table.state, actorOf(table.state, ALLY))).toBe(24);
  });

  it("is cleared once the creature lives again", () => {
    const table = caster();
    kill(table.state);
    command(table.state, () => {
      actorOf(table.state, ALLY).hp.current = 5;
    });
    expect(actorOf(table.state, ALLY).death).toBeUndefined();
  });
});

describe("Revivify", () => {
  it("brings back a creature dead within the minute with 1 Hit Point, using up the diamond", () => {
    const table = caster();
    table.hero.inventory.push(diamond(300));
    table.state.combat.round = 3;
    kill(table.state);
    table.state.combat.round = 5;
    const result = cast(table, "revivify", { targetIds: [ALLY] });
    const ally = actorOf(table.state, ALLY);
    expect(isDead(ally)).toBe(false);
    expect(ally.hp.current).toBe(1);
    expect(ally.death).toBeUndefined();
    expect(table.hero.inventory.some((item) => item.id === "diamond-300")).toBe(false);
    expect(result.tableNarration?.map((line) => line.text)).toContain("Bran returns to life with 1 hit point.");
  });

  it("is refused for a creature dead more than a minute, and for one still alive", () => {
    const table = caster();
    table.hero.inventory.push(diamond(300));
    table.state.combat.round = 3;
    kill(table.state);
    table.state.combat.round = 14;
    expect(() => cast(table, "revivify", { targetIds: [ALLY] })).toThrowError(
      /Bran died 11 rounds ago, and Revivify reaches back 1 minute/
    );
    expect(() => cast(table, "revivify", { targetIds: [FOE] })).toThrowError(
      /Goblin isn't dead, so Revivify has no one to bring back/
    );
    expect(table.hero.inventory.some((item) => item.id === "diamond-300")).toBe(true);
  });

  it("brings back a creature that died in a fight just ended, cast with no fight running", () => {
    const table = caster();
    table.hero.inventory.push(diamond(300));
    table.state.combat.round = 2;
    kill(table.state);
    table.state.combat.round = 4;
    command(table.state, () => endFight(table.state));
    cast(table, "revivify", { targetIds: [ALLY] });
    expect(actorOf(table.state, ALLY).hp.current).toBe(1);
  });
});

describe("Raise Dead", () => {
  it("brings back a creature dead within 10 days with 1 Hit Point, its poison neutralized", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push(diamond(500));
    kill(table.state);
    actorOf(table.state, ALLY).conditions.push({ id: "poisoned" });
    pass(table.state, 9 * DAY);
    cast(table, "raise-dead", { targetIds: [ALLY] });
    const ally = actorOf(table.state, ALLY);
    expect(ally.hp.current).toBe(1);
    expect(ally.conditions.map((condition) => condition.id)).not.toContain("poisoned");
  });

  it("is refused for a creature dead 11 days", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push(diamond(500));
    kill(table.state);
    pass(table.state, 11 * DAY);
    expect(() => cast(table, "raise-dead", { targetIds: [ALLY] })).toThrowError(
      /Bran died 11 days ago, and Raise Dead reaches back 10 days/
    );
  });

  it("is refused for a creature that was Undead when it died", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push(diamond(500));
    table.state.definitions.push({ id: "import-zombie", definition: view.monster("zombie")! });
    table.state.actors.push({
      ...structuredClone(actorOf(table.state, ALLY)),
      id: UNDEAD,
      name: "Zombie",
      definitionId: "import-zombie"
    });
    kill(table.state, UNDEAD);
    expect(() => cast(table, "raise-dead", { targetIds: [UNDEAD] })).toThrowError(
      /Raise Dead can't revive Zombie, who was Undead at death/
    );
  });

  it("counts no day the corpse lay under Gentle Repose", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push(diamond(500));
    table.hero.currency = { ...table.hero.currency, cp: 2 };
    kill(table.state);
    pass(table.state, 4 * DAY);
    cast(table, "gentle-repose", { targetIds: [ALLY] });
    expect(effectNames(table.state, ALLY)).toContain("Gentle Repose");
    pass(table.state, 8 * DAY);
    expect(roundsDead(table.state, actorOf(table.state, ALLY))).toBe(4 * DAY * 10);
    cast(table, "raise-dead", { targetIds: [ALLY] });
    expect(actorOf(table.state, ALLY).hp.current).toBe(1);
  });
});

describe("Gentle Repose", () => {
  it("is refused on a living creature", () => {
    const table = caster({ combat: false });
    table.hero.currency = { ...table.hero.currency, cp: 2 };
    expect(() => cast(table, "gentle-repose", { targetIds: [FOE] })).toThrowError(
      /Gentle Repose touches a corpse, and Goblin isn't dead/
    );
  });
});

describe("Resurrection", () => {
  it("brings back a creature dead a year with all its Hit Points, and taxes the caster until a Long Rest", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push(diamond(1000));
    kill(table.state);
    pass(table.state, 400 * DAY);
    cast(table, "resurrection", { targetIds: [ALLY] });
    expect(actorOf(table.state, ALLY).hp.current).toBe(actorOf(table.state, ALLY).hp.maximum);
    expect(effectNames(table.state, HERO)).toContain("Resurrection's toll");
    expect(() => cast(table, "magic-missile", { targetIds: [FOE] })).toThrowError(
      /Ansel can't cast spells until Resurrection's toll ends with a Long Rest/
    );
    applyRest(table.state, HERO, "long", () => wizard);
    expect(effectNames(table.state, HERO)).not.toContain("Resurrection's toll");
  });

  it("leaves its caster untaxed for a creature dead less than a year", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push(diamond(1000));
    kill(table.state);
    pass(table.state, 30 * DAY);
    cast(table, "resurrection", { targetIds: [ALLY] });
    expect(effectNames(table.state, HERO)).not.toContain("Resurrection's toll");
  });
});

describe("a body that is gone", () => {
  it("is beyond Revivify, and True Resurrection brings the creature back whole, its curses lifted", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push(diamond(300), { ...diamond(25000), quantity: 1 });
    command(table.state, () => {
      const ally = actorOf(table.state, ALLY);
      ally.hp = { ...ally.hp, current: 0 };
      stampDeath(table.state, ally, { cause: "Disintegrate", bodyGone: true });
    });
    addEffect(
      table.state,
      ALLY,
      makeEffect({ id: "hex-curse", name: "Cursed", tags: ["curse"], duration: { type: "manual" } })
    );
    expect(() => cast(table, "revivify", { targetIds: [ALLY] })).toThrowError(
      /Nothing is left of Bran's body \(Disintegrate\)\. Only a spell that makes a new body/
    );
    cast(table, "true-resurrection", { targetIds: [ALLY] });
    const ally = actorOf(table.state, ALLY);
    expect(ally.hp.current).toBe(ally.hp.maximum);
    expect(effectNames(table.state, ALLY)).not.toContain("Cursed");
  });
});

describe("Reincarnate", () => {
  it("brings back a dead Humanoid in a new body whose species the server rolls, a 1 rolling again", () => {
    const table = caster({ combat: false });
    table.hero.inventory.push({ id: "rare-oils", name: "Rare oils", quantity: 1, equipped: false, attuned: false });
    kill(table.state);
    const result = cast(table, "reincarnate", { targetIds: [ALLY] }, [1, 7]);
    expect(isDead(actorOf(table.state, ALLY))).toBe(false);
    expect(effectNames(table.state, ALLY)).toContain("Reincarnated as a Halfling");
    expect(result.tableNarration?.map((line) => line.text).join(" ")).toMatch(
      /Bran's new body is a Halfling \(d10: 7\)/
    );
  });
});

const UNDEAD = "10000000-0000-4000-8000-0000000000aa";
