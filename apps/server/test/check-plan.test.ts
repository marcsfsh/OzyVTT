import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan, totalCheck, type CheckSubject } from "../src/ability-checks.js";
import { deriveActorSheet } from "../src/actor-derived.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { catalog, fighterInput, IDS as TABLE_IDS, library, tableOf } from "./equipment-table.js";

// One plan for every ability check (SRD 5.2.1 Ability Checks, Proficiency, Exhaustion, Poisoned, Frightened, Tools,
// Jack of All Trades, Reliable Talent, Hunter's Mark): the sheet's numbers, its Advantage and why, and the dice the
// builtin actions roll all come from it.

const PIP = "10000000-0000-4000-8000-0000000000c1";
const FOE = "10000000-0000-4000-8000-0000000000c2";
const COMMAND = "50000000-0000-4000-8000-0000000000c1";
const SKILLS = library.skillSummaries();
const NAMES = {
  skill: (id: string) => SKILLS.find((skill) => skill.id === id)?.name,
  tool: (id: string) => catalog.equipmentRecord(id)?.name
};

/** Pip: Dex 16, Wis 14, PB 3, Stealth Expertise (+9), Perception (+5). */
function sheetOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
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
    },
    ...over
  } as unknown as ActorDefinition;
}

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
        speedFeet: 30,
        definitionId: "pip-def",
        ...pip
      },
      {
        id: FOE,
        name: "Goblin Warrior",
        kind: "monster",
        visibility: "public",
        hp: { current: 10, maximum: 10 },
        speedFeet: 30,
        definitionId: "goblin-def"
      }
    ]
  });
}

const actorOf = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;

function sheetFor(state: GameState, actorId: string, definition: ActorDefinition) {
  const actor = actorOf(state, actorId);
  return deriveActorSheet(actor, definition, deriveEquipment(actor, definition, catalog), SKILLS, catalog);
}

function planFor(state: GameState, actorId: string, definition: ActorDefinition, subject: CheckSubject) {
  const actor = actorOf(state, actorId);
  return checkPlan(actor, definition, deriveEquipment(actor, definition, catalog), subject, { names: NAMES });
}

/** Rolls a plan with fixed faces, as the server would. */
const rolled = (plan: ReturnType<typeof checkPlan>, faces: number[]) =>
  totalCheck(plan, faces, plan.rollMode.mode, () => {
    throw new Error("no other die");
  });

