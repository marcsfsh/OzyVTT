import { describe, expect, it } from "vitest";
import type { BuilderOffer, BuilderPolicy, ContentClassSummary } from "@vtt/domain";
import type { BuilderCatalogs } from "../content/catalogs";
import {
  buildCreatePayload,
  classSequenceOf,
  draftClassesOf,
  emptyDraft,
  offersRequestOf,
  stepBlockedReason,
  withClassAdded,
  withClassLevels,
  withoutClass,
  withStartingClass,
  type BuilderDraft
} from "./build-payload";

// A multiclass draft names the class each level went to. These hold the sequence edits the class step makes, what
// the draft sends the table, and the ability step's checks that read each level's own class.

const classSummary = (
  id: string,
  name: string,
  hitDie: string,
  multiclassPrerequisites: ContentClassSummary["multiclassPrerequisites"]
) => ({ id, name, hitDie, multiclassPrerequisites, subclassLevel: 3, subclassLabel: `${name} Subclass` });

const fighter = classSummary("fighter", "Fighter", "d10", {
  mode: "any",
  minimums: [
    { ability: "str", minimum: 13 },
    { ability: "dex", minimum: 13 }
  ]
});
const wizard = classSummary("wizard", "Wizard", "d6", { mode: "all", minimums: [{ ability: "int", minimum: 13 }] });

const catalogs = {
  choice: { classes: [fighter, wizard], species: [], subclasses: [], feats: [] },
  backgrounds: []
} as unknown as BuilderCatalogs;

const policy = {
  allowedAbilityMethods: ["standard-array"],
  customFormula: null,
  maxLevel: 20,
  playerBuilder: "open",
  typedRolls: "open",
  hitPointRollFloor: "none"
} as unknown as BuilderPolicy;

const fighterAt = (level: number): BuilderDraft => ({ ...emptyDraft(), classId: "fighter", level });

describe("a multiclass draft's classes", () => {
  it("adds a class's levels after the ones already taken, and takes them back from its last", () => {
    const threeAndTwo = withClassLevels(withClassAdded(fighterAt(3), "wizard"), "wizard", 2);
    expect(classSequenceOf(threeAndTwo)).toEqual(["fighter", "fighter", "fighter", "wizard", "wizard"]);
    expect(threeAndTwo.level).toBe(5);
    expect(draftClassesOf(threeAndTwo)).toEqual([
      { id: "fighter", levels: 3 },
      { id: "wizard", levels: 2 }
    ]);
    // Another Fighter level goes on the end; taking it back removes the last Fighter level, not the first.
    const fourth = withClassLevels(threeAndTwo, "fighter", 4);
    expect(classSequenceOf(fourth)).toEqual(["fighter", "fighter", "fighter", "wizard", "wizard", "fighter"]);
    expect(classSequenceOf(withClassLevels(fourth, "fighter", 3))).toEqual(classSequenceOf(threeAndTwo));
  });

  it("keeps the hit-point rolls of the levels before the first one that changed", () => {
    const rolled = { ...withClassLevels(withClassAdded(fighterAt(3), "wizard"), "wizard", 2), hpEntries: [9, 4, 6, 2] };
    // Dropping the Wizard leaves levels 1-3: their rolls (levels 2 and 3) stay.
    const fighterOnly = withoutClass(rolled, "wizard");
    expect(classSequenceOf(fighterOnly)).toEqual(["fighter", "fighter", "fighter"]);
    expect(fighterOnly.classLevels).toBeUndefined();
    expect(fighterOnly.hpEntries).toEqual([9, 4]);
    // The starting class is never removed this way.
    expect(withoutClass(rolled, "fighter")).toBe(rolled);
  });

  it("hands the starting class's levels to a new starting class", () => {
    const draft = withClassLevels(withClassAdded(fighterAt(2), "wizard"), "wizard", 2);
    const changed = withStartingClass(draft, "cleric");
    expect(classSequenceOf(changed)).toEqual(["cleric", "cleric", "wizard", "wizard"]);
    // One class: a plain swap, as before.
    expect(withStartingClass(fighterAt(4), "wizard")).toMatchObject({ classId: "wizard", level: 4 });
  });

  it("sends the class order to the table and in the create, and nothing extra for one class", () => {
    const draft = withClassAdded(fighterAt(3), "wizard");
    expect(offersRequestOf(draft).classLevels).toEqual(["fighter", "fighter", "fighter", "wizard"]);
    expect(offersRequestOf(fighterAt(3))).not.toHaveProperty("classLevels");
    const payload = buildCreatePayload(
      {
        ...draft,
        speciesId: "human",
        backgroundId: "soldier",
        abilityMethod: "point-buy",
        spendScores: { str: 15, dex: 10, con: 14, int: 13, wis: 10, cha: 8 }
      },
      []
    );
    expect(payload.classLevels).toEqual(["fighter", "fighter", "fighter", "wizard"]);
  });
});

