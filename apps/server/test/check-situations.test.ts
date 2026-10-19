import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ModifierSchema, type ActorDefinition } from "@vtt/schemas";
import { deriveActorSheet } from "../src/actor-derived.js";
import {
  answerRollCall,
  rerollAbilityCheck,
  rollAbilityCheck,
  startRollCall,
  type CheckRollDependencies,
  type CheckRollInput
} from "../src/check-rolls.js";
import { checkSituations } from "../src/check-situations.js";
import { projectPlayerRollCalls } from "../src/projections.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { catalog, library } from "./equipment-table.js";

// SRD gear that helps a check only in a situation the roller names (a Book's topic, prying with a Crowbar): the
// rider waits on `situation-is`, the sheet lists the situation, and only a roll that names it gets the rider.

const SAGE = "10000000-0000-4000-8000-0000000000d1";
const SESSION = "30000000-0000-4000-8000-0000000000d1";
const COMMAND = "50000000-0000-4000-8000-0000000000d1";
const SKILLS = library.skillSummaries();
const BOOK_TOPIC = "consulting an accurate Book about its topic";
const PRYING = "prying with the Crowbar";

/** Int 14 (+2), Str 12 (+1), PB 2, proficient in History (+4). */
const SAGE_SHEET = {
  name: "Sage",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 12, dex: 10, con: 10, int: 14, wis: 10, cha: 10 },
  hitPoints: { maximum: 20 },
  speedFeet: 30,
  actions: [],
  extensions: {},
  character: { classes: [{ id: "wizard", name: "Wizard", level: 3 }], feats: [] },
  proficiencies: { saves: [], skills: [{ id: "history", proficiency: "proficient" }] }
} as unknown as ActorDefinition;

const gear = (id: string, name: string, equipped = true) => ({
  id,
  name,
  quantity: 1,
  equipped,
  category: "adventuring-gear"
});

function tableWith(inventory: object[]): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: SAGE,
        name: "Sage",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "sage-def",
        ownerSessionId: SESSION,
        inventory
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
    now: () => "2026-10-19T00:00:00.000Z",
    resolveDefinition: (definitionId) => (definitionId === "sage-def" ? SAGE_SHEET : undefined),
    catalog,
    names: { skill: (skillId) => SKILLS.find((skill) => skill.id === skillId)?.name }
  };
}

const OWNER = { role: "player", sessionId: SESSION } as const;
const history = (over: Partial<CheckRollInput> = {}): CheckRollInput => ({
  commandId: COMMAND,
  actorId: SAGE,
  subject: { ability: "int", skill: "history" },
  dc: null,
  visibility: "public",
  ...over
});

const sheetOf = (state: GameState) => {
  const actor = state.actors[0]!;
  return deriveActorSheet(actor, SAGE_SHEET, deriveEquipment(actor, SAGE_SHEET, catalog), SKILLS);
};

