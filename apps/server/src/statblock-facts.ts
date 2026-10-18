import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { experienceForChallenge } from "@vtt/rules-5e";

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
} {
  const extension = (definition.extensions ?? {})[STATBLOCK_EXTENSION];
  const bag = (extension && typeof extension === "object" ? extension : {}) as {
    challengeRating?: unknown;
    type?: unknown;
    experiencePoints?: unknown;
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
          : experienceForChallenge(challengeRating)
  };
}

/** A creature's type for the rules that name one: its stat block's, else Humanoid for a player character (every SRD
 *  species is a Humanoid); null when neither says. */
export function creatureTypeOf(actor: Pick<Actor, "kind">, definition: ActorDefinition | undefined): string | null {
  const printed = definition ? statblockFacts(definition).creatureType : null;
  if (printed !== null) return printed.toLowerCase();
  return actor.kind === "player-character" ? "humanoid" : null;
}
