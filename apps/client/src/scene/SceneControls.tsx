import { Button, IconChevronLeft, IconPlay, IconScene, Menu, MenuItem } from "@vtt/ui";
import type { DockPosition } from "../encounter/DockPicker";

/**
 * The scene cluster in the map's bottom corner. While the GM arranges a staged scene it swaps for
 * "Back to live" and "Make live"; otherwise it is the Scenes button, or a menu naming the live scene
 * when there is somewhere else to go.
 */
export function SceneControls({
  staging,
  onScenePrep,
  onViewAllScenes,
  activeSceneName,
  dockPosition
}: Readonly<{
  staging?: Readonly<{ onBackToLive: () => void; onMakeLive: () => void }>;
  onScenePrep?: () => void;
  onViewAllScenes?: () => void;
  activeSceneName?: string;
  /** Where the tracker is docked over the map, which the cluster steps around. */
  dockPosition: DockPosition | null;
}>) {
  return (
    <div
      className={`encounter-map-zoom${dockPosition ? ` zoom-dock-${dockPosition}` : ""}`}
      role="group"
      aria-label="Scene controls"
    >
      {staging ? (
        <span className="encounter-map-scene-live" role="group" aria-label="Staged scene controls">
          <Button variant="ghost" size="sm" onClick={staging.onBackToLive} title="Return to the scene players see">
            <span className="map-button-icon" aria-hidden="true">
              <IconChevronLeft />
            </span>
            Back to live
          </Button>
          <Button variant="primary" size="sm" onClick={staging.onMakeLive} title="Make this the scene players see">
            <span className="map-button-icon" aria-hidden="true">
              <IconPlay />
            </span>
            Make live
          </Button>
        </span>
      ) : (
        onScenePrep &&
        (onViewAllScenes ? (
          /* The map's Scenes button is a menu holding both errands, and it names the live scene. */
          <Menu
            className="encounter-map-scene-menu"
            triggerClassName="encounter-map-scene-trigger"
            align="end"
            label={activeSceneName ? `Scenes — ${activeSceneName} is live` : "Scenes"}
            trigger={
              <>
                <span className="map-button-icon" aria-hidden="true">
                  <IconScene />
                </span>
                Scenes
              </>
            }
          >
            {activeSceneName && (
              <p className="encounter-map-scene-live-name">
                Live: <strong>{activeSceneName}</strong>
              </p>
            )}
            <MenuItem onClick={onViewAllScenes}>View all scenes</MenuItem>
            <MenuItem onClick={onScenePrep}>New scene…</MenuItem>
          </Menu>
        ) : (
          <Button variant="secondary" size="sm" title="Stage and switch scenes (GM only)" onClick={onScenePrep}>
            <span className="map-button-icon" aria-hidden="true">
              <IconScene />
            </span>
            Scenes
          </Button>
        ))
      )}
    </div>
  );
}
