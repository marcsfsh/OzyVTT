import { describe, expect, it } from "vitest";
import type {
  ContentBackgroundSummary,
  ContentClassLevelRow,
  ContentClassSummary,
  ContentFeatureSummary,
  ContentSkillSummary,
  ContentSpeciesSummary,
  ContentSpellSummary
} from "@vtt/domain";
import type { BuilderCatalogs } from "../content/catalogs";
import { buildCreatePayload, computeOffers, emptyDraft, prunePicks, type BuilderDraft } from "./build-payload";

/**
 * `extraPicks`: a feature (or a chosen inline option) that raises a pick budget. Assertions are on
 * offer capacity and the resulting payload rows, so they fail if the composition is removed, not
 * just the plumbing. Pure offer arithmetic, no DOM.
 */

// Fixtures

const feature = (
  over: Partial<ContentFeatureSummary> & Pick<ContentFeatureSummary, "id" | "name">
): ContentFeatureSummary => ({
  level: null,
  description: "",
  tags: [],
  choice: null,
  choices: [],
  grantedAtLevels: [],
  extraPicks: [],
  ...over
});

const levelRow = (level: number, over: Partial<ContentClassLevelRow> = {}): ContentClassLevelRow => ({
  level,
  proficiencyBonus: 2,
  spellSlots: null,
  pactSlots: null,
  cantripsKnown: null,
  spellsKnown: null,
  preparedFormula: null,
  preparedCount: null,
  classResources: [],
  ...over
});

const CANTRIPS = ["Guidance", "Light", "Mending", "Resistance", "Sacred Flame", "Spare the Dying", "Thaumaturgy"];
const spell = (name: string, level: number): ContentSpellSummary => ({
  id: name.toLowerCase().replace(/ /g, "-"),
  name,
  level,
  school: "evocation",
  castingTime: "action",
  rangeText: "Touch",
  componentsText: "V, S",
  duration: "Instantaneous",
  concentration: false,
  ritual: false,
  attackRoll: false,
  rangeFeet: 120,
  description: `${name}.`,
  higherLevel: null,
  classes: ["cleric"],
  damageRoll: null,
  damageTypes: [],
  castingOptions: []
});
const spells: readonly ContentSpellSummary[] = [
  ...CANTRIPS.map((name) => spell(name, 0)),
  spell("Bless", 1),
  spell("Cure Wounds", 1)
];

const SKILL_IDS = ["insight", "perception", "survival", "history", "medicine", "religion"] as const;
const skills: readonly ContentSkillSummary[] = SKILL_IDS.map((id) => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  description: "",
  ability: "wis"
}));

/**
 * Divine Order as the SRD prints it: only Thaumaturge raises the cantrip budget. Protector is the
 * negative control in the same choice.
 */
const divineOrder = feature({
  id: "divine-order",
  name: "Divine Order",
  level: 1,
  grantedAtLevels: [1],
  description: "You have dedicated yourself to one of the following sacred roles.",
  choice: {
    kind: "divine-order",
    choose: 1,
    from: ["protector", "thaumaturge"],
    fromCatalog: null,
    maxSpellLevel: null,
    minSpellLevel: null,
    fromPicks: null,
    options: [
      {
        id: "protector",
        name: "Protector",
        description: "Martial weapons and Heavy armor training.",
        requires: null,
        choice: null,
        choices: [],
        extraPicks: []
      },
      {
        id: "thaumaturge",
        name: "Thaumaturge",
        description: "You know one extra cantrip from the Cleric spell list.",
        requires: null,
        choice: null,
        choices: [],
        extraPicks: [{ offer: "class-cantrips", amount: 1, scaling: null }]
      }
    ]
  }
});

