import {
  CatalogChoiceError,
  extraPickAmount,
  resolveCatalogChoice,
  resolvePickChoice,
  type BuilderAbilityMethod,
  type BuilderPolicy,
  type CatalogChoiceOption,
  type ContentBackgroundSummary,
  type ContentChoiceList,
  type ContentClassSummary,
  type ContentExtraPickSummary,
  type ContentFeatSummary,
  type ContentFeatureSummary,
  type ContentSpeciesSummary,
  type ContentSubclassSummary
} from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES,
  ABILITY_ROLL_FORMULA,
  abilityModifier,
  hitDieFaces,
  isPointBuyLegal,
  pointBuyRemaining,
  POINT_BUY_BUDGET,
  POINT_BUY_MAXIMUM,
  POINT_BUY_MINIMUM,
  STANDARD_ARRAY,
  validateAbilityFormula,
  type Ability,
  type HitDie
} from "@vtt/rules-5e";
import type { BuilderCatalogs } from "../content/catalogs";

/**
 * The character builder's draft model and payload assembly (pure, no React, no socket).
 *
 * The wizard collects choices, never a finished sheet; feature riders stay server-side. This module:
 *   1. works out what the content asks the player to pick (`computeOffers`), resolving `fromCatalog`
 *      slugs with `resolveCatalogChoice`, the same function `character-build.ts` re-validates with;
 *   2. turns the answers into the `character.create` payload (`buildCreatePayload`).
 *
 * Game outcomes (HP, AC, slots, prerequisites) are decided by the server. The few numbers computed
 * here (ability totals, point-buy budget) are previews of the player's inputs; the server's win.
 */

export const BUILDER_DRAFT_VERSION = 1;

export type PickMap = Readonly<Record<string, readonly string[]>>;

/** The in-progress build; `draft.ts` persists exactly this shape. */
export type BuilderDraft = {
  version: number;
  speciesId: string | null;
  backgroundId: string | null;
  classId: string | null;
  level: number;
  /** Mirrors the `subclass` offer's pick; sent as the payload's top-level `subclassId`. */
  subclassId: string | null;
  abilityMethod: BuilderAbilityMethod;
  /** assign-mode: the six generated values, in draw order. */
  abilityPool: ReadonlyArray<{ id: string; value: number }>;
  /** assign-mode: ability -> pool entry id. */
  poolAssignment: Readonly<Record<string, string | null>>;
  /** spend-mode (point buy): the base score per ability. */
  spendScores: Readonly<Record<string, number>>;
  backgroundBonus: ReadonlyArray<{ ability: Ability; amount: number }>;
  hpMode: "average" | "entries";
  /** One roll per level 2..level, in level order. */
  hpEntries: readonly number[];
  /** offer key -> chosen option ids (order preserved; one entry per pick). */
  picks: PickMap;
  /** offer key -> the ASI shorthand's +2 split, when that offer took the ability route. */
  asiIncreases: Readonly<Record<string, ReadonlyArray<{ ability: Ability; amount: number }>>>;
  name: string;
};

export function emptyDraft(): BuilderDraft {
  return {
    version: BUILDER_DRAFT_VERSION,
    speciesId: null,
    backgroundId: null,
    classId: null,
    level: 1,
    subclassId: null,
    abilityMethod: "standard-array",
    abilityPool: STANDARD_ARRAY.map((value, index) => ({ id: `sa-${index}`, value })),
    poolAssignment: {},
    spendScores: Object.fromEntries(ABILITIES.map((ability) => [ability, POINT_BUY_MINIMUM])),
    backgroundBonus: [],
    hpMode: "average",
    hpEntries: [],
    picks: {},
    asiIncreases: {},
    name: ""
  };
}

// Offers: everything the content asks this build to pick.

/** Which wizard step owns an offer. Rule: the step that chose the SOURCE owns its picks. */
export type OfferStep = "species" | "background" | "class" | "features" | "equipment";

export type BuilderOffer = Readonly<{
  /** Stable key into `draft.picks`. */
  key: string;
  step: OfferStep;
  /** Written to the ledger row's `payload.featureId` when the offer came from a feature. A
      list-derived offer (class skills, background languages) must send no featureId, or the
      server scopes the row to a feature that never offered it. */
  featureId: string | null;
  kind: string;
  label: string;
  help: string | null;
  capacity: number;
  options: readonly CatalogChoiceOption[];
  maxSpellLevel: number | null;
  /** Character level stamped on this offer's ledger rows. */
  level: number;
  classId: string | null;
  /** Set when a `fromCatalog` slug resolved to nothing (a content gap, not a player error). The
      pick is then deferred rather than required, as on the server. */
  unresolvable: string | null;
  /**
   * Option id -> why this build already has it, for proficiency kinds a character holds only once.
   * Present (possibly empty) on those kinds, null otherwise. The options are disabled, not filtered,
   * so a pick in a parked draft does not vanish when an earlier step changes.
   */
  unavailable: Readonly<Record<string, string>> | null;
}>;

/**
 * Every pick a feature owes; the client's mirror of the content package's `featurePicks`.
 * `choice` is the first and `choices` the whole list, so read both.
 */
const featurePicksOf = (feature: ContentFeatureSummary): readonly NonNullable<ContentFeatureSummary["choice"]>[] =>
  feature.choices.length > 0 ? feature.choices : feature.choice ? [feature.choice] : [];

const optionsOfIds = (ids: readonly string[], nameOf: (id: string) => string): CatalogChoiceOption[] =>
  ids.map((id) => ({ id, name: nameOf(id) }));

const titleize = (id: string) =>
  id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** Resolves a feature's choice to concrete options, never throwing: a gap becomes `unresolvable`. */
function resolveChoice(
  choice: NonNullable<ContentFeatureSummary["choice"]>,
  catalogs: BuilderCatalogs,
  nameOf: (id: string) => string,
  answersFor: (offer: string) => readonly string[]
): { options: CatalogChoiceOption[]; unresolvable: string | null } {
  // Options drawn from the character's own earlier answers ("one of your known Warlock cantrips"),
  // resolved with the server's function. Too early (nothing chosen yet), it defers with the
  // resolver's message instead of showing an empty list.
  if (choice.fromPicks) {
    try {
      return {
        options: resolvePickChoice(choice.fromPicks, answersFor(choice.fromPicks.offer), catalogs.choice),
        unresolvable: null
      };
    } catch (error) {
      if (!(error instanceof CatalogChoiceError)) throw error;
      return { options: [], unresolvable: error.message };
    }
  }
  const named = choice.from.length > 0 ? optionsOfIds(choice.from, nameOf) : [];
  // A catalog plus bespoke inline options (e.g. "a Fighting Style feat or Blessed Warrior"): the two
  // are unioned, inline entries first, and an id in both keeps its inline record.
  if (!choice.fromCatalog) {
    return named.length > 0
      ? { options: named, unresolvable: null }
      : { options: [], unresolvable: "this pick names no option list." };
  }
  try {
    const catalog = resolveCatalogChoice(choice.fromCatalog, catalogs.choice);
    const inline = new Set(named.map((option) => option.id));
    return { options: [...named, ...catalog.filter((option) => !inline.has(option.id))], unresolvable: null };
  } catch (error) {
    if (!(error instanceof CatalogChoiceError)) throw error;
    // A content gap in the catalog half must not take the bespoke half down with it.
    return named.length > 0 ? { options: named, unresolvable: null } : { options: [], unresolvable: error.message };
  }
}

