import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import { abilityModifier, type HitDie } from "@vtt/rules-5e";
import { builderOffers } from "../src/builder-offers.js";
import { settleBuilderDice, type BuilderDiceRequest } from "../src/builder-dice.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { importActorDefinition, rebuildActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { actionPools, effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";

// Multiclassing in the builder (SRD 5.2.1, Multiclassing): a build names the class each level went to, and every
// number on the sheet follows the SRD's multiclass rules. Prerequisites check the new class and every current one
// with the scores of that moment; hit points take the level-1 maximum once; a later class brings only its multiclass
// training; class features read their own class's level; Spellcasting classes share one slot table while Pact Magic
// stays its own; and the Level flow's rebuilds keep the class order and the dice already rolled.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const ACTOR_ID = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";

type Row = CharacterCreateRequestInput["choices"][number];
type Input = Omit<CharacterCreateRequestInput, "choices"> & { choices: Row[] };

const build = (input: Input) => buildCharacterDefinition(input, library, policy);

/** A seeded stand-in for `context.random` (mulberry32), so generated characters are the same every run. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

/** A generated multiclass character's build request: each class with its levels, the starting class first. */
const generated = (plan: ReadonlyArray<{ classId: string; level: number }>, seed = 7) =>
  generateCharacterRequest(
    { level: plan.reduce((total, entry) => total + entry.level, 0), classes: plan },
    library,
    policy,
    seeded(seed)
  ).request;

const FIGHTER_WIZARD = ["fighter", "fighter", "fighter", "wizard", "wizard"];

/** A Human Fighter 3 (Champion) / Wizard 2: Str 17, Con 15 and the Intelligence 13 the Wizard levels need. */
const fighterWizard = (over: Partial<Input> = {}): Input => ({
  name: "Mara",
  speciesId: "human",
  backgroundId: "soldier",
  classId: "fighter",
  level: 5,
  subclassId: "champion",
  classLevels: FIGHTER_WIZARD,
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 10, con: 14, int: 13, wis: 12, cha: 8 },
  backgroundBonusAllocation: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "entries", entries: [10, 4, 6, 3] },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "history" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 3, classId: "fighter", kind: "subclass", id: "champion", payload: { featureId: "fighter-subclass" } },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" },
    { level: 4, classId: "wizard", kind: "cantrip", id: "fire-bolt" },
    { level: 4, classId: "wizard", kind: "cantrip", id: "light" },
    { level: 4, classId: "wizard", kind: "cantrip", id: "mage-hand" },
    { level: 4, classId: "wizard", kind: "spell", id: "magic-missile" },
    { level: 4, classId: "wizard", kind: "spell", id: "shield" },
    { level: 4, classId: "wizard", kind: "spell", id: "detect-magic" },
    { level: 4, classId: "wizard", kind: "spell", id: "mage-armor" },
    { level: 4, classId: "wizard", kind: "spell", id: "sleep" },
    { level: 5, classId: "wizard", kind: "expertise", id: "history", payload: { featureId: "scholar" } }
  ],
  ...over
});

/** The Fighter 3 / Wizard 1 the Level flow reaches from a Fighter 3: the level-4 rows only. */
const fighterWizardAtFour = (over: Partial<Input> = {}): Input =>
  fighterWizard({
    level: 4,
    classLevels: FIGHTER_WIZARD.slice(0, 4),
    hp: { mode: "entries", entries: [10, 4, 6] },
    choices: fighterWizard().choices.filter((row) => row.level <= 4 && row.id !== "sleep"),
    ...over
  });

/** The live actor a definition lands as, and its swings: derived weapon attacks, each with its attack count. */
function onTheTable(definition: ActorDefinition): { state: GameState; actor: Actor } {
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
  importActorDefinition(state, definition, ACTOR_ID, "public", catalog);
  return { state, actor: state.actors.find((entry) => entry.id === ACTOR_ID)! };
}
function swingCounts(definition: ActorDefinition): number[] {
  const { actor } = onTheTable(definition);
  const weapons = new Set(deriveEquipment(actor, definition, catalog).weaponActionIds);
  return effectiveActions(definition, actor, catalog)
    .filter((action) => weapons.has(action.id) && action.attack)
    .map((action) => action.attack!.count ?? 1);
}

