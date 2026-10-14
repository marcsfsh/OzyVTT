/**
 * Assembles the `SchemaContext` that every option list derives from. Homebrew, drafts
 * included, is merged into every list so a subclass can be authored before its class
 * publishes. `resolveCatalog` uses the same `resolveCatalogChoice` the server validates with,
 * so the count shown while authoring is the count the game offers.
 */

import { useMemo } from "react";
import {
  CONDITION_IDS,
  CREATURE_TYPE_IDS,
  DAMAGE_TYPE_IDS,
  MAGIC_SCHOOL_IDS,
  WEAPON_MASTERY_IDS,
  WEAPON_PROPERTY_IDS
} from "@vtt/content-srd-5.2.1/schemas";
import { CatalogChoiceError, resolveCatalogChoice } from "@vtt/domain";
import {
  useBackgroundCatalog,
  useBuilderCatalogs,
  useClassCatalog,
  useFeatCatalog,
  useSkillCatalog,
  useSpeciesCatalog
} from "../content/catalogs";
import { useEquipmentReference } from "../encounter/equipment";
import { useSpellReference } from "../encounter/spells";
import type { HomebrewRecordSummary } from "./api";
import type { CatalogEntry, SchemaContext, SelectOption } from "./schema";
import type { SpellMembership } from "./SpellListContents";
import type { HomebrewType } from "./types";

const byLabel = (a: SelectOption, b: SelectOption) => a.label.localeCompare(b.label);

/** Properties and masteries share one id space, and the consuming trigger gates on either. */
const WEAPON_SLUGS: readonly string[] = [...WEAPON_PROPERTY_IDS, ...WEAPON_MASTERY_IDS];

/** SRD rows plus every homebrew record of `type`, de-duplicated by id; homebrew wins a clash
    because a homebrew record with an SRD id is an override. */
function merge(
  srd: readonly SelectOption[],
  records: readonly HomebrewRecordSummary[],
  type: HomebrewType
): readonly SelectOption[] {
  const map = new Map<string, SelectOption>();
  for (const option of srd) map.set(option.value, option);
  for (const record of records) {
    if (record.type !== type || record.deletedAt) continue;
    map.set(record.id, { value: record.id, label: record.name });
  }
  return [...map.values()].sort(byLabel);
}

export function useSchemaContext(
  recordId: string,
  type: HomebrewType,
  records: readonly HomebrewRecordSummary[]
): { ctx: SchemaContext; spells: readonly SpellMembership[] } {
  const classes = useClassCatalog();
  const species = useSpeciesCatalog();
  const backgrounds = useBackgroundCatalog();
  const feats = useFeatCatalog();
  const skills = useSkillCatalog();
  const spellRows = useSpellReference();
  const equipment = useEquipmentReference();
  const builder = useBuilderCatalogs();

  return useMemo(() => {
    const spells: readonly SpellMembership[] = spellRows.map((spell) => ({
      id: spell.id,
      name: spell.name,
      level: spell.level,
      classes: spell.classes ?? []
    }));

    /* The spell and equipment summaries carry no `source` field, so origin is decided by
       whether the GM's homebrew list claims the id. */
    const mine = new Set(records.filter((record) => !record.deletedAt).map((record) => record.id));

    const spellEntries: readonly CatalogEntry[] = [
      ...spellRows.map((spell) => ({
        id: spell.id,
        name: spell.name,
        origin: (mine.has(spell.id) ? "homebrew" : "srd") as CatalogEntry["origin"],
        meta: spell.level === 0 ? `${spell.school} cantrip` : `Level ${spell.level} ${spell.school}`,
        keywords: spell.school
      })),
      // A draft homebrew spell not yet in the merged catalog is still a valid target.
      ...records
        .filter(
          (record) => record.type === "spell" && !record.deletedAt && !spellRows.some((spell) => spell.id === record.id)
        )
        .map((record) => ({ id: record.id, name: record.name, origin: "homebrew" as const, meta: "Draft" }))
    ];

    const equipmentEntries: readonly CatalogEntry[] = equipment.catalog.map((item) => ({
      id: item.id,
      name: item.name,
      origin: (mine.has(item.id) ? "homebrew" : "srd") as CatalogEntry["origin"],
      meta: item.category,
      keywords: item.category
    }));

    // Derived from the catalog so homebrew categories appear too.
    const distinct = (values: readonly string[]): readonly SelectOption[] =>
      [...new Set(values.filter(Boolean))]
        .sort()
        .map((value) => ({ value, label: value.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) }));

    // A spell list is any id a spell tags itself with (per `resolveCatalogChoice`), plus every
    // homebrew list and class.
    const listIds = new Set<string>();
    for (const spell of spells) for (const id of spell.classes) listIds.add(id);
    for (const record of records) {
      if (record.deletedAt) continue;
      if (record.type === "spell-list" || record.type === "class") listIds.add(record.id);
    }
    const nameOf = new Map(records.map((record) => [record.id, record.name]));
    const spellLists = [...listIds]
      .map((id) => ({
        value: id,
        label: nameOf.get(id) ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
      }))
      .sort(byLabel);

    const ctx: SchemaContext = {
      recordId,
      siblings: records
        .filter((record) => record.type === type && !record.deletedAt)
        .map((record) => ({ id: record.id, name: record.name })),
      classes: merge(
        classes.items.map((row) => ({ value: row.id, label: row.name })),
        records,
        "class"
      ),
      species: merge(
        species.items.map((row) => ({ value: row.id, label: row.name })),
        records,
        "species"
      ),
      backgrounds: merge(
        backgrounds.items.map((row) => ({ value: row.id, label: row.name })),
        records,
        "background"
      ),
      feats: merge(
        feats.items.map((row) => ({ value: row.id, label: row.name })),
        records,
        "feat"
      ),
      featCategories: distinct([
        ...feats.items.map((row) => row.category),
        "origin",
        "general",
        "fighting-style",
        "epic-boon"
      ]),
      skills: skills.items.map((row) => ({ value: row.id, label: row.name })),
      spellLists,
      spells: spellEntries,
      equipment: equipmentEntries,
      equipmentCategories: distinct(equipment.catalog.map((item) => item.category)),
      /* Canonical SRD vocabularies compiled in from the package the server validates with,
         so these lists are complete on first paint without waiting on a fetch. */
      damageTypes: DAMAGE_TYPE_IDS,
      conditions: CONDITION_IDS,
      schools: MAGIC_SCHOOL_IDS,
      creatureTypes: CREATURE_TYPE_IDS,
      weaponProperties: WEAPON_SLUGS,
      resolveCatalog: (slug) => {
        try {
          return { count: resolveCatalogChoice(slug, builder.choice).length };
        } catch (error) {
          return { error: error instanceof CatalogChoiceError ? error.message : "That catalog doesn't resolve." };
        }
      }
    };

    return { ctx, spells };
  }, [
    recordId,
    type,
    records,
    classes.items,
    species.items,
    backgrounds.items,
    feats.items,
    skills.items,
    spellRows,
    equipment.catalog,
    builder.choice
  ]);
}
