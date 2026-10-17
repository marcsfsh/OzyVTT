import type { GameState, SceneVision, VisionLight, VisionWall } from "@vtt/domain";
import { CommandRejectedError } from "../game-store.js";
import { gridToImage, imageToGrid } from "../grid-calibration.js";
import { layerSlice } from "../map-layers.js";
import type { TokenMapGeometry } from "../token-placement.js";
import { clearLine, distance, nearestOnSegment, type Point } from "./geometry.js";
import { blocksSight, pixelsPerFootOf, segmentOf } from "./sight.js";

/**
 * The GM's edits to a scene's dynamic vision (ADR-0023): the switch, the ambient light, walls, doors, windows and
 * lights, on the live table or, with `sceneId`, a parked scene's private prep. The server owns the geometry: wall ends
 * snap to a grid corner or to another wall's end nearby, so walls meet without gaps light could leak through, and
 * everything is clamped to the map. Every edit records the map's size and scale for the projections.
 */

const MAX_WALLS = 1000;
const MAX_LIGHTS = 100;
const LIVE_REFUSAL = "That scene is live - edit its vision on the table.";

type Point2 = Readonly<{ x: number; y: number }>;

/** The map's size and scale as the vision layer keeps it; null when the map can't measure feet. */
export function visionMeasureOf(geometry: TokenMapGeometry): SceneVision["measure"] {
  const pixelsPerFoot = pixelsPerFootOf(geometry);
  return pixelsPerFoot === null ? null : { width: geometry.width, height: geometry.height, pixelsPerFoot };
}

function slice(state: GameState, sceneId: string | undefined, geometry: TokenMapGeometry | null) {
  const target = layerSlice(state, sceneId, "vision", LIVE_REFUSAL);
  const measure = geometry ? visionMeasureOf(geometry) : target.layer.measure;
  // A new map size or scale invalidates what the party remembers of the old one.
  const sameMap =
    target.layer.measure !== null &&
    measure !== null &&
    target.layer.measure.width === measure.width &&
    target.layer.measure.height === measure.height &&
    Math.abs(target.layer.measure.pixelsPerFoot - measure.pixelsPerFoot) < 1e-9;
  return {
    vision: target.layer,
    write: (next: Partial<SceneVision>) =>
      target.write({ ...target.layer, ...next, measure, ...(sameMap ? {} : { explored: null }) })
  };
}

export function setVisionEnabled(
  state: GameState,
  sceneId: string | undefined,
  geometry: TokenMapGeometry,
  enabled: boolean
) {
  if (enabled && visionMeasureOf(geometry) === null)
    throw new CommandRejectedError("Calibrate the map's grid or set its scale before turning on vision.");
  slice(state, sceneId, geometry).write({ enabled });
}

export function setVisionAmbient(
  state: GameState,
  sceneId: string | undefined,
  geometry: TokenMapGeometry,
  ambient: SceneVision["ambient"]
) {
  slice(state, sceneId, geometry).write({ ambient });
}

export function resetExplored(state: GameState, sceneId: string | undefined) {
  slice(state, sceneId, null).write({ explored: null });
}

/** Keeps the map's measure current when the live map changes under the vision layer (a fight started elsewhere). */
export function refreshVisionMeasure(state: GameState, geometry: TokenMapGeometry) {
  const vision = state.combat.vision;
  if (!vision.enabled && vision.walls.length === 0 && vision.lights.length === 0) return;
  slice(state, undefined, geometry).write({});
}

const clamp = (value: number, high: number) => Math.min(high, Math.max(0, value));
const rounded = (value: number) => Math.round(value * 100) / 100;

