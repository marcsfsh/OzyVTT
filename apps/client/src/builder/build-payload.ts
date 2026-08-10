import {
  CatalogChoiceError, extraPickAmount, resolveCatalogChoice, resolvePickChoice,
  type BuilderAbilityMethod, type BuilderPolicy, type CatalogChoiceOption, type ContentBackgroundSummary,
  type ContentChoiceList, type ContentClassSummary, type ContentExtraPickSummary, type ContentFeatSummary,
  type ContentFeatureSummary, type ContentSpeciesSummary, type ContentSubclassSummary
} from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES, ABILITY_ROLL_FORMULA, abilityModifier, hitDieFaces, isPointBuyLegal, pointBuyRemaining,
  POINT_BUY_BUDGET, POINT_BUY_MAXIMUM, POINT_BUY_MINIMUM, STANDARD_ARRAY, validateAbilityFormula,
  type Ability, type HitDie
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
  /**
   * Option id -> why this build ALREADY has it, for the proficiency kinds a character may only
   * hold once. Present (possibly empty) on those kinds, null on every other.
   *
   * The options themselves are deliberately NOT filtered out. Filtering is what makes a pick vanish
   * from a parked draft when an earlier step changes underneath it (the origin-feat reset), so the
   * option stays in the list and is DISABLED with this reason instead - visible, explained, and
   * still there when the conflict is resolved upstream.
   */
  unavailable: Readonly<Record<string, string>> | null;
}>;

/**
 * EVERY pick a feature owes, the client's mirror of the content package's `featurePicks`.
 *
 * `choice` is the first and `choices` is the whole list; a record authored either way reads the same
 * here. Reading only `choice` is what silently dropped Magic Initiate's level-1 spell.
 */
const featurePicksOf = (feature: ContentFeatureSummary): readonly NonNullable<ContentFeatureSummary["choice"]>[] =>
  feature.choices.length > 0 ? feature.choices : (feature.choice ? [feature.choice] : []);

const optionsOfIds = (ids: readonly string[], nameOf: (id: string) => string): CatalogChoiceOption[] =>
  ids.map((id) => ({ id, name: nameOf(id) }));

const titleize = (id: string) => id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

