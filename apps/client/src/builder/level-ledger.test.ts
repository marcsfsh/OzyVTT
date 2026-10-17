import { describe, expect, it } from "vitest";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import type { BuilderPolicy } from "@vtt/domain";
import type { BuilderCatalogs } from "../content/catalogs";
import {
  choicesAbove,
  classOrderUnknown,
  draftFromLedger,
  hpPlan,
  hpRollGap,
  hpRolls,
  identityOf,
  keptClasses,
  ledgerOf,
  methodFor,
  recordedAbilities,
  targetClassLevels
} from "./level-ledger";

/**
 * The level flow must never let a rebuild silently lose something. Hit points are the sharp case:
 * the server rebuilds on the average when a roll is missing.
 */

const definition = (over: Partial<ActorDefinition> = {}): ActorDefinition =>
  ({
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: "test", version: "1" },
    name: "Thora",
    size: "medium",
    abilityScores: { str: 17, dex: 14, con: 14, int: 12, wis: 10, cha: 8 },
    proficiencyBonus: 2,
    armorClass: 16,
    hitPoints: { maximum: 20 },
    initiativeBonus: 2,
    speedFeet: 30,
    actions: [],
    token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
    extensions: {},
    ...over
  }) as unknown as ActorDefinition;

const withCharacter = (choices: readonly CharacterChoice[] | undefined) =>
  definition({
    character: {
      classes: [{ id: "fighter", name: "Fighter", level: 3 }],
      race: { id: "dwarf", name: "Dwarf" },
      background: { id: "soldier", name: "Soldier" },
      feats: [],
      ...(choices ? { choices } : {})
    }
  } as unknown as Partial<ActorDefinition>);

describe("Reading a character back into the wizard", () => {
  it("tells a sheet with NO ledger apart from one that recorded zero decisions", () => {
    // Absent means "never built here" (a PDF import) and is refused; empty means the wizard ran and
    // asked nothing.
    expect(ledgerOf(withCharacter(undefined))).toBeNull();
    expect(ledgerOf(withCharacter([]))).toEqual([]);
    expect(ledgerOf(definition())).toBeNull();
  });

  it("reads identity off the stored sheet, and refuses a half-recorded one", () => {
    expect(identityOf(withCharacter([]))).toEqual({
      speciesId: "dwarf",
      backgroundId: "soldier",
      classId: "fighter",
      subclassId: null,
      level: 3,
      classLevels: ["fighter", "fighter", "fighter"]
    });
    // No race recorded: the rebuild cannot name a species, so the flow must gate and invent nothing.
    expect(
      identityOf(
        definition({
          character: { classes: [{ id: "fighter", name: "Fighter", level: 1 }], feats: [] }
        } as unknown as Partial<ActorDefinition>)
      )
    ).toBeNull();
    expect(identityOf(definition())).toBeNull();
  });

  const fighterWizard = (choices: readonly CharacterChoice[] | undefined) =>
    definition({
      character: {
        classes: [
          { id: "fighter", name: "Fighter", level: 3 },
          { id: "wizard", name: "Wizard", level: 2 }
        ],
        race: { id: "human", name: "Human" },
        background: { id: "sage", name: "Sage" },
        feats: [],
        ...(choices ? { choices } : {})
      }
    } as unknown as Partial<ActorDefinition>);
  const order: CharacterChoice = {
    level: 1,
    kind: "class-levels",
    id: "fighter",
    payload: { classes: ["fighter", "wizard", "fighter", "fighter", "wizard"] }
  };

  it("sums a multiclass sheet's levels and keeps the order its ledger recorded", () => {
    const identity = identityOf(fighterWizard([order]));
    expect(identity?.level).toBe(5);
    expect(identity?.classLevels).toEqual(["fighter", "wizard", "fighter", "fighter", "wizard"]);
    // A level-up appends the class it goes to; a level-down drops the last level, whichever class it was.
    expect(targetClassLevels(identity!, 6, "cleric")).toEqual([
      "fighter",
      "wizard",
      "fighter",
      "fighter",
      "wizard",
      "cleric"
    ]);
    expect(targetClassLevels(identity!, 4, "fighter")).toEqual(["fighter", "wizard", "fighter", "fighter"]);
  });

  it("keeps every class on a level-up, and lets a level-down take off a class it removes", () => {
    const identity = identityOf(fighterWizard([order]))!;
    expect(keptClasses(identity, 6)).toEqual(["fighter", "wizard"]);
    expect(keptClasses(identity, 4)).toEqual(["fighter", "wizard"]);
    // Down to level 1, below the Wizard's first level (2): only the Fighter is kept.
    expect(keptClasses(identity, 1)).toEqual(["fighter"]);
  });

  it("refuses a built sheet whose classes were added by hand, with no record of their order", () => {
    expect(identityOf(fighterWizard([]))).toBeNull();
    expect(classOrderUnknown(fighterWizard([]))).toBe(true);
    // A sheet never built here (a PDF import) is refused for that reason instead.
    expect(classOrderUnknown(fighterWizard(undefined))).toBe(false);
    expect(classOrderUnknown(fighterWizard([order]))).toBe(false);
  });
});

