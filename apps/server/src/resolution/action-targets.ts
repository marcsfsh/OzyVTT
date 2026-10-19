import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier } from "@vtt/rules-5e";
import { holdsFeature } from "../class-features.js";
import { conditionLabel } from "../condition-rules.js";
import { areAllies, areEnemies } from "../creature-sides.js";
import { endEffect } from "../effects.js";
import { hiddenFrom } from "../vision/audience.js";
import { sceneSight } from "../vision/sight.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { creatureTypeOf } from "../statblock-facts.js";
import type { RuleId } from "../rules-families.js";
import { endedEffect, sizeAtMost, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";

/**
 * Who an action without a spell may target, checked on the server as `spellTargetViolations` checks a spell (SRD
 * "Targets"): how many, how far, and which creatures (`ActionSchema.targets`). Each refusal names the target only when
 * the user's side can see it. A creature gone from the plane (Hurl Through Hell's victim) can't be targeted by
 * anything.
 */

/** The bearer is off this plane for now (hurled through the Lower Planes): nothing here can target it. */
export const OFF_PLANE_TAG = "off-plane";

type Violation = Readonly<{ rule: RuleId; message: string }>;

type TargetCheck = Readonly<{
  state: GameState;
  attacker: LiveActor;
  action: DefinitionAction;
  targetIds: readonly string[];
  definition: ActorDefinition | undefined;
  resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined;
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
  for (const target of targets)
    if (target.effects.some((effect) => effect.tags.includes(OFF_PLANE_TAG)))
      violations.push({
        rule: "target.not-allowed",
        message: `${nameOf(target)} is gone from this plane for now and can't be targeted.`
      });
  const limit = targetCountOf(action, definition);
  if (limit !== null && unique.length > limit)
    violations.push({
      rule: "target.too-many",
      message: `${action.name} targets ${limit === 1 ? "one creature" : `up to ${limit} creatures`}; ${unique.length} were chosen.`
    });
  const rules = action.targets;
  if (!rules) return violations;
  const sight = rules.seen ? sceneSight(state, resolveDefinition ? { definition: resolveDefinition } : {}) : null;
  for (const target of targets) {
    const name = nameOf(target);
    const self = target.id === attacker.id;
    if (rules.who === "others" && self)
      violations.push({ rule: "target.not-allowed", message: `${action.name} can't target ${attacker.name}.` });
    if (rules.who === "enemies" && (self || !areEnemies(attacker, target, resolveDefinition)))
      violations.push({
        rule: "target.not-an-enemy",
        message: `${action.name} targets enemies, and ${name} isn't one.`
      });
    if (rules.who === "allies" && !self && !areAllies(attacker, target, resolveDefinition))
      violations.push({ rule: "target.not-allowed", message: `${action.name} targets allies, and ${name} isn't one.` });
    const targetDefinition = target.definitionId ? resolveDefinition?.(target.definitionId) : undefined;
    const type = creatureTypeOf(target, targetDefinition);
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
    if (rules.conditions && !target.conditions.some((condition) => rules.conditions!.includes(condition.id as never)))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets a ${rules.conditions.map(conditionLabel).join(" or ")} creature, and ${name} isn't.`
      });
    if (rules.markedBy && !markedBy(target, attacker, rules.markedBy))
      violations.push({
        rule: "target.not-allowed",
        message: `${action.name} targets the creature ${attacker.name} marked with it, and ${name} isn't marked.`
      });
    if (sight?.enabled && !self && !sight.sees(attacker.id, target.id))
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
