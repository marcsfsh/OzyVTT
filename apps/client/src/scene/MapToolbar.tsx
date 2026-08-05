import { useEffect, useId, useRef, useState } from "react";
import type { AnnotationShapeKind, AnnotationVisibility } from "@vtt/domain";
import {
  Button, Field, IconButton, Select, SegmentedControl, Switch,
  IconChevron, IconCleanup, IconColor, IconDraw, IconEye, IconEyeOff, IconFog, IconMeasure, IconPing, IconSearch, IconSelect
} from "@vtt/ui";
import type { DockPosition } from "../encounter/EncounterPanel";

/**
 * THE ONE MAP TOOLBAR (D4).
 *
 * What it replaces: three floating clusters that between them put ~13 icons over the battle map and
 * WRAPPED INTO ROWS as the viewport narrowed — the top-left tool row (`flex-wrap: wrap`), the
 * top-right notifications bell, and the bottom-right zoom/dock stack. Every one of those tools still
 * exists; none of them floats loose over the art any more.
 *
 * The shape, per plan §B2.4:
 *   · Always visible: the three constant tools (Select · Ping · Measure) + three LABELED group
 *     buttons (Draw · Fog · View). One row, never two, at every width above the phone collapse.
 *   · Everything else is exactly one tap deeper, inside the group panel that names it.
 *   · ≤560px the whole cluster collapses to a single `Tools` button at the bottom-left (thumb
 *     reach) which opens a vertical rail of the same content.
 *
 * Two rules this component exists to hold, both of which the old cluster broke:
 *   1. **A label is never hover-only.** Group buttons carry visible text at every width, and every
 *      row inside a panel or the phone rail is icon + words. Tooltips are supplementary; on a
 *      phone there is no hover, so anything that only exists in a `title` does not exist.
 *   2. **Nothing wraps over the map art.** The bar is `nowrap`; when a panel is open it is one
 *      bounded, scrollable surface rather than N more floating icons.
 *
 * It renders no map state of its own: every value is a prop and every change is a callback, so the
 * server-authoritative pieces (fog, annotations) still travel through `EncounterMap`'s emitters.
 */

/** The map's pointer mode. Lives here because the toolbar is what sets it. */
export type MapTool = "select" | "measure" | "ping" | "fog-reveal" | "fog-hide" | AnnotationShapeKind;

export type ClearScope = "mine" | "players" | "all";

type GroupId = "draw" | "fog" | "view";

const GROUP_LABEL: Record<GroupId, string> = { draw: "Draw", fog: "Fog", view: "View" };

/** The uncalibrated-map reason, said once and reused — a disabled control always says why. */
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
 * Who a new drawing is for, in the product's words (D28): "Shown to players" is the one phrase for
 * public, "GM only" the one phrase for GM-secret. The owner-scoped options a player gets have no
 * D28 winner — they are about the person holding the phone, not about the players as an audience —
 * so they stay plain.
 */
