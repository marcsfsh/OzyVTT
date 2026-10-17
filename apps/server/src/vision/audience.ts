import type { GameState, PlayerVision, PlayerVisionWall, VisionPolygon, VisionRect } from "@vtt/domain";
import { flatPolygon, type Point, type Polygon } from "./geometry.js";
import {
  decodeBits,
  emptyBits,
  encodeBits,
  exploredGridFor,
  isMarked,
  markedRects,
  markPolygons,
  type ExploredGrid
} from "./explored.js";
import type { SightContent } from "./senses.js";
import { sceneSight } from "./sight.js";

/**
 * Dynamic vision per audience (ADR-0023): a player sees through their own characters, the table screen and a replay
 * through the whole party. This is the projections' one source for "may this audience know of that creature".
 */

type Actor = GameState["actors"][number];

export type AudienceSight = Readonly<{
  /** Dynamic vision is on for the live scene; when false nothing below applies and the projections behave as before. */
  enabled: boolean;
  /** Creatures this audience must not learn of at all, treated as hidden from it like a GM-only one: on the live
   *  scene, those that aren't player characters and none of its viewers perceive; and those staged in a prepared
   *  scene with vision on, until they stand where the party can see them. */
  hidden: ReadonlySet<string>;
  /** The placed creatures whose tokens it may receive. */
  perceived: ReadonlySet<string>;
  /** Whose eyes it sees through. */
  viewerIds: readonly string[];
}>;

const OFF: AudienceSight = { enabled: false, hidden: new Set(), perceived: new Set(), viewerIds: [] };

/** The creatures other than player characters staged in a prepared scene with vision on, and not on the live map:
 *  the GM's ambush stays a secret while it is set up. */
function stagedUnseen(state: GameState): Set<string> {
  const live = new Set(state.combat.initiative.map((entry) => entry.actorId));
  const staged = new Set<string>();
  for (const scene of state.combat.scenes) {
    // A recording made before dynamic vision has none on its scenes either.
    if (scene.id === state.combat.activeSceneId || scene.combat.vision?.enabled !== true) continue;
    for (const entry of scene.combat.initiative) if (!live.has(entry.actorId)) staged.add(entry.actorId);
  }
  const kinds = new Map(state.actors.map((actor) => [actor.id, actor.kind]));
  for (const actorId of staged) if (kinds.get(actorId) === "player-character") staged.delete(actorId);
  return staged;
}

const placed = (state: GameState, actorId: string) =>
  state.combat.tokens.some((token) => token.actorId === actorId && token.position !== null);
const inPlay = (actor: Actor) => actor.visibility === "public" && !actor.archived;

/** A player's own characters on the live map. */
export function playerViewerIds(state: GameState, sessionId: string): string[] {
  return state.actors
    .filter((actor) => actor.ownerSessionId === sessionId && inPlay(actor) && placed(state, actor.id))
    .map((actor) => actor.id);
}

/** The party's characters on the live map, claimed or not: the table screen and a replay see through them. */
export function partyViewerIds(state: GameState): string[] {
  return state.actors
    .filter((actor) => actor.kind === "player-character" && inPlay(actor) && placed(state, actor.id))
    .map((actor) => actor.id);
}

const audienceCache = new WeakMap<GameState, Map<string, AudienceSight>>();

function cached<T>(cache: WeakMap<GameState, Map<string, T>>, state: GameState, key: string, compute: () => T): T {
  if (!Object.isFrozen(state)) return compute();
  let byKey = cache.get(state);
  if (!byKey) cache.set(state, (byKey = new Map()));
  const known = byKey.get(key);
  if (known !== undefined) return known;
  const value = compute();
  byKey.set(key, value);
  return value;
}

/** What an audience seeing through `viewerIds` may know of the creatures on the live and prepared scenes. */
export function audienceSight(state: GameState, viewerIds: readonly string[], content: SightContent): AudienceSight {
  const sight = sceneSight(state, content);
  return cached(audienceCache, state, `${sight.enabled}|${viewerIds.join(",")}`, () => {
    const hidden = stagedUnseen(state);
    if (!sight.enabled) return hidden.size === 0 ? OFF : { ...OFF, hidden };
    const perceived = sight.perceivedBy(viewerIds);
    const combatants = new Set([
      ...state.combat.initiative.map((entry) => entry.actorId),
      ...state.combat.tokens.map((token) => token.actorId)
    ]);
    for (const actor of state.actors)
      if (combatants.has(actor.id) && actor.kind !== "player-character" && !perceived.has(actor.id))
        hidden.add(actor.id);
    return { enabled: true, hidden, perceived, viewerIds };
  });
}

