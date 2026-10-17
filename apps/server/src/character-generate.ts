import type { BuilderPolicy } from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES,
  hitDieFaces,
  meetsMulticlassMinimums,
  STANDARD_ARRAY,
  standardArrayOrder,
  statPriorityFor,
  type Ability
} from "@vtt/rules-5e";
import { featurePicks, type ClassReference } from "@vtt/content-srd-5.2.1";
import type { CharacterCreateRequestInput } from "./character-build.js";
import {
  classSpellOptions,
  computeServerOffers,
  levelGatesFit,
  levelOfPick,
  MAX_CLASSES,
  SPELLCASTING_ABILITY_KIND,
  withinOfferSpellWindow,
  type ChoiceOffer,
  type ServerOfferSurvey
} from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import { featHoldings, featPrerequisiteFailure } from "./feat-prerequisites.js";
import { CommandRejectedError } from "./game-store.js";

/** Server-side random character generator: standard array by class priority, every other decision
 *  drawn through the injected `random` (server dice; a seed reproduces a character). Picks come from
 *  `computeServerOffers`, recomputed after every answer since answers can create new picks. */

/** A die roll, 1..sides: the shape of `CommandContext.random`. */
export type DiceRandom = (sides: number) => number;

export type GenerateCharacterInput = Readonly<{
  level: number;
  /** The class to build; omitted means "surprise me", drawn from the caller's own catalog. */
  classId?: string;
  /** A multiclass character: each class with its levels, the starting class first; the levels add up to `level`. */
  classes?: ReadonlyArray<Readonly<{ classId: string; level: number }>>;
  /** A name to use verbatim; omitted draws one from the species' own name bundle. */
  name?: string;
  /** The server's own fixed builds (the sample party) pin these, which a caller's request cannot. */
  speciesId?: string;
  backgroundId?: string;
  subclassId?: string;
  /** Option ids taken first wherever an offer or a spell list has them: the sample party's signature picks. */
  favour?: ReadonlySet<string>;
}>;

/** One hit-point die thrown for a level, at its class's die size. */
export type HitPointRoll = Readonly<{ faces: number; roll: number }>;

export type GeneratedCharacter = Readonly<{
  /** The build request: `buildCharacterDefinition`'s input and `character.create`'s payload shape. */
  request: CharacterCreateRequestInput;
  /** The hit-point dice thrown (levels 2..level), each at its level's class die, for the table feed. */
  hitPointRolls: readonly HitPointRoll[];
  /** One line naming what was rolled up, for the feed row. */
  summary: string;
}>;

/** The standard array is a table policy the GM can withdraw, so check it up front. */
const GENERATOR_ABILITY_METHOD = "standard-array" as const;

/** A hard stop on the fixpoint below; a level-20 Wizard settles in under 40 passes. */
const MAX_PASSES = 400;

function reject(message: string): never {
  throw new CommandRejectedError(message);
}

/** One item, uniformly. Ids are sorted first so the same seed draws the same character regardless of Set order. */
function drawOne<T>(items: readonly T[], random: DiceRandom): T {
  if (items.length === 0) reject("The generator ran out of options to choose from.");
  return items[random(items.length) - 1];
}

/** `count` distinct items, uniformly, without replacement (fewer when the list is shorter). */
function drawSome<T>(items: readonly T[], count: number, random: DiceRandom): T[] {
  const pool = [...items];
  const drawn: T[] = [];
  while (drawn.length < count && pool.length > 0) drawn.push(...pool.splice(random(pool.length) - 1, 1));
  return drawn;
}

const sortedIds = (ids: Iterable<string>): string[] => [...ids].sort();

/** `count` items, drawn from `preferred` first and topped up from the rest of `all`. */
function drawPreferring<T>(preferred: readonly T[], all: readonly T[], count: number, random: DiceRandom): T[] {
  const first = drawSome(preferred, count, random);
  if (first.length >= count) return first;
  const rest = all.filter((item) => !first.includes(item));
  return [...first, ...drawSome(rest, count - first.length, random)];
}

// Ability scores: the one decision that is not random.

/** The order the standard array is spent in (`standardArrayOrder`), with the starting class's `statPriorityFor`: an
 *  unknown homebrew class falls back to sheet order. */
