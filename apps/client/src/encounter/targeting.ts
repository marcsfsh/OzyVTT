import { useSyncExternalStore } from "react";
import type {
  ActionResolution,
  AnnotationPoint,
  AnnotationShapeKind,
  AskableCommand,
  ContentActionSummary,
  HitOptionChoice,
  RulesBlocked
} from "@vtt/domain";
import { command } from "../lib/command";
import { newId } from "../lib/ids";

/**
 * Shared targeting state, so both action runners and the map agree on the action, targets and
 * template. Resolution stays on the server's `action:resolve`; this only coordinates UX.
 */
export type TargetingTemplate = Readonly<{
  shape: AnnotationShapeKind;
  sizeFeet: number;
  widthFeet: number | null;
  placed: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }> | null;
}>;
export type TargetingSession = Readonly<{
  action: ContentActionSummary;
  attackerId: string;
  mode: "single" | "multi" | "template";
  selected: readonly string[];
  template: TargetingTemplate | null;
  /** The spell slot a spell is cast with, sent with every resolve of this session. */
  slotLevel?: number;
  /** How much of its pool an action whose user picks the cost spends (Lay on Hands' points). */
  spend?: number;
}>;

let session: TargetingSession | null = null;
let result: ActionResolution | null = null;
let busy = false;
/** A strict-mode rejection awaiting the GM's call (ADR-0020); here so any surface can show the dialog. */
let blockedPrompt: {
  blocked: RulesBlocked;
  retry: (override: { reason: string }) => void;
  /**
   * The refused command as sent, so a player can ask the GM to allow it (`rules:ask`). Always the
   * committing form: replaying an attack preview would roll a d20 and apply nothing.
   */
  asked: { type: AskableCommand; payload: unknown };
} | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function beginTargeting(action: ContentActionSummary, attackerId: string, slotLevel?: number) {
  const area = action.area;
  const slot = {
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    // A picked cost starts at one; the picker raises it.
    ...(action.useCost === "chosen" ? { spend: 1 } : {})
  };
  if (area) {
    // Map the SRD area shape onto a drawable annotation shape (sphere/emanation → circle, cube → square).
    const shape: AnnotationShapeKind =
      area.shape === "sphere" || area.shape === "emanation" ? "circle" : area.shape === "cube" ? "square" : area.shape;
    session = {
      action,
      attackerId,
      mode: "template",
      selected: [],
      template: { shape, sizeFeet: area.sizeFeet, widthFeet: area.widthFeet, placed: null },
      ...slot
    };
  } else {
    // An attack lands on exactly one target; single-target builtins (Help, Unarmed Strike) too;
    // a save / pure-damage action can hit many.
    session = {
      action,
      attackerId,
      mode: action.attackBonus !== null || action.targeting === "single" ? "single" : "multi",
      selected: [],
      template: null,
      ...slot
    };
  }
  result = null;
  emit();
}
export function toggleTarget(actorId: string) {
  if (!session || session.mode === "template") return;
  session =
    session.mode === "single"
      ? { ...session, selected: session.selected[0] === actorId ? [] : [actorId] }
      : {
          ...session,
          selected: session.selected.includes(actorId)
            ? session.selected.filter((id) => id !== actorId)
            : [...session.selected, actorId]
        };
  emit();
}
export function setTemplatePlacement(origin: AnnotationPoint, target: AnnotationPoint) {
  if (session?.template) {
    session = { ...session, template: { ...session.template, placed: { origin, target } } };
    emit();
  }
}
/** How much of its pool the action being targeted spends (Lay on Hands' points). */
export function setTargetingSpend(spend: number) {
  if (!session || session.action.useCost !== "chosen") return;
  session = { ...session, spend };
  emit();
}
export function clearTargeting() {
  if (session !== null || blockedPrompt !== null) {
    session = null;
    blockedPrompt = null;
    emit();
  }
}
export function setTargetingResult(next: ActionResolution | null) {
  result = next;
  emit();
}
export function clearBlockedPrompt() {
  if (blockedPrompt !== null) {
    blockedPrompt = null;
    emit();
  }
}

/**
 * Resolves the current session through `action:resolve`. A rules-mode rejection (ADR-0020) exposes
 * `blocked` so the caller can offer the audited override, which keeps the same targets.
 */
