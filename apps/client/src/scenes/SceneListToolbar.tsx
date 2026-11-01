import { Button, Eyebrow, FilterChips, FilterFlyout, FiltersButton, IconMap, ListToolbar, cx } from "@vtt/ui";
import { STATE_TAG_LABEL, type StateTag } from "./stateTag";
import type { MapAsset } from "../maps/map-catalog";
import { ModifiedDropdown, OneChoice, SortButton } from "./listTools";
import {
  activeFilterCount,
  NO_SCENE_FILTERS,
  SCENE_SORT_KEYS,
  SCENE_SORT_LABEL,
  type SceneFilters,
  type SceneSortKey,
  type SortLevel
} from "./scene-lists";

export const SCENE_FILTERS_ID = "sc-scene-filters";

/**
 * The shelf's toolbar (Prep frame 2.1, theme rule 17): Filters and the state chips, then how many show, the sort and
 * New map on a Base line. The flyout and the Sort dialog come from `@vtt/ui`.
 */
export function SceneListToolbar({
  filters,
  sort,
  onSort,
  shown,
  total,
  flyoutOpen,
  onFlyout,
  chips,
  chip,
  onChip,
  onNewMap,
  phone
}: Readonly<{
  filters: SceneFilters;
  sort: readonly SortLevel<SceneSortKey>[];
  onSort: (sort: readonly SortLevel<SceneSortKey>[]) => void;
  shown: number;
  total: number;
  flyoutOpen: boolean;
  onFlyout: (open: boolean) => void;
  /** The state chips after All (Prep rule 3.3), and the one chosen; null is All. */
  chips: readonly StateTag[];
  chip: StateTag | null;
  onChip: (chip: StateTag | null) => void;
  onNewMap: () => void;
  phone: boolean;
}>) {
  const chipButton = (value: StateTag | null, label: string) => (
    <button
      key={value ?? "all"}
      type="button"
      className={cx("sc-statechip", chip === value && "is-on")}
      aria-pressed={chip === value}
      onClick={() => onChip(value)}
    >
      {label}
    </button>
  );
  return (
    <ListToolbar
      className="sc-sub"
      filters={
        <>
          <FiltersButton
            open={flyoutOpen}
            onToggle={() => onFlyout(!flyoutOpen)}
            controls={SCENE_FILTERS_ID}
            count={activeFilterCount(filters)}
          />
          {!phone && (
            <span className="sc-statechips" role="group" aria-label="State">
              {chipButton(null, "All")}
              {chips.map((value) => chipButton(value, value === "parked" ? "Parked" : STATE_TAG_LABEL[value]))}
            </span>
          )}
        </>
      }
      count={
        shown === total ? `${total} ${total === 1 ? "encounter" : "encounters"}` : `${shown} of ${total} encounters`
      }
      sort={<SortButton sort={sort} keys={SCENE_SORT_KEYS} labels={SCENE_SORT_LABEL} onSort={onSort} />}
      action={
        !phone && (
          <Button size="sm" onClick={onNewMap}>
            <IconMap /> New map
          </Button>
        )
      }
    />
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
    <FilterFlyout id={SCENE_FILTERS_ID} open={open} title="Filter encounters" onClose={onClose}>
      {/* The shelf's state chips took the State dropdown's place; the Modified range moved in here. */}
      <Eyebrow>Modified</Eyebrow>
      <ModifiedDropdown from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
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

        disabled={activeFilterCount(filters) === 0}
        onClick={() => onFilters({ ...NO_SCENE_FILTERS, states: filters.states })}
      >
        Clear the filters
      </Button>
    </FilterFlyout>
  );
}
