import type { ActionResolution, DamageApplication, GameState, PendingReaction } from "@vtt/domain";
import type { RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { requireGm, type Initiator } from "./authorization.js";
import { releaseHeldRoll } from "./held-rolls.js";
import { adjustableActor, applyDamageDetailed, halvedDamageParts, type DamageInput } from "./hit-points.js";
import { addEffect, makeEffect, type EffectNarration } from "./effects.js";
import { resolveDefinitionAction, type ResolveDependencies } from "./action-resolution.js";
import { builtinAction } from "./builtin-actions.js";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import type { LiveActor } from "./resolution/context.js";
import { damagePartsOf } from "./resolution/damage.js";
import { commitEconomy, planEconomy } from "./resolution/economy.js";

export type ReactionAnswerDependencies = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog: an item weapon must be findable as the opportunity attack's fallback melee. */
  catalog?: EquipmentCatalog;
  /** Dice/roll plumbing for the answers that resolve an action (a strike, or the parked attack). */
  random: RandomSource;
  newRollId: () => string;
  gmSessionId: string;
  now: () => string;
  /** Forced movement on the map (Push on an opportunity attack); absent, the GM is asked to move the token. */
  pushToken?: ResolveDependencies["pushToken"];
  /** Creature-to-creature distance, for the strike-back reactions the answer's own damage may open. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;
/** The two optional halves of a `ReactionOutcome`, spread at every return site. */
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
  kind: PendingReaction["kind"];
  /** The creature struck (an opportunity attack, Hellish Rebuke), or the attacker whose parked attack was finished. */
  other?: Readonly<{ id: string; name: string }>;
  /** The strike's full resolution, or the parked attack's once the answer finished it. */
  resolution?: ActionResolution;
  events: readonly EffectNarration[];
}>;

/** Preview/confirm options for a strike that rolls an attack (an opportunity attack, Retaliation). The strike's d20 is
 *  held on the prompt between a preview and its confirm (ADR-0012). */
export type OpportunityAttackOptions = Readonly<{
  commit?: boolean;
  /** The GM's forced mode; a player's is never passed. */
  rollMode?: "advantage" | "disadvantage" | "normal";
  /** A typed d20, already checked against the table's setting. */
  attackNatural?: number;
  /** Throw the held d20 again: Heroic Inspiration for a player, free for the GM. */
  reroll?: boolean;
  /** Push mastery's chosen distance on a hit (0 declines). */
  pushFeet?: number;
}>;

/** The key a reaction's strike holds its d20 under. */
export const reactionHoldKey = (reactionId: string) => `reaction:${reactionId}`;

/** What every answer path reads: the prompt, who answers it, and how to close it. */
type Answer = Readonly<{
  state: GameState;
  commandId: string;
  pending: PendingReaction;
  reactor: LiveActor;
  use: boolean;
  scope: Initiator;
  deps: ReactionAnswerDependencies;
  base: Pick<ReactionOutcome, "actorId" | "actorName" | "actionName" | "sourceName" | "proposedDamage" | "kind">;
  /** Drops the prompt; `markUsed` also spends the reactor's reaction. */
  clearPrompt: (markUsed: boolean) => void;
}>;

