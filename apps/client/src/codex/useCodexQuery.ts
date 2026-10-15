import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { socket } from "../socket";

export type CodexQuery<T> = Readonly<{
  /** The latest answer, kept while a newer read is in flight. */
  data: T | undefined;
  /** True until the current `load` has answered once, so an empty list is not mistaken for a settled one. */
  loading: boolean;
  /** The current `load`'s last failure, cleared by its next success. */
  error: string | null;
  /** Reads again and resolves once that read has settled. */
  reload: () => Promise<void>;
  /** An optimistic local edit; the next read replaces it. */
  setData: Dispatch<SetStateAction<T | undefined>>;
}>;

/**
 * One Codex read. Runs `load`, runs it again on every `codex:changed` ping (unless `live` is false), and
 * drops an answer that a newer read or an unmount has overtaken. `load` must be stable (`useCallback`):
 * a new function is a new read. `null` reads nothing and keeps the last answer.
 */
export function useCodexQuery<T>(
  load: (() => Promise<T>) | null,
  options: Readonly<{ failure?: string; live?: boolean }> = {}
): CodexQuery<T> {
  const { failure = "Couldn't load this.", live = true } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  /** Which `load` last answered, so a new one reads as loading and an old error doesn't outlive it. */
  const [settled, setSettled] = useState<Readonly<{ load: () => Promise<T>; error: string | null }> | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!load) return;
    const ticket = ++latest.current;
    try {
      const next = await load();
      if (ticket !== latest.current) return;
      setData(next);
      setSettled({ load, error: null });
    } catch (cause) {
      if (ticket !== latest.current) return;
      setSettled({ load, error: cause instanceof Error ? cause.message : failure });
    }
  }, [load, failure]);

  useEffect(() => {
    if (!load) return;
    void reload();
    const onChanged = () => void reload();
    if (live) socket.on("codex:changed", onChanged);
    return () => {
      // Anything still in flight belongs to a read this component no longer wants.
      latest.current += 1;
      if (live) socket.off("codex:changed", onChanged);
    };
  }, [load, live, reload]);

  const current = load !== null && settled?.load === load;
  return { data, loading: load !== null && !current, error: current ? settled.error : null, reload, setData };
}