/** Resolve a feature's choice to concrete options, never throwing: a gap becomes `unresolvable`. */
function resolveChoice(
  choice: NonNullable<ContentFeatureSummary["choice"]>, catalogs: BuilderCatalogs, nameOf: (id: string) => string,
  answersFor: (offer: string) => readonly string[]
): { options: CatalogChoiceOption[]; unresolvable: string | null } {
  // THE OPTIONS ARE THE CHARACTER'S OWN EARLIER ANSWERS ("one of your known Warlock cantrips that
  // deals damage"). Resolved by the same function the server re-validates with, over the draft's own
  // answers - so the wizard offers exactly the eligible cantrips and no others. A pick made too
  // early (no cantrips chosen yet) DEFERS with the resolver's message rather than showing an empty list.
  if (choice.fromPicks) {
    try {
      return { options: resolvePickChoice(choice.fromPicks, answersFor(choice.fromPicks.offer), catalogs.choice), unresolvable: null };
    } catch (error) {
      if (!(error instanceof CatalogChoiceError)) throw error;
      return { options: [], unresolvable: error.message };
    }
  }
  const named = choice.from.length > 0 ? optionsOfIds(choice.from, nameOf) : [];
  // A CATALOG **PLUS** ONE BESPOKE OPTION. `from` used to short-circuit, so "a Fighting Style feat
  // OR Blessed Warrior (two Cleric cantrips)" was unsayable and Paladin's and Ranger's variants were
  // simply unpickable. The two are UNIONED instead, inline entries first (they are the authored
  // ones and carry their own mechanics), and an id in both keeps its inline record.
  if (!choice.fromCatalog) {
    return named.length > 0 ? { options: named, unresolvable: null } : { options: [], unresolvable: "this pick names no option list." };
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
    // `grantedAtLevels` is the level table's own answer, resolved server-side - the authoritative
    // repeat count, and the ONLY thing that agrees with the server's capacity of `choose x grants`.
    //
    // This used to be inferred, and only for `asi-or-feat`, from `asiLevels`; every other repeated
    // choice fell through to "granted once". That silently under-offered and the build was then
    // rejected at Create with "needs 4 pick(s); got 1" - a level-8 Barbarian, a level-6 Rogue
    // (Expertise at 1 and 6) and a level-10 Sorcerer (Metamagic at 2, 10, 17) were all uncreatable,
    // and a homebrew class may repeat any choice at all.
    if (feature.grantedAtLevels.length > 0) {
      for (const grantLevel of feature.grantedAtLevels) if (grantLevel <= level) granted.push({ feature, level: grantLevel });
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

/** The offer kinds whose answer IS a feat (the server's own `FEAT_KINDS`, `character-build.ts:491`). */
export const FEAT_KINDS: ReadonlySet<string> = new Set(["feat", "fighting-style", "asi-or-feat"]);

/**
 * The offer kinds whose answer is a PROFICIENCY - something a character either has or has not, and
 * can never usefully hold twice. The server dedupes the finished lists (`character-build.ts:650`)
 * and its offer guard is per-offer only (`:474-478`), so a skill offered by two different sources
 * and taken twice costs the player a pick and lands them one proficiency short, silently.
 */
const HELD_KINDS: ReadonlySet<string> = new Set(["skill", "skill-or-tool", "expertise", "tool", "language"]);

/**
 * The kinds whose options are DISABLED once already held.
 *
 * `expertise` is deliberately absent even though a repeat is just as wasteful: the SRD's expertise
 * picks read "choose one of the following skills IN WHICH YOU HAVE PROFICIENCY" and the server
 * enforces exactly that (`character-build.ts:644-646` rejects expertise without proficiency), so
 * greying out the skills you hold would leave only the picks the server refuses. Its answers still
 * feed `HELD_KINDS` above; only the "already held" disabling is skipped.
 *
 * Expertise is not left un-greyed, though - it takes the INVERSE rule, applied in
 * `withExpertiseReach` once every offer exists, because the server's proficiency test is a union
 * over sources rather than an accumulation in step order.
 */
const PROVENANCE_KINDS: ReadonlySet<string> = new Set(["skill", "skill-or-tool", "tool", "language"]);

/** What to call one of these picks in an instruction. */
const kindNoun = (kind: string) =>
  // `expertise` options ARE skills, so a blocked reason saying "pick a different option" would name
  // the thing more vaguely than the card it points at.
  kind === "skill" || kind === "expertise" ? "skill"
    : kind === "tool" ? "tool" : kind === "language" ? "language" : "option";

/**
 * Every pick this build owes, in step order. Mirrors `character-build.ts`'s offer machinery: the
 * same sources, the same `resolveCatalogChoice`, the same capacities - so a build that satisfies
 * every offer here is a build the server accepts.
 */
export function computeOffers(draft: BuilderDraft, catalogs: BuilderCatalogs): BuilderOffer[] {
  const context = offerContext(draft, catalogs);
  const offers: BuilderOffer[] = [];
  // An offer key INDEXES `draft.picks`, so two offers sharing a key share one answer - and
  // `buildChoiceRows` then submits that answer once per offer. A Human Acolyte whose Versatile pick
  // repeated the background's granted origin feat did exactly that, sending every Magic Initiate
  // cantrip twice. Keys are therefore unique by construction: the first holder keeps the plain key
  // (so a parked draft still resolves), a later collision takes a "#n" suffix. Keys never cross the
  // wire - `buildChoiceRows` sends the offer's featureId/kind/level - so the suffix costs nothing.
  const keyUses = new Map<string, number>();
  const uniqueKey = (key: string) => {
    const uses = (keyUses.get(key) ?? 0) + 1;
    keyUses.set(key, uses);
    return uses === 1 ? key : `${key}#${uses}`;
  };
  // A feat is something you HAVE, not something you can have twice. So a feat this build already
  // holds - the background's granted origin feat, or one taken in an EARLIER offer - is dropped
  // from later offers unless it may genuinely be repeated. (Champion's Additional Fighting Style
  // shares its option list with the class's Fighting Style, which is how `defense` could be taken
  // twice; Human's Versatile could re-take the Magic Initiate the Acolyte already granted.)
  const heldFeatIds = new Set<string>(context.background?.originFeatId ? [context.background.originFeatId] : []);
  // The same idea for PROFICIENCIES, which differ from feats in one way that matters: a duplicate is
  // never rejected, it is merged. Soldier grants Athletics; a Fighter's class skills offer it again;
  // taking it twice spends two picks and yields one skill, with nothing said. So every source is
  // accumulated in step order, and each offer carries the provenance of what it can no longer give.
  const heldProficiencies = new Map<string, string>();
  for (const skill of context.background?.skillProficiencies ?? []) {
    heldProficiencies.set(skill, `already granted by ${context.background!.name}`);
  }
  /** The already-held subset of these options, or null for a kind that has no such rule. */
  const unavailableOf = (kind: string, options: readonly CatalogChoiceOption[]): Readonly<Record<string, string>> | null => {
    if (!PROVENANCE_KINDS.has(kind)) return null;
    const held: Record<string, string> = {};
    for (const option of options) {
      const reason = heldProficiencies.get(option.id);
      if (reason) held[option.id] = reason;
    }
    return held;
  };
  /** Record an offer's own answers AFTER it is built, so its own picks stay tappable to un-pick. */
  const recordHeld = (offerKey: string, kind: string, label: string) => {
    if (!HELD_KINDS.has(kind)) return;
    for (const id of draft.picks[offerKey] ?? []) {
      if (!heldProficiencies.has(id)) heldProficiencies.set(id, `already chosen for "${label}"`);
    }
  };
  /**
   * WHAT AN EARLIER GRANT OF THE SAME FEATURE ALREADY SPENT - budget key -> option id -> reason.
   *
   * The one place the wizard deliberately disagrees with the server about offer SHAPE. A class
   * feature granted at two levels (Bard's Expertise at 3 and 9, Rogue's at 1 and 6, Sorcerer's
   * Metamagic at 2, 10 and 17) becomes TWO offers here, one per grant level, and that split is
   * load-bearing: `buildChoiceRows` stamps each row with its offer's level and `level-ledger.ts`
   * reads a stored row back by matching `(level, kind, classId, featureId)`, so a ledger that put
   * every Expertise at level 3 would be un-prefillable in the level-up flow. The server keeps ONE
   * offer of capacity `choose x count` and says so in `grantedClassFeatures`' own comment.
   *
   * What was missing is the consequence of that: because the server has ONE offer, its `matchRow`
   * refuses a repeated id (`character-build.ts` - `candidate.repeatable || !candidate.taken.includes`),
   * while nothing here stopped the two sibling offers from taking the same card off one shared
   * option list. `PROVENANCE_KINDS` excludes `expertise`, and `withExpertiseReach` greys only the
   * skills you are NOT proficient in - never the one the sibling offer just spent. So a Bard 9,
   * Rogue 6 or Sorcerer 10 could finish the wizard and be REFUSED at Create with
   * `The "expertise" pick "acrobatics" exceeds what this build may choose (Expertise: 4)`.
   *
   * Keyed on `budgetKeyOf`, which strips the "#n" repeat suffix, so the siblings that share one
   * server offer are exactly the ones that share an entry here - and `feature:<id>@<level>` (the ASI
   * keys) never collide, which is right: the server mints one offer per CHOSEN feat, each with its
   * own capacity, so repeating an ability there is legal and must stay offered.
   */
  const spentByRepeat = new Map<string, Map<string, string>>();
  const featRepeats = (id: string) => {
    const feat = catalogs.choice.feats.find((entry) => entry.id === id);
    if (!feat?.repeatable) return false;
    // The server's rule verbatim (`character-build.ts` repeatsOnlyWithADifferentSpellList): a feat
    // whose own choice draws from a `<list>-spells` catalog is Magic Initiate, whose repeat clause
    // reads "a different spell list each time" - and here a spell list IS a separate feat id, so
    // repeating the SAME id is not legal however the `repeatable` flag reads.
    return !featurePicksOf(feat.feature).some((pick) => pick.fromCatalog?.endsWith("-spells") ?? false);
  };
  /**
   * EXTRA PICKS - offer key -> how many picks the granted features have ADDED to it.
   *
   * The mirror of `character-build.ts`'s `extraPickBudgets`, keyed identically (the offer key both
   * sides already share), summed identically, and applied to the same capacities. A divergence
   * between the two is always the bug: this side decides what the player may pick and the server
   * re-validates it, so offering one more than the server allows refuses the build at Create, and
   * offering one fewer makes the promise in the feature's own text unselectable.
   *
   * Applied as a POST-PASS (`withGrantedPicks`, below) rather than at each `offers.push`, because a
   * grant is discovered in step order while the budget it raises may already have been built: the
   * class skills offer is step 3 and the feature that raises it is step 4.
   */
  const extraPicks = new Map<string, number>();
  const addExtraPicks = (grants: readonly ContentExtraPickSummary[] | undefined, times: number) => {
    // `extraPickAmount` is the SHARED resolver, so a budget that follows the printed column
    // (Eldritch Invocations 1 -> 10, Weapon Mastery 3 -> 6) is computed by ONE function on both
    // sides. A grant with no class in the draft yet scales off an empty table and adds nothing.
    const table = context.classRecord?.levelTable ?? [];
    for (const grant of grants ?? []) {
      extraPicks.set(grant.offer, (extraPicks.get(grant.offer) ?? 0) + extraPickAmount(grant, table, draft.level) * times);
    }
  };
  /**
   * IS THE EARLIER ANSWER A GATE NAMES ALREADY IN THE DRAFT - the client's mirror of the server's
   * `ledgerAnswered`, which reads the submitted ledger instead.
   *
   * Keyed on the offer key both sides already share. The `#n` uniquifying suffix is stripped (the
   * same normalization `budgetKeyOf` performs for budgets) so a repeated offer still answers its gate.
   */
  const answeredInDraft = (gate: Readonly<{ offer: string; id: string }>): boolean =>
    answersInDraft(gate.offer).includes(gate.id);
  /** Every answer this budget already holds - the draft-side mirror of the server's `answersFor`. */
  const answersInDraft = (offer: string): readonly string[] =>
    Object.entries(draft.picks).flatMap(([key, ids]) => budgetKeyOf(key).split("@")[0] === offer ? ids : []);
  const skillName = (id: string) => catalogs.choice.skills.find((skill) => skill.id === id)?.name ?? titleize(id);
  const spellName = (id: string) => catalogs.choice.spells.find((spell) => spell.id === id)?.name ?? titleize(id);
  // An OPTION is named, not abbreviated: this string is the card's title and the review's value, and
  // "STR" beside a review row already reading "Strength / 17" is one ability under two names. The
  // three-letter form stays where density earns it - the allocator's own column, and the `.tabular`
  // meta strips - and nowhere a name is being said in a sentence.
  const nameOfKind = (kind: string) => (id: string) =>
    kind === "skill" || kind === "expertise" || kind === "skill-or-tool" ? skillName(id)
      : kind === "spell" || kind === "cantrip" ? spellName(id)
        : kind === "ability-score" ? (ABILITIES.includes(id as Ability) ? ABILITY_LABELS[id as Ability] : titleize(id))
          : titleize(id);

  const listOffer = (key: string, step: OfferStep, kind: string, label: string, list: ContentChoiceList | { choose: number; from: readonly string[]; fromCatalog?: string | null } | null | undefined, classId: string | null) => {
    if (!list || list.choose <= 0) return;
    const offerKey = uniqueKey(key);
    // A "choose N" LIST may name an open catalog too, exactly as a feature's choice may. The species
    // language budget ("Common plus two languages from the Standard Languages table") is nineteen ids
    // that would otherwise be copied onto all nine species; `fromCatalog` keeps one source of truth,
    // resolved through the SAME function the server validates the submitted row with.
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
      key: offerKey, step, featureId: null, kind, label, help: null, capacity: list.choose,
      options, maxSpellLevel: null, level: 1, classId, unresolvable,
      unavailable: unavailableOf(kind, options)
    });
    recordHeld(offerKey, kind, label);
  };

  const featureOffer = (key: string, step: OfferStep, feature: ContentFeatureSummary, level: number, classId: string | null, times = 1) => {
    // BEFORE the early return: a feature may raise a budget without asking for a pick of its own
    // ("you gain one additional skill from your class's list" has no choice card, only a bigger one
    // on the class step). Collecting inside the offer branch would drop exactly those.
    addExtraPicks(feature.extraPicks, times);
    // EVERY pick the record owes, mirroring the server's `featurePicks` loop. Magic Initiate owes two
    // cantrips AND one level-1 spell; reading only the first is what silently dropped the spell. The
    // first pick keeps the plain key so a parked draft still resolves; later ones take "/2", "/3",
    // which `budgetKeyOf` deliberately does NOT collapse (a "#n" repeat means the same pick again,
    // a "/n" means a DIFFERENT pick on the same record, and only the former shares a budget).
    const picks = featurePicksOf(feature);
    picks.forEach((choice, index) =>
      featurePickOffer(index === 0 ? key : `${key}/${index + 1}`, step, feature, choice, level, classId, times));
  };

  const featurePickOffer = (
    key: string, step: OfferStep, feature: ContentFeatureSummary, choice: NonNullable<ContentFeatureSummary["choice"]>,
    level: number, classId: string | null, times = 1
  ) => {
    if (choice.choose <= 0) return;
    const { options, unresolvable } = resolveChoice(choice, catalogs, nameOfKind(choice.kind), answersInDraft);
    // A `maxSpellLevel` ceiling is a hard filter (Evocation Savant is level 2 and under), `minSpellLevel`
    // is its floor (Mystic Arcanum is EXACTLY a level-6 spell, not "6 or lower"), and the two spell
    // kinds do not overlap: "cantrip" means level 0, "spell" means 1+. Offering a cantrip under a
    // "spell" pick would record it at the wrong level on the sheet. The same window the server's
    // `withinSpellWindow` enforces - offering outside it refuses the build at Create.
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
    // Drop the feats this build already carries (see `heldFeatIds`); "asi" is the built-in
    // raise-two-scores shorthand, never a feat, so it is never filtered out.
    let offerable = FEAT_KINDS.has(choice.kind)
      ? filtered.filter((option) => option.id === ASI_SHORTHAND || !heldFeatIds.has(option.id) || featRepeats(option.id))
      : filtered;
    /**
     * AN OPTION GATED ON AN EARLIER ANSWER (`requires`), mirroring the server exactly.
     *
     * Improved Blessed Strikes offers two halves and the Cleric's level-7 answer already decided
     * which applies. An option whose gate is unmet is dropped; and when the survivors exactly fill
     * the capacity the answer is a CONSEQUENCE, not a choice, so no card is rendered at all - a pick
     * with one option on it is worse than the prose it replaces. The server adopts the same
     * survivors, so the two agree without the player touching anything.
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
    // A feature the class table grants MORE THAN ONCE is one offer on the server and several here
    // (see `spentByRepeat`), so its siblings share a budget key and must not share an answer.
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
      key: offerKey, step, featureId: feature.id, kind: choice.kind, label: feature.name,
      help: feature.description || null,
      capacity: choice.choose * times,
      options: offerable,
      maxSpellLevel: ceiling ?? null, level, classId, unresolvable,
      unavailable
    });
    if (FEAT_KINDS.has(choice.kind)) {
      for (const id of draft.picks[offerKey] ?? []) if (id !== ASI_SHORTHAND) heldFeatIds.add(id);
    }
    // AFTER the push, exactly as `recordHeld` is: an offer never greys out its own answers, or a
    // chosen card could not be tapped again to un-choose it.
    if (budgetKey) {
      const running = spentByRepeat.get(budgetKey) ?? new Map<string, string>();
      for (const id of draft.picks[offerKey] ?? []) {
        if (!running.has(id)) running.set(id, `already chosen for ${feature.name} at level ${level}`);
      }
      spentByRepeat.set(budgetKey, running);
    }
    recordHeld(offerKey, choice.kind, feature.name);
    /**
     * A CHOSEN INLINE OPTION IS A FEATURE, so its own picks and budget grants are the client's
     * mirror of the server's pass A2 - and until now only half of that mirror existed.
     *
     * `extraPicks` was read (Divine Order's Thaumaturge grants the extra Cleric cantrip). The
     * option's own `choice` was NOT: Blessed Warrior's two Cleric cantrips, Druidic Warrior's two
     * Druid cantrips, Pact of the Blade's weapon and Pact of the Tome's cantrips were all offered by
     * the server and rendered by nobody, so taking one produced a build the server refused with
     * "needs N pick(s)" and no card anywhere to answer it. Keyed on the OPTION's id, which is
     * exactly the key the server's pass A2 gives it.
     */
    const picked = new Set(draft.picks[offerKey] ?? []);
    for (const option of choice.options ?? []) {
      if (!picked.has(option.id)) continue;
      addExtraPicks(option.extraPicks, times);
      const nested = option.choices.length > 0 ? option.choices : (option.choice ? [option.choice] : []);
      const asFeature = { ...feature, id: option.id, name: option.name, description: option.description };
      nested.forEach((pick, index) =>
        featurePickOffer(index === 0 ? `feature:${option.id}` : `feature:${option.id}/${index + 1}`, step, asFeature, pick, level, classId, times));
    }
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
        key: uniqueKey("species-size"), step: "species", featureId: null, kind: "size", label: "Size", help: null, capacity: 1,
        options: optionsOfIds(context.species.sizes, titleize), maxSpellLevel: null, level: 1, classId: null, unresolvable: null, unavailable: null
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
    /**
     * A chosen feat's OWN feature can ask for picks (Magic Initiate's cantrips, the ASI feat's two
     * ability points). Those second-order offers exist only once the parent feat is chosen - exactly
     * the server's two-pass order.
     *
     * ONE OFFER PER INSTANCE, never one offer of N times the capacity. The server mints exactly one
     * per chosen feat (`character-build.ts`: `for (const [index, feat] of chosenFeats.entries())
     * featureOffer(feat.feature, 1, [], chosenFeatSteps[index])`), and this side used to merge them:
     * four Ability Score Improvement feats became a single `ability-score` offer of capacity 8.
     *
     * That is not a shape the wizard can answer. `ChoiceGrid` is a checkbox group - a card cannot be
     * selected twice - and `repeatable` lives on `ContentFeatSummary` but NOT on
     * `ContentFeatureChoiceSummary`, so it never crosses the wire and this side cannot know a repeat
     * was legal. Against the ASI feat's six ability cards the step read "6 of 8 chosen" with every
     * card selected, `offerFilled`'s equality never held, and Next never enabled: taking the ASI feat
     * at every improvement - the ordinary play pattern, and one of only two cards the SRD's ASI level
     * offers - made every class uncompletable at 16 and 20 (and Fighter from 12).
     *
     * Splitting also fixes the arithmetic for free: `uniqueKey` gives the repeats "#2", "#3", ... and
     * `budgetKeyOf` strips that suffix, so `extraPicks` still sum onto one budget exactly as the
     * server's `count` multiplication did.
     *
     * Every taken feat is passed on, not only the ones that ask a question, because the server folds
     * `grantExtraPicks(feat.feature, 1)` over ALL of them - a feat that raises a budget without
     * asking for a pick of its own must raise it here too, or the wizard under-offers what the
     * server then demands.
     */
    const takenFeatIds = offers
      .filter((offer) => FEAT_KINDS.has(offer.kind))
      .flatMap((offer) => (draft.picks[offer.key] ?? []).map((id) => ({ id, step: offer.step, level: offer.level, classId: offer.classId })));
    for (const taken of takenFeatIds) {
      if (taken.id === ASI_SHORTHAND) continue;
      const feat = catalogs.choice.feats.find((entry) => entry.id === taken.id);
      if (!feat) continue;
      featureOffer(`feature:${feat.feature.id}`, taken.step, feat.feature, taken.level, taken.classId);
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
          key: uniqueKey("class-cantrips"), step: "features", featureId: null, kind: "cantrip",
          label: `${context.classRecord.name} cantrips`, help: null, capacity: row.cantripsKnown!,
          options: list.filter((option) => option.level === 0), maxSpellLevel: 0, level: 1,
          classId: context.classRecord.id, unresolvable, unavailable: null
        });
      }
      const preparedCap = row.preparedCount ?? row.spellsKnown ?? 0;
      if (preparedCap > 0 && maxSlotLevel > 0) {
        offers.push({
          key: uniqueKey("class-spells"), step: "features", featureId: null, kind: "spell",
          label: context.classRecord.spellcasting?.prepares === "known" ? `${context.classRecord.name} spells known` : `${context.classRecord.name} prepared spells`,
          help: null, capacity: preparedCap,
          options: list.filter((option) => (option.level ?? 0) >= 1 && (option.level ?? 0) <= maxSlotLevel),
          maxSpellLevel: maxSlotLevel, level: 1, classId: context.classRecord.id, unresolvable, unavailable: null
        });
      }
    }
  }

  // ---- Step 6: equipment. Exactly one class option and one background option.
  if (context.classRecord && context.classRecord.startingEquipmentOptions.length > 0) {
    offers.push({
      key: uniqueKey("class-equipment"), step: "equipment", featureId: null, kind: "equipment",
      label: `${context.classRecord.name} starting equipment`, help: null, capacity: 1,
      options: context.classRecord.startingEquipmentOptions.map((option) => ({ id: option.id, name: option.label })),
      maxSpellLevel: null, level: 1, classId: context.classRecord.id, unresolvable: null, unavailable: null
    });
  }
  if (context.background && context.background.startingEquipmentOptions.length > 0) {
    offers.push({
      key: uniqueKey("background-equipment"), step: "equipment", featureId: null, kind: "equipment",
      label: `${context.background.name} starting equipment`, help: null, capacity: 1,
      options: context.background.startingEquipmentOptions.map((option) => ({ id: option.id, name: option.label })),
      maxSpellLevel: null, level: 1, classId: null, unresolvable: null, unavailable: null
    });
  }

  return withGrantedPicks(withExpertiseReach(offers, context, catalogs, draft), extraPicks);
}