describe("the ability step for a multiclass draft", () => {
  const scored = (draft: BuilderDraft, scores: Record<string, number>): BuilderDraft => ({
    ...draft,
    abilityMethod: "point-buy",
    spendScores: scores
  });
  const pointBuyPolicy = { ...policy, allowedAbilityMethods: ["point-buy"] } as unknown as BuilderPolicy;

  it("checks each typed hit-point roll against its own level's die", () => {
    const draft = scored(withClassAdded(fighterAt(2), "wizard"), {
      str: 15,
      dex: 10,
      con: 14,
      int: 13,
      wis: 10,
      cha: 8
    });
    const reason = (hpEntries: number[]) =>
      stepBlockedReason("abilities", { ...draft, hpMode: "entries", hpEntries }, catalogs, [], pointBuyPolicy);
    // Level 2 is a Fighter level (d10), level 3 the Wizard's first (d6).
    expect(reason([10, 6])).toBeNull();
    expect(reason([10, 7])).toBe("A d6 roll is 1-6 - fix the level 3 entry.");
  });

  it("says which class's multiclass minimum the scores miss, as the table does", () => {
    const draft = withClassAdded(fighterAt(2), "wizard");
    const reason = (scores: Record<string, number>) =>
      stepBlockedReason(
        "abilities",
        scored(draft, { str: 15, dex: 10, con: 14, int: 13, wis: 10, cha: 8, ...scores }),
        catalogs,
        [],
        pointBuyPolicy
      );
    expect(reason({ int: 12 })).toBe("To take Wizard at level 3: Wizard needs Intelligence 13; you have 12.");
    expect(reason({})).toBeNull();
    // The class already taken needs its own 13 too.
    expect(reason({ str: 12, dex: 12 })).toBe(
      "To take Wizard at level 3: Your Fighter needs Strength 13 or Dexterity 13; you have Strength 12 and Dexterity 12."
    );
  });

  it("checks a class with the scores of the level it is taken at, so a later improvement doesn't count", () => {
    // An Ability Score Improvement at level 4 raises Intelligence 12 to 14.
    const improvement: BuilderOffer = {
      key: "feature:ability-score-improvement@4",
      step: "features",
      featureId: "ability-score-improvement",
      kind: "asi-or-feat",
      label: "Ability Score Improvement",
      help: null,
      capacity: 1,
      options: [{ id: "asi", name: "Ability Score Improvement" }],
      maxSpellLevel: null,
      maximum: null,
      level: 4,
      classId: "fighter",
      unresolvable: null,
      unavailable: null
    };
    const reason = (draft: BuilderDraft) =>
      stepBlockedReason(
        "abilities",
        {
          ...scored(draft, { str: 15, dex: 10, con: 14, int: 12, wis: 10, cha: 8 }),
          picks: { [improvement.key]: ["asi"] },
          asiIncreases: { [improvement.key]: [{ ability: "int", amount: 2 }] }
        },
        catalogs,
        [improvement],
        pointBuyPolicy
      );
    // The Wizard at level 2 comes before the improvement, so Intelligence is still 12.
    expect(reason(withClassLevels(withClassAdded(fighterAt(1), "wizard"), "fighter", 4))).toBe(
      "To take Wizard at level 2: Wizard needs Intelligence 13; you have 12."
    );
    // At level 5 it comes after: Intelligence 14.
    expect(reason(withClassAdded(fighterAt(4), "wizard"))).toBeNull();
  });
});

describe("a pick the step still waits on", () => {
  const mastery: BuilderOffer = {
    key: "feature:weapon-mastery@4",
    step: "features",
    featureId: "weapon-mastery",
    kind: "weapon-mastery",
    label: "Weapon Mastery",
    help: null,
    capacity: 4,
    options: ["club", "dagger", "flail", "glaive", "greataxe"].map((id) => ({ id, name: id })),
    maxSpellLevel: null,
    maximum: null,
    level: 4,
    classId: "fighter",
    unresolvable: null,
    unavailable: null
  } as unknown as BuilderOffer;
  const reason = (picked: string[]) =>
    stepBlockedReason(
      "features",
      { ...fighterAt(4), subclassId: "champion", picks: { [mastery.key]: picked } },
      catalogs,
      [mastery],
      policy
    );

  it("counts what is left in sentences of their own", () => {
    expect(reason([])).toBe("Choose 4 for Weapon Mastery to continue.");
    expect(reason(["club", "dagger", "flail"])).toBe(
      "Choose 1 more for Weapon Mastery to continue. 3 of 4 are chosen."
    );
    expect(reason(["club", "dagger", "flail", "glaive"])).toBeNull();
  });
});
