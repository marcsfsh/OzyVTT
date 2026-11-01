import { useEffect, useState } from "react";
import {
  Button,
  IconMap,
  IconMore,
  IconPencil,
  IconPlus,
  IconScene,
  Menu,
  MenuItem,
  Tag,
  cx,
  EmptyState
} from "@vtt/ui";
import "./map-list.css";
import { useScenes } from "../scenes/context";
import { MapThumb } from "../scenes/pieces";
import { pathForMap, SCENES_PATHS } from "../scenes/routes";
import { gridLine, gridStateOf, whenLabel } from "../scenes/sceneFacts";
import { folderNamesOf, useMapActions } from "./mapActions";
import { replaceQuery, useRoute } from "../router";
import { readSort, setOrDelete, sortParam } from "../scenes/scene-lists";
import {
  DEFAULT_MAP_SORT,
  filterMaps,
  MAP_KIND_LABEL,
  MAP_SORT_KEYS,
  readMapFilters,
  sortMaps,
  writeMapFilters
} from "./map-lists";
import { MapFiltersFlyout, MapListToolbar } from "./MapListToolbar";
import type { MapAsset } from "./map-catalog";

/**
 * Every map in the library as a shelf of cards beside its folders (E2 spec 2.1): the Type dropdown, Filters as a flyout
 * and Sort, newest first. A card opens its map and carries its grid, its use and its folder; its menu files it. On a
 * phone the folders are chips and the cards two to a row.
 */
