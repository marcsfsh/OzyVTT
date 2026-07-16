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

/**
 * Circle/cone/line: origin snaps to the grid, size snaps to whole cells along the drag direction.
 * Directional shapes (cone/line) also snap their angle to the nearest 45° relative to the grid, so
 * they can't be placed at arbitrary off-grid rotations.
 */
function radialGeometry(calibration: SquareGridCalibration, origin: AnnotationPoint, target: AnnotationPoint): AnnotationGeometry {
  const snappedOrigin = snapImagePoint(calibration, origin, "cell-center").image;
  const dx = target.x - snappedOrigin.x;
  const dy = target.y - snappedOrigin.y;
  const pixelDistance = Math.hypot(dx, dy);
  const cells = Math.max(1, Math.round(pixelDistance / calibration.cellSizePx));
  const sizeFeet = cells * calibration.distancePerCell;
  const sizePx = cells * calibration.cellSizePx;
  const angle = pixelDistance === 0 ? 0 : Math.atan2(dy, dx);
  return { origin: snappedOrigin, target: { x: snappedOrigin.x + Math.cos(angle) * sizePx, y: snappedOrigin.y + Math.sin(angle) * sizePx }, sizeFeet };
}

/**
 * Cone/line: the origin (apex) and the far end (a cone's base center) each snap to a grid cell
 * center, so the shape points in any direction while both ends stay grid-aligned, instead of
 * snapping the rotation to fixed increments.
 */
function pointableGeometry(calibration: SquareGridCalibration, origin: AnnotationPoint, target: AnnotationPoint): AnnotationGeometry {
  const snappedOrigin = snapImagePoint(calibration, origin, "cell-center").image;
  let snappedTarget = snapImagePoint(calibration, target, "cell-center").image;
  if (snappedTarget.x === snappedOrigin.x && snappedTarget.y === snappedOrigin.y) {
    const angle = Math.atan2(target.y - origin.y, target.x - origin.x) || 0;
    snappedTarget = snapImagePoint(calibration, { x: snappedOrigin.x + Math.cos(angle) * calibration.cellSizePx, y: snappedOrigin.y + Math.sin(angle) * calibration.cellSizePx }, "cell-center").image;
  }
  const cells = Math.max(1, Math.round(Math.hypot(snappedTarget.x - snappedOrigin.x, snappedTarget.y - snappedOrigin.y) / calibration.cellSizePx));
  return { origin: snappedOrigin, target: snappedTarget, sizeFeet: cells * calibration.distancePerCell };
}

function shapeGeometry(calibration: SquareGridCalibration, shape: AnnotationShapeKind, origin: AnnotationPoint, target: AnnotationPoint): AnnotationGeometry {
  if (shape === "square") return squareGeometry(calibration, origin, target);
  if (shape === "circle") return radialGeometry(calibration, origin, target);
  return pointableGeometry(calibration, origin, target);
}

function requireOwnedOrGm(annotation: Annotation, actor: AnnotationActor, action: string) {
  if (actor.role !== "gm" && annotation.ownerSessionId !== actor.sessionId) throw new CommandRejectedError(`You may only ${action} your own ${annotation.kind === "shape" ? "shapes" : "measurements"}.`);
}

/** GM and owner may always move/resize; a shape may also delegate move control to any player via `movableByOthers`. */
function requireMoveAllowed(annotation: Annotation, actor: AnnotationActor) {
  if (actor.role === "gm" || annotation.ownerSessionId === actor.sessionId || annotation.movableByOthers) return;
  throw new CommandRejectedError("That shape's owner has not shared move control with other players.");
}

/**
 * Players may only choose visibilities relative to themselves (public / owner-only / owner+gm);
 * only the GM may hide from players (gm-only) or reveal to one specific character (gm-actor + target).
 */
