import { conditionLabel } from "../condition-rules.js";
import { endEffect } from "../effects.js";
import { createPendingSaves } from "../saving-throws.js";
import {
  masteryHitPushes,
  masteryHitSaves,
  SAPPED_TAG,
  VEXED_TAG,
  type MasteryPush,
  type MasterySwing
} from "../weapon-mastery.js";
import { endedEffect, sizeAtMost, type ResolveContext } from "./context.js";
import type { ActionResolution } from "@vtt/domain";
import { holdsFeature } from "../class-features.js";
import { CommandRejectedError } from "../game-store.js";
import { masteryProperty } from "../weapon-masteries.js";
import { withArticle } from "@vtt/domain";

/** SRD Tactical Master (Fighter 9): "When you attack with a weapon whose mastery property you can use, you can replace
 *  that property with the Push, Sap, or Slow property for that attack." */
export const TACTICAL_MASTERIES = ["push", "sap", "slow"] as const;

/** Whether this swing may take Tactical Master's Push, Sap or Slow: a Fighter with the feature, attacking with a weapon
 *  whose mastery it can use. */
function tacticalMasterReady(ctx: ResolveContext): boolean {
  return (
    ctx.derivation.masteryByActionId[ctx.action.id] !== undefined &&
    holdsFeature(ctx.deps.definition, "tactical-master", "Tactical Master")
  );
}

/** Refuses a Tactical Master pick the swing can't take, before anything rolls. */
export function checkTacticalMaster(ctx: ResolveContext): void {
  if (ctx.input.mastery === undefined || tacticalMasterReady(ctx)) return;
  throw new CommandRejectedError(
    holdsFeature(ctx.deps.definition, "tactical-master", "Tactical Master")
      ? `${ctx.attacker.name} can't use the mastery property of ${ctx.action.name}, so Tactical Master can't replace it.`
      : `${ctx.attacker.name} doesn't have Tactical Master, so ${ctx.action.name} keeps its own mastery property.`
  );
}

/** What a preview offers in place of the weapon's own mastery, and what this look picked. */
export function tacticalMasterOffer(ctx: ResolveContext): ActionResolution["masteryOptions"] | undefined {
  if (ctx.attack === null || !tacticalMasterReady(ctx)) return undefined;
  const own = masteryProperty(ctx.derivation.masteryByActionId[ctx.action.id]!.id);
  if (!own) return undefined;
  return {
    own: { id: own.id, name: own.name },
    alternatives: TACTICAL_MASTERIES.filter((id) => id !== own.id).map((id) => ({
      id,
      name: masteryProperty(id)?.name ?? id
    })),
    ...(ctx.input.mastery !== undefined ? { picked: ctx.input.mastery } : {})
  };
}

/** The weapon mastery in force on this swing (rules in `weapon-mastery.ts`); null unless a mastery
 *  applies to an attack that rolled. Tactical Master's pick stands in for the weapon's own. */
export function masterySwingOf(ctx: ResolveContext): MasterySwing | null {
  const { action, attack, attacker, deps, input, state } = ctx;
  const own = ctx.derivation.masteryByActionId[action.id];
  if (!own || attack === null) return null;
  const mastery = input.mastery !== undefined && tacticalMasterReady(ctx) ? { ...own, id: input.mastery } : own;
  return {
    mastery,
    attack,
    attacker: { id: attacker.id, name: attacker.name },
    damageType: action.damage[0]?.type ?? "untyped",
    proficiencyBonus: deps.definition?.proficiencyBonus ?? 0,
    actionId: action.id,
    commandId: input.commandId,
    round: state.combat.round
  };
}

/** The resolver's own gate for table lines (`appendLog` re-checks): the shared hidden check, where an unknown id
 *  fails toward hiding. */
function namesAHiddenCombatant(ctx: ResolveContext, ...actorIds: readonly string[]): boolean {
  return actorIds.some(ctx.hiddenFromTable);
}

/** What a landed mastery forces on its target: a saving throw (Topple) and forced movement (Push). */
export function applyMasteryForces(ctx: ResolveContext): void {
  parkMasterySaves(ctx);
  pushMasteryTargets(ctx);
}

/** Mastery on-hit saves (Topple), parked as normal pending saves. The table line names what forced the
 *  save; the DC (from the attacker's stat block) goes only to the GM and the target's own player. */
function parkMasterySaves(ctx: ResolveContext): void {
  const { state, attacker, deps, tableNarration, warnings } = ctx;
  for (const forced of masteryHitSaves(ctx.masterySwing)) {
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: forced.actionName,
      ability: forced.ability,
      dc: forced.dc,
      targetIds: [forced.targetId],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: forced.conditionId === null ? [] : [forced.conditionId],
      // Extra Attack can land two hits in one action, so each prompt is parked beside its predecessor.
      replaceExisting: false,
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
    const orTheCondition =
      forced.conditionId === null ? "" : ` or have the ${conditionLabel(forced.conditionId)} condition`;
    tableNarration.push({
      kind: "save",
      text: `${attacker.name}'s ${forced.actionName} forces ${forced.targetName} to make ${withArticle(`${forced.ability.toUpperCase()} save`)}${orTheCondition}.`,
      actorIds: [attacker.id, forced.targetId],
      ...(namesAHiddenCombatant(ctx, attacker.id, forced.targetId) ? { gmOnly: true } : {})
    });
    warnings.push(
      `${forced.actionName}: ${forced.targetName}'s save is DC ${forced.dc}. The prompt is in the turn order.`
    );
  }
}

