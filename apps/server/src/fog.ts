import type { CombatState, GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { layerSlice, normalizedRect, type LayerMapGeometry, type PaintRectInput } from "./map-layers.js";
import { subtractRect, unionRect, type Rect } from "./rect-region.js";

export type FogMapGeometry = LayerMapGeometry;
export type FogRectInput = PaintRectInput;

const MAX_FOG_SHAPES = 200;

/** Manual fog of war: the GM paints reveal/hide rects over a per-scene mask that starts all hidden. The
 *  live table and a parked scene's private prep (`sceneId`) share this one implementation. */

const fogSlice = (state: GameState, sceneId: string | undefined) => {
  const slice = layerSlice(state, sceneId, "fog", "That scene is live. Edit its fog on the table.");
  return { fog: slice.layer, write: slice.write };
};

export function setFogEnabled(state: GameState, sceneId: string | undefined, enabled: boolean) {
  const slice = fogSlice(state, sceneId);
  slice.write({ ...slice.fog, enabled });
}

/** Everything hidden again ("Hide all": enabled fog with no reveals covers the whole map). */
export function resetFog(state: GameState, sceneId: string | undefined) {
  const slice = fogSlice(state, sceneId);
  slice.write({ ...slice.fog, shapes: [] });
}

export function paintFog(
  state: GameState,
  sceneId: string | undefined,
  geometry: FogMapGeometry,
  input: Readonly<{ id: string; op: "reveal" | "hide"; rect: FogRectInput }>
) {
  const slice = fogSlice(state, sceneId);
  const rect = normalizedRect(geometry, input.rect, "Drag a larger area to paint fog.");
  // A stroke covering the whole map supersedes everything before it, so compact instead of accumulating.
  const coversMap =
    rect.x <= 0 && rect.y <= 0 && rect.x + rect.width >= geometry.width && rect.y + rect.height >= geometry.height;
  const kept = coversMap ? [] : slice.fog.shapes;
  if (kept.length >= MAX_FOG_SHAPES)
    throw new CommandRejectedError("The fog has too many strokes. Reset it and reveal again.");
  slice.write({ ...slice.fog, shapes: [...kept, { kind: "rect", id: input.id, op: input.op, ...rect }] });
}

/** The area players can see through the fog: everything when fog is off, else the reveals and hides in order
 *  over a map that starts hidden. */
export function revealedRegion(fog: CombatState["fog"]): readonly Rect[] | "everything" {
  if (!fog.enabled) return "everything";
  let region: Rect[] = [];
  for (const shape of fog.shapes) {
    const rect = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    region = shape.op === "reveal" ? unionRect(region, rect) : subtractRect(region, rect);
  }
  return region;
}