export type OfferContext = Readonly<{
  species: ContentSpeciesSummary | null;
  background: ContentBackgroundSummary | null;
  classRecord: ContentClassSummary | null;
  subclass: ContentSubclassSummary | null;
  originFeat: ContentFeatSummary | null;
  /** The class's level row for the draft's level (display data: slots, cantrips, prepared cap). */
  levelRow: ContentClassSummary["levelTable"][number] | null;
  /** The class/subclass spell list id, when this build casts. */
  spellListId: string | null;
  hitDie: HitDie | null;
}>;

export function offerContext(draft: BuilderDraft, catalogs: BuilderCatalogs): OfferContext {
  const species = catalogs.choice.species.find((entry) => entry.id === draft.speciesId) ?? null;
  const background = catalogs.backgrounds.find((entry) => entry.id === draft.backgroundId) ?? null;
  const classRecord = catalogs.choice.classes.find((entry) => entry.id === draft.classId) ?? null;
  const subclass = catalogs.choice.subclasses.find((entry) => entry.id === draft.subclassId) ?? null;
  const originFeat = background?.originFeatId
    ? (catalogs.choice.feats.find((entry) => entry.id === background.originFeatId) ?? null)
    : null;
  const levelRow = classRecord?.levelTable.find((row) => row.level === draft.level) ?? null;
  // Mirrors the server's `subclass?.spellcasting ?? class.spellcasting` so the spell step offers the
  // list the server will accept.
  const casting = subclass?.spellcasting ?? classRecord?.spellcasting ?? null;
  return {
    species,
    background,
    classRecord,
    subclass,
    originFeat,
    levelRow,
    spellListId: casting ? (casting.spellListId ?? classRecord?.id ?? null) : null,
    hitDie: (classRecord?.hitDie as HitDie | undefined) ?? null
  };
}

/** The class features a level-`level` character has been granted, with how many times. */
function grantedClassFeatures(
  classRecord: ContentClassSummary,
  level: number
): Array<{ feature: ContentFeatureSummary; level: number }> {
  const granted: Array<{ feature: ContentFeatureSummary; level: number }> = [];
  for (const feature of classRecord.features) {
    // `grantedAtLevels` is the level table's server-resolved repeat count, the only thing that agrees
    // with the server's `choose x grants` capacity (Expertise at 1 and 6, Metamagic at 2, 10, 17...).
    if (feature.grantedAtLevels.length > 0) {
      for (const grantLevel of feature.grantedAtLevels)
        if (grantLevel <= level) granted.push({ feature, level: grantLevel });
      continue;
    }
    // No level-table grant: a species trait, a feat, a subclass feature. `level` stands alone.
    if (feature.level != null) {
      if (feature.level <= level) granted.push({ feature, level: feature.level });
      continue;
    }
    granted.push({ feature, level: 1 });
  }
  return granted;
}

/** The offer kinds whose answer is a feat (the server's `FEAT_KINDS` in `character-build.ts`). */
export const FEAT_KINDS: ReadonlySet<string> = new Set(["feat", "fighting-style", "asi-or-feat"]);

/**
 * The offer kinds whose answer is a proficiency, which a character can never usefully hold twice.
 * The server merges duplicates and only guards per offer, so taking one twice silently wastes a pick.
 */
const HELD_KINDS: ReadonlySet<string> = new Set(["skill", "skill-or-tool", "expertise", "tool", "language"]);

/**
 * The kinds whose options are disabled once already held. `expertise` is excluded: SRD expertise
 * requires proficiency (the server rejects it otherwise), so it takes the inverse rule in
 * `withExpertiseReach` instead.
 */
const PROVENANCE_KINDS: ReadonlySet<string> = new Set(["skill", "skill-or-tool", "tool", "language"]);

/** What to call one of these picks in an instruction. */
const kindNoun = (kind: string) =>
  // `expertise` options are skills, so name them as such.
  kind === "skill" || kind === "expertise"
    ? "skill"
    : kind === "tool"
      ? "tool"
      : kind === "language"
        ? "language"
        : "option";

/**
 * Every pick this build owes, in step order. Mirrors `character-build.ts`'s offer machinery (same
 * sources, same `resolveCatalogChoice`, same capacities), so a build satisfying every offer here
 * is one the server accepts.
 */
