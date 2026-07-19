import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { endEffect, removeConditionDirect, type EffectNarration } from "./effects.js";

/**
 * Apply a rest to a rostered actor outside combat (SRD Resting, ADR-0020).
 *
 * Short: per-short-rest and recharge limited-use pools re-arm (SRD: "Recharge after a Short or
 * Long Rest", and any rest re-arms Recharge X-Y) — hit dice aren't modeled, so no HP changes
 * (the GM heals manually if the table spends dice; documented simplification).
 * Long: remaining effects end first (their onEnd grants land — Frenzy's Exhaustion), then HP to
 * max, temp HP gone, dying cleared, all limited-use pools refreshed, Exhaustion drops one level.
 */
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
  actor.deathSaves = null;
  removeConditionDirect(actor, "unconscious");
  actor.actionUses = {};
  const exhaustion = actor.conditions.find((condition) => condition.id === "exhaustion");
  if (exhaustion) {
    if ((exhaustion.level ?? 1) <= 1) removeConditionDirect(actor, "exhaustion");
    else actor.conditions = actor.conditions.map((condition) => condition.id === "exhaustion" ? { ...condition, level: (condition.level ?? 1) - 1 } : condition);
  }
  return events;
}