export function MapList() {
  const { state, token, maps, reloadMaps, go, phone } = useScenes();
  // The filters and the sort live in the address, so a filtered list is a link and survives a refresh.
  const { query } = useRoute();
  const filters = readMapFilters(query);
  const sort = readSort(query, MAP_SORT_KEYS, DEFAULT_MAP_SORT);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const actions = useMapActions(token, reloadMaps);
  // Choose (E2 spec 2.3): a box on each card, a bar with Move to, and Escape to leave it.
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const stopChoosing = () => {
    setChoosing(false);
    setChosen(new Set());
  };
  useEffect(() => {
    if (!choosing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopChoosing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choosing]);
  const toggleChosen = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const moveChosen = async (folder: string | null) => {
    const maps = library.filter((map) => chosen.has(map.id));
    if (maps.length === 0) return;
    await actions.moveMany(maps, folder);
    stopChoosing();
  };
  const library = maps ?? [];
  const usedIn = (mapId: string) => state.combat.encounters.filter((scene) => scene.mapAssetId === mapId).length;
  const shown = sortMaps(filterMaps(library, filters, usedIn), sort, usedIn);
  const folders = folderNamesOf(library);
  const chosenFolder = filters.folders.length === 1 ? filters.folders[0] : null;
  const folderEntries: ReadonlyArray<Readonly<{ id: string; label: string; value: string | null; count: number }>> = [
    { id: "all", label: "All maps", value: null, count: library.length },
    ...folders.map((folder) => ({
      id: `f-${folder}`,
      label: folder,
      value: folder,
      count: library.filter((map) => map.folder === folder).length
    })),
    ...(library.some((map) => map.folder === null)
      ? [{ id: "none", label: "No folder", value: "", count: library.filter((map) => map.folder === null).length }]
      : [])
  ];

  const rowMenu = (map: MapAsset) => (
    <Menu trigger={<IconMore />} icon label={`${map.name} actions`} align="end">
      <MenuItem icon={<IconMap />} onClick={() => go(pathForMap(map.id, "grid"))}>
        {map.calibration || map.scale ? "Set the grid again" : "Set the grid"}
      </MenuItem>
      {map.kind === "battlemap" && (
        <MenuItem icon={<IconScene />} onClick={() => go(`${SCENES_PATHS.newScene}?map=${map.id}`)}>
          New encounter on this map
        </MenuItem>
      )}
      <MenuItem icon={<IconPencil />} onClick={() => void actions.rename(map)}>
        Rename
      </MenuItem>
      <MenuItem icon={<IconPlus />} onClick={() => void actions.newFolder(map)}>
        Move to a new folder
      </MenuItem>
      {folders
        .filter((folder) => folder !== map.folder)
        .map((folder) => (
          <MenuItem key={folder} onClick={() => void actions.setFolder(map, folder)}>
            Move to {folder}
          </MenuItem>
        ))}
      {map.folder !== null && (
        <MenuItem onClick={() => void actions.setFolder(map, null)}>Take out of its folder</MenuItem>
      )}
    </Menu>
  );

  return (
    <div className="sc-list frame-col">
      {phone && (
        <div className="sc-phone-head">
          <h2 className="sc-phone-title">Maps</h2>
          <Button size="sm" onClick={() => go(SCENES_PATHS.newMap)}>
            <IconPlus /> Add a map
          </Button>
        </div>
      )}
      <MapListToolbar
        filters={filters}
        onFilters={(next) => replaceQuery((params) => writeMapFilters(params, next))}
        sort={sort}
        onSort={(next) => replaceQuery((params) => setOrDelete(params, "sort", sortParam(next, DEFAULT_MAP_SORT)))}
        shown={shown.length}
        total={library.length}
        flyoutOpen={flyoutOpen}
        onFlyout={setFlyoutOpen}
      />
      <div className="sc-list-main mp-main">
        {/* The folders at the side (E2 spec 2.1): every map, each folder with its count, and the maps in none. The
            chosen folder is the address's folder filter, so a map's page and Back keep it. */}
        <nav className={cx("mp-folders", phone && "is-chips")} aria-label="Folders">
          {folderEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cx("mp-folder interactive", chosenFolder === entry.value && "is-on")}
              aria-pressed={chosenFolder === entry.value}
              onClick={() =>
                replaceQuery((params) =>
                  writeMapFilters(params, { ...filters, folders: entry.value === null ? [] : [entry.value] })
                )
              }
            >
              <span>{entry.label}</span>
              <span className="mp-folder-count">{entry.count}</span>
            </button>
          ))}
          <Button
            size="sm"
            className="mp-choose"
            aria-pressed={choosing}
            onClick={() => (choosing ? stopChoosing() : setChoosing(true))}
          >
            {choosing ? "Done choosing" : "Choose"}
          </Button>
        </nav>
        <MapFiltersFlyout
          open={flyoutOpen}
          onClose={() => setFlyoutOpen(false)}
          filters={filters}
          onFilters={(next) => replaceQuery((params) => writeMapFilters(params, next))}
          folders={folders}
        />
        <div className="sc-list-body scroll-y frame-fill">
          {maps === null ? (
            <p className="sc-hint sc-list-none">Reading the map library…</p>
          ) : library.length === 0 ? (
            <EmptyState action={<Button onClick={() => go(SCENES_PATHS.newMap)}>Add a map</Button>}>
              No maps yet. Upload an image, then set its grid so tokens snap to it.
            </EmptyState>
          ) : shown.length === 0 ? (
            <p className="sc-hint sc-list-none">No map matches. Change the filters to see more.</p>
          ) : (
            <ul className="mp-cards">
              {shown.map((map) => {
                const uses = usedIn(map.id);
                return (
                  <li key={map.id} className="mp-card">
                    <button
                      type="button"
                      className="mp-card-open interactive"
                      aria-label={map.name}
                      onClick={() => go(pathForMap(map.id))}
                    >
                      <MapThumb mapAssetId={map.id} className="mp-card-pic" />
                      <span className="mp-card-text">
                        <strong>{map.name}</strong>
                        <small className={cx(gridStateOf(map) === "none" && "sc-caution")}>
                          {gridLine(gridStateOf(map), map)} · {MAP_KIND_LABEL[map.kind]}
                        </small>
                        <small>
                          {uses === 0 ? "No encounter" : `${uses} ${uses === 1 ? "encounter" : "encounters"}`} ·{" "}
                          {whenLabel(map.updatedAt)}
                        </small>
                      </span>
                    </button>
                    {map.folder && <Tag className="mp-card-folder">{map.folder}</Tag>}
                    {choosing && (
                      <label className="mp-card-choose">
                        <input
                          type="checkbox"
                          checked={chosen.has(map.id)}
                          aria-label={`Choose ${map.name}`}
                          onChange={() => toggleChosen(map.id)}
                        />
                      </label>
                    )}
                    <span className="mp-card-menu">{rowMenu(map)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {choosing && (
        <div className="mp-choose-bar" role="group" aria-label="Chosen maps">
          <span>
            {chosen.size} {chosen.size === 1 ? "map" : "maps"} chosen
          </span>
          <Menu trigger="Move to" label="Move the chosen maps to" align="end" triggerButton="secondary">
            {folders.map((folder) => (
              <MenuItem key={folder} disabled={chosen.size === 0} onClick={() => void moveChosen(folder)}>
                {folder}
              </MenuItem>
            ))}
            <MenuItem disabled={chosen.size === 0} onClick={() => void moveChosen(null)}>
              No folder
            </MenuItem>
            <MenuItem
              icon={<IconPlus />}
              disabled={chosen.size === 0}
              onClick={() =>
                void actions.askFolder().then((name) => {
                  if (name?.trim()) void moveChosen(name.trim());
                })
              }
            >
              New folder…
            </MenuItem>
          </Menu>
          <Button variant="ghost" size="sm" onClick={stopChoosing}>
            Cancel
          </Button>
        </div>
      )}
      {actions.dialog}
    </div>
  );
}