function abilityOrderFor(records: readonly ClassReference[], library: ContentView): Ability[] {
  return standardArrayOrder(statPriorityFor(records[0].id, library.classProgressionTable()), records);
}

/** `abilityOrderFor`, then the same order with each needed ability in turn moved to the last needed place: the one
 *  the standard array gives least, which the background's increase may then have to lift. */
function abilityOrdersFor(records: readonly ClassReference[], library: ContentView): Ability[][] {
  const order = abilityOrderFor(records, library);
  const needed = records.length > 1 ? neededAbilities(records, order) : 0;
  const variants = order.slice(0, needed).map((ability) => {
    const rest = order.slice(0, needed).filter((other) => other !== ability);
    return [...rest, ability, ...order.slice(needed)];
  });
  return [order, ...variants.reverse()];
}

/** How many abilities at the front of a multiclass order are there for a class's minimum. */
function neededAbilities(records: readonly ClassReference[], order: readonly Ability[]): number {
  const needs = (ability: Ability) =>
    records.some((record) =>
      (record.multiclassPrerequisites?.minimums ?? []).some((minimum) => minimum.ability === ability)
    );
  const firstFree = order.findIndex((ability) => !needs(ability));
  return firstFree === -1 ? order.length : firstFree;
}

/** The standard array spent in `order`, highest first. */
function standardArrayFor(order: readonly Ability[]): Record<Ability, number> {
  const scores = {} as Record<Ability, number>;
  for (const ability of ABILITIES) scores[ability] = STANDARD_ARRAY[STANDARD_ARRAY.length - 1];
  order.forEach((ability, index) => {
    scores[ability] = STANDARD_ARRAY[Math.min(index, STANDARD_ARRAY.length - 1)];
  });
  return scores;
}

type Allocation = Array<{ ability: Ability; amount: number }>;

/**
 * The background's increase: +2/+1 on the two abilities it may raise that come first in `order` (a background that
 * prints only +1/+1/+1 takes that). When that leaves a class short of its multiclass minimum, the first other legal
 * spread that meets every one is taken instead; null when none does.
 */
function backgroundAllocationFor(
  order: readonly Ability[],
  options: { from: readonly Ability[]; spreads: ReadonlyArray<readonly number[]> } | undefined,
  meets: (allocation: Allocation) => boolean
): Allocation | null {
  if (!options) return meets([]) ? [] : null;
  const rank = (ability: Ability) => {
    const at = order.indexOf(ability);
    return at === -1 ? ABILITIES.length : at;
  };
  const ranked = [...options.from].sort((left, right) => rank(left) - rank(right));
  // Prefer the +2/+1 spread; a background that only prints +1/+1/+1 takes that instead.
  const twoOne = options.spreads.find((spread) => [...spread].sort((a, b) => b - a).join("/") === "2/1");
  const spreadOf = (spread: readonly number[]) => [...spread].sort((left, right) => right - left);
  const placed = (spread: readonly number[], abilities: readonly Ability[]): Allocation =>
    spreadOf(spread)
      .map((amount, index) => ({ ability: abilities[index], amount }))
      .filter((entry) => entry.ability !== undefined);
  const preferred = placed(twoOne ?? options.spreads[0] ?? [], ranked);
  if (meets(preferred)) return preferred;
  const orderings = (abilities: readonly Ability[]): Ability[][] =>
    abilities.length <= 1
      ? [[...abilities]]
      : abilities.flatMap((first, index) =>
          orderings(abilities.filter((_, at) => at !== index)).map((rest) => [first, ...rest])
        );
  for (const spread of options.spreads)
    for (const abilities of orderings(ranked)) {
      const allocation = placed(spread, abilities);
      if (meets(allocation)) return allocation;
    }
  return null;
}

// Answering one offer.

/** Every ability id, so an `ability-score` pick can tell an ability from an option id. */
const ABILITY_IDS: ReadonlySet<string> = new Set(ABILITIES);

/** The row shape the wizard writes, so a generated ledger reads back like a hand-built one. */
function rowFor(offer: ChoiceOffer, id: string, index: number, payload?: Record<string, unknown>): CharacterChoice {
  return {
    level: levelOfPick(offer, index),
    ...(offer.classId ? { classId: offer.classId } : {}),
    kind: offer.kind,
    id,
    ...(offer.featureId || payload
      ? { payload: { ...(offer.featureId ? { featureId: offer.featureId } : {}), ...payload } }
      : {})
  };
}

