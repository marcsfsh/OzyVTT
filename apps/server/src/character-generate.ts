import type { BuilderPolicy } from "@vtt/domain";
import { CatalogChoiceError, resolveCatalogChoice } from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import { ABILITIES, hitDieFaces, STANDARD_ARRAY, statPriorityFor, type Ability } from "@vtt/rules-5e";
import type { ClassReference } from "@vtt/content-srd-5.2.1";
import {
  computeServerOffers, levelOfPick, withinOfferSpellWindow,
  type CharacterCreateRequestInput, type ChoiceOffer, type ServerOfferSurvey
} from "./character-build.js";
import type { ContentView } from "./content-library.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * THE RANDOM CHARACTER GENERATOR (issue `2d`), SERVER-SIDE.
 *
 * A complete, playable, single-class character at a named level: the standard array distributed by
 * the class's own stat priority, and every remaining decision - species, background, lineage,
 * subclass, skills, feats, spells, equipment - drawn at random.
 *
 * **Every draw goes through the injected `random`**, which the command hands `context.random`, the
 * same authority every other roll at this table comes from (CLAUDE.md rule 2, decision D14). The
 * wizard's name shuffler calls `Math.random` in the browser; that is the pattern this is NOT.
 * Injecting the function is also what makes the generator testable: one seed, one character.
 *
 * **It answers REAL offers, and only real offers.** `computeServerOffers` is the first four steps of
 * `buildCharacterDefinition` itself, so what may be picked here and what will be accepted there are
 * the same list by construction. There is no second model of the content and no second set of rules
 * about what a Cleric owes - a divergence between the generator's picks and the validator's offers
 * would be the same bug class as `computeOffers` vs `character-build.ts`, where the rule is that the
 * divergence is always the bug.
 *
 * **The loop is a fixpoint, not a script.** Answering a pick can create picks (a chosen feat asks
 * for its own; a chosen option raises a budget; a lineage brings traits that ask for more), so the
 * offers are recomputed from the growing ledger after every answer rather than enumerated once. It
 * terminates because every pass either records a row or stops.
 */

/** A die roll, 1..sides - the shape of `GameOperationsContext.random`. */
export type DiceRandom = (sides: number) => number;

export type GenerateCharacterInput = Readonly<{
  level: number;
  /** The class to build; omitted means "surprise me", drawn from the caller's own catalog. */
  classId?: string;
  /** A name to use verbatim; omitted draws one from the species' own name bundle. */
  name?: string;
}>;

export type GeneratedCharacter = Readonly<{
  /** The build request - the literal input `buildCharacterDefinition` takes, and `character.create`'s payload shape. */
  request: CharacterCreateRequestInput;
  /** The hit-point dice this generation threw (levels 2..level), and the die they were thrown on, for the table feed. */
  hitPointRolls: readonly number[];
  hitDieFaces: number;
  /** One line naming what was rolled up, for the feed row. */
  summary: string;
}>;

/**
 * The generator sets ability scores with the standard array, which is a TABLE POLICY the GM can
 * withdraw (`builderPolicy.allowedAbilityMethods`). Saying so here beats `validateBaseScores`
 * rejecting the assembled build four hundred lines later with the same fact.
 */
const GENERATOR_ABILITY_METHOD = "standard-array" as const;

/** A hard stop on the fixpoint below. Nothing in the SRD comes close: a level-20 Wizard settles in under 40 passes. */
const MAX_PASSES = 400;

function reject(message: string): never { throw new CommandRejectedError(message); }

/** One item, uniformly. Ids are sorted first so the same seed draws the same character whatever order a Set happened to hold. */
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

// ---------------------------------------------------------------------------------------------
// Ability scores: the one decision that is NOT random.
// ---------------------------------------------------------------------------------------------

/**
 * The standard array, best value to most important ability. `statPriorityFor` is the shipped lookup
 * (`packages/rules-5e/class-data.ts`) - every class already carries a `statPriority`, and an unknown
 * homebrew class falls back to sheet order there rather than throwing, so this never dead-ends.
 */
