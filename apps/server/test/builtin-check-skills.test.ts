import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan } from "../src/ability-checks.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { initiativeRollFor, startEncounter } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";

// The SRD's check actions use the skill they are made with (Hide, Search, Study, Influence, Escape a Grapple), Influence
// sets its DC from the monster, initiative is a Dexterity check, and Hex's chosen ability carries its Disadvantage.

const HERO = "10000000-0000-4000-8000-0000000000a1";
const FOE = "10000000-0000-4000-8000-0000000000a2";
const SAGE = "10000000-0000-4000-8000-0000000000a3";
const COMMAND = "50000000-0000-4000-8000-0000000000a1";
const GOBLIN = loadMonsterDefinitions().find((monster) => monster.source?.externalId === "goblin-warrior")!;
/** A monster with Intelligence 18, for Influence's DC. */
const SAGE_SHEET = { ...GOBLIN, name: "Sage", abilityScores: { ...GOBLIN.abilityScores, int: 18 } } as ActorDefinition;

/** Str 12, Dex 14, Wis 14, Int 12, Cha 16, PB 2: Perception, Persuasion, Athletics proficient; Arcana Expertise. */
const HERO_SHEET = {
  name: "Hero",
  armorClass: 13,
  proficiencyBonus: 2,
  abilityScores: { str: 12, dex: 14, con: 12, int: 12, wis: 14, cha: 16 },
  hitPoints: { maximum: 20 },
  actions: [],
  extensions: {},
  character: { classes: [{ id: "ranger", name: "Ranger", level: 3 }], feats: [] },
  proficiencies: {
    saves: [],
    skills: [
      { id: "perception", proficiency: "proficient" },
      { id: "persuasion", proficiency: "proficient" },
      { id: "athletics", proficiency: "proficient" },
      { id: "arcana", proficiency: "expertise" }
    ]
  }
} as unknown as ActorDefinition;

const DEFINITIONS: Readonly<Record<string, ActorDefinition>> = {
  "hero-def": HERO_SHEET,
  "goblin-def": GOBLIN,
  "sage-def": SAGE_SHEET
};

function fight(hero: Record<string, unknown> = {}): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "hero-def",
        ...hero
      },
      {
        id: FOE,
        name: "Goblin",
        kind: "monster",
        visibility: "public",
        hp: { current: 7, maximum: 7 },
        definitionId: "goblin-def"
      },
      {
        id: SAGE,
        name: "Sage",
        kind: "monster",
        visibility: "public",
        hp: { current: 7, maximum: 7 },
        definitionId: "sage-def"
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 },
        { actorId: SAGE, score: 5 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

function deps(faces: number[]): ResolveDependencies {
  return {
    random: () => faces.shift() ?? 10,
    newRollId: () => "40000000-0000-4000-8000-0000000000a1",
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-16T00:00:00.000Z",
    definition: HERO_SHEET,
    resolveDefinition: (id) => DEFINITIONS[id]
  };
}

const act = (state: GameState, actionId: string, extra: Record<string, unknown> = {}, faces: number[] = [10]) =>
  resolveDefinitionAction(
    state,
    builtinAction(actionId)!,
    { actorId: HERO, targetIds: [], commandId: COMMAND, builtin: true, rollMode: null, override: null, ...extra },
    deps(faces)
  );

describe("the check actions roll the skill they are made with", () => {
  it("lets Search use Perception with its proficiency, or another Wisdom skill, and nothing else", () => {
    expect(act(fight(), "search", { skill: "perception" }).check).toMatchObject({
      skill: "Wisdom (Perception)",
      total: 14
    });
    expect(act(fight(), "search", { skill: "survival" }).check).toMatchObject({
      skill: "Wisdom (Survival)",
      total: 12
    });
    expect(act(fight(), "search").check).toMatchObject({ skill: "Wisdom check", total: 12 });
    expect(() => act(fight(), "search", { skill: "stealth" })).toThrow(/Search uses insight, medicine/);
  });

  it("lets Study use Arcana with Expertise", () => {
    expect(act(fight(), "study", { skill: "arcana" }).check).toMatchObject({
      skill: "Intelligence (Arcana)",
      total: 15
    });
  });

  it("makes Influence a Charisma check or Wisdom (Animal Handling), against 15 or the monster's Intelligence", () => {
    expect(act(fight(), "influence", { skill: "persuasion", targetIds: [FOE] }).check).toMatchObject({
      skill: "Charisma (Persuasion)",
      total: 15,
      dc: 15,
      success: true
    });
    expect(act(fight(), "influence", { skill: "persuasion", targetIds: [SAGE] }).check).toMatchObject({
      dc: 18,
      success: false
    });
    expect(act(fight(), "influence", { skill: "animal-handling" }).check).toMatchObject({
      skill: "Wisdom (Animal Handling)",
      total: 12,
      dc: null
    });
  });

  it("escapes a grapple with the skill asked for, else the better one", () => {
    const grappled = () => {
      const state = fight();
      state.actors[0].effects.push({
        id: "grapple",
        name: "Grappled by Goblin",
        tags: [],
        sourceActorId: FOE,
        sourceName: "Goblin",
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "manual" },
        endsWhenSourceDefeated: false,
        voidWhileIncapacitated: false,
        concentration: false,
        endsWithTag: null,
        modifiers: [],
        linkedConditionIds: [],
        escapeDc: 12,
        onEnd: []
      });
      return state;
    };
    // Athletics: Str +1 and PB 2 beats Acrobatics' Dex +2.
    expect(act(grappled(), "escape-grapple").check).toMatchObject({ skill: "Strength (Athletics)", total: 13 });
    expect(act(grappled(), "escape-grapple", { skill: "acrobatics" }).check).toMatchObject({
      skill: "Dexterity (Acrobatics)",
      total: 12
    });
  });

  it("names the total of a successful Hide as the DC to find the creature", () => {
    const hidden = act(fight(), "hide", {}, [16]);
    // Dex +2, no Stealth proficiency.
    expect(hidden.check).toMatchObject({ total: 18, success: true });
    expect(hidden.effectGranted?.name).toBe("Hiding (DC 18 to find)");
  });
});

