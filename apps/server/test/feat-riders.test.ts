import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { EquipmentReferenceSchema, FeatReferenceSchema } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { collectRiders } from "@vtt/rules-5e";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary, EMPTY_HOMEBREW_SLICE, type HomebrewContentSource } from "../src/content-library.js";
import { criticalThreshold, effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";
import { setInventoryItem } from "../src/inventory.js";
import { saveRiderBonus, saveRollSources } from "../src/saving-throws.js";

/**
 * A FEAT TAKEN IN THE CHARACTER BUILDER CARRIES THE WHOLE RIDER VOCABULARY - proved end to end.
 *
 * The defect these tests pin: `interpretFeature` folds 8 of the 21 authored rider variants into the
 * ActorDefinition and its `switch` had no `default`, so the other 13 fell through and vanished with
 * no error, no warning and no trace. The SAME feat granted by a magic ITEM got all 21, because
 * `deriveEquipment` pushed the feat's `modifiers` in as a `RiderCarrier`. A homebrew feat was
 * therefore authorable with riders that silently did nothing.
 *
 * The fix is not a bigger switch: the character's own feats become rider carriers read by the SAME
 * `collectRiders` an item's riders go through. So these tests all run the REAL builder against a
 * REAL `ContentLibrary` with a homebrew feat merged in, and then assert at the table - the rolled
 * to-hit, the DC the target is actually held to, the pool the engine will actually spend.
 *
 * Following `item-riders.test.ts`: every criterion that has an obvious way to appear-to-work asserts
 * its NEGATIVE control too - the rider-less build, the wrong roll, the wrong pool, the wrong moment.
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
  { type: "resource-bonus", poolId: "second-wind", amount: 1 },
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
// Harness: a REAL ContentLibrary with one GM-authored homebrew feat (and optionally one item) in it.
// -------------------------------------------------------------------------------------------------

type Homebrew = Readonly<{ modifiers?: readonly unknown[]; actions?: readonly unknown[]; grantsItem?: boolean }>;

function libraryWith(brew: Homebrew): ContentLibrary {
  const feat = FeatReferenceSchema.parse({
    id: "hb-warcaller", name: "Warcaller", source: "homebrew", category: "origin",
    summary: "A homebrew origin feat.",
    feature: {
      id: "hb-warcaller", name: "Warcaller", description: "A homebrew origin feat.",
      modifiers: brew.modifiers ?? [], actions: brew.actions ?? []
    }
  });
  const equipment = brew.grantsItem
    ? [EquipmentReferenceSchema.parse({
        id: "hb-war-horn", name: "War Horn", source: "homebrew", category: "wondrous", costGp: 0,
        weightLb: 0, description: null, slot: "neck", isMagic: true, cursed: false,
        grantsFeatIds: ["hb-warcaller"]
      })]
    : [];
  const source: HomebrewContentSource = {
    revision: 1,
    publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, feats: [feat], equipment }),
    monsterForInstance: () => undefined
  };
  return new ContentLibrary(source);
}

/**
 * A level-5 human Champion whose Human "Versatile" origin-feat pick is the homebrew feat. The rest of
 * the sheet is the known-good Fighter 5 from `character-build.test.ts`, deliberately: it also takes
 * the SHIPPED `defense` fighting-style feat, whose `armor-class` rider is one of the 8 the builder
 * bakes - so every build here doubles as a live double-counting regression.
 */
const heroInput = (): CharacterCreateRequestInput => ({
  name: "Borin", speciesId: "human", backgroundId: "soldier", classId: "fighter", level: 5,
  subclassId: "champion", abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "entries", entries: [1, 10, 4, 6] },
  choices: [
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "hb-warcaller", payload: { featureId: "human-versatile" } },
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
  const definition = buildCharacterDefinition(heroInput(), view, POLICY);
  const catalog = equipmentCatalogOf(view);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  return { definition, catalog, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
}

function fight(built: Built, first: string = IDS.hero): Built {
  startEncounter(built.state, { mapAssetId: IDS.map, entries: [{ actorId: first, score: 20 }, { actorId: first === IDS.hero ? IDS.foe : IDS.hero, score: 10 }] }, () => 1, GEOMETRY);
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
const featCarrier = (built: Built) => deriveEquipment(built.hero, built.definition, built.catalog).carriers.find((carrier) => carrier.label === "Warcaller");

// -------------------------------------------------------------------------------------------------
// The seam: a builder-taken feat IS a rider carrier, and it is a BEARER carrier, not an item one.
// -------------------------------------------------------------------------------------------------

describe("a feat the builder put on the sheet is a rider carrier", () => {
  it("resolves the taken feat's riders through the catalog with NO sourceItemId", () => {
    const built = build({ modifiers: [{ type: "attack-bonus", amount: 2 }] });
    // The builder really recorded it - this is a BUILDER-TAKEN feat, not a hand-written definition.
    expect(built.definition.character?.feats.map((feat) => feat.id).sort())
      .toEqual(["ability-score-improvement", "defense", "hb-warcaller", "savage-attacker"]);

    const carrier = featCarrier(built)!;
    expect(carrier).toBeDefined();
    expect(carrier.modifiers).toMatchObject([{ type: "attack-bonus", amount: 2 }]);
    // No source item: a feat is worn by the BEARER, so its riders are not scoped to any one weapon.
    expect(carrier.sourceItemId).toBeUndefined();
    expect(carrier.isWeapon).toBeUndefined();
  });

  it("reaches all THIRTEEN roll-time variants, and NONE of the eight the builder already baked", () => {
    // The before/after of this whole fix, stated as one assertion each way.
    for (const modifier of ROLL_TIME_RIDERS) {
      const carrier = featCarrier(build({ modifiers: [modifier] }));
      expect(carrier?.modifiers.map((entry) => entry.type), `${modifier.type} must reach the collector`).toEqual([modifier.type]);
    }
    for (const modifier of BUILD_TIME_RIDERS) {
      const carrier = featCarrier(build({ modifiers: [modifier] }));
      expect(carrier, `${modifier.type} is baked into the definition and must NOT also be a carrier`).toBeUndefined();
    }
  });

  it("contributes nothing when the feat carries no riders at all", () => {
    expect(featCarrier(build())).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// attack-bonus - the rolled to-hit
// -------------------------------------------------------------------------------------------------

describe("a feat's attack-bonus reaches the rolled to-hit", () => {
  it("raises the number the resolver reads, and the roll it actually makes", () => {
    const bare = build();
    // Str 19 (+4) + proficiency 3, martial-proficient: 7.
    expect(actionOf(bare, "item-greatsword").attack!.bonus).toBe(7);

    const built = fight(build({ modifiers: [{ type: "attack-bonus", amount: 2 }] }));
    const action = actionOf(built, "item-greatsword");
    expect(action.attack!.bonus).toBe(9);

    // The ROLL, not just the number: d20 = 10 -> 19 total against AC 12.
    const resolution = resolveDefinitionAction(built.state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000001" }, deps(built, [10, 4, 6]));
    expect(resolution.attack).toMatchObject({ total: 19, naturalRoll: 10, targetAc: 12, outcome: "hit" });
  });

  it("applies to EVERY attack the bearer makes, because a feat is not an item", () => {
    const built = build({ modifiers: [{ type: "attack-bonus", amount: 2 }] });
    // Dex 13 (+1) + proficiency 3 = 4 on the ranged weapons; the feat lifts all of them.
    expect(actionOf(built, "item-shortbow").attack!.bonus).toBe(6);
    expect(actionOf(built, "item-flail").attack!.bonus).toBe(9);
  });
});

// -------------------------------------------------------------------------------------------------
// save-bonus
// -------------------------------------------------------------------------------------------------

describe("a feat's save-bonus reaches the saving throw", () => {
  it("adds to every save, and narrows when the rider says which ability", () => {
    const built = build({ modifiers: [{ type: "save-bonus", amount: 2 }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(derivation.saveBonus).toBe(2);
    expect(saveRiderBonus(derivation, "wis")).toBe(2);
    expect(saveRiderBonus(derivation, "dex")).toBe(2);

    const bare = build();
    expect(saveRiderBonus(deriveEquipment(bare.hero, bare.definition, bare.catalog), "wis")).toBe(0);

    const narrowed = build({ modifiers: [{ type: "save-bonus", amount: 2, when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] }] });
    const narrowedDerivation = deriveEquipment(narrowed.hero, narrowed.definition, narrowed.catalog);
    expect(narrowedDerivation.saveBonus).toBe(0);          // a gated rider is not in the standing pass
    expect(saveRiderBonus(narrowedDerivation, "dex")).toBe(2);
    expect(saveRiderBonus(narrowedDerivation, "wis")).toBe(0); // `ability-is` really narrows it
  });
});

// -------------------------------------------------------------------------------------------------
// spell-save-dc - the DC the server ENFORCES
// -------------------------------------------------------------------------------------------------

describe("a feat's spell-save-dc raises the DC the target is held to", () => {
  const WAR_CRY = {
    id: "war-cry", name: "War Cry", activation: "action",
    description: "Wisdom Saving Throw: DC 13. Failure: 2d6 Thunder damage.",
    save: { ability: "wis", dc: 13 }, damage: [{ formula: "2d6", type: "thunder" }]
  };

  it("folds into the action's DC and into the pending save the foe must beat", () => {
    const bare = build({ actions: [WAR_CRY] });
    expect(actionOf(bare, "war-cry").save!.dc).toBe(13);

    const built = fight(build({ modifiers: [{ type: "spell-save-dc", amount: 2 }], actions: [WAR_CRY] }));
    const action = actionOf(built, "war-cry");
    expect(action.save!.dc).toBe(15);

    const resolution = resolveDefinitionAction(built.state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000010" }, deps(built, [3, 4]));
    expect(resolution.save!.dc).toBe(15);
    expect(built.state.combat.pendingSaves[0].dc).toBe(15); // the DC actually enforced, not just shown
  });
});

// -------------------------------------------------------------------------------------------------
// resource-bonus - one more use of a class resource
// -------------------------------------------------------------------------------------------------

describe("a feat's resource-bonus raises a pool the engine actually spends from", () => {
  it("raises Second Wind's limit and lets the fourth use resolve where the third was the ceiling", () => {
    const bare = build();
    expect(actionOf(bare, "second-wind").uses!.limit).toBe(3); // Fighter 5: three uses

    const built = fight(build({ modifiers: [{ type: "resource-bonus", poolId: "second-wind", amount: 1 }] }));
    expect(actionOf(built, "second-wind").uses!.limit).toBe(4);

    built.hero.actionUses = { "second-wind": 3 };
    const action = actionOf(built, "second-wind");
    resolveDefinitionAction(built.state, action, { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000020" }, deps(built, []));
    expect(built.hero.actionUses["second-wind"]).toBe(4);
  });

  it("leaves a pool the rider does not name alone", () => {
    const built = build({ modifiers: [{ type: "resource-bonus", poolId: "second-wind", amount: 1 }] });
    expect(actionOf(built, "action-surge").uses!.limit).toBe(1); // not "second-wind": untouched
  });
});

// -------------------------------------------------------------------------------------------------
// A MOMENT-GATED rider fires at its moment and nowhere else
// -------------------------------------------------------------------------------------------------

describe("a feat's moment-gated roll-mode fires only at its moment", () => {
  const RECKLESS = {
    type: "roll-mode", roll: "attack", mode: "advantage",
    when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["melee"] }]
  };

  it("is excluded from the STANDING pass, so it cannot leak into 'always'", () => {
    const built = build({ modifiers: [RECKLESS] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    // The carrier holds it...
    expect(featCarrier(built)!.modifiers).toHaveLength(1);
    // ...but the standing collection does not, by construction.
    expect(collectRiders(derivation.carriers, { ...derivation.context, moment: null })).toEqual([]);
  });

  it("grants advantage on a MELEE attack and leaves a ranged one a single die", () => {
    const melee = fight(build({ modifiers: [RECKLESS] }));
    const sword = actionOf(melee, "item-greatsword");
    // Two d20s (advantage keeps 18), then the 2d6 greatsword damage.
    const swung = resolveDefinitionAction(melee.state, sword, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000030" }, deps(melee, [4, 18, 3, 5]));
    expect(swung.rollMode).toMatchObject({ mode: "advantage", advantage: ["Warcaller"] });
    expect(swung.attack!.naturalRoll).toBe(18); // the HIGHER of the two dice was kept

    const ranged = fight(build({ modifiers: [RECKLESS] }));
    const bow = actionOf(ranged, "item-shortbow");
    const shot = resolveDefinitionAction(ranged.state, bow, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000031" }, deps(ranged, [4, 3]));
    expect(shot.rollMode).toBeUndefined();
    expect(shot.attack!.naturalRoll).toBe(4); // ONE die - `attack-kind-is` really filtered
  });

  it("routes a save roll-mode to saves only, and to the named ability only", () => {
    const built = build({ modifiers: [{ type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["con"] }] }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(saveRollSources(built.hero, "con", derivation).advantage).toEqual([{ source: "item:Warcaller", label: "Warcaller" }]);
    expect(saveRollSources(built.hero, "int", derivation).advantage).toEqual([]);
  });

  it("widens the critical range from a feat, the way a keen weapon does from an item", () => {
    const built = build({ modifiers: [{ type: "critical-range", threshold: 19 }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    const sword = actionOf(built, "item-greatsword");
    expect(criticalThreshold(derivation, built.hero, sword)).toBe(19);

    const bare = build();
    expect(criticalThreshold(deriveEquipment(bare.hero, bare.definition, bare.catalog), bare.hero, actionOf(bare, "item-greatsword"))).toBe(20);
  });
});

// -------------------------------------------------------------------------------------------------
// `scope: "this-item"` on a feat names an item the feat does not have
// -------------------------------------------------------------------------------------------------

describe("a this-item-scoped rider on a feat does not become an 'always' rider", () => {
  it("fails CLOSED rather than degrading to bearer scope and applying to every attack", () => {
    // `scopeOf` in @vtt/rules-5e reads a carrier with no `sourceItemId` as bearer-scoped, which would
    // silently turn an authored "only with this weapon" into "+5 on everything". It is dropped instead.
    const built = build({ modifiers: [{ type: "attack-bonus", amount: 5, scope: "this-item" }] });
    expect(featCarrier(built)).toBeUndefined();
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(7); // the base number, not 12
    expect(actionOf(built, "item-shortbow").attack!.bonus).toBe(4);
  });

  it("still carries an explicitly bearer-scoped rider", () => {
    const built = build({ modifiers: [{ type: "attack-bonus", amount: 5, scope: "bearer" }] });
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(12);
  });
});

// -------------------------------------------------------------------------------------------------
// The eight build-time families must be counted ONCE, not twice
// -------------------------------------------------------------------------------------------------

describe("nothing the builder baked is counted a second time as a carrier", () => {
  it("keeps the SHIPPED Defense fighting style at +1 AC, not +2", () => {
    // `defense` is a real catalog feat on `character.feats` whose only rider is `armor-class`. If feat
    // carriers did not exclude the baked families, this is the number that would silently drift.
    const built = build();
    expect(built.definition.character?.feats.map((feat) => feat.id)).toContain("defense");
    expect(built.definition.armorClass).toBe(17);   // chain mail 16 + Defense 1
    expect(built.hero.armorClass).toBe(17);         // and the LIVE actor agrees
    expect(deriveEquipment(built.hero, built.definition, built.catalog).armorClass).toBe(0);
  });

  it("bakes a homebrew feat's speed / initiative / AC exactly once", () => {
    const built = build({ modifiers: [{ type: "speed", amount: 10 }, { type: "initiative", amount: 2 }, { type: "armor-class", amount: 1 }] });
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(derivation.speed).toBe(0);
    expect(derivation.initiative).toBe(0);
    expect(derivation.armorClass).toBe(0);

    expect(built.definition.speedFeet).toBe(40);                 // 30 + 10, once
    expect(built.hero.speedFeet).toBe(40);
    expect(built.definition.initiativeBonus).toBe(3);            // Dex +1, rider +2, once
    expect(built.hero.initiative).toBe(3);
    expect(built.definition.armorClass).toBe(18);                // chain mail 16 + Defense 1 + rider 1
    expect(built.hero.armorClass).toBe(18);
  });

  it("does not grant an item-granted feat the character ALREADY took", () => {
    // The belt grants `hb-warcaller`; the hero took `hb-warcaller` in the builder. Folding it again
    // from the item would double every rider on it.
    const built = build({ modifiers: [{ type: "attack-bonus", amount: 2 }], grantsItem: true });
    setInventoryItem(
      built.state, IDS.hero,
      InventoryItemSchema.parse({ id: "hb-war-horn", name: "War Horn", equipped: true, category: "wondrous" }),
      (definitionId) => built.state.definitions.find((entry) => entry.id === definitionId)?.definition,
      { catalog: built.catalog, role: "gm" }
    );
    const derivation = deriveEquipment(built.hero, built.definition, built.catalog);
    expect(derivation.featIds).toEqual([]); // already held, so the item grants nothing
    expect(derivation.carriers.filter((carrier) => carrier.modifiers.some((modifier) => modifier.type === "attack-bonus"))).toHaveLength(1);
    expect(actionOf(built, "item-greatsword").attack!.bonus).toBe(9); // +2 once, not +4
  });
});

// -------------------------------------------------------------------------------------------------
// Fail-open
// -------------------------------------------------------------------------------------------------

describe("the feat carriers fail open", () => {
  it("treats a feat with no catalog record as prose, exactly like an item with none", () => {
    // The sheet is built against a library that knows the feat; play-time resolution then runs
    // against one that does not (deleted homebrew, or an imported sheet naming an unknown feat).
    const built = build({ modifiers: [{ type: "attack-bonus", amount: 2 }] });
    const forgetful = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
    const derivation = deriveEquipment(built.hero, built.definition, forgetful);
    expect(derivation.carriers.some((carrier) => carrier.label === "Warcaller")).toBe(false);
    expect(effectiveActions(built.definition, built.hero, forgetful).find((entry) => entry.id === "item-greatsword")!.attack!.bonus).toBe(7);
  });
});
