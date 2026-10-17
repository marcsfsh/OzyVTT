import { GameStateSchema, type GameState, type VisionLight, type VisionWall } from "@vtt/domain";
import type { TokenMapGeometry } from "../src/token-placement.js";

/** A 1000 x 600 battlemap of 50-pixel, 5-foot cells (10 pixels a foot), and the creatures the vision tests use. */

export const MAP = "20000000-0000-5000-8000-000000000001";
export const SESSION_A = "30000000-0000-4000-8000-0000000000a1";
export const SESSION_B = "30000000-0000-4000-8000-0000000000b2";
/** Session A's character. */
export const HERO = "10000000-0000-4000-8000-000000000001";
/** Session B's character. */
export const FRIEND = "10000000-0000-4000-8000-000000000002";
/** A public monster the walls hide. */
export const GOBLIN = "10000000-0000-4000-8000-000000000003";
export const GOBLIN_NAME = "Skulking Goblin";
export const ORC = "10000000-0000-4000-8000-000000000004";

export const GEOMETRY: TokenMapGeometry = {
  width: 1000,
  height: 600,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
export const MEASURE = { width: 1000, height: 600, pixelsPerFoot: 10 };

/** The centre of cell (column, row). */
export const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

let wallCount = 0;
export function wall(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
  kind: VisionWall["kind"] = "wall",
  open?: boolean
): VisionWall {
  wallCount++;
  return {
    id: `50000000-0000-4000-8000-${String(wallCount).padStart(12, "0")}`,
    kind,
    a: { ...a },
    b: { ...b },
    ...(kind === "door" ? { open: open === true } : {})
  };
}

/** A wall the full height of the map along x = 250, between column 4 and column 5. */
export const DIVIDER = () => wall({ x: 250, y: 0 }, { x: 250, y: 600 });

export type VisionGameOptions = Readonly<{
  enabled?: boolean;
  ambient?: "bright" | "dim" | "dark";
  walls?: readonly VisionWall[];
  lights?: readonly VisionLight[];
  positions?: Readonly<Record<string, { x: number; y: number } | null>>;
  /** Per-actor fields over the defaults (conditions, inventory, definitionId...). */
  actors?: Readonly<Record<string, Record<string, unknown>>>;
  definitions?: readonly unknown[];
  active?: boolean;
  /** Manual fog over the map: on, with these reveals (rects in pixels) in order. */
  reveals?: ReadonlyArray<Readonly<{ x: number; y: number; width: number; height: number; op?: "reveal" | "hide" }>>;
}>;

/** A fight on the map: Hero (A) at cell (1,5), the goblin at (8,5), Friend (B) and the orc unplaced unless placed. */
export function visionGame(options: VisionGameOptions = {}): GameState {
  const base = [
    { id: HERO, name: "Borin", kind: "player-character", ownerSessionId: SESSION_A },
    { id: FRIEND, name: "Mirena", kind: "player-character", ownerSessionId: SESSION_B },
    { id: GOBLIN, name: GOBLIN_NAME, kind: "monster" },
    { id: ORC, name: "Orc", kind: "monster" }
  ];
  const positions: Record<string, { x: number; y: number } | null> = {
    [HERO]: cell(1, 5),
    [GOBLIN]: cell(8, 5),
    [FRIEND]: null,
    [ORC]: null,
    ...options.positions
  };
  const actors = base.map((actor) => ({
    ...actor,
    visibility: "public",
    hp: { current: 10, maximum: 10 },
    speedFeet: 30,
    ...options.actors?.[actor.id]
  }));
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors,
    definitions: options.definitions ?? [],
    combat: {
      active: options.active ?? true,
      round: 1,
      turnActorId: HERO,
      mapAssetId: MAP,
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: actors.map((actor) => ({
        actorId: actor.id,
        position: positions[actor.id] ?? null,
        sizePx: 41,
        gridSizePx: 50
      })),
      ...(options.reveals
        ? {
            fog: {
              enabled: true,
              shapes: options.reveals.map((rect, index) => ({
                kind: "rect",
                id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                op: rect.op ?? "reveal",
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }))
            }
          }
        : {}),
      vision: {
        enabled: options.enabled ?? true,
        ambient: options.ambient ?? "bright",
        walls: options.walls ?? [],
        lights: options.lights ?? [],
        measure: MEASURE
      }
    }
  });
}

/** Freezes a state as the server's committed reads are, so the projections' caches apply. */
export function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}
