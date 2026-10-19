import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";
import { answerSave } from "../src/saving-throws.js";
import { actorOf, answer, cast, caster } from "./spell-lifetimes-kit.js";
import { FOE } from "./spell-casters.js";

// The action an effect's text prints to end it, taken through End an Effect: stanching an infernal wound, waking a
// sleeper, detaching a stirge, pulling a creature out of a gelatinous cube, studying a phantasm, and collecting itself
// to repeat Irresistible Dance's save.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000701",
  hero: "10000000-0000-4000-8000-000000000702",
  ally: "10000000-0000-4000-8000-000000000703",
  map: "20000000-0000-5000-8000-000000000701",
  gm: "30000000-0000-4000-8000-00000000070a"
};
const GM = { role: "gm" } as const;
const NOW = () => "2026-10-19T00:00:00.000Z";
let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

/** A hero who knows Medicine and Athletics, as both party members. */
const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 14, cha: 10 },
  hitPoints: { maximum: 60 },
  actions: [],
  proficiencies: {
    saves: [],
    skills: [
      { id: "medicine", proficiency: "proficient" },
      { id: "athletics", proficiency: "proficient" }
    ]
  },
  extensions: {}
} as unknown as ActorDefinition;

/** The monster `slug`, then the hero, then the ally. */
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
        hp: { current: 300, maximum: 300 },
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 60, maximum: 60 },
        armorClass: 12,
        definitionId: "hero"
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "player-character",
        hp: { current: 60, maximum: 60 },
        armorClass: 12,
        definitionId: "hero"
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { state, definition };
}
type Table = ReturnType<typeof table>;
const resolveDefinition = (built: Table) => (id: string) =>
  id === "hero" ? heroDefinition : built.state.definitions.find((entry) => entry.id === id)?.definition;
const deps = (built: Table, faces: number[], definition?: ActorDefinition) => ({
  random: () => faces.shift() ?? 3,
  newRollId: nextId,
  gmSessionId: IDS.gm,
  now: NOW,
  resolveDefinition: resolveDefinition(built),
  ...(definition ? { definition } : {})
});
const hero = (built: Table) => built.state.actors.find((actor) => actor.id === IDS.hero)!;
const ally = (built: Table) => built.state.actors.find((actor) => actor.id === IDS.ally)!;

/** The monster uses `actionId` on the hero. */
function use(built: Table, actionId: string, faces: number[] = [18, 3, 3, 3]) {
  const action = built.definition.actions.find((entry) => entry.id === actionId)!;
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: IDS.monster, targetIds: [IDS.hero], commandId: nextId() },
    deps(built, faces, built.definition)
  );
}
function failHerosSave(built: Table) {
  const pending = built.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.hero)!;
  answerSave(built.state, nextId(), pending.id, "manual", 1, true, GM, {
    random: () => 3,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition: resolveDefinition(built)
  });
}
/** `actorId` takes End an Effect on `targetId`, its d20 showing `face`. */
function endIt(built: Table, actorId: string, targetId: string, faces: number[] = [15]) {
  built.state.combat = {
    ...built.state.combat,
    turnActorId: actorId,
    turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
  };
  return resolveDefinitionAction(
    built.state,
    builtinAction("end-an-effect")!,
    { actorId, targetIds: [targetId], commandId: nextId(), builtin: true },
    deps(built, faces, heroDefinition)
  );
}

