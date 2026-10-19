import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { featurePicks } from "@vtt/content-srd-5.2.1";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { specialSpeedsOf } from "../src/speed.js";
import { effectiveActions } from "../src/effective-actions.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { endEncounter, startEncounter } from "../src/encounter.js";
import { applyRest } from "../src/rests.js";
import { builderOffers } from "../src/builder-offers.js";
import { asiRows } from "./asi-rows.js";

// Warlock, Sorcerer and Wizard mechanics, asserted as rolled numbers, spent counters, refusals or
// rendered text; never "the rider survived derivation". Runs the real builder against the real SRD
// bundles and reads the sheet, the pool, or the table.

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

// Harness

// A Human Acolyte Warlock of the Fiend at the level the test needs. `extra` carries only the rows that
// level demands (invocations, ASIs, the arcanum). CHA 15 + the Acolyte's +2 = 17 (+3) before any ASI.
const warlockInput = (level: number, extra: readonly Row[] = []): CharacterCreateRequestInput => ({
  name: "Vex",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "warlock",
  level,
  subclassId: "fiend-patron",
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  backgroundBonusAllocation: [
    { ability: "cha", amount: 2 },
    { ability: "wis", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
    { level: 1, classId: "warlock", kind: "skill", id: "deception" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
    { level: 3, classId: "warlock", kind: "subclass", id: "fiend-patron" },
    { level: 1, kind: "equipment", id: "warlock-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" },
    ...extra
  ] as CharacterCreateRequestInput["choices"]
});

/** One invocation ledger row, stamped at the level the printed Invocations column pays for it. */
const invocation = (level: number, id: string): Row =>
  ({
    level,
    classId: "warlock",
    kind: "eldritch-invocation",
    id,
    payload: { featureId: "eldritch-invocations" }
  }) as Row;

/** The invocations a Warlock of this level is owed by the printed column, as plain a set as possible. */
const FILLER: ReadonlyArray<readonly [level: number, id: string]> = [
  [1, "armor-of-shadows"],
  [2, "mask-of-many-faces"],
  [2, "misty-visions"],
  [5, "master-of-myriad-forms"],
  [5, "one-with-shadows"],
  [7, "whispers-of-the-grave"],
  [9, "visions-of-distant-realms"],
  [12, "ascendant-step"],
  [15, "otherworldly-leap"],
  [18, "fiendish-vigor"]
];
// The printed Invocations column: 1 at L1, 3 at L2, 5 at L5, 6 at L7, 7 at L9, 8 at L12, 9 at L15,
// 10 at L18. Every build below is exactly full, since under- and over-filled offers both reject.
const invocationsAt = (level: number) =>
  [
    [18, 10],
    [15, 9],
    [12, 8],
    [9, 7],
    [7, 6],
    [5, 5],
    [2, 3],
    [1, 1]
  ].find(([at]) => level >= at)![1];
const fillerFor = (level: number): Row[] =>
  FILLER.slice(0, invocationsAt(level)).map(([grantedAt, id]) => invocation(grantedAt, id));
/** Every ASI a Warlock of this level has been granted (levels 4, 8, 12, 16), into CHA (17 before the first) or
 *  DEX (14) until it reaches 20, then into CON. */
const asisFor = (level: number, ability: "cha" | "dex" = "cha"): Row[] =>
  asiRows(
    "warlock",
    [4, 8, 12, 16].filter((at) => at <= level),
    [ability, "con"],
    { cha: 17, dex: 14, con: 13 }
  ) as Row[];

type Built = Readonly<{
  definition: ActorDefinition;
  catalog: ReturnType<typeof equipmentCatalogOf>;
  state: GameState;
  hero: Actor;
}>;

function table(definition: ActorDefinition): Built {
  const catalog = equipmentCatalogOf(library);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 200, maximum: 200 },
        armorClass: 12
      }
    ]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  const built = { definition, catalog, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
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
  return built;
}

function deps(built: Built, faces: number[]): ResolveDependencies {
  let index = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-07-28T00:00:00.000Z",
    definition: built.definition,
    catalog: built.catalog
  };
}

const actionOf = (built: Built, id: string) =>
  effectiveActions(built.definition, built.hero, built.catalog).find((entry) => entry.id === id)!;
const spellOf = (definition: ActorDefinition, id: string) =>
  (definition.spellcasting?.spells ?? []).find((spell) => spell.id === id);
const thrown = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a rejection, got none");
};

// Warlock: class features

describe("Warlock: Mystic Arcanum is a real pick and a real once-per-day casting (audit rows 15-18)", () => {
  const arcanum = (level: number, featureId: string, spellId: string): Row =>
    ({ level, kind: "spell", id: spellId, payload: { featureId } }) as Row;

  const level11 = () =>
    buildCharacterDefinition(
      warlockInput(11, [
        ...fillerFor(11),
        ...asisFor(11),
        {
          level: 10,
          classId: "warlock",
          kind: "damage-type",
          id: "fire",
          payload: { featureId: "fiendish-resilience" }
        } as Row,
        arcanum(11, "mystic-arcanum-level-6-spell", "true-seeing")
      ]),
      library,
      POLICY
    );

  it("puts the chosen level-6 Warlock spell on the sheet, above every slot the class has", () => {
    // Pact Magic tops out at level 5, so the class budget refuses a level-6 spell; as a feature pick it
    // lands on a sheet whose highest slot is level 5.
    const built = level11();
    expect(built.spellcasting!.pact?.level).toBe(5);
    expect(spellOf(built, "true-seeing")).toMatchObject({ id: "true-seeing", level: 6, prepared: true });
  });

  it("spends its own once-per-Long-Rest use and refuses the second", () => {
    const built = table(level11());
    // The daily use rides the arcanum spell's own free casting, which spends the feature's pool.
    expect(actionOf(built, "spell-true-seeing-free").uses).toMatchObject({
      limit: 1,
      per: "long-rest",
      pool: "mystic-arcanum-level-6-spell"
    });
    // True Seeing touches one willing creature, here the Warlock itself.
    resolveDefinitionAction(
      built.state,
      actionOf(built, "spell-true-seeing-free"),
      { actorId: IDS.hero, targetIds: [IDS.hero], commandId: "50000000-0000-4000-8000-000000000001" },
      deps(built, [])
    );
    expect(built.hero.actionUses["mystic-arcanum-level-6-spell"]).toBe(1);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "spell-true-seeing-free"),
        { actorId: IDS.hero, targetIds: [IDS.hero], commandId: "50000000-0000-4000-8000-000000000002" },
        deps(built, [])
      )
    ).toThrow();
    expect(built.hero.actionUses["mystic-arcanum-level-6-spell"]).toBe(1); // the refusal spent nothing
  });

  it("refuses a spell ABOVE the arcanum's level, naming the ceiling", () => {
    // `maxSpellLevel` does real work: the level-6 arcanum will not take a level-7 spell.
    const message = thrown(() =>
      buildCharacterDefinition(
        warlockInput(11, [
          ...fillerFor(11),
          ...asisFor(11),
          {
            level: 10,
            classId: "warlock",
            kind: "damage-type",
            id: "fire",
            payload: { featureId: "fiendish-resilience" }
          } as Row,
          arcanum(11, "mystic-arcanum-level-6-spell", "forcecage")
        ]),
        library,
        POLICY
      )
    );
    expect(message).toMatch(/above the maximum spell level \(6\)/);
  });

  it("refuses the build that leaves the arcanum unchosen", () => {
    // The arcanum pick is owed, and a build without it is refused by name.
    const message = thrown(() =>
      buildCharacterDefinition(
        warlockInput(11, [
          ...fillerFor(11),
          ...asisFor(11),
          {
            level: 10,
            classId: "warlock",
            kind: "damage-type",
            id: "fire",
            payload: { featureId: "fiendish-resilience" }
          } as Row
        ]),
        library,
        POLICY
      )
    );
    expect(message).toMatch(/"Mystic Arcanum \(level 6 spell\)" needs 1 pick\(s\) of kind "spell"/);
  });

  it("offers all FOUR arcana by level 17, each with its own level and its own daily use", () => {
    const built = table(
      buildCharacterDefinition(
        warlockInput(17, [
          ...fillerFor(17),
          ...asisFor(17),
          {
            level: 10,
            classId: "warlock",
            kind: "damage-type",
            id: "fire",
            payload: { featureId: "fiendish-resilience" }
          } as Row,
          arcanum(11, "mystic-arcanum-level-6-spell", "true-seeing"),
          arcanum(13, "mystic-arcanum-level-7-spell", "forcecage"),
          arcanum(15, "mystic-arcanum-level-8-spell", "demiplane"),
          arcanum(17, "mystic-arcanum-level-9-spell", "foresight")
        ]),
        library,
        POLICY
      )
    );
    expect(
      [6, 7, 8, 9].map(
        (level) => spellOf(built.definition, ["true-seeing", "forcecage", "demiplane", "foresight"][level - 6])!.level
      )
    ).toEqual([6, 7, 8, 9]);
    // Four separate pools: the SRD regains "all uses" on a Long Rest.
    const arcana = ["true-seeing", "forcecage", "demiplane", "foresight"];
    for (const level of [6, 7, 8, 9]) {
      expect(actionOf(built, `spell-${arcana[level - 6]}-free`).uses).toMatchObject({
        limit: 1,
        per: "long-rest",
        pool: `mystic-arcanum-level-${level}-spell`
      });
    }
  });
});

