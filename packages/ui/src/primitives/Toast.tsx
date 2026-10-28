import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./util";
import { IconX } from "./icons";
import { Tag, type TagTone } from "./Tag";
import "./Toast.css";

export type ToastTone = "success" | "error" | "info";
interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
  /** Offers Undo, for an action that can be taken back. Undo runs this and closes the toast. */
  undo?: () => void;
}
interface ToastRecord {
  id: number;
  message: ReactNode;
  tone: ToastTone;
  undo?: () => void;
}
interface ToastApi {
  toast: (message: ReactNode, options?: ToastOptions) => void;
  /** Client-local notification mute (per browser, persisted). While true, toast() is a no-op. */
  muted: boolean;
  setMuted: (muted: boolean) => void;
}
/** What an outlet reads: the live toasts and a way to take them over from the floating stack. */
interface ToastStore {
  toasts: readonly ToastRecord[];
  dismiss: (id: number) => void;
  /** Mounting an outlet sends toasts to it, away from the floating stack; the returned function gives them back. */
  claim: () => () => void;
}

const MUTE_STORAGE_KEY = "vtt.notifications-muted";
const ToastContext = createContext<ToastApi | null>(null);
const ToastStoreContext = createContext<ToastStore | null>(null);
/** The VT323 tag that names a toast's kind. */
const TONE_TAG: Record<ToastTone, { word: string; tone: TagTone }> = {
  success: { word: "DONE", tone: "done" },
  error: { word: "ERROR", tone: "error" },
  info: { word: "NOTE", tone: "status" }
};

/** A toast's countdown, which hover or focus holds still. */
interface Timer {
  handle: number | null;
  remaining: number;
  startedAt: number;
}

/** One toast surface for results not visible on screen ("Encounter saved"). Names the result, stays 5 seconds (held
    while the pointer or focus is on it), and offers Undo when the action can be undone. Wrap the app once; call
    useToast(). */
export function ToastProvider({ children, duration = 5000 }: { children: ReactNode; duration?: number }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);
  const [muted, setMutedState] = useState(() => {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const setMuted = useCallback((value: boolean) => {
    setMutedState(value);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* private mode: keep it session-only */
    }
  }, []);

  // Pending dismiss timers, cleared on unmount so none fires into a provider that is gone.
  const timers = useRef(new Map<number, Timer>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer?.handle != null) window.clearTimeout(timer.handle);
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) if (timer.handle != null) window.clearTimeout(timer.handle);
      pending.clear();
    };
  }, []);
  const run = useCallback(
    (id: number, timer: Timer) => {
      timer.startedAt = Date.now();
      timer.handle = window.setTimeout(() => dismiss(id), timer.remaining);
    },
    [dismiss]
  );
  const hold = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer || timer.handle == null) return;
    window.clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }, []);
  const release = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (timer && timer.handle == null) run(id, timer);
    },
    [run]
  );
  const toast = useCallback(
    (message: ReactNode, options?: ToastOptions) => {
      if (mutedRef.current) return; // this viewer silenced notifications (client-local)
      const id = ++idRef.current;
      const tone = options?.tone ?? "info";
      setToasts((list) => [...list, { id, message, tone, undo: options?.undo }]);
      const ttl = options?.duration ?? duration;
      if (ttl > 0) {
        const timer: Timer = { handle: null, remaining: ttl, startedAt: 0 };
        timers.current.set(id, timer);
        run(id, timer);
      }
    },
    [duration, run]
  );

  const api = useMemo(() => ({ toast, muted, setMuted }), [toast, muted, setMuted]);
  const [outlets, setOutlets] = useState(0);
  const claim = useCallback(() => {
    setOutlets((count) => count + 1);
    return () => setOutlets((count) => count - 1);
  }, []);
  const store = useMemo(() => ({ toasts, dismiss, claim }), [toasts, dismiss, claim]);

  return (
    <ToastContext.Provider value={api}>
      <ToastStoreContext.Provider value={store}>{children}</ToastStoreContext.Provider>
      <div className="nh-toast-viewport" role="region" aria-label="Notifications">
        {(outlets > 0 ? [] : toasts).map((t) => (
          <div
            key={t.id}
            className={cx("nh-toast", `nh-toast--${t.tone}`, "anim-sheet")}
            // A status is announced politely, after what the person is doing.
            role="status"
            onPointerEnter={() => hold(t.id)}
            onPointerLeave={() => release(t.id)}
            onFocus={() => hold(t.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) release(t.id);
            }}
          >
            <Tag tone={TONE_TAG[t.tone].tone} className="nh-toast-tag">
              {TONE_TAG[t.tone].word}
            </Tag>
            <span className="nh-toast-message">{t.message}</span>
            {t.undo && (
              <button
                type="button"
                className="nh-toast-undo tap-target interactive"
                onClick={() => {
                  t.undo?.();
                  dismiss(t.id);
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="nh-toast-close tap-target interactive"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <IconX />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/** Client-local notification mute, for a "silence notifications" toggle (e.g. a bell icon). */
export function useToastMute(): { muted: boolean; setMuted: (muted: boolean) => void } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastMute must be used within a ToastProvider");
  return { muted: ctx.muted, setMuted: ctx.setMuted };
}

/**
 * A place in a layout's own flow that shows the newest toast as one line, in place of `fallback`, while it is mounted.
 * The floating stack stays empty meanwhile, so a toast never covers what the layout holds (a prompt, a control).
 */
export function ToastOutlet({ fallback, className }: Readonly<{ fallback?: ReactNode; className?: string }>) {
  const store = useContext(ToastStoreContext);
  if (!store) throw new Error("ToastOutlet must be used within a ToastProvider");
  const { claim } = store;
  useEffect(() => claim(), [claim]);
  const latest = store.toasts[store.toasts.length - 1];
  return (
    <span className={cx("nh-toast-outlet", latest && `nh-toast-outlet--${latest.tone}`, className)} role="status">
      {latest ? (
        <>
          <Tag tone={TONE_TAG[latest.tone].tone} size="sm">
            {TONE_TAG[latest.tone].word}
          </Tag>
          <span className="nh-toast-outlet-message">{latest.message}</span>
        </>
      ) : (
        fallback
      )}
    </span>
  );
}
