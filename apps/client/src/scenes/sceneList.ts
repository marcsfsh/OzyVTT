import type { SceneFacts, SceneState } from "./sceneFacts";
import { modifiedAt } from "./sceneFacts";

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

export type SceneSortKey = "order" | "name" | "state" | "map" | "tokens" | "modified";
export type SortLevel<Key extends string> = Readonly<{ key: Key; direction: "asc" | "desc" }>;

export const SCENE_SORT_LABEL: Readonly<Record<SceneSortKey, string>> = {
  order: "Your order",
  name: "Name",
  state: "State",
  map: "Map",
  tokens: "Tokens",
  modified: "Modified"
};

/** The GM's own order first, so the running order of an evening is what the table opens on. */
export const DEFAULT_SCENE_SORT: readonly SortLevel<SceneSortKey>[] = [{ key: "order", direction: "asc" }];

/** How many filters are set, for the Filters button and the chips. The State dropdown counts apart. */
export function activeFilterCount(filters: SceneFilters): number {
  return [
    filters.mapIds.length > 0,
    filters.codex !== "any",
    filters.waiting,
    filters.vision !== "any",
    filters.fog !== "any",
    filters.sound !== "any",
    filters.from !== null || filters.to !== null
  ].filter(Boolean).length;
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
