import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import {
  BackgroundReferenceSchema, ClassReferenceSchema, SpeciesReferenceSchema, SubclassReferenceSchema
} from "@vtt/content-srd-5.2.1";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { collectRiders } from "@vtt/rules-5e";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary, EMPTY_HOMEBREW_SLICE, type HomebrewContentSource } from "../src/content-library.js";
import { criticalThreshold, effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";
import { saveRiderBonus, saveRollSources } from "../src/saving-throws.js";

/**
 * A CLASS / SUBCLASS / SPECIES / LINEAGE / BACKGROUND / OPTION FEATURE CARRIES THE WHOLE RIDER
 * VOCABULARY - proved end to end. Issue `2e`.
 *
 * The sibling of `feat-riders.test.ts`, and deliberately its near-copy: the two halves of one sheet
 * had the same defect and now have the same fix, so they must be held to the same bar. A FEAT's
 * roll-time riders reached the table because `character.feats` recorded its id and `deriveEquipment`
 * turned that into a `RiderCarrier`. A class feature was recorded NOWHERE on the definition, so 13 of
 * the 21 authored rider variants were parsed, validated, folded into nothing, and silently dropped -
 * no error, no warning, no trace.
 *
 * WHAT THIS FILE CAUGHT, and the reason it exists rather than the `2e` commit being trusted: the
 * carrier machinery (`character.features` on the schema, `featureRecord` on the catalog,
 * `characterFeatureCarriers` in the derivation) was committed WITHOUT the builder ever writing the
 * array. `dedupeFeatureRefs` in `character-build.ts` is that missing half. Every assertion below ran
 * red against the committed tree.
 *
 * So these tests all run the REAL builder against a REAL `ContentLibrary` with a homebrew class,
 * subclass, species, lineage and background merged in, and then assert AT THE TABLE - the rolled
 * to-hit, the DC the target is actually held to, the pool the engine will actually spend. Following
 * `feat-riders.test.ts` and `item-riders.test.ts`: every criterion that has an obvious way to
 * appear-to-work asserts its NEGATIVE control too - the rider-less build, the wrong roll, the wrong
 * pool, the wrong moment.
 */

const POLICY = BuilderPolicySchema.parse({});
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/** The 13 variants the build-time fold does NOT own; every one must reach the table as a carrier. */
const ROLL_TIME_RIDERS: ReadonlyArray<Record<string, unknown>> = [
  { type: "attack-bonus", amount: 1 },
  { type: "save-bonus", amount: 1 },
  { type: "check-bonus", amount: 1 },
  { type: "roll-mode", roll: "attack", mode: "advantage" },
  { type: "extra-damage", formula: "1d4", damageType: "fire" },
  { type: "critical-range", threshold: 19 },
  { type: "critical-bonus-dice", count: 1 },
  { type: "damage-reduction", amount: 1 },
  { type: "spell-save-dc", amount: 1 },
  { type: "spell-attack-bonus", amount: 1 },
  { type: "spell-slot", level: 1, amount: 1 },
  { type: "resource-bonus", poolId: "rift-surge", amount: 1 },
  { type: "sense", sense: "tremorsense", feet: 30 }
];
/** The 8 the builder BAKES into the definition; none may appear as a carrier, or it applies twice. */
const BUILD_TIME_RIDERS: ReadonlyArray<Record<string, unknown>> = [
  { type: "ability-score", ability: "wis", amount: 1 },
  { type: "hit-points-per-level", amount: 1 },
  { type: "speed", amount: 10 },
  { type: "armor-class", amount: 1 },
  { type: "initiative", amount: 2 },
  { type: "extra-attack", count: 1 },
  { type: "unarmored-defense", ability: "con" },
  { type: "darkvision", feet: 60 }
];

// -------------------------------------------------------------------------------------------------
// Harness: a REAL ContentLibrary holding one homebrew class, subclass, species (with a lineage) and
// background. The riders under test are placed on ONE of the six carriers, named by `on`.
// -------------------------------------------------------------------------------------------------

/**
 * THE SIX CARRIER KINDS `CharacterFeatureRef` can name, and the record each one puts the riders on.
 * Every kind is exercised by the whole 13-variant sweep, because each is a separate branch of the
 * catalog's feature index and a separate `origin` in the builder - a fix that reached only `class`
 * would pass a class-only test and still drop a species trait's riders.
 */
const CARRIERS = ["class", "subclass", "species", "lineage", "background", "option"] as const;
type Carrier = (typeof CARRIERS)[number];

/** The `name` each carrier's record has, which is the `label` its `RiderCarrier` is found by. */
const LABEL: Readonly<Record<Carrier, string>> = {
  class: "Rift Attunement", subclass: "Rift Breaking", species: "Rift Sense",
  lineage: "Deep Rift", background: "Rift Lore", option: "Rift Blade"
};

type Homebrew = Readonly<{
  on?: Carrier;
  /** Where the ACTIONS go, when that is not where the riders go - Agonizing Blast gates an invocation on a cantrip the class grants. Defaults to `on`. */
  actionsOn?: Carrier;
  modifiers?: readonly unknown[];
  actions?: readonly unknown[];
  scores?: Record<string, number>;
  /** Adds an epic-boon-shaped ability-score CHOICE to the class: a number is its `maximum`, `false` authors none. */
  boon?: number | false;
  method?: string;
  /** The background spread, when the default STR/CON one is not the ability under test. */
  spread?: ReadonlyArray<{ ability: string; amount: number }>;
}>;

/** Riders land on the named carrier and nowhere else; the other five stay prose-only. */
const ridersFor = (brew: Homebrew, carrier: Carrier) => ({
  ...((brew.on ?? "class") === carrier ? { modifiers: brew.modifiers ?? [] } : {}),
  ...((brew.actionsOn ?? brew.on ?? "class") === carrier ? { actions: brew.actions ?? [] } : {})
});

/**
 * The homebrew class. Level 5 grants `rift-attunement` (the class carrier), `rift-focus` (whose
 * inline options are the OPTION carrier) and `rift-surge` (an action with a three-use pool, so a
 * `resource-bonus` rider has something real to raise).
 */
function classFor(brew: Homebrew) {
  const levelTable = Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
    features: index === 0 ? ["rift-attunement", "rift-focus", "rift-surge", ...(brew.boon === undefined ? [] : ["rift-apotheosis"])] : []
  }));
  return ClassReferenceSchema.parse({
    id: "hb-riftwarden", name: "Riftwarden", source: "homebrew", summary: "A homebrew class.",
    hitDie: "d10", statPriority: ["str", "con", "dex", "wis", "int", "cha"], primaryAbilities: ["str"],
    savingThrows: ["str", "con"], skillChoices: { choose: 0, from: [] },
    armorProficiencies: ["light", "medium", "heavy", "shields"],
    weaponProficiencies: ["simple", "martial"],
    subclassLevel: 3, asiLevels: [4, 8, 12, 16, 19], levelTable,
    startingEquipment: [{
      id: "riftwarden-a", label: "A greatsword and a shortbow",
      items: [{ id: "greatsword", name: "Greatsword" }, { id: "shortbow", name: "Shortbow" }, { id: "chain-mail", name: "Chain Mail" }]
    }],
    features: [
      {
        id: "rift-attunement", name: "Rift Attunement", level: 1,
        description: "You are attuned to the rift.", ...ridersFor(brew, "class")
      },
      {
        id: "rift-focus", name: "Rift Focus", level: 1, description: "Choose how your rift manifests.",
        choice: {
          kind: "rift-form", choose: 1,
          options: [
            { id: "rift-blade", name: "Rift Blade", description: "The rift sharpens your steel.", ...ridersFor(brew, "option") },
            { id: "rift-veil", name: "Rift Veil", description: "The rift hides you." }
          ]
        }
      },
      ...(brew.boon === undefined ? [] : [{
        id: "rift-apotheosis", name: "Rift Apotheosis", level: 1,
        description: "Increase one ability score by 1, to a maximum of 30.",
        choice: {
          kind: "ability-score", choose: 1, from: ["str", "dex", "con", "int", "wis", "cha"],
          ...(typeof brew.boon === "number" ? { maximum: brew.boon } : {})
        }
      }]),
      {
        id: "rift-surge", name: "Rift Surge", level: 1, description: "You surge with rift energy.",
        actions: [{
          id: "rift-surge", name: "Rift Surge", activation: "bonus-action",
          description: "You surge with rift energy and regain your footing.",
          uses: { limit: 3, per: "short-rest" }
        }]
      }
    ]
  });
}

