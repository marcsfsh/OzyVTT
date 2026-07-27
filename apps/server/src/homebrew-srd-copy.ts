import type { HomebrewContentType } from "@vtt/api-contract";
import type { ActorDefinition } from "@vtt/schemas";
import type { ContentView } from "./content-library.js";
import type { HomebrewBody } from "./homebrew-store.js";

/**
 * DUPLICATE AN SRD RECORD into an authorable homebrew body.
 *
 * This is not a convenience. Blank-slate and duplicate-an-SRD-record were chosen as EQUALLY
 * PROMINENT entry points, and duplicate is the one that makes authoring a class tractable at all: a
 * `ClassReference` carries a mandatory twenty-row `levelTable` plus its whole feature list, and
 * nobody types that into a form. The GM duplicates Wizard, renames it, and edits.
 *
 * The copy must be SELF-CONSISTENT, and that is the whole difficulty. Three kinds of id live in a
 * content record and they need three different answers:
 *
 *   1. THE RECORD'S OWN ID           re-minted. Non-negotiable: `hb-` is reserved, and a copy sharing
 *                                    the source's id would shadow it in the merged catalog.
 *   2. INTRA-RECORD IDS              kept verbatim (`features[].id`, `levelTable[].features[]`,
 *      (feature ids, lineage ids,    `lineages[].id`, `actions[].id`). `ClassReferenceSchema`'s own
 *       action ids, option ids)      superRefine cross-checks the level table against the feature
 *                                    list, so re-minting these would break the record immediately.
 *   3. DERIVED IDS naming the        rewritten ONLY when leaving them would make the copy behave as
 *      record itself                 the SOURCE record rather than as itself. See below - this is
 *                                    the rule that is easy to get uniformly wrong in either
 *                                    direction, and both directions are silent.
 *
 * THE REWRITE RULE, stated once, with the evidence for each case:
 *
 *   REWRITE `<speciesId>-lineages`. `resolveCatalogChoice` resolves it against the species whose id
 *   is in the slug, so a copy that kept `elf-lineages` would offer ELF's lineage rows - and any
 *   lineage the GM adds to the copy would never be offered, silently.
 *
 *   REWRITE `<classId>-subclasses`. Keeping it offers the source's subclasses, and
 *   `character-build.ts` then HARD-REJECTS the build ("Evocation is a wizard subclass, not a
 *   Chronomancer one"). Rewriting means the copy cannot publish until the GM authors a subclass -
 *   which is a loud message on the publish button instead of a player who cannot finish a character.
 *
 *   KEEP `<listId>-spells`, `spellcasting.spellListId`, `SubclassReference.classId`,
 *   `background.originFeatId`, `startingEquipment[].items[].id`, `SpellReference.classes[]` and
 *   `SpellListReference.basedOn/add/remove`. Every one of these names a SEPARATE record that was not
 *   copied, and each keeps working: a duplicated Wizard drawing the `wizard` spell list is a
 *   legitimate, creatable class, whereas re-pointing it at an empty new list would make it
 *   uncreatable for no gain. (Pack import is the different case - there the referenced record IS
 *   also being re-minted, and `homebrew-pack.ts` rewrites accordingly.)
 *
 *   REWRITE `ActorDefinition.source.externalId`. It is a monster's identity, not a reference.
 *
 * And `source` becomes `"homebrew"`: the copy is the GM's record now, and leaving it `"srd"` would
 * put an SRD badge (and the bundle's CC-BY attribution) on hand-edited content.
 */

/** Which catalogs are searched, in order, when an id arrives with no type attached. */
const LOOKUPS: ReadonlyArray<Readonly<{ type: HomebrewContentType; find: (catalog: ContentView, id: string) => unknown }>> = [
  { type: "class", find: (catalog, id) => catalog.classRecord(id) },
  { type: "subclass", find: (catalog, id) => catalog.subclassRecord(id) },
  { type: "species", find: (catalog, id) => catalog.speciesRecord(id) },
  { type: "background", find: (catalog, id) => catalog.backgroundRecord(id) },
  { type: "feat", find: (catalog, id) => catalog.featRecord(id) },
  { type: "spell", find: (catalog, id) => catalog.spellRecord(id) },
  { type: "equipment", find: (catalog, id) => catalog.equipmentRecord(id) },
  { type: "monster", find: (catalog, id) => catalog.monster(id) }
];

export type HomebrewSourceRecord = Readonly<{ type: HomebrewContentType; body: HomebrewBody }>;

