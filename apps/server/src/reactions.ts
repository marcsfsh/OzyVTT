import { reactionSpenders, reactionSpent } from "./commanded-reactions.js";
import type { ActionResolution, DamageApplication, GameState, PendingReaction } from "@vtt/domain";
import type { RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition, DamageType } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { requireGm, type Initiator } from "./authorization.js";
import { releaseHeldRoll } from "./held-rolls.js";
import { adjustableActor, applyDamageDetailed, type DamageInput } from "./hit-points.js";
import { addEffect, makeEffect, type EffectNarration } from "./effects.js";
import { resolveDefinitionAction, type ResolveDependencies } from "./action-resolution.js";
import { builtinAction, builtinActionFor } from "./builtin-actions.js";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import type { DefinitionAction, LiveActor, ResolveInput } from "./resolution/context.js";
import { damagePartsOf } from "./resolution/damage.js";
import { commitEconomy, planEconomy } from "./resolution/economy.js";
import { hiddenFrom } from "./vision/audience.js";
import { checkPlan } from "./ability-checks.js";
import { answerAbilityCheck, rollSettledCheck } from "./check-rolls.js";
import { withOneUsedUp } from "./consumables.js";
import { deriveEquipment } from "./equipment-derivation.js";
import { scrollCheckOf, scrollLostLine, scrollOfAction, scrollReading } from "./scrolls.js";
import {
  classLevelOf,
  dropFall,
  FEATHER_FALL_TAG,
  landFallWhenAnswered,
  landFeatherFall,
  reduceFall,
  type FallDeps
} from "./falling.js";
import { answerCounter as answerCounterPrompt } from "./counter-answers.js";
import { openDamageWindow, reducedParts, resistedTypeOf, respondToDamage } from "./damage-window.js";
import { recordRoll, rolledTerms } from "./roll-history.js";
import { answerAmount, type AnswerDeps } from "./roll-answers.js";
import { answerSave, type SaveAnswerDependencies, type SaveOutcome } from "./saving-throws.js";
import { swapPlaces } from "./resolution/redirect.js";
import { redirectForce } from "./deflect-redirect.js";
import { splitCreature } from "./split.js";
import { grantTeleport } from "./granted-moves.js";

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
  /** The strike's full resolution, or the parked attack's or cast's once the answer finished it. */
  resolution?: ActionResolution;
  /** A save another creature's answer met, as its confirm finished it. */
  save?: SaveOutcome;
  events: readonly EffectNarration[];
  /** casts-spell: the Counterspell stopped the cast, which dissipates. */
  countered?: boolean;
  /** casts-spell: the cast's own command, whose rolls its finish recorded. */
  castCommandId?: string;
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
  /** The extras chosen for the hit on its preview (Sneak Attack). */
  hitOptions?: ResolveInput["hitOptions"];
  /** The slot a reaction spell is cast with (Hellish Rebuke's dice, Shield's slot); absent, the lowest that can. */
  slotLevel?: number;
  /** An answer to another creature's roll that may go either way (Improve Fate) takes its die off. */
  subtract?: boolean;
  /** Redirect Attack: the ally the attack turns to. Deflect Attacks: the creature a reduction to 0 redirects at. */
  redirectTo?: string;
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
  // An answer to a roll checks its own cost (an Improve Fate takes no Reaction); every other prompt is a Reaction.
  if (use && pending.kind !== "roll-answer" && reactionSpent(state, reactor.id)) {
    throw new CommandRejectedError(
      state.combat.reactionsUsed.includes(reactor.id)
        ? `${reactor.name} has already used a reaction this round. Decline instead, or free the reaction first.`
        : `${reactor.name}'s Reaction takes its commander's, which is spent this round. Decline instead.`
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
        // A dominated creature's Reaction takes its commander's too.
        ...(markUsed
          ? {
              reactionsUsed: [
                ...state.combat.reactionsUsed.filter((id) => !reactionSpenders(state, reactor.id).includes(id)),
                ...reactionSpenders(state, reactor.id)
              ]
            }
          : {})
      };
    }
  };
  switch (pending.kind) {
    case "leaves-reach":
    case "damaged-by-creature":
      return answerStrike(answer, actionId, attackOptions);
    case "triggered":
      return answerTriggered(answer, actionId, attackOptions);
    case "attack-would-hit":
      return answerParkedAttack(answer, attackOptions.slotLevel);
    case "casts-spell":
      return answerCounter(answer, attackOptions.slotLevel);
    case "hit-by-attack":
    case "takes-damage":
      return answerParkedDamage(answer, attackOptions.redirectTo);
    case "falls":
      return answerFall(answer);
    case "roll-answer":
      return answerRoll(answer, attackOptions.subtract === true);
    case "attack-targeted":
      return answerRedirect(answer, attackOptions.redirectTo);
  }
}

/**
 * Redirect Attack or Arrow-Catching Shield: the attack held before its roll. "use" spends the reaction and what the
 * action costs and turns the attack: to the ally picked, the two swapping places where the reaction says so, or onto
 * the reactor itself. Either answer then rolls the attack at the creature it ends at, and a hit's damage lands.
 */
