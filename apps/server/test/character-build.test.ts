import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, resolveSpellcasting, type GameState } from "@vtt/domain";
import { meetsMulticlassPrerequisites } from "@vtt/rules-5e";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { CommandRejectedError } from "../src/game-store.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";

/**
 * End-to-end `character.create` assembly against the REAL content bundles: a Fighter 5 and a
 * Wizard 3 built from choices, asserting the numbers the packet names (HP, AC, saves, skills,
 * slots, prepared list, rider-derived actions, hit-dice pool, the `import-<actorId>` keying), plus
 * the loud-rejection paths (unknown ids, over-cap prepared spells, invalid HP entries, policy).
 */

// `buildCharacterDefinition` takes an audience-scoped view, not the library itself; with no
// homebrew source wired in both audiences resolve to the same SRD-only catalog.
const library = new ContentLibrary().forAudience("gm");
const defaultPolicy = BuilderPolicySchema.parse({});
const ACTOR_ID = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";

const fighterInput = (): CharacterCreateRequestInput & { choices: Array<CharacterCreateRequestInput["choices"][number]> } => ({
  name: "Borin",
  speciesId: "human",
  backgroundId: "soldier",
  classId: "fighter",
  level: 5,
  subclassId: "champion",
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "entries", entries: [1, 10, 4, 6] },
  choices: [
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
    { level: 4, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
    { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
    { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
});

const wizardInput = (): CharacterCreateRequestInput & { choices: Array<CharacterCreateRequestInput["choices"][number]> } => ({
  name: "Ilyana",
  speciesId: "elf",
  backgroundId: "sage",
  classId: "wizard",
  level: 3,
  subclassId: "evoker",
  abilityMethod: "standard-array",
  baseScores: { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 8 },
  backgroundBonusAllocation: [{ ability: "int", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "wizard", kind: "skill", id: "investigation" },
    { level: 1, classId: "wizard", kind: "skill", id: "insight" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "elf-keen-senses" } },
    { level: 1, kind: "lineage", id: "high-elf" },
    { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
    { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
    { level: 3, kind: "spell", id: "shatter", payload: { featureId: "evocation-savant" } },
    { level: 3, kind: "spell", id: "thunderwave", payload: { featureId: "evocation-savant" } },
    { level: 1, kind: "cantrip", id: "fire-bolt" },
    { level: 1, kind: "cantrip", id: "light" },
    { level: 1, kind: "cantrip", id: "mage-hand" },
    { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
    { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
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

describe("buildCharacterDefinition - Fighter 5 (human soldier, Champion)", () => {
  const definition = buildCharacterDefinition(fighterInput(), library, defaultPolicy);

  it("applies base scores + the background spread + the ASI feat's ability-score picks", () => {
    expect(definition.abilityScores).toEqual({ str: 19, dex: 13, con: 15, int: 8, wis: 12, cha: 10 });
    expect(definition.proficiencyBonus).toBe(3);
  });

  it("computes rolled HP as max(roll, average) per level on the class hit die", () => {
    // Level 1: 10+2. Rolls 1/10/4/6 vs d10 average 6 -> 6/10/6/6, +2 Con each = 48.
    expect(definition.hitPoints.maximum).toBe(48);
  });

  it("derives AC from the equipped starting armor via the shared rules function, plus the Defense rider", () => {
    // Chain mail 16 (no Dex) + the Defense fighting style's "+1 while you're wearing armor".
    expect(definition.armorClass).toBe(17);
    const chainMail = definition.startingInventory?.find((item) => item.id === "chain-mail");
    expect(chainMail?.equipped).toBe(true);
    expect(chainMail?.armor?.acBase).toBe(16);
    // The flat, non-equipment part travels with the sheet so every path that RE-DERIVES AC from the
    // live loadout can add it back instead of silently dropping it (task-packet risk 3).
    expect((definition.extensions["open5e.srd-2024"] as { armorClassBonus?: number }).armorClassBonus).toBe(1);
  });

  it("holds a whileArmored AC rider back when no armor is worn", () => {
    // Same Defense pick, but the "just take the gold" equipment option: no body armor, so the rider
    // must NOT apply and the sheet must fall back to 10 + Dex.
    const unarmored = fighterInput();
    unarmored.choices = unarmored.choices.map((row) => row.kind === "equipment" && row.id === "fighter-a" ? { ...row, id: "fighter-c" } : row);
    const built = buildCharacterDefinition(unarmored, library, defaultPolicy);
    const wearsArmor = (built.startingInventory ?? []).some((item) => item.equipped && item.category === "armor");
    expect(wearsArmor).toBe(false);
    expect((built.extensions["open5e.srd-2024"] as { armorClassBonus?: number }).armorClassBonus).toBeUndefined();
    expect(built.armorClass).toBe(11); // 10 + Dex 13, and no Defense bonus
  });

  it("fills saves, chosen + granted skills, and the armor/weapon/tool/language lists", () => {
    expect(definition.proficiencies?.saves).toEqual(["str", "con"]);
    const skills = new Map(definition.proficiencies?.skills.map((skill) => [skill.id, skill.proficiency]));
    expect([...skills.keys()].sort()).toEqual(["athletics", "intimidation", "perception", "stealth"]);
    expect(skills.get("athletics")).toBe("proficient");
    expect(definition.proficiencies?.armor).toEqual(["light", "medium", "heavy", "shields"]);
    expect(definition.proficiencies?.weapons).toEqual(["simple", "martial"]);
    expect(definition.proficiencies?.tools).toEqual(["gaming-set-dice"]);
    expect(definition.proficiencies?.languages).toEqual(["common"]);
  });

  it("interprets the Second Wind rider into a sheet action with by-level uses resolved (3 at level 5)", () => {
    const secondWind = definition.actions.find((action) => action.id === "second-wind");
    expect(secondWind).toBeDefined();
    expect(secondWind?.activation).toBe("bonus-action");
    expect(secondWind?.uses).toEqual({ limit: 3, per: "long-rest" });
  });

  it("keeps rider-less features as prose traits the sheet already renders", () => {
    const traits = (definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map((trait) => trait.name);
    for (const name of ["Improved Critical", "Tactical Mind", "Extra Attack", "Alert", "Defense", "Savage Attacker", "Resourceful"]) {
      expect(traits, name).toContain(name);
    }
  });

  it("assembles identity, feats, and the verbatim choices ledger", () => {
    expect(definition.character?.classes).toEqual([{ id: "fighter", name: "Fighter", level: 5, hitDie: "d10", subclass: { id: "champion", name: "Champion" } }]);
    expect(definition.character?.race).toEqual({ id: "human", name: "Human" });
    expect(definition.character?.background).toEqual({ id: "soldier", name: "Soldier" });
    // The origin feat (Savage Attacker), the versatile pick (Alert), the fighting style (Defense),
    // and the level-4 ASI-as-feat all record on the sheet's feat list.
    expect(definition.character?.feats.map((feat) => feat.id).sort()).toEqual(["ability-score-improvement", "alert", "defense", "savage-attacker"]);
    expect(definition.character?.choices).toEqual(fighterInput().choices);
    expect(definition.summary).toContain("Level 5 Human Fighter (Champion)");
    expect(definition.spellcasting).toBeUndefined();
  });

  it("resolves both equipment options into a mechanical inventory plus the gold", () => {
    const ids = (definition.startingInventory ?? []).map((item) => item.id);
    for (const id of ["chain-mail", "greatsword", "flail", "javelin", "dungeoneers-pack", "spear", "shortbow", "arrows-20", "gaming-set-dice", "healers-kit", "quiver", "travelers-clothes"]) {
      expect(ids, id).toContain(id);
    }
    expect((definition.startingInventory ?? []).find((item) => item.id === "javelin")?.quantity).toBe(8);
    expect((definition.startingInventory ?? []).find((item) => item.id === "greatsword")?.weapon?.damageDice).toBe("2d6");
    expect(definition.startingCurrency?.gp).toBe(18);
  });

  it("supports the built-in 'asi' shorthand as an alternative to the catalog ASI feat", () => {
    const input = fighterInput();
    input.choices = input.choices.filter((row) => row.kind !== "asi-or-feat" && row.kind !== "ability-score");
    input.choices.push({ level: 4, classId: "fighter", kind: "asi-or-feat", id: "asi", payload: { increases: [{ ability: "str", amount: 2 }] } });
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
    expect(actor.hp).toEqual({ current: 48, maximum: 48, temporary: 0 });
    // Task-packet risk 3: `instantiate` RE-DERIVES AC from the loadout, so the builder's flat rider
    // (Defense +1) has to survive the round trip. Both the concrete number and the invariant.
    expect(actor.armorClass).toBe(17);
    expect(actor.armorClass).toBe(definition.armorClass);
    expect(actor.hitDice).toMatchObject({ die: "d10", maximum: 5, remaining: 5, entries: [{ die: "d10", maximum: 5, remaining: 5 }] });
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
    expect(definition.spellcasting?.slots).toEqual([{ level: 1, max: 4 }, { level: 2, max: 2 }]);
    expect(definition.spellcasting?.classes).toHaveLength(1);
    expect(definition.spellcasting?.classes?.[0]).toMatchObject({ classId: "wizard", ability: "int", prepared: 6 });
    // Carry-along: the assembled sheet answers the ONE documented resolution order - per-class entry
    // by classId, and the still-populated top-level fields for pre-multiclass readers.
    expect(resolveSpellcasting(definition.spellcasting, "wizard")).toEqual({ classId: "wizard", ability: "int", saveDc: 13, attackBonus: 5 });
    expect(resolveSpellcasting(definition.spellcasting)).toMatchObject({ ability: "int", saveDc: 13 });
  });

  it("collects chosen cantrips/spells, Evocation Savant picks, Magic Initiate cantrips, and the lineage grant", () => {
    const spells = new Map((definition.spellcasting?.spells ?? []).map((spell) => [spell.id, spell]));
    expect([...spells.keys()].sort()).toEqual([
      "dancing-lights", "detect-magic", "fire-bolt", "light", "mage-armor", "mage-hand",
      "magic-missile", "minor-illusion", "misty-step", "prestidigitation", "shatter", "thunderwave"
    ]);
    expect(spells.get("fire-bolt")?.alwaysPrepared).toBe(true); // class cantrip
    expect(spells.get("prestidigitation")?.alwaysPrepared).toBe(true); // High Elf lineage grant
    expect(spells.get("magic-missile")).toMatchObject({ level: 1, prepared: true, alwaysPrepared: false, classId: "wizard" });
    expect(spells.get("shatter")).toMatchObject({ level: 2, prepared: true }); // savant pick, outside the prepared cap
  });

  it("marks Scholar expertise on a proficient skill and folds species + background proficiencies", () => {
    const skills = new Map(definition.proficiencies?.skills.map((skill) => [skill.id, skill.proficiency]));
    expect([...skills.keys()].sort()).toEqual(["arcana", "history", "insight", "investigation", "perception"]);
    expect(skills.get("arcana")).toBe("expertise");
    expect(definition.proficiencies?.saves).toEqual(["int", "wis"]);
    expect(definition.proficiencies?.tools).toEqual(["calligraphers-supplies"]);
    expect(definition.proficiencies?.languages).toEqual(["common", "elvish"]);
    expect(definition.character?.race).toEqual({ id: "elf", name: "Elf", subrace: { id: "high-elf", name: "High Elf" } });
  });

  it("merges overlapping starting-equipment items instead of duplicating rows", () => {
    const quarterstaff = (definition.startingInventory ?? []).find((item) => item.id === "quarterstaff");
    expect(quarterstaff?.quantity).toBe(2); // one from wizard-a, one from sage-a
    expect(definition.startingCurrency?.gp).toBe(13);
  });

  it("seeds a live actor whose slot pools and prepared list follow the assembled sheet", () => {
    const state = emptyState();
    importActorDefinition(state, definition, ACTOR_ID, "public");
    const actor = state.actors[0];
    expect(actor.spellSlots).toEqual([{ level: 1, remaining: 4 }, { level: 2, remaining: 2 }]);
    expect(actor.hitDice).toMatchObject({ die: "d6", maximum: 3, remaining: 3 });
    expect([...actor.preparedSpellIds].sort()).toEqual([
      "dancing-lights", "detect-magic", "fire-bolt", "light", "mage-armor", "mage-hand",
      "magic-missile", "minor-illusion", "misty-step", "prestidigitation", "shatter", "thunderwave"
    ]);
  });
});

describe("buildCharacterDefinition - loud rejections", () => {
  it("rejects unknown identity ids", () => {
    expect(() => buildCharacterDefinition({ ...fighterInput(), speciesId: "gnoll" }, library, defaultPolicy)).toThrowError(/No species "gnoll"/);
    expect(() => buildCharacterDefinition({ ...fighterInput(), backgroundId: "pirate" }, library, defaultPolicy)).toThrowError(/No background "pirate"/);
    expect(() => buildCharacterDefinition({ ...fighterInput(), classId: "warlord" }, library, defaultPolicy)).toThrowError(/No class "warlord"/);
    expect(() => buildCharacterDefinition({ ...fighterInput(), subclassId: "banneret" }, library, defaultPolicy)).toThrowError(/No subclass "banneret"/);
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
    expect(() => buildCharacterDefinition(over, library, defaultPolicy)).toThrowError(/exceeds what this build may choose/);
    const underfilled = wizardInput();
    underfilled.choices = underfilled.choices.filter((row) => row.kind !== "expertise");
    expect(() => buildCharacterDefinition(underfilled, library, defaultPolicy)).toThrowError(/"Scholar" needs 1 pick/);
  });

  it("rejects spells that are off-list, over the slot level, or beyond the prepared cap", () => {
    const offList = wizardInput();
    offList.choices.push({ level: 1, kind: "spell", id: "cure-wounds" });
    expect(() => buildCharacterDefinition(offList, library, defaultPolicy)).toThrowError(/not on the Wizard spell list/);
    const overCap = wizardInput();
    overCap.choices.push({ level: 1, kind: "spell", id: "shield" }, { level: 1, kind: "spell", id: "sleep" }, { level: 1, kind: "spell", id: "burning-hands" });
    expect(() => buildCharacterDefinition(overCap, library, defaultPolicy)).toThrowError(/prepares 6 spells at level 3; got 7/);
    const overLevel = wizardInput();
    overLevel.choices = overLevel.choices.filter((row) => row.id !== "misty-step");
    overLevel.choices.push({ level: 3, kind: "spell", id: "fireball" });
    expect(() => buildCharacterDefinition(overLevel, library, defaultPolicy)).toThrowError(/above the highest slot level/);
  });

  it("rejects hit-point entries outside [1, die] and a wrong entry count", () => {
    const outOfRange = fighterInput();
    outOfRange.hp = { mode: "entries", entries: [1, 10, 4, 11] };
    expect(() => buildCharacterDefinition(outOfRange, library, defaultPolicy)).toThrowError(/d10 hit-point roll must be 1-10; got 11/);
    const wrongCount = fighterInput();
    wrongCount.hp = { mode: "entries", entries: [5, 5] };
    expect(() => buildCharacterDefinition(wrongCount, library, defaultPolicy)).toThrowError(/exactly 4 entries/);
  });

  it("rejects scores that break the chosen method, and methods the policy does not allow", () => {
    const badArray = fighterInput();
    badArray.baseScores = { ...badArray.baseScores, str: 18 };
    expect(() => buildCharacterDefinition(badArray, library, defaultPolicy)).toThrowError(/Standard-array scores must be exactly/);
    const restrictive = BuilderPolicySchema.parse({ allowedAbilityMethods: ["point-buy"] });
    expect(() => buildCharacterDefinition(fighterInput(), library, restrictive)).toThrowError(/does not allow the "standard-array"/);
    const customWithoutFormula = BuilderPolicySchema.parse({ allowedAbilityMethods: ["custom"] });
    expect(() => buildCharacterDefinition({ ...fighterInput(), abilityMethod: "custom" }, library, customWithoutFormula)).toThrowError(/configure a formula/);
  });

  it("rejects an illegal background spread and a ledger row above the character's level", () => {
    const badSpread = fighterInput();
    badSpread.backgroundBonusAllocation = [{ ability: "str", amount: 2 }, { ability: "con", amount: 2 }];
    expect(() => buildCharacterDefinition(badSpread, library, defaultPolicy)).toThrowError(/allows \+2\/\+1 or \+1\/\+1\/\+1/);
    const wrongAbility = fighterInput();
    wrongAbility.backgroundBonusAllocation = [{ ability: "cha", amount: 2 }, { ability: "con", amount: 1 }];
    expect(() => buildCharacterDefinition(wrongAbility, library, defaultPolicy)).toThrowError(/increases STR\/DEX\/CON, not CHA/);
    const aboveLevel = fighterInput();
    aboveLevel.choices.push({ level: 6, kind: "skill", id: "history" });
    expect(() => buildCharacterDefinition(aboveLevel, library, defaultPolicy)).toThrowError(/above the character's level/);
  });

  it("rejects ASI increases past 20 and malformed increase payloads", () => {
    const past20 = fighterInput();
    past20.baseScores = { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 };
    // str 15 + 2 (background) = 17, then two catalog picks -> 19; cap holds. Use the shorthand to push past 20.
    past20.choices = past20.choices.filter((row) => row.kind !== "asi-or-feat" && row.kind !== "ability-score");
    past20.choices.push({ level: 4, classId: "fighter", kind: "asi-or-feat", id: "asi", payload: { increases: [{ ability: "str", amount: 2 }, { ability: "str", amount: 2 }] } });
    expect(() => buildCharacterDefinition(past20, library, defaultPolicy)).toThrowError(/cannot raise a score above 20|exactly \+2/);
    const malformed = fighterInput();
    malformed.choices = malformed.choices.filter((row) => row.kind !== "asi-or-feat" && row.kind !== "ability-score");
    malformed.choices.push({ level: 4, classId: "fighter", kind: "asi-or-feat", id: "asi" });
    expect(() => buildCharacterDefinition(malformed, library, defaultPolicy)).toThrowError(/payload.increases/);
  });
});

// =================================================================================================
// Phase-2 rules regressions. Each block pins ONE adversarial-QA finding; the comment on each names
// the wrong behaviour it replaces, so a revert fails here loudly rather than shipping quietly.
// =================================================================================================

/** The real library with one accessor swapped, so a malformed content SHAPE can be exercised without touching the bundles. */
function libraryWith(overrides: Partial<ContentLibrary>): ContentLibrary {
  return Object.assign(Object.create(library) as ContentLibrary, overrides);
}

const clericInput = (): CharacterCreateRequestInput & { choices: Array<CharacterCreateRequestInput["choices"][number]> } => ({
  name: "Sister Ael",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "cleric",
  level: 3,
  subclassId: "life-domain",
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 12, con: 14, int: 10, wis: 15, cha: 13 },
  backgroundBonusAllocation: [{ ability: "wis", amount: 2 }, { ability: "cha", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "cleric", kind: "skill", id: "history" },
    { level: 1, classId: "cleric", kind: "skill", id: "medicine" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, classId: "cleric", kind: "divine-order", id: "protector" },
    // The Acolyte's origin feat (Magic Initiate (Cleric)) asks for two cantrips of its own.
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "resistance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "light" },
    { level: 1, kind: "cantrip", id: "sacred-flame" },
    { level: 1, kind: "cantrip", id: "spare-the-dying" },
    { level: 3, classId: "cleric", kind: "subclass", id: "life-domain" },
    // SEVEN prepared rows against a cap of 6 - legal only because one of them (cure-wounds) is a
    // Life Domain spell the subclass already grants as always-prepared.
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

describe("M4 - always-prepared grants are not charged to the prepared count", () => {
  const definition = buildCharacterDefinition(clericInput(), library, defaultPolicy);
  const spells = new Map((definition.spellcasting?.spells ?? []).map((spell) => [spell.id, spell]));

  it("keeps a Life Domain spell the player ALSO prepared as the grant's always-prepared form", () => {
    // The bug: grants were appended last and skipped when the id was already present, so a domain
    // spell the player also listed stayed `alwaysPrepared: false` - a downgrade - AND spent one of
    // the six prepared slots on a spell that is free by the rules.
    expect(spells.get("cure-wounds")).toMatchObject({ level: 1, prepared: true, alwaysPrepared: true });
    expect(spells.get("cure-wounds")).not.toHaveProperty("classId"); // the grant's entry, not a class pick
    for (const domainSpell of ["aid", "bless", "cure-wounds", "lesser-restoration"]) {
      expect(spells.get(domainSpell)?.alwaysPrepared, domainSpell).toBe(true);
    }
  });

  it("charges exactly the six spells that are not granted against the level-3 cap", () => {
    // Six charged picks + one that deferred to the grant = the seven authored rows.
    const charged = (definition.spellcasting?.spells ?? []).filter((spell) => spell.level > 0 && !spell.alwaysPrepared);
    expect(charged.map((spell) => spell.id).sort())
      .toEqual(["guiding-bolt", "healing-word", "hold-person", "prayer-of-healing", "shield-of-faith", "spiritual-weapon"]);
    expect(definition.spellcasting?.classes?.[0]).toMatchObject({ classId: "cleric", prepared: 6 });
    // One more genuinely-charged pick DOES exceed the cap - the exclusion is scoped to grants, not a blanket bypass.
    const overCap = clericInput();
    overCap.choices.push({ level: 1, kind: "spell", id: "bane" });
    expect(() => buildCharacterDefinition(overCap, library, defaultPolicy)).toThrowError(/prepares 6 spells at level 3; got 7/);
  });

  it("still rejects the same spell recorded twice", () => {
    const twice = clericInput();
    twice.choices.push({ level: 1, kind: "spell", id: "cure-wounds" });
    expect(() => buildCharacterDefinition(twice, library, defaultPolicy)).toThrowError(/"cure-wounds" is chosen twice/);
  });

  it("interprets the chosen Divine Order option's OWN riders (per-option mechanics)", () => {
    // Protector grants Martial weapon training and Heavy armour training. Before options carried
    // mechanics the pick was validated, written to the ledger, and then discarded.
    expect(definition.proficiencies?.armor).toContain("heavy");
    expect(definition.proficiencies?.weapons).toContain("martial");
    const traits = (definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map((trait) => trait.name);
    expect(traits).toContain("Protector");
  });

  it("gives Thaumaturge's own cantrip pick an offer OUTSIDE the class cantrip budget", () => {
    const thaumaturge = clericInput();
    thaumaturge.choices = thaumaturge.choices.map((row) => row.kind === "divine-order" ? { ...row, id: "thaumaturge" } : row);
    // The option's second-order pick, tagged with the option's own id...
    thaumaturge.choices.push({ level: 1, kind: "cantrip", id: "mending", payload: { featureId: "thaumaturge" } });
    const built = buildCharacterDefinition(thaumaturge, library, defaultPolicy);
    expect((built.spellcasting?.spells ?? []).some((spell) => spell.id === "mending")).toBe(true);
    expect(built.proficiencies?.armor).not.toContain("heavy"); // the other role's grant does NOT apply
    // ...or with the parent feature's id, which is just as unambiguous.
    const viaParent = clericInput();
    viaParent.choices = viaParent.choices.map((row) => row.kind === "divine-order" ? { ...row, id: "thaumaturge" } : row);
    viaParent.choices.push({ level: 1, kind: "cantrip", id: "mending", payload: { featureId: "divine-order" } });
    expect((buildCharacterDefinition(viaParent, library, defaultPolicy).spellcasting?.spells ?? []).some((spell) => spell.id === "mending")).toBe(true);
    // Omitting the option's pick entirely is still a loud, actionable rejection.
    const missing = clericInput();
    missing.choices = missing.choices.map((row) => row.kind === "divine-order" ? { ...row, id: "thaumaturge" } : row);
    expect(() => buildCharacterDefinition(missing, library, defaultPolicy)).toThrowError(/"Thaumaturge" needs 1 pick\(s\) of kind "cantrip"/);
  });
});

describe("M3 - the same feat cannot be taken twice across different offers", () => {
  it("rejects a Versatile pick that repeats the background's origin feat", () => {
    // A Human Acolyte already holds Magic Initiate (Cleric) from the background. Taking it AGAIN
    // with the Human's Versatile feat interpreted the whole feature twice: two cantrip offers of two
    // picks each, so the sheet ended up with 7 cantrips instead of 5.
    const duplicate = clericInput();
    duplicate.choices = duplicate.choices.map((row) => row.kind === "feat" ? { ...row, id: "magic-initiate-cleric" } : row);
    expect(() => buildCharacterDefinition(duplicate, library, defaultPolicy))
      .toThrowError(/Magic Initiate \(Cleric\) may be taken again only with a DIFFERENT spell list/);
  });

  it("rejects a duplicate of a feat that is not repeatable at all", () => {
    // The Criminal background grants Alert; spending Versatile on Alert again is simply illegal.
    const duplicate = clericInput();
    duplicate.backgroundId = "criminal";
    duplicate.backgroundBonusAllocation = [{ ability: "dex", amount: 2 }, { ability: "con", amount: 1 }];
    duplicate.choices = duplicate.choices.map((row) => row.kind === "equipment" && row.id === "acolyte-a" ? { ...row, id: "criminal-a" } : row);
    // The Criminal's origin feat is Alert, and the ledger already spends Versatile on Alert.
    expect(() => buildCharacterDefinition(duplicate, library, defaultPolicy))
      .toThrowError(/Alert is already on this character - a feat can only be taken once/);
  });

  it("still allows a repeatable feat with a DIFFERENT spell list, and the ASI feat at every ASI level", () => {
    // Positive control 1: Magic Initiate (Wizard) alongside the background's Magic Initiate (Cleric).
    const differentList = clericInput();
    differentList.choices = differentList.choices.map((row) => row.kind === "feat" ? { ...row, id: "magic-initiate-wizard" } : row);
    differentList.choices.push(
      { level: 1, kind: "cantrip", id: "fire-bolt", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "prestidigitation", payload: { featureId: "magic-initiate-wizard" } }
    );
    const built = buildCharacterDefinition(differentList, library, defaultPolicy);
    // The Versatile pick REPLACED Alert here, so the sheet holds the background's Cleric flavour
    // plus the Wizard one - the same feat name, a different spell list, exactly as the SRD allows.
    expect(built.character?.feats.map((feat) => feat.id).sort()).toEqual(["magic-initiate-cleric", "magic-initiate-wizard"]);

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

describe("M7 - a feature whose only rider is limited USES still lands as a trackable action", () => {
  const definition = buildCharacterDefinition(fighterInput(), library, defaultPolicy);

  it("synthesizes an activation carrying the resolved use count", () => {
    // `interpretAction` was the only consumer of `feature.uses`, so 20 authored features that print
    // a use count but no action (Action Surge, Indomitable, Arcane Recovery, Divine Intervention,
    // Relentless Endurance, the tiefling legacy tiers...) were prose with no trackable pool at all.
    const actionSurge = definition.actions.find((action) => action.id === "action-surge");
    expect(actionSurge).toBeDefined();
    expect(actionSurge?.activation).toBe("other");
    expect(actionSurge?.uses).toEqual({ limit: 1, per: "short-rest" }); // by-level table, 1 until level 17
    // The Soldier's origin feat is uses-only too, on a different rest scope.
    expect(definition.actions.find((action) => action.id === "savage-attacker")?.uses).toEqual({ limit: 1, per: "turn" });
  });

  it("makes that action resolvable, so the counter can actually be spent", () => {
    // A counter nothing can decrement is decoration. `resolveDefinitionAction` used to reject any
    // action with no attack/save/damage/grants as "no structured effect to resolve" - spending a
    // limited use IS the structured effect, and a self-only feature needs no target.
    const state = emptyState();
    importActorDefinition(state, definition, ACTOR_ID, "public");
    const other = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d11";
    state.actors.push({ ...state.actors[0], id: other, name: "Sparring Partner", definitionId: null });
    startEncounter(state, { mapAssetId: "20000000-0000-5000-8000-000000000001", entries: [{ actorId: other, score: 20 }, { actorId: ACTOR_ID, score: 5 }] }, () => 1, { width: 900, height: 600, calibration: null });
    const surge = definition.actions.find((action) => action.id === "action-surge")!;
    const deps: ResolveDependencies = { random: () => 1, newRollId: () => "40000000-0000-4000-8000-000000000001", gmSessionId: "30000000-0000-4000-8000-00000000000a", now: () => "2026-07-27T00:00:00.000Z", definition };
    resolveDefinitionAction(state, surge, { actorId: ACTOR_ID, targetIds: [], commandId: "50000000-0000-4000-8000-000000000001" }, deps);
    expect(state.actors[0].actionUses["action-surge"]).toBe(1);
    // ...and the second attempt is correctly refused, because the pool really is 1/short rest.
    expect(() => resolveDefinitionAction(state, surge, { actorId: ACTOR_ID, targetIds: [], commandId: "50000000-0000-4000-8000-000000000002" }, deps))
      .toThrowError(/no uses remaining \(1\/short rest\)/);
  });
});

describe("M5 - an action that shares a pool is gated on the POOL's size", () => {
  const definition = buildCharacterDefinition(clericInput(), library, defaultPolicy);
  const CLERIC = ACTOR_ID;
  const FOE = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d12";

  function encounter(): GameState {
    const state = emptyState();
    importActorDefinition(state, definition, CLERIC, "public");
    state.actors.push({ ...state.actors[0], id: FOE, name: "Ghoul", kind: "monster", definitionId: null, actionUses: {} });
    // The FOE holds the turn, so the action-economy slot never masks the limited-use gate.
    startEncounter(state, { mapAssetId: "20000000-0000-5000-8000-000000000001", entries: [{ actorId: FOE, score: 20 }, { actorId: CLERIC, score: 5 }] }, () => 1, { width: 900, height: 600, calibration: null });
    return state;
  }
  const deps = (): ResolveDependencies => ({ random: () => 3, newRollId: () => `40000000-0000-4000-8000-00000000000${Math.floor(Math.random() * 9)}`, gmSessionId: "30000000-0000-4000-8000-00000000000a", now: () => "2026-07-27T00:00:00.000Z", definition });

  it("authors Preserve Life and Divine Spark onto one Channel Divinity counter", () => {
    const preserveLife = definition.actions.find((action) => action.id === "preserve-life");
    const divineSpark = definition.actions.find((action) => action.id === "divine-spark");
    expect(preserveLife?.uses).toMatchObject({ pool: "channel-divinity", limit: 1 });
    expect(divineSpark?.uses).toMatchObject({ pool: "channel-divinity", limit: 2 }); // 2 charges at Cleric 3
  });

  it("lets a Cleric 3 use Preserve Life after a Divine Spark, then blocks the third", () => {
    // The bug: the counter is keyed on the POOL ("channel-divinity") but the gate read the ACTION's
    // own limit, so Preserve Life (printed "1") reported no uses left the moment any sibling had
    // spent one - a Cleric 3 lost half their Channel Divinity.
    const state = encounter();
    const spark = definition.actions.find((action) => action.id === "divine-spark")!;
    const preserve = definition.actions.find((action) => action.id === "preserve-life")!;
    resolveDefinitionAction(state, spark, { actorId: CLERIC, targetIds: [FOE], commandId: "50000000-0000-4000-8000-00000000000a" }, deps());
    expect(state.actors[0].actionUses["channel-divinity"]).toBe(1);
    resolveDefinitionAction(state, preserve, { actorId: CLERIC, targetIds: [], commandId: "50000000-0000-4000-8000-00000000000b" }, deps());
    expect(state.actors[0].actionUses["channel-divinity"]).toBe(2);
    // Both charges spent: the third attempt is refused, naming the POOL's size, not "1".
    expect(() => resolveDefinitionAction(state, preserve, { actorId: CLERIC, targetIds: [], commandId: "50000000-0000-4000-8000-00000000000c" }, deps()))
      .toThrowError(/no uses remaining \(2\/long rest\)/);
  });
});

describe("D3 - a malformed content record rejects instead of throwing a raw TypeError", () => {
  const malformedLibrary = libraryWith({
    speciesRecord: (id: string) => {
      const real = library.speciesRecord(id);
      if (!real || id !== "human") return real;
      return { ...real, traits: [...real.traits, {
        id: "broken-boon", name: "Broken Boon", description: "A boon whose option list was never authored.",
        tags: [], actions: [], effects: [], modifiers: [],
        // `{kind, choose, from: []}` used to PARSE (an empty array is truthy, so the schema's
        // "needs from OR fromCatalog" refinement never fired) and then hand `undefined` to
        // resolveCatalogChoice - a TypeError, which is neither a CatalogChoiceError nor a
        // CommandRejectedError, so the socket handler echoed the internal message to the client.
        choice: { kind: "boon", choose: 1, from: [], repeatable: false }
      }] };
    }
  });

  it("rejects with an actionable message, as a CommandRejectedError", () => {
    let thrown: unknown;
    try { buildCharacterDefinition(fighterInput(), malformedLibrary, defaultPolicy); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(CommandRejectedError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/"Broken Boon" offers a "boon" choice with no options/);
    expect((thrown as Error).message).toMatch(/needs a non-empty "from" list or a "fromCatalog" slug/);
  });
});

describe("D5 - multiclass prerequisites are correct but deliberately uncalled in phase 2", () => {
  it("cannot gate anything yet: `character.create` carries exactly one class", () => {
    // The wire shape is the whole argument - one `classId`, one `level`. SRD ability minimums attach
    // to TAKING A SECOND CLASS, never to a starting class, so enforcing them here would reject legal
    // level-1 characters. This test is the pin: when the request grows a second class entry (packet
    // phase 6, level-up), it fails and the check has to be wired in.
    const input = fighterInput();
    expect(Object.keys(input)).toContain("classId");
    expect(Object.keys(input)).not.toContain("classes");
    const built = buildCharacterDefinition(input, library, defaultPolicy);
    expect(built.character?.classes).toHaveLength(1);
    // A Fighter needs STR 13 or DEX 13 to MULTICLASS into. This sheet has STR 19 - but a character
    // who did not would still be a perfectly legal starting Fighter, which is why creation is silent.
    expect(meetsMulticlassPrerequisites({ str: 8, dex: 8 }, "fighter")).toBe(false);
    expect(meetsMulticlassPrerequisites({ str: 8, dex: 13 }, "fighter")).toBe(true); // mode "any"
    expect(meetsMulticlassPrerequisites({ dex: 13 }, "monk")).toBe(false); // mode "all": needs WIS 13 too
    expect(meetsMulticlassPrerequisites({ dex: 13, wis: 13 }, "monk")).toBe(true);
    expect(meetsMulticlassPrerequisites({}, "moon-warden")).toBe(true); // unknown/homebrew: no declared minimum
    // And the authored bundle drives it, not just the static table (the class record's own minimums).
    expect(meetsMulticlassPrerequisites({ wis: 12 }, "cleric", library.classProgressionTable())).toBe(false);
    expect(meetsMulticlassPrerequisites({ wis: 13 }, "cleric", library.classProgressionTable())).toBe(true);
  });
});

describe("buildCharacterDefinition - Warlock 5 (Pact Magic)", () => {
  // Pact Magic is the one caster shape that is NOT a sparse nine-column row, and until the Warlock
  // was authored no class exercised it - the assembly read `spellSlots` only, so a Warlock came out
  // with a caster block and zero slots. This pins the shape rather than the fix.
  const warlockInput = (): CharacterCreateRequestInput & { choices: Array<CharacterCreateRequestInput["choices"][number]> } => ({
    name: "Vex",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "warlock",
    level: 5,
    subclassId: "fiend-patron",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [{ ability: "con", amount: 2 }, { ability: "dex", amount: 1 }],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "skill", id: "acrobatics", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "size", id: "small" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
      { level: 1, classId: "warlock", kind: "skill", id: "deception" },
      { level: 1, classId: "warlock", kind: "eldritch-invocation", id: "agonizing-blast", payload: { featureId: "eldritch-invocations" } },
      { level: 3, classId: "warlock", kind: "subclass", id: "fiend-patron", payload: { featureId: "warlock-subclass" } },
      { level: 4, classId: "warlock", kind: "asi-or-feat", id: "ability-score-improvement", payload: { featureId: "ability-score-improvement" } },
      { level: 4, classId: "warlock", kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
      { level: 4, classId: "warlock", kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } },
      { level: 1, classId: "warlock", kind: "cantrip", id: "chill-touch" },
      { level: 1, classId: "warlock", kind: "cantrip", id: "eldritch-blast" },
      { level: 1, classId: "warlock", kind: "cantrip", id: "mage-hand" },
      { level: 1, classId: "warlock", kind: "equipment", id: "warlock-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  });

  it("gives a Warlock its Pact Magic slots - all at one level, not a sparse row", () => {
    const definition = buildCharacterDefinition(warlockInput(), library, defaultPolicy);
    // SRD: a Warlock 5 has TWO level-3 slots and no level-1 or level-2 slots at all.
    expect(definition.spellcasting?.slots).toEqual([{ level: 3, max: 2 }]);
    expect(definition.spellcasting?.ability).toBe("cha");
    expect(definition.hitPoints.maximum).toBe(38); // d8: 8 + 4x5, then +2 Con x5
  });

  it("counts Warlock levels as pact progression, not full", () => {
    expect(library.classProgressionTable().warlock.casterProgression).toBe("pact");
  });
});
