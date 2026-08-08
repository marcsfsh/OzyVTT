import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { criticalThreshold, effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { initiativeRollMode, startEncounter } from "../src/encounter.js";
import { saveRollSources } from "../src/saving-throws.js";

/**
 * ============================================================================================
 * STAGE 4, LANE B1 - BARBARIAN, FIGHTER, MONK - PROVED AT THE FAR END
 * ============================================================================================
 *
 * Every assertion below is a number a player can act on: the AC on the sheet, the DC the target is
 * held to, the die the engine actually keeps, the counter it spends, or the refusal it prints. Not
 * one of them asks whether a rider "survived derivation" - that is the failure the `2e` correction
 * named, and content that typechecks and does nothing looks identical to content that works.
 *
 * These run the REAL builder against the REAL SRD bundles, so they are also a check on the ETL: a
 * feature id the markdown renames, a printed column that stops being read, or an overlay key that
 * lands on the wrong record all fail here rather than at one player's character sheet.
 *
 * NEGATIVE CONTROLS, everywhere a rider has an obvious way to appear to work: the ability the save
 * advantage must NOT reach, the crit range before the subclass grants it, the pick that must be
 * refused once the budget is full, the pool that must be empty on the second press.
 */

const POLICY = BuilderPolicySchema.parse({});
const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

type Row = CharacterCreateRequestInput["choices"][number];
type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & { choices: Row[] };

/** One Ability Score Improvement: the `asi-or-feat` row plus the two points the feat then spends. */
const asi = (classId: string, level: number, first: string, second: string): Row[] => ([
  { level, classId, kind: "asi-or-feat", id: "ability-score-improvement" },
  { level, kind: "ability-score", id: first, payload: { featureId: "ability-score-improvement" } },
  { level, kind: "ability-score", id: second, payload: { featureId: "ability-score-improvement" } }
] as Row[]);

// ---------------------------------------------------------------------------------------------
// The three sheets, built from real ledgers.
// ---------------------------------------------------------------------------------------------

/** The ASI rows for every Ability Score Improvement level at or below `level`, in printed order. */
const asisTo = (classId: string, level: number, plan: ReadonlyArray<[number, string, string]>): Row[] =>
  plan.filter(([at]) => at <= level).flatMap(([at, first, second]) => asi(classId, at, first, second));

/** `count` weapon-mastery rows off a fixed list, so a level's printed column is met exactly. */
const masteries = (classId: string, ids: readonly string[], count: number): Row[] =>
  ids.slice(0, count).map((id) => ({ level: 1, classId, kind: "weapon-mastery", id }) as Row);

/** The printed Weapon Mastery column, as a function of level: Barbarian 2/3/4, Fighter 3/4/5/6. */
const barbarianMasteries = (level: number) => (level >= 10 ? 4 : level >= 4 ? 3 : 2);
const fighterMasteries = (level: number) => (level >= 16 ? 6 : level >= 10 ? 5 : level >= 4 ? 4 : 3);

/**
 * A Halfling Berserker at any level. Halfling because it is the ONE SRD species with no ability
 * bonus, no modifier, no `uses` and no choice of its own - so every number below belongs to the
 * class, and a drift in the assertions cannot be blamed on the species.
 *
 * Scores by level 20: Str 15 +2 (background) +2 (L4) +1 (L8) = 20 · Con 13 +1 +1 (L8) +2 (L12)
 * +1 (the boon) = 18 · Dex 14 +2 (L16) = 16. Primal Champion then adds +4 to Str and Con, ceiling 25.
 */
const barbarianInput = (level = 20): MutableInput => ({
  name: "Ozar", speciesId: "halfling", backgroundId: "soldier", classId: "barbarian", level,
  ...(level >= 3 ? { subclassId: "path-of-the-berserker" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "barbarian", kind: "skill", id: "perception" },
    { level: 1, classId: "barbarian", kind: "skill", id: "survival" },
    // THE THIRD one only exists because Primal Knowledge (level 3) raises `class-skills` 2 -> 3.
    ...(level >= 3 ? ([{ level: 3, classId: "barbarian", kind: "skill", id: "nature" }] as Row[]) : []),
    ...masteries("barbarian", ["greataxe", "handaxe", "javelin", "greatsword"], barbarianMasteries(level)),
    ...(level >= 3 ? ([{ level: 3, classId: "barbarian", kind: "subclass", id: "path-of-the-berserker" }] as Row[]) : []),
    ...asisTo("barbarian", level, [[4, "str", "str"], [8, "str", "con"], [12, "con", "con"], [16, "dex", "dex"]]),
    ...(level >= 19 ? ([
      { level: 19, classId: "barbarian", kind: "feat", id: "boon-of-combat-prowess", payload: { featureId: "epic-boon" } },
      { level: 19, kind: "ability-score", id: "con", payload: { featureId: "boon-of-combat-prowess" } }
    ] as Row[]) : []),
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "barbarian-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
});

/** A Halfling Champion. Level 5 has Improved Critical only; level 15 has Superior Critical too. */
const fighterInput = (level: number): MutableInput => ({
  name: "Borin", speciesId: "halfling", backgroundId: "soldier", classId: "fighter", level,
  ...(level >= 3 ? { subclassId: "champion" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    ...masteries("fighter", ["greatsword", "flail", "longbow", "rapier", "handaxe", "maul"], fighterMasteries(level)),
    ...(level >= 3 ? ([{ level: 3, classId: "fighter", kind: "subclass", id: "champion" }] as Row[]) : []),
    // Champion's own level-7 feature: a SECOND Fighting Style feat, from the same catalog.
    ...(level >= 7 ? ([{ level: 7, classId: "fighter", kind: "fighting-style", id: "great-weapon-fighting", payload: { featureId: "additional-fighting-style" } }] as Row[]) : []),
    ...asisTo("fighter", level, [[4, "str", "str"], [6, "str", "con"], [8, "con", "con"], [12, "con", "con"], [14, "dex", "dex"], [16, "wis", "wis"]]),
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
});

/**
 * A Halfling Warrior of the Open Hand.
 *
 * Level 11: Dex 15 +2 (background) +2 (L4) = 19 · Wis 14 +2 (L8) = 16 · proficiency 4.
 * Level 20: Dex 19 +1 (L12) = 20 · Wis 16 +1 (L12) +2 (L16) +1 (the boon) = 20 · proficiency 6,
 * then Body and Mind adds +4 to each with a ceiling of 25.
 */
const monkInput = (level: number): MutableInput => ({
  name: "Shan", speciesId: "halfling", backgroundId: "criminal", classId: "monk", level,
  ...(level >= 3 ? { subclassId: "warrior-of-the-open-hand" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
  backgroundBonusAllocation: [{ ability: "dex", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "monk", kind: "skill", id: "acrobatics" },
    { level: 1, classId: "monk", kind: "skill", id: "insight" },
    ...(level >= 3 ? ([{ level: 3, classId: "monk", kind: "subclass", id: "warrior-of-the-open-hand" }] as Row[]) : []),
    ...asisTo("monk", level, [[4, "dex", "dex"], [8, "wis", "wis"], [12, "dex", "wis"], [16, "wis", "wis"]]),
    ...(level >= 19 ? ([
      { level: 19, classId: "monk", kind: "feat", id: "boon-of-the-night-spirit", payload: { featureId: "epic-boon" } },
      { level: 19, kind: "ability-score", id: "wis", payload: { featureId: "boon-of-the-night-spirit" } }
    ] as Row[]) : []),
    { level: 1, kind: "equipment", id: "monk-a" },
    { level: 1, kind: "equipment", id: "criminal-a" }
  ]
});

/** Chosen feats minus the ASI feat, which every level-4+ sheet holds several times over. */
const featIds = (definition: ActorDefinition) =>
  (definition.character?.feats ?? []).map((feat) => feat.id).filter((id) => id !== "ability-score-improvement");

// ---------------------------------------------------------------------------------------------
// Table harness: build the sheet, put it on a map, roll with seeded dice.
// ---------------------------------------------------------------------------------------------

type Built = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor }>;

function build(input: MutableInput): ActorDefinition {
  return buildCharacterDefinition(input as CharacterCreateRequestInput, view, POLICY);
}

function onTheTable(definition: ActorDefinition, { fight = true } = {}): Built {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 200, maximum: 200 }, armorClass: 13 }]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  // The hero goes first, which matters: `attack-advantage` is gated to the bearer's OWN turn.
  if (fight) startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return { definition, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
}

function deps(built: Built, faces: number[] = []): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-08-07T00:00:00.000Z",
    definition: built.definition, catalog
  };
}

let command = 0;
const use = (built: Built, actionId: string, targetIds: string[] = [], faces: number[] = []) =>
  resolveDefinitionAction(
    built.state,
    effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === actionId)!,
    { actorId: IDS.hero, targetIds, commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    deps(built, faces)
  );

const actionOf = (built: Built, id: string) => effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === id)!;
const derivationOf = (built: Built) => deriveEquipment(built.hero, built.definition, catalog);

