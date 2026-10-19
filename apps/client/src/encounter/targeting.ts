import { useSyncExternalStore } from "react";
import type {
  AbilityId,
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
  /** "none": no target to pick (Search, Study), only the skill it is made with. */
  mode: "single" | "multi" | "template" | "none";
  selected: readonly string[];
  template: TargetingTemplate | null;
  /** The spell slot a spell is cast with, sent with every resolve of this session. */
  slotLevel?: number;
  /** How much of its pool an action whose user picks the cost spends (Lay on Hands' points). */
  spend?: number;
  /** A darts action's darts (Magic Missile at this slot) and how many each selected target takes. */
  darts?: Readonly<{ total: number; counts: Readonly<Record<string, number>> }>;
  /** The damage type picked for an action whose caster chooses one (Chromatic Orb). */
  damageType?: NonNullable<ContentActionSummary["damageTypes"]>[number];
  /** The skill a check action is made with (Search, Influence); absent, Escape a Grapple uses the better one. */
  skill?: string;
  /** The ability a cast chooses (Hex); it is not rolled until one is chosen. */
  ability?: AbilityId;
  /** The condition picked for a failed save whose caster chooses one (Blindness/Deafness); absent, the first. */
  conditionId?: string;
  /** The GM places a spell's lingering area and resolves no action: the zone it is for. */
  placeZoneId?: string;
}>;

let session: TargetingSession | null = null;
let result: ActionResolution | null = null;
/** The previewed attack's die was typed from a physical die, so its reroll is typed too. */
let typedPreview = false;
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

export function beginTargeting(
  action: ContentActionSummary,
  attackerId: string,
  slotLevel?: number,
  dartsAtSlot?: number
) {
  const area = action.area;
  const dartTotal = dartsAtSlot ?? action.darts;
  // A check action starts on its usual skill; Escape a Grapple starts on the better of its two, the server's pick.
  const usualSkill = action.id === "escape-grapple" ? undefined : action.checkSkills?.[0]?.id;
  const slot = {
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...(dartTotal !== undefined ? { darts: { total: dartTotal, counts: {} } } : {}),
    ...(usualSkill !== undefined ? { skill: usualSkill } : {}),
    // A picked cost starts at one; the picker raises it.
    ...(action.useCost === "chosen" ? { spend: 1 } : {})
  };
  if (area) {
    // Map the SRD area shape onto a drawable annotation shape (sphere/cylinder/emanation → circle, cube → square).
    const shape: AnnotationShapeKind =
      area.shape === "sphere" || area.shape === "cylinder" || area.shape === "emanation"
        ? "circle"
        : area.shape === "cube"
          ? "square"
          : area.shape;
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
      mode:
        action.attackBonus !== null || action.targeting === "single"
          ? "single"
          : action.targeting === "none"
            ? "none"
            : "multi",
      selected: [],
      template: null,
      ...slot
    };
  }
  result = null;
  typedPreview = false;
  emit();
}
/** The GM places (or moves) a spell's lingering area: the same template placement, sent as `spell-zone:place`. */
export function beginZonePlacement(
  zone: Readonly<{ id: string; name: string; casterId: string; area: ContentActionSummary["area"] }>
) {
  if (!zone.area) return;
  beginTargeting(
    {
      id: `spell-zone-${zone.id}`,
      name: `${zone.name} area`,
      activation: "other",
      description: "",
      attackBonus: null,
      reachFeet: null,
      rangeFeet: null,
      rangeNormalFeet: null,
      saveAbility: null,
      saveDc: null,
      damage: [],
      area: zone.area,
      attackCount: null,
      usesLimit: null,
      usesPer: null,
      usesRecharge: null,
      usesPool: null,
      requiresEffectTag: null,
      multiattack: null,
      grants: false,
      reaction: null
    },
    zone.casterId
  );
  if (session) session = { ...session, placeZoneId: zone.id };
  emit();
}
export function toggleTarget(actorId: string) {
  if (!session || session.mode === "template" || session.mode === "none") return;
  const dropping = session.selected.includes(actorId);
  session =
    session.mode === "single"
      ? { ...session, selected: session.selected[0] === actorId ? [] : [actorId] }
      : {
          ...session,
          selected: dropping ? session.selected.filter((id) => id !== actorId) : [...session.selected, actorId]
        };
  if (session.darts) {
    const { [actorId]: _dropped, ...counts } = session.darts.counts;
    session = { ...session, darts: { ...session.darts, counts: dropping ? counts : { ...counts, [actorId]: 1 } } };
  }
  emit();
}
/** Picks the damage type an action deals, for one whose caster chooses (Chromatic Orb). */
export function setDamageType(damageType: string) {
  const picked = session?.action.damageTypes?.find((type) => type === damageType);
  if (!session || picked === undefined) return;
  session = { ...session, damageType: picked };
  emit();
}
/** Picks the condition a failed save imposes, for an action whose caster chooses one (Blindness/Deafness). */
export function setConditionChoice(conditionId: string) {
  if (!session?.action.conditionChoices?.includes(conditionId)) return;
  session = { ...session, conditionId };
  emit();
}
/** Picks the skill a check action is made with; undefined lets Escape a Grapple use the better one. */
export function setCheckSkill(skill: string | undefined) {
  if (!session) return;
  if (skill !== undefined && !session.action.checkSkills?.some((entry) => entry.id === skill)) return;
  const { skill: _previous, ...rest } = session;
  session = skill === undefined ? rest : { ...rest, skill };
  emit();
}
/** Picks the ability a cast chooses (Hex). */
export function setChosenAbility(ability: AbilityId) {
  if (!session?.action.choosesAbility) return;
  session = { ...session, ability };
  emit();
}
/** Whether the session has what its Roll needs: its targets or placed area, and a chosen ability for a cast that takes
 *  one. */
