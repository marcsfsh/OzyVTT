import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@vtt/ui";
import { CodexRequestError, type CodexAutosaveSettings } from "./api";
import { registerNavigationGuard } from "../router";

/**
 * The Codex's one autosave behaviour. On: save `intervalSeconds` after the last edit and flush on unmount.
 * Off: no timer; `dirty` drives an explicit Save, a navigation guard and a `beforeunload` handler.
 *
 * Saves are serialized (one write in flight): overlapping saves would race the same `expectedRev` and 409
 * against themselves. An edit made mid-save re-runs on completion.
 *
 * Discrete acts (reveal switches, "Make active", the party pin, list-row status selects, settings switches)
 * stay immediate, and creating a new journal entry stays an explicit Add.
 */
export type UseCodexAutosaveOptions<TDraft> = Readonly<{
  settings: CodexAutosaveSettings;
  draft: TDraft;
  /** How the draft is compared for dirtiness. Defaults to `JSON.stringify`. */
  serialize?: (draft: TDraft) => string;
  /** Write the draft. Resolve on success; throw to fail. A 409 becomes the "conflict" state. */
  save: (draft: TDraft) => Promise<void>;
  /** Ran after a 409, so the caller can resync its `expectedRev` before the next attempt. */
  onConflict?: () => void | Promise<void>;
  /** Skip everything (no timer, no guard), for an editor with nothing to save yet. */
  disabled?: boolean;
}>;

export type CodexAutosave<TDraft> = Readonly<{
  status: SaveStatus;
  dirty: boolean;
  /** Save now, ignoring the debounce. The explicit Save button calls this when autosave is off. */
  flush: () => Promise<void>;
  /** Adopt an external draft as already saved, e.g. after a revision restore. */
  markSaved: (draft: TDraft) => void;
}>;

const LEAVE_PROMPT = "You have unsaved changes. Leave without saving?";

export function useCodexAutosave<TDraft>(options: UseCodexAutosaveOptions<TDraft>): CodexAutosave<TDraft> {
  const { settings, draft, save, onConflict, disabled = false } = options;
  const serialize = options.serialize ?? ((value: TDraft) => JSON.stringify(value));

  const [status, setStatus] = useState<SaveStatus>("idle");
  const savedRef = useRef<string>(serialize(draft));
  const draftRef = useRef(draft);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const saveRef = useRef(save);
  const serializeRef = useRef(serialize);
  const conflictRef = useRef(onConflict);
  saveRef.current = save;
  serializeRef.current = serialize;
  conflictRef.current = onConflict;
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const current = serialize(draft);
  const dirty = !disabled && current !== savedRef.current;

  const flush = useCallback(async () => {
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    const snapshot = serializeRef.current(draftRef.current);
    if (snapshot === savedRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      await saveRef.current(draftRef.current);
      // Compare against the pre-write snapshot so an edit made in flight stays dirty and re-runs.
      savedRef.current = snapshot;
      setStatus("saved");
    } catch (error) {
      if (error instanceof CodexRequestError && error.status === 409) {
        setStatus("conflict");
        await conflictRef.current?.();
      } else {
        setStatus("error");
      }
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void flush();
      }
    }
  }, []);

  const markSaved = useCallback((next: TDraft) => {
    savedRef.current = serializeRef.current(next);
    draftRef.current = next;
    setStatus("saved");
  }, []);

  // ----- Autosave ON: the debounce -----
  const interval = Math.max(1, Math.trunc(settings.intervalSeconds || 1));
  useEffect(() => {
    if (disabled || !settings.enabled) return;
    if (current === savedRef.current) return;
    const timer = setTimeout(() => {
      void flush();
    }, interval * 1000);
    return () => clearTimeout(timer);
  }, [current, disabled, settings.enabled, interval, flush]);

  // Flush a pending edit on unmount so the last keystrokes aren't dropped. `flush` is stable.
  const enabledRef = useRef(settings.enabled);
  enabledRef.current = settings.enabled && !disabled;
  useEffect(
    () => () => {
      if (!enabledRef.current) return;
      if (serializeRef.current(draftRef.current) !== savedRef.current) void flush();
    },
    [flush]
  );

  // ----- Autosave OFF: the guards -----
  useEffect(() => {
    if (disabled || settings.enabled || !dirty) return;
    // A native confirm: the guard fires from the router outside any mounted dialog, and pairs with the
    // browser-owned `beforeunload` prompt.
    const release = registerNavigationGuard(() => window.confirm(LEAVE_PROMPT));
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      release();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [disabled, settings.enabled, dirty]);

  // With autosave off, an unsaved draft reads "Unsaved changes" rather than a misleading "Saved".
  return { status: !settings.enabled && dirty && status !== "saving" ? "dirty" : status, dirty, flush, markSaved };
}
