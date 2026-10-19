import type { AbilityId, Actor } from "@vtt/domain";
import {
  abilityModifier,
  aggregateRollMode,
  collectRiders,
  d20TestFormula,
  diceRiders,
  diceRiderTerms,
  keptD20,
  resolveWithD20s,
  type AggregatedRollMode,
  type DiceResolution,
  type RandomSource,
  type ResolvedRider,
  type ThrownDie
} from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import { conditionLabel, exhaustionPenalty } from "./condition-rules.js";
import { RAGING_TAG } from "./effects.js";
import {
  checkRiderBonus,
  effectiveSkillTier,
  rollModeClaims,
  type CheckNarrow,
  type EquipmentDerivation,
  type RollModeClaims
} from "./equipment-derivation.js";

// Ability checks (SRD 5.2.1 "Ability Checks", "Proficiency"): one plan for every check the sheet, the builtin actions,
// the GM's calls for a roll and first aid roll, so their numbers and their Advantage never disagree.

/** The rider-claimed Advantage and Disadvantage for one ability check: every carrier's `roll-mode {roll: "check"}`
 *  riders, standing and `on-ability-check`, narrowed by `ability-is` and `skill-is` (Rage's Strength checks, Boots of
 *  Elvenkind, armor's Stealth). Conditions and the check's own circumstances are added by `checkPlan`. */
export function checkRollMode(derivation: EquipmentDerivation, narrow: CheckNarrow = {}): AggregatedRollMode {
  const claims = checkRiderClaims(derivation, narrow);
  return aggregateRollMode(claims.advantage, claims.disadvantage);
}

function checkRiderClaims(
  derivation: EquipmentDerivation,
  narrow: CheckNarrow,
  stakes: readonly string[] = []
): RollModeClaims {
  return rollModeClaims(derivation, ["check"], "on-ability-check", {
    ...(narrow.ability !== undefined ? { ability: narrow.ability } : {}),
    ...(narrow.skill !== undefined ? { skill: narrow.skill } : {}),
    ...(narrow.situations !== undefined ? { situations: narrow.situations } : {}),
    // The conditions the check would end (escaping a grapple: Grappled), for a `versus-condition` rider.
    ...(stakes.length > 0 ? { targetConditionIds: stakes } : {})
  });
}

/** Conditions that give Disadvantage on every ability check. Frightened applies only while the source of fear is
 *  within line of sight (`CheckSight.frightened`), and whenever active when the caller can't tell. */
const CHECK_DISADVANTAGE_CONDITIONS = ["poisoned", "frightened"] as const;

/** What sight decides about a check, worked out by the caller from the map (`checkSightFor` in `vision/rules.ts`). */
export type CheckSight = Readonly<{
  /** Frightened's Disadvantage applies now: its source is within line of sight, or no one can tell. */
  frightened?: boolean;
  /** Its traits that give its checks Disadvantage where it stands (Sunlight Sensitivity), by name. */
  lightSensitivities?: readonly string[];
  /** How obscured the creature a Perception check is made to find is to the roller, after its senses. */
  findingObscured?: "none" | "light" | "heavy" | null;
  /** The roller perceives that creature with Blindsight, which needs no sight. */
  findingByBlindsight?: boolean;
}>;

/** The Advantage and Disadvantage the rules give `actor`'s ability checks with this ability (and skill): check riders
 *  (`checkRiderClaims`, Hex's ability among them), Poisoned and Frightened, and a trait that dislikes the light it
 *  stands in. Initiative, a Dexterity check, reads it too. */
export function abilityCheckClaims(
  actor: Actor,
  derivation: EquipmentDerivation,
  narrow: CheckNarrow,
  warded: readonly string[] = [],
  stakes: readonly string[] = [],
  sight: CheckSight = {}
): RollModeClaims {
  const claims = checkRiderClaims(derivation, narrow, stakes);
  for (const condition of CHECK_DISADVANTAGE_CONDITIONS)
    if (
      actor.conditions.some((held) => held.id === condition) &&
      !warded.includes(condition) &&
      (condition !== "frightened" || sight.frightened !== false)
    )
      claims.disadvantage.push({ source: `condition-${condition}`, label: conditionLabel(condition) });
  for (const name of sight.lightSensitivities ?? [])
    claims.disadvantage.push({ source: "light-sensitivity", label: `${name} (in the light)` });
  return claims;
}

