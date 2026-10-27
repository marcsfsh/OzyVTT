import { useEffect, useRef, useState } from "react";
import { IconX, useDragSurface } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import "./viewer-preview.css";

type Place = Readonly<{ x: number; y: number; width: number }>;
type DragGesture = Readonly<{ mode: "move" | "resize"; grabX: number; grabY: number; start: Place }>;

/** The table screen's own size. The preview draws the screen at this size and scales it, so it lays out as the TV. */
export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;
const MIN_WIDTH = 280;
const GUTTER = 16;

/** The top edge the panel keeps below: the app's top bar, so every section stays reachable while it is open. */
function topLimit(): number {
  const bar = document.querySelector(".app-bar")?.getBoundingClientRect().bottom ?? 0;
  return Math.round(bar) + 8;
}

/**
 * Where the panel opens: the top right corner under the tab bar and the table's header (whose TV menu opened it), no
 * wider than the window allows.
 */
function openingPlace(): Place {
  const header = document.querySelector(".table-header")?.getBoundingClientRect().bottom ?? 0;
  const width = Math.min(480, window.innerWidth - GUTTER * 2);
  return {
    x: Math.max(GUTTER, window.innerWidth - width - GUTTER),
    y: Math.max(topLimit(), Math.round(header) + 8),
    width
  };
}

/**
 * The GM's in-tab preview of the shared screen: mints a short-lived read-only viewer cookie and renders the real
 * `/viewer.html` in an iframe at a TV's size, scaled to the panel, so it lays out as the TV does. Resizing keeps the
 * screen's proportions. "Pop out" opens it in its own window.
 */
export function ViewerPreviewPanel({ gmToken, onClose }: Readonly<{ gmToken: string; onClose: () => void }>) {
  const [place, setPlace] = useState<Place>(openingPlace);
  const [drag, setDrag] = useState<DragGesture | null>(null);
  const [session, setSession] = useState<"pending" | "ready" | "error">("pending");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(place.width / SCREEN_WIDTH);
  const dragSurface = useDragSurface<HTMLDivElement>();

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

  // The stage's width sets the scale; its height follows from the screen's proportions in CSS.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setScale((stage.clientWidth || place.width) / SCREEN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [place.width]);

  const beginDrag = (mode: "move" | "resize") => (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode, grabX: event.clientX, grabY: event.clientY, start: place });
  };
  // Pointer capture is on the title bar or resize child, so gate on drag state.
  const continueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.grabX,
      dy = event.clientY - drag.grabY;
    if (drag.mode === "move")
      setPlace({
        ...drag.start,
        x: Math.max(0, drag.start.x + dx),
        y: Math.max(topLimit(), drag.start.y + dy)
      });
    else
      setPlace({
        ...drag.start,
        width: Math.max(Math.min(MIN_WIDTH, window.innerWidth - GUTTER * 2), drag.start.width + dx)
      });
  };
  const endDrag = () => setDrag(null);
  const popOut = () => {
    // `?preview`: the GM's copy shows what the table sees but stays silent; sound is the table screen's.
    window.open("/viewer.html?preview", "vtt-viewer-preview", `width=${SCREEN_WIDTH / 2},height=${SCREEN_HEIGHT / 2}`);
    onClose();
  };

  return (
    <div
      className="viewer-preview-panel"
      role="dialog"
      aria-label="Table screen preview"
      style={{ left: place.x, top: place.y, width: place.width }}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div ref={dragSurface} className="viewer-preview-titlebar" onPointerDown={beginDrag("move")}>
        <strong>Table screen</strong>
        <span className="viewer-preview-hint">What the screen shows</span>
        <button type="button" className="viewer-preview-action tap-target" onClick={popOut}>
          Pop out
        </button>
        <button
          type="button"
          className="viewer-preview-close tap-target"
          aria-label="Close the preview"
          onClick={onClose}
        >
          <IconX />
        </button>
      </div>
      <div ref={stageRef} className="viewer-preview-body">
        {session === "error" ? (
          <p className="viewer-preview-empty">Couldn't start the preview. Sign in as GM and try again.</p>
        ) : session === "pending" ? (
          <p className="viewer-preview-empty">Starting the preview…</p>
        ) : (
          <iframe
            className="viewer-preview-frame"
            src="/viewer.html?preview"
            title="Live preview of the table screen"
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            style={{ transform: `scale(${scale})` }}
          />
        )}
        {/* Keeps the iframe from capturing pointer events while dragging. */}
        {drag && <div className="viewer-preview-dragmask" aria-hidden="true" />}
      </div>
      <div ref={dragSurface} className="viewer-preview-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
    </div>
  );
}
