import { useState } from "react";
import { Chip, Input, SegmentedControl } from "@vtt/ui";
import { MapTile } from "./MapPicker";
import type { MapAsset, MapKind } from "./map-catalog";

/** The library's rail: search, a type filter, folder chips, and the maps as tiles. */
export function MapRail({
  maps,
  folderNames,
  selectedId,
  gmToken,
  onSelect
}: Readonly<{
  maps: readonly MapAsset[];
  folderNames: readonly string[];
  selectedId: string | null;
  gmToken: string;
  onSelect: (mapId: string) => void;
}>) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | MapKind>("all");
  const [folderChip, setFolderChip] = useState<"all" | string | null>("all");
  const needle = search.trim().toLowerCase();
  // Folders are a chip row up front. `undefined` = All; `null` = Unfiled.
  const folderFilter = folderChip === "all" ? undefined : folderChip;
  const filteredMaps = maps.filter(
    (map) =>
      (kindFilter === "all" || map.kind === kindFilter) &&
      (needle === "" || map.name.toLowerCase().includes(needle)) &&
      (folderFilter === undefined || map.folder === folderFilter)
  );

  return (
    <div className="map-rail">
      <div className="map-rail-filters" role="group" aria-label="Filter maps">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search maps"
          aria-label="Search maps"
        />
        <SegmentedControl
          ariaLabel="Filter maps by type"
          size="sm"
          value={kindFilter}
          onChange={(value) => setKindFilter(value as typeof kindFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "battlemap", label: "Battle maps" },
            { value: "regional", label: "Regional" },
            { value: "world", label: "World" }
          ]}
        />
      </div>
      {/* Folders up front, one scrolling chip row, as in the embedded picker. */}
      <div className="map-folder-chips" role="group" aria-label="Folders">
        <Chip pressed={folderChip === "all"} onClick={() => setFolderChip("all")}>
          All
        </Chip>
        {folderNames.map((folder) => (
          <Chip key={folder} pressed={folderChip === folder} onClick={() => setFolderChip(folder)}>
            {folder}
          </Chip>
        ))}
        {maps.some((map) => map.folder === null) && (
          <Chip pressed={folderChip === null} onClick={() => setFolderChip(null)}>
            Unfiled
          </Chip>
        )}
      </div>
      {/* The scroll region is the wrapper, never the `<ul>`: a grid with a definite block size stops
              sizing its auto rows from its cards. The picker's own 21rem cap is lifted here so there is
              one scroller. */}
      <div className="map-rail-list scroll-y">
        {/* The same tile as the embedded picker. */}
        <ul className="map-picker-grid" aria-label="Uploaded maps">
          {filteredMaps.map((map) => (
            <MapTile
              key={map.id}
              map={{
                id: map.id,
                name: map.name,
                kind: map.kind,
                folder: map.folder,
                width: map.width,
                height: map.height,
                calibration: map.calibration,
                scale: map.scale
              }}
              token={gmToken}
              selected={map.id === selectedId}
              onSelect={() => onSelect(map.id)}
              meta={`${map.calibration ? "Grid set" : map.scale ? "Gridless" : "No grid yet"} · ${map.width}×${map.height}`}
            />
          ))}
        </ul>
        {filteredMaps.length === 0 && (
          <p className="map-list-empty">
            {maps.length === 0 ? "No maps yet. Add one above." : "No maps match this filter."}
          </p>
        )}
      </div>
    </div>
  );
}
