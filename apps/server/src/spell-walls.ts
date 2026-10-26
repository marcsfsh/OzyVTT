import type { SpellWalls } from "@vtt/content-srd-5.2.1";
import type { AnnotationShapeKind, GameState, VisionSource, VisionWall, WallOpening } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { areAllies } from "./creature-sides.js";
import { CONCENTRATING_TAG, endEffectIfPresent, type EffectNarration } from "./effects.js";
import { clockMinutesOf } from "./game-time.js";
import { objectFrom } from "./objects.js";
import { derivedUuid } from "./vision/cast-sight.js";
import { sourceLive } from "./vision/areas.js";
import { distance, nearestOnSegment, type Point } from "./vision/geometry.js";
import { segmentOf } from "./vision/sight.js";

/**
 * Walls a spell raises on the live map, and gaps it cuts (SRD 5.2.1 Wall of Force, Wall of Stone, Wall of Ice,
 * Forcecage, Passwall, Stone Shape, Disintegrate). A raised wall stands on the cast's placed area: along a Line's side
 * away from its caster, round a circle's edge, or round a Cube's sides, split into the panels the spell prints (each its
 * own object with Armor Class and Hit Points). It is one of the map's walls, so it blocks what that kind blocks, and it
 * lasts while the spell does: the Concentration or the effect that keeps it. A creature whose space it cuts is pushed
 * to one side. A gap a spell cuts closes when the spell ends, unless it is for good.
 */

type Token = GameState["combat"]["tokens"][number];
type Raises = NonNullable<SpellWalls["raises"]>;
export type PlacedArea = Readonly<{ shape: AnnotationShapeKind; origin: Point; target: Point }>;

const MAX_WALLS = 1000;
/** Sides of the polygon a ringed wall stands on. */
const RING_SIDES = 24;

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The lines a raised wall stands on, for the placed area's shape. */
function outlineOf(area: PlacedArea, widthPx: number, casterAt: Point | null): Array<readonly [Point, Point]> {
  const { origin, target } = area;
  const length = distance(origin, target);
  if (length === 0) return [];
  if (area.shape === "line") {
    const normal = { x: -(target.y - origin.y) / length, y: (target.x - origin.x) / length };
    const half = widthPx / 2;
    const side = (sign: number): readonly [Point, Point] => [
      { x: origin.x + normal.x * half * sign, y: origin.y + normal.y * half * sign },
      { x: target.x + normal.x * half * sign, y: target.y + normal.y * half * sign }
    ];
    // The side away from the caster, so the creatures in the Line stand on the caster's side of it.
    const far = (sign: number) => (casterAt ? distance(casterAt, lerp(...side(sign), 0.5)) : sign);
    return [far(1) >= far(-1) ? side(1) : side(-1)];
  }
  if (area.shape === "square") {
    const corners = [
      { x: origin.x, y: origin.y },
      { x: target.x, y: origin.y },
      { x: target.x, y: target.y },
      { x: origin.x, y: target.y }
    ];
    return corners.map((corner, index) => [corner, corners[(index + 1) % 4]!] as const);
  }
  if (area.shape === "circle") {
    const outer = length / Math.cos(Math.PI / RING_SIDES);
    const points = Array.from({ length: RING_SIDES }, (_, index) => {
      const angle = (2 * Math.PI * index) / RING_SIDES;
      return { x: origin.x + outer * Math.cos(angle), y: origin.y + outer * Math.sin(angle) };
    });
    return points.map((point, index) => [point, points[(index + 1) % RING_SIDES]!] as const);
  }
  return [];
}

/** Splits a line into pieces no longer than `piecePx` (one piece when there is no panel size). */
function piecesOf(a: Point, b: Point, piecePx: number | null): Array<readonly [Point, Point]> {
  const count = piecePx ? Math.max(1, Math.round(distance(a, b) / piecePx)) : 1;
  return Array.from(
    { length: count },
    (_, index) => [lerp(a, b, index / count), lerp(a, b, (index + 1) / count)] as const
  );
}

const clamp = (value: number, high: number) => Math.min(high, Math.max(0, value));
const rounded = (value: number) => Math.round(value * 100) / 100;

export type RaiseInput = Readonly<{
  commandId: string;
  casterId: string;
  spellId: string;
  level: number;
  raises: Raises;
  area: PlacedArea;
  /** The width of a Line, in feet. */
  widthFeet: number | null;
  pixelsPerFoot: number;
  /** What keeps the wall: the caster's Concentration on the cast, or the effect the cast left on it. */
  castId: string | null;
  effectId: string | null;
  /** The spell's full duration in rounds and minutes, for a wall that stays once it has lasted that long. */
  fullDuration?: Readonly<{ rounds: number; minutes: number }>;
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
}>;

