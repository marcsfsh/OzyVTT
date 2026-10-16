import type { Actor } from "@vtt/domain";
import { collectRiders, sumRiders } from "@vtt/rules-5e";
import { exhaustionLevel } from "./condition-rules.js";
import type { EquipmentDerivation } from "./equipment-derivation.js";

/** Conditions that set Speed to 0 (SRD 5.2.1 conditions appendix; Stunned no longer does). */
const SPEED_ZERO_CONDITIONS = ["grappled", "restrained", "unconscious", "paralyzed", "petrified"] as const;

/** True while a condition, or an effect such as Hypnotic Pattern's charm, sets Speed to 0 (SRD: "your Speed is 0
 *  and can't increase"). */
export function speedZeroed(actor: Actor): boolean {
  return (
    actor.conditions.some((condition) => (SPEED_ZERO_CONDITIONS as readonly string[]).includes(condition.id)) ||
    actor.effects.some((effect) => effect.speedZero === true)
  );
}

/** Current Speed in feet, before Dash: base minus 5 x exhaustion (floored at 0, so no debt carries), plus the
 *  standing `speed` riders of the actor's live effects and active items, floored again. A feature's `speed` is
 *  already in the base. Instances sharing a `stackKey` count once (two Slows are -10). A Speed-0 condition
 *  returns 0. Never writes `actor.speedFeet`. Null when base speed is unknown. */
export function currentSpeedFeet(actor: Actor, derivation: EquipmentDerivation): number | null {
  if (actor.speedFeet === undefined) return null;
  if (speedZeroed(actor)) return 0;
  const base = Math.max(0, actor.speedFeet - 5 * exhaustionLevel(actor));
  const riders = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  return Math.max(0, base + sumRiders(riders, "speed"));
}

/** This turn's movement budget: current Speed plus Dash grants. Dash adds movement without raising Speed.
 *  The grant is stored when taken (`movementGrantFeet`), so a later Slow can't shrink it; older effects
 *  without it fall back to doubling. A Speed-0 condition refuses the grant too. */
export function effectiveSpeedFeet(actor: Actor, derivation: EquipmentDerivation): number | null {
  const speed = currentSpeedFeet(actor, derivation);
  if (speed === null) return null;
  if (speedZeroed(actor)) return 0;
  let granted = 0;
  let legacyDashing = false;
  for (const effect of actor.effects) {
    if (effect.movementGrantFeet !== undefined) granted += effect.movementGrantFeet;
    else if (effect.tags.includes("dashing")) legacyDashing = true;
  }
  return (legacyDashing ? speed * 2 : speed) + granted;
}
