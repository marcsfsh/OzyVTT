import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import type { MoveMode } from "@vtt/domain/commands";
import { verticalEdgeCells } from "@vtt/rules-5e";
import { imageToGrid } from "./grid-calibration.js";
import { measureGridPath } from "./map-measurement.js";
import type { TokenMapGeometry } from "./token-placement.js";

/**
 * Turns a token move into combat-log narration: how far the mover went and its old → new distance to
 * every other placed combatant. Distances match the measurement tool (Chebyshev cells x distancePerCell
 * on a calibrated grid, distancePerPixel on a scaled gridless map); an unmeasurable map narrates
 * without numbers.
 *
 * Viewer safety: the result splits into a player-visible line (only when the mover is public; it names
 * only public combatants) and a GM-only line with hidden combatants' distances, or the whole narration
 * when the mover is hidden. A player can never learn a hidden token's range from the log.
 */

type Point = Readonly<{ x: number; y: number }>;

export type MovementNarration = Readonly<{ publicText: string | null; gmText: string | null }>;

const MODE_VERBS: Readonly<Record<MoveMode, string>> = {
  walk: "moved",
  fly: "flew",
  swim: "swam",
  climb: "climbed",
  burrow: "burrowed",
  teleport: "teleported",
  forced: "was moved"
};

/** Tolerance (feet) for reach/range/opportunity-attack comparisons. Stored positions and grid round-trips
 *  can put an adjacent creature at 5.0001 ft; on a grid the smallest real gap beyond reach is a whole
 *  cell (≥ 2.5 ft), so 0.1 ft absorbs the noise without masking a real step. */
export const DISTANCE_TOLERANCE_FEET = 0.1;

/** Distance between two image points in map units, or null when the map has no calibration and no scale. */
export function mapDistance(
  geometry: TokenMapGeometry,
  from: Point,
  to: Point
): Readonly<{ value: number; unit: string }> | null {
  if (geometry.calibration) {
    // Tokens sit on cell centers; Chebyshev center-to-center matches how the table counts squares.
    const measured = measureGridPath(geometry.calibration, [from, to], { snapMode: "cell-center" });
    return { value: measured.totalDistance, unit: measured.unit };
  }
  if (geometry.scale) {
    return {
      value: Math.hypot(to.x - from.x, to.y - from.y) * geometry.scale.distancePerPixel,
      unit: geometry.scale.unit
    };
  }
  return null;
}

/** How far a move went, its rise or fall included: by the grid's diagonal rule on a grid (the larger of the two), and
 *  straight through the air on a gridless map. */
export function moveDistance(
  geometry: TokenMapGeometry,
  from: Point,
  to: Point,
  riseFeet: number
): Readonly<{ value: number; unit: string }> | null {
  const across = mapDistance(geometry, from, to);
  if (!across || riseFeet === 0) return across;
  const rise = Math.abs(riseFeet);
  return geometry.calibration
    ? { value: Math.max(across.value, rise), unit: across.unit }
    : { value: Math.hypot(across.value, rise), unit: across.unit };
}

/** A creature's space on the map: where it stands, how wide it is, and how high above the ground (absent: on it). */
export type CreatureFootprint = Readonly<{ position: Point; sizeCells: number; sizePx: number; altitudeFeet?: number }>;

/** Feet per square of height on a gridless map, where a creature's space is as tall as the SRD's size table says. */
const GRIDLESS_FEET_PER_CELL = 5;

/**
 * Rules-facing distance between two creatures, edge to edge (SRD: from the nearest point of each
 * creature's space), so Medium adjacent to Large (2x2) is 5 ft away. Grid maps subtract each
 * footprint's half-width in cells; scaled gridless maps subtract each token's radius beyond its central
 * cell. Height counts too: on a grid by the same diagonal rule as the floor (the larger of the two counts), on a
 * gridless map straight through the air. Null when unmeasurable.
 */
