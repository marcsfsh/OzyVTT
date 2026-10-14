import type { Actor } from "@vtt/domain";

// Shared condition math (SRD 5.2.1 glossary). Dependency-free so any engine module can import it.

/** Conditions that include Incapacitated (SRD 2024): no actions, bonus actions, or reactions while any is active. */
export const INCAPACITATING_CONDITIONS = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"] as const;

export function isIncapacitated(actor: Actor): boolean {
  return actor.conditions.some((condition) => (INCAPACITATING_CONDITIONS as readonly string[]).includes(condition.id));
}

/** While Paralyzed/Petrified/Stunned/Unconscious a creature automatically fails Strength and Dexterity saves (SRD conditions appendix). */
export const AUTO_FAIL_PHYSICAL_SAVES = ["paralyzed", "petrified", "stunned", "unconscious"] as const;

export function autoFailsPhysicalSaves(actor: Actor): string | null {
  return actor.conditions.find((condition) => (AUTO_FAIL_PHYSICAL_SAVES as readonly string[]).includes(condition.id))?.id ?? null;
}

export function exhaustionLevel(actor: Actor): number {
  return actor.conditions.find((condition) => condition.id === "exhaustion")?.level ?? 0;
}

/** SRD 5.2.1 Exhaustion: −2 × level to every D20 Test (attack rolls, checks, and saving throws). */
export function exhaustionPenalty(actor: Actor): number {
  return -2 * exhaustionLevel(actor);
}

export function conditionLabel(conditionId: string): string {
  return conditionId.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** Conditions that set Speed to 0 (SRD conditions appendix). */
export const SPEED_ZERO_CONDITIONS = ["grappled", "restrained", "unconscious", "paralyzed", "petrified", "stunned"] as const;

/** True while a condition that sets Speed to 0 is active (SRD: "your Speed is 0 and can't increase"). */
function speedZeroed(actor: Actor): boolean {
  return actor.conditions.some((condition) => (SPEED_ZERO_CONDITIONS as readonly string[]).includes(condition.id));
}

/** SRD "Combining Game Effects": the most potent (largest magnitude) applies; an opposite-sign tie takes
 *  the minimum so a boon can't displace a penalty. */
function morePotent(held: number, candidate: number): number {
  if (Math.abs(candidate) > Math.abs(held)) return candidate;
  if (Math.abs(candidate) < Math.abs(held)) return held;
  return Math.min(held, candidate);
}

/** Current Speed in feet, before Dash: base minus 5 x exhaustion (floored at 0, so no debt carries), plus
 *  effect `speed` modifiers (one per `stackKey`), floored again. A Speed-0 condition returns 0. Never
 *  writes `actor.speedFeet`. Null when base speed is unknown. Excludes item speed riders. */
export function currentSpeedFeet(actor: Actor): number | null {
  if (actor.speedFeet === undefined) return null;
  if (speedZeroed(actor)) return 0;
  const incapacitated = isIncapacitated(actor);
  let speed = Math.max(0, actor.speedFeet - 5 * exhaustionLevel(actor));
  // One entry per `stackKey`: that game effect's most potent contribution so far.
  const grouped = new Map<string, number>();
  for (const effect of actor.effects) {
    if (effect.voidWhileIncapacitated && incapacitated) continue;
    for (const modifier of effect.modifiers) {
      if (modifier.type !== "speed") continue;
      if (effect.stackKey === undefined) { speed += modifier.amount; continue; }
      const held = grouped.get(effect.stackKey);
      grouped.set(effect.stackKey, held === undefined ? modifier.amount : morePotent(held, modifier.amount));
    }
  }
  for (const amount of grouped.values()) speed += amount;
  return Math.max(0, speed);
}

/** This turn's movement budget: current Speed plus Dash grants. Dash adds movement without raising Speed.
 *  The grant is stored when taken (`movementGrantFeet`), so a later Slow can't shrink it; older effects
 *  without it fall back to doubling. A Speed-0 condition refuses the grant too. */
export function effectiveSpeedFeet(actor: Actor): number | null {
  const speed = currentSpeedFeet(actor);
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