/** Skills this build is proficient in so far: the union step 8 checks an expertise pick against. */
function proficientSkills(survey: ServerOfferSurvey): Set<string> {
  const skillIds = new Set(survey.catalogs.skills.map((skill) => skill.id));
  const held = new Set<string>(survey.background.skillProficiencies);
  for (const offer of survey.offers) {
    if (offer.kind !== "skill" && offer.kind !== "skill-or-tool") continue;
    for (const id of offer.taken) if (offer.kind === "skill" || skillIds.has(id)) held.add(id);
  }
  // Feature grants count too (step 8 tests the same union).
  for (const { record } of survey.granted) for (const skill of record.grants?.skills ?? []) held.add(skill);
  return held;
}

/** Skills an unanswered expertise pick still needs proficiency in: every option of an expertise offer with fewer
 *  proficient options than picks left (a Wizard's Scholar taken after a class whose skills share none of its six). */
function expertiseShortfall(survey: ServerOfferSurvey): Set<string> {
  const proficient = proficientSkills(survey);
  const wanted = new Set<string>();
  for (const offer of survey.offers) {
    if (offer.kind !== "expertise") continue;
    const open = [...offer.options].filter((id) => proficient.has(id) && !offer.taken.includes(id));
    if (open.length >= offer.capacity - offer.taken.length) continue;
    for (const id of offer.options) if (!proficient.has(id)) wanted.add(id);
  }
  return wanted;
}

/** Offer kinds whose answers the build refuses to repeat. */
const PROFICIENCY_KINDS: ReadonlySet<string> = new Set(["skill", "tool", "language", "skill-or-tool"]);

/** Proficiencies/languages already held of one kind, from the same fixed sources the build merges and every pick
 *  so far (the survey's and this run's), since the build refuses a repeat. */
function heldOfKind(survey: ServerOfferSurvey, kind: string, choices: readonly CharacterChoice[]): Set<string> {
  const held = new Set<string>();
  if (kind === "skill") for (const skill of survey.background.skillProficiencies) held.add(skill);
  // A later class trains only its multiclass tools (a Rogue's Thieves' Tools).
  if (kind === "tool")
    for (const tool of [
      ...survey.classRecord.toolProficiencies,
      ...survey.classes.slice(1).flatMap(({ record }) => record.multiclassProficiencies?.tools ?? []),
      ...survey.background.toolProficiencies
    ])
      held.add(tool);
  if (kind === "language")
    for (const language of [...survey.species.languages, ...survey.background.languages]) held.add(language);
  for (const offer of survey.offers) if (offer.kind === kind) for (const id of offer.taken) held.add(id);
  for (const row of choices) if (row.kind === kind || row.kind === "skill-or-tool") held.add(row.id);
  for (const { record } of survey.granted) {
    const grants = record.grants;
    // Only ungated grants are baked into the sheet.
    if (!grants || (grants.when?.length ?? 0) > 0) continue;
    for (const id of kind === "skill"
      ? grants.skills
      : kind === "tool"
        ? grants.tools
        : kind === "language"
          ? grants.languages
          : [])
      held.add(id);
  }
  return held;
}

/** The weapon ids the chosen starting-equipment bundles hand over. */
function carriedWeaponIds(survey: ServerOfferSurvey, choices: readonly CharacterChoice[]): Set<string> {
  const chosen = new Set(choices.filter((row) => row.kind === "equipment").map((row) => row.id));
  const carried = new Set<string>();
  for (const option of [...survey.classRecord.startingEquipment, ...survey.background.startingEquipment]) {
    if (!chosen.has(option.id)) continue;
    for (const item of option.items) carried.add(item.id);
  }
  return carried;
}

/** Scores as step 5 sees them: pre-increase scores plus the "asi" rows and ability-score picks so far, only
 *  those below `level` when one is given (what a feat taken at that level is checked against). */
function projectedScores(
  survey: ServerOfferSurvey,
  choices: readonly CharacterChoice[],
  level = Number.POSITIVE_INFINITY
): Record<Ability, number> {
  const scores = { ...survey.scoresBeforeIncreases };
  for (const row of choices) {
    if (row.level >= level) continue;
    if (row.kind === "ability-score" && ABILITY_IDS.has(row.id)) scores[row.id as Ability] += 1;
    if (row.kind !== "asi-or-feat" || row.id !== "asi") continue;
    for (const increase of (row.payload?.increases ?? []) as ReadonlyArray<{ ability: Ability; amount: number }>) {
      scores[increase.ability] += increase.amount;
    }
  }
  return scores;
}

