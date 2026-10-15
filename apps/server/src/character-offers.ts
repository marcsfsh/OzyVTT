import type { BuilderPolicy } from "@vtt/domain";
import {
  CatalogChoiceError,
  extraPickAmount,
  resolveCatalogChoice,
  resolvePickChoice,
  type CatalogChoiceCatalogs
} from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES,
  ABILITY_ROLL_FORMULA,
  isPointBuyLegal,
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

function reject(message: string): never {
  throw new CommandRejectedError(message);
}

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
  taken: string[];
};

function offerOf(
  partial: Pick<ChoiceOffer, "key" | "kind" | "capacity" | "options" | "label"> & Partial<ChoiceOffer>
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
    taken: [],
    ...partial
  };
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
 *  six offer keys plus the `class-cantrips` / `class-spells` columns. Shared with the wizard. */
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
  if (!policy.allowedAbilityMethods.includes(input.abilityMethod)) {
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
    reject(`${background.name} grants ability increases - choose a +2/+1 or +1/+1/+1 spread.`);
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
export type ServerOfferSurvey = Readonly<{
  offers: readonly ChoiceOffer[];
  classRecord: ClassReference;
  species: SpeciesReference;
  background: BackgroundReference;
  subclass: SubclassReference | null;
  lineage: SpeciesReference["lineages"][number] | null;
  originFeat: FeatReference | null;
  levelRow: ClassLevelRow;
  /** Every feature held so far with its provenance (the origin feat and chosen feats carry `origin: null`). */
  granted: ReadonlyArray<{ record: FeatureRecord; count: number; origin: CharacterFeatureOrigin | null }>;
  chosenFeats: readonly FeatReference[];
  /** Every feat id already held: the cross-offer duplicate guard. */
  heldFeatIds: ReadonlySet<string>;
  extraPickBudgets: ReadonlyMap<string, number>;
  preparedSpellRows: readonly CharacterChoice[];
  classCantripRows: readonly CharacterChoice[];
  /** The printed level-row columns, before `extraPickBudgets` is added (step 9 does that sum). */
  printedCantrips: number;
  printedPrepared: number;
  catalogs: CatalogChoiceCatalogs;
  progression: ClassProgressionTable;
  /** Ability scores after background and species bonuses, before any ASI or feature rider. */
  scoresBeforeIncreases: Record<Ability, number>;
  proficiencyBonus: number;
}>;

export const CLASS_CANTRIP_BUDGET: NamedPickBudget = "class-cantrips";
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
  const catalogs = library.catalogChoiceCatalogs();
  const progression: ClassProgressionTable = library.classProgressionTable();

  // ---- 1. Identity ids resolve against the catalogs. ----
  // No multiclass prerequisite check: the input is single-class and SRD minimums apply to a second class.
  const classRecord: ClassReference =
    library.classRecord(input.classId) ?? reject(`No class "${input.classId}" is in the content catalog.`);
  const species: SpeciesReference =
    library.speciesRecord(input.speciesId) ?? reject(`No species "${input.speciesId}" is in the content catalog.`);
  const background: BackgroundReference =
    library.backgroundRecord(input.backgroundId) ??
    reject(`No background "${input.backgroundId}" is in the content catalog.`);
  let subclass: SubclassReference | null = null;
  if (input.level >= classRecord.subclassLevel) {
    if (!input.subclassId)
      reject(
        `A level-${input.level} ${classRecord.name} has a ${classRecord.subclassLabel ?? "subclass"} (chosen at level ${classRecord.subclassLevel}).`
      );
    subclass =
      library.subclassRecord(input.subclassId!) ??
      reject(`No subclass "${input.subclassId}" is in the content catalog.`);
    if (subclass.classId !== classRecord.id)
      reject(`${subclass.name} is a ${subclass.classId} subclass, not a ${classRecord.name} one.`);
  } else if (input.subclassId) {
    reject(
      `${classRecord.name} chooses its ${classRecord.subclassLabel ?? "subclass"} at level ${classRecord.subclassLevel}; a level-${input.level} character has none.`
    );
  }
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

  // Proficiency bonus tracks total character level (the multiclass rule), which equals class level here.
  const proficiencyBonus = proficiencyBonusForLevel(input.level);
  const { features: classFeatures, row: levelRow } = grantedClassFeatures(classRecord, input.level);

  // ---- 3. Collect every granted feature (class rows, subclass, species + lineage, background, origin feat). ----
  const chosenLineageId = input.choices.find((row) => row.kind === "lineage")?.id ?? null;
  const lineage = chosenLineageId
    ? (species.lineages.find((candidate) => candidate.id === chosenLineageId) ??
      reject(`"${species.name}" has no lineage "${chosenLineageId}".`))
    : null;
  // In "offers" mode the lineage may still be unanswered; answering it is the caller's job.
  if (mode === "build" && !chosenLineageId && species.traits.some((trait) => trait.choice?.kind === "lineage"))
    reject(`${species.name} asks for a lineage choice.`);
  const subclassFeatures = (subclass?.features ?? []).filter(
    (feature) => (feature.level ?? subclass?.subclassLevel ?? classRecord.subclassLevel) <= input.level
  );
  const originFeat: FeatReference | null = background.originFeatId
    ? (library.featRecord(background.originFeatId) ??
      reject(`${background.name} grants unknown feat "${background.originFeatId}".`))
    : null;
  // Every feat this character already holds, granted or chosen - the cross-offer duplicate guard in pass A.
  const heldFeatIds = new Set<string>(originFeat ? [originFeat.id] : []);
  // `origin` becomes `definition.character.features` (how roll-time riders reach the table); null means
  // already on `character.feats`. `ORIGIN_STEP`: where origin picks sit in the wizard's grid.
  const ORIGIN_STEP = { levels: [1], classId: null } as const;
  const subclassStep = (record: FeatureRecord) => ({
    levels: [record.level ?? subclass?.subclassLevel ?? classRecord.subclassLevel],
    classId: classRecord.id
  });
  const granted: Array<{
    record: FeatureRecord;
    count: number;
    origin: CharacterFeatureOrigin | null;
    where?: { levels: readonly number[]; classId: string | null };
  }> = [
    ...[...classFeatures.values()].map((entry) => ({
      ...entry,
      origin: { kind: "class", sourceId: classRecord.id } as const,
      where: { levels: entry.levels, classId: classRecord.id }
    })),
    ...subclassFeatures.map((record) => ({
      record,
      count: 1,
      origin: { kind: "subclass", sourceId: subclass!.id } as const,
      where: subclassStep(record)
    })),
    ...species.traits.map((record) => ({
      record,
      count: 1,
      origin: { kind: "species", sourceId: species.id } as const,
      where: ORIGIN_STEP
    })),
    ...(lineage?.traits ?? []).map((record) => ({
      record,
      count: 1,
      origin: { kind: "lineage", sourceId: lineage!.id } as const,
      where: ORIGIN_STEP
    })),
    ...background.features.map((record) => ({
      record,
      count: 1,
      origin: { kind: "background", sourceId: background.id } as const,
      where: ORIGIN_STEP
    })),
    ...(originFeat ? [{ record: originFeat.feature, count: 1, origin: null, where: ORIGIN_STEP }] : [])
  ];

  // ---- 4. Build the choice offers and match every ledger row against them. ----
  // Pass A settles chosen feats first, since a feat can ask for picks that pass B must see.
  const offers: ChoiceOffer[] = [];
  const listOffer = (
    key: NamedPickBudget,
    kind: string,
    label: string,
    list: { choose: number; from: readonly string[]; fromCatalog?: string } | undefined,
    classId: string | null
  ) => {
    if (!list || list.choose <= 0) return;
    // A choose-N list may draw on an open catalog too (the species' Standard Languages), resolved through
    // the same `resolveCatalogChoice` the wizard uses; a catalog gap defers the pick.
    const options = new Set(list.from);
    let unresolvable: string | null = null;
    if (list.fromCatalog) {
      try {
        for (const option of resolveCatalogChoice(list.fromCatalog, catalogs)) options.add(option.id);
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        if (options.size === 0) unresolvable = error.message;
      }
    }
    offers.push(offerOf({ key, kind, capacity: list.choose, options, unresolvable, label, classId }));
  };
  listOffer("class-skills", "skill", `${classRecord.name} skills`, classRecord.skillChoices, classRecord.id);
  listOffer("class-tools", "tool", `${classRecord.name} tools`, classRecord.toolChoices, classRecord.id);
  listOffer("background-skills", "skill", `${background.name} skills`, background.skillChoices, null);
  listOffer("background-tools", "tool", `${background.name} tools`, background.toolChoices, null);
  listOffer("background-languages", "language", `${background.name} languages`, background.languageChoices, null);
  listOffer("species-languages", "language", `${species.name} languages`, species.languageChoices, null);
  // Whether an option is already in the ledger (what `options[].requires` gates on), scoped the way
  // `matchRow` scopes a row.
  const ledgerAnswered = (offerKey: string, optionId: string): boolean => {
    const featureId = offerKey.startsWith("feature:") ? offerKey.slice("feature:".length).replace(/\/\d+$/, "") : null;
    return input.choices.some(
      (row) =>
        row.id === optionId &&
        (featureId === null ||
          (row.payload && typeof row.payload.featureId === "string" && row.payload.featureId === featureId))
    );
  };
  /** Options a gate determined rather than offered; drained into `granted` once every offer is built. */
  const determined: Array<{
    option: FeatureOption;
    parentId: string;
    where: { levels: readonly number[]; classId: string | null };
  }> = [];
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
  const answersFor = (offerKey: string): string[] => {
    if (offerKey.startsWith("feature:")) {
      const featureId = offerKey.slice("feature:".length).replace(/\/\d+$/, "");
      return input.choices.filter((row) => row.payload && row.payload.featureId === featureId).map((row) => row.id);
    }
    const kind = NAMED_BUDGET_KIND[offerKey];
    if (!kind) return [];
    return input.choices
      .filter((row) => row.kind === kind && !(row.payload && typeof row.payload.featureId === "string"))
      .map((row) => row.id);
  };
  type OfferStep = Readonly<{ levels: readonly number[]; classId: string | null }>;
  const featureOffer = (
    record: FeatureRecord,
    count: number,
    featureAliases: readonly string[] = [],
    where: OfferStep = ORIGIN_STEP
  ): void => {
    // Every pick the record owes becomes its own offer; the first keeps the plain `feature:<id>` key,
    // later ones take `/2`, `/3`, ...
    featurePicks(record).forEach((choice, index) =>
      featurePickOffer(record, choice, index, count, featureAliases, where)
    );
  };
  const featurePickOffer = (
    record: FeatureRecord,
    choice: NonNullable<FeatureRecord["choice"]>,
    index: number,
    count: number,
    featureAliases: readonly string[],
    where: OfferStep
  ): void => {
    if (choice.choose * count === 0) return;
    let options: ReadonlySet<string>;
    let optionLevels: ReadonlyMap<string, number> | null = null;
    let unresolvable: string | null = null;
    // Inline `options` carry their own mechanics. When both a catalog and bespoke options are authored
    // the offer is their union, matching the wizard.
    const named = choice.from ?? [];
    // Options drawn from the character's own earlier answers ("one of your known Warlock cantrips"),
    // read from `input.choices`, which is complete before any pass runs.
    if (choice.fromPicks) {
      try {
        const resolved = resolvePickChoice(choice.fromPicks, answersFor(choice.fromPicks.offer), catalogs);
        options = new Set(resolved.map((option) => option.id));
        if (resolved.some((option) => option.level !== undefined))
          optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
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
        if (resolved.some((option) => option.level !== undefined))
          optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
      } catch (error) {
        // The bespoke half still stands when the catalog half is a content gap.
        if (!(error instanceof CatalogChoiceError)) throw error;
      }
    } else if (named.length > 0) options = new Set(named);
    else if (!choice.fromCatalog) {
      // `{kind, choose, from: []}` passes the content schema but cannot resolve; reject it as bad content
      // instead of letting a raw TypeError reach the client.
      reject(
        `"${record.name}" offers a "${choice.kind}" choice with no options - its content record needs a non-empty "from" list or a "fromCatalog" slug.`
      );
    } else {
      try {
        const resolved = resolveCatalogChoice(choice.fromCatalog!, catalogs);
        options = new Set(resolved.map((option) => option.id));
        if (resolved.some((option) => option.level !== undefined))
          optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        // Partial-content gap: the pick is deferred, but a row targeting it still fails with the resolver's message.
        options = new Set();
        unresolvable = error.message;
      }
    }
    /** Options gated on an earlier answer: unmet gates drop out, and if the survivors exactly fill the
     *  capacity they are adopted without pushing an offer. */
    let optionRecords = choice.options ?? null;
    if (optionRecords?.some((option) => option.requires)) {
      const legal = optionRecords.filter(
        (option) => !option.requires || ledgerAnswered(option.requires.offer, option.requires.id)
      );
      optionRecords = legal;
      options = new Set(legal.map((option) => option.id));
      if (legal.length === choice.choose * count) {
        for (const option of legal) determined.push({ option, parentId: record.id, where });
        return;
      }
    }
    offers.push(
      offerOf({
        key: index === 0 ? `feature:${record.id}` : `feature:${record.id}/${index + 1}`,
        featureId: record.id,
        featureAliases,
        kind: choice.kind,
        capacity: choice.choose * count,
        options,
        optionLevels,
        optionRecords,
        unresolvable,
        repeatable: choice.repeatable,
        maxSpellLevel: choice.maxSpellLevel ?? null,
        minSpellLevel: choice.minSpellLevel ?? null,
        maximum: choice.maximum ?? null,
        label: record.name,
        levels: where.levels,
        classId: where.classId
      })
    );
  };
  for (const { record, count, where } of granted) featureOffer(record, count, [], where);

  /** Adopts determined options; a queue, because an adopted option may determine another. */
  while (determined.length > 0) {
    const { option, parentId, where } = determined.shift()!;
    const asFeature = optionAsFeature(option);
    granted.push({ record: asFeature, count: 1, origin: { kind: "option", sourceId: parentId } });
    featureOffer(asFeature, 1, [parentId], where);
  }

  /** Extra picks raise a budget rather than grant an outcome. Grants add up; each is folded in as soon as
   *  its source is settled, because `matchRow` refuses picks over `capacity`. */
  const extraPickBudgets = new Map<string, number>();
  const grantExtraPicks = (record: FeatureRecord, count: number): void => {
    for (const grant of record.extraPicks) {
      // `extraPickAmount` is shared with the wizard so a scaled budget cannot be computed two ways.
      const amount = extraPickAmount(grant, classRecord.levelTable, input.level) * count;
      extraPickBudgets.set(grant.offer, (extraPickBudgets.get(grant.offer) ?? 0) + amount);
      // `class-cantrips` / `class-spells` are level-row columns read at step 9, so no matching offer is not yet an error.
      const offer = offers.find((candidate) => candidate.key === grant.offer);
      if (offer) offer.capacity += amount;
    }
  };
  for (const { record, count } of granted) grantExtraPicks(record, count);

  const featureTagOf = (row: CharacterChoice): string | null =>
    row.payload && typeof row.payload.featureId === "string" ? row.payload.featureId : null;
  const matchRow = (row: CharacterChoice, candidates: readonly ChoiceOffer[]): ChoiceOffer => {
    const featureTag = featureTagOf(row);
    const scoped = featureTag
      ? candidates.filter((offer) => offer.featureId === featureTag || offer.featureAliases.includes(featureTag))
      : candidates;
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
      const level = outOfWindow.optionLevels?.get(row.id) ?? 0;
      reject(
        outOfWindow.minSpellLevel !== null && level < outOfWindow.minSpellLevel
          ? `"${row.id}" is level ${level}, below the minimum spell level (${outOfWindow.minSpellLevel}) for "${outOfWindow.label}".`
          : `"${row.id}" is level ${level}, above the maximum spell level (${outOfWindow.maxSpellLevel}) for "${outOfWindow.label}".`
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
    offer.taken.push(row.id);
    return offer;
  };

  /** The single grant the just-taken row belongs to, so a feat taken at level 8 records its picks at 8. */
  const stepOfPick = (offer: ChoiceOffer): OfferStep => ({
    levels: [levelOfPick(offer, Math.max(0, offer.taken.length - 1))],
    classId: offer.classId
  });

  // Pass A: feat selections. "asi" is the built-in shorthand (payload.increases).
  const FEAT_KINDS = new Set(["feat", "fighting-style", "asi-or-feat"]);
  const chosenFeats: FeatReference[] = [];
  /** Where each chosen feat was taken; a feat's own picks belong to that offer's level/class. */
  const chosenFeatSteps: OfferStep[] = [];
  /** Inline options answered to a feat-kinded pick (Blessed Warrior, Druidic Warrior). */
  const chosenInlineStyles: FeatureRecord[] = [];
  for (const row of input.choices) {
    if (!FEAT_KINDS.has(row.kind)) continue;
    if (row.kind === "asi-or-feat" && row.id === "asi") {
      const offer =
        offers.find((candidate) => candidate.kind === "asi-or-feat" && candidate.taken.length < candidate.capacity) ??
        reject(`No Ability Score Improvement is available to spend at level ${row.level}.`);
      offer.taken.push(row.id);
      continue;
    }
    const matched = matchRow(
      row,
      offers.filter((offer) => offer.kind === row.kind)
    );
    // A feat-kinded pick may be answered by an inline option (Blessed Warrior beside the Fighting Style
    // catalog); it is interpreted like any chosen option in pass A2.
    const inlineOption = matched.optionRecords?.find((candidate) => candidate.id === row.id);
    if (inlineOption) {
      const asFeature = optionAsFeature(inlineOption);
      granted.push({
        record: asFeature,
        count: 1,
        origin: matched.featureId ? { kind: "option", sourceId: matched.featureId } : null
      });
      featureOffer(asFeature, 1, matched.featureId ? [matched.featureId] : [], stepOfPick(matched));
      chosenInlineStyles.push(asFeature);
      continue;
    }
    const feat = library.featRecord(row.id) ?? reject(`No feat "${row.id}" is in the content catalog.`);
    // The same feat may not be taken twice across different offers (`repeatable:false` only guards one
    // offer). The held set includes the background's granted origin feat.
    if (heldFeatIds.has(feat.id)) {
      if (!feat.repeatable)
        reject(
          `${feat.name} is already on this character - a feat can only be taken once unless it says it is repeatable.`
        );
      if (repeatsOnlyWithADifferentSpellList(feat))
        reject(`${feat.name} may be taken again only with a DIFFERENT spell list - choose another one.`);
    }
    heldFeatIds.add(feat.id);
    chosenFeats.push(feat);
    chosenFeatSteps.push(stepOfPick(matched));
  }
  // Chosen feats' features join the granted set: their choices become offers for pass B.
  for (const [index, feat] of chosenFeats.entries()) {
    granted.push({ record: feat.feature, count: 1, origin: null }); // recorded on `character.feats`
    featureOffer(feat.feature, 1, [], chosenFeatSteps[index]);
  }
  for (const feat of chosenFeats) grantExtraPicks(feat.feature, 1);
  for (const record of chosenInlineStyles) grantExtraPicks(record, 1);

  // Pass A2: picks whose options carry their own mechanics (Divine Order, Giant Ancestry, Blessed
  // Strikes). Settled before pass B because a chosen option can itself ask for a pick.
  const optionKinds = new Set(offers.filter((offer) => offer.optionRecords !== null).map((offer) => offer.kind));
  const chosenOptionFeatures: FeatureRecord[] = [];
  for (const row of input.choices) {
    if (!optionKinds.has(row.kind) || FEAT_KINDS.has(row.kind)) continue;
    const offer = matchRow(
      row,
      offers.filter((candidate) => candidate.kind === row.kind)
    );
    const option = offer.optionRecords?.find((candidate) => candidate.id === row.id);
    if (!option) continue; // a bare id in a mixed-kind offer: provenance only, nothing to interpret
    const asFeature = optionAsFeature(option);
    // Recorded under the parent feature's id, which is where the catalog indexes the option.
    granted.push({
      record: asFeature,
      count: 1,
      origin: offer.featureId ? { kind: "option", sourceId: offer.featureId } : null
    });
    // The option's own pick is keyed on the option id, with the parent feature id as an accepted alias.
    featureOffer(asFeature, 1, offer.featureId ? [offer.featureId] : [], stepOfPick(offer));
    chosenOptionFeatures.push(asFeature);
  }
  // Folded after the loop so the result does not depend on ledger order.
  for (const record of chosenOptionFeatures) grantExtraPicks(record, 1);

  // A budget key that names nothing is an authoring error and fails loudly; checked against this
  // build's real offers plus the two printed class columns.
  const printedCantrips = levelRow.cantripsKnown ?? 0;
  const printedPrepared = levelRow.preparedCount ?? levelRow.spellsKnown ?? 0;
  const namesARealBudget = (key: string): boolean =>
    offers.some((candidate) => candidate.key === key) ||
    (key === CLASS_CANTRIP_BUDGET && printedCantrips > 0) ||
    (key === CLASS_SPELL_BUDGET && printedPrepared > 0);
  for (const key of extraPickBudgets.keys()) {
    if (namesARealBudget(key)) continue;
    reject(
      `A feature grants an extra pick to "${key}", which is not a pick this build has. Name one of ${NAMED_PICK_BUDGETS.map((budget) => `"${budget}"`).join(", ")}, or a feature's own pick ("feature:<featureId>").`
    );
  }
  // A `replaces` clause naming no pick this build has is the same authoring error.
  for (const { record } of granted) {
    for (const clause of record.replaces) {
      if (namesARealBudget(clause.offer)) continue;
      reject(
        `"${record.name}" says a pick to "${clause.offer}" may be replaced, which is not a pick this build has. Name one of ${NAMED_PICK_BUDGETS.map((budget) => `"${budget}"`).join(", ")}, or a feature's own pick ("feature:<featureId>").`
      );
    }
  }

  // Pass B: everything else. Class spells/cantrips (step 9), equipment, size and the subclass row aren't
  // offers. `hp-roll` rows are build output, so an echoed ledger is accepted.
  const separateKinds = new Set(["equipment", "size", "hp-roll"]);
  const preparedSpellRows: CharacterChoice[] = [];
  const classCantripRows: CharacterChoice[] = [];
  for (const row of input.choices) {
    if (separateKinds.has(row.kind) || FEAT_KINDS.has(row.kind) || optionKinds.has(row.kind)) continue; // optionKinds were settled in pass A2
    if (row.kind === "subclass") {
      if (row.id !== input.subclassId)
        reject(
          `The subclass choice row ("${row.id}") disagrees with the chosen subclass "${input.subclassId ?? "none"}".`
        );
      const offer = offers.find((candidate) => candidate.kind === "subclass");
      if (offer) offer.taken.push(row.id);
      continue;
    }
    if (row.kind === "spell" || row.kind === "cantrip") {
      const featureTag = featureTagOf(row);
      const featureOffers = offers.filter((offer) => offer.kind === row.kind && offer.featureId !== null);
      const scoped = featureTag
        ? featureOffers.filter((offer) => offer.featureId === featureTag || offer.featureAliases.includes(featureTag))
        : [];
      if (scoped.length > 0) {
        matchRow(row, scoped);
        continue;
      }
      if (featureTag) reject(`No feature "${featureTag}" offers a "${row.kind}" choice.`);
      (row.kind === "spell" ? preparedSpellRows : classCantripRows).push(row);
      continue;
    }
    matchRow(
      row,
      offers.filter((offer) => offer.kind === row.kind)
    );
  }
  return {
    offers,
    classRecord,
    species,
    background,
    subclass,
    lineage,
    originFeat,
    levelRow,
    granted,
    chosenFeats,
    heldFeatIds,
    extraPickBudgets,
    preparedSpellRows,
    classCantripRows,
    printedCantrips,
    printedPrepared,
    catalogs,
    progression,
    scoresBeforeIncreases: finalScores,
    proficiencyBonus
  };
}
