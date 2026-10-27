import { addEffect, CONCENTRATING_TAG, makeEffect, READIED_TAG, type EffectNarration } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { isItemActionId, laterRowOf, ritualSpellActionId } from "../item-actions.js";
import { spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * SRD Ready: "When you Ready a spell, you cast it as normal (expending any resources used to cast it) but hold its
 * energy, which you release with your Reaction when the trigger occurs. To be readied, a spell must have a casting
 * time of an action, and holding on to the spell's magic requires Concentration, which you can maintain up to the
 * start of your next turn. If your Concentration is broken, the spell dissipates without taking effect."
 *
 * The cast takes the action and spends its slot now; the caster then holds "Concentrating on X (readied)" and a
 * Readied effect naming the spell and its level, both until the start of its next turn and one cast, so breaking the
 * Concentration ends the ready. Casting the spell off-turn releases it with the Reaction, at that level, with no slot.
 */
export function holdReadiedSpell(ctx: ResolveContext): void {
  const { state, action, attacker, input, plan, deps } = ctx;
  const spell = spellOf(ctx);
  if (!state.combat.active || state.combat.turnActorId !== attacker.id)
    throw new CommandRejectedError("A spell is readied with the Ready action, on your own turn in an encounter.");
  // "A casting time of an action": not a Bonus Action, a minute or more, or a Ritual's ten minutes longer.
  if (
    !spell ||
    action.activation !== "action" ||
    !/^(?:1 )?action\b/i.test(spell.castingTime.trim()) ||
    action.id === ritualSpellActionId(spell.id) ||
    isItemActionId(action.id) ||
    laterRowOf(spell, action.id)
  )
    throw new CommandRejectedError("Only a spell with a casting time of an action can be readied.");
  const castId = input.commandId;
  const level = plan.castLevel ?? spell.level;
  const ended: EffectNarration[] = [];
  const holding = addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${castId}:concentration`,
      name: `Concentrating on ${spell.name} (readied)`,
      tags: [CONCENTRATING_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      startedRound: state.combat.round,
      duration: { type: "until-source-next-turn" },
      endsWhenSourceDefeated: true,
      concentration: true,
      castId
    }),
    ended,
    deps
  );
  const readied = addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${castId}:ready`,
      name: `Readied: ${spell.name}`,
      tags: [READIED_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: "ready",
      startedRound: state.combat.round,
      duration: { type: "until-source-next-turn" },
      castId,
      // Its Metamagic was paid with the cast, and shapes the spell when it is released.
      readiedSpell: {
        actionId: action.id,
        level,
        ...(input.shaping && input.shaping.length > 0 ? { shaping: input.shaping.map((entry) => ({ ...entry })) } : {})
      }
    })
  );
  for (const effect of [holding, readied])
    ctx.effectsApplied.push({ targetId: attacker.id, targetName: attacker.name, name: effect.name, conditionIds: [] });
  // The Concentration the caster held before ends: the table's news.
  for (const event of ended) ctx.tableNarration.push(tableLineOf(ctx, event));
}
