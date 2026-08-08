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
  concentration: false, ritual: false, description: `${name}.`, higherLevel: null,
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
    kind: "divine-order", choose: 1, from: ["protector", "thaumaturge"], fromCatalog: null, maxSpellLevel: null, minSpellLevel: null,
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
      choice: { kind: "expertise", choose: 1, from: ["history", "medicine", "religion"], fromCatalog: null, maxSpellLevel: null, minSpellLevel: null, options: [] }
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
