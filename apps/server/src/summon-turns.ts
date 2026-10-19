import type { GameState } from "@vtt/domain";
import { builtinAction } from "./builtin-actions.js";
import { addEffect, makeEffect, type EffectNarration } from "./effects.js";

/**
 * A summoned or commanded creature's turns (SRD 5.2.1 summons): one with no turns of its own is passed over (a spell's
 * floating force), one commanded with its summoner's Bonus Action that wasn't commanded since its last turn takes the
 * Dodge action and nothing else (Animate Dead), and one that obeys with no action from its summoner and did nothing on
 * its turn takes the Dodge action as the turn ends ("If you don't issue any, it takes the Dodge action").
 */

type Actor = GameState["actors"][number];

/** A summoned thing with no turns of its own (Spiritual Weapon's force, an Arcane Eye). */
export function takesNoTurns(state: GameState, actorId: string): boolean {
  return state.actors.find((actor) => actor.id === actorId)?.summon?.noTurns === true;
}

/** The Dodge action's own effect (`BUILTIN_ACTIONS`), on a creature that takes it. */
function dodge(state: GameState, actor: Actor): void {
  const grant = builtinAction("dodge")?.grants;
  if (!grant) return;
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${actor.id}:dodge:${state.combat.round}`,
      name: grant.name ?? "Dodging",
      tags: [...grant.tags],
      duration: { type: "until-source-next-turn" },
      modifiers: structuredClone(grant.modifiers),
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      sourceActorId: actor.id,
      sourceName: actor.name,
      startedRound: state.combat.round
    })
  );
}

/** The Bonus Action command didn't come: the creature takes the Dodge action, which is its action this turn. */
export function summonTurnStart(state: GameState, actorId: string, events?: EffectNarration[]): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const control = actor?.control;
  if (!actor || !control?.dodgesUncommanded || control.commandedWith !== "bonus-action" || control.commanded) return;
  if (!state.combat.active || actor.hp.current <= 0) return;
  dodge(state, actor);
  state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: true } };
  const commander = state.actors.find((candidate) => candidate.id === control.by);
  events?.push({
    kind: "effect",
    text: `${actor.name} has no command from ${commander?.name ?? "its summoner"}, so it takes the Dodge action.`,
    actorId
  });
}

/** As its turn ends: a creature that obeys with no action from its summoner and used no action takes the Dodge action,
 *  and a command given with a Bonus Action is used up. */
export function summonTurnEnd(state: GameState, actorId: string | null, events?: EffectNarration[]): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const control = actor?.control;
  if (!actor || !control) return;
  if (
    state.combat.active &&
    control.dodgesUncommanded &&
    control.commandedWith === undefined &&
    actor.hp.current > 0 &&
    !state.combat.turn.actionUsed
  ) {
    dodge(state, actor);
    events?.push({ kind: "effect", text: `${actor.name} takes the Dodge action.`, actorId: actor.id });
  }
  if (control.commanded) {
    const { commanded: _used, ...rest } = control;
    actor.control = rest;
  }
}