// ---------------------------------------------------------------------------------------------
// BARBARIAN
// ---------------------------------------------------------------------------------------------

describe("Barbarian: the sheet's own numbers", () => {
  const definition = build(barbarianInput());

  it("Unarmored Defense is 10 + Dex + CON, and the Barbarian's is the one that allows a Shield", () => {
    // Dex 16 (+3), Con 22 (+6) after Primal Champion. A Monk's identically-named feature reads
    // Wisdom instead, which is why the overlay is keyed on (recordId, featureId) and never on the id.
    expect(definition.abilityScores).toMatchObject({ str: 24, con: 22, dex: 16 });
    expect(definition.armorClass).toBe(19);
  });

  it("Primal Champion really passes 20 - the ceiling every other increase is clamped to", () => {
    // Str is 20 and Con 18 when the capstone applies; a `maximum`-less rider would leave both AT 20,
    // which is exactly the silent no-op the epic boons shipped with before `maximum` existed.
    expect(definition.abilityScores.str).toBeGreaterThan(20);
    expect(definition.abilityScores.con).toBeGreaterThan(20);
    // ...and it is +4 with a ceiling of 25, not an uncapped add: Str 20 -> 24, Con 18 -> 22.
    expect(definition.abilityScores.str).toBe(24);
  });

  it("Fast Movement is on the walking speed the token moves at", () => {
    expect(definition.speedFeet).toBe(40); // Halfling 30 + 10
  });

  it("Rage's uses come off the printed Rages column at THIS level, not a copy of it", () => {
    // 6 at level 20, 2 at level 1 - and neither number is typed anywhere in the overlay.
    expect(definition.actions.find((action) => action.id === "rage")?.uses).toEqual({ limit: 6, per: "long-rest" });
    expect(build(barbarianInput(1)).actions.find((action) => action.id === "rage")?.uses).toEqual({ limit: 2, per: "long-rest" });
  });
});

