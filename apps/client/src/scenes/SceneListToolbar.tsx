import { Button, Eyebrow, FilterChips, FilterFlyout, FiltersButton } from "@vtt/ui";
import type { MapAsset } from "../maps/map-catalog";
import { ModifiedDropdown, OneChoice, SortButton, TickDropdown } from "./listTools";
import { STATE_LABEL } from "./sceneFacts";
import {
  activeFilterCount,
  NO_SCENE_FILTERS,
  SCENE_SORT_KEYS,
  SCENE_SORT_LABEL,
  SCENE_STATES,
  type SceneFilters,
  type SceneSortKey,
  type SortLevel
} from "./scene-lists";

export const SCENE_FILTERS_ID = "sc-scene-filters";

/**
 * The Scenes table's toolbar: Filters, the State dropdown, the Modified range, how many rows show and Sort. The
 * dropdowns, the flyout and the Sort dialog come from `@vtt/ui`.
 */
export function SceneListToolbar({
  filters,
  onFilters,
  sort,
  onSort,
  shown,
  total,
  flyoutOpen,
  onFlyout
}: Readonly<{
  filters: SceneFilters;
  onFilters: (filters: SceneFilters) => void;
  sort: readonly SortLevel<SceneSortKey>[];
  onSort: (sort: readonly SortLevel<SceneSortKey>[]) => void;
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
        controls={SCENE_FILTERS_ID}
        count={activeFilterCount(filters)}
      />
      <TickDropdown
        name="State"
        options={SCENE_STATES.map((state) => ({ value: state, label: STATE_LABEL[state] }))}
        selected={filters.states}
        onChange={(states) => onFilters({ ...filters, states })}
      />
      <ModifiedDropdown
        from={filters.from}
        to={filters.to}
        onChange={(from, to) => onFilters({ ...filters, from, to })}
      />
      <span className="sc-grow" />
      <span className="sc-sub-count" role="status">
        {shown === total ? `${total} ${total === 1 ? "scene" : "scenes"}` : `${shown} of ${total} scenes`}
      </span>
      <SortButton sort={sort} keys={SCENE_SORT_KEYS} labels={SCENE_SORT_LABEL} onSort={onSort} />
    </div>
  );
}

/** The Scenes table's filters, in a flyout over the left of the table: map, Codex, tray, light and sound. */
export function SceneFiltersFlyout({
  open,
  onClose,
  filters,
  onFilters,
  maps,
  usedMapIds
}: Readonly<{
  open: boolean;
  onClose: () => void;
  filters: SceneFilters;
  onFilters: (filters: SceneFilters) => void;
  maps: readonly MapAsset[];
  /** The maps some scene is on. */
  usedMapIds: readonly string[];
}>) {
  const set = (patch: Partial<SceneFilters>) => onFilters({ ...filters, ...patch });
  const mapOptions = usedMapIds.map((id) => ({
    value: id,
    label: maps.find((map) => map.id === id)?.name ?? "Not in the library"
  }));
  return (
    <FilterFlyout id={SCENE_FILTERS_ID} open={open} title="Filter scenes" onClose={onClose}>
      {mapOptions.length > 1 && (
        <>
          <Eyebrow>Map</Eyebrow>
          <FilterChips
            label="Map"
            options={mapOptions}
            selected={filters.mapIds}
            onChange={(mapIds) => set({ mapIds })}
          />
        </>
      )}
      <OneChoice
        label="Codex"
        options={[
          { value: "linked", label: "Staged in the Codex" },
          { value: "unlinked", label: "Not in the Codex" }
        ]}
        value={filters.codex === "any" ? null : filters.codex}
        onChange={(codex) => set({ codex: codex ?? "any" })}
      />
      <OneChoice
        label="Tray"
        options={[{ value: "waiting", label: "Tokens still in the tray" }]}
        value={filters.waiting ? "waiting" : null}
        onChange={(waiting) => set({ waiting: waiting !== null })}
      />
      <OneChoice
        label="Dynamic vision"
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" }
        ]}
        value={filters.vision === "any" ? null : filters.vision}
        onChange={(vision) => set({ vision: vision ?? "any" })}
      />
      <OneChoice
        label="Fog of war"
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" }
        ]}
        value={filters.fog === "any" ? null : filters.fog}
        onChange={(fog) => set({ fog: fog ?? "any" })}
      />
      <OneChoice
        label="Sound"
        options={[
          { value: "set", label: "Sound saved" },
          { value: "none", label: "No sound" }
        ]}
        value={filters.sound === "any" ? null : filters.sound}
        onChange={(sound) => set({ sound: sound ?? "any" })}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={activeFilterCount(filters) === 0}
        onClick={() => onFilters({ ...NO_SCENE_FILTERS, states: filters.states, from: filters.from, to: filters.to })}
      >
        Clear the filters
      </Button>
    </FilterFlyout>
  );
}
