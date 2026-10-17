import type { ComponentType, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./util";
import { IconCheck, IconInfo, IconWarning, IconX } from "./icons";
import "./Toast.css";

export type ToastTone = "success" | "error" | "info";
interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
}
interface ToastRecord {
  id: number;
  message: ReactNode;
  tone: ToastTone;
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
  /** Mounting an outlet sends toasts to it instead of the floating stack; the returned function gives them back. */
  claim: () => () => void;
}

const MUTE_STORAGE_KEY = "vtt.notifications-muted";
const ToastContext = createContext<ToastApi | null>(null);
const ToastStoreContext = createContext<ToastStore | null>(null);
/* Same system glyphs as Alert — one tone vocabulary, one set of shapes. */
const TONE_ICON: Record<ToastTone, ComponentType<{ className?: string }>> = {
  success: IconCheck,
  error: IconWarning,
  info: IconInfo
};

/** One toast surface for results not visible on screen ("Encounter saved"). Names
    the result, appears briefly, dismisses. Wrap the app once; call useToast(). */
export function ToastProvider({ children, duration = 3200 }: { children: ReactNode; duration?: number }) {
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

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (message: ReactNode, options?: ToastOptions) => {
      if (mutedRef.current) return; // this viewer silenced notifications (client-local)
      const id = ++idRef.current;
      const tone = options?.tone ?? "info";
      setToasts((list) => [...list, { id, message, tone }]);
      const ttl = options?.duration ?? duration;
      if (ttl > 0) window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss, duration]
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
        {(outlets > 0 ? [] : toasts).map((t) => {
          const ToneIcon = TONE_ICON[t.tone];
          return (
            <div key={t.id} className={cx("nh-toast", `nh-toast--${t.tone}`, "anim-sheet")} role="status">
              <span className="nh-toast-icon" aria-hidden="true">
                <ToneIcon />
              </span>
              <span className="nh-toast-message">{t.message}</span>
              <button
                type="button"
                className="nh-toast-close tap-target interactive"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
              >
                <IconX />
              </button>
            </div>
          );
        })}
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
  const ToneIcon = latest ? TONE_ICON[latest.tone] : null;
  return (
    <span className={cx("nh-toast-outlet", latest && `nh-toast-outlet--${latest.tone}`, className)} role="status">
      {latest && ToneIcon ? (
        <>
          <span className="nh-toast-icon" aria-hidden="true">
            <ToneIcon />
          </span>
          <span className="nh-toast-outlet-message">{latest.message}</span>
        </>
      ) : (
        fallback
      )}
    </span>
  );
}
