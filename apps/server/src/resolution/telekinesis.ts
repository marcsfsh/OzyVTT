import type { PendingSave } from "@vtt/domain";
import { endEffect } from "../effects.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { policeBarrier } from "../zone-barriers.js";
import { endedEffect, tableLineOf, type LiveActor, type ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Telekinesis: "The target must succeed on a Strength saving throw, or you move it up to 30 feet in any
 * direction within the spell's range. Until the end of your next turn, the creature has the Restrained condition, and if
 * you lift it into the air, it is suspended there. It falls at the end of your next turn unless you use this option on
 * it again and it fails the save ... If you switch targets, the prior target is no longer affected by the spell." The
 * space and the height are picked with the use (`destination`, `destinationAltitudeFeet`), checked before anything
 * rolls and carried on the save, which sets the creature down there on a failure (`saving-throws.ts`).
 */

/** On the failure's effect: the creature the spell holds, which a new target lets go (and which hangs in the air while
 *  it lasts, `falling.ts`). */
export const TELEKINETIC_TAG = "telekinetic";

/** Where a failure moves this target, checked against the move's reach and the action's range; undefined when the use
 *  picked no space or the map can't place it (the GM moves the token). */
export function failureMoveOf(ctx: ResolveContext, target: LiveActor): PendingSave["failureMovesTo"] {
  const move = ctx.action.failureMove;
  if (!move) return undefined;
  const point = ctx.input.destination;
  if (!point) {
    ctx.warnings.push(`No space was picked, so a failure leaves ${target.name} where it is.`);
    return undefined;
  }
  const moved = ctx.deps.destinationAt?.(target.id, point, target.id) ?? null;
  const fromUser = ctx.deps.destinationAt?.(target.id, point, ctx.attacker.id) ?? null;
  if (moved === null || fromUser === null) {
    ctx.warnings.push(`${ctx.action.name}: on a failure, move ${target.name} up to ${move.feet} feet.`);
    return undefined;
  }
  const police = (message: string) => {
    const said = policeBarrier(ctx.state, ctx.input.override ?? null, "range.out-of-range", message);
    if (said) ctx.warnings.push(said);
  };
  const altitude = move.lifts ? Math.max(0, Math.round(ctx.input.destinationAltitudeFeet ?? 0)) : 0;
  const feet = Math.hypot(moved.feet, altitude);
  if (feet > move.feet + DISTANCE_TOLERANCE_FEET)
    police(
      `That space is ${Math.round(feet)} ft from ${target.name}, beyond the ${move.feet} ft ${ctx.action.name} moves it.`
    );
  const range = ctx.action.targets?.rangeFeet;
  if (range !== undefined && fromUser.feet > range + DISTANCE_TOLERANCE_FEET)
    police(
      `That space is ${Math.round(fromUser.feet)} ft from ${ctx.attacker.name}, beyond ${ctx.action.name}'s ${range} ft.`
    );
  return { x: moved.at.x, y: moved.at.y, ...(altitude > 0 ? { altitudeFeet: altitude } : {}) };
}

/** "If you switch targets, the prior target is no longer affected by the spell": what this caster's spell held on any
 *  other creature ends, and one it lifted falls. */
export function releasePriorTarget(ctx: ResolveContext): void {
  const { action, attacker, state } = ctx;
  if (!action.failureMove || !action.spellId || ctx.input.commit === false) return;
  const now = new Set(ctx.targets.map((target) => target.id));
  for (const bearer of state.actors) {
    if (now.has(bearer.id)) continue;
    for (const effect of [...bearer.effects]) {
      if (effect.sourceActorId !== attacker.id || effect.spell?.id !== action.spellId) continue;
      if (!effect.tags.includes(TELEKINETIC_TAG)) continue;
      ctx.effectsEnded.push(endedEffect(bearer, effect));
      for (const event of endEffect(state, bearer.id, effect.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
      ctx.tableNarration.push({
        kind: "effect",
        text: `${attacker.name} lets ${bearer.name} go (${action.name}).`,
        actorIds: [bearer.id]
      });
    }
  }
}