/** The +2 (or +1/+1) for an "asi" row, by class priority; null when nothing has headroom. */
function asiIncreases(
  survey: ServerOfferSurvey,
  choices: readonly CharacterChoice[],
  classId: string,
  library: ContentView
): Array<{ ability: Ability; amount: number }> | null {
  const scores = projectedScores(survey, choices);
  const priority = statPriorityFor(classId, library.classProgressionTable());
  const ranked = [...priority, ...ABILITIES.filter((ability) => !priority.includes(ability))];
  const byTwo = ranked.find((ability) => scores[ability] <= 18);
  if (byTwo) return [{ ability: byTwo, amount: 2 }];
  const byOne = ranked.filter((ability) => scores[ability] <= 19).slice(0, 2);
  return byOne.length === 2 ? byOne.map((ability) => ({ ability, amount: 1 })) : null;
}

/** Whether a feat is legally takeable at this pick's level, by the prerequisites the build checks. Held feats are
 *  never redrawn, which only narrows the draw. */
function featIsTakeable(
  id: string,
  survey: ServerOfferSurvey,
  level: number,
  scores: Record<Ability, number>,
  library: ContentView
): boolean {
  if (survey.heldFeatIds.has(id)) return false;
  const feat = library.featRecord(id);
  if (!feat) return true; // an inline option and no catalog feat; the offer already vouched for it
  return featPrerequisiteFailure(feat, { ...featHoldings(survey), level, scores }) === null;
}

const FEAT_KINDS: ReadonlySet<string> = new Set(["feat", "fighting-style", "asi-or-feat"]);

/** Rows answering every outstanding pick on one offer; empty means the content can't answer it. */
function answerOffer(
  offer: ChoiceOffer,
  survey: ServerOfferSurvey,
  choices: readonly CharacterChoice[],
  input: GenerateCharacterInput & { classId: string },
  library: ContentView,
  random: DiceRandom
): CharacterChoice[] {
  const outstanding = offer.capacity - offer.taken.length;
  const scores = projectedScores(survey, choices);
  // An improvement follows the priority of the class it belongs to.
  const priorityClass = offer.classId ?? input.classId;

  // "Raise scores in place of a feat", decided per pick.
  if (offer.kind === "asi-or-feat" && random(2) === 1) {
    const increases = asiIncreases(survey, choices, priorityClass, library);
    if (increases) return [rowFor(offer, "asi", offer.taken.length, { increases })];
  }

  // An option whose own prerequisite is unmet (an invocation needing a damaging cantrip) is refused by the build.
  const legal = sortedIds(offer.options).filter(
    (id) => withinOfferSpellWindow(offer, id) && (offer.repeatable || !offer.taken.includes(id)) && !offer.unmet.has(id)
  );

  // Hard filters remove ids the validator would refuse; preferences only reorder legal ids, so running
  // out of preferred ids falls through, so the pick is never left unanswerable.
  let candidates = legal;
  let preferred: readonly string[] = legal;
  if (FEAT_KINDS.has(offer.kind)) {
    const level = levelOfPick(offer, offer.taken.length);
    const before = projectedScores(survey, choices, level);
    candidates = legal.filter((id) => featIsTakeable(id, survey, level, before, library));
    preferred = candidates;
  } else if (offer.kind === "expertise") {
    // SRD: expertise must be in skills you are proficient in; step 8 rejects otherwise.
    const proficient = proficientSkills(survey);
    const reachable = legal.filter((id) => proficient.has(id));
    if (reachable.length > 0) {
      candidates = reachable;
      preferred = reachable;
    }
  } else if (offer.kind === "ability-score") {
    // The build refuses a pick past the ceiling, so it is a hard filter.
    const ceiling = offer.maximum ?? 20;
    candidates = legal.filter((id) => !ABILITY_IDS.has(id) || scores[id as Ability] < ceiling);
    preferred = candidates;
  } else if (
    offer.kind === "skill" ||
    offer.kind === "tool" ||
    offer.kind === "language" ||
    offer.kind === "skill-or-tool"
  ) {
    // A repeat proficiency is refused by the build, so it is a hard filter. Skilled's picks may be skills or tools.
    const held =
      offer.kind === "skill-or-tool"
        ? new Set([...heldOfKind(survey, "skill", choices), ...heldOfKind(survey, "tool", choices)])
        : heldOfKind(survey, offer.kind, choices);
    candidates = legal.filter((id) => !held.has(id));
    preferred = candidates;
    // An expertise pick still to come may need one of these skills first.
    if (offer.kind === "skill" || offer.kind === "skill-or-tool") {
      const wanted = expertiseShortfall(survey);
      const covering = candidates.filter((id) => wanted.has(id));
      if (covering.length > 0) preferred = covering;
    }
  } else if (offer.kind === SPELLCASTING_ABILITY_KIND) {
    // Cast with the best of the abilities offered.
    const best = Math.max(...legal.map((id) => scores[id as Ability] ?? 0));
    preferred = legal.filter((id) => (scores[id as Ability] ?? 0) === best);
  } else if (offer.kind === "weapon-mastery") {
    // Mastery in an uncarried weapon is legal but useless, so carried weapons come first.
    const carried = carriedWeaponIds(survey, choices);
    preferred = legal.filter((id) => carried.has(id));
  }

  // The caller's favourites go first, in the order the offer lists them; the draw fills whatever is left.
  const favoured = input.favour ? preferred.filter((id) => input.favour!.has(id)).slice(0, outstanding) : [];
  let drawn = [
    ...favoured,
    ...drawPreferring(
      preferred.filter((id) => !favoured.includes(id)),
      candidates.filter((id) => !favoured.includes(id)),
      outstanding - favoured.length,
      random
    )
  ];
  if (!fitsLevelGates(offer, survey, drawn)) drawn = drawWithinLevelGates(offer, survey, preferred, candidates, random);
  const rows = drawn.map((id, at) => rowFor(offer, id, offer.taken.length + at));
  // A feat-kinded offer with no legal feat still owes its pick, and "asi" always fits.
  if (rows.length === 0 && offer.kind === "asi-or-feat") {
    const increases = asiIncreases(survey, choices, priorityClass, library);
    if (increases) return [rowFor(offer, "asi", offer.taken.length, { increases })];
  }
  return rows;
}

