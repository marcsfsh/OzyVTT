import { describe, expect, it } from "vitest";
import type {
  ContentBackgroundSummary, ContentClassLevelRow, ContentClassSummary, ContentFeatureSummary,
  ContentSkillSummary, ContentSpeciesSummary, ContentSpellSummary
} from "@vtt/domain";
import type { BuilderCatalogs } from "../content/catalogs";
import { buildCreatePayload, computeOffers, emptyDraft, prunePicks, type BuilderDraft } from "./build-payload";

/**
 * `extraPicks` - a feature (or a chosen inline OPTION) that RAISES a pick budget.
 *
 * THE FAR END IS THE OFFER'S CAPACITY AND THE PAYLOAD IT PRODUCES, never "the field survived".
 * Every assertion below is a number the player can act on: how many cards the wizard will let them
 * fill, and how many rows the create payload then carries. A rider that parses, is stored, is
 * collected at exactly the right moment and adds zero is indistinguishable from a working one, and
 * that is the failure this whole vocabulary exists to end - so the tests are written to fail when
 * the composition is removed rather than when the plumbing is.
 *
 * Deliberately a SEPARATE FILE from `character-builder.test.tsx`: that one mounts the wizard and
 * asserts rendering, this one is pure offer arithmetic with no DOM at all.
 */

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

const feature = (over: Partial<ContentFeatureSummary> & Pick<ContentFeatureSummary, "id" | "name">): ContentFeatureSummary => ({
  level: null, description: "", tags: [], choice: null, choices: [], grantedAtLevels: [], extraPicks: [], ...over
});

const levelRow = (level: number, over: Partial<ContentClassLevelRow> = {}): ContentClassLevelRow => ({
  level, proficiencyBonus: 2, spellSlots: null, pactSlots: null, cantripsKnown: null,
  spellsKnown: null, preparedFormula: null, preparedCount: null, classResources: [], ...over
});

const CANTRIPS = ["Guidance", "Light", "Mending", "Resistance", "Sacred Flame", "Spare the Dying", "Thaumaturgy"];
const spell = (name: string, level: number): ContentSpellSummary => ({
  id: name.toLowerCase().replace(/ /g, "-"), name, level, school: "evocation",
  castingTime: "action", rangeText: "Touch", componentsText: "V, S", duration: "Instantaneous",
  concentration: false, ritual: false, attackRoll: false, rangeFeet: 120, description: `${name}.`, higherLevel: null,
  classes: ["cleric"], damageRoll: null, damageTypes: [], castingOptions: []
});
const spells: readonly ContentSpellSummary[] = [...CANTRIPS.map((name) => spell(name, 0)), spell("Bless", 1), spell("Cure Wounds", 1)];

const SKILL_IDS = ["insight", "perception", "survival", "history", "medicine", "religion"] as const;
const skills: readonly ContentSkillSummary[] = SKILL_IDS.map((id) => ({
  id, name: id.charAt(0).toUpperCase() + id.slice(1), description: "", ability: "wis"
}));

/**
 * Divine Order, as the SRD prints it and as the bundle now authors it: one pick between two roles,
 * where only Thaumaturge raises the cantrip budget. Protector is the negative control that lives in
 * the same choice, so "the +1 landed" and "every Cleric got a +1" cannot be confused.
 */
const divineOrder = feature({
  id: "divine-order", name: "Divine Order", level: 1, grantedAtLevels: [1],
  description: "You have dedicated yourself to one of the following sacred roles.",
  choice: {
    kind: "divine-order", choose: 1, from: ["protector", "thaumaturge"], fromCatalog: null, maxSpellLevel: null, minSpellLevel: null, fromPicks: null,
    options: [
      { id: "protector", name: "Protector", description: "Martial weapons and Heavy armor training.", requires: null, choice: null, choices: [], extraPicks: [] },
      { id: "thaumaturge", name: "Thaumaturge", description: "You know one extra cantrip from the Cleric spell list.", requires: null, choice: null, choices: [], extraPicks: [{ offer: "class-cantrips", amount: 1, scaling: null }] }
    ]
  }
});

