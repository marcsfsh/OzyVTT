import type { GameState, SceneCombat } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { gridToImage, imageToGrid, type SquareGridCalibration } from "./grid-calibration.js";

export type FogMapGeometry = Readonly<{ width: number; height: number; calibration: SquareGridCalibration | null }>;
export type FogRectInput = Readonly<{ x: number; y: number; width: number; height: number }>;

const MAX_FOG_SHAPES = 200;

/**
 * Manual fog of war (AboveVTT-inspired, design study only): the GM paints reveal/hide rects over a
 * per-scene mask folded from "all hidden". All mutation goes through here so the live table and a
 * parked scene's GM-private prep (`sceneId`, the token-move pattern) share one implementation.
 */

/** The combat slice a fog edit targets: the live table, or a parked scene's stored combat. */
function fogSlice(state: GameState, sceneId: string | undefined): { fog: SceneCombat["fog"]; write: (fog: SceneCombat["fog"]) => void } {
  if (sceneId === undefined) {
    return { fog: state.combat.fog, write: (fog) => { state.combat = { ...state.combat, fog }; } };
  }
  const scene = state.combat.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new CommandRejectedError("That scene no longer exists.");
  // The active scene's stored combat must stay empty (single source of truth) - edit the live fog instead.
  if (scene.id === state.combat.activeSceneId) throw new CommandRejectedError("That scene is live - edit its fog on the table.");
  return {
    fog: scene.combat.fog,
    write: (fog) => { state.combat = { ...state.combat, scenes: state.combat.scenes.map((candidate) => candidate.id === sceneId ? { ...candidate, combat: { ...candidate.combat, fog } } : candidate) }; }
  };
}

export function setFogEnabled(state: GameState, sceneId: string | undefined, enabled: boolean) {
  const slice = fogSlice(state, sceneId);
  slice.write({ ...slice.fog, enabled });
}

/** Everything hidden again (= the "Hide all" tool: enabled fog with no reveals covers the whole map). */
export function resetFog(state: GameState, sceneId: string | undefined) {
  const slice = fogSlice(state, sceneId);
  slice.write({ ...slice.fog, shapes: [] });
}

/**
 * Snap a dragged rect to whole grid cells on a calibrated, unrotated map (rotated grids keep the
 * raw pixel rect - axis-aligned snapping would distort against a rotated lattice; documented
 * simplification), then clamp to the map bounds. Gridless maps always keep raw pixels.
 */
function normalizedRect(geometry: FogMapGeometry, rect: FogRectInput): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = rect;
  const calibration = geometry.calibration;
  if (calibration && Math.abs(calibration.rotationRadians) < 1e-6) {
    const start = imageToGrid(calibration, { x, y });
    const end = imageToGrid(calibration, { x: x + width, y: y + height });
    const columns = [Math.round(start.column), Math.round(end.column)].sort((a, b) => a - b);
    const rows = [Math.round(start.row), Math.round(end.row)].sort((a, b) => a - b);
    if (columns[1] === columns[0]) columns[1] += 1;
    if (rows[1] === rows[0]) rows[1] += 1;
    const topLeft = gridToImage(calibration, { column: columns[0], row: rows[0] });
    const bottomRight = gridToImage(calibration, { column: columns[1], row: rows[1] });
    x = topLeft.x; y = topLeft.y; width = bottomRight.x - topLeft.x; height = bottomRight.y - topLeft.y;
  }
  const left = Math.max(0, Math.min(x, geometry.width));
  const top = Math.max(0, Math.min(y, geometry.height));
  const right = Math.max(left, Math.min(x + width, geometry.width));
  const bottom = Math.max(top, Math.min(y + height, geometry.height));
  if (right - left < 1 || bottom - top < 1) throw new CommandRejectedError("Drag a larger area to paint fog.");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function paintFog(state: GameState, sceneId: string | undefined, geometry: FogMapGeometry, input: Readonly<{ id: string; op: "reveal" | "hide"; rect: FogRectInput }>) {
  const slice = fogSlice(state, sceneId);
  const rect = normalizedRect(geometry, input.rect);
  // A stroke covering the whole map supersedes everything before it ("Reveal all" / re-covering
  // from scratch) - compact instead of accumulating toward the cap.
  const coversMap = rect.x <= 0 && rect.y <= 0 && rect.x + rect.width >= geometry.width && rect.y + rect.height >= geometry.height;
  const kept = coversMap ? [] : slice.fog.shapes;
  if (kept.length >= MAX_FOG_SHAPES) throw new CommandRejectedError("The fog has too many strokes - Reset it and reveal again.");
  slice.write({ ...slice.fog, shapes: [...kept, { kind: "rect", id: input.id, op: input.op, ...rect }] });
}
