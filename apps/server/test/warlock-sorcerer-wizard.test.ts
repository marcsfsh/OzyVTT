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
import { endEncounter, startEncounter } from "../src/encounter.js";
import { applyRest } from "../src/rests.js";

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

// -------------------------------------------------------------------------------------------------
// WARLOCK - the 28 Eldritch Invocations
// -------------------------------------------------------------------------------------------------

/**
 * A level-5 Warlock holding FOUR filler invocations plus whichever one is under test, so every
 * build below is exactly on the printed budget of five.
 */
const withInvocation = (id: string, extra: readonly Row[] = []) => buildCharacterDefinition(warlockInput(5, [
  invocation(1, "armor-of-shadows"), invocation(2, "mask-of-many-faces"), invocation(2, "misty-visions"),
  invocation(5, "master-of-myriad-forms"), invocation(5, id),
  // The level-4 ASI goes into Dexterity so Charisma stays at the Acolyte's 17 (+3) - the number
  // Agonizing Blast's damage is checked against below.
  ...asisFor(5, "dex"), ...extra
]), library, POLICY);
/** The same Warlock with a fifth FILLER instead - the negative control for every assertion below. */
const withoutInvocation = () => withInvocation("one-with-shadows");

describe("Warlock invocations: the eleven free castings are handed over (audit rows 37-47)", () => {
  it("puts each granted spell on the sheet as always-prepared, and free of the prepared budget", () => {
    // Four of the eleven, taken together, and none of them is even on the Warlock spell list -
    // which is the point: `grants.spells` hands over a spell the class could never have prepared.
    const built = withInvocation("otherworldly-leap");
    for (const [id, level] of [["mage-armor", 1], ["disguise-self", 1], ["silent-image", 1], ["alter-self", 2], ["jump", 1]] as const) {
      expect(spellOf(built, id)).toMatchObject({ id, level, alwaysPrepared: true, prepared: true });
    }
    // A level-5 Warlock prepares 6 spells. Five granted castings on top, all uncharged - the only
    // charged entry on this sheet is the Magic Initiate spell the background handed over.
    expect(built.spellcasting!.classes![0]).toMatchObject({ classId: "warlock", prepared: 6 });
    expect((built.spellcasting!.spells ?? []).filter((spell) => spell.alwaysPrepared === false).map((spell) => spell.id))
      .toEqual(["bless"]);
  });

  it("hands over NOTHING when the invocation was not taken", () => {
    // The negative control: the same class, the same level, one different invocation id.
    expect(spellOf(withoutInvocation(), "jump")).toBeUndefined();
    expect(spellOf(withoutInvocation(), "invisibility")).toMatchObject({ id: "invisibility", alwaysPrepared: true });
  });

  it("gives Gift of the Depths the once-per-Long-Rest counter the SRD prints, and spends it", () => {
    // The one of the eleven the text limits. The other ten are at will and carry no pool at all.
    const built = table(withInvocation("gift-of-the-depths"));
    expect(spellOf(built.definition, "water-breathing")).toMatchObject({ level: 3, alwaysPrepared: true });
    expect(actionOf(built, "gift-of-the-depths").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(built.state, actionOf(built, "gift-of-the-depths"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000040" }, deps(built, []));
    expect(built.hero.actionUses["gift-of-the-depths"]).toBe(1);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "gift-of-the-depths"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000041" }, deps(built, []))).toThrow();

    // ...and an at-will one mints no pool, so the sheet is not littered with counters nobody spends.
    const atWill = table(withInvocation("otherworldly-leap"));
    expect(effectiveActions(atWill.definition, atWill.hero, atWill.catalog).some((entry) => entry.id === "otherworldly-leap")).toBe(false);
  });
});

describe("Warlock invocations: Agonizing Blast adds the caster's Charisma to the blast (audit row 51)", () => {
  /**
   * Eldritch Blast as the sheet would cast it. The builder does not mint spell ACTIONS, so the
   * cantrip is supplied here - but the RIDER under test comes from the real bundle, off the real
   * chosen option, through the real derivation and the real resolver.
   */
  const ELDRITCH_BLAST = {
    id: "eldritch-blast", name: "Eldritch Blast", activation: "action" as const,
    description: "A beam of crackling energy streaks toward a creature.",
    attack: { bonus: 6 }, damage: [{ formula: "1d10", type: "force" }], spellId: "eldritch-blast"
  };

  const blast = (id: string, faces: number[]) => {
    const built = table(withInvocation(id));
    return resolveDefinitionAction(built.state, ELDRITCH_BLAST,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000050" }, deps(built, faces));
  };

  it("rolls 1d10 force PLUS the Warlock's +3, and 1d10 alone without the invocation", () => {
    // CHA 17 (+3) at level 5. Same two dice both times; the difference is the authored rider.
    const bare = blast("one-with-shadows", [15, 7]);
    expect(bare.damage).toEqual([{ formula: "1d10", type: "force", total: 7 }]);
    expect(bare.damageTotal).toBe(7);

    const agonized = blast("agonizing-blast", [15, 7]);
    expect(agonized.damage).toEqual([
      { formula: "1d10", type: "force", total: 7 },
      { formula: "3", type: "force", total: 3 }
    ]);
    expect(agonized.damageTotal).toBe(10);
    expect((agonized.warnings ?? []).some((warning) => warning.includes("+3 force (CHA)"))).toBe(true);
  });

  it("leaves a swing that is not that spell alone", () => {
    // `spell-id-is` is what makes the gate sayable at all, and this is the proof it filters: the
    // Warlock's own starting sickle is not Eldritch Blast and gains nothing.
    const built = table(withInvocation("agonizing-blast"));
    const swung = resolveDefinitionAction(built.state, actionOf(built, "item-sickle"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000051" }, deps(built, [15, 4]));
    expect(swung.damage.some((part) => part.type === "force")).toBe(false);
    expect(swung.damage).toEqual([{ formula: "1d4 - 1", type: "slashing", total: 3 }]); // Str 8, and no Charisma anywhere
  });
});

describe("Warlock invocations: the ones that ask a question of their own (audit rows 24, 25, 50)", () => {
  /**
   * LESSONS OF THE FIRST ONES (audit row 24) IS DELIBERATELY NOT AUTHORED, and this pins why.
   *
   * `{kind: "feat"}` on an option's nested choice cannot be answered by the current builder: FEAT-
   * kinded rows are settled in pass A and chosen OPTIONS in pass A2, so the offer would not exist
   * when the row is matched - and leaving the row out fails the completeness check instead. Both
   * directions reject, so authoring it would make the invocation untakeable rather than working.
   * This test is the guard: if the pass ordering is ever fixed, it fails and says to author the row.
   */
  it("still takes Lessons of the First Ones as a bare option, because a nested FEAT pick cannot be answered yet", () => {
    // Takeable today, granting only its prose - which is the honest state.
    expect(() => withInvocation("lessons-of-the-first-ones")).not.toThrow();
    // ...and the reason it is not authored: a feat row aimed at it finds no offer, because pass A
    // ran before pass A2 created one.
    expect(thrown(() => withInvocation("lessons-of-the-first-ones", [
      { level: 5, classId: "warlock", kind: "feat", id: "tough", payload: { featureId: "lessons-of-the-first-ones" } } as Row
    ]))).toMatch(/No feature "lessons-of-the-first-ones" offers a "feat" choice/);
  });

  it("Pact of the Blade asks which weapon, and records the answer", () => {
    const built = withInvocation("pact-of-the-blade", [
      { level: 5, classId: "warlock", kind: "weapon", id: "greatsword", payload: { featureId: "pact-of-the-blade" } } as Row
    ]);
    expect((built.character?.choices ?? []).some((row) => row.kind === "weapon" && row.id === "greatsword")).toBe(true);
    expect(thrown(() => withInvocation("pact-of-the-blade")))
      .toMatch(/"Pact of the Blade" needs 1 pick\(s\) of kind "weapon"/);
  });

  it("Pact of the Tome asks for THREE cantrips and puts all three on the sheet", () => {
    const tome = (ids: readonly string[]) => withInvocation("pact-of-the-tome",
      ids.map((id) => ({ level: 5, kind: "cantrip", id, payload: { featureId: "pact-of-the-tome" } } as Row)));
    const built = tome(["chill-touch", "minor-illusion", "true-strike"]);
    for (const id of ["chill-touch", "minor-illusion", "true-strike"]) {
      expect(spellOf(built, id)).toMatchObject({ id, level: 0, prepared: true });
    }
    // A level-5 Warlock's own cantrip budget is 3 and it is untouched: the book's three are extra.
    expect((built.spellcasting!.spells ?? []).filter((spell) => spell.level === 0)).toHaveLength(5); // 3 book + 2 Magic Initiate
    expect(thrown(() => tome(["chill-touch", "minor-illusion"])))
      .toMatch(/"Pact of the Tome" needs 3 pick\(s\) of kind "cantrip"/);
    expect(thrown(() => tome(["chill-touch", "minor-illusion", "true-strike", "mage-hand"])))
      .toMatch(/exceeds what this build may choose/);
  });

  it("Pact of the Chain hands over Find Familiar, free (audit row 36)", () => {
    expect(spellOf(withInvocation("pact-of-the-chain"), "find-familiar"))
      .toMatchObject({ id: "find-familiar", level: 1, alwaysPrepared: true, prepared: true });
    expect(spellOf(withoutInvocation(), "find-familiar")).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// SORCERER
// -------------------------------------------------------------------------------------------------

/** A Human Acolyte Draconic Sorcerer. CHA 15 + the Acolyte's +2 = 17 (+3) before any ASI. */
const sorcererInput = (level: number, extra: readonly Row[] = []): CharacterCreateRequestInput => ({
  name: "Ilde", speciesId: "human", backgroundId: "acolyte", classId: "sorcerer", level,
  // The subclass arrives at level 3; below that the builder refuses one, so the low-level cases
  // below (Font of Magic at 1 and 2) run without it.
  ...(level >= 3 ? { subclassId: "draconic-sorcery" } : {}), abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  backgroundBonusAllocation: [{ ability: "cha", amount: 2 }, { ability: "wis", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "sorcerer", kind: "skill", id: "arcana" },
    { level: 1, classId: "sorcerer", kind: "skill", id: "deception" },
    { level: 1, kind: "skill", id: "insight", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    ...(level >= 3 ? [{ level: 3, classId: "sorcerer", kind: "subclass", id: "draconic-sorcery" }] : []),
    { level: 1, kind: "equipment", id: "sorcerer-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" },
    ...extra
  ] as CharacterCreateRequestInput["choices"]
});

/** Metamagic: two at level 2, two more at 10, two more at 17 - the SRD's six. */
const metamagic = (level: number, ids: readonly string[]): Row[] =>
  ids.map((id) => ({ level, classId: "sorcerer", kind: "metamagic", id, payload: { featureId: "metamagic" } } as Row));
const sorcererAsi = (level: number, ability: "cha" | "dex" = "dex"): Row[] => ([
  { level, classId: "sorcerer", kind: "asi-or-feat", id: "ability-score-improvement" },
  { level, kind: "ability-score", id: ability, payload: { featureId: "ability-score-improvement" } },
  { level, kind: "ability-score", id: ability, payload: { featureId: "ability-score-improvement" } }
] as Row[]);
/** Everything a Sorcerer of this level owes beyond the base rows: metamagic, ASIs, the affinity. */
const sorcererFor = (level: number, affinity = "fire"): Row[] => [
  ...(level >= 2 ? metamagic(2, ["careful-spell", "distant-spell"]) : []),
  ...(level >= 10 ? metamagic(10, ["quickened-spell", "subtle-spell"]) : []),
  ...(level >= 17 ? metamagic(17, ["twinned-spell", "empowered-spell"]) : []),
  ...[4, 8, 12, 16].filter((at) => at <= level).flatMap((at) => sorcererAsi(at)),
  ...(level >= 6 ? [{ level: 6, classId: "sorcerer", kind: "damage-type", id: affinity, payload: { featureId: "elemental-affinity" } } as Row] : [])
];
const sorcerer = (level: number, affinity = "fire") =>
  buildCharacterDefinition(sorcererInput(level, sorcererFor(level, affinity)), library, POLICY);

describe("Sorcerer: Font of Magic turns the printed Sorcery Points column into a real pool", () => {
  it("reads the column at the character's own level, and spends down to the refusal", () => {
    // The printed column: 2 at level 2, 5 at level 5. A `by-level` table retyped beside the column
    // it duplicates is the second copy that drifts - `class-resource` reads the column itself.
    expect(actionOf(table(sorcerer(2)), "font-of-magic").uses).toMatchObject({ limit: 2, pool: "sorcery-points", per: "long-rest" });

    const built = table(sorcerer(5));
    expect(actionOf(built, "font-of-magic").uses).toMatchObject({ limit: 5, pool: "sorcery-points" });
    for (let spent = 0; spent < 5; spent += 1) {
      resolveDefinitionAction(built.state, actionOf(built, "font-of-magic"),
        { actorId: IDS.hero, targetIds: [], commandId: `50000000-0000-4000-8000-00000000006${spent}` }, deps(built, []));
    }
    expect(built.hero.actionUses["sorcery-points"]).toBe(5);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "font-of-magic"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000069" }, deps(built, []))).toThrow();
  });

  it("has no pool at level 1, because the feature is not granted and the column is blank", () => {
    const built = table(buildCharacterDefinition(sorcererInput(1), library, POLICY));
    expect(effectiveActions(built.definition, built.hero, built.catalog).some((entry) => entry.id === "font-of-magic")).toBe(false);
  });
});

describe("Sorcerer: Innate Sorcery is a Bonus Action, a timer and a twice-a-day counter", () => {
  it("grants a 10-round tagged effect and refuses the third use", () => {
    const built = table(sorcerer(5));
    const action = actionOf(built, "innate-sorcery");
    expect(action.activation).toBe("bonus-action");
    expect(action.uses).toMatchObject({ limit: 2, per: "long-rest" });

    resolveDefinitionAction(built.state, action,
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000070" }, deps(built, []));
    // 1 minute is exactly ten rounds, and the tag is what "while your Innate Sorcery is active" reads.
    expect(built.hero.effects).toHaveLength(1);
    // The live effect counts DOWN (`remaining`), which is the engine's own shape for a rounds grant.
    expect(built.hero.effects[0]).toMatchObject({ name: "Innate Sorcery", tags: ["innate-sorcery"], duration: { type: "rounds", remaining: 10 } });

    expect(built.hero.actionUses["innate-sorcery"]).toBe(1);

    // The POOL's own refusal, on a fresh turn so the Bonus Action economy is not what refuses.
    const spent = table(sorcerer(5));
    spent.hero.actionUses = { "innate-sorcery": 2 };
    expect(() => resolveDefinitionAction(spent.state, actionOf(spent, "innate-sorcery"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000072" }, deps(spent, []))).toThrow();
    expect(spent.hero.actionUses["innate-sorcery"]).toBe(2); // the refusal spent nothing
  });

  it("does NOT hand out advantage on a plain weapon swing", () => {
    // The reason the effect carries no `roll-mode`: an effect modifier is normalised through
    // `toRollModes`, which drops its `when`, so `attack-kind-is: ["spell"]` inside an effect would
    // be ignored and this dagger would roll two dice. It rolls one.
    const built = table(sorcerer(5));
    resolveDefinitionAction(built.state, actionOf(built, "innate-sorcery"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000073" }, deps(built, []));
    const swung = resolveDefinitionAction(built.state, actionOf(built, "item-dagger"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000074" }, deps(built, [11, 3]));
    expect(swung.rollMode).toBeUndefined();
    expect(swung.attack!.naturalRoll).toBe(11);
  });
});

describe("Sorcerer: Sorcerous Restoration and Epic Boon (audit row 6, the Sorcerer's)", () => {
  it("gives Sorcerous Restoration one use per Long Rest", () => {
    const built = table(sorcerer(5));
    expect(actionOf(built, "sorcerous-restoration").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(built.state, actionOf(built, "sorcerous-restoration"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000080" }, deps(built, []));
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "sorcerous-restoration"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000081" }, deps(built, []))).toThrow();
  });

  it("offers the Epic Boon at 19, and refuses the build that skips it", () => {
    const boon = (rows: readonly Row[]) => buildCharacterDefinition(
      sorcererInput(19, [...sorcererFor(19), ...rows]), library, POLICY);
    const built = boon([
      { level: 19, classId: "sorcerer", kind: "feat", id: "boon-of-dimensional-travel", payload: { featureId: "epic-boon" } } as Row,
      { level: 19, kind: "ability-score", id: "cha", payload: { featureId: "boon-of-dimensional-travel" } } as Row
    ]);
    expect((built.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-dimensional-travel");
    expect(thrown(() => boon([]))).toMatch(/"Epic Boon" needs 1 pick\(s\) of kind "feat"/);
  });
});

describe("Sorcerer: Metamagic costs a Sorcery Point off the same pool Font of Magic opens", () => {
  it("debits the shared counter, so a Metamagic option and Font of Magic spend one supply", () => {
    // Careful Spell prints "Cost: 1 Sorcery Point", so the chosen OPTION carries a use of the same
    // `sorcery-points` pool - which is the whole difference between Metamagic as a paragraph and
    // Metamagic as a button that spends. Before this the ten options carried no rider at all.
    const built = table(sorcerer(5));
    expect(actionOf(built, "careful-spell").uses).toMatchObject({ limit: 5, per: "long-rest", pool: "sorcery-points" });

    resolveDefinitionAction(built.state, actionOf(built, "careful-spell"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000100" }, deps(built, []));
    expect(built.hero.actionUses["sorcery-points"]).toBe(1);

    // ...and the four points left are Font of Magic's four, not four more: ONE pool, two doors.
    for (let spent = 0; spent < 4; spent += 1) {
      resolveDefinitionAction(built.state, actionOf(built, "font-of-magic"),
        { actorId: IDS.hero, targetIds: [], commandId: `50000000-0000-4000-8000-00000000011${spent}` }, deps(built, []));
    }
    expect(built.hero.actionUses["sorcery-points"]).toBe(5);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "distant-spell"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000119" }, deps(built, []))).toThrow();
  });

  it("gives the two-point options NO counter, because a use is not a cost", () => {
    // `ActionUsesSchema` counts uses and has no notion of one costing two, so Quickened Spell
    // ("Cost: 2 Sorcery Points") stays prose rather than debiting one where the book takes two.
    // Subtle Spell, chosen at the same level and priced at one, does land.
    const built = table(sorcerer(10));
    const ids = effectiveActions(built.definition, built.hero, built.catalog).map((entry) => entry.id);
    expect(ids).toContain("subtle-spell");
    expect(ids).not.toContain("quickened-spell");
    // Both are still on the sheet as prose - the trait carries what the counter cannot.
    expect((built.definition.extensions?.["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map((trait) => trait.name))
      .toContain("Quickened Spell");
  });
});

describe("Draconic Sorcery: the level-3 spells and the affinity (audit rows 26, 23)", () => {
  it("hands over the level-3 Draconic Spells tier, free of the prepared budget", () => {
    const built = sorcerer(5);
    for (const [id, level] of [["alter-self", 2], ["chromatic-orb", 1], ["command", 1], ["dragons-breath", 2]] as const) {
      expect(spellOf(built, id)).toMatchObject({ id, level, alwaysPrepared: true, prepared: true });
    }
    // Command is a Cleric/Bard/Paladin spell - not on the Sorcerer list at all, so the grant is the
    // only route to it. And the level-9 tier is deliberately absent (see the overlay's comment).
    expect(spellOf(built, "summon-dragon")).toBeUndefined();
    // A level-5 Sorcerer prepares 9; the four granted spells ride free on top of that number.
    expect(built.spellcasting!.classes![0]).toMatchObject({ classId: "sorcerer", prepared: 9 });
  });

  it("resists the affinity damage type the player chose, and only that one", () => {
    const fiery = table(sorcerer(6, "fire"));
    expect(fiery.definition.damageResistances).toEqual(["fire"]);
    const burned = applyDamageDetailed(fiery.state, IDS.hero, { amount: 13, parts: [{ amount: 13, type: "fire" }] },
      { role: "gm" }, { resolveDefinition: () => fiery.definition, catalog: fiery.catalog });
    expect(burned.application.totalApplied).toBe(6); // 13 halved, rounded down

    expect(sorcerer(6, "poison").damageResistances).toEqual(["poison"]);
    // Necrotic is not one of the five the SRD prints for this feature.
    expect(thrown(() => sorcerer(6, "necrotic"))).toMatch(/not an offered option/);
    expect(thrown(() => buildCharacterDefinition(sorcererInput(6, sorcererFor(6).filter((row) => row.kind !== "damage-type")), library, POLICY)))
      .toMatch(/"Elemental Affinity" needs 1 pick\(s\) of kind "damage-type"/);
  });

  it("adds the Sorcerer's Charisma to a damage roll of the type it names, and to no other", () => {
    /**
     * The other half of row 23, and the half that needs a rolled number. The builder does not mint
     * spell ACTIONS, so the cantrip is supplied here exactly as Agonizing Blast's proof supplies
     * Eldritch Blast - but the rider comes from the real bundle, off the real chosen option, through
     * the real derivation and the real resolver.
     */
    const bolt = (type: string) => ({
      id: "fire-bolt", name: "Fire Bolt", activation: "action" as const,
      description: "You hurl a mote of fire at a creature or an object within range.",
      attack: { bonus: 6 }, damage: [{ formula: "2d10", type }], spellId: "fire-bolt"
    });
    const cast = (affinity: string, type: string, commandId: string) => {
      const built = table(sorcerer(6, affinity));
      return resolveDefinitionAction(built.state, bolt(type),
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId }, deps(built, [15, 6, 4]));
    };

    // CHA 17 (+3) at level 6 - the two ASI points went to Dexterity. Same two dice in all three.
    const burned = cast("fire", "fire", "50000000-0000-4000-8000-000000000120");
    expect(burned.damage).toEqual([
      { formula: "2d10", type: "fire", total: 10 },
      { formula: "3", type: "fire", total: 3 }
    ]);
    expect(burned.damageTotal).toBe(13);

    // A different damage type from the same Sorcerer: the gate filters, so nothing is added.
    const chilled = cast("fire", "cold", "50000000-0000-4000-8000-000000000121");
    expect(chilled.damage).toEqual([{ formula: "2d10", type: "cold", total: 10 }]);
    // ...and the same fire spell cast by a Sorcerer who chose Poison: also nothing. The rider is the
    // player's answer, not an authored default.
    const unaffiliated = cast("poison", "fire", "50000000-0000-4000-8000-000000000122");
    expect(unaffiliated.damage).toEqual([{ formula: "2d10", type: "fire", total: 10 }]);
  });

  it("does not reach a SAVE-only spell, which is the gate's real edge and not an accident", () => {
    // `action-resolution.ts` fills `damageTypes` on the rider context only for an action with an
    // `attack` block against a single target, so `damage-type-is` has nothing to match on a spell
    // that forces a save instead. Under-application, and pinned here rather than left to be
    // discovered: widen that context and this test is the one that says to re-check the record.
    const built = table(sorcerer(6, "fire"));
    const burningHands = {
      id: "burning-hands", name: "Burning Hands", activation: "action" as const,
      description: "A thin sheet of flames shoots forth from you.",
      damage: [{ formula: "3d6", type: "fire" }], save: { ability: "dex" as const, dc: 14 }, spellId: "burning-hands"
    };
    const swept = resolveDefinitionAction(built.state, burningHands,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000123" }, deps(built, [4, 4, 4]));
    expect(swept.damage).toEqual([{ formula: "3d6", type: "fire", total: 12 }]);
  });

  it("keeps Draconic Resilience's Charisma AC, which is the subclass overlay's original proof", () => {
    // Unarmoured: 10 + Dex 3 (14, +2 from the level-4 ASI) + Cha 3 (17) = 16, and the Sorcerer's
    // starting kit is a spear and a dagger - no armor anywhere near it.
    expect(sorcerer(5).armorClass).toBe(16);
    // The negative control: a level-2 Sorcerer has no subclass, so no Charisma in the AC at all.
    expect(buildCharacterDefinition(sorcererInput(2, sorcererFor(2)), library, POLICY).armorClass).toBe(12);
  });
});

describe("Draconic Sorcery: Dragon Wings and Dragon Companion carry their daily use", () => {
  const level18 = () => table(sorcerer(18));

  it("gives Dragon Wings a Bonus Action and one use per Long Rest", () => {
    const built = level18();
    expect(actionOf(built, "dragon-wings")).toMatchObject({ activation: "bonus-action", uses: { limit: 1, per: "long-rest" } });
    resolveDefinitionAction(built.state, actionOf(built, "dragon-wings"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000090" }, deps(built, []));
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "dragon-wings"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000091" }, deps(built, []))).toThrow();
  });

  it("hands Dragon Companion its Summon Dragon, which no Sorcerer could otherwise prepare", () => {
    const built = level18();
    expect(spellOf(built.definition, "summon-dragon")).toMatchObject({ id: "summon-dragon", level: 5, alwaysPrepared: true });
    expect(actionOf(built, "dragon-companion").uses).toMatchObject({ limit: 1, per: "long-rest" });
    // ...and a level-17 Sorcerer, one level short, has neither.
    expect(spellOf(sorcerer(17), "summon-dragon")).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// WIZARD
// -------------------------------------------------------------------------------------------------

/**
 * A level-20 Human Acolyte Evoker, which is the only level Signature Spells exists at.
 *
 * Wizard is HAND_AUTHORED: six of its features already carry a `choice` and two already carry
 * `uses`, so this harness exists to prove the ONE rider the overlay adds - and to hold the ones
 * already on the record, which nothing tested before now.
 */
const wizardInput = (): CharacterCreateRequestInput => ({
  name: "Ansel", speciesId: "human", backgroundId: "acolyte", classId: "wizard", level: 20,
  subclassId: "evoker", abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "int", amount: 2 }, { ability: "wis", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "wizard", kind: "skill", id: "arcana" },
    { level: 1, classId: "wizard", kind: "skill", id: "investigation" },
    { level: 1, kind: "skill", id: "insight", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
    { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
    { level: 3, kind: "spell", id: "burning-hands", payload: { featureId: "evocation-savant" } },
    { level: 3, kind: "spell", id: "shatter", payload: { featureId: "evocation-savant" } },
    ...[4, 8, 12, 16].flatMap((level) => ([
      { level, classId: "wizard", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level, kind: "ability-score", id: "int", payload: { featureId: "ability-score-improvement" } },
      { level, kind: "ability-score", id: "int", payload: { featureId: "ability-score-improvement" } }
    ])),
    { level: 18, kind: "spell", id: "magic-missile", payload: { featureId: "spell-mastery" } },
    { level: 18, kind: "spell", id: "acid-arrow", payload: { featureId: "spell-mastery" } },
    { level: 19, classId: "wizard", kind: "feat", id: "boon-of-dimensional-travel", payload: { featureId: "epic-boon" } },
    { level: 19, kind: "ability-score", id: "int", payload: { featureId: "boon-of-dimensional-travel" } },
    { level: 20, kind: "spell", id: "fireball", payload: { featureId: "signature-spells" } },
    { level: 20, kind: "spell", id: "counterspell", payload: { featureId: "signature-spells" } },
    { level: 1, kind: "equipment", id: "wizard-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ] as CharacterCreateRequestInput["choices"]
});

describe("Wizard: Signature Spells becomes two free castings that a Short Rest gives back", () => {
  it("spends both, refuses the third, and re-arms on a Short Rest", () => {
    const built = table(buildCharacterDefinition(wizardInput(), library, POLICY));
    // "you can cast each of them once at level 3 without expending a spell slot ... until you finish
    // a Short or Long Rest" - two uses, recovered on a Short Rest. Before this the level-20 capstone
    // was prose with no counter anywhere on the sheet.
    expect(actionOf(built, "signature-spells").uses).toMatchObject({ limit: 2, per: "short-rest" });

    for (const commandId of ["50000000-0000-4000-8000-000000000130", "50000000-0000-4000-8000-000000000131"]) {
      resolveDefinitionAction(built.state, actionOf(built, "signature-spells"),
        { actorId: IDS.hero, targetIds: [], commandId }, deps(built, []));
    }
    expect(built.hero.actionUses["signature-spells"]).toBe(2);
    expect(() => resolveDefinitionAction(built.state, actionOf(built, "signature-spells"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000132" }, deps(built, []))).toThrow();
    expect(built.hero.actionUses["signature-spells"]).toBe(2); // the refusal spent nothing

    // The half `per: "short-rest"` is actually for: a SHORT rest gives them back. Overchannel, on the
    // same sheet and once per LONG rest, is the control - it must not be handed back here.
    built.hero.actionUses = { ...built.hero.actionUses, overchannel: 1 };
    endEncounter(built.state);
    applyRest(built.state, IDS.hero, "short", () => built.definition, built.catalog);
    expect(built.hero.actionUses["signature-spells"]).toBeUndefined();
    expect(built.hero.actionUses["overchannel"]).toBe(1);
  });

  it("holds the counters and picks the hand-authored record already carried", () => {
    // Not authored by this lane, and untested until now: Arcane Recovery and Overchannel are the two
    // pools `class-resource-pools.test.ts` pins the Wizard to, and Spell Mastery's two spells and the
    // Epic Boon are picks the level-20 build owes. A sheet that quietly lost one would pass every
    // other test in this file.
    const built = table(buildCharacterDefinition(wizardInput(), library, POLICY));
    expect(actionOf(built, "arcane-recovery").uses).toMatchObject({ limit: 1, per: "long-rest" });
    expect(actionOf(built, "overchannel").uses).toMatchObject({ limit: 1, per: "long-rest" });
    expect((built.definition.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-dimensional-travel");
    for (const id of ["magic-missile", "acid-arrow", "fireball", "counterspell", "burning-hands", "shatter"]) {
      expect(spellOf(built.definition, id)).toMatchObject({ id });
    }
    // INT 15 + the Acolyte's 2 = 17, then four ASIs at +2 each, clamped at 20 - and then the epic
    // boon's own +1 on top, which is the whole point of a boon and used to be silently lost.
    //
    // Boon of Dimensional Travel prints "Increase one ability score of your choice by 1, TO A
    // MAXIMUM OF 30", and `featureChoiceBase.maximum` exists in the schema for precisely that
    // sentence. All seven boons printed the 30 and none set `maximum`, so the offer consumer clamped
    // at 20 and the boon did nothing for a character already there - which, at level 19+, is nearly
    // every character who has one. Three lanes reported it independently; the seven feats now carry
    // `maximum: 30` and this expectation moved from 20 to 21 exactly as this comment predicted.
    expect(built.definition.abilityScores.int).toBe(21);
  });

  it("refuses the build that leaves Signature Spells unchosen", () => {
    const without = () => buildCharacterDefinition(
      { ...wizardInput(), choices: wizardInput().choices.filter((row) => row.payload?.featureId !== "signature-spells") },
      library, POLICY);
    expect(thrown(without)).toMatch(/"Signature Spells" needs 2 pick\(s\) of kind "spell"/);
  });
});
