import { type SortDirection, type SortLevelOf } from "@vtt/ui";
import type { SceneFacts, SceneProgress, SceneState } from "./sceneFacts";
import { modifiedAt, needsOf } from "./sceneFacts";

/**
 * What the Scenes table filters and sorts on. Pure, so the table and its tests agree: the State dropdown, the
 * filters in the flyout, and a sort over several columns in order, as a spreadsheet sorts.
 */

export const SCENE_STATES: readonly SceneState[] = ["live", "prepared", "parked", "replay"];

export type SceneFilters = Readonly<{
  /** The State dropdown: every state ticked by default. */
  states: readonly SceneState[];
  /** Map ids to keep; empty keeps every map. */
  mapIds: readonly string[];
  codex: "any" | "linked" | "unlinked";
  /** Only scenes with tokens still in the tray. */
  waiting: boolean;
  vision: "any" | "on" | "off";
  fog: "any" | "on" | "off";
  sound: "any" | "set" | "none";
  /** The Modified range, as `YYYY-MM-DD` days, either end open. */
  from: string | null;
  to: string | null;
}>;

export const NO_SCENE_FILTERS: SceneFilters = {
  states: SCENE_STATES,
  mapIds: [],
  codex: "any",
  waiting: false,
  vision: "any",
  fog: "any",
  sound: "any",
  from: null,
  to: null
};

export type SceneSortKey = "order" | "name" | "state" | "progress" | "attention" | "map" | "tokens" | "modified";
export type SortLevel<Key extends string> = SortLevelOf<Key>;
export const SCENE_SORT_KEYS: readonly SceneSortKey[] = [
  "order",
  "name",
  "state",
  "progress",
  "attention",
  "map",
  "tokens",
  "modified"
];

export const SCENE_SORT_LABEL: Readonly<Record<SceneSortKey, string>> = {
  order: "Your order",
  name: "Name",
  state: "State",
  progress: "Progress",
  attention: "Needs attention",
  map: "Map",
  tokens: "Tokens",
  modified: "Modified"
};

/** The GM's own order first, so the running order of an evening is what the table opens on. */
export const DEFAULT_SCENE_SORT: readonly SortLevel<SceneSortKey>[] = [{ key: "order", direction: "asc" }];

/** How a direction reads for a column: words A to Z, dates newest first, the GM's order first to last. */
export function sortDirectionLabel(key: string, direction: SortDirection): string {
  if (key === "modified") return direction === "desc" ? "Newest first" : "Oldest first";
  if (key === "order") return direction === "asc" ? "First to last" : "Last to first";
  if (key === "tokens" || key === "used") return direction === "asc" ? "Fewest first" : "Most first";
  if (key === "state") return direction === "asc" ? "Live first" : "Live last";
  if (key === "grid") return direction === "asc" ? "No grid first" : "Grid set first";
  if (key === "attention") return direction === "asc" ? "Most to do first" : "Most to do last";
  if (key === "progress") return direction === "asc" ? "Not started first" : "Completed first";
  return direction === "asc" ? "A to Z" : "Z to A";
}

/** A column starts newest first when it is a date, and in reading order otherwise. */
export function firstSortDirection(key: string): SortDirection {
  return key === "modified" ? "desc" : "asc";
}

/** "Sort: Name, then Modified". */
export function sortSummary<Key extends string>(
  levels: readonly SortLevel<Key>[],
  label: Readonly<Record<Key, string>>
): string {
  return `Sort: ${levels.map((level) => label[level.key]).join(", then ")}`;
}

/** The sort the address holds (`?sort=name:asc,modified:desc`), or the list's own when it holds none it knows. */
export function readSort<Key extends string>(
  query: URLSearchParams,
  keys: readonly Key[],
  fallback: readonly SortLevel<Key>[]
): readonly SortLevel<Key>[] {
  const levels: SortLevel<Key>[] = [];
  for (const part of (query.get("sort") ?? "").split(",")) {
    const [key = "", direction] = part.split(":");
    if (!keys.includes(key as Key) || levels.some((level) => level.key === key)) continue;
    levels.push({ key: key as Key, direction: direction === "desc" ? "desc" : "asc" });
  }
  return levels.length > 0 ? levels.slice(0, 4) : fallback;
}

/** The sort as the address writes it, or nothing for the list's own. */
export function sortParam<Key extends string>(
  levels: readonly SortLevel<Key>[],
  fallback: readonly SortLevel<Key>[]
): string | null {
  const text = levels.map((level) => `${level.key}:${level.direction}`).join(",");
  return text === fallback.map((level) => `${level.key}:${level.direction}`).join(",") ? null : text;
}

/** One of a few words from the address, or the default when it holds another. */
function oneOf<Value extends string>(value: string | null, allowed: readonly Value[], fallback: Value): Value {
  return allowed.includes(value as Value) ? (value as Value) : fallback;
}

