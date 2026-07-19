import type { ActionResolution, GameState } from "@vtt/domain";
import type { RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { adjustableActor, applyDamageDetailed, type ActorScope } from "./hit-points.js";
import type { EffectNarration } from "./effects.js";
import { resolveDefinitionAction } from "./action-resolution.js";
import { builtinAction } from "./builtin-actions.js";

export type ReactionAnswerDependencies = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** Dice/roll plumbing for leaves-reach answers, which resolve a real melee attack. */
  random: RandomSource;
  newRollId: () => string;
  gmSessionId: string;
  now: () => string;
}>;
export type ReactionOutcome = Readonly<{
  used: boolean;
  appliedDamage: number;
  actorId: string;
  actorName: string;
  actionName: string;
  sourceName: string;
  proposedDamage: number;
  kind: "hit-by-attack" | "leaves-reach";
  /** The opportunity attack's full resolution when a leaves-reach prompt was used. */
  resolution?: ActionResolution;
  events: readonly EffectNarration[];
}>;

/**
 * Answer a pending reaction prompt (ADR-0020 amendment).
 *
 * hit-by-attack (Uncanny Dodge): the triggering attack's damage was parked on the prompt, so BOTH
 * answers apply it here — "use" spends the reaction and halves each typed part first (floor, per
 * part, before defenses). GM answers any prompt; a player only their own claimed character's.
 *
 * leaves-reach (opportunity attack): "use" spends the reaction and resolves one melee attack
 * (chosen actionId, else the reactor's first melee attack, else Unarmed Strike) against the mover,
 * auto-applying rolled damage on a hit — the reaction carve-out class. "decline" just clears.
 */
export function answerReaction(state: GameState, commandId: string, reactionId: string, use: boolean, actionId: string | undefined, scope: ActorScope, deps: ReactionAnswerDependencies): ReactionOutcome {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter.");
  const pending = state.combat.pendingReactions.find((entry) => entry.id === reactionId);
  if (!pending) throw new CommandRejectedError("That reaction prompt was already answered or dismissed.");
  const reactor = adjustableActor(state, pending.actorId, scope);
  if (use && state.combat.reactionsUsed.includes(reactor.id)) {
    throw new CommandRejectedError(`${reactor.name} has already used a reaction this round. Decline instead, or free the reaction first.`);
  }

  const base = { actorId: reactor.id, actorName: reactor.name, actionName: pending.actionName, sourceName: pending.sourceName, proposedDamage: pending.proposedDamage, kind: pending.kind };
  const clearPrompt = (markUsed: boolean) => {
    state.combat = {
      ...state.combat,
      pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId),
      ...(markUsed ? { reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== reactor.id), reactor.id] } : {})
    };
  };

  if (pending.kind === "leaves-reach") {
    if (!use) { clearPrompt(false); return { ...base, used: false, appliedDamage: 0, events: [] }; }
    const mover = pending.targetActorId ? state.actors.find((candidate) => candidate.id === pending.targetActorId) : undefined;
    if (!mover) { clearPrompt(false); throw new CommandRejectedError("The mover is no longer in the fight."); }
    const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
    const declared = actionId ? definition?.actions.find((candidate) => candidate.id === actionId) : undefined;
    const fallbackMelee = definition?.actions.find((candidate) => candidate.attack !== undefined && candidate.attack.reachFeet !== undefined);
    const chosen = declared ?? fallbackMelee ?? builtinAction("unarmed-strike")!;
    const isBuiltin = declared === undefined && fallbackMelee === undefined;
    clearPrompt(true);
    // One melee attack against the mover, off-turn (economy stays ungated; the reaction is spent above).
    // No distance function on purpose: the SRD opportunity attack happens right before the target
    // leaves reach, but the engine moves the token first (documented arrival-timing approximation) —
    // range-checking the mover's ARRIVAL position would wrongly block the swing it already provoked.
    const resolution = resolveDefinitionAction(state, chosen, { actorId: reactor.id, targetIds: [mover.id], commandId, builtin: isBuiltin, rollMode: null, override: null }, {
      random: deps.random, newRollId: deps.newRollId, gmSessionId: deps.gmSessionId, now: deps.now,
      definition, resolveDefinition: deps.resolveDefinition
    });
    let appliedDamage = 0;
    let events: readonly EffectNarration[] = [];
    // Auto-apply the hit's damage — unless the resolve itself parked it on a NEW prompt (the mover's
    // own Uncanny Dodge answers opportunity attacks too).
    const parked = (resolution.reactionPrompts?.length ?? 0) > 0;
    if (!parked && resolution.attack && (resolution.attack.outcome === "hit" || resolution.attack.outcome === "crit") && resolution.damageTotal > 0) {
      const parts = [
        ...resolution.damage.map((part) => ({ amount: part.total, type: part.type })),
        ...(resolution.bonusDamage ?? []).map((part) => ({ amount: part.amount, type: part.type }))
      ].filter((part) => part.amount > 0);
      const outcome = applyDamageDetailed(state, mover.id, { amount: resolution.damageTotal, parts, critical: resolution.crit, sourceName: `${reactor.name}'s ${chosen.name} (opportunity attack)` }, { role: "gm" }, { resolveDefinition: deps.resolveDefinition, newId: deps.newRollId, now: deps.now });
      appliedDamage = outcome.application.totalApplied;
      events = outcome.events;
    }
    return { ...base, used: true, appliedDamage, resolution, events };
  }

  const parts = use
    ? pending.proposedDamageParts.map((part) => ({ ...part, amount: Math.floor(part.amount / 2) })).filter((part) => part.amount > 0)
    : [...pending.proposedDamageParts];
  const total = parts.reduce((sum, part) => sum + part.amount, 0);

  let appliedDamage = 0;
  let events: readonly EffectNarration[] = [];
  if (total > 0) {
    const outcome = applyDamageDetailed(state, reactor.id, { amount: total, parts, critical: pending.critical, sourceName: pending.sourceName }, { role: "gm" }, { resolveDefinition: deps.resolveDefinition, newId: deps.newRollId, now: deps.now });
    appliedDamage = outcome.application.totalApplied;
    events = outcome.events;
  }
  clearPrompt(use);
  return { ...base, used: use, appliedDamage, events };
}

/** Drop a reaction prompt without applying its damage (GM housekeeping — e.g. the damage was applied manually). */
export function dismissReaction(state: GameState, reactionId: string, scope: ActorScope) {
  if (scope.role !== "gm") throw new CommandRejectedError("Only the GM can dismiss a reaction prompt.");
  if (!state.combat.pendingReactions.some((entry) => entry.id === reactionId)) throw new CommandRejectedError("That reaction prompt was already answered or dismissed.");
  state.combat = { ...state.combat, pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId) };
}
