import { useState } from "react";
import { Button, IconChevronLeft, Select, Steps, useToast } from "@vtt/ui";
import { clampPoint, GridOverlay, imagePointFromClient, type OverlayLine } from "../scene/mapImage";
import { usePrompt } from "../components/feedback";
import { ApiError, apiRequest } from "../lib/api";
import { useGridAreaGesture, usePreviewZoom, type Area } from "./calibration-canvas";
import { CrosshairOverlay, DEFAULT_CROSSHAIR, GridAreaPreview, type Crosshair } from "./calibration-overlays";
import {
  DistanceStep,
  ExpiredNotice,
  MarkStep,
  ModeStep,
  ScaleReviewStep,
  stepInstruction,
  TuneGridStep,
  VerifyStep,
  type WizardState
} from "./CalibrationSteps";
import type { MapAsset, Point } from "./map-catalog";

/** The 5e default square; the wizard sends it with the measured area. */
const DISTANCE_PER_CELL = 5;

type WizardReply = Readonly<{
  wizardId: string;
  state: WizardState;
  overlay?: readonly OverlayLine[];
  overlayWarning?: string | null;
}>;

/**
 * One map's calibration, as four steps (mode, canvas, fields, verify) around a canvas that is mounted
 * once, flex-fills the pane, is never inside a step panel and never unmounted, so it keeps real height
 * in every step; `.map-step-body` is bounded so it cannot squeeze the canvas out. The library keys this
 * pane by map, so choosing another map starts its calibration fresh.
 *
 * The UI's four steps are not the server's (`grid-calibration-wizard.ts`: measure -> refine ->
 * verify -> complete). The UI step is `Math.min(rawStep, maxStep)` from local state only:
 *   UI 0 (mode)   - no server state yet.
 *   UI 1 (canvas): ends with `POST .../calibration/wizards`, which jumps the server to refine.
 *   UI 2 (fields) - `POST .../actions {adjust|undo|redo}`; the server stays at refine.
 *   UI 3 (verify) - `POST .../actions {verify}` then `.../complete`.
 * The server computes every number (cell size, origin, rotation locked at 0, overlay lines,
 * `calibrationErrorPx`).
 *
 * `squareCorner` and `imagePointFromClient` are preview-only. `distancePerPixel` copies the server's
 * `deriveMapDistanceScale` (`map-measurement.ts`), including its refusals, so the review step can
 * show what the save will produce; `saveScale` still sends raw inputs and the server decides.
 *
 * Mode depends on the map kind: a battle map is either a printed square grid (the wizard) or
 * gridless distance (`PUT .../scale`); regional and world maps only have the scale path. The scale
 * path never calls the wizard, so its fourth step is a review with no verification.
 */