/** An option's class-level gate ("Level 5+ Warlock"), or 1 for none. */
const gateOf = (offer: ChoiceOffer, id: string) => offer.optionRecords?.find((option) => option.id === id)?.level ?? 1;

/** Whether an offer's picks so far plus these could all be held at its class's level (see `levelGatesFit`). */
function fitsLevelGates(offer: ChoiceOffer, survey: ServerOfferSurvey, drawn: readonly string[]): boolean {
  const entry = survey.classes.find((candidate) => candidate.record.id === offer.classId);
  if (!offer.slotLevels || !entry) return true;
  const slots = [
    ...offer.slotLevels,
    ...Array.from({ length: Math.max(0, offer.capacity - offer.slotLevels.length) }, () => entry.level)
  ];
  const gates = [...offer.taken, ...drawn].map((id) => gateOf(offer, id)).filter((gate) => gate > 1);
  return levelGatesFit(gates, slots, entry.level);
}

/** Draws an offer's picks one at a time, each only where the gates still fit with it. */
function drawWithinLevelGates(
  offer: ChoiceOffer,
  survey: ServerOfferSurvey,
  preferred: readonly string[],
  candidates: readonly string[],
  random: DiceRandom
): string[] {
  const drawn: string[] = [];
  for (let pick = offer.taken.length; pick < offer.capacity; pick += 1) {
    const fits = (id: string) => !drawn.includes(id) && fitsLevelGates(offer, survey, [...drawn, id]);
    const next = drawPreferring(preferred.filter(fits), candidates.filter(fits), 1, random)[0];
    if (next === undefined) break;
    drawn.push(next);
  }
  return drawn;
}

// The class's own spell budgets are printed columns with no offers, so they are filled here.

type SpellOption = Readonly<{ id: string; name: string; level?: number }>;

/** The spells a held feature already grants as always prepared (a Life Domain's Bless), baked the way the build bakes
 *  them: ungated grants only. A class pick of one would be spent for nothing. */
