import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { collectRiders, sumRiders } from "@vtt/rules-5e";
import { exhaustionLevel } from "./condition-rules.js";
import type { EquipmentDerivation } from "./equipment-derivation.js";
import { STATBLOCK_EXTENSION } from "./statblock-facts.js";

/** The bearer's Speed is halved while this lasts (Slow, a Stunning Strike the target saved against). */
export const SPEED_HALVED_TAG = "speed-halved";

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

/** The standing `speed` riders of the actor's live effects and active items. A feature's `speed` is already in the
 *  base. Instances sharing a `stackKey` count once (two Slows are -10). */
function riderSpeed(derivation: EquipmentDerivation): number {
  return sumRiders(collectRiders(derivation.carriers, { ...derivation.context, moment: null }), "speed");
}

/** An effect that doubles or halves Speed applies after every other change, to the Speed of the moment (SRD Haste:
 *  "the target's Speed is doubled"; Slow: "Speed is halved"), rounded down. Two instances of one effect count once
 *  (SRD "Combining Game Effects": a `stackKey`, or the halving tag), and it changes a special speed too (SRD "Speed":
 *  "if your Speed is halved and you have a Fly Speed, your Fly Speed is also halved"). */
function multipliedSpeed(actor: Actor, feet: number): number {
  const multipliers = new Map<string, number>();
  for (const effect of actor.effects) {
    if (effect.speedMultiplier === undefined) continue;
    const key = effect.stackKey ?? effect.id;
    multipliers.set(key, Math.max(multipliers.get(key) ?? 1, effect.speedMultiplier));
  }
  const multiplied = [...multipliers.values()].reduce((total, factor) => total * factor, feet);
  return actor.effects.some((effect) => effect.tags.includes(SPEED_HALVED_TAG))
    ? Math.floor(multiplied / 2)
    : multiplied;
}

/** The Speed a standing `speed-minimum` rider sets when the creature's own is lower ("Your Speed becomes 30 feet unless
 *  your Speed is higher", Boots of Striding and Springing), or 0. */
function speedFloor(derivation: EquipmentDerivation): number {
  const riders = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  return Math.max(
    0,
    ...riders.map((rider) => (rider.modifier.type === "speed-minimum" ? (rider.modifier.feet ?? 0) : 0))
  );
}

/** Current Speed in feet, before Dash: base (raised to any `speed-minimum`) minus 5 x exhaustion (floored at 0, so no
 *  debt carries), plus the standing `speed` riders, floored again, then doubled or halved where an effect does so. A
 *  Speed-0 condition returns 0. Never writes `actor.speedFeet`. Null when base speed is unknown. */
export function currentSpeedFeet(actor: Actor, derivation: EquipmentDerivation): number | null {
  if (actor.speedFeet === undefined) return null;
  if (speedZeroed(actor)) return 0;
  const base = Math.max(0, Math.max(actor.speedFeet, speedFloor(derivation)) - 5 * exhaustionLevel(actor));
  return multipliedSpeed(actor, Math.max(0, base + riderSpeed(derivation)));
}

/** How many Dashes the creature has taken this turn, and whether one predates the stored grant (then it doubles). */
function dashesOf(actor: Actor): Readonly<{ granted: number; count: number; legacy: boolean }> {
  let granted = 0;
  let count = 0;
  let legacy = false;
  for (const effect of actor.effects) {
    if (effect.movementGrantFeet !== undefined) {
      granted += effect.movementGrantFeet;
      count += 1;
    } else if (effect.tags.includes("dashing")) legacy = true;
  }
  return { granted, count: count + (legacy ? 1 : 0), legacy };
}

/** This turn's movement budget: current Speed plus Dash grants. Dash adds movement without raising Speed.
 *  The grant is stored when taken (`movementGrantFeet`), so a later Slow can't shrink it; older effects
 *  without it fall back to doubling. A Speed-0 condition refuses the grant too. */
export function effectiveSpeedFeet(actor: Actor, derivation: EquipmentDerivation): number | null {
  const speed = currentSpeedFeet(actor, derivation);
  if (speed === null) return null;
  if (speedZeroed(actor)) return 0;
  const dashes = dashesOf(actor);
  return (dashes.legacy ? speed * 2 : speed) + dashes.granted;
}

/** A way of moving that spends movement: Speed, or one of the special speeds (SRD "Speed"). */
export type TravelMode = "walk" | "fly" | "swim" | "climb" | "burrow";
type SpecialMode = Exclude<TravelMode, "walk">;
export type SpecialSpeeds = Readonly<Partial<Record<SpecialMode, number>> & { hover: boolean }>;

const SPECIAL_MODES: readonly SpecialMode[] = ["fly", "swim", "climb", "burrow"];

