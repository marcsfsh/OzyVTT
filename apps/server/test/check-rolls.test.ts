import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import {
  rerollAbilityCheck,
  rollAbilityCheck,
  type CheckRollDependencies,
  type CheckRollInput
} from "../src/check-rolls.js";
import { makeEffect } from "../src/effects.js";
import { GameAccessDeniedError } from "../src/authorization.js";
import { catalog, library } from "./equipment-table.js";

// A check the sheet asks for is rolled on the server (ADR-0012): the plan's bonus and Advantage, who sees it, its DC,
// a typed face only as the table allows, the GM's forced mode, and the one reroll Heroic Inspiration buys.

const PIP = "10000000-0000-4000-8000-0000000000c1";
const FOE = "10000000-0000-4000-8000-0000000000c2";
const SESSION = "30000000-0000-4000-8000-0000000000c1";
const OTHER_SESSION = "30000000-0000-4000-8000-0000000000c2";
const COMMAND = "50000000-0000-4000-8000-0000000000c1";
const SKILLS = library.skillSummaries();

/** Pip: Dex 16, Wis 14, PB 3, Stealth Expertise (+9), Perception (+5). */
const PIP_SHEET = {
  name: "Pip",
  armorClass: 14,
  proficiencyBonus: 3,
  abilityScores: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 12 },
  hitPoints: { maximum: 30 },
  speedFeet: 30,
  actions: [],
  extensions: {},
  character: { classes: [{ id: "rogue", name: "Rogue", level: 5 }], feats: [] },
  proficiencies: {
    saves: ["dex", "int"],
    skills: [
      { id: "stealth", proficiency: "expertise" },
      { id: "perception", proficiency: "proficient" }
    ]
  }
} as unknown as ActorDefinition;
const GOBLIN = loadMonsterDefinitions().find((monster) => monster.source?.externalId === "goblin-warrior")!;

function tableWith(pip: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: PIP,
        name: "Pip",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        definitionId: "pip-def",
        ownerSessionId: SESSION,
        ...pip
      },
      {
        id: FOE,
        name: "Goblin Warrior",
        kind: "monster",
        visibility: "public",
        hp: { current: 10, maximum: 10 },
        definitionId: "goblin-def"
      }
    ]
  });
}

function depsFor(faces: number[]): CheckRollDependencies {
  let id = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    sessionId: SESSION,
    now: () => "2026-10-16T00:00:00.000Z",
    resolveDefinition: (definitionId) =>
      definitionId === "pip-def" ? PIP_SHEET : definitionId === "goblin-def" ? GOBLIN : undefined,
    catalog,
    names: {
      skill: (skillId) => SKILLS.find((skill) => skill.id === skillId)?.name,
      tool: (toolId) => catalog.equipmentRecord(toolId)?.name
    }
  };
}

const GM = { role: "gm" } as const;
const OWNER = { role: "player", sessionId: SESSION } as const;

const check = (over: Partial<CheckRollInput> = {}): CheckRollInput => ({
  commandId: COMMAND,
  actorId: PIP,
  subject: { ability: "dex", skill: "stealth" },
  dc: null,
  visibility: "public",
  ...over
});

