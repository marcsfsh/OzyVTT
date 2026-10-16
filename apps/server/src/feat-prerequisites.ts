import type { Ability } from "@vtt/rules-5e";
import type { ClassReference, FeatReference, FeatureRecord, SubclassReference } from "@vtt/content-srd-5.2.1";

/**
 * Feat prerequisites (SRD 5.2.1 Feats: "To take a feat, you must meet any prerequisite in its description"),
 * shared by the build, the builder's offers and the random generator so the three agree.
 */

/** What a character brings to one feat slot. */
export type FeatQualification = Readonly<{
  /** The character level the feat is taken at. */
  level: number;
  /** Ability scores at that slot, before the feat's own increase. Null when unknown (the builder's offers). */
  scores: Readonly<Record<Ability, number>> | null;
  /** Whether a class or subclass gives the Spellcasting (or Pact Magic) feature. */
  spellcasting: boolean;
  /** Ids and tags of the features held (feats excluded) and the armor and weapon training: what `requires`
   *  slugs name ("fighting-style"). */
  held: ReadonlySet<string>;
}>;

/**
 * The half of a qualification that does not change from slot to slot. Features are read at the build's own
 * level rather than the slot's, which no SRD prerequisite tells apart.
 */
export function featHoldings(
  build: Readonly<{
    classRecord: ClassReference | null;
    subclass: SubclassReference | null;
    /** `origin: null` marks a feat's own feature, which is not a feature the character holds for this. */
    granted: ReadonlyArray<Readonly<{ record: FeatureRecord; origin: unknown }>>;
  }>
): Pick<FeatQualification, "spellcasting" | "held"> {
  const held = new Set<string>([
    ...(build.classRecord?.armorProficiencies ?? []),
    ...(build.classRecord?.weaponProficiencies ?? [])
  ]);
  for (const { record, origin } of build.granted) {
    if (origin === null) continue;
    held.add(record.id);
    for (const tag of record.tags) held.add(tag);
    for (const id of [...(record.grants?.armor ?? []), ...(record.grants?.weapons ?? [])]) held.add(id);
  }
  return {
    spellcasting: Boolean(build.subclass?.spellcasting ?? build.classRecord?.spellcasting),
    held
  };
}

/** The `requires` slug that means the Spellcasting feature rather than a held feature id. */
const SPELLCASTING = "spellcasting";

/** Why this character cannot take the feat at this slot, in a sentence, or null when it qualifies. */
export function featPrerequisiteFailure(feat: FeatReference, at: FeatQualification): string | null {
  const prerequisite = feat.prerequisite;
  if (!prerequisite) return null;
  if (prerequisite.level !== undefined && at.level < prerequisite.level)
    return `${feat.name} needs character level ${prerequisite.level}; this pick is at level ${at.level}.`;
  for (const slug of prerequisite.requires) {
    const met = slug === SPELLCASTING ? at.spellcasting : at.held.has(slug);
    if (!met)
      return slug === SPELLCASTING
        ? `${feat.name} needs the Spellcasting feature.`
        : prerequisite.text
          ? `${feat.name}'s prerequisite is not met: ${prerequisite.text.replace(/\.$/, "")}.`
          : `${feat.name} needs ${slug.replace(/-/g, " ")}.`;
  }
  const minimums = prerequisite.abilityScores;
  if (minimums.length > 0 && at.scores) {
    const scores = at.scores;
    const meets = (entry: (typeof minimums)[number]) => scores[entry.ability] >= entry.minimum;
    const any = prerequisite.abilityScoreMode === "any";
    if (any ? !minimums.some(meets) : !minimums.every(meets)) {
      const wanted = minimums
        .filter((entry) => any || !meets(entry))
        .map((entry) => `${entry.ability.toUpperCase()} ${entry.minimum}`)
        .join(any ? " or " : " and ");
      const have = minimums.map((entry) => `${entry.ability.toUpperCase()} ${scores[entry.ability]}`).join(", ");
      return `${feat.name} needs ${wanted}; at level ${at.level} you have ${have}.`;
    }
  }
  return null;
}