function alwaysPreparedGrants(survey: ServerOfferSurvey): Set<string> {
  return new Set(
    survey.granted.flatMap(({ record }) =>
      record.grants && (record.grants.when?.length ?? 0) === 0
        ? record.grants.spells.filter((spell) => spell.alwaysPrepared).map((spell) => spell.id)
        : []
    )
  );
}

/** Fills each casting class's cantrip and prepared-spell budgets to step 9's caps (printed column plus `extraPicks`),
 *  from its own list up to its own highest slot level. A spell sits on the sheet once, so no class repeats another's,
 *  and none repeats one a feature already keeps prepared. */
function fillSpellBudgets(
  survey: ServerOfferSurvey,
  choices: readonly CharacterChoice[],
  random: DiceRandom,
  favour?: ReadonlySet<string>
): CharacterChoice[] {
  const claimed = new Set([
    ...choices.filter((row) => row.kind === "spell" || row.kind === "cantrip").map((row) => row.id),
    ...alwaysPreparedGrants(survey)
  ]);
  const rows: CharacterChoice[] = [];
  for (const budget of survey.classSpells) {
    const list = classSpellOptions(budget, survey.catalogs);
    if (list.unresolvable) reject(`The ${budget.className} spell list could not be resolved: ${list.unresolvable}`);
    const untagged = (kind: string) =>
      choices.filter(
        (row) =>
          row.kind === kind &&
          typeof row.payload?.featureId !== "string" &&
          (row.classId ?? survey.classRecord.id) === budget.classId
      ).length;
    const top = (kind: "cantrip" | "spell", cap: number, eligible: readonly SpellOption[]) => {
      const missing = cap - untagged(kind);
      if (missing <= 0) return;
      const open = eligible.filter((spell) => !claimed.has(spell.id));
      const favoured = favour ? open.filter((spell) => favour.has(spell.id)).slice(0, missing) : [];
      for (const option of [
        ...favoured,
        ...drawSome(
          open.filter((spell) => !favoured.includes(spell)),
          missing - favoured.length,
          random
        )
      ]) {
        claimed.add(option.id);
        rows.push({ level: budget.takenAt, classId: budget.classId, kind, id: option.id });
      }
    };
    top(
      "cantrip",
      budget.cantrips,
      list.options.filter((spell) => (spell.level ?? 0) === 0)
    );
    top(
      "spell",
      budget.prepared,
      list.options.filter((spell) => (spell.level ?? 0) >= 1 && (spell.level ?? 0) <= budget.maxSlotLevel)
    );
  }
  return rows;
}

/** One class and one background bundle, only from options that hand over gear (not just gold). */
function equipmentRows(survey: ServerOfferSurvey, random: DiceRandom): CharacterChoice[] {
  const rows: CharacterChoice[] = [];
  const choose = (options: ClassReference["startingEquipment"], classId: string | null) => {
    if (options.length === 0) return;
    const gear = options.filter((option) => option.items.length > 0);
    const option = drawOne(gear.length > 0 ? gear : options, random);
    rows.push({ level: 1, ...(classId ? { classId } : {}), kind: "equipment", id: option.id });
  };
  choose(survey.classRecord.startingEquipment, survey.classRecord.id);
  choose(survey.background.startingEquipment, null);
  return rows;
}

// The generator.