function answerRedirect(answer: Answer, redirectTo: string | undefined): ReactionOutcome {
  const { state, commandId, pending, reactor, use, deps, clearPrompt } = answer;
  const { parked } = parkedAttackOf(answer);
  const choices = pending.redirectChoices ?? [];
  const picked =
    use && choices.length > 0 ? (redirectTo ?? (choices.length === 1 ? choices[0]!.actorId : undefined)) : undefined;
  if (use && choices.length > 0 && !choices.some((choice) => choice.actorId === picked))
    throw new CommandRejectedError(`Choose the ally ${pending.actionName} turns the attack to.`);
  const ally = picked
    ? state.actors.find((candidate) => candidate.id === picked && candidate.hp.current > 0)
    : undefined;
  if (picked && !ally) throw new CommandRejectedError("That ally can't take the attack any more. Choose another.");
  clearPrompt(false);
  const events: EffectNarration[] = [];
  let targetId = pending.targetActorId ?? reactor.id;
  if (use) {
    const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
    const siblings = effectiveActions(definition, reactor, deps.catalog);
    const declared = siblings.find((candidate) => candidate.id === pending.actionId);
    if (!declared) throw new CommandRejectedError(`${reactor.name} no longer has ${pending.actionName}.`);
    // The reaction's own cost, checked like any resolve.
    const economy = planEconomy(
      state,
      reactor,
      declared,
      { actorId: reactor.id, targetIds: [], commandId },
      definition,
      [],
      undefined,
      siblings,
      false,
      deps.catalog
    );
    commitEconomy({ state, attacker: reactor, input: {}, plan: economy.plan, overridden: economy.overridden });
    if (ally) {
      if (declared.reaction?.response === "redirect-to-ally" && declared.reaction.swap)
        swapPlaces(state, reactor.id, ally.id);
      targetId = ally.id;
      events.push({
        kind: "reaction",
        text:
          declared.reaction?.response === "redirect-to-ally" && declared.reaction.swap
            ? `${reactor.name} and ${ally.name} swap places, and ${ally.name} becomes the target of ${pending.sourceName}'s attack (${declared.name}).`
            : `${ally.name} becomes the target of ${pending.sourceName}'s attack (${declared.name}).`,
        actorId: reactor.id
      });
    } else {
      targetId = reactor.id;
      events.push({
        kind: "reaction",
        text: `${reactor.name} becomes the target of ${pending.sourceName}'s attack (${declared.name}).`,
        actorId: reactor.id
      });
    }
  }
  const finished = replayParkedAttack(answer, {
    targetId,
    bonusDice: parked.bonusDice,
    extra: { redirectSettled: true, ...(pending.asked ? { answersAsked: pending.asked } : {}) }
  });
  return { ...finished, used: use, events: [...events, ...finished.events] };
}

/** The deps a fall lands with, from the answer's. */
const fallDepsOf = ({ deps, commandId }: Answer): FallDeps => ({
  resolveDefinition: deps.resolveDefinition,
  ...(deps.catalog ? { catalog: deps.catalog } : {}),
  random: deps.random,
  newId: deps.newRollId,
  now: deps.now,
  commandId,
  ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
});

/**
 * A fall's reaction (SRD Feather Fall, Slow Fall): "use" casts Feather Fall at the falling creature, which then lands
 * unharmed, or takes the Slow Fall's reduction off the fall's damage. Once every prompt the fall opened is answered,
 * the fall lands.
 */
