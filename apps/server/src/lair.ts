import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";

/**
 * A legendary creature fought in its lair (SRD 5.2.1: "Legendary Action Uses: 3 (4 in Lair)", "Legendary Resistance
 * (3/Day, or 4/Day in Lair)"): the GM's switch puts the lair's counts on the creature, which the legendary pool and
 * Legendary Resistance read. Null for a stat block that prints no lair.
 */
export function legendaryInLair(
  definition: ActorDefinition | undefined,
  inLair: boolean
): NonNullable<Actor["legendary"]> | null {
  const printed = definition?.legendary;
  if (!printed || (printed.actionsInLair === undefined && printed.resistancesInLair === undefined)) return null;
  if (!inLair) return { ...printed };
  return {
    ...printed,
    ...(printed.actionsInLair !== undefined ? { actionsPerRound: printed.actionsInLair } : {}),
    ...(printed.resistancesInLair !== undefined ? { resistancesPerDay: printed.resistancesInLair } : {}),
    inLair: true
  };
}

/** The legendary actions a creature has each round: its own counts (the lair's while it fights there), else its stat
 *  block's, else the SRD's usual 3. */
export const legendaryActionsPerRound = (
  actor: Pick<Actor, "legendary">,
  definition: ActorDefinition | undefined
): number => actor.legendary?.actionsPerRound ?? definition?.legendary?.actionsPerRound ?? 3;

/** The Legendary Resistance a creature has each day, read the same way; 0 for none. */
export const legendaryResistancesPerDay = (
  actor: Pick<Actor, "legendary">,
  definition: ActorDefinition | undefined
): number => actor.legendary?.resistancesPerDay ?? definition?.legendary?.resistancesPerDay ?? 0;
