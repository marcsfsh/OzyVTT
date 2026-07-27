/**
 * Park-as-you-type autosave, lifted from `codex/PageEditor.tsx:94-164` and made
 * reusable so the two GM authoring surfaces cannot drift apart.
 *
 * Four properties, each of which is load-bearing:
 *
 * 1. **Debounced (~800ms) and guarded by a serialized snapshot.** No PATCH is sent
 *    for an edit that lands the draft back where the server already has it.
 * 2. **Serialized single-flight.** Only ever ONE PATCH in flight. Overlapping saves
 *    race the same `expectedRev` and 409 against *themselves*, then wedge the editor
 *    (the revision never resyncs). A fresh edit mid-save sets `dirtyRef` and re-runs
 *    on completion.
 * 3. **Every PATCH carries `expectedRev`.** A 409 resyncs the revision from the
 *    server and settles on `"conflict"`, so the next edit saves cleanly instead of
 *    409ing forever.
 * 4. **Flush on unmount.** The GM tab is conditionally mounted (`main.tsx`), so a tab
 *    switch destroys the panel — the debounce timer alone would silently drop the
 *    last edit. `flushRef` holds the latest closure so the cleanup runs exactly once.
 *
 * The status it reports is `SaveStatus` from `@vtt/ui`, which fixes the three things
 * the hand-rolled Codex readout got wrong: `idle` and `saved` both read **Saved** (a
 * real resting state), the readout pairs a glyph with a word (never colour alone),
 * and the two states that need an action get one (Reload / Retry).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@vtt/ui";

export interface AutosaveConfig<T> {
  /** The live draft. Every change to it (by serialized value) schedules a save. */
  draft: T;
  /** The server revision the draft is known to match. Seed it from the record's `rev`. */
  rev: number;
  /**
   * What the server actually holds, when that differs from the draft at mount.
   *
   * The homebrew editor fills a record with sensible defaults on the way in
   * (`withDefaults`), so a blank spell shows level 1 / evocation / 60 feet the moment it
   * opens. Baselining on `draft` would treat all of that as already saved and never send
   * it: the form would show eight filled fields the server had never heard of, and the
   * record would refuse to publish for reasons visibly contradicted by the screen.
   * Passing the stored record here makes the filled-in defaults dirty, so they park on
   * the first debounce. Omit it and the baseline is `draft`, as before.
   */
  baseline?: T;
  /** PATCHes `draft` with `expectedRev` and resolves the row's NEW revision. */
  save: (draft: T, expectedRev: number) => Promise<number>;
  /** Re-reads the row after a 409 and resolves its current revision. */
  resync: () => Promise<number>;
  /** True when the rejection was optimistic concurrency (HTTP 409). */
  isConflict: (error: unknown) => boolean;
  /** ms after the last keystroke. 800 matches the Codex; do not diverge without a reason. */
  delayMs?: number;
  /** Defaults to `JSON.stringify`. Override only if key order is unstable. */
  serialize?: (draft: T) => string;
}

export interface Autosave<T> {
  status: SaveStatus;
  /** Awaitable. Publishing and the visibility toggle MUST await this first, so revealing
      never briefly publishes the pre-edit body — the Codex's `toggleReveal` rule. */
  flush: () => Promise<void>;
  /** `SaveState`'s "Retry" — re-runs the failed PATCH. */
  retry: () => void;
  /**
   * Adopt a server copy as the new baseline: after a publish / unpublish / visibility
   * change (each of which bumps `rev` server-side), or after the caller reloads a
   * conflicted record. Without this the very next autosave would 409 against a
   * revision the row left behind.
   */
  markSaved: (rev: number, draft: T) => void;
}

export function useAutosave<T>({
  draft,
  rev,
  baseline,
  save,
  resync,
  isConflict,
  delayMs = 800,
  serialize = (value) => JSON.stringify(value)
}: AutosaveConfig<T>): Autosave<T> {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const revRef = useRef(rev);
  const savedRef = useRef(serialize(baseline === undefined ? draft : baseline));
  const draftRef = useRef(draft);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  draftRef.current = draft;

  // Keep the mutable callbacks out of `flush`'s dependency list: a caller that passes
  // inline arrows (the normal case) would otherwise rebuild `flush` every render and
  // restart the debounce timer on each keystroke, so the save would never fire.
  //
  // `serialize` is held the same way and for a sharper reason: its DEFAULT is an
  // inline arrow, so it has a new identity on every render. Listing it as a dependency
  // made the unmount-flush effect below re-run every render — and an effect that
  // re-runs runs its CLEANUP first, so the "flush on unmount" guard fired on every
  // keystroke. Measured: 13 PATCHes for a 12-character rename, racing each other into
  // a 409. Every effect here therefore depends on values, never on callbacks.
  const saveRef = useRef(save);
  const resyncRef = useRef(resync);
  const conflictRef = useRef(isConflict);
  const serializeRef = useRef(serialize);
  saveRef.current = save;
  resyncRef.current = resync;
  conflictRef.current = isConflict;
  serializeRef.current = serialize;

  const flush = useCallback(async () => {
    if (savingRef.current) {
      dirtyRef.current = true;
      return;
    }
    const snapshot = serializeRef.current(draftRef.current);
    if (snapshot === savedRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      const nextRev = await saveRef.current(draftRef.current, revRef.current);
      // The snapshot taken BEFORE the await, not the draft now: an edit that landed
      // mid-flight must stay dirty, and `dirtyRef` below re-runs for it.
      savedRef.current = snapshot;
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
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        void flush();
      }
    }
  }, []);

  // Debounce. `dirty` is set synchronously so the readout says "Unsaved changes" from
  // the first keystroke rather than sitting on "Saved" for 800ms, which is the one
  // window in which the GM might close the tab believing their work is parked.
  useEffect(() => {
    if (serializeRef.current(draft) === savedRef.current) return;
    setStatus("dirty");
    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [draft, delayMs, flush]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      if (serializeRef.current(draftRef.current) !== savedRef.current) void flushRef.current();
    },
    []
  );

  const retry = useCallback(() => void flushRef.current(), []);

  const markSaved = useCallback((nextRev: number, nextDraft: T) => {
    revRef.current = nextRev;
    savedRef.current = serializeRef.current(nextDraft);
    setStatus("saved");
  }, []);

  return { status, flush, retry, markSaved };
}
