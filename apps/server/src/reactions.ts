import type { ActionResolution, DamageApplication, GameState } from "@vtt/domain";
import type { RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { requireGm, type Initiator } from "./authorization.js";
import { adjustableActor, applyDamageDetailed } from "./hit-points.js";
import type { EffectNarration } from "./effects.js";
import { resolveDefinitionAction } from "./action-resolution.js";
import { builtinAction } from "./builtin-actions.js";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { damagePartsOf } from "./resolution/damage.js";

export type ReactionAnswerDependencies = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog: an item weapon must be findable as the opportunity attack's fallback melee. */
  catalog?: EquipmentCatalog;
  /** Dice/roll plumbing for leaves-reach answers, which resolve a real melee attack. */
  random: RandomSource;
  newRollId: () => string;
  gmSessionId: string;
  now: () => string;
}>;
/** The two optional halves of a `ReactionOutcome`, spread at both return sites. */
const detailOf = (application: DamageApplication | null) =>
  application === null
    ? {}
    : { parts: application.parts, ...(application.flatReduction ? { flatReduction: application.flatReduction } : {}) };

export type ReactionOutcome = Readonly<{
  used: boolean;
  appliedDamage: number;
  /** Typed breakdown of what was applied, so the table sees why the number changed. Absent when nothing landed. */
  parts?: DamageApplication["parts"];
  flatReduction?: number;
  actorId: string;
  actorName: string;
  actionName: string;
  sourceName: string;
  proposedDamage: number;
  kind: "hit-by-attack" | "leaves-reach";
  /** The opportunity attack's full resolution when a leaves-reach prompt was used. */
  resolution?: ActionResolution;
  events: readonly EffectNarration[];
}>;

/** Preview/confirm options for an opportunity attack answer. */
export type OpportunityAttackOptions = Readonly<{
  commit?: boolean;
  rollMode?: "advantage" | "disadvantage" | "normal";
  attackNatural?: number;
}>;

/**
 * Answers a pending reaction prompt (ADR-0020). GM answers any prompt; a player only their own
 * claimed character's.
 * - hit-by-attack (Uncanny Dodge): the parked damage applies either way; "use" spends the reaction and
 *   halves each typed part first (floor, per part, before defenses).
 * - leaves-reach (opportunity attack): "use" spends the reaction and resolves one melee attack (chosen
 *   actionId, else the first melee attack, else Unarmed Strike) against the mover, auto-applying damage
 *   on a hit. "decline" just clears.
 */
