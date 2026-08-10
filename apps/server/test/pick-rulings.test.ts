import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema } from "@vtt/domain";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { replaceableOffers } from "../src/choice-overrides.js";
import { ContentLibrary, type ContentView } from "../src/content-library.js";
import { applyRest } from "../src/rests.js";

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
    // Ruling E: Agonizing Blast and Repelling Blast each point at one of the character's OWN cantrips.
    { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "agonizing-blast" } },
    { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "repelling-blast" } },
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

// ── Ruling F — an option gated on an earlier answer ──────────────────────────────────────────────

/** A Human Acolyte Cleric at `level`, whose Blessed Strikes answer is `blessed`. */
const cleric = (level: number, blessed: "divine-strike" | "potent-spellcasting"): Mutable => ({
  name: "Sera", speciesId: "human", backgroundId: "acolyte", classId: "cleric", level,
  subclassId: "life-domain", abilityMethod: "standard-array",
  baseScores: { str: 12, dex: 14, con: 13, int: 8, wis: 15, cha: 10 },
  backgroundBonusAllocation: [{ ability: "wis", amount: 2 }, { ability: "int", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    ...BASE_LANGUAGES, ...HUMAN, ...ACOLYTE_FEAT,
    { level: 1, classId: "cleric", kind: "skill", id: "insight" },
    { level: 1, classId: "cleric", kind: "skill", id: "religion" },
    { level: 1, kind: "divine-order", id: "protector", payload: { featureId: "divine-order" } },
    { level: 3, classId: "cleric", kind: "subclass", id: "life-domain" },
    { level: 7, kind: "blessed-strikes", id: blessed, payload: { featureId: "blessed-strikes" } },
    ...asiRows("cleric", level),
    { level: 1, kind: "cantrip", id: "guidance" },
    { level: 1, kind: "cantrip", id: "sacred-flame" },
    { level: 1, kind: "cantrip", id: "thaumaturgy" },
    { level: 1, kind: "equipment", id: "cleric-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ]
} as Mutable);

const traitsOf = (definition: ReturnType<typeof build>) =>
  (definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string; description: string }> }).traits;

describe("ruling F - audit row 63: Improved Blessed Strikes reads back the level-7 answer", () => {
  it("shows the Divine Strike half to a Divine Strike Cleric, and NOT the other one", () => {
    const traits = traitsOf(build(cleric(14, "divine-strike")));
    expect(traits.map((trait) => trait.name)).toContain("Improved Divine Strike");
    expect(traits.map((trait) => trait.name)).not.toContain("Improved Potent Spellcasting");
    expect(traits.find((trait) => trait.name === "Improved Divine Strike")!.description).toContain("increases to 2d8");
  });

  it("shows the OTHER half to a Potent Spellcasting Cleric - same level, same feature, other answer", () => {
    const traits = traitsOf(build(cleric(14, "potent-spellcasting")));
    expect(traits.map((trait) => trait.name)).toContain("Improved Potent Spellcasting");
    expect(traits.map((trait) => trait.name)).not.toContain("Improved Divine Strike");
    expect(traits.find((trait) => trait.name === "Improved Potent Spellcasting")!.description).toContain("Temporary Hit Points");
  });

  it("costs the player NO pick - a determined answer is adopted, never offered", () => {
    // The point of the ruling: rendering a card with exactly one option on it is worse than the
    // prose it replaces. The build is complete with no `improved-blessed-strikes` row at all, and
    // volunteering one is refused because there is no such offer to answer.
    const input = cleric(14, "divine-strike");
    expect(() => build(input)).not.toThrow();
    input.choices.push({ level: 14, kind: "improved-blessed-strikes", id: "improved-divine-strike", payload: { featureId: "improved-blessed-strikes" } });
    expect(() => build(input)).toThrowError(/No feature "improved-blessed-strikes" offers/);
  });

  it("does not fire before level 14 - the feature is not granted yet", () => {
    expect(traitsOf(build(cleric(13, "divine-strike"))).map((trait) => trait.name)).not.toContain("Improved Divine Strike");
  });
});

/** A Human Acolyte Circle-of-the-Land Druid whose land choice is `land`. */
const druid = (level: number, land: "arid" | "polar" | "temperate" | "tropical", fury: "primal-strike" | "potent-spellcasting" = "primal-strike"): Mutable => ({
  name: "Rowan", speciesId: "human", backgroundId: "acolyte", classId: "druid", level,
  subclassId: "circle-of-the-land", abilityMethod: "standard-array",
  baseScores: { str: 12, dex: 14, con: 13, int: 10, wis: 15, cha: 8 },
  backgroundBonusAllocation: [{ ability: "wis", amount: 2 }, { ability: "int", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    ...BASE_LANGUAGES, ...HUMAN, ...ACOLYTE_FEAT,
    { level: 1, classId: "druid", kind: "skill", id: "nature" },
    { level: 1, classId: "druid", kind: "skill", id: "perception" },
    { level: 1, kind: "primal-order", id: "warden", payload: { featureId: "primal-order" } },
    { level: 3, classId: "druid", kind: "subclass", id: "circle-of-the-land" },
    { level: 3, kind: "land", id: land, payload: { featureId: "circle-of-the-land-spells" } },
    ...(level >= 7 ? [{ level: 7, kind: "elemental-fury", id: fury, payload: { featureId: "elemental-fury" } }] as Row[] : []),
    ...asiRows("druid", level),
    { level: 1, kind: "cantrip", id: "druidcraft" },
    { level: 1, kind: "cantrip", id: "produce-flame" },
    { level: 1, kind: "equipment", id: "druid-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ]
} as Mutable);

describe("ruling F - audit rows 29 and 65: the land choice, and the Resistance it decides", () => {
  it("audit row 29: the four land types are a REAL pick, and an unknown land is refused", () => {
    // The record carried no `choice` at all: "choose one type of land" existed only in the prose.
    const missing = druid(10, "polar");
    missing.choices = missing.choices.filter((row) => row.kind !== "land");
    expect(() => build(missing)).toThrowError(/needs 1 pick\(s\) of kind "land"; got 0/);
    const wrong = druid(10, "polar");
    wrong.choices = wrong.choices.map((row) => row.kind === "land" ? { ...row, id: "swamp" } : row);
    expect(() => build(wrong)).toThrowError(/"swamp" is not an offered option/);
  });

  it("audit row 65: Nature's Ward grants the Resistance the SRD's table prints for THAT land", () => {
    // A number on the sheet, decided by an answer given seven levels earlier and never re-asked.
    expect(build(druid(10, "arid")).damageResistances).toContain("fire");
    expect(build(druid(10, "polar")).damageResistances).toContain("cold");
    expect(build(druid(10, "temperate")).damageResistances).toContain("lightning");
    expect(build(druid(10, "tropical")).damageResistances).toContain("poison");
    // ...and exactly ONE of them, not all four.
    const polar = build(druid(10, "polar")).damageResistances ?? [];
    expect(polar.filter((type) => ["fire", "cold", "lightning", "poison"].includes(type))).toEqual(["cold"]);
  });

  it("keeps the Poisoned immunity the feature grants outright, beside the gated Resistance", () => {
    const definition = build(druid(10, "arid"));
    expect(definition.conditionImmunities).toContain("poisoned");
    expect(definition.damageResistances).toContain("fire");
  });

  it("grants no Resistance at level 9 - Nature's Ward arrives at 10", () => {
    const nine = build(druid(9, "arid")).damageResistances ?? [];
    expect(nine).not.toContain("fire");
  });
});

describe("ruling F - audit row 64: Improved Elemental Fury", () => {
  it("shows the half the level-7 answer chose, and only that half", () => {
    const strike = traitsOf(build(druid(15, "arid", "primal-strike"))).map((trait) => trait.name);
    expect(strike).toContain("Improved Primal Strike");
    expect(strike).not.toContain("Improved Potent Spellcasting");
    const potent = traitsOf(build(druid(15, "arid", "potent-spellcasting"))).map((trait) => trait.name);
    expect(potent).toContain("Improved Potent Spellcasting");
    expect(potent).not.toContain("Improved Primal Strike");
  });
});

// ── Ruling E — a pick whose options are the character's own prior answers ────────────────────────

describe("ruling E - audit rows 51-53: `fromPicks` over the character's own known cantrips", () => {
  /** The warlock11 fixture, with the invocation cantrip rows replaced by `rows`. */
  const withInvocationPicks = (rows: readonly Row[]): Mutable => {
    const input = warlock11("true-seeing");
    input.choices = input.choices.filter((row) => !(row.kind === "cantrip" && typeof row.payload?.featureId === "string"
      && ["agonizing-blast", "repelling-blast"].includes(row.payload.featureId as string)));
    input.choices.push(...rows);
    return input;
  };

  it("records WHICH cantrip the invocation was pointed at - the half these rows were about", () => {
    const definition = build(warlock11("true-seeing"));
    const pointed = (definition.character?.choices ?? []).filter((row) => row.payload?.featureId === "agonizing-blast");
    expect(pointed.map((row) => row.id)).toEqual(["eldritch-blast"]);
  });

  it("REFUSES a cantrip the character does not know - the list is the ledger, not the catalog", () => {
    // Sacred Flame deals damage and this Warlock even has it (from Magic Initiate), but it is not one
    // of their KNOWN WARLOCK CANTRIPS, which is what the invocation says. No catalog slug can draw
    // that line, which is exactly why all three of these rows were prose.
    expect(() => build(withInvocationPicks([
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "agonizing-blast" } },
      { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "repelling-blast" } }
    ]))).toThrowError(/"sacred-flame" is not an offered option for the "cantrip" choice/);
  });

  it("REFUSES a known cantrip that fails the predicate - `deals damage` is enforced, not decoration", () => {
    // Prestidigitation is a cantrip this Warlock really knows and really cannot point Agonizing
    // Blast at: it deals no damage.
    expect(() => build(withInvocationPicks([
      { level: 1, kind: "cantrip", id: "prestidigitation", payload: { featureId: "agonizing-blast" } },
      { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "repelling-blast" } }
    ]))).toThrowError(/"prestidigitation" is not an offered option/);
  });

  it("DEFERS rather than dead-ends when no eligible cantrip has been chosen yet", () => {
    // The ordering problem the ruling names, answered the way an unresolvable catalog already is:
    // the pick is not required, and a row that targets it still fails with the reason.
    const early = warlock11("true-seeing");
    early.choices = early.choices.filter((row) => !(row.kind === "cantrip" && !row.payload));
    early.choices.push(
      { level: 1, kind: "cantrip", id: "prestidigitation" },
      { level: 1, kind: "cantrip", id: "minor-illusion" },
      { level: 1, kind: "cantrip", id: "mage-hand" }
    );
    early.choices = early.choices.filter((row) => !(row.kind === "cantrip" && typeof row.payload?.featureId === "string"
      && ["agonizing-blast", "repelling-blast"].includes(row.payload.featureId as string)));
    expect(() => build(early)).not.toThrow();
    early.choices.push({ level: 1, kind: "cantrip", id: "mage-hand", payload: { featureId: "agonizing-blast" } });
    expect(() => build(early)).toThrowError(/needs "Agonizing Blast" resolved, but Nothing chosen for "class-cantrips" is deals damage yet/);
  });

  it("narrows on the OTHER two predicates too - each invocation asks a different question", () => {
    // Repelling Blast wants an attack roll; Eldritch Spear wants a range of 10+ feet. Chill Touch
    // deals damage AND rolls an attack; Thunderclap deals damage and is a Self emanation, so it
    // answers Agonizing Blast and neither of the others.
    const input = warlock11("true-seeing");
    input.choices = input.choices.filter((row) => row.kind !== "cantrip");
    input.choices.push(
      { level: 1, kind: "cantrip", id: "eldritch-blast" },
      { level: 1, kind: "cantrip", id: "thunderclap" },
      { level: 1, kind: "cantrip", id: "prestidigitation" },
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "thunderclap", payload: { featureId: "agonizing-blast" } },
      { level: 1, kind: "cantrip", id: "thunderclap", payload: { featureId: "repelling-blast" } }
    );
    // Thunderclap satisfies "deals damage" but NOT "requires an attack roll".
    expect(() => build(input)).toThrowError(/"thunderclap" is not an offered option/);
  });
});

