import type {
  ContentClassSummary, ContentEquipmentSummary, ContentFeatSummary, ContentLanguageSummary,
  ContentSkillSummary, ContentSpeciesSummary, ContentSpellSummary, ContentSubclassSummary
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
 *   - `tools`                -> every tool in the equipment catalog (Skilled's "skills or tools" half).
 *   - `languages`            -> every language in the languages catalog.
 *   - `<table>-languages`    -> languages printed in one SRD table ("standard-languages",
 *                               "rare-languages"). The base "Common plus two languages" budget draws
 *                               from `standard`; `druidic` and `thieves-cant` are `rare` and arrive
 *                               as grants, never as a level-1 pick.
 *   - `<listId>-spells`      -> spells whose `classes` includes `<listId>` ("wizard-spells" -> the
 *                               Wizard list). `<listId>` is the class's `spellcasting.spellListId`
 *                               (an open slug, so a homebrew list works unchanged).
 *   - `<classId>-subclasses` -> subclasses whose `classId` is `<classId>`.
 *   - `<category>-feats`     -> feats whose `category` is `<category>` ("origin-feats",
 *                               "general-feats", "fighting-style-feats", "epic-boon-feats", ...).
 *   - `<speciesId>-lineages` -> the named species' lineages ("elf-lineages").
 *   - `<a>-or-<b>[-or-<c>]`  -> the UNION of the named families, in order, first name winning a
 *                               duplicate id. The one COMBINATOR in the grammar, and it exists
 *                               because two SRD records say exactly this: Skilled's "any combination
 *                               of three skills or tools" (`skills-or-tools`) and Magical
 *                               Discoveries' "the Cleric, Druid, or Wizard spell list"
 *                               (`cleric-spells-or-druid-spells-or-wizard-spells`). A part that is
 *                               itself a content gap contributes NOTHING rather than taking the whole
 *                               union down - the same call `from` + `fromCatalog` already makes - but
 *                               a union that resolves to nothing overall still throws.
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
  languages: readonly ContentLanguageSummary[];
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
  // THE UNION COMBINATOR, checked first so a composite never falls through to a suffix family. Parts
  // are resolved left to right and de-duplicated by id, so an option in two lists keeps the name the
  // FIRST list gave it. Split on the whole "-or-" token, which no family id contains.
  if (slug.includes("-or-")) {
    const parts = slug.split("-or-");
    if (parts.every((part) => part.length > 0)) {
      const seen = new Set<string>();
      const union: CatalogChoiceOption[] = [];
      for (const part of parts) {
        let resolved: CatalogChoiceOption[];
        try { resolved = resolveCatalogChoice(part, catalogs); }
        catch (error) { if (error instanceof CatalogChoiceError) continue; throw error; }
        for (const option of resolved) if (!seen.has(option.id)) { seen.add(option.id); union.push(option); }
      }
      return nonEmpty(slug, union, `None of ${parts.map((part) => `"${part}"`).join(", ")} resolved to any option.`);
    }
  }
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
  // TOOLS - the same read `weapons` makes, one column over. `equipment` already carries all 35 SRD
  // tools (`category: "tool"`), so Skilled's "any combination of three skills or tools" needed a
  // family, never a new bundle: the ids the wizard offers are the ids `grants.tools` already names.
  if (slug === "tools") {
    return nonEmpty(
      slug,
      catalogs.equipment.filter((item) => item.category === "tool").map((item) => ({ id: item.id, name: item.name })),
      "The equipment catalog has no tools."
    );
  }
  if (slug === "languages") {
    return nonEmpty(slug, catalogs.languages.map((entry) => ({ id: entry.id, name: entry.name })), "The languages catalog is empty.");
  }
  // ONE SRD TABLE of languages. The base budget every character is owed reads "Common plus two
  // languages ... from the Standard Languages table", so the narrowing is part of the promise and not
  // a nicety: offering Druidic or Thieves' Cant at level 1 would hand out a secret language the SRD
  // gives only through a class feature. Checked BEFORE `-spells` etc. because `-languages` is its own
  // suffix; the plain `languages` slug above is matched first so it never falls in here with an empty table.
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
  throw new CatalogChoiceError(slug, `The catalog slug "${slug}" matches no known family (skills, weapons, tools, languages, *-languages, *-spells, *-subclasses, *-feats, *-lineages).`);
}
