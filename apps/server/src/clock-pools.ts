import { gameTimeSpanLabel, type Actor, type GameState } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition } from "@vtt/schemas";
import { effectiveActions } from "./effective-actions.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { itemRowOfAction, rollRegain } from "./item-charges.js";

/**
 * Uses that come back on the game clock (SRD magic items): a pool spent for a time comes back once that much game time
 * passes from its first use ("can't be used again until 1d12 hours have passed", Wings of Flying), and, when the GM
 * keeps the clock with a dawn hour, what an item "regains daily at dawn" comes back as the clock passes dawn. Without
 * a dawn hour, a Long Rest stands in for the day.
 */

export type ClockDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: (sides: number) => number;
}>;

/** Minutes of game time since the campaign's clock started. */
const nowOf = (state: GameState) => state.rest.clockHours * 60 + state.rest.clockMinutes;

/** A pool spent for a time starts its wait on its first use: the hours are rolled then ("1d12 hours"). Later uses
 *  before it comes back leave the wait as it is. Returns the line the table reads, or null. */
export function startTimedPool(
  state: GameState,
  actor: Actor,
  key: string,
  name: string,
  afterHours: string,
  random: (sides: number) => number
): string | null {
  return waitHours(state, actor, key, name, Math.max(1, rollRegain(afterHours, random)));
}

/** A spent timed pool waits this many hours from now (a figurine's days from when it reverts). Returns the line the
 *  table reads, or null when it already waits. */
export function waitHours(state: GameState, actor: Actor, key: string, name: string, hours: number): string | null {
  if (actor.readyAt[key] !== undefined) return null;
  actor.readyAt = { ...actor.readyAt, [key]: { minute: nowOf(state) + hours * 60, name } };
  return `${name} can be used again in ${gameTimeSpanLabel(hours * 60)}.`;
}

/** How long until a spent timed pool comes back, in words ("5 hours"); null when it waits on nothing. */
export function readyIn(state: GameState, actor: Pick<Actor, "readyAt">, key: string): string | null {
  const ready = actor.readyAt?.[key];
  if (!ready) return null;
  return gameTimeSpanLabel(Math.max(1, ready.minute - nowOf(state)));
}

/** The pools whose time is up come back, for the creatures time passed for. */
export function rearmTimedPools(state: GameState, actorIds: ReadonlySet<string>): EffectNarration[] {
  const now = nowOf(state);
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    if (!actorIds.has(actor.id)) continue;
    const due = Object.entries(actor.readyAt).filter(([, ready]) => ready.minute <= now);
    if (due.length === 0) continue;
    const uses = { ...actor.actionUses };
    const waiting = { ...actor.readyAt };
    for (const [key, ready] of due) {
      delete uses[key];
      delete waiting[key];
      events.push({ kind: "effect", text: `${actor.name}'s ${ready.name} can be used again.`, actorId: actor.id });
    }
    actor.actionUses = uses;
    actor.readyAt = waiting;
  }
  return events;
}

/** How many dawns the clock passes going from `from` to `to` minutes, dawn coming at `hour`:00 each day. */
export function dawnsBetween(from: number, to: number, hour: number): number {
  const day = 24 * 60;
  const first = Math.floor((from - hour * 60) / day);
  const last = Math.floor((to - hour * 60) / day);
  return Math.max(0, last - first);
}

/** An item's pools that come back each day (its long-rest pools), with the dice its record regains them by. */
function dawnPools(actor: Actor, definition: ActorDefinition | undefined, catalog: EquipmentCatalog | undefined) {
  const pools = new Map<string, { name: string; regain: string | undefined }>();
  for (const action of effectiveActions(definition, actor, catalog)) {
    if (action.uses?.per !== "long-rest") continue;
    const item = itemRowOfAction(action.id, actor.inventory);
    if (!item) continue;
    const key = action.uses.pool ?? action.id;
    if (pools.has(key)) continue;
    pools.set(key, { name: item.name, regain: catalog?.equipmentRecord(catalogIdOf(item))?.charges?.regain });
  }
  return pools;
}

/** The keys of a creature's item pools that come back at dawn, which a Long Rest leaves to the dawn when the GM keeps
 *  a dawn hour. */
export function dawnPoolKeys(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): ReadonlySet<string> {
  return new Set(dawnPools(actor, definition, catalog).keys());
}

/** What comes back at each dawn the clock passes: each item pool regains its printed dice, or every charge. */
export function dawnRegains(state: GameState, actorIds: ReadonlySet<string>, dawns: number, deps: ClockDeps) {
  const events: EffectNarration[] = [];
  if (dawns <= 0) return events;
  for (const actor of state.actors) {
    if (!actorIds.has(actor.id)) continue;
    const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
    const uses = { ...actor.actionUses };
    for (const [key, pool] of dawnPools(actor, definition, deps.catalog)) {
      const spent = uses[key] ?? 0;
      if (spent === 0) continue;
      let back = 0;
      for (let dawn = 0; dawn < dawns && back < spent; dawn++)
        back += pool.regain ? rollRegain(pool.regain, deps.random) : spent;
      back = Math.min(spent, back);
      if (spent - back > 0) uses[key] = spent - back;
      else delete uses[key];
      events.push({
        kind: "effect",
        text: `Dawn: ${pool.name} regains ${back} expended charge${back === 1 ? "" : "s"}${pool.regain ? ` (${pool.regain})` : ""}.`,
        actorId: actor.id
      });
    }
    actor.actionUses = uses;
  }
  return events;
}

/** The spent counts a rest leaves alone: pools that come back after a time, which only the clock gives back. */
export function timedSpent(actor: Actor): Record<string, number> {
  return Object.fromEntries(
    Object.keys(actor.readyAt)
      .filter((key) => (actor.actionUses[key] ?? 0) > 0)
      .map((key) => [key, actor.actionUses[key]!])
  );
}