const clericWith = (features: readonly ContentFeatureSummary[], over: Partial<ContentClassSummary> = {}): ContentClassSummary => ({
  id: "cleric", name: "Cleric", source: "srd", summary: "A priestly champion.",
  description: "Conduits for divine power.", hitDie: "d8",
  statPriority: ["wis"], primaryAbilities: ["wis"], savingThrows: ["wis", "cha"],
  skillChoiceCount: 2, skillChoices: ["history", "insight", "medicine", "religion"],
  armorProficiencies: ["light"], weaponProficiencies: ["simple"], toolProficiencies: [],
  toolChoices: null, multiclassProficiencies: null, multiclassPrerequisites: null,
  subclassLevel: 3, subclassLabel: "Cleric Subclass", asiLevels: [4],
  spellcastingAbility: "wis", spellcastingProgression: "full",
  spellcasting: { ability: "wis", prepares: "prepared", ritual: true, focus: null, progression: "full", spellListId: "cleric" },
  levelTable: [levelRow(1, { cantripsKnown: 3, spellSlots: [2], preparedCount: 4 })],
  startingEquipmentOptions: [], features, ...over
} as unknown as ContentClassSummary);

const human = {
  id: "human", name: "Human", source: "srd", summary: "Versatile.", description: "Humans.",
  sizes: ["medium"], speedFeet: 30, darkvisionFeet: null, creatureType: "humanoid",
  abilityBonuses: [], abilityBonusChoice: null, languages: ["common"], languageChoices: null,
  lineages: [], features: []
} as unknown as ContentSpeciesSummary;

const acolyte = {
  id: "acolyte", name: "Acolyte", source: "srd", summary: "A temple servant.", description: "You served in a temple.",
  abilityOptions: null, originFeatId: null, skillProficiencies: ["religion"], skillChoices: null,
  toolProficiencies: [], toolChoices: null, languages: [], languageChoices: null,
  startingEquipmentOptions: [], features: []
} as unknown as ContentBackgroundSummary;

const catalogsWith = (classRecord: ContentClassSummary, species: ContentSpeciesSummary = human): BuilderCatalogs => ({
  choice: { classes: [classRecord], subclasses: [], species: [species], feats: [], spells, equipment: [], skills, languages: [] },
  backgrounds: [acolyte], names: [], loaded: true, attributions: []
});

const draftWith = (picks: Record<string, readonly string[]> = {}): BuilderDraft => ({
  // `point-buy` so `baseScoresOf` reads `spendScores` (already filled by `emptyDraft`) rather than a
  // pool assignment these tests have no reason to make - the payload half needs six real scores.
  ...emptyDraft(), abilityMethod: "point-buy", speciesId: "human", backgroundId: "acolyte",
  classId: "cleric", level: 1, name: "Sister Ael", picks
});

const capacityOf = (offers: ReturnType<typeof computeOffers>, key: string) =>
  offers.find((offer) => offer.key === key)?.capacity;

// ── the reported bug ────────────────────────────────────────────────────────────────────────────

