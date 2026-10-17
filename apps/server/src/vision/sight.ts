import type { GameState, SceneVision, VisionWall } from "@vtt/domain";
import {
  clearLine,
  clipToStar,
  distance,
  visibilityPolygon,
  type Bounds,
  type Point,
  type Polygon,
  type Segment
} from "./geometry.js";
import { carriedLightOf, NO_SENSES, sensesOf, type Senses, type SightContent } from "./senses.js";

/**
 * Who sees what on a scene with dynamic vision on (ADR-0023), decided on the server from the SRD's rules for light and
 * the special senses. A creature sees a point it has a clear line to (walls and closed doors block one) when the point
 * is lit, or within its Darkvision, or its Truesight; Blindsight sees within its range even Blinded or in Darkness; an
 * Invisible creature is seen only by Blindsight or Truesight. Tremorsense pinpoints creatures through walls without
 * seeing. Radii are circles in feet, read through the map's scale.
 */

type Actor = GameState["actors"][number];
type Token = GameState["combat"]["tokens"][number];

/** Whether a wall stops sight and light: a wall, or a door that is closed. */
export const blocksSight = (wall: VisionWall) => wall.kind === "wall" || (wall.kind === "door" && wall.open !== true);
/** Whether a wall stops movement: anything but an open door. */
export const blocksMovement = (wall: VisionWall) => wall.kind !== "door" || wall.open !== true;

export const segmentOf = (wall: VisionWall): Segment => ({ ax: wall.a.x, ay: wall.a.y, bx: wall.b.x, by: wall.b.y });

/** Feet of slack on a sense's range: a creature at the edge of a 60-foot Darkvision is in it. */
const RANGE_SLACK_FEET = 0.5;

type Light = Readonly<{ at: Point; reachPx: number; carrierId: string | null }>;
type Viewer = Readonly<{ actorId: string; at: Point; senses: Senses; blinded: boolean }>;

export type SceneSight = Readonly<{
  /** Vision is on and the map's scale is known; when false nothing here is meaningful. */
  enabled: boolean;
  /** Whether `viewerId` perceives `targetId`: sees it, or pinpoints it by Tremorsense. */
  perceives: (viewerId: string, targetId: string) => boolean;
  /** Whether `viewerId` sees `targetId`, with sight alone (an attack's "a target you can't see"). */
  sees: (viewerId: string, targetId: string) => boolean;
  /** Whether a point has light enough to see by, ambient or from a light that reaches it. */
  lit: (point: Point) => boolean;
  /** Where the viewers see together, as polygons whose union is the area. */
  areaOf: (viewerIds: readonly string[]) => Polygon[];
  /** Every creature the viewers perceive together, the viewers included. */
  perceivedBy: (viewerIds: readonly string[]) => ReadonlySet<string>;
}>;

const OFF: SceneSight = {
  enabled: false,
  perceives: () => true,
  sees: () => true,
  lit: () => true,
  areaOf: () => [],
  perceivedBy: () => new Set()
};

// ---- caches -----------------------------------------------------------------------------------------------------

/** Visibility polygons by walls, origin and radius: the expensive part, shared across revisions while nothing moves. */
const polygonCache = new Map<string, Point[]>();
const POLYGON_CACHE_SIZE = 600;
const segmentKeys = new WeakMap<readonly VisionWall[], string>();

/** A short fingerprint of the sight-blocking walls (FNV-1a over their coordinates, twice). */
function wallsKey(walls: readonly VisionWall[]): string {
  const known = segmentKeys.get(walls);
  if (known !== undefined) return known;
  let first = 0x811c9dc5;
  let second = 0x01000193;
  const text = walls
    .filter(blocksSight)
    .map((wall) => `${wall.a.x},${wall.a.y},${wall.b.x},${wall.b.y}`)
    .join(";");
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x5bd1e995) >>> 0;
  }
  const key = `${text.length}:${first.toString(36)}:${second.toString(36)}`;
  segmentKeys.set(walls, key);
  return key;
}

function cachedPolygon(key: string, compute: () => Point[]): Point[] {
  const known = polygonCache.get(key);
  if (known) {
    polygonCache.delete(key);
    polygonCache.set(key, known);
    return known;
  }
  const polygon = compute();
  polygonCache.set(key, polygon);
  if (polygonCache.size > POLYGON_CACHE_SIZE) polygonCache.delete(polygonCache.keys().next().value!);
  return polygon;
}

