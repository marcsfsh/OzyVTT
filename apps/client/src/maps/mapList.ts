import { dayOf, dayRange, setOrDelete, type SortLevel } from "../scenes/sceneList";
import { gridStateOf, type GridState } from "../scenes/sceneFacts";
import type { MapAsset, MapKind } from "./map-catalog";

/** What the Maps table filters and sorts on: the Type dropdown, the flyout's filters, and a sort over several columns. */

export const MAP_KINDS: readonly MapKind[] = ["battlemap", "regional", "world"];
export const MAP_KIND_LABEL: Readonly<Record<MapKind, string>> = {
  battlemap: "Battle map",
  regional: "Regional map",
  world: "World map"
};

export type MapFilters = Readonly<{
  /** The Type dropdown: every type ticked by default. */
  kinds: readonly MapKind[];
  /** Folders to keep, with "" for unfiled; empty keeps every folder. */
  folders: readonly string[];
  grid: "any" | GridState;
  used: "any" | "used" | "unused";
  from: string | null;
  to: string | null;
}>;

export const NO_MAP_FILTERS: MapFilters = {
  kinds: MAP_KINDS,
  folders: [],
  grid: "any",
  used: "any",
  from: null,
  to: null
};

export type MapSortKey = "name" | "type" | "grid" | "folder" | "used" | "modified";
export const MAP_SORT_KEYS: readonly MapSortKey[] = ["name", "type", "grid", "folder", "used", "modified"];
export const MAP_SORT_LABEL: Readonly<Record<MapSortKey, string>> = {
  name: "Name",
  type: "Type",
  grid: "Grid",
  folder: "Folder",
  used: "Used in",
  modified: "Modified"
};
/** Newest first, since the map just added is usually the one wanted. */
export const DEFAULT_MAP_SORT: readonly SortLevel<MapSortKey>[] = [{ key: "modified", direction: "desc" }];

/** How many of the flyout's filters are set. The Type and Modified dropdowns count apart. */
export function activeMapFilterCount(filters: MapFilters): number {
  return [filters.folders.length > 0, filters.grid !== "any", filters.used !== "any"].filter(Boolean).length;
}

const GRID_FILTERS: readonly MapFilters["grid"][] = ["any", "grid", "scale", "none"];
const USED_FILTERS: readonly MapFilters["used"][] = ["any", "used", "unused"];

/** The Maps table's filters as its address holds them; `folder=` with no name is the maps in no folder. */
export function readMapFilters(query: URLSearchParams): MapFilters {
  const kindText = query.get("type");
  const grid = query.get("grid");
  const used = query.get("used");
  return {
    kinds:
      kindText === null
        ? MAP_KINDS
        : kindText === "none"
          ? []
          : MAP_KINDS.filter((kind) => kindText.split(",").includes(kind)),
    folders: query.getAll("folder"),
    grid: GRID_FILTERS.find((value) => value === grid) ?? "any",
    used: USED_FILTERS.find((value) => value === used) ?? "any",
    from: dayOf(query.get("from")),
    to: dayOf(query.get("to"))
  };
}

export function writeMapFilters(query: URLSearchParams, filters: MapFilters): void {
  const kinds = MAP_KINDS.filter((kind) => filters.kinds.includes(kind));
  setOrDelete(query, "type", kinds.length === MAP_KINDS.length ? null : kinds.length === 0 ? "none" : kinds.join(","));
  query.delete("folder");
  for (const folder of filters.folders) query.append("folder", folder);
  setOrDelete(query, "grid", filters.grid === "any" ? null : filters.grid);
  setOrDelete(query, "used", filters.used === "any" ? null : filters.used);
  setOrDelete(query, "from", filters.from);
  setOrDelete(query, "to", filters.to);
}

export function filterMaps(
  maps: readonly MapAsset[],
  filters: MapFilters,
  usedIn: (mapId: string) => number
): MapAsset[] {
  const [start, end] = dayRange(filters.from, filters.to);
  return maps.filter((map) => {
    if (!filters.kinds.includes(map.kind)) return false;
    if (filters.folders.length > 0 && !filters.folders.includes(map.folder ?? "")) return false;
    if (filters.grid !== "any" && gridStateOf(map) !== filters.grid) return false;
    if (filters.used !== "any" && usedIn(map.id) > 0 !== (filters.used === "used")) return false;
    if (filters.from !== null || filters.to !== null) {
      const at = Date.parse(map.updatedAt);
      if (Number.isNaN(at) || at < start || at > end) return false;
    }
    return true;
  });
}

const GRID_RANK: Readonly<Record<GridState, number>> = { none: 0, scale: 1, grid: 2, unknown: 3 };

export function sortMaps(
  maps: readonly MapAsset[],
  levels: readonly SortLevel<MapSortKey>[],
  usedIn: (mapId: string) => number
): MapAsset[] {
  const compareBy = (key: MapSortKey, left: MapAsset, right: MapAsset): number => {
    switch (key) {
      case "name":
        return left.name.localeCompare(right.name);
      case "type":
        return MAP_KINDS.indexOf(left.kind) - MAP_KINDS.indexOf(right.kind);
      case "grid":
        return GRID_RANK[gridStateOf(left)] - GRID_RANK[gridStateOf(right)];
      case "folder":
        return (left.folder ?? "").localeCompare(right.folder ?? "");
      case "used":
        return usedIn(left.id) - usedIn(right.id);
      case "modified":
        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    }
  };
  return [...maps].sort((left, right) => {
    for (const level of levels) {
      const result = compareBy(level.key, left, right);
      if (result !== 0) return level.direction === "asc" ? result : -result;
    }
    return left.name.localeCompare(right.name);
  });
}
