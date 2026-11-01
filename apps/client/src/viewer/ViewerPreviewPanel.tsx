import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton, IconPause, IconPopOut, IconX, StatusLamp, useDragSurface, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { newId } from "../lib/ids";
import { useMediaQuery } from "../lib/useMediaQuery";
import { navigate, pathForGmTab } from "../router";
import "./viewer-preview.css";

/** The table screen's own size. The preview draws the screen at this size and scales it, so it lays out as the TV. */
export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;

type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";
const CORNERS: readonly Corner[] = ["bottom-right", "bottom-left", "top-right", "top-left"];
const CORNER_KEY = "vtt.preview-corner";
const TOLD_KEY = "vtt.preview-told";

const readCorner = (): Corner => {
  try {
    const stored = localStorage.getItem(CORNER_KEY) as Corner | null;
    return stored && CORNERS.includes(stored) ? stored : "bottom-right";
  } catch {
    return "bottom-right";
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the preview still works, it just won't remember */
  }
};

type Presentation = Readonly<{ revision: number; enabled: boolean; activeMap: unknown }>;

/**
 * The GM's preview of the table screen, docked as a picture in picture (table screen spec 2.4, ADR-0056): a bar with the
 * lamp, Table screen and ON, Pause, Pop out and Close, over the real `/viewer.html` drawn at a TV's size and scaled to
 * the dock. It stays on every page until closed and moves to the corner it is dragged towards. A short-lived read-only
 * viewer cookie lets the frame in without pairing.
 */
export function ViewerPreviewPanel({ gmToken, onClose }: Readonly<{ gmToken: string; onClose: () => void }>) {
  const phone = useMediaQuery("(max-width: 760px)");
  const width = phone ? 250 : 420;
  const [corner, setCorner] = useState<Corner>(readCorner);
  const [dragging, setDragging] = useState(false);
  const [session, setSession] = useState<"pending" | "ready" | "error">("pending");
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const dragSurface = useDragSurface<HTMLDivElement>();
  const { toast } = useToast();
  const told = useRef(false);

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

  // The first time it docks it says where it stays, once on this device.
  useEffect(() => {
    if (told.current) return;
    told.current = true;
    let seen: boolean;
    try {
      seen = localStorage.getItem(TOLD_KEY) === "1";
    } catch {
      seen = true;
    }
    if (seen) return;
    remember(TOLD_KEY, "1");
    toast("The preview stays here on every page. Drag it to another corner.");
  }, [toast]);

  // The lamp and Pause read what the screen shows.
  const read = useCallback(
    () =>
      apiRequest<{ presentation: Presentation }>("/api/v1/viewer/presentation", { token: gmToken })
        .then((answer) => setPresentation(answer.presentation))
        .catch(() => undefined),
    [gmToken]
  );
  useEffect(() => {
    void read();
    const interval = window.setInterval(() => void read(), 5_000);
    return () => window.clearInterval(interval);
  }, [read]);
  const on = Boolean(presentation?.enabled && presentation.activeMap);
  const pause = async () => {
    if (!presentation) return;
    try {
      await apiRequest("/api/v1/viewer/presentation/commands", {
        token: gmToken,
        body: {
          id: newId(),
          expectedRevision: presentation.revision,
          payload: { type: "viewer.enabled.set", enabled: false }
        }
      });
      await read();
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    }
  };

  // A drag ends at the nearest corner.
  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    setDragging(false);
    const right = event.clientX > window.innerWidth / 2;
    const bottom = event.clientY > window.innerHeight / 2;
    const next: Corner = `${bottom ? "bottom" : "top"}-${right ? "right" : "left"}`;
    setCorner(next);
    remember(CORNER_KEY, next);
  };
  const popOut = () => {
    // `?preview`: the GM's copy shows what the table sees but stays silent; sound is the table screen's.
    window.open("/viewer.html?preview", "vtt-viewer-preview", `width=${SCREEN_WIDTH / 2},height=${SCREEN_HEIGHT / 2}`);
    onClose();
  };
  const scale = width / SCREEN_WIDTH;

  return (
    <div
      className={`viewer-preview-panel is-${corner}`}
      role="dialog"
      aria-label="Table screen preview"
      style={{ width }}
    >
      <div
        ref={dragSurface}
        className="viewer-preview-titlebar"
        onPointerDown={beginDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDragging(false)}
      >
        <StatusLamp lit={on} />
        <strong>Table screen</strong>
        <span className="viewer-preview-state">{on ? "ON" : "OFF"}</span>
        <span className="viewer-preview-grow" />
        <IconButton label="Pause the table screen" size="sm" disabled={!on} onClick={() => void pause()}>
          <IconPause />
        </IconButton>
        {!phone && (
          <IconButton label="Pop out" size="sm" onClick={popOut}>
            <IconPopOut />
          </IconButton>
        )}
        <IconButton label="Close the preview" size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>
      <div className="viewer-preview-body" style={{ height: Math.round(SCREEN_HEIGHT * scale) }}>
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
        {phone && (
          <button
            type="button"
            className="viewer-preview-open"
            aria-label="Open the table screen page"
            onClick={() => navigate(pathForGmTab("viewer"))}
          />
        )}
        {/* Keeps the iframe from capturing pointer events while dragging. */}
        {dragging && <div className="viewer-preview-dragmask" aria-hidden="true" />}
      </div>
    </div>
  );
}