export const ABILITY_NAMES: Readonly<Record<AbilityId, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

/** What a check is made with: the ability, and a skill or a tool (or a tool with the skill it uses) when one applies. */
export type CheckSubject = Readonly<{ ability: AbilityId; skill?: string; tool?: string }>;

/** The tag on a Hunter's Mark effect, which gives its caster Advantage on checks to find the marked creature. */
const HUNTERS_MARK_TAG = "hunters-mark";

/** A creature's printed skill total (the stat block's Skills line), when its sheet keeps one. */
export function statBlockSkill(definition: ActorDefinition | undefined, skill: string): number | null {
  const extension = definition?.extensions["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const bonus = (extension as { skills?: Record<string, unknown> }).skills?.[skill];
    if (typeof bonus === "number" && Number.isInteger(bonus) && bonus >= -20 && bonus <= 30) return bonus;
  }
  return null;
}

/** The SRD tool entry's ability ("Ability: Dexterity."), or null when it names none. */
export function toolAbility(description: string | null | undefined): AbilityId | null {
  const named = /Ability:\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/i.exec(description ?? "");
  if (!named) return null;
  const word = named[1].toLowerCase();
  return (Object.keys(ABILITY_NAMES) as AbilityId[]).find((ability) => ABILITY_NAMES[ability].toLowerCase() === word)!;
}

/** Tool proficiencies the sheet records and its items grant. */
export function toolProficiencies(definition: ActorDefinition | undefined, derivation: EquipmentDerivation): string[] {
  return [...new Set([...(definition?.proficiencies?.tools ?? []), ...(derivation.context.proficientTools ?? [])])];
}

/** Display names for a check's label; ids are title-cased when a name is unknown. */
export type CheckNames = Readonly<{
  skill?: (id: string) => string | undefined;
  tool?: (id: string) => string | undefined;
}>;