function libraryWith(brew: Homebrew = {}): ContentLibrary {
  const source: HomebrewContentSource = {
    revision: 1,
    publishedFor: () => ({
      ...EMPTY_HOMEBREW_SLICE,
      classes: [classFor(brew)],
      subclasses: [SubclassReferenceSchema.parse({
        id: "hb-riftbreaker", name: "Riftbreaker", source: "homebrew", classId: "hb-riftwarden",
        features: [{ id: "rift-breaking", name: "Rift Breaking", level: 3, description: "You break the rift open.", ...ridersFor(brew, "subclass") }]
      })],
      species: [SpeciesReferenceSchema.parse({
        id: "hb-riftborn", name: "Riftborn", source: "homebrew", speedFeet: 30,
        traits: [
          { id: "rift-sense", name: "Rift Sense", description: "You feel the rift.", ...ridersFor(brew, "species") },
          { id: "rift-heritage", name: "Rift Heritage", description: "Choose a heritage.", choice: { kind: "lineage", choose: 1, from: ["hb-riftborn-deep"] } }
        ],
        lineages: [{
          id: "hb-riftborn-deep", name: "Deep Riftborn", description: "Born of the deep rift.",
          traits: [{ id: "deep-rift", name: "Deep Rift", description: "The deep rift marks you.", ...ridersFor(brew, "lineage") }]
        }]
      })],
      backgrounds: [BackgroundReferenceSchema.parse({
        id: "hb-riftwalker", name: "Riftwalker", source: "homebrew",
        abilityOptions: { from: ["str", "con", "wis", "cha"] },
        features: [{ id: "rift-lore", name: "Rift Lore", description: "You know the rift's lore.", ...ridersFor(brew, "background") }]
      })]
    }),
    monsterForInstance: () => undefined
  };
  return new ContentLibrary(source);
}

