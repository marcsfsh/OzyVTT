import type { Actor } from "@vtt/domain";
import { MASKED_TYPE_TAG, type ActorDefinition } from "@vtt/schemas";
import { experienceForChallenge, experienceInLair } from "@vtt/rules-5e";

/** The extension key challenge rating and creature type actually live under. */
export const STATBLOCK_EXTENSION = "open5e.srd-2024";
/** The Swim Speed a stat block prints, in feet; null when it prints none (SRD Underwater Combat reads it). */
export function swimSpeedFeet(definition: ActorDefinition | undefined): number | null {
  const extension = (definition?.extensions ?? {})[STATBLOCK_EXTENSION];
  const speeds = (extension && typeof extension === "object" ? (extension as { speeds?: unknown }).speeds : null) as {
    swim?: unknown;
  } | null;
  return speeds && typeof speeds.swim === "number" && speeds.swim > 0 ? speeds.swim : null;
}

/** A creature's bestiary facts from its extension bag; exported so the publish gate checks the same thing. */
export function statblockFacts(definition: ActorDefinition): {
  challengeRating: number | null;
  creatureType: string | null;
  experiencePoints: number | null;
  /** The XP it is worth fought in its lair, for a legendary creature with one; else null. */
  experiencePointsInLair: number | null;
} {
  const extension = (definition.extensions ?? {})[STATBLOCK_EXTENSION];
  const bag = (extension && typeof extension === "object" ? extension : {}) as {
    challengeRating?: unknown;
    type?: unknown;
    experiencePoints?: unknown;
    traits?: unknown;
  };
  // Narrowed by checks (no cast): the bag is untyped. Null means "nothing to show", which the publish gate refuses.
  const challengeRating = typeof bag.challengeRating === "number" ? bag.challengeRating : null;
  return {
    challengeRating,
    creatureType: typeof bag.type === "string" && bag.type.length > 0 ? bag.type : null,
    // A homebrew creature may give only its CR; the SRD's table fills in the XP.
    experiencePoints:
      typeof bag.experiencePoints === "number"
        ? bag.experiencePoints
        : challengeRating === null
          ? null
          : experienceForChallenge(challengeRating),
    experiencePointsInLair:
      challengeRating === null
        ? null
        : experienceInLair(
            challengeRating,
            (Array.isArray(bag.traits) ? bag.traits : []).flatMap((trait: unknown) =>
              typeof (trait as { name?: unknown }).name === "string" ? [(trait as { name: string }).name] : []
            )
          )
  };
}

/** A creature's type for the rules that name one: its stat block's, else Humanoid for a player character (every SRD
 *  species is a Humanoid); null when neither says. Spells and other magic read the type a live effect masks it as
 *  (Arcanist's Magic Aura: "Spells and other magical effects treat the target as if it were a creature of the chosen
 *  type"); a rule that isn't magic (Animal Handling, a stat block's own trait) asks for the `true` type. */
export function creatureTypeOf(
  actor: Pick<Actor, "kind"> & Partial<Pick<Actor, "effects">>,
  definition: ActorDefinition | undefined,
  read: "magic" | "true" = "magic"
): string | null {
  if (read === "magic") {
    const masked = (actor.effects ?? [])
      .flatMap((effect) => effect.tags)
      .find((tag) => tag.startsWith(MASKED_TYPE_TAG));
    if (masked) return masked.slice(MASKED_TYPE_TAG.length);
  }
  const printed = definition ? statblockFacts(definition).creatureType : null;
  if (printed !== null) return printed.toLowerCase();
  return actor.kind === "player-character" ? "humanoid" : null;
}