/**
 * Answers a pending reaction prompt (ADR-0020). GM answers any prompt; a player only their own
 * claimed character's.
 * - hit-by-attack (Uncanny Dodge): the parked damage applies either way; "use" spends the reaction and
 *   halves each typed part first (floor, per part, before defenses).
 * - attack-would-hit (Parry, Shield): the parked attack finishes either way, with the same die; "use" spends the
 *   reaction (and its slot or use) and raises AC first, so the attack may miss.
 * - leaves-reach (opportunity attack) and damaged-by-creature (Hellish Rebuke, Retaliation): "use" spends the
 *   reaction and strikes the creature, auto-applying damage that lands. "decline" just clears.
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
  const answer: Answer = {
    state,
    commandId,
    pending,
    reactor,
    use,
    scope,
    deps,
    base: {
      actorId: reactor.id,
      actorName: reactor.name,
      actionName: pending.actionName,
      sourceName: pending.sourceName,
      proposedDamage: pending.proposedDamage,
      kind: pending.kind
    },
    clearPrompt: (markUsed) => {
      state.combat = {
        ...state.combat,
        pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId),
        ...(markUsed
          ? { reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== reactor.id), reactor.id] }
          : {})
      };
    }
  };
  switch (pending.kind) {
    case "leaves-reach":
    case "damaged-by-creature":
      return answerStrike(answer, actionId, attackOptions);
    case "attack-would-hit":
      return answerParkedAttack(answer);
    case "hit-by-attack":
      return answerParkedDamage(answer);
  }
}

/** Damage an answer applies, through the typed pipeline and attributed to the creature that dealt it. */
function applyAnswerDamage(answer: Answer, targetId: string, input: DamageInput) {
  const { state, deps, commandId } = answer;
  return applyDamageDetailed(
    state,
    targetId,
    input,
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      newId: deps.newRollId,
      now: deps.now,
      commandId,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
    }
  );
}

/** Whether a committed resolve owes its target damage now: an attack's hit (or Graze's miss), or an action that
 *  rolls neither attack nor save (Storm's Thunder). A save's damage waits on the save prompt, and a reaction window the resolve opened
 *  (the target's Uncanny Dodge or Parry) holds it instead. */
function owesDamage(resolution: ActionResolution): boolean {
  if (resolution.preview || resolution.damageTotal <= 0 || (resolution.reactionPrompts?.length ?? 0) > 0) return false;
  // A miss owes damage only through Graze, which is already in the total.
  if (resolution.attack) return resolution.attack.outcome !== "unknown";
  return resolution.save === null;
}

/** Uncanny Dodge: the hit's damage was parked on the prompt, so both answers apply it. */
function answerParkedDamage(answer: Answer): ReactionOutcome {
  const { pending, reactor, use, base, clearPrompt } = answer;
  const parts = use ? halvedDamageParts(pending.proposedDamageParts) : [...pending.proposedDamageParts];
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  let events: readonly EffectNarration[] = [];
  if (total > 0) {
    const outcome = applyAnswerDamage(answer, reactor.id, {
      amount: total,
      parts,
      critical: pending.critical,
      sourceName: pending.sourceName,
      sourceActorId: pending.sourceActorId
    });
    appliedDamage = outcome.application.totalApplied;
    application = outcome.application;
    events = outcome.events;
  }
  clearPrompt(use);
  return { ...base, used: use, appliedDamage, events, ...detailOf(application) };
}

/** An opportunity attack or a strike back: one action against the creature the prompt names. A melee attack is the
 *  chosen one, else the first melee attack, else Unarmed Strike; Hellish Rebuke strikes with itself. An attack can be
 *  previewed (commit:false) before it lands. */
