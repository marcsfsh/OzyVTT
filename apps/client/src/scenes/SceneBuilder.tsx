import { useState } from "react";
import type { GmActor, Scene, StagingDefaults } from "@vtt/domain";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { useMapCatalog } from "../maps/map-catalog";
import { ScenePrepPanel } from "./ScenePrepPanel";
import "./scene-panel.css";
// The frame rules for this panel live beside the room they wrap, not in scene-panel.css: that file
// is the two prep surfaces' chrome, and `.scene-builder-body` IS the prep room's region.
import "./scene-prep.css";
import { usePrompt } from "../components/feedback";

/**
 * The full prep door (D1): the workspace panel beside the privately staged map. Same parts as the
 * table's quick-start panel — map line, staging tray, the two Add buttons, Recent — because they are
 * literally the same component (`ScenePrepPanel`); only what an add COMMITS to differs. Here every
 * change edits this scene's own combatant list (`scene:set-combatants`), never the live table, and
 * the tokens it creates sit unplaced in the tray until the GM drags them onto the staged map.
 *
 * Making the scene live is the map cluster's button, not a second copy here — one action, one place.
 *
 * THE PANEL IS A FRAME (§7), and that is what lets it sit in the phone table's sheet row. It is the
 * row's one child, so it takes the row's height (`frame-col frame-fill`, the @vtt/ui utilities): the
 * head is a fixed row, the prep room below it is the ONE region — `.scroll-y` in the MARKUP, the
 * blessed marker — and the feedback line is the bottom row, so an error is never scrolled away from.
 * Before this it rendered at natural height (84 + 540 = 681px inside a 413px row at 390x844) and the
 * sheet ROW carried a `.scroll-y` bridge to keep the overflow reachable; the bridge is gone with it,
 * and every arm of that row is a frame column again.
 */
export function SceneBuilder({ scene, actors, revision, stagingDefaults }: Readonly<{
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
  const placedIds = new Set(scene.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId));
  const mapName = (maps ?? []).find((map) => map.id === scene.mapAssetId)?.name ?? null;

  const setCombatants = (ids: readonly string[]) => {
    setBusy(true); setMessage("");
    socket.emit("scene:set-combatants", { commandId: newId(), sceneId: scene.id, combatantIds: ids, expectedRevision: revision }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? "The scene's list could not be updated.");
    });
  };
  // Adds carry no expectedRevision: an add from the browser has just bumped the revision itself, and
  // this is solo private staging, so the optimistic-concurrency guard would only reject the GM's own
  // immediate follow-up.
  const stageAdd = (actorId: string) => {
    if (staged.includes(actorId)) return;
    setBusy(true); setMessage("");
    socket.emit("scene:set-combatants", { commandId: newId(), sceneId: scene.id, combatantIds: [...staged, actorId] }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? "The scene's list could not be updated.");
    });
  };
  const rename = async () => {
    const next = await prompt({ title: "Rename scene", defaultValue: scene.name, confirmLabel: "Rename" });
    if (!next || next === scene.name) return;
    setBusy(true); setMessage("");
    socket.emit("scene:rename", { commandId: newId(), sceneId: scene.id, name: next }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? "The scene could not be renamed.");
    });
  };

  return <section className="scene-builder frame-col frame-fill" aria-labelledby="scene-builder-heading">
    <div className="scene-builder-head"><span className="eyebrow">ARRANGING · GM ONLY</span>
      <h2 id="scene-builder-heading">{scene.name}
        <button type="button" className="scene-rename" disabled={busy} title="Rename this scene" aria-label={`Rename ${scene.name}`} onClick={() => void rename()}>✎</button>
      </h2>
      <p>Players see none of this until you make the scene live.</p></div>
    <div className="scene-builder-body scroll-y frame-fill">
      <ScenePrepPanel
        heading="In this scene"
        actors={actors}
        staged={staged}
        placedIds={placedIds}
        onAdd={stageAdd}
        onRemove={(actorId) => setCombatants(staged.filter((id) => id !== actorId))}
        mapName={mapName}
        // A scene owns its map for life: there is no command to swap it, and its staged token positions
        // are in that map's pixels. Prepare another scene to use another map.
        mapLocked
        selectedMapId={scene.mapAssetId}
        stagingRevealed={(stagingDefaults?.visibility ?? "public") !== "gm-only"}
        combatActive={false}
        busy={busy}
        emptyNote="No one in this scene yet. The party is added the moment you tap Add characters; monsters come from the browser."
      />
    </div>
    {message && <p className="scene-builder-feedback" role="status">{message}</p>}
    {dialog}
  </section>;
}
