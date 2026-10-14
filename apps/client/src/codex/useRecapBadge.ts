import { useCallback, useEffect, useState } from "react";
import { playerCodexApi } from "./api";
import { socket } from "../socket";

/**
 * "There is a revealed recap you haven't seen" on the player's Open Codex button. Keyed on session ids,
 * never a timestamp: `updatedAt` isn't in the player projection, revealing doesn't move it, and editing
 * prep does, so a timestamp badge would leak GM activity. The list is already filtered by the server.
 */
const SEEN_KEY = "codex-seen-sessions";

function readSeen(): ReadonlySet<string> {
  // Storage access can throw in private mode; a badge is never worth failing a render.
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export type RecapBadge = Readonly<{
  /** Revealed sessions not yet seen. 0 renders nothing. */
  unread: number;
  /** Call when the player opens the Codex. */
  markSeen: () => void;
}>;

export function useRecapBadge(token: string | null): RecapBadge {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeen);

  useEffect(() => {
    if (!token) {
      setIds([]);
      return;
    }
    let live = true;
    // A failed read means no badge, never an error surface.
    const load = () => {
      void playerCodexApi
        .sessions(token)
        .then((sessions) => {
          if (live) setIds(sessions.map((session) => session.id));
        })
        .catch(() => undefined);
    };
    load();
    // Refresh on the shared ping so a recap revealed mid-session shows without a reload.
    socket.on("codex:changed", load);
    return () => {
      live = false;
      socket.off("codex:changed", load);
    };
  }, [token]);

  const markSeen = useCallback(() => {
    setSeen((prev) => {
      // Mark only what is visible now; a recap revealed while the Codex is open stays unread.
      const next = new Set([...prev, ...ids]);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode - fine */
      }
      return next;
    });
  }, [ids]);

  return { unread: ids.filter((id) => !seen.has(id)).length, markSeen };
}