/**
 * Raises a spell's walls on the live scene from its placed area and pushes the creatures they cut to one side: the
 * caster's allies to the caster's side, everyone else away from it. Returns the lines the table reads.
 */
export function raiseSpellWalls(state: GameState, input: RaiseInput): EffectNarration[] {
  const vision = state.combat.vision;
  const casterAt = state.combat.tokens.find((token) => token.actorId === input.casterId)?.position ?? null;
  const widthPx = (input.widthFeet ?? 5) * input.pixelsPerFoot;
  const source: VisionSource = {
    casterId: input.casterId,
    spellId: input.spellId,
    level: input.level,
    ...(input.castId ? { castId: input.castId } : {}),
    ...(input.effectId ? { effectId: input.effectId } : {})
  };
  const panelPx = input.raises.panelFeet ? input.raises.panelFeet * input.pixelsPerFoot : null;
  const permanentAfter =
    input.raises.permanentAfterFull && input.fullDuration
      ? {
          ...(state.combat.active ? { round: state.combat.round + input.fullDuration.rounds } : {}),
          minute: clockMinutesOf(state) + input.fullDuration.minutes
        }
      : undefined;
  const bounds = vision.measure;
  const inside = (point: Point): Point =>
    bounds
      ? { x: rounded(clamp(point.x, bounds.width)), y: rounded(clamp(point.y, bounds.height)) }
      : { x: rounded(Math.max(0, point.x)), y: rounded(Math.max(0, point.y)) };
  const raised: VisionWall[] = outlineOf(input.area, widthPx, casterAt)
    .flatMap(([a, b]) => piecesOf(a, b, panelPx))
    .map(([a, b], index) => ({
      id: derivedUuid(input.commandId, `wall-${index}`),
      kind: input.raises.kind === "wall" ? ("wall" as const) : ("window" as const),
      a: inside(a),
      b: inside(b),
      ...(input.raises.kind === "bars" ? { bars: true as const } : {}),
      ...(input.raises.panel ? { object: objectFrom(input.raises.panel) } : {}),
      source,
      ...(permanentAfter ? { permanentAfter } : {})
    }))
    .filter((wall) => distance(wall.a, wall.b) >= 1);
  if (raised.length === 0) return [];
  // A retried command makes the same ids, so it replaces its own walls and adds none.
  const kept = vision.walls.filter((wall) => !raised.some((made) => made.id === wall.id));
  state.combat = {
    ...state.combat,
    vision: { ...vision, walls: [...kept, ...raised].slice(-MAX_WALLS) }
  };
  return input.raises.pushes ? pushAside(state, raised, input) : [];
}

/** Whether a wall crosses a token's square, kept a pixel inside its edges. */
export function cuts(token: Token, wall: Pick<VisionWall, "a" | "b">, squarePx: number): boolean {
  if (!token.position) return false;
  const half = (squarePx * token.sizeCells) / 2 - 1;
  if (half <= 0) return false;
  const { x, y } = token.position;
  const inBox = (point: Point) => Math.abs(point.x - x) < half && Math.abs(point.y - y) < half;
  if (inBox(wall.a) || inBox(wall.b)) return true;
  const corners = [
    { x: x - half, y: y - half },
    { x: x + half, y: y - half },
    { x: x + half, y: y + half },
    { x: x - half, y: y + half }
  ];
  const side = (point: Point) =>
    (wall.b.x - wall.a.x) * (point.y - wall.a.y) - (wall.b.y - wall.a.y) * (point.x - wall.a.x);
  const signs = corners.map(side);
  if (signs.every((value) => value > 0) || signs.every((value) => value < 0)) return false;
  // The wall's line crosses the square; it cuts it where its own extent reaches over the square.
  const nearest = nearestOnSegment(token.position, { ax: wall.a.x, ay: wall.a.y, bx: wall.b.x, by: wall.b.y });
  return inBox(nearest);
}

/** SRD: "If the wall cuts through a creature's space when it appears, the creature is pushed to one side of the wall
 *  (you choose which side)." The caster's allies go to its side and everyone else to the far side, by whole squares. */
