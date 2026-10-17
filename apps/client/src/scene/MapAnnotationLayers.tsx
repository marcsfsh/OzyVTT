import type { Annotation, PlayerAnnotation } from "@vtt/domain";
import type { TargetingSession } from "../encounter/targeting";
import { AnnotationGlyph, PingGlyph, type AnnotationGlyphData } from "./annotationGlyph";
import { sizedShapePreview, type GridCalibration, type SnappedGeometry } from "./gridPreview";
import type { Gesture } from "./useMapGestures";

type AnyAnnotation = Annotation | PlayerAnnotation;
type Preview = { data: AnnotationGlyphData; snap: SnappedGeometry } | null;
/** Annotation drawing sizes in image pixels, scaled to the grid cell so labels never read tiny on large maps. */
export type GlyphSizes = Readonly<{ arrowSize: number; labelSize: number; handleRadius: number; pingSize: number }>;

/**
 * The shape layer, under the tokens: saved shapes (with move and resize handles on the selected one),
 * the shape being drawn, and a placed area template.
 */
export function ShapeLayer({
  annotations,
  gesture,
  selectedId,
  canEdit,
  preview,
  activeTargeting,
  calibration,
  sizes,
  color
}: Readonly<{
  annotations: readonly AnyAnnotation[];
  gesture: Gesture | null;
  selectedId: string | null;
  /** Whether the selected shape shows its handles. */
  canEdit: (annotation: AnyAnnotation) => boolean;
  preview: Preview;
  activeTargeting: TargetingSession | null;
  calibration: GridCalibration | null;
  sizes: GlyphSizes;
  /** The drawer's own colour, for the shape in progress. */
  color: string;
}>) {
  const { arrowSize, labelSize, handleRadius } = sizes;
  return (
    <>
      {annotations.map((annotation) => {
        if (annotation.kind !== "shape") return null;
        const beingDragged =
          (gesture?.kind === "annotation-move" || gesture?.kind === "annotation-resize") &&
          gesture.id === annotation.id;
        if (beingDragged) return null;
        const selectedShape = selectedId === annotation.id;
        const editable = selectedShape && canEdit(annotation);
        return (
          <g
            key={annotation.id}
            data-annotation-id={annotation.id}
            className={`annotation-shape visibility-${annotation.visibility}${selectedShape ? " selected" : ""}`}
          >
            <AnnotationGlyph
              data={{
                kind: "shape",
                shape: annotation.shape,
                origin: annotation.geometry.origin,
                target: annotation.geometry.target,
                sizeFeet: annotation.geometry.sizeFeet
              }}
              arrowSize={arrowSize}
              labelSize={labelSize}
              color={annotation.color}
            />
            {editable && (
              <>
                <circle
                  data-annotation-handle="move"
                  className="annotation-handle annotation-handle-move"
                  cx={annotation.geometry.origin.x}
                  cy={annotation.geometry.origin.y}
                  r={handleRadius}
                />
                <circle
                  data-annotation-handle="resize"
                  className="annotation-handle annotation-handle-resize"
                  cx={annotation.geometry.target.x}
                  cy={annotation.geometry.target.y}
                  r={handleRadius}
                />
              </>
            )}
          </g>
        );
      })}
      {preview && preview.data.kind === "shape" && (
        <g className="annotation-shape live">
          <AnnotationGlyph data={preview.data} arrowSize={arrowSize} labelSize={labelSize} color={color} />
        </g>
      )}
      {activeTargeting?.mode === "template" &&
        activeTargeting.template?.placed &&
        calibration &&
        !preview &&
        (() => {
          // The area's own size, wherever the drag placed and pointed it (the server sizes it the same way).
          const snap = sizedShapePreview(
            calibration,
            activeTargeting.template.shape,
            activeTargeting.template.placed.origin,
            activeTargeting.template.placed.target,
            activeTargeting.template.sizeFeet
          );
          return (
            <g className="annotation-shape live">
              <AnnotationGlyph
                data={{
                  kind: "shape",
                  shape: activeTargeting.template.shape,
                  origin: snap.origin,
                  target: snap.target,
                  sizeFeet: snap.feet
                }}
                arrowSize={arrowSize}
                labelSize={labelSize}
                color="#ff2e9a"
              />
            </g>
          );
        })()}

      {/* GM fog: dimmed, above the map and shapes but below tokens; the GM always sees everything. */}
    </>
  );
}

/** Measurements and pings, drawn above the token layer so they are never hidden behind a piece. */
export function MarkLayer({
  annotations,
  preview,
  sizes,
  color
}: Readonly<{ annotations: readonly AnyAnnotation[]; preview: Preview; sizes: GlyphSizes; color: string }>) {
  const { arrowSize, labelSize, pingSize } = sizes;
  return (
    <>
      {annotations.map((annotation) =>
        annotation.kind === "measurement" ? (
          <AnnotationGlyph
            key={annotation.id}
            data={{
              kind: "measurement",
              shape: null,
              origin: annotation.geometry.origin,
              target: annotation.geometry.target,
              sizeFeet: annotation.geometry.sizeFeet
            }}
            arrowSize={arrowSize}
            labelSize={labelSize}
            color={annotation.color}
            expiring
          />
        ) : null
      )}
      {preview && preview.data.kind === "measurement" && (
        <AnnotationGlyph
          data={preview.data}
          arrowSize={arrowSize}
          labelSize={labelSize}
          color={color}
          labelPoint={{ x: preview.snap.target.x, y: preview.snap.target.y }}
        />
      )}
      {annotations.map((annotation) =>
        annotation.kind === "ping" ? (
          <PingGlyph
            key={annotation.id}
            point={annotation.geometry.origin}
            color={annotation.color}
            label={annotation.label}
            size={pingSize}
          />
        ) : null
      )}
    </>
  );
}
