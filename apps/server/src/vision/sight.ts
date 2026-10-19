import type { GameState, SceneVision, VisionWall } from "@vtt/domain";
import { halfSpaceOf, resolveAreas, sourceLive, templateCentre, type ResolvedArea } from "./areas.js";
import {
  clearLine,
  clipToConvex,
  clipToStar,
  distance,
  visibilityPolygon,
  type Bounds,
  type Point,
  type Polygon,
  type Segment
} from "./geometry.js";
import { carriedLightsOf, NO_SENSES, sensesOf, type Senses, type SightContent } from "./senses.js";

/**
 * Who sees what on a scene with dynamic vision on (ADR-0023), decided on the server from the SRD 5.2.1 Rules Glossary
 * (Bright Light, Dim Light, Darkness, Lightly and Heavily Obscured, Blindsight, Darkvision, Tremorsense, Truesight,
 * Invisible, Blinded). Every point has a light level: the scene's ambient light, or an area painted over it, raised by
 * the lights that reach it (Bright within a light's bright radius, Dim beyond it); magical Darkness stays dark whatever
 * light reaches it. A creature sees a point it has a clear line to (walls, closed doors, heavily obscuring areas and
 * magical Darkness block one) when the point is lit, or within its Darkvision, Truesight or Devil's Sight. Blindsight
 * sees within its range whatever the light, the fog or a Blinded condition. An Invisible creature is seen only by
 * Truesight, See Invisibility, Blindsight or a revealing light, unless it is outlined. Tremorsense pinpoints creatures
 * through walls without seeing. Radii are circles in feet, read through the map's scale.
 */

type Actor = GameState["actors"][number];
type Token = GameState["combat"]["tokens"][number];

/** Whether a wall stops sight and light: a wall, or a door that is closed. */
export const blocksSight = (wall: VisionWall) => wall.kind === "wall" || (wall.kind === "door" && wall.open !== true);
/** Whether a wall stops movement: anything but an open door. */
export const blocksMovement = (wall: VisionWall) => wall.kind !== "door" || wall.open !== true;

export const segmentOf = (wall: VisionWall): Segment => ({ ax: wall.a.x, ay: wall.a.y, bx: wall.b.x, by: wall.b.y });

type WallEnds = Readonly<{ a: Point; b: Point }>;

/** The parts of a wall that stand: the whole of it, less the gaps cut in it (Passwall's passage, a tunnel). */
export function wallPieces(wall: VisionWall): WallEnds[] {
  const gaps = [...(wall.openings ?? [])]
    .map((gap) => ({ from: Math.min(gap.from, gap.to), to: Math.max(gap.from, gap.to) }))
    .sort((left, right) => left.from - right.from);
  if (gaps.length === 0) return [{ a: wall.a, b: wall.b }];
  const at = (t: number): Point => ({
    x: wall.a.x + (wall.b.x - wall.a.x) * t,
    y: wall.a.y + (wall.b.y - wall.a.y) * t
  });
  const pieces: WallEnds[] = [];
  let start = 0;
  for (const gap of gaps) {
    if (gap.from > start + 1e-6) pieces.push({ a: at(start), b: at(gap.from) });
    start = Math.max(start, gap.to);
  }
  if (start < 1 - 1e-6) pieces.push({ a: at(start), b: wall.b });
  return pieces;
}

/** A wall's standing parts as segments. */
export const segmentsOf = (wall: VisionWall): Segment[] =>
  wallPieces(wall).map((piece) => ({ ax: piece.a.x, ay: piece.a.y, bx: piece.b.x, by: piece.b.y }));

/** Feet of slack on a sense's range: a creature at the edge of a 60-foot Darkvision is in it. */
const RANGE_SLACK_FEET = 0.5;
/** A 5e Cone is as wide as it is long: half its angle is atan(1/2). */
const CONE_HALF_ANGLE = Math.atan(0.5);

export type LightLevel = "bright" | "dim" | "dark";
/** The light at a point: its level, whether its Bright Light is sunlight, and whether it is magical Darkness. */
export type LightAt = Readonly<{ level: LightLevel; sunlight: boolean; magical: boolean }>;
/** How obscured a point is (SRD Lightly and Heavily Obscured): Dim Light and patchy fog are light, Darkness and dense
 *  fog heavy. */
export type Obscurement = "none" | "light" | "heavy";