const titled = (id: string) =>
  id
    .split("-")
    .map((word, index) =>
      index > 0 && (word === "of" || word === "and") ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`
    )
    .join(" ");

/** "Dexterity (Stealth)", "Strength check", "Thieves' Tools (Dexterity)", "Dexterity (Sleight of Hand) with Thieves' Tools". */
export function checkLabel(subject: CheckSubject, names: CheckNames = {}): string {
  const ability = ABILITY_NAMES[subject.ability];
  const skill = subject.skill ? (names.skill?.(subject.skill) ?? titled(subject.skill)) : null;
  const tool = subject.tool ? (names.tool?.(subject.tool) ?? titled(subject.tool)) : null;
  if (skill && tool) return `${ability} (${skill}) with ${tool}`;
  if (skill) return `${ability} (${skill})`;
  if (tool) return `${tool} (${ability})`;
  return `${ability} check`;
}

/** Everything one ability check adds to its d20, and how it is rolled. */
export type CheckPlan = Readonly<{
  subject: CheckSubject;
  label: string;
  /** Every flat term: the ability, proficiency (or Jack of All Trades), a printed skill total, check riders, Exhaustion. */
  modifier: number;
  /** Exhaustion's share of `modifier` (-2 per level), which reduces the roll of a D20 Test. */
  exhaustion: number;
  /** The rules' count of Advantage and Disadvantage, with what grants each side. */
  rollMode: AggregatedRollMode;
  /** The check uses one of the creature's skill or tool proficiencies. */
  proficient: boolean;
  /** Reliable Talent: a d20 of 9 or lower counts as 10 (only on a check that uses a proficiency). */
  reliableTalent: boolean;
  /** Dice effects add to the check (" + 1d4"), as formula terms. */
  diceTerms: string;
  /** A d20 that shows less counts as this (Glibness's 15), and what says so; null when nothing raises it. Reliable
   *  Talent's 10 is `reliableTalent`. */
  d20Minimum: Readonly<{ face: number; label: string }> | null;
  /** A total that comes out lower counts as this (Indomitable Might's Strength score), and what says so. */
  totalMinimum: Readonly<{ total: number; label: string }> | null;
  /** Why the check fails whatever it rolls: it needs sight the roller hasn't (SRD Blinded: "You automatically fail any
   *  ability check that requires sight"; Heavily Obscured: "You have the Blinded condition while trying to see
   *  something in a Heavily Obscured space"). */
  autoFails?: string;
}>;

export type CheckContext = Readonly<{
  names?: CheckNames;
  /** The creature a Wisdom (Perception or Survival) check is made to find; the roller's Hunter's Mark on it gives
   *  Advantage. */
  finding?: Actor;
  /** Conditions an ally's aura keeps from having any effect where the roller stands (Aura of Courage). */
  warded?: readonly string[];
  /** Conditions the check would end (escaping a grapple: Grappled), which a `versus-condition` rider reads (Powerful
   *  Build). */
  stakes?: readonly string[];
  /** What sight decides about it (Frightened's line of sight, the light, how obscured `finding` is). */
  sight?: CheckSight;
  /** The situations the roller says it fits (a Book's topic, prying with a Crowbar), for `situation-is` riders. */
  situations?: readonly string[];
}>;

/** The flat part of a skill check (SRD Skills, Expertise, Jack of All Trades): a GM-typed total, else the stat block's
 *  printed total, else the ability plus the Proficiency Bonus the skill's tier gives. With a tool, its proficiency
 *  gives the Proficiency Bonus too, but never twice. */
function skillBase(
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  subject: CheckSubject & { skill: string },
  toolProficient: boolean
): { base: number; proficient: boolean } {
  const tier = effectiveSkillTier(definition, derivation, subject.skill);
  const override = definition?.proficiencies?.skillOverrides?.[subject.skill];
  if (typeof override === "number") return { base: override, proficient: tier !== "none" || toolProficient };
  // A monster has no proficiency record; its stat block prints the skills it is proficient in.
  const printed = definition?.proficiencies === undefined ? statBlockSkill(definition, subject.skill) : null;
  if (printed !== null) return { base: printed, proficient: true };
  const modifier = abilityModifier(definition?.abilityScores[subject.ability] ?? 10);
  const proficiencyBonus = definition?.proficiencyBonus ?? 0;
  const multiplier = Math.max(tier === "expertise" ? 2 : tier === "proficient" ? 1 : 0, toolProficient ? 1 : 0);
  // "a skill proficiency you lack and that doesn't otherwise use your Proficiency Bonus".
  const jack =
    multiplier === 0 && holdsFeature(definition, "jack-of-all-trades", "Jack of All Trades")
      ? Math.floor(proficiencyBonus / 2)
      : 0;
  return { base: modifier + proficiencyBonus * multiplier + jack, proficient: multiplier > 0 };
}

/** SRD Primal Knowledge: while raging, a check with one of these skills can be made as a Strength check. */
const PRIMAL_KNOWLEDGE_SKILLS: ReadonlySet<string> = new Set([
  "acrobatics",
  "intimidation",
  "perception",
  "stealth",
  "survival"
]);

/** A plan's worth for picking between two ways to make one check: Advantage counts as +5 and Disadvantage as -5, as
 *  the SRD scores a passive check. */
const planWorth = (plan: CheckPlan) =>
  plan.modifier + (plan.rollMode.mode === "advantage" ? 5 : plan.rollMode.mode === "disadvantage" ? -5 : 0);

/** What one ability check of `actor` adds to its d20 and how it is rolled, as the rules work it out. A raging
 *  Barbarian with Primal Knowledge makes the check as a Strength check when that is the better roll. */
export function checkPlan(
  actor: Actor,
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  subject: CheckSubject,
  context: CheckContext = {}
): CheckPlan {
  const plan = plainCheckPlan(actor, definition, derivation, subject, context);
  if (
    subject.skill === undefined ||
    subject.tool !== undefined ||
    subject.ability === "str" ||
    !PRIMAL_KNOWLEDGE_SKILLS.has(subject.skill) ||
    !actor.effects.some((effect) => effect.tags.includes(RAGING_TAG)) ||
    !holdsFeature(definition, "primal-knowledge", "Primal Knowledge")
  )
    return plan;
  const strength = plainCheckPlan(actor, definition, derivation, { ...subject, ability: "str" }, context);
  return planWorth(strength) > planWorth(plan) ? strength : plan;
}

function plainCheckPlan(
  actor: Actor,
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  subject: CheckSubject,
  context: CheckContext
): CheckPlan {
  const narrow = {
    ability: subject.ability,
    ...(subject.skill !== undefined ? { skill: subject.skill } : {}),
    ...(context.situations !== undefined && context.situations.length > 0 ? { situations: context.situations } : {})
  };
  const toolProficient = subject.tool !== undefined && toolProficiencies(definition, derivation).includes(subject.tool);
  const { base, proficient } =
    subject.skill !== undefined
      ? skillBase(definition, derivation, { ...subject, skill: subject.skill }, toolProficient)
      : {
          base:
            abilityModifier(definition?.abilityScores[subject.ability] ?? 10) +
            (toolProficient ? (definition?.proficiencyBonus ?? 0) : 0),
          proficient: toolProficient
        };
  const claims = abilityCheckClaims(actor, derivation, narrow, context.warded, context.stakes, context.sight);
  // A Wisdom (Perception) check to find a creature relies on sight: Disadvantage when it is Lightly Obscured to the
  // roller, and a failure whatever the roll when the roller is Blinded or it is Heavily Obscured.
  const lookingFor = context.finding !== undefined && subject.ability === "wis" && subject.skill === "perception";
  const sight = context.sight ?? {};
  if (lookingFor && sight.findingObscured === "light" && !sight.findingByBlindsight)
    claims.disadvantage.push({ source: "lightly-obscured", label: `${context.finding!.name} is Lightly Obscured` });
  const blinded = actor.conditions.some((held) => held.id === "blinded");
  const autoFails =
    !lookingFor || sight.findingByBlindsight
      ? undefined
      : blinded
        ? `${actor.name} is Blinded, and finding ${context.finding!.name} takes sight.`
        : sight.findingObscured === "heavy"
          ? `${context.finding!.name} is Heavily Obscured to ${actor.name}.`
          : undefined;
  // SRD Tools: "If you have proficiency in the skill that's also used with that check, you have Advantage".
  if (
    subject.tool !== undefined &&
    subject.skill !== undefined &&
    toolProficient &&
    effectiveSkillTier(definition, derivation, subject.skill) !== "none"
  )
    claims.advantage.push({ source: "tool-and-skill", label: "Skill and tool proficiency" });
  const finding = context.finding;
  if (
    finding &&
    subject.ability === "wis" &&
    (subject.skill === "perception" || subject.skill === "survival") &&
    finding.effects.some((effect) => effect.tags.includes(HUNTERS_MARK_TAG) && effect.sourceActorId === actor.id)
  )
    claims.advantage.push({ source: "hunters-mark", label: `Hunter's Mark (finding ${finding.name})` });
  const standing = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  const atCheck = collectRiders(derivation.carriers, { ...derivation.context, ...narrow, moment: "on-ability-check" });
  const exhaustion = exhaustionPenalty(actor);
  const riders = [...standing, ...atCheck];
  return {
    subject,
    label: `${checkLabel(subject, context.names)}${namedSituations(atCheck)}`,
    modifier: base + checkRiderBonus(derivation, narrow, definition?.abilityScores) + exhaustion,
    exhaustion,
    rollMode: aggregateRollMode(claims.advantage, claims.disadvantage),
    proficient,
    reliableTalent: proficient && holdsFeature(definition, "reliable-talent", "Reliable Talent"),
    diceTerms: diceRiderTerms(diceRiders(riders, "check-bonus")),
    d20Minimum: d20MinimumOf(riders, "check", proficient),
    totalMinimum: totalMinimumOf(riders, "check", definition),
    ...(autoFails !== undefined ? { autoFails } : {})
  };
}

