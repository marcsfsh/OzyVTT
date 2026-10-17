import type { ReactNode } from "react";
import { Button, ChoiceGrid, IconArrow, Input } from "@vtt/ui";
import { CrosshairControls, type Crosshair } from "./calibration-overlays";
import type { MapKind, Point } from "./map-catalog";

/**
 * The body of each calibration step, below the canvas. The pane owns the state; these only render it
 * and report what the GM did.
 */

type MapRef = Readonly<{ kind: MapKind }>;

/** What the pane reads from the server's wizard state. No `step`: the UI step index is derived
    locally, never from the server's step name. */
export type WizardState = Readonly<{
  calibration: Readonly<{ origin: Point; cellSizePx: number; rotationRadians: number; distancePerCell: number }>;
  verification: Readonly<{ errorPx: number; tolerancePx: number; accepted: boolean }> | null;
}>;

/** The sentence above the canvas: what this step asks for, in the current mode. */
export function stepInstruction({
  expired,
  step,
  map,
  squareMode,
  placedArea,
  pointCount
}: Readonly<{
  expired: boolean;
  step: number;
  map: MapRef;
  squareMode: boolean;
  placedArea: boolean;
  pointCount: number;
}>): string {
  if (expired) return "This calibration ran out: a measurement waits 30 minutes for Confirm.";
  if (step === 0)
    return map.kind === "battlemap"
      ? "Choose how this map measures distance: a printed grid to line up against, or two points a known distance apart."
      : "A regional or world map is calibrated by real-world scale: measure a span whose length you already know.";
  if (step === 1) {
    if (squareMode)
      return placedArea
        ? "Drag inside the square to move it, or its corner to resize it. Measure it when it lines up with the printed grid."
        : "Press on a grid intersection, drag diagonally across a 3 × 3 block of squares, and release on the opposite intersection.";
    return `${pointCount < 2 ? `Click ${pointCount ? "the ending" : "a starting"} point on the map` : "Both points are placed"}. Choose two locations whose real-world distance you know.`;
  }
  if (step === 2)
    return squareMode
      ? "Nudge the blue overlay until it sits on the printed grid. Squares are 5 ft each, the D&D 5e default."
      : "Enter the real-world distance between point A and point C.";
  return squareMode
    ? "Optional: click a distant intersection, then verify it. A miss never blocks Confirm."
    : "Check what will be saved, then save it.";
}

export function ExpiredNotice() {
  return (
    <div className="map-expired">
      <strong>This calibration ran out.</strong>
      <p>
        A measurement waits 30 minutes for Confirm. Your 3 × 3 placement is still here: take it back to the map and
        measure it again.
      </p>
    </div>
  );
}

/** Step 0: a printed grid or a known distance. Regional and world maps only have the distance path. */
export function ModeStep({
  map,
  mode,
  onChange
}: Readonly<{ map: MapRef; mode: "square" | "gridless"; onChange: (mode: "square" | "gridless") => void }>) {
  const options =
    map.kind === "battlemap"
      ? [
          {
            value: "square",
            title: "Printed square grid",
            description: "Drag over a 3 × 3 block of printed squares. OzyVTT works out the grid from it."
          },
          {
            value: "gridless",
            title: "Gridless battle map",
            description: "No grid lines. Distance comes from two points a known distance apart."
          }
        ]
      : [
          {
            value: "gridless",
            title: "Real-world scale",
            description: `Measure a known span so markers and rulers can use ${map.kind === "world" ? "world" : "regional"} distances.`
          }
        ];
  return (
    <ChoiceGrid
      className="map-mode-choice"
      ariaLabel="Calibration type"
      searchable={false}
      options={options}
      value={map.kind === "battlemap" ? mode : "gridless"}
      onChange={(value) => onChange(value as "square" | "gridless")}
    />
  );
}

