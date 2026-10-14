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

/** True while a condition that sets Speed to 0 is active - the SRD's "your Speed is 0 and can't increase". */
function speedZeroed(actor: Actor): boolean {
  return actor.conditions.some((condition) => (SPEED_ZERO_CONDITIONS as readonly string[]).includes(condition.id));
}

/**
 * SAME-NAME EFFECTS DON'T COMBINE (SRD 5.2.1 rules glossary, "Combining Game Effects"): of two
 * contributions sharing one `stackKey`, the MOST POTENT applies - the larger magnitude, since the
 * vocabulary is signed and a -10 penalty is as potent as a +10 boon. A tie between opposite signs
 * takes the MINIMUM, the worse for the bearer, so an equal boon can never displace a penalty.
 */
function morePotent(held: number, candidate: number): number {
  if (Math.abs(candidate) > Math.abs(held)) return candidate;
  if (Math.abs(candidate) < Math.abs(held)) return held;
  return Math.min(held, candidate);
}

/**
 * THE CREATURE'S SPEED RIGHT NOW, in feet - the SRD's "your Speed", before any Dash.
 *
 * Order of operations, and it is the whole of the function: base - 5 x exhaustion level, **floored at
 * 0** -> + every `speed` modifier its live effects carry (grouped, see below) -> floored at 0 again.
 *
 * THE FIRST FLOOR IS LOAD-BEARING. A reduction cannot drive a Speed below zero and leave a DEBT for a
 * later bonus to pay off: Speed 20 at Exhaustion 5 is 0, and a +10 then reads 10 - not 5, which is
 * what `20 - 25 + 10` produced while the only floor sat at the end. No printed rule describes a
 * negative Speed, so nothing may carry one forward; each reduction stops at 0 where it applies.
 *
 * SAME-NAME EFFECTS DO NOT STACK, and `stackKey` is where that identity lives (see the field's own
 * docblock in `@vtt/schemas`). The `speed` modifiers under one key contribute their single most
 * potent value - two attackers' Slows are one -10, and so are a javelin's and a club's - while
 * keyless effects and DIFFERENT keys still sum, so a Slow plus a Longstrider is -10 +10. This module
 * knows nothing about masteries: it groups by a string and takes the most potent member.
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
  if (speedZeroed(actor)) return 0;
  const incapacitated = isIncapacitated(actor);
  let speed = Math.max(0, actor.speedFeet - 5 * exhaustionLevel(actor));
  // One entry per `stackKey`, holding that game effect's most potent contribution so far.
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

/**
 * The MOVEMENT BUDGET for the current turn: the creature's Speed right now PLUS every extra-movement
 * grant it has taken this turn.
 *
 * Split from the Speed above because the two are not the same number and one caller needs each:
 * Dash grants extra movement, it does not raise your Speed, so standing up out of Prone still costs
 * half the UNdoubled Speed (`actor-conditions.ts`) while the map budget gets the grant.
 *
 * THE GRANT IS A STORED QUANTITY, NOT A MULTIPLIER RE-EVALUATED HERE, and that is this function's
 * one hard rule. Dash grants "extra movement for the current turn equal to your Speed after
 * modifiers" - measured once, when the Dash is taken (`action-resolution.ts` writes it onto the
 * effect as `movementGrantFeet`). Doubling the LIVE Speed on every read let a Slow that landed
 * mid-turn rewrite feet already granted and already spent: Speed 30 Dashes to 60, runs 35, is slowed
 * to 20, and the next step was measured against 40 instead of 50 - a creature charged 20 feet for an
 * opportunity attack that happened after it had already moved. Fixed at the grant, the same turn
 * reads 20 + 30 - 35 = 15 feet left. Taking the Dash while ALREADY slowed still grants the REDUCED
 * Speed, so a 40-ft creature slowed to 30 Dashes to 30 + 30 = 60 - the same number the doubling
 * printed, reached by adding a fixed grant instead of multiplying a live one.
 *
 * A `dashing` effect with NO stored grant is one persisted by a build that predates the field; it
 * falls back to the old doubling so a fight saved mid-turn keeps its Dash rather than losing it.
 *
 * "Your Speed is 0 AND CAN'T INCREASE" refuses the grant as well: a creature that Dashed and was then
 * grappled does not walk away on the feet the Dash handed it, which is the same second clause the
 * Speed above enforces.
 */
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
