import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";

// Cleric, Druid and Bard mechanics, asserted as numbers a player can act on, counters the engine
// spends, or refusals the server issues; never "the rider survived derivation" on its own. Uses the
// real bundles through a real `ContentLibrary`.

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
const FOE = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d12";

type Row = CharacterCreateRequestInput["choices"][number];
type Mutable = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & {
  choices: Row[];
};

// The ASI rows a class owes at every ASI level at or below `level`. Spread across abilities nothing
// else asserts, so no score hits the 20 cap and no assertion depends on which ASI landed where.
const ASI_ABILITIES = [
  ["con", "dex"],
  ["con", "dex"],
  ["str", "int"],
  ["str", "int"]
] as const;
const asiRows = (classId: string, level: number): Row[] =>
  [4, 8, 12, 16]
    .filter((asi) => asi <= level)
    .flatMap(
      (asi, index) =>
        [
          { level: asi, classId, kind: "asi-or-feat", id: "ability-score-improvement" },
          {
            level: asi,
            kind: "ability-score",
            id: ASI_ABILITIES[index][0],
            payload: { featureId: "ability-score-improvement" }
          },
          {
            level: asi,
            kind: "ability-score",
            id: ASI_ABILITIES[index][1],
            payload: { featureId: "ability-score-improvement" }
          }
        ] as Row[]
    );

