import type { GameState } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorDefinition, RestTrigger } from "@vtt/schemas";
import { endEffectIfPresent, maximumKeeper, sourceOf, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { applyDamageDetailed, killOutright } from "./hit-points.js";
import { rollSaveAtOnce } from "./saving-throws.js";

/**
 * What curses and lingering poisons do as their bearers rest and as days pass (SRD 5.2.1 stat blocks): a rakshasa's
 * Cursed Touch and an incubus's Restless Touch take a rest's benefit away, a mummy's Rotting Fist keeps the Hit Point
 * maximum down and lowers it every 24 hours, an otyugh's Bite asks a save after each Long Rest, and a death dog's Bite
 * every 24 hours. The saves are the bearer's own, rolled by the server with everything that shapes them.
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

const DAY_MINUTES = 24 * 60;

/** What a rest or day trigger needs to roll. */
export type RestTriggerDeps = Readonly<{
  random: (sides: number) => number;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** The effect that takes this rest's benefit from the creature ("gains no benefit from finishing a Short or Long Rest"),
 *  if any. */
export function restDeniedBy(actor: Actor, kind: "short" | "long"): Effect | undefined {
  return actor.effects.find((effect) => {
    const denied = effect.atRest?.noBenefit;
    return denied === "both" || denied === kind;
  });
}

/** "Its Hit Point maximum doesn't return to normal when finishing a Long Rest" (a mummy's curse, a death dog's poison),
 *  or a Long Rest that gives no benefit at all. */
export function holdsMaximumAtRest(actor: Actor): boolean {
  return (
    actor.effects.some((effect) => effect.atRest?.holdsMaximum === true) || restDeniedBy(actor, "long") !== undefined
  );
}

/** The line a rest that gives a creature nothing tells the table. */
export function deniedRestLine(actor: Actor, effect: Effect, kind: "short" | "long"): EffectNarration {
  return {
    kind: "effect",
    text: `${actor.name} gains no benefit from finishing the ${kind === "long" ? "Long" : "Short"} Rest (${effect.name}).`,
    actorId: actor.id,
    ...sourceOf(effect)
  };
}

/** What acts as `actor` finishes a Long Rest: each effect that asks for it ("Whenever the Poisoned target finishes a
 *  Long Rest"). */
export function afterLongRest(state: GameState, actor: Actor, deps: RestTriggerDeps): EffectNarration[] {
  return [...actor.effects]
    .filter((effect) => effect.atRest?.at === "long-rest")
    .flatMap((effect) => triggerOnce(state, actor, effect, effect.atRest!, deps));
}

/**
 * "Every 24 hours that elapse": as the clock moves from `fromMinute` to `toMinute`, each day-measured effect on the
 * creatures in time acts once for each full day since it began or last acted. A save that succeeds ends it, so later
 * days ask nothing more.
 */
export function afterDays(
  state: GameState,
  actorIds: ReadonlySet<string>,
  fromMinute: number,
  toMinute: number,
  deps: RestTriggerDeps
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    if (!actorIds.has(actor.id)) continue;
    for (const effect of [...actor.effects]) {
      const trigger = effect.atRest;
      if (trigger?.at !== "day") continue;
      const mark = trigger.dayMark ?? fromMinute;
      const days = Math.floor((toMinute - mark) / DAY_MINUTES);
      writeDayMark(actor, effect.id, mark + Math.max(0, days) * DAY_MINUTES);
      for (let day = 0; day < days; day += 1) {
        if (!actor.effects.some((candidate) => candidate.id === effect.id)) break;
        events.push(...triggerOnce(state, actor, effect, trigger, deps));
      }
    }
  }
  return events;
}

/** One rest or day: the save, a success ending the effect, and the Hit Point maximum it takes on a failure (or each
 *  time, when it asks no save). */
function triggerOnce(
  state: GameState,
  actor: Actor,
  effect: Effect,
  trigger: RestTrigger,
  deps: RestTriggerDeps
): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (trigger.save) {
    const { natural, total } = rollSaveAtOnce(state, actor, trigger.save.ability, {
      ...deps,
      rollDie: deps.random,
      magical: effect.magical === true
    });
    const success = total >= trigger.save.dc;
    events.push({
      kind: "condition",
      text: `${actor.name} makes a DC ${trigger.save.dc} ${trigger.save.ability.toUpperCase()} save against ${effect.name}: ${total} (d20 ${natural}), ${success ? "a success" : "a failure"}.`,
      actorId: actor.id,
      ...sourceOf(effect)
    });
    if (success) return [...events, ...endEffectIfPresent(state, actor.id, effect.id)];
  }
  if (trigger.maximumLoss) events.push(...loseMaximum(state, actor, effect, trigger.maximumLoss, deps));
  // "It takes 3d6 Psychic damage when it wakes up" (Dream), meeting its defences like any damage.
  if (trigger.damage) {
    const parts = trigger.damage.map((part) => ({
      amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.random).total),
      type: part.type
    }));
    const amount = parts.reduce((sum, part) => sum + part.amount, 0);
    const outcome = applyDamageDetailed(
      state,
      actor.id,
      { amount, parts, sourceActorId: effect.sourceActorId, sourceName: effect.sourceName ?? effect.name },
      { role: "gm" },
      {
        resolveDefinition: deps.resolveDefinition,
        rollDie: deps.random,
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }
    );
    events.push(
      {
        kind: "damage",
        text: `${actor.name} wakes and takes ${outcome.application.totalApplied} damage (${effect.name}).`,
        actorId: actor.id,
        ...sourceOf(effect)
      },
      ...outcome.events
    );
  }
  if (trigger.once) events.push(...endEffectIfPresent(state, actor.id, effect.id));
  return events;
}

