import type { GameState, SpellZone } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import { zoneContentOf, type ZoneContent } from "./spell-zone-state.js";
import { exposed, insideTest, liveZones, zoneAction, zonesAfterMove, type ZoneDeps } from "./spell-zones.js";

type Point = Readonly<{ x: number; y: number }>;

/**
 * SRD 5.2.1 areas whose save a creature makes as it enters, and whose failure stops it: Caltrops ("it stops moving"),
 * a Hunting Trap, Web's Restrained, Ball Bearings' or Grease's Prone. The move goes as far as the first such area on
 * its way, the save is asked there, and the move waits on it as a move waits on its Opportunity Attacks
 * (`held-moves.ts`); the rest of the way is walked once the save is answered, unless the failure stopped the mover.
 */

/** Conditions a failed save leaves that end a move where it is: a Speed of 0, or lying Prone. */
const STOPPING: ReadonlySet<string> = new Set([
  "grappled",
  "restrained",
  "paralyzed",
  "petrified",
  "unconscious",
  "stunned",
  "incapacitated",
  "prone"
]);

/** Whether a zone's save, failed, stops the creature that entered it. */
export function stopsOnFailure(zone: SpellZone, content: ZoneContent): boolean {
  const save = zoneAction(zone, content)?.save;
  return (
    save !== undefined &&
    (save.speedZero === true || save.failureConditions.some((condition) => STOPPING.has(condition)))
  );
}

/**
 * Where a move first enters a standing area whose entry save, failed, stops its mover: the index of the first point of
 * the path inside it, or null. An area the mover has already met this turn, one it starts in, and an Emanation it
 * carries ask nothing. Only in a fight: outside one the GM moves each creature as the table plays it.
 */
export function stoppingEntry(
  state: GameState,
  moverId: string,
  path: readonly Point[],
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): number | null {
  if (!state.combat.active || path.length < 2) return null;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === moverId && candidate.position !== null);
  if (!token) return null;
  let first: number | null = null;
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content) continue;
    const { trigger } = content;
    if (!trigger.on.includes("enter") || trigger.on.includes("spell-end") || trigger.alerts) continue;
    if (trigger.around === "caster" && zone.casterId === moverId && !zone.anchor) continue;
    if (zone.entered.includes(moverId) || (trigger.oncePerTurn && zone.affected.includes(moverId))) continue;
    if (!stopsOnFailure(zone, content)) continue;
    if (!exposed(state, zone, trigger, deps).some((creature) => creature.id === moverId)) continue;
    const inside = insideTest(state, zone, trigger, content, deps.geometry);
    if (!inside || inside(path[0]!, token.sizeCells)) continue;
    const index = path.findIndex((point, at) => at > 0 && inside(point, token.sizeCells));
    if (index > 0 && (first === null || index < first)) first = index;
  }
  return first;
}

/** A walk through the areas on a mover's way: where it stops (the index of the point it entered a stopping area at,
 *  or null when it went the whole way), what the areas did, and the saves it now waits on. */
export type ZoneWalk = Readonly<{ stop: number | null; events: EffectNarration[]; saveIds: string[] }>;

/**
 * Walks a mover along `path` through the standing areas: up to the first area that stops it, whose save it now owes,
 * or the whole way. The areas act on it as `zonesAfterMove` does; the caller puts the token where it stops.
 */
export function walkThroughZones(state: GameState, moverId: string, path: readonly Point[], deps: ZoneDeps): ZoneWalk {
  const stop = stoppingEntry(state, moverId, path, deps);
  const walked = stop === null ? path : path.slice(0, stop + 1);
  const before = new Set(state.combat.pendingSaves.map((save) => save.id));
  const events = zonesAfterMove(state, { moverId, path: walked }, deps);
  const saveIds = state.combat.pendingSaves
    .filter((save) => !before.has(save.id) && save.targetActorId === moverId && save.zoneId !== undefined)
    .map((save) => save.id);
  // An area whose save wasn't asked (the creature spared, the area gone) doesn't hold the move.
  if (stop !== null && saveIds.length === 0) {
    const rest = walkThroughZones(state, moverId, path.slice(stop), deps);
    return {
      stop: rest.stop === null ? null : stop + rest.stop,
      events: [...events, ...rest.events],
      saveIds: rest.saveIds
    };
  }
  return { stop, events, saveIds };
}
