import type { GameState } from "@vtt/domain";
import { endEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { SLIPS_RESTRAINTS_TAG } from "../builtin-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { policeBarrier } from "../zone-barriers.js";
import { endedEffect, type ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Freedom of Movement: "the target can spend 5 feet of movement to automatically escape from nonmagical
 * restraints, such as manacles or a creature imposing the Grappled condition on it." No action and no check: 5 feet of
 * the movement of its turn, and the nonmagical effect that grapples or restrains it ends. Its Speed counts as it would
 * without the hold, which is what the movement is spent from.
 */

type Actor = GameState["actors"][number];

const SLIP_FEET = 5;

/** The nonmagical holds on the creature: a grapple, a Net, Manacles, a constrictor's coils. */
export function nonmagicalHolds(actor: Actor): Actor["effects"] {
  return actor.effects.filter(
    (effect) =>
      effect.magical !== true &&
      effect.spell === undefined &&
      (effect.escapeDc !== null || effect.linkedConditionIds.some((id) => id === "grappled" || id === "restrained"))
  );
}

/** Whether the creature can slip a hold now: it bears the ability and something nonmagical holds it. */
export const slipsFree = (actor: Actor): boolean =>
  actor.effects.some((effect) => effect.tags.includes(SLIPS_RESTRAINTS_TAG)) && nonmagicalHolds(actor).length > 0;

export function slipFree(ctx: ResolveContext): void {
  const { state, attacker, input } = ctx;
  if (!attacker.effects.some((effect) => effect.tags.includes(SLIPS_RESTRAINTS_TAG)))
    throw new CommandRejectedError(`${attacker.name} has nothing that lets it slip its restraints.`);
  const holds = nonmagicalHolds(attacker);
  const hold = holds.find((effect) => effect.id === input.effectId) ?? holds[0];
  if (!hold) throw new CommandRejectedError(`Nothing nonmagical holds ${attacker.name}.`);
  if (state.combat.active) {
    if (state.combat.turnActorId !== attacker.id)
      throw new CommandRejectedError(`${attacker.name} slips free with the movement of its own turn.`);
    const speed = attacker.speedFeet ?? 0;
    const used = state.combat.turn.movementUsedFeet;
    if (used + SLIP_FEET > speed + DISTANCE_TOLERANCE_FEET) {
      const said = policeBarrier(
        state,
        input.override ?? null,
        "movement.exceeds-speed",
        `${attacker.name} has ${Math.max(0, speed - used)} ft of movement left, and slipping free takes ${SLIP_FEET} ft.`
      );
      if (said) ctx.warnings.push(said);
    }
    state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: used + SLIP_FEET } };
  }
  endEffect(state, attacker.id, hold.id);
  ctx.effectsEnded.push(endedEffect(attacker, hold));
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} slips free of ${hold.name} for ${SLIP_FEET} feet of movement.`,
    actorIds: [attacker.id]
  });
}
