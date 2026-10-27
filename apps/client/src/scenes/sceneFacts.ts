import type { GmView, Scene, SceneCombat } from "@vtt/domain";
import type { MapAsset } from "../maps/map-catalog";

/**
 * What the Scenes tab says about a scene, worked out once from the GM's view and the map library: its state, its map
 * and grid, who is in it, its light, and what still needs the GM. Every count here is the GM's own; none of it is sent.
 */

export type SceneState = "live" | "prepared" | "parked" | "replay";

export const STATE_LABEL: Readonly<Record<SceneState, string>> = {
  live: "Live",
  prepared: "Prepared",
  parked: "Fight parked",
  replay: "Replay"
};

export type GridState = "grid" | "scale" | "none" | "unknown";

/** Whether a scene's fight has been run: one running or parked is in progress, one that ended is completed. */
export type SceneProgress = "not-started" | "in-progress" | "completed";
export const PROGRESS_LABEL: Readonly<Record<SceneProgress, string>> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed"
};

export type SceneFacts = Readonly<{
  scene: Scene;
  live: boolean;
  state: SceneState;
  progress: SceneProgress;
  /** The scene's own combat, or the live table's for the live scene (whose slot is empty by design). */
  combat: SceneCombat;
  map: MapAsset | null;
  grid: GridState;
  tokens: number;
  placed: number;
  waiting: number;
  monsters: number;
  walls: number;
  doors: number;
  windows: number;
  lights: number;
  /** Characters archived since they were staged; going live keeps them, and the GM is told. */
  archived: readonly string[];
}>;

type Measured = Pick<MapAsset, "calibration" | "scale">;

export function gridStateOf(map: Measured | null): GridState {
  if (!map) return "unknown";
  if (map.calibration) return "grid";
  return map.scale ? "scale" : "none";
}

/** The live table's combat as a scene's, so the live scene reads like any other. */
function liveCombat(view: GmView): SceneCombat {
  const {
    mapAssetId: _map,
    scenes: _scenes,
    activeSceneId: _active,
    historyCursor,
    historyDirty,
    ...combat
  } = view.combat;
  void historyCursor;
  void historyDirty;
  return combat as SceneCombat;
}

export function factsOf(view: GmView, scene: Scene, maps: readonly MapAsset[] | null): SceneFacts {
  const live = view.combat.activeSceneId === scene.id;
  const combat = live ? liveCombat(view) : scene.combat;
  const map = maps?.find((candidate) => candidate.id === scene.mapAssetId) ?? null;
  const byId = new Map(view.actors.map((actor) => [actor.id, actor]));
  const staged = combat.initiative.map((entry) => byId.get(entry.actorId)).filter((actor) => actor !== undefined);
  const placed = combat.tokens.filter((token) => token.position !== null).length;
  const walls = combat.vision.walls;
  return {
    scene,
    live,
    state: live ? "live" : scene.replayOf ? "replay" : combat.active ? "parked" : "prepared",
    progress: combat.active ? "in-progress" : scene.fightEndedAt !== undefined ? "completed" : "not-started",
    combat,
    map,
    grid: maps === null ? "unknown" : gridStateOf(map),
    tokens: combat.initiative.length,
    placed,
    waiting: combat.tokens.length - placed,
    monsters: staged.filter((actor) => actor.kind === "monster").length,
    walls: walls.filter((wall) => wall.kind === "wall").length,
    doors: walls.filter((wall) => wall.kind === "door").length,
    windows: walls.filter((wall) => wall.kind === "window").length,
    lights: combat.vision.lights.length,
    archived: staged.filter((actor) => actor.archived).map((actor) => actor.name)
  };
}

