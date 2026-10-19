import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier } from "@vtt/rules-5e";
import { holdsFeature } from "../class-features.js";
import { conditionLabel } from "../condition-rules.js";
import { areAllies, areEnemies } from "../creature-sides.js";
import { endEffect } from "../effects.js";
import { hiddenFrom } from "../vision/audience.js";
import { sightRules } from "../vision/rules.js";
import { deriveEquipment, type EquipmentCatalog } from "../equipment-derivation.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { enteredOnMoveOf } from "../granted-moves.js";
import { specialSpeedsOf } from "../speed.js";
import type { RuleId } from "../rules-families.js";
import { endedEffect, sizeAtMost, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";

/**
 * Who an action without a spell may target, checked on the server as `spellTargetViolations` checks a spell (SRD
 * "Targets"): how many, how far, and which creatures (`ActionSchema.targets`). Each refusal names the target only when
 * the user's side can see it. A creature off the plane is refused earlier, for every action and spell (`validate.ts`).
 */

type Violation = Readonly<{ rule: RuleId; message: string }>;

type TargetCheck = Readonly<{
  state: GameState;
  attacker: LiveActor;
  action: DefinitionAction;
  targetIds: readonly string[];
  definition: ActorDefinition | undefined;
  resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined;
  /** The item catalog, for senses an item gives (a Ring of See Invisibility). */
  catalog?: EquipmentCatalog | undefined;
}>;

const words = (types: readonly string[]) =>
  types.map((type) => `${type[0]!.toUpperCase()}${type.slice(1)}`).join(" or ");

/** How many creatures it targets: a printed count, or "equal to your Charisma modifier (minimum of one)". A heal that
 *  isn't a spell's and isn't divided heals one creature (a potion's drinker, Lay on Hands' touch). */
export function targetCountOf(action: DefinitionAction, definition: ActorDefinition | undefined): number | null {
  const targets = action.targets;
  if (targets?.countAbility !== undefined)
    return Math.max(1, scoreModifier(definition?.abilityScores[targets.countAbility] ?? 10));
  if (targets?.count !== undefined) return targets.count;
  const oneHeal =
    action.healing !== undefined && !action.healing.divided && !action.healing.self && action.spellId === undefined;
  return oneHeal ? 1 : null;
}

/** Every refusal the action's own targeting rules raise for these targets. */
export function actionTargetViolations(check: TargetCheck): Violation[] {
  const { state, attacker, action, targetIds, definition, resolveDefinition, distanceFeet } = check;
  const violations: Violation[] = [];
  const unique = [...new Set(targetIds)];
  const hidden = hiddenFrom(state, resolveDefinition ? { definition: resolveDefinition } : {});
  const nameOf = (target: LiveActor) => (hidden(target.id) ? "That creature" : target.name);
  const targets = unique.flatMap((targetId) => {
    const target = state.actors.find((candidate) => candidate.id === targetId);
    return target ? [target] : [];
  });
  const limit = targetCountOf(action, definition);
  if (limit !== null && unique.length > limit)
    violations.push({
      rule: "target.too-many",
      message: `${action.name} targets ${limit === 1 ? "one creature" : `up to ${limit} creatures`}; ${unique.length} were chosen.`
    });
  const rules = action.targets;
  if (!rules) return violations;
  // "A creature you can see": the map with its vision on, else the conditions and the senses by distance.
  const sight =
    rules.seen || rules.perceivesUser
      ? sightRules(
          state,
          {
            ...(resolveDefinition ? { definition: resolveDefinition } : {}),
            ...(check.catalog ? { catalog: check.catalog } : {})
          },
          distanceFeet
        )
      : null;
  // It hears the user unless it is Deafened or the user stands where no sound can be made (Silence).
  const perceives = (target: LiveActor, user: LiveActor) =>
    sight?.canSee(target.id, user.id) === true ||
    (!target.conditions.some((condition) => condition.id === "deafened") && !silenced(user, check.catalog));
  // Taken move first, it reaches only the creatures its move entered; taken where it stands, the GM picks them.
  const entered = rules.entered ? enteredOnMoveOf(attacker, action.id) : null;
  for (const target of targets) {
    const name = nameOf(target);
    const self = target.id === attacker.id;
    if (rules.who === "others" && self)
      violations.push({ rule: "target.not-allowed", message: `${action.name} can't target ${attacker.name}.` });
    if (rules.who === "self" && !self)
      violations.push({ rule: "target.not-allowed", message: `${action.name} can target only ${attacker.name}.` });
    if (rules.who === "enemies" && (self || !areEnemies(attacker, target, resolveDefinition)))
      violations.push({
        rule: "target.not-an-enemy",
        message: `${action.name} targets enemies, and ${name} isn't one.`
      });
    if (rules.who === "allies" && !self && !areAllies(attacker, target, resolveDefinition))
      violations.push({ rule: "target.not-allowed", message: `${action.name} targets allies, and ${name} isn't one.` });
    const targetDefinition = target.definitionId ? resolveDefinition?.(target.definitionId) : undefined;
    // A creature of a type the action doesn't affect is still a target that nothing happens to (`type-gates.ts`); an
    // attack resolves against its one target, so its types are checked as it is aimed.
    const type = action.attack !== undefined ? creatureTypeOf(target, targetDefinition) : null;
    if (rules.creatureTypes && type !== null && !rules.creatureTypes.includes(type))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} affects only a ${words(rules.creatureTypes)}, and ${name} isn't one.`
      });
    if (rules.notCreatureTypes && type !== null && rules.notCreatureTypes.includes(type))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} has no effect on a ${words([type])}, so it can't target ${name}.`
      });
    if (rules.maxSize && !sizeAtMost(target.size, rules.maxSize))
      violations.push({
        rule: "target.not-allowed",
        message: `${name} is too large for ${action.name}, which affects a ${words([rules.maxSize])} creature or smaller.`
      });
    if (rules.grappledBySource && !grappledBy(target, attacker))
      violations.push({
        rule: "target.grappled-by-source",
        message: `${action.name} targets a creature ${attacker.name} is grappling, and ${name} isn't.`
      });
    // Taken again on the creature it holds to end it (Dimensional Shackles removed), it needs only that creature.
    const ending =
      action.grants?.toggles === true &&
      target.effects.some((effect) => effect.sourceActionId === action.id && effect.sourceActorId === attacker.id);
    if (
      rules.conditions &&
      !ending &&
      !target.conditions.some((condition) => rules.conditions!.includes(condition.id as never))
    )
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a ${rules.conditions.map(conditionLabel).join(" or ")} creature, and ${name} isn't.`
      });
    // "Charmed or Grappled by the aboleth": the condition comes from the user's own effect.
    if (
      rules.conditionsFromSource &&
      !target.effects.some(
        (effect) =>
          effect.sourceActorId === attacker.id &&
          effect.linkedConditionIds.some((id) => rules.conditionsFromSource!.includes(id as never))
      )
    )
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a creature that is ${rules.conditionsFromSource.map(conditionLabel).join(" or ")} by ${attacker.name}, and ${name} isn't.`
      });
    if (
      rules.heldByAction &&
      !target.effects.some(
        (effect) => effect.sourceActorId === attacker.id && effect.sourceActionId === rules.heldByAction
      )
    )
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a creature ${attacker.name} holds with ${heldName(rules.heldByAction)}, and ${name} isn't held.`
      });
    if (rules.typeTag && !typeTagsOf(targetDefinition).includes(rules.typeTag.toLowerCase()))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a ${rules.typeTag}, and ${name} isn't one.`
      });
    if (entered !== null && !entered.includes(target.id))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets the creatures whose spaces ${attacker.name} entered on its move, and ${name} isn't one.`
      });
    if (rules.atZeroHitPoints && target.hp.current > 0)
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a creature at 0 Hit Points, and ${name} isn't.`
      });
    // "Choose Bloodied creatures" (Preserve Life): at half its Hit Points or fewer, which its health band shows.
    if (rules.bloodied && !bloodied(target))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a Bloodied creature, and ${name} isn't.`
      });
    // "A Beast that has a Swim Speed" (Trident of Fish Command).
    if (rules.speeds) {
      const speeds = specialSpeedsOf(
        target,
        targetDefinition,
        deriveEquipment(target, targetDefinition, check.catalog)
      );
      if (!rules.speeds.some((mode) => (speeds[mode] ?? 0) > 0))
        violations.push({
          rule: "target.not-allowed",
          message: `${action.name} targets a creature with a ${rules.speeds.map((mode) => `${mode[0]!.toUpperCase()}${mode.slice(1)}`).join(" or ")} Speed, and ${name} has none.`
        });
    }
    // "Another creature ... who can see or hear you" (Bardic Inspiration).
    if (rules.perceivesUser && !self && !perceives(target, attacker))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} needs a creature that can see or hear ${attacker.name}, and ${name} can do neither.`
      });
    if (rules.markedBy && !markedBy(target, attacker, rules.markedBy))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets the creature ${attacker.name} marked with it, and ${name} isn't marked.`
      });
    if (rules.seen && sight && !self && !sight.canSee(attacker.id, target.id))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a creature ${attacker.name} can see.`
      });
    const apart = self ? 0 : (distanceFeet?.(attacker.id, target.id) ?? null);
    if (rules.inSpace && apart !== null && apart > DISTANCE_TOLERANCE_FEET)
      violations.push({
        rule: "range.out-of-reach",
        message: `${action.name} targets a creature in ${attacker.name}'s space, and ${name} isn't.`
      });
    if (rules.rangeFeet !== undefined && apart !== null && apart > rules.rangeFeet + DISTANCE_TOLERANCE_FEET)
      violations.push({
        rule: "range.out-of-range",
        message: `${name} is ${Math.round(apart * 10) / 10} ft away, beyond ${action.name}'s ${rules.rangeFeet === 5 ? "touch" : `${rules.rangeFeet} ft range`}.`
      });
  }
  return violations;
}