describe("a multiclass character built from scratch", () => {
  it("takes the level-1 maximum for the starting class only, rolls each level on its own class's die, and reads proficiency from the total level", () => {
    const definition = build(fighterWizard());
    // Con 15 (+2). Level 1: Fighter d10 maximum 10 + 2. Levels 2-3: Fighter rolls 10 and 4. Levels 4-5: Wizard rolls
    // 6 and 3 on a d6, with no second level-1 maximum for the Wizard.
    expect(definition.abilityScores).toMatchObject({ str: 17, con: 15, int: 13 });
    expect(definition.hitPoints.maximum).toBe(12 + 12 + 6 + 8 + 5);
    expect(definition.proficiencyBonus).toBe(3);
    // The average is each level's own die: 6 for a d10, 4 for a d6.
    expect(build(fighterWizard({ hp: { mode: "average" } })).hitPoints.maximum).toBe(12 + 2 * 8 + 2 * 6);
    expect(definition.character?.classes).toEqual([
      { id: "fighter", name: "Fighter", level: 3, hitDie: "d10", subclass: { id: "champion", name: "Champion" } },
      { id: "wizard", name: "Wizard", level: 2, hitDie: "d6" }
    ]);
    expect(definition.summary).toContain("Fighter 3 (Champion) / Wizard 2");
  });

  it("refuses a rolled level past its own class's die", () => {
    // Level 4 is the Wizard's first level: a d6, so a 7 can't be its roll, though it would fit a Fighter level.
    expect(() => build(fighterWizard({ hp: { mode: "entries", entries: [10, 4, 7, 3] } }))).toThrow(
      "A d6 hit-point roll must be 1-6; got 7."
    );
  });

  it("records the class order and each roll's class, and seeds a Hit Dice pool per die size", () => {
    const definition = build(fighterWizard());
    const ledger = definition.character?.choices ?? [];
    expect(ledger.find((row) => row.kind === "class-levels")).toEqual({
      level: 1,
      kind: "class-levels",
      id: "fighter",
      payload: { classes: FIGHTER_WIZARD }
    });
    expect(ledger.filter((row) => row.kind === "hp-roll")).toEqual([
      { level: 2, classId: "fighter", kind: "hp-roll", id: "hp", payload: { roll: 10 } },
      { level: 3, classId: "fighter", kind: "hp-roll", id: "hp", payload: { roll: 4 } },
      { level: 4, classId: "wizard", kind: "hp-roll", id: "hp", payload: { roll: 6 } },
      { level: 5, classId: "wizard", kind: "hp-roll", id: "hp", payload: { roll: 3 } }
    ]);
    expect(onTheTable(definition).actor.hitDice?.entries).toEqual([
      { die: "d10", maximum: 3, remaining: 3 },
      { die: "d6", maximum: 2, remaining: 2 }
    ]);
  });

  it("casts a lone Spellcasting class off its own table and its own ability", () => {
    const definition = build(fighterWizard());
    // A Wizard 2 alone has three level 1 slots (SRD: one class with the Spellcasting feature follows its own table).
    expect(definition.spellcasting?.slots).toEqual([{ level: 1, max: 3 }]);
    expect(definition.spellcasting?.classes).toEqual([
      expect.objectContaining({ classId: "wizard", ability: "int", saveDc: 8 + 3 + 1, attackBonus: 3 + 1, prepared: 5 })
    ]);
    const leveled = (definition.spellcasting?.spells ?? []).filter((spell) => spell.level > 0);
    expect(leveled.map((spell) => spell.classId)).toEqual(Array(5).fill("wizard"));
    // A sixth prepared spell is over the Wizard 2's own column.
    const sixth = fighterWizard();
    sixth.choices.push({ level: 4, classId: "wizard", kind: "spell", id: "burning-hands" });
    expect(() => build(sixth)).toThrow("Wizard prepares 5 spells at level 2; got 6.");
  });
});

