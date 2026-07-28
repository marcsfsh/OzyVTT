import type {
  ContentClassSummary, ContentEquipmentSummary, ContentFeatSummary, ContentSkillSummary,
  ContentSpeciesSummary, ContentSpellSummary, ContentSubclassSummary
} from "./index.js";

/**
 * THE resolver for `fromCatalog` choice slugs (task-packet phase-2 must-fix; QA blocker B1).
 *
 * Content features ask for picks from OPEN catalog lists ("choose a skill", "choose a Wizard spell")
 * by naming a slug instead of enumerating options. This module is the single documented mapping from
 * those slugs to concrete option lists, shared by BOTH consumers: the wizard UI resolves a slug to
 * render a picker, and the server resolves the SAME slug through the SAME function when it validates
 * a `character.create` choice row - so the two can never disagree about what was offerable
 * (CLAUDE.md rule 2: the client must not become a second rules engine).
 *
 * The slug grammar is a closed set of FAMILIES over open ids (no closed content enums, principle 3):
 *
 *   - `skills`               -> every skill in the skills catalog.
 *   - `weapons`              -> every weapon in the equipment catalog (Weapon Mastery-style picks).
 *   - `<listId>-spells`      -> spells whose `classes` includes `<listId>` ("wizard-spells" -> the
 *                               Wizard list). `<listId>` is the class's `spellcasting.spellListId`
 *                               (an open slug, so a homebrew list works unchanged).
 *   - `<classId>-subclasses` -> subclasses whose `classId` is `<classId>`.
 *   - `<category>-feats`     -> feats whose `category` is `<category>` ("origin-feats",
 *                               "general-feats", "fighting-style-feats", "epic-boon-feats", ...).
 *   - `<speciesId>-lineages` -> the named species' lineages ("elf-lineages").
 *
 * An unresolvable slug - unknown family, unknown id, or a family that resolves to ZERO options (a
 * content gap the player would otherwise hit as a silently empty picker) - throws
 * `CatalogChoiceError`. Never return a silent empty list: a wizard step with no data path must say
 * so loudly, and a server validation against nothing must reject, not accept.
 */

/** One offerable option. `level` is populated for spells so callers can apply `maxSpellLevel`. */
export type CatalogChoiceOption = Readonly<{ id: string; name: string; level?: number }>;

/** The wire catalogs the resolver reads - exactly what the content endpoints serve. */
export type CatalogChoiceCatalogs = Readonly<{
  classes: readonly ContentClassSummary[];
  subclasses: readonly ContentSubclassSummary[];
  species: readonly ContentSpeciesSummary[];
  feats: readonly ContentFeatSummary[];
  spells: readonly ContentSpellSummary[];
  equipment: readonly ContentEquipmentSummary[];
  skills: readonly ContentSkillSummary[];
}>;

/** A `fromCatalog` slug that could not be resolved to a non-empty option list. */
export class CatalogChoiceError extends Error {
  constructor(public readonly slug: string, message: string) {
    super(message);
    this.name = "CatalogChoiceError";
  }
}

function nonEmpty(slug: string, options: CatalogChoiceOption[], emptyMessage: string): CatalogChoiceOption[] {
  if (options.length === 0) throw new CatalogChoiceError(slug, emptyMessage);
  return options;
}

/**
 * Resolve a `fromCatalog` slug to its concrete option list. Throws `CatalogChoiceError` for anything
 * unresolvable - see the module doc for the slug grammar. Pure: same inputs, same options, no I/O.
 */
export function resolveCatalogChoice(slug: string, catalogs: CatalogChoiceCatalogs): CatalogChoiceOption[] {
  if (slug === "skills") {
    return nonEmpty(slug, catalogs.skills.map((skill) => ({ id: skill.id, name: skill.name })), "The skills catalog is empty.");
  }
  if (slug === "weapons") {
    return nonEmpty(
      slug,
      catalogs.equipment.filter((item) => item.category === "weapon").map((item) => ({ id: item.id, name: item.name })),
      "The equipment catalog has no weapons."
    );
  }
  if (slug.endsWith("-spells")) {
    const listId = slug.slice(0, -"-spells".length);
    return nonEmpty(
      slug,
      catalogs.spells.filter((spell) => spell.classes.includes(listId)).map((spell) => ({ id: spell.id, name: spell.name, level: spell.level })),
      `No spells are tagged for the "${listId}" spell list.`
    );
  }
  if (slug.endsWith("-subclasses")) {
    const classId = slug.slice(0, -"-subclasses".length);
    if (!catalogs.classes.some((entry) => entry.id === classId)) throw new CatalogChoiceError(slug, `No class "${classId}" is in the catalog.`);
    return nonEmpty(
      slug,
      catalogs.subclasses.filter((entry) => entry.classId === classId).map((entry) => ({ id: entry.id, name: entry.name })),
      `No subclasses are authored for "${classId}" yet.`
    );
  }
  if (slug.endsWith("-feats")) {
    const category = slug.slice(0, -"-feats".length);
    return nonEmpty(
      slug,
      catalogs.feats.filter((entry) => entry.category === category).map((entry) => ({ id: entry.id, name: entry.name })),
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
  throw new CatalogChoiceError(slug, `The catalog slug "${slug}" matches no known family (skills, weapons, *-spells, *-subclasses, *-feats, *-lineages).`);
}
