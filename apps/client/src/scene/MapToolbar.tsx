import { useEffect, useId, useRef, useState } from "react";
import type { AnnotationShapeKind, AnnotationVisibility } from "@vtt/domain";
import {
  Button,
  Field,
  IconButton,
  Select,
  SegmentedControl,
  Switch,
  IconChevron,
  IconCleanup,
  IconColor,
  IconDraw,
  IconEye,
  IconEyeOff,
  IconFog,
  IconMeasure,
  IconPing,
  IconSearch,
  IconSelect
} from "@vtt/ui";
import type { DockPosition } from "../encounter/EncounterPanel";

/**
 * The map toolbar. Always visible: the constant tools (Select · Ping · Measure) and three labelled
 * group buttons (Draw · Fog · View), on one row that never wraps; everything else is one tap deeper
 * in the group's panel. At 560px and below it collapses to one `Tools` button at the bottom-left
 * (thumb reach) that opens a vertical rail of the same content.
 *
 * Labels are never hover-only (a phone has no hover), and nothing wraps over the map art.
 * It holds no map state: values are props and changes are callbacks, so fog and annotations still
 * go through `EncounterMap`'s emitters.
 */

/** The map's pointer mode; defined here because the toolbar sets it. */
export type MapTool = "select" | "measure" | "ping" | "fog-reveal" | "fog-hide" | AnnotationShapeKind;

export type ClearScope = "mine" | "players" | "all";

type GroupId = "draw" | "fog" | "view";

const GROUP_LABEL: Record<GroupId, string> = { draw: "Draw", fog: "Fog", view: "View" };

/** The uncalibrated-map reason, reused so a disabled control always says why. */
const NEEDS_GRID = "Needs a calibrated grid — set one up on the Scenes tab, under Maps.";

const CONSTANT_TOOLS: ReadonlyArray<{ id: MapTool; label: string; icon: React.ReactNode; needsGrid?: boolean }> = [
  { id: "select", label: "Select and move", icon: <IconSelect /> },
  { id: "ping", label: "Ping a spot", icon: <IconPing /> },
  { id: "measure", label: "Measure distance", icon: <IconMeasure />, needsGrid: true }
];

const SHAPE_TOOLS: ReadonlyArray<{ id: AnnotationShapeKind; label: string }> = [
  { id: "circle", label: "Circle" },
  { id: "cone", label: "Cone" },
  { id: "line", label: "Line" },
  { id: "square", label: "Square" }
];

/**
 * Who a new drawing is for: "Shown to players" for public, "GM only" for GM-secret. The owner-scoped
 * options a player gets are about the person holding the phone, so they stay plain.
 */
export function drawingAudienceOptions(
  role: "gm" | "player"
): ReadonlyArray<{ value: AnnotationVisibility; label: string }> {
  return role === "gm"
    ? [
        { value: "public", label: "Shown to players" },
        { value: "gm-only", label: "GM only" },
        { value: "gm-actor", label: "GM and one character" }
      ]
    : [
        { value: "public", label: "Shown to players" },
        { value: "owner-only", label: "Only me" },
        { value: "owner-gm", label: "Only me and the GM" }
      ];
}

export interface MapToolbarProps {
  role: "gm" | "player";
  /** The live pointer mode, and the only way to change it. */
  tool: MapTool;
  onToolChange: (tool: MapTool) => void;
  /** A calibrated grid gates measure and the shape tools (the server needs cells to snap to). */
  calibrated: boolean;

  /* Draw */
  audience: AnnotationVisibility;
  onAudienceChange: (audience: AnnotationVisibility) => void;
  audienceActorId: string | null;
  onAudienceActorIdChange: (actorId: string | null) => void;
  /** Player characters the GM can aim a "GM and one character" drawing at. */
  characters: ReadonlyArray<{ id: string; name: string }>;
  color: string;
  onColorChange: (color: string) => void;
  colors: readonly string[];
  /** GM ink: new drawings land GM-only, and only GM-only drawings can be picked up. */
  gmInk: boolean;
  onGmInkChange: (on: boolean) => void;
  onClear: (scope: ClearScope) => void;

  /* Fog (GM only) */
  fogEnabled: boolean;
  fogBusy: boolean;
  onFogEnabledChange: (enabled: boolean) => void;
  onRevealAll: () => void;
  onHideAll: () => void;

  /**
   * The "Preview what players see" tool. No panel behind it: the preview is already a fixed,
   * draggable panel. Absent: not offered (players have nothing to preview).
   */
  viewerPreview?: Readonly<{ on: boolean; onToggle: () => void }>;