const clericWith = (
  features: readonly ContentFeatureSummary[],
  over: Partial<ContentClassSummary> = {}
): ContentClassSummary =>
  ({
    id: "cleric",
    name: "Cleric",
    source: "srd",
    summary: "A priestly champion.",
    description: "Conduits for divine power.",
    hitDie: "d8",
    statPriority: ["wis"],
    primaryAbilities: ["wis"],
    savingThrows: ["wis", "cha"],
    skillChoiceCount: 2,
    skillChoices: ["history", "insight", "medicine", "religion"],
    armorProficiencies: ["light"],
    weaponProficiencies: ["simple"],
    toolProficiencies: [],
    toolChoices: null,
    multiclassProficiencies: null,
    multiclassPrerequisites: null,
    subclassLevel: 3,
    subclassLabel: "Cleric Subclass",
    asiLevels: [4],
    spellcastingAbility: "wis",
    spellcastingProgression: "full",
    spellcasting: {
      ability: "wis",
      prepares: "prepared",
      ritual: true,
      focus: null,
      progression: "full",
      spellListId: "cleric"
    },
    levelTable: [levelRow(1, { cantripsKnown: 3, spellSlots: [2], preparedCount: 4 })],
    startingEquipmentOptions: [],
    features,
    ...over
  }) as unknown as ContentClassSummary;

const human = {
  id: "human",
  name: "Human",
  source: "srd",
  summary: "Versatile.",
  description: "Humans.",
  sizes: ["medium"],
  speedFeet: 30,
  darkvisionFeet: null,
  creatureType: "humanoid",
  abilityBonuses: [],
  abilityBonusChoice: null,
  languages: ["common"],
  languageChoices: null,
  lineages: [],
  features: []
} as unknown as ContentSpeciesSummary;

const acolyte = {
  id: "acolyte",
  name: "Acolyte",
  source: "srd",
  summary: "A temple servant.",
  description: "You served in a temple.",
  abilityOptions: null,
  originFeatId: null,
  skillProficiencies: ["religion"],
  skillChoices: null,
  toolProficiencies: [],
  toolChoices: null,
  languages: [],
  languageChoices: null,
  startingEquipmentOptions: [],
  features: []
} as unknown as ContentBackgroundSummary;

const catalogsWith = (classRecord: ContentClassSummary, species: ContentSpeciesSummary = human): BuilderCatalogs => ({
  choice: {
    classes: [classRecord],
    subclasses: [],
    species: [species],
    feats: [],
    spells,
    equipment: [],
    skills,
    languages: []
  },
  backgrounds: [acolyte],
  names: [],
  loaded: true,
  attributions: []
});

const draftWith = (picks: Record<string, readonly string[]> = {}): BuilderDraft => ({
  // `point-buy` so `baseScoresOf` reads the prefilled `spendScores`; the payload needs six scores.
  ...emptyDraft(),
  abilityMethod: "point-buy",
  speciesId: "human",
  backgroundId: "acolyte",
  classId: "cleric",
  level: 1,
  name: "Sister Ael",
  picks
});

const capacityOf = (offers: ReturnType<typeof computeOffers>, key: string) =>
  offers.find((offer) => offer.key === key)?.capacity;

// Divine Order -> Thaumaturge

describe("a chosen OPTION raises the class cantrip budget (Divine Order -> Thaumaturge)", () => {
  const catalogs = catalogsWith(clericWith([divineOrder]));

  it("offers FOUR cantrips once Thaumaturge is the chosen role", () => {
    // Thaumaturge's text promises a fourth cantrip beyond the printed 3.
    const offers = computeOffers(draftWith({ "feature:divine-order": ["thaumaturge"] }), catalogs);
    expect(capacityOf(offers, "class-cantrips")).toBe(4);
  });

  it("offers THREE for Protector, and three before any role is chosen", () => {
    // Negative control: a composition adding +1 to every Cleric would pass the test above.
    expect(
      capacityOf(computeOffers(draftWith({ "feature:divine-order": ["protector"] }), catalogs), "class-cantrips")
    ).toBe(3);
    expect(capacityOf(computeOffers(draftWith(), catalogs), "class-cantrips")).toBe(3);
  });

  it("lets the payload actually carry the fourth cantrip, and drops it again when the role changes", () => {
    // The fourth pick must also reach the payload as an untagged class-cantrip row, which the server
    // charges against its own budget.
    const picks = {
      "feature:divine-order": ["thaumaturge"],
      "class-cantrips": ["guidance", "light", "mending", "resistance"],
      "class-spells": ["bless"],
      "class-skills": ["history", "medicine"]
    };
    const draft = draftWith(picks);
    const chosen = buildCreatePayload(draft, computeOffers(draft, catalogs));
    const cantripRows = chosen.choices.filter((row) => row.kind === "cantrip" && !row.payload?.featureId);
    expect(cantripRows.map((row) => row.id)).toEqual(["guidance", "light", "mending", "resistance"]);

    // `prunePicks` caps to the composed capacity, so switching to Protector drops the fourth pick
    // from the draft before it can reach the server.
    const swappedDraft = draftWith({ ...picks, "feature:divine-order": ["protector"] });
    const swappedOffers = computeOffers(swappedDraft, catalogs);
    expect(capacityOf(swappedOffers, "class-cantrips")).toBe(3);
    const pruned = prunePicks(swappedDraft, swappedOffers);
    expect(pruned.picks["class-cantrips"]).toEqual(["guidance", "light", "mending"]);
    expect(
      buildCreatePayload(pruned, swappedOffers).choices.filter(
        (row) => row.kind === "cantrip" && !row.payload?.featureId
      )
    ).toHaveLength(3);
    // ...and re-picking Thaumaturge keeps all four through the same prune.
    const keptDraft = draftWith(picks);
    expect(prunePicks(keptDraft, computeOffers(keptDraft, catalogs)).picks["class-cantrips"]).toHaveLength(4);
  });
});

