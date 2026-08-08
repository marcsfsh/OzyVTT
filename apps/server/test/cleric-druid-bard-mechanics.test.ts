import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";

/**
 * STAGE 4, LANE B3 - Cleric, Druid and Bard mechanics, held at the far end.
 *
 * Every assertion below is a number a player can act on, a counter the engine really spends, or a
 * refusal the server really issues: the cantrip a Magician may take that a Warden may not, the Wild
 * Shape pool going down and then saying no, the Bardic Inspiration die count that follows Charisma,
 * the damage Primal Strike rolls at level 7 and at level 15. "The rider survived derivation" is
 * deliberately never asserted on its own - that is the failure mode this whole area exists to end,
 * and a record that parses, validates and adds zero looks exactly like one that works.
 *
 * Written against the REAL bundles through a REAL `ContentLibrary`, so what is proved here is the
 * shipped content, not a fixture that agrees with it.
 */

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
const FOE = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d12";

type Row = CharacterCreateRequestInput["choices"][number];
type Mutable = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & { choices: Row[] };

/**
 * The ASI rows a class owes at every ASI level at or below `level` - noise every high-level build
 * needs. Deliberately spread across abilities nothing else asserts, so no score walks into the 20
 * ceiling and no assertion below depends on which ASI landed where.
 */
const ASI_ABILITIES = [["con", "dex"], ["con", "dex"], ["str", "int"], ["str", "int"]] as const;
const asiRows = (classId: string, level: number): Row[] =>
  [4, 8, 12, 16].filter((asi) => asi <= level).flatMap((asi, index) => ([
    { level: asi, classId, kind: "asi-or-feat", id: "ability-score-improvement" },
    { level: asi, kind: "ability-score", id: ASI_ABILITIES[index][0], payload: { featureId: "ability-score-improvement" } },
    { level: asi, kind: "ability-score", id: ASI_ABILITIES[index][1], payload: { featureId: "ability-score-improvement" } }
  ] as Row[]));

