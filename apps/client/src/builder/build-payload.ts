import {
  CatalogChoiceError, resolveCatalogChoice,
  type BuilderAbilityMethod, type BuilderPolicy, type CatalogChoiceOption, type ContentBackgroundSummary,
  type ContentClassSummary, type ContentFeatSummary, type ContentFeatureSummary, type ContentSpeciesSummary,
  type ContentSubclassSummary
} from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES, abilityModifier, hitDieFaces, isPointBuyLegal, pointBuyRemaining, POINT_BUY_BUDGET,
  POINT_BUY_MAXIMUM, POINT_BUY_MINIMUM, STANDARD_ARRAY, type Ability, type HitDie
} from "@vtt/rules-5e";
import type { BuilderCatalogs } from "../content/catalogs";

/**
 * The character builder's DRAFT MODEL and payload assembly - pure, no React, no socket.
 *
 * The wizard collects *choices*, never a finished sheet: feature riders are deliberately withheld
 * from the wire, so only the server can interpret them (task-packet phase-2 amendment). Everything
 * here therefore does exactly two jobs:
 *
 *   1. work out WHAT the content is asking the player to pick (`computeOffers`), resolving every
 *      `fromCatalog` slug through `resolveCatalogChoice` - the SAME function `character-build.ts`
 *      re-validates the submitted rows with, so the wizard and the server can never disagree about
 *      what was offerable (CLAUDE.md rule 2);
 *   2. turn the answers into the `character.create` payload (`buildCreatePayload`) - identity ids,
 *      base scores + the background allocation, per-level HP entries, and the `choices[]` ledger.
 *
 * Anything that decides a game OUTCOME (hit points, AC, spell slots, whether a prerequisite is met)
 * stays on the server. The few numbers computed here - ability totals, the point-buy budget - are
 * previews of the player's own inputs, shown so the allocator can render a total; the server
 * recomputes all of them and its answer wins.
 */

export const BUILDER_DRAFT_VERSION = 1;

export type PickMap = Readonly<Record<string, readonly string[]>>;

/**
 * The in-progress build. This object IS the draft record: `draft.ts` persists exactly this to
 * localStorage today, and Phase 3's server-held `GameState.characterDrafts[]` is meant to store the
 * same shape, so swapping the store is a change of transport, not of model.
 */
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
    speciesId: null, backgroundId: null, classId: null, level: 1, subclassId: null,
    abilityMethod: "standard-array",
    abilityPool: STANDARD_ARRAY.map((value, index) => ({ id: `sa-${index}`, value })),
    poolAssignment: {},
    spendScores: Object.fromEntries(ABILITIES.map((ability) => [ability, POINT_BUY_MINIMUM])),
    backgroundBonus: [],
    hpMode: "average", hpEntries: [],
    picks: {}, asiIncreases: {},
    name: ""
  };
}

// ---------------------------------------------------------------------------------------------
// Offers - everything the content is asking this build to pick.
// ---------------------------------------------------------------------------------------------

/** Which wizard step owns an offer. Rule: the step that chose the SOURCE owns its picks. */
export type OfferStep = "species" | "background" | "class" | "features" | "equipment";

export type BuilderOffer = Readonly<{
  /** Stable key into `draft.picks`. */
  key: string;
  step: OfferStep;
  /** Written to the ledger row's `payload.featureId` when the offer came from a feature. A
      list-derived offer (class skills, background languages) must send NO featureId, or the
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
  /** Set when a `fromCatalog` slug resolved to nothing - a content gap, not a player error. The
      pick is then deferred rather than required (mirroring the server's own handling). */
  unresolvable: string | null;
}>;

const optionsOfIds = (ids: readonly string[], nameOf: (id: string) => string): CatalogChoiceOption[] =>
  ids.map((id) => ({ id, name: nameOf(id) }));

const titleize = (id: string) => id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

