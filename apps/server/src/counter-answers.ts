import type { ActionResolution, GameState, PendingReaction } from "@vtt/domain";
import { resolveDefinitionAction } from "./action-resolution.js";
import { effectiveActions } from "./effective-actions.js";
import type { EffectNarration } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";
import { damageAdjustmentDetail } from "./hit-points.js";
import { settlePlayerDamage } from "./player-damage.js";
import type { ReactionAnswerDependencies } from "./reactions.js";
import { spendComponents } from "./resolution/components.js";
import type { LiveActor } from "./resolution/context.js";
import { commitEconomy, commitUse, planEconomy, spendSlot } from "./resolution/economy.js";
import { recordRoll } from "./roll-history.js";
import { magicResistanceOf, rollSaveAtOnce } from "./saving-throws.js";

/** What answering one Counterspell prompt needs from the answer it belongs to. */
export type CounterAnswer = Readonly<{
  state: GameState;
  commandId: string;
  pending: PendingReaction;
  reactor: LiveActor;
  use: boolean;
  deps: ReactionAnswerDependencies;
  /** Drops the prompt; `markUsed` also spends the reactor's reaction. */
  clearPrompt: (markUsed: boolean) => void;
}>;

export type CounterOutcome = Readonly<{
  used: boolean;
  countered: boolean;
  appliedDamage: number;
  caster: Readonly<{ id: string; name: string }>;
  resolution?: ActionResolution;
  events: readonly EffectNarration[];
  castCommandId: string;
}>;

const ABILITY_WORDS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
} as const;

/**
 * Answers one Counterspell prompt (SRD 5.2.1 Counterspell). "Use" spends the reactor's Reaction and its slot through
 * its own action's economy; the caster then makes the saving throw against the reactor's spell save DC, rolled by the
 * server. On a failure "the spell dissipates with no effect, and the action, Bonus Action, or Reaction used to cast it
 * is wasted. If that spell was cast with a spell slot, the slot isn't expended": every other prompt on the cast goes,
 * and nothing of it happens. Otherwise, once no prompt on the cast is left, the cast goes ahead as it was made: its
 * slot and the materials it consumes are spent, and the damage it owes lands as the caster's own would.
 */
export function answerCounter(answer: CounterAnswer, slotLevel: number | undefined): CounterOutcome {
  const { state, commandId, pending, reactor, use, deps, clearPrompt } = answer;
  const parked = pending.parkedCast;
  const caster = pending.sourceActorId
    ? state.actors.find((candidate) => candidate.id === pending.sourceActorId)
    : undefined;
  if (!parked || !caster || !state.combat.initiative.some((entry) => entry.actorId === caster.id)) {
    clearPrompt(false);
    throw new CommandRejectedError(`${pending.sourceName}'s spell can't be finished any more. Dismiss the prompt.`);
  }
  const named = { id: caster.id, name: caster.name };
  const events: EffectNarration[] = [];
  if (!use) {
    clearPrompt(false);
    return {
      used: false,
      countered: false,
      appliedDamage: 0,
      caster: named,
      events,
      castCommandId: parked.castCommandId,
      ...goAhead(answer, caster, events)
    };
  }

  const definition = reactor.definitionId ? deps.resolveDefinition(reactor.definitionId) : undefined;
  const siblings = effectiveActions(definition, reactor, deps.catalog);
  const declared = siblings.find((candidate) => candidate.id === pending.actionId);
  if (!declared || declared.reaction?.response !== "counter")
    throw new CommandRejectedError(`${reactor.name} no longer has ${pending.actionName}.`);
  // Counterspell's own cost: the Reaction and a slot, checked like any resolve.
  const economy = planEconomy(
    state,
    reactor,
    declared,
    {
      actorId: reactor.id,
      targetIds: [caster.id],
      commandId,
      ...(slotLevel !== undefined ? { slotLevel } : {})
    },
    definition,
    [],
    deps.distanceFeet,
    siblings,
    false,
    deps.catalog
  );
  commitEconomy({ state, attacker: reactor, input: {}, plan: economy.plan, overridden: economy.overridden });
  clearPrompt(false);

  const ability = declared.reaction.ability;
  const dc = declared.save?.dc ?? definition?.spellcasting?.saveDc ?? 10;
  // Counterspell is a spell, so the caster's Magic Resistance meets its save with Advantage, and Greater Magic
  // Resistance succeeds without a roll.
  const casterDefinition = caster.definitionId ? deps.resolveDefinition(caster.definitionId) : undefined;
  const greater = magicResistanceOf(casterDefinition) === "succeeds";
  const save = greater
    ? null
    : rollSaveAtOnce(state, caster, ability, {
        resolveDefinition: deps.resolveDefinition,
        ...(deps.catalog ? { catalog: deps.catalog } : {}),
        ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
        rollDie: deps.random,
        magical: true
      });
  if (save)
    recordRoll(state, {
      id: deps.newRollId(),
      commandId,
      initiatorSessionId: deps.gmSessionId,
      initiatorRole: "gm",
      initiatorLabel: caster.name,
      label: `${ABILITY_WORDS[ability]} save against ${declared.name}`,
      actorId: caster.id,
      purpose: "save",
      visibility: caster.visibility === "gm-only" ? "gm-only" : "public",
      formula: "1d20",
      normalizedFormula: "1d20",
      dice: [{ group: 0, sides: 20, face: save.natural, kept: true, sign: 1 as const }],
      modifiers:
        save.total === save.natural
          ? []
          : [{ value: Math.abs(save.total - save.natural), sign: save.total > save.natural ? 1 : -1 }],
      total: save.total,
      createdAt: deps.now()
    });
  const readout = save
    ? `${ABILITY_WORDS[ability]} save ${save.total} against DC ${dc}`
    : `Greater Magic Resistance against DC ${dc}`;
  if (save !== null && save.total < dc) {
    // The cast is over: no other prompt waits on it.
    state.combat = {
      ...state.combat,
      pendingReactions: state.combat.pendingReactions.filter(
        (entry) => !(entry.kind === "casts-spell" && entry.triggerCommandId === pending.triggerCommandId)
      )
    };
    events.push({
      kind: "reaction",
      text: `${caster.name}'s spell dissipates (${readout}). Its slot isn't spent.`,
      actorId: caster.id
    });
    return {
      used: true,
      countered: true,
      appliedDamage: 0,
      caster: named,
      events,
      castCommandId: parked.castCommandId
    };
  }
  events.push({ kind: "reaction", text: `${caster.name} keeps casting (${readout}).`, actorId: caster.id });
  return {
    used: true,
    countered: false,
    appliedDamage: 0,
    caster: named,
    events,
    castCommandId: parked.castCommandId,
    ...goAhead(answer, caster, events)
  };
}

