import { useEffect, useRef, useState } from "react";
import { IconX } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import "./viewer-preview.css";

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
type DragGesture = Readonly<{ mode: "move" | "resize"; grabX: number; grabY: number; startRect: Rect }>;

const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;

/**
 * The GM's in-tab preview of the shared screen: mints a short-lived read-only viewer cookie and
 * renders the real `/viewer.html` in an iframe, so it matches the TV exactly. "Pop out" opens it in
 * its own window.
 */
export function ViewerPreviewPanel({ gmToken, onClose }: Readonly<{ gmToken: string; onClose: () => void }>) {
  const [rect, setRect] = useState<Rect>({ x: 16, y: 16, width: 460, height: 340 });
  const [drag, setDrag] = useState<DragGesture | null>(null);
  const [session, setSession] = useState<"pending" | "ready" | "error">("pending");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Set the preview cookie before loading the iframe, so it authenticates without pairing.
  useEffect(() => {
    let cancelled = false;
    apiRequest("/api/v1/viewer/preview-session", { token: gmToken, method: "POST" })
      .then(() => {
        if (!cancelled) setSession("ready");
      })
      .catch(() => {
        if (!cancelled) setSession("error");
      });
    return () => {
      cancelled = true;
    };
  }, [gmToken]);

  const beginDrag = (mode: "move" | "resize") => (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode, grabX: event.clientX, grabY: event.clientY, startRect: rect });
  };
  // Pointer capture is on the title bar or resize child, so gate on drag state.
  const continueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.grabX,
      dy = event.clientY - drag.grabY;
    if (drag.mode === "move")
      setRect({ ...drag.startRect, x: Math.max(0, drag.startRect.x + dx), y: Math.max(0, drag.startRect.y + dy) });
    else
      setRect({
        ...drag.startRect,
        width: Math.max(MIN_WIDTH, drag.startRect.width + dx),
        height: Math.max(MIN_HEIGHT, drag.startRect.height + dy)
      });
  };
  const endDrag = () => setDrag(null);
  const popOut = () => {
    // `?preview`: the GM's copy shows what the table sees but stays silent; sound is the table screen's.
    window.open("/viewer.html?preview", "vtt-viewer-preview", "width=1280,height=720");
    onClose();
  };

  return (
    <div
      className="viewer-preview-panel"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="viewer-preview-titlebar" onPointerDown={beginDrag("move")}>
        <strong>Viewer preview</strong>
        <span className="viewer-preview-hint">What players see</span>
        <button type="button" className="viewer-preview-action" onClick={popOut}>
          Pop out
        </button>
        <button
          type="button"
          className="viewer-preview-close tap-target"
          aria-label="Close viewer preview"
          onClick={onClose}
        >
          <IconX />
        </button>
      </div>
      <div className="viewer-preview-body">
        {session === "error" ? (
          <p className="viewer-preview-empty">Couldn't start the preview. Sign in as GM and try again.</p>
        ) : session === "pending" ? (
          <p className="viewer-preview-empty">Starting preview…</p>
        ) : (
          <iframe
            ref={iframeRef}
            className="viewer-preview-frame"
            src="/viewer.html?preview"
            title="Live viewer preview"
          />
        )}
        {/* Keeps the iframe from capturing pointer events while dragging. */}
        {drag && <div className="viewer-preview-dragmask" aria-hidden="true" />}
      </div>
      <div className="viewer-preview-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
    </div>
  );
}
