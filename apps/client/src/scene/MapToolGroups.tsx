import type { AnnotationShapeKind, AnnotationVisibility } from "@vtt/domain";
import {
  Button,
  Field,
  Select,
  SegmentedControl,
  Switch,
  IconCleanup,
  IconColor,
  IconEye,
  IconEyeOff,
  IconTerrain,
  IconX
} from "@vtt/ui";
import type { DockPosition } from "../encounter/DockPicker";
import { drawingAudienceOptions, NEEDS_GRID, type ClearScope, type MapTool, type MapToolbarProps } from "./mapTools";

const SHAPE_TOOLS: ReadonlyArray<{ id: AnnotationShapeKind; label: string }> = [
  { id: "circle", label: "Circle" },
  { id: "cone", label: "Cone" },
  { id: "line", label: "Line" },
  { id: "square", label: "Square" }
];

export function DrawGroup({
  role,
  tool,
  calibrated,
  audience,
  onAudienceChange,
  audienceActorId,
  onAudienceActorIdChange,
  characters,
  color,
  onColorChange,
  colors,
  gmInk,
  onGmInkChange,
  onClear,
  id,
  onPickTool
}: MapToolbarProps & { id: string; onPickTool: (tool: MapTool) => void }) {
  const scopes: ReadonlyArray<{ scope: ClearScope; label: string }> =
    role === "gm"
      ? [
          { scope: "mine", label: "Remove all my shapes" },
          { scope: "players", label: "Remove all player shapes" },
          { scope: "all", label: "Remove all shapes" }
        ]
      : [{ scope: "mine", label: "Remove all my shapes" }];

  return (
    <>
      <div className="map-toolbar-choices" role="group" aria-label="Shapes">
        {SHAPE_TOOLS.map((shape) => (
          <button
            key={shape.id}
            type="button"
            className="map-toolbar-choice tap-target interactive"
            aria-pressed={tool === shape.id}
            disabled={!calibrated}
            title={calibrated ? `Place a ${shape.label.toLowerCase()}` : NEEDS_GRID}
            onClick={() => onPickTool(shape.id)}
          >
            {shape.label}
          </button>
        ))}
      </div>
      {!calibrated && <p className="map-toolbar-note">{NEEDS_GRID}</p>}

      <Field label="Who sees new drawings" htmlFor={`${id}-audience`} className="map-toolbar-field">
        <Select
          id={`${id}-audience`}
          value={audience}
          onChange={(event) => onAudienceChange(event.target.value as AnnotationVisibility)}
        >
          {drawingAudienceOptions(role).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      {audience === "gm-actor" && (
        <Field label="Character" htmlFor={`${id}-audience-actor`} className="map-toolbar-field">
          <Select
            id={`${id}-audience-actor`}
            value={audienceActorId ?? ""}
            onChange={(event) => onAudienceActorIdChange(event.target.value || null)}
          >
            <option value="">Choose…</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {role === "gm" && (
        <Switch className="map-toolbar-switch" checked={gmInk} onChange={onGmInkChange} label="GM ink" />
      )}
      {role === "gm" && (
        <p className="map-toolbar-note">
          While GM ink is on, new drawings are GM only and only GM drawings can be picked up.
        </p>
      )}

      <p className="map-toolbar-label">
        <span aria-hidden="true">
          <IconColor />
        </span>
        Your colour
      </p>
      <div className="encounter-map-swatches" role="group" aria-label="Your colour">
        {colors.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            aria-pressed={color.toLowerCase() === swatch}
            className={`tap-target${color.toLowerCase() === swatch ? " selected" : ""}`}
            style={{ background: swatch }}
            onClick={() => onColorChange(swatch)}
          />
        ))}
      </div>
      <label className="map-toolbar-custom-colour">
        Custom
        <input type="color" value={color} onChange={(event) => onColorChange(event.target.value)} />
      </label>

      <p className="map-toolbar-label">
        <span aria-hidden="true">
          <IconCleanup />
        </span>
        Clean up
      </p>
      <div className="map-toolbar-actions">
        {scopes.map((entry) => (
          <Button key={entry.scope} variant="secondary" block onClick={() => onClear(entry.scope)}>
            {entry.label}
          </Button>
        ))}
      </div>
    </>
  );
}

export function FogGroup({
  tool,
  fogEnabled,
  fogBusy,
  onFogEnabledChange,
  onRevealAll,
  onHideAll,
  onPickTool
}: MapToolbarProps & { onPickTool: (tool: MapTool) => void }) {
  return (
    <>
      <Switch
        className="map-toolbar-switch"
        checked={fogEnabled}
        disabled={fogBusy}
        onChange={onFogEnabledChange}
        label="Fog of war"
      />
      <p className="map-toolbar-note">
        {fogEnabled
          ? "Players see only the areas you have revealed."
          : "Turn this on to cover the map, then reveal it area by area."}
      </p>
      <div className="map-toolbar-choices" role="group" aria-label="Fog tools">
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "fog-reveal"}
          disabled={fogBusy || !fogEnabled}
          title="Drag the areas players can see"
          onClick={() => onPickTool(tool === "fog-reveal" ? "select" : "fog-reveal")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconEye />
          </span>
          Reveal
        </button>
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "fog-hide"}
          disabled={fogBusy || !fogEnabled}
          title="Drag an area to cover it again"
          onClick={() => onPickTool(tool === "fog-hide" ? "select" : "fog-hide")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconEyeOff />
          </span>
          Hide
        </button>
      </div>
      <div className="map-toolbar-actions">
        <Button variant="secondary" block disabled={fogBusy || !fogEnabled} onClick={onRevealAll}>
          Reveal the whole map
        </Button>
        <Button variant="secondary" block disabled={fogBusy || !fogEnabled} onClick={onHideAll}>
          Hide the whole map again
        </Button>
      </div>
    </>
  );
}

export function TerrainGroup({
  tool,
  calibrated,
  terrainBusy,
  hasTerrain,
  onClearTerrain,
  onPickTool
}: MapToolbarProps & { onPickTool: (tool: MapTool) => void }) {
  return (
    <>
      <p className="map-toolbar-note">
        Entering difficult terrain costs double movement. Moves are charged and previewed along the cheapest path.
      </p>
      <div className="map-toolbar-choices" role="group" aria-label="Terrain tools">
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "terrain-difficult"}
          disabled={terrainBusy || !calibrated}
          title={calibrated ? "Drag an area to mark it difficult" : NEEDS_GRID}
          onClick={() => onPickTool(tool === "terrain-difficult" ? "select" : "terrain-difficult")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconTerrain />
          </span>
          Difficult
        </button>
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "terrain-clear"}
          disabled={terrainBusy || !calibrated || !hasTerrain}
          title={calibrated ? "Drag an area to make it normal ground again" : NEEDS_GRID}
          onClick={() => onPickTool(tool === "terrain-clear" ? "select" : "terrain-clear")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconX />
          </span>
          Clear
        </button>
      </div>
      {!calibrated && <p className="map-toolbar-note">{NEEDS_GRID}</p>}
      <div className="map-toolbar-actions">
        <Button variant="secondary" block disabled={terrainBusy || !hasTerrain} onClick={onClearTerrain}>
          Clear all terrain
        </Button>
      </div>
    </>
  );
}

export function ViewGroup({
  onZoom,
  onResetView,
  enlarged,
  onToggleEnlarged,
  fullscreen,
  onToggleFullscreen,
  dock,
  notificationsMuted,
  onNotificationsMutedChange
}: MapToolbarProps & { id: string }) {
  return (
    <>
      <div className="map-toolbar-actions map-toolbar-actions-row">
        <Button variant="secondary" onClick={() => onZoom(1.3)}>
          Zoom in
        </Button>
        <Button variant="secondary" onClick={() => onZoom(1 / 1.3)}>
          Zoom out
        </Button>
      </div>
      <div className="map-toolbar-actions">
        <Button variant="secondary" block onClick={onResetView}>
          Reset view
        </Button>
        <Button variant="secondary" block disabled={fullscreen} onClick={onToggleEnlarged}>
          {enlarged ? "Shrink map" : "Enlarge map"}
        </Button>
        <Button variant="secondary" block onClick={onToggleFullscreen}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </Button>
      </div>
      {dock && (
        <Field label="Turn order panel" className="map-toolbar-field">
          <SegmentedControl
            ariaLabel="Turn order panel position"
            size="sm"
            className="map-toolbar-segmented"
            value={dock.position}
            onChange={(value) => dock.onChange(value as DockPosition)}
            options={[
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
              { value: "sidebar", label: "Sidebar" }
            ]}
          />
        </Field>
      )}
      <Switch
        className="map-toolbar-switch"
        checked={!notificationsMuted}
        onChange={(on) => onNotificationsMutedChange(!on)}
        label="Notifications"
      />
      <p className="map-toolbar-note">Notifications are muted for you only — the rest of the table still sees them.</p>
    </>
  );
}