/** Where a dragged wall end lands: another wall's end close by, else a grid corner close by, else where it was put. */
function snapWallPoint(point: Point2, geometry: TokenMapGeometry, ends: readonly Point2[]): Point2 {
  const inside = { x: clamp(point.x, geometry.width), y: clamp(point.y, geometry.height) };
  const calibration = geometry.calibration;
  const tolerance = calibration ? calibration.cellSizePx * 0.25 : Math.max(6, Math.min(geometry.width, geometry.height) / 150);
  let best: Point2 | null = null;
  for (const end of ends) {
    const gap = distance(end, inside);
    if (gap <= tolerance && (best === null || gap < distance(best, inside))) best = end;
  }
  if (best) return { x: best.x, y: best.y };
  if (calibration) {
    const grid = imageToGrid(calibration, inside);
    const corner = gridToImage(calibration, { column: Math.round(grid.column), row: Math.round(grid.row) });
    if (distance(corner, inside) <= tolerance)
      return { x: rounded(clamp(corner.x, geometry.width)), y: rounded(clamp(corner.y, geometry.height)) };
  }
  return { x: rounded(inside.x), y: rounded(inside.y) };
}

const endsOf = (walls: readonly VisionWall[], except?: string) =>
  walls.filter((wall) => wall.id !== except).flatMap((wall) => [wall.a, wall.b]);

/** Adds a chain of walls (each pair of points one segment); returns the ids of those added. */
export function addWalls(
  state: GameState,
  sceneId: string | undefined,
  geometry: TokenMapGeometry,
  input: Readonly<{ kind: VisionWall["kind"]; points: readonly Point2[]; newId: () => string }>
): string[] {
  const target = slice(state, sceneId, geometry);
  const ends = endsOf(target.vision.walls);
  const points: Point2[] = [];
  for (const point of input.points) {
    const snapped = snapWallPoint(point, geometry, [...ends, ...points]);
    points.push(snapped);
  }
  const added: VisionWall[] = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (distance(a, b) < 1) continue;
    added.push({ id: input.newId(), kind: input.kind, a, b, ...(input.kind === "door" ? { open: false } : {}) });
  }
  if (added.length === 0) throw new CommandRejectedError("Drag a longer wall.");
  if (target.vision.walls.length + added.length > MAX_WALLS)
    throw new CommandRejectedError(`A scene holds up to ${MAX_WALLS} walls - remove some first.`);
  target.write({ walls: [...target.vision.walls, ...added] });
  return added.map((wall) => wall.id);
}

function requireWall(vision: SceneVision, wallId: string): VisionWall {
  const wall = vision.walls.find((candidate) => candidate.id === wallId);
  if (!wall) throw new CommandRejectedError("That wall is no longer there.");
  return wall;
}

export function moveWall(
  state: GameState,
  sceneId: string | undefined,
  geometry: TokenMapGeometry,
  input: Readonly<{ wallId: string; a: Point2; b: Point2 }>
) {
  const target = slice(state, sceneId, geometry);
  requireWall(target.vision, input.wallId);
  const ends = endsOf(target.vision.walls, input.wallId);
  const a = snapWallPoint(input.a, geometry, ends);
  const b = snapWallPoint(input.b, geometry, [...ends, a]);
  if (distance(a, b) < 1) throw new CommandRejectedError("Drag a longer wall.");
  target.write({ walls: target.vision.walls.map((wall) => (wall.id === input.wallId ? { ...wall, a, b } : wall)) });
}

export function removeWall(state: GameState, sceneId: string | undefined, wallId: string) {
  const target = slice(state, sceneId, null);
  requireWall(target.vision, wallId);
  target.write({ walls: target.vision.walls.filter((wall) => wall.id !== wallId) });
}

export function clearWalls(state: GameState, sceneId: string | undefined) {
  slice(state, sceneId, null).write({ walls: [] });
}

export function setDoorOpen(state: GameState, sceneId: string | undefined, wallId: string, open: boolean) {
  const target = slice(state, sceneId, null);
  const wall = requireWall(target.vision, wallId);
  if (wall.kind !== "door") throw new CommandRejectedError("Only a door opens and closes.");
  target.write({ walls: target.vision.walls.map((candidate) => (candidate.id === wallId ? { ...candidate, open } : candidate)) });
}

/** Feet of reach to a door: within 5 feet of the creature's space, as for anything it handles. */
const DOOR_REACH_FEET = 5;

