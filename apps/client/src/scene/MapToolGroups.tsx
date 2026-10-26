import type { AnnotationShapeKind, AnnotationVisibility, MapTrap, SceneEnvironment } from "@vtt/domain";
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
  IconWarning,
  IconX
} from "@vtt/ui";
import {
  AREA_KINDS,
  drawingAudienceOptions,
  GROUND_TOOLS,
  TRAP_KINDS,
  TRAP_TIERS,
  LIGHT_PRESETS,
  type AreaKindId,
  NEEDS_GRID,
  type ClearScope,
  type LightPresetId,
  type MapTool,
  type MapRailProps,
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
}: MapRailProps & { id: string; onPickTool: (tool: MapTool) => void }) {
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
}: MapRailProps & { onPickTool: (tool: MapTool) => void }) {
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
}: MapRailProps & { onPickTool: (tool: MapTool) => void }) {
  return (
    <>
      <p className="map-toolbar-note">
        Difficult terrain and ice cost double movement, and so does swimming without a Swim Speed. Moves are charged and
        previewed along the cheapest path.
      </p>
      <div className="map-toolbar-choices" role="group" aria-label="Terrain tools">
        {GROUND_TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            className="map-toolbar-choice tap-target interactive"
            aria-pressed={tool === entry.tool}
            disabled={terrainBusy || !calibrated}
            title={calibrated ? entry.title : NEEDS_GRID}
            onClick={() => onPickTool(tool === entry.tool ? "select" : entry.tool)}
          >
            <span className={`map-toolbar-row-icon map-ground-swatch map-ground-${entry.op}`} aria-hidden="true">
              {entry.op === "difficult" ? <IconTerrain /> : null}
            </span>
            {entry.label}
          </button>
        ))}
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

const STATE_LABEL: Readonly<Record<MapTrap["state"], string>> = {
  armed: "Armed",
  sprung: "Sprung",
  disarmed: "Safe"
};

/** The GM's traps (SRD 5.2.1 Gameplay Toolbox): pick one and its band of levels, drag its trapped area on the map, then
 *  mark it found, set it off, arm it again, make it safe or remove it. Players see a trap only once it is found. */
