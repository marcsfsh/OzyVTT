import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, HiddenFromPlayers, Skeleton } from "@vtt/ui";
import { socket } from "../socket";
import { codexApi, type CodexMarker } from "./api";
import { CodexIcon } from "./icons";

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
  const [markers, setMarkers] = useState<CodexMarker[]>([]);
  // An empty list and a failed request must look different.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guarded on mount, not per call: `codex:changed` refreshes can resolve after the editor unmounts.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const load = useCallback(() => {
    void codexApi
      .markersForPage(gmToken, pageId)
      .then((rows) => {
        if (mountedRef.current) {
          setMarkers(rows);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (mountedRef.current)
          setError(loadError instanceof Error ? loadError.message : "Couldn't load this page's map pins.");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [gmToken, pageId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const onChanged = () => load();
    socket.on("codex:changed", onChanged);
    return () => {
      socket.off("codex:changed", onChanged);
    };
  }, [load]);

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
