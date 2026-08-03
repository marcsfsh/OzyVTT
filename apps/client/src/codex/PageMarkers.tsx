import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, HiddenFromPlayers, Skeleton } from "@vtt/ui";
import { socket } from "../socket";
import { codexApi, type CodexMarker } from "./api";
import { CodexIcon } from "./icons";

/**
 * CI-4 (return edge): **where this page sits on the atlas.** The Atlas has always been able to say
 * "this pin is that page"; nothing could say the reverse, so from an open location page the only way to
 * find its pin was to remember which map it was on and go looking.
 *
 * Reads the reverse-lookup route (`GET /codex/pages/{id}/markers`), which projects rather than bypasses
 * — this component adds no filter of its own and could not: it renders whatever the server chose to
 * send. The GM projection carries `mapId`, which is what lets the jump name BOTH halves of its
 * destination (R1) instead of leaving the Atlas to hunt for the pin's map.
 */
export function PageMarkers({ gmToken, pageId, onOpenMarker }: Readonly<{
  gmToken: string;
  pageId: string;
  /** R1: the pin's map AND the pin — the Atlas opens the first, then selects the second. */
  onOpenMarker?: (markerId: string, mapId: string) => void;
}>) {
  const [markers, setMarkers] = useState<CodexMarker[]>([]);
  // R4: a fetch this small still needs both states — an empty list and a failed request look identical.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guarded on MOUNT, not per-call: `codex:changed` refreshes this list too, and a per-effect flag would
  // leave those refreshes writing state into an unmounted editor after the GM has navigated away.
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const load = useCallback(() => {
    void codexApi.markersForPage(gmToken, pageId)
      .then((rows) => { if (mountedRef.current) { setMarkers(rows); setError(null); } })
      .catch((loadError: unknown) => { if (mountedRef.current) setError(loadError instanceof Error ? loadError.message : "Couldn't load this page's map pins."); })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, [gmToken, pageId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const onChanged = () => load(); socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);

  return (
    <div className="codex-connections-block">
      <h5 className="codex-connections-sub">On the atlas</h5>
      {loading && <Skeleton variant="text" />}
      {error && <Alert tone="danger">{error}</Alert>}
      {!loading && !error && markers.length === 0 && <p className="codex-page-timeline-empty">No map pins link to this page yet.</p>}
      {markers.length > 0 && (
        <ul className="codex-connections-list">
          {markers.map((marker) => (
            <li key={marker.id}>
              <button type="button" className="codex-connections-item" onClick={() => onOpenMarker?.(marker.id, marker.mapId)} disabled={!onOpenMarker}>
                <CodexIcon iconId="compass" className="codex-ent-icon" />
                <span className="codex-list-title">{marker.label?.trim() || "Unlabelled pin"}</span>
                {/* R5: the one GM-only vocabulary. A pin the party cannot see is worth knowing about
                    from here — it is exactly the pin a GM forgets to reveal. */}
                {!marker.revealedToPlayers && <HiddenFromPlayers />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
