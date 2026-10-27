import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { breathRounds, breathesWater, startHoldingBreath } from "../src/breath.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { applyRest, passTime } from "../src/rests.js";
import { nourish, setSurvivalTracking } from "../src/survival.js";
import { endOfTurn } from "../src/turn-boundaries.js";
import { actorOf, cast, caster, endFight } from "./spell-lifetimes-kit.js";
import { HERO } from "./spell-casters.js";

// Food, water and air (SRD 5.2.1 Rules Glossary: Malnutrition, Dehydration, Suffocation), and the spells that feed or
// let a creature breathe: Goodberry, Heroes' Feast, Water Breathing.

const MONSTERS = loadMonsterDefinitions();
const GM = { role: "gm" } as const;
const IDS = {
  hero: "10000000-0000-4000-8000-000000000a01",
  session: "30000000-0000-4000-8000-000000000a0b"
};

/** A Medium character with Constitution 12 (+1). */
const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 30 },
  actions: [],
  extensions: {}
} as unknown as ActorDefinition;
const resolveDefinition = (id: string) => (id === "hero" ? heroDefinition : undefined);

function party(inventory: unknown[] = []) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 30, maximum: 30 },
        armorClass: 12,
        definitionId: "hero",
        ownerSessionId: IDS.session,
        inventory
      }
    ]
  }) as GameState;
  setSurvivalTracking(state, true, GM);
  return { state, hero: state.actors[0]! };
}
const days = (state: GameState, count: number, faces: number[] = []) =>
  passTime(state, 24 * count, 0, { random: () => faces.shift() ?? 10, resolveDefinition });
const exhaustion = (hero: GameState["actors"][number]) =>
  hero.conditions.find((condition) => condition.id === "exhaustion")?.level ?? 0;
const longRest = (state: GameState) => {
  state.actors[0]!.lastLongRestAt = null;
  applyRest(state, IDS.hero, "long", resolveDefinition);
};

describe("dehydration", () => {
  it("costs a level for less than half a day's water, which no rest takes off until the character drinks its fill", () => {
    const { state, hero } = party();
    nourish(state, IDS.hero, { food: "meal" }, GM);
    days(state, 1);
    expect(exhaustion(hero)).toBe(1);
    expect(hero.nourishment).toMatchObject({ thirstLevels: 1, foodPounds: 0, waterPints: 0 });
    longRest(state);
    expect(exhaustion(hero)).toBe(1);
    // A drink at a source is the GM's to give; the player drinks what the character carries.
    expect(() => nourish(state, IDS.hero, { water: "fill" }, { role: "player", sessionId: IDS.session })).toThrow(
      /the GM's to give/
    );
    nourish(state, IDS.hero, { water: "fill" }, GM);
    longRest(state);
    expect(exhaustion(hero)).toBe(0);
  });

  it("drinks from the Waterskins and eats the Rations a character carries as the day ends", () => {
    const { state, hero } = party([
      { id: "rations", name: "Rations (1 day)", quantity: 2 },
      { id: "waterskin", name: "Waterskin", quantity: 2 }
    ]);
    const events = days(state, 1);
    expect(events.map((event) => event.text)).toContain(
      "Hero eats a day's Rations and drinks 8 pints from its Waterskins."
    );
    expect(exhaustion(hero)).toBe(0);
    expect(hero.inventory).toMatchObject([
      { id: "rations", quantity: 1 },
      { id: "waterskin", quantity: 2, waterPints: 0 }
    ]);
    // Its fill at a stream fills the skins again.
    nourish(state, IDS.hero, { water: "fill" }, GM);
    expect(hero.inventory[1]).not.toHaveProperty("waterPints");
  });
});