/**
 * A level-5 Deep Riftborn Riftbreaker. Str 19 after the background spread (+4), proficiency 3, so a
 * martial-proficient greatsword swings at +7 - the same baseline arithmetic `feat-riders.test.ts`
 * uses, deliberately, so a number that drifts is obvious against its sibling.
 */
const heroInput = (brew: Homebrew = {}): CharacterCreateRequestInput => ({
  name: "Vess", speciesId: "hb-riftborn", backgroundId: "hb-riftwalker", classId: "hb-riftwarden", level: 5,
  subclassId: "hb-riftbreaker", abilityMethod: (brew.method ?? "standard-array") as CharacterCreateRequestInput["abilityMethod"],
  baseScores: (brew.scores ?? { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }) as CharacterCreateRequestInput["baseScores"],
  backgroundBonusAllocation: (brew.spread ?? [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }]) as CharacterCreateRequestInput["backgroundBonusAllocation"],
  hp: { mode: "entries", entries: [1, 10, 4, 6] },
  choices: [
    { level: 1, kind: "lineage", id: "hb-riftborn-deep" },
    { level: 1, kind: "rift-form", id: "rift-blade", payload: { featureId: "rift-focus" } },
    { level: 3, classId: "hb-riftwarden", kind: "subclass", id: "hb-riftbreaker" },
    { level: 1, kind: "equipment", id: "riftwarden-a" },
    ...(brew.boon === undefined ? [] : [{ level: 1, kind: "ability-score", id: "str", payload: { featureId: "rift-apotheosis" } }])
  ] as CharacterCreateRequestInput["choices"]
});

type Built = Readonly<{
  definition: ActorDefinition;
  catalog: ReturnType<typeof equipmentCatalogOf>;
  state: GameState;
  hero: Actor;
}>;

/** Build the sheet through the REAL builder, then put it on the table with the play-time catalog. */
function build(brew: Homebrew = {}): Built {
  const view = libraryWith(brew).forAudience("gm");
  const definition = buildCharacterDefinition(heroInput(brew), view, POLICY);
  const catalog = equipmentCatalogOf(view);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  return { definition, catalog, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
}

function fight(built: Built): Built {
  startEncounter(built.state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return built;
}

function deps(built: Built, faces: number[]): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-07-28T00:00:00.000Z",
    definition: built.definition, catalog: built.catalog
  };
}

const actionOf = (built: Built, id: string) => effectiveActions(built.definition, built.hero, built.catalog).find((entry) => entry.id === id)!;
const carrierOf = (built: Built, label: string) => deriveEquipment(built.hero, built.definition, built.catalog).carriers.find((carrier) => carrier.label === label);

// -------------------------------------------------------------------------------------------------
// The seam: the builder RECORDS which feature records the sheet holds, and each is a BEARER carrier.
// -------------------------------------------------------------------------------------------------

