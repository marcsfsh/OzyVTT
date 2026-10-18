import type { SortLevel } from "../scenes/sceneList";
import { MAP_SORT_LABEL, type MapFilters, type MapSortKey } from "./mapList";

/**
 * The Maps table's toolbar: the Type dropdown, Filters and Sort, and how many rows show. The dropdown, the flyout and
 * the sort dialog are the Codex's shared pieces.
 */
export function MapListToolbar({
  sort,
  shown,
  total
}: Readonly<{
  filters: MapFilters;
  onFilters: (filters: MapFilters) => void;
  sort: readonly SortLevel<MapSortKey>[];
  onSort: (sort: readonly SortLevel<MapSortKey>[]) => void;
  shown: number;
  total: number;
  folders: readonly string[];
}>) {
  return (
    <div className="sc-sub">
      <span className="sc-sub-count" role="status">
        {shown === total ? `${total} ${total === 1 ? "map" : "maps"}` : `${shown} of ${total} maps`} · sorted by{" "}
        {sort.map((level) => MAP_SORT_LABEL[level.key]).join(", then ")}
      </span>
    </div>
  );
}
