import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import { pushTokenAway, type ForcedMove } from "./forced-movement.js";
import { askToStayMounted, carryRiders } from "./mounts.js";
import { groundAlongForcedMove } from "./map-hazards.js";
import { zonesAfterMove, type ZoneDeps } from "./spell-zones.js";
import type { TokenMapGeometry } from "./token-placement.js";

/**
 * A creature moved by force meets the spell areas on its way as any mover does (SRD 5.2.1: an area acts on a creature
 * that enters it, however it gets there): pushed into Web it makes the save, through Spike Growth it takes the damage
 * for every 5 feet. The push is a straight line, walked in steps of half a cell. A mount pushed carries its riders,
 * who each save to stay on (SRD Mounted Combat). What the areas did is added to `events`; the distance moved is
 * returned, as the push returns it.
 */
export function pushThroughZones(
  state: GameState,
  input: ForcedMove,
  geometry: TokenMapGeometry,
  zones: ZoneDeps,
  events: EffectNarration[]
): ReturnType<typeof pushTokenAway> {
  const positionOf = () => state.combat.tokens.find((token) => token.actorId === input.actorId)?.position ?? null;
  const from = positionOf();
  const moved = pushTokenAway(state, input, geometry);
  const to = positionOf();
  // A mount moved against its will carries its riders, who each save to stay on.
  if (moved && from && to && (from.x !== to.x || from.y !== to.y)) {
    const riders = carryRiders(state, input.actorId, geometry);
    events.push(...askToStayMounted(state, riders, input.actorId, "its mount is moved", Date.parse(zones.now())));
  }
  const calibration = geometry.calibration;
  if (!moved || !from || !to || !calibration || (from.x === to.x && from.y === to.y)) return moved;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (calibration.cellSizePx / 2)));
  const path = Array.from({ length: steps + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps
  }));
  events.push(...zonesAfterMove(state, { moverId: input.actorId, path }, zones));
  // A trap on its way goes off as it is pushed onto it (a pit's lid).
  events.push(...groundAlongForcedMove(state, input.actorId, path, { ...zones, geometry }));
  return moved;
}
