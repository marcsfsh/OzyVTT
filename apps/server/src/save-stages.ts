import type { AbilityId, GameState, PendingSave } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { EffectStage, EndedBy, RepeatSave, SaveFailureDuration } from "@vtt/schemas";
import { conditionLabel } from "./condition-rules.js";
import {
  addEffect,
  effectDurationOf,
  endEffectIfPresent,
  makeEffect,
  sourceOf,
  swapEffect,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";
import { createPendingSaves } from "./pending-saves.js";

/**
 * Saves repeated against an effect (SRD "repeats the save"), and what each one does: when the bearer repeats it (the
 * end or the start of each of its turns, once at the end of its next turn, when it takes damage, by its own action),
 * the damage a failure deals, successes and failures counted apart (Flesh to Stone's three), and the next stage a
 * failure brings ("Second Failure: The target has the Petrified condition instead").
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** The parts of a save block (`SaveOutcomeFields`) that say how its failure is repeated. */
export type RepeatFields = Readonly<{
  ability: AbilityId;
  dc: number;
  repeatSave?: boolean;
  repeatOnce?: true;
  repeatAtTurnStart?: true;
  repeatOnDamage?: Readonly<{ advantage?: true; notFromSource?: true; fromSourceOnly?: true }>;
  repeatByAction?: true;
  repeatUnseenSource?: true;
  repeatBeyondFeet?: number;
  immuneOnSuccess?: true;
  repeatFailureDamage?: RepeatSave["failureDamage"];
  repeatTally?: number;
  secondFailure?: Readonly<{
    name?: string;
    conditions: readonly string[];
    duration?: SaveFailureDuration;
    endsOnDamage?: true;
    repeatSave?: true;
    endedBy?: EndedBy;
  }>;
}>;

/** The repeat save a failure's effect carries, read from its save block; undefined when the failure isn't repeated.
 *  `stageName` names the next stage for its first condition ("Petrified by Basilisk (Petrifying Gaze)"); `again` is
 *  the damage a failed repeat deals when the text says it deals the first failure's damage again. */
export function repeatSaveOf(
  save: RepeatFields,
  stageName: (conditionId: string) => string,
  again?: RepeatSave["failureDamage"]
): RepeatSave | undefined {
  const atTurns =
    save.repeatSave === true ||
    save.repeatOnce === true ||
    save.repeatTally !== undefined ||
    save.repeatUnseenSource === true ||
    save.repeatBeyondFeet !== undefined;
  if (!atTurns && !save.repeatOnDamage && !save.repeatByAction && !save.repeatAtTurnStart) return undefined;
  const second = save.secondFailure;
  return {
    ability: save.ability,
    dc: save.dc,
    ...(save.repeatAtTurnStart ? { timing: "turn-start" as const } : atTurns ? {} : { timing: "none" as const }),
    ...(save.repeatOnce ? { once: true as const } : {}),
    ...(save.repeatOnDamage ? { onDamage: { ...save.repeatOnDamage } } : {}),
    ...(save.repeatByAction ? { byAction: true as const } : {}),
    ...(save.repeatUnseenSource ? { unseenSource: true as const } : {}),
    ...(save.repeatBeyondFeet !== undefined ? { beyondFeet: save.repeatBeyondFeet } : {}),
    ...(save.immuneOnSuccess && save.repeatBeyondFeet !== undefined ? { immuneOnSuccess: true as const } : {}),
    ...(save.repeatFailureDamage
      ? { failureDamage: save.repeatFailureDamage.map((part) => ({ ...part })) }
      : again && again.length > 0
        ? { failureDamage: again.map((part) => ({ ...part })) }
        : {}),
    ...(save.repeatTally !== undefined ? { tally: { needed: save.repeatTally, successes: 0, failures: 0 } } : {}),
    ...(second
      ? {
          next: {
            name: (second.name ?? stageName(second.conditions[0] ?? "")).slice(0, 120),
            linkedConditionIds: [...second.conditions],
            ...(second.duration ? { duration: second.duration } : {}),
            ...(second.endsOnDamage ? { endsOnDamage: true as const } : {}),
            ...(second.repeatSave ? { repeats: true as const } : {}),
            ...(second.endedBy ? { endedBy: endedByAt(second.endedBy, save.dc) } : {})
          }
        }
      : {})
  };
}

/** An ending action as an effect carries it: a check that prints no DC takes the save's own (Phantasmal Force: "against
 *  your spell save DC"). */
export function endedByAt(endedBy: EndedBy, dc: number): EndedBy {
  const copy = structuredClone(endedBy);
  return copy.check && copy.check.dc === undefined ? { ...copy, check: { ...copy.check, dc } } : copy;
}

/** A repeat save as it lands on its bearer: one that comes once, at the end of the bearer's next turn, skips the end
 *  of the turn it began in. */
export function armedRepeat(state: GameState, bearerId: string, repeat: RepeatSave): RepeatSave {
  const ownTurn = state.combat.active && state.combat.turnActorId === bearerId;
  return repeat.once && ownTurn ? { ...repeat, skipsCurrentTurn: true } : { ...repeat };
}

/** How long a failure lasts once its repeat is armed: "until the end of its next turn, at which point it repeats the
 *  save" (a brass dragon's Sleep Breath) holds until that save is answered, which ends it or brings what comes next. */
export function durationUntilRepeat(
  duration: SaveFailureDuration | undefined,
  repeat: RepeatSave | undefined
): SaveFailureDuration | undefined {
  return repeat?.once && duration?.type === "until-bearer-turn-end" ? undefined : duration;
}

/** What opening an ending save needs: ids, the clock, dice for a failure's damage, and whether a creature sees another
 *  (true when the map can't tell). */
export type EndingSaveDeps = Readonly<{
  newId: () => string;
  now: () => string;
  rollDie?: (sides: number) => number;
  sees?: (viewerId: string, targetId: string) => boolean;
  /** Creature-to-creature distance on the map; null when it can't tell. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** The repeat saves `actorId` owes as its turn starts or ends: one per effect that repeats then. A once-only repeat
 *  armed during this very turn waits for the next. As a creature's turn starts, the creatures bearing its effects that
 *  repeat then make theirs too (Prismatic Spray's Violet ray: "at the start of your next turn"). */
export function openRepeatSaves(
  state: GameState,
  actorId: string,
  timing: "turn-end" | "turn-start",
  deps: EndingSaveDeps
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [];
  if (timing === "turn-start")
    for (const bearer of state.actors)
      for (const effect of [...bearer.effects])
        if (effect.sourceActorId === actorId && effect.repeatSave?.timing === "source-turn-start")
          events.push(openEndingSave(state, bearer, effect, effect.repeatSave, "makes", deps));
  for (const effect of [...actor.effects]) {
    const repeat = effect.repeatSave;
    if (!repeat || (repeat.timing ?? "turn-end") !== timing) continue;
    if (repeat.skipsCurrentTurn) {
      writeRepeat(actor, effect.id, { ...repeat, skipsCurrentTurn: undefined });
      continue;
    }
    // "If the creature ends its turn in a space where it doesn't have line of sight to you" (Fear).
    if (repeat.unseenSource && (effect.sourceActorId === null || seesSource(deps, actor.id, effect.sourceActorId)))
      continue;
    // "If the Frightened or Charmed creature ends its turn more than 120 feet away from the target" (Antipathy).
    if (repeat.beyondFeet !== undefined) {
      const apart =
        effect.sourceActorId === null ? null : (deps.distanceFeet?.(actor.id, effect.sourceActorId) ?? null);
      if (apart === null || apart <= repeat.beyondFeet) continue;
    }
    events.push(openEndingSave(state, actor, effect, repeat, "repeats", deps));
  }
  return events;
}

/** Whether the bearer sees its effect's source; true when the map can't tell. */
const seesSource = (deps: EndingSaveDeps, bearerId: string, sourceId: string) =>
  deps.sees === undefined || deps.sees(bearerId, sourceId);

/** "Until it ends its turn with the nalfeshnee out of line of sight": what ends as `actorId`'s turn ends where it can't
 *  see the effect's source. Nothing ends where the map can't tell. */
export function endEffectsOutOfSight(state: GameState, actorId: string, deps: EndingSaveDeps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  return actor.effects
    .filter(
      (effect) =>
        effect.endsOutOfSight === true &&
        effect.sourceActorId !== null &&
        !seesSource(deps, actor.id, effect.sourceActorId)
    )
    .flatMap((effect) => endEffectIfPresent(state, actor.id, effect.id));
}

/** "Whenever the target takes damage, it repeats the save": one save per effect that repeats on damage, with
 *  Advantage where the text gives it (Hideous Laughter), and none for damage its own source deals where only another
 *  source's counts (Luring Song). */
export function openRepeatSavesOnDamage(
  state: GameState,
  actor: Actor,
  dealerId: string | undefined,
  deps: EndingSaveDeps
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const effect of [...actor.effects]) {
    const onDamage = effect.repeatSave?.onDamage;
    if (!onDamage) continue;
    if (onDamage.notFromSource && dealerId !== undefined && dealerId === effect.sourceActorId) continue;
    if (onDamage.fromSourceOnly && (dealerId === undefined || dealerId !== effect.sourceActorId)) continue;
    events.push(
      openEndingSave(
        state,
        actor,
        effect,
        effect.repeatSave!,
        "repeats",
        deps,
        onDamage.advantage ? "Triggered by damage" : undefined
      )
    );
  }
  return events;
}

/**
 * A save the bearer owes against one of its effects (`repeatOf`): repeated as its turn ends or starts, when it takes
 * damage or by its own action, or made once its ongoing damage lands. A repeat's failure damage is rolled now, so the
 * prompt shows it and the failure lands it.
 */
export function openEndingSave(
  state: GameState,
  bearer: Actor,
  effect: Effect,
  save: Readonly<{ ability: AbilityId; dc: number; disadvantageFrom?: string }>,
  verb: "repeats" | "makes",
  deps: EndingSaveDeps,
  advantageFrom?: string
): EffectNarration {
  const repeat = verb === "repeats" ? effect.repeatSave : undefined;
  const parts =
    repeat?.failureDamage && deps.rollDie
      ? repeat.failureDamage.map((part) => ({
          amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie!).total),
          type: part.type
        }))
      : [];
  createPendingSaves(state, {
    ...(save.disadvantageFrom ? { disadvantage: { targetId: bearer.id, from: save.disadvantageFrom } } : {}),
    sourceActorId: effect.sourceActorId,
    sourceName: effect.sourceName ?? effect.name,
    actionName: `${effect.name} - ${verb === "repeats" ? "repeat save" : "save"}`.slice(0, 120),
    ability: save.ability,
    dc: save.dc,
    targetIds: [bearer.id],
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    halfOnSuccess: false,
    conditionIds: [],
    repeatOf: { actorId: bearer.id, effectId: effect.id, ...(repeat ? { repeat: true as const } : {}) },
    // Repeated against a spell's effect (Hold Person), it is still a save against magic.
    magical: effect.magical === true,
    // A success leaves the bearer immune to the effect's source (Antipathy/Sympathy).
    ...(repeat?.immuneOnSuccess ? { immuneOnSuccess: true } : {}),
    ...(advantageFrom ? { advantageFrom } : {}),
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  const tally = repeat?.tally;
  const ends = tally
    ? `${tally.successes} of ${tally.needed} successes and ${tally.failures} of ${tally.needed} failures so far`
    : repeat?.failureTurnTags
      ? "a failure holds it to what the effect allows this turn"
      : "a success ends it";
  return {
    kind: "condition",
    text: `${bearer.name} ${verb} the ${save.ability.toUpperCase()} save against ${effect.name} (DC ${save.dc}); ${ends}.`,
    actorId: bearer.id,
    ...sourceOf(effect)
  };
}

/**
 * What an answered ending save does to its effect. A success ends it, unless successes are counted (Flesh to Stone),
 * when only the last one does. A failure counts toward the tally, brings the effect's next stage (a basilisk's second
 * failure Petrifies), or after a once-only repeat leaves the failure to run its course.
 */
export function settleEndingSave(
  state: GameState,
  pending: PendingSave,
  success: boolean,
  id: string,
  immunities?: ConditionImmunitySource
): EffectNarration[] {
  const reference = pending.repeatOf;
  if (!reference) return [];
  const bearer = state.actors.find((actor) => actor.id === reference.actorId);
  const effect = bearer?.effects.find((candidate) => candidate.id === reference.effectId);
  if (!bearer || !effect) return [];
  const repeat = reference.repeat ? effect.repeatSave : (effect.repeatSave?.timing === "source-turn-start" ? effect.repeatSave : undefined);
  if (repeat?.failureTurnTags) return success ? [] : compelledTurn(state, bearer, effect, repeat.failureTurnTags, id);
  if (!repeat) return success ? endEffectIfPresent(state, bearer.id, effect.id) : [];
  const tally = repeat.tally;
  if (tally) {
    const counted = {
      ...tally,
      successes: tally.successes + (success ? 1 : 0),
      failures: tally.failures + (success ? 0 : 1)
    };
    if (counted.successes >= tally.needed)
      return [
        {
          kind: "condition",
          text: `${bearer.name} has succeeded ${tally.needed} times against ${effect.name}.`,
          actorId: bearer.id,
          ...sourceOf(effect)
        },
        ...endEffectIfPresent(state, bearer.id, effect.id)
      ];
    if (counted.failures >= tally.needed)
      return repeat.next
        ? nextStage(state, bearer, effect, repeat, `${id}:next`, immunities)
        : (writeRepeat(bearer, effect.id, undefined), []);
    writeRepeat(bearer, effect.id, { ...repeat, tally: counted });
    return [];
  }
  if (success) return endEffectIfPresent(state, bearer.id, effect.id);
  if (repeat.next) return nextStage(state, bearer, effect, repeat, `${id}:next`, immunities);
  // A once-only repeat is spent; the failure runs its course.
  if (repeat.once) writeRepeat(bearer, effect.id, undefined);
  return [];
}

/** The effect a failed repeat turns into: the next stage's conditions in place of the first's, from the same source
 *  and cast, so the caster's Concentration still holds it. Its tags and modifiers carry over: a shake still wakes a
 *  sleeper, and Contagion's Disadvantage on the chosen ability lasts its 7 days. */
function nextStage(
  state: GameState,
  bearer: Actor,
  effect: Effect,
  repeat: RepeatSave,
  id: string,
  immunities?: ConditionImmunitySource
): EffectNarration[] {
  const stage: EffectStage = repeat.next!;
  const events: EffectNarration[] = [];
  const replacement = makeEffect({
    id: id.slice(0, 120),
    name: stage.name,
    tags: [...new Set([...effect.tags, ...(stage.tags ?? [])])].slice(0, 8),
    modifiers: structuredClone(effect.modifiers),
    sourceActorId: effect.sourceActorId,
    sourceName: effect.sourceName,
    sourceActionId: effect.sourceActionId,
    startedRound: state.combat.round,
    duration: effectDurationOf(state, stage.duration, bearer.id, effect.sourceActorId),
    endsWhenSourceDefeated: effect.endsWhenSourceDefeated,
    concentration: effect.concentration,
    linkedConditionIds: [...stage.linkedConditionIds],
    ...(stage.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(stage.repeats ? { repeatSave: { ability: repeat.ability, dc: repeat.dc } } : {}),
    ...(stage.endedBy ? { endedBy: structuredClone(stage.endedBy) } : {}),
    ...(effect.castId !== undefined ? { castId: effect.castId } : {}),
    ...(effect.spell ? { spell: { ...effect.spell } } : {}),
    ...(effect.magical ? { magical: true as const } : {})
  });
  swapEffect(state, bearer.id, effect.id, replacement, events, immunities);
  return [
    {
      kind: "condition",
      text: `${bearer.name} fails again: ${stage.name}${stage.linkedConditionIds.length > 0 ? ` (${stage.linkedConditionIds.map(conditionLabel).join(", ")})` : ""}.`,
      actorId: bearer.id,
      ...sourceOf(effect)
    },
    ...events
  ];
}

/** A compelling save failed (Bestow Curse): the bearer carries the tags until its turn ends, and the effect stays. */
function compelledTurn(
  state: GameState,
  bearer: Actor,
  effect: Effect,
  tags: readonly string[],
  id: string
): EffectNarration[] {
  const events: EffectNarration[] = [];
  addEffect(
    state,
    bearer.id,
    makeEffect({
      id: `${id}:turn`.slice(0, 120),
      name: `${effect.name} (this turn)`.slice(0, 120),
      tags: [...tags],
      sourceActorId: effect.sourceActorId,
      sourceName: effect.sourceName,
      startedRound: state.combat.round,
      // Made as the bearer's turn starts, it ends as that same turn ends.
      duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false }
    }),
    events
  );
  return [
    { kind: "condition", text: `${bearer.name} fails: ${effect.name} holds it this turn.`, actorId: bearer.id, ...sourceOf(effect) },
    ...events
  ];
}

/** Writes an effect's repeat save back (undefined: the effect no longer repeats it). */
function writeRepeat(bearer: Actor, effectId: string, repeat: RepeatSave | undefined): void {
  bearer.effects = bearer.effects.map((candidate) => {
    if (candidate.id !== effectId) return candidate;
    const { repeatSave: _old, ...rest } = candidate;
    const kept = repeat ? Object.fromEntries(Object.entries(repeat).filter(([, value]) => value !== undefined)) : null;
    return kept ? { ...rest, repeatSave: kept as RepeatSave } : rest;
  });
}
