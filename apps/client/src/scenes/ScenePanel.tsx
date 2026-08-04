import { useState } from "react";
import type { GmActor, StagingDefaults } from "@vtt/domain";
import { Button, Input } from "@vtt/ui";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import type { MapSelection } from "../maps/MapManager";
import type { PickerMap } from "../maps/MapPicker";
import { ScenePrepPanel } from "./ScenePrepPanel";
import "./scene-panel.css";

/**
 * New scene — the front half of the full prep door (D1). Name it, pick its battle map, and see who is
 * staged; the moment it exists the same panel keeps arranging it beside the private map.
 *
 * Two Appendix-A complaints die here. **A2:** the map is chosen from the embedded picture-first picker
 * (D5) whose first tile uploads *in place* — the old "Upload a battlemap" escape hatch closed this
 * modal and navigated to the Maps tab, so a half-built scene was simply lost. **A1:** the party is
 * pre-staged in the tray rather than being a checklist to scroll, and `+ Add monsters` sits above
 * Recent instead of below the whole roster.
 */
export function ScenePanel({ actors, selectedMap, mapLibrary, stagingDefaults, onCreated }: Readonly<{
  actors: readonly GmActor[];
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  /** The table's standing "new tokens" visibility. Absent = the schema default (shown to players). */
  stagingDefaults?: StagingDefaults;
  /** Called after a successful create with the new scene's id - the launcher closes itself and (by
      default) opens the scene for private staging. */
  onCreated?: (sceneId?: string) => void;
  /** @deprecated The picker uploads without leaving this panel; nothing here navigates away any more.
      Kept so the shell's existing call site still typechecks until it drops the prop. */
  onManageMaps?: () => void;
}>) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // D2: the ACTIVE party is staged from the start - nobody hand-adds their own players every time.
  const [staged, setStaged] = useState<readonly string[]>(() => actors.filter((actor) => actor.kind === "player-character" && !actor.archived).map((actor) => actor.id));
  const [picked, setPicked] = useState<PickerMap | null>(null);
  const battlemaps = (mapLibrary ?? []).filter((map) => map.kind === "battlemap");
  const sceneMap: MapSelection | PickerMap | null = picked
    ?? (selectedMap?.kind === "battlemap" ? selectedMap : null)
    ?? battlemaps[0]
    ?? null;

  const create = () => {
    if (!sceneMap) { setMessage("Pick a battle map first - upload one right in the picker if the library is empty."); return; }
    // The name is optional: an unnamed scene takes its map's name (its image filename by default),
    // so "new scene on this map" is one action. SceneSchema caps names at 120 chars.
    const sceneName = (name.trim() || sceneMap.name).slice(0, 120);
    setBusy(true); setMessage("");
    socket.emit("scene:create", { commandId: newId(), name: sceneName, mapAssetId: sceneMap.id, combatantIds: staged }, (result) => {
      setBusy(false);
      if (result.ok) { setName(""); onCreated?.(result.sceneId); } else setMessage(result.message ?? "The scene could not be created.");
    });
  };

  return <section className="scene-panel" aria-labelledby="scene-panel-heading">
    <div className="scene-panel-heading"><div><span className="eyebrow">GM PREP</span><h2 id="scene-panel-heading">Prepare a scene</h2></div><p>A scene is a map plus who is on it. Arrange it privately, then make it live when the table is ready.</p></div>

    <form className="scene-create" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label>Scene name <span className="scene-create-optional">(optional)</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={sceneMap ? sceneMap.name : "Goblin ambush"} /></label>
      <ScenePrepPanel
        heading="On this map"
        actors={actors}
        staged={staged}
        onAdd={(actorId) => setStaged((current) => current.includes(actorId) ? current : [...current, actorId])}
        onRemove={(actorId) => setStaged((current) => current.filter((id) => id !== actorId))}
        mapName={sceneMap?.name ?? null}
        selectedMapId={sceneMap?.id ?? null}
        onSelectMap={setPicked}
        mapFallback={mapLibrary}
        stagingRevealed={(stagingDefaults?.visibility ?? "public") !== "gm-only"}
        combatActive={false}
        busy={busy}
        emptyNote="Nobody staged. Add characters or monsters below."
        placementHint={false}
        footer={<Button variant="primary" type="submit" disabled={busy || !sceneMap}>Prepare scene</Button>}
      />
    </form>

    {message && <p className="scene-feedback" role="status">{message}</p>}
  </section>;
}
