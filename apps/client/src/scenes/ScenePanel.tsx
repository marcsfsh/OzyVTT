import { useState } from "react";
import type { GmActor, Scene } from "@vtt/domain";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import type { MapSelection } from "../maps/MapManager";
import { setPreviewScene } from "./scenePreview";
import "./scene-panel.css";

type Ack = (result: { ok: boolean; message?: string }) => void;

/**
 * GM "Prepared scenes" — build encounters ahead of time on a chosen battlemap, then park-and-resume
 * between them. Switching the live scene preserves the running fight (round, turn, positions) and
 * resumes the target exactly; the server owns the swap. Lives in Map Setup, beside the map library.
 */
export function ScenePanel({ scenes, activeSceneId, combatActive, combatRound, actors, selectedMap }: Readonly<{
  scenes: readonly Scene[];
  activeSceneId: string | null;
  combatActive: boolean;
  combatRound: number;
  actors: readonly GmActor[];
  selectedMap: MapSelection | null;
}>) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const emit = (event: string, payload: Record<string, unknown>, failure: string) => {
    setBusy(true); setMessage("");
    (socket.emit as (event: string, payload: unknown, ack: Ack) => void)(event, { commandId: newId(), ...payload }, (result) => {
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? failure);
    });
  };
  const create = () => {
    if (!selectedMap || selectedMap.kind !== "battlemap") { setMessage("Select a battlemap in the library first."); return; }
    if (!name.trim()) { setMessage("Name the scene."); return; }
    setBusy(true); setMessage("");
    socket.emit("scene:create", { commandId: newId(), name: name.trim(), mapAssetId: selectedMap.id, combatantIds: chosen }, (result) => {
      setBusy(false);
      if (result.ok) { setName(""); setChosen([]); } else setMessage(result.message ?? "The scene could not be created.");
    });
  };
  const toggle = (actorId: string) => setChosen((current) => current.includes(actorId) ? current.filter((id) => id !== actorId) : [...current, actorId]);
  const mapName = (mapAssetId: string) => selectedMap?.id === mapAssetId ? selectedMap.name : "Battlemap";

  return <section className="scene-panel" aria-labelledby="scene-panel-heading">
    <div className="scene-panel-heading"><div><span className="eyebrow">GM PREP</span><h2 id="scene-panel-heading">Prepared scenes</h2></div><p>Stage encounters ahead of time, then switch between them mid-session — the running fight is parked and resumes exactly.</p></div>

    <form className="scene-create" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label>Scene name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Goblin ambush" /></label>
      <p className="scene-create-map">{selectedMap && selectedMap.kind === "battlemap" ? <>On map <strong>{selectedMap.name}</strong></> : <em>Select a battlemap in the library above to use it here.</em>}</p>
      <fieldset className="scene-combatants">
        <legend>Combatants ({chosen.length})</legend>
        {actors.length === 0 ? <p className="scene-empty-note">Add combatants to the roster first.</p>
          : <div className="scene-combatant-list">{actors.map((actor) => <label key={actor.id} className={actor.visibility === "gm-only" ? "hidden" : ""}>
            <input type="checkbox" checked={chosen.includes(actor.id)} onChange={() => toggle(actor.id)} />{actor.name}{actor.visibility === "gm-only" ? " (hidden)" : ""}
          </label>)}</div>}
      </fieldset>
      <button disabled={busy || !selectedMap || selectedMap.kind !== "battlemap"}>Prepare scene</button>
    </form>

    {message && <p className="scene-feedback" role="status">{message}</p>}

    {scenes.length === 0
      ? <p className="scene-empty">No prepared scenes yet.</p>
      : <ul className="scene-list">{scenes.map((scene) => {
        const live = scene.id === activeSceneId;
        return <li key={scene.id} className={live ? "live" : ""}>
          <div className="scene-row-main">
            <strong>{scene.name}</strong>
            <span>{mapName(scene.mapAssetId)} · {scene.combat.initiative.length} combatant{scene.combat.initiative.length === 1 ? "" : "s"}</span>
          </div>
          {live && <span className="scene-badge">{combatActive ? `Live · Round ${combatRound}` : "Live · staged"}</span>}
          <div className="scene-row-actions">
            {!live && <button type="button" disabled={busy} onClick={() => setPreviewScene(scene.id)}>Preview / edit</button>}
            {!live && <button type="button" disabled={busy} onClick={() => { if (!combatActive || window.confirm(`Make “${scene.name}” live? Players and the shared screen switch to it now; the current fight is parked and resumes when you switch back.`)) emit("scene:activate", { sceneId: scene.id }, "The scene could not be switched."); }}>Make live</button>}
            <button type="button" className="secondary" disabled={busy} onClick={() => { const next = window.prompt("Rename scene:", scene.name)?.trim(); if (next) emit("scene:rename", { sceneId: scene.id, name: next }, "The scene could not be renamed."); }}>Rename</button>
            {!live && <button type="button" className="secondary" disabled={busy} onClick={() => { if (window.confirm(`Remove “${scene.name}”?`)) emit("scene:remove", { sceneId: scene.id }, "The scene could not be removed."); }}>Remove</button>}
          </div>
        </li>;
      })}</ul>}
  </section>;
}
