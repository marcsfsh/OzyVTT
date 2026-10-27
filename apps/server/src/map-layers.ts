import type { GameState, SceneCombat } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { gridToImage, imageToGrid, type SquareGridCalibration } from "./grid-calibration.js";

/** The GM's map layers (fog, difficult terrain, vision) share how an edit finds its scene and its cells. */

export type LayerMapGeometry = Readonly<{ width: number; height: number; calibration: SquareGridCalibration | null }>;
export type PaintRectInput = Readonly<{ x: number; y: number; width: number; height: number }>;

/** A layer of the combat a stroke targets: the live table, or a parked scene's stored combat. */
export function layerSlice<Key extends "fog" | "terrain" | "vision" | "traps">(
  state: GameState,
  sceneId: string | undefined,
  key: Key,
  liveRefusal: string
): { layer: SceneCombat[Key]; write: (layer: SceneCombat[Key]) => void } {
  if (sceneId === undefined) {
    return {
      layer: state.combat[key],
      write: (layer) => {
        state.combat = { ...state.combat, [key]: layer };
      }
    };
  }
  const scene = state.combat.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new CommandRejectedError("That scene no longer exists.");
  // The active scene's stored combat must stay empty (single source of truth); the live copy is edited instead.
  if (scene.id === state.combat.activeSceneId) throw new CommandRejectedError(liveRefusal);
  return {
    layer: scene.combat[key],
    write: (layer) => {
      state.combat = {
        ...state.combat,
        scenes: state.combat.scenes.map((candidate) =>
          candidate.id === sceneId ? { ...candidate, combat: { ...candidate.combat, [key]: layer } } : candidate
        )
      };
    }
  };
}

/** Snaps a dragged rect to whole cells on a calibrated, unrotated map, then clamps to the map bounds.
 *  Rotated grids and gridless maps keep the raw pixel rect. */
export function normalizedRect(
  geometry: LayerMapGeometry,
  rect: PaintRectInput,
  tooSmall: string
): { x: number; y: number; width: number; height: number } {
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
    x = topLeft.x;
    y = topLeft.y;
    width = bottomRight.x - topLeft.x;
    height = bottomRight.y - topLeft.y;
  }
  const left = Math.max(0, Math.min(x, geometry.width));
  const top = Math.max(0, Math.min(y, geometry.height));
  const right = Math.max(left, Math.min(x + width, geometry.width));
  const bottom = Math.max(top, Math.min(y + height, geometry.height));
  if (right - left < 1 || bottom - top < 1) throw new CommandRejectedError(tooSmall);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
