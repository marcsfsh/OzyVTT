import type { AbilityId, ActorDerivedSheet } from "@vtt/domain";
import { gatePasses, triggerKind, type RiderModifier } from "@vtt/rules-5e";
import type { EquipmentDerivation } from "./equipment-derivation.js";

// SRD gear that helps a check only in a situation the roller names (a Book's topic, a Map's place, a Costume's
// part, prying with a Crowbar, a Magnifying Glass's detail, a Pole's vault): each rider waits on `situation-is`, the
// sheet offers the situation as a toggle, and a check roll that names it gets the rider.

type DerivedSituation = ActorDerivedSheet["situations"][number];

const signed = (value: number) => (value < 0 ? `${value}` : `+${value}`);

/** What a situational rider gives a check it fits, in the sheet's words; null for a kind no check reads. */
function effectWords(modifier: RiderModifier): string | null {
  if (modifier.type === "roll-mode" && modifier.roll === "check")
    return modifier.mode === "disadvantage" ? "Disadvantage" : "Advantage";
  if (modifier.type !== "check-bonus") return null;
  const parts = [
    modifier.amount !== undefined && modifier.amount !== 0 ? signed(modifier.amount) : null,
    modifier.dice !== undefined ? (modifier.dice.startsWith("-") ? modifier.dice : `+${modifier.dice}`) : null
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** The situations the bearer's riders name for its checks, each with what it gives and the checks it can fit. A
 *  rider whose gates don't hold now (an attunement, a condition) names none; two riders naming one situation share
 *  its toggle. */
export function checkSituations(derivation: EquipmentDerivation): DerivedSituation[] {
  const found = new Map<string, DerivedSituation>();
  for (const carrier of derivation.carriers) {
    for (const modifier of carrier.modifiers) {
      const when = modifier.when ?? [];
      const situation = when.find((trigger) => trigger.type === "situation-is")?.situation;
      const effect = situation === undefined ? null : effectWords(modifier);
      if (situation === undefined || effect === null) continue;
      const gates = when.filter((trigger) => triggerKind(trigger.type).endsWith("gate"));
      if (!gatePasses(gates, derivation.context, carrier.sourceItemId)) continue;
      const held = found.get(situation);
      if (held) {
        found.set(situation, { ...held, effect: `${held.effect}, ${effect}` });
        continue;
      }
      found.set(situation, {
        situation,
        source: carrier.label,
        effect,
        abilities: [...((when.find((trigger) => trigger.type === "ability-is")?.abilities ?? []) as AbilityId[])],
        skills: [...(when.find((trigger) => trigger.type === "skill-is")?.skills ?? [])]
      });
    }
  }
  return [...found.values()];
}