describe("the builder records every granted feature by id and provenance", () => {
  it("writes character.features with the right kind and sourceId for all six carriers", () => {
    // THE ASSERTION THE `2e` COMMIT WOULD HAVE FAILED. `character.features` was on the schema, the
    // catalog could resolve it and the derivation could read it - but nothing ever wrote it, so this
    // array was `undefined` and every rider below fell straight back into the hole `2e` describes.
    const built = build();
    expect(built.definition.character?.features).toEqual([
      { id: "rift-attunement", kind: "class", sourceId: "hb-riftwarden" },
      { id: "rift-focus", kind: "class", sourceId: "hb-riftwarden" },
      { id: "rift-surge", kind: "class", sourceId: "hb-riftwarden" },
      { id: "rift-breaking", kind: "subclass", sourceId: "hb-riftbreaker" },
      { id: "rift-sense", kind: "species", sourceId: "hb-riftborn" },
      { id: "rift-heritage", kind: "species", sourceId: "hb-riftborn" },
      { id: "deep-rift", kind: "lineage", sourceId: "hb-riftborn-deep" },
      { id: "rift-lore", kind: "background", sourceId: "hb-riftwalker" },
      { id: "rift-blade", kind: "option", sourceId: "rift-focus" }
    ]);
  });

  it("resolves each carrier's riders through the catalog with NO sourceItemId", () => {
    for (const on of CARRIERS) {
      const carrier = carrierOf(build({ on, modifiers: [{ type: "attack-bonus", amount: 2 }] }), LABEL[on])!;
      expect(carrier, `${on} must produce a carrier`).toBeDefined();
      expect(carrier.modifiers).toMatchObject([{ type: "attack-bonus", amount: 2 }]);
      // No source item: a class feature is worn by the BEARER, so its riders are not scoped to a weapon.
      expect(carrier.sourceItemId).toBeUndefined();
      expect(carrier.isWeapon).toBeUndefined();
    }
  });

  it("reaches all THIRTEEN roll-time variants from all SIX carriers, and none of the eight baked ones", () => {
    // The before/after of this whole fix: 78 assertions, one per (carrier, variant) pair either way.
    for (const on of CARRIERS) {
      for (const modifier of ROLL_TIME_RIDERS) {
        const carrier = carrierOf(build({ on, modifiers: [modifier] }), LABEL[on]);
        expect(carrier?.modifiers.map((entry) => entry.type), `${modifier.type} on a ${on} feature must reach the collector`).toEqual([modifier.type]);
      }
      for (const modifier of BUILD_TIME_RIDERS) {
        const carrier = carrierOf(build({ on, modifiers: [modifier] }), LABEL[on]);
        expect(carrier, `${modifier.type} on a ${on} feature is baked and must NOT also be a carrier`).toBeUndefined();
      }
    }
  });

  it("contributes nothing when no feature carries a rider at all", () => {
    const built = build();
    for (const on of CARRIERS) expect(carrierOf(built, LABEL[on])).toBeUndefined();
    // The equipped gear is still carried (that is the item half); nothing it holds carries a rider.
    expect(deriveEquipment(built.hero, built.definition, built.catalog).carriers.flatMap((carrier) => carrier.modifiers)).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// attack-bonus - the rolled to-hit
// -------------------------------------------------------------------------------------------------

describe("a feature's attack-bonus reaches the rolled to-hit", () => {
  it("raises the number the resolver reads, and the roll it actually makes", () => {
    const bare = build();
    // Str 17 (+3) + proficiency 3, martial-proficient: 6.
    expect(actionOf(bare, "item-greatsword").attack!.bonus).toBe(6);

    const built = fight(build({ on: "class", modifiers: [{ type: "attack-bonus", amount: 2 }] }));
    const action = actionOf(built, "item-greatsword");
    expect(action.attack!.bonus).toBe(8);

    // The ROLL, not just the number: d20 = 10 -> 18 total against AC 12.
    const resolution = resolveDefinitionAction(built.state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000001" }, deps(built, [10, 4, 6]));
    expect(resolution.attack).toMatchObject({ total: 18, naturalRoll: 10, targetAc: 12, outcome: "hit" });
  });

  it("applies to EVERY attack the bearer makes, from every carrier kind", () => {
    for (const on of CARRIERS) {
      const built = build({ on, modifiers: [{ type: "attack-bonus", amount: 2 }] });
      // Dex 13 (+1) + proficiency 3 = 4 on the shortbow; the feature lifts both weapons.
      expect(actionOf(built, "item-shortbow").attack!.bonus, `${on} on the bow`).toBe(6);
      expect(actionOf(built, "item-greatsword").attack!.bonus, `${on} on the sword`).toBe(8);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// save-bonus
// -------------------------------------------------------------------------------------------------

describe("a feature's save-bonus reaches the saving throw", () => {
  it("adds to every save, and narrows when the rider says which ability", () => {
    const built = build({ on: "species", modifiers: [{ type: "save-bonus", amount: 2 }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(derivation.saveBonus).toBe(2);
    expect(saveRiderBonus(derivation, "wis")).toBe(2);
    expect(saveRiderBonus(derivation, "dex")).toBe(2);

    const bare = build();
    expect(saveRiderBonus(deriveEquipment(bare.hero, bare.definition, bare.catalog), "wis")).toBe(0);

    const narrowed = build({ on: "species", modifiers: [{ type: "save-bonus", amount: 2, when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] }] });
    const narrowedDerivation = deriveEquipment(narrowed.hero, narrowed.definition, narrowed.catalog);
    expect(narrowedDerivation.saveBonus).toBe(0);              // a gated rider is not in the standing pass
    expect(saveRiderBonus(narrowedDerivation, "dex")).toBe(2);
    expect(saveRiderBonus(narrowedDerivation, "wis")).toBe(0); // `ability-is` really narrows it
  });
});

// -------------------------------------------------------------------------------------------------
// spell-save-dc - the DC the server ENFORCES
// -------------------------------------------------------------------------------------------------

describe("a feature's spell-save-dc raises the DC the target is held to", () => {
  const WAR_CRY = {
    id: "rift-cry", name: "Rift Cry", activation: "action",
    description: "Wisdom Saving Throw: DC 13. Failure: 2d6 Thunder damage.",
    save: { ability: "wis", dc: 13 }, damage: [{ formula: "2d6", type: "thunder" }]
  };

  it("folds into the action's DC and into the pending save the foe must beat", () => {
    const bare = build({ on: "class", actions: [WAR_CRY] });
    expect(actionOf(bare, "rift-cry").save!.dc).toBe(13);

    const built = fight(build({ on: "class", modifiers: [{ type: "spell-save-dc", amount: 2 }], actions: [WAR_CRY] }));
    const action = actionOf(built, "rift-cry");
    expect(action.save!.dc).toBe(15);

    const resolution = resolveDefinitionAction(built.state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000010" }, deps(built, [3, 4]));
    expect(resolution.save!.dc).toBe(15);
    expect(built.state.combat.pendingSaves[0].dc).toBe(15); // the DC actually enforced, not just shown
  });
});

// -------------------------------------------------------------------------------------------------
// extra-damage - dice actually rolled on the hit
// -------------------------------------------------------------------------------------------------

describe("a feature's extra-damage is rolled as its own typed damage entry", () => {
  it("adds the die to the swing, and the rider-less build rolls only the weapon", () => {
    const bare = fight(build());
    const plain = resolveDefinitionAction(bare.state, actionOf(bare, "item-greatsword"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000040" }, deps(bare, [15, 5, 6]));
    // 2d6 (5 + 6) + Str 3 = 14, and NOTHING else.
    expect(plain.damage).toEqual([{ formula: "2d6 + 3", type: "slashing", total: 14 }]);
    expect(plain.damageTotal).toBe(14);

    const built = fight(build({ on: "subclass", modifiers: [{ type: "extra-damage", formula: "1d4", damageType: "fire" }] }));
    const swung = resolveDefinitionAction(built.state, actionOf(built, "item-greatsword"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000041" }, deps(built, [15, 5, 6, 3]));
    expect(swung.damage.map((entry) => entry.type)).toEqual(["slashing", "fire"]);
    expect(swung.damage.find((entry) => entry.type === "fire")).toEqual({ formula: "1d4", type: "fire", total: 3 });
    expect(swung.damageTotal).toBe(17); // 14 + a 3 actually rolled on the rider's d4
  });
});

// -------------------------------------------------------------------------------------------------
// resource-bonus - one more use of a class resource
// -------------------------------------------------------------------------------------------------

describe("a feature's resource-bonus raises a pool the engine actually spends from", () => {
  it("raises Rift Surge's limit and lets the fourth use resolve where the third was the ceiling", () => {
    const bare = build();
    expect(actionOf(bare, "rift-surge").uses!.limit).toBe(3);

    const built = fight(build({ on: "background", modifiers: [{ type: "resource-bonus", poolId: "rift-surge", amount: 1 }] }));
    expect(actionOf(built, "rift-surge").uses!.limit).toBe(4);

    built.hero.actionUses = { "rift-surge": 3 };
    resolveDefinitionAction(built.state, actionOf(built, "rift-surge"), { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000020" }, deps(built, []));
    expect(built.hero.actionUses["rift-surge"]).toBe(4);
  });

  it("refuses the spend when the pool is exhausted and no rider raised it", () => {
    const built = fight(build());
    built.hero.actionUses = { "rift-surge": 3 };
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "rift-surge"), { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000021" }, deps(built, []))).toThrow();
    expect(built.hero.actionUses["rift-surge"]).toBe(3); // the refusal did not spend anything
  });

  it("leaves a pool the rider does not name alone", () => {
    const built = build({ on: "lineage", modifiers: [{ type: "resource-bonus", poolId: "not-rift-surge", amount: 1 }] });
    expect(actionOf(built, "rift-surge").uses!.limit).toBe(3); // the wrong pool: untouched
  });
});

// -------------------------------------------------------------------------------------------------
// A MOMENT-GATED rider fires at its moment and nowhere else
// -------------------------------------------------------------------------------------------------

describe("a feature's moment-gated roll-mode fires only at its moment", () => {
  const RECKLESS = {
    type: "roll-mode", roll: "attack", mode: "advantage",
    when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["melee"] }]
  };

  it("is excluded from the STANDING pass, so it cannot leak into 'always'", () => {
    const built = build({ on: "option", modifiers: [RECKLESS] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    // The carrier holds it...
    expect(carrierOf(built, LABEL.option)!.modifiers).toHaveLength(1);
    // ...but the standing collection does not, by construction.
    expect(collectRiders(derivation.carriers, { ...derivation.context, moment: null })).toEqual([]);
  });

  it("grants advantage on a MELEE attack and leaves a ranged one a single die", () => {
    const melee = fight(build({ on: "option", modifiers: [RECKLESS] }));
    // Two d20s (advantage keeps 18), then the 2d6 greatsword damage.
    const swung = resolveDefinitionAction(melee.state, actionOf(melee, "item-greatsword"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000030" }, deps(melee, [4, 18, 3, 5]));
    expect(swung.rollMode).toMatchObject({ mode: "advantage", advantage: ["Rift Blade"] });
    expect(swung.attack!.naturalRoll).toBe(18); // the HIGHER of the two dice was kept

    const ranged = fight(build({ on: "option", modifiers: [RECKLESS] }));
    const shot = resolveDefinitionAction(ranged.state, actionOf(ranged, "item-shortbow"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000031" }, deps(ranged, [4, 3]));
    expect(shot.rollMode).toBeUndefined();
    expect(shot.attack!.naturalRoll).toBe(4); // ONE die - `attack-kind-is` really filtered
  });

  it("routes a save roll-mode to saves only, and to the named ability only", () => {
    const built = build({ on: "lineage", modifiers: [{ type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["con"] }] }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(saveRollSources(built.hero, "con", derivation).advantage).toEqual([{ source: "item:Deep Rift", label: "Deep Rift" }]);
    expect(saveRollSources(built.hero, "int", derivation).advantage).toEqual([]);
  });

  it("widens the critical range from a feature, the way a keen weapon does from an item", () => {
    const built = build({ on: "subclass", modifiers: [{ type: "critical-range", threshold: 19 }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(criticalThreshold(derivation, built.hero, actionOf(built, "item-greatsword"))).toBe(19);

    const bare = build();
    expect(criticalThreshold(deriveEquipment(bare.hero, bare.definition, bare.catalog), bare.hero, actionOf(bare, "item-greatsword"))).toBe(20);
  });
});

// -------------------------------------------------------------------------------------------------
// `scope: "this-item"` on a feature names an item the feature does not have
// -------------------------------------------------------------------------------------------------

describe("a this-item-scoped rider on a feature does not become an 'always' rider", () => {
  it("fails CLOSED rather than degrading to bearer scope and applying to every attack", () => {
    // `scopeOf` in @vtt/rules-5e reads a carrier with no `sourceItemId` as bearer-scoped, which would
    // silently turn an authored "only with this weapon" into "+5 on everything". It is dropped instead.
    const built = build({ on: "class", modifiers: [{ type: "attack-bonus", amount: 5, scope: "this-item" }] });
    expect(carrierOf(built, LABEL.class)).toBeUndefined();
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(6); // the base number, not 11
    expect(actionOf(built, "item-shortbow").attack!.bonus).toBe(4);
  });

  it("still carries an explicitly bearer-scoped rider", () => {
    const built = build({ on: "class", modifiers: [{ type: "attack-bonus", amount: 5, scope: "bearer" }] });
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(11);
  });
});

// -------------------------------------------------------------------------------------------------
// The eight build-time families must be counted ONCE, not twice
// -------------------------------------------------------------------------------------------------

describe("nothing the builder baked is counted a second time as a carrier", () => {
  it("bakes a feature's speed / initiative / AC exactly once", () => {
    const built = build({ on: "species", modifiers: [{ type: "speed", amount: 10 }, { type: "initiative", amount: 2 }, { type: "armor-class", amount: 1 }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(derivation.speed).toBe(0);
    expect(derivation.initiative).toBe(0);
    expect(derivation.armorClass).toBe(0);

    expect(built.definition.speedFeet).toBe(40);       // 30 + 10, once
    expect(built.hero.speedFeet).toBe(40);
    expect(built.definition.initiativeBonus).toBe(3);  // Dex +1, rider +2, once
    expect(built.hero.initiative).toBe(3);
    expect(built.definition.armorClass).toBe(17);      // chain mail 16 + rider 1
    expect(built.hero.armorClass).toBe(17);
  });

  it("does not double an ability-score rider by also carrying it", () => {
    const built = build({ on: "background", modifiers: [{ type: "ability-score", ability: "str", amount: 2 }] });
    // Str 15 + background 2 + rider 2 = 19... plus 0. The to-hit reads +4, not +5.
    expect(built.definition.abilityScores.str).toBe(19);
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(7);
    expect(carrierOf(built, LABEL.background)).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// Fail-open: the definitions that have NO features array at all must keep working
// -------------------------------------------------------------------------------------------------

describe("the feature carriers fail open", () => {
  it("treats a feature with no catalog record as prose, exactly like an item with none", () => {
    // The sheet is built against a library that knows the class; play-time resolution then runs
    // against one that does not (deleted homebrew, or a stored sheet naming a removed feature).
    const built = build({ on: "class", modifiers: [{ type: "attack-bonus", amount: 2 }] });
    const forgetful = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
    const derivation = deriveEquipment(built.hero, built.definition, forgetful);
    expect(derivation.carriers.some((carrier) => carrier.label === LABEL.class)).toBe(false);
    expect(effectiveActions(built.definition, built.hero, forgetful).find((entry) => entry.id === "item-greatsword")!.attack!.bonus).toBe(6);
  });

  it("derives a definition with NO features array at all, exactly as before - PDF imports and the example party", () => {
    // The additive-optional guarantee, asserted rather than assumed. `character.features` did not
    // exist when these sheets were written, so `?? []` is the ONLY thing standing between them and a
    // crash on every derivation.
    const built = build({ on: "class", modifiers: [{ type: "attack-bonus", amount: 2 }] });
    const legacy = structuredClone(built.definition) as ActorDefinition;
    delete (legacy.character as { features?: unknown }).features;
    expect(legacy.character?.features).toBeUndefined();

    const derivation = deriveEquipment(built.hero, legacy, built.catalog);
    expect(derivation.carriers.map((carrier) => carrier.label)).toEqual(["Greatsword", "Shortbow", "Chain Mail"]); // gear only
    expect(derivation.carriers.flatMap((carrier) => carrier.modifiers)).toEqual([]);    // no array, no feature riders
    expect(effectiveActions(legacy, built.hero, built.catalog).find((entry) => entry.id === "item-greatsword")!.attack!.bonus).toBe(6);

    // And the same sheet with the array intact is the +2 one, so the difference is the array itself.
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(8);
  });

  it("still parses through the canonical schema without a features array", () => {
    const built = build();
    const legacy = structuredClone(built.definition) as Record<string, unknown>;
    delete (legacy.character as { features?: unknown }).features;
    expect(() => ActorDefinitionSchema.parse(legacy)).not.toThrow();
  });
});

// -------------------------------------------------------------------------------------------------
// The recorded array is BOUNDED, so a fat sheet cannot fail to build
// -------------------------------------------------------------------------------------------------

describe("the recorded feature array stays inside the schema's bound", () => {
  it("leaves real headroom for the fattest bundled SRD sheet at level 20", () => {
    // `dedupeFeatureRefs` TRUNCATES at the schema's 80 rather than rejecting, so a sheet that
    // overflowed would lose riders silently - the exact failure mode `2e` exists to end. This counts
    // what the worst real sheet would record (every class feature its 20 level rows grant, its
    // fattest subclass, the fattest species + lineage, the fattest background) straight off the
    // bundled content, so the guard is measured rather than assumed.
    const view = new ContentLibrary().forAudience("gm");
    const widest = (counts: readonly number[]) => counts.reduce((high, value) => Math.max(high, value), 0);
    const classCounts = view.classSummaries().map((summary) => {
      const record = view.classRecord(summary.id)!;
      const granted = new Set(record.levelTable.flatMap((row) => row.features));
      const subclasses = view.subclassSummaries()
        .filter((entry) => view.subclassRecord(entry.id)?.classId === record.id)
        .map((entry) => view.subclassRecord(entry.id)!.features.length);
      return { id: record.id, total: granted.size + widest([0, ...subclasses]) };
    });
    const speciesWidest = widest(view.speciesSummaries().map((summary) => {
      const record = view.speciesRecord(summary.id)!;
      return record.traits.length + widest([0, ...record.lineages.map((lineage) => lineage.traits.length)]);
    }));
    const backgroundWidest = widest(view.backgroundSummaries().map((summary) => view.backgroundRecord(summary.id)!.features.length));

    expect(classCounts.length).toBeGreaterThan(0);
    const worst = widest(classCounts.map((entry) => entry.total)) + speciesWidest + backgroundWidest;
    // Comfortably inside 80, with room for chosen options on top; if this ever tightens, raise the
    // schema's `.max(80)` and this number together rather than letting the truncation start biting.
    expect(worst, `the fattest SRD sheet records ${worst} features`).toBeLessThan(60);
  });
});

// -------------------------------------------------------------------------------------------------
// D5: AGONIZING BLAST. `spell-id-is` + `extra-damage` naming an ability modifier.
// -------------------------------------------------------------------------------------------------

/**
 * The two schema gaps that made Warlock read as broken no matter how much prose landed, and the one
 * printed effect that needs BOTH.
 *
 * "When you cast Eldritch Blast, add your Charisma modifier to the damage it deals on a hit" has two
 * halves the vocabulary could not say. WHICH SPELL: `spell-school-is` and `spell-level-is` name
 * categories, and no combination of school and level picks out one cantrip - so the gate had to
 * become `spell-id-is`, matched against the new `ActorAction.spellId`. HOW MUCH: every amount in the
 * vocabulary was an authored constant, and "your Charisma modifier" is a property of the character,
 * not of the record - so `extra-damage` gained `abilityModifier` beside its `formula`.
 *
 * These assert the NUMBER on the damage roll, not that the rider survived derivation.
 */
describe("Agonizing Blast: a spell-gated rider adds the caster's own ability modifier", () => {
  /** A level-5 sheet with CHA 17 (+3), so the modifier that arrives is unmistakably the right one. */
  const CHA_HERO = {
    scores: { str: 13, dex: 12, con: 14, int: 8, wis: 10, cha: 15 },
    spread: [{ ability: "cha", amount: 2 }, { ability: "str", amount: 1 }]
  } as const;

  /** The cantrip, as a feature action that NAMES the spell it is. */
  const ELDRITCH_BLAST = {
    id: "eldritch-blast", name: "Eldritch Blast", activation: "action",
    description: "A beam of crackling energy streaks toward a creature.",
    attack: { ability: "cha", proficient: true },
    damage: [{ formula: "1d10", type: "force" }],
    spellId: "eldritch-blast"
  };

  /** The invocation, as an option's rider: + CHA to the damage, but only on that one spell. */
  const AGONIZING_BLAST = {
    type: "extra-damage", abilityModifier: "cha", damageType: "force",
    when: [{ type: "on-hit" }, { type: "spell-id-is", spellIds: ["eldritch-blast"] }]
  };

  const warlock = (modifiers: readonly unknown[]) =>
    fight(build({ ...CHA_HERO, on: "option", actionsOn: "class", actions: [ELDRITCH_BLAST], modifiers }));

  it("puts CHA on the Eldritch Blast damage roll as a number", () => {
    const bare = warlock([]);
    // CHA 17 (+3) + proficiency 3 = 6 to hit; the cantrip's own damage is 1d10 force and nothing else.
    expect(actionOf(bare, "eldritch-blast").attack!.bonus).toBe(6);
    const unaided = resolveDefinitionAction(bare.state, actionOf(bare, "eldritch-blast"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000050" }, deps(bare, [10, 7]));
    expect(unaided.attack).toMatchObject({ total: 16, naturalRoll: 10, targetAc: 12, outcome: "hit" });
    expect(unaided.damage).toEqual([{ formula: "1d10", type: "force", total: 7 }]);
    expect(unaided.damageTotal).toBe(7);

    const built = warlock([AGONIZING_BLAST]);
    const blasted = resolveDefinitionAction(built.state, actionOf(built, "eldritch-blast"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000051" }, deps(built, [10, 7]));
    // The SAME two dice; the difference is +3, and 3 is this character's Charisma modifier.
    expect(blasted.damage).toEqual([
      { formula: "1d10", type: "force", total: 7 },
      { formula: "3", type: "force", total: 3 }
    ]);
    expect(blasted.damageTotal).toBe(10);
    expect((blasted.warnings ?? []).some((warning) => warning.includes("+3 force (CHA)"))).toBe(true);
  });

  it("tracks the CHARACTER's Charisma, not an authored constant", () => {
    // The whole point of `abilityModifier`: the same authored record, a different sheet, a different
    // number. CHA 12 (+1) here against CHA 17 (+3) above, with no change to the rider.
    const lesser = fight(build({
      scores: { str: 13, dex: 14, con: 15, int: 8, wis: 10, cha: 12 },
      spread: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
      on: "option", actionsOn: "class", actions: [ELDRITCH_BLAST], modifiers: [AGONIZING_BLAST]
    }));
    const blasted = resolveDefinitionAction(lesser.state, actionOf(lesser, "eldritch-blast"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000052" }, deps(lesser, [10, 7]));
    expect(blasted.damage.at(-1)).toEqual({ formula: "1", type: "force", total: 1 });
    expect(blasted.damageTotal).toBe(8);
  });

  it("does NOT touch a swing that is not that spell", () => {
    // `spell-id-is` is the whole reason this is expressible: without it the only way to say "on a
    // spell" is a school or a level, and the greatsword below is neither - but nor is any OTHER
    // cantrip the Warlock knows, which is what a category gate would have caught by mistake.
    const built = warlock([AGONIZING_BLAST]);
    const swung = resolveDefinitionAction(built.state, actionOf(built, "item-greatsword"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000053" }, deps(built, [15, 5, 6]));
    // 2d6 (5 + 6) + Str 2 = 13, with no Charisma anywhere near it.
    expect(swung.damage).toEqual([{ formula: "2d6 + 2", type: "slashing", total: 13 }]);
    expect(swung.damageTotal).toBe(13);
  });

  it("does NOT fire when the gate names a DIFFERENT spell", () => {
    const built = warlock([{ ...AGONIZING_BLAST, when: [{ type: "on-hit" }, { type: "spell-id-is", spellIds: ["fire-bolt"] }] }]);
    const blasted = resolveDefinitionAction(built.state, actionOf(built, "eldritch-blast"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000054" }, deps(built, [10, 7]));
    expect(blasted.damage).toEqual([{ formula: "1d10", type: "force", total: 7 }]);
    expect(blasted.damageTotal).toBe(7);
  });

  it("does NOT fire on a MISS, because `on-hit` is still `on-hit`", () => {
    const built = warlock([AGONIZING_BLAST]);
    // d20 = 2 -> 8 against AC 12: a miss rolls no damage at all, rider included.
    const missed = resolveDefinitionAction(built.state, actionOf(built, "eldritch-blast"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000055" }, deps(built, [2]));
    expect(missed.attack).toMatchObject({ total: 8, outcome: "miss" });
    expect(missed.damage).toEqual([]);
    expect(missed.damageTotal).toBe(0);
  });

  it("carries dice AND an ability modifier together when a record authors both", () => {
    const built = warlock([{ ...AGONIZING_BLAST, formula: "1d4" }]);
    const blasted = resolveDefinitionAction(built.state, actionOf(built, "eldritch-blast"), { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000056" }, deps(built, [10, 7, 2]));
    // The d4 rolled a 2, and CHA added 3: ONE entry of 5, because it is one rider.
    expect(blasted.damage.at(-1)).toEqual({ formula: "1d4", type: "force", total: 5 });
    expect(blasted.damageTotal).toBe(12);
  });
});

// -------------------------------------------------------------------------------------------------
// An ability-score CHOICE may name its own ceiling - the seven epic boons
// -------------------------------------------------------------------------------------------------

/**
 * `FeatureChoiceSchema.maximum`, and the reason the modifier's `maximum` was not enough.
 *
 * The two are different mechanisms: an `ability-score` RIDER raises a NAMED ability by a fixed
 * amount and has honoured `maximum` all along; a CHOICE lets the player pick which ability, and the
 * epic boons do the second - "increase one ability score by 1, to a maximum of 30". The offer
 * consumer clamped every chosen point at a hard-coded 20, so all seven boons did nothing at all for
 * the only character who ever takes one: a level-19 character already sitting at 20.
 */
describe("an ability-score choice raises past 20 when it says so", () => {
  /** STR 18 rolled + the background's +2 = exactly 20 BEFORE the boon, which is the interesting case. */
  const AT_TWENTY = {
    method: "roll",
    scores: { str: 18, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    spread: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }]
  } as const;

  it("takes STR from 20 to 21 when the choice names a maximum of 30", () => {
    const built = build({ ...AT_TWENTY, boon: 30 });
    expect(built.definition.abilityScores.str).toBe(21);
    // And the number reaches the TABLE, not just the definition: +5 from STR 21, +3 proficiency.
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(8);
  });

  it("stops at 20 when the choice names no maximum - the SRD default is unchanged", () => {
    // The negative control that matters: the fix must not quietly lift the cap for every choice.
    const built = build({ ...AT_TWENTY, boon: false });
    expect(built.definition.abilityScores.str).toBe(20);
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(8); // +5 either way; the SCORE is the assertion
  });

  it("honours a maximum BELOW 20 too, because the field is a ceiling and not a boon flag", () => {
    const built = build({ ...AT_TWENTY, boon: 20 });
    expect(built.definition.abilityScores.str).toBe(20);
  });

  it("still climbs when the score is nowhere near either ceiling", () => {
    // Standard array STR 15 + background 2 = 17, and the boon's +1 makes 18 whatever the ceiling is.
    expect(build({ boon: 30 }).definition.abilityScores.str).toBe(18);
    expect(build({ boon: false }).definition.abilityScores.str).toBe(18);
  });
});
