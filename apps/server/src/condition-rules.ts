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
 * THE CREATURE'S SPEED RIGHT NOW, in feet - the SRD's "your Speed", before any Dash.
 *
 * Order of operations, and it is the whole of the function: base − 5 × exhaustion level → **+ every
 * `speed` modifier its live effects carry** → floored at 0. The floor sits AFTER the effect sum, so
 * two −10s cannot drive a 30-ft creature to −10 and then let a Dash double the debt.
 *
 * A Speed-0 condition short-circuits all of it, and that early return IS the SRD's second clause:
 * Grappled reads "your Speed is 0 and can't increase", so a +10 does not argue with it. (Reaching
 * the arithmetic instead would land on the same 0 today; the early return says WHY.)
 *
 * `actor.speedFeet` is the SHEET's number and is never written by an effect: an effect that ends has
 * to give the feet back, so the runtime change lives in `effects[].modifiers` and is summed here on
 * every read. `voidWhileIncapacitated` effects lapse exactly as they do for saves and attack rolls
 * (`saveRollSources`, `activeEffects`) - one rule for what an incapacitated bearer still gets.
 *
 * Null when the base speed is unknown - the movement rules then skip entirely (the unmeasurable
 * pattern), rather than guessing a budget and refusing a move against it.
 *
 * ITEMS ARE ABSENT HERE ON PURPOSE. This module is dependency-free so any engine module can import
 * it without cycles, so it cannot reach `deriveEquipment`; `EquipmentDerivation.speed` has no reader
 * anywhere (see the named absence at its summation site). Boots of Striding need the unit that gives
 * that field one - they are not silently folded in here.
 */
export function currentSpeedFeet(actor: Actor): number | null {
  if (actor.speedFeet === undefined) return null;
  if (actor.conditions.some((condition) => (SPEED_ZERO_CONDITIONS as readonly string[]).includes(condition.id))) return 0;
  const incapacitated = isIncapacitated(actor);
  let speed = actor.speedFeet - 5 * exhaustionLevel(actor);
  for (const effect of actor.effects) {
    if (effect.voidWhileIncapacitated && incapacitated) continue;
    for (const modifier of effect.modifiers) if (modifier.type === "speed") speed += modifier.amount;
  }
  return Math.max(0, speed);
}

/**
 * The MOVEMENT BUDGET for the current turn: `currentSpeedFeet` doubled while Dashing.
 *
 * Split from the Speed above because the two are not the same number and one caller needs each:
 * Dash grants extra movement, it does not raise your Speed, so standing up out of Prone still costs
 * half the UNdoubled Speed (`actor-conditions.ts`) while the map budget gets the double.
 */
export function effectiveSpeedFeet(actor: Actor): number | null {
  const speed = currentSpeedFeet(actor);
  if (speed === null) return null;
  return actor.effects.some((effect) => effect.tags.includes("dashing")) ? speed * 2 : speed;
}
