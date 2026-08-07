import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { effectiveActions } from "../src/effective-actions.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { startEncounter } from "../src/encounter.js";

/**
 * STAGE 4, LANE B4 - WARLOCK, SORCERER, WIZARD, held to the number a player can act on.
 *
 * The bar this file is written to (`docs/product/stage-4-authoring-assignments.md` §6): a test
 * proves a rolled number, a spent counter, a refusal, or rendered text. "The rider survived
 * derivation" is not a test - `2e` shipped inert and typechecking, and that is the failure this
 * whole area exists to end. So every assertion below runs the REAL builder against the REAL SRD
 * bundles and then reads the sheet, the pool, or the table.
 *
 * Each `describe` also names the audit row
 * (`docs/product/pre-stage-4-pick-promise-audit.md`) it closes, so a row that regresses has a test
 * that says which one.
 */

const library = new ContentLibrary().forAudience("gm");
const POLICY = BuilderPolicySchema.parse({});
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

type Row = CharacterCreateRequestInput["choices"][number];

// -------------------------------------------------------------------------------------------------
// Harness
// -------------------------------------------------------------------------------------------------

/**
 * A Human Acolyte Warlock of the Fiend, at whatever level the test needs.
 *
 * `extra` carries only the rows the level demands (invocations, ASIs, the arcanum) so each test
 * reads as the promise it is checking rather than as a wall of ledger rows. CHA 15 + the Acolyte's
 * +2 = 17 (+3) before any ASI, which is the modifier every Charisma-derived number below is checked
 * against.
 */
