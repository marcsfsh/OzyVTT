import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { collectRiders, sumRiders } from "@vtt/rules-5e";
import { exhaustionLevel } from "./condition-rules.js";
import type { EquipmentDerivation } from "./equipment-derivation.js";
import { immovable, OVERLOADED_SPEED_FEET, overloaded } from "./carrying.js";
import { STATBLOCK_EXTENSION } from "./statblock-facts.js";

/** On an effect, or a worn item's own: "spells and other magical effects can neither reduce the target's Speed nor
 *  cause the target to have the Paralyzed or Restrained conditions" (Freedom of Movement, a Ring of Free Action). */
export const FREEDOM_OF_MOVEMENT_TAG = "freedom-of-movement";

/** The bearer's Speed is halved while this lasts (Slow, a Stunning Strike the target saved against). */
export const SPEED_HALVED_TAG = "speed-halved";

/** Conditions that set Speed to 0 (SRD 5.2.1 conditions appendix; Stunned no longer does). */
const SPEED_ZERO_CONDITIONS = ["grappled", "restrained", "unconscious", "paralyzed", "petrified"] as const;

/** An effect from a spell or another magical source. */
const magicalEffect = (effect: Actor["effects"][number]) => effect.magical === true || effect.spell !== undefined;

/** "Spells and other magical effects can neither reduce the target's Speed" (Freedom of Movement, a Ring of Free
 *  Action): a live effect's tag, or a worn item's own effect's. */
function speedWardedFromMagic(actor: Actor, derivation?: EquipmentDerivation): boolean {
  return (
    actor.effects.some((effect) => effect.tags.includes(FREEDOM_OF_MOVEMENT_TAG)) ||
    (derivation?.context.effectTags ?? []).includes(FREEDOM_OF_MOVEMENT_TAG)
  );
}

/** Whether only magic holds the creature with this condition: every effect that links it is magical, and it wasn't set
 *  on its own. */
function heldOnlyByMagic(actor: Actor, condition: Actor["conditions"][number]): boolean {
  const holders = actor.effects.filter((effect) => effect.linkedConditionIds.includes(condition.id));
  return condition.standalone !== true && holders.length > 0 && holders.every(magicalEffect);
}

/** True while a condition, or an effect such as Hypnotic Pattern's charm, sets Speed to 0 (SRD: "your Speed is 0
 *  and can't increase"). Under Freedom of Movement a magical effect's Speed 0, and a grapple only magic holds, don't. */
export function speedZeroed(actor: Actor, derivation?: EquipmentDerivation): boolean {
  const warded = speedWardedFromMagic(actor, derivation);
  return (
    actor.conditions.some(
      (condition) =>
        (SPEED_ZERO_CONDITIONS as readonly string[]).includes(condition.id) &&
        !(warded && condition.id === "grappled" && heldOnlyByMagic(actor, condition))
    ) || actor.effects.some((effect) => effect.speedZero === true && !(warded && magicalEffect(effect)))
  );
}

/** The standing `speed` riders of the actor's live effects and active items. A feature's `speed` is already in the
 *  base. Instances sharing a `stackKey` count once (two Slows are -10). Under Freedom of Movement, what a magical effect
 *  takes off doesn't count. */
function riderSpeed(derivation: EquipmentDerivation, actor?: Actor): number {
  const magicalCuts = actor && speedWardedFromMagic(actor, derivation);
  const carriers = magicalCuts
    ? derivation.carriers.filter((carrier) => {
        const effect = actor.effects.find((candidate) => candidate.id === carrier.sourceEffectId);
        if (!effect || !magicalEffect(effect)) return true;
        return sumRiders(collectRiders([carrier], { ...derivation.context, moment: null }), "speed") >= 0;
      })
    : derivation.carriers;
  return sumRiders(collectRiders(carriers, { ...derivation.context, moment: null }), "speed");
}

/** An effect that doubles or halves Speed applies after every other change, to the Speed of the moment (SRD Haste:
 *  "the target's Speed is doubled"; Slow: "Speed is halved"), rounded down. Two instances of one effect count once
 *  (SRD "Combining Game Effects": a `stackKey`, or the halving tag), and it changes a special speed too (SRD "Speed":
 *  "if your Speed is halved and you have a Fly Speed, your Fly Speed is also halved"). */
