import { makeHitDicePool, type GameState, type HitDiceEntry } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier } from "@vtt/rules-5e";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { CommandRejectedError } from "./game-store.js";
import { endEffect, removeConditionDirect, type EffectNarration } from "./effects.js";
import { healActor, type ActorScope } from "./hit-points.js";

/**
 * Take `count` dice off a multiclass pool, biggest die first - the same order the roll is made in
 * (the command rolls the pool's headline die), so the pool that shrinks matches the dice that fell.
 * Returns the new entries; the caller has already checked the pool holds enough.
 */
function spendFromPool(entries: readonly HitDiceEntry[], count: number): HitDiceEntry[] {
  let left = count;
  return [...entries]
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)))
    .map((entry) => {
      const taken = Math.min(left, entry.remaining);
      left -= taken;
      return { ...entry, remaining: entry.remaining - taken };
    });
}

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
  // Decrement the POOL, not a single counter: a Fighter 3 / Wizard 2 spends its d10s before its d6s.
  actor.hitDice = makeHitDicePool(spendFromPool(actor.hitDice.entries, faces.length));
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
  // Every die size in the pool comes back, not just the largest (SRD 5.2.1 "Regain All HP").
  if (actor.hitDice) actor.hitDice = makeHitDicePool(actor.hitDice.entries.map((entry) => ({ ...entry, remaining: entry.maximum })));
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
    // `spellSlotMaxima` covers the multiclass sheet whose combined table is derived rather than stored,
    // so a caster seeded from `spellcasting.classes[]` refills instead of staying empty.
    const maxByLevel = new Map(spellSlotMaxima(longRestDefinition).map((entry) => [entry.level, entry.max] as const));
    actor.spellSlots = actor.spellSlots.map((slot) => ({ ...slot, remaining: maxByLevel.get(slot.level) ?? slot.remaining }));
  }
  const pactMaximum = actor.pactSlots ? pactSlotMaximum(longRestDefinition) : null;
  if (actor.pactSlots && pactMaximum) actor.pactSlots = { ...actor.pactSlots, remaining: pactMaximum.max };
  if (longRestDefinition?.spellcasting) actor.preparedSpellIds = longRestDefinition.spellcasting.spells.filter((spell) => spell.prepared || spell.alwaysPrepared).map((spell) => spell.id);
  return events;
}
