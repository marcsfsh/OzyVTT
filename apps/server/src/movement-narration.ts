import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import { imageToGrid } from "./grid-calibration.js";
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

export type CreatureFootprint = Readonly<{ position: Point; sizeCells: number; sizePx: number }>;

/**
 * Rules-facing distance between two creatures: edge-to-edge, footprint-aware. The SRD measures from
 * the nearest point of each creature's space, so a Medium creature adjacent to a Large (2x2) one is
 * 5 ft away — not the 10 ft its center-to-center line reads (a 2x2 token centers on a grid
 * intersection). Grid maps subtract each footprint's half-width in cells; scaled gridless maps
 * subtract each token's radius beyond its central cell. Null when the map is unmeasurable.
 */
export function creatureDistance(geometry: TokenMapGeometry, a: CreatureFootprint, b: CreatureFootprint): Readonly<{ value: number; unit: string }> | null {
  if (geometry.calibration) {
    const gridA = imageToGrid(geometry.calibration, a.position);
    const gridB = imageToGrid(geometry.calibration, b.position);
    const centerCells = Math.max(Math.abs(gridA.column - gridB.column), Math.abs(gridA.row - gridB.row));
    const edgeCells = Math.max(0, centerCells - (Math.max(1, a.sizeCells) - 1) / 2 - (Math.max(1, b.sizeCells) - 1) / 2);
    return { value: edgeCells * geometry.calibration.distancePerCell, unit: "ft" };
  }
  if (geometry.scale) {
    const beyondCentralCell = (footprint: CreatureFootprint) => (footprint.sizePx - footprint.sizePx / Math.max(1, footprint.sizeCells)) / 2;
    const centerPx = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    return { value: Math.max(0, centerPx - beyondCentralCell(a) - beyondCentralCell(b)) * geometry.scale.distancePerPixel, unit: geometry.scale.unit };
  }
  return null;
}

/** creatureDistance from encounter-token lookups: null when either combatant is unplaced. */
export function tokenCreatureDistance(state: GameState, geometry: TokenMapGeometry, actorIdA: string, actorIdB: string): Readonly<{ value: number; unit: string }> | null {
  const tokenA = state.combat.tokens.find((token) => token.actorId === actorIdA);
  const tokenB = state.combat.tokens.find((token) => token.actorId === actorIdB);
  if (!tokenA?.position || !tokenB?.position) return null;
  return creatureDistance(geometry, { position: tokenA.position, sizeCells: tokenA.sizeCells ?? 1, sizePx: tokenA.sizePx }, { position: tokenB.position, sizeCells: tokenB.sizeCells ?? 1, sizePx: tokenB.sizePx });
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

  // Old → new range to every other placed combatant, in initiative order — footprint-aware, so the
  // narrated range matches what the rules engine will enforce (a Large neighbor reads 5 ft, not 10).
  const moverToken = state.combat.tokens.find((token) => token.actorId === actorId);
  const moverAt = (point: Point) => ({ position: point, sizeCells: moverToken?.sizeCells ?? 1, sizePx: moverToken?.sizePx ?? 0 });
  type Range = Readonly<{ name: string; hidden: boolean; label: string }>;
  const ranges: Range[] = [];
  for (const entry of state.combat.initiative) {
    if (entry.actorId === actorId) continue;
    const other = state.actors.find((actor) => actor.id === entry.actorId);
    const otherToken = state.combat.tokens.find((token) => token.actorId === entry.actorId);
    if (!other || !otherToken?.position) continue;
    const footprint = { position: otherToken.position, sizeCells: otherToken.sizeCells ?? 1, sizePx: otherToken.sizePx };
    const now = creatureDistance(geometry, moverAt(to), footprint);
    if (now === null) continue; // no measurable map: narrate the move without numbers
    const before = from === null ? null : creatureDistance(geometry, moverAt(from), footprint);
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