/** An offer's key with any uniquifying "#n" suffix removed - what an `extraPicks` grant names. */
const budgetKeyOf = (key: string) => key.replace(/#\d+$/, "");

/**
 * CAPACITY IS THE PRINTED BUDGET PLUS WHAT WAS GRANTED - the composition step, applied once every
 * offer exists.
 *
 * Cleric level 1 prints three cantrips; Divine Order's Thaumaturge reads "you know one extra cantrip
 * from the Cleric spell list". Reading `capacity` solely off the level row made that fourth cantrip
 * unselectable - the content was right, the wizard simply had no way for a feature to reach the
 * number. Every budget-raising promise in the SRD (an extra skill, an extra prepared spell, an extra
 * language, expertise) has the same shape and now lands through the same sum.
 *
 * A grant naming no offer is ignored HERE and rejected loudly by the server, which owns the
 * authority (CLAUDE.md rule 2): it is an authoring mistake, not a player error, and there is nothing
 * useful the wizard can render for it.
 */
function withGrantedPicks(offers: readonly BuilderOffer[], extraPicks: ReadonlyMap<string, number>): BuilderOffer[] {
  if (extraPicks.size === 0) return [...offers];
  return offers.map((offer) => {
    const granted = extraPicks.get(budgetKeyOf(offer.key)) ?? 0;
    return granted === 0 ? offer : { ...offer, capacity: offer.capacity + granted };
  });
}

/**
 * Grey the expertise options this build is NOT proficient in.
 *
 * `PROVENANCE_KINDS` deliberately excludes `expertise` because the rule there is INVERTED: the SRD
 * offer reads "choose one of the following skills in which you have proficiency", so greying the
 * skills you hold would leave only the picks the server refuses (that path makes every Wizard 2+
 * uncreatable, which is why it is excluded). But nothing greyed the un-held ones either, so all six
 * Scholar options rendered enabled while at most two were ever legal - a Wizard picked Medicine,
 * walked four more steps, and was rejected at Create by `character-build.ts:645-646`. Same class of
 * dead end commit 6115320 exists to prevent; the fix is the inverse grey, not the absence of one.
 *
 * Two things make this a SECOND pass rather than part of `unavailableOf`:
 *
 * 1. The server's rule is a UNION over sources (`:643` - every skill offer's picks, the background's
 *    grants, and feature grants, in no particular order), not an accumulation in step order. Reusing
 *    the running `heldProficiencies` would grey a skill the player picks LATER in the wizard and has
 *    every right to take expertise in. Only after all offers exist is the skill set knowable.
 * 2. `heldProficiencies` also carries tools and languages, which are not skills and must not qualify.
 */
function withExpertiseReach(
  offers: BuilderOffer[], context: OfferContext, catalogs: BuilderCatalogs, draft: BuilderDraft
): BuilderOffer[] {
  if (!offers.some((offer) => offer.kind === "expertise")) return offers;
  // The server's own split: a "skill-or-tool" pick counts as a skill only if the id IS one.
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
    // Never grey an offer into a dead end. A build with none of these skills yet - or one whose
    // proficiency came from a feature grant the client cannot see, since riders stay server-side -
    // gets the old fully-enabled list and the server's message, which is strictly today's behaviour.
    // Greying everything would repeat the exact mistake this function exists to avoid.
    if (Object.keys(notProficient).length === offer.options.length) return offer;
    // MERGED, not assigned. Expertise is granted twice by three classes, and the sibling grant's
    // "already chosen for Expertise at level 3" (see `spentByRepeat`) lives in `offer.unavailable`
    // by the time this pass runs - overwriting it here is what let a Bard 9 spend the same skill
    // twice and be refused at Create. The more specific reason wins where both apply.
    return { ...offer, unavailable: { ...notProficient, ...offer.unavailable } };
  });
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

