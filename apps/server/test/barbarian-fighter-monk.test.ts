import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { builtinAction, builtinActionFor } from "../src/builtin-actions.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { criticalThreshold, effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { initiativeRollMode, nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { answerSave, createPendingSaves, saveRollSources } from "../src/saving-throws.js";
import { checkPlan } from "../src/ability-checks.js";
import { evaluateActionEconomy } from "../src/resolution/economy.js";
import { UNARMED_STRIKE_ACTION_ID } from "../src/item-actions.js";
import { applyDamageDetailed, RELENTLESS_RAGE_KEY } from "../src/hit-points.js";
import { applyRest } from "../src/rests.js";
import { currentSpeedFeet } from "../src/speed.js";
import { carriedAlongBy, dragCostsExtra } from "../src/movement-rules.js";

// Barbarian, Fighter and Monk mechanics, asserted as numbers a player can act on: sheet AC, the DC a
// target is held to, the die the engine keeps, the counter it spends, or the refusal it prints. Runs
// the real builder against the real SRD bundles, so it also catches ETL drift. Negative controls
// appear wherever a rider could appear to work without working.

const POLICY = BuilderPolicySchema.parse({});
const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

/** A second creature on the map, for the rules that name two. */
const OTHER = "10000000-0000-4000-8000-000000000003";
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

type Row = CharacterCreateRequestInput["choices"][number];
type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & {
  choices: Row[];
};

/** One Ability Score Improvement: the `asi-or-feat` row plus the two points the feat then spends. */
const asi = (classId: string, level: number, first: string, second: string): Row[] =>
  [
    { level, classId, kind: "asi-or-feat", id: "ability-score-improvement" },
    { level, kind: "ability-score", id: first, payload: { featureId: "ability-score-improvement" } },
    { level, kind: "ability-score", id: second, payload: { featureId: "ability-score-improvement" } }
  ] as Row[];

/** The ASI rows for every Ability Score Improvement level at or below `level`, in printed order. */
const asisTo = (classId: string, level: number, plan: ReadonlyArray<[number, string, string]>): Row[] =>
  plan.filter(([at]) => at <= level).flatMap(([at, first, second]) => asi(classId, at, first, second));

/** `count` weapon-mastery rows off a fixed list, so a level's printed column is met exactly. */
const masteries = (classId: string, ids: readonly string[], count: number): Row[] =>
  ids.slice(0, count).map((id) => ({ level: 1, classId, kind: "weapon-mastery", id }) as Row);

/** The printed Weapon Mastery column, as a function of level: Barbarian 2/3/4, Fighter 3/4/5/6. */
const barbarianMasteries = (level: number) => (level >= 10 ? 4 : level >= 4 ? 3 : 2);
const fighterMasteries = (level: number) => (level >= 16 ? 6 : level >= 10 ? 5 : level >= 4 ? 4 : 3);

// A Halfling Berserker at any level. Halfling has no ability bonus, modifier, `uses` or choice, so
// every number below belongs to the class.
// Scores by level 20: Str 15 +2 (background) +2 (L4) +1 (L8) = 20 · Con 13 +1 +1 (L8) +2 (L12)
// +1 (the boon) = 18 · Dex 14 +2 (L16) = 16. Primal Champion then adds +4 to Str and Con, ceiling 25.
const barbarianInput = (level = 20): MutableInput => ({
  name: "Ozar",
  speciesId: "halfling",
  backgroundId: "soldier",
  classId: "barbarian",
  level,
  ...(level >= 3 ? { subclassId: "path-of-the-berserker" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "barbarian", kind: "skill", id: "perception" },
    { level: 1, classId: "barbarian", kind: "skill", id: "survival" },
    // The third skill exists only because Primal Knowledge (level 3) raises `class-skills` 2 -> 3.
    ...(level >= 3 ? ([{ level: 3, classId: "barbarian", kind: "skill", id: "nature" }] as Row[]) : []),
    ...masteries("barbarian", ["greataxe", "handaxe", "javelin", "greatsword"], barbarianMasteries(level)),
    ...(level >= 3
      ? ([{ level: 3, classId: "barbarian", kind: "subclass", id: "path-of-the-berserker" }] as Row[])
      : []),
    ...asisTo("barbarian", level, [
      [4, "str", "str"],
      [8, "str", "con"],
      [12, "con", "con"],
      [16, "dex", "dex"]
    ]),
    ...(level >= 19
      ? ([
          {
            level: 19,
            classId: "barbarian",
            kind: "feat",
            id: "boon-of-combat-prowess",
            payload: { featureId: "epic-boon" }
          },
          { level: 19, kind: "ability-score", id: "con", payload: { featureId: "boon-of-combat-prowess" } }
        ] as Row[])
      : []),
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "barbarian-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
});

/** A Halfling Champion. Level 5 has Improved Critical only; level 15 has Superior Critical too. */
const fighterInput = (level: number): MutableInput => ({
  name: "Borin",
  speciesId: "halfling",
  backgroundId: "soldier",
  classId: "fighter",
  level,
  ...(level >= 3 ? { subclassId: "champion" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "survival" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    ...masteries("fighter", ["greatsword", "flail", "longbow", "rapier", "handaxe", "maul"], fighterMasteries(level)),
    ...(level >= 3 ? ([{ level: 3, classId: "fighter", kind: "subclass", id: "champion" }] as Row[]) : []),
    // Champion's level-7 feature: a second Fighting Style feat, from the same catalog.
    ...(level >= 7
      ? ([
          {
            level: 7,
            classId: "fighter",
            kind: "fighting-style",
            id: "great-weapon-fighting",
            payload: { featureId: "additional-fighting-style" }
          }
        ] as Row[])
      : []),
    ...asisTo("fighter", level, [
      [4, "str", "str"],
      [6, "str", "con"],
      [8, "con", "con"],
      [12, "con", "con"],
      [14, "dex", "dex"],
      [16, "wis", "wis"]
    ]),
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
});

// A Halfling Warrior of the Open Hand.
// Level 11: Dex 15 +2 (background) +2 (L4) = 19 · Wis 14 +2 (L8) = 16 · proficiency 4.
// Level 20: Dex 19 +1 (L12) = 20 · Wis 16 +1 (L12) +2 (L16) +1 (the boon) = 20 · proficiency 6,
// then Body and Mind adds +4 to each with a ceiling of 25.
const monkInput = (level: number): MutableInput => ({
  name: "Shan",
  speciesId: "halfling",
  backgroundId: "criminal",
  classId: "monk",
  level,
  ...(level >= 3 ? { subclassId: "warrior-of-the-open-hand" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
  backgroundBonusAllocation: [
    { ability: "dex", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "monk", kind: "skill", id: "acrobatics" },
    { level: 1, classId: "monk", kind: "skill", id: "insight" },
    { level: 1, classId: "monk", kind: "tool", id: "instrument-flute" },
    ...(level >= 3 ? ([{ level: 3, classId: "monk", kind: "subclass", id: "warrior-of-the-open-hand" }] as Row[]) : []),
    ...asisTo("monk", level, [
      [4, "dex", "dex"],
      [8, "wis", "wis"],
      [12, "dex", "wis"],
      [16, "wis", "wis"]
    ]),
    ...(level >= 19
      ? ([
          {
            level: 19,
            classId: "monk",
            kind: "feat",
            id: "boon-of-the-night-spirit",
            payload: { featureId: "epic-boon" }
          },
          { level: 19, kind: "ability-score", id: "wis", payload: { featureId: "boon-of-the-night-spirit" } }
        ] as Row[])
      : []),
    { level: 1, kind: "equipment", id: "monk-a" },
    { level: 1, kind: "equipment", id: "criminal-a" }
  ]
});

/** Chosen feats minus the ASI feat, which every level-4+ sheet holds several times over. */
const featIds = (definition: ActorDefinition) =>
  (definition.character?.feats ?? []).map((feat) => feat.id).filter((id) => id !== "ability-score-improvement");

// Table harness: build the sheet, put it on a map, roll with seeded dice.

type Built = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor }>;

function build(input: MutableInput): ActorDefinition {
  return buildCharacterDefinition(input as CharacterCreateRequestInput, view, POLICY);
}

function onTheTable(definition: ActorDefinition, { fight = true } = {}): Built {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 200, maximum: 200 },
        armorClass: 13
      }
    ]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  // The hero goes first, so its swings are on its own turn.
  if (fight)
    startEncounter(
      state,
      {
        mapAssetId: IDS.map,
        entries: [
          { actorId: IDS.hero, score: 20 },
          { actorId: IDS.foe, score: 10 }
        ]
      },
      () => 1,
      GEOMETRY
    );
  return { definition, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
}

function deps(built: Built, faces: number[] = []): ResolveDependencies {
  let index = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-08-07T00:00:00.000Z",
    definition: built.definition,
    catalog
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

const actionOf = (built: Built, id: string) =>
  effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === id)!;

/** A swing at the foe, confirmed with the extras its hit offered (`hitOptions`), or previewed with `commit: false`. */
const swing = (
  built: Built,
  actionId: string,
  faces: number[],
  options: Readonly<{ hitOptions?: Array<{ id: string; effects?: string[] }>; commit?: boolean }> = {}
) =>
  resolveDefinitionAction(
    built.state,
    actionOf(built, actionId),
    {
      actorId: IDS.hero,
      targetIds: [IDS.foe],
      commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
      ...(options.hitOptions ? { hitOptions: options.hitOptions } : {}),
      ...(options.commit === false ? { commit: false } : {})
    },
    deps(built, faces)
  );
const offerIds = (resolution: ReturnType<typeof swing>) => (resolution.hitOffers ?? []).map((offer) => offer.id);
const derivationOf = (built: Built) => deriveEquipment(built.hero, built.definition, catalog);

// Barbarian

describe("Barbarian: the sheet's own numbers", () => {
  const definition = build(barbarianInput());

  it("Unarmored Defense is 10 + Dex + CON, and the Barbarian's is the one that allows a Shield", () => {
    // Dex 16 (+3), Con 22 (+6) after Primal Champion. The Monk's identically named feature reads Wisdom,
    // which is why the overlay is keyed on (recordId, featureId), never the id alone.
    expect(definition.abilityScores).toMatchObject({ str: 24, con: 22, dex: 16 });
    expect(definition.armorClass).toBe(19);
  });

  it("Primal Champion really passes 20: the ceiling every other increase is clamped to", () => {
    // Str is 20 and Con 18 when the capstone applies; a rider without `maximum` would leave both at 20.
    expect(definition.abilityScores.str).toBeGreaterThan(20);
    expect(definition.abilityScores.con).toBeGreaterThan(20);
    // ...and it is +4 with a ceiling of 25: Str 20 -> 24, Con 18 -> 22.
    expect(definition.abilityScores.str).toBe(24);
  });

  it("Fast Movement is on the walking speed the token moves at", () => {
    expect(definition.speedFeet).toBe(40); // Halfling 30 + 10
  });

  it("Fast Movement is off while Heavy armor is worn", () => {
    const built = onTheTable(build(barbarianInput(5)), { fight: false });
    expect(currentSpeedFeet(built.hero, derivationOf(built))).toBe(40);
    built.hero.inventory = [
      ...built.hero.inventory,
      {
        id: "plate",
        name: "Plate Armor",
        quantity: 1,
        equipped: true,
        attuned: false,
        category: "armor",
        armor: {
          acBase: 18,
          addDexModifier: false,
          dexModifierCap: null,
          stealthDisadvantage: true,
          strengthRequired: null
        }
      }
    ];
    expect(currentSpeedFeet(built.hero, derivationOf(built))).toBe(30);
  });

  it("Rage's uses come off the printed Rages column at THIS level, not a copy of it", () => {
    // 6 at level 20, 2 at level 1, read from the printed column.
    expect(definition.actions.find((action) => action.id === "rage")?.uses).toEqual({ limit: 6, per: "long-rest" });
    expect(build(barbarianInput(1)).actions.find((action) => action.id === "rage")?.uses).toEqual({
      limit: 2,
      per: "long-rest"
    });
  });
});

describe("Barbarian: Improved Brutal Strike keeps both of its printed levels", () => {
  it("carries the level-13 effects and the level-17 upgrade in one description", () => {
    const feature = view.classRecord("barbarian")!.features.find((entry) => entry.id === "improved-brutal-strike")!;
    expect(feature.description).toContain("Staggering Blow");
    expect(feature.description).toContain("At level 17: The extra damage of your Brutal Strike increases to 2d10");
  });
});

describe("Barbarian: Primal Knowledge raises a budget the wizard already had", () => {
  it("accepts a THIRD class skill and refuses a fourth, naming 3", () => {
    // The printed `skillChoices.choose` is 2; the third skill comes from
    // `extraPicks: [{offer: "class-skills", amount: 1}]`.
    const built = build(barbarianInput());
    expect(built.proficiencies!.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(["perception", "survival", "nature"])
    );

    const overfull = barbarianInput();
    overfull.choices.push({ level: 3, classId: "barbarian", kind: "skill", id: "athletics" } as Row);
    expect(() => build(overfull)).toThrowError(/Barbarian skills: 3/);
  });

  it("refuses the third skill on a level-2 Barbarian, who has not gained the feature yet", () => {
    // Negative control: Primal Knowledge (level 3) raises the budget; the class does not have three from the start.
    const early = barbarianInput(2);
    early.choices.push({ level: 1, classId: "barbarian", kind: "skill", id: "nature" } as Row);
    expect(() => build(early)).toThrowError(/Barbarian skills: 2/);
  });
});

describe("Barbarian: Primal Knowledge makes some checks Strength checks while raging", () => {
  // Level 6: Str 19 (+4), Dex 14 (+2), Wis 12 (+1), proficiency +3, Perception proficient and Stealth not.
  const plan = (built: Built, skill: string, ability: "dex" | "wis") =>
    checkPlan(built.hero, built.definition, derivationOf(built), { ability, skill });

  it("makes Stealth and Perception Strength checks once the Rage starts, with the Rage's Advantage", () => {
    const table = onTheTable(build(barbarianInput(6)));
    expect(plan(table, "stealth", "dex")).toMatchObject({ subject: { ability: "dex" }, modifier: 2 });
    use(table, "rage");
    expect(plan(table, "stealth", "dex")).toMatchObject({
      subject: { ability: "str", skill: "stealth" },
      modifier: 4,
      rollMode: { mode: "advantage" }
    });
    expect(plan(table, "perception", "wis")).toMatchObject({ subject: { ability: "str" }, modifier: 7 });
  });

  it("leaves a raging level-2 Barbarian's Stealth a Dexterity check: the feature comes at 3", () => {
    const table = onTheTable(build(barbarianInput(2)));
    use(table, "rage");
    expect(plan(table, "stealth", "dex").subject.ability).toBe("dex");
  });
});

describe("Barbarian: Weapon Mastery follows the printed column", () => {
  it("takes four at level 20, two at level 1, and refuses the fifth", () => {
    expect(
      (build(barbarianInput()).character?.choices ?? []).filter((row) => row.kind === "weapon-mastery")
    ).toHaveLength(4);
    expect(
      (build(barbarianInput(1)).character?.choices ?? []).filter((row) => row.kind === "weapon-mastery")
    ).toHaveLength(2);
    const overfull = barbarianInput();
    overfull.choices.push({ level: 20, classId: "barbarian", kind: "weapon-mastery", id: "maul" } as Row);
    expect(() => build(overfull)).toThrowError(/Weapon Mastery: 4/);
  });
});

describe("Barbarian: Danger Sense reaches the save the target actually rolls", () => {
  it("gives Advantage on Dexterity saves and on NOTHING else", () => {
    const built = onTheTable(build(barbarianInput()), { fight: false });
    const derivation = derivationOf(built);
    expect(saveRollSources(built.hero, "dex", derivation).advantage).toEqual([
      { source: "item:Danger Sense", label: "Danger Sense" }
    ]);
    // The filter narrows: Constitution is the Barbarian's other proficient save.
    expect(saveRollSources(built.hero, "con", derivation).advantage).toEqual([]);
    expect(saveRollSources(built.hero, "wis", derivation).advantage).toEqual([]);
  });
});

describe("Barbarian: Feral Instinct changes the initiative die", () => {
  it("rolls two d20s and keeps the higher one", () => {
    const built = onTheTable(build(barbarianInput()), { fight: false });
    const resolve = (id: string) => (id === built.hero.definitionId ? built.definition : undefined);
    expect(initiativeRollMode(built.state, IDS.hero, resolve, catalog)).toBe("advantage");
    // The die itself: two faces are offered and the higher survives (+3 Dex).
    const faces = [4, 17];
    startEncounter(
      built.state,
      { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero }, { actorId: IDS.foe, score: 10 }] },
      () => faces.shift()!,
      GEOMETRY,
      resolve,
      0,
      catalog
    );
    expect(built.state.combat.initiative.find((entry) => entry.actorId === IDS.hero)?.score).toBe(20);
  });

  it("is a normal single die for a level-6 Barbarian, who has not gained it yet", () => {
    const built = onTheTable(build(barbarianInput(6)), { fight: false });
    expect(
      initiativeRollMode(
        built.state,
        IDS.hero,
        (id) => (id === built.hero.definitionId ? built.definition : undefined),
        catalog
      )
    ).toBe("normal");
  });
});

