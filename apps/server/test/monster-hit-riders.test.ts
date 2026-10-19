import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";

// What a monster's hit leaves beside conditions, read from the shipped stat blocks: a pull, no healing, no
// Reactions, a Speed cut, Disadvantage on the target's next attack, Advantage on the next attack against it or on the
// monster's own next one, and the reminders for what the GM runs (a mummy's curse, a shadow's Strength drain).

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000401",
  hero: "10000000-0000-4000-8000-000000000402",
  map: "20000000-0000-5000-8000-000000000401",
  gmSession: "30000000-0000-4000-8000-00000000040a"
};

const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 300 },
  actions: [
    {
      id: "quick-jab",
      name: "Quick Jab",
      activation: "bonus-action",
      description: "A jab.",
      attack: { bonus: 4, reachFeet: 5 },
      damage: [{ formula: "1d4", type: "bludgeoning" }]
    }
  ],
  extensions: {}
} as unknown as ActorDefinition;

/** The monster `slug` on its turn against the hero. */
function table(slug: string) {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: IDS.monster,
        name: definition.name,
        kind: "monster",
        visibility: "public",
        hp: { current: 300, maximum: 300 },
        armorClass: 15,
        speedFeet: 30,
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 300, maximum: 300 },
        armorClass: 12,
        speedFeet: 30
      }
    ]
  }) as GameState;
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
  const monster = state.actors.find((actor) => actor.id === IDS.monster)!;
  const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
  return { state, monster, hero, definition };
}
type Table = ReturnType<typeof table>;

let command = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;
const deps = (built: Table, definition: ActorDefinition, faces: number[]) => ({
  random: () => faces.shift() ?? 3,
  newRollId: nextId,
  gmSessionId: IDS.gmSession,
  now: () => "2026-10-18T00:00:00.000Z",
  definition,
  resolveDefinition: (id: string) => built.state.definitions.find((entry) => entry.id === id)?.definition
});
/** The monster's `actionId` at the hero, with these d20 and damage faces. */
const strike = (built: Table, actionId: string, faces: number[] = [15]) => {
  const action = built.definition.actions.find((entry) => entry.id === actionId);
  if (!action) throw new Error(`${built.definition.name} has no ${actionId}`);
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: IDS.monster, targetIds: [IDS.hero], commandId: nextId() },
    deps(built, built.definition, faces)
  );
};

describe("a monster's hit pulls its target", () => {
  it("pulls a Huge or smaller creature up to 25 feet toward the balor and knocks it Prone, and spares a bigger one", () => {
    const built = table("balor");
    const hit = strike(built, "flame-whip");
    expect(hit.warnings?.join(" ")).toMatch(/move Hero up to 25 feet straight toward Balor/);
    expect(built.hero.conditions.map((condition) => condition.id)).toContain("prone");
    const big = table("balor");
    big.hero.size = "gargantuan";
    expect(strike(big, "flame-whip").warnings?.join(" ")).toMatch(/Hero is too large for Flame Whip's Pulled rider/);
    expect(big.hero.conditions).toEqual([]);
  });
});

describe("a monster's hit leaves an effect beyond conditions", () => {
  it("stops Reactions until the start of the balor's next turn (Lightning Blade)", () => {
    const built = table("balor");
    strike(built, "lightning-blade");
    expect(built.hero.effects).toMatchObject([
      { tags: ["no-reactions"], duration: { type: "until-source-next-turn" } }
    ]);
  });

  it("stops healing while a bearded devil's poison lasts", () => {
    const built = table("bearded-devil");
    strike(built, "beard");
    expect(built.hero.effects).toMatchObject([{ linkedConditionIds: ["poisoned"], tags: ["no-healing"] }]);
  });

  it("gives the target Disadvantage on its next attack roll before the end of its next turn (an ettin's Morningstar)", () => {
    const built = table("ettin");
    strike(built, "morningstar");
    expect(built.hero.effects).toMatchObject([
      {
        tags: ["until-own-attack"],
        modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }],
        duration: { type: "until-bearer-turn-end" }
      }
    ]);
  });

  it("gives the next attack against the target Advantage (a worg's Bite)", () => {
    const built = table("worg");
    strike(built, "bite");
    expect(built.hero.effects).toMatchObject([
      { tags: ["until-attacked"], modifiers: [{ type: "roll-mode", roll: "incoming-attack", mode: "advantage" }] }
    ]);
  });

  it("gives the pirate captain Advantage on its next attack this turn, which that attack spends", () => {
    const built = table("pirate-captain");
    strike(built, "rapier");
    expect(built.monster.effects).toMatchObject([
      { tags: ["until-own-attack"], duration: { type: "until-source-turn-end", skipsCurrentTurn: false } }
    ]);
    expect(built.hero.effects).toEqual([]);
    const next = strike(built, "rapier", [4, 15, 3]);
    expect(next.rollMode?.mode).toBe("advantage");
    expect(built.monster.effects.filter((effect) => effect.tags.includes("until-own-attack"))).toHaveLength(1);
  });

  it("cuts the target's Speed by 10 feet until the end of its next turn (a frost giant's Great Bow)", () => {
    const built = table("frost-giant");
    strike(built, "great-bow");
    expect(built.hero.effects).toMatchObject([{ modifiers: [{ type: "speed", amount: -10 }] }]);
  });

  it("leaves an ice devil's target no Bonus Action or Reaction, 10 feet less Speed, and one of moving or acting", () => {
    const built = table("ice-devil");
    strike(built, "ice-spear");
    expect(built.hero.effects).toMatchObject([
      {
        tags: ["no-bonus-actions", "no-reactions", "dazed"],
        modifiers: [{ type: "speed", amount: -10 }],
        duration: { type: "until-bearer-turn-end" }
      }
    ]);
    nextInitiativeTurn(built.state);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        heroDefinition.actions[0]!,
        { actorId: IDS.hero, targetIds: [IDS.monster], commandId: nextId() },
        deps(built, heroDefinition, [15, 2])
      )
    ).toThrowError(/can't take a Bonus Action while/);
  });
});

describe("what a monster's hit leaves to the GM is said with it", () => {
  it("curses with a mummy's Rotting Fist: no healing, and what it does at rests in the reminder", () => {
    const built = table("mummy");
    const hit = strike(built, "rotting-fist");
    expect(built.hero.effects).toMatchObject([{ tags: ["no-healing"], duration: { type: "manual" } }]);
    expect(hit.warnings?.join(" ")).toMatch(/Hit Point maximum decreases by 10 \(3d6\) every 24 hours/);
    // The death to dust is the hit's own (`kill-outright.test.ts`).
    expect(built.definition.actions.find((action) => action.id === "rotting-fist")?.drain).toEqual({
      killsAtZero: { cause: "Rotting Fist", bodyGone: true }
    });
  });

  it("names a shadow's Strength drain", () => {
    const built = table("shadow");
    expect(strike(built, "draining-swipe").warnings?.join(" ")).toMatch(/Strength score decreases by 1d4/);
  });

  it("stops healing with a pit fiend's poison through the save's own effect", () => {
    const built = table("pit-fiend");
    strike(built, "bite");
    expect(built.state.combat.pendingSaves).toMatchObject([
      { ability: "con", dc: 21, conditionIds: ["poisoned"], onFailEffect: { tags: ["no-healing"] } }
    ]);
  });
});