describe("multiclass prerequisites", () => {
  it("needs 13 in the new class's primary ability", () => {
    expect(() => build(fighterWizard({ baseScores: { str: 15, dex: 10, con: 14, int: 12, wis: 13, cha: 8 } }))).toThrow(
      "To take Wizard at level 4: Wizard needs Intelligence 13; you have 12."
    );
  });

  it("needs 13 in the primary ability of every class already taken, too", () => {
    // Intelligence 15 qualifies for the Wizard, but this Fighter has neither Strength 13 nor Dexterity 13.
    const weakFighter = fighterWizard({
      baseScores: { str: 10, dex: 12, con: 14, int: 15, wis: 13, cha: 8 },
      backgroundBonusAllocation: [
        { ability: "con", amount: 2 },
        { ability: "str", amount: 1 }
      ]
    });
    expect(() => build(weakFighter)).toThrow(
      "To take Wizard at level 4: Fighter, a class you already have, needs Strength 13 or Dexterity 13; you have Strength 11 and Dexterity 12."
    );
  });

  it("reads the scores as they stand when the level is taken", () => {
    // Intelligence 12, raised to 13 by the Fighter's level-4 Ability Score Improvement.
    const raised = (classLevels: string[]): Input => ({
      ...fighterWizard(),
      classLevels,
      baseScores: { str: 15, dex: 10, con: 14, int: 12, wis: 13, cha: 8 },
      hp: { mode: "average" },
      choices: [
        ...fighterWizard().choices.filter((row) => row.classId !== "wizard" || row.kind === "cantrip"),
        { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
        {
          level: classLevels.indexOf("wizard") === 4 ? 4 : 5,
          classId: "fighter",
          kind: "asi-or-feat",
          id: "asi",
          payload: {
            increases: [
              { ability: "int", amount: 1 },
              { ability: "con", amount: 1 }
            ]
          }
        },
        ...["magic-missile", "shield", "detect-magic", "mage-armor"].map((id): Row => ({
          level: 5,
          classId: "wizard",
          kind: "spell",
          id
        }))
      ].map((row) => (row.kind === "cantrip" ? { ...row, level: classLevels.indexOf("wizard") + 1 } : row))
    });
    // The Wizard comes after the improvement: Intelligence 13 by then.
    expect(build(raised(["fighter", "fighter", "fighter", "fighter", "wizard"])).abilityScores.int).toBe(13);
    // The Wizard comes first, while Intelligence is still 12.
    expect(() => build(raised(["fighter", "fighter", "fighter", "wizard", "fighter"]))).toThrow(
      "To take Wizard at level 4: Wizard needs Intelligence 13; you have 12."
    );
  });

  it("reads an improvement's timing from the class level it fills, whatever level its row states", () => {
    // The Fighter's fourth level is character level 5 here, so its improvement can't qualify the level-4 Wizard.
    const early: Input = {
      ...fighterWizard(),
      classLevels: ["fighter", "fighter", "fighter", "wizard", "fighter"],
      baseScores: { str: 15, dex: 10, con: 14, int: 12, wis: 13, cha: 8 },
      hp: { mode: "average" },
      choices: [
        ...fighterWizard().choices.filter((row) => row.classId !== "wizard"),
        ...["fire-bolt", "light", "mage-hand"].map((id): Row => ({ level: 4, classId: "wizard", kind: "cantrip", id })),
        ...["magic-missile", "shield", "detect-magic", "mage-armor"].map((id): Row => ({
          level: 4,
          classId: "wizard",
          kind: "spell",
          id
        })),
        { level: 5, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
        {
          level: 3,
          classId: "fighter",
          kind: "asi-or-feat",
          id: "asi",
          payload: {
            increases: [
              { ability: "int", amount: 1 },
              { ability: "con", amount: 1 }
            ]
          }
        }
      ]
    };
    expect(() => build(early)).toThrow("To take Wizard at level 4: Wizard needs Intelligence 13; you have 12.");
  });
});

describe("multiclass proficiencies", () => {
  it("gives a later class only its multiclass training, never its saving throws", () => {
    // A Wizard who takes up the Fighter: light and medium armor, shields and martial weapons, but no heavy armor and
    // no Strength or Constitution saves.
    const wizardFighter = generated([
      { classId: "wizard", level: 1 },
      { classId: "fighter", level: 1 }
    ]);
    const definition = build(wizardFighter as Input);
    expect(definition.proficiencies?.saves).toEqual(["int", "wis"]);
    expect(definition.proficiencies?.armor).toEqual(["light", "medium", "shields"]);
    expect(definition.proficiencies?.weapons).toEqual(expect.arrayContaining(["simple", "martial"]));
  });

  it("asks a later Rogue for one Rogue skill and a later Bard for any skill and an instrument", () => {
    const reply = builderOffers(
      {
        speciesId: "human",
        backgroundId: "soldier",
        classId: "wizard",
        level: 3,
        classLevels: ["wizard", "rogue", "bard"]
      },
      library
    );
    const offer = (key: string) => reply.offers.find((candidate) => candidate.key === key);
    expect(offer("class-skills:rogue")).toMatchObject({
      capacity: 1,
      level: 2,
      classId: "rogue",
      label: "Rogue skills"
    });
    expect(offer("class-skills:rogue")?.options.map((option) => option.id)).not.toContain("arcana");
    expect(offer("class-skills:bard")?.options.map((option) => option.id)).toContain("arcana");
    expect(offer("class-tools:bard")).toMatchObject({ capacity: 1, level: 3, classId: "bard" });
    expect(offer("class-tools:bard")?.options.every((option) => option.id.startsWith("instrument-"))).toBe(true);

    const definition = build(
      generated([
        { classId: "wizard", level: 1 },
        { classId: "rogue", level: 1 },
        { classId: "bard", level: 1 }
      ]) as Input
    );
    // Thieves' Tools come fixed with the Rogue; the Bard brings one instrument; light armor from both.
    expect(definition.proficiencies?.tools).toContain("thieves-tools");
    expect(definition.proficiencies?.tools?.filter((id) => id.startsWith("instrument-"))).toHaveLength(1);
    expect(definition.proficiencies?.armor).toEqual(["light"]);
    expect(definition.proficiencies?.saves).toEqual(["int", "wis"]);
  });
});

describe("class features across classes", () => {
  it("reads each class's own level: no Extra Attack for a Fighter 4 / Barbarian 4 at character level 8", () => {
    const definition = build(
      generated([
        { classId: "fighter", level: 4 },
        { classId: "barbarian", level: 4 }
      ]) as Input
    );
    expect(new Set(swingCounts(definition))).toEqual(new Set([1]));
  });

  it("keeps one Extra Attack from two classes, and lets a Fighter's own tiers count", () => {
    const fighterBarbarian = build(
      generated([
        { classId: "fighter", level: 5 },
        { classId: "barbarian", level: 5 }
      ]) as Input
    );
    expect(new Set(swingCounts(fighterBarbarian))).toEqual(new Set([2]));
    const fighterPaladin = build(
      generated([
        { classId: "fighter", level: 11 },
        { classId: "paladin", level: 5 }
      ]) as Input
    );
    // Two Extra Attacks at Fighter 11 is three swings; the Paladin's Extra Attack adds nothing on top.
    expect(new Set(swingCounts(fighterPaladin))).toEqual(new Set([3]));
  });

  it("uses the best Unarmored Defense, and only the Barbarian's keeps a shield", () => {
    const definition = build(
      generated([
        { classId: "monk", level: 2 },
        { classId: "barbarian", level: 1 }
      ]) as Input
    );
    const { state, actor } = onTheTable(definition);
    const scores = definition.abilityScores;
    const dex = abilityModifier(scores.dex);
    const monk = 10 + dex + abilityModifier(scores.wis);
    const barbarian = 10 + dex + abilityModifier(scores.con);
    expect(actor.armorClass).toBe(Math.max(monk, barbarian));
    const shield = library.equipmentRecord("shield")!;
    setInventoryItem(
      state,
      ACTOR_ID,
      {
        id: shield.id,
        name: shield.name,
        quantity: 1,
        equipped: true,
        attuned: false,
        category: shield.category,
        armor: { ...shield.armor! }
      } as InventoryItem,
      (id) => state.definitions.find((entry) => entry.id === id)?.definition,
      { catalog, role: "gm" }
    );
    // With a shield the Monk's Unarmored Defense stops working; the Barbarian's adds the shield's +2.
    expect(state.actors.find((entry) => entry.id === ACTOR_ID)!.armorClass).toBe(barbarian + 2);
  });

  it("takes each class's subclass and Ability Score Improvements at that class's own levels", () => {
    const request = generated([
      { classId: "fighter", level: 4 },
      { classId: "cleric", level: 4 }
    ]);
    const definition = build(request as Input);
    expect(definition.character?.classes.map((entry) => [entry.id, entry.level, entry.subclass?.id ?? null])).toEqual([
      ["fighter", 4, "champion"],
      ["cleric", 4, expect.any(String)]
    ]);
    // The Cleric's subclass row sits at its own third level, character level 7; each class's improvement at its
    // own fourth level, character levels 4 and 8.
    const rows = request.choices;
    expect(rows.find((row) => row.kind === "subclass" && row.classId === "cleric")?.level).toBe(7);
    expect(
      rows
        .filter((row) => row.kind === "asi-or-feat")
        .map((row) => [row.classId, row.level])
        .sort()
    ).toEqual([
      ["cleric", 8],
      ["fighter", 4]
    ]);
  });

  it("keeps each class's Channel Divinity uses apart", () => {
    const definition = build(
      generated([
        { classId: "cleric", level: 5 },
        { classId: "paladin", level: 5 }
      ]) as Input
    );
    const pools = new Map(actionPools(definition.actions).map((pool) => [pool.id, pool.limit]));
    // Cleric 5: two uses; Paladin 5: two uses of its own (SRD Channel Divinity, each class's own table).
    expect(pools.get("channel-divinity")).toBe(2);
    expect(pools.get("channel-divinity-paladin")).toBe(2);
  });
});

describe("spell slots across classes", () => {
  it("shares one slot table, with Paladin levels counting half, rounded up", () => {
    const fiveAndFive = build(
      generated([
        { classId: "cleric", level: 5 },
        { classId: "paladin", level: 5 }
      ]) as Input
    );
    // Caster level 5 + 3 = 8.
    expect(fiveAndFive.spellcasting?.slots.map((slot) => slot.max)).toEqual([4, 3, 3, 2]);
    expect(fiveAndFive.spellcasting?.classes?.map((entry) => [entry.classId, entry.ability, entry.prepared])).toEqual([
      ["cleric", "wis", 9],
      ["paladin", "cha", 6]
    ]);
    const twoAndThree = build(
      generated([
        { classId: "cleric", level: 2 },
        { classId: "paladin", level: 3 }
      ]) as Input
    );
    // Caster level 2 + 2 = 4.
    expect(twoAndThree.spellcasting?.slots.map((slot) => slot.max)).toEqual([4, 3]);
  });

  it("holds each class to its own highest spell level, whatever the shared table reaches", () => {
    const request = generated([
      { classId: "cleric", level: 5 },
      { classId: "paladin", level: 5 }
    ]) as Input;
    // The shared table has level 4 slots, but a Paladin 5 prepares Paladin spells of level 2 at most.
    const paladinSpell = request.choices.findIndex(
      (row) => row.kind === "spell" && row.classId === "paladin" && row.payload === undefined
    );
    const choices = request.choices.map((row, index) => (index === paladinSpell ? { ...row, id: "revivify" } : row));
    expect(() => build({ ...request, choices })).toThrow(
      '"revivify" is level 3, above the highest slot level (2) at Paladin 5.'
    );
  });

  it("counts a homebrew class by its own caster progression", () => {
    // A homebrew half caster (the SRD Paladin under another id), which the SRD class table does not know.
    const paladin = library.classRecord("paladin")!;
    const bloodKnight = { ...paladin, id: "blood-knight", name: "Blood Knight" };
    const homebrew = new ContentLibrary({
      revision: 1,
      publishedFor: () => ({
        classes: [bloodKnight],
        subclasses: [],
        species: [],
        backgrounds: [],
        feats: [],
        spells: [],
        equipment: [],
        monsters: [],
        spellLists: []
      }),
      monsterForInstance: () => undefined
    } as never).forAudience("gm");
    const request = generateCharacterRequest(
      {
        level: 5,
        classes: [
          { classId: "wizard", level: 3 },
          { classId: "blood-knight", level: 2 }
        ]
      },
      homebrew,
      policy,
      seeded(7)
    ).request;
    const definition = buildCharacterDefinition(request, homebrew, policy);
    // Wizard 3 + half of Blood Knight 2 = caster level 4.
    expect(definition.spellcasting?.slots.map((slot) => slot.max)).toEqual([4, 3]);
  });

  it("keeps Pact Magic its own pool beside the shared slots", () => {
    const definition = build(
      generated([
        { classId: "warlock", level: 3 },
        { classId: "sorcerer", level: 3 }
      ]) as Input
    );
    // The Sorcerer is the only Spellcasting class, so its own table gives the slots; the Warlock 3's two level 2
    // pact slots stay apart.
    expect(definition.spellcasting?.slots).toEqual([
      { level: 1, max: 4 },
      { level: 2, max: 2 }
    ]);
    expect(definition.spellcasting?.pact).toEqual({ level: 2, max: 2 });
  });
});

describe("Eldritch Invocations learned at Warlock levels", () => {
  const featureOf = (row: Row) => (row.payload as { featureId?: string } | undefined)?.featureId;

  /** A generated Warlock's invocation rows swapped for `ids`, each keeping its row's level. */
  function withInvocations(request: CharacterCreateRequestInput, ids: readonly string[]): Input {
    const replaced = new Set(
      request.choices.filter((row) => featureOf(row) === "eldritch-invocations").map((row) => row.id)
    );
    let next = 0;
    const choices = request.choices.flatMap((row): Row[] => {
      if (featureOf(row) !== "eldritch-invocations") return [row];
      const id = ids[next++];
      return id === undefined ? [] : [{ ...row, id }];
    });
    // Picks hanging off the replaced invocations (Pact of the Blade's weapon) go with them.
    return {
      ...request,
      choices: choices.filter((row) => !replaced.has(featureOf(row) ?? "") || ids.includes(featureOf(row)!))
    };
  }

  it("reads an invocation's level against the Warlock's own level", () => {
    const request = generated([
      { classId: "fighter", level: 4 },
      { classId: "warlock", level: 1 }
    ]);
    // Character level 5, Warlock level 1: Ascendant Step needs Warlock level 5.
    expect(() => build(withInvocations(request, ["ascendant-step"]))).toThrow(/ascendant-step/);
    expect(() => build(withInvocations(request, ["armor-of-shadows"]))).not.toThrow();
  });

  it("holds as many invocations of a level as were gained there or swapped in since", () => {
    const request = generated([{ classId: "warlock", level: 5 }]);
    // Warlock 5 gains two invocations at level 5 and may swap one in, so three can need level 5; four can't.
    const fiveGated = ["ascendant-step", "gaze-of-two-minds", "gift-of-the-depths", "master-of-myriad-forms"];
    expect(() =>
      build(withInvocations(request, [...fiveGated.slice(0, 3), "armor-of-shadows", "eldritch-mind"]))
    ).not.toThrow();
    expect(() => build(withInvocations(request, [...fiveGated, "armor-of-shadows"]))).toThrow(
      "Ascendant Step, Gaze of Two Minds, Gift of the Depths and Master of Myriad Forms need Warlock level 5 or more. A level 5 Warlock can have at most 3 of them: one for each pick gained at level 5 or later, plus one replacement for each Warlock level from 5 on."
    );
  });
});

describe("the Level flow's multiclass rebuilds", () => {
  const hitDieOf = (classId: string) => (library.classRecord(classId)?.hitDie as HitDie | undefined) ?? null;

  /** A Fighter 3 on the table, rolled 10 and 4. */
  function fighterThree() {
    const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
    const definition = build(
      fighterWizard({
        level: 3,
        classLevels: undefined,
        hp: { mode: "entries", entries: [10, 4] },
        choices: fighterWizard().choices.filter((row) => row.level <= 3 && row.classId !== "wizard")
      })
    );
    importActorDefinition(state, definition, ACTOR_ID, "public", catalog);
    return state;
  }

  /** The rebuild command's own steps: settle the dice against the stored sheet, build, land. */
  function rebuild(state: GameState, request: Input | BuilderDiceRequest, faces: number[] = []) {
    const previous = state.definitions.find((entry) => entry.id === `import-${ACTOR_ID}`)!.definition;
    const { input, thrown } = settleBuilderDice(state, request as BuilderDiceRequest, {
      gm: false,
      sessionId: "player-session",
      previous,
      hitDieOf,
      random: () => faces.shift() ?? 1
    });
    const definition = build(input as Input);
    rebuildActorDefinition(state, ACTOR_ID, definition, catalog);
    return { input, thrown, definition };
  }

  it("levels a single-class sheet into a new class, keeping the rolls it recorded", () => {
    const state = fighterThree();
    const { input, thrown, definition } = rebuild(state, { ...fighterWizardAtFour(), hp: { mode: "roll" } }, [5]);
    // Levels 2 and 3 keep their Fighter rolls; level 4 is the Wizard's, thrown on a d6.
    expect(input.hp).toEqual({ mode: "entries", entries: [10, 4, 5] });
    expect(thrown).toEqual([{ faces: 6, roll: 5 }]);
    expect(definition.character?.classes.map((entry) => [entry.id, entry.level])).toEqual([
      ["fighter", 3],
      ["wizard", 1]
    ]);
  });

  it("rolls afresh where a level now goes to another class", () => {
    const state = fighterThree();
    rebuild(state, { ...fighterWizardAtFour(), hp: { mode: "roll" } }, [5]);
    // A respec to Fighter 2 / Wizard 2: level 3 was a Fighter roll and is now a Wizard level; level 4 stays.
    const respec: Input = {
      ...fighterWizardAtFour(),
      subclassId: undefined,
      classLevels: ["fighter", "fighter", "wizard", "wizard"],
      hp: { mode: "roll" } as never,
      choices: [
        ...fighterWizard().choices.filter((row) => row.level <= 2 && row.classId !== "wizard"),
        ...fighterWizard()
          .choices.filter((row) => row.classId === "wizard")
          .map((row) => ({ ...row, level: row.level - 1 }))
      ]
    };
    const { input, thrown } = rebuild(state, respec, [2]);
    expect(input.hp).toEqual({ mode: "entries", entries: [10, 2, 5] });
    expect(thrown).toEqual([{ faces: 6, roll: 2 }]);
  });

  it("drops a class only by levelling below the level it was taken at", () => {
    const state = fighterThree();
    rebuild(state, { ...fighterWizardAtFour(), hp: { mode: "roll" } }, [5]);
    // A single-class Fighter 4 would erase the Wizard level.
    const fighterFour: Input = {
      ...fighterWizardAtFour(),
      classLevels: undefined,
      hp: { mode: "average" },
      choices: [
        ...fighterWizard().choices.filter((row) => row.level <= 3 && row.classId !== "wizard"),
        { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
        {
          level: 4,
          classId: "fighter",
          kind: "asi-or-feat",
          id: "asi",
          payload: { increases: [{ ability: "con", amount: 2 }] }
        }
      ]
    };
    expect(() => rebuild(state, fighterFour)).toThrow(/more classes than this build carries/);
    // Back to level 3, below the Wizard's level 4, the Wizard goes and the Fighter's rolls stay.
    const { definition } = rebuild(state, {
      ...fighterWizard({
        level: 3,
        classLevels: undefined,
        choices: fighterWizard().choices.filter((row) => row.level <= 3 && row.classId !== "wizard")
      }),
      hp: { mode: "roll" }
    } as BuilderDiceRequest);
    expect(definition.character?.classes.map((entry) => entry.id)).toEqual(["fighter"]);
    expect(definition.hitPoints.maximum).toBe(12 + 12 + 6);
  });
});

describe("the builder's offers for a multiclass draft", () => {
  it("serves each class's spells on its own card, at the level it was taken, under its own key", () => {
    const reply = builderOffers(
      {
        speciesId: "human",
        backgroundId: "soldier",
        classId: "fighter",
        level: 5,
        classLevels: FIGHTER_WIZARD,
        picks: { "feature:fighter-subclass": ["champion"] }
      },
      library
    );
    const offer = (key: string) => reply.offers.find((candidate) => candidate.key === key);
    expect(offer("class-cantrips:wizard")).toMatchObject({
      label: "Wizard cantrips",
      capacity: 3,
      level: 4,
      classId: "wizard"
    });
    expect(offer("class-spells:wizard")).toMatchObject({
      label: "Wizard prepared spells",
      capacity: 5,
      level: 4,
      classId: "wizard"
    });
    // The Fighter casts nothing, so there is no unsuffixed card.
    expect(offer("class-cantrips")).toBeUndefined();
    // A later class's own features say which class they belong to.
    expect(offer("feature:scholar")?.label).toBe("Wizard · Scholar");
  });

  it("reads a stored multiclass ledger back onto the same cards", () => {
    const definition = build(fighterWizard());
    const reply = builderOffers(
      {
        speciesId: "human",
        backgroundId: "soldier",
        classId: "fighter",
        level: 5,
        classLevels: FIGHTER_WIZARD,
        choices: definition.character?.choices ?? []
      },
      library
    );
    expect(reply.picks["class-cantrips:wizard"]).toEqual(["fire-bolt", "light", "mage-hand"]);
    expect(reply.picks["class-spells:wizard"]).toHaveLength(5);
    expect(reply.subclassId).toBe("champion");
  });
});

describe("the generator's multiclass characters", () => {
  it("rebuilds every one to the same sheet from its own ledger", () => {
    for (const plan of [
      [
        { classId: "cleric", level: 5 },
        { classId: "paladin", level: 5 }
      ],
      [
        { classId: "warlock", level: 3 },
        { classId: "sorcerer", level: 3 }
      ],
      [
        { classId: "rogue", level: 2 },
        { classId: "ranger", level: 3 },
        { classId: "druid", level: 1 }
      ]
    ]) {
      const request = generated(plan, 3);
      const definition = build(request as Input);
      const stored = definition.character!.choices!;
      const again = build({
        ...(request as Input),
        choices: stored.filter((row) => !["hp-roll", "ability-scores", "class-levels"].includes(row.kind))
      });
      expect(again).toEqual(definition);
    }
  });

  it("places the standard array so a background that can lift only some abilities still qualifies every class", () => {
    // Monk and Paladin need 13 in four abilities: three from the array and the 12 lifted by the background, so the 12
    // has to go where this background's increase can reach.
    for (const seed of [1, 2, 3, 4]) {
      const definition = build(
        generated(
          [
            { classId: "monk", level: 3 },
            { classId: "paladin", level: 2 }
          ],
          seed
        ) as Input
      );
      for (const ability of ["str", "dex", "wis", "cha"] as const)
        expect(definition.abilityScores[ability]).toBeGreaterThanOrEqual(13);
    }
  });

  it("gives a later Wizard's Scholar a skill it can take expertise in", () => {
    // A Fighter's skills share only History with the Scholar's six, so the generator must make sure of one.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const request = generated(
        [
          { classId: "fighter", level: 3 },
          { classId: "wizard", level: 2 }
        ],
        seed
      );
      expect(() => build(request as Input)).not.toThrow();
    }
  });

  it("never picks a tool a later class already trains", () => {
    // Each of these draws a Human whose Skilled feat may take any tool, beside a later Rogue whose multiclass training
    // already holds Thieves' Tools; the build refuses a repeated tool.
    for (const [classId, seed] of [
      ["wizard", 158],
      ["barbarian", 148]
    ] as const) {
      const request = generated(
        [
          { classId, level: 1 },
          { classId: "rogue", level: 1 }
        ],
        seed
      );
      expect(request.choices.some((row) => row.kind === "skill-or-tool")).toBe(true);
      expect(build(request as Input).proficiencies?.tools).toContain("thieves-tools");
    }
  });

  it("refuses a plan the standard array can't qualify for", () => {
    // Paladin, Monk and Wizard need 13s in five abilities; the array and a background's increases make four at most.
    expect(() =>
      generated([
        { classId: "paladin", level: 1 },
        { classId: "monk", level: 1 },
        { classId: "wizard", level: 1 }
      ])
    ).toThrow(/can't give .* the 13s multiclassing needs/);
  });
});
