import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { builtinAction } from "../src/builtin-actions.js";
import { RulesBlockedError } from "../src/game-store.js";

// What SRD 5.2.1 prints in a monster's attack that the engine runs: a charge that only knocks Prone, a push, a hit
// that sets its target burning, a grapple that is hard to escape or forbids teleporting, and the Advantage an attack
// prints for itself.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000501",
  hero: "10000000-0000-4000-8000-000000000502",
  map: "20000000-0000-5000-8000-000000000501",
  gmSession: "30000000-0000-4000-8000-00000000050a"
};

const heroDefinition = {
  schemaId: "vtt.actor-character",
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 300 },
  token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
  actions: [],
  extensions: {}
} as unknown as ActorDefinition;

function table(slug: string, heroSize = "medium") {
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
        speedFeet: 30,
        size: heroSize
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
  const hero = () => state.actors.find((actor) => actor.id === IDS.hero)!;
  return { state, definition, hero };
}
type Table = ReturnType<typeof table>;

/** A fresh turn for `actorId`, so its next action has an action to spend. */
const turnOf = (built: Table, actorId: string) => {
  built.state.combat = {
    ...built.state.combat,
    turnActorId: actorId,
    turn: { ...built.state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
};

let command = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;
const deps = (built: Table, faces: number[]): ResolveDependencies => ({
  random: (sides) => Math.min(sides, faces.shift() ?? 3),
  newRollId: nextId,
  gmSessionId: IDS.gmSession,
  now: () => "2026-10-19T00:00:00.000Z",
  definition: built.definition,
  resolveDefinition: (id: string) => built.state.definitions.find((entry) => entry.id === id)?.definition
});
const strike = (
  built: Table,
  actionId: string,
  faces: number[] = [15],
  extra: Partial<Parameters<typeof resolveDefinitionAction>[2]> = {}
) => {
  const action = built.definition.actions.find((entry) => entry.id === actionId)!;
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: IDS.monster, targetIds: [IDS.hero], commandId: nextId(), ...extra },
    deps(built, faces)
  );
};

describe("a charge that only knocks its target down", () => {
  it("offers an elephant's charge with no dice, and knocks the target Prone when the elephant confirms it", () => {
    const built = table("elephant");
    const preview = strike(built, "gore", [15], { commit: false });
    expect(preview.hitOffers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "charge", dice: "" })]));
    strike(built, "gore", [15], { hitOptions: [{ id: "charge" }] });
    expect(built.hero().conditions.map((condition) => condition.id)).toContain("prone");
  });

  it("leaves a target too big for it standing", () => {
    const built = table("gorgon", "huge");
    const preview = strike(built, "gore", [15], { commit: false });
    expect((preview.hitOffers ?? []).some((offer) => offer.id === "charge")).toBe(false);
  });
});

describe("a hit that sets its target burning", () => {
  it("burns the target for 1d4 Fire at the start of its turns, once however often it is hit", () => {
    const built = table("fire-elemental");
    strike(built, "burn");
    strike(built, "burn");
    const burning = built.hero().effects.filter((effect) => effect.tags.includes("burning"));
    expect(burning).toHaveLength(1);
    expect(burning[0]).toMatchObject({
      name: "Burning",
      ongoingDamage: { damage: [{ formula: "1d4", type: "fire" }], at: "bearer-turn-start" }
    });
  });
});

describe("a grapple that holds on", () => {
  it("makes the check to escape a mimic's Pseudopod roll with Disadvantage", () => {
    const built = table("mimic");
    strike(built, "pseudopod");
    const grapple = built.hero().effects.find((effect) => effect.linkedConditionIds.includes("grappled"))!;
    expect(grapple.tags).toContain("escape-disadvantage");
    turnOf(built, IDS.hero);
    const escape = resolveDefinitionAction(
      built.state,
      builtinAction("escape-grapple")!,
      { actorId: IDS.hero, targetIds: [], commandId: nextId(), builtin: true, rollMode: null, override: null },
      { ...deps(built, [12, 18]), definition: heroDefinition }
    );
    expect(escape.rollMode?.mode ?? "normal").toBe("disadvantage");
    expect(escape.rollMode?.disadvantage.join(" ")).toMatch(/hard to escape/);
  });

  it("keeps a creature the tarrasque's Bite grapples from teleporting", () => {
    const built = table("tarrasque");
    strike(built, "bite");
    const held = built.hero().effects.find((effect) => effect.linkedConditionIds.includes("grappled"))!;
    expect(held.tags).toContain("no-teleport");
    expect(() =>
      applyMovementRules(built.state, {
        actorId: IDS.hero,
        from: { x: 25, y: 25 },
        to: { x: 225, y: 25 },
        mode: "teleport",
        distance: () => 20,
        override: null,
        resolveDefinition: (id: string) => built.state.definitions.find((entry) => entry.id === id)?.definition,
        newPromptId: nextId,
        now: () => 0,
        commandId: nextId()
      })
    ).toThrowError(RulesBlockedError);
  });
});

describe("the Advantage an attack prints for itself", () => {
  it("gives a shark's Bite Advantage against a creature missing Hit Points", () => {
    const built = table("hunter-shark");
    expect(strike(built, "bite", [15, 3], { commit: false }).rollMode?.mode ?? "normal").toBe("normal");
    built.hero().hp = { ...built.hero().hp, current: 299 };
    expect(strike(built, "bite", [15, 3], { commit: false }).rollMode?.mode ?? "normal").toBe("advantage");
  });

  it("gives a doppelganger's Slam Advantage in the first round of an encounter", () => {
    const built = table("doppelganger");
    expect(strike(built, "slam", [15, 3], { commit: false }).rollMode?.mode ?? "normal").toBe("advantage");
    built.state.combat = { ...built.state.combat, round: 2 };
    expect(strike(built, "slam", [15, 3], { commit: false }).rollMode?.mode ?? "normal").toBe("normal");
  });

  it("gives an ankheg's Bite Advantage against a creature it grapples", () => {
    const built = table("ankheg");
    expect(strike(built, "bite", [15, 3], { commit: false }).rollMode?.mode ?? "normal").toBe("normal");
    strike(built, "bite", [15, 3]);
    turnOf(built, IDS.monster);
    expect(strike(built, "bite", [15, 3], { commit: false }).rollMode?.mode ?? "normal").toBe("advantage");
  });
});