function answerStrike(
  answer: Answer,
  actionId: string | undefined,
  options: OpportunityAttackOptions
): ReactionOutcome {
  const { state, commandId, pending, reactor, use, scope, deps, base, clearPrompt } = answer;
  if (!use) {
    clearPrompt(false);
    releaseHeldRoll(state, reactionHoldKey(pending.id));
    return { ...base, used: false, appliedDamage: 0, events: [] };
  }
  const struck = pending.targetActorId
    ? state.actors.find((candidate) => candidate.id === pending.targetActorId)
    : undefined;
  if (!struck) {
    clearPrompt(false);
    throw new CommandRejectedError(
      pending.kind === "leaves-reach"
        ? "The mover is no longer in the fight."
        : `${pending.sourceName} is no longer in the fight.`
    );
  }
  const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
  // Effective actions, so a magic weapon's derived attack resolves by id and is found as `fallbackMelee`.
  const available = effectiveActions(definition, reactor, deps.catalog);
  const declared = available.find((candidate) => candidate.id === pending.actionId);
  const strikesWithItself = pending.kind === "damaged-by-creature" && declared?.reaction?.response === "strike-back";
  let chosen = declared;
  let isBuiltin = false;
  if (!strikesWithItself) {
    const picked = actionId ? available.find((candidate) => candidate.id === actionId) : undefined;
    const fallbackMelee = available.find(
      (candidate) => candidate.attack !== undefined && candidate.attack.reachFeet !== undefined
    );
    // The swing is the reaction, so it spends the reaction slot even on the reactor's own turn.
    chosen = { ...(picked ?? fallbackMelee ?? builtinAction("unarmed-strike")!), activation: "reaction" };
    isBuiltin = picked === undefined && fallbackMelee === undefined;
  }
  if (!chosen) throw new CommandRejectedError(`${reactor.name} no longer has ${pending.actionName}.`);
  const commit = chosen.attack === undefined ? true : (options.commit ?? true);
  // No distance function: the engine moves a token before the SRD's "right before it leaves reach", so range-checking
  // the arrival would wrongly block an opportunity attack, and a strike back was in range when it was offered.
  const resolution = resolveDefinitionAction(
    state,
    chosen,
    {
      actorId: reactor.id,
      targetIds: [struck.id],
      commandId,
      builtin: isBuiltin,
      rollMode: options.rollMode ?? null,
      override: null,
      commit,
      attackNatural: options.attackNatural,
      ...(options.attackNatural !== undefined ? { typedFace: true } : {}),
      // The strike's d20 is held on its prompt between a preview and the confirm.
      holdKey: reactionHoldKey(pending.id),
      ...(options.reroll === true ? { reroll: true } : {}),
      // The resolver can't infer how the attack was made from the action, so announce it for `attack-kind-is` riders.
      attackKinds: pending.kind === "leaves-reach" ? ["reaction", "opportunity"] : ["reaction"],
      ...(options.pushFeet !== undefined ? { pushFeet: options.pushFeet } : {})
    },
    {
      random: deps.random,
      newRollId: deps.newRollId,
      gmSessionId: deps.gmSessionId,
      // The answerer's own: a player's reroll spends their character's Heroic Inspiration.
      initiatorRole: scope.role,
      ...(scope.role === "player" ? { initiatorSessionId: scope.sessionId } : {}),
      now: deps.now,
      definition,
      resolveDefinition: deps.resolveDefinition,
      catalog: deps.catalog,
      ...(deps.pushToken ? { pushToken: deps.pushToken } : {})
    }
  );
  if (resolution.preview)
    return {
      ...base,
      used: false,
      appliedDamage: 0,
      other: { id: struck.id, name: struck.name },
      resolution,
      events: []
    };
  clearPrompt(true);
  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  let events: readonly EffectNarration[] = [];
  if (owesDamage(resolution)) {
    const outcome = applyAnswerDamage(answer, struck.id, {
      amount: resolution.damageTotal,
      parts: damagePartsOf(resolution),
      critical: resolution.crit,
      sourceName:
        pending.kind === "leaves-reach"
          ? `${reactor.name}'s ${chosen.name} (opportunity attack)`
          : `${reactor.name}'s ${chosen.name}`,
      sourceActorId: reactor.id
    });
    appliedDamage = outcome.application.totalApplied;
    application = outcome.application;
    events = outcome.events;
  }
  return {
    ...base,
    used: true,
    appliedDamage,
    other: { id: struck.id, name: struck.name },
    resolution,
    events,
    ...detailOf(application)
  };
}

/** Parry or Shield: the attack stopped at its roll. "use" spends the reaction and what the action costs and raises AC
 *  (against this attack, or until the reactor's next turn); either answer then finishes the attack with the same die,
 *  and a hit's damage lands. */
