import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import type { ActorDefinition } from "@vtt/schemas";
import { describe, expect, it } from "vitest";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { builtinAction } from "../src/builtin-actions.js";
import { addEffect, makeEffect, type EffectNarration } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";
import { startOfTurn } from "../src/turn-boundaries.js";

// SRD 5.2.1 Paladin auras beyond Aura of Protection, for the Paladin and the allies in its aura: Aura of Courage and
// Aura of Devotion ("You and your allies have Immunity to the Frightened [Charmed] condition while in your Aura of
// Protection. If a Frightened ally enters the aura, that condition has no effect on that ally while there."), Holy
// Nimbus's Radiant damage and Holy Ward, and Smite of Protection's Half Cover.

const PALADIN = "10000000-0000-4000-8000-0000000000e1";
const ALLY = "10000000-0000-4000-8000-0000000000e2";
const FAR = "10000000-0000-4000-8000-0000000000e3";
const FOE = "10000000-0000-4000-8000-0000000000e4";
const ZOMBIE = loadMonsterDefinitions().find((monster) => monster.source?.externalId === "zombie")!;

function sheet(name: string, features: readonly string[], cha = 16): ActorDefinition {
  const base = loadActorFixture("player-character") as ActorDefinition;
  return {
    ...base,
    name,
    abilityScores: { ...base.abilityScores, cha },
    proficiencyBonus: 4,
    character: {
      classes: [{ id: "paladin", name: "Paladin", level: 18 }],
      feats: [],
      features: features.map((id) => ({ id, kind: "class" as const, sourceId: "paladin" }))
    }
  };
}
const PLAIN = sheet("Plain", [], 8);

/** Sir Ada (a Paladin with `features`), Bran 10 feet from her, Cass 15 feet off, and a zombie 5 feet away. */
function table(features: readonly string[]): {
  state: GameState;
  resolve: (id: string) => ActorDefinition | undefined;
  context: { resolveDefinition: (id: string) => ActorDefinition | undefined; distanceFeet: typeof distanceFeet };
} {
  const definitions: Record<string, ActorDefinition> = {
    "paladin-def": sheet("Sir Ada", features),
    "plain-def": PLAIN,
    zombie: ZOMBIE
  };
  const pc = (id: string, name: string, definitionId: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 30 },
    armorClass: 12,
    definitionId
  });
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      pc(PALADIN, "Sir Ada", "paladin-def"),
      pc(ALLY, "Bran", "plain-def"),
      pc(FAR, "Cass", "plain-def"),
      {
        id: FOE,
        name: "Zombie",
        kind: "monster",
        visibility: "public",
        hp: { current: 15, maximum: 15 },
        armorClass: 8,
        definitionId: "zombie"
      }
    ]
  });
  const resolve = (id: string) => definitions[id];
  return { state, resolve, context: { resolveDefinition: resolve, distanceFeet } };
}

const FEET: Readonly<Record<string, number>> = { [ALLY]: 10, [FAR]: 15, [FOE]: 5 };
/** Each creature's distance from Sir Ada; any other pair is 20 feet apart. */
const distanceFeet = (a: string, b: string): number | null =>
  a === b ? 0 : a === PALADIN ? (FEET[b] ?? null) : b === PALADIN ? (FEET[a] ?? null) : 20;
const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const conditionsOf = (state: GameState, id: string) => actor(state, id).conditions.map((condition) => condition.id);

/** A failed save against the zombie that imposes `conditionId` on `targetId`. */
function failSave(
  state: GameState,
  resolve: (id: string) => ActorDefinition | undefined,
  targetId: string,
  conditionId: string
): void {
  const saveId = `60000000-0000-4000-8000-${targetId.slice(-12)}`;
  createPendingSaves(state, {
    sourceActorId: FOE,
    sourceName: "Zombie",
    actionName: "Dread",
    ability: "wis",
    dc: 30,
    targetIds: [targetId],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [conditionId],
    onFailEffect: {
      name: "Dread",
      tags: [],
      linkedConditionIds: [conditionId],
      escapeDc: null,
      sourceActorId: FOE,
      sourceName: "Zombie",
      duration: { type: "rounds", rounds: 10 }
    },
    newSaveId: () => saveId,
    createdAt: 0
  });
  answerSave(state, `cmd-${saveId}`, saveId, "roll", undefined, true, { role: "gm" }, saveDeps(resolve));
}
const saveDeps = (resolve: (id: string) => ActorDefinition | undefined, faces: number[] = []) => ({
  random: () => faces.shift() ?? 2,
  newRollId: () => `40000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
  sessionId: "30000000-0000-4000-8000-00000000000a",
  role: "gm" as const,
  now: () => "2026-10-17T00:00:00.000Z",
  resolveDefinition: resolve,
  distanceFeet
});

describe("Aura of Courage and Aura of Devotion", () => {
  it("keep a failed save's Frightened off the Paladin's allies in the aura, and not off one outside it", () => {
    const { state, resolve } = table(["aura-of-protection", "aura-of-courage"]);
    failSave(state, resolve, ALLY, "frightened");
    failSave(state, resolve, FAR, "frightened");
    expect(conditionsOf(state, ALLY)).toEqual([]);
    expect(conditionsOf(state, FAR)).toEqual(["frightened"]);
  });

  it("reach 30 feet with Aura Expansion, and stop while the Paladin is Incapacitated", () => {
    const expanded = table(["aura-of-protection", "aura-of-courage", "aura-expansion"]);
    failSave(expanded.state, expanded.resolve, FAR, "frightened");
    expect(conditionsOf(expanded.state, FAR)).toEqual([]);
    const stunned = table(["aura-of-protection", "aura-of-devotion"]);
    actor(stunned.state, PALADIN).conditions = [{ id: "stunned" }];
    failSave(stunned.state, stunned.resolve, ALLY, "charmed");
    expect(conditionsOf(stunned.state, ALLY)).toEqual(["charmed"]);
  });

  it("keep Charmed off with Aura of Devotion, a condition set by hand too", () => {
    const { state, resolve, context } = table(["aura-of-protection", "aura-of-devotion"]);
    failSave(state, resolve, ALLY, "charmed");
    expect(conditionsOf(state, ALLY)).toEqual([]);
    const events = setCondition(state, ALLY, "charmed", true, undefined, { role: "gm" }, { ...context });
    expect(events[0]).toMatchObject({ immune: true });
  });

  it("take away a Frightened ally's Disadvantage on its attack roll while it stands in the aura", () => {
    const { state, resolve } = table(["aura-of-protection", "aura-of-courage"]);
    actor(state, ALLY).conditions = [{ id: "frightened" }];
    actor(state, FAR).conditions = [{ id: "frightened" }];
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: ALLY, score: 20 },
          { actorId: FAR, score: 15 },
          { actorId: PALADIN, score: 10 },
          { actorId: FOE, score: 5 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const strike = (attackerId: string) =>
      resolveDefinitionAction(
        state,
        builtinAction("unarmed-strike")!,
        {
          actorId: attackerId,
          targetIds: [FOE],
          commandId: `50000000-0000-4000-8000-${attackerId.slice(-12)}`,
          builtin: true,
          override: { reason: "test" }
        },
        {
          random: () => 12,
          newRollId: () => `40000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-17T00:00:00.000Z",
          definition: PLAIN,
          resolveDefinition: resolve,
          distanceFeet
        }
      );
    expect(strike(ALLY).rollMode?.disadvantage ?? []).not.toContain("Attacker is Frightened");
    expect(strike(FAR).rollMode?.disadvantage).toContain("Attacker is Frightened");
  });
});

