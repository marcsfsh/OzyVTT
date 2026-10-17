import type { BuilderOfferStep, BuilderPolicy } from "@vtt/domain";
import {
  CatalogChoiceError,
  classResourceGrowth,
  extraPickAmount,
  resolveCatalogChoice,
  resolvePickChoice,
  withArticle,
  type CatalogChoiceCatalogs,
  type CatalogChoiceOption
} from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES,
  ABILITY_ROLL_FORMULA,
  isPointBuyLegal,
  multiclassCasterLevel,
  multiclassSpellSlots,
  proficiencyBonusForLevel,
  STANDARD_ARRAY,
  validateAbilityFormula,
  type Ability,
  type ClassProgressionTable
} from "@vtt/rules-5e";
import type {
  BackgroundReference,
  ClassLevelRow,
  ClassReference,
  ContentSpellcasting,
  FeatReference,
  FeatureOption,
  FeatureRecord,
  SpeciesReference,
  SubclassReference
} from "@vtt/content-srd-5.2.1";
import { featurePicks, NAMED_PICK_BUDGET_KEYS } from "@vtt/content-srd-5.2.1";
import type { CharacterCreateRequestInput } from "./character-build.js";
import type { ContentView } from "./content-library.js";
import type { CharacterFeatureRef } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * The offer survey: everything the content asks a build to pick, with its legal options, and the ledger
 * matched against it. `buildCharacterDefinition` runs it before assembling a sheet, the random generator
 * answers it, and the wizard is served it, so all three agree on what a build may choose.
 */

/** Where a granted feature came from, for `definition.character.features`. `null` = already recorded on `character.feats`. */
export type CharacterFeatureOrigin = Readonly<{ kind: CharacterFeatureRef["kind"]; sourceId: string }>;

/** A feature the build holds, with the class whose level scales it (null for species, background and feat features). */
export type GrantedFeature = Readonly<{
  record: FeatureRecord;
  count: number;
  origin: CharacterFeatureOrigin | null;
  classId: string | null;
}>;

/** The most classes a sheet records (`CharacterIdentitySchema`). */
export const MAX_CLASSES = 4;

/** One class of a build, in the order first taken; the first is the starting class. */
export type BuildClass = Readonly<{
  record: ClassReference;
  /** This class's own level. */
  level: number;
  subclass: SubclassReference | null;
  /** The character level each of its levels arrived at: index 0 is its level 1. */
  characterLevels: readonly number[];
  /** Its own table row at its level: what its features, slots and spell budgets read. */
  row: ClassLevelRow;
}>;

/** The class each character level went to, in order: index 0 is level 1, the starting class. */
export type ClassSequenceInput = Readonly<{ classId: string; level: number; classLevels?: readonly string[] }>;

/** A build's class sequence, checked: `classLevels` when given, else the one class at every level. */
export function classSequenceOf(input: ClassSequenceInput): string[] {
  const sequence = input.classLevels
    ? [...input.classLevels]
    : Array.from({ length: input.level }, () => input.classId);
  if (sequence.length !== input.level)
    reject(`The class levels name ${sequence.length} levels, but the character is level ${input.level}.`);
  if (sequence[0] !== input.classId)
    reject(`The first level must be the starting class "${input.classId}", not "${sequence[0]}".`);
  if (new Set(sequence).size > MAX_CLASSES) reject(`A character can have at most ${MAX_CLASSES} classes.`);
  return sequence;
}

/** The ledger row recording which class each level went to, so a multiclass rebuild keeps its order. */
export const CLASS_LEVELS_KIND = "class-levels";

/** The class sequence a stored ledger recorded, or null when it records none (a single-class sheet). */
export function storedClassSequence(choices: readonly CharacterChoice[]): string[] | null {
  const recorded = choices.find((row) => row.kind === CLASS_LEVELS_KIND)?.payload?.classes;
  return Array.isArray(recorded) && recorded.length > 0 && recorded.every((id) => typeof id === "string")
    ? (recorded as string[])
    : null;
}

/** The ledger row for a multiclass sequence; a single-class build records none. */
export function classLevelsRow(sequence: readonly string[]): CharacterChoice | null {
  return new Set(sequence).size > 1
    ? { level: 1, kind: CLASS_LEVELS_KIND, id: sequence[0], payload: { classes: [...sequence] } }
    : null;
}

/** The build's classes from its sequence, each resolved and with the character levels it took. */
function buildClassesOf(
  sequence: readonly string[],
  library: ContentView,
  subclassFor: (record: ClassReference, level: number) => SubclassReference | null
): BuildClass[] {
  const ids = [...new Set(sequence)];
  return ids.map((id) => {
    const record = library.classRecord(id) ?? reject(`No class "${id}" is in the content catalog.`);
    const characterLevels = sequence.flatMap((classId, index) => (classId === id ? [index + 1] : []));
    return {
      record,
      level: characterLevels.length,
      subclass: subclassFor(record, characterLevels.length),
      characterLevels,
      row: record.levelTable[characterLevels.length - 1]
    };
  });
}

/** A casting class of the build: what casts its spells, and how its levels count toward shared slots. */
export type BuildCaster = Readonly<{ entry: BuildClass; casting: ContentSpellcasting }>;

/** The build's classes that cast: a subclass's own spellcasting (a third caster) wins over its class's. */
export function castersOf(classes: readonly BuildClass[]): BuildCaster[] {
  return classes.flatMap((entry) => {
    const casting = entry.subclass?.spellcasting ?? entry.record.spellcasting;
    return casting ? [{ entry, casting }] : [];
  });
}

type SlotMaximum = { level: number; max: number };

/**
 * The build's spell slots (SRD Multiclassing, Spell Slots). One class with the Spellcasting feature reads its own
 * table. Two or more add their levels (Bard, Cleric, Druid, Sorcerer and Wizard all of them, Paladin and Ranger half
 * rounded up, a homebrew class by its own progression) and read the Multiclass Spellcaster table. Pact Magic is a
 * pool of its own, never spell slots, whatever classes stand beside it.
 */
export function spellSlotsOf(classes: readonly BuildClass[]): { slots: SlotMaximum[]; pact: SlotMaximum | null } {
  const casters = castersOf(classes);
  const spellcasters = casters.filter((caster) => caster.casting.multiclassProgression !== "pact");
  const pactRow = casters.find((caster) => caster.casting.multiclassProgression === "pact")?.entry.row.pactSlots;
  const pact = pactRow && pactRow.slots > 0 ? { level: pactRow.level, max: pactRow.slots } : null;
  const counts =
    spellcasters.length >= 2
      ? multiclassSpellSlots(
          multiclassCasterLevel(
            spellcasters.map((caster) => ({
              classId: caster.entry.record.id,
              level: caster.entry.level,
              casterProgression: caster.casting.multiclassProgression
            }))
          )
        )
      : (spellcasters[0]?.entry.row.spellSlots ?? []);
  const slots = counts.map((count, index) => ({ level: index + 1, max: count })).filter((slot) => slot.max > 0);
  return { slots, pact };
}

/** The highest spell slot level a build casts with, pact slots included. */
export function highestSlotLevelOf(classes: readonly BuildClass[]): number {
  const { slots, pact } = spellSlotsOf(classes);
  return slots.reduce((highest, slot) => Math.max(highest, slot.level), pact?.level ?? 0);
}

/** A `class-*` budget for one class: the starting class keeps the plain key, a later class's is suffixed with its id.
 *  Any other key names the same budget for every class. */
export function classBudgetKey(budget: string, classId: string | null, startingClassId: string | null): string {
  return !budget.startsWith("class-") || classId === null || classId === startingClassId
    ? budget
    : `${budget}:${classId}`;
}

/** The named budget a class-suffixed key belongs to ("class-cantrips:wizard" is "class-cantrips"). */
const budgetOfKey = (key: string): string => (key.startsWith("class-") ? key.replace(/:.*$/, "") : key);

function reject(message: string): never {
  throw new CommandRejectedError(message);
}

/** Names as a sentence lists them: "A", "A and B", "A, B and C". */
const listed = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** SRD: Magic Initiate repeats only with a different spell list, and each list is its own feat id here. */
function repeatsOnlyWithADifferentSpellList(feat: FeatReference): boolean {
  return featurePicks(feat.feature).some((pick) => pick.fromCatalog?.endsWith("-spells") ?? false);
}

// Choice offers: everything the content asks the player to pick, with its legal options.

/** One pick the content offers; `capacity` is choose x times-granted. `unresolvable` marks a catalog gap:
 *  the pick is optional, but a row targeting it still fails with the resolver's error. */