type Light = Readonly<{
  at: Point;
  brightPx: number;
  reachPx: number;
  carrierId: string | null;
  sunlight: boolean;
  reveals: boolean;
  /** A Cone's direction in radians, or null for a sphere of light. */
  coneDirection: number | null;
}>;
type Viewer = Readonly<{ actorId: string; at: Point; senses: Senses; blinded: boolean }>;

export type SceneSight = Readonly<{
  /** Vision is on and the map's scale is known; when false nothing here is meaningful. */
  enabled: boolean;
  /** Whether `viewerId` perceives `targetId`: sees it, or pinpoints it by Tremorsense. */
  perceives: (viewerId: string, targetId: string) => boolean;
  /** Whether `viewerId` sees `targetId`, with sight alone (an attack's "a target you can't see"). */
  sees: (viewerId: string, targetId: string) => boolean;
  /** Whether `viewerId` sees a point on the map ("an unoccupied space you can see"). */
  seesPoint: (viewerId: string, point: Point) => boolean;
  /** Whether nothing blocks a line of sight between two creatures: no wall or closed door, and no heavily obscuring
   *  area or magical Darkness between them, whatever the light (Frightened's "within line of sight"). */
  lineOfSight: (fromId: string, toId: string) => boolean;
  /** The light at a point. */
  lightAt: (point: Point) => LightAt;
  /** How obscured a point is, for anyone looking at it. */
  obscurementAt: (point: Point) => Obscurement;
  /** How obscured a point is by fog, smoke or foliage alone, whatever the light. */
  fogAt: (point: Point) => Obscurement;
  /** Where a creature on the map stands; null when it has no token there. */
  positionOf: (actorId: string) => Point | null;
  /** Where the viewers see together, as polygons whose union is the area. With `showsLight`, a light carried by a
   *  creature it refuses adds nothing: its circle would draw the carrier's position for an audience that can't know of
   *  it. */
  areaOf: (viewerIds: readonly string[], showsLight?: (carrierId: string) => boolean) => Polygon[];
  /** The part of what the viewers see that lies in Bright Light, for painting the rest dim; null when the whole scene
   *  is in Bright Light. */
  brightOf: (viewerIds: readonly string[], showsLight?: (carrierId: string) => boolean) => Polygon[] | null;
  /** Every creature the viewers perceive together, the viewers included. */
  perceivedBy: (viewerIds: readonly string[]) => ReadonlySet<string>;
}>;

const OFF: SceneSight = {
  enabled: false,
  perceives: () => true,
  sees: () => true,
  seesPoint: () => true,
  lineOfSight: () => true,
  lightAt: () => ({ level: "bright", sunlight: false, magical: false }),
  obscurementAt: () => "none",
  fogAt: () => "none",
  positionOf: () => null,
  areaOf: () => [],
  brightOf: () => null,
  perceivedBy: () => new Set()
};

// ---- caches -----------------------------------------------------------------------------------------------------

/** Visibility polygons by blockers, origin and radius: the expensive part, shared across revisions while nothing moves. */
const polygonCache = new Map<string, Point[]>();
const POLYGON_CACHE_SIZE = 600;
const segmentKeys = new WeakMap<readonly VisionWall[], string>();

/** A short fingerprint of some text (FNV-1a, twice). */
function fingerprint(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x5bd1e995) >>> 0;
  }
  return `${text.length}:${first.toString(36)}:${second.toString(36)}`;
}

/** A short fingerprint of the sight-blocking walls. */
function wallsKey(walls: readonly VisionWall[]): string {
  const known = segmentKeys.get(walls);
  if (known !== undefined) return known;
  const key = fingerprint(
    walls
      .filter(blocksSight)
      .flatMap(segmentsOf)
      .map((piece) => `${piece.ax},${piece.ay},${piece.bx},${piece.by}`)
      .join(";")
  );
  segmentKeys.set(walls, key);
  return key;
}

const areasKey = (areas: readonly ResolvedArea[]) =>
  areas.length === 0
    ? "-"
    : fingerprint(areas.map((area) => area.outline.map((point) => `${point.x},${point.y}`).join(" ")).join(";"));

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

// ---- light-level rects -------------------------------------------------------------------------------------------

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
type LevelRect = Rect & Readonly<{ level: LightLevel }>;