/** "Attack rolls using Strength": the gate Reckless Attack's own Advantage carries. */
const STRENGTH_ATTACKS = [{ type: "on-attack-roll" }, { type: "ability-is", abilities: ["str"] }];

describe("Barbarian: Reckless Attack is an effect the table can see and swing under", () => {
  it("puts a real effect on the actor and makes the next attack roll using Strength with advantage", () => {
    const built = onTheTable(build(barbarianInput()));
    use(built, "reckless-attack");
    const effect = built.hero.effects.find((entry) => entry.tags.includes("reckless-attack"))!;
    expect(effect).toBeDefined();
    // SRD 2024: "Advantage on attack rolls using Strength", and every attack roll against you.
    expect(effect.modifiers).toEqual([
      { type: "roll-mode", roll: "attack", mode: "advantage", when: STRENGTH_ATTACKS },
      { type: "roll-mode", roll: "incoming-attack", mode: "advantage" }
    ]);
    expect(effect.duration).toEqual({ type: "until-source-next-turn" });

    // Two d20s offered, the higher kept, then the greataxe's 1d12.
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

  it("gives a bow shot, which uses Dexterity, no Advantage", () => {
    const built = onTheTable(build(barbarianInput()));
    built.hero.inventory = [
      ...built.hero.inventory,
      {
        id: "shortbow",
        name: "Shortbow",
        quantity: 1,
        equipped: true,
        attuned: false,
        category: "weapon",
        weapon: {
          category: "simple",
          damageDice: "1d6",
          damageType: "piercing",
          rangeFeet: 80,
          longRangeFeet: 320,
          melee: false,
          properties: ["ammunition", "two-handed"]
        }
      },
      { id: "arrows-20", name: "Arrows (20)", quantity: 1, equipped: false, attuned: false, category: "ammunition" }
    ];
    use(built, "reckless-attack");
    const shot = use(built, "item-shortbow", [IDS.foe], [3, 4]);
    expect(shot.rollMode).toBeUndefined();
    expect(shot.attack!.naturalRoll).toBe(3);
  });

  it("narrows a sheet built before the gate to attacks using Strength as it lands", () => {
    const built = onTheTable(build(barbarianInput()));
    const older = built.definition.actions.map((action) =>
      action.id === "reckless-attack"
        ? {
            ...action,
            grants: {
              ...action.grants!,
              modifiers: [
                { type: "roll-mode" as const, roll: "attack" as const, mode: "advantage" as const },
                { type: "roll-mode" as const, roll: "incoming-attack" as const, mode: "advantage" as const }
              ]
            }
          }
        : action
    );
    use({ ...built, definition: { ...built.definition, actions: older } }, "reckless-attack");
    expect(built.hero.effects.find((entry) => entry.tags.includes("reckless-attack"))!.modifiers[0]).toEqual({
      type: "roll-mode",
      roll: "attack",
      mode: "advantage",
      when: STRENGTH_ATTACKS
    });
  });

  it("is decided with the first attack roll on the Barbarian's turn, not after it or off the turn", () => {
    const swungFirst = onTheTable(build(barbarianInput()));
    use(swungFirst, "item-greataxe", [IDS.foe], [3, 8]);
    expect(() => use(swungFirst, "reckless-attack")).toThrowError(
      /Ozar has already made an attack roll this turn, and Reckless Attack is decided with the first/
    );
    const offTurn = onTheTable(build(barbarianInput()));
    nextInitiativeTurn(offTurn.state); // the foe's turn
    expect(() => use(offTurn, "reckless-attack")).toThrowError(
      /Reckless Attack is decided with an attack roll on Ozar's own turn/
    );
    // The turn after, a fresh first roll.
    nextInitiativeTurn(offTurn.state);
    use(offTurn, "reckless-attack");
    expect(offTurn.hero.effects.some((entry) => entry.tags.includes("reckless-attack"))).toBe(true);
  });
});

describe("Boon of Combat Prowess: Peerless Aim until the start of the bearer's next turn", () => {
  it("turns a missed attack into a hit, stays spent through the other creatures' turns and comes back with its own", () => {
    const built = onTheTable(build(barbarianInput()));
    const turnDeps = {
      resolveDefinition: (id: string) => (id === built.hero.definitionId ? built.definition : undefined),
      catalog,
      rollDie: () => 1
    };
    const look = (faces: number[], answer?: string) =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "item-greataxe"),
        {
          actorId: IDS.hero,
          targetIds: [IDS.foe],
          commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
          holdKey: `attack:${IDS.hero}`,
          commit: false,
          ...(answer ? { answer: { id: answer } } : {})
        },
        deps(built, faces)
      );
    expect(look([1]).attack?.answers?.map((offer) => offer.id)).toContain("boon-of-combat-prowess");
    expect(look([], "boon-of-combat-prowess").attack?.outcome).toBe("hit");
    expect(built.hero.actionUses["boon-of-combat-prowess"]).toBe(1);
    nextInitiativeTurn(built.state, [], turnDeps); // the foe's turn: still spent
    expect(built.hero.actionUses["boon-of-combat-prowess"]).toBe(1);
    nextInitiativeTurn(built.state, [], turnDeps); // Ozar's own turn again
    expect(built.hero.actionUses["boon-of-combat-prowess"] ?? 0).toBe(0);
  });
});

describe("Barbarian: Rage Damage on attacks using Strength", () => {
  it("prints the column's number on the Rage action and grants it as the damage bonus", () => {
    const rageOf = (level: number) => build(barbarianInput(level)).actions.find((action) => action.id === "rage")!;
    expect(rageOf(1).description).toContain("Rage Damage: +2.");
    expect(rageOf(9).description).toContain("Rage Damage: +3.");
    expect(rageOf(16).grants?.modifiers).toContainEqual(expect.objectContaining({ type: "damage-bonus", amount: 4 }));
  });

  it("adds it to a raging Greataxe hit, and not before the Rage", () => {
    const built = onTheTable(build(barbarianInput(5)));
    const before = use(built, "item-greataxe", [IDS.foe], [15, 6]);
    expect(before.bonusDamage).toBeUndefined();
    use(built, "rage");
    const raging = use(built, "item-greataxe", [IDS.foe], [15, 6]);
    expect(raging.bonusDamage).toEqual([expect.objectContaining({ amount: 2, type: "slashing" })]);
    expect(raging.damageTotal).toBe(6 + 4 + 2);
  });
});

describe("Berserker: Frenzy rides the first Strength hit of a reckless, raging turn", () => {
  const reckless = (built: Built) => use(built, "reckless-attack");

  it("offers d6s of the weapon's type on the first Strength hit, and not on the second", () => {
    const built = onTheTable(build(barbarianInput(3)));
    use(built, "rage");
    reckless(built);
    const first = swing(built, "item-greataxe", [15, 15], { commit: false });
    expect(first.hitOffers?.find((offer) => offer.id === "frenzy")).toMatchObject({ dice: "2d6 Slashing" });
    const hit = swing(built, "item-greataxe", [15, 15, 6, 3, 3], { hitOptions: [{ id: "frenzy" }] });
    expect(hit.damage.filter((part) => part.source === "Frenzy")).toEqual([
      { formula: "2d6", type: "slashing", total: 6, source: "Frenzy" }
    ]);
    built.state.combat.turn = { ...built.state.combat.turn, actionUsed: false, actionInstance: null };
    expect(offerIds(swing(built, "item-greataxe", [15, 15], { commit: false }))).not.toContain("frenzy");
  });

  it("isn't offered without Reckless Attack or without the Rage, and rolls 3d6 at Barbarian 9", () => {
    const calm = onTheTable(build(barbarianInput(3)));
    reckless(calm);
    expect(offerIds(swing(calm, "item-greataxe", [15, 15], { commit: false }))).not.toContain("frenzy");
    const careful = onTheTable(build(barbarianInput(3)));
    use(careful, "rage");
    expect(offerIds(swing(careful, "item-greataxe", [15, 15], { commit: false }))).not.toContain("frenzy");
    const ninth = onTheTable(build(barbarianInput(9)));
    use(ninth, "rage");
    reckless(ninth);
    expect(swing(ninth, "item-greataxe", [15, 15], { commit: false }).hitOffers).toContainEqual(
      expect.objectContaining({ id: "frenzy", dice: "3d6 Slashing" })
    );
  });

  it("isn't offered after a Strength hit that went without it", () => {
    const built = onTheTable(build(barbarianInput(5)));
    use(built, "rage");
    reckless(built);
    swing(built, "item-greataxe", [15, 15, 6]);
    expect(offerIds(swing(built, "item-greataxe", [15, 15], { commit: false }))).not.toContain("frenzy");
  });
});

describe("Barbarian: Persistent Rage is a counter the engine spends", () => {
  it("spends its one long-rest use and refuses the second attempt", () => {
    const built = onTheTable(build(barbarianInput()));
    use(built, "persistent-rage");
    expect(built.hero.actionUses["persistent-rage"]).toBe(1);
    expect(() => use(built, "persistent-rage")).toThrowError(/no uses remaining \(1\/Long Rest\)/);
  });
});