export function CalibrationPane({
  map,
  previewUrl,
  gmToken,
  folderNames,
  onSaved,
  onShowRail,
  next
}: Readonly<{
  map: MapAsset;
  previewUrl: string | null;
  gmToken: string;
  folderNames: readonly string[];
  /** The library refetches after a save and keeps this map selected. */
  onSaved: (mapId: string) => Promise<void>;
  /** Below 850px: back to the rail of maps. */
  onShowRail: () => void;
  /** Where the GM goes once the grid is set, as the done state's primary ("Back to the table"). */
  next?: Readonly<{ label: string; go: () => void }>;
}>) {
  const [points, setPoints] = useState<Point[]>([]);
  const [pendingArea, setPendingArea] = useState<Area | null>(null);
  const [crosshair, setCrosshair] = useState<Crosshair>(DEFAULT_CROSSHAIR);
  const [lastArea, setLastArea] = useState<Area | null>(null);
  // A map that already has a scale and no calibration opens on the gridless answer.
  const [battlemapMode, setBattlemapMode] = useState<"square" | "gridless">(
    map.scale && !map.calibration ? "gridless" : "square"
  );
  const [wizardId, setWizardId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [overlay, setOverlay] = useState<readonly OverlayLine[]>([]);
  const [knownDistance, setKnownDistance] = useState(50);
  const [unit, setUnit] = useState(map.scale?.unit ?? (map.kind === "battlemap" ? "feet" : "miles"));
  const [busy, setBusy] = useState(false);
  /** The position in the four-step UI flow, clamped by `maxStep` below. */
  const [rawStep, setRawStep] = useState(0);
  /** The wizard's 30-minute TTL ran out: an explicit, recoverable state with one way back, rather
      than a silent re-measure that would discard the GM's placement. */
  const [expired, setExpired] = useState(false);
  /** The saved result, shown until the GM moves on or calibrates again: a reset to step 1 read as "nothing saved". */
  const [done, setDone] = useState<string | null>(null);
  const { prompt, dialog } = usePrompt();
  const { toast } = useToast();
  const squareMode = map.kind === "battlemap" && battlemapMode === "square";
  const zoom = usePreviewZoom(map);
  const pointAt = (clientX: number, clientY: number) => {
    if (!zoom.svgRef.current) return null;
    const point = imagePointFromClient(zoom.svgRef.current, clientX, clientY);
    return point ? clampPoint(point, map.width, map.height) : null;
  };
  const gesture = useGridAreaGesture({
    map,
    surface: zoom.previewRef,
    placing: squareMode && !wizard,
    busy,
    pendingArea,
    setPendingArea,
    setPoints,
    pointAt
  });

  /** Errors go to a toast; a 404 on a wizard call means the session expired, and `onNotFound` owns that. */
  const run = async (operation: () => Promise<void>, onNotFound?: () => void) => {
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      if (onNotFound && error instanceof ApiError && error.status === 404) onNotFound();
      else toast((error as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const wizardExpired = () => {
    setWizardId(null);
    setWizard(null);
    setOverlay([]);
    setExpired(true);
    setRawStep(1);
  };
  const runWizard = (operation: () => Promise<void>) => run(operation, wizardExpired);
  const request = <T,>(path: string, body: unknown, method: "POST" | "PUT" | "PATCH" = "POST") =>
    apiRequest<T>(`/api/v1/map-assets/${map.id}${path}`, {
      token: gmToken,
      method,
      body,
      failure: "Map request failed."
    });

  const moveToFolder = (folder: string | null) =>
    run(async () => {
      await request("", { folder }, "PATCH");
      await onSaved(map.id);
      toast(folder ? `Moved to "${folder}".` : "Removed from its folder.", { tone: "success" });
    });
  const restartCalibration = () => {
    setPoints([]);
    gesture.reset();
    setPendingArea(null);
    setWizardId(null);
    setWizard(null);
    setOverlay([]);
    setExpired(false);
  };
  // "Redo drag" restores the just-placed 3×3 box so the GM can nudge it and re-measure.
  const reopenArea = () => {
    const area = lastArea ?? (points.length >= 2 ? { start: points[0], end: points[1] } : null);
    setExpired(false);
    setRawStep(1);
    if (!area) {
      restartCalibration();
      return;
    }
    setPendingArea(area);
    setPoints([area.start, area.end]);
    setWizard(null);
    setWizardId(null);
    setOverlay([]);
  };
  const choosePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    setPoints((current) => {
      if (wizard?.verification?.accepted) return current;
      if (wizard) return [...current.slice(0, 2), point];
      if (current.length === 0) return [point];
      if (current.length === 1) return [current[0], point];
      return current;
    });
  };
  const updatePoint = (index: number, coordinate: "x" | "y", value: number) =>
    setPoints((current) => {
      const next = [...current];
      while (next.length <= index) next.push({ x: 0, y: 0 });
      next[index] = { ...next[index], [coordinate]: Number.isFinite(value) ? value : 0 };
      return next;
    });
  const acceptWizardData = (data: WizardReply) => {
    setWizardId(data.wizardId);
    setWizard(data.state);
    setOverlay(data.overlay ?? []);
    setPendingArea(null);
    setExpired(false);
    if (data.overlayWarning) toast(data.overlayWarning, { tone: "info" });
  };
  const startAreaWizard = (start: Point, end: Point) =>
    run(async () => {
      setLastArea({ start, end });
      acceptWizardData(
        await request<WizardReply>("/calibration/wizards", {
          start,
          end,
          cellsAcross: 3,
          cellsDown: 3,
          distancePerCell: DISTANCE_PER_CELL
        })
      );
      // The server jumps measure -> refine in this one call: the UI's canvas -> fields.
      setRawStep(2);
    });
  const confirmPendingArea = () => {
    if (pendingArea) void startAreaWizard(pendingArea.start, pendingArea.end);
  };
  const wizardAction = (action: Record<string, unknown>) =>
    runWizard(async () => {
      if (!wizardId) throw new Error("Start grid calibration first.");
      acceptWizardData(await request<WizardReply>(`/calibration/wizards/${wizardId}/actions`, action));
    });
  /** A finished calibration says so in the pane and offers the next step; calibrating again starts from the mode
      step. */
  const finished = (message: string) => {
    restartCalibration();
    setPoints([]);
    setRawStep(0);
    setDone(message);
  };
  const completeWizard = () =>
    runWizard(async () => {
      if (!wizardId) throw new Error("Start grid calibration first.");
      await request(`/calibration/wizards/${wizardId}/complete`, {});
      await onSaved(map.id);
      finished(`The grid for ${map.name} is set. Tokens on it snap to its squares.`);
    });
  const saveScale = () =>
    run(async () => {
      if (points.length < 2) throw new Error("Choose two points with a known real-world distance.");
      await request("/scale", { start: points[0], end: points[1], knownDistance, unit }, "PUT");
      await onSaved(map.id);
      finished(`The scale for ${map.name} is set. Rulers and moves on it measure in ${unit}.`);
    });

  // The step index, from local UI state only. `maxStep` is the furthest the flow accepts: past the
  // canvas step needs a measurement, which for the square path means the server has one.
  const canAdvancePastCanvas = squareMode ? wizard !== null : points.length >= 2;
  const maxStep = canAdvancePastCanvas ? 3 : 1;
  const step = Math.min(rawStep, maxStep);
  /** The rail's jump goes through the same reconciliation as "Redo drag": a live wizard makes the
      canvas step inert (the drag does not start, no crosshair, no `pendingArea`), so jumping
      back to it must restore the placed area and clear the wizard (`reopenArea`). */
  const goToStep = (index: number) => {
    if (index === 1 && squareMode && wizard) {
      reopenArea();
      return;
    }
    setRawStep(index);
  };
  // The verify step is the "check a distant point" mode.
  const verifying = squareMode && step === 3 && wizard !== null;
  const showPoints = !wizard || verifying;
  const stepItems = [
    { label: "Calibration type", shortLabel: "Type" },
    { label: squareMode ? "Mark a 3 × 3 block" : "Mark two points", shortLabel: "Mark" },
    { label: squareMode ? "Fine-tune" : "Known distance", shortLabel: squareMode ? "Tune" : "Distance" },
    { label: squareMode ? "Verify & confirm" : "Review & save", shortLabel: squareMode ? "Verify" : "Review" }
  ];
  const instruction = stepInstruction({
    expired,
    step,
    map,
    squareMode,
    placedArea: pendingArea !== null,
    pointCount: points.length
  });
  /** The review step's derived scale, mirroring `deriveMapDistanceScale` (`map-measurement.ts`):
      `knownDistance / hypot(end - start)`, with the same refusals (`positiveFinite` on the span and
      the distance), so it never shows a scale the save would be rejected for. */
  const scaleSpanPx = points.length >= 2 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0;
  const distancePerPixel =
    scaleSpanPx > 0 && Number.isFinite(scaleSpanPx) && knownDistance > 0 ? knownDistance / scaleSpanPx : null;

  /** One primary per step, and the secondary that belongs beside it. */
  const actions = (() => {
    if (done)
      return {
        primary: next ? (
          <Button variant="primary" onClick={next.go}>
            {next.label}
          </Button>
        ) : null,
        secondary: (
          <Button variant="secondary" onClick={() => setDone(null)}>
            Set it again
          </Button>
        )
      };
    if (expired)
      return {
        primary: (
          <Button variant="primary" onClick={reopenArea}>
            Back to the drag
          </Button>
        ),
        secondary: null
      };
    if (step === 0)
      return {
        primary: (
          <Button variant="primary" onClick={() => setRawStep(1)}>
            Continue
          </Button>
        ),
        secondary: null
      };
    // Below 760px `Steps` has no jumpable rail, so this secondary is the only way back to the mode
    // step: clear what you placed, then change the type.
    if (step === 1) {
      const placed = squareMode ? pendingArea !== null : points.length > 0;
      const back = placed ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            restartCalibration();
            setPoints([]);
          }}
        >
          {squareMode ? "Start over" : "Clear points"}
        </Button>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => setRawStep(0)}>
          Change type
        </Button>
      );
      return squareMode
        ? {
            primary: (
              <Button variant="primary" disabled={busy || !pendingArea} onClick={confirmPendingArea}>
                Measure this area
              </Button>
            ),
            secondary: back
          }
        : {
            primary: (
              <Button variant="primary" disabled={busy || points.length < 2} onClick={() => setRawStep(2)}>
                Use these points
              </Button>
            ),
            secondary: back
          };
    }
    if (step === 2)
      return squareMode
        ? {
            primary: (
              <Button variant="primary" disabled={busy} onClick={() => setRawStep(3)}>
                Looks right
              </Button>
            ),
            secondary: (
              <Button variant="secondary" disabled={busy} onClick={reopenArea}>
                Redo drag
              </Button>
            )
          }
        : {
            primary: (
              <Button
                variant="primary"
                disabled={busy || !(knownDistance > 0) || unit.trim() === ""}
                onClick={() => setRawStep(3)}
              >
                Continue
              </Button>
            ),
            secondary: (
              <Button variant="secondary" disabled={busy} onClick={() => setRawStep(1)}>
                Back to the points
              </Button>
            )
          };
    return squareMode
      ? {
          primary: (
            <Button variant="primary" disabled={busy} onClick={completeWizard}>
              Confirm grid
            </Button>
          ),
          secondary: (
            <Button variant="secondary" disabled={busy} onClick={() => setRawStep(2)}>
              Fine-tune again
            </Button>
          )
        }
      : {
          // Enabled only for input the server accepts: `distancePerPixel` is null for spans
          // `deriveMapDistanceScale` refuses, and `measurementUnit` refuses an empty unit. The rail can jump
          // straight here, so the gate must be on this step too.
          primary: (
            <Button
              variant="primary"
              disabled={busy || points.length < 2 || distancePerPixel === null || unit.trim() === ""}
              onClick={saveScale}
            >
              Save map scale
            </Button>
          ),
          secondary: (
            <Button variant="secondary" disabled={busy} onClick={() => setRawStep(2)}>
              Change the distance
            </Button>
          )
        };
  })();

  return (
    <section className="map-pane" aria-label={`Calibrate ${map.name}`}>
      <div className="map-pane-head">
        <Button variant="ghost" className="map-pane-back" onClick={onShowRail}>
          <IconChevronLeft /> All maps
        </Button>
        <div className="map-pane-title">
          <strong>{map.name}</strong>
          <span className="tabular">
            {map.width}×{map.height} · {map.calibration ? "grid set" : map.scale ? "gridless" : "no grid yet"}
          </span>
        </div>
        <div className="map-folder-move" role="group" aria-label="Organize this map">
          <Select
            value={map.folder ?? ""}
            onChange={(event) => moveToFolder(event.target.value || null)}
            disabled={busy}
            aria-label="Move map to folder"
          >
            <option value="">Unfiled</option>
            {folderNames.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              const folder = await prompt({
                title: "New folder",
                body: "Move this map to a new folder.",
                placeholder: "Folder name",
                confirmLabel: "Move"
              });
              if (folder) moveToFolder(folder);
            }}
          >
            New folder…
          </Button>
        </div>
      </div>

      {!done && (
        <Steps
          className="map-steps"
          steps={stepItems}
          current={step}
          maxSelectable={maxStep}
          onStepSelect={goToStep}
          ariaLabel="Grid calibration"
        />
      )}
      {/* The one live status region on this surface; errors go to the toast. */}
      <p className={`map-step-note${done ? " is-done" : ""}`} id="map-step-note" role="status">
        {done ?? instruction}
      </p>

      {/* The canvas: mounted once, never inside a step panel, never unmounted, and the pane's only
        flex-filling child. `touch-action: none` is unconditional in the stylesheet: this surface is a
        drag target, never a scroller. */}
      <div className="map-canvas-col">
        <div
          ref={zoom.previewRef}
          className={`map-preview ${squareMode && !wizard ? "grid-area-mode" : ""} ${pendingArea ? (gesture.areaAction === "resize" ? "resizing" : "movable") : ""}`}
          onClick={squareMode ? (wizard && verifying ? choosePoint : undefined) : choosePoint}
          {...gesture.handlers}
          aria-describedby="map-step-note"
          aria-label={`Map preview for ${map.name}. ${pendingArea ? "Drag to move or resize the placed grid area." : squareMode && !wizard ? "Drag across a three-by-three grid area." : "Click to place the instructed point."}`}
        >
          {previewUrl ? (
            <svg
              ref={zoom.svgRef}
              viewBox={zoom.viewBox}
              width={map.width}
              height={map.height}
              preserveAspectRatio="xMidYMid meet"
            >
              <image href={previewUrl} width={map.width} height={map.height} role="img" aria-label={map.name} />
              <GridOverlay lines={overlay} />
              {gesture.drag && <GridAreaPreview start={gesture.drag.start} end={gesture.drag.end} />}
              {pendingArea && <GridAreaPreview start={pendingArea.start} end={pendingArea.end} handle />}
              {gesture.crosshairPoints.length > 0 && (
                <CrosshairOverlay
                  points={gesture.crosshairPoints}
                  width={map.width}
                  height={map.height}
                  crosshair={crosshair}
                />
              )}
              {showPoints &&
                points.slice(0, wizard ? 3 : 2).map((point, index) => (
                  <g key={index}>
                    <circle cx={point.x} cy={point.y} r={Math.max(4, Math.min(map.width, map.height) / 80)} />
                    <text x={point.x} y={point.y}>
                      {index === 0 ? "A" : index === 1 ? "C" : "V"}
                    </text>
                  </g>
                ))}
            </svg>
          ) : (
            <p>Loading map preview…</p>
          )}
        </div>
        <div className="map-canvas-tools" role="group" aria-label="Map preview zoom">
          <Button
            variant="secondary"
            disabled={!previewUrl}
            onClick={() => zoom.zoomFromCentre(1 / 1.3)}
            aria-label="Zoom out"
          >
            −
          </Button>
          <span className="map-zoom-level tabular">{zoom.camera ? `${zoom.camera.zoom.toFixed(1)}×` : "1.0×"}</span>
          <Button
            variant="secondary"
            disabled={!previewUrl}
            onClick={() => zoom.zoomFromCentre(1.3)}
            aria-label="Zoom in"
          >
            +
          </Button>
          <Button variant="secondary" disabled={!zoom.camera} onClick={zoom.reset}>
            Reset zoom
          </Button>
        </div>
      </div>

      <div className="map-step-body scroll-y">
        {done ? null : expired ? (
          <ExpiredNotice />
        ) : step === 0 ? (
          <ModeStep
            map={map}
            mode={battlemapMode}
            onChange={(value) => {
              // Re-picking the current answer must not throw away a placed area.
              if (map.kind !== "battlemap" || value === battlemapMode) return;
              setBattlemapMode(value);
              if (value === "gridless") setUnit("feet");
              // A half-built square-grid wizard must not survive into the gridless path.
              restartCalibration();
            }}
          />
        ) : step === 1 ? (
          <MarkStep squareMode={squareMode} crosshair={crosshair} onCrosshairChange={setCrosshair} />
        ) : step === 2 ? (
          squareMode ? (
            <TuneGridStep
              wizard={wizard}
              points={points}
              busy={busy}
              onAction={wizardAction}
              onPointChange={updatePoint}
              onRemeasure={() => void startAreaWizard(points[0], points[1])}
            />
          ) : (
            <DistanceStep
              map={map}
              knownDistance={knownDistance}
              unit={unit}
              onKnownDistanceChange={setKnownDistance}
              onUnitChange={setUnit}
            />
          )
        ) : squareMode ? (
          <VerifyStep wizard={wizard} points={points} busy={busy} onAction={wizardAction} />
        ) : (
          <ScaleReviewStep
            points={points}
            knownDistance={knownDistance}
            unit={unit}
            scaleSpanPx={scaleSpanPx}
            distancePerPixel={distancePerPixel}
          />
        )}
      </div>

      <div className="map-step-actions">
        {actions.primary}
        {actions.secondary}
      </div>
      {dialog}
    </section>
  );
}