describe("Rolled hit points", () => {
  const roll = (level: number, value: number): CharacterChoice => ({
    level,
    kind: "hp-roll",
    id: "hp",
    payload: { roll: value }
  });

  it("returns the recorded rolls for 2..level, so a round trip restores the same maximum", () => {
    expect(hpRolls([roll(2, 6), roll(3, 4)], 3)).toEqual([6, 4]);
    // Level 1 rolls nothing, so a level-1 rebuild needs no rolls and is never "missing" any.
    expect(hpRolls([], 1)).toEqual([]);
  });

  it("returns null the moment ONE level is unrecorded, the server's own rule", () => {
    expect(hpRolls([roll(2, 6)], 3)).toBeNull();
    expect(hpRolls([roll(3, 4)], 3)).toBeNull();
    expect(hpRolls([{ level: 2, kind: "hp-roll", id: "hp" }], 2)).toBeNull();
  });

  /** A Fighter rebuilt at `level`, from a sheet whose levels so far were all Fighter. */
  const fighterTo = (level: number) => ({ level, classLevels: Array<string>(level).fill("fighter") });
  const FIGHTER_3 = ["fighter", "fighter", "fighter"];

  it("says nothing to a character that took the average", () => {
    // No hp-roll rows at all is not a gap: nothing was rolled, so nothing was lost.
    expect(hpRollGap([], fighterTo(5), FIGHTER_3)).toBeNull();
    expect(hpRollGap([{ level: 1, kind: "skill", id: "athletics" }], fighterTo(5), FIGHTER_3)).toBeNull();
  });

  it("names the levels the table will roll when a rolled character's rolls stop short", () => {
    expect(hpRollGap([roll(2, 6)], fighterTo(4), FIGHTER_3)).toEqual([3, 4]);
    // A rolled sheet asks the table to roll; it reuses every recorded roll and throws only the missing ones.
    expect(hpPlan([roll(2, 6)], 4)).toEqual({ mode: "roll" });
    expect(hpPlan([], 4)).toEqual({ mode: "average" });
  });

  it("says nothing when every roll is there", () => {
    expect(hpRollGap([roll(2, 6), roll(3, 4)], fighterTo(3), FIGHTER_3)).toBeNull();
  });

  it("names a level whose recorded roll was for another class, which the table rolls afresh", () => {
    // A Fighter 3 / Wizard 1 levelled down to Fighter 3 keeps its level 4 Wizard roll (a d6) for the way back up.
    const ledger = [roll(2, 7), roll(3, 9), { ...roll(4, 5), classId: "wizard" }];
    expect(hpRollGap(ledger, { level: 4, classLevels: [...FIGHTER_3, "wizard"] }, FIGHTER_3)).toBeNull();
    // Level 4 as a Fighter instead: that roll was a Wizard's, so the table throws a d10.
    expect(hpRollGap(ledger, fighterTo(4), FIGHTER_3)).toEqual([4]);
    // A row with no class was rolled for the class the sheet had at that level.
    expect(
      hpRollGap([roll(2, 7), roll(3, 9)], { level: 3, classLevels: ["fighter", "wizard", "wizard"] }, FIGHTER_3)
    ).toEqual([2, 3]);
  });
});

describe("What a level-down gives up", () => {
  it("names exactly the decisions stamped above the target level", () => {
    const ledger: CharacterChoice[] = [
      { level: 1, kind: "skill", id: "athletics" },
      { level: 3, kind: "subclass", id: "champion" },
      { level: 4, kind: "asi-or-feat", id: "alert" }
    ];
    expect(choicesAbove(ledger, 2).map((row) => row.id)).toEqual(["champion", "alert"]);
    expect(choicesAbove(ledger, 4)).toEqual([]);
  });
});

