import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { HEADS_KEY } from "./death-traits.js";
import { traitOf } from "./statblock-traits.js";

/**
 * SRD 5.2.1 hydra, Reactive Heads: "For each head the hydra has beyond one, it gets an extra Reaction that can be used
 * only for Opportunity Attacks." Its own Reaction is spent as any creature's is; the extra ones are counted on it and
 * come back as its turn starts, as a Reaction does.
 */

type Actor = GameState["actors"][number];

/** The extra Opportunity Attack Reactions spent since the creature's turn started. */
const SPENT_KEY = "reactive-heads:spent";

/** The extra Reactions this creature has left for Opportunity Attacks this round: its living heads beyond one, less
 *  those spent. */
export function spareOpportunityReactions(
  actor: Pick<Actor, "definitionId" | "actionUses">,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): number {
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  const heads = traitOf(definition, "multiple-heads");
  if (!heads?.reactiveHeads) return 0;
  const living = actor.actionUses[HEADS_KEY] ?? heads.heads;
  return Math.max(0, living - 1 - (actor.actionUses[SPENT_KEY] ?? 0));
}

/** One extra Reaction is spent on an Opportunity Attack. */
export function spendSpareOpportunityReaction(actor: Actor): void {
  actor.actionUses = { ...actor.actionUses, [SPENT_KEY]: (actor.actionUses[SPENT_KEY] ?? 0) + 1 };
}

/** Its turn starts: the extra Reactions are its again. */
export function refreshReactiveHeads(actor: Actor | undefined): void {
  if (!actor || actor.actionUses[SPENT_KEY] === undefined) return;
  const { [SPENT_KEY]: _spent, ...rest } = actor.actionUses;
  actor.actionUses = rest;
}