describe("initiative is a Dexterity check", () => {
  it("has Disadvantage while Poisoned or Frightened", () => {
    const poisoned = fight({ conditions: [{ id: "poisoned" }] });
    expect(initiativeRollFor(poisoned, HERO, false, { resolveDefinition: (id) => DEFINITIONS[id] })).toMatchObject({
      mode: "disadvantage",
      reasons: ["Poisoned"]
    });
    const frightened = fight({ conditions: [{ id: "frightened" }] });
    expect(initiativeRollFor(frightened, HERO, false, {}).mode).toBe("disadvantage");
  });
});

const HEX = {
  id: "hex",
  name: "Hex",
  activation: "bonus-action" as const,
  description: "Hex.",
  damage: [],
  grants: {
    name: "Hex",
    tags: ["hexed"],
    target: "target" as const,
    duration: { type: "manual" as const },
    modifiers: [],
    onEnd: [],
    voidWhileIncapacitated: false,
    concentration: false
  }
};

describe("Hex", () => {
  it("gives Disadvantage on the target's checks with the ability its caster chose, initiative included", () => {
    const state = fight();
    const cast = resolveDefinitionAction(
      state,
      HEX as unknown as ActorDefinition["actions"][number],
      { actorId: HERO, targetIds: [FOE], commandId: COMMAND, ability: "dex" },
      deps([])
    );
    expect(cast.warnings ?? []).toEqual([]);
    const goblin = state.actors.find((actor) => actor.id === FOE)!;
    expect(goblin.effects.map((effect) => effect.name)).toEqual(["Hex (Dexterity)"]);
    const derivation = deriveEquipment(goblin, GOBLIN, undefined);
    expect(checkPlan(goblin, GOBLIN, derivation, { ability: "dex", skill: "stealth" }).rollMode).toEqual({
      mode: "disadvantage",
      advantage: [],
      disadvantage: ["Hex (Dexterity)"]
    });
    expect(checkPlan(goblin, GOBLIN, derivation, { ability: "str" }).rollMode.mode).toBe("normal");
    expect(initiativeRollFor(state, FOE, false, { resolveDefinition: (id) => DEFINITIONS[id] }).mode).toBe(
      "disadvantage"
    );
  });

  it("says so when no ability was chosen", () => {
    const cast = resolveDefinitionAction(
      fight(),
      HEX as unknown as ActorDefinition["actions"][number],
      { actorId: HERO, targetIds: [FOE], commandId: COMMAND },
      deps([])
    );
    expect(cast.warnings).toContain("Hex on Goblin: no ability was chosen, so its checks have no Disadvantage.");
  });
});
