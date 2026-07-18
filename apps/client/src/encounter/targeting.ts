import { useSyncExternalStore } from "react";
import type { ActionResolution, AnnotationPoint, AnnotationShapeKind, ContentActionSummary, RulesBlocked } from "@vtt/domain";
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
/**
 * A strict-mode rejection awaiting the GM's call (ADR-0020). Lives in the store — not component
 * state — because the resolve may come from the sidebar runner, the docked runner, OR the map's
 * confirm bar, and the override dialog must appear regardless of which surface rolled.
 */
let blockedPrompt: { blocked: RulesBlocked; retry: (override: { reason: string }) => void } | null = null;
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
    // An attack lands on exactly one target; single-target builtins (Help, Unarmed Strike) too;
    // a save / pure-damage action can hit many.
    session = { action, attackerId, mode: action.attackBonus !== null || action.targeting === "single" ? "single" : "multi", selected: [], template: null };
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
export function clearTargeting() { if (session !== null || blockedPrompt !== null) { session = null; blockedPrompt = null; emit(); } }
export function setTargetingResult(next: ActionResolution | null) { result = next; emit(); }
export function clearBlockedPrompt() { if (blockedPrompt !== null) { blockedPrompt = null; emit(); } }

/**
 * Resolve the current session through the authoritative action:resolve; both the runner's Roll
 * button and the map's confirm bar call this. A rules-mode rejection (ADR-0020) surfaces its
 * machine-readable `blocked` details so the caller can offer the one-tap audited override —
 * re-calling with `override` keeps the same targets.
 */
export function resolveTargeting(revision: number | undefined, onResult: (ok: boolean, message?: string) => void, override?: { reason: string }) {
  if (!session || busy) return;
  const { attackerId, action, mode, selected, template } = session;
  const payload = mode === "template"
    ? (template?.placed ? { commandId: newId(), actorId: attackerId, actionId: action.id, template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target }, ...(override ? { override } : {}), ...(revision !== undefined ? { expectedRevision: revision } : {}) } : null)
    : (selected.length > 0 ? { commandId: newId(), actorId: attackerId, actionId: action.id, targetIds: [...selected], ...(override ? { override } : {}), ...(revision !== undefined ? { expectedRevision: revision } : {}) } : null);
  if (!payload) return;
  busy = true; blockedPrompt = null; emit();
  socket.emit("action:resolve", payload, (response: { ok: boolean; message?: string; blocked?: RulesBlocked; resolution?: ActionResolution }) => {
    busy = false;
    if (response.ok && response.resolution) { result = response.resolution; session = null; }
    // Overridable rejection: keep the session (same targets) and surface the one-tap audited
    // override; the retry skips expectedRevision since it's an explicit human confirmation.
    else if (response.blocked?.overridable) blockedPrompt = { blocked: response.blocked, retry: (confirmed) => resolveTargeting(undefined, onResult, confirmed) };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

/** Resolve a targetless action (Rage, Reckless Attack, a Multiattack plan) without a targeting session. */
export function resolveActionDirect(attackerId: string, actionId: string, revision: number | undefined, onResult: (ok: boolean, message?: string) => void, override?: { reason: string }) {
  socket.emit("action:resolve", { commandId: newId(), actorId: attackerId, actionId, ...(override ? { override } : {}), ...(revision !== undefined ? { expectedRevision: revision } : {}) }, (response: { ok: boolean; message?: string; blocked?: RulesBlocked; resolution?: ActionResolution }) => {
    if (response.ok && response.resolution) { result = response.resolution; session = null; }
    else if (response.blocked?.overridable) blockedPrompt = { blocked: response.blocked, retry: (confirmed) => resolveActionDirect(attackerId, actionId, undefined, onResult, confirmed) };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

export function useTargeting() { return useSyncExternalStore(subscribe, () => session, () => session); }
export function useTargetingResult() { return useSyncExternalStore(subscribe, () => result, () => result); }
export function useTargetingBusy() { return useSyncExternalStore(subscribe, () => busy, () => busy); }
export function useTargetingBlocked() { return useSyncExternalStore(subscribe, () => blockedPrompt, () => blockedPrompt); }