function answerFall(answer: Answer): ReactionOutcome {
  const { state, commandId, pending, reactor, use, scope, deps, base, clearPrompt } = answer;
  const fallId = pending.triggerCommandId;
  let resolution: ActionResolution | undefined;
  if (use) {
    const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
    const declared = effectiveActions(definition, reactor, deps.catalog).find(
      (candidate) => candidate.id === pending.actionId
    );
    const reaction = declared?.reaction;
    if (!declared || reaction?.trigger !== "falls") {
      clearPrompt(false);
      throw new CommandRejectedError(`${reactor.name} no longer has ${pending.actionName}.`);
    }
    if (reaction.response === "reduce-fall-damage") {
      reduceFall(state, fallId, reaction.perLevel * classLevelOf(definition, reaction.classId));
      clearPrompt(true);
    } else {
      // The cast spends its slot and the Reaction, and its Feather Fall lands on the falling creature.
      const fallerId = pending.targetActorId ?? reactor.id;
      resolution = resolveDefinitionAction(
        state,
        { ...declared, activation: "reaction" },
        { actorId: reactor.id, targetIds: [fallerId], commandId, rollMode: null, override: null, commit: true },
        {
          random: deps.random,
          newRollId: deps.newRollId,
          gmSessionId: deps.gmSessionId,
          initiatorRole: scope.role,
          ...(scope.role === "player" ? { initiatorSessionId: scope.sessionId } : {}),
          now: deps.now,
          definition,
          resolveDefinition: deps.resolveDefinition,
          catalog: deps.catalog
        }
      );
      const faller = state.actors.find((actor) => actor.id === fallerId);
      if (faller && !faller.effects.some((effect) => effect.tags.includes(FEATHER_FALL_TAG)))
        landFeatherFall(state, fallerId, reactor.id, reactor.name, `${commandId}:feather-fall`);
      clearPrompt(true);
    }
  } else clearPrompt(false);
  const events = landFallWhenAnswered(state, fallId, fallDepsOf(answer));
  return { ...base, used: use, appliedDamage: 0, events, ...(resolution ? { resolution } : {}) };
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
      rollDie: deps.random,
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

/** The damage a damage reaction holds, applied either way: halved (Uncanny Dodge), less a rolled amount (Deflect
 *  Attacks, Stone's Endurance) or met with Resistance to its type until the turn ends (Superior Hunter's Defense) when
 *  used. The reaction's own cost (a use, a recharge) is spent with its Reaction. Deflect Attacks brought to 0 turns
 *  the force on the creature picked (`deflect-redirect.ts`). */
function answerParkedDamage(answer: Answer, redirectTo: string | undefined): ReactionOutcome {
  const { state, commandId, pending, reactor, use, deps, base, clearPrompt } = answer;
  let parts = [...pending.proposedDamageParts];
  const events: EffectNarration[] = [];
  const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
  const siblings = effectiveActions(definition, reactor, deps.catalog);
  const declared = use ? siblings.find((candidate) => candidate.id === pending.actionId) : undefined;
  // Deflect Missile's redirect: the creature picked, else the attacker when it may be, else the only one there is.
  const choices = pending.redirectChoices ?? [];
  const redirectAt =
    redirectTo ??
    (choices.some((choice) => choice.actorId === pending.sourceActorId)
      ? (pending.sourceActorId ?? undefined)
      : choices.length === 1
        ? choices[0]!.actorId
        : undefined);
  if (use && redirectTo !== undefined && !choices.some((choice) => choice.actorId === redirectTo))
    throw new CommandRejectedError(`${pending.actionName} can't turn the force on that creature. Choose another.`);
  if (use) {
    if (declared) {
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
    }
    const response = pending.damageResponse ?? { kind: "half" as const };
    const answered = respondToDamage(parts, response, deps.random);
    parts = answered.parts;
    if (answered.rolled)
      recordRoll(state, {
        id: deps.newRollId(),
        commandId,
        initiatorSessionId: deps.gmSessionId,
        initiatorRole: answer.scope.role,
        initiatorLabel: reactor.name,
        label: `${pending.actionName}: damage reduced`.slice(0, 80),
        actorId: reactor.id,
        purpose: "damage",
        visibility: reactor.visibility === "public" ? "public" : "gm-only",
        formula: answered.rolled.expression.source,
        normalizedFormula: answered.rolled.expression.normalized,
        ...rolledTerms(answered.rolled),
        total: answered.rolled.total,
        createdAt: deps.now()
      });
    const resisted = response.kind === "resist" ? resistedTypeOf(parts) : null;
    if (resisted) {
      // "Resistance to that damage and any other damage of the same type until the end of the current turn."
      const turnActorId = state.combat.turnActorId;
      const turnActor = state.actors.find((actor) => actor.id === turnActorId);
      const own = turnActorId === reactor.id || !turnActor;
      addEffect(
        state,
        reactor.id,
        makeEffect({
          id: `${commandId}:resist`,
          name: `${pending.actionName} (${resisted[0]!.toUpperCase()}${resisted.slice(1)})`.slice(0, 120),
          sourceActorId: own ? reactor.id : turnActor!.id,
          sourceName: own ? reactor.name : turnActor!.name,
          sourceActionId: pending.actionId,
          startedRound: state.combat.round,
          duration: own
            ? { type: "until-bearer-turn-end", skipsCurrentTurn: false }
            : { type: "until-source-turn-end", skipsCurrentTurn: false },
          modifiers: [{ type: "damage-resistance", damageTypes: [resisted as DamageType] }]
        })
      );
    }
    const redirected = redirectForce(
      state,
      {
        reactor,
        pending,
        redirectTo,
        remaining: parts.reduce((sum, part) => sum + part.amount, 0),
        commandId,
        role: answer.scope.role
      },
      deps
    );
    if (redirected) events.push(redirected);
  }
  clearPrompt(use);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  if (total > 0) {
    const outcome = applyAnswerDamage(answer, reactor.id, {
      amount: total,
      parts,
      critical: pending.critical,
      sourceName: pending.sourceName,
      sourceActorId: pending.sourceActorId,
      ...(pending.drain ? { drain: pending.drain } : {})
    });
    appliedDamage = outcome.application.totalApplied;
    application = outcome.application;
    events.push(...outcome.events);
  }
  // "If that damage is reduced to 0, the giant can redirect some of the attack's force": the action's own save, at the
  // creature picked, as part of the same Reaction.
  const redirects = declared?.reaction?.response === "reduce-damage" && declared.reaction.redirect === true;
  if (use && redirects && total === 0 && declared?.save && redirectAt !== undefined) {
    const resolution = resolveDefinitionAction(
      state,
      declared,
      {
        actorId: reactor.id,
        targetIds: [redirectAt],
        commandId,
        builtin: false,
        rollMode: null,
        override: null,
        commit: true,
        economyPaid: true,
        attackKinds: ["reaction"]
      },
      resolveDepsOf(answer, definition)
    );
    const struck = state.actors.find((candidate) => candidate.id === redirectAt);
    return {
      ...base,
      used: use,
      appliedDamage,
      resolution,
      events,
      ...(struck ? { other: { id: struck.id, name: struck.name } } : {}),
      ...detailOf(application)
    };
  }
  return { ...base, used: use, appliedDamage, events, ...detailOf(application) };
}

/**
 * A stat block's reaction to something other than a hit's damage (`triggered-reactions.ts`): what "use" does is its
 * declared response's. A strike back resolves the action against the creature that set it off (a rust monster's
 * Reflexive Antennae, a chain devil's Unnerving Gaze); the rest act on the reactor (`answerOnSelf`, `answerPursuit`,
 * `splitCreature`). "decline" just clears.
 */
function answerTriggered(
  answer: Answer,
  actionId: string | undefined,
  options: OpportunityAttackOptions
): ReactionOutcome {
  const { state, pending, reactor, use, deps, base, clearPrompt } = answer;
  if (!use) {
    clearPrompt(false);
    return { ...base, used: false, appliedDamage: 0, events: [] };
  }
  const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
  const available = effectiveActions(definition, reactor, deps.catalog);
  const declared = available.find((candidate) => candidate.id === pending.actionId);
  const reaction = declared?.reaction;
  if (!declared || !reaction) {
    clearPrompt(false);
    throw new CommandRejectedError(`${reactor.name} no longer has ${pending.actionName}.`);
  }
  if (reaction.response === "strike-back") return answerStrike(answer, actionId, options);
  if (reaction.response === "use-on-self") return answerOnSelf(answer, declared, definition);
  if (reaction.response === "teleport-near")
    return answerPursuit(answer, declared, available, definition, reaction.nearFeet, reaction.usesAction);
  if (reaction.response === "split") {
    clearPrompt(true);
    const events = splitCreature(state, reactor, {
      resolveDefinition: deps.resolveDefinition,
      newId: deps.newRollId,
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    });
    return { ...base, used: true, appliedDamage: 0, events };
  }
  clearPrompt(false);
  throw new CommandRejectedError(`${pending.actionName} doesn't answer this.`);
}

/** The dependencies a reaction's own resolve takes. */
function resolveDepsOf(answer: Answer, definition: ActorDefinition | undefined): ResolveDependencies {
  const { deps, scope } = answer;
  return {
    random: deps.random,
    newRollId: deps.newRollId,
    gmSessionId: deps.gmSessionId,
    initiatorRole: scope.role,
    ...(scope.role === "player" ? { initiatorSessionId: scope.sessionId } : {}),
    now: deps.now,
    definition,
    resolveDefinition: deps.resolveDefinition,
    catalog: deps.catalog,
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
    ...(deps.pushToken ? { pushToken: deps.pushToken } : {})
  };
}

/** An octopus's Ink Cloud: the action resolves on its user, its area centred where it stands ("ink that fills a
 *  5-foot Cube centered on itself") and its move granted ("the octopus moves up to its Swim Speed"). */
function answerOnSelf(
  answer: Answer,
  declared: DefinitionAction,
  definition: ActorDefinition | undefined
): ReactionOutcome {
  const { state, commandId, reactor, base, clearPrompt } = answer;
  const at = state.combat.tokens.find((token) => token.actorId === reactor.id)?.position;
  const resolution = resolveDefinitionAction(
    state,
    declared,
    {
      actorId: reactor.id,
      targetIds: [],
      commandId,
      builtin: false,
      rollMode: null,
      override: null,
      commit: true,
      attackKinds: ["reaction"],
      ...(at && declared.area ? { areaAt: { x: at.x, y: at.y } } : {})
    },
    resolveDepsOf(answer, definition)
  );
  clearPrompt(true);
  return { ...base, used: true, appliedDamage: 0, resolution, events: [] };
}

/** A nalfeshnee's Pursuit: "The nalfeshnee uses Teleport, but its destination space must be within 10 feet of the
 *  triggering creature." The sibling Teleport resolves as the Reaction, and its grant keeps to that space. */
function answerPursuit(
  answer: Answer,
  declared: DefinitionAction,
  available: readonly DefinitionAction[],
  definition: ActorDefinition | undefined,
  nearFeet: number,
  usesAction: string
): ReactionOutcome {
  const { state, commandId, pending, reactor, base, clearPrompt } = answer;
  const quarry = pending.targetActorId
    ? state.actors.find((candidate) => candidate.id === pending.targetActorId)
    : undefined;
  if (!quarry || !state.combat.initiative.some((entry) => entry.actorId === quarry.id)) {
    clearPrompt(false);
    throw new CommandRejectedError(`${pending.sourceName} is no longer in the fight.`);
  }
  const sibling = available.find((candidate) => candidate.id === usesAction);
  if (!sibling?.teleport) {
    clearPrompt(false);
    throw new CommandRejectedError(`${reactor.name} no longer has the teleport ${declared.name} uses.`);
  }
  const resolution = resolveDefinitionAction(
    state,
    { ...sibling, activation: "reaction" },
    {
      actorId: reactor.id,
      targetIds: [],
      commandId,
      builtin: false,
      rollMode: null,
      override: null,
      commit: true,
      attackKinds: ["reaction"]
    },
    resolveDepsOf(answer, definition)
  );
  // The grant the teleport left keeps to the space near the creature it follows.
  reactor.effects = reactor.effects.map((effect) =>
    effect.grantedTeleport
      ? { ...effect, grantedTeleport: { ...effect.grantedTeleport, near: { actorId: quarry.id, feet: nearFeet } } }
      : effect
  );
  clearPrompt(true);
  return {
    ...base,
    used: true,
    appliedDamage: 0,
    other: { id: quarry.id, name: quarry.name },
    resolution,
    events: [
      {
        kind: "reaction",
        text: `${reactor.name} may teleport to a space within ${nearFeet} ft of ${quarry.name}.`,
        actorId: reactor.id,
        source: { actorId: quarry.id, name: quarry.name }
      }
    ]
  };
}

/** The Unarmed Strike's options: each is one melee attack an opportunity attack can be. */
const UNARMED_OPTIONS: readonly string[] = [
  "unarmed-strike",
  "unarmed-grapple",
  "unarmed-shove-prone",
  "unarmed-shove-push"
];

/** SRD Opportunity Attacks (and Retaliation): "one melee attack with a weapon or an Unarmed Strike". A spell attack,
 *  a ranged shot, a Multiattack plan, a legendary action or an extra attack that rides the Attack action isn't. */
function meleeSwing(candidate: DefinitionAction): boolean {
  if (UNARMED_OPTIONS.includes(candidate.id)) return true;
  return (
    candidate.attack?.reachFeet !== undefined &&
    candidate.spellId === undefined &&
    candidate.multiattack === undefined &&
    candidate.legendary === undefined &&
    candidate.extraAttack === undefined
  );
}

/** An opportunity attack or a strike back: one action against the creature the prompt names. A melee attack is the
 *  chosen one, else the first melee attack, else Unarmed Strike; Hellish Rebuke strikes with itself. An attack can be
 *  previewed (commit:false) before it lands, and the extras its hit can carry (Sneak Attack) are chosen with the
 *  confirm. */
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
  const strikesWithItself =
    (pending.kind === "damaged-by-creature" || pending.kind === "triggered") &&
    declared?.reaction?.response === "strike-back";
  let chosen = declared;
  let isBuiltin = false;
  if (!strikesWithItself) {
    // An Unarmed Strike's options (Grapple, Shove) are the generic ones unless the sheet has its own strike.
    const unarmedOption = actionId !== undefined && UNARMED_OPTIONS.includes(actionId);
    const picked = actionId
      ? (available.find((candidate) => candidate.id === actionId) ??
        (unarmedOption ? builtinAction(actionId) : undefined))
      : undefined;
    if (picked && !meleeSwing(picked))
      throw new CommandRejectedError(
        `${pending.kind === "leaves-reach" ? "An opportunity attack" : pending.actionName} is one melee attack with a weapon or an Unarmed Strike, and ${picked.name} isn't one.`
      );
    const fallbackMelee = available.find(meleeSwing);
    // The swing is the reaction, so it spends the reaction slot even on the reactor's own turn.
    chosen = { ...(picked ?? fallbackMelee ?? builtinAction("unarmed-strike")!), activation: "reaction" };
    isBuiltin = picked ? !available.includes(picked) : fallbackMelee === undefined;
  }
  // A reaction that uses another of its actions (a rust monster's Reflexive Antennae uses Antennae) spends its Reaction.
  const uses =
    strikesWithItself && declared?.reaction?.response === "strike-back" ? declared.reaction.usesAction : undefined;
  if (uses) {
    const sibling = available.find((candidate) => candidate.id === uses);
    chosen = sibling ? { ...sibling, activation: "reaction" } : undefined;
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
      ...(options.pushFeet !== undefined ? { pushFeet: options.pushFeet } : {}),
      ...(options.hitOptions ? { hitOptions: options.hitOptions } : {}),
      // A reaction spell cast with a higher slot rolls that slot's dice (Hellish Rebuke's 3d10 from level 2).
      ...(options.slotLevel !== undefined && chosen.spellSlot ? { slotLevel: options.slotLevel } : {}),
      // A gaze met as the creature's turn starts lasts "until the end of its turn": this one.
      ...(pending.kind === "triggered" && pending.cause === "turn-start" ? { currentTurnOf: struck.id } : {})
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
      sourceActorId: reactor.id,
      ...(chosen.drain ? { drain: chosen.drain } : {})
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

/**
 * A Spell Scroll read as the reaction (Shield from a scroll): the scroll is used up, and a spell above the reader's
 * levels needs its check first, a failure losing the spell with the scroll (SRD Spell Scroll). Null when the spell is
 * cast (or no scroll was read), else the line the table reads.
 */
function scrollReadAsReaction(answer: Answer, declared: DefinitionAction): EffectNarration | null {
  const { state, commandId, reactor, scope, deps } = answer;
  const scroll = scrollOfAction(declared, reactor.inventory, deps.catalog);
  if (!scroll) return null;
  reactor.inventory = withOneUsedUp(reactor.inventory, scroll.row.id);
  const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
  const reading = scrollReading(definition, scroll.spell, deps.catalog);
  if (!reading.readable || reading.check === null) return null;
  const check = scrollCheckOf(reading.check, scroll.spell.name);
  const plan = checkPlan(reactor, definition, deriveEquipment(reactor, definition, deps.catalog), check.subject);
  const rolled = rollSettledCheck(
    state,
    reactor,
    plan,
    {
      id: deps.newRollId(),
      commandId,
      sessionId: scope.role === "player" ? scope.sessionId : deps.gmSessionId,
      role: scope.role,
      label: check.label,
      visibility: reactor.visibility === "gm-only" ? "gm-only" : "public",
      createdAt: deps.now()
    },
    deps.random
  );
  return rolled.total >= reading.check.dc
    ? null
    : { kind: "reaction", text: scrollLostLine(reactor.name, scroll.spell.name), actorId: reactor.id };
}

/** Counterspell: the cast waits on every prompt it opened; see `counter-answers.ts`. */
function answerCounter(answer: Answer, slotLevel: number | undefined): ReactionOutcome {
  const outcome = answerCounterPrompt(answer, slotLevel);
  return {
    ...answer.base,
    used: outcome.used,
    appliedDamage: outcome.appliedDamage,
    other: outcome.caster,
    ...(outcome.resolution ? { resolution: outcome.resolution } : {}),
    events: outcome.events,
    countered: outcome.countered,
    castCommandId: outcome.castCommandId
  };
}

/** The attack a prompt holds at its roll, with its attacker and action, or a refusal when it can't be finished. */
function parkedAttackOf(answer: Answer) {
  const { state, pending, deps } = answer;
  const parked = pending.parkedAttack;
  const attacker = pending.sourceActorId
    ? state.actors.find((candidate) => candidate.id === pending.sourceActorId)
    : undefined;
  const attackerDefinition = attacker?.definitionId ? deps.resolveDefinition(attacker.definitionId) : undefined;
  const action =
    attacker && parked
      ? parked.builtin
        ? builtinActionFor(attackerDefinition, parked.actionId, attacker)
        : effectiveActions(attackerDefinition, attacker, deps.catalog).find(
            (candidate) => candidate.id === parked.actionId
          )
      : undefined;
  if (!attacker || !parked || !action || !state.combat.initiative.some((entry) => entry.actorId === attacker.id)) {
    // An attacker hidden from whoever answers stays unnamed, as the prompt itself shows it.
    const hidden =
      pending.sourceActorId === null ||
      hiddenFrom(
        state,
        { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) },
        answer.scope.role === "player" ? answer.scope.sessionId : undefined
      )(pending.sourceActorId);
    throw new CommandRejectedError(
      `${hidden ? "The" : `${pending.sourceName}'s`} attack can't be finished any more. Dismiss the prompt.`
    );
  }
  return { attacker, attackerDefinition, action, parked };
}

/** Finishes an attack a prompt held at its roll, with the same die and the dice it carries, against `targetId`; a hit's
 *  damage lands unless a reaction window the finish opened holds it. */
function replayParkedAttack(
  answer: Answer,
  finish: Readonly<{
    targetId: string;
    bonusDice: NonNullable<ResolveInput["attackBonusDice"]>;
    extra: Partial<ResolveInput>;
  }>
): ReactionOutcome {
  const { state, commandId, deps, base } = answer;
  const { attacker, attackerDefinition, action, parked } = parkedAttackOf(answer);
  const resolution = resolveDefinitionAction(
    state,
    action,
    {
      actorId: attacker.id,
      targetIds: [finish.targetId],
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
      attackBonusDice: finish.bonusDice,
      ...(parked.hitOptions.length > 0 ? { hitOptions: parked.hitOptions } : {}),
      ...(parked.forgoneAdvantageBy !== undefined ? { forgoneAdvantageBy: parked.forgoneAdvantageBy } : {}),
      ...(parked.knockOut === true ? { knockOut: true } : {}),
      ...(parked.shaping ? { shaping: parked.shaping } : {}),
      economyPaid: true,
      ...finish.extra
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
        actorIdA === attacker.id && actorIdB === finish.targetId ? parked.distanceFeet : null,
      resolveDefinition: deps.resolveDefinition,
      catalog: deps.catalog,
      ...(deps.pushToken ? { pushToken: deps.pushToken } : {})
    }
  );
  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  let events: readonly EffectNarration[] = [];
  if (owesDamage(resolution)) {
    const outcome = applyAnswerDamage(answer, finish.targetId, {
      amount: resolution.damageTotal,
      parts: damagePartsOf(resolution),
      critical: resolution.crit,
      sourceName: `${attacker.name}'s ${resolution.actionName}`,
      sourceActorId: attacker.id,
      ...(action.drain ? { drain: action.drain } : {})
    });
    appliedDamage = outcome.application.totalApplied;
    application = outcome.application;
    events = outcome.events;
  }
  return {
    ...base,
    used: false,
    appliedDamage,
    other: { id: attacker.id, name: attacker.name },
    resolution,
    events,
    ...detailOf(application)
  };
}

