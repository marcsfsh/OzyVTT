import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerSoundProjection } from "@vtt/domain";
import { IconVolumeOff } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { TableSoundEngine, type SoundEngineStatus } from "./sound-engine";

const STATUS_PATH = "/api/v1/viewer/sound-status";

/** The GM's preview of the table screen (`?preview`) shows what the table sees but never plays: sound belongs to
 *  the table screen alone. */
export const isPreviewScreen = () => new URLSearchParams(window.location.search).has("preview");

/**
 * The table screen's sound: an engine following the feed, the "Tap to turn on sound" control while the browser is
 * holding sound back, and a report to the GM of which of the two this screen is in.
 */
export function TableSound({
  sound,
  receivedAt,
  live
}: Readonly<{ sound: ViewerSoundProjection | undefined; receivedAt: number; live: boolean }>) {
  const preview = useMemo(isPreviewScreen, []);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<TableSoundEngine | null>(null);
  // Null until the engine has looked at what the browser allows, so nothing is reported before then.
  const [status, setStatus] = useState<SoundEngineStatus | "muted" | null>(preview ? "muted" : null);
  const [unplayable, setUnplayable] = useState<readonly string[]>([]);
  // Reports go one after another, so the server can't hear an older one last.
  const reporting = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const host = hostRef.current;
    if (preview || !host) return;
    const engine = new TableSoundEngine({
      host,
      createElement: () => document.createElement("audio"),
      createContext: () => (typeof AudioContext === "function" ? new AudioContext() : null),
      now: () => performance.now(),
      src: (assetId) => `/api/v1/sound-assets/${encodeURIComponent(assetId)}/content`,
      onStatus: setStatus,
      onUnplayable: setUnplayable
    });
    engineRef.current = engine;
    setStatus(engine.currentStatus);
    // Any touch or key on the screen counts as the interaction the browser waits for, beyond the button itself.
    const unlock = () => {
      if (engine.currentStatus === "blocked") engine.unlock();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      engine.dispose();
      engineRef.current = null;
    };
  }, [preview]);

  useEffect(() => {
    if (sound) engineRef.current?.apply(sound, receivedAt);
  }, [sound, receivedAt]);

  // The GM's board shows whether this screen plays or waits for a tap; said again on every reconnection, since
  // the server forgets it when it restarts.
  useEffect(() => {
    if (!live || status === null) return;
    const body = { sound: status, unplayable };
    reporting.current = reporting.current.then(() => apiRequest(STATUS_PATH, { body }).catch(() => {}));
  }, [status, unplayable, live]);

  const waiting = Boolean(sound && (sound.music || sound.ambient.length || sound.effects.length));
  return (
    <>
      <div ref={hostRef} className="viewer-sound-host" hidden />
      {status === "blocked" && (
        <button
          type="button"
          className={`viewer-sound-unlock${waiting ? " waiting" : ""}`}
          onClick={() => engineRef.current?.unlock()}
        >
          <IconVolumeOff />
          Tap to turn on sound
        </button>
      )}
    </>
  );
}
