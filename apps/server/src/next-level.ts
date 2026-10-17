import type { BuilderPolicy, NextLevelReply } from "@vtt/domain";
import { abilityModifier, hitDieAverage, proficiencyBonusForLevel, type HitDie } from "@vtt/rules-5e";
import type { Actor, ActorDefinition } from "@vtt/schemas";
import { builderOffers, subclassesInLedger } from "./builder-offers.js";
import { spellSlotsOf, surveyDraft, type DraftSurvey } from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import { CommandRejectedError } from "./game-store.js";
import { buildRequestOf } from "./ledger-rechoice.js";
import { BOOK_PER_LEVEL } from "./spell-choices.js";

/**
 * What a character's next level brings, for the sheet's Level box and the end of its Features tab: read from the
 * builder's own survey at the next level, against the character's choices ledger, so it says what the Level page
 * will ask for and grant. The level goes to the class the Level page offers first, the class of the last level taken.
 * The survey is the wizard's, which takes a level whose picks (a subclass, an Ability Score Improvement) are still open.
 */

type Survey = Pick<DraftSurvey, "classes" | "granted" | "classSpells">;

const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const countWord = (count: number) => COUNT_WORDS[count] ?? String(count);
const ordinal = (count: number) => ORDINALS[count] ?? `${count}th`;

/** "A level 3 spell slot", "A second level 5 spell slot", "Two more level 2 spell slots". */
function slotLines(before: Survey, after: Survey): string[] {
  const was = spellSlotsOf(before.classes);
  const now = spellSlotsOf(after.classes);
  const lines = now.slots.flatMap(({ level, max }) => {
    const had = was.slots.find((slot) => slot.level === level)?.max ?? 0;
    const gained = max - had;
    if (gained <= 0) return [];
    if (had === 0)
      return [gained === 1 ? `A level ${level} spell slot` : `${countWord(gained)} level ${level} spell slots`];
    return [
      gained === 1
        ? `A ${ordinal(max)} level ${level} spell slot`
        : `${countWord(gained)} more level ${level} spell slots`
    ];
  });
  if (now.pact && (!was.pact || now.pact.level > was.pact.level))
    lines.push(
      was.pact ? `Pact Magic slots rise to level ${now.pact.level}` : `A level ${now.pact.level} Pact Magic slot`
    );
  if (now.pact && was.pact && now.pact.max > was.pact.max)
    lines.push(
      now.pact.max - was.pact.max === 1
        ? `A ${ordinal(now.pact.max)} Pact Magic slot`
        : `${countWord(now.pact.max - was.pact.max)} more Pact Magic slots`
    );
  return lines;
}

/** "One more prepared spell (15)" and "One more cantrip (5)". A multiclass sheet names the class. */
function spellCountLines(before: Survey, after: Survey): string[] {
  const named = after.classSpells.length > 1;
  return after.classSpells.flatMap((budget) => {
    const was = before.classSpells.find((entry) => entry.classId === budget.classId);
    const lines: string[] = [];
    const prepared = budget.prepared - (was?.prepared ?? 0);
    if (prepared > 0) {
      const spells = `${named ? `${budget.className} ` : ""}spell${prepared === 1 ? "" : "s"}`;
      lines.push(
        budget.casting.prepares === "known"
          ? `${countWord(prepared)} more ${spells} known (${budget.prepared})`
          : `${countWord(prepared)} more prepared ${spells} (${budget.prepared})`
      );
    }
    const cantrips = budget.cantrips - (was?.cantrips ?? 0);
    if (cantrips > 0)
      lines.push(
        `${countWord(cantrips)} more ${named ? `${budget.className} ` : ""}cantrip${cantrips === 1 ? "" : "s"} (${budget.cantrips})`
      );
    return lines;
  });
}

/** The features the level grants, by name: a new one, or one granted again (a second Ability Score Improvement). */
function gainedFeatures(before: Survey, after: Survey) {
  const key = (entry: Survey["granted"][number]) => `${entry.classId ?? ""}:${entry.record.id}`;
  const had = new Map(before.granted.map((entry) => [key(entry), entry.count]));
  return after.granted.filter((entry) => entry.count > (had.get(key(entry)) ?? 0)).map((entry) => entry.record);
}