const warlockInput = (level: number, extra: readonly Row[] = []): CharacterCreateRequestInput => ({
  name: "Vex", speciesId: "human", backgroundId: "acolyte", classId: "warlock", level,
  subclassId: "fiend-patron", abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  backgroundBonusAllocation: [{ ability: "cha", amount: 2 }, { ability: "wis", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
    { level: 1, classId: "warlock", kind: "skill", id: "deception" },
    { level: 1, kind: "skill", id: "insight", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 3, classId: "warlock", kind: "subclass", id: "fiend-patron" },
    { level: 1, kind: "equipment", id: "warlock-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" },
    ...extra
  ] as CharacterCreateRequestInput["choices"]
});

/** One invocation ledger row, stamped at the level the printed Invocations column pays for it. */
const invocation = (level: number, id: string): Row =>
  ({ level, classId: "warlock", kind: "eldritch-invocation", id, payload: { featureId: "eldritch-invocations" } }) as Row;

/** One Ability Score Improvement, taken as +1/+1 into the named ability. */
const asi = (level: number, ability: "cha" | "dex" = "cha"): Row[] => ([
  { level, classId: "warlock", kind: "asi-or-feat", id: "ability-score-improvement" },
  { level, kind: "ability-score", id: ability, payload: { featureId: "ability-score-improvement" } },
  { level, kind: "ability-score", id: ability, payload: { featureId: "ability-score-improvement" } }
] as Row[]);

/** The invocations a Warlock of this level is OWED by the printed column, as boring a set as possible. */
const FILLER: ReadonlyArray<readonly [level: number, id: string]> = [
  [1, "armor-of-shadows"], [2, "mask-of-many-faces"], [2, "misty-visions"],
  [5, "master-of-myriad-forms"], [5, "one-with-shadows"], [7, "whispers-of-the-grave"],
  [9, "visions-of-distant-realms"], [12, "ascendant-step"], [15, "otherworldly-leap"],
  [18, "fiendish-vigor"]
];
/**
 * The printed Invocations column, restated: 1 at L1, 3 at L2, 5 at L5, 6 at L7, 7 at L9, 8 at L12,
 * 9 at L15, 10 at L18. Every build below is exactly full, which is what makes the budget testable -
 * an under-filled offer rejects and an over-filled one rejects too.
 */
const invocationsAt = (level: number) =>
  [[18, 10], [15, 9], [12, 8], [9, 7], [7, 6], [5, 5], [2, 3], [1, 1]].find(([at]) => level >= at)![1];
const fillerFor = (level: number): Row[] =>
  FILLER.slice(0, invocationsAt(level)).map(([grantedAt, id]) => invocation(grantedAt, id));
/** Every ASI a Warlock of this level has been granted (levels 4, 8, 12, 16). */
const asisFor = (level: number, ability: "cha" | "dex" = "cha"): Row[] =>
  [4, 8, 12, 16].filter((at) => at <= level).flatMap((at) => asi(at, ability));

type Built = Readonly<{ definition: ActorDefinition; catalog: ReturnType<typeof equipmentCatalogOf>; state: GameState; hero: Actor }>;

function table(definition: ActorDefinition): Built {
  const catalog = equipmentCatalogOf(library);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 200, maximum: 200 }, armorClass: 12 }]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  const built = { definition, catalog, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
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
const spellOf = (definition: ActorDefinition, id: string) => (definition.spellcasting?.spells ?? []).find((spell) => spell.id === id);
const thrown = (run: () => unknown): string => {
  try { run(); } catch (error) { return (error as Error).message; }
  throw new Error("expected a rejection, got none");
};

// -------------------------------------------------------------------------------------------------
// WARLOCK - class features
// -------------------------------------------------------------------------------------------------

describe("Warlock: Mystic Arcanum is a real pick and a real once-per-day casting (audit rows 15-18)", () => {
  const arcanum = (level: number, featureId: string, spellId: string): Row =>
    ({ level, kind: "spell", id: spellId, payload: { featureId } }) as Row;

  const level11 = () => buildCharacterDefinition(warlockInput(11, [
    ...fillerFor(11), ...asisFor(11),
    { level: 10, classId: "warlock", kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } } as Row,
    arcanum(11, "mystic-arcanum-level-6-spell", "true-seeing")
  ]), library, POLICY);

  it("puts the chosen level-6 Warlock spell on the sheet, above every slot the class has", () => {
    // The point of the feature and the reason it cannot be a class prepared-spell pick: Pact Magic
    // tops out at level 5, so the class budget refuses a level-6 spell outright. As a FEATURE pick
    // it lands - a level-6 spell on a sheet whose highest slot is level 5.
    const built = level11();
    expect(built.spellcasting!.slots.map((slot) => slot.level)).toEqual([5]);
    expect(spellOf(built, "true-seeing")).toMatchObject({ id: "true-seeing", level: 6, prepared: true });
  });

  it("spends its own once-per-Long-Rest use and refuses the second", () => {
    const built = table(level11());
    expect(actionOf(built, "mystic-arcanum-level-6-spell").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(built.state, actionOf(built, "mystic-arcanum-level-6-spell"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000001" }, deps(built, []));
    expect(built.hero.actionUses["mystic-arcanum-level-6-spell"]).toBe(1);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "mystic-arcanum-level-6-spell"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000002" }, deps(built, []))).toThrow();
    expect(built.hero.actionUses["mystic-arcanum-level-6-spell"]).toBe(1); // the refusal spent nothing
  });

  it("refuses a spell ABOVE the arcanum's level, naming the ceiling", () => {
    // `maxSpellLevel` is doing real work: the level-6 arcanum will not take a level-7 spell.
    const message = thrown(() => buildCharacterDefinition(warlockInput(11, [
      ...fillerFor(11), ...asisFor(11),
      { level: 10, classId: "warlock", kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } } as Row,
      arcanum(11, "mystic-arcanum-level-6-spell", "forcecage")
    ]), library, POLICY));
    expect(message).toMatch(/above the maximum spell level \(6\)/);
  });

  it("refuses the build that leaves the arcanum unchosen", () => {
    // Before this wave the four arcanum records carried no `choice` at all, so a level-17 Warlock
    // was never asked and never noticed. Now the pick is owed and the build says so by name.
    const message = thrown(() => buildCharacterDefinition(warlockInput(11, [
      ...fillerFor(11), ...asisFor(11),
      { level: 10, classId: "warlock", kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } } as Row
    ]), library, POLICY));
    expect(message).toMatch(/"Mystic Arcanum Level 6 Spell" needs 1 pick\(s\) of kind "spell"/);
  });

  it("offers all FOUR arcana by level 17, each with its own level and its own daily use", () => {
    const built = table(buildCharacterDefinition(warlockInput(17, [
      ...fillerFor(17), ...asisFor(17),
      { level: 10, classId: "warlock", kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } } as Row,
      arcanum(11, "mystic-arcanum-level-6-spell", "true-seeing"),
      arcanum(13, "mystic-arcanum-level-7-spell", "forcecage"),
      arcanum(15, "mystic-arcanum-level-8-spell", "demiplane"),
      arcanum(17, "mystic-arcanum-level-9-spell", "foresight")
    ]), library, POLICY));
    expect([6, 7, 8, 9].map((level) => spellOf(built.definition, ["true-seeing", "forcecage", "demiplane", "foresight"][level - 6])!.level))
      .toEqual([6, 7, 8, 9]);
    // Four SEPARATE pools, not one shared counter: the SRD regains "all uses" on a Long Rest.
    for (const level of [6, 7, 8, 9]) {
      expect(actionOf(built, `mystic-arcanum-level-${level}-spell`).uses).toMatchObject({ limit: 1, per: "long-rest" });
    }
  });
});

