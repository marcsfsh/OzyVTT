import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { requireActorAccess, requireGm, type Initiator } from "./authorization.js";
import { actionPools, effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { startTimedPool } from "./clock-pools.js";
import { CommandRejectedError } from "./game-store.js";

type PoolDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  /** The server's dice, for the wait a pool spent for a time rolls on its first use. */
  random?: (sides: number) => number;
}>;

/** The actor and one of its limited-use pools, keyed as the counters are (`uses.pool ?? action.id`). A pool that
 *  resets every turn lives on the turn's state, apart from the actor, so it is spent only by using it. */
function poolOn(state: GameState, actorId: string, poolId: string, deps: PoolDeps) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const pool = actionPools(effectiveActions(definition, actor, deps.catalog)).find((entry) => entry.id === poolId);
  if (!pool) throw new CommandRejectedError(`${actor.name} has no limited-use pool called "${poolId}".`);
  if (pool.per === "turn")
    throw new CommandRejectedError(`${pool.name} comes back every turn. It is spent by using it.`);
  return { actor, pool, spent: actor.actionUses[poolId] ?? 0 };
}

/** Spends several uses of a pool at once (Lay on Hands' points, Focus Points for a feature the engine can't run).
 *  The actor's player or the GM; refused when the pool holds fewer. */
export function spendUses(
  state: GameState,
  actorId: string,
  poolId: string,
  amount: number,
  scope: Initiator,
  deps: PoolDeps
): Readonly<{ name: string; left: number; line: string | null }> {
  requireActorAccess(scope, state, actorId, "resource");
  const { actor, pool, spent } = poolOn(state, actorId, poolId, deps);
  const left = Math.max(0, pool.limit - spent);
  if (amount > left)
    throw new CommandRejectedError(left === 0 ? `${pool.name} has none left.` : `${pool.name} has ${left} left.`);
  actor.actionUses = { ...actor.actionUses, [poolId]: spent + amount };
  // A pool spent for a time starts its wait now (Wings of Flying's 1d12 hours).
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const afterHours = effectiveActions(definition, actor, deps.catalog).find(
    (action) => (action.uses?.pool ?? action.id) === poolId && action.uses?.per === "time"
  )?.uses?.afterHours;
  const line =
    afterHours && deps.random ? startTimedPool(state, actor, poolId, pool.name, afterHours, deps.random) : null;
  return { name: pool.name, left: left - amount, line };
}

/** The GM gives back up to `amount` spent uses (a feature that refills a pool, a ruling). A full pool is refused. */
export function restoreUses(
  state: GameState,
  actorId: string,
  poolId: string,
  amount: number,
  scope: Initiator,
  deps: PoolDeps
): Readonly<{ name: string; restored: number; left: number }> {
  requireGm(scope, "Only the GM gives uses back.");
  const { actor, pool, spent } = poolOn(state, actorId, poolId, deps);
  if (spent === 0) throw new CommandRejectedError(`${actor.name}'s ${pool.name} is already full.`);
  const restored = Math.min(amount, spent);
  const { [poolId]: _spent, ...others } = actor.actionUses;
  actor.actionUses = spent - restored > 0 ? { ...others, [poolId]: spent - restored } : others;
  // A pool given back whole waits on nothing.
  if (spent - restored === 0 && actor.readyAt[poolId]) {
    const { [poolId]: _ready, ...waiting } = actor.readyAt;
    actor.readyAt = waiting;
  }
  return { name: pool.name, restored, left: pool.limit - (spent - restored) };
}
