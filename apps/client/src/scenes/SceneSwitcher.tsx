import type { Scene } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { useCachedMapThumbnail } from "../scene/mapImage";
import { setPreviewScene } from "./scenePreview";
import "./scene-switcher.css";

type Ack = (result: { ok: boolean; message?: string }) => void;

/** Tiny cover-cropped map preview inside a chip (AboveVTT-style scene picker); text-only until the cached fetch lands. */
function SceneThumb({ mapAssetId, token }: Readonly<{ mapAssetId: string; token: string | null | undefined }>) {
  const url = useCachedMapThumbnail(mapAssetId, token);
  return url ? <img className="scene-chip-thumb" src={url} alt="" /> : null;
}

/**
 * The scene IA in one strip, where the GM already lives (the Encounter tab): every prepared scene
 * is a chip — tap to stage/edit it privately, ▶ to make it live for the whole table (one click;
 * a running fight is parked and resumes on switch-back), ✕ to remove, "+ New scene" to prepare
 * another. No Maps-tab visits, no modal digging just to change scenes.
 */
export function SceneSwitcher({ scenes, activeSceneId, combatActive, mapLibrary, previewingSceneId, token, onNewScene, onFeedback }: Readonly<{
  scenes: readonly Scene[];
  activeSceneId: string | null;
  combatActive: boolean;
  mapLibrary?: readonly MapSelection[];
  previewingSceneId: string | null;
  /** Bearer token for the map-content endpoint; absent = chips stay text-only. */
  token?: string | null;
  onNewScene: () => void;
  onFeedback?: (text: string) => void;
}>) {
  const emit = (event: string, payload: Record<string, unknown>, failure: string) => {
    (socket.emit as (event: string, payload: unknown, ack: Ack) => void)(event, { commandId: newId(), ...payload }, (result) => {
      if (!result.ok) onFeedback?.(result.message ?? failure);
    });
  };
  const mapName = (mapAssetId: string) => (mapLibrary ?? []).find((map) => map.id === mapAssetId)?.name ?? "Battlemap";

  return <div className="scene-switcher" role="group" aria-label="Scenes">
    <span className="scene-switcher-label">Scenes</span>
    {scenes.map((scene) => {
      const live = scene.id === activeSceneId;
      const staging = scene.id === previewingSceneId;
      return <div key={scene.id} className={`scene-chip${live ? " live" : ""}${staging ? " staging" : ""}`}>
        <button type="button" className="scene-chip-main" title={`${scene.name} — ${mapName(scene.mapAssetId)} · ${scene.combat.initiative.length} combatant${scene.combat.initiative.length === 1 ? "" : "s"}${live ? " · LIVE" : staging ? " · staging (only you see it)" : ". Tap to stage and edit privately."}`}
          onClick={() => setPreviewScene(staging || live ? null : scene.id)} aria-pressed={staging}>
          <SceneThumb mapAssetId={scene.mapAssetId} token={token} />
          <strong>{scene.name}</strong>
          <small>{live ? "LIVE" : staging ? "staging" : `${scene.combat.initiative.length}⚔`}</small>
        </button>
        {!live && <button type="button" className="scene-chip-go" title={`Make “${scene.name}” live for the whole table${combatActive ? " (the current fight is parked and resumes when you switch back)" : ""}`}
          onClick={() => { if (!combatActive || window.confirm(`Make “${scene.name}” live? Players and the shared screen switch now; the current fight is parked and resumes when you switch back.`)) { setPreviewScene(null); emit("scene:activate", { sceneId: scene.id }, "The scene could not be switched."); } }}>▶</button>}
        {!live && <button type="button" className="scene-chip-remove" title={`Remove “${scene.name}”`} aria-label={`Remove ${scene.name}`}
          onClick={() => { if (window.confirm(`Remove “${scene.name}”?`)) { if (staging) setPreviewScene(null); emit("scene:remove", { sceneId: scene.id }, "The scene could not be removed."); } }}>✕</button>}
      </div>;
    })}
    <button type="button" className="scene-chip scene-chip-new" onClick={onNewScene}>+ New scene</button>
  </div>;
}
