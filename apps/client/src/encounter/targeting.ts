import { useSyncExternalStore } from "react";
import type { ActionResolution, AnnotationPoint, AnnotationShapeKind, AskableCommand, ContentActionSummary, RulesBlocked } from "@vtt/domain";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/**
 * Shared targeting state for the GM action runner. The runner may render in the sidebar OR inside the
 * docked panel, and the map is a third surface - a module store (not component state) is the only way
 * all three agree on the in-progress action, its selected targets, or its placed area template.
 * Resolution stays on the server-authoritative action:resolve (the GM for anyone, a player for their own
 * claimed character - gated per-actor by canInitiateForActor, not GM-only); this only coordinates UX.
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
 * A strict-mode rejection awaiting the GM's call (ADR-0020). Lives in the store - not component
 * state - because the resolve may come from the sidebar runner, the docked runner, OR the map's
 * confirm bar, and the override dialog must appear regardless of which surface rolled.
 */
let blockedPrompt: {
  blocked: RulesBlocked;
  retry: (override: { reason: string }) => void;
  /**
   * The exact command the server refused, kept verbatim so a PLAYER can ask the GM to allow THIS —
   * `rules:ask` parks the command itself and the GM's Allow replays it. Reconstructing the payload at
   * ask time would risk asking about a slightly different move than the one that was blocked.
   */
  asked: { type: AskableCommand; payload: unknown };
} | null = null;
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
 * machine-readable `blocked` details so the caller can offer the one-tap audited override -
 * re-calling with `override` keeps the same targets.
 */
export type ResolveOptions = Readonly<{
  override?: { reason: string };
  /** false previews the attack roll (no apply); the confirming call passes commit:true. Attacks default to preview. */
  commit?: boolean;
  /** The answerer's advantage/disadvantage choice for the attack d20 (re-previewing). */
  rollMode?: "advantage" | "disadvantage" | "normal";
  /** A confirmed or hand-rolled natural d20, used instead of rolling. */
  attackNatural?: number;
  /** A hand-entered FINAL total ("final total" manual mode) - used verbatim vs AC instead of a natural die. */
  attackTotal?: number;
  /** Declares a natural 20 (crit) for the hand-entered-total path, where the natural die is unknown. */
  critical?: boolean;
}>;

export function resolveTargeting(revision: number | undefined, onResult: (ok: boolean, message?: string) => void, opts: ResolveOptions = {}) {
  if (!session || busy) return;
  const { attackerId, action, mode, selected, template } = session;
  // A single-target attack roll previews first (commit:false) so the result card can offer Adv/Disadv,
  // a typed d20, and Confirm - the same roll experience as a saving throw. Templates, multi-target, and
  // save/utility actions resolve straight through. An explicit commit in opts wins (the Confirm tap).
  const isAttack = action.attackBonus !== null && mode === "single";
  const commit = opts.commit ?? !isAttack;
  const extra = { ...(opts.override ? { override: opts.override } : {}), ...(opts.rollMode ? { rollMode: opts.rollMode } : {}), ...(opts.attackNatural !== undefined ? { attackNatural: opts.attackNatural } : {}), ...(opts.attackTotal !== undefined ? { attackTotal: opts.attackTotal } : {}), ...(opts.critical !== undefined ? { critical: opts.critical } : {}), commit, ...(revision !== undefined ? { expectedRevision: revision } : {}) };
  const payload = mode === "template"
    ? (template?.placed ? { commandId: newId(), actorId: attackerId, actionId: action.id, template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target }, ...extra } : null)
    : (selected.length > 0 ? { commandId: newId(), actorId: attackerId, actionId: action.id, targetIds: [...selected], ...extra } : null);
  if (!payload) return;
  busy = true; blockedPrompt = null; emit();
  socket.emit("action:resolve", payload, (response: { ok: boolean; message?: string; blocked?: RulesBlocked; resolution?: ActionResolution }) => {
    busy = false;
    // A preview keeps the session so the answerer can re-roll adv/disadv, type a d20, or confirm; a
    // committed resolve ends it (the session's job is done).
    if (response.ok && response.resolution) { result = response.resolution; if (!response.resolution.preview) session = null; }
    // Overridable rejection: keep the session (same targets) and surface the one-tap audited
    // override; the retry skips expectedRevision since it's an explicit human confirmation.
    else if (response.blocked?.overridable) blockedPrompt = { blocked: response.blocked, retry: (confirmed) => resolveTargeting(undefined, onResult, { ...opts, override: confirmed }), asked: { type: "action.resolve", payload } };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

/** Resolve a targetless action (Rage, Reckless Attack, a Multiattack plan) without a targeting session. */
export function resolveActionDirect(attackerId: string, actionId: string, revision: number | undefined, onResult: (ok: boolean, message?: string) => void, override?: { reason: string }) {
  socket.emit("action:resolve", { commandId: newId(), actorId: attackerId, actionId, ...(override ? { override } : {}), ...(revision !== undefined ? { expectedRevision: revision } : {}) }, (response: { ok: boolean; message?: string; blocked?: RulesBlocked; resolution?: ActionResolution }) => {
    if (response.ok && response.resolution) { result = response.resolution; session = null; }
    else if (response.blocked?.overridable) blockedPrompt = { blocked: response.blocked, retry: (confirmed) => resolveActionDirect(attackerId, actionId, undefined, onResult, confirmed), asked: { type: "action.resolve", payload: { commandId: newId(), actorId: attackerId, actionId } } };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

export function useTargeting() { return useSyncExternalStore(subscribe, () => session, () => session); }
export function useTargetingResult() { return useSyncExternalStore(subscribe, () => result, () => result); }
export function useTargetingBusy() { return useSyncExternalStore(subscribe, () => busy, () => busy); }
export function useTargetingBlocked() { return useSyncExternalStore(subscribe, () => blockedPrompt, () => blockedPrompt); }
