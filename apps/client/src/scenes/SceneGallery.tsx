import { useEffect, useRef, useState } from "react";
import type { Scene } from "@vtt/domain";
import { Badge, Button, Menu, MenuItem } from "@vtt/ui";
import type { MapSelection } from "../maps/MapManager";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { useCachedMapThumbnail } from "../scene/mapImage";
import { setPreviewScene } from "./scenePreview";
import { useConfirm, usePrompt } from "../components/feedback";
import "./scene-gallery.css";

type Ack = (result: { ok: boolean; message?: string }) => void;

/** Cover-cropped map preview inside a card; a neutral map glyph stands in while the cached fetch lands
    and if the image can't be decoded (a removed or corrupt map asset - never a broken-image icon). */
function SceneThumb({ mapAssetId, token }: Readonly<{ mapAssetId: string; token: string | null | undefined }>) {
  const url = useCachedMapThumbnail(mapAssetId, token);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return url && !failed
    ? <img src={url} alt="" onError={() => setFailed(true)} />
    : <span className="nh-card-thumb-empty" aria-hidden="true">🗺️</span>;
}

/**
 * The GM's scene-prep home: every prepared scene as a card in one gallery. Tap a card to stage it
 * privately, ▶ Go live to make it the table's live scene (and push it to the shared screen), and the
 * ⋯ menu to reorder, rename, duplicate, or remove it. "New scene" opens the prep flow. The live scene
 * carries a glowing LIVE badge; the one you're privately staging takes a quiet cyan edge.
 */
