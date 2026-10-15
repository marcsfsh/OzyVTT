import { isIncapacitated } from "../condition-rules.js";
import { effectiveActions } from "../effective-actions.js";
import { familyModeFor } from "../rules-families.js";
import { createPendingSaves } from "../saving-throws.js";
import type { ResolveContext } from "./context.js";
import { damagePartsOf } from "./damage.js";

/** A hit on a combatant with a matching declared reaction (Uncanny Dodge) parks the damage in a prompt:
 *  "use" spends the reaction and applies half, "decline" applies it in full (see reactions.ts). The
 *  reaction window follows the economy family, so freeform movement does not silence it. */
export function parkReaction(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (
    attack === null ||
    (attack.outcome !== "crit" && attack.outcome !== "hit") ||
    familyModeFor(state.combat, "economy") === "freeform" ||
    !deps.resolveDefinition
  )
    return;
  const target = targets[0];
  const proposedParts = damagePartsOf(ctx);
  const proposedTotal = proposedParts.reduce((sum, part) => sum + part.amount, 0);
  const targetDefinition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
  // The target's effective list, so an item-granted reaction is found.
  const declared = effectiveActions(targetDefinition, target, deps.catalog).find(
    (candidate) =>
      candidate.activation === "reaction" &&
      candidate.reaction?.trigger === "hit-by-attack" &&
      candidate.reaction.response === "half-damage"
  );
  if (
    !declared ||
    proposedTotal <= 0 ||
    target.id === attacker.id ||
    isIncapacitated(target) ||
    state.combat.reactionsUsed.includes(target.id) ||
    state.combat.pendingReactions.length >= 20
  )
    return;
  state.combat = {
    ...state.combat,
    pendingReactions: [
      ...state.combat.pendingReactions,
      {
        id: deps.newRollId(),
        kind: "hit-by-attack" as const,
        actorId: target.id,
        actionId: declared.id,
        actionName: declared.name,
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        targetActorId: null,
        triggerCommandId: input.commandId,
        proposedDamage: proposedTotal,
        proposedDamageParts: proposedParts,
        critical: ctx.crit,
        createdAt: Date.parse(deps.now())
      }
    ]
  };
  ctx.reactionPrompts.push({ actorId: target.id, actorName: target.name, actionName: declared.name });
}

/** A save action parks one pending save per target; the outcome auto-applies (see saving-throws.ts). */
export function parkActionSave(ctx: ResolveContext): void {
  const { state, action, attacker, targets, input, deps, damage } = ctx;
  if (!action.save) return;
  createPendingSaves(state, {
    sourceActorId: attacker.id,
    sourceName: attacker.name,
    actionName: action.name,
    ability: action.save.ability,
    dc: action.save.dc,
    targetIds: targets.map((target) => target.id),
    proposedDamage: damage.reduce((sum, part) => sum + part.total, 0),
    proposedDamageParts: damage.map((part) => ({ amount: part.total, type: part.type })),
    // Cover adds to Dexterity saving throws (SRD Cover) - carried on the prompt.
    saveBonus: action.save.ability === "dex" ? ctx.coverBonus : 0,
    halfOnSuccess: action.save.successDamage === "half",
    // The GM's explicit choice wins over the condition the action declares.
    conditionId: input.conditionId ?? action.save.failureCondition,
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
}
