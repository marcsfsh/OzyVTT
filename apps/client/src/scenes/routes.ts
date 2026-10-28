/**
 * The Scenes tab's addresses. Every scene and every map has one, and so does each step of making or editing one, so a
 * reload or a link lands where the GM was.
 *
 *   /encounters                     the front page: New map and New scene, then the Scenes tab
 *   /encounters/list                the same page, on its Scenes tab
 *   /encounters/new                 a new scene, from its first step
 *   /encounters/<id>                a scene, as one document
 *   /encounters/<id>?step=<step>    a scene's steps, as its editor
 *   /encounters/maps                the front page on its Maps tab
 *   /encounters/maps/new            a new map, from its first step
 *   /encounters/maps/<id>           a map, as one document
 *   /encounters/maps/<id>?step=...  a map's steps
 *
 * `?back=<path>` on a map's steps is where the GM goes once the grid is set: the table, or the scene that asked.
 */

export const SCENE_STEPS = ["map", "tokens", "light", "sound", "review"] as const;
export type SceneStep = (typeof SCENE_STEPS)[number];
export const MAP_STEPS = ["upload", "grid", "check", "use"] as const;
export type MapStep = (typeof MAP_STEPS)[number];

export type ScenesSection = "scenes" | "maps";

export type ScenesView =
  | Readonly<{ view: "scenes" }>
  /** `encounterId` null is a new scene; `step` null is the scene's document. */
  | Readonly<{ view: "scene"; encounterId: string | null; step: SceneStep | null }>
  | Readonly<{ view: "maps" }>
  | Readonly<{ view: "map"; mapId: string | null; step: MapStep | null }>;

const isSceneStep = (value: string | null): value is SceneStep => SCENE_STEPS.includes(value as SceneStep);
const isMapStep = (value: string | null): value is MapStep => MAP_STEPS.includes(value as MapStep);

/** The view an address under `/encounters` names, or null when it names none. */
export function scenesViewOf(segments: readonly string[], query: URLSearchParams): ScenesView | null {
  if (segments[0] !== "encounters") return null;
  const [, second, third] = segments;
  if (segments.length === 1) return { view: "scenes" };
  if (segments.length > 3 || !second) return null;
  if (second === "maps") {
    if (segments.length === 2) return { view: "maps" };
    if (!third) return null;
    const step = query.get("step");
    if (third === "new") return { view: "map", mapId: null, step: isMapStep(step) ? step : "upload" };
    return { view: "map", mapId: third, step: isMapStep(step) ? step : null };
  }
  if (segments.length === 3) return null;
  if (second === "list") return { view: "scenes" };
  const step = query.get("step");
  if (second === "new") return { view: "scene", encounterId: null, step: "map" };
  return { view: "scene", encounterId: second, step: isSceneStep(step) ? step : null };
}

/** Which section of the bar lights for a view: a scene lights Scenes, a map lights Maps. */
export function sectionOf(view: ScenesView): ScenesSection {
  if (view.view === "maps" || view.view === "map") return "maps";
  return "scenes";
}

export const SCENES_PATHS = {
  overview: "/encounters",
  list: "/encounters/list",
  newScene: "/encounters/new",
  maps: "/encounters/maps",
  newMap: "/encounters/maps/new"
} as const;

export function pathForScene(encounterId: string, step?: SceneStep | null): string {
  return step ? `/encounters/${encounterId}?step=${step}` : `/encounters/${encounterId}`;
}

export function pathForMap(mapId: string, step?: MapStep | null, back?: string | null): string {
  const query = new URLSearchParams();
  if (step) query.set("step", step);
  if (back) query.set("back", back);
  const search = query.toString();
  return `/encounters/maps/${mapId}${search ? `?${search}` : ""}`;
}

/** Where a map's steps send the GM when done: only back into the app's own table or Scenes tab. */
export function backPathOf(query: URLSearchParams): string | null {
  const back = query.get("back");
  return back && (back === "/table" || back.startsWith("/encounters")) && !back.startsWith("//") ? back : null;
}

/** The map library's old address for one map's grid, kept so an old link lands on that map's grid step. */
export function redirectForOldMapAddress(path: string, query: URLSearchParams): string | null {
  if (path !== "/encounters/maps") return null;
  const mapId = query.get("map");
  if (!mapId) return null;
  return pathForMap(mapId, "grid", query.get("from") === "table" ? "/table" : null);
}

/** Scenes created here and not yet in the state the server sent: their pages say they are opening, until it arrives. */
export const arrivingScenes = new Set<string>();
