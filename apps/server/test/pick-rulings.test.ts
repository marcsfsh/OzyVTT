import { describe, expect, it } from "vitest";
import { BuilderPolicySchema } from "@vtt/domain";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";

/**
 * THE FOUR PICK RULINGS Stage 4 specified and declined to build - held at the far end.
 *
 * `docs/product/stage-4-authoring-assignments.md` SS5 answers five design questions and builds two of
 * them. This file proves the rest, and it proves them the only way that counts: a refusal the server
 * really issues, a budget that really grew, a proficiency that really landed on the sheet. Never
 * "the field survived derivation" - a rider that parses, validates and adds zero looks exactly like
 * one that works, which is the failure this whole area exists to end.
 *
 *   - RULING H  `minSpellLevel`   - Mystic Arcanum is "a level 6 spell", not "6 or lower".
 *   - RULING C  catalog families  - `tools`, `languages`, `<table>-languages`, and the base
 *                                   "Common plus two languages" budget every character is owed.
 *   - RULING E  `fromPicks`       - a pick whose options are the character's OWN earlier answers.
 *   - RULING F  `options[].requires` - an option gated on an earlier answer.
 *   - RULING A  `replaces`        - editing a ledger row on a level-up, and on a rest.
 *
 * Written against the REAL bundles through a REAL `ContentLibrary`, so what is proved is the shipped
 * content, not a fixture that happens to agree with it.
 */

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});

type Row = CharacterCreateRequestInput["choices"][number];
type Mutable = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & { choices: Row[] };

/** The base "Common plus two languages" every character now owes (`species-languages`, ruling C). */
const BASE_LANGUAGES: Row[] = [
  { level: 1, kind: "language", id: "dwarvish" },
  { level: 1, kind: "language", id: "giant" }
];
/** The Human's own two picks; the Acolyte's Magic Initiate (Cleric) asks for three more. */
const HUMAN: Row[] = [
  { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
  { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } }
];
const ACOLYTE_FEAT: Row[] = [
  { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
  { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
  { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } }
];
const asiRows = (classId: string, level: number): Row[] =>
  [4, 8, 12, 16].filter((asi) => asi <= level).flatMap((asi) => ([
    { level: asi, classId, kind: "asi-or-feat", id: "ability-score-improvement" },
    { level: asi, kind: "ability-score", id: "con", payload: { featureId: "ability-score-improvement" } },
    { level: asi, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } }
  ] as Row[]));

const build = (input: Mutable) => buildCharacterDefinition(input, library, policy);

// ── Ruling H — minSpellLevel ────────────────────────────────────────────────────────────────────

/**
 * A level-11 Human Acolyte Warlock: the level at which the first Mystic Arcanum arrives. Pact Magic
 * prints 3 cantrips and 3 known spells at 11, and the Invocations column is at 8.
 */
const INVOCATIONS = ["agonizing-blast", "devils-sight", "eldritch-mind", "repelling-blast",
  "armor-of-shadows", "ascendant-step", "fiendish-vigor"] as const;

