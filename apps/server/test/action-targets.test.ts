import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";
import { wordsOfCreation } from "../src/resolution/action-targets.js";

// Who a non-spell action may target, checked on the server: the monster save actions' printed targets (a Trample's
// Prone creature, a swallow's grappled one, Death Glare's Frightened one), and Words of Creation's second target.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000601",
  hero: "10000000-0000-4000-8000-000000000602",
  other: "10000000-0000-4000-8000-000000000603",
  map: "20000000-0000-5000-8000-000000000601"
};

function table(slug: string) {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const creature = (id: string, name: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 100, maximum: 100 },
    armorClass: 12
  });
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
        definitionId: "monster-def"
      },
      creature(IDS.hero, "Hero"),
      creature(IDS.other, "Other")
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 10 },
        { actorId: IDS.other, score: 5 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  let command = 0;
  const use = (actionId: string, targetIds: string[], apart = 5) =>
    resolveDefinitionAction(
      state,
      definition.actions.find((entry) => entry.id === actionId)!,
      {
        actorId: IDS.monster,
        targetIds,
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`
      },
      {
        random: () => 10,
        newRollId: () => `40000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        gmSessionId: "30000000-0000-4000-8000-00000000060a",
        now: () => "2026-10-18T00:00:00.000Z",
        definition,
        resolveDefinition: (id) => state.definitions.find((entry) => entry.id === id)?.definition,
        distanceFeet: () => apart
      }
    );
  const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
  return { state, definition, hero, use };
}

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof RulesBlockedError) return error.message;
    throw error;
  }
  return null;
};

describe("a monster's save action targets what its text names", () => {
  it("tramples only a Prone creature within 5 feet (an elephant)", () => {
    const built = table("elephant");
    expect(refusal(() => built.use("trample", [IDS.hero]))).toMatch(/targets a Prone creature, and Hero isn't/);
    built.hero.conditions = [{ id: "prone" }] as typeof built.hero.conditions;
    expect(refusal(() => built.use("trample", [IDS.hero], 10))).toMatch(/Hero is 10 ft away, beyond Trample's/);
    expect(built.use("trample", [IDS.hero]).save?.targets).toHaveLength(1);
  });

  it("swallows only a creature the behir is grappling, one at a time", () => {
    const built = table("behir");
    expect(refusal(() => built.use("swallow", [IDS.hero]))).toMatch(/targets a creature Behir is grappling/);
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({
        id: "held",
        name: "Grappled by Behir",
        tags: ["grapple"],
        sourceActorId: IDS.monster,
        linkedConditionIds: ["grappled"],
        duration: { type: "manual" }
      })
    );
    expect(refusal(() => built.use("swallow", [IDS.hero, IDS.other]))).toMatch(/one creature; 2 were chosen/);
    expect(built.use("swallow", [IDS.hero]).save?.targets).toHaveLength(1);
  });

  it("glares only at a Frightened creature (a sea hag's Death Glare)", () => {
    const built = table("sea-hag");
    expect(refusal(() => built.use("death-glare", [IDS.hero]))).toMatch(/targets a Frightened creature/);
  });
});

describe("Words of Creation's second target", () => {
  const bard = { id: IDS.hero, definitionId: "bard" } as Parameters<typeof wordsOfCreation>[0];
  const bardDefinition = {
    character: { features: [{ id: "words-of-creation", kind: "class", sourceId: "bard" }] }
  } as unknown as ActorDefinition;
  const resolve = (id: string) => (id === "bard" ? bardDefinition : undefined);
  const name = (id: string) => (id === IDS.monster ? "Ogre" : "Goblin");

  it("adds a second target to Power Word Kill within 10 feet of the first", () => {
    expect(wordsOfCreation(bard, "power-word-kill", [IDS.monster, IDS.other], resolve, () => 10, name)).toEqual({
      extra: 1
    });
    expect(
      wordsOfCreation(bard, "power-word-kill", [IDS.monster, IDS.other], resolve, () => 20, name).violation?.message
    ).toBe("Goblin is 20 ft from Ogre, and Words of Creation's second target must be within 10 feet of the first.");
  });

  it("adds none to another spell, or without the feature", () => {
    expect(wordsOfCreation(bard, "power-word-stun", [IDS.monster], resolve, () => 5, name).extra).toBe(0);
    expect(
      wordsOfCreation(
        bard,
        "power-word-kill",
        [IDS.monster],
        () => undefined,
        () => 5,
        name
      ).extra
    ).toBe(0);
  });
});
