import { isDead, type GameState } from "@vtt/domain";
import { normalizeDamageType } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { addEffect, makeEffect, turnEndDuration, type EffectNarration } from "./effects.js";
import { healActor } from "./hit-points.js";
import { traitMechanicsOf } from "./statblock-traits.js";

type Actor = GameState["actors"][number];
type WeighedPart = Readonly<{ type: string; amount: number; adjusted: number }>;

/**
 * What a damage type does to the stat block it lands on, as its traits print: an Acid Absorption heals the golem by the
 * Acid damage dealt (its Immunity having taken the damage itself), and Aversion to Fire and Freeze leave Disadvantage
 * or a slower Speed "until the end of its next turn" (taken on its own turn, the turn after).
 */
export function damageTypeTraits(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  parts: readonly WeighedPart[]
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const of = (type: string, field: "amount" | "adjusted") =>
    parts.filter((part) => normalizeDamageType(part.type) === type).reduce((sum, part) => sum + part[field], 0);
  for (const trait of traitMechanicsOf(definition)) {
    if (trait.kind === "absorbs") {
      const dealt = of(trait.damageType, "amount");
      if (dealt <= 0 || isDead(actor)) continue;
      const before = actor.hp.current;
      events.push(...healActor(state, actor.id, dealt, { role: "gm" }));
      const regained = actor.hp.current - before;
      if (regained > 0)
        events.push({
          kind: "effect",
          text: `${actor.name} regains ${regained} Hit Points from the ${trait.damageType} damage (${trait.name}).`,
          actorId: actor.id
        });
    }
    if (trait.kind === "damage-weakens" && of(trait.damageType, "adjusted") > 0 && !isDead(actor)) {
      addEffect(
        state,
        actor.id,
        makeEffect({
          // One a turn: a second hit in the same turn changes nothing.
          id: `${actor.id}:${trait.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${state.combat.round}:${state.combat.turnActorId ?? "none"}`,
          name: trait.name,
          sourceActorId: actor.id,
          sourceName: actor.name,
          startedRound: state.combat.round,
          duration: state.combat.active
            ? turnEndDuration(state, "until-bearer-turn-end", actor.id)
            : { type: "rounds", remaining: 1 },
          modifiers: structuredClone(trait.modifiers)
        }),
        events
      );
      events.push({
        kind: "effect",
        text: `${actor.name} took ${trait.damageType} damage (${trait.name}).`,
        actorId: actor.id
      });
    }
  }
  return events;
}