/** The hard ceiling a finished score may not pass (`character-build.ts:380` and `:585` both reject). */
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
  /** Per ASI offer key: the running scores immediately BEFORE that offer's own increases apply, so
      the offer can show what each ability would reach and refuse the ones with no room. Empty until
      every base score is assigned - there is nothing to cap before then. */
  before: ReadonlyMap<string, Readonly<Record<Ability, number>>>;
}>;

/**
 * Walk the ability scores exactly as the SERVER accumulates them and report the first increase that
 * breaks the 20 ceiling.
 *
 * This is not a game outcome the client is deciding - it is an input-validity check on the player's
 * own picks, mirroring `character-build.ts` step 2 and step 5 in their order: the background spread
 * REJECTS above 20, the species' printed increases CLAMP, each ASI row REJECTS, and a chosen
 * `ability-score` pick CLAMPS. The server still recomputes all of it and its answer wins; the
 * preview exists so a wizard-complete draft is never refused at the last button.
 */
export function abilityCapPreview(draft: BuilderDraft, catalogs: BuilderCatalogs, offers: readonly BuilderOffer[]): AbilityCapPreview {
  const before = new Map<string, Record<Ability, number>>();
  const base = baseScoresOf(draft);
  if (ABILITIES.some((ability) => base[ability] == null)) return { breach: null, before };
  const scores = Object.fromEntries(ABILITIES.map((ability) => [ability, base[ability]!])) as Record<Ability, number>;

  let breach: AbilityCapBreach | null = null;
  const overflowed = (ability: Ability, offerKey: string | null, fix: string) => {
    if (scores[ability] <= ABILITY_SCORE_CAP || breach) return;
    breach = {
      ability, total: scores[ability], offerKey,
      reason: `${ABILITY_LABELS[ability]} would be ${scores[ability]} — no ability may go above ${ABILITY_SCORE_CAP}. ${fix}`
    };
  };

  const background = catalogs.backgrounds.find((entry) => entry.id === draft.backgroundId) ?? null;
  for (const entry of draft.backgroundBonus) {
    scores[entry.ability] += entry.amount;
    overflowed(entry.ability, null, `Move ${background ? `${background.name}'s` : "the background's"} increase, or lower ${ABILITY_LABELS[entry.ability]}.`);
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
      overflowed(increase.ability, offer.key, `Change the level ${offer.level} improvement, or lower ${ABILITY_LABELS[increase.ability]}.`);
    }
  }
  return { breach, before };
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
// Roster capacity. The table stores at most 100 sheets and 200 combatants (`actor-roster.ts:9-10`,
// and the same 100 is `GameStateSchema`'s own `definitions` cap). Discovering that at Create is a
// cliff, so the wizard previews it: a warning as the table fills, and a blocked reason - never a
// rejection - once it is full. A count of what already exists, not a rules decision.
// ---------------------------------------------------------------------------------------------

export const DEFINITION_LIMIT = 100;
export const ACTOR_LIMIT = 200;
/** Warn from here on, so the GM can prune before the wizard is the thing that stops them. */
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
    return { definitions, actors, warning: null, blockedReason: `${line} Remove a character or combatant you no longer need, then create this one.` };
  }
  const near = definitions >= DEFINITION_LIMIT * CAPACITY_WARNING_FRACTION || actors >= ACTOR_LIMIT * CAPACITY_WARNING_FRACTION;
  return { definitions, actors, blockedReason: null, warning: near ? `${line} Remove characters you no longer need to keep room for new ones.` : null };
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
/** The phone rail's names. Shorter than `STEP_LABELS` where shortening loses nothing - but never
    where it renames the step: the level control lives on the class step, so "Class" would be the
    wrong name at exactly the width the short form is used. */