/** The Human's own two picks - Skillful's skill and Versatile's origin feat. Alert asks for nothing. */
const HUMAN: Row[] = [
  { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
  { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } }
];
/** The three picks the Sage's origin feat (Magic Initiate (Wizard)) asks for, on a Wisdom class. */
const SAGE_FEAT: Row[] = [
  { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
  { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
  { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } }
];
/** The same for the Acolyte's Magic Initiate (Cleric), on the Charisma class. */
const ACOLYTE_FEAT: Row[] = [
  { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
  { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
  { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } }
];

/**
 * A Druid of any level. `sage` is the background because it is one of the two that can raise Wisdom;
 * its origin feat's own three picks are tagged with their feature id, so they never touch the
 * untagged class budgets the assertions below count.
 */
const druid = (level: number, extra: Row[] = []): Mutable => ({
  name: "Maelin",
  speciesId: "human",
  backgroundId: "sage",
  classId: "druid",
  level,
  ...(level >= 3 ? { subclassId: "circle-of-the-land" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  backgroundBonusAllocation: [{ ability: "wis", amount: 2 }, { ability: "con", amount: 1 }],
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
    ...(level >= 3 ? [
      { level: 3, classId: "druid", kind: "subclass", id: "circle-of-the-land" },
      // Circle Spells is a REAL pick now (audit row 29's build-time half): "choose one type of land".
      // Nature's Ward reads this answer back at level 10 for its Resistance.
      { level: 3, kind: "land", id: "polar", payload: { featureId: "circle-of-the-land-spells" } }
    ] as Row[] : []),
    ...asiRows("druid", level),
    { level: 1, kind: "equipment", id: "druid-a" },
    { level: 1, kind: "equipment", id: "sage-a" },
    ...extra
  ]
} as Mutable);

const primalOrder = (id: "magician" | "warden"): Row =>
  ({ level: 1, classId: "druid", kind: "primal-order", id, payload: { featureId: "primal-order" } } as Row);
const elementalFury = (id: "potent-spellcasting" | "primal-strike"): Row =>
  ({ level: 7, classId: "druid", kind: "elemental-fury", id, payload: { featureId: "elemental-fury" } } as Row);
/** The level-19 Epic Boon pick, plus the ability point the chosen boon feat then asks for. */
const epicBoon = (classId: string, featId: string, ability: string): Row[] => ([
  { level: 19, classId, kind: "feat", id: featId, payload: { featureId: "epic-boon" } },
  { level: 19, kind: "ability-score", id: ability, payload: { featureId: featId } }
] as Row[]);

/**
 * A Bard of any level. `cha` is what Bardic Inspiration counts, so it is a parameter: 15 (+2 from
 * the Acolyte = 17, modifier +3) or 8 (modifier -1, which the authored `minimum` floors at 1).
 */
const bard = (level: number, cha: 8 | 15, extra: Row[] = []): Mutable => ({
  name: "Ysolde",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "bard",
  level,
  ...(level >= 3 ? { subclassId: "college-of-lore" } : {}),
  abilityMethod: "standard-array",
  baseScores: cha === 8
    ? { str: 12, dex: 14, con: 13, int: 10, wis: 15, cha: 8 }
    : { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  backgroundBonusAllocation: cha === 8
    ? [{ ability: "int", amount: 2 }, { ability: "wis", amount: 1 }]
    : [{ ability: "cha", amount: 2 }, { ability: "wis", amount: 1 }],
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
    ...(level >= 2 ? [
      { level: 2, classId: "bard", kind: "expertise", id: "performance", payload: { featureId: "expertise" } },
      { level: 2, classId: "bard", kind: "expertise", id: "persuasion", payload: { featureId: "expertise" } }
    ] as Row[] : []),
    ...(level >= 3 ? [{ level: 3, classId: "bard", kind: "subclass", id: "college-of-lore" }] as Row[] : []),
    ...(level >= 9 ? [
      { level: 9, classId: "bard", kind: "expertise", id: "deception", payload: { featureId: "expertise" } },
      { level: 9, classId: "bard", kind: "expertise", id: "stealth", payload: { featureId: "expertise" } }
    ] as Row[] : []),
    ...(level >= 10 ? [
      { level: 10, classId: "bard", kind: "spell", id: "hypnotic-pattern", payload: { featureId: "magical-secrets" } },
      { level: 10, classId: "bard", kind: "spell", id: "fear", payload: { featureId: "magical-secrets" } }
    ] as Row[] : []),
    // MAGICAL DISCOVERIES (audit row 56) - two spells drawn from the Cleric, Druid OR Wizard list,
    // which is the union slug `cleric-spells-or-druid-spells-or-wizard-spells`. Neither is on the
    // Bard list, which is the whole point of the feature.
    ...(level >= 6 ? [
      { level: 6, kind: "spell", id: "spiritual-weapon", payload: { featureId: "magical-discoveries" } },
      { level: 6, kind: "spell", id: "fireball", payload: { featureId: "magical-discoveries" } }
    ] as Row[] : []),
    ...asiRows("bard", level),
    { level: 1, kind: "equipment", id: "bard-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" },
    ...extra
  ]
} as Mutable);

const loreSkills = (...ids: string[]): Row[] =>
  ids.map((id) => ({ level: 3, kind: "skill", id, payload: { featureId: "bonus-proficiencies" } } as Row));

const build = (input: Mutable) => buildCharacterDefinition(input, library, policy);
const actionOf = (definition: ReturnType<typeof build>, id: string) => definition.actions.find((action) => action.id === id);
const spellOf = (definition: ReturnType<typeof build>, id: string) => (definition.spellcasting?.spells ?? []).find((spell) => spell.id === id);

/** An encounter where the FOE holds the turn, so the action-economy slot never masks a use gate. */
function encounterWith(definition: ReturnType<typeof build>): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, HERO, "public");
  state.actors.push({ ...state.actors[0], id: FOE, name: "Ghoul", kind: "monster", definitionId: undefined, actionUses: {} });
  startEncounter(state, { mapAssetId: "20000000-0000-5000-8000-000000000001", entries: [{ actorId: FOE, score: 20 }, { actorId: HERO, score: 5 }] }, () => 1, { width: 900, height: 600, calibration: null });
  return state;
}
let commandSeq = 0;
const deps = (definition: ReturnType<typeof build>): ResolveDependencies => ({
  random: () => 3, newRollId: () => `40000000-0000-4000-8000-00000000000${(commandSeq += 1) % 10}`,
  gmSessionId: "30000000-0000-4000-8000-00000000000a", now: () => "2026-07-27T00:00:00.000Z", definition
});
const command = () => `50000000-0000-4000-8000-0000000000${String((commandSeq += 1) % 90 + 10)}`;

// ═══ DRUID ══════════════════════════════════════════════════════════════════════════════════════

describe("Primal Order - the twin of the bug that started this area (audit row 4)", () => {
  it("lets a MAGICIAN take a third cantrip at level 1, and refuses a WARDEN the same one", () => {
    // The far end of `extraPicks`, stated as a refusal. The printed level-1 row says two cantrips;
    // Magician's text says "you know one extra cantrip from the Druid spell list". Before this the
    // record carried no `choice` at all, so neither role could even be taken.
    const third: Row = { level: 1, kind: "cantrip", id: "shillelagh" };
    const magician = build(druid(1, [primalOrder("magician"), third]));
    expect((magician.spellcasting?.spells ?? []).filter((spell) => spell.level === 0).map((spell) => spell.id))
      .toContain("shillelagh");
    // The negative control, in the same choice: a composition that gave EVERY Druid +1 would pass
    // the assertion above and be just as wrong.
    expect(() => build(druid(1, [primalOrder("warden"), third])))
      .toThrowError(/Druid knows 2 cantrips at level 1; got 3/);
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

describe("Druidic - a language and an always-prepared spell (audit row 35)", () => {
  const definition = build(druid(1, [primalOrder("magician")]));

  it("puts Druidic on the sheet and Speak with Animals in the spell list", () => {
    expect(definition.proficiencies?.languages).toContain("druidic");
    expect(spellOf(definition, "speak-with-animals")).toMatchObject({ alwaysPrepared: true, level: 1 });
  });

  it("does NOT charge the granted spell against the prepared budget", () => {
    // "Those spells don't count against the number of spells you can prepare." A level-1 Druid
    // prepares four: the grant PLUS four chosen spells is legal, and the fifth chosen one is not -
    // which is the only way to tell "uncharged" from "silently eating a slot".
    const four: Row[] = [{ level: 1, kind: "spell", id: "faerie-fire" }, { level: 1, kind: "spell", id: "fog-cloud" }];
    const full = build(druid(1, [primalOrder("magician"), ...four]));
    expect(spellOf(full, "speak-with-animals")?.alwaysPrepared).toBe(true);
    expect((full.spellcasting?.spells ?? []).filter((spell) => spell.level === 1 && !spell.alwaysPrepared).map((spell) => spell.id).sort())
      .toEqual(["cure-wounds", "entangle", "faerie-fire", "fog-cloud", "magic-missile"]); // 4 class + the Sage feat's own
    expect(() => build(druid(1, [primalOrder("magician"), ...four, { level: 1, kind: "spell", id: "thunderwave" } as Row])))
      .toThrowError(/Druid prepares 4 spells at level 1; got 5/);
  });
});

describe("Wild Shape - the pool, read off the printed column (audit row 54)", () => {
  it("counts uses off the Wild Shape column and grows with it", () => {
    // 2 at level 2, 3 at level 6, 4 at level 17 - the printed column, not a table copied beside it.
    expect(actionOf(build(druid(2, [primalOrder("warden")])), "wild-shape")?.uses)
      .toEqual({ limit: 2, per: "long-rest" });
    expect(actionOf(build(druid(6, [primalOrder("warden")])), "wild-shape")?.uses)
      .toEqual({ limit: 3, per: "long-rest" });
    expect(actionOf(build(druid(17, [primalOrder("warden"), elementalFury("primal-strike")])), "wild-shape")?.uses)
      .toEqual({ limit: 4, per: "long-rest" });
    // ...and it is a Bonus Action, which is what the SRD prints - not the "other" a synthesised
    // action would have carried.
    expect(actionOf(build(druid(2, [primalOrder("warden")])), "wild-shape")?.activation).toBe("bonus-action");
  });

  it("really spends the counter, twice, and then refuses the third", () => {
    // The bar: a spent counter and a refusal. A pool nothing decrements is decoration.
    const definition = build(druid(2, [primalOrder("warden")]));
    const state = encounterWith(definition);
    const shape = actionOf(definition, "wild-shape")!;
    resolveDefinitionAction(state, shape, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["wild-shape"]).toBe(1);
    resolveDefinitionAction(state, shape, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["wild-shape"]).toBe(2);
    expect(() => resolveDefinitionAction(state, shape, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition)))
      .toThrowError(/no uses remaining \(2\/long rest\)/);
  });
});

describe("Wild Companion - the level-2 Find Familiar", () => {
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
    // WIS 15 + 2 (background) = 17 -> +3, proficiency +2, so DC 13. The DC is DERIVED from the
    // character, which is the whole reason `FeatureSaveDc` names an ability instead of a number.
    expect(actionOf(definition, "lands-aid")?.save).toEqual({ ability: "con", dc: 13 });
    expect(actionOf(definition, "lands-aid")?.damage).toEqual([{ formula: "2d6", type: "necrotic" }]);
    expect(actionOf(build(druid(10, [primalOrder("warden"), elementalFury("primal-strike")])), "lands-aid")?.damage)
      .toEqual([{ formula: "3d6", type: "necrotic" }]);
    expect(actionOf(build(druid(14, [primalOrder("warden"), elementalFury("primal-strike")])), "lands-aid")?.damage)
      .toEqual([{ formula: "4d6", type: "necrotic" }]);
  });

  it("spends Wild Shape when it resolves, so the two features share one budget", () => {
    // Cast Land's Aid once and the Druid has ONE shape left, not two - which is the SRD's meaning of
    // "expend a use of your Wild Shape" and is invisible unless the key is shared.
    const state = encounterWith(definition);
    resolveDefinitionAction(state, actionOf(definition, "lands-aid")!, { actorId: HERO, targetIds: [FOE], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["wild-shape"]).toBe(1);
    resolveDefinitionAction(state, actionOf(definition, "wild-shape")!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["wild-shape"]).toBe(2);
    expect(() => resolveDefinitionAction(state, actionOf(definition, "lands-aid")!, { actorId: HERO, targetIds: [FOE], commandId: command() }, deps(definition)))
      .toThrowError(/no uses remaining \(2\/long rest\)/);
  });
});

describe("Elemental Fury - the twin of Blessed Strikes (audit row 5)", () => {
  it("rolls Primal Strike's 1d8 at level 7 and 2d8 at level 15, once per turn", () => {
    // The level-15 step is Improved Elemental Fury's DAMAGE half, said with `damageByLevel` rather
    // than a rider read back off the earlier answer - exactly as the shipped Cleric record says it.
    const seven = build(druid(7, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(actionOf(seven, "primal-strike")?.damage).toEqual([{ formula: "1d8", type: "lightning" }]);
    expect(actionOf(seven, "primal-strike")?.uses).toEqual({ limit: 1, per: "turn", pool: "primal-strike" });
    const fifteen = build(druid(15, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(actionOf(fifteen, "primal-strike")?.damage).toEqual([{ formula: "2d8", type: "lightning" }]);
  });

  it("gives the OTHER option no strike at all, and refuses an option that is on neither list", () => {
    const potent = build(druid(7, [primalOrder("warden"), elementalFury("potent-spellcasting")]));
    expect(actionOf(potent, "primal-strike")).toBeUndefined();
    const bogus = druid(7, [primalOrder("warden"),
      { level: 7, classId: "druid", kind: "elemental-fury", id: "storm-strike", payload: { featureId: "elemental-fury" } } as Row]);
    expect(() => build(bogus)).toThrowError(/not an offered option/);
  });

  it("refuses the build outright when the level-7 pick is missing", () => {
    // The half that makes the feature real: an unanswered pick is a rejection, not a silent skip.
    expect(() => build(druid(7, [primalOrder("warden")])))
      .toThrowError(/Elemental Fury/);
  });
});

describe("Nature's Sanctuary - the third feature on the one Wild Shape counter", () => {
  it("spends the same key at level 14, so three spenders share one budget", () => {
    const definition = build(druid(14, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(actionOf(definition, "natures-sanctuary")?.uses).toMatchObject({ pool: "wild-shape", limit: 3 });
    const state = encounterWith(definition);
    for (const id of ["natures-sanctuary", "lands-aid", "wild-shape"]) {
      resolveDefinitionAction(state, actionOf(definition, id)!, { actorId: HERO, targetIds: id === "lands-aid" ? [FOE] : [], commandId: command() }, deps(definition));
    }
    expect(state.actors[0].actionUses["wild-shape"]).toBe(3);
    expect(() => resolveDefinitionAction(state, actionOf(definition, "natures-sanctuary")!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition)))
      .toThrowError(/no uses remaining \(3\/long rest\)/);
  });
});

describe("Nature's Ward - the half of audit row 65 that is authorable", () => {
  it("makes a level-10 Circle of the Land Druid immune to Poisoned", () => {
    const ten = build(druid(10, [primalOrder("warden"), elementalFury("primal-strike")]));
    expect(ten.conditionImmunities).toContain("poisoned");
    // The negative control: the immunity arrives with the level-10 feature, not with the subclass.
    expect(build(druid(3, [primalOrder("warden")])).conditionImmunities ?? []).not.toContain("poisoned");
  });
});

describe("Epic Boon - the level-19 feat nine classes lost outright (audit row 6)", () => {
  it("makes a level-19 Druid pick one, and refuses a feat that is not an Epic Boon", () => {
    const taken = build(druid(19, [primalOrder("warden"), elementalFury("primal-strike"),
      ...epicBoon("druid", "boon-of-dimensional-travel", "cha")]));
    expect((taken.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-dimensional-travel");
    expect(() => build(druid(19, [primalOrder("warden"), elementalFury("primal-strike")])))
      .toThrowError(/Epic Boon/);
    const wrongFeat = druid(19, [primalOrder("warden"), elementalFury("primal-strike"),
      { level: 19, classId: "druid", kind: "feat", id: "grappler", payload: { featureId: "epic-boon" } } as Row]);
    expect(() => build(wrongFeat)).toThrowError(/not an offered option/);
  });

  it("does the same for the Bard", () => {
    const taken = build(bard(19, 15, [...loreSkills("history", "arcana", "nature"),
      ...epicBoon("bard", "boon-of-spell-recall", "wis")]));
    expect((taken.character?.feats ?? []).map((feat) => feat.id)).toContain("boon-of-spell-recall");
    expect(() => build(bard(19, 15, loreSkills("history", "arcana", "nature")))).toThrowError(/Epic Boon/);
  });
});

// ═══ BARD ═══════════════════════════════════════════════════════════════════════════════════════

describe("Bardic Inspiration - the counter the class is built around", () => {
  it("hands out as many dice as the Charisma modifier, and never fewer than one", () => {
    // "A number of times equal to your Charisma modifier (minimum of once)". CHA 15 + 2 = 17 -> +3;
    // CHA 8 -> -1, which the `minimum` floor turns into 1. A build that read the printed Bardic Die
    // column instead would resolve a dice string to zero uses and hand out nothing.
    expect(actionOf(build(bard(1, 15)), "bardic-inspiration")?.uses).toEqual({ limit: 3, per: "long-rest" });
    expect(actionOf(build(bard(1, 8)), "bardic-inspiration")?.uses).toEqual({ limit: 1, per: "long-rest" });
    expect(actionOf(build(bard(1, 15)), "bardic-inspiration")?.activation).toBe("bonus-action");
  });

  it("spends the die three times and then refuses the fourth", () => {
    const definition = build(bard(1, 15));
    const state = encounterWith(definition);
    const inspire = actionOf(definition, "bardic-inspiration")!;
    for (let spent = 1; spent <= 3; spent += 1) {
      resolveDefinitionAction(state, inspire, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
      expect(state.actors[0].actionUses["bardic-inspiration"]).toBe(spent);
    }
    expect(() => resolveDefinitionAction(state, inspire, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition)))
      .toThrowError(/no uses remaining \(3\/long rest\)/);
  });

  it("lets Cutting Words and Peerless Skill spend that SAME counter", () => {
    // College of Lore spends Bardic Inspiration dice; it does not have dice of its own. A separate
    // key would silently double a level-14 Bard's real budget.
    const definition = build(bard(14, 15, loreSkills("history", "arcana", "nature")));
    expect(actionOf(definition, "cutting-words")?.uses).toMatchObject({ pool: "bardic-inspiration", limit: 3 });
    expect(actionOf(definition, "peerless-skill")?.uses).toMatchObject({ pool: "bardic-inspiration", limit: 3 });
    expect(actionOf(definition, "cutting-words")?.activation).toBe("reaction");

    const state = encounterWith(definition);
    resolveDefinitionAction(state, actionOf(definition, "cutting-words")!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    resolveDefinitionAction(state, actionOf(definition, "peerless-skill")!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    resolveDefinitionAction(state, actionOf(definition, "bardic-inspiration")!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["bardic-inspiration"]).toBe(3);
    expect(() => resolveDefinitionAction(state, actionOf(definition, "cutting-words")!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition)))
      .toThrowError(/no uses remaining \(3\/long rest\)/);
  });
});

describe("College of Lore Bonus Proficiencies - three skills that were promised and never offered (audit row 19)", () => {
  it("puts all three on the sheet, and refuses a build that answers with two", () => {
    const definition = build(bard(3, 15, loreSkills("history", "arcana", "nature")));
    const skills = new Set((definition.proficiencies?.skills ?? []).map((skill) => skill.id));
    expect([...["history", "arcana", "nature"]].every((id) => skills.has(id))).toBe(true);
    // ...and the class's own three are still there, so the subclass added to the budget rather than
    // replacing it: six skill proficiencies plus the background's two.
    expect(skills.size).toBe(9);
    expect(() => build(bard(3, 15, loreSkills("history", "arcana")))).toThrowError(/Bonus Proficiencies/);
  });
});

describe("Words of Creation - the level-20 grant (audit row 34)", () => {
  it("hands a level-20 Bard both Power Words, always prepared and uncharged", () => {
    const definition = build(bard(20, 15, [...loreSkills("history", "arcana", "nature"),
      ...epicBoon("bard", "boon-of-spell-recall", "wis")]));
    expect(spellOf(definition, "power-word-heal")).toMatchObject({ alwaysPrepared: true });
    expect(spellOf(definition, "power-word-kill")).toMatchObject({ alwaysPrepared: true });
    // A level-9 spell on the sheet of a caster whose prepared budget is nowhere near spent: neither
    // Power Word charges the cap, which is what "always have prepared" means.
    const charged = (definition.spellcasting?.spells ?? []).filter((spell) => spell.level > 0 && !spell.alwaysPrepared);
    expect(charged.map((spell) => spell.id)).not.toContain("power-word-kill");
    // The negative control: a level-19 Bard has neither.
    const nineteen = build(bard(19, 15, [...loreSkills("history", "arcana", "nature"),
      ...epicBoon("bard", "boon-of-spell-recall", "wis")]));
    expect(spellOf(nineteen, "power-word-kill")).toBeUndefined();
  });
});

// ═══ CLERIC ═════════════════════════════════════════════════════════════════════════════════════

describe("Divine Intervention - a pool that now costs the action the SRD prints", () => {
  const clericInput = (): Mutable => ({
    name: "Sister Ael", speciesId: "human", backgroundId: "sage", classId: "cleric", level: 10,
    subclassId: "life-domain", abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 12, con: 14, int: 8, wis: 15, cha: 13 },
    backgroundBonusAllocation: [{ ability: "wis", amount: 2 }, { ability: "con", amount: 1 }],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "cleric", kind: "skill", id: "religion" },
      { level: 1, classId: "cleric", kind: "skill", id: "insight" },
      { level: 1, classId: "cleric", kind: "divine-order", id: "thaumaturge", payload: { featureId: "divine-order" } },
      { level: 1, kind: "cantrip", id: "guidance" },
      { level: 1, kind: "cantrip", id: "sacred-flame" },
      { level: 1, kind: "spell", id: "bless" },
      ...HUMAN,
      ...SAGE_FEAT,
      { level: 3, classId: "cleric", kind: "subclass", id: "life-domain" },
      { level: 7, classId: "cleric", kind: "blessed-strikes", id: "divine-strike", payload: { featureId: "blessed-strikes" } },
      ...asiRows("cleric", 10),
      { level: 1, kind: "equipment", id: "cleric-a" },
      { level: 1, kind: "equipment", id: "sage-a" }
    ]
  } as Mutable);

  it("is a Magic action with one use per long rest, and the use really goes", () => {
    // The feature carried `uses` and no `actions`, so the builder synthesised one - correctly, but
    // always as `activation: "other"`. The SRD says "As a Magic action".
    const definition = build(clericInput());
    const intervention = actionOf(definition, "divine-intervention");
    expect(intervention?.activation).toBe("action");
    expect(intervention?.uses).toEqual({ limit: 1, per: "long-rest" });
    const state = encounterWith(definition);
    resolveDefinitionAction(state, intervention!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition));
    expect(state.actors[0].actionUses["divine-intervention"]).toBe(1);
    expect(() => resolveDefinitionAction(state, intervention!, { actorId: HERO, targetIds: [], commandId: command() }, deps(definition)))
      .toThrowError(/no uses remaining \(1\/long rest\)/);
  });
});
