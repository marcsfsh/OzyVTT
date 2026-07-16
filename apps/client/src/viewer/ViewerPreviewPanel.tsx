import { useEffect, useState } from "react";
import { Initiative, MapStage, type Presentation } from "./ViewerApp";
import "./viewer-preview.css";

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
type DragGesture = Readonly<{ mode: "move" | "resize"; grabX: number; grabY: number; startRect: Rect }>;
type ConnectionStatus = "connecting" | "live" | "reconnecting";

const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;
const RETRY_DELAY_MS = 2_000;

/**
 * Subscribes the GM's own session to the exact live presentation the paired TV shows. EventSource
 * cannot carry a bearer header, so this reads the same `/api/v1/viewer/events` SSE stream by hand
 * via `fetch` (which can), parsing `event: presentation` frames itself; on a dropped connection it
 * retries after a short delay, mirroring the standalone viewer's own reconnect behavior.
 */
function useGmViewerPreview(gmToken: string) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function run() {
      if (cancelled) return;
      setStatus((current) => current === "live" ? "reconnecting" : "connecting");
      try {
        const snapshot = await fetch("/api/v1/viewer/presentation", { headers: { authorization: `Bearer ${gmToken}` } });
        if (snapshot.ok && !cancelled) setPresentation((await snapshot.json()).presentation);
      } catch { /* the stream below will retry regardless */ }

      controller = new AbortController();
      try {
        const response = await fetch("/api/v1/viewer/events", { headers: { authorization: `Bearer ${gmToken}` }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("The viewer stream is unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
            if (dataLine && !cancelled) { setPresentation(JSON.parse(dataLine.slice(6))); setStatus("live"); }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch { /* aborted on cleanup, or the connection dropped — either way fall through to retry */ }
      if (!cancelled) retryTimer = setTimeout(run, RETRY_DELAY_MS);
    }
    void run();
    return () => { cancelled = true; controller?.abort(); if (retryTimer) clearTimeout(retryTimer); };
  }, [gmToken]);

  return { presentation, status };
}

export function ViewerPreviewPanel({ gmToken, onClose }: Readonly<{ gmToken: string; onClose: () => void }>) {
  const [rect, setRect] = useState<Rect>({ x: 16, y: 16, width: 440, height: 320 });
  const [drag, setDrag] = useState<DragGesture | null>(null);
  const { presentation, status } = useGmViewerPreview(gmToken);

  const beginDrag = (mode: "move" | "resize") => (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode, grabX: event.clientX, grabY: event.clientY, startRect: rect });
  };
  const continueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - drag.grabX, dy = event.clientY - drag.grabY;
    if (drag.mode === "move") setRect({ ...drag.startRect, x: Math.max(0, drag.startRect.x + dx), y: Math.max(0, drag.startRect.y + dy) });
    else setRect({ ...drag.startRect, width: Math.max(MIN_WIDTH, drag.startRect.width + dx), height: Math.max(MIN_HEIGHT, drag.startRect.height + dy) });
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDrag(null); };

  return <div className="viewer-preview-panel" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <div className="viewer-preview-titlebar" onPointerDown={beginDrag("move")}>
      <strong>Viewer preview</strong>
      <span className={`viewer-preview-status ${status}`}>{status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Reconnecting…"}</span>
      <button type="button" className="viewer-preview-close" aria-label="Close viewer preview" onClick={onClose}>×</button>
    </div>
    <div className="viewer-preview-body">
      {presentation ? (presentation.enabled ? <>
        <MapStage presentation={presentation} />
        <Initiative presentation={presentation} />
      </> : <p className="viewer-preview-empty">Presentation is paused.</p>) : <p className="viewer-preview-empty">Connecting…</p>}
    </div>
    <div className="viewer-preview-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
  </div>;
}