/** Step 1: the hint for the drag or the two points, and the crosshair that helps aim it. */
export function MarkStep({
  squareMode,
  crosshair,
  onCrosshairChange
}: Readonly<{
  squareMode: boolean;
  crosshair: Crosshair;
  onCrosshairChange: (next: Crosshair) => void;
}>) {
  return (
    <div className="map-step-panel">
      {squareMode ? (
        <p className="map-step-hint">
          Start exactly on one printed-grid intersection. Hold and drag diagonally across a block containing{" "}
          <strong>nine squares</strong>, then release exactly on the opposite intersection.
        </p>
      ) : (
        <p className="map-step-hint">
          Click point <strong>A</strong>, then point <strong>C</strong>. Pick two landmarks whose distance apart you
          already know, such as a road's length or the span of a lake.
        </p>
      )}
      {/* The crosshair aids aiming, so its look is set on this step, folded away: the default suits most maps. Once
        a wizard exists the crosshair is not drawn (the overlay replaces it). */}
      {squareMode && (
        <details className="crosshair-details">
          <summary>Crosshair look</summary>
          <CrosshairControls value={crosshair} onChange={onCrosshairChange} />
        </details>
      )}
    </div>
  );
}

/** Step 2 on the square path: nudge the server's overlay, or re-measure from typed coordinates. */
export function TuneGridStep({
  wizard,
  points,
  busy,
  onAction,
  onPointChange,
  onRemeasure
}: Readonly<{
  wizard: WizardState | null;
  points: readonly Point[];
  busy: boolean;
  onAction: (action: Record<string, unknown>) => void;
  onPointChange: (index: number, coordinate: "x" | "y", value: number) => void;
  onRemeasure: () => void;
}>) {
  const nudge = (adjustment: Record<string, unknown>, label: ReactNode) => (
    <Button variant="secondary" block disabled={busy} onClick={() => onAction({ action: "adjust", adjustment })}>
      {label}
    </Button>
  );
  return (
    <div className="map-step-panel">
      {wizard && (
        <p className="grid-detected tabular">
          {wizard.calibration.cellSizePx.toFixed(0)} px squares · {wizard.calibration.distancePerCell} ft each
        </p>
      )}
      {/* Shown in full, outside a `<details>`: the nudges are what this step is for, and the coordinate fields
        under them are the keyboard alternative. Every one is a server action. */}
      <div className="adjustment-groups">
        <fieldset>
          <legend>Move overlay</legend>
          {nudge(
            { originDelta: { x: -1, y: 0 } },
            <>
              <IconArrow className="map-nudge-left" /> Left
            </>
          )}
          {nudge(
            { originDelta: { x: 1, y: 0 } },
            <>
              Right <IconArrow />
            </>
          )}
          {nudge(
            { originDelta: { x: 0, y: -1 } },
            <>
              <IconArrow className="map-nudge-up" /> Up
            </>
          )}
          {nudge(
            { originDelta: { x: 0, y: 1 } },
            <>
              Down <IconArrow className="map-nudge-down" />
            </>
          )}
        </fieldset>
        <fieldset>
          <legend>Square size</legend>
          {nudge({ cellSizeDeltaPx: -0.5 }, "− Smaller")}
          {nudge({ cellSizeDeltaPx: 0.5 }, "+ Larger")}
        </fieldset>
        <fieldset>
          <legend>History</legend>
          <Button variant="secondary" block disabled={busy} onClick={() => onAction({ action: "undo" })}>
            Undo
          </Button>
          <Button variant="secondary" block disabled={busy} onClick={() => onAction({ action: "redo" })}>
            Redo
          </Button>
        </fieldset>
      </div>
      <div className="point-editor">
        {[0, 1].map((index) => (
          <fieldset key={index}>
            <legend>{index === 0 ? "Drag start A" : "Drag end C"}</legend>
            <label>
              X
              <Input
                type="number"
                value={points[index]?.x ?? ""}
                onChange={(event) => onPointChange(index, "x", Number(event.target.value))}
              />
            </label>
            <label>
              Y
              <Input
                type="number"
                value={points[index]?.y ?? ""}
                onChange={(event) => onPointChange(index, "y", Number(event.target.value))}
              />
            </label>
          </fieldset>
        ))}
        {points.length >= 2 && (
          <Button variant="secondary" disabled={busy} onClick={onRemeasure}>
            Re-measure from these coordinates
          </Button>
        )}
      </div>
    </div>
  );
}

