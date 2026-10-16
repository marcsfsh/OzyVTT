import { describe, expect, it } from "vitest";
import { BuilderPolicySchema } from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import { builderOffers } from "../src/builder-offers.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";

// Feat slots and prerequisites (SRD 5.2.1 classes.md, Ability Score Improvement and Epic Boon; feats.md):
// "the Ability Score Improvement feat or another feat of your choice for which you qualify", any category,
// and "to take a feat, you must meet any prerequisite in its description".

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
type Row = CharacterChoice;

/** A Dwarf Soldier Fighter (STR 15+2, DEX 13 by default); `rows` carries the ASIs and Epic Boon under test. */
function fighter(
  level: number,
  rows: readonly Row[],
  scores: Partial<CharacterCreateRequestInput["baseScores"]> = {}
): CharacterCreateRequestInput {
  return {
    name: "Probe",
    speciesId: "dwarf",
    backgroundId: "soldier",
    classId: "fighter",
    level,
    ...(level >= 3 ? { subclassId: "champion" } : {}),
    abilityMethod: "roll",
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10, ...scores },
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
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
      ...(level >= 3 ? [{ level: 3, classId: "fighter", kind: "subclass", id: "champion" }] : []),
      ...(level >= 4 ? [{ level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" }] : []),
      ...(level >= 7
        ? [
            {
              level: 7,
              classId: "fighter",
              kind: "fighting-style",
              id: "great-weapon-fighting",
              payload: { featureId: "additional-fighting-style" }
            }
          ]
        : []),
      ...(level >= 10 ? [{ level: 10, classId: "fighter", kind: "weapon-mastery", id: "longsword" }] : []),
      ...(level >= 16 ? [{ level: 16, classId: "fighter", kind: "weapon-mastery", id: "dagger" }] : []),
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" },
      ...rows
    ] as Row[]
  };
}

const asi = (level: number, ability: string, amount = 2): Row => ({
  level,
  classId: "fighter",
  kind: "asi-or-feat",
  id: "asi",
  payload: { increases: [{ ability, amount }] }
});
const feat = (level: number, id: string, kind = "asi-or-feat", featureId?: string): Row => ({
  level,
  classId: "fighter",
  kind,
  id,
  ...(featureId ? { payload: { featureId } } : {})
});
const pick = (level: number, featureId: string, ability: string): Row => ({
  level,
  kind: "ability-score",
  id: ability,
  payload: { featureId }
});
/** The improvements a Fighter 19 owes besides the Epic Boon (4, 6, 8, 12, 14, 16), each +1 WIS and +1 INT. */
const otherAsis = (): Row[] =>
  [4, 6, 8, 12, 14, 16].map((level) => ({
    ...asi(level, "wis"),
    payload: {
      increases: [
        { ability: "wis", amount: 1 },
        { ability: "int", amount: 1 }
      ]
    }
  }));

const build = (input: CharacterCreateRequestInput) => buildCharacterDefinition(input, library, policy);
const featIds = (input: CharacterCreateRequestInput) => (build(input).character?.feats ?? []).map((entry) => entry.id);
const thrown = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};
const halfAsi = (level: number, ability: string): Row => ({
  ...asi(level, ability),
  payload: {
    increases: [
      { ability, amount: 1 },
      { ability: "con", amount: 1 }
    ]
  }
});

describe("an Ability Score Improvement may take a feat of any category", () => {
  it("takes Alert, an Origin feat, at level 4", () => {
    expect(featIds(fighter(4, [feat(4, "alert")]))).toEqual(["savage-attacker", "defense", "alert"]);
  });

  it("takes a second Fighting Style feat, because a Fighter has the Fighting Style feature", () => {
    expect(featIds(fighter(4, [feat(4, "archery")]))).toContain("archery");
  });

  it("refuses an Epic Boon before level 19", () => {
    const early = fighter(4, [feat(4, "boon-of-fate"), pick(4, "boon-of-fate", "str")]);
    expect(thrown(() => build(early))).toMatch(/Boon of Fate needs character level 19; this pick is at level 4/);
  });
});

describe("Alert adds the Proficiency Bonus to Initiative", () => {
  it("raises a Fighter 4's Initiative from DEX +1 to +3, and follows the bonus as it grows", () => {
    expect(build(fighter(4, [asi(4, "con")])).initiativeBonus).toBe(1);
    expect(build(fighter(4, [feat(4, "alert")])).initiativeBonus).toBe(1 + 2);
    expect(build(fighter(6, [feat(4, "alert"), asi(6, "con")])).initiativeBonus).toBe(1 + 3);
    expect(build(fighter(9, [feat(4, "alert"), asi(6, "con"), asi(8, "wis")])).initiativeBonus).toBe(1 + 4);
  });
});