/** The cantrip a Warlock's Repelling Blast rides: the pick the character made for it. */
function repellingBlastCantrip(ctx: ResolveContext): string | undefined {
  return ctx.deps.definition?.character?.choices?.find(
    (choice) => choice.kind === "cantrip" && choice.payload?.featureId === "repelling-blast"
  )?.id;
}

/** Every push a landed hit makes: its weapon's Push mastery, the action's own (a fire giant's Hammer Throw), and SRD
 *  Repelling Blast's "push the creature up to 10 feet straight away from you" with the cantrip picked for it. */
function hitPushesOf(ctx: ResolveContext, swing: MasterySwing | null): readonly MasteryPush[] {
  const { action, attack, attacker } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return masteryHitPushes(swing);
  const target = { targetId: attack.targetId, targetName: attack.targetName, awayFromActorId: attacker.id };
  return [
    ...masteryHitPushes(swing),
    ...(action.onHitPush
      ? [
          {
            ...target,
            distanceFeet: action.onHitPush.feet,
            maxTargetSize: action.onHitPush.maxTargetSize ?? ("gargantuan" as const)
          }
        ]
      : []),
    ...(action.spellId !== undefined && action.spellId === repellingBlastCantrip(ctx)
      ? [{ ...target, distanceFeet: 10, maxTargetSize: "large" as const }]
      : [])
  ];
}

/** The push a hit would offer, for the preview to name; null when none would (a miss, no push, too big). */
export function offeredPush(ctx: ResolveContext): Readonly<{ targetName: string; maxFeet: number }> | null {
  const forced = hitPushesOf(ctx, masterySwingOf(ctx))[0];
  if (!forced || !sizeAtMost(ctx.targets[0]?.size, forced.maxTargetSize)) return null;
  return { targetName: forced.targetName, maxFeet: forced.distanceFeet };
}

/** A hit's forced movement (the Push mastery, Repelling Blast, a stat block's shove), as far as the attacker chose
 *  (SRD "up to"). A failure is a GM-only sentence and refuses nothing; only an accomplished push is narrated to
 *  the table. */
function pushMasteryTargets(ctx: ResolveContext): void {
  const { attacker, targets, deps, input, tableNarration, warnings } = ctx;
  for (const offered of hitPushesOf(ctx, ctx.masterySwing)) {
    const forced = { ...offered, distanceFeet: Math.min(offered.distanceFeet, input.pushFeet ?? offered.distanceFeet) };
    if (forced.distanceFeet <= 0) {
      warnings.push(`${attacker.name} chose not to push ${forced.targetName}.`);
      continue;
    }
    if (!sizeAtMost(targets[0].size, forced.maxTargetSize)) {
      // Capitalised to match how the SRD prints a creature size in prose ("Large or smaller").
      warnings.push(
        `${forced.targetName} is bigger than ${forced.maxTargetSize[0].toUpperCase()}${forced.maxTargetSize.slice(1)} and can't be pushed.`
      );
      continue;
    }
    const moved =
      deps.pushToken?.({
        actorId: forced.targetId,
        awayFromActorId: forced.awayFromActorId,
        distanceFeet: forced.distanceFeet
      }) ?? null;
    // Null: the map couldn't answer, so ask the GM to move it. A measured zero: the map refused every
    // square, so say nothing. Rounded so snapping noise can't print "pushed 0 ft".
    if (moved === null) {
      warnings.push(
        `${forced.targetName} is pushed ${forced.distanceFeet} feet straight away from ${attacker.name}. Move the token.`
      );
      continue;
    }
    const travelled = Math.round(moved.value * 10) / 10;
    if (travelled > 0) {
      // Only public names and a distance the player projection already exposes.
      tableNarration.push({
        kind: "movement",
        text: `${forced.targetName} is pushed ${travelled} ${moved.unit} straight away from ${attacker.name}.`,
        actorIds: [attacker.id, forced.targetId],
        ...(namesAHiddenCombatant(ctx, attacker.id, forced.targetId) ? { gmOnly: true } : {})
      });
      continue;
    }
    warnings.push(
      `${forced.targetName} is pushed straight away from ${attacker.name}, but the map has nowhere to put it, so the token stays where it is.`
    );
  }
}

/** Sap is spent by the sapped creature's next attack roll, hit or miss (SRD: "Disadvantage on its next attack roll"). */
export function spendSap(ctx: ResolveContext): void {
  const { state, attack, attacker, effectsEnded } = ctx;
  if (attack === null) return;
  for (const sapped of attacker.effects.filter((effect) => effect.tags.includes(SAPPED_TAG))) {
    endEffect(state, attacker.id, sapped.id);
    effectsEnded.push(endedEffect(attacker, sapped));
  }
}

/** Vex's marker is spent by the attacker's next attack roll against the creature, hit or miss; a hit that vexes again
 *  lays a fresh one afterwards. */
export function spendVex(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, effectsEnded } = ctx;
  if (attack === null) return;
  const target = targets[0];
  const marker = target.effects.find(
    (effect) => effect.tags.includes(VEXED_TAG) && effect.sourceActorId === attacker.id
  );
  if (!marker) return;
  endEffect(state, target.id, marker.id);
  effectsEnded.push(endedEffect(target, marker));
}