export function targetingReady(picking: TargetingSession): boolean {
  if (picking.action.choosesAbility && picking.ability === undefined) return false;
  if (picking.mode === "template") return Boolean(picking.template?.placed);
  if (picking.mode === "none") return true;
  return picking.selected.length > 0;
}
/** Sets how many darts a selected target takes, within the darts the action has left to assign. */
export function setTargetDarts(actorId: string, count: number) {
  if (!session?.darts || !session.selected.includes(actorId)) return;
  const others = Object.entries(session.darts.counts)
    .filter(([id]) => id !== actorId)
    .reduce((sum, [, taken]) => sum + taken, 0);
  const next = Math.max(1, Math.min(session.darts.total - others, count));
  session = { ...session, darts: { ...session.darts, counts: { ...session.darts.counts, [actorId]: next } } };
  emit();
}
/** The targets as the server reads darts: each named once per dart it takes. */
const dartTargetIds = (selected: readonly string[], darts: TargetingSession["darts"]) =>
  darts ? selected.flatMap((id) => Array.from({ length: darts.counts[id] ?? 1 }, () => id)) : [...selected];
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
  if (next === null) typedPreview = false;
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
  /** The GM's forced Advantage or Disadvantage for the attack d20; the server ignores a player's. */
  rollMode?: "advantage" | "disadvantage" | "normal";
  /** The face a physical d20 shows, used in place of the server's throw. */
  attackNatural?: number;
  /** Throw the previewed d20 again: Heroic Inspiration for a player, free for the GM. */
  reroll?: boolean;
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
  const {
    attackerId,
    action,
    mode,
    selected,
    template,
    slotLevel,
    spend,
    darts,
    damageType,
    skill,
    ability,
    conditionId
  } = session;
  if (session.placeZoneId !== undefined) {
    if (!template?.placed) return;
    const zoneId = session.placeZoneId;
    busy = true;
    emit();
    void command("spell-zone:place", {
      zoneId,
      template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target },
      ...(revision !== undefined ? { expectedRevision: revision } : {})
    }).then((response) => {
      busy = false;
      if (response.ok) session = null;
      emit();
      onResult(response.ok, response.message);
    });
    return;
  }
  // A single-target attack previews first (commit: false) so the result card can offer Confirm, and the
  // server holds the die for it. Templates, multi-target and save/utility actions resolve straight
  // through. An explicit `commit` in opts wins (the Confirm tap).
  const isAttack = action.attackBonus !== null && mode === "single";
  const commit = opts.commit ?? !isAttack;
  const extra = {
    ...(opts.override ? { override: opts.override } : {}),
    ...(opts.rollMode ? { rollMode: opts.rollMode } : {}),
    ...(opts.attackNatural !== undefined ? { attackNatural: opts.attackNatural } : {}),
    ...(opts.reroll ? { reroll: true } : {}),
    ...(opts.pushFeet !== undefined ? { pushFeet: opts.pushFeet } : {}),
    ...(opts.hitOptions && opts.hitOptions.length > 0 ? { hitOptions: [...opts.hitOptions] } : {}),
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...(spend !== undefined ? { spend } : {}),
    ...(damageType !== undefined ? { damageType } : {}),
    ...(skill !== undefined ? { skill } : {}),
    ...(ability !== undefined ? { ability } : {}),
    ...(conditionId !== undefined ? { conditionId } : {}),
    commit,
    ...(revision !== undefined ? { expectedRevision: revision } : {})
  };
  const payload =
    mode === "none"
      ? { actorId: attackerId, actionId: action.id, ...extra }
      : mode === "template"
        ? template?.placed
          ? {
              actorId: attackerId,
              actionId: action.id,
              template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target },
              ...extra
            }
          : null
        : selected.length > 0
          ? { actorId: attackerId, actionId: action.id, targetIds: dartTargetIds(selected, darts), ...extra }
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
      // A typed die stays typed until a reroll the server throws (the GM's) replaces it.
      if (response.resolution.preview)
        typedPreview = opts.attackNatural !== undefined ? true : opts.reroll ? false : typedPreview;
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
  override?: { reason: string },
  /** A spell readied to cast later, at a chosen slot level. */
  readied?: Readonly<{ slotLevel?: number }>,
  /** A spell with nothing to aim, cast now at a chosen slot level. */
  cast?: Readonly<{ slotLevel?: number }>
) {
  const extra = readied
    ? { ready: true, ...(readied.slotLevel !== undefined ? { slotLevel: readied.slotLevel } : {}) }
    : cast?.slotLevel !== undefined
      ? { slotLevel: cast.slotLevel }
      : {};
  void command("action:resolve", {
    actorId: attackerId,
    actionId,
    ...extra,
    ...(override ? { override } : {}),
    ...(revision !== undefined ? { expectedRevision: revision } : {})
  }).then((response) => {
    if (response.ok && response.resolution) {
      result = response.resolution;
      session = null;
    } else if (response.blocked?.overridable)
      blockedPrompt = {
        blocked: response.blocked,
        retry: (confirmed) => resolveActionDirect(attackerId, actionId, undefined, onResult, confirmed, readied, cast),
        asked: { type: "action.resolve", payload: { commandId: newId(), actorId: attackerId, actionId, ...extra } }
      };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

/** Take the targeted action's own move before the rest of it (Pounce): the server spends the action and grants the
 *  move now; the action picked again after the move makes the rest at no further cost. */
export function takeMoveFirst(onResult: (ok: boolean, message?: string) => void) {
  if (!session || busy) return;
  const { attackerId, action } = session;
  busy = true;
  emit();
  void command("action:resolve", { actorId: attackerId, actionId: action.id, moveFirst: true }).then((response) => {
    busy = false;
    if (response.ok) session = null;
    else if (response.blocked?.overridable)
      blockedPrompt = {
        blocked: response.blocked,
        retry: (confirmed) =>
          void command("action:resolve", {
            actorId: attackerId,
            actionId: action.id,
            moveFirst: true,
            override: confirmed
          }).then((retried) => {
            if (retried.ok) session = null;
            blockedPrompt = null;
            emit();
            onResult(retried.ok, retried.message);
          }),
        asked: {
          type: "action.resolve",
          payload: { commandId: newId(), actorId: attackerId, actionId: action.id, moveFirst: true }
        }
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
/** Whether the previewed attack's die was typed from a physical die. */
export function useTargetingTyped() {
  return useSyncExternalStore(
    subscribe,
    () => typedPreview,
    () => typedPreview
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
