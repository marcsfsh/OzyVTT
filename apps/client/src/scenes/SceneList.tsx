import { useEffect, useRef, useState } from "react";
import {
  Button,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDrag,
  IconMore,
  IconPencil,
  IconPlay,
  IconTrash,
  Menu,
  MenuItem,
  useDragSurface,
  EmptyState
} from "@vtt/ui";
import { replaceQuery, useRoute } from "../router";
import { useSoundBoard } from "../sound/sound-data";
import { useScenes } from "./context";
import { pathForScene, SCENES_PATHS } from "./routes";
import { useSceneActions } from "./sceneActions";
import { factsOf, readinessOf, type SceneFacts } from "./sceneFacts";
import { readyLineOf, SHELF_CHIPS, STATE_TAG_LABEL, stateTagOf, type StateTag } from "./stateTag";
import { ShelfCard, whoIsIn } from "./SceneShelf";
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

/**
 * Prep's encounters as a shelf (Prep frame 2.1, ADR-0053): the toolbar with the state chips, Filters as a flyout, the
 * sort with the GM's own order as the default and New map; then a card an encounter with its map as the picture, its
 * state tag, who is in it and whether it is ready. A card opens its encounter; its menu holds the rest, and in Your
 * order the cards drag to reorder.
 */
export function SceneList() {
  const { state, maps, links, go, phone } = useScenes();
  const scenes = state.combat.encounters;
  const board = useSoundBoard();
  // The filters and the sort live in the address, so a filtered list is a link and survives a refresh.
  const { query } = useRoute();
  const filters = readSceneFilters(query);
  const sort = readSort(query, SCENE_SORT_KEYS, DEFAULT_SCENE_SORT);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const actions = useSceneActions(scenes, {
    combatActive: state.combat.active,
    onDuplicated: (encounterId) => go(pathForScene(encounterId))
  });
  const all = scenes.map((scene) => factsOf(state, scene, maps));
  const shown = sortScenes(
    filterScenes(all, filters, {
      linked: (encounterId) => {
        const link = links.get(encounterId);
        return link !== undefined && link.sessions.length + link.pins.length > 0;
      },
      hasSound: (encounterId) => Boolean(board?.board.presets.some((preset) => preset.encounterId === encounterId))
    }),
    sort,
    scenes.map((scene) => scene.id)
  );
  const inOrder = sort.length === 1 && sort[0]!.key === "order" && sort[0]!.direction === "asc";
  // The state chips (Prep rule 3.3) filter by the tag each card shows, from the address's `tag`.
  const tagOf = (row: SceneFacts) => stateTagOf(row, readinessOf(row, maps));
  const chip = (query.get("tag") as StateTag | null) ?? null;
  const present = new Set(all.map(tagOf));
  const chips: readonly StateTag[] = [
    ...SHELF_CHIPS,
    ...(["live", "parked"] as const).filter((tag) => present.has(tag) || chip === tag)
  ];
  const tagged = chip ? shown.filter((row) => tagOf(row) === chip) : shown;

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
      // The cards carry `data-scene-id`, read back as `dataset.sceneId` (the drag once read a name they never carried).
      const over = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-scene-id]") ?? [])].find((card) => {
        const rect = card.getBoundingClientRect();
        return (
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right
        );
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
  const beginDrag = (encounterId: string, event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const order = scenes.map((scene) => scene.id);
    drag.current = { id: encounterId, order, start: order.join() };
    setDragId(encounterId);
    setDragOrder(order);
  };
  const rows = dragOrder ? dragOrder.flatMap((id) => tagged.filter((row) => row.scene.id === id)) : tagged;

  const rowMenu = (row: SceneFacts) => {
    const index = scenes.findIndex((scene) => scene.id === row.scene.id);
    return (
      <Menu trigger={<IconMore />} icon label={`${row.scene.name} actions`} align="end">
        {!row.live && (
          <MenuItem icon={<IconPlay />} onClick={() => void actions.makeLive(row.scene)}>
            Make live
          </MenuItem>
        )}
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
            Delete encounter
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
  return (
    <div className="sc-list frame-col">
      <SceneListToolbar
        filters={filters}
        sort={sort}
        onSort={(next) => replaceQuery((params) => setOrDelete(params, "sort", sortParam(next, DEFAULT_SCENE_SORT)))}
        shown={tagged.length}
        total={scenes.length}
        flyoutOpen={flyoutOpen}
        onFlyout={setFlyoutOpen}
        chips={chips}
        chip={chip}
        onChip={(next) => replaceQuery((params) => setOrDelete(params, "tag", next))}
        onNewMap={() => go(SCENES_PATHS.newMap)}
        phone={phone}
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
            <EmptyState action={<Button onClick={() => go(SCENES_PATHS.newScene)}>New encounter</Button>}>
              No encounters yet. An encounter is a map and who is on it, made live when the table is ready.
            </EmptyState>
          ) : shown.length === 0 ? (
            <p className="sc-hint sc-list-none">No encounter matches. Change the filters to see more.</p>
          ) : rows.length === 0 ? (
            <p className="sc-hint sc-list-none">No encounter is {STATE_TAG_LABEL[chip!].toLowerCase()} right now.</p>
          ) : (
            <ul className="sc-shelf" aria-label="Encounters" ref={(element) => void (listRef.current = element)}>
              {rows.map((row) => (
                <ShelfCard
                  key={row.scene.id}
                  row={row}
                  tag={tagOf(row)}
                  ready={readyLineOf(row, maps)}
                  who={whoIsIn(row, state.actors)}
                  phone={phone}
                  dragging={dragId === row.scene.id}
                  grip={grip(row)}
                  menu={rowMenu(row)}
                  onOpen={() => go(pathForScene(row.scene.id))}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {actions.dialogs}
    </div>
  );
}