/**
 * The creatures under an action's area that its own rules leave out ("each enemy in a 20-foot-radius Sphere"). An area
 * catches everyone under it; these rules say whom it affects, so the rest are dropped from its catch rather than
 * refusing the use. A creature type it doesn't affect ("each creature that isn't an Undead") stays in the catch and
 * is left out of what it does as it resolves (`type-gates.ts`).
 */
export function areaLeavesOut(check: Omit<TargetCheck, "distanceFeet" | "definition">): ReadonlySet<string> {
  const rules = check.action.targets;
  if (!rules) return new Set();
  const { who, typeTag } = rules;
  const membership = {
    ...(who && who !== "self" ? { who } : {}),
    ...(typeTag ? { typeTag } : {})
  };
  if (Object.keys(membership).length === 0) return new Set();
  const action = { ...check.action, targets: membership };
  return new Set(
    check.targetIds.filter(
      (targetId) =>
        actionTargetViolations({
          ...check,
          action,
          targetIds: [targetId],
          definition: undefined,
          distanceFeet: undefined
        }).filter((violation) => violation.rule !== "target.too-many").length > 0
    )
  );
}

/** The type tags a stat block prints ("Fiend (Demon)": demon), lower case. */
function typeTagsOf(definition: ActorDefinition | undefined): string[] {
  const tags = (definition?.extensions["open5e.srd-2024"] as { typeTags?: unknown } | undefined)?.typeTags;
  return Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.toLowerCase())
    : [];
}

