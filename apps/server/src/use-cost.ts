import type { ActorAction } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

/** How many uses one activation of `action` spends: its set cost, else one. A `chosen` cost counts one until the
 *  user picks it (`withChosenCost`), so a pool with anything left reads as available. */
export function useCostOf(action: Pick<ActorAction, "useCost">): number {
  return typeof action.useCost === "number" ? action.useCost : 1;
}

/** What one activation spends from a pool with `spent` of `limit` used. A time pool (Boots of Speed's rounds) spends
 *  all it has left, so the use lasts that long and what is left when it ends early comes back. */
export function activationCost(
  action: Pick<ActorAction, "useCost" | "timePool">,
  spent: number,
  limit: number
): number {
  return action.timePool && spent < limit ? limit - spent : useCostOf(action);
}

/** The action as this activation spends it: a `chosen` cost fixed to the amount the user picked (Lay on Hands'
 *  points). An amount for an action that takes none is refused, so a client can't spend more than a use. */
export function withChosenCost<T extends Pick<ActorAction, "name" | "useCost">>(
  action: T,
  spend: number | undefined
): T {
  if (action.useCost !== "chosen") {
    if (spend !== undefined) throw new CommandRejectedError(`${action.name} spends a set amount. Send no amount.`);
    return action;
  }
  if (spend === undefined) throw new CommandRejectedError(`Choose how much of ${action.name} to spend.`);
  return { ...action, useCost: spend };
}

/** Why a pool can't pay for this activation when it still holds something. */
export function notEnoughUses(name: string, left: number, cost: number): string {
  return `${name} has ${left} left, and this spends ${cost}.`;
}
