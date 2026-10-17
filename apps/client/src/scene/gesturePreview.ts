import type { Annotation, PlayerAnnotation } from "@vtt/domain";
import type { AnnotationGlyphData } from "./annotationGlyph";
import {
  sizedShapePreview,
  snapMeasurementPreview,
  snapShapePreview,
  type GridCalibration,
  type SnappedGeometry
} from "./gridPreview";
import type { Gesture } from "./useMapGestures";

/** The live, grid-snapped drawing of a measure or shape gesture in progress, matching what the server will save. */
export function gesturePreview(
  calibration: GridCalibration | null,
  gesture: Gesture | null,
  annotationAt: (id: string) => Annotation | PlayerAnnotation | null,
  /** While an area template is placed: the area's own size, which the drag doesn't change. */
  templateFeet?: number
): { data: AnnotationGlyphData; snap: SnappedGeometry } | null {
  if (!calibration || !gesture) return null;
  if (gesture.kind === "measure") {
    const snap = snapMeasurementPreview(calibration, gesture.origin, gesture.current);
    return {
      snap,
      data: { kind: "measurement", shape: null, origin: snap.origin, target: snap.target, sizeFeet: snap.feet }
    };
  }
  if (gesture.kind === "circle" || gesture.kind === "cone" || gesture.kind === "line" || gesture.kind === "square") {
    const shape = gesture.kind;
    const snap =
      templateFeet !== undefined
        ? sizedShapePreview(calibration, shape, gesture.origin, gesture.current, templateFeet)
        : snapShapePreview(calibration, shape, gesture.origin, gesture.current);
    return { snap, data: { kind: "shape", shape, origin: snap.origin, target: snap.target, sizeFeet: snap.feet } };
  }
  if (gesture.kind === "annotation-resize" || gesture.kind === "annotation-move") {
    const live = annotationAt(gesture.id);
    if (live?.kind !== "shape" || !live.shape) return null;
    const [origin, target] =
      gesture.kind === "annotation-resize"
        ? [gesture.anchor, gesture.current]
        : [gesture.geometry.origin, gesture.geometry.target];
    const snap = snapShapePreview(calibration, live.shape, origin, target);
    return {
      snap,
      data: { kind: "shape", shape: live.shape, origin: snap.origin, target: snap.target, sizeFeet: snap.feet }
    };
  }
  return null;
}