/** One `SceneSight` per committed state: the committed copy is frozen, so it can't change under the cache. */
const sightCache = new WeakMap<GameState, SceneSight>();

// ---- the engine -------------------------------------------------------------------------------------------------

const has = (actor: Actor, conditionId: string) => actor.conditions.some((condition) => condition.id === conditionId);
/** Faerie Fire's outline: an outlined creature can't benefit from the Invisible condition. */
const outlined = (actor: Actor) => actor.effects.some((effect) => effect.tags.includes("outlined"));

/** Where to look for a creature: its centre and four points toward the corners of its space. */
function samplesOf(token: Token): Point[] {
  const at = token.position!;
  const half = Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells) * 0.35;
  return [
    at,
    { x: at.x - half, y: at.y - half },
    { x: at.x + half, y: at.y - half },
    { x: at.x - half, y: at.y + half },
    { x: at.x + half, y: at.y + half }
  ];
}

/** The scene's sight for this state. Cached on a committed (frozen) state; a draft mid-command is computed fresh. */
export function sceneSight(state: GameState, content: SightContent = {}): SceneSight {
  const known = sightCache.get(state);
  if (known) return known;
  const sight = buildSight(state, content);
  if (Object.isFrozen(state)) sightCache.set(state, sight);
  return sight;
}

