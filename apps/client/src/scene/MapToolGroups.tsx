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
  IconSparkle,
  IconTerrain,
  IconWall,
  IconX
} from "@vtt/ui";
import type { DockPosition } from "../encounter/DockPicker";
import {
  drawingAudienceOptions,
  LIGHT_PRESETS,
  NEEDS_GRID,
  type ClearScope,
  type LightPresetId,
  type MapTool,
  type MapToolbarProps,
  type VisionTool
} from "./mapTools";

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

const VISION_TOOLS: ReadonlyArray<{ id: VisionTool; label: string; title: string }> = [
  { id: "vision-wall", label: "Wall", title: "Drag a wall. Sight and light stop at it, and so does movement." },
  { id: "vision-door", label: "Door", title: "Drag a door. It starts closed, and a tap opens or closes it." },
  { id: "vision-window", label: "Window", title: "Drag a window. Sight goes through it, and movement stops at it." },
  { id: "vision-light", label: "Light", title: "Tap the map to place a light." },
  { id: "vision-erase", label: "Remove", title: "Tap a wall, door, window or light to remove it." }
];

export function VisionGroup({
  tool,
  visionEnabled,
  visionBusy,
  onVisionEnabledChange,
  ambient,
  onAmbientChange,
  lightPreset,
  onLightPresetChange,
  hasWalls,
  onClearWalls,
  onForgetExplored,
  lookThrough,
  onLookThroughChange,
  lookThroughOptions,
  id,
  onPickTool
}: MapToolbarProps & { id: string; onPickTool: (tool: MapTool) => void }) {
  return (
    <>
      <Switch
        className="map-toolbar-switch"
        checked={visionEnabled}
        disabled={visionBusy}
        onChange={onVisionEnabledChange}
        label="Dynamic vision"
      />
      <p className="map-toolbar-note">
        {visionEnabled
          ? "Each player sees only what their characters can. Walls and closed doors block sight and movement."
          : "Turn this on to hide what the characters can't see. Walls do nothing until then."}
      </p>
      <Field label="Light" className="map-toolbar-field">
        <SegmentedControl
          ariaLabel="Ambient light"
          size="sm"
          className="map-toolbar-segmented"
          value={ambient}
          onChange={(value) => onAmbientChange(value as "bright" | "dim" | "dark")}
          options={[
            { value: "bright", label: "Bright" },
            { value: "dim", label: "Dim" },
            { value: "dark", label: "Dark" }
          ]}
        />
      </Field>
      <div className="map-toolbar-choices" role="group" aria-label="Vision tools">
        {VISION_TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="map-toolbar-choice tap-target interactive"
            aria-pressed={tool === entry.id}
            disabled={visionBusy}
            title={entry.title}
            onClick={() => onPickTool(tool === entry.id ? "select" : entry.id)}
          >
            <span className="map-toolbar-row-icon" aria-hidden="true">
              {entry.id === "vision-light" ? <IconSparkle /> : entry.id === "vision-erase" ? <IconX /> : <IconWall />}
            </span>
            {entry.label}
          </button>
        ))}
      </div>
      <Field label="Light to place" htmlFor={`${id}-light`} className="map-toolbar-field">
        <Select
          id={`${id}-light`}
          value={lightPreset}
          onChange={(event) => onLightPresetChange(event.target.value as LightPresetId)}
        >
          {LIGHT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Look through" htmlFor={`${id}-look`} className="map-toolbar-field">
        <Select
          id={`${id}-look`}
          value={lookThrough ?? ""}
          disabled={!visionEnabled}
          onChange={(event) => onLookThroughChange(event.target.value || null)}
        >
          <option value="">Nobody (see everything)</option>
          <option value="party">The whole party</option>
          {lookThroughOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="map-toolbar-actions">
        <Button variant="secondary" block disabled={visionBusy || !hasWalls} onClick={onClearWalls}>
          Remove all walls
        </Button>
        <Button variant="secondary" block disabled={visionBusy || !visionEnabled} onClick={onForgetExplored}>
          Forget what the party has seen
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