describe("Barbarian: Primal Knowledge raises a budget the wizard already had", () => {
  it("accepts a THIRD class skill and refuses a fourth, naming 3", () => {
    // Audit row 20. The Barbarian's printed `skillChoices.choose` is 2; the third skill exists only
    // because `extraPicks: [{offer: "class-skills", amount: 1}]` raised it.
    const built = build(barbarianInput());
    expect(built.proficiencies!.skills.map((skill) => skill.id))
      .toEqual(expect.arrayContaining(["perception", "survival", "nature"]));

    const overfull = barbarianInput();
    overfull.choices.push({ level: 3, classId: "barbarian", kind: "skill", id: "athletics" } as Row);
    expect(() => build(overfull)).toThrowError(/Barbarian skills: 3/);
  });

  it("refuses the third skill on a level-2 Barbarian, who has not gained the feature yet", () => {
    // The negative control that makes the assertion above mean something: it is Primal Knowledge
    // (level 3) that raises the budget, not the class simply having three all along.
    const early = barbarianInput(2);
    early.choices.push({ level: 1, classId: "barbarian", kind: "skill", id: "nature" } as Row);
    expect(() => build(early)).toThrowError(/Barbarian skills: 2/);
  });
});

describe("Barbarian: Weapon Mastery follows the printed column", () => {
  it("takes four at level 20, two at level 1, and refuses the fifth", () => {
    expect((build(barbarianInput()).character?.choices ?? []).filter((row) => row.kind === "weapon-mastery")).toHaveLength(4);
    expect((build(barbarianInput(1)).character?.choices ?? []).filter((row) => row.kind === "weapon-mastery")).toHaveLength(2);
    const overfull = barbarianInput();
    overfull.choices.push({ level: 20, classId: "barbarian", kind: "weapon-mastery", id: "maul" } as Row);
    expect(() => build(overfull)).toThrowError(/Weapon Mastery: 4/);
  });
});

