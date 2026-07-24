import type { ActionResolution, GameState } from "@vtt/domain";
import { applyDamageDetailed, type DamageOutcome } from "./hit-points.js";
import type { ActorDefinition } from "@vtt/schemas";

/**
 * A player's own confirmed hit never touches an enemy's HP through the client (roles invariant). The
 * server is the only writer: in "proposal" mode (the default) the typed damage is parked as a GM-confirmed
 * proposal; in "direct" mode - which the GM opts the table into - it applies immediately, still GM-scoped.
 * The GM's own resolves keep the runner's explicit Apply and never reach here. See ADR-0021 decision #4.
 */

/** Shared clock + definition lookup for applying the parked/direct damage through the typed-defense pipeline. */
export type PlayerDamageDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  newId: () => string;
  /** Milliseconds since epoch (injected for deterministic tests). */
  now: () => number;
}>;

/** The applied result surfaced for table narration (direct mode / GM apply). */
export type AppliedDamage = Readonly<{ outcome: DamageOutcome; targetId: string; label: string }>;

/** Typed damage components (attack dice + bonus lines) of a resolution, for parking or applying. */
export function resolutionDamageParts(resolution: ActionResolution): Array<{ amount: number; type: string }> {
  return [
    ...resolution.damage.map((part) => ({ amount: part.total, type: part.type })),
    ...(resolution.bonusDamage ?? []).map((part) => ({ amount: part.amount, type: part.type }))
  ].filter((part) => part.amount > 0);
}

/**
 * A committed hit that still owes damage to the target: a real (non-preview) attack that hit and rolled
 * damage, and whose damage is NOT already parked on a reaction window (Uncanny Dodge applies it there).
 */
export function playerHitOwesDamage(resolution: ActionResolution): boolean {
  const attack = resolution.attack;
  return attack !== null
    && !resolution.preview
    && (attack.outcome === "hit" || attack.outcome === "crit" || attack.outcome === "unknown")
    && resolution.damageTotal > 0
    && !(resolution.reactionPrompts ?? []).some((prompt) => prompt.actorId === attack.targetId);
}

function isoOf(now: () => number) {
  return () => new Date(now()).toISOString();
}

/**
 * Settle a player's confirmed hit per the table's player-damage policy. Mutates `state` (parks a proposal,
 * or applies the typed damage GM-scoped). Returns the applied outcome for narration in direct mode, or null
 * when the hit was parked (proposal mode) or is not a qualifying hit (miss/preview/reaction-owned).
 */
export function settlePlayerHit(state: GameState, resolution: ActionResolution, attackerName: string, sourceActorId: string, mode: "proposal" | "direct", deps: PlayerDamageDeps): AppliedDamage | null {
  const attack = resolution.attack;
  if (!attack || !playerHitOwesDamage(resolution)) return null;
  const parts = resolutionDamageParts(resolution);
  const label = `${attackerName}'s ${resolution.actionName}`;
  if (mode === "direct") {
    const outcome = applyDamageDetailed(state, attack.targetId, { amount: resolution.damageTotal, parts, critical: resolution.crit, sourceName: label }, { role: "gm" }, { resolveDefinition: deps.resolveDefinition, newId: deps.newId, now: isoOf(deps.now) });
    return { outcome, targetId: attack.targetId, label };
  }
  state.combat = { ...state.combat, pendingDamage: [...state.combat.pendingDamage, { id: deps.newId(), sourceActorId, sourceName: attackerName, actionName: resolution.actionName, targetActorId: attack.targetId, targetName: attack.targetName, proposedDamageParts: parts, proposedTotal: resolution.damageTotal, critical: resolution.crit, createdAt: deps.now() }] };
  return null;
}

/**
 * The GM applies or dismisses a parked proposal (proposal mode). Mutates `state`: on apply, reduces the
 * target's HP through the typed-defense pipeline (an `amount` override applies as a bare total, no defense
 * math), then removes the proposal; dismiss just removes it. Returns the applied outcome for narration, or
 * null (dismissed, overridden-to-nothing, or an already-resolved id - idempotent).
 */
export function resolvePendingDamage(state: GameState, proposalId: string, apply: boolean, amount: number | undefined, deps: PlayerDamageDeps): AppliedDamage | null {
  const proposal = state.combat.pendingDamage.find((entry) => entry.id === proposalId);
  if (!proposal) return null; // already resolved or dismissed - idempotent retry
  let applied: AppliedDamage | null = null;
  if (apply) {
    const label = `${proposal.sourceName}'s ${proposal.actionName}`;
    const input = amount !== undefined
      ? { amount, critical: proposal.critical, sourceName: label }
      : { amount: proposal.proposedTotal, parts: proposal.proposedDamageParts, critical: proposal.critical, sourceName: label };
    const outcome = applyDamageDetailed(state, proposal.targetActorId, input, { role: "gm" }, { resolveDefinition: deps.resolveDefinition, newId: deps.newId, now: isoOf(deps.now) });
    applied = { outcome, targetId: proposal.targetActorId, label };
  }
  state.combat = { ...state.combat, pendingDamage: state.combat.pendingDamage.filter((entry) => entry.id !== proposalId) };
  return applied;
}
