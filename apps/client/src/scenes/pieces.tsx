import { useEffect, useState } from "react";
import { Badge, Button, Drawer, IconEye, IconEyeOff, IconPlay, IconScene, cx } from "@vtt/ui";
import { useCachedMapThumbnail } from "../scene/mapImage";
import { useScenes } from "./context";
import { pathForScene, SCENES_PATHS } from "./routes";
import { tokensLine, factsOf, STATE_LABEL, type SceneFacts } from "./sceneFacts";

/** A scene's map art, cover-cropped; a glyph while it loads or when it cannot be drawn. */
export function MapThumb({ mapAssetId, className }: Readonly<{ mapAssetId: string; className?: string }>) {
  const { token } = useScenes();
  const url = useCachedMapThumbnail(mapAssetId, token);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span className={cx("sc-thumb", className)} aria-hidden="true">
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <IconScene />}
    </span>
  );
}

/** The scene's state as a chip: Live in the sun's tone, the rest quiet. */
export function StateChip({ facts }: Readonly<{ facts: SceneFacts }>) {
  return (
    <span className={cx("sc-state", `is-${facts.state}`)}>
      {facts.live && <IconPlay />}
      {STATE_LABEL[facts.state]}
    </span>
  );
}

/** Who sees a record at the table, in words under its mark: everyone once it is live, otherwise nobody but the GM. */
export function WhoSees({ shown }: Readonly<{ shown: boolean }>) {
  return shown ? (
    <Badge tone="info" className="sc-who">
      <IconEye /> Shown to players
    </Badge>
  ) : (
    <Badge tone="violet" className="sc-who">
      <IconEyeOff /> Hidden from players
    </Badge>
  );
}

/** The list the scene came from, folded into a flyout the GM can open again; a row opens that scene. */
export function SceneListFlyout({
  open,
  onClose,
  currentId
}: Readonly<{ open: boolean; onClose: () => void; currentId: string | null }>) {
  const { state, maps, go } = useScenes();
  return (
    <Drawer open={open} onClose={onClose} side="left" title="Encounters" className="sc-flyout">
      <ul className="sc-rows">
        {state.combat.encounters.map((scene) => {
          const facts = factsOf(state, scene, maps);
          return (
            <li key={scene.id}>
              <button
                type="button"
                className={cx("sc-row", scene.id === currentId && "is-current")}
                aria-current={scene.id === currentId ? "page" : undefined}
                onClick={() => {
                  onClose();
                  go(pathForScene(scene.id));
                }}
              >
                <MapThumb mapAssetId={scene.mapAssetId} />
                <span className="sc-row-main">
                  <strong>{scene.name}</strong>
                  <small>
                    {STATE_LABEL[facts.state]} · {tokensLine(facts)}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button onClick={() => go(SCENES_PATHS.list)}>All encounters</Button>
    </Drawer>
  );
}
