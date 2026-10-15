import type { ActorDefinition } from "@vtt/schemas";

/** The extension key challenge rating and creature type actually live under. */
export const STATBLOCK_EXTENSION = "open5e.srd-2024";
/** A creature's bestiary facts from its extension bag; exported so the publish gate checks the same thing. */
export function statblockFacts(definition: ActorDefinition): {
  challengeRating: number | null;
  creatureType: string | null;
} {
  const extension = (definition.extensions ?? {})[STATBLOCK_EXTENSION];
  const bag = (extension && typeof extension === "object" ? extension : {}) as {
    challengeRating?: unknown;
    type?: unknown;
  };
  // Narrowed, not cast: the bag is untyped. Null means "nothing to show", which the publish gate refuses.
  return {
    challengeRating: typeof bag.challengeRating === "number" ? bag.challengeRating : null,
    creatureType: typeof bag.type === "string" && bag.type.length > 0 ? bag.type : null
  };
}