export function creatureDistance(
  geometry: TokenMapGeometry,
  a: CreatureFootprint,
  b: CreatureFootprint
): Readonly<{ value: number; unit: string }> | null {
  // Round to 0.01 ft so floating-point noise can't put an adjacent creature out of reach.
  const clean = (value: number, unit: string) => ({ value: Math.round(value * 100) / 100, unit });
  if (geometry.calibration) {
    const gridA = imageToGrid(geometry.calibration, a.position);
    const gridB = imageToGrid(geometry.calibration, b.position);
    const centerCells = Math.max(Math.abs(gridA.column - gridB.column), Math.abs(gridA.row - gridB.row));
    const edgeCells = Math.max(
      0,
      centerCells - (Math.max(1, a.sizeCells) - 1) / 2 - (Math.max(1, b.sizeCells) - 1) / 2
    );
    const upCells = verticalEdgeCells(a, b, geometry.calibration.distancePerCell);
    return clean(Math.max(edgeCells, upCells) * geometry.calibration.distancePerCell, "ft");
  }
  if (geometry.scale) {
    const beyondCentralCell = (footprint: CreatureFootprint) =>
      (footprint.sizePx - footprint.sizePx / Math.max(1, footprint.sizeCells)) / 2;
    const centerPx = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    const across =
      Math.max(0, centerPx - beyondCentralCell(a) - beyondCentralCell(b)) * geometry.scale.distancePerPixel;
    const up = verticalEdgeCells(a, b, GRIDLESS_FEET_PER_CELL) * GRIDLESS_FEET_PER_CELL;
    return clean(Math.hypot(across, up), geometry.scale.unit);
  }
  return null;
}

/** A token's space as `creatureDistance` measures it, at `position` (where it stands, or a point it passes). */
export function footprintOf(
  token: Readonly<{ sizeCells?: number; sizePx: number; altitudeFeet?: number }>,
  position: Point,
  altitudeFeet = token.altitudeFeet
): CreatureFootprint {
  return {
    position,
    sizeCells: token.sizeCells ?? 1,
    sizePx: token.sizePx,
    ...(altitudeFeet ? { altitudeFeet } : {})
  };
}

/** creatureDistance from encounter-token lookups: null when either combatant is unplaced. */
export function tokenCreatureDistance(
  state: GameState,
  geometry: TokenMapGeometry,
  actorIdA: string,
  actorIdB: string
): Readonly<{ value: number; unit: string }> | null {
  const tokenA = state.combat.tokens.find((token) => token.actorId === actorIdA);
  const tokenB = state.combat.tokens.find((token) => token.actorId === actorIdB);
  if (!tokenA?.position || !tokenB?.position) return null;
  return creatureDistance(geometry, footprintOf(tokenA, tokenA.position), footprintOf(tokenB, tokenB.position));
}

function formatDistance(distance: Readonly<{ value: number; unit: string }>): string {
  const rounded = distance.value >= 100 ? Math.round(distance.value) : Math.round(distance.value * 10) / 10;
  return `${rounded} ${distance.unit}`;
}

