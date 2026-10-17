import type {
  ContentClassSummary,
  ContentEquipmentSummary,
  ContentFeatSummary,
  ContentLanguageSummary,
  ContentSkillSummary,
  ContentSpeciesSummary,
  ContentSpellSummary,
  ContentSubclassSummary
} from "./index.js";

/**
 * Resolver for `fromCatalog` choice slugs, shared by the server (to offer and validate a build) and the
 * homebrew editor (to preview a picker), so both agree on what is offerable.
 *
 * Slug families over open ids:
 *   - `skills`, `weapons`, `tools`, `languages`, `feats` -> the whole catalog list (`feats` is every category:
 *                               "no category is specified" in the SRD's feat rules).
 *   - `<table>-languages`    -> languages printed in one SRD table ("standard-languages").
 *   - `<listId>-spells`      -> spells whose `classes` includes the class's `spellcasting.spellListId`.
 *   - `<listId>-spells-of-<school>` -> those spells of one school ("wizard-spells-of-evocation").
 *   - `<classId>-subclasses` -> that class's subclasses.
 *   - `<category>-feats`     -> feats in that category ("origin-feats", "fighting-style-feats").
 *   - `<speciesId>-lineages` -> that species' lineages.
 *   - `<a>-or-<b>[-or-<c>]`  -> union in order, first name winning a duplicate id (Skilled's
 *                               `skills-or-tools`). A part that resolves to nothing is skipped.
 *
 * Any slug that is unknown or resolves to zero options throws `CatalogChoiceError`: an empty picker
 * must fail loudly, and server validation against nothing must reject.
 */

/** One offerable option. `level` is populated for spells so callers can apply `maxSpellLevel`. */
export type CatalogChoiceOption = Readonly<{ id: string; name: string; level?: number }>;

/** The wire catalogs the resolver reads: exactly what the content endpoints serve. */
export type CatalogChoiceCatalogs = Readonly<{
  classes: readonly ContentClassSummary[];
  subclasses: readonly ContentSubclassSummary[];
  species: readonly ContentSpeciesSummary[];
  feats: readonly ContentFeatSummary[];
  spells: readonly ContentSpellSummary[];
  equipment: readonly ContentEquipmentSummary[];
  skills: readonly ContentSkillSummary[];
  languages: readonly ContentLanguageSummary[];
}>;

/** A `fromCatalog` slug that could not be resolved to a non-empty option list. */
export class CatalogChoiceError extends Error {
  constructor(
    public readonly slug: string,
    message: string
  ) {
    super(message);
    this.name = "CatalogChoiceError";
  }
}

function nonEmpty(slug: string, options: CatalogChoiceOption[], emptyMessage: string): CatalogChoiceOption[] {
  if (options.length === 0) throw new CatalogChoiceError(slug, emptyMessage);
  return options;
}