describe("Warlock: Contact Patron hands over the spell and the free casting (audit row 33)", () => {
  // Level 9: seven invocations and two ASIs, and Fiendish Resilience has not been granted yet.
  const level9 = () => buildCharacterDefinition(warlockInput(9, [...fillerFor(9), ...asisFor(9)]), library, POLICY);

  it("always has Contact Other Plane prepared without charging the prepared budget", () => {
    const built = level9();
    // A level-9 Warlock prepares 10 spells. The grant is `alwaysPrepared`, so it does not count against
    // that, which is why `grants.spells` exists and is no extra pick.
    expect(spellOf(built, "contact-other-plane")).toMatchObject({ level: 5, alwaysPrepared: true, prepared: true });
    expect(built.spellcasting!.classes![0]).toMatchObject({ classId: "warlock", prepared: 10 });
  });

  it("gives it a once-per-Long-Rest counter the engine really spends", () => {
    const built = table(level9());
    expect(actionOf(built, "spell-contact-other-plane-free").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(
      built.state,
      actionOf(built, "spell-contact-other-plane-free"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000010" },
      deps(built, [])
    );
    expect(built.hero.actionUses["contact-patron"]).toBe(1);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "spell-contact-other-plane-free"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000011" },
        deps(built, [])
      )
    ).toThrow();
  });
});

describe("Warlock: Magical Cunning is a trackable pool rather than a paragraph", () => {
  it("spends once per Long Rest and refuses the second rite", () => {
    const built = table(buildCharacterDefinition(warlockInput(5, fillerFor(5).concat(asisFor(5))), library, POLICY));
    expect(actionOf(built, "magical-cunning").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(
      built.state,
      actionOf(built, "magical-cunning"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000020" },
      deps(built, [])
    );
    expect(built.hero.actionUses["magical-cunning"]).toBe(1);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "magical-cunning"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000021" },
        deps(built, [])
      )
    ).toThrow();
  });
});

