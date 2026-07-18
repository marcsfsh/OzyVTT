import { useSyncExternalStore } from "react";
import type { TableEvent } from "@vtt/domain";
import { socket } from "../socket";

/**
 * Transient battlemap notifications ("Goblin took 6 damage"). Fed by the server's `table:event`
 * broadcast (role-filtered there), capped and auto-fading here. Presentation only — never persisted,
 * and the roll history remains the durable record.
 */
let toasts: readonly TableEvent[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function dismiss(id: string) {
  const timer = timers.get(id);
  if (timer) { clearTimeout(timer); timers.delete(id); }
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}
function push(event: TableEvent) {
  toasts = [...toasts, event].slice(-4); // keep the four most recent
  emit();
  timers.set(event.id, setTimeout(() => dismiss(event.id), 4200));
}
socket.on("table:event", push); // registered once at module load; fires whenever the server emits

function useTableToasts() { return useSyncExternalStore(subscribe, () => toasts, () => toasts); }

export function MapToastStack() {
  const current = useTableToasts();
  if (current.length === 0) return null;
  return <div className="map-toast-stack" aria-live="polite">
    {current.map((toast) => <div key={toast.id} className={`map-toast map-toast-${toast.kind}`}>{toast.text}</div>)}
  </div>;
}