describe("the sheet's check numbers are the rolls the server makes", () => {
  it("takes Exhaustion off every ability check and skill, as it does off the save beside them", () => {
    const definition = sheetOf();
    const state = tableWith({ conditions: [{ id: "exhaustion", level: 2 }] });
    const sheet = sheetFor(state, PIP, definition);
    // Dex +3 and Stealth +9, each 4 lower at Exhaustion 2; Speed 30 is 10 feet lower.
    expect(sheet.abilities.find((row) => row.ability === "dex")!.check).toBe(-1);
    expect(sheet.skills.find((row) => row.id === "stealth")!.bonus).toBe(5);
    expect(sheet.speedFeet).toBe(20);
    const stealth = planFor(state, PIP, definition, { ability: "dex", skill: "stealth" });
    expect(rolled(stealth, [12])).toMatchObject({ natural: 12, total: 17 });
  });

  it("gives a Poisoned or Frightened creature Disadvantage on its checks, and says why", () => {
    const definition = sheetOf();
    const poisoned = tableWith({ conditions: [{ id: "poisoned" }] });
    const stealth = sheetFor(poisoned, PIP, definition).skills.find((row) => row.id === "stealth")!;
    expect(stealth.mode).toEqual({ mode: "disadvantage", advantage: [], disadvantage: ["Poisoned"] });
    const plan = planFor(poisoned, PIP, definition, { ability: "dex", skill: "stealth" });
    expect(rolled(plan, [17, 3])).toMatchObject({ natural: 3, total: 12 });

    const frightened = tableWith({ conditions: [{ id: "frightened" }] });
    expect(planFor(frightened, PIP, definition, { ability: "str" }).rollMode).toEqual({
      mode: "disadvantage",
      advantage: [],
      disadvantage: ["Frightened"]
    });
  });

  it("makes a Poisoned rogue's Hide keep the lower die, so the 17 no longer hides them", () => {
    const definition = sheetOf();
    const state = tableWith({ conditions: [{ id: "poisoned" }] });
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: PIP, score: 20 },
          { actorId: FOE, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const faces = [17, 3];
    const hidden = resolveDefinitionAction(
      state,
      builtinAction("hide")!,
      { actorId: PIP, targetIds: [], commandId: COMMAND, builtin: true, rollMode: null, override: null },
      {
        random: () => faces.shift()!,
        newRollId: () => "40000000-0000-4000-8000-000000000099",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-16T00:00:00.000Z",
        definition,
        catalog
      }
    );
    // Stealth Expertise counts (+9): 3 + 9 = 12 misses DC 15.
    expect(hidden.check).toMatchObject({ skill: "Dexterity (Stealth)", naturalRoll: 3, total: 12, success: false });
    expect(hidden.rollMode?.disadvantage).toEqual(["Poisoned"]);
  });

  it("adds Jack of All Trades to a Bard's checks with a skill it lacks, and nowhere else", () => {
    const bard = sheetOf({
      abilityScores: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 16 },
      character: {
        classes: [{ id: "bard", name: "Bard", level: 5 }],
        feats: [],
        features: [{ id: "jack-of-all-trades", kind: "class", sourceId: "bard" }]
      },
      proficiencies: { saves: ["dex", "cha"], skills: [{ id: "performance", proficiency: "proficient" }] }
    });
    const sheet = sheetFor(tableWith(), PIP, bard);
    const skill = (id: string) => sheet.skills.find((row) => row.id === id)!.bonus;
    // Half of PB 3, rounded down: +1 on Athletics; Performance already uses the full PB.
    expect(skill("athletics")).toBe(1);
    expect(skill("performance")).toBe(6);
    // A check with no skill isn't one "that uses a skill proficiency you lack".
    expect(sheet.abilities.find((row) => row.ability === "str")!.check).toBe(0);
    const plain = sheetFor(tableWith(), PIP, sheetOf());
    expect(plain.skills.find((row) => row.id === "athletics")!.bonus).toBe(0);
  });

  it("counts a d20 of 9 or lower as a 10 on a Rogue's proficient checks (Reliable Talent)", () => {
    const rogue = sheetOf({
      character: {
        classes: [{ id: "rogue", name: "Rogue", level: 7 }],
        feats: [],
        features: [{ id: "reliable-talent", kind: "class", sourceId: "rogue" }]
      }
    });
    const state = tableWith();
    const sheet = sheetFor(state, PIP, rogue);
    expect(sheet.skills.find((row) => row.id === "stealth")!.reliableTalent).toBe(true);
    expect(sheet.skills.find((row) => row.id === "athletics")!.reliableTalent).toBe(false);
    const stealth = planFor(state, PIP, rogue, { ability: "dex", skill: "stealth" });
    expect(rolled(stealth, [3])).toMatchObject({ natural: 3, total: 19, reliableTalent: true });
    const athletics = planFor(state, PIP, rogue, { ability: "str", skill: "athletics" });
    expect(rolled(athletics, [3])).toMatchObject({ natural: 3, total: 3, reliableTalent: false });
  });

  it("checks a tool with its proficiency, with Advantage when a proficient skill goes with it", () => {
    const definition = sheetOf({
      proficiencies: {
        saves: ["dex", "int"],
        skills: [{ id: "sleight-of-hand", proficiency: "proficient" }],
        tools: ["thieves-tools"]
      }
    });
    const state = tableWith();
    expect(sheetFor(state, PIP, definition).tools).toEqual([
      expect.objectContaining({ id: "thieves-tools", name: "Thieves' Tools", ability: "dex", bonus: 6 })
    ]);
    expect(planFor(state, PIP, definition, { ability: "dex", tool: "thieves-tools" })).toMatchObject({
      label: "Thieves' Tools (Dexterity)",
      modifier: 6
    });
    // The Proficiency Bonus counts once; the skill's proficiency gives Advantage instead.
    expect(
      planFor(state, PIP, definition, { ability: "dex", skill: "sleight-of-hand", tool: "thieves-tools" })
    ).toMatchObject({
      label: "Dexterity (Sleight of Hand) with Thieves' Tools",
      modifier: 6,
      rollMode: { mode: "advantage", advantage: ["Skill and tool proficiency"] }
    });
    const untrained = sheetOf({ proficiencies: { saves: [], skills: [] } });
    expect(planFor(state, PIP, untrained, { ability: "dex", tool: "thieves-tools" }).modifier).toBe(3);
  });

  it("reads a monster's printed skills, so a goblin hides at +6 and its sheet has the chip", () => {
    const sheet = sheetFor(tableWith(), FOE, GOBLIN);
    expect(sheet.skills.find((row) => row.id === "stealth")).toMatchObject({ bonus: 6, tier: "proficient" });
    // A skill the stat block doesn't print is the ability alone.
    expect(sheet.skills.find((row) => row.id === "perception")).toMatchObject({ bonus: -1, tier: "none" });
    expect(sheet.passivePerception).toBe(9);
  });

  it("gives worn Chain Mail's Stealth Disadvantage to the sheet's Stealth", () => {
    const table = tableOf({ [TABLE_IDS.fighter]: fighterInput("fighter-a") });
    const definition = table.definition(TABLE_IDS.fighter);
    const actor = table.actor(TABLE_IDS.fighter);
    const sheet = deriveActorSheet(actor, definition, deriveEquipment(actor, definition, catalog), SKILLS, catalog);
    expect(sheet.skills.find((row) => row.id === "stealth")).toMatchObject({
      // Dex 13 (+1) and Stealth proficiency (+3).
      bonus: 4,
      mode: { mode: "disadvantage", advantage: [], disadvantage: ["Chain Mail (Stealth)"] }
    });
  });

  it("gives Passive Perception as 10 plus Perception, 5 more or less for Advantage or Disadvantage", () => {
    const definition = sheetOf();
    expect(sheetFor(tableWith(), PIP, definition).passivePerception).toBe(15);
    expect(sheetFor(tableWith({ conditions: [{ id: "poisoned" }] }), PIP, definition).passivePerception).toBe(10);
    // Exhaustion reduces a roll, and a passive score rolls nothing.
    expect(
      sheetFor(tableWith({ conditions: [{ id: "exhaustion", level: 2 }] }), PIP, definition).passivePerception
    ).toBe(15);
  });
});