export function answerReaction(
  state: GameState,
  commandId: string,
  reactionId: string,
  use: boolean,
  actionId: string | undefined,
  scope: Initiator,
  deps: ReactionAnswerDependencies,
  attackOptions: OpportunityAttackOptions = {}
): ReactionOutcome {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter.");
  const pending = state.combat.pendingReactions.find((entry) => entry.id === reactionId);
  if (!pending) throw new CommandRejectedError("That reaction prompt was already answered or dismissed.");
  const reactor = adjustableActor(state, pending.actorId, scope);
  if (use && state.combat.reactionsUsed.includes(reactor.id)) {
    throw new CommandRejectedError(
      `${reactor.name} has already used a reaction this round. Decline instead, or free the reaction first.`
    );
  }
  // A creature at 0 HP can't take reactions (SRD Incapacitated / Unconscious).
  if (use && reactor.hp.current <= 0) {
    throw new CommandRejectedError(`${reactor.name} is down (0 HP) and can't take reactions.`);
  }

  const base = {
    actorId: reactor.id,
    actorName: reactor.name,
    actionName: pending.actionName,
    sourceName: pending.sourceName,
    proposedDamage: pending.proposedDamage,
    kind: pending.kind
  };
  const clearPrompt = (markUsed: boolean) => {
    state.combat = {
      ...state.combat,
      pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId),
      ...(markUsed
        ? { reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== reactor.id), reactor.id] }
        : {})
    };
  };

  if (pending.kind === "leaves-reach") {
    if (!use) {
      clearPrompt(false);
      return { ...base, used: false, appliedDamage: 0, events: [] };
    }
    const mover = pending.targetActorId
      ? state.actors.find((candidate) => candidate.id === pending.targetActorId)
      : undefined;
    if (!mover) {
      clearPrompt(false);
      throw new CommandRejectedError("The mover is no longer in the fight.");
    }
    const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
    // Effective actions, so a magic weapon's derived attack resolves by id and is found as `fallbackMelee`.
    const available = effectiveActions(definition, reactor, deps.catalog);
    const declared = actionId ? available.find((candidate) => candidate.id === actionId) : undefined;
    const fallbackMelee = available.find(
      (candidate) => candidate.attack !== undefined && candidate.attack.reachFeet !== undefined
    );
    const chosen = declared ?? fallbackMelee ?? builtinAction("unarmed-strike")!;
    const isBuiltin = declared === undefined && fallbackMelee === undefined;
    const commit = attackOptions.commit ?? true;
    // One melee attack against the mover. A preview (commit:false) rolls but spends and applies nothing;
    // the commit spends the reaction and applies damage. No distance function: the engine moves the token
    // before the SRD's "right before it leaves reach", so range-checking the arrival would wrongly block it.
    const resolution = resolveDefinitionAction(
      state,
      chosen,
      {
        actorId: reactor.id,
        targetIds: [mover.id],
        commandId,
        builtin: isBuiltin,
        rollMode: attackOptions.rollMode ?? null,
        override: null,
        commit,
        attackNatural: attackOptions.attackNatural,
        // The resolver can't infer an opportunity attack from the action, so announce it for `attack-kind-is` riders.
        attackKinds: ["reaction", "opportunity"]
      },
      {
        random: deps.random,
        newRollId: deps.newRollId,
        gmSessionId: deps.gmSessionId,
        now: deps.now,
        definition,
        resolveDefinition: deps.resolveDefinition,
        catalog: deps.catalog
      }
    );
    if (!commit) return { ...base, used: false, appliedDamage: 0, resolution, events: [] };
    clearPrompt(true);
    let appliedDamage = 0;
    let application: DamageApplication | null = null;
    let events: readonly EffectNarration[] = [];
    // Auto-apply the hit's damage unless the resolve parked it on a new prompt (the mover's own Uncanny Dodge).
    const parked = (resolution.reactionPrompts?.length ?? 0) > 0;
    if (
      !parked &&
      resolution.attack &&
      (resolution.attack.outcome === "hit" || resolution.attack.outcome === "crit") &&
      resolution.damageTotal > 0
    ) {
      const outcome = applyDamageDetailed(
        state,
        mover.id,
        {
          amount: resolution.damageTotal,
          parts: damagePartsOf(resolution),
          critical: resolution.crit,
          sourceName: `${reactor.name}'s ${chosen.name} (opportunity attack)`
        },
        { role: "gm" },
        {
          resolveDefinition: deps.resolveDefinition,
          newId: deps.newRollId,
          now: deps.now,
          ...(deps.catalog ? { catalog: deps.catalog } : {})
        }
      );
      appliedDamage = outcome.application.totalApplied;
      application = outcome.application;
      events = outcome.events;
    }
    return { ...base, used: true, appliedDamage, resolution, events, ...detailOf(application) };
  }

  const parts = use
    ? pending.proposedDamageParts
        .map((part) => ({ ...part, amount: Math.floor(part.amount / 2) }))
        .filter((part) => part.amount > 0)
    : [...pending.proposedDamageParts];
  const total = parts.reduce((sum, part) => sum + part.amount, 0);

  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  let events: readonly EffectNarration[] = [];
  if (total > 0) {
    const outcome = applyDamageDetailed(
      state,
      reactor.id,
      { amount: total, parts, critical: pending.critical, sourceName: pending.sourceName },
      { role: "gm" },
      {
        resolveDefinition: deps.resolveDefinition,
        newId: deps.newRollId,
        now: deps.now,
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }
    );
    appliedDamage = outcome.application.totalApplied;
    application = outcome.application;
    events = outcome.events;
  }
  clearPrompt(use);
  return { ...base, used: use, appliedDamage, events, ...detailOf(application) };
}

/** Drop a reaction prompt without applying its damage (GM housekeeping - e.g. the damage was applied manually). */
export function dismissReaction(state: GameState, reactionId: string, scope: Initiator) {
  requireGm(scope, "Only the GM can dismiss a reaction prompt.");
  if (!state.combat.pendingReactions.some((entry) => entry.id === reactionId))
    throw new CommandRejectedError("That reaction prompt was already answered or dismissed.");
  state.combat = {
    ...state.combat,
    pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId)
  };
}
