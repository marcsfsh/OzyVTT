import type { MapAsset } from "../maps/map-catalog";
import { SCENE_SORT_LABEL, type SceneFilters, type SceneSortKey, type SortLevel } from "./sceneList";

/**
 * The Scenes table's toolbar: the State dropdown, Filters and Sort, and how many rows show. The dropdown, the flyout
 * and the sort dialog are the Codex's shared pieces.
 */
export function SceneListToolbar({
  sort,
  shown,
  total
}: Readonly<{
  filters: SceneFilters;
  onFilters: (filters: SceneFilters) => void;
  sort: readonly SortLevel<SceneSortKey>[];
  onSort: (sort: readonly SortLevel<SceneSortKey>[]) => void;
  shown: number;
  total: number;
  maps: readonly MapAsset[];
}>) {
  return (
    <div className="sc-sub">
      <span className="sc-sub-count" role="status">
        {shown === total ? `${total} ${total === 1 ? "scene" : "scenes"}` : `${shown} of ${total} scenes`} · sorted by{" "}
        {sort.map((level) => SCENE_SORT_LABEL[level.key]).join(", then ")}
      </span>
    </div>
  );
}
