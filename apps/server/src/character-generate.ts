import type { BuilderPolicy } from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import { ABILITIES, hitDieFaces, STANDARD_ARRAY, statPriorityFor, type Ability } from "@vtt/rules-5e";
import type { ClassReference } from "@vtt/content-srd-5.2.1";
import type { CharacterCreateRequestInput } from "./character-build.js";
import {
  classSpellList,
  computeServerOffers,
  levelOfPick,
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

/** A die roll, 1..sides - the shape of `CommandContext.random`. */
export type DiceRandom = (sides: number) => number;

export type GenerateCharacterInput = Readonly<{
  level: number;
  /** The class to build; omitted means "surprise me", drawn from the caller's own catalog. */
  classId?: string;
  /** A name to use verbatim; omitted draws one from the species' own name bundle. */
  name?: string;
}>;

export type GeneratedCharacter = Readonly<{
  /** The build request: `buildCharacterDefinition`'s input and `character.create`'s payload shape. */
  request: CharacterCreateRequestInput;
  /** The hit-point dice thrown (levels 2..level), for the table feed. */
  hitPointRolls: readonly number[];
  hitDieFaces: number;
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

/** `count` items, drawing from `preferred` first and topping up from the rest of `all`. */
function drawPreferring<T>(preferred: readonly T[], all: readonly T[], count: number, random: DiceRandom): T[] {
  const first = drawSome(preferred, count, random);
  if (first.length >= count) return first;
  const rest = all.filter((item) => !first.includes(item));
  return [...first, ...drawSome(rest, count - first.length, random)];
}

// Ability scores: the one decision that is not random.

/** The standard array by `statPriorityFor` (an unknown homebrew class falls back to sheet order). */
function standardArrayFor(classId: string, library: ContentView): Record<Ability, number> {
  const priority = statPriorityFor(classId, library.classProgressionTable());
  const ordered = [...priority, ...ABILITIES.filter((ability) => !priority.includes(ability))];
  const scores = {} as Record<Ability, number>;
  for (const ability of ABILITIES) scores[ability] = STANDARD_ARRAY[STANDARD_ARRAY.length - 1];
  ordered.forEach((ability, index) => {
    scores[ability] = STANDARD_ARRAY[Math.min(index, STANDARD_ARRAY.length - 1)];
  });
  return scores;
}

/** The background's +2/+1, placed on the two highest-priority abilities the background may raise. */
function backgroundAllocationFor(
  classId: string,
  library: ContentView,
  options: { from: readonly Ability[]; spreads: ReadonlyArray<readonly number[]> } | undefined
): Array<{ ability: Ability; amount: number }> {
  if (!options) return [];
  const priority = statPriorityFor(classId, library.classProgressionTable());
  const ranked = [...options.from].sort((left, right) => {
    const rank = (ability: Ability) => {
      const at = priority.indexOf(ability);
      return at === -1 ? ABILITIES.length : at;
    };
    return rank(left) - rank(right);
  });
  // Prefer the +2/+1 spread; a background that only prints +1/+1/+1 takes that instead.
  const twoOne = options.spreads.find((spread) => [...spread].sort((a, b) => b - a).join("/") === "2/1");
  const spread = [...(twoOne ?? options.spreads[0] ?? [])].sort((left, right) => right - left);
  return spread
    .map((amount, index) => ({ ability: ranked[index], amount }))
    .filter((entry) => entry.ability !== undefined);
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

/** Offer kinds whose answers the build refuses to repeat. */
const PROFICIENCY_KINDS: ReadonlySet<string> = new Set(["skill", "tool", "language", "skill-or-tool"]);

/** Proficiencies/languages already held of one kind, from the same fixed sources the build merges and every pick
 *  so far (the survey's and this run's), since the build refuses a repeat. */
function heldOfKind(survey: ServerOfferSurvey, kind: string, choices: readonly CharacterChoice[]): Set<string> {
  const held = new Set<string>();
  if (kind === "skill") for (const skill of survey.background.skillProficiencies) held.add(skill);
  if (kind === "tool")
    for (const tool of [...survey.classRecord.toolProficiencies, ...survey.background.toolProficiencies])
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
  if (!feat) return true; // an inline option rather than a catalog feat; the offer already vouched for it
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

  // "Raise scores instead of taking a feat", decided per pick.
  if (offer.kind === "asi-or-feat" && random(2) === 1) {
    const increases = asiIncreases(survey, choices, input.classId, library);
    if (increases) return [rowFor(offer, "asi", offer.taken.length, { increases })];
  }

  const legal = sortedIds(offer.options).filter(
    (id) => withinOfferSpellWindow(offer, id) && (offer.repeatable || !offer.taken.includes(id))
  );

  // Hard filters remove ids the validator would refuse; preferences only reorder legal ids, so running
  // out of preferred ids falls through instead of leaving the pick unanswerable.
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
  } else if (offer.kind === SPELLCASTING_ABILITY_KIND) {
    // Cast with the best of the abilities offered.
    const best = Math.max(...legal.map((id) => scores[id as Ability] ?? 0));
    preferred = legal.filter((id) => (scores[id as Ability] ?? 0) === best);
  } else if (offer.kind === "weapon-mastery") {
    // Mastery in an uncarried weapon is legal but useless, so carried weapons come first.
    const carried = carriedWeaponIds(survey, choices);
    preferred = legal.filter((id) => carried.has(id));
  }

  const drawn = drawPreferring(preferred, candidates, outstanding, random);
  const rows = drawn.map((id, at) => rowFor(offer, id, offer.taken.length + at));
  // A feat-kinded offer with no legal feat still owes its pick, and "asi" always fits.
  if (rows.length === 0 && offer.kind === "asi-or-feat") {
    const increases = asiIncreases(survey, choices, input.classId, library);
    if (increases) return [rowFor(offer, "asi", offer.taken.length, { increases })];
  }
  return rows;
}

// The class's own spell budgets are printed columns rather than offers, so they are filled here.

type SpellOption = Readonly<{ id: string; name: string; level?: number }>;

/** The class (or subclass) spell list this build casts from, or null when it casts nothing. */
function spellListOf(survey: ServerOfferSurvey): { options: readonly SpellOption[]; maxSlotLevel: number } | null {
  const list = classSpellList(survey.classRecord, survey.subclass, survey.levelRow, survey.catalogs);
  if (list?.unresolvable)
    reject(`The ${survey.classRecord.name} spell list could not be resolved: ${list.unresolvable}`);
  return list;
}

/** Fills the class cantrip and prepared-spell budgets to step 9's caps (printed column plus `extraPicks`). */
function fillSpellBudgets(
  survey: ServerOfferSurvey,
  choices: readonly CharacterChoice[],
  random: DiceRandom
): CharacterChoice[] {
  const list = spellListOf(survey);
  if (!list) return [];
  const claimed = new Set(choices.filter((row) => row.kind === "spell" || row.kind === "cantrip").map((row) => row.id));
  const untagged = (kind: string) =>
    choices.filter((row) => row.kind === kind && typeof row.payload?.featureId !== "string").length;
  const rows: CharacterChoice[] = [];
  const top = (kind: "cantrip" | "spell", cap: number, eligible: readonly SpellOption[]) => {
    const missing = cap - untagged(kind);
    if (missing <= 0) return;
    for (const option of drawSome(
      eligible.filter((spell) => !claimed.has(spell.id)),
      missing,
      random
    )) {
      claimed.add(option.id);
      rows.push({ level: 1, classId: survey.classRecord.id, kind, id: option.id });
    }
  };
  top(
    "cantrip",
    survey.printedCantrips + (survey.extraPickBudgets.get("class-cantrips") ?? 0),
    list.options.filter((spell) => (spell.level ?? 0) === 0)
  );
  top(
    "spell",
    survey.printedPrepared + (survey.extraPickBudgets.get("class-spells") ?? 0),
    list.options.filter((spell) => (spell.level ?? 0) >= 1 && (spell.level ?? 0) <= list.maxSlotLevel)
  );
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
      "The generator sets ability scores with the standard array, which this table does not allow - enable it in Settings first."
    );
  }
  const classId = input.classId ?? drawOne(sortedIds(library.classSummaries().map((entry) => entry.id)), random);
  const classRecord = library.classRecord(classId) ?? reject(`No class "${classId}" is in the content catalog.`);
  const speciesId = drawOne(sortedIds(library.speciesSummaries().map((entry) => entry.id)), random);
  const species = library.speciesRecord(speciesId)!;
  const backgroundId = drawOne(sortedIds(library.backgroundSummaries().map((entry) => entry.id)), random);
  const background = library.backgroundRecord(backgroundId)!;

  let subclassId: string | undefined;
  if (input.level >= classRecord.subclassLevel) {
    const available = sortedIds(
      library
        .subclassSummaries()
        .filter((entry) => entry.classId === classId)
        .map((entry) => entry.id)
    );
    if (available.length === 0)
      reject(
        `No ${classRecord.name} ${classRecord.subclassLabel ?? "subclass"} is in the content catalog, and a level-${input.level} ${classRecord.name} needs one.`
      );
    subclassId = drawOne(available, random);
  }

  // Hit points are rolled through `random` and recorded by `hitPointRollRows`, so the character can be rebuilt.
  const faces = hitDieFaces(classRecord.hitDie);
  const hitPointRolls = Array.from({ length: Math.max(0, input.level - 1) }, () => random(faces));

  const identity = {
    // Drawn from the species' name bundle (the same one the wizard suggests from).
    name: input.name?.trim() || generateName(speciesId, library, random) || `${species.name} ${classRecord.name}`,
    speciesId,
    backgroundId,
    classId,
    level: input.level,
    ...(subclassId ? { subclassId } : {}),
    abilityMethod: GENERATOR_ABILITY_METHOD,
    baseScores: standardArrayFor(classId, library),
    backgroundBonusAllocation: backgroundAllocationFor(classId, library, background.abilityOptions),
    hp: { mode: "entries" as const, entries: hitPointRolls }
  };

  const choices: CharacterChoice[] = [];
  // One opening survey for the two rows written before the loop; neither reads a pick.
  const opening = computeServerOffers({ ...identity, choices }, library, policy);
  // Written through `rowFor` like every other pick so it carries `payload.featureId` and the offer's own
  // level, which `level-ledger.ts` matches on for level-up prefill.
  if (subclassId) {
    const offer = opening.offers.find((candidate) => candidate.kind === "subclass");
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
    const spells = fillSpellBudgets(survey, choices, random);
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
      return { request: { ...identity, choices }, hitPointRolls, hitDieFaces: faces, summary: summaryOf(survey) };
    }
    const rows = answerOffer(open, survey, choices, { ...input, classId }, library, random);
    if (rows.length === 0) {
      reject(
        `"${open.label}" asks for ${open.capacity} "${open.kind}" pick(s) and the generator found no legal option for it - that is a gap in the content, not in the request.`
      );
    }
    choices.push(...rows);
  }
  reject("The generator could not settle this character - the content asks for more picks than it can answer.");
}

function summaryOf(survey: ServerOfferSurvey): string {
  const lineage = survey.lineage ? ` (${survey.lineage.name})` : "";
  const subclass = survey.subclass ? ` (${survey.subclass.name})` : "";
  return `${survey.species.name}${lineage} ${survey.classRecord.name}${subclass} · ${survey.background.name}`;
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
