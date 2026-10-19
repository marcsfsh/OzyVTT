import type { EncounterToken, GameState } from "@vtt/domain";
import type { MoveMode } from "@vtt/domain/commands";
import { footprintOrigin, spaceHeightCells, spansOverlap } from "@vtt/rules-5e";
import { imageToGrid, type SquareGridCalibration } from "./grid-calibration.js";

/**
 * Height on a flat map (SRD 5.2.1 Flying, Climbing, Jumping). A token's `altitudeFeet` is how far above the ground
 * its lowest point is, and `airborne` says what holds it up in the air: flying, which the Flying rule can end with a
 * fall, or a levitation, which lowers it gently when it ends. A creature on a surface (a ledge, a wall it climbs) is
 * up without being airborne. Distances between creatures count height by the grid's diagonal rule
 * (`creatureDistance`), and a move's cost counts its rise or fall (`movementCost`).
 */

type Token = EncounterToken;

/** Feet per square of height off a grid, where a creature's space is as tall as the SRD's size table makes it wide. */
export const FEET_PER_SQUARE = 5;

export const altitudeOf = (token: Pick<Token, "altitudeFeet"> | undefined | null): number => token?.altitudeFeet ?? 0;

/** The token's height span in feet: from its lowest point to the top of its space. */
export function heightSpan(
  token: Pick<Token, "altitudeFeet" | "sizeCells">,
  feetPerCell = FEET_PER_SQUARE,
  altitudeFeet = altitudeOf(token)
): Readonly<{ low: number; high: number }> {
  return { low: altitudeFeet, high: altitudeFeet + spaceHeightCells(token.sizeCells ?? 1) * feetPerCell };
}

/** Whether two creatures' spaces share any height, so that standing in the same squares they would meet. */
export function sharesHeight(
  a: Pick<Token, "altitudeFeet" | "sizeCells">,
  b: Pick<Token, "altitudeFeet" | "sizeCells">,
  feetPerCell = FEET_PER_SQUARE,
  aAltitudeFeet = altitudeOf(a)
): boolean {
  const first = heightSpan(a, feetPerCell, aAltitudeFeet);
  const second = heightSpan(b, feetPerCell);
  return spansOverlap(first.low, first.high, second.low, second.high);
}

/** Why a move can't change the mover's height this way, or null when it can. Walking, swimming and burrowing keep a
 *  creature at its height (it flies, climbs or jumps to change it), and a creature in the air moves by flying. */
export function heightRefusal(
  name: string,
  mode: MoveMode,
  fromFeet: number,
  toFeet: number,
  airborne: Token["airborne"]
): string | null {
  if (mode === "fly" || mode === "teleport" || mode === "forced") return null;
  if (mode === "climb") return null;
  if (airborne === "fly" && fromFeet > 0) return `${name} is in the air. Fly to move it, or climb onto a surface.`;
  if (fromFeet !== toFeet)
    return `${name} can't rise or descend by ${mode === "walk" ? "walking" : mode === "swim" ? "swimming" : "burrowing"}. Fly, climb or jump to change height.`;
  return null;
}

/** What holds a creature up after a move that leaves it `toFeet` above the ground: flying keeps it in the air, a climb
 *  leaves it holding a surface, and teleporting or being moved into the air leaves it in the air with nothing under
 *  it, where the Flying rule decides whether it falls. A levitation holds it whatever it does. */
export function airborneAfter(mode: MoveMode, toFeet: number, before: Token["airborne"]): Token["airborne"] {
  if (toFeet <= 0) return undefined;
  if (before === "levitate") return "levitate";
  if (mode === "fly") return "fly";
  if (mode === "climb") return undefined;
  if (mode === "teleport" || mode === "forced") return before ?? "fly";
  return before;
}

/** Sets a token's height and what holds it up; on the ground both are cleared. */
export function setAltitude(
  state: GameState,
  actorId: string,
  altitudeFeet: number,
  airborne: Token["airborne"] | undefined
): void {
  state.combat = {
    ...state.combat,
    tokens: state.combat.tokens.map((token) => {
      if (token.actorId !== actorId) return token;
      const { altitudeFeet: _height, airborne: _held, ...rest } = token;
      return {
        ...rest,
        ...(altitudeFeet > 0 ? { altitudeFeet: Math.round(altitudeFeet) } : {}),
        ...(altitudeFeet > 0 && airborne ? { airborne } : {})
      };
    })
  };
}

/** An area's shape as an action prints it, or as a drawn template has it when the action prints none. */
type AreaShape = "cone" | "line" | "sphere" | "cube" | "emanation" | "cylinder" | "circle" | "square";

