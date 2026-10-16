import type {
  BuilderAbilityIncrease,
  BuilderOffer,
  BuilderOfferStep,
  BuilderOffersReply,
  BuilderOffersRequest,
  CatalogChoiceOption
} from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import { featurePicks } from "@vtt/content-srd-5.2.1";
import {
  CLASS_CANTRIP_BUDGET,
  CLASS_SPELL_BUDGET,
  classBudgetKey,
  classSpellOptions,
  levelOfPick,
  SPELLCASTING_ABILITY_KIND,
  surveyDraft,
  withinOfferSpellWindow,
  type ChoiceOffer,
  type DraftSurvey
} from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import { featHoldings, featPrerequisiteFailure } from "./feat-prerequisites.js";
import { sheetAbilityScores } from "./sheet-abilities.js";

/**
 * The character builder's offers for a draft (`builder:offers`): the survey `character.create` validates
 * against, laid out for the wizard. Each offer gets its step, one card per grant level, option names, and
 * the options this build cannot usefully take; the answers are pruned to what the build still offers and
 * turned into the ledger rows a create carries. The wizard computes none of this itself.
 */

/** The ASI's "raise two points instead of a feat" answer, carried as `payload.increases`. */
const ASI_SHORTHAND = "asi";
/** Offer kinds answered by a feat. */
const FEAT_KINDS: ReadonlySet<string> = new Set(["feat", "fighting-style", "asi-or-feat"]);
/** Proficiency kinds: holding one twice wastes the pick (the build merges duplicates). */
const HELD_KINDS: ReadonlySet<string> = new Set(["skill", "skill-or-tool", "expertise", "tool", "language"]);
/** The held kinds whose options grey once held. Expertise takes the inverse rule: it needs the proficiency. */
const PROVENANCE_KINDS: ReadonlySet<string> = new Set(["skill", "skill-or-tool", "tool", "language"]);
const STEP_ORDER: readonly BuilderOfferStep[] = ["species", "background", "class", "features", "equipment"];
/** Answers create offers (a chosen feat's own picks), and those answers more; a draft settles well inside this. */
const MAX_PASSES = 10;

const ABILITY_NAMES: Readonly<Record<string, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

type Picks = Readonly<Record<string, readonly string[]>>;
type Increases = Readonly<Record<string, readonly BuilderAbilityIncrease[]>>;

/** The offers for a draft, its answers pruned to them, and the ledger rows those answers make. */
export function builderOffers(request: BuilderOffersRequest, library: ContentView): BuilderOffersReply {
  const identity = {
    speciesId: request.speciesId,
    backgroundId: request.backgroundId,
    classId: request.classId,
    level: request.level,
    ...(request.classLevels ? { classLevels: request.classLevels } : {})
  };
  let picks: Picks = request.picks ?? {};
  let increases: Increases = request.asiIncreases ?? {};
  let offers: BuilderOffer[];
  if (request.choices) {
    // A stored ledger: one survey places every row, then each row is read back onto the card it answers.
    const rows = request.choices.filter((row) => row.level <= request.level);
    offers = offersFor(
      surveyDraft({ ...identity, ...subclassesInLedger(rows, request.classId), choices: rows }, library),
      library,
      {}
    );
    ({ picks, increases } = answersFromLedger(rows, offers));
  } else {
    offers = offersFor(surveyDraft({ ...identity, choices: [] }, library), library, {});
  }
  // A key with no offer yet keeps its answer in `picks`: a chosen feat's own picks only get an offer once
  // the feat itself has been surveyed.
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const kept = pruned(picks, offers);
    const choices = rowsOf(offers, kept, increases);
    const next = offersFor(
      surveyDraft({ ...identity, ...subclassesOf(offers, kept, request.classId), choices }, library),
      library,
      kept
    );
    const settled = JSON.stringify(next) === JSON.stringify(offers);
    offers = next;
    if (settled) break;
  }
  picks = pruned(picks, offers);
  const keys = new Set(offers.map((offer) => offer.key));
  increases = Object.fromEntries(Object.entries(increases).filter(([key]) => keys.has(key)));
  return {
    offers,
    picks,
    asiIncreases: increases,
    subclassId: subclassesOf(offers, picks, request.classId).subclassId ?? null,
    choices: rowsOf(offers, picks, increases),
    abilities: abilitiesOf(request, library)
  };
}

