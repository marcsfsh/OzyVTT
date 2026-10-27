import type { AnnotationShapeKind, AnnotationVisibility, MapTrap, PlayerTrap, SceneEnvironment } from "@vtt/domain";

/** The map's tools and the rail's contract, shared by the rail, its groups and the map. */

/** The map's pointer mode; defined here because the rail sets it. */
export type MapTool =
  | "select"
  | "measure"
  | "ping"
  | "fog-reveal"
  | "fog-hide"
  | "terrain-difficult"
  | "terrain-water"
  | "terrain-running-water"
  | "terrain-ice"
  | "terrain-clear"
  | "trap-place"
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

/** The ground a GM paints, with the tool that paints it (SRD 5.2.1 Gameplay Toolbox, Environmental Effects). */
export const GROUND_TOOLS = [
  { tool: "terrain-difficult", op: "difficult", label: "Difficult", title: "Drag an area to mark it difficult." },
  { tool: "terrain-water", op: "water", label: "Water", title: "Drag an area of still water. Swimming costs double." },
  {
    tool: "terrain-running-water",
    op: "running-water",
    label: "Running water",
    title: "Drag an area of running water: a stream or a river."
  },
  {
    tool: "terrain-ice",
    op: "ice",
    label: "Ice",
    title: "Drag an area of slippery ice. It is difficult, and asks a DEX save against falling Prone."
  }
] as const;
export type GroundOp = (typeof GROUND_TOOLS)[number]["op"] | "clear";

/** The Gameplay Toolbox's sample traps a GM can set. */
export const TRAP_KINDS = [
  { id: "collapsing-roof", name: "Collapsing Roof" },
  { id: "falling-net", name: "Falling Net" },
  { id: "fire-casting-statue", name: "Fire-Casting Statue" },
  { id: "hidden-pit", name: "Hidden Pit" },
  { id: "poisoned-darts", name: "Poisoned Darts" },
  { id: "poisoned-needle", name: "Poisoned Needle" },
  { id: "rolling-stone", name: "Rolling Stone" },
  { id: "spiked-pit", name: "Spiked Pit" }
] as const;

/** The bands of character levels a trap is scaled for. A trap printed for fewer bands takes the nearest it has. */
export const TRAP_TIERS = [
  { tier: 1, label: "Levels 1-4" },
  { tier: 2, label: "Levels 5-10" },
  { tier: 3, label: "Levels 11-16" },
  { tier: 4, label: "Levels 17-20" }
] as const;

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
  /** Whether this map has any painted ground (difficult terrain, water or ice) to clear. */
  hasTerrain: boolean;
  onClearTerrain: () => void;

  /* Traps and weather (GM only, the live table) */
  /** The traps on the live map; absent where traps can't be set here (a prepared scene's map). */
  traps?: readonly MapTrap[];
  trapKind: string;
  onTrapKindChange: (trapId: string) => void;
  trapTier: number;
  onTrapTierChange: (tier: number) => void;
  onEditTrap: (trapId: string, change: Readonly<{ found?: boolean; state?: "armed" | "disarmed" }>) => void;
  onSpringTrap: (trapId: string) => void;
  onRemoveTrap: (trapId: string) => void;
  /** A player's: the traps the party has found, and the character of theirs who would make one safe. */
  foundTraps?: readonly PlayerTrap[];
  disarmerName?: string | null;
  onDisarmTrap: (trapId: string, wayId: string) => void;
  /** The live scene's climate and weather; absent where it can't be set here. */
  environment?: SceneEnvironment;
  onEnvironmentChange: (change: Partial<SceneEnvironment>) => void;

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
