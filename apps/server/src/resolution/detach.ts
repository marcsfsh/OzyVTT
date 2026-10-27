import { DETACH_FEET, selfDetachments } from "../attachments.js";
import { endEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { travelBudgetFeet } from "../speed.js";
import { policeBarrier } from "../zone-barriers.js";
import { endedEffect, type ResolveContext } from "./context.js";

/**
 * A creature's own way off what it is attached to (SRD 5.2.1 stirge, cloaker, darkmantle: "can detach itself by
 * spending 5 feet of its movement"): no action, 5 feet of the movement of its turn, and the attachment ends.
 */

/** The id of the generic action that detaches its user. */
export const DETACH_SELF_ID = "detach-self";

export function detachItself(ctx: ResolveContext): void {
  const { state, attacker, input } = ctx;
  const held = selfDetachments(state, attacker.id);
  if (held.length === 0) throw new CommandRejectedError(`${attacker.name} isn't attached to any creature.`);
  if (state.combat.active) {
    if (state.combat.turnActorId !== attacker.id)
      throw new CommandRejectedError(`${attacker.name} detaches itself with the movement of its own turn.`);
    const budget = travelBudgetFeet(attacker, ctx.derivation, ctx.deps.definition, "walk");
    const used = state.combat.turn.movementUsedFeet;
    if (budget !== null && used + DETACH_FEET > budget + DISTANCE_TOLERANCE_FEET) {
      const said = policeBarrier(
        state,
        input.override ?? null,
        "movement.exceeds-speed",
        `${attacker.name} has ${Math.max(0, budget - used)} ft of movement left, and detaching takes ${DETACH_FEET} ft.`
      );
      if (said) ctx.warnings.push(said);
    }
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, movementUsedFeet: used + DETACH_FEET }
    };
  }
  for (const { bearer, effect } of held) {
    endEffect(state, bearer.id, effect.id);
    ctx.effectsEnded.push(endedEffect(bearer, effect));
    ctx.tableNarration.push({
      kind: "effect",
      text: `${attacker.name} detaches itself from ${bearer.name}.`,
      actorIds: [attacker.id, bearer.id]
    });
  }
}