/** Parry or Shield: the attack stopped at its roll. "use" spends the reaction and what the action costs and raises AC
 *  (against this attack, or until the reactor's next turn); either answer then finishes the attack with the same die,
 *  and a hit's damage lands. */
function answerParkedAttack(answer: Answer, slotLevel: number | undefined): ReactionOutcome {
  const { state, commandId, pending, reactor, use, deps, clearPrompt } = answer;
  const { parked } = parkedAttackOf(answer);
  // A guardian's ward (Shield Guardian's Protection): the attack is at another creature, whose AC the reaction raises.
  const defender = pending.targetActorId
    ? state.actors.find((candidate) => candidate.id === pending.targetActorId)
    : reactor;
  if (!defender)
    throw new CommandRejectedError(`${pending.sourceName}'s attack can't be finished any more. Dismiss the prompt.`);
  clearPrompt(false);
  let effectName: string | null = null;
  // Whether the AC rises: the reaction is used, and a scroll it was read from didn't lose the spell.
  let raised = use;
  let scrollLost: EffectNarration | null = null;
  let teleportLine: EffectNarration | null = null;
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
      { actorId: reactor.id, targetIds: [], commandId, ...(slotLevel !== undefined ? { slotLevel } : {}) },
      definition,
      [],
      undefined,
      siblings,
      false,
      deps.catalog
    );
    commitEconomy({ state, attacker: reactor, input: {}, plan: economy.plan, overridden: economy.overridden });
    scrollLost = scrollReadAsReaction(answer, declared);
    raised = scrollLost === null;
    if (raised && parked.untilNextTurn && pending.acBonus !== null) {
      // Lasts until the reactor's next turn starts, so later attacks this round meet it too.
      effectName = addEffect(
        state,
        defender.id,
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
    // Whirlwind of Sand: "the mummy teleports up to 60 feet to an unoccupied space it can see", with the same answer.
    if (raised && declared.teleport) {
      grantTeleport(state, reactor, { id: `${commandId}:teleport`, name: declared.name, teleport: declared.teleport });
      teleportLine = {
        kind: "effect",
        text: `${reactor.name} may teleport up to ${declared.teleport.feet} ft to an unoccupied space it can see.`,
        actorId: reactor.id
      };
    }
  }
  const finished = replayParkedAttack(answer, {
    targetId: defender.id,
    bonusDice: parked.bonusDice,
    extra: {
      acSettled: true,
      ...(pending.asked ? { answersAsked: pending.asked } : {}),
      ...(raised && effectName === null && pending.acBonus !== null
        ? { reactionAcBonus: { amount: pending.acBonus, source: pending.actionName } }
        : {})
    }
  });
  const before = [scrollLost, teleportLine].filter((line): line is EffectNarration => line !== null);
  return { ...finished, used: use, events: [...before, ...finished.events] };
}

