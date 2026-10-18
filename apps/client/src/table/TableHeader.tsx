import type { GmView, PlayerView } from "@vtt/domain";
import { Button, IconLocate, IconPlay, IconPlus, IconScene, Menu, MenuItem, ToastOutlet } from "@vtt/ui";
import { navigate } from "../router";
import { pathForScene, SCENES_PATHS } from "../scenes/routes";
import { useSceneActions } from "../scenes/sceneActions";
import { focusTokenOnMap, openMapToolGroup } from "../scene/tableGeometry";
import { NowPlaying } from "../sound/NowPlaying";
import { tableStatus } from "./status";
import { TvControl } from "./TvControl";
import "./table-header.css";

/** What only the GM's header has: the scenes to switch to, and the TV's preview. */
export type GmHeader = Readonly<{
  token: string;
  liveMapName: string | null;
  viewerPreview: Readonly<{ on: boolean; onToggle: () => void }>;
}>;

/**
 * The bar above the map: the live scene (a menu of scenes for the GM), the table's one-line status, and for the GM
 * the fog and vision state, the TV and the music. The status line also carries the newest notice in its place, so a
 * toast never floats over the map or a prompt.
 */
export function TableHeader(
  props: Readonly<{ role: "gm"; state: GmView; gm: GmHeader } | { role: "player"; state: PlayerView }>
) {
  const status = (
    <p className="table-status">
      <ToastOutlet fallback={tableStatus(props)} />
    </p>
  );
  if (props.role === "player") {
    const mine = props.state.actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine");
    const placed = mine && props.state.combat.tokens.some((entry) => entry.actorId === mine.id && entry.position);
    return (
      <header className="table-header" aria-label="The table">
        {status}
        {mine && placed && (
          <Button
            variant="secondary"
            size="sm"
            className="table-header-me"
            title="Bring your token into view"
            onClick={() => focusTokenOnMap(mine.id)}
          >
            <IconLocate />
            Me
          </Button>
        )}
      </header>
    );
  }
  return <GmTableHeader state={props.state} gm={props.gm} status={status} />;
}

/**
 * The GM's header: the live scene with a menu that makes another scene live (asked first while a fight is on), opens
 * a scene, all scenes, or a new one on the Scenes tab; then the status line, the fog and vision chips, the TV and the
 * music. Scenes are prepared on the Scenes tab, so the table always shows the live scene.
 */
function GmTableHeader({ state, gm, status }: Readonly<{ state: GmView; gm: GmHeader; status: React.ReactNode }>) {
  const scenes = state.combat.scenes ?? [];
  const live = scenes.find((scene) => scene.id === state.combat.activeSceneId) ?? null;
  const fog = state.combat.fog;
  const vision = state.combat.vision;
  const actions = useSceneActions(scenes, { combatActive: state.combat.active });
  return (
    <header className="table-header" aria-label="The table">
      <Menu
        className="table-header-scenes"
        triggerClassName="table-header-scene"
        label={live ? `Scenes · ${live.name} is live` : "Scenes"}
        trigger={
          <>
            <IconScene />
            <span className="table-header-scene-name">{live?.name ?? "No scene live"}</span>
            {live && <span className="table-header-live">Live</span>}
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
        <MenuItem onClick={() => void navigate(SCENES_PATHS.list)}>All scenes</MenuItem>
        <MenuItem icon={<IconPlus />} onClick={() => void navigate(SCENES_PATHS.newScene)}>
          New scene
        </MenuItem>
      </Menu>
      {status}
      {/* Fog and vision as quiet chips while off; each opens its tool beside the map. */}
      <span className="table-header-chips">
        <button
          type="button"
          className={`table-header-chip tap-target interactive${fog.enabled ? "" : " is-off"}`}
          title="Open the fog tools"
          onClick={() => openMapToolGroup("fog")}
        >
          {fog.enabled ? "Fog on" : "Fog off"}
        </button>
        <button
          type="button"
          className={`table-header-chip tap-target interactive${vision.enabled ? "" : " is-off"}`}
          title="Open the light and vision tools"
          onClick={() => openMapToolGroup("light")}
        >
          {vision.enabled ? `Vision on · ${vision.ambient}` : "Vision off"}
        </button>
      </span>
      <TvControl
        gmToken={gm.token}
        liveMap={
          state.combat.mapAssetId
            ? { assetId: state.combat.mapAssetId, name: gm.liveMapName ?? live?.name ?? "Battle map" }
            : null
        }
        preview={gm.viewerPreview}
      />
      <NowPlaying token={gm.token} compact />
      {actions.dialogs}
    </header>
  );
}