describe("ending an effect by the action its text prints", () => {
  it("stanches a bearded devil's infernal wound with an ally's Medicine check against its DC", () => {
    const built = table("bearded-devil");
    const hit = use(built, "infernal-glaive");
    expect(hit.attack).toMatchObject({ outcome: "hit" });
    failHerosSave(built);
    expect(hero(built).effects).toMatchObject([{ name: "Infernal Wound" }]);
    const missed = endIt(built, IDS.ally, IDS.hero, [5]);
    expect(missed.check).toMatchObject({ dc: 12, success: false });
    expect(hero(built).effects).toHaveLength(1);
    const stanched = endIt(built, IDS.ally, IDS.hero, [12]);
    expect(stanched.check).toMatchObject({ dc: 12, success: true });
    expect(hero(built).effects).toEqual([]);
  });

  it("gives a creature already wounded no second infernal wound", () => {
    const built = table("bearded-devil");
    use(built, "infernal-glaive");
    failHerosSave(built);
    built.state.combat = {
      ...built.state.combat,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    const again = use(built, "infernal-glaive");
    expect(built.state.combat.pendingSaves).toEqual([]);
    expect(again.warnings?.join(" ")).toMatch(/still under/);
  });

  it("wakes a creature a brass dragon's breath put to sleep, with no check", () => {
    const built = table("adult-brass-dragon");
    use(built, "sleep-breath");
    failHerosSave(built);
    for (let guard = 0; guard < 4 && built.state.combat.turnActorId !== IDS.hero; guard += 1)
      nextInitiativeTurn(built.state, [], {
        resolveDefinition: resolveDefinition(built),
        rollDie: () => 3,
        newId: nextId,
        now: NOW
      });
    nextInitiativeTurn(built.state, [], {
      resolveDefinition: resolveDefinition(built),
      rollDie: () => 3,
      newId: nextId,
      now: NOW
    });
    failHerosSave(built);
    expect(hero(built).conditions.map((condition) => condition.id)).toContain("unconscious");
    endIt(built, IDS.ally, IDS.hero);
    expect(hero(built).conditions.map((condition) => condition.id)).toEqual(["prone"]);
  });

  it("lets the target detach a stirge itself", () => {
    const built = table("stirge");
    use(built, "proboscis");
    expect(hero(built).effects).toMatchObject([{ name: "Attached by Stirge (Proboscis)" }]);
    endIt(built, IDS.hero, IDS.hero);
    expect(hero(built).effects).toEqual([]);
  });

  it("pulls a creature out of a gelatinous cube on an Athletics check, and the puller takes the acid", () => {
    const built = table("gelatinous-cube");
    use(built, "engulf", [3, 3, 3]);
    failHerosSave(built);
    // "Is suffocating": the engulfed hero holds its breath, and breathes again once pulled free.
    expect(hero(built).effects).toMatchObject([
      { tags: ["escape-athletics", "cant-speak", "smothering", "swallowed"], escapeDc: 12 },
      { name: "Holding Breath" }
    ]);
    const before = ally(built).hp.current;
    const pulled = endIt(built, IDS.ally, IDS.hero, [15, 4, 4, 4]);
    expect(pulled.check).toMatchObject({ dc: 12, success: true });
    expect(hero(built).effects).toEqual([]);
    expect(ally(built).hp.current).toBe(before - 12);
  });

  it("refuses End an Effect where nothing names an action to end it", () => {
    const built = table("stirge");
    expect(() => endIt(built, IDS.ally, IDS.hero)).toThrow(RulesBlockedError);
  });
});

describe("ending a spell's effect by an action", () => {
  it("ends Phantasmal Force when its target studies the phantasm and beats the spell save DC", () => {
    const fight = caster();
    cast(fight, "phantasmal-force");
    answer(fight.state, FOE, 2);
    expect(actorOf(fight.state, FOE).effects).toMatchObject([
      { name: "Phantasmal Force", endedBy: { check: { ability: "int", skill: "investigation", dc: 15 } } }
    ]);
    fight.state.combat = {
      ...fight.state.combat,
      turnActorId: FOE,
      turn: { ...fight.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    resolveDefinitionAction(
      fight.state,
      builtinAction("end-an-effect")!,
      { actorId: FOE, targetIds: [FOE], commandId: nextId(), builtin: true },
      {
        random: () => 17,
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        resolveDefinition: () => undefined
      }
    );
    expect(actorOf(fight.state, FOE).effects).toEqual([]);
  });
});