/** The situations that gave this check a rider, as words after its name (", consulting an accurate Book about its
 *  topic"), so the GM sees what the roller claimed. */
function namedSituations(riders: readonly ResolvedRider[]): string {
  const named = new Set<string>();
  for (const rider of riders)
    for (const trigger of rider.modifier.when ?? [])
      if (trigger.type === "situation-is" && trigger.situation !== undefined) named.add(trigger.situation);
  return [...named].map((situation) => `, ${situation}`).join("");
}

/** The highest face a `d20-minimum` rider on this roll raises a lower d20 to, and the carrier that says so; one marked
 *  `proficientOnly` counts only on a check that uses a proficiency. */
export function d20MinimumOf(
  riders: readonly ResolvedRider[],
  roll: "check" | "save",
  proficient: boolean
): CheckPlan["d20Minimum"] {
  let best: CheckPlan["d20Minimum"] = null;
  for (const rider of riders) {
    const { type, roll: riderRoll, minimum, proficientOnly } = rider.modifier;
    if (type !== "d20-minimum" || riderRoll !== roll || minimum === undefined) continue;
    if (proficientOnly && !proficient) continue;
    if (best === null || minimum > best.face) best = { face: minimum, label: rider.label };
  }
  return best;
}

/** The highest ability score a `total-minimum` rider on this roll raises a lower total to, and the carrier. */
export function totalMinimumOf(
  riders: readonly ResolvedRider[],
  roll: "check" | "save",
  definition: ActorDefinition | undefined
): CheckPlan["totalMinimum"] {
  let best: CheckPlan["totalMinimum"] = null;
  for (const rider of riders) {
    const { type, roll: riderRoll, abilityScore } = rider.modifier;
    if (type !== "total-minimum" || riderRoll !== roll || abilityScore === undefined || !definition) continue;
    const score = definition.abilityScores[abilityScore];
    if (best === null || score > best.total) best = { total: score, label: rider.label };
  }
  return best;
}

