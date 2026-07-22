import { useEffect, useState } from "react";
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
export function SceneGallery({ scenes, activeSceneId, combatActive, mapLibrary, previewingSceneId, token, onNewScene, onManageMaps, onFeedback }: Readonly<{
  scenes: readonly Scene[];
  activeSceneId: string | null;
  combatActive: boolean;
  mapLibrary?: readonly MapSelection[];
  previewingSceneId: string | null;
  /** Bearer token for the map-content endpoint; absent = thumbnails stay as the glyph placeholder. */
  token?: string | null;
  onNewScene: () => void;
  /** Open the folded-in map library / calibration surface (the retired Map Setup tab). */
  onManageMaps?: () => void;
  onFeedback?: (text: string) => void;
}>) {
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const emit = (event: string, payload: Record<string, unknown>, failure: string) => {
    (socket.emit as (event: string, payload: unknown, ack: Ack) => void)(event, { commandId: newId(), ...payload }, (result) => {
      if (!result.ok) onFeedback?.(result.message ?? failure);
    });
  };
  const mapName = (mapAssetId: string) => (mapLibrary ?? []).find((map) => map.id === mapAssetId)?.name ?? "Battlemap";

  const goLive = async (scene: Scene) => {
    if (!combatActive || (await confirm({ title: "Make scene live?", body: `Make “${scene.name}” live? Players and the shared screen switch now; the current fight is parked and resumes when you switch back.`, confirmLabel: "Make live" }))) {
      setPreviewScene(null);
      emit("scene:activate", { sceneId: scene.id }, "The scene could not be switched.");
    }
  };
  const rename = async (scene: Scene) => {
    const next = await prompt({ title: "Rename scene", defaultValue: scene.name, confirmLabel: "Rename" });
    if (next && next !== scene.name) emit("scene:rename", { sceneId: scene.id, name: next }, "The scene could not be renamed.");
  };
  const remove = async (scene: Scene) => {
    if (await confirm({ title: "Remove scene?", body: `Remove “${scene.name}”?`, confirmLabel: "Remove", danger: true })) {
      if (scene.id === previewingSceneId) setPreviewScene(null);
      emit("scene:remove", { sceneId: scene.id }, "The scene could not be removed.");
    }
  };
  // Adjacent-swap reorder from the menu (keyboard- and touch-accessible); a drag affordance is a
  // later polish pass. Sends the full id permutation the server validates.
  const move = (index: number, delta: -1 | 1) => {
    const order = scenes.map((scene) => scene.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    emit("scene:reorder", { order }, "The scenes could not be reordered.");
  };

  return <section className="scene-gallery-hub" aria-labelledby="scene-gallery-heading">
    <div className="scene-gallery-head">
      <div className="scene-gallery-title">
        <span className="eyebrow">GM PREP</span>
        <h2 id="scene-gallery-heading">Scenes</h2>
        <p>Build your encounters ahead of time — pick a map, stage who’s in it, then go live. The live scene is what your players and the shared screen see.</p>
      </div>
      {onManageMaps && <Button variant="secondary" onClick={onManageMaps}>Manage maps</Button>}
    </div>
    {scenes.length === 0
      ? <div className="nh-empty">
          <span className="nh-empty-icon" aria-hidden="true">🎬</span>
          <span className="nh-empty-title">No scenes yet</span>
          <span className="nh-empty-text">Prepare your first scene — choose a battlemap and who’s in it, then go live when your table is ready.</span>
          <Button variant="primary" arrow onClick={onNewScene}>New scene</Button>
        </div>
      : <ul className="nh-gallery">
          {scenes.map((scene, index) => {
            const live = scene.id === activeSceneId;
            const staging = scene.id === previewingSceneId;
            const count = scene.combat.initiative.length;
            return <li key={scene.id} className={`nh-card is-interactive${live ? " is-live" : ""}${staging ? " is-staging" : ""}`}>
              <div className="nh-card-thumb"><SceneThumb mapAssetId={scene.mapAssetId} token={token} /></div>
              <div className="nh-card-body">
                <h3 className="nh-card-title">{scene.name}</h3>
                <span className="nh-card-meta">{mapName(scene.mapAssetId)} · {count} combatant{count === 1 ? "" : "s"}</span>
              </div>
              <button type="button" className="nh-card-open"
                aria-label={live ? `${scene.name} (live)` : staging ? `Stop staging ${scene.name}` : `Stage ${scene.name} privately`}
                onClick={() => setPreviewScene(live || staging ? null : scene.id)} />
              {(live || staging) && <span className="nh-card-status">{live ? <Badge tone="primary" solid>LIVE</Badge> : <Badge>Staging</Badge>}</span>}
              <div className="nh-card-tools">
                <Menu trigger="⋯" label={`${scene.name} actions`} align="end" hideCaret>
                  {!live && <MenuItem icon="🎬" onClick={() => setPreviewScene(scene.id)}>Stage privately</MenuItem>}
                  <MenuItem icon="←" disabled={index === 0} onClick={() => move(index, -1)}>Move earlier</MenuItem>
                  <MenuItem icon="→" disabled={index === scenes.length - 1} onClick={() => move(index, 1)}>Move later</MenuItem>
                  <MenuItem icon="✎" onClick={() => void rename(scene)}>Rename</MenuItem>
                  <MenuItem icon="⧉" onClick={() => emit("scene:duplicate", { sceneId: scene.id }, "The scene could not be duplicated.")}>Duplicate</MenuItem>
                  {!live && <MenuItem icon="🗑" tone="danger" onClick={() => void remove(scene)}>Remove</MenuItem>}
                </Menu>
              </div>
              {!live && <div className="nh-card-actions"><Button variant="primary" onClick={() => void goLive(scene)}>Go live</Button></div>}
            </li>;
          })}
          <li><button type="button" className="nh-card nh-card--new" onClick={onNewScene}><span className="nh-card-new-icon" aria-hidden="true">＋</span>New scene</button></li>
        </ul>}
    {dialog}
    {promptDialog}
  </section>;
}