describe("Warlock: Epic Boon is offered at last (audit row 6, the Warlock's)", () => {
  const level19 = (featId: string | null) =>
    warlockInput(19, [
      ...fillerFor(19),
      ...asisFor(19),
      {
        level: 10,
        classId: "warlock",
        kind: "damage-type",
        id: "fire",
        payload: { featureId: "fiendish-resilience" }
      } as Row,
      { level: 11, kind: "spell", id: "true-seeing", payload: { featureId: "mystic-arcanum-level-6-spell" } } as Row,
      { level: 13, kind: "spell", id: "forcecage", payload: { featureId: "mystic-arcanum-level-7-spell" } } as Row,
      { level: 15, kind: "spell", id: "demiplane", payload: { featureId: "mystic-arcanum-level-8-spell" } } as Row,
      { level: 17, kind: "spell", id: "foresight", payload: { featureId: "mystic-arcanum-level-9-spell" } } as Row,
      ...(featId === null
        ? []
        : [
            { level: 19, classId: "warlock", kind: "feat", id: featId, payload: { featureId: "epic-boon" } } as Row,
            // The boon's own pick: "increase one ability score by 1, to a maximum of 30". A chosen feat's
            // feature asks for picks of its own, which is why feats are settled in an earlier pass.
            { level: 19, kind: "ability-score", id: "cha", payload: { featureId: featId } } as Row
          ])
    ]);

  it("accepts an epic-boon feat and puts it on the sheet", () => {
    const built = buildCharacterDefinition(level19("boon-of-fate"), library, POLICY);
    expect((built.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-fate");
  });

  it("refuses the build with no boon chosen, where before there was nothing to choose", () => {
    expect(thrown(() => buildCharacterDefinition(level19(null), library, POLICY))).toMatch(
      /"Epic Boon" needs 1 pick\(s\) of kind "feat"/
    );
  });

  it("refuses a feat that is not an epic boon", () => {
    expect(thrown(() => buildCharacterDefinition(level19("grappler"), library, POLICY))).toMatch(
      /not an offered option/
    );
  });
});

// Warlock: Fiend Patron

describe("Fiend Patron: the Fiend Spells arrive prepared and free, tier by tier (audit row 27)", () => {
  it("hands over the level-3 four and the level-5 pair without charging one prepared slot", () => {
    const built = buildCharacterDefinition(warlockInput(5, fillerFor(5).concat(asisFor(5))), library, POLICY);
    for (const id of ["burning-hands", "command", "scorching-ray", "suggestion", "fireball", "stinking-cloud"]) {
      expect(spellOf(built, id)).toMatchObject({ id, alwaysPrepared: true, prepared: true });
    }
    // The level-7 row waits for Warlock 7, so a Warlock 5 has no Fire Shield.
    expect(spellOf(built, "fire-shield")).toBeUndefined();
  });
});

describe("Fiend Patron: Dark One's Own Luck counts off the CHARACTER's Charisma", () => {
  it("gives a CHA 17 Warlock three uses and a CHA 20 Warlock five", () => {
    // The same authored record on two sheets gives two numbers, which is what `ability-modifier` scaling
    // is for. Level 6 with the ASI spent on Dexterity: Charisma stays at 17 (+3).
    const cha17 = table(
      buildCharacterDefinition(warlockInput(6, fillerFor(6).concat(asisFor(6, "dex"))), library, POLICY)
    );
    expect(cha17.definition.abilityScores.cha).toBe(17);
    expect(actionOf(cha17, "dark-ones-own-luck").uses).toMatchObject({ limit: 3, per: "long-rest" });

    const cha20 = table(
      buildCharacterDefinition(
        warlockInput(11, [
          ...fillerFor(11),
          ...asisFor(11),
          {
            level: 10,
            classId: "warlock",
            kind: "damage-type",
            id: "fire",
            payload: { featureId: "fiendish-resilience" }
          } as Row,
          { level: 11, kind: "spell", id: "true-seeing", payload: { featureId: "mystic-arcanum-level-6-spell" } } as Row
        ]),
        library,
        POLICY
      )
    );
    expect(cha20.definition.abilityScores.cha).toBe(20);
    expect(actionOf(cha20, "dark-ones-own-luck").uses).toMatchObject({ limit: 5, per: "long-rest" });
  });
});

describe("Fiend Patron: Fiendish Resilience halves the damage it names (audit row 66, base pick)", () => {
  const resilient = (damageType: string) =>
    buildCharacterDefinition(
      warlockInput(10, [
        ...fillerFor(11),
        ...asisFor(10),
        {
          level: 10,
          classId: "warlock",
          kind: "damage-type",
          id: damageType,
          payload: { featureId: "fiendish-resilience" }
        } as Row
      ]),
      library,
      POLICY
    );

  it("takes half of the chosen type and all of another: at the table, not on the record", () => {
    const built = table(resilient("fire"));
    expect(built.definition.damageResistances).toEqual(["fire"]);
    const burned = applyDamageDetailed(
      built.state,
      IDS.hero,
      { amount: 17, parts: [{ amount: 17, type: "fire" }] },
      { role: "gm" },
      { resolveDefinition: () => built.definition, catalog: built.catalog }
    );
    expect(burned.application.totalApplied).toBe(8); // 17 halved, rounded down

    const frozen = applyDamageDetailed(
      built.state,
      IDS.hero,
      { amount: 17, parts: [{ amount: 17, type: "cold" }] },
      { role: "gm" },
      { resolveDefinition: () => built.definition, catalog: built.catalog }
    );
    expect(frozen.application.totalApplied).toBe(17); // a type the pick did not name: untouched
  });

  it("resists whichever type the player actually chose, not an authored default", () => {
    const built = resilient("necrotic");
    expect(built.damageResistances).toEqual(["necrotic"]);
  });

  it("refuses Force, which the SRD excludes, and refuses leaving the pick unmade", () => {
    expect(thrown(() => resilient("force"))).toMatch(/not an offered option/);
    expect(
      thrown(() => buildCharacterDefinition(warlockInput(10, [...fillerFor(11), ...asisFor(10)]), library, POLICY))
    ).toMatch(/"Fiendish Resilience" needs 1 pick\(s\) of kind "damage-type"/);
  });
});

describe("Fiend Patron: Hurl Through Hell rolls its 8d10 and holds the target to the real DC", () => {
  const level14 = () =>
    table(
      buildCharacterDefinition(
        warlockInput(14, [
          ...fillerFor(14),
          ...asisFor(14),
          {
            level: 10,
            classId: "warlock",
            kind: "damage-type",
            id: "fire",
            payload: { featureId: "fiendish-resilience" }
          } as Row,
          {
            level: 11,
            kind: "spell",
            id: "true-seeing",
            payload: { featureId: "mystic-arcanum-level-6-spell" }
          } as Row,
          { level: 13, kind: "spell", id: "forcecage", payload: { featureId: "mystic-arcanum-level-7-spell" } } as Row
        ]),
        library,
        POLICY
      )
    );

  it("proposes 8d10 Psychic against a Charisma save at the Warlock's own spell save DC", () => {
    const built = level14();
    // CHA 20 (+5) and proficiency +5 at level 14: DC 8 + 5 + 5 = 18, derived.
    const action = actionOf(built, "hurl-through-hell");
    expect(action.save).toEqual({
      ability: "cha",
      dc: 18,
      spellcasting: true,
      successDamage: "none",
      failureConditions: ["incapacitated"],
      // "until the end of your next turn": the Warlock's.
      failureDuration: { type: "until-source-turn-end" }
    });
    expect(built.definition.spellcasting!.saveDc).toBe(18);

    const hurled = resolveDefinitionAction(
      built.state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000030" },
      deps(built, [10, 10, 10, 10, 10, 10, 10, 10])
    );
    expect(hurled.damage).toEqual([{ formula: "8d10", type: "psychic", total: 80 }]);
    expect(
      built.state.combat.pendingSaves.map((save) => ({
        ability: save.ability,
        dc: save.dc,
        damage: save.proposedDamage
      }))
    ).toEqual([{ ability: "cha", dc: 18, damage: 80 }]);
  });

  it("is once per Long Rest and refuses the second hurl", () => {
    const built = level14();
    expect(actionOf(built, "hurl-through-hell").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(
      built.state,
      actionOf(built, "hurl-through-hell"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000031" },
      deps(built, [1, 1, 1, 1, 1, 1, 1, 1])
    );
    expect(built.hero.actionUses["hurl-through-hell"]).toBe(1);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "hurl-through-hell"),
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000032" },
        deps(built, [])
      )
    ).toThrow();
  });
});

// Warlock: Eldritch Invocations

/** A level-5 Warlock holding four filler invocations plus the one under test, exactly on the printed budget of five. */
const withInvocation = (id: string, extra: readonly Row[] = []) =>
  buildCharacterDefinition(
    warlockInput(5, [
      invocation(1, "armor-of-shadows"),
      invocation(2, "mask-of-many-faces"),
      invocation(2, "misty-visions"),
      invocation(5, "master-of-myriad-forms"),
      invocation(5, id),
      // The level-4 ASI goes into Dexterity so Charisma stays at 17 (+3), which Agonizing Blast's damage is
      // checked against below.
      ...asisFor(5, "dex"),
      ...extra
    ]),
    library,
    POLICY
  );
/** The same Warlock with a fifth filler instead: the negative control for every assertion below. */
const withoutInvocation = () => withInvocation("one-with-shadows");

describe("Warlock invocations: the eleven free castings are handed over (audit rows 37-47)", () => {
  it("puts each granted spell on the sheet as always-prepared, and free of the prepared budget", () => {
    // Four of the spell-granting invocations; none of these spells is on the Warlock list, so
    // `grants.spells` is the only route.
    const built = withInvocation("otherworldly-leap");
    for (const [id, level] of [
      ["mage-armor", 1],
      ["disguise-self", 1],
      ["silent-image", 1],
      ["alter-self", 2],
      ["jump", 1]
    ] as const) {
      expect(spellOf(built, id)).toMatchObject({ id, level, alwaysPrepared: true, prepared: true });
    }
    // A level-5 Warlock prepares 6 spells. The granted castings are uncharged on top, and so is the
    // background's Magic Initiate spell, which the feat keeps always prepared.
    expect(built.spellcasting!.classes![0]).toMatchObject({ classId: "warlock", prepared: 6 });
    expect(
      (built.spellcasting!.spells ?? []).filter((spell) => spell.alwaysPrepared === false).map((spell) => spell.id)
    ).toEqual([]);
    expect(spellOf(built, "bless")).toMatchObject({ alwaysPrepared: true, freeActionId: "spell-bless-free" });
  });

  it("hands over NOTHING when the invocation was not taken", () => {
    // The negative control: the same class, the same level, one different invocation id.
    expect(spellOf(withoutInvocation(), "jump")).toBeUndefined();
    expect(spellOf(withoutInvocation(), "invisibility")).toMatchObject({ id: "invisibility", alwaysPrepared: true });
  });

  it("gives Gift of the Depths the once-per-Long-Rest counter the SRD prints, and spends it", () => {
    // The one spell-granting invocation the text limits; the others are at will and carry no pool.
    const built = table(withInvocation("gift-of-the-depths"));
    expect(spellOf(built.definition, "water-breathing")).toMatchObject({ level: 3, alwaysPrepared: true });
    expect(actionOf(built, "spell-water-breathing-free").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(
      built.state,
      actionOf(built, "spell-water-breathing-free"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000040" },
      deps(built, [])
    );
    expect(built.hero.actionUses["gift-of-the-depths"]).toBe(1);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "spell-water-breathing-free"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000041" },
        deps(built, [])
      )
    ).toThrow();

    // ...and an at-will one mints no pool.
    const atWill = table(withInvocation("otherworldly-leap"));
    expect(
      effectiveActions(atWill.definition, atWill.hero, atWill.catalog).some((entry) => entry.id === "otherworldly-leap")
    ).toBe(false);
  });
});

describe("Warlock invocations: Agonizing Blast adds the caster's Charisma to the blast (audit row 51)", () => {
  // The Eldritch Blast cantrip is a real ledger row, so the builder mints the spell action the sheet's
  // Cast button sends and `spell-id-is` matches; Agonizing Blast's own pick ("choose one of your known
  // Warlock cantrips that deals damage") then has an eligible option.
  const KNOWS_ELDRITCH_BLAST: Row[] = [{ level: 1, classId: "warlock", kind: "cantrip", id: "eldritch-blast" } as Row];
  const pointedAtTheBlast: Row[] = [
    { level: 5, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "agonizing-blast" } } as Row
  ];

  const blast = (id: string, faces: number[]) => {
    const built = table(
      withInvocation(id, [...KNOWS_ELDRITCH_BLAST, ...(id === "agonizing-blast" ? pointedAtTheBlast : [])])
    );
    // `actionOf` reads the effective list, so this is the same object the sheet's Cast button sends an id for.
    return resolveDefinitionAction(
      built.state,
      actionOf(built, "spell-eldritch-blast"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000050" },
      deps(built, faces)
    );
  };

  it("mints the cantrip as an action of its own, linked from the spell and carrying its id", () => {
    const built = withInvocation("agonizing-blast", [...KNOWS_ELDRITCH_BLAST, ...pointedAtTheBlast]);
    // The link the sheet resolves a Cast tap through (`structuredActionFor`), and the id `spell-id-is` matches.
    expect(spellOf(built, "eldritch-blast")).toMatchObject({
      id: "eldritch-blast",
      level: 0,
      actionId: "spell-eldritch-blast"
    });
    // CHA 17 (+3) + PB 3 = +6, derived by the builder from this character's own scores. At level 5 the
    // printed row fires two beams, each its own attack.
    expect(built.actions.find((action) => action.id === "spell-eldritch-blast")).toMatchObject({
      name: "Eldritch Blast",
      activation: "action",
      spellId: "eldritch-blast",
      attack: { bonus: 6, count: 2 },
      damage: [{ formula: "1d10", type: "force" }]
    });
    // A leveled spell mints its slot cast: the economy spends a slot of its level or higher (a Warlock 5's only
    // slots are level 3, so it takes one of those).
    expect(built.actions.find((action) => action.id === "spell-bless")).toMatchObject({
      spellId: "bless",
      spellSlot: { level: 1 }
    });
    expect(built.spellcasting!.spells.find((spell) => spell.id === "bless")!.actionId).toBe("spell-bless");
  });

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
    // `spell-id-is` filters: the Warlock's starting sickle is not Eldritch Blast and gains nothing.
    const built = table(withInvocation("agonizing-blast", [...KNOWS_ELDRITCH_BLAST, ...pointedAtTheBlast]));
    const swung = resolveDefinitionAction(
      built.state,
      actionOf(built, "item-sickle"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000051" },
      deps(built, [15, 4])
    );
    expect(swung.damage.some((part) => part.type === "force")).toBe(false);
    expect(swung.damage).toEqual([{ formula: "1d4 - 1", type: "slashing", total: 3 }]); // Str 8, and no Charisma
  });
});