/** What an answer to a roll needs from the reaction's own dependencies. */
function answerDepsFrom(answer: Answer): AnswerDeps {
  const { deps, commandId, scope } = answer;
  return {
    resolveDefinition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    random: deps.random,
    newRollId: deps.newRollId,
    sessionId: deps.gmSessionId,
    role: scope.role,
    now: deps.now,
    commandId,
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
  };
}

/**
 * Another creature's answer to a roll (Cutting Words, Countercharm, Improve Fate, Burst of Ingenuity). "use" applies it
 * and spends its cost; either answer then hands the roll on: to the next creature that may answer it, else to what the
 * roll does. A save waiting on its confirm is confirmed; an attack waiting at its roll is finished with the answer's
 * die added; a check is amended; a hit's damage moves on to the damaged creature's own reaction, or lands.
 */
function answerRoll(answer: Answer, subtract: boolean): ReactionOutcome {
  const { state, commandId, pending, reactor, use, deps, base, clearPrompt } = answer;
  const roller = pending.sourceActorId ? state.actors.find((actor) => actor.id === pending.sourceActorId) : undefined;
  const choice = { id: pending.actionId, ...(subtract ? { subtract: true } : {}) };
  clearPrompt(false);
  if (!roller) return { ...base, used: false, appliedDamage: 0, events: [] };
  switch (pending.rollKind) {
    case "save":
      return answerSaveRoll(answer, roller, choice);
    case "check": {
      const checkDeps = {
        random: deps.random,
        newId: deps.newRollId,
        sessionId: deps.gmSessionId,
        now: deps.now,
        resolveDefinition: deps.resolveDefinition,
        commandId,
        ...(deps.catalog ? { catalog: deps.catalog } : {}),
        ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
      };
      if (!use) return { ...base, used: false, appliedDamage: 0, events: [] };
      const result = answerAbilityCheck(
        state,
        { role: "gm" },
        { commandId, actorId: roller.id, answer: { ...choice, by: reactor.id } },
        checkDeps
      );
      return { ...base, used: true, appliedDamage: 0, events: [...result.events] };
    }
    case "attack":
      return answerAttackRoll(answer, roller, choice);
    case "damage":
      return answerDamageRoll(answer, roller, choice);
    default:
      return { ...base, used: false, appliedDamage: 0, events: [] };
  }
}

