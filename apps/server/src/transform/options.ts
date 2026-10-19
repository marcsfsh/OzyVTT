import type { Actor, ContentMonsterSummary } from "@vtt/domain";
import type { ActorAction, ActorDefinition, Form, PrintedForm, ShapeShift } from "@vtt/schemas";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { STATBLOCK_EXTENSION, statblockFacts } from "../statblock-facts.js";
import { SIZES, trueDefinitionIdOf, type CreatureSize } from "./forms.js";

/** One form a shape-shift may take, as the sheet lists it. */
export type FormOption = Readonly<{
  id: string;
  name: string;
  challengeRating: number | null;
  size: string;
  fly: boolean;
}>;

/** SRD 5.2.1 Druid, Beast Shapes: known forms, their highest Challenge Rating and whether one may fly, by Druid level. */
const BEAST_SHAPES: ReadonlyArray<Readonly<{ level: number; known: number; maxChallenge: number; fly: boolean }>> = [
  { level: 2, known: 4, maxChallenge: 0.25, fly: false },
  { level: 4, known: 6, maxChallenge: 0.5, fly: false },
  { level: 8, known: 8, maxChallenge: 1, fly: true }
];

/** The Druid's level in a sheet, 0 for none. */
export function classLevelOf(definition: ActorDefinition | undefined, classId: string): number {
  return (definition?.character?.classes ?? []).find((entry) => entry.id === classId)?.level ?? 0;
}

/** What a Druid of this level may know for Wild Shape; null below level 2. */
export function beastShapesAt(druidLevel: number): (typeof BEAST_SHAPES)[number] | null {
  return [...BEAST_SHAPES].reverse().find((row) => druidLevel >= row.level) ?? null;
}

/** Whether a stat block prints a Fly Speed. */
export function fliesIn(definition: ActorDefinition | undefined): boolean {
  const bag = (definition?.extensions ?? {})[STATBLOCK_EXTENSION];
  const speeds = bag && typeof bag === "object" ? (bag as { speeds?: { fly?: unknown } }).speeds : undefined;
  return typeof speeds?.fly === "number" && speeds.fly > 0;
}

/** A creature's Challenge Rating, or its level when it has none ("the target's level if it doesn't have a Challenge
 *  Rating"). */
export function challengeOrLevel(definition: ActorDefinition | undefined): number {
  const levels = (definition?.character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0);
  if (levels > 0) return levels;
  return definition ? (statblockFacts(definition).challengeRating ?? 0) : 0;
}

const sizeRank = (size: string | undefined) => SIZES.indexOf((size ?? "medium") as CreatureSize);

/** "beast" as the rules name it: "Beast". */
const titled = (word: string) => (word.length > 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word);
const withArticle = (phrase: string) => `${/^[AEIOU]/.test(phrase) ? "an" : "a"} ${phrase}`;

/** "CR 1/4", "CR 2". */
export function challengeLabel(challenge: number | null): string {
  if (challenge === null) return "CR none";
  if (challenge === 0.125) return "CR 1/8";
  if (challenge === 0.25) return "CR 1/4";
  if (challenge === 0.5) return "CR 1/2";
  return `CR ${challenge}`;
}

const optionOf = (summary: ContentMonsterSummary, catalog: EquipmentCatalog | undefined): FormOption => ({
  id: summary.id,
  name: summary.name,
  challengeRating: summary.challengeRating,
  size: summary.size,
  fly: fliesIn(catalog?.monster?.(summary.id))
});

/** Whether a bestiary row passes a shape-shift's own limits (type, Challenge Rating, size, flight). */
function withinLimits(
  shift: ShapeShift,
  summary: Pick<ContentMonsterSummary, "type" | "challengeRating" | "size">,
  flies: boolean,
  challengeCap: number | null
): string | null {
  const type = summary.type.toLowerCase();
  if (shift.creatureTypes && !shift.creatureTypes.includes(type))
    return `isn't ${withArticle(shift.creatureTypes.map(titled).join(" or "))}`;
  if (shift.notCreatureTypes?.includes(type)) return `is ${withArticle(titled(type))}`;
  const cap = Math.min(shift.maxChallenge ?? Infinity, challengeCap ?? Infinity);
  if (summary.challengeRating > cap) return `has a Challenge Rating over ${challengeLabel(cap).slice(3)}`;
  if (shift.maxSize && sizeRank(summary.size) > sizeRank(shift.maxSize))
    return `is larger than ${titled(shift.maxSize)}`;
  if (shift.noFly && flies) return "has a Fly Speed";
  return null;
}

