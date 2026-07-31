import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@vtt/ui";
import { CodexRequestError, type CodexAutosaveSettings } from "./api";
import { registerNavigationGuard } from "../router";

/**
 * D6 — **one rule: the Codex always keeps your work**, and one implementation of it.
 *
 * Before this, every editor had its own answer: the page editor debounced at 800 ms, sessions and quests
 * demanded an explicit "Save" (and a quest objective ticked without saving was simply lost), the pin
 * inspector wrote through per control. This hook is the single behaviour, and the GM's setting is what
 * chooses between its two modes.
 *
 * **On** — save `intervalSeconds` after the last edit, show the saved state, flush on unmount and on
 * navigation. **Off** — no timer at all; `dirty` drives an explicit Save button, a navigation guard and
 * a `beforeunload` handler, so leaving with unsaved work always says so.
 *
 * The save is **serialized: only ever one write in flight**. Overlapping saves race the same
 * `expectedRev` and 409 against *themselves*, then wedge the editor because the local rev never
 * resyncs. An edit made mid-save sets a dirty flag and re-runs on completion — the discipline
 * `PageEditor` proved and this hook now generalizes.
 *
 * **What this does NOT govern** (a recorded scope call): discrete acts stay immediate whatever the
 * setting says — a reveal switch, "Make active", the party pin, a status select on a list row, and the
 * settings screen's own switches. Flipping a switch *is* the action, not an edit in progress. Posting a
 * NEW journal entry likewise stays an explicit Add: creation is not editing (D6).
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
  /** Skip everything (no timer, no guard) — for an editor that is mounted but has nothing to save yet. */
  disabled?: boolean;
}>;

export type CodexAutosave<TDraft> = Readonly<{
  status: SaveStatus;
  dirty: boolean;
  /** Save now, ignoring the debounce. What the explicit Save button calls when autosave is off. */
  flush: () => Promise<void>;
  /** Adopt an externally-supplied draft as "already saved" — e.g. after a revision restore. */
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
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const current = serialize(draft);
  const dirty = !disabled && current !== savedRef.current;

  const flush = useCallback(async () => {
    if (savingRef.current) { pendingRef.current = true; return; }
    const snapshot = serializeRef.current(draftRef.current);
    if (snapshot === savedRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      await saveRef.current(draftRef.current);
      // Compare against the snapshot taken BEFORE the write: an edit made while it was in flight must
      // stay dirty, which `pendingRef` then re-runs.
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
      if (pendingRef.current) { pendingRef.current = false; void flush(); }
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
    const timer = setTimeout(() => { void flush(); }, interval * 1000);
    return () => clearTimeout(timer);
  }, [current, disabled, settings.enabled, interval, flush]);

  // Flush a pending edit on unmount — navigating away or switching sections would otherwise drop the
  // last keystrokes the debounce had not yet reached. `flush` is stable, so this runs on unmount only.
  const enabledRef = useRef(settings.enabled);
  enabledRef.current = settings.enabled && !disabled;
  useEffect(() => () => {
    if (!enabledRef.current) return;
    if (serializeRef.current(draftRef.current) !== savedRef.current) void flush();
  }, [flush]);

  // ----- Autosave OFF: the guards -----
  useEffect(() => {
    if (disabled || settings.enabled || !dirty) return;
    // A native confirm, deliberately: the guard fires from the router — outside any mounted dialog's
    // lifetime — and it pairs with the `beforeunload` below, which the browser owns and cannot be
    // styled either. One prompt, two triggers, no half-managed modal state during a teardown.
    const release = registerNavigationGuard(() => window.confirm(LEAVE_PROMPT));
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { release(); window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [disabled, settings.enabled, dirty]);

  // With autosave OFF, an unsaved draft reads "Unsaved changes" — the primitive's own `dirty` state —
  // rather than the resting "Saved", which would be a lie the GM only discovers on leaving. With it ON,
  // the in-flight states carry the readout and there is no dirty phase worth naming.
  return { status: !settings.enabled && dirty && status !== "saving" ? "dirty" : status, dirty, flush, markSaved };
}