  /* View */
  onZoom: (factor: number) => void;
  onResetView: () => void;
  enlarged: boolean;
  onToggleEnlarged: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  dock?: Readonly<{ position: DockPosition; onChange: (position: DockPosition) => void }>;
  rulerWhileMoving: boolean;
  onRulerWhileMovingChange: (on: boolean) => void;
  occupiedCost: boolean;
  onOccupiedCostChange: (on: boolean) => void;
  notificationsMuted: boolean;
  onNotificationsMutedChange: (muted: boolean) => void;
}

/** The phone collapse breakpoint. */
const COMPACT_QUERY = "(max-width: 560px)";

function useCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.(COMPACT_QUERY).matches ?? false)
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return compact;
}

export function MapToolbar(props: MapToolbarProps) {
  const { role, tool, onToolChange, calibrated, viewerPreview } = props;
  const compact = useCompact();
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();

  const groups: GroupId[] = role === "gm" ? ["draw", "fog", "view"] : ["draw", "view"];

  // Leaving the compact band with the rail open would strand the state; reset both on the swap.
  useEffect(() => {
    setOpenGroup(null);
    setRailOpen(false);
  }, [compact]);

  // Escape closes the open panel first, then the rail.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openGroup) setOpenGroup(null);
      else if (railOpen) setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGroup, railOpen]);

  // A tap on the map closes what is open, deferred one tick so the opening tap does not immediately
  // close it (as in TokenContextMenu).
  useEffect(() => {
    if (!openGroup && !railOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenGroup(null);
      setRailOpen(false);
    };
    const armed = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => {
      window.clearTimeout(armed);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [openGroup, railOpen]);

  // On a phone the rail is taller than the map and scrolls, so an opened section is scrolled into view
  // rather than expanding below the fold.
  useEffect(() => {
    if (!compact || !openGroup || !railRef.current) return;
    railRef.current
      .querySelector(`#${CSS.escape(`${baseId}-${openGroup}`)}`)
      ?.closest(".map-toolbar-rail-section")
      ?.scrollIntoView({ block: "start" });
  }, [compact, openGroup, baseId]);

  const toggleGroup = (group: GroupId) => setOpenGroup((current) => (current === group ? null : group));
  /** Picking a tool ends the errand: the panel gets out of the way of the map. */
  const pickTool = (next: MapTool) => {
    onToolChange(next);
    setOpenGroup(null);
    setRailOpen(false);
  };

  const constantTools = CONSTANT_TOOLS.map((entry) => {
    const blocked = entry.needsGrid === true && !calibrated;
    return { ...entry, blocked, title: blocked ? NEEDS_GRID : entry.label };
  });

  const groupBody = (group: GroupId) => {
    if (group === "draw") return <DrawGroup {...props} id={`${baseId}-draw`} onPickTool={pickTool} />;
    if (group === "fog") return <FogGroup {...props} onPickTool={pickTool} />;
    return <ViewGroup {...props} id={`${baseId}-view`} />;
  };

  const groupIcon = (group: GroupId) =>
    group === "draw" ? <IconDraw /> : group === "fog" ? <IconFog /> : <IconSearch />;

  /**
   * The preview toggle, in both trees. No caret (no panel), and `aria-pressed` rather than
   * `aria-expanded` because it toggles a surface. The visible word is short; the accessible name is
   * the full sentence.
   */
  const previewTitle = viewerPreview?.on ? "Hide the preview of what players see" : "Preview what players see";

  if (compact) {
    // While open, the rail lifts above the floating token tray (z-index in the stylesheet); on a small
    // stage the tray would otherwise cover most of it. The resting toolbar overlaps nothing.
    return (
      <div className={`encounter-map-overlay compact${railOpen ? " open" : ""}`} ref={rootRef}>
        {railOpen && (
          <div
            className="map-toolbar-rail scroll-y"
            id={`${baseId}-rail`}
            ref={railRef}
            role="group"
            aria-label="Map tools"
          >
            <div className="map-toolbar-rail-tools">
              {constantTools.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="map-toolbar-row"
                  aria-pressed={tool === entry.id}
                  disabled={entry.blocked}
                  title={entry.title}
                  onClick={() => pickTool(entry.id)}
                >
                  <span className="map-toolbar-row-icon" aria-hidden="true">
                    {entry.icon}
                  </span>
                  {entry.label}
                </button>
              ))}
              {!calibrated && <p className="map-toolbar-note">{NEEDS_GRID}</p>}
            </div>
            {groups.map((group) => (
              <div key={group} className="map-toolbar-rail-section">
                <button
                  type="button"
                  className="map-toolbar-row map-toolbar-rail-head"
                  aria-expanded={openGroup === group}
                  aria-controls={`${baseId}-${group}`}
                  onClick={() => toggleGroup(group)}
                >
                  <span className="map-toolbar-row-icon" aria-hidden="true">
                    {groupIcon(group)}
                  </span>
                  {GROUP_LABEL[group]}
                  <span className={`map-toolbar-caret${openGroup === group ? " open" : ""}`} aria-hidden="true">
                    <IconChevron />
                  </span>
                </button>
                {openGroup === group && (
                  <div className="map-toolbar-panel-body" id={`${baseId}-${group}`}>
                    {groupBody(group)}
                  </div>
                )}
              </div>
            ))}
            {viewerPreview && (
              <div className="map-toolbar-rail-section">
                <button
                  type="button"
                  className="map-toolbar-row"
                  aria-pressed={viewerPreview.on}
                  title={previewTitle}
                  onClick={() => {
                    viewerPreview.onToggle();
                    setRailOpen(false);
                    setOpenGroup(null);
                  }}
                >
                  <span className="map-toolbar-row-icon" aria-hidden="true">
                    <IconEye />
                  </span>
                  {previewTitle}
                </button>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="map-toolbar-toggle"
          aria-expanded={railOpen}
          aria-controls={`${baseId}-rail`}
          onClick={() => {
            setRailOpen((open) => !open);
            setOpenGroup(null);
          }}
        >
          Tools
          <span className={`map-toolbar-caret${railOpen ? " open" : ""}`} aria-hidden="true">
            <IconChevron />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="encounter-map-overlay" ref={rootRef}>
      <div className="map-toolbar" role="group" aria-label="Map tools">
        <div className="encounter-map-tools">
          {constantTools.map((entry) => (
            <IconButton
              key={entry.id}
              label={entry.label}
              title={entry.title}
              aria-pressed={tool === entry.id}
              disabled={entry.blocked}
              onClick={() => pickTool(entry.id)}
            >
              {entry.icon}
            </IconButton>
          ))}
        </div>
        <span className="map-toolbar-divider" aria-hidden="true" />
        {groups.map((group) => (
          <button
            key={group}
            type="button"
            className="map-toolbar-group tap-target interactive"
            aria-expanded={openGroup === group}
            aria-controls={`${baseId}-${group}`}
            onClick={() => toggleGroup(group)}
          >
            <span className="map-toolbar-group-icon" aria-hidden="true">
              {groupIcon(group)}
            </span>
            <span className="map-toolbar-group-label">{GROUP_LABEL[group]}</span>
            <span className={`map-toolbar-caret${openGroup === group ? " open" : ""}`} aria-hidden="true">
              <IconChevron />
            </span>
          </button>
        ))}
        {viewerPreview && (
          <button
            type="button"
            className="map-toolbar-group tap-target interactive"
            aria-pressed={viewerPreview.on}
            title={previewTitle}
            aria-label={previewTitle}
            onClick={viewerPreview.onToggle}
          >
            <span className="map-toolbar-group-icon" aria-hidden="true">
              <IconEye />
            </span>
            <span className="map-toolbar-group-label">Preview</span>
          </button>
        )}
      </div>
      {openGroup && (
        <div
          className="map-toolbar-panel scroll-y anim-popover"
          id={`${baseId}-${openGroup}`}
          role="group"
          aria-label={GROUP_LABEL[openGroup]}
        >
          <p className="map-toolbar-panel-title">{GROUP_LABEL[openGroup]}</p>
          {groupBody(openGroup)}
        </div>
      )}
    </div>
  );
}

// The three groups

function DrawGroup({
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

function FogGroup({
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

function ViewGroup({
  role,
  calibrated,
  onZoom,
  onResetView,
  enlarged,
  onToggleEnlarged,
  fullscreen,
  onToggleFullscreen,
  dock,
  rulerWhileMoving,
  onRulerWhileMovingChange,
  occupiedCost,
  onOccupiedCostChange,
  notificationsMuted,
  onNotificationsMutedChange,
  id
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
        checked={rulerWhileMoving}
        disabled={!calibrated}
        onChange={onRulerWhileMovingChange}
        label="Show distance while moving"
      />
      {role === "gm" && (
        <Switch
          className="map-toolbar-switch"
          checked={occupiedCost}
          disabled={!calibrated}
          onChange={onOccupiedCostChange}
          label="Add 5 ft per occupied square"
        />
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
