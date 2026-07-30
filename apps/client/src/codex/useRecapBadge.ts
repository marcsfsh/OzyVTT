import { useCallback, useEffect, useState } from "react";
import { playerCodexApi } from "./api";
import { socket } from "../socket";

/**
 * CT-3: "there is a revealed session recap you have not read yet", on the player's Open Codex button.
 *
 * **It keys on session ID, never on a timestamp**, and the reasoning is the whole design:
 *
 *  - `updatedAt` is not in the player projection at all, so a player could not key on it if they wanted to.
 *  - Revealing deliberately does NOT move `updated_at` (the store's reveal-is-not-an-edit rule), so the
 *    one event this badge exists for — a recap becoming visible — would never have fired it.
 *  - `updated_at` DOES move when the GM edits `prep_body`. A timestamp badge would therefore light up on
 *    GM prep activity, which is exactly the thing a player must not be able to infer from the table.
 *
 * So the badge means what it says: the reader has a set of session ids they have already been shown, and
 * anything in the revealed list outside that set is new to them. `id` is one of the four keys the player
 * projection already sends, so this needs no projection change and leaks nothing new.
 *
 * The list itself is the server's — an unrevealed session is simply not in it — so there is no filtering
 * here and nothing this hook could get wrong about visibility.
 */
const SEEN_KEY = "codex-seen-sessions";

function readSeen(): ReadonlySet<string> {
  // Lazy read behind try/catch, the same discipline every other `codex-` key uses: private mode throws
  // on access, and a badge is never worth failing a render for.
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}

export type RecapBadge = Readonly<{
  /** How many revealed sessions this reader has not opened the Codex since seeing. 0 renders nothing. */
  unread: number;
  /** Call when the player opens the Codex: everything currently visible has now been offered to them. */
  markSeen: () => void;
}>;

export function useRecapBadge(token: string | null): RecapBadge {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeen);

  useEffect(() => {
    if (!token) { setIds([]); return; }
    let live = true;
    // A failed read means no badge, never an error surface: this hook hangs off a button on the table,
    // not off a Codex mode, and an Alert there would be about a feature the player has not opened yet.
    const load = () => { void playerCodexApi.sessions(token).then((sessions) => { if (live) setIds(sessions.map((session) => session.id)); }).catch(() => undefined); };
    load();
    // The same ping every Codex surface refreshes on — it is what makes a recap revealed mid-session
    // show up on the button without a reload.
    socket.on("codex:changed", load);
    return () => { live = false; socket.off("codex:changed", load); };
  }, [token]);

  const markSeen = useCallback(() => {
    setSeen((prev) => {
      // Only what is on screen NOW is marked. A session revealed while the Codex is open stays unread
      // until the player opens it again, which is the honest answer rather than a convenient one.
      const next = new Set([...prev, ...ids]);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next])); } catch { /* private mode - fine */ }
      return next;
    });
  }, [ids]);

  return { unread: ids.filter((id) => !seen.has(id)).length, markSeen };
}
