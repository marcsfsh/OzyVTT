import { useSyncExternalStore } from "react";
import type { ActionResolution, AnnotationPoint, AnnotationShapeKind, ContentActionSummary } from "@vtt/domain";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/**
 * Shared targeting state for the GM action runner. The runner may render in the sidebar OR inside the
 * docked panel, and the map is a third surface — a module store (not component state) is the only way
 * all three agree on the in-progress action, its selected targets, or its placed area template.
 * Resolution stays on the server-authoritative GM-gated action:resolve; this only coordinates UX.
 */
export type TargetingTemplate = Readonly<{ shape: AnnotationShapeKind; sizeFeet: number; widthFeet: number | null; placed: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }> | null }>;
export type TargetingSession = Readonly<{
  action: ContentActionSummary;
  attackerId: string;
  mode: "single" | "multi" | "template";
  selected: readonly string[];
  template: TargetingTemplate | null;
}>;

let session: TargetingSession | null = null;
let result: ActionResolution | null = null;
let busy = false;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function beginTargeting(action: ContentActionSummary, attackerId: string) {
  const area = action.area;
  if (area) {
    // Map the SRD area shape onto a drawable annotation shape (sphere/emanation → circle, cube → square).
    const shape: AnnotationShapeKind = area.shape === "sphere" || area.shape === "emanation" ? "circle" : area.shape === "cube" ? "square" : area.shape;
    session = { action, attackerId, mode: "template", selected: [], template: { shape, sizeFeet: area.sizeFeet, widthFeet: area.widthFeet, placed: null } };
  } else {
    // An attack lands on exactly one target; a save / pure-damage action can hit many.
    session = { action, attackerId, mode: action.attackBonus !== null ? "single" : "multi", selected: [], template: null };
  }
  result = null;
  emit();
}
export function toggleTarget(actorId: string) {
  if (!session || session.mode === "template") return;
  session = session.mode === "single"
    ? { ...session, selected: session.selected[0] === actorId ? [] : [actorId] }
    : { ...session, selected: session.selected.includes(actorId) ? session.selected.filter((id) => id !== actorId) : [...session.selected, actorId] };
  emit();
}
export function setTemplatePlacement(origin: AnnotationPoint, target: AnnotationPoint) {
  if (session?.template) { session = { ...session, template: { ...session.template, placed: { origin, target } } }; emit(); }
}
export function clearTargeting() { if (session !== null) { session = null; emit(); } }
export function setTargetingResult(next: ActionResolution | null) { result = next; emit(); }

/** Resolve the current session through the authoritative action:resolve; both the runner's Roll button and the map's confirm bar call this. */
export function resolveTargeting(revision: number, onResult: (ok: boolean, message?: string) => void) {
  if (!session || busy) return;
  const { attackerId, action, mode, selected, template } = session;
  const payload = mode === "template"
    ? (template?.placed ? { commandId: newId(), actorId: attackerId, actionId: action.id, template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target }, expectedRevision: revision } : null)
    : (selected.length > 0 ? { commandId: newId(), actorId: attackerId, actionId: action.id, targetIds: [...selected], expectedRevision: revision } : null);
  if (!payload) return;
  busy = true; emit();
  socket.emit("action:resolve", payload, (response: { ok: boolean; message?: string; resolution?: ActionResolution }) => {
    busy = false;
    if (response.ok && response.resolution) { result = response.resolution; session = null; }
    emit();
    onResult(response.ok, response.message);
  });
}

export function useTargeting() { return useSyncExternalStore(subscribe, () => session, () => session); }
export function useTargetingResult() { return useSyncExternalStore(subscribe, () => result, () => result); }
export function useTargetingBusy() { return useSyncExternalStore(subscribe, () => busy, () => busy); }