export function standardArrayFor(classId: string, library: ContentView): Record<Ability, number> {
  const priority = statPriorityFor(classId, library.classProgressionTable());
  const ordered = [...priority, ...ABILITIES.filter((ability) => !priority.includes(ability))];
  const scores = {} as Record<Ability, number>;
  for (const ability of ABILITIES) scores[ability] = STANDARD_ARRAY[STANDARD_ARRAY.length - 1];
  ordered.forEach((ability, index) => { scores[ability] = STANDARD_ARRAY[Math.min(index, STANDARD_ARRAY.length - 1)]; });
  return scores;
}

/**
 * The background's printed +2/+1, aimed the same way: the two highest-priority abilities the
 * background is actually allowed to raise. The background itself is random, so which abilities are
 * on offer is random; where the points go inside that is not.
 */
function backgroundAllocationFor(
  classId: string, library: ContentView, options: { from: readonly Ability[]; spreads: ReadonlyArray<readonly number[]> } | undefined
): Array<{ ability: Ability; amount: number }> {
  if (!options) return [];
  const priority = statPriorityFor(classId, library.classProgressionTable());
  const ranked = [...options.from].sort((left, right) => {
    const rank = (ability: Ability) => { const at = priority.indexOf(ability); return at === -1 ? ABILITIES.length : at; };
    return rank(left) - rank(right);
  });
  // Prefer the +2/+1 spread; a background that only prints +1/+1/+1 takes that instead.
  const twoOne = options.spreads.find((spread) => [...spread].sort((a, b) => b - a).join("/") === "2/1");
  const spread = [...(twoOne ?? options.spreads[0] ?? [])].sort((left, right) => right - left);
  return spread.map((amount, index) => ({ ability: ranked[index], amount })).filter((entry) => entry.ability !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Answering one offer.
// ---------------------------------------------------------------------------------------------

/** Every ability id, so an `ability-score` pick can tell an ability from an option id. */
const ABILITY_IDS: ReadonlySet<string> = new Set(ABILITIES);

/** The row shape the wizard writes, so a generated ledger reads back exactly like a hand-built one. */
function rowFor(offer: ChoiceOffer, id: string, index: number, payload?: Record<string, unknown>): CharacterChoice {
  return {
    level: levelOfPick(offer, index),
    ...(offer.classId ? { classId: offer.classId } : {}),
    kind: offer.kind,
    id,
    ...(offer.featureId || payload ? { payload: { ...(offer.featureId ? { featureId: offer.featureId } : {}), ...payload } } : {})
  };
}

/** The skills this build is proficient in so far - the union `character-build.ts` step 8 tests an expertise pick against. */
function proficientSkills(survey: ServerOfferSurvey): Set<string> {
  const skillIds = new Set(survey.catalogs.skills.map((skill) => skill.id));
  const held = new Set<string>(survey.background.skillProficiencies);
  for (const offer of survey.offers) {
    if (offer.kind !== "skill" && offer.kind !== "skill-or-tool") continue;
    for (const id of offer.taken) if (offer.kind === "skill" || skillIds.has(id)) held.add(id);
  }
  // Feature GRANTS too. The wizard cannot see these (riders stay server-side, which is why its own
  // `withExpertiseReach` stops at picks), but this side can - and step 8's test is the same union.
  for (const { record } of survey.granted) for (const skill of record.grants?.skills ?? []) held.add(skill);
  return held;
}

/** Proficiencies/languages this build already holds of one kind - a second pick of the same id spends a budget and yields nothing. */
function heldOfKind(survey: ServerOfferSurvey, kind: string): Set<string> {
  const held = new Set<string>();
  if (kind === "skill") for (const skill of survey.background.skillProficiencies) held.add(skill);
  if (kind === "tool") for (const tool of survey.background.toolProficiencies) held.add(tool);
  if (kind === "language") for (const language of survey.species.languages) held.add(language);
  for (const offer of survey.offers) if (offer.kind === kind) for (const id of offer.taken) held.add(id);
  for (const { record } of survey.granted) {
    const grants = record.grants;
    if (!grants) continue;
    for (const id of kind === "skill" ? grants.skills : kind === "tool" ? grants.tools : kind === "language" ? grants.languages : []) held.add(id);
  }
  return held;
}

/** The weapon ids this build's chosen starting-equipment bundles actually hand over. */
function carriedWeaponIds(survey: ServerOfferSurvey, choices: readonly CharacterChoice[]): Set<string> {
  const chosen = new Set(choices.filter((row) => row.kind === "equipment").map((row) => row.id));
  const carried = new Set<string>();
  for (const option of [...survey.classRecord.startingEquipment, ...survey.background.startingEquipment]) {
    if (!chosen.has(option.id)) continue;
    for (const item of option.items) carried.add(item.id);
  }
  return carried;
}

/**
 * Ability scores as step 5 will see them when it checks an ASI against the SRD's 20.
 *
 * `scoresBeforeIncreases` is the survey's own number (base + background spread + species bonuses);
 * the "asi" rows already in the ledger are added on top, because step 5 folds every one of them
 * before it folds anything else. Chosen `ability-score` picks are deliberately NOT added: they land
 * after the ASI rows and clamp rather than reject, so counting them here would only refuse legal
 * increases.
 */
function projectedScores(survey: ServerOfferSurvey, choices: readonly CharacterChoice[]): Record<Ability, number> {
  const scores = { ...survey.scoresBeforeIncreases };
  for (const row of choices) {
    if (row.kind !== "asi-or-feat" || row.id !== "asi") continue;
    for (const increase of (row.payload?.increases ?? []) as ReadonlyArray<{ ability: Ability; amount: number }>) {
      scores[increase.ability] += increase.amount;
    }
  }
  return scores;
}

/**
 * The +2 (or +1/+1) an "asi" row carries, aimed by the class's own priority.
 *
 * The FEAT-OR-SCORES decision is random, as the issue asks; where the points go once "scores" wins
 * is not, for the same reason the standard array is not. A level-20 Fighter whose four ASIs landed
 * on Intelligence would be a random character rather than a playable one, and playable is the ask.
 * Returns null when nothing has headroom - the caller then takes a feat instead.
 */
function asiIncreases(survey: ServerOfferSurvey, choices: readonly CharacterChoice[], classId: string, library: ContentView): Array<{ ability: Ability; amount: number }> | null {
  const scores = projectedScores(survey, choices);
  const priority = statPriorityFor(classId, library.classProgressionTable());
  const ranked = [...priority, ...ABILITIES.filter((ability) => !priority.includes(ability))];
  const byTwo = ranked.find((ability) => scores[ability] <= 18);
  if (byTwo) return [{ ability: byTwo, amount: 2 }];
  const byOne = ranked.filter((ability) => scores[ability] <= 19).slice(0, 2);
  return byOne.length === 2 ? byOne.map((ability) => ({ ability, amount: 1 })) : null;
}

/**
 * Is this feat legally takeable right now?
 *
 * A feat already held is simply never drawn. The SRD's repeat rules are real (`ability-score-
 * improvement` and `skilled` repeat; the three Magic Initiates repeat only with a different spell
 * list) but the generator has no need of them: refusing every repeat can only shrink the draw, never
 * produce a build the validator refuses, and thirty-odd general feats leave plenty to choose from.
 */
function featIsTakeable(id: string, survey: ServerOfferSurvey, level: number, scores: Record<Ability, number>, library: ContentView): boolean {
  if (survey.heldFeatIds.has(id)) return false;
  const feat = library.featRecord(id);
  if (!feat) return true; // an inline option rather than a catalog feat; the offer already vouched for it
  if (feat.prerequisite?.level !== undefined && level < feat.prerequisite.level) return false;
  return (feat.prerequisite?.abilityScores ?? []).every((minimum) => scores[minimum.ability] >= minimum.minimum);
}

const FEAT_KINDS: ReadonlySet<string> = new Set(["feat", "fighting-style", "asi-or-feat"]);

/**
 * The rows that answer ONE offer - every outstanding pick on it, at once.
 *
 * Empty means "this offer cannot be answered", which is a finding about the CONTENT rather than a
 * state the generator recovers from: the caller says so by name and stops.
 */
function answerOffer(
  offer: ChoiceOffer, survey: ServerOfferSurvey, choices: readonly CharacterChoice[],
  input: GenerateCharacterInput & { classId: string }, library: ContentView, random: DiceRandom
): CharacterChoice[] {
  const outstanding = offer.capacity - offer.taken.length;
  const scores = projectedScores(survey, choices);

  // "Raise two points instead of taking a feat" - the built-in shorthand, decided per pick.
  if (offer.kind === "asi-or-feat" && random(2) === 1) {
    const increases = asiIncreases(survey, choices, input.classId, library);
    if (increases) return [rowFor(offer, "asi", offer.taken.length, { increases })];
  }

  const legal = sortedIds(offer.options).filter((id) =>
    withinOfferSpellWindow(offer, id)
    && (offer.repeatable || !offer.taken.includes(id)));

  // A HARD filter refuses ids the validator would refuse; a PREFERENCE reorders ids that are all
  // legal but not all sensible. Keeping them apart matters: a hard filter that ran out of options
  // would leave the pick unanswerable, while a preference that runs out simply falls through to the
  // rest of the list and the character is a little less tidy.
  let candidates = legal;
  let preferred: readonly string[] = legal;
  if (FEAT_KINDS.has(offer.kind)) {
    candidates = legal.filter((id) => featIsTakeable(id, survey, input.level, scores, library));
    preferred = candidates;
  } else if (offer.kind === "expertise") {
    // SRD: "choose skills in which you have proficiency". Step 8 rejects the build outright
    // otherwise, so this is a hard filter rather than the wizard's advisory greying.
    const proficient = proficientSkills(survey);
    const reachable = legal.filter((id) => proficient.has(id));
    if (reachable.length > 0) { candidates = reachable; preferred = reachable; }
  } else if (offer.kind === "ability-score") {
    const ceiling = offer.maximum ?? 20;
    preferred = legal.filter((id) => !ABILITY_IDS.has(id) || scores[id as Ability] < ceiling);
  } else if (offer.kind === "skill" || offer.kind === "tool" || offer.kind === "language" || offer.kind === "skill-or-tool") {
    // A duplicate proficiency is legal and worthless: it spends the pick and merges into one entry.
    const held = heldOfKind(survey, offer.kind === "skill-or-tool" ? "skill" : offer.kind);
    preferred = legal.filter((id) => !held.has(id));
  } else if (offer.kind === "weapon-mastery") {
    // Mastery in a weapon this character is not carrying is legal and inert - the SRD pick is over
    // the whole weapon table, so nothing rejects it, and a Fighter with mastery in a blowgun he does
    // not own has spent a class feature on nothing. Own weapons first; the rest of the table after.
    const carried = carriedWeaponIds(survey, choices);
    preferred = legal.filter((id) => carried.has(id));
  }

  const drawn = drawPreferring(preferred, candidates, outstanding, random);
  const rows = drawn.map((id, at) => rowFor(offer, id, offer.taken.length + at));
  // A feat-kinded offer that could draw nothing legal still owes its pick, and "asi" always fits.
  if (rows.length === 0 && offer.kind === "asi-or-feat") {
    const increases = asiIncreases(survey, choices, input.classId, library);
    if (increases) return [rowFor(offer, "asi", offer.taken.length, { increases })];
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The class's own spell budgets - printed columns rather than offers, so they are filled by hand.
// ---------------------------------------------------------------------------------------------

type SpellOption = Readonly<{ id: string; name: string; level?: number }>;

/** The class (or subclass) spell list this build casts from, or null when it casts nothing. */
function spellListOf(survey: ServerOfferSurvey): { options: readonly SpellOption[]; maxSlotLevel: number } | null {
  const casting = survey.subclass?.spellcasting ?? survey.classRecord.spellcasting ?? null;
  if (!casting) return null;
  const slug = `${casting.spellListId ?? survey.classRecord.id}-spells`;
  let options: readonly SpellOption[];
  try { options = resolveCatalogChoice(slug, survey.catalogs); }
  catch (error) {
    if (!(error instanceof CatalogChoiceError)) throw error;
    reject(`The ${survey.classRecord.name} spell list could not be resolved: ${error.message}`);
  }
  const row = survey.levelRow;
  const slots = row.pactSlots
    ? (row.pactSlots.slots > 0 ? [{ level: row.pactSlots.level }] : [])
    : (row.spellSlots ?? []).map((count, index) => ({ level: index + 1, count })).filter((slot) => slot.count > 0);
  return { options, maxSlotLevel: slots.reduce((highest, slot) => Math.max(highest, slot.level), 0) };
}

/**
 * Top the class's cantrip and prepared-spell budgets up to the caps step 9 will check them against -
 * the printed column PLUS every `extraPicks` grant, composed exactly as step 9 composes it.
 */
function fillSpellBudgets(survey: ServerOfferSurvey, choices: readonly CharacterChoice[], random: DiceRandom): CharacterChoice[] {
  const list = spellListOf(survey);
  if (!list) return [];
  const claimed = new Set(choices.filter((row) => row.kind === "spell" || row.kind === "cantrip").map((row) => row.id));
  const untagged = (kind: string) => choices.filter((row) => row.kind === kind && typeof row.payload?.featureId !== "string").length;
  const rows: CharacterChoice[] = [];
  const top = (kind: "cantrip" | "spell", cap: number, eligible: readonly SpellOption[]) => {
    const missing = cap - untagged(kind);
    if (missing <= 0) return;
    for (const option of drawSome(eligible.filter((spell) => !claimed.has(spell.id)), missing, random)) {
      claimed.add(option.id);
      rows.push({ level: 1, classId: survey.classRecord.id, kind, id: option.id });
    }
  };
  top("cantrip", survey.printedCantrips + (survey.extraPickBudgets.get("class-cantrips") ?? 0), list.options.filter((spell) => (spell.level ?? 0) === 0));
  top("spell", survey.printedPrepared + (survey.extraPickBudgets.get("class-spells") ?? 0),
    list.options.filter((spell) => (spell.level ?? 0) >= 1 && (spell.level ?? 0) <= list.maxSlotLevel));
  return rows;
}

/**
 * ONE class bundle and ONE background bundle, drawn from the options that actually hand over GEAR.
 *
 * Every SRD class prints a "just take the gold" alternative (`fighter-c` is 155gp and nothing else),
 * and a character who took it owns no weapon, no armour and no focus - a sheet with nothing to do on
 * its turn, which is precisely the failure this generator has to not produce. The draw is still a
 * draw; it just runs over the bundles that leave the table with a playable character on it.
 */
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

// ---------------------------------------------------------------------------------------------
// The generator.
// ---------------------------------------------------------------------------------------------

/**
 * A complete `character.create` request, rolled up. Throws `CommandRejectedError` with a sentence a
 * GM can act on when the CONTENT cannot produce one (a class with no subclass authored at the level
 * that needs it, a pick with no legal answer).
 */
export function generateCharacterRequest(
  input: GenerateCharacterInput, library: ContentView, policy: BuilderPolicy, random: DiceRandom
): GeneratedCharacter {
  if (!policy.allowedAbilityMethods.includes(GENERATOR_ABILITY_METHOD)) {
    reject("The generator sets ability scores with the standard array, which this table does not allow - enable it in Settings first.");
  }
  const classId = input.classId ?? drawOne(sortedIds(library.classSummaries().map((entry) => entry.id)), random);
  const classRecord = library.classRecord(classId) ?? reject(`No class "${classId}" is in the content catalog.`);
  const speciesId = drawOne(sortedIds(library.speciesSummaries().map((entry) => entry.id)), random);
  const species = library.speciesRecord(speciesId)!;
  const backgroundId = drawOne(sortedIds(library.backgroundSummaries().map((entry) => entry.id)), random);
  const background = library.backgroundRecord(backgroundId)!;

  let subclassId: string | undefined;
  if (input.level >= classRecord.subclassLevel) {
    const available = sortedIds(library.subclassSummaries().filter((entry) => entry.classId === classId).map((entry) => entry.id));
    if (available.length === 0) reject(`No ${classRecord.name} ${classRecord.subclassLabel ?? "subclass"} is in the content catalog, and a level-${input.level} ${classRecord.name} needs one.`);
    subclassId = drawOne(available, random);
  }

  // Hit points are ROLLED, through the same `random`. `hitPointRollRows` writes them into the
  // ledger, which is what makes a generated character re-buildable from its own record (D14).
  const faces = hitDieFaces(classRecord.hitDie);
  const hitPointRolls = Array.from({ length: Math.max(0, input.level - 1) }, () => random(faces));

  const identity = {
    // Named where the species is known, so a generated Dwarf reads like a Dwarf. The bundle is the
    // same one the wizard's suggestion row draws from - through `random`, not `Math.random`.
    name: input.name?.trim() || generateName(speciesId, library, random) || `${species.name} ${classRecord.name}`,
    speciesId, backgroundId, classId, level: input.level,
    ...(subclassId ? { subclassId } : {}),
    abilityMethod: GENERATOR_ABILITY_METHOD,
    baseScores: standardArrayFor(classId, library),
    backgroundBonusAllocation: backgroundAllocationFor(classId, library, background.abilityOptions),
    hp: { mode: "entries" as const, entries: hitPointRolls }
  };

  const choices: CharacterChoice[] = [];
  // The subclass row mirrors the top-level id, exactly as the wizard writes it.
  if (subclassId) choices.push({ level: classRecord.subclassLevel, classId, kind: "subclass", id: subclassId });
  // A species that prints more than one size asks which; the server has no offer for it (step 11
  // reads the row directly), so it is drawn here rather than in the loop.
  if (species.sizes.length > 1) choices.push({ level: 1, kind: "size", id: drawOne([...species.sizes], random) });
  choices.push(...equipmentRows(computeServerOffers({ ...identity, choices }, library, policy), random));

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const survey = computeServerOffers({ ...identity, choices }, library, policy);
    // The printed spell columns first: a budget can only grow as options are chosen, so topping up
    // early costs nothing and a `fromPicks` offer ("one of your known cantrips") needs them present.
    const spells = fillSpellBudgets(survey, choices, random);
    if (spells.length > 0) { choices.push(...spells); continue; }
    const open = survey.offers.find((offer) =>
      offer.unresolvable === null && offer.kind !== "subclass" && offer.taken.length < offer.capacity);
    if (!open) {
      return { request: { ...identity, choices }, hitPointRolls, hitDieFaces: faces, summary: summaryOf(survey) };
    }
    const rows = answerOffer(open, survey, choices, { ...input, classId }, library, random);
    if (rows.length === 0) {
      reject(`"${open.label}" asks for ${open.capacity} "${open.kind}" pick(s) and the generator found no legal option for it - that is a gap in the content, not in the request.`);
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

/** A name from the species' own name bundle, or null when the content has none. Drawn like everything else. */
export function generateName(speciesId: string, library: ContentView, random: DiceRandom): string | null {
  const bundle = library.nameBundles().find((entry) => entry.speciesId === speciesId);
  if (!bundle) return null;
  const family = /-(family|clan)$/;
  const surnames = bundle.pools.filter((pool) => family.test(pool.id)).flatMap((pool) => pool.names);
  const givens = bundle.pools.filter((pool) => !family.test(pool.id)).flatMap((pool) => pool.names);
  if (givens.length === 0) return null;
  const given = drawOne([...givens].sort(), random);
  return surnames.length > 0 ? `${given} ${drawOne([...surnames].sort(), random)}` : given;
}
