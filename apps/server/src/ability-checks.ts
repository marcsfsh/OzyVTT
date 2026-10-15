import { aggregateRollMode, type AggregatedRollMode, type RiderAbility } from "@vtt/rules-5e";
import { rollModeClaims, type EquipmentDerivation } from "./equipment-derivation.js";

/** The aggregated advantage/disadvantage for one ability check, with its sources kept for the roll card: every
 *  carrier's `roll-mode {roll: "check"}` riders, standing and `on-ability-check`, narrowed by `ability-is` and
 *  `skill-is` (Rage's Strength checks). The flat bonus half is `checkRiderBonus`. Returns `mode: "normal"` with
 *  empty lists when nothing contributed. */
export function checkRollMode(
  derivation: EquipmentDerivation,
  narrow: Readonly<{ ability?: RiderAbility; skill?: string }> = {}
): AggregatedRollMode {
  const claims = rollModeClaims(derivation, ["check"], "on-ability-check", {
    ...(narrow.ability !== undefined ? { ability: narrow.ability } : {}),
    ...(narrow.skill !== undefined ? { skill: narrow.skill } : {})
  });
  return aggregateRollMode(claims.advantage, claims.disadvantage);
}
