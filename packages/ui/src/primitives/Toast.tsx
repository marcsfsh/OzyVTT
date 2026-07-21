import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cx } from "./util";
import "./Toast.css";

export type ToastTone = "success" | "error" | "info";
export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
}
interface ToastRecord {
  id: number;
  message: ReactNode;
  tone: ToastTone;
}
export interface ToastApi {
  toast: (message: ReactNode, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const TONE_ICON: Record<ToastTone, string> = { success: "✓", error: "⚠", info: "•" };

/** One toast surface for results not visible on screen ("Encounter saved"). Names
    the result, appears briefly, dismisses. Wrap the app once; call useToast(). */
export function ToastProvider({ children, duration = 3200 }: { children: ReactNode; duration?: number }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (message: ReactNode, options?: ToastOptions) => {
      const id = ++idRef.current;
      const tone = options?.tone ?? "info";
      setToasts((list) => [...list, { id, message, tone }]);
      const ttl = options?.duration ?? duration;
      if (ttl > 0) window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss, duration]
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="nh-toast-viewport" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={cx("nh-toast", `nh-toast--${t.tone}`, "anim-sheet")} role="status">
            <span className="nh-toast-icon" aria-hidden="true">{TONE_ICON[t.tone]}</span>
            <span className="nh-toast-message">{t.message}</span>
            <button type="button" className="nh-toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>✕</button>
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
