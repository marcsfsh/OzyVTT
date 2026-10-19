import { describe, expect, it } from "vitest";
import { applyRest, passTime, startPartyRest } from "../src/rests.js";
import { startStableRecovery } from "../src/effects.js";
import { ALLY, FOE, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, answer, cast, caster, effectNames, endFight, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 durations on the game clock: a spell lasts its printed time, "1 hour" or "8 hours" as much as "1 minute",
// and ends by itself when that much game time passes. A round is 6 seconds, 10 to a minute.

const resolveDefinition = () => wizard;

describe("what lasts in game time", () => {
  it("Mage Armor lasts 8 hours of game time and ends when they pass", () => {
    const table = caster();
    cast(table, "mage-armor", { targetIds: [HERO] });
    expect(actorOf(table.state, HERO).effects[0]?.duration).toEqual({ type: "minutes", remaining: 480 });
    endFight(table.state);
    passTime(table.state, 7);
    expect(actorOf(table.state, HERO).effects[0]?.duration).toEqual({ type: "minutes", remaining: 60 });
    const ended = passTime(table.state, 0, 60);
    expect(ended.map((event) => event.text)).toContain("Mage Armor ended on Ansel.");
    expect(effectNames(table.state, HERO)).toEqual([]);
    expect(table.state.rest).toMatchObject({ clockHours: 8, clockMinutes: 0 });
  });

  it("counts 10 rounds to the minute: a 1-minute Bless ends when a minute passes outside the fight", () => {
    const table = caster({ combat: false });
    table.state.combat.active = true;
    table.state.combat.initiative = [{ actorId: HERO, score: 20, tieBreaker: 0 }];
    table.state.combat.turnActorId = HERO;
    cast(table, "bless", { targetIds: [HERO] });
    table.state.combat.active = false;
    table.state.combat.initiative = [];
    expect(effectNames(table.state, HERO)).toEqual(["Concentrating on Bless", "Bless"]);
    passTime(table.state, 0, 1);
    expect(effectNames(table.state, HERO)).toEqual([]);
    expect(table.state.rest).toMatchObject({ clockHours: 0, clockMinutes: 1 });
  });

  it("ends what has a minute or less left with the fight", () => {
    const table = caster();
    cast(table, "bless", { targetIds: [ALLY] });
    heroTurnAgain(table.state);
    expect(actorOf(table.state, ALLY).effects[0]?.duration).toEqual({ type: "rounds", remaining: 9 });
    endFight(table.state);
    expect(effectNames(table.state, ALLY)).toEqual([]);
    expect(effectNames(table.state, HERO)).toEqual([]);
  });

  it("ends a 10-minute Concentration spell that outlives its fight once 10 minutes pass", () => {
    const table = caster();
    cast(table, "fly", { targetIds: [HERO] });
    endFight(table.state);
    expect(effectNames(table.state, HERO)).toEqual(["Concentrating on Fly", "Fly"]);
    passTime(table.state, 0, 9);
    expect(actorOf(table.state, HERO).effects[0]?.duration).toEqual({ type: "rounds", remaining: 10 });
    passTime(table.state, 0, 1);
    expect(effectNames(table.state, HERO)).toEqual([]);
  });

  it("a party Long Rest moves the clock 8 hours for everyone; a creature's own Long Rest ends what runs out in them", () => {
    const table = caster();
    cast(table, "mage-armor", { targetIds: [HERO] });
    heroTurnAgain(table.state);
    cast(table, "mage-armor", { targetIds: [ALLY] });
    endFight(table.state);
    passTime(table.state, 7);
    actorOf(table.state, HERO).effects.push({
      ...actorOf(table.state, HERO).effects[0]!,
      id: "10000000-0000-4000-8000-0000000000d1",
      name: "A day's ward",
      duration: { type: "minutes", remaining: 1440 }
    });
    applyRest(table.state, HERO, "long", resolveDefinition);
    // The GM passes the rest's 8 hours on the clock afterwards, so a day-long effect is left for that to count down.
    expect(effectNames(table.state, HERO)).toEqual(["A day's ward"]);
    expect(actorOf(table.state, HERO).effects[0]?.duration).toEqual({ type: "minutes", remaining: 1440 });
    actorOf(table.state, HERO).effects = [];
    expect(effectNames(table.state, ALLY)).toEqual(["Mage Armor"]);
    expect(table.state.rest.clockHours).toBe(7);
    // The Wizard's party rest moves the clock past the ally's hour too.
    actorOf(table.state, HERO).lastLongRestAt = null;
    startPartyRest(table.state, [HERO], "long", resolveDefinition);
    expect(table.state.rest.clockHours).toBe(15);
    expect(effectNames(table.state, ALLY)).toEqual([]);
  });

  it("gives a non-Concentration spell's condition the spell's minute (Blindness/Deafness)", () => {
    const table = caster();
    cast(table, "blindnessdeafness", {}, []);
    answer(table.state, FOE, 2);
    const blinded = actorOf(table.state, FOE).effects[0]!;
    expect(blinded).toMatchObject({ linkedConditionIds: ["blinded"], duration: { type: "rounds", remaining: 10 } });
  });

  it("ends Contact Other Plane's Incapacitated at the caster's next Long Rest, and not at a Short Rest", () => {
    const table = caster();
    cast(table, "contact-other-plane", { targetIds: [] }, [3, 3, 3, 3, 3, 3]);
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: HERO, ability: "int", dc: 15 }]);
    answer(table.state, HERO, 1);
    expect(actorOf(table.state, HERO).effects[0]).toMatchObject({
      linkedConditionIds: ["incapacitated"],
      duration: { type: "until-rest", rest: "long" }
    });
    endFight(table.state);
    passTime(table.state, 30);
    applyRest(table.state, HERO, "short", resolveDefinition);
    expect(actorOf(table.state, HERO).conditions.map((condition) => condition.id)).toContain("incapacitated");
    applyRest(table.state, HERO, "long", resolveDefinition);
    expect(actorOf(table.state, HERO).conditions.map((condition) => condition.id)).not.toContain("incapacitated");
  });
});