export function TrapsGroup({
  id,
  tool,
  calibrated,
  terrainBusy,
  traps = [],
  trapKind,
  onTrapKindChange,
  trapTier,
  onTrapTierChange,
  onEditTrap,
  onSpringTrap,
  onRemoveTrap,
  onPickTool
}: MapRailProps & { id: string; onPickTool: (tool: MapTool) => void }) {
  const tierLabel = (tier: number) => TRAP_TIERS.find((entry) => entry.tier === tier)?.label ?? `Band ${tier}`;
  return (
    <>
      <p className="map-toolbar-note">
        A trap stays hidden from the players until someone finds it or sets it off. Its DC never reaches them.
      </p>
      <Field label="Trap" htmlFor={`${id}-kind`} className="map-toolbar-field">
        <Select id={`${id}-kind`} value={trapKind} onChange={(event) => onTrapKindChange(event.target.value)}>
          {TRAP_KINDS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Party levels" htmlFor={`${id}-tier`} className="map-toolbar-field">
        <Select
          id={`${id}-tier`}
          value={String(trapTier)}
          onChange={(event) => onTrapTierChange(Number(event.target.value))}
        >
          {TRAP_TIERS.map((entry) => (
            <option key={entry.tier} value={String(entry.tier)}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="map-toolbar-choices" role="group" aria-label="Trap tools">
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "trap-place"}
          disabled={terrainBusy || !calibrated}
          title={calibrated ? "Drag the trapped area on the map." : NEEDS_GRID}
          onClick={() => onPickTool(tool === "trap-place" ? "select" : "trap-place")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconWarning />
          </span>
          Set a trap
        </button>
      </div>
      {!calibrated && <p className="map-toolbar-note">{NEEDS_GRID}</p>}
      {traps.length === 0 ? (
        <p className="map-toolbar-note">No traps on this map.</p>
      ) : (
        <ul className="map-trap-list" aria-label="Traps on this map">
          {traps.map((trap) => (
            <li key={trap.id} className="map-trap-row">
              <span className="map-trap-name">
                {trap.name}
                <span className="map-trap-meta">
                  {" · "}
                  {tierLabel(trap.tier)} · {STATE_LABEL[trap.state]}
                  {trap.found ? " · Found" : " · Hidden"}
                </span>
              </span>
              <span className="map-trap-actions">
                <Button
                  variant="secondary"
                  disabled={terrainBusy}
                  onClick={() => onEditTrap(trap.id, { found: !trap.found })}
                >
                  {trap.found ? "Hide" : "Reveal"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={terrainBusy || trap.state === "disarmed"}
                  onClick={() => onSpringTrap(trap.id)}
                >
                  Set off
                </Button>
                <Button
                  variant="secondary"
                  disabled={terrainBusy}
                  onClick={() => onEditTrap(trap.id, { state: trap.state === "armed" ? "disarmed" : "armed" })}
                >
                  {trap.state === "armed" ? "Make safe" : "Arm"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={terrainBusy}
                  aria-label={`Remove ${trap.name}`}
                  onClick={() => onRemoveTrap(trap.id)}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A player's found traps: each one still armed offers the ways its text gives to make it safe, taken by their own
 *  character standing within 5 feet. The server checks the distance and rolls any check. */
export function FoundTrapsGroup({ foundTraps = [], disarmerName, terrainBusy, onDisarmTrap }: MapRailProps) {
  const armed = foundTraps.filter((trap) => trap.state === "armed");
  return (
    <>
      <p className="map-toolbar-note">
        {disarmerName
          ? `${disarmerName} must stand within 5 feet of a trap to make it safe.`
          : "Claim your character to make a trap safe."}
      </p>
      {armed.length === 0 ? (
        <p className="map-toolbar-note">No armed traps found.</p>
      ) : (
        <ul className="map-trap-list" aria-label="Traps the party has found">
          {armed.map((trap) => (
            <li key={trap.id} className="map-trap-row">
              <span className="map-trap-name">{trap.name}</span>
              <span className="map-trap-actions">
                {trap.ways.map((way) => (
                  <Button
                    key={way.id}
                    variant="secondary"
                    disabled={terrainBusy || !disarmerName}
                    onClick={() => onDisarmTrap(trap.id, way.id)}
                  >
                    {way.name}
                  </Button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The live scene's climate and weather (SRD 5.2.1 Gameplay Toolbox, Environmental Effects). */
export function WeatherGroup({ id, terrainBusy, environment, onEnvironmentChange }: MapRailProps & { id: string }) {
  if (!environment) return null;
  const toggles: ReadonlyArray<{ key: "cold" | "heat" | "highAltitude" | "frigidWater" | "deepWater"; label: string }> =
    [
      { key: "cold", label: "Extreme cold" },
      { key: "heat", label: "Extreme heat" },
      { key: "highAltitude", label: "High altitude" },
      { key: "frigidWater", label: "Frigid water" },
      { key: "deepWater", label: "Deep water" }
    ];
  return (
    <>
      <p className="map-toolbar-note">
        Cold and heat ask everyone on the map a Constitution save at the end of each hour that passes. Rain, snow
        and wind act on sight, flames and fliers at once.
      </p>
      <Field label="Precipitation" htmlFor={`${id}-precipitation`} className="map-toolbar-field">
        <Select
          id={`${id}-precipitation`}
          value={environment.precipitation}
          disabled={terrainBusy}
          onChange={(event) =>
            onEnvironmentChange({ precipitation: event.target.value as SceneEnvironment["precipitation"] })
          }
        >
          <option value="none">No precipitation</option>
          <option value="rain">Heavy rain</option>
          <option value="snow">Heavy snowfall</option>
        </Select>
      </Field>
      <Field label="Wind" htmlFor={`${id}-wind`} className="map-toolbar-field">
        <Select
          id={`${id}-wind`}
          value={environment.wind}
          disabled={terrainBusy}
          onChange={(event) => onEnvironmentChange({ wind: event.target.value as SceneEnvironment["wind"] })}
        >
          <option value="none">Calm</option>
          <option value="strong">Strong wind</option>
          <option value="sandstorm">Sandstorm</option>
        </Select>
      </Field>
      {toggles.map((toggle) => (
        <Switch
          key={toggle.key}
          className="map-toolbar-switch"
          checked={environment[toggle.key]}
          disabled={terrainBusy}
          onChange={(on) => onEnvironmentChange({ [toggle.key]: on })}
          label={toggle.label}
        />
      ))}
    </>
  );
}

const WALL_TOOLS: ReadonlyArray<{ id: VisionTool; label: string; title: string }> = [
  { id: "vision-wall", label: "Wall", title: "Drag a wall. Sight and light stop at it, and so does movement." },
  {
    id: "vision-door",
    label: "Door",
    title: "Drag a door. It starts closed, and a tap on its handle opens its menu."
  },
  { id: "vision-window", label: "Window", title: "Drag a window. Sight goes through it, and movement stops at it." },
  { id: "vision-erase", label: "Remove", title: "Tap a wall, door, window or light to remove it." }
];

/** Walls, doors and windows: what blocks sight and movement once vision is on. */
export function WallsGroup({
  tool,
  visionEnabled,
  visionBusy,
  hasWalls,
  onClearWalls,
  onPickTool
}: MapRailProps & { onPickTool: (tool: MapTool) => void }) {
  return (
    <>
      <p className="map-toolbar-note">
        {visionEnabled
          ? "Walls and closed doors block sight and movement. Windows block movement only."
          : "Walls block movement now. They block sight once vision is on, under Light."}
      </p>
      <div className="map-toolbar-choices" role="group" aria-label="Wall tools">
        {WALL_TOOLS.map((entry) => (
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
              {entry.id === "vision-erase" ? <IconX /> : <IconWall />}
            </span>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="map-toolbar-actions">
        <Button variant="secondary" block disabled={visionBusy || !hasWalls} onClick={onClearWalls}>
          Remove all walls
        </Button>
      </div>
    </>
  );
}

/** Lights, the scene's ambient light, the vision switch, and seeing the map as one creature does. */
export function LightGroup({
  tool,
  visionEnabled,
  visionBusy,
  onVisionEnabledChange,
  ambient,
  onAmbientChange,
  sunlight,
  onSunlightChange,
  areaKind,
  onAreaKindChange,
  lightPreset,
  onLightPresetChange,
  onForgetExplored,
  lookThrough,
  onLookThroughChange,
  lookThroughOptions,
  id,
  onPickTool
}: MapRailProps & { id: string; onPickTool: (tool: MapTool) => void }) {
  const preset = LIGHT_PRESETS.find((entry) => entry.id === lightPreset) ?? LIGHT_PRESETS[0];
  return (
    <>
      <div className="map-toolbar-choices" role="group" aria-label="Light tools">
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "vision-light"}
          disabled={visionBusy}
          title="Tap the map to place a light."
          onClick={() => onPickTool(tool === "vision-light" ? "select" : "vision-light")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconSparkle />
          </span>
          Place
        </button>
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "vision-erase"}
          disabled={visionBusy}
          title="Tap a light or an area to remove it."
          onClick={() => onPickTool(tool === "vision-erase" ? "select" : "vision-erase")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconX />
          </span>
          Remove
        </button>
      </div>
      <Field label="Light to place" htmlFor={`${id}-light`} className="map-toolbar-field">
        <Select
          id={`${id}-light`}
          value={lightPreset}
          onChange={(event) => onLightPresetChange(event.target.value as LightPresetId)}
        >
          {LIGHT_PRESETS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>
      <p className="map-toolbar-note">
        {tool === "vision-light"
          ? `Tap the map to place it. It sheds bright light for ${preset.brightFeet} ft and dim light for ${preset.dimFeet} ft more.`
          : "Choose Place, then tap the map."}
      </p>
      <div className="map-toolbar-choices" role="group" aria-label="Area tools">
        <button
          type="button"
          className="map-toolbar-choice tap-target interactive"
          aria-pressed={tool === "vision-area"}
          disabled={visionBusy}
          title="Drag over the map to paint an area of light or obscurement."
          onClick={() => onPickTool(tool === "vision-area" ? "select" : "vision-area")}
        >
          <span className="map-toolbar-row-icon" aria-hidden="true">
            <IconTerrain />
          </span>
          Paint area
        </button>
      </div>
      <Field label="Area to paint" htmlFor={`${id}-area`} className="map-toolbar-field">
        <Select
          id={`${id}-area`}
          value={areaKind}
          onChange={(event) => onAreaKindChange(event.target.value as AreaKindId)}
        >
          {AREA_KINDS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>
      <p className="map-toolbar-note">
        {tool === "vision-area"
          ? "Drag over the map to paint it. Remove, then a tap on it, takes it away."
          : "A lit room in a dark dungeon, a dark cellar in daylight, fog or foliage: choose Paint area, then drag."}
      </p>
      <Field label="Ambient light" className="map-toolbar-field">
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
      <Switch
        className="map-toolbar-switch"
        checked={sunlight && ambient === "bright"}
        disabled={visionBusy || ambient !== "bright"}
        onChange={onSunlightChange}
        label="Sunlight"
      />
      <p className="map-toolbar-note">
        {ambient === "bright"
          ? "Daylight outdoors is sunlight. Sunlight Sensitivity and similar traits read it."
          : "Sunlight needs bright ambient light."}
      </p>
      <Switch
        className="map-toolbar-switch"
        checked={visionEnabled}
        disabled={visionBusy}
        onChange={onVisionEnabledChange}
        label="Vision"
      />
      <p className="map-toolbar-note">
        {visionEnabled
          ? "Players see only what their characters see."
          : "Turn this on to hide what the characters can't see."}
      </p>
      <Field label="See as a token" htmlFor={`${id}-look`} className="map-toolbar-field">
        <Select
          id={`${id}-look`}
          value={lookThrough ?? ""}
          disabled={!visionEnabled}
          onChange={(event) => onLookThroughChange(event.target.value || null)}
        >
          <option value="">Nobody · see everything</option>
          <option value="party">The whole party</option>
          {lookThroughOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="map-toolbar-actions">
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
  fullscreen,
  onToggleFullscreen,
  notificationsMuted,
  onNotificationsMutedChange
}: MapRailProps) {
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
          Fit map
        </Button>
        <Button variant="secondary" block onClick={onToggleFullscreen}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </Button>
      </div>
      <Switch
        className="map-toolbar-switch"
        checked={!notificationsMuted}
        onChange={(on) => onNotificationsMutedChange(!on)}
        label="Notifications"
      />
      <p className="map-toolbar-note">Muting notifications affects only this device.</p>
    </>
  );
}
