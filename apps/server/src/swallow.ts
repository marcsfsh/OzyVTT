import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { addEffect, applyCondition, endEffect, makeEffect, type EffectNarration } from "./effects.js";

/** A stat block's swallow, by what it says of the swallower's death: "If the worm dies, a swallowed creature is no
 *  longer Restrained by it and can escape from the corpse by using 20 feet of movement, exiting Prone." */
const ESCAPE = /escape from the corpse (?:by )?using (\d+) feet of movement/i;

/**
 * A dead or departed swallower lets go of what it swallowed: each creature its swallow holds is no longer Restrained
 * or Blinded by it, and climbs out of the corpse with the movement the stat block names, landing Prone. On that
 * creature's own turn the movement comes out of the turn's; otherwise out of its next turn, as Speed lost until that
 * turn ends.
 */
export function releaseSwallowedBy(
  state: GameState,
  swallowerId: string,
  definition: ActorDefinition | undefined
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const swallower = state.actors.find((actor) => actor.id === swallowerId);
  // Read the stat block only when something of its holds on: callers pass whatever definition the defeated has.
  const held = state.actors.flatMap((prey) =>
    prey.effects
      .filter((effect) => effect.sourceActorId === swallowerId && effect.sourceActionId)
      .map((effect) => ({ prey, effect }))
  );
  if (!swallower || !definition || held.length === 0) return events;
  for (const { prey, effect } of held) {
    const action = definition.actions.find((candidate) => candidate.id === effect.sourceActionId);
    const escape = action ? ESCAPE.exec(action.description) : null;
    if (!escape) continue;
    const feet = Number.parseInt(escape[1]!, 10);
    events.push(...endEffect(state, prey.id, effect.id));
    applyCondition(prey, "prone");
    if (state.combat.active && state.combat.turnActorId === prey.id)
      state.combat = {
        ...state.combat,
        turn: { ...state.combat.turn, movementUsedFeet: state.combat.turn.movementUsedFeet + feet }
      };
    else if (state.combat.active)
      addEffect(
        state,
        prey.id,
        makeEffect({
          id: `${effect.id}:escape`,
          name: `Climbing out of ${swallower.name}`,
          tags: ["escaping-corpse"],
          sourceActorId: prey.id,
          sourceName: prey.name,
          startedRound: state.combat.round,
          duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false },
          modifiers: [{ type: "speed", amount: -feet }]
        })
      );
    events.push({
      kind: "effect",
      text: `${prey.name} climbs out of ${swallower.name}, using ${feet} feet of movement, and lands Prone.`,
      actorId: prey.id,
      // The table's copy masks a swallower it can't see.
      source: { actorId: swallowerId, name: swallower.name }
    });
  }
  return events;
}