// ── Ruling A — replacement ───────────────────────────────────────────────────────────────────────

describe("ruling A - `replaces` names a pick this build really has, or the build is refused", () => {
  it("REFUSES a clause naming no budget, the same way an extraPicks key that names nothing is refused", () => {
    // One offer-key namespace, one check. "You can replace one of these" is worth nothing if the
    // thing it replaces is not a pick this build has - the clause would parse, ship, and let the
    // player re-choose a budget that does not exist.
    const bogus: ContentView = {
      ...library,
      classRecord: (id: string) => {
        const real = library.classRecord(id);
        if (!real || id !== "druid") return real;
        return {
          ...real,
          features: real.features.map((feature) => feature.id === "druidic"
            ? { ...feature, replaces: [{ offer: "feature:not-a-real-pick", when: "long-rest" as const, amount: 1 }] }
            : feature)
        };
      }
    };
    expect(() => buildCharacterDefinition(druid(10, "polar"), bogus, policy))
      .toThrowError(/says a pick to "feature:not-a-real-pick" may be replaced, which is not a pick this build has/);
  });

  it("accepts the clauses the SRD really prints - the land on a Long Rest, the damage type on either", () => {
    // Circle Spells and Fiendish Resilience both declare `replaces` against their OWN pick, and both
    // builds stand. A clause naming a real budget adds nothing to the build; it licenses a re-choice.
    expect(() => build(druid(10, "polar"))).not.toThrow();
    expect(() => build(warlock11("true-seeing"))).not.toThrow();
  });
});