describe("recovery on the clock", () => {
  it("a Stable creature regains 1 Hit Point after the 1d4 hours rolled for it", () => {
    const table = caster({ combat: false });
    const hero = actorOf(table.state, HERO);
    hero.hp = { ...hero.hp, current: 0 };
    hero.deathSaves = { successes: 0, failures: 0, stable: true };
    hero.conditions = [{ id: "prone" }, { id: "unconscious" }];
    const told = startStableRecovery(table.state, hero, () => 3, "stable-1");
    expect(told.map((event) => event.text)).toEqual([
      "Ansel regains 1 Hit Point in 3 hours of game time unless healed first."
    ]);
    passTime(table.state, 2);
    expect(hero.hp.current).toBe(0);
    const woke = passTime(table.state, 1);
    expect(woke.map((event) => event.text)).toContain("Ansel regains 1 Hit Point and wakes.");
    expect(hero).toMatchObject({ hp: { current: 1 }, deathSaves: null });
    expect(hero.conditions.map((condition) => condition.id)).toEqual(["prone"]);
  });

  it("a knocked-out creature finishes its Short Rest an hour later and wakes", () => {
    const table = caster({ combat: false });
    const foe = actorOf(table.state, FOE);
    foe.effects = [
      {
        id: "out",
        name: "Knocked out",
        tags: ["knocked-out"],
        sourceActorId: null,
        sourceName: null,
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "minutes", remaining: 60 },
        endsWhenSourceDefeated: false,
        voidWhileIncapacitated: false,
        concentration: false,
        endsWithTag: null,
        modifiers: [],
        linkedConditionIds: ["unconscious"],
        escapeDc: null,
        onEnd: []
      }
    ];
    foe.conditions = [{ id: "unconscious" }];
    passTime(table.state, 0, 59);
    expect(foe.conditions.map((condition) => condition.id)).toEqual(["unconscious"]);
    passTime(table.state, 0, 1);
    expect(foe.conditions).toEqual([]);
  });
});