describe("Barbarian: Danger Sense reaches the save the target actually rolls", () => {
  it("gives Advantage on Dexterity saves and on NOTHING else", () => {
    const built = onTheTable(build(barbarianInput()), { fight: false });
    const derivation = derivationOf(built);
    expect(saveRollSources(built.hero, "dex", derivation).advantage).toEqual([{ source: "item:Danger Sense", label: "Danger Sense" }]);
    // The filter really filters: Constitution is the Barbarian's OTHER proficient save.
    expect(saveRollSources(built.hero, "con", derivation).advantage).toEqual([]);
    expect(saveRollSources(built.hero, "wis", derivation).advantage).toEqual([]);
  });
});

describe("Barbarian: Feral Instinct changes the initiative die", () => {
  it("rolls two d20s and keeps the higher one", () => {
    const built = onTheTable(build(barbarianInput()), { fight: false });
    const resolve = (id: string) => id === built.hero.definitionId ? built.definition : undefined;
    expect(initiativeRollMode(built.state, IDS.hero, resolve, catalog)).toBe("advantage");
    // The DIE, not the flag: two faces are offered and the higher survives (+3 Dex).
    const faces = [4, 17];
    startEncounter(built.state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero }, { actorId: IDS.foe, score: 10 }] },
      () => faces.shift()!, GEOMETRY, resolve, 0, catalog);
    expect(built.state.combat.initiative.find((entry) => entry.actorId === IDS.hero)?.score).toBe(20);
  });

  it("is a normal single die for a level-6 Barbarian, who has not gained it yet", () => {
    const built = onTheTable(build(barbarianInput(6)), { fight: false });
    expect(initiativeRollMode(built.state, IDS.hero, (id) => id === built.hero.definitionId ? built.definition : undefined, catalog)).toBe("normal");
  });
});

describe("Barbarian: Reckless Attack is an effect the table can see and swing under", () => {
  it("puts a real effect on the actor and makes the next attack roll with advantage", () => {
    const built = onTheTable(build(barbarianInput()));
    use(built, "reckless-attack");
    const effect = built.hero.effects.find((entry) => entry.tags.includes("reckless-attack"))!;
    expect(effect).toBeDefined();
    expect(effect.modifiers.map((modifier) => modifier.type)).toEqual(["attack-advantage", "incoming-attack-advantage"]);
    expect(effect.duration).toEqual({ type: "until-source-next-turn" });

    // The swing: two d20s offered, the HIGHER kept, then the greataxe's 1d12.
    const swung = use(built, "item-greataxe", [IDS.foe], [3, 15, 8]);
    expect(swung.rollMode).toMatchObject({ mode: "advantage" });
    expect(swung.attack!.naturalRoll).toBe(15);
  });

  it("leaves the same swing a single die before the effect is entered", () => {
    const bare = onTheTable(build(barbarianInput()));
    const swung = use(bare, "item-greataxe", [IDS.foe], [3, 8]);
    expect(swung.rollMode).toBeUndefined();
    expect(swung.attack!.naturalRoll).toBe(3);
  });
});

describe("Barbarian: Persistent Rage is a counter the engine spends", () => {
  it("spends its one long-rest use and refuses the second attempt", () => {
    const built = onTheTable(build(barbarianInput()));
    use(built, "persistent-rage");
    expect(built.hero.actionUses["persistent-rage"]).toBe(1);
    expect(() => use(built, "persistent-rage")).toThrowError(/no uses remaining \(1\/long rest\)/);
  });
});

describe("Barbarian: the Epic Boon a level-19 Barbarian lost outright", () => {
  it("lands on the sheet as a real feat", () => {
    // Audit row 6. Nine of the twelve classes had NO `choice` on `epic-boon` at all.
    expect(featIds(build(barbarianInput()))).toEqual(["savage-attacker", "boon-of-combat-prowess"]);
    // ...and a level-18 Barbarian has only the background's origin feat, so the boon is the feature's.
    expect(featIds(build(barbarianInput(18)))).toEqual(["savage-attacker"]);
  });

  it("refuses a feat that is not an Epic Boon, and refuses the boon before level 19", () => {
    const wrongCategory = barbarianInput();
    wrongCategory.choices = wrongCategory.choices
      .filter((row) => row.id !== "boon-of-combat-prowess" && !(row.kind === "ability-score" && row.payload?.featureId === "boon-of-combat-prowess"))
      .concat([{ level: 19, classId: "barbarian", kind: "feat", id: "alert", payload: { featureId: "epic-boon" } }] as Row[]);
    expect(() => build(wrongCategory)).toThrowError(/alert/i);

    const tooEarly = barbarianInput(18);
    tooEarly.choices.push(
      { level: 18, classId: "barbarian", kind: "feat", id: "boon-of-combat-prowess", payload: { featureId: "epic-boon" } } as Row
    );
    expect(() => build(tooEarly)).toThrowError(/No feature "epic-boon" offers a "feat" choice/);
  });
});