/** An action's printed name from its id ("web-strand": "Web Strand"). */
const heldName = (actionId: string) =>
  actionId
    .split("-")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");

/** SRD Bloodied: "while it has half its Hit Points or fewer remaining". */
const bloodied = (target: LiveActor) => target.hp.current <= target.hp.maximum / 2;

/** The creature stands inside a spell's area where no sound can be made: it holds that spell's aura (Silence). */
const silenced = (actor: LiveActor, catalog: EquipmentCatalog | undefined) =>
  actor.effects.some(
    (effect) => effect.spell !== undefined && catalog?.spellRecord?.(effect.spell.id)?.effect?.silencesArea === true
  );

const grappledBy = (target: LiveActor, source: LiveActor) =>
  target.effects.some((effect) => effect.sourceActorId === source.id && effect.linkedConditionIds.includes("grappled"));

const markedBy = (target: LiveActor, source: LiveActor, tag: string) =>
  target.effects.some((effect) => effect.sourceActorId === source.id && effect.tags.includes(tag));

/** An action that targets a creature its user marked ends that mark as it resolves (ending Quivering Palm's
 *  vibrations). */
export function endTargetMarks(ctx: ResolveContext): void {
  const tag = ctx.action.targets?.markedBy;
  if (tag === undefined || ctx.input.commit === false) return;
  for (const target of ctx.targets)
    for (const mark of target.effects.filter(
      (effect) => effect.sourceActorId === ctx.attacker.id && effect.tags.includes(tag)
    )) {
      endEffect(ctx.state, target.id, mark.id);
      ctx.effectsEnded.push(endedEffect(target, mark));
    }
}

const WORDS_OF_CREATION_SPELLS: ReadonlySet<string> = new Set(["power-word-heal", "power-word-kill"]);

/**
 * SRD Words of Creation (Bard 20): "When you cast either spell [Power Word Heal or Power Word Kill], you can target a
 * second creature with it if that creature is within 10 feet of the first target." The extra target it allows the
 * cast, and the refusal of a second one farther from the first.
 */
export function wordsOfCreation(
  attacker: LiveActor,
  spellId: string,
  targetIds: readonly string[],
  resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined,
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined,
  names: (actorId: string) => string
): Readonly<{ extra: number; violation?: Violation }> {
  if (!WORDS_OF_CREATION_SPELLS.has(spellId)) return { extra: 0 };
  const definition = attacker.definitionId ? resolveDefinition?.(attacker.definitionId) : undefined;
  if (!holdsFeature(definition, "words-of-creation", "Words of Creation")) return { extra: 0 };
  const [first, second] = [...new Set(targetIds)];
  const apart = first && second ? (distanceFeet?.(first, second) ?? null) : null;
  if (apart === null || apart <= 10 + DISTANCE_TOLERANCE_FEET) return { extra: 1 };
  return {
    extra: 1,
    violation: {
      rule: "range.out-of-range",
      message: `${names(second!)} is ${Math.round(apart * 10) / 10} ft from ${names(first!)}, and Words of Creation's second target must be within 10 feet of the first.`
    }
  };
}