/**
 * The creatures among `ids` whose height an area reaches (SRD Area of Effect). A Sphere reaches as far up and down from
 * its point of origin as across, an Emanation as far from its creature's space, a Cube rises from its point as tall as
 * it is wide, a Cylinder stands up from the ground to its printed height (taken as no limit, since the SRD's run 40
 * feet and more), and a Cone or Line spreads from its origin as it does across: a Cone as high as half the distance
 * out, a Line half its width. An area placed on a creature takes its point from that creature's height; one that
 * starts at its caster, from the caster's.
 */
export function withinAreaHeight(
  state: GameState,
  ids: readonly string[],
  area: Readonly<{ shape: AreaShape; sizeFeet: number; widthFeet: number | null }>,
  origin: AreaOrigin,
  feetAcross: (actorId: string) => number | null,
  feetPerCell = FEET_PER_SQUARE
): string[] {
  return ids.filter((id) => {
    const token = state.combat.tokens.find((candidate) => candidate.actorId === id);
    if (!token) return true;
    const span = heightSpan(token, feetPerCell);
    const apart = (low: number, high: number) => Math.max(0, span.low - high, low - span.high);
    switch (area.shape) {
      case "cylinder":
        return span.high > origin.low;
      case "cube":
      case "square": {
        // A Cube from its caster rises from the caster's feet; one placed on a creature sits around its middle.
        const base = origin.fromCaster ? origin.low : Math.max(0, origin.middle - area.sizeFeet / 2);
        return spansOverlap(span.low, span.high, base, base + area.sizeFeet);
      }
      case "emanation":
        return apart(origin.low, origin.high) <= area.sizeFeet;
      case "cone": {
        const out = feetAcross(id);
        return out === null || apart(origin.middle, origin.middle) <= out / 2 + feetPerCell / 2;
      }
      case "line":
        return apart(origin.middle, origin.middle) <= (area.widthFeet ?? feetPerCell) / 2;
      default:
        return apart(origin.middle, origin.middle) <= area.sizeFeet;
    }
  });
}

/** Where an area's point of origin sits in height: the space of the creature it starts at or is placed on (its feet,
 *  its top and its middle), or the ground. */
export type AreaOrigin = Readonly<{ low: number; high: number; middle: number; fromCaster: boolean }>;

export function areaOriginHeight(
  state: GameState,
  casterId: string,
  startsAtCaster: boolean,
  placedOn: string | null,
  feetPerCell = FEET_PER_SQUARE
): AreaOrigin {
  const anchorId = startsAtCaster ? casterId : placedOn;
  const token = anchorId ? state.combat.tokens.find((candidate) => candidate.actorId === anchorId) : undefined;
  if (!token) return { low: 0, high: 0, middle: 0, fromCaster: startsAtCaster };
  const span = heightSpan(token, feetPerCell);
  return { low: span.low, high: span.high, middle: (span.low + span.high) / 2, fromCaster: startsAtCaster };
}

/** The creature whose space holds a point of the map, the highest when several stand there (aiming at a flier over
 *  others aims at the flier); null when none does. */
export function creatureAtPoint(
  state: GameState,
  calibration: SquareGridCalibration,
  point: Readonly<{ x: number; y: number }>
): string | null {
  const at = imageToGrid(calibration, point);
  const column = Math.floor(at.column);
  const row = Math.floor(at.row);
  let best: EncounterToken | null = null;
  for (const token of state.combat.tokens) {
    if (!token.position) continue;
    const origin = footprintOrigin(imageToGrid(calibration, token.position), token.sizeCells);
    const inside =
      column >= origin.column &&
      column < origin.column + token.sizeCells &&
      row >= origin.row &&
      row < origin.row + token.sizeCells;
    if (inside && (best === null || altitudeOf(token) > altitudeOf(best))) best = token;
  }
  return best?.actorId ?? null;
}

/** A flight whose end lowers its creature gently (Winged Boots, Wind Walk). */
export const DESCENDS_SAFELY_TAG = "descends-safely";

/** Its flight ended gently: a creature in the air drifts down instead of falling. It is held up as by a levitation
 *  until the next settle lands it, or keeps flying if it still can. */
export function descendSafely(state: GameState, actorId: string): void {
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
  if (!token?.position || token.airborne !== "fly" || altitudeOf(token) <= 0) return;
  setAltitude(state, actorId, altitudeOf(token), "levitate");
}

/** The mover's height at each point of its path, rising or falling evenly from start to end. */
export function altitudesAlong(count: number, fromFeet: number, toFeet: number): number[] {
  if (count <= 1) return [toFeet];
  return Array.from({ length: count }, (_, index) => fromFeet + ((toFeet - fromFeet) * index) / (count - 1));
}