describe("malnutrition", () => {
  it("gives a level at the end of the fifth day without food, and another each day after", () => {
    const { state, hero } = party();
    for (let day = 1; day <= 4; day += 1) {
      nourish(state, IDS.hero, { water: "fill" }, GM);
      days(state, 1);
    }
    expect(exhaustion(hero)).toBe(0);
    nourish(state, IDS.hero, { water: "fill" }, GM);
    days(state, 1);
    expect(exhaustion(hero)).toBe(1);
    nourish(state, IDS.hero, { water: "fill" }, GM);
    days(state, 1);
    expect(exhaustion(hero)).toBe(2);
    expect(hero.nourishment).toMatchObject({ daysUnfed: 6, hungerLevels: 2 });
  });

  it("asks a DC 10 Constitution save of a creature that ate less than half its food", () => {
    const { state, hero } = party([{ id: "rations", name: "Rations (1 day)", quantity: 1 }]);
    hero.size = "large";
    nourish(state, IDS.hero, { water: "fill" }, GM);
    // A Large creature needs 4 pounds; its one ration is a pound. The d20 shows 2: 2 + 1 fails.
    const events = days(state, 1, [2]);
    expect(events.map((event) => event.text)).toContain(
      "Hero ate too little today: DC 10 CON save, 3 (d20 2), a failure."
    );
    expect(exhaustion(hero)).toBe(1);
  });

  it("eats a Bead of Nourishment as a day of Rations once the Rations run out", () => {
    // SRD Bead of Nourishment: it "provides as much nourishment as 1 day of Rations".
    const { state, hero } = party([
      { id: "rations", name: "Rations (1 day)", quantity: 1 },
      { id: "bead-of-nourishment", name: "Bead of Nourishment", quantity: 2 }
    ]);
    nourish(state, IDS.hero, { water: "fill" }, GM);
    days(state, 1);
    expect(hero.inventory.map((row) => [row.id, row.quantity])).toEqual([["bead-of-nourishment", 2]]);
    nourish(state, IDS.hero, { water: "fill" }, GM);
    const events = days(state, 1);
    expect(events.map((event) => event.text)).toContain("Hero eats a Bead of Nourishment.");
    expect(hero.nourishment).toMatchObject({ daysUnfed: 0, hungerLevels: 0 });
    // Eaten by hand, a bead meets the day's food too.
    nourish(state, IDS.hero, { food: "bead" }, { role: "player", sessionId: IDS.session });
    expect(hero.inventory).toEqual([]);
    expect(hero.nourishment).toMatchObject({ foodPounds: 1 });
    expect(() => nourish(state, IDS.hero, { food: "bead" }, GM)).toThrow("Hero carries no Bead of Nourishment.");
  });

  it("leaves a creature that isn't tracked alone", () => {
    const { state, hero } = party();
    setSurvivalTracking(state, false, GM);
    days(state, 6);
    expect(exhaustion(hero)).toBe(0);
    expect(hero.nourishment).toBeUndefined();
  });
});

describe("suffocation", () => {
  it("holds its breath for 1 plus its Constitution modifier minutes, then gains a level at each turn's end", () => {
    const { state, hero } = party();
    startHoldingBreath(state, hero, heroDefinition);
    expect(hero.effects).toMatchObject([{ name: "Holding Breath", breath: { roundsLeft: 20 } }]);
    const events: ReturnType<typeof endEffect> = [];
    for (let turn = 1; turn <= 20; turn += 1) endOfTurn(state, IDS.hero, events);
    expect(exhaustion(hero)).toBe(0);
    expect(hero.effects[0]?.name).toBe("Suffocating");
    endOfTurn(state, IDS.hero, events);
    endOfTurn(state, IDS.hero, events);
    expect(exhaustion(hero)).toBe(2);
    // Breathing again takes off what suffocating gave.
    endEffect(state, IDS.hero, hero.effects[0]!.id);
    expect(exhaustion(hero)).toBe(0);
  });

  it("reads a Hold Breath trait's printed time, and spares a creature that breathes water", () => {
    const crocodile = MONSTERS.find((monster) => monster.source.externalId === "crocodile")!;
    expect(breathRounds(crocodile)).toBe(600);
    const merfolk = MONSTERS.find((monster) => monster.source.externalId === "merfolk-skirmisher")!;
    const { state, hero } = party();
    expect(breathesWater(hero, merfolk)).toBe(true);
    expect(startHoldingBreath(state, hero, merfolk)).toEqual([]);
  });

  it("ends when the creature can breathe water (the Water Breathing spell)", () => {
    const { state, hero } = party();
    startHoldingBreath(state, hero, heroDefinition);
    addEffect(
      state,
      IDS.hero,
      makeEffect({ id: "wb", name: "Water Breathing", tags: ["water-breathing"], duration: { type: "manual" } })
    );
    expect(hero.effects.map((effect) => effect.name)).toEqual(["Water Breathing"]);
  });

  it("runs out as the minutes pass outside an encounter", () => {
    const { state, hero } = party();
    startHoldingBreath(state, hero, heroDefinition);
    passTime(state, 0, 2);
    expect(hero.effects[0]?.breath).toEqual({ roundsLeft: 0, exhaustionGained: 0 });
    passTime(state, 0, 1);
    expect(exhaustion(hero)).toBe(6);
  });
});

describe("Goodberry", () => {
  it("puts ten berries in the caster's hand; one is a day's food and a Hit Point, and the rest vanish with the spell", () => {
    const fight = caster();
    cast(fight, "goodberry", { targetIds: [] });
    expect(actorOf(fight.state, HERO).inventory.find((row) => row.id === "goodberry")).toMatchObject({ quantity: 10 });
    const wizard = actorOf(fight.state, HERO);
    wizard.hp = { ...wizard.hp, current: wizard.hp.current - 5 };
    const before = wizard.hp.current;
    nourish(fight.state, HERO, { food: "goodberry" }, GM);
    expect(wizard.hp.current).toBe(before + 1);
    expect(fight.state.combat.turn.bonusActionUsed).toBe(true);
    expect(() => nourish(fight.state, HERO, { food: "goodberry" }, GM)).toThrow(/Bonus Action/);
    endFight(fight.state);
    passTime(fight.state, 24);
    expect(actorOf(fight.state, HERO).inventory.some((row) => row.id === "goodberry")).toBe(false);
  });
});