function buildSight(state: GameState, content: SightContent): SceneSight {
  // A recording made before dynamic vision existed has none.
  const vision = state.combat.vision as SceneVision | undefined;
  const measure = vision?.measure;
  if (!vision?.enabled || !measure) return OFF;
  const pixelsPerFoot = measure.pixelsPerFoot;
  const bounds: Bounds = { width: measure.width, height: measure.height };
  const blockers = vision.walls.filter(blocksSight).map(segmentOf);
  const key = wallsKey(vision.walls);
  const tokens = new Map(
    state.combat.tokens.flatMap((token) => (token.position ? [[token.actorId, token] as const] : []))
  );
  const actors = new Map(state.actors.map((actor) => [actor.id, actor]));

  const lights: Light[] = [];
  for (const light of vision.lights) {
    const at = light.position ?? (light.actorId ? tokens.get(light.actorId)?.position : undefined);
    if (at) lights.push({ at, reachPx: (light.brightFeet + light.dimFeet) * pixelsPerFoot, carrierId: light.actorId });
  }
  for (const [actorId, token] of tokens) {
    const actor = actors.get(actorId);
    const carried = actor ? carriedLightOf(actor, content) : null;
    if (carried && token.position)
      lights.push({
        at: token.position,
        reachPx: (carried.brightFeet + carried.dimFeet) * pixelsPerFoot,
        carrierId: actorId
      });
  }

  const polygonFrom = (at: Point, radiusPx?: number) =>
    cachedPolygon(
      `${key}|${bounds.width}x${bounds.height}|${at.x},${at.y}|${radiusPx ?? "-"}`,
      () => visibilityPolygon(at, blockers, bounds, radiusPx)
    );

  const litMemo = new Map<string, boolean>();
  const lit = (point: Point) => {
    if (vision.ambient !== "dark") return true;
    const memoKey = `${point.x},${point.y}`;
    const memo = litMemo.get(memoKey);
    if (memo !== undefined) return memo;
    const result = lights.some(
      (light) => distance(light.at, point) <= light.reachPx && clearLine(light.at, point, blockers)
    );
    litMemo.set(memoKey, result);
    return result;
  };

  const viewers = new Map<string, Viewer | null>();
  const viewerOf = (actorId: string): Viewer | null => {
    if (viewers.has(actorId)) return viewers.get(actorId)!;
    const actor = actors.get(actorId);
    const token = tokens.get(actorId);
    const viewer =
      actor && token?.position
        ? {
            actorId,
            at: token.position,
            senses: actor ? sensesOf(state, actor, content) : NO_SENSES,
            blinded: has(actor, "blinded")
          }
        : null;
    viewers.set(actorId, viewer);
    return viewer;
  };

  const pairMemo = new Map<string, boolean>();
  const detect = (viewerId: string, targetId: string, byTremorsense: boolean): boolean => {
    if (viewerId === targetId) return true;
    const memoKey = `${viewerId}|${targetId}|${byTremorsense}`;
    const memo = pairMemo.get(memoKey);
    if (memo !== undefined) return memo;
    const viewer = viewerOf(viewerId);
    const target = actors.get(targetId);
    const token = tokens.get(targetId);
    let result = false;
    if (viewer && target && token) {
      const { senses } = viewer;
      const within = (feet: number, range: number) => range > 0 && feet <= range + RANGE_SLACK_FEET;
      const invisible = has(target, "invisible") && !outlined(target);
      for (const point of samplesOf(token)) {
        const feet = distance(viewer.at, point) / pixelsPerFoot;
        if (byTremorsense && within(feet, senses.tremorsense)) {
          result = true;
          break;
        }
        if (!clearLine(viewer.at, point, blockers)) continue;
        if (within(feet, senses.blindsight)) {
          result = true;
          break;
        }
        if (viewer.blinded) continue;
        if (within(feet, senses.truesight)) {
          result = true;
          break;
        }
        if (invisible) continue;
        if (within(feet, senses.darkvision) || lit(point)) {
          result = true;
          break;
        }
      }
    }
    pairMemo.set(memoKey, result);
    return result;
  };

  const areaOf = (viewerIds: readonly string[]): Polygon[] => {
    const pieces: Polygon[] = [];
    for (const viewerId of viewerIds) {
      const viewer = viewerOf(viewerId);
      if (!viewer) continue;
      const { senses } = viewer;
      if (viewer.blinded) {
        if (senses.blindsight > 0) pieces.push(polygonFrom(viewer.at, senses.blindsight * pixelsPerFoot));
        continue;
      }
      if (vision.ambient !== "dark") {
        pieces.push(polygonFrom(viewer.at));
        continue;
      }
      // In the dark: as far as its own senses and the light it carries reach, then what other lights show it.
      const own = lights.filter((light) => light.carrierId === viewerId);
      const reach = Math.max(
        Math.max(senses.darkvision, senses.blindsight, senses.truesight) * pixelsPerFoot,
        ...own.map((light) => light.reachPx)
      );
      if (reach > 0) pieces.push(polygonFrom(viewer.at, reach));
      const others = lights.filter((light) => light.carrierId !== viewerId && light.reachPx > 0);
      if (others.length === 0) continue;
      const sight = polygonFrom(viewer.at);
      for (const light of others) {
        // A light wholly inside what the viewer already sees by its own senses adds nothing.
        if (distance(light.at, viewer.at) + light.reachPx <= reach) continue;
        pieces.push(...clipToStar(polygonFrom(light.at, light.reachPx), sight, viewer.at));
      }
    }
    return pieces;
  };

  const perceivedBy = (viewerIds: readonly string[]) => {
    const seen = new Set<string>(viewerIds.filter((viewerId) => viewerOf(viewerId) !== null));
    for (const targetId of tokens.keys())
      if (!seen.has(targetId) && viewerIds.some((viewerId) => detect(viewerId, targetId, true))) seen.add(targetId);
    return seen;
  };

  return {
    enabled: true,
    perceives: (viewerId, targetId) => detect(viewerId, targetId, true),
    sees: (viewerId, targetId) => detect(viewerId, targetId, false),
    lit,
    areaOf,
    perceivedBy
  };
}

/** The pixel scale of a map, for converting feet: a calibrated grid's cell, else a saved scale in feet or metres. */
export function pixelsPerFootOf(
  geometry: Readonly<{
    calibration: Readonly<{ cellSizePx: number; distancePerCell: number }> | null;
    scale?: Readonly<{ distancePerPixel: number; unit: string }> | null;
  }>
): number | null {
  if (geometry.calibration) return geometry.calibration.cellSizePx / geometry.calibration.distancePerCell;
  const scale = geometry.scale;
  if (!scale || scale.distancePerPixel <= 0) return null;
  const unit = scale.unit.trim().toLowerCase();
  if (unit === "ft" || unit === "ft." || unit === "feet" || unit === "foot") return 1 / scale.distancePerPixel;
  if (unit === "m" || unit === "metres" || unit === "meters" || unit === "metre" || unit === "meter")
    return 1 / (scale.distancePerPixel * 3.28084);
  return null;
}