/** `rect` with `hole` cut out, as up to four rects. */
function subtract(rect: Rect, hole: Rect): Rect[] {
  const left = Math.max(rect.x, hole.x);
  const right = Math.min(rect.x + rect.width, hole.x + hole.width);
  const top = Math.max(rect.y, hole.y);
  const bottom = Math.min(rect.y + rect.height, hole.y + hole.height);
  if (left >= right || top >= bottom) return [rect];
  const pieces: Rect[] = [];
  if (top > rect.y) pieces.push({ x: rect.x, y: rect.y, width: rect.width, height: top - rect.y });
  if (bottom < rect.y + rect.height)
    pieces.push({ x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom });
  if (left > rect.x) pieces.push({ x: rect.x, y: top, width: left - rect.x, height: bottom - top });
  if (right < rect.x + rect.width)
    pieces.push({ x: right, y: top, width: rect.x + rect.width - right, height: bottom - top });
  return pieces;
}

/** The map split into rects by light level: the ambient light, with each painted level area laid over it in order. */
function levelRectsOf(bounds: Bounds, ambient: LightLevel, levelAreas: readonly ResolvedArea[]): LevelRect[] {
  let rects: LevelRect[] = [{ x: 0, y: 0, width: bounds.width, height: bounds.height, level: ambient }];
  for (const area of levelAreas) {
    if (!area.rect) continue;
    rects = rects.flatMap((rect) => subtract(rect, area.rect!).map((piece) => ({ ...piece, level: rect.level })));
    rects.push({ ...area.rect, level: area.kind as LightLevel });
  }
  return rects;
}

const rectPolygon = (rect: Rect): Point[] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height }
];

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

/** Whether `content` has every piece the engine reads. Only such a sight is cached: a partial one has fewer senses and
 *  lights, and caching it would give every later reader of the same state that poorer answer. */
const complete = (content: SightContent) => content.definition !== undefined && content.catalog !== undefined;

/** The scene's sight for this state. Cached on a committed (frozen) state; a draft mid-command is computed fresh. */
export function sceneSight(state: GameState, content: SightContent = {}): SceneSight {
  const known = sightCache.get(state);
  if (known) return known;
  const sight = buildSight(state, content);
  if (Object.isFrozen(state) && complete(content)) sightCache.set(state, sight);
  return sight;
}

/** Whether `sight` is the one cached for `state`, so answers derived from it may be cached on that state too. */
export const sightIsCached = (state: GameState, sight: SceneSight) => sightCache.get(state) === sight;

/** The triangle a Cone of light fills, from its source out to its reach. */
function coneTriangle(at: Point, direction: number, reach: number): Point[] {
  const far = reach / Math.cos(CONE_HALF_ANGLE);
  return [
    at,
    { x: at.x + far * Math.cos(direction - CONE_HALF_ANGLE), y: at.y + far * Math.sin(direction - CONE_HALF_ANGLE) },
    { x: at.x + far * Math.cos(direction + CONE_HALF_ANGLE), y: at.y + far * Math.sin(direction + CONE_HALF_ANGLE) }
  ];
}

function inCone(light: Light, point: Point): boolean {
  if (light.coneDirection === null) return true;
  if (point.x === light.at.x && point.y === light.at.y) return true;
  const angle = Math.atan2(point.y - light.at.y, point.x - light.at.x) - light.coneDirection;
  const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
  return Math.abs(wrapped) <= CONE_HALF_ANGLE + 1e-9;
}