export function drawingAudienceOptions(role: "gm" | "player"): ReadonlyArray<{ value: AnnotationVisibility; label: string }> {
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

/** The phone collapse, on the shared ladder (design-language §breakpoints). */
const COMPACT_QUERY = "(max-width: 560px)";

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && (window.matchMedia?.(COMPACT_QUERY).matches ?? false));
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
  const { role, tool, onToolChange, calibrated } = props;
  const compact = useCompact();
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();

  const groups: GroupId[] = role === "gm" ? ["draw", "fog", "view"] : ["draw", "view"];

  // Leaving the compact band with the rail open would strand the state; reset both on the swap.
  useEffect(() => { setOpenGroup(null); setRailOpen(false); }, [compact]);

  // Escape closes the open panel first, then the rail — the usual nesting.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openGroup) setOpenGroup(null);
      else if (railOpen) setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGroup, railOpen]);

  // A tap on the map closes what is open. Deferred one tick so the tap that OPENED a panel does not
  // immediately shut it (the TokenContextMenu idiom).
  useEffect(() => {
    if (!openGroup && !railOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenGroup(null);
      setRailOpen(false);
    };
    const armed = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => { window.clearTimeout(armed); document.removeEventListener("pointerdown", onPointer); };
  }, [openGroup, railOpen]);

  // On a phone the rail is taller than the map (a 390px stage leaves ~210px), so it scrolls — and a
  // section opened near the bottom would otherwise expand below the fold with no hint that it had.
  // Measured on the real device profile before this existed: opening Draw left its whole body hidden.
  useEffect(() => {
    if (!compact || !openGroup || !railRef.current) return;
    railRef.current.querySelector(`#${CSS.escape(`${baseId}-${openGroup}`)}`)?.closest(".map-toolbar-rail-section")?.scrollIntoView({ block: "start" });
  }, [compact, openGroup, baseId]);

  const toggleGroup = (group: GroupId) => setOpenGroup((current) => (current === group ? null : group));
  /** Picking a tool is the end of the errand: the panel gets out of the way of the map. */
  const pickTool = (next: MapTool) => { onToolChange(next); setOpenGroup(null); setRailOpen(false); };

  const constantTools = CONSTANT_TOOLS.map((entry) => {
    const blocked = entry.needsGrid === true && !calibrated;
    return { ...entry, blocked, title: blocked ? NEEDS_GRID : entry.label };
  });

  const groupBody = (group: GroupId) => {
    if (group === "draw") return <DrawGroup {...props} id={`${baseId}-draw`} onPickTool={pickTool} />;
    if (group === "fog") return <FogGroup {...props} onPickTool={pickTool} />;
    return <ViewGroup {...props} id={`${baseId}-view`} />;
  };

  const groupIcon = (group: GroupId) => (group === "draw" ? <IconDraw /> : group === "fog" ? <IconFog /> : <IconSearch />);

  if (compact) {
    // While the rail is OPEN it lifts above the floating token tray (z-index, see the stylesheet): a
    // 390px stage is ~232px tall and the tray takes 136px of it, so a rail painted underneath showed
    // one and a half rows. The RESTING toolbar never overlaps anything — only the open menu does,
    // which is what a menu is for.
    return <div className={`encounter-map-overlay compact${railOpen ? " open" : ""}`} ref={rootRef}>
      {railOpen && <div className="map-toolbar-rail scroll-y" id={`${baseId}-rail`} ref={railRef} role="group" aria-label="Map tools">
        <div className="map-toolbar-rail-tools">
          {constantTools.map((entry) => <button key={entry.id} type="button" className="map-toolbar-row" aria-pressed={tool === entry.id} disabled={entry.blocked} title={entry.title} onClick={() => pickTool(entry.id)}>
            <span className="map-toolbar-row-icon" aria-hidden="true">{entry.icon}</span>{entry.label}
          </button>)}
          {!calibrated && <p className="map-toolbar-note">{NEEDS_GRID}</p>}
        </div>
        {groups.map((group) => <div key={group} className="map-toolbar-rail-section">
          <button type="button" className="map-toolbar-row map-toolbar-rail-head" aria-expanded={openGroup === group} aria-controls={`${baseId}-${group}`} onClick={() => toggleGroup(group)}>
            <span className="map-toolbar-row-icon" aria-hidden="true">{groupIcon(group)}</span>{GROUP_LABEL[group]}
            <span className={`map-toolbar-caret${openGroup === group ? " open" : ""}`} aria-hidden="true"><IconChevron /></span>
          </button>
          {openGroup === group && <div className="map-toolbar-panel-body" id={`${baseId}-${group}`}>{groupBody(group)}</div>}
        </div>)}
      </div>}
      <button type="button" className="map-toolbar-toggle" aria-expanded={railOpen} aria-controls={`${baseId}-rail`} onClick={() => { setRailOpen((open) => !open); setOpenGroup(null); }}>
        Tools<span className={`map-toolbar-caret${railOpen ? " open" : ""}`} aria-hidden="true"><IconChevron /></span>
      </button>
    </div>;
  }

  return <div className="encounter-map-overlay" ref={rootRef}>
    <div className="map-toolbar" role="group" aria-label="Map tools">
      <div className="encounter-map-tools">
        {constantTools.map((entry) => <IconButton key={entry.id} label={entry.label} title={entry.title} aria-pressed={tool === entry.id} disabled={entry.blocked} onClick={() => pickTool(entry.id)}>{entry.icon}</IconButton>)}
      </div>
      <span className="map-toolbar-divider" aria-hidden="true" />
      {groups.map((group) => <button key={group} type="button" className="map-toolbar-group tap-target interactive" aria-expanded={openGroup === group} aria-controls={`${baseId}-${group}`} onClick={() => toggleGroup(group)}>
        <span className="map-toolbar-group-icon" aria-hidden="true">{groupIcon(group)}</span>
        <span className="map-toolbar-group-label">{GROUP_LABEL[group]}</span>
        <span className={`map-toolbar-caret${openGroup === group ? " open" : ""}`} aria-hidden="true"><IconChevron /></span>
      </button>)}
    </div>
    {openGroup && <div className="map-toolbar-panel scroll-y anim-popover" id={`${baseId}-${openGroup}`} role="group" aria-label={GROUP_LABEL[openGroup]}>
      <p className="map-toolbar-panel-title">{GROUP_LABEL[openGroup]}</p>
      {groupBody(openGroup)}
    </div>}
  </div>;
}