describe("a chosen OPTION raises the class cantrip budget (Divine Order -> Thaumaturge)", () => {
  const catalogs = catalogsWith(clericWith([divineOrder]));

  it("offers FOUR cantrips once Thaumaturge is the chosen role", () => {
    // The reported bug, at the far end: the wizard capped cantrip picks at the printed 3, so the
    // fourth cantrip Thaumaturge's own text promises could not be selected at all.
    const offers = computeOffers(draftWith({ "feature:divine-order": ["thaumaturge"] }), catalogs);
    expect(capacityOf(offers, "class-cantrips")).toBe(4);
  });

  it("offers THREE for Protector, and three before any role is chosen", () => {
    // The negative control. Without it, a composition that added +1 to every Cleric would pass the
    // test above and be just as wrong.
    expect(capacityOf(computeOffers(draftWith({ "feature:divine-order": ["protector"] }), catalogs), "class-cantrips")).toBe(3);
    expect(capacityOf(computeOffers(draftWith(), catalogs), "class-cantrips")).toBe(3);
  });

  it("lets the payload actually carry the fourth cantrip, and drops it again when the role changes", () => {
    // Capacity is only half the promise: the fourth pick has to survive into the create payload as a
    // real untagged class-cantrip row, which is what the server charges against its own budget.
    const picks = {
      "feature:divine-order": ["thaumaturge"],
      "class-cantrips": ["guidance", "light", "mending", "resistance"],
      "class-spells": ["bless"], "class-skills": ["history", "medicine"]
    };
    const draft = draftWith(picks);
    const chosen = buildCreatePayload(draft, computeOffers(draft, catalogs));
    const cantripRows = chosen.choices.filter((row) => row.kind === "cantrip" && !row.payload?.featureId);
    expect(cantripRows.map((row) => row.id)).toEqual(["guidance", "light", "mending", "resistance"]);

    // The composed capacity is also what `prunePicks` caps to, so switching to Protector takes the
    // budget back to 3 and drops the now-illegal fourth pick from the draft - the parked-draft path,
    // where a pick that is no longer offerable must not be silently submitted for the server to
    // refuse. The whole point of both sides agreeing is that this never reaches the wire.
    const swappedDraft = draftWith({ ...picks, "feature:divine-order": ["protector"] });
    const swappedOffers = computeOffers(swappedDraft, catalogs);
    expect(capacityOf(swappedOffers, "class-cantrips")).toBe(3);
    const pruned = prunePicks(swappedDraft, swappedOffers);
    expect(pruned.picks["class-cantrips"]).toEqual(["guidance", "light", "mending"]);
    expect(buildCreatePayload(pruned, swappedOffers).choices
      .filter((row) => row.kind === "cantrip" && !row.payload?.featureId)).toHaveLength(3);
    // ...and re-picking Thaumaturge keeps all four through the same prune.
    const keptDraft = draftWith(picks);
    expect(prunePicks(keptDraft, computeOffers(keptDraft, catalogs)).picks["class-cantrips"]).toHaveLength(4);
  });
});

// ── the general vocabulary ──────────────────────────────────────────────────────────────────────