export type ChoiceOffer = {
  key: string;
  featureId: string | null;
  /** Other feature ids a `payload.featureId` tag may name (an option's pick also accepts its parent feature). */
  featureAliases: readonly string[];
  kind: string;
  capacity: number;
  options: ReadonlySet<string>;
  /** Spell level per option id, when the options came from a `*-spells` catalog (drives maxSpellLevel). */
  optionLevels: ReadonlyMap<string, number> | null;
  /** Inline options carrying their own mechanics (Divine Order's roles); null when the ids are bare. */
  optionRecords: readonly FeatureOption[] | null;
  unresolvable: string | null;
  repeatable: boolean;
  maxSpellLevel: number | null;
  /** Floor on an option's spell level: Mystic Arcanum is "one level 6 spell", so both bounds are 6. */
  minSpellLevel: number | null;
  /** The ceiling an ability-score pick from this offer may reach; null = the SRD's 20 (epic boons say 30). */
  maximum: number | null;
  label: string;
  /** The character level(s) this offer's picks belong to, one per grant (`[4, 8, 12, 16]` for an ASI).
   *  Not used for validation; writers record it so `level-ledger.ts` can prefill level-up. */
  levels: readonly number[];
  /** The class a pick belongs to, or null for species/background/origin decisions. */
  classId: string | null;
  /** The wizard step that shows this offer: the step that chose its source. */
  step: BuilderOfferStep;
  /** The offer whose answer created this one (a chosen feat's or option's own pick), shown beneath it. */
  parent: string | null;
  /** Option names, where a resolver or an inline option gave one. */
  names: ReadonlyMap<string, string>;
  /** The feature's own text, for the wizard. */
  help: string | null;
  /** Inline options whose prerequisite this build does not meet yet, with why ("unavailable until you know a Warlock
   *  cantrip that deals damage"): offered greyed, refused when taken. */
  unmet: ReadonlyMap<string, string>;
  /** For options gated on a class level (an invocation's "Level 5+ Warlock"): the class level each pick of this
   *  offer was gained at, in order. Null when no option carries a level gate. */
  slotLevels: readonly number[] | null;
  taken: string[];
};

/** Where an offer sits in the wizard: its step, the level(s) and class its picks are stamped with, and the
 *  offer it hangs from. */
type OfferSite = Pick<ChoiceOffer, "step" | "levels" | "classId" | "parent">;

function offerOf(
  partial: Pick<ChoiceOffer, "key" | "kind" | "capacity" | "options" | "label" | "step"> & Partial<ChoiceOffer>
): ChoiceOffer {
  return {
    featureId: null,
    featureAliases: [],
    optionLevels: null,
    optionRecords: null,
    unresolvable: null,
    maxSpellLevel: null,
    minSpellLevel: null,
    maximum: null,
    repeatable: false,
    levels: [1],
    classId: null,
    parent: null,
    names: new Map(),
    help: null,
    unmet: new Map(),
    slotLevels: null,
    taken: [],
    ...partial
  };
}

/**
 * Whether these level-gated options can all be held at once by a class at `classLevel` (SRD Eldritch Invocations:
 * "if an invocation requires you to be a level 5+ Warlock, you can select the invocation once you reach Warlock level
 * 5", and "whenever you gain a Warlock level, you can replace one of your invocations"). Each option needs a pick
 * gained at or above its level, or a replacement made at a level gained since (one per level from 2), so for every
 * gate t: the options needing t or more fit in the picks gained at t or more plus the levels from t that replace one.
 */
export function levelGatesFit(
  optionLevels: readonly number[],
  slotLevels: readonly number[],
  classLevel: number
): boolean {
  for (const gate of new Set(optionLevels)) {
    const needing = optionLevels.filter((level) => level >= gate).length;
    const gained = slotLevels.filter((level) => level >= gate).length;
    const replacements = Math.max(0, classLevel - Math.max(2, gate) + 1);
    if (needing > gained + replacements) return false;
  }
  return true;
}

/** The level a pick at index `index` of this offer belongs to - see `ChoiceOffer.levels`. */
export function levelOfPick(offer: Pick<ChoiceOffer, "levels" | "capacity">, index: number): number {
  const perGrant = Math.max(1, Math.ceil(offer.capacity / Math.max(1, offer.levels.length)));
  return offer.levels[Math.min(offer.levels.length - 1, Math.floor(index / perGrant))] ?? 1;
}

// Whether an option lies inside the offer's spell-level window (ceiling, floor or both); unknown level reads as 0.
const withinSpellWindow = (
  offer: Pick<ChoiceOffer, "optionLevels" | "maxSpellLevel" | "minSpellLevel">,
  id: string
): boolean => {
  const level = offer.optionLevels?.get(id) ?? 0;
  return (
    (offer.maxSpellLevel === null || level <= offer.maxSpellLevel) &&
    (offer.minSpellLevel === null || level >= offer.minSpellLevel)
  );
};

/** Exported for the random generator so it draws from exactly the ids `matchRow` accepts. */
export const withinOfferSpellWindow = withinSpellWindow;

/** Every budget an `extraPicks` grant may name by fixed key (a feature's own pick is `feature:<id>`):
 *  six offer keys plus the `class-cantrips` / `class-spells` columns. */
export const NAMED_PICK_BUDGETS = NAMED_PICK_BUDGET_KEYS;
export type NamedPickBudget = (typeof NAMED_PICK_BUDGETS)[number];

/** A chosen inline option is a feature with identical rider fields, so one interpreter handles both. */
function optionAsFeature(option: FeatureOption): FeatureRecord {
  return {
    id: option.id,
    name: option.name,
    description: option.description,
    tags: option.tags,
    actions: option.actions,
    effects: option.effects,
    modifiers: option.modifiers,
    // Listed explicitly rather than spread, so a field added to one carrier but not the other is a type error.
    extraPicks: option.extraPicks,
    replaces: option.replaces,
    ...(option.uses ? { uses: option.uses } : {}),
    ...(option.grants ? { grants: option.grants } : {}),
    // Options cannot nest further options; restate `from` because the feature-level type requires it.
    ...(option.choice ? { choice: { ...option.choice, from: option.choice.from } } : {})
  };
}

// Validation helpers.

const spreadKey = (amounts: readonly number[]) => [...amounts].sort((left, right) => right - left).join("/");

function validateBaseScores(input: CharacterCreateRequestInput, policy: BuilderPolicy): void {
  if (!policy.allowedAbilityMethods.includes(input.abilityMethod) && !input.keepsRecordedScores) {
    reject(`The table's builder policy does not allow the "${input.abilityMethod}" ability method.`);
  }
  const values = ABILITIES.map((ability) => input.baseScores[ability]);
  if (input.abilityMethod === "standard-array") {
    if ([...values].sort((a, b) => b - a).join(",") !== [...STANDARD_ARRAY].join(",")) {
      reject(`Standard-array scores must be exactly ${STANDARD_ARRAY.join(", ")} in some order.`);
    }
    return;
  }
  if (input.abilityMethod === "point-buy") {
    if (!isPointBuyLegal(values))
      reject("Those scores are not a legal point-buy spread (8-15, within the 27-point budget).");
    return;
  }
  // "roll" and "custom": the server cannot verify dice it did not throw (physical dice are supported),
  // so it bound-checks each score against what the formula can produce.
  if (input.abilityMethod === "custom" && !policy.customFormula) {
    // Recorded custom scores were checked against the formula of their day.
    if (input.keepsRecordedScores) return;
    reject("The custom ability method needs the GM to configure a formula first (builder policy).");
  }
  const formula = input.abilityMethod === "custom" ? policy.customFormula! : ABILITY_ROLL_FORMULA;
  const check = validateAbilityFormula(formula);
  if (!check.ok) reject(`The configured ability formula is unusable: ${check.message}`);
  for (const [index, value] of values.entries()) {
    if (value < check.minimum || value > check.maximum) {
      reject(
        `A ${formula} roll produces ${check.minimum}-${check.maximum}; ${ABILITIES[index].toUpperCase()} ${value} is outside that range.`
      );
    }
  }
}

