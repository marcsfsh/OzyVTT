import { BuilderPolicySchema } from "@vtt/domain";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { ABILITIES, isPointBuyLegal, STANDARD_ARRAY, type Ability } from "@vtt/rules-5e";
import { buildCharacterDefinition, storedAbilityScores, type CharacterCreateRequestInput } from "./character-build.js";
import { CLASS_LEVELS_KIND, storedClassSequence, surveyForBuild } from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * How a sheet's ability scores were made, for a rebuild: the ledger's own record, or, for a sheet built before the
 * ledger kept one, the base scores and background increase that rebuild its totals exactly. The rebuild re-sends these
 * as the scores the sheet already had, so a level-up neither re-rolls them nor counts a bonus twice.
 */

export type SheetAbilities = Pick<
  CharacterCreateRequestInput,
  "abilityMethod" | "baseScores" | "backgroundBonusAllocation"
> &
  Readonly<{ derived: boolean }>;

/** The parts of a stored sheet the scores are read from. */
export type SheetSource = Readonly<{
  speciesId: string;
  backgroundId: string;
  classId: string;
  level: number;
  abilityScores: Readonly<Record<Ability, number>>;
  choices: readonly CharacterChoice[];
}>;

/** A built sheet as a `SheetSource`, or null when it lacks the identity a build needs. */
export function sheetSourceOf(definition: ActorDefinition | undefined): SheetSource | null {
  const character = definition?.character;
  const starting = character?.classes[0];
  if (!definition || !character?.race || !character.background || !starting || !character.choices) return null;
  return {
    speciesId: character.race.id,
    backgroundId: character.background.id,
    classId: starting.id,
    level: character.classes.reduce((total, entry) => total + entry.level, 0),
    abilityScores: definition.abilityScores,
    choices: character.choices
  };
}

/** The rows a build writes for itself, which a rebuild's input never carries. */
const WRITTEN_BY_THE_BUILD = new Set(["ability-scores", "hp-roll", CLASS_LEVELS_KIND]);

// Policy-free: a sheet's scores are its own whatever the table allows today.
const ANY_METHOD = BuilderPolicySchema.parse({});

/** The recorded or derived scores, or null when no base and background increase reproduce the sheet. */
export function sheetAbilityScores(sheet: SheetSource, library: ContentView): SheetAbilities | null {
  const recorded = storedAbilityScores(sheet.choices);
  if (recorded) return { ...recorded, derived: false };
  const background = library.backgroundRecord(sheet.backgroundId);
  if (!background) return null;
  const sequence = storedClassSequence(sheet.choices);
  if (sequence && sequence.length !== sheet.level) return null;
  const subclassId = sheet.choices.find(
    (row) => row.kind === "subclass" && (row.classId ?? sheet.classId) === sheet.classId
  )?.id;
  const input = (
    scores: Pick<CharacterCreateRequestInput, "abilityMethod" | "baseScores" | "backgroundBonusAllocation">
  ) =>
    ({
      name: "Sheet",
      speciesId: sheet.speciesId,
      backgroundId: sheet.backgroundId,
      classId: sheet.classId,
      level: sheet.level,
      ...(subclassId ? { subclassId } : {}),
      ...(sequence ? { classLevels: sequence } : {}),
      hp: { mode: "average" },
      choices: sheet.choices.filter((row) => !WRITTEN_BY_THE_BUILD.has(row.kind)),
      keepsRecordedScores: true,
      ...scores
    }) satisfies CharacterCreateRequestInput;

  const allocations = allocationsOf(background.abilityOptions);
  let increases: Record<Ability, number>;
  try {
    increases = increasesOf(
      input({ abilityMethod: "roll", baseScores: evenScores(10), backgroundBonusAllocation: allocations[0] }),
      library
    );
  } catch (error) {
    if (error instanceof CommandRejectedError) return null;
    throw error;
  }

  const candidates = allocations.flatMap((allocation) => {
    const base = Object.fromEntries(
      ABILITIES.map((ability) => [
        ability,
        sheet.abilityScores[ability] -
          increases[ability] -
          allocation.reduce((total, entry) => total + (entry.ability === ability ? entry.amount : 0), 0)
      ])
    ) as Record<Ability, number>;
    const method = methodFor(ABILITIES.map((ability) => base[ability]));
    return method ? [{ abilityMethod: method, baseScores: base, backgroundBonusAllocation: allocation }] : [];
  });
  // The likeliest method first: an exact standard array, then a point-buy spread, then rolled values.
  const rank = (method: CharacterCreateRequestInput["abilityMethod"]) => METHOD_ORDER.indexOf(method);
  candidates.sort((left, right) => rank(left.abilityMethod) - rank(right.abilityMethod));
  for (const candidate of candidates) {
    try {
      const rebuilt = buildCharacterDefinition(input(candidate), library, ANY_METHOD);
      if (ABILITIES.every((ability) => rebuilt.abilityScores[ability] === sheet.abilityScores[ability]))
        return { ...candidate, derived: true };
    } catch (error) {
      if (!(error instanceof CommandRejectedError)) throw error;
    }
  }
  return null;
}

