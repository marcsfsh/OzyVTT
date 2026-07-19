import { useState } from "react";
import type { GmActor } from "@vtt/domain";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import type { MapSelection } from "../maps/MapManager";
import "./scene-panel.css";

/**
 * GM "Prepared scenes" — build encounters ahead of time on a chosen battlemap, then park-and-resume
 * between them. Switching the live scene preserves the running fight (round, turn, positions) and
 * resumes the target exactly; the server owns the swap. Lives in Map Setup, beside the map library.
 */
export function ScenePanel({ actors, selectedMap, mapLibrary, onCreated }: Readonly<{
  actors: readonly GmActor[];
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  /** Called after a successful create — the launcher (scene strip modal) closes itself. */
  onCreated?: () => void;
}>) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // The scene's map is picked right here (defaulting to the library selection) — preparing a scene
  // never requires a Maps-tab visit.
  const battlemaps = (mapLibrary ?? []).filter((map) => map.kind === "battlemap");
  const [sceneMapId, setSceneMapId] = useState<string | null>(null);
  const sceneMap = (sceneMapId !== null ? battlemaps.find((map) => map.id === sceneMapId) : undefined)
    ?? (selectedMap?.kind === "battlemap" ? selectedMap : undefined)
    ?? battlemaps[0]
    ?? null;

  const create = () => {
    if (!sceneMap) { setMessage("Upload a battlemap on the Map Setup tab first."); return; }
    if (!name.trim()) { setMessage("Name the scene."); return; }
    setBusy(true); setMessage("");
    socket.emit("scene:create", { commandId: newId(), name: name.trim(), mapAssetId: sceneMap.id, combatantIds: chosen }, (result) => {
      setBusy(false);
      if (result.ok) { setName(""); setChosen([]); onCreated?.(); } else setMessage(result.message ?? "The scene could not be created.");
    });
  };
  const toggle = (actorId: string) => setChosen((current) => current.includes(actorId) ? current.filter((id) => id !== actorId) : [...current, actorId]);

  return <section className="scene-panel" aria-labelledby="scene-panel-heading">
    <div className="scene-panel-heading"><div><span className="eyebrow">GM PREP</span><h2 id="scene-panel-heading">Prepare a scene</h2></div><p>Name it, pick its battlemap and combatants — it appears in the Scenes strip, ready to stage or make live.</p></div>

    <form className="scene-create" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label>Scene name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Goblin ambush" /></label>
      {battlemaps.length > 0
        ? <label className="scene-create-map">On map
            <select value={sceneMap?.id ?? ""} onChange={(event) => setSceneMapId(event.target.value)}>
              {battlemaps.map((map) => <option key={map.id} value={map.id}>{map.name}{map.calibration ? "" : map.scale ? " (gridless)" : " (uncalibrated)"}</option>)}
            </select>
          </label>
        : <p className="scene-create-map">{sceneMap ? <>On map <strong>{sceneMap.name}</strong></> : <em>Upload a battlemap on the Map Setup tab to use it here.</em>}</p>}
      <fieldset className="scene-combatants">
        <legend>Combatants ({chosen.length})</legend>
        {actors.length === 0 ? <p className="scene-empty-note">Add combatants to the roster first.</p>
          : <div className="scene-combatant-list">{actors.map((actor) => <label key={actor.id} className={actor.visibility === "gm-only" ? "hidden" : ""}>
            <input type="checkbox" checked={chosen.includes(actor.id)} onChange={() => toggle(actor.id)} />{actor.name}{actor.visibility === "gm-only" ? " (hidden)" : ""}
          </label>)}</div>}
      </fieldset>
      <button disabled={busy || !sceneMap}>Prepare scene</button>
    </form>

    {message && <p className="scene-feedback" role="status">{message}</p>}

    {/* Managing existing scenes (stage, go live, remove) lives in the Encounter tab's scene strip. */}
  </section>;
}