describe("Warlock invocations: the ones that ask a question of their own (audit rows 24, 25, 50)", () => {
  // Lessons of the First Ones is not authored. Its nested `{kind: "feat"}` pick cannot be answered:
  // feat rows are settled before chosen options create their offers, so the row finds no offer, and
  // omitting it fails the completeness check. If that ordering changes, this fails and the row should be authored.
  it("still takes Lessons of the First Ones as a bare option, because a nested FEAT pick cannot be answered yet", () => {
    // Takeable, and it grants only its prose.
    expect(() => withInvocation("lessons-of-the-first-ones")).not.toThrow();
    // ...and a feat row aimed at it finds no offer.
    expect(
      thrown(() =>
        withInvocation("lessons-of-the-first-ones", [
          {
            level: 5,
            classId: "warlock",
            kind: "feat",
            id: "tough",
            payload: { featureId: "lessons-of-the-first-ones" }
          } as Row
        ])
      )
    ).toMatch(/No feature "lessons-of-the-first-ones" offers a "feat" choice/);
  });

  it("Pact of the Blade asks which weapon, and records the answer", () => {
    const built = withInvocation("pact-of-the-blade", [
      {
        level: 5,
        classId: "warlock",
        kind: "weapon",
        id: "greatsword",
        payload: { featureId: "pact-of-the-blade" }
      } as Row
    ]);
    expect((built.character?.choices ?? []).some((row) => row.kind === "weapon" && row.id === "greatsword")).toBe(true);
    expect(thrown(() => withInvocation("pact-of-the-blade"))).toMatch(
      /"Pact of the Blade" needs 1 pick\(s\) of kind "weapon"/
    );
  });

  it("Pact of the Tome asks for THREE cantrips and puts all three on the sheet", () => {
    const tome = (ids: readonly string[]) =>
      withInvocation(
        "pact-of-the-tome",
        ids.map((id) => ({ level: 5, kind: "cantrip", id, payload: { featureId: "pact-of-the-tome" } }) as Row)
      );
    const built = tome(["chill-touch", "minor-illusion", "true-strike"]);
    for (const id of ["chill-touch", "minor-illusion", "true-strike"]) {
      expect(spellOf(built, id)).toMatchObject({ id, level: 0, prepared: true });
    }
    // A level-5 Warlock's own cantrip budget is 3 and untouched: the book's three are extra.
    expect((built.spellcasting!.spells ?? []).filter((spell) => spell.level === 0)).toHaveLength(5); // 3 book + 2 Magic Initiate
    expect(thrown(() => tome(["chill-touch", "minor-illusion"]))).toMatch(
      /"Pact of the Tome" needs 3 pick\(s\) of kind "cantrip"/
    );
    expect(thrown(() => tome(["chill-touch", "minor-illusion", "true-strike", "mage-hand"]))).toMatch(
      /exceeds what this build may choose/
    );
  });

  it("Pact of the Chain hands over Find Familiar, free (audit row 36)", () => {
    expect(spellOf(withInvocation("pact-of-the-chain"), "find-familiar")).toMatchObject({
      id: "find-familiar",
      level: 1,
      alwaysPrepared: true,
      prepared: true
    });
    expect(spellOf(withoutInvocation(), "find-familiar")).toBeUndefined();
  });
});

// Sorcerer

