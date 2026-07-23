import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier } from "@vtt/rules-5e";
import { CommandRejectedError } from "./game-store.js";
import { endEffect, removeConditionDirect, type EffectNarration } from "./effects.js";
import { healActor, type ActorScope } from "./hit-points.js";

/**
 * Apply a rest to a rostered actor outside combat (SRD Resting, ADR-0020).
 *
 * Short: per-short-rest and recharge limited-use pools re-arm (SRD: "Recharge after a Short or
 * Long Rest", and any rest re-arms Recharge X-Y); healing happens by spending Hit Point Dice
 * (the separate actor.spend-hit-dice command), never automatically.
 * Long: remaining effects end first (their onEnd grants land - Frenzy's Exhaustion), then HP to
 * max, temp HP gone, dying cleared, all limited-use pools refreshed, all spent Hit Point Dice
 * restored (SRD 5.2.1 "Regain All HP"), Exhaustion drops one level.
 */
/**
 * Spend Hit Point Dice to heal (SRD 5.2.1 Short Rest): each pre-rolled die face heals
 * `face + Con modifier`, minimum 1. The caller rolls the faces (dice.roll pattern: rolled before
 * the store executes so duplicate retries never reroll) and records them; this owns validation,
 * healing (through healActor's single-sourced rules), and the pool decrement.
 */
export function spendHitDice(state: GameState, actorId: string, faces: readonly number[], scope: ActorScope, resolveDefinition: (definitionId: string) => ActorDefinition | undefined): { healed: number; events: EffectNarration[]; conModifier: number } {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("Hit Dice are spent on a rest - end the encounter first.");
  if (!actor.hitDice) throw new CommandRejectedError(`${actor.name} has no Hit Dice pool (its stat block has no hit-point formula).`);
  if (actor.hitDice.remaining < faces.length) throw new CommandRejectedError(`${actor.name} has ${actor.hitDice.remaining} Hit ${actor.hitDice.remaining === 1 ? "Die" : "Dice"} left.`);
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  const conModifier = definition ? scoreModifier(definition.abilityScores.con) : 0;
  const healed = faces.reduce((sum, face) => sum + Math.max(1, face + conModifier), 0);
  const events = healActor(state, actorId, healed, scope);
  actor.hitDice = { ...actor.hitDice, remaining: actor.hitDice.remaining - faces.length };
  return { healed, events, conModifier };
}

export function applyRest(state: GameState, actorId: string, kind: "long" | "short", resolveDefinition: (definitionId: string) => ActorDefinition | undefined): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("End the encounter before resting a combatant who is in it.");
  const events: EffectNarration[] = [];
  if (kind === "short") {
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    for (const action of definition?.actions ?? []) {
      if (action.uses?.per !== "short-rest" && action.uses?.per !== "recharge") continue;
      const key = action.uses.pool ?? action.id;
      if (actor.actionUses[key] !== undefined) {
        const { [key]: _cleared, ...rest } = actor.actionUses;
        actor.actionUses = rest;
      }
    }
    return events;
  }
  for (const effect of [...actor.effects]) events.push(...endEffect(state, actorId, effect.id));
  actor.hp.current = actor.hp.maximum;
  actor.hp.temporary = 0;
  if (actor.hitDice) actor.hitDice = { ...actor.hitDice, remaining: actor.hitDice.maximum };
  actor.deathSaves = null;
  removeConditionDirect(actor, "unconscious");
  actor.actionUses = {};
  const exhaustion = actor.conditions.find((condition) => condition.id === "exhaustion");
  if (exhaustion) {
    if ((exhaustion.level ?? 1) <= 1) removeConditionDirect(actor, "exhaustion");
    else actor.conditions = actor.conditions.map((condition) => condition.id === "exhaustion" ? { ...condition, level: (condition.level ?? 1) - 1 } : condition);
  }
  // SRD long rest: all spell slots (and Pact Magic) refill to their maxima and prepared spells reset
  // to the sheet's defaults. Absent spellcasting leaves these untouched (additive).
  const longRestDefinition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  if (actor.spellSlots && longRestDefinition?.spellcasting) {
    const maxByLevel = new Map(longRestDefinition.spellcasting.slots.map((entry) => [entry.level, entry.max] as const));
    actor.spellSlots = actor.spellSlots.map((slot) => ({ ...slot, remaining: maxByLevel.get(slot.level) ?? slot.remaining }));
  }
  if (actor.pactSlots && longRestDefinition?.spellcasting?.pact) actor.pactSlots = { ...actor.pactSlots, remaining: longRestDefinition.spellcasting.pact.max };
  if (longRestDefinition?.spellcasting) actor.preparedSpellIds = longRestDefinition.spellcasting.spells.filter((spell) => spell.prepared || spell.alwaysPrepared).map((spell) => spell.id);
  return events;
}