// The general vocabulary

describe("extraPicks composes across carriers and budgets", () => {
  it("SUMS two features that each grant +1 to the same budget", () => {
    // Grants sum: +1 and +1 turns the printed 3 into 5. A "last grant wins" bug fails only here.
    const blessing = feature({
      id: "extra-cantrip-blessing",
      name: "Blessing of Cantrips",
      level: 1,
      grantedAtLevels: [1],
      description: "You know one extra cantrip.",
      extraPicks: [{ offer: "class-cantrips", amount: 1, scaling: null }]
    });
    const offers = computeOffers(
      draftWith({ "feature:divine-order": ["thaumaturge"] }),
      catalogsWith(clericWith([divineOrder, blessing]))
    );
    expect(capacityOf(offers, "class-cantrips")).toBe(5);
  });

  it("reads a grant off a feature that asks for NO pick of its own", () => {
    // A budget raise with no card of its own: a feature with no `choice` never builds an offer, so
    // grants must be collected outside that branch.
    const scholar = feature({
      id: "temple-scholar",
      name: "Temple Scholar",
      level: 1,
      grantedAtLevels: [1],
      description: "You gain proficiency in one additional Cleric skill.",
      extraPicks: [{ offer: "class-skills", amount: 1, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([scholar])));
    expect(capacityOf(offers, "class-skills")).toBe(3); // the class prints 2
    expect(capacityOf(offers, "class-cantrips")).toBe(3); // and nothing else moved
  });

  it("raises a budget from a SPECIES trait, across the step boundary", () => {
    // Ordering: `class-skills` is built in step 3, the species trait collected in step 1, and
    // `class-cantrips` built in step 4. Grants apply once every offer exists, so both are raised.
    const gifted = {
      ...human,
      id: "gifted",
      name: "Gifted",
      features: [
        feature({
          id: "gifted-mind",
          name: "Gifted Mind",
          description: "One extra cantrip and one extra class skill.",
          extraPicks: [
            { offer: "class-cantrips", amount: 1, scaling: null },
            { offer: "class-skills", amount: 1, scaling: null }
          ]
        })
      ]
    } as unknown as ContentSpeciesSummary;
    const draft = { ...draftWith(), speciesId: "gifted" };
    const offers = computeOffers(draft, catalogsWith(clericWith([]), gifted));
    expect(capacityOf(offers, "class-cantrips")).toBe(4);
    expect(capacityOf(offers, "class-skills")).toBe(3);
  });

  it("raises a named FEATURE's own pick, and honours an amount above 1", () => {
    const expertise = feature({
      id: "expertise",
      name: "Expertise",
      level: 1,
      grantedAtLevels: [1],
      description: "Choose skills you are proficient in.",
      choice: {
        kind: "expertise",
        choose: 1,
        from: ["history", "medicine", "religion"],
        fromCatalog: null,
        maxSpellLevel: null,
        minSpellLevel: null,
        fromPicks: null,
        options: []
      }
    });
    const devotion = feature({
      id: "deep-devotion",
      name: "Deep Devotion",
      level: 1,
      grantedAtLevels: [1],
      description: "You gain two more Expertise choices.",
      extraPicks: [{ offer: "feature:expertise", amount: 2, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([expertise, devotion])));
    expect(capacityOf(offers, "feature:expertise")).toBe(3);
  });

  it("raises the PREPARED-SPELL budget, which no second choice could express", () => {
    // No catalog slug means "your class's spell list at your slot level", so "prepare one more
    // spell" can only be expressed as a budget.
    const zealot = feature({
      id: "zealous-study",
      name: "Zealous Study",
      level: 1,
      grantedAtLevels: [1],
      description: "You can prepare one additional Cleric spell.",
      extraPicks: [{ offer: "class-spells", amount: 1, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([zealot])));
    expect(capacityOf(offers, "class-spells")).toBe(5); // the level-1 row prints 4
  });

  it("ignores a grant naming a budget this build has no offer for", () => {
    // The server rejects bad content at Create; the wizard must just not crash or move other numbers.
    const confused = feature({
      id: "confused-gift",
      name: "Confused Gift",
      level: 1,
      grantedAtLevels: [1],
      description: "Grants a pick to a budget that does not exist here.",
      extraPicks: [{ offer: "background-tools", amount: 1, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([confused])));
    expect(offers.find((offer) => offer.key === "background-tools")).toBeUndefined();
    expect(capacityOf(offers, "class-cantrips")).toBe(3);
    expect(capacityOf(offers, "class-skills")).toBe(2);
  });
});

// A chosen option's own pick, and a pick over the character's own answers

/**
 * A chosen inline option's own `choice` becomes an offer (Blessed Warrior, Pact of the Blade), as
 * on the server; and a pick whose options are the character's own prior answers.
 */
const optionChoice = (
  over: Partial<NonNullable<ContentFeatureSummary["choice"]>>
): NonNullable<ContentFeatureSummary["choice"]> => ({
  kind: "cantrip",
  choose: 1,
  from: [],
  fromCatalog: null,
  maxSpellLevel: null,
  minSpellLevel: null,
  fromPicks: null,
  options: [],
  ...over
});

describe("a chosen inline option's OWN pick becomes an offer (the server's pass A2, mirrored)", () => {
  const fightingStyle = feature({
    id: "fighting-style",
    name: "Fighting Style",
    level: 1,
    grantedAtLevels: [1],
    description: "Choose a style.",
    choice: optionChoice({
      kind: "fighting-style",
      from: ["blessed-warrior"],
      options: [
        {
          id: "blessed-warrior",
          name: "Blessed Warrior",
          description: "You learn two Cleric cantrips.",
          requires: null,
          choice: optionChoice({ kind: "cantrip", choose: 2, fromCatalog: "cleric-spells", maxSpellLevel: 0 }),
          choices: [],
          extraPicks: []
        }
      ]
    })
  });
  const catalogs = catalogsWith(clericWith([fightingStyle]));

  it("offers nothing extra while the option is unpicked", () => {
    expect(
      computeOffers(draftWith(), catalogs).find((offer) => offer.key === "feature:blessed-warrior")
    ).toBeUndefined();
  });

  it("offers the option's two cantrips the moment it IS picked - keyed the way the server keys it", () => {
    const offers = computeOffers(draftWith({ "feature:fighting-style": ["blessed-warrior"] }), catalogs);
    const nested = offers.find((offer) => offer.key === "feature:blessed-warrior");
    expect(nested, "Blessed Warrior's own cantrip pick must be rendered, or the build is unfinishable").toBeTruthy();
    expect(nested!.capacity).toBe(2);
    expect(nested!.featureId).toBe("blessed-warrior");
    expect(nested!.options.map((option) => option.id)).toContain("guidance");
    // A cantrip pick offers cantrips only, never the level-1 spells on the same list.
    expect(nested!.options.every((option) => option.level === 0)).toBe(true);
  });
});

describe("ruling E - `fromPicks` offers the character's own answers, narrowed by a closed predicate", () => {
  const agonizing = feature({
    id: "agonizing-blast",
    name: "Agonizing Blast",
    level: 1,
    grantedAtLevels: [1],
    description: "Choose one of your known cantrips that deals damage.",
    choice: optionChoice({ kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "deals-damage" } })
  });
  // Two of the fixture's cantrips deal damage; the rest do not.
  const damaging = new Set(["sacred-flame", "spare-the-dying"]);
  const catalogs = {
    ...catalogsWith(clericWith([agonizing])),
    choice: {
      ...catalogsWith(clericWith([agonizing])).choice,
      spells: spells.map((entry) =>
        damaging.has(entry.id) ? { ...entry, damageRoll: "1d8", damageTypes: ["radiant"] } : entry
      )
    }
  } as BuilderCatalogs;

  it("DEFERS while no cantrip has been chosen - an empty picker is never rendered", () => {
    const offer = computeOffers(draftWith(), catalogs).find((entry) => entry.key === "feature:agonizing-blast");
    expect(offer!.options).toHaveLength(0);
    expect(offer!.unresolvable).toMatch(/Nothing chosen for "class-cantrips" is deals damage yet/);
  });

  it("offers exactly the chosen cantrips that pass the predicate, and no others", () => {
    const draft = draftWith({ "class-cantrips": ["sacred-flame", "guidance", "light"] });
    const offer = computeOffers(draft, catalogs).find((entry) => entry.key === "feature:agonizing-blast");
    expect(offer!.unresolvable).toBeNull();
    expect(offer!.options.map((option) => option.id)).toEqual(["sacred-flame"]);
  });

  it("follows the answer as it changes - the list IS the ledger, not a catalog", () => {
    const draft = draftWith({ "class-cantrips": ["spare-the-dying", "sacred-flame", "light"] });
    const offer = computeOffers(draft, catalogs).find((entry) => entry.key === "feature:agonizing-blast");
    expect(offer!.options.map((option) => option.id)).toEqual(["spare-the-dying", "sacred-flame"]);
  });
});

/**
 * An ASI feature's levels stay separate decisions under either spelling. The singular `choice`
 * gets an ASI-specific `@<level>` key suffix; a plural `choices` record has no `choice`, and stays
 * unique through the generic `/N` (Nth choice block) and `#N` (Nth grant) suffixes instead.
 */
describe("an ASI feature's levels stay separate decisions, under either spelling", () => {
  const asiBlock = {
    kind: "asi-or-feat",
    choose: 1,
    from: [],
    fromCatalog: null,
    maxSpellLevel: null,
    minSpellLevel: null,
    fromPicks: null,
    options: []
  };
  const asiFeature = (over: Partial<ContentFeatureSummary>): ContentFeatureSummary =>
    feature({
      id: "ability-score-improvement",
      name: "Ability Score Improvement",
      description: "Increase one ability score by 2, or take a feat.",
      grantedAtLevels: [4, 8],
      ...over
    });
  const keysFor = (features: readonly ContentFeatureSummary[]) =>
    computeOffers({ ...draftWith(), level: 8 }, catalogsWith(clericWith(features, { asiLevels: [4, 8] })))
      .map((offer) => offer.key)
      .filter((key) => key.startsWith("feature:ability-score-improvement"));

  it("names the level itself when the picks are stored SINGULAR", () => {
    expect(keysFor([asiFeature({ choice: asiBlock as never })])).toEqual([
      "feature:ability-score-improvement@4",
      "feature:ability-score-improvement@8"
    ]);
  });

  it("keeps every grant distinct when the picks are stored PLURAL — the shape U12 made authorable", () => {
    // Two blocks over two granted levels is four decisions, all addressable via `/2` and `#2`.
    const keys = keysFor([asiFeature({ choices: [asiBlock, { ...asiBlock, kind: "feat" }] as never })]);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(keys.filter((key) => key.endsWith("#2"))).toHaveLength(2);
  });

  it("keeps the two grants of a ONE-block plural feature apart too", () => {
    const keys = keysFor([asiFeature({ choices: [{ ...asiBlock, kind: "feat" }] as never })]);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual(["feature:ability-score-improvement", "feature:ability-score-improvement#2"]);
  });
});
