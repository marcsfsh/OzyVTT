import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { adjustableActor, applyDamageDetailed, type ActorScope } from "./hit-points.js";
import type { EffectNarration } from "./effects.js";

export type ReactionAnswerDependencies = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
}>;
export type ReactionOutcome = Readonly<{
  used: boolean;
  appliedDamage: number;
  actorId: string;
  actorName: string;
  actionName: string;
  sourceName: string;
  proposedDamage: number;
  events: readonly EffectNarration[];
}>;

/**
 * Answer a pending reaction prompt (ADR-0020 amendment). The triggering attack's damage was parked
 * on the prompt instead of being applied, so BOTH answers apply it here — "use" spends the reaction
 * and halves each typed part first (floor, per part, before defenses: Uncanny Dodge halves the
 * attack's damage, then resistance still applies on top). GM answers any prompt; a player only
 * their own claimed character's.
 */
export function answerReaction(state: GameState, reactionId: string, use: boolean, scope: ActorScope, deps: ReactionAnswerDependencies): ReactionOutcome {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter.");
  const pending = state.combat.pendingReactions.find((entry) => entry.id === reactionId);
  if (!pending) throw new CommandRejectedError("That reaction prompt was already answered or dismissed.");
  const reactor = adjustableActor(state, pending.actorId, scope);
  if (use && state.combat.reactionsUsed.includes(reactor.id)) {
    throw new CommandRejectedError(`${reactor.name} has already used a reaction this round. Decline instead, or free the reaction first.`);
  }

  const parts = use
    ? pending.proposedDamageParts.map((part) => ({ ...part, amount: Math.floor(part.amount / 2) })).filter((part) => part.amount > 0)
    : [...pending.proposedDamageParts];
  const total = parts.reduce((sum, part) => sum + part.amount, 0);

  let appliedDamage = 0;
  let events: readonly EffectNarration[] = [];
  if (total > 0) {
    const outcome = applyDamageDetailed(state, reactor.id, { amount: total, parts, critical: pending.critical, sourceName: pending.sourceName }, { role: "gm" }, { resolveDefinition: deps.resolveDefinition });
    appliedDamage = outcome.application.totalApplied;
    events = outcome.events;
  }
  state.combat = {
    ...state.combat,
    pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId),
    ...(use ? { reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== reactor.id), reactor.id] } : {})
  };
  return { used: use, appliedDamage, actorId: reactor.id, actorName: reactor.name, actionName: pending.actionName, sourceName: pending.sourceName, proposedDamage: pending.proposedDamage, events };
}

/** Drop a reaction prompt without applying its damage (GM housekeeping — e.g. the damage was applied manually). */
export function dismissReaction(state: GameState, reactionId: string, scope: ActorScope) {
  if (scope.role !== "gm") throw new CommandRejectedError("Only the GM can dismiss a reaction prompt.");
  if (!state.combat.pendingReactions.some((entry) => entry.id === reactionId)) throw new CommandRejectedError("That reaction prompt was already answered or dismissed.");
  state.combat = { ...state.combat, pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId) };
}
