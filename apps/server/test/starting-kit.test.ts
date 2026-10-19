import { describe, expect, it } from "vitest";
import { BuilderPolicySchema } from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { builderOffers } from "../src/builder-offers.js";
import { ContentLibrary } from "../src/content-library.js";

// SRD 5.2.1 core traits. Bard: "Tool Proficiencies: Choose 3 Musical Instruments", and its kit's "Musical Instrument of
// your choice". Monk: "Choose one type of Artisan's Tools or Musical Instrument", and its kit's "Artisan's Tools or
// Musical Instrument chosen for the tool proficiency above". The Ranger's and Rogue's "20 Arrows" are one bundle.

const library = new ContentLibrary().forAudience("play");
const policy = BuilderPolicySchema.parse({});

const tool = (classId: string, id: string): CharacterChoice => ({ level: 1, classId, kind: "tool", id });

function first(
  classId: string,
  skills: readonly string[],
  extra: readonly CharacterChoice[],
  kit: string
): CharacterCreateRequestInput {
  return {
    name: "Wren",
    speciesId: "human",
    backgroundId: "acolyte",
    classId,
    level: 1,
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 15, con: 13, int: 10, wis: 14, cha: 12 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "cha", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
      ...skills.map((id) => ({ level: 1, classId, kind: "skill", id })),
      ...extra,
      { level: 1, kind: "equipment", id: kit },
      { level: 1, kind: "equipment", id: "acolyte-b" }
    ]
  };
}

const bardSpells: CharacterChoice[] = [
  { level: 1, classId: "bard", kind: "cantrip", id: "vicious-mockery" },
  { level: 1, classId: "bard", kind: "cantrip", id: "mage-hand" },
  ...["charm-person", "healing-word", "thunderwave", "dissonant-whispers"].map((id) => ({
    level: 1,
    classId: "bard",
    kind: "spell",
    id
  }))
];
const bard = (instruments: readonly string[], kit = "bard-a") =>
  first(
    "bard",
    ["performance", "persuasion", "deception"],
    [...instruments.map((id) => tool("bard", id)), ...bardSpells],
    kit
  );
const monk = (choice: string) => first("monk", ["acrobatics", "athletics"], [tool("monk", choice)], "monk-a");

describe("the Bard's and the Monk's tool proficiencies", () => {
  it("gives a Bard the three instruments chosen and refuses two or four", () => {
    const sheet = buildCharacterDefinition(
      bard(["instrument-flute", "instrument-drum", "instrument-lyre"]),
      library,
      policy
    );
    expect(sheet.proficiencies?.tools).toEqual(
      expect.arrayContaining(["instrument-flute", "instrument-drum", "instrument-lyre"])
    );
    expect(() => buildCharacterDefinition(bard(["instrument-flute", "instrument-drum"]), library, policy)).toThrow(
      /Bard tools/
    );
    expect(() =>
      buildCharacterDefinition(
        bard(["instrument-flute", "instrument-drum", "instrument-lyre", "instrument-horn"]),
        library,
        policy
      )
    ).toThrow();
  });

  it("gives a Monk one Artisan's Tools or Musical Instrument, and refuses another kind of tool", () => {
    expect(buildCharacterDefinition(monk("smiths-tools"), library, policy).proficiencies?.tools).toContain(
      "smiths-tools"
    );
    expect(buildCharacterDefinition(monk("instrument-viol"), library, policy).proficiencies?.tools).toContain(
      "instrument-viol"
    );
    expect(() => buildCharacterDefinition(monk("thieves-tools"), library, policy)).toThrow();
  });
});

describe("the starting kits", () => {
  const carried = (input: CharacterCreateRequestInput) =>
    (buildCharacterDefinition(input, library, policy).startingInventory ?? []).map((item) => [item.id, item.quantity]);

  it("puts a chosen instrument in the Bard's kit", () => {
    expect(carried(bard(["instrument-flute", "instrument-drum", "instrument-lyre"]))).toContainEqual([
      "instrument-flute",
      1
    ]);
    expect(carried(bard(["instrument-flute", "instrument-drum", "instrument-lyre"]))).not.toContainEqual([
      "instrument-lute",
      1
    ]);
  });

  it("puts the instrument picked for the kit in the Bard's kit, any instrument at all", () => {
    const kitPick = (id: string): CharacterChoice => ({ level: 1, classId: "bard", kind: "kit-item", id });
    const proficient = ["instrument-drum", "instrument-flute", "instrument-viol"];
    const picked = (id: string) => ({ ...bard(proficient), choices: [...bard(proficient).choices, kitPick(id)] });
    expect(carried(picked("instrument-flute"))).toContainEqual(["instrument-flute", 1]);
    expect(carried(picked("instrument-flute"))).not.toContainEqual(["instrument-drum", 1]);
    // "Musical Instrument of your choice" names no proficiency, so one outside the three is taken too.
    expect(carried(picked("instrument-horn"))).toContainEqual(["instrument-horn", 1]);
    expect(() => buildCharacterDefinition(picked("dagger"), library, policy)).toThrow(/isn't an item/);
  });

  it("offers the kit's instrument as its own pick in the builder once the kit is chosen", () => {
    const draft = (kit: string) =>
      builderOffers(
        {
          speciesId: "human",
          backgroundId: "acolyte",
          classId: "bard",
          level: 1,
          picks: { "class-equipment": [kit] }
        },
        library
      ).offers.find((offer) => offer.key === "class-equipment-item");
    expect(draft("bard-a")).toMatchObject({ kind: "kit-item", step: "equipment", capacity: 1 });
    expect(draft("bard-a")!.options.map((option) => option.id)).toEqual(
      expect.arrayContaining(["instrument-lute", "instrument-horn", "instrument-viol"])
    );
    expect(draft("bard-b")).toBeUndefined();
  });

  it("reads the kit's instrument back from a stored ledger, so a level up keeps it", () => {
    const proficient = ["instrument-drum", "instrument-flute", "instrument-viol"];
    const kitPick: CharacterChoice = { level: 1, classId: "bard", kind: "kit-item", id: "instrument-horn" };
    const reply = builderOffers(
      {
        speciesId: "human",
        backgroundId: "acolyte",
        classId: "bard",
        level: 2,
        // As the builder records them: the class's kit under the class.
        choices: [
          ...bard(proficient).choices.map((row) => (row.id === "bard-a" ? { ...row, classId: "bard" } : row)),
          kitPick
        ]
      },
      library
    );
    expect(reply.picks["class-equipment-item"]).toEqual(["instrument-horn"]);
  });

  it("puts the Monk's chosen tool in its kit", () => {
    expect(carried(monk("smiths-tools"))).toContainEqual(["smiths-tools", 1]);
  });

  it("gives the gold option its gold and no items", () => {
    const sheet = buildCharacterDefinition(
      bard(["instrument-flute", "instrument-drum", "instrument-lyre"], "bard-b"),
      library,
      policy
    );
    expect(sheet.startingCurrency?.gp).toBe(90 + 50);
    expect(sheet.startingInventory).toEqual([]);
  });

  it("packs the Ranger's and the Rogue's 20 Arrows as one bundle of 20", () => {
    for (const classId of ["ranger", "rogue"]) {
      const kit = library.classRecord(classId)!.startingEquipment.find((option) => option.id === `${classId}-a`)!;
      expect(kit.items.find((item) => item.id === "arrows-20")?.quantity).toBe(1);
    }
  });
});