/** Resolve a `fromCatalog` slug to its option list; throws `CatalogChoiceError` if unresolvable. Pure. */
export function resolveCatalogChoice(slug: string, catalogs: CatalogChoiceCatalogs): CatalogChoiceOption[] {
  // Union first, so a composite never falls through to a suffix family. Split on "-or-", which no family id contains.
  if (slug.includes("-or-")) {
    const parts = slug.split("-or-");
    if (parts.every((part) => part.length > 0)) {
      const seen = new Set<string>();
      const union: CatalogChoiceOption[] = [];
      for (const part of parts) {
        let resolved: CatalogChoiceOption[];
        try {
          resolved = resolveCatalogChoice(part, catalogs);
        } catch (error) {
          if (error instanceof CatalogChoiceError) continue;
          throw error;
        }
        for (const option of resolved)
          if (!seen.has(option.id)) {
            seen.add(option.id);
            union.push(option);
          }
      }
      return nonEmpty(slug, union, `None of ${parts.map((part) => `"${part}"`).join(", ")} resolved to any option.`);
    }
  }
  if (slug === "skills") {
    return nonEmpty(
      slug,
      catalogs.skills.map((skill) => ({ id: skill.id, name: skill.name })),
      "The skills catalog is empty."
    );
  }
  if (slug === "weapons") {
    return nonEmpty(
      slug,
      catalogs.equipment.filter((item) => item.category === "weapon").map((item) => ({ id: item.id, name: item.name })),
      "The equipment catalog has no weapons."
    );
  }
  // Tools are equipment rows with `category: "tool"`.
  if (slug === "tools") {
    return nonEmpty(
      slug,
      catalogs.equipment.filter((item) => item.category === "tool").map((item) => ({ id: item.id, name: item.name })),
      "The equipment catalog has no tools."
    );
  }
  if (slug === "feats") {
    return nonEmpty(
      slug,
      catalogs.feats.map((entry) => ({ id: entry.id, name: entry.name })),
      "The feats catalog is empty."
    );
  }
  const school = /^(.+)-spells-of-([a-z0-9]+)$/.exec(slug);
  if (school) {
    const [, listId, schoolId] = school;
    return nonEmpty(
      slug,
      catalogs.spells
        .filter((spell) => spell.classes.includes(listId) && spell.school === schoolId)
        .map((spell) => ({ id: spell.id, name: spell.name, level: spell.level })),
      `No ${schoolId} spells are tagged for the "${listId}" spell list.`
    );
  }
  if (slug === "languages") {
    return nonEmpty(
      slug,
      catalogs.languages.map((entry) => ({ id: entry.id, name: entry.name })),
      "The languages catalog is empty."
    );
  }
  // Narrowing to one table matters: the base "two languages from the Standard Languages table" must not offer
  // Druidic or Thieves' Cant, which the SRD grants only through class features.
  if (slug.endsWith("-languages")) {
    const table = slug.slice(0, -"-languages".length);
    return nonEmpty(
      slug,
      catalogs.languages.filter((entry) => entry.table === table).map((entry) => ({ id: entry.id, name: entry.name })),
      `No languages are printed in the "${table}" table.`
    );
  }
  if (slug.endsWith("-spells")) {
    const listId = slug.slice(0, -"-spells".length);
    return nonEmpty(
      slug,
      catalogs.spells
        .filter((spell) => spell.classes.includes(listId))
        .map((spell) => ({ id: spell.id, name: spell.name, level: spell.level })),
      `No spells are tagged for the "${listId}" spell list.`
    );
  }
  if (slug.endsWith("-subclasses")) {
    const classId = slug.slice(0, -"-subclasses".length);
    if (!catalogs.classes.some((entry) => entry.id === classId))
      throw new CatalogChoiceError(slug, `No class "${classId}" is in the catalog.`);
    return nonEmpty(
      slug,
      catalogs.subclasses
        .filter((entry) => entry.classId === classId)
        .map((entry) => ({ id: entry.id, name: entry.name })),
      `No subclasses are authored for "${classId}" yet.`
    );
  }
  if (slug.endsWith("-feats")) {
    const category = slug.slice(0, -"-feats".length);
    return nonEmpty(
      slug,
      catalogs.feats
        .filter((entry) => entry.category === category)
        .map((entry) => ({ id: entry.id, name: entry.name })),
      `No "${category}" feats are authored yet.`
    );
  }
  if (slug.endsWith("-lineages")) {
    const speciesId = slug.slice(0, -"-lineages".length);
    const species = catalogs.species.find((entry) => entry.id === speciesId);
    if (!species) throw new CatalogChoiceError(slug, `No species "${speciesId}" is in the catalog.`);
    return nonEmpty(
      slug,
      species.lineages.map((lineage) => ({ id: lineage.id, name: lineage.name })),
      `"${species.name}" has no lineages authored.`
    );
  }
  throw new CatalogChoiceError(
    slug,
    `The catalog slug "${slug}" matches no known family (skills, weapons, tools, languages, feats, *-languages, *-spells, *-spells-of-<school>, *-subclasses, *-feats, *-lineages).`
  );
}

/** One `fromPicks` source: which budget's answers, narrowed by which closed predicate. */
export type PickSourceReference = Readonly<{ offer: string; where?: string | null }>;

/**
 * Resolver for `fromPicks`: the options are the character's own earlier answers ("one of your known Warlock
 * cantrips that deals damage"), narrowed by a closed predicate slug over spell catalog fields (ADR-0008).
 * `answered` is the build's ledger. Unknown spell ids are dropped. Throws `CatalogChoiceError` when nothing
 * survives, which the survey treats as "defer".
 */
export function resolvePickChoice(
  source: PickSourceReference,
  answered: readonly string[],
  catalogs: CatalogChoiceCatalogs
): CatalogChoiceOption[] {
  const spellsById = new Map(catalogs.spells.map((spell) => [spell.id, spell]));
  const matches = (id: string): boolean => {
    if (!source.where) return true;
    const spell = spellsById.get(id);
    if (!spell) return false;
    const dealsDamage = spell.damageRoll !== null || spell.damageTypes.length > 0;
    const ranged = (spell.rangeFeet ?? 0) >= 10;
    if (source.where === "deals-damage") return dealsDamage;
    if (source.where === "attack-roll") return spell.attackRoll;
    if (source.where === "ranged") return ranged;
    // Eldritch Spear: "one of your known Warlock cantrips that deals damage and has a range of 10+ feet".
    if (source.where === "ranged-damage") return dealsDamage && ranged;
    return false;
  };
  const seen = new Set<string>();
  const options: CatalogChoiceOption[] = [];
  for (const id of answered) {
    if (seen.has(id) || !matches(id)) continue;
    seen.add(id);
    const spell = spellsById.get(id);
    options.push({ id, name: spell?.name ?? id, ...(spell ? { level: spell.level } : {}) });
  }
  return nonEmpty(
    `fromPicks:${source.offer}`,
    options,
    source.where
      ? `Nothing chosen for "${source.offer}" is ${source.where.replace(/-/g, " ")} yet. Make that pick first.`
      : `Nothing has been chosen for "${source.offer}" yet. Make that pick first.`
  );
}
