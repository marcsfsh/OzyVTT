import type { GameState } from "@vtt/domain";
import type { RuleId } from "./rules-families.js";

/**
 * "Immediately after dealing damage to a creature that is already Bloodied" (a gnoll's Rampage): damage that lands on a
 * creature at half its Hit Points or fewer marks its dealer's turn, and an action that waits on it is offered only
 * then. Every new turn clears the mark.
 */

const key = (actorId: string) => `${actorId}:hurt-bloodied`;

/** Marks the dealer's turn when its damage landed on a creature that was already Bloodied. */
export function markBloodiedHit(
  state: GameState,
  sourceActorId: string | null | undefined,
  hitPointsBefore: number,
  maximum: number,
  taken: number
): void {
  if (!state.combat.active || !sourceActorId || taken <= 0 || hitPointsBefore * 2 > maximum) return;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key(sourceActorId)]: 1 } }
  };
}

/** Why an action that waits on such a hit can't be used yet; null when it can. */
export function bloodiedHitViolation(
  state: GameState,
  attacker: Readonly<{ id: string; name: string }>,
  action: Readonly<{ name: string; afterHurtingBloodied?: true }>
): Readonly<{ rule: RuleId; message: string }> | null {
  if (!action.afterHurtingBloodied || (state.combat.turn.turnUses[key(attacker.id)] ?? 0) > 0) return null;
  return {
    rule: "feature.requires-effect",
    message: `${attacker.name} can use ${action.name} only right after it damages a creature that was already Bloodied.`
  };
}
