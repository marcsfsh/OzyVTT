import { conditionLabel } from "../condition-rules.js";
import { createPendingSaves } from "../saving-throws.js";
import { masteryHitPushes, masteryHitSaves, type MasterySwing } from "../weapon-mastery.js";
import { sizeAtMost, type ResolveContext } from "./context.js";

/** The weapon mastery in force on this swing (rules in `weapon-mastery.ts`); null unless a mastery
 *  applies to an attack that rolled. */
export function masterySwingOf(ctx: ResolveContext): MasterySwing | null {
  const { action, attack, attacker, deps, input, state } = ctx;
  const mastery = ctx.derivation.masteryByActionId[action.id];
  if (!mastery || attack === null) return null;
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

/** The resolver's own gate for table lines (`appendLog` re-checks). Unknown or non-public fails toward hiding. */
function namesAHiddenCombatant(ctx: ResolveContext, ...actorIds: readonly string[]): boolean {
  return actorIds.some((id) => ctx.state.actors.find((actor) => actor.id === id)?.visibility !== "public");
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
      text: `${attacker.name}'s ${forced.actionName} forces ${forced.targetName} to make a ${forced.ability.toUpperCase()} save${orTheCondition}.`,
      actorIds: [attacker.id, forced.targetId],
      ...(namesAHiddenCombatant(ctx, attacker.id, forced.targetId) ? { gmOnly: true } : {})
    });
    warnings.push(
      `${forced.actionName}: ${forced.targetName}'s save is DC ${forced.dc} - the prompt is in the turn order.`
    );
  }
}

/** Mastery forced movement (Push). Failures degrade to a GM-only sentence, never a rejection; only an
 *  accomplished push is narrated to the table. */
function pushMasteryTargets(ctx: ResolveContext): void {
  const { attacker, targets, deps, tableNarration, warnings } = ctx;
  for (const forced of masteryHitPushes(ctx.masterySwing)) {
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
        `${forced.targetName} is pushed ${forced.distanceFeet} feet straight away from ${attacker.name} - move the token.`
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
      `${forced.targetName} is pushed straight away from ${attacker.name}, but the map has nowhere to put it - the token stays where it is.`
    );
  }
}