/** A player's audience: their own characters' eyes. Without a session (a spectator), the party's. */
export function playerSight(state: GameState, sessionId: string | undefined, content: SightContent): AudienceSight {
  return audienceSight(
    state,
    sessionId === undefined ? partyViewerIds(state) : playerViewerIds(state, sessionId),
    content
  );
}

export function partySight(state: GameState, content: SightContent): AudienceSight {
  return audienceSight(state, partyViewerIds(state), content);
}

/** The party's remembered squares, decoded; null while nothing is remembered or the map's size changed under it. */
function explored(state: GameState): { grid: ExploredGrid; bytes: Uint8Array } | null {
  const vision = state.combat.vision;
  if (!vision.measure || !vision.explored) return null;
  const grid = exploredGridFor(vision.measure);
  const stored = vision.explored;
  if (stored.columns !== grid.columns || stored.rows !== grid.rows || Math.abs(stored.cellPx - grid.cellPx) > 1e-6)
    return null;
  return { grid, bytes: decodeBits(grid, stored.bits) };
}

/** What the party has seen on the live scene, as disjoint rects. */
export function exploredRectsOf(state: GameState): VisionRect[] {
  const memory = explored(state);
  return memory ? markedRects(memory.grid, memory.bytes) : [];
}

/** Points just either side of a wall along its length, to ask whether the squares beside it are in sight. */
function wallSamples(a: Point, b: Point, spacing: number): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return [a];
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const steps = Math.max(1, Math.ceil(length / spacing));
  const offset = spacing * 0.6;
  const samples: Point[] = [];
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    samples.push({ x: at.x + normal.x * offset, y: at.y + normal.y * offset });
    samples.push({ x: at.x - normal.x * offset, y: at.y - normal.y * offset });
  }
  return samples;
}

const visionCache = new WeakMap<GameState, Map<string, PlayerVision>>();

/** The vision block of one audience's projection: where it sees now, what the party has seen, and the walls in it. */
export function visionOf(state: GameState, viewerIds: readonly string[], content: SightContent): PlayerVision {
  const sight = sceneSight(state, content);
  const measure = state.combat.vision.measure;
  if (!sight.enabled || !measure) return { enabled: false };
  return cached(visionCache, state, viewerIds.join(","), () => {
    const area = sight.areaOf(viewerIds);
    const memory = explored(state);
    const grid = memory?.grid ?? exploredGridFor(measure);
    const now = emptyBits(grid);
    markPolygons(grid, now, area);
    const known = (point: Point) => isMarked(grid, now, point) || (memory ? isMarked(grid, memory.bytes, point) : false);
    const walls: PlayerVisionWall[] = [];
    for (const wall of state.combat.vision.walls) {
      const samples = wallSamples(wall.a, wall.b, grid.cellPx);
      if (!samples.some(known)) continue;
      const inSight = wall.kind === "door" && samples.some((point) => isMarked(grid, now, point));
      walls.push({
        id: wall.id,
        kind: wall.kind,
        a: { ...wall.a },
        b: { ...wall.b },
        ...(inSight ? { open: wall.open === true } : {})
      });
    }
    return {
      enabled: true,
      visible: area.map((polygon): VisionPolygon => flatPolygon(polygon)),
      explored: exploredRectsOf(state),
      walls
    };
  });
}

/** Adds what the party sees now to what it has seen. Runs after every command, inside it; a no-op unless the live
 *  scene's vision is on. */
export function rememberExplored(state: GameState, content: SightContent): void {
  const vision = state.combat.vision;
  const sight = sceneSight(state, content);
  if (!sight.enabled || !vision.measure) return;
  const viewers = partyViewerIds(state);
  if (viewers.length === 0) return;
  const area: Polygon[] = sight.areaOf(viewers);
  const memory = explored(state);
  const grid = memory?.grid ?? exploredGridFor(vision.measure);
  const bytes = memory?.bytes ?? emptyBits(grid);
  if (!markPolygons(grid, bytes, area) && memory) return;
  state.combat = {
    ...state.combat,
    vision: { ...vision, explored: { ...grid, bits: encodeBits(bytes) } }
  };
}
