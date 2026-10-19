import type { ActorAction } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

/** How many uses one activation of `action` spends: its set cost, else one. A `chosen` cost counts one until the
 *  user picks it (`withChosenCost`), so a pool with anything left reads as available. */
export function useCostOf(action: Pick<ActorAction, "useCost">): number {
  return typeof action.useCost === "number" ? action.useCost : 1;
}

/** The action as this activation spends it: a `chosen` cost fixed to the amount the user picked (Lay on Hands'
 *  points). An amount for an action that takes none is refused, so a client can't spend more than a use. */
export function withChosenCost<T extends Pick<ActorAction, "name" | "useCost" | "conditionPicks">>(
  action: T,
  spend: number | undefined,
  conditionIds: readonly string[] = []
): T {
  if (conditionIds.length > 0 && !action.conditionPicks)
    throw new CommandRejectedError(`${action.name} ends no conditions you pick. Send none.`);
  if (action.useCost !== "chosen") {
    if (spend !== undefined) throw new CommandRejectedError(`${action.name} spends a set amount. Send no amount.`);
    return action;
  }
  if (spend === undefined) throw new CommandRejectedError(`Choose how much of ${action.name} to spend.`);
  // Restoring Touch: each condition picked costs its points on top of the Hit Points restored.
  const total = spend + conditionCost(action, conditionIds);
  if (total < 1) throw new CommandRejectedError(`Choose how much of ${action.name} to spend.`);
  return { ...action, useCost: total };
}

/** The points of an action's pool its picked conditions cost (Restoring Touch: 5 each). */
export function conditionCost(
  action: Pick<ActorAction, "conditionPicks">,
  conditionIds: readonly string[] | undefined
): number {
  return action.conditionPicks ? action.conditionPicks.pointsEach * new Set(conditionIds ?? []).size : 0;
}

/** The action as a use that places `areas` areas spends it, where each area costs a use (Ring of Shooting Stars: a
 *  charge for every mote). */
export function withAreaCost<T extends Pick<ActorAction, "area" | "useCost">>(action: T, areas: number): T {
  return action.area?.eachCostsAUse && areas >= 2 ? { ...action, useCost: areas } : action;
}

/** Why a pool can't pay for this activation when it still holds something. */
export function notEnoughUses(name: string, left: number, cost: number): string {
  return `${name} has ${left} left, and this spends ${cost}.`;
}