describe("Warlock: Contact Patron hands over the spell and the free casting (audit row 33)", () => {
  // Level 9: seven invocations and two ASIs, and Fiendish Resilience has not been granted yet.
  const level9 = () => buildCharacterDefinition(warlockInput(9, [...fillerFor(9), ...asisFor(9)]), library, POLICY);

  it("always has Contact Other Plane prepared without charging the prepared budget", () => {
    const built = level9();
    // A level-9 Warlock prepares 10 spells. The grant is `alwaysPrepared`, so it rides free - that
    // distinction is the whole reason `grants.spells` exists rather than a silent extra pick.
    expect(spellOf(built, "contact-other-plane")).toMatchObject({ level: 5, alwaysPrepared: true, prepared: true });
    expect(built.spellcasting!.classes![0]).toMatchObject({ classId: "warlock", prepared: 10 });
  });

  it("gives it a once-per-Long-Rest counter the engine really spends", () => {
    const built = table(level9());
    expect(actionOf(built, "contact-patron").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(built.state, actionOf(built, "contact-patron"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000010" }, deps(built, []));
    expect(built.hero.actionUses["contact-patron"]).toBe(1);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "contact-patron"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000011" }, deps(built, []))).toThrow();
  });
});

describe("Warlock: Magical Cunning is a trackable pool rather than a paragraph", () => {
  it("spends once per Long Rest and refuses the second rite", () => {
    const built = table(buildCharacterDefinition(warlockInput(5, fillerFor(5).concat(asisFor(5))), library, POLICY));
    expect(actionOf(built, "magical-cunning").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(built.state, actionOf(built, "magical-cunning"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000020" }, deps(built, []));
    expect(built.hero.actionUses["magical-cunning"]).toBe(1);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "magical-cunning"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000021" }, deps(built, []))).toThrow();
  });
});

describe("Warlock: Epic Boon is offered at last (audit row 6, the Warlock's)", () => {
  const level19 = (featId: string | null) => warlockInput(19, [
    ...fillerFor(19), ...asisFor(19),
    { level: 10, classId: "warlock", kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } } as Row,
    { level: 11, kind: "spell", id: "true-seeing", payload: { featureId: "mystic-arcanum-level-6-spell" } } as Row,
    { level: 13, kind: "spell", id: "forcecage", payload: { featureId: "mystic-arcanum-level-7-spell" } } as Row,
    { level: 15, kind: "spell", id: "demiplane", payload: { featureId: "mystic-arcanum-level-8-spell" } } as Row,
    { level: 17, kind: "spell", id: "foresight", payload: { featureId: "mystic-arcanum-level-9-spell" } } as Row,
    ...(featId === null ? [] : [
      { level: 19, classId: "warlock", kind: "feat", id: featId, payload: { featureId: "epic-boon" } } as Row,
      // The boon's OWN pick - "increase one ability score by 1, to a maximum of 30". A chosen feat's
      // feature asks for picks of its own, which is why pass A settles feats before pass B.
      { level: 19, kind: "ability-score", id: "cha", payload: { featureId: featId } } as Row
    ])
  ]);

  it("accepts an epic-boon feat and puts it on the sheet", () => {
    const built = buildCharacterDefinition(level19("boon-of-fate"), library, POLICY);
    expect((built.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-fate");
  });

  it("refuses the build with no boon chosen, where before there was nothing to choose", () => {
    expect(thrown(() => buildCharacterDefinition(level19(null), library, POLICY)))
      .toMatch(/"Epic Boon" needs 1 pick\(s\) of kind "feat"/);
  });

  it("refuses a feat that is not an epic boon", () => {
    expect(thrown(() => buildCharacterDefinition(level19("grappler"), library, POLICY)))
      .toMatch(/not an offered option/);
  });
});

// -------------------------------------------------------------------------------------------------
// WARLOCK - Fiend Patron
// -------------------------------------------------------------------------------------------------

describe("Fiend Patron: the level-3 Fiend Spells arrive prepared and free (audit row 27)", () => {
  it("hands over all four without charging one prepared slot", () => {
    const built = buildCharacterDefinition(warlockInput(5, fillerFor(5).concat(asisFor(5))), library, POLICY);
    for (const id of ["burning-hands", "command", "scorching-ray", "suggestion"]) {
      expect(spellOf(built, id)).toMatchObject({ id, alwaysPrepared: true, prepared: true });
    }
    // Fireball is the LEVEL-5 tier and is deliberately NOT granted: `grants.spells` has no
    // character-level gate, and the overlay cannot split one printed feature into staged records.
    // The table is in the description; over-granting it here would arm a level-3 Warlock with Geas.
    expect(spellOf(built, "fireball")).toBeUndefined();
  });
});

describe("Fiend Patron: Dark One's Own Luck counts off the CHARACTER's Charisma", () => {
  it("gives a CHA 17 Warlock three uses and a CHA 20 Warlock five", () => {
    // The same authored record, two sheets, two numbers - which is what `ability-modifier` scaling
    // is for. A flat authored limit would be wrong for one of these two.
    // Level 6, the ASI spent on Dexterity: Charisma stays at the Acolyte's 17 (+3).
    const cha17 = table(buildCharacterDefinition(warlockInput(6, fillerFor(6).concat(asisFor(6, "dex"))), library, POLICY));
    expect(cha17.definition.abilityScores.cha).toBe(17);
    expect(actionOf(cha17, "dark-ones-own-luck").uses).toMatchObject({ limit: 3, per: "long-rest" });

    const cha20 = table(buildCharacterDefinition(warlockInput(11, [
      ...fillerFor(11), ...asisFor(11),
      { level: 10, classId: "warlock", kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } } as Row,
      { level: 11, kind: "spell", id: "true-seeing", payload: { featureId: "mystic-arcanum-level-6-spell" } } as Row
    ]), library, POLICY));
    expect(cha20.definition.abilityScores.cha).toBe(20);
    expect(actionOf(cha20, "dark-ones-own-luck").uses).toMatchObject({ limit: 5, per: "long-rest" });
  });
});

describe("Fiend Patron: Fiendish Resilience halves the damage it names (audit row 66, base pick)", () => {
  const resilient = (damageType: string) => buildCharacterDefinition(warlockInput(10, [
    ...fillerFor(11), ...asisFor(10),
    { level: 10, classId: "warlock", kind: "damage-type", id: damageType, payload: { featureId: "fiendish-resilience" } } as Row
  ]), library, POLICY);

  it("takes half of the chosen type and all of another - at the table, not on the record", () => {
    const built = table(resilient("fire"));
    expect(built.definition.damageResistances).toEqual(["fire"]);
    const burned = applyDamageDetailed(built.state, IDS.hero, { amount: 17, parts: [{ amount: 17, type: "fire" }] },
      { role: "gm" }, { resolveDefinition: () => built.definition, catalog: built.catalog });
    expect(burned.application.totalApplied).toBe(8); // 17 halved, rounded down

    const frozen = applyDamageDetailed(built.state, IDS.hero, { amount: 17, parts: [{ amount: 17, type: "cold" }] },
      { role: "gm" }, { resolveDefinition: () => built.definition, catalog: built.catalog });
    expect(frozen.application.totalApplied).toBe(17); // a type the pick did not name: untouched
  });

  it("resists whichever type the player actually chose, not an authored default", () => {
    const built = resilient("necrotic");
    expect(built.damageResistances).toEqual(["necrotic"]);
  });

  it("refuses Force, which the SRD excludes, and refuses leaving the pick unmade", () => {
    expect(thrown(() => resilient("force"))).toMatch(/not an offered option/);
    expect(thrown(() => buildCharacterDefinition(warlockInput(10, [...fillerFor(11), ...asisFor(10)]), library, POLICY)))
      .toMatch(/"Fiendish Resilience" needs 1 pick\(s\) of kind "damage-type"/);
  });
});

describe("Fiend Patron: Hurl Through Hell rolls its 8d10 and holds the target to the real DC", () => {
  const level14 = () => table(buildCharacterDefinition(warlockInput(14, [
    ...fillerFor(14), ...asisFor(14),
    { level: 10, classId: "warlock", kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } } as Row,
    { level: 11, kind: "spell", id: "true-seeing", payload: { featureId: "mystic-arcanum-level-6-spell" } } as Row,
    { level: 13, kind: "spell", id: "forcecage", payload: { featureId: "mystic-arcanum-level-7-spell" } } as Row
  ]), library, POLICY));

  it("proposes 8d10 Psychic against a Charisma save at the Warlock's own spell save DC", () => {
    const built = level14();
    // CHA 20 (+5) and proficiency +5 at level 14: DC 8 + 5 + 5 = 18, derived rather than authored.
    const action = actionOf(built, "hurl-through-hell");
    expect(action.save).toEqual({ ability: "cha", dc: 18 });
    expect(built.definition.spellcasting!.saveDc).toBe(18);

    const hurled = resolveDefinitionAction(built.state, action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000030" },
      deps(built, [10, 10, 10, 10, 10, 10, 10, 10]));
    expect(hurled.damage).toEqual([{ formula: "8d10", type: "psychic", total: 80 }]);
    expect(built.state.combat.pendingSaves.map((save) => ({ ability: save.ability, dc: save.dc, damage: save.proposedDamage })))
      .toEqual([{ ability: "cha", dc: 18, damage: 80 }]);
  });

  it("is once per Long Rest and refuses the second hurl", () => {
    const built = level14();
    expect(actionOf(built, "hurl-through-hell").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(built.state, actionOf(built, "hurl-through-hell"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000031" }, deps(built, [1, 1, 1, 1, 1, 1, 1, 1]));
    expect(built.hero.actionUses["hurl-through-hell"]).toBe(1);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "hurl-through-hell"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000032" }, deps(built, []))).toThrow();
  });
});