/** A `YYYY-MM-DD` day from the address, or nothing. */
export function dayOf(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** The Scenes table's filters as its address holds them, so a filtered list is a link and survives a refresh. */
export function readSceneFilters(query: URLSearchParams): SceneFilters {
  const stateText = query.get("state");
  const states =
    stateText === null
      ? SCENE_STATES
      : stateText === "none"
        ? []
        : SCENE_STATES.filter((state) => stateText.split(",").includes(state));
  return {
    states,
    mapIds: query.getAll("map"),
    codex: oneOf(query.get("codex"), ["any", "linked", "unlinked"], "any"),
    waiting: query.get("tray") === "1",
    vision: oneOf(query.get("vision"), ["any", "on", "off"], "any"),
    fog: oneOf(query.get("fog"), ["any", "on", "off"], "any"),
    sound: oneOf(query.get("sound"), ["any", "set", "none"], "any"),
    from: dayOf(query.get("from")),
    to: dayOf(query.get("to"))
  };
}

/** Writes the filters into the address: a filter left at its default leaves no key behind. */
export function writeSceneFilters(query: URLSearchParams, filters: SceneFilters): void {
  const states = SCENE_STATES.filter((state) => filters.states.includes(state));
  setOrDelete(
    query,
    "state",
    states.length === SCENE_STATES.length ? null : states.length === 0 ? "none" : states.join(",")
  );
  query.delete("map");
  for (const id of filters.mapIds) query.append("map", id);
  setOrDelete(query, "codex", filters.codex === "any" ? null : filters.codex);
  setOrDelete(query, "tray", filters.waiting ? "1" : null);
  setOrDelete(query, "vision", filters.vision === "any" ? null : filters.vision);
  setOrDelete(query, "fog", filters.fog === "any" ? null : filters.fog);
  setOrDelete(query, "sound", filters.sound === "any" ? null : filters.sound);
  setOrDelete(query, "from", filters.from);
  setOrDelete(query, "to", filters.to);
}

export function setOrDelete(query: URLSearchParams, key: string, value: string | null): void {
  if (value === null) query.delete(key);
  else query.set(key, value);
}

/** How many of the flyout's filters are set, for the Filters button. The State and Modified dropdowns count apart. */
export function activeFilterCount(filters: SceneFilters): number {
  return [
    filters.mapIds.length > 0,
    filters.codex !== "any",
    filters.waiting,
    filters.vision !== "any",
    filters.fog !== "any",
    filters.sound !== "any"
  ].filter(Boolean).length;
}

/** What the Modified dropdown says: Any time, Since a day, Until a day, or both. */
export function modifiedRangeLabel(from: string | null, to: string | null): string {
  const day = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (from && to) return `Modified: ${day(from)} to ${day(to)}`;
  if (from) return `Modified: since ${day(from)}`;
  if (to) return `Modified: until ${day(to)}`;
  return "Modified: any time";
}

/** The start of a `YYYY-MM-DD` day and the end of another, in local time. */
export function dayRange(from: string | null, to: string | null): readonly [number, number] {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  return [Number.isNaN(start) ? Number.NEGATIVE_INFINITY : start, Number.isNaN(end) ? Number.POSITIVE_INFINITY : end];
}

export function filterScenes(
  rows: readonly SceneFacts[],
  filters: SceneFilters,
  context: Readonly<{ linked: (sceneId: string) => boolean; hasSound: (sceneId: string) => boolean }>
): SceneFacts[] {
  const [start, end] = dayRange(filters.from, filters.to);
  return rows.filter((row) => {
    if (!filters.states.includes(row.state)) return false;
    if (filters.mapIds.length > 0 && !filters.mapIds.includes(row.scene.mapAssetId)) return false;
    if (filters.codex !== "any" && context.linked(row.scene.id) !== (filters.codex === "linked")) return false;
    if (filters.waiting && row.waiting === 0) return false;
    if (filters.vision !== "any" && row.combat.vision.enabled !== (filters.vision === "on")) return false;
    if (filters.fog !== "any" && row.combat.fog.enabled !== (filters.fog === "on")) return false;
    if (filters.sound !== "any" && context.hasSound(row.scene.id) !== (filters.sound === "set")) return false;
    if (filters.from !== null || filters.to !== null) {
      const at = modifiedAt(row.scene);
      if (at === null || at < start || at > end) return false;
    }
    return true;
  });
}

const STATE_RANK: Readonly<Record<SceneState, number>> = { live: 0, parked: 1, prepared: 2, replay: 3 };
const PROGRESS_RANK: Readonly<Record<SceneProgress, number>> = { "not-started": 0, "in-progress": 1, completed: 2 };

/** Sorts by the first level, then by each level under it; the GM's order breaks any tie that is left. */
export function sortScenes(
  rows: readonly SceneFacts[],
  levels: readonly SortLevel<SceneSortKey>[],
  order: readonly string[]
): SceneFacts[] {
  const position = new Map(order.map((id, index) => [id, index]));
  const compareBy = (key: SceneSortKey, left: SceneFacts, right: SceneFacts): number => {
    switch (key) {
      case "order":
        return (position.get(left.scene.id) ?? 0) - (position.get(right.scene.id) ?? 0);
      case "name":
        return left.scene.name.localeCompare(right.scene.name);
      case "state":
        return STATE_RANK[left.state] - STATE_RANK[right.state];
      case "progress":
        return PROGRESS_RANK[left.progress] - PROGRESS_RANK[right.progress];
      // Most first in its natural direction: what needs the GM most comes to the top.
      case "attention":
        return needsOf(right).length - needsOf(left).length;
      case "map":
        return (left.map?.name ?? "").localeCompare(right.map?.name ?? "");
      case "tokens":
        return left.tokens - right.tokens;
      case "modified":
        return (modifiedAt(left.scene) ?? 0) - (modifiedAt(right.scene) ?? 0);
    }
  };
  return [...rows].sort((left, right) => {
    for (const level of levels) {
      const result = compareBy(level.key, left, right);
      if (result !== 0) return level.direction === "asc" ? result : -result;
    }
    return compareBy("order", left, right);
  });
}
