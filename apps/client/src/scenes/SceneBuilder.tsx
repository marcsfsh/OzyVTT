import { useState } from "react";
import type { GmActor, Scene } from "@vtt/domain";
import { MonsterBrowser } from "../encounter/MonsterBrowser";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import "./scene-panel.css";
import { usePrompt } from "../components/feedback";

/**
 * The encounter-builder shown in the sidebar while the GM stages a scene privately. It's the same
 * kind of tool as the live setup - choose who's in this scene, add SRD monsters to the roster - but
 * it edits THIS scene's own combatant list (scene:set-combatants), never the live table. Token
 * placement happens on the staged map; initiative is rolled when the scene is started after going live.
 */
export function SceneBuilder({ scene, actors, revision }: Readonly<{ scene: Scene; actors: readonly GmActor[]; revision: number }>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [browsing, setBrowsing] = useState(false);
  // Monsters added via the browser during this staging session. The picker lists the party (PCs/NPCs)
  // always, but a monster only once it's staged in this scene or was just added here - so a scene
  // starts as "just the party" rather than the whole accumulated bestiary.
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(() => new Set());
  const inScene = new Set(scene.combat.initiative.map((entry) => entry.actorId));
  const visible = actors.filter((actor) => actor.kind !== "monster" || inScene.has(actor.id) || addedIds.has(actor.id));
  const { prompt, dialog } = usePrompt();

  const setCombatants = (ids: readonly string[]) => {
    setBusy(true); setMessage("");
    socket.emit("scene:set-combatants", { commandId: newId(), sceneId: scene.id, combatantIds: ids, expectedRevision: revision }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? "The scene's combatants could not be updated.");
    });
  };
  const toggle = (actorId: string) => setCombatants(inScene.has(actorId) ? [...inScene].filter((id) => id !== actorId) : [...inScene, actorId]);

  return <section className="scene-builder" aria-labelledby="scene-builder-heading">
    <div className="scene-builder-head"><span className="eyebrow">STAGING · GM ONLY</span>
      <h2 id="scene-builder-heading">{scene.name}
        <button type="button" className="scene-rename" disabled={busy} title="Rename this scene" aria-label={`Rename ${scene.name}`} onClick={async () => {
          const next = await prompt({ title: "Rename scene", defaultValue: scene.name, confirmLabel: "Rename" });
          if (!next || next === scene.name) return;
          setBusy(true); setMessage("");
          socket.emit("scene:rename", { commandId: newId(), sceneId: scene.id, name: next }, (result: { ok: boolean; message?: string }) => { setBusy(false); if (!result.ok) setMessage(result.message ?? "The scene could not be renamed."); });
        }}>✎</button>
      </h2>
      <p>Pick who's in this scene, then drag their tokens onto the map. Players don't see any of this until you make it live.</p></div>
    {visible.length === 0
      ? <p className="scene-builder-empty">Your party appears here. Add monsters below to build the encounter.</p>
      : <ul className="scene-builder-list">{visible.map((actor) => <li key={actor.id}>
          <label><input type="checkbox" checked={inScene.has(actor.id)} disabled={busy} onChange={() => toggle(actor.id)} /><span><strong>{actor.name}</strong><small>{actor.kind}{actor.visibility === "gm-only" ? " · GM-only" : ""}</small></span></label>
        </li>)}</ul>}
    <button type="button" className="scene-builder-add" disabled={busy} onClick={() => setBrowsing(true)}>+ Add monsters (SRD)</button>
    <p className="scene-builder-count">{inScene.size} combatant{inScene.size === 1 ? "" : "s"} staged</p>
    {message && <p className="scene-builder-feedback" role="status">{message}</p>}
    {browsing && <MonsterBrowser onClose={() => setBrowsing(false)} onAdded={(actorId) => {
      // A just-added monster joins this scene checked by default. No expectedRevision: the add itself
      // just bumped the revision, and this is solo private staging, so skip the optimistic-concurrency
      // guard that would otherwise reject this immediate follow-up.
      setAddedIds((prev) => new Set(prev).add(actorId));
      setBusy(true); setMessage("");
      socket.emit("scene:set-combatants", { commandId: newId(), sceneId: scene.id, combatantIds: [...inScene, actorId] }, (result: { ok: boolean; message?: string }) => {
        setBusy(false);
        if (!result.ok) setMessage(result.message ?? "The scene's combatants could not be updated.");
      });
    }} />}
    {dialog}
  </section>;
}