describe("extraPicks composes across carriers and budgets", () => {
  it("SUMS two features that each grant +1 to the same budget", () => {
    // The composition requirement stated as arithmetic: nothing overwrites, so +1 and +1 is +2 and
    // the printed 3 becomes 5. A "last grant wins" implementation passes every single-grant test in
    // this file and fails only here.
    const blessing = feature({
      id: "extra-cantrip-blessing", name: "Blessing of Cantrips", level: 1, grantedAtLevels: [1],
      description: "You know one extra cantrip.", extraPicks: [{ offer: "class-cantrips", amount: 1, scaling: null }]
    });
    const offers = computeOffers(
      draftWith({ "feature:divine-order": ["thaumaturge"] }),
      catalogsWith(clericWith([divineOrder, blessing]))
    );
    expect(capacityOf(offers, "class-cantrips")).toBe(5);
  });

  it("reads a grant off a feature that asks for NO pick of its own", () => {
    // "You gain one additional skill from your class's list" has no card - only a bigger one on the
    // class step. Collecting grants inside the offer-building branch would drop exactly these,
    // because a feature with no `choice` never builds an offer.
    const scholar = feature({
      id: "temple-scholar", name: "Temple Scholar", level: 1, grantedAtLevels: [1],
      description: "You gain proficiency in one additional Cleric skill.",
      extraPicks: [{ offer: "class-skills", amount: 1, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([scholar])));
    expect(capacityOf(offers, "class-skills")).toBe(3); // the class prints 2
    expect(capacityOf(offers, "class-cantrips")).toBe(3); // and nothing else moved
  });

  it("raises a budget from a SPECIES trait, across the step boundary", () => {
    // The ordering case: `class-skills` is built in step 3 and a species trait is collected in step 1,
    // while `class-cantrips` is built in step 4 - after the trait. Applying grants as offers are
    // pushed would raise one and miss the other; applying them once every offer exists gets both.
    const gifted = {
      ...human, id: "gifted", name: "Gifted",
      features: [feature({
        id: "gifted-mind", name: "Gifted Mind",
        description: "One extra cantrip and one extra class skill.",
        extraPicks: [{ offer: "class-cantrips", amount: 1, scaling: null }, { offer: "class-skills", amount: 1, scaling: null }]
      })]
    } as unknown as ContentSpeciesSummary;
    const draft = { ...draftWith(), speciesId: "gifted" };
    const offers = computeOffers(draft, catalogsWith(clericWith([]), gifted));
    expect(capacityOf(offers, "class-cantrips")).toBe(4);
    expect(capacityOf(offers, "class-skills")).toBe(3);
  });

  it("raises a named FEATURE's own pick, and honours an amount above 1", () => {
    const expertise = feature({
      id: "expertise", name: "Expertise", level: 1, grantedAtLevels: [1],
      description: "Choose skills you are proficient in.",
      choice: { kind: "expertise", choose: 1, from: ["history", "medicine", "religion"], fromCatalog: null, maxSpellLevel: null, minSpellLevel: null, fromPicks: null, options: [] }
    });
    const devotion = feature({
      id: "deep-devotion", name: "Deep Devotion", level: 1, grantedAtLevels: [1],
      description: "You gain two more Expertise choices.",
      extraPicks: [{ offer: "feature:expertise", amount: 2, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([expertise, devotion])));
    expect(capacityOf(offers, "feature:expertise")).toBe(3);
  });

  it("raises the PREPARED-SPELL budget, which no second choice could express", () => {
    // There is no catalog slug meaning "your class's spell list at your slot level", so "you may
    // prepare one more spell" is unsayable as a nested choice and is only sayable as a budget.
    const zealot = feature({
      id: "zealous-study", name: "Zealous Study", level: 1, grantedAtLevels: [1],
      description: "You can prepare one additional Cleric spell.",
      extraPicks: [{ offer: "class-spells", amount: 1, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([zealot])));
    expect(capacityOf(offers, "class-spells")).toBe(5); // the level-1 row prints 4
  });

  it("ignores a grant naming a budget this build has no offer for", () => {
    // The wizard cannot reject content - the server owns that authority and refuses the build at
    // Create with an actionable message. What it must NOT do is crash, or move some other number.
    const confused = feature({
      id: "confused-gift", name: "Confused Gift", level: 1, grantedAtLevels: [1],
      description: "Grants a pick to a budget that does not exist here.",
      extraPicks: [{ offer: "background-tools", amount: 1, scaling: null }]
    });
    const offers = computeOffers(draftWith(), catalogsWith(clericWith([confused])));
    expect(offers.find((offer) => offer.key === "background-tools")).toBeUndefined();
    expect(capacityOf(offers, "class-cantrips")).toBe(3);
    expect(capacityOf(offers, "class-skills")).toBe(2);
  });
});

// ── a chosen option's OWN pick, and a pick over the character's own answers ──────────────────────

/**
 * Two things the wizard could not render, held at the far end of `computeOffers`: THE OFFER LIST.
 *
 * The first is an old gap and a bad one - the server has always turned a chosen inline option's own
 * `choice` into an offer (pass A2) and the wizard never did, so taking Blessed Warrior or Pact of
 * the Blade produced a build the server refused with "needs N pick(s)" and no card anywhere to
 * answer it. The second is ruling E: a pick whose options are the character's own prior answers.
 */
const optionChoice = (over: Partial<NonNullable<ContentFeatureSummary["choice"]>>): NonNullable<ContentFeatureSummary["choice"]> =>
  ({ kind: "cantrip", choose: 1, from: [], fromCatalog: null, maxSpellLevel: null, minSpellLevel: null, fromPicks: null, options: [], ...over });

describe("a chosen inline option's OWN pick becomes an offer (the server's pass A2, mirrored)", () => {
  const fightingStyle = feature({
    id: "fighting-style", name: "Fighting Style", level: 1, grantedAtLevels: [1],
    description: "Choose a style.",
    choice: optionChoice({
      kind: "fighting-style", from: ["blessed-warrior"],
      options: [{
        id: "blessed-warrior", name: "Blessed Warrior", description: "You learn two Cleric cantrips.",
        requires: null, choice: optionChoice({ kind: "cantrip", choose: 2, fromCatalog: "cleric-spells", maxSpellLevel: 0 }),
        choices: [], extraPicks: []
      }]
    })
  });
  const catalogs = catalogsWith(clericWith([fightingStyle]));

  it("offers nothing extra while the option is unpicked", () => {
    expect(computeOffers(draftWith(), catalogs).find((offer) => offer.key === "feature:blessed-warrior")).toBeUndefined();
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
    id: "agonizing-blast", name: "Agonizing Blast", level: 1, grantedAtLevels: [1],
    description: "Choose one of your known cantrips that deals damage.",
    choice: optionChoice({ kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "deals-damage" } })
  });
  // Two of the fixture's cantrips deal damage; the rest do not.
  const damaging = new Set(["sacred-flame", "spare-the-dying"]);
  const catalogs = {
    ...catalogsWith(clericWith([agonizing])),
    choice: {
      ...catalogsWith(clericWith([agonizing])).choice,
      spells: spells.map((entry) => damaging.has(entry.id) ? { ...entry, damageRoll: "1d8", damageTypes: ["radiant"] } : entry)
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
 * An ASI feature's levels stay SEPARATE decisions, whichever spelling holds its picks (U12).
 *
 * Each ASI level is its own decision — the player picks feat-or-scores separately at 4, 8, 12 — so
 * `computeOffers` must never hand two levels one key, or an answer at 4 satisfies the offer at 8.
 *
 * The singular spelling earns that with an ASI-specific `@<level>` suffix read off
 * `feature.choice.kind`, which was the only spelling a record could carry until `choices` became
 * authorable. A plural record has no `choice` at all, so that suffix stops applying — and the
 * levels stay separate anyway, because the multi-block path carries its own generic suffixes:
 * `/N` for the Nth choice block and `#N` for the Nth grant of the same feature.
 *
 * Written after chasing a suspected collision that turned out not to exist. It is kept because the
 * two spellings reach uniqueness by two different mechanisms, and only one of them is obvious from
 * reading the ASI code — a later change to either could merge the levels without touching the other.
 */
describe("an ASI feature's levels stay separate decisions, under either spelling", () => {
  const asiBlock = {
    kind: "asi-or-feat", choose: 1, from: [], fromCatalog: null,
    maxSpellLevel: null, minSpellLevel: null, fromPicks: null, options: []
  };
  const asiFeature = (over: Partial<ContentFeatureSummary>): ContentFeatureSummary => feature({
    id: "ability-score-improvement", name: "Ability Score Improvement",
    description: "Increase one ability score by 2, or take a feat.",
    grantedAtLevels: [4, 8], ...over
  });
  const keysFor = (features: readonly ContentFeatureSummary[]) =>
    computeOffers({ ...draftWith(), level: 8 }, catalogsWith(clericWith(features, { asiLevels: [4, 8] })))
      .map((offer) => offer.key)
      .filter((key) => key.startsWith("feature:ability-score-improvement"));

  it("names the level itself when the picks are stored SINGULAR", () => {
    expect(keysFor([asiFeature({ choice: asiBlock as never })]))
      .toEqual(["feature:ability-score-improvement@4", "feature:ability-score-improvement@8"]);
  });

  it("keeps every grant distinct when the picks are stored PLURAL — the shape U12 made authorable", () => {
    // Two blocks over two granted levels is four decisions, and all four must be addressable.
    // `@<level>` is absent here by construction; uniqueness comes from `/2` and `#2` instead.
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
