import { Button, Eyebrow } from "@vtt/ui";
import { FilterChips, FilterFlyout, FiltersButton } from "../codex/shared/FilterFlyout";
import { ModifiedDropdown, OneChoice, SortButton, TickDropdown } from "../scenes/listTools";
import type { SortLevel } from "../scenes/sceneList";
import {
  activeMapFilterCount,
  MAP_KIND_LABEL,
  MAP_KINDS,
  MAP_SORT_KEYS,
  MAP_SORT_LABEL,
  NO_MAP_FILTERS,
  type MapFilters,
  type MapSortKey
} from "./mapList";

export const MAP_FILTERS_ID = "sc-map-filters";

/**
 * The Maps table's toolbar: Filters, the Type dropdown, the Modified range, how many rows show and Sort. The
 * dropdowns, the flyout and the Sort dialog are the Codex's shared pieces.
 */
export function MapListToolbar({
  filters,
  onFilters,
  sort,
  onSort,
  shown,
  total,
  flyoutOpen,
  onFlyout
}: Readonly<{
  filters: MapFilters;
  onFilters: (filters: MapFilters) => void;
  sort: readonly SortLevel<MapSortKey>[];
  onSort: (sort: readonly SortLevel<MapSortKey>[]) => void;
  shown: number;
  total: number;
  flyoutOpen: boolean;
  onFlyout: (open: boolean) => void;
}>) {
  return (
    <div className="sc-sub">
      <FiltersButton
        open={flyoutOpen}
        onToggle={() => onFlyout(!flyoutOpen)}
        controls={MAP_FILTERS_ID}
        count={activeMapFilterCount(filters)}
      />
      <TickDropdown
        name="Type"
        options={MAP_KINDS.map((kind) => ({ value: kind, label: MAP_KIND_LABEL[kind] }))}
        selected={filters.kinds}
        onChange={(kinds) => onFilters({ ...filters, kinds })}
      />
      <ModifiedDropdown
        from={filters.from}
        to={filters.to}
        onChange={(from, to) => onFilters({ ...filters, from, to })}
      />
      <span className="sc-grow" />
      <span className="sc-sub-count" role="status">
        {shown === total ? `${total} ${total === 1 ? "map" : "maps"}` : `${shown} of ${total} maps`}
      </span>
      <SortButton sort={sort} keys={MAP_SORT_KEYS} labels={MAP_SORT_LABEL} onSort={onSort} />
    </div>
  );
}

/** The Maps table's filters, in a flyout over the left of the table: folder, grid and whether a scene uses it. */
export function MapFiltersFlyout({
  open,
  onClose,
  filters,
  onFilters,
  folders
}: Readonly<{
  open: boolean;
  onClose: () => void;
  filters: MapFilters;
  onFilters: (filters: MapFilters) => void;
  folders: readonly string[];
}>) {
  const set = (patch: Partial<MapFilters>) => onFilters({ ...filters, ...patch });
  return (
    <FilterFlyout id={MAP_FILTERS_ID} open={open} title="Filter maps" onClose={onClose}>
      {folders.length > 0 && (
        <>
          <Eyebrow>Folder</Eyebrow>
          <FilterChips
            label="Folder"
            options={[
              ...folders.map((folder) => ({ value: folder, label: folder })),
              { value: "", label: "No folder" }
            ]}
            selected={filters.folders}
            onChange={(next) => set({ folders: next })}
          />
        </>
      )}
      <OneChoice
        label="Grid"
        options={[
          { value: "grid", label: "Grid set" },
          { value: "scale", label: "Scale set" },
          { value: "none", label: "No grid yet" }
        ]}
        value={filters.grid === "any" || filters.grid === "unknown" ? null : filters.grid}
        onChange={(grid) => set({ grid: grid ?? "any" })}
      />
      <OneChoice
        label="Used in"
        options={[
          { value: "used", label: "In a scene" },
          { value: "unused", label: "In no scene" }
        ]}
        value={filters.used === "any" ? null : filters.used}
        onChange={(used) => set({ used: used ?? "any" })}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={activeMapFilterCount(filters) === 0}
        onClick={() => onFilters({ ...NO_MAP_FILTERS, kinds: filters.kinds, from: filters.from, to: filters.to })}
      >
        Clear the filters
      </Button>
    </FilterFlyout>
  );
}
