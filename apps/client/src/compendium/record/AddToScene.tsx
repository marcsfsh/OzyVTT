import { useEffect, useRef, useState } from "react";
import type { GmView } from "@vtt/domain";
import { Button, IconPlus, Modal, useToast } from "@vtt/ui";
import { loadMonsterCatalog } from "../../encounter/monster-catalog";
import { command } from "../../lib/command";
import { navigate } from "../../router";
import { SCENES_PATHS } from "../../scenes/routes";

/** Waits, a moment at most, for the game state to hold the new monster, so the staging reads a fresh snapshot. */
async function settled(latest: { readonly current: GmView }, actorId: string): Promise<GmView> {
  for (let tries = 0; tries < 20; tries += 1) {
    if (latest.current.actors.some((actor) => actor.id === actorId)) return latest.current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return latest.current;
}

/**
 * Add to a scene, on a monster's card: picks a prepared scene that is neither live nor holding a parked fight, adds the
 * monster to the roster at the table's staging default, then stages it in that scene with the scene's own command. Two
 * commands, not one: if the staging is refused after the monster was made, the new monster is kept and Stage it again
 * stages that one, so no duplicate is made. A live or parked fight adds from the table's Fight menu instead, and the
 * scene is never made live here.
 */
export function AddToScene({
  game,
  definitionId,
  name
}: Readonly<{ game: GmView; definitionId: string; name: string }>) {
  const [inCatalog, setInCatalog] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A monster made for a scene whose staging was refused: kept, so a retry stages it rather than making another.
  const [unstaged, setUnstaged] = useState<Readonly<{ actorId: string; sceneId: string; reason: string }> | null>(null);
  const latest = useRef(game);
  latest.current = game;
  const { toast } = useToast();
  useEffect(() => {
    let live = true;
    void loadMonsterCatalog().then(
      (catalog) => {
        if (live) setInCatalog(catalog.monsters.some((monster) => monster.id === definitionId));
      },
      () => {
        if (live) setInCatalog(false);
      }
    );
    return () => {
      live = false;
    };
  }, [definitionId]);
  if (!inCatalog) return null;

  const scenes = (game.combat.scenes ?? []).filter((scene) => !scene.replayOf);
  const isLive = (sceneId: string) => game.combat.activeSceneId === sceneId;

  const stage = async (actorId: string, sceneId: string): Promise<boolean> => {
    const now = await settled(latest, actorId);
    const scene = (now.combat.scenes ?? []).find((candidate) => candidate.id === sceneId);
    if (!scene || now.combat.activeSceneId === sceneId || scene.combat.active) {
      setUnstaged({ actorId, sceneId, reason: "That scene is live or holds a fight now. Add from the table instead." });
      return false;
    }
    // The scene's own list from this snapshot, with the new monster added; the revision guards a staging made meanwhile.
    const combatantIds = [...new Set([...scene.combat.initiative.map((entry) => entry.actorId), actorId])];
    const result = await command("scene:set-combatants", { sceneId, combatantIds, expectedRevision: now.revision });
    if (!result.ok) {
      setUnstaged({ actorId, sceneId, reason: result.message ?? "The scene could not take it." });
      return false;
    }
    setUnstaged(null);
    toast(`${name} is staged in ${scene.name}.`, { tone: "success" });
    return true;
  };

  const add = async (sceneId: string) => {
    setBusy(true);
    try {
      if (unstaged && unstaged.sceneId === sceneId) {
        if (await stage(unstaged.actorId, sceneId)) setOpen(false);
        return;
      }
      const created = await command("actor:add-from-definition", {
        definitionId,
        visibility: latest.current.stagingDefaults?.visibility ?? "public",
        joinEncounter: false
      });
      if (!created.ok || !created.actorId) {
        toast(created.message ?? `${name} could not be added.`, { tone: "error" });
        return;
      }
      if (await stage(created.actorId, sceneId)) setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <IconPlus /> Add to a scene
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Add ${name} to a scene`} size="sm">
        {scenes.length === 0 ? (
          <div className="cp-add-scene-none">
            <p className="cp-hint">No scene is prepared yet.</p>
            <Button variant="secondary" onClick={() => navigate(SCENES_PATHS.newScene)}>
              <IconPlus /> New scene
            </Button>
          </div>
        ) : (
          <ul className="cp-add-scene-list">
            {scenes.map((scene) => {
              const live = isLive(scene.id);
              const parked = !live && scene.combat.active;
              const retry = unstaged?.sceneId === scene.id;
              return (
                <li key={scene.id}>
                  <Button
                    variant="secondary"
                    block
                    disabled={busy || live || parked}
                    onClick={() => void add(scene.id)}
                  >
                    {retry ? `Stage it in ${scene.name} again` : scene.name}
                  </Button>
                  {(live || parked) && (
                    <p className="cp-hint">
                      {live
                        ? "Live now: add from the table's Fight menu."
                        : "A fight is parked here: add from the table once it is live."}
                    </p>
                  )}
                  {retry && (
                    <p className="cp-hint is-caution" role="status">
                      {name} was added to the roster but isn&apos;t staged here yet. {unstaged.reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </>
  );
}
