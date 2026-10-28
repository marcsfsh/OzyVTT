import type { GmView } from "@vtt/domain";
import { IconPlay, IconPlus, IconScene, Menu, MenuItem, cx } from "@vtt/ui";
import { navigate } from "../router";
import { pathForScene, SCENES_PATHS } from "../scenes/routes";
import { useSceneActions } from "../scenes/sceneActions";
import "./live-scene-picker.css";

/**
 * The live scene picker on Play: the scene the table shows, and a menu that makes another scene live (asked first
 * while a fight is on), opens this one, all scenes, or a new one. Scenes are prepared in Prep, so Play always shows
 * the live scene.
 */
export function LiveScenePicker({ state, compact = false }: Readonly<{ state: GmView; compact?: boolean }>) {
  const scenes = state.combat.encounters ?? [];
  const live = scenes.find((scene) => scene.id === state.combat.activeEncounterId) ?? null;
  const actions = useSceneActions(scenes, { combatActive: state.combat.active });
  return (
    <>
      <Menu
        className={cx("live-scene", compact && "is-compact")}
        triggerClassName="live-scene-trigger"
        label={live ? `Encounters · ${live.name} is live` : "Encounters"}
        trigger={
          <>
            {!compact && <span className="live-scene-word">Encounter</span>}
            <span className="live-scene-name">{live?.name ?? "No encounter live"}</span>
          </>
        }
      >
        {scenes
          .filter((scene) => scene.id !== live?.id && !scene.replayOf)
          .map((scene) => (
            <MenuItem key={scene.id} icon={<IconPlay />} onClick={() => void actions.makeLive(scene)}>
              Make {scene.name} live
            </MenuItem>
          ))}
        {live && (
          <MenuItem icon={<IconScene />} onClick={() => void navigate(pathForScene(live.id))}>
            Open {live.name}
          </MenuItem>
        )}
        <MenuItem onClick={() => void navigate(SCENES_PATHS.list)}>All encounters</MenuItem>
        <MenuItem icon={<IconPlus />} onClick={() => void navigate(SCENES_PATHS.newScene)}>
          New encounter
        </MenuItem>
      </Menu>
      {actions.dialogs}
    </>
  );
}
