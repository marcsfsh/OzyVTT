import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";

/**
 * SRD Trance (Elf): "You don't need to sleep, and magic can't put you to sleep. You can finish a Long Rest in 4 hours
 * if you spend those hours in a trancelike meditation." The Sleep spell names the same creatures: "Creatures that don't
 * sleep, such as elves, or that have Immunity to the Exhaustion condition automatically succeed".
 */

/** The elf's own Long Rest: 4 hours of trance in place of 8. */
export const TRANCE_LONG_REST_MINUTES = 4 * 60;

/** Whether the creature holds Trance: the species trait, or an elf's sheet from before it was listed. */
export function holdsTrance(definition: ActorDefinition | undefined): boolean {
  return holdsFeature(definition, "elf-trance", "Trance") || definition?.character?.race?.id === "elf";
}

/** Whether magic can't put the creature to sleep: Trance, or Immunity to the Exhaustion condition. */
export function doesntSleep(
  actor: Pick<Actor, "conditionImmunities">,
  definition: ActorDefinition | undefined
): boolean {
  return holdsTrance(definition) || actor.conditionImmunities.includes("exhaustion");
}
