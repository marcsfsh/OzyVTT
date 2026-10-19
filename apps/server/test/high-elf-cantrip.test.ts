import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { rechoicesOf, rechooseInLedger } from "../src/ledger-rechoice.js";

// SRD 5.2.1 Elf, High Elf: "You know the Prestidigitation cantrip. Whenever you finish a Long Rest, you can replace it
// with a different cantrip from the Wizard spell list."

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d11";

/** A High Elf Soldier Fighter 1, its cantrip row left out as a sheet made before it was a pick. */
const highElf = (cantrip?: string): CharacterCreateRequestInput =>
  ({
    name: "Aelar",
    speciesId: "elf",
    backgroundId: "soldier",
    classId: "fighter",
    level: 1,
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "skill", id: "perception" },
      { level: 1, kind: "skill", id: "insight", payload: { featureId: "elf-keen-senses" } },
      { level: 1, kind: "lineage", id: "high-elf" },
      { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "elf-lineage" } },
      ...(cantrip ? [{ level: 1, kind: "cantrip", id: cantrip, payload: { featureId: "high-elf-cantrip" } }] : []),
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

const build = (input: CharacterCreateRequestInput) => buildCharacterDefinition(input, library, policy);
const cantripsOf = (definition: ActorDefinition) =>
  (definition.spellcasting?.spells ?? []).filter((spell) => spell.level === 0).map((spell) => spell.id);

describe("the High Elf's Arcane Cantrip", () => {
  it("is Prestidigitation when the ledger names none, and the ledger then records it", () => {
    const sheet = build(highElf());
    expect(cantripsOf(sheet)).toEqual(["prestidigitation"]);
    expect(sheet.character?.choices).toContainEqual(
      expect.objectContaining({ kind: "cantrip", id: "prestidigitation", payload: { featureId: "high-elf-cantrip" } })
    );
    expect(cantripsOf(build(highElf("fire-bolt")))).toEqual(["fire-bolt"]);
  });

  it("is swapped for another Wizard cantrip in the step a Long Rest opens, and the sheet is rebuilt", () => {
    const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
    // A sheet stored before the cantrip was a pick: no row for it in the ledger.
    const stored = build(highElf());
    const legacy = {
      ...stored,
      character: {
        ...stored.character!,
        choices: stored.character!.choices!.filter((row) => row.payload?.featureId !== "high-elf-cantrip")
      }
    };
    importActorDefinition(state, legacy, HERO, "public", catalog);
    const actor = state.actors[0]!;
    const sheet = () => state.definitions.find((entry) => entry.id === actor.definitionId)!.definition;
    const offer = rechoicesOf(actor, sheet(), library).find((entry) => entry.offer === "feature:high-elf-cantrip")!;
    expect(offer).toMatchObject({ per: "long-rest", label: "Arcane Cantrip" });
    expect(offer.options.map((option) => option.id)).toEqual(expect.arrayContaining(["fire-bolt", "prestidigitation"]));
    expect(offer.options.some((option) => option.id === "magic-missile")).toBe(false);
    rechooseInLedger(state, HERO, "feature:high-elf-cantrip", "fire-bolt", { library, policy, catalog });
    expect(cantripsOf(sheet())).toEqual(["fire-bolt"]);
    expect(sheet().actions.some((action) => action.id === "spell-fire-bolt")).toBe(true);
  });
});