// Mindless Rage: "You have Immunity to the Charmed and Frightened conditions while your Rage is
// active." A shipped subclass record carrying a gated grant (`grants.when`); `grant-gates.test.ts`
// covers the engine half. On the same character, one `endEffect` apart, `setCondition` narrates the
// skip while Rage runs and Frightened lands once it ends.
describe("Berserker: Mindless Rage refuses Frightened only while the Rage is running", () => {
  const built = () => onTheTable(build(barbarianInput(6)));

  it("carries the gate out of the COMMITTED subclass bundle: the first link", () => {
    const record = view.featureRecord({ kind: "subclass", sourceId: "path-of-the-berserker", id: "mindless-rage" })!;
    expect(record.grants).toMatchObject({
      conditionImmunities: ["charmed", "frightened"],
      when: [{ type: "while-effect-tag", tags: ["raging"] }]
    });
  });

  it("is NOT baked into the definition: a gate the builder cannot evaluate must not be a fact", () => {
    // `interpretFeature` bakes ungated grants into the sheet, and a baked immunity never comes off, so it
    // skips gated blocks.
    const definition = build(barbarianInput(6));
    expect(definition.conditionImmunities ?? []).not.toContain("frightened");
    expect(
      definition.character!.features!.some((ref) => ref.id === "mindless-rage"),
      "the feature must still be ON the sheet - it is the derivation that reads it"
    ).toBe(true);
  });

  it("narrates the skip while Raging, and lets Frightened land once the Rage ends", () => {
    const table = built();
    // Not raging yet: the condition lands exactly as it does for any other character.
    const before = setCondition(
      table.state,
      IDS.hero,
      "frightened",
      true,
      undefined,
      { role: "gm" },
      { resolveDefinition: () => table.definition, catalog }
    );
    expect(before).toEqual([]);
    expect(table.hero.conditions.map((condition) => condition.id)).toEqual(["frightened"]);
    setCondition(
      table.state,
      IDS.hero,
      "frightened",
      false,
      undefined,
      { role: "gm" },
      { resolveDefinition: () => table.definition, catalog }
    );

    // Enter Rage through the real action, so the tag comes from the shipped `rage` record.
    use(table, "rage");
    expect(table.hero.effects.flatMap((effect) => effect.tags)).toContain("raging");

    const during = setCondition(
      table.state,
      IDS.hero,
      "frightened",
      true,
      undefined,
      { role: "gm" },
      { resolveDefinition: () => table.definition, catalog }
    );
    expect(during).toEqual([
      { kind: "condition", text: "Ozar is immune to Frightened, so it isn't applied.", actorId: IDS.hero, immune: true }
    ]);
    expect(table.hero.conditions, "the gate held but the condition landed anyway").toEqual([]);

    // Charmed is the other half of the printed sentence, refused the same way.
    const charmed = setCondition(
      table.state,
      IDS.hero,
      "charmed",
      true,
      undefined,
      { role: "gm" },
      { resolveDefinition: () => table.definition, catalog }
    );
    expect(charmed[0]!.text).toBe("Ozar is immune to Charmed, so it isn't applied.");
    expect(table.hero.conditions).toEqual([]);

    // End the Rage and the immunity goes with it.
    endEffect(table.state, IDS.hero, table.hero.effects[0]!.id);
    expect(table.hero.effects.flatMap((effect) => effect.tags)).not.toContain("raging");
    const after = setCondition(
      table.state,
      IDS.hero,
      "frightened",
      true,
      undefined,
      { role: "gm" },
      { resolveDefinition: () => table.definition, catalog }
    );
    expect(after).toEqual([]);
    expect(table.hero.conditions.map((condition) => condition.id)).toEqual(["frightened"]);
  });

  it("ends Charmed and Frightened as the Rage starts", () => {
    const table = built();
    table.hero.conditions = [{ id: "frightened" }, { id: "charmed" }, { id: "prone" }];
    const raged = use(table, "rage");
    expect(table.hero.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(raged.tableNarration?.map((line) => line.text)).toContain("Ozar is no longer Frightened (Raging).");
    // A level-5 Berserker has no Mindless Rage, so the Rage leaves the condition.
    const early = onTheTable(build(barbarianInput(5)));
    early.hero.conditions = [{ id: "frightened" }];
    use(early, "rage");
    expect(early.hero.conditions.map((condition) => condition.id)).toEqual(["frightened"]);
  });

  it("gives a level-5 Berserker nothing: the feature is gained at 6", () => {
    // Non-vacuity: if the immunity came from anywhere but this feature, a raging level-5 Barbarian would show it too.
    const early = onTheTable(build(barbarianInput(5)));
    use(early, "rage");
    expect(early.hero.effects.flatMap((effect) => effect.tags)).toContain("raging");
    expect(
      setCondition(
        early.state,
        IDS.hero,
        "frightened",
        true,
        undefined,
        { role: "gm" },
        { resolveDefinition: () => early.definition, catalog }
      )
    ).toEqual([]);
    expect(early.hero.conditions.map((condition) => condition.id)).toEqual(["frightened"]);
  });
});

describe("Barbarian: the Epic Boon a level-19 Barbarian lost outright", () => {
  it("lands on the sheet as a real feat", () => {
    // Every class must offer the `epic-boon` feat choice.
    expect(featIds(build(barbarianInput()))).toEqual(["savage-attacker", "boon-of-combat-prowess"]);
    // ...and a level-18 Barbarian has only the background's origin feat, so the boon is the feature's.
    expect(featIds(build(barbarianInput(18)))).toEqual(["savage-attacker"]);
  });

  it("takes any feat the Barbarian qualifies for, refuses one it does not, and refuses the boon before level 19", () => {
    // SRD: "You gain an Epic Boon feat or another feat of your choice for which you qualify."
    const withFeat = (id: string) => {
      const input = barbarianInput();
      input.choices = input.choices
        .filter(
          (row) =>
            row.id !== "boon-of-combat-prowess" &&
            !(row.kind === "ability-score" && row.payload?.featureId === "boon-of-combat-prowess")
        )
        .concat([{ level: 19, classId: "barbarian", kind: "feat", id, payload: { featureId: "epic-boon" } }] as Row[]);
      return input;
    };
    expect(featIds(build(withFeat("alert")))).toEqual(["savage-attacker", "alert"]);
    // Boon of Spell Recall needs the Spellcasting feature, which a Barbarian lacks.
    const recall = withFeat("boon-of-spell-recall");
    recall.choices.push({
      level: 19,
      kind: "ability-score",
      id: "cha",
      payload: { featureId: "boon-of-spell-recall" }
    } as Row);
    expect(() => build(recall)).toThrowError(/Boon of Spell Recall needs the Spellcasting feature/);

    const tooEarly = barbarianInput(18);
    tooEarly.choices.push({
      level: 18,
      classId: "barbarian",
      kind: "feat",
      id: "boon-of-combat-prowess",
      payload: { featureId: "epic-boon" }
    } as Row);
    expect(() => build(tooEarly)).toThrowError(/No feature "epic-boon" offers a "feat" choice/);
  });
});

describe("Barbarian: Intimidating Presence holds the target to the Barbarian's own DC", () => {
  it("derives 8 + Strength + proficiency and spends its long-rest use", () => {
    // A level-14 Berserker: Str 20 (+5), proficiency 5 -> DC 18. The DC is derived (`FeatureSaveDcSchema`),
    // so the level-17 sheet is asserted too, where proficiency alone moves it to 19.
    const built = onTheTable(build(barbarianInput(14)));
    expect(actionOf(built, "intimidating-presence").save).toEqual({
      ability: "wis",
      dc: 18,
      successDamage: "none",
      failureConditions: ["frightened"],
      // "for 1 minute; at the end of each of its turns it repeats the save".
      failureDuration: { type: "rounds", rounds: 10 },
      repeatSave: true
    });
    const resolution = use(built, "intimidating-presence", [IDS.foe]);
    expect(resolution.save).toMatchObject({ ability: "wis", dc: 18 });
    expect(built.hero.actionUses["intimidating-presence"]).toBe(1);

    const later = onTheTable(build(barbarianInput(17)), { fight: false });
    expect(actionOf(later, "intimidating-presence").save).toEqual({
      ability: "wis",
      dc: 19,
      successDamage: "none",
      failureConditions: ["frightened"],
      // "for 1 minute; at the end of each of its turns it repeats the save".
      failureDuration: { type: "rounds", rounds: 10 },
      repeatSave: true
    });
  });

  it("counts PRIMAL CHAMPION's +4 - the capstone the DC used to be computed before", () => {
    // Primal Champion's `ability-score` rider must be folded before this feature's DC is derived from
    // `context.finalScores`, or the sheet contradicts itself (Str 24 beside a DC computed from Str 20).
    // Str 20 at level 16, +4 from the capstone = 24 (+7); proficiency 6. 8 + 7 + 6 = 21.
    const capstone = onTheTable(build(barbarianInput(20)));
    expect(capstone.definition.abilityScores.str).toBe(24);
    expect(actionOf(capstone, "intimidating-presence").save).toEqual({
      ability: "wis",
      dc: 21,
      successDamage: "none",
      failureConditions: ["frightened"],
      // "for 1 minute; at the end of each of its turns it repeats the save".
      failureDuration: { type: "rounds", rounds: 10 },
      repeatSave: true
    });
    // The number the target is held to, which can differ from the one printed on the sheet.
    expect(use(capstone, "intimidating-presence", [IDS.foe]).save).toMatchObject({ ability: "wis", dc: 21 });
  });
});

// Fighter / Champion

describe("healing features heal what they print", () => {
  it("Second Wind heals its user 1d10 plus the Fighter level, and spends a use", () => {
    const built = onTheTable(build(fighterInput(5)));
    expect(built.definition.actions.find((action) => action.id === "second-wind")?.healing).toEqual({
      formula: "1d10 + 5",
      self: true
    });
    built.hero.hp.current = 5;
    const healed = use(built, "second-wind", [], [7]);
    expect(healed.healing?.targets).toEqual([{ targetId: IDS.hero, targetName: built.hero.name, regained: 12 }]);
    expect(built.hero.hp.current).toBe(17);
    expect(built.hero.actionUses["second-wind"]).toBe(1);
  });

  it("Wholeness of Body heals the Monk its Martial Arts die plus the Wisdom modifier", () => {
    // Monk 11: Wisdom 14 + 2 (level 8) = 16, +3; the Martial Arts die is a d10 from level 11.
    const built = onTheTable(build(monkInput(11)));
    expect(built.definition.actions.find((action) => action.id === "wholeness-of-body")?.healing).toEqual({
      formula: "1d10 + 3",
      self: true
    });
    built.hero.hp.current = 10;
    use(built, "wholeness-of-body", [], [4]);
    expect(built.hero.hp.current).toBe(17);
  });
});

describe("Grappler: Punch and Grab, and Fast Wrestler", () => {
  /** A Barbarian 4 who took Grappler (+1 Strength) for the level-4 feat. */
  const grappler = () => {
    const input = barbarianInput(4);
    input.choices = [
      ...input.choices.filter(
        (row) => !(row.level === 4 && (row.kind === "asi-or-feat" || row.kind === "ability-score"))
      ),
      { level: 4, classId: "barbarian", kind: "asi-or-feat", id: "grappler" },
      { level: 4, kind: "ability-score", id: "str", payload: { featureId: "grappler" } }
    ] as Row[];
    return onTheTable(build(input));
  };
  const punch = (built: Built, faces: number[], hitOptions?: Array<{ id: string }>, commit = true) =>
    resolveDefinitionAction(
      built.state,
      builtinActionFor(built.definition, "unarmed-strike")!,
      {
        actorId: IDS.hero,
        targetIds: [IDS.foe],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        builtin: true,
        commit,
        ...(hitOptions ? { hitOptions } : {})
      },
      deps(built, faces)
    );

  it("lets an Unarmed Strike hit in the Attack action both damage and open the Grapple, once a turn", () => {
    const built = grappler();
    expect(offerIds(punch(built, [15], undefined, false))).toContain("punch-and-grab");
    const hit = punch(built, [15], [{ id: "punch-and-grab" }]);
    expect(hit.damageTotal).toBeGreaterThan(0);
    // Strength 18 (+4) and Proficiency Bonus 2: DC 14, the escape DC too.
    const save = built.state.combat.pendingSaves.find((entry) => entry.targetActorId === IDS.foe)!;
    expect(save).toMatchObject({ dc: 14, onFailEffect: { linkedConditionIds: ["grappled"], escapeDc: 14 } });
    built.state.combat.turn = { ...built.state.combat.turn, actionUsed: false, actionInstance: null };
    expect(offerIds(punch(built, [15], undefined, false))).not.toContain("punch-and-grab");
  });

  it("isn't offered without the feat", () => {
    const built = onTheTable(build(barbarianInput(4)));
    expect(offerIds(punch(built, [15], undefined, false))).not.toContain("punch-and-grab");
  });

  it("drags a grappled creature its size or smaller for no extra movement", () => {
    const built = grappler();
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    const resolveDefinition = () => built.definition;
    // The halfling Barbarian is Small: a Small foe comes free, a Medium one still costs the extra foot.
    foe.size = "small";
    expect(dragCostsExtra(built.state, IDS.hero, [IDS.foe], resolveDefinition)).toBe(false);
    foe.size = "medium";
    expect(dragCostsExtra(built.state, IDS.hero, [IDS.foe], resolveDefinition)).toBe(true);
    const plain = onTheTable(build(barbarianInput(4)));
    plain.state.actors.find((actor) => actor.id === IDS.foe)!.size = "small";
    expect(dragCostsExtra(plain.state, IDS.hero, [IDS.foe], () => plain.definition)).toBe(true);
  });
});

describe("Fighter: Tactical Master swaps a mastery for Push, Sap or Slow on one attack", () => {
  const swingWith = (
    built: Built,
    actionId: string,
    faces: number[],
    mastery: "push" | "sap" | "slow",
    commit = false
  ) =>
    resolveDefinitionAction(
      built.state,
      actionOf(built, actionId),
      {
        actorId: IDS.hero,
        targetIds: [IDS.foe],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        mastery,
        commit
      },
      deps(built, faces)
    );

  it("offers Push, Sap and Slow beside the Greatsword's Graze, and a Push pick offers the push", () => {
    const built = onTheTable(build(fighterInput(9)));
    const plain = swing(built, "item-greatsword", [15], { commit: false });
    expect(plain.masteryOptions).toEqual({
      own: { id: "graze", name: "Graze" },
      alternatives: [
        { id: "push", name: "Push" },
        { id: "sap", name: "Sap" },
        { id: "slow", name: "Slow" }
      ]
    });
    expect(plain.push ?? null).toBeNull();
    const pushed = swingWith(built, "item-greatsword", [15], "push");
    expect(pushed.push).toEqual({ targetName: "Foe", maxFeet: 10 });
    expect(pushed.masteryOptions?.picked).toBe("push");
  });

  it("saps the target in place of grazing it", () => {
    const built = onTheTable(build(fighterInput(9)));
    swingWith(built, "item-greatsword", [15, 3, 3, 3, 3], "sap", true);
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(foe.effects.some((effect) => effect.tags.includes("sap"))).toBe(true);
  });

  it("refuses the pick from a Fighter 8, and on an attack with no mastery the Fighter can use", () => {
    const eighth = onTheTable(build(fighterInput(8)));
    expect(swing(eighth, "item-greatsword", [15], { commit: false }).masteryOptions).toBeUndefined();
    expect(() => swingWith(eighth, "item-greatsword", [15], "push")).toThrowError(/doesn't have Tactical Master/);
    const ninth = onTheTable(build(fighterInput(9)));
    // Javelins (Slow) aren't among this Fighter's four masteries.
    expect(() => swingWith(ninth, "item-javelin", [15], "push")).toThrowError(
      /can't use the mastery property of Javelin/
    );
  });
});

describe("Boon of Irresistible Offense: Overwhelming Strike on a rolled 20", () => {
  // Strength 15 + 2 (Soldier) + 2 (level 4) + 1 (level 6) = 20, and the boon's increase makes it 21.
  const boonFighter = () => {
    const input = fighterInput(19);
    input.choices.push(
      {
        level: 19,
        classId: "fighter",
        kind: "feat",
        id: "boon-of-irresistible-offense",
        payload: { featureId: "epic-boon" }
      },
      { level: 19, kind: "ability-score", id: "str", payload: { featureId: "boon-of-irresistible-offense" } }
    );
    return onTheTable(build(input));
  };
  const overwhelming = (resolution: ReturnType<typeof swing>) =>
    resolution.damage.filter((part) => part.formula === "21");

  it("adds damage equal to the increased Strength score, of the attack's type, on a natural 20", () => {
    const built = boonFighter();
    expect(built.definition.abilityScores.str).toBe(21);
    const hit = swing(built, "item-greatsword", [20, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(overwhelming(hit)).toEqual([{ formula: "21", type: "slashing", total: 21 }]);
  });

  it("adds nothing on a 19, though the Champion's 19 is a Critical Hit", () => {
    const built = boonFighter();
    const hit = swing(built, "item-greatsword", [19, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(hit.attack?.outcome).toBe("crit");
    expect(overwhelming(hit)).toEqual([]);
  });
});

describe("Champion: the crit range the resolver reads", () => {
  it("is 19 at level 3, 18 at level 15, and 20 for a Fighter with no subclass yet", () => {
    // The riders name the kinds of attack they widen, so the roll's filters are passed.
    const swing = { attackKinds: ["melee" as const, "weapon" as const] };
    const five = onTheTable(build(fighterInput(5)), { fight: false });
    expect(criticalThreshold(derivationOf(five), five.hero, actionOf(five, "item-greatsword"), swing)).toBe(19);

    // Superior Critical does not replace Improved Critical: `criticalThreshold` takes the lowest any
    // carrier names, so the two compose without an ordering rule.
    const fifteen = onTheTable(build(fighterInput(15)), { fight: false });
    expect(criticalThreshold(derivationOf(fifteen), fifteen.hero, actionOf(fifteen, "item-greatsword"), swing)).toBe(
      18
    );

    const bare = onTheTable(build(fighterInput(2)), { fight: false });
    expect(criticalThreshold(derivationOf(bare), bare.hero, actionOf(bare, "item-greatsword"), swing)).toBe(20);
  });

  it("widens weapon and Unarmed Strike attacks only, never a spell attack", () => {
    // "Your attack rolls with weapons and Unarmed Strikes can score a Critical Hit on a roll of 19 or 20."
    const built = onTheTable(build(fighterInput(5)));
    const fireBolt = {
      id: "fire-bolt",
      name: "Fire Bolt",
      activation: "action" as const,
      description: "Make a ranged spell attack.",
      spellId: "fire-bolt",
      attack: { bonus: 5, rangeFeet: 120 },
      damage: [{ formula: "1d10", type: "fire" }]
    };
    const cast = resolveDefinitionAction(
      built.state,
      fireBolt,
      {
        actorId: IDS.hero,
        targetIds: [IDS.foe],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`
      },
      deps(built, [19, 6])
    );
    expect(cast.attack).toMatchObject({ naturalRoll: 19, outcome: "hit" });
    expect(cast.damageTotal).toBe(6);
  });

  it("turns a natural 19 into a critical hit, and doubles the dice it rolls", () => {
    const built = onTheTable(build(fighterInput(5)));
    // d20 = 19 -> a crit at threshold 19, so the greatsword's 2d6 is rolled twice:
    // 6 + 6 + 5 + 5 plus Str 19's +4 = 26. A 19 without the subclass is an ordinary hit.
    const swung = use(built, "item-greatsword", [IDS.foe], [19, 6, 6, 5, 5]);
    expect(swung.attack).toMatchObject({ naturalRoll: 19, outcome: "crit" });
    expect(swung.damageTotal).toBe(26);

    const plain = onTheTable(build(fighterInput(2)));
    const ordinary = use(plain, "item-greatsword", [IDS.foe], [19, 6, 5]);
    expect(ordinary.attack).toMatchObject({ naturalRoll: 19, outcome: "hit" });
    expect(ordinary.damageTotal).toBe(14); // 6 + 5 + Str 17's +3, dice rolled once
  });
});

describe("Champion: Remarkable Athlete changes the initiative die", () => {
  it("rolls with advantage from level 3", () => {
    const built = onTheTable(build(fighterInput(5)), { fight: false });
    expect(
      initiativeRollMode(
        built.state,
        IDS.hero,
        (id) => (id === built.hero.definitionId ? built.definition : undefined),
        catalog
      )
    ).toBe("advantage");
  });

  // Remarkable Athlete's "and Strength (Athletics) checks": Escape a Grapple narrows to
  // `{ability: "str", skill: "athletics"}` whenever Athletics beats Acrobatics, which is exactly the
  // printed clause. Authoring it needed `clears: ["modifiers"]` because Fighter is hand-authored and the
  // initiative rider was already in the committed record.
  it("keeps the higher die on the Strength (Athletics) escape, and breaks a real grapple with it", () => {
    const grappledChampion = (level: number) => {
      const built = onTheTable(build(fighterInput(level)));
      addEffect(built.state, IDS.hero, {
        id: "grapple",
        name: "Grappled",
        tags: [],
        sourceActorId: IDS.foe,
        sourceName: "Foe",
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "manual" },
        endsWhenSourceDefeated: true,
        voidWhileIncapacitated: false,
        concentration: false,
        modifiers: [],
        linkedConditionIds: ["grappled"],
        escapeDc: 20,
        onEnd: [],
        endsWithTag: null
      });
      return built;
    };

    // Level 5 Champion: Str 19 (+4), Athletics proficient (+3 PB) = +7; Dex 13 (+1) loses the comparison,
    // so Athletics is the branch that rolls and `skill-is: ["athletics"]` matches it.
    const champion = grappledChampion(5);
    const escaped = resolveDefinitionAction(
      champion.state,
      builtinAction("escape-grapple")!,
      {
        actorId: IDS.hero,
        targetIds: [],
        commandId: "50000000-0000-4000-8000-000000000901",
        builtin: true
      },
      deps(champion, [4, 18])
    );
    expect(escaped.check).toMatchObject({
      skill: "Strength (Athletics)",
      naturalRoll: 18,
      dc: 20,
      success: true
    });
    expect(escaped.rollMode).toMatchObject({ mode: "advantage", advantage: ["Remarkable Athlete"] });
    expect(champion.state.rolls.find((roll) => roll.purpose === "check")!.dice.map((die) => die.kept)).toEqual([
      false,
      true
    ]);
    expect(champion.hero.effects, "the grapple should have ended").toEqual([]);

    // Control: a level-2 Fighter has no subclass and no such rider. Same queue, same DC, one die, and the
    // grapple holds.
    const plain = grappledChampion(2);
    const stuck = resolveDefinitionAction(
      plain.state,
      builtinAction("escape-grapple")!,
      {
        actorId: IDS.hero,
        targetIds: [],
        commandId: "50000000-0000-4000-8000-000000000902",
        builtin: true
      },
      deps(plain, [4, 18])
    );
    expect(stuck.check).toMatchObject({ naturalRoll: 4, success: false });
    expect(stuck.rollMode).toBeUndefined();
    expect(plain.state.rolls.find((roll) => roll.purpose === "check")!.dice).toHaveLength(1);
    expect(plain.hero.effects).toHaveLength(1);
  });

  it('does not reach Hide or Study - `skill-is: ["athletics"]` fails closed on a check that passes no skill', () => {
    for (const [n, actionId] of [
      [911, "hide"],
      [912, "study"],
      [913, "search"]
    ] as const) {
      const built = onTheTable(build(fighterInput(5)));
      const resolution = resolveDefinitionAction(
        built.state,
        builtinAction(actionId)!,
        {
          actorId: IDS.hero,
          targetIds: [],
          commandId: `50000000-0000-4000-8000-000000000${n}`,
          builtin: true
        },
        deps(built, [4, 18])
      );
      // Hide is a Dexterity (Stealth) check, which this fighter's Chain Mail puts at Disadvantage; no
      // Advantage reaches any of the three.
      expect(resolution.rollMode?.advantage ?? [], `${actionId} must not see an Athletics-narrowed rider`).toEqual([]);
      expect(resolution.rollMode?.disadvantage ?? []).toEqual(actionId === "hide" ? ["Chain Mail (Stealth)"] : []);
      expect(resolution.check!.naturalRoll).toBe(4);
    }
  });
});

describe("Fighter: EXTRA ATTACK is a second swing that really resolves", () => {
  // Extra Attack: no martial class declares a feature action (every swing derives from equipped
  // inventory), so a count on the definition proves nothing. The assertion is a second attack
  // resolving and a third being refused.
  const foeAc = 13;

  it("resolves TWO swings on one action slot at level 5, then refuses the third", () => {
    // Str 19 (+4) + proficiency 3 = +7 to hit; against AC 13 a natural 9 hits.
    const built = onTheTable(build(fighterInput(5)));
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.armorClass).toBe(foeAc);

    const first = use(built, "item-greatsword", [IDS.foe], [9, 5, 5]);
    expect(first.attack?.outcome).toBe("hit");
    // The second swing is open, as a generic pool.
    expect(first.componentsRemaining).toEqual({ attack: 1 });

    // SRD Extra Attack lets the second swing be a different weapon, which is why the pool is generic.
    const second = use(built, "item-flail", [IDS.foe], [14, 6]);
    expect(second.attack?.outcome).toBe("hit");
    expect(second.componentsRemaining).toBeNull();

    // ...and the third is refused, so the count is a real budget.
    expect(() => use(built, "item-greatsword", [IDS.foe], [18, 5, 5])).toThrow(/no attacks remaining in this action/);
  });

  it("is ONE swing at level 4, the level before the feature is gained", () => {
    // Negative control: same sheet, same weapon, one level earlier. No pool may open.
    const built = onTheTable(build(fighterInput(4)));
    expect(actionOf(built, "item-greatsword").attack?.count ?? 1).toBe(1);
    const only = use(built, "item-greatsword", [IDS.foe], [9, 5, 5]);
    expect(only.componentsRemaining).toBeNull();
    expect(() => use(built, "item-flail", [IDS.foe], [14, 6])).toThrow(/already used an action/);
  });

  it("counts THREE swings at level 11, off the Fighter's own second tier", () => {
    // `two-extra-attacks` is a separate feature with `count: 2`; the tiers are read as an absolute total,
    // not summed on top of the level-5 rider.
    const built = onTheTable(build(fighterInput(11)));
    expect(actionOf(built, "item-greatsword").attack?.count).toBe(3);
    expect(use(built, "item-greatsword", [IDS.foe], [9, 5, 5]).componentsRemaining).toEqual({ attack: 2 });
    expect(use(built, "item-flail", [IDS.foe], [14, 6]).componentsRemaining).toEqual({ attack: 1 });
    // Exhausted reads as `null`: the resolver reports remaining components only while
    // some remain.
    expect(use(built, "item-spear", [IDS.foe], [16, 4]).componentsRemaining).toBeNull();
    expect(() => use(built, "item-greatsword", [IDS.foe], [18, 5, 5])).toThrow(/no attacks remaining in this action/);
  });

  it("does NOT multiply a non-weapon action that happens to roll to hit", () => {
    // Extra Attack applies "whenever you take the Attack action", so it may only raise a derived weapon
    // swing; every other action on the sheet keeps its declared count.
    const built = onTheTable(build(fighterInput(11)));
    const swings = new Set(derivationOf(built).weaponActionIds);
    for (const action of effectiveActions(built.definition, built.hero, catalog)) {
      if (!action.attack || swings.has(action.id)) continue;
      expect({ id: action.id, count: action.attack.count ?? 1 }).toEqual({ id: action.id, count: 1 });
    }
  });
});

describe("Fighter: Action Surge is one more action on the turn", () => {
  const generic = (built: Built, actionId: string) =>
    resolveDefinitionAction(
      built.state,
      builtinAction(actionId)!,
      {
        actorId: IDS.hero,
        targetIds: [],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        builtin: true
      },
      deps(built)
    );

  it("opens a second Attack action, Extra Attack and all, then refuses a third action", () => {
    const built = onTheTable(build(fighterInput(5)));
    use(built, "item-greatsword", [IDS.foe], [9, 5, 5]);
    use(built, "item-greatsword", [IDS.foe], [9, 5, 5]);
    expect(() => use(built, "item-greatsword", [IDS.foe], [9, 5, 5])).toThrow(/no attacks remaining in this action/);
    use(built, "action-surge");
    expect(built.hero.actionUses["action-surge"]).toBe(1);
    // The surge's action is a whole Attack action: two swings again.
    expect(use(built, "item-greatsword", [IDS.foe], [9, 5, 5]).componentsRemaining).toEqual({ attack: 1 });
    use(built, "item-greatsword", [IDS.foe], [9, 5, 5]);
    expect(() => use(built, "item-greatsword", [IDS.foe], [9, 5, 5])).toThrow(/no attacks remaining in this action/);
  });

  it("is not a second Magic action, is taken on your own turn, and only once on a turn", () => {
    // Level 17: two uses, still one a turn.
    const built = onTheTable(build(fighterInput(17)));
    generic(built, "magic");
    use(built, "action-surge");
    expect(() => generic(built, "magic")).toThrow(/can't be a second Magic action/);
    generic(built, "dash");
    expect(() => use(built, "action-surge")).toThrow(/works once on a turn/);
    nextInitiativeTurn(built.state);
    expect(() => use(built, "action-surge")).toThrow(/own turn/);
  });
});

describe("Barbarian and Monk get the same second swing: it was never Fighter-only", () => {
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

// Monk

describe("Monk: the sheet's own numbers", () => {
  const twenty = build(monkInput(20));

  it("Unarmored Defense is 10 + Dex + WISDOM: the other half of the shared feature id", () => {
    expect(twenty.abilityScores).toMatchObject({ dex: 24, wis: 24 });
    expect(twenty.armorClass).toBe(24); // 10 + 7 + 7
  });

  it("Unarmored Movement follows the printed column on the speed the token moves at", () => {
    // Halfling 30. The bonus waits for the live loadout, so the stored walking speed stays 30.
    const speedAt = (level: number) => {
      const built = onTheTable(build(monkInput(level)), { fight: false });
      return currentSpeedFeet(built.hero, derivationOf(built));
    };
    expect(twenty.speedFeet).toBe(30);
    expect(speedAt(1)).toBe(30);
    expect(speedAt(2)).toBe(40);
    expect(speedAt(6)).toBe(45);
    expect(speedAt(20)).toBe(60);
  });

  it("Body and Mind passes 20, and Disciplined Survivor makes every save proficient", () => {
    expect(twenty.abilityScores.dex).toBeGreaterThan(20);
    expect([...twenty.proficiencies!.saves].sort()).toEqual(["cha", "con", "dex", "int", "str", "wis"]);
    // The negative control: a level-11 Monk has only the class's printed two.
    expect([...build(monkInput(11)).proficiencies!.saves].sort()).toEqual(["dex", "str"]);
  });
});

// A built Monk gets its own Unarmed Strike that reads the printed Martial Arts die column (1:1d6 ...
// 17:1d12), may use Dexterity, counts as a weapon action for Extra Attack, and is what Flurry of Blows
// grants.
describe("Monk: Martial Arts is an Unarmed Strike the engine can really roll", () => {
  it("reads the printed column at this character's own level, at Dexterity", () => {
    // The Martial Arts column with Dexterity: Dex 17 (+3) at 1, 19 (+4) from the level-4 ASI, 20 (+5) at
    // 17, 24 (+7) once Body and Mind lands.
    const strike = (level: number) => build(monkInput(level)).actions.find((action) => action.id === "unarmed-strike");
    for (const [level, bonus, formula] of [
      [1, 5, "1d6 + 3"],
      [4, 6, "1d6 + 4"],
      [5, 7, "1d8 + 4"],
      [11, 8, "1d10 + 4"],
      [17, 11, "1d12 + 5"],
      [20, 13, "1d12 + 7"]
    ] as const) {
      expect(strike(level), `L${level}`).toMatchObject({
        name: "Unarmed Strike",
        activation: "action",
        attack: { bonus, reachFeet: 5 },
        damage: [{ formula, type: "bludgeoning" }]
      });
    }
  });

  it("takes STRENGTH when Strength is the better one: it is 'instead of', not 'always Dexterity'", () => {
    // Str 15 (+2) against Dex 12 (+1): +2 and 1d6 + 2; a hard-coded Dexterity would read +1.
    const strong = build({ ...monkInput(1), baseScores: { str: 15, dex: 10, con: 13, int: 12, wis: 14, cha: 8 } });
    expect(strong.abilityScores).toMatchObject({ str: 15, dex: 12 });
    expect(strong.actions.find((action) => action.id === "unarmed-strike")).toMatchObject({
      attack: { bonus: 4 },
      damage: [{ formula: "1d6 + 2", type: "bludgeoning" }]
    });
  });

  it("is a WEAPON swing, so Extra Attack reaches it at 5 and not at 4", () => {
    const five = onTheTable(build(monkInput(5)));
    expect(derivationOf(five).weaponActionIds).toContain("unarmed-strike");
    expect(actionOf(five, "unarmed-strike").attack?.count).toBe(2);
    // ...and the second swing is tracked: one strike leaves one attack in the pool.
    expect(use(five, "unarmed-strike", [IDS.foe], [17, 5]).componentsRemaining).toEqual({ attack: 1 });

    const four = onTheTable(build(monkInput(4)));
    expect(actionOf(four, "unarmed-strike").attack?.count ?? 1).toBe(1);
  });

  it("rolls the Martial Arts die, and NOT the builtin's flat 1 + Strength", () => {
    // Dex 19 (+4), Proficiency 3: 17 + 7 = 24 against AC 13, then 1d8 + 4 on the 5.
    const built = onTheTable(build(monkInput(5)));
    const swung = use(built, "unarmed-strike", [IDS.foe], [17, 5]);
    expect(swung.attack).toMatchObject({ total: 24, outcome: "hit" });
    expect(swung.damage).toEqual([{ formula: "1d8 + 4", type: "bludgeoning", total: 9 }]);
    // The builtin's damage is 1 + Str (+1) = 2 Bludgeoning via `bonusDamage`. The Monk's strike shadows
    // that id, so it must not be paid a second time.
    expect(swung.damageTotal).toBe(9);
  });

  it("gives a Monk weapon the Martial Arts die and the better of Dex or Str, until a shield comes out", () => {
    // Dex 19 (+4) over Str 12 (+1), Proficiency 3. The kit's Spear is a Simple melee weapon: 1d6 + Str before.
    const built = onTheTable(build(monkInput(5)));
    expect(built.definition.character?.martialArts).toEqual({ die: "1d8" });
    const spear = built.hero.inventory.find((item) => item.name.toLowerCase() === "spear")!;
    built.hero.inventory = built.hero.inventory.map((item) =>
      item.id === spear.id ? { ...item, equipped: true } : item
    );
    expect(actionOf(built, `item-${spear.id}`).attack?.bonus).toBe(7);
    expect(actionOf(built, `item-${spear.id}`).damage).toEqual([{ formula: "1d8 + 4", type: "piercing" }]);

    // A shield ends Martial Arts: back to Strength and the Spear's own die.
    built.hero.inventory = [
      ...built.hero.inventory,
      {
        ...spear,
        id: "shield-1",
        name: "Shield",
        equipped: true,
        weapon: undefined,
        slot: "shield",
        armor: {
          acBase: 2,
          addDexModifier: false,
          dexModifierCap: null,
          stealthDisadvantage: false,
          strengthRequired: null
        }
      } as (typeof built.hero.inventory)[number]
    ];
    expect(actionOf(built, `item-${spear.id}`).damage).toEqual([{ formula: "1d6 + 1", type: "piercing" }]);
  });

  it("leaves every other class on the generic builtin", () => {
    // A class with no Martial Arts column mints nothing; a Fighter uses the shared builtin Unarmed Strike.
    expect(build(fighterInput(5)).actions.some((action) => action.id === "unarmed-strike")).toBe(false);
    expect(build(barbarianInput(5)).actions.some((action) => action.id === "unarmed-strike")).toBe(false);
  });
});

describe("Monk: Martial Arts sets the Grapple and Shove DC with Dexterity", () => {
  const shove = (built: Built) =>
    resolveDefinitionAction(
      built.state,
      builtinActionFor(built.definition, "unarmed-shove-prone")!,
      {
        actorId: IDS.hero,
        targetIds: [IDS.foe],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        builtin: true
      },
      deps(built)
    );
  const dcOf = (built: Built) => built.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.foe)?.dc;

  it("holds the target to 8 + Dexterity + Proficiency Bonus while Martial Arts holds, and Strength in armor", () => {
    // Monk 1: Str 12 (+1), Dex 17 (+3), Proficiency Bonus 2.
    const built = onTheTable(build(monkInput(1)));
    shove(built);
    expect(dcOf(built)).toBe(13);
    const armored = onTheTable(build(monkInput(1)));
    armored.hero.inventory.push({
      id: "leather-armor",
      name: "Leather Armor",
      quantity: 1,
      equipped: true,
      attuned: false,
      category: "armor",
      armor: {
        acBase: 11,
        addDexModifier: true,
        dexModifierCap: null,
        stealthDisadvantage: false,
        strengthRequired: null
      }
    } as (typeof armored.hero.inventory)[number]);
    shove(armored);
    expect(dcOf(armored)).toBe(11);
  });
});

describe("Monk: Flurry of Blows opens its own Unarmed Strikes", () => {
  it("opens two strikes as a Bonus Action, each spent by an Unarmed Strike, leaving the Attack action alone", () => {
    const built = onTheTable(build(monkInput(5)));
    expect(actionOf(built, "flurry-of-blows").multiattack).toEqual([{ actionId: "unarmed-strike", count: 2 }]);
    use(built, "flurry-of-blows");
    expect(built.state.combat.turn.bonusActionUsed).toBe(true);
    expect(built.state.combat.turn.bonusActionInstance?.components).toEqual({ "unarmed-strike": 2 });

    use(built, "unarmed-strike", [IDS.foe], [17, 5]);
    use(built, "unarmed-strike", [IDS.foe], [17, 5]);
    expect(built.state.combat.turn.bonusActionInstance?.components).toEqual({ "unarmed-strike": 0 });
    // Both strikes came from the Flurry: the action is still free for the Attack action.
    expect(built.state.combat.turn.actionUsed).toBe(false);
    use(built, "unarmed-strike", [IDS.foe], [17, 5]);
    expect(built.state.combat.turn.actionUsed).toBe(true);
  });

  it("makes it three strikes from Monk level 10", () => {
    const built = onTheTable(build(monkInput(10)));
    expect(actionOf(built, "flurry-of-blows").multiattack).toEqual([{ actionId: "unarmed-strike", count: 3 }]);
  });
});

describe("Monk: the Bonus Action forms Martial Arts and Monk's Focus give", () => {
  /** A generic action this Monk can take by id, the Bonus Action forms its features give included. */
  const take = (built: Built, actionId: string, targetIds: string[] = [], faces: number[] = []) =>
    resolveDefinitionAction(
      built.state,
      builtinActionFor(built.definition, actionId)!,
      {
        actorId: IDS.hero,
        targetIds,
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        builtin: true
      },
      deps(built, faces)
    );

  it("makes an Unarmed Strike as a Bonus Action with the Martial Arts numbers, after the Attack action", () => {
    // Monk 5: Dex 19 (+4), proficiency 3, the 1d8 Martial Arts die; Extra Attack makes the Attack action two swings.
    const built = onTheTable(build(monkInput(5)));
    use(built, "unarmed-strike", [IDS.foe], [17, 5]);
    use(built, "unarmed-strike", [IDS.foe], [17, 5]);
    expect(built.state.combat.turn.actionUsed).toBe(true);
    const bonus = take(built, "unarmed-strike-bonus", [IDS.foe], [17, 6]);
    expect(bonus.attack).toMatchObject({ total: 24, outcome: "hit" });
    expect(bonus.damage).toEqual([{ formula: "1d8 + 4", type: "bludgeoning", total: 10 }]);
    expect(bonus.damageTotal).toBe(10);
    expect(built.state.combat.turn.bonusActionUsed).toBe(true);
    // One strike: Extra Attack belongs to the Attack action alone.
    expect(builtinActionFor(built.definition, "unarmed-strike-bonus")!.attack?.count).toBeUndefined();
    expect(() => take(built, "unarmed-strike-bonus", [IDS.foe], [17, 6])).toThrow(/already used a Bonus Action/);
  });

  it("takes Disengage or Dash alone as a Bonus Action for no Focus Point", () => {
    const built = onTheTable(build(monkInput(2)));
    expect(builtinActionFor(built.definition, "disengage-bonus")?.name).toBe("Patient Defense: Disengage");
    expect(builtinActionFor(built.definition, "dash-bonus")?.name).toBe("Step of the Wind: Dash");
    take(built, "dash-bonus");
    expect(built.hero.effects.find((effect) => effect.tags.includes("dashing"))?.movementGrantFeet).toBe(40);
    expect(built.hero.actionUses["focus-points"]).toBeUndefined();
    // A level-1 Monk has Martial Arts but not Monk's Focus yet.
    expect(builtinActionFor(build(monkInput(1)), "dash-bonus")).toBeUndefined();
  });

  it("spends a Focus Point to take Disengage and Dash together (Step of the Wind)", () => {
    const built = onTheTable(build(monkInput(2)));
    const step = use(built, "step-of-the-wind");
    expect(step.effectGranted).toEqual({ name: "Step of the Wind", tags: ["disengaged", "dashing"] });
    expect(built.hero.actionUses["focus-points"]).toBe(1);
    const effect = built.hero.effects.find((entry) => entry.tags.includes("dashing"))!;
    expect(effect.tags).toContain("disengaged");
    // Speed 40 at Monk 2 (Unarmored Movement): the Dash is worth that much extra movement.
    expect(effect.movementGrantFeet).toBe(40);
  });

  it("spends a Focus Point to take Disengage and Dodge together (Patient Defense)", () => {
    const built = onTheTable(build(monkInput(2)));
    use(built, "patient-defense");
    const effect = built.hero.effects.find((entry) => entry.tags.includes("dodging"))!;
    expect(effect.tags).toEqual(["disengaged", "dodging"]);
    expect(effect.modifiers).toContainEqual({
      type: "roll-mode",
      roll: "incoming-attack",
      mode: "disadvantage",
      when: [{ type: "on-attack-roll" }, { type: "sees-other" }]
    });
    // Dodge's half lapses at Speed 0 or while Incapacitated, as the Dodge action does.
    expect(effect.voidWhileIncapacitated).toBe(true);
    expect(built.hero.actionUses["focus-points"]).toBe(1);
    expect(built.hero.hp.temporary ?? 0).toBe(0);
  });

  it("gives a Monk 10's paid Patient Defense Temporary Hit Points of two Martial Arts dice (Heightened Focus)", () => {
    const built = onTheTable(build(monkInput(10)));
    expect(actionOf(built, "patient-defense").healing).toEqual({ formula: "2d8", self: true, temporary: true });
    use(built, "patient-defense", [], [5, 7]);
    expect(built.hero.hp.temporary).toBe(12);
    expect(built.hero.effects.some((entry) => entry.tags.includes("dodging"))).toBe(true);
    expect(actionOf(onTheTable(build(monkInput(17))), "patient-defense").healing?.formula).toBe("2d12");
  });
});

describe("Monk: Focus Points are ONE pool, read off the printed column and really spent", () => {
  it("gives all three activations the same counter, sized by the class table", () => {
    const built = onTheTable(build(monkInput(20)));
    for (const id of ["flurry-of-blows", "patient-defense", "step-of-the-wind"]) {
      expect(actionOf(built, id).uses, id).toEqual({ limit: 20, per: "short-rest", pool: "focus-points" });
    }
    // Read from the column: a level-11 Monk prints 11.
    const eleven = onTheTable(build(monkInput(11)));
    expect(actionOf(eleven, "flurry-of-blows").uses).toEqual({ limit: 11, per: "short-rest", pool: "focus-points" });
  });

  it("spends ONE counter across DIFFERENT actions, and across different FEATURES", () => {
    const built = onTheTable(build(monkInput(11)));
    use(built, "flurry-of-blows");
    // Stunning Strike is a different feature record entirely, and it draws on the same counter as it rides a hit.
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "stunning-strike" }] });
    // A fresh turn, so the Bonus Action economy allows the third press: Step of the Wind takes the third point.
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
    expect(() => use(built, "flurry-of-blows")).toThrowError(/no uses remaining \(11\/Short Rest\)/);
  });
});

describe("Monk: Stunning Strike holds the target to the Monk's own DC", () => {
  it("derives 8 + Wisdom + proficiency and draws on the SAME Focus Points pool", () => {
    // Wis 16 (+3) at level 11, proficiency 4: DC 15.
    const built = onTheTable(build(monkInput(11)));
    expect(actionOf(built, "stunning-strike").save).toEqual({
      ability: "con",
      dc: 15,
      successDamage: "none",
      failureConditions: ["stunned"],
      // "until the start of your next turn".
      failureDuration: { type: "until-source-next-turn" },
      successEffect: expect.objectContaining({ name: "Stunning Strike" })
    });
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "stunning-strike" }] });
    expect(built.state.combat.pendingSaves).toMatchObject([
      { targetActorId: IDS.foe, ability: "con", dc: 15, actionName: "Stunning Strike" }
    ]);
    expect(built.hero.actionUses["focus-points"]).toBe(1);
  });

  it("counts BODY AND MIND's +4 - the same ordering bug, one class over", () => {
    // Body and Mind (+4 Dex/Wis, ceiling 25) must apply before Stunning Strike's Wisdom-derived DC.
    // Wis 20 by level 19 (16 at L8, 17 at L12, 19 at L16, 20 from Boon of the Night Spirit), +4 from
    // the capstone = 24 (+7); proficiency 6. 8 + 7 + 6 = 21.
    const capstone = onTheTable(build(monkInput(20)));
    expect(capstone.definition.abilityScores.wis).toBe(24);
    expect(actionOf(capstone, "stunning-strike").save).toEqual({
      ability: "con",
      dc: 21,
      successDamage: "none",
      failureConditions: ["stunned"],
      // "until the start of your next turn".
      failureDuration: { type: "until-source-next-turn" },
      successEffect: expect.objectContaining({ name: "Stunning Strike" })
    });
    swing(capstone, "unarmed-strike", [17, 6], { hitOptions: [{ id: "stunning-strike" }] });
    expect(capstone.state.combat.pendingSaves).toMatchObject([{ ability: "con", dc: 21 }]);
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

  it("costs the 3 Focus Points it prints, and is refused with 2 left", () => {
    // "At the start of your turn, you can expend 3 Focus Points".
    const built = onTheTable(build(monkInput(20)));
    built.hero.actionUses = { "focus-points": 17 };
    use(built, "superior-defense");
    expect(built.hero.actionUses["focus-points"]).toBe(20);
    const short = onTheTable(build(monkInput(20)));
    short.hero.actionUses = { "focus-points": 18 };
    expect(() => use(short, "superior-defense")).toThrowError("Superior Defense has 2 left, and this spends 3.");
  });
});

describe("Monk: Superior Defense at the start of the turn, until the Monk is Incapacitated", () => {
  const defended = (built: Built) => built.hero.effects.find((effect) => effect.tags.includes("superior-defense"));

  it("is taken at the start of the Monk's turn and refused once the turn is under way", () => {
    const built = onTheTable(build(monkInput(18)));
    use(built, "superior-defense");
    expect(defended(built)).toBeDefined();
    const later = onTheTable(build(monkInput(18)));
    use(later, "unarmed-strike", [IDS.foe], [17, 5]);
    expect(() => use(later, "superior-defense")).toThrowError(
      "Superior Defense is used at the start of Shan's turn, before it moves or acts."
    );
    // Another creature's turn is no start of the Monk's.
    const offTurn = onTheTable(build(monkInput(18)));
    nextInitiativeTurn(offTurn.state);
    expect(() => use(offTurn, "superior-defense")).toThrowError("Superior Defense is used on Shan's own turn.");
  });

  it("ends when the Monk is Stunned, and stays ended once the condition goes", () => {
    const built = onTheTable(build(monkInput(18)));
    use(built, "superior-defense");
    setCondition(built.state, IDS.hero, "stunned", true, undefined, { role: "gm" });
    expect(defended(built)).toBeUndefined();
    setCondition(built.state, IDS.hero, "stunned", false, undefined, { role: "gm" });
    expect(defended(built)).toBeUndefined();
  });

  it("ends when the Monk drops to 0 Hit Points", () => {
    const built = onTheTable(build(monkInput(18)));
    use(built, "superior-defense");
    applyDamageDetailed(built.state, IDS.hero, { amount: 500 }, { role: "gm" });
    expect(defended(built)).toBeUndefined();
  });
});

describe("Open Hand: Fleet Step takes Step of the Wind right after another Bonus Action", () => {
  /** A generic action this Monk can take by id, the Bonus Action forms its features give included. */
  const take = (built: Built, actionId: string) =>
    resolveDefinitionAction(
      built.state,
      builtinActionFor(built.definition, actionId)!,
      {
        actorId: IDS.hero,
        targetIds: [],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        builtin: true
      },
      deps(built)
    );

  it("lets a Monk 11 use Step of the Wind after Flurry of Blows, once", () => {
    const built = onTheTable(build(monkInput(11)));
    use(built, "flurry-of-blows");
    use(built, "step-of-the-wind");
    expect(built.hero.effects.some((effect) => effect.tags.includes("dashing"))).toBe(true);
    // Step of the Wind twice isn't Fleet Step's.
    expect(() => take(built, "dash-bonus")).toThrowError(/already used a Bonus Action/);
  });

  it("takes the free Step of the Wind the same way", () => {
    const built = onTheTable(build(monkInput(11)));
    use(built, "flurry-of-blows");
    take(built, "dash-bonus");
    expect(built.hero.effects.some((effect) => effect.tags.includes("dashing"))).toBe(true);
  });

  it("gives a Monk 10 no second Bonus Action, and nothing after Step of the Wind itself", () => {
    const tenth = onTheTable(build(monkInput(10)));
    use(tenth, "flurry-of-blows");
    expect(() => use(tenth, "step-of-the-wind")).toThrowError(/already used a Bonus Action/);
    const built = onTheTable(build(monkInput(11)));
    use(built, "step-of-the-wind");
    expect(() => take(built, "dash-bonus")).toThrowError(/already used a Bonus Action/);
  });
});

describe("Monk: Quivering Palm starts on an Unarmed Strike hit and ends on the marked creature", () => {
  it("spends the 4 Focus Points marking the hit creature, and ending it spends none", () => {
    const built = onTheTable(build(monkInput(20)));
    // "When you hit a creature with an Unarmed Strike, you can expend 4 Focus Points to start these vibrations".
    expect(offerIds(swing(built, "unarmed-strike", [17], { commit: false }))).toContain("quivering-palm-start");
    swing(built, "unarmed-strike", [17, 6], { hitOptions: [{ id: "quivering-palm-start" }] });
    expect(built.hero.actionUses["focus-points"]).toBe(4);
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    // "Which last for a number of days equal to your Monk level": 20 days on the game clock.
    expect(foe.effects).toMatchObject([
      {
        name: "Quivering Palm",
        tags: ["quivering-palm"],
        sourceActorId: IDS.hero,
        duration: { type: "minutes", remaining: 20 * 24 * 60 }
      }
    ]);
    // Ending it: the Constitution save against 10d12 Force, and no Focus Point.
    const ended = use(built, "quivering-palm", [IDS.foe], [12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
    expect(ended.damage).toEqual([{ formula: "10d12", type: "force", total: 120 }]);
    expect(ended.save).toMatchObject({ ability: "con", dc: 21 });
    expect(built.hero.actionUses["focus-points"]).toBe(4);
    expect(foe.effects).toEqual([]);
  });

  it("refuses to end vibrations in a creature that has none, and takes one attack of the Attack action", () => {
    const built = onTheTable(build(monkInput(20)));
    expect(() => use(built, "quivering-palm", [IDS.foe], [12])).toThrowError(
      /Quivering Palm targets the creature Shan marked with it, and Foe isn't marked/
    );
    expect(actionOf(built, "quivering-palm").replacesAttack).toBe(true);
  });

  it("keeps one creature at a time: a second mark ends the first", () => {
    const built = onTheTable(build(monkInput(20)));
    const other = { ...built.state.actors.find((actor) => actor.id === IDS.foe)!, id: OTHER, name: "Other" };
    built.state.actors.push(other);
    built.state.combat.initiative.push({ actorId: OTHER, score: 5 } as (typeof built.state.combat.initiative)[number]);
    swing(built, "unarmed-strike", [17, 6], { hitOptions: [{ id: "quivering-palm-start" }] });
    resolveDefinitionAction(
      built.state,
      actionOf(built, "unarmed-strike"),
      {
        actorId: IDS.hero,
        targetIds: [OTHER],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        hitOptions: [{ id: "quivering-palm-start" }]
      },
      deps(built, [17, 6])
    );
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    const second = built.state.actors.find((actor) => actor.id === OTHER)!;
    expect(foe.effects).toEqual([]);
    expect(second.effects).toMatchObject([{ name: "Quivering Palm" }]);
  });
});

describe("Monk: Wholeness of Body counts uses off an ability modifier", () => {
  it("is Wisdom-many at level 11 and re-armed by a Long Rest, with a floor of one", () => {
    // Wis 16 (+3) -> three uses. `minimum: 1` is the printed "(minimum of once)".
    const built = onTheTable(build(monkInput(11)));
    expect(actionOf(built, "wholeness-of-body").uses).toEqual({ limit: 3, per: "long-rest" });
    // It heals now, so its Martial Arts die is rolled.
    use(built, "wholeness-of-body", [], [4]);
    expect(built.hero.actionUses["wholeness-of-body"]).toBe(1);
  });
});

describe("Monk: Uncanny Metabolism is a counter, and the Epic Boon is a feat", () => {
  it("spends one long-rest use, and refuses the second", () => {
    const built = onTheTable(build(monkInput(11)));
    use(built, "uncanny-metabolism");
    expect(built.hero.actionUses["uncanny-metabolism"]).toBe(1);
    expect(() => use(built, "uncanny-metabolism")).toThrowError(/no uses remaining \(1\/Long Rest\)/);
  });

  it("puts the level-19 boon on the sheet", () => {
    expect(featIds(build(monkInput(20)))).toEqual(["alert", "boon-of-the-night-spirit"]);
    expect(featIds(build(monkInput(11)))).toEqual(["alert"]);
  });
});

// SRD Rage: "The Rage lasts until the end of your next turn, and it ends early if you don Heavy armor or have the
// Incapacitated condition", each attack roll against an enemy, forced save or Bonus Action extending it; and "you
// can't maintain Concentration, and you can't cast spells".
describe("Barbarian: Rage lasts while it is fed, and stops spells and Concentration", () => {
  const raging = (built: Built) => built.hero.effects.find((effect) => effect.tags.includes("raging"));

  it("lasts until the end of the next turn, and an attack extends it", () => {
    const built = onTheTable(build(barbarianInput(5)));
    use(built, "rage");
    expect(raging(built)!.duration).toEqual({ type: "until-source-turn-end", skipsCurrentTurn: true });
    nextInitiativeTurn(built.state); // the Barbarian's own turn ends: the Rage holds
    nextInitiativeTurn(built.state); // the foe's ends; the Barbarian's next turn begins
    expect(raging(built)).toBeDefined();
    use(built, "item-greataxe", [IDS.foe], [3, 8]);
    nextInitiativeTurn(built.state); // it attacked, so the Rage carries over
    nextInitiativeTurn(built.state);
    expect(raging(built)).toBeDefined();
    nextInitiativeTurn(built.state); // a turn with no attack ends it
    expect(raging(built)).toBeUndefined();
  });

  it("a Bonus Action re-declaring Rage extends it for no use", () => {
    const built = onTheTable(build(barbarianInput(5)));
    use(built, "rage");
    expect(built.hero.actionUses.rage).toBe(1);
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    use(built, "rage");
    expect(built.hero.actionUses.rage).toBe(1);
    nextInitiativeTurn(built.state);
    expect(raging(built)).toBeDefined();
  });

  it("is refused in Heavy armor before a use or the Bonus Action is spent", () => {
    const built = onTheTable(build(barbarianInput(5)));
    built.hero.inventory.push({
      id: "plate-armor",
      name: "Plate Armor",
      quantity: 1,
      equipped: true,
      attuned: false,
      category: "armor",
      armor: {
        acBase: 18,
        addDexModifier: false,
        dexModifierCap: null,
        stealthDisadvantage: true,
        strengthRequired: 15
      }
    } as (typeof built.hero.inventory)[number]);
    expect(() => use(built, "rage")).toThrowError("Ozar is wearing Heavy armor and can't enter a Rage.");
    expect(built.hero.actionUses.rage).toBeUndefined();
    expect(built.state.combat.turn.bonusActionUsed).toBe(false);
    expect(raging(built)).toBeUndefined();
  });

  it("is extended by an attack against an enemy, and an attack on an ally doesn't feed it", () => {
    const built = onTheTable(build(barbarianInput(5)));
    const ally = { ...built.state.actors.find((actor) => actor.id === IDS.foe)!, id: OTHER, name: "Ally" };
    built.state.actors.push({ ...ally, kind: "player-character" });
    built.state.combat.initiative.push({ actorId: OTHER, score: 5 } as (typeof built.state.combat.initiative)[number]);
    use(built, "rage");
    nextInitiativeTurn(built.state); // the Barbarian's own turn ends: the Rage holds
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state); // the Barbarian's next turn begins
    use(built, "item-greataxe", [OTHER], [3, 8]);
    nextInitiativeTurn(built.state);
    expect(raging(built)).toBeUndefined();
  });

  it("ends when the Barbarian is Incapacitated", () => {
    const built = onTheTable(build(barbarianInput(5)));
    use(built, "rage");
    setCondition(built.state, IDS.hero, "stunned", true, undefined, { role: "gm" });
    expect(raging(built)).toBeUndefined();
  });

  it("is extended for 10 minutes at most, a re-declared Rage keeping the round it began", () => {
    const built = onTheTable(build(barbarianInput(5)));
    use(built, "rage");
    const began = raging(built)!.startedRound;
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    use(built, "rage"); // a Bonus Action re-declaring it
    expect(raging(built)!.startedRound).toBe(began);
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    // Ninety-nine rounds after it began, an attack no longer carries it on.
    built.state.combat = { ...built.state.combat, round: began + 99 };
    const swung = use(built, "item-greataxe", [IDS.foe], [3, 8]);
    expect(swung.warnings).toContain("Ozar's Rage has lasted 10 minutes, so it isn't extended.");
    nextInitiativeTurn(built.state);
    expect(raging(built)).toBeUndefined();
  });

  it("lasts 10 minutes outright under Persistent Rage, and only Unconscious ends it early", () => {
    const built = onTheTable(build(barbarianInput(20)));
    use(built, "rage");
    expect(raging(built)).toMatchObject({
      duration: { type: "rounds", remaining: 100 },
      tags: ["raging", "persistent-rage"]
    });
    // A round with no attack: it holds.
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    expect(raging(built)).toBeDefined();
    setCondition(built.state, IDS.hero, "stunned", true, undefined, { role: "gm" });
    expect(raging(built)).toBeDefined();
    setCondition(built.state, IDS.hero, "unconscious", true, undefined, { role: "gm" });
    expect(raging(built)).toBeUndefined();
  });

  it("regains every expended Rage with Persistent Rage", () => {
    const built = onTheTable(build(barbarianInput(20)));
    built.hero.actionUses = { rage: 4 };
    const used = use(built, "persistent-rage");
    expect(built.hero.actionUses.rage).toBeUndefined();
    expect(used.warnings).toContain("Ozar regains every expended use of Rage.");
    expect(built.hero.actionUses["persistent-rage"]).toBe(1);
  });

  it("ends the Barbarian's Concentration, and refuses a spell while it lasts", () => {
    const built = onTheTable(build(barbarianInput(5)));
    addEffect(
      built.state,
      IDS.foe,
      makeEffect({
        id: "held",
        name: "Held",
        sourceActorId: IDS.hero,
        concentration: true,
        duration: { type: "manual" }
      })
    );
    use(built, "rage");
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        {
          id: "spell-produce-flame",
          name: "Produce Flame",
          activation: "action",
          description: "",
          attack: { bonus: 4 },
          damage: [{ formula: "1d8", type: "fire" }],
          spellId: "produce-flame"
        },
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-999999999901" },
        deps(built)
      )
    ).toThrowError(/raging and can't cast spells/);
  });

  it("ends in Heavy armor", () => {
    const built = onTheTable(build(barbarianInput(5)));
    use(built, "rage");
    built.hero.inventory = [
      ...built.hero.inventory,
      {
        id: "plate",
        name: "Plate Armor",
        quantity: 1,
        equipped: true,
        category: "armor",
        armor: {
          acBase: 18,
          addDexModifier: false,
          dexModifierCap: null,
          stealthDisadvantage: true,
          strengthRequired: 15
        }
      } as (typeof built.hero.inventory)[number]
    ];
    const swung = use(built, "item-greataxe", [IDS.foe], [3, 8]);
    expect(raging(built)).toBeUndefined();
    expect(swung.warnings).toContain("Ozar is wearing Heavy armor, so its Rage ends.");
  });
});

describe("Barbarian: Danger Sense is off while Incapacitated", () => {
  it("drops the Dexterity-save Advantage while Stunned", () => {
    const built = onTheTable(build(barbarianInput()), { fight: false });
    setCondition(built.state, IDS.hero, "stunned", true, undefined, { role: "gm" });
    expect(saveRollSources(built.hero, "dex", derivationOf(built)).advantage).toEqual([]);
  });
});

// SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction", a feature's own activation included.
describe("Incapacitated: feature activations are refused too", () => {
  it("refuses Action Surge while Stunned, but Indomitable still answers a failed save", () => {
    const built = onTheTable(build(fighterInput(9)));
    setCondition(built.state, IDS.hero, "stunned", true, undefined, { role: "gm" });
    expect(() => use(built, "action-surge")).toThrowError(/Stunned and can't take actions/);
    createPendingSaves(built.state, {
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Glare",
      ability: "wis",
      dc: 20,
      targetIds: [IDS.hero],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      newSaveId: () => "50000000-0000-4000-8000-999999999990",
      createdAt: 0
    });
    const look = (faces: number[], answer?: string) =>
      answerSave(
        built.state,
        `50000000-0000-4000-8000-99999999999${faces.length}`,
        "50000000-0000-4000-8000-999999999990",
        "roll",
        undefined,
        false,
        { role: "gm" },
        {
          random: () => faces.shift()!,
          newRollId: () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
          sessionId: IDS.gmSession,
          role: "gm",
          now: () => "2026-08-07T00:00:00.000Z",
          resolveDefinition: (id: string) => (id === built.hero.definitionId ? built.definition : undefined),
          catalog
        },
        false,
        undefined,
        undefined,
        answer ? { answer: { id: answer } } : {}
      );
    expect(look([4]).outcome.answers?.map((offer) => offer.id)).toContain("indomitable");
    // The reroll adds the Fighter level: 12 + 9 + Wis +1.
    expect(look([12], "indomitable").outcome.total).toBe(22);
    expect(built.hero.actionUses.indomitable).toBe(1);
  });

  it("refuses a legendary action while Stunned or at 0 HP", () => {
    const built = onTheTable(build(fighterInput(5)));
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    const tail = {
      id: "tail",
      name: "Tail",
      activation: "other" as const,
      description: "",
      attack: { bonus: 9, reachFeet: 15 },
      damage: [],
      legendary: { cost: 1 }
    };
    const check = () => evaluateActionEconomy(built.state, foe, tail, [IDS.hero], undefined).violations;
    // Right after a turn ends, before the next creature acts (SRD 5.2.1 Legendary Actions).
    built.state.combat = {
      ...built.state.combat,
      turn: { ...built.state.combat.turn, afterActorId: built.state.combat.turnActorId! }
    };
    expect(check()).toEqual([]);
    setCondition(built.state, IDS.foe, "stunned", true, undefined, { role: "gm" });
    expect(check().map((violation) => violation.rule)).toEqual(["condition.incapacitated"]);
    setCondition(built.state, IDS.foe, "stunned", false, undefined, { role: "gm" });
    foe.hp.current = 0;
    expect(check().map((violation) => violation.rule)).toEqual(["condition.down"]);
  });
});

describe("Monk: Stunning Strike rides a hit with a Monk weapon or an Unarmed Strike", () => {
  it("is refused tapped alone and stays off the turn list", () => {
    const built = onTheTable(build(monkInput(11)));
    expect(() => use(built, "stunning-strike", [IDS.foe])).toThrowError(/Stunning Strike adds to a hit/);
    expect(built.hero.actionUses["focus-points"]).toBeUndefined();
  });

  it("is offered on an Unarmed Strike's hit and on a Spear's, and not on a miss", () => {
    const built = onTheTable(build(monkInput(11)));
    expect(offerIds(swing(built, "unarmed-strike", [17], { commit: false }))).toContain("stunning-strike");
    expect(offerIds(swing(built, "unarmed-strike", [2], { commit: false }))).toEqual([]);
    const spear = built.hero.inventory.find((item) => item.name.toLowerCase() === "spear")!;
    built.hero.inventory = built.hero.inventory.map((item) =>
      item.id === spear.id ? { ...item, equipped: true } : item
    );
    expect(offerIds(swing(built, `item-${spear.id}`, [17], { commit: false }))).toContain("stunning-strike");
  });

  it("is not offered on a hit with a Martial weapon that isn't Light", () => {
    const built = onTheTable(build(monkInput(11)));
    built.hero.inventory = [
      ...built.hero.inventory,
      {
        id: "longsword",
        name: "Longsword",
        quantity: 1,
        equipped: true,
        attuned: false,
        category: "weapon",
        weapon: {
          category: "martial",
          damageDice: "1d8",
          damageType: "slashing",
          rangeFeet: null,
          longRangeFeet: null,
          melee: true,
          properties: ["versatile"]
        }
      }
    ];
    expect(offerIds(swing(built, "item-longsword", [17], { commit: false }))).not.toContain("stunning-strike");
  });

  it("refuses a second Stunning Strike on the same turn, and allows one on the next", () => {
    const built = onTheTable(build(monkInput(11)));
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "stunning-strike" }] });
    expect(() => swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "stunning-strike" }] })).toThrowError(
      /Shan has already used Stunning Strike this turn, and it works once per turn/
    );
    // Only the first spent a Focus Point, and the refused one opened nothing.
    expect(built.hero.actionUses["focus-points"]).toBe(1);
    expect(built.state.combat.pendingSaves).toHaveLength(1);
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "stunning-strike" }] });
    expect(built.hero.actionUses["focus-points"]).toBe(2);
  });
});

describe("Monk: a save against Stunning Strike still slows the target", () => {
  it("halves its Speed and gives the next attack roll against it Advantage, until the Monk's next turn", () => {
    const built = onTheTable(build(monkInput(11)));
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    foe.speedFeet = 30;
    const speed = () => currentSpeedFeet(foe, deriveEquipment(foe, undefined, catalog));
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "stunning-strike" }] });
    answerSave(
      built.state,
      "50000000-0000-4000-8000-999999999904",
      built.state.combat.pendingSaves[0]!.id,
      "manual",
      30,
      true,
      { role: "gm" },
      {
        random: () => 10,
        newRollId: () => "50000000-0000-4000-8000-999999999905",
        sessionId: IDS.gmSession,
        role: "gm",
        now: () => "2026-08-07T00:00:00.000Z",
        resolveDefinition: () => undefined
      }
    );
    expect(foe.conditions).toEqual([]);
    expect(foe.effects[0]).toMatchObject({
      name: "Stunning Strike",
      tags: ["speed-halved", "until-attacked"],
      duration: { type: "until-source-next-turn" }
    });
    expect(speed()).toBe(15);
    // The Monk's strike keeps the higher d20 and spends the Advantage; the halved Speed stays.
    expect(use(built, UNARMED_STRIKE_ACTION_ID, [IDS.foe], [4, 17, 3]).attack?.naturalRoll).toBe(17);
    expect(foe.effects[0]).toMatchObject({ tags: ["speed-halved"], modifiers: [] });
    expect(speed()).toBe(15);
    nextInitiativeTurn(built.state);
    nextInitiativeTurn(built.state);
    expect(foe.effects).toEqual([]);
    expect(speed()).toBe(30);
  });
});

describe("Monk: Stunning Strike stuns until the start of the Monk's next turn", () => {
  it("lands as an effect from the Monk that ends when its next turn begins", () => {
    const built = onTheTable(build(monkInput(11)));
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "stunning-strike" }] });
    const pending = built.state.combat.pendingSaves[0]!;
    answerSave(
      built.state,
      "50000000-0000-4000-8000-999999999902",
      pending.id,
      "manual",
      1,
      true,
      { role: "gm" },
      {
        random: () => 10,
        newRollId: () => "50000000-0000-4000-8000-999999999903",
        sessionId: IDS.gmSession,
        role: "gm",
        now: () => "2026-08-07T00:00:00.000Z",
        resolveDefinition: () => undefined
      }
    );
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(foe.conditions.map((condition) => condition.id)).toEqual(["stunned"]);
    nextInitiativeTurn(built.state);
    expect(foe.conditions.map((condition) => condition.id)).toEqual(["stunned"]);
    nextInitiativeTurn(built.state);
    expect(foe.conditions).toEqual([]);
  });
});

// SRD Relentless Rage: "If you drop to 0 Hit Points while your Rage is active and don't die outright, you can make a
// DC 10 Constitution saving throw. If you succeed, your Hit Points instead change to a number equal to twice your
// Barbarian level. Each time you use this feature after the first, the DC increases by 5. When you finish a Short or
// Long Rest, the DC resets to 10."
describe("Barbarian: Relentless Rage", () => {
  const drop = (built: Built, face: number) =>
    applyDamageDetailed(
      built.state,
      IDS.hero,
      { amount: built.hero.hp.current + 5 },
      { role: "gm" },
      { resolveDefinition: () => built.definition, catalog, rollDie: () => face }
    ).events.map((event) => event.text);

  it("keeps a raging level-11 Barbarian up at 22 HP, then asks DC 15, and a Short Rest resets it", () => {
    const built = onTheTable(build(barbarianInput(11)));
    built.hero.kind = "player-character";
    use(built, "rage");
    // CON save +6 (Con 15, proficient at +4): a 15 makes 21 against DC 10.
    expect(drop(built, 15).join(" ")).toMatch(/Relentless Rage: CON save 21 \(d20 15\) vs DC 10: up at 22 HP/);
    expect(built.hero.hp.current).toBe(22);
    // The second time the DC is 15: an 8 makes 14, and the Barbarian falls.
    expect(drop(built, 8).join(" ")).toMatch(/vs DC 15: it falls/);
    expect(built.hero.hp.current).toBe(0);

    built.hero.hp = { ...built.hero.hp, current: 10 };
    built.hero.deathSaves = null;
    built.state.combat = { ...built.state.combat, active: false, initiative: [] };
    applyRest(built.state, IDS.hero, "short", () => built.definition, catalog);
    expect(built.hero.actionUses[RELENTLESS_RAGE_KEY]).toBeUndefined();
  });

  it("gives no save outside a Rage, nor to a Barbarian killed outright", () => {
    const built = onTheTable(build(barbarianInput(11)));
    built.hero.kind = "player-character";
    expect(drop(built, 20).join(" ")).not.toMatch(/Relentless Rage/);
    expect(built.hero.hp.current).toBe(0);
    const outright = onTheTable(build(barbarianInput(11)));
    outright.hero.kind = "player-character";
    use(outright, "rage");
    applyDamageDetailed(
      outright.state,
      IDS.hero,
      { amount: outright.hero.hp.current + outright.hero.hp.maximum },
      { role: "gm" },
      { resolveDefinition: () => outright.definition, catalog, rollDie: () => 20 }
    );
    expect(outright.hero.actionUses[RELENTLESS_RAGE_KEY]).toBeUndefined();
    expect(outright.hero.hp.current).toBe(0);
  });
});

/** The GM answering a pending save with a thrown die, for the effects a save spends. */
const answerWith = (built: Built, saveId: string, faces: number[]) =>
  answerSave(
    built.state,
    `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
    saveId,
    "roll",
    undefined,
    true,
    { role: "gm" },
    {
      random: () => faces.shift() ?? 10,
      newRollId: () => `40000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
      sessionId: IDS.gmSession,
      role: "gm",
      now: () => "2026-08-07T00:00:00.000Z",
      resolveDefinition: () => undefined
    }
  );

describe("Barbarian: Brutal Strike gives up Advantage before the roll and rides its hit", () => {
  it("rolls the next Strength attack with one d20, and its hit adds 1d10 of the weapon's type and a Hamstring Blow", () => {
    const built = onTheTable(build(barbarianInput(9)));
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    foe.speedFeet = 30;
    use(built, "reckless-attack");
    use(built, "brutal-strike");
    // One d20: the queue holds a single face, so a second d20 would find it empty and throw.
    const preview = swing(built, "item-greataxe", [15], { commit: false });
    expect(preview.attack).toMatchObject({ naturalRoll: 15, outcome: "hit" });
    expect(preview.rollMode).toBeUndefined();
    expect(preview.hitOffers?.find((offer) => offer.id === "brutal-strike")).toMatchObject({
      dice: "1d10 Slashing",
      effects: [
        { id: "forceful-blow", name: "Forceful Blow" },
        { id: "hamstring-blow", name: "Hamstring Blow" }
      ],
      effectsChoose: 1
    });
    const hit = swing(built, "item-greataxe", [15, 8, 6], {
      hitOptions: [{ id: "brutal-strike", effects: ["hamstring-blow"] }]
    });
    expect(hit.damage).toContainEqual({ formula: "1d10", type: "slashing", total: 6, source: "Brutal Strike" });
    expect(foe.effects).toMatchObject([{ name: "Hamstring Blow", modifiers: [{ type: "speed", amount: -15 }] }]);
    expect(currentSpeedFeet(foe, deriveEquipment(foe, undefined, catalog))).toBe(15);
    // The roll spent the declaration, and the turn's use is spent too.
    expect(built.hero.effects.some((effect) => effect.tags.includes("forgoes-advantage"))).toBe(false);
    expect(() => use(built, "brutal-strike")).toThrowError(/no uses remaining/);
  });

  it("gives Forceful Blow's half Speed of movement toward the target, provoking no Opportunity Attacks", () => {
    const built = onTheTable(build(barbarianInput(9)));
    use(built, "reckless-attack");
    use(built, "brutal-strike");
    swing(built, "item-greataxe", [15, 8, 6], { hitOptions: [{ id: "brutal-strike", effects: ["forceful-blow"] }] });
    const speed = currentSpeedFeet(built.hero, deriveEquipment(built.hero, built.definition, catalog)) ?? 0;
    expect(built.hero.effects.find((effect) => effect.grantedMove !== undefined)).toMatchObject({
      name: "Brutal Strike: Forceful Blow",
      grantedMove: { feet: Math.floor(speed / 10) * 5, provokes: false, towardActorId: IDS.foe }
    });
  });

  it("is refused without Reckless Attack", () => {
    const built = onTheTable(build(barbarianInput(9)));
    expect(() => use(built, "brutal-strike")).toThrowError(/requires an active Reckless Attack effect/);
  });

  it("stays on the Barbarian when the roll has Disadvantage, and that hit offers nothing of it", () => {
    const built = onTheTable(build(barbarianInput(9)));
    use(built, "reckless-attack");
    use(built, "brutal-strike");
    setCondition(built.state, IDS.hero, "prone", true, undefined, { role: "gm" });
    const preview = swing(built, "item-greataxe", [15], { commit: false });
    expect(preview.hitOffers?.some((offer) => offer.id === "brutal-strike") ?? false).toBe(false);
    expect(built.hero.effects.some((effect) => effect.tags.includes("forgoes-advantage"))).toBe(true);
  });

  it("keeps one Hamstring Blow on a creature: the newest replaces the older", () => {
    const built = onTheTable(build(barbarianInput(9)));
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    addEffect(
      built.state,
      IDS.foe,
      makeEffect({
        id: "older-hamstring",
        name: "Hamstring Blow",
        duration: { type: "until-source-next-turn" },
        modifiers: [{ type: "speed", amount: -15 }]
      })
    );
    use(built, "reckless-attack");
    use(built, "brutal-strike");
    swing(built, "item-greataxe", [15, 8, 6], { hitOptions: [{ id: "brutal-strike", effects: ["hamstring-blow"] }] });
    expect(foe.effects.filter((effect) => effect.name === "Hamstring Blow")).toHaveLength(1);
    expect(foe.effects.some((effect) => effect.id === "older-hamstring")).toBe(false);
  });
});

describe("Barbarian: Improved Brutal Strike's Staggering and Sundering Blows", () => {
  it("leaves Disadvantage on the target's next save and no Opportunity Attacks until the Barbarian's next turn", () => {
    const built = onTheTable(build(barbarianInput(13)));
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    use(built, "reckless-attack");
    use(built, "brutal-strike");
    const preview = swing(built, "item-greataxe", [15], { commit: false });
    expect(
      preview.hitOffers?.find((offer) => offer.id === "brutal-strike")?.effects?.map((effect) => effect.id)
    ).toEqual(["forceful-blow", "hamstring-blow", "staggering-blow", "sundering-blow"]);
    swing(built, "item-greataxe", [15, 8, 6], { hitOptions: [{ id: "brutal-strike", effects: ["staggering-blow"] }] });
    expect(foe.effects).toMatchObject([
      { name: "Staggering Blow", tags: ["no-opportunity-attacks", "until-own-save"] }
    ]);
    createPendingSaves(built.state, {
      sourceActorId: IDS.hero,
      sourceName: "Ozar",
      actionName: "Test",
      ability: "con",
      dc: 15,
      targetIds: [IDS.foe],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      newSaveId: () => "50000000-0000-4000-8000-777777777701",
      createdAt: 0
    });
    const answered = answerWith(built, "50000000-0000-4000-8000-777777777701", [5, 18]);
    expect(answered.outcome.rollMode).toMatchObject({ mode: "disadvantage" });
    // The save spent the Disadvantage; the Opportunity Attacks stay barred until the effect ends.
    expect(foe.effects).toMatchObject([{ name: "Staggering Blow", tags: ["no-opportunity-attacks"], modifiers: [] }]);
  });

  it("gives the next attack roll another creature makes against the target +5, once", () => {
    const built = onTheTable(build(barbarianInput(13)));
    use(built, "reckless-attack");
    use(built, "brutal-strike");
    swing(built, "item-greataxe", [15, 8, 6], { hitOptions: [{ id: "brutal-strike", effects: ["sundering-blow"] }] });
    const ally = { ...built.state.actors.find((actor) => actor.id === IDS.foe)!, id: OTHER, name: "Ally", effects: [] };
    built.state.actors.push(ally);
    built.state.combat.initiative.push({ actorId: OTHER, score: 15 } as (typeof built.state.combat.initiative)[number]);
    const strike = () => {
      built.state.combat = {
        ...built.state.combat,
        turnActorId: OTHER,
        turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
      };
      return resolveDefinitionAction(
        built.state,
        builtinActionFor(undefined, UNARMED_STRIKE_ACTION_ID)!,
        {
          actorId: OTHER,
          targetIds: [IDS.foe],
          commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
          builtin: true
        },
        { ...deps(built, [10]), definition: undefined }
      );
    };
    const first = strike();
    const second = strike();
    expect(first.attack!.total - second.attack!.total).toBe(5);
    expect(first.warnings).toContain("Sundering Blow: +5 to this attack roll against Foe.");
  });

  it("deals 2d10 and carries two different effects from level 17", () => {
    const built = onTheTable(build(barbarianInput(17)));
    use(built, "reckless-attack");
    use(built, "brutal-strike");
    const preview = swing(built, "item-greataxe", [15], { commit: false });
    expect(preview.hitOffers?.find((offer) => offer.id === "brutal-strike")).toMatchObject({
      dice: "2d10 Slashing",
      effectsChoose: 2
    });
    const hit = swing(built, "item-greataxe", [15, 8, 6, 4], {
      hitOptions: [{ id: "brutal-strike", effects: ["hamstring-blow", "staggering-blow"] }]
    });
    expect(hit.damage).toContainEqual({ formula: "2d10", type: "slashing", total: 10, source: "Brutal Strike" });
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(foe.effects.map((effect) => effect.name).sort()).toEqual(["Hamstring Blow", "Staggering Blow"]);
  });
});

describe("Monk: Open Hand Technique rides the strikes Flurry of Blows grants", () => {
  it("offers Addle, Push and Topple on a Flurry strike's hit, and nothing on the Attack action's strike", () => {
    const built = onTheTable(build(monkInput(11)));
    expect(offerIds(swing(built, "unarmed-strike", [17], { commit: false }))).not.toContain("open-hand-technique");
    use(built, "flurry-of-blows");
    const preview = swing(built, "unarmed-strike", [17], { commit: false });
    expect(preview.hitOffers?.find((offer) => offer.id === "open-hand-technique")).toMatchObject({
      effects: [{ id: "addle" }, { id: "push" }, { id: "topple" }],
      effectsChoose: 1,
      effectRequired: true
    });
  });

  it("opens Topple's Dexterity save at 8 + Wisdom + Proficiency Bonus, Prone on a failure", () => {
    // Wis 16 (+3) at level 11, proficiency 4: DC 15.
    const built = onTheTable(build(monkInput(11)));
    use(built, "flurry-of-blows");
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "open-hand-technique", effects: ["topple"] }] });
    const pending = built.state.combat.pendingSaves[0]!;
    expect(pending).toMatchObject({ ability: "dex", dc: 15, actionName: "Open Hand Technique: Topple" });
    answerWith(built, pending.id, [2]);
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(foe.conditions.map((entry) => entry.id)).toEqual(["prone"]);
  });

  it("Addles the target: no Opportunity Attacks until the start of its next turn", () => {
    const built = onTheTable(build(monkInput(11)));
    use(built, "flurry-of-blows");
    swing(built, "unarmed-strike", [17, 5], { hitOptions: [{ id: "open-hand-technique", effects: ["addle"] }] });
    const foe = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(foe.effects).toMatchObject([
      { name: "Addled", tags: ["no-opportunity-attacks"], duration: { type: "until-bearer-next-turn" } }
    ]);
  });
});

describe("Monk: Self-Restoration ends a condition as the turn ends", () => {
  const endTurn = (built: Built) =>
    nextInitiativeTurn(built.state, [], {
      resolveDefinition: (id: string) => (id === built.hero.definitionId ? built.definition : undefined),
      catalog,
      rollDie: () => 1,
      newId: () => "40000000-0000-4000-8000-0000000000f1",
      now: () => "2026-08-07T00:00:00.000Z"
    });
  const conditionIds = (built: Built) => built.hero.conditions.map((condition) => condition.id).sort();

  it("ends Frightened of a Frightened and Poisoned Monk 10, and leaves it Poisoned", () => {
    const built = onTheTable(build(monkInput(10)));
    setCondition(built.state, IDS.hero, "frightened", true, undefined, { role: "gm" });
    setCondition(built.state, IDS.hero, "poisoned", true, undefined, { role: "gm" });
    endTurn(built);
    expect(conditionIds(built)).toEqual(["poisoned"]);
  });

  it("ends an effect that imposes nothing but the condition", () => {
    const built = onTheTable(build(monkInput(10)));
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({
        id: "fear",
        name: "Cause Fear",
        linkedConditionIds: ["frightened"],
        duration: { type: "rounds", remaining: 10 }
      })
    );
    expect(conditionIds(built)).toEqual(["frightened"]);
    endTurn(built);
    expect(conditionIds(built)).toEqual([]);
    expect(built.hero.effects.some((effect) => effect.id === "fear")).toBe(false);
  });

  it("does nothing for a Monk 9", () => {
    const built = onTheTable(build(monkInput(9)));
    setCondition(built.state, IDS.hero, "poisoned", true, undefined, { role: "gm" });
    endTurn(built);
    expect(conditionIds(built)).toEqual(["poisoned"]);
  });
});

describe("Monk: Heightened Focus carries a willing ally on Step of the Wind", () => {
  /** A Monk with an ally beside it, of `size`. */
  const withAlly = (level: number, size = "medium") => {
    const built = onTheTable(build(monkInput(level)));
    built.state.actors.push({
      ...structuredClone(built.hero),
      id: OTHER,
      name: "Ally",
      size,
      definitionId: undefined,
      effects: [],
      conditions: [],
      inventory: []
    } as Actor);
    built.state.combat.initiative.push({ actorId: OTHER, score: 5 } as (typeof built.state.combat.initiative)[number]);
    return built;
  };
  const carry = (built: Built) => use(built, "step-of-the-wind-carry", [OTHER]);
  const ally = (built: Built) => built.state.actors.find((actor) => actor.id === OTHER)!;

  it("takes the ally along on the Monk's moves after Step of the Wind, until the turn ends", () => {
    const built = withAlly(10);
    expect(() => carry(built)).toThrow(/requires an active/);
    use(built, "step-of-the-wind");
    carry(built);
    expect(ally(built).effects).toMatchObject([{ name: "Carried by Step of the Wind", tags: ["carried-along"] }]);
    expect(carriedAlongBy(built.state, IDS.hero)).toEqual([OTHER]);
    nextInitiativeTurn(built.state);
    expect(ally(built).effects).toEqual([]);
  });

  it("refuses a Huge ally, and a Monk 9 has no such action", () => {
    const huge = withAlly(10, "huge");
    use(huge, "step-of-the-wind");
    expect(() => carry(huge)).toThrow(/Large or smaller|larger than Large|too large|size/i);
    expect(
      effectiveActions(build(monkInput(9)), withAlly(9).hero, catalog).some(
        (action) => action.id === "step-of-the-wind-carry"
      )
    ).toBe(false);
  });
});
