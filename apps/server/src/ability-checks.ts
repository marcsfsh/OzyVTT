import { aggregateRollMode, collectRiders, type AggregatedRollMode, type RiderAbility, type RollModeSource } from "@vtt/rules-5e";
import type { EquipmentDerivation } from "./equipment-derivation.js";

/**
 * ============================================================================================
 * ADVANTAGE AND DISADVANTAGE ON AN ABILITY CHECK
 * ============================================================================================
 *
 * The half of the check story `checkRiderBonus` (`equipment-derivation.ts`) does not tell.
 *
 * `roll-mode` has always ACCEPTED `roll: "check"` - `RiderModifier.roll` lists it and
 * `RiderTrigger` lists `on-ability-check` - and until this module existed nothing read either.
 * Grepping every `roll-mode` consumer found exactly four rolls: `attack` and `incoming-attack`
 * (`action-resolution.ts`), `initiative` (`encounter.ts`) and `save` (`saving-throws.ts`). So
 * "you have Advantage on Dexterity (Stealth) checks" parsed, published, validated - and changed
 * no die. `check-bonus` DOES reach the sheet's rows, and a flat bonus is NOT the same sentence:
 * it is a different distribution with a different ceiling, and substituting one for the other
 * would quietly turn eight printed magic items into something they do not say.
 *
 * MIRRORS `saveRollSources` (`saving-throws.ts`) deliberately, down to the two-pass loop: a
 * rider with NO `when` is STANDING ("advantage on ability checks") and is invisible to a
 * moment-only collection, while `on-ability-check` plus an `ability-is`/`skill-is` filter is the
 * narrowed form. Both passes are collected and they are DISJOINT BY CONSTRUCTION - `collectRiders`
 * excludes anything carrying a moment or a filter from the moment-less pass - so a rider can
 * never be counted twice.
 *
 * WHAT THIS DOES NOT READ, stated so the gap is not mistaken for coverage: `actor.effects`.
 * `EffectModifierSchema` also admits `roll-mode`, and the Barbarian's Rage ships one
 * (`classes.v1.json`: `{roll: "check", mode: "advantage", when: [on-ability-check, ability-is
 * str]}`). Reading it is NOT a line of code: `toRollModes` normalises an effect modifier to
 * `{roll, mode}` and DROPS `when`, and an effect has no `RiderContext` to evaluate a gate
 * against, so a naive read would give a raging Barbarian advantage on Stealth - an over-grant
 * that is worse than the silence. That needs a design decision about how an effect carries its
 * gates; it is recorded, not guessed at.
 */

/**
 * Advantage/disadvantage an ABILITY CHECK collects from the bearer's carriers - equipped items,
 * feats and class features alike, since `deriveEquipment` folds all three into `carriers`.
 *
 * `narrow` is what makes "+advantage on Stealth" mean Stealth: passing `ability`/`skill` into the
 * context is what lets `ability-is` and `skill-is` match, exactly as `checkRiderBonus` does for the
 * flat half. Omitting both selects only the unnarrowed riders, because a filter with nothing to
 * match against fails CLOSED (`riders.ts` `passes`) - the same fail-closed the rest of the
 * interpreter uses, and the reason a caller that cannot name the check gets no advantage rather
 * than everyone's.
 */
export function checkRollSources(
  derivation: EquipmentDerivation,
  narrow: Readonly<{ ability?: RiderAbility; skill?: string }> = {}
): { advantage: RollModeSource[]; disadvantage: RollModeSource[] } {
  const advantage: RollModeSource[] = [];
  const disadvantage: RollModeSource[] = [];
  const narrowed = {
    ...(narrow.ability !== undefined ? { ability: narrow.ability } : {}),
    ...(narrow.skill !== undefined ? { skill: narrow.skill } : {})
  };
  for (const moment of [null, "on-ability-check"] as const) {
    for (const rider of collectRiders(derivation.carriers, { ...derivation.context, ...narrowed, moment })) {
      if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "check" || rider.modifier.mode === undefined) continue;
      (rider.modifier.mode === "advantage" ? advantage : disadvantage).push({ source: `item:${rider.sourceItemId ?? rider.label}`, label: rider.label });
    }
  }
  return { advantage, disadvantage };
}

/**
 * The aggregated mode for one ability check, with the sources that produced it kept for the roll
 * card. 5e cancellation is `aggregateRollMode`'s and is not re-implemented: any advantage plus any
 * disadvantage is a normal roll however many of each there are.
 *
 * Returns `mode: "normal"` with two empty lists when nothing contributed, which is precisely the
 * shape a caller needs to keep rolling `1d20` exactly as it does today.
 */
export function checkRollMode(
  derivation: EquipmentDerivation,
  narrow: Readonly<{ ability?: RiderAbility; skill?: string }> = {}
): AggregatedRollMode {
  const sources = checkRollSources(derivation, narrow);
  return aggregateRollMode(sources.advantage, sources.disadvantage);
}

/** The d20 expression one aggregated mode rolls (SRD Advantage and Disadvantage: two dice, keep one). */
export function checkDieFor(mode: AggregatedRollMode["mode"]): string {
  return mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
}
