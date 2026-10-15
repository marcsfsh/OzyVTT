import type { Actor } from "@vtt/domain";

// Shared condition math (SRD 5.2.1 glossary). Dependency-free so any engine module can import it.

/** Conditions that include Incapacitated (SRD 2024): no actions, bonus actions, or reactions while any is active. */
export const INCAPACITATING_CONDITIONS = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"] as const;

/** The first incapacitating condition the actor has, so a refusal can name it; null when none. */
export function incapacitatingCondition(actor: Actor): string | null {
  return (
    actor.conditions.find((condition) => (INCAPACITATING_CONDITIONS as readonly string[]).includes(condition.id))?.id ??
    null
  );
}

export function isIncapacitated(actor: Actor): boolean {
  return incapacitatingCondition(actor) !== null;
}

/** While Paralyzed/Petrified/Stunned/Unconscious a creature automatically fails Strength and Dexterity saves (SRD conditions appendix). */
const AUTO_FAIL_PHYSICAL_SAVES = ["paralyzed", "petrified", "stunned", "unconscious"] as const;

export function autoFailsPhysicalSaves(actor: Actor): string | null {
  return (
    actor.conditions.find((condition) => (AUTO_FAIL_PHYSICAL_SAVES as readonly string[]).includes(condition.id))?.id ??
    null
  );
}

export function exhaustionLevel(actor: Actor): number {
  return actor.conditions.find((condition) => condition.id === "exhaustion")?.level ?? 0;
}

/** SRD 5.2.1 Exhaustion: −2 × level to every D20 Test (attack rolls, checks, and saving throws). */
export function exhaustionPenalty(actor: Actor): number {
  return -2 * exhaustionLevel(actor);
}

export function conditionLabel(conditionId: string): string {
  return conditionId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
