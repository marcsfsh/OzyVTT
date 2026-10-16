import type { Actor } from "@vtt/domain";

/** SRD Cover: half and three-quarters raise AC and Dexterity saves; total can't be targeted directly. */
export type CoverDegree = "half" | "three-quarters" | "total";

/** The effect tag the GM's cover marker carries on a creature. */
export const COVER_TAGS: Readonly<Record<CoverDegree, string>> = {
  half: "cover-half",
  "three-quarters": "cover-three-quarters",
  total: "cover-total"
};

const ORDER: readonly CoverDegree[] = ["total", "three-quarters", "half"];

/**
 * The cover the GM has marked a creature with ("The GM determines whether the target has Cover"): an effect tagged
 * for it, which every attack and Dexterity save against the creature reads, a player's included. The best degree
 * wins. Null when unmarked.
 */
export function standingCover(actor: Pick<Actor, "effects">): CoverDegree | null {
  return ORDER.find((degree) => actor.effects.some((effect) => effect.tags.includes(COVER_TAGS[degree]))) ?? null;
}

/** The cover for one target of a resolve: the GM's choice for this resolve, else the target's standing marker. */
export function coverFor(chosen: CoverDegree | null | undefined, target: Pick<Actor, "effects">): CoverDegree | null {
  return chosen ?? standingCover(target);
}

/** Cover's bonus to AC and Dexterity saves: +2 half, +5 three-quarters. */
export const coverBonusOf = (cover: CoverDegree | null): number =>
  cover === "half" ? 2 : cover === "three-quarters" ? 5 : 0;
