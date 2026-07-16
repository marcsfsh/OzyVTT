import type { Annotation, AnnotationGeometry, AnnotationPoint, AnnotationShapeKind, AnnotationVisibility, GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { gridToImage, imageToGrid, snapImagePoint, type SquareGridCalibration } from "./grid-calibration.js";
import { measureGridPath } from "./map-measurement.js";

export type AnnotationMapGeometry = Readonly<{ width: number; height: number; calibration: SquareGridCalibration | null }>;
export type AnnotationActor = Readonly<{ sessionId: string; role: "gm" | "player" }>;

function requireCalibration(geometry: AnnotationMapGeometry): SquareGridCalibration {
  if (!geometry.calibration) throw new CommandRejectedError("Complete the grid wizard for this map before measuring or placing shapes.");
  return geometry.calibration;
}

function withinMap(point: AnnotationPoint, geometry: AnnotationMapGeometry, label: string) {
  if (point.x < 0 || point.x > geometry.width || point.y < 0 || point.y > geometry.height) throw new CommandRejectedError(`${label} must be inside the map.`);
}

/** Snaps both endpoints to grid cell centers and measures whole-cell Chebyshev distance (every cell = one grid step, no diagonal penalty), matching 5e's simplified movement rule. */
function measurementGeometry(calibration: SquareGridCalibration, origin: AnnotationPoint, target: AnnotationPoint): AnnotationGeometry {
  const measurement = measureGridPath(calibration, [origin, target], { rule: "chebyshev", snapMode: "cell-center" });
  const segment = measurement.segments[0];
  const sizeFeet = Math.round(measurement.totalDistance);
  if (sizeFeet <= 0) throw new CommandRejectedError("Drag to a different grid cell before measuring.");
  return { origin: segment.from, target: segment.to, sizeFeet };
}

/** Axis-aligned square anchored at a snapped grid intersection; both sides grow together (same rule as the grid-wizard drag). */
function squareGeometry(calibration: SquareGridCalibration, origin: AnnotationPoint, target: AnnotationPoint): AnnotationGeometry {
  const start = imageToGrid(calibration, origin);
  const raw = imageToGrid(calibration, target);
  const startSnapped = { column: Math.round(start.column), row: Math.round(start.row) };
  const deltaColumn = raw.column - start.column;
  const deltaRow = raw.row - start.row;
  const side = Math.max(1, Math.round(Math.max(Math.abs(deltaColumn), Math.abs(deltaRow))));
  const signColumn = deltaColumn < 0 ? -1 : 1;
  const signRow = deltaRow < 0 ? -1 : 1;
  const endSnapped = { column: startSnapped.column + signColumn * side, row: startSnapped.row + signRow * side };
  return { origin: gridToImage(calibration, startSnapped), target: gridToImage(calibration, endSnapped), sizeFeet: side * calibration.distancePerCell };
}

/** Circle/cone/line: origin snaps to the grid, size snaps to whole cells along the drag direction. */
function radialGeometry(calibration: SquareGridCalibration, origin: AnnotationPoint, target: AnnotationPoint, originSnap: "cell-center" | "intersection"): AnnotationGeometry {
  const snappedOrigin = snapImagePoint(calibration, origin, originSnap).image;
  const dx = target.x - snappedOrigin.x;
  const dy = target.y - snappedOrigin.y;
  const pixelDistance = Math.hypot(dx, dy);
  const cells = Math.max(1, Math.round(pixelDistance / calibration.cellSizePx));
  const sizeFeet = cells * calibration.distancePerCell;
  const sizePx = cells * calibration.cellSizePx;
  const angle = pixelDistance === 0 ? 0 : Math.atan2(dy, dx);
  const snappedTarget = { x: snappedOrigin.x + Math.cos(angle) * sizePx, y: snappedOrigin.y + Math.sin(angle) * sizePx };
  return { origin: snappedOrigin, target: snappedTarget, sizeFeet };
}

function shapeGeometry(calibration: SquareGridCalibration, shape: AnnotationShapeKind, origin: AnnotationPoint, target: AnnotationPoint): AnnotationGeometry {
  if (shape === "square") return squareGeometry(calibration, origin, target);
  if (shape === "circle") return radialGeometry(calibration, origin, target, "cell-center");
  return radialGeometry(calibration, origin, target, "intersection");
}

function requireOwnedOrGm(annotation: Annotation, actor: AnnotationActor, action: string) {
  if (actor.role !== "gm" && annotation.ownerSessionId !== actor.sessionId) throw new CommandRejectedError(`You may only ${action} your own ${annotation.kind === "shape" ? "shapes" : "measurements"}.`);
}

export function addAnnotation(
  state: GameState,
  input: Readonly<{ id: string; kind: "measurement" | "shape"; shape?: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint; visibility: AnnotationVisibility; actor: AnnotationActor; now: number }>,
  geometryInput: AnnotationMapGeometry
): Annotation {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before measuring or placing shapes.");
  if (input.kind === "shape" && !input.shape) throw new CommandRejectedError("Choose a shape before placing it.");
  const calibration = requireCalibration(geometryInput);
  withinMap(input.origin, geometryInput, "The starting point");
  withinMap(input.target, geometryInput, "The endpoint");
  const geometry = input.kind === "measurement"
    ? measurementGeometry(calibration, input.origin, input.target)
    : shapeGeometry(calibration, input.shape!, input.origin, input.target);
  const pruned = state.combat.annotations.filter((existing) => existing.expiresAt === null || existing.expiresAt > input.now);
  if (pruned.length >= 300) throw new CommandRejectedError("Too many annotations are on the map. Remove some before adding more.");
  const annotation: Annotation = {
    id: input.id,
    kind: input.kind,
    shape: input.kind === "shape" ? input.shape! : null,
    geometry,
    ownerSessionId: input.actor.sessionId,
    createdByRole: input.actor.role,
    visibility: input.kind === "measurement" ? "public" : input.visibility,
    createdAt: input.now,
    expiresAt: input.kind === "measurement" ? input.now + 5000 : null
  };
  state.combat = { ...state.combat, annotations: [...pruned, annotation] };
  return annotation;
}

export function moveAnnotation(state: GameState, id: string, origin: AnnotationPoint, target: AnnotationPoint, actor: AnnotationActor, geometryInput: AnnotationMapGeometry) {
  const existing = state.combat.annotations.find((annotation) => annotation.id === id);
  if (!existing) throw new CommandRejectedError("That annotation no longer exists.");
  if (existing.kind !== "shape") throw new CommandRejectedError("Only placed shapes can be moved or resized.");
  requireOwnedOrGm(existing, actor, "move");
  const calibration = requireCalibration(geometryInput);
  withinMap(origin, geometryInput, "The starting point");
  withinMap(target, geometryInput, "The endpoint");
  const geometry = shapeGeometry(calibration, existing.shape!, origin, target);
  state.combat = { ...state.combat, annotations: state.combat.annotations.map((annotation) => annotation.id === id ? { ...annotation, geometry } : annotation) };
}

export function removeAnnotation(state: GameState, id: string, actor: AnnotationActor) {
  const existing = state.combat.annotations.find((annotation) => annotation.id === id);
  if (!existing) throw new CommandRejectedError("That annotation no longer exists.");
  requireOwnedOrGm(existing, actor, "remove");
  state.combat = { ...state.combat, annotations: state.combat.annotations.filter((annotation) => annotation.id !== id) };
}

export function setAnnotationVisibility(state: GameState, id: string, visibility: AnnotationVisibility, actor: AnnotationActor) {
  const existing = state.combat.annotations.find((annotation) => annotation.id === id);
  if (!existing) throw new CommandRejectedError("That annotation no longer exists.");
  if (existing.kind === "measurement") throw new CommandRejectedError("Measurements are always visible to everyone.");
  requireOwnedOrGm(existing, actor, "change visibility on");
  state.combat = { ...state.combat, annotations: state.combat.annotations.map((annotation) => annotation.id === id ? { ...annotation, visibility } : annotation) };
}

/** Soonest future expiry among current annotations, or null if none are ephemeral — used to schedule the next expiry re-broadcast. */
export function nextAnnotationExpiry(state: GameState, now: number): number | null {
  const expiries = state.combat.annotations
    .map((annotation) => annotation.expiresAt)
    .filter((expiresAt): expiresAt is number => expiresAt !== null && expiresAt > now);
  return expiries.length ? Math.min(...expiries) : null;
}