/** Wild Shape's limits at the user's Druid level, laid over the action's own. */
function knownFormLimits(shift: ShapeShift, user: ActorDefinition | undefined): ShapeShift {
  const row = beastShapesAt(classLevelOf(user, "druid"));
  if (!row) return { ...shift, maxChallenge: -1 };
  return {
    ...shift,
    maxChallenge: Math.min(shift.maxChallenge ?? Infinity, row.maxChallenge),
    ...(row.fly ? {} : { noFly: true })
  };
}

/** The bestiary's Beasts a Druid may learn for Wild Shape at its level (SRD Known Forms). */
export function learnableForms(user: ActorDefinition | undefined, catalog: EquipmentCatalog | undefined): FormOption[] {
  const limits = knownFormLimits({ from: "known", creatureTypes: ["beast"], keeps: [], gear: "worn" }, user);
  return (catalog?.monsterSummaries?.() ?? [])
    .filter((summary) => summary.source === "srd")
    .filter((summary) => withinLimits(limits, summary, fliesIn(catalog?.monster?.(summary.id)), null) === null)
    .map((summary) => optionOf(summary, catalog))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The forms an action may take now, for the sheet to offer: the user's known forms (Wild Shape), the bestiary's rows
 * within its limits (Polymorph's Beasts, at most the user's level or Challenge Rating for Shapechange), or the stat
 * block's printed forms with its true form. A limit that turns on the target (Polymorph: the target's Challenge
 * Rating) is checked when the target is named.
 */