describe("ruling A - the rest-time half: re-choose, then let the rest take it back", () => {
  const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
  const onTheTable = (definition: ReturnType<typeof build>) => {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, definition, HERO, "public");
    return state;
  };
  const view = library;

  it("offers exactly the re-choices the CONTENT declares, with the option list the pick itself had", () => {
    const state = onTheTable(build(druid(10, "polar")));
    const offers = replaceableOffers(state.definitions[0].definition, view);
    expect(offers.map((offer) => offer.offer)).toEqual(["feature:circle-of-the-land-spells"]);
    expect(offers[0].per).toBe("long-rest");
    expect(offers[0].options).toEqual(["arid", "polar", "temperate", "tropical"]);
    // A Cleric declares none - nothing on that sheet is re-chosen on a rest.
    const cleric14 = onTheTable(build(cleric(14, "divine-strike")));
    expect(replaceableOffers(cleric14.definitions[0].definition, view)).toEqual([]);
  });

  it("a Warlock's Fiendish Resilience is re-choosable on the SHORTER rest, over all twelve types", () => {
    const state = onTheTable(build(warlock11("true-seeing")));
    const offers = replaceableOffers(state.definitions[0].definition, view);
    const resilience = offers.find((offer) => offer.offer === "feature:fiendish-resilience");
    expect(resilience, "Fiendish Resilience re-chooses on a Short or Long Rest").toBeTruthy();
    expect(resilience!.per).toBe("short-rest");
    expect(resilience!.options).toContain("cold");
    expect(resilience!.options).not.toContain("force"); // "other than Force", as the SRD prints it
  });

  it("a LONG rest clears both kinds; a SHORT rest clears only the short-rest one", () => {
    // The counter half of the ruling: the override lasts exactly until the next rest of its kind, so
    // the choice is made afresh instead of standing forever.
    const state = onTheTable(build(warlock11("true-seeing")));
    const actor = state.actors[0];
    actor.choiceOverrides = {
      "feature:fiendish-resilience": { id: "cold", per: "short-rest" },
      "feature:some-long-rest-pick": { id: "arid", per: "long-rest" }
    };
    applyRest(state, HERO, "short", () => state.definitions[0].definition);
    expect(Object.keys(actor.choiceOverrides)).toEqual(["feature:some-long-rest-pick"]);
    applyRest(state, HERO, "long", () => state.definitions[0].definition);
    expect(actor.choiceOverrides).toEqual({});
  });
});