export function computeOffers(draft: BuilderDraft, catalogs: BuilderCatalogs): BuilderOffer[] {
  const context = offerContext(draft, catalogs);
  const offers: BuilderOffer[] = [];
  // An offer key indexes `draft.picks`, so keys must be unique or two offers share one answer and
  // `buildChoiceRows` submits it twice. The first holder keeps the plain key (parked drafts still
  // resolve); later collisions take a "#n" suffix. Keys never cross the wire.
  const keyUses = new Map<string, number>();
  const uniqueKey = (key: string) => {
    const uses = (keyUses.get(key) ?? 0) + 1;
    keyUses.set(key, uses);
    return uses === 1 ? key : `${key}#${uses}`;
  };
  // A feat already held (the background's origin feat, or one from an earlier offer) is dropped from
  // later offers unless it may genuinely be repeated.
  const heldFeatIds = new Set<string>(context.background?.originFeatId ? [context.background.originFeatId] : []);
  // Proficiencies differ from feats: a duplicate is merged server-side, not rejected, so the pick is
  // silently lost. Sources accumulate in step order, and each offer records what it can no longer give.
  const heldProficiencies = new Map<string, string>();
  for (const skill of context.background?.skillProficiencies ?? []) {
    heldProficiencies.set(skill, `already granted by ${context.background!.name}`);
  }
  /** The already-held subset of these options, or null for a kind without this rule. */
  const unavailableOf = (
    kind: string,
    options: readonly CatalogChoiceOption[]
  ): Readonly<Record<string, string>> | null => {
    if (!PROVENANCE_KINDS.has(kind)) return null;
    const held: Record<string, string> = {};
    for (const option of options) {
      const reason = heldProficiencies.get(option.id);
      if (reason) held[option.id] = reason;
    }
    return held;
  };
  /** Records an offer's answers after it is built, so its own picks stay tappable to un-pick. */
  const recordHeld = (offerKey: string, kind: string, label: string) => {
    if (!HELD_KINDS.has(kind)) return;
    for (const id of draft.picks[offerKey] ?? []) {
      if (!heldProficiencies.has(id)) heldProficiencies.set(id, `already chosen for "${label}"`);
    }
  };
  /**
   * What an earlier grant of the same feature already spent: budget key -> option id -> reason.
   *
   * A feature granted at several levels (Expertise at 3 and 9, Metamagic at 2, 10, 17) is one offer
   * per grant level here, because `buildChoiceRows` stamps each row's level and `level-ledger.ts`
   * matches rows by `(level, kind, classId, featureId)`. The server keeps one offer of capacity
   * `choose x count` and refuses a repeated id, so siblings must not take the same option.
   *
   * Keyed on `budgetKeyOf` (strips "#n"). ASI keys (`feature:<id>@<level>`) never collide, which is
   * right: the server mints one offer per chosen feat, so repeating an ability there is legal.
   */
  const spentByRepeat = new Map<string, Map<string, string>>();
  const featRepeats = (id: string) => {
    const feat = catalogs.choice.feats.find((entry) => entry.id === id);
    if (!feat?.repeatable) return false;
    // The server's `repeatsOnlyWithADifferentSpellList`: a feat whose choice draws from a
    // `<list>-spells` catalog (Magic Initiate) may not repeat the same id, whatever `repeatable` says.
    return !featurePicksOf(feat.feature).some((pick) => pick.fromCatalog?.endsWith("-spells") ?? false);
  };
  /**
   * Offer key -> how many picks granted features have added to it. Mirrors `character-build.ts`'s
   * `extraPickBudgets` exactly; any divergence either refuses the build at Create or makes a
   * feature's promise unselectable. Applied as a post-pass (`withGrantedPicks`) because a grant can
   * raise a budget built in an earlier step.
   */
  const extraPicks = new Map<string, number>();
  const addExtraPicks = (grants: readonly ContentExtraPickSummary[] | undefined, times: number) => {
    // `extraPickAmount` is the shared resolver, so scaling budgets (Eldritch Invocations 1 -> 10) agree
    // with the server. With no class yet the table is empty and nothing is added.
    const table = context.classRecord?.levelTable ?? [];
    for (const grant of grants ?? []) {
      extraPicks.set(
        grant.offer,
        (extraPicks.get(grant.offer) ?? 0) + extraPickAmount(grant, table, draft.level) * times
      );
    }
  };
  /**
   * Whether a gate's earlier answer is already in the draft; mirrors the server's `ledgerAnswered`.
   * The `#n` suffix is stripped so a repeated offer still answers its gate.
   */
  const answeredInDraft = (gate: Readonly<{ offer: string; id: string }>): boolean =>
    answersInDraft(gate.offer).includes(gate.id);
  /** Every answer this budget already holds; the draft-side mirror of the server's `answersFor`. */
  const answersInDraft = (offer: string): readonly string[] =>
    Object.entries(draft.picks).flatMap(([key, ids]) => (budgetKeyOf(key).split("@")[0] === offer ? ids : []));
  const skillName = (id: string) => catalogs.choice.skills.find((skill) => skill.id === id)?.name ?? titleize(id);
  const spellName = (id: string) => catalogs.choice.spells.find((spell) => spell.id === id)?.name ?? titleize(id);
  // Options use full names ("Strength"), matching the review; three-letter forms are for dense strips.
  const nameOfKind = (kind: string) => (id: string) =>
    kind === "skill" || kind === "expertise" || kind === "skill-or-tool"
      ? skillName(id)
      : kind === "spell" || kind === "cantrip"
        ? spellName(id)
        : kind === "ability-score"
          ? ABILITIES.includes(id as Ability)
            ? ABILITY_LABELS[id as Ability]
            : titleize(id)
          : titleize(id);

  const listOffer = (
    key: string,
    step: OfferStep,
    kind: string,
    label: string,
    list:
      ContentChoiceList | { choose: number; from: readonly string[]; fromCatalog?: string | null } | null | undefined,
    classId: string | null
  ) => {
    if (!list || list.choose <= 0) return;
    const offerKey = uniqueKey(key);
    // A "choose N" list may also name an open catalog (e.g. the species language budget), resolved
    // with the same function the server validates the row with.
    const named = optionsOfIds(list.from, nameOfKind(kind));
    let options = named;
    let unresolvable: string | null = null;
    if (list.fromCatalog) {
      try {
        const catalog = resolveCatalogChoice(list.fromCatalog, catalogs.choice);
        const inline = new Set(named.map((option) => option.id));
        options = [...named, ...catalog.filter((option) => !inline.has(option.id))];
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        if (named.length === 0) unresolvable = error.message;
      }
    }
    offers.push({
      key: offerKey,
      step,
      featureId: null,
      kind,
      label,
      help: null,
      capacity: list.choose,
      options,
      maxSpellLevel: null,
      level: 1,
      classId,
      unresolvable,
      unavailable: unavailableOf(kind, options)
    });
    recordHeld(offerKey, kind, label);
  };

  const featureOffer = (
    key: string,
    step: OfferStep,
    feature: ContentFeatureSummary,
    level: number,
    classId: string | null,
    times = 1
  ) => {
    // Before the early return: a feature may raise a budget without asking for a pick of its own.
    addExtraPicks(feature.extraPicks, times);
    // Every pick the record owes, mirroring the server's `featurePicks` loop (Magic Initiate owes two
    // cantrips and a level-1 spell). Later picks take "/2", "/3", which `budgetKeyOf` does not collapse:
    // "#n" is the same pick again and shares a budget, "/n" is a different pick on the same record.
    const picks = featurePicksOf(feature);
    picks.forEach((choice, index) =>
      featurePickOffer(index === 0 ? key : `${key}/${index + 1}`, step, feature, choice, level, classId, times)
    );
  };

  const featurePickOffer = (
    key: string,
    step: OfferStep,
    feature: ContentFeatureSummary,
    choice: NonNullable<ContentFeatureSummary["choice"]>,
    level: number,
    classId: string | null,
    times = 1
  ) => {
    if (choice.choose <= 0) return;
    const { options, unresolvable } = resolveChoice(choice, catalogs, nameOfKind(choice.kind), answersInDraft);
    // The spell-level window the server's `withinSpellWindow` enforces: `maxSpellLevel` is a ceiling,
    // `minSpellLevel` a floor (Mystic Arcanum is exactly level 6), and "cantrip" is level 0, "spell" 1+.
    const ceiling = choice.maxSpellLevel;
    const floor = choice.minSpellLevel;
    const filtered = options.filter((option) => {
      const spellLevel = option.level;
      if (ceiling != null && (spellLevel ?? 0) > ceiling) return false;
      if (floor != null && (spellLevel ?? 0) < floor) return false;
      if (spellLevel == null) return true;
      if (choice.kind === "cantrip") return spellLevel === 0;
      if (choice.kind === "spell") return spellLevel >= 1;
      return true;
    });
    // Drop feats this build already has (see `heldFeatIds`); the "asi" shorthand is never a feat.
    let offerable = FEAT_KINDS.has(choice.kind)
      ? filtered.filter(
          (option) => option.id === ASI_SHORTHAND || !heldFeatIds.has(option.id) || featRepeats(option.id)
        )
      : filtered;
    /**
     * Options gated on an earlier answer (`requires`), mirroring the server. Unmet gates drop the
     * option; when the survivors exactly fill the capacity the answer is a consequence, so no card is
     * rendered and the server adopts the same survivors.
     */
    const gatedOptions = choice.options ?? [];
    if (gatedOptions.some((option) => option.requires)) {
      const legal = gatedOptions.filter((option) => !option.requires || answeredInDraft(option.requires));
      if (legal.length === choice.choose * times) {
        for (const option of legal) addExtraPicks(option.extraPicks, times);
        return;
      }
      offerable = offerable.filter((option) => legal.some((candidate) => candidate.id === option.id));
    }
    const offerKey = uniqueKey(key);
    // A feature granted more than once is one offer on the server and several here (see
    // `spentByRepeat`): siblings share a budget key and must not share an answer.
    const budgetKey = feature.grantedAtLevels.length > 1 ? budgetKeyOf(offerKey) : null;
    const spent = budgetKey ? spentByRepeat.get(budgetKey) : undefined;
    const held = unavailableOf(choice.kind, offerable);
    let unavailable = held;
    if (spent && spent.size > 0) {
      const merged: Record<string, string> = { ...held };
      for (const option of offerable) {
        const reason = spent.get(option.id);
        if (reason && !merged[option.id]) merged[option.id] = reason;
      }
      unavailable = merged;
    }
    offers.push({
      key: offerKey,
      step,
      featureId: feature.id,
      kind: choice.kind,
      label: feature.name,
      help: feature.description || null,
      capacity: choice.choose * times,
      options: offerable,
      maxSpellLevel: ceiling ?? null,
      level,
      classId,
      unresolvable,
      unavailable
    });
    if (FEAT_KINDS.has(choice.kind)) {
      for (const id of draft.picks[offerKey] ?? []) if (id !== ASI_SHORTHAND) heldFeatIds.add(id);
    }
    // After the push, like `recordHeld`: an offer never greys out its own answers.
    if (budgetKey) {
      const running = spentByRepeat.get(budgetKey) ?? new Map<string, string>();
      for (const id of draft.picks[offerKey] ?? []) {
        if (!running.has(id)) running.set(id, `already chosen for ${feature.name} at level ${level}`);
      }
      spentByRepeat.set(budgetKey, running);
    }
    recordHeld(offerKey, choice.kind, feature.name);
    /**
     * A chosen inline option is itself a feature: its own picks and budget grants mirror the server's
     * second pass (Blessed Warrior's cantrips, Pact of the Blade's weapon). Keyed on the option id,
     * as on the server.
     */
    const picked = new Set(draft.picks[offerKey] ?? []);
    for (const option of choice.options ?? []) {
      if (!picked.has(option.id)) continue;
      addExtraPicks(option.extraPicks, times);
      const nested = option.choices.length > 0 ? option.choices : option.choice ? [option.choice] : [];
      const asFeature = { ...feature, id: option.id, name: option.name, description: option.description };
      nested.forEach((pick, index) =>
        featurePickOffer(
          index === 0 ? `feature:${option.id}` : `feature:${option.id}/${index + 1}`,
          step,
          asFeature,
          pick,
          level,
          classId,
          times
        )
      );
    }
  };

  // Step 1: species traits' picks, language choices, and size when more than one is printed. The
  // wire folds lineage traits into `features` without a lineage tag; no SRD lineage trait asks for
  // a pick, so nothing is mis-offered.
  if (context.species) {
    for (const trait of context.species.features) featureOffer(`feature:${trait.id}`, "species", trait, 1, null);
    listOffer(
      "species-languages",
      "species",
      "language",
      `${context.species.name} languages`,
      context.species.languageChoices,
      null
    );
    if (context.species.sizes.length > 1) {
      offers.push({
        key: uniqueKey("species-size"),
        step: "species",
        featureId: null,
        kind: "size",
        label: "Size",
        help: null,
        capacity: 1,
        options: optionsOfIds(context.species.sizes, titleize),
        maxSpellLevel: null,
        level: 1,
        classId: null,
        unresolvable: null,
        unavailable: null
      });
    }
  }

  // Step 2: background lists, its features' picks, and the origin feat it grants.
  if (context.background) {
    listOffer(
      "background-skills",
      "background",
      "skill",
      `${context.background.name} skills`,
      context.background.skillChoices,
      null
    );
    listOffer(
      "background-tools",
      "background",
      "tool",
      `${context.background.name} tools`,
      context.background.toolChoices,
      null
    );
    listOffer(
      "background-languages",
      "background",
      "language",
      `${context.background.name} languages`,
      context.background.languageChoices,
      null
    );
    for (const feature of context.background.features)
      featureOffer(`feature:${feature.id}`, "background", feature, 1, null);
    if (context.originFeat)
      featureOffer(`feature:${context.originFeat.feature.id}`, "background", context.originFeat.feature, 1, null);
  }

  // Step 3: class and level; the proficiency lists the class opens.
  if (context.classRecord) {
    listOffer(
      "class-skills",
      "class",
      "skill",
      `${context.classRecord.name} skills`,
      context.classRecord.skillChoiceCount > 0
        ? { choose: context.classRecord.skillChoiceCount, from: context.classRecord.skillChoices }
        : null,
      context.classRecord.id
    );
    listOffer(
      "class-tools",
      "class",
      "tool",
      `${context.classRecord.name} tools`,
      context.classRecord.toolChoices,
      context.classRecord.id
    );
  }

  // Step 4: class features (subclass, fighting style, weapon mastery, expertise), one decision per
  // ASI level, the subclass's own features, then cantrip and prepared-spell budgets.
  if (context.classRecord) {
    for (const { feature, level } of grantedClassFeatures(context.classRecord, draft.level)) {
      // One offer per ASI level; the server sees N rows against its single capacity-N offer.
      const key = feature.choice?.kind === "asi-or-feat" ? `feature:${feature.id}@${level}` : `feature:${feature.id}`;
      featureOffer(key, "features", feature, level, context.classRecord.id);
    }
    if (context.subclass) {
      const subclassLevel = context.subclass.subclassLevel ?? context.classRecord.subclassLevel;
      for (const feature of context.subclass.features) {
        const at = feature.level ?? subclassLevel;
        if (at <= draft.level) featureOffer(`feature:${feature.id}`, "features", feature, at, context.classRecord.id);
      }
    }
    /**
     * A chosen feat's own feature can ask for picks (Magic Initiate's cantrips, the ASI feat's ability
     * points); those offers exist only once the parent feat is chosen, as in the server's two passes.
     *
     * One offer per chosen feat, as the server mints them; never one merged offer of N times the
     * capacity, which a checkbox grid cannot fill (`repeatable` does not cross the wire). `uniqueKey`
     * suffixes the repeats and `budgetKeyOf` strips the suffix, so `extraPicks` still sum per budget.
     *
     * Every taken feat is passed on, since the server applies `grantExtraPicks` to all of them.
     */
    const takenFeatIds = offers
      .filter((offer) => FEAT_KINDS.has(offer.kind))
      .flatMap((offer) =>
        (draft.picks[offer.key] ?? []).map((id) => ({
          id,
          step: offer.step,
          level: offer.level,
          classId: offer.classId
        }))
      );
    for (const taken of takenFeatIds) {
      if (taken.id === ASI_SHORTHAND) continue;
      const feat = catalogs.choice.feats.find((entry) => entry.id === taken.id);
      if (!feat) continue;
      featureOffer(`feature:${feat.feature.id}`, taken.step, feat.feature, taken.level, taken.classId);
    }

    // The class's spell budgets from its level row: the untagged rows the server matches against
    // `cantripsKnown` / `preparedCount`. Feature-tagged spell picks are separate offers outside them.
    const row = context.levelRow;
    if (row && context.spellListId) {
      const slug = `${context.spellListId}-spells`;
      let list: CatalogChoiceOption[] = [];
      let unresolvable: string | null = null;
      try {
        list = resolveCatalogChoice(slug, catalogs.choice);
      } catch (error) {
        if (error instanceof CatalogChoiceError) unresolvable = error.message;
        else throw error;
      }
      const maxSlotLevel = (row.spellSlots ?? []).reduce(
        (highest, count, index) => (count > 0 ? index + 1 : highest),
        0
      );
      if ((row.cantripsKnown ?? 0) > 0) {
        offers.push({
          key: uniqueKey("class-cantrips"),
          step: "features",
          featureId: null,
          kind: "cantrip",
          label: `${context.classRecord.name} cantrips`,
          help: null,
          capacity: row.cantripsKnown!,
          options: list.filter((option) => option.level === 0),
          maxSpellLevel: 0,
          level: 1,
          classId: context.classRecord.id,
          unresolvable,
          unavailable: null
        });
      }
      const preparedCap = row.preparedCount ?? row.spellsKnown ?? 0;
      if (preparedCap > 0 && maxSlotLevel > 0) {
        offers.push({
          key: uniqueKey("class-spells"),
          step: "features",
          featureId: null,
          kind: "spell",
          label:
            context.classRecord.spellcasting?.prepares === "known"
              ? `${context.classRecord.name} spells known`
              : `${context.classRecord.name} prepared spells`,
          help: null,
          capacity: preparedCap,
          options: list.filter((option) => (option.level ?? 0) >= 1 && (option.level ?? 0) <= maxSlotLevel),
          maxSpellLevel: maxSlotLevel,
          level: 1,
          classId: context.classRecord.id,
          unresolvable,
          unavailable: null
        });
      }
    }
  }

  // Step 6: equipment. One class option and one background option.
  if (context.classRecord && context.classRecord.startingEquipmentOptions.length > 0) {
    offers.push({
      key: uniqueKey("class-equipment"),
      step: "equipment",
      featureId: null,
      kind: "equipment",
      label: `${context.classRecord.name} starting equipment`,
      help: null,
      capacity: 1,
      options: context.classRecord.startingEquipmentOptions.map((option) => ({ id: option.id, name: option.label })),
      maxSpellLevel: null,
      level: 1,
      classId: context.classRecord.id,
      unresolvable: null,
      unavailable: null
    });
  }
  if (context.background && context.background.startingEquipmentOptions.length > 0) {
    offers.push({
      key: uniqueKey("background-equipment"),
      step: "equipment",
      featureId: null,
      kind: "equipment",
      label: `${context.background.name} starting equipment`,
      help: null,
      capacity: 1,
      options: context.background.startingEquipmentOptions.map((option) => ({ id: option.id, name: option.label })),
      maxSpellLevel: null,
      level: 1,
      classId: null,
      unresolvable: null,
      unavailable: null
    });
  }

  return withGrantedPicks(withExpertiseReach(offers, context, catalogs, draft), extraPicks);
}

