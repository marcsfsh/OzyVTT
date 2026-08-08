import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { answerReaction } from "../src/reactions.js";
import { setCondition } from "../src/actor-conditions.js";
import { startEncounter } from "../src/encounter.js";
import type { ActorDefinition } from "@vtt/schemas";

/**
 * STAGE 4, LANE B2 - Rogue, Ranger and Paladin mechanics, proved at the far end.
 *
 * Every assertion below is a number that was rolled, a counter that was spent, a build that was
 * refused, or text the table actually reads. "The rider survived derivation" is deliberately never
 * the claim: issue `2e` shipped thirteen rider variants that parsed, typechecked and did nothing,
 * and this file exists so that cannot happen again one class at a time.
 *
 * These run against the REAL SRD bundles rather than a homebrew fixture, because the thing under
 * test IS the authored content: a fixture would prove the engine works and say nothing about
 * whether `rogue.ts` is right. `feature-riders.test.ts` is the fixture-side sibling.
 */

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
/** Every command here is the GM's; a player scope would be a different test (see `authorization.test.ts`). */
const GM_SCOPE = { role: "gm" } as const;

type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & {
  choices: Array<CharacterCreateRequestInput["choices"][number]>;
  backgroundBonusAllocation: Array<{ ability: CharacterCreateRequestInput["backgroundBonusAllocation"][number]["ability"]; amount: number }>;
};

type Table = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor; foe: Actor; catalog: ReturnType<typeof equipmentCatalogOf> }>;

/** Build the sheet through the REAL builder, put it on a table, and start a fight. */
function table(input: MutableInput, foeHp = 60): Table {
  const definition = buildCharacterDefinition(input, library, policy);
  const catalog = equipmentCatalogOf(library);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: foeHp, maximum: foeHp }, armorClass: 10 }]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return {
    definition, state, catalog,
    hero: state.actors.find((actor) => actor.id === IDS.hero)!,
    foe: state.actors.find((actor) => actor.id === IDS.foe)!
  };
}

let commandSeed = 0;
const nextCommandId = () => `50000000-0000-4000-8000-${String(commandSeed += 1).padStart(12, "0")}`;