describe("Hunter's Mark finds its quarry", () => {
  it("gives Advantage on Wisdom (Perception or Survival) checks to find the marked creature only", () => {
    const definition = sheetOf();
    const state = tableWith();
    const goblin = actorOf(state, FOE);
    goblin.effects.push(
      makeEffect({
        id: "mark",
        name: "Hunter's Mark",
        duration: { type: "manual" },
        tags: ["hunters-mark"],
        sourceActorId: PIP,
        sourceName: "Pip"
      })
    );
    const pip = actorOf(state, PIP);
    const plan = (subject: CheckSubject, finding?: typeof goblin) =>
      checkPlan(pip, definition, deriveEquipment(pip, definition, catalog), subject, finding ? { finding } : {});
    expect(plan({ ability: "wis", skill: "perception" }, goblin).rollMode).toEqual({
      mode: "advantage",
      advantage: ["Hunter's Mark (finding Goblin Warrior)"],
      disadvantage: []
    });
    expect(plan({ ability: "wis", skill: "survival" }, goblin).rollMode.mode).toBe("advantage");
    expect(plan({ ability: "wis", skill: "perception" }).rollMode.mode).toBe("normal");
    expect(plan({ ability: "wis", skill: "insight" }, goblin).rollMode.mode).toBe("normal");
  });
});
