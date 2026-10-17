import { useEffect, useId, useState, type ReactNode } from "react";
import {
  IconDraw,
  IconFog,
  IconLocate,
  IconMeasure,
  IconPing,
  IconSearch,
  IconSelect,
  IconSparkle,
  IconTerrain,
  IconWall,
  IconX
} from "@vtt/ui";
import { isVisionTool, NEEDS_GRID, type MapRailProps, type MapTool } from "./mapTools";
import { DrawGroup, FogGroup, LightGroup, TerrainGroup, ViewGroup, WallsGroup } from "./MapToolGroups";
import "./map-rail.css";

/**
 * The map's tools, beside the map and never over it: a rail on the left of a laptop's map and a row above a phone's.
 * Select, Measure and Ping are tools in themselves. The others are groups whose options open in a column beside the
 * rail (a row under it on a phone), and the map narrows to make room. The rail holds no map state: values are props
 * and changes are callbacks, so every change still goes through the map's commands.
 */

type GroupId = "draw" | "fog" | "terrain" | "walls" | "light" | "view";

const GROUP_LABEL: Record<GroupId, string> = {
  draw: "Draw",
  fog: "Fog",
  terrain: "Terrain",
  walls: "Walls",
  light: "Light",
  view: "View"
};

const GROUP_ICON: Record<GroupId, ReactNode> = {
  draw: <IconDraw />,
  fog: <IconFog />,
  terrain: <IconTerrain />,
  walls: <IconWall />,
  light: <IconSparkle />,
  view: <IconSearch />
};

const DIRECT_TOOLS: ReadonlyArray<{ id: MapTool; label: string; title: string; icon: ReactNode; needsGrid?: true }> = [
  { id: "select", label: "Select", title: "Select and move", icon: <IconSelect /> },
  { id: "measure", label: "Measure", title: "Measure distance", icon: <IconMeasure />, needsGrid: true },
  { id: "ping", label: "Ping", title: "Ping a spot", icon: <IconPing /> }
];

/** The group a tool belongs to, so the group's button shows it in use while its options are closed. */
function groupOf(tool: MapTool): GroupId | null {
  if (tool.startsWith("fog-")) return "fog";
  if (tool.startsWith("terrain-")) return "terrain";
  if (tool === "vision-light") return "light";
  if (isVisionTool(tool)) return "walls";
  if (tool === "circle" || tool === "cone" || tool === "line" || tool === "square") return "draw";
  return null;
}

export function MapRail(
  props: MapRailProps &
    Readonly<{
      /** The selected drawing's editor: it takes the options column while a drawing is selected. */
      inspector?: ReactNode;
    }>
) {
  const { role, tool, onToolChange, calibrated, onLocate, inspector } = props;
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null);
  const baseId = useId();
  const groups: GroupId[] = role === "gm" ? ["draw", "fog", "terrain", "walls", "light", "view"] : ["draw", "view"];
  const activeGroup = groupOf(tool);

  // Escape closes the open options.
  useEffect(() => {
    if (!openGroup) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenGroup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGroup]);

  const groupBody = (group: GroupId) => {
    if (group === "draw") return <DrawGroup {...props} id={`${baseId}-draw`} onPickTool={onToolChange} />;
    if (group === "fog") return <FogGroup {...props} onPickTool={onToolChange} />;
    if (group === "terrain") return <TerrainGroup {...props} onPickTool={onToolChange} />;
    if (group === "walls") return <WallsGroup {...props} onPickTool={onToolChange} />;
    if (group === "light") return <LightGroup {...props} id={`${baseId}-light`} onPickTool={onToolChange} />;
    return <ViewGroup {...props} />;
  };
  const optionsId = `${baseId}-options`;
  const shown: GroupId | "inspector" | null = inspector ? "inspector" : openGroup;

  return (
    <div className={`map-rail-wrap${shown ? " has-options" : ""}`}>
      <div className="map-rail" role="toolbar" aria-label="Map tools">
        {DIRECT_TOOLS.map((entry) => {
          const blocked = entry.needsGrid === true && !calibrated;
          return (
            <button
              key={entry.id}
              type="button"
              className="map-rail-button interactive"
              aria-pressed={tool === entry.id}
              disabled={blocked}
              title={blocked ? NEEDS_GRID : entry.title}
              onClick={() => onToolChange(entry.id)}
            >
              <span className="map-rail-icon" aria-hidden="true">
                {entry.icon}
              </span>
              <span className="map-rail-label">{entry.label}</span>
            </button>
          );
        })}
        {onLocate && (
          <button
            type="button"
            className="map-rail-button map-rail-locate interactive"
            title="Bring your token into view"
            onClick={onLocate}
          >
            <span className="map-rail-icon" aria-hidden="true">
              <IconLocate />
            </span>
            <span className="map-rail-label">Me</span>
          </button>
        )}
        {groups.map((group) => (
          <button
            key={group}
            type="button"
            className={`map-rail-button interactive${activeGroup === group ? " in-use" : ""}`}
            aria-expanded={openGroup === group}
            aria-controls={openGroup === group ? optionsId : undefined}
            title={activeGroup === group ? `${GROUP_LABEL[group]} · in use` : GROUP_LABEL[group]}
            onClick={() => setOpenGroup((current) => (current === group ? null : group))}
          >
            <span className="map-rail-icon" aria-hidden="true">
              {GROUP_ICON[group]}
            </span>
            <span className="map-rail-label">{GROUP_LABEL[group]}</span>
          </button>
        ))}
      </div>
      {shown && (
        <div
          className="map-options scroll-y"
          id={optionsId}
          role="group"
          aria-label={shown === "inspector" ? "Selected shape" : GROUP_LABEL[shown]}
        >
          {shown === "inspector" ? (
            inspector
          ) : (
            <>
              <div className="map-options-head">
                <p className="map-options-title">{GROUP_LABEL[shown]}</p>
                <button
                  type="button"
                  className="map-options-close interactive"
                  aria-label={`Close ${GROUP_LABEL[shown]}`}
                  onClick={() => setOpenGroup(null)}
                >
                  <IconX />
                </button>
              </div>
              {groupBody(shown)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