function validateBackgroundAllocation(input: CharacterCreateRequestInput, background: BackgroundReference): void {
  const options = background.abilityOptions;
  if (!options) {
    if (input.backgroundBonusAllocation.length > 0)
      reject(`${background.name} grants no ability increases, but an allocation was supplied.`);
    return;
  }
  if (input.backgroundBonusAllocation.length === 0)
    reject(`${background.name} grants ability increases. Choose a +2/+1 or +1/+1/+1 spread.`);
  const abilities = input.backgroundBonusAllocation.map((entry) => entry.ability);
  if (new Set(abilities).size !== abilities.length)
    reject("Background ability increases must go to distinct abilities.");
  for (const ability of abilities) {
    if (!options.from.includes(ability))
      reject(
        `${background.name} increases ${options.from.map((a) => a.toUpperCase()).join("/")}, not ${ability.toUpperCase()}.`
      );
  }
  const spread = spreadKey(input.backgroundBonusAllocation.map((entry) => entry.amount));
  if (!options.spreads.some((legal) => spreadKey(legal) === spread)) {
    reject(
      `${background.name} allows ${options.spreads.map((legal) => `+${legal.join("/+")}`).join(" or ")}; got +${spread.replace(/\//g, "/+")}.`
    );
  }
}

/** Whether a record with an optional `level` has arrived by this character level. */
const reachedBy =
  (level: number) =>
  (record: Pick<FeatureRecord, "level">): boolean =>
    (record.level ?? 1) <= level;

/** Features the class's level rows 1..level grant, with grant counts and grant levels, plus the row for `level`. */
function grantedClassFeatures(
  entry: ClassReference,
  level: number
): { features: Map<string, { record: FeatureRecord; count: number; levels: number[] }>; row: ClassLevelRow } {
  const byId = new Map(entry.features.map((feature) => [feature.id, feature]));
  const granted = new Map<string, { record: FeatureRecord; count: number; levels: number[] }>();
  for (const row of entry.levelTable.filter((candidate) => candidate.level <= level)) {
    for (const featureId of row.features) {
      const existing = granted.get(featureId);
      granted.set(featureId, {
        record: byId.get(featureId)!,
        count: (existing?.count ?? 0) + 1,
        levels: [...(existing?.levels ?? []), row.level]
      });
    }
  }
  // A replacing feature (Indomitable 9/13/17) supersedes its predecessor once granted.
  for (const { record } of [...granted.values()]) {
    if (record.replacesFeatureId && granted.has(record.replacesFeatureId)) granted.delete(record.replacesFeatureId);
  }
  return { features: granted, row: entry.levelTable[level - 1] };
}

/** Everything steps 1-4 settled. The random generator picks from this same surface, so its picks and
 *  the validator cannot diverge. */
export type ServerOfferSurvey = PlacedChoices &
  Readonly<{
    /** Every class in the order first taken; the first is the starting class. */
    classes: readonly BuildClass[];
    /** The class each character level went to, in order. */
    sequence: readonly string[];
    /** The starting class, its subclass and its own table row: what the level-1 traits and equipment read. */
    classRecord: ClassReference;
    subclass: SubclassReference | null;
    levelRow: ClassLevelRow;
    species: SpeciesReference;
    background: BackgroundReference;
    progression: ClassProgressionTable;
    /** Ability scores after background and species bonuses, before any ASI or feature rider. */
    scoresBeforeIncreases: Record<Ability, number>;
    proficiencyBonus: number;
  }>;

/** A wizard draft's survey: any of the three identity choices may still be open. */
export type DraftSurvey = PlacedChoices &
  SurveyIdentity &
  Readonly<{ classRecord: ClassReference | null; subclass: SubclassReference | null }>;

/** What the survey reads: the identity (in a wizard draft any part may still be unchosen) and the level. */
type SurveyIdentity = Readonly<{
  /** Empty while a draft has no class yet. */
  classes: readonly BuildClass[];
  species: SpeciesReference | null;
  background: BackgroundReference | null;
  level: number;
}>;

/**
 * A casting class's own spell budgets (SRD Multiclassing: "You determine what spells you can prepare for each class
 * individually, as if you were a single-classed member of that class"), and the ledger rows that answer them.
 */
export type ClassSpellBudget = Readonly<{
  classId: string;
  className: string;
  casting: ContentSpellcasting;
  /** The character level the class was taken at: what its picks are stamped with. */
  takenAt: number;
  /** The printed columns at this class's level, before what features grant. */
  printedCantrips: number;
  printedPrepared: number;
  /** The printed columns plus what features grant (Thaumaturge's extra cantrip). */
  cantrips: number;
  prepared: number;
  /** The highest spell level this class's own table casts, which is the highest it may prepare. */
  maxSlotLevel: number;
  /** Its spell list's catalog slug, widened by its features (Magical Secrets). */
  listSlug: string;
  cantripRows: readonly CharacterChoice[];
  spellRows: readonly CharacterChoice[];
}>;

/** The offers and what the ledger settled against them. */
type PlacedChoices = Readonly<{
  offers: readonly ChoiceOffer[];
  lineage: SpeciesReference["lineages"][number] | null;
  originFeat: FeatReference | null;
  /** Every feature held so far with its provenance (the origin feat and chosen feats carry `origin: null`). */
  granted: readonly GrantedFeature[];
  chosenFeats: readonly FeatReference[];
  /** The character level each chosen feat was taken at, by index: what its prerequisites are checked at. */
  chosenFeatLevels: readonly number[];
  /** The character level of the Ability Score Improvement each `asi` shorthand row filled, in ledger order: when
   *  its increases apply, whatever level the row itself states. */
  asiLevels: readonly number[];
  /** Every feat id already held: the cross-offer duplicate guard. */
  heldFeatIds: ReadonlySet<string>;
  extraPickBudgets: ReadonlyMap<string, number>;
  /** Spell lists any class's own spell picks also draw on (Magical Secrets). */
  extraSpellLists: readonly string[];
  /** One entry per casting class, in class order. */
  classSpells: readonly ClassSpellBudget[];
  /** Class spell rows naming a class with no spell list, which the build refuses. */
  strayClassSpellRows: readonly CharacterChoice[];
  catalogs: CatalogChoiceCatalogs;
}>;

export const CLASS_CANTRIP_BUDGET: NamedPickBudget = "class-cantrips";
/** The pick of the ability a species' or a feat's spells are cast with (Elven Lineage, Magic Initiate). */
export const SPELLCASTING_ABILITY_KIND = "spellcasting-ability";
export const CLASS_SPELL_BUDGET: NamedPickBudget = "class-spells";

/** Steps 1-4 of `buildCharacterDefinition`: every id resolved and every ledger row placed. */
export function surveyForBuild(
  input: CharacterCreateRequestInput,
  library: ContentView,
  policy: BuilderPolicy
): ServerOfferSurvey {
  return surveyBuild(input, library, policy, "build");
}

/** Runs steps 1-4 of `buildCharacterDefinition` without requiring the ledger to answer the offers yet. */
export function computeServerOffers(
  input: CharacterCreateRequestInput,
  library: ContentView,
  policy: BuilderPolicy
): ServerOfferSurvey {
  return surveyBuild(input, library, policy, "offers");
}

function surveyBuild(
  input: CharacterCreateRequestInput,
  library: ContentView,
  policy: BuilderPolicy,
  mode: "build" | "offers"
): ServerOfferSurvey {
  // ---- 1. Identity ids resolve against the catalogs. The multiclass prerequisites need the scores as they stand
  // when each class is taken, so the build checks them level by level (step 5). ----
  const sequence = classSequenceOf(input);
  const starting: ClassReference =
    library.classRecord(input.classId) ?? reject(`No class "${input.classId}" is in the content catalog.`);
  const species: SpeciesReference =
    library.speciesRecord(input.speciesId) ?? reject(`No species "${input.speciesId}" is in the content catalog.`);
  const background: BackgroundReference =
    library.backgroundRecord(input.backgroundId) ??
    reject(`No background "${input.backgroundId}" is in the content catalog.`);
  // The starting class names its subclass in the request; a later class names its own in its ledger row.
  const subclassOf = (record: ClassReference, level: number): SubclassReference | null => {
    const label = record.subclassLabel ?? "subclass";
    const chosenId =
      record.id === starting.id
        ? input.subclassId
        : input.choices.find((row) => row.kind === "subclass" && row.classId === record.id)?.id;
    if (level < record.subclassLevel) {
      if (chosenId)
        reject(
          `${record.name} chooses its ${label} at level ${record.subclassLevel}; a level ${level} ${record.name} has none.`
        );
      return null;
    }
    if (!chosenId)
      reject(`A level ${level} ${record.name} has ${withArticle(label)} (chosen at level ${record.subclassLevel}).`);
    const subclass = library.subclassRecord(chosenId) ?? reject(`No subclass "${chosenId}" is in the content catalog.`);
    if (subclass.classId !== record.id)
      reject(`${subclass.name} is a ${subclass.classId} subclass, so a ${record.name} can't take it.`);
    return subclass;
  };
  const classes = buildClassesOf(sequence, library, subclassOf);
  for (const row of input.choices) {
    if (row.level > input.level)
      reject(`A choice is recorded at level ${row.level}, above the character's level ${input.level}.`);
  }

  // ---- 2. Ability scores: method legality, base values, the background's printed spread. ----
  validateBaseScores(input, policy);
  validateBackgroundAllocation(input, background);
  const finalScores = { ...input.baseScores } as Record<Ability, number>;
  for (const entry of input.backgroundBonusAllocation) {
    finalScores[entry.ability] += entry.amount;
    if (finalScores[entry.ability] > 20)
      reject(
        `${entry.ability.toUpperCase()} would be ${finalScores[entry.ability]}; ability scores cannot be raised above 20.`
      );
  }
  for (const bonus of species.abilityBonuses)
    finalScores[bonus.ability] = Math.min(20, finalScores[bonus.ability] + bonus.amount);

  // In "offers" mode the lineage may still be unanswered; answering it is the caller's job.
  if (
    mode === "build" &&
    !input.choices.some((row) => row.kind === "lineage") &&
    species.traits.some((trait) => featurePicks(trait).some((pick) => pick.kind === "lineage"))
  )
    reject(`${species.name} asks for a lineage choice.`);

  const placed = placeChoices({ classes, species, background, level: input.level }, input.choices, library, false);
  return {
    ...placed,
    classes,
    sequence,
    classRecord: starting,
    subclass: classes[0].subclass,
    levelRow: classes[0].row,
    species,
    background,
    progression: library.classProgressionTable(),
    scoresBeforeIncreases: finalScores,
    // SRD Multiclassing: the Proficiency Bonus follows the total character level, not any one class's.
    proficiencyBonus: proficiencyBonusForLevel(input.level)
  };
}

