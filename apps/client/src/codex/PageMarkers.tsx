import { useCallback } from "react";
import { Alert, HiddenFromPlayers, Skeleton } from "@vtt/ui";
import { codexApi } from "./api";
import { CodexIcon } from "./icons";
import { useCodexQuery } from "./useCodexQuery";

/**
 * Where this page sits on the atlas, via `GET /codex/pages/{id}/markers`. Renders what the server sends;
 * the GM projection includes `mapId`, so the jump can open the map and then select the pin.
 */
export function PageMarkers({
  gmToken,
  pageId,
  onOpenMarker
}: Readonly<{
  gmToken: string;
  pageId: string;
  /** The Atlas opens the map, then selects the pin. */
  onOpenMarker?: (markerId: string, mapId: string) => void;
}>) {
  // An empty list and a failed request must look different.
  const {
    data: markers = [],
    loading,
    error
  } = useCodexQuery(
    useCallback(() => codexApi.markersForPage(gmToken, pageId), [gmToken, pageId]),
    { failure: "Couldn't load this page's map pins." }
  );

  return (
    <div className="codex-connections-block">
      <h5 className="codex-connections-sub">On the atlas</h5>
      {loading && <Skeleton variant="text" />}
      {error && <Alert tone="danger">{error}</Alert>}
      {!loading && !error && markers.length === 0 && (
        <p className="codex-page-timeline-empty">No map pins link to this page yet.</p>
      )}
      {markers.length > 0 && (
        <ul className="codex-connections-list">
          {markers.map((marker) => (
            <li key={marker.id}>
              <button
                type="button"
                className="codex-connections-item"
                onClick={() => onOpenMarker?.(marker.id, marker.mapId)}
                disabled={!onOpenMarker}
              >
                <CodexIcon iconId="compass" className="codex-ent-icon" />
                <span className="codex-list-title">{marker.label?.trim() || "Unlabelled pin"}</span>
                {/* An unrevealed pin is exactly the one a GM forgets to reveal. */}
                {!marker.revealedToPlayers && <HiddenFromPlayers />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