/** A count with its noun, singular for one: "1 wall", "3 walls". */
export function count(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function tokensLine(facts: SceneFacts): string {
  if (facts.tokens === 0) return "Nobody yet";
  return facts.waiting === 0
    ? `${count(facts.tokens, "token")} · all on the map`
    : `${count(facts.tokens, "token")} · ${facts.waiting} in the tray`;
}

/** What is drawn on the map, naming only the kinds it has: "1 wall · 1 door · 1 light". */
export function drawnLine(facts: SceneFacts): string {
  const parts = [
    facts.walls > 0 && count(facts.walls, "wall"),
    facts.doors > 0 && count(facts.doors, "door"),
    facts.windows > 0 && count(facts.windows, "window"),
    facts.lights > 0 && count(facts.lights, "light")
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "No walls or lights drawn";
}

export function lightLine(facts: SceneFacts): string {
  const vision = facts.combat.vision;
  const parts = [vision.enabled ? `Vision on · ${vision.ambient}` : "Vision off"];
  if (facts.walls + facts.doors + facts.windows + facts.lights > 0) parts.push(drawnLine(facts));
  if (facts.combat.fog.enabled) parts.push("Fog on");
  return parts.join(" · ");
}

export function gridLine(grid: GridState, map: Measured | null): string {
  if (grid === "grid" && map?.calibration)
    return `${Math.round(map.calibration.calibration.cellSizePx)} px squares · ${map.calibration.calibration.distancePerCell} ft`;
  if (grid === "scale" && map?.scale)
    return `Scale · ${map.scale.distancePerPixel.toPrecision(3)} ${map.scale.unit} per pixel`;
  if (grid === "none") return "No grid yet";
  return "Map not in the library";
}

/** One thing a scene still needs before or while it is played, with the step that answers it. */
export type SceneNeed = Readonly<{
  id: "grid" | "nobody" | "waiting" | "walls" | "archived";
  text: string;
  step: "map" | "tokens" | "light";
}>;

/** What a scene still needs, in the order a GM fixes them. Each sentence names the scene's own state. */
export function needsOf(facts: SceneFacts): SceneNeed[] {
  const needs: SceneNeed[] = [];
  const mapName = facts.map?.name ?? "Its map";
  if (facts.grid === "none")
    needs.push({ id: "grid", text: `${mapName} has no grid yet, so tokens won't snap to squares.`, step: "map" });
  if (facts.tokens === 0) needs.push({ id: "nobody", text: "Nobody is in this scene yet.", step: "tokens" });
  else if (facts.waiting > 0 && !facts.live)
    needs.push({
      id: "waiting",
      text: `${count(facts.waiting, "token")} ${facts.waiting === 1 ? "waits" : "wait"} in the tray, off the map.`,
      step: "tokens"
    });
  if (facts.combat.vision.enabled && facts.walls + facts.doors === 0)
    needs.push({
      id: "walls",
      text: "Vision is on and no walls are drawn, so everyone sees everywhere.",
      step: "light"
    });
  if (facts.archived.length > 0)
    needs.push({
      id: "archived",
      text: `${facts.archived.join(", ")} ${facts.archived.length === 1 ? "is" : "are"} archived and still staged here.`,
      step: "tokens"
    });
  return needs;
}

/** The newest of a scene's stamps, for Modified: its last change, or when it was made or last live. */
export function modifiedAt(scene: Scene): number | null {
  const stamps = [scene.updatedAt, scene.liveAt, scene.createdAt].filter(
    (stamp): stamp is number => stamp !== undefined
  );
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

/** A date the way the lists show it: Today 21:40, Yesterday, or Oct 17. */
export function whenLabel(at: number | string | null, now: number = Date.now()): string {
  if (at === null) return "None";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "None";
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return `Today ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whether a scene can be made live as it stands, for Prep's list and checklist. A presentation of the facts; nothing
 *  stored. Live comes first; then the map: none chosen, the library still loading, or chosen and gone from it; then
 *  Ready when the grid is known and nothing needs the GM, Draft otherwise. A parked fight or a replay keeps its own label
 *  beside this one. */
export type Readiness = "live" | "ready" | "draft" | "needs-map" | "loading-map" | "map-unavailable";

export const READINESS_LABEL: Readonly<Record<Readiness, string>> = {
  live: "Live",
  ready: "Ready",
  draft: "Draft",
  "needs-map": "Needs a map",
  "loading-map": "Loading map",
  "map-unavailable": "Map unavailable"
};

export function readinessOf(facts: SceneFacts, maps: readonly MapAsset[] | null): Readiness {
  if (facts.live) return "live";
  if (!facts.scene.mapAssetId) return "needs-map";
  if (maps === null) return "loading-map";
  if (!facts.map) return "map-unavailable";
  return facts.grid !== "unknown" && needsOf(facts).length === 0 ? "ready" : "draft";
}
