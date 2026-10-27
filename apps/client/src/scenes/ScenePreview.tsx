import { useEffect, useState } from "react";
import type { ScenePreviewReply } from "@vtt/domain";
import { read } from "../lib/command";
import { EncounterMap } from "../scene/EncounterMap";
import { useAuthorizedMapImage } from "../scene/mapImage";
import { MapStage, type Presentation } from "../viewer/ViewerApp";
import type { SceneFacts } from "./sceneFacts";

/** Who the GM is looking as: their own view, the table screen, or one party character's player. */
export type SeeAs = "gm" | "screen" | Readonly<{ actorId: string; name: string }>;

/**
 * What one audience receives of the scene if it went live now, drawn by the component that audience's device uses:
 * the table screen's map stage, or the map as that player's phone or laptop draws it. The server builds it from the
 * same projections as the real feeds (`encounter:preview`), and it is read again whenever the game changes.
 */
export function ScenePreview({
  facts,
  seeAs,
  token,
  revision
}: Readonly<{ facts: SceneFacts; seeAs: Exclude<SeeAs, "gm">; token: string; revision: number }>) {
  const actorId = seeAs === "screen" ? undefined : seeAs.actorId;
  const encounterId = facts.scene.id;
  const [reply, setReply] = useState<ScenePreviewReply | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void read("encounter:preview", { encounterId, ...(actorId ? { actorId } : {}) }).then((result) => {
      if (!active) return;
      if (result.ok && result.mapAssetId) {
        setReply(result as ScenePreviewReply);
        setFailure(null);
      } else setFailure(result.message ?? "The preview could not be read.");
    });
    return () => {
      active = false;
    };
  }, [encounterId, actorId, revision]);
  const image = useAuthorizedMapImage(seeAs === "screen" ? facts.scene.mapAssetId : null, token);

  if (failure)
    return (
      <p className="sc-preview-note" role="status">
        {failure}
      </p>
    );
  if (!reply || (reply.actorId ?? undefined) !== actorId)
    return (
      <p className="sc-preview-note" role="status">
        Reading the preview…
      </p>
    );
  if (reply.screen) {
    const presentation: Presentation = {
      schemaVersion: 1,
      revision,
      enabled: true,
      activeMap: { assetId: reply.mapAssetId, altText: facts.scene.name },
      camera: null,
      measurement: null,
      pings: [],
      initiative: reply.screen.initiative as unknown as Presentation["initiative"],
      encounter: reply.screen.encounter as unknown as Presentation["encounter"]
    };
    return (
      <div className="sc-preview-screen">
        <MapStage
          presentation={presentation}
          mapImageUrl={image.status === "ready" ? image.url : null}
          authToken={token}
        />
      </div>
    );
  }
  const player = reply.player!;
  return (
    <EncounterMap
      assetId={reply.mapAssetId}
      token={token}
      altText={`${facts.scene.name} as ${seeAs === "screen" ? "the table screen" : seeAs.name}'s player sees it`}
      role="player"
      actors={player.actors}
      tokens={player.combat.tokens}
      annotations={player.combat.annotations}
      revision={revision}
      activeActorId={player.combat.turnActorId}
      fog={player.combat.fog}
      terrain={player.combat.terrain}
      vision={player.combat.vision}
      readOnly
    />
  );
}
