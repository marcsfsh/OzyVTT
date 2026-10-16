import { describe, expect, it } from "vitest";
import {
  BuilderPolicySchema,
  GameStateSchema,
  extraPickAmount,
  resolveSpellcasting,
  type GameState
} from "@vtt/domain";
import { abilityModifier, meetsMulticlassPrerequisites } from "@vtt/rules-5e";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { NAMED_PICK_BUDGETS } from "../src/character-offers.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary, type ContentView } from "../src/content-library.js";
import { CommandRejectedError } from "../src/game-store.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { deriveEquipment, weaponPropertiesOf } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";

// End-to-end `character.create` assembly against the real content bundles: a Fighter 5 and a Wizard 3
// built from choices, checking HP, AC, saves, skills, slots, prepared list, rider-derived actions, the
// hit-dice pool and `import-<actorId>` keying, plus the rejection paths (unknown ids, over-cap
// prepared spells, invalid HP entries, policy).

// `buildCharacterDefinition` takes an audience-scoped view, not the library itself; with no
// homebrew source wired in both audiences resolve to the same SRD-only catalog.
const library = new ContentLibrary().forAudience("gm");
const defaultPolicy = BuilderPolicySchema.parse({});
const ACTOR_ID = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";

// The request input is `Readonly` on the wire; negative-path tests build a valid input and then mutate
// one field. This mapped type strips readonly (including the nested `choices` array).
type MutableCreateInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & {
  choices: Array<CharacterCreateRequestInput["choices"][number]>;
  backgroundBonusAllocation: Array<{
    ability: CharacterCreateRequestInput["backgroundBonusAllocation"][number]["ability"];
    amount: number;
  }>;
};