export function SceneGallery({ scenes, activeSceneId, combatActive, liveCombatantCount, mapLibrary, previewingSceneId, token, onNewScene, onManageMaps, onClose, hideHeading, surface, onFeedback }: Readonly<{
  scenes: readonly Scene[];
  activeSceneId: string | null;
  combatActive: boolean;
  /** Combatants in the LIVE scene: its own `combat` slot is empty by invariant (the live copy is the
      top-level combat), so the active card must count from here, not from `scene.combat.initiative`. */
  liveCombatantCount: number;
  mapLibrary?: readonly MapSelection[];
  previewingSceneId: string | null;
  /** Bearer token for the map-content endpoint; absent = thumbnails stay as the glyph placeholder. */
  token?: string | null;
  onNewScene: () => void;
  /** Open the folded-in map library / calibration surface (the retired Map Setup tab). */
  onManageMaps?: () => void;
  /** Called after Prepare / Go live — used to close the picker popup on the Encounter tab. */
  onClose?: () => void;
  /** Hide the "GM PREP / Scenes" header (the picker popup carries its own title). */
  hideHeading?: boolean;
  /**
   * This instance IS the Scenes surface: it owns the pane's frame (§7) — heading and command bar
   * pinned, the card grid the one scrolling region — and stands on the scene sky. The picker Modal
   * renders the same component as CONTENT inside a body that already scrolls, and passes nothing.
   */
  surface?: boolean;
  onFeedback?: (text: string) => void;
}>) {
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const emit = (event: string, payload: Record<string, unknown>, failure: string) => {
    (socket.emit as (event: string, payload: unknown, ack: Ack) => void)(event, { commandId: newId(), ...payload }, (result) => {
      if (!result.ok) onFeedback?.(result.message ?? failure);
    });
  };
  const mapName = (mapAssetId: string) => (mapLibrary ?? []).find((map) => map.id === mapAssetId)?.name ?? "Battle map";

  const goLive = async (scene: Scene) => {
    if (!combatActive || (await confirm({ title: "Make scene live?", body: `Make “${scene.name}” live? Players and the shared screen switch now; the current fight is parked and resumes when you switch back.`, confirmLabel: "Make live" }))) {
      setPreviewScene(null);
      emit("scene:activate", { sceneId: scene.id }, "The scene could not be switched.");
      onClose?.();
    }
  };
  // Prepare = open the scene for private staging (place tokens / edit combatants on its map).
  const prepare = (scene: Scene) => { setPreviewScene(scene.id); onClose?.(); };
  const rename = async (scene: Scene) => {
    const next = await prompt({ title: "Rename scene", defaultValue: scene.name, confirmLabel: "Rename" });
    if (next && next !== scene.name) emit("scene:rename", { sceneId: scene.id, name: next }, "The scene could not be renamed.");
  };
  // Triad **Delete**: a scene is gone for good, so it is named for what it does and says so (D28).
  const remove = async (scene: Scene) => {
    if (await confirm({ title: "Delete scene?", body: `Delete “${scene.name}”? Its staged tokens and fog go with it. This cannot be undone.`, confirmLabel: "Delete", danger: true })) {
      if (scene.id === previewingSceneId) setPreviewScene(null);
      emit("scene:remove", { sceneId: scene.id }, "The scene could not be removed.");
    }
  };
  // Reorder: drag a card by its grip (pointer + touch), or Move earlier/later from the ⋯ menu
  // (keyboard). Both send the full id permutation the server validates.
  const move = (sceneId: string, delta: -1 | 1) => {
    const order = scenes.map((scene) => scene.id);
    const index = order.indexOf(sceneId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    emit("scene:reorder", { order }, "The scenes could not be reordered.");
  };
  const galleryRef = useRef<HTMLUListElement>(null);
  const drag = useRef<{ id: string; order: string[]; start: string; commit: (order: string[]) => void } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOrder, setDragOrder] = useState<readonly string[] | null>(null);
  // Drag-to-reorder by the grip. Pointer move/up live on the WINDOW (attached only while dragging),
  // not on the grip element: the grip moves in the DOM as the list reorders mid-drag, which would
  // strand pointer capture on a relocated node and leave the pointer feeling "stuck". A ref carries the
  // live order + a commit closure so the window listeners always read fresh state and never re-subscribe.
  const beginDrag = (sceneId: string, event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const order = scenes.map((scene) => scene.id);
    drag.current = { id: sceneId, order, start: order.join(), commit: (next) => emit("scene:reorder", { order: next }, "The scenes could not be reordered.") };
    setDragId(sceneId);
    setDragOrder(order);
  };
  useEffect(() => {
    if (!dragId) return;
    const onMove = (event: PointerEvent) => {
      const gallery = galleryRef.current;
      const state = drag.current;
      if (!gallery || !state) return;
      const over = [...gallery.querySelectorAll<HTMLElement>("[data-scene-id]")].find((card) => {
        const rect = card.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      })?.dataset.sceneId;
      if (!over || over === state.id) return;
      const next = state.order.filter((id) => id !== state.id);
      next.splice(next.indexOf(over), 0, state.id);
      state.order = next;
      setDragOrder(next);
    };
    const onUp = () => {
      const state = drag.current;
      if (state && state.order.join() !== state.start) state.commit(state.order);
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
  }, [dragId]);
  // Render the optimistic order mid-drag; otherwise follow the server's order.
  const ordered = dragOrder
    ? dragOrder.map((id) => scenes.find((scene) => scene.id === id)).filter((scene): scene is Scene => Boolean(scene))
    : scenes;

  return <section className={`scene-gallery-hub${surface ? " pane-frame pane-scene scanlines frame-col anim-view" : ""}`} aria-label="Scenes">
    {!hideHeading && <div className="scene-gallery-head">
      <span className="eyebrow">GM PREP</span>
      <h2 id="scene-gallery-heading">Scenes</h2>
      <p>Build your fights ahead of time — pick a map, stage who’s in it, then go live. The live scene is what your players and the shared screen see.</p>
    </div>}
    {scenes.length > 0 && <div className="scene-gallery-bar">
      <Button variant="primary" arrow onClick={onNewScene}>New scene</Button>
      {onManageMaps && <Button variant="secondary" onClick={onManageMaps}>Manage maps</Button>}
    </div>}
    {scenes.length === 0
      /* A scene moment (§9): one line and one door. The old dashed box carried a title, two
         sentences and a decorative glyph — three of the four said the same thing. */
      ? <div className="scene-empty">
          <p>No scenes prepared yet — pick a map, stage who’s in it, then go live.</p>
          <Button variant="primary" arrow onClick={onNewScene}>New scene</Button>
        </div>
      /* The REGION is this wrapper, never the grid itself: a grid with a definite block size
         stops sizing its auto rows from their cards (measured — every card overflowed its row
         into the one below at 390px), so the scroller wraps the grid and the grid keeps the auto
         height it has always had. */
      : <div className={`scene-gallery-grid${surface ? " scroll-y frame-fill" : ""}`}>
        <ul className="nh-gallery" ref={galleryRef}>
          {ordered.map((scene, index) => {
            const live = scene.id === activeSceneId;
            const staging = scene.id === previewingSceneId;
            const count = live ? liveCombatantCount : scene.combat.initiative.length;
            return <li key={scene.id} data-scene-id={scene.id} className={`nh-card${live ? " is-live" : ""}${staging ? " is-staging" : ""}${dragId === scene.id ? " is-dragging" : ""}`}>
              <div className="nh-card-thumb"><SceneThumb mapAssetId={scene.mapAssetId} token={token} /></div>
              <div className="nh-card-body">
                <h3 className="nh-card-title">{scene.name}</h3>
                <span className="nh-card-meta">{mapName(scene.mapAssetId)} · {count} character{count === 1 ? "" : "s"} &amp; monster{count === 1 ? "" : "s"}</span>
              </div>
              {(live || staging) && <span className="nh-card-status">{live ? <Badge tone="primary" solid>LIVE</Badge> : <Badge>Staging</Badge>}</span>}
              <div className="nh-card-tools">
                {scenes.length > 1 && <button type="button" className="scene-card-grip" aria-label={`Drag to reorder ${scene.name}`}
                  onPointerDown={(event) => beginDrag(scene.id, event)}>⠿</button>}
                <Menu trigger="⋯" label={`${scene.name} actions`} align="end" hideCaret>
                  <MenuItem icon="←" disabled={index === 0} onClick={() => move(scene.id, -1)}>Move earlier</MenuItem>
                  <MenuItem icon="→" disabled={index === ordered.length - 1} onClick={() => move(scene.id, 1)}>Move later</MenuItem>
                  <MenuItem icon="✎" onClick={() => void rename(scene)}>Rename</MenuItem>
                  <MenuItem icon="⧉" onClick={() => emit("scene:duplicate", { sceneId: scene.id }, "The scene could not be duplicated.")}>Duplicate</MenuItem>
                  {!live && <MenuItem icon="🗑" tone="danger" onClick={() => void remove(scene)}>Delete scene</MenuItem>}
                </Menu>
              </div>
              {live
                ? <div className="nh-card-actions"><span className="scene-live-note">● Live now</span></div>
                : <div className="nh-card-actions"><Button variant="secondary" onClick={() => prepare(scene)}>Prepare</Button><Button variant="primary" onClick={() => void goLive(scene)}>Go live</Button></div>}
            </li>;
          })}
          <li><button type="button" className="nh-card nh-card--new" onClick={onNewScene}><span className="nh-card-new-icon" aria-hidden="true">＋</span>New scene</button></li>
        </ul>
      </div>}
    {dialog}
    {promptDialog}
  </section>;
}