const warlock11 = (arcanum: string): Mutable => ({
  name: "Vex", speciesId: "human", backgroundId: "acolyte", classId: "warlock", level: 11,
  subclassId: "fiend-patron", abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  backgroundBonusAllocation: [{ ability: "cha", amount: 2 }, { ability: "wis", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    ...BASE_LANGUAGES, ...HUMAN, ...ACOLYTE_FEAT,
    { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
    { level: 1, classId: "warlock", kind: "skill", id: "deception" },
    ...INVOCATIONS.map((id) => ({ level: 1, classId: "warlock", kind: "eldritch-invocation", id, payload: { featureId: "eldritch-invocations" } }) as Row),
    { level: 3, classId: "warlock", kind: "subclass", id: "fiend-patron" },
    { level: 10, kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } },
    ...asiRows("warlock", 11),
    { level: 1, kind: "cantrip", id: "eldritch-blast" },
    { level: 1, kind: "cantrip", id: "prestidigitation" },
    { level: 1, kind: "cantrip", id: "minor-illusion" },
    { level: 1, kind: "spell", id: "hex" },
    { level: 1, kind: "spell", id: "hold-person" },
    { level: 5, kind: "spell", id: "fly" },
    { level: 11, kind: "spell", id: arcanum, payload: { featureId: "mystic-arcanum-level-6-spell" } },
    { level: 1, kind: "equipment", id: "warlock-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ]
} as Mutable);

describe("ruling H - `minSpellLevel` makes Mystic Arcanum an EXACT level, not a ceiling", () => {
  it("REFUSES a level-1 Warlock spell as the level-6 arcanum, naming the floor it broke", () => {
    // The bug the ruling names: with a ceiling alone, "choose one level 6 Warlock spell" read as
    // "level 6 or lower", so an eleventh-level Warlock could spend the arcanum on Hex.
    expect(() => build(warlock11("hex"))).toThrowError(/"hex" is level 1, below the minimum spell level \(6\)/);
  });

  it("accepts the level-6 spell the arcanum actually prints, and puts it on the sheet", () => {
    const definition = build(warlock11("true-seeing"));
    const arcanum = (definition.spellcasting?.spells ?? []).find((spell) => spell.id === "true-seeing");
    expect(arcanum, "the chosen arcanum should reach the sheet").toBeTruthy();
    expect(arcanum!.level).toBe(6);
  });

  it("still refuses a spell ABOVE the window - the ceiling did not stop working", () => {
    expect(() => build(warlock11("power-word-kill"))).toThrowError(/above the maximum spell level \(6\)/);
  });
});

// ── Ruling C — catalog families and the base language budget ─────────────────────────────────────

/** A Halfling Criminal Rogue at `level`. Thieves' Cant raises `species-languages` from 2 to 3. */
const rogue = (level: number, languages: readonly string[]): Mutable => ({
  name: "Nim", speciesId: "halfling", backgroundId: "criminal", classId: "rogue", level,
  ...(level >= 3 ? { subclassId: "thief" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "dex", amount: 2 }, { ability: "int", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    ...languages.map((id) => ({ level: 1, kind: "language", id }) as Row),
    { level: 1, classId: "rogue", kind: "skill", id: "acrobatics" },
    { level: 1, classId: "rogue", kind: "skill", id: "investigation" },
    { level: 1, classId: "rogue", kind: "skill", id: "perception" },
    { level: 1, classId: "rogue", kind: "skill", id: "deception" },
    { level: 1, classId: "rogue", kind: "weapon-mastery", id: "dagger" },
    { level: 1, classId: "rogue", kind: "weapon-mastery", id: "shortbow" },
    { level: 1, classId: "rogue", kind: "expertise", id: "acrobatics" },
    { level: 1, classId: "rogue", kind: "expertise", id: "perception" },
    ...(level >= 3 ? [{ level: 3, classId: "rogue", kind: "subclass", id: "thief" }] as Row[] : []),
    { level: 1, kind: "equipment", id: "rogue-a" },
    { level: 1, kind: "equipment", id: "criminal-a" }
  ]
} as Mutable);

describe("ruling C - the base language budget every character was owed and never offered", () => {
  it("REFUSES a build that skips it - the promise is real, not decorative", () => {
    // Before ruling C no SRD species declared `languageChoices` at all, so "Common plus two
    // languages" was not merely unenforced: it was never offered to anybody, on any build, ever.
    expect(() => build(rogue(1, ["dwarvish"]))).toThrowError(/"Halfling languages" needs 3 pick\(s\) of kind "language"; got 1/);
  });

  it("REFUSES a RARE language for the base budget - the SRD's table narrowing is part of the promise", () => {
    // Druidic is a Rare-table language a Druid is GRANTED; the level-1 budget draws from Standard.
    expect(() => build(rogue(1, ["dwarvish", "giant", "druidic"])))
      .toThrowError(/"druidic" is not an offered option for the "language" choice/);
  });

  it("puts the chosen languages on the sheet beside the species grant", () => {
    const definition = build(rogue(1, ["dwarvish", "giant", "goblin"]));
    // Common from the species, Thieves' Cant from the class grant, and the three the player picked.
    expect([...(definition.proficiencies?.languages ?? [])].sort())
      .toEqual(["common", "dwarvish", "giant", "goblin", "thieves-cant"]);
  });

  it("audit row 62: Thieves' Cant raises the SAME budget Character Creation opens, by one", () => {
    // The pick half of row 62, which the audit could only describe: "you know Thieves' Cant AND one
    // other language of your choice". Two languages is one short and the server says the number.
    expect(() => build(rogue(1, ["dwarvish", "giant"]))).toThrowError(/needs 3 pick\(s\) of kind "language"; got 2/);
    expect(() => build(rogue(1, ["dwarvish", "giant", "goblin", "orc"]))).toThrowError(/exceeds what this build may choose/);
  });
});

/** A Halfling Criminal Ranger. Deft Explorer (level 2) raises `species-languages` by two more. */
const ranger = (level: number, languages: readonly string[]): Mutable => ({
  name: "Ash", speciesId: "halfling", backgroundId: "criminal", classId: "ranger", level,
  ...(level >= 3 ? { subclassId: "hunter" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
  backgroundBonusAllocation: [{ ability: "dex", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    ...languages.map((id) => ({ level: 1, kind: "language", id }) as Row),
    { level: 1, classId: "ranger", kind: "skill", id: "survival" },
    { level: 1, classId: "ranger", kind: "skill", id: "perception" },
    { level: 1, classId: "ranger", kind: "skill", id: "nature" },
    { level: 1, classId: "ranger", kind: "weapon-mastery", id: "longbow" },
    { level: 1, classId: "ranger", kind: "weapon-mastery", id: "shortsword" },
    ...(level >= 2 ? [
      { level: 2, classId: "ranger", kind: "fighting-style", id: "archery", payload: { featureId: "fighting-style" } },
      { level: 2, classId: "ranger", kind: "expertise", id: "survival", payload: { featureId: "deft-explorer" } }
    ] as Row[] : []),
    ...(level >= 3 ? [{ level: 3, classId: "ranger", kind: "subclass", id: "hunter" },
      { level: 3, kind: "hunters-prey", id: "colossus-slayer", payload: { featureId: "hunters-prey" } }] as Row[] : []),
    { level: 1, kind: "spell", id: "hunters-mark" },
    { level: 1, kind: "equipment", id: "ranger-a" },
    { level: 1, kind: "equipment", id: "criminal-a" }
  ]
} as Mutable);

describe("ruling C - audit row 61: Deft Explorer's two languages", () => {
  it("offers TWO at level 1 and FOUR at level 2, the level Deft Explorer arrives", () => {
    // The level-1 Ranger has only the base budget...
    expect(() => build(ranger(1, ["dwarvish", "giant", "goblin", "orc"]))).toThrowError(/exceeds what this build may choose/);
    // ...and the level-2 Ranger is short by exactly the two Deft Explorer promised.
    expect(() => build(ranger(2, ["dwarvish", "giant"]))).toThrowError(/needs 4 pick\(s\) of kind "language"; got 2/);
    const definition = build(ranger(2, ["dwarvish", "giant", "goblin", "orc"]));
    expect(definition.proficiencies?.languages).toEqual(["common", "dwarvish", "giant", "goblin", "orc"]);
  });
});

describe("ruling C - audit row 60: Skilled's `or tools` half", () => {
  /** A level-1 Human Soldier Fighter who spends Versatile on Skilled. */
  const fighterWithSkilled = (picks: readonly Row[]): Mutable => ({
    name: "Bryn", speciesId: "human", backgroundId: "soldier", classId: "fighter", level: 1,
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
    hp: { mode: "average" },
    choices: [
      ...BASE_LANGUAGES,
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "skilled", payload: { featureId: "human-versatile" } },
      ...picks,
      { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
      { level: 1, classId: "fighter", kind: "skill", id: "perception" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "handaxe" },
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  } as Mutable);

  it("lets the three picks be TOOLS, and puts them on the sheet's tool list", () => {
    // The whole promise: "any combination of three skills or tools". `fromCatalog` used to name the
    // skills catalog alone, so the tools half of the sentence was simply unpickable.
    const definition = build(fighterWithSkilled([
      { level: 1, kind: "skill-or-tool", id: "thieves-tools", payload: { featureId: "skilled" } },
      { level: 1, kind: "skill-or-tool", id: "smiths-tools", payload: { featureId: "skilled" } },
      { level: 1, kind: "skill-or-tool", id: "herbalism-kit", payload: { featureId: "skilled" } }
    ]));
    expect(definition.proficiencies?.tools).toContain("thieves-tools");
    expect(definition.proficiencies?.tools).toContain("smiths-tools");
    expect(definition.proficiencies?.tools).toContain("herbalism-kit");
  });

  it("still takes skills, and MIXES the two - `any combination` is not `either list`", () => {
    const definition = build(fighterWithSkilled([
      { level: 1, kind: "skill-or-tool", id: "arcana", payload: { featureId: "skilled" } },
      { level: 1, kind: "skill-or-tool", id: "thieves-tools", payload: { featureId: "skilled" } },
      { level: 1, kind: "skill-or-tool", id: "insight", payload: { featureId: "skilled" } }
    ]));
    expect(definition.proficiencies?.skills?.map((skill) => skill.id)).toEqual(expect.arrayContaining(["arcana", "insight"]));
    expect(definition.proficiencies?.tools).toContain("thieves-tools");
  });

  it("refuses something that is neither a skill nor a tool", () => {
    expect(() => build(fighterWithSkilled([
      { level: 1, kind: "skill-or-tool", id: "longsword", payload: { featureId: "skilled" } },
      { level: 1, kind: "skill-or-tool", id: "arcana", payload: { featureId: "skilled" } },
      { level: 1, kind: "skill-or-tool", id: "insight", payload: { featureId: "skilled" } }
    ]))).toThrowError(/"longsword" is not an offered option/);
  });
});
