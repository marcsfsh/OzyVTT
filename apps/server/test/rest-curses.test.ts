import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { endEncounter, startEncounter } from "../src/encounter.js";
import { endEncounterEffects } from "../src/effects.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { applyRest, passTime } from "../src/rests.js";
import { answerSave } from "../src/saving-throws.js";

// What a stat block's curse or lingering poison does as its bearer rests and as days pass (SRD 5.2.1): an otyugh's
// Bite asks a save after each Long Rest, a death dog's every 24 hours, a mummy's Rotting Fist lowers the Hit Point
// maximum every 24 hours and keeps it low through a Long Rest, and a rakshasa's or an incubus's curse takes a rest's
// benefit away.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000801",
  hero: "10000000-0000-4000-8000-000000000802",
  map: "20000000-0000-5000-8000-000000000801",
  gm: "30000000-0000-4000-8000-00000000080a"
};
const GM = { role: "gm" } as const;
const NOW = () => "2026-10-19T00:00:00.000Z";
let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

const heroDefinition = {
  name: "Hero",
  armorClass: 10,
  proficiencyBonus: 2,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 80 },
  actions: [],
  extensions: {}
} as unknown as ActorDefinition;

/** The monster `slug` hits the hero once in a fight, which then ends; the hero's own saves are answered with `face`. */
function bitten(slug: string, actionId: string, saveFace?: number) {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: IDS.monster,
        name: definition.name,
        kind: "monster",
        hp: { current: 200, maximum: 200 },
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 80, maximum: 80 },
        armorClass: 10,
        definitionId: "hero"
      }
    ]
  }) as GameState;
  const resolveDefinition = (id: string) =>
    id === "hero" ? heroDefinition : state.definitions.find((entry) => entry.id === id)?.definition;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  resolveDefinitionAction(
    state,
    definition.actions.find((entry) => entry.id === actionId)!,
    { actorId: IDS.monster, targetIds: [IDS.hero], commandId: nextId() },
    {
      random: (sides) => Math.min(sides, 19),
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      definition,
      resolveDefinition
    }
  );
  const pending = state.combat.pendingSaves.find((save) => save.targetActorId === IDS.hero);
  if (pending && saveFace !== undefined)
    answerSave(state, nextId(), pending.id, "manual", saveFace, true, GM, {
      random: () => 3,
      newRollId: nextId,
      sessionId: IDS.gm,
      role: "gm",
      now: NOW,
      resolveDefinition
    });
  endEncounterEffects(
    state,
    state.combat.initiative.map((entry) => entry.actorId)
  );
  endEncounter(state);
  const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
  // Rested and hurt a little since, so a rest has something to give back.
  hero.lastLongRestAt = -24;
  hero.hp = { ...hero.hp, current: 50 };
  return { state, hero, resolveDefinition };
}
type Bitten = ReturnType<typeof bitten>;
const longRest = (bit: Bitten, faces: number[]) => {
  bit.hero.lastLongRestAt = bit.state.rest.clockHours - 24;
  return applyRest(bit.state, IDS.hero, "long", bit.resolveDefinition, undefined, {
    random: () => faces.shift() ?? 3,
    lines: []
  });
};
const days = (bit: Bitten, hours: number, faces: number[]) =>
  passTime(bit.state, hours, 0, { random: () => faces.shift() ?? 3, resolveDefinition: bit.resolveDefinition });
const conditions = (bit: Bitten) => bit.hero.conditions.map((condition) => condition.id);

describe("a save after each Long Rest", () => {
  it("lowers an otyugh's poisoned target's Hit Point maximum on a failure, and ends the poison on a success", () => {
    const bit = bitten("otyugh", "bite");
    expect(conditions(bit)).toEqual(["poisoned"]);
    const failed = longRest(bit, [2, 6]);
    expect(failed.map((event) => event.text).join(" ")).toMatch(/DC 15 CON save against Poisoned by Otyugh/);
    expect(bit.hero.hp.maximum).toBe(74);
    expect(bit.hero.hp.current).toBe(74);
    expect(conditions(bit)).toEqual(["poisoned"]);
    longRest(bit, [18]);
    expect(conditions(bit)).toEqual([]);
    expect(bit.hero.hp.maximum).toBe(80);
  });
});

describe("what acts every 24 hours", () => {
  it("asks a death dog's poisoned target the save each day, lowering its maximum on a failure", () => {
    const bit = bitten("death-dog", "bite", 3);
    expect(conditions(bit)).toEqual(["poisoned"]);
    days(bit, 23, []);
    expect(bit.hero.hp.maximum).toBe(80);
    days(bit, 1, [2, 7]);
    expect(bit.hero.hp.maximum).toBe(73);
    // A Long Rest leaves the maximum low while the poison lasts.
    longRest(bit, []);
    expect(bit.hero.hp.maximum).toBe(73);
    days(bit, 24, [19]);
    expect(conditions(bit)).toEqual([]);
    expect(bit.hero.hp.maximum).toBe(80);
  });

  it("lowers a mummy's cursed target's maximum by 3d6 each day, through Long Rests, with no healing meanwhile", () => {
    const bit = bitten("mummy", "rotting-fist");
    expect(bit.hero.effects).toMatchObject([{ name: "Cursed by Mummy (Rotting Fist)", tags: ["no-healing", "curse"] }]);
    days(bit, 48, [2, 2, 2, 3, 3, 3]);
    expect(bit.hero.hp.maximum).toBe(65);
    longRest(bit, []);
    expect(bit.hero.hp.maximum).toBe(65);
    expect(bit.hero.hp.current).toBe(50);
  });
});

describe("a curse that takes a rest's benefit", () => {
  it("gives a rakshasa's cursed target nothing from a Long Rest or a Short Rest", () => {
    const bit = bitten("rakshasa", "cursed-touch");
    const events = longRest(bit, []);
    expect(events.map((event) => event.text).join(" ")).toMatch(/Hero gains no benefit from finishing the Long Rest/);
    expect(bit.hero.hp.current).toBe(50);
    const short = applyRest(bit.state, IDS.hero, "short", bit.resolveDefinition);
    expect(short.map((event) => event.text).join(" ")).toMatch(/no benefit from finishing the Short Rest/);
  });

  it("takes an incubus's target's Short Rests for a day, or until the incubus dies", () => {
    const bit = bitten("incubus", "restless-touch");
    expect(bit.hero.effects).toMatchObject([{ duration: { type: "minutes", remaining: 1440 } }]);
    expect(
      applyRest(bit.state, IDS.hero, "short", bit.resolveDefinition)
        .map((event) => event.text)
        .join(" ")
    ).toMatch(/no benefit/);
    applyDamageDetailed(bit.state, IDS.monster, { amount: 500 }, GM);
    expect(bit.hero.effects).toEqual([]);
  });
});
