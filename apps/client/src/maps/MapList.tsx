import { useState } from "react";
import { Button, IconMap, IconPencil, IconPlus, IconScene, Menu, MenuItem, cx } from "@vtt/ui";
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
 * Every map in the library as a table: the Type dropdown, Filters as a flyout and Sort over several columns, newest
 * first. A row opens its map; a map with no grid offers to set it. On a phone each row keeps its grid and its type.
 */
export function MapList() {
  const { state, token, maps, reloadMaps, go, phone } = useScenes();
  // The filters and the sort live in the address, so a filtered list is a link and survives a refresh.
  const { query } = useRoute();
  const filters = readMapFilters(query);
  const sort = readSort(query, MAP_SORT_KEYS, DEFAULT_MAP_SORT);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const actions = useMapActions(token, reloadMaps);
  const library = maps ?? [];
  const usedIn = (mapId: string) => state.combat.encounters.filter((scene) => scene.mapAssetId === mapId).length;
  const shown = sortMaps(filterMaps(library, filters, usedIn), sort, usedIn);
  const folders = folderNamesOf(library);

  const rowMenu = (map: MapAsset) => (
    <Menu trigger="⋯" label={`${map.name} actions`} align="end" hideCaret>
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
      <div className="sc-list-main">
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
            <div className="sc-empty">
              <p>No maps yet. Upload an image, then set its grid so tokens snap to it.</p>
              <Button variant="primary" onClick={() => go(SCENES_PATHS.newMap)}>
                Add a map
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <p className="sc-hint sc-list-none">No map matches. Change the filters to see more.</p>
          ) : phone ? (
            <ul className="sc-rows">
              {shown.map((map) => (
                <li key={map.id}>
                  <button type="button" className="sc-row" onClick={() => go(pathForMap(map.id))}>
                    <MapThumb mapAssetId={map.id} />
                    <span className="sc-row-main">
                      <strong>{map.name}</strong>
                      <small className={cx(gridStateOf(map) === "none" && "sc-caution")}>
                        {gridLine(gridStateOf(map), map)} · {MAP_KIND_LABEL[map.kind]}
                      </small>
                    </span>
                  </button>
                  {rowMenu(map)}
                </li>
              ))}
            </ul>
          ) : (
            <table className="sc-table sc-maps-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Grid</th>
                  <th scope="col">Size</th>
                  <th scope="col">Folder</th>
                  <th scope="col">Used in</th>
                  <th scope="col">Modified</th>
                  <th scope="col">
                    <span className="nh-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((map) => {
                  const uses = usedIn(map.id);
                  return (
                    <tr key={map.id} className="sc-tr">
                      <td>
                        <button type="button" className="sc-rowlink" onClick={() => go(pathForMap(map.id))}>
                          <MapThumb mapAssetId={map.id} />
                          <b>{map.name}</b>
                        </button>
                      </td>
                      <td>{MAP_KIND_LABEL[map.kind]}</td>
                      <td className={cx(gridStateOf(map) === "none" && "sc-caution")}>
                        {gridLine(gridStateOf(map), map)}
                      </td>
                      <td className="tabular">
                        {map.width} × {map.height}
                      </td>
                      <td>{map.folder ?? "None"}</td>
                      <td>{uses === 0 ? "No encounter" : `${uses} ${uses === 1 ? "encounter" : "encounters"}`}</td>
                      <td className="sc-col-date">{whenLabel(map.updatedAt)}</td>
                      <td className="sc-col-menu">{rowMenu(map)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {actions.dialog}
    </div>
  );
}
