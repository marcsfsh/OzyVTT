import { IconCheck, StatusLamp, cx } from "@vtt/ui";
import { useScenes } from "./context";
import { MapThumb } from "./pieces";
import { pathForScene } from "./routes";
import { factsOf, readinessOf, READINESS_LABEL, STATE_LABEL, type Readiness } from "./sceneFacts";

/** A scene's status as the list shows it: the Live lamp, Ready's tick, a caution word, or Draft. */
function ReadinessLine({ readiness }: Readonly<{ readiness: Readiness }>) {
  return (
    <span className={cx("sc-readiness", `is-${readiness}`)}>
      {readiness === "live" && <StatusLamp lit />}
      {readiness === "ready" && <IconCheck />}
      {READINESS_LABEL[readiness]}
    </span>
  );
}

/**
 * Prep's scenes down the left of a scene's page on a laptop: each with its map, its name and whether it is ready to
 * go. A parked fight or a replay says so beside its readiness. A row opens that scene.
 */
export function SceneListColumn({ currentId }: Readonly<{ currentId: string }>) {
  const { state, maps, go } = useScenes();
  return (
    <nav className="sc-list-col scroll-y" aria-label="Scenes">
      <h2 className="sc-list-col-title">Scenes</h2>
      <ul className="sc-list-col-rows">
        {state.combat.scenes.map((scene) => {
          const facts = factsOf(state, scene, maps);
          const readiness = readinessOf(facts, maps);
          return (
            <li key={scene.id}>
              <button
                type="button"
                className={cx("sc-list-col-row", "interactive", scene.id === currentId && "is-current")}
                aria-current={scene.id === currentId ? "page" : undefined}
                onClick={() => go(pathForScene(scene.id))}
              >
                <MapThumb mapAssetId={scene.mapAssetId} className="sc-list-col-thumb" />
                <span className="sc-list-col-text">
                  <b>{scene.name}</b>
                  <span className="sc-list-col-state">
                    <ReadinessLine readiness={readiness} />
                    {(facts.state === "parked" || facts.state === "replay") && (
                      <span className="sc-list-col-extra">{STATE_LABEL[facts.state]}</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
