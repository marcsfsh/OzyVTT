import { useEffect, useId, useRef, useState } from "react";
import { CODEX_PATHS } from "@vtt/api-contract";
import {
  Button,
  Drawer,
  IconChevronLeft,
  IconList,
  IconMap,
  IconPencil,
  IconScene,
  Menu,
  MenuItem,
  Select,
  Switch,
  cx
} from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { EncounterMap } from "../scene/EncounterMap";
import { useScenes } from "../scenes/context";
import { MapThumb } from "../scenes/pieces";
import { pathForMap, pathForScene, SCENES_PATHS } from "../scenes/routes";
import { gridLine, gridStateOf, whenLabel } from "../scenes/sceneFacts";
import { PaneDivider, useMomentShare } from "../table/PaneDivider";
import { folderNamesOf, useMapActions } from "./mapActions";
import { MAP_KIND_LABEL, MAP_KINDS } from "./mapList";
import type { MapKind } from "./map-catalog";
import "../scenes/scene-page.css";

/** The library the map came from, folded into a flyout; a row opens that map. */
function MapListFlyout({
  open,
  onClose,
  currentId
}: Readonly<{ open: boolean; onClose: () => void; currentId: string }>) {
  const { maps, go } = useScenes();
  return (
    <Drawer open={open} onClose={onClose} side="left" title="Maps" className="sc-flyout">
      <ul className="sc-rows">
        {(maps ?? []).map((map) => (
          <li key={map.id}>
            <button
              type="button"
              className={cx("sc-row", map.id === currentId && "is-current")}
              aria-current={map.id === currentId ? "page" : undefined}
              onClick={() => {
                onClose();
                go(pathForMap(map.id));
              }}
            >
              <MapThumb mapAssetId={map.id} />
              <span className="sc-row-main">
                <strong>{map.name}</strong>
                <small>
                  {MAP_KIND_LABEL[map.kind]} · {gridLine(gridStateOf(map), map)}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button onClick={() => go(SCENES_PATHS.maps)}>All maps</Button>
    </Drawer>
  );
}

/** A byte count for people: 820 KB, 3.4 MB. */
function sizeOf(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The atlas maps drawn from this image, for "where it is used". A failed read lists none. */
function useAtlasUses(token: string, mapId: string) {
  const [names, setNames] = useState<readonly string[]>([]);
  useEffect(() => {
    let active = true;
    apiRequest<{ maps: ReadonlyArray<{ name: string; assetId: string }> }>(CODEX_PATHS.maps, { token })
      .then((data) => {
        if (active) setNames(data.maps.filter((map) => map.assetId === mapId).map((map) => map.name));
      })
      .catch(() => {
        if (active) setNames([]);
      });
    return () => {
      active = false;
    };
  }, [token, mapId]);
  return names;
}

/**
 * A map as one document: the art as the table draws it, with its grid over it to check the alignment, and a panel of
 * what the GM asks about it (type, grid, size and file, folder, where it is used, history), with the map's next step as
 * its one primary.
 */
export function MapDocument({ mapId }: Readonly<{ mapId: string }>) {
  const { state, token, maps, reloadMaps, go, narrow, phone, onOpenMap } = useScenes();
  const map = maps?.find((candidate) => candidate.id === mapId) ?? null;
  const [showGrid, setShowGrid] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [mapShare, moveSplit] = useMomentShare(null);
  const actions = useMapActions(token, reloadMaps);
  const atlas = useAtlasUses(token, mapId);
  const kindId = useId();
  const folderId = useId();
  useEffect(() => {
    if (map) onOpenMap(map);
  }, [map, onOpenMap]);
  if (maps === null) return <p className="sc-missing">Reading the map library…</p>;
  if (!map)
    return (
      <div className="sc-missing">
        <p role="status">That map is not in the library.</p>
        <Button onClick={() => go(SCENES_PATHS.maps)}>All maps</Button>
      </div>
    );
  const grid = gridStateOf(map);
  const scenes = state.combat.scenes.filter((scene) => scene.mapAssetId === map.id);
  const folders = folderNamesOf(maps);

  const footer =
    grid === "none" ? (
      <Button variant="primary" onClick={() => go(pathForMap(map.id, "grid"))}>
        Set the grid
      </Button>
    ) : map.kind === "battlemap" ? (
      <Button variant="primary" onClick={() => go(`${SCENES_PATHS.newScene}?map=${map.id}`)}>
        <IconScene /> New scene on this map
      </Button>
    ) : (
      <Button variant="primary" onClick={() => go(pathForMap(map.id, "grid"))}>
        Set the scale again
      </Button>
    );

  return (
    <div className="table-bench gm sc-scene-bench sc-map-bench">
      <header className="table-header sc-scene-head" aria-label="The map">
        {narrow ? (
          <Button variant="ghost" size="sm" onClick={() => go(SCENES_PATHS.maps)} aria-label="Back to the maps">
            <IconChevronLeft />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setListOpen(true)} aria-expanded={listOpen}>
            <IconList /> Maps
          </Button>
        )}
        <h2 className="sc-scene-title">{map.name}</h2>
        {!phone && <span className="sc-kind">{MAP_KIND_LABEL[map.kind]}</span>}
        <span className="sc-grow" />
        {map.calibration && (
          <Switch checked={showGrid} label={phone ? "Grid" : "Show the grid"} onChange={setShowGrid} />
        )}
        <Menu trigger="⋯" label={`${map.name} actions`} align="end" hideCaret>
          <MenuItem icon={<IconMap />} onClick={() => go(pathForMap(map.id, "grid"))}>
            {grid === "none" ? "Set the grid" : "Set the grid again"}
          </MenuItem>
          <MenuItem icon={<IconPencil />} onClick={() => void actions.rename(map)}>
            Rename
          </MenuItem>
        </Menu>
      </header>
      <div
        className="table-bench-split"
        ref={splitRef}
        style={narrow ? ({ "--map-share": `${mapShare}%` } as React.CSSProperties) : undefined}
      >
        <div className="table-bench-map">
          <EncounterMap
            assetId={map.id}
            token={token}
            altText={map.name}
            role="gm"
            actors={[]}
            tokens={[]}
            annotations={[]}
            revision={state.revision}
            activeActorId={null}
            readOnly
            showGrid={showGrid}
          />
        </div>
        {narrow && <PaneDivider value={mapShare} onChange={moveSplit} container={() => splitRef.current} />}
        <div className="table-bench-panel">
          <section className="table-panel" aria-label={`About ${map.name}`}>
            <div className="table-panel-body scroll-y sc-meta">
              <section className="sc-meta-section" aria-label="Grid">
                <header className="sc-meta-head">
                  <h3>Grid</h3>
                  <Button size="sm" variant="ghost" onClick={() => go(pathForMap(map.id, "grid"))}>
                    <IconPencil /> Edit
                  </Button>
                </header>
                <p className={cx("sc-facts-line", grid === "none" && "sc-caution")}>{gridLine(grid, map)}</p>
                {map.calibration && map.calibration.verificationErrorPx !== null && (
                  <p className="sc-hint">
                    Checked at a far intersection: {map.calibration.verificationErrorPx.toFixed(1)} px off the grid.
                  </p>
                )}
                {grid === "none" && (
                  <p className="sc-hint">Tokens on this map won't snap to squares until its grid is set.</p>
                )}
              </section>
              <section className="sc-meta-section" aria-label="Type and folder">
                <header className="sc-meta-head">
                  <h3>Type and folder</h3>
                </header>
                <label className="sc-field" htmlFor={kindId}>
                  <span className="sc-label">Type</span>
                  <Select
                    id={kindId}
                    value={map.kind}
                    onChange={(event) => void actions.setKind(map, event.target.value as MapKind)}
                  >
                    {MAP_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {MAP_KIND_LABEL[kind]}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="sc-field-row">
                  <label className="sc-field" htmlFor={folderId}>
                    <span className="sc-label">Folder</span>
                    <Select
                      id={folderId}
                      value={map.folder ?? ""}
                      onChange={(event) => void actions.setFolder(map, event.target.value || null)}
                    >
                      <option value="">None</option>
                      {folders.map((folder) => (
                        <option key={folder} value={folder}>
                          {folder}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Button onClick={() => void actions.newFolder(map)}>New folder…</Button>
                </div>
              </section>
              <section className="sc-meta-section" aria-label="Where it is used">
                <header className="sc-meta-head">
                  <h3>Where it is used</h3>
                </header>
                {scenes.length === 0 && atlas.length === 0 ? (
                  <p className="sc-hint">No scene and no atlas map uses it yet.</p>
                ) : (
                  <ul className="sc-links">
                    {scenes.map((scene) => (
                      <li key={scene.id}>
                        <button type="button" className="sc-rowlink" onClick={() => go(pathForScene(scene.id))}>
                          <IconScene />
                          <b>{scene.name}</b>
                        </button>
                        {scene.id === state.combat.activeSceneId && <span className="sc-state is-live">Live</span>}
                      </li>
                    ))}
                    {atlas.map((name) => (
                      <li key={`atlas:${name}`}>
                        <span>
                          <IconMap /> {name} · on the Codex atlas
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="sc-meta-section" aria-label="File and history">
                <header className="sc-meta-head">
                  <h3>File and history</h3>
                </header>
                <dl className="sc-dl">
                  <div>
                    <dt>Size</dt>
                    <dd className="tabular">
                      {map.width} × {map.height} px · {sizeOf(map.byteLength)} · {map.format.toUpperCase()}
                    </dd>
                  </div>
                  <div>
                    <dt>File</dt>
                    <dd>{map.originalName}</dd>
                  </div>
                  <div>
                    <dt>Uploaded</dt>
                    <dd>{whenLabel(map.importedAt)}</dd>
                  </div>
                  <div>
                    <dt>Last changed</dt>
                    <dd>{whenLabel(map.updatedAt)}</dd>
                  </div>
                </dl>
              </section>
            </div>
            <div className="table-panel-foot">
              <div className="table-panel-foot-main">{footer}</div>
            </div>
          </section>
        </div>
      </div>
      {!narrow && <MapListFlyout open={listOpen} onClose={() => setListOpen(false)} currentId={map.id} />}
      {actions.dialog}
    </div>
  );
}