/** How the stored sheet a rebuild reads back made its scores, when the draft sent that sheet. */
function abilitiesOf(request: BuilderOffersRequest, library: ContentView): BuilderOffersReply["abilities"] {
  const { sheet, choices, speciesId, backgroundId, classId } = request;
  if (!sheet || !choices || !speciesId || !backgroundId || !classId) return null;
  const found = sheetAbilityScores(
    { speciesId, backgroundId, classId, level: sheet.level, abilityScores: sheet.abilityScores, choices },
    library
  );
  return found
    ? {
        abilityMethod: found.abilityMethod,
        baseScores: { ...found.baseScores },
        backgroundBonusAllocation: found.backgroundBonusAllocation.map((entry) => ({ ...entry })),
        derived: found.derived
      }
    : null;
}

/** Every class's subclass in a draft: the starting class's as `subclassId`, a later class's by its id. */
type DraftSubclasses = { subclassId?: string; subclassIds: Record<string, string> };

const subclassesBy = (answers: ReadonlyArray<{ classId: string | null; id: string }>, startingClassId?: string) => {
  const found: DraftSubclasses = { subclassIds: {} };
  for (const { classId, id } of answers) {
    if (classId === null || classId === startingClassId) found.subclassId ??= id;
    else found.subclassIds[classId] ??= id;
  }
  return found;
};

/** Each subclass offer's answer. */
const subclassesOf = (offers: readonly BuilderOffer[], picks: Picks, startingClassId?: string): DraftSubclasses =>
  subclassesBy(
    offers.flatMap((offer) => {
      const id = offer.kind === "subclass" ? picks[offer.key]?.[0] : undefined;
      return id ? [{ classId: offer.classId, id }] : [];
    }),
    startingClassId
  );

/** A stored ledger's subclass rows; a row naming no class is the starting class's. */
const subclassesInLedger = (rows: readonly CharacterChoice[], startingClassId?: string): DraftSubclasses =>
  subclassesBy(
    rows.filter((row) => row.kind === "subclass").map((row) => ({ classId: row.classId ?? null, id: row.id })),
    startingClassId
  );

/** Each offer's answers that it still takes: a listed option (or the ASI shorthand), within capacity. */
function pruned(picks: Picks, offers: readonly BuilderOffer[]): Record<string, readonly string[]> {
  const kept: Record<string, readonly string[]> = {};
  for (const offer of offers) {
    const legal = [...new Set(picks[offer.key] ?? [])].filter(
      (id) => (offer.kind === "asi-or-feat" && id === ASI_SHORTHAND) || offer.options.some((option) => option.id === id)
    );
    if (legal.length > 0) kept[offer.key] = legal.slice(0, offer.capacity);
  }
  return kept;
}

/** The ledger rows these answers make, one per pick, stamped with the offer's level, class and feature. */
function rowsOf(offers: readonly BuilderOffer[], picks: Picks, increases: Increases): CharacterChoice[] {
  return offers.flatMap((offer) =>
    (picks[offer.key] ?? []).map((id) => {
      const payload: Record<string, unknown> = {};
      if (offer.featureId) payload.featureId = offer.featureId;
      if (offer.kind === "asi-or-feat" && id === ASI_SHORTHAND) payload.increases = increases[offer.key] ?? [];
      return {
        level: offer.level,
        ...(offer.classId ? { classId: offer.classId } : {}),
        kind: offer.kind,
        id,
        ...(Object.keys(payload).length > 0 ? { payload } : {})
      };
    })
  );
}