/** Step 2 on the scale path: the known distance and its unit. */
export function DistanceStep({
  map,
  knownDistance,
  unit,
  onKnownDistanceChange,
  onUnitChange
}: Readonly<{
  map: MapRef;
  knownDistance: number;
  unit: string;
  onKnownDistanceChange: (value: number) => void;
  onUnitChange: (value: string) => void;
}>) {
  return (
    <div className="map-step-panel">
      <div className="wizard-fields">
        <label>
          Distance between A and C
          <Input
            type="number"
            min="0.01"
            value={knownDistance}
            onChange={(event) => onKnownDistanceChange(Number(event.target.value))}
          />
        </label>
        <label>
          Unit
          <Input
            value={unit}
            onChange={(event) => onUnitChange(event.target.value)}
            maxLength={32}
            placeholder={map.kind === "battlemap" ? "feet" : "miles"}
          />
        </label>
      </div>
    </div>
  );
}

/** Step 3 on the square path: an optional check of a distant point, and what will be saved. */
export function VerifyStep({
  wizard,
  points,
  busy,
  onAction
}: Readonly<{
  wizard: WizardState | null;
  points: readonly Point[];
  busy: boolean;
  onAction: (action: Record<string, unknown>) => void;
}>) {
  return (
    <div className="map-step-panel">
      {/* Real verification: the server computes the error against its tolerance, and a miss never blocks
        Confirm. */}
      <div className="verification-card">
        <strong>{points.length < 3 ? "Click a distant grid intersection" : "Check point V"}</strong>
        <p>
          {points.length < 3
            ? "Choose one far from the 3 × 3 sample. A point far away shows a spacing error."
            : "Check whether V lands close enough to an intersection on the blue overlay."}
        </p>
        <Button
          variant="secondary"
          disabled={busy || points.length < 3}
          onClick={() => onAction({ action: "verify", imagePoint: points[2] })}
        >
          Verify selected point
        </Button>
      </div>
      {wizard?.verification && (
        <p className={wizard.verification.accepted ? "verification accepted" : "verification rejected"}>
          {wizard.verification.accepted
            ? `Aligned. V is within ${wizard.verification.errorPx.toFixed(2)} px of the grid.`
            : `Not aligned. V misses the grid by ${wizard.verification.errorPx.toFixed(2)} px. This doesn't block Confirm.`}
        </p>
      )}
      {wizard && (
        <dl className="map-review tabular">
          <div>
            <dt>Square size</dt>
            <dd>{wizard.calibration.cellSizePx.toFixed(2)} px</dd>
          </div>
          <div>
            <dt>Origin</dt>
            <dd>
              {wizard.calibration.origin.x.toFixed(1)}, {wizard.calibration.origin.y.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt>Distance per square</dt>
            <dd>{wizard.calibration.distancePerCell} ft</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/**
 * Step 3 on the scale path: a review with no verification. The scale path has no server-side check, so
 * this reads back what will be saved, and no "verified" badge. When the server would refuse the span or
 * the distance, the sentence says which and the Scale row stays empty.
 */
export function ScaleReviewStep({
  points,
  knownDistance,
  unit,
  scaleSpanPx,
  distancePerPixel
}: Readonly<{
  points: readonly Point[];
  knownDistance: number;
  unit: string;
  scaleSpanPx: number;
  distancePerPixel: number | null;
}>) {
  return (
    <div className="map-step-panel">
      <p className="map-step-hint">
        {distancePerPixel !== null
          ? 'Nothing is saved yet. This is what "Save map scale" sends.'
          : scaleSpanPx > 0
            ? "The distance between A and C has to be more than zero before this can be saved."
            : "A and C are the same place, so there is no span to scale. Go back and put them on two different landmarks."}
      </p>
      <dl className="map-review tabular">
        <div>
          <dt>Point A</dt>
          <dd>{points[0] ? "Placed" : "None"}</dd>
        </div>
        <div>
          <dt>Point C</dt>
          <dd>{points[1] ? "Placed" : "None"}</dd>
        </div>
        <div>
          <dt>Known distance</dt>
          <dd>
            {knownDistance} {unit}
          </dd>
        </div>
        <div>
          <dt>Scale</dt>
          <dd>{distancePerPixel !== null ? `${distancePerPixel.toFixed(4)} ${unit} per pixel` : "None"}</dd>
        </div>
      </dl>
    </div>
  );
}