function pushAside(state: GameState, raised: readonly VisionWall[], input: RaiseInput): EffectNarration[] {
  const caster = state.actors.find((actor) => actor.id === input.casterId);
  const casterAt = state.combat.tokens.find((token) => token.actorId === input.casterId)?.position ?? null;
  const events: EffectNarration[] = [];
  state.combat = {
    ...state.combat,
    tokens: state.combat.tokens.map((token) => {
      if (!token.position || token.actorId === input.casterId) return token;
      const wall = raised.find((candidate) => cuts(token, candidate, 5 * input.pixelsPerFoot));
      if (!wall) return token;
      const length = distance(wall.a, wall.b);
      const normal = { x: -(wall.b.y - wall.a.y) / length, y: (wall.b.x - wall.a.x) / length };
      const sideOf = (point: Point) => (point.x - wall.a.x) * normal.x + (point.y - wall.a.y) * normal.y;
      const actor = state.actors.find((candidate) => candidate.id === token.actorId);
      const friendly = caster && actor ? areAllies(caster, actor, input.resolveDefinition) : false;
      const casterSide = casterAt ? Math.sign(sideOf(casterAt)) || 1 : 1;
      const sign = friendly ? casterSide : -casterSide;
      // Step along the axis the wall faces most, a square at a time, until the wall no longer cuts it.
      // A square of the map: 5 feet.
      const cell = 5 * input.pixelsPerFoot;
      const step =
        Math.abs(normal.x) >= Math.abs(normal.y)
          ? { x: Math.sign(normal.x * sign) * cell, y: 0 }
          : { x: 0, y: Math.sign(normal.y * sign) * cell };
      for (let squares = 1; squares <= token.sizeCells + 1; squares++) {
        const position = { x: token.position.x + step.x * squares, y: token.position.y + step.y * squares };
        if (position.x < 0 || position.y < 0) break;
        const moved = { ...token, position };
        if (raised.some((candidate) => cuts(moved, candidate, cell))) continue;
        if (actor)
          events.push({ kind: "effect", text: `${actor.name} is pushed aside by the wall.`, actorId: actor.id });
        return moved;
      }
      return token;
    })
  };
  return events;
}

/** Whether a wall's spell still keeps it, or it has stood long enough to stay for good. */
function wallStays(state: GameState, wall: VisionWall): VisionWall | null {
  if (sourceLive(state, wall.source)) return wall;
  const after = wall.permanentAfter;
  const lasted =
    after !== undefined &&
    ((after.round !== undefined && state.combat.active && state.combat.round >= after.round) ||
      (after.minute !== undefined && clockMinutesOf(state) >= after.minute));
  if (!lasted) return null;
  const { source: _source, permanentAfter: _after, ...permanent } = wall;
  return permanent;
}

/** Drops the live scene's spell walls whose spell has ended, keeps a wall that has become permanent, and closes the
 *  gaps whose spell has ended, moving out the creatures still in them. Runs after every command; returns the lines the
 *  table reads. */
export function pruneEndedWalls(state: GameState): EffectNarration[] {
  const vision = state.combat.vision;
  if (!vision.walls.some((wall) => wall.source !== undefined || wall.openings?.some((gap) => gap.source))) return [];
  let changed = false;
  const closing: Array<readonly [VisionWall, WallOpening]> = [];
  const walls = vision.walls.flatMap((wall) => {
    let next: VisionWall | null = wall.source ? wallStays(state, wall) : wall;
    if (next !== wall) changed = true;
    if (next?.openings?.some((gap) => !sourceLive(state, gap.source))) {
      const openings = next.openings.filter((gap) => sourceLive(state, gap.source));
      for (const gap of next.openings) if (!openings.includes(gap)) closing.push([next, gap]);
      const { openings: _openings, ...rest } = next;
      next = openings.length > 0 ? { ...rest, openings } : rest;
      changed = true;
    }
    return next ? [next] : [];
  });
  if (changed) state.combat = { ...state.combat, vision: { ...vision, walls } };
  const pixelsPerFoot = vision.measure?.pixelsPerFoot;
  return pixelsPerFoot ? closing.flatMap(([wall, gap]) => ejectFromGap(state, wall, gap, pixelsPerFoot)) : [];
}

/** SRD Passwall: "When the opening disappears, any creatures or objects still in the passage created by the spell are
 *  safely ejected to an unoccupied space nearest to the surface on which you cast the spell": a creature whose square
 *  the closing gap crosses steps out, a square at a time, to the side the passage was cut from. */