/** A stored ledger's rows read back onto the cards they answer, matched on what a row records. */
function answersFromLedger(
  rows: readonly CharacterChoice[],
  offers: readonly BuilderOffer[]
): { picks: Picks; increases: Increases } {
  const picks: Record<string, readonly string[]> = {};
  const increases: Record<string, readonly BuilderAbilityIncrease[]> = {};
  for (const offer of offers) {
    const answers = rows
      .filter(
        (row) =>
          row.level === offer.level &&
          row.kind === offer.kind &&
          (row.classId ?? null) === offer.classId &&
          ((row.payload?.featureId as string | undefined) ?? null) === offer.featureId
      )
      .slice(0, offer.capacity);
    if (answers.length === 0) continue;
    picks[offer.key] = answers.map((row) => row.id);
    const asi = answers.find((row) => row.id === ASI_SHORTHAND)?.payload?.increases;
    if (Array.isArray(asi)) increases[offer.key] = asi as BuilderAbilityIncrease[];
  }
  return { picks, increases };
}

type Card = {
  -readonly [Key in keyof BuilderOffer]: BuilderOffer[Key];
};

/** The wizard's cards for one survey, in the order the steps show them. */
function offersFor(survey: DraftSurvey, library: ContentView, picks: Picks): BuilderOffer[] {
  const cards: Array<{ card: Card; source: ChoiceOffer | null }> = [];
  for (const offer of inDisplayOrder(survey.offers))
    for (const card of cardsOf(offer, survey)) cards.push({ card, source: offer });
  for (const card of fixedCards(survey)) cards.push({ card, source: null });
  // Within the species step the trait picks come first, then the languages and size lists.
  const rank = ({ card }: { card: Card }) =>
    STEP_ORDER.indexOf(card.step) * 2 + (card.step === "species" && card.featureId === null ? 1 : 0);
  cards.sort((left, right) => rank(left) - rank(right));

  // An answer indexes a card by key, so keys are unique: a feat taken twice repeats its offers.
  const used = new Set<string>();
  for (const { card } of cards) {
    let key = card.key;
    for (let copy = 2; used.has(key); copy += 1) key = `${card.key}#${copy}`;
    used.add(key);
    card.key = key;
  }
  markUnavailable(
    cards.map(({ card }) => card),
    survey,
    library,
    picks
  );
  // An option whose own prerequisite is unmet (a Warlock cantrip that deals damage) stays listed, greyed.
  for (const { card, source } of cards)
    if (source && source.unmet.size > 0)
      card.unavailable = { ...card.unavailable, ...Object.fromEntries(source.unmet) };
  greyRepeatedGrants(cards, picks);
  greyClassSpellsTakenElsewhere(
    cards.map(({ card }) => card),
    picks
  );
  greyExpertiseOutOfReach(
    cards.map(({ card }) => card),
    survey,
    picks
  );
  return cards.map(({ card }) => card);
}