export type ResolveOptions = Readonly<{
  override?: { reason: string };
  /** false previews the attack roll (no apply); the confirming call passes commit:true. Attacks default to preview. */
  commit?: boolean;
  /** The answerer's advantage/disadvantage choice for the attack d20 (re-previewing). */
  rollMode?: "advantage" | "disadvantage" | "normal";
  /** A confirmed or hand-rolled natural d20, used instead of rolling. */
  attackNatural?: number;
  /** A hand-entered final total ("final total" manual mode), used as is against AC. */
  attackTotal?: number;
  /** Declares a natural 20 (crit) for the hand-entered-total path, where the natural die is unknown. */
  critical?: boolean;
  /** How far Push mastery shoves on the confirmed hit (0 declines); absent pushes the full distance. */
  pushFeet?: number;
  /** Extras the confirmed hit carries (Sneak Attack, a smite), from the preview's offers. */
  hitOptions?: readonly HitOptionChoice[];
}>;

export function resolveTargeting(
  revision: number | undefined,
  onResult: (ok: boolean, message?: string) => void,
  opts: ResolveOptions = {}
) {
  if (!session || busy) return;
  const { attackerId, action, mode, selected, template, slotLevel, spend } = session;
  // A single-target attack previews first (commit: false) so the result card can offer Adv/Disadv, a
  // typed d20 and Confirm. Templates, multi-target and save/utility actions resolve straight through.
  // An explicit `commit` in opts wins (the Confirm tap).
  const isAttack = action.attackBonus !== null && mode === "single";
  const commit = opts.commit ?? !isAttack;
  const extra = {
    ...(opts.override ? { override: opts.override } : {}),
    ...(opts.rollMode ? { rollMode: opts.rollMode } : {}),
    ...(opts.attackNatural !== undefined ? { attackNatural: opts.attackNatural } : {}),
    ...(opts.attackTotal !== undefined ? { attackTotal: opts.attackTotal } : {}),
    ...(opts.critical !== undefined ? { critical: opts.critical } : {}),
    ...(opts.pushFeet !== undefined ? { pushFeet: opts.pushFeet } : {}),
    ...(opts.hitOptions && opts.hitOptions.length > 0 ? { hitOptions: [...opts.hitOptions] } : {}),
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...(spend !== undefined ? { spend } : {}),
    commit,
    ...(revision !== undefined ? { expectedRevision: revision } : {})
  };
  const payload =
    mode === "template"
      ? template?.placed
        ? {
            actorId: attackerId,
            actionId: action.id,
            template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target },
            ...extra
          }
        : null
      : selected.length > 0
        ? { actorId: attackerId, actionId: action.id, targetIds: [...selected], ...extra }
        : null;
  if (!payload) return;
  busy = true;
  blockedPrompt = null;
  emit();
  void command("action:resolve", payload).then((response) => {
    busy = false;
    // A preview keeps the session for re-rolls or confirm; a committed resolve ends it.
    if (response.ok && response.resolution) {
      result = response.resolution;
      if (!response.resolution.preview) session = null;
    }
    // Overridable rejection: keep the session (same targets) and offer the audited override; the retry
    // skips expectedRevision because it is an explicit human confirmation. The GM's retry keeps `commit`
    // as sent; the player's ask is replayed on the GM's socket, so it is parked committing.
    else if (response.blocked?.overridable)
      blockedPrompt = {
        blocked: response.blocked,
        retry: (confirmed) => resolveTargeting(undefined, onResult, { ...opts, override: confirmed }),
        asked: { type: "action.resolve", payload: { commandId: newId(), ...payload, commit: true } }
      };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

/** Resolve a targetless action (Rage, Reckless Attack, a Multiattack plan) without a targeting session. */
export function resolveActionDirect(
  attackerId: string,
  actionId: string,
  revision: number | undefined,
  onResult: (ok: boolean, message?: string) => void,
  override?: { reason: string }
) {
  void command("action:resolve", {
    actorId: attackerId,
    actionId,
    ...(override ? { override } : {}),
    ...(revision !== undefined ? { expectedRevision: revision } : {})
  }).then((response) => {
    if (response.ok && response.resolution) {
      result = response.resolution;
      session = null;
    } else if (response.blocked?.overridable)
      blockedPrompt = {
        blocked: response.blocked,
        retry: (confirmed) => resolveActionDirect(attackerId, actionId, undefined, onResult, confirmed),
        asked: { type: "action.resolve", payload: { commandId: newId(), actorId: attackerId, actionId } }
      };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

export function useTargeting() {
  return useSyncExternalStore(
    subscribe,
    () => session,
    () => session
  );
}
export function useTargetingResult() {
  return useSyncExternalStore(
    subscribe,
    () => result,
    () => result
  );
}
export function useTargetingBusy() {
  return useSyncExternalStore(
    subscribe,
    () => busy,
    () => busy
  );
}
export function useTargetingBlocked() {
  return useSyncExternalStore(
    subscribe,
    () => blockedPrompt,
    () => blockedPrompt
  );
}