/* ─────────────────────────────── the three groups ─────────────────────────────── */

function DrawGroup({ role, tool, calibrated, audience, onAudienceChange, audienceActorId, onAudienceActorIdChange, characters, color, onColorChange, colors, gmInk, onGmInkChange, onClear, id, onPickTool }: MapToolbarProps & { id: string; onPickTool: (tool: MapTool) => void }) {
  const scopes: ReadonlyArray<{ scope: ClearScope; label: string }> = role === "gm"
    ? [{ scope: "mine", label: "Remove all my shapes" }, { scope: "players", label: "Remove all player shapes" }, { scope: "all", label: "Remove all shapes" }]
    : [{ scope: "mine", label: "Remove all my shapes" }];

  return <>
    <div className="map-toolbar-choices" role="group" aria-label="Shapes">
      {SHAPE_TOOLS.map((shape) => <button key={shape.id} type="button" className="map-toolbar-choice tap-target interactive" aria-pressed={tool === shape.id} disabled={!calibrated} title={calibrated ? `Place a ${shape.label.toLowerCase()}` : NEEDS_GRID} onClick={() => onPickTool(shape.id)}>{shape.label}</button>)}
    </div>
    {!calibrated && <p className="map-toolbar-note">{NEEDS_GRID}</p>}

    <Field label="Who sees new drawings" htmlFor={`${id}-audience`} className="map-toolbar-field">
      <Select id={`${id}-audience`} value={audience} onChange={(event) => onAudienceChange(event.target.value as AnnotationVisibility)}>
        {drawingAudienceOptions(role).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </Field>
    {audience === "gm-actor" && <Field label="Character" htmlFor={`${id}-audience-actor`} className="map-toolbar-field">
      <Select id={`${id}-audience-actor`} value={audienceActorId ?? ""} onChange={(event) => onAudienceActorIdChange(event.target.value || null)}>
        <option value="">Choose…</option>
        {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
      </Select>
    </Field>}
    {role === "gm" && <Switch className="map-toolbar-switch" checked={gmInk} onChange={onGmInkChange} label="GM ink" />}
    {role === "gm" && <p className="map-toolbar-note">While GM ink is on, new drawings are GM only and only GM drawings can be picked up.</p>}

    <p className="map-toolbar-label"><span aria-hidden="true"><IconColor /></span>Your colour</p>
    <div className="encounter-map-swatches" role="group" aria-label="Your colour">
      {colors.map((swatch) => <button key={swatch} type="button" aria-label={swatch} aria-pressed={color.toLowerCase() === swatch} className={`tap-target${color.toLowerCase() === swatch ? " selected" : ""}`} style={{ background: swatch }} onClick={() => onColorChange(swatch)} />)}
    </div>
    <label className="map-toolbar-custom-colour">Custom<input type="color" value={color} onChange={(event) => onColorChange(event.target.value)} /></label>

    <p className="map-toolbar-label"><span aria-hidden="true"><IconCleanup /></span>Clean up</p>
    <div className="map-toolbar-actions">
      {scopes.map((entry) => <Button key={entry.scope} variant="secondary" block onClick={() => onClear(entry.scope)}>{entry.label}</Button>)}
    </div>
  </>;
}

function FogGroup({ tool, fogEnabled, fogBusy, onFogEnabledChange, onRevealAll, onHideAll, onPickTool }: MapToolbarProps & { onPickTool: (tool: MapTool) => void }) {
  return <>
    <Switch className="map-toolbar-switch" checked={fogEnabled} disabled={fogBusy} onChange={onFogEnabledChange} label="Fog of war" />
    <p className="map-toolbar-note">{fogEnabled ? "Players see only the areas you have revealed." : "Turn this on to cover the map, then reveal it area by area."}</p>
    <div className="map-toolbar-choices" role="group" aria-label="Fog tools">
      <button type="button" className="map-toolbar-choice tap-target interactive" aria-pressed={tool === "fog-reveal"} disabled={fogBusy || !fogEnabled} title="Drag the areas players can see" onClick={() => onPickTool(tool === "fog-reveal" ? "select" : "fog-reveal")}>
        <span className="map-toolbar-row-icon" aria-hidden="true"><IconEye /></span>Reveal
      </button>
      <button type="button" className="map-toolbar-choice tap-target interactive" aria-pressed={tool === "fog-hide"} disabled={fogBusy || !fogEnabled} title="Drag an area to cover it again" onClick={() => onPickTool(tool === "fog-hide" ? "select" : "fog-hide")}>
        <span className="map-toolbar-row-icon" aria-hidden="true"><IconEyeOff /></span>Hide
      </button>
    </div>
    <div className="map-toolbar-actions">
      <Button variant="secondary" block disabled={fogBusy || !fogEnabled} onClick={onRevealAll}>Reveal the whole map</Button>
      <Button variant="secondary" block disabled={fogBusy || !fogEnabled} onClick={onHideAll}>Hide the whole map again</Button>
    </div>
  </>;
}

function ViewGroup({ role, calibrated, onZoom, onResetView, enlarged, onToggleEnlarged, fullscreen, onToggleFullscreen, dock, rulerWhileMoving, onRulerWhileMovingChange, occupiedCost, onOccupiedCostChange, notificationsMuted, onNotificationsMutedChange, id }: MapToolbarProps & { id: string }) {
  return <>
    <div className="map-toolbar-actions map-toolbar-actions-row">
      <Button variant="secondary" onClick={() => onZoom(1.3)}>Zoom in</Button>
      <Button variant="secondary" onClick={() => onZoom(1 / 1.3)}>Zoom out</Button>
    </div>
    <div className="map-toolbar-actions">
      <Button variant="secondary" block onClick={onResetView}>Reset view</Button>
      <Button variant="secondary" block disabled={fullscreen} onClick={onToggleEnlarged}>{enlarged ? "Shrink map" : "Enlarge map"}</Button>
      <Button variant="secondary" block onClick={onToggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</Button>
    </div>
    {dock && <Field label="Turn order panel" className="map-toolbar-field">
      <SegmentedControl
        ariaLabel="Turn order panel position"
        size="sm"
        className="map-toolbar-segmented"
        value={dock.position}
        onChange={(value) => dock.onChange(value as DockPosition)}
        options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }, { value: "sidebar", label: "Sidebar" }]}
      />
    </Field>}
    <Switch className="map-toolbar-switch" checked={rulerWhileMoving} disabled={!calibrated} onChange={onRulerWhileMovingChange} label="Show distance while moving" />
    {role === "gm" && <Switch className="map-toolbar-switch" checked={occupiedCost} disabled={!calibrated} onChange={onOccupiedCostChange} label="Add 5 ft per occupied square" />}
    <Switch className="map-toolbar-switch" checked={!notificationsMuted} onChange={(on) => onNotificationsMutedChange(!on)} label="Notifications" />
    <p className="map-toolbar-note">Notifications are muted for you only — the rest of the table still sees them.</p>
  </>;
}