/** Server offers with each chosen feat's or option's own picks directly beneath the offer it was chosen in. */
function inDisplayOrder(offers: readonly ChoiceOffer[]): ChoiceOffer[] {
  const keys = new Set(offers.map((offer) => offer.key));
  const children = new Map<string, ChoiceOffer[]>();
  const roots: ChoiceOffer[] = [];
  for (const offer of offers) {
    if (offer.parent !== null && keys.has(offer.parent))
      children.set(offer.parent, [...(children.get(offer.parent) ?? []), offer]);
    else roots.push(offer);
  }
  const ordered: ChoiceOffer[] = [];
  const seen = new Set<ChoiceOffer>();
  const visit = (offer: ChoiceOffer) => {
    if (seen.has(offer)) return;
    seen.add(offer);
    ordered.push(offer);
    for (const child of children.get(offer.key) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  for (const offer of offers) visit(offer);
  return ordered;
}

/**
 * One card per grant level: the server keeps a feature granted at several levels (an ASI at 4 and 8,
 * Expertise at 1 and 6) as one offer, but each level is its own decision, stamped with its own level so a
 * rebuild can tell them apart. Pick counts per level follow `levelOfPick`, as the generator stamps them.
 */
function cardsOf(offer: ChoiceOffer, survey: DraftSurvey): Card[] {
  const options = optionsOf(offer, survey);
  const grants = offer.levels.length > 0 ? offer.levels : [1];
  const perGrant = grants.map(
    (level) =>
      Array.from({ length: offer.capacity }, (_, index) => levelOfPick(offer, index)).filter((at) => at === level)
        .length
  );
  return grants.map((level, index) => ({
    // The ASI names its level; any other repeated grant takes `#n`, as a repeated offer does.
    key:
      offer.kind === "asi-or-feat"
        ? `${offer.key}@${level}`
        : index === 0 || grants.length === 1
          ? offer.key
          : `${offer.key}#${index + 1}`,
    step: offer.step,
    featureId: offer.featureId,
    kind: offer.kind,
    label: offer.label,
    help: offer.help,
    capacity: grants.length === 1 ? offer.capacity : perGrant[index],
    options,
    maxSpellLevel: offer.maxSpellLevel,
    maximum: offer.maximum,
    level,
    classId: offer.classId,
    unresolvable: offer.unresolvable,
    unavailable: null
  }));
}

/** An offer's options as cards: inside its spell window, a cantrip pick offering only cantrips, each named. A spell
 *  pick's window is its own floor: Magical Discoveries may take a cantrip, as the build accepts. */
function optionsOf(offer: ChoiceOffer, survey: DraftSurvey): CatalogChoiceOption[] {
  const options: CatalogChoiceOption[] = [];
  for (const id of offer.options) {
    const level = offer.optionLevels?.get(id);
    if (!withinOfferSpellWindow(offer, id)) continue;
    if (level !== undefined && offer.kind === "cantrip" && level !== 0) continue;
    options.push({
      id,
      name: offer.names.get(id) ?? nameOf(offer.kind, id, survey),
      ...(level !== undefined ? { level } : {})
    });
  }
  return options;
}

/** A bare option id's name, read from the catalog its kind draws on. */
function nameOf(kind: string, id: string, survey: DraftSurvey): string {
  const { catalogs } = survey;
  const named =
    kind === "skill" || kind === "expertise" || kind === "skill-or-tool"
      ? catalogs.skills.find((skill) => skill.id === id)?.name
      : kind === "spell" || kind === "cantrip"
        ? catalogs.spells.find((spell) => spell.id === id)?.name
        : kind === "language"
          ? catalogs.languages.find((language) => language.id === id)?.name
          : kind === "ability-score" || kind === SPELLCASTING_ABILITY_KIND
            ? ABILITY_NAMES[id]
            : undefined;
  return named ?? titleCase(id);
}

const titleCase = (slug: string): string =>
  slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** The picks the class tables and the starting gear ask for, which the build reads outside its offers. */
function fixedCards(survey: DraftSurvey): Card[] {
  const { classRecord, background, species } = survey;
  const cards: Card[] = [];
  const card = (
    fields: Pick<Card, "key" | "step" | "kind" | "label" | "capacity" | "options" | "classId"> & Partial<Card>
  ) =>
    cards.push({
      featureId: null,
      help: null,
      maxSpellLevel: null,
      maximum: null,
      level: 1,
      unresolvable: null,
      unavailable: null,
      ...fields
    });
  if (species && species.sizes.length > 1)
    card({
      key: "species-size",
      step: "species",
      kind: "size",
      label: "Size",
      capacity: 1,
      options: species.sizes.map((size) => ({ id: size, name: titleCase(size) })),
      classId: null
    });
  // Each casting class prepares from its own list and its own columns, as if single-classed (SRD Multiclassing); its
  // picks are stamped at the level the class was taken. The printed columns plus what features granted
  // (Thaumaturge's extra cantrip).
  for (const budget of survey.classSpells) {
    const list = classSpellOptions(budget, survey.catalogs);
    const key = (base: string) => classBudgetKey(base, budget.classId, classRecord?.id ?? null);
    if (budget.printedCantrips > 0)
      card({
        key: key(CLASS_CANTRIP_BUDGET),
        step: "features",
        kind: "cantrip",
        label: `${budget.className} cantrips`,
        capacity: budget.cantrips,
        options: list.options.filter((option) => option.level === 0),
        maxSpellLevel: 0,
        level: budget.takenAt,
        classId: budget.classId,
        unresolvable: list.unresolvable
      });
    if (budget.printedPrepared > 0 && budget.maxSlotLevel > 0)
      card({
        key: key(CLASS_SPELL_BUDGET),
        step: "features",
        kind: "spell",
        label:
          budget.casting.prepares === "known"
            ? `${budget.className} spells known`
            : `${budget.className} prepared spells`,
        capacity: budget.prepared,
        options: list.options.filter(
          (option) => (option.level ?? 0) >= 1 && (option.level ?? 0) <= budget.maxSlotLevel
        ),
        maxSpellLevel: budget.maxSlotLevel,
        level: budget.takenAt,
        classId: budget.classId,
        unresolvable: list.unresolvable
      });
  }
  if (classRecord && classRecord.startingEquipment.length > 0)
    card({
      key: "class-equipment",
      step: "equipment",
      kind: "equipment",
      label: `${classRecord.name} starting equipment`,
      capacity: 1,
      options: classRecord.startingEquipment.map((option) => ({ id: option.id, name: option.label })),
      classId: classRecord.id
    });
  if (background && background.startingEquipment.length > 0)
    card({
      key: "background-equipment",
      step: "equipment",
      kind: "equipment",
      label: `${background.name} starting equipment`,
      capacity: 1,
      options: background.startingEquipment.map((option) => ({ id: option.id, name: option.label })),
      classId: null
    });
  return cards;
}

/**
 * Walks the cards in order and greys what an earlier answer already holds. A feat already held leaves a
 * later feat list unless it may repeat (Magic Initiate repeats only with another spell list), and so does a
 * feat whose level prerequisite this card's level does not reach; one needing a feature the build lacks is
 * disabled with its prerequisite (ability minimums need the scores, which the build checks). A proficiency
 * held from the background or an earlier pick is disabled with where it came from. An answer never greys its
 * own card, so it stays tappable to undo.
 */
function markUnavailable(cards: Card[], survey: DraftSurvey, library: ContentView, picks: Picks): void {
  const heldFeats = new Set<string>(survey.originFeat ? [survey.originFeat.id] : []);
  const repeats = (id: string) => {
    const feat = library.featRecord(id);
    return (
      feat?.repeatable === true &&
      !featurePicks(feat.feature).some((pick) => pick.fromCatalog?.endsWith("-spells") ?? false)
    );
  };
  // Every fixed source the build merges with the picks, so a pick it would refuse as a repeat is greyed here.
  const heldProficiencies = new Map<string, string>();
  const hold = (ids: readonly string[], source: string) => {
    for (const id of ids) if (!heldProficiencies.has(id)) heldProficiencies.set(id, `already granted by ${source}`);
  };
  const { background, classRecord, species } = survey;
  if (background) {
    hold(background.skillProficiencies, background.name);
    hold(background.toolProficiencies, background.name);
    hold(background.languages, background.name);
  }
  if (classRecord) hold(classRecord.toolProficiencies, classRecord.name);
  for (const { record } of survey.classes.slice(1)) hold(record.multiclassProficiencies?.tools ?? [], record.name);
  if (species) hold(species.languages, species.name);
  for (const { record } of survey.granted) {
    // Only ungated grants are baked into the sheet, so only they make a pick a repeat.
    if (!record.grants || (record.grants.when?.length ?? 0) > 0) continue;
    hold([...record.grants.skills, ...record.grants.tools, ...record.grants.languages], record.name);
  }
  const holdings = featHoldings(survey);
  for (const card of cards) {
    if (FEAT_KINDS.has(card.kind)) {
      const levelReached = (id: string) => {
        const needs = library.featRecord(id)?.prerequisite?.level;
        return needs === undefined || needs <= card.level;
      };
      card.options = card.options.filter(
        (option) =>
          option.id === ASI_SHORTHAND || ((!heldFeats.has(option.id) || repeats(option.id)) && levelReached(option.id))
      );
      const unmet: Record<string, string> = {};
      for (const option of card.options) {
        const feat = option.id === ASI_SHORTHAND ? undefined : library.featRecord(option.id);
        const failure = feat ? featPrerequisiteFailure(feat, { ...holdings, level: card.level, scores: null }) : null;
        if (failure) unmet[option.id] = failure.replace(/\.$/, "");
      }
      if (Object.keys(unmet).length > 0) card.unavailable = { ...card.unavailable, ...unmet };
    }
    if (PROVENANCE_KINDS.has(card.kind)) {
      const held: Record<string, string> = {};
      for (const option of card.options) {
        const reason = heldProficiencies.get(option.id);
        if (reason) held[option.id] = reason;
      }
      card.unavailable = held;
    }
    const answers = picks[card.key] ?? [];
    if (FEAT_KINDS.has(card.kind)) for (const id of answers) if (id !== ASI_SHORTHAND) heldFeats.add(id);
    if (HELD_KINDS.has(card.kind))
      for (const id of answers)
        if (!heldProficiencies.has(id)) heldProficiencies.set(id, `already chosen for "${card.label}"`);
  }
}

/** The grants of one feature share one offer server-side, which refuses an id twice unless repeatable, so
 *  a later grant's card greys what an earlier one took. */
function greyRepeatedGrants(cards: ReadonlyArray<{ card: Card; source: ChoiceOffer | null }>, picks: Picks): void {
  const spent = new Map<ChoiceOffer, Map<string, string>>();
  for (const { card, source } of cards) {
    if (!source || source.levels.length < 2 || source.repeatable) continue;
    const earlier = spent.get(source) ?? new Map<string, string>();
    const merged: Record<string, string> = { ...card.unavailable };
    for (const option of card.options) {
      const reason = earlier.get(option.id);
      if (reason && !merged[option.id]) merged[option.id] = reason;
    }
    if (Object.keys(merged).length > 0 || card.unavailable) card.unavailable = merged;
    for (const id of picks[card.key] ?? [])
      if (id !== ASI_SHORTHAND && !earlier.has(id))
        earlier.set(id, `already chosen for ${card.label} at level ${card.level}`);
    spent.set(source, earlier);
  }
}

/** A spell sits on the sheet once, so a multiclass build's class spell cards grey what another class's card took. */
function greyClassSpellsTakenElsewhere(cards: Card[], picks: Picks): void {
  const classSpellCards = cards.filter(
    (card) => card.featureId === null && (card.kind === "cantrip" || card.kind === "spell") && card.classId !== null
  );
  if (new Set(classSpellCards.map((card) => card.classId)).size < 2) return;
  for (const card of classSpellCards) {
    const taken: Record<string, string> = {};
    for (const other of classSpellCards) {
      if (other.classId === card.classId) continue;
      for (const id of picks[other.key] ?? []) taken[id] ??= `already chosen for ${other.label}`;
    }
    const greyed = Object.fromEntries(
      Object.entries(taken).filter(([id]) => card.options.some((option) => option.id === id))
    );
    if (Object.keys(greyed).length > 0) card.unavailable = { ...greyed, ...card.unavailable };
  }
}

/**
 * Greys the expertise options this build is not proficient in (expertise needs the proficiency, which the
 * build checks over every source). Never greys a whole list into a dead end: then it stays open and the
 * build's own refusal explains.
 */
function greyExpertiseOutOfReach(cards: Card[], survey: DraftSurvey, picks: Picks): void {
  if (!cards.some((card) => card.kind === "expertise")) return;
  const skillIds = new Set(survey.catalogs.skills.map((skill) => skill.id));
  const proficient = new Set<string>(survey.background?.skillProficiencies ?? []);
  for (const { record } of survey.granted) for (const skill of record.grants?.skills ?? []) proficient.add(skill);
  for (const card of cards) {
    if (card.kind !== "skill" && card.kind !== "skill-or-tool") continue;
    for (const id of picks[card.key] ?? []) if (card.kind === "skill" || skillIds.has(id)) proficient.add(id);
  }
  for (const card of cards) {
    if (card.kind !== "expertise") continue;
    const outOfReach: Record<string, string> = {};
    for (const option of card.options)
      if (!proficient.has(option.id)) outOfReach[option.id] = "not one of your proficiencies";
    if (Object.keys(outOfReach).length === card.options.length) continue;
    card.unavailable = { ...outOfReach, ...card.unavailable };
  }
}