function deps(built: Table, faces: number[]): ResolveDependencies {
  let rollSeed = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-${String(rollSeed += 1).padStart(12, "0")}`,
    gmSessionId: IDS.gm, now: () => "2026-08-07T00:00:00.000Z",
    definition: built.definition, catalog: built.catalog,
    resolveDefinition: (id: string) => resolveIn(built.state, id)
  };
}

/** The table's own definition store - `importActorDefinition` keys it `import-<actorId>`, not by the record's id. */
const resolveIn = (state: GameState, id: string) => state.definitions.find((entry) => entry.id === id)?.definition;

const actionOf = (built: Table, id: string) => effectiveActions(built.definition, built.hero, built.catalog).find((entry) => entry.id === id);
const resolve = (built: Table, id: string, faces: number[], targetIds: string[] = [IDS.foe]) =>
  resolveDefinitionAction(built.state, actionOf(built, id)!, { actorId: IDS.hero, targetIds, commandId: nextCommandId() }, deps(built, faces));

/**
 * A fresh turn. A long-rest pool is spent across many turns, and the ACTION ECONOMY is per turn -
 * so draining a pool of four has to happen over four turns or the second use is blocked by the
 * economy rather than by the pool, which would prove the wrong thing.
 */
function newTurn(built: Table): void {
  built.state.combat = {
    ...built.state.combat,
    turn: { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 }
  };
}

/** Spend one use of a pool on its own turn. */
const spend = (built: Table, id: string) => { newTurn(built); return resolve(built, id, [], []); };

// =================================================================================================
// ROGUE
// =================================================================================================

/**
 * A Halfling Criminal Rogue. Halfling is the species with no build choices at all and Criminal's
 * origin feat (Alert) asks for none either, so every choice row below belongs to the ROGUE - which
 * keeps the "the build is refused without this row" assertions unambiguous.
 */
const rogueInput = (level: number): MutableInput => {
  const asiLevels = [4, 8, 10, 12, 16].filter((asi) => asi <= level);
  const expertiseLevels = [1, 6].filter((entry) => entry <= level);
  return {
    name: "Nim", speciesId: "halfling", backgroundId: "criminal", classId: "rogue", level,
    ...(level >= 3 ? { subclassId: "thief" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
    backgroundBonusAllocation: [{ ability: "dex", amount: 2 }, { ability: "con", amount: 1 }],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      // THIEVES' CANT raises `species-languages` by one (audit row 62): a Rogue is offered THREE
      // languages where the printed species budget offers two.
      { level: 1, kind: "language", id: "goblin" },
      { level: 1, classId: "rogue", kind: "skill", id: "acrobatics" },
      { level: 1, classId: "rogue", kind: "skill", id: "investigation" },
      { level: 1, classId: "rogue", kind: "skill", id: "perception" },
      { level: 1, classId: "rogue", kind: "skill", id: "deception" },
      { level: 1, classId: "rogue", kind: "weapon-mastery", id: "dagger" },
      { level: 1, classId: "rogue", kind: "weapon-mastery", id: "shortbow" },
      ...expertiseLevels.flatMap((entry) => entry === 1
        ? [{ level: 1, classId: "rogue", kind: "expertise", id: "stealth" }, { level: 1, classId: "rogue", kind: "expertise", id: "sleight-of-hand" }]
        : [{ level: 6, classId: "rogue", kind: "expertise", id: "perception" }, { level: 6, classId: "rogue", kind: "expertise", id: "investigation" }]),
      ...(level >= 3 ? [{ level: 3, classId: "rogue", kind: "subclass", id: "thief" }] : []),
      ...asiLevels.flatMap((asi) => [
        { level: asi, classId: "rogue", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: asi, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } },
        { level: asi, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } }
      ]),
      ...(level >= 19 ? [
        { level: 19, classId: "rogue", kind: "feat", id: "boon-of-irresistible-offense", payload: { featureId: "epic-boon" } },
        { level: 19, kind: "ability-score", id: "dex", payload: { featureId: "boon-of-irresistible-offense" } }
      ] : []),
      { level: 1, kind: "equipment", id: "rogue-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ] as MutableInput["choices"]
  };
};

describe("Rogue - Sneak Attack rolls the printed column", () => {
  it("rolls 6d6 at level 11 and 1d6 at level 1, off ONE record", () => {
    // `damageByLevel` keeps the highest row at or below the character's level. The far end is the
    // rolled total, not the array: six stubbed 4s is 24, and the same record on a level-1 Rogue
    // rolls one die. If the level filter were dropped this would roll 10d6 at both levels.
    const eleven = table(rogueInput(11));
    const rolled = resolve(eleven, "sneak-attack", [4, 4, 4, 4, 4, 4], []);
    expect(rolled.damage).toEqual([{ formula: "6d6", type: "weapon", total: 24 }]);

    const first = table(rogueInput(1));
    expect(resolve(first, "sneak-attack", [5], []).damage).toEqual([{ formula: "1d6", type: "weapon", total: 5 }]);
  });

  it("refuses a SECOND Sneak Attack in the same turn, and the counter says so", () => {
    // "Once per turn" is a `per: "turn"` pool counted in `combat.turn.turnUses`, not prose. The
    // refusal is what makes the first roll mean anything.
    const built = table(rogueInput(11));
    resolve(built, "sneak-attack", [1, 1, 1, 1, 1, 1], []);
    expect(built.state.combat.turn.turnUses[`${IDS.hero}:sneak-attack`]).toBe(1);
    expect(() => resolve(built, "sneak-attack", [1, 1, 1, 1, 1, 1], []))
      .toThrowError(/Sneak Attack: no uses remaining \(1\/turn\)/);
    // ...and nothing was spent by the refusal.
    expect(built.state.combat.turn.turnUses[`${IDS.hero}:sneak-attack`]).toBe(1);
  });
});

describe("Rogue - Uncanny Dodge halves the damage that hit", () => {
  it("parks the attack's damage on a reaction prompt and halves it when used", () => {
    // The far end of `reaction: {trigger: "hit-by-attack", response: "half-damage"}`: the foe hits
    // the Rogue, the resolver offers the prompt, and answering it applies HALF. Without the authored
    // reaction there is no prompt at all and full damage lands (asserted below).
    const built = table(rogueInput(11));
    const bite = {
      id: "bite", name: "Bite", activation: "action" as const,
      description: "A bite.", damage: [{ formula: "2d6", type: "piercing" }],
      attack: { bonus: 20 }
    };
    const before = built.hero.hp.current;
    const hit = resolveDefinitionAction(built.state, bite, { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextCommandId() },
      { ...deps(built, [18, 5, 5]), definition: undefined });
    expect(hit.attack?.outcome).toBe("hit");
    const pending = built.state.combat.pendingReactions;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "hit-by-attack", actionName: "Uncanny Dodge", proposedDamage: 10 });

    const outcome = answerReaction(built.state, nextCommandId(), pending[0].id, true, undefined, GM_SCOPE, {
      random: () => 1, newRollId: () => "40000000-0000-4000-8000-0000000000ff",
      gmSessionId: IDS.gm, now: () => "2026-08-07T00:00:00.000Z", catalog: built.catalog,
      resolveDefinition: (id: string) => resolveIn(built.state, id)
    });
    expect(outcome.appliedDamage).toBe(5); // 10 halved, floor, before defenses
    expect(built.hero.hp.current).toBe(before - 5);
  });

  it("offers NO prompt to a level-4 Rogue, who has not gained the feature", () => {
    // The negative control that makes the assertion above about the AUTHORED record rather than
    // about the engine: Uncanny Dodge is a level-5 feature.
    const built = table(rogueInput(4));
    const bite = {
      id: "bite", name: "Bite", activation: "action" as const,
      description: "A bite.", damage: [{ formula: "2d6", type: "piercing" }], attack: { bonus: 20 }
    };
    resolveDefinitionAction(built.state, bite, { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextCommandId() },
      { ...deps(built, [18, 5, 5]), definition: undefined });
    expect(built.state.combat.pendingReactions).toEqual([]);
  });
});

describe("Rogue - the flat grants and the pick", () => {
  it("puts Thieves' Cant on the sheet's languages", () => {
    expect(table(rogueInput(1)).definition.proficiencies?.languages).toContain("thieves-cant");
  });

  it("adds Wisdom and Charisma saves at level 15 and NOT at level 14", () => {
    // Slippery Mind is `grants.saves`, which lands in the one array every save on the sheet is
    // rolled from. The Rogue prints Dex and Int at level 1.
    const fifteen = table(rogueInput(15)).definition.proficiencies?.saves ?? [];
    expect([...fifteen].sort()).toEqual(["cha", "dex", "int", "wis"]);
    const fourteen = table(rogueInput(14)).definition.proficiencies?.saves ?? [];
    expect([...fourteen].sort()).toEqual(["dex", "int"]);
  });

  it("REFUSES a level-19 Rogue with no Epic Boon feat, and puts the chosen one on the sheet", () => {
    // Audit row 6. The record carried no `choice` at all, so the level-19 feat the text promises was
    // never offered - a silence, not an error. Now the build says so.
    const missing = rogueInput(19);
    missing.choices = missing.choices.filter((row) =>
      row.payload?.featureId !== "epic-boon" && row.payload?.featureId !== "boon-of-irresistible-offense");
    expect(() => buildCharacterDefinition(missing, library, policy))
      .toThrowError(/"Epic Boon" needs 1 pick\(s\) of kind "feat"/);
    expect(table(rogueInput(19)).definition.character?.feats?.map((feat) => feat.id))
      .toContain("boon-of-irresistible-offense");
  });

  it("spends Stroke of Luck's one use and refuses the second", () => {
    // A feature that prints a use count and no action gets a synthesised rollable, which is what
    // makes the pool real. The counter is the half a player has to track.
    const built = table(rogueInput(20));
    resolve(built, "stroke-of-luck", [], []);
    expect(built.hero.actionUses["stroke-of-luck"]).toBe(1);
    expect(() => resolve(built, "stroke-of-luck", [], []))
      .toThrowError(/Stroke Of Luck: no uses remaining \(1\/short rest\)/);
  });

  it("gives Steady Aim's Bonus Action a real Advantage effect", () => {
    const built = table(rogueInput(11));
    expect(actionOf(built, "steady-aim")?.activation).toBe("bonus-action");
    resolve(built, "steady-aim", [], []);
    const granted = built.hero.effects.find((effect) => effect.tags.includes("steady-aim"));
    expect(granted?.modifiers).toEqual([{ type: "roll-mode", roll: "attack", mode: "advantage", when: [], scope: undefined }]);
  });

  it("makes the Thief's Fast Hands a Bonus Action", () => {
    expect(actionOf(table(rogueInput(11)), "fast-hands")?.activation).toBe("bonus-action");
  });
});

// =================================================================================================
// RANGER
// =================================================================================================

/** The prepared-spell picks a half-caster owes at `level`, derived from the printed table. */
function preparedPicks(classId: string, level: number, granted: readonly string[]): string[] {
  const record = library.classRecord(classId)!;
  const row = record.levelTable[level - 1];
  const maxSlotLevel = (row.spellSlots ?? []).reduce((highest, count, index) => count > 0 ? index + 1 : highest, 0);
  const pool = library.spellSummaries()
    .filter((spell) => spell.classes.includes(record.spellcasting!.spellListId!) && spell.level >= 1 && spell.level <= maxSlotLevel && !granted.includes(spell.id))
    .map((spell) => spell.id);
  const owed = row.preparedCount ?? 0;
  if (pool.length < owed) throw new Error(`${classId} ${level} owes ${owed} prepared spells and the list offers ${pool.length}`);
  return pool.slice(0, owed);
}

/** A Halfling Criminal Ranger. `wisFocus` sends every ASI into Wisdom, which moves the ability-scaled pools. */
const rangerInput = (level: number, options: { wisFocus?: boolean } = {}): MutableInput => {
  const asiLevels = [4, 8, 12, 16].filter((asi) => asi <= level);
  const bumped = options.wisFocus ? "wis" : "dex";
  return {
    name: "Ash", speciesId: "halfling", backgroundId: "criminal", classId: "ranger", level,
    ...(level >= 3 ? { subclassId: "hunter" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 12, dex: 14, con: 13, int: 10, wis: 15, cha: 8 },
    backgroundBonusAllocation: [{ ability: "dex", amount: 2 }, { ability: "con", amount: 1 }],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      // DEFT EXPLORER raises `species-languages` by TWO from level 2 (audit row 61) - "you learn two
      // languages of your choice" - so a Ranger past level 1 is offered four, not two.
      ...(level >= 2
        ? [{ level: 2, kind: "language", id: "goblin" }, { level: 2, kind: "language", id: "orc" }]
        : []),
      { level: 1, classId: "ranger", kind: "skill", id: "survival" },
      { level: 1, classId: "ranger", kind: "skill", id: "perception" },
      { level: 1, classId: "ranger", kind: "skill", id: "nature" },
      { level: 1, classId: "ranger", kind: "weapon-mastery", id: "longbow" },
      { level: 1, classId: "ranger", kind: "weapon-mastery", id: "shortsword" },
      ...(level >= 2 ? [
        { level: 2, classId: "ranger", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
        { level: 2, classId: "ranger", kind: "expertise", id: "perception", payload: { featureId: "deft-explorer" } }
      ] : []),
      ...(level >= 3 ? [
        { level: 3, classId: "ranger", kind: "subclass", id: "hunter" },
        { level: 3, kind: "hunters-prey", id: "colossus-slayer", payload: { featureId: "hunters-prey" } }
      ] : []),
      ...(level >= 7 ? [{ level: 7, kind: "defensive-tactics", id: "escape-the-horde", payload: { featureId: "defensive-tactics" } }] : []),
      ...(level >= 9 ? [
        { level: 9, classId: "ranger", kind: "expertise", id: "survival", payload: { featureId: "expertise" } },
        { level: 9, classId: "ranger", kind: "expertise", id: "nature", payload: { featureId: "expertise" } }
      ] : []),
      ...asiLevels.flatMap((asi) => [
        { level: asi, classId: "ranger", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: asi, kind: "ability-score", id: bumped, payload: { featureId: "ability-score-improvement" } },
        { level: asi, kind: "ability-score", id: bumped, payload: { featureId: "ability-score-improvement" } }
      ]),
      ...(level >= 19 ? [
        { level: 19, classId: "ranger", kind: "feat", id: "boon-of-dimensional-travel", payload: { featureId: "epic-boon" } },
        { level: 19, kind: "ability-score", id: "con", payload: { featureId: "boon-of-dimensional-travel" } }
      ] : []),
      ...preparedPicks("ranger", level, ["hunters-mark"]).map((id) => ({ level: 1, kind: "spell" as const, id })),
      { level: 1, kind: "equipment", id: "ranger-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ] as MutableInput["choices"]
  };
};

describe("Ranger - Favored Enemy, audit row 32", () => {
  it("hands over Hunter's Mark ALWAYS prepared, without charging the prepared budget", () => {
    // The SRD's own rule: a feature-granted always-prepared spell "doesn't count against the number
    // of spells you can prepare". A level-5 Ranger prints 6 - so the sheet holds SEVEN spells and
    // reports the budget as 6.
    const built = table(rangerInput(5));
    const spells = built.definition.spellcasting?.spells ?? [];
    expect(spells.find((spell) => spell.id === "hunters-mark")).toMatchObject({ alwaysPrepared: true, level: 1 });
    expect(built.definition.spellcasting?.classes?.[0]).toMatchObject({ classId: "ranger", prepared: 6 });
    expect(spells.filter((spell) => spell.level >= 1 && !spell.alwaysPrepared)).toHaveLength(6);
  });

  it("gives exactly as many free casts as the printed Favored Enemy column, at two levels", () => {
    // The column reads 2 at level 1 and 6 at level 17, and `scaling: {type: "class-resource"}` reads
    // it. Spending to the limit and being refused the next one is the whole promise.
    const first = table(rangerInput(1));
    resolve(first, "favored-enemy", [], []);
    resolve(first, "favored-enemy", [], []);
    expect(first.hero.actionUses["favored-enemy"]).toBe(2);
    expect(() => resolve(first, "favored-enemy", [], []))
      .toThrowError(/Favored Enemy: no uses remaining \(2\/long rest\)/);

    const late = table(rangerInput(17));
    for (let cast = 0; cast < 6; cast += 1) resolve(late, "favored-enemy", [], []);
    expect(late.hero.actionUses["favored-enemy"]).toBe(6);
    expect(() => resolve(late, "favored-enemy", [], []))
      .toThrowError(/Favored Enemy: no uses remaining \(6\/long rest\)/);
  });
});

describe("Ranger - the rest of the kit", () => {
  it("REFUSES a level-2 Ranger with no Deft Explorer Expertise, and grants it when chosen", () => {
    const missing = rangerInput(2);
    missing.choices = missing.choices.filter((row) => row.payload?.featureId !== "deft-explorer");
    expect(() => buildCharacterDefinition(missing, library, policy))
      .toThrowError(/"Deft Explorer" needs 1 pick\(s\) of kind "expertise"/);
    const skills = table(rangerInput(2)).definition.proficiencies?.skills ?? [];
    expect(skills.find((skill) => skill.id === "perception")?.proficiency).toBe("expertise");
  });

  it("adds Roving's 10 feet at level 6 and not at level 5", () => {
    expect(table(rangerInput(6)).definition.speedFeet).toBe(40);
    expect(table(rangerInput(5)).definition.speedFeet).toBe(30);
  });

  it("scales Tireless off the FINAL Wisdom modifier, so an ASI moves the pool", () => {
    // `scaling: {type: "ability-modifier"}` resolves against the built scores, not the base ones.
    // Same record, same level, two different numbers - which is what proves the scaling is read.
    const plain = table(rangerInput(10));                      // Wis 15 -> +2
    for (let use = 0; use < 2; use += 1) spend(plain, "tireless");
    expect(plain.hero.actionUses["tireless"]).toBe(2);
    newTurn(plain);
    expect(() => resolve(plain, "tireless", [], []))
      .toThrowError(/Tireless: no uses remaining \(2\/long rest\)/);

    const focused = table(rangerInput(10, { wisFocus: true })); // Wis 15 + 4 -> +4
    for (let use = 0; use < 4; use += 1) spend(focused, "tireless");
    expect(focused.hero.actionUses["tireless"]).toBe(4);
    newTurn(focused);
    expect(() => resolve(focused, "tireless", [], []))
      .toThrowError(/Tireless: no uses remaining \(4\/long rest\)/);
  });

  it("makes Nature's Veil a Bonus Action with its own Wisdom-sized pool", () => {
    const built = table(rangerInput(14));
    expect(actionOf(built, "natures-veil")?.activation).toBe("bonus-action");
    spend(built, "natures-veil");
    spend(built, "natures-veil");
    expect(built.hero.actionUses["natures-veil"]).toBe(2);
    // A SEPARATE pool from Tireless's, which is the SRD's reading and the reason each names its own.
    expect(built.hero.actionUses["tireless"]).toBeUndefined();
    newTurn(built);
    expect(() => resolve(built, "natures-veil", [], []))
      .toThrowError(/Nature's Veil: no uses remaining \(2\/long rest\)/);
  });

  it("REFUSES a level-19 Ranger with no Epic Boon feat", () => {
    const missing = rangerInput(19);
    missing.choices = missing.choices.filter((row) =>
      row.payload?.featureId !== "epic-boon" && row.payload?.featureId !== "boon-of-dimensional-travel");
    expect(() => buildCharacterDefinition(missing, library, policy))
      .toThrowError(/"Epic Boon" needs 1 pick\(s\) of kind "feat"/);
  });

  it("carries Feral Senses as a rider on the sheet - display-level, and knowingly so", () => {
    // `CARRIER_RIDER_DISPOSITION` records `sense` as "display-only": it reaches the rider carriers
    // and no consumer applies it, exactly like the `darkvision` nine shipped species traits author.
    // Asserted at the seam it really reaches, and claimed as nothing more than that.
    const built = table(rangerInput(18));
    const carrier = deriveEquipment(built.hero, built.definition, built.catalog).carriers.find((entry) => entry.label === "Feral Senses");
    expect(carrier?.modifiers).toEqual([{ type: "sense", sense: "blindsight", feet: 30, when: [], scope: undefined }]);
  });

  it("takes Extra Attack all the way to a SECOND WEAPON SWING - the engine gap, closed", () => {
    // THIS TEST USED TO PIN THE GAP. It read: "bakes Extra Attack into the definition and reaches NO
    // weapon swing", and asserted `count === 1` precisely so that the day the engine closed the gap
    // it would fail loudly rather than let the content go on being quietly wrong. That day is here,
    // so it now asserts the other side of the same seam - and one level lower, as its own control.
    //
    // What changed: `extra-attack` left `BUILDER_BAKED_MODIFIER_TYPES`. Baking it raised
    // `attack.count` on the actions a FEATURE declares, and a Ranger (like every martial class)
    // declares none - the swings come from equipped inventory. It is a standing rider now, and
    // `effective-actions.ts` raises the count on the derived weapon swings themselves.
    const built = table(rangerInput(5));
    expect(built.definition.character?.features?.map((entry) => entry.id)).toContain("extra-attack");
    const bow = effectiveActions(built.definition, built.hero, built.catalog).find((entry) => entry.id === "item-longbow");
    expect(bow?.attack?.count).toBe(2);

    // The far end, which a count on a definition never was: a second arrow that really resolves.
    expect(resolve(built, "item-longbow", [17, 5]).componentsRemaining).toEqual({ attack: 1 });
    expect(resolve(built, "item-longbow", [14, 6]).componentsRemaining).toBeNull();
    expect(() => resolve(built, "item-longbow", [19, 4])).toThrow(/no attacks remaining in this action/);

    // Level 4: the same Ranger, one level before the feature. Still exactly one arrow.
    const before = table(rangerInput(4));
    const single = effectiveActions(before.definition, before.hero, before.catalog).find((entry) => entry.id === "item-longbow");
    expect(single?.attack?.count ?? 1).toBe(1);
  });
});

describe("Ranger - Hunter's Prey and Defensive Tactics, audit rows 21 and 22", () => {
  it("REFUSES a Hunter who chose neither option, and puts the chosen one on the sheet", () => {
    // Both features shipped with no `choice` at all: a Hunter picked nothing and the sheet recorded
    // nothing. The pick is real now - the refusal is what proves it.
    const missing = rangerInput(3);
    missing.choices = missing.choices.filter((row) => row.kind !== "hunters-prey");
    expect(() => buildCharacterDefinition(missing, library, policy))
      .toThrowError(/"Hunter's Prey" needs 1 pick\(s\) of kind "hunters-prey"/);

    const traits = (table(rangerInput(3)).definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map((trait) => trait.name);
    expect(traits).toContain("Colossus Slayer");
    expect(traits).not.toContain("Horde Breaker");
  });

  it("refuses an option that is not one of the two printed", () => {
    const bogus = rangerInput(3);
    bogus.choices = bogus.choices.map((row) => row.kind === "hunters-prey" ? { ...row, id: "colossal-slayer" } : row);
    expect(() => buildCharacterDefinition(bogus, library, policy)).toThrowError(/not an offered option/);
  });

  it("offers Defensive Tactics at level 7 and refuses a build that skipped it", () => {
    const missing = rangerInput(7);
    missing.choices = missing.choices.filter((row) => row.kind !== "defensive-tactics");
    expect(() => buildCharacterDefinition(missing, library, policy))
      .toThrowError(/"Defensive Tactics" needs 1 pick\(s\) of kind "defensive-tactics"/);
    const traits = (table(rangerInput(7)).definition.extensions["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map((trait) => trait.name);
    expect(traits).toContain("Escape the Horde");
  });
});

// =================================================================================================
// PALADIN
// =================================================================================================

/** The always-prepared spells a Paladin's own features hand over, by level - excluded from the picks. */
const paladinGranted = (level: number): string[] => [
  ...(level >= 2 ? ["divine-smite"] : []),
  ...(level >= 3 ? ["protection-from-evil-and-good", "shield-of-faith"] : []),
  ...(level >= 5 ? ["find-steed"] : [])
];

/** A Halfling Criminal Paladin of Devotion. Charisma 14 after the array, so the spell save DC moves with the proficiency bonus. */
const paladinInput = (level: number): MutableInput => {
  const asiLevels = [4, 8, 12, 16].filter((asi) => asi <= level);
  return {
    name: "Bree", speciesId: "halfling", backgroundId: "criminal", classId: "paladin", level,
    ...(level >= 3 ? { subclassId: "oath-of-devotion" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 14 },
    backgroundBonusAllocation: [{ ability: "dex", amount: 2 }, { ability: "con", amount: 1 }],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "paladin", kind: "skill", id: "athletics" },
      { level: 1, classId: "paladin", kind: "skill", id: "persuasion" },
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "longsword" },
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "javelin" },
      ...(level >= 2 ? [{ level: 2, classId: "paladin", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } }] : []),
      ...(level >= 3 ? [{ level: 3, classId: "paladin", kind: "subclass", id: "oath-of-devotion" }] : []),
      ...asiLevels.flatMap((asi) => [
        { level: asi, classId: "paladin", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: asi, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
        { level: asi, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } }
      ]),
      ...(level >= 19 ? [
        { level: 19, classId: "paladin", kind: "feat", id: "boon-of-truesight", payload: { featureId: "epic-boon" } },
        { level: 19, kind: "ability-score", id: "cha", payload: { featureId: "boon-of-truesight" } }
      ] : []),
      ...preparedPicks("paladin", level, paladinGranted(level)).map((id) => ({ level: 1, kind: "spell" as const, id })),
      { level: 1, kind: "equipment", id: "paladin-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ] as MutableInput["choices"]
  };
};

describe("Paladin - the two free casts, audit rows 30 and 31", () => {
  it("always has Divine Smite prepared and casts it free ONCE per Long Rest", () => {
    const built = table(paladinInput(5));
    const spells = built.definition.spellcasting?.spells ?? [];
    expect(spells.find((spell) => spell.id === "divine-smite")).toMatchObject({ alwaysPrepared: true });
    // Uncharged: the printed budget at level 5 is 6, and the sheet holds six CHOSEN spells plus the
    // four its features grant.
    expect(built.definition.spellcasting?.classes?.[0]).toMatchObject({ prepared: 6 });
    expect(spells.filter((spell) => spell.level >= 1 && !spell.alwaysPrepared)).toHaveLength(6);

    spend(built, "paladins-smite");
    expect(built.hero.actionUses["paladins-smite"]).toBe(1);
    newTurn(built);
    expect(() => resolve(built, "paladins-smite", [], []))
      .toThrowError(/Paladins Smite: no uses remaining \(1\/long rest\)/);
  });

  it("always has Find Steed prepared from level 5, on its OWN pool", () => {
    const built = table(paladinInput(5));
    expect((built.definition.spellcasting?.spells ?? []).find((spell) => spell.id === "find-steed"))
      .toMatchObject({ alwaysPrepared: true, level: 2 });
    spend(built, "faithful-steed");
    expect(built.hero.actionUses["faithful-steed"]).toBe(1);
    expect(built.hero.actionUses["paladins-smite"]).toBeUndefined();
    // ...and a level-4 Paladin has neither the spell nor the pool.
    const early = table(paladinInput(4));
    expect((early.definition.spellcasting?.spells ?? []).some((spell) => spell.id === "find-steed")).toBe(false);
  });
});

describe("Paladin - Channel Divinity is ONE counter that three features spend", () => {
  it("drains the printed column across Divine Sense, Abjure Foes and Sacred Weapon", () => {
    // The column prints 2 at level 3. Two spends of ANY of the three exhausts all three - which is
    // what `uses.pool` means, and what a per-action key would silently have got wrong by giving each
    // feature its own two.
    const built = table(paladinInput(9));
    spend(built, "divine-sense");
    spend(built, "sacred-weapon");
    expect(built.hero.actionUses["channel-divinity"]).toBe(2);
    newTurn(built);
    expect(() => resolve(built, "abjure-foes", [], [IDS.foe]))
      .toThrowError(/Abjure Foes: no uses remaining \(2\/long rest\)/);
  });

  it("follows the column to 3 uses at level 11", () => {
    const built = table(paladinInput(11));
    for (let use = 0; use < 3; use += 1) spend(built, "divine-sense");
    expect(built.hero.actionUses["channel-divinity"]).toBe(3);
    newTurn(built);
    expect(() => resolve(built, "divine-sense", [], []))
      .toThrowError(/Divine Sense: no uses remaining \(3\/long rest\)/);
  });

  it("holds Abjure Foes' targets to THIS Paladin's spell save DC", () => {
    // `dc: "spellcasting"` is a template - 8 + proficiency bonus + Charisma modifier, resolved
    // against the built sheet. At level 9 that is 8 + 4 + 2 = 14, and the resolver holds the target
    // to exactly that number.
    const built = table(paladinInput(9));
    expect(actionOf(built, "abjure-foes")?.save).toEqual({ ability: "wis", dc: 14 });
    const resolution = resolve(built, "abjure-foes", [], [IDS.foe]);
    expect(resolution.save).toMatchObject({ ability: "wis", dc: 14 });
  });
});

describe("Paladin - the auras that are really immunities", () => {
  it("REFUSES the Frightened condition on a level-10 Paladin, and says so at the table", () => {
    // `grants.conditionImmunities` is enforced with narration, not silently: the text below is what
    // the fight log shows. The level-9 build is the negative control - same character, one level
    // earlier, and the condition lands.
    const brave = table(paladinInput(10));
    const events = setCondition(brave.state, IDS.hero, "frightened", true, undefined, GM_SCOPE);
    expect(events).toEqual([{ kind: "condition", text: "Bree is immune to Frightened - not applied.", actorId: IDS.hero }]);
    expect(brave.hero.conditions).toEqual([]);

    const earlier = table(paladinInput(9));
    setCondition(earlier.state, IDS.hero, "frightened", true, undefined, GM_SCOPE);
    expect(earlier.hero.conditions).toEqual([{ id: "frightened" }]);
  });

  it("REFUSES Charmed from Oath of Devotion's level-7 aura", () => {
    const devoted = table(paladinInput(7));
    expect(setCondition(devoted.state, IDS.hero, "charmed", true, undefined, GM_SCOPE)[0].text)
      .toBe("Bree is immune to Charmed - not applied.");
    // Frightened is NOT immune yet - the class aura is level 10, so the two are told apart.
    setCondition(devoted.state, IDS.hero, "frightened", true, undefined, GM_SCOPE);
    expect(devoted.hero.conditions).toEqual([{ id: "frightened" }]);
  });
});

describe("Paladin - Radiant Strikes rolls extra dice on a melee hit", () => {
  it("adds 1d8 Radiant to a Melee weapon hit at level 11 and nothing at level 10", () => {
    // A roll-time rider gated `on-hit` + `attack-kind-is: ["melee", "unarmed"]`. The far end is a
    // SECOND damage entry on the resolution card, rolled and typed.
    const built = table(paladinInput(11));
    const hit = resolve(built, "item-longsword", [19, 6, 7]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.damage.find((part) => part.type === "radiant")).toMatchObject({ formula: "1d8", total: 7 });

    const earlier = table(paladinInput(10));
    const plain = resolve(earlier, "item-longsword", [19, 6]);
    expect(plain.attack?.outcome).toBe("hit");
    expect(plain.damage.some((part) => part.type === "radiant")).toBe(false);
  });

  it("adds nothing to the javelin the SAME Paladin throws - the attack-kind filter is real", () => {
    // The two weapons the starting loadout hands a Paladin land on opposite sides of the filter: the
    // longsword's derived action carries `reachFeet` (Melee), the javelin's carries `rangeFeet`
    // (Ranged). Same character, same turn's worth of dice, one rider - and it fires exactly once.
    // Without the filter this would roll 1d8 Radiant on every attack a Paladin makes.
    const built = table(paladinInput(11));
    expect(actionOf(built, "item-longsword")?.attack?.reachFeet).toBe(5);
    expect(actionOf(built, "item-javelin")?.attack?.rangeFeet).toBeGreaterThan(0);
    expect(actionOf(built, "item-javelin")?.attack?.reachFeet).toBeUndefined();

    const shot = resolve(built, "item-javelin", [19, 4]);
    expect(shot.attack?.outcome).toBe("hit");
    expect(shot.damage.some((part) => part.type === "radiant")).toBe(false);
  });
});

describe("Paladin - Oath of Devotion, audit row 28 (first tier only)", () => {
  it("always has the level-3 pair prepared, uncharged", () => {
    const built = table(paladinInput(3));
    const spells = built.definition.spellcasting?.spells ?? [];
    for (const id of ["protection-from-evil-and-good", "shield-of-faith"]) {
      expect(spells.find((spell) => spell.id === id)).toMatchObject({ alwaysPrepared: true });
    }
    expect(built.definition.spellcasting?.classes?.[0]).toMatchObject({ prepared: 4 });
    expect(spells.filter((spell) => spell.level >= 1 && !spell.alwaysPrepared)).toHaveLength(4);
  });

  it("does NOT hand a level-17 Paladin the higher tiers, which no record can carry", () => {
    // The honest half of row 28, pinned. `grants.spells` has no level gate and the overlay cannot
    // mint the per-tier records Life Domain uses, so the SRD's level-5/9/13/17 rows stay in the
    // prose. When either of those changes, this assertion is the one that says so.
    const built = table(paladinInput(17));
    const ids = (built.definition.spellcasting?.spells ?? []).filter((spell) => spell.alwaysPrepared).map((spell) => spell.id);
    expect(ids).toEqual(expect.arrayContaining(["protection-from-evil-and-good", "shield-of-faith"]));
    for (const later of ["aid", "zone-of-truth", "beacon-of-hope", "commune", "flame-strike"]) {
      expect(ids).not.toContain(later);
    }
    // ...and the table the player reads them from really is in the description.
    const oath = library.subclassRecord("oath-of-devotion")!.features.find((feature) => feature.id === "oath-of-devotion-spells")!;
    expect(oath.description).toContain("Flame Strike");
  });

  it("makes Holy Nimbus a Bonus Action with one long-rest use", () => {
    const built = table(paladinInput(20));
    expect(actionOf(built, "holy-nimbus")?.activation).toBe("bonus-action");
    spend(built, "holy-nimbus");
    expect(built.hero.actionUses["holy-nimbus"]).toBe(1);
    newTurn(built);
    expect(() => resolve(built, "holy-nimbus", [], []))
      .toThrowError(/Holy Nimbus: no uses remaining \(1\/long rest\)/);
  });

  it("REFUSES a level-19 Paladin with no Epic Boon feat", () => {
    const missing = paladinInput(19);
    missing.choices = missing.choices.filter((row) =>
      row.payload?.featureId !== "epic-boon" && row.payload?.featureId !== "boon-of-truesight");
    expect(() => buildCharacterDefinition(missing, library, policy))
      .toThrowError(/"Epic Boon" needs 1 pick\(s\) of kind "feat"/);
  });
});