/** The parked cast goes ahead once no Counterspell prompt on it is left: resolved as it was made, with its slot and
 *  the materials it consumes spent now, and the damage it owes settled as the caster's would be. */
function goAhead(
  answer: CounterAnswer,
  caster: LiveActor,
  events: EffectNarration[]
): Partial<Readonly<{ resolution: ActionResolution; appliedDamage: number }>> {
  const { state, pending, deps } = answer;
  const parked = pending.parkedCast!;
  if (
    state.combat.pendingReactions.some(
      (entry) => entry.kind === "casts-spell" && entry.triggerCommandId === pending.triggerCommandId
    )
  )
    return {};
  const definition = caster.definitionId ? deps.resolveDefinition(caster.definitionId) : undefined;
  const action = effectiveActions(definition, caster, deps.catalog).find(
    (candidate) => candidate.id === parked.actionId
  );
  if (!action) return {};
  const inFight = (id: string) => state.combat.initiative.some((entry) => entry.actorId === id);
  const resolution = resolveDefinitionAction(
    state,
    action,
    {
      actorId: caster.id,
      targetIds: parked.targetIds.filter(inFight),
      commandId: parked.castCommandId,
      economyPaid: true,
      ...(parked.slot ? { slotLevel: parked.slot.level } : {}),
      conditionId: parked.conditionId,
      damageType: parked.damageType,
      ability: parked.ability,
      ...(parked.areaPlaced ? { areaPlaced: true } : {}),
      ...(parked.holdKey !== null ? { holdKey: parked.holdKey } : {})
    },
    {
      random: deps.random,
      newRollId: deps.newRollId,
      gmSessionId: deps.gmSessionId,
      initiatorRole: parked.initiatorRole,
      initiatorSessionId: parked.initiatorSessionId,
      now: deps.now,
      definition,
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
      ...(deps.pushToken ? { pushToken: deps.pushToken } : {})
    }
  );
  // "If that spell was cast with a spell slot": spent only now that it went ahead, and it is this turn's one slot.
  if (parked.slot) {
    spendSlot(caster, parked.slot);
    const casters = state.combat.turn.spellSlotCasters ?? [];
    if (!casters.includes(caster.id))
      state.combat = { ...state.combat, turn: { ...state.combat.turn, spellSlotCasters: [...casters, caster.id] } };
  }
  if (parked.use) commitUse(state, caster, parked.use);
  spendComponents(caster, parked.componentSpends);
  const mode = parked.initiatorRole === "player" ? state.combat.playerDamageMode : "direct";
  const applied = settlePlayerDamage(
    state,
    resolution,
    caster.name,
    caster.id,
    mode,
    {
      resolveDefinition: deps.resolveDefinition,
      newId: deps.newRollId,
      now: () => Date.parse(deps.now()),
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
      rollDie: deps.random
    },
    action.drain
  );
  for (const { outcome, targetId, label } of applied) {
    const target = state.actors.find((actor) => actor.id === targetId);
    events.push({
      kind: "damage",
      text: `${label} hit ${target?.name ?? "its target"} for ${outcome.application.totalApplied} damage${damageAdjustmentDetail(outcome.application)}.`,
      actorId: targetId,
      source: { actorId: caster.id, name: caster.name }
    });
    events.push(...outcome.events);
  }
  return {
    resolution,
    appliedDamage: applied.reduce((sum, entry) => sum + entry.outcome.application.totalApplied, 0)
  };
}
