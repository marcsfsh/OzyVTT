import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { addEffect, makeEffect } from "../src/effects.js";
import { applyRest, partyLongRestMinutes } from "../src/rests.js";

// SRD Trance (Elf): "You don't need to sleep, and magic can't put you to sleep. You can finish a Long Rest in 4 hours
// if you spend those hours in a trancelike meditation."

const ELF = "10000000-0000-4000-8000-0000000000e1";
const HUMAN = "10000000-0000-4000-8000-0000000000e2";

const sheet = (traits: readonly string[]) =>
  ({
    name: "Anyone",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    hitPoints: { maximum: 30 },
    armorClass: 12,
    extensions: { test: { traits: traits.map((name) => ({ name })) } },
    actions: []
  }) as unknown as ActorDefinition;
const DEFINITIONS: Readonly<Record<string, ActorDefinition>> = { elf: sheet(["Trance"]), human: sheet([]) };
const resolveDefinition = (id: string) => DEFINITIONS[id];

function party(): GameState {
  const member = (id: string, definitionId: string) => ({
    id,
    name: definitionId === "elf" ? "Ilyana" : "Corwin",
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 30 },
    definitionId
  });
  return GameStateSchema.parse({ schemaVersion: 1, actors: [member(ELF, "elf"), member(HUMAN, "human")] });
}
const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;

describe("Trance", () => {
  it("keeps magic from putting an elf to sleep (Eyebite's Asleep, a Sleep Breath's second failure)", () => {
    const state = party();
    const asleep = (id: string) =>
      addEffect(
        state,
        id,
        makeEffect({
          id: `asleep-${id}`,
          name: "Eyebite",
          tags: ["wakeable"],
          linkedConditionIds: ["unconscious"],
          duration: { type: "rounds", remaining: 10 }
        }),
        [],
        { resolveDefinition }
      );
    asleep(ELF);
    asleep(HUMAN);
    expect(actor(state, ELF).conditions).toEqual([]);
    expect(actor(state, ELF).effects).toEqual([]);
    expect(actor(state, HUMAN).conditions.map((condition) => condition.id)).toContain("unconscious");
  });

  it("marks a brass dragon's Sleep Breath as a save a creature that doesn't sleep succeeds on", () => {
    const dragon = loadMonsterDefinitions().find((entry) => entry.source.externalId === "adult-brass-dragon")!;
    const breath = dragon.actions.find((action) => /sleep breath/i.test(action.name));
    expect(breath?.save?.autoSuccess).toEqual({ sleepless: true });
  });

  it("finishes an elf's own Long Rest in 4 hours: what lasts 5 hours outlives it, and a human's rest ends it", () => {
    const state = party();
    for (const id of [ELF, HUMAN])
      addEffect(
        state,
        id,
        makeEffect({ id: `ward-${id}`, name: "Ward", duration: { type: "minutes", remaining: 300 } })
      );
    applyRest(state, ELF, "long", resolveDefinition);
    applyRest(state, HUMAN, "long", resolveDefinition);
    expect(actor(state, ELF).effects.map((effect) => effect.id)).toEqual([`ward-${ELF}`]);
    expect(actor(state, HUMAN).effects).toEqual([]);
  });

  it("takes the party 4 hours when every member is in Trance, and 8 with anyone who sleeps", () => {
    const state = party();
    expect(partyLongRestMinutes([actor(state, ELF)], resolveDefinition)).toBe(240);
    expect(partyLongRestMinutes([actor(state, ELF), actor(state, HUMAN)], resolveDefinition)).toBe(480);
  });
});
