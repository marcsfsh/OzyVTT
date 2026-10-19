import type { AnnotationShapeKind, AnnotationVisibility } from "@vtt/domain";

/** The map's tools and the rail's contract, shared by the rail, its groups and the map. */

/** The map's pointer mode; defined here because the rail sets it. */
export type MapTool =
  | "select"
  | "measure"
  | "ping"
  | "fog-reveal"
  | "fog-hide"
  | "terrain-difficult"
  | "terrain-clear"
  | VisionTool
  | AnnotationShapeKind;

/** The GM's dynamic vision tools: drag a wall, door or window; tap to place a light; drag an area of light or
 *  obscurement; tap a wall, light or area to remove it. */
export type VisionTool =
  "vision-wall" | "vision-door" | "vision-window" | "vision-light" | "vision-area" | "vision-erase";
export const isVisionTool = (tool: MapTool): tool is VisionTool => tool.startsWith("vision-");

/** The lights a GM places, by what sheds them (SRD radii: Bright Light, then Dim Light beyond it). */
export const LIGHT_PRESETS = [
  { id: "torch", label: "Torch · 20 ft + 20 ft", brightFeet: 20, dimFeet: 20 },
  { id: "lantern", label: "Lantern · 30 ft + 30 ft", brightFeet: 30, dimFeet: 30 },
  { id: "candle", label: "Candle · 5 ft + 5 ft", brightFeet: 5, dimFeet: 5 },
  { id: "light", label: "Light spell · 20 ft + 20 ft", brightFeet: 20, dimFeet: 20 },
  { id: "daylight", label: "Daylight · 60 ft + 60 ft", brightFeet: 60, dimFeet: 60 },
  { id: "glow", label: "Dim glow · 0 ft + 10 ft", brightFeet: 0, dimFeet: 10 }
] as const;
export type LightPresetId = (typeof LIGHT_PRESETS)[number]["id"];

/** The areas a GM paints over the ambient light (SRD Rules Glossary): a lit room in a dark dungeon, a dark cellar in
 *  daylight, fog or foliage, and magical Darkness that only Blindsight, Truesight and Devil's Sight see into. */
export const AREA_KINDS = [
  { id: "bright", label: "Bright Light" },
  { id: "dim", label: "Dim Light" },
  { id: "dark", label: "Darkness" },
  { id: "lightly-obscured", label: "Lightly Obscured (mist, foliage)" },
  { id: "heavily-obscured", label: "Heavily Obscured (fog, smoke)" },
  { id: "magical-darkness", label: "Magical Darkness" }
] as const;
export type AreaKindId = (typeof AREA_KINDS)[number]["id"];

export type ClearScope = "mine" | "players" | "all";

/** The uncalibrated-map reason, reused so a disabled control always says why. */
export const NEEDS_GRID = "Needs a calibrated grid. Set one up on the Scenes tab, under Maps.";

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

export interface MapRailProps {
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

  /* Vision (GM only) */
  visionEnabled: boolean;
  visionBusy: boolean;
  onVisionEnabledChange: (enabled: boolean) => void;
  ambient: "bright" | "dim" | "dark";
  onAmbientChange: (ambient: "bright" | "dim" | "dark") => void;
  /** The bright ambient light is sunlight (daylight outdoors), which Sunlight Sensitivity reads. */
  sunlight: boolean;
  onSunlightChange: (sunlight: boolean) => void;
  areaKind: AreaKindId;
  onAreaKindChange: (kind: AreaKindId) => void;
  lightPreset: LightPresetId;
  onLightPresetChange: (preset: LightPresetId) => void;
  hasWalls: boolean;
  onClearWalls: () => void;
  onForgetExplored: () => void;
  /** Whose eyes the GM looks through: nobody (null), the whole party, or one creature on the map. */
  lookThrough: string | null;
  onLookThroughChange: (choice: string | null) => void;
  lookThroughOptions: ReadonlyArray<{ id: string; name: string }>;

  /* View */
  onZoom: (factor: number) => void;
  onResetView: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  notificationsMuted: boolean;
  onNotificationsMutedChange: (muted: boolean) => void;
  /** A player's Me: brings their own token into view. Shown in the tool row on a phone. */
  onLocate?: () => void;
}
