import {
  aggregateRollMode,
  collectRiders,
  type AggregatedRollMode,
  type RiderAbility,
  type RollModeSource
} from "@vtt/rules-5e";
import type { EquipmentDerivation } from "./equipment-derivation.js";

/**
 * Advantage and disadvantage on ability checks from `roll-mode {roll: "check"}` riders; the flat bonus
 * half is `checkRiderBonus`. Mirrors `saveRollSources`: standing riders (no `when`) and
 * `on-ability-check` riders narrowed by `ability-is`/`skill-is` are both collected, disjointly.
 *
 * Does not read `actor.effects`: an effect's roll-mode loses its `when` gate in `toRollModes` and has no
 * rider context, so reading it would over-grant (a raging Barbarian's STR-only advantage on Stealth).
 */

/** Advantage/disadvantage an ability check collects from the bearer's carriers (items, feats, features).
 *  `narrow` supplies `ability`/`skill` so filtered riders can match; without it filtered riders fail
 *  closed and only unnarrowed ones apply. */
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
      if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "check" || rider.modifier.mode === undefined)
        continue;
      (rider.modifier.mode === "advantage" ? advantage : disadvantage).push({
        source: `item:${rider.sourceItemId ?? rider.label}`,
        label: rider.label
      });
    }
  }
  return { advantage, disadvantage };
}

/** The aggregated mode for one check, with its sources kept for the roll card. Cancellation is
 *  `aggregateRollMode`'s. Returns `mode: "normal"` with empty lists when nothing contributed. */
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