function resolveVisibility(state: GameState, actor: AnnotationActor, visibility: AnnotationVisibility, visibleToActorId: string | null): { visibility: AnnotationVisibility; visibleToActorId: string | null } {
  if (actor.role === "gm") {
    if (!(["public", "gm-only", "gm-actor"] as const).includes(visibility as "public" | "gm-only" | "gm-actor")) throw new CommandRejectedError("Choose Everyone, Just the GM, or a specific character.");
    if (visibility === "gm-actor") {
      if (!visibleToActorId || !state.actors.some((candidate) => candidate.id === visibleToActorId)) throw new CommandRejectedError("Pick a character to reveal this to.");
      return { visibility, visibleToActorId };
    }
    return { visibility, visibleToActorId: null };
  }
  if (!(["public", "owner-only", "owner-gm"] as const).includes(visibility as "public" | "owner-only" | "owner-gm")) throw new CommandRejectedError("Choose Everyone, Just me, or Just me and the GM.");
  return { visibility, visibleToActorId: null };
}

export function addAnnotation(
  state: GameState,
  input: Readonly<{ id: string; kind: "measurement" | "shape"; shape?: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint; visibility: AnnotationVisibility; visibleToActorId?: string | null; movableByOthers?: boolean; actor: AnnotationActor; now: number }>,
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
  const resolved = resolveVisibility(state, input.actor, input.visibility, input.visibleToActorId ?? null);
  const pruned = state.combat.annotations.filter((existing) => existing.expiresAt === null || existing.expiresAt > input.now);
  if (pruned.length >= 300) throw new CommandRejectedError("Too many annotations are on the map. Remove some before adding more.");
  const annotation: Annotation = {
    id: input.id,
    kind: input.kind,
    shape: input.kind === "shape" ? input.shape! : null,
    geometry,
    ownerSessionId: input.actor.sessionId,
    createdByRole: input.actor.role,
    visibility: resolved.visibility,
    visibleToActorId: resolved.visibleToActorId,
    movableByOthers: input.kind === "shape" ? (input.movableByOthers ?? false) : false,
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
  requireMoveAllowed(existing, actor);
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

/** GM may clear all shapes, only the players' shapes, or their own; a player may only clear their own. */
export function clearAnnotations(state: GameState, scope: "mine" | "players" | "all", actor: AnnotationActor) {
  if (scope !== "mine" && actor.role !== "gm") throw new CommandRejectedError("Only the GM can remove other players' shapes.");
  const keep = (annotation: Annotation) => {
    if (scope === "all") return false;
    if (scope === "players") return annotation.createdByRole !== "player";
    return annotation.ownerSessionId !== actor.sessionId;
  };
  state.combat = { ...state.combat, annotations: state.combat.annotations.filter(keep) };
}

export function setAnnotationVisibility(state: GameState, id: string, visibility: AnnotationVisibility, visibleToActorId: string | null, actor: AnnotationActor) {
  const existing = state.combat.annotations.find((annotation) => annotation.id === id);
  if (!existing) throw new CommandRejectedError("That annotation no longer exists.");
  requireOwnedOrGm(existing, actor, "change visibility on");
  const resolved = resolveVisibility(state, actor, visibility, visibleToActorId);
  state.combat = { ...state.combat, annotations: state.combat.annotations.map((annotation) => annotation.id === id ? { ...annotation, visibility: resolved.visibility, visibleToActorId: resolved.visibleToActorId } : annotation) };
}

export function setAnnotationMovable(state: GameState, id: string, movableByOthers: boolean, actor: AnnotationActor) {
  const existing = state.combat.annotations.find((annotation) => annotation.id === id);
  if (!existing) throw new CommandRejectedError("That annotation no longer exists.");
  if (existing.kind !== "shape") throw new CommandRejectedError("Only placed shapes can share move control.");
  requireOwnedOrGm(existing, actor, "change move control on");
  state.combat = { ...state.combat, annotations: state.combat.annotations.map((annotation) => annotation.id === id ? { ...annotation, movableByOthers } : annotation) };
}

/** Soonest future expiry among current annotations, or null if none are ephemeral — used to schedule the next expiry re-broadcast. */
export function nextAnnotationExpiry(state: GameState, now: number): number | null {
  const expiries = state.combat.annotations
    .map((annotation) => annotation.expiresAt)
    .filter((expiresAt): expiresAt is number => expiresAt !== null && expiresAt > now);
  return expiries.length ? Math.min(...expiries) : null;
}
