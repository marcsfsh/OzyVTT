import type { GmView, PlayerView } from "@vtt/domain";
import { Button, IconChevronLeft, IconLocate, IconPlay, IconScene, Menu, MenuItem, ToastOutlet } from "@vtt/ui";
import { focusTokenOnMap, openMapToolGroup } from "../scene/tableGeometry";
import { NowPlaying } from "../sound/NowPlaying";
import { tableStatus } from "./status";
import { TvControl } from "./TvControl";
import "./table-header.css";

type StagedScene = GmView["combat"]["scenes"][number];

/** What only the GM's header has: the scenes, the staged scene's way back or live, and the TV's preview. */
export type GmHeader = Readonly<{
  token: string;
  stagedScene: StagedScene | null;
  liveMapName: string | null;
  onPrepareScene: () => void;
  onViewAllScenes: () => void;
  onBackToLive: () => void;
  onMakeLive: (sceneId: string) => void;
  /** Opens the staged map's grid calibration; null when the map has its grid. */
  onSetGrid: ((mapId: string) => void) | null;
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
  const { state, gm } = props;
  const live = state.combat.scenes?.find((scene) => scene.id === state.combat.activeSceneId) ?? null;
  const staged = gm.stagedScene;
  const fog = staged ? staged.combat.fog : state.combat.fog;
  const vision = staged ? staged.combat.vision : state.combat.vision;
  return (
    <header className={`table-header${staged ? " is-staging" : ""}`} aria-label="The table">
      {staged ? (
        <span className="table-header-staging" role="group" aria-label="Staged scene">
          <span className="table-header-staged-name">
            <IconScene />
            <span>
              Staging <strong>{staged.name}</strong> · GM only
            </span>
          </span>
          {/* Back to live only when a scene is live to go back to. */}
          {live && (
            <Button variant="ghost" size="sm" onClick={gm.onBackToLive} title="Return to the scene players see">
              <IconChevronLeft />
              Back to live
            </Button>
          )}
          {/* Before Make live: a map without its grid lets tokens sit anywhere, off the squares. */}
          {gm.onSetGrid && (
            <Button variant="secondary" size="sm" onClick={() => gm.onSetGrid?.(staged.mapAssetId)}>
              Set the grid
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => gm.onMakeLive(staged.id)}>
            <IconPlay />
            Make live
          </Button>
        </span>
      ) : (
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
          <MenuItem onClick={gm.onViewAllScenes}>View all scenes</MenuItem>
          <MenuItem onClick={gm.onPrepareScene}>New scene…</MenuItem>
        </Menu>
      )}
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
    </header>
  );
}
