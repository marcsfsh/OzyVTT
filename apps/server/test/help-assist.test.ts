import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { actionAvailability, resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { rollAbilityCheck } from "../src/check-rolls.js";
import { catalog } from "./spell-casters.js";

// SRD 5.2.1 Help, Assist an Ability Check: "Choose one of your skill or tool proficiencies and one ally who is near
// enough for you to assist verbally or physically when they make an ability check. That ally has Advantage on the next
// ability check they make with the chosen skill or tool."

const IDS = {
  rogue: "10000000-0000-4000-8000-000000000a01",
  fighter: "10000000-0000-4000-8000-000000000a02",
  gm: "30000000-0000-4000-8000-000000000a0a"
};
const NOW = () => "2026-10-19T00:00:00.000Z";
let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

/** A party member proficient in Athletics and with Thieves' Tools. */
const rogueDefinition = {
  name: "Rogue",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 14, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
  hitPoints: { maximum: 20 },
  actions: [],
  proficiencies: { saves: [], skills: [{ id: "athletics", proficiency: "proficient" }], tools: ["thieves-tools"] },
  extensions: {}
} as unknown as ActorDefinition;

/** The party at rest, with no fight running. */
function party(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.rogue,
        name: "Rogue",
        kind: "player-character",
        hp: { current: 20, maximum: 20 },
        armorClass: 12,
        definitionId: "rogue"
      },
      {
        id: IDS.fighter,
        name: "Fighter",
        kind: "player-character",
        hp: { current: 20, maximum: 20 },
        armorClass: 12,
        definitionId: "rogue"
      }
    ]
  }) as GameState;
}

const resolveDefinition = (id: string) => (id === "rogue" ? rogueDefinition : undefined);

function help(state: GameState, skill: string) {
  return resolveDefinitionAction(
    state,
    builtinAction("help-check")!,
    { actorId: IDS.rogue, targetIds: [IDS.fighter], commandId: nextId(), builtin: true, skill },
    {
      random: () => 3,
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      resolveDefinition,
      definition: rogueDefinition,
      catalog
    }
  );
}

function toolCheck(state: GameState) {
  return rollAbilityCheck(
    state,
    { role: "gm" },
    {
      commandId: nextId(),
      actorId: IDS.fighter,
      subject: { ability: "dex", tool: "thieves-tools" },
      dc: 15,
      visibility: "public"
    },
    { random: () => 12, newId: nextId, sessionId: IDS.gm, now: NOW, resolveDefinition, catalog }
  );
}

const fighter = (state: GameState) => state.actors.find((actor) => actor.id === IDS.fighter)!;

describe("Help with a Check outside a fight", () => {
  it("gives the ally Advantage on its next check with the helper's tool, once", () => {
    const state = party();
    help(state, "thieves-tools");
    expect(fighter(state).effects).toMatchObject([{ name: "Helped by Rogue (Thieves' Tools)" }]);
    const first = toolCheck(state);
    expect(first.outcome.rollMode?.advantage).toEqual(["Helped by Rogue (Thieves' Tools)"]);
    const second = toolCheck(state);
    expect(second.outcome.rollMode).toBeUndefined();
    expect(fighter(state).effects).toEqual([]);
  });

  it("helps with a skill while no fight is running", () => {
    const state = party();
    help(state, "athletics");
    expect(fighter(state).effects).toMatchObject([{ name: "Helped by Rogue (Athletics)" }]);
  });

  it("refuses a tool the helper has no proficiency with", () => {
    expect(() => help(party(), "disguise-kit")).toThrow(/names the skill or tool you help with/);
  });

  it("offers the helper's tools by name beside the skills", () => {
    const state = party();
    const rogue = state.actors.find((actor) => actor.id === IDS.rogue)!;
    const [row] = actionAvailability(state, rogue, [builtinAction("help-check")!], rogueDefinition, true, [], catalog);
    expect(row?.checkSkills).toContainEqual({ id: "thieves-tools", name: "Thieves' Tools", ability: "dex" });
    expect(row?.checkSkills).toContainEqual({ id: "athletics", ability: "str" });
  });
});
