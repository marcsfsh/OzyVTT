import { useSyncExternalStore } from "react";
import type { ActionResolution, ContentActionSummary } from "@vtt/domain";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/**
 * Shared targeting state for the GM action runner. The runner may render in the sidebar OR inside the
 * docked panel, and the map is a third surface — a module store (not component state) is the only way
 * all three agree on the in-progress action and its selected targets. Resolution still goes through the
 * server-authoritative `action:resolve`; this only coordinates the click-to-target UX.
 */
export type TargetingSession = Readonly<{
  action: ContentActionSummary;
  attackerId: string;
  mode: "single" | "multi";
  selected: readonly string[];
}>;

let session: TargetingSession | null = null;
let result: ActionResolution | null = null;
let busy = false;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function beginTargeting(action: ContentActionSummary, attackerId: string) {
  // An attack lands on exactly one target; a save / pure-damage action can hit many.
  session = { action, attackerId, mode: action.attackBonus !== null ? "single" : "multi", selected: [] };
  result = null;
  emit();
}
export function toggleTarget(actorId: string) {
  if (!session) return;
  session = session.mode === "single"
    ? { ...session, selected: session.selected[0] === actorId ? [] : [actorId] }
    : { ...session, selected: session.selected.includes(actorId) ? session.selected.filter((id) => id !== actorId) : [...session.selected, actorId] };
  emit();
}
export function clearTargeting() { if (session !== null) { session = null; emit(); } }
export function setTargetingResult(next: ActionResolution | null) { result = next; emit(); }

/** Resolve the current session through the authoritative `action:resolve`; both the runner's Roll button and the map's confirm bar call this. */
export function resolveTargeting(revision: number, onResult: (ok: boolean, message?: string) => void) {
  if (!session || session.selected.length === 0 || busy) return;
  busy = true; emit();
  const { attackerId, action, selected } = session;
  socket.emit("action:resolve", { commandId: newId(), actorId: attackerId, actionId: action.id, targetIds: [...selected], expectedRevision: revision },
    (response: { ok: boolean; message?: string; resolution?: ActionResolution }) => {
      busy = false;
      if (response.ok && response.resolution) { result = response.resolution; session = null; }
      emit();
      onResult(response.ok, response.message);
    });
}

export function useTargeting() { return useSyncExternalStore(subscribe, () => session, () => session); }
export function useTargetingResult() { return useSyncExternalStore(subscribe, () => result, () => result); }
export function useTargetingBusy() { return useSyncExternalStore(subscribe, () => busy, () => busy); }