/** A Human Acolyte Draconic Sorcerer. CHA 15 + the Acolyte's +2 = 17 (+3) before any ASI. */
const sorcererInput = (level: number, extra: readonly Row[] = []): CharacterCreateRequestInput => ({
  name: "Ilde",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "sorcerer",
  level,
  // The subclass arrives at level 3; below that the builder refuses one, so the Font of Magic cases at
  // levels 1 and 2 run without it.
  ...(level >= 3 ? { subclassId: "draconic-sorcery" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  backgroundBonusAllocation: [
    { ability: "cha", amount: 2 },
    { ability: "wis", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "sorcerer", kind: "skill", id: "arcana" },
    { level: 1, classId: "sorcerer", kind: "skill", id: "deception" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
    ...(level >= 3 ? [{ level: 3, classId: "sorcerer", kind: "subclass", id: "draconic-sorcery" }] : []),
    { level: 1, kind: "equipment", id: "sorcerer-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" },
    ...extra
  ] as CharacterCreateRequestInput["choices"]
});

/** Metamagic: two at level 2, two more at 10, two more at 17: the SRD's six. */
const metamagic = (level: number, ids: readonly string[]): Row[] =>
  ids.map((id) => ({ level, classId: "sorcerer", kind: "metamagic", id, payload: { featureId: "metamagic" } }) as Row);
/** Everything a Sorcerer of this level owes beyond the base rows: metamagic, ASIs, the affinity. */
const sorcererFor = (level: number, affinity = "fire"): Row[] => [
  ...(level >= 2 ? metamagic(2, ["careful-spell", "distant-spell"]) : []),
  ...(level >= 10 ? metamagic(10, ["quickened-spell", "subtle-spell"]) : []),
  ...(level >= 17 ? metamagic(17, ["twinned-spell", "empowered-spell"]) : []),
  // DEX 14 before the first, then CON 13.
  ...(asiRows(
    "sorcerer",
    [4, 8, 12, 16].filter((at) => at <= level),
    ["dex", "con"],
    { dex: 14, con: 13 }
  ) as Row[]),
  ...(level >= 6
    ? [
        {
          level: 6,
          classId: "sorcerer",
          kind: "damage-type",
          id: affinity,
          payload: { featureId: "elemental-affinity" }
        } as Row
      ]
    : [])
];
const sorcerer = (level: number, affinity = "fire") =>
  buildCharacterDefinition(sorcererInput(level, sorcererFor(level, affinity)), library, POLICY);

describe("Sorcerer: Font of Magic turns the printed Sorcery Points column into a real pool", () => {
  it("reads the column at the character's own level, and spends down to the refusal", () => {
    // The printed column: 2 at level 2, 5 at level 5, read by `class-resource` from the column itself.
    expect(actionOf(table(sorcerer(2)), "font-of-magic").uses).toMatchObject({
      limit: 2,
      pool: "sorcery-points",
      per: "long-rest"
    });

    const built = table(sorcerer(5));
    expect(actionOf(built, "font-of-magic").uses).toMatchObject({ limit: 5, pool: "sorcery-points" });
    for (let spent = 0; spent < 5; spent += 1) {
      resolveDefinitionAction(
        built.state,
        actionOf(built, "font-of-magic"),
        { actorId: IDS.hero, targetIds: [], commandId: `50000000-0000-4000-8000-00000000006${spent}` },
        deps(built, [])
      );
    }
    expect(built.hero.actionUses["sorcery-points"]).toBe(5);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "font-of-magic"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000069" },
        deps(built, [])
      )
    ).toThrow();
  });

  it("has no pool at level 1, because the feature is not granted and the column is blank", () => {
    const built = table(buildCharacterDefinition(sorcererInput(1), library, POLICY));
    expect(
      effectiveActions(built.definition, built.hero, built.catalog).some((entry) => entry.id === "font-of-magic")
    ).toBe(false);
  });
});

describe("Sorcerer: Innate Sorcery is a Bonus Action, a timer and a twice-a-day counter", () => {
  it("grants a 10-round tagged effect and refuses the third use", () => {
    const built = table(sorcerer(5));
    const action = actionOf(built, "innate-sorcery");
    expect(action.activation).toBe("bonus-action");
    expect(action.uses).toMatchObject({ limit: 2, per: "long-rest" });

    resolveDefinitionAction(
      built.state,
      action,
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000070" },
      deps(built, [])
    );
    // 1 minute is exactly ten rounds, and the tag is what "while your Innate Sorcery is active" reads.
    expect(built.hero.effects).toHaveLength(1);
    // The live effect counts down (`remaining`), the engine's shape for a rounds grant.
    expect(built.hero.effects[0]).toMatchObject({
      name: "Innate Sorcery",
      tags: ["innate-sorcery"],
      duration: { type: "rounds", remaining: 10 }
    });

    expect(built.hero.actionUses["innate-sorcery"]).toBe(1);

    // The pool's own refusal, on a fresh turn so the Bonus Action economy is not what refuses.
    const spent = table(sorcerer(5));
    spent.hero.actionUses = { "innate-sorcery": 2 };
    expect(() =>
      resolveDefinitionAction(
        spent.state,
        actionOf(spent, "innate-sorcery"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000072" },
        deps(spent, [])
      )
    ).toThrow();
    expect(spent.hero.actionUses["innate-sorcery"]).toBe(2); // the refusal spent nothing
  });

  it("does NOT hand out advantage on a plain weapon swing", () => {
    // The effect carries no `roll-mode`: effect modifiers go through `toRollModes`, which drops `when`, so
    // `attack-kind-is: ["spell"]` would be ignored and this dagger would roll two dice. It rolls one.
    const built = table(sorcerer(5));
    resolveDefinitionAction(
      built.state,
      actionOf(built, "innate-sorcery"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000073" },
      deps(built, [])
    );
    const swung = resolveDefinitionAction(
      built.state,
      actionOf(built, "item-dagger"),
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000074" },
      deps(built, [11, 3])
    );
    expect(swung.rollMode).toBeUndefined();
    expect(swung.attack!.naturalRoll).toBe(11);
  });
});

describe("Sorcerer: Sorcerous Restoration and Epic Boon (audit row 6, the Sorcerer's)", () => {
  it("gives Sorcerous Restoration one use per Long Rest", () => {
    const built = table(sorcerer(5));
    expect(actionOf(built, "sorcerous-restoration").uses).toMatchObject({ limit: 1, per: "long-rest" });
    resolveDefinitionAction(
      built.state,
      actionOf(built, "sorcerous-restoration"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000080" },
      deps(built, [])
    );
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "sorcerous-restoration"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000081" },
        deps(built, [])
      )
    ).toThrow();
  });

  it("offers the Epic Boon at 19, and refuses the build that skips it", () => {
    const boon = (rows: readonly Row[]) =>
      buildCharacterDefinition(sorcererInput(19, [...sorcererFor(19), ...rows]), library, POLICY);
    const built = boon([
      {
        level: 19,
        classId: "sorcerer",
        kind: "feat",
        id: "boon-of-dimensional-travel",
        payload: { featureId: "epic-boon" }
      } as Row,
      { level: 19, kind: "ability-score", id: "cha", payload: { featureId: "boon-of-dimensional-travel" } } as Row
    ]);
    expect((built.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-dimensional-travel");
    expect(thrown(() => boon([]))).toMatch(/"Epic Boon" needs 1 pick\(s\) of kind "feat"/);
  });
});

describe("Sorcerer: Metamagic costs a Sorcery Point off the same pool Font of Magic opens", () => {
  it("debits the shared counter, so a Metamagic option and Font of Magic spend one supply", () => {
    // Careful Spell prints "Cost: 1 Sorcery Point", so the chosen option carries a use of the same
    // `sorcery-points` pool, and Metamagic is a button that spends.
    const built = table(sorcerer(5));
    expect(actionOf(built, "careful-spell").uses).toMatchObject({ limit: 5, per: "long-rest", pool: "sorcery-points" });

    resolveDefinitionAction(
      built.state,
      actionOf(built, "careful-spell"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000100" },
      deps(built, [])
    );
    expect(built.hero.actionUses["sorcery-points"]).toBe(1);

    // ...and the four points left are Font of Magic's four: one pool, two ways to spend it.
    for (let spent = 0; spent < 4; spent += 1) {
      resolveDefinitionAction(
        built.state,
        actionOf(built, "font-of-magic"),
        { actorId: IDS.hero, targetIds: [], commandId: `50000000-0000-4000-8000-00000000011${spent}` },
        deps(built, [])
      );
    }
    expect(built.hero.actionUses["sorcery-points"]).toBe(5);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "distant-spell"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000119" },
        deps(built, [])
      )
    ).toThrow();
  });

  it("gives the two-point options NO counter, because a use is not a cost", () => {
    // `ActionUsesSchema` counts uses and cannot charge two, so Quickened Spell ("Cost: 2 Sorcery Points")
    // stays prose. Subtle Spell, at one point, does land.
    const built = table(sorcerer(10));
    const ids = effectiveActions(built.definition, built.hero, built.catalog).map((entry) => entry.id);
    expect(ids).toContain("subtle-spell");
    expect(ids).not.toContain("quickened-spell");
    // Both are still on the sheet as prose.
    expect(
      (built.definition.extensions?.["open5e.srd-2024"] as { traits: Array<{ name: string }> }).traits.map(
        (trait) => trait.name
      )
    ).toContain("Quickened Spell");
  });
});

describe("Draconic Sorcery: the level-3 spells and the affinity (audit rows 26, 23)", () => {
  it("hands over the level-3 Draconic Spells tier, free of the prepared budget", () => {
    const built = sorcerer(5);
    for (const [id, level] of [
      ["alter-self", 2],
      ["chromatic-orb", 1],
      ["command", 1],
      ["dragons-breath", 2]
    ] as const) {
      expect(spellOf(built, id)).toMatchObject({ id, level, alwaysPrepared: true, prepared: true });
    }
    // Command is not on the Sorcerer list, so the grant is the only route to it. The level-5 row (Fear, Fly)
    // arrives with Sorcerer 5; the level-9 row waits.
    for (const id of ["fear", "fly"]) expect(spellOf(built, id)).toMatchObject({ alwaysPrepared: true });
    expect(spellOf(built, "summon-dragon")).toBeUndefined();
    // A level-5 Sorcerer prepares 9; the four granted spells are on top of that.
    expect(built.spellcasting!.classes![0]).toMatchObject({ classId: "sorcerer", prepared: 9 });
  });

  it("resists the affinity damage type the player chose, and only that one", () => {
    const fiery = table(sorcerer(6, "fire"));
    expect(fiery.definition.damageResistances).toEqual(["fire"]);
    const burned = applyDamageDetailed(
      fiery.state,
      IDS.hero,
      { amount: 13, parts: [{ amount: 13, type: "fire" }] },
      { role: "gm" },
      { resolveDefinition: () => fiery.definition, catalog: fiery.catalog }
    );
    expect(burned.application.totalApplied).toBe(6); // 13 halved, rounded down

    expect(sorcerer(6, "poison").damageResistances).toEqual(["poison"]);
    // Necrotic is not one of the five the SRD prints for this feature.
    expect(thrown(() => sorcerer(6, "necrotic"))).toMatch(/not an offered option/);
    expect(
      thrown(() =>
        buildCharacterDefinition(
          sorcererInput(
            6,
            sorcererFor(6).filter((row) => row.kind !== "damage-type")
          ),
          library,
          POLICY
        )
      )
    ).toMatch(/"Elemental Affinity" needs 1 pick\(s\) of kind "damage-type"/);
  });

  it("adds the Sorcerer's Charisma to a damage roll of the type it names, and to no other", () => {
    /** Elemental Affinity's damage half: a supplied cantrip, with the rider from the real bundle off the chosen option, through the real derivation and resolver. */
    const bolt = (type: string) => ({
      id: "fire-bolt",
      name: "Fire Bolt",
      activation: "action" as const,
      description: "You hurl a mote of fire at a creature or an object within range.",
      attack: { bonus: 6 },
      damage: [{ formula: "2d10", type }],
      spellId: "fire-bolt"
    });
    const cast = (affinity: string, type: string, commandId: string) => {
      const built = table(sorcerer(6, affinity));
      return resolveDefinitionAction(
        built.state,
        bolt(type),
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId },
        deps(built, [15, 6, 4])
      );
    };

    // CHA 17 (+3) at level 6; the two ASI points went to Dexterity. Same two dice in all three.
    const burned = cast("fire", "fire", "50000000-0000-4000-8000-000000000120");
    expect(burned.damage).toEqual([
      { formula: "2d10", type: "fire", total: 10 },
      { formula: "3", type: "fire", total: 3 }
    ]);
    expect(burned.damageTotal).toBe(13);

    // A different damage type from the same Sorcerer: the gate filters, so nothing is added.
    const chilled = cast("fire", "cold", "50000000-0000-4000-8000-000000000121");
    expect(chilled.damage).toEqual([{ formula: "2d10", type: "cold", total: 10 }]);
    // ...and the same fire spell from a Sorcerer who chose Poison adds nothing: the rider follows the
    // player's answer.
    const unaffiliated = cast("poison", "fire", "50000000-0000-4000-8000-000000000122");
    expect(unaffiliated.damage).toEqual([{ formula: "2d10", type: "fire", total: 10 }]);
  });

  it("reaches a SAVE-only spell too, the half of the feature that used to be missing", () => {
    // "When you cast a spell that deals Fire damage" says nothing about attack rolls, so `damage-type-is`
    // must match a save-only spell too. The damage-type context is built from `action.damage` for both
    // attack and save branches; a save-only spell is the edge case that would catch it shrinking.
    const built = table(sorcerer(6, "fire"));
    const burningHands = {
      id: "burning-hands",
      name: "Burning Hands",
      activation: "action" as const,
      description: "A thin sheet of flames shoots forth from you.",
      damage: [{ formula: "3d6", type: "fire" }],
      save: { ability: "dex" as const, dc: 14, successDamage: "half" as const, failureConditions: [] },
      spellId: "burning-hands"
    };
    const swept = resolveDefinitionAction(
      built.state,
      burningHands,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000123" },
      deps(built, [4, 4, 4])
    );
    // CHA 17 (+3) at level 6: 3d6 fire, then the affinity's flat +3 as its own line.
    expect(swept.damage).toEqual([
      { formula: "3d6", type: "fire", total: 12 },
      { formula: "3", type: "fire", total: 3 }
    ]);
    expect(swept.damageTotal).toBe(15);

    // ...and the gate still gates: a Sorcerer who chose Cold adds nothing to the same fire spell.
    const chilly = table(sorcerer(6, "cold"));
    const unaffiliated = resolveDefinitionAction(
      chilly.state,
      burningHands,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000124" },
      deps(chilly, [4, 4, 4])
    );
    expect(unaffiliated.damage).toEqual([{ formula: "3d6", type: "fire", total: 12 }]);
    expect(unaffiliated.damageTotal).toBe(12);
  });

  it("keeps Draconic Resilience's Charisma AC, which is the subclass overlay's original proof", () => {
    // Unarmored: 10 + Dex 3 (14, +2 from the level-4 ASI) + Cha 3 (17) = 16; the starting kit has no armor.
    expect(sorcerer(5).armorClass).toBe(16);
    // The negative control: a level-2 Sorcerer has no subclass, so no Charisma in the AC at all.
    expect(buildCharacterDefinition(sorcererInput(2, sorcererFor(2)), library, POLICY).armorClass).toBe(12);
  });
});

describe("Draconic Sorcery: Dragon Wings and Dragon Companion carry their daily use", () => {
  const level18 = () => table(sorcerer(18));

  it("gives Dragon Wings a Bonus Action and one use per Long Rest, and a Fly Speed of 60 feet", () => {
    const built = level18();
    expect(actionOf(built, "dragon-wings")).toMatchObject({
      activation: "bonus-action",
      uses: { limit: 1, per: "long-rest" }
    });
    const flySpeed = () =>
      specialSpeedsOf(built.hero, built.definition, deriveEquipment(built.hero, built.definition, built.catalog)).fly;
    expect(flySpeed()).toBeUndefined();
    resolveDefinitionAction(
      built.state,
      actionOf(built, "dragon-wings"),
      { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000090" },
      deps(built, [])
    );
    expect(flySpeed()).toBe(60);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "dragon-wings"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000091" },
        deps(built, [])
      )
    ).toThrow();
  });

  it("hands Dragon Companion a free casting of Summon Dragon", () => {
    const built = level18();
    expect(spellOf(built.definition, "summon-dragon")).toMatchObject({
      id: "summon-dragon",
      level: 5,
      alwaysPrepared: true
    });
    expect(actionOf(built, "spell-summon-dragon-free").uses).toMatchObject({ limit: 1, per: "long-rest" });
    // A level-17 Sorcerer has the spell from the level-9 Draconic Spells row, but not the free casting.
    const seventeen = sorcerer(17);
    expect(spellOf(seventeen, "summon-dragon")).toMatchObject({ alwaysPrepared: true });
    expect(seventeen.actions.some((action) => action.id === "spell-summon-dragon-free")).toBe(false);
  });
});

// Wizard

// A level-20 Human Acolyte Evoker, the only level Signature Spells exists at. The Wizard record is
// hand-authored with several `choice` and `uses` already present; this also holds those.
const wizardInput = (): CharacterCreateRequestInput => ({
  name: "Ansel",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "wizard",
  level: 20,
  subclassId: "evoker",
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  backgroundBonusAllocation: [
    { ability: "int", amount: 2 },
    { ability: "wis", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "wizard", kind: "skill", id: "arcana" },
    { level: 1, classId: "wizard", kind: "skill", id: "investigation" },
    { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
    { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
    { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
    { level: 3, kind: "spell", id: "burning-hands", payload: { featureId: "evocation-savant" } },
    { level: 3, kind: "spell", id: "shatter", payload: { featureId: "evocation-savant" } },
    // INT 17 before the first; past 20 the picks go to CON.
    ...asiRows("wizard", [4, 8, 12, 16], ["int", "con"], { int: 17, con: 13 }),
    { level: 18, kind: "spell", id: "magic-missile", payload: { featureId: "spell-mastery" } },
    { level: 18, kind: "spell", id: "acid-arrow", payload: { featureId: "spell-mastery" } },
    {
      level: 19,
      classId: "wizard",
      kind: "feat",
      id: "boon-of-dimensional-travel",
      payload: { featureId: "epic-boon" }
    },
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
    // "you can cast each of them once at level 3 without expending a spell slot ... until you finish a
    // Short or Long Rest": two uses, recovered on a Short Rest.
    // One pool for both spells' free castings; the per-spell split stays in the text.
    for (const id of ["spell-fireball-free", "spell-counterspell-free"])
      expect(actionOf(built, id).uses).toMatchObject({ limit: 2, per: "short-rest", pool: "signature-spells" });

    for (const [commandId, id] of [
      ["50000000-0000-4000-8000-000000000130", "spell-fireball-free"],
      ["50000000-0000-4000-8000-000000000131", "spell-counterspell-free"]
    ] as const) {
      resolveDefinitionAction(
        built.state,
        actionOf(built, id),
        { actorId: IDS.hero, targetIds: [], commandId },
        // Fireball rolls its 8d6 even with no one in the area.
        deps(built, Array<number>(8).fill(3))
      );
    }
    expect(built.hero.actionUses["signature-spells"]).toBe(2);
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "spell-fireball-free"),
        { actorId: IDS.hero, targetIds: [], commandId: "50000000-0000-4000-8000-000000000132" },
        deps(built, [])
      )
    ).toThrow();
    expect(built.hero.actionUses["signature-spells"]).toBe(2); // the refusal spent nothing

    // A Short Rest gives them back. Overchannel, once per Long Rest, is the control and must not come back.
    built.hero.actionUses = { ...built.hero.actionUses, overchannel: 1 };
    endEncounter(built.state);
    applyRest(built.state, IDS.hero, "short", () => built.definition, built.catalog);
    expect(built.hero.actionUses["signature-spells"]).toBeUndefined();
    expect(built.hero.actionUses["overchannel"]).toBe(1);
  });

  it("holds the counters and picks the hand-authored record already carried", () => {
    // Arcane Recovery and Overchannel are the Wizard's pools, and Spell Mastery's two spells and the Epic
    // Boon are picks the level-20 build owes.
    const built = table(buildCharacterDefinition(wizardInput(), library, POLICY));
    expect(actionOf(built, "arcane-recovery").uses).toMatchObject({ limit: 1, per: "long-rest" });
    expect(actionOf(built, "overchannel").uses).toMatchObject({ limit: 1, per: "long-rest" });
    expect((built.definition.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-dimensional-travel");
    for (const id of ["magic-missile", "acid-arrow", "fireball", "counterspell", "burning-hands", "shatter"]) {
      expect(spellOf(built.definition, id)).toMatchObject({ id });
    }
    // INT 15 + the Acolyte's 2 = 17, then three points of ASI to 20 (the rest go to CON), then the epic boon's +1.
    // Boon of Dimensional Travel prints "to a maximum of 30", carried as `maximum: 30` on the choice.
    expect(built.definition.abilityScores.int).toBe(21);
  });

  it("refuses the build that leaves Signature Spells unchosen", () => {
    const without = () =>
      buildCharacterDefinition(
        {
          ...wizardInput(),
          choices: wizardInput().choices.filter((row) => row.payload?.featureId !== "signature-spells")
        },
        library,
        POLICY
      );
    expect(thrown(without)).toMatch(/"Signature Spells" needs 2 pick\(s\) of kind "spell"/);
  });
});

// Spell Mastery: "Choose a level 1 and a level 2 spell in your spellbook that have a casting time of an
// action." These are two picks with separate windows under separate ceilings. Two
// level-1 spells must fail on the second block's floor, and two level-2 spells on the first block's
// ceiling. Reads the shipped bundle through the real `ContentLibrary`.
describe("Wizard: Spell Mastery is a level-1 pick AND a level-2 pick, not two picks under one ceiling", () => {
  const mastery = (id: string): Row =>
    ({ level: 18, kind: "spell", id, payload: { featureId: "spell-mastery" } }) as Row;

  // A level-18 Evoker: Spell Mastery arrives here, one level below the Epic Boon, so the ledger owes
  // exactly the two mastery rows. Derived from `wizardInput()` by dropping levels 19-20.
  const level18 = (masteryRows: readonly Row[]): CharacterCreateRequestInput => ({
    ...wizardInput(),
    level: 18,
    choices: [
      ...wizardInput().choices.filter((row) => row.level < 18),
      ...masteryRows
    ] as CharacterCreateRequestInput["choices"]
  });

  it("REFUSES a level-18 Wizard who answers both rows with level-1 spells", () => {
    // Both spells are level 1: the first fills the level-1 block and the second has nowhere to go. The
    // message is asserted whole; its tail ("Spell Mastery: 1, Spell Mastery: 1") shows two offers of one.
    const message = thrown(() =>
      buildCharacterDefinition(level18([mastery("magic-missile"), mastery("detect-magic")]), library, POLICY)
    );
    expect(message).toBe(
      'The "spell" pick "detect-magic" exceeds what this build may choose (Spell Mastery: 1, Spell Mastery: 1).'
    );
  });

  it("REFUSES a level-18 Wizard who answers both rows with level-2 spells, naming the ceiling", () => {
    // The mirror: both spells are level 2, so one is above the level-1 block's ceiling. Identical windows
    // would accept this.
    const message = thrown(() =>
      buildCharacterDefinition(level18([mastery("acid-arrow"), mastery("blur")]), library, POLICY)
    );
    expect(message).toBe(
      'The "spell" pick "blur" exceeds what this build may choose (Spell Mastery: 1, Spell Mastery: 1).'
    );
  });

  it('REFUSES a cantrip in the level-1 row, since a level-0 spell is no "level 1 spell"', () => {
    // The window's floor: `wizard-spells` includes cantrips and `withinSpellWindow` is a plain min/max
    // check, so without a floor a cantrip would satisfy "level 1 spell". The client picker filters
    // cantrips, so only a server-side test reaches this. The refusal names the level, the minimum, and
    // the feature.
    const message = thrown(() =>
      buildCharacterDefinition(level18([mastery("fire-bolt"), mastery("acid-arrow")]), library, POLICY)
    );
    expect(message).toBe('"fire-bolt" is level 0, below the minimum spell level (1) for "Spell Mastery".');
  });

  it("ACCEPTS the printed pair, and puts both spells on the sheet", () => {
    // The feature still works for the pair the SRD prints.
    const built = buildCharacterDefinition(level18([mastery("magic-missile"), mastery("acid-arrow")]), library, POLICY);
    expect(spellOf(built, "magic-missile")).toMatchObject({ id: "magic-missile", level: 1 });
    expect(spellOf(built, "acid-arrow")).toMatchObject({ id: "acid-arrow", level: 2 });
  });

  it("offers TWO pick rows with DIFFERENT windows, through the accessor the builder reads", () => {
    // `featurePicks` is the accessor `character-build.ts` takes a feature's picks through, so this is the
    // list that became the two offers above.
    const spellMastery = library.classRecord("wizard")!.features.find((feature) => feature.id === "spell-mastery")!;
    const picks = featurePicks(spellMastery);
    expect(picks).toHaveLength(2);
    // Both windows are floored as well as capped; the first block's floor of 1 keeps cantrips out.
    expect(picks.map((pick) => [pick.minSpellLevel ?? null, pick.maxSpellLevel ?? null])).toEqual([
      [1, 1],
      [2, 2]
    ]);
    expect(picks.map((pick) => pick.choose)).toEqual([1, 1]);
  });
});

// Prerequisites and windows the SRD prints on these classes' picks

describe("Warlock invocations: a prerequisite is met before the invocation is learned", () => {
  it("offers a Warlock 1 only the invocations with no level prerequisite", () => {
    const offer = builderOffers(
      { speciesId: "human", backgroundId: "acolyte", classId: "warlock", level: 1 },
      library
    ).offers.find((candidate) => candidate.key === "feature:eldritch-invocations")!;
    const ids = offer.options.map((option) => option.id);
    expect(ids).toEqual(expect.arrayContaining(["armor-of-shadows", "pact-of-the-blade", "eldritch-mind"]));
    // Level 2+, 9+ and 15+ invocations.
    for (const later of ["agonizing-blast", "visions-of-distant-realms", "witch-sight"])
      expect(ids).not.toContain(later);
  });

  it("refuses a level-15 invocation to a Warlock 5", () => {
    expect(thrown(() => withInvocation("witch-sight"))).toMatch(/"witch-sight" is not an offered option/);
  });

  it("refuses Thirsting Blade without Pact of the Blade, and takes it with the pact", () => {
    expect(thrown(() => withInvocation("thirsting-blade"))).toMatch(/"thirsting-blade" is not an offered option/);
    const bladelock = buildCharacterDefinition(
      warlockInput(5, [
        invocation(1, "pact-of-the-blade"),
        {
          level: 1,
          classId: "warlock",
          kind: "weapon",
          id: "longsword",
          payload: { featureId: "pact-of-the-blade" }
        } as Row,
        invocation(2, "mask-of-many-faces"),
        invocation(2, "misty-visions"),
        invocation(5, "master-of-myriad-forms"),
        invocation(5, "thirsting-blade"),
        ...asisFor(5, "dex")
      ]),
      library,
      POLICY
    );
    expect((bladelock.character?.choices ?? []).map((row) => row.id)).toContain("thirsting-blade");
  });
});

describe("Draconic Sorcery: Draconic Resilience's Hit Points", () => {
  it("adds 3 at Sorcerer 3 and 1 for every Sorcerer level after", () => {
    // CON 13 (+1) on a d6: 7 at level 1, then 5 a level by the average. The ASI at 4 goes to Dexterity.
    expect(sorcerer(2).hitPoints.maximum).toBe(12);
    expect(sorcerer(3).hitPoints.maximum).toBe(17 + 3);
    expect(sorcerer(4).hitPoints.maximum).toBe(22 + 4);
  });
});

describe("Spell picks keep to the level and school the SRD prints", () => {
  const withRows = (drop: string, rows: readonly Row[]): CharacterCreateRequestInput => {
    const input = wizardInput();
    return {
      ...input,
      choices: [...input.choices.filter((row) => row.payload?.featureId !== drop), ...rows]
    };
  };
  const pick = (featureId: string, id: string, level: number): Row =>
    ({ level, kind: "spell", id, payload: { featureId } }) as Row;

  it("refuses a cantrip or a level-2 spell as a Signature Spell, which must be level 3", () => {
    const cantrip = withRows("signature-spells", [
      pick("signature-spells", "fire-bolt", 20),
      pick("signature-spells", "fireball", 20)
    ]);
    expect(thrown(() => buildCharacterDefinition(cantrip, library, POLICY))).toBe(
      '"fire-bolt" is level 0, below the minimum spell level (3) for "Signature Spells".'
    );
    const second = withRows("signature-spells", [
      pick("signature-spells", "alter-self", 20),
      pick("signature-spells", "fireball", 20)
    ]);
    expect(thrown(() => buildCharacterDefinition(second, library, POLICY))).toMatch(/"alter-self" is level 2, below/);
  });

  it("takes Evocation Savant's spells from the Evocation school only, into the spellbook", () => {
    const transmuter = withRows("evocation-savant", [
      pick("evocation-savant", "burning-hands", 3),
      pick("evocation-savant", "alter-self", 3)
    ]);
    expect(thrown(() => buildCharacterDefinition(transmuter, library, POLICY))).toMatch(
      /"alter-self" is not an offered option/
    );
    // The printed pick lands in the spellbook: known, prepared like any other Wizard spell.
    const built = buildCharacterDefinition(wizardInput(), library, POLICY);
    expect(spellOf(built, "burning-hands")).toMatchObject({ prepared: false, alwaysPrepared: false });
  });
});
