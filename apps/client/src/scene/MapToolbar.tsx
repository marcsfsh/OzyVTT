import { useEffect, useId, useRef, useState } from "react";
import {
  IconButton,
  IconChevron,
  IconDraw,
  IconEye,
  IconFog,
  IconMeasure,
  IconPing,
  IconSearch,
  IconSelect
} from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import { NEEDS_GRID, type MapTool, type MapToolbarProps } from "./mapTools";
import { DrawGroup, FogGroup, ViewGroup } from "./MapToolGroups";
import "./map-toolbar.css";

/**
 * The map toolbar. Always visible: the constant tools (Select · Ping · Measure) and three labelled
 * group buttons (Draw · Fog · View), on one row that never wraps; everything else is one tap deeper
 * in the group's panel. At 560px and below it collapses to one `Tools` button at the bottom-left
 * (thumb reach) that opens a vertical rail of the same content.
 *
 * Labels are never hover-only (a phone has no hover), and nothing wraps over the map art.
 * It holds no map state: values are props and changes are callbacks, so fog and annotations still
 * go through the map's commands (`useMapCommands`). The group panels are in `MapToolGroups.tsx`.
 */

type GroupId = "draw" | "fog" | "view";

const GROUP_LABEL: Record<GroupId, string> = { draw: "Draw", fog: "Fog", view: "View" };

const CONSTANT_TOOLS: ReadonlyArray<{ id: MapTool; label: string; icon: React.ReactNode; needsGrid?: boolean }> = [
  { id: "select", label: "Select and move", icon: <IconSelect /> },
  { id: "ping", label: "Ping a spot", icon: <IconPing /> },
  { id: "measure", label: "Measure distance", icon: <IconMeasure />, needsGrid: true }
];

/** The phone collapse breakpoint. */
const COMPACT_QUERY = "(max-width: 560px)";

export function MapToolbar(props: MapToolbarProps) {
  const { role, tool, onToolChange, calibrated, viewerPreview } = props;
  const compact = useMediaQuery(COMPACT_QUERY);
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
