import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, resolveSpellcasting, type GameState } from "@vtt/domain";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";

/**
 * End-to-end `character.create` assembly against the REAL content bundles: a Fighter 5 and a
 * Wizard 3 built from choices, asserting the numbers the packet names (HP, AC, saves, skills,
 * slots, prepared list, rider-derived actions, hit-dice pool, the `import-<actorId>` keying), plus
 * the loud-rejection paths (unknown ids, over-cap prepared spells, invalid HP entries, policy).
 */

const library = new ContentLibrary();
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

  it("derives AC from the equipped starting armor via the shared rules function", () => {
    expect(definition.armorClass).toBe(16); // chain mail, no Dex
    const chainMail = definition.startingInventory?.find((item) => item.id === "chain-mail");
    expect(chainMail?.equipped).toBe(true);
    expect(chainMail?.armor?.acBase).toBe(16);
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
    expect(actor.armorClass).toBe(16); // instantiate's own armorClassFromEquipment agrees with the builder's
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
