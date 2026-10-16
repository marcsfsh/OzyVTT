import type { AnnotationShapeKind, AnnotationVisibility } from "@vtt/domain";
import type { DockPosition } from "../encounter/DockPicker";

/** The map's tools and the toolbar's contract, shared by the toolbar, its groups and the map. */

/** The map's pointer mode; defined here because the toolbar sets it. */
export type MapTool =
  | "select"
  | "measure"
  | "ping"
  | "fog-reveal"
  | "fog-hide"
  | "terrain-difficult"
  | "terrain-clear"
  | AnnotationShapeKind;

export type ClearScope = "mine" | "players" | "all";

/** The uncalibrated-map reason, reused so a disabled control always says why. */
export const NEEDS_GRID = "Needs a calibrated grid — set one up on the Scenes tab, under Maps.";

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

  /* Terrain (GM only) */
  terrainBusy: boolean;
  /** Whether this map has any difficult terrain to clear. */
  hasTerrain: boolean;
  onClearTerrain: () => void;

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
  notificationsMuted: boolean;
  onNotificationsMutedChange: (muted: boolean) => void;
}