function ejectFromGap(state: GameState, wall: VisionWall, gap: WallOpening, pixelsPerFoot: number): EffectNarration[] {
  const piece = { a: lerp(wall.a, wall.b, gap.from), b: lerp(wall.a, wall.b, gap.to) };
  const length = distance(piece.a, piece.b);
  if (length === 0) return [];
  const cell = 5 * pixelsPerFoot;
  const normal = { x: -(piece.b.y - piece.a.y) / length, y: (piece.b.x - piece.a.x) / length };
  const sideOf = (point: Point) => (point.x - piece.a.x) * normal.x + (point.y - piece.a.y) * normal.y;
  const events: EffectNarration[] = [];
  for (const token of state.combat.tokens) {
    if (!token.position || !cuts(token, piece, cell)) continue;
    const sign = gap.entry ? Math.sign(sideOf(gap.entry)) || 1 : Math.sign(sideOf(token.position)) || 1;
    const step =
      Math.abs(normal.x) >= Math.abs(normal.y)
        ? { x: Math.sign(normal.x * sign) * cell, y: 0 }
        : { x: 0, y: Math.sign(normal.y * sign) * cell };
    const taken = (position: Point) =>
      state.combat.tokens.some(
        (other) => other !== token && other.position?.x === position.x && other.position?.y === position.y
      );
    for (let squares = 1; squares <= token.sizeCells + 4; squares++) {
      const position = { x: token.position.x + step.x * squares, y: token.position.y + step.y * squares };
      if (position.x < 0 || position.y < 0) break;
      if (cuts({ ...token, position }, piece, cell) || taken(position)) continue;
      state.combat = {
        ...state.combat,
        tokens: state.combat.tokens.map((candidate) => (candidate === token ? { ...token, position } : candidate))
      };
      const actor = state.actors.find((candidate) => candidate.id === token.actorId);
      if (actor)
        events.push({ kind: "effect", text: `${actor.name} is ejected as the passage closes.`, actorId: actor.id });
      break;
    }
  }
  return events;
}

/** Where on a wall a creature works on it: the point nearest its token. */
export function nearestPointOf(state: GameState, wall: VisionWall, actorId: string): Point | null {
  const at = state.combat.tokens.find((token) => token.actorId === actorId)?.position;
  return at ? nearestOnSegment(at, segmentOf(wall)) : null;
}

/** Cuts a gap `feet` wide in a wall, centred on `at`: Passwall's passage, which closes when `source` ends, or Stone
 *  Shape's, which stays. `entry` is where it was cut from, the side a creature left in it goes out to. */
export function cutWall(
  state: GameState,
  wallId: string,
  at: Point,
  feet: number,
  pixelsPerFoot: number,
  source: VisionSource | undefined,
  entry?: Point
): void {
  const vision = state.combat.vision;
  state.combat = {
    ...state.combat,
    vision: {
      ...vision,
      walls: vision.walls.map((wall) => {
        if (wall.id !== wallId) return wall;
        const length = distance(wall.a, wall.b);
        if (length === 0) return wall;
        const centre = distance(wall.a, nearestOnSegment(at, segmentOf(wall))) / length;
        const half = (feet * pixelsPerFoot) / 2 / length;
        const gap = {
          from: Math.max(0, centre - half),
          to: Math.min(1, centre + half),
          ...(source ? { source } : {}),
          ...(source && entry ? { entry: { x: rounded(Math.max(0, entry.x)), y: rounded(Math.max(0, entry.y)) } } : {})
        };
        return { ...wall, openings: [...(wall.openings ?? []), gap].slice(-8) };
      })
    }
  };
}

/**
 * SRD Disintegrate on a wall: "A Large or smaller object or a creation of magical force is disintegrated", and Wall of
 * Force: "A Disintegrate spell destroys the wall instantly." A spell's wall of force goes whole, ending the spell that
 * made it; a door or a stretch of wall that is an object goes, or a 10-foot portion of a longer one.
 */
export function disintegrateWall(
  state: GameState,
  wallId: string,
  at: Point,
  pixelsPerFoot: number,
  forceSpells: ReadonlySet<string>
): EffectNarration[] {
  const vision = state.combat.vision;
  const wall = vision.walls.find((candidate) => candidate.id === wallId);
  if (!wall) return [];
  const source = wall.source;
  if (source?.spellId !== undefined && forceSpells.has(source.spellId)) {
    const same = (candidate: VisionWall) =>
      candidate.source?.castId === source.castId && candidate.source?.effectId === source.effectId;
    state.combat = {
      ...state.combat,
      vision: { ...vision, walls: vision.walls.filter((candidate) => !same(candidate)) }
    };
    const events: EffectNarration[] = [];
    for (const actor of state.actors)
      for (const effect of [...actor.effects])
        if (
          (source.castId !== undefined && effect.castId === source.castId && effect.tags.includes(CONCENTRATING_TAG)) ||
          (source.effectId !== undefined && effect.id === source.effectId)
        )
          events.push(...endEffectIfPresent(state, actor.id, effect.id));
    return events;
  }
  if (distance(wall.a, wall.b) > 10 * pixelsPerFoot + 1) cutWall(state, wallId, at, 10, pixelsPerFoot, undefined);
  else
    state.combat = {
      ...state.combat,
      vision: { ...vision, walls: vision.walls.filter((candidate) => candidate.id !== wallId) }
    };
  return [];
}
