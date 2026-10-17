/**
 * Debounced autosave, shared in shape with the Codex page editor. Invariants:
 * 1. Skipped when the serialized draft already matches what the server holds.
 * 2. Single-flight: overlapping PATCHes would race the same `expectedRev` and 409 against each
 *    other. An edit during a save sets `dirtyRef` and re-runs on completion.
 * 3. Every PATCH carries `expectedRev`; a 409 resyncs the revision and settles on "conflict".
 * 4. Flushes on unmount, because the GM tab is conditionally mounted and a tab switch would
 *    otherwise drop the last edit. `onUnmountFlush` hears of that save, so a reader of the same row
 *    can wait for it.
 * 5. `flush` settles only when every save it covers has, including one already in flight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@vtt/ui";

export interface AutosaveConfig<T> {
  /** The live draft. Every change to it (by serialized value) schedules a save. */
  draft: T;
  /** The server revision the draft is known to match. Seed it from the record's `rev`. */
  rev: number;
  /**
   * What the server holds, when it differs from the draft at mount (the editor fills in
   * defaults on open). Opening a record must not write to it: only a change from the draft at
   * mount schedules a save, and that save carries the defaults with it. Omitted means the
   * draft is the baseline.
   */
  baseline?: T;
  /** PATCHes `draft` with `expectedRev` and resolves the row's new revision. */
  save: (draft: T, expectedRev: number) => Promise<number>;
  /** Re-reads the row after a 409 and resolves its current revision. */
  resync: () => Promise<number>;
  /** True when the rejection was optimistic concurrency (HTTP 409). */
  isConflict: (error: unknown) => boolean;
  /** ms after the last change. 800 matches the Codex. */
  delayMs?: number;
  /** Defaults to `JSON.stringify`. Override only if key order is unstable. */
  serialize?: (draft: T) => string;
  /** Given the save an unmount sends, which settles when it lands or fails. */
  onUnmountFlush?: (pending: Promise<void>) => void;
}

export interface Autosave<T> {
  status: SaveStatus;
  /** Publishing and the visibility toggle must await this first, so they never act on the
      pre-edit body. */
  flush: () => Promise<void>;
  /** `SaveState`'s "Retry": re-runs the failed PATCH. */
  retry: () => void;
  /** Adopt a server copy as the baseline after a publish, unpublish or visibility change (each
      bumps `rev`) or a conflict reload, so the next autosave does not 409. */
  markSaved: (rev: number, draft: T) => void;
  /** The body the server last held as far as this editor knows: what local edits are measured from. */
  savedDraft: () => T;
}

export function useAutosave<T>({
  draft,
  rev,
  baseline,
  save,
  resync,
  isConflict,
  delayMs = 800,
  serialize = (value) => JSON.stringify(value),
  onUnmountFlush
}: AutosaveConfig<T>): Autosave<T> {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const revRef = useRef(rev);
  /** What the server holds. Decides whether a PATCH has anything to send. */
  const savedRef = useRef(serialize(baseline === undefined ? draft : baseline));
  /** What the form showed when it opened; only a change from this schedules a save. */
  const openedRef = useRef(serialize(draft));
  const draftRef = useRef(draft);
  /** The draft the server holds, as a value; it starts as the form opened, defaults included. */
  const savedDraftRef = useRef(draft);
  /** The save cycle in flight, which a second flush waits on. */
  const cycleRef = useRef<Promise<void> | null>(null);
  const dirtyRef = useRef(false);
  draftRef.current = draft;

  // Callbacks, including the default `serialize` (a new arrow every render), are held in refs
  // so effects depend only on values. Otherwise the debounce restarts on every keystroke and the
  // unmount-flush cleanup fires on every render.
  const saveRef = useRef(save);
  const resyncRef = useRef(resync);
  const conflictRef = useRef(isConflict);
  const serializeRef = useRef(serialize);
  const unmountRef = useRef(onUnmountFlush);
  saveRef.current = save;
  resyncRef.current = resync;
  conflictRef.current = isConflict;
  serializeRef.current = serialize;
  unmountRef.current = onUnmountFlush;

  const flush = useCallback(async (): Promise<void> => {
    if (cycleRef.current) {
      // The cycle in flight runs again once it lands, and it settles after that run too.
      dirtyRef.current = true;
      return cycleRef.current;
    }
    const value = draftRef.current;
    const snapshot = serializeRef.current(value);
    if (snapshot === savedRef.current) return;
    const cycle = (async () => {
      setStatus("saving");
      try {
        const nextRev = await saveRef.current(value, revRef.current);
        // Record the pre-await snapshot so an edit made mid-flight stays dirty.
        savedRef.current = snapshot;
        openedRef.current = snapshot;
        savedDraftRef.current = value;
        revRef.current = nextRev;
        setStatus("saved");
      } catch (error) {
        if (conflictRef.current(error)) {
          try {
            revRef.current = await resyncRef.current();
          } catch {
            /* keep the stale revision; a later flush retries */
          }
          setStatus("conflict");
        } else {
          setStatus("error");
        }
      }
      cycleRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        await flush();
      }
    })();
    cycleRef.current = cycle;
    return cycle;
  }, []);

  // "dirty" is set synchronously on the first change. Compare against the draft at open, not
  // the server copy, so defaults filled in on open never trigger a write by themselves.
  useEffect(() => {
    if (serializeRef.current(draft) === openedRef.current) return;
    setStatus("dirty");
    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [draft, delayMs, flush]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      if (serializeRef.current(draftRef.current) !== openedRef.current || cycleRef.current)
        unmountRef.current?.(flushRef.current());
    },
    []
  );

  const retry = useCallback(() => void flushRef.current(), []);

  const markSaved = useCallback((nextRev: number, nextDraft: T) => {
    revRef.current = nextRev;
    // The server holds this body, and it is also the new unedited mark.
    savedRef.current = serializeRef.current(nextDraft);
    openedRef.current = savedRef.current;
    savedDraftRef.current = nextDraft;
    setStatus("saved");
  }, []);

  const savedDraft = useCallback(() => savedDraftRef.current, []);

  return { status, flush, retry, markSaved, savedDraft };
}

/**
 * A conflict's way back without losing work: the server's copy, with each top-level field this editor changed since
 * its last save (`base`) kept as this editor has it. A field changed on both sides takes this editor's value.
 */
export function keepLocalEdits<T extends Readonly<Record<string, unknown>>>(base: T, local: T, server: T): T {
  const merged: Record<string, unknown> = { ...server };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (JSON.stringify(local[key]) === JSON.stringify(base[key])) continue;
    if (key in local) merged[key] = local[key];
    else delete merged[key];
  }
  return merged as T;
}