/** Resolve a feature's choice to concrete options, never throwing: a gap becomes `unresolvable`. */
function resolveChoice(choice: NonNullable<ContentFeatureSummary["choice"]>, catalogs: BuilderCatalogs, nameOf: (id: string) => string):
{ options: CatalogChoiceOption[]; unresolvable: string | null } {
  if (choice.from.length > 0) return { options: optionsOfIds(choice.from, nameOf), unresolvable: null };
  if (!choice.fromCatalog) return { options: [], unresolvable: "this pick names no option list." };
  try {
    return { options: resolveCatalogChoice(choice.fromCatalog, catalogs.choice), unresolvable: null };
  } catch (error) {
    if (error instanceof CatalogChoiceError) return { options: [], unresolvable: error.message };
    throw error;
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
    ? catalogs.choice.feats.find((entry) => entry.id === background.originFeatId) ?? null
    : null;
  const levelRow = classRecord?.levelTable.find((row) => row.level === draft.level) ?? null;
  // The server reads `subclass?.spellcasting ?? class.spellcasting` (a third-caster subclass owns
  // its own header); mirror that exactly so the spell step offers the list the server will accept.
  const casting = subclass?.spellcasting ?? classRecord?.spellcasting ?? null;
  return {
    species, background, classRecord, subclass, originFeat, levelRow,
    spellListId: casting ? casting.spellListId ?? classRecord?.id ?? null : null,
    hitDie: (classRecord?.hitDie as HitDie | undefined) ?? null
  };
}

/** The class features a level-`level` character has been granted, with how many times. */
function grantedClassFeatures(classRecord: ContentClassSummary, level: number): Array<{ feature: ContentFeatureSummary; level: number }> {
  const granted: Array<{ feature: ContentFeatureSummary; level: number }> = [];
  for (const feature of classRecord.features) {
    if (feature.level != null) {
      if (feature.level <= level) granted.push({ feature, level: feature.level });
      continue;
    }
    // A level-less feature is the repeated one: the class's Ability Score Improvement, granted once
    // per entry in `asiLevels`. (The wire's level rows carry no feature list, so `asiLevels` - which
    // the class summary DOES carry - is the documented source for the repeat count.)
    if (feature.choice?.kind === "asi-or-feat") {
      for (const asiLevel of classRecord.asiLevels) if (asiLevel <= level) granted.push({ feature, level: asiLevel });
      continue;
    }
    granted.push({ feature, level: 1 });
  }
  return granted;
}

/**
 * Every pick this build owes, in step order. Mirrors `character-build.ts`'s offer machinery: the
 * same sources, the same `resolveCatalogChoice`, the same capacities - so a build that satisfies
 * every offer here is a build the server accepts.
 */
export function computeOffers(draft: BuilderDraft, catalogs: BuilderCatalogs): BuilderOffer[] {
  const context = offerContext(draft, catalogs);
  const offers: BuilderOffer[] = [];
  const skillName = (id: string) => catalogs.choice.skills.find((skill) => skill.id === id)?.name ?? titleize(id);
  const spellName = (id: string) => catalogs.choice.spells.find((spell) => spell.id === id)?.name ?? titleize(id);
  const nameOfKind = (kind: string) => (id: string) =>
    kind === "skill" || kind === "expertise" || kind === "skill-or-tool" ? skillName(id)
      : kind === "spell" || kind === "cantrip" ? spellName(id)
        : kind === "ability-score" ? (ABILITIES.includes(id as Ability) ? id.toUpperCase() : titleize(id))
          : titleize(id);

  const listOffer = (key: string, step: OfferStep, kind: string, label: string, list: { choose: number; from: readonly string[] } | null | undefined, classId: string | null) => {
    if (!list || list.choose <= 0) return;
    offers.push({
      key, step, featureId: null, kind, label, help: null, capacity: list.choose,
      options: optionsOfIds(list.from, nameOfKind(kind)), maxSpellLevel: null, level: 1, classId, unresolvable: null
    });
  };

  const featureOffer = (key: string, step: OfferStep, feature: ContentFeatureSummary, level: number, classId: string | null, capacity?: number) => {
    const choice = feature.choice;
    if (!choice || choice.choose <= 0) return;
    const { options, unresolvable } = resolveChoice(choice, catalogs, nameOfKind(choice.kind));
    // A `maxSpellLevel` ceiling is a hard filter (Evocation Savant is level 2 and under), and the
    // two spell kinds do not overlap: "cantrip" means level 0, "spell" means 1+. Offering a cantrip
    // under a "spell" pick would record it at the wrong level on the sheet.
    const ceiling = choice.maxSpellLevel;
    const filtered = options.filter((option) => {
      const spellLevel = option.level;
      if (ceiling != null && (spellLevel ?? 0) > ceiling) return false;
      if (spellLevel == null) return true;
      if (choice.kind === "cantrip") return spellLevel === 0;
      if (choice.kind === "spell") return spellLevel >= 1;
      return true;
    });
    offers.push({
      key, step, featureId: feature.id, kind: choice.kind, label: feature.name,
      help: feature.description || null,
      capacity: capacity ?? choice.choose,
      options: filtered,
      maxSpellLevel: ceiling ?? null, level, classId, unresolvable
    });
  };

  // ---- Step 1: species. Its traits' picks, its language choices, and (when the species prints
  // more than one) its size. Note the wire folds LINEAGE traits into `features`, and cannot say
  // which lineage each came from; no SRD 5.2.1 lineage trait asks for a pick, so nothing is
  // mis-offered today. If one ever does, the wire needs a lineage tag before it can be scoped.
  if (context.species) {
    for (const trait of context.species.features) featureOffer(`feature:${trait.id}`, "species", trait, 1, null);
    listOffer("species-languages", "species", "language", `${context.species.name} languages`, context.species.languageChoices, null);
    if (context.species.sizes.length > 1) {
      offers.push({
        key: "species-size", step: "species", featureId: null, kind: "size", label: "Size", help: null, capacity: 1,
        options: optionsOfIds(context.species.sizes, titleize), maxSpellLevel: null, level: 1, classId: null, unresolvable: null
      });
    }
  }

  // ---- Step 2: background. Its own choose-N lists, its features' picks, and the ORIGIN FEAT it
  // grants (Magic Initiate's two cantrips are a background decision, made where the background is).
  if (context.background) {
    listOffer("background-skills", "background", "skill", `${context.background.name} skills`, context.background.skillChoices, null);
    listOffer("background-tools", "background", "tool", `${context.background.name} tools`, context.background.toolChoices, null);
    listOffer("background-languages", "background", "language", `${context.background.name} languages`, context.background.languageChoices, null);
    for (const feature of context.background.features) featureOffer(`feature:${feature.id}`, "background", feature, 1, null);
    if (context.originFeat) featureOffer(`feature:${context.originFeat.feature.id}`, "background", context.originFeat.feature, 1, null);
  }

  // ---- Step 3: class & level. The proficiency lists picking the class opens.
  if (context.classRecord) {
    listOffer("class-skills", "class", "skill", `${context.classRecord.name} skills`,
      context.classRecord.skillChoiceCount > 0 ? { choose: context.classRecord.skillChoiceCount, from: context.classRecord.skillChoices } : null,
      context.classRecord.id);
    listOffer("class-tools", "class", "tool", `${context.classRecord.name} tools`, context.classRecord.toolChoices, context.classRecord.id);
  }

  // ---- Step 4: class features. Every granted class feature's pick (subclass, fighting style,
  // weapon mastery, expertise), each ASI level as its OWN decision, the subclass's own features,
  // then the class's cantrip / prepared-spell budgets.
  if (context.classRecord) {
    for (const { feature, level } of grantedClassFeatures(context.classRecord, draft.level)) {
      // One offer per ASI level: the player decides feat-or-scores separately at each one, which is
      // how it is actually played. The server sees N rows against its single capacity-N offer.
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
    // A chosen feat's OWN feature can ask for picks (Magic Initiate's cantrips, the ASI feat's two
    // ability points). Those second-order offers exist only once the parent feat is chosen - exactly
    // the server's two-pass order. Picking the same feat twice adds capacity rather than a duplicate.
    const featKinds = new Set(["feat", "fighting-style", "asi-or-feat"]);
    const takenFeatIds = offers
      .filter((offer) => featKinds.has(offer.kind))
      .flatMap((offer) => (draft.picks[offer.key] ?? []).map((id) => ({ id, step: offer.step, level: offer.level, classId: offer.classId })));
    const byFeature = new Map<string, { feat: ContentFeatSummary; step: OfferStep; level: number; classId: string | null; count: number }>();
    for (const taken of takenFeatIds) {
      if (taken.id === ASI_SHORTHAND) continue;
      const feat = catalogs.choice.feats.find((entry) => entry.id === taken.id);
      if (!feat?.feature.choice) continue;
      const existing = byFeature.get(feat.feature.id);
      if (existing) existing.count += 1;
      else byFeature.set(feat.feature.id, { feat, step: taken.step, level: taken.level, classId: taken.classId, count: 1 });
    }
    for (const entry of byFeature.values()) {
      featureOffer(`feature:${entry.feat.feature.id}`, entry.step, entry.feat.feature, entry.level, entry.classId, entry.feat.feature.choice!.choose * entry.count);
    }

    // The class's own spell budgets, from its printed level row. These are the UNTAGGED rows the
    // server matches against `cantripsKnown` / `preparedCount`; feature-tagged spell picks (Evocation
    // Savant) are separate offers above and sit OUTSIDE these budgets.
    const row = context.levelRow;
    if (row && context.spellListId) {
      const slug = `${context.spellListId}-spells`;
      let list: CatalogChoiceOption[] = [];
      let unresolvable: string | null = null;
      try { list = resolveCatalogChoice(slug, catalogs.choice); }
      catch (error) { if (error instanceof CatalogChoiceError) unresolvable = error.message; else throw error; }
      const maxSlotLevel = (row.spellSlots ?? []).reduce((highest, count, index) => count > 0 ? index + 1 : highest, 0);
      if ((row.cantripsKnown ?? 0) > 0) {
        offers.push({
          key: "class-cantrips", step: "features", featureId: null, kind: "cantrip",
          label: `${context.classRecord.name} cantrips`, help: null, capacity: row.cantripsKnown!,
          options: list.filter((option) => option.level === 0), maxSpellLevel: 0, level: 1,
          classId: context.classRecord.id, unresolvable
        });
      }
      const preparedCap = row.preparedCount ?? row.spellsKnown ?? 0;
      if (preparedCap > 0 && maxSlotLevel > 0) {
        offers.push({
          key: "class-spells", step: "features", featureId: null, kind: "spell",
          label: context.classRecord.spellcasting?.prepares === "known" ? `${context.classRecord.name} spells known` : `${context.classRecord.name} prepared spells`,
          help: null, capacity: preparedCap,
          options: list.filter((option) => (option.level ?? 0) >= 1 && (option.level ?? 0) <= maxSlotLevel),
          maxSpellLevel: maxSlotLevel, level: 1, classId: context.classRecord.id, unresolvable
        });
      }
    }
  }

  // ---- Step 6: equipment. Exactly one class option and one background option.
  if (context.classRecord && context.classRecord.startingEquipmentOptions.length > 0) {
    offers.push({
      key: "class-equipment", step: "equipment", featureId: null, kind: "equipment",
      label: `${context.classRecord.name} starting equipment`, help: null, capacity: 1,
      options: context.classRecord.startingEquipmentOptions.map((option) => ({ id: option.id, name: option.label })),
      maxSpellLevel: null, level: 1, classId: context.classRecord.id, unresolvable: null
    });
  }
  if (context.background && context.background.startingEquipmentOptions.length > 0) {
    offers.push({
      key: "background-equipment", step: "equipment", featureId: null, kind: "equipment",
      label: `${context.background.name} starting equipment`, help: null, capacity: 1,
      options: context.background.startingEquipmentOptions.map((option) => ({ id: option.id, name: option.label })),
      maxSpellLevel: null, level: 1, classId: null, unresolvable: null
    });
  }

  return offers;
}

/** The built-in "raise two points instead of taking a feat" row id the server understands. */
export const ASI_SHORTHAND = "asi";

/**
 * Drop everything the CURRENT offers no longer support, and re-mirror `subclassId`.
 *
 * Changing class from Fighter to Wizard, or dropping below the subclass level, silently invalidates
 * earlier picks. Left in place they would ride along into the payload and come back as a server
 * rejection the player cannot act on ("athletics is not an offered option"), so the draft is pruned
 * the moment the offers change. Returns the same object when nothing changed, so it is safe to run
 * from an effect.
 */
export function prunePicks(draft: BuilderDraft, offers: readonly BuilderOffer[]): BuilderDraft {
  const byKey = new Map(offers.map((offer) => [offer.key, offer]));
  const picks: Record<string, readonly string[]> = {};
  let changed = false;
  for (const [key, chosen] of Object.entries(draft.picks)) {
    const offer = byKey.get(key);
    if (!offer) { changed = true; continue; }
    const legal = chosen.filter((id) => (offer.kind === "asi-or-feat" && id === ASI_SHORTHAND) || offer.options.some((option) => option.id === id));
    const capped = legal.slice(0, offer.capacity);
    if (capped.length !== chosen.length) changed = true;
    if (capped.length > 0) picks[key] = capped;
  }
  const asiIncreases: Record<string, ReadonlyArray<{ ability: Ability; amount: number }>> = {};
  for (const [key, increases] of Object.entries(draft.asiIncreases)) {
    if (byKey.has(key)) asiIncreases[key] = increases; else changed = true;
  }
  // The subclass offer IS the subclass answer; the top-level id only mirrors it.
  const subclassOffer = offers.find((offer) => offer.kind === "subclass");
  const mirrored = subclassOffer ? (picks[subclassOffer.key] ?? [])[0] ?? null : null;
  if (mirrored !== draft.subclassId) changed = true;
  return changed ? { ...draft, picks, asiIncreases, subclassId: mirrored } : draft;
}

/** An offer is satisfied when it is exactly filled - or deferred, because its catalog is empty. */
export function offerFilled(offer: BuilderOffer, draft: BuilderDraft): boolean {
  if (offer.unresolvable !== null) return true;
  const picks = draft.picks[offer.key] ?? [];
  if (picks.length !== offer.capacity) return false;
  // The ASI route also needs its +2 spelled out, or the server rejects the row for a missing payload.
  if (offer.kind === "asi-or-feat" && picks[0] === ASI_SHORTHAND) {
    const increases = draft.asiIncreases[offer.key] ?? [];
    return increases.reduce((total, entry) => total + entry.amount, 0) === 2;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Ability scores.
// ---------------------------------------------------------------------------------------------

export const ABILITY_LABELS: Readonly<Record<Ability, string>> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"
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
 * The bonuses the CLIENT can legitimately see: the background's chosen spread, the species' printed
 * increases, and the ability points the player picked themselves (the ASI split, and any
 * `ability-score` pick a chosen feat offered). Feature RIDERS that raise a score are withheld from
 * the wire on purpose, so this is a preview of the player's own inputs - the server recomputes the
 * real total and its answer is the one that lands on the sheet.
 */
export function abilityBonusesOf(draft: BuilderDraft, catalogs: BuilderCatalogs, offers: readonly BuilderOffer[]): Record<Ability, number> {
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

export function pointBuySpent(draft: BuilderDraft): number {
  const values = ABILITIES.map((ability) => draft.spendScores[ability] ?? POINT_BUY_MINIMUM);
  const legal = values.every((value) => value >= POINT_BUY_MINIMUM && value <= POINT_BUY_MAXIMUM);
  return legal ? POINT_BUY_BUDGET - pointBuyRemaining(values, POINT_BUY_BUDGET) : POINT_BUY_BUDGET + 1;
}

// ---------------------------------------------------------------------------------------------
// The submitted payload.
// ---------------------------------------------------------------------------------------------

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

/** The `character.create` body, minus the `commandId` the caller mints. Throws only on a draft the
    step gating should already have blocked, so callers can treat it as total once Next is live. */
export function buildCreatePayload(draft: BuilderDraft, offers: readonly BuilderOffer[]): CharacterCreatePayload {
  const base = baseScoresOf(draft);
  const scores = {} as Record<Ability, number>;
  for (const ability of ABILITIES) {
    const value = base[ability];
    if (value == null) throw new Error(`${ABILITY_LABELS[ability]} has no score yet.`);
    scores[ability] = value;
  }
  if (!draft.speciesId || !draft.backgroundId || !draft.classId) throw new Error("Species, background, and class are all required.");
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

// ---------------------------------------------------------------------------------------------
// Per-step gating. Every blocked Next says WHY, in the player's words - never a dead button.
// ---------------------------------------------------------------------------------------------

export const STEP_IDS = ["species", "background", "class", "features", "abilities", "equipment", "review"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const STEP_LABELS: Readonly<Record<StepId, string>> = {
  species: "Species", background: "Background", class: "Class & level", features: "Class features",
  abilities: "Ability scores", equipment: "Equipment", review: "Name & review"
};
export const STEP_SHORT: Readonly<Record<StepId, string>> = {
  species: "Species", background: "Background", class: "Class", features: "Features",
  abilities: "Abilities", equipment: "Equipment", review: "Review"
};

const offersForStep = (offers: readonly BuilderOffer[], step: OfferStep) => offers.filter((offer) => offer.step === step);

/** The first unmet requirement of a step, phrased as an instruction, or null when the step is done. */
export function stepBlockedReason(
  step: StepId, draft: BuilderDraft, catalogs: BuilderCatalogs, offers: readonly BuilderOffer[], policy: BuilderPolicy
): string | null {
  const context = offerContext(draft, catalogs);
  const unfilled = (owner: OfferStep) => offersForStep(offers, owner).find((offer) => !offerFilled(offer, draft));
  const pickReason = (offer: BuilderOffer) => {
    const chosen = (draft.picks[offer.key] ?? []).length;
    if (offer.kind === "asi-or-feat" && chosen === offer.capacity) return `Split the +2 from "${offer.label}" across your abilities.`;
    return offer.capacity === 1
      ? `Make your "${offer.label}" choice to continue.`
      : `Choose ${offer.capacity} for "${offer.label}" — ${chosen} of ${offer.capacity} so far.`;
  };

  switch (step) {
    case "species": {
      if (!draft.speciesId) return "Choose a species to continue.";
      const offer = unfilled("species");
      return offer ? pickReason(offer) : null;
    }
    case "background": {
      if (!draft.backgroundId) return "Choose a background to continue.";
      const offer = unfilled("background");
      return offer ? pickReason(offer) : null;
    }
    case "class": {
      if (!draft.classId) return "Choose a class to continue.";
      const offer = unfilled("class");
      return offer ? pickReason(offer) : null;
    }
    case "features": {
      if (!draft.classId) return "Choose a class first.";
      if (context.classRecord && draft.level >= context.classRecord.subclassLevel && !draft.subclassId) {
        return `Choose a ${context.classRecord.subclassLabel ?? "subclass"} to continue.`;
      }
      const offer = unfilled("features");
      return offer ? pickReason(offer) : null;
    }
    case "abilities": {
      if (!policy.allowedAbilityMethods.includes(draft.abilityMethod)) return "Your GM does not allow that ability method — pick another.";
      const base = baseScoresOf(draft);
      const missing = ABILITIES.filter((ability) => base[ability] == null);
      if (missing.length > 0) return `Assign a score to ${ABILITY_LABELS[missing[0]]} to continue.`;
      if (draft.abilityMethod === "point-buy" && !isPointBuyLegal(ABILITIES.map((ability) => base[ability]!))) {
        return "That spread is over the 27-point budget — lower a score to continue.";
      }
      if (draft.abilityMethod === "standard-array") {
        const sorted = ABILITIES.map((ability) => base[ability]!).sort((left, right) => right - left).join(",");
        if (sorted !== [...STANDARD_ARRAY].join(",")) return `Use each standard-array value once (${STANDARD_ARRAY.join(", ")}).`;
      }
      const options = context.background?.abilityOptions ?? null;
      if (options) {
        const total = draft.backgroundBonus.reduce((sum, entry) => sum + entry.amount, 0);
        if (total === 0) return `Spend ${context.background!.name}'s ability increases to continue.`;
        const spread = [...draft.backgroundBonus.map((entry) => entry.amount)].sort((left, right) => right - left).join("/");
        if (!options.spreads.some((legal) => [...legal].sort((left, right) => right - left).join("/") === spread)) {
          return `${context.background!.name} allows ${options.spreads.map((legal) => `+${legal.join("/+")}`).join(" or ")} — adjust the split.`;
        }
        if (new Set(draft.backgroundBonus.map((entry) => entry.ability)).size !== draft.backgroundBonus.length) {
          return "Each background increase must go to a different ability.";
        }
      }
      if (draft.hpMode === "entries") {
        const needed = draft.level - 1;
        const faces = context.hitDie ? hitDieFaces(context.hitDie) : 12;
        if (draft.hpEntries.length !== needed) return `Enter your hit-point roll for level ${draft.hpEntries.length + 2} (${needed - draft.hpEntries.length} to go).`;
        if (draft.hpEntries.some((entry) => entry < 1 || entry > faces)) return `A ${context.hitDie} roll is 1-${faces} — fix the out-of-range entry.`;
      }
      return null;
    }
    case "equipment": {
      const offer = unfilled("equipment");
      return offer ? `Choose your ${offer.label.toLowerCase()} to continue.` : null;
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
export const previewModifier = (total: number | null) => total == null ? null : abilityModifier(total);
