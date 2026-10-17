import type { ActionResolution, GameState } from "@vtt/domain";
import { applyDamageDetailed, type DamageDeps, type DamageOutcome } from "./hit-points.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import type { ActorDefinition, DamageDrain } from "@vtt/schemas";
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
  /** Creature-to-creature distance, for the strike-back reaction the damage may open. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** The server's dice, for what the target's stat block rolls as damage lands (Undead Fortitude). */
  rollDie?: (sides: number) => number;
}>;

/** The applied result for table narration. `sourceActorId` rides along so narration includes it in `actorIds`,
 *  making the line GM-only when the attacker is hidden. */
export type AppliedDamage = Readonly<{
  outcome: DamageOutcome;
  targetId: string;
  sourceActorId: string;
  label: string;
}>;

/** A committed attack that still owes damage: a real (non-preview) swing that rolled damage, a miss included when
 *  Graze dealt some, not already parked on a reaction window (Uncanny Dodge applies it there). */
export function playerHitOwesDamage(resolution: ActionResolution): boolean {
  const attack = resolution.attack;
  return (
    attack !== null &&
    !resolution.preview &&
    resolution.damageTotal > 0 &&
    !(resolution.reactionPrompts ?? []).some((prompt) => prompt.actorId === attack.targetId)
  );
}

function isoOf(now: () => number) {
  return () => new Date(now()).toISOString();
}

function damageDepsOf(deps: PlayerDamageDeps): DamageDeps {
  return {
    resolveDefinition: deps.resolveDefinition,
    newId: deps.newId,
    now: isoOf(deps.now),
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
    ...(deps.rollDie ? { rollDie: deps.rollDie } : {})
  };
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
  deps: PlayerDamageDeps,
  drain?: DamageDrain
): AppliedDamage | null {
  const attack = resolution.attack;
  if (!attack || !playerHitOwesDamage(resolution)) return null;
  return settleOne(
    state,
    {
      targetId: attack.targetId,
      targetName: attack.targetName,
      parts: damagePartsOf(resolution),
      total: resolution.damageTotal
    },
    resolution,
    attackerName,
    sourceActorId,
    mode,
    deps,
    drain
  );
}

/** Everything a player's committed resolve owes, settled per the player-damage policy: a hit's damage, or each
 *  target's damage from an action with no attack roll and no save (Magic Missile). Returns what applied directly. */
export function settlePlayerDamage(
  state: GameState,
  resolution: ActionResolution,
  attackerName: string,
  sourceActorId: string,
  mode: "proposal" | "direct",
  deps: PlayerDamageDeps,
  drain?: DamageDrain
): AppliedDamage[] {
  if (resolution.attack) {
    const applied = settlePlayerHit(state, resolution, attackerName, sourceActorId, mode, deps, drain);
    return applied ? [applied] : [];
  }
  if (resolution.preview) return [];
  return (resolution.damageTargets ?? []).flatMap((owed) => {
    if (owed.total <= 0) return [];
    const applied = settleOne(state, owed, resolution, attackerName, sourceActorId, mode, deps, drain);
    return applied ? [applied] : [];
  });
}

/** One target's damage: applied GM-scoped in direct mode, or parked as a proposal for the GM. */
function settleOne(
  state: GameState,
  owed: NonNullable<ActionResolution["damageTargets"]>[number],
  resolution: ActionResolution,
  attackerName: string,
  sourceActorId: string,
  mode: "proposal" | "direct",
  deps: PlayerDamageDeps,
  drain?: DamageDrain
): AppliedDamage | null {
  const parts = owed.parts.map((part) => ({ amount: part.amount, type: part.type }));
  const label = `${attackerName}'s ${resolution.actionName}`;
  if (mode === "direct") {
    const outcome = applyDamageDetailed(
      state,
      owed.targetId,
      {
        amount: owed.total,
        parts,
        critical: resolution.crit,
        sourceName: label,
        sourceActorId,
        ...(drain ? { drain } : {})
      },
      { role: "gm" },
      damageDepsOf(deps)
    );
    return { outcome, targetId: owed.targetId, sourceActorId, label };
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
        targetActorId: owed.targetId,
        targetName: owed.targetName,
        proposedDamageParts: parts,
        proposedTotal: owed.total,
        critical: resolution.crit,
        ...(drain ? { drain } : {}),
        createdAt: deps.now()
      }
    ]
  };
  return null;
}

/**
 * The GM applies or dismisses a parked proposal. Apply reduces HP through the typed-defense pipeline
 * and removes the proposal; an `amount` override re-weights the proposal's typed parts to that total
 * (`rescaleDamageParts`), so resistances still apply to the edited number. Dismiss just removes it. Returns the applied outcome, or null (dismissed, overridden to nothing, or already
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
    const input = {
      amount: proposal.proposedTotal,
      parts: proposal.proposedDamageParts,
      ...(amount !== undefined ? { damageOverride: amount } : {}),
      critical: proposal.critical,
      sourceName: label,
      sourceActorId: proposal.sourceActorId,
      ...(proposal.drain ? { drain: proposal.drain } : {})
    };
    const outcome = applyDamageDetailed(state, proposal.targetActorId, input, { role: "gm" }, damageDepsOf(deps));
    applied = { outcome, targetId: proposal.targetActorId, sourceActorId: proposal.sourceActorId, label };
  }
  state.combat = {
    ...state.combat,
    pendingDamage: state.combat.pendingDamage.filter((entry) => entry.id !== proposalId)
  };
  return applied;
}