export const STEP_SHORT: Readonly<Record<StepId, string>> = {
  species: "Species", background: "Background", class: "Class & level", features: "Features",
  abilities: "Abilities", equipment: "Equipment", review: "Review"
};

const offersForStep = (offers: readonly BuilderOffer[], step: OfferStep) => offers.filter((offer) => offer.step === step);

/** The first unmet requirement of a step, phrased as an instruction, or null when the step is done. */
export function stepBlockedReason(
  step: StepId, draft: BuilderDraft, catalogs: BuilderCatalogs, offers: readonly BuilderOffer[], policy: BuilderPolicy
): string | null {
  const context = offerContext(draft, catalogs);
  const unfilled = (owner: OfferStep) => offersForStep(offers, owner).find((offer) => !offerFilled(offer, draft));
  /**
   * ONE template for "this pick is not answered yet", in every step that has picks.
   *
   * There were five sentence shapes for the single instruction "answer this control": one per step,
   * plus the equipment step's own, which lower-cased the label and so asked for a "fighter starting
   * equipment" under a heading reading "Fighter". The label is a NAME - it is printed as the content
   * prints it, and it is never quoted: the heading it points at carries no quotes either, and two
   * spellings of one name is the duplication this template exists to remove.
   */
  const pickReason = (offer: BuilderOffer) => {
    // Two offers on one step can share a LABEL - a level 20 Fighter answers six "Ability Score
    // Improvement" decisions - and an instruction naming a label that matches six controls names
    // none of them. Stamp the level exactly when the label alone is ambiguous, and not otherwise.
    const ambiguous = offersForStep(offers, offer.step).filter((sibling) => sibling.label === offer.label).length > 1;
    const named = ambiguous ? `level ${offer.level} ${offer.label}` : offer.label;
    const chosen = (draft.picks[offer.key] ?? []).length;
    if (offer.kind === "asi-or-feat" && chosen === offer.capacity) return `Split the +2 from ${named} across your abilities.`;
    return offer.capacity === 1
      ? `Choose your ${named} to continue.`
      : `Choose ${offer.capacity} for ${named} to continue — ${chosen} of ${offer.capacity} so far.`;
  };
  /**
   * A pick this build already holds from somewhere else. The options are not filtered out (that is
   * what silently resets a parked draft), so a pick made BEFORE the collision existed - go back,
   * change the background, come forward - survives and has to be said rather than merged away.
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
      // A class authored before its subclasses (phase 5 adds nine more) renders a subclass offer
      // with no options at all. "Choose a subclass" would then be a requirement nothing on screen
      // can satisfy, so that one IS said first - it is unsatisfiable, and it says how to get past it.
      if (classRecord && draft.level >= classRecord.subclassLevel && !draft.subclassId) {
        const subclassOffer = offers.find((offer) => offer.kind === "subclass");
        if (!subclassOffer || subclassOffer.options.length === 0) {
          const escape = classRecord.subclassLevel > 1 ? ` Drop to level ${classRecord.subclassLevel - 1} to continue.` : "";
          return `No ${classRecord.name} subclasses are available yet — a level ${classRecord.subclassLevel} ${classRecord.name} must have one.${escape}`;
        }
      }
      const conflict = heldConflict("features");
      if (conflict) return conflict;
      const offer = unfilled("features");
      // The subclass is named in the class's own words, but only when it is genuinely the first
      // unmet requirement. Announcing it ahead of `unfilled` named a control the player was not
      // using: answering Fighting Style, the footer still said "Choose a Fighter Subclass".
      if (offer) return offer.kind === "subclass"
        ? `Choose a ${classRecord?.subclassLabel ?? "subclass"} to continue.`
        : pickReason(offer);
      // An ASI that raises a score past 20 is chosen HERE but only becomes visible once the ability
      // step has scores, so the ceiling is guarded at both of its inputs with the one same sentence.
      const breach = abilityCapPreview(draft, catalogs, offers).breach;
      return breach && breach.offerKey !== null ? breach.reason : null;
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
      // A rolled or GM-formula score is a number the player typed, and the server bound-checks each
      // one against what the formula can actually produce - so the step checks the same bounds
      // rather than letting a hand-typed 22 pass six steps and fail at Create.
      if (draft.abilityMethod === "roll" || draft.abilityMethod === "custom") {
        const formula = draft.abilityMethod === "custom" ? policy.customFormula ?? ABILITY_ROLL_FORMULA : ABILITY_ROLL_FORMULA;
        const check = validateAbilityFormula(formula);
        if (check.ok) {
          const outside = ABILITIES.find((ability) => base[ability]! < check.minimum || base[ability]! > check.maximum);
          if (outside) return `A ${formula} roll produces ${check.minimum}-${check.maximum} — ${ABILITY_LABELS[outside]} ${base[outside]} is outside that. Re-roll it or correct the value.`;
        }
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
      // The 20 ceiling, checked once the scores exist: this is the step that owns them, and the
      // features step owns the improvements, so both refuse rather than letting Create dead-end.
      const breach = abilityCapPreview(draft, catalogs, offers).breach;
      if (breach) return breach.reason;
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
export const previewModifier = (total: number | null) => total == null ? null : abilityModifier(total);