export function formOptions(
  actor: Actor,
  action: ActorAction,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): FormOption[] {
  const shift = action.shapeShift;
  if (!shift) return [];
  // A creature in a form reads its form's sheet; the limits are its own.
  const trueId = trueDefinitionIdOf(actor);
  const own = (trueId && resolveDefinition?.(trueId)) || definition;
  if (shift.from === "printed") {
    const size = own?.size ?? "medium";
    return [
      // A stat block's Shape-Shift returns to its true form too; a single form (Gaseous Form) ends as its effect ends.
      ...(singlePrintedForm(shift)
        ? []
        : [{ id: "true", name: "True form", challengeRating: null, size, fly: fliesIn(own) }]),
      ...(shift.printed ?? []).map((printed) => ({
        id: printed.id,
        name: printed.name,
        challengeRating: null,
        size: printed.size ?? size,
        fly: (printed.speeds?.fly ?? 0) > 0
      }))
    ];
  }
  if (shift.from === "known") {
    const known = actor.knownForms?.ids ?? [];
    return known.flatMap((id) => {
      const summary = catalog?.monsterSummaries?.().find((row) => row.id === id);
      return summary ? [optionOf(summary, catalog)] : [];
    });
  }
  const cap = shift.challengeOf === "user" ? challengeOrLevel(own) : null;
  return (catalog?.monsterSummaries?.() ?? [])
    .filter((summary) => summary.source === "srd")
    .filter((summary) => withinLimits(shift, summary, fliesIn(catalog?.monster?.(summary.id)), cap) === null)
    .map((summary) => optionOf(summary, catalog))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** The one form a shape-shift prints, when it prints only one (Gaseous Form, a Potion of Gaseous Form). */
const singlePrintedForm = (shift: ShapeShift): PrintedForm | undefined =>
  shift.from === "printed" && shift.printed?.length === 1 ? shift.printed[0] : undefined;

/** The form a choice names, checked against what the action allows: what the effect should record and, for a stat
 *  block, which one. `true` (a printed form's user returning) is null. */
export function formChoice(
  shift: ShapeShift,
  choice: string | undefined,
  context: Readonly<{
    user: Actor;
    userDefinition: ActorDefinition | undefined;
    target: Actor;
    targetDefinition: ActorDefinition | undefined;
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    catalog: EquipmentCatalog | undefined;
    actionName: string;
  }>
): Readonly<{ name: string; statBlockId?: string; printed?: PrintedForm }> | null {
  // One printed form is the one it gives (Gaseous Form's misty cloud).
  const only = singlePrintedForm(shift);
  if (only && (choice === undefined || choice === only.id)) return { name: only.name, printed: only };
  if (choice === undefined) throw new CommandRejectedError(`Choose a form for ${context.actionName}.`);
  if (shift.from === "printed") {
    if (choice === "true" && !only) return null;
    const printed = (shift.printed ?? []).find((entry) => entry.id === choice);
    if (!printed) throw new CommandRejectedError(`${context.actionName} has no ${choice} form.`);
    return { name: printed.name, printed };
  }
  const statBlock = context.resolveDefinition(choice);
  const summary = context.catalog?.monsterSummaries?.().find((row) => row.id === choice);
  if (!statBlock) throw new CommandRejectedError("That form isn't in the bestiary.");
  const facts = statblockFacts(statBlock);
  const row = {
    type: summary?.type ?? facts.creatureType ?? "",
    challengeRating: summary?.challengeRating ?? facts.challengeRating ?? 0,
    size: statBlock.size
  };
  let limits = shift;
  if (shift.from === "known") {
    if (!(context.user.knownForms?.ids ?? []).includes(choice))
      throw new CommandRejectedError(`${statBlock.name} isn't one of ${context.user.name}'s known forms.`);
    limits = knownFormLimits(shift, context.userDefinition);
  }
  const cap =
    shift.challengeOf === "target"
      ? challengeOrLevel(context.targetDefinition)
      : shift.challengeOf === "user"
        ? challengeOrLevel(context.userDefinition)
        : null;
  const why = withinLimits(limits, row, fliesIn(statBlock), cap);
  if (why !== null)
    throw new CommandRejectedError(`${statBlock.name} ${why}, so ${context.actionName} can't take that form.`);
  return { name: statBlock.name, statBlockId: choice };
}

/** The form record a shape-shift gives, from the choice and the action's own terms. */
export function formRecord(
  shift: ShapeShift,
  chosen: NonNullable<ReturnType<typeof formChoice>>,
  extras: Readonly<{ gear?: "merged" | "worn"; temporaryHitPoints?: number; beastSpells?: boolean; name?: string }>
): Form {
  const printed = chosen.printed;
  const gear = shift.gear === "choice" ? (extras.gear ?? "merged") : shift.gear;
  return {
    name: extras.name ?? chosen.name,
    ...(chosen.statBlockId !== undefined ? { statBlockId: chosen.statBlockId } : {}),
    ...(printed ? { printedId: printed.id } : {}),
    keeps: [...shift.keeps],
    ...(printed?.size ? { size: printed.size } : {}),
    ...(printed?.speeds ? { speeds: { ...printed.speeds } } : {}),
    gear,
    ...(shift.noSpells ? { noSpells: true as const } : {}),
    ...(extras.beastSpells ? { beastSpells: true as const } : {}),
    ...(shift.noSpeech || printed?.noSpeech ? { noSpeech: true as const } : {}),
    ...(printed?.noActions ? { noActions: true as const } : {}),
    ...(printed?.allowsActions ? { allowsActions: [...printed.allowsActions] } : {}),
    ...(printed?.noAttacks ? { noAttacks: true as const } : {}),
    ...(printed?.sharesSpaces ? { sharesSpaces: true as const } : {}),
    ...(shift.endsWithoutTemporaryHitPoints ? { endsWithoutTemporaryHitPoints: true as const } : {}),
    ...(shift.endsOnIncapacitated ? { endsOnIncapacitated: true as const } : {}),
    ...(shift.endsAtZeroHitPoints ? { endsAtZeroHitPoints: true as const } : {}),
    ...(shift.revertRounds !== undefined ? { revertRounds: shift.revertRounds } : {}),
    ...(extras.temporaryHitPoints !== undefined && extras.temporaryHitPoints > 0
      ? { temporaryHitPoints: Math.min(1000, extras.temporaryHitPoints) }
      : {}),
    ...(shift.leaveAs ? { leaveAs: shift.leaveAs } : {})
  };
}