/** A wizard draft: the identity chosen so far and the answers given so far. */
export type DraftSurveyInput = Readonly<{
  speciesId?: string;
  backgroundId?: string;
  classId?: string;
  subclassId?: string;
  /** The class each character level went to, in order; absent for one class. */
  classLevels?: readonly string[];
  /** A later class's subclass by class id; the starting class's is `subclassId`. */
  subclassIds?: Readonly<Record<string, string>>;
  level: number;
  choices: readonly CharacterChoice[];
}>;

/**
 * The survey for a draft in the wizard. Unlike a create it tolerates what a draft holds: an identity
 * still being chosen, a subclass that no longer fits, and answers the build no longer offers (a Fighter's
 * skills after switching to Wizard), which are left unplaced for the wizard to drop. Scores are not read.
 */
export function surveyDraft(input: DraftSurveyInput, library: ContentView): DraftSurvey {
  const species = input.speciesId
    ? (library.speciesRecord(input.speciesId) ?? reject(`No species "${input.speciesId}" is in the content catalog.`))
    : null;
  const background = input.backgroundId
    ? (library.backgroundRecord(input.backgroundId) ??
      reject(`No background "${input.backgroundId}" is in the content catalog.`))
    : null;
  const classId = input.classId;
  const classes = classId
    ? buildClassesOf(
        classSequenceOf({ classId, level: input.level, classLevels: input.classLevels }),
        library,
        (record, level) => {
          const candidateId = record.id === classId ? input.subclassId : input.subclassIds?.[record.id];
          const candidate = candidateId ? library.subclassRecord(candidateId) : undefined;
          return candidate?.classId === record.id && level >= record.subclassLevel ? candidate : null;
        }
      )
    : [];
  const identity = { classes, species, background, level: input.level };
  const choices = input.choices.filter((row) => row.level <= input.level);
  return {
    ...identity,
    classRecord: classes[0]?.record ?? null,
    subclass: classes[0]?.subclass ?? null,
    ...placeChoices(identity, choices, library, true)
  };
}

/** What a `fromPicks` predicate asks of an earlier pick, as the end of "needs a Warlock cantrip ...". */
const PICK_PREDICATE: Readonly<Record<string, string>> = {
  "deals-damage": "that deals damage",
  "attack-roll": "that deals damage with an attack roll",
  ranged: "with a range of 10 feet or more",
  "ranged-damage": "that deals damage at a range of 10 feet or more"
};

/**
 * Collects every granted feature, builds the choice offers, and matches each ledger row to one. Strict, a
 * row that fits no offer refuses the build; lenient (a wizard draft), it is skipped and changes nothing.
 * Content authoring errors refuse either way.
 */