const fighterInput = (): MutableCreateInput => ({
  name: "Borin",
  speciesId: "human",
  backgroundId: "soldier",
  classId: "fighter",
  level: 5,
  subclassId: "champion",
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "entries", entries: [1, 10, 4, 6] },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "survival" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
    { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
    { level: 4, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
    { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
    { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
});

const wizardInput = (): MutableCreateInput => ({
  name: "Ilyana",
  speciesId: "elf",
  backgroundId: "sage",
  classId: "wizard",
  level: 3,
  subclassId: "evoker",
  abilityMethod: "standard-array",
  baseScores: { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 8 },
  backgroundBonusAllocation: [
    { ability: "int", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "wizard", kind: "skill", id: "investigation" },
    { level: 1, classId: "wizard", kind: "skill", id: "insight" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "elf-keen-senses" } },
    { level: 1, kind: "lineage", id: "high-elf" },
    { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "elf-lineage" } },
    { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
    { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
    { level: 3, kind: "spell", id: "shatter", payload: { featureId: "evocation-savant" } },
    { level: 3, kind: "spell", id: "thunderwave", payload: { featureId: "evocation-savant" } },
    { level: 1, kind: "cantrip", id: "fire-bolt" },
    { level: 1, kind: "cantrip", id: "light" },
    { level: 1, kind: "cantrip", id: "mage-hand" },
    { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
    { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
    // Magic Initiate's level-1 spell pick.
    { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
    { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "magic-initiate-wizard" } },
    { level: 1, kind: "spell", id: "magic-missile" },
    { level: 1, kind: "spell", id: "mage-armor" },
    { level: 1, kind: "spell", id: "detect-magic" },
    { level: 2, kind: "spell", id: "misty-step" },
    { level: 1, kind: "equipment", id: "wizard-a" },
    { level: 1, kind: "equipment", id: "sage-a" }
  ]
});

function emptyState(): GameState {
  return GameStateSchema.parse({ schemaVersion: 1 });
}

// Class feature prose must survive `interpretFeature` into the definition the sheet renders, not a
// "See the warlock class description in SRD 5.2.1." stub. The bundle-side guards live in
// `packages/content-srd-5.2.1`.
const warlockInput = (): MutableCreateInput => ({
  name: "Vex",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "warlock",
  level: 5,
  subclassId: "fiend-patron",
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  backgroundBonusAllocation: [
    { ability: "cha", amount: 2 },
    { ability: "wis", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
    { level: 1, classId: "warlock", kind: "skill", id: "deception" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    // Five invocations at level 5: the printed Invocations column runs 1 -> 3 (L2) -> 5 (L5), and
    // `class-resource-growth` lets the budget follow it. Each is stamped at the level gained, so a rebuild
    // down drops the ones the smaller column no longer pays for.
    {
      level: 1,
      classId: "warlock",
      kind: "eldritch-invocation",
      id: "agonizing-blast",
      payload: { featureId: "eldritch-invocations" }
    },
    {
      level: 2,
      classId: "warlock",
      kind: "eldritch-invocation",
      id: "devils-sight",
      payload: { featureId: "eldritch-invocations" }
    },
    {
      level: 2,
      classId: "warlock",
      kind: "eldritch-invocation",
      id: "eldritch-mind",
      payload: { featureId: "eldritch-invocations" }
    },
    {
      level: 5,
      classId: "warlock",
      kind: "eldritch-invocation",
      id: "eldritch-spear",
      payload: { featureId: "eldritch-invocations" }
    },
    {
      level: 5,
      classId: "warlock",
      kind: "eldritch-invocation",
      id: "repelling-blast",
      payload: { featureId: "eldritch-invocations" }
    },
    { level: 3, classId: "warlock", kind: "subclass", id: "fiend-patron" },
    { level: 4, classId: "warlock", kind: "asi-or-feat", id: "ability-score-improvement" },
    { level: 4, kind: "ability-score", id: "cha", payload: { featureId: "ability-score-improvement" } },
    { level: 4, kind: "ability-score", id: "cha", payload: { featureId: "ability-score-improvement" } },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "equipment", id: "warlock-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ]
});

describe("2a - a built Warlock carries the SRD's real feature prose, not a pointer at the SRD", () => {
  const definition = buildCharacterDefinition(warlockInput(), library, defaultPolicy);
  const traits = (definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string; description: string }> })
    .traits;
  const traitNamed = (name: string) => traits.find((trait) => trait.name === name);

  it("lands Pact Magic, Eldritch Invocations and Magical Cunning as readable prose", () => {
    expect(traitNamed("Pact Magic")?.description).toContain("you have formed a pact with a mysterious entity");
    expect(traitNamed("Eldritch Invocations")?.description).toContain("pieces of forbidden knowledge");
    expect(traitNamed("Magical Cunning")?.description).toContain("you regain expended Pact Magic spell slots");
  });

  it("carries no trait whose description is the SRD-pointer stub", () => {
    const stubbed = traits
      .filter((trait) => /^See the .* in SRD 5\.2\.1\.$/.test(trait.description))
      .map((trait) => trait.name);
    expect(stubbed, `these traits reached the sheet as a pointer instead of prose: ${stubbed.join(", ")}`).toEqual([]);
  });

  it('does not offer a prose-less "Subclass Feature" trait at levels the subclass fills', () => {
    // The printed table's "Subclass feature" cell is a reminder, not a class feature, and has no text.
    expect(traits.map((trait) => trait.name)).not.toContain("Subclass Feature");
  });
});

describe("buildCharacterDefinition - Fighter 5 (human soldier, Champion)", () => {
  const definition = buildCharacterDefinition(fighterInput(), library, defaultPolicy);

  it("applies base scores + the background spread + the ASI feat's ability-score picks", () => {
    expect(definition.abilityScores).toEqual({ str: 19, dex: 13, con: 15, int: 8, wis: 12, cha: 10 });
    expect(definition.proficiencyBonus).toBe(3);
  });

  it("adds Alert's Proficiency Bonus to initiative on top of Dexterity", () => {
    // Dex 13 (+1) and Alert at level 5 (PB 3).
    expect(definition.initiativeBonus).toBe(4);
  });

  it("counts each rolled level as rolled, on the class hit die (SRD)", () => {
    // Level 1: 10+2. Rolls 1/10/4/6, +2 Con each = 41.
    expect(definition.hitPoints.maximum).toBe(41);
  });

  it("raises a roll below the average to it only when the table's policy says so", () => {
    // Rolls 1/10/4/6 vs the d10 average 6 -> 6/10/6/6, +2 Con each = 48.
    const floored = buildCharacterDefinition(
      fighterInput(),
      library,
      BuilderPolicySchema.parse({ hitPointRollFloor: "average" })
    );
    expect(floored.hitPoints.maximum).toBe(48);
  });

  it("derives AC from the equipped starting armor via the shared rules function, plus the Defense rider", () => {
    // Chain mail 16 (no Dex) + the Defense fighting style's "+1 while you're wearing armor".
    expect(definition.armorClass).toBe(17);
    const chainMail = definition.startingInventory?.find((item) => item.id === "chain-mail");
    expect(chainMail?.equipped).toBe(true);
    expect(chainMail?.armor?.acBase).toBe(16);
    // The flat, non-equipment part travels with the sheet so every path that re-derives AC from the live
    // loadout can add it back.
    expect((definition.extensions["open5e.srd-2024"] as { armorClassBonus?: number }).armorClassBonus).toBe(1);
  });

  it("holds a whileArmored AC rider back when no armor is worn", () => {
    // Same Defense pick with the "take the gold" equipment option: no body armor, so the rider must not
    // apply and AC falls back to 10 + Dex.
    const unarmored = fighterInput();
    unarmored.choices = unarmored.choices.map((row) =>
      row.kind === "equipment" && row.id === "fighter-a" ? { ...row, id: "fighter-c" } : row
    );
    const built = buildCharacterDefinition(unarmored, library, defaultPolicy);
    const wearsArmor = (built.startingInventory ?? []).some((item) => item.equipped && item.category === "armor");
    expect(wearsArmor).toBe(false);
    expect((built.extensions["open5e.srd-2024"] as { armorClassBonus?: number }).armorClassBonus).toBeUndefined();
    expect(built.armorClass).toBe(11); // 10 + Dex 13, and no Defense bonus
  });

  it("fills saves, chosen + granted skills, and the armor/weapon/tool/language lists", () => {
    expect(definition.proficiencies?.saves).toEqual(["str", "con"]);
    const skills = new Map(definition.proficiencies?.skills.map((skill) => [skill.id, skill.proficiency]));
    expect([...skills.keys()].sort()).toEqual(["athletics", "intimidation", "perception", "stealth", "survival"]);
    expect(skills.get("athletics")).toBe("proficient");
    expect(definition.proficiencies?.armor).toEqual(["light", "medium", "heavy", "shields"]);
    expect(definition.proficiencies?.weapons).toEqual(["simple", "martial"]);
    expect(definition.proficiencies?.tools).toEqual(["gaming-set-dice"]);
    // Common is the species grant; Dwarvish and Giant are the base "Common plus two languages" budget
    // (`species-languages`).
    expect(definition.proficiencies?.languages).toEqual(["common", "dwarvish", "giant"]);
  });

  it("interprets the Second Wind rider into a sheet action with by-level uses resolved (3 at level 5)", () => {
    const secondWind = definition.actions.find((action) => action.id === "second-wind");
    expect(secondWind).toBeDefined();
    expect(secondWind?.activation).toBe("bonus-action");
    expect(secondWind?.uses).toEqual({ limit: 3, per: "long-rest" });
  });

  it("keeps rider-less features as prose traits the sheet already renders", () => {
    const traits = (definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map(
      (trait) => trait.name
    );
    for (const name of [
      "Improved Critical",
      "Tactical Mind",
      "Extra Attack",
      "Alert",
      "Defense",
      "Savage Attacker",
      "Resourceful"
    ]) {
      expect(traits, name).toContain(name);
    }
  });

  it("assembles identity, feats, and the verbatim choices ledger", () => {
    expect(definition.character?.classes).toEqual([
      { id: "fighter", name: "Fighter", level: 5, hitDie: "d10", subclass: { id: "champion", name: "Champion" } }
    ]);
    expect(definition.character?.race).toEqual({ id: "human", name: "Human" });
    expect(definition.character?.background).toEqual({ id: "soldier", name: "Soldier" });
    // The origin feat (Savage Attacker), the versatile pick (Alert), the fighting style (Defense),
    // and the level-4 ASI-as-feat all record on the sheet's feat list.
    expect(definition.character?.feats.map((feat) => feat.id).sort()).toEqual([
      "ability-score-improvement",
      "alert",
      "defense",
      "savage-attacker"
    ]);
    // The ledger is the input's rows verbatim, plus how the scores were made and the rolled hit points the
    // build consumed, so a level-down/level-up round trip lands on the same sheet.
    expect(
      (definition.character?.choices ?? []).filter((row) => row.kind !== "hp-roll" && row.kind !== "ability-scores")
    ).toEqual(fighterInput().choices);
    expect((definition.character?.choices ?? []).filter((row) => row.kind === "ability-scores")).toEqual([
      {
        level: 1,
        kind: "ability-scores",
        id: "standard-array",
        payload: {
          baseScores: fighterInput().baseScores,
          backgroundBonusAllocation: fighterInput().backgroundBonusAllocation
        }
      }
    ]);
    expect((definition.character?.choices ?? []).filter((row) => row.kind === "hp-roll")).toEqual(
      (fighterInput().hp.entries ?? []).map((roll, index) => ({
        level: index + 2,
        kind: "hp-roll",
        id: "hp",
        payload: { roll }
      }))
    );
    expect(definition.summary).toContain("Level 5 Human Fighter (Champion)");
    expect(definition.spellcasting).toBeUndefined();
  });

  it("resolves both equipment options into a mechanical inventory plus the gold", () => {
    const ids = (definition.startingInventory ?? []).map((item) => item.id);
    for (const id of [
      "chain-mail",
      "greatsword",
      "flail",
      "javelin",
      "dungeoneers-pack",
      "spear",
      "shortbow",
      "arrows-20",
      "gaming-set-dice",
      "healers-kit",
      "quiver",
      "travelers-clothes"
    ]) {
      expect(ids, id).toContain(id);
    }
    expect((definition.startingInventory ?? []).find((item) => item.id === "javelin")?.quantity).toBe(8);
    expect((definition.startingInventory ?? []).find((item) => item.id === "greatsword")?.weapon?.damageDice).toBe(
      "2d6"
    );
    expect(definition.startingCurrency?.gp).toBe(18);
  });

  it("supports the built-in 'asi' shorthand as an alternative to the catalog ASI feat", () => {
    const input = fighterInput();
    input.choices = input.choices.filter((row) => row.kind !== "asi-or-feat" && row.kind !== "ability-score");
    input.choices.push({
      level: 4,
      classId: "fighter",
      kind: "asi-or-feat",
      id: "asi",
      payload: { increases: [{ ability: "str", amount: 2 }] }
    });
    const viaShorthand = buildCharacterDefinition(input, library, defaultPolicy);
    expect(viaShorthand.abilityScores.str).toBe(19);
  });

  it("lands through importActorDefinition with the non-negotiable import-<actorId> keying and seeded pools", () => {
    const state = emptyState();
    importActorDefinition(state, definition, ACTOR_ID, "public");
    const actor = state.actors[0];
    expect(actor.id).toBe(ACTOR_ID);
    expect(actor.kind).toBe("player-character");
    expect(actor.definitionId).toBe(`import-${ACTOR_ID}`);
    expect(state.definitions.map((entry) => entry.id)).toEqual([`import-${ACTOR_ID}`]);
    expect(actor.hp).toEqual({ current: 41, maximum: 41, temporary: 0 });
    // `instantiate` re-derives AC from the loadout, so the builder's flat rider (Defense +1) must survive.
    expect(actor.armorClass).toBe(17);
    expect(actor.armorClass).toBe(definition.armorClass);
    expect(actor.hitDice).toMatchObject({
      die: "d10",
      maximum: 5,
      remaining: 5,
      entries: [{ die: "d10", maximum: 5, remaining: 5 }]
    });
    expect(actor.spellSlots).toBeNull();
    expect(GameStateSchema.parse(state)).toBeTruthy(); // the whole state (definition included) re-parses
  });
});

describe("buildCharacterDefinition - Wizard 3 (high-elf sage, Evoker)", () => {
  const definition = buildCharacterDefinition(wizardInput(), library, defaultPolicy);

  it("computes scores, average HP, unarmored AC, and PB", () => {
    expect(definition.abilityScores).toEqual({ str: 10, dex: 14, con: 14, int: 17, wis: 12, cha: 8 });
    expect(definition.hitPoints.maximum).toBe(20); // 6+2, then (4+2) x2
    expect(definition.armorClass).toBe(12); // no armor equipped: 10 + Dex
    expect(definition.proficiencyBonus).toBe(2);
  });

  it("fills the caster block from the class's own level row: slots, DC/attack, prepared cap", () => {
    expect(definition.spellcasting?.ability).toBe("int");
    expect(definition.spellcasting?.saveDc).toBe(13); // 8 + 2 + 3
    expect(definition.spellcasting?.attackBonus).toBe(5);
    expect(definition.spellcasting?.slots).toEqual([
      { level: 1, max: 4 },
      { level: 2, max: 2 }
    ]);
    expect(definition.spellcasting?.classes).toHaveLength(1);
    expect(definition.spellcasting?.classes?.[0]).toMatchObject({ classId: "wizard", ability: "int", prepared: 6 });
    // The assembled sheet answers the documented resolution order: per-class entry by classId, and the
    // top-level fields for single-class readers.
    expect(resolveSpellcasting(definition.spellcasting, "wizard")).toEqual({
      classId: "wizard",
      ability: "int",
      saveDc: 13,
      attackBonus: 5
    });
    expect(resolveSpellcasting(definition.spellcasting)).toMatchObject({ ability: "int", saveDc: 13 });
  });

  it("collects chosen cantrips/spells, Evocation Savant picks, Magic Initiate cantrips, and the lineage grant", () => {
    const spells = new Map((definition.spellcasting?.spells ?? []).map((spell) => [spell.id, spell]));
    expect([...spells.keys()].sort()).toEqual([
      "dancing-lights",
      "detect-magic",
      "fire-bolt",
      "light",
      "mage-armor",
      "mage-hand",
      "magic-missile",
      "minor-illusion",
      "misty-step",
      "prestidigitation",
      "shatter",
      "thunderwave"
    ]);
    expect(spells.get("fire-bolt")?.alwaysPrepared).toBe(true); // class cantrip
    expect(spells.get("prestidigitation")?.alwaysPrepared).toBe(true); // High Elf lineage grant
    // Magic Initiate keeps its level 1 spell always prepared with a free casting, so the class pick of the
    // same spell is not charged to the prepared cap.
    expect(spells.get("magic-missile")).toMatchObject({
      level: 1,
      prepared: true,
      alwaysPrepared: true,
      freeActionId: "spell-magic-missile-free"
    });
    expect(spells.get("mage-armor")).toMatchObject({ alwaysPrepared: false, classId: "wizard" });
    // Evocation Savant adds to the spellbook ("add them to your spellbook for free"): known, not prepared.
    expect(spells.get("shatter")).toMatchObject({ level: 2, prepared: false, alwaysPrepared: false });
  });

  it("marks Scholar expertise on a proficient skill and folds species + background proficiencies", () => {
    const skills = new Map(definition.proficiencies?.skills.map((skill) => [skill.id, skill.proficiency]));
    expect([...skills.keys()].sort()).toEqual(["arcana", "history", "insight", "investigation", "perception"]);
    expect(skills.get("arcana")).toBe("expertise");
    expect(definition.proficiencies?.saves).toEqual(["int", "wis"]);
    expect(definition.proficiencies?.tools).toEqual(["calligraphers-supplies"]);
    // SRD 5.2.1: Common plus two standard languages; the 2024 Elf grants no language of its own.
    expect(definition.proficiencies?.languages).toEqual(["common", "dwarvish", "giant"]);
    expect(definition.character?.race).toEqual({
      id: "elf",
      name: "Elf",
      subrace: { id: "high-elf", name: "High Elf" }
    });
  });

  it("merges overlapping starting-equipment items instead of duplicating rows", () => {
    const quarterstaff = (definition.startingInventory ?? []).find((item) => item.id === "quarterstaff");
    expect(quarterstaff?.quantity).toBe(2); // one from wizard-a, one from sage-a
    expect(definition.startingCurrency?.gp).toBe(13);
  });

  // `weaponAbilityModifier` reads `finesse` from the inventory row's `properties`, so the builder must
  // copy the catalog's properties onto built inventory. This Wizard (STR 10, DEX 14) holds a Dagger
  // (Finesse) and a Quarterstaff (not), both Simple and proficient; without the copy both swing at the
  // same bonus.
  it("copies the catalog's weapon properties onto the built inventory, so a Dagger swings off Dexterity", () => {
    const carried = (id: string) => (definition.startingInventory ?? []).find((item) => item.id === id)!;
    expect(carried("dagger").weapon?.properties).toEqual(["finesse", "light", "thrown"]);
    expect(carried("quarterstaff").weapon?.properties).toEqual(["versatile"]);
    // The property reached the row a real build produced.
    expect(weaponPropertiesOf("dagger", definition.startingInventory ?? [])).toContain("light");
    // `mastery` is not copied: it resolves against the catalog by item id, is gated on the bearer
    // unlocking that weapon, and `ItemWeaponSchema` is strict.
    expect("mastery" in (carried("dagger").weapon ?? {})).toBe(false);

    // Two swings, one character, differing only by Finesse. DEX +2, STR +0, PB +2.
    const state = emptyState();
    importActorDefinition(state, definition, ACTOR_ID, "public");
    const derivation = deriveEquipment(state.actors[0], definition, {
      equipmentRecord: (id: string) => library.equipmentRecord(id)
    });
    const swing = (id: string) => derivation.actions.find((action) => action.id === `item-${id}`)!;
    expect(swing("dagger").attack!.bonus).toBe(4);
    expect(swing("dagger").damage![0].formula).toBe("1d4 + 2");
    expect(swing("quarterstaff").attack!.bonus).toBe(2);
    expect(swing("quarterstaff").damage![0].formula).toBe("1d6");
  });

  it("seeds a live actor whose slot pools and prepared list follow the assembled sheet", () => {
    const state = emptyState();
    importActorDefinition(state, definition, ACTOR_ID, "public");
    const actor = state.actors[0];
    expect(actor.spellSlots).toEqual([
      { level: 1, remaining: 4 },
      { level: 2, remaining: 2 }
    ]);
    expect(actor.hitDice).toMatchObject({ die: "d6", maximum: 3, remaining: 3 });
    expect([...actor.preparedSpellIds].sort()).toEqual([
      "dancing-lights",
      "detect-magic",
      "fire-bolt",
      "light",
      "mage-armor",
      "mage-hand",
      "magic-missile",
      "minor-illusion",
      "misty-step",
      "prestidigitation"
    ]);
  });
});

describe("buildCharacterDefinition - loud rejections", () => {
  it("rejects unknown identity ids", () => {
    expect(() =>
      buildCharacterDefinition({ ...fighterInput(), speciesId: "gnoll" }, library, defaultPolicy)
    ).toThrowError(/No species "gnoll"/);
    expect(() =>
      buildCharacterDefinition({ ...fighterInput(), backgroundId: "pirate" }, library, defaultPolicy)
    ).toThrowError(/No background "pirate"/);
    expect(() =>
      buildCharacterDefinition({ ...fighterInput(), classId: "warlord" }, library, defaultPolicy)
    ).toThrowError(/No class "warlord"/);
    expect(() =>
      buildCharacterDefinition({ ...fighterInput(), subclassId: "banneret" }, library, defaultPolicy)
    ).toThrowError(/No subclass "banneret"/);
  });

  it("rejects a missing subclass at or past the class's subclass level", () => {
    const input = fighterInput();
    delete (input as { subclassId?: string }).subclassId;
    input.choices = input.choices.filter((row) => row.kind !== "subclass");
    expect(() => buildCharacterDefinition(input, library, defaultPolicy)).toThrowError(/chosen at level 3/);
  });

  it("rejects a choice that nothing offered, an over-count pick, and an unfilled required pick", () => {
    const stray = fighterInput();
    stray.choices.push({ level: 1, kind: "skill", id: "basket-weaving" });
    expect(() => buildCharacterDefinition(stray, library, defaultPolicy)).toThrowError(/not an offered option/);
    const over = fighterInput();
    over.choices.push({ level: 1, classId: "fighter", kind: "skill", id: "history" });
    expect(() => buildCharacterDefinition(over, library, defaultPolicy)).toThrowError(
      /exceeds what this build may choose/
    );
    const underfilled = wizardInput();
    underfilled.choices = underfilled.choices.filter((row) => row.kind !== "expertise");
    expect(() => buildCharacterDefinition(underfilled, library, defaultPolicy)).toThrowError(/"Scholar" needs 1 pick/);
  });

  it("rejects spells that are off-list, over the slot level, or beyond the prepared cap", () => {
    const offList = wizardInput();
    offList.choices.push({ level: 1, kind: "spell", id: "cure-wounds" });
    expect(() => buildCharacterDefinition(offList, library, defaultPolicy)).toThrowError(
      /not on the Wizard spell list/
    );
    const overCap = wizardInput();
    // Mage Armor and Misty Step are charged; Magic Missile is Magic Initiate's and Detect Magic the level-3 High
    // Elf's, both always prepared and uncharged.
    overCap.choices.push(
      { level: 1, kind: "spell", id: "shield" },
      { level: 1, kind: "spell", id: "sleep" },
      { level: 1, kind: "spell", id: "burning-hands" },
      { level: 1, kind: "spell", id: "chromatic-orb" },
      { level: 1, kind: "spell", id: "feather-fall" }
    );
    expect(() => buildCharacterDefinition(overCap, library, defaultPolicy)).toThrowError(
      /prepares 6 spells at level 3; got 7/
    );
    const overLevel = wizardInput();
    overLevel.choices = overLevel.choices.filter((row) => row.id !== "misty-step");
    overLevel.choices.push({ level: 3, kind: "spell", id: "fireball" });
    expect(() => buildCharacterDefinition(overLevel, library, defaultPolicy)).toThrowError(
      /above the highest slot level/
    );
  });

  it("rejects hit-point entries outside [1, die] and a wrong entry count", () => {
    const outOfRange = fighterInput();
    outOfRange.hp = { mode: "entries", entries: [1, 10, 4, 11] };
    expect(() => buildCharacterDefinition(outOfRange, library, defaultPolicy)).toThrowError(
      /d10 hit-point roll must be 1-10; got 11/
    );
    const wrongCount = fighterInput();
    wrongCount.hp = { mode: "entries", entries: [5, 5] };
    expect(() => buildCharacterDefinition(wrongCount, library, defaultPolicy)).toThrowError(/exactly 4 entries/);
  });

  it("rejects scores that break the chosen method, and methods the policy does not allow", () => {
    const badArray = fighterInput();
    badArray.baseScores = { ...badArray.baseScores, str: 18 };
    expect(() => buildCharacterDefinition(badArray, library, defaultPolicy)).toThrowError(
      /Standard-array scores must be exactly/
    );
    const restrictive = BuilderPolicySchema.parse({ allowedAbilityMethods: ["point-buy"] });
    expect(() => buildCharacterDefinition(fighterInput(), library, restrictive)).toThrowError(
      /does not allow the "standard-array"/
    );
    const customWithoutFormula = BuilderPolicySchema.parse({ allowedAbilityMethods: ["custom"] });
    expect(() =>
      buildCharacterDefinition({ ...fighterInput(), abilityMethod: "custom" }, library, customWithoutFormula)
    ).toThrowError(/configure a formula/);
  });

  it("rejects an illegal background spread and a ledger row above the character's level", () => {
    const badSpread = fighterInput();
    badSpread.backgroundBonusAllocation = [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 2 }
    ];
    expect(() => buildCharacterDefinition(badSpread, library, defaultPolicy)).toThrowError(
      /allows \+2\/\+1 or \+1\/\+1\/\+1/
    );
    const wrongAbility = fighterInput();
    wrongAbility.backgroundBonusAllocation = [
      { ability: "cha", amount: 2 },
      { ability: "con", amount: 1 }
    ];
    expect(() => buildCharacterDefinition(wrongAbility, library, defaultPolicy)).toThrowError(
      /increases STR\/DEX\/CON, not CHA/
    );
    const aboveLevel = fighterInput();
    aboveLevel.choices.push({ level: 6, kind: "skill", id: "history" });
    expect(() => buildCharacterDefinition(aboveLevel, library, defaultPolicy)).toThrowError(
      /above the character's level/
    );
  });

  it("rejects ASI increases past 20 and malformed increase payloads", () => {
    const past20 = fighterInput();
    past20.baseScores = { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 };
    // str 15 + 2 (background) = 17, then two catalog picks -> 19; cap holds. Use the shorthand to push past 20.
    past20.choices = past20.choices.filter((row) => row.kind !== "asi-or-feat" && row.kind !== "ability-score");
    past20.choices.push({
      level: 4,
      classId: "fighter",
      kind: "asi-or-feat",
      id: "asi",
      payload: {
        increases: [
          { ability: "str", amount: 2 },
          { ability: "str", amount: 2 }
        ]
      }
    });
    expect(() => buildCharacterDefinition(past20, library, defaultPolicy)).toThrowError(
      /cannot raise a score above 20|exactly \+2/
    );
    const malformed = fighterInput();
    malformed.choices = malformed.choices.filter((row) => row.kind !== "asi-or-feat" && row.kind !== "ability-score");
    malformed.choices.push({ level: 4, classId: "fighter", kind: "asi-or-feat", id: "asi" });
    expect(() => buildCharacterDefinition(malformed, library, defaultPolicy)).toThrowError(/payload.increases/);
  });
});

// Rules regressions, one behaviour per block.

/** The real library with one accessor swapped, so a malformed content shape can be exercised without touching the bundles. */
function libraryWith(overrides: Partial<ContentView>): ContentView {
  return Object.assign(Object.create(library) as ContentView, overrides);
}

const clericInput = (): MutableCreateInput => ({
  name: "Sister Ael",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "cleric",
  level: 3,
  subclassId: "life-domain",
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 12, con: 14, int: 10, wis: 15, cha: 13 },
  backgroundBonusAllocation: [
    { ability: "wis", amount: 2 },
    { ability: "cha", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "cleric", kind: "skill", id: "history" },
    { level: 1, classId: "cleric", kind: "skill", id: "medicine" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, classId: "cleric", kind: "divine-order", id: "protector" },
    // The Acolyte's origin feat (Magic Initiate (Cleric)) asks for two cantrips of its own.
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "resistance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "light" },
    { level: 1, kind: "cantrip", id: "sacred-flame" },
    { level: 1, kind: "cantrip", id: "spare-the-dying" },
    { level: 3, classId: "cleric", kind: "subclass", id: "life-domain" },
    // Seven prepared rows against a cap of 6, legal only because cure-wounds is a Life Domain spell the
    // subclass already grants as always-prepared.
    { level: 1, kind: "spell", id: "cure-wounds" },
    { level: 1, kind: "spell", id: "guiding-bolt" },
    { level: 1, kind: "spell", id: "healing-word" },
    { level: 1, kind: "spell", id: "shield-of-faith" },
    { level: 2, kind: "spell", id: "hold-person" },
    { level: 2, kind: "spell", id: "spiritual-weapon" },
    { level: 2, kind: "spell", id: "prayer-of-healing" },
    { level: 1, kind: "equipment", id: "cleric-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ]
});

describe("always-prepared grants are not charged to the prepared count", () => {
  const definition = buildCharacterDefinition(clericInput(), library, defaultPolicy);
  const spells = new Map((definition.spellcasting?.spells ?? []).map((spell) => [spell.id, spell]));

  it("keeps a Life Domain spell the player ALSO prepared as the grant's always-prepared form", () => {
    // A domain spell the player also listed must become `alwaysPrepared: true` and not spend a prepared slot.
    expect(spells.get("cure-wounds")).toMatchObject({ level: 1, prepared: true, alwaysPrepared: true });
    expect(spells.get("cure-wounds")).not.toHaveProperty("classId"); // the grant's entry, not a class pick
    for (const domainSpell of ["aid", "bless", "cure-wounds", "lesser-restoration"]) {
      expect(spells.get(domainSpell)?.alwaysPrepared, domainSpell).toBe(true);
    }
  });

  it("charges exactly the six spells that are not granted against the level-3 cap", () => {
    // Six charged picks + one that deferred to the grant = the seven authored rows.
    const charged = (definition.spellcasting?.spells ?? []).filter((spell) => spell.level > 0 && !spell.alwaysPrepared);
    expect(charged.map((spell) => spell.id).sort()).toEqual([
      "guiding-bolt",
      "healing-word",
      "hold-person",
      "prayer-of-healing",
      "shield-of-faith",
      "spiritual-weapon"
    ]);
    expect(definition.spellcasting?.classes?.[0]).toMatchObject({ classId: "cleric", prepared: 6 });
    // One more charged pick does exceed the cap: the exclusion is scoped to grants.
    const overCap = clericInput();
    overCap.choices.push({ level: 1, kind: "spell", id: "bane" });
    expect(() => buildCharacterDefinition(overCap, library, defaultPolicy)).toThrowError(
      /prepares 6 spells at level 3; got 7/
    );
  });

  it("still rejects the same spell recorded twice", () => {
    const twice = clericInput();
    twice.choices.push({ level: 1, kind: "spell", id: "cure-wounds" });
    expect(() => buildCharacterDefinition(twice, library, defaultPolicy)).toThrowError(/"cure-wounds" is chosen twice/);
  });

  it("interprets the chosen Divine Order option's OWN riders (per-option mechanics)", () => {
    // Protector grants Martial weapon training and Heavy armor training; option mechanics must reach the sheet.
    expect(definition.proficiencies?.armor).toContain("heavy");
    expect(definition.proficiencies?.weapons).toContain("martial");
    const traits = (definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map(
      (trait) => trait.name
    );
    expect(traits).toContain("Protector");
  });

  it("RAISES the class cantrip budget when Thaumaturge is the chosen Divine Order role", () => {
    // Thaumaturge: "you know one extra cantrip from the Cleric spell list". It is an `extraPicks` grant,
    // so the one class cantrip budget goes from 3 to 4.
    const thaumaturge = clericInput();
    thaumaturge.choices = thaumaturge.choices.map((row) =>
      row.kind === "divine-order" ? { ...row, id: "thaumaturge" } : row
    );
    thaumaturge.choices.push({ level: 1, kind: "cantrip", id: "mending" }); // a fourth untagged class cantrip
    const built = buildCharacterDefinition(thaumaturge, library, defaultPolicy);
    expect((built.spellcasting?.spells ?? []).some((spell) => spell.id === "mending")).toBe(true);
    expect(built.proficiencies?.armor).not.toContain("heavy"); // the other role's grant does not apply
    // The fifth is still refused, and the message names the composed cap rather than the printed one.
    const overCap = clericInput();
    overCap.choices = overCap.choices.map((row) => (row.kind === "divine-order" ? { ...row, id: "thaumaturge" } : row));
    overCap.choices.push(
      { level: 1, kind: "cantrip", id: "mending" },
      { level: 1, kind: "cantrip", id: "thaumaturgy" }
    );
    expect(() => buildCharacterDefinition(overCap, library, defaultPolicy)).toThrowError(
      /Cleric knows 4 cantrips at level 3; got 5/
    );
  });

  it("keeps the printed budget for the role that grants no extra pick (Protector)", () => {
    // Negative control: the same fourth cantrip, same class and level, with Protector chosen instead.
    const protector = clericInput(); // clericInput() already picks "protector"
    protector.choices.push({ level: 1, kind: "cantrip", id: "mending" });
    expect(() => buildCharacterDefinition(protector, library, defaultPolicy)).toThrowError(
      /Cleric knows 3 cantrips at level 3; got 4/
    );
  });
});

// `extraPicks`, the vocabulary by which a feature raises a pick budget, asserted as what
// `buildCharacterDefinition` accepts and refuses. Capacities are derived from the content records,
// not typed as literals.
describe("extra picks raise the budget the server validates against", () => {
  const clericRecord = library.classRecord("cleric")!;
  const divineOrder = clericRecord.features.find((feature) => feature.id === "divine-order")!;
  const thaumaturge = divineOrder.choice!.options!.find((option) => option.id === "thaumaturge")!;
  /** The printed column and the authored grant, read off the same records the wizard reads. */
  const printedCantrips = clericRecord.levelTable[2].cantripsKnown!;
  const grantedCantrips = thaumaturge.extraPicks
    .filter((grant) => grant.offer === "class-cantrips")
    .reduce((sum, grant) => sum + extraPickAmount(grant, clericRecord.levelTable, 3), 0);

  /** A Thaumaturge Cleric 3 whose untagged class cantrip rows number exactly `count`. */
  const withCantrips = (count: number): MutableCreateInput => {
    const input = clericInput();
    input.choices = input.choices
      .map((row) => (row.kind === "divine-order" ? { ...row, id: "thaumaturge" } : row))
      // Drop the three untagged cantrips clericInput() carries; the Magic Initiate pair is tagged and belongs
      // to the feat's own offer.
      .filter((row) => !(row.kind === "cantrip" && !row.payload));
    const pool = ["light", "sacred-flame", "spare-the-dying", "mending", "thaumaturgy", "guidance"];
    for (let index = 0; index < count; index += 1) input.choices.push({ level: 1, kind: "cantrip", id: pool[index] });
    return input;
  };

  it("accepts exactly `printed + granted` class cantrips, and refuses one more", () => {
    // The server accepts `printed + granted` from the shared content record, keyed on the same string
    // ("class-cantrips") the builder's offers use; `builder-offers.test.ts` asserts they offer the same number.
    const composed = printedCantrips + grantedCantrips;
    expect(composed).toBe(4);
    expect(() => buildCharacterDefinition(withCantrips(composed), library, defaultPolicy)).not.toThrow();
    expect(() => buildCharacterDefinition(withCantrips(composed + 1), library, defaultPolicy)).toThrowError(
      new RegExp(`Cleric knows ${composed} cantrips at level 3; got ${composed + 1}`)
    );
    // The four are really on the sheet.
    const built = buildCharacterDefinition(withCantrips(composed), library, defaultPolicy);
    const cantrips = (built.spellcasting?.spells ?? []).filter((spell) => spell.level === 0).map((spell) => spell.id);
    for (const id of ["light", "sacred-flame", "spare-the-dying", "mending"]) expect(cantrips).toContain(id);
  });

  it("SUMS two grants of +1 into +2 (composition, not last-one-wins)", () => {
    // A species trait raising the budget Thaumaturge already raises. "Last grant wins" and "first grant
    // wins" both pass single-grant tests and fail here.
    const boosted = libraryWith({
      speciesRecord: (id: string) => {
        const real = library.speciesRecord(id);
        if (!real || id !== "human") return real;
        return {
          ...real,
          traits: [
            ...real.traits,
            {
              id: "arcane-echo",
              name: "Arcane Echo",
              description: "You know one extra cantrip.",
              tags: [],
              actions: [],
              effects: [],
              modifiers: [],
              replaces: [],
              extraPicks: [{ offer: "class-cantrips", amount: 1 }]
            }
          ]
        };
      }
    });
    expect(() => buildCharacterDefinition(withCantrips(5), boosted, defaultPolicy)).not.toThrow();
    expect(() => buildCharacterDefinition(withCantrips(6), boosted, defaultPolicy)).toThrowError(
      /Cleric knows 5 cantrips at level 3; got 6/
    );
    // ...and the same trait on a Protector Cleric adds its +1 to the printed 3, not to 4.
    const protector = clericInput();
    protector.choices.push({ level: 1, kind: "cantrip", id: "mending" });
    expect(() => buildCharacterDefinition(protector, boosted, defaultPolicy)).not.toThrow();
    const overCap = clericInput();
    overCap.choices.push(
      { level: 1, kind: "cantrip", id: "mending" },
      { level: 1, kind: "cantrip", id: "thaumaturgy" }
    );
    expect(() => buildCharacterDefinition(overCap, boosted, defaultPolicy)).toThrowError(
      /Cleric knows 4 cantrips at level 3; got 5/
    );
  });

  it("raises a LIST offer's capacity (class skills), which the level row has nothing to do with", () => {
    const scholarly = libraryWith({
      speciesRecord: (id: string) => {
        const real = library.speciesRecord(id);
        if (!real || id !== "human") return real;
        return {
          ...real,
          traits: [
            ...real.traits,
            {
              id: "temple-scholar",
              name: "Temple Scholar",
              description: "One additional Cleric skill.",
              tags: [],
              actions: [],
              effects: [],
              modifiers: [],
              replaces: [],
              extraPicks: [{ offer: "class-skills", amount: 1 }]
            }
          ]
        };
      }
    });
    // The Cleric prints two skill choices; with the trait it owes three, and an underfilled offer is
    // rejected as loudly as an overfilled one.
    const twoSkills = clericInput();
    expect(() => buildCharacterDefinition(twoSkills, scholarly, defaultPolicy)).toThrowError(
      /"Cleric skills" needs 3 pick\(s\) of kind "skill"; got 2/
    );
    const threeSkills = clericInput();
    threeSkills.choices.push({ level: 1, classId: "cleric", kind: "skill", id: "persuasion" });
    expect(() => buildCharacterDefinition(threeSkills, scholarly, defaultPolicy)).not.toThrow();
    // Without the trait, the third skill is refused.
    expect(() => buildCharacterDefinition(threeSkills, library, defaultPolicy)).toThrowError(
      /exceeds what this build may choose/
    );
  });

  // Budgets that follow a printed column: Eldritch Invocations, and Weapon Mastery on Fighter and
  // Barbarian. `class-resource-growth` reads the column, so `choose` plus the growth is the printed
  // number at every level without a marker feature at each step.
  const INVOCATIONS = [
    "agonizing-blast",
    "devils-sight",
    "eldritch-mind",
    "eldritch-spear",
    "repelling-blast",
    "armor-of-shadows"
  ];
  const warlockWithInvocations = (count: number): MutableCreateInput => {
    const input = warlockInput();
    input.choices = input.choices
      .filter((row) => row.kind !== "eldritch-invocation")
      .concat(
        INVOCATIONS.slice(0, count).map((id) => ({
          level: 1,
          classId: "warlock",
          kind: "eldritch-invocation",
          id,
          payload: { featureId: "eldritch-invocations" }
        }))
      );
    return input;
  };

  it("offers a level-5 Warlock FIVE invocations, and refuses both the sixth and only four", () => {
    // The printed Invocations column reads 1 at level 1 and 5 at level 5.
    expect(() => buildCharacterDefinition(warlockWithInvocations(5), library, defaultPolicy)).not.toThrow();
    expect(() => buildCharacterDefinition(warlockWithInvocations(6), library, defaultPolicy)).toThrowError(
      /exceeds what this build may choose \(Eldritch Invocations: 5\)/
    );
    // Underfilled is as loud as overfilled, so the number really moved rather than the ceiling being lifted.
    expect(() => buildCharacterDefinition(warlockWithInvocations(4), library, defaultPolicy)).toThrowError(
      /"Eldritch Invocations" needs 5 pick\(s\)/
    );
  });

  it("follows the Weapon Mastery column on a HAND_AUTHORED class, which the overlay used to skip", () => {
    // fighterInput() is level 5 and carries four masteries (the column steps to 4 at level 4).
    const five = fighterInput();
    five.choices.push({ level: 4, classId: "fighter", kind: "weapon-mastery", id: "shortsword" });
    expect(() => buildCharacterDefinition(five, library, defaultPolicy)).toThrowError(
      /exceeds what this build may choose \(Weapon Mastery: 4\)/
    );
  });

  // An offer can be a catalog plus bespoke options, so "a Fighting Style feat, or instead Blessed
  // Warrior" is pickable for the Paladin and Ranger.
  it("offers a Paladin the whole feat catalog AND Blessed Warrior, whose own pick is two Cleric cantrips", () => {
    const paladin = (styleId: string, cantrips: readonly string[]): MutableCreateInput => ({
      name: "Var",
      speciesId: "human",
      backgroundId: "soldier",
      classId: "paladin",
      level: 2,
      abilityMethod: "standard-array",
      baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
      backgroundBonusAllocation: [
        { ability: "str", amount: 2 },
        { ability: "con", amount: 1 }
      ],
      hp: { mode: "average" },
      choices: [
        { level: 1, kind: "language", id: "dwarvish" },
        { level: 1, kind: "language", id: "giant" },
        { level: 1, classId: "paladin", kind: "skill", id: "medicine" },
        { level: 1, classId: "paladin", kind: "skill", id: "persuasion" },
        { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
        { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
        { level: 1, classId: "paladin", kind: "weapon-mastery", id: "greatsword" },
        { level: 1, classId: "paladin", kind: "weapon-mastery", id: "flail" },
        { level: 2, classId: "paladin", kind: "fighting-style", id: styleId, payload: { featureId: "fighting-style" } },
        ...cantrips.map((id) => ({
          level: 2,
          kind: "cantrip" as const,
          id,
          payload: { featureId: "blessed-warrior" }
        })),
        { level: 1, kind: "spell", id: "bless", payload: undefined },
        { level: 1, kind: "spell", id: "cure-wounds", payload: undefined },
        { level: 1, kind: "tool", id: "gaming-set-dice" },
        { level: 1, kind: "equipment", id: "paladin-a" },
        { level: 1, kind: "equipment", id: "soldier-a" }
      ]
    });
    // The catalog half: a real Fighting Style feat is accepted, with no cantrips.
    expect(() => buildCharacterDefinition(paladin("defense", []), library, defaultPolicy)).not.toThrow();
    // The bespoke half is offerable, and its nested pick reaches the sheet.
    const blessed = buildCharacterDefinition(
      paladin("blessed-warrior", ["sacred-flame", "guidance"]),
      library,
      defaultPolicy
    );
    const cantrips = (blessed.spellcasting?.spells ?? []).filter((spell) => spell.level === 0).map((spell) => spell.id);
    expect(cantrips.sort()).toEqual(["guidance", "sacred-flame"]);
    // An id in neither half is still refused.
    expect(() => buildCharacterDefinition(paladin("eldritch-mind", []), library, defaultPolicy)).toThrowError(
      /not an offered option/
    );
  });

  /** One record can carry two picks: Magic Initiate promises "two cantrips ... and one level 1 spell". */
  it("offers Magic Initiate's level-1 spell as a SECOND pick, and puts it on the sheet", () => {
    const built = buildCharacterDefinition(warlockInput(), library, defaultPolicy);
    expect((built.spellcasting?.spells ?? []).map((spell) => spell.id)).toContain("bless");
    const twoSpells = warlockInput();
    twoSpells.choices.push({
      level: 1,
      kind: "spell",
      id: "cure-wounds",
      payload: { featureId: "magic-initiate-cleric" }
    });
    expect(() => buildCharacterDefinition(twoSpells, library, defaultPolicy)).toThrowError(
      /exceeds what this build may choose/
    );
    const noSpell = warlockInput();
    noSpell.choices = noSpell.choices.filter(
      (row) => !(row.kind === "spell" && row.payload?.featureId === "magic-initiate-cleric")
    );
    expect(() => buildCharacterDefinition(noSpell, library, defaultPolicy)).toThrowError(
      /"Magic Initiate \(Cleric\)" needs 1 pick\(s\) of kind "spell"/
    );
  });

  it("raises the PREPARED-SPELL budget, and the sheet reports the composed number", () => {
    const studious = libraryWith({
      speciesRecord: (id: string) => {
        const real = library.speciesRecord(id);
        if (!real || id !== "human") return real;
        return {
          ...real,
          traits: [
            ...real.traits,
            {
              id: "zealous-study",
              name: "Zealous Study",
              description: "One additional prepared Cleric spell.",
              tags: [],
              actions: [],
              effects: [],
              modifiers: [],
              replaces: [],
              extraPicks: [{ offer: "class-spells", amount: 1 }]
            }
          ]
        };
      }
    });
    // clericInput() sits exactly on the printed cap of 6 charged prepared spells; `bane` is the seventh,
    // which the base build refuses and this one allows.
    const seventh = clericInput();
    seventh.choices.push({ level: 1, kind: "spell", id: "bane" });
    const built = buildCharacterDefinition(seventh, studious, defaultPolicy);
    expect(built.spellcasting?.classes?.[0]).toMatchObject({ classId: "cleric", prepared: 7 });
    const eighth = clericInput();
    eighth.choices.push({ level: 1, kind: "spell", id: "bane" }, { level: 1, kind: "spell", id: "command" });
    expect(() => buildCharacterDefinition(eighth, studious, defaultPolicy)).toThrowError(
      /Cleric prepares 7 spells at level 3; got 8/
    );
  });

  it("holds EVERY authored extraPicks key in the bundles to a budget that exists", () => {
    // Every budget-raising record goes through this vocabulary, so a mistyped key is caught at test time.
    // The census walks the summaries, which are exactly what the wizard receives.
    const featureIds = new Set<string>();
    const authored: Array<{ where: string; offer: string }> = [];
    const visit = (
      where: string,
      features: readonly {
        id: string;
        extraPicks: readonly { offer: string }[];
        choices: readonly { options: readonly { id: string; extraPicks: readonly { offer: string }[] }[] }[];
      }[]
    ) => {
      for (const feature of features) {
        featureIds.add(feature.id);
        for (const grant of feature.extraPicks) authored.push({ where: `${where}.${feature.id}`, offer: grant.offer });
        for (const option of feature.choices.flatMap((pick) => pick.options)) {
          featureIds.add(option.id);
          for (const grant of option.extraPicks)
            authored.push({ where: `${where}.${feature.id}:${option.id}`, offer: grant.offer });
        }
      }
    };
    for (const record of library.classSummaries()) visit(record.id, record.features);
    for (const record of library.subclassSummaries()) visit(record.id, record.features);
    for (const record of library.speciesSummaries()) visit(record.id, record.features);
    for (const record of library.backgroundSummaries()) visit(record.id, record.features);
    for (const record of library.featSummaries()) visit(record.id, [record.feature]);

    const named = new Set<string>(NAMED_PICK_BUDGETS);
    const unresolvable = authored.filter(
      ({ offer }) =>
        !named.has(offer) && !(offer.startsWith("feature:") && featureIds.has(offer.slice("feature:".length)))
    );
    expect(unresolvable.map((entry) => `${entry.where} -> ${entry.offer}`)).toEqual([]);
    // ...and the census is not vacuous: Thaumaturge is authored and must be seen.
    expect(authored).toContainEqual({ where: "cleric.divine-order:thaumaturge", offer: "class-cantrips" });
  });

  it("REJECTS a grant naming a budget this build has no pick for, loudly and actionably", () => {
    // A key naming nothing is an authoring error, and the build stops with the legal keys named.
    const misnamed = libraryWith({
      speciesRecord: (id: string) => {
        const real = library.speciesRecord(id);
        if (!real || id !== "human") return real;
        return {
          ...real,
          traits: [
            ...real.traits,
            {
              id: "typo-gift",
              name: "Typo Gift",
              description: "Grants a pick to a budget that does not exist.",
              tags: [],
              actions: [],
              effects: [],
              modifiers: [],
              replaces: [],
              extraPicks: [{ offer: "class-cantrip", amount: 1 }]
            }
          ]
        };
      }
    });
    let thrown: unknown;
    try {
      buildCharacterDefinition(clericInput(), misnamed, defaultPolicy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandRejectedError);
    expect((thrown as Error).message).toMatch(
      /grants an extra pick to "class-cantrip", which is not a pick this build has/
    );
    expect((thrown as Error).message).toMatch(/feature:<featureId>/);
  });
});

describe("the same feat cannot be taken twice across different offers", () => {
  it("rejects a Versatile pick that repeats the background's origin feat", () => {
    // A Human Acolyte already holds Magic Initiate (Cleric) from the background; taking it again with
    // Versatile would interpret the feature twice (7 cantrips instead of 5).
    const duplicate = clericInput();
    duplicate.choices = duplicate.choices.map((row) =>
      row.kind === "feat" ? { ...row, id: "magic-initiate-cleric" } : row
    );
    expect(() => buildCharacterDefinition(duplicate, library, defaultPolicy)).toThrowError(
      /Magic Initiate \(Cleric\) may be taken again only with a DIFFERENT spell list/
    );
  });

  it("rejects a duplicate of a feat that is not repeatable at all", () => {
    // The Criminal background grants Alert; spending Versatile on Alert again is simply illegal.
    const duplicate = clericInput();
    duplicate.backgroundId = "criminal";
    duplicate.backgroundBonusAllocation = [
      { ability: "dex", amount: 2 },
      { ability: "con", amount: 1 }
    ];
    duplicate.choices = duplicate.choices.map((row) =>
      row.kind === "equipment" && row.id === "acolyte-a" ? { ...row, id: "criminal-a" } : row
    );
    // The Criminal's origin feat is Alert, and the ledger already spends Versatile on Alert.
    expect(() => buildCharacterDefinition(duplicate, library, defaultPolicy)).toThrowError(
      /Alert is already on this character - a feat can only be taken once/
    );
  });

  it("still allows a repeatable feat with a DIFFERENT spell list, and the ASI feat at every ASI level", () => {
    // Positive control 1: Magic Initiate (Wizard) alongside the background's Magic Initiate (Cleric).
    const differentList = clericInput();
    differentList.choices = differentList.choices.map((row) =>
      row.kind === "feat" ? { ...row, id: "magic-initiate-wizard" } : row
    );
    differentList.choices.push(
      { level: 1, kind: "cantrip", id: "fire-bolt", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "prestidigitation", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "magic-initiate-wizard" } }
    );
    const built = buildCharacterDefinition(differentList, library, defaultPolicy);
    // The Versatile pick replaced Alert here, so the sheet holds both Magic Initiate flavours: same feat
    // name, different spell list, as the SRD allows.
    expect(built.character?.feats.map((feat) => feat.id).sort()).toEqual([
      "magic-initiate-cleric",
      "magic-initiate-wizard"
    ]);

    // Positive control 2: a Fighter 6 spends the level-4 AND level-6 ASI on the same repeatable feat.
    const twoAsis = fighterInput();
    twoAsis.level = 6;
    twoAsis.hp = { mode: "entries", entries: [1, 10, 4, 6, 5] };
    twoAsis.choices.push(
      { level: 6, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 6, kind: "ability-score", id: "con", payload: { featureId: "ability-score-improvement" } },
      { level: 6, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } }
    );
    const fighter6 = buildCharacterDefinition(twoAsis, library, defaultPolicy);
    expect(fighter6.abilityScores).toMatchObject({ str: 19, con: 16, dex: 14 });
  });
});

describe("a feature whose only rider is limited USES still lands as a trackable action", () => {
  const definition = buildCharacterDefinition(fighterInput(), library, defaultPolicy);

  it("synthesizes an activation carrying the resolved use count", () => {
    // A feature that prints a use count but no action (Action Surge, Indomitable, Arcane Recovery, Divine
    // Intervention, Relentless Endurance, the tiefling legacy tiers...) must get a trackable pool.
    const actionSurge = definition.actions.find((action) => action.id === "action-surge");
    expect(actionSurge).toBeDefined();
    expect(actionSurge?.activation).toBe("other");
    expect(actionSurge?.uses).toEqual({ limit: 1, per: "short-rest" }); // by-level table, 1 until level 17
    // The Soldier's origin feat is uses-only too, on a different rest scope.
    expect(definition.actions.find((action) => action.id === "savage-attacker")?.uses).toEqual({
      limit: 1,
      per: "turn"
    });
  });

  it("makes that action resolvable, so the counter can actually be spent", () => {
    // Spending a limited use is itself a structured effect, and a self-only feature needs no target.
    const state = emptyState();
    importActorDefinition(state, definition, ACTOR_ID, "public");
    const other = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d11";
    state.actors.push({ ...state.actors[0], id: other, name: "Sparring Partner", definitionId: undefined });
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: other, score: 20 },
          { actorId: ACTOR_ID, score: 5 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const surge = definition.actions.find((action) => action.id === "action-surge")!;
    const deps: ResolveDependencies = {
      random: () => 1,
      newRollId: () => "40000000-0000-4000-8000-000000000001",
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-07-27T00:00:00.000Z",
      definition
    };
    resolveDefinitionAction(
      state,
      surge,
      { actorId: ACTOR_ID, targetIds: [], commandId: "50000000-0000-4000-8000-000000000001" },
      deps
    );
    expect(state.actors[0].actionUses["action-surge"]).toBe(1);
    // ...and the second attempt is refused: the pool is 1 per short rest.
    expect(() =>
      resolveDefinitionAction(
        state,
        surge,
        { actorId: ACTOR_ID, targetIds: [], commandId: "50000000-0000-4000-8000-000000000002" },
        deps
      )
    ).toThrowError(/no uses remaining \(1\/short rest\)/);
  });
});

describe("an action that shares a pool is gated on the POOL's size", () => {
  const definition = buildCharacterDefinition(clericInput(), library, defaultPolicy);
  const CLERIC = ACTOR_ID;
  const FOE = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d12";

  function encounter(): GameState {
    const state = emptyState();
    importActorDefinition(state, definition, CLERIC, "public");
    state.actors.push({
      ...state.actors[0],
      id: FOE,
      name: "Ghoul",
      kind: "monster",
      definitionId: undefined,
      actionUses: {}
    });
    // The foe holds the turn, so the action-economy slot never masks the limited-use gate.
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: FOE, score: 20 },
          { actorId: CLERIC, score: 5 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    return state;
  }
  const deps = (): ResolveDependencies => ({
    random: () => 3,
    newRollId: () => `40000000-0000-4000-8000-00000000000${Math.floor(Math.random() * 9)}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-07-27T00:00:00.000Z",
    definition
  });

  it("authors Preserve Life and Divine Spark onto one Channel Divinity counter", () => {
    const preserveLife = definition.actions.find((action) => action.id === "preserve-life");
    const divineSpark = definition.actions.find((action) => action.id === "divine-spark");
    expect(preserveLife?.uses).toMatchObject({ pool: "channel-divinity", limit: 1 });
    expect(divineSpark?.uses).toMatchObject({ pool: "channel-divinity", limit: 2 }); // 2 charges at Cleric 3
  });

  it("lets a Cleric 3 use Preserve Life after a Divine Spark, then blocks the third", () => {
    // The counter is keyed on the pool ("channel-divinity"), so the gate must read the pool's limit, not
    // Preserve Life's printed 1.
    const state = encounter();
    const spark = definition.actions.find((action) => action.id === "divine-spark")!;
    const preserve = definition.actions.find((action) => action.id === "preserve-life")!;
    resolveDefinitionAction(
      state,
      spark,
      { actorId: CLERIC, targetIds: [FOE], commandId: "50000000-0000-4000-8000-00000000000a" },
      deps()
    );
    expect(state.actors[0].actionUses["channel-divinity"]).toBe(1);
    resolveDefinitionAction(
      state,
      preserve,
      { actorId: CLERIC, targetIds: [], commandId: "50000000-0000-4000-8000-00000000000b" },
      deps()
    );
    expect(state.actors[0].actionUses["channel-divinity"]).toBe(2);
    // Both charges spent: the third attempt is refused, naming the pool's size.
    expect(() =>
      resolveDefinitionAction(
        state,
        preserve,
        { actorId: CLERIC, targetIds: [], commandId: "50000000-0000-4000-8000-00000000000c" },
        deps()
      )
    ).toThrowError(/no uses remaining \(2\/long rest\)/);
  });
});

describe("a Cleric's Channel Divinity heals and harms by the printed formula", () => {
  // Wisdom 15 + 2 = 17: +3.
  const definition = buildCharacterDefinition(clericInput(), library, defaultPolicy);
  const actionOf = (id: string) => definition.actions.find((action) => action.id === id)!;

  it("adds the Wisdom modifier to Divine Spark, and gives it its healing branch", () => {
    expect(actionOf("divine-spark").damage).toEqual([{ formula: "1d8 + 3", type: "radiant" }]);
    expect(actionOf("divine-spark-heal")).toMatchObject({
      healing: { formula: "1d8 + 3" },
      uses: { pool: "channel-divinity" }
    });
  });

  it("divides Preserve Life's five times the Cleric level among Bloodied targets, none past half its maximum", () => {
    expect(actionOf("preserve-life").healing).toEqual({ formula: "15", divided: true, upToFractionOfMaximum: 0.5 });
    const state = emptyState();
    importActorDefinition(state, definition, ACTOR_ID, "public");
    const FRIEND = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d13";
    state.actors.push({
      ...state.actors[0],
      id: FRIEND,
      name: "Friend",
      definitionId: undefined,
      hp: { current: 2, maximum: 40, temporary: 0 }
    });
    state.actors[0].hp = { ...state.actors[0].hp, current: 1 };
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: ACTOR_ID, score: 20 },
          { actorId: FRIEND, score: 5 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const cast = resolveDefinitionAction(
      state,
      actionOf("preserve-life"),
      { actorId: ACTOR_ID, targetIds: [ACTOR_ID, FRIEND], commandId: "50000000-0000-4000-8000-00000000003a" },
      {
        random: () => 1,
        newRollId: () => "40000000-0000-4000-8000-00000000003a",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-07-27T00:00:00.000Z",
        definition
      }
    );
    // 15 split: the Cleric (max 24) can take 11 to reach half, so 7 each, then the rest to whoever has room.
    const cleric = state.actors[0];
    const friend = state.actors.find((actor) => actor.id === FRIEND)!;
    expect(cast.healing?.targets.reduce((sum, target) => sum + target.regained, 0)).toBe(15);
    expect(cleric.hp.current).toBeLessThanOrEqual(Math.floor(cleric.hp.maximum / 2));
    expect(friend.hp.current).toBeLessThanOrEqual(20);
  });
});

describe("a malformed content record rejects instead of throwing a raw TypeError", () => {
  const malformedLibrary = libraryWith({
    speciesRecord: (id: string) => {
      const real = library.speciesRecord(id);
      if (!real || id !== "human") return real;
      return {
        ...real,
        traits: [
          ...real.traits,
          {
            id: "broken-boon",
            name: "Broken Boon",
            description: "A boon whose option list was never authored.",
            tags: [],
            actions: [],
            effects: [],
            modifiers: [],
            replaces: [],
            extraPicks: [],
            // `{kind, choose, from: []}` must fail the schema's "needs from or fromCatalog" refinement; otherwise
            // `resolveCatalogChoice` throws a TypeError whose internal message reaches the client.
            choice: { kind: "boon", choose: 1, from: [], repeatable: false }
          }
        ]
      };
    }
  });

  it("rejects with an actionable message, as a CommandRejectedError", () => {
    let thrown: unknown;
    try {
      buildCharacterDefinition(fighterInput(), malformedLibrary, defaultPolicy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandRejectedError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/"Broken Boon" offers a "boon" choice with no options/);
    expect((thrown as Error).message).toMatch(/needs a non-empty "from" list or a "fromCatalog" slug/);
  });
});

describe("multiclass prerequisites are correct but deliberately uncalled in phase 2", () => {
  it("cannot gate anything yet: `character.create` carries exactly one class", () => {
    // The request has one `classId` and one `level`. SRD ability minimums apply to taking a second class,
    // never a starting class, so creation does not enforce them. This fails if the request grows a second
    // class entry, at which point the check must be wired in.
    const input = fighterInput();
    expect(Object.keys(input)).toContain("classId");
    expect(Object.keys(input)).not.toContain("classes");
    const built = buildCharacterDefinition(input, library, defaultPolicy);
    expect(built.character?.classes).toHaveLength(1);
    // A Fighter needs STR 13 or DEX 13 to multiclass into; a starting Fighter without either is legal.
    expect(meetsMulticlassPrerequisites({ str: 8, dex: 8 }, "fighter")).toBe(false);
    expect(meetsMulticlassPrerequisites({ str: 8, dex: 13 }, "fighter")).toBe(true); // mode "any"
    expect(meetsMulticlassPrerequisites({ dex: 13 }, "monk")).toBe(false); // mode "all": needs WIS 13 too
    expect(meetsMulticlassPrerequisites({ dex: 13, wis: 13 }, "monk")).toBe(true);
    expect(meetsMulticlassPrerequisites({}, "moon-warden")).toBe(true); // unknown/homebrew: no declared minimum
    // The authored bundle drives it, not just the static table.
    expect(meetsMulticlassPrerequisites({ wis: 12 }, "cleric", library.classProgressionTable())).toBe(false);
    expect(meetsMulticlassPrerequisites({ wis: 13 }, "cleric", library.classProgressionTable())).toBe(true);
  });
});

describe("buildCharacterDefinition - Warlock 5 (Pact Magic)", () => {
  // Pact Magic is the one caster shape that is not a sparse nine-column row; the assembly must read it,
  // not just `spellSlots`.
  const warlockInput = (): CharacterCreateRequestInput & {
    choices: Array<CharacterCreateRequestInput["choices"][number]>;
  } => ({
    name: "Vex",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "warlock",
    level: 5,
    subclassId: "fiend-patron",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [
      { ability: "con", amount: 2 },
      { ability: "dex", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, kind: "skill", id: "acrobatics", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "size", id: "small" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
      { level: 1, classId: "warlock", kind: "skill", id: "deception" },
      {
        level: 1,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "agonizing-blast",
        payload: { featureId: "eldritch-invocations" }
      },
      { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "agonizing-blast" } },
      {
        level: 2,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "devils-sight",
        payload: { featureId: "eldritch-invocations" }
      },
      {
        level: 2,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "eldritch-mind",
        payload: { featureId: "eldritch-invocations" }
      },
      {
        level: 5,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "eldritch-spear",
        payload: { featureId: "eldritch-invocations" }
      },
      { level: 5, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "eldritch-spear" } },
      {
        level: 5,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "repelling-blast",
        payload: { featureId: "eldritch-invocations" }
      },
      { level: 5, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "repelling-blast" } },
      {
        level: 3,
        classId: "warlock",
        kind: "subclass",
        id: "fiend-patron",
        payload: { featureId: "warlock-subclass" }
      },
      {
        level: 4,
        classId: "warlock",
        kind: "asi-or-feat",
        id: "ability-score-improvement",
        payload: { featureId: "ability-score-improvement" }
      },
      {
        level: 4,
        classId: "warlock",
        kind: "ability-score",
        id: "str",
        payload: { featureId: "ability-score-improvement" }
      },
      {
        level: 4,
        classId: "warlock",
        kind: "ability-score",
        id: "dex",
        payload: { featureId: "ability-score-improvement" }
      },
      { level: 1, classId: "warlock", kind: "cantrip", id: "chill-touch" },
      { level: 1, classId: "warlock", kind: "cantrip", id: "eldritch-blast" },
      { level: 1, classId: "warlock", kind: "cantrip", id: "mage-hand" },
      { level: 1, classId: "warlock", kind: "equipment", id: "warlock-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  });

  it("gives a Warlock its Pact Magic slots - all at one level, not a sparse row", () => {
    const definition = buildCharacterDefinition(warlockInput(), library, defaultPolicy);
    // SRD: a Warlock 5 has two level-3 slots and no level-1 or level-2 slots.
    expect(definition.spellcasting?.slots).toEqual([{ level: 3, max: 2 }]);
    expect(definition.spellcasting?.ability).toBe("cha");
    expect(definition.hitPoints.maximum).toBe(38); // d8: 8 + 4x5, then +2 Con x5
  });

  it("counts Warlock levels as pact progression, not full", () => {
    expect(library.classProgressionTable().warlock.casterProgression).toBe("pact");
  });
});

describe("buildCharacterDefinition - derived save DCs", () => {
  // `FeatureSaveDcSchema` has three forms: the "spellcasting" literal, a printed number, and a derived
  // `{base, ability, proficiencyBonus}`. All must resolve to a number, since `ActionSchema` requires one.
  it("resolves a species trait's derived save DC to a number (Dragonborn Breath Weapon)", () => {
    const input = {
      ...fighterInput(),
      speciesId: "dragonborn",
      // Keep only the class-side picks: the base fixture is a Human, whose Skillful/Versatile choices name
      // features a Dragonborn does not have.
      choices: [
        ...fighterInput().choices.filter((choice) => {
          const featureId = (choice as { payload?: { featureId?: string } }).payload?.featureId ?? "";
          return !featureId.startsWith("human-") && choice.kind !== "size";
        }),
        { level: 1, kind: "lineage", id: "black-dragon" }
      ]
    } as CharacterCreateRequestInput;
    const definition = buildCharacterDefinition(input, library, defaultPolicy);
    const breath = definition.actions.find((action) => /breath/i.test(action.name));
    expect(breath, "Dragonborn should grant a Breath Weapon action").toBeTruthy();
    // 8 + CON modifier + proficiency bonus, resolved at build time.
    expect(typeof breath!.save?.dc).toBe("number");
    expect(breath!.save?.dc).toBe(8 + abilityModifier(definition.abilityScores.con) + definition.proficiencyBonus);
  });
});

describe("a proficiency is never taken twice", () => {
  /** The fighter with one choice row swapped for another. */
  const swapping = (from: Readonly<{ kind: string; id: string }>, to: Readonly<{ id: string }>) => {
    const input = fighterInput();
    input.choices = input.choices.map((row) =>
      row.kind === from.kind && row.id === from.id ? { ...row, id: to.id } : row
    );
    return input;
  };

  it("refuses a class skill the background already grants", () => {
    // The Soldier grants Athletics and Intimidation.
    expect(() =>
      buildCharacterDefinition(
        swapping({ kind: "skill", id: "survival" }, { id: "intimidation" }),
        library,
        defaultPolicy
      )
    ).toThrowError(/The skill "intimidation" is taken more than once/);
  });

  it("refuses the same skill from two picks", () => {
    // Human Skillful and the class pick both take Perception.
    expect(() =>
      buildCharacterDefinition(swapping({ kind: "skill", id: "stealth" }, { id: "perception" }), library, defaultPolicy)
    ).toThrowError(/The skill "perception" is taken more than once/);
  });

  it("refuses a language the species already speaks", () => {
    expect(() =>
      buildCharacterDefinition(swapping({ kind: "language", id: "giant" }, { id: "common" }), library, defaultPolicy)
    ).toThrowError(/The language "common" is taken more than once/);
  });

  it("builds the same character with distinct picks", () => {
    expect(() => buildCharacterDefinition(fighterInput(), library, defaultPolicy)).not.toThrow();
  });
});