function answerParkedAttack(answer: Answer): ReactionOutcome {
  const { state, commandId, pending, reactor, use, deps, base, clearPrompt } = answer;
  const parked = pending.parkedAttack;
  const attacker = pending.sourceActorId
    ? state.actors.find((candidate) => candidate.id === pending.sourceActorId)
    : undefined;
  const attackerDefinition = attacker?.definitionId ? deps.resolveDefinition(attacker.definitionId) : undefined;
  const action =
    attacker && parked
      ? parked.builtin
        ? builtinAction(parked.actionId)
        : effectiveActions(attackerDefinition, attacker, deps.catalog).find(
            (candidate) => candidate.id === parked.actionId
          )
      : undefined;
  if (!attacker || !parked || !action || !state.combat.initiative.some((entry) => entry.actorId === attacker.id))
    throw new CommandRejectedError(`${pending.sourceName}'s attack can't be finished any more - dismiss the prompt.`);

  clearPrompt(false);
  let effectName: string | null = null;
  if (use) {
    const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
    const siblings = effectiveActions(definition, reactor, deps.catalog);
    const declared = siblings.find((candidate) => candidate.id === pending.actionId);
    if (!declared) throw new CommandRejectedError(`${reactor.name} no longer has ${pending.actionName}.`);
    // The reaction's own cost (Shield's slot, Protective Magic's use), checked like any resolve.
    const economy = planEconomy(
      state,
      reactor,
      declared,
      { actorId: reactor.id, targetIds: [], commandId },
      definition,
      [],
      undefined,
      siblings
    );
    commitEconomy({ state, attacker: reactor, input: {}, plan: economy.plan, overridden: economy.overridden });
    if (parked.untilNextTurn && pending.acBonus !== null) {
      // Lasts until the reactor's next turn starts, so later attacks this round meet it too.
      effectName = addEffect(
        state,
        reactor.id,
        makeEffect({
          id: `${commandId}:reaction`,
          name: declared.name,
          sourceActorId: reactor.id,
          sourceName: reactor.name,
          sourceActionId: declared.id,
          startedRound: state.combat.round,
          duration: { type: "until-source-next-turn" },
          armorClassBonus: pending.acBonus
        })
      ).name;
    }
  }
  const resolution = resolveDefinitionAction(
    state,
    action,
    {
      actorId: attacker.id,
      targetIds: [reactor.id],
      commandId,
      builtin: parked.builtin,
      conditionId: parked.conditionId,
      rollMode: null,
      override: null,
      cover: parked.cover,
      commit: true,
      ...(parked.attackNatural !== null ? { attackNatural: parked.attackNatural } : {}),
      ...(parked.attackTotal !== null ? { attackTotal: parked.attackTotal } : {}),
      attackKinds: parked.attackKinds,
      ...(parked.pushFeet !== null ? { pushFeet: parked.pushFeet } : {}),
      ...(parked.slotLevel !== null ? { slotLevel: parked.slotLevel } : {}),
      ...(parked.damageType !== null ? { damageType: parked.damageType } : {}),
      attackBonusDice: parked.bonusDice,
      ...(parked.hitOptions.length > 0 ? { hitOptions: parked.hitOptions } : {}),
      economyPaid: true,
      ...(use && effectName === null && pending.acBonus !== null
        ? { reactionAcBonus: { amount: pending.acBonus, source: pending.actionName } }
        : {})
    },
    {
      random: deps.random,
      newRollId: deps.newRollId,
      gmSessionId: deps.gmSessionId,
      initiatorRole: parked.initiatorRole,
      initiatorSessionId: parked.initiatorSessionId,
      now: deps.now,
      definition: attackerDefinition,
      // The distance it was rolled at, so a thrown weapon is still the melee or ranged swing it was.
      distanceFeet: (actorIdA, actorIdB) =>
        actorIdA === attacker.id && actorIdB === reactor.id ? parked.distanceFeet : null,
      resolveDefinition: deps.resolveDefinition,
      catalog: deps.catalog,
      ...(deps.pushToken ? { pushToken: deps.pushToken } : {})
    }
  );
  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  let events: readonly EffectNarration[] = [];
  if (owesDamage(resolution)) {
    const outcome = applyAnswerDamage(answer, reactor.id, {
      amount: resolution.damageTotal,
      parts: damagePartsOf(resolution),
      critical: resolution.crit,
      sourceName: `${attacker.name}'s ${resolution.actionName}`,
      sourceActorId: attacker.id
    });
    appliedDamage = outcome.application.totalApplied;
    application = outcome.application;
    events = outcome.events;
  }
  return {
    ...base,
    used: use,
    appliedDamage,
    other: { id: attacker.id, name: attacker.name },
    resolution,
    events,
    ...detailOf(application)
  };
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
  releaseHeldRoll(state, reactionHoldKey(reactionId));
}