function placeChoices(
  { classes, species, background, level }: SurveyIdentity,
  choices: readonly CharacterChoice[],
  library: ContentView,
  lenient: boolean
): PlacedChoices {
  const catalogs = library.catalogChoiceCatalogs();
  const starting = classes[0] ?? null;
  const startingId = starting?.record.id ?? null;
  const classOf = new Map(classes.map((entry) => [entry.record.id, entry]));
  // Two classes can offer a feature of the same name (Weapon Mastery), so a multiclass build names the class.
  const labelFor = (classId: string | null, label: string) => {
    const className = classId === null ? null : (classOf.get(classId)?.record.name ?? classId);
    return classes.length > 1 && className !== null && !label.startsWith(className) ? `${className} · ${label}` : label;
  };
  const highestSlotLevel = highestSlotLevelOf(classes);
  /** A row belongs to a class when it names that class, or names none (written before rows named their class). */
  const inClass = (row: CharacterChoice, classId: string | null) =>
    classId === null || row.classId === undefined || row.classId === classId;

  // ---- 3. Collect every granted feature (class rows, subclass, species + lineage, background, origin feat). ----
  const chosenLineageId = choices.find((row) => row.kind === "lineage")?.id ?? null;
  const chosenLineage = chosenLineageId
    ? species?.lineages.find((candidate) => candidate.id === chosenLineageId)
    : null;
  if (chosenLineageId && !chosenLineage && !lenient) reject(`"${species?.name}" has no lineage "${chosenLineageId}".`);
  const lineage = chosenLineage ?? null;
  const originFeat: FeatReference | null = background?.originFeatId
    ? (library.featRecord(background.originFeatId) ??
      reject(`${background.name} grants unknown feat "${background.originFeatId}".`))
    : null;
  // Every feat this character already holds, granted or chosen - the cross-offer duplicate guard in pass A.
  const heldFeatIds = new Set<string>(originFeat ? [originFeat.id] : []);
  // `origin` becomes `definition.character.features` (how roll-time riders reach the table); null means
  // already on `character.feats`. `site` is where the feature's picks sit in the wizard; a class feature's sits at
  // the character levels its class levels arrived at.
  const speciesSite: OfferSite = { step: "species", levels: [1], classId: null, parent: null };
  const backgroundSite: OfferSite = { step: "background", levels: [1], classId: null, parent: null };
  const classFeatureEntries = (entry: BuildClass): Array<GrantedFeature & { site: OfferSite }> => {
    const id = entry.record.id;
    const atLevel = (classLevel: number) => entry.characterLevels[classLevel - 1] ?? classLevel;
    const subclass = entry.subclass;
    const subclassLevelOf = (record: FeatureRecord) =>
      record.level ?? subclass?.subclassLevel ?? entry.record.subclassLevel;
    return [
      ...[...grantedClassFeatures(entry.record, entry.level).features.values()].map((feature) => ({
        record: feature.record,
        count: feature.count,
        origin: { kind: "class" as const, sourceId: id },
        classId: id,
        site: { step: "features" as const, levels: feature.levels.map(atLevel), classId: id, parent: null }
      })),
      ...(subclass?.features ?? [])
        .filter((record) => subclassLevelOf(record) <= entry.level)
        .map((record) => ({
          record,
          count: 1,
          origin: { kind: "subclass" as const, sourceId: subclass!.id },
          classId: id,
          site: { step: "features" as const, levels: [atLevel(subclassLevelOf(record))], classId: id, parent: null }
        }))
    ];
  };
  const initial: Array<GrantedFeature & { site: OfferSite }> = [
    ...classes.flatMap(classFeatureEntries),
    // A species trait's `level` is the character level it arrives at (Draconic Flight at 5, the
    // Fiendish Legacy spells at 3 and 5).
    ...(species?.traits ?? []).filter(reachedBy(level)).map((record) => ({
      record,
      count: 1,
      origin: { kind: "species", sourceId: species!.id } as const,
      classId: null,
      site: speciesSite
    })),
    ...(lineage?.traits ?? []).filter(reachedBy(level)).map((record) => ({
      record,
      count: 1,
      origin: { kind: "lineage", sourceId: lineage!.id } as const,
      classId: null,
      site: speciesSite
    })),
    ...(background?.features ?? []).map((record) => ({
      record,
      count: 1,
      origin: { kind: "background", sourceId: background!.id } as const,
      classId: null,
      site: backgroundSite
    })),
    ...(originFeat ? [{ record: originFeat.feature, count: 1, origin: null, classId: null, site: backgroundSite }] : [])
  ];
  const granted: GrantedFeature[] = [...initial];
  /** The class whose level scales an option: its parent's, when the parent is a class or subclass feature. */
  const scaleOf = (parentId: string | null, siteClassId: string | null): string | null =>
    parentId === null
      ? null
      : (granted.find((entry) => entry.record.id === parentId && entry.classId === siteClassId)?.classId ?? null);

  // ---- 4. Build the choice offers and match every ledger row against them. ----
  // Pass A settles chosen feats first, since a feat can ask for picks that pass B must see.
  const offers: ChoiceOffer[] = [];
  const listOffer = (
    key: string,
    kind: string,
    label: string,
    list: { choose: number; from: readonly string[]; fromCatalog?: string } | undefined,
    site: OfferSite,
    keepEmpty = false
  ) => {
    if (!list || (list.choose <= 0 && !keepEmpty)) return;
    // A choose-N list may draw on an open catalog too (the species' Standard Languages), resolved through
    // `resolveCatalogChoice`; a catalog gap defers the pick.
    const options = new Set(list.from);
    const names = new Map<string, string>();
    let unresolvable: string | null = null;
    if (list.fromCatalog) {
      try {
        for (const option of resolveCatalogChoice(list.fromCatalog, catalogs)) {
          options.add(option.id);
          if (!names.has(option.id)) names.set(option.id, option.name);
        }
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        if (options.size === 0) unresolvable = error.message;
      }
    }
    offers.push(
      offerOf({ key, kind, capacity: Math.max(0, list.choose), options, names, unresolvable, label, ...site })
    );
  };
  const classSite = (entry: BuildClass): OfferSite => ({
    step: "class",
    levels: [entry.characterLevels[0] ?? 1],
    classId: entry.record.id,
    parent: null
  });
  if (starting) {
    listOffer(
      "class-skills",
      "skill",
      `${starting.record.name} skills`,
      starting.record.skillChoices,
      classSite(starting)
    );
    listOffer("class-tools", "tool", `${starting.record.name} tools`, starting.record.toolChoices, classSite(starting));
  }
  // A later class brings only its multiclass proficiencies (SRD: "you gain only some of the new class's starting
  // proficiencies"): a Bard's, Ranger's or Rogue's skill, a Bard's instrument. Its skill offer exists even when it
  // grants none, so one of its features can still raise it (a Barbarian's Primal Knowledge); unraised, it is dropped.
  for (const entry of classes.slice(1)) {
    const id = entry.record.id;
    const multiclass = entry.record.multiclassProficiencies;
    listOffer(
      classBudgetKey("class-skills", id, startingId),
      "skill",
      `${entry.record.name} skills`,
      multiclass?.skills ?? { ...entry.record.skillChoices, choose: 0 },
      classSite(entry),
      true
    );
    listOffer(
      classBudgetKey("class-tools", id, startingId),
      "tool",
      `${entry.record.name} tools`,
      multiclass?.toolChoices,
      classSite(entry)
    );
  }
  if (background) {
    listOffer("background-skills", "skill", `${background.name} skills`, background.skillChoices, backgroundSite);
    listOffer("background-tools", "tool", `${background.name} tools`, background.toolChoices, backgroundSite);
    listOffer(
      "background-languages",
      "language",
      `${background.name} languages`,
      background.languageChoices,
      backgroundSite
    );
  }
  if (species)
    listOffer("species-languages", "language", `${species.name} languages`, species.languageChoices, speciesSite);
  // Whether an option is already in the ledger (what `options[].requires` gates on), scoped the way
  // `matchRow` scopes a row.
  const ledgerAnswered = (offerKey: string, optionId: string, classId: string | null): boolean => {
    const featureId = offerKey.startsWith("feature:") ? offerKey.slice("feature:".length).replace(/\/\d+$/, "") : null;
    return choices.some(
      (row) =>
        row.id === optionId &&
        inClass(row, classId) &&
        (featureId === null ||
          (row.payload && typeof row.payload.featureId === "string" && row.payload.featureId === featureId))
    );
  };
  /** Options a gate determined rather than offered; drained into `granted` once every offer is built. */
  const determined: Array<{ option: FeatureOption; parentId: string; site: OfferSite }> = [];
  /** What a budget already holds, read off the ledger (narrowed by `fromPicks`). */
  const NAMED_BUDGET_KIND: Readonly<Record<string, string>> = {
    "class-cantrips": "cantrip",
    "class-spells": "spell",
    "class-skills": "skill",
    "class-tools": "tool",
    "background-skills": "skill",
    "background-tools": "tool",
    "background-languages": "language",
    "species-languages": "language"
  };
  /** A budget's answers in the ledger; a class's own budget ("one of your known Warlock cantrips") is that class's. */
  const answersFor = (offerKey: string, classId: string | null): string[] => {
    if (offerKey.startsWith("feature:")) {
      const featureId = offerKey.slice("feature:".length).replace(/\/\d+$/, "");
      return choices
        .filter((row) => row.payload && row.payload.featureId === featureId && inClass(row, classId))
        .map((row) => row.id);
    }
    const kind = NAMED_BUDGET_KIND[budgetOfKey(offerKey)];
    if (!kind) return [];
    return choices
      .filter(
        (row) =>
          row.kind === kind && !(row.payload && typeof row.payload.featureId === "string") && inClass(row, classId)
      )
      .map((row) => row.id);
  };
  /** Why an option whose own pick draws on earlier answers can't be taken yet, or null when one qualifies. */
  const unmetPickSource = (
    source: NonNullable<FeatureRecord["choice"]>["fromPicks"],
    classId: string | null
  ): string | null => {
    if (!source) return null;
    try {
      resolvePickChoice(source, answersFor(source.offer, classId), catalogs);
      return null;
    } catch (error) {
      if (!(error instanceof CatalogChoiceError)) throw error;
      const className = classId === null ? null : (classOf.get(classId)?.record.name ?? null);
      if (budgetOfKey(source.offer) !== CLASS_CANTRIP_BUDGET) return "unavailable until an earlier pick qualifies";
      const cantrip = `${className ? withArticle(className) : "a"} cantrip`;
      return `unavailable until you know ${cantrip}${source.where ? ` ${PICK_PREDICATE[source.where] ?? ""}` : ""}`.trimEnd();
    }
  };
  /** The class level each pick of a class feature's offer was gained at: its grants, then its own column's growth
   *  (Eldritch Invocations: 1 at level 1, 3 at 2, 5 at 5, ...). */
  const slotLevelsOf = (
    record: FeatureRecord,
    choice: NonNullable<FeatureRecord["choice"]>,
    classId: string
  ): number[] => {
    const entry = classOf.get(classId);
    if (!entry) return [];
    const table = entry.record.levelTable;
    const grantedAt = table
      .filter((row) => row.level <= entry.level && row.features.includes(record.id))
      .map((row) => row.level);
    const slots = (grantedAt.length > 0 ? grantedAt : [record.level ?? 1]).flatMap((at) =>
      Array.from({ length: choice.choose }, () => at)
    );
    for (const grant of record.extraPicks) {
      if (grant.offer !== `feature:${record.id}` || grant.scaling?.type !== "class-resource-growth") continue;
      for (let at = 2; at <= entry.level; at += 1) {
        const gained =
          classResourceGrowth(table, at, grant.scaling.id) - classResourceGrowth(table, at - 1, grant.scaling.id);
        for (let pick = 0; pick < gained; pick += 1) slots.push(at);
      }
    }
    return slots;
  };
  const featureOffer = (
    record: FeatureRecord,
    count: number,
    featureAliases: readonly string[],
    site: OfferSite
  ): void => {
    // Every pick the record owes becomes its own offer; the first keeps the plain `feature:<id>` key,
    // later ones take `/2`, `/3`, ...
    featurePicks(record).forEach((choice, index) =>
      featurePickOffer(record, choice, index, count, featureAliases, site)
    );
  };
  const featurePickOffer = (
    record: FeatureRecord,
    choice: NonNullable<FeatureRecord["choice"]>,
    index: number,
    count: number,
    featureAliases: readonly string[],
    site: OfferSite
  ): void => {
    if (choice.choose * count === 0) return;
    let options: ReadonlySet<string>;
    let optionLevels: ReadonlyMap<string, number> | null = null;
    let unresolvable: string | null = null;
    const names = new Map<string, string>();
    /** Keeps what a resolver says about each option: its name, and its spell level when it has one. */
    const resolvedFrom = (resolved: readonly CatalogChoiceOption[]) => {
      for (const option of resolved) if (!names.has(option.id)) names.set(option.id, option.name);
      if (resolved.some((option) => option.level !== undefined))
        optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
    };
    // Inline `options` carry their own mechanics. When both a catalog and bespoke options are authored
    // the offer is their union.
    const named = choice.from ?? [];
    for (const option of choice.options ?? []) names.set(option.id, option.name);
    // Options drawn from the character's own earlier answers ("one of your known Warlock cantrips"),
    // read from the ledger, which is complete before any pass runs.
    if (choice.fromPicks) {
      try {
        const resolved = resolvePickChoice(
          choice.fromPicks,
          answersFor(choice.fromPicks.offer, site.classId),
          catalogs
        );
        options = new Set(resolved.map((option) => option.id));
        resolvedFrom(resolved);
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        // Nothing eligible chosen yet: defer like an unresolvable catalog; a row targeting it is still refused.
        options = new Set();
        unresolvable = error.message;
      }
    } else if (named.length > 0 && choice.fromCatalog) {
      const union = new Set(named);
      options = union;
      try {
        const resolved = resolveCatalogChoice(choice.fromCatalog, catalogs);
        for (const option of resolved) union.add(option.id);
        resolvedFrom(resolved);
      } catch (error) {
        // The bespoke half still stands when the catalog half is a content gap.
        if (!(error instanceof CatalogChoiceError)) throw error;
      }
    } else if (named.length > 0) options = new Set(named);
    else if (!choice.fromCatalog) {
      // `{kind, choose, from: []}` passes the content schema but cannot resolve; reject it as bad content
      // instead of letting a raw TypeError reach the client.
      reject(
        `"${record.name}" offers a "${choice.kind}" choice with no options. Its content record needs a non-empty "from" list or a "fromCatalog" slug.`
      );
    } else {
      try {
        const resolved = resolveCatalogChoice(choice.fromCatalog!, catalogs);
        options = new Set(resolved.map((option) => option.id));
        resolvedFrom(resolved);
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        // Partial-content gap: the pick is deferred, but a row targeting it still fails with the resolver's message.
        options = new Set();
        unresolvable = error.message;
      }
    }
    /** Options gated on an earlier answer: unmet gates drop out, and if the survivors exactly fill the
     *  capacity they are adopted without pushing an offer. An option above this build's level (its class's level,
     *  for a class feature: "Level 9+ Warlock") is not offered. */
    const reach = site.classId !== null ? (classOf.get(site.classId)?.level ?? level) : level;
    let optionRecords = choice.options ?? null;
    if (optionRecords?.some((option) => (option.level ?? 1) > reach)) {
      optionRecords = optionRecords.filter((option) => (option.level ?? 1) <= reach);
      const reached = new Set(optionRecords.map((option) => option.id));
      options = new Set(
        [...options].filter((id) => reached.has(id) || !choice.options!.some((option) => option.id === id))
      );
    }
    if (optionRecords?.some((option) => option.requires)) {
      const legal = optionRecords.filter(
        (option) => !option.requires || ledgerAnswered(option.requires.offer, option.requires.id, site.classId)
      );
      optionRecords = legal;
      options = new Set(legal.map((option) => option.id));
      if (legal.length === choice.choose * count) {
        for (const option of legal) determined.push({ option, parentId: record.id, site });
        return;
      }
    }
    // An option whose own pick needs an earlier answer the build lacks ("a Warlock cantrip that deals damage").
    const unmet = new Map<string, string>();
    for (const option of optionRecords ?? []) {
      const reason = unmetPickSource(option.choice?.fromPicks, site.classId);
      if (reason) unmet.set(option.id, reason);
    }
    const gated = (choice.options ?? []).some((option) => (option.level ?? 1) > 1);
    offers.push(
      offerOf({
        key: index === 0 ? `feature:${record.id}` : `feature:${record.id}/${index + 1}`,
        featureId: record.id,
        featureAliases,
        kind: choice.kind,
        capacity: choice.choose * count,
        options,
        names,
        optionLevels,
        optionRecords,
        unresolvable,
        unmet,
        slotLevels: gated && site.classId !== null ? slotLevelsOf(record, choice, site.classId) : null,
        repeatable: choice.repeatable,
        // A class feature's spell pick with no printed ceiling is a spell this caster has slots for (Magical
        // Discoveries); Mystic Arcanum prints its own level above the slots.
        maxSpellLevel:
          choice.maxSpellLevel ??
          (choice.kind === "spell" && site.classId !== null && highestSlotLevel > 0 ? highestSlotLevel : null),
        minSpellLevel: choice.minSpellLevel ?? null,
        maximum: choice.maximum ?? null,
        // The ability pick shares its record with the lineage or the feat's spells, so it names itself.
        label:
          choice.kind === SPELLCASTING_ABILITY_KIND
            ? `${record.name}: spellcasting ability`
            : site.parent === null
              ? labelFor(site.classId, record.name)
              : record.name,
        help: record.description || null,
        ...site
      })
    );
  };
  for (const { record, count, site } of initial) featureOffer(record, count, [], site);

  /** Adopts determined options; a queue, because an adopted option may determine another. */
  while (determined.length > 0) {
    const { option, parentId, site } = determined.shift()!;
    const asFeature = optionAsFeature(option);
    granted.push({
      record: asFeature,
      count: 1,
      origin: { kind: "option", sourceId: parentId },
      classId: scaleOf(parentId, site.classId)
    });
    featureOffer(asFeature, 1, [parentId], site);
  }

  /** The offer a budget key names for a class: its own when it has one (two classes can both offer Weapon
   *  Mastery), else the one every class shares (the species' languages). */
  const budgetOffer = (key: string, classId: string | null): ChoiceOffer | undefined => {
    const candidates = offers.filter((offer) => offer.key === key);
    return (
      candidates.find((offer) => offer.classId === (classId ?? startingId)) ??
      candidates.find((offer) => offer.classId === null) ??
      candidates[0]
    );
  };
  /** Extra picks raise a budget rather than grant an outcome. Grants add up; each is folded in as soon as
   *  its source is settled, because `matchRow` refuses picks over `capacity`. A class's feature raises that class's
   *  budgets, read off that class's own table at its own level. */
  const extraPickBudgets = new Map<string, number>();
  const grantExtraPicks = (record: FeatureRecord, count: number, classId: string | null): void => {
    const scaling = classId !== null ? (classOf.get(classId) ?? starting) : starting;
    for (const grant of record.extraPicks) {
      // With no class chosen yet (a wizard draft) the printed table is empty.
      const amount = extraPickAmount(grant, scaling?.record.levelTable ?? [], scaling?.level ?? level) * count;
      const key = classBudgetKey(grant.offer, classId, startingId);
      extraPickBudgets.set(key, (extraPickBudgets.get(key) ?? 0) + amount);
      // `class-cantrips` / `class-spells` are level-row columns read at step 9, so no matching offer is not yet an error.
      const offer = budgetOffer(key, classId);
      if (offer) offer.capacity += amount;
    }
  };
  for (const { record, count, classId } of granted) grantExtraPicks(record, count, classId);

  const featureTagOf = (row: CharacterChoice): string | null =>
    row.payload && typeof row.payload.featureId === "string" ? row.payload.featureId : null;
  /** The offer a row answers, or a refusal naming why none can take it. Leaves the offer unchanged. */
  const offerFor = (row: CharacterChoice, candidates: readonly ChoiceOffer[]): ChoiceOffer => {
    const featureTag = featureTagOf(row);
    const tagged = featureTag
      ? candidates.filter((offer) => offer.featureId === featureTag || offer.featureAliases.includes(featureTag))
      : candidates;
    // A row that names its class answers that class's offer: two classes can offer the same feature.
    const ofClass =
      row.classId === undefined
        ? tagged
        : tagged.filter((offer) => offer.classId === null || offer.classId === row.classId);
    const scoped = ofClass.length > 0 ? ofClass : tagged;
    if (scoped.length === 0)
      reject(
        featureTag
          ? `No feature "${featureTag}" offers a "${row.kind}" choice.`
          : `Nothing in this build offers a "${row.kind}" choice.`
      );
    const gap = scoped.find((offer) => offer.unresolvable !== null);
    if (gap && !scoped.some((offer) => offer.options.has(row.id)))
      reject(`This build needs "${gap.label}" resolved, but ${gap.unresolvable}`);
    // Outside the spell-level window: say which bound and by how much.
    const outOfWindow = scoped.find((offer) => offer.options.has(row.id) && !withinSpellWindow(offer, row.id));
    if (outOfWindow && !scoped.some((offer) => offer.options.has(row.id) && withinSpellWindow(offer, row.id))) {
      const spellLevel = outOfWindow.optionLevels?.get(row.id) ?? 0;
      reject(
        outOfWindow.minSpellLevel !== null && spellLevel < outOfWindow.minSpellLevel
          ? `"${row.id}" is level ${spellLevel}, below the minimum spell level (${outOfWindow.minSpellLevel}) for "${outOfWindow.label}".`
          : `"${row.id}" is level ${spellLevel}, above the maximum spell level (${outOfWindow.maxSpellLevel}) for "${outOfWindow.label}".`
      );
    }
    const offer = scoped.find(
      (candidate) =>
        candidate.options.has(row.id) &&
        withinSpellWindow(candidate, row.id) &&
        candidate.taken.length < candidate.capacity &&
        (candidate.repeatable || !candidate.taken.includes(row.id))
    );
    if (!offer) {
      const anyHolds = scoped.some((candidate) => candidate.options.has(row.id));
      reject(
        anyHolds
          ? `The "${row.kind}" pick "${row.id}" exceeds what this build may choose (${scoped.map((candidate) => `${candidate.label}: ${candidate.capacity}`).join(", ")}).`
          : `"${row.id}" is not an offered option for the "${row.kind}" choice (${scoped.map((candidate) => candidate.label).join(", ")}).`
      );
    }
    return offer;
  };
  const matchRow = (row: CharacterChoice, candidates: readonly ChoiceOffer[]): ChoiceOffer => {
    const offer = offerFor(row, candidates);
    offer.taken.push(row.id);
    return offer;
  };
  /** Places one row. Strict, a refusal fails the build; lenient, the row is skipped. A row is placed whole
   *  or not at all, because every refusal comes before its first write. */
  const place = (work: () => void): void => {
    if (!lenient) return work();
    try {
      work();
    } catch (error) {
      if (!(error instanceof CommandRejectedError)) throw error;
    }
  };

  /** Where a just-answered pick's own picks sit: its row's level when that is one of the offer's grants (a
   *  feat taken at level 8 records its picks at 8), else the grant its position falls in. */
  const siteOfPick = (offer: ChoiceOffer, row: CharacterChoice): OfferSite => ({
    step: offer.step,
    levels: [offer.levels.includes(row.level) ? row.level : levelOfPick(offer, Math.max(0, offer.taken.length - 1))],
    classId: offer.classId,
    parent: offer.key
  });

  // Pass A: feat selections. "asi" is the built-in shorthand (payload.increases).
  const FEAT_KINDS = new Set(["feat", "fighting-style", "asi-or-feat"]);
  const chosenFeats: FeatReference[] = [];
  /** Where each chosen feat was taken; a feat's own picks belong to that offer's level/class. */
  const chosenFeatSites: OfferSite[] = [];
  /** Inline options answered to a feat-kinded pick (Blessed Warrior, Druidic Warrior), with the class they scale with. */
  const chosenInlineStyles: Array<{ record: FeatureRecord; classId: string | null }> = [];
  const asiLevels: number[] = [];
  for (const row of choices) {
    if (!FEAT_KINDS.has(row.kind)) continue;
    place(() => {
      if (row.kind === "asi-or-feat" && row.id === "asi") {
        const offer =
          offers.find(
            (candidate) =>
              candidate.kind === "asi-or-feat" &&
              candidate.taken.length < candidate.capacity &&
              (row.classId === undefined || candidate.classId === null || candidate.classId === row.classId)
          ) ?? reject(`No Ability Score Improvement is available to spend at level ${row.level}.`);
        offer.taken.push(row.id);
        asiLevels.push(levelOfPick(offer, offer.taken.length - 1));
        return;
      }
      const matched = offerFor(
        row,
        offers.filter((offer) => offer.kind === row.kind)
      );
      // A feat-kinded pick may be answered by an inline option (Blessed Warrior beside the Fighting Style
      // catalog); it is interpreted like any chosen option in pass A2.
      const inlineOption = matched.optionRecords?.find((candidate) => candidate.id === row.id);
      if (inlineOption) {
        matched.taken.push(row.id);
        const asFeature = optionAsFeature(inlineOption);
        const classId = scaleOf(matched.featureId, matched.classId);
        granted.push({
          record: asFeature,
          count: 1,
          origin: matched.featureId ? { kind: "option", sourceId: matched.featureId } : null,
          classId
        });
        featureOffer(asFeature, 1, matched.featureId ? [matched.featureId] : [], siteOfPick(matched, row));
        chosenInlineStyles.push({ record: asFeature, classId });
        return;
      }
      const feat = library.featRecord(row.id) ?? reject(`No feat "${row.id}" is in the content catalog.`);
      // The same feat may not be taken twice across different offers (`repeatable:false` only guards one
      // offer). The held set includes the background's granted origin feat.
      if (heldFeatIds.has(feat.id)) {
        if (!feat.repeatable)
          reject(
            `${feat.name} is already on this character. A feat can be taken only once unless it says it is repeatable.`
          );
        if (repeatsOnlyWithADifferentSpellList(feat))
          reject(`${feat.name} may be taken again only with a DIFFERENT spell list. Choose another one.`);
      }
      matched.taken.push(row.id);
      heldFeatIds.add(feat.id);
      chosenFeats.push(feat);
      chosenFeatSites.push(siteOfPick(matched, row));
    });
  }
  // Chosen feats' features join the granted set: their choices become offers for pass B.
  for (const [index, feat] of chosenFeats.entries()) {
    granted.push({ record: feat.feature, count: 1, origin: null, classId: null }); // recorded on `character.feats`
    featureOffer(feat.feature, 1, [], chosenFeatSites[index]);
  }
  for (const feat of chosenFeats) grantExtraPicks(feat.feature, 1, null);
  for (const { record, classId } of chosenInlineStyles) grantExtraPicks(record, 1, classId);

  // Pass A2: picks whose options carry their own mechanics (Divine Order, Giant Ancestry, Blessed
  // Strikes). Settled before pass B because a chosen option can itself ask for a pick.
  const optionKinds = new Set(offers.filter((offer) => offer.optionRecords !== null).map((offer) => offer.kind));
  const chosenOptionFeatures: Array<{ record: FeatureRecord; classId: string | null }> = [];
  for (const row of choices) {
    if (!optionKinds.has(row.kind) || FEAT_KINDS.has(row.kind)) continue;
    place(() => {
      const offer = offerFor(
        row,
        offers.filter((candidate) => candidate.kind === row.kind)
      );
      const option = offer.optionRecords?.find((candidate) => candidate.id === row.id);
      // A prerequisite the option itself prints ("a Warlock cantrip that deals damage") is checked before it is taken.
      const unmet = option ? offer.unmet.get(option.id) : undefined;
      if (unmet) reject(`${option!.name} is ${unmet}.`);
      offer.taken.push(row.id);
      if (!option) return; // a bare id in a mixed-kind offer: provenance only, nothing to interpret
      const asFeature = optionAsFeature(option);
      const classId = scaleOf(offer.featureId, offer.classId);
      // Recorded under the parent feature's id, which is where the catalog indexes the option.
      granted.push({
        record: asFeature,
        count: 1,
        origin: offer.featureId ? { kind: "option", sourceId: offer.featureId } : null,
        classId
      });
      // The option's own pick is keyed on the option id, with the parent feature id as an accepted alias.
      featureOffer(asFeature, 1, offer.featureId ? [offer.featureId] : [], siteOfPick(offer, row));
      chosenOptionFeatures.push({ record: asFeature, classId });
    });
  }
  // Folded after the loop so the result does not depend on ledger order.
  for (const { record, classId } of chosenOptionFeatures) grantExtraPicks(record, 1, classId);

  // A budget key that names nothing is an authoring error and fails loudly; checked against this
  // build's real offers plus each casting class's two printed columns. A draft still missing part of its
  // identity cannot tell yet (a species trait may raise a class budget), so it waits.
  const casters = castersOf(classes);
  const classBudgets = new Set(
    casters.flatMap(({ entry }) => [
      ...((entry.row.cantripsKnown ?? 0) > 0
        ? [classBudgetKey(CLASS_CANTRIP_BUDGET, entry.record.id, startingId)]
        : []),
      ...((entry.row.preparedCount ?? entry.row.spellsKnown ?? 0) > 0
        ? [classBudgetKey(CLASS_SPELL_BUDGET, entry.record.id, startingId)]
        : [])
    ])
  );
  const namesARealBudget = (key: string): boolean =>
    offers.some((candidate) => candidate.key === key) || classBudgets.has(key);
  if (starting && species && background) {
    for (const key of extraPickBudgets.keys()) {
      if (namesARealBudget(key)) continue;
      reject(
        `A feature grants an extra pick to "${key}", which is not a pick this build has. Name one of ${NAMED_PICK_BUDGETS.map((budget) => `"${budget}"`).join(", ")}, or a feature's own pick ("feature:<featureId>").`
      );
    }
    // A `replaces` clause naming no pick this build has is the same authoring error.
    for (const { record, classId } of granted) {
      for (const clause of record.replaces) {
        if (namesARealBudget(classBudgetKey(clause.offer, classId, startingId))) continue;
        reject(
          `"${record.name}" says a pick to "${clause.offer}" may be replaced, which is not a pick this build has. Name one of ${NAMED_PICK_BUDGETS.map((budget) => `"${budget}"`).join(", ")}, or a feature's own pick ("feature:<featureId>").`
        );
      }
    }
  }

  // Pass B: everything else. Class spells/cantrips (step 9), equipment, size and the subclass row aren't
  // offers. `hp-roll`, `ability-scores` and `class-levels` rows are build output, so an echoed ledger is accepted.
  const separateKinds = new Set(["equipment", "size", "hp-roll", "ability-scores", CLASS_LEVELS_KIND]);
  const casterIds = casters.map(({ entry }) => entry.record.id);
  const classSpellRows = new Map<string, { cantrips: CharacterChoice[]; spells: CharacterChoice[] }>();
  const strayClassSpellRows: CharacterChoice[] = [];
  for (const row of choices) {
    if (separateKinds.has(row.kind) || FEAT_KINDS.has(row.kind) || optionKinds.has(row.kind)) continue; // optionKinds were settled in pass A2
    place(() => {
      if (row.kind === "subclass") {
        const classId = row.classId ?? startingId;
        const chosen = classId === null ? null : (classOf.get(classId)?.subclass?.id ?? null);
        if (row.id !== chosen)
          reject(`The subclass choice row ("${row.id}") disagrees with the chosen subclass "${chosen ?? "none"}".`);
        const offer = offers.find((candidate) => candidate.kind === "subclass" && candidate.classId === classId);
        if (offer) offer.taken.push(row.id);
        return;
      }
      if (row.kind === "spell" || row.kind === "cantrip") {
        const featureTag = featureTagOf(row);
        const featureOffers = offers.filter((offer) => offer.kind === row.kind && offer.featureId !== null);
        const scoped = featureTag
          ? featureOffers.filter((offer) => offer.featureId === featureTag || offer.featureAliases.includes(featureTag))
          : [];
        if (scoped.length > 0) {
          matchRow(row, scoped);
          return;
        }
        if (featureTag) reject(`No feature "${featureTag}" offers a "${row.kind}" choice.`);
        // A class's own budget: the class the row names, else the only caster, else the starting class.
        const classId = row.classId ?? (casterIds.length === 1 ? casterIds[0] : startingId);
        if (classId === null || !casterIds.includes(classId)) {
          strayClassSpellRows.push(row);
          return;
        }
        const rows = classSpellRows.get(classId) ?? { cantrips: [], spells: [] };
        (row.kind === "spell" ? rows.spells : rows.cantrips).push(row);
        classSpellRows.set(classId, rows);
        return;
      }
      matchRow(
        row,
        offers.filter((offer) => offer.kind === row.kind)
      );
    });
  }

  // Level-gated options (an invocation's "Level 9+ Warlock") are learned as the class reaches that level, one per
  // pick gained there or one replacement per level gained since, so a build can't hold more of them than that.
  if (!lenient) {
    for (const offer of offers) {
      if (!offer.slotLevels || offer.classId === null || !offer.optionRecords) continue;
      const entry = classOf.get(offer.classId);
      if (!entry) continue;
      const taken = offer.taken.flatMap((id) => offer.optionRecords!.filter((option) => option.id === id));
      const gates = taken.filter((option) => (option.level ?? 1) > 1);
      const slots = [
        ...offer.slotLevels,
        ...Array.from({ length: Math.max(0, offer.capacity - offer.slotLevels.length) }, () => entry.level)
      ];
      for (const gate of [...new Set(gates.map((option) => option.level!))].sort((left, right) => right - left)) {
        if (
          levelGatesFit(
            gates.filter((option) => option.level! >= gate).map((option) => option.level!),
            slots,
            entry.level
          )
        )
          continue;
        const names = gates.filter((option) => option.level! >= gate).map((option) => option.name);
        const most = slots.filter((at) => at >= gate).length + Math.max(0, entry.level - Math.max(2, gate) + 1);
        const className = entry.record.name;
        reject(
          `${listed(names)} ${names.length === 1 ? "needs" : "need"} ${className} level ${gate} or more. A level ${entry.level} ${className} can have at most ${most} of them: one for each pick gained at level ${gate} or later, plus one replacement for each ${className} level from ${Math.max(2, gate)} on.`
        );
      }
    }
  }

  const extraSpellListsOf = (classId: string | null) =>
    granted.filter((entry) => entry.classId === classId).flatMap((entry) => entry.record.extraSpellLists ?? []);
  const classSpells: ClassSpellBudget[] = casters.map(({ entry, casting }, index) => {
    const id = entry.record.id;
    const printedCantrips = entry.row.cantripsKnown ?? 0;
    const printedPrepared = entry.row.preparedCount ?? entry.row.spellsKnown ?? 0;
    // A list a feat or species widens reaches the first caster's spells.
    const lists = [...new Set([...extraSpellListsOf(id), ...(index === 0 ? extraSpellListsOf(null) : [])])];
    const rows = classSpellRows.get(id);
    return {
      classId: id,
      className: entry.record.name,
      casting,
      takenAt: entry.characterLevels[0] ?? 1,
      printedCantrips,
      printedPrepared,
      cantrips: printedCantrips + (extraPickBudgets.get(classBudgetKey(CLASS_CANTRIP_BUDGET, id, startingId)) ?? 0),
      prepared: printedPrepared + (extraPickBudgets.get(classBudgetKey(CLASS_SPELL_BUDGET, id, startingId)) ?? 0),
      maxSlotLevel: maxSlotLevelOf(entry.row),
      listSlug: classSpellListSlug(casting.spellListId ?? id, lists),
      cantripRows: rows?.cantrips ?? [],
      spellRows: rows?.spells ?? []
    };
  });
  return {
    // A later class's skill offer that none of its features raised has nothing to pick.
    offers: offers.filter((offer) => offer.capacity > 0),
    lineage,
    originFeat,
    granted,
    chosenFeats,
    chosenFeatLevels: chosenFeatSites.map((site) => site.levels[0] ?? 1),
    asiLevels,
    extraSpellLists: [...new Set(granted.flatMap(({ record }) => record.extraSpellLists ?? []))],
    heldFeatIds,
    extraPickBudgets,
    classSpells,
    strayClassSpellRows,
    catalogs
  };
}

