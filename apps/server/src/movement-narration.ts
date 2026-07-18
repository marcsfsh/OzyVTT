import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import { measureGridPath } from "./map-measurement.js";
import type { TokenMapGeometry } from "./token-placement.js";

/**
 * Turns a token move into combat-log narration for the Time Machine: how far the mover went and its
 * old → new distance to every other placed combatant. Distances use the same authority as the
 * measurement tool — Chebyshev cells x distancePerCell on a calibrated grid, distancePerPixel on a
 * gridless map with a saved scale; a map with neither still narrates the move, just without numbers.
 *
 * Viewer safety is structural: the result splits into a player-visible line (only when the mover is
 * public, mentioning only public combatants) and a GM-only line that carries the hidden combatants'
 * distances — or the whole narration when the mover itself is hidden. Callers append each line with
 * the matching gmOnly flag; a player can never learn a hidden token's range from the log.
 */

type Point = Readonly<{ x: number; y: number }>;

export type MovementNarration = Readonly<{ publicText: string | null; gmText: string | null }>;

/** Distance between two image points in map units, or null when the map has no calibration and no scale. */
export function mapDistance(geometry: TokenMapGeometry, from: Point, to: Point): Readonly<{ value: number; unit: string }> | null {
  if (geometry.calibration) {
    // Tokens live on cell centers; measuring center-to-center in Chebyshev cells matches how the
    // table counts squares (and the measurement tool's default rule).
    const measured = measureGridPath(geometry.calibration, [from, to], { snapMode: "cell-center" });
    return { value: measured.totalDistance, unit: measured.unit };
  }
  if (geometry.scale) {
    return { value: Math.hypot(to.x - from.x, to.y - from.y) * geometry.scale.distancePerPixel, unit: geometry.scale.unit };
  }
  return null;
}

function formatDistance(distance: Readonly<{ value: number; unit: string }>): string {
  const rounded = distance.value >= 100 ? Math.round(distance.value) : Math.round(distance.value * 10) / 10;
  return `${rounded} ${distance.unit}`;
}

export function narrateTokenMove(input: Readonly<{
  /** Post-move state (the mutation already ran); every position in it is authoritative and snapped. */
  state: GameState;
  actorId: string;
  /** The mover's position BEFORE the mutation; null when it entered from the tray. */
  from: EncounterTokenPosition | null;
  geometry: TokenMapGeometry;
}>): MovementNarration | null {
  const { state, actorId, from, geometry } = input;
  const mover = state.actors.find((actor) => actor.id === actorId);
  if (!mover) return null;
  const to = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
  const moverHidden = mover.visibility === "gm-only";

  if (to === null) {
    if (from === null) return null; // tray-to-tray: nothing happened
    const text = `${mover.name} left the map.`;
    return moverHidden ? { publicText: null, gmText: text } : { publicText: text, gmText: null };
  }

  const moved = from === null ? null : mapDistance(geometry, from, to);
  if (from !== null && moved !== null && Math.round(moved.value * 10) === 0) return null; // snapped back to the same spot

  // Old → new range to every other placed combatant, in initiative order.
  type Range = Readonly<{ name: string; hidden: boolean; label: string }>;
  const ranges: Range[] = [];
  for (const entry of state.combat.initiative) {
    if (entry.actorId === actorId) continue;
    const other = state.actors.find((actor) => actor.id === entry.actorId);
    const position = state.combat.tokens.find((token) => token.actorId === entry.actorId)?.position ?? null;
    if (!other || position === null) continue;
    const now = mapDistance(geometry, to, position);
    if (now === null) continue; // no measurable map: narrate the move without numbers
    const before = from === null ? null : mapDistance(geometry, from, position);
    const label = before === null ? `${other.name} ${formatDistance(now)}` : `${other.name} ${formatDistance(before)} → ${formatDistance(now)}`;
    ranges.push({ name: other.name, hidden: other.visibility === "gm-only", label });
  }

  const verb = from === null
    ? `${mover.name} entered the map`
    : moved === null ? `${mover.name} moved` : `${mover.name} moved ${formatDistance(moved)}`;
  const withRanges = (list: readonly Range[]) => (list.length > 0 ? `${verb} — ${list.map((range) => range.label).join(", ")}.` : `${verb}.`);

  if (moverHidden) return { publicText: null, gmText: withRanges(ranges) };
  const visible = ranges.filter((range) => !range.hidden);
  const concealed = ranges.filter((range) => range.hidden);
  return {
    publicText: withRanges(visible),
    gmText: concealed.length > 0 ? `Hidden ranges for ${mover.name} — ${concealed.map((range) => range.label).join(", ")}.` : null
  };
}