/** The Human's own two picks: Skillful's skill and Versatile's origin feat. */
const HUMAN: Row[] = [
  { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
  { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } }
];
/** The three picks the Sage's origin feat (Magic Initiate (Wizard)) asks for, on a Wisdom class. */
const SAGE_FEAT: Row[] = [
  { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
  { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
  { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
  { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "magic-initiate-wizard" } }
];
/** The same for the Acolyte's Magic Initiate (Cleric), on the Charisma class. */
const ACOLYTE_FEAT: Row[] = [
  { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
  { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
  { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
  { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } }
];

// A Druid of any level. `sage` is the background because it can raise Wisdom; its origin feat's
// picks are tagged with their feature id, so they never touch the class budgets asserted below.
const druid = (level: number, extra: Row[] = []): Mutable =>
  ({
    name: "Maelin",
    speciesId: "human",
    backgroundId: "sage",
    classId: "druid",
    level,
    ...(level >= 3 ? { subclassId: "circle-of-the-land" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "druid", kind: "skill", id: "nature" },
      { level: 1, classId: "druid", kind: "skill", id: "perception" },
      { level: 1, kind: "cantrip", id: "druidcraft" },
      { level: 1, kind: "cantrip", id: "guidance" },
      { level: 1, kind: "spell", id: "entangle" },
      { level: 1, kind: "spell", id: "cure-wounds" },
      ...HUMAN,
      ...SAGE_FEAT,
      ...(level >= 3
        ? ([
            { level: 3, classId: "druid", kind: "subclass", id: "circle-of-the-land" },
            // Circle Spells: "choose one type of land". Nature's Ward reads this answer at level 10.
            { level: 3, kind: "land", id: "polar", payload: { featureId: "circle-of-the-land-spells" } }
          ] as Row[])
        : []),
      ...asiRows("druid", level),
      { level: 1, kind: "equipment", id: "druid-a" },
      { level: 1, kind: "equipment", id: "sage-a" },
      ...extra
    ]
  }) as Mutable;

const primalOrder = (id: "magician" | "warden"): Row =>
  ({ level: 1, classId: "druid", kind: "primal-order", id, payload: { featureId: "primal-order" } }) as Row;
const elementalFury = (id: "potent-spellcasting" | "primal-strike"): Row =>
  ({ level: 7, classId: "druid", kind: "elemental-fury", id, payload: { featureId: "elemental-fury" } }) as Row;
/** The level-19 Epic Boon pick, plus the ability point the chosen boon feat then asks for. */
const epicBoon = (classId: string, featId: string, ability: string): Row[] =>
  [
    { level: 19, classId, kind: "feat", id: featId, payload: { featureId: "epic-boon" } },
    { level: 19, kind: "ability-score", id: ability, payload: { featureId: featId } }
  ] as Row[];

// A Bard of any level. `cha` is what Bardic Inspiration counts, so it is a parameter: 15 (+2 from
// the Acolyte = 17, modifier +3) or 8 (modifier -1, which the authored `minimum` floors at 1).
const bard = (level: number, cha: 8 | 15, extra: Row[] = []): Mutable =>
  ({
    name: "Ysolde",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "bard",
    level,
    ...(level >= 3 ? { subclassId: "college-of-lore" } : {}),
    abilityMethod: "standard-array",
    baseScores:
      cha === 8
        ? { str: 12, dex: 14, con: 13, int: 10, wis: 15, cha: 8 }
        : { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation:
      cha === 8
        ? [
            { ability: "int", amount: 2 },
            { ability: "wis", amount: 1 }
          ]
        : [
            { ability: "cha", amount: 2 },
            { ability: "wis", amount: 1 }
          ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "bard", kind: "skill", id: "performance" },
      { level: 1, classId: "bard", kind: "skill", id: "persuasion" },
      { level: 1, classId: "bard", kind: "skill", id: "deception" },
      { level: 1, kind: "cantrip", id: "vicious-mockery" },
      { level: 1, kind: "cantrip", id: "mage-hand" },
      { level: 1, kind: "spell", id: "charm-person" },
      { level: 1, kind: "spell", id: "cure-wounds" },
      ...HUMAN,
      ...ACOLYTE_FEAT,
      ...(level >= 2
        ? ([
            { level: 2, classId: "bard", kind: "expertise", id: "performance", payload: { featureId: "expertise" } },
            { level: 2, classId: "bard", kind: "expertise", id: "persuasion", payload: { featureId: "expertise" } }
          ] as Row[])
        : []),
      ...(level >= 3 ? ([{ level: 3, classId: "bard", kind: "subclass", id: "college-of-lore" }] as Row[]) : []),
      ...(level >= 9
        ? ([
            { level: 9, classId: "bard", kind: "expertise", id: "deception", payload: { featureId: "expertise" } },
            { level: 9, classId: "bard", kind: "expertise", id: "stealth", payload: { featureId: "expertise" } }
          ] as Row[])
        : []),
      // Magical Discoveries: two spells from the Cleric, Druid or Wizard list (the union slug). Neither is
      // on the Bard list.
      ...(level >= 6
        ? ([
            { level: 6, kind: "spell", id: "spiritual-weapon", payload: { featureId: "magical-discoveries" } },
            { level: 6, kind: "spell", id: "fireball", payload: { featureId: "magical-discoveries" } }
          ] as Row[])
        : []),
      ...asiRows("bard", level),
      { level: 1, kind: "equipment", id: "bard-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" },
      ...extra
    ]
  }) as Mutable;

const loreSkills = (...ids: string[]): Row[] =>
  ids.map((id) => ({ level: 3, kind: "skill", id, payload: { featureId: "bonus-proficiencies" } }) as Row);

const build = (input: Mutable) => buildCharacterDefinition(input, library, policy);
const actionOf = (definition: ReturnType<typeof build>, id: string) =>
  definition.actions.find((action) => action.id === id);
const spellOf = (definition: ReturnType<typeof build>, id: string) =>
  (definition.spellcasting?.spells ?? []).find((spell) => spell.id === id);

/** An encounter with the action economy off, so neither the turn nor the action slot masks a use gate. */
function encounterWith(definition: ReturnType<typeof build>): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, HERO, "public");
  state.actors.push({
    ...state.actors[0],
    id: FOE,
    name: "Ghoul",
    kind: "monster",
    definitionId: undefined,
    actionUses: {}
  });
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: FOE, score: 20 },
        { actorId: HERO, score: 5 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  state.combat = { ...state.combat, ruleExceptions: { economy: "freeform" } };
  return state;
}
let commandSeq = 0;
const deps = (definition: ReturnType<typeof build>): ResolveDependencies => ({
  random: () => 3,
  newRollId: () => `40000000-0000-4000-8000-00000000000${(commandSeq += 1) % 10}`,
  gmSessionId: "30000000-0000-4000-8000-00000000000a",
  now: () => "2026-07-27T00:00:00.000Z",
  definition
});
const command = () => `50000000-0000-4000-8000-0000000000${String(((commandSeq += 1) % 90) + 10)}`;

// Druid

describe("Primal Order: the twin of the bug that started this area (audit row 4)", () => {
  it("lets a MAGICIAN take a third cantrip at level 1, and refuses a WARDEN the same one", () => {
    // The printed level-1 row says two cantrips; Magician adds "one extra cantrip from the Druid spell list".
    const third: Row = { level: 1, kind: "cantrip", id: "shillelagh" };
    const magician = build(druid(1, [primalOrder("magician"), third]));
    expect(
      (magician.spellcasting?.spells ?? []).filter((spell) => spell.level === 0).map((spell) => spell.id)
    ).toContain("shillelagh");
    // Negative control: a composition that gave every Druid +1 would pass the assertion above.
    expect(() => build(druid(1, [primalOrder("warden"), third]))).toThrowError(
      /Druid knows 2 cantrips at level 1; got 3/
    );
  });

  it("gives a WARDEN Martial weapons and Medium armor, and a Magician neither", () => {
    const warden = build(druid(1, [primalOrder("warden")]));
    expect(warden.proficiencies?.weapons).toContain("martial");
    expect(warden.proficiencies?.armor).toContain("medium");
    const magician = build(druid(1, [primalOrder("magician")]));
    expect(magician.proficiencies?.weapons).not.toContain("martial");
    expect(magician.proficiencies?.armor).not.toContain("medium");
  });
});

describe("Druidic: a language and an always-prepared spell (audit row 35)", () => {
  const definition = build(druid(1, [primalOrder("magician")]));

  it("puts Druidic on the sheet and Speak with Animals in the spell list", () => {
    expect(definition.proficiencies?.languages).toContain("druidic");
    expect(spellOf(definition, "speak-with-animals")).toMatchObject({ alwaysPrepared: true, level: 1 });
  });

  it("does NOT charge the granted spell against the prepared budget", () => {
    // "Those spells don't count against the number of spells you can prepare." A level-1 Druid prepares
    // four: the grant plus four chosen spells is legal and a fifth is not.
    const four: Row[] = [
      { level: 1, kind: "spell", id: "faerie-fire" },
      { level: 1, kind: "spell", id: "fog-cloud" }
    ];
    const full = build(druid(1, [primalOrder("magician"), ...four]));
    expect(spellOf(full, "speak-with-animals")?.alwaysPrepared).toBe(true);
    expect(
      (full.spellcasting?.spells ?? [])
        .filter((spell) => spell.level === 1 && !spell.alwaysPrepared)
        .map((spell) => spell.id)
        .sort()
    ).toEqual(["cure-wounds", "entangle", "faerie-fire", "fog-cloud"]); // the Sage feat's own is always prepared
    expect(() =>
      build(druid(1, [primalOrder("magician"), ...four, { level: 1, kind: "spell", id: "thunderwave" } as Row]))
    ).toThrowError(/Druid prepares 4 spells at level 1; got 5/);
  });
});

describe("Wild Shape: the pool, read off the printed column (audit row 54)", () => {
  it("counts uses off the Wild Shape column and grows with it", () => {
    // 2 at level 2, 3 at level 6, 4 at level 17, from the printed column.
    expect(actionOf(build(druid(2, [primalOrder("warden")])), "wild-shape")?.uses).toEqual({
      limit: 2,
      per: "long-rest"
    });
    expect(actionOf(build(druid(6, [primalOrder("warden")])), "wild-shape")?.uses).toEqual({
      limit: 3,
      per: "long-rest"
    });
    expect(
      actionOf(build(druid(17, [primalOrder("warden"), elementalFury("primal-strike")])), "wild-shape")?.uses
    ).toEqual({ limit: 4, per: "long-rest" });
    // ...and it is a Bonus Action, as the SRD prints.
    expect(actionOf(build(druid(2, [primalOrder("warden")])), "wild-shape")?.activation).toBe("bonus-action");
  });

  it("gives Temporary Hit Points equal to the Druid level as the form is assumed", () => {
    const definition = build(druid(6, [primalOrder("warden")]));
    const state = encounterWith(definition);
    resolveDefinitionAction(
      state,
      actionOf(definition, "wild-shape")!,
      { actorId: HERO, targetIds: [], commandId: command() },
      deps(definition)
    );
    expect(state.actors[0].hp.temporary).toBe(6);
  });

  it("really spends the counter, twice, and then refuses the third", () => {
    // A spent counter and a refusal.
    const definition = build(druid(2, [primalOrder("warden")]));
    const state = encounterWith(definition);
    const shape = actionOf(definition, "wild-shape")!;
    resolveDefinitionAction(state, shape, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["wild-shape"]).toBe(1);
    resolveDefinitionAction(state, shape, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["wild-shape"]).toBe(2);
    expect(() =>
      resolveDefinitionAction(state, shape, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition))
    ).toThrowError(/no uses remaining \(2\/Long Rest\)/);
  });
});

describe("Wild Companion: the level-2 Find Familiar", () => {
  it("puts Find Familiar on the sheet, uncharged, and only from level 2", () => {
    const two = build(druid(2, [primalOrder("warden")]));
    expect(spellOf(two, "find-familiar")).toMatchObject({ alwaysPrepared: true });
    // The negative control: a level-1 Druid does not have Wild Companion, so it does not have this.
    expect(spellOf(build(druid(1, [primalOrder("warden")])), "find-familiar")).toBeUndefined();
  });
});

describe("Land's Aid - a Circle of the Land action spending the CLASS's Wild Shape pool", () => {
  const definition = build(druid(3, [primalOrder("warden")]));

  it("shares the wild-shape key rather than minting a second counter", () => {
    expect(actionOf(definition, "lands-aid")?.uses).toMatchObject({ pool: "wild-shape", limit: 2 });
  });

  it("rolls the printed damage against the real spell save DC, growing at 10 and 14", () => {
    // WIS 15 + 2 (background) = 17 -> +3, proficiency +2, so DC 13, derived from the character.
    expect(actionOf(definition, "lands-aid")?.save).toEqual({
      ability: "con",
      dc: 13,
      spellcasting: true,
      successDamage: "half",
      failureConditions: []
    });
    expect(actionOf(definition, "lands-aid")?.damage).toEqual([{ formula: "2d6", type: "necrotic" }]);
    expect(
      actionOf(build(druid(10, [primalOrder("warden"), elementalFury("primal-strike")])), "lands-aid")?.damage
    ).toEqual([{ formula: "3d6", type: "necrotic" }]);
    expect(
      actionOf(build(druid(14, [primalOrder("warden"), elementalFury("primal-strike")])), "lands-aid")?.damage
    ).toEqual([{ formula: "4d6", type: "necrotic" }]);
  });

  it("spends Wild Shape when it resolves, so the two features share one budget", () => {
    // Cast Land's Aid once and the Druid has one shape left: SRD "expend a use of your Wild
    // Shape" means a shared key.
    const state = encounterWith(definition);
    resolveDefinitionAction(
      state,
      actionOf(definition, "lands-aid")!,
      { actorId: HERO, targetIds: [FOE], commandId: command() },
      deps(definition)
    );
    expect(state.actors[0].actionUses["wild-shape"]).toBe(1);
    resolveDefinitionAction(
      state,
      actionOf(definition, "wild-shape")!,
      { actorId: HERO, targetIds: [], commandId: command() },
      deps(definition)
    );
    expect(state.actors[0].actionUses["wild-shape"]).toBe(2);
    expect(() =>
      resolveDefinitionAction(
        state,
        actionOf(definition, "lands-aid")!,
        { actorId: HERO, targetIds: [FOE], commandId: command() },
        deps(definition)
      )
    ).toThrowError(/no uses remaining \(2\/Long Rest\)/);
  });
});

describe("Elemental Fury: the twin of Blessed Strikes (audit row 5)", () => {
  it("rolls Primal Strike's 1d8 at level 7 and 2d8 at level 15, once per turn", () => {
    // The level-15 step is Improved Elemental Fury's damage half, expressed with `damageByLevel` as the
    // shipped Cleric record does.
    const seven = build(druid(7, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(actionOf(seven, "primal-strike")?.damage).toEqual([{ formula: "1d8", type: "lightning" }]);
    expect(actionOf(seven, "primal-strike")?.uses).toEqual({ limit: 1, per: "turn", pool: "primal-strike" });
    const fifteen = build(druid(15, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(actionOf(fifteen, "primal-strike")?.damage).toEqual([{ formula: "2d8", type: "lightning" }]);
  });

  it("gives the OTHER option no strike at all, and refuses an option that is on neither list", () => {
    const potent = build(druid(7, [primalOrder("warden"), elementalFury("potent-spellcasting")]));
    expect(actionOf(potent, "primal-strike")).toBeUndefined();
    const bogus = druid(7, [
      primalOrder("warden"),
      {
        level: 7,
        classId: "druid",
        kind: "elemental-fury",
        id: "storm-strike",
        payload: { featureId: "elemental-fury" }
      } as Row
    ]);
    expect(() => build(bogus)).toThrowError(/not an offered option/);
  });

  it("adds the Wisdom modifier to a Druid cantrip's damage with Potent Spellcasting, and not with Primal Strike", () => {
    // Wisdom 15 + 2 (Sage) = 17: +3. Produce Flame's hurl, 1d8 at level 7 is 2d8, both dice 3.
    const flame = (option: "potent-spellcasting" | "primal-strike") => {
      const definition = build(
        druid(7, [
          primalOrder("warden"),
          elementalFury(option),
          { level: 4, kind: "cantrip", id: "produce-flame" } as Row
        ])
      );
      const state = encounterWith(definition);
      const faces = [15, 3, 3];
      // The catalog is where the chosen option's rider is read from.
      const flameDeps = { ...deps(definition), catalog: equipmentCatalogOf(library), random: () => faces.shift() ?? 3 };
      const act = (id: string, targetIds: string[]) =>
        resolveDefinitionAction(
          state,
          effectiveActions(definition, state.actors[0]!, undefined).find((action) => action.id === id)!,
          { actorId: HERO, targetIds, commandId: command() },
          flameDeps
        );
      act("spell-produce-flame", []);
      return act("spell-produce-flame-then-hurl", [FOE]);
    };
    const potent = flame("potent-spellcasting");
    expect(potent.damage).toContainEqual({ formula: "3", type: "fire", total: 3 });
    expect(flame("primal-strike").damage.map((part) => part.type)).toEqual(["fire"]);
  });

  it("refuses the build outright when the level-7 pick is missing", () => {
    // An unanswered pick is a rejection.
    expect(() => build(druid(7, [primalOrder("warden")]))).toThrowError(/Elemental Fury/);
  });
});

describe("Nature's Sanctuary - the third feature on the one Wild Shape counter", () => {
  it("spends the same key at level 14, so three spenders share one budget", () => {
    const definition = build(druid(14, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(actionOf(definition, "natures-sanctuary")?.uses).toMatchObject({ pool: "wild-shape", limit: 3 });
    const state = encounterWith(definition);
    for (const id of ["natures-sanctuary", "lands-aid", "wild-shape"]) {
      resolveDefinitionAction(
        state,
        actionOf(definition, id)!,
        { actorId: HERO, targetIds: id === "lands-aid" ? [FOE] : [], commandId: command() },
        deps(definition)
      );
    }
    expect(state.actors[0].actionUses["wild-shape"]).toBe(3);
    expect(() =>
      resolveDefinitionAction(
        state,
        actionOf(definition, "natures-sanctuary")!,
        { actorId: HERO, targetIds: [], commandId: command() },
        deps(definition)
      )
    ).toThrowError(/no uses remaining \(3\/Long Rest\)/);
  });
});

describe("Nature's Ward - the half of audit row 65 that is authorable", () => {
  it("makes a level-10 Circle of the Land Druid immune to Poisoned", () => {
    const ten = build(druid(10, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(ten.conditionImmunities).toContain("poisoned");
    // The negative control: the immunity arrives with the level-10 feature, and the subclass alone gives none.
    expect(build(druid(3, [primalOrder("warden")])).conditionImmunities ?? []).not.toContain("poisoned");
  });
});

describe("Epic Boon: the level-19 feat nine classes lost outright (audit row 6)", () => {
  it("makes a level-19 Druid pick one, or another feat it qualifies for", () => {
    const taken = build(
      druid(19, [
        primalOrder("warden"),
        elementalFury("primal-strike"),
        ...epicBoon("druid", "boon-of-dimensional-travel", "cha")
      ])
    );
    expect((taken.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-dimensional-travel");
    expect(() => build(druid(19, [primalOrder("warden"), elementalFury("primal-strike")]))).toThrowError(/Epic Boon/);
    // "or another feat of your choice for which you qualify": Grappler (DEX 14), but not Alert, already held.
    const grappler = build(
      druid(19, [primalOrder("warden"), elementalFury("primal-strike"), ...epicBoon("druid", "grappler", "dex")])
    );
    expect((grappler.character?.feats ?? []).map((feat) => feat.id)).toContain("grappler");
    const held = druid(19, [
      primalOrder("warden"),
      elementalFury("primal-strike"),
      { level: 19, classId: "druid", kind: "feat", id: "alert", payload: { featureId: "epic-boon" } } as Row
    ]);
    expect(() => build(held)).toThrowError(/Alert is already on this character/);
  });

  it("does the same for the Bard", () => {
    const taken = build(
      bard(19, 15, [...loreSkills("history", "arcana", "nature"), ...epicBoon("bard", "boon-of-spell-recall", "wis")])
    );
    expect((taken.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-spell-recall");
    expect(() => build(bard(19, 15, loreSkills("history", "arcana", "nature")))).toThrowError(/Epic Boon/);
  });
});

// Bard

describe("Bardic Inspiration: the counter the class is built around", () => {
  it("hands out as many dice as the Charisma modifier, and never fewer than one", () => {
    // "A number of times equal to your Charisma modifier (minimum of once)". CHA 15 + 2 = 17 -> +3;
    // CHA 8 -> -1, floored to 1. Reading the Bardic Die column instead would yield zero uses.
    expect(actionOf(build(bard(1, 15)), "bardic-inspiration")?.uses).toEqual({ limit: 3, per: "long-rest" });
    expect(actionOf(build(bard(1, 8)), "bardic-inspiration")?.uses).toEqual({ limit: 1, per: "long-rest" });
    expect(actionOf(build(bard(1, 15)), "bardic-inspiration")?.activation).toBe("bonus-action");
  });

  it("gives the die three times and then refuses the fourth", () => {
    const definition = build(bard(1, 15));
    const state = encounterWith(definition);
    const inspire = actionOf(definition, "bardic-inspiration")!;
    const give = () =>
      resolveDefinitionAction(
        state,
        inspire,
        { actorId: HERO, targetIds: [FOE], commandId: command() },
        deps(definition)
      );
    for (let spent = 1; spent <= 3; spent += 1) {
      give();
      expect(state.actors[0].actionUses["bardic-inspiration"]).toBe(spent);
      // The die the creature holds is the Bardic Die column's at this level.
      expect(state.actors[1].effects[0]?.answer?.effect).toEqual({ kind: "add", amount: "1d6" });
      state.actors[1].effects = [];
    }
    expect(give).toThrowError(/no uses remaining \(3\/Long Rest\)/);
  });

  it("gives a d8 from level 5, and a d12 from level 15", () => {
    const dieAt = (level: number) =>
      actionOf(
        build(bard(level, 15, level >= 3 ? loreSkills("history", "arcana", "nature") : [])),
        "bardic-inspiration"
      )?.grants?.answer?.effect;
    expect(dieAt(5)).toEqual({ kind: "add", amount: "1d8" });
    expect(dieAt(15)).toEqual({ kind: "add", amount: "1d12" });
  });

  it("lets Cutting Words and Peerless Skill spend that SAME counter", () => {
    // College of Lore spends Bardic Inspiration dice and has none of its own; a separate key would double
    // a level-14 Bard's budget.
    const definition = build(bard(14, 15, loreSkills("history", "arcana", "nature")));
    expect(actionOf(definition, "cutting-words")?.uses).toMatchObject({ pool: "bardic-inspiration", limit: 3 });
    expect(actionOf(definition, "peerless-skill")?.uses).toMatchObject({ pool: "bardic-inspiration", limit: 3 });
    expect(actionOf(definition, "cutting-words")?.activation).toBe("reaction");

    const state = encounterWith(definition);
    resolveDefinitionAction(
      state,
      actionOf(definition, "cutting-words")!,
      { actorId: HERO, targetIds: [], commandId: command() },
      deps(definition)
    );
    resolveDefinitionAction(
      state,
      actionOf(definition, "peerless-skill")!,
      { actorId: HERO, targetIds: [], commandId: command() },
      deps(definition)
    );
    resolveDefinitionAction(
      state,
      actionOf(definition, "bardic-inspiration")!,
      { actorId: HERO, targetIds: [FOE], commandId: command() },
      deps(definition)
    );
    expect(state.actors[0].actionUses["bardic-inspiration"]).toBe(3);
    expect(() =>
      resolveDefinitionAction(
        state,
        actionOf(definition, "cutting-words")!,
        { actorId: HERO, targetIds: [], commandId: command() },
        deps(definition)
      )
    ).toThrowError(/no uses remaining \(3\/Long Rest\)/);
  });
});

describe("College of Lore Bonus Proficiencies: three skills that were promised and never offered (audit row 19)", () => {
  it("puts all three on the sheet, and refuses a build that answers with two", () => {
    const definition = build(bard(3, 15, loreSkills("history", "arcana", "nature")));
    const skills = new Set((definition.proficiencies?.skills ?? []).map((skill) => skill.id));
    expect([...["history", "arcana", "nature"]].every((id) => skills.has(id))).toBe(true);
    // The class's own skills are still there, so the subclass added to the budget: six skill
    // proficiencies plus the background's two.
    expect(skills.size).toBe(9);
    expect(() => build(bard(3, 15, loreSkills("history", "arcana")))).toThrowError(/Bonus Proficiencies/);
  });
});

describe("Words of Creation: the level-20 grant (audit row 34)", () => {
  it("hands a level-20 Bard both Power Words, always prepared and uncharged", () => {
    const definition = build(
      bard(20, 15, [...loreSkills("history", "arcana", "nature"), ...epicBoon("bard", "boon-of-spell-recall", "wis")])
    );
    expect(spellOf(definition, "power-word-heal")).toMatchObject({ alwaysPrepared: true });
    expect(spellOf(definition, "power-word-kill")).toMatchObject({ alwaysPrepared: true });
    // Neither Power Word counts against the prepared cap ("always have prepared").
    const charged = (definition.spellcasting?.spells ?? []).filter((spell) => spell.level > 0 && !spell.alwaysPrepared);
    expect(charged.map((spell) => spell.id)).not.toContain("power-word-kill");
    // The negative control: a level-19 Bard has neither.
    const nineteen = build(
      bard(19, 15, [...loreSkills("history", "arcana", "nature"), ...epicBoon("bard", "boon-of-spell-recall", "wis")])
    );
    expect(spellOf(nineteen, "power-word-kill")).toBeUndefined();
  });
});

// Cleric

describe("Divine Intervention: a pool that now costs the action the SRD prints", () => {
  const clericInput = (): Mutable =>
    ({
      name: "Sister Ael",
      speciesId: "human",
      backgroundId: "sage",
      classId: "cleric",
      level: 10,
      subclassId: "life-domain",
      abilityMethod: "standard-array",
      baseScores: { str: 10, dex: 12, con: 14, int: 8, wis: 15, cha: 13 },
      backgroundBonusAllocation: [
        { ability: "wis", amount: 2 },
        { ability: "con", amount: 1 }
      ],
      hp: { mode: "average" },
      choices: [
        { level: 1, kind: "language", id: "dwarvish" },
        { level: 1, kind: "language", id: "giant" },
        { level: 1, classId: "cleric", kind: "skill", id: "religion" },
        { level: 1, classId: "cleric", kind: "skill", id: "insight" },
        {
          level: 1,
          classId: "cleric",
          kind: "divine-order",
          id: "thaumaturge",
          payload: { featureId: "divine-order" }
        },
        { level: 1, kind: "cantrip", id: "guidance" },
        { level: 1, kind: "cantrip", id: "sacred-flame" },
        { level: 1, kind: "spell", id: "bless" },
        ...HUMAN,
        ...SAGE_FEAT,
        { level: 3, classId: "cleric", kind: "subclass", id: "life-domain" },
        {
          level: 7,
          classId: "cleric",
          kind: "blessed-strikes",
          id: "divine-strike",
          payload: { featureId: "blessed-strikes" }
        },
        ...asiRows("cleric", 10),
        { level: 1, kind: "equipment", id: "cleric-a" },
        { level: 1, kind: "equipment", id: "sage-a" }
      ]
    }) as Mutable;

  it("marks the DCs that are the cleric's spell save DC, so a spell-save-dc rider raises them", () => {
    const definition = build(clericInput());
    const spellDc = definition.spellcasting!.saveDc;
    // A cantrip and a Channel Divinity option both use the spell save DC.
    expect(actionOf(definition, "spell-sacred-flame")?.save).toMatchObject({ dc: spellDc, spellcasting: true });
    expect(actionOf(definition, "divine-spark")?.save).toMatchObject({ dc: spellDc, spellcasting: true });
  });

  it("is a Magic action with one use per Long Rest, and the use really goes", () => {
    // A feature with `uses` and no `actions` gets a synthesized action; the SRD says "As a Magic action".
    const definition = build(clericInput());
    const intervention = actionOf(definition, "divine-intervention");
    expect(intervention?.activation).toBe("action");
    expect(intervention?.uses).toEqual({ limit: 1, per: "long-rest" });
    const state = encounterWith(definition);
    resolveDefinitionAction(
      state,
      intervention!,
      { actorId: HERO, targetIds: [], commandId: command() },
      deps(definition)
    );
    expect(state.actors[0].actionUses["divine-intervention"]).toBe(1);
    expect(() =>
      resolveDefinitionAction(
        state,
        intervention!,
        { actorId: HERO, targetIds: [], commandId: command() },
        deps(definition)
      )
    ).toThrowError(/no uses remaining \(1\/Long Rest\)/);
  });
});

describe("Circle of the Land Spells: the chosen land's spells for the Druid's level and lower", () => {
  const alwaysPrepared = (level: number) =>
    (
      build(druid(level, [primalOrder("warden"), ...(level >= 7 ? [elementalFury("primal-strike")] : [])])).spellcasting
        ?.spells ?? []
    )
      .filter((spell) => spell.alwaysPrepared)
      .map((spell) => spell.id);

  it("gives a Polar Druid each row of the table as it reaches that level", () => {
    expect(alwaysPrepared(3)).toEqual(expect.arrayContaining(["fog-cloud", "hold-person", "ray-of-frost"]));
    expect(alwaysPrepared(3)).not.toContain("sleet-storm");
    const five = alwaysPrepared(5);
    expect(five).toContain("sleet-storm");
    expect(five).not.toContain("ice-storm");
    expect(alwaysPrepared(9)).toEqual(expect.arrayContaining(["sleet-storm", "ice-storm", "cone-of-cold"]));
  });

  it("describes each land with the spells the SRD table prints", () => {
    const lands = new Map(
      (
        library
          .subclassRecord("circle-of-the-land")!
          .features.find((feature) => feature.id === "circle-of-the-land-spells")!.choice!.options ?? []
      ).map((option) => [option.id, option.description])
    );
    expect(lands.get("arid")).toContain("Wall of Stone");
    expect(lands.get("arid")).not.toContain("Wall of Fire");
    expect(lands.get("polar")).toContain("Cone of Cold");
    expect(lands.get("polar")).not.toContain("Slow");
    expect(lands.get("temperate")).toContain("Tree Stride");
    expect(lands.get("temperate")).not.toContain("Ice Storm");
  });
});

describe("Magical Secrets: the Bard's own picks may come from three more lists", () => {
  // Spirit Guardians is a Cleric spell, on no Bard list.
  const guardians = { level: 10, kind: "spell", id: "spirit-guardians" } as Row;

  it("lets a Bard 10 prepare a Cleric spell as a Bard spell, and a Bard 9 not", () => {
    const skills = loreSkills("arcana", "history", "nature");
    const built = build(bard(10, 15, [...skills, guardians]));
    expect(spellOf(built, "spirit-guardians")).toMatchObject({ classId: "bard", alwaysPrepared: false });
    expect(() => build(bard(9, 15, [...skills, { ...guardians, level: 9 }]))).toThrowError(/"spirit-guardians"/);
  });

  it("adds no picks of its own: the Bard 10 prepares the printed number", () => {
    const built = build(bard(10, 15, loreSkills("arcana", "history", "nature")));
    expect(built.spellcasting?.classes?.[0]).toMatchObject({ classId: "bard", prepared: 15 });
  });
});

describe("Magical Discoveries: a spell the Bard has slots for", () => {
  it("refuses Wish to a Bard 6, whose highest slot is level 3", () => {
    const input = bard(6, 15);
    input.choices = [
      ...input.choices.filter((row) => row.payload?.featureId !== "magical-discoveries"),
      { level: 6, kind: "spell", id: "spiritual-weapon", payload: { featureId: "magical-discoveries" } },
      { level: 6, kind: "spell", id: "wish", payload: { featureId: "magical-discoveries" } }
    ] as Row[];
    expect(() => build(input)).toThrowError(
      '"wish" is level 9, above the maximum spell level (3) for "Magical Discoveries".'
    );
  });
});
