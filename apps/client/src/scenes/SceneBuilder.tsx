import { useState } from "react";
import type { GmActor, Scene, StagingDefaults } from "@vtt/domain";
import { command } from "../lib/command";
import { useMapCatalog } from "../maps/map-catalog";
import { ScenePrepPanel } from "./ScenePrepPanel";
import "./scene-panel.css";
// This panel's frame rules live with the prep room they wrap (scene-prep.css), not scene-panel.css.
import "./scene-prep.css";
import { usePrompt } from "../components/feedback";

/**
 * The full prep workspace beside the privately staged map. It shares `ScenePrepPanel` with the
 * table's quick-start panel; here every change edits this scene's own combatant list
 * (`scene:set-combatants`), never the live table, and new tokens wait in the tray until dragged onto
 * the staged map. Going live is the map cluster's button.
 *
 * The panel is a frame (`frame-col frame-fill`) so it fits the phone sheet row: the head is fixed,
 * the prep room is the one `.scroll-y` region, and the feedback line is the bottom row, so errors are
 * never scrolled away.
 */
export function SceneBuilder({
  scene,
  actors,
  revision,
  stagingDefaults
}: Readonly<{
  scene: Scene;
  actors: readonly GmActor[];
  revision: number;
  /** The table's standing "new tokens" visibility. Absent = the schema default (shown to players). */
  stagingDefaults?: StagingDefaults;
}>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { prompt, dialog } = usePrompt();
  const { maps } = useMapCatalog();
  const staged = scene.combat.initiative.map((entry) => entry.actorId);
  const placedIds = new Set(
    scene.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId)
  );
  const mapName = (maps ?? []).find((map) => map.id === scene.mapAssetId)?.name ?? null;

  const setCombatants = (ids: readonly string[]) => {
    setBusy(true);
    setMessage("");
    void command("scene:set-combatants", { sceneId: scene.id, combatantIds: ids, expectedRevision: revision }).then(
      (result) => {
        setBusy(false);
        if (!result.ok) setMessage(result.message ?? "The scene's list could not be updated.");
      }
    );
  };
  // Adds carry no expectedRevision: an add from the browser has just bumped the revision itself, and
  // in solo private staging the guard would only reject the GM's own follow-up.
  const stageAdd = (actorId: string) => {
    if (staged.includes(actorId)) return;
    setBusy(true);
    setMessage("");
    void command("scene:set-combatants", { sceneId: scene.id, combatantIds: [...staged, actorId] }).then((result) => {
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? "The scene's list could not be updated.");
    });
  };
  const rename = async () => {
    const next = await prompt({ title: "Rename scene", defaultValue: scene.name, confirmLabel: "Rename" });
    if (!next || next === scene.name) return;
    setBusy(true);
    setMessage("");
    void command("scene:rename", { sceneId: scene.id, name: next }).then((result) => {
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? "The scene could not be renamed.");
    });
  };

  return (
    <section className="scene-builder frame-col frame-fill" aria-labelledby="scene-builder-heading">
      <div className="scene-builder-head">
        <span className="eyebrow">ARRANGING · GM ONLY</span>
        <h2 id="scene-builder-heading">
          {scene.name}
          <button
            type="button"
            className="scene-rename"
            disabled={busy}
            title="Rename this scene"
            aria-label={`Rename ${scene.name}`}
            onClick={() => void rename()}
          >
            ✎
          </button>
        </h2>
        <p>Players see none of this until you make the scene live.</p>
      </div>
      <div className="scene-builder-body scroll-y frame-fill">
        <ScenePrepPanel
          heading="In this scene"
          actors={actors}
          staged={staged}
          placedIds={placedIds}
          onAdd={stageAdd}
          onRemove={(actorId) => setCombatants(staged.filter((id) => id !== actorId))}
          mapName={mapName}
          // A scene owns its map for life: there is no command to swap it, and its token positions are in that
          // map's pixels. Prepare another scene to use another map.
          mapLocked
          selectedMapId={scene.mapAssetId}
          stagingRevealed={(stagingDefaults?.visibility ?? "public") !== "gm-only"}
          combatActive={false}
          busy={busy}
          emptyNote="No one in this scene yet. The party is added the moment you tap Add characters; monsters come from the browser."
        />
      </div>
      {message && (
        <p className="scene-builder-feedback" role="status">
          {message}
        </p>
      )}
      {dialog}
    </section>
  );
}