/** The Hit Point maximum the effect takes, held on it until it ends; a creature whose maximum reaches 0 dies. */
function loseMaximum(
  state: GameState,
  actor: Actor,
  effect: Effect,
  formula: string,
  deps: RestTriggerDeps
): EffectNarration[] {
  // SRD Aura of Life: "your Hit Point maximums can't be reduced" while in the aura.
  const kept = maximumKeeper(actor);
  if (kept)
    return [
      {
        kind: "condition",
        text: `${actor.name}'s Hit Point maximum doesn't drop (${kept.name}).`,
        actorId: actor.id,
        ...sourceOf(effect)
      }
    ];
  const rolled = Math.max(0, resolveDice(parseDiceFormula(formula), deps.random).total);
  const loss = Math.min(rolled, actor.hp.maximum);
  if (loss <= 0) return [];
  const maximum = actor.hp.maximum - loss;
  actor.hp = { ...actor.hp, maximum, current: Math.min(actor.hp.current, maximum) };
  actor.effects = actor.effects.map((candidate) =>
    candidate.id === effect.id
      ? { ...candidate, hitPointMaximumLoss: Math.min(10000, (candidate.hitPointMaximumLoss ?? 0) + loss) }
      : candidate
  );
  const events: EffectNarration[] = [
    {
      kind: "condition",
      text: `${actor.name}'s Hit Point maximum decreases by ${loss} (${effect.name}).`,
      actorId: actor.id,
      ...sourceOf(effect)
    }
  ];
  if (maximum <= 0)
    events.push(
      ...killOutright(state, actor.id, effect.name, {
        withoutDamage: true,
        deps: {
          resolveDefinition: deps.resolveDefinition,
          rollDie: deps.random,
          ...(deps.catalog ? { catalog: deps.catalog } : {})
        }
      })
    );
  return events;
}

function writeDayMark(actor: Actor, effectId: string, dayMark: number): void {
  actor.effects = actor.effects.map((candidate) =>
    candidate.id === effectId && candidate.atRest
      ? { ...candidate, atRest: { ...candidate.atRest, dayMark } }
      : candidate
  );
}