/** The special speeds a creature has before anything changes them: what its stat block prints (Fly, Swim, Climb,
 *  Burrow, and whether it hovers), a Ranger's Roving Climb and Swim Speeds equal to its Speed, and what its items
 *  and effects grant (`special-speed`: Fly's 60 feet, Spider Climb's Climb Speed equal to its Speed, a Ring of
 *  Swimming). The best of each counts. */
export function specialSpeedsOf(
  actor: Actor,
  definition: ActorDefinition | undefined,
  derivation?: EquipmentDerivation
): SpecialSpeeds {
  const speeds: Partial<Record<SpecialMode, number>> & { hover: boolean } = { hover: false };
  const extension = (definition?.extensions ?? {})[STATBLOCK_EXTENSION];
  const printed = (extension && typeof extension === "object" ? (extension as { speeds?: unknown }).speeds : null) as
    Record<string, unknown> | null | undefined;
  if (printed && typeof printed === "object") {
    for (const mode of SPECIAL_MODES) {
      const feet = printed[mode];
      if (typeof feet === "number" && feet > 0) speeds[mode] = feet;
    }
    speeds.hover = printed.hover === true;
  }
  // SRD Roving: "You also have a Climb Speed and a Swim Speed equal to your Speed."
  if (actor.speedFeet !== undefined && definition?.character?.features?.some((feature) => feature.id === "roving")) {
    speeds.climb = Math.max(speeds.climb ?? 0, actor.speedFeet);
    speeds.swim = Math.max(speeds.swim ?? 0, actor.speedFeet);
  }
  for (const rider of derivation ? collectRiders(derivation.carriers, { ...derivation.context, moment: null }) : []) {
    const modifier = rider.modifier;
    if (modifier.type !== "special-speed" || modifier.movement === undefined) continue;
    // "Equal to your Speed" is the Speed before changes; the budget then moves it with Speed, as it does any speed.
    const feet = modifier.equalToSpeed ? (actor.speedFeet ?? 0) : (modifier.feet ?? 0);
    if (feet > 0) speeds[modifier.movement] = Math.max(speeds[modifier.movement] ?? 0, feet);
    if (modifier.hover && modifier.movement === "fly") speeds.hover = true;
  }
  return speeds;
}

/** Whether moving this way costs an extra foot for every foot: climbing or swimming without the matching speed
 *  (SRD "Climbing", "Swimming"). */
export function travelCostsExtra(
  actor: Actor,
  definition: ActorDefinition | undefined,
  mode: TravelMode,
  derivation?: EquipmentDerivation
): boolean {
  return (mode === "climb" || mode === "swim") && specialSpeedsOf(actor, definition, derivation)[mode] === undefined;
}

/**
 * This turn's movement budget moving this way. Walking, and climbing or swimming without the speed, spend Speed
 * (`effectiveSpeedFeet`). A special speed changes with Speed (SRD "Changes to Your Speeds": an effect that raises
 * or lowers Speed raises or lowers it by the same amount, and Speed 0 makes it 0), and Dash's extra movement comes in
 * that speed. Null when the creature has no such speed (flying, burrowing) or no known Speed.
 */
export function travelBudgetFeet(
  actor: Actor,
  derivation: EquipmentDerivation,
  definition: ActorDefinition | undefined,
  mode: TravelMode
): number | null {
  const walking = effectiveSpeedFeet(actor, derivation);
  if (mode === "walk") return walking;
  const special = specialSpeedsOf(actor, definition, derivation)[mode];
  if (special === undefined) return mode === "climb" || mode === "swim" ? walking : null;
  if (walking === null) return null;
  if (speedZeroed(actor)) return 0;
  const speed = multipliedSpeed(actor, Math.max(0, special - 5 * exhaustionLevel(actor) + riderSpeed(derivation)));
  return speed * (1 + dashesOf(actor).count);
}

/** One way of moving's Speed as it stands now, before Dash: what "half its Fly Speed" measures. Climbing or swimming
 *  without the speed is walking Speed; null when the creature has no such speed or no known Speed. */
export function currentTravelSpeedFeet(
  actor: Actor,
  derivation: EquipmentDerivation,
  definition: ActorDefinition | undefined,
  mode: TravelMode
): number | null {
  const walking = currentSpeedFeet(actor, derivation);
  if (mode === "walk") return walking;
  const special = specialSpeedsOf(actor, definition, derivation)[mode];
  if (special === undefined) return mode === "climb" || mode === "swim" ? walking : null;
  if (walking === null) return null;
  if (speedZeroed(actor)) return 0;
  return multipliedSpeed(actor, Math.max(0, special - 5 * exhaustionLevel(actor) + riderSpeed(derivation)));
}