/** A save waiting on its confirm: the answer meets the held die, then the confirm is finished (or waits on the next
 *  creature that may answer it). */
function answerSaveRoll(answer: Answer, roller: LiveActor, choice: Readonly<{ id: string; subtract?: boolean }>) {
  const { state, commandId, pending, reactor, use, deps, base } = answer;
  const save = state.combat.pendingSaves.find((entry) => entry.id === pending.saveId);
  if (!save) return { ...base, used: false, appliedDamage: 0, events: [] };
  const saveDeps: SaveAnswerDependencies = {
    random: deps.random,
    newRollId: deps.newRollId,
    sessionId: deps.gmSessionId,
    role: answer.scope.role,
    now: deps.now,
    resolveDefinition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
    ...(deps.pushToken
      ? {
          pushToken: (input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number }>) =>
            deps.pushToken!(input)
        }
      : {})
  };
  const confirmed = save.confirmed;
  const events: EffectNarration[] = [];
  if (use)
    events.push(
      ...answerSave(
        state,
        commandId,
        save.id,
        "roll",
        undefined,
        false,
        { role: "gm" },
        saveDeps,
        false,
        confirmed?.rollMode,
        confirmed?.damageOverride,
        { answer: { ...choice, by: reactor.id } }
      ).events
    );
  const finished = answerSave(
    state,
    commandId,
    save.id,
    "roll",
    undefined,
    true,
    { role: "gm" },
    saveDeps,
    false,
    confirmed?.rollMode,
    confirmed?.damageOverride,
    { settling: true }
  );
  events.push(...finished.events);
  return {
    ...base,
    used: use,
    appliedDamage: finished.outcome.appliedDamage,
    other: { id: roller.id, name: roller.name },
    save: finished.outcome,
    events,
    ...(finished.outcome.parts ? { parts: finished.outcome.parts } : {})
  };
}