describe("Which ability method a rebuild may claim", () => {
  const policy = (methods: string[], formula: string | null = null) =>
    ({ allowedAbilityMethods: methods, customFormula: formula, maxLevel: 20, playerBuilder: "open" }) as never;

  it("prefers a range-checked method, because the scores are the character's existing ones", () => {
    expect(methodFor(policy(["standard-array", "point-buy", "roll", "custom"]))).toBe("roll");
    expect(methodFor(policy(["standard-array", "custom"], "4d6kh3"))).toBe("custom");
  });

  it("never claims custom without a formula the GM configured", () => {
    // The server rejects `custom` with no formula, so offering it here would guarantee the rejection.
    expect(methodFor(policy(["standard-array", "custom"]))).toBe("standard-array");
  });

  it("falls back to a strict method rather than to one the table has turned off", () => {
    expect(methodFor(policy(["point-buy"]))).toBe("point-buy");
    expect(methodFor(policy(["standard-array"]))).toBe("standard-array");
  });
});

describe("The scores a character was made with", () => {
  const recordedRow: CharacterChoice = {
    level: 1,
    kind: "ability-scores",
    id: "standard-array",
    payload: {
      baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
      backgroundBonusAllocation: [
        { ability: "str", amount: 2 },
        { ability: "con", amount: 1 }
      ]
    }
  };
  const tablePolicy = {
    allowedAbilityMethods: ["standard-array", "point-buy", "roll", "custom"],
    customFormula: null,
    maxLevel: 20,
    playerBuilder: "open",
    playerRandom: "gm-only",
    typedRolls: "gm-only",
    hitPointRollFloor: "none"
  } as BuilderPolicy;

  it("seeds a rebuild from the recorded method, base scores and background increase, not the sheet's totals", () => {
    // The sheet's STR 19 includes the background's +2 and an ASI's +2; neither is in the base again.
    const sheet = withCharacter([recordedRow]);
    const seeded = draftFromLedger(
      identityOf(sheet)!,
      [recordedRow],
      { ...sheet, abilityScores: { str: 19, dex: 14, con: 14, int: 8, wis: 12, cha: 10 } },
      {} as BuilderCatalogs,
      { level: 4, classLevels: ["fighter", "fighter", "fighter", "fighter"] },
      tablePolicy,
      { offers: [], picks: {}, asiIncreases: {}, subclassId: null, choices: [], abilities: null }
    );
    expect(seeded.abilityMethod).toBe("standard-array");
    expect(seeded.backgroundBonus).toEqual([
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ]);
    expect(seeded.spendScores).toEqual({ str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 });
    expect(seeded.abilityPool.map((entry) => entry.value).sort((left, right) => right - left)).toEqual([
      15, 14, 13, 12, 10, 8
    ]);
  });

  it("takes the table's reading of an older sheet's scores, which sees riders the client can't", () => {
    // A level 20 Barbarian with no recorded scores: STR 24 holds Primal Champion's +4, which the client's own
    // subtraction would leave in the base.
    const sheet = withCharacter([]);
    const seeded = draftFromLedger(
      identityOf(sheet)!,
      [],
      { ...sheet, abilityScores: { str: 24, dex: 14, con: 20, int: 8, wis: 12, cha: 10 } },
      { choice: { species: [] } } as unknown as BuilderCatalogs,
      { level: 3, classLevels: ["fighter", "fighter", "fighter"] },
      tablePolicy,
      {
        offers: [],
        picks: {},
        asiIncreases: {},
        subclassId: null,
        choices: [],
        abilities: {
          abilityMethod: "standard-array",
          baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
          backgroundBonusAllocation: [
            { ability: "str", amount: 2 },
            { ability: "con", amount: 1 }
          ],
          derived: true
        }
      }
    );
    expect(seeded.abilityMethod).toBe("standard-array");
    expect(seeded.backgroundBonus).toEqual([
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ]);
    expect(seeded.abilityPool.map((entry) => entry.value).sort((left, right) => right - left)).toEqual([
      15, 14, 13, 12, 10, 8
    ]);
  });

  it("reads nothing from a sheet built before the row was kept", () => {
    expect(recordedAbilities([])).toBeNull();
    expect(recordedAbilities([{ ...recordedRow, id: "mystery" }])).toBeNull();
  });
});
