import type { GameState } from "@vtt/domain";
import type { ResolveContext } from "./context.js";

/**
 * What creatures did to each other this turn, kept on the turn record and cleared with it: who attacked whom (Horde
 * Breaker's "that you haven't attacked this turn"), who hit whom with a Strength-based attack (Frenzy's "first target
 * you hit"), and who damaged whom (Superior Hunter's Prey's "when you deal damage to a creature marked"). Only in a
 * fight, where turns exist.
 */

export type DealingKind = "attacked" | "strength-hit" | "damaged";

/** Notes that `by` did `kind` to `target` this turn. */
export function recordDealing(state: GameState, by: string, target: string, kind: DealingKind): void {
  if (!state.combat.active) return;
  const dealings = state.combat.turn.dealings ?? [];
  if (dealings.some((entry) => entry.by === by && entry.target === target && entry.kind === kind)) return;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, dealings: [...dealings, { by, target, kind }].slice(-200) }
  };
}

/** Whether `by` did `kind` this turn, to `target` or to anyone. */
export function dealt(state: GameState, by: string, kind: DealingKind, target?: string): boolean {
  return (state.combat.turn.dealings ?? []).some(
    (entry) => entry.by === by && entry.kind === kind && (target === undefined || entry.target === target)
  );
}

/** A confirmed attack roll: its target was attacked, and a landed Strength-based weapon or Unarmed Strike hit is noted. */
export function recordAttackDealings(ctx: ResolveContext): void {
  const { state, attacker, attack, input } = ctx;
  if (attack === null || input.commit === false || attack.targetId === undefined) return;
  recordDealing(state, attacker.id, attack.targetId, "attacked");
  const landed = attack.outcome === "hit" || attack.outcome === "crit";
  const kinds = ctx.riderFilters.attackKinds ?? [];
  if (landed && ctx.riderFilters.ability === "str" && (kinds.includes("weapon") || kinds.includes("unarmed")))
    recordDealing(state, attacker.id, attack.targetId, "strength-hit");
}
