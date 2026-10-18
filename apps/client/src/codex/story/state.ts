import { useCallback, useEffect, useMemo, useState } from "react";

/** A write's failure, shown until the feed it changed answers again. */
export function useActionError(fresh: unknown) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [fresh]);
  return [error, setError] as const;
}

const READ_KEY = "codex-read-recaps";

function readIds(): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(READ_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Which shared recaps this device has not opened yet, so a new one says New. Kept by session id, never by a time: a
 * player's sessions carry no time the GM's work could move.
 */
export function useReadRecaps(sessions: ReadonlyArray<Readonly<{ id: string }>>) {
  const [read, setRead] = useState<ReadonlySet<string>>(readIds);
  const unseen = useMemo(
    () => new Set(sessions.map((session) => session.id).filter((id) => !read.has(id))),
    [sessions, read]
  );
  const markRead = useCallback((id: string) => {
    setRead((prev) => {
      const next = new Set([...prev, id]);
      try {
        localStorage.setItem(READ_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode: the mark lasts until the page closes */
      }
      return next;
    });
  }, []);
  return { unseen, markRead };
}