/** An attack waiting at its roll: the answer's die joins the roll, and the attack is finished with the same die (its
 *  target's Parry or Shield, or the next creature's answer, may still wait on it). */
function answerAttackRoll(answer: Answer, roller: LiveActor, choice: Readonly<{ id: string; subtract?: boolean }>) {
  const { state, pending, reactor, use } = answer;
  const parked = pending.parkedAttack;
  const events: EffectNarration[] = [];
  let bonusDice = parked?.bonusDice ?? [];
  if (use && parked) {
    const answered = answerAmount(
      state,
      {
        kind: "attack",
        roller,
        key: `parked:${pending.id}`,
        natural: parked.attackNatural ?? 0,
        total: 0,
        // Whether the roll succeeds was read when the answer was offered.
        threshold: null,
        mode: "normal",
        purpose: "attack",
        label: "attack roll",
        visibility: roller.visibility === "public" ? "public" : "gm-only"
      },
      reactor,
      choice,
      answerDepsFrom(answer)
    );
    events.push(...answered.events);
    bonusDice = [
      ...bonusDice,
      { label: answered.name, dice: answered.amount.slice(0, 8), total: Math.max(-48, Math.min(48, answered.bonus)) }
    ];
  }
  const finished = replayParkedAttack(answer, {
    targetId: pending.targetActorId ?? reactor.id,
    bonusDice,
    extra: { answersAsked: pending.asked ?? [] }
  });
  return { ...finished, used: use, events: [...events, ...finished.events] };
}