/** "Hit Points: 1d6 + 3, or the average of 7", with today's Constitution and the per-level riders the class carries. */
function hitPointLine(hitDie: HitDie, definition: ActorDefinition, after: Survey, classId: string): string {
  // A class's own feature counts that class's levels (Draconic Resilience); a species trait or a feat every level.
  const perLevel = after.granted
    .filter((entry) => entry.classId === null || entry.classId === classId)
    .flatMap((entry) => entry.record.modifiers ?? [])
    .reduce((sum, modifier) => (modifier.type === "hit-points-per-level" ? sum + modifier.amount : sum), 0);
  const constitution = abilityModifier(definition.abilityScores.con);
  const bonus = constitution + perLevel;
  const dice = `1${hitDie}${bonus === 0 ? "" : ` ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`}`;
  const average = Math.max(1, hitDieAverage(hitDie) + constitution) + perLevel;
  return `Hit Points: ${dice}, or the average of ${average}`;
}

/** What the character's next level brings, or a refusal saying why it has none here. */
export function nextLevelOf(
  actor: Pick<Actor, "name">,
  definition: ActorDefinition | undefined,
  library: ContentView,
  policy: Pick<BuilderPolicy, "maxLevel">
): NextLevelReply {
  const notBuiltHere = () =>
    new CommandRejectedError(`${actor.name} wasn't built here, so the Level page can't read the next level.`);
  const request = definition ? buildRequestOf(definition, library) : null;
  if (!definition || !request) throw notBuiltHere();
  // A multiclass sheet that doesn't record which level went to which class can't be levelled a step at a time.
  if ((definition.character?.classes.length ?? 0) > 1 && !request.classLevels) throw notBuiltHere();
  const cap = Math.min(policy.maxLevel, 20);
  if (request.level >= cap) throw new CommandRejectedError(`This table builds characters up to level ${cap}.`);

  const sequence = request.classLevels ?? Array.from({ length: request.level }, () => request.classId);
  const classId = sequence[sequence.length - 1];
  const next = [...sequence, classId];
  const level = request.level + 1;
  const classLevels = new Set(next).size > 1 ? { classLevels: next } : {};
  const offers = builderOffers(
    {
      speciesId: request.speciesId,
      backgroundId: request.backgroundId,
      classId: request.classId,
      level,
      ...classLevels,
      choices: request.choices
    },
    library
  );
  const subclasses = subclassesInLedger(request.choices, request.classId);
  const subclassId = request.subclassId ?? subclasses.subclassId;
  const identity = {
    speciesId: request.speciesId,
    backgroundId: request.backgroundId,
    classId: request.classId,
    subclassIds: subclasses.subclassIds,
    ...(subclassId ? { subclassId } : {})
  };
  const before = surveyDraft(
    {
      ...identity,
      level: request.level,
      ...(request.classLevels ? { classLevels: request.classLevels } : {}),
      choices: request.choices
    },
    library
  );
  const after = surveyDraft({ ...identity, level, ...classLevels, choices: offers.choices }, library);
  const classRecord = after.classes.find((entry) => entry.record.id === classId)!;

  const features = gainedFeatures(before, after);
  const named = new Set(features.map((feature) => feature.id));
  // What the level asks the player to choose that no feature line already names (a later class's spell picks).
  const choices = offers.offers.filter(
    (offer) =>
      offer.level === level &&
      (offer.featureId === null || !named.has(offer.featureId)) &&
      (offers.picks[offer.key]?.length ?? 0) < offer.capacity
  );
  const lines = [
    ...(proficiencyBonusForLevel(level) > proficiencyBonusForLevel(request.level)
      ? [`Proficiency Bonus +${proficiencyBonusForLevel(level)}`]
      : []),
    ...features.map((feature) => feature.name),
    ...choices.map((offer) =>
      offer.capacity === 1 ? `Choose: ${offer.label}` : `Choose ${offer.capacity}: ${offer.label}`
    ),
    ...slotLines(before, after),
    ...spellCountLines(before, after),
    ...(classId === "wizard" ? [`${countWord(BOOK_PER_LEVEL)} Wizard spells for the spellbook`] : []),
    hitPointLine(classRecord.record.hitDie as HitDie, definition, after, classId)
  ];
  return { level, classId, className: classRecord.record.name, classLevel: classRecord.level, lines };
}
