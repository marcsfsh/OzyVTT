import { useState } from "react";
import type { GmActor } from "@vtt/domain";
import { Button, Input, Select } from "@vtt/ui";
import { MonsterBrowser } from "../encounter/MonsterBrowser";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import type { MapSelection } from "../maps/MapManager";
import "./scene-panel.css";

/**
 * GM "Prepared scenes" - build encounters ahead of time on a chosen battlemap, then park-and-resume
 * between them. Switching the live scene preserves the running fight (round, turn, positions) and
 * resumes the target exactly; the server owns the swap. Lives in Map Setup, beside the map library.
 */
export function ScenePanel({ actors, selectedMap, mapLibrary, onCreated, onManageMaps }: Readonly<{
  actors: readonly GmActor[];
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  /** Called after a successful create with the new scene's id - the launcher closes itself and (by
      default) opens the scene for private staging. */
  onCreated?: (sceneId?: string) => void;
  /** Jump to the folded-in map library to upload/calibrate a battlemap (closes this modal). */
  onManageMaps?: () => void;
}>) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  // The picker lists the party (PCs/NPCs) always; a monster only appears once it's added here, so a
  // fresh scene starts as "just the party" instead of the whole accumulated bestiary.
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(() => new Set());
  // The scene's map is picked right here (defaulting to the library selection) - preparing a scene
  // never requires a Maps-tab visit.
  const battlemaps = (mapLibrary ?? []).filter((map) => map.kind === "battlemap");
  const [sceneMapId, setSceneMapId] = useState<string | null>(null);
  const sceneMap = (sceneMapId !== null ? battlemaps.find((map) => map.id === sceneMapId) : undefined)
    ?? (selectedMap?.kind === "battlemap" ? selectedMap : undefined)
    ?? battlemaps[0]
    ?? null;

  const create = () => {
    if (!sceneMap) { setMessage("Upload a battlemap on the Map Setup tab first."); return; }
    // The name is optional: an unnamed scene takes its map's name (its image filename by default),
    // so "new scene on this map" is one action. SceneSchema caps names at 120 chars.
    const sceneName = (name.trim() || sceneMap.name).slice(0, 120);
    setBusy(true); setMessage("");
    socket.emit("scene:create", { commandId: newId(), name: sceneName, mapAssetId: sceneMap.id, combatantIds: chosen }, (result) => {
      setBusy(false);
      if (result.ok) { setName(""); setChosen([]); onCreated?.(result.sceneId); } else setMessage(result.message ?? "The scene could not be created.");
    });
  };
  const toggle = (actorId: string) => setChosen((current) => current.includes(actorId) ? current.filter((id) => id !== actorId) : [...current, actorId]);
  const visible = actors.filter((actor) => actor.kind !== "monster" || addedIds.has(actor.id));

  return <section className="scene-panel" aria-labelledby="scene-panel-heading">
    <div className="scene-panel-heading"><div><span className="eyebrow">GM PREP</span><h2 id="scene-panel-heading">Prepare a scene</h2></div><p>Name it, pick its battlemap and combatants - it appears in the Scenes strip, ready to stage or make live.</p></div>

    <form className="scene-create" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label>Scene name <span className="scene-create-optional">(optional)</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={sceneMap ? sceneMap.name : "Goblin ambush"} /></label>
      {battlemaps.length > 0
        ? <label className="scene-create-map">On map
            <Select value={sceneMap?.id ?? ""} onChange={(event) => setSceneMapId(event.target.value)}>
              {battlemaps.map((map) => <option key={map.id} value={map.id}>{map.name}{map.calibration ? "" : map.scale ? " (gridless)" : " (uncalibrated)"}</option>)}
            </Select>
          </label>
        : <p className="scene-create-map">{sceneMap ? <>On map <strong>{sceneMap.name}</strong></> : onManageMaps ? <Button variant="secondary" type="button" onClick={onManageMaps}>Upload a battlemap</Button> : <em>Add a battlemap to build a scene on it.</em>}</p>}
      <fieldset className="scene-combatants">
        <legend>Combatants ({chosen.length})</legend>
        {visible.length === 0 ? <p className="scene-empty-note">Your party appears here. Add monsters below to build the encounter.</p>
          : <div className="scene-combatant-list">{visible.map((actor) => <label key={actor.id} className={actor.visibility === "gm-only" ? "hidden" : ""}>
            <input type="checkbox" checked={chosen.includes(actor.id)} onChange={() => toggle(actor.id)} />{actor.name}{actor.visibility === "gm-only" ? " (hidden)" : ""}
          </label>)}</div>}
        <button type="button" className="scene-create-add" disabled={busy} onClick={() => setBrowsing(true)}>+ Add monsters (SRD)</button>
      </fieldset>
      <Button variant="primary" type="submit" disabled={busy || !sceneMap}>Prepare scene</Button>
    </form>
    {browsing && <MonsterBrowser onClose={() => setBrowsing(false)} onAdded={(actorId) => {
      // A just-added monster joins this scene's combatants checked by default.
      setAddedIds((prev) => new Set(prev).add(actorId));
      setChosen((current) => current.includes(actorId) ? current : [...current, actorId]);
    }} />}

    {message && <p className="scene-feedback" role="status">{message}</p>}

    {/* Managing existing scenes (stage, go live, remove) lives in the Encounter tab's scene strip. */}
  </section>;
}