describe("a situation the roller names", () => {
  it("adds a Book's +5 only to a check that names its topic, and says so in the roll's name", () => {
    const state = tableWith([gear("book", "Book")]);
    const plain = rollAbilityCheck(state, OWNER, history(), depsFor([10]));
    expect(plain.outcome).toMatchObject({ label: "Intelligence (History)", total: 14 });
    const consulted = rollAbilityCheck(state, OWNER, history({ situations: [BOOK_TOPIC] }), depsFor([10]));
    expect(consulted.outcome).toMatchObject({ label: `Intelligence (History), ${BOOK_TOPIC}`, total: 19 });
    // Its skills are the four the Book names: Athletics gains nothing from it.
    const athletics = rollAbilityCheck(
      state,
      OWNER,
      history({ subject: { ability: "str", skill: "athletics" }, situations: [BOOK_TOPIC] }),
      depsFor([10])
    );
    expect(athletics.outcome).toMatchObject({ label: "Strength (Athletics)", total: 11 });
  });

  it("gives a Crowbar's Advantage to a Strength check that names prying with it, and keeps it through a reroll", () => {
    const state = tableWith([gear("crowbar", "Crowbar")]);
    const forced = rollAbilityCheck(
      state,
      OWNER,
      history({ subject: { ability: "str" }, situations: [PRYING] }),
      depsFor([3, 17])
    );
    expect(forced.outcome.rollMode?.mode).toBe("advantage");
    expect(forced.outcome.natural).toBe(17);
    expect(state.heldRolls.at(-1)?.check?.situations).toEqual([PRYING]);
    // The GM rerolls the check: prying still counts.
    const again = rerollAbilityCheck(state, { role: "gm" }, { commandId: COMMAND, actorId: SAGE }, depsFor([2, 15]));
    expect(again.outcome.rollMode?.mode).toBe("advantage");
    // A Dexterity check is not the Strength check the Crowbar helps.
    const dexterity = rollAbilityCheck(
      state,
      OWNER,
      history({ subject: { ability: "dex" }, situations: [PRYING] }),
      depsFor([3])
    );
    expect(dexterity.outcome.rollMode).toBeUndefined();
  });

  it("lists each situation on the sheet while its item is equipped, with what it gives and the checks it fits", () => {
    const equipped = sheetOf(tableWith([gear("book", "Book"), gear("crowbar", "Crowbar")]));
    expect(equipped.situations).toEqual([
      {
        situation: BOOK_TOPIC,
        source: "Book",
        effect: "+5",
        abilities: ["int"],
        skills: ["arcana", "history", "nature", "religion"]
      },
      { situation: PRYING, source: "Crowbar", effect: "Advantage", abilities: ["str"], skills: [] }
    ]);
    // A Book left in the pack offers nothing, and naming its topic adds nothing.
    const packed = tableWith([gear("book", "Book", false)]);
    expect(sheetOf(packed).situations).toEqual([]);
    expect(rollAbilityCheck(packed, OWNER, history({ situations: [BOOK_TOPIC] }), depsFor([10])).outcome.total).toBe(
      14
    );
  });

  it("is refused on a rider that doesn't wait for an ability check", () => {
    const saving = ModifierSchema.safeParse({
      type: "save-bonus",
      amount: 1,
      when: [{ type: "on-saving-throw" }, { type: "situation-is", situation: "reading the stars" }]
    });
    expect(saving.success).toBe(false);
    expect(saving.error?.issues.map((issue) => issue.message)).toContain(
      "A situation the roller names fits only an ability check. Make the rider apply on an ability check."
    );
    expect(
      ModifierSchema.safeParse({
        type: "check-bonus",
        amount: 2,
        when: [{ type: "on-ability-check" }, { type: "situation-is", situation: "reading the stars" }]
      }).success
    ).toBe(true);
  });
});

describe("a call for a check offers the situations that fit it", () => {
  const call = (state: GameState, subject: CheckRollInput["subject"]) =>
    startRollCall(
      state,
      { id: COMMAND, kind: "check", subject, dc: 15, actorIds: [SAGE], blind: false },
      {
        newId: () => "40000000-0000-4000-8000-0000000000e1",
        now: () => 0,
        situationsOf: () => checkSituations(deriveEquipment(state.actors[0]!, SAGE_SHEET, catalog))
      }
    );
  const offered = (state: GameState) => state.rollCalls[0]!.entries[0]!.situations?.map((one) => one.situation);

  it("lists a Book's topic on an Intelligence (History) call, and prying on a Strength one", () => {
    const history = tableWith([gear("book", "Book"), gear("crowbar", "Crowbar")]);
    call(history, { ability: "int", skill: "history" });
    expect(offered(history)).toEqual([BOOK_TOPIC]);
    const strength = tableWith([gear("book", "Book"), gear("crowbar", "Crowbar")]);
    call(strength, { ability: "str" });
    expect(offered(strength)).toEqual([PRYING]);
  });

  it("rolls the answer with the situations picked from those offered, and only those", () => {
    const state = tableWith([gear("book", "Book")]);
    call(state, { ability: "int", skill: "history" });
    const answered = answerRollCall(
      state,
      { role: "gm" },
      { commandId: COMMAND, callId: COMMAND, actorId: SAGE, situations: [BOOK_TOPIC, PRYING] },
      depsFor([10])
    );
    // d20 10 + 4 + the Book's 5.
    expect(answered.outcome.total).toBe(19);
  });

  it("reaches the character's own player on the call's card", () => {
    const state = tableWith([gear("book", "Book")]);
    call(state, { ability: "int", skill: "history" });
    expect(projectPlayerRollCalls(state, SESSION)[0]!.entries[0]!.situations).toEqual([
      expect.objectContaining({ situation: BOOK_TOPIC, effect: "+5" })
    ]);
  });
});
