import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { actionPools, effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyRest, shortRestRegains } from "../src/rests.js";

// SRD 5.2.1 classes.md: Rage, Second Wind, Channel Divinity (Cleric and Paladin) and Wild Shape each "regain one
// expended use when you finish a Short Rest, and ... all expended uses when you finish a Long Rest"; Font of
// Inspiration (Bard 5) gives every Bardic Inspiration back on a Short Rest. feats.md: Boon of Fate can't be used
// again "until you roll Initiative or finish a Short or Long Rest".

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const ACTOR_ID = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e4b";

/** A seeded stand-in for the dice (mulberry32), so each class builds the same character every run. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

const generated = (classId: string, level: number): ActorDefinition =>
  buildCharacterDefinition(
    generateCharacterRequest({ classId, level }, library, policy, seeded(1)).request,
    library,
    policy
  );

/** The character on a table with every use of `poolId` spent. */
function spentOut(definition: ActorDefinition, poolId: string) {
  const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, ACTOR_ID, "public", catalog);
  const actor = () => state.actors.find((entry) => entry.id === ACTOR_ID)!;
  const resolve = (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;
  const stored = resolve(actor().definitionId!)!;
  const pool = actionPools(effectiveActions(stored, actor(), catalog)).find((entry) => entry.id === poolId);
  if (!pool) throw new Error(`${definition.name} has no ${poolId} pool`);
  actor().actionUses = { ...actor().actionUses, [poolId]: pool.limit };
  return {
    limit: pool.limit,
    spent: () => actor().actionUses[poolId] ?? 0,
    rest: (kind: "short" | "long") => applyRest(state, ACTOR_ID, kind, resolve, catalog),
    regains: () => shortRestRegains(deriveEquipment(actor(), stored, catalog))
  };
}

describe("a Short Rest gives back one use of a feature that says so", () => {
  const cases: ReadonlyArray<readonly [string, number, string]> = [
    ["barbarian", 5, "rage"],
    ["fighter", 5, "second-wind"],
    ["cleric", 6, "channel-divinity"],
    ["paladin", 5, "channel-divinity"],
    ["druid", 6, "wild-shape"]
  ];
  for (const [classId, level, poolId] of cases) {
    it(`${classId} ${level}: ${poolId} comes back one use at a time, then in full on a Long Rest`, () => {
      const table = spentOut(generated(classId, level), poolId);
      expect(table.limit).toBeGreaterThan(1);
      table.rest("short");
      expect(table.spent()).toBe(table.limit - 1);
      table.rest("short");
      expect(table.spent()).toBe(table.limit - 2);
      table.rest("long");
      expect(table.spent()).toBe(0);
    });
  }

  it("does not touch a long-rest pool no feature refills, nor push a pool below empty", () => {
    const fighter = spentOut(generated("fighter", 5), "second-wind");
    fighter.rest("short");
    fighter.rest("short");
    fighter.rest("short");
    fighter.rest("short");
    expect(fighter.spent()).toBe(0);
    // Action Surge was always a Short Rest pool and still comes back whole.
    const surge = spentOut(generated("fighter", 5), "action-surge");
    surge.rest("short");
    expect(surge.spent()).toBe(0);
  });
});

describe("Bardic Inspiration comes back on a Short Rest only from Font of Inspiration", () => {
  it("stays spent for a Bard 4", () => {
    const bard = spentOut(generated("bard", 4), "bardic-inspiration");
    expect(bard.regains().has("bardic-inspiration")).toBe(false);
    bard.rest("short");
    expect(bard.spent()).toBe(bard.limit);
  });

  it("comes back in full for a Bard 5, Cutting Words' share included", () => {
    const bard = spentOut(generated("bard", 5), "bardic-inspiration");
    expect(bard.regains().get("bardic-inspiration")).toBe("all");
    bard.rest("short");
    expect(bard.spent()).toBe(0);
  });
});

describe("Boon of Fate", () => {
  type Row = CharacterChoice;
  /** feat-choices.test.ts's Dwarf Soldier Champion at 19, its Epic Boon Boon of Fate. */
  const champion: CharacterCreateRequestInput = {
    name: "Probe",
    speciesId: "dwarf",
    backgroundId: "soldier",
    classId: "fighter",
    level: 19,
    subclassId: "champion",
    abilityMethod: "roll",
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "elvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "skill", id: "perception" },
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      ...["greatsword", "flail", "longbow"].map((id) => ({ level: 1, classId: "fighter", kind: "weapon-mastery", id })),
      { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
      { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
      {
        level: 7,
        classId: "fighter",
        kind: "fighting-style",
        id: "great-weapon-fighting",
        payload: { featureId: "additional-fighting-style" }
      },
      { level: 10, classId: "fighter", kind: "weapon-mastery", id: "longsword" },
      { level: 16, classId: "fighter", kind: "weapon-mastery", id: "dagger" },
      ...[4, 6, 8, 12, 14, 16].map((level) => ({
        level,
        classId: "fighter",
        kind: "asi-or-feat",
        id: "asi",
        payload: {
          increases: [
            { ability: "wis", amount: 1 },
            { ability: "int", amount: 1 }
          ]
        }
      })),
      { level: 19, classId: "fighter", kind: "feat", id: "boon-of-fate", payload: { featureId: "epic-boon" } },
      { level: 19, kind: "ability-score", id: "str", payload: { featureId: "boon-of-fate" } },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ] as Row[]
  };

  it("is ready again after a Short Rest", () => {
    const table = spentOut(buildCharacterDefinition(champion, library, policy), "boon-of-fate");
    expect(table.spent()).toBe(1);
    table.rest("short");
    expect(table.spent()).toBe(0);
  });
});