describe("the Epic Boon slot takes an Epic Boon or any other feat the character qualifies for", () => {
  const level19 = (boon: readonly Row[]) => fighter(19, [...otherAsis(), ...boon]);

  it("takes the Ability Score Improvement feat instead of a boon", () => {
    const built = build(
      level19([
        feat(19, "ability-score-improvement", "feat", "epic-boon"),
        pick(19, "ability-score-improvement", "dex"),
        pick(19, "ability-score-improvement", "dex")
      ])
    );
    expect(built.character?.feats.map((entry) => entry.id)).toContain("ability-score-improvement");
    expect(built.abilityScores.dex).toBe(15);
  });

  it("refuses Boon of Spell Recall to a character with no Spellcasting feature", () => {
    const recall = level19([
      feat(19, "boon-of-spell-recall", "feat", "epic-boon"),
      pick(19, "boon-of-spell-recall", "wis")
    ]);
    expect(thrown(() => build(recall))).toMatch(/Boon of Spell Recall needs the Spellcasting feature/);
  });
});

describe("prerequisites are checked at the slot that takes the feat", () => {
  it("refuses Grappler without Strength or Dexterity 13, and takes it with either", () => {
    const weak = fighter(4, [feat(4, "grappler"), pick(4, "grappler", "str")], { str: 8, dex: 9 });
    expect(thrown(() => build(weak))).toMatch(/Grappler needs STR 13 or DEX 13; at level 4 you have STR 10, DEX 9/);
    const nimble = fighter(4, [feat(4, "grappler"), pick(4, "grappler", "dex")], { str: 8, dex: 13 });
    expect(featIds(nimble)).toContain("grappler");
  });

  it("reads the scores before that level's increases, not the finished sheet's", () => {
    // DEX 12 reaches 13 only through Grappler's own +1, which comes after the check.
    const ownIncrease = fighter(4, [feat(4, "grappler"), pick(4, "grappler", "dex")], { str: 8, dex: 12 });
    expect(thrown(() => build(ownIncrease))).toMatch(/Grappler needs STR 13 or DEX 13/);
    // DEX 12 + 2 at level 4 qualifies Grappler at level 6.
    const later = fighter(6, [asi(4, "dex"), feat(6, "grappler"), pick(6, "grappler", "str")], { str: 8, dex: 12 });
    expect(featIds(later)).toContain("grappler");
  });

  it("refuses Archery to a class with no Fighting Style feature", () => {
    // A complete generated Wizard 4 whose level-4 improvement is swapped for Archery.
    const { request } = generateCharacterRequest({ classId: "wizard", level: 4 }, library, policy, () => 1);
    const asiRow = request.choices.find((row) => row.kind === "asi-or-feat")!;
    const wizard = {
      ...request,
      choices: [
        ...request.choices.filter((row) => row !== asiRow && row.payload?.featureId !== asiRow.id),
        { ...asiRow, id: "archery", payload: undefined }
      ]
    };
    expect(thrown(() => build(wizard))).toMatch(/Archery's prerequisite is not met: Fighting Style Feature/);
  });
});

describe("a feat's ability increase past its ceiling is refused, not lost", () => {
  it("refuses the ASI feat's second +1 into a STR already at 20", () => {
    // STR 15 + 2 = 17, +2 at level 4 = 19, then the level-6 ASI feat picks STR twice: 20, then 21.
    const over = fighter(6, [
      asi(4, "str"),
      feat(6, "ability-score-improvement"),
      pick(6, "ability-score-improvement", "str"),
      pick(6, "ability-score-improvement", "str")
    ]);
    expect(thrown(() => build(over))).toMatch(
      /STR would be 21; Ability Score Improvement cannot raise a score above 20/
    );
    const split = fighter(6, [halfAsi(4, "str"), asi(6, "str")]);
    expect(build(split).abilityScores.str).toBe(20);
  });
});

describe("the builder's offers follow the same prerequisites", () => {
  const optionIds = (key: string, request: Parameters<typeof builderOffers>[0]) =>
    builderOffers(request, library)
      .offers.find((offer) => offer.key === key)
      ?.options.map((option) => option.id) ?? [];

  it("lists every category at level 4 but no Epic Boon, and every feat at the Epic Boon", () => {
    const four = optionIds("feature:ability-score-improvement@4", {
      speciesId: "dwarf",
      backgroundId: "soldier",
      classId: "fighter",
      level: 4
    });
    expect(four).toEqual(expect.arrayContaining(["alert", "skilled", "grappler", "archery"]));
    expect(four.some((id) => id.startsWith("boon-of-"))).toBe(false);
    const boon = optionIds("feature:epic-boon", {
      speciesId: "dwarf",
      backgroundId: "soldier",
      classId: "fighter",
      level: 19
    });
    expect(boon).toEqual(expect.arrayContaining(["ability-score-improvement", "alert", "boon-of-fate"]));
  });

  it("greys a feat whose feature prerequisite the build lacks, saying why", () => {
    const reply = builderOffers({ speciesId: "human", backgroundId: "soldier", classId: "wizard", level: 4 }, library);
    const card = reply.offers.find((offer) => offer.key === "feature:ability-score-improvement@4")!;
    expect(card.unavailable?.archery).toMatch(/Archery's prerequisite is not met/);
    expect(card.unavailable?.alert).toBeUndefined();
  });
});