export function narrateTokenMove(
  input: Readonly<{
    /** Post-move state (the mutation already ran); every position in it is snapped and authoritative. */
    state: GameState;
    actorId: string;
    /** The mover's position before the mutation; null when it entered from the tray. */
    from: EncounterTokenPosition | null;
    geometry: TokenMapGeometry;
    /** How it travelled, for the verb ("flew", "teleported"); walking when absent. */
    mode?: MoveMode;
    /** It crawled, being Prone. */
    crawled?: boolean;
    /** Creatures the table can't know of beyond the GM-only ones (dynamic vision: none of the party perceives them). */
    hiddenFromTable?: (actorId: string) => boolean;
    /** It was hidden from the table when it set off. The table's line then says only where it is now: where it
     *  started and how far it came would say where it hid. */
    fromHiding?: boolean;
    /** Its height before the move; on the ground when absent. */
    fromAltitudeFeet?: number;
  }>
): MovementNarration | null {
  const { state, actorId, from, geometry } = input;
  const mover = state.actors.find((actor) => actor.id === actorId);
  if (!mover) return null;
  const to = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
  const hidden = (actor: GameState["actors"][number]) =>
    actor.visibility === "gm-only" || input.hiddenFromTable?.(actor.id) === true;
  const moverHidden = hidden(mover);

  if (to === null) {
    if (from === null) return null; // tray-to-tray: nothing happened
    const text = `${mover.name} left the map.`;
    return moverHidden ? { publicText: null, gmText: text } : { publicText: text, gmText: null };
  }

  const moverToken = state.combat.tokens.find((token) => token.actorId === actorId);
  const fromAltitude = input.fromAltitudeFeet ?? 0;
  const toAltitude = moverToken?.altitudeFeet ?? 0;
  const moved = from === null ? null : moveDistance(geometry, from, to, toAltitude - fromAltitude);
  // Snapped back to the same spot at the same height: nothing happened.
  if (from !== null && moved !== null && Math.round(moved.value * 10) === 0) return null;

  // Footprint-aware ranges, so the narrated distance matches what the rules enforce.
  const moverAt = (point: Point, altitudeFeet: number) => ({
    position: point,
    sizeCells: moverToken?.sizeCells ?? 1,
    sizePx: moverToken?.sizePx ?? 0,
    ...(altitudeFeet > 0 ? { altitudeFeet } : {})
  });
  type Range = Readonly<{ name: string; hidden: boolean; label: string; nowLabel: string }>;
  const ranges: Range[] = [];
  for (const entry of state.combat.initiative) {
    if (entry.actorId === actorId) continue;
    const other = state.actors.find((actor) => actor.id === entry.actorId);
    const otherToken = state.combat.tokens.find((token) => token.actorId === entry.actorId);
    if (!other || !otherToken?.position) continue;
    const footprint = footprintOf(otherToken, otherToken.position);
    const now = creatureDistance(geometry, moverAt(to, toAltitude), footprint);
    if (now === null) continue; // no measurable map: narrate the move without numbers
    const before = from === null ? null : creatureDistance(geometry, moverAt(from, fromAltitude), footprint);
    const label =
      before === null
        ? `${other.name} ${formatDistance(now)}`
        : `${other.name} ${formatDistance(before)} → ${formatDistance(now)}`;
    ranges.push({ name: other.name, hidden: hidden(other), label, nowLabel: `${other.name} ${formatDistance(now)}` });
  }

  const how = input.crawled ? "crawled" : MODE_VERBS[input.mode ?? "walk"];
  // A change of height says where it ended up: so many feet up, or down on the ground.
  const height =
    from !== null && toAltitude !== fromAltitude ? (toAltitude > 0 ? `, ${toAltitude} ft up` : " to the ground") : "";
  const verb =
    from === null
      ? `${mover.name} entered the map${toAltitude > 0 ? `, ${toAltitude} ft up` : ""}`
      : moved === null
        ? `${mover.name} ${how}${height}`
        : `${mover.name} ${how} ${formatDistance(moved)}${height}`;
  const withRanges = (list: readonly Range[]) =>
    list.length > 0 ? `${verb} - ${list.map((range) => range.label).join(", ")}.` : `${verb}.`;

  if (moverHidden) return { publicText: null, gmText: withRanges(ranges) };
  const visible = ranges.filter((range) => !range.hidden);
  const concealed = ranges.filter((range) => range.hidden);
  if (input.fromHiding) {
    const now = visible.map((range) => range.nowLabel);
    return {
      publicText: `${mover.name} came into view${now.length > 0 ? ` - ${now.join(", ")}` : ""}.`,
      gmText: withRanges(ranges)
    };
  }
  return {
    publicText: withRanges(visible),
    gmText:
      concealed.length > 0
        ? `Hidden ranges for ${mover.name}: ${concealed.map((range) => range.label).join(", ")}.`
        : null
  };
}