describe("Holy Nimbus", () => {
  const nimbus = (state: GameState) =>
    addEffect(
      state,
      PALADIN,
      makeEffect({
        id: "nimbus",
        name: "Holy Nimbus",
        tags: ["holy-nimbus"],
        sourceActorId: PALADIN,
        sourceName: "Sir Ada",
        duration: { type: "rounds", remaining: 100 }
      })
    );

  it("burns an enemy that starts its turn in the aura for the Charisma modifier plus the Proficiency Bonus", () => {
    const { state, resolve } = table(["aura-of-protection", "holy-nimbus"]);
    nimbus(state);
    const events: EffectNarration[] = [];
    startOfTurn(state, FOE, events, { rollDie: () => 1, resolveDefinition: resolve, distanceFeet });
    // Charisma 16 (+3) and Proficiency Bonus 4.
    expect(actor(state, FOE).hp.current).toBe(8);
    expect(events.map((event) => event.text)).toContain("Zombie takes 7 Radiant damage from Sir Ada's Holy Nimbus.");
    // An ally starting its turn there is spared.
    startOfTurn(state, ALLY, [], { rollDie: () => 1, resolveDefinition: resolve, distanceFeet });
    expect(actor(state, ALLY).hp.current).toBe(30);
  });

  it("gives the Paladin Advantage on a save a Fiend or an Undead forces", () => {
    const { state, resolve } = table(["aura-of-protection", "holy-nimbus"]);
    nimbus(state);
    createPendingSaves(state, {
      sourceActorId: FOE,
      sourceName: "Zombie",
      actionName: "Grasp",
      ability: "str",
      dc: 10,
      targetIds: [PALADIN],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      newSaveId: () => "60000000-0000-4000-8000-0000000000e9",
      createdAt: 0
    });
    const { outcome } = answerSave(
      state,
      "cmd-ward",
      "60000000-0000-4000-8000-0000000000e9",
      "roll",
      undefined,
      true,
      { role: "gm" },
      saveDeps(resolve, [3, 17])
    );
    expect(outcome.rollMode?.advantage).toContain("Holy Nimbus (Holy Ward)");
    expect(outcome.natural).toBe(17);
  });
});

describe("Smite of Protection", () => {
  it("gives the creatures in the aura Half Cover against an attack until the Paladin's next turn", () => {
    const { state, resolve } = table(["aura-of-protection", "smite-of-protection"]);
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: FOE, score: 20 },
          { actorId: PALADIN, score: 10 },
          { actorId: ALLY, score: 8 },
          { actorId: FAR, score: 6 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    addEffect(
      state,
      PALADIN,
      makeEffect({
        id: "smite",
        name: "Smite of Protection",
        tags: ["smite-of-protection"],
        sourceActorId: PALADIN,
        sourceName: "Sir Ada",
        duration: { type: "until-source-next-turn" }
      })
    );
    const slam = (targetId: string) =>
      resolveDefinitionAction(
        state,
        ZOMBIE.actions.find((action) => action.id === "slam")!,
        {
          actorId: FOE,
          targetIds: [targetId],
          commandId: `50000000-0000-4000-8000-${targetId.slice(-12)}`,
          override: { reason: "test" }
        },
        {
          random: (sides) => Math.min(sides, 10),
          newRollId: () => `40000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-17T00:00:00.000Z",
          definition: ZOMBIE,
          resolveDefinition: resolve,
          distanceFeet
        }
      );
    expect(slam(ALLY).attack?.coverBonus).toBe(2);
    expect(slam(FAR).attack?.coverBonus).toBeUndefined();
  });
});