describe("Barbarian: Intimidating Presence holds the target to the Barbarian's own DC", () => {
  it("derives 8 + Strength + proficiency and spends its long-rest use", () => {
    // A level-14 Berserker (the level the feature is gained): Str 20 (+5), proficiency 5 -> DC 18.
    // A printed constant would be wrong for every Barbarian but one, which is what
    // `FeatureSaveDcSchema`'s derived form exists for - so the level-17 sheet is asserted too, where
    // the proficiency bonus alone moves the number to 19.
    const built = onTheTable(build(barbarianInput(14)));
    expect(actionOf(built, "intimidating-presence").save).toEqual({ ability: "wis", dc: 18 });
    const resolution = use(built, "intimidating-presence", [IDS.foe]);
    expect(resolution.save).toMatchObject({ ability: "wis", dc: 18 });
    expect(built.hero.actionUses["intimidating-presence"]).toBe(1);

    const later = onTheTable(build(barbarianInput(17)), { fight: false });
    expect(actionOf(later, "intimidating-presence").save).toEqual({ ability: "wis", dc: 19 });
  });

  it("counts PRIMAL CHAMPION's +4 - the capstone the DC used to be computed before", () => {
    // THE ORDERING BUG, at the only level it can be seen. Primal Champion is a level-20 `ability-score`
    // rider (+4 Str/Con, ceiling 25), and the builder used to fold every such rider AFTER
    // `interpretFeature` had already derived this feature's DC from `context.finalScores`.
    //
    // The tell was that the sheet contradicted itself: `abilityScores.str` read 24 on the same
    // definition whose Intimidating Presence said DC 19 - a DC that can only come from Str 20. Both
    // halves are asserted here, so the two can never drift apart again.
    //
    // Str 20 at level 16, +4 from the capstone = 24 (+7); proficiency 6. 8 + 7 + 6 = 21.
    const capstone = onTheTable(build(barbarianInput(20)));
    expect(capstone.definition.abilityScores.str).toBe(24);
    expect(actionOf(capstone, "intimidating-presence").save).toEqual({ ability: "wis", dc: 21 });
    // Far end: the number the TARGET is actually held to, not just the one printed on the sheet.
    expect(use(capstone, "intimidating-presence", [IDS.foe]).save).toMatchObject({ ability: "wis", dc: 21 });
  });
});

// ---------------------------------------------------------------------------------------------
// FIGHTER / CHAMPION
// ---------------------------------------------------------------------------------------------

describe("Champion: the crit range the resolver reads", () => {
  it("is 19 at level 3, 18 at level 15, and 20 for a Fighter with no subclass yet", () => {
    const five = onTheTable(build(fighterInput(5)), { fight: false });
    expect(criticalThreshold(derivationOf(five), five.hero, actionOf(five, "item-greatsword"))).toBe(19);

    // Superior Critical does not REPLACE Improved Critical - `criticalThreshold` takes the lowest
    // any carrier names, so the two compose and no ordering rule is needed.
    const fifteen = onTheTable(build(fighterInput(15)), { fight: false });
    expect(criticalThreshold(derivationOf(fifteen), fifteen.hero, actionOf(fifteen, "item-greatsword"))).toBe(18);

    const bare = onTheTable(build(fighterInput(2)), { fight: false });
    expect(criticalThreshold(derivationOf(bare), bare.hero, actionOf(bare, "item-greatsword"))).toBe(20);
  });

  it("turns a natural 19 into a critical hit, and doubles the dice it rolls", () => {
    const built = onTheTable(build(fighterInput(5)));
    // d20 = 19 -> a crit at threshold 19, so the greatsword's 2d6 is rolled TWICE (2024 doubling):
    // 6 + 6 + 5 + 5 plus Str 19's +4 = 26. A 19 on a Fighter without the subclass is an ordinary hit.
    const swung = use(built, "item-greatsword", [IDS.foe], [19, 6, 6, 5, 5]);
    expect(swung.attack).toMatchObject({ naturalRoll: 19, outcome: "crit" });
    expect(swung.damageTotal).toBe(26);

    const plain = onTheTable(build(fighterInput(2)));
    const ordinary = use(plain, "item-greatsword", [IDS.foe], [19, 6, 5]);
    expect(ordinary.attack).toMatchObject({ naturalRoll: 19, outcome: "hit" });
    expect(ordinary.damageTotal).toBe(14); // 6 + 5 + Str 17's +3, dice rolled ONCE
  });
});