describe("a check roll", () => {
  it("adds the bonus the rules give, with Exhaustion, and records the roll under the check's name", () => {
    const state = tableWith({ conditions: [{ id: "exhaustion", level: 2 }] });
    const rolled = rollAbilityCheck(state, OWNER, check(), depsFor([12]));
    expect(rolled.outcome).toMatchObject({ label: "Dexterity (Stealth)", natural: 12, total: 17 });
    expect(state.rolls.at(-1)).toMatchObject({
      purpose: "check",
      label: "Dexterity (Stealth)",
      normalizedFormula: "1d20+5",
      total: 17
    });
    // A goblin's printed Stealth +6.
    expect(rollAbilityCheck(state, GM, check({ actorId: FOE }), depsFor([10])).outcome.total).toBe(16);
  });

  it("throws two dice and keeps the lower for a Poisoned creature, and says why", () => {
    const state = tableWith({ conditions: [{ id: "poisoned" }] });
    expect(rollAbilityCheck(state, OWNER, check(), depsFor([17, 3])).outcome).toMatchObject({
      natural: 3,
      total: 12,
      rollMode: { mode: "disadvantage", disadvantage: ["Poisoned"] }
    });
  });

  it("refuses a GM-only roll from a player, and someone else's character, and keeps a hidden creature's roll with the GM", () => {
    const state = tableWith();
    expect(() => rollAbilityCheck(state, OWNER, check({ visibility: "gm-only" }), depsFor([10]))).toThrow(
      GameAccessDeniedError
    );
    expect(() => rollAbilityCheck(state, { role: "player", sessionId: OTHER_SESSION }, check(), depsFor([10]))).toThrow(
      GameAccessDeniedError
    );
    state.actors[1].visibility = "gm-only";
    rollAbilityCheck(state, GM, check({ actorId: FOE }), depsFor([10]));
    expect(state.rolls.at(-1)).toMatchObject({ actorId: FOE, visibility: "gm-only" });
  });

  it("keeps a blind roll's numbers from the player who rolled it", () => {
    const state = tableWith();
    const blind = rollAbilityCheck(state, OWNER, check({ visibility: "blind" }), depsFor([10]));
    expect(blind.hiddenFromRoller).toBe(true);
    expect(state.rolls.at(-1)!.visibility).toBe("blind");
  });

  it("says whether the check met its DC", () => {
    const state = tableWith();
    expect(rollAbilityCheck(state, OWNER, check({ dc: 15 }), depsFor([6])).outcome).toMatchObject({
      total: 15,
      dc: 15,
      success: true
    });
    expect(rollAbilityCheck(state, OWNER, check({ dc: 16 }), depsFor([6])).outcome.success).toBe(false);
    expect(rollAbilityCheck(state, OWNER, check(), depsFor([6])).outcome.success).toBeNull();
  });

  it("takes what a player typed only as the d20 dice mode asks; the GM always", () => {
    const state = tableWith();
    const typed = rollAbilityCheck(state, OWNER, check({ face: 14 }), depsFor([]));
    expect(typed.outcome).toMatchObject({ natural: 14, total: 23, typed: true });
    expect(state.rolls.at(-1)).toMatchObject({ typed: true, total: 23 });
    expect(() => rollAbilityCheck(state, OWNER, check({ total: 23 }), depsFor([]))).toThrow(/type the die's face/);

    // Totals: the server takes its bonus back off, so the typed total is the total, and checks its range.
    state.playerDice = { ...state.playerDice, d20: "total" };
    expect(rollAbilityCheck(state, OWNER, check({ total: 23 }), depsFor([])).outcome).toMatchObject({
      natural: 14,
      total: 23,
      typed: true
    });
    expect(() => rollAbilityCheck(state, OWNER, check({ total: 30 }), depsFor([]))).toThrow(
      "A d20 + 9 total is 10 to 29. Check the total you typed."
    );
    expect(() => rollAbilityCheck(state, OWNER, check({ face: 14 }), depsFor([]))).toThrow(/type the total/);

    state.playerDice = { ...state.playerDice, d20: "app" };
    expect(() => rollAbilityCheck(state, OWNER, check({ face: 14 }), depsFor([]))).toThrow(
      /server rolls players' dice/
    );
    expect(rollAbilityCheck(state, GM, check({ face: 14 }), depsFor([])).outcome.total).toBe(23);
    expect(rollAbilityCheck(state, GM, check({ total: 20 }), depsFor([])).outcome.natural).toBe(11);
  });

  it("ignores a player's roll mode, and names the GM's forced mode as the GM's", () => {
    const state = tableWith();
    const player = rollAbilityCheck(state, OWNER, check({ forcedMode: "advantage" }), depsFor([7]));
    expect(player.outcome.natural).toBe(7);
    expect(player.outcome.rollMode).toBeUndefined();
    const gm = rollAbilityCheck(state, GM, check({ forcedMode: "advantage" }), depsFor([7, 16]));
    expect(gm.outcome).toMatchObject({ natural: 16, rollMode: { mode: "advantage", advantage: ["GM's choice"] } });
  });

  it("gives Advantage to find a creature the roller's Hunter's Mark is on, unless it is hidden from the player", () => {
    const state = tableWith();
    state.actors[1].effects.push(
      makeEffect({
        id: "mark",
        name: "Hunter's Mark",
        duration: { type: "manual" },
        tags: ["hunters-mark"],
        sourceActorId: PIP,
        sourceName: "Pip"
      })
    );
    const finding = check({ subject: { ability: "wis", skill: "perception" }, findActorId: FOE });
    expect(rollAbilityCheck(state, OWNER, finding, depsFor([3, 12])).outcome).toMatchObject({
      natural: 12,
      rollMode: { mode: "advantage", advantage: ["Hunter's Mark (finding Goblin Warrior)"] }
    });
    // A player can't ask about a creature hidden from them: the roll would answer whether their mark is on it.
    state.actors[1].visibility = "gm-only";
    expect(rollAbilityCheck(state, OWNER, finding, depsFor([3])).outcome.rollMode).toBeUndefined();
  });
});

describe("rerolling a check", () => {
  it("rerolls the lower die once for Heroic Inspiration, and only right after the roll", () => {
    const state = tableWith({ conditions: [{ id: "poisoned" }], heroicInspiration: true });
    rollAbilityCheck(state, OWNER, check(), depsFor([3, 18]));
    const rerolled = rerollAbilityCheck(state, OWNER, { commandId: COMMAND, actorId: PIP }, depsFor([16]));
    // The 3 is thrown again; with Disadvantage the 16 and the 18 leave the 16.
    expect(rerolled.outcome).toMatchObject({ natural: 16, total: 25 });
    expect(state.rolls.at(-1)).toMatchObject({ label: "Dexterity (Stealth) reroll" });
    expect(state.actors[0].heroicInspiration).toBe(false);
    expect(() => rerollAbilityCheck(state, OWNER, { commandId: COMMAND, actorId: PIP }, depsFor([20]))).toThrow(
      /no Heroic Inspiration/
    );
    // A reroll comes right after the roll: another roll for Pip in between closes it.
    state.actors[0].heroicInspiration = true;
    rollAbilityCheck(state, OWNER, check(), depsFor([5, 9]));
    state.rolls.push({ ...state.rolls.at(-1)!, id: "40000000-0000-4000-8000-0000000000ff", purpose: "save" });
    expect(() => rerollAbilityCheck(state, OWNER, { commandId: COMMAND, actorId: PIP }, depsFor([20]))).toThrow(
      /no check to reroll/
    );
  });

  it("lets the GM reroll the whole check without Heroic Inspiration, keeping the mode the GM forced", () => {
    const state = tableWith();
    rollAbilityCheck(state, GM, check({ forcedMode: "advantage" }), depsFor([2, 4]));
    const rerolled = rerollAbilityCheck(state, GM, { commandId: COMMAND, actorId: PIP }, depsFor([11, 19]));
    expect(rerolled.outcome).toMatchObject({ natural: 19, rollMode: { advantage: ["GM's choice"] } });
  });

  it("rerolls a typed check with a typed die, and a thrown check only on the server", () => {
    const state = tableWith({ heroicInspiration: true });
    rollAbilityCheck(state, OWNER, check({ face: 5 }), depsFor([]));
    expect(() => rerollAbilityCheck(state, OWNER, { commandId: COMMAND, actorId: PIP }, depsFor([20]))).toThrow(
      /Type the die your reroll shows/
    );
    const typed = rerollAbilityCheck(state, OWNER, { commandId: COMMAND, actorId: PIP, face: 15 }, depsFor([]));
    expect(typed.outcome).toMatchObject({ natural: 15, typed: true });

    state.actors[0].heroicInspiration = true;
    rollAbilityCheck(state, OWNER, check(), depsFor([4]));
    expect(() => rerollAbilityCheck(state, OWNER, { commandId: COMMAND, actorId: PIP, face: 20 }, depsFor([]))).toThrow(
      /server threw this die/
    );
    // The refusal spent nothing.
    expect(state.actors[0].heroicInspiration).toBe(true);
  });
});
