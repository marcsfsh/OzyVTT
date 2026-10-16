import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { builtinAction } from "../src/builtin-actions.js";
import { addEffect, endEffect } from "../src/effects.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { criticalThreshold, effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { initiativeRollMode, startEncounter } from "../src/encounter.js";
import { saveRollSources } from "../src/saving-throws.js";

// Barbarian, Fighter and Monk mechanics, asserted as numbers a player can act on: sheet AC, the DC a
// target is held to, the die the engine keeps, the counter it spends, or the refusal it prints. Runs
// the real builder against the real SRD bundles, so it also catches ETL drift. Negative controls
// appear wherever a rider could appear to work without working.

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

  it("Primal Champion really passes 20 - the ceiling every other increase is clamped to", () => {
    // Str is 20 and Con 18 when the capstone applies; a rider without `maximum` would leave both at 20.
    expect(definition.abilityScores.str).toBeGreaterThan(20);
    expect(definition.abilityScores.con).toBeGreaterThan(20);
    // ...and it is +4 with a ceiling of 25: Str 20 -> 24, Con 18 -> 22.
    expect(definition.abilityScores.str).toBe(24);
  });

  it("Fast Movement is on the walking speed the token moves at", () => {
    expect(definition.speedFeet).toBe(40); // Halfling 30 + 10
  });

  it("Rage's uses come off the printed Rages column at THIS level, not a copy of it", () => {
    // 6 at level 20, 2 at level 1, from the printed column rather than the overlay.
    expect(definition.actions.find((action) => action.id === "rage")?.uses).toEqual({ limit: 6, per: "long-rest" });
    expect(build(barbarianInput(1)).actions.find((action) => action.id === "rage")?.uses).toEqual({
      limit: 2,
      per: "long-rest"
    });
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
    // The die, not the flag: two faces are offered and the higher survives (+3 Dex).
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

describe("Barbarian: Reckless Attack is an effect the table can see and swing under", () => {
  it("puts a real effect on the actor and makes the next attack roll with advantage", () => {
    const built = onTheTable(build(barbarianInput()));
    use(built, "reckless-attack");
    const effect = built.hero.effects.find((entry) => entry.tags.includes("reckless-attack"))!;
    expect(effect).toBeDefined();
    expect(effect.modifiers).toEqual([
      { type: "roll-mode", roll: "attack", mode: "advantage" },
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

describe("Barbarian: Persistent Rage is a counter the engine spends", () => {
  it("spends its one long-rest use and refuses the second attempt", () => {
    const built = onTheTable(build(barbarianInput()));
    use(built, "persistent-rage");
    expect(built.hero.actionUses["persistent-rage"]).toBe(1);
    expect(() => use(built, "persistent-rage")).toThrowError(/no uses remaining \(1\/long rest\)/);
  });
});

// Mindless Rage: "You have Immunity to the Charmed and Frightened conditions while your Rage is
// active." A shipped subclass record carrying a gated grant (`grants.when`); `grant-gates.test.ts`
// covers the engine half. On the same character, one `endEffect` apart, `setCondition` narrates the
// skip while Rage runs and Frightened lands once it ends.
describe("Berserker: Mindless Rage refuses Frightened only while the Rage is running", () => {
  const built = () => onTheTable(build(barbarianInput(6)));

  it("carries the gate out of the COMMITTED subclass bundle - the first link", () => {
    const record = view.featureRecord({ kind: "subclass", sourceId: "path-of-the-berserker", id: "mindless-rage" })!;
    expect(record.grants).toMatchObject({
      conditionImmunities: ["charmed", "frightened"],
      when: [{ type: "while-effect-tag", tags: ["raging"] }]
    });
  });

  it("is NOT baked into the definition - a gate the builder cannot evaluate must not be a fact", () => {
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
      { kind: "condition", text: "Ozar is immune to Frightened - not applied.", actorId: IDS.hero, immune: true }
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
    expect(charmed[0]!.text).toBe("Ozar is immune to Charmed - not applied.");
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

  it("gives a level-5 Berserker nothing - the feature is gained at 6", () => {
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

  it("refuses a feat that is not an Epic Boon, and refuses the boon before level 19", () => {
    const wrongCategory = barbarianInput();
    wrongCategory.choices = wrongCategory.choices
      .filter(
        (row) =>
          row.id !== "boon-of-combat-prowess" &&
          !(row.kind === "ability-score" && row.payload?.featureId === "boon-of-combat-prowess")
      )
      .concat([
        { level: 19, classId: "barbarian", kind: "feat", id: "alert", payload: { featureId: "epic-boon" } }
      ] as Row[]);
    expect(() => build(wrongCategory)).toThrowError(/alert/i);

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
      failureConditions: ["frightened"]
    });
    const resolution = use(built, "intimidating-presence", [IDS.foe]);
    expect(resolution.save).toMatchObject({ ability: "wis", dc: 18 });
    expect(built.hero.actionUses["intimidating-presence"]).toBe(1);

    const later = onTheTable(build(barbarianInput(17)), { fight: false });
    expect(actionOf(later, "intimidating-presence").save).toEqual({
      ability: "wis",
      dc: 19,
      successDamage: "none",
      failureConditions: ["frightened"]
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
      failureConditions: ["frightened"]
    });
    // The number the target is held to, not just the one printed on the sheet.
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
      skill: "Escape (Athletics/Acrobatics)",
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
      expect(resolution.rollMode, `${actionId} must not see an Athletics-narrowed rider`).toBeUndefined();
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
    // Exhausted reads as `null`, not `{ attack: 0 }`: the resolver reports remaining components only while
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

// Monk

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

  it("takes STRENGTH when Strength is the better one - it is 'instead of', not 'always Dexterity'", () => {
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

describe("Monk: Flurry of Blows opens its own Unarmed Strikes", () => {
  it("opens two strikes as a bonus action, each spent by an Unarmed Strike, leaving the Attack action alone", () => {
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
    expect(() => use(built, "flurry-of-blows")).toThrowError(/no uses remaining \(11\/short rest\)/);
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
      failureConditions: ["stunned"]
    });
    const resolution = use(built, "stunning-strike", [IDS.foe]);
    expect(resolution.save).toMatchObject({ ability: "con", dc: 15 });
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
      failureConditions: ["stunned"]
    });
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
    expect(() => use(built, "uncanny-metabolism")).toThrowError(/no uses remaining \(1\/long rest\)/);
  });

  it("puts the level-19 boon on the sheet", () => {
    expect(featIds(build(monkInput(20)))).toEqual(["alert", "boon-of-the-night-spirit"]);
    expect(featIds(build(monkInput(11)))).toEqual(["alert"]);
  });
});