/** A check rolled: its d20 faces, the one that counts, and the total. */
export type CheckRoll = Readonly<{
  faces: readonly number[];
  natural: number;
  total: number;
  /** Reliable Talent counted a d20 of 9 or lower as 10. */
  reliableTalent: boolean;
  /** What else raised the roll (Glibness's 15, Indomitable Might's Strength score); null when nothing did. */
  raisedBy: string | null;
  resolution: DiceResolution;
}>;

/**
 * Totals a check from its d20s, already thrown or typed (`faces`): the die the mode keeps, raised to 10 by Reliable
 * Talent when it shows 9 or lower, plus the plan's modifier and any dice effects. `mode` is the one the dice were
 * thrown under; a typed die is the one that counts, so it is read as a single d20.
 */
export function totalCheck(
  plan: CheckPlan,
  faces: readonly number[],
  mode: AggregatedRollMode["mode"],
  random: RandomSource,
  held: readonly ThrownDie[] = []
): CheckRoll {
  const resolution = resolveWithD20s(d20TestFormula(mode, plan.modifier) + plan.diceTerms, faces, random, held);
  const natural = keptD20(faces, mode);
  const reliable = plan.reliableTalent && natural <= 9;
  // A d20 floor above Reliable Talent's 10 (Glibness's 15) counts instead.
  const floor = plan.d20Minimum !== null && natural < plan.d20Minimum.face && (!reliable || plan.d20Minimum.face > 10);
  const raised = floor ? plan.d20Minimum!.face - natural : reliable ? 10 - natural : 0;
  const rolled = resolution.total + raised;
  const lifted = plan.totalMinimum !== null && plan.totalMinimum.total > rolled ? plan.totalMinimum : null;
  return {
    faces,
    natural,
    total: lifted ? lifted.total : rolled,
    reliableTalent: reliable && !floor && lifted === null,
    raisedBy: lifted?.label ?? (floor ? plan.d20Minimum!.label : null),
    resolution
  };
}

/** SRD Passive Perception: 10 plus the Wisdom (Perception) check bonus, 5 more with Advantage on such checks, 5 less
 *  with Disadvantage. Exhaustion reduces the roll of a D20 Test, and a passive score rolls nothing, so it stays out. */
export function passivePerception(plan: CheckPlan): number {
  const side = plan.rollMode.mode === "advantage" ? 5 : plan.rollMode.mode === "disadvantage" ? -5 : 0;
  return 10 + plan.modifier - plan.exhaustion + side;
}