/**
 * The catalog record behind `id`, deep-copied and prepared for authoring, or undefined when the id
 * names nothing. The caller mints the new id and calls `rewriteForNewId` with it.
 *
 * Searched by id across all eight catalogs because `/duplicate` carries no `type` (the contract
 * addresses one record by id and nothing else). Ids are unique across types in practice; the order
 * above is fixed so the answer is at least deterministic if that ever stops being true.
 */
export function findCatalogRecord(catalog: ContentView, id: string): HomebrewSourceRecord | undefined {
  for (const lookup of LOOKUPS) {
    const found = lookup.find(catalog, id);
    if (found) return { type: lookup.type, body: asAuthoredBody(structuredClone(found) as HomebrewBody) };
  }
  return undefined;
}

/**
 * Undo the one thing `FeatureChoiceSchema` does that is NOT round-trippable.
 *
 * Its `.transform()` DERIVES `choice.from` from `choice.options`, and its `superRefine` REJECTS a
 * body that carries both ("Author `options` alone - `from` is derived from the option ids"). So a
 * record that has been through the schema once cannot go through it again - and a copied catalog
 * record has, by definition, been through it. Left alone, duplicating Cleric (Divine Order authors
 * inline options) would store a body that fails publish validation AND is silently dropped by
 * `publishedFor`, which is the worst of both: a copy the GM cannot publish and cannot diagnose.
 *
 * Stripping the derived key restores the AUTHORED shape, which is what the column is meant to hold.
 * The information is not lost - the ids are still on the options.
 */
function asAuthoredBody(body: HomebrewBody): HomebrewBody {
  const next = body as Record<string, unknown>;
  for (const feature of featureBearingRecords(next)) {
    const choice = feature.choice;
    if (isObject(choice) && Array.isArray(choice.options)) delete choice.from;
  }
  return next as HomebrewBody;
}

/**
 * Re-point every id in a copied body that names the record ITSELF. `oldId` is the source record's
 * id; `newId` is the freshly minted one. Intra-record ids are untouched - see the rule above.
 *
 * Written against `Record<string, unknown>` rather than the nine typed shapes on purpose: this walks
 * only the handful of fields it names, and a body it does not recognise comes back unchanged rather
 * than half-rewritten.
 */
export function rewriteForNewId(type: HomebrewContentType, body: HomebrewBody, oldId: string, newId: string): HomebrewBody {
  const next = structuredClone(body) as Record<string, unknown>;
  next.id = newId;
  // A copy is the GM's own record. Leaving `source: "srd"` would badge hand-edited content as SRD and
  // hang the bundle's CC-BY attribution on it.
  if (type !== "monster") next.source = "homebrew";

  if (type === "monster") {
    const source = next.source;
    next.source = { ...(isObject(source) ? source : { name: "Homebrew", version: "1" }), externalId: newId };
    return next as HomebrewBody;
  }

  // The two self-referential families. Both are derived by appending a suffix to the record's own id,
  // so both are rewritten by exactly the same substitution.
  const families = type === "species" ? ["-lineages"] : type === "class" ? ["-subclasses"] : [];
  if (families.length > 0) {
    const rename = (slug: unknown): unknown => {
      if (typeof slug !== "string") return slug;
      for (const family of families) if (slug === `${oldId}${family}`) return `${newId}${family}`;
      return slug;
    };
    for (const feature of featureBearingRecords(next)) {
      const choice = feature.choice;
      if (!isObject(choice)) continue;
      choice.fromCatalog = rename(choice.fromCatalog);
      for (const option of asArray(choice.options)) {
        if (!isObject(option)) continue;
        const nested = option.choice;
        if (isObject(nested)) nested.fromCatalog = rename(nested.fromCatalog);
      }
    }
  }
  return next as HomebrewBody;
}

/** Every place a `FeatureRecord` can sit inside a body: class/subclass/background features, species traits (incl. lineage traits), a feat's single feature. */
function featureBearingRecords(body: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const collect = (value: unknown) => { for (const entry of asArray(value)) if (isObject(entry)) out.push(entry); };
  collect(body.features);
  collect(body.traits);
  for (const lineage of asArray(body.lineages)) if (isObject(lineage)) collect(lineage.traits);
  if (isObject(body.feature)) out.push(body.feature);
  return out;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** A monster's authored `name` lives on the definition, like every other type's; asserted here so the router's rename is type-blind. */
export type SrdCopyableDefinition = ActorDefinition;