/** A complete `character.create` request; throws an actionable `CommandRejectedError` on content gaps. */
export function generateCharacterRequest(
  input: GenerateCharacterInput,
  library: ContentView,
  policy: BuilderPolicy,
  random: DiceRandom
): GeneratedCharacter {
  if (!policy.allowedAbilityMethods.includes(GENERATOR_ABILITY_METHOD)) {
    reject(
      "The generator sets ability scores with the standard array, which this table does not allow. Turn it on in Settings first."
    );
  }
  // A multiclass plan takes its classes' levels in turn, the starting class first.
  const plan = input.classes ?? [
    {
      classId: input.classId ?? drawOne(sortedIds(library.classSummaries().map((entry) => entry.id)), random),
      level: input.level
    }
  ];
  if (plan.reduce((total, entry) => total + entry.level, 0) !== input.level)
    reject(
      `The class levels add up to ${plan.reduce((total, entry) => total + entry.level, 0)}, but the character is level ${input.level}.`
    );
  if (new Set(plan.map((entry) => entry.classId)).size !== plan.length) reject("Each class may be listed once.");
  if (plan.length > MAX_CLASSES) reject(`A character can have at most ${MAX_CLASSES} classes.`);
  if (input.classId && input.classId !== plan[0].classId)
    reject(`The first class is the starting class, so it must be "${input.classId}".`);
  const records = plan.map(
    (entry) => library.classRecord(entry.classId) ?? reject(`No class "${entry.classId}" is in the content catalog.`)
  );
  const classRecord = records[0];
  const classId = classRecord.id;
  const sequence = plan.flatMap((entry) => Array.from({ length: entry.level }, () => entry.classId));
  const speciesId = input.speciesId ?? drawOne(sortedIds(library.speciesSummaries().map((entry) => entry.id)), random);
  const species = library.speciesRecord(speciesId) ?? reject(`No species "${speciesId}" is in the content catalog.`);
  const backgroundId =
    input.backgroundId ?? drawOne(sortedIds(library.backgroundSummaries().map((entry) => entry.id)), random);
  const background =
    library.backgroundRecord(backgroundId) ?? reject(`No background "${backgroundId}" is in the content catalog.`);

  /** A subclass drawn for a class that has reached its subclass level. */
  const drawSubclass = (record: ClassReference, level: number): string | undefined => {
    if (level < record.subclassLevel) return undefined;
    const available = sortedIds(
      library
        .subclassSummaries()
        .filter((entry) => entry.classId === record.id)
        .map((entry) => entry.id)
    );
    if (available.length === 0)
      reject(
        `No ${record.name} ${record.subclassLabel ?? "subclass"} is in the content catalog, and a level ${level} ${record.name} needs one.`
      );
    return drawOne(available, random);
  };
  const subclassId =
    input.subclassId && plan[0].level >= classRecord.subclassLevel
      ? input.subclassId
      : drawSubclass(classRecord, plan[0].level);
  // A later class names its subclass in a ledger row at the character level it reached its subclass level, as the
  // wizard writes it.
  const laterSubclassRows: CharacterChoice[] = records.slice(1).flatMap((record, index) => {
    const id = drawSubclass(record, plan[index + 1].level);
    if (!id) return [];
    const takenAt = sequence.flatMap((entry, at) => (entry === record.id ? [at + 1] : []));
    const featureId = record.features.find((feature) =>
      featurePicks(feature).some((pick) => pick.kind === "subclass")
    )?.id;
    return [
      {
        level: takenAt[record.subclassLevel - 1],
        classId: record.id,
        kind: "subclass",
        id,
        ...(featureId ? { payload: { featureId } } : {})
      }
    ];
  });

  // Hit points are rolled through `random` and recorded by `hitPointRollRows`, so the character can be rebuilt. Each
  // level rolls its own class's die.
  const hitPointRolls = sequence.slice(1).map((id) => {
    const faces = hitDieFaces(records.find((record) => record.id === id)!.hitDie);
    return { faces, roll: random(faces) };
  });

  // Scores: the standard array where every class's multiclass minimum needs it, then the background's increase. When
  // the background can't lift the lowest of those, another needed ability takes the lowest place instead.
  const scoresFor = (order: readonly Ability[]) => {
    const baseScores = standardArrayFor(order);
    const meetsEveryMinimum = (allocation: Allocation) => {
      if (records.length === 1) return true;
      const scores = { ...baseScores };
      for (const entry of allocation) scores[entry.ability] += entry.amount;
      for (const bonus of species.abilityBonuses) scores[bonus.ability] += bonus.amount;
      return records.every((record) => meetsMulticlassMinimums(scores, record.multiclassPrerequisites));
    };
    const allocation = backgroundAllocationFor(order, background.abilityOptions, meetsEveryMinimum);
    return allocation ? { baseScores, backgroundBonusAllocation: allocation } : null;
  };
  const { baseScores, backgroundBonusAllocation } =
    abilityOrdersFor(records, library).reduce<ReturnType<typeof scoresFor>>(
      (found, order) => found ?? scoresFor(order),
      null
    ) ??
    reject(
      `The standard array and ${background.name}'s increases can't give ${records.map((record) => record.name).join(" and ")} the 13s multiclassing needs; try again or choose other classes.`
    );

  const identity = {
    // Drawn from the species' name bundle (the same one the wizard suggests from).
    name: input.name?.trim() || generateName(speciesId, library, random) || `${species.name} ${classRecord.name}`,
    speciesId,
    backgroundId,
    classId,
    level: input.level,
    ...(subclassId ? { subclassId } : {}),
    ...(records.length > 1 ? { classLevels: sequence } : {}),
    abilityMethod: GENERATOR_ABILITY_METHOD,
    baseScores,
    backgroundBonusAllocation,
    hp: { mode: "entries" as const, entries: hitPointRolls.map((entry) => entry.roll) }
  };

  const choices: CharacterChoice[] = [...laterSubclassRows];
  // One opening survey for the two rows written before the loop; neither reads a pick.
  const opening = computeServerOffers({ ...identity, choices }, library, policy);
  // Written through `rowFor` like every other pick so it carries `payload.featureId` and the offer's own
  // level, which `level-ledger.ts` matches on for level-up prefill.
  if (subclassId) {
    const offer = opening.offers.find((candidate) => candidate.kind === "subclass" && candidate.classId === classId);
    choices.push(
      offer
        ? rowFor(offer, subclassId, 0)
        : // A class with no subclass offer still needs the row (step 4 checks it), so fall back to a plain row.
          { level: classRecord.subclassLevel, classId, kind: "subclass", id: subclassId }
    );
  }
  // Size has no server offer (step 11 reads the row directly), so it is drawn here.
  if (species.sizes.length > 1) choices.push({ level: 1, kind: "size", id: drawOne([...species.sizes], random) });
  choices.push(...equipmentRows(opening, random));

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const survey = computeServerOffers({ ...identity, choices }, library, policy);
    // Fill spell budgets first: they only grow, and `fromPicks` offers need known spells present.
    const spells = fillSpellBudgets(survey, choices, random, input.favour);
    if (spells.length > 0) {
      choices.push(...spells);
      continue;
    }
    const pending = survey.offers.filter(
      (offer) => offer.unresolvable === null && offer.kind !== "subclass" && offer.taken.length < offer.capacity
    );
    // The narrowest proficiency or feat pick goes first (Keen Senses' three skills before a class's six, the
    // Champion's Additional Fighting Style before an improvement that may take any feat), so a broad pick
    // cannot take the only options a narrow one has; repeats are refused.
    const narrowest = pending
      .filter((offer) => PROFICIENCY_KINDS.has(offer.kind) || FEAT_KINDS.has(offer.kind))
      .sort((left, right) => left.options.size - right.options.size)[0];
    const open = narrowest ?? pending[0];
    if (!open) {
      return { request: { ...identity, choices }, hitPointRolls, summary: summaryOf(survey) };
    }
    const rows = answerOffer(open, survey, choices, { ...input, classId }, library, random);
    if (rows.length === 0) {
      reject(
        `"${open.label}" asks for ${open.capacity} "${open.kind}" pick(s) and the generator found no legal option for it. The gap is in the content.`
      );
    }
    choices.push(...rows);
  }
  reject("The generator could not settle this character. The content asks for more picks than it can answer.");
}

function summaryOf(survey: ServerOfferSurvey): string {
  const lineage = survey.lineage ? ` (${survey.lineage.name})` : "";
  const classes = survey.classes
    .map(
      (entry) =>
        `${entry.record.name}${survey.classes.length > 1 ? ` ${entry.level}` : ""}${entry.subclass ? ` (${entry.subclass.name})` : ""}`
    )
    .join(" / ");
  return `${survey.species.name}${lineage} ${classes} · ${survey.background.name}`;
}

/** A name from the species' name bundle, or null when the content has none. */
function generateName(speciesId: string, library: ContentView, random: DiceRandom): string | null {
  const bundle = library.nameBundles().find((entry) => entry.speciesId === speciesId);
  if (!bundle) return null;
  const family = /-(family|clan)$/;
  const surnames = bundle.pools.filter((pool) => family.test(pool.id)).flatMap((pool) => pool.names);
  const givens = bundle.pools.filter((pool) => !family.test(pool.id)).flatMap((pool) => pool.names);
  if (givens.length === 0) return null;
  const given = drawOne([...givens].sort(), random);
  return surnames.length > 0 ? `${given} ${drawOne([...surnames].sort(), random)}` : given;
}
