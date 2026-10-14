import type { HomebrewContentType } from "@vtt/api-contract";
import type { ActorDefinition } from "@vtt/schemas";
import type { ContentView } from "./content-library.js";
import type { HomebrewBody } from "./homebrew-store.js";

/**
 * Duplicate an SRD record into an authorable homebrew body. The copy's own id is re-minted; intra-record ids are
 * kept (the level table cross-checks feature ids); self-derived ids (`<id>-lineages`, `<id>-subclasses`, a
 * monster's `source.externalId`) are rewritten; references to other records are kept. `source` becomes "homebrew".
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

/** The deep-copied record behind `id` (any catalog, fixed order, since `/duplicate` has no type), or undefined. */
export function findCatalogRecord(catalog: ContentView, id: string): HomebrewSourceRecord | undefined {
  for (const lookup of LOOKUPS) {
    const found = lookup.find(catalog, id);
    if (found) return { type: lookup.type, body: asAuthoredBody(structuredClone(found) as HomebrewBody) };
  }
  return undefined;
}

/** Drop the derived `choice.from`: the schema rejects a body carrying both it and `options`. */
function asAuthoredBody(body: HomebrewBody): HomebrewBody {
  const next = body as Record<string, unknown>;
  for (const feature of featureBearingRecords(next)) {
    for (const choice of choiceBlocksOn(feature)) {
      if (Array.isArray(choice.options)) delete choice.from;
    }
  }
  return next as HomebrewBody;
}

/** Every choice block a feature carries, whichever spelling holds it — the untyped twin of
    `featurePicks`, over a body this walker deliberately reads as `Record<string, unknown>`. */
function choiceBlocksOn(feature: Record<string, unknown>): Record<string, unknown>[] {
  const plural = asArray(feature.choices).filter(isObject);
  if (plural.length > 0) return plural;
  return isObject(feature.choice) ? [feature.choice] : [];
}

/** Re-point ids naming the record itself. Walks only named fields, so an unknown body comes back unchanged. */
export function rewriteForNewId(type: HomebrewContentType, body: HomebrewBody, oldId: string, newId: string): HomebrewBody {
  const next = structuredClone(body) as Record<string, unknown>;
  next.id = newId;
  // Leaving `source: "srd"` would badge hand-edited content as SRD and attach CC-BY attribution.
  if (type !== "monster") next.source = "homebrew";

  if (type === "monster") {
    const source = next.source;
    next.source = { ...(isObject(source) ? source : { name: "Homebrew", version: "1" }), externalId: newId };
    return next as HomebrewBody;
  }

  // The self-referential families: the record's own id plus a suffix.
  const families = type === "species" ? ["-lineages"] : type === "class" ? ["-subclasses"] : [];
  if (families.length > 0) {
    const rename = (slug: unknown): unknown => {
      if (typeof slug !== "string") return slug;
      for (const family of families) if (slug === `${oldId}${family}`) return `${newId}${family}`;
      return slug;
    };
    for (const feature of featureBearingRecords(next)) {
      for (const choice of choiceBlocksOn(feature)) {
        choice.fromCatalog = rename(choice.fromCatalog);
        for (const option of asArray(choice.options)) {
          if (!isObject(option)) continue;
          for (const nested of choiceBlocksOn(option)) nested.fromCatalog = rename(nested.fromCatalog);
        }
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

/** A monster's authored `name` lives on the definition, so the router's rename is type-blind. */
export type SrdCopyableDefinition = ActorDefinition;
