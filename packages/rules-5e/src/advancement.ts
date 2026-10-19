// Character advancement (SRD 5.2.1 Character Creation, "Character Advancement" table): the XP a character needs for
// each level, read off the total character level whatever the classes (Multiclassing, "Experience Points").

import { experienceForChallenge } from "./encounters.js";

/** The XP at which each level starts, level 1 first. */
const XP_FOR_LEVEL: readonly number[] = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000,
  265000, 305000, 355000
];

/** The XP a character needs to be `level` (1-20). A character starting above level 1 begins with it. */
export function experienceForLevel(level: number): number {
  return XP_FOR_LEVEL[Math.min(20, Math.max(1, Math.trunc(level))) - 1]!;
}

/** The level an XP total reaches. */
export function levelForExperience(experience: number): number {
  let level = 1;
  while (level < 20 && experience >= XP_FOR_LEVEL[level]!) level += 1;
  return level;
}

/** The XP that starts the level after `level`, or null at level 20. */
export function experienceForNextLevel(level: number): number | null {
  return level >= 20 ? null : experienceForLevel(level + 1);
}

/** The challenge ratings in order, so a creature's next one can be read. */
const CHALLENGE_RATINGS: readonly number[] = [
  0,
  0.125,
  0.25,
  0.5,
  ...Array.from({ length: 30 }, (_, index) => index + 1)
];

/**
 * A legendary creature's XP when it is fought in its lair, or null when it has none. SRD 5.2.1 prints it beside its XP
 * ("XP 18,000, or 20,000 in lair") for the creatures whose Legendary Resistance grows in their lair, and it is the XP
 * of the next challenge rating.
 */
export function experienceInLair(challengeRating: number, traitNames: readonly string[]): number | null {
  if (!traitNames.some((name) => /\bin lair\)/i.test(name))) return null;
  const next = CHALLENGE_RATINGS[CHALLENGE_RATINGS.indexOf(challengeRating) + 1];
  return next === undefined || CHALLENGE_RATINGS.indexOf(challengeRating) < 0 ? null : experienceForChallenge(next);
}