/** Whether one of `actorIds` stands next to the door on the live map, with nothing but the door itself between them
 *  (a door on the far side of a wall is out of reach however close). */
export function doorWithinReach(state: GameState, wallId: string, actorIds: readonly string[]): boolean {
  const vision = state.combat.vision;
  const wall = vision.walls.find((candidate) => candidate.id === wallId);
  const pixelsPerFoot = vision.measure?.pixelsPerFoot;
  if (!wall || wall.kind !== "door" || !pixelsPerFoot) return false;
  const others = vision.walls.filter((candidate) => candidate.id !== wallId && blocksSight(candidate)).map(segmentOf);
  return actorIds.some((actorId) => {
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
    if (!token?.position) return false;
    const at = token.position;
    const nearest = nearestOnSegment(at, segmentOf(wall));
    const gap = distance(at, nearest);
    const halfSpace = ((token.gridSizePx ?? token.sizePx) * token.sizeCells) / 2;
    if (gap > halfSpace + (DOOR_REACH_FEET + 0.5) * pixelsPerFoot) return false;
    // Stop a pixel short, so the door's own neighbours at its hinge don't count as in the way.
    const short: Point = gap > 1 ? { x: nearest.x + ((at.x - nearest.x) / gap) * 1, y: nearest.y + ((at.y - nearest.y) / gap) * 1 } : at;
    return clearLine(at, short, others);
  });
}

function requireLight(vision: SceneVision, lightId: string): VisionLight {
  const light = vision.lights.find((candidate) => candidate.id === lightId);
  if (!light) throw new CommandRejectedError("That light is no longer there.");
  return light;
}

/** The tokens a light may be given to: the scene's own. */
function sceneTokens(state: GameState, sceneId: string | undefined) {
  if (sceneId === undefined) return state.combat.tokens;
  return state.combat.scenes.find((scene) => scene.id === sceneId)?.combat.tokens ?? [];
}

export function addLight(
  state: GameState,
  sceneId: string | undefined,
  geometry: TokenMapGeometry,
  input: Readonly<{ id: string; position?: Point2; actorId?: string; brightFeet: number; dimFeet: number }>
) {
  const target = slice(state, sceneId, geometry);
  if (target.vision.lights.length >= MAX_LIGHTS)
    throw new CommandRejectedError(`A scene holds up to ${MAX_LIGHTS} lights - remove some first.`);
  if (input.brightFeet + input.dimFeet <= 0) throw new CommandRejectedError("A light needs some radius.");
  if (input.actorId !== undefined && !sceneTokens(state, sceneId).some((token) => token.actorId === input.actorId))
    throw new CommandRejectedError("That creature has no token in this scene.");
  const position = input.position
    ? { x: rounded(clamp(input.position.x, geometry.width)), y: rounded(clamp(input.position.y, geometry.height)) }
    : null;
  const light: VisionLight = {
    id: input.id,
    position,
    actorId: position ? null : (input.actorId ?? null),
    brightFeet: input.brightFeet,
    dimFeet: input.dimFeet
  };
  target.write({ lights: [...target.vision.lights, light] });
}

/** Moves a placed light; a carried one is set down where it is put. */
export function moveLight(
  state: GameState,
  sceneId: string | undefined,
  geometry: TokenMapGeometry,
  input: Readonly<{ lightId: string; position: Point2 }>
) {
  const target = slice(state, sceneId, geometry);
  requireLight(target.vision, input.lightId);
  const position = {
    x: rounded(clamp(input.position.x, geometry.width)),
    y: rounded(clamp(input.position.y, geometry.height))
  };
  target.write({
    lights: target.vision.lights.map((light) =>
      light.id === input.lightId ? { ...light, position, actorId: null } : light
    )
  });
}

export function removeLight(state: GameState, sceneId: string | undefined, lightId: string) {
  const target = slice(state, sceneId, null);
  requireLight(target.vision, lightId);
  target.write({ lights: target.vision.lights.filter((light) => light.id !== lightId) });
}
