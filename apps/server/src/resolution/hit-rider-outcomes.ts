import type { PendingSave } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ForcedPush, HitOutcome } from "@vtt/schemas";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import { addEffect, effectDurationOf, endEffect, makeEffect, type EffectNarration } from "../effects.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { grantMove } from "../granted-moves.js";
import { createPendingSaves } from "../saving-throws.js";
import { currentSpeedFeet } from "../speed.js";
import { recordRoll, tableLineOf, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";
import { failureEffectFor, isMagicalAction, successEffectFor } from "./pending.js";

/**
 * What a hit rider does to the creature it rides beyond its dice: an effect with no save (Frost's Chill's slow), a
 * save at the rider's DC (Stunning Strike, a Cunning Strike's Trip), a push (Forceful Blow) and a move it gives the
 * attacker (Withdraw). Each lands right after the hit, against the hit's one target.
 */

const BARE = new Set(["prone", "exhaustion"]);

const immunitiesOf = (ctx: ResolveContext) => ({
  ...(ctx.deps.resolveDefinition ? { resolveDefinition: ctx.deps.resolveDefinition } : {}),
  ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
});

/** Puts a rider's effect on the target: its conditions, tags and modifiers as one effect from the attacker, Prone on
 *  its own. One per target replaces any other of its name there (Hamstring Blow); one per source ends the
 *  attacker's earlier one on any creature (Quivering Palm). */
export function applyHitOutcome(
  ctx: ResolveContext,
  target: LiveActor,
  action: DefinitionAction,
  outcome: HitOutcome,
  key: string
): void {
  const { state, attacker, input } = ctx;
  const conditions = outcome.conditions ?? [];
  for (const conditionId of conditions.filter((id) => BARE.has(id))) {
    const events = setCondition(state, target.id, conditionId, true, undefined, { role: "gm" }, immunitiesOf(ctx));
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    if (!events.some((event) => event.immune))
      ctx.effectsApplied.push({
        targetId: target.id,
        targetName: target.name,
        name: conditionLabel(conditionId),
        conditionIds: [conditionId]
      });
  }
  const linked = conditions.filter((id) => !BARE.has(id));
  if (linked.length === 0 && outcome.tags.length === 0 && outcome.modifiers.length === 0) return;
  if (outcome.onePerTarget)
    for (const other of target.effects.filter((effect) => effect.name === outcome.name))
      ctx.tableNarration.push(...endEffect(state, target.id, other.id).map((event) => tableLineOf(ctx, event)));
  if (outcome.onePerSource)
    for (const bearer of state.actors)
      for (const other of bearer.effects.filter(
        (effect) => effect.sourceActorId === attacker.id && effect.sourceActionId === `${action.id}:${key}`
      ))
        ctx.tableNarration.push(...endEffect(state, bearer.id, other.id).map((event) => tableLineOf(ctx, event)));
  const gained: EffectNarration[] = [];
  const effect = addEffect(
    state,
    target.id,
    makeEffect({
      id: `${input.commandId}:${action.id}:${key}:${target.id}`,
      name: outcome.name,
      tags: [...outcome.tags],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      // Each effect of one rider is its own, so two from one hit stand side by side; the same one again refreshes.
      sourceActionId: `${action.id}:${key}`,
      startedRound: state.combat.round,
      duration: effectDurationOf(state, outcome.duration, target.id, attacker.id),
      modifiers: [...outcome.modifiers],
      linkedConditionIds: linked
    }),
    gained,
    immunitiesOf(ctx)
  );
  for (const event of gained) ctx.tableNarration.push(tableLineOf(ctx, event));
  ctx.effectsApplied.push({ targetId: target.id, targetName: target.name, name: effect.name, conditionIds: linked });
}

/** Rolls a rider's save dice as they stand: a save's damage is no hit's, so a Critical Hit doesn't double it. */
export function rollPlain(ctx: ResolveContext, formula: string, type: string, source: string) {
  const rolled = resolveDice(parseDiceFormula(formula), ctx.deps.random);
  recordRoll(ctx, rolled, "damage", source);
  return { amount: Math.max(0, rolled.total), type };
}

/** A save a rider opens on its target. */
export type RiderSave = Readonly<{
  /** What the prompt is called ("Stunning Strike", "Cunning Strike: Trip"). */
  name: string;
  ability: NonNullable<DefinitionAction["save"]>["ability"];
  dc: number;
  failureConditions: readonly string[];
  failureDuration?: NonNullable<DefinitionAction["save"]>["failureDuration"];
  repeatSave?: true;
  endsOnDamage?: true;
  failureEffect?: NonNullable<DefinitionAction["save"]>["failureEffect"];
  successEffect?: NonNullable<DefinitionAction["save"]>["successEffect"];
  failurePush?: ForcedPush;
  /** Damage a failure deals, none on a success (Hurl Through Hell's 8d10 Psychic), or half with `halfOnSuccess`. */
  failureDamage?: ReadonlyArray<Readonly<{ amount: number; type: string }>>;
  halfOnSuccess?: true;
  /** A success makes the target immune to this rider of the attacker, for these minutes of game time or the fight. */
  immuneOnSuccess?: true;
  immuneMinutes?: number;
}>;

/** Opens the save on the target as its own prompt, sourced by the attacker: what a failure and a success leave are
 *  the rider's. Extra Attack can owe two, so an earlier one stays. */
export function openRiderSave(ctx: ResolveContext, target: LiveActor, action: DefinitionAction, save: RiderSave): void {
  const asAction: DefinitionAction = {
    ...action,
    name: save.name,
    save: {
      ability: save.ability,
      dc: save.dc,
      successDamage: save.halfOnSuccess ? "half" : "none",
      failureConditions: [...(save.failureConditions as NonNullable<DefinitionAction["save"]>["failureConditions"])],
      ...(save.failureDuration ? { failureDuration: save.failureDuration } : {}),
      ...(save.repeatSave ? { repeatSave: true as const } : {}),
      ...(save.endsOnDamage ? { endsOnDamage: true as const } : {}),
      ...(save.failureEffect ? { failureEffect: save.failureEffect } : {}),
      ...(save.successEffect ? { successEffect: save.successEffect } : {})
    }
  };
  const source = {
    action: asAction,
    attacker: ctx.attacker,
    riderItemId: ctx.riderItemId,
    deps: ctx.deps,
    castId: null
  };
  const onFailEffect: PendingSave["onFailEffect"] = failureEffectFor(source, save.failureConditions);
  const onSuccessEffect = successEffectFor(source);
  const parts = save.failureDamage ?? [];
  createPendingSaves(ctx.state, {
    sourceActorId: ctx.attacker.id,
    sourceName: ctx.attacker.name,
    actionName: save.name,
    ability: save.ability,
    dc: save.dc,
    targetIds: [target.id],
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    halfOnSuccess: save.halfOnSuccess === true,
    conditionIds: [...save.failureConditions],
    ...(onFailEffect ? { onFailEffect } : {}),
    ...(onSuccessEffect ? { extra: { onSuccessEffect } } : {}),
    ...(save.failurePush ? { failurePush: save.failurePush } : {}),
    ...(save.immuneOnSuccess ? { immuneOnSuccess: true } : {}),
    ...(save.immuneOnSuccess && save.immuneMinutes !== undefined ? { immuneMinutes: save.immuneMinutes } : {}),
    // What its damage drains as it lands (a Rod of Lordly Might's Drain Life heals its wielder half).
    ...(action.drain ? { drain: action.drain } : {}),
    replaceExisting: false,
    magical: isMagicalAction(source),
    newSaveId: ctx.deps.newRollId,
    createdAt: Date.parse(ctx.deps.now())
  });
}

/** Moves the target straight away from the attacker, or toward it for a pull, and tells the table how far. Where the
 *  map can't measure it, the GM is told to move the token. */
export function forceMove(
  ctx: ResolveContext,
  target: LiveActor,
  source: string,
  push: ForcedPush,
  toward = false
): void {
  const { attacker, deps } = ctx;
  const moved = deps.pushToken?.({
    actorId: target.id,
    awayFromActorId: attacker.id,
    distanceFeet: push.feet,
    ...(toward ? { toward: true } : {})
  });
  if (moved === null || moved === undefined) {
    ctx.warnings.push(
      `${source}: move ${target.name} ${toward ? "up to " : ""}${push.feet} feet straight ${toward ? "toward" : "away from"} ${attacker.name}.`
    );
    return;
  }
  ctx.tableNarration.push({
    kind: "movement",
    text: `${source} ${toward ? "pulls" : "pushes"} ${target.name} ${Math.round(moved.value)} ${moved.unit}${toward ? ` toward ${attacker.name}` : ""}.`,
    actorIds: [target.id, attacker.id]
  });
}

/** "You can then move up to half your Speed ... without provoking Opportunity Attacks": a granted move on the
 *  attacker's own turn, beside its Speed, that the movement rules charge and that provokes nothing
 *  (`granted-moves.ts`). With `towardId` it must end nearer that creature (Forceful Blow's "straight toward the
 *  target"). */
export function grantHalfSpeedMove(ctx: ResolveContext, source: string, towardId?: string): void {
  const { state, attacker, deps, input } = ctx;
  const speed = currentSpeedFeet(attacker, deriveEquipment(attacker, deps.definition, deps.catalog)) ?? 0;
  const feet = Math.floor(speed / 10) * 5;
  if (feet <= 0) return;
  if (state.combat.turnActorId === attacker.id)
    grantMove(state, attacker, {
      id: `${input.commandId}:${source}:move`,
      name: source,
      feet,
      provokes: false,
      ...(towardId ? { towardActorId: towardId } : {})
    });
  ctx.tableNarration.push({
    kind: "movement",
    text: `${source}: ${attacker.name} can move up to ${feet} feet without provoking Opportunity Attacks.`,
    actorIds: [attacker.id]
  });
}