function buildSight(state: GameState, content: SightContent): SceneSight {
  // A recording made before dynamic vision existed has none.
  const vision = state.combat.vision as SceneVision | undefined;
  const measure = vision?.measure;
  if (!vision?.enabled || !measure) return OFF;
  const pixelsPerFoot = measure.pixelsPerFoot;
  const bounds: Bounds = { width: measure.width, height: measure.height };
  const walls = vision.walls.filter(blocksSight).flatMap(segmentsOf);
  const wallKey = wallsKey(vision.walls);
  const tokens = new Map(
    state.combat.tokens.flatMap((token) => (token.position ? [[token.actorId, token] as const] : []))
  );
  const actors = new Map(state.actors.map((actor) => [actor.id, actor]));
  const annotations = state.combat.annotations ?? [];

  const liveAreas = (vision.areas ?? []).filter((area) => sourceLive(state, area.source));
  const areas = resolveAreas(liveAreas, { annotations, tokens: [...tokens.values()] }, pixelsPerFoot);
  const heavy = areas.filter((area) => area.kind === "heavily-obscured");
  const lightFog = areas.filter((area) => area.kind === "lightly-obscured");
  const magical = areas.filter((area) => area.kind === "magical-darkness");
  const levelAreas = areas.filter((area) => area.kind === "bright" || area.kind === "dim" || area.kind === "dark");
  const heavyEdges = heavy.flatMap((area) => [...area.edges]);
  const magicalEdges = magical.flatMap((area) => [...area.edges]);
  const heavyKey = areasKey(heavy);
  const magicalKey = areasKey(magical);
  const inMagical = (point: Point) => magical.some((area) => area.contains(point));

  // ---- lights ----
  const lights: Light[] = [];
  const addLight = (
    at: Point,
    light: Readonly<{ brightFeet: number; dimFeet: number; sunlight?: boolean; reveals?: boolean }>,
    carrierId: string | null,
    coneFacingDegrees: number | null = null
  ) => {
    // Nonmagical light can't illuminate magical Darkness, and one inside it lights nothing.
    if (inMagical(at)) return;
    lights.push({
      at,
      brightPx: light.brightFeet * pixelsPerFoot,
      reachPx: (light.brightFeet + light.dimFeet) * pixelsPerFoot,
      carrierId,
      sunlight: light.sunlight === true,
      reveals: light.reveals === true,
      coneDirection: coneFacingDegrees === null ? null : (coneFacingDegrees * Math.PI) / 180
    });
  };
  for (const light of vision.lights) {
    if (!sourceLive(state, light.source)) continue;
    const annotation =
      light.annotationId === undefined ? undefined : annotations.find((entry) => entry.id === light.annotationId);
    const at =
      light.position ??
      (light.actorId ? tokens.get(light.actorId)?.position : annotation ? templateCentre(annotation) : undefined);
    if (at) addLight(at, light, light.actorId);
  }
  for (const [actorId, token] of tokens) {
    const actor = actors.get(actorId);
    if (!actor || !token.position) continue;
    for (const carried of carriedLightsOf(state, actor, content))
      addLight(token.position, carried, actorId, carried.coneFacingDegrees);
  }

  const lightBlocked = (from: Point, to: Point) =>
    !clearLine(from, to, walls) || magical.some((area) => area.touches(from, to));

  const ambient = vision.ambient as LightLevel;
  const regionAt = (point: Point): { level: LightLevel; sunlight: boolean } => {
    for (let index = levelAreas.length - 1; index >= 0; index--) {
      const area = levelAreas[index]!;
      if (area.contains(point)) return { level: area.kind as LightLevel, sunlight: area.sunlight };
    }
    return { level: ambient, sunlight: ambient === "bright" && vision.sunlight === true };
  };

  const lightMemo = new Map<string, LightAt>();
  const lightAt = (point: Point): LightAt => {
    const memoKey = `${point.x},${point.y}`;
    const memo = lightMemo.get(memoKey);
    if (memo !== undefined) return memo;
    let result: LightAt;
    if (inMagical(point)) result = { level: "dark", sunlight: false, magical: true };
    else {
      let { level, sunlight } = regionAt(point);
      for (const light of lights) {
        if (level === "bright" && sunlight) break;
        if (level === "bright" && !light.sunlight) continue;
        const gap = distance(light.at, point);
        if (gap > light.reachPx || !inCone(light, point) || lightBlocked(light.at, point)) continue;
        if (light.brightPx > 0 && gap <= light.brightPx) {
          level = "bright";
          sunlight ||= light.sunlight;
        } else if (level === "dark") level = "dim";
      }
      result = { level, sunlight, magical: false };
    }
    lightMemo.set(memoKey, result);
    return result;
  };

  const fogAt = (point: Point): Obscurement =>
    heavy.some((area) => area.contains(point))
      ? "heavy"
      : lightFog.some((area) => area.contains(point))
        ? "light"
        : "none";

  const obscurementAt = (point: Point): Obscurement => {
    const fog = fogAt(point);
    if (fog === "heavy") return "heavy";
    const light = lightAt(point);
    if (light.level === "dark") return "heavy";
    return light.level === "dim" || fog === "light" ? "light" : "none";
  };

  /** An Invisible creature at this point is seen anyway: it stands in a revealing light's Bright Light. */
  const revealedAt = (point: Point) =>
    lights.some(
      (light) =>
        light.reveals &&
        light.brightPx > 0 &&
        distance(light.at, point) <= light.brightPx &&
        inCone(light, point) &&
        !lightBlocked(light.at, point)
    );

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

  const within = (feet: number, range: number) => range > 0 && feet <= range + RANGE_SLACK_FEET;

  /** Whether the viewer sees a point by sight; `invisible` when what stands there has the Invisible condition. */
  const seesFrom = (viewer: Viewer, point: Point, invisible: boolean): boolean => {
    const { senses } = viewer;
    const feet = distance(viewer.at, point) / pixelsPerFoot;
    if (!clearLine(viewer.at, point, walls) && !within(feet, senses.xray)) return false;
    if (within(feet, senses.blindsight)) return true;
    if (viewer.blinded) return false;
    // "You have the Blinded condition while trying to see something in a Heavily Obscured space."
    if (heavy.some((area) => area.sparedActorId !== viewer.actorId && area.touches(viewer.at, point))) return false;
    const pierces = within(feet, senses.truesight) || within(feet, senses.devilsSight);
    if (!pierces && magical.some((area) => area.touches(viewer.at, point))) return false;
    if (invisible && !within(feet, senses.truesight) && !within(feet, senses.seeInvisibility) && !revealedAt(point))
      return false;
    const light = lightAt(point);
    if (light.magical) return pierces;
    if (light.level !== "dark") return true;
    return within(feet, senses.darkvision) || pierces;
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
      const invisible = has(target, "invisible") && !outlined(target);
      for (const point of samplesOf(token)) {
        const feet = distance(viewer.at, point) / pixelsPerFoot;
        // Tremorsense needs both on the same surface, so it finds nothing in the air and works from nowhere aloft.
        const grounded = token.airborne === undefined && tokens.get(viewerId)?.airborne === undefined;
        if (
          (byTremorsense && grounded && within(feet, viewer.senses.tremorsense)) ||
          seesFrom(viewer, point, invisible)
        ) {
          result = true;
          break;
        }
      }
    }
    pairMemo.set(memoKey, result);
    return result;
  };

  const seesPoint = (viewerId: string, point: Point) => {
    const viewer = viewerOf(viewerId);
    return viewer !== null && seesFrom(viewer, point, false);
  };

  const lineOfSight = (fromId: string, toId: string) => {
    const from = tokens.get(fromId)?.position;
    const token = tokens.get(toId);
    if (!from || !token?.position) return false;
    return samplesOf(token).some(
      (point) =>
        clearLine(from, point, walls) &&
        !heavy.some((area) => area.touches(from, point)) &&
        !magical.some((area) => area.touches(from, point))
    );
  };

  // ---- polygons ----
  const polygonFrom = (at: Point, segments: readonly Segment[], key: string, radiusPx?: number) =>
    cachedPolygon(`${key}|${bounds.width}x${bounds.height}|${at.x},${at.y}|${radiusPx ?? "-"}`, () =>
      visibilityPolygon(at, segments, bounds, radiusPx)
    );
  /** The blockers one viewer's sight meets: walls, the fog it isn't spared from, and magical Darkness. */
  const blockersFor = (viewerId: string) => {
    const own = heavy.some((area) => area.sparedActorId === viewerId)
      ? heavy.filter((area) => area.sparedActorId !== viewerId)
      : heavy;
    const edges = own === heavy ? heavyEdges : own.flatMap((area) => [...area.edges]);
    const key = own === heavy ? heavyKey : areasKey(own);
    return {
      fog: own,
      sight: [...walls, ...edges, ...magicalEdges],
      sightKey: `${wallKey}|h${key}|m${magicalKey}`,
      pierce: [...walls, ...edges],
      pierceKey: `${wallKey}|h${key}`,
      xray: [...edges, ...magicalEdges],
      xrayKey: `x|h${key}|m${magicalKey}`
    };
  };
  const lightSegments = [...walls, ...magicalEdges];
  const lightKey = `${wallKey}|m${magicalKey}`;
  const levelRects = levelRectsOf(bounds, ambient, levelAreas);
  const anyDark = levelRects.some((rect) => rect.level === "dark");
  const wholeMapLit = levelRects.length === 1 && !anyDark;
  const lightPolygon = (light: Light, radiusPx: number) => {
    const reach = cachedPolygon(
      `${lightKey}|${bounds.width}x${bounds.height}|${light.at.x},${light.at.y}|${radiusPx}`,
      () => visibilityPolygon(light.at, lightSegments, bounds, radiusPx)
    );
    return light.coneDirection === null
      ? reach
      : clipToConvex(reach, coneTriangle(light.at, light.coneDirection, radiusPx));
  };

  /** What a viewer's sight can reach before light decides: nothing at all when it stands in fog or in magical
   *  Darkness it can't see through. */
  const starOf = (viewer: Viewer): Point[] | null => {
    const blockers = blockersFor(viewer.actorId);
    if (viewer.blinded || blockers.fog.some((area) => area.contains(viewer.at))) return null;
    if (magical.some((area) => area.contains(viewer.at))) return null;
    return polygonFrom(viewer.at, blockers.sight, blockers.sightKey);
  };

  const areaOf = (viewerIds: readonly string[], showsLight?: (carrierId: string) => boolean): Polygon[] => {
    const shown = (light: Light) => light.carrierId === null || showsLight === undefined || showsLight(light.carrierId);
    const pieces: Polygon[] = [];
    for (const viewerId of viewerIds) {
      const viewer = viewerOf(viewerId);
      if (!viewer) continue;
      const { senses } = viewer;
      const blockers = blockersFor(viewerId);
      if (senses.blindsight > 0) pieces.push(polygonFrom(viewer.at, walls, wallKey, senses.blindsight * pixelsPerFoot));
      if (senses.xray > 0 && !viewer.blinded)
        pieces.push(polygonFrom(viewer.at, blockers.xray, blockers.xrayKey, senses.xray * pixelsPerFoot));
      const star = starOf(viewer);
      const piercing = Math.max(senses.truesight, senses.devilsSight);
      // Truesight and Devil's Sight see into magical Darkness, though not through fog.
      if (piercing > 0 && !viewer.blinded && !blockers.fog.some((area) => area.contains(viewer.at)))
        pieces.push(polygonFrom(viewer.at, blockers.pierce, blockers.pierceKey, piercing * pixelsPerFoot));
      if (!star) continue;
      if (wholeMapLit) {
        pieces.push(star);
        continue;
      }
      // The parts of the map the ambient light or a painted area lights, then what Darkvision and lights add.
      for (const rect of levelRects) if (rect.level !== "dark") pieces.push(...clippedPieces(star, rectPolygon(rect)));
      if (!anyDark) continue;
      if (senses.darkvision > 0)
        pieces.push(polygonFrom(viewer.at, blockers.sight, blockers.sightKey, senses.darkvision * pixelsPerFoot));
      const ownReach = Math.max(senses.darkvision, piercing) * pixelsPerFoot;
      for (const light of lights) {
        if (light.reachPx <= 0 || !shown(light)) continue;
        // A light wholly inside what the viewer already sees by its own senses adds nothing.
        if (distance(light.at, viewer.at) + light.reachPx <= ownReach) continue;
        pieces.push(...clipToStar(lightPolygon(light, light.reachPx), star, viewer.at));
      }
    }
    return pieces;
  };

  const brightOf = (viewerIds: readonly string[], showsLight?: (carrierId: string) => boolean): Polygon[] | null => {
    const tinted = !levelRects.every((rect) => rect.level === "bright") || magical.length > 0;
    if (!tinted) return null;
    const shown = (light: Light) => light.carrierId === null || showsLight === undefined || showsLight(light.carrierId);
    const pieces: Polygon[] = [];
    for (const viewerId of viewerIds) {
      const viewer = viewerOf(viewerId);
      if (!viewer) continue;
      const star = starOf(viewer);
      if (!star) continue;
      for (const rect of levelRects)
        if (rect.level === "bright") pieces.push(...clippedPieces(star, rectPolygon(rect)));
      for (const light of lights)
        if (light.brightPx > 0 && shown(light))
          pieces.push(...clipToStar(lightPolygon(light, light.brightPx), star, viewer.at));
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
    seesPoint,
    lineOfSight,
    lightAt,
    obscurementAt,
    fogAt,
    positionOf: (actorId) => tokens.get(actorId)?.position ?? null,
    areaOf,
    brightOf,
    perceivedBy
  };
}

/** The part of a star-shaped sight inside a convex shape, dropping slivers with no area. */
function clippedPieces(star: Polygon, convex: Polygon): Polygon[] {
  const clipped = clipToConvex(star, convex);
  return clipped.length >= 3 ? [clipped] : [];
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

/** Half a creature's space in pixels, for measuring from its edge. */
export { halfSpaceOf };
