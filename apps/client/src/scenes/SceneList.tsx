import { useEffect, useRef, useState } from "react";
import {
  Button,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDrag,
  IconPencil,
  IconPlay,
  IconTrash,
  Menu,
  MenuItem,
  cx,
  useDragSurface
} from "@vtt/ui";
import { replaceQuery, useRoute } from "../router";
import { useSoundBoard } from "../sound/sound-data";
import { useScenes } from "./context";
import { pathForScene, SCENES_PATHS } from "./routes";
import { useSceneActions } from "./sceneActions";
import { tokensLine, factsOf, lightLine, modifiedAt, STATE_LABEL, whenLabel, type SceneFacts } from "./sceneFacts";
import {
  DEFAULT_SCENE_SORT,
  filterScenes,
  readSceneFilters,
  readSort,
  SCENE_SORT_KEYS,
  sortParam,
  sortScenes,
  writeSceneFilters,
  setOrDelete
} from "./scene-lists";
import { SceneFiltersFlyout, SceneListToolbar } from "./SceneListToolbar";
import { MapThumb, StateChip } from "./pieces";

/**
 * Every scene as a table: the State dropdown, Filters as a flyout, and Sort over several columns, with the GM's own
 * order as the default. A row opens its scene; its menu holds the rest. On a phone each row keeps the two facts that
 * matter most, its state and its map.
 */
