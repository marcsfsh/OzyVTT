import type { GameState } from "@vtt/domain";
import type { RuleId } from "./rules-families.js";

/**
 * An attack a hit lets its user make next with no further action, against that hit's target (SRD 5.2.1 allosaurus:
 * "If the target is a Large or smaller creature and the allosaurus moved 30+ feet straight toward it immediately
 * before the hit, the target has the Prone condition, and the allosaurus can make one Bite attack against it"). It is
 * one more place in the turn's open action, marked for that target until the turn ends.
 */

const prefix = (attackerId: string, actionId: string) => `${attackerId}:follow-up:${actionId}:`;

/** Marks the hit's follow-up: one more `actionId` this turn, against `targetId` only, opened once the economy has
 *  written the turn's action (`openFollowUps`). */
export function openFollowUp(state: GameState, attackerId: string, actionId: string, targetId: string): void {
  if (!state.combat.active || state.combat.turnActorId !== attackerId) return;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      turnUses: { ...state.combat.turn.turnUses, [`${prefix(attackerId, actionId)}${targetId}`]: 1 }
    }
  };
}

/** Adds each marked follow-up to the turn's open action as a place of its own; each is opened once. */
export function openFollowUps(state: GameState, attackerId: string): void {
  const head = `${attackerId}:follow-up:`;
  const marked = Object.entries(state.combat.turn.turnUses).filter(
    ([key, value]) => key.startsWith(head) && value === 1
  );
  if (marked.length === 0) return;
  const open = state.combat.turn.actionInstance;
  const components: Record<string, number> = open && open.actorId === attackerId ? { ...open.components } : {};
  const turnUses = { ...state.combat.turn.turnUses };
  for (const [key] of marked) {
    const actionId = key.slice(head.length).split(":")[0]!;
    components[actionId] = (components[actionId] ?? 0) + 1;
    turnUses[key] = 2;
  }
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      actionInstance:
        open && open.actorId === attackerId ? { ...open, components } : { actorId: attackerId, components },
      turnUses
    }
  };
}

/** Why this use of a follow-up action can't go at these targets: once the turn's action is spent, the place it holds
 *  is for the creature its hit named. Null when it can. */
export function followUpViolation(
  state: GameState,
  attacker: Readonly<{ id: string; name: string }>,
  action: Readonly<{ id: string; name: string }>,
  targetIds: readonly string[]
): Readonly<{ rule: RuleId; message: string }> | null {
  if (!state.combat.turn.actionUsed || state.combat.turnActorId !== attacker.id) return null;
  const head = prefix(attacker.id, action.id);
  const allowed = Object.keys(state.combat.turn.turnUses)
    .filter((key) => key.startsWith(head))
    .map((key) => key.slice(head.length));
  if (allowed.length === 0 || targetIds.every((id) => allowed.includes(id))) return null;
  const names = allowed
    .map((id) => state.actors.find((actor) => actor.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  return {
    rule: "target.not-allowed",
    message: `${attacker.name} can make this ${action.name} only against ${names.join(" or ") || "the creature its hit knocked down"}.`
  };
}