/** Whether a rebuild sends the scores this sheet already has, recorded or derived, in any order under their method. */
export function sendsSheetScores(
  request: Pick<CharacterCreateRequestInput, "abilityMethod" | "baseScores">,
  sheet: SheetAbilities | null
): boolean {
  const sorted = (scores: Readonly<Record<Ability, number>>) =>
    ABILITIES.map((ability) => scores[ability])
      .sort((left, right) => left - right)
      .join(",");
  return (
    sheet !== null &&
    sheet.abilityMethod === request.abilityMethod &&
    sorted(sheet.baseScores) === sorted(request.baseScores)
  );
}

const METHOD_ORDER: readonly CharacterCreateRequestInput["abilityMethod"][] = ["standard-array", "point-buy", "roll"];

/** The method these base values could have come from, or null when none could have made them. */
function methodFor(values: readonly number[]): CharacterCreateRequestInput["abilityMethod"] | null {
  if ([...values].sort((left, right) => right - left).join(",") === STANDARD_ARRAY.join(",")) return "standard-array";
  if (isPointBuyLegal(values)) return "point-buy";
  if (values.every((value) => Number.isInteger(value) && value >= 3 && value <= 18)) return "roll";
  return null;
}

const evenScores = (value: number) =>
  Object.fromEntries(ABILITIES.map((ability) => [ability, value])) as Record<Ability, number>;

/** What the build adds to the base scores besides the background: species increases, improvements, feat picks and
 *  feature riders (Primal Champion's +4). */
function increasesOf(input: CharacterCreateRequestInput, library: ContentView): Record<Ability, number> {
  const survey = surveyForBuild(input, library, ANY_METHOD);
  const increases = evenScores(0);
  for (const bonus of survey.species.abilityBonuses) increases[bonus.ability] += bonus.amount;
  for (const row of input.choices) {
    if (row.kind !== "asi-or-feat" || row.id !== "asi") continue;
    const listed = (row.payload as { increases?: unknown } | undefined)?.increases;
    for (const entry of Array.isArray(listed) ? listed : []) {
      const { ability, amount } = entry as { ability?: unknown; amount?: unknown };
      if (ABILITIES.includes(ability as Ability) && typeof amount === "number") increases[ability as Ability] += amount;
    }
  }
  for (const offer of survey.offers) {
    if (offer.kind !== "ability-score") continue;
    for (const taken of offer.taken) if (ABILITIES.includes(taken as Ability)) increases[taken as Ability] += 1;
  }
  for (const { record } of survey.granted)
    for (const modifier of record.modifiers)
      if (modifier.type === "ability-score") increases[modifier.ability] += modifier.amount;
  return increases;
}

/** Every legal background increase: each printed spread over each ordering of the abilities it may raise. */
function allocationsOf(
  options: { from: readonly Ability[]; spreads: ReadonlyArray<readonly number[]> } | undefined
): Array<Array<{ ability: Ability; amount: number }>> {
  if (!options) return [[]];
  const orderings = (abilities: readonly Ability[]): Ability[][] =>
    abilities.length <= 1
      ? [[...abilities]]
      : abilities.flatMap((first, index) =>
          orderings(abilities.filter((_, at) => at !== index)).map((rest) => [first, ...rest])
        );
  const seen = new Set<string>();
  const allocations: Array<Array<{ ability: Ability; amount: number }>> = [];
  for (const spread of options.spreads)
    for (const abilities of orderings(options.from)) {
      const allocation = [...spread]
        .sort((left, right) => right - left)
        .map((amount, index) => ({ ability: abilities[index], amount }))
        .filter((entry) => entry.ability !== undefined);
      const key = allocation
        .map((entry) => `${entry.ability}${entry.amount}`)
        .sort()
        .join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      allocations.push(allocation);
    }
  return allocations;
}
