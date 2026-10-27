import type { GameState } from "@vtt/domain";
import type { DamageDrain } from "@vtt/schemas";
import { conditionLabel } from "./condition-rules.js";
import {
  addEffect,
  applyCondition,
  dropHeldItems,
  endConcentrationSustainedBy,
  endEffectsSustainedBy,
  makeEffect,
  startStableRecovery,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";

type Actor = GameState["actors"][number];

/**
 * Damage that leaves the creature it drops to 0 Hit Points Stable instead of dying (a phase spider's Bite, a vampire
 * familiar's Umbral Dagger: "the target becomes Stable, and it has the Poisoned condition for 1 hour. While Poisoned,
 * the target also has the Paralyzed condition"). A character makes no death saves and a monster lives, Unconscious at 0
 * Hit Points; both regain 1 Hit Point after 1d4 hours of game time unless healed first, and the poison's conditions
 * last their printed time.
 */
export function dropStable(
  state: GameState,
  actor: Actor,
  rider: NonNullable<DamageDrain["stableAtZero"]>,
  source: Readonly<{ actorId: string | null; name: string | null; commandId: string }>,
  deps: ConditionImmunitySource & Readonly<{ rollDie?: (sides: number) => number }>
): EffectNarration[] {
  const events: EffectNarration[] = [];
  actor.deathSaves = { successes: 0, failures: 0, stable: true };
  applyCondition(actor, "unconscious", { immunities: deps });
  applyCondition(actor, "prone", { immunities: deps });
  events.push({
    kind: "condition",
    text: `${actor.name} drops to 0 Hit Points and is Stable${source.name ? ` (${source.name})` : ""}.`,
    actorId: actor.id
  });
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${source.commandId}:${actor.id}:stable-poison`,
      name: `${rider.conditions.map(conditionLabel).join(" and ")}${source.name ? ` by ${source.name}` : ""}`.slice(
        0,
        120
      ),
      sourceActorId: source.actorId,
      sourceName: source.name,
      startedRound: state.combat.round,
      duration: { type: "minutes", remaining: rider.minutes },
      linkedConditionIds: [...rider.conditions]
    }),
    events,
    deps
  );
  if (deps.rollDie)
    events.push(...startStableRecovery(state, actor, deps.rollDie, `${source.commandId}:${actor.id}:stable`));
  events.push(...dropHeldItems(actor, deps));
  // At 0 Hit Points it sustains nothing, as any creature at 0 does.
  events.push(...endEffectsSustainedBy(state, actor.id));
  events.push(...endConcentrationSustainedBy(state, actor.id));
  return events;
}