describe("Champion: Remarkable Athlete changes the initiative die", () => {
  it("rolls with advantage from level 3", () => {
    const built = onTheTable(build(fighterInput(5)), { fight: false });
    expect(initiativeRollMode(built.state, IDS.hero, (id) => id === built.hero.definitionId ? built.definition : undefined, catalog)).toBe("advantage");
  });
});

describe("Fighter: EXTRA ATTACK is a second swing that really resolves", () => {
  /**
   * THE GAP THIS CLOSES. `extra-attack` was a builder-baked rider: the builder raised `attack.count`
   * on the actions a FEATURE declares, and no martial class declares one - every Fighter, Barbarian,
   * Monk, Ranger and Paladin swing is derived from equipped inventory instead. Two lanes measured the
   * consequence independently: the built definition was byte-identical with and without the rider,
   * and `definition.actions.filter(a => a.attack)` is EMPTY at every level.
   *
   * So the assertion cannot be a count on a definition - that is exactly the number that lied for a
   * year. It has to be a SECOND ATTACK RESOLVING, and a third being refused.
   */
  const foeAc = 13;

  it("resolves TWO swings on one action slot at level 5, then refuses the third", () => {
    // Str 19 (+4) + proficiency 3 = +7 to hit; the foe's AC is 13, so a natural 9 hits with room.
    const built = onTheTable(build(fighterInput(5)));
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.armorClass).toBe(foeAc);

    const first = use(built, "item-greatsword", [IDS.foe], [9, 5, 5]);
    expect(first.attack?.outcome).toBe("hit");
    // The second swing is OPEN, and it is a generic pool - this is the number that used to be null.
    expect(first.componentsRemaining).toEqual({ attack: 1 });

    // SRD Extra Attack lets the second swing be a DIFFERENT weapon, which is why the pool is generic.
    const second = use(built, "item-flail", [IDS.foe], [14, 6]);
    expect(second.attack?.outcome).toBe("hit");
    expect(second.componentsRemaining).toBeNull();

    // ...and the third is refused, so the count is a real budget rather than an unbounded one.
    expect(() => use(built, "item-greatsword", [IDS.foe], [18, 5, 5]))
      .toThrow(/no attacks remaining in this action/);
  });

  it("is ONE swing at level 4, the level before the feature is gained", () => {
    // The negative control that makes the test above mean something: same sheet, same weapon, one
    // level earlier. If this ever opens a pool, the rider is applying to someone who has not got it.
    const built = onTheTable(build(fighterInput(4)));
    expect(actionOf(built, "item-greatsword").attack?.count ?? 1).toBe(1);
    const only = use(built, "item-greatsword", [IDS.foe], [9, 5, 5]);
    expect(only.componentsRemaining).toBeNull();
    expect(() => use(built, "item-flail", [IDS.foe], [14, 6])).toThrow(/already used an action/);
  });

  it("counts THREE swings at level 11, off the Fighter's own second tier", () => {
    // `two-extra-attacks` is a separate feature with `count: 2`, and the Fighter is the only class
    // that has more than one tier - so this is also the proof that the tiers are read as an absolute
    // total rather than summed on top of the level-5 rider.
    const built = onTheTable(build(fighterInput(11)));
    expect(actionOf(built, "item-greatsword").attack?.count).toBe(3);
    expect(use(built, "item-greatsword", [IDS.foe], [9, 5, 5]).componentsRemaining).toEqual({ attack: 2 });
    expect(use(built, "item-flail", [IDS.foe], [14, 6]).componentsRemaining).toEqual({ attack: 1 });
    // Exhausted reads as `null`, not `{ attack: 0 }` - the resolver reports remaining components only
    // while some remain, so this is the same "nothing left" the level-5 pair's second swing gives.
    expect(use(built, "item-spear", [IDS.foe], [16, 4]).componentsRemaining).toBeNull();
    expect(() => use(built, "item-greatsword", [IDS.foe], [18, 5, 5]))
      .toThrow(/no attacks remaining in this action/);
  });

  it("does NOT multiply a non-weapon action that happens to roll to hit", () => {
    // The scope that keeps this from being a rules bug dressed as a feature: Extra Attack is
    // "whenever you take the Attack action", so it may only raise a DERIVED WEAPON SWING. Every
    // other action on the same level-11 sheet keeps the count it declared.
    const built = onTheTable(build(fighterInput(11)));
    const swings = new Set(derivationOf(built).weaponActionIds);
    for (const action of effectiveActions(built.definition, built.hero, catalog)) {
      if (!action.attack || swings.has(action.id)) continue;
      expect({ id: action.id, count: action.attack.count ?? 1 }).toEqual({ id: action.id, count: 1 });
    }
  });
});

