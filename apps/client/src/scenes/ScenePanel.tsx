import { useState } from "react";
import type { GmActor, StagingDefaults } from "@vtt/domain";
import { Button, Input } from "@vtt/ui";
import { command } from "../lib/command";
import type { MapSelection } from "../maps/MapManager";
import type { PickerMap } from "../maps/MapPicker";
import { ScenePrepPanel } from "./ScenePrepPanel";
import "./scene-panel.css";

/**
 * New scene: name it, pick its battle map, and see who is staged; once created, the same panel keeps
 * arranging it beside the private map. The map picker uploads in place, and the party is pre-staged
 * in the tray.
 */
export function ScenePanel({
  actors,
  selectedMap,
  mapLibrary,
  stagingDefaults,
  onCreated,
  onMapUploaded,
  onSetGrid
}: Readonly<{
  actors: readonly GmActor[];
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  /** The table's standing "new tokens" visibility. Absent = the schema default (shown to players). */
  stagingDefaults?: StagingDefaults;
  /** Called after a successful create with the new scene's id; the launcher closes itself and (by
      default) opens the scene for private staging. */
  onCreated?: (sceneId?: string) => void;
  /** A map was uploaded from this panel's picker. */
  onMapUploaded?: (map: PickerMap) => void;
  /** Opens a map's grid calibration, for a map that has none. */
  onSetGrid?: (mapId: string) => void;
}>) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // The active party is staged from the start.
  const [staged, setStaged] = useState<readonly string[]>(() =>
    actors.filter((actor) => actor.kind === "player-character" && !actor.archived).map((actor) => actor.id)
  );
  const [picked, setPicked] = useState<PickerMap | null>(null);
  const battlemaps = (mapLibrary ?? []).filter((map) => map.kind === "battlemap");
  const sceneMap: MapSelection | PickerMap | null =
    picked ?? (selectedMap?.kind === "battlemap" ? selectedMap : null) ?? battlemaps[0] ?? null;

  const needsGrid = sceneMap !== null && !sceneMap.calibration && !sceneMap.scale;

  const create = () => {
    if (!sceneMap) {
      setMessage("Pick a battle map first. Upload one in the picker if the library is empty.");
      return;
    }
    // The name is optional: an unnamed scene takes its map's name. SceneSchema caps names at 120 chars.
    const sceneName = (name.trim() || sceneMap.name).slice(0, 120);
    setBusy(true);
    setMessage("");
    void command("scene:create", { name: sceneName, mapAssetId: sceneMap.id, combatantIds: staged }).then((result) => {
      setBusy(false);
      if (result.ok) {
        setName("");
        onCreated?.(result.sceneId);
      } else setMessage(result.message ?? "The scene could not be created.");
    });
  };

  return (
    <section className="scene-panel" aria-labelledby="scene-panel-heading">
      {/* The dialog's title already says "New scene", so the panel only explains. */}
      <div className="scene-panel-heading">
        <h2 id="scene-panel-heading" className="nh-sr-only">
          Prepare a scene
        </h2>
        <p>A scene is a map plus who is on it. Arrange it privately, then make it live when the table is ready.</p>
      </div>

      <form
        className="scene-create"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label>
          Scene name <span className="scene-create-optional">(optional)</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder={sceneMap ? sceneMap.name : "Goblin ambush"}
          />
        </label>
        {/* No `heading` here; SceneBuilder passes "In this scene". */}
        <ScenePrepPanel
          actors={actors}
          staged={staged}
          onAdd={(actorId) => setStaged((current) => (current.includes(actorId) ? current : [...current, actorId]))}
          onRemove={(actorId) => setStaged((current) => current.filter((id) => id !== actorId))}
          mapName={sceneMap?.name ?? null}
          selectedMapId={sceneMap?.id ?? null}
          onSelectMap={setPicked}
          mapFallback={mapLibrary}
          onMapUploaded={onMapUploaded}
          {...(onSetGrid ? { onSetGrid } : {})}
          mapNeedsGrid={needsGrid}
          stagingRevealed={(stagingDefaults?.visibility ?? "public") !== "gm-only"}
          combatActive={false}
          busy={busy}
          emptyNote="Nobody staged. Add characters or monsters below."
          placementHint={false}
          footer={
            <>
              <Button variant="primary" type="submit" disabled={busy || !sceneMap}>
                Prepare scene
              </Button>
              {!sceneMap && <span className="scene-create-why">Pick a battle map to prepare the scene.</span>}
            </>
          }
        />
      </form>

      {message && (
        <p className="scene-feedback" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
