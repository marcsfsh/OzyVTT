import type { ActionResolution, GameState } from "@vtt/domain";
import { applyDamageDetailed, type DamageOutcome } from "./hit-points.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import type { ActorDefinition } from "@vtt/schemas";
import { damagePartsOf } from "./resolution/damage.js";

/** A player's confirmed hit never touches an enemy's HP through the client. The server is the only
 *  writer: in "proposal" mode (default) the typed damage is parked for the GM to confirm; in "direct"
 *  mode (GM opt-in) it applies immediately, GM-scoped. The GM's own resolves never come here (ADR-0021). */

/** Clock and definition lookup for applying parked/direct damage through the typed-defense pipeline. */
export type PlayerDamageDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  newId: () => string;
  /** Milliseconds since epoch (injected for deterministic tests). */
  now: () => number;
  /** The item catalog, so a target's item-granted resistances and immunities reach the damage math. */
  catalog?: EquipmentCatalog;
}>;

/** The applied result for table narration. `sourceActorId` rides along so narration includes it in `actorIds`,
 *  making the line GM-only when the attacker is hidden. */
export type AppliedDamage = Readonly<{
  outcome: DamageOutcome;
  targetId: string;
  sourceActorId: string;
  label: string;
}>;

/** A committed hit that still owes damage: a real (non-preview) hit that rolled damage not already parked
 *  on a reaction window (Uncanny Dodge applies it there). */
export function playerHitOwesDamage(resolution: ActionResolution): boolean {
  const attack = resolution.attack;
  return (
    attack !== null &&
    !resolution.preview &&
    (attack.outcome === "hit" || attack.outcome === "crit" || attack.outcome === "unknown") &&
    resolution.damageTotal > 0 &&
    !(resolution.reactionPrompts ?? []).some((prompt) => prompt.actorId === attack.targetId)
  );
}

function isoOf(now: () => number) {
  return () => new Date(now()).toISOString();
}

/** Settles a player's confirmed hit per the player-damage policy, mutating `state` (parks a proposal or
 *  applies the damage GM-scoped). Returns the applied outcome in direct mode, or null when parked or not
 *  a qualifying hit. */
export function settlePlayerHit(
  state: GameState,
  resolution: ActionResolution,
  attackerName: string,
  sourceActorId: string,
  mode: "proposal" | "direct",
  deps: PlayerDamageDeps
): AppliedDamage | null {
  const attack = resolution.attack;
  if (!attack || !playerHitOwesDamage(resolution)) return null;
  const parts = damagePartsOf(resolution);
  const label = `${attackerName}'s ${resolution.actionName}`;
  if (mode === "direct") {
    const outcome = applyDamageDetailed(
      state,
      attack.targetId,
      { amount: resolution.damageTotal, parts, critical: resolution.crit, sourceName: label },
      { role: "gm" },
      {
        resolveDefinition: deps.resolveDefinition,
        newId: deps.newId,
        now: isoOf(deps.now),
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }
    );
    return { outcome, targetId: attack.targetId, sourceActorId, label };
  }
  state.combat = {
    ...state.combat,
    pendingDamage: [
      ...state.combat.pendingDamage,
      {
        id: deps.newId(),
        sourceActorId,
        sourceName: attackerName,
        actionName: resolution.actionName,
        targetActorId: attack.targetId,
        targetName: attack.targetName,
        proposedDamageParts: parts,
        proposedTotal: resolution.damageTotal,
        critical: resolution.crit,
        createdAt: deps.now()
      }
    ]
  };
  return null;
}

/**
 * The GM applies or dismisses a parked proposal. Apply reduces HP through the typed-defense pipeline
 * (an `amount` override applies as a bare total, no defense math) and removes the proposal; dismiss
 * just removes it. Returns the applied outcome, or null (dismissed, overridden to nothing, or already
 * resolved; idempotent).
 */
export function resolvePendingDamage(
  state: GameState,
  proposalId: string,
  apply: boolean,
  amount: number | undefined,
  deps: PlayerDamageDeps
): AppliedDamage | null {
  const proposal = state.combat.pendingDamage.find((entry) => entry.id === proposalId);
  if (!proposal) return null; // already resolved or dismissed - idempotent retry
  let applied: AppliedDamage | null = null;
  if (apply) {
    const label = `${proposal.sourceName}'s ${proposal.actionName}`;
    const input =
      amount !== undefined
        ? { amount, critical: proposal.critical, sourceName: label }
        : {
            amount: proposal.proposedTotal,
            parts: proposal.proposedDamageParts,
            critical: proposal.critical,
            sourceName: label
          };
    const outcome = applyDamageDetailed(
      state,
      proposal.targetActorId,
      input,
      { role: "gm" },
      {
        resolveDefinition: deps.resolveDefinition,
        newId: deps.newId,
        now: isoOf(deps.now),
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }
    );
    applied = { outcome, targetId: proposal.targetActorId, sourceActorId: proposal.sourceActorId, label };
  }
  state.combat = {
    ...state.combat,
    pendingDamage: state.combat.pendingDamage.filter((entry) => entry.id !== proposalId)
  };
  return applied;
}
