import type { Actor } from "@vtt/domain";

/**
 * Shared condition math (SRD 5.2.1 rules glossary). Pure actor-level lookups used by action
 * resolution, saving throws, and the effect lifecycle - kept dependency-free so any engine module
 * can import it without cycles.
 */

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

/**
 * Effective speed in feet for the current turn: base − 5 × exhaustion level (floored at 0),
 * zeroed by Speed-0 conditions, doubled while Dashing. Null when the base speed is unknown -
 * the movement rules then skip entirely (the unmeasurable pattern).
 */
export function effectiveSpeedFeet(actor: Actor): number | null {
  if (actor.speedFeet === undefined) return null;
  if (actor.conditions.some((condition) => (SPEED_ZERO_CONDITIONS as readonly string[]).includes(condition.id))) return 0;
  let speed = Math.max(0, actor.speedFeet - 5 * exhaustionLevel(actor));
  if (actor.effects.some((effect) => effect.tags.includes("dashing"))) speed *= 2;
  return speed;
}