/** The highest spell slot level a class table row gives; Pact Magic is all one level. */
export function maxSlotLevelOf(levelRow: ClassLevelRow): number {
  const slots = levelRow.pactSlots
    ? levelRow.pactSlots.slots > 0
      ? [levelRow.pactSlots.level]
      : []
    : (levelRow.spellSlots ?? []).flatMap((count, index) => (count > 0 ? [index + 1] : []));
  return slots.reduce((highest, slotLevel) => Math.max(highest, slotLevel), 0);
}

/** The catalog slug of a class's own spell list, widened by the lists its features add (Magical Secrets). */
export function classSpellListSlug(listId: string, extraSpellLists: readonly string[]): string {
  return [listId, ...extraSpellLists.filter((extra) => extra !== listId)].map((id) => `${id}-spells`).join("-or-");
}

/** A casting class's spell list resolved to its options; a catalog gap leaves it empty with the resolver's reason. */
export function classSpellOptions(
  budget: Pick<ClassSpellBudget, "listSlug">,
  catalogs: CatalogChoiceCatalogs
): Readonly<{ options: readonly CatalogChoiceOption[]; unresolvable: string | null }> {
  try {
    return { options: resolveCatalogChoice(budget.listSlug, catalogs), unresolvable: null };
  } catch (error) {
    if (!(error instanceof CatalogChoiceError)) throw error;
    return { options: [], unresolvable: error.message };
  }
}