/** An offer's key without its "#n" suffix; what an `extraPicks` grant names. */
const budgetKeyOf = (key: string) => key.replace(/#\d+$/, "");

/**
 * Capacity is the printed budget plus what was granted (e.g. Thaumaturge's extra Cleric cantrip),
 * applied once every offer exists. A grant naming no offer is ignored here; the server rejects it
 * as an authoring error.
 */
function withGrantedPicks(offers: readonly BuilderOffer[], extraPicks: ReadonlyMap<string, number>): BuilderOffer[] {
  if (extraPicks.size === 0) return [...offers];
  return offers.map((offer) => {
    const granted = extraPicks.get(budgetKeyOf(offer.key)) ?? 0;
    return granted === 0 ? offer : { ...offer, capacity: offer.capacity + granted };
  });
}

/**
 * Greys the expertise options this build is not proficient in (SRD: expertise needs proficiency).
 * A second pass rather than part of `unavailableOf` because the server's rule is a union over all
 * sources, not a step-order accumulation, and `heldProficiencies` also holds tools and languages.
 */
function withExpertiseReach(
  offers: BuilderOffer[],
  context: OfferContext,
  catalogs: BuilderCatalogs,
  draft: BuilderDraft
): BuilderOffer[] {
  if (!offers.some((offer) => offer.kind === "expertise")) return offers;
  // The server's split: a "skill-or-tool" pick counts as a skill only if the id is one.
  const skillIds = new Set(catalogs.choice.skills.map((skill) => skill.id));
  const proficient = new Set<string>(context.background?.skillProficiencies ?? []);
  for (const offer of offers) {
    if (offer.kind !== "skill" && offer.kind !== "skill-or-tool") continue;
    for (const id of draft.picks[offer.key] ?? []) {
      if (offer.kind === "skill" || skillIds.has(id)) proficient.add(id);
    }
  }
  return offers.map((offer) => {
    if (offer.kind !== "expertise") return offer;
    const notProficient: Record<string, string> = {};
    for (const option of offer.options) {
      if (!proficient.has(option.id)) notProficient[option.id] = "not one of your proficiencies";
    }
    // Never grey an offer into a dead end: with no proficient options (possibly granted by a rider the
    // client cannot see), leave the list enabled and let the server explain.
    if (Object.keys(notProficient).length === offer.options.length) return offer;
    // Merged, not assigned: `offer.unavailable` may already hold the sibling grant's reason (see
    // `spentByRepeat`), and the more specific reason wins.
    return { ...offer, unavailable: { ...notProficient, ...offer.unavailable } };
  });
}

/** The built-in "raise two points instead of taking a feat" row id the server understands. */
export const ASI_SHORTHAND = "asi";

/**
 * Drops picks the current offers no longer support (e.g. after a class change) and re-mirrors
 * `subclassId`, so stale picks never reach the server as a rejection. Returns the same object
 * when nothing changed, so it is safe to run from an effect.
 */
export function prunePicks(draft: BuilderDraft, offers: readonly BuilderOffer[]): BuilderDraft {
  const byKey = new Map(offers.map((offer) => [offer.key, offer]));
  const picks: Record<string, readonly string[]> = {};
  let changed = false;
  for (const [key, chosen] of Object.entries(draft.picks)) {
    const offer = byKey.get(key);
    if (!offer) {
      changed = true;
      continue;
    }
    const legal = chosen.filter(
      (id) => (offer.kind === "asi-or-feat" && id === ASI_SHORTHAND) || offer.options.some((option) => option.id === id)
    );
    const capped = legal.slice(0, offer.capacity);
    if (capped.length !== chosen.length) changed = true;
    if (capped.length > 0) picks[key] = capped;
  }
  const asiIncreases: Record<string, ReadonlyArray<{ ability: Ability; amount: number }>> = {};
  for (const [key, increases] of Object.entries(draft.asiIncreases)) {
    if (byKey.has(key)) asiIncreases[key] = increases;
    else changed = true;
  }
  // The subclass offer is the subclass answer; the top-level id only mirrors it.
  const subclassOffer = offers.find((offer) => offer.kind === "subclass");
  const mirrored = subclassOffer ? ((picks[subclassOffer.key] ?? [])[0] ?? null) : null;
  if (mirrored !== draft.subclassId) changed = true;
  return changed ? { ...draft, picks, asiIncreases, subclassId: mirrored } : draft;
}

/** An offer is satisfied when exactly filled, or deferred because its catalog is empty. */
export function offerFilled(offer: BuilderOffer, draft: BuilderDraft): boolean {
  if (offer.unresolvable !== null) return true;
  const picks = draft.picks[offer.key] ?? [];
  if (picks.length !== offer.capacity) return false;
  // The ASI route also needs its +2 spelled out, or the server rejects the row.
  if (offer.kind === "asi-or-feat" && picks[0] === ASI_SHORTHAND) {
    const increases = draft.asiIncreases[offer.key] ?? [];
    return increases.reduce((total, entry) => total + entry.amount, 0) === 2;
  }
  return true;
}

// Ability scores

export const ABILITY_LABELS: Readonly<Record<Ability, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

/** Assign-mode methods hand out a fixed pool; point buy spends against a budget. */
export const isAssignMethod = (method: BuilderAbilityMethod) => method !== "point-buy";

/** Base scores before any bonus. `null` where the player has not assigned a value yet. */
export function baseScoresOf(draft: BuilderDraft): Record<Ability, number | null> {
  const scores = {} as Record<Ability, number | null>;
  for (const ability of ABILITIES) {
    if (isAssignMethod(draft.abilityMethod)) {
      const poolId = draft.poolAssignment[ability] ?? null;
      scores[ability] = draft.abilityPool.find((entry) => entry.id === poolId)?.value ?? null;
    } else {
      scores[ability] = draft.spendScores[ability] ?? POINT_BUY_MINIMUM;
    }
  }
  return scores;
}

/**
 * The bonuses the client can see: the background spread, the species' printed increases, and the
 * player's own ability picks (ASI split, feat `ability-score` picks). Riders that raise scores stay
 * server-side, so this is a preview; the server's total is what lands on the sheet.
 */
export function abilityBonusesOf(
  draft: BuilderDraft,
  catalogs: BuilderCatalogs,
  offers: readonly BuilderOffer[]
): Record<Ability, number> {
  const bonuses = Object.fromEntries(ABILITIES.map((ability) => [ability, 0])) as Record<Ability, number>;
  for (const entry of draft.backgroundBonus) bonuses[entry.ability] += entry.amount;
  const species = catalogs.choice.species.find((entry) => entry.id === draft.speciesId);
  for (const bonus of species?.abilityBonuses ?? []) {
    if (ABILITIES.includes(bonus.ability as Ability)) bonuses[bonus.ability as Ability] += bonus.amount;
  }
  for (const offer of offers) {
    if (offer.kind === "asi-or-feat") {
      for (const increase of draft.asiIncreases[offer.key] ?? []) {
        if ((draft.picks[offer.key] ?? [])[0] === ASI_SHORTHAND) bonuses[increase.ability] += increase.amount;
      }
    }
    if (offer.kind === "ability-score") {
      for (const pick of draft.picks[offer.key] ?? []) {
        if (ABILITIES.includes(pick as Ability)) bonuses[pick as Ability] += 1;
      }
    }
  }
  return bonuses;
}

/** A finished score may not pass this; the server rejects it. */
export const ABILITY_SCORE_CAP = 20;

export type AbilityCapBreach = Readonly<{
  ability: Ability;
  total: number;
  /** The ASI offer whose increase broke the ceiling; null when the background's own spread did. */
  offerKey: string | null;
  /** Said in the player's words, naming the ability and both ways out. */
  reason: string;
}>;

export type AbilityCapPreview = Readonly<{
  breach: AbilityCapBreach | null;
  /** Per ASI offer key: the running scores just before that offer's increases, so it can show what
      each ability would reach. Empty until every base score is assigned. */
  before: ReadonlyMap<string, Readonly<Record<Ability, number>>>;
}>;

/**
 * Walks the ability scores in the server's order and reports the first increase past 20. An input
 * check, not a game outcome: the background spread and each ASI row reject above 20, while species
 * increases and feat `ability-score` picks clamp. The server recomputes all of it.
 */
export function abilityCapPreview(
  draft: BuilderDraft,
  catalogs: BuilderCatalogs,
  offers: readonly BuilderOffer[]
): AbilityCapPreview {
  const before = new Map<string, Record<Ability, number>>();
  const base = baseScoresOf(draft);
  if (ABILITIES.some((ability) => base[ability] == null)) return { breach: null, before };
  const scores = Object.fromEntries(ABILITIES.map((ability) => [ability, base[ability]!])) as Record<Ability, number>;

  let breach: AbilityCapBreach | null = null;
  const overflowed = (ability: Ability, offerKey: string | null, fix: string) => {
    if (scores[ability] <= ABILITY_SCORE_CAP || breach) return;
    breach = {
      ability,
      total: scores[ability],
      offerKey,
      reason: `${ABILITY_LABELS[ability]} would be ${scores[ability]} — no ability may go above ${ABILITY_SCORE_CAP}. ${fix}`
    };
  };

  const background = catalogs.backgrounds.find((entry) => entry.id === draft.backgroundId) ?? null;
  for (const entry of draft.backgroundBonus) {
    scores[entry.ability] += entry.amount;
    overflowed(
      entry.ability,
      null,
      `Move ${background ? `${background.name}'s` : "the background's"} increase, or lower ${ABILITY_LABELS[entry.ability]}.`
    );
  }
  const species = catalogs.choice.species.find((entry) => entry.id === draft.speciesId);
  for (const bonus of species?.abilityBonuses ?? []) {
    if (ABILITIES.includes(bonus.ability as Ability)) {
      const ability = bonus.ability as Ability;
      scores[ability] = Math.min(ABILITY_SCORE_CAP, scores[ability] + bonus.amount);
    }
  }
  for (const offer of offers) {
    if (offer.kind !== "asi-or-feat") continue;
    before.set(offer.key, { ...scores });
    if ((draft.picks[offer.key] ?? [])[0] !== ASI_SHORTHAND) continue;
    for (const increase of draft.asiIncreases[offer.key] ?? []) {
      scores[increase.ability] += increase.amount;
      overflowed(
        increase.ability,
        offer.key,
        `Change the level ${offer.level} improvement, or lower ${ABILITY_LABELS[increase.ability]}.`
      );
    }
  }
  return { breach, before };
}

export function pointBuySpent(draft: BuilderDraft): number {
  const values = ABILITIES.map((ability) => draft.spendScores[ability] ?? POINT_BUY_MINIMUM);
  const legal = values.every((value) => value >= POINT_BUY_MINIMUM && value <= POINT_BUY_MAXIMUM);
  return legal ? POINT_BUY_BUDGET - pointBuyRemaining(values, POINT_BUY_BUDGET) : POINT_BUY_BUDGET + 1;
}

// The submitted payload

export function buildChoiceRows(draft: BuilderDraft, offers: readonly BuilderOffer[]): CharacterChoice[] {
  const rows: CharacterChoice[] = [];
  for (const offer of offers) {
    for (const id of draft.picks[offer.key] ?? []) {
      const payload: Record<string, unknown> = {};
      if (offer.featureId) payload.featureId = offer.featureId;
      if (offer.kind === "asi-or-feat" && id === ASI_SHORTHAND) payload.increases = draft.asiIncreases[offer.key] ?? [];
      rows.push({
        level: offer.level,
        ...(offer.classId ? { classId: offer.classId } : {}),
        kind: offer.kind,
        id,
        ...(Object.keys(payload).length > 0 ? { payload } : {})
      });
    }
  }
  return rows;
}

export type CharacterCreatePayload = Readonly<{
  name: string;
  speciesId: string;
  backgroundId: string;
  classId: string;
  level: number;
  subclassId?: string;
  abilityMethod: BuilderAbilityMethod;
  baseScores: Record<Ability, number>;
  backgroundBonusAllocation: ReadonlyArray<{ ability: Ability; amount: number }>;
  hp: { mode: "average" | "entries"; entries?: readonly number[] };
  choices: readonly CharacterChoice[];
}>;

/** The `character.create` body, minus the caller's `commandId`. Throws only on a draft the step
    gating should already have blocked. */
export function buildCreatePayload(draft: BuilderDraft, offers: readonly BuilderOffer[]): CharacterCreatePayload {
  const base = baseScoresOf(draft);
  const scores = {} as Record<Ability, number>;
  for (const ability of ABILITIES) {
    const value = base[ability];
    if (value == null) throw new Error(`${ABILITY_LABELS[ability]} has no score yet.`);
    scores[ability] = value;
  }
  if (!draft.speciesId || !draft.backgroundId || !draft.classId)
    throw new Error("Species, background, and class are all required.");
  return {
    name: draft.name.trim(),
    speciesId: draft.speciesId,
    backgroundId: draft.backgroundId,
    classId: draft.classId,
    level: draft.level,
    ...(draft.subclassId ? { subclassId: draft.subclassId } : {}),
    abilityMethod: draft.abilityMethod,
    baseScores: scores,
    backgroundBonusAllocation: draft.backgroundBonus,
    hp: draft.hpMode === "average" ? { mode: "average" } : { mode: "entries", entries: draft.hpEntries },
    choices: buildChoiceRows(draft, offers)
  };
}

// Roster capacity: the table stores at most 100 sheets and 200 combatants (`actor-roster.ts`), so
// the wizard warns as it fills and blocks once full, rather than failing at Create.

export const DEFINITION_LIMIT = 100;
export const ACTOR_LIMIT = 200;
/** Warn from here on, so the GM can prune before the wizard stops them. */
const CAPACITY_WARNING_FRACTION = 0.8;

export type RosterCapacity = Readonly<{
  definitions: number;
  actors: number;
  /** Set once a create cannot land; shown as the review step's blocked reason. */
  blockedReason: string | null;
  /** Set from 80% of either limit: there is room, but not much. */
  warning: string | null;
}>;

export function rosterCapacity(definitions: number, actors: number): RosterCapacity {
  const line = `Sheet library ${definitions} of ${DEFINITION_LIMIT}; roster ${actors} of ${ACTOR_LIMIT}.`;
  if (definitions >= DEFINITION_LIMIT || actors >= ACTOR_LIMIT) {
    return {
      definitions,
      actors,
      warning: null,
      blockedReason: `${line} Remove a character or combatant you no longer need, then create this one.`
    };
  }
  const near =
    definitions >= DEFINITION_LIMIT * CAPACITY_WARNING_FRACTION || actors >= ACTOR_LIMIT * CAPACITY_WARNING_FRACTION;
  return {
    definitions,
    actors,
    blockedReason: null,
    warning: near ? `${line} Remove characters you no longer need to keep room for new ones.` : null
  };
}

// Per-step gating: every blocked Next says why.

export const STEP_IDS = ["species", "background", "class", "features", "abilities", "equipment", "review"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const STEP_LABELS: Readonly<Record<StepId, string>> = {
  species: "Species",
  background: "Background",
  class: "Class & level",
  features: "Class features",
  abilities: "Ability scores",
  equipment: "Equipment",
  review: "Name & review"
};
/** The phone rail's names: shorter only where nothing is lost. The level control lives on the
    class step, so it stays "Class & level". */
export const STEP_SHORT: Readonly<Record<StepId, string>> = {
  species: "Species",
  background: "Background",
  class: "Class & level",
  features: "Features",
  abilities: "Abilities",
  equipment: "Equipment",
  review: "Review"
};

const offersForStep = (offers: readonly BuilderOffer[], step: OfferStep) =>
  offers.filter((offer) => offer.step === step);

/** The first unmet requirement of a step, phrased as an instruction, or null when the step is done. */
export function stepBlockedReason(
  step: StepId,
  draft: BuilderDraft,
  catalogs: BuilderCatalogs,
  offers: readonly BuilderOffer[],
  policy: BuilderPolicy
): string | null {
  const context = offerContext(draft, catalogs);
  const unfilled = (owner: OfferStep) => offersForStep(offers, owner).find((offer) => !offerFilled(offer, draft));
  /**
   * One template for "this pick is not answered yet". The label is printed as the content prints it,
   * unquoted, matching the heading it points at.
   */
  const pickReason = (offer: BuilderOffer) => {
    // Offers on one step can share a label (six "Ability Score Improvement"s), so stamp the level
    // only when the label alone is ambiguous.
    const ambiguous = offersForStep(offers, offer.step).filter((sibling) => sibling.label === offer.label).length > 1;
    const named = ambiguous ? `level ${offer.level} ${offer.label}` : offer.label;
    const chosen = (draft.picks[offer.key] ?? []).length;
    if (offer.kind === "asi-or-feat" && chosen === offer.capacity)
      return `Split the +2 from ${named} across your abilities.`;
    return offer.capacity === 1
      ? `Choose your ${named} to continue.`
      : `Choose ${offer.capacity} for ${named} to continue — ${chosen} of ${offer.capacity} so far.`;
  };
  /**
   * A pick already held from another source. Options are not filtered, so a pick made before the
   * collision (e.g. the background changed later) survives and must be reported.
   */
  const heldConflict = (owner: OfferStep) => {
    for (const offer of offersForStep(offers, owner)) {
      if (!offer.unavailable) continue;
      for (const id of draft.picks[offer.key] ?? []) {
        const held = offer.unavailable[id];
        if (!held) continue;
        const name = offer.options.find((option) => option.id === id)?.name ?? titleize(id);
        return `"${name}" is ${held} — pick a different ${kindNoun(offer.kind)}.`;
      }
    }
    return null;
  };

  switch (step) {
    case "species": {
      if (!draft.speciesId) return "Choose a species to continue.";
      const conflict = heldConflict("species");
      if (conflict) return conflict;
      const offer = unfilled("species");
      return offer ? pickReason(offer) : null;
    }
    case "background": {
      if (!draft.backgroundId) return "Choose a background to continue.";
      const conflict = heldConflict("background");
      if (conflict) return conflict;
      const offer = unfilled("background");
      return offer ? pickReason(offer) : null;
    }
    case "class": {
      if (!draft.classId) return "Choose a class to continue.";
      const conflict = heldConflict("class");
      if (conflict) return conflict;
      const offer = unfilled("class");
      return offer ? pickReason(offer) : null;
    }
    case "features": {
      if (!draft.classId) return "Choose a class first.";
      const classRecord = context.classRecord;
      // A class with no subclass content yet has an empty subclass offer; say that first, since nothing
      // on screen could satisfy it.
      if (classRecord && draft.level >= classRecord.subclassLevel && !draft.subclassId) {
        const subclassOffer = offers.find((offer) => offer.kind === "subclass");
        if (!subclassOffer || subclassOffer.options.length === 0) {
          const escape =
            classRecord.subclassLevel > 1 ? ` Drop to level ${classRecord.subclassLevel - 1} to continue.` : "";
          return `No ${classRecord.name} subclasses are available yet — a level ${classRecord.subclassLevel} ${classRecord.name} must have one.${escape}`;
        }
      }
      const conflict = heldConflict("features");
      if (conflict) return conflict;
      const offer = unfilled("features");
      // Name the subclass only when it is the first unmet requirement.
      if (offer)
        return offer.kind === "subclass"
          ? `Choose a ${classRecord?.subclassLabel ?? "subclass"} to continue.`
          : pickReason(offer);
      // An ASI past 20 is chosen here but only visible once scores exist, so both steps guard the cap
      // with the same sentence.
      const breach = abilityCapPreview(draft, catalogs, offers).breach;
      return breach && breach.offerKey !== null ? breach.reason : null;
    }
    case "abilities": {
      if (!policy.allowedAbilityMethods.includes(draft.abilityMethod))
        return "Your GM does not allow that ability method — pick another.";
      const base = baseScoresOf(draft);
      const missing = ABILITIES.filter((ability) => base[ability] == null);
      if (missing.length > 0) return `Assign a score to ${ABILITY_LABELS[missing[0]]} to continue.`;
      if (draft.abilityMethod === "point-buy" && !isPointBuyLegal(ABILITIES.map((ability) => base[ability]!))) {
        return "That spread is over the 27-point budget — lower a score to continue.";
      }
      if (draft.abilityMethod === "standard-array") {
        const sorted = ABILITIES.map((ability) => base[ability]!)
          .sort((left, right) => right - left)
          .join(",");
        if (sorted !== [...STANDARD_ARRAY].join(","))
          return `Use each standard-array value once (${STANDARD_ARRAY.join(", ")}).`;
      }
      // Rolled or GM-formula scores are typed by the player, and the server bound-checks them against
      // the formula, so the step checks the same bounds.
      if (draft.abilityMethod === "roll" || draft.abilityMethod === "custom") {
        const formula =
          draft.abilityMethod === "custom" ? (policy.customFormula ?? ABILITY_ROLL_FORMULA) : ABILITY_ROLL_FORMULA;
        const check = validateAbilityFormula(formula);
        if (check.ok) {
          const outside = ABILITIES.find((ability) => base[ability]! < check.minimum || base[ability]! > check.maximum);
          if (outside)
            return `A ${formula} roll produces ${check.minimum}-${check.maximum} — ${ABILITY_LABELS[outside]} ${base[outside]} is outside that. Re-roll it or correct the value.`;
        }
      }
      const options = context.background?.abilityOptions ?? null;
      if (options) {
        const total = draft.backgroundBonus.reduce((sum, entry) => sum + entry.amount, 0);
        if (total === 0) return `Spend ${context.background!.name}'s ability increases to continue.`;
        const spread = [...draft.backgroundBonus.map((entry) => entry.amount)]
          .sort((left, right) => right - left)
          .join("/");
        if (!options.spreads.some((legal) => [...legal].sort((left, right) => right - left).join("/") === spread)) {
          return `${context.background!.name} allows ${options.spreads.map((legal) => `+${legal.join("/+")}`).join(" or ")} — adjust the split.`;
        }
        if (new Set(draft.backgroundBonus.map((entry) => entry.ability)).size !== draft.backgroundBonus.length) {
          return "Each background increase must go to a different ability.";
        }
      }
      // The 20 cap, checked on the step that owns the scores (the features step guards the improvements).
      const breach = abilityCapPreview(draft, catalogs, offers).breach;
      if (breach) return breach.reason;
      if (draft.hpMode === "entries") {
        const needed = draft.level - 1;
        const faces = context.hitDie ? hitDieFaces(context.hitDie) : 12;
        if (draft.hpEntries.length !== needed)
          return `Enter your hit-point roll for level ${draft.hpEntries.length + 2} (${needed - draft.hpEntries.length} to go).`;
        if (draft.hpEntries.some((entry) => entry < 1 || entry > faces))
          return `A ${context.hitDie} roll is 1-${faces} — fix the out-of-range entry.`;
      }
      return null;
    }
    case "equipment": {
      const offer = unfilled("equipment");
      return offer ? pickReason(offer) : null;
    }
    case "review": {
      if (draft.name.trim().length === 0) return "Name your character to create them.";
      for (const id of STEP_IDS) {
        if (id === "review") continue;
        const reason = stepBlockedReason(id, draft, catalogs, offers, policy);
        if (reason) return `${STEP_LABELS[id]} is not finished: ${reason}`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Preview only: the modifier the allocator shows beside a total. */
export const previewModifier = (total: number | null) => (total == null ? null : abilityModifier(total));