function multipliedSpeed(actor: Actor, feet: number, derivation?: EquipmentDerivation): number {
  const multipliers = new Map<string, number>();
  for (const effect of actor.effects) {
    if (effect.speedMultiplier === undefined) continue;
    const key = effect.stackKey ?? effect.id;
    multipliers.set(key, Math.max(multipliers.get(key) ?? 1, effect.speedMultiplier));
  }
  const multiplied = [...multipliers.values()].reduce((total, factor) => total * factor, feet);
  const warded = speedWardedFromMagic(actor, derivation);
  return actor.effects.some(
    (effect) => effect.tags.includes(SPEED_HALVED_TAG) && !(warded && magicalEffect(effect))
  )
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

/** Whether a load beyond carrying capacity holds the creature's Speed to 5 feet: a `speed-minimum` with
 *  `ignoresArmor` keeps it (Boots of Striding and Springing). */
function loadSlows(derivation: EquipmentDerivation): boolean {
  if (!overloaded(derivation.carrying)) return false;
  const riders = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  return !riders.some((rider) => rider.modifier.type === "speed-minimum" && rider.modifier.ignoresArmor === true);
}

/** Current Speed in feet, before Dash: base (raised to any `speed-minimum`) minus 5 x exhaustion (floored at 0, so no
 *  debt carries), plus the standing `speed` riders, floored again, then doubled or halved where an effect does so,
 *  and no more than 5 feet under a load beyond carrying capacity, 0 beyond twice it. A Speed-0 condition returns 0.
 *  Never writes `actor.speedFeet`. Null when base speed is unknown. */
export function currentSpeedFeet(actor: Actor, derivation: EquipmentDerivation): number | null {
  if (actor.speedFeet === undefined) return null;
  if (speedZeroed(actor, derivation)) return 0;
  const base = Math.max(0, Math.max(actor.speedFeet, speedFloor(derivation)) - 5 * exhaustionLevel(actor));
  const speed = multipliedSpeed(actor, Math.max(0, base + riderSpeed(derivation, actor)), derivation);
  if (immovable(derivation.carrying)) return 0;
  return loadSlows(derivation) ? Math.min(OVERLOADED_SPEED_FEET, speed) : speed;
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
  if (speedZeroed(actor, derivation) || immovable(derivation.carrying)) return 0;
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
  derivation?: EquipmentDerivation,
  /** It isn't the creature's own turn, so a speed it has only on its turn (Acrobatic Movement's climb) doesn't count. */
  offTurn = false
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
    if (modifier.ownTurn && offTurn) continue;
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
  derivation?: EquipmentDerivation,
  offTurn = false
): boolean {
  return (
    (mode === "climb" || mode === "swim") && specialSpeedsOf(actor, definition, derivation, offTurn)[mode] === undefined
  );
}

/**
 * Whether the creature moves across liquid as if it were solid ground: Water Walk (`water-walking`), or a rider that
 * says so (a Monk's Acrobatic Movement, only on its own turn and while it wears no armor and wields no Shield).
 */
export function walksOnLiquid(actor: Actor, derivation?: EquipmentDerivation, offTurn = false): boolean {
  if (
    actor.effects.some((effect) => effect.tags.includes(WATER_WALKING_TAG)) &&
    !actor.effects.some((effect) => effect.tags.includes(BELOW_SURFACE_TAG))
  )
    return true;
  if (!derivation) return false;
  return collectRiders(derivation.carriers, { ...derivation.context, moment: null }).some(
    (rider) =>
      rider.modifier.type === "movement" &&
      rider.modifier.rule === "walks-on-liquid" &&
      !(rider.modifier.ownTurn && offTurn)
  );
}

/** The tag of the effect that lets its bearer walk on liquid (the Water Walk spell). */
export const WATER_WALKING_TAG = "water-walking";
/** The tag of the effect a Water Walk bearer holds while it has passed below the surface. */
export const BELOW_SURFACE_TAG = "below-the-surface";

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
  mode: TravelMode,
  offTurn = false
): number | null {
  const walking = effectiveSpeedFeet(actor, derivation);
  if (mode === "walk") return walking;
  const special = specialSpeedsOf(actor, definition, derivation, offTurn)[mode];
  if (special === undefined) return mode === "climb" || mode === "swim" ? walking : null;
  if (walking === null) return null;
  if (speedZeroed(actor, derivation)) return 0;
  const speed = multipliedSpeed(
    actor,
    Math.max(0, special - 5 * exhaustionLevel(actor) + riderSpeed(derivation, actor)),
    derivation
  );
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
  if (speedZeroed(actor, derivation)) return 0;
  return multipliedSpeed(
    actor,
    Math.max(0, special - 5 * exhaustionLevel(actor) + riderSpeed(derivation, actor)),
    derivation
  );
}