describe("Barbarian and Monk get the same second swing - it was never Fighter-only", () => {
  it("opens a second attack for a level-5 Barbarian", () => {
    const built = onTheTable(build(barbarianInput(5)));
    expect(actionOf(built, "item-greataxe").attack?.count).toBe(2);
    expect(use(built, "item-greataxe", [IDS.foe], [12, 7]).componentsRemaining).toEqual({ attack: 1 });
    expect(use(built, "item-handaxe", [IDS.foe], [15, 4]).componentsRemaining).toBeNull();
  });

  it("opens a second attack for a level-5 Monk, and not for a level-4 one", () => {
    const five = onTheTable(build(monkInput(5)));
    expect(actionOf(five, "item-spear").attack?.count).toBe(2);
    expect(use(five, "item-spear", [IDS.foe], [17, 5]).componentsRemaining).toEqual({ attack: 1 });

    const four = onTheTable(build(monkInput(4)));
    expect(actionOf(four, "item-spear").attack?.count ?? 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// MONK
// ---------------------------------------------------------------------------------------------

describe("Monk: the sheet's own numbers", () => {
  const twenty = build(monkInput(20));

  it("Unarmored Defense is 10 + Dex + WISDOM - the other half of the shared feature id", () => {
    expect(twenty.abilityScores).toMatchObject({ dex: 24, wis: 24 });
    expect(twenty.armorClass).toBe(24); // 10 + 7 + 7
  });

  it("Body and Mind passes 20, and Disciplined Survivor makes every save proficient", () => {
    expect(twenty.abilityScores.dex).toBeGreaterThan(20);
    expect([...twenty.proficiencies!.saves].sort()).toEqual(["cha", "con", "dex", "int", "str", "wis"]);
    // The negative control: a level-11 Monk has only the class's printed two.
    expect([...build(monkInput(11)).proficiencies!.saves].sort()).toEqual(["dex", "str"]);
  });
});

describe("Monk: Focus Points are ONE pool, read off the printed column and really spent", () => {
  it("gives all three activations the same counter, sized by the class table", () => {
    const built = onTheTable(build(monkInput(20)));
    for (const id of ["flurry-of-blows", "patient-defense", "step-of-the-wind"]) {
      expect(actionOf(built, id).uses, id).toEqual({ limit: 20, per: "short-rest", pool: "focus-points" });
    }
    // The column, not a constant: a level-11 Monk prints 11.
    const eleven = onTheTable(build(monkInput(11)));
    expect(actionOf(eleven, "flurry-of-blows").uses).toEqual({ limit: 11, per: "short-rest", pool: "focus-points" });
  });

  it("spends ONE counter across DIFFERENT actions, and across different FEATURES", () => {
    const built = onTheTable(build(monkInput(11)));
    use(built, "flurry-of-blows");
    // Stunning Strike is a different feature record entirely, and it draws on the same counter.
    use(built, "stunning-strike", [IDS.foe]);
    // A fresh turn, so the Bonus Action economy allows the third press (the rules engine's rule,
    // not this pool's): Step of the Wind then takes the third point.
    built.state.combat = { ...built.state.combat, turn: { ...built.state.combat.turn, bonusActionUsed: false } };
    use(built, "step-of-the-wind");
    // Three different actions, one key: 3 spent out of 11. Per-action pools would read 1 each.
    expect(built.hero.actionUses["focus-points"]).toBe(3);
    expect(built.hero.actionUses["flurry-of-blows"]).toBeUndefined();
    expect(built.hero.actionUses["stunning-strike"]).toBeUndefined();
  });

  it("refuses the twelfth spend on a level-11 Monk", () => {
    const built = onTheTable(build(monkInput(11)));
    built.hero.actionUses = { "focus-points": 11 };
    expect(() => use(built, "flurry-of-blows")).toThrowError(/no uses remaining \(11\/short rest\)/);
  });
});

describe("Monk: Stunning Strike holds the target to the Monk's own DC", () => {
  it("derives 8 + Wisdom + proficiency and draws on the SAME Focus Points pool", () => {
    // Wis 16 (+3) at level 11, proficiency 4: DC 15.
    const built = onTheTable(build(monkInput(11)));
    expect(actionOf(built, "stunning-strike").save).toEqual({ ability: "con", dc: 15 });
    const resolution = use(built, "stunning-strike", [IDS.foe]);
    expect(resolution.save).toMatchObject({ ability: "con", dc: 15 });
    expect(built.hero.actionUses["focus-points"]).toBe(1);
  });

  it("counts BODY AND MIND's +4 - the same ordering bug, one class over", () => {
    // The Monk's half of the level-20 capstone bug. Body and Mind is +4 Dex/Wis (ceiling 25) and
    // Stunning Strike's DC is derived from Wisdom, so the two meet on exactly this sheet.
    //
    // Wis 20 by level 19 (16 at L8, 17 at L12, 19 at L16, 20 from Boon of the Night Spirit), +4 from
    // the capstone = 24 (+7); proficiency 6. 8 + 7 + 6 = 21. It read 19 before the fold moved.
    const capstone = onTheTable(build(monkInput(20)));
    expect(capstone.definition.abilityScores.wis).toBe(24);
    expect(actionOf(capstone, "stunning-strike").save).toEqual({ ability: "con", dc: 21 });
    expect(use(capstone, "stunning-strike", [IDS.foe]).save).toMatchObject({ ability: "con", dc: 21 });
  });
});

describe("Monk: Superior Defense grants Resistance to everything but Force", () => {
  it("puts the effect on the actor with twelve damage types and not the thirteenth", () => {
    const built = onTheTable(build(monkInput(20)));
    use(built, "superior-defense");
    const effect = built.hero.effects.find((entry) => entry.tags.includes("superior-defense"))!;
    const resistance = effect.modifiers.find((modifier) => modifier.type === "damage-resistance")!;
    expect(resistance).toMatchObject({ type: "damage-resistance" });
    const types = (resistance as { damageTypes: string[] }).damageTypes;
    expect(types).toHaveLength(12);
    expect(types).toContain("psychic");
    expect(types).not.toContain("force");
    expect(effect.duration).toEqual({ type: "rounds", remaining: 10 });
  });
});

describe("Monk: Quivering Palm rolls the 10d12 the SRD prints", () => {
  it("rolls ten twelves and totals 120 Force damage", () => {
    const built = onTheTable(build(monkInput(20)));
    const resolution = use(built, "quivering-palm", [IDS.foe], [12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
    expect(resolution.damage).toEqual([{ formula: "10d12", type: "force", total: 120 }]);
    expect(resolution.damageTotal).toBe(120);
  });
});

describe("Monk: Wholeness of Body counts uses off an ability modifier", () => {
  it("is Wisdom-many at level 11 and re-armed by a Long Rest, with a floor of one", () => {
    // Wis 16 (+3) -> three uses. `minimum: 1` is the printed "(minimum of once)", as a field.
    const built = onTheTable(build(monkInput(11)));
    expect(actionOf(built, "wholeness-of-body").uses).toEqual({ limit: 3, per: "long-rest" });
    use(built, "wholeness-of-body");
    expect(built.hero.actionUses["wholeness-of-body"]).toBe(1);
  });
});

describe("Monk: Uncanny Metabolism is a counter, and the Epic Boon is a feat", () => {
  it("spends one long-rest use, and refuses the second", () => {
    const built = onTheTable(build(monkInput(11)));
    use(built, "uncanny-metabolism");
    expect(built.hero.actionUses["uncanny-metabolism"]).toBe(1);
    expect(() => use(built, "uncanny-metabolism")).toThrowError(/no uses remaining \(1\/long rest\)/);
  });

  it("puts the level-19 boon on the sheet", () => {
    expect(featIds(build(monkInput(20)))).toEqual(["alert", "boon-of-the-night-spirit"]);
    expect(featIds(build(monkInput(11)))).toEqual(["alert"]);
  });
});
