import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { rechoicesOf, rechooseInLedger } from "../src/ledger-rechoice.js";
import { spellbookPickRefusal } from "../src/spellbook.js";
import { asiRows } from "./asi-rows.js";

// SRD 5.2.1 Wizard, Spell Mastery: "Choose a level 1 and a level 2 spell in your spellbook that have a casting time of
// an action ... Whenever you finish a Long Rest, you can replace one of those spells with an eligible spell of the same
// level from your spellbook." Signature Spells: "Choose two level 3 spells in your spellbook".

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";

type Row = CharacterCreateRequestInput["choices"][number];
const classSpell = (id: string, level = 1): Row => ({ level, classId: "wizard", kind: "spell", id }) as Row;
const pick = (featureId: string, level: number, id: string): Row =>
  ({ level, kind: "spell", id, payload: { featureId } }) as Row;

/** A Human Acolyte Evoker of 18 or 20, its prepared Wizard spells the ones named. */
function wizard(level: 18 | 20, book: readonly string[], picks: readonly Row[]): CharacterCreateRequestInput {
  return {
    name: "Ansel",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "wizard",
    level,
    subclassId: "evoker",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "int", amount: 2 },
      { ability: "wis", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "wizard", kind: "skill", id: "arcana" },
      { level: 1, classId: "wizard", kind: "skill", id: "investigation" },
      { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
      { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
      { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
      pick("evocation-savant", 3, "burning-hands"),
      pick("evocation-savant", 3, "shatter"),
      ...(asiRows("wizard", [4, 8, 12, 16], ["int", "con"], { int: 17, con: 13 }) as Row[]),
      ...book.map((id) => classSpell(id)),
      ...(level === 20
        ? ([
            { level: 19, classId: "wizard", kind: "feat", id: "boon-of-fate", payload: { featureId: "epic-boon" } },
            { level: 19, kind: "ability-score", id: "int", payload: { featureId: "boon-of-fate" } }
          ] as Row[])
        : []),
      ...picks,
      { level: 1, kind: "equipment", id: "wizard-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" }
    ] as CharacterCreateRequestInput["choices"]
  };
}

const BOOK = ["magic-missile", "sleep", "acid-arrow", "misty-step", "shield", "fireball", "counterspell"];
const mastery = (one: string, two: string) => [pick("spell-mastery", 18, one), pick("spell-mastery", 18, two)];
const build = (input: CharacterCreateRequestInput) => buildCharacterDefinition(input, library, policy);
const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal, got none");
};

describe("Spell Mastery's picks", () => {
  it("take a spell with a casting time of an action, and refuse Shield or Misty Step", () => {
    expect(refusal(() => build(wizard(18, BOOK, mastery("shield", "acid-arrow"))))).toMatch(/shield/i);
    expect(refusal(() => build(wizard(18, BOOK, mastery("magic-missile", "misty-step"))))).toMatch(/misty-step/i);
    const built = build(wizard(18, BOOK, mastery("magic-missile", "acid-arrow")));
    expect(built.actions.some((action) => action.id === "spell-magic-missile-free")).toBe(true);
    expect(built.actions.some((action) => action.id === "spell-shield-free")).toBe(false);
  });

  it("take a spell from the spellbook, and refuse one the book doesn't hold", () => {
    const inBook = build(wizard(18, BOOK, mastery("magic-missile", "acid-arrow")));
    expect(spellbookPickRefusal(null, inBook, library)).toBeNull();
    const outside = build(wizard(18, BOOK, mastery("thunderwave", "acid-arrow")));
    expect(spellbookPickRefusal(null, outside, library)).toMatch(
      /Thunderwave isn't in Ansel's spellbook, and Spell Mastery takes a spell from the spellbook/
    );
    // A spell the character's book holds beyond the sheet counts.
    expect(spellbookPickRefusal({ spellbook: [{ id: "thunderwave" }] }, outside, library)).toBeNull();
  });

  it("swap one of the two for another action spell of the book in the step a Long Rest opens", () => {
    const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(
      state,
      build(wizard(18, BOOK, mastery("magic-missile", "acid-arrow"))),
      HERO,
      "public",
      catalog
    );
    const actor = state.actors[0]!;
    const sheet = () =>
      state.definitions.find((entry) => entry.id === actor.definitionId)!.definition as ActorDefinition;
    const offer = rechoicesOf(actor, sheet(), library).find((entry) => entry.offer === "feature:spell-mastery")!;
    expect(offer).toMatchObject({ per: "long-rest", held: ["magic-missile", "acid-arrow"], swaps: 1 });
    // The book's level 1 and 2 spells cast as an action, Evocation Savant's among them; Shield, Misty Step and spells
    // beyond the book aren't offered.
    expect(offer.options.map((option) => option.id).sort()).toEqual([
      "acid-arrow",
      "burning-hands",
      "magic-missile",
      "shatter",
      "sleep"
    ]);
    rechooseInLedger(state, HERO, "feature:spell-mastery", "sleep", { library, policy, catalog }, "magic-missile");
    expect(sheet().actions.some((action) => action.id === "spell-sleep-free")).toBe(true);
    expect(sheet().actions.some((action) => action.id === "spell-magic-missile-free")).toBe(false);
    // The same level only: a level 2 spell can't take the level 1 pick's place.
    expect(() =>
      rechooseInLedger(state, HERO, "feature:spell-mastery", "acid-arrow", { library, policy, catalog }, "sleep")
    ).toThrow();
  });
});

describe("Signature Spells' picks", () => {
  it("take two level 3 spells from the spellbook, and refuse one the book doesn't hold", () => {
    const signatures = [pick("signature-spells", 20, "fireball"), pick("signature-spells", 20, "lightning-bolt")];
    const built = build(wizard(20, BOOK, [...mastery("magic-missile", "acid-arrow"), ...signatures]));
    expect(spellbookPickRefusal(null, built, library)).toMatch(/Lightning Bolt isn't in Ansel's spellbook/);
    const booked = build(
      wizard(20, BOOK, [
        ...mastery("magic-missile", "acid-arrow"),
        pick("signature-spells", 20, "fireball"),
        pick("signature-spells", 20, "counterspell")
      ])
    );
    expect(spellbookPickRefusal(null, booked, library)).toBeNull();
    expect(booked.actions.find((action) => action.id === "spell-counterspell-free")?.uses).toMatchObject({
      limit: 1,
      per: "short-rest",
      pool: "signature-spells-counterspell"
    });
  });
});