/** A hit's damage roll: the answer's die comes off it (Cutting Words), and the damage moves on to whoever may still act
 *  on it, else lands on its target. */
function answerDamageRoll(answer: Answer, roller: LiveActor, choice: Readonly<{ id: string; subtract?: boolean }>) {
  const { state, pending, reactor, use, deps, base } = answer;
  const target = state.actors.find((actor) => actor.id === pending.targetActorId);
  if (!target) return { ...base, used: false, appliedDamage: 0, events: [] };
  let parts: Array<{ amount: number; type: string }> = pending.proposedDamageParts.map((part) => ({ ...part }));
  const events: EffectNarration[] = [];
  if (use) {
    const answered = answerAmount(
      state,
      {
        kind: "damage",
        roller,
        key: `parked:${pending.id}`,
        natural: 0,
        total: parts.reduce((sum, part) => sum + part.amount, 0),
        threshold: null,
        mode: "normal",
        purpose: "damage",
        label: "damage roll",
        visibility: roller.visibility === "public" ? "public" : "gm-only"
      },
      reactor,
      choice,
      answerDepsFrom(answer)
    );
    events.push(...answered.events);
    parts =
      answered.bonus < 0
        ? reducedParts(parts, -answered.bonus)
        : parts.map((part, index) => (index === 0 ? { ...part, amount: part.amount + answered.bonus } : part));
  }
  const opened = openDamageWindow(
    state,
    {
      source: roller,
      sourceName: pending.sourceName,
      target,
      parts,
      critical: pending.critical,
      hit: true,
      hitKinds: pending.hitKinds ?? [],
      ...(pending.drain ? { drain: pending.drain } : {}),
      asked: pending.asked ?? []
    },
    {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      random: deps.random,
      newId: deps.newRollId,
      now: deps.now,
      sessionId: deps.gmSessionId,
      role: answer.scope.role,
      commandId: answer.commandId,
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
    }
  );
  if (opened)
    return { ...base, used: use, appliedDamage: 0, events: [...events, ...(opened.line ? [opened.line] : [])] };
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total <= 0) return { ...base, used: use, appliedDamage: 0, events };
  const outcome = applyAnswerDamage(answer, target.id, {
    amount: total,
    parts,
    critical: pending.critical,
    sourceName: pending.sourceName,
    sourceActorId: roller.id,
    ...(pending.drain ? { drain: pending.drain } : {})
  });
  return {
    ...base,
    used: use,
    appliedDamage: outcome.application.totalApplied,
    other: { id: target.id, name: target.name },
    events: [...events, ...outcome.events],
    ...detailOf(outcome.application)
  };
}

/** Drop a reaction prompt without applying its damage (GM housekeeping, e.g. the damage was applied manually). */
export function dismissReaction(state: GameState, reactionId: string, scope: Initiator) {
  requireGm(scope, "Only the GM can dismiss a reaction prompt.");
  const dismissed = state.combat.pendingReactions.find((entry) => entry.id === reactionId);
  if (!dismissed) throw new CommandRejectedError("That reaction prompt was already answered or dismissed.");
  state.combat = {
    ...state.combat,
    pendingReactions: state.combat.pendingReactions.filter((entry) => entry.id !== reactionId)
  };
  releaseHeldRoll(state, reactionHoldKey(reactionId));
  // A fall the GM settled by hand: its last prompt gone, the fall is dropped where its creature stands.
  if (
    dismissed.kind === "falls" &&
    !state.combat.pendingReactions.some(
      (entry) => entry.kind === "falls" && entry.triggerCommandId === dismissed.triggerCommandId
    )
  )
    dropFall(state, dismissed.triggerCommandId);
}