export function SceneList() {
  const { state, maps, links, go, phone } = useScenes();
  const scenes = state.combat.scenes;
  const board = useSoundBoard();
  // The filters and the sort live in the address, so a filtered list is a link and survives a refresh.
  const { query } = useRoute();
  const filters = readSceneFilters(query);
  const sort = readSort(query, SCENE_SORT_KEYS, DEFAULT_SCENE_SORT);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const actions = useSceneActions(scenes, {
    combatActive: state.combat.active,
    onDuplicated: (sceneId) => go(pathForScene(sceneId))
  });
  const all = scenes.map((scene) => factsOf(state, scene, maps));
  const shown = sortScenes(
    filterScenes(all, filters, {
      linked: (sceneId) => {
        const link = links.get(sceneId);
        return link !== undefined && link.sessions.length + link.pins.length > 0;
      },
      hasSound: (sceneId) => Boolean(board?.board.presets.some((preset) => preset.sceneId === sceneId))
    }),
    sort,
    scenes.map((scene) => scene.id)
  );
  const inOrder = sort.length === 1 && sort[0]!.key === "order" && sort[0]!.direction === "asc";

  // Reorder by dragging a row's grip (pointer and touch); the menu's Move earlier and later are the keyboard's way.
  const listRef = useRef<HTMLElement | null>(null);
  const gripSurface = useDragSurface<HTMLButtonElement>();
  const drag = useRef<{ id: string; order: string[]; start: string } | null>(null);
  const [dragOrder, setDragOrder] = useState<readonly string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const { reorder } = actions;
  useEffect(() => {
    if (!dragId) return;
    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      const over = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-scene-id]") ?? [])].find((row) => {
        const rect = row.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      })?.dataset.sceneId;
      if (!state || !over || over === state.id) return;
      const next = state.order.filter((id) => id !== state.id);
      next.splice(next.indexOf(over), 0, state.id);
      state.order = next;
      setDragOrder(next);
    };
    const onUp = () => {
      const state = drag.current;
      if (state && state.order.join() !== state.start) reorder(state.order);
      drag.current = null;
      setDragId(null);
      setDragOrder(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragId, reorder]);
  const beginDrag = (sceneId: string, event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const order = scenes.map((scene) => scene.id);
    drag.current = { id: sceneId, order, start: order.join() };
    setDragId(sceneId);
    setDragOrder(order);
  };
  const rows = dragOrder ? dragOrder.flatMap((id) => shown.filter((row) => row.scene.id === id)) : shown;

  const rowMenu = (row: SceneFacts) => {
    const index = scenes.findIndex((scene) => scene.id === row.scene.id);
    return (
      <Menu trigger="⋯" label={`${row.scene.name} actions`} align="end" hideCaret>
        {!row.live && (
          <MenuItem icon={<IconPlay />} onClick={() => void actions.makeLive(row.scene)}>
            Make live
          </MenuItem>
        )}
        <MenuItem icon={<IconPencil />} onClick={() => go(pathForScene(row.scene.id, "map"))}>
          Edit its steps
        </MenuItem>
        <MenuItem icon={<IconPencil />} onClick={() => void actions.rename(row.scene)}>
          Rename
        </MenuItem>
        <MenuItem icon={<IconCopy />} onClick={() => actions.duplicate(row.scene)}>
          Duplicate
        </MenuItem>
        {inOrder && (
          <>
            <MenuItem icon={<IconChevronLeft />} disabled={index <= 0} onClick={() => actions.move(row.scene.id, -1)}>
              Move earlier
            </MenuItem>
            <MenuItem
              icon={<IconChevronRight />}
              disabled={index >= scenes.length - 1}
              onClick={() => actions.move(row.scene.id, 1)}
            >
              Move later
            </MenuItem>
          </>
        )}
        {!row.live && (
          <MenuItem icon={<IconTrash />} tone="danger" onClick={() => void actions.remove(row.scene)}>
            Delete scene
          </MenuItem>
        )}
      </Menu>
    );
  };
  const grip = (row: SceneFacts) =>
    inOrder && scenes.length > 1 ? (
      <button
        ref={gripSurface}
        type="button"
        className="sc-grip"
        aria-label={`Drag to reorder ${row.scene.name}`}
        onPointerDown={(event) => beginDrag(row.scene.id, event)}
      >
        <IconDrag />
      </button>
    ) : null;
  const sessionLine = (sceneId: string) => {
    const link = links.get(sceneId);
    if (!link || link.sessions.length + link.pins.length === 0) return "None";
    const sessions = link.sessions.map((session) =>
      session.sessionNumber === null ? "A session" : `Session ${session.sessionNumber}`
    );
    return [
      ...sessions,
      ...(link.pins.length > 0 ? [`${link.pins.length} pin${link.pins.length === 1 ? "" : "s"}`] : [])
    ].join(" · ");
  };

  return (
    <div className="sc-list frame-col">
      {phone && <h2 className="sc-phone-title">Scenes</h2>}
      <SceneListToolbar
        filters={filters}
        onFilters={(next) => replaceQuery((params) => writeSceneFilters(params, next))}
        sort={sort}
        onSort={(next) => replaceQuery((params) => setOrDelete(params, "sort", sortParam(next, DEFAULT_SCENE_SORT)))}
        shown={shown.length}
        total={scenes.length}
        flyoutOpen={flyoutOpen}
        onFlyout={setFlyoutOpen}
      />
      <div className="sc-list-main">
        <SceneFiltersFlyout
          open={flyoutOpen}
          onClose={() => setFlyoutOpen(false)}
          filters={filters}
          onFilters={(next) => replaceQuery((params) => writeSceneFilters(params, next))}
          maps={maps ?? []}
          usedMapIds={[...new Set(scenes.map((scene) => scene.mapAssetId))]}
        />
        <div className="sc-list-body scroll-y frame-fill">
          {scenes.length === 0 ? (
            <div className="sc-empty">
              <p>No scenes yet. A scene is a map and who is on it, made live when the table is ready.</p>
              <Button variant="primary" onClick={() => go(SCENES_PATHS.newScene)}>
                New scene
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <p className="sc-hint sc-list-none">No scene matches. Change the filters to see more.</p>
          ) : phone ? (
            <ul className="sc-rows" ref={(element) => void (listRef.current = element)}>
              {rows.map((row) => (
                <li
                  key={row.scene.id}
                  data-scene-id={row.scene.id}
                  className={cx(dragId === row.scene.id && "is-dragging")}
                >
                  <button type="button" className="sc-row" onClick={() => go(pathForScene(row.scene.id))}>
                    <MapThumb mapAssetId={row.scene.mapAssetId} />
                    <span className="sc-row-main">
                      <strong>{row.scene.name}</strong>
                      <small>
                        {STATE_LABEL[row.state]} · {row.map?.name ?? "Map not in the library"}
                      </small>
                    </span>
                  </button>
                  {grip(row)}
                  {rowMenu(row)}
                </li>
              ))}
            </ul>
          ) : (
            <table className="sc-table sc-scenes-table" ref={(element) => void (listRef.current = element)}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">State</th>
                  <th scope="col">Map</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Light</th>
                  <th scope="col">Codex</th>
                  <th scope="col">Modified</th>
                  <th scope="col">
                    <span className="nh-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.scene.id}
                    data-scene-id={row.scene.id}
                    className={cx("sc-tr", row.live && "is-live", dragId === row.scene.id && "is-dragging")}
                  >
                    <td>
                      <span className="sc-name-cell">
                        {grip(row)}
                        <button type="button" className="sc-rowlink" onClick={() => go(pathForScene(row.scene.id))}>
                          <MapThumb mapAssetId={row.scene.mapAssetId} />
                          <b>{row.scene.name}</b>
                        </button>
                      </span>
                    </td>
                    <td>
                      <StateChip facts={row} />
                    </td>
                    <td>{row.map?.name ?? "Not in the library"}</td>
                    <td>{tokensLine(row)}</td>
                    <td>{lightLine(row)}</td>
                    <td>{sessionLine(row.scene.id)}</td>
                    <td className="sc-col-date">{whenLabel(modifiedAt(row.scene))}</td>
                    <td className="sc-col-menu">{rowMenu(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {actions.dialogs}
    </div>
  );
}
